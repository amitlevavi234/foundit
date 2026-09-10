# Foundit — Security & Authorization Research

**Date:** 2026-09-10
**Product:** Foundit — a free public web app. Anyone can search a catalogue of tools by describing a problem. Signed-in users save tools into collections, like, rate, review, and add tools they made. Whoever adds a tool maintains that listing. A small set of operator-seeded listings can be claimed with one click. Sign-in: Google, Apple, 6-digit email code. **Anonymous visitors read everything, write nothing.**
**Assumed stack:** Next.js (App Router) on Vercel + Supabase (Postgres, Auth, RLS), an LLM/embeddings provider for semantic search, server-side URL metadata fetching.
**Audience:** a solo, non-developer operator.

Every factual claim below is linked to a primary source inline. Section 10 lists what could not be confirmed.

---

## 0. Verdict on the stack

**Keep Next.js on Vercel + Supabase.** It is the right choice for this operator, for one specific reason: the security boundary that matters most for Foundit — "anonymous can read, cannot write" — is enforced *inside Postgres* by Row Level Security, not by application code. That means a bug in a route handler, a mistake in a React component, or an LLM-generated API endpoint cannot grant write access that the database refuses to give. No other free-tier arrangement gives a non-developer that property as cheaply.

Three caveats, each of which is a real trade and is covered in detail below:

1. **RLS is off by default on every new table**, and a table in the `public` schema with RLS off is world-writable through the auto-generated API. This is the single highest-consequence configuration item in the whole product. ([Supabase lint 0013](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public))
2. **Vercel's Hobby plan has no spend cap** — Spend Management is Pro-only ([Vercel plans](https://vercel.com/docs/plans/hobby)) — and Hobby is restricted to *non-commercial personal use* under Vercel's fair-use guidelines. If Foundit ever monetises, Hobby is not merely risky, it is out of policy.
3. **The server-fetches-a-user-submitted-URL feature is the one genuinely dangerous piece of custom code in this product.** It is an SSRF sink by construction (§6.1). If it were dropped — asking submitters to type the title and description themselves — Foundit's attack surface would shrink materially. That is worth weighing against the UX win.

Alternatives considered and rejected for this operator: rolling auth yourself (worse, always); Firebase (comparable, but security rules are a bespoke language with no `psql` escape hatch and no equivalent of the Supabase advisors); a single VPS with a hand-written API (far more surface, patching burden on a non-developer).

---

## 1. The authorization model

### 1.1 Entities

| Table | What it holds |
|---|---|
| `profiles` | Public-facing user identity: display name, avatar. **No email.** |
| `tools` | Catalogue listings. `owner_id` null = operator-seeded and claimable. |
| `tool_claims` | A user's one-click claim on a seeded listing, pending operator approval. |
| `reviews` | Free-text review, one per user per tool. |
| `ratings` | Numeric score, one per user per tool. |
| `likes` | A user liked a tool. One per user per tool. |
| `collections` | A user's named collection. `is_public` controls visibility. |
| `collection_items` | Tool ↔ collection membership. Visibility follows the parent collection. |

### 1.2 Permission table

Read "anon" as an unauthenticated visitor, "user" as any signed-in user, "author" as the row's creator, "maintainer" as `tools.owner_id`, "operator" as you, acting through a server route holding the secret key.

| Entity | Anonymous read | Signed-in read | Create | Update | Delete |
|---|---|---|---|---|---|
| `profiles` | ✅ all (display name, avatar only) | ✅ all | ⚙️ trigger on signup only | ✅ self only | ❌ nobody (cascades from account deletion) |
| `tools` (published) | ✅ all | ✅ all | ✅ any user; `owner_id` forced to `auth.uid()` | ✅ **maintainer only**, and cannot reassign ownership | ❌ nobody — soft-delete via `status`; operator only |
| `tools` (unpublished/hidden) | ❌ | ✅ maintainer only | — | ✅ maintainer only | ❌ |
| `tool_claims` | ❌ | ✅ own claims only | ✅ any user, on unclaimed tools only, `claimant_id` forced to `auth.uid()` | ❌ nobody (operator decides) | ✅ own **pending** claim only (withdraw) |
| `reviews` | ✅ all | ✅ all | ✅ any user; **not on own tool**; one per tool | ✅ **author only** | ✅ **author only** |
| `ratings` | ✅ all (and aggregates) | ✅ all | ✅ any user; **not on own tool**; one per tool | ✅ **author only** | ✅ **author only** |
| `likes` | ✅ all (aggregate counts) | ✅ all | ✅ any user; one per tool | ❌ n/a | ✅ **own like only** |
| `collections` | ✅ only where `is_public` | ✅ own + any public | ✅ any user; `user_id` forced to `auth.uid()` | ✅ owner only | ✅ owner only |
| `collection_items` | ✅ only where parent collection is public | ✅ own + public parents | ✅ owner of parent collection | ✅ owner of parent | ✅ owner of parent |
| `auth.users` | ❌ never exposed | ❌ never exposed | Supabase Auth | Supabase Auth | Server route only |

**The two load-bearing negative rules, stated explicitly:**

> **R1 — A tool's maintainer has no rights whatsoever over reviews or ratings of their tool.** Not edit, not delete, not hide. The only people who can touch a review row are its author and the operator. This is enforced structurally: no policy on `reviews` or `ratings` ever references `tools.owner_id`, plus a belt-and-braces `RESTRICTIVE` policy (§1.3) that denies any write where the actor is the tool's maintainer and not the review author.

> **R2 — A maintainer can edit only their own listing, and cannot give it away or take another.** Enforced by an `UPDATE` policy with matching `USING` and `WITH CHECK` on `owner_id = auth.uid()`. The `WITH CHECK` half is what stops ownership reassignment: the *post-update* row must still satisfy `owner_id = auth.uid()`, so a maintainer cannot set `owner_id` to anyone else, and cannot set it on a row they do not already own. See §2.3 for why omitting `WITH CHECK` here would be the classic mistake.

**Claiming** is deliberately not a self-service write. A user inserts a `tool_claims` row; the operator flips `tools.owner_id` from a server route. Letting a client `UPDATE tools SET owner_id = auth.uid() WHERE owner_id IS NULL` would be a one-click land-grab on the whole seed catalogue. The "one click" in the product spec is one click *for the user*; approval is asynchronous.

### 1.3 Schema and RLS policy SQL

The following is written to be pasted into the Supabase SQL editor in order. It follows Supabase's own policy-authoring rules: one policy per operation (never `FOR ALL`), always name the role with `TO`, always wrap `auth.uid()` in `(select ...)`. ([Supabase RLS AI prompt rules](https://supabase.com/docs/guides/ai-tools/ai-prompts/database-rls-policies), [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security))

#### Step 0 — a private schema for helper functions

Helper functions used by policies must **not** live in an exposed schema. ([Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security))

```sql
create schema if not exists private;
revoke all on schema private from anon, authenticated;
```

#### Step 1 — tables

```sql
-- ---------- profiles ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(display_name) between 1 and 60),
  avatar_url    text,
  created_at    timestamptz not null default now()
);
-- NOTE: no email column. See §7.2.

-- ---------- tools ----------
create type public.tool_status as enum ('draft', 'published', 'hidden', 'removed');

create table public.tools (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references public.profiles(id) on delete set null,
  is_seed      boolean not null default false,
  status       public.tool_status not null default 'draft',
  name         text not null check (length(name) between 2 and 120),
  url          text not null,
  summary      text check (length(summary) <= 400),
  description  text check (length(description) <= 4000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tools_owner_id_idx  on public.tools (owner_id);
create index tools_status_idx    on public.tools (status);

-- ---------- reviews ----------
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  tool_id    uuid not null references public.tools(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade
               default (select auth.uid()),
  body       text not null check (length(body) between 10 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tool_id, author_id)
);
create index reviews_tool_id_idx   on public.reviews (tool_id);
create index reviews_author_id_idx on public.reviews (author_id);

-- ---------- ratings ----------
create table public.ratings (
  id         uuid primary key default gen_random_uuid(),
  tool_id    uuid not null references public.tools(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade
               default (select auth.uid()),
  score      smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  unique (tool_id, author_id)
);
create index ratings_tool_id_idx   on public.ratings (tool_id);
create index ratings_author_id_idx on public.ratings (author_id);

-- ---------- likes ----------
create table public.likes (
  tool_id    uuid not null references public.tools(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade
               default (select auth.uid()),
  created_at timestamptz not null default now(),
  primary key (tool_id, user_id)
);
create index likes_user_id_idx on public.likes (user_id);

-- ---------- collections ----------
create table public.collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade
               default (select auth.uid()),
  title      text not null check (length(title) between 1 and 80),
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);
create index collections_user_id_idx on public.collections (user_id);
create index collections_public_idx  on public.collections (is_public) where is_public;

create table public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  tool_id       uuid not null references public.tools(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, tool_id)
);

-- ---------- tool_claims ----------
create type public.claim_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

create table public.tool_claims (
  id          uuid primary key default gen_random_uuid(),
  tool_id     uuid not null references public.tools(id) on delete cascade,
  claimant_id uuid not null references public.profiles(id) on delete cascade
                default (select auth.uid()),
  status      public.claim_status not null default 'pending',
  evidence    text check (length(evidence) <= 2000),
  created_at  timestamptz not null default now(),
  unique (tool_id, claimant_id)
);
create index tool_claims_claimant_idx on public.tool_claims (claimant_id);
```

