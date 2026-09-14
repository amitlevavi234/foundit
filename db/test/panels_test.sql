-- ===========================================================================
-- The two ledgers behind the Visits and Money panels
--
-- 0024 puts `infra.page_views_daily` and `infra.spend_ledger` in `infra` and
-- gives neither of them row-level security, for the reason 0019 §1 gives about
-- `infra.ops_events`: every row belongs to the deployment rather than to a
-- person, so a policy would have to be `true`, and a policy that evaluates to
-- `true` is the anti-pattern `db/test/rls_test.sql` exists to catch. THE GRANT
-- IS THE BOUNDARY instead, and a boundary that is a grant is a boundary a test
-- has to read back — which is what this file does.
--
-- It also checks the two behaviours the panels depend on and a reading of the
-- migration cannot establish:
--
--   * both writers ADD. Two flushes racing must come to the sum of what each
--     counted; an overwrite would silently lose whichever arrived first, and
--     "the counter went backwards" is not a symptom anybody would recognise.
--   * `infra.page_views_daily` has NOTHING IN IT BUT A DAY AND A NUMBER.
--     That is the whole reason a visits panel can sit beside the search panels
--     without being the join docs/product-decisions.md §10 forbids: there is
--     nothing in the table to join on.
--
-- NOTHING HERE DEPENDS ON WHAT IS ALREADY IN THE LEDGERS, and it did until
-- 14 September 2026. §2 asserted that two flushes of 7 and 5 "come to 12" and
-- that two spend rows "come to 3 requests" on `current_date` — which is the
-- day the RUNNING APPLICATION writes to. Four proof searches made while
-- checking the spend path left rows on it, and the suite then failed with
--
--     PANELS TEST FAILED: two spend rows of 2 and 1 requests came to 5
--
-- reading somebody else's arithmetic as its own. That is the same defect CI
-- caught twice in Phase 7, and it had a second half nobody would have noticed
-- for longer: §3's assertions only passed BECAUSE §2 had just written rows, so
-- on a database where nothing had ever been recorded they would have failed
-- the other way round.
--
-- So the two halves are separated on purpose:
--
--   §2  the WRITERS, on a sentinel day nothing else can touch. 1999-01-01 is
--       outside every panel window by construction — `admin_page_views` and
--       `admin_spend` clamp `p_days` at 3650, which reaches back ten years —
--       so absolutes there are absolutes about rows this block wrote.
--   §3  the PANELS, on `current_date`, by DELTA: read, write a known amount,
--       read again, and assert the difference.
--   §4  the EMPTY case, by emptying both tables inside the transaction. That
--       is §10's "nothing draws a 0 where the truth is not recorded", and it
--       was the one rule on this page with no test under it.
--
-- One transaction, always rolled back.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'PANELS TEST FAILED: %', msg;
end;
$$;

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

