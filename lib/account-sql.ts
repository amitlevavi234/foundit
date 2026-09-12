/**
 * The statements a signed-in person's screens send, and the marshalling around
 * them — separated from the connection pool exactly as lib/sql.ts is, so that
 * both can be read, reviewed and exercised without a database.
 *
 * Nothing in here opens a socket and nothing in here decides anything. Every
 * one of these statements is sent inside `withIdentity` (lib/db.ts), which
 * means `auth.uid()` is set for the length of the transaction and the policies
 * in 0001 and 0013 decide which rows it may touch. There is deliberately no
 * `where owner_id = $2` anywhere below that could be got wrong: the WHERE
 * clause that matters is the policy, and a statement that returns no rows is
 * the database saying no.
 *
 * ONE ROUND TRIP PER SCREEN, the same rule the catalogue screens follow. The
 * saved list and the collection it is showing arrive in one statement; a
 * public collection and its owner's byline arrive in one; the tool page's
 * "have I liked this, have I saved it, did I review it" arrives in one beside
 * the page's own.
 */
import type { PricingModel } from './types';

/* ===========================================================================
 * Reads
 * ======================================================================== */

/**
 * The signed-in person's own profile row. Not profiles_public: this is them.
 *
 * IT ALSO STAMPS "LAST SEEN", AND THAT IS WHY IT IS HERE rather than in a call
 * of its own. This is the statement every signed-in request already sends, so
 * folding `public.note_seen_today()` into its select list makes the operator
 * dashboard's People panel honest at the cost of no extra round trip. The
 * function writes `current_date` onto `auth.uid()`'s own row and only on the
 * first request of a day — the second finds no row to update and writes
 * nothing at all, so `profiles.updated_at` does not move either (0019 §2).
 *
 * The column it returns is not read by anything on this side; it is selected
 * so the call is part of the statement rather than a discarded expression a
 * future refactor would delete as dead.
 */
export const VIEWER_SQL = `
  select p.id,
         p.handle::text as handle,
         p.display_name,
         p.bio,
         p.is_admin,
         public.note_seen_today() as last_seen_day
    from public.profiles p
   where p.id = auth.uid()`;

/**
 * Create the profile for a person who has just signed in for the first time.
 *
 * `on conflict do nothing` covers both ways this can lose a race: the id is
 * already there (two tabs, one new account) and the handle is taken (two
 * people called sam). The caller distinguishes them by asking again, and walks
 * `handleCandidates` until one lands.
 *
 * The row is stamped with `auth.uid()` rather than with the id the caller
 * passed, so a bug in the caller cannot create a profile for somebody else —
 * `profiles_insert` would refuse it anyway, and this is the same sentence said
 * twice on purpose.
 */
export const CREATE_PROFILE_SQL = `
  insert into public.profiles (id, handle, display_name)
  values (auth.uid(), $1::citext, $2::text)
  on conflict do nothing
  returning handle::text as handle`;

/**
 * Everything /saved draws: every collection this person has, and the contents
 * of the one they are looking at.
 *
 * $1 is the slug of the collection to open, or null for "the first one".
 */
export const SAVED_SQL = `
  with cols as (
    select c.id,
           c.slug::text as slug,
           c.name,
           c.description,
           c.share_token,
           c.created_at,
           (select count(*) from public.collection_items ci
             where ci.collection_id = c.id) as item_count
      from public.collections c
     where c.owner_id = auth.uid()
  ),
  chosen as (
    select * from cols
     where $1::text is null or slug = $1::text
     order by created_at, id
     limit 1
  ),
  items as (
    select t.slug::text as slug,
           t.name,
           t.summary,
           t.url,
           t.pricing::text as pricing,
           t.like_count,
           t.rating_avg,
           ci.note,
           ci.created_at
      from public.collection_items ci
      join public.tools t on t.id = ci.tool_id
     where ci.collection_id = (select id from chosen)
       and t.status = 'published'
     order by ci.created_at desc, t.id
  )
  select (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
            from cols x) as collections,
         (select to_jsonb(x) from chosen x) as chosen,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
            from items x) as items`;

/**
 * A shared collection, by its token.
 *
 * The token is a parameter here AND a transaction setting the policy reads —
 * `withIdentity` puts it there. Both are needed and they do different jobs:
 * the setting is what makes the row visible at all, and the parameter is what
 * picks it out. Getting the first one wrong returns nothing rather than
 * returning somebody else's list.
 */
