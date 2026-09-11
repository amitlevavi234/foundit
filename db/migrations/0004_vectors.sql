-- ===========================================================================
-- Foundit — 0004_vectors
--
-- Hybrid retrieval. 0002 built search out of full-text and trigrams and said,
-- at the bottom of the file, that nothing in it read tool_problems.embedding.
-- This migration is the change that does, and it adds exactly one signal to
-- the fusion: the cosine distance between the sentence somebody typed and the
-- problem statements a tool says it solves.
--
-- Six things here are load-bearing and must not be "simplified" away:
--
--   1. THE VECTOR LEG RANKS ONLY THE CONSTRAINT-FILTERED CANDIDATE SET. It is
--      handed the ids of the `eligible` CTE and can return nothing else. A
--      filter is a WHERE clause, and a new ranking signal is the classic way
--      one silently becomes a preference: rank everything, then hope the join
--      at the end removes what should not be there. Here there is nothing to
--      hope about — a paid tool is not in the array, so it cannot come back.
--
--   2. THERE IS STILL NO VECTOR INDEX. An approximate index drops matches once
--      results are filtered and this product filters on nearly every search
--      (00-SUMMARY.md ruling 4). 504 statements times one 512-dimension
--      half-precision distance is well under a millisecond of arithmetic.
--      Revisit around 50,000 vectors, with the golden set to prove it.
--
--   3. NO EMBEDDING EVER LEAVES THE DATABASE. Not one function here returns a
--      halfvec. The cache is read by public.query_vector_ranks, which returns
--      (tool_id, rank) and nothing else, and the only halfvec that crosses the
--      wire in the other direction is the parameter of a setter. `select *` on
--      a table with a vector column would cost ~50 kB of egress a request and
--      is what the explicit column lists in 0002 and lib/sql.ts exist to stop.
--
--   4. THE QUERY CACHE HAS NO COLUMN THAT COULD BE A PERSON, and it never
--      will, for the same reason search_events has none: "describe your
--      problem" collects health, money and relationship trouble. Five columns,
--      keyed on the normalised text, with row-level security enabled and
--      FORCED and — deliberately — no policy at all and no grant to
--      foundit_app. A table with no policy returns no rows to anybody who is
--      subject to policies, which is a stronger statement than any policy
--      could make and needs no `true` anywhere to say it.
--
--   5. SEARCH STILL RUNS AS THE CALLER. search_tools and search_tools_impl
--      remain SECURITY INVOKER, so row-level security still applies to every
--      table search touches. The three definer functions below are each one
--      narrow question over one table, in the same shape as auth.is_admin()
--      and public.tool_is_visible() from 0001.
--
--   6. A MISSING EMBEDDING IS NOT AN ERROR. Every path here treats "we have no
--      vector for this sentence" as a leg that contributes nothing, so a
--      search with no key, no cache entry and no API runs exactly the Phase 2
--      query and returns exactly the Phase 2 answer. The application is told
--      so through embedding_missing and decides whether to go and get one; the
--      database never waits on anything outside itself.
--
-- db/test/vectors_test.sql proves 1, 3, 4 and the length ceiling behaviourally.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. One name for the model, in one place.
--
-- Three things have to agree about which model produced a vector: the job that
-- fills tool_problems.embedding, the cache that stores query vectors, and the
-- search that compares the two. Cosine distance between vectors from different
-- models is a number with no meaning, and nothing about it looks wrong — the
-- search simply gets worse. So the name lives here, the setters refuse a value
-- that disagrees with it, and the reads filter on it.
--
-- Changing model is therefore a migration: replace this function and every row
-- whose embedding_model no longer matches becomes work for the embedding job
-- (scripts/embed.mjs) and a cache miss for search. Nothing has to be deleted
-- by hand and nothing silently compares apples to pears in the meantime.
--
-- The dimension count is not in the name. It is in the column type, halfvec(512),
-- which is the only place that can actually enforce it.
-- ===========================================================================
create or replace function public.embedding_model()
returns text
language sql
immutable
set search_path = ''
as $fn$
  select 'text-embedding-3-small'::text;
$fn$;

comment on function public.embedding_model() is
  'The embedding model every vector in this database was produced by. One '
  'name, read by the search, the query cache and the embedding job, so that a '
  'cosine distance is always between two vectors from the same space. '
  'Shortened to 512 dimensions in the API request; that half of the contract '
  'is enforced by the halfvec(512) column type.';

