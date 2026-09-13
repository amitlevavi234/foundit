-- ===========================================================================
-- The roles a DEVELOPMENT container starts with.
--
-- Mounted into /docker-entrypoint-initdb.d by db/docker-compose.dev.yml and
-- run exactly once, as the `postgres` superuser, on an empty ./db/.data —
-- before any migration. `.github/workflows/ci.yml` runs the same statements
-- against its service container, for the same reason and in the same order.
--
-- WHY THIS IS A FILE RATHER THAN AN INLINE `configs:` BLOCK. Docker Compose
-- interpolates `$` in config content, so `do $$ ... $$` reached PostgreSQL as
-- `do $ ... $` and the container refused to start with a syntax error. A file
-- mounted as a volume is passed through byte for byte.
--
-- NOTHING HERE GRANTS ANYTHING ON A TABLE. What each role may do is decided
-- by the migrations, which are the same files that run on the server; a grant
-- that existed only in development would be a difference between the two
-- environments that nothing tests.
-- ===========================================================================

-- The three extensions, created here because ONE OF THEM CANNOT BE CREATED BY
-- THE OWNER. citext and pg_trgm are trusted extensions and any role with
-- CREATE on the database may install them; `vector` is not
-- (pg_available_extension_versions.trusted is false), so 0001_init.sql's
-- `create extension if not exists vector` succeeds for a non-superuser
-- foundit_owner only because it is already here and the statement is then a
-- no-op that returns before it checks a privilege. Making the owner
-- non-superuser is exactly what makes these three lines load-bearing.
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists vector;

do $$
begin
  -- THE OWNER IS NOT A SUPERUSER AND DOES NOT BYPASS ROW-LEVEL SECURITY.
  -- 13 September 2026, and the Phase 8 review is why: public.record_tool_open
  -- moved no counter at all on a database whose owner is not a superuser, and
  -- db/test/admin_test.sql could not see it because the suite ran as one.
  -- research/08 §9.3 has described this layout since before Phase 1.
  --
  -- CREATEROLE because 0001, 0005 and 0013 create the application roles when
  -- they are not already there, and 0003 and 0013 run `alter role ... set
  -- statement_timeout`. Both are refused to a plain role.
  if exists (select 1 from pg_roles where rolname = 'foundit_owner') then
    alter role foundit_owner login noinherit nosuperuser nobypassrls
      createrole password 'local_development_only';
  else
    create role foundit_owner login noinherit nosuperuser nobypassrls
      createrole password 'local_development_only';
  end if;

  -- 0001_init.sql creates foundit_app if it is not already there, and creates
  -- it with NO PASSWORD, so on its own there is no way to connect as the
  -- application role at all. Development then measures everything as the
  -- owner, which is how a search baseline came to be recorded at roughly a
  -- third of the latency the application will ever see.
  if exists (select 1 from pg_roles where rolname = 'foundit_app') then
    alter role foundit_app login noinherit password 'local_development_only_app';
  else
    create role foundit_app login noinherit password 'local_development_only_app';
  end if;

  if exists (select 1 from pg_roles where rolname = 'foundit_embed') then
    alter role foundit_embed login noinherit password 'local_development_only_embed';
  else
    create role foundit_embed login noinherit password 'local_development_only_embed';
  end if;

  if exists (select 1 from pg_roles where rolname = 'foundit_auth') then
    alter role foundit_auth login noinherit password 'local_development_only_auth';
  else
    create role foundit_auth login noinherit password 'local_development_only_auth';
  end if;
end
$$;

-- The owner owns. Every schema, table, policy and function a migration
-- creates has to belong to foundit_owner rather than to postgres, because a
-- SECURITY DEFINER function owned by a superuser is an authorisation bypass
-- wearing a helpful hat — which is the sentence 0017 §6 and 0018 both already
-- carry, written when it was still true here.
-- `current_database()` rather than the literal `foundit`, because ALTER
-- DATABASE takes a name and this file is run against whatever database the
-- entrypoint or the workflow pointed it at. A hardcoded name here re-owned a
-- different database and left this one with no owner privileges at all, which
-- is a failure that looks like a migration bug three steps later.
do $$
begin
  execute format('alter database %I owner to foundit_owner', current_database());
end
$$;

alter schema public owner to foundit_owner;

-- db/test.sh connects as the owner and switches into each application role to
-- watch that role be refused. SET ROLE needs membership, which superuser used
-- to supply for free.
--
-- WITH INHERIT FALSE is the whole point: membership lets the owner SET ROLE,
-- and nothing else. Without it the owner would hold foundit_app's privileges,
-- and any row-level security policy scoped TO foundit_app would begin
-- applying to owner sessions as well — the opposite of what a non-superuser
-- owner is for.
--
-- WITH ADMIN OPTION because 0003 runs `alter role foundit_app set
-- statement_timeout` and 0013 runs `alter role foundit_auth set search_path`,
-- which a non-superuser may only do for a role it administers.
grant foundit_app   to foundit_owner with inherit false, admin option;
grant foundit_embed to foundit_owner with inherit false, admin option;
grant foundit_auth  to foundit_owner with inherit false, admin option;

-- THE ONE PARAMETER A MIGRATION HAS TO BE ABLE TO ATTACH TO A FUNCTION.
--
-- 0020 §2 gives twenty-odd SECURITY DEFINER functions a `SET
-- "foundit.definer" = 'on'` clause, which is what opens the row-level
-- security window they need and — because PostgreSQL restores a function's
-- SET clause on exit, including on an exception — what closes it again.
-- `foundit.definer` is a custom parameter no extension has registered, and
-- PostgreSQL requires either superuser or an explicit parameter privilege to
-- write one into a catalogue entry.
--
-- THIS GRANTS NO RUNTIME POWER THE OWNER DID NOT ALREADY HAVE. A custom
-- parameter is PGC_USERSET, so any role could always `set_config` it inside a
-- transaction — which is exactly how 0014's `foundit.counters` window works
-- and has worked since Phase 6. What the privilege covers is only the
-- persisted form: ALTER FUNCTION / ALTER ROLE / ALTER DATABASE ... SET.
grant set on parameter "foundit.definer" to foundit_owner;
