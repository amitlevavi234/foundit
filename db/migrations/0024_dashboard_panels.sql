-- ===========================================================================
-- 0024 — the five panels the owner asked for, and the two ledgers behind them
--
-- THE OWNER'S ITEM 10, 14 September 2026. He looked at the dashboard and asked
-- for monthly active accounts, new accounts per day, new tools per day, visits,
-- and money spent so far. Three of those the schema could already answer and
-- nothing drew them; two of them nothing anywhere was writing down.
--
-- THE RULE THIS FILE IS WRITTEN UNDER is the one §10 already states and the
-- dashboard already keeps: nothing draws a 0 where the truth is "not
-- recorded". Both new ledgers are therefore APPEND-ONLY COUNTERS with a first
-- row, and both panels ask when the first row was written, so a month with no
-- data reads as "nothing has been recorded yet" and never as "nothing
-- happened".
--
-- ---------------------------------------------------------------------------
-- 1. MONTHLY ACTIVE ACCOUNTS — no new column, and the arithmetic is exact
--
-- `profiles.last_seen_day` (0019 §2) is one date per account, stamped once a
-- day by the statement that already asks who is signing in. So:
--
--   monthly active  = count(*) from profiles where last_seen_day >= today - 29
--   accounts seen on day d = count(*) from profiles where last_seen_day = d
--
-- and because each account has exactly ONE last_seen_day, the thirty daily
-- counts SUM to the monthly figure. One function gives both numbers and they
-- cannot disagree. The caption has to say "accounts seen that day" rather than
-- "daily active accounts", because it is not that: somebody who came on
-- Tuesday and again on Friday appears only on Friday. The owner asked for that
-- sentence by name.
--
-- 2. NEW TOOLS PER DAY — `tools.created_at` and `tools.published_at`, both, in
-- one series, because "added" and "published" are different days for every
-- listing that went through the submit flow and the same day for every seeded
-- one.
--
-- 3. VISITS — `infra.page_views_daily`, written by an in-process counter in the
-- application, flushed once a minute. NO IDENTITY OF ANY KIND: the counter is
-- an integer per day in one Node process and the function takes a day and a
-- number. There is no address, no cookie, no session and nothing to correlate,
-- which is what lets this live beside `search_events` without being the join
-- §10 forbids — there is nothing here to join ON.
--
-- 4. MONEY — `infra.spend_ledger`, written by the four paid-call paths from the
-- PROVIDER'S OWN usage fields and priced with lib/prices.ts. It is a record of
-- what this deployment spent; it is not, and its caption says it is not, a
-- record of what the project has spent, because the development that got here
-- was paid for before anything was writing it down.
--
-- ---------------------------------------------------------------------------
-- WHY BOTH LEDGERS ARE IN `infra` AND CARRY NO RLS
--
-- 0019 §1 settled this for `infra.ops_events` and the argument is the same
-- here: a table with one writer and one reader cannot honestly carry a policy.
-- Every row belongs to the deployment rather than to a person, so a policy
-- would have to be `true`, and a policy that evaluates to `true` is the exact
-- anti-pattern db/test/rls_test.sql exists to catch. THE GRANT IS THE
-- BOUNDARY: `foundit_app` may execute the two writers and nothing else, and
-- may not read either table at all. db/test/panels_test.sql reads that back.
--
-- A FAILURE TO RECORD MUST NEVER FAIL A SEARCH. Both writers are called
-- fire-and-forget from the application with a logged warning on failure
-- (lib/spend.ts, lib/page-views.ts), and both are written so the worst case is
-- a lost count rather than a lost row: `on conflict do update` adds, so two
-- flushes racing add twice rather than overwriting each other.
-- ===========================================================================
begin;

-- ===========================================================================
-- 1. VISITS
-- ===========================================================================
create table if not exists infra.page_views_daily (
  day        date primary key,
  views      bigint not null default 0 check (views >= 0),
  updated_at timestamptz not null default now()
);

comment on table infra.page_views_daily is
  'One row per day: how many pages this deployment served that day. It holds a '
  'date and a number and there is no third column to ask for — no address, no '
  'session, no path, nothing that could say who or what. Written by '
  'infra.add_page_views from an in-process counter flushed once a minute '
  '(0024).';

create or replace function infra.add_page_views(p_day date, p_views int)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, infra
as $fn$
begin
  -- Nothing to do rather than an error: a flush with no views in it is the
  -- ordinary case on a quiet minute, and a writer that raised on it would be a
  -- warning in the log every sixty seconds.
  if p_views is null or p_views <= 0 or p_day is null then
    return;
  end if;

  -- ADDS. Two processes, or two flushes of the same process racing, must come
  -- to the sum of what they each counted; an overwrite would silently lose
  -- whichever arrived first.
  insert into infra.page_views_daily (day, views)
  values (p_day, least(p_views, 1000000000))
  on conflict (day) do update
    set views      = infra.page_views_daily.views + excluded.views,
        updated_at = now();
