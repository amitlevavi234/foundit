/**
 * The two statements the application is allowed to send, and the marshalling
 * around them — separated from the connection pool so both can be exercised
 * without a database.
 *
 * Nothing in here opens a socket. `lib/db.ts` binds these to the real pool and
 * is the only module the application imports.
 */
import type {
  BrowseData,
  CategorySummary,
  HomeData,
  MatchSource,
  Platform,
  PricingModel,
  ProblemCard,
  SearchConstraints,
  SearchDetailedResult,
  SearchEvent,
  ToolFlag,
  ToolPageData,
  ToolResult,
  ToolResultDetail,
  ToolReview,
  ToolSummary,
  TopData,
  TopRanking,
} from './types';

/**
 * One statement, one round trip. Every filter, the ranking and the limit are
 * arguments to the function; none of them is applied in JavaScript.
 *
 * Named arguments so that adding a parameter to the SQL function in a later
 * migration cannot silently shift the meaning of a positional one.
 */
export const SEARCH_SQL = `
  select tool_id, slug, name, summary, pricing, score, match_source
    from public.search_tools(
      p_query     => $1::text,
      p_pricing   => $2::pricing_model[],
      p_platforms => $3::platform[],
      p_flags     => $4::tool_flag[],
      p_languages => $5::text[],
      p_limit     => $6::int
    )`;

/**
 * Takes no user id, returns no row id. Both are deliberate: an id handed back
 * to the application is a correlation handle, and this table exists precisely
 * so that search text can never be joined to a person.
 */
export const LOG_SEARCH_EVENT_SQL = `
  select public.log_search_event(
    p_query          => $1::text,
    p_result_count   => $2::int,
    p_top_score      => $3::real,
    p_had_good_match => $4::boolean,
    p_latency_ms     => $5::int,
    p_match_judged   => $6::boolean
  )`;

/**
 * The same call, plus which tools came back.
 *
 * Also returns no row id, and that is the whole reason it exists as a separate
 * function in 0017 rather than as `log_search_event` handing the id over:
 * writing the child rows needs the parent's id, and the id is a correlation
 * handle. So the insert and the join happen inside one SECURITY DEFINER
 * function and nothing comes out.
 *
 * The ranks are NOT a parameter. They come from `with ordinality` over this
 * array inside the function, so a caller cannot record an order that disagrees
 * with the one it reported.
 */
export const LOG_SEARCH_EVENT_TOOLS_SQL = `
  select public.log_search_event_tools(
    p_query          => $1::text,
    p_result_count   => $2::int,
    p_top_score      => $3::real,
    p_had_good_match => $4::boolean,
    p_latency_ms     => $5::int,
    p_match_judged   => $6::boolean,
    p_tool_ids       => $7::bigint[]
  )`;

/** The database's own ceiling, and the application's. All three layers agree. */
export const MAX_QUERY_LENGTH = 200;

/** SQLSTATE string_data_right_truncation, raised by public.search_tools. */
export const SQLSTATE_QUERY_TOO_LONG = '22001';

/**
 * A query longer than the cap. Carries the length and never the text: this is
 * the endpoint that collects health, money and relationship trouble, and an
 * error string ends up in a log.
 */
export class QueryTooLongError extends Error {
  readonly status = 400;
  readonly length: number;
  readonly maximum = MAX_QUERY_LENGTH;

  constructor(length: number) {
    super(`Search query is ${length} characters; the maximum is ${MAX_QUERY_LENGTH}.`);
    this.name = 'QueryTooLongError';
    this.length = length;
  }
}

/** The narrow slice of `pg.Pool` these functions need. */
export interface Executor {
  query<R>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
}

interface SearchRow {
  tool_id: string | number;
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  score: number | string;
  match_source: MatchSource;
}

/** `[]` means "nothing was asked for", exactly as the SQL function reads it. */
function orNull<T>(values: T[] | null | undefined): T[] | null {
  return values && values.length > 0 ? values : null;
}

export function searchParams(
  query: string,
  constraints: SearchConstraints = {},
  limit = 20,
): unknown[] {
  return [
    query,
    orNull(constraints.pricing),
    orNull(constraints.platforms),
    orNull(constraints.flags),
    orNull(constraints.languages),
    limit,
  ];
}

function isTooLong(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === SQLSTATE_QUERY_TOO_LONG
  );
}

/**
 * Run one search. Exactly one call to the executor, whatever the constraints
 * are — there is no second query to hydrate rows, and there never may be.
 */
export async function runSearch(
  exec: Executor,
  query: string,
  constraints: SearchConstraints = {},
  limit = 20,
): Promise<ToolResult[]> {
  const trimmed = query.trim();

  // Reject before the round trip as well as after it. The database is the
  // boundary and still enforces this; catching it here saves the trip and
  // keeps the error identical either way.
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new QueryTooLongError(trimmed.length);
  }

  let rows: SearchRow[];
  try {
    ({ rows } = await exec.query<SearchRow>(SEARCH_SQL, searchParams(trimmed, constraints, limit)));
  } catch (err) {
    if (isTooLong(err)) {
      throw new QueryTooLongError(trimmed.length);
    }
    throw err;
  }

  return rows.map((row) => ({
    toolId: String(row.tool_id),
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    pricing: row.pricing,
    score: Number(row.score),
    matchSource: row.match_source,
  }));
}

