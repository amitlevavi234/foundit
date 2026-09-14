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
 * could write its own SELECT would be outside that rule. The three WRITE
 * statements at the bottom of this file are the deliberate exception, and
 * lib/admin.ts says at length why a removal is two ordinary statements rather
 * than a thirteenth definer function.
 * ======================================================================== */

import { cleanText } from './submit.ts';

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
    -- THE OWNER'S ITEM 10, 14 September 2026. Six more panels on the same
    -- round trip, which is the whole point of this statement's shape: a
    -- dashboard that asked once per panel would be seventeen queries by now.
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_active_accounts($1::int) x)                   as active,
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_new_tools($1::int) x)                         as new_tools,
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_page_views($1::int) x)                        as views,
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
       from public.admin_spend($1::int) x)                             as spend,
    (select to_jsonb(x) from public.admin_spend_totals(1) x)           as spend_totals,
    -- THE OWNER'S ITEM 9: the two figures the Words panel used to say were
    -- "Not recorded".
    (select to_jsonb(x) from public.admin_report_counts($1::int) x)    as report_counts,
    public.admin_database_bytes()                                      as database_bytes`;

/**
 * The Reported tab: one page of reports, open first and oldest first inside
 * that, each with its review.
 *
 * `order by` INSIDE the aggregate, and it is load-bearing. `admin_reports`
 * returns its rows in the order the tab reads in — F11's whole point is that
 * the oldest open report is at the top — and `jsonb_agg` over a set-returning
 * function is not obliged to preserve it. The ordering key is spelled out here
 * as the same three clauses the function uses, so the array the page receives
 * is in the order the database decided rather than in whatever order the rows
 * happened to arrive in.
 */
export const ADMIN_REPORTS_SQL = `
  select coalesce(
           (select jsonb_agg(to_jsonb(x)
                             order by (x.resolved_at is not null),
                                      case when x.resolved_at is null then x.created_at end asc,
                                      case when x.resolved_at is null then x.report_id end asc,
                                      x.created_at desc,
                                      x.report_id desc)
              from public.admin_reports($1::int, $2::int) x),
           '[]'::jsonb
         ) as rows,
         -- THE BADGE, from the database rather than from the length of the
         -- array above it (OWNER FEEDBACK, ROUND 1, F11). The open count has
         -- no window and no limit on it, so with sixty open reports the tab
         -- says sixty and shows the fifty oldest, instead of saying fifty and
         -- hiding ten. On the same round trip, because it is a number about
         -- the rows beside it and a second statement could disagree with them.
         (select x.open from public.admin_report_counts(3650) x) as open`;

/**
 * A handle to `profiles.id` — OWNER FEEDBACK, ROUND 1, F21.
 *
 * `public.profiles_public` and not `public.profiles`: reporting a profile is
 * open to a signed-out visitor, and the view is the one 0003 built for the
 * columns of a profile anybody may see. `citext`, so the handle's case is the
 * database's problem rather than the caller's.
 */
export const PROFILE_ID_BY_HANDLE_SQL = `
  select id from public.profiles_public where handle = $1::citext`;

/** Filing one. The reporter is read inside the function, never passed in. */
export const FILE_REPORT_SQL = `
  select public.file_report($1::text, $2::text, $3::text, $4::text) as id`;

/** Closing one. */
export const RESOLVE_REPORT_SQL = `
  select public.resolve_report($1::bigint, $2::text) as done`;

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
 *
 * `FOR UPDATE` ON THE REVIEW, which the Phase 8 review asked for in its "could
 * not test" list: two administrators pressing Remove on the same review at the
 * same moment used to run both inserts, and the second one's UPDATE then
 * touched zero rows and left an extra `review_removals` row behind pointing at
 * a review somebody else had already taken down. The lock makes the second
 * transaction wait, and the unique index from 0020 §7 then refuses its row
 * outright — belt and braces, because the lock is about ordering and the index
 * is about the rule.
 *
 * `AND R.DELETED_AT IS NULL` IS GONE, and that is a decision rather than a
 * simplification (supervisor, 13 September 2026; Phase 8 review F8). An
 * administrator MAY record a removal against a review its author already
 * deleted. 0015 deliberately leaves an author's own deletion re-postable, and
 * the permanent bar in `reviews_removal_is_final` is armed by the EXISTENCE of
 * a removal row rather than by `deleted_at` — so without this, an author who
 * deletes ahead of a moderator keeps the right to post the same words again,
 * and the screen's only answer was "that review is not live".
 */
export const RECORD_REMOVAL_SQL = `
  with locked as (
    select r.id
      from public.reviews r
     where r.id = $1::bigint
     for update
  )
  insert into public.review_removals (review_id, admin_id, reason)
  select locked.id, auth.uid(), $2::text
    from locked
  returning id`;

/**
 * And the removal itself: one column, on a live review.
 *
 * Everything else about the row is refused by the trigger, so this statement
 * sets `deleted_at` and touches nothing — the text is never changed, which is
 * the sentence docs/product-decisions.md §4 makes and 0013 enforces.
 *
 * IT ANSWERS WHETHER OR NOT THE UPDATE TOUCHED ANYTHING, which is new. A
 * review its author already deleted has a `deleted_at` and the UPDATE matches
 * nothing — and 0013's trigger would refuse a second one anyway ("a removal
 * sets deleted_at once, on a live review"). That is no longer "gone": the
 * reason is on the record, the permanent bar is armed, and the author is owed
 * the notice. So the row comes back either way, carrying the author, the
 * listing's name and whichever timestamp is the real one.
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
    returning id, deleted_at
  )
  select r.id,
         r.author_id,
         coalesce(removed.deleted_at, r.deleted_at) as deleted_at,
         (removed.id is not null)                   as took_it_down,
         t.name                                     as tool_name
    from public.reviews r
    join public.tools t on t.id = r.tool_id
    left join removed on removed.id = r.id
   where r.id = $1::bigint`;

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
  /** Who ADDED it: `tools.submitted_by`. Null for a seeded listing. */
  handle: string | null;
  /** Who maintains it NOW: `tools.owner_id`. Null while it is unclaimed. */
  maintainedBy: string | null;
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
  /** Listings this handle ADDED: `tools.submitted_by`. A claim never moves it. */
  toolsAdded: number;
  /** Listings it maintains NOW: `tools.owner_id`. A claim moves this one. */
  toolsMaintained: number;
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
  /* --- the owner's item 10, 14 September 2026 --------------------------- */
  active: ActiveDay[];
  newTools: NewToolsDay[];
  views: ViewsDay[];
  spend: SpendDay[];
  spendTotals: SpendTotals;
  /* --- the owner's item 9 ----------------------------------------------- */
  reports: ReportCounts;
}

