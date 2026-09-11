-- ===========================================================================
-- Foundit — 0005_embed_role
--
-- An adversarial review of 0004 found a way to read another visitor's cached
-- query embedding, as foundit_app, with no grant on the table that holds it.
-- This migration closes it, and fixes four smaller things found beside it.
--
-- THE ATTACK, in full, because the shape of it is the lesson:
--
--   0004 gave foundit_app EXECUTE on public.store_problem_embedding, a
--   SECURITY DEFINER function that writes an arbitrary vector onto an
--   arbitrary tool_problems row. Row-level security refuses that write
--   directly — tool_problems_write requires the caller to own the listing —
--   and the definer function handed back exactly what the policy had refused,
--   over all 504 rows.
--
--   That is not a write problem. It is a READ problem, because
--   public.query_vector_ranks will rank any candidate set against the vector
--   cached for any sentence, and return the ORDER. Plant a chosen vector on
--   one statement and its negation on another, ask for the ranking, and the
--   answer is one bit of the cached vector: which of the two is nearer. Repeat
--   per dimension. The reviewer recovered 16 of 16 sign bits of a sentence
--   somebody else had searched for, holding no privilege on
--   public.query_embeddings at all.
--
--   The comment in docs/loop-progress.md that said these functions had "no
--   branch a caller can steer" and a "blast radius of ranking rather than
--   disclosure" was simply wrong. A definer function that writes data another
--   definer function reads is one function, in two halves, and it has to be
--   reasoned about as one.
--
-- THE FIX is a third role and one revocation. The embedding job stops being
-- "the application, doing a batch": it becomes its own role, with EXECUTE on
-- two functions and nothing else — no table grant, no policy, and no access to
-- anything that reads the cache. foundit_app loses store_problem_embedding
-- entirely, which takes the write half of the oracle away from the role that
-- has the read half, and no role has both.
--
--   foundit_owner  owns the schema. Migrations only.
--   foundit_app    the web application and the eval harness. Searches, reads
--                  the cache through query_embedding_missing and
--                  query_vector_ranks, writes it through store_query_embedding.
--                  CANNOT write an embedding onto a problem statement.
--   foundit_embed  scripts/embed.mjs and nothing else. Reads the work queue
--                  and writes problem embeddings, through two definer
--                  functions. CANNOT search, cannot read tool_problems,
--                  cannot touch the query cache, cannot read search_events.
--
-- db/test/vectors_test.sql proves both halves of that table behaviourally.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. foundit_embed
--
-- Created exactly the way 0001 creates foundit_app: LOGIN NOINHERIT and NO
-- PASSWORD. A migration must never set a password — it is a tracked file that
-- runs on the production host — so the role cannot actually log in until
-- something outside the migrations gives it one. That is the same arrangement
-- foundit_app already has, and the two places that do it are:
--
--   development   db/docker-compose.dev.yml, whose init SQL sets a throwaway
--                 literal on a fresh data directory. On an existing one, run
--                 the alter role in that file's header comment by hand.
--   the server    server/setup/09-postgres-service.sh, which generates the
--                 password with openssl into /root/.foundit/db.env (0600,
--                 root only) and applies it. It has never been typed into a
--                 chat window, an editor or a file git can see.
--
-- A role that exists and cannot log in is the safe direction to fail in: the
-- job stops with a connection error rather than running as somebody else.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'foundit_embed') then
    create role foundit_embed login noinherit;
  end if;
end
$$;

comment on role foundit_embed is
  'The embedding job, and nothing else. Holds EXECUTE on exactly two '
  'functions — public.problem_embedding_work and '
  'public.store_problem_embedding — and no privilege on any table, no policy, '
  'and no access to search, to public.query_embeddings or to '
  'public.search_events. It exists because a role that can WRITE a vector onto '
  'a problem statement must not be the same role that can ask which vector is '
  'nearest a cached query: together those two powers read the cache out one '
  'bit at a time.';

grant usage on schema public to foundit_embed;

