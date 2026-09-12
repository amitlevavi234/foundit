-- ===========================================================================
-- Foundit — 0016_deletion_marker
--
-- One table, for the Phase 6 review's F8.
--
-- THE WINDOW IT CLOSES. Closing an account spans two schemas reached by two
-- roles through two pools, and PostgreSQL cannot make that one transaction, so
-- lib/deletion.ts chooses an ORDER by what a half-completed deletion leaves
-- behind. Sessions go first, which closes the window where the profile is gone
-- and a live cookie could create a new one. The review found the mirror of it:
-- if a step AFTER the public rows fails, `auth_core."user"` and the Google
-- `account` row survive with the profile already gone — so the person signs in
-- again with the same Google account, `ensureProfile` makes them a fresh
-- profile from the same user id, and the account they closed comes back as an
-- empty shell.
--
-- THE FIX IS A MARKER RATHER THAN A REORDER. The other option was to delete the
-- user row before the public rows, which closes the re-animation and opens a
-- worse one: a failure would then leave a profile, reviews, likes and saved
-- lists behind with no account able to reach them and nobody able to retry.
-- Personal data that outlives the promise to delete it is a bigger failure than
-- an empty shell.
--
-- So: a row is written here BEFORE anything of the person's is deleted, and it
-- is removed by the LAST step of a run that got all the way through.
-- `ensureProfile` asks this table first and refuses to create a profile for an
-- id that carries a marker, so a deletion that stopped half way cannot be
-- re-animated by signing in — and, because the marker goes with the last step,
-- a deletion that finished leaves nothing at all, including here. That matters:
-- the phase's own gate is "paste a select across every table showing zero rows
-- for that id", and a marker left behind for ever would be a row for that id.
--
-- WHY IT IS IN auth_core AND NOT IN public. It is about an account rather than
-- about a person's content; `ensureProfile` has to be able to ask BEFORE a
-- profile exists; and `foundit_app` holds nothing in this schema, which is the
-- boundary 0013 exists to draw and this does not cross — the question is asked
-- on the auth pool, as foundit_auth, exactly like every other question about an
-- account.
--
-- The identifiers are lower case and unquoted, unlike the five tables beside
-- them. Those are Better Auth's and are spelled the way its adapter builds its
-- SQL; this one is ours, and the difference is worth being able to see.
-- ===========================================================================

begin;

create table if not exists auth_core.deletions (
  user_id    text primary key,
  started_at timestamptz not null default now()
);

comment on table auth_core.deletions is
  'Accounts whose deletion has started and not finished. Written before the '
  'first row of theirs is removed and deleted by the last step of a run that '
  'completed, so a row here means "a deletion stopped half way" and nothing '
  'else. lib/accounts.ts refuses to create a profile for an id that is in it: '
  'without that, a failure after the public rows left an account that could '
  'sign in again and be handed a fresh, empty profile — the account somebody '
  'closed, re-animated.';

comment on column auth_core.deletions.user_id is
  'The Better Auth user id. No foreign key to auth_core."user" on purpose: the '
  'row has to outlive that one, because the failure it guards against is '
  'exactly the case where the user row survives and then goes.';

-- No RLS here, for the reason 0013 gives about the rest of this schema: it is
-- not shared. One role reads and writes all of it, a policy expressing that
-- would have to evaluate to `true`, and the boundary is the GRANT.
grant select, insert, delete on auth_core.deletions to foundit_auth;

commit;