/**
 * One row of /admin/reviews.
 *
 * TWO TIMESTAMPS, BECAUSE THERE ARE TWO EVENTS (Phase 8 review, F8).
 * `removedAt` used to be `reviews.deleted_at` — which the AUTHOR sets when
 * they take their own review down — so an author's retraction appeared in the
 * operator's "Removed" section with no reason and no remover, under copy
 * promising both.
 *
 *   removedByAdminAt  a `review_removals` row exists. This, and only this, is
 *                     a takedown.
 *   authorDeletedAt   the author took it down themselves.
 *
 * A review can carry both. `body` is null for one its author retracted with no
 * removal recorded against it: a retracted review's words are not operator
 * data, which is the same category 0015 took `auth.is_admin()` out of
 * `collections_read` for.
 */
/** Accounts whose `last_seen_day` is that day. See admin_active_accounts. */
export interface ActiveDay {
  day: string;
  seen: number;
}

export interface NewToolsDay {
  day: string;
  added: number;
  published: number;
}

export interface ViewsDay {
  day: string;
  views: number;
  /**
   * Whether anything was counting that day at all.
   *
   * It is the difference between "no visits" and "no counter", and the panel
   * draws them differently — §10's rule that nothing shows a 0 where the truth
   * is "not recorded".
   */
  recording: boolean;
}

