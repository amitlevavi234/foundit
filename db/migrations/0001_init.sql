-- ===========================================================================
-- Foundit — 0001_init
--
-- The catalogue, the people, and the rules about who may touch what.
--
-- Two things about this file are load-bearing and must never be "fixed" away:
--
--   1. Every table has row-level security ENABLED and FORCED. Forced matters:
--      without it, the role that owns a table silently bypasses its own
--      policies, so everything looks protected and nothing is.
--
--   2. The application connects as `foundit_app`, which owns nothing and has
--      no BYPASSRLS. It announces who the current user is per request:
--          set local request.jwt.claims = '{"sub":"<user id>"}';
--      If that is ever missing, auth.uid() returns null and the request is
--      treated as an anonymous stranger. It fails closed, which is the only
--      acceptable direction to fail in.
--
-- Naming deliberately mirrors Supabase (auth.uid(), request.jwt.claims) so
-- these policies would port unchanged if this ever moves to managed hosting.
-- ===========================================================================

begin;

-- --- Extensions -----------------------------------------------------------
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- --- Roles ----------------------------------------------------------------
-- foundit_owner owns the schema. foundit_app is what the application logs in
-- as: no ownership, no superuser, no BYPASSRLS.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'foundit_app') then
    create role foundit_app login noinherit;
  end if;
end
$$;

-- --- Who is asking? -------------------------------------------------------
create schema if not exists auth;

-- Reads the per-request claim. `true` as the second argument means "return
-- null if unset" rather than raising, so an unauthenticated request is simply
-- nobody rather than an error.
create or replace function auth.uid()
returns text
language sql
stable
as $fn$
  -- The inner nullif matters: an anonymous request leaves the setting as an
  -- empty string, and casting that to jsonb raises rather than returning
  -- null. A stranger must be nobody, never an error.
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  );
$fn$;

comment on function auth.uid() is
  'The signed-in user id for this request, or null for a stranger.';

-- --- Shared updated_at ----------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- --- Enumerated types -----------------------------------------------------
-- Enum where the set is closed and changing it is a code change anyway;
-- a lookup table where a human edits the set (see categories).
create type tool_status   as enum ('draft', 'published', 'deprecated', 'removed');
create type pricing_model as enum ('free', 'freemium', 'free_trial', 'paid',
                                   'open_source', 'donation');
create type platform      as enum ('web', 'ios', 'android', 'windows', 'macos',
                                   'linux', 'browser_extension', 'cli', 'api',
                                   'self_hosted');
create type tool_flag     as enum ('works_offline', 'no_account_needed', 'no_ads',
                                   'has_free_tier', 'exports_data',
                                   'e2e_encrypted', 'accessible');
create type claim_status  as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type account_plan  as enum ('free', 'premium');

