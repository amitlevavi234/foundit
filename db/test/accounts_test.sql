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
  -- As its owner: since 0015 nobody else can read the row at all without the
  -- link, which is the thing this section is about.
  perform pg_temp.be('dev_person');
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

  -- Revoking is turning sharing off. 0015_phase6_review.sql made the token the
  -- database's to write, so `is_public = false` is the whole statement and the
  -- trigger takes the address with it; the old link dies immediately.
  perform pg_temp.be('dev_person');
  update public.collections set is_public = false
   where slug::text = 'trip-to-greece';
  perform pg_temp.be(null);
  perform pg_temp.holding(tok);
  select count(*) into n from public.collections where slug::text = 'trip-to-greece';
  if n > 0 then perform pg_temp.fail('a revoked link still opened the collection'); end if;

  -- Share it again for the sections below. The token is a NEW one, because a
  -- revoked address that came back would mean revoking had not been a
  -- revocation at all.
  perform pg_temp.be('dev_person');
  update public.collections set is_public = true
   where slug::text = 'trip-to-greece';
  select share_token into other from public.collections where slug::text = 'trip-to-greece';
  if other is null then
    perform pg_temp.fail('sharing again did not mint a token');
  end if;
  if other = tok then
    perform pg_temp.fail('sharing again handed back the address that had just been revoked');
  end if;
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

  -- It stays down. Section 7 is what the review of this phase added: the
  -- author trying to put it back, and being refused.
end
$$;

-- ===========================================================================
-- 7. WHAT THE PHASE 6 ADVERSARIAL REVIEW FOUND
--
-- Three things, and they are one thing said three ways: a rule that lives in
-- the statement the application happens to send is not a rule.
--
--   F1  an administrator's removal was undone by its author's next request,
--       and the review could simply be written again.
--   F4  an administrator could read a private saved list.
--   the defence-in-depth item: `profiles_update` and `collections_write` are
--       both "this row is yours" with no restriction on WHICH COLUMN, so
--       `is_admin`, `plan` and `share_token` were writable by their subject.
--
-- Everything below is as `foundit_app`, under a claim, which is the only way
-- any of it is ever reached.
-- ===========================================================================

-- (a) F1 — the removal §6 just made is not the author's to undo.
do $$
declare
  n integer; rid bigint;
  count_before integer; avg_before numeric;
  count_after  integer; avg_after  numeric;
