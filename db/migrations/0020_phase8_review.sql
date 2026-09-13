-- ===========================================================================
-- Foundit — 0020_phase8_review
--
-- What Phase 8's adversarial review found in the database, and the rules that
-- close it. The review is quoted finding by finding in docs/loop-progress.md;
-- this file is the half of the answer that is SQL, and db/test/admin_test.sql
-- grows a section beside every part of it.
--
-- THE ONE THAT MATTERS IS F1, AND IT IS NOT ABOUT ONE FUNCTION.
--
-- `public.record_tool_open` (0019 §3) updates `public.tools`, which is FORCE
-- ROW LEVEL SECURITY, and it does so outside 0014's `foundit.counters`
-- window. The only two UPDATE policies on that table are `tools_update`
-- (`tool_is_mine(id)`, false for an anonymous clicker) and `tools_counters`
-- (the setting, which that function never turns on), so the statement matches
-- no policy and updates ZERO ROWS. An UPDATE that matches nothing is a
-- success, so nothing is raised and nothing is logged: "Opened from Foundit"
-- would have gone back to 0 on every listing with nothing anywhere saying why.
--
-- It passed every test only because `foundit_owner` was a SUPERUSER in the
-- development container and in CI, and superusers bypass row-level security
-- entirely. research/08 §9.3 — the researched server layout — has never
-- created it that way.
--
-- So the instance is fixed in §1 and THE CLASS IS FIXED IN §2. As of
-- 13 September 2026 `foundit_owner` is NOSUPERUSER NOBYPASSRLS in
-- db/dev-roles.sql and in .github/workflows/ci.yml, which immediately turned
-- eight more silent failures into loud ones:
--
--   public.store_query_reading, store_query_rerank, store_query_embedding and
--   the three touch_query_* functions write `query_readings`,
--   `query_reranks` and `query_embeddings` — three tables with RLS ENABLED,
--   FORCED, AND NO POLICY AT ALL. Every model answer this product pays for
--   would have failed to cache, silently, and every cache read would have
--   missed.
--   public.queue_embedding, embedding_work, embedding_job_done and
--   embedding_job_failed write `embedding_jobs`, which is the same shape — so
--   no listing would ever have been embedded.
--   public.log_search_event_tools inserts `search_event_tools`, which has a
--   read policy and no write policy, so no search would ever have recorded
--   which listings it returned — and `public.admin_catalogue_unmatched`, one
--   of THIS PHASE'S OWN PANELS, reads the same table under a maker's or an
--   operator's identity.
--   public.store_tool_embedding and store_problem_embedding update `tools`
--   and `tool_problems` as the embedding role, which maintains nothing, so
--   `tool_is_mine` is false and no vector would ever have been written.
--   public.claim_tool and reassign_tool_owner change a listing's owner, which
--   by definition is a listing the caller does not yet maintain.
--   public.maker_search_demand and maker_listing_metrics read
--   `search_event_tools` as a maker, and `search_event_tools_read` is
--   `auth.is_admin()`.
--
-- Every one of those is the same defect as F1: a SECURITY DEFINER function
-- written on the assumption that running "as the owner" means running past
-- row-level security. It does not, and on the server it never would have.
--
-- WHAT §2 DOES ABOUT IT, and why it is not a hole. It is 0014's mechanism,
-- generalised and named. 0014 gave `public.tools` one UPDATE policy
-- `TO foundit_owner` gated on `current_setting('foundit.counters') = 'on'`,
-- turned on by three fixed functions for the length of their own statement.
-- §2 does the same with one setting, `foundit.definer`, and every word is
-- load-bearing in the same way:
--
--   TO foundit_owner   it does not apply to foundit_app, foundit_embed or
--                      foundit_auth at all. Policies are role-scoped, none of
--                      those three is a member of foundit_owner, and none of
--                      them may SET ROLE to it.
--   USING a setting    and never `true`. The window is opened by a function's
--                      own `SET` clause, which PostgreSQL applies on entry and
--                      RESTORES ON EXIT — including on an exception — so it
--                      is open for the body of one named function and for no
--                      longer. A stray owner connection has no window at all
--                      until it says so out loud.
--   ONE COMMAND EACH   a function that only reads gets SELECT; a function that
--                      only inserts gets INSERT. Nothing gets `for all` that
--                      does not need all of it.
--
-- The list of functions that open it is the list below and nothing else, and
-- db/test/admin_test.sql §11 reads that list back out of the catalogue and
-- fails if a function acquires the window without appearing in it.
--
-- ONE THING THIS MIGRATION NEEDS FROM THE BOOTSTRAP, and it is the only such
-- thing in nineteen migrations: `foundit.definer` is a custom parameter no
-- extension has registered, and PostgreSQL requires superuser or an explicit
-- parameter privilege to write one into a catalogue entry with ALTER
-- FUNCTION ... SET. So db/dev-roles.sql and .github/workflows/ci.yml both run
-- `grant set on parameter "foundit.definer" to foundit_owner` as the
-- superuser, beside the other things only a superuser can do — creating the
-- `vector` extension, which is not trusted, and handing the schemas to the
-- owner. It grants no runtime power the owner did not already have: a custom
-- parameter is PGC_USERSET, so `set_config` inside a transaction was always
-- available, which is how 0014's window has worked since Phase 6.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- 1. F1 — the click counts on a database whose owner is not a superuser
--
-- The body is 0019's, wrapped in 0014's window exactly as
-- `public.tool_likes_count` wraps its own UPDATE: on, one statement, off. The
-- window is closed explicitly rather than left to the transaction, for the
-- reason 0014 gives — a function that returns with the flag still on hands
-- whatever runs next the same power, and the next thing along is not
-- necessarily this migration's.
--
-- Everything 0019 §3 says about this function is still true: one argument and
-- it is the listing, no visitor argument, no setting read about the caller,
-- nothing returned and nothing logged.
-- ===========================================================================
create or replace function public.record_tool_open(p_slug citext)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform pg_catalog.set_config('foundit.counters', 'on', true);
  update public.tools
     set open_count = open_count + 1
   where slug = p_slug
     and status = 'published';
  perform pg_catalog.set_config('foundit.counters', 'off', true);