export function logSearchEventParams(event: SearchEvent): unknown[] {
  return [
    event.query,
    event.resultCount,
    event.topScore ?? null,
    // "Good" is only meaningful where something judged it. The database says
    // the same thing again — `had_good_match and match_judged` on the way in,
    // and a CHECK that refuses the pair — but a caller that gets this wrong
    // should not be relying on being caught.
    (event.hadGoodMatch ?? false) && (event.matchJudged ?? false),
    event.latencyMs ?? null,
    event.matchJudged ?? false,
  ];
}

/**
 * Record that a search happened. One statement, and the caller is expected not
 * to await it: this runs after the response has gone out.
 */
export async function runLogSearchEvent(exec: Executor, event: SearchEvent): Promise<void> {
  // One statement either way. With tool ids it is the 0017 function, which
  // writes the event AND the join; without them it is the original, which is
  // still what eval/run.mjs and every test drive.
  const ids = event.toolIds ?? [];
  if (ids.length === 0) {
    await exec.query(LOG_SEARCH_EVENT_SQL, logSearchEventParams(event));
    return;
  }
  await exec.query(LOG_SEARCH_EVENT_TOOLS_SQL, [
    ...logSearchEventParams(event),
    // Capped here as well as in the function: 200 is the most ranks one page
    // could honestly have, and `search_tools` is clamped to 50.
    ids.slice(0, 200),
  ]);
}

/* ===========================================================================
 * The screens' statements.
 *
 * One statement per screen, and one round trip for each. Everything a screen
 * draws is assembled by PostgreSQL — the ranked list, the counters, the
 * categories, the reviews — and arrives as one row. There is no second query
 * to hydrate a list, and there may never be one: a list plus a row per item is
 * the shape this file exists to make impossible.
 *
 * `search_tools` is still the only thing that filters, ranks or limits a
 * search. The results statement below wraps it and joins the columns a card
 * draws onto the rows it returned; the ORDER BY repeats the function's own
 * total order (score, then rating, then likes, then id) rather than inventing
 * one, so the decorated rows come back in exactly the sequence it chose.
 * ======================================================================== */

/**
 * The results screen's search.
 *
 * $1..$5 are `search_tools`' own arguments. $6 is the window asked of it, $7
 * an optional category to narrow to — categories are not a parameter of
 * `search_tools` and cannot become one from here, so the narrowing happens in
 * this statement, over a wider window, and never in JavaScript — $8 the
 * number of rows the screen wants, and $9 the query vector when the caller
 * already has one. $9 null means "read the cache", which is what makes a
 * repeated search a single round trip.
 *
 * `q` rebuilds the any-of tsquery that 0002_search.sql retrieves with, so the
 * problem statement shown under a result is the one that actually matched the
 * sentence rather than whichever happened to be first. It goes through
 * `quote_literal` over lexemes taken from `to_tsvector`, exactly as the
 * migration does, so there is nothing in it a person could inject.
 *
 * The shape at the bottom — one row of `flag`, LEFT JOINed to the results —
 * is not decoration. `embedding_missing` has to survive a search that returned
 * NOTHING, because that is the case where fetching a vector matters most: a
 * sentence that shares no vocabulary with the catalogue is exactly what the
 * vector leg exists for, and a per-row flag would be absent precisely there.
 * So the flag anchors the statement and the rows hang off it. A search with no
 * results comes back as a single row whose tool_id is null, which
 * `runSearchDetailed` drops.
 *
 * The flag is `search_tools`' OWN answer, read off the rows it returned, not a
 * second question put to the cache. It used to be the second question, and
 * that was two chances to disagree: a vector stored by another request between
 * the two reads would have made the search and the flag describe different
 * states of the world, and the page would have embedded a sentence that was
 * already cached. `coalesce` evaluates left to right and stops, so
 * `query_embedding_missing` is reached only when `bool_or` had no rows to
 * aggregate — a search that matched nothing, where there is no answer to read.
 */
