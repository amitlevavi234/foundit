import 'server-only';

import { unstable_cache } from 'next/cache';
import pg from 'pg';

import { runWithIdentity, type RequestIdentity } from './identity';
import {
  runBrowse,
  runHome,
  runLogSearchEvent,
  runPrefetch,
  runQueryRerank,
  runSearch,
  runSearchDetailed,
  runStoreQueryEmbedding,
  runStoreQueryReading,
  runStoreQueryRerank,
  runToolNames,
  runToolPage,
  runTop,
  runTouchQueryEmbedding,
  runTouchQueryReading,
  runTouchQueryRerank,
  QueryTooLongError,
  type Prefetch,
} from './sql';
import type {
  BrowseData,
  HomeData,
  SearchConstraints,
  SearchDetailedResult,
  SearchEvent,
  ToolPageData,
  ToolResult,
  TopData,
  TopRanking,
} from './types';

/* ===========================================================================
 * The application's only door to PostgreSQL.
 *
 * It connects as `foundit_app`: a role that owns nothing and bypasses nothing.
 * Row-level security is the boundary, and connecting as the owner would
 * silently switch every policy in the schema off. The owner's connection
 * string belongs to migrations and appears nowhere in this codebase.
 *
 * One function per screen leaves this module, and no more. There is no
 * `query()` escape hatch on purpose: filtering and ranking live in SQL, and a
 * general-purpose query helper is how they stop living there.
 *
 * Every one of them is a single round trip. A screen that needs a list and
 * something about each item in the list asks PostgreSQL for both in one
 * statement — see lib/sql.ts — rather than looping.
 * ======================================================================== */

/**
 * The database sits on the same box as the app — a sub-millisecond hop, not a
 * cross-region one — so connections are cheap to open and expensive to hoard.
 * PostgreSQL is configured for 30 connections total with 8 MB of work_mem
 * each; eight is a comfortable ceiling for the web process on a 4 GB machine
 * and leaves room for psql, the eval harness and the backup job.
 */
const POOL_MAX = 8;

/** Matches the 5s statement_timeout already set on the foundit_app role. */
const STATEMENT_TIMEOUT_MS = 5_000;

declare global {
  var __founditPool: pg.Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. It is the foundit_app connection string, and it is read ' +
        'from the environment and nowhere else.',
    );
  }

  // A misconfigured deploy that hands the app the owner's credentials would
  // work perfectly and disable every row-level security policy while doing it.
  // Fail loudly instead.
  let user = '';
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    // Not a URL we can parse. Let pg report the problem; nothing here needs
    // to repeat the string back, and it holds a password.
    return url;
  }
  if (user === 'foundit_owner' || user === 'postgres') {
    throw new Error(
      `DATABASE_URL connects as "${user}". The application must connect as foundit_app, ` +
        'which owns nothing and bypasses nothing. The owner role is for migrations only.',
    );
  }
  return url;
}

function createPool(): pg.Pool {
  const pool = new pg.Pool({
    connectionString: connectionString(),
    max: POOL_MAX,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'foundit-web',
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 500,
  });

  // An idle client that errors with no listener attached takes the process
  // down with an unhandled rejection. The message can carry the connection
  // string, so it is not re-raised anywhere it could reach a log or a page.
  pool.on('error', () => {});

  return pool;
}

/**
 * One pool, reused across requests. In development Next replaces the module
 * on every edit, so the pool is parked on `globalThis` to stop each save from
 * leaking eight more connections.
 */
function getPool(): pg.Pool {
  globalThis.__founditPool ??= createPool();
  return globalThis.__founditPool;
}

