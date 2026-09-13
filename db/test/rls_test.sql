-- ===========================================================================
-- Does the database actually refuse what it should?
--
-- Run against a seeded development database. Every check raises an exception
-- on failure, so the script either finishes silently or stops at the first
-- problem. This runs in CI on every change.
--
-- It is written as tests of BEHAVIOUR — try the thing, see it refused —
-- rather than tests that a policy exists. A policy that exists and does not
-- work is exactly the failure mode we are guarding against.
--
-- IT LEAVES THE DATABASE EXACTLY AS IT FOUND IT.
--
-- Proving that a write is refused requires attempting the write, and some of
-- these checks have to make a write SUCCEED first — a claim has to exist
-- before "and now nobody else can claim it" means anything, and the search
-- log has to have a row in it before "an admin can read it" is a test rather
-- than a tautology. Left committed, those rows made the suite a one-shot: the
-- second run died on tool_claims_one_pending_per_person, and the development
-- catalogue quietly lost dev_person's reviews to a hard delete that was
-- supposed to be refused but was allowed to try. A test that can only be run
-- once against a given database is not a test you can put in CI.
--
-- So the whole suite runs inside ONE transaction that is ALWAYS rolled back.
-- Two things make that safe rather than a way of hiding failures:
--
--   * Every check still raises. ON_ERROR_STOP means psql abandons the file at
--     the first error and exits non-zero, and the abandoned transaction is
--     rolled back by the server on disconnect. A failure is as loud as it
--     ever was; the rollback swallows the rows, not the exception.
--
--   * The rollback is the last statement, after the success line. Reaching
--     it means every check passed.
--
-- Every check below therefore sees the writes made by the checks above it,
-- and nothing outside this transaction ever does. Run it as many times as you
-- like, in any order relative to anything else.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.be(p_user text)
returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  end if;
end;
$$;

create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'RLS TEST FAILED: %', msg;
end;
$$;

-- ===========================================================================
-- 1. Structural: no table may be left unguarded, and none may be left
--    unforced. The unforced case is the dangerous one — the owner bypasses
--    its own policies, so everything reads as protected and nothing is.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then
    perform pg_temp.fail('row level security is OFF on: ' || bad);
  end if;

  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relrowsecurity and not c.relforcerowsecurity;
  if bad is not null then
    perform pg_temp.fail('row level security is not FORCED on: ' || bad);
  end if;
end
$$;

-- No policy may be a blanket "always allow" on a table anyone can write to.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ') into bad
  from pg_policies
  where schemaname = 'public'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (qual = 'true' or with_check = 'true')
    -- search_events is written by the server on every search and holds
    -- nothing attributable to a person; its openness is deliberate.
    and tablename <> 'search_events';
  if bad is not null then
    perform pg_temp.fail('policy grants unconditional write: ' || bad);
  end if;
end
$$;

