/* ===========================================================================
 * The statements behind the operator dashboard, and the shapes they come back
 * as.
 *
 * THE WHOLE PAGE IS ONE ROUND TRIP. `DASHBOARD_SQL` calls every panel function
 * in one statement and hands back one row of JSON, which is this codebase's
 * rule from lib/db.ts's header — "a screen that needs a list and something
 * about each item in the list asks PostgreSQL for both in one statement" —
 * applied to a screen with eight panels. Eleven awaited calls would be eleven
 * transactions, eleven identity claims and eleven chances to forget one.
 *
 * NOTHING HERE DECIDES WHO MAY SEE ANY OF IT. Every name below is an
 * `admin_*` function from 0019, each of which raises 42501 unless
 * auth.is_admin() answers true — so a page that forgot to check gets an
 * exception rather than a dashboard, and the ordinary account that guessed the
 * URL gets one too. The `notFound()` in the pages is about what a stranger
 * should SEE; this is about what they can HAVE.
 *
 * NO STATEMENT IN THIS FILE NAMES A TABLE. Not one: every read is a function
 * call. That is what keeps the promise in docs/product-decisions.md §10
 * checkable — the rule that search text and a person are never joined is
 * enforced over function bodies in db/test/admin_test.sql §2, and a page that
 * could write its own SELECT would be outside that rule.
 * ======================================================================== */

/** The window every rate-of-things panel covers. */
export const DASHBOARD_DAYS = 30;

/** The window the Catalogue panel covers — "tools added this week" (§10). */
export const CATALOGUE_DAYS = 7;

/** How many rows any one list on the dashboard draws. */
export const LIST_LIMIT = 50;

export const DASHBOARD_SQL = `
  select
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_demand($1::int) x)                            as demand,
    (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
       from public.admin_unmet_demand($1::int, $3::int) x)             as unmet,
    (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
       from public.admin_top_queries($1::int, $3::int) x)              as asked,
    (select to_jsonb(x)
       from public.admin_catalogue_counts($2::int) x)                  as catalogue,
    (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
       from public.admin_catalogue_added($2::int, $3::int) x)          as added,
    (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
       from public.admin_catalogue_unmatched($3::int) x)               as unmatched,
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_signups($1::int) x)                           as signups,
    (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
       from public.admin_people($3::int) x)                            as people,
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_words($1::int) x)                             as words,
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.kind), '[]'::jsonb)
       from public.admin_ops_events() x)                               as ops,
    public.admin_database_bytes()                                      as database_bytes`;

/** Every review, newest first, for /admin/reviews. */
export const ADMIN_REVIEWS_SQL = `
  select coalesce(
           jsonb_agg(to_jsonb(x) order by x.created_at desc, x.review_id desc),
           '[]'::jsonb
         ) as rows
    from public.admin_reviews($1::int, $2::int) x`;

/**
 * The reason, written down BEFORE the review comes down.
 *
 * That ordering is the trigger's (0013 §7): `reviews_is_not_an_edit` refuses a
 * removal whose reason is not already on the record, by the same administrator,
 * in the same transaction. So this statement is not bookkeeping that happens to
 * run first — it is the thing that makes the next one legal.
 *
 * The row it writes is `admin_id = auth.uid()`, which is what
 * `review_removals_insert` demands, so there is no administrator id for a
 * caller to supply and none to get wrong.
 */
export const RECORD_REMOVAL_SQL = `
  insert into public.review_removals (review_id, admin_id, reason)
  select r.id, auth.uid(), $2::text
    from public.reviews r
   where r.id = $1::bigint
     and r.deleted_at is null
  returning id`;

/**
 * And the removal itself: one column, on a live review.
 *
 * Everything else about the row is refused by the trigger, so this statement
 * sets `deleted_at` and touches nothing — the text is never changed, which is
 * the sentence docs/product-decisions.md §4 makes and 0013 enforces.
 *
 * It returns the two things the notice to the author needs, and nothing the
 * page will ever render: the author's id, which goes to the authentication
 * pool to find an address and is never shown, and the listing's public name.
 */
