import 'server-only';

import pg from 'pg';

import {
  runBrowse,
  runHome,
  runLogSearchEvent,
  runSearch,
  runSearchDetailed,
  runToolPage,
  runTop,
} from './sql';
import type {
  BrowseData,
  HomeData,
  SearchConstraints,
  SearchEvent,
  ToolPageData,
  ToolResult,
  ToolResultDetail,
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
 */
export async function searchToolsDetailed(
  query: string,
  constraints: SearchConstraints = {},
  limit = 12,
  category: string | null = null,
): Promise<ToolResultDetail[]> {
  return runSearchDetailed(getPool(), query, constraints, limit, category);
}

/** Everything the homepage draws. One round trip. */
export async function getHome(topLimit = 6, foundLimit = 3): Promise<HomeData> {
  return runHome(getPool(), topLimit, foundLimit);
}

/** Everything /browse draws, for all categories or one. One round trip. */
export async function getBrowse(
  category: string | null = null,
  limit = 12,
): Promise<BrowseData> {
  return runBrowse(getPool(), category, limit);
}

/** Everything /top draws, ranked by a real counter. One round trip. */
export async function getTop(
  category: string | null = null,
  ranking: TopRanking = 'likes',
  limit = 25,
): Promise<TopData> {
  return runTop(getPool(), category, ranking, limit);
}

/**
 * One tool page — the listing, its problems, its reviews and their bylines,
 * the ratings and three alternatives — or `null` if no published tool has that
 * slug. One round trip, however many sections the page has.
 */
export async function getToolPage(slug: string, reviewLimit = 10): Promise<ToolPageData | null> {
  return runToolPage(getPool(), slug, reviewLimit);
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
