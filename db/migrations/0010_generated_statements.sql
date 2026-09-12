-- ===========================================================================
-- 0010 — Phase 5's schema: generated statements, the reranker's cache, and a
-- column that tells an unjudged search apart from a judged "no".
--
-- ONE FILE FOR THREE DELIVERABLES, and that is deliberate rather than untidy.
-- Phase 5 ships three things in three commits, each measured separately, and
-- the brief names this file for the first of them. A migration may not be
-- edited once `infra.schema_migrations` has recorded it, so splitting the
-- schema across three files would mean applying 0010, measuring, applying
-- 0011, measuring, applying 0012 — three irreversible steps in a phase whose
-- second step is allowed to be REVERTED if it does not move the number. The
-- schema is not the behaviour: the columns below are inert until the code that
-- writes them lands, and each piece of code lands in its own commit with its
-- own measurement.
--
-- Five sections:
--   1. tool_problems grows a provenance: where a statement came from, and
--      which two models produced and checked it
--   2. store_generated_statement, and the queue the generation job reads
--   3. query_reranks — the reranker's cache, built to 0008's pattern
--   4. search_events.match_judged, and log_search_event's new argument
--   5. grants
--
-- The rule this file is written against, in one sentence: **the database is
-- the boundary.** Every check the application makes is made again here, in the
-- one place a caller cannot skip, and every new privilege is the narrowest one
-- that does the job.
-- ===========================================================================

-- ===========================================================================
-- 1. Where a problem statement came from
--
-- Until now every row in tool_problems was written by hand into
-- db/seed/dev_seed.sql. Phase 5 adds a second author — gpt-5-mini, writing
-- statements for the 182 tools that have only two — and a third is coming in
-- Phase 7, when the person who adds a tool writes its statements.
--
-- Three columns rather than one boolean, because "generated" is not one fact:
-- a reader of this table needs to know which model wrote a statement AND which
-- model checked it against the tool's own summary, and a statement with no
-- verifier is a statement nobody checked. docs/build-phases.md Phase 5: "a
-- hallucinated problem statement is worse than none".
--
-- `source` defaults to 'seed' so the 504 rows that already exist keep their
-- true provenance without an UPDATE, and so a future INSERT that forgets the
-- column is recorded as the most conservative thing it could be rather than as
-- a generated row nobody generated.
-- ===========================================================================
alter table public.tool_problems
  add column if not exists source          text not null default 'seed',
  add column if not exists generated_model text,
  add column if not exists verified_model  text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tool_problems'::regclass
       and conname = 'tool_problems_source_known'
  ) then
    alter table public.tool_problems
      add constraint tool_problems_source_known
      check (source in ('seed', 'generated', 'user'));
  end if;

  -- A generated statement that names no generator, or that names no verifier,
  -- is a statement whose provenance is a guess. The CHECK is what makes
  -- "every generated statement was checked" a property of the TABLE rather
  -- than of the job that happened to write it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tool_problems'::regclass
       and conname = 'tool_problems_generated_is_attributed'
  ) then
    alter table public.tool_problems
      add constraint tool_problems_generated_is_attributed
      check (
        (source <> 'generated')
        or (generated_model is not null and verified_model is not null)
      );
  end if;

  -- And the other direction: a seeded row may not claim a model wrote it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tool_problems'::regclass
       and conname = 'tool_problems_seed_has_no_model'
  ) then
    alter table public.tool_problems
      add constraint tool_problems_seed_has_no_model
      check (
        source <> 'seed'
        or (generated_model is null and verified_model is null)
      );
  end if;
end
$$;

comment on column public.tool_problems.source is
  'Who wrote this statement: ''seed'' (by hand, in db/seed/dev_seed.sql), '
  '''generated'' (by the model named in generated_model and checked by the one '
  'in verified_model — db/migrations/0010, scripts/generate-statements.mjs), or '
  '''user'' (Phase 7, the person who added the tool). A CHECK requires a '
  'generated row to name both models, so "every generated statement was '
  'checked" is a property of this table rather than of the job that wrote it.';