The `default (select auth.uid())` on every ownership column is deliberate. It means that even if a client omits `user_id` — or an AI-written insert forgets it — the database fills in the *real* caller. Combined with the `WITH CHECK` policies below, a client-supplied `user_id` belonging to someone else is rejected outright. This is the concrete fix for OWASP API1 Broken Object Level Authorization in a Supabase app (§8.3).

#### Step 2 — enable RLS and reset grants on every table

```sql
alter table public.profiles         enable row level security;
alter table public.tools            enable row level security;
alter table public.reviews          enable row level security;
alter table public.ratings          enable row level security;
alter table public.likes            enable row level security;
alter table public.collections      enable row level security;
alter table public.collection_items enable row level security;
alter table public.tool_claims      enable row level security;
```

RLS and `GRANT` are two independent gates. Supabase's default privileges already grant `select, insert, update, delete` on new `public` tables to `anon`, `authenticated` and `service_role`, and *adding policies does not remove those grants*. ([Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security), [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)) So tighten the grants too — `anon` should hold `SELECT` and nothing else, anywhere:

```sql
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.tools, public.reviews,
                public.ratings, public.likes,
                public.collections, public.collection_items to anon;

grant select, insert, update, delete
  on public.profiles, public.tools, public.reviews, public.ratings,
     public.likes, public.collections, public.collection_items,
     public.tool_claims
  to authenticated;

-- anon must never even reach the claims table
revoke all on public.tool_claims from anon;
```

With `anon` holding no `INSERT`/`UPDATE`/`DELETE` grant at all, the product requirement "anonymous visitors must never be able to write anything" is enforced *twice*: once by the missing grant (which errors with `42501` before any policy runs) and once by the absence of any anon write policy. That redundancy is the point.

#### Step 3 — profiles

```sql
create policy "profiles are readable by everyone"
on public.profiles for select
to anon, authenticated
using ( true );

create policy "users update only their own profile"
on public.profiles for update
to authenticated
using      ( (select auth.uid()) = id )
with check ( (select auth.uid()) = id );

-- No INSERT or DELETE policy: rows are created by the signup trigger below
-- and removed only by cascade from auth.users.
```

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'member-' || left(replace(new.id::text, '-', ''), 8)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`security definer set search_path = ''` is mandatory here. Supabase's linter flags any definer function without a pinned search path, because such a function "inherits the `search_path` of the current session when invoked" and an attacker "could exploit the `search_path` to direct the function to use unexpected objects." ([lint 0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [Database Functions](https://supabase.com/docs/guides/database/functions)) With an empty search path every reference must be schema-qualified — note `public.profiles`, not `profiles`.

Note also that `raw_user_meta_data` is used here only to seed a *display name*. It is never used for an authorization decision. See §2.6.

#### Step 4 — tools

```sql
-- Read: published listings are public; a maintainer also sees their own drafts.
create policy "published tools are readable by everyone"
on public.tools for select
to anon, authenticated
using ( status = 'published' );

create policy "maintainers read their own unpublished tools"
on public.tools for select
to authenticated
using ( owner_id = (select auth.uid()) );

-- Create: any signed-in, non-anonymous user; ownership is forced to self.
create policy "users create tools they own"
on public.tools for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and is_seed = false
  and status in ('draft', 'published')
);

-- Update: R2. USING picks the rows; WITH CHECK stops ownership reassignment.
create policy "maintainers update only their own tool"
on public.tools for update
to authenticated
using      ( owner_id = (select auth.uid()) )
with check ( owner_id = (select auth.uid()) );

-- No DELETE policy at all. Removal is a status change by the operator.
```

Two extra guards that RLS alone cannot express. RLS is row-granular; it has no opinion about *which columns* changed ([Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security)). So restrict the updatable columns by grant, and freeze the fields a maintainer must never move:

```sql
revoke update on public.tools from authenticated;
grant  update (name, url, summary, description, status, updated_at)
  on public.tools to authenticated;

create function public.tools_freeze_immutable()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     or new.is_seed is distinct from old.is_seed
     or new.created_at is distinct from old.created_at then
    raise exception 'immutable column modified';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tools_freeze
  before update on public.tools
  for each row execute function public.tools_freeze_immutable();
```

#### Step 5 — reviews (rule R1)

```sql
create policy "reviews are readable by everyone"
on public.reviews for select
to anon, authenticated
using ( true );

create policy "users write their own review, never on their own tool"
on public.reviews for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and not exists (
    select 1 from public.tools t
    where t.id = reviews.tool_id
      and t.owner_id = (select auth.uid())
  )
);

create policy "authors update only their own review"
on public.reviews for update
to authenticated
using      ( author_id = (select auth.uid()) )
with check ( author_id = (select auth.uid()) );

create policy "authors delete only their own review"
on public.reviews for delete
to authenticated
using ( author_id = (select auth.uid()) );
```

Rule R1 already holds, because no policy above grants a maintainer anything. But "it holds because we didn't write the policy" is fragile — the next schema change, or the next AI-generated migration, can quietly add one. Make it explicit with a `RESTRICTIVE` policy. Restrictive policies are ANDed with everything else, so no future permissive policy can override them ([Postgres CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)):

```sql
create policy "tool owners can never modify reviews of their tool"
on public.reviews as restrictive for update
to authenticated
using (
  author_id = (select auth.uid())
);

create policy "tool owners can never delete reviews of their tool"
on public.reviews as restrictive for delete
to authenticated
using (
  author_id = (select auth.uid())
);
```

Read that as: *whatever else any policy says*, an update or delete on a review is only ever permitted to its own author. A maintainer is, for this purpose, just another user who did not write the review.

Freeze the review's identity fields too, so an author cannot re-point their review at a different tool or a different author:

```sql
revoke update on public.reviews from authenticated;
grant  update (body, updated_at) on public.reviews to authenticated;
```

#### Step 6 — ratings, likes

```sql
create policy "ratings are readable by everyone"
on public.ratings for select
to anon, authenticated using ( true );

create policy "users rate, but not their own tool"
on public.ratings for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and not exists (
    select 1 from public.tools t
    where t.id = ratings.tool_id and t.owner_id = (select auth.uid())
  )
);

create policy "authors update their own rating"
on public.ratings for update
to authenticated
using      ( author_id = (select auth.uid()) )
with check ( author_id = (select auth.uid()) );

create policy "authors delete their own rating"
on public.ratings for delete
to authenticated
using ( author_id = (select auth.uid()) );

create policy "tool owners can never modify ratings"
on public.ratings as restrictive for update
to authenticated using ( author_id = (select auth.uid()) );

create policy "tool owners can never delete ratings"
on public.ratings as restrictive for delete
to authenticated using ( author_id = (select auth.uid()) );
```

```sql
create policy "likes are readable by everyone"
on public.likes for select
to anon, authenticated using ( true );

create policy "users like as themselves"
on public.likes for insert
to authenticated
with check ( user_id = (select auth.uid()) );

create policy "users unlike only their own like"
on public.likes for delete
to authenticated
using ( user_id = (select auth.uid()) );
```

#### Step 7 — collections

```sql
create policy "public collections are readable by everyone"
on public.collections for select
to anon, authenticated
using ( is_public );

create policy "owners read their own collections"
on public.collections for select
to authenticated
using ( user_id = (select auth.uid()) );

create policy "users create collections they own"
on public.collections for insert
to authenticated
with check ( user_id = (select auth.uid()) );

create policy "owners update their own collections"
on public.collections for update
to authenticated
using      ( user_id = (select auth.uid()) )
with check ( user_id = (select auth.uid()) );

create policy "owners delete their own collections"
on public.collections for delete
to authenticated
using ( user_id = (select auth.uid()) );
```

