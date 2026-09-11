-- ===========================================================================
-- Foundit — 0007_relative_floor
--
-- An adversarial review of 0006 did not pass it, and was right on every count.
-- This migration replaces the floor it added, embeds what a tool says about
-- itself, and closes a hole that made 0006's central claim false.
--
-- WHAT THE REVIEW FOUND, because the shape of each finding is the lesson:
--
--   1. THE GATE WAS AN ABSOLUTE NUMBER FITTED TO ONE FILE. 0.45 for a sentence
--      with Latin letters, 0.35 for one without. On 24 negatives the reviewer
--      wrote before reading ours, seven of ten near misses came back with a
--      full page. The thresholds were tuned on thirty sentences and they
--      generalised to thirty sentences.
--
--   2. IT MOVED WHEN THE SENTENCE DID NOT. Golden q052 sits at 0.4515 against
--      a gate of 0.45. Adding a full stop, a question mark or the word
--      "please" moves the vector by more than that thousandth, and the page
--      empties. A floor that depends on punctuation is not a floor.
--
--   3. THE SCRIPT PREDICATE WAS A TRAPDOOR. `p_query ~ '[A-Za-z]'` decided
--      which gate applied, so one Latin token inside a Hebrew sentence — a
--      tool's name, which is exactly what somebody types — flipped the gate
--      from 0.35 to 0.45 and emptied q009 and q057. Restating a Russian query
--      in English, which is Phase 4's entire plan, emptied it too.
--
--   4. THE PER-RESULT FLOOR CONSTRAINED ALMOST NOTHING. 0.30 admits about a
--      third of the catalogue on a typical sentence, so once the gate opened,
--      the page filled up again.
--
--   5. foundit_app COULD READ THE VECTORS. `select embedding from
--      tool_problems` returned all 504 of them. 0006's header says in capitals
--      that no distance leaves the database; the application could compute
--      every distance it liked. That claim was false when it was written, and
--      it also moots what 0005 went to such trouble to protect.
--
-- WHAT THIS MIGRATION DOES ABOUT EACH.
--
--   THE SCRIPT PREDICATE IS GONE (3), and so is the second gate it chose
--   between. One gate, one per-result floor, the same for every alphabet.
--
--   A RELATIVE GATE WAS THE INSTRUCTION, AND IT DOES NOT WORK. It was built
--   and measured before this migration was written: score every published
--   tool, take the sentence's own mean and standard deviation over that
--   background, and ask whether its best eligible match is a peak
--   (z = (best - mean) / stddev >= Z). On the four sets — the golden set, its
--   perturbations, eval/negatives.jsonl and the held-out
--   eval/negatives.review.jsonl — every Z that leaves the golden set intact
--   empties NO negatives at all:
--
--       Z <= 2.6   0 golden empty    0 held-out empty   (0%)
--       Z = 3.0    2 golden empty    2 of 25 held out   (8%)
--       Z = 3.2    5 golden empty    8 of 25 held out  (32%)
--
--   The reason is structural, and it is worth writing down because it is not
--   obvious: a sentence the catalogue cannot answer has a FLAT, LOW background,
--   so its nearest tool stands out sharply against it. A real question often
--   stands out LESS, because its several genuinely relevant tools raise its own
--   mean and spread. Peakedness is mildly ANTI-correlated with answerability
--   here. The same holds for the robust form (median/MAD): at every threshold
--   that keeps the golden set answered, nothing is refused.
--
--   SO THIS SHIPS AN ABSOLUTE GATE, AT THE ONE POINT THAT BREAKS NOTHING, and
--   the supervisor is told plainly that it does not reach the bar that was
--   asked for. The frontier, measured across the absolute family:
--
--       gate 0.34   0 golden, 0 perturbed empty    10 of 30 and 10 of 25 (40%)
--       gate 0.38   1 golden, 5 perturbed empty    14 of 30 and 14 of 25 (56%)
--       gate 0.46   2 golden, 8 perturbed empty    25 of 30 and 17 of 25 (68%)
--       gate 0.52   6 golden, 33 perturbed empty   29 of 30 and 21 of 25 (84%)
--
--   The overlap is not a tuning problem. The lowest golden peak is 0.3764
--   (q009, Hebrew; 0.3524 once a question mark is added), while eight held-out
--   negatives peak between 0.46 and 0.58 — "I need a recording studio near me
--   that rents time by the hour" is 0.58 against a catalogue full of recording
--   software. No threshold separates those, because on this evidence they are
--   not separable: the sentences really are about the same subjects.
--
--   0.34 is therefore what ships: every golden query and every one of its 240
--   perturbations still answered, and the page thinned rather than emptied for
--   a sentence with nothing to answer it. eval/baselines.md records the whole
--   frontier, and Phase 5's calibrated score is where this gets solved.
--
--   THE SUMMARY IS EMBEDDED TOO (new). A tool's own description of itself is
--   the best sentence about it that exists, and until now the vector leg could
--   not see it. Home Assistant's summary — "runs the smart devices in a house
--   locally, so lights and sensors keep working with no internet" — is a
--   direct answer to "a free tool to run the lights and heating when the
--   internet is down", and the statement-only search could not find it. The
--   leg now takes the better of the tool's summary and its nearest problem
--   statement.
--
--   THE VECTORS ARE NO LONGER READABLE (5). foundit_app keeps SELECT on every
--   column of public.tools and public.tool_problems EXCEPT the embeddings.
--   Column-level privileges are the only way PostgreSQL can say that, so the
--   table grant is replaced by a column list, generated here from the
--   catalogue so it cannot fall out of step with the schema.
--
-- WHAT IS UNCHANGED, and must stay unchanged:
--
--   * Constraints filter first. The floor is judged over the candidate set the
--     caller passed, so a tool the constraints removed cannot vouch for one
--     that survived. The background the yardstick is built from is the whole
--     published catalogue, which is a property of the SENTENCE and not of the
--     filter — a narrower search does not quietly lower its own bar.
--   * Ranks and one boolean leave query_vector_ranks. No distance, no vector.
--     As of this migration that sentence is true of the database as a whole.
--   * No vector, no floor: a search with no embedding is the Phase 2 search.
--   * No ANN index. Still a sequential scan of 727 half-precision vectors.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. What a tool says about itself, as a vector.
--
-- Same three columns and the same pairing rule as tool_problems in 0001: an
-- embedding is meaningless without the model that produced it, so neither may
-- exist without the other.
-- ===========================================================================
alter table public.tools
  add column if not exists embedding       halfvec(512),
  add column if not exists embedding_model text,
  add column if not exists embedded_at     timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tools'::regclass and conname = 'tools_embedding_pairs'
  ) then
    alter table public.tools
      add constraint tools_embedding_pairs
      check ((embedding is null) = (embedding_model is null));
  end if;
