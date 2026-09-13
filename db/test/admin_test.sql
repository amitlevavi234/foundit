-- ===========================================================================
-- Phase 8 — does the database refuse the operator dashboard to everybody else?
--
-- Written before the screen, which is this phase's first non-negotiable, and
-- every check is behavioural: try the thing as somebody who is not an
-- administrator, watch it be refused. A function that exists and does not
-- check is exactly the failure this file is for.
--
-- IT LEAVES THE DATABASE EXACTLY AS IT FOUND IT. The whole suite runs inside
-- ONE transaction that is ALWAYS rolled back, every check raises, and the
-- rollback is the last statement so reaching it means everything passed. That
-- matters here because §6 removes a review and §8 moves a counter.
--
-- THE TWO LISTS THIS FILE IS BUILT ON, which are also written into
-- db/migrations/0019_admin_dashboard.sql's header so the pair cannot drift:
--
--   SEARCH TABLES   search_events, search_event_tools, query_embeddings,
--                   query_readings, query_reranks
--   PEOPLE TABLES   profiles, profiles_public, auth_core.*, collections,
--                   collection_items, tool_likes, reviews, review_removals,
--                   tool_claims, ownership_changes
--
-- No admin_* function may name a table from both. §2 reads the SQL of every
-- one of them and fails if one ever does.
--
-- The seeded people, from db/seed/dev_seed.sql:
--
--   dev_person  @tomer  wrote the reviews on receiptly, tabsplit, quietroom,
--                       splitwise; owns both collections
--   dev_maker   @priya  MAINTAINS receiptly
--   dev_admin   @amit   is_admin
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.be(p_user text)
returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  end if;
  perform set_config('request.share_token', '', true);
end;
$$;

create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'ADMIN TEST FAILED: %', msg;
end;
$$;

/**
 * THE OWNER'S WINDOW (db/migrations/0020_phase8_review.sql §2).
 *
 * `foundit_owner` has been NOSUPERUSER NOBYPASSRLS since 13 September 2026 —
 * which is what research/08 §9.3 has always said the server would be — so the
 * owner is subject to every policy in `public` exactly as the application is.
 * That IS the change: an owner statement reaching past a policy used to be a
 * silent no-op and is now an error.
 *
 * A test suite is one of the three things that legitimately reaches past a
 * policy as the owner. It plants fixtures no function could plant, and it
 * counts rows the person who wrote them would not be allowed to see. Every
 * call below is one of those, each with its own reason written beside it, and
 * the window is closed again on the next line.
 */
create or replace function pg_temp.owner_window(p_open boolean)
returns void language plpgsql as $$
begin
  perform set_config('foundit.definer',
                     case when p_open then 'on' else 'off' end, true);
end;
$$;

create or replace function pg_temp.review_of(p_slug text, p_author text)
returns bigint language sql stable as $$
  select r.id from public.reviews r
    join public.tools t on t.id = r.tool_id
   where t.slug::text = p_slug and r.author_id = p_author
   order by r.id limit 1;
$$;

/**
 * Every function the dashboard reads through, enumerated rather than listed.
 *
 * THIS IS THE WHOLE DESIGN OF THIS FILE. A hand-written list of twelve
 * function names is a list somebody forgets to add the thirteenth to, and the
 * thirteenth is the one with no check in it. `public.admin\_%` out of pg_proc
 * means a function added next year is tested the day it is written.
 */
create or replace function pg_temp.admin_functions()
returns table (oid oid, name text, args text, nargs int, ndefaults int)
language sql stable as $$
  select p.oid,
         p.proname::text,
         pg_get_function_identity_arguments(p.oid),
         p.pronargs::int,
         p.pronargdefaults::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'admin\_%'
   order by p.proname;
$$;

