-- ===========================================================================
-- Does the database actually refuse what 0008_reader.sql promises?
--
-- Same shape and same rules as db/test/vectors_test.sql: run against a seeded
-- development database, every check raises on failure, the script either
-- finishes with one success line or stops at the first problem.
--
-- THE WHOLE SUITE RUNS IN ONE TRANSACTION AND ALWAYS ROLLS BACK. It writes to
-- the reading cache, so it must leave nothing behind; if a check fails,
-- ON_ERROR_STOP abandons psql and the server rolls the transaction back on
-- disconnect. Either way the database is exactly as it was. Run it three times
-- in a row and the output is identical.
--
-- Six claims are worth a behavioural test, and they are the six an adversarial
-- review would go at first:
--
--   1. foundit_app cannot read or write public.query_readings directly. The
--      cache holds sentences people typed, and the table's defence is that it
--      has no policy and the application role has no grant — two refusals,
--      neither of which is a policy evaluating to `true`.
--
--   2. The three functions work anyway, as foundit_app, because that is the
--      only door and a door that does not open is not a design.
--
--   3. THE TABLE HAS NOTHING THAT COULD IDENTIFY A PERSON, and there is no
--      argument anywhere that could carry one in. This is the promise that is
--      easiest to break by adding a helpful column later.
--
--   4. The 200-character ceiling still bites, and it RAISES rather than
--      truncating — two sentences sharing a 200-character prefix must never
--      share a reading.
--
--   5. A reading of the wrong shape is refused by the database, not only by
--      TypeScript. The CHECK is the layer a future caller cannot skip.
--
--   6. A reading recorded under a different model is invisible, so changing
--      public.reading_model() in a migration retires every stale row at once.
--
--   7. A cached REFUSAL expires after a day and an ordinary reading does not
--      (0009). It is the one answer that empties a page without searching, and
--      one bad sample must not do that for ever.
--
--   docker exec -i foundit-dev-db psql -v ON_ERROR_STOP=1 -U foundit_owner \
--     -d foundit < db/test/reader_test.sql
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'READER TEST FAILED: %', msg;
end;
$$;

/** A well-formed reading, for the cases that need one. */
create or replace function pg_temp.reading()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'pricing',           jsonb_build_array('free'),
    'platforms',         jsonb_build_array(),
    'languages',         jsonb_build_array(),
    'flags',             jsonb_build_array('works_offline'),
    'english',           '',
    'asks_for_software', true,
    'residual',          'a tool to split expenses'
  );
$$;

-- ===========================================================================
-- 0. The premise, again. Everything here is meaningless if the application
--    role can ignore row-level security.
-- ===========================================================================
do $$
declare r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = 'foundit_app';
  if not found then
    perform pg_temp.fail('role foundit_app does not exist');
  end if;
  if r.rolsuper or r.rolbypassrls then
    perform pg_temp.fail('foundit_app bypasses row-level security');
  end if;
end
$$;

-- ===========================================================================
-- 1. Structural: the cache is guarded the way the migration says it is.
-- ===========================================================================
do $$
declare n integer;
begin
  if to_regclass('public.query_readings') is null then
    perform pg_temp.fail('public.query_readings does not exist');
  end if;

  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'query_readings'
     and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 1 then
    perform pg_temp.fail('row-level security is not enabled AND forced on query_readings');
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'query_readings';
  if n <> 0 then
    perform pg_temp.fail(
      format('query_readings has %s policy/policies; it must have none at all', n));
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'query_readings'
     and grantee = 'foundit_app';
  if n <> 0 then
    perform pg_temp.fail('foundit_app holds a grant on query_readings; it must hold none');
  end if;
end
$$;