-- ===========================================================================
-- 0. There is nothing in the visits table to identify anybody with
-- ===========================================================================
do $$
declare cols text;
begin
  select string_agg(a.attname, ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = 'infra.page_views_daily'::regclass
     and a.attnum > 0 and not a.attisdropped;

  if cols <> 'day, views, updated_at' then
    perform pg_temp.fail(format(
      'infra.page_views_daily is (%s). It is a day, a count and when the count '
      'last moved, and there is no fourth column to ask for: a path, an address, '
      'a session or a referrer here would turn a number of visits into a record '
      'of visitors.', cols));
  end if;

  -- And no foreign key out of it, to anything.
  if exists (select 1 from pg_constraint
              where conrelid = 'infra.page_views_daily'::regclass and contype = 'f') then
    perform pg_temp.fail('infra.page_views_daily has a foreign key; it is supposed to '
                         'reference nothing at all');
  end if;
end
$$;

-- ===========================================================================
-- 1. The grant is the boundary
-- ===========================================================================
do $$
begin
  -- The application may run the two writers.
  if not has_function_privilege('foundit_app', 'infra.add_page_views(date, int)', 'execute') then
    perform pg_temp.fail('foundit_app cannot record a page view');
  end if;
  if not has_function_privilege('foundit_app',
        'infra.add_spend(date, text, bigint, bigint, bigint, numeric)', 'execute') then
    perform pg_temp.fail('foundit_app cannot record spend');
  end if;
  -- And so may the embedding worker, which is one of the four kinds.
  if not has_function_privilege('foundit_embed',
        'infra.add_spend(date, text, bigint, bigint, bigint, numeric)', 'execute') then
    perform pg_temp.fail('foundit_embed cannot record its own spend');
  end if;

  -- USAGE ON THE SCHEMA IS REQUIRED AND IS NOT A DATA PRIVILEGE — 0028. This
  -- suite asserted the opposite until 14 September 2026 and agreed with the
  -- mistake in 0024: EXECUTE says "you may run this function", USAGE says "you
  -- may write its name", and without the second the first can never be
  -- exercised. Every page view came back `permission denied for schema infra`,
  -- was swallowed by the fire-and-forget writer exactly as designed, and was
  -- never counted.
  if not has_schema_privilege('foundit_app', 'infra', 'usage') then
    perform pg_temp.fail('foundit_app cannot name anything in schema infra, so the two '
                         'writers it is granted EXECUTE on cannot be called (0028)');
  end if;

  -- And USAGE is the whole of what it has. THIS is the boundary: a name it may
  -- write, and not one byte it may read.
  if has_table_privilege('foundit_app', 'infra.ops_events', 'select')
     or has_function_privilege('foundit_app', 'infra.record_ops_event(text, boolean, text)',
                               'execute') then
    perform pg_temp.fail('foundit_app can reach the operations events. 0019 §1 grants that '
                         'function to the schema owner alone, and a dashboard that could '
                         'write its own "last backup succeeded" row is one nobody should '
                         'believe.');
  end if;
  if has_table_privilege('foundit_app', 'infra.page_views_daily', 'select')
     or has_table_privilege('foundit_app', 'infra.spend_ledger', 'select') then
    perform pg_temp.fail('foundit_app can read a ledger directly');
  end if;
  if has_table_privilege('foundit_app', 'infra.page_views_daily', 'insert')
     or has_table_privilege('foundit_app', 'infra.spend_ledger', 'insert')
     or has_table_privilege('foundit_app', 'infra.page_views_daily', 'update')
     or has_table_privilege('foundit_app', 'infra.spend_ledger', 'update') then
    perform pg_temp.fail('foundit_app can write a ledger directly, so the writer function '
                         'is not the only door and its clamps are optional');
  end if;

  -- Nobody at all may execute them by being PUBLIC.
  if has_function_privilege('public', 'infra.add_page_views(date, int)', 'execute') then
    perform pg_temp.fail('infra.add_page_views is executable by PUBLIC');
  end if;
end
$$;

-- ===========================================================================
-- 1b. Every SECURITY DEFINER function in `infra` a non-owner may run is on a
--     written list, and its search_path names no schema that role can create in
--
-- OWNER FEEDBACK, ROUND 1 — F16. `infra.add_page_views` and `infra.add_spend`
-- are the only definer functions in this range with no caller check in their
-- bodies: every `public.admin_%` one opens with `if not auth.is_admin() then
-- raise`, and `file_report` reads `auth.uid()` itself. These two check nothing
-- and are granted to `foundit_app` and `foundit_embed`.
--
-- THAT IS A DECISION AND NOT AN OVERSIGHT, and it is written down here rather
-- than inferred. Both functions only ADD, negatives are clamped to nothing and
-- page views are clamped to a billion per call, so the worst an already
-- compromised application role can do through them is put wrong numbers on two
-- charts — ledger poisoning rather than escalation. The alternative, an
-- `auth.is_admin()` check, would make the page-view counter impossible: the
-- thing calling it is a render for a visitor who is nobody.
--
-- SO THE TEST IS THE LIST ITSELF, in the shape db/test/admin_test.sql §11 uses
-- for the owner's window: exactly these two, by name, with a pinned
-- `search_path`, and — the half that actually matters — no schema on that path
-- that either role can CREATE in. A definer function whose search_path names a
-- schema the calling role may create in is a definer function the calling role
-- can make execute its own code, and then "it only adds" stops being true.
-- A third such function appearing without a line in this file is a failure.
-- ===========================================================================
do $$
declare
  v_expected constant text[] := array[
    'add_page_views(p_day date, p_views integer)',
    'add_spend(p_day date, p_kind text, p_requests bigint, p_input_tokens bigint, '
      || 'p_output_tokens bigint, p_usd numeric)'
  ];
  v_found text[];
  bad     text;
begin
  -- Every prosecdef function in `infra` that any role other than the schema
  -- owner may execute. `foundit_owner` is excluded because it owns them: a
  -- definer function running as its own owner grants nothing.
  select coalesce(array_agg(format('%s(%s)', p.proname,
                                   pg_get_function_identity_arguments(p.oid))
                            order by p.proname), '{}'::text[])
    into v_found
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'infra'
     and p.prosecdef
     and (has_function_privilege('foundit_app', p.oid, 'execute')
          or has_function_privilege('foundit_embed', p.oid, 'execute'));

  if v_found <> v_expected then
    perform pg_temp.fail(format(
      'the SECURITY DEFINER functions in infra a non-owner may run are {%s}; the written '
      'list is {%s}. Every one of them is an unchecked door into the owner''s privileges, '
      'so adding or removing one is a decision that gets a line in db/test/panels_test.sql '
      'and a paragraph in the migration.',
      array_to_string(v_found, ', '), array_to_string(v_expected, ', ')));
  end if;

  -- A pinned search_path on each. Without it the caller chooses which `infra`
  -- and which `pg_catalog` the body means.
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'infra'
     and p.prosecdef
     and (has_function_privilege('foundit_app', p.oid, 'execute')
          or has_function_privilege('foundit_embed', p.oid, 'execute'))
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'));
  if bad is not null then
    perform pg_temp.fail('a definer function in infra has no pinned search_path: ' || bad);
  end if;

  -- AND NOT ONE SCHEMA ON THAT PATH IS ONE THOSE ROLES MAY CREATE IN. This is
  -- the assertion the pin is for: `search_path=pg_catalog, infra` is only worth
  -- anything while neither role can create a function called `now` in either of
  -- them.
  select string_agg(format('%s -> %s (%s)', p.proname, s.schema_name, s.who), '; ')
    into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (
      select btrim(part) as schema_name,
             case when has_schema_privilege('foundit_app', btrim(part), 'create')
                       and has_schema_privilege('foundit_embed', btrim(part), 'create')
                    then 'both roles'
                  when has_schema_privilege('foundit_app', btrim(part), 'create')
                    then 'foundit_app'
                  else 'foundit_embed' end as who
        from unnest(p.proconfig) c,
             lateral unnest(string_to_array(replace(c, 'search_path=', ''), ',')) part
       where c like 'search\_path=%'
         and btrim(part) <> ''
         and exists (select 1 from pg_namespace nn where nn.nspname = btrim(part))
         and (has_schema_privilege('foundit_app', btrim(part), 'create')
              or has_schema_privilege('foundit_embed', btrim(part), 'create'))
    ) s
   where n.nspname = 'infra'
     and p.prosecdef
     and (has_function_privilege('foundit_app', p.oid, 'execute')
          or has_function_privilege('foundit_embed', p.oid, 'execute'));
  if bad is not null then
    perform pg_temp.fail('a definer function in infra resolves names in a schema the calling '
                         'role can create in, which makes the pin worthless: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 2. Both writers ADD, on a day nothing else writes to
-- ===========================================================================
do $$
declare
  -- THE SENTINEL. See this file's header for why it is not `current_date`.
  c_day   constant date := date '1999-01-01';
  v_views bigint;
  v_usd   numeric;
  v_req   bigint;
  v_in    bigint;
  v_out   bigint;
begin
  -- The isolation, proved rather than assumed. If this ever fires, something
  -- has started writing 1999-01-01 and the rest of this section is worthless.
  if exists (select 1 from infra.page_views_daily where day = c_day)
     or exists (select 1 from infra.spend_ledger where day = c_day) then
    perform pg_temp.fail('the sentinel day already has rows on it, so every absolute below '
                         'would be measuring somebody else''s arithmetic');
  end if;

  perform infra.add_page_views(c_day, 7);
  perform infra.add_page_views(c_day, 5);
  select views into v_views from infra.page_views_daily where day = c_day;
  if v_views <> 12 then
    perform pg_temp.fail(format('two flushes of 7 and 5 came to %s; the writer overwrites '
                                'instead of adding', v_views));
  end if;

  -- A quiet minute is a no-op, not an error: this runs every sixty seconds.
  perform infra.add_page_views(c_day, 0);
  perform infra.add_page_views(c_day, -3);
  perform infra.add_page_views(null, 9);
  select views into v_views from infra.page_views_daily where day = c_day;
  if v_views <> 12 then
    perform pg_temp.fail(format('a zero, a negative or a null flush moved the count to %s',
                                v_views));
  end if;

  perform infra.add_spend(c_day, 'reader', 2, 1000, 300, 0.00016);
  perform infra.add_spend(c_day, 'reader', 1, 500, 120, 0.00007);
  select requests, input_tokens, output_tokens, usd into v_req, v_in, v_out, v_usd
    from infra.spend_ledger where day = c_day and kind = 'reader';
  if v_req <> 3 or v_in <> 1500 or v_out <> 420 then
    perform pg_temp.fail(format('two spend rows came to %s requests, %s in, %s out; expected '
                                '3, 1500 and 420', v_req, v_in, v_out));
  end if;
  if v_usd <> 0.00023 then
    perform pg_temp.fail(format('$0.00016 and $0.00007 came to %s. numeric(14,8) exists so '
                                'that a fraction of a cent is not rounded to nothing.', v_usd));
  end if;

  -- Four kinds and one day are four rows, not one: the Money panel draws them
  -- as a stack and a kind that folded into another would be a stack with a
  -- layer missing.
  perform infra.add_spend(c_day, 'rerank', 1, 10, 1, 0.00000100);
  if (select count(*) from infra.spend_ledger where day = c_day) <> 2 then
    perform pg_temp.fail('two kinds on one day did not make two rows');
  end if;

  -- A kind the ledger does not record is loud, because it is a programming
  -- error at a call site rather than a quiet minute.
  begin
    perform infra.add_spend(c_day, 'guessing', 1, 1, 1, 1);
    perform pg_temp.fail('add_spend accepted a kind that is not one of the four');
  exception when invalid_parameter_value then null;
  end;

  -- A negative bill does not reduce the total, and clamps to zero rather than
  -- to whatever it was given.
  perform infra.add_spend(c_day, 'embed', -5, -5, -5, -5);
  select requests, input_tokens, output_tokens, usd into v_req, v_in, v_out, v_usd
    from infra.spend_ledger where day = c_day and kind = 'embed';
  if v_req <> 0 or v_in <> 0 or v_out <> 0 or v_usd <> 0 then
    perform pg_temp.fail(format('a negative call was recorded as %s/%s/%s/%s rather than as '
                                'nothing', v_req, v_in, v_out, v_usd));
  end if;
end
$$;

-- ===========================================================================
-- 3. The panels read them — by DELTA, because today is a shared day
--
-- The panel windows clamp at 3650 days, so §2's sentinel is unreachable from
-- here and `current_date` is the only day these functions can be tested on. It
-- is also the day the running application writes to. So nothing below asserts
-- a total: each one reads, writes a known amount through the same door the
-- application uses, reads again, and asserts the difference.
-- ===========================================================================
set role foundit_app;

do $$
declare
  r  record;
  n  int;
  v_views_before bigint;
  v_views_after  bigint;
  v_reader_before numeric;
  v_reader_after  numeric;
  v_all_before numeric;
  v_all_after  numeric;
  v_req_before bigint;
  v_req_after  bigint;
  v_first date;
begin
  perform pg_temp.be('dev_admin');

  -- The spine is every day in the window whether or not anything happened on
  -- it, which is an absolute that does not depend on any row existing.
  select count(*) into n from public.admin_page_views(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_page_views(30) returned %s days; the spine is '
                                'supposed to be every day in the window', n));
  end if;
  select count(*) into n from public.admin_spend(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_spend(30) returned %s days', n));
  end if;
  select count(*) into n from public.admin_active_accounts(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_active_accounts(30) returned %s days', n));
  end if;
  select count(*) into n from public.admin_new_tools(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_new_tools(30) returned %s days', n));
  end if;

  -- --- page views, by delta ------------------------------------------------
  select x.views into v_views_before
    from public.admin_page_views(30) x where x.day = current_date;

  perform infra.add_page_views(current_date, 9);

  select * into r from public.admin_page_views(30) x where x.day = current_date;
  v_views_after := r.views;
  if v_views_after - v_views_before <> 9 then
    perform pg_temp.fail(format('nine page views moved the panel by %s',
                                v_views_after - v_views_before));
  end if;
  if not r.recording then
    perform pg_temp.fail('a day with a row on it is not reported as recording');
  end if;

  -- `recording` is monotone: it is false for every day before the first row
  -- ever written and true from there on. A false day after a true one would
  -- mean the flag was about THIS day''s rows rather than about whether
  -- anything was counting, which is the distinction the panel draws.
  select min(x.day) into v_first from public.admin_page_views(30) x where x.recording;
  if v_first is null then
    perform pg_temp.fail('nothing is recording even though nine views were just written');
  end if;
  if exists (select 1 from public.admin_page_views(30) x
              where x.day >= v_first and not x.recording) then
    perform pg_temp.fail('a day after the first recorded one says nothing was counting');
  end if;
  if exists (select 1 from public.admin_page_views(30) x
              where x.day < v_first and x.recording) then
    perform pg_temp.fail('a day before the first recorded one says something was counting');
  end if;

  -- --- spend, by delta -----------------------------------------------------
  select x.reader into v_reader_before
    from public.admin_spend(30) x where x.day = current_date;
  select t.all_time, t.requests into v_all_before, v_req_before
    from public.admin_spend_totals() t;

  perform infra.add_spend(current_date, 'reader', 1, 100, 10, 0.00000500);

  select x.reader into v_reader_after
    from public.admin_spend(30) x where x.day = current_date;
  if v_reader_after - v_reader_before <> 0.00000500 then
    perform pg_temp.fail(format('a reader call of $0.000005 moved the panel by %s',
                                v_reader_after - v_reader_before));
  end if;

  select t.all_time, t.requests, t.first_day into v_all_after, v_req_after, v_first
    from public.admin_spend_totals() t;
  if v_all_after - v_all_before <> 0.00000500 then
    perform pg_temp.fail(format('the same call moved the all-time total by %s',
                                v_all_after - v_all_before));
  end if;
  if v_req_after - v_req_before <> 1 then
    perform pg_temp.fail(format('one paid request moved the request count by %s',
                                v_req_after - v_req_before));
  end if;
  if v_first is null then
    perform pg_temp.fail('first_day is null even though a row was just written');
  end if;

  -- OWNER FEEDBACK, ROUND 1 — F8. `admin_spend` now carries the same
  -- `recording` flag `admin_page_views` has, so the Money chart can hatch a day
  -- nothing was being recorded on instead of drawing $0.00 for it. Same three
  -- assertions as the Visits flag above, because it is the same claim: the day
  -- with a row on it is recording, and the flag is monotone from the first row
  -- ever written rather than being about this day's own rows.
  if not exists (select 1 from public.admin_spend(30) x
                  where x.day = current_date and x.recording) then
    perform pg_temp.fail('a day with a ledger row on it is not reported as recording');
  end if;

  select min(x.day) into v_first from public.admin_spend(30) x where x.recording;
  if v_first is null then
    perform pg_temp.fail('no spend day is recording even though a row was just written');
  end if;
  if exists (select 1 from public.admin_spend(30) x
              where x.day >= v_first and not x.recording) then
    perform pg_temp.fail('a spend day after the first recorded one says nothing was recorded');
  end if;
  if exists (select 1 from public.admin_spend(30) x
              where x.day < v_first and x.recording) then
    perform pg_temp.fail('a spend day before the ledger started says something was recorded');
  end if;

  -- And it agrees with `admin_spend_totals().first_day`, which is the figure
  -- already printed above the chart — the two are the same `min(day)` read
  -- twice in one transaction and a chart that disagreed with the sentence over
  -- it would be the F8 defect the other way round.
  select t.first_day into v_first from public.admin_spend_totals() t;
  if exists (select 1 from public.admin_spend(30) x
              where x.day >= v_first and not x.recording)
     or exists (select 1 from public.admin_spend(30) x
                 where x.day < v_first and x.recording) then
    perform pg_temp.fail('the Money chart''s hatching disagrees with the first_day printed '
                         'above it');
  end if;
end
$$;

-- ===========================================================================
-- 3b. And with nothing recorded at all, both panels say so
--
-- docs/product-decisions.md §10: nothing draws a 0 where the truth is "nobody
-- measured this". That rule had no test under it, because every assertion
-- above needed rows to exist — so the case the rule is ABOUT was the one case
-- never exercised. Emptying both tables inside a transaction that always rolls
-- back is the only honest way to reach it.
-- ===========================================================================
reset role;

delete from infra.page_views_daily;
delete from infra.spend_ledger;

set role foundit_app;

do $$
declare r record; n int;
begin
  perform pg_temp.be('dev_admin');

  select count(*) into n from public.admin_page_views(30) x where x.recording;
  if n <> 0 then
    perform pg_temp.fail(format('%s days claim to be recording with an empty table', n));
  end if;
  select count(*) into n from public.admin_page_views(30) x where x.views <> 0;
  if n <> 0 then
    perform pg_temp.fail('a day has views on it with an empty table');
  end if;

  select count(*) into n from public.admin_spend(30) x
   where x.reader <> 0 or x.rerank <> 0 or x.embed <> 0 or x.worker <> 0;
  if n <> 0 then
    perform pg_temp.fail('a day has spend on it with an empty ledger');
  end if;

  -- F8, the case the flag exists for: with nothing recorded, NO day claims to
  -- have been recording, so the Money chart hatches all thirty rather than
  -- drawing thirty columns of $0.00.
  select count(*) into n from public.admin_spend(30) x where x.recording;
  if n <> 0 then
    perform pg_temp.fail(format('%s spend days claim to have been recorded with an empty '
                                'ledger', n));
  end if;

  select * into r from public.admin_spend_totals();
  if r.first_day is not null then
    perform pg_temp.fail('first_day is set with an empty ledger, so the Money panel would '
                         'draw $0.00 where the truth is that nothing was recorded');
  end if;
  if r.all_time <> 0 or r.month_to_date <> 0 or r.requests <> 0 then
    perform pg_temp.fail('an empty ledger did not total to nothing');
  end if;
end
$$;

-- THE ARITHMETIC THE MAU FIGURE RESTS ON: because each account has exactly one
-- last_seen_day, the thirty daily counts SUM to "accounts seen in the window".
-- The panel prints both numbers and this is what stops them disagreeing.
do $$
declare v_sum bigint; v_window bigint;
begin
  perform pg_temp.be('dev_admin');
  select coalesce(sum(a.seen), 0) into v_sum from public.admin_active_accounts(30) a;
  reset role;
  select count(*) into v_window from public.profiles p
   where p.last_seen_day >= current_date - 29;
  set role foundit_app;

  if v_sum <> v_window then
    perform pg_temp.fail(format('the daily series sums to %s and the window holds %s; the '
                                'monthly figure and the chart beside it disagree',
                                v_sum, v_window));
  end if;
end
$$;

reset role;

select 'All panel checks passed.' as result;

rollback;