-- ===========================================================================
-- 0. The enumeration finds something, and every member can be called with no
--    arguments at all
--
-- Without the first half, every assertion below passes on the day the prefix
-- changes and nothing is enumerated — the one way a test like this fails
-- silently. Without the second, a function with a required argument would be
-- skipped by §1's dynamic call and would be the only one nobody checked.
-- ===========================================================================
do $$
declare n integer; bad text;
begin
  select count(*) into n from pg_temp.admin_functions();
  if n < 10 then
    perform pg_temp.fail(format('only %s admin_* functions found; the prefix or the '
                                'migration has changed', n));
  end if;

  select string_agg(format('%s(%s)', f.name, f.args), ', ') into bad
    from pg_temp.admin_functions() f
   where f.ndefaults < f.nargs;
  if bad is not null then
    perform pg_temp.fail('every argument of an admin_* function must have a default so '
                         'this suite can call it: ' || bad);
  end if;

  -- And each one is a definer function with a pinned search_path, which is
  -- what makes the check inside it meaningful at all: a caller who can shadow
  -- `public` can shadow auth.is_admin().
  select string_agg(f.name, ', ') into bad
    from pg_temp.admin_functions() f
    join pg_proc p on p.oid = f.oid
   where not p.prosecdef;
  if bad is not null then
    perform pg_temp.fail('not SECURITY DEFINER: ' || bad);
  end if;

  select string_agg(f.name, ', ') into bad
    from pg_temp.admin_functions() f
    join pg_proc p on p.oid = f.oid
   where p.proconfig is null
      or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%');
  if bad is not null then
    perform pg_temp.fail('no pinned search_path: ' || bad);
  end if;

  -- EVERY ARGUMENT IS AN INTEGER, which is what lets §1 below build a call to
  -- each function with a chosen value in every argument. A text or timestamp
  -- argument would silently drop out of that probe, and the probe is the only
  -- thing that would have caught F6 (an argument used before the check).
  select string_agg(format('%s(%s)', f.name, f.args), ', ') into bad
    from pg_temp.admin_functions() f
    join pg_proc p on p.oid = f.oid
   where exists (
     select 1 from unnest(coalesce(p.proargtypes::oid[], array[]::oid[])) t(typ)
      where format_type(t.typ, null) <> 'integer'
   );
  if bad is not null then
    perform pg_temp.fail('an admin_* function takes an argument that is not an integer, so '
                         '§1 cannot probe it: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 1. EVERY admin function raises 42501 for everybody who is not an admin
--
-- Three identities, which are the three ways somebody arrives at a URL they
-- were not meant to have: nobody at all, an ordinary account, and a maker with
-- a listing of their own. All of it as foundit_app, because that is the only
-- role the application ever connects as and running it as the owner would
-- prove nothing.
--
-- The call is built from pg_proc, so a function added later is refused-or-
-- fails here without anybody editing this file.
--
-- AND IT IS BUILT FOUR TIMES: with no arguments, and with 2147483647, -1 and
-- null in EVERY argument. That is the Phase 8 review's F6, which is what
-- happens when a probe only ever sends the default. `admin_catalogue_counts`
-- computed its window in its DECLARE block — which runs before the first
-- statement of the body — so `admin_catalogue_counts(2147483647)` answered a
-- signed-out stranger with SQLSTATE 22008, "timestamp out of range", instead
-- of 42501. The function was refusing nobody anything, but it was answering a
-- different sentence to a stranger depending on what the stranger sent, and
-- the migration and the gate both said it checked first.
--
-- 42501 AND NOTHING ELSE, for every one of the four. Any other SQLSTATE is a
-- 500 where the not-found page belongs.
-- ===========================================================================
set role foundit_app;

do $$
declare
  f       record;
  who     text;
  arg     text;
  call    text;
  refused boolean;
begin
  foreach who in array array[null, 'dev_person', 'dev_maker', 'nobody_at_all']
  loop
    perform pg_temp.be(who);
    for f in select * from pg_temp.admin_functions()
    loop
      foreach arg in array array['', '2147483647', '-1', 'null']
      loop
        -- '' is the no-argument call; the other three fill every argument.
        if arg = '' then
          call := format('select * from public.%I()', f.name);
        elsif f.nargs = 0 then
          continue;                       -- nothing to fill; already covered
        else
          call := format('select * from public.%I(%s)', f.name,
                         array_to_string(array_fill(arg, array[f.nargs]), ', '));
        end if;

        refused := false;
        begin
          execute call;
        exception
          when insufficient_privilege then refused := true;
          when others then
            perform pg_temp.fail(format(
              '%s raised %s (%s) for %L instead of 42501',
              call, sqlstate, sqlerrm, coalesce(who, 'a signed-out stranger')));
        end;
        if not refused then
          perform pg_temp.fail(format(
            '%s answered %L, who is not an administrator',
            call, coalesce(who, 'a signed-out stranger')));
        end if;
      end loop;
    end loop;
  end loop;
end
$$;

-- A malformed claim is a stranger here too, and must not raise anything but
-- 42501 — an exception out of a dashboard function is a 500 where a not-found
-- page belongs.
do $$
declare f record; raw text; refused boolean;
begin
  foreach raw in array array['nonsense', '{', '[1,2]', 'true', '{"sub":null}']
  loop
    perform set_config('request.jwt.claims', raw, true);
    for f in select * from pg_temp.admin_functions()
    loop
      refused := false;
      begin
        execute format('select * from public.%I()', f.name);
      exception
        when insufficient_privilege then refused := true;
        when others then
          perform pg_temp.fail(format('public.%s() raised %s on the malformed claim %L',
                                      f.name, sqlstate, raw));
      end;
      if not refused then
        perform pg_temp.fail(format('public.%s() answered the malformed claim %L',
                                    f.name, raw));
      end if;
    end loop;
  end loop;
end
$$;

-- And a positive control, because §1 would pass just as well if every one of
-- these functions were broken — with the same four calls, because an ADMIN
-- sending 2147483647 must get a long window rather than "timestamp out of
-- range". The clamp in 0020 §3 is what makes that true, and this is where it
-- is read back.
do $$
declare f record; arg text; call text; n integer := 0;
begin
  perform pg_temp.be('dev_admin');
  if not auth.is_admin() then perform pg_temp.fail('dev_admin is not an admin'); end if;
  for f in select * from pg_temp.admin_functions()
  loop
    foreach arg in array array['', '2147483647', '-1', 'null']
    loop
      if arg = '' then
        call := format('select * from public.%I()', f.name);
      elsif f.nargs = 0 then
        continue;
      else
        call := format('select * from public.%I(%s)', f.name,
                       array_to_string(array_fill(arg, array[f.nargs]), ', '));
      end if;
      begin
        execute call;
        n := n + 1;
      exception when others then
        perform pg_temp.fail(format('%s raised %s (%s) for the ADMIN',
                                    call, sqlstate, sqlerrm));
      end;
    end loop;
  end loop;
  if n < 10 then perform pg_temp.fail('the admin could run almost nothing'); end if;
end
$$;

-- ===========================================================================
-- 2. Search text and a person are never joined
--
-- REWRITTEN 13 SEPTEMBER 2026, BECAUSE THE OLD VERSION WAS A TEXT FILTER AND
-- NOT A RULE. The Phase 8 review wrote two functions that join search text to
-- a named person and pass the old §2(a) and §2(b) verbatim:
--
--   * one went `search_events -> search_event_tools -> tools` and returned
--     `t.submitted_by` beside `min(e.query_text)`. `public.tools` was on
--     NEITHER list, and it carries two columns that are people;
--   * one reached `public.profiles` as `'public.pro' || 'files'` inside an
--     `execute`, so the name never appeared in the text at all.
--
-- And §2(b)'s column regex was anchored at the END, so `submitted_by`,
-- `tool_maker`, `typed_near`, `by_whom` and `maker` all sailed through.
--
-- THREE CHECKS NOW, and the first one is the one that matters:
--
--   (i)   AN ALLOWLIST. Every admin_* function's OUT columns are written down
--         here, by name and in order. A function that is not in the list
--         fails; a function whose columns differ from the list fails. So a
--         column cannot be added to a panel without somebody editing this
--         file, on purpose, in the same commit — which is the only kind of
--         check a future author cannot walk past by accident.
--   (ii)  THE TWO LISTS, with public.tools, tool_claims, ownership_changes,
--         review_removals and tool_problems now ON THE PEOPLE LIST, because
--         every one of them carries submitted_by, owner_id, claimant_id or
--         admin_id. public.admin_catalogue_unmatched is the ONE named
--         exception, and it is allowed only while its columns are exactly
--         (slug, name, published_at) — which (i) is what pins.
--   (iii) NO DYNAMIC SQL AND NO STRING BUILDING IN ANY BODY. `execute`,
--         `format(`, `||`, `to_regclass`, `query_to_xml` and a dollar-quoted
--         string are all refused outright. A body that cannot build a table
--         name cannot hide one from (ii).
--
-- WHAT THIS GUARANTEES AND WHAT IT DOES NOT, said plainly because the old
-- version's claim was too large. It does not make it impossible for a
-- migration author to write a function that joins the two: an author who
-- edits the allowlist below can ship anything. What it makes impossible is
-- doing it BY ACCIDENT, or in a diff that does not say so. The join now costs
-- a deliberate edit to a file called "does the database refuse the operator
-- dashboard to everybody else", in the same commit, where a reviewer will see
-- it.
--
-- The real protection is still the schema: public.search_events has no user
-- column, no session column and no foreign key to one, and 0001, 0005, 0010
-- and 0017 each say in turn that it never will. This section is what keeps
-- somebody from routing around that through a listing.
-- ===========================================================================
reset role;

-- (i) The allowlist. One row per function: the name, then every argument and
--     OUT column in catalogue order, as `name:mode` where mode is i for an IN
--     argument and t for a column of the returned table. Read straight out of
--     pg_proc, so a renamed column, a reordered column, an added column and a
--     removed function are four different failures and all four are loud.
create or replace function pg_temp.allowlist()
returns table (name text, shape text) language sql immutable as $$
  select * from (values
    ('admin_catalogue_added',
     'p_days:i p_limit:i slug:t name:t handle:t maintained_by:t status:t created_at:t'),
    ('admin_catalogue_counts',
     'p_days:i added:t published:t claims_made:t ownership_changed:t'),
    ('admin_catalogue_unmatched',
     'p_limit:i slug:t name:t published_at:t'),
    ('admin_database_bytes',
     ''),
    ('admin_demand',
     'p_days:i day:t searches:t judged:t nothing_good:t'),
    ('admin_ops_events',
     'kind:t recorded:t ok:t detail:t at:t'),
    ('admin_people',
     'p_limit:i handle:t tools_added:t tools_maintained:t reviews_written:t '
     'likes_given:t last_seen_day:t joined_day:t'),
    ('admin_reviews',
     'p_limit:i p_offset:i review_id:t tool_slug:t tool_name:t handle:t rating:t '
     'body:t created_at:t removed_by_admin_at:t author_deleted_at:t '
     'removal_reason:t removed_by:t total:t'),
    ('admin_signups',
     'p_days:i day:t signups:t'),
    ('admin_top_queries',
     'p_days:i p_limit:i query_text:t searches:t last_at:t'),
    ('admin_unmet_demand',
     'p_days:i p_limit:i query_text:t searches:t last_at:t'),
    ('admin_words',
     'p_days:i day:t reviews:t removed:t')
  ) as t(name, shape);
$$;

/** The same shape, read out of the catalogue for one function. */
create or replace function pg_temp.shape_of(p_oid oid)
returns text language sql stable as $$
  select coalesce(
    (select string_agg(format('%s:%s', names.nm, coalesce(modes.md, 'i')), ' '
                       order by names.i)
       from pg_proc p
       cross join lateral unnest(p.proargnames) with ordinality as names(nm, i)
       left join lateral (
         select m from unnest(p.proargmodes) with ordinality as t(m, j)
          where j = names.i
       ) as raw(m) on true
       left join lateral (select case raw.m when 't' then 't' else 'i' end) as modes(md) on true
      where p.oid = p_oid),
    '');
$$;

do $$
declare
  f    record;
  want text;
  got  text;
  seen int := 0;
begin
  for f in select * from pg_temp.admin_functions()
  loop
    select a.shape into want from pg_temp.allowlist() a where a.name = f.name;
    if not found then
      perform pg_temp.fail(format(
        'public.%s is an admin_* function and is not in this file''s allowlist. Adding a '
        'panel means adding its columns here, on purpose, in the same commit — that is '
        'what makes "search text and a person are never joined" a rule rather than a '
        'text filter.', f.name));
    end if;

    got := pg_temp.shape_of(f.oid);
    if got <> want then
      perform pg_temp.fail(format(
        'public.%s returns a different shape from the one this file allows.%s  allowed: '
        '%s%s  actual:  %s', f.name, chr(10), want, chr(10), got));
    end if;
    seen := seen + 1;
  end loop;

  if seen <> (select count(*) from pg_temp.allowlist()) then
    perform pg_temp.fail(format(
      'the allowlist has %s entries and %s admin_* functions exist; a function in the '
      'list is gone and nothing noticed',
      (select count(*) from pg_temp.allowlist()), seen));
  end if;
end
$$;

-- (ii) The two lists, over the SQL of every admin function. public.tools is on
--      the people list now: `tools.submitted_by` and `tools.owner_id` are text
--      references to profiles.id, so a function that reaches a listing from a
--      search event has reached a person.
do $$
declare
  f    record;
  def  text;
  bad  text := null;
  searchy text := '\m(search_events|search_event_tools|query_embeddings|query_readings|query_reranks)\M';
  peopley text := '\m(profiles|profiles_public|profiles_public_rows|auth_core|collections|collection_items|tool_likes|reviews|review_removals|tool_claims|ownership_changes|tools|tool_problems)\M';
begin
  for f in select * from pg_temp.admin_functions()
  loop
    def := pg_get_functiondef(f.oid);

    if def ~ searchy and def ~ peopley then
      -- THE ONE NAMED EXCEPTION, and the whole of why it is safe is its
      -- column list, which (i) above pins to exactly three: a slug, a name
      -- and a date. There is no room in that result for a person, and a
      -- fourth column would fail (i) before it reached here.
      if f.name <> 'admin_catalogue_unmatched' then
        bad := coalesce(bad || ', ', '') || f.name;
      end if;
    end if;

    -- The check itself, in the body, in the shape 0019 writes it. A function
    -- granted to the application without it is the hole this phase exists to
    -- not have.
    if has_function_privilege('foundit_app', f.oid, 'execute')
       and def !~ 'if not auth\.is_admin\(\) then' then
      perform pg_temp.fail(format(
        'public.%s is granted to foundit_app and its body does not check auth.is_admin()',
        f.name));
    end if;
  end loop;

  if bad is not null then
    perform pg_temp.fail('an admin function names a search table AND a people table, '
                         'which is the one join docs/product-decisions.md §10 forbids: ' || bad);
  end if;
end
$$;

-- The lists are not vacuous: at least one function names a search table and at
-- least one names a people table, so (ii) is comparing two live sets.
do $$
declare s int; p int;
begin
  select count(*) into s from pg_temp.admin_functions() f
   where pg_get_functiondef(f.oid) ~ '\m(search_events|search_event_tools)\M';
  select count(*) into p from pg_temp.admin_functions() f
   where pg_get_functiondef(f.oid) ~ '\m(profiles|reviews|tool_likes|tools)\M';
  if s = 0 then perform pg_temp.fail('no admin function reads the search side at all'); end if;
  if p = 0 then perform pg_temp.fail('no admin function reads the people side at all'); end if;
end
$$;

-- (iii) No body may build SQL. `'public.pro' || 'files'` inside an `execute`
--       defeats (ii) outright and there is no reason any panel needs either:
--       every one of them is a fixed SELECT over fixed tables.
--
--       Read from prosrc rather than pg_get_functiondef, because the
--       definition ALWAYS wraps the body in a dollar-quoted string and would
--       fail its own dollar-quote check.
do $$
declare
  f   record;
  src text;
  pat text;
  bad text := null;
begin
  for f in select * from pg_temp.admin_functions()
  loop
    select p.prosrc into src from pg_proc p where p.oid = f.oid;
    foreach pat in array array[
      '\mexecute\M',        -- dynamic SQL
      'format\s*\(',        -- a table name assembled from pieces
      '\|\|',               -- ...or concatenated
      '\mto_regclass\M',    -- a relation looked up by a string
      '\mquery_to_xml\M',   -- the other way to run a string as a query
      '\$[A-Za-z_0-9]*\$'   -- a dollar-quoted string inside the body
    ]
    loop
      if src ~* pat then
        bad := coalesce(bad || ', ', '') || format('%s (%s)', f.name, pat);
      end if;
    end loop;
  end loop;

  if bad is not null then
    perform pg_temp.fail(
      'an admin_* body builds or runs SQL from a string, which is how a function reaches '
      'a table without naming it and walks past the check above: ' || bad);
  end if;
end
$$;

-- (b) A function that hands back query text hands back nothing that could say
--     whose it was. The OUT columns are read from the catalogue, so a column
--     added later is inspected without this file changing.
--
--     The regex is no longer anchored at the end — `submitted_by`,
--     `tool_maker`, `typed_near`, `by_whom` and `maker` all passed the
--     end-anchored version, and all five are exactly the column somebody
--     would add.
do $$
declare
  f     record;
  names text[];
  col   text;
  n     int := 0;
begin
  for f in select * from pg_temp.admin_functions()
  loop
    select coalesce(p.proargnames, '{}') into names from pg_proc p where p.oid = f.oid;
    if not ('query_text' = any (names)) then continue; end if;
    n := n + 1;

    foreach col in array names
    loop
      if col like 'p\_%' then continue; end if;   -- an IN argument, not a column
      if col ~* '(user|author|owner|actor|admin|claimant|handle|profile|account|email|address|ip|session|visitor|person|submitted|maker|typed|whom|who|by_|_by|name)'
      then
        perform pg_temp.fail(format(
          'public.%s returns query text beside a column called %L, which could carry an identity',
          f.name, col));
      end if;
    end loop;

    -- And no column whose TYPE is the one every identity in this schema has:
    -- profiles.id is text, so a bare `text` column is fine, but a column
    -- typed as a reference to a person is not something this result may hold.
    if exists (
      select 1
        from unnest(coalesce((select p.proallargtypes from pg_proc p where p.oid = f.oid),
                             array[]::oid[])) t(typ)
       where format_type(t.typ, null) in ('public.profiles', 'public.profiles_public')
    ) then
      perform pg_temp.fail(format('public.%s returns a whole person beside query text', f.name));
    end if;
  end loop;

  if n = 0 then
    perform pg_temp.fail('no admin function returns a column called query_text, so this '
                         'check compared nothing — has the column been renamed?');
  end if;
end
$$;

-- And the counting rule itself: the operator sees a sentence one search
-- typed. That is §10, and it is the opposite of the maker's §19 threshold,
-- so it is asserted rather than assumed.
set role foundit_app;

do $$
declare n integer; txt text;
begin
  perform pg_temp.be('dev_admin');

  insert into public.search_events (query_text, query_hash, result_count, had_good_match,
                                    match_judged)
  values ('a sentence exactly one person has ever typed', '', 0, false, true);

  select count(*) into n from public.admin_unmet_demand(30, 200) d
   where d.query_text = 'a sentence exactly one person has ever typed';
  if n <> 1 then
    perform pg_temp.fail('the operator cannot see a sentence typed once; §10 says they may');
  end if;

  select d.searches::text into txt from public.admin_unmet_demand(30, 200) d
   where d.query_text = 'a sentence exactly one person has ever typed';
  if txt <> '1' then perform pg_temp.fail('and the count beside it is wrong: ' || txt); end if;

  -- A maker still cannot, through the function that is theirs.
  if public.maker_query_threshold() <> 5 then
    perform pg_temp.fail('the maker threshold moved; §19 and §10 are meant to differ');
  end if;
end
$$;

-- ===========================================================================
-- 3. What the panels actually say, so that "it did not raise" is not the whole
--    of §1's positive control
-- ===========================================================================
do $$
declare r record; n integer;
begin
  perform pg_temp.be('dev_admin');

  -- Backups and Server: three kinds, none of them recorded, and nothing that
  -- could be drawn as a zero.
  select count(*) into n from public.admin_ops_events();
  if n <> 3 then perform pg_temp.fail('the ops panel does not draw one row per kind'); end if;

  for r in select * from public.admin_ops_events()
  loop
    if r.recorded then
      perform pg_temp.fail(format('%s is recorded, and nothing writes it yet', r.kind));
    end if;
    if r.ok is not null or r.at is not null then
      perform pg_temp.fail(format('%s has a value with no row behind it', r.kind));
    end if;
  end loop;

  -- ...and once a row exists, it says so. infra.record_ops_event is the
  -- owner's, so this is the only place in the suite that leaves the app role.
  reset role;
  perform infra.record_ops_event('backup', true, 'a test row, rolled back');
  set role foundit_app;
  perform pg_temp.be('dev_admin');

  select count(*) into n from public.admin_ops_events() o
   where o.kind = 'backup' and o.recorded and o.ok;
  if n <> 1 then perform pg_temp.fail('a recorded backup did not reach the panel'); end if;

  -- The database size is a real number and not a zero.
  if public.admin_database_bytes() < 1000000 then
    perform pg_temp.fail('pg_database_size answered something implausible');
  end if;

  -- The demand panel covers exactly the days it was asked for.
  select count(*) into n from public.admin_demand(30);
  if n <> 30 then perform pg_temp.fail(format('admin_demand(30) drew %s days', n)); end if;
  select count(*) into n from public.admin_signups(30);
  if n <> 30 then perform pg_temp.fail(format('admin_signups(30) drew %s days', n)); end if;
  select count(*) into n from public.admin_words(30);
  if n <> 30 then perform pg_temp.fail(format('admin_words(30) drew %s days', n)); end if;

  -- People: handles and public counts, and no column that could be an address.
  select count(*) into n from public.admin_people(500);
  if n < 3 then perform pg_temp.fail('the People panel is empty'); end if;
end
$$;

-- The People panel's column list, read from the catalogue rather than trusted.
reset role;
do $$
declare names text[];
begin
  select p.proargnames into names
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_people';
  if names is null then perform pg_temp.fail('public.admin_people has no named columns'); end if;
  if array_position(names, 'email') is not null
     or array_position(names, 'address') is not null
     or array_position(names, 'ip') is not null then
    perform pg_temp.fail('the People panel has a column that is not public activity');
  end if;
  if array_position(names, 'handle') is null then
    perform pg_temp.fail('the People panel does not name the handle it is keyed by');
  end if;
end
$$;

-- ===========================================================================
-- 4. infra is out of reach, and the grant is the boundary
--
-- infra.ops_events carries no row-level security, for the reason 0019's header
-- gives and for the reason db/test/accounts_test.sql §1 gives about auth_core:
-- it has one writer and one reader and a policy there would have to say
-- `true`. So the privileges ARE the rule, and here they are read back.
-- ===========================================================================
-- The privileges, read as the owner: naming infra.ops_events at all needs
-- USAGE on the schema, which is exactly what the application does not have.
do $$
declare bad text;
begin
  if has_schema_privilege('foundit_app', 'infra', 'usage') then
    perform pg_temp.fail('foundit_app has USAGE on schema infra');
  end if;
  if has_schema_privilege('foundit_embed', 'infra', 'usage') then
    perform pg_temp.fail('foundit_embed has USAGE on schema infra');
  end if;
  if has_schema_privilege('foundit_auth', 'infra', 'usage') then
    perform pg_temp.fail('foundit_auth has USAGE on schema infra');
  end if;

  select string_agg(format('%s:%s', g.role, v.verb), ', ') into bad
    from (values ('foundit_app'), ('foundit_embed'), ('foundit_auth')) g(role),
         (values ('select'), ('insert'), ('update'), ('delete')) v(verb)
   where has_table_privilege(g.role, 'infra.ops_events', v.verb);
  if bad is not null then
    perform pg_temp.fail('an application role can reach infra.ops_events: ' || bad);
  end if;

  select string_agg(g.role, ', ') into bad
    from (values ('foundit_app'), ('foundit_embed'), ('foundit_auth')) g(role)
   where has_function_privilege(g.role,
           'infra.record_ops_event(text, boolean, text)', 'execute');
  if bad is not null then
    perform pg_temp.fail('a role can write its own "last backup succeeded" row: ' || bad);
  end if;
end
$$;

-- And the application cannot reach it by trying, either.
set role foundit_app;

do $$
begin
  begin
    execute 'select 1 from infra.ops_events';
    perform pg_temp.fail('foundit_app read infra.ops_events');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- ===========================================================================
-- 5. The admin flag is not written by any application statement
--
-- db/test/accounts_test.sql already proves a person cannot set it on their own
-- row. This is the other half, and the one Phase 8 makes tempting: an ADMIN
-- cannot set it either, on themselves or on anybody, because the privilege is
-- missing rather than the policy.
-- ===========================================================================
do $$
begin
  perform pg_temp.be('dev_admin');

  begin
    update public.profiles set is_admin = true where id = 'dev_person';
    perform pg_temp.fail('an administrator made somebody else an administrator');
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set is_admin = false where id = auth.uid();
    perform pg_temp.fail('an administrator wrote their own flag');
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.be('dev_person');
  begin
    update public.profiles set is_admin = true where id = auth.uid();
    perform pg_temp.fail('a person made themselves an administrator');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- No column privilege on is_admin for either application role, said as a
-- privilege rather than as a failed statement.
reset role;
do $$
declare bad text;
begin
  select string_agg(format('%s:%s', g.role, c.col), ', ') into bad
    from (values ('foundit_app'), ('foundit_embed'), ('foundit_auth')) g(role),
         (values ('is_admin'), ('plan'), ('created_at'), ('last_seen_day')) c(col)
   where has_column_privilege(g.role, 'public.profiles', c.col, 'update');
  if bad is not null then
    perform pg_temp.fail('an application role may write a column it must not: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 6. Removing a review: the 0013/0015 path, and nobody else's hands on it
-- ===========================================================================
set role foundit_app;

do $$
declare rid bigint; n integer;
begin
  rid := pg_temp.review_of('receiptly', 'dev_person');
  if rid is null then perform pg_temp.fail('the seeded review on receiptly is missing'); end if;

  -- (a) The maker of the listing cannot take a review of it down, however
  --     unfair they think it is. docs/product-decisions.md §4.
  perform pg_temp.be('dev_maker');
  begin
    insert into public.review_removals (review_id, admin_id, reason)
    values (rid, auth.uid(), 'the maker did not care for it');
    perform pg_temp.fail('a maker wrote a removal reason');
  exception when insufficient_privilege then null;
  end;
  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 0 then perform pg_temp.fail('a maker removed a review of their own listing'); end if;

  -- (b) Nor can a passing account.
  perform pg_temp.be('nobody_at_all');
  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 0 then perform pg_temp.fail('a stranger removed a review'); end if;

  -- (c) An admin with no reason on the record is refused by the trigger.
  perform pg_temp.be('dev_admin');
  begin
    update public.reviews set deleted_at = now() where id = rid;
    perform pg_temp.fail('a review came down with no reason written');
  exception when insufficient_privilege then null;
  end;

  -- (d) A reason under eight characters is refused by the CHECK.
  begin
    insert into public.review_removals (review_id, admin_id, reason)
    values (rid, auth.uid(), 'spam');
    perform pg_temp.fail('a four-character reason was accepted');
  exception when check_violation then null;
  end;

  -- (e) And with one, the removal lands, and it is a removal rather than an
  --     edit: the text is exactly what it was.
  insert into public.review_removals (review_id, admin_id, reason)
  values (rid, auth.uid(), 'names a person who did not consent to being named');

  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the removal did not land'); end if;

  select count(*) into n from public.reviews r
   where r.id = rid and r.deleted_at is not null;
  if n <> 1 then perform pg_temp.fail('the review is not down'); end if;

  -- (f) An admin editing the words instead is still refused — on a LIVE
  --     review, which is the only kind an administrator may touch at all, and
  --     on the removed one, where every permissive policy has stopped
  --     matching and the update quietly affects nothing.
  begin
    update public.reviews
       set body = 'something the author did not write'
     where id = pg_temp.review_of('tabsplit', 'dev_person');
    perform pg_temp.fail('an administrator rewrote somebody''s live review');
  exception when insufficient_privilege then null;
  end;

  update public.reviews set body = 'and not this one either' where id = rid;
  get diagnostics n = row_count;
  if n <> 0 then perform pg_temp.fail('an administrator rewrote a removed review'); end if;

  select count(*) into n from public.reviews r
   where r.id = rid and r.body = 'and not this one either';
  if n <> 0 then perform pg_temp.fail('the text of a removed review changed'); end if;

  -- (g) The author cannot undo it, cannot edit it, and cannot post it again.
  perform pg_temp.be('dev_person');
  begin
    update public.reviews set deleted_at = null where id = rid;
    perform pg_temp.fail('the author put their removed review back');
  exception when insufficient_privilege then null;
  end;
  begin
    update public.reviews set body = 'rewritten' where id = rid;
    perform pg_temp.fail('the author edited a review an administrator removed');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reviews (tool_id, author_id, rating, body)
    select r.tool_id, auth.uid(), 5::smallint, 'the same thing again'
      from public.reviews r where r.id = rid;
    perform pg_temp.fail('the author wrote it again on the same listing');
  exception when insufficient_privilege then null;
  end;

  -- (h) The author reads THEIR OWN removal, and only their own.
  select count(*) into n from public.review_removals rr where rr.review_id = rid;
  if n <> 1 then
    perform pg_temp.fail('the author cannot read the reason their review came down');
  end if;

  perform pg_temp.be('dev_maker');
  select count(*) into n from public.review_removals rr where rr.review_id = rid;
  if n <> 0 then perform pg_temp.fail('somebody else read the reason'); end if;

  perform pg_temp.be(null);
  select count(*) into n from public.review_removals;
  if n <> 0 then perform pg_temp.fail('a stranger read a removal'); end if;

  -- (i) And it is on the operator's list, with the reason and the handle —
  --     under `removed_by_admin_at`, which since 0020 §5 is a different column
  --     from `author_deleted_at`. Both are set here, because an administrator
  --     removing a live review sets deleted_at as well; what matters is that
  --     the page can tell the two events apart, which §12 below is about.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid
     and a.removed_by_admin_at is not null
     and a.author_deleted_at is not null
     and a.removal_reason = 'names a person who did not consent to being named'
     and a.removed_by = 'amit';
  if n <> 1 then perform pg_temp.fail('the removal is not on the operator dashboard'); end if;

  -- And the words are still there for the operator, because this one was
  -- taken down by an administrator rather than retracted by its author.
  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid and a.body is not null;
  if n <> 1 then
    perform pg_temp.fail('an administrator''s removal hid the text the removal is about');
  end if;
end
$$;

-- ===========================================================================
-- 7. "Opened from Foundit" counts a click, cannot count a person, and COUNTS
--    AT ALL ON A DATABASE WHOSE OWNER IS NOT A SUPERUSER
--
-- docs/product-decisions.md §12. The function takes a slug and there is no
-- second argument to give it.
--
-- THE SECOND HALF OF THAT HEADING IS THE PHASE 8 REVIEW'S F1, and it is the
-- finding this whole suite existed and failed to catch. `public.tools` is
-- FORCE ROW LEVEL SECURITY; its only two UPDATE policies are `tools_update`
-- (`tool_is_mine(id)`, false for an anonymous clicker) and `tools_counters`
-- (0014's window). 0019's `record_tool_open` opened neither, so the statement
-- matched no policy and updated zero rows — and an UPDATE that matches
-- nothing is a success, so nothing was raised and nothing was logged. The
-- counter would have been 0 on every listing forever, silently, and this
-- section passed because the suite ran as a SUPERUSER owner and superusers
-- bypass row-level security entirely.
--
-- So the premise is checked first, and it is checked here rather than only in
-- the container configuration: if `foundit_owner` is ever a superuser again,
-- everything below this line is measuring the wrong database.
-- ===========================================================================
reset role;

do $$
declare r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = 'foundit_owner';
  if not found then perform pg_temp.fail('role foundit_owner does not exist'); end if;
  if r.rolsuper then
    perform pg_temp.fail('foundit_owner is a SUPERUSER, so every row-level security policy '
                         'in this database is switched off for every SECURITY DEFINER '
                         'function in it, and this suite proves nothing about the server. '
                         'See db/dev-roles.sql and .github/workflows/ci.yml.');
  end if;
  if r.rolbypassrls then
    perform pg_temp.fail('foundit_owner has BYPASSRLS, which is the same problem wearing a '
                         'smaller hat');
  end if;
end
$$;

set role foundit_app;

do $$
declare before_n integer; after_n integer; n integer;
begin
  perform pg_temp.be(null);

  select t.open_count into before_n from public.tools t where t.slug = 'tabsplit'::citext;
  if before_n is null then perform pg_temp.fail('tabsplit is not in the catalogue'); end if;

  -- A signed-out stranger may count a click. That is the point: the click is
  -- counted without anybody being identified. And it is counted THROUGH THE
  -- POLICIES, as the non-superuser owner the function runs as.
  perform public.record_tool_open('tabsplit');
  select t.open_count into after_n from public.tools t where t.slug = 'tabsplit'::citext;
  if after_n <> before_n + 1 then
    perform pg_temp.fail(format('open_count went %s -> %s. On a database whose owner is not '
                                'a superuser this is what F1 looked like: no error, no log '
                                'line, and a number that never moves.', before_n, after_n));
  end if;

  -- The application cannot move the counter any other way.
  begin
    update public.tools set open_count = 9999 where slug = 'tabsplit'::citext;
    perform pg_temp.fail('the application wrote open_count directly');
  exception when insufficient_privilege then null;
  end;

  -- A draft's counter does not move for somebody who guessed its slug.
  reset role;
  -- The owner's window (0020 §2) for the fixture: `tools_insert` is
  -- `submitted_by = auth.uid() and status = 'draft'`, and the suite is not
  -- anybody. Closed again before the thing under test.
  perform pg_temp.owner_window(true);
  insert into public.tools (slug, name, url, summary, pricing, status)
  values ('admin-test-draft', 'Admin test draft', 'https://admin-test.example/',
          'A draft that exists only inside this rolled-back transaction.', 'free', 'draft');
  perform pg_temp.owner_window(false);
  set role foundit_app;
  perform pg_temp.be(null);
  perform public.record_tool_open('admin-test-draft');
  reset role;
  perform pg_temp.owner_window(true);
  select t.open_count into n from public.tools t where t.slug = 'admin-test-draft'::citext;
  perform pg_temp.owner_window(false);
  if n <> 0 then perform pg_temp.fail('a draft listing counted an open'); end if;
  set role foundit_app;

  -- And it takes exactly one argument, which is the listing.
  reset role;
  select p.pronargs into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'record_tool_open';
  if n <> 1 then
    perform pg_temp.fail(format('public.record_tool_open takes %s arguments; one is the '
                                'whole guarantee', n));
  end if;
  set role foundit_app;
end
$$;

-- AND THE WINDOW IS WHAT MAKES IT WORK, proved by taking it away.
--
-- The same statement the function runs, sent by hand as the owner with the
-- counters window shut: it must touch NO ROWS. That is the exact reproduction
-- from the Phase 8 review — `UPDATE 0` without the window, `UPDATE 1` with it
-- — and it is here so that a future edit which drops the two set_config lines
-- fails loudly instead of quietly counting nothing.
reset role;

do $$
declare n integer;
begin
  perform set_config('foundit.counters', 'off', true);
  update public.tools
     set open_count = open_count + 1
   where slug = 'tabsplit'::citext
     and status = 'published';
  get diagnostics n = row_count;
  if n <> 0 then
    perform pg_temp.fail(format('the owner updated %s row(s) of public.tools with the '
                                'counters window shut, so either FORCE ROW LEVEL SECURITY '
                                'is off or a policy has been added that should not exist',
                                n));
  end if;

  perform set_config('foundit.counters', 'on', true);
  update public.tools
     set open_count = open_count + 1
   where slug = 'tabsplit'::citext
     and status = 'published';
  get diagnostics n = row_count;
  perform set_config('foundit.counters', 'off', true);
  if n <> 1 then
    perform pg_temp.fail(format('the counters window let the owner update %s row(s); 0014''s '
                                'policy is what public.record_tool_open depends on', n));
  end if;
end
$$;

set role foundit_app;

-- ===========================================================================
-- 8. "Last seen" is a day, it is the caller's own, and it moves once
-- ===========================================================================
do $$
declare d1 date; d2 date; other date; n integer;
begin
  perform pg_temp.be('dev_person');

  d1 := public.note_seen_today();
  if d1 <> current_date then
    perform pg_temp.fail('note_seen_today did not stamp today');
  end if;

  select p.last_seen_day into other from public.profiles p where p.id = 'dev_maker';
  d2 := public.note_seen_today();
  if d2 <> current_date then perform pg_temp.fail('the second call disagreed'); end if;

  -- Nobody else's row moved.
  select count(*) into n from public.profiles p
   where p.id = 'dev_maker' and p.last_seen_day is distinct from other;
  if n <> 0 then perform pg_temp.fail('note_seen_today wrote somebody else''s row'); end if;

  -- A stranger stamps nothing at all.
  perform pg_temp.be(null);
  if public.note_seen_today() is not null then
    perform pg_temp.fail('a signed-out caller was stamped');
  end if;

  -- It takes no argument, so there is no id to pass.
  reset role;
  select p.pronargs into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'note_seen_today';
  if n <> 0 then perform pg_temp.fail('note_seen_today takes an argument'); end if;
  set role foundit_app;
end
$$;

-- ===========================================================================
-- 9. Nothing this migration added weakened anything
-- ===========================================================================
reset role;

do $$
declare bad text;
begin
  -- Row-level security is still on and still forced on every table in public,
  -- including nothing new, because this migration added no table there.
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (not c.relrowsecurity or not c.relforcerowsecurity);
  if bad is not null then
    perform pg_temp.fail('a table in public is not protected: ' || bad);
  end if;

  -- No new policy that is simply `true`.
  select string_agg(format('%s.%s', tablename, policyname), ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and (qual = 'true' or with_check = 'true')
     and tablename <> 'search_events';
  if bad is not null then
    perform pg_temp.fail('policy grants unconditional write: ' || bad);
  end if;

  -- The application still holds nothing on the vector columns or the oracle,
  -- and still nothing in auth_core. 0005 and 0013's separations are untouched.
  if has_column_privilege('foundit_app', 'public.tools', 'embedding', 'select') then
    perform pg_temp.fail('foundit_app can read public.tools.embedding');
  end if;
  if has_schema_privilege('foundit_app', 'auth_core', 'usage') then
    perform pg_temp.fail('foundit_app has USAGE on auth_core');
  end if;

  -- And foundit_embed gained nothing from this phase.
  select string_agg(f.name, ', ') into bad
    from pg_temp.admin_functions() f
   where has_function_privilege('foundit_embed', f.oid, 'execute');
  if bad is not null then
    perform pg_temp.fail('foundit_embed can run an operator function: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 10. F7 — "added by" means added by, and a claim moves neither figure
--
-- `admin_catalogue_added` and `admin_people` were both keyed on
-- `coalesce(t.owner_id, t.submitted_by)`, which answers "who maintains this
-- listing now". One claim — one click, since Phase 7 — moved a listing's
-- "Added by" from @amit to @tomer on the operator's page and moved a count off
-- one handle onto another, with `submitted_by` unchanged throughout.
--
-- The claim below is the real one: public.claim_tool, called by the claimant,
-- which is the only path a listing changes hands by outside an administrator's
-- reassignment.
-- ===========================================================================
set role foundit_app;

do $$
declare
  v_tool     bigint;
  v_slug     text;
  added_before   bigint;
  added_after    bigint;
  kept_before    bigint;
  kept_after     bigint;
  handle_before  text;
  handle_after   text;
  owner_after    text;
begin
  perform pg_temp.be('dev_admin');

  -- A seeded, claimable, unowned listing, and the handle that added it.
  select t.id, t.slug::text into v_tool, v_slug
    from public.tools t
   where t.claimable and t.owner_id is null and t.status = 'published'
     and t.submitted_by is not null
     and t.created_at >= now() - interval '3650 days'
   order by t.id
   limit 1;
  if v_tool is null then
    perform pg_temp.fail('no claimable, unowned, published listing with a submitter to test '
                         'attribution with');
  end if;

  select a.handle into handle_before
    from public.admin_catalogue_added(3650, 10000) a where a.slug = v_slug;
  if handle_before is null then
    perform pg_temp.fail('the Catalogue panel does not credit anybody with adding ' || v_slug);
  end if;

  select p.tools_added, p.tools_maintained into added_before, kept_before
    from public.admin_people(10000) p where p.handle = handle_before;

  -- dev_person claims it, which is what the button on /claim does.
  perform pg_temp.be('dev_person');
  perform public.claim_tool(v_tool, 'https://example.com/proof-for-the-attribution-test');

  perform pg_temp.be('dev_admin');
  select t.owner_id into owner_after from public.tools t where t.id = v_tool;
  if owner_after <> 'dev_person' then
    perform pg_temp.fail('the claim did not land, so nothing was proved about attribution');
  end if;

  -- (a) "Added by" did not move.
  select a.handle into handle_after
    from public.admin_catalogue_added(3650, 10000) a where a.slug = v_slug;
  if handle_after is distinct from handle_before then
    perform pg_temp.fail(format(
      'a claim moved "Added by" on %s from %L to %L; tools.submitted_by never changed',
      v_slug, handle_before, handle_after));
  end if;

  -- (b) ...and the maintainer column did, which is what it is for.
  select a.maintained_by into handle_after
    from public.admin_catalogue_added(3650, 10000) a where a.slug = v_slug;
  if handle_after is distinct from 'tomer' then
    perform pg_temp.fail(format(
      'the maintainer column says %L after dev_person claimed the listing', handle_after));
  end if;

  -- (c) The People panel's "tools added" did not move either, and the new
  --     "tools maintained" did.
  select p.tools_added, p.tools_maintained into added_after, kept_after
    from public.admin_people(10000) p where p.handle = handle_before;
  if added_after <> added_before then
    perform pg_temp.fail(format(
      'a claim moved "tools added" for @%s from %s to %s',
      handle_before, added_before, added_after));
  end if;

  select p.tools_added, p.tools_maintained into added_after, kept_after
    from public.admin_people(10000) p where p.handle = 'tomer';
  if kept_after < 1 then
    perform pg_temp.fail('@tomer claimed a listing and maintains none of them');
  end if;
end
$$;

-- ===========================================================================
-- 11. The owner's window is opened by a list, and the list is here
--
-- 0020 §2 gives a set of SECURITY DEFINER functions a `SET "foundit.definer"
-- = 'on'` clause, which is what lets them reach past the policies on the
-- tables they exist to maintain. That is the fix for the class F1 belongs to,
-- and it is also the thing a future author would reach for to make an
-- inconvenient policy go away.
--
-- So the list is written down HERE, in the file whose job is refusing things,
-- and read back out of the catalogue. A function that acquires the window
-- without appearing below fails this suite, which means acquiring it is a
-- deliberate edit to a test rather than a line in a migration nobody reads.
-- ===========================================================================
reset role;

do $$
declare
  allowed text[] := array[
    -- The three query caches: their writers, their readers and the two
    -- functions that keep a cached row alive.
    'store_query_embedding', 'store_query_reading', 'store_query_rerank',
    'touch_query_embedding', 'touch_query_reading', 'touch_query_rerank',
    'query_embedding_missing', 'query_reading', 'query_rerank',
    'query_vector_ranks',
    -- The embedding queue: filling it, draining it, retiring a job, parking a
    -- job, and the trigger that bounds it.
    'queue_embedding', 'embedding_work', 'embedding_job_done',
    'embedding_job_failed', 'embedding_jobs_guard',
    -- Which listings a search returned, and the two maker panels that read it.
    'log_search_event_tools', 'maker_search_demand', 'maker_listing_metrics',
    -- Vectors and generated text onto listings the embedding role maintains
    -- none of.
    'store_tool_embedding', 'store_problem_embedding', 'store_generated_statement',
    -- A listing changing hands, which by definition the caller does not
    -- maintain yet.
    'claim_tool', 'reassign_tool_owner',
    -- The one operator panel that reads the search side, whose three columns
    -- §2's allowlist pins.
    'admin_catalogue_unmatched',
    -- And the public face of a profile, which is a view and therefore has
    -- nowhere of its own to carry the clause.
    'profiles_public_rows'
  ];
  bad text;
begin
  select string_agg(p.proname::text, ', ' order by p.proname) into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proconfig is not null
     and exists (select 1 from unnest(p.proconfig) c where c like 'foundit.definer=%')
     and not (p.proname::text = any (allowed));
  if bad is not null then
    perform pg_temp.fail(
      'a function opens the owner''s window (0020 §2) and is not on this file''s list: '
      || bad || '. The window reaches past every policy in public for the length of the '
      'call, so acquiring it is a decision, not a detail.');
  end if;

  -- And the list is not stale in the other direction either: every name on it
  -- still exists and still carries the clause.
  select string_agg(a.nm, ', ') into bad
    from unnest(allowed) as a(nm)
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname::text = a.nm
        and p.proconfig is not null
        and exists (select 1 from unnest(p.proconfig) c where c like 'foundit.definer=%')
   );
  if bad is not null then
    perform pg_temp.fail('this file lists a function as opening the owner''s window and it '
                         'does not: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 12. F8 — an author's deletion and an administrator's removal are two events
--
-- `admin_reviews.removed_at` used to be `reviews.deleted_at`, which the AUTHOR
-- sets when they take their own review down. So an author's own deletion
-- appeared in the operator's "Removed" section with no reason and no remover,
-- under copy promising both — and `RECORD_REMOVAL_SQL` refused to record one
-- against it, so there was no way to answer it at all.
--
-- THE DECISION (supervisor, 13 September 2026): an administrator MAY record a
-- removal against a review its author already deleted. The reason is 0015's:
-- an author's own deletion leaves the words re-postable, and the permanent bar
-- in `reviews_removal_is_final` is armed by the EXISTENCE of a removal row,
-- not by `deleted_at`. Without this an author who deletes ahead of a moderator
-- keeps the right to post the same words again.
-- ===========================================================================
set role foundit_app;

do $$
declare rid bigint; n integer; v_tool bigint;
begin
  -- The author takes their own review down.
  rid := pg_temp.review_of('quietroom', 'dev_person');
  if rid is null then perform pg_temp.fail('the seeded review on quietroom is missing'); end if;

  perform pg_temp.be('dev_person');
  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the author could not take their own review down'); end if;

  -- (a) The operator's page tells the two apart.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid
     and a.author_deleted_at is not null
     and a.removed_by_admin_at is null;
  if n <> 1 then
    perform pg_temp.fail('an author''s own deletion is not distinguishable from an '
                         'administrator''s removal on the operator dashboard');
  end if;

  -- (b) And the words are NOT handed to the operator: a retracted review's
  --     text is not operator data (0015's reasoning about collections_read).
  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid and a.body is null;
  if n <> 1 then
    perform pg_temp.fail('the operator was handed the full text of a review its author '
                         'retracted');
  end if;

  -- (c) An administrator may still record a removal against it, which is the
  --     decision above, and the reason goes on the record.
  insert into public.review_removals (review_id, admin_id, reason)
  values (rid, auth.uid(), 'reposting this would be harassment, and it was already down');

  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid
     and a.removed_by_admin_at is not null
     and a.author_deleted_at is not null
     and a.removal_reason = 'reposting this would be harassment, and it was already down'
     and a.removed_by = 'amit';
  if n <> 1 then
    perform pg_temp.fail('a removal recorded against an author-deleted review did not reach '
                         'the operator dashboard');
  end if;

  -- (d) ...and the text comes back, because an administrator has now made a
  --     decision about it and the reason is about those words.
  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid and a.body is not null;
  if n <> 1 then
    perform pg_temp.fail('an administrator recorded a removal and cannot see what it is about');
  end if;

  -- (e) THE PERMANENT BAR IS ARMED. This is the whole point of allowing it:
  --     before the removal row the author could write the same review again,
  --     and now they cannot.
  perform pg_temp.be('dev_person');
  select r.tool_id into v_tool from public.reviews r where r.id = rid;
  begin
    insert into public.reviews (tool_id, author_id, rating, body)
    values (v_tool, auth.uid(), 5::smallint, 'the same thing again, after deleting it myself');
    perform pg_temp.fail('an author deleted their own review, an administrator recorded a '
                         'removal against it, and the author posted it again anyway');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- ===========================================================================
-- 13. F10 — a reason is text a person typed, and carries no control bytes
--
-- Every other person-supplied string in this schema is stripped and then
-- CHECKed (0017, 0018). Phase 8 is the phase that made this one typeable
-- through a screen and added neither, so a bell character, an escape sequence
-- and a right-to-left override all reached the author's Settings page and the
-- body of the removal email.
-- ===========================================================================
do $$
declare rid bigint; ok boolean := false;
begin
  perform pg_temp.be('dev_admin');
  rid := pg_temp.review_of('splitwise', 'dev_person');
  if rid is null then perform pg_temp.fail('the seeded review on splitwise is missing'); end if;

  begin
    insert into public.review_removals (review_id, admin_id, reason)
    values (rid, auth.uid(),
            'defamatory' || chr(7) || chr(1) || chr(27) || '[31m and ' ||
            chr(8238) || ' reversed');
    perform pg_temp.fail('a removal reason with a bell, a start-of-heading, an escape and a '
                         'right-to-left override was accepted');
  exception when check_violation then ok := true;
  end;
  if not ok then perform pg_temp.fail('the control-byte reason was refused by the wrong rule'); end if;

  -- And the same reason with the control characters taken out is accepted,
  -- so the CHECK refuses the bytes rather than the sentence.
  insert into public.review_removals (review_id, admin_id, reason)
  values (rid, auth.uid(), 'defamatory [31m and reversed');
end
$$;

-- ===========================================================================
-- 14. F11 — one removal is one row, and "Reviews removed" counts reviews
--
-- Nothing stopped an administrator writing a second `review_removals` row
-- against a review that was already down. `admin_words` counted rows, so the
-- Words panel over-counted; the author's own Settings page showed them one
-- deletion twice; `admin_reviews` showed only the newest.
-- ===========================================================================
do $$
declare rid bigint; before_n bigint; after_n bigint; ok boolean := false;
begin
  perform pg_temp.be('dev_admin');
  rid := pg_temp.review_of('splitwise', 'dev_person');

  select w.removed into before_n from public.admin_words(2) w
   where w.day = (now() at time zone 'UTC')::date;

  begin
    insert into public.review_removals (review_id, admin_id, reason)
    values (rid, auth.uid(), 'a second reason for a review that is already down');
    perform pg_temp.fail('a second removal row was accepted against one review');
  exception when unique_violation then ok := true;
  end;
  if not ok then perform pg_temp.fail('the second removal was refused by the wrong rule'); end if;

  -- The Words panel counts reviews, so it did not move.
  select w.removed into after_n from public.admin_words(2) w
   where w.day = (now() at time zone 'UTC')::date;
  if after_n <> before_n then
    perform pg_temp.fail(format('the Words panel moved from %s to %s on a removal that was '
                                'refused', before_n, after_n));
  end if;

  -- And it is distinct review_id rather than a row count, said as SQL rather
  -- than inferred: the column the panel counts is the review, so if the unique
  -- index above were ever relaxed the number would still be right.
  reset role;
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_words')
     !~ 'count\(distinct rr\.review_id\)' then
    perform pg_temp.fail('public.admin_words counts review_removals rows rather than distinct '
                         'reviews');
  end if;
  set role foundit_app;
end
$$;

reset role;

select 'All operator-dashboard checks passed.' as result;

-- ===========================================================================
-- Everything passed. Put the database back exactly as it was found.
-- ===========================================================================
rollback;
