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
-- 2. Both writers ADD, and both refuse nonsense quietly or loudly as written
-- ===========================================================================
do $$
declare v_views bigint; v_usd numeric; v_req bigint;
begin
  perform infra.add_page_views(current_date, 7);
  perform infra.add_page_views(current_date, 5);
  select views into v_views from infra.page_views_daily where day = current_date;
  if v_views < 12 then
    perform pg_temp.fail(format('two flushes of 7 and 5 came to %s; the writer overwrites '
                                'instead of adding', v_views));
  end if;

  -- A quiet minute is a no-op, not an error: this runs every sixty seconds.
  perform infra.add_page_views(current_date, 0);
  perform infra.add_page_views(current_date, -3);
  perform infra.add_page_views(null, 9);
  if (select views from infra.page_views_daily where day = current_date) <> v_views then
    perform pg_temp.fail('a zero, a negative or a null flush changed the count');
  end if;

  perform infra.add_spend(current_date, 'reader', 2, 1000, 300, 0.00016);
  perform infra.add_spend(current_date, 'reader', 1, 500, 120, 0.00007);
  select usd, requests into v_usd, v_req
    from infra.spend_ledger where day = current_date and kind = 'reader';
  if v_req <> 3 then
    perform pg_temp.fail(format('two spend rows of 2 and 1 requests came to %s', v_req));
  end if;
  if v_usd <> 0.00023 then
    perform pg_temp.fail(format('$0.00016 and $0.00007 came to %s. numeric(14,8) exists so '
                                'that a fraction of a cent is not rounded to nothing.', v_usd));
  end if;

  -- A kind the ledger does not record is loud, because it is a programming
  -- error at a call site rather than a quiet minute.
  begin
    perform infra.add_spend(current_date, 'guessing', 1, 1, 1, 1);
    perform pg_temp.fail('add_spend accepted a kind that is not one of the four');
  exception when invalid_parameter_value then null;
  end;

  -- A negative bill does not reduce the total.
  perform infra.add_spend(current_date, 'embed', -5, -5, -5, -5);
  if (select usd from infra.spend_ledger where day = current_date and kind = 'embed') < 0 then
    perform pg_temp.fail('a negative amount reduced the recorded spend');
  end if;
end
$$;

-- ===========================================================================
-- 3. The panels read them, and say when nothing was recording
-- ===========================================================================
set role foundit_app;

do $$
declare r record; n int;
begin
  perform pg_temp.be('dev_admin');

  select count(*) into n from public.admin_page_views(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_page_views(30) returned %s days; the spine is '
                                'supposed to be every day in the window', n));
  end if;

  -- Today has a row, so today is recording; the day before the first row is
  -- not, and that is the difference between "no visits" and "no counter".
  select * into r from public.admin_page_views(30) x where x.day = current_date;
  if not r.recording or r.views < 12 then
    perform pg_temp.fail('today is not reported as recording, or lost its count');
  end if;

  select * into r from public.admin_page_views(30) x order by x.day limit 1;
  if r.recording and r.day < (select min(p.day) from public.admin_page_views(30) p
                               where p.recording) then
    perform pg_temp.fail('a day before the first recorded one claims to be recording');
  end if;

  select count(*) into n from public.admin_spend(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_spend(30) returned %s days', n));
  end if;

  select * into r from public.admin_spend(30) x where x.day = current_date;
  if r.reader <= 0 then
    perform pg_temp.fail('admin_spend lost the reader row written above');
  end if;

  select * into r from public.admin_spend_totals();
  if r.all_time <= 0 or r.first_day is null then
    perform pg_temp.fail('admin_spend_totals reports nothing after a row was written');
  end if;

  -- The two series panels the owner asked for, which need no new table.
  select count(*) into n from public.admin_active_accounts(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_active_accounts(30) returned %s days', n));
  end if;
  select count(*) into n from public.admin_new_tools(30);
  if n <> 30 then
    perform pg_temp.fail(format('admin_new_tools(30) returned %s days', n));
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