comment on column public.tool_problems.generated_model is
  'The model that wrote this statement, for a generated row; null otherwise.';

comment on column public.tool_problems.verified_model is
  'The model that checked this statement against the tool''s own name and '
  'summary before it was stored, for a generated row; null otherwise. A second '
  'and INDEPENDENT call: the generator never sees the verifier''s verdict and '
  'the verifier never sees the generator''s reasoning, only the tool and the '
  'one sentence.';

-- ===========================================================================
-- 2. The generation job's two doors
--
-- Same arrangement as the embedding job in 0005: the job connects as
-- foundit_embed, which holds no privilege on any table, and reaches the
-- catalogue only through functions that return exactly what it needs.
--
-- WHY foundit_embed RATHER THAN A FOURTH ROLE. 0005's rule is that no role may
-- hold both halves of an oracle — the power to write a vector and the power to
-- ask which vector is nearest a cached query. Writing a problem statement is
-- not half of anything: it reads the catalogue's own public text and writes
-- public text back. The job also has to embed what it wrote, to dedupe against
-- what is already there, and that is foundit_embed's existing job. A fourth
-- role would be ceremony rather than a boundary.
-- ===========================================================================

-- How many statements a published tool should have before it is left alone.
-- One number, in the database, so the job and the setter cannot disagree about
-- what "too few" means — and so raising it is a migration somebody writes on
-- purpose rather than a constant somebody edits.
create or replace function public.statements_wanted()
returns int
language sql
immutable
set search_path = ''
as $fn$
  select 4;
$fn$;

comment on function public.statements_wanted() is
  'How many problem statements a published tool should carry. Today 182 of the '
  '223 published tools have two, 24 have three and 17 have four, so "too few" '
  'is "fewer than this". public.store_generated_statement refuses a tool that '
  'already has this many, which is what stops a job run twice from writing '
  'eight.';