-- ===========================================================================
-- 1b. research/03 §9 items 1 and 2, WORD FOR WORD (Phase 9a, gate item 9)
--
-- The checklist's first two items are the two queries below, and each is
-- required to return ZERO ROWS. They overlap with the checks above and are
-- written out separately anyway, for three reasons:
--
--   * ITEM 2 IS BROADER THAN THE CHECK ABOVE. That one exempts SELECT — a
--     read policy of `true` is how a public table is published — and exempts
--     `search_events` by name. Item 2 exempts nothing at all. A blanket rule
--     with a list of exceptions is only honest while somebody is reading the
--     list, so here the list is TWO NAMES, written down, and anything else
--     fails. A third `true` policy is then a decision somebody makes in a diff
--     rather than a line that slips under an existing exemption.
--
--   * docs/launch-checklist.md cites this block as the evidence for items 1
--     and 2, and evidence should be the thing the checklist asked for rather
--     than something close to it.
--
--   * The queries in the checklist are Supabase-flavoured only in that they
--     assume a `public` schema and row-level security. Both are true here, so
--     these two translate with no adaptation at all — which is worth saying,
--     because most of the other thirty-eight do not.
--
-- THE TWO EXCEPTIONS, AND WHY EACH IS SAFE:
--
--   categories.categories_read (SELECT, qual = true)
--     The category list is the site's navigation. It is on the home page, in
--     the footer and in /browse, for everybody, signed in or not. There is
--     nothing in the table but a name, a slug and a sort order; a policy that
--     narrowed it would be narrowing access to a menu.
--
--   search_events.search_events_insert (INSERT, with_check = true)
--     The server writes one row per search, for everybody, including
--     strangers. The row carries no user column and cannot be given one
--     (0002 and db/test/search_events_test.sql), so an unconditional INSERT
--     grants the ability to add an unattributable row to an aggregate — and
--     the SELECT side of the same table is admin-only, which is the half that
--     matters. Making this conditional would mean conditioning it on an
--     identity, which is precisely the join this product does not make.
-- ===========================================================================
do $$
declare bad text;
begin
  -- ITEM 1: "RLS is enabled on every table in public." Zero rows.
  select string_agg(tablename, ', ') into bad
  from pg_tables
  where schemaname = 'public' and rowsecurity = false;
  if bad is not null then
    perform pg_temp.fail('research/03 §9 item 1 — rowsecurity = false on: ' || bad);
  end if;

  -- ITEM 2: "Every RLS-enabled table has at least one policy..."
  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = c.relname);
  if bad is not null then
    -- A table with row-level security ON and NO POLICY denies everything to
    -- everybody except a superuser. That is safe and almost never intended:
    -- it is what a half-finished migration leaves behind, and it fails as a
    -- silently empty page rather than as an error.
    perform pg_temp.fail(
      'research/03 §9 item 2 — row-level security is on with no policy at all on: ' || bad);
  end if;

  -- ITEM 2, second half: "...and none of them is `true`", with the two named
  -- exceptions above and no others.
  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ') into bad
  from pg_policies
  where schemaname = 'public'
    and (qual = 'true' or with_check = 'true')
    and not (tablename = 'categories'    and policyname = 'categories_read')
    and not (tablename = 'search_events' and policyname = 'search_events_insert');
  if bad is not null then
    perform pg_temp.fail(
      'research/03 §9 item 2 — a policy evaluates to true and is not one of the two '
      || 'exceptions named in db/test/rls_test.sql: ' || bad);
  end if;

  -- And the exceptions must still BE there. A test whose whole content is an
  -- exemption list passes trivially the day somebody deletes the thing it
  -- exempts and replaces it with something else.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'categories'
                    and policyname = 'categories_read' and qual = 'true') then
    perform pg_temp.fail(
      'categories_read is no longer the public read policy this file exempts — '
      || 'check whether the exemption list is still describing this schema');
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'search_events'
                    and policyname = 'search_events_insert' and with_check = 'true') then
    perform pg_temp.fail(
      'search_events_insert is no longer the unconditional insert this file exempts — '
      || 'check whether the exemption list is still describing this schema');
  end if;
end
$$;

-- The application must not connect as a role that ignores all of the above.
do $$
declare r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = 'foundit_app';
  if not found then
    perform pg_temp.fail('role foundit_app does not exist');
  end if;
  if r.rolsuper then
    perform pg_temp.fail('foundit_app is a superuser and bypasses every policy');
  end if;
  if r.rolbypassrls then
    perform pg_temp.fail('foundit_app has BYPASSRLS and ignores every policy');
  end if;
end
$$;

-- ===========================================================================
-- Everything below runs AS the application role, which is the only way these
-- policies are ever exercised in real life.
-- ===========================================================================
set role foundit_app;

-- 2. A stranger reads published tools and nothing else --------------------
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  select count(*) into n from public.tools;
  if n = 0 then
    perform pg_temp.fail('a stranger cannot see any published tool');
  end if;

  select count(*) into n from public.tools where status = 'draft';
  if n > 0 then
    perform pg_temp.fail('a stranger can see draft tools');
  end if;

  select count(*) into n from public.search_events;
  if n > 0 then
    perform pg_temp.fail('a stranger can read the search log');
  end if;
end
$$;

-- 3. A stranger writes nothing --------------------------------------------
do $$
begin
  perform pg_temp.be(null);
  begin
    insert into public.tools (slug, name, url, summary, pricing, submitted_by)
    values ('stranger-tool', 'Stranger', 'https://stranger.example',
            'A tool added by nobody at all, which must never be possible.',
            'free', null);
    perform pg_temp.fail('a stranger added a tool');
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.reviews (tool_id, author_id, rating)
    select id, 'dev_person', 1 from public.tools where slug::text = 'tabsplit';
    perform pg_temp.fail('a stranger wrote a review');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 4. Nobody may add a tool credited to somebody else -----------------------