end;
$fn$;

comment on function public.record_tool_open(citext) is
  'Count one click on the link out to a maker''s site. One argument, and it '
  'is the listing: no visitor argument, no setting read, no row returned and '
  'nothing logged, so the number can never become a record of who went where. '
  'Published listings only. The UPDATE runs inside 0014''s foundit.counters '
  'window, because public.tools is FORCE ROW LEVEL SECURITY and an anonymous '
  'clicker maintains nothing — without the window this counted nothing at all '
  'on any database whose owner is not a superuser, which is every database '
  'this will ever run on. docs/product-decisions.md §12.';

-- ===========================================================================
-- 2. THE OWNER'S WINDOW — the class F1 belongs to
--
-- One policy per table in `public`, every one of them the same three lines,
-- every one scoped TO foundit_owner and gated on `foundit.definer`. Uniform on
-- purpose: a rule with holes in it is a rule nobody can check, and the holes
-- are exactly where the next silent no-op would be.
--
-- WHAT THIS DOES NOT CHANGE. An owner connection could always have dropped a
-- policy; it owns the tables. FORCE ROW LEVEL SECURITY has never protected
-- this database from what the owner INTENDS — it protects it from what the
-- owner does by accident, and until now the accident was silent. What the
-- window adds is that the owner has to SAY it is reaching past a policy, and
-- that everything which does not say so now gets an error where it used to
-- get `UPDATE 0`.
--
-- WHAT OPENS IT, exhaustively:
--
--   * the SECURITY DEFINER functions listed at the end of this section,
--     through their own SET clause, which PostgreSQL applies on entry and
--     RESTORES ON EXIT — including on an exception — so the window is open
--     for the body of one named function and not one statement longer;
--   * db/seed/dev_seed.sql, which is the owner loading the development
--     catalogue past the policies that protect a real one, and says so in its
--     own header;
--   * three named fixtures in db/test/, each carrying a comment saying why
--     there is no function that could have planted that row.
--
-- Nothing else. db/test/admin_test.sql §11 reads the list of functions
-- carrying the clause back out of the catalogue and fails on any that is not
-- in the allowlist there, so a function added later cannot acquire the window
-- without somebody editing that list on purpose.
--
-- WHAT CANNOT OPEN IT: foundit_app, foundit_embed and foundit_auth. Policies
-- are role-scoped, none of the three is a member of foundit_owner, and none
-- may SET ROLE to it — so an application session that sets `foundit.definer`
-- to whatever it likes gains exactly nothing. That is the same argument 0014
-- makes about `foundit.counters`, and it is why the window is a setting
-- rather than `true`.
-- ===========================================================================
do $win$
declare
  t text;
