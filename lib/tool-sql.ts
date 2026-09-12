/**
 * The statements a maker's own screens send, separated from the pool so both
 * can be exercised without a database.
 *
 * Same rules as lib/sql.ts and lib/account-sql.ts:
 *
 *   ONE STATEMENT PER SCREEN, ONE ROUND TRIP. A dashboard that shows four
 *   metrics, a listing, a review list and a demand table asks PostgreSQL for
 *   all of it in one statement. There is no `query()` escape hatch here
 *   either.
 *
 *   NOTHING HERE DECIDES WHO MAY DO WHAT. Every statement runs inside a
 *   transaction carrying the caller's identity, and the database's policies and
 *   definer functions answer. Not one line in this file compares an owner id
 *   to the caller, and there may never be one — tests/markup.test.mjs refuses
 *   the shape, over this file and every screen. (It refuses it as TEXT, which
 *   is why this sentence describes the pattern rather than quoting it: the
 *   first draft of this comment failed the test it was explaining.)
 *
 *   "NOT YOURS" AND "NOT THERE" ARE THE SAME ANSWER. Both are an empty result
 *   and the same message. Telling them apart is an enumeration leak
 *   (research/09 §5.5).
 */
import type { Executor } from './sql';
import type { Platform, PricingModel, ToolFlag } from './types';

/* ===========================================================================
 * Adding one
 * ======================================================================== */

/**
 * Create the draft.
 *
 * What is NOT in the column list is the point: no `owner_id`, no `claimable`,
 * no `made_by_owner`, no `published_at`, no counter. 0017 revoked those from
 * foundit_app and `public.tools_stamp_submission` stamps them, so this
 * statement could not write them if it tried.
 *
 * `$1` is an ARRAY of candidate slugs and the statement takes the first one
 * that is free, in SQL, in the same round trip — because asking whether a slug
 * is taken and then inserting it is a race with anybody submitting at the same
 * moment. A duplicate `url` is left to the unique constraint: it comes back as
 * SQLSTATE 23505 and the caller turns that into the message naming the
 * existing listing.
 */
export const CREATE_DRAFT_SQL = `
  insert into public.tools
    (slug, name, url, summary, pricing, platforms, languages, flags, status, submitted_by)
  select
    free.slug, $2::text, $3::text, $4::text, $5::pricing_model,
    $6::platform[], $7::text[], $8::tool_flag[], 'draft', $9::text
    from (
      select candidate.slug
        from unnest($1::text[]) with ordinality as candidate(slug, ord)
       where not exists (select 1 from public.tools t where t.slug = candidate.slug)
       order by candidate.ord
       limit 1
    ) as free
  returning id, slug::text as slug`;

/** SQLSTATE unique_violation. `tools.url` is unique and that is the message. */
export const SQLSTATE_DUPLICATE = '23505';

/**
 * Who already has this address, by its PUBLIC name and nothing else.
 *
 * The gate's wording, and the reason for it: "refuses a duplicate with a
 * message naming the existing listing (its public name only)". Not who
 * maintains it, not whether it has an owner, not its id — a person submitting
 * a URL somebody else already listed learns the listing exists, which they
 * could learn by searching, and nothing about the person behind it.
 *
 * `status = 'published'` because an unpublished listing is not something a
 * stranger may be told about, even obliquely. A collision with somebody's
 * draft comes back with no name, and the message says only that the address is
 * already listed.
 */
export const EXISTING_BY_URL_SQL = `
  select name, slug::text as slug
    from public.tools
   where url = $1::text and status = 'published'
   limit 1`;

/** The listing a step of the submit flow is editing, if it is the caller's. */
export const MY_DRAFT_SQL = `
  select t.id, t.slug::text as slug, t.name, t.url, t.summary,
         t.pricing::text as pricing,
         coalesce(t.platforms::text[], '{}') as platforms,
         coalesce(t.languages, '{}')          as languages,
         coalesce(t.flags::text[], '{}')      as flags,
         t.status::text as status,
         t.published_at,
         coalesce(
           (select array_agg(tp.statement order by tp.sort_order, tp.id)
              from public.tool_problems tp where tp.tool_id = t.id),
           '{}'
         ) as statements
    from public.tools t
   where t.id = $1::bigint
     and public.tool_is_mine(t.id)`;

/**
 * Edit the listing. Eight columns, which are the eight 0017 grants UPDATE on.
 *
 * `tools_update using (tool_is_mine(id))` is what decides whether this touches
 * a row, and row-level security FILTERS rather than refusing — the shape of the
 * defect Phase 6 found in the counters — so the caller checks the row count
 * rather than the absence of an error.
 */
export const UPDATE_LISTING_SQL = `
  update public.tools
     set name       = $2::text,
         summary    = $3::text,
         pricing    = $4::pricing_model,
         platforms  = $5::platform[],
         languages  = $6::text[],
         flags      = $7::tool_flag[]
   where id = $1::bigint
  returning id`;

