-- ===========================================================================
-- A report is recorded, and the only ways to reach one are the three doors
--
-- 0023 gives `public.reports` no policy at all for `foundit_app` — not a
-- select, not an insert, not an update — and three SECURITY DEFINER functions
-- instead. That arrangement is only worth anything if it is true, and "true"
-- here means four separate things that a reading of the migration cannot
-- establish:
--
--   1. the application really cannot touch the table directly, in any of the
--      four ways it could try;
--   2. `file_report` really reads `auth.uid()` rather than believing a caller
--      — including when the caller is signed out, where the answer is a null
--      reporter and NOT a refusal;
--   3. `resolve_report` really refuses everybody who is not an administrator,
--      and really refuses to resolve the same report twice;
--   4. a report holds nothing that could be joined to a search.
--
-- NOTHING HERE DEPENDS ON WHAT IS ALREADY IN `public.reports`. It nearly did:
-- §4 asked whether `admin_reports()` returned "at least four" rows and whether
-- the open count was "at least three", which are the suite's own rows only on
-- a database where nobody has ever filed one — and `admin_reports()` defaults
-- to fifty, so past fifty reports this suite's own would fall off the page it
-- was reading. It also resolved whichever open report came back first, which
-- on a used database is somebody else's.
--
-- Every id this suite creates is remembered in `pg_temp.filed` and every count
-- below is a DELTA against what was there when it started. It is the same rule
-- db/test/panels_test.sql was rewritten under on 14 September 2026, for the
-- same reason: a test that reads a shared table has to measure its own
-- arithmetic and nobody else's.
--
-- Everything runs inside ONE transaction that is ALWAYS rolled back, exactly
-- like rls_test.sql and counters_test.sql and for the same reasons. The suite
-- connects as the schema owner and `set role foundit_app` where it wants the
-- application's view; only the owner can switch into that role and back, which
-- is what lets one file check what each of them is refused.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

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
  raise exception 'REPORTS TEST FAILED: %', msg;
end;
$$;

/**
 * What this suite filed, and what the table held before it started.
 *
 * A temp table rather than a variable because each `do $$` block below has its
 * own scope, and the ids have to survive from the block that files a report to
 * the block that reads it back.
 */
create temp table pg_temp_filed (label text primary key, id bigint) on commit drop;

-- The suite switches into foundit_app to check what the application is
-- refused, and a temp table belongs to the role that created it — so without
-- this the bookkeeping, rather than the thing being tested, is what gets
-- "permission denied". It is a scratch table inside a transaction that always
-- rolls back; nothing about the schema is being loosened.
grant select, insert, update on pg_temp_filed to public;

create or replace function pg_temp.remember(p_label text, p_id bigint)
returns bigint language sql as $$
  insert into pg_temp_filed (label, id) values (p_label, p_id)
  on conflict (label) do update set id = excluded.id
  returning id;
$$;

create or replace function pg_temp.filed(p_label text)
returns bigint language sql stable as $$
  select id from pg_temp_filed where label = p_label;
$$;

/** How many reports this suite has filed, by id, whatever else is in there. */
create or replace function pg_temp.mine()
returns bigint[] language sql stable as $$
  select coalesce(array_agg(id), '{}'::bigint[]) from pg_temp_filed where label <> 'open_before';
$$;

/** 0020 §2's window. The suite plants and counts rows no function would. */
create or replace function pg_temp.owner_window(p_open boolean)
returns void language plpgsql as $$
begin
  perform set_config('foundit.definer',
                     case when p_open then 'on' else 'off' end, true);
end;
$$;

-- ===========================================================================
-- 0. The table is what the migration says it is
-- ===========================================================================
do $$
declare
  n int;
