-- ===========================================================================
-- Foundit — 0002_search
--
-- Search with no AI in it: PostgreSQL full-text search, trigram fuzzy name
-- matching, and hard-constraint filtering. This is the baseline that every
-- later clever thing has to beat, so it is deliberately boring and entirely
-- explainable.
--
-- Four things about this file are load-bearing:
--
--   1. public.search_tools() is NOT security definer. It runs as the caller,
--      so row-level security still applies to every table it touches. The
--      published-only rule is ALSO written as an explicit predicate, because
--      RLS lets an owner see their own drafts and a draft must never appear
--      in search results — not even to its owner.
--
--   2. Hard constraints are WHERE clauses. They decide who is eligible and
--      contribute exactly nothing to the score. If someone says free, a paid
--      tool does not appear, however similar it looks.
--
--   3. Full-text retrieval is any-of, not all-of. Terms are OR'd and
--      ts_rank_cd does the discriminating. Requiring every term is a filter
--      wearing a ranker's clothes, and against short summaries it returns
--      nothing at all — see "two readings of the same sentence" below, which
--      is the mistake this file was born with. Containing every term is still
--      worth something, so it is a weighted leg of the fusion, not a gate.
--
--   4. Signals are combined with Reciprocal Rank Fusion (ranks, not scores).
--      ts_rank_cd values and trigram similarities live on different scales
--      and adding them raw would mean tuning a weight against data we do not
--      have. RRF needs only the ordering each signal produces.
--
-- Nothing here reads tool_problems.embedding, and no vector index is created.
-- That omission is deliberate and is explained at the bottom of this file.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. search_tools — the whole of search, in one round trip.
--
-- Filtering, ranking, deduplication and limiting all happen here. Nothing is
-- re-ranked or re-filtered in JavaScript afterwards; if it were, the eval
-- harness would be measuring something other than what ships.
--
-- Signature is fixed — the eval harness is written against it.
--
--   p_query      the raw sentence the person typed. May be null, empty or
--                whitespace; see "the empty query" below.
--   p_pricing    allowed pricing models. null (or {}) means no constraint.
--   p_platforms  acceptable platforms. Any-of: someone who says "on my
--                phone" means ios OR android.
--   p_flags      required flags. All-of: someone who says "offline and no
--                ads" means both, so a tool with only one of them is out.
--   p_languages  interface languages the person can use. Any-of, compared
--                case-insensitively against tools.languages. null or {} means
--                no constraint; an array whose entries are all null or blank
--                is a constraint nothing can satisfy and returns no rows,
--                same as array[null] does for every other constraint.
--   p_limit      clamped to 1..50 inside the function. A caller cannot ask
--                for the whole table.
--
-- match_source, one of:
--   'tool'     matched the tool's own document (name weight A + summary B)
--   'problem'  matched one or more of its problem statements
--   'both'     matched both of the above — the strongest kind of hit
--   'name'     matched ONLY by fuzzy name similarity: the half-remembered
--              case ("notin" → Notion). No lexical match anywhere.
--   'browse'   no query was given; this row is an editorial default, not a
--              relevance judgement, and its score is 0.
--
-- score is an RRF sum. It is an ORDERING number and nothing else. It is not
-- a probability, not a similarity, and must never be rescaled and shown to a
-- person as a percentage — see 02-matching-algorithm.md §5. The UI shows
-- bands until there are labels to calibrate against.
--
-- The empty query: returns the catalogue in editorial order (rating, then
-- likes) with the hard constraints still applied, rather than an empty set.
-- "free tools that work offline", with no sentence typed, is a real and
-- useful request, and the tools_browse index exists for exactly this shape.
-- The alternative — an empty set — would force the app to grow a second
-- code path for browse, which is precisely the sort of drift that makes the
-- eval harness stop measuring the thing that ships.
-- ===========================================================================
create or replace function public.search_tools(
  p_query      text,
  p_pricing    pricing_model[] default null,
  p_platforms  platform[]      default null,
  p_flags      tool_flag[]     default null,
  p_languages  text[]          default null,
  p_limit      int             default 20
)
returns table (
  tool_id      bigint,
  slug         citext,
  name         text,
  summary      text,
  pricing      pricing_model,
  score        real,
  match_source text
)
language plpgsql
stable
-- Pinned so a caller cannot shadow what this function resolves. public is on
-- the path because pg_trgm's operators and the enum types live there;
-- pg_temp is deliberately absent.
set search_path = pg_catalog, public
-- The fuzzy threshold belongs to this migration, not to whatever session
-- state the caller happens to have. 0.3 is pg_trgm's own default.
set pg_trgm.similarity_threshold = '0.3'
as $$
-- Every column reference below is alias-qualified; this is belt and braces
-- so that an OUT parameter named `name` or `pricing` can never be mistaken
-- for the variable when a future edit forgets the alias.
#variable_conflict use_column
declare
  -- Reciprocal Rank Fusion constant. 50 is Supabase's documented default for
  -- the plain-Postgres implementation; Elastic uses 60. Anywhere in that
  -- range behaves the same at this corpus size.
  v_k        constant real := 50;

  -- How many candidates each signal contributes before fusion. Retrieval is
  -- OR (see "two readings of the same sentence" below), so the match sets are
  -- far larger than they were when every term had to be present: ts_rank_cd
  -- now runs over most documents that share any lexeme with the query. On a
  -- corpus of a few thousand published rows that is cheap, and this window
  -- decides only how many survive into the fusion — 100 is twice the largest
  -- limit a caller can ask for, so the other legs still have room to reorder
  -- the list without the answer being decided by where the cut fell.
  v_window   constant int  := 100;

  -- Signal weights.
  --
  -- The two full-text signals are peers: a tool's own summary and the
  -- problem statements attached to it are both first-class descriptions of
  -- what it does, and the product's whole thesis is that the problem
  -- statements are how people actually phrase a search. Neither should
  -- outrank the other by construction.
  --
  -- The all-terms leg is deliberately half a peer. A document containing
  -- every term the person typed is real evidence and belongs near the top,
  -- but it is evidence the two OR legs have already seen: the AND leg re-reads
  -- the same documents through a stricter lens, it never brings new ones (all
  -- of the terms implies any of them). At 0.5 the arithmetic says exactly what
  -- "bonus, not gate" means. The most an all-terms match can add is
  -- 0.5/(50+1) = 0.0098, less than the 1/(50+1) = 0.0196 a first-place OR leg
  -- contributes, so it can never install a tool at the top by itself. But it
  -- is enough to promote: a tool sitting 40th in the OR leg (1/(50+40) =
  -- 0.0111) that also contains every term ends on 0.0209 and passes a tool
  -- ranked first that contains only some of them. That promotion is the whole
  -- reason the leg exists.
  --
  -- Fuzzy name matching is a rescue, not a relevance signal, and it is
  -- weighted so it can never overtake a real text match. The arithmetic:
  -- the best possible trigram-only candidate scores 0.25/(50+1) = 0.0049,
  -- while the WORST possible full-text candidate — rank 100, the very last
  -- one in the window — still scores 1/(50+100) = 0.0067. So a tool that
  -- merely looks like the query never displaces a tool that actually
  -- contains it. When nothing matches lexically at all, the trigram leg is
  -- the only leg, and "notin" finds Notion.
  v_w_tool    constant real := 1.0;
  v_w_problem constant real := 1.0;
  v_w_all     constant real := 0.5;
  v_w_name    constant real := 0.25;

  v_limit     int;
  v_q         text;
  -- Two tsqueries over the same sentence: any-of for retrieval, all-of as a
  -- bonus. Built and justified below.
  v_tsq_any   tsquery;
  v_tsq_all   tsquery;
  v_pricing   pricing_model[];
  v_platforms platform[];
  v_flags     tool_flag[];
  v_langs     text[];