-- ===========================================================================
-- 2. The work queue, as a function
--
-- The job used to read the queue with a SELECT over tool_problems joined to
-- tools, as foundit_app. foundit_embed holds no grant on either table and is
-- not getting one: a role whose entire job is "embed these strings" needs the
-- strings and the ids, not the table.
--
-- So the queue is a function, and it is the only way in. It returns the two
-- columns the job actually uses and cannot be asked for a third — no
-- embedding, no tool_id, no status, no timestamps.
--
-- The predicate is the job's, written once, here: a row is work when it has
-- never been embedded, when its statement changed after it was last embedded,
-- or when it was embedded by a model this database no longer uses. Keeping it
-- in the database rather than in the job means the two cannot drift, and it is
-- what tool_problems_needs_embedding_work indexes.
-- ===========================================================================
create or replace function public.problem_embedding_work(p_limit int default null)
returns table (id bigint, statement text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select tp.id, tp.statement
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   where tp.embedding is null
      or tp.embedded_at < tp.updated_at
      or tp.embedding_model is distinct from public.embedding_model()
   order by tp.id
   limit case when p_limit is null or p_limit < 1 then null else p_limit end;
$fn$;

comment on function public.problem_embedding_work(int) is
  'The embedding job''s work queue: the id and the text of every published '
  'problem statement that has never been embedded, whose statement changed '
  'after it was embedded, or that was embedded by a model this database no '
  'longer uses. Two columns, and there is no third to ask for. SECURITY '
  'DEFINER because foundit_embed holds no grant on tool_problems and must not '
  'be given one.';

-- ===========================================================================
-- 3. The revocation that closes the oracle
--
-- foundit_app loses the ability to write an embedding onto a problem
-- statement. It never needed it: the web application does not embed the
-- catalogue, the batch job does, and the job now has a role of its own.
--
-- This is the whole of the fix. Everything else in this migration is either
-- the machinery that lets the job keep working without that grant, or one of
-- the smaller things found in the same review.
-- ===========================================================================
revoke execute on function public.store_problem_embedding(bigint, halfvec, text)
  from foundit_app;

revoke execute on function public.problem_embedding_work(int) from public;
grant execute on function public.problem_embedding_work(int) to foundit_embed;
grant execute on function public.store_problem_embedding(bigint, halfvec, text)
  to foundit_embed;

-- The job asks the database which model it is embedding for, rather than
-- carrying its own copy of the name. A constant, and the only other thing
-- foundit_embed may call.
grant execute on function public.embedding_model() to foundit_embed;

comment on function public.store_problem_embedding(bigint, halfvec, text) is
  'The embedding job''s one write. Sets embedding, embedding_model and '
  'embedded_at on one problem statement and can touch nothing else. SECURITY '
  'DEFINER because the job connects as foundit_embed and has no identity — it '
  'is not a person and must not set a request claim to pretend it is one. '
  'EXECUTE belongs to foundit_embed ALONE: 0004 granted it to foundit_app as '
  'well, and a role holding both this and public.query_vector_ranks can read '
  'a cached query embedding out one sign bit at a time by planting vectors and '
  'reading back the order. Do not grant this to the application role again.';

-- ===========================================================================
-- 4. The vector leg only ever ranks published tools
--
-- 0004 relied entirely on its caller passing a filtered candidate set, and the
-- caller — search_tools_impl — does exactly that. That was true and is still
-- true, and it was also the only thing standing between a draft listing and a
-- vector ranking, which is one fewer layer than this schema uses everywhere
-- else: 0002 carries `t.status = 'published'` as an explicit predicate rather
-- than leaning on row-level security, precisely because RLS lets an owner see
-- their own drafts.
--
-- Phase 7 is where people start adding tools, which is where unpublished rows
-- with embeddings start existing. The predicate goes in now, while there is
-- nothing to break, rather than in the migration that first needs it.
--
-- The array of candidate ids stays, and stays load-bearing: it is what makes
-- the hard constraints structural instead of a join somebody has to remember.
-- This is a second condition, not a replacement for it.
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
    select coalesce(
             p_embedding,
             (select qe.embedding
                from public.query_embeddings qe
               where qe.query_norm = public.normalize_query(p_query)
                 and qe.embedding_model = public.embedding_model())
           )::halfvec(512) as vec
  )
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
    -- And a published tool, whatever the caller passed. Belt and braces, in
    -- the same spirit as 0002's explicit status predicate: a definer function
    -- does not get to rely on its caller having been careful.
    join public.tools t
      on t.id = tp.tool_id
     and t.status = 'published'
   where w.vec is not null
   group by tp.tool_id
   -- Positional, because rank_ix is also the name of an output column of this
   -- function and a bare reference would be ambiguous.
   order by 2
   limit greatest(coalesce(p_limit, 100), 1);