begin
  foreach t in array array[
    -- The three query caches and the embedding queue. These four had RLS
    -- enabled, forced, AND NO POLICY AT ALL, which was deliberate: the only
    -- door is meant to be the definer function and a policy would be a second
    -- door. The reasoning was right and the implementation rested on an
    -- attribute the server does not have, so the door was shut on the
    -- function too — no model answer cached, no cache read served, no listing
    -- ever queued for embedding.
    'query_embeddings', 'query_readings', 'query_reranks', 'embedding_jobs',
    -- Which listings a search returned. `search_event_tools_read` is
    -- auth.is_admin(), which is the right rule for the table and the wrong
    -- one for its own writer: that row is written by the search path with no
    -- identity at all. It is also read by public.maker_search_demand under a
    -- maker's identity and by public.admin_catalogue_unmatched, whose NOT
    -- EXISTS over rows row-level security had filtered away answered "never
    -- matched by a search" for every listing in the catalogue.
    'search_event_tools',
    -- The catalogue. A vector is written by the embedding role, which
    -- maintains nothing; a claim and a reassignment change who maintains a
    -- listing, so by definition the caller does not maintain it yet. 0014's
    -- tools_counters policy is untouched and still covers the counters, which
    -- is the window public.record_tool_open opens in §1 above.
    'tools', 'tool_problems', 'tool_categories', 'categories',
    -- The record of a listing changing hands. `ownership_changes` has a read
    -- policy and no write policy at all, and public.reassign_tool_owner is
    -- the only writer it has ever had.
    'ownership_changes', 'tool_claims',
    -- People and what they wrote. Only the development seed reaches these as
    -- the owner. The rules that make "removing is not editing" true are
    -- TRIGGERS rather than policies (0013 §7, 0015 §1), so they still apply
    -- to the owner here, window or no window.
    'profiles', 'reviews', 'review_removals', 'tool_likes',
    'collections', 'collection_items',
    -- And the search log. Its INSERT policy is already `true` for everybody
    -- and its SELECT policy is auth.is_admin(); it is in this list for the
    -- reason the list is uniform, and because the owner reading its own
    -- search log to check something should have to say so rather than quietly
    -- be handed an empty answer.
    'search_events'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to foundit_owner '
      '  using      (pg_catalog.current_setting(%L, true) = %L) '
      '  with check (pg_catalog.current_setting(%L, true) = %L)',
      t || '_definer', t, 'foundit.definer', 'on', 'foundit.definer', 'on');
  end loop;
end
$win$;

comment on policy query_readings_definer on public.query_readings is
  'The owner''s window (0020 §2), on every table in public and worded the '
  'same on each. TO foundit_owner, which no application role is a member of '
  'and none may SET ROLE to, and gated on a setting rather than on `true`. It '
  'is opened by the SET clause of the SECURITY DEFINER functions 0020 §2 '
  'names — for the body of one function and no longer — and by hand in '
  'db/seed/dev_seed.sql and three named test fixtures. Without it every one '
  'of those silently wrote nothing on a database whose owner is not a '
  'superuser, which is every database this will ever run on.';

-- --- And the functions that may open it, one line each ---------------------
--
-- `ALTER FUNCTION ... SET` rather than an edit to every body, because the
-- clause is the guarantee: PostgreSQL applies it on entry and restores the
-- previous value on exit, so there is no path out of one of these functions —
-- return, exception or abort — that leaves the window open behind it.
alter function public.store_query_embedding(text, halfvec, text) set "foundit.definer" = 'on';
alter function public.store_query_reading(text, jsonb, text)     set "foundit.definer" = 'on';
alter function public.store_query_rerank(text, text, jsonb, text) set "foundit.definer" = 'on';
alter function public.touch_query_embedding(text)                set "foundit.definer" = 'on';
alter function public.touch_query_reading(text)                  set "foundit.definer" = 'on';
alter function public.touch_query_rerank(text, text)             set "foundit.definer" = 'on';
alter function public.query_embedding_missing(text, halfvec)     set "foundit.definer" = 'on';
alter function public.query_reading(text)                        set "foundit.definer" = 'on';
alter function public.query_rerank(text, text)                   set "foundit.definer" = 'on';
alter function public.query_vector_ranks(text, halfvec, bigint[], integer)
                                                                 set "foundit.definer" = 'on';