begin
  rid := pg_temp.review_of('receiptly', 'dev_person');
  if rid is null then perform pg_temp.fail('the removed review is missing'); end if;

  perform pg_temp.be('dev_admin');
  if (select deleted_at from public.reviews where id = rid) is null then
    perform pg_temp.fail('section 6 did not leave the review removed');
  end if;
  if not exists (select 1 from public.review_removals where review_id = rid) then
    perform pg_temp.fail('the removal is not on the record');
  end if;

  select review_count, rating_avg into count_before, avg_before
    from public.tools where slug::text = 'receiptly';
  if count_before <> 0 or avg_before is not null then
    perform pg_temp.fail(format('a removed review is still counted: %s reviews, average %s',
                                count_before, avg_before));
  end if;

  perform pg_temp.be('dev_person');

  -- (i) Put it back. This is the one the review reproduced: `reviews_update`
  -- is `author_id = auth.uid()` and said nothing about deleted_at, so the
  -- takedown lasted until the author's next request.
  begin
    update public.reviews set deleted_at = null where id = rid;
    perform pg_temp.fail('the author cleared an administrator''s removal');
  exception when insufficient_privilege then null;
  end;

  -- (ii) Rewrite it where it lies. A removed review the author can still edit
  -- is a removed review whose text is not the text that was removed.
  begin
    update public.reviews
       set body = 'and now I have rewritten it after the removal', rating = 1
     where id = rid;
    perform pg_temp.fail('the author edited a review after it was removed');
  exception when insufficient_privilege then null;
  end;

  -- (iii) Write it again. `reviews_one_live_per_author` is partial, so the
  -- removed row no longer occupies the slot and this was simply an INSERT —
  -- the application's own UPSERT_REVIEW_SQL, sent verbatim.
  begin
    insert into public.reviews (tool_id, author_id, rating, body)
    select t.id, auth.uid(), 4::smallint, nullif('the same review again', '')
      from public.tools t
     where t.slug = 'receiptly'::citext and t.status = 'published'
    on conflict (tool_id, author_id) where deleted_at is null
    do update set rating = excluded.rating, body = excluded.body;
    perform pg_temp.fail('the author reposted a review an administrator removed');
  exception when insufficient_privilege then null;
  end;

  -- And the counters say what they said before all three.
  perform pg_temp.be('dev_admin');
  select review_count, rating_avg into count_after, avg_after
    from public.tools where slug::text = 'receiptly';
  if count_after <> count_before or avg_after is distinct from avg_before then
    perform pg_temp.fail(format('the refusals moved a counter: %s/%s became %s/%s',
                                count_before, avg_before, count_after, avg_after));
  end if;

  -- Both mechanisms are on the table, not just the one that raised. The
  -- trigger is what says the sentence; the restrictive policies are what a
  -- later migration cannot forget.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'reviews'
     and policyname in ('reviews_removal_is_not_undone', 'reviews_no_repost_after_removal')
     and permissive = 'RESTRICTIVE';
  if n <> 2 then
    perform pg_temp.fail('the two restrictive policies on reviews are not both there');
  end if;
end
$$;

-- (b) A review its AUTHOR took down carries no removal, and is theirs to write
--     again — which is the whole difference the section above turns on.
do $$
declare n integer; rid bigint;
begin
  perform pg_temp.be('dev_maker');
  rid := pg_temp.review_of('anki', 'dev_maker');
  if rid is null then perform pg_temp.fail('the seeded review on anki is missing'); end if;

  update public.reviews set deleted_at = now() where id = rid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the author could not take their own review down'); end if;

  insert into public.reviews (tool_id, author_id, rating, body)
  select t.id, auth.uid(), 5::smallint, nullif('written again, by me, about my own', '')
    from public.tools t
   where t.slug = 'anki'::citext and t.status = 'published'
  on conflict (tool_id, author_id) where deleted_at is null
  do update set rating = excluded.rating, body = excluded.body;
  get diagnostics n = row_count;
  if n <> 1 then
    perform pg_temp.fail('a review its own author took down could not be written again');
  end if;

  -- Put it back the way section 8 expects to find it.
  update public.reviews set deleted_at = now()
   where tool_id = (select id from public.tools where slug::text = 'anki')
     and author_id = 'dev_maker' and id <> rid;
  update public.reviews set deleted_at = null where id = rid;
end
$$;

-- (c) The writable columns on a profile are three, and `is_admin` is not one.
do $$
declare n integer;
begin
  perform pg_temp.be('dev_person');

  begin
    update public.profiles set is_admin = true where id = auth.uid();
    perform pg_temp.fail('a person made themselves an administrator');
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set plan = 'premium' where id = auth.uid();
    perform pg_temp.fail('a person gave themselves a paid plan');
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set created_at = now() where id = auth.uid();
    perform pg_temp.fail('a person rewrote when they joined');
  exception when insufficient_privilege then null;
  end;

  if auth.is_admin() then perform pg_temp.fail('and after all that, they are one'); end if;

  -- UPDATE_PROFILE_SQL, which is the only statement Settings sends, unchanged.
  update public.profiles
     set display_name = nullif('Tomer', ''),
         bio          = nullif('Still here.', ''),
         handle       = coalesce(null::citext, handle)
   where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('Settings can no longer save a profile'); end if;
end
$$;