begin
  -- RLS enabled AND forced. Forced is the half that matters here: the owner is
  -- NOSUPERUSER NOBYPASSRLS and must be subject to its own policies too.
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'reports'
     and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 1 then
    perform pg_temp.fail('public.reports does not have row level security enabled AND forced');
  end if;

  -- EXACTLY TWO POLICIES, and neither of them is a door for the application.
  -- One is the owner's window (0023) and one is "an administrator may read"
  -- (0026), which is what lets the two read-only panels see a row as the owner
  -- without opening a window over every table in public. A THIRD policy here
  -- would be a fourth door.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'reports';
  if n <> 2 then
    perform pg_temp.fail(format('public.reports has %s policies; 0023 and 0026 give it '
                                'exactly two, and neither is for foundit_app', n));
  end if;

  -- And the read policy asks a real question rather than being `true`, which
  -- is the anti-pattern db/test/rls_test.sql exists to catch.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'reports'
     and policyname = 'reports_admin_read'
     and qual like '%is_admin%';
  if n <> 1 then
    perform pg_temp.fail('reports_admin_read is not gated on auth.is_admin()');
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'reports'
     and policyname = 'reports_definer'
     and qual like '%foundit.definer%';
  if n <> 1 then
    perform pg_temp.fail('reports_definer is not the setting-gated owner window');
  end if;

  -- And the application has no privilege on the table itself. Four modes,
  -- because "cannot insert" is not "cannot read".
  if has_table_privilege('foundit_app', 'public.reports', 'select')
     or has_table_privilege('foundit_app', 'public.reports', 'insert')
     or has_table_privilege('foundit_app', 'public.reports', 'update')
     or has_table_privilege('foundit_app', 'public.reports', 'delete') then
    perform pg_temp.fail('foundit_app has a table privilege on public.reports; the three '
                         'definer functions are supposed to be the only doors');
  end if;
end
$$;

