-- ===========================================================================
-- Phase 6 — does the database refuse what accounts make possible?
--
-- Written before the screens, which is the phase's first non-negotiable. Every
-- check is behavioural: try the thing, watch it be refused. A policy that
-- exists and does not work is exactly the failure this file is for.
--
-- IT LEAVES THE DATABASE EXACTLY AS IT FOUND IT, the same way rls_test.sql
-- does and for the same reasons: the whole suite runs inside ONE transaction
-- that is ALWAYS rolled back, every check still raises, and the rollback is
-- the last statement so reaching it means everything passed. That matters more
-- here than anywhere else, because the last section of this file deletes an
-- account.
--
-- The seeded people, from db/seed/dev_seed.sql:
--
--   dev_person  @tomer  wrote the reviews on receiptly, tabsplit, quietroom,
--                       splitwise; owns both collections
--   dev_maker   @priya  MAINTAINS receiptly — so they are the tool's owner
--                       standing over somebody else's review of it, which is
--                       the case docs/build-phases.md puts in bold
--   dev_admin   @amit   is_admin
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
  perform set_config('request.share_token', '', true);
end;
$$;

/** A claim exactly as given — including nonsense, which is the point. */
create or replace function pg_temp.claim_raw(p_raw text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', p_raw, true);
  perform set_config('request.share_token', '', true);
end;
$$;

create or replace function pg_temp.holding(p_token text)
returns void language plpgsql as $$
begin
  perform set_config('request.share_token', coalesce(p_token, ''), true);
end;
$$;

create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'ACCOUNTS TEST FAILED: %', msg;
end;
$$;

create or replace function pg_temp.review_of(p_slug text, p_author text)
returns bigint language sql stable as $$
  select r.id from public.reviews r
    join public.tools t on t.id = r.tool_id
   where t.slug::text = p_slug and r.author_id = p_author
   order by r.id limit 1;
$$;

-- ===========================================================================
-- 1. The two roles cannot reach each other's tables
--
-- This is the whole of the separation. There is no row-level security on
-- auth_core — it has one reader and one writer and a policy there would have
-- to say `true` — so the GRANT is the boundary, and a boundary made of grants
-- is only as good as the test that reads them back.
-- ===========================================================================
do $$
declare r record; bad text;
begin
  select rolsuper, rolbypassrls, rolcanlogin into r
    from pg_roles where rolname = 'foundit_auth';
  if not found then perform pg_temp.fail('role foundit_auth does not exist'); end if;
  if r.rolsuper      then perform pg_temp.fail('foundit_auth is a superuser'); end if;
  if r.rolbypassrls  then perform pg_temp.fail('foundit_auth has BYPASSRLS'); end if;
  if not r.rolcanlogin then perform pg_temp.fail('foundit_auth cannot log in'); end if;

  -- Better Auth's five tables, and the four verbs its adapter uses.
  select string_agg(t.name || ':' || v.verb, ', ') into bad
    from (values ('user'), ('session'), ('account'), ('verification'), ('rateLimit')) t(name),
         (values ('select'), ('insert'), ('update'), ('delete')) v(verb)
   where not has_table_privilege('foundit_auth', format('auth_core.%I', t.name), v.verb);
  if bad is not null then
    perform pg_temp.fail('foundit_auth is missing grants it needs: ' || bad);
  end if;

  -- And nothing at all in public, for either of the application's roles in
  -- auth_core. Views and sequences included: a grant on a view is a grant on
  -- what the view reads.
  select string_agg(format('%s on %s.%s', g.role, c.relnamespace::regnamespace, c.relname), ', ')
    into bad
    from pg_class c
    cross join (values ('foundit_app'), ('foundit_embed')) g(role)
   where c.relnamespace = 'auth_core'::regnamespace
     and c.relkind in ('r', 'v', 'm', 'p')
     and (has_table_privilege(g.role, c.oid, 'select')
       or has_table_privilege(g.role, c.oid, 'insert')
       or has_table_privilege(g.role, c.oid, 'update')
       or has_table_privilege(g.role, c.oid, 'delete'));
  if bad is not null then
    perform pg_temp.fail('an application role can reach Better Auth''s tables: ' || bad);
  end if;

  select string_agg(format('foundit_auth on %s', c.relname), ', ') into bad
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'v', 'm', 'p')
     and (has_table_privilege('foundit_auth', c.oid, 'select')
       or has_table_privilege('foundit_auth', c.oid, 'insert')
       or has_table_privilege('foundit_auth', c.oid, 'update')
       or has_table_privilege('foundit_auth', c.oid, 'delete'));
  if bad is not null then
    perform pg_temp.fail('foundit_auth can reach the application''s tables: ' || bad);
  end if;

  if has_schema_privilege('foundit_auth', 'public', 'usage') then
    perform pg_temp.fail('foundit_auth has USAGE on schema public');
  end if;
  if has_schema_privilege('foundit_app', 'auth_core', 'usage') then
    perform pg_temp.fail('foundit_app has USAGE on schema auth_core');
  end if;