alter function public.queue_embedding(text, bigint)              set "foundit.definer" = 'on';
alter function public.embedding_work(integer)                    set "foundit.definer" = 'on';
alter function public.embedding_job_done(bigint)                 set "foundit.definer" = 'on';
alter function public.embedding_job_failed(bigint, text)         set "foundit.definer" = 'on';
alter function public.embedding_jobs_guard()                     set "foundit.definer" = 'on';
alter function public.log_search_event_tools(text, integer, real, boolean, integer, boolean, bigint[])
                                                                 set "foundit.definer" = 'on';
alter function public.maker_search_demand(bigint, integer, integer)
                                                                 set "foundit.definer" = 'on';
alter function public.maker_listing_metrics(bigint, integer)     set "foundit.definer" = 'on';
alter function public.store_tool_embedding(bigint, halfvec, text) set "foundit.definer" = 'on';
alter function public.store_problem_embedding(bigint, halfvec, text)
                                                                 set "foundit.definer" = 'on';
alter function public.store_generated_statement(bigint, text, text, text)
                                                                 set "foundit.definer" = 'on';
alter function public.claim_tool(bigint, text)                   set "foundit.definer" = 'on';
alter function public.reassign_tool_owner(bigint, text, text, text)
                                                                 set "foundit.definer" = 'on';
-- public.admin_catalogue_unmatched carries the clause too, and it is written
-- into the CREATE in §3 rather than added here: `create or replace function`
-- discards a function's SET clauses, and §3 replaces that one.

-- --- And the one VIEW that had the same defect ------------------------------
--
-- `public.profiles_public` is the public face of a profile: the handle, the
-- display name, the avatar and the bio, which every review byline, every
-- /u/<handle> page and every "added by" on the site renders. It is a view with
-- `security_invoker = false`, so it reads `public.profiles` as ITS OWNER —
-- and `profiles` is FORCE ROW LEVEL SECURITY with `profiles_read` scoped to
-- `id = auth.uid() or auth.is_admin()`. With a non-superuser owner it
-- therefore returned NO ROWS to anybody, and every byline in the product
-- would have gone blank.
--
-- db/test/search_events_test.sql predicted this in a comment, word for word,
-- and called it "the tripwire for the one dependency profiles_public has ...
-- if that ever changes, this check fails loudly instead of every byline in the
-- product quietly going blank". It fired.
--
-- A VIEW CANNOT OPEN THE WINDOW — there is nowhere on a view to put a SET
-- clause — so the rows come from a function that can, and the view is a
-- projection of it. The call sites do not change: `public.profiles_public` is
-- still a view with the same six columns, still the only way the application
-- sees anybody but itself, and still the thing the column list protects. What
-- moved is where the six columns are chosen, which is now one function whose
-- window is open for its own body and no longer.
create or replace function public.profiles_public_rows()
returns table (
  id           text,
  handle       citext,
  display_name text,
  avatar_path  text,
  bio          text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set "foundit.definer" = 'on'
as $fn$
begin
  return query
    select p.id, p.handle, p.display_name, p.avatar_path, p.bio, p.created_at
      from public.profiles p;
end;
$fn$;

comment on function public.profiles_public_rows() is
  'The six public columns of every profile, which is what '
  'public.profiles_public has always been. A function rather than the view''s '
  'own SELECT because a view has nowhere to carry the 0020 §2 window and a '
  'function does: public.profiles is FORCE ROW LEVEL SECURITY and the view '
  'reads it as its owner, so on a database whose owner is not a superuser the '
  'view returned nothing to anybody. SIX COLUMNS AND NO SEVENTH — is_admin, '
  'plan, updated_at and last_seen_day are not here, and the column list is '
  'the whole of what makes this safe to run past a policy.';

create or replace view public.profiles_public as
  select r.id, r.handle, r.display_name, r.avatar_path, r.bio, r.created_at
    from public.profiles_public_rows() r;

comment on view public.profiles_public is
  'The public face of a profile: handle, display name, avatar, bio, joined. '
  'Unchanged in every way a caller can see. Its rows now come from '
  'public.profiles_public_rows(), which is the only place the six columns are '
  'chosen and the only thing that opens the 0020 §2 window to choose them.';

revoke execute on function public.profiles_public_rows() from public;
grant execute on function public.profiles_public_rows() to foundit_app;

-- ===========================================================================
-- 3. F6 — the admin check runs before any argument is touched
--
-- `public.admin_catalogue_counts` computed `v_since` in its DECLARE block,
-- which runs before the first statement of the body, so
-- `admin_catalogue_counts(2147483647)` answered a signed-out stranger with
-- SQLSTATE 22008 (timestamp out of range) rather than 42501. The suite never
-- saw it because §1 only ever called with no arguments. The initialiser moves
-- into the body, after the check, and admin_test.sql §1 now calls every
-- function with 2147483647, with -1 and with null in every int argument.
--
-- The clamp is the same one every other panel uses, and it is what makes the
-- huge argument a large window rather than an error.
-- ===========================================================================
create or replace function public.admin_catalogue_counts(p_days int default 7)
returns table (
  added             bigint,
  published         bigint,
  claims_made       bigint,
  ownership_changed bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_since timestamptz;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  -- AFTER the check, and clamped at both ends. `least(..., 3650)` is new:
  -- ten years is longer than this catalogue will ever be and an argument
  -- larger than that is somebody probing, not somebody asking.
  v_since := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 3650));

  return query
    select (select count(*) from public.tools t where t.created_at >= v_since)::bigint,
           (select count(*) from public.tools t
             where t.status = 'published' and t.published_at >= v_since)::bigint,
           (select count(*) from public.tool_claims c where c.created_at >= v_since)::bigint,
           (select count(*) from public.ownership_changes o where o.created_at >= v_since)::bigint;