export const SEARCH_DETAILED_SQL = `
  with q as (
    select coalesce(
             (select string_agg(quote_literal(lexeme), ' | ')
                from unnest(to_tsvector('english', coalesce($1::text, ''))))::tsquery,
             websearch_to_tsquery('english', coalesce($1::text, ''))
           ) as tsq
  ),
  r as (
    select *
      from public.search_tools(
        p_query     => $1::text,
        p_pricing   => $2::pricing_model[],
        p_platforms => $3::platform[],
        p_flags     => $4::tool_flag[],
        p_languages => $5::text[],
        p_limit     => $6::int,
        p_embedding => $9::halfvec
      )
  ),
  decorated as (
    select r.tool_id, r.slug, r.name, r.summary, r.pricing::text as pricing,
           r.score, r.match_source,
           t.url, t.platforms::text[] as platforms, t.languages, t.flags::text[] as flags,
           t.rating_avg, t.rating_count, t.like_count, t.save_count,
           c.slug as category_slug, c.name as category_name,
           p.statement as matched_problem, p.strength as matched_strength,
           -- Every statement this listing carries, for the reranker (Phase 5),
           -- which is shown each candidate's own text and nothing else. It
           -- rides on this round trip rather than costing one query per
           -- candidate, which is the shape this file exists to prevent.
           coalesce(
             (select array_agg(tp2.statement order by tp2.sort_order, tp2.id)
                from public.tool_problems tp2
               where tp2.tool_id = t.id),
             '{}'::text[]
           ) as statements
      from r
      join public.tools t on t.id = r.tool_id
      left join public.tool_categories tc on tc.tool_id = t.id and tc.is_primary
      left join public.categories c on c.id = tc.category_id
      left join lateral (
        select tp.statement,
               ts_rank_cd(tp.search_doc, (select tsq from q), 1) as strength
          from public.tool_problems tp
         where tp.tool_id = t.id
         order by strength desc, tp.sort_order, tp.id
         limit 1
      ) p on true
     where $7::text is null or c.slug = $7::citext
     order by r.score desc, t.rating_avg desc nulls last, t.like_count desc, t.id
     limit $8::int
  ),
  flag as (
    select coalesce(
             bool_or(r.embedding_missing),
             public.query_embedding_missing($1::text, $9::halfvec)
           ) as embedding_missing
      from r
  )
  select f.embedding_missing, d.*
    from flag f
    left join decorated d on true
   order by d.score desc nulls last, d.rating_avg desc nulls last,
            d.like_count desc, d.tool_id`;

/**
 * Keep the vector for this sentence, so the next person who types it costs
 * nothing. Called after the response has gone out and never awaited.
 *
 * The sentence goes in raw and the function normalises it, so no caller can
 * invent a cache key. `public.query_embeddings` has no user column, no session
 * column and no IP column, and this statement has no argument that could carry
 * one — the same shape, and the same reason, as `log_search_event`.
 */
export const STORE_QUERY_EMBEDDING_SQL = `
  select public.store_query_embedding(
    p_query     => $1::text,
    p_embedding => $2::halfvec,
    p_model     => $3::text
  )`;

/** Mark a cached vector as used, for eviction. One column, one row, no reply. */
export const TOUCH_QUERY_EMBEDDING_SQL = `
  select public.touch_query_embedding(p_query => $1::text)`;

/* ===========================================================================
 * Phase 4: the sentence reader's cache.
 * ======================================================================== */

/**
 * The one round trip a search makes before it searches.
 *
 * Two primary-key lookups in one statement, and they answer the two questions
 * that decide what the search has to pay for: has this sentence been read
 * before, and is there a vector for the text we are about to rank on. Both come
 * back before either paid call is made, which is what lets the two calls start
 * together instead of one after the other.
 *
 * `$1` is the sentence as typed — the reading is keyed on the whole question.
 * `$2` is the residual the rules left, which is what gets embedded and searched.
 * They are different strings on purpose and the two caches are keyed on the one
 * each belongs to.
 *
 * It costs one round trip that Phase 3 did not spend. The alternative was to
 * ask the search itself, which cannot work: the search's own constraints depend
 * on the reading, so a search that also returned the reading would have run
 * with the wrong constraints. One cheap statement, and then one search.
 */
export const PREFETCH_SQL = `
  select public.query_reading($1::text)                as reading,
         public.query_embedding_missing($2::text)      as embedding_missing`;

/**
 * Keep the reading for this sentence, so the next person who types it costs
 * nothing. Called after the response has gone out and never awaited.
 *
 * The sentence goes in raw and the function normalises it, so no caller can
 * invent a cache key. `public.query_readings` has no user column, no session
 * column and no IP column, and this statement has no argument that could carry
 * one — the same shape, and the same reason, as `log_search_event` and
 * `store_query_embedding`.
 */
export const STORE_QUERY_READING_SQL = `
  select public.store_query_reading(
    p_query   => $1::text,
    p_reading => $2::jsonb,
    p_model   => $3::text
  )`;

/** Mark a cached reading as used, for eviction. Fire and forget. */
export const TOUCH_QUERY_READING_SQL = `
  select public.touch_query_reading(p_query => $1::text)`;

/* ===========================================================================
 * Phase 5: the reranker's cache.
 *
 * The same three statements as the reader's cache, over a table built to the
 * same pattern, with one difference: the key is a PAIR. A judgement is about a
 * sentence AND a candidate list, and serving one sentence's answer over a
 * different list would reorder a page against a judgement of tools that are not
 * on it. The hash is computed by lib/rerank.ts from the slugs the search
 * returned, because the caller is the only thing that knows which candidates
 * survived the constraint filter.
 * ======================================================================== */

/** The judgement recorded for this sentence over this candidate set, or null. */
export const QUERY_RERANK_SQL = `
  select public.query_rerank($1::text, $2::text) as judgement`;

/**
 * Keep the judgement, so the next person who types this sentence and gets these
 * candidates costs nothing. Called after the response has gone out and never
 * awaited.
 *
 * The sentence goes in raw and the function normalises it, so no caller can
 * invent half a key. `public.query_reranks` has no user column, no session
 * column and no IP column, and this statement has no argument that could carry
 * one — the same shape, and the same reason, as `log_search_event`,
 * `store_query_embedding` and `store_query_reading`.
 */
