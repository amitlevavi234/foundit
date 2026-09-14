-- ===========================================================================
-- 0028 — the application could not name the function it was granted
--
-- 0024 grants `foundit_app` EXECUTE on `infra.add_page_views` and
-- `infra.add_spend`, and then revokes everything on the schema they are in:
--
--     revoke all on schema infra from foundit_app;
--
-- which is what happens when a boundary is drawn from an intuition rather than
-- from the privilege system. EXECUTE says "you may run this function". USAGE
-- on a schema says "you may WRITE ITS NAME". Without the second, the first can
-- never be exercised, and every page view was:
--
--     ERR permission denied for schema infra
--
-- caught, logged as a warning by `recordPageViews`, and never counted — which
-- is exactly the failure mode `lib/db.ts` says fire-and-forget accepts, so
-- nothing broke and nothing was recorded either. db/test/panels_test.sql
-- asserted the revoke as if it were the boundary, so the suite agreed with the
-- mistake; §1 of that file now asserts the thing that IS the boundary.
--
-- ---------------------------------------------------------------------------
-- USAGE ON A SCHEMA IS NOT A DATA PRIVILEGE, which is the whole reason this is
-- safe. It grants no SELECT, no INSERT, no UPDATE, no DELETE and no reference
-- to any table in the schema; it grants the ability to resolve a qualified
-- name. With it and nothing else, `foundit_app` running
--
--     select * from infra.page_views_daily;
--
-- gets `permission denied for table page_views_daily`, and that is asserted in
-- both directions in db/test/panels_test.sql §1. The two SECURITY DEFINER
-- functions still run as the owner and are still the only way in.
--
-- `infra.ops_events` and `infra.record_ops_event` are untouched: that function
-- is granted to `foundit_owner` alone (0019 §1) and the application has no
-- business naming it. Granting USAGE does not change who may execute it.
--
-- AND THE DEFAULT FOR ANYTHING ADDED LATER IS STILL NOTHING. `alter default
-- privileges` is not used here on purpose — a table created in `infra`
-- tomorrow is readable by its owner and by nobody else, and a later migration
-- that wants the application to reach it has to say so, in writing, the way
-- 0024 said so for these two.
-- ===========================================================================
begin;

grant usage on schema infra to foundit_app;

-- The embedding worker connects as `foundit_embed` and writes the `worker`
-- rows of the spend ledger (scripts/embed-worker.mjs), so it needs to be able
-- to name the same function for the same reason.
grant usage on schema infra to foundit_embed;

-- Said again after the grant, so that the shape of this file is the whole
-- statement: a name they may write, and not one byte they may read.
revoke all on all tables in schema infra from foundit_app, foundit_embed;

comment on schema infra is
  'Tables that belong to the deployment rather than to a person: the migration '
  'ledger, the operations events, the page-view counter and the spend ledger. '
  'They carry no row-level security because every row is the deployment''s and '
  'a policy over them would have to be `true` (0019 §1). THE GRANT IS THE '
  'BOUNDARY: foundit_app and foundit_embed have USAGE, which lets them name '
  'the two SECURITY DEFINER writers they are granted EXECUTE on, and no '
  'privilege on any table in here at all (0024, 0028).';

commit;