/** What each of the four paid paths cost on one day, in dollars. */
export interface SpendDay {
  day: string;
  reader: number;
  rerank: number;
  embed: number;
  worker: number;
  /**
   * Whether the ledger existed that day at all — OWNER FEEDBACK, ROUND 1, F8.
   *
   * The same column `ViewsDay` has had since 0024, and for the same reason:
   * the Money chart drew twenty-nine columns of $0.00 for days before the
   * first paid call, which is a measurement nobody made. §10's rule is that
   * nothing draws a 0 where the truth is "not recorded", and the Visits chart
   * had been keeping it on its own.
   */
  recording: boolean;
}

export interface SpendTotals {
  monthToDate: number;
  allTime: number;
  requests: number;
  /** Null until something has been recorded. The panel keys off this. */
  firstDay: string | null;
}

export interface ReportCounts {
  /** Filed inside the window the panel is headed with. */
  received: number;
  /** Unresolved right now, with no window — a backlog does not have one. */
  open: number;
}

/**
 * One report, with the review it is about when it is about one.
 *
 * The review rides along because `admin_reviews` pages over every review ever
 * written and a reported one is not necessarily on the page the Reported tab
 * is showing. Everybody here is a handle: reporter, resolver, author.
 */
export interface AdminReport {
  id: string;
  kind: 'review' | 'tool' | 'profile';
  target: string;
  reason: string;
  details: string | null;
  reporter: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  review: AdminReview | null;
  /**
   * Does the thing this report names still exist? — OWNER FEEDBACK, ROUND 1,
   * F20.
   *
   * The WRITE is permissive on purpose: filing must leak no existence, and a
   * report has to outlive its target, which is frequently why it was filed. So
   * the reader answers the question instead, and the tab marks the rows an
   * operator can stop reading.
   */
  targetResolves: boolean;
  /**
   * For `kind === 'profile'`, that account's handle right now — F21.
   *
   * The row stores `profiles.id`, because a handle is editable and a rename
   * would otherwise re-point an old report at whoever took the name. Null for
   * every other kind, and null for an id that resolves to nobody.
   */
  targetHandle: string | null;
}

/**
 * A page of reports, and how many there are in total.
 *
 * The same shape `AdminReviewPage` has had since the Phase 8 review, for the
 * same reason: the Reported tab drew fifty rows and had no control for the
 * rest, so past fifty open reports the oldest ones fell off the only screen
 * that lists them (OWNER FEEDBACK, ROUND 1, F11).
 */
export interface AdminReportPage {
  rows: AdminReport[];
  total: number;
  /** Unresolved right now, whatever this page holds. The tab's badge. */
  open: number;
  limit: number;
  offset: number;
}

export interface AdminReview {
  id: string;
  toolSlug: string;
  toolName: string;
  handle: string;
  rating: number;
  body: string | null;
  createdAt: string;
  removedByAdminAt: string | null;
  authorDeletedAt: string | null;
  removalReason: string | null;
  removedBy: string | null;
}

/**
 * A page of reviews, and how many there are in total.
 *
 * The page used to ask for 100 and draw what it got, so with more than a
 * hundred reviews the older removals fell off the "Removed" list silently —
 * no pagination, no "showing 100 of N", nothing (Phase 8 review, F8). `total`
 * is `count(*) over ()` from inside `public.admin_reviews`, so it is the count
 * before the limit rather than a second round trip that could disagree.
 */
export interface AdminReviewPage {
  rows: AdminReview[];
  total: number;
  limit: number;
  offset: number;
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
      maintainedBy: maybe(t.maintained_by),
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
      toolsMaintained: num(p.tools_maintained),
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