-- ===========================================================================
-- 2. One normalisation, in one place.
--
-- The cache is keyed on the query text, so "Split a  BILL" and "split a bill"
-- must be one key or the cache misses on a difference nobody meant. That is
-- the same requirement search_events already has, and it is already answered
-- there: 0002's log_search_event and 0003's search_events_normalize trigger
-- both trim, cap at 200 characters, collapse whitespace runs and lower-case,
-- in that order.
--
-- This function is that expression, written out once, so that the query cache
-- and the search log bucket a sentence identically. The trigger is not rewritten
-- to call it — 0003 pins its search_path to '' precisely so that nothing it
-- resolves can be shadowed, and a trigger on the one table that must never
-- become personal data is not the place to introduce a dependency on a
-- function somebody could replace. Two copies of four operators, and
-- db/test/vectors_test.sql asserts they still agree.
--
-- IMMUTABLE because it is: btrim, left, regexp_replace and lower are all
-- immutable, which is what lets this appear in a CHECK constraint and in an
-- index expression later if one is ever wanted.
-- ===========================================================================
create or replace function public.normalize_query(p_query text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select lower(
           regexp_replace(
             btrim(left(btrim(coalesce(p_query, '')), 200)),
             '\s+', ' ', 'g'
           )
         );
$fn$;

comment on function public.normalize_query(text) is
  'The cache key for a sentence: trimmed, capped at 200 characters, '
  'whitespace runs collapsed, lower-cased. Deliberately the same four '
  'operations, in the same order, that search_events_normalize applies before '
  'hashing, so the query cache and the search log bucket a sentence the same '
  'way. lib/embeddings.ts mirrors it in TypeScript and tests/embeddings.test.mjs '
  'checks the two against each other.';

-- ===========================================================================
-- 3. query_embeddings — the cache, and what it is not
--
-- Embedding a sentence costs a network round trip to a paid API and about ten
-- times what the database costs for the same search (docs/build-phases.md, the
-- efficiency standard). Most sentences are typed more than once. So the vector
-- is kept, keyed on the normalised text.
--
-- What this table does NOT have, and must never grow:
--
--   a user id, a profile id, a session id, an IP address, a device
--   fingerprint, a request id, or a foreign key to anything that has one.
--
-- It is the same rule as search_events and for the same reason. The difference
-- is that search_events at least has a product story for its text (the
-- aggregate "what people search for" panel); this table has none at all. It is
-- a memo pad for an API response. If a row here were joinable to a person it
-- would be a transcript of what they went looking for, bought at the price of
-- a cache.
--
-- created_at and last_used_at are for eviction, which is the only reason to
-- keep either. Nothing reads them for anything else, and a timestamp that is
-- not attached to a person is not attached to a person.
-- ===========================================================================
create table if not exists public.query_embeddings (
  -- The normalised sentence IS the key. No surrogate id: an id is a handle,
  -- and a handle is what somebody stashes next to a user row.
  query_norm      text primary key,
  embedding       halfvec(512) not null,
  embedding_model text not null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz not null default now(),

  -- The written-down invariant. Unreachable while store_query_embedding is the
  -- only writer — it normalises first — and the backstop for the day it is
  -- not, in exactly the spirit of 0003's two CHECKs on search_events.
  --
  -- It deliberately does NOT require btrim(query_norm) = query_norm. The
  -- normalisation is the search_events trigger's, operator for operator, and
  -- that one trims BEFORE collapsing whitespace rather than after — so a
  -- sentence beginning with a tab normalises to one beginning with a single
  -- space. That is a wart, it is two years of search_events hashes old, and
  -- the choice here is between inheriting it and having two normalisations
  -- that agree on everything except the inputs nobody checks. One
  -- normalisation, warts included; tests/embeddings.test.mjs pins the case.
  constraint query_embeddings_key_is_normalized check (
    length(query_norm) between 1 and 200
    and query_norm = lower(query_norm)
    and strpos(query_norm, '  ') = 0
  )
);

comment on table public.query_embeddings is
  'One row per distinct normalised search sentence: the vector an embedding '
  'model produced for it, so the next person who types the same thing costs '
  'nothing. It has no user column, no session column, no IP column and no '
  'foreign key to anything that has one, and it must never gain any of them — '
  'it is exactly as unjoinable to a person as public.search_events, and for '
  'the same reason. Row-level security is enabled and forced and there is no '
  'policy on it at all: every read and write goes through a SECURITY DEFINER '
  'function, and foundit_app holds no grant on the table itself.';

comment on column public.query_embeddings.last_used_at is
  'When a search last used this row. For eviction, and for nothing else. '
  'Written by store_query_embedding on a re-store and by touch_query_embedding '
  'after a cache hit; search itself is STABLE and cannot write, which is why '
  'the touch is a separate fire-and-forget call the visitor never waits for.';

alter table public.query_embeddings enable row level security;
alter table public.query_embeddings force row level security;

-- No policy is created here, and that is the design rather than an omission.
--
-- db/test/rls_test.sql requires row-level security enabled and forced on every
-- table in public, and the project forbids a policy that evaluates to `true`.
-- Both are satisfied the honest way: with RLS forced and no policy, the table
-- returns no rows and accepts no writes from anybody who is subject to
-- policies — which is every role except the owner. foundit_app additionally
-- holds no grant, so it is refused twice over, before the policy layer is even
-- reached. The three functions below are the only doors, and each one answers
-- a single narrow question.

-- ===========================================================================
-- 4. The three doors into the cache.
--
-- All three are SECURITY DEFINER with search_path pinned, following 0001's
-- auth.is_admin() and public.tool_is_visible(): a definer function is an
-- authorization bypass wearing a helpful hat, so each one is kept to a single
-- question over a single table with no branch a caller can steer.
--
-- Note what none of them does: return an embedding. A getter that handed a
-- halfvec back to the application would be 1 kB of egress per call and would
-- make rule 3 at the top of this file a matter of the application's good
-- manners. query_vector_ranks does the distance arithmetic inside the database
-- and returns ranks.
-- ===========================================================================

-- --- Is there a vector for this sentence, or must the caller go and get one?
--
-- Returns false when the caller already supplied one (nothing is missing), and
-- false for an empty sentence (nothing to embed: search_tools reads that as
-- browse). Otherwise it is a primary key lookup.
create or replace function public.query_embedding_missing(
  p_query     text,
  p_embedding halfvec default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select case
           when p_embedding is not null then false
           when public.normalize_query(p_query) = '' then false
           else not exists (
             select 1
               from public.query_embeddings qe
              where qe.query_norm = public.normalize_query(p_query)
                and qe.embedding_model = public.embedding_model()
           )
         end;
$fn$;

comment on function public.query_embedding_missing(text, halfvec) is
  'True when a search would have to call the embedding API to get a vector for '
  'this sentence: no vector was supplied and none is cached under the current '
  'model. This is the whole of what the application learns about the cache — a '
  'boolean, never the vector — and it is what turns a miss into exactly one '
  'extra round trip instead of a blind API call on every search.';

-- --- Keep this vector for the next person who types the same thing.
--
-- Not an upsert of convenience: the ON CONFLICT branch is what makes a
-- concurrent double-miss harmless, and it is also where last_used_at is
-- refreshed.
create or replace function public.store_query_embedding(
  p_query     text,
  p_embedding halfvec,
  p_model     text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_key text := public.normalize_query(p_query);
begin
  if v_key = '' or p_embedding is null then
    -- Nothing to cache. Silent rather than an error: an empty sentence is a
    -- browse, which is a legitimate search that simply has no vector.
    return;
  end if;

  -- Loud, because the alternative is a table holding vectors from two
  -- different spaces and a search quietly getting worse.
  if p_model is distinct from public.embedding_model() then
    raise exception 'embedding model % is not the model this database uses (%)',
      coalesce(p_model, '(null)'), public.embedding_model()
      using errcode = '22023',
            hint = 'Re-embed, or change public.embedding_model() in a migration.';
  end if;

  insert into public.query_embeddings (query_norm, embedding, embedding_model)
  values (v_key, p_embedding::halfvec(512), p_model)
  on conflict (query_norm) do update
    set embedding       = excluded.embedding,
        embedding_model = excluded.embedding_model,
        last_used_at    = now();
end;
$fn$;

comment on function public.store_query_embedding(text, halfvec, text) is
  'Cache the vector for one sentence, keyed on its normalised text. Takes the '
  'raw sentence and normalises it here, so no caller can invent a key. Refuses '
  'a vector from a model other than public.embedding_model(), because a cosine '
  'distance between two spaces is a number with no meaning and nothing about '
  'it looks wrong.';

-- --- This cache row was used. Nothing else about it changes.
create or replace function public.touch_query_embedding(p_query text)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  update public.query_embeddings
     set last_used_at = now()
   where query_norm = public.normalize_query(p_query);
$fn$;

comment on function public.touch_query_embedding(text) is
  'Records that a cached vector was used, for eviction. Separate from search '
  'because search is STABLE and cannot write, and because a visitor must never '
  'wait on bookkeeping: the application calls this after the response has gone '
  'out, in the same place it logs the search event, and does not await it.';

-- ===========================================================================
-- 5. The vector leg.
--
-- One function, because the arithmetic has to happen somewhere that can read
-- the cache, and the cache is owner-only. It takes the candidate set as an
-- array of tool ids — which is the whole of the constraint guarantee. The
-- caller filters; this ranks what it is given and can return nothing else.
--
-- min(distance) per tool is the vector twin of 0002's max(ts_rank_cd) per
-- tool, and for the same reason written out there: a tool is a good answer if
-- ANY ONE of the problems it lists is the problem asked about. Averaging would
-- punish a thorough listing for also solving five other things; summing would
-- reward whoever typed the most statements.
--
-- <=> is cosine distance. The vectors the API returns are already unit length
-- (measured: 1.000069 for a sample query, which is float32 rounding), so
-- cosine and inner product would order identically; cosine is named anyway
-- because it stays correct if that ever stops being true.
--
-- Ranks, not distances, leave this function. RRF needs only the ordering each
-- signal produces, and a cosine distance handed to the caller would be one
-- rescaling away from appearing on a screen as a percentage.
-- ===========================================================================
create or replace function public.query_vector_ranks(
  p_query     text,
  p_embedding halfvec,
  p_tool_ids  bigint[],
  p_limit     int default 100
)
returns table (tool_id bigint, rank_ix int)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with wanted as (
    -- A vector the caller supplied wins; otherwise the cache is consulted.
    -- Either way this is the only place a stored embedding is read, and it
    -- never leaves this statement.
    select coalesce(
             p_embedding,
             (select qe.embedding
                from public.query_embeddings qe
               where qe.query_norm = public.normalize_query(p_query)
                 and qe.embedding_model = public.embedding_model())
           )::halfvec(512) as vec
  )
  -- `wanted` is one row, so this is a cross join that either brings a vector
  -- to every candidate or — when there is no vector — is filtered away whole.
  select tp.tool_id,
         (row_number() over (
            order by min(tp.embedding <=> w.vec) asc, tp.tool_id
          ))::int as rank_ix
    from wanted w
    join public.tool_problems tp
      on tp.embedding is not null
     -- THE constraint guarantee. Everything this function can return was
     -- already eligible when the caller built this array.
     and tp.tool_id = any (p_tool_ids)
   -- No vector for this sentence: no rows, no cost, and the caller's fusion
   -- is arithmetically identical to what 0002 produced.
   where w.vec is not null
   group by tp.tool_id
   -- Positional, because rank_ix is also the name of an output column of this
   -- function and a bare reference would be ambiguous.
   order by 2
   limit greatest(coalesce(p_limit, 100), 1);
$fn$;

comment on function public.query_vector_ranks(text, halfvec, bigint[], int) is
  'The vector leg of hybrid search: cosine distance from the query vector to '
  'each candidate tool''s nearest problem statement, returned as ranks. The '
  'candidate set is an argument, so this can never return a tool the caller''s '
  'hard constraints excluded — a filter stays a WHERE clause even when a new '
  'ranking signal arrives. Returns no embedding to anybody: the distance '
  'arithmetic happens here and ranks come out.';

-- ===========================================================================
-- 6. Write an embedding onto a problem statement.
--
-- The embedding job (scripts/embed.mjs) connects as foundit_app, like every
-- other thing this application runs, and foundit_app cannot update
-- tool_problems: the tool_problems_write policy from 0001 requires
-- public.tool_is_mine(tool_id), and a batch job has no identity — correctly, it
-- is not a person and must not pretend to be one by setting a claim.
--
-- So the write goes through one definer function that can set exactly three
-- columns and nothing else. It cannot change a statement, a tool, a sort order
-- or a status, and there is no branch in it a caller can steer.
--
-- embedded_at is set to now(), and the tool_problems_touch trigger sets
-- updated_at to now() in the same statement. Both are transaction_timestamp(),
-- so they come out equal and the job's "embedded_at < updated_at" work
-- predicate is false on the second run. That is what makes the job idempotent,
-- and it is why this is an UPDATE of the real row rather than something
-- cleverer.
-- ===========================================================================
create or replace function public.store_problem_embedding(
  p_id        bigint,
  p_embedding halfvec,
  p_model     text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_found boolean;
begin
  if p_embedding is null then
    raise exception 'store_problem_embedding was given no vector for problem %', p_id
      using errcode = '22023';
  end if;

  if p_model is distinct from public.embedding_model() then
    raise exception 'embedding model % is not the model this database uses (%)',
      coalesce(p_model, '(null)'), public.embedding_model()
      using errcode = '22023',
            hint = 'Re-embed, or change public.embedding_model() in a migration.';
  end if;

  update public.tool_problems
     set embedding       = p_embedding::halfvec(512),
         embedding_model = p_model,
         embedded_at     = now()
   where id = p_id;

  get diagnostics v_found = row_count;
  return v_found;
end;
$fn$;

comment on function public.store_problem_embedding(bigint, halfvec, text) is
  'The embedding job''s one write. Sets embedding, embedding_model and '
  'embedded_at on one problem statement and can touch nothing else. SECURITY '
  'DEFINER because the job connects as foundit_app and has no identity — it is '
  'not a person and must not set a request claim to pretend it is one. Returns '
  'true when a row was updated, so the job can report a statement that '
  'disappeared under it rather than counting it as done.';

-- ===========================================================================
-- 7. Search, with the vector leg in it.
--
-- The signature gains one optional parameter and the result gains one column,
-- so both functions are dropped and recreated rather than replaced — CREATE OR
-- REPLACE cannot change either. Every existing caller keeps working: the new
-- parameter has a default, and the new column is additional, so
-- `search_tools(q)` and `select tool_id, ... from search_tools(...)` mean
-- exactly what they meant before.
--
--   p_embedding  the query vector, when the caller already has it. null means
--                "look in the cache yourself", which is what makes a cached
--                search ONE round trip: the application does not ask whether
--                the cache has it and then search, it searches, and finds out
--                from embedding_missing whether it needs to do anything else.
--
--   embedding_missing  true when this search ran without a vector and one
--                could be fetched. The application embeds, stores, and runs
--                the search again with p_embedding supplied. Nothing about the
--                first answer is wrong — it is the Phase 2 answer — it is just
--                the answer without the leg that needed a network call.
--
-- Everything 0002 says about the other four legs, the constraints, the empty
-- query and the score still describes this function; the parts that are
-- unchanged are not re-justified here, and the comments that are repeated are
-- the ones a reader needs to not undo something on sight.
-- ===========================================================================
drop function if exists public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int);
drop function if exists public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int);

create or replace function public.search_tools_impl(
  p_query      text,
  p_pricing    pricing_model[] default null,
  p_platforms  platform[]      default null,
  p_flags      tool_flag[]     default null,
  p_languages  text[]          default null,
  p_limit      int             default 20,
  p_embedding  halfvec         default null
)
returns table (
  tool_id           bigint,
  slug              citext,
  name              text,
  summary           text,
  pricing           pricing_model,
  score             real,
  match_source      text,
  embedding_missing boolean
)
language plpgsql
stable
set search_path = pg_catalog, public
set pg_trgm.similarity_threshold = '0.3'
as $$
#variable_conflict use_column
declare
  v_k        constant real := 50;
  v_window   constant int  := 100;

  -- Signal weights. The first four are 0002's and are unchanged; the reasoning
  -- for each is written out there and is not repeated.
  v_w_tool    constant real := 1.0;
  v_w_problem constant real := 1.0;
  v_w_all     constant real := 0.5;
  v_w_name    constant real := 0.25;

  -- The vector leg. Three times a full-text leg, and that number was measured
  -- rather than reasoned about.
  --
  -- It started at 1.0 — a peer of the two full-text legs, which is what
  -- "hybrid" sounds like it should mean — and the golden set said 1.0 was
  -- leaving most of the gain on the table. Fifteen weights were run, and every
  -- one of them is in eval/baselines.md under "Phase 3, the weight sweep":
  --
  --     0.5   0.5989      1.5   0.6660      3.25  0.7025
  --     0.75  0.6258      2.0   0.6766      3.5   0.7029
  --     1.0   0.6417      2.5   0.6952      4.0   0.7015
  --     1.25  0.6558      2.75  0.7021      6.0   0.6948
  --                       3.0   0.7018     10.0   0.6895
  --                                       100.0   0.6781
  --
  -- Three things that curve says, and the third is why 3.0 is the number:
  --
  --   The plateau is flat from 2.75 to 4.0 — four values within 0.0014 of each
  --   other. 3.5 is nominally the best of them and picking it would be fitting
  --   the last thousandth of sixty queries. 3.0 sits in the middle of the
  --   plateau and is a number somebody can remember.
  --
  --   It falls again after 4.0. At 100.0 the other four legs are arithmetically
  --   irrelevant and the search is pure vector — and pure vector scores 0.6781,
  --   below the fused 0.7018. So the lexical legs are still earning their
  --   place; this is a fusion, not a vector search with decorations.
  --
  --   Weighting is not a veto. Whatever this number is, the vector leg ranks
  --   only what the constraints already allowed (see query_vector_ranks), so no
  --   weight can make a paid tool appear for a query that said free.
  --
  -- Arithmetically, 3.0 means a first-place vector candidate contributes
  -- 3/(50+1) = 0.0588 against 1/(50+1) = 0.0196 from a first-place full-text
  -- candidate. Meaning outranks words, which is the point of the phase: a tool
  -- that shares no vocabulary at all with the sentence can win, and on the
  -- Hebrew and Russian queries — where `to_tsvector('english', ...)` does
  -- nothing useful — it is the only leg that can.
  v_w_vector  constant real := 3.0;

  v_limit     int;
  v_q         text;
  v_tsq_any   tsquery;
  v_tsq_all   tsquery;
  v_pricing   pricing_model[];
  v_platforms platform[];
  v_flags     tool_flag[];
  v_langs     text[];
  v_missing   boolean;
begin
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q := btrim(coalesce(p_query, ''));

  v_pricing   := nullif(p_pricing,   '{}'::pricing_model[]);
  v_platforms := nullif(p_platforms, '{}'::platform[]);
  v_flags     := nullif(p_flags,     '{}'::tool_flag[]);

  -- "Nothing was asked for" is not the same as "what was asked for normalised
  -- to nothing", and only the first means "no constraint". 0002 explains the
  -- five cases; the code is unchanged.
  if p_languages is null or cardinality(p_languages) = 0 then
    v_langs := null;
  else
    select coalesce(array_agg(lower(btrim(x))), '{}'::text[])
      into v_langs
      from unnest(p_languages) as x
     where btrim(x) <> '';
  end if;

  -- One call, at the top, and the answer is carried onto every row. Asking the
  -- cache twice for one search would be two chances to disagree.
  v_missing := public.query_embedding_missing(v_q, p_embedding);

  -- ----- the empty query: editorial browse, constraints still enforced ----
  -- No sentence means nothing to embed and nothing to compare, so the vector
  -- leg does not exist here and embedding_missing is false.
  if v_q = '' then
    return query
      select t.id,
             t.slug,
             t.name,
             t.summary,
             t.pricing,
             0::real,
             'browse'::text,
             false
        from public.tools t
       where t.status = 'published'
         and (v_pricing   is null or t.pricing = any (v_pricing))
         and (v_platforms is null or t.platforms && v_platforms)
         and (v_flags     is null or t.flags     @> v_flags)
         and (v_langs     is null or t.languages && v_langs)
       order by t.rating_avg desc nulls last, t.like_count desc, t.id
       limit v_limit;
    return;
  end if;

  -- ----- two readings of the same sentence --------------------------------
  -- v_tsq_all is the AND reading, demoted from gate to evidence. v_tsq_any is
  -- retrieval, built from lexemes rather than by rewriting the printed form of
  -- the tsquery — 0002 explains why that distinction is not cosmetic.
  v_tsq_all := websearch_to_tsquery('english', v_q);

  select string_agg(quote_literal(lexeme), ' | ')::tsquery
    into v_tsq_any
    from unnest(to_tsvector('english', v_q));

  v_tsq_any := coalesce(v_tsq_any, v_tsq_all);

  return query
  with
  eligible as not materialized (
    select t.id,
           t.slug,
           t.name,
           t.summary,
           t.pricing,
           t.search_doc,
           t.rating_avg,
           t.like_count
      from public.tools t
     where t.status = 'published'
       and (v_pricing   is null or t.pricing = any (v_pricing))
       and (v_platforms is null or t.platforms && v_platforms)
       and (v_flags     is null or t.flags     @> v_flags)
       and (v_langs     is null or t.languages && v_langs)
  ),

  -- Signal 1: the tool's own document.
  lex_tool as (
    select e.id,
           row_number() over (
             order by ts_rank_cd(e.search_doc, v_tsq_any, 1) desc, e.id
           ) as rank_ix
      from eligible e
     where e.search_doc @@ v_tsq_any
     order by rank_ix
     limit v_window
  ),

  -- Signal 2: the problem statements, lexically. Note the explicit column
  -- list: tool_problems carries a halfvec(512) and `select *` here would drag
  -- the whole embedding column across for no reason.
  lex_problem as (
    select tp.tool_id as id,
           row_number() over (
             order by max(ts_rank_cd(tp.search_doc, v_tsq_any, 1)) desc, tp.tool_id
           ) as rank_ix
      from public.tool_problems tp
      join eligible e on e.id = tp.tool_id
     where tp.search_doc @@ v_tsq_any
     group by tp.tool_id
     order by rank_ix
     limit v_window
  ),

  -- Signal 3: every term, in one place.
  lex_all as (
    select x.id,
           bool_or(x.from_tool)    as via_tool,
           bool_or(x.from_problem) as via_problem,
           row_number() over (
             order by max(x.strength) desc, x.id
           ) as rank_ix
      from (
        select e.id,
               ts_rank_cd(e.search_doc, v_tsq_all, 1) as strength,
               true  as from_tool,
               false as from_problem
          from eligible e
         where e.search_doc @@ v_tsq_all
        union all
        select tp.tool_id,
               ts_rank_cd(tp.search_doc, v_tsq_all, 1),
               false,
               true
          from public.tool_problems tp
          join eligible e on e.id = tp.tool_id
         where tp.search_doc @@ v_tsq_all
      ) x
     group by x.id
     order by rank_ix
     limit v_window
  ),

  -- Signal 4: the half-remembered name.
  fuzzy_name as (
    select e.id,
           row_number() over (
             order by similarity(e.name, v_q) desc, e.id
           ) as rank_ix
      from eligible e
     where e.name % v_q
     order by rank_ix
     limit v_window
  ),

  -- Signal 5, and the whole of this migration: meaning.
  --
  -- The candidate set goes in as an array of ids, so this leg is filtered
  -- before it ranks rather than after. array(select ...) over the eligible CTE
  -- is one pass of a scan the query is doing anyway; what it buys is that the
  -- constraint guarantee is structural instead of a join somebody has to
  -- remember to keep.
  --
  -- This leg fires for every sentence when a vector is available, so unlike
  -- the four above it is not sparse: it ranks every eligible tool that has an
  -- embedded statement, up to the window. That is deliberate and it is what
  -- fixes the zero-result queries — a sentence sharing no vocabulary with the
  -- catalogue used to return nothing at all. It is also the honest cost: a
  -- query with no good answer now returns its nearest neighbours rather than
  -- an empty page, and the interface has no relevance floor to say so with
  -- until Phase 5 calibrates one.
  vec_problem as (
    select v.tool_id as id,
           v.rank_ix
      from public.query_vector_ranks(
             v_q,
             p_embedding,
             array(select e.id from eligible e),
             v_window
           ) v
  ),

  candidates as (
    select id from lex_tool
    union
    select id from lex_problem
    union
    select id from lex_all
    union
    select id from fuzzy_name
    union
    select id from vec_problem
  ),

  fused as (
    select c.id,
           ( coalesce(v_w_tool    / (v_k + lt.rank_ix), 0)
           + coalesce(v_w_problem / (v_k + lp.rank_ix), 0)
           + coalesce(v_w_all     / (v_k + la.rank_ix), 0)
           + coalesce(v_w_name    / (v_k + fn.rank_ix), 0)
           + coalesce(v_w_vector  / (v_k + vp.rank_ix), 0) )::real as score,
           (lt.id is not null or coalesce(la.via_tool,    false)) as via_tool,
           (lp.id is not null or coalesce(la.via_problem, false)) as via_problem,
           (fn.id is not null)                                    as via_name
      from candidates c
      left join lex_tool    lt on lt.id = c.id
      left join lex_problem lp on lp.id = c.id
      left join lex_all     la on la.id = c.id
      left join fuzzy_name  fn on fn.id = c.id
      left join vec_problem vp on vp.id = c.id
  )
  select e.id,
         e.slug,
         e.name,
         e.summary,
         e.pricing,
         f.score,
         case
           when f.via_tool and f.via_problem then 'both'
           when f.via_tool                   then 'tool'
           when f.via_problem                then 'problem'
           -- Nothing lexical matched. Before this migration the only way to be
           -- here was the trigram leg, so `else 'name'` was right by
           -- elimination; now there are two ways and the label has to say
           -- which. A name that looks like what was typed is a more specific
           -- claim than "close in meaning", so it is checked first.
           when f.via_name                   then 'name'
           else 'vector'
         end::text,
         v_missing
    from fused f
    join eligible e on e.id = f.id
   order by f.score desc, e.rating_avg desc nulls last, e.like_count desc, e.id
   limit v_limit;
end;
$$;

comment on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) is
  'The implementation of search. Five signals fused with Reciprocal Rank '
  'Fusion (k=50): the tool''s own document, its problem statements, an '
  'all-terms bonus, a trigram rescue for half-remembered names, and cosine '
  'distance from the query vector to each candidate''s nearest problem '
  'statement. Constraints filter and never score, and the vector leg is handed '
  'the filtered candidate set rather than filtered afterwards. Runs as the '
  'caller: no SECURITY DEFINER. score orders results and is not a calibrated '
  'relevance number — never render it as a percentage.';

create or replace function public.search_tools(
  p_query      text,
  p_pricing    pricing_model[] default null,
  p_platforms  platform[]      default null,
  p_flags      tool_flag[]     default null,
  p_languages  text[]          default null,
  p_limit      int             default 20,
  p_embedding  halfvec         default null
)
returns table (
  tool_id           bigint,
  slug              citext,
  name              text,
  summary           text,
  pricing           pricing_model,
  score             real,
  match_source      text,
  embedding_missing boolean
)
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_len int := length(btrim(coalesce(p_query, '')));
begin
  if v_len > 200 then
    -- 22001 is string_data_right_truncation. The message names the length and
    -- never the text: this is the endpoint that collects health, money and
    -- relationship trouble, and an error string ends up in a log.
    raise exception 'search query is % characters; the maximum is 200', v_len
      using errcode = '22001',
            hint    = 'Trim the query to 200 characters before searching.';
  end if;

  return query
    select *
      from public.search_tools_impl(
        p_query, p_pricing, p_platforms, p_flags, p_languages, p_limit, p_embedding);
end;
$$;

comment on function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) is
  'The public entry point for search. Rejects a query longer than 200 '
  'characters with SQLSTATE 22001 and otherwise delegates unchanged to '
  'public.search_tools_impl. Runs as the caller: no SECURITY DEFINER, so '
  'row-level security still applies. p_embedding is the query vector when the '
  'caller has one; null means "read the cache", which is what makes a cached '
  'search a single round trip. score orders results and is not a calibrated '
  'relevance number — never render it as a percentage.';

