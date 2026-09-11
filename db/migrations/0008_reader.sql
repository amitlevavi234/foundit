-- ===========================================================================
-- 0008 — the sentence reader's cache
--
-- Phase 4 adds a second paid call to a search: gpt-5-nano reads the sentence
-- and reports what it requires (lib/reader-model.ts). That call costs money and
-- about a second and a half, and most sentences are typed more than once — the
-- same arithmetic that produced public.query_embeddings in 0004. So the reading
-- is kept, keyed on the normalised sentence, in a table built to the same
-- pattern as that one, deliberately and almost line for line.
--
-- THE NUMBERING. docs/build-phases.md and the Phase 4 brief both call this
-- "0007_reader.sql". 0007 was taken while Phase 3 was being amended, by
-- 0007_summary_vectors_and_floor.sql. Renaming that file would rewrite history
-- that infra.schema_migrations has already recorded, so this is 0008 and the
-- discrepancy is written down here rather than fixed by lying about one of
-- them.
--
-- What this table does NOT have, and must never grow:
--
--   a user id, a profile id, a session id, an IP address, a device
--   fingerprint, a request id, or a foreign key to anything that has one.
--
-- Same rule as search_events and query_embeddings, same reason. A row here is
-- a memo pad for an API response about a sentence. If it were joinable to a
-- person it would be a transcript of what they went looking for, bought at the
-- price of a cache.
--
-- ONE DIFFERENCE FROM THE EMBEDDING CACHE, AND WHY IT IS NOT AN ORACLE.
-- query_vector_ranks never hands a vector back; the arithmetic happens in the
-- database and ranks come out, because a stored vector plus a chosen vector is
-- a way to read the cache out one sign bit at a time (0005). A reading is not
-- like that. public.query_reading() does hand the stored JSON back, and it can
-- only be asked about a sentence the caller already knows — you learn whether
-- THIS sentence has been read before, which is the same thing the response time
-- of the embedding cache already tells anybody who cares to measure it
-- (docs/loop-progress.md records that as accepted and written down). There is
-- no arithmetic here to turn into a probe, and the JSON contains four enum
-- arrays, a boolean and two restatements of the sentence that was supplied.
--
-- Six sections:
--   1. the model this database's readings come from
--   2. the table, its shape constraint, and its row-level security
--   3. reading it
--   4. writing it, with the 200-character refusal and the 20,000-row cap
--   5. marking one used, for eviction
--   6. grants
-- ===========================================================================

-- ===========================================================================
-- 1. The model, named once
--
-- The twin of public.embedding_model(). A reading produced by a different model
-- is not interchangeable with one produced by this one — the prompt, the schema
-- and the guards in lib/reading.ts are tuned against a particular model's
-- failures — so a row records which model produced it and the reader ignores a
-- row that does not match. Changing the model is a migration, which is what
-- makes every stale row invisible on the same day.
-- ===========================================================================
create or replace function public.reading_model()
returns text
language sql
immutable
set search_path = ''
as $fn$
  select 'gpt-5-nano'::text;
$fn$;

comment on function public.reading_model() is
  'The model public.query_readings rows must have been produced by. '
  'lib/reader-model.ts holds the same name as READER_MODEL and the two are '
  'checked against each other in tests/reader.test.mjs. Changing it in a '
  'migration makes every reading recorded by the old model invisible at once, '
  'which is the intended behaviour: a reading is only as good as the prompt '
  'and the guards it was produced under.';

