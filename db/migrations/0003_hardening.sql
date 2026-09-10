-- ===========================================================================
-- Foundit — 0003_hardening
--
-- Four things that were true only because every caller so far happened to
-- behave. An adversarial review reproduced all four against a live database.
-- This migration moves each one from "the caller is careful" to "the database
-- refuses".
--
--   1. search_events.query_hash could be any string at all. The comment in
--      0002 said no caller could pass a hash of something other than the
--      query; foundit_app held a direct INSERT grant and the insert policy is
--      WITH CHECK (true), so that was false. Demonstrated:
--
--        insert into public.search_events (query_text, query_hash, ...)
--        values ('how do I hide money from my ex',
--                'user:dev_person|session:abc123', ...);   -- INSERT 0 1
--
--      query_hash is indexed and admin-readable, so that single string turns
--      the one table in this schema that must never be joinable to a person
--      into a per-user search transcript, with no migration and no review.
--
--   2. profiles_read was USING (true), so is_admin — which decides who
--      reaches the operator dashboard — was readable by anonymous strangers,
--      along with every other column of every profile.
--
--   3. Nothing bounded the length of a search query. A 13,250-character
--      sentence took ~280 ms of CPU per call on the development catalogue,
--      on the one endpoint that is public and unauthenticated.
--
--   4. foundit_app had no way to log in locally, so development measured
--      everything as a BYPASSRLS superuser. That part is not a migration —
--      it is db/docker-compose.dev.yml and .env.local — but §4 below adds
--      the one server-side ceiling that belongs in the schema.
--
-- db/test/search_events_test.sql proves each of these behaviourally.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. search_events — the shape is now the database's business
--
-- The privacy promise on this table is the hardest one the product makes:
-- search text is never joinable to a person. 0001 honours it structurally —
-- eight columns, none of them a person — and 0002's log_search_event takes no
-- user id and returns no row id. But neither of those stops a caller writing
-- an identifier into a column that already exists, and query_hash is a text
-- column with an index on it, which is precisely the shape an attacker (or a
-- well-meaning colleague building "this user's searches") needs.
--
-- Two layers, doing different jobs:
--
--   * A BEFORE INSERT trigger DERIVES query_hash from query_text and caps
--     query_text at 200 characters. Whatever the caller passes for the hash
--     is discarded. This is the layer that actually makes 0002's claim true:
--     the hash is no longer something a caller supplies, it is something the
--     table computes, so there is nothing to forge.
--
--   * Two CHECK constraints assert the resulting shape. Under the trigger
--     they can never fire, and that is the point: they are the written-down
--     invariant, and they are what still holds if the trigger is ever dropped
--     or disabled. Disabling a trigger requires ownership of the table, which
--     foundit_app does not have; dropping a constraint requires the same.
--
-- Why derive rather than reject. A CHECK alone closes the demonstrated attack
-- and nothing more: 'user:dev_person|session:abc123' is refused, but
-- sha256('dev_person') is 64 hex characters and sails through. A constraint
-- cannot tell a hash of a query from a hash of a person. Deriving can, because
-- the caller's value never reaches the table. The only way to smuggle an
-- identifier in now is to change this trigger — a schema change, in a
-- migration, that someone reviews.
--
-- Silent discard rather than a loud error is deliberate: there is no
-- legitimate reason to pass a hash at all, the value is thrown away rather
-- than trusted, and an error would tell whoever tried exactly what the guard
-- is. It also means db/test/rls_test.sql — which inserts a row with the hash
-- 'hash-test' — keeps working unchanged rather than failing on a constraint.
--
-- Why SECURITY DEFINER is not used here. The obvious alternative was to
-- revoke INSERT from foundit_app and make log_search_event the only door,
-- which would force that function to become SECURITY DEFINER. This project
-- treats that as a red flag, and rightly: a definer function runs with its
-- creator's privileges and is an authorization bypass wearing a helpful hat
-- (research/03-security-and-authorization.md §2.4). It would have been
-- defensible here — a validated entry point, widening nobody's visibility —
-- but a BEFORE INSERT trigger reaches the same guarantee with no elevated
-- code path at all, and no privileged function is better than a justified
-- one. So there is no new definer function in this migration.
-- ===========================================================================

-- Existing rows first, so the constraints below can be added VALID rather
-- than NOT VALID. On a fresh database this is a no-op; on a development
-- database it repairs whatever the tests and the review left behind. Every
-- row is rehashed, not just the malformed ones, so that the invariant
-- "query_hash = sha256(normalized query_text)" holds for the whole table
-- rather than only for rows written from here on.
update public.search_events
   set query_text = btrim(left(btrim(coalesce(query_text, '')), 200));