export const STORE_QUERY_RERANK_SQL = `
  select public.store_query_rerank(
    p_query     => $1::text,
    p_hash      => $2::text,
    p_judgement => $3::jsonb,
    p_model     => $4::text
  )`;

/** Mark a cached judgement as used, for eviction. Fire and forget. */
export const TOUCH_QUERY_RERANK_SQL = `
  select public.touch_query_rerank(p_query => $1::text, p_hash => $2::text)`;

/** Read one cached judgement. Unvalidated — the caller checks it. */
export async function runQueryRerank(
  exec: Executor,
  query: string,
  hash: string,
): Promise<unknown> {
  const { rows } = await exec.query<{ judgement: unknown }>(QUERY_RERANK_SQL, [query.trim(), hash]);
  return rows[0]?.judgement ?? null;
}

/** Cache one judgement. Fire and forget, never awaited. */
export async function runStoreQueryRerank(
  exec: Executor,
  query: string,
  hash: string,
  judgement: unknown,
  model: string,
): Promise<void> {
  await exec.query(STORE_QUERY_RERANK_SQL, [query, hash, JSON.stringify(judgement), model]);
}

/** Record that a cached judgement was used. Fire and forget, same as above. */
export async function runTouchQueryRerank(
  exec: Executor,
  query: string,
  hash: string,
): Promise<void> {
  await exec.query(TOUCH_QUERY_RERANK_SQL, [query, hash]);
}

/**
 * Every published tool's name, and nothing else about it.
 *
 * One column, a few hundred short strings, cached for a minute with the other
 * catalogue reads. It exists for one guard: the model's English restatement is
 * EMBEDDED, so it reaches the ranker, and an adversarial review put
 * "Splitwise Tricount Settle Up Splid Tabsplit" in that field and watched it
 * through. A restatement naming a tool is the model writing the query rather
 * than reading the sentence.
 *
 * It also corroborates a refusal: somebody typing a tool's name is not asking
 * for a plumber, whatever a broken model says.
 */
export const TOOL_NAMES_SQL = `
  select name from public.tools where status = 'published' order by name`;

/** The names, for the guards in lib/reading.ts. Never a row, never an id. */
export async function runToolNames(exec: Executor): Promise<string[]> {
  const { rows } = await exec.query<{ name: string }>(TOOL_NAMES_SQL, []);
  return rows.map((row) => String(row.name));
}

/** What one prefetch found. Neither field says anything about anybody. */
export interface Prefetch {
  /** The stored reading, unvalidated — the caller checks it. Null on a miss. */
  reading: unknown;
  /** True when the search would have to fetch a vector. */
  embeddingMissing: boolean;
}

/**
 * Ask both caches in one statement.
 *
 * A failure here is not an error: it means both caches missed, which is the
 * slow path and a perfectly good page. The caller gets `{ reading: null,
 * embeddingMissing: true }` and carries on.
 */
export async function runPrefetch(
  exec: Executor,
  query: string,
  searchText: string,
): Promise<Prefetch> {
  const trimmed = query.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new QueryTooLongError(trimmed.length);
  }
  const { rows } = await exec.query<{ reading: unknown; embedding_missing: boolean | null }>(
    PREFETCH_SQL,
    [trimmed, searchText],
  );
  return {
    reading: rows[0]?.reading ?? null,
    embeddingMissing: rows[0]?.embedding_missing !== false,
  };
}

/** Cache the reading for one sentence. Fire and forget, never awaited. */
export async function runStoreQueryReading(
  exec: Executor,
  query: string,
  reading: unknown,
  model: string,
): Promise<void> {
  await exec.query(STORE_QUERY_READING_SQL, [query, JSON.stringify(reading), model]);
}

/** Record that a cached reading was used. Fire and forget, same as above. */
export async function runTouchQueryReading(exec: Executor, query: string): Promise<void> {
  await exec.query(TOUCH_QUERY_READING_SQL, [query]);
}

/** The homepage: the ranked strip, the problem cards, and the two totals. */
export const HOME_SQL = `
  with top_tools as (
    select t.id, t.slug, t.name, t.summary, t.pricing::text as pricing,
           t.like_count, t.save_count, t.open_count, t.rating_avg, t.rating_count,
           c.slug as category_slug, c.name as category_name
      from public.tools t
      left join public.tool_categories tc on tc.tool_id = t.id and tc.is_primary
      left join public.categories c on c.id = tc.category_id
     where t.status = 'published'
     order by t.like_count desc, t.save_count desc, t.rating_avg desc nulls last, t.id
     limit $1::int
  ),
  found as (
    select distinct on (t.id)
           tp.statement, t.slug, t.name, t.summary, t.pricing::text as pricing,
           t.platforms::text[] as platforms, t.like_count, t.published_at,
           c.slug as category_slug, c.name as category_name
      from public.tool_problems tp
      join public.tools t on t.id = tp.tool_id and t.status = 'published'
      left join public.tool_categories tc on tc.tool_id = t.id and tc.is_primary
      left join public.categories c on c.id = tc.category_id
     order by t.id, tp.sort_order, tp.id
  ),
  found_recent as (
    select * from found
     order by published_at desc nulls last, like_count desc, name
     limit $2::int
  )
  select
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.like_count desc, x.save_count desc,
                               x.rating_avg desc nulls last, x.id), '[]'::jsonb)
       from top_tools x) as top_tools,
    (select coalesce(jsonb_agg(to_jsonb(y) order by y.published_at desc, y.like_count desc,
                               y.name), '[]'::jsonb)
       from found_recent y) as found,
    (select count(*) from public.tools where status = 'published') as tool_count,
    (select count(*) from public.tool_problems tp
       join public.tools t on t.id = tp.tool_id and t.status = 'published') as problem_count`;