export const SHARED_COLLECTION_SQL = `
  with c as (
    select id, slug::text as slug, name, description, updated_at, owner_id
      from public.collections
     where share_token = $1::text
  ),
  owner as (
    select p.handle::text as handle, p.display_name
      from public.profiles_public p
     where p.id = (select owner_id from c)
  ),
  items as (
    select t.slug::text as slug,
           t.name,
           t.summary,
           t.url,
           t.pricing::text as pricing,
           t.like_count,
           t.rating_avg,
           ci.note,
           ci.created_at
      from public.collection_items ci
      join public.tools t on t.id = ci.tool_id
     where ci.collection_id = (select id from c)
       and t.status = 'published'
     order by ci.created_at desc, t.id
  )
  select (select to_jsonb(x) from c x) as collection,
         (select to_jsonb(x) from owner x) as owner,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
            from items x) as items
   where exists (select 1 from c)`;

/**
 * A public profile, by handle.
 *
 * It reads `profiles_public` and never `profiles`, which is the whole of the
 * difference: the view carries the six columns that are genuinely public and
 * leaves out `is_admin` (an attack map) and `plan` (a commercial fact about a
 * person). 0003_hardening.sql has the long version.
 *
 * What it shows is what that person did IN PUBLIC: listings they added, and
 * reviews they wrote. Not their likes, which 0003 made private for a reason.
 * Not their collections either — a shared collection's address IS its
 * permission, so listing them here would turn "anybody with the link" into
 * "anybody".
 */
export const PUBLIC_PROFILE_SQL = `
  with p as (
    select id, handle::text as handle, display_name, bio, created_at
      from public.profiles_public
     where handle = $1::citext
  ),
  listings as (
    select t.slug::text as slug, t.name, t.summary, t.pricing::text as pricing,
           t.like_count, t.rating_avg, t.id,
           (t.owner_id = (select id from p)) as maintained
      from public.tools t
     where t.status = 'published'
       and ((select id from p) is not null)
       and (t.owner_id = (select id from p) or t.submitted_by = (select id from p))
     order by t.like_count desc, t.id
     limit $2::int
  ),
  revs as (
    select r.rating, r.body, r.created_at,
           t.slug::text as tool_slug, t.name as tool_name, r.id
      from public.reviews r
      join public.tools t on t.id = r.tool_id
     where r.author_id = (select id from p)
       and r.deleted_at is null
       and t.status = 'published'
     order by r.created_at desc, r.id desc
     limit $3::int
  ),
  counts as (
    select (select count(*) from public.tools t
             where t.status = 'published'
               and (t.owner_id = (select id from p) or t.submitted_by = (select id from p)))
             as listing_count,
           (select count(*) from public.reviews r
              join public.tools t on t.id = r.tool_id
             where r.author_id = (select id from p)
               and r.deleted_at is null and t.status = 'published') as review_count
  )
  select (select to_jsonb(x) from p x) as profile,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.like_count desc, x.id), '[]'::jsonb)
            from listings x) as listings,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
            from revs x) as reviews,
         (select to_jsonb(x) from counts x) as counts
   where exists (select 1 from p)`;

/**
 * What this particular person has already done to this particular tool: liked
 * it, saved it into which of their collections, and reviewed it.
 *
 * A second round trip beside the tool page's own, and deliberately so. The
 * page itself is cached for a minute for everybody — it is the same page for
 * every visitor — and the day a per-person answer went into that cache it
 * would be served to the next stranger who asked. So identity-shaped reads
 * never go near `unstable_cache`; they get their own statement, under a claim,
 * and it is one statement rather than four.
 */
export const TOOL_VIEWER_SQL = `
  with t as (
    select id from public.tools where slug = $1::citext and status = 'published'
  ),
  cols as (
    select c.id, c.slug::text as slug, c.name,
           exists (select 1 from public.collection_items ci
                    where ci.collection_id = c.id and ci.tool_id = (select id from t)) as holds
      from public.collections c
     where c.owner_id = auth.uid()
  ),
  mine as (
    select r.id, r.rating, r.body, r.created_at, r.updated_at
      from public.reviews r
     where r.tool_id = (select id from t)
       and r.author_id = auth.uid()
       and r.deleted_at is null
  )
  select exists (select 1 from public.tool_likes l
                  where l.tool_id = (select id from t) and l.user_id = auth.uid()) as liked,
         (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from cols x)
           as collections,
         (select to_jsonb(x) from mine x) as review`;

/**
 * The same three answers as TOOL_VIEWER_SQL, for a whole page of results at
 * once: which of these the person has liked, which of their collections hold
 * which of them, and what those collections are called.
 *
 * ONE STATEMENT FOR TWELVE CARDS. A per-card query would be the N+1 this
 * codebase exists to make impossible — and worse than the usual N+1, because
 * each one would open its own transaction and set its own claim.
 */