export const REMOVE_REVIEW_SQL = `
  with removed as (
    update public.reviews
       set deleted_at = now()
     where id = $1::bigint
       and deleted_at is null
    returning id, author_id, tool_id, deleted_at
  )
  select removed.id,
         removed.author_id,
         removed.deleted_at,
         t.name as tool_name
    from removed
    join public.tools t on t.id = removed.tool_id`;

/**
 * The author's own removals, for their Settings page.
 *
 * Not an admin function and deliberately not: `review_removals_read` (0013 §6)
 * already says "an admin, and the author of the review that came down", and
 * reading the row that is about you is not a privilege. The policy is what
 * scopes this, which is why the statement carries no id — `auth.uid()` is the
 * whole of the WHERE clause a caller could have influenced.
 */
export const MY_REMOVALS_SQL = `
  select rr.created_at,
         rr.reason,
         t.name          as tool_name,
         t.slug::text    as tool_slug
    from public.review_removals rr
    join public.reviews r on r.id = rr.review_id
    join public.tools   t on t.id = r.tool_id
   where r.author_id = auth.uid()
   order by rr.created_at desc`;

/**
 * The address one notice goes to.
 *
 * Sent to the AUTHENTICATION pool as foundit_auth, because that is the only
 * role that may see auth_core at all (0013) — the same door lib/accounts.ts
 * uses to delete sessions. The address never comes back up to a page: it goes
 * straight into lib/email.ts, and what the caller learns is whether a message
 * was attempted.
 */
export const AUTHOR_ADDRESS_SQL = `select email from auth_core."user" where id = $1`;

/* ===========================================================================
 * What the page draws
 * ======================================================================== */

export interface DemandDay {
  day: string;
  searches: number;
  judged: number;
  nothingGood: number;
}

export interface Sentence {
  text: string;
  searches: number;
  lastAt: string | null;
}

export interface CatalogueCounts {
  added: number;
  published: number;
  claimsMade: number;
  ownershipChanged: number;
}

export interface AddedListing {
  slug: string;
  name: string;
  handle: string | null;
  status: string;
  createdAt: string;
}

export interface UnmatchedListing {
  slug: string;
  name: string;
  publishedAt: string | null;
}

export interface SignupDay {
  day: string;
  signups: number;
}

export interface Person {
  handle: string;
  toolsAdded: number;
  reviewsWritten: number;
  likesGiven: number;
  /** A day, or null for somebody the application has not seen since 0019. */
  lastSeenDay: string | null;
  joinedDay: string;
}

export interface WordsDay {
  day: string;
  reviews: number;
  removed: number;
}

export interface OpsEvent {
  kind: 'backup' | 'restore_test' | 'update_check' | string;
  /** False means nothing has EVER been written for this kind. */
  recorded: boolean;
  ok: boolean | null;
  detail: string | null;
  at: string | null;
}

export interface Dashboard {
  demand: DemandDay[];
  unmet: Sentence[];
  asked: Sentence[];
  catalogue: CatalogueCounts;
  added: AddedListing[];
  unmatched: UnmatchedListing[];
  signups: SignupDay[];
  people: Person[];
  words: WordsDay[];
  ops: OpsEvent[];
  databaseBytes: number;
}

export interface AdminReview {
  id: string;
  toolSlug: string;
  toolName: string;
  handle: string;
  rating: number;
  body: string | null;
  createdAt: string;
  removedAt: string | null;
  removalReason: string | null;
  removedBy: string | null;
}

export interface MyRemoval {
  toolName: string;
  toolSlug: string;
  reason: string;
  createdAt: string;
}

/* ===========================================================================
 * Mapping. Pure functions over the JSON the statements above hand back, so
 * tests/admin.test.mjs can drive every one of them with no database.
 * ======================================================================== */

const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const maybe = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