-- ===========================================================================
-- 8. Grants. The verbs; the policies — and, for the cache, the absence of any
--    grant on the table itself — still decide the rows.
--
-- foundit_app gets EXECUTE on the five functions it calls and no privilege
-- whatsoever on public.query_embeddings. db/test/vectors_test.sql asserts the
-- second half of that sentence by trying it.
-- ===========================================================================
revoke all on public.query_embeddings from public;

revoke execute on function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) from public;
revoke execute on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) from public;
revoke execute on function public.query_vector_ranks(text, halfvec, bigint[], int) from public;
revoke execute on function public.query_embedding_missing(text, halfvec) from public;
revoke execute on function public.store_query_embedding(text, halfvec, text) from public;
revoke execute on function public.touch_query_embedding(text) from public;
revoke execute on function public.store_problem_embedding(bigint, halfvec, text) from public;

grant execute on function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) to foundit_app;
grant execute on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) to foundit_app;
grant execute on function public.query_vector_ranks(text, halfvec, bigint[], int) to foundit_app;
grant execute on function public.query_embedding_missing(text, halfvec) to foundit_app;
grant execute on function public.store_query_embedding(text, halfvec, text) to foundit_app;
grant execute on function public.touch_query_embedding(text) to foundit_app;
grant execute on function public.store_problem_embedding(bigint, halfvec, text) to foundit_app;
grant execute on function public.embedding_model() to foundit_app;
grant execute on function public.normalize_query(text) to foundit_app;