end
$$;

-- ===========================================================================
-- Everything below runs AS the application role. That is the only way these
-- policies are ever exercised in real life, and running them as the owner —
-- who bypasses nothing here only because every table is FORCED — would prove
-- nothing about the application.
-- ===========================================================================
set role foundit_app;

-- ===========================================================================
-- 2. Fails closed: four ways of not being signed in, all the same answer
--
-- Absent, empty, nonsense, and a claim for somebody who no longer exists. The
-- fourth is checked again at the very end of this file, against an account
-- that has genuinely just been deleted; this one is the shape of it.
-- ===========================================================================
do $$
declare n integer; uid text;
begin
  -- (a) Never set at all. The setting does not exist on this connection.
  perform set_config('request.jwt.claims', '', true);
  reset request.jwt.claims;
  select auth.uid() into uid;
  if uid is not null then perform pg_temp.fail('an unset claim is somebody'); end if;

  -- (b) Empty.
  perform pg_temp.claim_raw('');
  select auth.uid() into uid;
  if uid is not null then perform pg_temp.fail('an empty claim is somebody'); end if;

  -- (c) Malformed. The failure mode this has to avoid is an EXCEPTION out of
  -- a policy, which is a 500 where a signed-out page belongs.
  foreach uid in array array['nonsense', '{', '[1,2]', 'true', '"sub"', '{"sub":null}', '{"nope":1}']
  loop
    perform pg_temp.claim_raw(uid);
    begin
      if auth.uid() is not null then
        perform pg_temp.fail(format('the malformed claim %L is somebody', uid));
      end if;
      select count(*) into n from public.collections;
      if n > 0 then
        perform pg_temp.fail(format('the malformed claim %L read a collection', uid));
      end if;
    exception when others then
      perform pg_temp.fail(format('the malformed claim %L raised %s instead of being nobody',
                                  uid, sqlerrm));
    end;
  end loop;

  -- (d) A claim for an id no profile has.
  perform pg_temp.be('nobody_at_all');
  if auth.is_admin() then perform pg_temp.fail('a stranger is an admin'); end if;
  select count(*) into n from public.collections;
  if n > 0 then perform pg_temp.fail('a stranger read a collection'); end if;
  select count(*) into n from public.tool_likes;
  if n > 0 then perform pg_temp.fail('a stranger read somebody''s likes'); end if;
end
$$;

-- And none of the four can write. The grant stops most of it and the policy
-- stops the rest; both are checked because either one alone is one mistake
-- away from being the only one.
do $$
declare n integer;
begin
  perform pg_temp.be(null);
  begin
    insert into public.tool_likes (user_id, tool_id)
    select 'dev_person', id from public.tools where slug::text = 'tabsplit';
    perform pg_temp.fail('a stranger liked something as somebody else');
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.collections (owner_id, name, slug)
    values ('dev_person', 'Theirs now', 'theirs-now');
    perform pg_temp.fail('a stranger made a collection for somebody else');
  exception when insufficient_privilege then null;
  end;

  update public.profiles set display_name = 'renamed by nobody' where id = 'dev_person';
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('a stranger renamed somebody'); end if;

  delete from public.profiles where id = 'dev_person';
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('a stranger deleted an account'); end if;
end
$$;

