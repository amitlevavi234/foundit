-- ===========================================================================
-- Foundit — 0015_phase6_review
--
-- What Phase 6's adversarial review found in the database, and the rules that
-- close it. Nothing here is a screen either; every rule below lands with a new
-- section in db/test/accounts_test.sql beside it.
--
-- FOUR THINGS THIS MIGRATION DOES:
--
--   1. AN ADMIN'S REMOVAL OUTRANKS THE AUTHOR (F1, HIGH). 0013 built the
--      removal as a soft delete and left `reviews_update` — `author_id =
--      auth.uid()`, from 0001 — able to set `deleted_at` back to null. The
--      review the Digital Services Act route took down survived exactly until
--      its author's next request, and the `review_removals` row was left
--      pointing at a live review, saying something untrue. The author could
--      also simply write the review again, because `reviews_one_live_per_author`
--      is partial and the removed row no longer occupies it. Both are closed
--      here, in the database: a review that carries a removal is frozen to its
--      author, and no new live review may be written on the same (tool,
--      author) afterwards. A review the AUTHOR took down is untouched by any of
--      it and stays re-postable, because that is their own decision about their
--      own words.
--
--   2. THE WRITABLE COLUMNS ARE NAMED, RATHER THAN LEFT TO THE APPLICATION
--      ALWAYS SENDING THE RIGHT ONES. `profiles_update` and `collections_write`
--      are both "this row is yours", with no restriction on WHICH COLUMN. At
--      the SQL level that let a signed-in person set `is_admin` and `plan` on
--      their own row, and set `share_token` on their own collection to any
--      32 hex characters they liked. Neither is reachable through the
--      application — `UPDATE_PROFILE_SQL` sends three columns, the only writer
--      of a token is `SHARE_COLLECTION_SQL`, and lib/db.ts has no `query()`
--      escape hatch — but the guarantee lived in the fixed statement rather
--      than in a rule, which is the shape of every finding that eventually
--      becomes an incident. So: column-level UPDATE grants on both tables, and
--      the share token is now MINTED BY THE DATABASE and refused from a client.
--
--   3. AN ADMIN DOES NOT READ A PRIVATE COLLECTION (F4). `or auth.is_admin()`
--      comes out of `collections_read` and `collection_items_read`. It was
--      carried over from 0001 and disclosed in loop-progress rather than
--      hidden, but it contradicts docs/product-decisions.md §10: a person is
--      visible to the operator through what they did IN PUBLIC. A private saved
--      list is the same category of sensitive as a like list, and the operator
--      dashboard has no use for its contents — the counts Phase 8 wants will
--      come from a definer function that returns NUMBERS rather than rows.
--      §10 now records the decision, dated, instead of only loop-progress.
--
--   4. THE COMMENT ON auth_core."verification" SAID SOMETHING FALSE (F3), and
--      0013 is applied, so it is corrected here rather than edited there.
--
-- THE CORRECTED STATEMENT ABOUT THE CODE, in full, because 0013's comment and
-- loop-progress both overstated it:
--
--   The 6-digit code is not stored in plain text. Until this migration it was
--   stored as `base64url(sha256(code))` — Better Auth's `storeOTP: 'hashed'`,
--   which is its `defaultKeyHasher`: unsalted, unkeyed, no work factor. Six
--   digits is a search space of 10^6, so that digest reverses on one core in
--   about three seconds, and the sentence 0013 wrote — that a backup or a read
--   would not let somebody sign in as whoever is waiting for a code — was not
--   true. It is stored as HMAC-SHA256 keyed by BETTER_AUTH_SECRET from now on
--   (lib/auth-options.ts), so a row read WITHOUT the secret is not a live
--   credential and the reversal above needs the secret first. What the hash
--   still does not protect against is somebody who has both the row and the
--   secret; against them the real defences are the five-minute expiry and the
--   three-attempt cap, and those were always the security of the scheme.
--
-- APPLIED MIGRATIONS ARE NEVER EDITED. Everything above is expressed as new
-- statements over what 0001, 0013 and 0014 left.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. A removal an administrator made is not the author's to undo
--
-- Three mechanisms again, for the reason 0013 §7 gives: this is a rule
-- docs/product-decisions.md §4 puts in bold and one mechanism is one thing to
-- get wrong.
--
--   THE TRIGGER is where the author is stopped and told why. It runs for every
--   update, sees OLD and NEW, and can say a sentence; a policy can only make a
--   row disappear.
--
--   THE RESTRICTIVE UPDATE POLICY says the same thing about the row that comes
--   out: a review carrying a removal may not be written back alive. It is
--   WITH CHECK and not USING on purpose — a restrictive USING would silently
--   filter the row out and the author would see "nothing happened", where a
--   WITH CHECK failure is an error with a name.
--
--   THE RESTRICTIVE INSERT POLICY closes the other door. The unique index that
--   keeps one live review per author is partial (`where deleted_at is null`),
--   so a removed review frees its own slot; without this, "remove it" and
--   "write it again" are two requests.
--
-- WHAT IS DELIBERATELY NOT CLOSED: the author's own soft delete. A review they
-- took down themselves carries no `review_removals` row, so none of the three
-- mechanisms sees it, and writing a new one is exactly as it was.
-- ===========================================================================
create or replace function public.reviews_is_not_an_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- FIRST, because it outranks the line below it. A review that carries a
  -- removal has been taken down by an administrator under the DSA route
  -- (docs/product-decisions.md §4), and the one person it is being kept from
  -- is its author. They may not clear deleted_at and they may not change a
  -- word — the alternative is a takedown that lasts until the next request.
  if old.author_id = auth.uid()
     and exists (select 1 from public.review_removals rr where rr.review_id = old.id)
  then
    raise exception
      'a review an administrator removed is not its author''s to change'
      using errcode = '42501',
            hint = 'The reason is recorded in public.review_removals. '
                   'Removing is not editing, and it is not reversible here.';
  end if;

  -- The author may change whatever they like about their own review,
  -- including taking it down.
  if old.author_id = auth.uid() then
    return new;
  end if;

  -- Everybody else is removing, and a removal changes exactly one column.
  if new.id              is distinct from old.id
  or new.tool_id         is distinct from old.tool_id
  or new.author_id       is distinct from old.author_id
  or new.rating          is distinct from old.rating
  or new.solved_problem  is distinct from old.solved_problem
  or new.ease_of_use     is distinct from old.ease_of_use
  or new.worth_the_price is distinct from old.worth_the_price
  or new.body            is distinct from old.body
  or new.created_at      is distinct from old.created_at then
    raise exception
      'a review may be removed by an administrator, never edited'
      using errcode = '42501',
            hint = 'Set deleted_at and nothing else.';
  end if;

  if old.deleted_at is not null or new.deleted_at is null then
    raise exception 'a removal sets deleted_at once, on a live review'
      using errcode = '42501';
  end if;

  -- And the reason is not optional. It is read through row-level security
  -- like anything else, so this also asserts that the person doing the
  -- removing is the person who wrote the reason down.
  if not exists (
    select 1 from public.review_removals rr
     where rr.review_id = old.id and rr.admin_id = auth.uid()
  ) then
    raise exception 'a removal records its reason in public.review_removals first'
      using errcode = '42501',
            hint = 'Insert the row that says why, in the same transaction.';
  end if;

  return new;