create or replace function public.statement_work(p_limit int default null)
returns table (
  tool_id    bigint,
  name       text,
  summary    text,
  statements text[],
  wanted     int
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select t.id,
         t.name::text,
         t.summary,
         coalesce(array_agg(tp.statement order by tp.sort_order, tp.id)
                    filter (where tp.id is not null), '{}'::text[]),
         public.statements_wanted() - count(tp.id)::int
    from public.tools t
    left join public.tool_problems tp on tp.tool_id = t.id
   where t.status = 'published'
   group by t.id, t.name, t.summary
  having count(tp.id) < public.statements_wanted()
   order by count(tp.id), t.id
   limit case when p_limit is null or p_limit < 1 then null else p_limit end;
$fn$;

comment on function public.statement_work(int) is
  'The generation job''s work queue: every published tool with fewer than '
  'public.statements_wanted() problem statements, with its name, its summary, '
  'the statements it already has, and how many are missing. Five columns and '
  'there is no sixth to ask for — no url, no owner, no counters. SECURITY '
  'DEFINER because foundit_embed holds no grant on public.tools and must not '
  'be given one.';

-- Every published tool's name, for the one guard that needs the catalogue: a
-- generated statement may not name a tool. The job holds no grant on
-- public.tools, so this is how it asks.
create or replace function public.published_tool_names()
returns setof text
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select t.name::text from public.tools t where t.status = 'published' order by 1;
$fn$;

comment on function public.published_tool_names() is
  'Every published tool''s name and nothing else about it. It exists for one '
  'guard: a generated problem statement may name no tool in the catalogue, '
  'because a statement that names a tool is an advertisement rather than a '
  'situation somebody is in. lib/sql.ts asks the same question of the same '
  'column as foundit_app, with a plain select; foundit_embed has no grant on '
  'the table and asks here.';

-- The dedupe, done inside the database.
--
-- The job embeds a candidate statement and needs to know whether it is a
-- paraphrase of one this tool already lists. The obvious way — read the
-- existing vectors out and compare in JavaScript — is exactly what 0005 and
-- 0007 spent two migrations making impossible, and for a good reason: a role
-- that can read vectors can compute distances, and the distances are the
-- oracle. So the arithmetic happens here and ONE number comes out.
--
-- It answers only about a candidate vector the caller already holds, for one
-- tool, so there is nothing here to iterate into a readout of anything.
create or replace function public.statement_similarity(
  p_tool_id   bigint,
  p_embedding halfvec
)
returns real
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(max(1 - (tp.embedding <=> p_embedding)), 0)::real
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   where tp.tool_id = p_tool_id
     and tp.embedding is not null
     and p_embedding is not null;
$fn$;

comment on function public.statement_similarity(bigint, halfvec) is
  'The highest cosine similarity between a candidate statement''s vector and '
  'the vectors of the statements this published tool already lists, or 0 when '
  'it has none. One number out, no vector out: the generation job dedupes '
  'against what is there without ever holding a stored vector, which is the '
  'same rule public.query_vector_ranks is built on (0005, 0007).';

-- The one write.
create or replace function public.store_generated_statement(
  p_tool_id         bigint,
  p_statement       text,
  p_generated_model text,
  p_verified_model  text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_have   int;
  v_status text;
  v_id     bigint;
  v_text   text := btrim(coalesce(p_statement, ''));
begin
  if p_generated_model is null or btrim(p_generated_model) = ''
     or p_verified_model is null or btrim(p_verified_model) = '' then
    raise exception 'a generated statement must name the model that wrote it and the model that checked it'
      using errcode = '22023';
  end if;

  -- The length rule is tool_problems' own (8..200). Saying it here as well
  -- turns a CHECK violation into a sentence somebody can act on, and keeps the
  -- job's error messages free of SQLSTATE archaeology.
  if length(v_text) < 8 or length(v_text) > 200 then
    raise exception 'a problem statement is between 8 and 200 characters; this one is %', length(v_text)
      using errcode = '22023';
  end if;

  select t.status::text into v_status
    from public.tools t where t.id = p_tool_id;
  if v_status is null then
    raise exception 'no tool with id %', p_tool_id using errcode = '23503';
  end if;
  if v_status <> 'published' then
    raise exception 'tool % is %, not published', p_tool_id, v_status using errcode = '22023';
  end if;

  -- The refusal that makes this job idempotent and bounds what it can do. A
  -- tool that already has enough statements is left alone, whatever the caller
  -- asks for, so running the job twice writes nothing the second time and a
  -- caller with a long list cannot bury a listing under its own generated
  -- text.
  select count(*) into v_have from public.tool_problems where tool_id = p_tool_id;
  if v_have >= public.statements_wanted() then
    return null;
  end if;

  -- `source` is not a parameter, and that is the point of this function
  -- existing at all: there is no argument here that could write 'seed' or
  -- 'user', so a row written through this door is a generated row by
  -- construction. The brief asks for a refusal; the stronger form is not
  -- offering the choice.
  insert into public.tool_problems
    (tool_id, statement, sort_order, source, generated_model, verified_model)
  values
    (p_tool_id, v_text, coalesce(v_have, 0)::smallint, 'generated',
     btrim(p_generated_model), btrim(p_verified_model))
  on conflict (tool_id, statement) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.store_generated_statement(bigint, text, text, text) is
  'Write one generated problem statement onto a published tool. Returns the new '
  'row''s id, or null when the tool already has public.statements_wanted() '
  'statements or the text is already one of them — which is what makes the job '
  'idempotent. There is no `source` parameter: a row written through this door '
  'is source = ''generated'' by construction, and it must name both the model '
  'that wrote it and the model that checked it. EXECUTE belongs to '
  'foundit_embed; the application role has no business writing the catalogue.';

-- ===========================================================================
-- 3. query_reranks — the reranker's cache
--
-- Phase 5's second paid call. `gpt-5-nano` is shown the sentence and, for each
-- of the top N candidates the Phase 4 search returned, only that candidate's
-- slug, name, summary and problem statements; it returns a relevance in
-- {0,1,2,3} for each. That costs money and about two seconds, and the same
-- sentence over the same candidates has the same answer — so it is cached,
-- keyed on BOTH halves of the question.
--
-- THE KEY IS A PAIR, and it has to be. A judgement is about a sentence AND a
-- list: the same sentence over a different candidate set is a different
-- question, and serving one answer for the other would reorder a page against
-- a judgement of tools that are not on it. `candidates_hash` is the sha256 of
-- the candidate slugs, sorted, joined with a newline — computed by the caller,
-- because the caller is the only one that knows which candidates survived the
-- constraint filter.
--
-- Everything else is 0008, line for line: no user column, no session column,
-- no IP column, no foreign key to anything that has one; row-level security
-- enabled and forced with NO POLICY at all; no grant on the table; three
-- definer functions as the only doors; a 20,000-row least-recently-used cap;
-- and a refusal rather than a truncation over 200 characters.
-- ===========================================================================
create or replace function public.rerank_model()
returns text
language sql
immutable
set search_path = ''
as $fn$
  select 'gpt-5-nano'::text;
$fn$;

comment on function public.rerank_model() is
  'The model public.query_reranks rows must have been produced by. The twin of '
  'public.reading_model() and public.embedding_model(), for the same reason: a '
  'judgement is only as good as the prompt and the schema it was produced '
  'under, so changing the model in a migration makes every judgement recorded '
  'by the old one invisible on the same day.';

create table if not exists public.query_reranks (
  query_norm      text not null,
  -- sha256, hex, of the candidate slugs sorted and newline-joined. Computed by
  -- the caller and checked here for shape, because it is the half of the key
  -- this table cannot derive for itself.
  candidates_hash text not null,
  judgement       jsonb not null,
  rerank_model    text not null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz not null default now(),

  primary key (query_norm, candidates_hash),

  constraint query_reranks_key_is_normalized check (
    length(query_norm) between 1 and 200
    and query_norm = lower(query_norm)
    and strpos(query_norm, '  ') = 0
  ),

  constraint query_reranks_hash_is_sha256 check (
    candidates_hash ~ '^[0-9a-f]{64}$'
  ),

  -- The shape. An array of objects, each carrying exactly a slug and a
  -- relevance in 0..3. lib/rerank.ts refuses the same things in TypeScript
  -- before it gets here; this is the database saying it again in the place a
  -- caller cannot skip.
  --
  -- Written as a NOT EXISTS over a lateral unnest rather than as an aggregate,
  -- because a CHECK may not contain a subquery — so the whole test has to be
  -- expressible with jsonb operators. `@?` takes a JSON path, which can say
  -- "there is an element that is wrong" without a subquery at all.
  constraint query_reranks_shape check (
    jsonb_typeof(judgement) = 'array'
    and jsonb_array_length(judgement) between 1 and 100
    -- Nothing in the array that is not an object with exactly two keys...
    and not (judgement @? '$[*] ? (@.type() != "object")')
    -- ...whose slug is a string and whose relevance is an integer 0..3.
    and not (judgement @? '$[*].slug ? (@.type() != "string")')
    and not (judgement @? '$[*].relevance ? (@.type() != "number")')
    and not (judgement @? '$[*].relevance ? (@ < 0 || @ > 3)')
  )
);

comment on table public.query_reranks is
  'One row per (normalised sentence, candidate set): what gpt-5-nano judged '
  'each candidate''s relevance to be, so the next person who types the same '
  'thing and gets the same candidates costs nothing. It has no user column, no '
  'session column, no IP column and no foreign key to anything that has one, '
  'and it must never gain any of them — exactly as unjoinable to a person as '
  'public.search_events, public.query_embeddings and public.query_readings. '
  'Row-level security is enabled and forced and there is no policy on it at '
  'all: every read and write goes through a SECURITY DEFINER function and '
  'foundit_app holds no grant on the table itself.';

comment on column public.query_reranks.candidates_hash is
  'sha256, hex, of the candidate slugs sorted and joined with newlines. Half '
  'the key, because a judgement is about a sentence AND a list: the same '
  'sentence over a different candidate set is a different question, and '
  'serving one answer for the other would reorder a page against a judgement '
  'of tools that are not on it.';

alter table public.query_reranks enable row level security;
alter table public.query_reranks force row level security;

-- No policy, deliberately, and for the third time in this schema: with RLS
-- forced and no policy the table returns no rows and accepts no writes from
-- anybody subject to policies, which is every role except the owner.
-- foundit_app additionally holds no grant, so it is refused twice over before
-- the policy layer is reached. The three functions below are the only doors.

create or replace function public.query_rerank(p_query text, p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select qr.judgement
    from public.query_reranks qr
   where qr.query_norm = public.normalize_query(p_query)
     and qr.candidates_hash = p_hash
     and qr.rerank_model = public.rerank_model();
$fn$;

comment on function public.query_rerank(text, text) is
  'The judgement recorded for this sentence over this candidate set under the '
  'current model, or null. Takes the raw sentence and normalises it here, so '
  'no caller can invent half a key. Null costs a paid call, which is what the '
  'MAX_RERANK_CALLS_PER_DAY cap in lib/rate-limit.ts bounds.';

create or replace function public.store_query_rerank(
  p_query     text,
  p_hash      text,
  p_judgement jsonb,
  p_model     text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  c_cap  constant bigint := 20000;
  c_odds constant real := 0.02;

  v_raw      int := length(btrim(coalesce(p_query, '')));
  v_key      text;
  v_estimate bigint;
  v_deleted  bigint;
begin
  -- Refuse rather than truncate, for 0008's reason: normalize_query caps at
  -- 200 with left(), so two different sentences sharing a 200-character prefix
  -- would share a key and the second would be served the first one's
  -- judgement. Nothing honest reaches this with more.
  if v_raw > 200 then
    raise exception 'query is % characters; the maximum is 200', v_raw
      using errcode = '22001',
            hint = 'Trim the query to 200 characters before reranking it.';
  end if;

  v_key := public.normalize_query(p_query);
  if v_key = '' or p_judgement is null or p_hash is null then
    return;
  end if;

  if p_model is distinct from public.rerank_model() then
    raise exception 'rerank model % is not the model this database uses (%)',
      coalesce(p_model, '(null)'), public.rerank_model()
      using errcode = '22023',
            hint = 'Re-record, or change public.rerank_model() in a migration.';
  end if;

  insert into public.query_reranks (query_norm, candidates_hash, judgement, rerank_model)
  values (v_key, p_hash, p_judgement, p_model)
  on conflict (query_norm, candidates_hash) do update
    set judgement    = excluded.judgement,
        rerank_model = excluded.rerank_model,
        last_used_at = now();

  select coalesce(reltuples, 0)::bigint into v_estimate
    from pg_class where oid = 'public.query_reranks'::regclass;

  if random() < c_odds or v_estimate > c_cap then
    delete from public.query_reranks
     where (query_norm, candidates_hash) in (
       select qr.query_norm, qr.candidates_hash
         from public.query_reranks qr
        order by qr.last_used_at desc, qr.query_norm, qr.candidates_hash
       offset c_cap
     );
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      execute 'analyze public.query_reranks';
    end if;
  end if;
end;
$fn$;

comment on function public.store_query_rerank(text, text, jsonb, text) is
  'Cache one reranker judgement, keyed on the normalised sentence and the hash '
  'of the candidate slugs, and keep the table under 20,000 rows by evicting '
  'the least recently used. Raises on a query over 200 characters rather than '
  'truncating, and on a judgement from a model other than '
  'public.rerank_model(). The judgement''s shape is refused by the CHECK on '
  'the table rather than by this function, so no future writer can skip it.';

create or replace function public.touch_query_rerank(p_query text, p_hash text)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  update public.query_reranks
     set last_used_at = now()
   where query_norm = public.normalize_query(p_query)
     and candidates_hash = p_hash;
$fn$;

comment on function public.touch_query_rerank(text, text) is
  'Records that a cached judgement was used, for eviction. Separate from the '
  'read because the read is STABLE and cannot write, and because a visitor '
  'must never wait on bookkeeping: the application calls this after the '
  'response has gone out and does not await it.';

-- ===========================================================================
-- 4. An unjudged search, and a judged "no"
--
-- `search_events.had_good_match` has held a constant `false` since 0001,
-- because nothing in Phases 2 to 4 could honestly fill it: the application
-- deliberately does not pass it (app/results/page.tsx says why at length) and
-- the only value it could have supplied was `result_count > 0`, which is a
-- different question wearing this column's name.
--
-- Phase 5 defines the word — docs/product-decisions.md §17 — and the
-- definition has a precondition: **the reranker ran**. A search where it did
-- not run (no key, a timeout, the daily cap, the fallback path) has not been
-- judged at all, and `had_good_match = false` on such a row would read on the
-- operator dashboard as "this search found nothing good", which is a claim
-- nobody made.
--
-- So there are three states and two booleans:
--
--   match_judged = false, had_good_match = false   not judged — nothing is claimed
--   match_judged = true,  had_good_match = false   judged, and nothing fit
--   match_judged = true,  had_good_match = true    judged, and something fit
--
-- The fourth combination is refused by a CHECK, because "not judged but good"
-- is not a state the definition can produce.
-- ===========================================================================
alter table public.search_events
  add column if not exists match_judged boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.search_events'::regclass
       and conname = 'search_events_good_implies_judged'
  ) then
    alter table public.search_events
      add constraint search_events_good_implies_judged
      check (match_judged or not had_good_match);
  end if;
end
$$;

comment on column public.search_events.match_judged is
  'True when the reranker ran on this search and returned a validated '
  'judgement. It is what tells an UNJUDGED search apart from a judged "no": '
  'had_good_match = false on an unjudged row would read as "found nothing '
  'good", which is a claim nobody made. A CHECK refuses had_good_match without '
  'this, because "not judged but good" is not a state the definition in '
  'docs/product-decisions.md §17 can produce.';

comment on column public.search_events.had_good_match is
  'True when the reranker ran and judged at least one returned result at '
  'relevance 2 or 3 — "fits" or "clearly fits". That is the whole definition '
  'and it is written out in docs/product-decisions.md §17. Read it together '
  'with match_judged: false here means "judged, and nothing fit" only when '
  'match_judged is true, and means nothing at all when it is false.';

-- --- log_search_event grows one argument ---------------------------------
--
-- DROP and CREATE rather than a second overload, and the difference matters:
-- a six-argument function whose last argument has a default would be ambiguous
-- with the five-argument one on every existing five-argument call, and
-- PostgreSQL would refuse the call rather than choose. Dropping the old
-- signature and creating one that takes the new argument WITH A DEFAULT leaves
-- every existing caller working unchanged — lib/sql.ts passes five named
-- arguments and still does — while making the sixth available to the one
-- caller that can now answer it honestly.
drop function if exists public.log_search_event(text, int, real, boolean, int);

create or replace function public.log_search_event(
  p_query          text,
  p_result_count   int,
  p_top_score      real    default null,
  p_had_good_match boolean default false,
  p_latency_ms     int     default null,
  p_match_judged   boolean default false
)
returns void
language sql
set search_path = pg_catalog, public
as $$
  insert into public.search_events
    (query_text, query_hash, result_count, top_score, had_good_match, latency_ms,
     match_judged)
  select
    left(btrim(coalesce(p_query, '')), 200),
    encode(
      sha256(
        convert_to(
          lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')),
          'UTF8'
        )
      ),
      'hex'
    ),
    least(greatest(coalesce(p_result_count, 0), 0), 32767)::smallint,
    p_top_score,
    -- Belt and braces with the CHECK above: a caller that passes "good" without
    -- "judged" has misread the definition, and the safe reading of that pair is
    -- the one that claims less. The CHECK would raise; this makes the row
    -- honest instead of making the search fail after it has already answered.
    coalesce(p_had_good_match, false) and coalesce(p_match_judged, false),
    case when p_latency_ms is null then null else greatest(p_latency_ms, 0) end,
    coalesce(p_match_judged, false);
$$;

comment on function public.log_search_event(text, int, real, boolean, int, boolean) is
  'Records one search for the aggregate quality panel. Takes no user id and '
  'returns no row id, on purpose: search text must never become joinable to a '
  'person. The 200-character cap and the query hash are not enforced here — '
  'they are enforced by the search_events_normalize trigger and the two CHECK '
  'constraints 0003_hardening.sql added, because this function was never the '
  'only way in. p_match_judged says whether the reranker ran; p_had_good_match '
  'is only recorded when it did, because "good" is defined in terms of its '
  'judgement (docs/product-decisions.md §17).';

-- ===========================================================================
-- 5. Who may do what
--
-- Two audiences and nothing in between.
--
-- foundit_embed gets the generation job's four functions. It still holds no
-- privilege on any table, and it still cannot search, read the query caches or
-- see search_events.
--
-- foundit_app gets the rerank cache's three functions and the new tool_problems
-- columns. It does NOT get store_generated_statement: the web application does
-- not write the catalogue, and a role that could write a problem statement
-- could write the text the ranker matches on.
--
-- THE COLUMN GRANTS ARE NOT OPTIONAL. 0007 replaced foundit_app's table-wide
-- SELECT on public.tools and public.tool_problems with a generated column list
-- so that the embedding columns could be excluded, and wrote down the price:
-- "a column added by a LATER migration will not be in it, and that migration
-- has to grant its own column." This is that migration.
-- ===========================================================================
grant select (source, generated_model, verified_model)
  on public.tool_problems to foundit_app;

revoke all on public.query_reranks from public;

revoke execute on function public.rerank_model() from public;
revoke execute on function public.query_rerank(text, text) from public;
revoke execute on function public.store_query_rerank(text, text, jsonb, text) from public;
revoke execute on function public.touch_query_rerank(text, text) from public;
revoke execute on function public.statements_wanted() from public;
revoke execute on function public.statement_work(int) from public;
revoke execute on function public.published_tool_names() from public;
revoke execute on function public.statement_similarity(bigint, halfvec) from public;
revoke execute on function public.store_generated_statement(bigint, text, text, text) from public;

grant execute on function public.rerank_model() to foundit_app;
grant execute on function public.query_rerank(text, text) to foundit_app;
grant execute on function public.store_query_rerank(text, text, jsonb, text) to foundit_app;
grant execute on function public.touch_query_rerank(text, text) to foundit_app;

grant execute on function public.statements_wanted() to foundit_embed;
grant execute on function public.statement_work(int) to foundit_embed;
grant execute on function public.published_tool_names() to foundit_embed;
grant execute on function public.statement_similarity(bigint, halfvec) to foundit_embed;
grant execute on function public.store_generated_statement(bigint, text, text, text)
  to foundit_embed;

-- log_search_event was dropped and recreated above, so its grant went with it.
grant execute on function public.log_search_event(text, int, real, boolean, int, boolean)
  to foundit_app;
