-- ===========================================================================
-- 0025 — admin_reports reads a removal from where a removal is recorded
--
-- 0023 was written from `admin_reviews`'s COLUMN LIST rather than from its
-- body, and the two say different things. Its result declares
-- `removed_by_admin_at` and `author_deleted_at`, and 0020 §5 fills them from:
--
--     rr.created_at    public.review_removals — an ADMINISTRATOR took it down
--     r.deleted_at     public.reviews         — the AUTHOR took it down
--
-- Those are the two different events F8 separated, and neither is a column on
-- `public.reviews` called `removed_by_admin_at`. 0023 selected
-- `v.removed_by_admin_at` and `a.deleted_at` — the first does not exist, and
-- the second is the PROFILE's deletion rather than the review's. So
-- `admin_reports()` raised 42703 for an administrator on its first call, which
-- db/test/admin_test.sql §1's positive control caught before anything rendered
-- it.
--
-- THIS FILE EXISTS INSTEAD OF AN EDIT TO 0023 because an applied migration is
-- never edited. 0023 has run on this machine; correcting the file would leave
-- a database whose `admin_reports` does not match the 0023 anybody else
-- applies, which is the exact drift the rule prevents. The shape is unchanged,
-- so `create or replace` is enough and db/test/admin_test.sql's allowlist entry
-- for it stands as written.
--
-- IT ALSO PICKS UP THE HALF OF 0020 §5 THAT 0023 MISSED: a review whose author
-- retracted it, with no removal recorded against it, has its body withheld.
-- The Reported tab would otherwise be the one screen in the product that
-- shows an operator the words somebody chose to take down.
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
           -- 0020 §5's rule, which 0023 dropped: the words, unless the author
           -- retracted them and nobody has recorded a removal against them.
           case when v.deleted_at is not null and rr.id is null then null else v.body end,
           v.created_at,
           -- An ADMINISTRATOR took it down.
           rr.created_at,
           -- The AUTHOR took it down. Two events, two columns, F8.
           v.deleted_at
      from public.reports r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles rb on rb.id = r.resolved_by
      left join public.reviews v
             on r.kind = 'review'
            and r.target ~ '^[0-9]+$'
            and v.id = r.target::bigint
      left join public.review_removals rr on rr.review_id = v.id
      left join public.tools t on t.id = v.tool_id
      left join public.profiles a on a.id = v.author_id
     order by (r.resolved_at is not null), r.created_at desc, r.id desc
     limit v_limit;
end;
$fn$;

comment on function public.admin_reports(int) is
  'Every report, unresolved first and newest first, with the review it is '
  'about inlined when it is about a review — including which of the two ways '
  'it came down, if it did: review_removals.created_at is an administrator''s '
  'removal and reviews.deleted_at is the author''s own (0020 §5, F8). Handles '
  'and never addresses, and not one column from a search table (0023, 0025).';

commit;
