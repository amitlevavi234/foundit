-- ===========================================================================
-- 0021 — a fresh reading is fresh
--
-- ONE LINE OF BEHAVIOUR, AND IT MAKES A SENTENCE 0009 ALREADY WROTE TRUE.
--
-- `0009_reading_refusals_expire.sql` makes a cached REFUSAL — a reading whose
-- `asks_for_software` is false — expire twenty-four hours after `created_at`,
-- so that one bad sample cannot empty a page for ever. Its header then says,
-- of a refusal that keeps being re-made:
--
--     "the row is REWRITTEN each time the application stores a fresh reading,
--      so `created_at` moves and the clock starts again."
--
-- It does not move. `public.store_query_reading`'s conflict clause, written in
-- 0008 before 0009 existed, sets `reading`, `reading_model` and `last_used_at`
-- and says nothing about `created_at` — and `created_at` has a
-- `default now()`, which applies to an INSERT and never to the UPDATE half of
-- an upsert. So the clock never restarts.
--
-- WHAT THAT COSTS IN PRODUCTION, which is the reason this is a migration and
-- not a comment. Once a refusal is a day old:
--
--   1. `public.query_reading()` treats it as a miss and returns null;
--   2. the application asks the model — TWO reader requests, because
--      `lib/reader-model.ts` samples twice and votes;
--   3. it gets the same refusal and stores it;
--   4. `created_at` does not move, so the row is still expired;
--   5. the next search of that sentence starts again at 1.
--
-- Every subsequent search of that sentence pays two paid calls, for ever, and
-- nothing anywhere looks wrong: the page is correct, the cache "has" the row,
-- and the only symptom is a reader bill that does not fall as the cache warms.
-- `MAX_READER_CALLS_PER_DAY` is 240 requests — 120 readings — so a handful of
-- popular unanswerable sentences is enough to spend a day's budget on answers
-- the database already had.
--
-- AND WHAT IT COSTS A MEASUREMENT, which is how it was found. `eval/run.mjs`
-- warms `public.query_readings` from `db/seed/embeddings.fixture.json` through
-- this same function at the start of every run, precisely so that a KEYLESS
-- run measures the model pass. With `created_at` frozen at whenever the
-- fixture was first loaded, every recorded refusal reads as expired a day
-- later, `query_reading()` returns null, and the negatives the fixture says
-- are refused are answered with tools instead. Two of the six gate lines in
-- `--baseline` then drift by wall clock — 24 of 31 became 20 of 31 overnight
-- — on a database nobody had touched. CI never saw it because CI creates its
-- database fresh on every run, which is the shape of defect that reaches
-- production precisely because the pipeline cannot see it.
--
-- THE FIX IS THE DEFINITION OF THE COLUMN. `created_at` on a cache row means
-- "when this answer was obtained", not "when this key was first seen" — that
-- is what 0009 reads it as, and it is the only reading under which an
-- expiring refusal makes sense. A store is a fresh answer from the model, so
-- it is a fresh `created_at`. Nothing else in the function changes: same
-- ceiling, same sweep, same raise on a long query and on a foreign model.
--
-- WHAT THIS IS NOT. It is not a way to keep a bad refusal alive. A refusal
-- only gets a new `created_at` by being re-obtained from the model, which is
-- exactly the re-earning 0009 asks for; what changes is that having re-earned
-- it, the answer is believed for the day it was promised rather than for no
-- time at all.
--
-- db/test/reader_test.sql §7 is the behavioural test, in both directions.
-- ===========================================================================
begin;

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
set "foundit.definer" = 'on'
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
        -- THE ONE LINE 0021 IS FOR. A `default now()` applies to the INSERT
        -- and never to the UPDATE half of an upsert, so without this the
        -- column records when the key was first seen rather than when the
        -- answer was obtained — and 0009, which expires a refusal twenty-four
        -- hours after `created_at`, reads it as the second. See this file's
        -- header for what that costs.
        created_at    = now(),
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

-- 0020 §2 attached `SET "foundit.definer" = 'on'` to this function with an
-- ALTER, and `create or replace` keeps a function's SET clauses — but saying it
-- in the definition above is what makes the next `create or replace` safe as
-- well. Without that clause the owner's window never opens and every write
-- here silently affects no rows on a database whose owner is not a superuser,
-- which is every database this will ever run on.
alter function public.store_query_reading(text, jsonb, text)
  set "foundit.definer" = 'on';

comment on function public.store_query_reading(text, jsonb, text) is
  'Cache the reading for one sentence, keyed on its normalised text, and keep '
  'the table under 20,000 rows by evicting the least recently used. Takes the '
  'raw sentence and normalises it here, so no caller can invent a key. Raises '
  'on a query over 200 characters rather than truncating — two sentences '
  'sharing a 200-character prefix must not share a reading — and on a reading '
  'from a model other than public.reading_model(). A re-store sets created_at '
  'to now(), because a store is a fresh answer from the model and 0009 expires '
  'a refusal twenty-four hours after created_at: without it a refusal that had '
  'expired stayed expired for ever and every search of that sentence paid two '
  'reader calls again (0021).';

commit;