/**
 * One tool page: the listing, its categories, its problem statements, its
 * reviews with their bylines, the rating histogram, the per-aspect averages,
 * and three alternatives from the same category. Eight aggregates, one trip.
 *
 * Bylines come from `public.profiles_public`, never `public.profiles` — the
 * table itself is the person's own and an admin's, and reading it here would
 * return nothing to a stranger (0003_hardening.sql §2).
 */
export const TOOL_SQL = `
  with t as (
    select id, slug, name, url, summary, pricing::text as pricing,
           platforms::text[] as platforms, languages, flags::text[] as flags,
           claimable, made_by_owner, owner_id, submitted_by,
           like_count, save_count, open_count, review_count,
           rating_avg, rating_count, created_at, updated_at, published_at
      from public.tools
     where slug = $1::citext and status = 'published'
  ),
  cats as (
    select c.slug, c.name, tc.is_primary
      from public.tool_categories tc
      join public.categories c on c.id = tc.category_id
     where tc.tool_id = (select id from t)
  ),
  probs as (
    select tp.statement, tp.sort_order, tp.id
      from public.tool_problems tp
     where tp.tool_id = (select id from t)
  ),
  revs as (
    select r.id, r.rating, r.body, r.created_at,
           r.solved_problem, r.ease_of_use, r.worth_the_price,
           p.handle, p.display_name
      from public.reviews r
      left join public.profiles_public p on p.id = r.author_id
     where r.tool_id = (select id from t) and r.deleted_at is null
     order by r.created_at desc, r.id desc
     limit $2::int
  ),
  hist as (
    select r.rating, count(*) as n
      from public.reviews r
     where r.tool_id = (select id from t) and r.deleted_at is null
     group by r.rating
  ),
  aspects as (
    select round(avg(case when r.solved_problem then 1 else 0 end)::numeric * 100) as solved_pct,
           round(avg(r.ease_of_use)::numeric, 1) as ease,
           round(avg(r.worth_the_price)::numeric, 1) as worth,
           count(*) filter (where r.solved_problem is not null) as solved_count
      from public.reviews r
     where r.tool_id = (select id from t) and r.deleted_at is null
  ),
  alts as (
    select t2.slug, t2.name, t2.summary, t2.pricing::text as pricing,
           t2.rating_avg, t2.like_count, t2.id
      from public.tools t2
      join public.tool_categories tc2 on tc2.tool_id = t2.id and tc2.is_primary
     where tc2.category_id = (select tc.category_id from public.tool_categories tc
                               where tc.tool_id = (select id from t) and tc.is_primary)
       and t2.id <> (select id from t)
       and t2.status = 'published'
     order by t2.rating_avg desc nulls last, t2.like_count desc, t2.id
     limit 3
  ),
  keeper as (
    select p.handle, p.display_name
      from public.profiles_public p
     where p.id = coalesce((select owner_id from t), (select submitted_by from t))
  )
  select (select to_jsonb(x) from t x) as tool,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.is_primary desc, x.name),
                          '[]'::jsonb) from cats x) as categories,
         (select coalesce(jsonb_agg(x.statement order by x.sort_order, x.id),
                          '[]'::jsonb) from probs x) as problems,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc),
                          '[]'::jsonb) from revs x) as reviews,
         (select coalesce(jsonb_object_agg(x.rating, x.n), '{}'::jsonb) from hist x) as histogram,
         (select to_jsonb(x) from aspects x) as aspects,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.rating_avg desc nulls last,
                                    x.like_count desc, x.id), '[]'::jsonb)
            from alts x) as alternatives,
         (select to_jsonb(x) from keeper x) as keeper,
         -- owner_id ALONE. The "or submitted_by is not null" this used to carry
         -- was wrong in a way nothing could see until Phase 7: every one of the
         -- 224 seeded listings has submitted_by set to the admin that ran
         -- db/seed/dev_seed.sql, so "has a keeper" was true for the whole
         -- catalogue and the tool page's Unclaimed pill, its "Nobody yet" fact
         -- and its whole claim panel were unreachable on every row. What the
         -- page is asking is whether a person looks after this, and the column
         -- that answers that is owner_id.
         --
         -- (No backticks in this comment, deliberately: it lives inside a
         -- JavaScript template literal, and the first draft of it ended the
         -- string.)
         (select owner_id is not null from t) as has_keeper
   where exists (select 1 from t)`;

/**
 * /browse: every category that has tools in it, and a page of problem
 * statements — at most one per tool, so twelve cards are twelve different
 * tools rather than one thorough listing four times over.
 */