$fn$;

comment on function public.query_vector_ranks(text, halfvec, bigint[], int) is
  'The vector leg of hybrid search: cosine distance from the query vector to '
  'each candidate tool''s nearest problem statement, returned as ranks. Two '
  'independent guarantees, both of which must hold: the candidate set is an '
  'argument, so this can never return a tool the caller''s hard constraints '
  'excluded; and only published tools are ranked, whatever the caller passed. '
  'Returns no embedding to anybody — the distance arithmetic happens here and '
  'ranks come out. Note that EXECUTE on this plus EXECUTE on '
  'store_problem_embedding is a read oracle over the query cache; no role has '
  'both, and none may be given both.';

-- ===========================================================================
-- 5. The query cache stops growing forever
--
-- Anyone can search, and every distinct sentence created one permanent row.
-- There was no cap, no eviction and no rate limit, so the table's size was
-- whatever a stranger with a script decided it should be — about 1 kB of
-- vector plus the sentence, per request, until the disk filled. On a 40 GB
-- machine that is a denial of service with no exploit in it, just patience.
--
-- The multiplier is worse than one row per sentence typed. The results screen
-- lets somebody switch a constraint chip off, and dropping a chip changes the
-- text that is searched and therefore the cache key: a sentence carrying three
-- constraints has eight reachable keys, all of them legitimate, all of them
-- cached. Real people will generate several rows per question.
--
-- So: a hard ceiling of 20,000 rows, swept by the setter itself.
--
--   * 20,000 rows is roughly 20 MB of vectors plus the sentences. That is a
--     rounding error on the disk and, at 512 dimensions over a table this
--     size, still a primary key lookup to read.
--   * The sweep runs on about one insert in fifty, and again whenever the
--     planner's own row estimate says the table has run past the ceiling. It
--     deletes by oldest last_used_at, which is the only thing that column is
--     for, so what falls out is what nobody has searched for in longest.
--   * After a sweep that actually deleted something, ANALYZE runs, so the
--     estimate that triggers the next one is not the stale number that
--     triggered this one.
--
-- This bounds the disk. It does not bound the spend: a stranger can still make
-- the server embed a fresh sentence on every request, and the only thing
-- stopping that is the per-visitor rate limit, which is Phase 4's and is not
-- here yet. The vendor-side cap is the ceiling until it lands.
-- ===========================================================================
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
  -- The ceiling, and the reasoning for the number is in the header above.
  c_cap      constant bigint := 20000;
  -- One insert in fifty sweeps. Cheap enough to be unnoticeable, frequent
  -- enough that the table cannot run far past the cap between sweeps.
  c_odds     constant real := 0.02;

  v_raw      int := length(btrim(coalesce(p_query, '')));
  v_key      text;
  v_estimate bigint;
  v_deleted  bigint;