end
$$;

comment on column public.tools.embedding is
  'The tool''s own summary as a vector, from public.embedding_model(). The '
  'best sentence about a tool is usually the one its maker wrote, and until '
  '0007 the vector leg could only see the problem statements. Written by '
  'public.store_tool_embedding, readable by nobody: foundit_app holds SELECT '
  'on every other column of this table and not on this one.';

-- The job's work queue predicate, as an index, exactly as 0004 does for
-- statements: never embedded, embedded before the summary last changed, or
-- embedded by a model this database no longer uses (the third cannot be
-- indexed, for the reason 0004 gives).
create index if not exists tools_needs_embedding_work
  on public.tools (id)
  where embedding is null or embedded_at < updated_at;

-- ===========================================================================
-- 2. The embedding job's two new doors.
--
-- foundit_embed still holds no privilege on any table. It reads what to embed
-- through a function and writes through a function, and neither can be asked
-- for anything else.
-- ===========================================================================
create or replace function public.tool_embedding_work(p_limit int default null)
returns table (id bigint, summary text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select t.id, t.summary
    from public.tools t
   where t.status = 'published'
     and (t.embedding is null
          or t.embedded_at < t.updated_at
          or t.embedding_model is distinct from public.embedding_model())
   order by t.id
   limit case when p_limit is null or p_limit < 1 then null else p_limit end;
$fn$;

comment on function public.tool_embedding_work(int) is
  'The embedding job''s second work queue: the id and the summary of every '
  'published tool whose summary has never been embedded, changed since it was, '
  'or was embedded by a model this database no longer uses. Two columns, and '
  'there is no third to ask for.';

create or replace function public.store_tool_embedding(
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
    raise exception 'store_tool_embedding was given no vector for tool %', p_id
      using errcode = '22023';
  end if;

  if p_model is distinct from public.embedding_model() then
    raise exception 'embedding model % is not the model this database uses (%)',
      coalesce(p_model, '(null)'), public.embedding_model()
      using errcode = '22023',
            hint = 'Re-embed, or change public.embedding_model() in a migration.';
  end if;

  if l2_norm(p_embedding::halfvec(512)) = 0 then
    raise exception 'the embedding for tool % is a zero vector, which has no direction', p_id
      using errcode = '22023';
  end if;

  update public.tools
     set embedding       = p_embedding::halfvec(512),
         embedding_model = p_model,
         embedded_at     = now()
   where id = p_id;

  get diagnostics v_found = row_count;
  return v_found;
end;
$fn$;

comment on function public.store_tool_embedding(bigint, halfvec, text) is
  'The embedding job''s second write: the summary vector of one tool, and '
  'nothing else — not the summary, not the status, not a counter. EXECUTE '
  'belongs to foundit_embed ALONE, for the reason 0005 sets out at length: a '
  'role that can plant a vector must not also be able to ask which vector is '
  'nearest a cached query.';

-- --- what to record in the offline fixture ---------------------------------
-- The fixture is written from the corpus, not from the work queue. The queue
-- lists what is OUTSTANDING, so on a database whose embeddings are already
-- filled it is empty and a fixture written from it would be empty too — which
-- is exactly the guard scripts/embed.mjs used to get wrong.
create or replace function public.embedding_corpus()
returns table (kind text, id bigint, body text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select 'tool'::text, t.id, t.summary
    from public.tools t
   where t.status = 'published'
  union all
  select 'problem'::text, tp.id, tp.statement
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   order by 1, 2;
$fn$;

comment on function public.embedding_corpus() is
  'Every text this database embeds: each published tool''s summary and each of '
  'its problem statements, whether or not they are embedded yet. For writing '
  'db/seed/embeddings.fixture.json, which must be reproducible from a filled '
  'database as well as a fresh one.';

revoke execute on function public.tool_embedding_work(int) from public;
revoke execute on function public.store_tool_embedding(bigint, halfvec, text) from public;
revoke execute on function public.embedding_corpus() from public;
grant execute on function public.tool_embedding_work(int) to foundit_embed;
grant execute on function public.store_tool_embedding(bigint, halfvec, text) to foundit_embed;
grant execute on function public.embedding_corpus() to foundit_embed;

-- ===========================================================================
-- 3. THE HOLE 0006 LEFT OPEN: the application could read every vector.
--
-- 0005 split the write half of the embedding oracle away from the read half,
-- and 0006 went on to promise in capitals that no distance leaves the
-- database. Both were undone by one grant nobody looked at: foundit_app held
-- SELECT on all of public.tool_problems, embedding column included, so it
-- could pull all 504 vectors out and compute anything it wanted with them —
-- including the distances the definer functions exist to keep inside.
--
-- PostgreSQL cannot revoke one column from a table-wide grant: the fix is to
-- take the table grant away and give back a column list. It is generated from
-- the catalogue rather than typed out, so it cannot drift from the schema —
-- but a column added by a LATER migration will not be in it, and that
-- migration has to grant its own column. That is the price of column
-- privileges and it is cheap: a missing grant fails loudly on the next query,
-- where a missing revoke fails silently for a year.
-- ===========================================================================
do $$
declare
  v_table text;
  v_cols  text;
begin
  foreach v_table in array array['public.tools', 'public.tool_problems'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = v_table::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname <> 'embedding';

    execute format('revoke select on %s from foundit_app', v_table);
    execute format('grant select (%s) on %s to foundit_app', v_cols, v_table);
  end loop;
end
$$;

comment on column public.tool_problems.embedding is
  'The problem statement as a vector. foundit_app cannot read this column — it '
  'holds SELECT on every other column of this table and not on this one (0007) '
  '— because a role that can read the vectors can compute the distances, and '
  'the whole point of public.query_vector_ranks is that the arithmetic happens '
  'inside the database and ranks come out.';

-- ===========================================================================
-- 4. The floor's numbers, and what they now mean.
--
-- The return type changes, so the function is dropped and recreated. Its
-- callers are string-bodied SQL and plpgsql, which take no dependency on it,
-- and both are recreated below in the same transaction.
--
--   gate_min  the similarity a sentence's BEST eligible match must reach
--             before the page shows anything on meaning at all.
--   result_min the similarity each individual result must reach to be shown.
--   name_min  trigram similarity at which a name counts as what was typed.
--             0.40 rather than 0.50 because the leg's own reason for existing
--             fails at 0.50: "notin" against Notion is 0.44 and "signel"
--             against Signal is exactly 0.40.
--   min_all_terms_stems
--             how many stems a sentence must have before an all-terms match
--             counts as evidence. One stem is not evidence: "file" or "app"
--             matches half the catalogue and would open every page.
--
-- Every value is measured, and the sweep is in eval/baselines.md.
-- ===========================================================================
drop function if exists public.relevance_floor();

create function public.relevance_floor()
returns table (
  gate_min            real,
  result_min          real,
  name_min            real,
  min_all_terms_stems int
)
language sql
immutable
set search_path = ''
as $fn$
  select 0.34::real, 0.34::real, 0.40::real, 2;
$fn$;

comment on function public.relevance_floor() is
  'The relevance floor. gate_min: the similarity the best ELIGIBLE match must '
  'reach before the page shows anything on meaning. result_min: the similarity '
  'each shown result must reach. name_min: when a name counts as what was '
  'typed. min_all_terms_stems: how many stems a sentence needs before an '
  'all-terms match is evidence. 0.34 is the highest gate at which no golden '
  'query and none of its 240 mechanical perturbations comes back empty; it '
  'refuses about 40% of the sentences the catalogue cannot answer, which is '
  'below the 85% that was asked for, and eval/baselines.md records the whole '
  'frontier and why the two cannot be had together on this evidence. A '
  'constant, not a parameter: no caller can lower it.';

-- ===========================================================================
-- 5. The vector leg: the better of a tool's summary and its statements.
--
-- Scored over the candidate set the caller passed, so a tool the constraints
-- removed can neither come back nor make the page answerable for one that
-- survived. What is returned is still ranks and a boolean.
-- ===========================================================================
drop function if exists public.query_vector_ranks(text, halfvec, bigint[], int);

create function public.query_vector_ranks(
  p_query     text,
  p_embedding halfvec,
  p_tool_ids  bigint[],
  p_limit     int default 100
)
returns table (tool_id bigint, rank_ix int, clears_floor boolean)
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
  ),
  -- Each candidate tool, scored on the better of what it says it is and the
  -- nearest problem it says it solves.
  candidates as (
    select t.id as tool_id,
           max(1 - (e.embedding <=> w.vec))::float8 as sim
      from wanted w
      join public.tools t
        on t.status = 'published'
       -- THE constraint guarantee, unchanged: nothing outside the caller's
       -- candidate set can come back, and nothing outside it is the peak.
       and t.id = any (p_tool_ids)
      cross join lateral (
        select t.embedding as embedding
        union all
        select tp.embedding
          from public.tool_problems tp
         where tp.tool_id = t.id
      ) e
     where w.vec is not null
       and e.embedding is not null
     group by t.id
  ),
  ranked as (
    select c.tool_id,
           c.sim,
           (row_number() over (order by c.sim desc, c.tool_id))::int as rank_ix
      from candidates c
  ),
  judged as (
    select r.tool_id,
           r.rank_ix,
           ( -- Is anything here clearly about this sentence at all?
             max(r.sim) over () >= f.gate_min
             -- And is this one of the rows close enough to show?
             and r.sim >= f.result_min ) as clears_floor
      from ranked r
     cross join public.relevance_floor() f
  )
  select j.tool_id, j.rank_ix, j.clears_floor
    from judged j
   where j.rank_ix <= greatest(coalesce(p_limit, 100), 1)
      or j.clears_floor
   order by j.rank_ix;
$fn$;

comment on function public.query_vector_ranks(text, halfvec, bigint[], int) is
  'The vector leg of hybrid search: each candidate tool''s rank by similarity '
  'to the sentence — the better of its summary and its nearest problem '
  'statement — and whether it clears the relevance floor. The candidate set is '
  'an argument, so this can never return, or be made answerable by, a tool the '
  'caller''s constraints excluded. Returns no distance, no similarity and no '
  'embedding — ranks and a boolean — and since 0007 the application cannot '
  'read the vectors themselves either, which is what makes that sentence true '
  'of the database rather than of this function alone.';

revoke execute on function public.query_vector_ranks(text, halfvec, bigint[], int) from public;
grant execute on function public.query_vector_ranks(text, halfvec, bigint[], int) to foundit_app;
revoke execute on function public.relevance_floor() from public;
grant execute on function public.relevance_floor() to foundit_app;

-- ===========================================================================
-- 6. Search, with the relative floor and two tightened lexical hatches.
--
-- The hatches exist so that a sentence the vectors misjudge can still be
-- answered by words. The review showed both were too wide:
--
--   ALL TERMS now needs at least two stems. `to_tsvector('english', ...)`
--   has already dropped the stopwords, so a one-stem sentence is a single
--   content word — "file", "app", "notes" — and an all-terms match on one of
--   those is not evidence of anything, it is half the catalogue.
--
--   THE NAME needs 0.40 rather than 0.50, which is the threshold at which the
--   leg's own example works: "notin" -> Notion is 0.44, "signel" -> Signal is
--   0.40 exactly. At 0.50 the case the leg was built for failed.
-- ===========================================================================
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
rows 20
set search_path = pg_catalog, public
set pg_trgm.similarity_threshold = '0.3'
as $$
#variable_conflict use_column
declare
  v_k        constant real := 50;
  v_window   constant int  := 100;

  v_w_tool    constant real := 1.0;
  v_w_problem constant real := 1.0;
  v_w_all     constant real := 0.5;
  v_w_name    constant real := 0.25;
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
  v_floor     boolean;
  v_name_min  real;
  v_min_stems int;
  v_stems     int;
begin
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q := btrim(coalesce(p_query, ''));

  v_pricing   := nullif(p_pricing,   '{}'::pricing_model[]);
  v_platforms := nullif(p_platforms, '{}'::platform[]);
  v_flags     := nullif(p_flags,     '{}'::tool_flag[]);

  if p_languages is null or cardinality(p_languages) = 0 then
    v_langs := null;
  else
    select coalesce(array_agg(lower(btrim(x))), '{}'::text[])
      into v_langs
      from unnest(p_languages) as x
     where btrim(x) <> '';
  end if;

  v_missing := public.query_embedding_missing(v_q, p_embedding);
  v_floor   := not v_missing;
  select f.name_min, f.min_all_terms_stems
    into v_name_min, v_min_stems
    from public.relevance_floor() f;
  -- The floor's two similarity thresholds are read inside
  -- public.query_vector_ranks, which is the only thing that may see a
  -- similarity at all.

  if v_q = '' then
    return query
      select t.id, t.slug, t.name, t.summary, t.pricing,
             0::real, 'browse'::text, false
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

  v_tsq_all := websearch_to_tsquery('english', v_q);

  select string_agg(quote_literal(lexeme), ' | ')::tsquery
    into v_tsq_any
    from unnest(to_tsvector('english', v_q));

  v_tsq_any := coalesce(v_tsq_any, v_tsq_all);

  -- How many stems the sentence has, stopwords already removed. One is not
  -- evidence; see the header.
  v_stems := length(to_tsvector('english', v_q));

  return query
  with
  eligible as not materialized (
    select t.id, t.slug, t.name, t.summary, t.pricing,
           t.search_doc, t.rating_avg, t.like_count
      from public.tools t
     where t.status = 'published'
       and (v_pricing   is null or t.pricing = any (v_pricing))
       and (v_platforms is null or t.platforms && v_platforms)
       and (v_flags     is null or t.flags     @> v_flags)
       and (v_langs     is null or t.languages && v_langs)
  ),

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

  fuzzy_name as (
    select e.id,
           similarity(e.name, v_q) as name_sim,
           row_number() over (
             order by similarity(e.name, v_q) desc, e.id
           ) as rank_ix
      from eligible e
     where e.name % v_q
     order by rank_ix
     limit v_window
  ),

  vec_problem as (
    select v.tool_id as id, v.rank_ix, v.clears_floor
      from public.query_vector_ranks(
             v_q, p_embedding, array(select e.id from eligible e), v_window
           ) v
  ),

  candidates as (
    select id from lex_tool
    union select id from lex_problem
    union select id from lex_all
    union select id from fuzzy_name
    union select id from vec_problem where rank_ix <= v_window
  ),

  fused as (
    select c.id,
           ( coalesce(v_w_tool    / (v_k + lt.rank_ix), 0)
           + coalesce(v_w_problem / (v_k + lp.rank_ix), 0)
           + coalesce(v_w_all     / (v_k + la.rank_ix), 0)
           + coalesce(v_w_name    / (v_k + fn.rank_ix), 0)
           + coalesce(v_w_vector  / (v_k + case when vp.rank_ix <= v_window
                                                then vp.rank_ix end), 0) )::real as score,
           (lt.id is not null or coalesce(la.via_tool,    false)) as via_tool,
           (lp.id is not null or coalesce(la.via_problem, false)) as via_problem,
           (fn.id is not null)                                    as via_name,
           -- THE FLOOR: a peak in meaning, or every term of a sentence that
           -- has at least two, or a name that really is what was typed.
           ( coalesce(vp.clears_floor, false)
             or (la.id is not null and v_stems >= v_min_stems)
             or coalesce(fn.name_sim >= v_name_min, false) )      as has_evidence
      from candidates c
      left join lex_tool    lt on lt.id = c.id
      left join lex_problem lp on lp.id = c.id
      left join lex_all     la on la.id = c.id
      left join fuzzy_name  fn on fn.id = c.id
      left join vec_problem vp on vp.id = c.id
  )
  select e.id, e.slug, e.name, e.summary, e.pricing, f.score,
         case
           when f.via_tool and f.via_problem then 'both'
           when f.via_tool                   then 'tool'
           when f.via_problem                then 'problem'
           when f.via_name                   then 'name'
           else 'vector'
         end::text,
         v_missing
    from fused f
    join eligible e on e.id = f.id
   where not v_floor or f.has_evidence
   order by f.score desc, e.rating_avg desc nulls last, e.like_count desc, e.id
   limit v_limit;
end;
$$;

comment on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) is
  'The implementation of search. Five signals fused with Reciprocal Rank '
  'Fusion (k=50) — the tool''s document, its problem statements, an all-terms '
  'bonus, a trigram rescue for a half-remembered name, and similarity to the '
  'better of its summary and its nearest problem statement — and, when the '
  'sentence has a vector, a relative relevance floor: a row is returned only '
  'if it is part of a peak in meaning, or its listing carries every term of a '
  'sentence with at least two stems, or its name is what was typed. '
  'Constraints filter first and never score; the floor only removes rows and '
  'never reorders them. Runs as the caller: no SECURITY DEFINER. score orders '
  'results and is not a calibrated relevance number — never render it as a '
  'percentage.';

commit;