do $$
begin
  perform pg_temp.be('dev_person');
  begin
    insert into public.tools (slug, name, url, summary, pricing, submitted_by)
    values ('stolen-credit', 'Stolen', 'https://stolen.example',
            'A tool credited to a different person than the one adding it.',
            'free', 'dev_maker');
    perform pg_temp.fail('a tool was added credited to someone else');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 5. THE ONE THAT MATTERS MOST -------------------------------------------
-- A review belongs to whoever wrote it. Not to the tool's owner, not to
-- another user, not to anyone. Cupboard is owned by dev_maker; the review on
-- Receiptly is written by dev_person. dev_maker owns Receiptly and must still
-- be unable to touch that review.
do $$
declare n integer;
begin
  perform pg_temp.be('dev_maker');

  update public.reviews r
     set body = 'edited by the tool owner'
    from public.tools t
   where r.tool_id = t.id and t.slug::text = 'receiptly' and r.author_id = 'dev_person';
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_temp.fail('the tool owner edited someone else''s review');
  end if;

  update public.reviews r
     set deleted_at = now()
    from public.tools t
   where r.tool_id = t.id and t.slug::text = 'receiptly' and r.author_id = 'dev_person';
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_temp.fail('the tool owner deleted someone else''s review');
  end if;

  begin
    delete from public.reviews where author_id = 'dev_person';
    perform pg_temp.fail('a review was hard-deleted by someone who did not write it');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 6. A maintainer edits their own listing, and only their own -------------
do $$
declare n integer;
begin
  perform pg_temp.be('dev_maker');

  update public.tools set summary = summary where slug::text = 'receiptly';
  get diagnostics n = row_count;
  if n <> 1 then
    perform pg_temp.fail('the maintainer could not edit their own listing');
  end if;

  update public.tools set summary = 'hijacked' where slug::text = 'tabsplit';
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_temp.fail('a maintainer edited a listing that is not theirs');
  end if;
end
$$;

-- 7. Private collections stay private -------------------------------------
do $$
declare n integer;
begin
  perform pg_temp.be('dev_maker');
  select count(*) into n from public.collections where slug::text = 'quiet-mornings';
  if n > 0 then
    perform pg_temp.fail('someone else read a private collection');
  end if;

  perform pg_temp.be('dev_person');
  select count(*) into n from public.collections where slug::text = 'quiet-mornings';
  if n <> 1 then
    perform pg_temp.fail('the owner cannot read their own private collection');
  end if;
end
$$;

-- 8. Only seeded listings can be claimed -----------------------------------
do $$
begin
  perform pg_temp.be('dev_person');

  insert into public.tool_claims (tool_id, claimant_id)
  select id, 'dev_person' from public.tools where slug::text = 'tabsplit';

  begin
    insert into public.tool_claims (tool_id, claimant_id)
    select id, 'dev_person' from public.tools where slug::text = 'receiptly';
    perform pg_temp.fail('a listing added by a person was claimable by someone else');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 9. An admin can read the search log; nobody else can ---------------------
do $$
declare n integer;
begin
  -- `match_judged` joined this row in 0010. It is not what this check is about
  -- — the subject here is who may READ the log — but the CHECK added with that
  -- column refuses `had_good_match` without it, on purpose: "not judged but
  -- good" is not a state the definition in docs/product-decisions.md §17 can
  -- produce. So the fixture says both, which is what the application now
  -- writes.
  insert into public.search_events
    (query_text, query_hash, result_count, had_good_match, match_judged)
  values ('a test query', 'hash-test', 3, true, true);

  perform pg_temp.be('dev_person');
  select count(*) into n from public.search_events;
  if n > 0 then
    perform pg_temp.fail('an ordinary user read the search log');
  end if;

  perform pg_temp.be('dev_admin');
  select count(*) into n from public.search_events;
  if n = 0 then
    perform pg_temp.fail('an admin cannot read the search log');
  end if;
end
$$;

reset role;

select 'All row-level security checks passed.' as result;

-- Nothing this file did survives it. Reached only when every check above
-- passed; a failure gets here by another route — psql stops on the error and
-- the server rolls the transaction back when the connection closes — and
-- either way the database is as it was.
rollback;
