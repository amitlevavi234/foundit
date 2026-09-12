-- ===========================================================================
-- Foundit — 0013_accounts
--
-- Phase 6. Sign-in, saving, liking, reviewing, and deleting an account.
--
-- Nothing in this file is a screen. Every rule a screen will lean on is here
-- first, with a behavioural test beside it in db/test/accounts_test.sql, so
-- that the page can be wrong without the data being wrong. That ordering is
-- the phase's first non-negotiable (docs/build-phases.md, Phase 6).
--
-- FOUR THINGS THIS MIGRATION DOES, and the reason each one is shaped the way
-- it is:
--
--   1. A SECOND SCHEMA AND A SECOND ROLE. Better Auth keeps its own user,
--      session, account, verification and rateLimit tables. They live in
--      `auth_core`, owned by foundit_owner, reachable by exactly one role —
--      `foundit_auth` — which holds nothing anywhere else. foundit_app, which
--      is what every page in the application connects as, holds NOTHING on
--      them: a SQL-injection bug in the catalogue cannot read a session token,
--      and a bug in the authentication library cannot read a review.
--
--   2. A SHARE TOKEN ON A COLLECTION. 0001 made a collection readable when
--      `is_public` was true, which is "readable by the entire internet,
--      enumerable by id". The product decision is narrower: a shared
--      collection is readable by somebody holding an unguessable link and by
--      nobody else. So the policy now compares a 128-bit token the person
--      supplied in the URL against the one on the row, and `is_public` becomes
--      a derived fact that a CHECK keeps honest.
--
--   3. A WAY TO TAKE A REVIEW DOWN THAT IS NOT A WAY TO EDIT ONE.
--      docs/product-decisions.md §4, amended 11 September 2026: an admin may
--      remove somebody else's review, whole, with the reason recorded — and
--      may never change a word of it. Those are two different powers and the
--      database now distinguishes them: a policy lets an admin set deleted_at,
--      a BEFORE UPDATE trigger refuses any other column change from anyone who
--      is not the author, and a RESTRICTIVE policy makes it impossible for a
--      future permissive policy to hand a third party the power by accident.
--      The tool's owner gets nothing from any of this and is tested as such.
--
--   4. A DELETE ON A PROFILE THAT TAKES EVERYTHING WITH IT. 0001 already
--      points every personal row at profiles with ON DELETE CASCADE, so one
--      refused-or-allowed statement is the whole of deletion on this side of
--      the boundary. It had no DELETE grant and no delete policy, so nobody
--      could run it. Both are added, scoped to your own row.
--
-- WHAT IS DELIBERATELY NOT HERE:
--
--   * No foreign key from public.profiles to auth_core."user". Phase 1 left a
--     note asking for one. It is not added, for three reasons, and the
--     decision is recorded in docs/product-decisions.md §18 rather than only
--     in this comment. Referential-integrity actions BYPASS row-level security
--     by design, so a cascade from auth_core would be a delete path into
--     `public` for the one role that is supposed to hold nothing there — which
--     is the boundary this migration exists to draw. The seeded development
--     profiles have no Better Auth user and inventing three in a migration is
--     worse than the missing constraint. And the invariant it would enforce —
--     a profile belongs to a real account — is enforced instead where it is
--     created (one code path, at first sign-in) and where it is destroyed (one
--     ordered deletion, with a test).
--
--   * No row-level security on auth_core. Everywhere else in this schema RLS
--     is enabled AND forced, and that is right, because those tables are
--     SHARED: many people's rows in one table, read by one application role,
--     and the policy is what separates them. auth_core is not shared. It has
--     exactly one reader and writer, which is the authentication service
--     itself, and that service must see every row of it — a policy expressing
--     that would have to evaluate to `true`, which is the one thing this
--     project never writes (docs/build-phases.md). The boundary there is the
--     GRANT, not the policy, and db/test/accounts_test.sql asserts it from
--     both sides: foundit_auth can reach auth_core and nothing else,
--     foundit_app and foundit_embed cannot reach auth_core at all.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. foundit_auth
--
-- Created exactly the way 0001 creates foundit_app and 0005 creates
-- foundit_embed: LOGIN NOINHERIT and NO PASSWORD. A migration is a tracked
-- file that runs on the production host, so it must never carry a credential.
-- The two places that give these roles a password are:
--
--   development   db/docker-compose.dev.yml, whose init SQL sets a throwaway
--                 literal on a fresh data directory. On an existing one, run
--                 the alter role in that file's header comment by hand.
--   the server    server/setup/09-postgres-service.sh, which generates it with
--                 openssl into /root/.foundit/db.env (0600, root only).
--
-- A role that exists and cannot log in is the safe direction to fail in.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'foundit_auth') then
    create role foundit_auth login noinherit;
  end if;