update public.search_events
   set query_hash = encode(
         sha256(convert_to(lower(regexp_replace(query_text, '\s+', ' ', 'g')), 'UTF8')),
         'hex');

-- The normalization is deliberately identical to log_search_event's: trim,
-- collapse runs of whitespace, lower-case, then sha256. That is what makes
-- "Split a  BILL" and "split a bill" one bucket on the aggregate panel, and
-- it must stay in step with 0002 — if one of the two ever changes, the other
-- changes in the same commit.
--
-- One deliberate difference from log_search_event: the hash covers the STORED
-- text, i.e. after the 200-character cap, not the caller's full sentence.
-- log_search_event hashes the untruncated query and stores the truncated one,
-- so for an over-long query its row cannot be checked against itself. Hashing
-- what is stored keeps the table internally consistent, which is the property
-- the CHECK below and the test suite can actually verify. With §3 rejecting
-- queries over 200 characters, no honest caller reaches the difference.
--
-- search_path is pinned to nothing. pg_catalog is still searched implicitly
-- (PostgreSQL always searches it first unless it is named explicitly), so the
-- built-ins below resolve; nothing in public is referenced.
create or replace function public.search_events_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Cap first, then hash what was kept.
  new.query_text := btrim(left(btrim(coalesce(new.query_text, '')), 200));

  -- Whatever the caller put in query_hash is discarded here, unread. This
  -- single assignment is the whole of the guarantee.
  new.query_hash := encode(
    sha256(convert_to(lower(regexp_replace(new.query_text, '\s+', ' ', 'g')), 'UTF8')),
    'hex');

  return new;
end;
$$;

comment on function public.search_events_normalize() is
  'BEFORE INSERT on search_events: caps query_text at 200 characters and '
  'derives query_hash from it, discarding whatever the caller passed. This is '
  'what makes 0002''s claim true — the hash is computed by the table, not '
  'supplied by the caller, so it cannot carry a user id, a session id or '
  'anything else that would make search text joinable to a person. Not '
  'SECURITY DEFINER and does not need to be: it only rewrites NEW.';

drop trigger if exists search_events_normalize on public.search_events;
create trigger search_events_normalize
  before insert on public.search_events
  for each row execute function public.search_events_normalize();

-- The written-down invariant. Unreachable while the trigger is in place, and
-- the backstop the moment it is not.
alter table public.search_events
  add constraint search_events_hash_is_sha256
    check (query_hash ~ '^[0-9a-f]{64}$'),
  add constraint search_events_text_capped
    check (length(query_text) <= 200);

comment on constraint search_events_hash_is_sha256 on public.search_events is
  'query_hash is a hex sha256 and nothing else. It exists to count repeated '
  'queries, not to identify anybody, and a free-text column beside an index '
  'is exactly where a user id ends up if the database does not say no.';

comment on constraint search_events_text_capped on public.search_events is
  'The 200-character cap lived only inside log_search_event, which was never '
  'the only way in. It lives here now, so this table cannot be used as free '
  'text storage.';

-- 0002's comment on log_search_event is replaced rather than left standing:
-- its claim about the hash was the thing that was not true.
comment on function public.log_search_event(text, int, real, boolean, int) is
  'Records one search for the aggregate quality panel. Takes no user id and '
  'returns no row id, on purpose: search text must never become joinable to '
  'a person. It is the intended way in, but it is no longer the only thing '
  'standing between a caller and a forged query_hash — 0003 moved that '
  'guarantee into a BEFORE INSERT trigger on search_events, which derives the '
  'hash from the query text whatever the caller passes.';

comment on policy search_events_insert on public.search_events is
  'Unconditional by design: the table has no user column, so there is no '
  'ownership to assert on insert, and anonymous searches must be counted '
  'too. Confidentiality is enforced on SELECT (admin only), not here. What '
  'this policy deliberately does NOT do is vouch for the row''s contents — '
  'that is the search_events_normalize trigger and the two CHECK constraints '
  'added in 0003.';