/* ===========================================================================
 * Who is asking, for the length of one transaction.
 *
 * This is the mechanism Supabase's PostgREST used to provide for free and
 * which, self-hosted, is ours to build — research/09 §3 calls it the heart of
 * the whole report. Everything above this point runs with no identity at all
 * and sees exactly what a stranger sees. Everything a signed-in person does
 * goes through here.
 *
 * FOUR THINGS ABOUT IT ARE LOAD-BEARING, and each one is a documented way this
 * fails silently (research/09 §3, "the failure modes, in order of how badly
 * they end"):
 *
 *   ONE CLIENT, ONE TRANSACTION. The claim is set on a checked-out client and
 *   every statement runs on that same client. `pool.query()` would hand the
 *   work to a different connection and the claim would apply to nobody.
 *
 *   `is_local = true`, ALWAYS. That is what makes the setting die at COMMIT or
 *   ROLLBACK. Set it session-wide and the next request to take that pooled
 *   connection inherits the previous person's identity — horizontal privilege
 *   escalation that only appears under concurrency, which is to say never in
 *   testing and always in production.
 *
 *   `set_config($1, $2, true)` AND NOT `SET LOCAL`. `SET LOCAL` cannot take a
 *   bind parameter, so using it means concatenating a user id into SQL, in the
 *   authorization layer, which is the worst place in a codebase for an
 *   injection hole.
 *
 *   IT FAILS CLOSED. No claim, an empty claim or a malformed one all make
 *   `auth.uid()` null (0001 and 0013), `null = user_id` is null, the policy
 *   does not pass, and the read returns nothing and the write is refused.
 *   Forgetting to call this is a bug report rather than a breach.
 *
 * The share token rides along beside the claim because it is the same kind of
 * thing — a fact about this request that a policy reads — and the opposite
 * kind of thing in every other way: it is a capability somebody pasted, not an
 * identity, and it opens exactly one row.
 * ======================================================================== */

/**
 * Run `fn` inside ONE transaction on ONE connection, with this request's
 * identity applied as transaction-local settings.
 *
 * The transaction itself is `runWithIdentity` in lib/identity.ts, which is
 * where the four load-bearing details are written down and where
 * tests/session.test.mjs drives them. What is here is the pool: check a client
 * out, hand it over, and release it however that ends.
 *
 * The client is handed to the callback so that a screen needing two statements
 * runs both under the same claim; it is not exported anywhere else, and
 * lib/account-sql.ts is where the statements live.
 */
export async function withIdentity<T>(
  identity: RequestIdentity,
  fn: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await runWithIdentity(client, identity, (tx) => fn(tx as pg.PoolClient));
  } finally {
    client.release();
  }
}

/**
 * Search the catalogue.
 *
 * One round trip. Filtering, ranking and limiting all happen inside
 * `public.search_tools`; nothing is sorted or dropped here.
 *
 * A query over 200 characters throws `QueryTooLongError`, which carries the
 * length and a 400 status and never the text.
 */
export async function searchTools(
  query: string,
  constraints: SearchConstraints = {},
  limit = 20,
): Promise<ToolResult[]> {
  return runSearch(getPool(), query, constraints, limit);
}

/**
 * The results screen's search: the same ranking, with the columns a result
 * card draws — the maker's address, the platforms, the languages, the flags,
 * the counters, the category and the tool's own problem statement that matched
 * — joined on inside the same statement.
 *
 * `category` narrows an existing search to one category, which is what the
 * clarifier's answers do. `search_tools` has no category argument, so that
 * narrowing happens in SQL around it, over a wider window; nothing is filtered
 * or reordered here.
 *
 * `embedding` is the query vector when the caller has one. Left out, the
 * database looks in its own cache, and the returned `embeddingMissing` says
 * whether it found one — so a repeated search is a single round trip and a
 * first-ever sentence costs one more plus an API call.
 */
export async function searchToolsDetailed(
  query: string,
  constraints: SearchConstraints = {},
  limit = 12,
  category: string | null = null,
  embedding: string | null = null,
): Promise<SearchDetailedResult> {
  return runSearchDetailed(getPool(), query, constraints, limit, category, embedding);
}

/**
 * Keep the vector for a sentence, so the next person who types it costs
 * nothing.
 *
 * Fire and forget, exactly like `logSearchEvent`: call it after the response
 * has gone out and do not await it. A cache that failed to fill is a slower
 * search later, never an error now.
 *
 * `public.query_embeddings` has no user column and this call has no argument
 * that could become one.
 */