end
$$;

comment on role foundit_auth is
  'Better Auth, and nothing else. Reaches the five tables in auth_core and no '
  'object in any other schema — no catalogue, no reviews, no search log. It '
  'is the other half of the pair that keeps an application bug and an '
  'authentication bug from being the same incident: foundit_app holds nothing '
  'in auth_core, and this role holds nothing in public.';

-- ===========================================================================
-- 2. auth_core, and the five tables Better Auth expects
--
-- The DDL below is Better Auth 1.7.4's own, taken from what its migration
-- generator compiles for PostgreSQL with the configuration in lib/auth.ts
-- (Google, the email OTP plugin, database-backed rate limiting, database
-- sessions), and then schema-qualified. It is transcribed rather than run
-- from the library's CLI so that this file stays the single record of what
-- exists in the database — but transcription drifts, so
-- tests/auth-schema.test.mjs reads THIS file and compares every table and
-- column against what the library asks for at run time, from the same
-- lib/auth.ts the application uses. A version bump that adds a column fails
-- that test rather than failing at two in the morning.
--
-- The identifiers are quoted because Better Auth names its columns in camel
-- case and PostgreSQL folds unquoted names to lower case. "user" is also a
-- reserved word. Both are the library's choices and neither is ours to
-- change: the adapter builds its own SQL and would not find a renamed column.
-- ===========================================================================
create schema if not exists auth_core authorization foundit_owner;

revoke all on schema auth_core from public;
grant usage on schema auth_core to foundit_auth;

create table if not exists auth_core."user" (
  "id"            text not null primary key,
  "name"          text not null,
  "email"         text not null unique,
  "emailVerified" boolean not null,
  "image"         text,
  "createdAt"     timestamptz not null default current_timestamp,
  "updatedAt"     timestamptz not null default current_timestamp
);

create table if not exists auth_core."session" (
  "id"        text not null primary key,
  "expiresAt" timestamptz not null,
  "token"     text not null unique,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId"    text not null references auth_core."user" ("id") on delete cascade
);

create table if not exists auth_core."account" (
  "id"                     text not null primary key,
  "accountId"              text not null,
  "providerId"             text not null,
  "userId"                 text not null references auth_core."user" ("id") on delete cascade,
  "accessToken"            text,
  "refreshToken"           text,
  "idToken"                text,
  "accessTokenExpiresAt"   timestamptz,
  "refreshTokenExpiresAt"  timestamptz,
  "scope"                  text,
  "password"               text,
  "createdAt"              timestamptz not null default current_timestamp,
  "updatedAt"              timestamptz not null
);

create table if not exists auth_core."verification" (
  "id"         text not null primary key,
  "identifier" text not null,
  "value"      text not null,
  "expiresAt"  timestamptz not null,
  "createdAt"  timestamptz not null default current_timestamp,
  "updatedAt"  timestamptz not null default current_timestamp
);

create table if not exists auth_core."rateLimit" (
  "id"          text not null primary key,
  "key"         text not null unique,
  "count"       integer not null,
  "lastRequest" bigint not null
);

create index if not exists "session_userId_idx"            on auth_core."session" ("userId");
create index if not exists "account_userId_idx"            on auth_core."account" ("userId");
create index if not exists "verification_identifier_idx"   on auth_core."verification" ("identifier");

comment on table auth_core."verification" is
  'Where a 6-digit code lives for the five minutes it is alive. The code is '
  'HASHED (storeOTP: "hashed" in lib/auth.ts, which is not the library''s '
  'default): a plaintext code in a table is a live credential for its whole '
  'life, and anybody with a backup or a read would be able to sign in as '
  'whoever is waiting for it.';

