-- ===========================================================================
-- Foundit — 0006_relevance_floor
--
-- "If nothing fits, say so; never pad the page with unrelated apps."
--
-- 0004 made the vector leg rank every eligible tool that has an embedded
-- statement. That fixed the zero-result queries and broke the zero-result
-- page: a sentence the catalogue cannot answer — a car that grinds when it
-- brakes, a divorce lawyer — came back with twelve nearest neighbours and a
-- heading that sounded sure of them. The owner saw it and called it
-- ridiculous. He was right, and nDCG could not see it, because nDCG only ever
-- asks questions that have answers.
--
-- This migration adds a floor. A result survives only when it has evidence:
--
--   1. MEANING.  Its best problem statement is close enough in cosine
--                similarity to the sentence — AND the sentence has at least
--                one eligible tool that is clearly close. Two thresholds, and
--                why there are two is the whole finding of the measurement:
--                see "the thresholds" below.
--   2. WORDS.    Every term of the sentence appears in its listing (the
--                all-terms leg, lex_all). Any-of overlap is not evidence: one
--                shared word is what put a PDF splitter at the top of a
--                question about holiday expenses.
--   3. NAME.     Its name is a close trigram match for what was typed — the
--                half-remembered "notin…" case the fuzzy leg exists for.
--
-- Everything without evidence is dropped HERE, inside search_tools_impl, after
-- the constraints have filtered and before the limit. One statement, one
-- round trip, nothing filtered in JavaScript. The survivors keep exactly the
-- score and the order Phase 3 gave them: the floor removes rows, it never
-- reorders them.
--
-- Four things here are load-bearing:
--
--   A. CONSTRAINTS STILL FILTER FIRST. The floor is evaluated over the
--      constraint-filtered candidate set, and the "is anything clearly close"
--      question is asked of that same set. A floor can therefore only remove
--      a row; it has no path by which to add one, and a paid tool is still
--      not in the array when the sentence said free. db/test/vectors_test.sql
--      proves it with a paid tool that is the IDENTICAL vector to the query,
--      whose name is what was typed and whose statement carries every term.
--
--   B. NO DISTANCE LEAVES THE DATABASE. query_vector_ranks gains one boolean
--      per row — "this one clears the floor" — and still returns no distance
--      and no embedding. A similarity handed to the application is one
--      rescaling away from "92% fit" on a card, which docs/build-phases.md
--      Phase 5 forbids until a calibration exists.
--
--   C. THE THRESHOLDS ARE NOT A PARAMETER. They live in
--      public.relevance_floor(), a constant function like
--      public.embedding_model(). A caller cannot pass a floor of zero, and
--      changing one is a migration with its measurements beside it.
--
--   D. NO VECTOR, NO FLOOR. When the sentence has no vector — no key, the
--      provider down, a first search before the embedding came back — the
--      floor cannot judge meaning, and applying only its lexical half would
--      empty almost every page. So the search is exactly the Phase 2 search,
--      as 0004 promised ("a missing embedding is not an error"). The page
--      already says, in that case, that the order is by text match alone.
--
-- THE THRESHOLDS, and why there are four numbers instead of one.
--
--   Measured against the 60-query golden set and the 30 sentences in
--   eval/negatives.jsonl that the catalogue cannot answer. Every value tried
--   is in eval/baselines.md under "Phase 3 amended: the relevance floor".
--
--   A single cosine floor cannot do it. The negatives' nearest tools reach
--   0.52 (a Hebrew sentence about a car, whose nearest statements are the
--   catalogue's Hebrew ones — same script, inflated similarity), while three
--   non-English golden queries never get above 0.38–0.43 against a catalogue
--   written in English. Any single value that empties the negatives cuts a
--   third of the graded answers, and any value that keeps the answers lets
--   most negatives through.
--
--   What does separate them is asking two different questions:
--
--     "Is anything in the catalogue clearly about this?"  The best eligible
--        similarity must clear a GATE. Sentences written with no Latin letters
--        at all get a lower gate, because cosine similarity between a Hebrew,
--        Russian or Arabic sentence and an English statement runs
--        systematically lower — measured, and written down, not assumed.
--
--     "Is THIS result close enough to show?"  Once the sentence has passed
--        the gate, each result must clear a lower per-result FLOOR, so the
--        second and third answers are not cut for being less close than the
--        first.
--
--   The non-Latin gate is 0.35 and not 0.37 for one measured reason: 0.35,
--   0.36 and 0.37 are indistinguishable on the golden set as written, and at
--   0.37 the golden Hebrew query q009 comes back EMPTY once lib/constraints.ts
--   has read it — the reader lifts "free" out of the sentence, which changes
--   the text, the vector and the best match. The reading is the path a visitor
--   actually takes, so the value that keeps it answered wins.
--
--   The margins are thin and they are recorded as thin. This is a floor
--   chosen on ninety sentences, not a calibrated relevance score; Phase 5 is
--   where a number that means something arrives.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. The thresholds, in one place.
--
-- IMMUTABLE in the same sense embedding_model() is: until the migration that
-- changes it. Nothing stores a value derived from it, so replacing it takes
-- effect on the next search and leaves nothing stale behind.
-- ===========================================================================
create or replace function public.relevance_floor()
returns table (
  result_min      real,
  gate_latin      real,
  gate_non_latin  real,
  name_min        real
)
language sql
immutable
set search_path = ''
as $fn$
  select 0.30::real, 0.45::real, 0.35::real, 0.50::real;
$fn$;

comment on function public.relevance_floor() is
  'The relevance floor search applies when it has a query vector. result_min: '
  'the cosine similarity a result''s best problem statement must reach to be '
  'shown. gate_latin / gate_non_latin: the similarity the BEST eligible tool '
  'must reach before any result is shown on meaning alone — the lower value '
  'for a sentence containing no Latin letters, because cross-script '
  'similarity against an English catalogue runs lower. name_min: the trigram '
  'similarity at which a tool''s name counts as what was typed. Measured, not '
  'argued: eval/baselines.md records every value tried. A constant, not a '
  'parameter, so no caller can lower it.';

-- ===========================================================================
-- 2. The vector leg, now also saying which rows clear the floor.
--
-- The return type gains a column, so the function is dropped and recreated
-- (CREATE OR REPLACE cannot change a return type). search_tools_impl is the
-- only caller and is recreated below in the same transaction; plpgsql resolves
-- the call when it runs, so there is no dependency to break.
--
-- Everything 0004 and 0005 guaranteed is kept:
--
--   * the candidate set is an argument, so nothing a constraint excluded can
--     come back — and the gate is asked of that same set, so a filtered-out
--     tool cannot even make the gate pass for somebody else;
--   * only published tools, whatever ids were passed;
--   * ranks and a boolean leave, never a distance or a vector.
--
-- Rows returned: every candidate ranked within p_limit, as before, PLUS any
-- candidate beyond it that clears the floor — so a tool's evidence is known
-- even when it sits outside the window the fusion ranks. search_tools_impl
-- only ever fuses the rank of a row inside the window, so Phase 3's scores are
-- unchanged.
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
    -- A vector the caller supplied wins; otherwise the cache is consulted.
    select coalesce(
             p_embedding,
             (select qe.embedding
                from public.query_embeddings qe
               where qe.query_norm = public.normalize_query(p_query)
                 and qe.embedding_model = public.embedding_model())
           )::halfvec(512) as vec
  ),
  nearest as (
    -- min(distance) per tool: a tool is a good answer if ANY ONE of the
    -- problems it lists is the problem asked about (0004 §5).
    select tp.tool_id, min(tp.embedding <=> w.vec) as distance
      from wanted w
      join public.tool_problems tp
        on tp.embedding is not null
       -- THE constraint guarantee, unchanged.
       and tp.tool_id = any (p_tool_ids)
      join public.tools t
        on t.id = tp.tool_id
       and t.status = 'published'
     where w.vec is not null
     group by tp.tool_id
  ),
  judged as (
    select n.tool_id,
           (row_number() over (order by n.distance asc, n.tool_id))::int as rank_ix,
           -- The gate: is anything in THIS candidate set clearly close? Asked
           -- of the filtered set, so a constraint that removed the best tool
           -- also removes it from the question.
           ( (1 - min(n.distance) over ())
               >= case when p_query ~ '[A-Za-z]' then f.gate_latin else f.gate_non_latin end
             -- ...and is this one close enough to show?
             and (1 - n.distance) >= f.result_min ) as clears_floor
      from nearest n
     cross join public.relevance_floor() f
  )
  select j.tool_id, j.rank_ix, j.clears_floor
    from judged j
   where j.rank_ix <= greatest(coalesce(p_limit, 100), 1)
      or j.clears_floor
   order by j.rank_ix;
