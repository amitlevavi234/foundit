-- ===========================================================================
-- Does the database actually refuse to let search text become personal data?
--
-- Companion to db/test/rls_test.sql, same shape and same rules: run against a
-- seeded development database, every check raises on failure, the script
-- either finishes with one success line or stops at the first problem. It
-- covers what db/migrations/0003_hardening.sql added, and the two holes that
-- migration closed:
--
--   * search_events.query_hash accepted any string at all, so the one table
--     that must never be joinable to a person could be turned into a per-user
--     search transcript by writing 'user:<id>|session:<id>' into a column
--     that already existed and is already indexed.
--   * profiles_read was USING (true), so is_admin — the flag that decides who
--     reaches the operator dashboard — was readable by anonymous strangers.
--
-- Tests of BEHAVIOUR, not of the presence of a policy: try the thing, see
-- what the database does with it. The structural checks at the top exist only
-- for the invariants that cannot be observed from outside — a CHECK
-- constraint that a trigger makes unreachable, and the shape of a view.
--
-- THE WHOLE SUITE RUNS IN ONE TRANSACTION AND ALWAYS ROLLS BACK. It inserts
-- into search_events and briefly disables a trigger, so it must leave nothing
-- behind; if a check fails, ON_ERROR_STOP aborts psql and the server rolls
-- the transaction back on disconnect. Either way the database is exactly as
-- it was. Run it three times in a row and the output is identical.
--
-- One thing a rollback cannot undo, and should not: search_events.id is an
-- identity column, and a sequence never rolls back. Each run advances that
-- sequence by six and leaves no rows behind. That is how sequences work
-- everywhere, it is why nobody should read meaning into a gap in the ids, and
-- it is the only trace this suite leaves.
--
--   docker exec -i foundit-dev-db psql -v ON_ERROR_STOP=1 -U foundit_owner \
--     -d foundit < db/test/search_events_test.sql
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
end;
$$;

create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'SEARCH EVENTS TEST FAILED: %', msg;
end;
$$;

