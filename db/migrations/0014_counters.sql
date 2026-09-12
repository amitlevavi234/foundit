-- ===========================================================================
-- Foundit — 0014_counters
--
-- The counters on `tools` stopped being maintained the moment somebody other
-- than a listing's maintainer touched a listing — which is to say, the moment
-- Phase 6 let anybody like or save anything.
--
-- FOUND BY DOING IT. A signed-in person liked Splitwise on the development
-- machine; the row landed in `tool_likes`, and `tools.like_count` stayed at 3
-- with four rows behind it:
--
--     slug      | like_count | rows
--     splitwise |          3 |    4
--
-- WHY. `public.tool_likes_count()` is an AFTER INSERT trigger that runs
-- `update public.tools set like_count = like_count + 1 where id = new.tool_id`.
-- It is SECURITY INVOKER, so that update runs as the person who liked, and
-- `tools_update` is `using (public.tool_is_mine(id))` — the person does not
-- maintain Splitwise, so the update matched no rows. No error, no warning: RLS
-- filters, it does not refuse. The same silence applies to `save_count` and to
-- every column `reviews_count()` maintains.
--
-- It had never shown up because nothing outside a migration had ever written
-- one of these rows: the seed inserts as the owner, and owners bypass RLS
-- except where it is FORCED — and 0001 forces it, which is why the seed's own
-- counters are right and every later one would have been wrong.
--
-- THE FIX, and why it is shaped the way it is.
--
-- The three counter functions become SECURITY DEFINER, so the update runs as
-- foundit_owner rather than as whoever liked something. That alone is not
-- enough: `tools` is FORCE ROW LEVEL SECURITY, which subjects the owner to its
-- own policies too, and `tool_is_mine()` is no truer for foundit_owner than it
-- was for the person.
--
-- So there is one more policy, and every word of it is load-bearing:
--
--   TO foundit_owner        it does not apply to foundit_app at all. Policies
--                           are role-scoped, foundit_app is not a member of
--                           foundit_owner and cannot SET ROLE to it, so no
--                           amount of cleverness in a session as the
--                           application role reaches this policy.
--   USING a setting         and not `true`. The setting is turned on by the
--                           three functions below, for the length of the
--                           update and no longer, so even a stray owner
--                           connection — a migration, a psql session — does
--                           not silently acquire blanket UPDATE on the
--                           catalogue. It has to say it is doing counters.
--
-- The result: the ONLY way to write these columns is to insert or delete the
-- row the counter counts. That is stricter than what 0001 shipped, where a
-- maintainer could set their own like_count to anything they liked, and it is
-- the answer to the obvious question about a permissive-looking policy — the
-- one thing that can reach it is a fixed function that adds or subtracts one.
--
-- db/test/counters_test.sql proves it behaviourally, as a person who
-- maintains nothing.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. The one door the counters may be written through
-- ===========================================================================
create policy tools_counters on public.tools for update
  to foundit_owner
  using      (pg_catalog.current_setting('foundit.counters', true) = 'on')
  with check (pg_catalog.current_setting('foundit.counters', true) = 'on');

comment on policy tools_counters on public.tools is
  'The counter triggers, and nothing else. It applies only to foundit_owner — '
  'which the application role is not a member of and cannot become — and only '
  'while `foundit.counters` is on, which the three counter functions set for '
  'the length of their own update. Without it, `tools` being FORCE ROW LEVEL '
  'SECURITY means even a SECURITY DEFINER trigger cannot maintain a count on a '
  'listing the person does not maintain, and every like after the seed was '
  'silently uncounted.';

-- ===========================================================================
-- 2. The three functions, unchanged except for who they run as
--
-- Each is now SECURITY DEFINER with a pinned empty search_path — the pairing
-- research/09 §8 insists on, because a definer function whose search_path is
-- not pinned can be made to resolve `public.tools` to somebody else's table.
--
-- The window is closed explicitly at the end rather than left to the
-- transaction: a trigger that returns with the flag still on would hand the
-- rest of the statement's triggers the same power, and the next one along is
-- not necessarily this migration's.
-- ===========================================================================
create or replace function public.tool_likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('foundit.counters', 'on', true);
  if tg_op = 'INSERT' then
    update public.tools set like_count = like_count + 1 where id = new.tool_id;
  elsif tg_op = 'DELETE' then
    update public.tools set like_count = greatest(like_count - 1, 0) where id = old.tool_id;
  end if;
  perform pg_catalog.set_config('foundit.counters', 'off', true);
  return null;
end;
$$;

create or replace function public.collection_items_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('foundit.counters', 'on', true);
  if tg_op = 'INSERT' then
    update public.tools set save_count = save_count + 1 where id = new.tool_id;
  elsif tg_op = 'DELETE' then
    update public.tools set save_count = greatest(save_count - 1, 0) where id = old.tool_id;
  end if;
  perform pg_catalog.set_config('foundit.counters', 'off', true);
  return null;
end;
$$;

-- Reviews are soft-deleted, so this one follows deleted_at rather than the
-- row's existence. Unchanged from 0001 apart from the flag and the owner.
create or replace function public.reviews_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_live boolean := (tg_op <> 'INSERT') and (old.deleted_at is null);
  is_live  boolean := (tg_op <> 'DELETE') and (new.deleted_at is null);