-- ===========================================================================
-- 2. profiles — a public face, not a public record
--
-- profiles_read was USING (true). Every column of every row was readable by
-- an anonymous stranger, including is_admin, which is the flag that decides
-- who reaches the operator dashboard. Publishing the list of administrators
-- is publishing the phishing target list, and it was published to anyone who
-- could reach the database through the app.
--
-- The gap was invisible to db/test/rls_test.sql by construction: its "no
-- blanket policy" check only looks at policies whose cmd is INSERT, UPDATE,
-- DELETE or ALL, so a SELECT policy of `true` is exempt. The new test file
-- closes that gap with an explicit allow-list of the SELECT policies that are
-- permitted to be unconditional.
--
-- What is public, and why:
--
--   id            needed to link a review, a listing or a collection to the
--                 person who wrote it. It is already visible in those rows.
--   handle        the @name. It is unique, it is chosen, it is the thing a
--                 profile URL is built from.
--   display_name  rendered on every review byline.
--   avatar_path   rendered beside it.
--   bio           280 characters the person wrote about themselves for other
--                 people to read. Public by intent.
--   created_at    "member since". Nothing about it is sensitive and it helps
--                 a reader weigh a review.
--
-- What is not, and why:
--
--   is_admin      an attack map. Nobody outside the operator tooling needs
--                 it, and the application never has to read the column to
--                 know whether the current user is an admin: auth.is_admin()
--                 answers that already, and has since 0001.
--   plan          whether a person pays us is a commercial fact about them.
--                 No reader of a review needs it.
--   updated_at    no product uses it, and it leaks when someone was last
--                 active. Left out on the "less is better" rule rather than
--                 because it is dangerous.
--
-- So: the TABLE becomes yours-and-the-admins', and the six public columns are
-- exposed through a view. RLS is row-level and cannot mask a column, and
-- column-level GRANTs are role-wide and cannot say "except for the owner", so
-- a projection is the only mechanism that satisfies both halves.
-- ===========================================================================

drop policy profiles_read on public.profiles;

create policy profiles_read on public.profiles for select
  using (id = auth.uid() or auth.is_admin());

comment on policy profiles_read on public.profiles is
  'The whole row — including is_admin and plan — belongs to its owner and to '
  'administrators. Everyone else reads public.profiles_public, which carries '
  'the six columns that are genuinely public. Was USING (true) in 0001, which '
  'published is_admin to anonymous strangers.';

-- security_invoker = false is stated rather than left to the default, so that
-- nobody "fixes" it later without reading this comment. The view is the
-- deliberate public projection of an RLS-protected table: it runs with its
-- owner's rights and therefore sees every row, and the column list — not a
-- policy — is the boundary. That is the same footing auth.is_admin() has
-- stood on since 0001, which is likewise a definer-shaped read of profiles
-- that answers one narrow question.
--
-- The dependency is real and worth naming: the view returns rows only while
-- its owner is not itself subject to profiles' FORCED row-level security. If
-- foundit_owner ever loses BYPASSRLS, this view goes empty rather than wrong,
-- and profiles needs a policy for it or the view needs to become a definer
-- function. db/test/search_events_test.sql asserts the view returns rows to an
-- anonymous reader, so that day arrives as a failing test and not as a blank
-- byline in production.
create or replace view public.profiles_public
  with (security_invoker = false)
  as select p.id,
            p.handle,
            p.display_name,
            p.avatar_path,
            p.bio,
            p.created_at
       from public.profiles p;

comment on view public.profiles_public is
  'The public face of a profile: handle, display name, avatar, bio, and when '
  'they joined. Deliberately does NOT carry is_admin (an attack map) or plan '
  '(a commercial fact about a person). Read this, never public.profiles, '
  'anywhere a stranger might be looking.';

revoke all on public.profiles_public from public;
grant select on public.profiles_public to foundit_app;

-- ===========================================================================
-- 3. A ceiling on the length of a search query
--
-- search_tools is reachable by an anonymous stranger, which makes it the
-- thing an attacker aims at. Nothing bounded p_query: a 13,250-character
-- sentence took ~280 ms of server CPU per call, most of it building a tsquery
-- with hundreds of lexemes and running trigram similarity against it. Phase 4
-- will cap the input at 200 characters in the application, but the database
-- should not be relying on a caller that does not exist yet.
--
-- Reject rather than truncate. Truncating answers a different question than
-- the one that was asked and tells nobody it did so; the UI caps at 200, so
-- the only things that can trip this are a bug or an attempt, and both are
-- worth an error. The error carries the LENGTH and never the query itself —
-- this is the endpoint that collects health, money and relationship trouble,
-- and an error string ends up in a log.
--
-- 200 characters matches the application cap and log_search_event's own
-- left(..., 200) exactly, so all three layers agree on one number.
--
-- Why a wrapper rather than an edit to 0002: this is additive on purpose.
-- 0002's function is renamed to search_tools_impl and keeps its entire body,
-- so whatever that migration says about fusion, weights and RLS stays true of
-- the implementation and stays editable there. The public entry point keeps
-- the exact signature the eval harness is written against, and is SECURITY
-- INVOKER like the function it calls, so row-level security still applies to
-- every table the search touches.
-- ===========================================================================

