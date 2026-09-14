-- ===========================================================================
-- 0030 — the Reported tab, made unbreakable by one stranger
--
-- OWNER FEEDBACK, ROUND 1 — F1, F11, F12, F17, F20, F21. Five findings and one
-- table, so they arrive together rather than as five migrations that each
-- rewrite `admin_reports`.
--
-- ---------------------------------------------------------------------------
-- F1. THE SHAPE WAS BOUNDED AND THE MAGNITUDE WAS NOT
--
-- 0027 exists because a report about a TOOL made `admin_reports` raise 22P02
-- on `'anki'::bigint`. Its guard is `p.kind = 'review' and p.target ~
-- '^[0-9]+$'`, which tests the shape of the string and says nothing about how
-- big the number is. `reports_target_shaped` allowed two hundred characters, so
--
--     file_report('review', '99999999999999999999999', …)
--
-- passed the CHECK, passed the CASE, and raised **22003, value out of range for
-- type bigint** — the same failure class 0027 was written to close, one
-- migration later. `lib/admin.ts` swallows it and returns null, so the operator
-- sees the Reported tab render as though they were not an administrator, for
-- ever: there is no delete path for `public.reports` anywhere in the product
-- and `resolve_report` needs an id nobody can read any more. Filing it needs no
-- account.
--
-- So the magnitude is bounded where the shape is bounded — `^[0-9]{1,18}$`,
-- eighteen digits being the widest decimal that always fits in a bigint — AND
-- the CASE inside `admin_reports` uses the identical pattern. Both halves,
-- because they answer different questions: the CHECK stops a new row, and the
-- CASE stops a row that is ALREADY STORED from taking the panel down. A fix to
-- only one of them would leave the reported failure reproducible on any
-- database that already has such a row on it.
--
-- ---------------------------------------------------------------------------
-- F17. `target` WAS THE ONE FREE-TEXT COLUMN WITH NO CONTROL-CHARACTER RULE
--
-- 0023's header says the database enforces "no control characters"; for
-- `target` it did not. `v_reason` and `v_details` were stripped and `p_target`
-- got only `btrim`, so a newline, an ANSI escape and U+202E went straight in —
-- and `target` is interpolated into the report email's SUBJECT
-- (`Reported: ${kind} ${target}`) and into a `/tools/<target>` link on the
-- admin page. `cleanReportText` in the application saves it today, which makes
-- this defence in depth rather than a live hole; defence in depth is exactly
-- what the other three columns already had.
--
-- Both halves again: `file_report` STRIPS, so a target with a stray character
-- becomes the target without it rather than an error nobody can read, and the
-- CHECK REFUSES, so no other door can put one in.
--
-- ---------------------------------------------------------------------------
-- F11 + F12 + F20 + F21. WHAT THE TAB COULD NOT SAY
--
--   `total` and `p_offset`   the tab was hard-capped at fifty rows with no way
--                            to reach the fifty-first, and its badge counted
--                            the truncated array. Now it pages, with the count
--                            before the limit beside the rows — the shape
--                            `admin_reviews` has had since the Phase 8 review.
--
--   OPEN REPORTS OLDEST FIRST. A backlog drains from the front. Newest-first
--   over a capped list is the arrangement in which the oldest unanswered report
--   is the first one to fall off the page, which is precisely backwards for a
--   queue. Closed reports stay newest-first: that list is a record being read,
--   not a queue being worked.
--
--   `removal_reason`, `removed_by`   the Reported tab shares its row component
--                            with All and Removed, which get a real reason from
--                            `admin_reviews`. `admin_reports` declared no such
--                            column, so a removed review rendered "Removed
--                            <date>: " with an empty reason and no remover,
--                            under this page's own promise that the reason goes
--                            on the record. The join to `review_removals` was
--                            already here; only the two columns were missing.
--
--   `target_resolves`        a report may name a tool that does not exist, a
--                            draft, or a review that was deleted. The write
--                            stays permissive on purpose — filing must leak no
--                            existence, and a report has to outlive its target,
--                            which is frequently the point of it — so the
--                            READER says whether the thing is still there and
--                            the operator separates junk from real work.
--
--   `target_handle`          a `kind=profile` report now stores `profiles.id`
--                            (resolved from the handle in `app/report/actions.ts`,
--                            which is where the person typed a handle), because
--                            a handle is user-editable and a rename re-points
--                            an old report at whoever takes the name. The id is
--                            what is stored and the CURRENT handle is what is
--                            drawn, which is the only arrangement in which both
--                            the link and the record are right.
--
-- Nothing here weakens anything: the same admin check as the first statement,
-- the same pinned `search_path`, the same grants, no new policy, no new table
-- privilege. `db/test/reports_test.sql` covers every paragraph above.
-- ===========================================================================
begin;

