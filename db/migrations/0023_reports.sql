-- ===========================================================================
-- 0023 — a report is written down as well as sent
--
-- THE OWNER'S ITEM 9, and the supervisor's decision of 14 September 2026.
--
-- WHAT IT REPLACES. `docs/product-decisions.md` §5 said "reports go to the team
-- by email rather than into a queue", and the dashboard's Words panel said so
-- honestly: "Reports received — Not recorded". An email is a fine way to tell
-- somebody; it is a poor way to know how many there were, which ones are still
-- open, or whether the one about a listing last month was ever dealt with. The
-- decision is now that a report is BOTH: written here and still emailed. The
-- email is what reaches a person; this table is what can be counted.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE, AND THE ONE COLUMN THAT IS NOT THERE
--
-- `reports` has a `reporter_id` and it has no search column, no query text, no
-- address and no session. A report is a thing a PERSON did, so it sits firmly
-- on the people side of the line docs/product-decisions.md §10 draws, and
-- db/test/admin_test.sql §2(ii) is extended in the same commit to say so: the
-- word `reports` is added to that file's `peopley` list, which means any future
-- admin function that names both `reports` and a search table fails the suite.
-- That is the whole point of adding it there rather than leaving it unlisted.
--
-- `target` is text and not a bigint, because the three kinds do not share a key
-- type: a review is `reviews.id` (bigint), a tool is its slug (citext) and a
-- profile is `profiles.id` (text). One text column with a CHECK per kind is
-- honest about that; three nullable columns with a CHECK that exactly one is
-- set would be the same thing with more ways to be half-filled. There is no
-- foreign key on it on purpose — a report about a review must survive the
-- review being deleted, which is frequently the point of the report.
--
-- `reporter_id` is nullable and `on delete set null`: reporting works signed
-- out (a person who found something wrong is not required to make an account
-- first), and somebody deleting their account does not delete the evidence
-- they filed — it stops being attributed, which is the same rule 0016 applies
-- to reviews.
--
-- ---------------------------------------------------------------------------
-- HOW IT IS WRITTEN AND READ, WHICH IS THE WHOLE SECURITY STORY
--
--   in   public.file_report(kind, target, reason, details) — SECURITY DEFINER.
--        It reads auth.uid() ITSELF for the reporter, so a caller cannot file a
--        report as somebody else; a signed-out caller gets a null reporter
--        rather than a refusal.
--   out  public.admin_reports(limit) — SECURITY DEFINER, checks auth.is_admin()
--        as its first statement, on db/test/admin_test.sql's allowlist.
--   done public.resolve_report(id, resolution) — SECURITY DEFINER, admin only.
--
-- `foundit_app` is granted EXECUTE on those three and NOTHING on the table.
-- There is no select policy, no insert policy and no update policy for the
-- application role, which means the only way to reach a row is through a door
-- that has a check written in it. RLS is enabled AND forced, and the owner's
-- own window (0020 §2) is the `reports_definer` policy, gated on the setting
-- rather than on `true`.
--
-- ---------------------------------------------------------------------------
-- RATE LIMITING lives in lib/rate-limit.ts with every other limit — five per
-- address per hour and ten per account per day — because that is where the
-- limiter is and a second limiter in the database would be a second set of
-- numbers to keep in step. What the database enforces is the SHAPE: a reason
-- between 8 and 500 characters with no control characters in it, which
-- `public.has_control_characters` (0017) already defines for every other piece
-- of free text in this schema.
-- ===========================================================================
begin;