export function storeQueryEmbedding(query: string, vector: string, model: string): void {
  void runStoreQueryEmbedding(getPool(), query, vector, model).catch(() => {
    // Silent for the same reason logSearchEvent is: the only thing worth
    // logging here is the query text, and the query text is exactly what must
    // never appear in a log line beside a timestamp and a request.
  });
}

/**
 * Record that a cached vector was used, for eviction. Fire and forget.
 *
 * This is a separate call rather than something search does, because
 * `search_tools` is STABLE and cannot write — and because a visitor must never
 * wait on bookkeeping. It runs in the same `after()` block as the search-event
 * log, once the page has gone out.
 */
export function touchQueryEmbedding(query: string): void {
  void runTouchQueryEmbedding(getPool(), query).catch(() => {});
}

/**
 * Ask both caches, in one statement, before either paid call is made.
 *
 * This is the round trip Phase 4 added and Phase 3 did not have, and it buys
 * the concurrency: knowing up front whether the sentence has been read and
 * whether the text has a vector is what lets the reader and the embedder start
 * together instead of one discovering it needed the other's answer.
 *
 * A failure is not an error. Both caches missing is the slow path, not a broken
 * page, so this answers "neither" rather than throwing — except for a query
 * over the cap, which is the one thing the page must say out loud.
 */
export async function prefetchForSearch(query: string, searchText: string): Promise<Prefetch> {
  try {
    return await runPrefetch(getPool(), query, searchText);
  } catch (error) {
    if (error instanceof QueryTooLongError) throw error;
    // The reason, and nothing else: no query text. The slow path is a correct
    // page, so nobody sees anything.
    console.error(
      `the cache prefetch failed (${
        (error as { code?: string } | null)?.code ?? 'unknown'
      }); the search ran as though both caches had missed`,
    );
    return { reading: null, embeddingMissing: true };
  }
}

/**
 * Keep the reading for a sentence, so the next person who types it costs
 * nothing.
 *
 * Fire and forget, exactly like `storeQueryEmbedding`: call it after the
 * response has gone out and do not await it.
 *
 * `public.query_readings` has no user column and this call has no argument that
 * could become one.
 */
export function storeQueryReading(query: string, reading: unknown, model: string): void {
  void runStoreQueryReading(getPool(), query, reading, model).catch(() => {
    // Silent for the same reason logSearchEvent is: the only thing worth
    // logging here is the query text, and the query text is exactly what must
    // never appear in a log line beside a timestamp and a request.
  });
}

/** Record that a cached reading was used, for eviction. Fire and forget. */
export function touchQueryReading(query: string): void {
  void runTouchQueryReading(getPool(), query).catch(() => {});
}

/**
 * The reranker's judgement for this sentence over this candidate set, or null.
 *
 * Null on a miss AND on a failure, which is the same thing to the caller: with
 * no judgement the page is the Phase 4 page, which is a perfectly good page.
 * The reason is logged and the sentence is not.
 */
export async function getQueryRerank(query: string, hash: string): Promise<unknown> {
  try {
    return await runQueryRerank(getPool(), query, hash);
  } catch (error) {
    console.error(
      `the rerank cache could not be read (${
        (error as { code?: string } | null)?.code ?? 'unknown'
      }); the search ran as though it had missed`,
    );
    return null;
  }
}

/**
 * Keep one judgement. Fire and forget, exactly like the other two caches: call
 * it after the response has gone out and do not await it.
 *
 * `public.query_reranks` has no user column and this call has no argument that
 * could become one.
 */
export function storeQueryRerank(
  query: string,
  hash: string,
  judgement: unknown,
  model: string,
): void {
  void runStoreQueryRerank(getPool(), query, hash, judgement, model).catch(() => {
    // Silent for the same reason storeQueryReading is: the only thing worth
    // logging here is the sentence, and the sentence is exactly what must never
    // appear in a log line beside a timestamp.
  });
}

/** Record that a cached judgement was used, for eviction. Fire and forget. */
export function touchQueryRerank(query: string, hash: string): void {
  void runTouchQueryRerank(getPool(), query, hash).catch(() => {});
}