-- Exactly the verbs the adapter uses, on exactly these five tables. No grant
-- on the schema's future objects, no default privileges, nothing on any
-- sequence because every id here is text the library generates.
grant select, insert, update, delete on
  auth_core."user", auth_core."session", auth_core."account",
  auth_core."verification", auth_core."rateLimit"
  to foundit_auth;

-- Unqualified names in the adapter's SQL resolve into auth_core and nowhere
-- else. Setting it on the ROLE rather than only in the connection string means
-- a psql session opened as this role to look at a session row behaves the same
-- way, and it cannot be talked out of it by a connection option.
alter role foundit_auth set search_path = auth_core;
alter role foundit_auth set statement_timeout = '5s';

-- ===========================================================================
-- 3. Nothing reaches `public` just by existing
--
-- PostgreSQL grants USAGE on schema public to PUBLIC by default, which is to
-- say to every role including ones added years from now. 0001 and 0005 both
-- grant it explicitly to the roles that need it, so taking the blanket away
-- costs nothing and means foundit_auth cannot so much as resolve a name in
-- the schema it is not supposed to be in.
-- ===========================================================================
revoke all on schema public from public;

-- ===========================================================================
-- 4. A claim that is nonsense is a stranger, not an error
--
-- 0001's auth.uid() already answers null for an absent claim and for an empty
-- one, and the comment there is right about why: a stranger must be nobody
-- rather than an exception. It did not cover the third case. A claim that is
-- present, non-empty and NOT VALID JSON — `request.jwt.claims = 'nonsense'` —
-- raised 22P02 out of the cast, from inside a policy, on every table the
-- statement touched.
--
-- That is still fail-closed, in the sense that the transaction dies and
-- nothing is read or written. It is the wrong shape of fail-closed for a
-- rule that has to hold on the worst day: a policy that can RAISE is a policy
-- whose behaviour depends on which row it reached first, an error message
-- that reaches a log, and a page that 500s instead of showing the signed-out
-- version of itself. The request wrapper in lib/db.ts builds the claim with
-- JSON.stringify and cannot produce this, which is exactly why the database
-- should not be relying on it.
--
-- pg_input_is_valid is PostgreSQL 16's answer to "parse this if it parses";
-- this database is 17. Everything else about the function is unchanged,
-- including the two nullifs and what they are for.
-- ===========================================================================
create or replace function auth.uid()
returns text
language sql
stable
as $fn$
  select nullif(
    case
      when pg_catalog.pg_input_is_valid(c.raw, 'jsonb')
      then c.raw::jsonb ->> 'sub'
    end,
    ''
  )
  from (
    select nullif(pg_catalog.current_setting('request.jwt.claims', true), '') as raw
  ) c;
$fn$;

comment on function auth.uid() is
  'The signed-in user id for this request, or null for a stranger. Absent, '
  'empty and malformed claims are all the same answer — nobody — because the '
  'only acceptable direction to fail in is closed, and because a policy that '
  'raises is a 500 where a signed-out page belongs.';

-- ===========================================================================
-- 5. The token that makes a collection shareable
--
-- 128 bits, generated by the application with crypto.randomBytes and written
-- as 32 hex characters. Not a sequence, not a slug, not a hash of the name:
-- the link IS the permission, so it has to be unguessable, and 32 hex
-- characters is the same order of entropy as a session token.
--
-- `is_public` stays, because it is what the artboard's toggle reads and what
-- the Saved screen labels a collection with, but it is no longer a permission
-- — it is a restatement of "there is a token", and the CHECK makes the two
-- impossible to disagree. Revoking a share is `share_token = null,
-- is_public = false`, and the old link stops working immediately.
--
-- Any collection that was public before this migration is un-shared rather
-- than given a token: a token minted by a migration would have to come from
-- the database's random source and be written into a tracked file's execution
-- log, and there are three of them, all invented, in a development seed.
-- ===========================================================================
alter table public.collections
  add column if not exists share_token text;

update public.collections set is_public = false where share_token is null;

alter table public.collections
  add constraint collections_share_token_shape
    check (share_token is null or share_token ~ '^[0-9a-f]{32}$'),
  add constraint collections_shared_has_token
    check (is_public = (share_token is not null));