-- ===========================================================================
-- 2. No column, anywhere, that could be a person.
--
--    The same check search_events and query_embeddings get, and for the same
--    reason: this is the promise a later migration breaks by adding something
--    helpful.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(column_name, ', ') into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'query_readings'
     and (
       column_name ~* '(user|person|profile|account|session|ip|addr|device|fingerprint|request|visitor)'
     );
  if bad is not null then
    perform pg_temp.fail(format('query_readings has a column that could identify somebody: %s', bad));
  end if;

  -- And no foreign key out of it at all: a key to anything is a key to
  -- something that has a person on the other end eventually.
  select string_agg(conname, ', ') into bad
    from pg_constraint
   where conrelid = 'public.query_readings'::regclass and contype = 'f';
  if bad is not null then
    perform pg_temp.fail(format('query_readings has a foreign key: %s', bad));
  end if;

  -- Nor may the setter grow an argument that could carry one.
  select string_agg(p.parameter_name, ', ') into bad
    from information_schema.parameters p
    join information_schema.routines r
      on r.specific_name = p.specific_name and r.specific_schema = p.specific_schema
   where r.routine_schema = 'public' and r.routine_name = 'store_query_reading'
     and p.parameter_name ~* '(user|person|session|ip|addr|device|request|visitor)';
  if bad is not null then
    perform pg_temp.fail(format('store_query_reading takes something identifying: %s', bad));
  end if;
end
$$;

-- ===========================================================================
-- 3. The application role is refused the table and allowed the doors.
-- ===========================================================================
set local role foundit_app;

do $$
begin
  begin
    perform 1 from public.query_readings limit 1;
    perform pg_temp.fail('foundit_app can SELECT from query_readings');
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.query_readings (query_norm, reading, reading_model)
    values ('x', pg_temp.reading(), public.reading_model());
    perform pg_temp.fail('foundit_app can INSERT into query_readings');
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- The doors open. Store, read back, and touch — all as foundit_app.
do $$
declare got jsonb;
begin
  perform public.store_query_reading(
    '  A Tool To Split   Expenses  ', pg_temp.reading(), public.reading_model());

  -- Keyed on the NORMALISED sentence: the same question typed with different
  -- spacing and capitals is one row, which is the whole point of the cache.
  got := public.query_reading('a tool to split expenses');
  if got is null then
    perform pg_temp.fail('a stored reading could not be read back under its normalised key');
  end if;
  if got -> 'asks_for_software' <> 'true'::jsonb then
    perform pg_temp.fail('the reading came back changed');
  end if;

  -- A sentence nobody has read is a null, not an error and not an empty object:
  -- null is what makes the application call the model.
  if public.query_reading('a sentence nobody has ever typed here before') is not null then
    perform pg_temp.fail('an unread sentence must come back null');
  end if;

  perform public.touch_query_reading('a tool to split expenses');
end
$$;

-- ===========================================================================
-- 4. The 200-character ceiling raises rather than truncating.
--
--    normalize_query caps with left(), so two sentences sharing a 200-character
--    prefix normalise to the SAME key. Truncating would serve the second one
--    the first one's reading, silently, for as long as the row lived.
-- ===========================================================================
do $$
begin
  begin
    perform public.store_query_reading(
      repeat('a', 201), pg_temp.reading(), public.reading_model());
    perform pg_temp.fail('a 201-character query was accepted');
  exception
    when string_data_right_truncation then null;
  end;

  -- And 200 exactly is fine, so the boundary is a ceiling and not an off-by-one.
  perform public.store_query_reading(
    repeat('b', 200), pg_temp.reading(), public.reading_model());
end
$$;

-- ===========================================================================
-- 5. A reading of the wrong shape is refused by the DATABASE.
--
--    lib/reader-model.ts validates before it gets here. This is the layer a
--    future caller — a script, a migration, a later phase — cannot skip.
-- ===========================================================================
do $$
declare
  bad jsonb;
  cases jsonb[] := array[
    -- a missing field
    (pg_temp.reading() - 'residual'),
    -- an extra field, which is where a tool name would arrive
    (pg_temp.reading() || '{"tool": "splitwise"}'::jsonb),
    -- the boolean as a string
    (pg_temp.reading() || '{"asks_for_software": "yes"}'::jsonb),
    -- an array that is not an array
    (pg_temp.reading() || '{"flags": "works_offline"}'::jsonb),
    -- a string that is not a string
    (pg_temp.reading() || '{"english": 42}'::jsonb)
  ];
begin
  foreach bad in array cases loop
    begin
      perform public.store_query_reading('a badly shaped one', bad, public.reading_model());
      perform pg_temp.fail(format('the database accepted a malformed reading: %s', bad));
    exception
      when check_violation then null;
    end;
  end loop;

  -- Not an object at all.
  begin
    perform public.store_query_reading('a badly shaped one', '"nope"'::jsonb, public.reading_model());
    perform pg_temp.fail('the database accepted a reading that is not an object');
  exception
    when check_violation then null;
  end;