-- ===========================================================================
-- 3. Likes and saves are private to the person who made them
--
-- The counts are public — tools.like_count, maintained by trigger — and the
-- attribution is not. This catalogue lists tools for leaving somebody, hiding
-- money and managing an illness; a per-person like list is the same harm
-- search_events exists to prevent, arriving already attached to a name.
-- ===========================================================================
do $$
declare n integer;
begin
  perform pg_temp.be('dev_maker');
  select count(*) into n from public.tool_likes where user_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('one person read another''s likes'); end if;

  select count(*) into n from public.tool_likes where user_id = 'dev_maker';
  if n = 0 then perform pg_temp.fail('a person cannot read their own likes'); end if;

  -- A like is yours or it is nobody's.
  begin
    insert into public.tool_likes (user_id, tool_id)
    select 'dev_person', id from public.tools where slug::text = 'obsidian';
    perform pg_temp.fail('a like was written in somebody else''s name');
  exception when insufficient_privilege then null;
  end;

  delete from public.tool_likes where user_id = 'dev_person';
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('one person unliked another''s like'); end if;

  -- An admin still sees them, which is what the operator dashboard's "likes
  -- given" column is, and nobody else does.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.tool_likes where user_id = 'dev_person';
  if n = 0 then perform pg_temp.fail('an admin cannot see a person''s public activity'); end if;
end
$$;

-- ===========================================================================
-- 4. A shared collection is readable by whoever holds the link. Nobody else.
--
-- Not "public": there is no public. The token IS the permission, so the test
-- is that the same row is invisible without it, invisible with a wrong one,
-- and visible with the right one — to a signed-out stranger, because that is
-- who opens a link somebody sent them.
-- ===========================================================================
do $$
declare n integer; tok text; other text;
begin
  select share_token into tok from public.collections where slug::text = 'trip-to-greece';
  if tok is null then
    perform pg_temp.fail('the seeded shared collection has no token to test with');
  end if;
  other := translate(tok, '0123456789abcdef', 'fedcba9876543210');

  perform pg_temp.be(null);

  select count(*) into n from public.collections where slug::text = 'trip-to-greece';
  if n > 0 then perform pg_temp.fail('a shared collection was readable with no token'); end if;

  perform pg_temp.holding(other);
  select count(*) into n from public.collections where slug::text = 'trip-to-greece';
  if n > 0 then perform pg_temp.fail('a wrong token opened a collection'); end if;

  perform pg_temp.holding(tok);
  select count(*) into n from public.collections where slug::text = 'trip-to-greece';
  if n <> 1 then perform pg_temp.fail('the right token did not open the collection'); end if;

  select count(*) into n from public.collection_items ci
    join public.collections c on c.id = ci.collection_id
   where c.slug::text = 'trip-to-greece';
  if n = 0 then perform pg_temp.fail('the collection opened and its items did not'); end if;

  -- Holding one token does not open the OTHER collection, shared or not.
  select count(*) into n from public.collections where slug::text = 'quiet-mornings';
  if n > 0 then perform pg_temp.fail('a token opened a collection it is not for'); end if;

  -- And a link is read-only. The person holding it can change nothing.
  begin
    update public.collections set name = 'mine now' where slug::text = 'trip-to-greece';
    if found then perform pg_temp.fail('a link holder renamed a collection'); end if;
  exception when insufficient_privilege then null;
  end;

  -- Revoking is setting the token back to null, and the old link dies with it.
  perform pg_temp.be('dev_person');
  update public.collections set share_token = null, is_public = false
   where slug::text = 'trip-to-greece';
  perform pg_temp.be(null);
  perform pg_temp.holding(tok);
  select count(*) into n from public.collections where slug::text = 'trip-to-greece';
  if n > 0 then perform pg_temp.fail('a revoked link still opened the collection'); end if;

  -- Put it back for the sections below.
  perform pg_temp.be('dev_person');
  update public.collections set share_token = tok, is_public = true
   where slug::text = 'trip-to-greece';
end
$$;

