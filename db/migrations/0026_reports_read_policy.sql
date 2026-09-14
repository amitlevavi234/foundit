-- ===========================================================================
-- 0026 — admin_reports could not see the reports
--
-- 0023 gave `public.reports` one policy: `reports_definer`, the owner's window
-- from 0020 §2, gated on the `foundit.definer` setting. `file_report` and
-- `resolve_report` both carry `SET "foundit.definer" = 'on'`, so both could
-- write. `admin_reports` and `admin_report_counts` do not — and row-level
-- security FILTERS rather than refusing, so they read nothing, silently, and
-- the Reported tab was empty with no error anywhere. db/test/reports_test.sql
-- §4 caught it: four reports filed, four rows expected, zero returned.
--
-- THE FIX IS THE POLICY THE REST OF THE SCHEMA ALREADY USES, not the window.
-- `public.reviews` has carried `reviews_read` since 0001:
--
--     using ((deleted_at is null) or (author_id = auth.uid()) or auth.is_admin())
--
-- — a policy `to public` whose qualifier is a real question, which is why
-- `admin_reviews` can read a review as the owner without opening anything.
-- The same shape here, minus the two clauses that have no meaning for a
-- report: an administrator may read reports, and nobody else may.
--
-- WHY NOT JUST GIVE THE TWO PANELS THE WINDOW. Because the window reaches past
-- EVERY policy in `public` for the length of the call, which is why
-- db/test/admin_test.sql §11 keeps a written list of what has it and calls
-- acquiring it "a decision, not a detail". A panel that needs to read one
-- table does not need that, and a SELECT policy gated on `auth.is_admin()` is
-- strictly less power than the alternative. So the list is not extended and
-- this is.
--
-- WHAT DOES NOT CHANGE. `foundit_app` still has no table privilege of any kind
-- on `public.reports` — not select, not insert, not update, not delete — so a
-- policy that says "an administrator may read" does not let the application
-- read: a privilege check comes first and refuses with 42501 before any policy
-- is evaluated. The three definer functions are still the only doors.
-- db/test/reports_test.sql §0 and §1 assert both halves.
-- ===========================================================================
begin;

create policy reports_admin_read on public.reports
  for select
  using (auth.is_admin());

comment on policy reports_admin_read on public.reports is
  'An administrator may read reports; nobody else may. It exists so that '
  'public.admin_reports and public.admin_report_counts — SECURITY DEFINER '
  'functions running as the owner, which is NOSUPERUSER NOBYPASSRLS — can see '
  'the rows at all. It grants the application nothing: foundit_app has no '
  'table privilege on public.reports and a privilege check refuses before a '
  'policy is consulted (0026).';

commit;