-- The normalization the trigger and log_search_event both use. Written out
-- again here on purpose: a test that reuses the code under test proves only
-- that the code equals itself.
create or replace function pg_temp.expected_hash(p_text text)
returns text language sql immutable as $$
  select encode(
    sha256(convert_to(lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')), 'UTF8')),
    'hex');
$$;

-- ===========================================================================
-- 0. The premise. Everything below is meaningless if the application role can
--    ignore row-level security, so check that first.
-- ===========================================================================
do $$
declare r record;
begin
  select rolsuper, rolbypassrls, rolcanlogin into r
    from pg_roles where rolname = 'foundit_app';
  if not found then
    perform pg_temp.fail('role foundit_app does not exist');
  end if;
  if r.rolsuper then
    perform pg_temp.fail('foundit_app is a superuser and bypasses every policy');
  end if;
  if r.rolbypassrls then
    perform pg_temp.fail('foundit_app has BYPASSRLS and ignores every policy');
  end if;
  if not r.rolcanlogin then
    perform pg_temp.fail('foundit_app cannot log in, so development will measure '
                      || 'latency as the owner instead — see eval/baselines.md');
  end if;
end
$$;

-- A default statement_timeout on the application role: the ceiling on every
-- query it sends, not only on a long one.
do $$
declare cfg text[];
begin
  select rolconfig into cfg from pg_roles where rolname = 'foundit_app';
  if cfg is null or not exists (
       select 1 from unnest(cfg) s where s like 'statement_timeout=%') then
    perform pg_temp.fail('foundit_app has no default statement_timeout');
  end if;
end
$$;

-- ===========================================================================
-- 1. Structural: the invariants that a trigger makes unobservable.
--
--    The two CHECK constraints on search_events can never fire while the
--    normalizing trigger is in place — the trigger has already made every row
--    satisfy them. They are the written-down invariant and the backstop for
--    the day the trigger is dropped, so their existence is worth asserting
--    directly, and §4 below proves they actually bite.
-- ===========================================================================
do $$
declare n integer;
begin
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.search_events'::regclass
     and contype = 'c'
     and conname in ('search_events_hash_is_sha256', 'search_events_text_capped');
  if n <> 2 then
    perform pg_temp.fail('search_events is missing a CHECK constraint on '
                      || 'query_hash and/or query_text (found ' || n || ' of 2)');
  end if;

  select count(*) into n
    from pg_trigger
   where tgrelid = 'public.search_events'::regclass
     and tgname = 'search_events_normalize'
     and not tgisinternal
     and tgenabled = 'O';
  if n <> 1 then
    perform pg_temp.fail('the search_events_normalize trigger is missing or disabled');
  end if;
end
$$;

-- Neither half of search may be SECURITY DEFINER. If it were, row-level
-- security would stop applying to the tables search reads, and a draft
-- listing would become searchable.
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('search_tools', 'search_tools_impl', 'log_search_event',
                       'search_events_normalize')
     and p.prosecdef;
  if bad is not null then
    perform pg_temp.fail('SECURITY DEFINER on a function that must run as the '
                      || 'caller: ' || bad);
  end if;
end
$$;

-- The public projection of a profile must not carry the private columns.
do $$
declare bad text;
begin
  if to_regclass('public.profiles_public') is null then
    perform pg_temp.fail('public.profiles_public does not exist');
  end if;
  select string_agg(a.attname, ', ') into bad
    from pg_attribute a
   where a.attrelid = 'public.profiles_public'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('is_admin', 'plan', 'updated_at');
  if bad is not null then
    perform pg_temp.fail('profiles_public exposes a private column: ' || bad);
  end if;
end
$$;

-- The gap that let this through: db/test/rls_test.sql's "no blanket policy"
-- check only inspects INSERT, UPDATE, DELETE and ALL policies, so a SELECT
-- policy of `true` is exempt by construction and nothing flagged
-- profiles_read. Here the unconditional SELECT policies are an allow-list, so
-- adding a new one fails this test until somebody argues for it in writing.
--
--   categories  — an editorial taxonomy. There is nothing in it but names.
--   tool_likes  — a join of (user_id, tool_id), and therefore genuinely
--                 unconditional: anyone can read who liked what. That is a
--                 live question rather than a settled one; if the answer is
--                 that attribution should not be public, this policy changes
--                 and this list shrinks.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and cmd = 'SELECT'
     and qual = 'true'
     and tablename not in ('categories', 'tool_likes');
  if bad is not null then
    perform pg_temp.fail('a SELECT policy is unconditional and not on the '
                      || 'allow-list: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- Everything below runs AS the application role, which is the only way any
-- of this is exercised in real life.
-- ===========================================================================
set role foundit_app;

-- ===========================================================================
-- 2. The demonstrated attack: a forged query_hash.
--
--    This is the exact insert an adversarial review ran successfully against
--    a live database. It still succeeds — there is nothing to protect on the
--    way in, and an anonymous search must still be counted — but the string
--    the caller supplied is discarded and the hash is derived from the query
--    text instead. The correlation handle never reaches the table.
-- ===========================================================================
do $$
begin
  perform pg_temp.be(null);
  -- `match_judged` joined this row in 0010, and the CHECK that came with it
  -- refuses `had_good_match` on its own. The subject of this fixture is the
  -- forged query_hash beside it, not the quality columns, so it says both and
  -- goes on testing the thing it was written to test.
  insert into public.search_events
    (query_text, query_hash, result_count, top_score, had_good_match, latency_ms,
     match_judged)
  values ('how do I hide money from my ex', 'user:dev_person|session:abc123',
          3, 0.9, true, 10, true);
end
$$;

reset role;

do $$
declare v record;
begin
  select query_hash, query_text into v
    from public.search_events
   where query_text = 'how do I hide money from my ex';
  if not found then
    perform pg_temp.fail('the search was not recorded at all');
  end if;
  if v.query_hash = 'user:dev_person|session:abc123' then
    perform pg_temp.fail('foundit_app wrote a forged query_hash: search text is '
                      || 'now joinable to a person');
  end if;
  if v.query_hash !~ '^[0-9a-f]{64}$' then
    perform pg_temp.fail('query_hash is not a hex sha256: ' || v.query_hash);
  end if;
  if v.query_hash <> pg_temp.expected_hash(v.query_text) then
    perform pg_temp.fail('query_hash is not the sha256 of the query text it sits '
                      || 'beside, so it is a hash of something else');
  end if;
end
$$;

-- Nothing anywhere in the table carries the smuggled string.
do $$
declare n integer;
begin
  select count(*) into n from public.search_events
   where query_hash like '%dev_person%' or query_hash like '%session%'
      or query_hash like '%:%' or query_hash like '%|%';
  if n > 0 then
    perform pg_temp.fail(n || ' row(s) in search_events carry an identifier-shaped '
                      || 'query_hash');
  end if;
end
$$;

-- ===========================================================================
-- 3. The 200-character cap, which lived only inside log_search_event.
-- ===========================================================================
set role foundit_app;

do $$
begin
  perform pg_temp.be(null);
  insert into public.search_events
    (query_text, query_hash, result_count, had_good_match)
  values (repeat('z', 5000), 'not a hash either', 0, false);
end
$$;

reset role;

do $$
declare v record;
begin
  select query_text, query_hash into v
    from public.search_events where query_text like 'zzz%';
  if not found then
    perform pg_temp.fail('the over-long search was not recorded');
  end if;
  if length(v.query_text) > 200 then
    perform pg_temp.fail('foundit_app stored ' || length(v.query_text)
                      || ' characters of query text; the cap is 200');
  end if;
  if v.query_hash <> pg_temp.expected_hash(v.query_text) then
    perform pg_temp.fail('the hash of a truncated query does not match the text '
                      || 'that was kept');
  end if;
end
$$;

-- The intended door still works, and lands the same shape.
set role foundit_app;
do $$
begin
  perform pg_temp.be(null);
  perform public.log_search_event('  Split   a  BILL  ', 4, 0.42::real, true, 12);
end
$$;
reset role;

do $$
declare v record;
begin
  select query_text, query_hash into v
    from public.search_events where query_text = 'Split   a  BILL';
  if not found then
    perform pg_temp.fail('log_search_event recorded nothing');
  end if;
  if v.query_hash <> pg_temp.expected_hash('split a bill') then
    perform pg_temp.fail('log_search_event and the trigger disagree about how a '
                      || 'query is normalized before hashing');
  end if;
end
$$;

-- Whatever route a row arrived by, the invariant holds for the whole table.
do $$
declare n integer;
begin
  select count(*) into n from public.search_events
   where query_hash <> pg_temp.expected_hash(query_text)
      or length(query_text) > 200;
  if n > 0 then
    perform pg_temp.fail(n || ' row(s) in search_events break the invariant '
                      || 'query_hash = sha256(normalized query_text)');
  end if;
end
$$;

-- ===========================================================================
-- 4. The backstop. The CHECK constraints are unreachable while the trigger is
--    in place, so prove they bite by taking the trigger away — which is the
--    situation they exist for.
--
--    Disabling a trigger needs ownership of the table, which foundit_app does
--    not have; this runs as the owner and puts it straight back.
-- ===========================================================================
alter table public.search_events disable trigger search_events_normalize;

set role foundit_app;
do $$
begin
  perform pg_temp.be(null);

  -- Each of the three below expects a check_violation for ONE stated reason.
  -- `match_judged` is passed with `had_good_match` so that 0010's own CHECK is
  -- not the one raising: a row that violates two constraints tests neither, and
  -- these three would have gone on passing while the constraint they are about
  -- was dropped.
  begin
    insert into public.search_events
      (query_text, query_hash, result_count, had_good_match, match_judged)
    values ('how do I hide money from my ex', 'user:dev_person|session:abc123', 3, true, true);
    perform pg_temp.fail('with the trigger off, a forged query_hash was accepted: '
                      || 'the CHECK constraint is not doing its job');
  exception when check_violation then null;
  end;

  -- 64 characters, but of the wrong alphabet. The constraint is a shape, not
  -- a length.
  begin
    insert into public.search_events
      (query_text, query_hash, result_count, had_good_match, match_judged)
    values ('a query', repeat('Z', 64), 1, true, true);
    perform pg_temp.fail('a 64-character non-hex query_hash was accepted');
  exception when check_violation then null;
  end;

  begin
    insert into public.search_events
      (query_text, query_hash, result_count, had_good_match, match_judged)
    values (repeat('q', 201), repeat('a', 64), 1, true, true);
    perform pg_temp.fail('201 characters of query text were accepted; the cap is 200');
  exception when check_violation then null;
  end;
end
$$;
reset role;

alter table public.search_events enable trigger search_events_normalize;

-- ===========================================================================
-- 5. Nobody but an admin reads the log back.
-- ===========================================================================
set role foundit_app;
do $$
declare n integer;
begin
  perform pg_temp.be(null);
  select count(*) into n from public.search_events;
  if n > 0 then
    perform pg_temp.fail('an anonymous stranger read ' || n || ' row(s) of the '
                      || 'search log');
  end if;

  perform pg_temp.be('dev_person');
  select count(*) into n from public.search_events;
  if n > 0 then
    perform pg_temp.fail('an ordinary signed-in user read the search log');
  end if;

  perform pg_temp.be('dev_maker');
  select count(*) into n from public.search_events;
  if n > 0 then
    perform pg_temp.fail('a listing maintainer read the search log');
  end if;

  -- Not a typo: an admin must still be able to. A table nobody can read is
  -- not privacy, it is a bug, and the aggregate panel depends on this.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.search_events;
  if n = 0 then
    perform pg_temp.fail('an admin cannot read the search log');
  end if;
end
$$;

-- ===========================================================================
-- 6. is_admin is not public, and neither is anything else on a profile
--    beyond the six columns that are meant to be.
-- ===========================================================================
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  select count(*) into n from public.profiles;
  if n > 0 then
    perform pg_temp.fail('an anonymous stranger read ' || n || ' profile row(s) '
                      || 'straight off the table');
  end if;

  select count(*) into n from public.profiles where is_admin;
  if n > 0 then
    perform pg_temp.fail('an anonymous stranger can enumerate the administrators');
  end if;

  select count(*) into n from public.profiles where id = 'dev_admin' and is_admin;
  if n > 0 then
    perform pg_temp.fail('an anonymous stranger can read is_admin for a named person');
  end if;
end
$$;

-- A signed-in stranger is still a stranger to somebody else's row.
do $$
declare n integer;
begin
  perform pg_temp.be('dev_person');

  select count(*) into n from public.profiles;
  if n <> 1 then
    perform pg_temp.fail('an ordinary user sees ' || n || ' profile rows; they '
                      || 'should see exactly their own');
  end if;

  select count(*) into n from public.profiles where id = 'dev_admin' and is_admin;
  if n > 0 then
    perform pg_temp.fail('an ordinary user can read another person''s is_admin');
  end if;

  select count(*) into n from public.profiles where id = 'dev_person';
  if n <> 1 then
    perform pg_temp.fail('a person cannot read their own profile');
  end if;
end
$$;

-- An admin still sees everything, or the operator tooling has no data.
do $$
declare n integer;
begin
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.profiles;
  if n < 3 then
    perform pg_temp.fail('an admin sees only ' || n || ' profiles');
  end if;
  select count(*) into n from public.profiles where id = 'dev_admin' and is_admin;
  if n <> 1 then
    perform pg_temp.fail('an admin cannot read is_admin');
  end if;
end
$$;

-- The public face still works. A review byline needs a display name and an
-- avatar, and a stranger must be able to render one.
--
-- This is also the tripwire for the one dependency profiles_public has: it
-- runs with its owner's rights, so it returns rows only while that owner is
-- not itself subject to profiles' FORCED row-level security. If that ever
-- changes, this check fails loudly instead of every byline in the product
-- quietly going blank.
do $$
declare n integer; v text;
begin
  perform pg_temp.be(null);

  select count(*) into n from public.profiles_public;
  if n < 3 then
    perform pg_temp.fail('an anonymous reader sees ' || n || ' rows in '
                      || 'profiles_public; the public face of a profile is gone');
  end if;

  select display_name into v from public.profiles_public where id = 'dev_admin';
  if v is null then
    perform pg_temp.fail('profiles_public does not carry a display name');
  end if;

  begin
    execute 'select is_admin from public.profiles_public limit 1';
    perform pg_temp.fail('profiles_public has an is_admin column after all');
  exception when undefined_column then null;
  end;
end
$$;

-- ===========================================================================
-- 7. The public search endpoint has a ceiling.
--
--    An anonymous stranger can reach search_tools, and before 0003 nothing
--    bounded what they could hand it: a 13,250-character sentence cost ~280 ms
--    of server CPU per call. Phase 4 caps the input in the application; the
--    database no longer depends on that.
-- ===========================================================================
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  -- 200 characters is fine, and still returns results.
  select count(*) into n
    from public.search_tools(rpad('split expenses with friends while travelling',
                                  200, ' x'));
  if n = 0 then
    perform pg_temp.fail('a 200-character query returned nothing; the cap is too tight');
  end if;

  begin
    perform count(*) from public.search_tools(repeat('split expenses ', 900));
    perform pg_temp.fail('a 13,500-character query was accepted');
  exception when string_data_right_truncation then null;
  end;

  -- One character over, to prove the boundary is where it says it is.
  begin
    perform count(*) from public.search_tools(repeat('a', 201));
    perform pg_temp.fail('a 201-character query was accepted; the cap is 200');
  exception when string_data_right_truncation then null;
  end;

  -- Trailing whitespace is trimmed before measuring, exactly as
  -- log_search_event trims before storing, so the two layers agree on what
  -- "200 characters" means.
  select count(*) into n
    from public.search_tools(rpad('offline notes', 200, ' '));
  if n = 0 then
    perform pg_temp.fail('a 200-character query padded with spaces was refused');
  end if;

  -- The refusal must not echo the query back. This endpoint collects health,
  -- money and relationship trouble, and an error message ends up in a log.
  begin
    perform count(*) from public.search_tools(repeat('leaving my husband ', 20));
    perform pg_temp.fail('a 380-character query was accepted');
  exception when string_data_right_truncation then
    if sqlerrm like '%husband%' then
      perform pg_temp.fail('the length error quotes the query text back: ' || sqlerrm);
    end if;
  end;
end
$$;

-- Search itself still behaves: the wrapper delegates, it does not decide.
do $$
declare n integer; v_drafts integer;
begin
  perform pg_temp.be('dev_maker');

  select count(*) into n from public.search_tools('split expenses with friends');
  if n = 0 then
    perform pg_temp.fail('search returned nothing for a query that should match');
  end if;

  -- A maintainer may read their own drafts, and search must still refuse to
  -- show them — that predicate lives in the implementation, and the wrapper
  -- must not have changed it.
  select count(*) into v_drafts
    from public.search_tools('split expenses with friends', p_limit => 50) s
    join public.tools t on t.id = s.tool_id
   where t.status <> 'published';
  if v_drafts > 0 then
    perform pg_temp.fail('search returned ' || v_drafts || ' unpublished listing(s)');
  end if;
end
$$;

reset role;

rollback;

select 'All search_events and profile-privacy checks passed.' as result;