-- A private collection stays private however much a stranger guesses.
do $$
declare n integer; cid bigint; tid bigint;
begin
  -- The id is read as its owner and then used as a literal, because a SELECT
  -- that returns nothing inserts nothing and would pass this test without
  -- anything being refused.
  perform pg_temp.be('dev_person');
  select id into cid from public.collections where slug::text = 'quiet-mornings';
  select id into tid from public.tools where slug::text = 'anki';
  if cid is null then perform pg_temp.fail('the seeded private collection is missing'); end if;

  perform pg_temp.be('dev_maker');
  select count(*) into n from public.collections where owner_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('one person listed another''s collections'); end if;

  begin
    insert into public.collection_items (collection_id, tool_id) values (cid, tid);
    perform pg_temp.fail('one person saved into another''s collection');
  exception when insufficient_privilege then null;
  end;

  delete from public.collection_items where collection_id = cid;
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('one person emptied another''s collection'); end if;
end
$$;

-- ===========================================================================
-- 5. THE ONE docs/build-phases.md PUTS IN BOLD
--
-- Nobody may ever edit or delete another person's review, and there is a test
-- that tries it as the tool's owner. dev_maker maintains receiptly. The review
-- on receiptly is dev_person's. Every attempt below is dev_maker's.
-- ===========================================================================
do $$
declare n integer; rid bigint;
begin
  rid := pg_temp.review_of('receiptly', 'dev_person');
  if rid is null then perform pg_temp.fail('the seeded review is missing'); end if;

  perform pg_temp.be('dev_maker');

  -- The owner can edit their listing — established, and the contrast is the
  -- point of the three that follow.
  update public.tools set summary = summary where slug::text = 'receiptly';
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the maintainer cannot edit their own listing'); end if;

  update public.reviews set body = 'edited by the tool owner' where id = rid;
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('the tool owner edited a review of their listing'); end if;

  update public.reviews set rating = 5 where id = rid;
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('the tool owner changed a rating on their listing'); end if;

  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('the tool owner removed a review of their listing'); end if;

  begin
    delete from public.reviews where id = rid;
    perform pg_temp.fail('the tool owner hard-deleted a review');
  exception when insufficient_privilege then null;
  end;

  -- Nor may the owner record a removal reason and try again: writing the
  -- reason is an admin's right too.
  begin
    insert into public.review_removals (review_id, admin_id, reason)
    values (rid, 'dev_maker', 'I do not think this is fair to my listing.');
    perform pg_temp.fail('the tool owner recorded a removal reason');
  exception when insufficient_privilege then null;
  end;

  -- And an ordinary stranger to the review gets no further.
  perform pg_temp.be('nobody_at_all');
  update public.reviews set body = 'edited by a passer-by' where id = rid;
  get diagnostics n = row_count;
  if n > 0 then perform pg_temp.fail('somebody unrelated edited a review'); end if;
end
$$;

-- The author, on the other hand, owns it completely.
do $$
declare n integer; rid bigint;
begin
  rid := pg_temp.review_of('receiptly', 'dev_person');
  perform pg_temp.be('dev_person');

  update public.reviews set body = 'Second thoughts: the splitting screen grew on me.'
   where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the author cannot edit their own review'); end if;

  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the author cannot take their own review down'); end if;

  update public.reviews set deleted_at = null where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the author cannot put their own review back'); end if;
end
$$;

