-- ===========================================================================
-- Do the counters on `tools` actually move, and can only the triggers move
-- them?
--
-- This suite exists because of a defect Phase 6 found by doing the thing: a
-- signed-in person liked a listing, the row landed in tool_likes, and
-- tools.like_count did not move — because the AFTER trigger ran as the person,
-- and `tools_update` is `using (tool_is_mine(id))`, and row-level security
-- FILTERS rather than refusing. No error. Four rows, a count of three.
--
-- It had never shown up because nothing but a migration had ever written one
-- of these rows. That is the shape of thing a behavioural test catches and a
-- reading of the schema does not, so: like something as a person who
-- maintains nothing, and watch the number.
--
-- Everything runs inside ONE transaction that is ALWAYS rolled back, exactly
-- like rls_test.sql and for the same reasons.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

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
  raise exception 'COUNTER TEST FAILED: %', msg;
end;
$$;

/**
 * THE OWNER'S WINDOW (db/migrations/0020_phase8_review.sql §2).
 *
 * `foundit_owner` has been NOSUPERUSER NOBYPASSRLS since 13 September 2026 —
 * which is what research/08 §9.3 has always said the server would be — so the
 * owner is subject to every policy in `public` exactly as the application is.
 * That IS the change: an owner statement reaching past a policy used to be a
 * silent no-op and is now an error.
 *
 * A test suite is one of the three things that legitimately reaches past a
 * policy as the owner. It plants fixtures no function could plant, and it
 * counts rows the person who wrote them would not be allowed to see. Every
 * call below is one of those, each with its own reason written beside it, and
 * the window is closed again on the next line.
 */
create or replace function pg_temp.owner_window(p_open boolean)
returns void language plpgsql as $$
begin
  perform set_config('foundit.definer',
                     case when p_open then 'on' else 'off' end, true);
end;
$$;

create or replace function pg_temp.likes(p_slug text)
returns integer language sql stable as $$
  select like_count from public.tools where slug::text = p_slug;
$$;

create or replace function pg_temp.saves(p_slug text)
returns integer language sql stable as $$
  select save_count from public.tools where slug::text = p_slug;
$$;

-- ===========================================================================
-- 1. Every counter agrees with the rows behind it before anything happens
-- ===========================================================================
do $$
declare bad text;
begin
  -- The owner's window, because this check is the whole point of the suite:
  -- count the rows BEHIND each counter. tool_likes_read is
  -- `user_id = auth.uid() or auth.is_admin()` and collection_items_read is
  -- the owner of the collection, so an owner with no claim now counts zero
  -- likes on every listing and reports every counter as wrong. There is no
  -- identity that can see all of them, and there should not be one.
  perform pg_temp.owner_window(true);

  select string_agg(format('%s (like_count %s, rows %s)', t.slug, t.like_count, c.likes), ', ')
    into bad
    from public.tools t
    join lateral (
      select (select count(*) from public.tool_likes l where l.tool_id = t.id) as likes,
             (select count(*) from public.collection_items ci where ci.tool_id = t.id) as saves,
             (select count(*) from public.reviews r
               where r.tool_id = t.id and r.deleted_at is null) as reviews
    ) c on true
   where t.like_count <> c.likes or t.save_count <> c.saves or t.review_count <> c.reviews;

  perform pg_temp.owner_window(false);

  if bad is not null then
    perform pg_temp.fail('a counter already disagrees with its rows: ' || bad);
  end if;
end
$$;

set role foundit_app;

-- ===========================================================================
-- 2. A LIKE BY SOMEBODY WHO MAINTAINS NOTHING STILL COUNTS
--
-- This is the defect, in one check. dev_person maintains no listing at all;
-- Cupboard belongs to dev_maker. Before 0014 the insert succeeded and the
-- number did not move.
-- ===========================================================================
do $$
declare before_n integer; after_n integer;
begin
  perform pg_temp.be('dev_person');
  before_n := pg_temp.likes('receiptly');

  insert into public.tool_likes (user_id, tool_id)
  select 'dev_person', id from public.tools where slug::text = 'receiptly'
  on conflict do nothing;

  after_n := pg_temp.likes('receiptly');
  if after_n <> before_n + 1 then
    perform pg_temp.fail(format(
      'a like by a non-maintainer did not count: %s then %s', before_n, after_n));
  end if;

  delete from public.tool_likes
   where user_id = 'dev_person'
     and tool_id = (select id from public.tools where slug::text = 'receiptly');

  after_n := pg_temp.likes('receiptly');
  if after_n <> before_n then
    perform pg_temp.fail(format(
      'unliking did not give the count back: %s then %s', before_n, after_n));
  end if;
end
$$;

-- ===========================================================================
-- 3. So does a save, and so does a review
-- ===========================================================================
do $$
declare before_n integer; after_n integer; cid bigint; tid bigint;
begin
  perform pg_temp.be('dev_person');
  select id into cid from public.collections where slug::text = 'quiet-mornings';
  select id into tid from public.tools where slug::text = 'receiptly';
  before_n := pg_temp.saves('receiptly');

  insert into public.collection_items (collection_id, tool_id) values (cid, tid);
  after_n := pg_temp.saves('receiptly');
  if after_n <> before_n + 1 then
    perform pg_temp.fail(format(
      'a save by a non-maintainer did not count: %s then %s', before_n, after_n));
  end if;

  delete from public.collection_items where collection_id = cid and tool_id = tid;
  if pg_temp.saves('receiptly') <> before_n then
    perform pg_temp.fail('removing a save did not give the count back');
  end if;