export const LIBRARY_FOR_SLUGS_SQL = `
  with t as (
    select id, slug::text as slug
      from public.tools
     where slug = any($1::citext[]) and status = 'published'
  ),
  cols as (
    select c.id, c.slug::text as slug, c.name
      from public.collections c
     where c.owner_id = auth.uid()
  ),
  liked as (
    select t.slug
      from public.tool_likes l
      join t on t.id = l.tool_id
     where l.user_id = auth.uid()
  ),
  holds as (
    select t.slug, ci.collection_id
      from public.collection_items ci
      join t on t.id = ci.tool_id
     where ci.collection_id in (select id from cols)
  )
  select (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from cols x)
           as collections,
         (select coalesce(jsonb_agg(x.slug), '[]'::jsonb) from liked x) as liked,
         (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from holds x) as holds`;

/* ===========================================================================
 * Writes
 *
 * Every one of them is scoped by a policy rather than by a predicate this file
 * could get wrong, and every one reports what the database did — a row count,
 * never an assumption.
 * ======================================================================== */

export const LIKE_SQL = `
  insert into public.tool_likes (user_id, tool_id)
  select auth.uid(), t.id from public.tools t
   where t.slug = $1::citext and t.status = 'published'
  on conflict do nothing`;

export const UNLIKE_SQL = `
  delete from public.tool_likes
   where user_id = auth.uid()
     and tool_id = (select id from public.tools where slug = $1::citext)`;

export const CREATE_COLLECTION_SQL = `
  insert into public.collections (owner_id, name, slug, description)
  values (auth.uid(), $1::text, $2::citext, nullif($3::text, ''))
  on conflict do nothing
  returning id, slug::text as slug`;

export const RENAME_COLLECTION_SQL = `
  update public.collections
     set name = $2::text, description = nullif($3::text, '')
   where id = $1::bigint
  returning id`;

export const DELETE_COLLECTION_SQL = `
  delete from public.collections where id = $1::bigint returning id`;

/**
 * Turn sharing on, and read back the address the database minted.
 *
 * THE TOKEN IS NOT SENT FROM HERE any more, and that is the Phase 6 review's
 * F7. It used to be `crypto.randomBytes` in lib/accounts.ts, written as a
 * parameter — which meant the only thing keeping a share token unguessable was
 * this statement being the only statement anybody ever sent. 0015 made it the
 * database's: `foundit_app` holds no UPDATE privilege on the column, a
 * client-supplied value is an error rather than a value to overwrite, and the
 * trigger writes 32 hex characters from `gen_random_uuid()` when `is_public`
 * goes true.
 *
 * `where share_token is null` stays: pressing Share twice does not mint a
 * second address for the same list and quietly invalidate the one already in
 * somebody's chat window.
 */
export const SHARE_COLLECTION_SQL = `
  update public.collections
     set is_public = true
   where id = $1::bigint and share_token is null
  returning share_token`;

/** And off. The token goes with it, written by the same trigger. */
export const UNSHARE_COLLECTION_SQL = `
  update public.collections
     set is_public = false
   where id = $1::bigint
  returning id`;

export const SAVE_TOOL_SQL = `
  insert into public.collection_items (collection_id, tool_id, note)
  select $1::bigint, t.id, nullif($3::text, '')
    from public.tools t
   where t.slug = $2::citext and t.status = 'published'
  on conflict (collection_id, tool_id) do update set note = excluded.note
  returning collection_id`;

export const UNSAVE_TOOL_SQL = `
  delete from public.collection_items
   where collection_id = $1::bigint
     and tool_id = (select id from public.tools where slug = $2::citext)
  returning collection_id`;

/**
 * One review per person per tool, written or rewritten.
 *
 * The ON CONFLICT target carries the index's own predicate because the unique
 * index is partial — `reviews_one_live_per_author ... where deleted_at is
 * null` — so that taking a review down and writing a new one is possible and
 * two live ones are not.
 */
export const UPSERT_REVIEW_SQL = `
  insert into public.reviews (tool_id, author_id, rating, body)
  select t.id, auth.uid(), $2::smallint, nullif($3::text, '')
    from public.tools t
   where t.slug = $1::citext and t.status = 'published'
  on conflict (tool_id, author_id) where deleted_at is null
  do update set rating = excluded.rating, body = excluded.body
  returning id`;