end;
$$;

comment on function public.reviews_is_not_an_edit() is
  'BEFORE UPDATE on reviews. Refuses any change by the AUTHOR to a review an '
  'administrator has removed; otherwise lets the author do anything to their '
  'own review, and lets everybody else do exactly one thing: set deleted_at on '
  'a live review whose reason is already recorded. Not SECURITY DEFINER and '
  'does not need to be — it only reads NEW, OLD and a table the caller can '
  'already see.';

create policy reviews_removal_is_not_undone on public.reviews
  as restrictive for update
  with check (deleted_at is not null
              or not exists (select 1 from public.review_removals rr
                              where rr.review_id = reviews.id));

comment on policy reviews_removal_is_not_undone on public.reviews is
  'RESTRICTIVE, so it is ANDed with every permissive policy on this table now '
  'and every one added later: a review that carries a removal may not be '
  'written back alive by anybody. WITH CHECK rather than USING so the refusal '
  'is an error rather than a row quietly not matching.';

create or replace function public.reviews_removal_is_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.reviews r
      join public.review_removals rr on rr.review_id = r.id
     where r.tool_id   = new.tool_id
       and r.author_id = new.author_id
  ) then
    raise exception
      'a review an administrator removed cannot be written again'
      using errcode = '42501',
            hint = 'The removal is on the record in public.review_removals. '
                   'Reposting it would make the takedown one request long.';
  end if;
  return new;