create unique index if not exists collections_share_token
  on public.collections (share_token) where share_token is not null;

comment on column public.collections.share_token is
  '128 random bits, hex, or null. Null means the collection is private and '
  'the only reader is its owner. Not null means anybody holding this string '
  'can read the collection — it is the whole of the permission, which is why '
  'it is unguessable and why revoking it is setting it back to null.';

-- The token the visitor supplied, out of the URL, set per transaction beside
-- request.jwt.claims by the same wrapper (lib/db.ts). `true` as the second
-- argument so an ordinary request, which sets nothing, is nobody holding
-- nothing rather than an error.
create or replace function auth.share_token()
returns text
language sql
stable
as $fn$
  select nullif(current_setting('request.share_token', true), '');
$fn$;

comment on function auth.share_token() is
  'The collection share token this request arrived with, or null. It is a '
  'capability the visitor supplied, never an identity: it says which one row '
  'they may read and nothing about who they are.';

revoke execute on function auth.share_token() from public;
grant execute on function auth.share_token() to foundit_app;

-- --- the two policies that used to say `is_public` ------------------------
drop policy collections_read on public.collections;
create policy collections_read on public.collections for select
  using (owner_id = auth.uid()
         or auth.is_admin()
         or (share_token is not null and share_token = auth.share_token()));

comment on policy collections_read on public.collections is
  'Yours, an admin''s, or the one collection whose token the visitor put in '
  'the URL. Was `is_public or ...`, which made a shared collection readable '
  'by anybody who could reach the database through the app, enumerable by id. '
  'Sharing a list of tools is a small thing until the list is about leaving '
  'somebody, and then it is not.';

drop policy collection_items_read on public.collection_items;
create policy collection_items_read on public.collection_items for select
  using (exists (select 1 from public.collections c
                  where c.id = collection_id
                    and (c.owner_id = auth.uid()
                         or auth.is_admin()
                         or (c.share_token is not null
                             and c.share_token = auth.share_token()))));

-- ===========================================================================
-- 6. review_removals — the reason, on the record
--
-- The DSA route (research/13 §2.1) needs three things when a review comes
-- down: the reason recorded, the author told, and the removal visible to the
-- operator. This table is the first. The second is Phase 8's, and the third
-- reads this table.
--
-- admin_id is ON DELETE SET NULL rather than CASCADE, and that is the whole
-- design of the column: an administrator closing their own account must not
-- erase the record of somebody else's review being taken down. What goes is
-- the name attached to it. A removal of the DEPARTING person's own review does
-- disappear, because review_id cascades from reviews, which cascades from
-- their profile — their review is gone, so the note about it is about nothing.
-- ===========================================================================
create table public.review_removals (
  id         bigint generated always as identity primary key,
  review_id  bigint not null references public.reviews(id)  on delete cascade,
  admin_id   text            references public.profiles(id) on delete set null,
  reason     text   not null check (length(btrim(reason)) between 8 and 500),
  created_at timestamptz not null default now()
);

create index review_removals_review on public.review_removals (review_id);

comment on table public.review_removals is
  'Why a review was taken down, by whom, and when. Written in the same '
  'transaction as the removal and required by it — the trigger on reviews '
  'refuses a removal with no reason on the record.';

alter table public.review_removals enable row level security;
alter table public.review_removals force row level security;

create policy review_removals_read on public.review_removals for select
  using (auth.is_admin()
         or exists (select 1 from public.reviews r
                     where r.id = review_id and r.author_id = auth.uid()));

comment on policy review_removals_read on public.review_removals is
  'An admin, and the author of the review that came down. The author''s half '
  'is what Phase 8 will render into "your review was removed, and here is '
  'why"; it is granted here because the row is about them and reading their '
  'own is not a privilege.';

create policy review_removals_insert on public.review_removals for insert
  with check (auth.is_admin() and admin_id = auth.uid());