end
$$;

-- ===========================================================================
-- 6. A reading from another model is refused going in, and invisible coming
--    out.
-- ===========================================================================
do $$
begin
  begin
    perform public.store_query_reading('a tool to split expenses', pg_temp.reading(), 'some-other-model');
    perform pg_temp.fail('a reading from another model was accepted');
  exception
    when invalid_parameter_value then null;
  end;
end
$$;

reset role;

-- Changing the model must retire every stale row at once, so that the day
-- somebody swaps the model in a migration the cache empties itself rather than
-- serving readings produced under a different prompt and different guards.
do $$
declare got jsonb;
begin
  create or replace function public.reading_model()
  returns text language sql immutable set search_path = '' as $fn$
    select 'a-different-model'::text;
  $fn$;

  got := public.query_reading('a tool to split expenses');
  if got is not null then
    perform pg_temp.fail('a reading recorded under the old model is still visible');
  end if;
end
$$;

-- ===========================================================================
-- 7. The reader's normalisation is the same one the rest of the system uses.
--
--    The cache key, the search-events hash and lib/embeddings.ts all have to
--    agree, or a sentence buckets three ways. 0004 pinned the first two against
--    each other; this pins the reading cache to the same function rather than
--    to a copy of it.
-- ===========================================================================
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'store_query_reading';
  if src not like '%normalize_query%' then
    perform pg_temp.fail('store_query_reading does not key on public.normalize_query');
  end if;

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'query_reading';
  if src not like '%normalize_query%' then
    perform pg_temp.fail('query_reading does not key on public.normalize_query');
  end if;
end
$$;

-- ===========================================================================
-- 8. All three doors are SECURITY DEFINER with a pinned search_path.
--
--    A definer function with a loose search_path is an authorization bypass
--    waiting for somebody to create a table called `query_readings` in a schema
--    earlier on the path.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('query_reading', 'store_query_reading', 'touch_query_reading')
     and (not p.prosecdef or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if bad is not null then
    perform pg_temp.fail(format('not SECURITY DEFINER with a pinned search_path: %s', bad));
  end if;
end
$$;

-- ===========================================================================
-- 9. A cached REFUSAL goes stale; a cached reading does not (0009).
--
--    `asks_for_software: false` is the only field in a reading that empties a
--    page without searching, and a reading is cached until it is evicted. One
--    bad sample, on one afternoon, would otherwise be a permanent answer: every
--    later visitor who typed that sentence would be told Foundit only lists
--    software because of a coin that came up tails once. The application's
--    two-sample vote and its refusal circuit both work on LIVE readings and
--    neither can see a row written last month.
-- ===========================================================================
set local role foundit_app;

do $$
declare
  v_refusal jsonb := pg_temp.reading() || '{"asks_for_software": false}'::jsonb;
begin
  perform public.store_query_reading('someone to fix the leak', v_refusal, public.reading_model());

  -- Fresh, so it is served: the application must not pay for the model again
  -- for a sentence somebody is retrying in the same sitting.
  if public.query_reading('someone to fix the leak') is null then
    perform pg_temp.fail('a refusal recorded a moment ago was not served');
  end if;

  -- An ordinary reading of the same age is served too, which is the control:
  -- what expires is the refusal, not the cache.
  perform public.store_query_reading('a tool to split a bill', pg_temp.reading(), public.reading_model());
  if public.query_reading('a tool to split a bill') is null then
    perform pg_temp.fail('an ordinary reading was not served');
  end if;
end
$$;

reset role;

-- Age both rows past the ttl. The owner does this directly because the point is
-- what query_reading DOES with an old row, and there is no function that makes
-- a row old — nor should there be.
update public.query_readings
   set created_at = now() - public.reading_refusal_ttl() - interval '1 minute'
 where query_norm in ('someone to fix the leak', 'a tool to split a bill');

set local role foundit_app;

do $$
begin
  if public.query_reading('someone to fix the leak') is not null then
    perform pg_temp.fail('a refusal older than the ttl was still served');
  end if;

  if public.query_reading('a tool to split a bill') is null then
    perform pg_temp.fail(
      'an ordinary reading expired; only refusals do, or the cache saves nothing');
  end if;
end
$$;

reset role;

select 'READER TEST PASSED — the reading cache refuses what 0008 and 0009 say it refuses'
       as result;

rollback;