-- --- the table -------------------------------------------------------------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  kind        text not null,
  target      text not null,
  reason      text not null,
  details     text,
  reporter_id text references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references public.profiles(id) on delete set null,
  resolution  text,

  constraint reports_kind_known
    check (kind in ('review', 'tool', 'profile')),
  -- A review is identified by its bigint id, so the text must be digits; the
  -- other two are already text keys. A CHECK rather than a foreign key: see
  -- the header.
  constraint reports_target_shaped
    check (
      length(target) between 1 and 200
      and (kind <> 'review' or target ~ '^[0-9]+$')
    ),
  constraint reports_reason_length
    check (length(reason) between 8 and 500),
  constraint reports_reason_is_plain_text
    check (not public.has_control_characters(reason)),
  constraint reports_details_shaped
    check (details is null
           or (length(details) <= 2000 and not public.has_control_characters(details))),
  constraint reports_resolution_shaped
    check (resolution is null
           or (length(resolution) between 1 and 500
               and not public.has_control_characters(resolution))),
  -- Resolved is one event, so its three columns move together. `resolution` is
  -- optional even when resolved — the supervisor's decision says the reason on
  -- a resolve is optional — but a resolution with no resolved_at would be a
  -- note nobody can date.
  constraint reports_resolved_together
    check ((resolved_at is null) = (resolved_by is null)
           and (resolution is null or resolved_at is not null))
);

comment on table public.reports is
  'Every report somebody filed about a review, a listing or a profile: what '
  'kind of thing, which one, why, optionally more, and who filed it when they '
  'were signed in. Written only by public.file_report, read only by '
  'public.admin_reports, closed only by public.resolve_report. It holds nothing '
  'about a search: no query text, no address, no session (0023).';

comment on column public.reports.target is
  'Which thing: reviews.id as digits for kind=review, the tool''s slug for '
  'kind=tool, profiles.id for kind=profile. Text because the three keys are '
  'three types, and deliberately NOT a foreign key — a report about a review '
  'must outlive the review, which is often why it was filed.';

comment on column public.reports.reporter_id is
  'Who filed it, when they were signed in. Null for a signed-out report, and '
  'null again if they later delete their account: the report stays and stops '
  'being attributed, which is 0016''s rule for a review applied to a report.';

create index if not exists reports_open
  on public.reports (created_at desc, id desc)
  where resolved_at is null;

create index if not exists reports_by_target
  on public.reports (kind, target);

-- --- row level security ----------------------------------------------------
-- Enabled and FORCED, like every other table in public, and with NOT ONE
-- policy for foundit_app. Three definer functions are the only doors; a policy
-- here would be a fourth, and a fourth door is what the other three exist to
-- avoid.
alter table public.reports enable row level security;
alter table public.reports force row level security;

-- 0020 §2's window, written out for this table because that migration's DO
-- loop ran over the tables that existed then. Gated on the setting, never on
-- `true`: db/test/rls_test.sql fails a policy whose qualifier is a constant.
create policy reports_definer on public.reports
  for all to foundit_owner
  using      (pg_catalog.current_setting('foundit.definer', true) = 'on')
  with check (pg_catalog.current_setting('foundit.definer', true) = 'on');

-- --- filing one ------------------------------------------------------------
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
  -- door in this schema uses.
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
  values (p_kind, btrim(coalesce(p_target, '')), v_reason, v_details, v_reporter)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.file_report(text, text, text, text) is
  'Record one report. The reporter is auth.uid() read here and never an '
  'argument, so nobody can file as somebody else, and it is null when the '
  'reporter is signed out. The reason is stripped of control characters before '
  'it is measured against the eight-character minimum. Returns the new id '
  '(0023).';

-- --- reading them ----------------------------------------------------------
-- Every argument an integer with a default, first statement the admin check,
-- fixed SELECT, no dynamic SQL: the shape db/test/admin_test.sql §0, §1 and
-- §2 enforce over every `public.admin\_%` function.
--
-- IT RETURNS THE REVIEW INLINE, which is what makes the Reported tab possible
-- in one round trip: `admin_reviews` is paginated over every review ever
-- written, so a reported review three thousand rows down is not on the page
-- the tab would be showing. A report and the thing it is about arrive
-- together or the tab has to guess.
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

  -- After the check, and clamped, for the reason 0020 §3 gives: a DECLARE runs
  -- first, and an argument touched before the check is an argument a stranger
  -- can raise a different SQLSTATE with.
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
           v.body,
           v.created_at,
           v.removed_by_admin_at,
           a.deleted_at
      from public.reports r
      -- The reporter and the resolver by HANDLE, never by id and never by
      -- address: the same rule admin_people follows.
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles rb on rb.id = r.resolved_by
      -- The review this is about, when it is about one. `target ~ '^[0-9]+$'`
      -- is a CHECK on the table for kind='review', so the cast is safe — and
      -- it is guarded anyway, because a cast that can raise inside a stable
      -- function is a panel that can 500 on one bad row.
      left join public.reviews v
             on r.kind = 'review'
            and r.target ~ '^[0-9]+$'
            and v.id = r.target::bigint
      left join public.tools t on t.id = v.tool_id
      left join public.profiles a on a.id = v.author_id
     -- Unresolved first, then newest first, which is the order the Reported
     -- tab reads in.
     order by (r.resolved_at is not null), r.created_at desc, r.id desc
     limit v_limit;