-- ===========================================================================
-- 7. Removing a review is not editing one
--
-- Three mechanisms, doing three different jobs. They overlap on purpose:
-- this is the rule docs/build-phases.md puts in bold, and one mechanism is
-- one thing to get wrong.
--
--   THE POLICY says an admin may UPDATE a live review into a removed one.
--   Without it an admin can do nothing at all, which is the state 0001 left
--   and which the DSA does not allow.
--
--   THE TRIGGER says what that update may change: for anybody who is not the
--   author, every column but deleted_at must come out the way it went in, the
--   removal must be a first removal, and a reason must already be on the
--   record. This is the mechanism that makes "removing is not editing" true
--   rather than merely intended, and it is a trigger rather than a SECURITY
--   DEFINER function for the reason 0003 gives at length: a definer function
--   is an authorization bypass wearing a helpful hat, and a BEFORE UPDATE
--   trigger reaches the same guarantee with no elevated code path at all.
--
--   THE RESTRICTIVE POLICY says that whatever else is ever added to this
--   table, an update by somebody who is neither the author nor an admin is
--   refused. Restrictive policies are ANDed with every permissive one, so a
--   future "let the maintainer fix a typo" policy cannot quietly become an
--   exception to the rule this project says it will never make.
-- ===========================================================================
create policy reviews_remove_admin on public.reviews for update
  using (auth.is_admin() and deleted_at is null)
  with check (auth.is_admin() and deleted_at is not null);

comment on policy reviews_remove_admin on public.reviews is
  'An admin may take a live review down. The WITH CHECK is what makes this a '
  'removal rather than an edit at the policy level — the row it writes must '
  'be deleted — and the reviews_is_not_an_edit trigger is what makes it true '
  'of every other column.';

create policy reviews_author_or_admin_only on public.reviews
  as restrictive for update
  using (author_id = auth.uid() or auth.is_admin());

comment on policy reviews_author_or_admin_only on public.reviews is
  'RESTRICTIVE, so it is ANDed with every permissive policy on this table now '
  'and every one added later. docs/product-decisions.md §4: nobody may edit '
  'somebody else''s review — not the listing''s maintainer, not us — and only '
  'an admin may remove one. This is that sentence in a form a later migration '
  'cannot forget.';

create or replace function public.reviews_is_not_an_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
  'BEFORE UPDATE on reviews. Lets the author do anything to their own review '
  'and lets everybody else do exactly one thing: set deleted_at on a live '
  'review whose reason is already recorded. Not SECURITY DEFINER and does not '
  'need to be — it only reads NEW, OLD and a table the caller can already '
  'see.';

-- The name sorts before reviews_touch, so this runs before updated_at is
-- stamped; neither trigger depends on the other's work.
create trigger reviews_is_not_an_edit
  before update on public.reviews
  for each row execute function public.reviews_is_not_an_edit();

-- ===========================================================================
-- 8. Deleting an account
--
-- Everything personal in this schema points at profiles with ON DELETE
-- CASCADE — reviews, tool_likes, collections (and their items through them),
-- tool_claims, and now review_removals through reviews. A listing keeps its
-- place and loses its name, because tools.submitted_by and tools.owner_id are
-- ON DELETE SET NULL: a person leaving does not take the catalogue with them,
-- which is what the Settings artboard promises in so many words.
--
-- So the whole of deletion on this side of the boundary is one statement
-- against one row, and what was missing was the right to run it.
--
-- search_events is untouched by construction: it has no user column, no
-- session column and no foreign key to anything that has one, so there is
-- nothing in it to delete and nothing about the deleted person to leave
-- behind.
-- ===========================================================================
create policy profiles_delete on public.profiles for delete
  using (id = auth.uid());

comment on policy profiles_delete on public.profiles is
  'Your own row and nobody else''s — not even an admin''s, who has no business '
  'closing somebody''s account from the operator dashboard. Deleting it takes '
  'the reviews, likes, collections, saved items and claims with it by cascade '
  'and leaves the listings they added, credited to nobody.';

-- ===========================================================================
-- 9. Grants
--
-- The verbs, on exactly the tables the phase's screens write to. Row-level
-- security decides which rows; these decide whether the statement is allowed
-- to be sent at all, and both have to say yes.
-- ===========================================================================
grant delete on public.profiles, public.collections to foundit_app;
grant select, insert on public.review_removals to foundit_app;
grant usage on all sequences in schema public to foundit_app;

commit;