$fn$;

comment on function public.query_vector_ranks(text, halfvec, bigint[], int) is
  'The vector leg of hybrid search: each candidate tool''s rank by cosine '
  'distance from the query vector to its nearest problem statement, and '
  'whether it clears the relevance floor (public.relevance_floor()). The '
  'candidate set is an argument, so this can never return a tool the '
  'caller''s hard constraints excluded, and only published tools are ranked, '
  'whatever the caller passed. Returns no distance and no embedding — ranks '
  'and a boolean. EXECUTE on this plus EXECUTE on store_problem_embedding is '
  'a read oracle over the query cache; no role has both, and none may be '
  'given both.';

revoke execute on function public.query_vector_ranks(text, halfvec, bigint[], int) from public;
grant execute on function public.query_vector_ranks(text, halfvec, bigint[], int) to foundit_app;

revoke execute on function public.relevance_floor() from public;
grant execute on function public.relevance_floor() to foundit_app;

-- ===========================================================================
-- 3. Search, with the floor in it.
--
-- Same signature and same result columns as 0004, so CREATE OR REPLACE is
-- enough and every caller — lib/sql.ts, eval/run.mjs, the SQL suites — keeps
-- working unchanged. ROWS 20 is restated because CREATE OR REPLACE resets it
-- to the default of 1000, and 0005 §6 explains what that estimate costs.
--
-- Everything else 0002 and 0004 say about the legs, the weights and the empty
-- query still describes this function; only the floor is new, and it is
-- marked where it happens.
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

  -- The weights, unchanged from 0004; eval/baselines.md has the sweep.
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
  -- True when the floor applies: the sentence has a vector, so meaning can be
  -- judged. See D in the header.
  v_floor     boolean;
  v_name_min  real;
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
  select f.name_min into v_name_min from public.relevance_floor() f;

  -- ----- the empty query: editorial browse, constraints still enforced ----
  -- No sentence, nothing to judge relevance against, and so no floor either:
  -- a browse is the catalogue in its own order, which is what the page says.
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

  -- Signal 3, every term. Since this migration it is also evidence: a tool
  -- whose listing carries every term of the sentence survives the floor.
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

  -- Signal 4, the half-remembered name. The similarity comes along so the
  -- floor can ask whether the name is CLOSE, not merely over the 0.3 the
  -- trigram operator retrieves at.
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

  -- Signal 5, meaning, now with the floor's verdict on each row. The array is
  -- still the eligible set, so the verdict — including the gate — is about
  -- the constraint-filtered candidates and nothing else.
  vec_problem as (
    select v.tool_id as id,
           v.rank_ix,
           v.clears_floor
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
    -- Only rows inside the window are candidates, exactly as in 0004. Rows
    -- beyond it come back from query_vector_ranks for their verdict alone.
    select id from vec_problem where rank_ix <= v_window
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
           -- THE FLOOR. Evidence is meaning, every word, or the name — never
           -- one shared word.
           ( coalesce(vp.clears_floor, false)
             or la.id is not null
             or coalesce(fn.name_sim >= v_name_min, false) )      as has_evidence
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
           when f.via_name                   then 'name'
           else 'vector'
         end::text,
         v_missing
    from fused f
    join eligible e on e.id = f.id
   -- Dropped before the limit, so a floor that removes three rows leaves room
   -- for three more that clear it, and a page that has nothing left is empty
   -- rather than padded.
   where not v_floor or f.has_evidence
   order by f.score desc, e.rating_avg desc nulls last, e.like_count desc, e.id
   limit v_limit;
end;
$$;

comment on function public.search_tools_impl(
  text, pricing_model[], platform[], tool_flag[], text[], int, halfvec) is
  'The implementation of search. Five signals fused with Reciprocal Rank '
  'Fusion (k=50), and — when the sentence has a vector — a relevance floor: a '
  'row is returned only if its best problem statement clears '
  'public.relevance_floor() on meaning, or its listing carries every term of '
  'the sentence, or its name is a close match for what was typed. '
  'Constraints filter first and never score; the floor only removes rows and '
  'never reorders them. Runs as the caller: no SECURITY DEFINER. score orders '
  'results and is not a calibrated relevance number — never render it as a '
  'percentage.';

commit;