`collection_items` must not re-derive visibility with a join in the policy — that is the pattern Supabase benchmarked at 178 seconds before a `security definer` helper brought it to 12 ms ([RLS performance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)). Use a private helper:

```sql
create function private.collection_is_visible(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collections c
    where c.id = cid
      and ( c.is_public or c.user_id = (select auth.uid()) )
  );
$$;

create function private.collection_is_mine(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collections c
    where c.id = cid and c.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.collection_is_visible(uuid) from public, anon;
revoke execute on function private.collection_is_mine(uuid)    from public, anon, authenticated;
grant  execute on function private.collection_is_visible(uuid) to anon, authenticated;
grant  execute on function private.collection_is_mine(uuid)    to authenticated;
```

```sql
create policy "items follow their collection's visibility"
on public.collection_items for select
to anon, authenticated
using ( private.collection_is_visible(collection_id) );

create policy "owners add items to their own collections"
on public.collection_items for insert
to authenticated
with check ( private.collection_is_mine(collection_id) );

create policy "owners remove items from their own collections"
on public.collection_items for delete
to authenticated
using ( private.collection_is_mine(collection_id) );
```

#### Step 8 — claims

```sql
create policy "users read only their own claims"
on public.tool_claims for select
to authenticated
using ( claimant_id = (select auth.uid()) );

create policy "users claim only unclaimed seed listings"
on public.tool_claims for insert
to authenticated
with check (
  claimant_id = (select auth.uid())
  and status = 'pending'
  and exists (
    select 1 from public.tools t
    where t.id = tool_claims.tool_id
      and t.owner_id is null
      and t.is_seed = true
  )
);

create policy "users withdraw their own pending claim"
on public.tool_claims for delete
to authenticated
using ( claimant_id = (select auth.uid()) and status = 'pending' );

-- No UPDATE policy. Only the operator changes a claim's status,
-- and does so through a server route holding the secret key.
```

#### Step 9 — block anonymous sign-ins from writing, if you ever enable them

Supabase's anonymous sign-in feature issues real users who assume the **`authenticated`** Postgres role, exactly like a permanent user; they are distinguished only by an `is_anonymous` JWT claim ([Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)). Foundit does not need this feature — **leave it off** — but if it is ever switched on, every `to authenticated` write policy above silently becomes reachable by anyone. Guard it once, restrictively:

```sql
create policy "no writes from anonymous users" on public.tools
  as restrictive for insert to authenticated
  with check ( (select (auth.jwt() ->> 'is_anonymous')::boolean) is false );
-- repeat for reviews, ratings, likes, collections, collection_items, tool_claims
```

Note `is false`, not `= false`: a missing claim gives `NULL is false` → `false` → denied. It fails closed. And note `as restrictive` — Supabase's docs are explicit that a permissive version of this policy would simply OR alongside the others and restrict nothing.

#### Step 10 — verification query

Run this after every migration. It should return zero rows.

```sql
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity;
```

And this, which should list every table with a non-zero policy count:

```sql
select tablename, count(*) as policies
from pg_policies where schemaname = 'public'
group by tablename order by tablename;
```

---

## 2. RLS pitfalls that actually bite

### 2.1 A table with RLS left off is world-writable

Supabase's own linter states it without hedging: for a table in `public` with RLS disabled, *"anyone with your project URL can read, edit, and delete all data in this table."* ([lint 0013](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)) The project URL and publishable key are in your JavaScript bundle by design; they are not secrets. So "RLS off" means "open to the internet", full stop.

This is not hypothetical for a table you forget. Supabase's default privileges grant all four DML verbs on new `public` tables to `anon` and `authenticated`; RLS is what withholds them. Every `create table` needs its matching `enable row level security` in the same migration.

