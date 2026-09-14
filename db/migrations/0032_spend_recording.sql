-- ===========================================================================
-- 0032 — the Money chart drew twenty-nine days of $0.00 for days nothing was
--        recorded on, and the page already knew better
--
-- OWNER FEEDBACK, ROUND 1 — F8, and F22 in the last paragraph of this header.
--
-- `admin_page_views` returns a `recording` boolean per day and the Visits chart
-- hatches the days before the counter existed — §10's rule that nothing draws a
-- 0 where the truth is "not recorded". `admin_spend` returned no such flag, and
-- the Money panel's "nothing has been recorded" sentence appears only when
-- there are no rows AT ALL. So as soon as one paid call landed, the chart
-- silently drew twenty-nine days of zero for days on which nothing was being
-- recorded — even though `admin_spend_totals().first_day` was already on the
-- page and already said the ledger began yesterday.
--
-- The flag is derived exactly as `admin_page_views` derives its own: `min(day)`
-- over the ledger, read once into a variable before the series is built. Not
-- `first_day` from `admin_spend_totals`, even though it is the same number —
-- two functions reading the same table in the same transaction cannot disagree,
-- and one function reading another's output would make the chart depend on the
-- panel above it being asked for first.
--
-- NOTE THE ASYMMETRY, because it is deliberate and a reader will ask. A day
-- with recording=true and 0.00 in every column is a real day on which nothing
-- was spent, and it is drawn as an empty slot — the truth. A day with
-- recording=false is drawn hatched. Those are different facts and the chart now
-- has a mark for each.
--
-- ---------------------------------------------------------------------------
-- F22 — 0024:445-449 IS SUPERSEDED, AND THIS IS THE POINTER BACK
--
-- `0024_dashboard_panels.sql:445-449` says, in a paragraph a reader following
-- the "who says what about `infra`" trail hits first:
--
--     -- USAGE on `infra` is the owner's; ... a `grant usage on schema infra to
--     -- foundit_app` added later by somebody tidying up would be the whole
--     -- boundary gone.
--     revoke all on schema infra from foundit_app;
--
-- `0028_infra_usage.sql` does exactly that, on purpose, and argues correctly
-- that USAGE is not a data privilege: it grants no SELECT, no INSERT and no
-- reference to any table, only the ability to resolve a qualified name. Without
-- it the EXECUTE grant 0024 made could never be exercised and every page view
-- was `permission denied for schema infra`.
--
-- An applied migration is never edited — that is the right rule and 0028 kept
-- it — but 0028 left no pointer back, so 0024's paragraph still reads as
-- current. It is not. The boundary is the TABLE privileges (none) and the two
-- SECURITY DEFINER doors, not the schema privilege. 0028 amended
-- `comment on schema infra`, which is the right place for the standing
-- statement; this is the pointer in the migration trail, and
-- `docs/development.md` carries the same line for anybody reading the prose
-- rather than the SQL.
-- ===========================================================================
begin;

-- A sixth output column is a different return type, and PostgreSQL will not
-- replace a function's return type in place. So it is dropped and made again,
-- which takes its privileges with it — see the grant at the foot of this file.
drop function if exists public.admin_spend(int);

create function public.admin_spend(p_days int default 30)
returns table (
  day       date,
  reader    numeric,
  rerank    numeric,
  embed     numeric,
  worker    numeric,
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

  -- THE SIXTH COLUMN IS THE POINT, and it is `admin_page_views`' third column
  -- written again rather than borrowed: a day before the first row ever written
  -- is a day nothing was being recorded, and a 0.00 for it would be a
  -- measurement nobody made.
  select min(s.day) into v_first from infra.spend_ledger s;

  return query
    with days as (
      select generate_series((current_date - (v_days - 1)), current_date,
                             interval '1 day')::date as d
    )
    select days.d,
           coalesce(sum(s.usd) filter (where s.kind = 'reader'), 0)::numeric,
           coalesce(sum(s.usd) filter (where s.kind = 'rerank'), 0)::numeric,
           coalesce(sum(s.usd) filter (where s.kind = 'embed'),  0)::numeric,
           coalesce(sum(s.usd) filter (where s.kind = 'worker'), 0)::numeric,
           (v_first is not null and days.d >= v_first)
      from days
      left join infra.spend_ledger s on s.day = days.d
     group by days.d
     order by days.d;
end;
$fn$;

comment on function public.admin_spend(int) is
  'What each of the four paid paths cost, by day, for the stacked bar, with a '
  'flag saying whether anything was being recorded that day at all. Four kind '
  'columns rather than a kind column, because the panel draws four series and a '
  'row per kind would make an absent kind an absent row rather than a zero in a '
  'stack (0024). The flag is what stops the chart drawing twenty-nine days of '
  '$0.00 for days before the ledger existed — §10''s rule that nothing draws a '
  '0 where the truth is "not recorded" (0032).';

-- A dropped function takes its privileges with it, so 0024's two lines are
-- made again here. The revoke first, because a function is executable by
-- PUBLIC by default and a SECURITY DEFINER function anybody may call is a hole
-- with a check in it rather than a door.
revoke execute on function public.admin_spend(int) from public;
grant execute on function public.admin_spend(int) to foundit_app;

commit;