-- ===========================================================================
-- 9. Indexes.
--
-- One is added and it is not a vector index.
--
-- tool_problems_needs_embedding, from 0001, is `where embedding is null`. That
-- was the whole work queue when the only question was "has this ever been
-- embedded". The job now also re-embeds a statement whose text changed since
-- it was embedded, and a statement embedded by a model this database no longer
-- uses, and neither of those rows has a null embedding. At 504 statements the
-- planner will seq-scan whatever exists, so this index is documentation of the
-- work predicate more than it is a performance decision — but it is the
-- predicate scripts/embed.mjs actually sends, so it stays in step with the job
-- rather than with the job's first version.
--
-- Deliberately NOT created here, still:
--
--   * Any ANN index on tool_problems.embedding — no ivfflat, no hnsw. The
--     reason has not changed and is written out at the top of this file and in
--     0002. `\di public.tool_problems*` is part of the phase's own evidence.
--
--   * An index on query_embeddings beyond its primary key. The only read is a
--     primary key lookup and the only write is an upsert on that key.
-- ===========================================================================
create index if not exists tool_problems_needs_embedding_work
  on public.tool_problems (id)
  where embedding is null or embedded_at < updated_at;

comment on index public.tool_problems_needs_embedding_work is
  'The embedding job''s work queue: never embedded, or embedded before the '
  'statement last changed. The third case the job looks for — embedded by a '
  'model this database no longer uses — cannot be indexed here, because '
  'public.embedding_model() is immutable only until the migration that changes '
  'it, and an index predicate that stops being true is corruption rather than '
  'a stale plan.';

commit;