begin
  perform pg_catalog.set_config('foundit.counters', 'on', true);
  if was_live then
    update public.tools
       set review_count = greatest(review_count - 1, 0),
           rating_count = greatest(rating_count - 1, 0),
           rating_sum   = greatest(rating_sum - old.rating, 0)
     where id = old.tool_id;
  end if;
  if is_live then
    update public.tools
       set review_count = review_count + 1,
           rating_count = rating_count + 1,
           rating_sum   = rating_sum + new.rating
     where id = new.tool_id;
  end if;
  perform pg_catalog.set_config('foundit.counters', 'off', true);
  return null;
end;
$$;

comment on function public.tool_likes_count() is
  'Keeps tools.like_count in step with tool_likes. SECURITY DEFINER because '
  'the person doing the liking has no right to write the listing they liked, '
  'and the tools_counters policy is what lets the owner do it — for the '
  'length of this update and no longer. The only thing it can do is add or '
  'subtract one from one row named by the row being inserted or deleted.';

comment on function public.collection_items_count() is
  'Keeps tools.save_count in step with collection_items. SECURITY DEFINER for '
  'the same reason as public.tool_likes_count().';

comment on function public.reviews_count() is
  'Keeps review_count, rating_count and rating_sum in step with reviews, '
  'following deleted_at rather than the row''s existence because a review is '
  'soft-deleted. SECURITY DEFINER for the same reason as '
  'public.tool_likes_count() — and it is what makes an admin''s removal '
  'unwind the rating as well as hiding the text.';

revoke execute on function public.tool_likes_count() from public;
revoke execute on function public.collection_items_count() from public;
revoke execute on function public.reviews_count() from public;

-- ===========================================================================
-- 3. A like is not an edit to the listing
--
-- The second half of the same defect, found the same way. `tools_touch` is a
-- BEFORE UPDATE trigger that stamps `updated_at`, and once the counters
-- started working, every like and every save stamped it — so
-- `tool_problems.embedded_at < tools.updated_at` became true for any listing
-- anybody liked, and the embedding job's own rule for "this text changed"
-- started firing on a number.
--
-- db/test/vectors_test.sql caught it within a minute of the counters starting
-- to work: "1 embedded summary is stale the moment it is written." The cost
-- would have been a re-embedding of a listing every time somebody pressed a
-- heart, for a text that had not changed.
--
-- So the trigger gets a WHEN clause naming the columns that are the listing.
-- `updated_at` now means what the embedding job and the change history assume
-- it means — somebody edited this listing — rather than "something about this
-- row moved". The counters are deliberately not in the list, and neither are
-- the two timestamps themselves.
-- ===========================================================================
drop trigger tools_touch on public.tools;

create trigger tools_touch
  before update on public.tools
  for each row
  when (old.slug          is distinct from new.slug
     or old.name          is distinct from new.name
     or old.url           is distinct from new.url
     or old.summary       is distinct from new.summary
     or old.logo_path     is distinct from new.logo_path
     or old.pricing       is distinct from new.pricing
     or old.platforms     is distinct from new.platforms
     or old.languages     is distinct from new.languages
     or old.flags         is distinct from new.flags
     or old.status        is distinct from new.status
     or old.claimable     is distinct from new.claimable
     or old.links         is distinct from new.links
     or old.submitted_by  is distinct from new.submitted_by
     or old.owner_id      is distinct from new.owner_id
     or old.made_by_owner is distinct from new.made_by_owner
     or old.published_at  is distinct from new.published_at)
  execute function public.set_updated_at();

comment on trigger tools_touch on public.tools is
  'Stamps updated_at when the LISTING changes — its text, its constraints, its '
  'status, who looks after it. Not when a counter moves: a like is not an edit, '
  'and treating it as one made every embedded summary stale the moment somebody '
  'pressed a heart.';

-- ===========================================================================
-- 4. Repair what the defect already broke
--
-- Everything written since the seed — which on a development machine is
-- whatever was clicked while this was being found, and on the server is
-- nothing, because nothing has been deployed. Recomputed from the rows rather
-- than adjusted by a delta, so the answer does not depend on knowing when the
-- defect started.
-- ===========================================================================
update public.tools t
   set like_count   = c.likes,
       save_count   = c.saves,
       review_count = c.reviews,
       rating_count = c.ratings,
       rating_sum   = c.rating_sum
  from (
    select t2.id,
           (select count(*) from public.tool_likes l where l.tool_id = t2.id) as likes,
           (select count(*) from public.collection_items ci where ci.tool_id = t2.id) as saves,
           (select count(*) from public.reviews r
             where r.tool_id = t2.id and r.deleted_at is null) as reviews,
           (select count(*) from public.reviews r
             where r.tool_id = t2.id and r.deleted_at is null) as ratings,
           (select coalesce(sum(r.rating), 0) from public.reviews r
             where r.tool_id = t2.id and r.deleted_at is null) as rating_sum
      from public.tools t2
  ) c
 where c.id = t.id
   and (t.like_count, t.save_count, t.review_count, t.rating_count, t.rating_sum)
       is distinct from (c.likes::int, c.saves::int, c.reviews::int, c.ratings::int,
                         c.rating_sum::int);

commit;