/** The one door for a person-typed statement. 0017 §3. */
export const SET_STATEMENTS_SQL = `
  select added, removed, kept from public.set_owner_statements($1::bigint, $2::text[])`;

/** Draft to published, now, with no approval queue. 0017 §6. */
export const PUBLISH_SQL = `select public.publish_tool($1::bigint) as slug`;

/** One click. 0017 §5. */
export const CLAIM_SQL = `select public.claim_tool($1::bigint, $2::text) as slug`;

/** The listing a claim screen is about, by slug. Published and claimable only. */
export const CLAIMABLE_SQL = `
  select t.id, t.slug::text as slug, t.name, t.url, t.summary,
         t.claimable, t.owner_id is not null as owned,
         t.rating_count, t.review_count,
         (select p.handle::text from public.profiles p where p.id = t.owner_id) as owner_handle
    from public.tools t
   where t.slug = $1::citext and t.status = 'published'`;

/* ===========================================================================
 * The maker's own screens
 * ======================================================================== */

/**
 * Every listing this person maintains, with the four numbers the dashboard's
 * metric cards draw. One statement, whatever the count.
 *
 * Drafts are included, and they are the one place a draft is visible: it is
 * the person's own, `tools_read` lets them see it, and a submit flow somebody
 * abandoned halfway needs somewhere to be found again.
 */
export const MY_LISTINGS_SQL = `
  select t.id, t.slug::text as slug, t.name, t.summary, t.url,
         t.status::text as status, t.published_at, t.updated_at,
         t.like_count, t.save_count, t.open_count, t.review_count,
         t.rating_avg, t.rating_count,
         t.claimable, t.made_by_owner,
         (select count(*) from public.tool_problems tp where tp.tool_id = t.id) as statement_count,
         (select count(*) from public.search_event_tools st
            join public.search_events e on e.id = st.event_id
           where st.tool_id = t.id
             and e.created_at >= now() - interval '30 days') as matched_count
    from public.tools t
   where t.owner_id = $1::text
   order by (t.status = 'published') desc, t.published_at desc nulls first, t.id desc`;

/**
 * One listing's dashboard: the listing, its reviews, and the search demand.
 *
 * The demand comes from `public.maker_search_demand`, which is where the
 * five-event threshold lives — the sentence is NULL below it, decided in the
 * database, so there is no argument this statement could pass to see a
 * sentence one person typed once.
 */
export const MAKER_DASHBOARD_SQL = `
  with mine as (
    select t.* from public.tools t
     where t.slug = $1::citext and public.tool_is_mine(t.id) and t.owner_id = $2::text
  )
  select
    m.id, m.slug::text as slug, m.name, m.summary, m.url,
    m.status::text as status, m.published_at, m.updated_at,
    m.like_count, m.save_count, m.open_count, m.review_count,
    m.rating_avg, m.rating_count,
    (select p.handle::text from public.profiles p where p.id = m.submitted_by) as added_by,
    coalesce(
      (select array_agg(tp.statement order by tp.sort_order, tp.id)
         from public.tool_problems tp where tp.tool_id = m.id),
      '{}'
    ) as statements,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'queryText', d.query_text,
               'searches',  d.searches,
               'bestRank',  d.best_rank,
               'shown',     d.shown
             ) order by d.searches desc)
        from public.maker_search_demand(m.id, 30, 10) d
    ), '[]'::jsonb) as demand,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'rating', r.rating,
               'body',   r.body,
               'handle', pr.handle::text,
               'at',     r.created_at
             ) order by r.created_at desc)
        from (
          select * from public.reviews rr
           where rr.tool_id = m.id and rr.deleted_at is null
           order by rr.created_at desc limit 5
        ) r
        join public.profiles pr on pr.id = r.author_id
    ), '[]'::jsonb) as reviews,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'toolId',  oc.tool_id,
               'reason',  oc.reason,
               'at',      oc.created_at,
               'fromMe',  oc.from_owner_id = $2::text
             ) order by oc.created_at desc)
        from public.ownership_changes oc where oc.tool_id = m.id
    ), '[]'::jsonb) as ownership_changes
    from mine m`;

/* ===========================================================================
 * Marshalling
 * ======================================================================== */

export interface MakerListing {
  id: string;
  slug: string;
  name: string;
  summary: string;
  url: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date | null;
  likeCount: number;
  saveCount: number;
  openCount: number;
  reviewCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  statementCount: number;
  matchedCount: number;
  claimable: boolean;
  madeByOwner: boolean;
}

export interface DemandRow {
  /** Null below `public.maker_query_threshold()` searches. Withheld, not absent. */
  queryText: string | null;
  searches: number;
  bestRank: number | null;
  shown: boolean;
}

export interface MakerReview {
  rating: number;
  body: string | null;
  handle: string;
  at: Date | null;
}