-- ===========================================================================
-- 6. An admin removes a review, whole, with the reason recorded — and cannot
--    change a word of it
--
-- docs/product-decisions.md §4, amended 11 September 2026. Removing is not
-- editing, and this is the section that makes the difference mechanical.
-- ===========================================================================
do $$
declare n integer; rid bigint; body_before text;
begin
  rid := pg_temp.review_of('receiptly', 'dev_person');
  select body into body_before from public.reviews where id = rid;

  perform pg_temp.be('dev_admin');

  -- (a) An edit, plainly.
  begin
    update public.reviews set body = 'tidied up by an administrator' where id = rid;
    if found then perform pg_temp.fail('an admin edited somebody else''s review'); end if;
  exception when insufficient_privilege then null;
  end;

  -- (b) An edit wearing a removal's clothes. This is the one a policy alone
  -- would let through, and the trigger is why it does not.
  begin
    update public.reviews set body = 'removed: was abusive', deleted_at = now()
     where id = rid;
    perform pg_temp.fail('an admin rewrote a review while removing it');
  exception when insufficient_privilege then null;
  end;

  -- (c) A removal with no reason on the record.
  begin
    update public.reviews set deleted_at = now() where id = rid;
    perform pg_temp.fail('a review came down with no reason recorded');
  exception when insufficient_privilege then null;
  end;

  -- (d) A reason in somebody else's name.
  begin
    insert into public.review_removals (review_id, admin_id, reason)
    values (rid, 'dev_maker', 'Recorded against a colleague, which must not be possible.');
    perform pg_temp.fail('an admin recorded a removal in another person''s name');
  exception when insufficient_privilege then null;
  end;

  -- (e) The way it is actually done: the reason, then the removal, in one
  -- transaction.
  insert into public.review_removals (review_id, admin_id, reason)
  values (rid, 'dev_admin', 'Reported as abusive, and it names a private individual.');

  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('an admin could not remove a reported review'); end if;

  -- The text was never touched. That is the promise §4 makes to the author.
  if (select body from public.reviews where id = rid) is distinct from body_before then
    perform pg_temp.fail('the review''s text changed on its way down');
  end if;

  -- Gone for everybody else, visible to the author and the admin.
  perform pg_temp.be('dev_maker');
  select count(*) into n from public.reviews where id = rid;
  if n > 0 then perform pg_temp.fail('a removed review is still on the page'); end if;

  perform pg_temp.be(null);
  select count(*) into n from public.reviews where id = rid;
  if n > 0 then perform pg_temp.fail('a removed review is still readable by a stranger'); end if;

  perform pg_temp.be('dev_person');
  select count(*) into n from public.review_removals where review_id = rid;
  if n <> 1 then perform pg_temp.fail('the author cannot see why their review came down'); end if;

  -- Not even the admin can edit it now that it is down.
  perform pg_temp.be('dev_admin');
  begin
    update public.reviews set body = 'and now a rewrite' where id = rid;
    if found then perform pg_temp.fail('an admin edited a review after removing it'); end if;
  exception when insufficient_privilege then null;
  end;

  -- Put it back for section 7's counting.
  perform pg_temp.be('dev_person');
  update public.reviews set deleted_at = null where id = rid;
end
$$;

-- ===========================================================================
-- 7. Deleting an account leaves nothing behind
--
-- One statement against one row, and 0001's cascades do the rest. What this
-- checks is that the cascade reaches everything personal, that it reaches
-- nothing else, and that the two exceptions are the ones the product decided
-- on: a listing survives with nobody's name on it, and an admin's note about
-- somebody ELSE's removed review survives with the admin's name taken off.
-- ===========================================================================
do $$
declare
  before_reviews integer; before_likes integer; before_collections integer;
  before_items integer; before_claims integer; before_tools integer;
  before_events integer; after_events integer;
  n integer; rid bigint; other_rid bigint;
