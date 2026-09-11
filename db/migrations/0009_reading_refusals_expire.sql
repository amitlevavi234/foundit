-- ===========================================================================
-- 0009 — a cached refusal goes stale; a cached reading does not
--
-- One function changes: public.query_reading. 0008 is not edited, because it
-- has been applied and infra.schema_migrations has recorded it.
--
-- THE PROBLEM. `asks_for_software: false` is the only field in a reading whose
-- cost is unbounded: it empties a page without searching. Everything else in a
-- reading is a filter or a restatement, and a wrong one costs a worse ranking.
--
-- And a reading is cached for as long as its row survives — up to 20,000
-- sentences of least-recently-used eviction, which on a quiet catalogue is
-- indefinitely. So one bad sample, on one afternoon, from one model version,
-- becomes a permanent answer: every later visitor who types that sentence is
-- shown "Foundit only lists software" because of a coin that came up tails once.
-- The application's two-sample vote and its refusal circuit both work on LIVE
-- readings and neither can see a row that was written last month.
--
-- THE FIX, AND WHY IT IS ASYMMETRIC. A refusal expires after 24 hours; a
-- reading that is not a refusal does not. That asymmetry is the point rather
-- than an oversight:
--
--   * An expired refusal costs one more pair of model calls and then usually
--     produces the same answer, because a sentence about a plumber is about a
--     plumber. The cost of re-asking is a fifth of a penny.
--   * An expired ordinary reading costs the same money for a reading nobody
--     doubted, on the overwhelming majority of sentences, which is the whole
--     saving the cache exists for.
--
-- So the cheap half of the cache stays cheap, and the half that can silence a
-- real question has to re-earn its answer every day.
--
-- A refusal that keeps being re-made is not re-asked for ever either: the row
-- is REWRITTEN each time the application stores a fresh reading, so
-- `created_at` moves and the clock starts again. What cannot happen is a
-- refusal older than a day being replayed to somebody.
-- ===========================================================================

-- How long a refusal is believed. A day: long enough that a sentence somebody
-- is retrying within one sitting costs nothing, short enough that a bad sample
-- cannot outlive the day it was taken.
create or replace function public.reading_refusal_ttl()
returns interval
language sql
immutable
set search_path = ''
as $fn$
  select interval '24 hours';
$fn$;

comment on function public.reading_refusal_ttl() is
  'How long a cached "this is not a request for software" is believed. Every '
  'other field of a reading is cached until it is evicted; this one expires, '
  'because it is the only one that empties a page without searching and a '
  'single bad sample must not become a permanent answer. See '
  'db/migrations/0009_reading_refusals_expire.sql.';

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
     and qr.reading_model = public.reading_model()
     -- A refusal older than the ttl is treated as a cache MISS, which makes the
     -- application ask the model again rather than replay a stale verdict. Any
     -- other reading is served however old it is.
     and (
       qr.reading -> 'asks_for_software' <> 'false'::jsonb
       or qr.created_at > now() - public.reading_refusal_ttl()
     );
$fn$;

comment on function public.query_reading(text) is
  'The reading recorded for this sentence under the current model, or null. '
  'Takes the raw sentence and normalises it here, so no caller can invent a '
  'key. A cached REFUSAL — asks_for_software false — is returned only while it '
  'is younger than public.reading_refusal_ttl(); past that it reads as a miss '
  'and the application asks the model again, because a refusal empties a page '
  'without searching and one bad sample must not do that for ever. Null costs '
  'a paid call, which is why the rate limits in lib/rate-limit.ts exist.';

revoke execute on function public.reading_refusal_ttl() from public;
grant execute on function public.reading_refusal_ttl() to foundit_app;