    active: list(row?.active).map((a) => ({ day: text(a.day), seen: num(a.seen) })),
    newTools: list(row?.new_tools).map((t) => ({
      day: text(t.day),
      added: num(t.added),
      published: num(t.published),
    })),
    views: list(row?.views).map((v) => ({
      day: text(v.day),
      views: num(v.views),
      // `=== true` and never a truthy cast: an absent flag is "nothing was
      // counting", which is the value the panel turns into a gap rather than
      // into a zero.
      recording: v.recording === true,
    })),
    spend: list(row?.spend).map((s) => ({
      day: text(s.day),
      // `numeric` arrives from node-pg as a STRING, on purpose — it is the
      // driver refusing to lose precision on a type JavaScript has no room
      // for. `num` is what turns it into the number the chart needs, and a
      // reader'S $0.00016 survives it.
      reader: num(s.reader),
      rerank: num(s.rerank),
      embed: num(s.embed),
      worker: num(s.worker),
      // F8, and `=== true` for the same reason the line above it gives: an
      // absent flag is "nothing was being recorded", which the chart draws as
      // a hatch rather than as $0.00.
      recording: s.recording === true,
    })),
    spendTotals: toSpendTotals(row?.spend_totals),
    reports: {
      received: num((row?.report_counts as Record<string, unknown> | undefined)?.received),
      open: num((row?.report_counts as Record<string, unknown> | undefined)?.open),
    },
  };
}

function toSentence(s: Record<string, unknown>): Sentence {
  return {
    text: text(s.query_text),
    searches: num(s.searches),
    lastAt: maybe(s.last_at),
  };
}

/**
 * The spend totals, and the one field that decides what the panel says.
 *
 * `first_day` is null until the ledger has a row. The panel keys off it rather
 * than off `all_time === 0`, because zero dollars recorded and no dollars ever
 * recorded are two different facts and §10 forbids drawing the second as the
 * first.
 */
export function toSpendTotals(value: unknown): SpendTotals {
  const t = (value ?? {}) as Record<string, unknown>;
  return {
    monthToDate: num(t.month_to_date),
    allTime: num(t.all_time),
    requests: num(t.requests),
    firstDay: maybe(t.first_day),
  };
}

/**
 * Reports, with the review inlined when there is one.
 *
 * `review` is null for a report about a tool or a profile — their targets are
 * not review ids and `admin_reports` leaves every review column null for them
 * (0027). `review_id` being null is the one test for that, and it is the
 * database's answer rather than this function re-deciding it from `kind`.
 */
export function toAdminReports(value: unknown): AdminReport[] {
  return list(value).map((r) => {
    const kind = text(r.kind);
    return {
      id: String(r.report_id ?? ''),
      kind: kind === 'review' || kind === 'tool' || kind === 'profile' ? kind : 'tool',
      target: text(r.target),
      reason: text(r.reason),
      details: maybe(r.details),
      reporter: maybe(r.reporter),
      createdAt: text(r.created_at),
      resolvedAt: maybe(r.resolved_at),
      resolvedBy: maybe(r.resolved_by),
      resolution: maybe(r.resolution),
      targetResolves: r.target_resolves === true,
      targetHandle: maybe(r.target_handle),
      review:
        r.review_id === null || r.review_id === undefined
          ? null
          : {
              id: String(r.review_id),
              toolSlug: text(r.tool_slug),
              toolName: text(r.tool_name),
              handle: text(r.handle),
              rating: num(r.rating),
              body: maybe(r.body),
              createdAt: text(r.review_created_at),
              removedByAdminAt: maybe(r.removed_by_admin_at),
              authorDeletedAt: maybe(r.author_deleted_at),
              // OWNER FEEDBACK, ROUND 1, F12. These two were `null,` and
              // `null,` — hardcoded, because `admin_reports` declared no such
              // columns even though it already left-joined `review_removals`
              // and read `rr.created_at` on the next line. `Row` is shared
              // with the All and Removed tabs, which get a real reason from
              // `admin_reviews`, so on the Reported tab a removed review
              // rendered "Removed <date>: " and then nothing, under this
              // page's own promise that the reason goes on the record. 0030
              // adds the columns; this maps them.
              removalReason: maybe(r.removal_reason),
              removedBy: maybe(r.removed_by),
            },
    };
  });
}