begin
  -- A claim to delete later, so the count is not zero to begin with, and a
  -- listing of their own, because the seed gives dev_person none and "the
  -- listing survives" cannot be proved about a listing that is not there.
  perform pg_temp.be('dev_person');
  insert into public.tool_claims (tool_id, claimant_id)
  select id, 'dev_person' from public.tools where slug::text = 'tabsplit';

  insert into public.tools (slug, name, url, summary, pricing, submitted_by)
  values ('leaving-behind', 'Leaving Behind', 'https://leaving-behind.example',
          'A listing added by the person whose account is about to be deleted.',
          'free', 'dev_person');

  -- And a removal dev_person authored as an admin against SOMEBODY ELSE's
  -- review, which is the row that must survive them. (They are not an admin,
  -- so the admin writes it and we re-point it — the FK behaviour is what is
  -- under test, not who may write one, which section 6 covers.)
  other_rid := pg_temp.review_of('anki', 'dev_maker');
  perform pg_temp.be('dev_admin');
  insert into public.review_removals (review_id, admin_id, reason)
  values (other_rid, 'dev_admin', 'A note about another person''s review, kept on purpose.');
  reset role;
  update public.review_removals set admin_id = 'dev_person' where review_id = other_rid;
  set role foundit_app;

  select count(*) into before_reviews     from public.reviews     where author_id = 'dev_person';
  select count(*) into before_collections from public.collections where owner_id  = 'dev_person';
  perform pg_temp.be('dev_person');
  select count(*) into before_likes  from public.tool_likes  where user_id = 'dev_person';
  select count(*) into before_claims from public.tool_claims where claimant_id = 'dev_person';
  select count(*) into before_items  from public.collection_items ci
    join public.collections c on c.id = ci.collection_id where c.owner_id = 'dev_person';
  perform pg_temp.be('dev_admin');
  select count(*) into before_tools  from public.tools where submitted_by = 'dev_person'
                                                         or owner_id = 'dev_person';
  select count(*) into before_events from public.search_events;

  if before_reviews = 0 or before_likes = 0 or before_collections = 0
     or before_items = 0 or before_claims = 0 then
    perform pg_temp.fail('there is not enough of this account to prove it was deleted');
  end if;

  -- The deletion itself: one row, by its owner, and nobody else could do it
  -- (section 2 already tried).
  perform pg_temp.be('dev_person');
  delete from public.profiles where id = 'dev_person';
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('a person could not delete their own account'); end if;

  -- Nothing of theirs is left, looked at as the admin, who can see the most.
  perform pg_temp.be('dev_admin');
  select count(*) into n from public.profiles where id = 'dev_person';
  if n > 0 then perform pg_temp.fail('the profile survived'); end if;
  select count(*) into n from public.reviews where author_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('their reviews survived'); end if;
  select count(*) into n from public.tool_likes where user_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('their likes survived'); end if;
  select count(*) into n from public.collections where owner_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('their collections survived'); end if;
  select count(*) into n from public.collection_items ci
    left join public.collections c on c.id = ci.collection_id where c.id is null;
  if n > 0 then perform pg_temp.fail('saved items were orphaned rather than deleted'); end if;
  select count(*) into n from public.tool_claims where claimant_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('their claims survived'); end if;

  -- The two deliberate survivals.
  if before_tools = 0 then
    perform pg_temp.fail('this account never had a listing, so nothing was proved about one');
  end if;
  select count(*) into n from public.tools where submitted_by = 'dev_person'
                                              or owner_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('a listing still carries the deleted person''s id'); end if;
  select count(*) into n from public.tools where slug::text = 'leaving-behind';
  if n <> 1 then
    perform pg_temp.fail('the listing they added went with them, and it should not have');
  end if;

  select count(*) into n from public.review_removals
   where review_id = other_rid and admin_id is null;
  if n <> 1 then
    perform pg_temp.fail('the note about somebody else''s removed review did not survive '
                         'with the name taken off');
  end if;

  -- And search_events is exactly as it was, because it never held anything of
  -- theirs to begin with. This is the column that does not exist doing its job.
  select count(*) into after_events from public.search_events;
  if after_events <> before_events then
    perform pg_temp.fail('search_events changed when an account was deleted');
  end if;
end
$$;

-- A session that outlives its account is nobody. The application deletes the
-- session rows first for exactly this reason — see lib/accounts.ts — and this
-- is what makes the ordering a belt rather than the only thing holding it up.
do $$
declare n integer;
begin
  perform pg_temp.be('dev_person');
  if auth.is_admin() then perform pg_temp.fail('a deleted account is an admin'); end if;

  select count(*) into n from public.collections;
  if n > 0 then perform pg_temp.fail('a deleted account still reads its collections'); end if;
  select count(*) into n from public.tool_likes;
  if n > 0 then perform pg_temp.fail('a deleted account still reads its likes'); end if;

  begin
    insert into public.tool_likes (user_id, tool_id)
    select 'dev_person', id from public.tools where slug::text = 'obsidian';
    perform pg_temp.fail('a deleted account wrote a like');
  exception when insufficient_privilege then null;
           when foreign_key_violation then null;
  end;

  begin
    insert into public.reviews (tool_id, author_id, rating)
    select id, 'dev_person', 5 from public.tools where slug::text = 'obsidian';
    perform pg_temp.fail('a deleted account wrote a review');
  exception when insufficient_privilege then null;
           when foreign_key_violation then null;
  end;
end
$$;

reset role;

select 'All account, sharing, review-removal and deletion checks passed.' as result;

-- Nothing this file did survives it — including the deleted account.
rollback;
