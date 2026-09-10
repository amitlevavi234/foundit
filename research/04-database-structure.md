# 04 — Database structure

**Product:** Foundit — describe a problem, get matching tools with a fit score.
**Target platform:** Supabase Postgres (15/17) with `pgvector`, `citext`, `pg_trgm`, `pg_cron`.
**Scale, year one:** ~5,000 tools · ~20,000 problem statements · ~20,000 reviews · ~100,000 likes · ~40,000 searches/month · read-dominated.
**Budget:** $100 total. This is the constraint that decides several design questions below, because the Supabase Free plan gives "500 MB database size (Shared CPU • 500 MB RAM)" and Pro is "$25/month" — four months of the entire budget ([supabase.com/pricing](https://supabase.com/pricing)).
**Date:** 2026-09-10.

---

## 0. The five decisions that matter

Everything else in this document is detail. These five are the ones that change the bill.

1. **Vectors are `halfvec(512)`, one per problem statement, stored as a column on `tool_problems`.** 20,000 vectors × 1,032 bytes = **20.6 MB**. The naive choice — `vector(1536)` — is 123 MB, six times larger, and blows past half the free tier on embeddings alone.
2. **No HNSW index at launch.** pgvector does exact search by default with perfect recall; its own troubleshooting guidance is that "If the table is small, a table scan may be faster." 20,000 vectors is small. Exact search also makes `WHERE status = 'published' AND platforms @> …` behave correctly, which an approximate index does not (§2.5).
3. **Search logs are range-partitioned by month with a 30-day retention.** Unpruned they are 137 MB/year — larger than the entire rest of the database. Pruned they are 12 MB, flat, forever (§5).
4. **Never store the query embedding.** 480,000 searches × 1,032 bytes = 495 MB/year. This single row-level choice is the difference between the free tier and a paid one.
5. **Counters are trigger-maintained columns on `tools`; per-tool activity metrics are a nightly rollup table, not a materialized view.** The rollup survives the deletion of the logs it was computed from; a materialized view does not (§3).

---

## 1. Entity-relationship description

```
auth.users (Supabase-managed)
    │ 1:1
    ▼
profiles ──────┬──────────────┬─────────────┬────────────────┐
               │ 1:N          │ 1:N         │ 1:N            │ 1:N
               ▼              ▼             ▼                ▼
           reviews       tool_likes    collections      tool_claims
               │              │             │ 1:N            │
               │ N:1          │ N:1         ▼                │ N:1
               │              │      collection_items        │
               │              │             │ N:1            │
               ▼              ▼             ▼                ▼
            ┌──────────────────────────────────────────────────┐
            │                     tools                        │
            │  (counter columns: like_count, save_count,       │
            │   review_count, rating_sum, rating_count,        │
            │   rating_avg generated; search_doc tsvector)     │
            └──────────────────────────────────────────────────┘
               │ 1:N             │ N:M                 │ 1:N
               ▼                 ▼                     ▼
        tool_problems      tool_categories      tool_metrics_daily
        (halfvec(512)        │ N:1              tool_metrics_monthly
         + tsvector)         ▼                        ▲
                         categories                   │ nightly rollup
                                                      │
                                            search_events (partitioned,
                                              30-day retention, no FKs)
```

Reading the diagram in words:

- **`profiles`** is the application's user table. Its primary key *is* `auth.users.id` (a uuid, not our choice — Supabase's). Everything a person creates hangs off it.
- **`tools`** is the centre of the graph and the only table that gets read on every page. It carries denormalised counters so that a page of 20 search results needs one index scan, not 20 aggregate subqueries.
- **`tool_problems`** is the semantic unit of the product: the short natural-language statements ("split expenses with friends while travelling"), several per tool, each with its own embedding and its own tsvector. Vector search runs here, then collapses to one row per tool.
- **`categories` ↔ `tools`** is many-to-many through `tool_categories`, with a flag marking the primary category.
- **`reviews`, `tool_likes`, `collections`/`collection_items`, `tool_claims`** are the social layer. Likes and collection items are pure join rows with natural composite keys and no surrogate id.
- **`search_events`** is the only high-volume table. It is deliberately outside the foreign-key graph (§7.5) and deliberately disposable.
- **`tool_metrics_daily`** / **`tool_metrics_monthly`** are the durable residue of the logs: small, aggregated, kept forever.

---

## 2. The DDL

One runnable block. Run it against a fresh local Supabase (`supabase db reset`) before it ever touches a project.

```sql
-- ===========================================================================
-- Foundit — schema v1
-- Postgres 15+ / Supabase, pgvector >= 0.7 (halfvec), pg_cron for maintenance.
-- ===========================================================================

-- --- Extensions ------------------------------------------------------------
-- Supabase convention: extensions live in the `extensions` schema, which is on
-- the default search_path for the postgres/authenticated/anon roles. Any
-- function declared `set search_path = ''` must schema-qualify these types.
create extension if not exists citext   with schema extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists vector   with schema extensions;
create extension if not exists pg_cron  with schema extensions;

-- --- Enumerated types ------------------------------------------------------
-- Enum where the set is closed, short, and owned by us (a new value is a code
-- change anyway). Lookup table where the set is open and editable by a human.
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

-- --- Shared updated_at trigger --------------------------------------------
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

-- ===========================================================================
-- profiles — the app-side user record; PK is dictated by Supabase auth.
-- ===========================================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        citext not null unique,
  display_name  text check (length(display_name) <= 60),
  avatar_path   text,
  bio           text check (length(bio) <= 280),
  is_moderator  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- NOTE the ::text cast. citext's regex operators are case-INSENSITIVE, so
  -- `handle ~ '^[a-z0-9_]+$'` would happily accept 'AmitL'. Cast to text first.
  constraint profiles_handle_format check (handle::text ~ '^[a-z0-9_]{3,24}$')
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- categories — small editorial taxonomy. Lookup table, not an enum: an
-- operator adds one from an admin screen, and it carries a description.
-- ===========================================================================
create table public.categories (
  id          smallint generated always as identity primary key,
  slug        citext not null unique,
  name        text not null,
  description text,
  sort_order  smallint not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger categories_touch before update on public.categories
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- tools — the listing. Read on every page, so it carries its own counters.
-- ===========================================================================
create table public.tools (
  id            bigint generated always as identity primary key,
  slug          citext not null unique,
  name          text not null check (length(name) between 1 and 120),
  url           text not null unique check (url ~ '^https?://'),
  summary       text not null check (length(summary) between 20 and 400),
  logo_path     text,                                   -- Storage object path
  pricing       pricing_model not null,
  platforms     platform[]  not null default '{}',
  languages     text[]      not null default '{}',      -- BCP-47 codes
  flags         tool_flag[] not null default '{}',      -- works_offline, ...
  status        tool_status not null default 'draft',
  claimable     boolean not null default false,         -- launch seeds only
  links         jsonb not null default '{}'::jsonb,     -- docs/github/pricing
  submitted_by  uuid references public.profiles(id) on delete set null,
  owner_id      uuid references public.profiles(id) on delete set null,

  -- Denormalised counters, maintained by triggers. See §3.
  like_count    integer not null default 0 check (like_count   >= 0),
  save_count    integer not null default 0 check (save_count   >= 0),
  review_count  integer not null default 0 check (review_count >= 0),
  rating_sum    integer not null default 0 check (rating_sum   >= 0),
  rating_count  integer not null default 0 check (rating_count >= 0),
  rating_avg    numeric(3,2) generated always as (
                  case when rating_count > 0
                       then round(rating_sum::numeric / rating_count, 2)
                  end) stored,

  -- Lexical half of hybrid search. Two-arg to_tsvector is IMMUTABLE; the
  -- one-arg form is not and cannot be used in a generated column.
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
create index tools_name_trgm      on public.tools using gin (name extensions.gin_trgm_ops);
create index tools_platforms_gin  on public.tools using gin (platforms);
create index tools_flags_gin      on public.tools using gin (flags);
-- The browse/sort path. Partial: 'draft' and 'removed' rows never appear.
create index tools_browse on public.tools (rating_avg desc nulls last, like_count desc)
  where status = 'published';
create index tools_owner on public.tools (owner_id) where owner_id is not null;

-- ===========================================================================
-- tool_categories — N:M. Composite natural key, no surrogate id.
-- ===========================================================================
create table public.tool_categories (
  tool_id     bigint   not null references public.tools(id)      on delete cascade,
  category_id smallint not null references public.categories(id) on delete restrict,
  is_primary  boolean  not null default false,
  primary key (tool_id, category_id)
);
-- Reverse direction: "all tools in category X". The PK covers tool_id -> cat.
create index tool_categories_by_category on public.tool_categories (category_id, tool_id);
-- At most one primary category per tool.
create unique index tool_categories_one_primary on public.tool_categories (tool_id)
  where is_primary;

-- ===========================================================================
-- tool_problems — THE semantic unit. One row per problem statement, its own
-- embedding and its own tsvector. Vector search runs here.
-- ===========================================================================
create table public.tool_problems (
  id              bigint generated always as identity primary key,
  tool_id         bigint not null references public.tools(id) on delete cascade,
  statement       text not null check (length(statement) between 8 and 200),
  embedding       halfvec(512),                 -- nullable: filled async
  embedding_model text,                         -- provenance for re-embedding
  embedded_at     timestamptz,
  sort_order      smallint not null default 0,
  search_doc      tsvector generated always as (
                    to_tsvector('english', coalesce(statement, ''))
                  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Doubles as the tool_id index: a composite b-tree serves prefix lookups,
  -- so there is deliberately NO separate index on (tool_id).
  constraint tool_problems_unique_per_tool unique (tool_id, statement),
  constraint tool_problems_embedding_pairs
    check ((embedding is null) = (embedded_at is null))
);
create trigger tool_problems_touch before update on public.tool_problems
  for each row execute function public.set_updated_at();

create index tool_problems_doc_gin on public.tool_problems using gin (search_doc);
-- Work queue for the embedding job. Tiny partial index, near-zero cost.
create index tool_problems_needs_embedding on public.tool_problems (id)
  where embedding is null;

-- NO HNSW INDEX AT LAUNCH. See §2 of the prose. When p95 latency demands it:
--   set maintenance_work_mem = '512MB';
--   create index concurrently tool_problems_embedding_hnsw
--     on public.tool_problems using hnsw (embedding halfvec_cosine_ops)
--     with (m = 16, ef_construction = 64);

-- ===========================================================================
-- reviews — star rating + text + sub-ratings. Sub-ratings are columns, not
-- jsonb, because they are aggregated.
-- ===========================================================================
create table public.reviews (
  id              bigint generated always as identity primary key,
  tool_id         bigint not null references public.tools(id) on delete cascade,
  author_id       uuid   not null references public.profiles(id) on delete cascade,
  rating          smallint not null check (rating between 1 and 5),
  solved_problem  boolean,
  ease_of_use     smallint check (ease_of_use between 1 and 5),
  worth_the_price smallint check (worth_the_price between 1 and 5),
  body            text check (length(body) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz          -- soft delete: author or moderator only
);
create trigger reviews_touch before update on public.reviews
  for each row execute function public.set_updated_at();

-- Soft delete + uniqueness: a PARTIAL unique index, so a deleted review does
-- not block the author from writing a new one.
create unique index reviews_one_live_per_author on public.reviews (tool_id, author_id)
  where deleted_at is null;
create index reviews_tool_recent on public.reviews (tool_id, created_at desc)
  where deleted_at is null;
create index reviews_author on public.reviews (author_id);

-- ===========================================================================
-- tool_likes — pure join row. Composite natural PK, no id, no updated_at.
-- ===========================================================================
create table public.tool_likes (
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  tool_id    bigint not null references public.tools(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tool_id)
);
-- Deliberately NO index on (tool_id): the only reason to have one would be
-- counting likes per tool, and tools.like_count already answers that. Cost of
-- the omission: deleting a tool seq-scans this table once. Saves ~2 MB.

-- ===========================================================================
-- collections + items
-- ===========================================================================
create table public.collections (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  slug        citext not null,
  title       text not null check (length(title) between 1 and 80),
  description text check (length(description) <= 500),
  is_public   boolean not null default false,
  item_count  integer not null default 0 check (item_count >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (owner_id, slug)
);
create trigger collections_touch before update on public.collections
  for each row execute function public.set_updated_at();
create index collections_public on public.collections (created_at desc)
  where is_public and deleted_at is null;

create table public.collection_items (
  collection_id bigint not null references public.collections(id) on delete cascade,
  tool_id       bigint not null references public.tools(id)       on delete cascade,
  note          text check (length(note) <= 280),
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (collection_id, tool_id)
);
-- "which of my collections already hold this tool" — genuinely queried.
create index collection_items_by_tool on public.collection_items (tool_id);

-- ===========================================================================
-- tool_claims — a maker claiming a launch-seeded listing.
-- ===========================================================================
create table public.tool_claims (
  id            bigint generated always as identity primary key,
  tool_id       bigint not null references public.tools(id) on delete cascade,
  claimant_id   uuid   not null references public.profiles(id) on delete cascade,
  status        claim_status not null default 'pending',
  evidence_url  text,
  evidence_note text check (length(evidence_note) <= 1000),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tool_claims_decision_pairs
    check ((status in ('pending','withdrawn')) = (decided_at is null))
);
create trigger tool_claims_touch before update on public.tool_claims
  for each row execute function public.set_updated_at();
-- A tool can be approved to exactly one owner, and a person can have one open
-- claim per tool. Both expressed as partial unique indexes.
create unique index tool_claims_one_approved on public.tool_claims (tool_id)
  where status = 'approved';
create unique index tool_claims_one_pending on public.tool_claims (tool_id, claimant_id)
  where status = 'pending';
create index tool_claims_queue on public.tool_claims (created_at)
  where status = 'pending';

-- ===========================================================================
-- search_events — the only high-volume table. Range-partitioned by month so
-- retention is a DROP TABLE, not a DELETE. NO foreign keys (see §7.5).
-- ===========================================================================
create table public.search_events (
  id               bigint generated always as identity,
  created_at       timestamptz not null default now(),
  user_id          uuid,          -- no FK: logs are facts, not relationships
  session_id       uuid not null, -- rotating, not an IP
  query_text       text not null check (length(query_text) <= 300),
  result_count     smallint not null default 0,
  top_score        real,
  matched_tool_ids bigint[] not null default '{}',   -- inline, not a child table
  clicked_tool_id  bigint,        -- filled by a later UPDATE on click-through
  latency_ms       integer,
  -- The partition key must be part of every unique constraint.
  primary key (id, created_at)
) partition by range (created_at);

create index search_events_created_at on public.search_events (created_at);

-- Bootstrap partitions. New ones are created by cron, below.
create table public.search_events_202609 partition of public.search_events
  for values from ('2026-09-01') to ('2026-10-01');
create table public.search_events_202610 partition of public.search_events
  for values from ('2026-10-01') to ('2026-11-01');

-- ===========================================================================
-- tool_metrics_daily / _monthly — the durable residue of the logs.
-- ===========================================================================
create table public.tool_metrics_daily (
  tool_id bigint not null references public.tools(id) on delete cascade,
  day     date   not null,
  matched integer not null default 0,
  opened  integer not null default 0,
  saved   integer not null default 0,
  primary key (tool_id, day)
);
create index tool_metrics_daily_by_day on public.tool_metrics_daily (day);

create table public.tool_metrics_monthly (
  tool_id bigint not null references public.tools(id) on delete cascade,
  month   date   not null,       -- first day of month
  matched integer not null default 0,
  opened  integer not null default 0,
  saved   integer not null default 0,
  primary key (tool_id, month)
);

-- ===========================================================================
-- Counter triggers. SECURITY DEFINER is REQUIRED: under RLS an ordinary user
-- has no UPDATE policy on tools, so an invoker-rights trigger would silently
-- fail to bump the counter.
-- ===========================================================================
create or replace function public.bump_like_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.tools set like_count = like_count + 1 where id = new.tool_id;
  else
    update public.tools set like_count = greatest(like_count - 1, 0)
      where id = old.tool_id;
  end if;
  return null;
end; $$;
create trigger tool_likes_counter after insert or delete on public.tool_likes
  for each row execute function public.bump_like_count();

create or replace function public.bump_save_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.tools       set save_count = save_count + 1 where id = new.tool_id;
    update public.collections set item_count = item_count + 1 where id = new.collection_id;
  else
    update public.tools       set save_count = greatest(save_count - 1, 0)
      where id = old.tool_id;
    update public.collections set item_count = greatest(item_count - 1, 0)
      where id = old.collection_id;
  end if;
  return null;
end; $$;
create trigger collection_items_counter
  after insert or delete on public.collection_items
  for each row execute function public.bump_save_count();

-- Reviews: store SUM and COUNT, never the average alone. An average cannot be
-- decremented correctly when a review is deleted or edited.
create or replace function public.apply_review_stats()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d_count int := 0; d_sum int := 0;
begin
  if tg_op = 'INSERT' and new.deleted_at is null then
    d_count := 1; d_sum := new.rating;
  elsif tg_op = 'DELETE' and old.deleted_at is null then
    d_count := -1; d_sum := -old.rating;
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null then d_count := d_count - 1; d_sum := d_sum - old.rating; end if;
    if new.deleted_at is null then d_count := d_count + 1; d_sum := d_sum + new.rating; end if;
  end if;
  if d_count <> 0 or d_sum <> 0 then
    update public.tools
       set review_count = review_count + d_count,
           rating_count = rating_count + d_count,
           rating_sum   = rating_sum   + d_sum
     where id = coalesce(new.tool_id, old.tool_id);
  end if;
  return null;
end; $$;
create trigger reviews_stats after insert or update or delete on public.reviews
  for each row execute function public.apply_review_stats();

-- ===========================================================================
-- Hybrid search: lexical (GIN/tsvector) fused with semantic (halfvec) by
-- Reciprocal Rank Fusion, one round trip. Collapses to one row per tool.
-- ===========================================================================
create or replace function public.search_tools(
  p_query      text,
  p_embedding  halfvec(512),
  p_platforms  platform[]  default null,
  p_flags      tool_flag[] default null,
  p_pricing    pricing_model[] default null,
  p_limit      int default 20,
  p_rrf_k      int default 50,
  p_w_semantic real default 1.0,
  p_w_lexical  real default 1.0
)
returns table (tool_id bigint, score real, best_statement text, best_distance real)
language sql stable
as $$
with eligible as (
  select p.id as problem_id, p.tool_id, p.statement, p.embedding, p.search_doc
  from public.tool_problems p
  join public.tools t on t.id = p.tool_id
  where t.status = 'published'
    and (p_platforms is null or t.platforms @> p_platforms)
    and (p_flags     is null or t.flags     @> p_flags)
    and (p_pricing   is null or t.pricing   = any(p_pricing))
),
semantic as (
  select tool_id, statement, dist,
         row_number() over (order by dist) as rank_ix
  from (
    select tool_id, statement, (embedding <=> p_embedding)::real as dist
    from eligible
    where embedding is not null
    order by embedding <=> p_embedding
    limit 120
  ) s
),
lexical as (
  select tool_id, statement,
         row_number() over (order by rnk desc) as rank_ix
  from (
    select tool_id, statement,
           ts_rank_cd(search_doc, websearch_to_tsquery('english', p_query)) as rnk
    from eligible
    where search_doc @@ websearch_to_tsquery('english', p_query)
    order by rnk desc
    limit 120
  ) l
),
sem_best as (
  select distinct on (tool_id) tool_id, statement, dist, rank_ix
  from semantic order by tool_id, rank_ix
),
lex_best as (
  select distinct on (tool_id) tool_id, statement, rank_ix
  from lexical order by tool_id, rank_ix
)
select coalesce(s.tool_id, l.tool_id),
       (coalesce(1.0 / (p_rrf_k + s.rank_ix), 0.0) * p_w_semantic
      + coalesce(1.0 / (p_rrf_k + l.rank_ix), 0.0) * p_w_lexical)::real,
       coalesce(s.statement, l.statement),
       s.dist
from sem_best s
full outer join lex_best l on l.tool_id = s.tool_id
order by 2 desc
limit p_limit;
$$;

-- ===========================================================================
-- Maintenance: partition rotation, rollup, pruning.
-- ===========================================================================
create or replace function public.ensure_search_partition(p_month date)
returns void language plpgsql set search_path = '' as $$
declare
  s date := date_trunc('month', p_month)::date;
  e date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  execute format(
    'create table if not exists public.%I partition of public.search_events
       for values from (%L) to (%L)',
    'search_events_' || to_char(s, 'YYYYMM'), s, e);
end; $$;

create or replace function public.drop_old_search_partitions(keep_months int default 1)
returns void language plpgsql set search_path = '' as $$
declare r record; cutoff text;
begin
  cutoff := 'search_events_' ||
            to_char(date_trunc('month', now()) - (keep_months || ' months')::interval,
                    'YYYYMM');
  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'search\_events\_%'
      and c.relname < cutoff
  loop
    execute format('drop table public.%I', r.relname);
  end loop;
end; $$;

-- Roll yesterday's log into per-tool counts BEFORE the log is dropped.
create or replace function public.rollup_tool_metrics(p_day date)
returns void language sql set search_path = '' as $$
  insert into public.tool_metrics_daily (tool_id, day, matched, opened, saved)
  select tool_id, p_day,
         count(*) filter (where kind = 'match'),
         count(*) filter (where kind = 'open'),
         count(*) filter (where kind = 'save')
  from (
    select unnest(matched_tool_ids) as tool_id, 'match' as kind
      from public.search_events
     where created_at >= p_day and created_at < p_day + 1
    union all
    select clicked_tool_id, 'open'
      from public.search_events
     where created_at >= p_day and created_at < p_day + 1
       and clicked_tool_id is not null
    union all
    select tool_id, 'save'
      from public.collection_items
     where created_at >= p_day and created_at < p_day + 1
  ) e
  where tool_id is not null
  group by tool_id
  on conflict (tool_id, day) do update
    set matched = excluded.matched,
        opened  = excluded.opened,
        saved   = excluded.saved;
$$;

-- Fold daily rows older than 90 days into monthly, then delete them.
create or replace function public.compact_tool_metrics()
returns void language sql set search_path = '' as $$
  with moved as (
    delete from public.tool_metrics_daily
     where day < current_date - 90
    returning tool_id, date_trunc('month', day)::date as month, matched, opened, saved
  )
  insert into public.tool_metrics_monthly (tool_id, month, matched, opened, saved)
  select tool_id, month, sum(matched), sum(opened), sum(saved)
  from moved group by tool_id, month
  on conflict (tool_id, month) do update
    set matched = public.tool_metrics_monthly.matched + excluded.matched,
        opened  = public.tool_metrics_monthly.opened  + excluded.opened,
        saved   = public.tool_metrics_monthly.saved   + excluded.saved;
$$;

select cron.schedule('foundit-rollup',      '10 3 * * *',
       $$select public.rollup_tool_metrics(current_date - 1)$$);
select cron.schedule('foundit-compact',     '25 3 * * 1',
       $$select public.compact_tool_metrics()$$);
select cron.schedule('foundit-next-part',   '0 4 25 * *',
       $$select public.ensure_search_partition((current_date + interval '1 month')::date)$$);
select cron.schedule('foundit-prune-logs',  '40 4 * * *',
       $$select public.drop_old_search_partitions(1)$$);

-- ===========================================================================
-- Row Level Security. Every table in an exposed schema needs it: "A table in
-- an exposed schema without RLS is readable and writable by any role with a
-- grant on it." Representative policies only — full set in the security doc.
-- ===========================================================================
alter table public.profiles          enable row level security;
alter table public.categories        enable row level security;
alter table public.tools             enable row level security;
alter table public.tool_categories   enable row level security;
alter table public.tool_problems     enable row level security;
alter table public.reviews           enable row level security;
alter table public.tool_likes        enable row level security;
alter table public.collections       enable row level security;
alter table public.collection_items  enable row level security;
alter table public.tool_claims       enable row level security;
alter table public.search_events     enable row level security;
alter table public.tool_metrics_daily   enable row level security;
alter table public.tool_metrics_monthly enable row level security;

create policy tools_public_read on public.tools
  for select to anon, authenticated using (status = 'published');

create policy problems_public_read on public.tool_problems
  for select to anon, authenticated using (
    exists (select 1 from public.tools t
             where t.id = tool_id and t.status = 'published'));

-- (select auth.uid()) not auth.uid(): the subquery form is evaluated once per
-- statement instead of once per row.
create policy likes_own_write on public.tool_likes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy reviews_public_read on public.reviews
  for select to anon, authenticated using (deleted_at is null);
create policy reviews_author_write on public.reviews
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy reviews_author_update on public.reviews
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
-- No DELETE policy at all: "Reviews belong to whoever wrote them" is enforced
-- by the absence of a delete path, plus the deleted_at soft-delete column.

-- search_events: write-only from the client's point of view.
create policy search_insert_any on public.search_events
  for insert to anon, authenticated with check (true);
```

### Per-table rationale, one line each

| Table | Why it exists |
| --- | --- |
| `profiles` | App-side user record; PK mirrors `auth.users.id` because Supabase owns identity. |
| `categories` | Editorial taxonomy an operator can extend without a migration — hence a lookup table, not an enum. |
| `tools` | The listing; read on every page, so it carries its own counters and its own tsvector. |
| `tool_categories` | N:M between tools and categories with a "primary category" flag. |
| `tool_problems` | The natural-language problem statements — the semantic unit the whole product matches on, one embedding each. |
| `reviews` | Star rating + text + sub-ratings, one live review per author per tool, soft-deleted. |
| `tool_likes` | Pure join row; composite natural key, no surrogate id, no second index. |
| `collections` | A user's named list, public or private. |
| `collection_items` | Membership of a tool in a collection, ordered, with an optional note. |
| `tool_claims` | A maker asserting ownership of a launch-seeded listing, with a moderation decision. |
| `search_events` | Raw query log, range-partitioned monthly, no foreign keys, dropped after 30 days. |
| `tool_metrics_daily` | Nightly rollup of matches/opens/saves per tool — the part of the log worth keeping. |
| `tool_metrics_monthly` | The same, compacted after 90 days, kept forever at negligible size. |

### Type choices, argued

**`citext` for slugs and handles, `text` everywhere else.** citext "internally calls `lower` when comparing values" and lets a primary key or unique constraint be case-insensitive without every query remembering `lower()`. The alternative — `text` plus `create unique index on … (lower(handle))` — works, but "If you declare a column as `UNIQUE` or `PRIMARY KEY`, the implicitly generated index is case-sensitive," so you get a second index and a rule everyone must remember. The costs are real and worth naming: citext "is not as efficient as `text`," "Only `text` can support B-Tree deduplication," and its behaviour "depends on the `LC_CTYPE` setting of your database." Postgres now suggests nondeterministic collations as a more Unicode-correct alternative; for `[a-z0-9_]` slugs the difference does not arise. ([postgresql.org/docs/17/citext.html](https://www.postgresql.org/docs/17/citext.html))

**Enum vs lookup table.** Enum where the set is closed, short, and changing it is a code change anyway: `tool_status`, `pricing_model`, `platform`, `tool_flag`, `claim_status`. Enums are 4 bytes, sort in declaration order, and give you a compile-time-ish error on a typo. Lookup table where a human edits the set at runtime and it carries extra attributes: `categories`. The enum's cost is that adding a value is `ALTER TYPE … ADD VALUE`, which is a migration — acceptable, and arguably a feature for a non-developer operator, since it forces the change through the migration pipeline rather than a dashboard click.

**`platform[]`, `tool_flag[]`, `text[]` for languages.** A tool has 1–5 platforms and 0–6 flags. Three junction tables would add three heaps and six indexes to save a few hundred kilobytes. One GIN index on an array column answers `platforms @> '{ios}'` for all values at once. Languages are `text[]` of BCP-47 codes rather than an enum because the set is genuinely open and never joined to anything.

**`jsonb` only for `tools.links`.** Sparse, never filtered on, never aggregated — the textbook case. Anything you filter, sort, or constrain gets a real column. `jsonb` for sub-ratings would have been the obvious AI-assisted mistake: you cannot put a `check (between 1 and 5)` on it, and `avg((body->>'ease')::int)` cannot use an index.

**Keys.** `bigint generated always as identity` everywhere we control the key; `uuid` only on `profiles`, where Supabase dictates it. Join tables use composite natural keys with no surrogate id. See §7.4 for why uuid v4 is the wrong default here.

**Timestamps.** `timestamptz` always, never `timestamp`; `created_at timestamptz not null default now()` on every table; `updated_at` only on tables that can actually be edited (not on `tool_likes`, `collection_items`, `search_events`), maintained by one shared `set_updated_at()` trigger rather than trusting the application.

**Soft delete, selectively.** `deleted_at` on `reviews` and `collections` only — the two places where content is user-authored and recovery/moderation matters. Everything else is a hard delete. The trap soft delete sets is uniqueness: `unique (tool_id, author_id)` would stop an author replacing their own deleted review, so it is a **partial** unique index `where deleted_at is null`. Every read path filters on `deleted_at is null`, and every index that serves a read path is partial on the same predicate, which keeps them smaller as well as correct.

---

## 3. Where to put the vectors

### 3.1 One vector per problem statement, not per tool

The product's question is "which tool solves *this* problem", and a tool solves several unrelated problems. Averaging four statements into one tool vector produces a centroid that is close to none of them — the classic failure where a tool that does expense-splitting *and* flight tracking matches neither query well. Multi-vector retrieval with a collapse to best-statement-per-tool (the `distinct on (tool_id) … order by tool_id, rank_ix` in `search_tools`) also gives you something valuable for free: **the statement that matched** is the explanation you show under the fit score.

Cost of the choice: 20,000 vectors instead of 5,000 — 20.6 MB instead of 5.2 MB at `halfvec(512)`. 15 MB to make the core feature work is the cheapest 15 MB in the schema.

### 3.2 Column on `tool_problems`, not a separate embeddings table

It is a strict 1:1 with the row, it is written when the row is written, and it is read on every search. A separate `embeddings(problem_id, vector)` table buys nothing here and costs a join, a second primary key index, and a second set of RLS policies. Supabase's own guidance points the same way — their documented pattern is a `vector` column on the content table (`embedding extensions.vector(384)` alongside `title` and `body`), not a side table ([supabase.com/docs/guides/ai/vector-columns](https://supabase.com/docs/guides/ai/vector-columns)).

The one case that justifies a separate table is running **two embedding models simultaneously** during a migration between them. Handle that when it happens, by adding a second nullable column (`embedding_v2 halfvec(512)`) and backfilling — cheaper than restructuring now for a maybe. The `embedding_model` and `embedded_at` columns exist precisely so you know which rows still need re-embedding, and the partial index `where embedding is null` is the work queue.

### 3.3 `halfvec` vs `vector`, and 1536 vs 512 — the arithmetic

pgvector documents both sizes exactly:

> "Each vector takes `4 * dimensions + 8` bytes of storage"
> "Each half vector takes `2 * dimensions + 8` bytes of storage"
> — [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector)

| Layout | Bytes per vector | × 20,000 statements | Relative |
| --- | --- | --- | --- |
| `vector(1536)` | 4×1536 + 8 = **6,152** | **123.0 MB** | 6.0× |
| `halfvec(1536)` | 2×1536 + 8 = **3,080** | **61.6 MB** | 3.0× |
| `vector(512)` | 4×512 + 8 = **2,056** | **41.1 MB** | 2.0× |
| **`halfvec(512)`** ← chosen | 2×512 + 8 = **1,032** | **20.6 MB** | 1.0× |
| (rejected) one `halfvec(512)` per tool | 1,032 | 5.2 MB over 5,000 rows | 0.25× |

Two independent halvings, each nearly free:

**512 instead of 1536.** OpenAI's `text-embedding-3-small` defaults to 1536 dimensions but accepts a `dimensions` parameter that shortens the output; the models "were trained with a technique that allows developers to trade-off performance and cost of using embeddings," to the point that "a `text-embedding-3-large` embedding can be shortened to a size of 256 while still outperforming an unshortened `text-embedding-ada-002` embedding with a size of 1536" ([developers.openai.com/api/docs/guides/embeddings](https://developers.openai.com/api/docs/guides/embeddings)). Note this is a *training-time* property (Matryoshka-style nesting) — you request 512 from the API; you do not truncate a 1536-dim vector yourself and expect it to work.

**`halfvec` instead of `vector`.** Half precision (fp16) keeps ~3 decimal digits of mantissa. Cosine distances between unrelated sentence embeddings differ in the second decimal place, far above that noise floor. The risk is real but small and, crucially, *measurable*: keep a 200-query gold set and compare top-10 overlap between `halfvec(512)` and `vector(1536)` before committing. Requires pgvector ≥ 0.7.0.

**A second, less obvious win: staying inside the heap tuple.** Postgres moves values out of line only when "a row value to be stored in a table is wider than `TOAST_TUPLE_THRESHOLD` bytes (normally 2 kB)" ([postgresql.org/docs/17/storage-toast.html](https://www.postgresql.org/docs/17/storage-toast.html)). A `tool_problems` row with `halfvec(512)` is roughly 1,032 + ~120 (statement) + ~120 (tsvector) + ~80 (scalars and header) ≈ **1.35 kB — under the threshold**. The same row with `vector(1536)` is ≈ 6.5 kB — over it, so the embedding is pushed to a TOAST table and every distance computation during a sequential scan pays an extra chunked fetch. This makes the exact-scan strategy in §3.4 viable in a way `vector(1536)` would not. (See §8: I could not confirm from pgvector's docs whether it sets an explicit `storage` attribute on the type that would override this.)

### 3.4 HNSW vs sequential scan at 20,000 vectors

pgvector's default is exact:

> "By default, pgvector performs exact nearest neighbor search, which provides perfect recall. You can add an index to use approximate nearest neighbor search, which trades some recall for speed. Unlike typical indexes, you will see different results for queries after adding an approximate index."

and its troubleshooting guidance says outright:

> "If the table is small, a table scan may be faster."

— [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector)

**Ship without the index.** The arithmetic: 20,000 × 1,032 bytes = **20.6 MB of vector data**, all of it in the heap, all of it comfortably resident in a 500 MB-RAM instance's page cache after the first query. An exact scan is 20,000 fp16 cosine distances over 512 dimensions — roughly 10 million multiply-adds, single-digit milliseconds of CPU, plus the heap scan. At ~40,000 searches/month (≈ 1 per minute average), the CPU cost is irrelevant and there is no cache-eviction pressure.

What you get for that:

- **Perfect recall.** A fit-score product that silently omits the best match is broken in a way users cannot see and you cannot debug.
- **Correct filtering**, which is the decisive argument. With an approximate index, "filtering is applied *after* the index is scanned," and pgvector's own worked example is brutal: "If a condition matches 10% of rows, with HNSW and the default `hnsw.ef_search` of 40, only 4 rows will match on average." Foundit filters on `status`, `platforms`, `flags`, and `pricing` — exactly this pattern. The mitigations exist (`set hnsw.iterative_scan = strict_order` or `relaxed_order`, bounded by `hnsw.max_scan_tuples`, default 20,000, and `hnsw.scan_mem_multiplier`), but they are complexity you do not need to buy yet.
- **No build cost, no build memory.** "Indexes build significantly faster when the graph fits into `maintenance_work_mem`" — on a 500 MB-RAM shared instance, a large HNSW build is genuinely disruptive.
- **~24 MB of disk not spent** (an HNSW index holds a copy of each vector plus its neighbour lists; see §8 — this figure is my estimate, not a documented formula).

**Note a genuine conflict in the sources.** Supabase says "HNSW should be your default choice when creating a vector index" and "you are safe to build an HNSW index immediately after the table is created" ([supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)). That page is answering "which index type" — it offers no minimum-table-size guidance at all. pgvector's is answering "index or not". At 20,000 rows, pgvector's answer governs.

**The trigger to revisit.** Add the index when *measured* p95 search latency exceeds your budget, or when `tool_problems` passes roughly 100,000 rows (25,000 tools) — whichever comes first. The DDL is commented into the schema above, ready to uncomment. Build it `concurrently`, raise `maintenance_work_mem` first, and re-measure recall against the gold set afterwards, because results *will* change.

---

## 4. Counters and aggregates, cheaply

### 4.1 The three options

**Compute on read.** `select count(*) from tool_likes where tool_id = $1` with an index on `tool_id`: perfect accuracy, zero write cost, ~0.1 ms for one tool. It fails on the shape Foundit actually has — a search results page showing 20 tools, each with a like count, a save count, and an average rating. That is either 60 correlated subqueries or three hash aggregates over 100,000 likes, 20,000 collection items, and 20,000 reviews, **on every single search**. Aggregating 140,000 rows to display 20 numbers, forty thousand times a month, is the expensive option even though it looks like the cheap one.

**Materialized view.** `REFRESH MATERIALIZED VIEW` recomputes the whole thing and takes a lock: without `CONCURRENTLY` a refresh "could block other connections which are trying to read from the materialized view," and `CONCURRENTLY` "is only allowed if there is at least one `UNIQUE` index on the materialized view which uses only column names and includes all rows" and is slower when many rows change ([postgresql.org/docs/17/sql-refreshmaterializedview.html](https://www.postgresql.org/docs/17/sql-refreshmaterializedview.html)). Wrong for like counts — a user who likes something and sees the number not move assumes the app is broken. And fatally wrong for search metrics: a matview is derived from its source table, so it cannot outlive the log rows you intend to drop.

**Trigger-maintained counter column.** Reads become free (the number is already on the row you were fetching anyway). Writes pay.

### 4.2 The write-amplification and lock-contention trade-off, honestly

A `like` becomes: one INSERT into `tool_likes`, one PK index insert, plus an UPDATE of `tools`. That UPDATE is where the cost hides.

- **Row versioning.** "In PostgreSQL, an `UPDATE` or `DELETE` of a row does not immediately remove the old version of the row… The space it occupies must then be reclaimed for reuse by new rows, to avoid unbounded growth of disk space requirements. This is done by running `VACUUM`" ([postgresql.org/docs/17/routine-vacuuming.html](https://www.postgresql.org/docs/17/routine-vacuuming.html)). Every counter bump makes a dead tuple in `tools`, and `tools` is your hottest read table. Autovacuum handles it, but the table will carry more bloat than its 5,000 rows suggest.
- **Index amplification.** If the updated column is not indexed and the page has room, Postgres can do a heap-only-tuple update and skip index maintenance. **This is why `tools_browse` indexes `rating_avg` and `like_count` — and why that index is the one thing in this schema I would drop first if writes ever hurt.** Indexing a counter guarantees every bump touches that index too.
- **Lock contention.** Concurrent likes on the *same* tool serialize: an UPDATE takes a row lock, and a second transaction "finds that the row it is attempting to update has already been locked, so it waits for the transaction that acquired the lock to complete" ([postgresql.org/docs/17/explicit-locking.html](https://www.postgresql.org/docs/17/explicit-locking.html)).

**At this scale the contention argument is theoretical.** 100,000 likes in a year is ~275/day across 5,000 tools — under four per minute globally. Even a launch-day spike on one trending tool is a handful of writers queueing for microseconds. Contention becomes real at hundreds of writes per second on a single row, which is two orders of magnitude away. Do not pre-build the sharded-counter or batched-delta machinery; note the escape hatch (insert deltas into a `counter_deltas` table, sum them in periodically) and move on.

### 4.3 What is right here

| Metric | Mechanism | Why |
| --- | --- | --- |
| `like_count`, `save_count` | Trigger counter on `tools` | Shown in result lists; must update instantly; write volume trivial. **Also pays for itself in disk**: because the counter exists, `tool_likes` needs no `(tool_id)` index — saving ~2 MB, more than the counters cost. |
| `review_count`, `rating_sum`, `rating_count` | Trigger counter on `tools` | Same. Store **sum and count**, never the average alone — an average cannot be correctly decremented on delete or edit. |
| `rating_avg` | `GENERATED ALWAYS AS … STORED` | Derived from two columns on the same row; the database guarantees it can never drift. |
| `item_count` on collections | Trigger counter | Shown on every collection card. |
| `searches matched`, `opens`, `saves` per tool | **Nightly rollup table** via `pg_cron` | High volume, and nobody needs it live. A plain table populated by `INSERT … ON CONFLICT DO UPDATE` beats a matview twice over: it touches only yesterday's partition instead of recomputing history, and it **survives the deletion of the source log** (§5), which no matview can. |
| Anything on a single tool's detail page only (e.g. rating histogram) | Compute on read | One tool, a few hundred rows, one index scan. Adding a counter for it would be denormalising without a measured need (§7.7). |

---

## 5. Full-text search alongside the vectors

### 5.1 Generated tsvector columns

Postgres's documented pattern, used verbatim in the DDL:

```sql
ALTER TABLE pgweb
    ADD COLUMN textsearchable_index_col tsvector
               GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) STORED;

CREATE INDEX textsearch_idx ON pgweb USING GIN (textsearchable_index_col);
```

— [postgresql.org/docs/17/textsearch-tables.html](https://www.postgresql.org/docs/17/textsearch-tables.html)

The docs give three reasons to prefer this over indexing the expression directly: queries need no explicit configuration argument, searches are faster because there is "No need to redo `to_tsvector` calls to verify index matches," and `coalesce` handles NULLs.

**Two gotchas that will bite:**

1. **The two-argument form is mandatory.** "The generation expression can only use immutable functions" ([postgresql.org/docs/17/ddl-generated-columns.html](https://www.postgresql.org/docs/17/ddl-generated-columns.html)). One-argument `to_tsvector(text)` depends on the `default_text_search_config` GUC and is therefore only STABLE — Postgres will reject it in a generated column with a confusing error. Always `to_tsvector('english', …)`.
2. **A generated column cannot reference another generated column**, so `tools.search_doc` cannot pull in text from `tool_problems`. That is why each table has its own tsvector and the fusion happens at query time.

`setweight(…, 'A')` on the name and `'B'` on the summary makes a title hit outrank a body hit under `ts_rank_cd` — worth the zero extra bytes.

### 5.2 GIN, and why `pg_trgm` too

GIN on the tsvector handles word matching. It does **not** handle typos or partial words: `websearch_to_tsquery('english', 'notin')` will not find "Notion". `tools_name_trgm` (GIN with `gin_trgm_ops`) covers the "user half-remembers the product name" case with `name % 'notin'`, which is a distinct and common query shape in a tool-discovery product. Two GIN indexes on a 5,000-row table cost a couple of megabytes.

### 5.3 Combining lexical and semantic in one query

The `search_tools` function above uses **Reciprocal Rank Fusion**, which is what Supabase documents for hybrid search: run each search independently in its own CTE, `full outer join` on the id, and score

```
coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
+ coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
```

with `rrf_k` defaulting to 50 and both weights to 1 ([supabase.com/docs/guides/ai/hybrid-search](https://supabase.com/docs/guides/ai/hybrid-search)).

RRF is the right fusion here specifically because it uses **ranks, not scores**. Cosine distance (0–2) and `ts_rank_cd` (unbounded, corpus-dependent) are not on comparable scales and no fixed normalisation makes them so. Ranks are always comparable.

Three Foundit-specific adaptations to the documented pattern:

- **The filter is applied inside the `eligible` CTE, before both searches.** Because there is no approximate index, this is a genuine pre-filter — the exact scan only ever touches eligible rows, and the post-filter recall collapse described in §3.4 cannot happen.
- **Both sides collapse to best-statement-per-tool** (`distinct on (tool_id)`) before fusion, so a tool with four near-miss statements cannot crowd out a tool with one perfect one.
- **`s.dist` is returned** so the app can turn the raw cosine distance into the user-visible fit score, and `best_statement` gives the "matched because: …" line. Keep the score derivation in the app, not the database — you will tune it weekly.

Cost of the whole hybrid query at this scale: one GIN index scan (sub-millisecond over 5,000 tools) plus one 20,000-row exact vector scan. One round trip, no application-side merging.

---

## 6. Storage arithmetic

### 6.1 The per-row overhead everyone forgets

Every heap row costs, before any of your data:

- "There is a fixed-size header (occupying 23 bytes on most machines)" for the tuple header, padded up to the MAXALIGN boundary → **24 bytes**;
- "Following the page header are item identifiers (`ItemIdData`), each requiring four bytes" → **4 bytes**;

= **28 bytes per row minimum**, on 8 kB pages ([postgresql.org/docs/17/storage-page-layout.html](https://www.postgresql.org/docs/17/storage-page-layout.html)). On a 60-byte like row that is nearly half the storage. It is why `tool_likes` has no surrogate id and no `updated_at`.

### 6.2 Table by table

| Table | Rows | Bytes/row (data + 28) | Heap MB | Index MB | Total MB |
| --- | --- | --- | --- | --- | --- |
| `tools` | 5,000 | ~1,130 (incl. ~300 tsvector, 40 counters) | 5.7 | 3.5 | **9.2** |
| `tool_problems` | 20,000 | 1,032 + 120 + 120 + 80 = ~1,352 | 27.0 | 2.4 | **29.4** |
| `reviews` | 20,000 | ~500 (body ~400) | 10.0 | 2.0 | **12.0** |
| `tool_likes` | 100,000 | 16+8+8 + 28 = **60** | 6.0 | 4.0 | **10.0** |
| `profiles` | 20,000 | ~210 | 4.2 | 1.4 | **5.6** |
| `collections` | 2,000 | ~230 | 0.5 | 0.2 | **0.7** |
| `collection_items` | 20,000 | ~100 | 2.0 | 1.4 | **3.4** |
| `categories` | 60 | ~150 | 0.01 | 0.03 | **0.04** |
| `tool_categories` | 12,500 | ~50 | 0.6 | 0.9 | **1.5** |
| `tool_claims` | 300 | ~250 | 0.08 | 0.05 | **0.13** |
| `search_events` (30-day window) | 40,000 | ~254 | 10.2 | 1.3 | **11.5** |
| `tool_metrics_daily` (90-day window) | 72,000 | 24 + 28 = **52** | 3.7 | 2.3 | **6.0** |
| `tool_metrics_monthly` (1 year) | 9,600 | 52 | 0.5 | 0.3 | **0.8** |
| | | | | | **≈ 90.3 MB** |

`search_events` row detail: id 8 + created_at 8 + user_id 16 + session_id 16 + query_text ~60 + `matched_tool_ids` (10 bigints = 24 array header + 80) 104 + result_count 2 + top_score 4 + clicked_tool_id 8 + latency_ms 4 ≈ 226, + 28 = **254 bytes**.

`tool_metrics_daily` row count: ~800 tools see activity on a given day × 90 days = 72,000.

### 6.3 Totals, and the two ways to get it wrong

| Scenario | Year-one size |
| --- | --- |
| **As designed** (logs pruned at 30 days, no HNSW) | 90 MB × 1.25 bloat/FSM/visibility-map ≈ **113 MB**, + Supabase system schemas (auth, storage, realtime, cron — estimated 40 MB) ≈ **153 MB** |
| As designed, **plus an HNSW index** | + ~24 MB ≈ **177 MB** |
| **Logs never pruned** | 480,000 events × 254 = 122 MB heap + 15 MB index = 137 MB, replacing 11.5 → subtotal 216 MB → ×1.25 + 40 ≈ **310 MB, growing 170 MB/year.** Over the 500 MB free tier during year two. |
| **Query embeddings stored on each log row** | + 480,000 × 1,032 = **495 MB.** Over the limit inside year one. Dead on arrival. |

Against Supabase's "500 MB database size" free plan, the designed schema uses about a third and stays flat. The two failure modes are both in the log table, and both are one column away.

### 6.4 What to prune, aggregate, or never store

**Never store at all:**
- **The query embedding.** 495 MB/year. Recompute it — it costs one API call you already made.
- **The full result set as rows.** A `search_result_items` child table at 10 rows per search is 4.8 M rows/year, ~300 MB. The `matched_tool_ids bigint[]` column carries the same information inline for 80 bytes and is rolled up nightly anyway.
- **IP addresses.** A rotating `session_id` gives you the same abuse-rate-limiting signal with none of the retention obligation.
- **Anything derivable from a URL.** No cached page titles, no scraped descriptions duplicated from the tool's own `summary`.
- **Logo image bytes.** `logo_path` points at Supabase Storage ("1 GB file storage" on Free, billed separately from the 500 MB database). Never `bytea` in the table.

**Aggregate then discard:** raw `search_events` → `tool_metrics_daily` (nightly) → `tool_metrics_monthly` (after 90 days). A year of activity history compresses from 137 MB to under 1 MB.

**Prune on a schedule:** the log partitions, and `tool_metrics_daily` rows past 90 days.

### 6.5 Retention policy

| Data | Retention | Mechanism |
| --- | --- | --- |
| `search_events` (raw queries, session ids, matched ids) | **30 days** | Monthly range partitions; `drop_old_search_partitions()` daily via `pg_cron` |
| `tool_metrics_daily` | **90 days** | `compact_tool_metrics()` weekly: fold into monthly, delete dailies |
| `tool_metrics_monthly` | **Forever** | ~10 K rows/year, under 1 MB |
| `reviews` with `deleted_at` set | **90 days**, then hard delete | Weekly cron; keeps the moderation window without unbounded growth |
| `tool_claims` resolved | **Forever** | A few hundred rows; the audit trail is the point |
| `tools` with `status = 'removed'` | **Forever** | Preserves URL permanence and prevents re-submission of rejected listings |

**Why partitions and not `DELETE`.** Postgres is explicit: "Dropping an individual partition using `DROP TABLE`, or doing `ALTER TABLE DETACH PARTITION`, is far faster than a bulk operation. These commands also entirely avoid the `VACUUM` overhead caused by a bulk `DELETE`," and the recommended design is that "all data to be removed at once is located in a single partition" ([postgresql.org/docs/17/ddl-partitioning.html](https://www.postgresql.org/docs/17/ddl-partitioning.html)). A monthly `delete from search_events where created_at < …` on a 500 MB-RAM instance would leave 122 MB of dead tuples for autovacuum to grind through; `drop table search_events_202609` returns the space instantly. The same docs warn against overdoing it — planning time and per-session memory grow with partition count — but 13 live partitions is nowhere near the "few thousand" where that starts to matter.

**Order matters:** `foundit-rollup` runs at 03:10 and `foundit-prune-logs` at 04:40. Never let pruning outrun the rollup, or a day of metrics vanishes permanently. Job history is in `cron.job_run_details` ([supabase.com/docs/guides/cron](https://supabase.com/docs/guides/cron)) — check it monthly.

---

## 7. Migrations for a non-developer operator

The project's own ground rule — "Schema changes travel as migration files, never as clicks in a dashboard" — is the correct one, and Supabase states it in the same terms: "Once you're using migrations, all schema changes — even small ones — should go through migration files" ([supabase.com/docs/guides/deployment/database-migrations](https://supabase.com/docs/guides/deployment/database-migrations)).

### 7.1 The everyday loop

```bash
supabase start                        # local Postgres in Docker
supabase migration new add_tool_flags # creates supabase/migrations/<ts>_add_tool_flags.sql
# ... write the SQL by hand in that file ...
supabase db reset                     # wipe, replay every migration, re-run seeds
# ... test the app against localhost ...
git add supabase/migrations && git commit && git push   # -> develop
```

Deploy is the same command against a different linked project:

```bash
supabase link --project-ref <development-ref>
supabase db push
# after merging develop -> main:
supabase link --project-ref <production-ref>
supabase db push
```

`supabase db push` applies only migrations not yet recorded in `supabase_migrations.schema_migrations` on the remote. Foundit's two-project setup (`develop` → dev project, `main` → prod project) means every migration is applied to development first and to production only after the merge, which is exactly the safety property you want.

### 7.2 Seeding

`supabase/seed.sql` runs "the first time you run `supabase start` and every time you run `supabase db reset`," and "Seeding occurs *after* all database migrations have been completed" ([supabase.com/docs/guides/local-development/seeding-your-database](https://supabase.com/docs/guides/local-development/seeding-your-database)). Split it as the docs allow:

```toml
# supabase/config.toml
[db.seed]
enabled = true
sql_paths = ['./seeds/01_categories.sql', './seeds/02_tools.sql', './seeds/03_problems.sql']
```

Files run in the order declared. Follow the documented best practice — "only include data insertions in your seed files, and avoid adding schema statements" — because a `create table` that exists only in a seed will never reach production.

Two Foundit specifics:
- **Seeded problem statements have `embedding` NULL.** The embedding job picks them up via `tool_problems_needs_embedding`. Do not put literal vectors in seed files: unreadable, unreviewable, and enormous in git.
- **The launch tool catalogue is production data, not seed data.** Load it once with a one-off script against production, or as a genuine data migration. `db push --include-seed` will re-run seeds against a remote — reserve that for the dev project only.

### 7.3 Avoiding the divergence trap

The trap: someone adds a column in the dashboard Table Editor. Production now has a column no migration file knows about. The next `db push` either fails or, worse, succeeds while the two environments quietly differ.

**Prevention, in order of effectiveness:**
1. **Treat the production dashboard's SQL editor as read-only.** `select` to investigate; never `create`, `alter`, or `drop`. Write this on a sticky note.
2. **Make the dev project the only place experiments happen.** If a dashboard click is irresistible, do it there, then immediately `supabase db diff -f <name>` to capture it as a migration file — that is precisely what the command is for.
3. **Check for drift before every deploy**: `supabase migration list` shows applied-vs-local status for both. Make it the first line of the deploy checklist.
4. **When drift has already happened**: `supabase db pull` writes the remote's actual state into a new migration file. Read it before committing — it will contain everything you forgot as well as everything you meant.
5. **Only for a tracking-table mismatch** (a migration applied by hand, or a partially failed push): `supabase migration repair --status applied <timestamp>`. This edits bookkeeping, not schema. Reach for it last.
6. **Only one person runs `db push` at a time.**

**Two irreversibility rules worth adopting as habits**, both learned the expensive way:
- A migration that drops a column or table gets its own PR, reviewed alone. Grouping a `drop column` with feature work is how data disappears.
- Expand, then contract: add the new column and backfill in migration *N*; remove the old one in migration *N+2*, after the deployed app has stopped referencing it. Never in the same migration as the code change.

### 7.4 What lives in migrations vs. what does not

In migrations: tables, columns, types, constraints, indexes, functions, triggers, RLS policies, `cron.schedule` calls. Out: `cron.job_run_details` contents, actual tool data, anything containing a key. Enum changes are migrations too — `alter type tool_flag add value 'no_tracking';` — which is a point in favour of enums for a solo operator, since the pipeline enforces itself.

---

## 8. Schema mistakes on AI-assisted projects

Each of these is common, each has a specific Foundit form, and each is avoided above.

**8.1 Embeddings stored as JSON text.** `embedding text` or `embedding jsonb` holding `"[0.021, -0.004, …]"`. A 512-float JSON array is ~4,500 bytes of text versus 1,032 bytes of `halfvec` — 4× the storage — and, fatally, there is no `<=>` operator, so every search parses 20,000 JSON arrays in application code. No index is ever possible. **Fix:** a real `halfvec(512)` column. If you inherit this: `alter table … add column embedding halfvec(512)`, backfill with `(embedding_json::text)::vector::halfvec(512)`, drop the old column in a later migration.

**8.2 No foreign keys.** The single most common AI-generated-schema defect, because an ORM or a code generator will happily emit `tool_id bigint` with nothing behind it. Result: reviews for tools that no longer exist, likes pointing at deleted rows, and counters that drift permanently. Every reference above declares its `on delete` behaviour deliberately — `cascade` for owned children, `set null` for attribution, `restrict` for `categories` so you cannot delete a category still in use. **The one deliberate exception is `search_events`**, which has no FKs at all: it is an append-only log, its rows are facts about a moment rather than relationships, and FK checks on 480,000 inserts plus the cascade cost when a tool is deleted buy nothing. Being able to name why the exception is an exception is the difference between a decision and an oversight.

**8.3 Everything in one wide table.** The AI-assisted version: a `tools` table with `problem_1 … problem_4`, `embedding_1 … embedding_4`, `review_1_text`, `category_1`, `category_2`. It breaks the moment a tool needs a fifth problem statement, it cannot be indexed for search, and every row is TOASTed. The tell is a column name ending in a number. **Fix:** anything that can occur more than once is a row in a child table.

**8.4 uuid v4 primary keys, unexamined.** Postgres heaps are not clustered — the "clustered key" worry is imported from SQL Server and InnoDB and does not literally apply. The real costs here are three: a uuid is 16 bytes against bigint's 8, doubled everywhere it appears as a foreign key and in every index; random v4 values insert into arbitrary b-tree pages, causing more page splits, more WAL, and worse cache locality than a monotonic identity; and 128 random bits are not compressible. On `tool_likes` alone, uuid keys would add 100,000 × 16 = 1.6 MB of heap and roughly as much index. `bigint generated always as identity` everywhere we control the key; `uuid` on `profiles` only because `auth.users.id` is a uuid and matching it is not optional. If you genuinely need unguessable public identifiers, Postgres 18 adds `uuidv7()`, "a version 7 (time-ordered) UUID. The timestamp is computed using UNIX timestamp with millisecond precision + sub-millisecond timestamp + random" ([postgresql.org/docs/18/functions-uuid.html](https://www.postgresql.org/docs/18/functions-uuid.html)) — time-ordered, so it avoids the insertion-locality problem while staying unguessable. Check your Postgres version before relying on it (§9).

**8.5 Unbounded log tables.** `search_events` with no partitioning and no retention reaches 137 MB in year one and 274 MB in year two — and it is the table nobody thinks about, because it is never read. It is also the table most likely to acquire an "it might be useful later" column. Retention is designed in from day one, and the partition structure means enforcing it costs nothing.

**8.6 No index on the columns actually filtered.** The mirror image is equally common in AI-generated schemas: an index on every column, doubling write cost and disk for indexes the planner never chooses. The discipline is to enumerate the actual query shapes and index those: search filters on `status`/`platforms`/`flags` (GIN + partial b-tree), tool detail by `slug` (unique), reviews by `(tool_id, created_at desc)` partial on live rows, "my likes" by `user_id` (PK prefix). **And to notice the columns you deliberately did not index** — `tool_likes(tool_id)`, because a counter answers that question, and every counter column, because indexing one defeats heap-only-tuple updates (§4.2). Under RLS there is one extra rule: index the columns your policies filter on, because "Postgres evaluates the policy against each candidate row, so an unindexed filter column turns a read into a sequential scan" ([supabase.com/docs/guides/database/postgres/row-level-security](https://supabase.com/docs/guides/database/postgres/row-level-security)).

**8.7 Denormalising before there is a measured need.** Caching a tool's category names onto `tools` as `text[]`, or copying the author's `display_name` onto every review. Each one creates a second source of truth that must be kept in sync, and the sync is always where the bug is. The counters in §4 are the *only* denormalisation in this schema, and each earns its place with a named read path that would otherwise aggregate over 100,000 rows on every search. `rating_avg` is generated rather than trigger-maintained precisely so the database, not the application, guarantees it cannot drift. If you cannot name the query a denormalisation serves, it is premature.

**8.8 Storing the same text three times.** The AI-assisted pattern is a tool's summary living in `tools.summary`, again in a `search_index` table, again inside a `metadata` jsonb blob, and a fourth time in a `documents` table for the embeddings — four copies that will disagree within a month. Foundit stores each string exactly once. The tsvectors are *generated columns*, which look like duplication but are not: Postgres derives them from the source column and they cannot drift by construction. `tool_problems.statement` is stored once and referenced by both search paths. And the search log stores `query_text` but not the results' text, only their ids.

---

## 9. What I could not confirm

Everything below should be verified against your actual project before you rely on it.

1. **`halfvec` availability on your Supabase project.** `halfvec` requires pgvector ≥ 0.7.0. Supabase's own vector-columns documentation still shows plain `vector(384)` and does not mention `halfvec` at all. **Verify:** `select extversion from pg_extension where extname = 'vector';`. If it is below 0.7, either upgrade the extension or fall back to `vector(512)` (41 MB instead of 20.6 MB — still four fifths cheaper than `vector(1536)`), and change `halfvec_cosine_ops` to `vector_cosine_ops` in the commented index.
2. **HNSW index size.** My ~24 MB estimate (vector copy + neighbour lists at `m = 16`) is inferred, not documented; pgvector publishes no bytes-per-row formula. **Verify by measuring:** build it on a copy and run `select pg_size_pretty(pg_relation_size('tool_problems_embedding_hnsw'));`.
3. **Whether a `halfvec(512)` column really stays inline.** The TOAST threshold (~2 kB) and the halfvec size (1,032 bytes) are both documented, and 1,032 < 2,048; but I could not confirm whether pgvector sets an explicit storage strategy (e.g. `EXTERNAL`) on the type that would force out-of-line storage regardless. **Verify:** `select attstorage from pg_attribute where attrelid = 'tool_problems'::regclass and attname = 'embedding';` (`x`/`m` = compressible/inline-preferred, `e` = external). This affects the §3.3 argument, not the size arithmetic.
4. **Actual exact-scan latency.** "Single-digit milliseconds" is reasoning from operation counts, not a measurement, and Supabase's Free plan is shared CPU. **Verify:** load 20,000 real vectors and run `explain (analyze, buffers)` on `search_tools`. If p95 exceeds your budget, uncomment the HNSW index.
5. **Recall loss from `halfvec` and from 512 dimensions**, for *your* corpus. Both are widely reported as negligible; neither is measured for problem-statement text. **Verify with a 200-query gold set before launch**, comparing top-10 overlap against `vector(1536)`.
6. **Whether Supabase's "500 MB database size" counts indexes, WAL, and the `auth`/`storage`/`realtime` system schemas.** I assumed it counts everything and budgeted 40 MB for system schemas — itself an estimate. **Verify:** `select pg_size_pretty(pg_database_size(current_database()));` on a fresh project and compare against the dashboard's reported usage.
7. **`pg_cron` on the Free plan.** The Supabase Cron page I fetched documents `cron.job` and `cron.job_run_details` but did not render the enablement steps or `cron.schedule()` syntax; I wrote the schedule calls from the standard pg_cron API. **Verify** the calls execute and appear in `cron.job`, and confirm which database the jobs run against (pg_cron traditionally runs jobs in one designated database).
8. **GIN on enum arrays.** `create index … using gin (platforms)` should resolve to `array_ops`, which requires a default b-tree opclass for the element type; enums have one. I did not execute the DDL. **If it errors,** either declare the opclass explicitly or change the column to `text[]` with a check constraint.
9. **`setweight()` immutability in a generated column.** The pattern appears in Postgres's own text-search documentation, but I did not verify the function's volatility marking directly. **Verify:** the DDL either runs or it does not — `supabase db reset` is the test.
10. **`uuidv7()` on Supabase.** It is a Postgres 18 function; Supabase projects commonly run 15 or 17. Nothing in this schema depends on it — it is mentioned only as the alternative in §8.4.
11. **Embedding API cost.** Roughly 400 K tokens to embed the catalogue and ~5 M tokens/year of query embeddings — trivially small against a $100 budget at current small-model pricing, but I did not fetch a pricing page and current rates should be checked against the provider directly.
12. **Row-size estimates.** Every "bytes/row" figure for text columns is an assumed average (a 400-byte review body, a 200-byte summary). The fixed-width parts and the 28-byte overhead are exact; the text parts are guesses. **Verify after seeding:** `select pg_size_pretty(pg_total_relation_size('public.tools'));` per table.

---

## Sources

- pgvector — [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector) (storage per type, exact vs approximate search, "if the table is small, a table scan may be faster", HNSW options and build memory, filtering and iterative index scans)
- PostgreSQL 17 — [Database Page Layout](https://www.postgresql.org/docs/17/storage-page-layout.html) (23-byte tuple header, 4-byte line pointer, 8 kB pages)
- PostgreSQL 17 — [TOAST](https://www.postgresql.org/docs/17/storage-toast.html) (`TOAST_TUPLE_THRESHOLD`, normally 2 kB)
- PostgreSQL 17 — [Tables and Indexes for Text Search](https://www.postgresql.org/docs/17/textsearch-tables.html) (generated tsvector column + GIN index)
- PostgreSQL 17 — [Generated Columns](https://www.postgresql.org/docs/17/ddl-generated-columns.html) (immutability restriction, no reference to other generated columns)
- PostgreSQL 17 — [citext](https://www.postgresql.org/docs/17/citext.html) (behaviour, efficiency and locale caveats)
- PostgreSQL 17 — [Table Partitioning](https://www.postgresql.org/docs/17/ddl-partitioning.html) (DROP/DETACH vs bulk DELETE, partition-count caveats)
- PostgreSQL 17 — [Routine Vacuuming](https://www.postgresql.org/docs/17/routine-vacuuming.html) (dead row versions from UPDATE/DELETE)
- PostgreSQL 17 — [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html) (row locks taken by UPDATE, waiting behaviour)
- PostgreSQL 17 — [REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/17/sql-refreshmaterializedview.html) (locking, CONCURRENTLY's unique-index requirement)
- PostgreSQL 18 — [UUID Functions](https://www.postgresql.org/docs/18/functions-uuid.html) (`uuidv4()`, `uuidv7()`)
- Supabase — [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations) (CLI workflow, dashboard-drift warning, `migration repair`)
- Supabase — [Seeding Your Database](https://supabase.com/docs/guides/local-development/seeding-your-database) (`seed.sql`, `[db.seed]`, ordering, best practice)
- Supabase — [HNSW Indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes) (HNSW as default index choice; safe to build immediately)
- Supabase — [Vector Columns](https://supabase.com/docs/guides/ai/vector-columns) (embedding column on the content table)
- Supabase — [Hybrid Search](https://supabase.com/docs/guides/ai/hybrid-search) (RRF formula, `rrf_k`, weights)
- Supabase — [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) (RLS required on exposed schemas, index policy columns, `(select auth.uid())`)
- Supabase — [Cron](https://supabase.com/docs/guides/cron) (`cron.job`, `cron.job_run_details`)
- Supabase — [Pricing](https://supabase.com/pricing) (Free: 500 MB database, 500 MB RAM, 5 GB egress, 1 GB file storage, paused after 1 week idle; Pro: $25/month, 8 GB disk)
- OpenAI — [Embeddings guide](https://developers.openai.com/api/docs/guides/embeddings) (model dimensions, `dimensions` parameter and the shortening trade-off)