export const DELETE_OWN_REVIEW_SQL = `
  update public.reviews
     set deleted_at = now()
   where tool_id = (select id from public.tools where slug = $1::citext)
     and author_id = auth.uid()
     and deleted_at is null
  returning id`;

/**
 * One click on the link out to a maker's site.
 *
 * A function call and not an UPDATE, because `foundit_app` holds no UPDATE
 * privilege on `tools.open_count` and should not: a counter anybody signed in
 * could write is a counter nobody should read. 0019 §3 is the writer, it takes
 * the slug and nothing else, and it returns nothing.
 */
export const RECORD_TOOL_OPEN_SQL = `select public.record_tool_open($1::citext)`;

export const UPDATE_PROFILE_SQL = `
  update public.profiles
     set display_name = nullif($1::text, ''),
         bio          = nullif($2::text, ''),
         handle       = coalesce($3::citext, handle)
   where id = auth.uid()
  returning handle::text as handle`;

/**
 * The whole of deletion on this side of the boundary.
 *
 * One row. 0001's cascades take the reviews, likes, collections, saved items
 * and claims with it, and leave the listings this person added with nobody's
 * name on them. `search_events` is untouched because it never held anything of
 * theirs — that is what the column that does not exist is for.
 */
export const DELETE_ACCOUNT_SQL = `
  delete from public.profiles where id = auth.uid() returning id`;

/* ===========================================================================
 * Naming a collection
 * ======================================================================== */

/**
 * The address of a collection, from what somebody called it.
 *
 * `collections.slug` is citext and unique per owner, with no CHECK on its
 * shape — so this is where the shape is decided, and it is decided narrowly:
 * lower case, `[a-z0-9-]`, no leading or trailing dash, 40 characters.
 *
 * A name in another script produces nothing usable, and rather than
 * transliterating somebody's Hebrew or Russian into a guess, it falls back to
 * `list`. The caller appends a number when that is taken, so ten collections
 * named in Hebrew are `list`, `list-2`, `list-3` — plain, and the NAME above
 * them is still what they typed.
 */
export function collectionSlug(name: string): string {
  const cleaned = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return cleaned === '' ? 'list' : cleaned;
}

/** `slug`, `slug-2`, `slug-3` … for the caller to walk until one is free. */
export function collectionSlugCandidates(name: string, attempts = 50): string[] {
  const stem = collectionSlug(name);
  const out = [stem];
  for (let n = 2; n <= attempts; n += 1) out.push(`${stem.slice(0, 36)}-${n}`);
  return out;
}

/* ===========================================================================
 * The shapes that come back
 * ======================================================================== */

export interface Viewer {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  isAdmin: boolean;
}

export interface CollectionSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  itemCount: number;
  shared: boolean;
  shareToken: string | null;
}

export interface SavedTool {
  slug: string;
  name: string;
  summary: string;
  url: string;
  pricing: PricingModel;
  likeCount: number;
  rating: number | null;
  note: string | null;
}

export interface SavedPage {
  collections: CollectionSummary[];
  chosen: CollectionSummary | null;
  items: SavedTool[];
}

export interface SharedCollection {
  name: string;
  description: string | null;
  updatedAt: string;
  ownerHandle: string | null;
  ownerName: string | null;
  items: SavedTool[];
}

export interface PublicListing {
  slug: string;
  name: string;
  summary: string;
  pricing: PricingModel;
  likeCount: number;
  rating: number | null;
  maintained: boolean;
}

export interface PublicReview {
  rating: number;
  body: string | null;
  createdAt: string;
  toolSlug: string;
  toolName: string;
}

export interface PublicProfile {
  handle: string;
  displayName: string | null;
  bio: string | null;
  createdAt: string;
  listingCount: number;
  reviewCount: number;
  listings: PublicListing[];
  reviews: PublicReview[];
}

export interface ViewerReview {
  id: string;
  rating: number;
  body: string | null;
}

export interface ToolViewerState {
  liked: boolean;
  collections: Array<{ id: string; slug: string; name: string; holds: boolean }>;
  review: ViewerReview | null;
}

/* ===========================================================================
 * Row mapping. Pure, so tests/account-sql.test.mjs can drive every one of
 * these against a fake executor and watch the parameters that go out.
 * ======================================================================== */

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

interface CollectionRow {
  id: string | number;
  slug: string;
  name: string;
  description: string | null;
  share_token: string | null;
  item_count: string | number;
}

export function toCollection(row: CollectionRow): CollectionSummary {
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    itemCount: num(row.item_count),
    shared: row.share_token !== null,
    shareToken: row.share_token,
  };
}