begin
  -- A caller must not be able to ask for the whole table, and must not be
  -- able to ask for zero rows either.
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  v_q := btrim(coalesce(p_query, ''));

  -- An empty array is treated as "no constraint", not as "nothing is
  -- acceptable". Without this, a caller that builds its filter arrays by
  -- appending would silently get zero results for an unconstrained search.
  v_pricing   := nullif(p_pricing,   '{}'::pricing_model[]);
  v_platforms := nullif(p_platforms, '{}'::platform[]);
  v_flags     := nullif(p_flags,     '{}'::tool_flag[]);

  -- Language codes are lower-cased so a caller sending 'EN' still matches a
  -- catalogue storing 'en', and blank or null entries are dropped.
  --
  -- The distinction this branch exists to make: "nothing was asked for" is not
  -- the same thing as "what was asked for normalised to nothing", and only the
  -- first of the two means "no constraint".
  --
  --   p_languages => null            nothing asked   -> v_langs null  -> no filter
  --   p_languages => '{}'            nothing asked   -> v_langs null  -> no filter
  --   p_languages => array[null]     something asked, nothing survived
  --   p_languages => array['']       ditto
  --   p_languages => array['EN','']  something asked, 'en' survived
  --
  -- The middle two must return NO ROWS, exactly as p_pricing => array[null]
  -- and p_flags => array[null] already do: an array containing one unusable
  -- element is not an empty array, and `= any`/`@>`/`&&` all reject it rather
  -- than ignoring it. Aggregating straight into v_langs failed open instead,
  -- because array_agg over zero surviving rows returns NULL and NULL is this
  -- function's word for "unconstrained" — so a caller whose constraint
  -- extractor produced a blank language silently got the whole catalogue back.
  -- Every other constraint fails closed; this one now does too. An empty
  -- array here is a constraint nothing can satisfy: `t.languages && '{}'` is
  -- false for every row, including rows whose own languages column is empty.
  if p_languages is null or cardinality(p_languages) = 0 then
    v_langs := null;
  else
    select coalesce(array_agg(lower(btrim(x))), '{}'::text[])
      into v_langs
      from unnest(p_languages) as x
     where btrim(x) <> '';
  end if;

  -- ----- the empty query: editorial browse, constraints still enforced ----
  if v_q = '' then
    return query
      select t.id,
             t.slug,
             t.name,
             t.summary,
             t.pricing,
             0::real,
             'browse'::text
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
  --
  -- websearch_to_tsquery is the only parser safe to hand raw user input: the
  -- docs promise it "never raises syntax errors". What it is not, is a
  -- retrieval query. It joins bare terms with AND, so "split expenses with
  -- friends while travelling" becomes
  --
  --     'split' & 'expens' & 'friend' & 'travel'
  --
  -- and a tool matches only if its document contains every one of those
  -- lexemes. Summaries here are a few hundred characters, so that is almost
  -- never true: measured against the real catalogue, that sentence returned
  -- nothing at all, while Splitwise sat in the table with 'expens' in its
  -- document and 'split' nowhere in it. An AND of everything a person typed
  -- is a gate, and retrieval must not be a gate — a sentence is a description
  -- of a problem, not a conjunction of requirements. Requirements are the
  -- WHERE clauses, and they are the only thing allowed to eliminate a tool.
  --
  -- So the sentence is read twice.
  --
  -- v_tsq_any is retrieval: the same lexemes joined with OR. A document is a
  -- candidate if it shares ANY term, and ts_rank_cd decides the order, which
  -- is the job it was always meant to do here — cover more of the query, with
  -- the matched terms closer together, and rank higher.
  --
  -- It is built from lexemes rather than by rewriting the printed form of the
  -- tsquery. Replacing '&' with '|' in the rendered text looks equivalent and
  -- is not: a lexeme can contain an ampersand of its own (a URL query string
  -- tokenizes that way), and the replacement would split it down the middle
  -- into two lexemes that were never in the query. Going through unnest()
  -- takes the lexemes as data, drops stop words for free, and cannot be
  -- injected — the strings come out of to_tsvector, and quote_literal escapes
  -- each one before it is parsed back as a tsquery.
  --
  -- v_tsq_all keeps the AND reading, demoted from gate to evidence: a
  -- document that really does contain every term is a strong signal, so it
  -- gets a ranked leg of its own in the fusion below instead of a veto.
  v_tsq_all := websearch_to_tsquery('english', v_q);

  select string_agg(quote_literal(lexeme), ' | ')::tsquery
    into v_tsq_any
    from unnest(to_tsvector('english', v_q));

  -- A sentence of nothing but stop words ("the of a") has no lexemes, so
  -- string_agg aggregates zero rows and returns null. websearch_to_tsquery
  -- has already produced the empty tsquery for the same input, so reuse it
  -- rather than manufacture one: both readings of that sentence really are
  -- the same empty query, and an empty tsquery matches nothing. "the of a"
  -- therefore returns whatever the trigram leg finds — usually nothing — and
  -- never the browse front page. Someone who typed something deserves an
  -- honest empty answer, not the catalogue's editorial defaults handed back
  -- as if they were results.
  v_tsq_any := coalesce(v_tsq_any, v_tsq_all);

  return query
  with
  -- NOT MATERIALIZED matters: it lets each signal below inline the
  -- eligibility test into its own scan, so the GIN indexes on search_doc,
  -- platforms, flags, languages and the trigram index on name all stay
  -- reachable. Materialized, every signal would scan a CTE result instead
  -- and no index could be used.
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
     -- Explicit, not merely implied by RLS. The tools_read policy lets an
     -- owner or an admin see unpublished listings; search must not.
     where t.status = 'published'
       -- Hard constraints. Each one is an eligibility test and touches the
       -- score nowhere. Any-of for pricing, platforms and languages
       -- (alternatives a person would accept); all-of for flags
       -- (requirements a person stated).
       and (v_pricing   is null or t.pricing = any (v_pricing))
       and (v_platforms is null or t.platforms && v_platforms)
       and (v_flags     is null or t.flags     @> v_flags)
       and (v_langs     is null or t.languages && v_langs)
  ),

  -- Signal 1: the tool's own document — name at weight A, summary at
  -- weight B, as generated in 0001. Normalization 1 divides by
  -- 1 + log(length) so a wordy 400-character summary does not beat a precise
  -- 40-character one simply by containing more words.
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

  -- Signal 2: the problem statements. This is the one that matters, because
  -- a person describes their problem, not the product.
  --
  -- A tool with six matching statements must appear ONCE. max() is the
  -- principled aggregate here: a tool is a good answer if any one of the
  -- problems it solves is the problem asked about. Averaging would punish a
  -- thorough listing for also solving five other things, and summing would
  -- reward whoever typed the most statements — an incentive this catalogue
  -- must not create.
  --
  -- Note the explicit column list. tool_problems carries a halfvec(512);
  -- `select *` here would drag the entire embedding column across the wire
  -- for no reason. It is never selected and never read.
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

  -- Signal 3: every term, in one place. The AND reading of the sentence, now
  -- that it is not the thing deciding who is eligible.
  --
  -- This leg cannot widen the result set — a document containing all of the
  -- terms contains at least one of them, so signals 1 and 2 have already seen
  -- it — but it can, and should, pull such a document upward. It reads both
  -- kinds of document for the same reason signals 1 and 2 exist separately,
  -- and max() deduplicates across a tool's problem statements on exactly the
  -- reasoning given there: one statement hitting every term is enough.
  --
  -- bool_or carries which document matched, so match_source below stays
  -- honest. A tool CAN arrive here and nowhere else — the OR legs are cut off
  -- at v_window and this one is not sorted the same way — and such a tool
  -- matched text, so it must not be reported as a fuzzy-name rescue.
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

  -- Signal 4: the half-remembered name. Whole-string trigram similarity
  -- against the tool name, at pg_trgm's 0.3 threshold.
  --
  -- This self-limits in a useful way: a long sentence ("something that
  -- splits a restaurant bill between friends") has too many trigrams to
  -- reach 0.3 against a one-word name, so the leg is simply empty and full
  -- text does all the work. It fires when the query is short — which is
  -- exactly when someone is typing a name they half remember.
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

  -- The union is the deduplication: one row per tool, whatever found it.
  candidates as (
    select id from lex_tool
    union
    select id from lex_problem
    union
    select id from lex_all
    union
    select id from fuzzy_name
  ),

  -- Reciprocal Rank Fusion. A tool absent from a signal contributes 0 from
  -- that signal rather than being eliminated — a hit in one place is still a
  -- hit, which is the entire point of fusing rather than intersecting.
  fused as (
    select c.id,
           ( coalesce(v_w_tool    / (v_k + lt.rank_ix), 0)
           + coalesce(v_w_problem / (v_k + lp.rank_ix), 0)
           + coalesce(v_w_all     / (v_k + la.rank_ix), 0)
           + coalesce(v_w_name    / (v_k + fn.rank_ix), 0) )::real as score,
           -- The all-terms leg reports which document it matched, so a tool
           -- that only that leg retrieved is still labelled by where its text
           -- matched rather than falling through to 'name'.
           (lt.id is not null or coalesce(la.via_tool,    false)) as via_tool,
           (lp.id is not null or coalesce(la.via_problem, false)) as via_problem
      from candidates c
      left join lex_tool    lt on lt.id = c.id
      left join lex_problem lp on lp.id = c.id
      left join lex_all     la on la.id = c.id
      left join fuzzy_name  fn on fn.id = c.id
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
           -- Nothing lexical matched, so the trigram leg is the only reason
           -- this row is here.
           else 'name'
         end::text
    from fused f
    join eligible e on e.id = f.id
   -- Ties are broken by the catalogue's own quality signals and finally by
   -- id, so the ordering is total and the eval harness gets the same answer
   -- twice in a row.
   order by f.score desc, e.rating_avg desc nulls last, e.like_count desc, e.id
   limit v_limit;
end;
$$;

comment on function public.search_tools(text, pricing_model[], platform[], tool_flag[], text[], int) is
  'Lexical search over tools and their problem statements, fused with '
  'Reciprocal Rank Fusion (k=50). Retrieval is any-of: query terms are OR-ed '
  'and ts_rank_cd orders the result; containing every term is a separate, '
  'half-weighted bonus leg, and a lower-weighted trigram leg rescues '
  'half-remembered names. Constraints filter and never score. Runs as '
  'the caller: no SECURITY DEFINER, so row-level security still applies. '
  'score orders results and is not a calibrated relevance number — never '
  'render it as a percentage.';

-- ===========================================================================
-- 2. log_search_event — one row per search, joinable to nobody.
--
-- search_events has no user column and never will. "Describe your problem"
-- collects health, money and relationship troubles; a transcript attached to
-- a name is a liability with no product value, and a column that does not
-- exist cannot be subpoenaed, leaked or quietly joined in a later feature.
--
-- Three consequences of that rule, all deliberate:
--
--   * This function takes no user id and there is no parameter to add one to.
--   * It returns void rather than the new row's id. An id handed back to the
--     application is a correlation handle: it lets a caller stash "this
--     person's search was event 91,204" somewhere else and rebuild exactly
--     the join this table exists to prevent.
--   * query_hash is computed here, from a normalization defined here, so
--     every caller groups the same way. This function is NOT what makes that
--     guarantee hold: foundit_app can insert into search_events directly, so
--     for a while a caller could pass any string it liked in query_hash -- an
--     account id, a session id -- and nothing stopped it. 0003_hardening.sql
--     closed that with a BEFORE INSERT trigger that derives the hash from the
--     query text whatever the caller passes. The guarantee lives there, in the
--     table, because this function was never the only way in.
--
-- It is not security definer either. The search_events_insert policy from
-- 0001 already permits the insert (see the comment on that policy below), so
-- no new policy is needed and none is added.
--
-- Logging is a second round trip, and that is unavoidable: search_tools is
-- STABLE and cannot write, and latency_ms is measured by the caller, which
-- by definition only knows it once the search has returned. Call this
-- fire-and-forget after responding; never make the user wait for it.
-- ===========================================================================
create or replace function public.log_search_event(
  p_query          text,
  p_result_count   int,
  p_top_score      real    default null,
  p_had_good_match boolean default false,
  p_latency_ms     int     default null
)
returns void
language sql
set search_path = pg_catalog, public
as $$
  insert into public.search_events
    (query_text, query_hash, result_count, top_score, had_good_match, latency_ms)
  select
    -- Capped at the same 200 characters the app's own input cap enforces, so
    -- a scraper cannot use this table as free text storage.
    left(btrim(coalesce(p_query, '')), 200),
    -- Normalized before hashing — lower-cased, whitespace collapsed — so
    -- "Split a  BILL" and "split a bill" land in the same bucket on the
    -- aggregate panel. sha256 is built into Postgres; no extension needed.
    encode(
      sha256(
        convert_to(
          lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')),
          'UTF8'
        )
      ),
      'hex'
    ),
    -- result_count is a smallint; clamp rather than overflow.
    least(greatest(coalesce(p_result_count, 0), 0), 32767)::smallint,
    p_top_score,
    -- Defaults to false: a caller that forgets this argument under-reports
    -- success, which is the safe direction for a quality metric to fail in.
    coalesce(p_had_good_match, false),
    -- Null stays null. A search whose latency was never measured is unknown,
    -- not instantaneous, and greatest(null, 0) would quietly record 0 ms.
    case when p_latency_ms is null then null else greatest(p_latency_ms, 0) end;
$$;

comment on function public.log_search_event(text, int, real, boolean, int) is
  'Records one search for the aggregate quality panel. Takes no user id and '
  'returns no row id, on purpose: search text must never become joinable to '
  'a person.';

comment on table public.search_events is
  'What people asked for, never who asked. This table has no user column and '
  'must never gain one — not a profile id, not a session id, not an IP, not '
  'a device fingerprint. "Describe your problem" collects health, money and '
  'relationship disclosures; a searchable transcript tied to a person is a '
  'permanent liability and buys the product nothing that aggregate counts do '
  'not already give it. query_hash exists so repeated queries can be counted '
  'without joining anything, and query_text is capped and kept only for the '
  '"what people search for" panel. If a feature ever seems to need "this '
  'user''s search history", it is asking for a different table with its own '
  'consent story, not a column here.';

-- The one policy in this schema whose check is unconditional, and the reason
-- it is correct rather than an oversight: there is no user column to compare
-- a row against, and there is nothing to protect on the way in. Anyone,
-- signed in or not, may record that a search happened. Reading is what
-- matters, and that is admin-only via search_events_read.
comment on policy search_events_insert on public.search_events is
  'Unconditional by design: the table has no user column, so there is no '
  'ownership to assert on insert, and anonymous searches must be counted '
  'too. Confidentiality is enforced on SELECT (admin only), not here.';

-- ===========================================================================
-- 3. Indexes.
--
-- 0001 already built most of what search needs; the comments below record
-- which query shape each one now serves, so nobody drops one as unused after
-- reading a stats view. Only one index is genuinely new.
-- ===========================================================================

-- New. p_languages was the one hard constraint with no index behind it,
-- while platforms and flags each had one. Same shape, same reason: an
-- overlap test (&&) on an array column, evaluated on every search that
-- carries a language.
create index if not exists tools_languages_gin
  on public.tools using gin (languages);

comment on index public.tools_languages_gin is
  'Hard constraint: tools.languages && p_languages in search_tools.';

comment on index public.tools_search_doc_gin is
  'Signals 1 and 3: tools.search_doc @@ tsquery in search_tools — the OR '
  'retrieval query, and again the all-terms bonus query.';

comment on index public.tool_problems_doc_gin is
  'Signals 2 and 3: tool_problems.search_doc @@ tsquery in search_tools, for '
  'the same two queries. The join back to tools rides the (tool_id, '
  'statement) unique constraint, which is why there is no separate tool_id '
  'index.';

comment on index public.tools_name_trgm is
  'Signal 4: tools.name % p_query — the half-remembered-name rescue in '
  'search_tools.';

comment on index public.tools_platforms_gin is
  'Hard constraint: tools.platforms && p_platforms in search_tools.';

comment on index public.tools_flags_gin is
  'Hard constraint: tools.flags @> p_flags in search_tools. Note @>, not &&: '
  'stated flags are requirements, all of which must hold.';

comment on index public.tools_browse is
  'The empty-query branch of search_tools: published tools in editorial '
  'order, rating then likes.';

-- Deliberately NOT created here:
--
--   * A vector index. tool_problems.embedding is untouched by this migration
--     and there is no ANN index at launch. An approximate index silently
--     drops matches once results are filtered, and this product filters on
--     nearly every search — see 00-SUMMARY.md ruling 4. Revisit around
--     50,000 vectors, with the golden set to prove it.
--
--   * A partial GIN on search_doc restricted to published rows. It would
--     match the search predicate exactly, but unpublished listings are a
--     small minority of the table, so it would duplicate almost the whole
--     index to skip almost nothing, and cost a second write on every edit.
--
--   * Anything on tools.pricing. Six possible values over a few thousand
--     rows: the planner is right to filter rather than seek, and an index
--     here would only ever be a maintenance cost.

-- ===========================================================================
-- Grants. The verbs; the policies still decide the rows.
-- ===========================================================================
grant execute on function
  public.search_tools(text, pricing_model[], platform[], tool_flag[], text[], int)
  to foundit_app;
grant execute on function
  public.log_search_event(text, int, real, boolean, int)
  to foundit_app;

commit;