end;
$$;

comment on function public.reviews_removal_is_final() is
  'BEFORE INSERT on reviews. One live review per author per tool is a partial '
  'unique index, so a removed review frees its own slot; this is what keeps '
  '"remove it" from being undone by "write it again".';

create trigger reviews_removal_is_final
  before insert on public.reviews
  for each row execute function public.reviews_removal_is_final();

create policy reviews_no_repost_after_removal on public.reviews
  as restrictive for insert
  with check (not exists (select 1
                            from public.reviews r
                            join public.review_removals rr on rr.review_id = r.id
                           where r.tool_id   = reviews.tool_id
                             and r.author_id = reviews.author_id));

comment on policy reviews_no_repost_after_removal on public.reviews is
  'The same sentence as the trigger above it, in the form a later migration '
  'cannot forget: nobody writes a new live review on a (tool, author) pair '
  'where an administrator has already taken one down.';

-- ===========================================================================
-- 2. Which columns the application role may write
--
-- `grant insert, update on public.profiles ... to foundit_app` (0001) is a
-- grant on EVERY column. Row-level security then says which ROWS, and nothing
-- said which columns — so `update public.profiles set is_admin = true where id
-- = auth.uid()` was a legal statement for any signed-in person, and
-- `auth.is_admin()` answered true afterwards.
--
-- The application never sends it. That is the point: the boundary was the
-- application's fixed statement rather than a rule, and PostgreSQL has had
-- column-level privileges since 8.4.
--
-- `plan` and `is_admin` are set by an operator out of band, as owner. `id` and
-- `created_at` are nobody's to rewrite.
-- ===========================================================================
revoke update on public.profiles from foundit_app;
grant update (display_name, bio, handle) on public.profiles to foundit_app;

comment on column public.profiles.is_admin is
  'Set by an operator, out of band, as the schema owner. foundit_app holds no '
  'UPDATE privilege on this column (0015), so a signed-in person cannot make '
  'themselves an administrator even with a statement of their own choosing.';

-- --- the share token, which the database now mints -------------------------
--
-- 0013 made the token 128 bits from the application's crypto.randomBytes, and
-- the review's F7 is that nothing but the application's own statement kept it
-- that way: `collections_write` is `owner_id = auth.uid()` FOR ALL, so a
-- 32-hex string of somebody's choosing satisfied every rule in the database.
--
-- So the token comes from the database from here on, and a client-supplied one
-- is REFUSED rather than quietly replaced — a silent replacement is the failure
-- mode where somebody builds a link out of the value they sent and it opens
-- nothing. Sharing is now `is_public = true` and the token is the trigger's to
-- write; revoking is `is_public = false` and the token goes with it.
--
-- gen_random_uuid() rather than pgcrypto's gen_random_bytes: this database has
-- no pgcrypto and adding a contrib extension to every deployment for one line
-- is the wrong trade. The built-in has come from pg_strong_random since
-- PostgreSQL 13 — 122 random bits rather than 128, hex, in exactly the 32
-- characters `collections_share_token_shape` already requires.
-- ===========================================================================
create or replace function public.collections_share_token_is_minted_here()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  minted text;
begin
  minted := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

  if tg_op = 'INSERT' then
    if new.share_token is not null then
      raise exception 'a share token is minted by the database, never supplied'
        using errcode = '42501',
              hint = 'Set is_public and let the database write the token.';
    end if;
    if new.is_public then
      new.share_token := minted;
    end if;
    return new;
  end if;

  if new.share_token is distinct from old.share_token then
    raise exception 'a share token is minted by the database, never supplied'
      using errcode = '42501',
            hint = 'Set is_public and let the database write the token.';
  end if;

  if new.is_public and not old.is_public then
    new.share_token := minted;
  elsif old.is_public and not new.is_public then
    new.share_token := null;
  end if;
  return new;
