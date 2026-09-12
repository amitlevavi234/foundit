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

/** SQLSTATE unique_violation. `tools.url_key` is unique and that is the message. */
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
 * THE NAME IS NULL FOR ANYTHING THAT IS NOT PUBLISHED, rather than the row
 * being absent, and that changed with the Phase 7 review. This statement is
 * now the PRE-CHECK — it runs before the insert rather than after the
 * constraint has fired — so it has to answer "there is already a row" and
 * "here is its public name" separately. An unpublished listing is not
 * something a stranger may be told about even obliquely, so the message it
 * produces says only that the address is already listed.
 *
 * `url_key` and not `url`: 0018's generated column, which is what the unique
 * index is on. Matching on the raw string is what let the review list one page
 * eight times.
 */
export const EXISTING_BY_URL_SQL = `
  select case when t.status = 'published' then t.name end as name,
         case when t.status = 'published' then t.slug::text end as slug
    from public.tools t
   where t.url_key = public.url_key($1::text)
   limit 1`;

/** Create the draft inside a savepoint, so a duplicate is not a dead transaction. */
export const SAVEPOINT_DRAFT_SQL = 'savepoint create_draft';
export const ROLLBACK_TO_DRAFT_SQL = 'rollback to savepoint create_draft';
export const RELEASE_DRAFT_SQL = 'release savepoint create_draft';

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
         ) as statements,
         (select c.slug::text from public.tool_categories tc
            join public.categories c on c.id = tc.category_id
           where tc.tool_id = t.id
           order by tc.is_primary desc, c.sort_order
           limit 1) as category
    from public.tools t
   where t.id = $1::bigint
     and public.tool_is_mine(t.id)`;

/**
 * The same, for the SUBMIT FLOW, which is about a DRAFT.
 *
 * The Phase 7 review (F7): `MY_DRAFT_SQL` has no status predicate, so
 * /submit/preview kept serving an enabled "Publish it" button for a listing
 * that was already live. A double-click, a browser resubmit or a
 * back-button-and-retry each burned one of the three publishes a person gets
 * in a day on a publish that did nothing, and the person was then told they
 * had hit the daily ceiling. The replay the review recorded spent two of three
 * tokens on no-ops and was refused on the third with an eight-hour wait.
 *
 * A separate statement rather than a predicate on the one above, because the
 * EDIT screen reads the same columns for a PUBLISHED listing and would break.
 */
export const MY_DRAFT_ONLY_SQL = `${MY_DRAFT_SQL}
     and t.status = 'draft'`;

/**
 * Which of my listings this id is, if it is mine at all.
 *
 * Two columns and a round trip, for two things that both used to be taken from
 * the form (F12) or inferred from an empty result (F7):
 *
 *   the SLUG, so `revalidatePath` purges the path of the row that was actually
 *   written rather than a path named in the same POST. A person who edits
 *   their own listing could otherwise name any slug and evict somebody else's
 *   page from the cache — not a read and not a write, but the slug is on the
 *   row and never needed to come from the request.
 *
 *   the STATUS, so the submit flow can say "that listing is already published"
 *   without spending a publish token to find out.
 */
export const MY_LISTING_SQL = `
  select t.slug::text as slug, t.status::text as status
    from public.tools t
   where t.id = $1::bigint
     and public.tool_is_mine(t.id)`;

/**
 * Edit the listing. Six columns, which are the six 0017 and 0018 grant UPDATE on.
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

/**
 * The editorial categories, for the Details step's select.
 *
 * A closed list a human edits (0001 chose a table over an enum for exactly
 * that reason), and the reason a submitted listing has to pick one: /browse and
 * /top are organised by category, so a listing with no row in
 * public.tool_categories is a listing that appears on neither. That was a real
 * gap in the first version of this flow — the artboard draws the select and the
 * first build left it out, and the listing published fine and never showed up
 * on /browse.
 */
export const CATEGORIES_SQL = `
  select id, slug::text as slug, name from public.categories order by sort_order, name`;

/**
 * One primary category for one listing, in one statement.
 *
 * The DELETE and the INSERT together, because a listing has at most one
 * primary category — `tool_categories_one_primary` is a partial unique index
 * (0001) — and doing this as two statements leaves a window where it has none
 * or two. `tool_categories_write` is `using (tool_is_mine(tool_id))`, so this
 * touches nothing at all on somebody else's listing.
 */
export const SET_CATEGORY_SQL = `
  with gone as (
    delete from public.tool_categories
     where tool_id = $1::bigint
       and category_id <> (select c.id from public.categories c where c.slug = $2::citext)
    returning 1
  ),
  wanted as (select c.id from public.categories c where c.slug = $2::citext)
  insert into public.tool_categories (tool_id, category_id, is_primary)
  select $1::bigint, w.id, true from wanted w
  on conflict (tool_id, category_id) do update set is_primary = true
  returning tool_id`;

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
         -- THROUGH A DEFINER FUNCTION, like the sentences on the dashboard
         -- beneath it. This was a subquery straight onto
         -- public.search_event_tools, whose only SELECT policy is
         -- an admin-only one — so for a maker it counted nothing and every
         -- listing said "0 searches matched". Row-level security FILTERS, it
         -- does not refuse, which is the exact defect class lib/maker.ts's own
         -- header says every write in that file guards against, applied to a
         -- read. The Phase 7 review found it (F6).
         (select m.matched_count from public.maker_listing_metrics(t.id, 30) m) as matched_count
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
    -- EVERY COLUMN NAMED, and never \`t.*\`. The first version of this
    -- statement used the star and failed with "permission denied for table
    -- tools" the first time the page was opened: 0007 replaced foundit_app's
    -- table-wide SELECT with a column list so that \`tools.embedding\` could be
    -- excluded, and a star asks for every column including that one. The
    -- boundary worked exactly as designed and the query was wrong.
    select t.id, t.slug, t.name, t.summary, t.url, t.status,
           t.published_at, t.updated_at, t.submitted_by,
           t.like_count, t.save_count, t.open_count, t.review_count,
           t.rating_avg, t.rating_count
      from public.tools t
     where t.slug = $1::citext and public.tool_is_mine(t.id) and t.owner_id = $2::text
  )
  select
    m.id, m.slug::text as slug, m.name, m.summary, m.url,
    m.status::text as status, m.published_at, m.updated_at,
    m.like_count, m.save_count, m.open_count, m.review_count,
    m.rating_avg, m.rating_count,
    -- The number the "Searches matched" card draws, which this statement did
    -- not select at all — so the marshaller read an absent value, coerced it to 0,
    -- and the page rendered "0 · Searches matched · Last 30 days" directly
    -- above a panel listing three sentences and seven searches. Both halves of
    -- F6: the policy that filtered the count to nothing, and the column that
    -- was never asked for.
    (select k.matched_count from public.maker_listing_metrics(m.id, 30) k) as matched_count,
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
  /** The primary category's slug, or null while the flow has not asked yet. */
  category: string | null;
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
  /**
   * REQUIRED, and that is the second half of F6's fix.
   *
   * It was optional, so `MAKER_DASHBOARD_SQL` not selecting it was not a type
   * error — `num(undefined)` is 0 and the dashboard drew a zero it had never
   * been given a number for. A row shape that does not carry it now fails to
   * compile rather than rendering a plausible lie.
   */
  matched_count: unknown;
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
  category: string | null;
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
    category: row.category ?? null,
  };
}

/**
 * One of my listings, in the shape the forms need.
 *
 * `draftOnly` is the submit flow's; the edit screen reads a published listing
 * through the same columns. See MY_DRAFT_ONLY_SQL for why the two are apart.
 */
export async function runMyDraft(
  exec: Executor,
  toolId: string,
  draftOnly = false,
): Promise<DraftListing | null> {
  const { rows } = await exec.query<DraftRow>(
    draftOnly ? MY_DRAFT_ONLY_SQL : MY_DRAFT_SQL,
    [toolId],
  );
  return rows[0] ? toDraftListing(rows[0]) : null;
}

/** The slug and the status of one of my listings, or null. */
export interface MyListing {
  slug: string;
  status: string;
}

export async function runMyListing(
  exec: Executor,
  toolId: string,
): Promise<MyListing | null> {
  const { rows } = await exec.query<{ slug: string; status: string }>(MY_LISTING_SQL, [toolId]);
  const row = rows[0];
  return row ? { slug: row.slug, status: row.status } : null;
}

/* ===========================================================================
 * Creating one, and the duplicate address
 * ======================================================================== */

/** What `runCreateDraft` answers with. A duplicate is a sentence, not a 500. */
export type CreateDraftResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; reason: 'duplicate'; name: string | null; slug: string | null }
  | { ok: false; reason: 'refused' };

/**
 * Create the draft, and answer a duplicate address with a sentence.
 *
 * THE DEFECT THIS SHAPE EXISTS TO CLOSE (F1). `withIdentity` runs the whole
 * callback in ONE transaction with no savepoints. The first version caught the
 * 23505 from the unique constraint and then sent a second query — the lookup
 * for the existing listing's name — on the same, now-ABORTED transaction.
 * PostgreSQL answered 25P02, the throw escaped the Server Action, and the
 * person got an HTTP 500 and lost the form they had filled in. The gate asks
 * for "a message naming the existing listing"; what it got was a stack trace.
 *
 * So there are two guards and they are not redundant:
 *
 *   THE LOOK-UP HAPPENS FIRST. In the ordinary case the row is found before
 *   anything is inserted, the transaction is untouched, and the message is the
 *   one the gate asks for.
 *
 *   THE INSERT IS INSIDE A SAVEPOINT. The look-up cannot see a draft somebody
 *   else owns — `tools_read` correctly hides it — and two people submitting
 *   the same address at the same instant is a race whatever the look-up says.
 *   Either way the constraint fires, `rollback to savepoint` leaves a
 *   transaction that still works, and the answer is a duplicate with no name,
 *   which is also the right answer: an unpublished listing is not something a
 *   stranger may be told about.
 */
export async function runCreateDraft(
  exec: Executor,
  values: readonly unknown[],
  url: string,
): Promise<CreateDraftResult> {
  const existing = await exec.query<{ name: string | null; slug: string | null }>(
    EXISTING_BY_URL_SQL,
    [url],
  );
  const already = existing.rows[0];
  if (already) {
    return { ok: false, reason: 'duplicate', name: already.name, slug: already.slug };
  }

  await exec.query(SAVEPOINT_DRAFT_SQL, []);
  try {
    const { rows } = await exec.query<{ id: string | number; slug: string }>(
      CREATE_DRAFT_SQL,
      values as unknown[],
    );
    await exec.query(RELEASE_DRAFT_SQL, []);
    const row = rows[0];
    // No row and no error means the policy filtered the insert, or every
    // candidate slug was taken. Both are "we could not", and neither is worth
    // telling apart to the person.
    if (!row) return { ok: false, reason: 'refused' };
    return { ok: true, id: String(row.id), slug: row.slug };
  } catch (error) {
    // The savepoint is what makes the next statement possible at all.
    await exec.query(ROLLBACK_TO_DRAFT_SQL, []);
    if ((error as { code?: string } | null)?.code !== SQLSTATE_DUPLICATE) throw error;
    const raced = await exec.query<{ name: string | null; slug: string | null }>(
      EXISTING_BY_URL_SQL,
      [url],
    );
    const row = raced.rows[0];
    return { ok: false, reason: 'duplicate', name: row?.name ?? null, slug: row?.slug ?? null };
  }
}