end;
$fn$;

comment on function public.admin_catalogue_counts(int) is
  'Four numbers about the catalogue over p_days: listings added, listings '
  'published, claims made, owners changed. The window is computed INSIDE the '
  'body, after auth.is_admin(), because a DECLARE block runs first and an '
  'argument touched before the check is an argument a stranger can raise a '
  'different SQLSTATE with (Phase 8 review, F6).';

-- The same clamp everywhere else an interval is built from an argument, so
-- that "huge argument" is a long window on every panel rather than on most of
-- them. Bodies otherwise unchanged from 0019.
create or replace function public.admin_demand(p_days int default 30)
returns table (
  day          date,
  searches     bigint,
  judged       bigint,
  nothing_good bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_days int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days := least(greatest(coalesce(p_days, 30), 1), 3650);

  return query
    with days as (
      select generate_series((current_date - (v_days - 1)), current_date,
                             interval '1 day')::date as d
    )
    select days.d,
           count(e.id)::bigint,
           count(e.id) filter (where e.match_judged)::bigint,
           count(e.id) filter (where e.match_judged and not e.had_good_match)::bigint
      from days
      left join public.search_events e
        on (e.created_at at time zone 'UTC')::date = days.d
     group by days.d
     order by days.d;
end;
$fn$;

create or replace function public.admin_unmet_demand(
  p_days  int default 30,
  p_limit int default 50
)
returns table (
  query_text text,
  searches   bigint,
  last_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_days  int;
  v_limit int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days  := least(greatest(coalesce(p_days, 30), 1), 3650);
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 10000);

  return query
    select min(e.query_text),
           count(*)::bigint,
           max(e.created_at)
      from public.search_events e
     where e.match_judged
       and not e.had_good_match
       and e.created_at >= now() - make_interval(days => v_days)
     group by e.query_hash
     order by max(e.created_at) desc
     limit v_limit;
end;
$fn$;

create or replace function public.admin_top_queries(
  p_days  int default 30,
  p_limit int default 25
)
returns table (
  query_text text,
  searches   bigint,
  last_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_days  int;
  v_limit int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days  := least(greatest(coalesce(p_days, 30), 1), 3650);
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 10000);

  return query
    select min(e.query_text),
           count(*)::bigint,
           max(e.created_at)
      from public.search_events e
     where e.created_at >= now() - make_interval(days => v_days)
     group by e.query_hash
     order by count(*) desc, max(e.created_at) desc
     limit v_limit;
end;
$fn$;

create or replace function public.admin_signups(p_days int default 30)
returns table (day date, signups bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_days int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days := least(greatest(coalesce(p_days, 30), 1), 3650);

  return query
    with days as (
      select generate_series((current_date - (v_days - 1)), current_date,
                             interval '1 day')::date as d
    )
    select days.d, count(p.id)::bigint
      from days
      left join public.profiles p
        on (p.created_at at time zone 'UTC')::date = days.d
     group by days.d
     order by days.d;
end;
$fn$;

create or replace function public.admin_catalogue_unmatched(p_limit int default 25)
returns table (
  slug         text,
  name         text,
  published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
-- The owner's window (§2), written into the CREATE because `create or replace
-- function` discards the SET clauses an ALTER added.
set "foundit.definer" = 'on'
as $fn$
declare
  v_limit int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 25), 1), 10000);

  return query
    select t.slug::text, t.name, t.published_at
      from public.tools t
     where t.status = 'published'
       and not exists (select 1 from public.search_event_tools st where st.tool_id = t.id)
     order by t.published_at nulls last, t.id
     limit v_limit;
end;
$fn$;

comment on function public.admin_catalogue_unmatched(int) is
  'Published listings no search has ever returned. Reads public.tools and '
  'public.search_event_tools; NAMES NO PEOPLE TABLE, which is the named '
  'exception db/test/admin_test.sql §2 allows it and the reason its three '
  'columns are allowlisted as (slug, name, published_at) and nothing else. It '
  'opens the 0020 §2 window because search_event_tools_read is '
  'auth.is_admin() and a NOT EXISTS over rows row-level security has filtered '
  'away answers "never matched" for every listing in the catalogue — which is '
  'what this panel drew on a database whose owner is not a superuser.';

-- ===========================================================================
-- 4. F7 — "added by" means added by
--
-- `admin_catalogue_added` and `admin_people` were both keyed on
-- `coalesce(t.owner_id, t.submitted_by)`, which answers "who maintains this
-- listing now". §10 and the Phase 8 gate ask for who ADDED it. One claim — one
-- click, since Phase 7 — moved a listing's "Added by" from one handle to
-- another and moved a count off one handle onto another, with `submitted_by`
-- unchanged throughout.
--
-- So: `submitted_by`, which 0017 makes unwritable by the application, is what
-- both now report, and the maintainer gets its own column with its own label.
-- Two columns rather than one because the operator wants both and a single
-- column called "Added by" cannot honestly carry both.
-- ===========================================================================
drop function if exists public.admin_catalogue_added(int, int);

create function public.admin_catalogue_added(
  p_days  int default 7,
  p_limit int default 25
)
returns table (
  slug          text,
  name          text,
  handle        text,
  maintained_by text,
  status        text,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_days  int;
  v_limit int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days  := least(greatest(coalesce(p_days, 7), 1), 3650);
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 10000);

  return query
    select t.slug::text,
           t.name,
           added.handle::text,
           owns.handle::text,
           t.status::text,
           t.created_at
      from public.tools t
      left join public.profiles added on added.id = t.submitted_by
      left join public.profiles owns  on owns.id  = t.owner_id
     where t.created_at >= now() - make_interval(days => v_days)
     order by t.created_at desc
     limit v_limit;
end;
$fn$;

comment on function public.admin_catalogue_added(int, int) is
  'Listings added over p_days, the handle that ADDED each — tools.submitted_by, '
  'which 0017 makes unwritable by the application — and, separately, the '
  'handle that maintains it now. Two columns because a claim moves the second '
  'and must never move the first (Phase 8 review, F7). Handles only, which '
  'are already on the listing''s public page, and never an address.';

drop function if exists public.admin_people(int);

create function public.admin_people(p_limit int default 50)
returns table (
  handle            text,
  tools_added       bigint,
  tools_maintained  bigint,
  reviews_written   bigint,
  likes_given       bigint,
  last_seen_day     date,
  joined_day        date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_limit int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 10000);

  -- THE COLUMN LIST IS STILL THE WHOLE DESIGN OF THIS FUNCTION, and 0019's
  -- paragraph about it stands unchanged: every figure is on a page a stranger
  -- can already read, likes are a count and not a list, saved collections are
  -- absent entirely, and there is no address here and nowhere for one to come
  -- from. What changed is that "tools added" now counts the listings this
  -- handle ADDED rather than the ones it currently maintains, and the second
  -- number is the one that was being reported under the first one's name.
  return query
    select p.handle::text,
           (select count(*) from public.tools t where t.submitted_by = p.id)::bigint,
           (select count(*) from public.tools t where t.owner_id = p.id)::bigint,
           (select count(*) from public.reviews r
             where r.author_id = p.id and r.deleted_at is null)::bigint,
           (select count(*) from public.tool_likes l where l.user_id = p.id)::bigint,
           p.last_seen_day,
           (p.created_at at time zone 'UTC')::date
      from public.profiles p
     order by p.last_seen_day desc nulls last, p.created_at desc
     limit v_limit;
end;
$fn$;

comment on function public.admin_people(int) is
  'Per handle, the PUBLIC counts: listings ADDED (tools.submitted_by), '
  'listings maintained now (tools.owner_id), live reviews written, likes '
  'given as a number, the day last seen and the day they joined. No address, '
  'no saved list, no search. Two listing counts rather than one because a '
  'claim moves the second and must never move the first (Phase 8 review, F7).';

-- ===========================================================================
-- 5. F8 — an author's deletion and an administrator's removal are not the
--         same event, and the operator's page must not call them one
--
-- `admin_reviews.removed_at` was `reviews.deleted_at`, which the AUTHOR sets
-- when they take their own review down. So an author's own deletion appeared
-- in the operator's "Removed" section with no reason and no remover, directly
-- under copy promising both.
--
-- Two columns now, and they mean two different things:
--
--   removed_by_admin_at   when a `review_removals` row was written, which is
--                         the only event that is a takedown.
--   author_deleted_at     when the author took it down themselves.
--
-- A review can carry both, and the order matters to nobody but the record.
-- `body` is NULL for a review its author deleted and no administrator has
-- removed: a retracted review's words are not operator data, which is the
-- same category 0015 removed auth.is_admin() from collections_read for.
-- ===========================================================================
drop function if exists public.admin_reviews(int, int);

create function public.admin_reviews(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  review_id           bigint,
  tool_slug           text,
  tool_name           text,
  handle              text,
  rating              smallint,
  body                text,
  created_at          timestamptz,
  removed_by_admin_at timestamptz,
  author_deleted_at   timestamptz,
  removal_reason      text,
  removed_by          text,
  total               bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_limit  int;
  v_offset int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 10000);
  v_offset := least(greatest(coalesce(p_offset, 0), 0), 1000000000);

  return query
    select r.id,
           t.slug::text,
           t.name,
           a.handle::text,
           r.rating,
           -- The words, unless the author retracted them and nobody has
           -- recorded a removal against them.
           case when r.deleted_at is not null and rr.id is null then null else r.body end,
           r.created_at,
           rr.created_at,
           r.deleted_at,
           rr.reason,
           adm.handle::text,
           count(*) over ()
      from public.reviews r
      join public.tools t on t.id = r.tool_id
      join public.profiles a on a.id = r.author_id
      left join lateral (
        select x.id, x.reason, x.admin_id, x.created_at
          from public.review_removals x
         where x.review_id = r.id
         order by x.id desc
         limit 1
      ) rr on true
      left join public.profiles adm on adm.id = rr.admin_id
     order by r.created_at desc, r.id desc
     limit v_limit
    offset v_offset;
end;
$fn$;

comment on function public.admin_reviews(int, int) is
  'Every review, newest first, with its listing, its author''s handle, and '
  'the two different things that take a review off the site kept apart: '
  'removed_by_admin_at is a review_removals row and author_deleted_at is the '
  'author''s own decision (Phase 8 review, F8). `body` is null for a review '
  'its author retracted with no removal recorded against it — a retracted '
  'review''s words are not operator data. `total` is the whole count before '
  'the limit, so the page can say "showing 100 of N" rather than silently '
  'dropping the rest. Reading is all this does: the removal itself is two '
  'ordinary statements sent as the administrator (0013 §7 and 0015 §1).';

-- ===========================================================================
-- 6. F10 — a reason is text a person typed, and gets the same treatment as
--          every other string in this schema
--
-- `review_removals.reason` was `length(btrim(reason)) between 8 and 500` and
-- nothing else. Phase 8 is the phase that made it typeable through a screen
-- and added neither the stripper every other person-supplied string goes
-- through (0017, 0018) nor the CHECK behind it. A bell character, an escape
-- sequence and a right-to-left override all reached the author's Settings
-- page and the removal email.
--
-- The CHECK is 0018's `public.control_character_class()`, which is the same
-- set lib/submit.ts strips: C0, DEL, C1, U+2028, U+2029, the zero-width
-- joiners and the bidi overrides and isolates.
-- ===========================================================================
alter table public.review_removals
  add constraint review_removals_reason_is_plain_text
  check (not public.has_control_characters(reason));

comment on constraint review_removals_reason_is_plain_text on public.review_removals is
  'The same rule every other person-supplied string in this schema carries '
  '(0017, 0018): no C0 or C1 control byte, no U+2028 or U+2029, no zero-width '
  'joiner and no bidirectional override. The reason is shown to the author on '
  '/settings, printed on /admin/reviews and put in the body of an email, and '
  'until 13 September 2026 it was the one typed string with no such rule.';

-- ===========================================================================
-- 7. F11 — one removal is one row, and "Reviews removed" counts reviews
--
-- Nothing stopped an administrator writing a second `review_removals` row
-- against a review that was already down. `admin_words` counted rows, so the
-- Words panel over-counted; `MY_REMOVALS_SQL` showed the author one deletion
-- twice; `admin_reviews` showed only the newest.
--
-- A UNIQUE INDEX AND NOT A PARTIAL ONE. The review asked for a partial unique
-- index, and there is no honest predicate to give it: there is no second row
-- that would be legitimate. One review, one removal, always — so the index is
-- total, which is strictly stronger than the partial one and says the same
-- thing with nothing left to argue about.
-- ===========================================================================
create unique index review_removals_one_per_review
  on public.review_removals (review_id);

comment on index public.review_removals_one_per_review is
  'One removal per review. A second row would make the Words panel over-count, '
  'show the author their own deletion twice and leave admin_reviews reporting '
  'only the newest of them (Phase 8 review, F11).';

create or replace function public.admin_words(p_days int default 30)
returns table (day date, reviews bigint, removed bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_days int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days := least(greatest(coalesce(p_days, 30), 1), 3650);

  return query
    with days as (
      select generate_series((current_date - (v_days - 1)), current_date,
                             interval '1 day')::date as d
    )
    select days.d,
           (select count(*) from public.reviews r
             where (r.created_at at time zone 'UTC')::date = days.d)::bigint,
           (select count(distinct rr.review_id) from public.review_removals rr
             where (rr.created_at at time zone 'UTC')::date = days.d)::bigint
      from days
     order by days.d;
end;
$fn$;

comment on function public.admin_words(int) is
  'Reviews written and REVIEWS removed, per day, over p_days — distinct '
  'review_id rather than rows, which the unique index above now makes the '
  'same number and which stays the honest count if that index is ever '
  'relaxed (Phase 8 review, F11). Reports are deliberately absent: '
  'docs/product-decisions.md §5 sends them to an inbox and records nothing.';

-- ===========================================================================
-- 8. Grants
--
-- The three functions that were dropped and recreated lost their grants with
-- them; `create or replace` kept theirs. Said out loud rather than assumed,
-- for the reason 0017 §9 gives: a grant nobody wrote down is the one that
-- appears by accident later.
-- ===========================================================================
revoke execute on function public.admin_catalogue_added(int, int) from public;
revoke execute on function public.admin_people(int) from public;
revoke execute on function public.admin_reviews(int, int) from public;

grant execute on function public.admin_catalogue_added(int, int) to foundit_app;
grant execute on function public.admin_people(int) to foundit_app;
grant execute on function public.admin_reviews(int, int) to foundit_app;

commit;