/* ===========================================================================
 * The catalogue screens, cached for a minute.
 *
 * The homepage and /browse each spend about 200 ms in PostgreSQL on this
 * laptop, and nearly all of it is row-level security doing its job: every one
 * of the 504 problem statements is checked by tool_is_mine() and
 * tool_is_visible() on its way to becoming three cards (EXPLAIN ANALYZE,
 * recorded in docs/loop-progress.md). That cost is the price of the boundary
 * and is not negotiable. What is negotiable is paying it once per visitor.
 *
 * So the four catalogue reads are kept for CATALOGUE_REVALIDATE_SECONDS in
 * Next's data cache and served stale-while-revalidate: a visitor gets the
 * stored answer and, at most once a minute, a background request refreshes
 * it. A like or a new listing therefore shows up within a minute rather than
 * at once, which nothing on these pages promises otherwise.
 *
 * Three rules keep this honest:
 *
 *   1. ONLY THE ANONYMOUS VIEW IS CACHED. The pool connects as foundit_app
 *      with no request claims, so every row here is what a stranger may see.
 *      Nothing that runs with a person's identity may ever be wrapped in this
 *      — the day Phase 6 adds sign-in, a cached per-person answer would be
 *      served to the next visitor. Search is NOT cached here: it has its own
 *      cache (the query vector) and its own rules.
 *
 *   2. A STRANGER CANNOT GROW THE CACHE WITH INVENTED KEYS. The cache key
 *      includes the arguments, and `?in=` and `/tools/<slug>` come straight
 *      off the URL. Unbounded, a script could write one entry per invented
 *      string, which is the disk-filling bug 0005 fixed in the query cache. So
 *      a category is cached only when it is one the (cached) category list
 *      contains, and a tool page only when a published tool exists: an unknown
 *      one is asked of the database directly and stored nowhere.
 *
 *      That claim was too strong when it was first written here, and the
 *      correction is the reason for `lower()` below. Slugs are `citext` in the
 *      database, so `/tools/Splitwise`, `/tools/SPLITWISE` and 223 other
 *      spellings are all the SAME published tool — each of which would have
 *      been a separate cache entry, and `?in=MONEY` would have missed the
 *      guard's exact-match check and gone to the database on every request.
 *      Both keys are folded to lower case first, which is what makes the
 *      sentence true rather than nearly true.
 *
 *   3. STILL ONE ROUND TRIP. A cache miss runs the same single statement it
 *      always did; nothing here adds a query to a page.
 *
 * WHAT HAS TO CHANGE WHEN SOMETHING STARTS WRITING. Nothing in the application
 * writes to the catalogue yet, so a minute of staleness is the whole story.
 * The first things that do — an admin taking down a review (product-decisions
 * §4), a maker editing a listing or adding one (Phase 7) — must call
 * `revalidateTag('catalogue')` in the same action, or a removed review stays
 * on the tool page for up to a minute after somebody was told it was gone.
 * ======================================================================== */

/** How long a catalogue page's data may be served before it is refreshed. */
export const CATALOGUE_REVALIDATE_SECONDS = 60;

const CATALOGUE_CACHE = { revalidate: CATALOGUE_REVALIDATE_SECONDS, tags: ['catalogue'] };

const homeCached = unstable_cache(
  (topLimit: number, foundLimit: number) => runHome(getPool(), topLimit, foundLimit),
  ['catalogue:home:v1'],
  CATALOGUE_CACHE,
);

const browseCached = unstable_cache(
  (category: string | null, limit: number) => runBrowse(getPool(), category, limit),
  ['catalogue:browse:v1'],
  CATALOGUE_CACHE,
);

const topCached = unstable_cache(
  (category: string | null, ranking: TopRanking, limit: number) =>
    runTop(getPool(), category, ranking, limit),
  ['catalogue:top:v1'],
  CATALOGUE_CACHE,
);

/** Thrown inside the cached function so a missing tool is never stored. */
const NOT_PUBLISHED = 'foundit:tool-not-published';

const toolCached = unstable_cache(
  async (slug: string, reviewLimit: number) => {
    const tool = await runToolPage(getPool(), slug, reviewLimit);
    // unstable_cache stores what it returns and never what it throws, so an
    // invented slug leaves nothing behind (rule 2 above).
    if (!tool) throw Object.assign(new Error(NOT_PUBLISHED), { code: NOT_PUBLISHED });
    return tool;
  },
  ['catalogue:tool:v1'],
  CATALOGUE_CACHE,
);