end;
$$;

comment on function public.collections_share_token_is_minted_here() is
  'BEFORE INSERT OR UPDATE on collections. The link IS the permission, so the '
  'value has to come from a random source nobody outside the database chose. '
  'A supplied token is an error, not a value to overwrite: a caller that built '
  'a link out of what it sent would otherwise hand somebody an address that '
  'opens nothing.';

create trigger collections_share_token_is_minted_here
  before insert or update on public.collections
  for each row execute function public.collections_share_token_is_minted_here();

revoke update on public.collections from foundit_app;
grant update (name, description, is_public) on public.collections to foundit_app;

comment on column public.collections.share_token is
  '122 random bits from gen_random_uuid(), hex, or null. Null means the '
  'collection is private and the only reader is its owner. Not null means '
  'anybody holding this string can read the collection — it is the whole of '
  'the permission, which is why it is unguessable, why revoking it is setting '
  'it back to null, and why foundit_app holds no UPDATE privilege on this '
  'column (0015): it is written by the trigger above and by nothing else.';

-- ===========================================================================
-- 3. An admin does not read a private collection
--
-- docs/product-decisions.md §10, amended 12 September 2026. The two policies
-- are recreated without `or auth.is_admin()` and with nothing else changed.
-- ===========================================================================
drop policy collections_read on public.collections;
create policy collections_read on public.collections for select
  using (owner_id = auth.uid()
         or (share_token is not null and share_token = auth.share_token()));

comment on policy collections_read on public.collections is
  'Yours, or the one collection whose token the visitor put in the URL. An '
  'administrator is neither: docs/product-decisions.md §10 says a person is '
  'visible to the operator through what they did in public, and a private '
  'saved list is not that. Phase 8''s dashboard gets counts from a definer '
  'function that returns numbers, not rows.';

drop policy collection_items_read on public.collection_items;
create policy collection_items_read on public.collection_items for select
  using (exists (select 1 from public.collections c
                  where c.id = collection_id
                    and (c.owner_id = auth.uid()
                         or (c.share_token is not null
                             and c.share_token = auth.share_token()))));

comment on policy collection_items_read on public.collection_items is
  'Follows its collection, including in what it does not grant an '
  'administrator.';

-- ===========================================================================
-- 4. The comment 0013 wrote about the code, corrected
--
-- The long version is in this file's header. 0013 is applied and is not edited.
-- ===========================================================================
comment on table auth_core."verification" is
  'Where a 6-digit code lives for the five minutes it is alive. The code is '
  'stored as HMAC-SHA256 keyed by BETTER_AUTH_SECRET (storeOTP: { hash } in '
  'lib/auth-options.ts), so a row read WITHOUT the secret is not a live '
  'credential. It does NOT protect against somebody holding both the row and '
  'the secret: six digits is a search space of 10^6 and any unkeyed digest of '
  'one reverses in about three seconds. Against that reader the defences are '
  'the five-minute expiry and the three-attempt cap, which were always the '
  'security of the scheme. 0013''s comment here claimed more than that and was '
  'wrong; this replaces it.';

commit;