end;
$fn$;

comment on function public.admin_reports(int) is
  'Every report, unresolved first and newest first, with the review it is '
  'about inlined when it is about a review. Handles and never addresses, and '
  'not one column from a search table — db/test/admin_test.sql §2 puts '
  '`reports` on the people list so that a later panel joining the two fails '
  'the suite (0023).';

create or replace function public.admin_report_counts(p_days int default 30)
returns table (
  received bigint,
  open     bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_since timestamptz;
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  v_since := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 3650));

  -- TWO DIFFERENT WINDOWS ON PURPOSE, which is why this is its own function
  -- rather than two more columns on admin_words. "Received" is a rate and
  -- belongs to the window the panel is headed with; "open" is a backlog and
  -- has no window — a report filed a year ago and never resolved is still
  -- open, and a figure that hid it inside thirty days would be the opposite of
  -- what the number is for.
  return query
    select (select count(*) from public.reports r where r.created_at >= v_since)::bigint,
           (select count(*) from public.reports r where r.resolved_at is null)::bigint;
end;
$fn$;

comment on function public.admin_report_counts(int) is
  'How many reports arrived in the window, and how many are open right now — '
  'two different windows, because a backlog has none (0023).';

-- --- closing one -----------------------------------------------------------
create or replace function public.resolve_report(
  p_report_id  bigint,
  p_resolution text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
set "foundit.definer" = 'on'
as $fn$
declare
  v_admin text := auth.uid();
  v_note  text;
  v_done  boolean;
begin
  -- Its own check, in its own body, in the shape 0019 writes it. This function
  -- is granted to foundit_app, so the check is the only thing between the
  -- application and the table.
  if not auth.is_admin() then
    raise exception 'resolving a report is an administrator''s'
      using errcode = '42501';
  end if;

  v_note := nullif(btrim(public.strip_control_characters(coalesce(p_resolution, ''))), '');
  if v_note is not null and length(v_note) > 500 then
    v_note := left(v_note, 500);
  end if;

  -- `where resolved_at is null` is what makes this idempotent in the honest
  -- direction: resolving a resolved report is false rather than a second
  -- resolution that overwrites who closed it and when.
  update public.reports r
     set resolved_at = now(),
         resolved_by = v_admin,
         resolution  = v_note
   where r.id = p_report_id
     and r.resolved_at is null;

  get diagnostics v_done = row_count;
  return v_done;
end;
$fn$;

comment on function public.resolve_report(bigint, text) is
  'Mark one report resolved, by auth.uid(), with an optional note. False when '
  'the id is unknown or the report was already resolved — resolving twice must '
  'not overwrite who closed it (0023).';

-- --- grants ----------------------------------------------------------------
-- Execute on the three doors and nothing at all on the table. `revoke ... from
-- public` first, because a function is executable by PUBLIC by default and a
-- SECURITY DEFINER function that anybody may call is a hole with a check in it
-- rather than a door.
revoke execute on function public.file_report(text, text, text, text) from public;
revoke execute on function public.admin_reports(int) from public;
revoke execute on function public.admin_report_counts(int) from public;
revoke execute on function public.resolve_report(bigint, text) from public;

grant execute on function public.file_report(text, text, text, text) to foundit_app;
grant execute on function public.admin_reports(int) to foundit_app;
grant execute on function public.admin_report_counts(int) to foundit_app;
grant execute on function public.resolve_report(bigint, text) to foundit_app;

commit;