begin
  -- Refuse rather than truncate, and for a reason that is not tidiness:
  -- normalize_query caps at 200 characters with left(), so two different
  -- sentences sharing a 200-character prefix normalise to the SAME key. The
  -- second one would be served the first one's vector, silently, forever. The
  -- 200-character ceiling already exists on search_tools and in the interface;
  -- nothing honest reaches this with more.
  if v_raw > 200 then
    raise exception 'query is % characters; the maximum is 200', v_raw
      using errcode = '22001',
            hint = 'Trim the query to 200 characters before embedding it.';
  end if;

  v_key := public.normalize_query(p_query);

  if v_key = '' or p_embedding is null then
    -- Nothing to cache. Silent rather than an error: an empty sentence is a
    -- browse, which is a legitimate search that simply has no vector.
    return;
  end if;

  -- A zero vector has no direction. Cosine distance to it is NaN, so the
  -- ordering collapses to the tie break — tool_id — and the search looks like
  -- it is working while returning the catalogue in id order. Cached, that
  -- would be served to everybody who typed the same sentence until the row
  -- aged out. lib/embeddings.ts refuses one too; this is the layer that
  -- cannot be bypassed.
  if l2_norm(p_embedding::halfvec(512)) = 0 then
    raise exception 'the embedding for this query is a zero vector, which has no direction'
      using errcode = '22023',
            hint = 'A zero vector makes cosine distance undefined and the ranking meaningless.';
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

  -- --- the sweep ---------------------------------------------------------
  -- reltuples is the planner's estimate and costs a single catalogue lookup;
  -- count(*) on this table would be a sequential scan on every search that
  -- missed the cache, which is the cost this whole file exists to avoid.
  select coalesce(reltuples, 0)::bigint into v_estimate
    from pg_class where oid = 'public.query_embeddings'::regclass;

  if random() < c_odds or v_estimate > c_cap then
    delete from public.query_embeddings
     where query_norm in (
       select qe.query_norm
         from public.query_embeddings qe
        order by qe.last_used_at desc, qe.query_norm
       offset c_cap
     );
    get diagnostics v_deleted = row_count;

    -- So the estimate that triggers the next sweep is not the stale one that
    -- triggered this. Without this, a table that has run past the cap sweeps
    -- on every single insert until autovacuum next looks at it.
    if v_deleted > 0 then
      execute 'analyze public.query_embeddings';
    end if;
  end if;
end;
$fn$;

comment on function public.store_query_embedding(text, halfvec, text) is
  'Cache the vector for one sentence, keyed on its normalised text, and keep '
  'the table under 20,000 rows by evicting the least recently used. Takes the '
  'raw sentence and normalises it here, so no caller can invent a key. Raises '
  'on a query over 200 characters rather than truncating — two sentences '
  'sharing a 200-character prefix must not share a vector — on a zero vector, '
  'and on a vector from a model other than public.embedding_model().';

comment on column public.query_embeddings.last_used_at is
  'When a search last used this row. For eviction, and for nothing else. '
  'Written by store_query_embedding on a re-store and by touch_query_embedding '
  'after a cache hit; search itself is STABLE and cannot write, which is why '
  'the touch is a separate fire-and-forget call the visitor never waits for. '
  'store_query_embedding evicts by this column once the table passes 20,000 '
  'rows.';

-- ===========================================================================
-- 6. Tell the planner how many rows search returns
--
-- A set-returning function with no ROWS clause is estimated at 1000 rows. It
-- returns at most p_limit, which is clamped to 50 and is 12 on the results
-- page. That estimate is not a rounding error, it is a join order:
--
--   The statement the results page sends joins search_tools' rows to
--   public.tools to pick up the columns a card draws. Believing the function
--   would return 1000 rows and the catalogue 149, the planner put the
--   CATALOGUE on the outer side — a sequential scan of every published tool,
--   and for each one an index probe into tool_categories whose row-level
--   security policy calls tool_is_mine() and tool_is_visible(). Two SECURITY
--   DEFINER calls per tool in the catalogue, to decorate twelve rows.
--
--   Measured on the development catalogue: 22 ms of a 27 ms decoration, on top
--   of the search itself. With ROWS 20 the planner drives from the twelve rows
--   it actually has and the decoration costs 7.8 ms.
--
-- 20 rather than 12: 12 is what the results page asks for, 20 is what
-- eval/run.mjs asks for, and 50 is the most anyone can ask for. An estimate
-- has to be one number and being wrong by 8 costs nothing, where being wrong
-- by 980 cost the scan above.
--
-- This changes no result and no ordering. It is the planner being told a fact
-- about a function that the function has always guaranteed.
-- ===========================================================================
alter function public.search_tools(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) rows 20;
alter function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) rows 20;

comment on table public.query_embeddings is
  'One row per distinct normalised search sentence: the vector an embedding '
  'model produced for it, so the next person who types the same thing costs '
  'nothing. Capped at 20,000 rows, least-recently-used first, by '
  'store_query_embedding. It has no user column, no session column, no IP '
  'column and no foreign key to anything that has one, and it must never gain '
  'any of them — it is exactly as unjoinable to a person as '
  'public.search_events, and for the same reason. Row-level security is '
  'enabled and forced and there is no policy on it at all: every read and '
  'write goes through a SECURITY DEFINER function, and foundit_app holds no '
  'grant on the table itself.';

commit;