/**
 * Every published tool's name, cached for a minute like the other catalogue
 * reads.
 *
 * One column of short strings, read once a minute rather than once a search,
 * and it never reaches a page: it goes to the guards in lib/reading.ts, which
 * refuse a model restatement that names one of our tools and refuse a "this is
 * not software" for a sentence that does. Both are the same rule from two
 * sides — the model may read the sentence and may not choose the answer.
 *
 * A failure here is an empty list, which switches those two checks off rather
 * than taking a search down. That is the safe direction for availability and
 * the unsafe one for the guard, so it is logged.
 */
const toolNamesCached = unstable_cache(
  () => runToolNames(getPool()),
  ['catalogue:tool-names:v1'],
  CATALOGUE_CACHE,
);

export async function getToolNames(): Promise<string[]> {
  try {
    return await toolNamesCached();
  } catch (error) {
    console.error(
      `the published tool names could not be read (${
        (error as { code?: string } | null)?.code ?? 'unknown'
      }); the reader's catalogue guards did not run for this search`,
    );
    return [];
  }
}

/** Everything the homepage draws. One round trip on a miss, none on a hit. */
export async function getHome(topLimit = 6, foundLimit = 3): Promise<HomeData> {
  return homeCached(topLimit, foundLimit);
}

/** Everything /browse draws, for all categories or one. One round trip on a miss. */
export async function getBrowse(
  category: string | null = null,
  limit = 12,
): Promise<BrowseData> {
  if (category === null) return browseCached(null, limit);
  // `slug` is citext: the database matches case-insensitively, so the key and
  // the guard must too, or "Money" is a second cache entry for the same page
  // and "MONEY" slips past the guard onto the uncached path on every request.
  const key = category.toLowerCase();
  const all = await browseCached(null, limit);
  if (!all.categories.some((c) => c.slug.toLowerCase() === key)) {
    // Not a category this catalogue has: answered, never stored.
    return runBrowse(getPool(), category, limit);
  }
  return browseCached(key, limit);
}

/** Everything /top draws, ranked by a real counter. One round trip on a miss. */
export async function getTop(
  category: string | null = null,
  ranking: TopRanking = 'likes',
  limit = 25,
): Promise<TopData> {
  if (category === null) return topCached(null, ranking, limit);
  const key = category.toLowerCase();
  const all = await topCached(null, ranking, limit);
  if (!all.categories.some((c) => c.slug.toLowerCase() === key)) {
    return runTop(getPool(), category, ranking, limit);
  }
  return topCached(key, ranking, limit);
}

/**
 * One tool page — the listing, its problems, its reviews and their bylines,
 * the ratings and three alternatives — or `null` if no published tool has that
 * slug. One round trip on a miss, however many sections the page has.
 */
export async function getToolPage(slug: string, reviewLimit = 10): Promise<ToolPageData | null> {
  try {
    // Lower-cased for the same reason as the category above: `tools.slug` is
    // citext, so every casing of a real slug is the same page and must not be
    // a cache entry of its own.
    return await toolCached(slug.toLowerCase(), reviewLimit);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === NOT_PUBLISHED) return null;
    if ((error as { message?: unknown } | null)?.message === NOT_PUBLISHED) return null;
    throw error;
  }
}

/**
 * Record that a search happened, for the aggregate quality panel.
 *
 * Fire and forget: call it after the response has gone out and do not await
 * it. It never makes the visitor wait, and a failure here must never turn a
 * good search into an error page.
 *
 * `SearchEvent` has no field that identifies a person, and the table it writes
 * to has no user column. Do not add one to either.
 */
export function logSearchEvent(event: SearchEvent): void {
  void runLogSearchEvent(getPool(), event).catch(() => {
    // Deliberately silent. The only thing worth logging here is the query
    // text, and the query text is exactly what must never be written to a log
    // line where it could be correlated with a request, an IP or a timestamp
    // that is already there.
  });
}