-- ===========================================================================
-- 2. query_readings
--
-- The reading is stored as jsonb rather than as seven columns, and that is a
-- deliberate choice rather than laziness: the seven fields are one answer from
-- one model to one question, they are read back as a unit, nothing joins or
-- aggregates over them, and a later schema change to the reading is then a
-- change in one application file rather than a migration plus a deploy in the
-- right order.
--
-- What stops "jsonb" meaning "anything at all" is the CHECK below. The database
-- is the boundary; lib/reader-model.ts validates the model's answer before it
-- gets this far, and this says the same thing again in the one place a caller
-- cannot skip.
-- ===========================================================================
create table if not exists public.query_readings (
  -- The normalised sentence IS the key, exactly as in query_embeddings. No
  -- surrogate id: an id is a handle, and a handle is what somebody stashes
  -- next to a user row.
  query_norm    text primary key,
  reading       jsonb not null,
  reading_model text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),

  -- The same written-down invariant as query_embeddings, for the same reason:
  -- unreachable while store_query_reading is the only writer, and the backstop
  -- for the day it is not. It inherits the same wart — the normalisation trims
  -- before collapsing whitespace — because one normalisation with a wart beats
  -- two that agree on everything except the inputs nobody checks.
  constraint query_readings_key_is_normalized check (
    length(query_norm) between 1 and 200
    and query_norm = lower(query_norm)
    and strpos(query_norm, '  ') = 0
  ),

  -- The shape. Seven keys, no more and no fewer, with the types the
  -- application will read them as. A model that answered with something else
  -- is refused here as well as in TypeScript, and a future caller that skips
  -- the TypeScript is refused too.
  --
  -- Written with `?&` and `-` rather than the obvious aggregate over
  -- jsonb_object_keys, because a CHECK constraint may not contain a subquery
  -- and a set-returning function needs one. `?&` says every key is present; the
  -- subtraction says there is nothing else, because removing all seven from an
  -- object that has only those seven leaves `{}`.
  constraint query_readings_shape check (
    jsonb_typeof(reading) = 'object'
    and reading ?& array['asks_for_software','english','flags','languages',
                         'platforms','pricing','residual']
    and (reading - array['asks_for_software','english','flags','languages',
                         'platforms','pricing','residual']) = '{}'::jsonb
    and jsonb_typeof(reading -> 'pricing')   = 'array'
    and jsonb_typeof(reading -> 'platforms') = 'array'
    and jsonb_typeof(reading -> 'languages') = 'array'
    and jsonb_typeof(reading -> 'flags')     = 'array'
    and jsonb_typeof(reading -> 'english')   = 'string'
    and jsonb_typeof(reading -> 'residual')  = 'string'
    and jsonb_typeof(reading -> 'asks_for_software') = 'boolean'
  )
);

comment on table public.query_readings is
  'One row per distinct normalised search sentence: what gpt-5-nano read out '
  'of it, so the next person who types the same thing costs nothing. It has no '
  'user column, no session column, no IP column and no foreign key to anything '
  'that has one, and it must never gain any of them — it is exactly as '
  'unjoinable to a person as public.search_events and public.query_embeddings, '
  'and for the same reason. Row-level security is enabled and forced and there '
  'is no policy on it at all: every read and write goes through a SECURITY '
  'DEFINER function, and foundit_app holds no grant on the table itself.';

comment on column public.query_readings.reading is
  'The validated reading: pricing, platforms, languages and flags as arrays of '
  'the catalogue''s own enum labels, english as a restatement of a non-English '
  'sentence, asks_for_software as whether this is a request for a software '
  'tool at all, and residual as the sentence with the constraint phrases '
  'removed. The CHECK on this column is the database saying the same thing '
  'lib/reader-model.ts''s validator says, in the place a caller cannot skip.';

comment on column public.query_readings.last_used_at is
  'When a search last used this row. For eviction, and for nothing else. '
  'Written by store_query_reading on a re-store and by touch_query_reading '
  'after a cache hit; the read is STABLE and cannot write, which is why the '
  'touch is a separate fire-and-forget call the visitor never waits for.';

alter table public.query_readings enable row level security;
alter table public.query_readings force row level security;

-- No policy, and that is the design rather than an omission — the same
-- arrangement as query_embeddings. db/test/rls_test.sql requires row-level
-- security enabled and forced on every table in public, and the project forbids
-- a policy that evaluates to `true`. Both are satisfied honestly: with RLS
-- forced and no policy the table returns no rows and accepts no writes from
-- anybody subject to policies, which is every role except the owner.
-- foundit_app additionally holds no grant, so it is refused twice over before
-- the policy layer is reached. The three functions below are the only doors.