do $$
begin
  if to_regprocedure(
       'public.search_tools_impl(text, pricing_model[], platform[], tool_flag[], text[], int)'
     ) is null then
    alter function public.search_tools(
      text, pricing_model[], platform[], tool_flag[], text[], int)
      rename to search_tools_impl;
  end if;
end
$$;

comment on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int) is
  'The implementation of search, defined in 0002_search.sql under the name '
  'search_tools and renamed here. Callers use public.search_tools, which is a '
  'thin validating wrapper added in 0003_hardening.sql; everything 0002 says '
  'about ranking, fusion and RLS describes this function.';

create or replace function public.search_tools(
  p_query      text,
  p_pricing    pricing_model[] default null,
  p_platforms  platform[]      default null,
  p_flags      tool_flag[]     default null,
  p_languages  text[]          default null,
  p_limit      int             default 20
)
returns table (
  tool_id      bigint,
  slug         citext,
  name         text,
  summary      text,
  pricing      pricing_model,
  score        real,
  match_source text
)
language plpgsql
stable
-- Same pinned path as the implementation. No SECURITY DEFINER: search runs as
-- the caller, and that is load-bearing (0002, note 1).
set search_path = pg_catalog, public
as $$
declare
  v_len int := length(btrim(coalesce(p_query, '')));
begin
  if v_len > 200 then
    -- 22001 is string_data_right_truncation: a data exception the application
    -- can map to a 400 without having to match on a message. The message
    -- names the length and never the text.
    raise exception 'search query is % characters; the maximum is 200', v_len
      using errcode = '22001',
            hint    = 'Trim the query to 200 characters before searching.';
  end if;

  return query
    select *
      from public.search_tools_impl(
        p_query, p_pricing, p_platforms, p_flags, p_languages, p_limit);
end;
$$;

comment on function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int) is
  'The public entry point for search. Rejects a query longer than 200 '
  'characters with SQLSTATE 22001 — the database''s own ceiling on the one '
  'endpoint an anonymous stranger can reach — and otherwise delegates '
  'unchanged to public.search_tools_impl, which is 0002''s function. Runs as '
  'the caller: no SECURITY DEFINER, so row-level security still applies. '
  'score orders results and is not a calibrated relevance number — never '
  'render it as a percentage.';

-- Functions are executable by PUBLIC on creation. Narrow both to the
-- application role, which is the only thing that should be calling them.
revoke execute on function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int) from public;
revoke execute on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int) from public;
grant execute on function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int) to foundit_app;
grant execute on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int) to foundit_app;

-- ===========================================================================
-- 4. A ceiling on time, not just on length
--
-- The length cap bounds the obvious way to burn a backend. It does not bound
-- a 199-character query that happens to be expensive, or any other statement
-- the application sends. A statement_timeout on the application role bounds
-- all of them.
--
-- 5 seconds, matching the per-query timeout eval/run.mjs already sets, and
-- far above the 150 ms Phase 3 is gated on. This is a DEFAULT rather than a
-- hard ceiling — statement_timeout is USERSET, so the session could raise it
-- — and that is the right shape for the threat: what an attacker controls
-- here is the string in p_query, not the connection. The connection is ours.
-- ===========================================================================
alter role foundit_app set statement_timeout = '5s';

-- --- Who liked what is nobody else's business ---------------------------
-- tool_likes_read was `using (true)`: any anonymous visitor could list every
-- tool a named person had liked, and profiles_public supplies the name to
-- attach it to.
--
-- On most catalogues that is a shrug. Not on this one. Foundit lists tools for
-- leaving an abusive partner, hiding money from someone, managing an illness,
-- and encrypting messages. A public per-person like list is the same category
-- of harm that search_events exists to prevent, and worse, because it arrives
-- already attributed to a name.
--
-- The COUNT stays public -- it is on tools.like_count, maintained by trigger,
-- and it is what the interface actually renders. Only the attribution becomes
-- private. docs/product-decisions.md §10 lists "likes given" as public
-- activity in the OPERATOR dashboard, and auth.is_admin() below keeps that
-- working; it never said a stranger may enumerate them.
drop policy if exists tool_likes_read on public.tool_likes;
create policy tool_likes_read on public.tool_likes for select
  using (user_id = auth.uid() or auth.is_admin());

comment on policy tool_likes_read on public.tool_likes is
  'Your own likes and an admin''s view. Counts are public via tools.like_count; '
  'who liked what is not, because this catalogue lists tools whose use is '
  'itself sensitive.';

commit;