-- ===========================================================================
-- profiles — the app-side user record.
--
-- id is text and carries the id issued by the authentication library. The
-- foreign key to its user table is added in a later migration, once that
-- library has generated its own schema; putting it here would mean guessing.
-- ===========================================================================
create table public.profiles (
  id            text primary key,
  handle        citext not null unique,
  display_name  text check (length(display_name) <= 60),
  avatar_path   text,
  bio           text check (length(bio) <= 280),
  is_admin      boolean not null default false,
  plan          account_plan not null default 'free',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- The ::text cast is not decoration. citext's regex operators are
  -- case-insensitive, so without it '^[a-z0-9_]+$' cheerfully accepts 'AmitL'.
  constraint profiles_handle_format check (handle::text ~ '^[a-z0-9_]{3,24}$')
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.set_updated_at();

-- Security definer so the policy can read profiles.is_admin without the
-- caller needing rights on profiles. search_path is pinned to nothing so a
-- caller cannot shadow the objects this function resolves.
create or replace function auth.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$fn$;

-- ===========================================================================
-- categories — small editorial taxonomy, edited by a human, so a table.
-- ===========================================================================
create table public.categories (
  id          smallint generated always as identity primary key,
  slug        citext not null unique,
  name        text not null,
  description text,
  sort_order  smallint not null default 0
);

-- ===========================================================================
-- tools — the listing. Read on every page, so it carries its own counters
-- rather than aggregating six other tables on each render.
-- ===========================================================================
create table public.tools (
  id            bigint generated always as identity primary key,
  slug          citext not null unique,
  name          text not null check (length(name) between 1 and 120),
  -- https only. The link is rendered for visitors to click; nothing else is
  -- ever fetched from it by us.
  url           text not null unique check (url ~ '^https://'),
  summary       text not null check (length(summary) between 20 and 400),
  logo_path     text,
  pricing       pricing_model not null,
  platforms     platform[]  not null default '{}',
  languages     text[]      not null default '{}',
  flags         tool_flag[] not null default '{}',
  status        tool_status not null default 'draft',
  -- Only listings we seeded at launch may be claimed. A listing a person
  -- added belongs to them and can never be taken over.
  claimable     boolean not null default false,
  links         jsonb not null default '{}'::jsonb,
  submitted_by  text references public.profiles(id) on delete set null,
  owner_id      text references public.profiles(id) on delete set null,
  -- True when the person who added it ticked "I made this tool".
  made_by_owner boolean not null default false,

  like_count    integer not null default 0 check (like_count   >= 0),
  save_count    integer not null default 0 check (save_count   >= 0),
  open_count    integer not null default 0 check (open_count   >= 0),
  review_count  integer not null default 0 check (review_count >= 0),
  rating_sum    integer not null default 0 check (rating_sum   >= 0),
  rating_count  integer not null default 0 check (rating_count >= 0),
  rating_avg    numeric(3,2) generated always as (
                  case when rating_count > 0
                       then round(rating_sum::numeric / rating_count, 2)
                  end) stored,

  -- The lexical half of hybrid search. The two-argument form of to_tsvector
  -- is immutable; the one-argument form is not and cannot be used here.
  search_doc    tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(name, '')),    'A') ||
                  setweight(to_tsvector('english', coalesce(summary, '')), 'B')
                ) stored,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  constraint tools_published_has_date
    check (status <> 'published' or published_at is not null)
);
create trigger tools_touch before update on public.tools
  for each row execute function public.set_updated_at();

create index tools_search_doc_gin on public.tools using gin (search_doc);
create index tools_name_trgm      on public.tools using gin (name gin_trgm_ops);
create index tools_platforms_gin  on public.tools using gin (platforms);
create index tools_flags_gin      on public.tools using gin (flags);
create index tools_owner          on public.tools (owner_id) where owner_id is not null;
create index tools_browse on public.tools (rating_avg desc nulls last, like_count desc)
  where status = 'published';

-- ===========================================================================
-- tool_categories — many-to-many, composite natural key, no surrogate id.
-- ===========================================================================
create table public.tool_categories (
  tool_id     bigint   not null references public.tools(id) on delete cascade,
  category_id smallint not null references public.categories(id) on delete cascade,
  is_primary  boolean  not null default false,
  primary key (tool_id, category_id)
);
create index tool_categories_by_category on public.tool_categories (category_id, tool_id);
create unique index tool_categories_one_primary on public.tool_categories (tool_id)
  where is_primary;