-- THE ONE JOIN §10 FORBIDS, checked against the table rather than against a
-- function. `reports` must have no column that names a search, and no foreign
-- key into one — the function-level check in admin_test.sql §2 is about who
-- READS; this is about what is even there to read.
do $$
declare bad text;
begin
  select string_agg(a.attname, ', ') into bad
    from pg_attribute a
   where a.attrelid = 'public.reports'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname ~ '\m(query|search|ip|address|session|agent|referer|referrer)\M';
  if bad is not null then
    perform pg_temp.fail('public.reports has a column that could name a search or a '
                         'visitor: ' || bad);
  end if;

  select string_agg(cn.conname, ', ') into bad
    from pg_constraint cn
   where cn.conrelid = 'public.reports'::regclass
     and cn.contype = 'f'
     and cn.confrelid::regclass::text ~ '\m(search_events|search_event_tools|query_embeddings|query_readings|query_reranks)\M';
  if bad is not null then
    perform pg_temp.fail('public.reports has a foreign key into a search table: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 0b. What was already there
--
-- Read once, before this suite writes anything, so every count below can be a
-- difference rather than a total.
-- ===========================================================================
do $$
declare v_open bigint;
begin
  perform pg_temp.be('dev_admin');
  select c.open into v_open from public.admin_report_counts() c;
  perform pg_temp.remember('open_before', v_open);
  perform pg_temp.be(null);
end
$$;

-- ===========================================================================
-- 1. The application cannot reach the table, and CAN reach it through the door
-- ===========================================================================
set role foundit_app;

do $$
declare v_id bigint; n int;
begin
  perform pg_temp.be('dev_person');

  -- Direct, all four ways. Each must raise 42501 — a privilege error, not a
  -- policy filter. A filter would be a silent zero, which is the failure mode
  -- 0020's own header is about.
  begin
    perform 1 from public.reports limit 1;
    perform pg_temp.fail('foundit_app could SELECT from public.reports');
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.reports (kind, target, reason) values ('tool', 'anki', 'a reason here');
    perform pg_temp.fail('foundit_app could INSERT into public.reports');
  exception when insufficient_privilege then null;
  end;

  begin
    update public.reports set resolution = 'mine now';
    perform pg_temp.fail('foundit_app could UPDATE public.reports');
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.reports;
    perform pg_temp.fail('foundit_app could DELETE from public.reports');
  exception when insufficient_privilege then null;
  end;

  -- And through the door, as an ordinary signed-in person.
  v_id := public.file_report('tool', 'anki', 'The link goes to a parked domain now.');
  if v_id is null then
    perform pg_temp.fail('file_report returned no id for a signed-in reporter');
  end if;
  perform pg_temp.remember('tool', v_id);
end
$$;

-- ===========================================================================
-- 2. The reporter is auth.uid(), and a signed-out report is a report
-- ===========================================================================
do $$
declare v_signed bigint; v_out bigint;
begin
  perform pg_temp.be('dev_person');
  v_signed := public.file_report('profile', 'dev_maker', 'This profile is impersonating somebody.');

  perform pg_temp.be(null);
  v_out := public.file_report('tool', 'gimp', 'The summary describes a different program.');
  perform pg_temp.remember('signed_in', v_signed);
  perform pg_temp.remember('signed_out', v_out);
  if v_out is null then
    perform pg_temp.fail('a signed-out visitor could not file a report. Reporting behind a '
                         'sign-in wall is a wall in front of the reports most worth having.');
  end if;

  -- Read them back as the OWNER, because the application is not allowed to.
  reset role;
  perform pg_temp.owner_window(true);

  if (select reporter_id from public.reports where id = v_signed) is distinct from 'dev_person' then
    perform pg_temp.fail('file_report did not stamp the signed-in reporter from auth.uid()');
  end if;
  if (select reporter_id from public.reports where id = v_out) is not null then
    perform pg_temp.fail('a signed-out report got a reporter from somewhere');
  end if;

  perform pg_temp.owner_window(false);
  set role foundit_app;
end
$$;

-- ===========================================================================
-- 3. What the door refuses, and what it cleans
-- ===========================================================================
do $$
declare v_id bigint; v_reason text;
begin
  perform pg_temp.be('dev_person');

  -- A kind that is not one of the three.
  begin
    perform public.file_report('comment', '1', 'This is not a kind of thing.');
    perform pg_temp.fail('file_report accepted a kind that is not review, tool or profile');
  exception when invalid_parameter_value then null;
  end;

  -- Too short, measured AFTER stripping, which is the point: seven characters
  -- and a backspace is seven characters.
  begin
    perform public.file_report('tool', 'anki', 'bad');
    perform pg_temp.fail('file_report accepted a three-character reason');
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.file_report('tool', 'anki', 'short' || repeat(chr(8), 10));
    perform pg_temp.fail('file_report measured control characters as a reason');
  exception when invalid_parameter_value then null;
  end;

  -- A review's target must be a number, because a review is identified by one.
  begin
    perform public.file_report('review', 'not-a-number', 'This review is abusive.');
    perform pg_temp.fail('file_report accepted a review target that is not an id');
  exception when check_violation then null;
  end;

  -- Control characters are stripped rather than refused when what is left is
  -- long enough, the same way every other free-text door in this schema works.
  v_id := public.file_report('tool', 'anki',
                             'This one has a bell ' || chr(7) ||
                             ' in it and is long enough.');
  perform pg_temp.remember('cleaned', v_id);

  reset role;
  perform pg_temp.owner_window(true);
  select reason into v_reason from public.reports where id = v_id;
  if public.has_control_characters(v_reason) then
    perform pg_temp.fail('a control character survived file_report: ' || quote_literal(v_reason));
  end if;
  perform pg_temp.owner_window(false);
  set role foundit_app;
end
$$;

-- ===========================================================================
-- 4. Reading is an administrator's, and so is resolving
-- ===========================================================================
do $$
declare n int; v_id bigint; v_done boolean;
begin
  -- §1 of admin_test.sql already probes every admin_* function as three
  -- non-administrators; this is the pair that file belongs to, checked here
  -- where the rows exist.
  for n in 1..1 loop
    perform pg_temp.be('dev_person');
    begin
      perform * from public.admin_reports();
      perform pg_temp.fail('an ordinary account could read the reports');
    exception when insufficient_privilege then null;
    end;

    begin
      perform public.resolve_report(1, 'dealt with');
      perform pg_temp.fail('an ordinary account could resolve a report');
    exception when insufficient_privilege then null;
    end;

    perform pg_temp.be(null);
    begin
      perform public.resolve_report(1, null);
      perform pg_temp.fail('a signed-out visitor could resolve a report');
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- The administrator can. THIS SUITE'S OWN ROWS, by id, out of a call with
  -- the limit wide open: `admin_reports()` defaults to fifty and orders
  -- unresolved-first, so on a database with a real backlog the four filed
  -- above are not necessarily on the default page.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.admin_reports(10000) r
   where r.report_id = any (pg_temp.mine());
  if n <> array_length(pg_temp.mine(), 1) then
    perform pg_temp.fail(format('admin_reports returned %s of the %s reports this suite '
                                'filed', n, array_length(pg_temp.mine(), 1)));
  end if;

  -- Resolving is once, and it is THIS suite's report that gets resolved
  -- rather than whichever open one happened to come back first.
  v_id := pg_temp.filed('tool');
  v_done := public.resolve_report(v_id, 'Checked the link; the maker has moved house.');
  if not v_done then
    perform pg_temp.fail('an administrator could not resolve an open report');
  end if;

  v_done := public.resolve_report(v_id, 'and again');
  if v_done then
    perform pg_temp.fail('resolving the same report twice succeeded twice, which overwrites '
                         'who closed it and when');
  end if;

  -- And a report nobody filed is false rather than an error, which is what
  -- stops the outcome being an oracle over which ids exist.
  if public.resolve_report(-1, null) then
    perform pg_temp.fail('resolving a report that does not exist succeeded');
  end if;

  -- The counts the Words panel draws, as a DELTA. Four filed, one resolved, so
  -- the open count must be exactly three higher than it was before this suite
  -- ran, whatever it was.
  select r.open into n from public.admin_report_counts() r;
  if n - pg_temp.filed('open_before') <> 3 then
    perform pg_temp.fail(format('the open count moved by %s; this suite filed %s reports '
                                'and resolved one',
                                n - pg_temp.filed('open_before'),
                                array_length(pg_temp.mine(), 1)));
  end if;

  -- `received` is windowed and `open` is not, which is the whole reason they
  -- are two columns. Everything this suite filed is inside any window, so
  -- received must have moved by all four.
  select r.received into n from public.admin_report_counts(3650) r;
  if n < array_length(pg_temp.mine(), 1) then
    perform pg_temp.fail(format('received is %s and this suite filed %s inside the window',
                                n, array_length(pg_temp.mine(), 1)));
  end if;
end
$$;

-- ===========================================================================
-- 5. A report about a review arrives WITH the review
--
-- This is the whole reason `admin_reports` is a wide row rather than a join in
-- the application: `admin_reviews` pages over every review ever written, so a
-- reported review three thousand rows down is not on the page the Reported tab
-- would be showing.
-- ===========================================================================
do $$
declare
  v_review bigint;
  v_report bigint;
  r        record;
begin
  reset role;
  perform pg_temp.owner_window(true);
  select id into v_review from public.reviews where deleted_at is null order by id limit 1;
  perform pg_temp.owner_window(false);
  set role foundit_app;

  if v_review is null then
    perform pg_temp.fail('the seed has no live review to report, so §5 tested nothing');
  end if;

  perform pg_temp.be('dev_person');
  v_report := public.file_report('review', v_review::text, 'This review is about a different tool.');
  perform pg_temp.remember('review', v_report);

  perform pg_temp.be('dev_admin');
  select * into r from public.admin_reports(10000) x where x.report_id = v_report;

  if r.review_id is distinct from v_review then
    perform pg_temp.fail('a report about a review did not carry the review');
  end if;
  if r.tool_slug is null or r.tool_name is null or r.handle is null then
    perform pg_temp.fail('the review arrived without its listing or its author');
  end if;
  if r.rating is null then
    perform pg_temp.fail('the review arrived without its rating');
  end if;

  -- And a report about something that is not a review carries no review. This
  -- suite's OWN tool report, by id: `where kind = 'tool' limit 1` would have
  -- read whichever one the database happened to hand back first.
  select * into r from public.admin_reports(10000) x where x.report_id = pg_temp.filed('tool');
  if r.report_id is null then
    perform pg_temp.fail('this suite''s own tool report is not in admin_reports');
  end if;
  if r.review_id is not null or r.tool_slug is not null or r.rating is not null then
    perform pg_temp.fail('a report about a tool came back with a review attached to it');
  end if;
end
$$;

-- ===========================================================================
-- 6. Owner feedback, round 1 — F1, F17, F20 and F21
--
-- F1 IS TWO ASSERTIONS AND NOT ONE, because the defect had two halves. A
-- report about a review whose target was all digits but WIDER THAN A BIGINT
-- satisfied `reports_target_shaped` (200 characters, `^[0-9]+$`) and satisfied
-- 0027's CASE guard (the same pattern), and then `target::bigint` raised
-- 22003 — the failure class 0027 was written to close. `lib/admin.ts` swallows
-- it, so the operator saw the Reported tab render as though they were not an
-- administrator, and there is no delete path for `public.reports` anywhere in
-- the product. So:
--
--   (a) a NEW overflow target is refused at the CHECK, and
--   (b) a row that is ALREADY STORED — planted here with the CHECK dropped
--       inside this transaction, which is the only way to reproduce a database
--       that predates 0030 — no longer takes the panel down.
--
-- Without (b) the fix would be untested against exactly the state that was
-- reported.
-- ===========================================================================
do $$
declare
  v_id     bigint;
  v_target text;
  n        int;
begin
  set role foundit_app;
  perform pg_temp.be('dev_person');

  -- (a) The magnitude, where only the shape was bounded before.
  begin
    perform public.file_report('review', repeat('9', 23),
                               'A review target that is all digits and wider than a bigint.');
    perform pg_temp.fail('file_report accepted a review target too wide for a bigint');
  exception when check_violation then null;
  end;

  -- Eighteen digits is the widest that always fits, and is accepted: the bound
  -- must not be "any number nobody has reached yet".
  v_id := public.file_report('review', repeat('9', 18),
                             'A review target of eighteen digits, which fits in a bigint.');
  perform pg_temp.remember('wide_ok', v_id);

  -- F17. Control characters are STRIPPED on the way in, like every other free
  -- text door in this schema, rather than producing a row that fails a CHECK
  -- with an error the reporter is then told was "a fault our end".
  v_id := public.file_report('tool', 'an' || chr(10) || 'ki' || chr(27) || '[31m',
                             'A target with a newline and an escape in it.');
  perform pg_temp.remember('ctl_target', v_id);

  perform pg_temp.be('dev_admin');
  select r.target into v_target from public.admin_reports(10000, 0) r where r.report_id = v_id;
  if public.has_control_characters(v_target) then
    perform pg_temp.fail('a control character survived file_report''s target: '
                         || quote_literal(v_target));
  end if;
  -- 0017's `strip_control_characters` replaces rather than deletes — a word
  -- break is what a newline was — so the expected value is spelled out here
  -- rather than assumed, and a change to that function fails this line.
  if v_target <> 'an ki [31m' then
    perform pg_temp.fail(format('the stripped target is %L; stripping replaces the character '
                                'with a space and keeps everything else', v_target));
  end if;

  -- And the CHECK refuses one that arrives by any other door, which is what
  -- makes the strip defence in depth rather than the only defence.
  reset role;
  perform pg_temp.owner_window(true);
  begin
    insert into public.reports (kind, target, reason)
    values ('tool', 'an' || chr(7) || 'ki', 'A target with a bell, straight into the table.');
    perform pg_temp.fail('the table accepted a target with a control character in it');
  exception when check_violation then null;
  end;

  -- (b) A ROW STORED BEFORE 0030. The CHECK comes off for the length of this
  -- block and goes back on NOT VALID, which is exactly the state a database
  -- that already holds such a row would be in.
  alter table public.reports drop constraint reports_target_shaped;
  insert into public.reports (kind, target, reason)
  values ('review', repeat('9', 23), 'An overflow target stored before 0030 existed.')
  returning id into v_id;
  alter table public.reports add constraint reports_target_shaped
    check (length(target) between 1 and 200
           and not public.has_control_characters(target)
           and (kind <> 'review' or target ~ '^[0-9]{1,18}$'))
    not valid;
  perform pg_temp.owner_window(false);
  set role foundit_app;

  perform pg_temp.be('dev_admin');
  -- The assertion is that neither of these raises. Before 0030 both did, with
  -- 22003, and the tab rendered as the not-found page for ever after.
  select count(*) into n from public.admin_reports(10000, 0) r where r.report_id = v_id;
  if n <> 1 then
    perform pg_temp.fail('a stored overflow target is not readable through admin_reports');
  end if;
  perform count(*) from public.admin_report_counts(30);
end
$$;

-- ===========================================================================
-- 6b. F20 and F21 — does the thing still exist, and what is it called now
-- ===========================================================================
do $$
declare
  v_tool_ok   bigint;
  v_tool_bad  bigint;
  v_prof_ok   bigint;
  v_prof_bad  bigint;
  v_review    bigint;
  v_report    bigint;
  r           record;
begin
  set role foundit_app;
  perform pg_temp.be('dev_person');

  -- The write stays permissive on purpose: filing must leak no existence, and
  -- a report has to outlive its target. All four get an id.
  v_tool_ok  := public.file_report('tool', 'anki', 'A listing that exists right now.');
  v_tool_bad := public.file_report('tool', 'no-such-tool-anywhere',
                                   'A listing address that has never existed.');
  v_prof_ok  := public.file_report('profile', 'dev_person', 'A profile id that exists.');
  v_prof_bad := public.file_report('profile', 'nobody-at-all-here',
                                   'A profile id that does not exist.');
  perform pg_temp.remember('tool_ok', v_tool_ok);
  perform pg_temp.remember('tool_bad', v_tool_bad);
  perform pg_temp.remember('prof_ok', v_prof_ok);
  perform pg_temp.remember('prof_bad', v_prof_bad);

  perform pg_temp.be('dev_admin');

  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_tool_ok;
  if r.target_resolves is not true then
    perform pg_temp.fail('a report about a live listing says its target does not resolve');
  end if;
  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_tool_bad;
  if r.target_resolves is not false then
    perform pg_temp.fail('a report about a listing that does not exist says it resolves');
  end if;

  -- F21. The id is what is stored; the CURRENT handle is what comes back, so a
  -- rename cannot re-point an old report at whoever takes the name.
  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_prof_ok;
  if r.target_resolves is not true then
    perform pg_temp.fail('a report about a profile that exists says it does not resolve');
  end if;
  if r.target_handle is null then
    perform pg_temp.fail('a report about a profile came back with no handle to draw');
  end if;

  reset role;
  perform pg_temp.owner_window(true);
  update public.profiles set handle = 'renamed_since' where id = 'dev_person';
  perform pg_temp.owner_window(false);
  set role foundit_app;
  perform pg_temp.be('dev_admin');

  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_prof_ok;
  if r.target <> 'dev_person' then
    perform pg_temp.fail(format('the stored target moved with the rename: %L', r.target));
  end if;
  if r.target_handle <> 'renamed_since' then
    perform pg_temp.fail(format('the report still draws the old handle %L after a rename',
                                r.target_handle));
  end if;

  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_prof_bad;
  if r.target_resolves is not false or r.target_handle is not null then
    perform pg_temp.fail('a profile id that does not exist came back resolving, or with a '
                         'handle');
  end if;

  -- A review that has since been deleted outright: the report survives it and
  -- says so, which is the whole reason there is no foreign key on this column.
  reset role;
  perform pg_temp.owner_window(true);
  select id into v_review from public.reviews order by id desc limit 1;
  perform pg_temp.owner_window(false);
  set role foundit_app;
  perform pg_temp.be('dev_person');
  v_report := public.file_report('review', (v_review + 100000)::text,
                                 'A review id that has never been used.');
  perform pg_temp.remember('review_missing', v_report);
  perform pg_temp.be('dev_admin');
  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_report;
  if r.target_resolves is not false then
    perform pg_temp.fail('a report about a review id that does not exist says it resolves');
  end if;
end
$$;

-- ===========================================================================
-- 6c. F11 and F12 — the queue drains from the front, it pages, and a removed
--     review brings its reason with it
-- ===========================================================================
do $$
declare
  v_first  bigint;
  v_second bigint;
  v_review bigint;
  v_report bigint;
  r        record;
  v_total  bigint;
  n        int;
begin
  set role foundit_app;
  perform pg_temp.be('dev_person');

  -- Two open reports, the first of them older. Times are set explicitly rather
  -- than relying on `now()` moving between two statements in one transaction,
  -- where it does not move at all.
  v_first  := public.file_report('tool', 'anki', 'The older of two open reports in 6c.');
  v_second := public.file_report('tool', 'anki', 'The newer of two open reports in 6c.');
  perform pg_temp.remember('older', v_first);
  perform pg_temp.remember('newer', v_second);

  reset role;
  perform pg_temp.owner_window(true);
  update public.reports set created_at = now() - interval '40 days' where id = v_first;
  update public.reports set created_at = now() - interval '1 minute' where id = v_second;
  -- Nothing else is touched. Every other open row in this transaction was
  -- written at `now()`, which inside one transaction does not move, so forty
  -- days ago is the oldest open report on this database by construction —
  -- and a real backlog outside the transaction cannot be older than it either,
  -- because these rows are rolled back and a database that HAS an older open
  -- report would make this assertion about that row instead, which is the same
  -- claim. Pushing the others would mean UPDATEing rows planted with the CHECK
  -- disabled in §6, which re-validates them.
  perform pg_temp.owner_window(false);
  set role foundit_app;
  perform pg_temp.be('dev_admin');

  -- F11a. OPEN FIRST, AND OLDEST FIRST INSIDE THAT. Asserted over the whole
  -- list rather than by naming a row, so it holds on a database with a real
  -- backlog on it as well as on an empty one: every open row comes before
  -- every closed row, and the open segment never goes backwards in time.
  select count(*) into n
    from (select x.resolved_at is not null as closed,
                 x.created_at,
                 row_number() over () as seat
            from public.admin_reports(10000, 0) x) t
   where t.closed and exists (select 1
                                from (select x2.resolved_at is not null as closed2,
                                             row_number() over () as seat2
                                        from public.admin_reports(10000, 0) x2) u
                               where not u.closed2 and u.seat2 > t.seat);
  if n > 0 then
    perform pg_temp.fail('a closed report is above an open one on the Reported tab');
  end if;

  select count(*) into n
    from (select x.created_at,
                 lag(x.created_at) over () as previous
            from public.admin_reports(10000, 0) x
           where x.resolved_at is null) t
   where t.previous is not null and t.created_at < t.previous;
  if n > 0 then
    perform pg_temp.fail('the open reports are not oldest-first; a backlog that drains from '
                         'the back loses its oldest row off the end of the page');
  end if;

  -- And this suite's own pair, by id, which is the version of the same claim
  -- that names the rows it planted.
  select count(*) into n
    from (select x.report_id, row_number() over () as seat
            from public.admin_reports(10000, 0) x) t
   where t.report_id = v_first
     and t.seat > (select u.seat from (select x2.report_id, row_number() over () as seat
                                         from public.admin_reports(10000, 0) x2) u
                    where u.report_id = v_second);
  if n > 0 then
    perform pg_temp.fail('the newer of two open reports is above the older one');
  end if;

  -- F11b. `total` is the count BEFORE the limit, and `p_offset` reaches what
  -- the limit left behind. One row at a time is the strictest version of that.
  select x.total into v_total from public.admin_reports(1, 0) x;
  select count(*) into n from public.admin_reports(10000, 0) x;
  if v_total <> n then
    perform pg_temp.fail(format('total says %s on a page of one and the whole list is %s',
                                v_total, n));
  end if;
  select x.report_id into v_report from public.admin_reports(1, 1) x;
  if v_report = v_first then
    perform pg_temp.fail('an offset of one returned the first row again, so the Reported tab '
                         'cannot reach anything past its limit');
  end if;
  if v_report is null then
    perform pg_temp.fail('an offset of one returned nothing, with more than one report filed');
  end if;

  -- F12. A review an administrator removed arrives with the reason and the
  -- remover, which the Reported tab renders after "Removed <date>:" and which
  -- used to be hardcoded null in `toAdminReports`.
  reset role;
  perform pg_temp.owner_window(true);
  select id into v_review from public.reviews where deleted_at is null order by id limit 1;
  perform pg_temp.owner_window(false);
  set role foundit_app;

  perform pg_temp.be('dev_person');
  v_report := public.file_report('review', v_review::text,
                                 'A review that is about to be taken down.');
  perform pg_temp.remember('removed_review', v_report);

  -- The removal path the application uses: the reason on the record first,
  -- which is what makes the update legal (0013 §7).
  perform pg_temp.be('dev_admin');
  insert into public.review_removals (review_id, admin_id, reason)
  values (v_review, auth.uid(), 'Removed in 6c so the Reported tab has a reason to draw.');
  update public.reviews set deleted_at = now() where id = v_review and deleted_at is null;

  select * into r from public.admin_reports(10000, 0) x where x.report_id = v_report;
  if r.removed_by_admin_at is null then
    perform pg_temp.fail('the removal did not reach admin_reports at all');
  end if;
  if r.removal_reason is null then
    perform pg_temp.fail('a removed review came back through admin_reports with no reason, '
                         'so the tab draws "Removed <date>: " and nothing after the colon');
  end if;
  if r.removed_by is null then
    perform pg_temp.fail('a removed review came back through admin_reports with no remover');
  end if;
end
$$;

reset role;

select 'All report checks passed.' as result;

rollback;
