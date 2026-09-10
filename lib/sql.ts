/**
 * The two statements the application is allowed to send, and the marshalling
 * around them — separated from the connection pool so both can be exercised
 * without a database.
 *
 * Nothing in here opens a socket. `lib/db.ts` binds these to the real pool and
 * is the only module the application imports.
 */
import type { SearchConstraints, SearchEvent, ToolResult, MatchSource, PricingModel } from './types';

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
    p_latency_ms     => $5::int
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
    event.hadGoodMatch ?? false,
    event.latencyMs ?? null,
  ];
}

/**
 * Record that a search happened. One statement, and the caller is expected not
 * to await it: this runs after the response has gone out.
 */
export async function runLogSearchEvent(exec: Executor, event: SearchEvent): Promise<void> {
  await exec.query(LOG_SEARCH_EVENT_SQL, logSearchEventParams(event));
}