-- ===========================================================================
-- 3. Reading one back
-- ===========================================================================
create or replace function public.query_reading(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select qr.reading
    from public.query_readings qr
   where qr.query_norm = public.normalize_query(p_query)
     and qr.reading_model = public.reading_model();
$fn$;

comment on function public.query_reading(text) is
  'The reading recorded for this sentence under the current model, or null. '
  'Takes the raw sentence and normalises it here, so no caller can invent a '
  'key. Null means the application has to call the model — and a null costs a '
  'paid call, which is why the rate limits in lib/rate-limit.ts exist.';

-- ===========================================================================
-- 4. Writing one
--
-- Line for line the store_query_embedding from 0005, including its two
-- refusals and its sweep, because the two tables have the same growth problem
-- and the same fix. The reasoning is written out there at length; the short
-- version is that anyone can search, every distinct sentence created a
-- permanent row, and the results screen's constraint chips multiply the keys a
-- single question reaches.
-- ===========================================================================
create or replace function public.store_query_reading(
  p_query   text,
  p_reading jsonb,
  p_model   text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  -- The same ceiling as the embedding cache, for the same reasons. A reading is
  -- a few hundred bytes rather than a kilobyte, so this is a smaller table than
  -- that one at the same row count.
  c_cap  constant bigint := 20000;
  -- One insert in fifty sweeps. Cheap enough to be unnoticeable, frequent
  -- enough that the table cannot run far past the cap between sweeps.
  c_odds constant real := 0.02;

  v_raw      int := length(btrim(coalesce(p_query, '')));
  v_key      text;
  v_estimate bigint;
  v_deleted  bigint;
begin
  -- Refuse rather than truncate. normalize_query caps at 200 characters with
  -- left(), so two different sentences sharing a 200-character prefix normalise
  -- to the SAME key and the second would be served the first one's reading,
  -- silently, for as long as the row lived. The 200-character ceiling already
  -- exists on search_tools, in lib/reader-model.ts and in the interface;
  -- nothing honest reaches this with more.
  if v_raw > 200 then
    raise exception 'query is % characters; the maximum is 200', v_raw
      using errcode = '22001',
            hint = 'Trim the query to 200 characters before reading it.';
  end if;

  v_key := public.normalize_query(p_query);

  if v_key = '' or p_reading is null then
    -- Nothing to cache. Silent rather than an error: an empty sentence is a
    -- browse, which is a legitimate search with nothing to read.
    return;
  end if;

  -- Loud, because the alternative is a table holding readings from two
  -- different models and a search quietly getting worse in a way nothing looks
  -- wrong about.
  if p_model is distinct from public.reading_model() then
    raise exception 'reading model % is not the model this database uses (%)',
      coalesce(p_model, '(null)'), public.reading_model()
      using errcode = '22023',
            hint = 'Re-read, or change public.reading_model() in a migration.';
  end if;

  insert into public.query_readings (query_norm, reading, reading_model)
  values (v_key, p_reading, p_model)
  on conflict (query_norm) do update
    set reading       = excluded.reading,
        reading_model = excluded.reading_model,
        last_used_at  = now();

  -- --- the sweep, identical to the embedding cache's ----------------------
  -- reltuples is the planner's estimate and costs a single catalogue lookup;
  -- count(*) here would be a sequential scan on every search that missed.
  select coalesce(reltuples, 0)::bigint into v_estimate
    from pg_class where oid = 'public.query_readings'::regclass;

  if random() < c_odds or v_estimate > c_cap then
    delete from public.query_readings
     where query_norm in (
       select qr.query_norm
         from public.query_readings qr
        order by qr.last_used_at desc, qr.query_norm
       offset c_cap
     );
    get diagnostics v_deleted = row_count;

    -- So the estimate that triggers the next sweep is not the stale one that
    -- triggered this. Without it, a table past the cap sweeps on every insert
    -- until autovacuum next looks at it.
    if v_deleted > 0 then
      execute 'analyze public.query_readings';
    end if;
  end if;
end;
$fn$;

comment on function public.store_query_reading(text, jsonb, text) is
  'Cache the reading for one sentence, keyed on its normalised text, and keep '
  'the table under 20,000 rows by evicting the least recently used. Takes the '
  'raw sentence and normalises it here, so no caller can invent a key. Raises '
  'on a query over 200 characters rather than truncating — two sentences '
  'sharing a 200-character prefix must not share a reading — and on a reading '
  'from a model other than public.reading_model(). The reading''s shape is '
  'refused by the CHECK on the table, not by this function, so no future '
  'writer can skip it.';

-- ===========================================================================
-- 5. This one was used
-- ===========================================================================
create or replace function public.touch_query_reading(p_query text)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  update public.query_readings
     set last_used_at = now()
   where query_norm = public.normalize_query(p_query);
$fn$;

comment on function public.touch_query_reading(text) is
  'Records that a cached reading was used, for eviction. Separate from the '
  'read because the read is STABLE and cannot write, and because a visitor '
  'must never wait on bookkeeping: the application calls this after the '
  'response has gone out, beside the search-event log, and does not await it.';

-- ===========================================================================
-- 6. Who may do what
--
-- The table itself is revoked from everybody. foundit_app gets the three
-- functions and nothing else, which is the same shape as 0004's grants over
-- query_embeddings.
--
-- foundit_embed is deliberately NOT given any of these. It has no business
-- here, and the rule 0005 established — no role holds two halves of anything —
-- is easier to keep by never widening a role than by reasoning about whether a
-- particular pair is safe.
-- ===========================================================================
revoke all on public.query_readings from public;

revoke execute on function public.query_reading(text) from public;
revoke execute on function public.store_query_reading(text, jsonb, text) from public;
revoke execute on function public.touch_query_reading(text) from public;
revoke execute on function public.reading_model() from public;

grant execute on function public.query_reading(text) to foundit_app;
grant execute on function public.store_query_reading(text, jsonb, text) to foundit_app;
grant execute on function public.touch_query_reading(text) to foundit_app;
grant execute on function public.reading_model() to foundit_app;
