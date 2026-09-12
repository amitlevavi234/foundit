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
-- ===========================================================================
set role foundit_app;

do $$
declare
  f       record;
  who     text;
  refused boolean;
begin
  foreach who in array array[null, 'dev_person', 'dev_maker', 'nobody_at_all']
  loop
    perform pg_temp.be(who);
    for f in select * from pg_temp.admin_functions()
    loop
      refused := false;
      begin
        execute format('select * from public.%I()', f.name);
      exception
        when insufficient_privilege then refused := true;
        when others then
          perform pg_temp.fail(format(
            'public.%s() raised %s (%s) for %L instead of 42501',
            f.name, sqlstate, sqlerrm, coalesce(who, 'a signed-out stranger')));
      end;
      if not refused then
        perform pg_temp.fail(format(
          'public.%s() answered %L, who is not an administrator',
          f.name, coalesce(who, 'a signed-out stranger')));
      end if;
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
-- these functions were broken.
do $$
declare f record; n integer := 0;
begin
  perform pg_temp.be('dev_admin');
  if not auth.is_admin() then perform pg_temp.fail('dev_admin is not an admin'); end if;
  for f in select * from pg_temp.admin_functions()
  loop
    begin
      execute format('select * from public.%I()', f.name);
      n := n + 1;
    exception when others then
      perform pg_temp.fail(format('public.%s() raised %s (%s) for the ADMIN',
                                  f.name, sqlstate, sqlerrm));
    end;
  end loop;
  if n < 10 then perform pg_temp.fail('the admin could run almost nothing'); end if;
end
$$;

-- ===========================================================================
-- 2. Search text and a person are never joined
--
-- (a) The SQL of every admin function, read back out of the catalogue, may
--     not name a table from both lists. This is the check that survives a
--     future edit: somebody adding "and which handle typed it" to a demand
--     panel has to add a people table to a body that already names a search
--     table, and this fails before the screen is written.
--
--     A GRANT WITHOUT A CHECK fails here too, in the same pass, because the
--     two questions have the same answer — a function foundit_app can call is
--     a function a stranger can reach through a page.
-- ===========================================================================
reset role;

do $$
declare
  f    record;
  def  text;
  bad  text := null;
  searchy text := '\m(search_events|search_event_tools|query_embeddings|query_readings|query_reranks)\M';
  peopley text := '\m(profiles|profiles_public|auth_core|collections|collection_items|tool_likes|reviews|review_removals|tool_claims|ownership_changes)\M';
begin
  for f in select * from pg_temp.admin_functions()
  loop
    def := pg_get_functiondef(f.oid);

    if def ~ searchy and def ~ peopley then
      bad := coalesce(bad || ', ', '') || f.name;
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

-- The list is not vacuous: at least one function names a search table and at
-- least one names a people table, so (a) is comparing two live sets.
do $$
declare s int; p int;
begin
  select count(*) into s from pg_temp.admin_functions() f
   where pg_get_functiondef(f.oid) ~ '\m(search_events|search_event_tools)\M';
  select count(*) into p from pg_temp.admin_functions() f
   where pg_get_functiondef(f.oid) ~ '\m(profiles|reviews|tool_likes)\M';
  if s = 0 then perform pg_temp.fail('no admin function reads the search side at all'); end if;
  if p = 0 then perform pg_temp.fail('no admin function reads the people side at all'); end if;
end
$$;

-- (b) A function that hands back query text hands back nothing that could say
--     whose it was. The OUT columns are read from the catalogue, so a column
--     added later is inspected without this file changing.
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
      if col ~* '(user|author|owner|actor|admin|claimant|handle|profile|account|email|address|ip|session|visitor|person|submitted|id)$'
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

  -- (i) And it is on the operator's list, with the reason and the handle.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.admin_reviews(500, 0) a
   where a.review_id = rid
     and a.removed_at is not null
     and a.removal_reason = 'names a person who did not consent to being named'
     and a.removed_by = 'amit';
  if n <> 1 then perform pg_temp.fail('the removal is not on the operator dashboard'); end if;
end
$$;

-- ===========================================================================
-- 7. "Opened from Foundit" counts a click and cannot count a person
--
-- docs/product-decisions.md §12. The function takes a slug and there is no
-- second argument to give it.
-- ===========================================================================
do $$
declare before_n integer; after_n integer; n integer;
begin
  perform pg_temp.be(null);

  select t.open_count into before_n from public.tools t where t.slug = 'tabsplit'::citext;
  if before_n is null then perform pg_temp.fail('tabsplit is not in the catalogue'); end if;

  -- A signed-out stranger may count a click. That is the point: the click is
  -- counted without anybody being identified.
  perform public.record_tool_open('tabsplit');
  select t.open_count into after_n from public.tools t where t.slug = 'tabsplit'::citext;
  if after_n <> before_n + 1 then
    perform pg_temp.fail(format('open_count went %s -> %s', before_n, after_n));
  end if;

  -- The application cannot move the counter any other way.
  begin
    update public.tools set open_count = 9999 where slug = 'tabsplit'::citext;
    perform pg_temp.fail('the application wrote open_count directly');
  exception when insufficient_privilege then null;
  end;

  -- A draft's counter does not move for somebody who guessed its slug.
  reset role;
  insert into public.tools (slug, name, url, summary, pricing, status)
  values ('admin-test-draft', 'Admin test draft', 'https://admin-test.example/',
          'A draft that exists only inside this rolled-back transaction.', 'free', 'draft');
  set role foundit_app;
  perform pg_temp.be(null);
  perform public.record_tool_open('admin-test-draft');
  reset role;
  select t.open_count into n from public.tools t where t.slug = 'admin-test-draft'::citext;
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

select 'All operator-dashboard checks passed.' as result;

-- ===========================================================================
-- Everything passed. Put the database back exactly as it was found.
-- ===========================================================================
rollback;