export const BROWSE_SQL = `
  with cats as (
    select c.slug, c.name, c.sort_order, count(t.id) as tool_count
      from public.categories c
      left join public.tool_categories tc on tc.category_id = c.id
      left join public.tools t on t.id = tc.tool_id and t.status = 'published'
     group by c.slug, c.name, c.sort_order
  ),
  matched as (
    select distinct on (t.id)
           tp.statement, t.id, t.slug, t.name, t.summary, t.pricing::text as pricing,
           t.platforms::text[] as platforms, t.like_count, t.rating_avg,
           c.slug as category_slug, c.name as category_name
      from public.tool_problems tp
      join public.tools t on t.id = tp.tool_id and t.status = 'published'
      left join public.tool_categories tc on tc.tool_id = t.id and tc.is_primary
      left join public.categories c on c.id = tc.category_id
     where $1::text is null or c.slug = $1::citext
     order by t.id, tp.sort_order, tp.id
  ),
  page as (
    select * from matched
     order by like_count desc, rating_avg desc nulls last, name
     limit $2::int
  )
  select (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order), '[]'::jsonb)
            from cats x where x.tool_count > 0) as categories,
         -- The sidebar's "where the catalogue is deepest": the same category
         -- rows in a different order. It is a second ordering of a list the
         -- statement already has, which is exactly the kind of thing that gets
         -- done in JavaScript because it is small — and then the next one is
         -- done in JavaScript because the last one was. It is an ORDER BY; it
         -- belongs here, and it costs no extra round trip.
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.tool_count desc, x.name),
                          '[]'::jsonb)
            from (select * from cats where tool_count > 0
                   order by tool_count desc, name limit 4) x) as deepest,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.like_count desc,
                                    x.rating_avg desc nulls last, x.name), '[]'::jsonb)
            from page x) as problems,
         (select count(*) from public.tools where status = 'published') as tool_count,
         (select count(*) from public.tool_problems tp
            join public.tools t on t.id = tp.tool_id and t.status = 'published')
           as problem_count,
         (select count(*) from matched) as matched_count`;

/**
 * /top: the ranked table and the category pills above it.
 *
 * The ranking is the counters on `public.tools` and nothing else — likes or
 * saves, then the other of the two, then rating. No editorial thumb, and
 * nothing that could be bought.
 */
export const TOP_SQL = `
  with ranked as (
    select t.id, t.slug, t.name, t.summary, t.pricing::text as pricing,
           t.like_count, t.save_count, t.open_count, t.rating_avg, t.rating_count,
           c.slug as category_slug, c.name as category_name,
           row_number() over (
             order by case when $2::text = 'saves' then t.save_count else t.like_count end desc,
                      case when $2::text = 'saves' then t.like_count else t.save_count end desc,
                      t.rating_avg desc nulls last, t.rating_count desc, t.id
           ) as rank
      from public.tools t
      left join public.tool_categories tc on tc.tool_id = t.id and tc.is_primary
      left join public.categories c on c.id = tc.category_id
     where t.status = 'published'
       and ($1::text is null or c.slug = $1::citext)
  ),
  cats as (
    select c.slug, c.name, c.sort_order, count(t.id) as tool_count
      from public.categories c
      left join public.tool_categories tc on tc.category_id = c.id and tc.is_primary
      left join public.tools t on t.id = tc.tool_id and t.status = 'published'
     group by c.slug, c.name, c.sort_order
  )
  select (select coalesce(jsonb_agg(to_jsonb(x) order by x.rank), '[]'::jsonb)
            from (select * from ranked order by rank limit $3::int) x) as tools,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order), '[]'::jsonb)
            from cats x where x.tool_count > 0) as categories,
         (select count(*) from ranked) as total`;

/* --- marshalling ---------------------------------------------------------
 * Postgres hands back snake_case, and strings for anything it will not risk
 * rounding. These turn one row into the shape a component takes, and do no
 * sorting, filtering or arithmetic of their own.
 */

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

interface CategoryRow {
  slug: string;
  name: string;
  sort_order: number | string;
  tool_count: number | string;
}

function toCategory(row: CategoryRow): CategorySummary {
  return {
    slug: row.slug,
    name: row.name,
    sortOrder: num(row.sort_order),
    toolCount: num(row.tool_count),
  };
}

interface ToolSummaryRow {
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  like_count: number | string;
  save_count: number | string;
  open_count: number | string;
  rating_avg: number | string | null;
  rating_count: number | string;
  category_slug: string | null;
  category_name: string | null;
}

function toToolSummary(row: ToolSummaryRow): ToolSummary {
  return {
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    pricing: row.pricing,
    likeCount: num(row.like_count),
    saveCount: num(row.save_count),
    openCount: num(row.open_count),
    ratingAvg: numOrNull(row.rating_avg),
    ratingCount: num(row.rating_count),
    categorySlug: row.category_slug ?? null,
    categoryName: row.category_name ?? null,
  };
}

interface ProblemCardRow {
  statement: string;
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  platforms: Platform[] | null;
  like_count: number | string;
  category_slug: string | null;
  category_name: string | null;
}

function toProblemCard(row: ProblemCardRow): ProblemCard {
  return {
    statement: row.statement,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    pricing: row.pricing,
    platforms: row.platforms ?? [],
    likeCount: num(row.like_count),
    categorySlug: row.category_slug ?? null,
    categoryName: row.category_name ?? null,
  };
}