-- (d) A share token is the database's to write. F7's "no exploit today, and
--     the guarantee lives in the application" is now a rule.
do $$
declare n integer; cid bigint; tok text;
begin
  perform pg_temp.be('dev_person');
  select id into cid from public.collections where slug::text = 'quiet-mornings';
  if cid is null then perform pg_temp.fail('the seeded private collection is missing'); end if;

  begin
    update public.collections set share_token = '00000000000000000000000000000000'
     where id = cid;
    perform pg_temp.fail('the owner chose their own share token');
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.collections (owner_id, name, slug, is_public, share_token)
    values (auth.uid(), 'Mine, at an address I picked', 'picked-address', true,
            '11111111111111111111111111111111');
    perform pg_temp.fail('a collection was created at a chosen address');
  exception when insufficient_privilege then null;
  end;

  -- SHARE_COLLECTION_SQL and UNSHARE_COLLECTION_SQL, as the screens send them.
  update public.collections set is_public = true
   where id = cid and share_token is null;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the Share control can no longer share'); end if;

  select share_token into tok from public.collections where id = cid;
  if tok is null or tok !~ '^[0-9a-f]{32}$' then
    perform pg_temp.fail('sharing did not mint 32 hex characters');
  end if;

  update public.collections set is_public = false where id = cid;
  get diagnostics n = row_count;
  if n <> 1 then perform pg_temp.fail('the Share control can no longer un-share'); end if;
  if (select share_token from public.collections where id = cid) is not null then
    perform pg_temp.fail('un-sharing left the address alive');
  end if;
end
$$;

-- (e) F4 — an administrator does not read a private saved list, and reads a
--     shared one only the way everybody else does: by holding its link.
do $$
declare n integer; tok text;
begin
  perform pg_temp.be('dev_person');
  select share_token into tok from public.collections where slug::text = 'trip-to-greece';
  if tok is null then perform pg_temp.fail('the shared collection lost its token'); end if;

  perform pg_temp.be('dev_admin');
  if not auth.is_admin() then perform pg_temp.fail('dev_admin is not an admin'); end if;

  select count(*) into n from public.collections;
  if n > 0 then
    perform pg_temp.fail(format('an administrator can see %s collection(s) with no link', n));
  end if;
  select count(*) into n from public.collection_items;
  if n > 0 then
    perform pg_temp.fail(format('an administrator can see %s saved item(s)', n));
  end if;

  -- Holding the link, they see the one collection it is for and nothing else —
  -- exactly what a stranger holding it sees.
  perform pg_temp.holding(tok);
  select count(*) into n from public.collections;
  if n <> 1 then
    perform pg_temp.fail('the link did not open its collection for an administrator');
  end if;
  select count(*) into n from public.collections where slug::text = 'quiet-mornings';
  if n > 0 then perform pg_temp.fail('a link opened a collection it is not for'); end if;
  perform pg_temp.holding(null);
end
$$;

-- ===========================================================================
-- 8. Deleting an account leaves nothing behind
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
  perform pg_temp.be('dev_person');
  -- Counted as themselves rather than as the admin: 0015 took
  -- `or auth.is_admin()` out of collections_read, so an administrator can no
  -- longer count somebody's saved lists at all, and a before-count of zero
  -- through a policy would prove nothing about what the delete removed.
  select count(*) into before_collections from public.collections where owner_id  = 'dev_person';
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

  -- The collections are counted as the SCHEMA OWNER, past row-level security
  -- altogether. Since 0015 nobody reachable through the application can see
  -- another person's saved lists, so "an admin sees none" is true whether the
  -- rows are gone or not, and the question here is whether they are gone.
  reset role;
  select count(*) into n from public.collections where owner_id = 'dev_person';
  if n > 0 then perform pg_temp.fail('their collections survived'); end if;
  select count(*) into n from public.collection_items ci
    left join public.collections c on c.id = ci.collection_id where c.id is null;
  if n > 0 then perform pg_temp.fail('saved items were orphaned rather than deleted'); end if;
  set role foundit_app;

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