export interface OwnershipChange {
  toolId: string;
  reason: string;
  at: Date | null;
  fromMe: boolean;
}

export interface MakerDashboard {
  listing: MakerListing;
  addedBy: string | null;
  statements: string[];
  demand: DemandRow[];
  reviews: MakerReview[];
  ownershipChanges: OwnershipChange[];
}

export interface DraftListing {
  id: string;
  slug: string;
  name: string;
  url: string;
  summary: string;
  pricing: PricingModel;
  platforms: Platform[];
  languages: string[];
  flags: ToolFlag[];
  status: string;
  publishedAt: Date | null;
  statements: string[];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function date(value: unknown): Date | null {
  return value instanceof Date ? value : value ? new Date(String(value)) : null;
}

interface ListingRow {
  id: string | number;
  slug: string;
  name: string;
  summary: string;
  url: string;
  status: string;
  published_at: unknown;
  updated_at: unknown;
  like_count: unknown;
  save_count: unknown;
  open_count: unknown;
  review_count: unknown;
  rating_avg: unknown;
  rating_count: unknown;
  statement_count?: unknown;
  matched_count?: unknown;
  claimable?: boolean;
  made_by_owner?: boolean;
}

export function toMakerListing(row: ListingRow): MakerListing {
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    url: row.url,
    status: row.status,
    publishedAt: date(row.published_at),
    updatedAt: date(row.updated_at),
    likeCount: num(row.like_count),
    saveCount: num(row.save_count),
    openCount: num(row.open_count),
    reviewCount: num(row.review_count),
    ratingAvg: numOrNull(row.rating_avg),
    ratingCount: num(row.rating_count),
    statementCount: num(row.statement_count),
    matchedCount: num(row.matched_count),
    claimable: row.claimable === true,
    madeByOwner: row.made_by_owner === true,
  };
}

export async function runMyListings(exec: Executor, userId: string): Promise<MakerListing[]> {
  const { rows } = await exec.query<ListingRow>(MY_LISTINGS_SQL, [userId]);
  return rows.map(toMakerListing);
}

export async function runMakerDashboard(
  exec: Executor,
  slug: string,
  userId: string,
): Promise<MakerDashboard | null> {
  const { rows } = await exec.query<
    ListingRow & {
      added_by: string | null;
      statements: string[] | null;
      demand: unknown;
      reviews: unknown;
      ownership_changes: unknown;
    }
  >(MAKER_DASHBOARD_SQL, [slug, userId]);

  const row = rows[0];
  // No row is "not yours" AND "not there", and the caller shows one page for
  // both. research/09 §5.5.
  if (!row) return null;

  const demand = (Array.isArray(row.demand) ? row.demand : []) as Array<Record<string, unknown>>;
  const reviews = (Array.isArray(row.reviews) ? row.reviews : []) as Array<
    Record<string, unknown>
  >;
  const changes = (Array.isArray(row.ownership_changes) ? row.ownership_changes : []) as Array<
    Record<string, unknown>
  >;

  return {
    listing: toMakerListing(row),
    addedBy: row.added_by ?? null,
    statements: row.statements ?? [],
    demand: demand.map((d) => ({
      // Null means WITHHELD, and the page says so rather than drawing a blank
      // row. `shown` is the database's own answer to "was this above the
      // threshold", so the page never has to recompute it and cannot get it
      // wrong in the other direction.
      queryText: typeof d.queryText === 'string' ? d.queryText : null,
      searches: num(d.searches),
      bestRank: numOrNull(d.bestRank),
      shown: d.shown === true,
    })),
    reviews: reviews.map((r) => ({
      rating: num(r.rating),
      body: typeof r.body === 'string' ? r.body : null,
      handle: String(r.handle ?? ''),
      at: date(r.at),
    })),
    ownershipChanges: changes.map((c) => ({
      toolId: String(c.toolId ?? ''),
      reason: String(c.reason ?? ''),
      at: date(c.at),
      fromMe: c.fromMe === true,
    })),
  };
}

interface DraftRow {
  id: string | number;
  slug: string;
  name: string;
  url: string;
  summary: string;
  pricing: string;
  platforms: string[] | null;
  languages: string[] | null;
  flags: string[] | null;
  status: string;
  published_at: unknown;
  statements: string[] | null;
}

export function toDraftListing(row: DraftRow): DraftListing {
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    url: row.url,
    summary: row.summary,
    pricing: row.pricing as PricingModel,
    platforms: (row.platforms ?? []) as Platform[],
    languages: row.languages ?? [],
    flags: (row.flags ?? []) as ToolFlag[],
    status: row.status,
    publishedAt: date(row.published_at),
    statements: row.statements ?? [],
  };
}

export async function runMyDraft(
  exec: Executor,
  toolId: string,
): Promise<DraftListing | null> {
  const { rows } = await exec.query<DraftRow>(MY_DRAFT_SQL, [toolId]);
  return rows[0] ? toDraftListing(rows[0]) : null;
}