export function toDashboard(row: Record<string, unknown> | undefined): Dashboard {
  const catalogue = (row?.catalogue ?? {}) as Record<string, unknown>;
  return {
    demand: list(row?.demand).map((d) => ({
      day: text(d.day),
      searches: num(d.searches),
      judged: num(d.judged),
      nothingGood: num(d.nothing_good),
    })),
    unmet: list(row?.unmet).map(toSentence),
    asked: list(row?.asked).map(toSentence),
    catalogue: {
      added: num(catalogue.added),
      published: num(catalogue.published),
      claimsMade: num(catalogue.claims_made),
      ownershipChanged: num(catalogue.ownership_changed),
    },
    added: list(row?.added).map((t) => ({
      slug: text(t.slug),
      name: text(t.name),
      handle: maybe(t.handle),
      status: text(t.status),
      createdAt: text(t.created_at),
    })),
    unmatched: list(row?.unmatched).map((t) => ({
      slug: text(t.slug),
      name: text(t.name),
      publishedAt: maybe(t.published_at),
    })),
    signups: list(row?.signups).map((s) => ({ day: text(s.day), signups: num(s.signups) })),
    people: list(row?.people).map((p) => ({
      handle: text(p.handle),
      toolsAdded: num(p.tools_added),
      reviewsWritten: num(p.reviews_written),
      likesGiven: num(p.likes_given),
      lastSeenDay: maybe(p.last_seen_day),
      joinedDay: text(p.joined_day),
    })),
    words: list(row?.words).map((w) => ({
      day: text(w.day),
      reviews: num(w.reviews),
      removed: num(w.removed),
    })),
    ops: list(row?.ops).map((o) => ({
      kind: text(o.kind),
      recorded: o.recorded === true,
      // Null rather than false and null rather than zero, all the way to the
      // page: a kind nothing has written has no value, and "no value" is what
      // the panel turns into a sentence. `?? null` rather than `|| null` for
      // exactly that reason — `false` is a recorded failure and must survive.
      ok: o.recorded === true ? o.ok === true : null,
      detail: maybe(o.detail),
      at: maybe(o.at),
    })),
    databaseBytes: num(row?.database_bytes),
  };
}

function toSentence(s: Record<string, unknown>): Sentence {
  return {
    text: text(s.query_text),
    searches: num(s.searches),
    lastAt: maybe(s.last_at),
  };
}

export function toAdminReviews(value: unknown): AdminReview[] {
  return list(value).map((r) => ({
    id: String(r.review_id ?? ''),
    toolSlug: text(r.tool_slug),
    toolName: text(r.tool_name),
    handle: text(r.handle),
    rating: num(r.rating),
    body: maybe(r.body),
    createdAt: text(r.created_at),
    removedAt: maybe(r.removed_at),
    removalReason: maybe(r.removal_reason),
    removedBy: maybe(r.removed_by),
  }));
}

export function toMyRemovals(rows: Array<Record<string, unknown>>): MyRemoval[] {
  return rows.map((r) => ({
    toolName: text(r.tool_name),
    toolSlug: text(r.tool_slug),
    reason: text(r.reason),
    createdAt: text(r.created_at) || String(r.created_at ?? ''),
  }));
}

/* ===========================================================================
 * The reason a removal needs
 *
 * Eight characters after trimming, which is `review_removals_reason_check`'s
 * own number rather than a second opinion about it: a form that accepts what
 * the database refuses is a form that shows somebody a constraint name.
 * ======================================================================== */
export const MIN_REMOVAL_REASON = 8;
export const MAX_REMOVAL_REASON = 500;

export type ReasonProblem = 'short' | 'long' | null;

/** Is this a reason the database will accept? The page asks before posting. */
export function reasonProblem(raw: string): ReasonProblem {
  const reason = raw.trim();
  if (reason.length < MIN_REMOVAL_REASON) return 'short';
  if (reason.length > MAX_REMOVAL_REASON) return 'long';
  return null;
}