/**
 * One row of `SEARCH_DETAILED_SQL`. Every result column is nullable because a
 * search that matched nothing still returns one row — the flag's row, with the
 * results side of the LEFT JOIN empty.
 */
interface DetailRow {
  embedding_missing: boolean | null;
  tool_id: string | number | null;
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  score: number | string;
  match_source: MatchSource;
  url: string;
  platforms: Platform[] | null;
  languages: string[] | null;
  flags: ToolFlag[] | null;
  rating_avg: number | string | null;
  rating_count: number | string;
  like_count: number | string;
  save_count: number | string;
  category_slug: string | null;
  category_name: string | null;
  matched_problem: string | null;
  matched_strength: number | string | null;
  statements: string[] | null;
}

/**
 * The window asked of `search_tools` when a category narrowing is in play.
 * The function knows nothing about categories, so the narrowing happens in the
 * wrapping statement; asking for the function's own maximum first means the
 * cut is made on a full ranked list rather than on a truncated one.
 */
export const CATEGORY_WINDOW = 50;

export function searchDetailedParams(
  query: string,
  constraints: SearchConstraints = {},
  limit = 12,
  category: string | null = null,
  embedding: string | null = null,
): unknown[] {
  const [q, pricing, platforms, flags, languages] = searchParams(query, constraints, limit);
  return [
    q,
    pricing,
    platforms,
    flags,
    languages,
    category ? CATEGORY_WINDOW : limit,
    category,
    limit,
    embedding,
  ];
}

/**
 * The results screen's search: one round trip, the ranking still entirely
 * `search_tools`', and every column a card draws already on the row.
 *
 * `embedding` is the query vector when the caller already has one, as the
 * `halfvec` literal `lib/embeddings.ts` produced. Passing null does not mean
 * "search without vectors" — it means "look in the cache", and the returned
 * `embeddingMissing` says whether that found anything. A caller that gets true
 * back embeds, stores, and calls this once more with the vector; a caller that
 * gets false has the final answer and has spent one round trip on it.
 */
export async function runSearchDetailed(
  exec: Executor,
  query: string,
  constraints: SearchConstraints = {},
  limit = 12,
  category: string | null = null,
  embedding: string | null = null,
): Promise<SearchDetailedResult> {
  const trimmed = query.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new QueryTooLongError(trimmed.length);
  }

  let rows: DetailRow[];
  try {
    ({ rows } = await exec.query<DetailRow>(
      SEARCH_DETAILED_SQL,
      searchDetailedParams(trimmed, constraints, limit, category, embedding),
    ));
  } catch (err) {
    if (isTooLong(err)) {
      throw new QueryTooLongError(trimmed.length);
    }
    throw err;
  }

  const embeddingMissing = Boolean(rows[0]?.embedding_missing);
  // A search that matched nothing still returns the flag's row. It carries no
  // tool, so it is not a result.
  const results: ToolResultDetail[] = rows
    .filter((row) => row.tool_id !== null && row.tool_id !== undefined)
    .map((row) => ({
      toolId: String(row.tool_id),
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      pricing: row.pricing,
      score: Number(row.score),
      matchSource: row.match_source,
      url: row.url,
      platforms: row.platforms ?? [],
      languages: row.languages ?? [],
      flags: row.flags ?? [],
      ratingAvg: numOrNull(row.rating_avg),
      ratingCount: num(row.rating_count),
      likeCount: num(row.like_count),
      saveCount: num(row.save_count),
      categorySlug: row.category_slug ?? null,
      categoryName: row.category_name ?? null,
      matchedProblem: row.matched_problem,
      matchedStrength: num(row.matched_strength),
      statements: row.statements ?? [],
    }));

  return { results, embeddingMissing };
}

/**
 * Cache the vector for one sentence. Fire and forget: the caller must not
 * await it, and a failure here must never turn a good search into an error.
 *
 * There is no argument that identifies anybody, and there is no fourth
 * parameter to add one to.
 */
export async function runStoreQueryEmbedding(
  exec: Executor,
  query: string,
  vector: string,
  model: string,
): Promise<void> {
  await exec.query(STORE_QUERY_EMBEDDING_SQL, [query, vector, model]);
}

/** Record that a cached vector was used. Fire and forget, same as above. */
export async function runTouchQueryEmbedding(exec: Executor, query: string): Promise<void> {
  await exec.query(TOUCH_QUERY_EMBEDDING_SQL, [query]);
}

export async function runHome(exec: Executor, topLimit = 6, foundLimit = 3): Promise<HomeData> {
  const { rows } = await exec.query<{
    top_tools: ToolSummaryRow[];
    found: ProblemCardRow[];
    tool_count: string | number;
    problem_count: string | number;
  }>(HOME_SQL, [topLimit, foundLimit]);

  const row = rows[0];
  return {
    topTools: (row?.top_tools ?? []).map(toToolSummary),
    found: (row?.found ?? []).map(toProblemCard),
    toolCount: num(row?.tool_count),
    problemCount: num(row?.problem_count),
  };
}