-- ===========================================================================
-- tool_problems — the semantic unit of the whole product. One row per problem
-- statement, each with its own embedding. This is what search matches
-- against, which is why we store the problems a tool solves rather than the
-- marketing copy describing it.
-- ===========================================================================
create table public.tool_problems (
  id              bigint generated always as identity primary key,
  tool_id         bigint not null references public.tools(id) on delete cascade,
  statement       text not null check (length(statement) between 8 and 200),
  embedding       halfvec(512),
  embedding_model text,
  embedded_at     timestamptz,
  sort_order      smallint not null default 0,
  search_doc      tsvector generated always as (
                    to_tsvector('english', coalesce(statement, ''))
                  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Doubles as the tool_id index: a composite b-tree serves prefix lookups,
  -- so there is deliberately no separate index on (tool_id).
  constraint tool_problems_unique_per_tool unique (tool_id, statement),
  constraint tool_problems_embedding_pairs
    check ((embedding is null) = (embedded_at is null))
);
create trigger tool_problems_touch before update on public.tool_problems
  for each row execute function public.set_updated_at();

create index tool_problems_doc_gin on public.tool_problems using gin (search_doc);
-- The work queue for the embedding job: tiny partial index, near-zero cost.
create index tool_problems_needs_embedding on public.tool_problems (id)
  where embedding is null;

-- No vector index at launch, deliberately. An approximate index drops matches
-- when results are filtered, and this product filters on nearly every search.
-- An exact scan over a few thousand rows is milliseconds and never lies.

-- ===========================================================================
-- reviews — belong to whoever wrote them. Nobody else may ever change one.
-- ===========================================================================
create table public.reviews (
  id              bigint generated always as identity primary key,
  tool_id         bigint not null references public.tools(id) on delete cascade,
  author_id       text   not null references public.profiles(id) on delete cascade,
  rating          smallint not null check (rating between 1 and 5),
  solved_problem  boolean,
  ease_of_use     smallint check (ease_of_use between 1 and 5),
  worth_the_price smallint check (worth_the_price between 1 and 5),
  body            text check (length(body) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger reviews_touch before update on public.reviews
  for each row execute function public.set_updated_at();

-- Partial, so deleting a review does not block the author writing a new one.
create unique index reviews_one_live_per_author on public.reviews (tool_id, author_id)
  where deleted_at is null;
create index reviews_tool_recent on public.reviews (tool_id, created_at desc)
  where deleted_at is null;
create index reviews_author on public.reviews (author_id);

-- ===========================================================================
-- tool_likes — a pure join row. Composite natural key, no id, no updated_at.
-- ===========================================================================
create table public.tool_likes (
  user_id    text   not null references public.profiles(id) on delete cascade,
  tool_id    bigint not null references public.tools(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tool_id)
);

-- ===========================================================================
-- collections + items — a person's saved lists.
-- ===========================================================================
create table public.collections (
  id          bigint generated always as identity primary key,
  owner_id    text not null references public.profiles(id) on delete cascade,
  name        text not null check (length(name) between 1 and 60),
  slug        citext not null,
  description text check (length(description) <= 280),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, slug)
);
create trigger collections_touch before update on public.collections
  for each row execute function public.set_updated_at();

create table public.collection_items (
  collection_id bigint not null references public.collections(id) on delete cascade,
  tool_id       bigint not null references public.tools(id) on delete cascade,
  note          text check (length(note) <= 280),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (collection_id, tool_id)
);

-- ===========================================================================
-- tool_claims — a maker saying a seeded listing is theirs. One click, no
-- verification; the optional evidence is only read if two people claim one.
-- ===========================================================================
create table public.tool_claims (
  id           bigint generated always as identity primary key,
  tool_id      bigint not null references public.tools(id) on delete cascade,
  claimant_id  text   not null references public.profiles(id) on delete cascade,
  evidence_url text check (evidence_url ~ '^https://'),
  status       claim_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger tool_claims_touch before update on public.tool_claims
  for each row execute function public.set_updated_at();

create unique index tool_claims_one_approved on public.tool_claims (tool_id)
  where status = 'approved';
create unique index tool_claims_one_pending_per_person
  on public.tool_claims (tool_id, claimant_id) where status = 'pending';

-- ===========================================================================
-- search_events — what people asked for, never who asked.
--
-- query_text is kept for the aggregate "what people search for" panel and is
-- deliberately NOT joinable to a person: there is no user column here and
-- there never will be. "Describe your problem" collects health, money and
-- relationship troubles, and a transcript attached to a name is a liability
-- with no product value.
-- ===========================================================================
create table public.search_events (
  id            bigint generated always as identity primary key,
  query_text    text not null,
  query_hash    text not null,
  result_count  smallint not null,
  top_score     real,
  had_good_match boolean not null,
  latency_ms    integer,
  created_at    timestamptz not null default now()
);
create index search_events_recent on public.search_events (created_at desc);
create index search_events_hash   on public.search_events (query_hash);

-- ===========================================================================
-- Counters. Maintained by triggers so a results page is one index scan
-- rather than sixty aggregates.
-- ===========================================================================
create or replace function public.tool_likes_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.tools set like_count = like_count + 1 where id = new.tool_id;
  elsif tg_op = 'DELETE' then
    update public.tools set like_count = greatest(like_count - 1, 0) where id = old.tool_id;
  end if;
  return null;
end;
$$;
create trigger tool_likes_count after insert or delete on public.tool_likes
  for each row execute function public.tool_likes_count();

create or replace function public.collection_items_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.tools set save_count = save_count + 1 where id = new.tool_id;
  elsif tg_op = 'DELETE' then
    update public.tools set save_count = greatest(save_count - 1, 0) where id = old.tool_id;
  end if;
  return null;
end;
$$;
create trigger collection_items_count after insert or delete on public.collection_items
  for each row execute function public.collection_items_count();

-- Reviews are soft-deleted, so the counter follows deleted_at rather than the
-- row's existence.
create or replace function public.reviews_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  was_live boolean := (tg_op <> 'INSERT') and (old.deleted_at is null);
  is_live  boolean := (tg_op <> 'DELETE') and (new.deleted_at is null);
begin
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
  return null;
end;
$$;
create trigger reviews_count after insert or update or delete on public.reviews
  for each row execute function public.reviews_count();

-- ===========================================================================
-- Row-level security.
--
-- Enabled AND forced on every table. Forced is the part people forget: a
-- table's owner otherwise bypasses its own policies, so the policies read
-- correctly, the tests pass, and nothing is enforced.
-- ===========================================================================
alter table public.profiles         enable row level security;
alter table public.categories       enable row level security;
alter table public.tools            enable row level security;
alter table public.tool_categories  enable row level security;
alter table public.tool_problems    enable row level security;
alter table public.reviews          enable row level security;
alter table public.tool_likes       enable row level security;
alter table public.collections      enable row level security;
alter table public.collection_items enable row level security;
alter table public.tool_claims      enable row level security;
alter table public.search_events    enable row level security;

alter table public.profiles         force row level security;
alter table public.categories       force row level security;
alter table public.tools            force row level security;
alter table public.tool_categories  force row level security;
alter table public.tool_problems    force row level security;
alter table public.reviews          force row level security;
alter table public.tool_likes       force row level security;
alter table public.collections      force row level security;
alter table public.collection_items force row level security;
alter table public.tool_claims      force row level security;
alter table public.search_events    force row level security;

-- Is this tool visible to the person asking?
create or replace function public.tool_is_visible(p_tool_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tools t
     where t.id = p_tool_id
       and (t.status = 'published'
            or t.owner_id = auth.uid()
            or t.submitted_by = auth.uid()
            or auth.is_admin())
  );
$$;

-- May this person edit this listing? Whoever added it maintains it; an
-- approved claim transfers that to the maker.
create or replace function public.tool_is_mine(p_tool_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tools t
     where t.id = p_tool_id
       and auth.uid() is not null
       and (t.owner_id = auth.uid()
            or (t.owner_id is null and t.submitted_by = auth.uid())
            or auth.is_admin())
  );
$$;

-- --- profiles: public to read, yours to change ----------------------------
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- --- categories: read by all, changed by an admin -------------------------
create policy categories_read  on public.categories for select using (true);
create policy categories_write on public.categories for all
  using (auth.is_admin()) with check (auth.is_admin());

-- --- tools ----------------------------------------------------------------
create policy tools_read on public.tools for select
  using (status = 'published'
         or owner_id = auth.uid()
         or submitted_by = auth.uid()
         or auth.is_admin());

-- You may add a tool, credited to yourself and to nobody else.
create policy tools_insert on public.tools for insert
  with check (auth.uid() is not null and submitted_by = auth.uid());

create policy tools_update on public.tools for update
  using (public.tool_is_mine(id)) with check (public.tool_is_mine(id));

create policy tools_delete on public.tools for delete
  using (auth.is_admin());

-- --- tool_categories and tool_problems follow their tool ------------------
create policy tool_categories_read on public.tool_categories for select
  using (public.tool_is_visible(tool_id));
create policy tool_categories_write on public.tool_categories for all
  using (public.tool_is_mine(tool_id)) with check (public.tool_is_mine(tool_id));

create policy tool_problems_read on public.tool_problems for select
  using (public.tool_is_visible(tool_id));
create policy tool_problems_write on public.tool_problems for all
  using (public.tool_is_mine(tool_id)) with check (public.tool_is_mine(tool_id));

-- --- reviews: the one place ownership does NOT confer power ---------------
-- A live review is readable by anyone. Only its author may write it, and only
-- its author may soft-delete it. There is deliberately no policy granting the
-- tool's owner, or anyone else, any write access at all.
create policy reviews_read on public.reviews for select
  using (deleted_at is null or author_id = auth.uid() or auth.is_admin());
create policy reviews_insert on public.reviews for insert
  with check (auth.uid() is not null
              and author_id = auth.uid()
              and public.tool_is_visible(tool_id));
create policy reviews_update on public.reviews for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- --- likes ----------------------------------------------------------------
create policy tool_likes_read on public.tool_likes for select using (true);
create policy tool_likes_insert on public.tool_likes for insert
  with check (user_id = auth.uid() and public.tool_is_visible(tool_id));
create policy tool_likes_delete on public.tool_likes for delete
  using (user_id = auth.uid());

-- --- collections ----------------------------------------------------------
create policy collections_read on public.collections for select
  using (is_public or owner_id = auth.uid() or auth.is_admin());
create policy collections_write on public.collections for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy collection_items_read on public.collection_items for select
  using (exists (select 1 from public.collections c
                  where c.id = collection_id
                    and (c.is_public or c.owner_id = auth.uid() or auth.is_admin())));
create policy collection_items_write on public.collection_items for all
  using (exists (select 1 from public.collections c
                  where c.id = collection_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.collections c
                       where c.id = collection_id and c.owner_id = auth.uid()));

-- --- claims ---------------------------------------------------------------
create policy tool_claims_read on public.tool_claims for select
  using (claimant_id = auth.uid() or auth.is_admin());
create policy tool_claims_insert on public.tool_claims for insert
  with check (auth.uid() is not null
              and claimant_id = auth.uid()
              and exists (select 1 from public.tools t
                           where t.id = tool_id and t.claimable));
create policy tool_claims_admin on public.tool_claims for update
  using (auth.is_admin()) with check (auth.is_admin());

-- --- search events: written by the server, read only by an admin ----------
create policy search_events_read on public.search_events for select
  using (auth.is_admin());
create policy search_events_insert on public.search_events for insert
  with check (true);

-- ===========================================================================
-- Grants. The application role gets exactly the verbs it needs; the policies
-- above decide which rows those verbs may touch.
-- ===========================================================================
grant usage on schema public, auth to foundit_app;
grant execute on function auth.uid(), auth.is_admin() to foundit_app;
grant execute on function public.tool_is_visible(bigint), public.tool_is_mine(bigint)
  to foundit_app;

grant select on all tables in schema public to foundit_app;
grant insert, update on public.profiles, public.tools, public.tool_problems,
  public.tool_categories, public.reviews, public.collections,
  public.collection_items, public.tool_claims to foundit_app;
grant insert, delete on public.tool_likes to foundit_app;
grant delete on public.collection_items, public.tool_categories,
  public.tool_problems to foundit_app;
grant insert on public.search_events to foundit_app;
grant usage on all sequences in schema public to foundit_app;

commit;