end;
$fn$;

comment on function infra.add_page_views(date, int) is
  'Add a flush of page views to one day. Adds rather than sets, so two flushes '
  'racing sum instead of overwriting. A non-positive count is a no-op, because '
  'a quiet minute is the ordinary case (0024).';

-- ===========================================================================
-- 2. MONEY
-- ===========================================================================
create table if not exists infra.spend_ledger (
  day           date not null,
  kind          text not null check (kind in ('reader', 'rerank', 'embed', 'worker')),
  requests      bigint not null default 0 check (requests >= 0),
  input_tokens  bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  usd           numeric(14, 8) not null default 0 check (usd >= 0),
  updated_at    timestamptz not null default now(),
  primary key (day, kind)
);

comment on table infra.spend_ledger is
  'What this deployment spent with the model providers, by day and by which '
  'call it was. Token counts come from the provider''s own usage fields at the '
  'call site and the dollars from lib/prices.ts, so a price change is a code '
  'change and the history is not rewritten by it. It starts at its first row: '
  'development spend before this table existed is not in it, and the panel '
  'says so (0024).';

comment on column infra.spend_ledger.usd is
  'numeric(14,8) because a single embedding request costs about $0.000002 and '
  'a column that rounded it to cents would record thousands of them as zero.';

create or replace function infra.add_spend(
  p_day           date,
  p_kind          text,
  p_requests      bigint,
  p_input_tokens  bigint,
  p_output_tokens bigint,
  p_usd           numeric
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, infra
as $fn$
begin
  if p_day is null or p_kind is null then
    return;
  end if;
  if p_kind not in ('reader', 'rerank', 'embed', 'worker') then
    raise exception 'spend kind % is not one this ledger records', p_kind
      using errcode = '22023';
  end if;

  insert into infra.spend_ledger (day, kind, requests, input_tokens, output_tokens, usd)
  values (p_day, p_kind,
          greatest(coalesce(p_requests, 0), 0),
          greatest(coalesce(p_input_tokens, 0), 0),
          greatest(coalesce(p_output_tokens, 0), 0),
          greatest(coalesce(p_usd, 0), 0))
  on conflict (day, kind) do update
    set requests      = infra.spend_ledger.requests + excluded.requests,
        input_tokens  = infra.spend_ledger.input_tokens + excluded.input_tokens,
        output_tokens = infra.spend_ledger.output_tokens + excluded.output_tokens,
        usd           = infra.spend_ledger.usd + excluded.usd,
        updated_at    = now();
end;
$fn$;

comment on function infra.add_spend(date, text, bigint, bigint, bigint, numeric) is
  'Add one paid call''s usage to the day''s row for that kind. Adds rather than '
  'sets. Negative values are clamped to zero: a provider that reported a '
  'negative token count would otherwise reduce the bill (0024).';

-- ===========================================================================
-- 3. THE PANELS
--
-- Each one: every argument an integer with a default, auth.is_admin() as the
-- FIRST statement, clamps computed after it, a fixed SELECT and no dynamic
-- SQL. db/test/admin_test.sql §0 through §2 enforce all five of those over
-- every `public.admin\_%` function, and its allowlist is extended in the same
-- commit with each of these four shapes, on purpose.
-- ===========================================================================

-- --- accounts seen, by day -------------------------------------------------
create or replace function public.admin_active_accounts(p_days int default 30)
returns table (
  day  date,
  seen bigint
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
           count(p.id)::bigint
      from days
      left join public.profiles p on p.last_seen_day = days.d
     group by days.d
     order by days.d;
end;
$fn$;

comment on function public.admin_active_accounts(int) is
  'Accounts whose last_seen_day is that day, one row per day. Each account has '
  'exactly one last_seen_day, so these counts SUM to "accounts seen in the '
  'window", which is the monthly active figure — one function, two numbers, '
  'and they cannot disagree. It is not "daily active accounts": somebody who '
  'came on Tuesday and again on Friday is counted on Friday only (0024).';

-- --- listings added and published, by day ----------------------------------
create or replace function public.admin_new_tools(p_days int default 30)
returns table (
  day       date,
  added     bigint,
  published bigint
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
           (select count(*) from public.tools t
             where (t.created_at at time zone 'UTC')::date = days.d)::bigint,
           (select count(*) from public.tools t
             where t.status = 'published'
               and (t.published_at at time zone 'UTC')::date = days.d)::bigint
      from days
     order by days.d;
end;
$fn$;

comment on function public.admin_new_tools(int) is
  'Listings created and listings published, by day. Two series and not one: a '
  'listing from the submit flow is added on one day and published on another, '
  'and a chart of either alone would be missing half of what happened (0024).';

-- --- page views, by day ----------------------------------------------------
create or replace function public.admin_page_views(p_days int default 30)
returns table (
  day       date,
  views     bigint,
  recording boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, infra
as $fn$
declare
  v_days  int;
  v_first date;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_days := least(greatest(coalesce(p_days, 30), 1), 3650);

  -- THE THIRD COLUMN IS THE POINT. A day before the first row ever written is
  -- a day nothing was counting, and a 0 for it would be a measurement that was
  -- never made. `recording` lets the panel draw the difference between "no
  -- visits" and "no counter" rather than drawing both as an empty bar.
  select min(p.day) into v_first from infra.page_views_daily p;

  return query
    with days as (
      select generate_series((current_date - (v_days - 1)), current_date,
                             interval '1 day')::date as d
    )
    select days.d,
           coalesce(p.views, 0)::bigint,
           (v_first is not null and days.d >= v_first)
      from days
      left join infra.page_views_daily p on p.day = days.d
     order by days.d;
end;
$fn$;

comment on function public.admin_page_views(int) is
  'Page views by day, with a flag saying whether anything was counting that '
  'day at all. The flag is what stops the panel drawing a zero for a day '
  'before the counter existed — §10''s rule that nothing draws a 0 where the '
  'truth is "not recorded" (0024).';

-- --- spend, by day and by kind ---------------------------------------------
create or replace function public.admin_spend(p_days int default 30)
returns table (
  day    date,
  reader numeric,
  rerank numeric,
  embed  numeric,
  worker numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, infra
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
           coalesce(sum(s.usd) filter (where s.kind = 'reader'), 0)::numeric,
           coalesce(sum(s.usd) filter (where s.kind = 'rerank'), 0)::numeric,
           coalesce(sum(s.usd) filter (where s.kind = 'embed'),  0)::numeric,
           coalesce(sum(s.usd) filter (where s.kind = 'worker'), 0)::numeric
      from days
      left join infra.spend_ledger s on s.day = days.d
     group by days.d
     order by days.d;
end;
$fn$;

comment on function public.admin_spend(int) is
  'What each of the four paid paths cost, by day, for the stacked bar. Four '
  'columns rather than a kind column, because the panel draws four series and '
  'a row per kind would make an absent kind an absent row rather than a zero '
  'in a stack (0024).';

create or replace function public.admin_spend_totals(p_months int default 1)
returns table (
  month_to_date numeric,
  all_time      numeric,
  requests      bigint,
  first_day     date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, infra
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  -- `p_months` exists to satisfy the one rule this family is built on — every
  -- argument an integer with a default, so db/test/admin_test.sql §1 can probe
  -- every function with a chosen value in every argument — and it is used: it
  -- is how many whole calendar months back "month to date" starts from, which
  -- is 1 for this month and 2 for this month plus last.
  return query
    select coalesce(sum(s.usd) filter (
             where s.day >= (date_trunc('month', current_date)
                             - make_interval(months => least(greatest(coalesce(p_months, 1), 1), 120) - 1))::date
           ), 0)::numeric,
           coalesce(sum(s.usd), 0)::numeric,
           coalesce(sum(s.requests), 0)::bigint,
           min(s.day)
      from infra.spend_ledger s;
end;
$fn$;

comment on function public.admin_spend_totals(int) is
  'Month to date, since the first row, how many paid requests, and what the '
  'first day was. `first_day` is null until something has been recorded, which '
  'is how the panel knows to say "nothing recorded yet" rather than "$0.00" '
  '(0024).';

-- ===========================================================================
-- 4. GRANTS
--
-- The application may execute the two writers and the four panels and may read
-- neither infra table. `revoke ... from public` first on every one: a
-- SECURITY DEFINER function executable by PUBLIC is a door with a lock nobody
-- turned.
-- ===========================================================================
revoke execute on function infra.add_page_views(date, int) from public;
revoke execute on function infra.add_spend(date, text, bigint, bigint, bigint, numeric) from public;
revoke execute on function public.admin_active_accounts(int) from public;
revoke execute on function public.admin_new_tools(int) from public;
revoke execute on function public.admin_page_views(int) from public;
revoke execute on function public.admin_spend(int) from public;
revoke execute on function public.admin_spend_totals(int) from public;

grant execute on function infra.add_page_views(date, int) to foundit_app;
-- The embedding worker connects as foundit_embed and is one of the four kinds
-- this ledger records, so it needs the same door.
grant execute on function infra.add_spend(date, text, bigint, bigint, bigint, numeric)
  to foundit_app, foundit_embed;

grant execute on function public.admin_active_accounts(int) to foundit_app;
grant execute on function public.admin_new_tools(int) to foundit_app;
grant execute on function public.admin_page_views(int) to foundit_app;
grant execute on function public.admin_spend(int) to foundit_app;
grant execute on function public.admin_spend_totals(int) to foundit_app;

-- USAGE on `infra` is the owner's; the application reaches the two tables only
-- through the definer functions above, which run as the owner. Saying so
-- explicitly, because a `grant usage on schema infra to foundit_app` added
-- later by somebody tidying up would be the whole boundary gone.
revoke all on schema infra from foundit_app;
revoke all on all tables in schema infra from foundit_app;

commit;