/**
 * The page, with the count that came back beside the rows.
 *
 * `total` is read from the first row rather than from a second statement, for
 * the reason `toAdminReviewPage` gives: an empty page has no row to read it
 * from and is honestly a total of zero.
 */
export function toAdminReportPage(
  value: unknown,
  open: unknown,
  limit: number,
  offset: number,
): AdminReportPage {
  const rows = toAdminReports(value);
  const first = list(value)[0];
  return { rows, total: num(first?.total), open: num(open), limit, offset };
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
    removedByAdminAt: maybe(r.removed_by_admin_at),
    authorDeletedAt: maybe(r.author_deleted_at),
    removalReason: maybe(r.removal_reason),
    removedBy: maybe(r.removed_by),
  }));
}

/**
 * The page, with the count that came back beside the rows.
 *
 * `total` is read from the first row rather than from a second statement: an
 * empty page has no row to read it from and is honestly a total of zero,
 * because `public.admin_reviews` returns no rows only when there are none in
 * the window at all.
 */
export function toAdminReviewPage(
  value: unknown,
  limit: number,
  offset: number,
): AdminReviewPage {
  const rows = toAdminReviews(value);
  const first = list(value)[0];
  return { rows, total: num(first?.total), limit, offset };
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
 *
 * AND IT IS CLEANED FIRST, which is the Phase 8 review's F10. This was the one
 * person-typed string in the codebase that went to the database exactly as it
 * arrived: every other one goes through `cleanText` and then meets a CHECK
 * built on `public.control_character_class()` (0017, 0018). A reason
 * containing a bell, a start-of-heading, an escape sequence and a
 * right-to-left override was accepted, stored, printed on /admin/reviews,
 * rendered on the author's own Settings page and put into the body of the
 * email telling them their review had come down. HTML was escaped, so this
 * was never a script; it was raw bytes and reversed text in a notice a person
 * reads.
 *
 * `cleanText` is lib/submit.ts's, unchanged and shared on purpose — the same
 * set the database refuses, so the strip and the CHECK cannot drift.
 * ======================================================================== */
export const MIN_REMOVAL_REASON = 8;
export const MAX_REMOVAL_REASON = 500;

export type ReasonProblem = 'short' | 'long' | null;

/**
 * The reason as it will be stored: control characters out, runs of whitespace
 * collapsed, trimmed. What the form was given is never what is written.
 */
export function cleanReason(raw: string): string {
  return cleanText(raw);
}

/** Is this a reason the database will accept? The page asks before posting. */
export function reasonProblem(raw: string): ReasonProblem {
  // Measured AFTER cleaning, so that eight bell characters are not a reason
  // and a sentence is not refused for the invisible thing pasted into it.
  const reason = cleanReason(raw);
  if (reason.length < MIN_REMOVAL_REASON) return 'short';
  if (reason.length > MAX_REMOVAL_REASON) return 'long';
  return null;
}

/* ===========================================================================
 * The reason a REPORT needs — the owner's item 9, 14 September 2026
 *
 * The same numbers and the same cleaning as a removal reason, because they are
 * the same kind of thing: a sentence somebody typed that an operator will read
 * later, stored beside a CHECK built on `public.control_character_class()`.
 * Eight characters is `reports_reason_length`'s own number rather than a
 * second opinion about it, and `cleanText` is the same strip the CHECK
 * mirrors, so the form and the database cannot come to different answers.
 *
 * `details` is optional and longer, and is cleaned the same way. A report with
 * eight characters of reason and nothing else is a valid report — "spam" is
 * not, and that is the whole of why the minimum exists.
 * ======================================================================== */
export const MIN_REPORT_REASON = 8;
export const MAX_REPORT_REASON = 500;
export const MAX_REPORT_DETAILS = 2000;

export const REPORT_KINDS = ['review', 'tool', 'profile'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}

/** What the form will actually send: cleaned, never the raw bytes. */
export function cleanReportText(raw: string, max: number): string {
  return cleanText(raw).slice(0, max);
}

/* ---------------------------------------------------------------------------
 * THE TARGET'S SHAPE, ASKED BEFORE ANYTHING HAPPENS — OWNER FEEDBACK, ROUND 1,
 * F6.
 *
 * Nothing between the form and `reports_target_shaped` validated the target.
 * The most natural mistake anybody could make — choosing "A review" and typing
 * the listing's address — produced NO ROW, an email to the operator saying
 * "Recorded as: NOT RECORDED — the write failed", and this on screen:
 *
 *     "Thank you. The team has been told by email. It could not be added to
 *      the moderation list — that is a fault our end and not yours."
 *
 * It was not a fault our end, the reporter was told the opposite of what had
 * happened, and there was no way to get it right — the review id was rendered
 * nowhere in the product and there was no per-review report link. Both halves
 * are fixed: the id is on the page now (`app/tools/[slug]/page.tsx`), and this
 * is the check that turns a typo into a sentence instead of a dead letter.
 *
 * THREE KINDS, THREE SHAPES, and each is the shape the thing actually has:
 *
 *   review   1 to 18 digits. Eighteen because that is the widest decimal that
 *            always fits in a bigint, which is `reports_target_shaped`'s own
 *            bound since 0030 (F1).
 *   tool     a slug: lowercase letters, digits and hyphens.
 *   profile  a handle: `^[a-z0-9_]{3,24}$`, which is `profiles_handle_format`.
 *            What is STORED for this kind is the profile's id, resolved from
 *            the handle in `app/report/actions.ts` — see F21 there.
 *
 * IT DOES NOT ASK WHETHER THE THING EXISTS, and that is deliberate rather than
 * lazy. A refusal that depended on existence would be an oracle: "is there a
 * user called X" answered to anybody, one form post at a time. Existence is
 * the operator's question and `admin_reports.target_resolves` is where it is
 * answered (F20).
 * ------------------------------------------------------------------------ */

const TARGET_SHAPES: Record<ReportKind, RegExp> = {
  review: /^[0-9]{1,18}$/,
  tool: /^[a-z0-9][a-z0-9-]{0,119}$/,
  profile: /^[a-z0-9_]{3,24}$/,
};

/** What to say when the target is not the shape that kind of thing has. */
export const TARGET_SHAPE_HELP: Record<ReportKind, string> = {
  review:
    'A review is identified by its number — the one beside “Report this review” under it on the '
    + 'tool’s page, like 128. Not the tool’s address.',
  tool: 'A listing is identified by its address, the last part of its page’s URL, like anki.',
  profile: 'A profile is identified by its handle, like priya — letters, digits and underscores.',
};

/**
 * The target as it will be stored.
 *
 * Lowercased for a tool and a profile, because `tools.slug` is `citext` and a
 * handle is lowercase by its own CHECK — somebody typing `Anki` means `anki`,
 * and refusing them over a capital letter would be pedantry with a form in
 * front of it. A review number has no case to fold.
 */
export function normaliseReportTarget(kind: ReportKind, raw: string): string {
  const target = cleanReportText(raw, 200);
  return kind === 'review' ? target : target.toLowerCase();
}

/** Is this target the shape that kind of thing has? The page asks first. */
export function reportTargetProblem(kind: ReportKind, raw: string): 'target' | null {
  return TARGET_SHAPES[kind].test(normaliseReportTarget(kind, raw)) ? null : 'target';
}

/** Is this a reason `public.file_report` will accept? The page asks first. */
export function reportReasonProblem(raw: string): ReasonProblem {
  const reason = cleanReportText(raw, MAX_REPORT_REASON + 1);
  if (reason.length < MIN_REPORT_REASON) return 'short';
  if (reason.length > MAX_REPORT_REASON) return 'long';
  return null;
}