Related: **lint 0007 `policy_exists_rls_disabled`** — you wrote policies but never enabled RLS, so the policies do nothing at all. ([lint 0007](https://supabase.com/docs/guides/database/database-linter?lint=0007_policy_exists_rls_disabled)) And **lint 0008 `rls_enabled_no_policy`** — RLS on with no policies, which fails *closed* (Postgres applies a default-deny), so it breaks the feature rather than leaking data. ([Postgres RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html))

### 2.2 Policies that pass, or fail, because `auth.uid()` is null

`auth.uid()` returns `NULL` for an unauthenticated request. Supabase's own documentation spells out the consequence:

> *"A policy like `USING (auth.uid() = user_id)` will silently fail for unauthenticated users, because `null = user_id` is always false in SQL."*
> — [Auth policies deep dive](https://supabase.com/docs/guides/auth/auth-deep-dive/auth-policies)

There are two distinct failure directions, and they behave differently:

- **Silent fail-closed (SELECT).** `NULL = user_id` evaluates to `NULL`, not `true`. The row is filtered out with **no error**. This is safe but deceptive: a completely broken policy and a correctly-empty result look identical. You cannot tell "my policy works" from "my policy is nonsense" by looking at an empty list.
- **Silent fail-open (`USING (true)`).** Grants every row to every role the policy applies to. Safe only when `TO` names the right role. Omit `TO` and it includes `anon`.

Supabase's recommendation is to check authentication explicitly rather than rely on the null comparison: `USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)`. For Foundit the stronger form is what §1.3 uses — always name `TO authenticated` on write policies, and hold no anon write *grant* at all, so the null case never even reaches a policy.

### 2.3 `USING` vs `WITH CHECK` — the distinction that causes real bugs

`USING` filters rows that already exist. `WITH CHECK` validates rows as they will be after the write. From [Postgres `CREATE POLICY`](https://www.postgresql.org/docs/current/sql-createpolicy.html):

| Command | `USING` | `WITH CHECK` |
|---|---|---|
| `SELECT` | yes | **not allowed** |
| `INSERT` | **not allowed** | yes |
| `UPDATE` | yes — which rows may be updated | yes — the resulting row must pass |
| `DELETE` | yes | **not allowed** |

Three consequences that bite:

1. **UPDATE without `WITH CHECK` lets a user move a row out of their own scope.** `USING (owner_id = auth.uid())` alone means "you may update rows you own" — including updating them to set `owner_id` to someone else's id, or in a multi-tenant shape, moving a row into another tenant. This is exactly rule R2's failure mode for Foundit: without the `WITH CHECK` half, a maintainer could reassign a listing. Postgres does supply an implicit `WITH CHECK` identical to `USING` when you omit it on `ALL`/`UPDATE` ([Postgres RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)), which happens to save you here — but relying on an implicit clause is not something to do deliberately. Write both.
2. **`UPDATE` also needs a `SELECT` policy.** Postgres: *"`SELECT` rights are also required on the relation being updated, and the appropriate `SELECT` or `ALL` policies will be applied in addition to the `UPDATE` policies."* A maintainer who cannot `SELECT` a draft cannot `UPDATE` it either — which is why §1.3 gives maintainers an explicit read policy for their own unpublished tools.
3. **They fail differently, which matters when you test.** A `USING` mismatch filters silently. A `WITH CHECK` violation **raises an error** (`42501`). ([Postgres](https://www.postgresql.org/docs/current/sql-createpolicy.html)) So a write test asserts on a thrown error; a read test asserts on an empty set.

Also: Postgres does not allow multiple operations in one `FOR` clause, and Supabase's guidance is to avoid `FOR ALL` entirely and write one policy per operation ([Supabase RLS prompt rules](https://supabase.com/docs/guides/ai-tools/ai-prompts/database-rls-policies)). `FOR ALL` with only a `USING` clause is a common AI-generated shape and it quietly applies that same expression as the insert check.

### 2.4 `SECURITY DEFINER` functions

A `security definer` function runs with its *creator's* privileges, so it bypasses the RLS of anything it touches. That is sometimes exactly what you want (breaking a policy-recursion loop, or avoiding a 178-second join — see §2.7), and sometimes a full authorization bypass wearing a helpful hat.

Three rules, all from Supabase's own docs:

1. **Always pin the search path**: `security definer set search_path = ''`, and schema-qualify every reference in the body. Without it the function inherits the caller's `search_path`, and an attacker can "direct the function to use unexpected objects, such as tables or other functions, that the malicious user controls." ([lint 0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [Database Functions](https://supabase.com/docs/guides/database/functions))
2. **Never create one in an exposed schema.** Supabase: *"Never create"* a security definer function in a schema listed under Exposed schemas. A definer function in `public` is callable directly over the REST API by anyone holding the publishable key. Two dedicated advisors exist for exactly this: **0028 `anon_security_definer_function_executable`** and **0029 `authenticated_security_definer_function_executable`**. ([Database Advisors](https://supabase.com/docs/guides/database/database-advisors))
3. **Prefer `security invoker`**, which is the default. Supabase: *"It is best practice to use `security invoker` (which is also the default)."*

For Foundit, the only definer functions are the two collection helpers and the two triggers in §1.3 — all in `private`, all with pinned search paths, with `execute` revoked from `anon` where it isn't needed.

### 2.5 Views bypass RLS by default

This is a Postgres default, not a Supabase quirk, and it surprises nearly everyone. From [`CREATE VIEW`](https://www.postgresql.org/docs/current/sql-createview.html):

> *"If any of the underlying base relations has row-level security enabled, then by default, the row-level security policies of the view owner are applied... However, if the view has `security_invoker` set to `true`, then the policies and permissions of the invoking user are used instead."*

`security_invoker` arrived in Postgres 15 and remains **opt-in** — *"That's still the default"* refers to the owner-privileges behaviour ([PG15 release notes](https://www.postgresql.org/docs/release/15.0/)). So a view you create in the SQL editor (owned by `postgres`) over an RLS-protected table serves *every row* to anyone who queries the view through the API. Supabase flags this as **lint 0010 `security_definer_view`**, noting that "views in the public schema are accessible over Supabase APIs." ([lint 0010](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view))

The fix, on every view Foundit creates:

```sql
create view public.tool_stats with (security_invoker = on) as
  select t.id as tool_id,
         count(distinct l.user_id)   as like_count,
         count(distinct r.id)        as review_count,
         round(avg(rt.score), 2)     as avg_rating
  from public.tools t
  left join public.likes l    on l.tool_id  = t.id
  left join public.reviews r  on r.tool_id  = t.id
  left join public.ratings rt on rt.tool_id = t.id
  where t.status = 'published'
  group by t.id;
```

Two related traps:

- **`auth.users` must never be referenced from a view in `public`.** Lint 0002 `auth_users_exposed`: *"Referencing the `auth.users` table in a view can inadvertently expose more data than intended."* ([lint 0002](https://supabase.com/docs/guides/database/database-linter?lint=0002_auth_users_exposed)) Use the `profiles` table instead — which is the whole reason §1.3 has one.
- **Materialized views cannot respect RLS at all.** There is no `security_invoker` equivalent. Lint 0016: *"Materialized views can not be configured to respect Row Level Security (RLS) policies of the underlying tables."* ([lint 0016](https://supabase.com/docs/guides/database/database-linter?lint=0016_materialized_view_in_api)) If Foundit ever precomputes rankings into a matview, the only defence is to revoke access:

  ```sql
  revoke select on public.tool_rankings from public, anon, authenticated;
  -- verify:
  select pg_catalog.has_table_privilege('anon', 'public.tool_rankings'::regclass::oid, 'select');
  -- must return false
  ```

### 2.6 Never authorize on `user_metadata`

The highest-value single warning in Supabase's linter, and the one most likely to appear in AI-generated policies. **Lint 0015 `rls_references_user_metadata`:**

> *"user_metadata is designed to be manipulated by the user themselves."*

The flagged pattern:

```sql
-- CATASTROPHIC — do not do this
create policy bad_policy on public.tools for update to authenticated
using ( ((select auth.jwt()) -> 'user_metadata' ->> 'is_admin')::bool );
```

Bypassed by one client-side call:

```js
await supabase.auth.updateUser({ data: { is_admin: true } })
```

Supabase's summary: such policies "provide no real security. A malicious actor can self-elevate by setting any field to any value." ([lint 0015](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata))

The distinction to memorise ([RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security), [JWT fields](https://supabase.com/docs/guides/auth/jwt-fields)):

- `raw_user_meta_data` / `user_metadata` — **user-writable. Never for authorization.** Fine for a display name.
- `raw_app_meta_data` / `app_metadata` — not user-writable. Acceptable for authorization data.

For Foundit, the cleanest answer is to not put roles in the JWT at all. Ownership lives in `tools.owner_id`; that is a server-controlled column in your own table, and it is what every policy reads. If you later need an "operator" role, use a server-controlled `public.user_roles` table plus a [Custom Access Token Auth Hook](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac), not user metadata.

### 2.7 Performance cost of policies at scale

Supabase publishes benchmark numbers for this, adopted into its official troubleshooting docs from a community benchmark ([RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv); harness at [GaryAustin1/RLS-Performance](https://github.com/GaryAustin1/RLS-Performance)):

| Technique | Before | After |
|---|---|---|
| Index the column the policy filters on | 171 ms | < 0.1 ms |
| Wrap `auth.uid()` in `(select auth.uid())` | 179 ms | 9 ms |
| Wrap a joining helper function in `(select ...)` | 11,000 ms | 7 ms |
| Add a matching client-side `.eq()` filter | 171 ms | 9 ms |
| `security definer` function instead of an in-policy join | **178,000 ms** | 12 ms |
| Reverse the join direction | 9,000 ms | 20 ms |
| Add `TO authenticated` | — | sub-1 ms for anon requests |

The mechanism behind the second row: *"Wrapping the function causes an `initPlan` to be run by the Postgres optimizer, which allows it to 'cache' the results per-statement, rather than calling the function on each row."* Supabase enforces this via **performance advisor 0003 `auth_rls_initplan`**.

Concretely for Foundit's likely hot path — a catalogue-wide search across `tools` joined to `tool_stats` — the things that matter are:

- Every column named in a policy has a btree index with that column **first**. §1.3 does this: `tools_owner_id_idx`, `tools_status_idx`, `reviews_author_id_idx`, and so on. *"A column counts as indexed only when it comes first in a `btree` index."*
- Every `auth.uid()` is wrapped in `(select ...)`. §1.3 does this everywhere.
- Every policy names `TO`. Supabase's guidance: *"Always add 'authenticated' to the approved roles instead of nothing or public."* For an anonymous search — Foundit's most common request by far — this short-circuits the policy body before any `auth.uid()` call runs.
- Do not use RLS as your query filter. *"Do not rely on RLS for filtering but only for security"* — still write `.eq('status', 'published')` in the client query.
- Watch **advisor 0006 `multiple_permissive_policies`**: two permissive SELECT policies on `tools` (as §1.3 has, deliberately) means both expressions run on every read. That is the correct trade here, but it is a cost to be aware of if `tools` grows large.

### 2.8 Testing policies — the officially documented route

Supabase documents pgTAP run through the CLI ([Testing overview](https://supabase.com/docs/guides/local-development/testing/overview), [Database testing](https://supabase.com/docs/guides/database/testing)):

```bash
supabase test new reviews_rls.test
supabase test db
```

And it documents impersonating a user inside a transaction:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'maintainer@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'reviewer@test.com');

-- ... seed a tool owned by the maintainer and a review by the reviewer ...

-- Act as the MAINTAINER and prove R1 holds.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$ delete from public.reviews where id = '<review-id>' $$,
  'A tool owner must not be able to delete a review of their tool'
);
select is_empty(
  $$ update public.reviews set body = 'nope' where id = '<review-id>' returning id $$,
  'A tool owner must not be able to edit a review of their tool'
);

select * from finish();
rollback;
```

Two things about this that are easy to get wrong:

- **`set local role authenticated` is not optional.** Table owners bypass RLS: *"Table owners normally bypass row security as well."* ([Postgres RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)) Testing a policy in the Supabase SQL editor as `postgres` shows you every row and tells you nothing. If you want the owner subject to policies too, `alter table public.reviews force row level security;`.
- **Use the right assertion for the right failure mode.** `throws_ok` for a `WITH CHECK`/grant violation (error `42501`); `is_empty` for a `USING` filter (no error). Mixing them up produces a test that passes for the wrong reason.

pgTAP also offers policy-shape assertions worth pinning R1 with: `policies_are()`, `policy_roles_are()`, `policy_cmd_is()` ([pgTAP](https://supabase.com/docs/guides/database/extensions/pgtap)). Asserting that `public.reviews` has *exactly* the expected set of policies means a future migration that adds a maintainer-can-delete policy fails CI.

For a non-developer, the pragmatic alternative to writing pgTAP is: sign in as two throwaway accounts in two browsers and try, by hand, every cell of the §1.2 table that should say ❌. Write down what you tried. It is worth an hour.

### 2.9 Run the advisors

Supabase ships a linter that catches most of this section automatically. Dashboard → **Advisors** → Security. Run it after every schema change. Index: [Database Advisors](https://supabase.com/docs/guides/database/database-advisors).

Security lints relevant to Foundit:

| ID | Lint | Why it matters here |
|---|---|---|
| [0002](https://supabase.com/docs/guides/database/database-linter?lint=0002_auth_users_exposed) | `auth_users_exposed` | A view over `auth.users` leaks emails |
| [0007](https://supabase.com/docs/guides/database/database-linter?lint=0007_policy_exists_rls_disabled) | `policy_exists_rls_disabled` | Policies that do nothing |
| [0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | `rls_enabled_no_policy` | Feature broken, not leaking |
| [0010](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view) | `security_definer_view` | §2.5 |
| [0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) | `function_search_path_mutable` | §2.4 |
| [0013](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public) | `rls_disabled_in_public` | **The one that matters most** |
| [0015](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata) | `rls_references_user_metadata` | §2.6 |
| [0023](https://supabase.com/docs/guides/database/database-linter?lint=0023_sensitive_columns_exposed) | `sensitive_columns_exposed` | Catches an email column on `profiles` |
| [0025](https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing) | `public_bucket_allows_listing` | §8.6 |
| [0026](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed) | `pg_graphql_anon_table_exposed` | The GraphQL endpoint is a second door onto the same tables |
| [0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) / [0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | definer functions callable over the API | §2.4 |

---

## 3. Key handling

### 3.1 Current naming — Supabase renamed the keys

Confirmed as of 2026-09-10. Supabase has moved from JWT-based `anon`/`service_role` keys to a new pair, and **the legacy keys are being deprecated by the end of 2026**. ([API Keys](https://supabase.com/docs/guides/api/api-keys), [Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys))

| Legacy (deprecated end of 2026) | Current | Format | Where it may live |
|---|---|---|---|
| `anon` key (a JWT) | **publishable key** | `sb_publishable_...` | Browser, mobile app, CLI, source control — all fine |
| `service_role` key (a JWT) | **secret key** | `sb_secret_...` | Server only. Never anywhere else. |

Differences that matter operationally:

- **They are not JWTs.** They no longer touch the project's JWT secret. Consequently they must be sent on the **`apikey` header only** — passing one as `Authorization: Bearer` makes the platform try to parse it as a JWT and reject the request with `Invalid JWT`. ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys))
- **You can have several secret keys and revoke them individually**, without touching the asymmetric signing key pair, and *"Rotating new API keys does not invalidate existing user sessions."* Under the legacy scheme, rotating `service_role` meant rotating the shared JWT secret and signing everyone out. This alone is a good reason to start on the new keys.
- **Creating new keys does not disable the legacy ones.** They coexist until you explicitly disable the legacy pair in Settings → API Keys. That is a separate, deliberate step.

**Recommendation for Foundit:** create the project with publishable + secret keys from day one and disable the legacy `anon`/`service_role` keys before launch. Do not build on something scheduled for removal within the year.

Related and worth enabling: Supabase has moved JWT signing from a shared HS256 secret to **asymmetric signing keys** (NIST P-256 recommended as *"a faster alternative than RSA, while providing comparable security"*; RSA 2048 also supported), with public keys published at the JWKS endpoint `https://<project-id>.supabase.co/auth/v1/.well-known/jwks.json`. Keys move through *standby → current → previously used*, giving zero-downtime rotation that does not sign users out. ([JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)) This is what makes local JWT verification in Next.js viable — see §4.5.

### 3.2 What the publishable key is allowed to be

It is allowed to be **public**. That is its design. It is in your JavaScript bundle, visible in DevTools, and fine in a public GitHub repo. Supabase describes its use cases as *"Browser, mobile apps, CLIs, source code."* ([API Keys](https://supabase.com/docs/guides/api/api-keys))

But that safety is entirely conditional on one thing: **the publishable key grants the `anon` Postgres role, and the `anon` role's reach is defined solely by your grants and RLS policies.** A publishable key against a database with RLS disabled on one table is equivalent to publishing that table. There is no second layer. This is why §2.1 is the highest-severity item in this document and not a footnote.

Do not treat the project URL as a secret either. It appears in every network request the browser makes.

### 3.3 What the secret key must never touch

The secret key authorizes the `service_role` Postgres role, which carries the **`BYPASSRLS`** attribute. ([API Keys](https://supabase.com/docs/guides/api/api-keys), [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)) `BYPASSRLS` is total, not partial: *"Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when accessing a table."* ([Postgres RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html))

Supabase's warnings are unusually blunt: it *"bypasses Row Level Security, so it must never leave your control"*; *"Never put one in a browser, a shipped application, or source control"*; *"Exposing a secret key puts all of your project's data at risk"*; *"Delete a leaked key immediately."* ([API Keys](https://supabase.com/docs/guides/api/api-keys))

**If a secret key reaches the browser**, an attacker with it can, against your project, over plain HTTPS, with `curl`:

- read every row of every table, including any user email you ever stored;
- write, modify or delete every row — every review, rating, listing and collection in the product;
- call the Auth admin API: enumerate users, change emails, delete accounts;
- read and write every Storage bucket regardless of bucket policy;
- do all of the above from anywhere, with no rate limit that RLS could impose.

Every policy in §1.3 becomes decorative. Note that Supabase now also returns HTTP 401 when it detects a secret key being used from a browser ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)) — a useful backstop, but not a defence you should rely on, since an attacker who has extracted the key will not use it from a browser.

**If it happens:** revoke the key in Settings → API Keys *first*. With the new key scheme this is a single-key revocation that does not sign users out. Rewriting git history is secondary and much less urgent — treat any key that has ever been in a public repo as permanently compromised regardless of what the history now says.

### 3.4 Next.js: how a secret gets into the browser by accident

Next.js inlines any environment variable prefixed `NEXT_PUBLIC_` into the client bundle at **build time**. The prefix is the entire mechanism, and it is a one-way door: once a value is built into the bundle, it is public forever, for that deployment. So:

- `NEXT_PUBLIC_SUPABASE_URL` — correct, intended to be public.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — correct.
- `NEXT_PUBLIC_SUPABASE_SECRET_KEY` — a catastrophe, and it will not error, warn, or fail to build.
- `SUPABASE_SECRET_KEY` — correct: no prefix, server-only.

The dangerous half of the rule is the *other* direction: an unprefixed variable is not automatically safe if you reference it from a component that ends up in the client graph. Guard it mechanically rather than by care:

```ts
// lib/supabase/admin.ts
import 'server-only'          // build fails if this module is imported from a client component
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

The `server-only` package turns "I hope nobody imports this into a client component" into a build error. For a non-developer relying on AI-generated code, that shift from discipline to mechanism is the whole point.

**A hard rule for Foundit:** exactly one file in the entire repo may read `SUPABASE_SECRET_KEY`, and that file starts with `import 'server-only'`. Grep for it before every deploy:

```bash
grep -rn "SECRET_KEY\|SERVICE_ROLE" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

### 3.5 Where secrets belong

**Vercel** — Project Settings → Environment Variables, scoped per environment (Production / Preview / Development). Never in `vercel.json`, never in the repo.

Vercel also offers **Sensitive Environment Variables**: once set, the value is write-only and cannot be read back through the dashboard, CLI or API. Use it for `SUPABASE_SECRET_KEY` and any LLM provider key.

Note the preview-deployment trap: preview builds get whatever variables are scoped to Preview. If you scope the secret key to Preview, every preview URL — which are guessable and sometimes indexed — runs code holding it. For Foundit, scope `SUPABASE_SECRET_KEY` to **Production only**, and point previews at a separate Supabase project.

**GitHub** — `.env*` must be in `.gitignore` (Next.js's `create-next-app` template includes `.env*` by default; verify it rather than assume). Enable **secret scanning and push protection** on the repository — both are free for public repositories, and push protection blocks a push that contains a recognised secret pattern rather than merely alerting after the fact. ([GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning))

**Local** — `.env.local`, which Next.js gitignores by default.

**Never** — in the repo, in a Slack message, in an AI chat transcript you later paste into a public issue, or in a screenshot of your terminal.

---

## 4. Auth specifics

### 4.1 Google sign-in

Setup, per [Supabase's Google provider docs](https://supabase.com/docs/guides/auth/social-login/auth-google):

1. Create a Google Cloud project; configure the consent screen (Audience, Data Access, Branding).
2. Scopes required by Supabase Auth: `openid` (**must be added manually** — it is not a default), `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Nothing else.
3. Create an OAuth client of type **Web application**.
   - Authorized JavaScript origins: `https://foundit.example` (plus `http://localhost:3000` for dev).
   - Authorized redirect URI: the callback URL shown on the Supabase dashboard's Google provider page — `https://<project-ref>.supabase.co/auth/v1/callback`. For local Supabase, `http://127.0.0.1:54321/auth/v1/callback`.
4. Paste Client ID and Client Secret into Supabase → Authentication → Providers → Google.

Gotchas that actually cost time:

- **Do not add sensitive or restricted scopes.** Supabase warns directly that doing so "may trigger verification, which takes considerable time." `email` + `profile` + `openid` are basic scopes and do not require Google's app verification. Adding Drive, Gmail or Calendar scopes drops you into a review process that can take weeks. Foundit needs none of them.
- **The consent screen shows your Supabase project ref by default.** Users see `xxxxxxxx.supabase.co` asking for their Google account, which reads as phishing. Supabase's own recommendation: *"It's strongly recommended you set up a custom domain and optionally verify your brand"* — use `auth.foundit.example` rather than exposing the project id. Custom domains are a paid Supabase add-on; budget for it or accept the conversion loss.
- **Third-party cookie phase-out.** If you use the Google-rendered button or One Tap, set `data-use_fedcm_for_prompt="true"` so it works under FedCM as Chrome removes third-party cookies.
- **`signInWithOAuth` vs `signInWithIdToken`.** The redirect flow (`signInWithOAuth`) is simpler and is what Foundit should ship first. One Tap uses `signInWithIdToken`, which needs a **nonce**: generate 32 random bytes, SHA-256 them, send the *hash* to Google and the *raw* value to `signInWithIdToken`. Getting this backwards is the single most common One Tap bug, and skipping the nonce entirely removes replay protection on the ID token.

### 4.2 Apple sign-in — the fiddly one

Apple's web flow has more moving parts than every other provider combined, and one of them **expires**. From [Supabase's Apple docs](https://supabase.com/docs/guides/auth/social-login/auth-apple):

**Setup, in order:**

1. **An active Apple Developer account** is required. (Paid membership — see §10 for what could not be confirmed about the fee.)
2. **Register email sources for "Sign in with Apple for Email Communication"** in the Services section of the Apple Developer Console. This is the step everyone skips, and §4.2's "private relay" problem below is what it causes.
3. **Create an App ID** (e.g. `com.foundit.app`) with *Sign in with Apple* enabled in Capabilities.
4. **Create a Services ID** (e.g. `com.foundit.app.web`) — a *separate* identifier. **The Services ID is the `client_id` for web sign-in.** This is the distinction that trips people up: the App ID is not what the web flow authenticates as.
5. Configure the Services ID: set the App ID as Primary App ID, add your domain, and set the Return URL to `https://<project-ref>.supabase.co/auth/v1/callback`.
6. Leave **Server-to-Server Notification Endpoint blank** — Supabase Auth does not support it.
7. **Create a signing key**, download the `.p8` file, and store it somewhere you will still have it in six months.
8. Generate the client secret from the `.p8` and enter Team ID, Key ID, Services ID and the generated secret into Supabase.
9. If Foundit ever adds a native iOS app, **list the Services ID first** in the Client IDs field. Supabase: *"list this Services ID as the **first** entry."* Getting the order wrong breaks web sign-in specifically.

**The gotchas, ranked by how much pain they cause:**

- **The client secret expires and must be regenerated every 6 months.** Supabase: *"Apple requires you to generate a new secret key every 6 months using the signing key (`.p8` file)."* A missed rotation *"will cause authentication failures"* — meaning Apple sign-in silently breaks for everyone, six months after launch, with no warning email. Supabase's own advice is to *"Set a recurring calendar reminder for every 6 months."* **Do that on the day you configure it, not later.** Note this applies to the OAuth/web flow only; native flows do not need rotation. This is the single most likely cause of a production auth outage in Foundit's first year.
- **Return URLs must be HTTPS and cannot be localhost.** Because the return URL is Supabase's hosted callback, you inherit a valid HTTPS endpoint for free — this is a genuine reason to use Supabase's callback rather than your own. But it also means you cannot test Apple sign-in against a local Supabase instance the way you can with Google.
- **Email and full name arrive only on the FIRST authorization, and never again.** Supabase: *"Apple only provides the user's full name during the **first sign-in attempt**"*; all later sign-ins return `null`. The identity token does not carry the name at all. If your signup handler drops it, it is gone permanently — the only way to get it back is for the user to revoke access in their Apple ID settings and re-authorize, at which point *"Apple will provide the full name again as if it were a first sign-in."* **Capture and persist name and email in the very first `handle_new_user` write** (the trigger in §1.3 does this), or use `updateUser` immediately after first sign-in.
- **Hide My Email gives you a `@privaterelay.appleid.com` address.** It is a real, deliverable address — but only if you completed step 2 above. If you did not register your sending domain with Apple's Private Email Relay service, mail to relay addresses **bounces**. For Foundit this has a specific and nasty consequence: a user who signs up with Apple + Hide My Email, then later tries the 6-digit email code flow to sign in, **will never receive the code**. Test this exact path before launch.
- **Do not treat the relay address as a stable identity.** A user can disable email forwarding at any time from their Apple ID settings, and the address dies. Key users on `auth.users.id`, never on email — which the schema in §1.3 already does.
- **Account deletion.** Apple's App Store Review Guideline 5.1.1(v) requires apps offering account creation to also offer in-app account deletion. Foundit should ship account deletion regardless (§7.3) — GDPR Article 17 requires it independently — so this is moot in practice, but note it if a native app is ever planned. See §10 for the limits of what could be confirmed about whether 5.1.1(v) reaches a pure web app.

### 4.3 The 6-digit email code

Supabase treats magic links and email OTP as the same underlying flow, differing only in the email template. ([Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless))

**To get a code instead of a link**, edit the *Magic Link* email template in the dashboard to use `{{ .Token }}`:

```html
<h2>Your Foundit sign-in code</h2>
<p>Enter this code to sign in: <strong>{{ .Token }}</strong></p>
<p>It expires shortly. If you didn't request it, ignore this email.</p>
```

If the template still contains `{{ .ConfirmationURL }}` (or `{{ .SiteURL }}` + `{{ .TokenHash }}`), users get a link. **This template edit is the entire switch** — there is no separate "OTP mode" toggle. Forgetting it is why people think they have shipped codes and have actually shipped magic links.

Client side:

```ts
// request
await supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: true, captchaToken },
})
// verify
await supabase.auth.verifyOtp({ email, token: '123456', type: 'email' })
```

`shouldCreateUser: false` turns the flow into sign-in-only for existing users. Foundit wants `true` (sign-in and sign-up are one flow), but be aware that `true` means **anyone can cause an email to be sent to any address** — that is the abuse vector covered in §5.

**Expiry and rate limits** ([passwordless docs](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Rate limits](https://supabase.com/docs/guides/auth/rate-limits)):

- Default OTP expiry: **1 hour**. Supabase's security advisor flags anything above one hour, and the docs say an expiry over 86,400 seconds *"is strongly discouraged and can only be set via the Management API."*
- **Set it to 600 seconds (10 minutes).** One hour is a long window for a 6-digit code sitting in an inbox. Ten minutes is comfortable for a real user and cuts the brute-force and shoulder-surfing window by 83%.
- A new OTP can be requested only once per **60 seconds** per address.

Supabase Auth's default rate limits:

| Operation | Default | Configurable |
|---|---|---|
| Emails sent (built-in provider) | **2 per hour** | Yes, with custom SMTP |
| Sign-ups / sign-ins | 30 requests per 5 min | Yes |
| OTP / magic link requests | 60-second window per address | Yes |
| Verification attempts | 30 requests per 5 min | Yes |
| Token refresh endpoint | 150 requests per 5 min | Yes |
| MFA challenges | 15 per minute | **No** |
| Anonymous sign-ins | 30 per hour | Yes |

> **The built-in email provider sends 2 emails per hour, project-wide.** That is a testing facility, not a production one. Foundit's *only* email-based sign-in method will be dead on arrival at launch unless you configure custom SMTP first. Supabase explicitly recommends custom SMTP or a Send Email hook for production. ([Rate limits](https://supabase.com/docs/guides/auth/rate-limits))

Configure a real SMTP provider (Resend, Postmark, SES — all have usable free or cheap tiers) **before** launch, set SPF/DKIM/DMARC on the sending domain, and then set the Supabase email rate limit to something bounded but realistic (e.g. 30/hour to start). Leaving it unbounded is how a spammer turns your sending domain's reputation into a smoking hole.

### 4.4 Emailed codes vs magic links

Foundit chose 6-digit codes. That is defensible, and here is the honest ledger.

**Where codes are safer:**

- **Link-scanning defeats magic links.** Corporate email security gateways, Outlook Safe Links, and antivirus scanners fetch every URL in an inbound message to check it. A magic link is single-use, so the scanner consumes it and the user's click gets "this link has expired." A 6-digit code in the message body is inert to scanners. This is a reliability problem that reads to users as a security failure, and it is the strongest argument for codes.
- **Codes survive cross-device flows.** The user requests on a laptop and reads the code on a phone; there is no "the link opened in the wrong browser and the session is on the wrong device" failure.
- **Codes do not leak in forwards.** A forwarded magic link is a working credential. A forwarded code is too, but the code is visibly a secret and users treat it as one — whereas people forward "here's the email I got" links without thinking.
- **No token in a URL.** URLs land in browser history, `Referer` headers, and server logs. (Supabase's magic link flow uses PKCE and a token hash rather than a raw token, which mitigates this, but the general principle holds.)

**Where codes are riskier:**

- **Codes are phishable over a voice or chat channel.** "Hi, this is Foundit support, can you read me the code we just sent?" works on a code and does not work on a magic link, because there is nothing for the victim to read out. This is a real and common attack pattern against SMS/email OTP.
- **6 digits is a 1-in-1,000,000 guess.** Security therefore rests entirely on the verification rate limit (30 attempts per 5 minutes by default) and the expiry window. With a 1-hour expiry and no per-address attempt cap beyond the global one, the numbers are less comfortable than they look. **Shortening expiry to 10 minutes is the single highest-value setting change here.**
- **Neither is phishing-resistant.** A real-time reverse proxy phishing kit defeats both. Only WebAuthn/passkeys are phishing-resistant. If Foundit ever holds anything worth stealing, passkeys are the upgrade path.

**Net recommendation:** keep the 6-digit code, set expiry to 600s, enable CAPTCHA on the auth endpoints (§5.2), and put a plainly-worded line in the email: *"Foundit will never ask you for this code. We will never call or message you about it."* That one sentence is the mitigation for the phishing gap.

### 4.5 Sessions and JWTs in Next.js server components

Use `@supabase/ssr` with `createServerClient` and cookie handlers, plus a proxy/middleware layer to refresh expired tokens — Next.js Server Components cannot write cookies, so the refresh has to happen upstream of rendering. ([Server-side auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs))

**The rule that matters, verbatim from Supabase:**

> *"Never trust `supabase.auth.getSession()` inside server code such as Proxy. It isn't guaranteed to revalidate the Auth token."*

`getSession()` reads the cookie and hands back what is in it. The cookie is attacker-controllable. On the server it tells you what the client *claims*, not what is true.

The current guidance names three functions, and the recommendation has moved:

| Function | What it does | Use for |
|---|---|---|
| `getClaims()` | Verifies the JWT signature locally against the project's published JWKS | **Protecting pages and data — the recommended default** |
| `getUser()` | Network call to the Auth server to fetch the current user record | When you need fresh user state, or before a destructive action |
| `getSession()` | Returns raw session/token data with no validation | Client-side convenience only. **Never for an authorization decision on the server.** |

Supabase: *"Always use `supabase.auth.getClaims()` to protect pages and user data"* because it *"validates the JWT signature against the project's published public keys every time."* This is the payoff of the asymmetric signing keys in §3.1 — you get cryptographic verification without a network round trip per request, which matters when every page render would otherwise call the Auth server.

**Two structural rules that no library will enforce for you:**

1. **Middleware is not authorization.** [CVE-2025-29927](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass) was a **critical**-severity bypass: sending an `x-middleware-subrequest` header caused Next.js to skip middleware execution entirely. Affected 12.x, 13.x, 14.x and 15.x; patched in 14.2.25, 15.2.3, 13.5.9 and 12.3.5. Vercel-hosted apps were protected by Vercel's decoupled routing, but self-hosted ones were fully exposed. Vercel's own conclusion: *"We do not recommend Middleware to be the sole method of protecting routes in your application."* Middleware is for refreshing sessions and for cheap redirects. **The real check goes in the page, the route handler, and — for Foundit — in RLS.**
2. **Server Actions and Route Handlers are public HTTP endpoints.** They are not "internal functions"; anyone can invoke them with `curl`. Every one must independently establish who the caller is (`getClaims()`) and what they may do. Hiding a button in the UI is not authorization.

For Foundit specifically, this is where RLS earns its keep. Even if an AI-generated route handler forgets its check, the query still runs as `authenticated` with that user's JWT, and the policies in §1.3 still apply. That safety net exists **only** for queries made with the user's own client — a query made with the secret key bypasses it entirely, which is why §8.8 exists.

**Cookie hygiene:** `@supabase/ssr` sets httpOnly, secure, SameSite cookies and uses the PKCE flow for the code exchange. Do not override these. Do not copy tokens into `localStorage` for convenience — an XSS (§6.2) then becomes a full account takeover rather than a defaced page.

---

## 5. Abuse and cost safety

A free public product with write endpoints has two failure modes that look identical from the outside: someone attacks you, or someone merely uses you enthusiastically. Both end with a bill or a dead service. Design for the bill.

### 5.1 What the platform gives you free

**Vercel Hobby** ([plan comparison](https://vercel.com/docs/plans/hobby)):

| Control | Hobby | Notes |
|---|---|---|
| DDoS mitigation | ✅ on by default | Plus optional [Attack Challenge Mode](https://vercel.com/docs/vercel-firewall/attack-mode) |
| WAF IP blocking | ✅ up to **3** entries | 100 on Pro |
| WAF custom rules | ✅ up to **3** rules | 40 on Pro |
| WAF rate limiting | ✅ **1 rule per project** | 1,000,000 allowed requests included |
| Managed rulesets | ❌ | Enterprise only |
| **Spend Management** | ❌ **Not available** | **Pro only** |

Rate limiting details on Hobby ([WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)): counting keys are **IP and JA4 digest**; algorithm is **fixed window**; window is **10s minimum, 10 minutes maximum**; actions are 429 / Log / Deny / Challenge. Note the caveat Vercel states plainly: *"Rate limit counters are tracked on a per-region basis; traffic matching a given rate limit key in multiple regions can exceed the limit you configure for any single region."* A distributed attacker gets a multiplier equal to the number of regions they hit.

**One rate-limit rule is a real constraint.** Spend it on the most expensive endpoint, which for Foundit is the LLM/embeddings search path. Something like: *if path starts with `/api/search`, rate limit 20 requests per 60s keyed on IP, action Challenge.* Use **Log** action first for a few days to see real traffic before switching to Deny — Vercel documents this staged approach.

**Two Hobby facts that need stating plainly:**

- **There is no spend cap on Hobby.** [Spend Management](https://vercel.com/docs/spend-management) — including the pause-all-projects action — requires a Pro team. What Hobby has instead is hard usage limits: *"if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again."* So Hobby fails by **going offline**, not by billing you. For a free hobby product that is arguably the right failure mode; just know that a scraper's reward is taking Foundit down for up to 30 days, not costing you money.
- **Hobby is non-commercial only.** Vercel's fair-use guidelines restrict Hobby to "non-commercial, personal use." Foundit as described (free, no ads, no payments) fits. Adding any monetisation means moving to Pro — at which point turn on Spend Management immediately, set the amount below your genuine pain threshold, and enable **Pause production deployment**. Note Vercel checks spend only "every few minutes," so set the number lower than the true maximum you would tolerate.

**Supabase built-ins:**

- Auth rate limits, all configurable in the dashboard (table in §4.3).
- Native **CAPTCHA on auth endpoints** — see §5.2.
- **Per-role `statement_timeout`**, which is the cheapest query-cost cap available. Defaults are `anon` **3s**, `authenticated` **8s** ([Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)). These are already sensible; the point is to *not raise them*, and to verify they are still in place:

  ```sql
  select rolname, rolconfig from pg_roles
  where rolname in ('anon','authenticated','service_role','postgres');
  -- to change: alter role anon set statement_timeout = '3s';
  -- then:      NOTIFY pgrst, 'reload config';
  ```

### 5.2 Bot protection without a CAPTCHA wall

**Cloudflare Turnstile** is the right answer here, and Supabase supports it natively.

Supabase Auth has built-in CAPTCHA support for **hCaptcha and Cloudflare Turnstile**, enabled at Authentication → Settings → *Bot and Abuse Protection → Enable CAPTCHA protection*. You paste the provider's secret key, add the widget client-side, and pass the token through `options: { captchaToken }` on sign-in/sign-up calls. ([Supabase CAPTCHA docs](https://supabase.com/docs/guides/auth/auth-captcha))

Turnstile's virtue for Foundit is that it is **not a CAPTCHA wall**. Its three modes are Managed (shows a checkbox only when risk warrants), Non-interactive, and **Invisible**. Crucially, it *"can be embedded into any website without sending traffic through Cloudflare"* — you do **not** need to move your DNS or proxy the site. ([Turnstile docs](https://developers.cloudflare.com/turnstile/))

Server-side verification, for your own write endpoints as well as Supabase's:

```
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
  secret=<your secret>&response=<token>&remoteip=<client ip>
```

Tokens are valid **300 seconds**, are **single-use**, and max 2048 characters. An optional `idempotency_key` (a UUID you generate) lets you safely retry a validation request. ([Server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/))

**Apply it to:** the email OTP request (§4.3 — otherwise anyone can trigger mail to any address), new tool submission, and first review from a new account. Do **not** apply it to search; that is the anonymous read path and challenging it destroys the product.

### 5.3 Rate limiting your own endpoints

Vercel's WAF gives you one rule. Everything else needs application-level limiting.

**Upstash Redis + `@upstash/ratelimit`** is the standard serverless answer: HTTP-based, so it works from edge and serverless functions where a TCP Redis connection cannot. It supports fixed window, sliding window and token bucket, plus an **ephemeral cache** to "handle blocked requests without having to call your Redis Database", per-identifier analytics, and a timeout-fail-open default. ([docs](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview))

**The free tier is the constraint:** 500,000 commands/month, 256 MB, 10 GB bandwidth, **1 database**. ([Upstash pricing](https://upstash.com/pricing/redis)) At roughly two commands per limited request, that is ~250,000 rate-limited requests a month. Fine for Foundit at launch; not a limit you can ignore at scale. Enable the ephemeral cache so repeat offenders are blocked in-process without spending commands.

```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const searchLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '60 s'),
  ephemeralCache: new Map(),   // blocks repeat offenders without a Redis round trip
  prefix: 'rl:search',
})

const writeLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '60 s'),
  prefix: 'rl:write',
})
```

**Suggested budgets** (tighten from data, do not loosen from hope):

| Endpoint | Per anonymous IP | Per signed-in user |
|---|---|---|
| Search (LLM/embeddings) | 20 / min, 200 / day | 60 / min, 1,000 / day |
| Submit a tool | n/a (auth required) | 5 / hour, 20 / day |
| Post a review or rating | n/a | 10 / hour, 30 / day |
| Like / unlike | n/a | 60 / min |
| Request an email code | 3 / hour per IP | 3 / hour per address |
| URL metadata fetch (§6.1) | n/a | 10 / hour |

**Getting the client IP right.** On Vercel, read `x-forwarded-for` (Vercel sets it; the platform proxy is the last hop, so the leftmost entry is the client) or the `x-real-ip` header. The trap is that **these headers are trivially spoofable if the request does not actually come through the platform proxy** — so never trust them in local development or behind a misconfigured custom proxy, and never use a header value as an authorization input. IP limiting also has inherent limits: carrier-grade NAT puts thousands of mobile users behind one address, and an IPv6 attacker has a /64 to rotate through, so **group IPv6 by /64 prefix** rather than by full address.

**Per-user limits are the stronger control** for write endpoints, because a user id costs an email round-trip to obtain. Layer both: IP limits stop the cheap flood, user limits stop the determined single account, and account-age gates (§5.4) stop the burner.

**A Postgres-only fallback**, if you would rather not add Upstash: a `rate_events(user_id, action, created_at)` table with an index on `(user_id, action, created_at)`, checked in a `BEFORE INSERT` trigger, plus a `pg_cron` job to delete rows older than a day. Advantages: no new service, no new key, and it is transactional with the write it guards. Disadvantages: it costs a database write per attempt (including blocked ones, which is exactly backwards under attack), and it cannot protect the search endpoint, which is where the money is. Use it for write-quota enforcement, not for flood control.

### 5.4 Review spam and fake listings

Layered, cheapest first:

1. **Structural constraints do most of the work, free.** §1.3 already enforces one review per user per tool (`unique (tool_id, author_id)`) and blocks self-review (the `not exists` clause on `tools.owner_id`). Those two constraints eliminate the two highest-volume spam shapes without any heuristics.
2. **Require a verified email before any write.** Every one of Foundit's three sign-in methods proves email control, so this is free — but confirm it is enforced, and note the Apple relay caveat in §4.2.
3. **Account-age and activity gates.** A brand-new account may not post a review for the first N minutes, and may not submit more than one listing on day one. Trivially implemented as a policy clause against `profiles.created_at`, and it defeats scripted burner accounts at near-zero cost.
4. **Block disposable email domains** at signup. Free open lists exist (e.g. the widely-used `disposable-email-domains` list on GitHub). Note that these lists are always behind, they cause false positives for privacy-conscious real users, and — importantly for Foundit — **Apple's `@privaterelay.appleid.com` must be allowlisted**, since it looks exactly like a disposable domain and is not one.
5. **A moderation queue, not deletion.** New listings from new accounts land in `status = 'draft'` and appear only after you look. Reviews publish immediately (delaying them destroys the feature) but are soft-hideable by the operator. `status` columns rather than `DELETE` also mean an abusive user's content can be pulled instantly and restored if you were wrong.
6. **A honeypot field** in the submission form — a visually hidden input that humans never fill and naive bots always do. Free, invisible to users, and catches the low-effort tier.
7. **Content moderation API** on review text before publishing, for the abuse/harassment tier rather than the spam tier. OpenAI's moderation endpoint is free to use with an API key; Google's Perspective API has a free quota. Both are optional for launch.
8. **Never let vote counts be the only signal.** If Foundit ranks by likes or average rating, ranking is an attack target and every mitigation above becomes load-bearing. Prefer a ranking that blends signals, and cap the influence of accounts younger than a threshold.

### 5.5 Protecting the embeddings budget from a scraper

This is Foundit's most direct money risk: a public, unauthenticated endpoint that turns a request into a paid API call. Treat it as a payment terminal.

**In priority order:**

1. **Cache aggressively on a normalized query hash.** Lowercase, trim, collapse whitespace, strip punctuation, then SHA-256. Store `query_hash → embedding` (and `query_hash → result set`) in Postgres with a `unique` index. Repeated and near-repeated queries then cost nothing. A scraper enumerating a wordlist will hit the cache constantly; a scraper generating novel queries is doing something visibly abnormal and is easy to detect. This single measure typically removes most of the spend.
2. **Precompute the catalogue side.** Embed each tool once at write time, never at read time. Only the *query* should ever need a live embedding call. If your search does per-request embedding of listings, that is a bug, not a cost.
3. **Cap the provider at the provider.** Set a hard monthly spend limit in the LLM provider's own billing console. This is the only control that cannot be defeated by a bug in your code, and it is the one most people skip. Do it before launch.
4. **Rate limit before you spend.** The limit check must run *before* the API call, and a blocked request must not touch the provider. Order matters: WAF rule → app rate limit → cache lookup → provider call.
5. **A daily global circuit breaker.** A single counter — "embedding calls today" — that hard-stops the expensive path and falls back to plain Postgres full-text search when it trips. Users get a degraded but working search instead of an outage, and your spend has a ceiling you chose. This is the highest-value hour of work in this whole section.
6. **Keep a free fallback path.** Postgres full-text search (`tsvector` + GIN index) costs nothing per query and is a perfectly reasonable degraded mode. Having it means the circuit breaker in (5) is cheap to trip.
7. **Consider requiring sign-in for semantic search specifically**, keeping keyword search anonymous. This trades reach for cost safety. Foundit's premise is anonymous search, so this is a fallback, not a default — but it is the lever to pull if the numbers go wrong, and building the toggle now is cheaper than building it in a crisis.
8. **Detect scraping patterns**, cheaply: sequential or alphabetical queries, no referrer, no JS-set header, request timing with sub-human variance, one IP producing more distinct queries in an hour than a human produces in a month. Log the shape of traffic per IP even if you do not act on it automatically; you cannot investigate what you did not record.