-- --- F1 + F17: the shape, the magnitude and the control characters ---------
alter table public.reports drop constraint if exists reports_target_shaped;

alter table public.reports add constraint reports_target_shaped
  check (
    length(target) between 1 and 200
    -- 0017's rule, applied to the one free-text column that never had it. The
    -- target reaches an email subject and a link on the admin page.
    and not public.has_control_characters(target)
    -- EIGHTEEN DIGITS AND NOT "ALL DIGITS". `999999999999999999` is the widest
    -- decimal that always fits in a bigint; nineteen may or may not, and
    -- "may or may not" inside a cast is a panel that raises 22003 on one row.
    and (kind <> 'review' or target ~ '^[0-9]{1,18}$')
  );

comment on column public.reports.target is
  'Which thing: reviews.id as digits for kind=review — at most eighteen of '
  'them, so the cast in admin_reports can never overflow a bigint (0030) — the '
  'tool''s slug for kind=tool, profiles.id for kind=profile. Text because the '
  'three keys are three types, and deliberately NOT a foreign key: a report '
  'about a review must outlive the review, which is often why it was filed. '
  'No control characters: it reaches an email subject and a link (0030).';

-- --- F17: and the door strips, so a stray character is not an error --------
create or replace function public.file_report(
  p_kind    text,
  p_target  text,
  p_reason  text,
  p_details text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
set "foundit.definer" = 'on'
as $fn$
declare
  v_reporter text := auth.uid();
  v_target   text;
  v_reason   text;
  v_details  text;
  v_id       bigint;
begin
  -- `auth.uid()` and not an argument. A reporter id a caller could pass is a
  -- reporter id a caller could pass somebody else's, and this is the one
  -- column on the table that names a person.
  --
  -- Null is a legitimate value here: reporting is open to a signed-out visitor
  -- (the alternative is a sign-in wall in front of "this listing is wrong",
  -- which is a wall in front of the reports most worth having).

  if p_kind is null or p_kind not in ('review', 'tool', 'profile') then
    raise exception 'a report is about a review, a tool or a profile, not %',
      coalesce(p_kind, '(null)')
      using errcode = '22023';
  end if;

  -- Strip before measuring, so a reason of nine backspaces is eight characters
  -- short rather than a row that fails a CHECK with an error nobody can read.
  -- `strip_control_characters` is 0017's, and it is what every other free-text
  -- door in this schema uses. `p_target` joined them in 0030 — F17.
  v_target  := btrim(public.strip_control_characters(coalesce(p_target, '')));
  v_reason  := btrim(public.strip_control_characters(coalesce(p_reason, '')));
  v_details := nullif(btrim(public.strip_control_characters(coalesce(p_details, ''))), '');

  if length(v_reason) < 8 then
    raise exception 'a report needs a reason of at least 8 characters'
      using errcode = '22023',
            hint = 'Say what is wrong with it in a sentence.';
  end if;

  if length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;

  if v_details is not null and length(v_details) > 2000 then
    v_details := left(v_details, 2000);
  end if;

  insert into public.reports (kind, target, reason, details, reporter_id)
  values (p_kind, v_target, v_reason, v_details, v_reporter)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.file_report(text, text, text, text) is
  'Record one report. The reporter is auth.uid() read here and never an '
  'argument, so nobody can file as somebody else, and it is null when the '
  'reporter is signed out. The reason AND THE TARGET are stripped of control '
  'characters before they are measured and stored (0030, F17). Returns the new '
  'id (0023).';

-- --- F1 + F11 + F12 + F20 + F21: what the Reported tab reads ---------------
-- The old one-argument signature goes, rather than sitting beside the new one:
-- two overloads would make db/test/admin_test.sql §1's dynamic probe ambiguous,
-- and an old definition nothing calls is the definition somebody reads.
drop function if exists public.admin_reports(int);

create or replace function public.admin_reports(
  p_limit  int default 50,
  p_offset int default 0
)
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
  author_deleted_at   timestamptz,
  -- F12. The reason a removal was recorded with, and who recorded it. The join
  -- was already here; these two columns were not.
  removal_reason text,
  removed_by     text,
  -- F20. Is the thing this report is about still there?
  target_resolves boolean,
  -- F21. The CURRENT handle for a kind=profile report, whose target is an id.
  target_handle   text,
  -- F11. The count before the limit, so the tab can say what it is not showing
  -- and offer the rest.
  total bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_limit  int;
  v_offset int;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  -- After the check, and clamped, for the reason 0020 §3 gives: a DECLARE runs
  -- first, and an argument touched before the check is an argument a stranger
  -- can raise a different SQLSTATE with.
  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 10000);
  v_offset := least(greatest(coalesce(p_offset, 0), 0), 1000000);

  return query
    with ordered as (
      select p.id, p.kind, p.target, p.reason, p.details, p.reporter_id,
             p.created_at, p.resolved_at, p.resolved_by, p.resolution,
             -- 0027's CASE, with 0030's bound in it. A CASE does not evaluate
             -- the branch it did not take, and MATERIALIZED below is what stops
             -- the planner putting this expression back into a join qualifier —
             -- which is the whole of 0027. The `{1,18}` is F1: the CHECK stops
             -- a NEW row being wider than a bigint and this stops a row already
             -- stored from taking the panel down.
             case when p.kind = 'review' and p.target ~ '^[0-9]{1,18}$'
                  then p.target::bigint end as rid,
             count(*) over () as total
        from public.reports p
    ),
    picked as materialized (
      select o.*
        from ordered o
       -- OPEN FIRST AND OLDEST FIRST WITHIN IT — F11. A backlog drains from
       -- the front, so the oldest unanswered report is the first row on the
       -- page rather than the first one to fall off it. Closed reports stay
       -- newest-first: that list is a record being read, not a queue.
       order by (o.resolved_at is not null),
                case when o.resolved_at is null then o.created_at end asc,
                case when o.resolved_at is null then o.id end asc,
                o.created_at desc,
                o.id desc
       limit v_limit offset v_offset
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
           -- The AUTHOR took it down. Two events, two columns.
           v.deleted_at,
           rr.reason,
           ra.handle::text,
           -- F20. Three kinds, three questions, and a report about a thing that
           -- has since gone is still a report — this says so rather than
           -- refusing to store it.
           case r.kind
             when 'review'  then v.id is not null
             when 'tool'    then tg.id is not null
             when 'profile' then pf.id is not null
             else false
           end,
           -- F21. Null for every other kind, and null for a profile id that no
           -- longer exists, which `target_resolves` has already said.
           case when r.kind = 'profile' then pf.handle::text end,
           r.total
      from picked r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles rb on rb.id = r.resolved_by
      left join public.reviews v on v.id = r.rid
      left join public.review_removals rr on rr.review_id = v.id
      left join public.profiles ra on ra.id = rr.admin_id
      left join public.tools t on t.id = v.tool_id
      left join public.profiles a on a.id = v.author_id
      -- The target itself, for F20 and F21. Guarded by kind so a slug is never
      -- looked up as an id and an id is never looked up as a slug.
      left join public.tools tg
             on r.kind = 'tool' and tg.slug = r.target::citext
      left join public.profiles pf
             on r.kind = 'profile' and pf.id = r.target
     order by (r.resolved_at is not null),
              case when r.resolved_at is null then r.created_at end asc,
              case when r.resolved_at is null then r.id end asc,
              r.created_at desc,
              r.id desc;
end;
$fn$;

comment on function public.admin_reports(int, int) is
  'One page of reports: open first and OLDEST first inside that, so a backlog '
  'drains from the front (0030, F11); closed after them, newest first. The '
  'review is inlined when the report is about one, with the reason it was '
  'removed for and who removed it (F12), and every row says whether its target '
  'still exists (F20) and — for a profile — what that account''s handle is now '
  '(F21). `total` is the count before the limit, so the tab can offer the rest '
  'rather than stopping silently. The review id is computed in a MATERIALIZED '
  'CTE, bounded to eighteen digits, because a cast in a join qualifier is not '
  'evaluated after the guard beside it and a wider number is 22003 rather than '
  '22P02 (0027, 0030). Handles and never addresses, and not one column from a '
  'search table (0023, 0025, 0027, 0030).';

revoke execute on function public.admin_reports(int, int) from public;
grant execute on function public.admin_reports(int, int) to foundit_app;

commit;