interface SavedToolRow {
  slug: string;
  name: string;
  summary: string;
  url: string;
  pricing: PricingModel;
  like_count: string | number;
  rating_avg: string | number | null;
  note: string | null;
}

export function toSavedTool(row: SavedToolRow): SavedTool {
  return {
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    url: row.url,
    pricing: row.pricing,
    likeCount: num(row.like_count),
    rating: numOrNull(row.rating_avg),
    note: row.note,
  };
}

export function toSavedPage(row: {
  collections: CollectionRow[] | null;
  chosen: CollectionRow | null;
  items: SavedToolRow[] | null;
}): SavedPage {
  return {
    collections: (row.collections ?? []).map(toCollection),
    chosen: row.chosen ? toCollection(row.chosen) : null,
    items: (row.items ?? []).map(toSavedTool),
  };
}

export function toSharedCollection(row: {
  collection: { name: string; description: string | null; updated_at: string };
  owner: { handle: string; display_name: string | null } | null;
  items: SavedToolRow[] | null;
}): SharedCollection {
  return {
    name: row.collection.name,
    description: row.collection.description,
    updatedAt: row.collection.updated_at,
    ownerHandle: row.owner?.handle ?? null,
    ownerName: row.owner?.display_name ?? null,
    items: (row.items ?? []).map(toSavedTool),
  };
}

export function toPublicProfile(row: {
  profile: { handle: string; display_name: string | null; bio: string | null; created_at: string };
  listings:
    | Array<{
        slug: string;
        name: string;
        summary: string;
        pricing: PricingModel;
        like_count: string | number;
        rating_avg: string | number | null;
        maintained: boolean;
      }>
    | null;
  reviews:
    | Array<{
        rating: number;
        body: string | null;
        created_at: string;
        tool_slug: string;
        tool_name: string;
      }>
    | null;
  counts: { listing_count: string | number; review_count: string | number };
}): PublicProfile {
  return {
    handle: row.profile.handle,
    displayName: row.profile.display_name,
    bio: row.profile.bio,
    createdAt: row.profile.created_at,
    listingCount: num(row.counts?.listing_count),
    reviewCount: num(row.counts?.review_count),
    listings: (row.listings ?? []).map((l) => ({
      slug: l.slug,
      name: l.name,
      summary: l.summary,
      pricing: l.pricing,
      likeCount: num(l.like_count),
      rating: numOrNull(l.rating_avg),
      maintained: Boolean(l.maintained),
    })),
    reviews: (row.reviews ?? []).map((r) => ({
      rating: num(r.rating),
      body: r.body,
      createdAt: r.created_at,
      toolSlug: r.tool_slug,
      toolName: r.tool_name,
    })),
  };
}

/**
 * One `ToolViewerState` per slug, out of the one statement above.
 *
 * Marshalling, not filtering: every row the database returned is used, and
 * nothing here decides what a person may see.
 */
export function toLibrary(
  slugs: readonly string[],
  row: {
    collections: Array<{ id: string | number; slug: string; name: string }> | null;
    liked: string[] | null;
    holds: Array<{ slug: string; collection_id: string | number }> | null;
  },
): Map<string, ToolViewerState> {
  const collections = (row.collections ?? []).map((c) => ({
    id: String(c.id),
    slug: c.slug,
    name: c.name,
  }));
  const liked = new Set(row.liked ?? []);
  const held = new Map<string, Set<string>>();
  for (const hold of row.holds ?? []) {
    const set = held.get(hold.slug) ?? new Set<string>();
    set.add(String(hold.collection_id));
    held.set(hold.slug, set);
  }

  const out = new Map<string, ToolViewerState>();
  for (const slug of slugs) {
    const holdsHere = held.get(slug) ?? new Set<string>();
    out.set(slug, {
      liked: liked.has(slug),
      collections: collections.map((c) => ({ ...c, holds: holdsHere.has(c.id) })),
      review: null,
    });
  }
  return out;
}

export function toToolViewerState(row: {
  liked: boolean;
  collections: Array<{ id: string | number; slug: string; name: string; holds: boolean }> | null;
  review: { id: string | number; rating: number; body: string | null } | null;
}): ToolViewerState {
  return {
    liked: Boolean(row.liked),
    collections: (row.collections ?? []).map((c) => ({
      id: String(c.id),
      slug: c.slug,
      name: c.name,
      holds: Boolean(c.holds),
    })),
    review: row.review
      ? { id: String(row.review.id), rating: num(row.review.rating), body: row.review.body }
      : null,
  };
}