export async function runBrowse(
  exec: Executor,
  category: string | null = null,
  limit = 12,
): Promise<BrowseData> {
  const { rows } = await exec.query<{
    categories: CategoryRow[];
    deepest: CategoryRow[];
    problems: ProblemCardRow[];
    tool_count: string | number;
    problem_count: string | number;
    matched_count: string | number;
  }>(BROWSE_SQL, [category, limit]);

  const row = rows[0];
  return {
    categories: (row?.categories ?? []).map(toCategory),
    deepest: (row?.deepest ?? []).map(toCategory),
    problems: (row?.problems ?? []).map(toProblemCard),
    toolCount: num(row?.tool_count),
    problemCount: num(row?.problem_count),
    matchedCount: num(row?.matched_count),
  };
}

export async function runTop(
  exec: Executor,
  category: string | null = null,
  ranking: TopRanking = 'likes',
  limit = 25,
): Promise<TopData> {
  const { rows } = await exec.query<{
    tools: Array<ToolSummaryRow & { rank: number | string }>;
    categories: CategoryRow[];
    total: string | number;
  }>(TOP_SQL, [category, ranking, limit]);

  const row = rows[0];
  return {
    tools: (row?.tools ?? []).map((tool) => ({ ...toToolSummary(tool), rank: num(tool.rank) })),
    categories: (row?.categories ?? []).map(toCategory),
    total: num(row?.total),
  };
}

interface ToolPageRow {
  tool: {
    slug: string;
    name: string;
    url: string;
    summary: string;
    pricing: PricingModel;
    platforms: Platform[] | null;
    languages: string[] | null;
    flags: ToolFlag[] | null;
    claimable: boolean;
    made_by_owner: boolean;
    like_count: number | string;
    save_count: number | string;
    open_count: number | string;
    review_count: number | string;
    rating_avg: number | string | null;
    rating_count: number | string;
    created_at: string;
    updated_at: string;
    published_at: string | null;
  } | null;
  categories: Array<{ slug: string; name: string; is_primary: boolean }> | null;
  problems: string[] | null;
  reviews: Array<{
    id: string | number;
    rating: number | string;
    body: string | null;
    created_at: string;
    solved_problem: boolean | null;
    ease_of_use: number | string | null;
    worth_the_price: number | string | null;
    handle: string | null;
    display_name: string | null;
  }> | null;
  histogram: Record<string, number> | null;
  aspects: {
    solved_pct: number | string | null;
    ease: number | string | null;
    worth: number | string | null;
    solved_count: number | string;
  } | null;
  alternatives: Array<{
    slug: string;
    name: string;
    summary: string | null;
    pricing: PricingModel;
    rating_avg: number | string | null;
    like_count: number | string;
  }> | null;
  keeper: { handle: string | null; display_name: string | null } | null;
  has_keeper: boolean | null;
}

function toReview(row: NonNullable<ToolPageRow['reviews']>[number]): ToolReview {
  return {
    id: String(row.id),
    rating: num(row.rating),
    body: row.body,
    createdAt: row.created_at,
    solvedProblem: row.solved_problem,
    easeOfUse: numOrNull(row.ease_of_use),
    worthThePrice: numOrNull(row.worth_the_price),
    handle: row.handle,
    displayName: row.display_name,
  };
}

/** One tool page, or `null` when there is no published tool with that slug. */
export async function runToolPage(
  exec: Executor,
  slug: string,
  reviewLimit = 10,
): Promise<ToolPageData | null> {
  const { rows } = await exec.query<ToolPageRow>(TOOL_SQL, [slug, reviewLimit]);
  const row = rows[0];
  if (!row || !row.tool) return null;

  const t = row.tool;
  const aspects = row.aspects;

  return {
    slug: t.slug,
    name: t.name,
    url: t.url,
    summary: t.summary,
    pricing: t.pricing,
    platforms: t.platforms ?? [],
    languages: t.languages ?? [],
    flags: t.flags ?? [],
    claimable: t.claimable,
    madeByOwner: t.made_by_owner,
    hasKeeper: Boolean(row.has_keeper),
    keeperHandle: row.keeper?.handle ?? null,
    keeperName: row.keeper?.display_name ?? null,
    likeCount: num(t.like_count),
    saveCount: num(t.save_count),
    openCount: num(t.open_count),
    reviewCount: num(t.review_count),
    ratingAvg: numOrNull(t.rating_avg),
    ratingCount: num(t.rating_count),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    publishedAt: t.published_at,
    categories: (row.categories ?? []).map((c) => ({
      slug: c.slug,
      name: c.name,
      isPrimary: c.is_primary,
    })),
    problems: row.problems ?? [],
    reviews: (row.reviews ?? []).map(toReview),
    histogram: row.histogram ?? {},
    aspects: {
      solvedPct: numOrNull(aspects?.solved_pct ?? null),
      ease: numOrNull(aspects?.ease ?? null),
      worth: numOrNull(aspects?.worth ?? null),
      solvedCount: num(aspects?.solved_count),
    },
    alternatives: (row.alternatives ?? []).map((a) => ({
      slug: a.slug,
      name: a.name,
      summary: a.summary,
      pricing: a.pricing,
      ratingAvg: numOrNull(a.rating_avg),
      likeCount: num(a.like_count),
    })),
  };
}