end
$$;

do $$
declare before_reviews integer; before_sum integer; tid bigint;
begin
  perform pg_temp.be('dev_person');
  select id, review_count, rating_sum into tid, before_reviews, before_sum
    from public.tools where slug::text = 'cupboard';

  insert into public.reviews (tool_id, author_id, rating, body)
  values (tid, 'dev_person', 4, 'A review by somebody who does not maintain this listing.');

  if (select review_count from public.tools where id = tid) <> before_reviews + 1 then
    perform pg_temp.fail('a review by a non-maintainer did not count');
  end if;
  if (select rating_sum from public.tools where id = tid) <> before_sum + 4 then
    perform pg_temp.fail('the rating did not reach the listing');
  end if;

  -- And taking it down unwinds it, which is what makes an admin's removal
  -- change the rating rather than only hiding the words.
  update public.reviews set deleted_at = now()
   where tool_id = tid and author_id = 'dev_person' and deleted_at is null;

  if (select review_count from public.tools where id = tid) <> before_reviews then
    perform pg_temp.fail('taking a review down did not unwind the count');
  end if;
  if (select rating_sum from public.tools where id = tid) <> before_sum then
    perform pg_temp.fail('taking a review down did not unwind the rating');
  end if;
end
$$;

-- ===========================================================================
-- 4. And the application still cannot write a counter itself
--
-- The policy that lets the triggers do it names foundit_owner, which the
-- application role is not and cannot become — so setting the flag by hand
-- gains nothing, and the number on a listing remains something that can only
-- be moved by liking, saving or reviewing.
--
-- TIGHTENED BY 0017, and the difference is the interesting part. When this was
-- written the refusal was row-level security FILTERING: the UPDATE ran, matched
-- nothing, and reported zero rows. 0017 took foundit_app's table-wide UPDATE on
-- public.tools away and gave back a column list that excludes all six counters,
-- so the same statement is now refused on PRIVILEGE — before any policy is
-- consulted, and whatever rows it would have matched.
--
-- Both are a pass. The assertion accepts either and names which one happened,
-- because a test that demanded the weaker answer would have failed on the day
-- the stronger one arrived, which is exactly what it did.
-- ===========================================================================
do $$
declare
  n         integer;
  refused   boolean;
begin
  perform pg_temp.be('dev_person');
  perform set_config('foundit.counters', 'on', true);

  begin
    refused := false;
    update public.tools set like_count = 9999 where slug::text = 'cupboard';
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    refused := true;
    n := 0;
  end;
  if not refused and n > 0 then
    perform pg_temp.fail('the application wrote a counter directly by setting the flag');
  end if;

  perform set_config('foundit.counters', 'off', true);

  begin
    refused := false;
    update public.tools set like_count = 9999 where slug::text = 'cupboard';
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    refused := true;
    n := 0;
  end;
  if not refused and n > 0 then
    perform pg_temp.fail('the application wrote a counter directly');
  end if;

  -- And say out loud which layer said no, so a future reader knows whether the
  -- column grant is still doing the work.
  if not refused then
    raise notice 'counters: the application role was filtered by row-level security, '
      'not refused on privilege — check 0017''s column list on public.tools';
  end if;
end
$$;

reset role;

-- ===========================================================================
-- 5. The policy is exactly as narrow as it claims to be
--
-- Structural rather than behavioural, and the reason is worth writing down:
-- in the development container foundit_owner is a SUPERUSER, and a superuser
-- bypasses row-level security whether or not it is forced. So "the owner
-- cannot edit a listing without the flag" is not a sentence this database can
-- demonstrate — it would pass for the wrong reason, which is worse than not
-- checking. What CAN be checked is the shape of the policy, and the shape is
-- what makes the fix hold anywhere the owner is not a superuser.
-- ===========================================================================
do $$
declare p record;
begin
  select roles, qual, with_check into p
    from pg_policies
   where schemaname = 'public' and tablename = 'tools' and policyname = 'tools_counters';
  if not found then
    perform pg_temp.fail('the tools_counters policy is gone');
  end if;

  if p.roles::text[] <> array['foundit_owner'] then
    perform pg_temp.fail('tools_counters applies to ' || p.roles::text ||
                         ', not to foundit_owner alone');
  end if;
  if p.qual = 'true' or p.with_check = 'true' then
    perform pg_temp.fail('tools_counters is unconditional');
  end if;
  if position('foundit.counters' in p.qual) = 0
     or position('foundit.counters' in p.with_check) = 0 then
    perform pg_temp.fail('tools_counters does not require the counter flag');
  end if;
end
$$;

-- And the three functions that use it are the only definer-shaped things
-- allowed to: each one pins an empty search_path, without which a definer
-- function can be made to resolve public.tools to somebody else's table.
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('tool_likes_count', 'collection_items_count', 'reviews_count')
     -- PostgreSQL stores the pinned path as `search_path=""` — the empty
     -- string, quoted — so the check is for a search_path setting whose value
     -- is empty rather than for the bare text.
     and (not p.prosecdef
          or p.proconfig is null
          or not exists (
            select 1 from unnest(p.proconfig) as setting
             where setting in ('search_path=""', 'search_path=')));
  if bad is not null then
    perform pg_temp.fail('a counter function is not a definer with a pinned path: ' || bad);
  end if;
end
$$;

select 'All counter checks passed.' as result;

rollback;
