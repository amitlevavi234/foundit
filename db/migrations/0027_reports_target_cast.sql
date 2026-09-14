-- ===========================================================================
-- 0027 — `target::bigint` where the target is a slug
--
-- 0023 and 0025 both wrote the join from a report to the review it is about as
--
--     left join public.reviews v
--            on r.kind = 'review'
--           and r.target ~ '^[0-9]+$'
--           and v.id = r.target::bigint
--
-- and read it as three conditions evaluated in order. A join qualifier is not
-- evaluated in order. The planner is free to push the equality down, and it
-- does, so the first report about a TOOL — whose target is a slug — took
-- `'anki'::bigint` and raised 22P02 on a panel that is supposed to be a fixed
-- SELECT that cannot fail. Every report in the table had to be about a review
-- for the function to work at all, which is exactly the case the test suite
-- did not have and the product always will.
--
-- THE FIX IS TO MAKE THE CAST HAPPEN SOMEWHERE ORDERED. A `CASE` guards its
-- own branches, so the id is computed once per row in a CTE that is
-- MATERIALIZED — the keyword is load-bearing, not decoration: an inlined CTE
-- is the same expression back in the join qualifier and the same bug back with
-- it. `case when kind = 'review' and target ~ '^[0-9]+$' then target::bigint
-- end` is null for a tool and for a profile, and a left join on null matches
-- nothing, which is the answer.
--
-- IT IS ALSO THE FASTER SHAPE, which is worth saying because otherwise this
-- reads as a workaround. `order by ... limit` now happens over `reports`
-- alone, before six left joins rather than after them, so the panel touches
-- fifty rows of four tables instead of every report ever filed.
--
-- db/test/reports_test.sql §5 files a report about a tool AND a report about a
-- review in the same suite, and reads both back, which is the test that was
-- missing.
-- ===========================================================================
begin;

create or replace function public.admin_reports(p_limit int default 50)
returns table (
  report_id   bigint,
  kind        text,
  target      text,
  reason      text,
  details     text,
  reporter    text,
  created_at  timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  resolution  text,
  review_id   bigint,
  tool_slug   text,
  tool_name   text,
  handle      text,
  rating      smallint,
  body        text,
  review_created_at   timestamptz,
  removed_by_admin_at timestamptz,
  author_deleted_at   timestamptz
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

  return query
    with picked as materialized (
      select p.id, p.kind, p.target, p.reason, p.details, p.reporter_id,
             p.created_at, p.resolved_at, p.resolved_by, p.resolution,
             -- The whole of 0027. A CASE does not evaluate the branch it did
             -- not take, and MATERIALIZED is what stops the planner putting
             -- this expression back into the join qualifier below.
             case when p.kind = 'review' and p.target ~ '^[0-9]+$'
                  then p.target::bigint end as rid
        from public.reports p
       order by (p.resolved_at is not null), p.created_at desc, p.id desc
       limit v_limit
    )
    select r.id,
           r.kind,
           r.target,
           r.reason,
           r.details,
           rp.handle::text,
           r.created_at,
           r.resolved_at,
           rb.handle::text,
           r.resolution,
           v.id,
           t.slug::text,
           t.name,
           a.handle::text,
           v.rating,
           -- 0020 §5's rule: the words, unless the author retracted them and
           -- nobody has recorded a removal against them.
           case when v.deleted_at is not null and rr.id is null then null else v.body end,
           v.created_at,
           -- An ADMINISTRATOR took it down.
           rr.created_at,
           -- The AUTHOR took it down. Two events, two columns, F8.
           v.deleted_at
      from picked r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles rb on rb.id = r.resolved_by
      left join public.reviews v on v.id = r.rid
      left join public.review_removals rr on rr.review_id = v.id
      left join public.tools t on t.id = v.tool_id
      left join public.profiles a on a.id = v.author_id
     order by (r.resolved_at is not null), r.created_at desc, r.id desc;
end;
$fn$;

comment on function public.admin_reports(int) is
  'Every report, unresolved first and newest first, with the review it is '
  'about inlined when it is about a review — and null there when it is about a '
  'tool or a profile, whose targets are not numbers. The id is computed in a '
  'MATERIALIZED CTE because a cast in a join qualifier is not evaluated after '
  'the guard beside it (0027). Handles and never addresses, and not one column '
  'from a search table (0023, 0025, 0027).';

commit;
