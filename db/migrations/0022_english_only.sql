-- ===========================================================================
-- 0022 — the site is English, and the catalogue is not
--
-- THE OWNER'S ITEM 1, 14 September 2026. He read the site for the first time
-- and found Hebrew and Arabic on it: fifteen problem statements, on Browse, on
-- tool pages and inside "Why this?" on results. Foundit's interface is English
-- and nothing on it announces otherwise, so a Hebrew sentence in the middle of
-- an English page reads as a defect, and is one.
--
-- WHY THE ROWS STAY. They are not decoration. `public.tool_problems` is what
-- the vector leg searches: `0004_vectors.sql` embeds each statement and
-- `query_vector_ranks` finds a tool by the MEANING of a sentence rather than by
-- its words. The fifteen exist so that somebody who types
-- "אני קורא טקסט בעברית ונתקל במילים שאני לא מכיר" finds Morfix — which is the
-- product working exactly as designed, for the person most likely to need that
-- listing. Deleting them would make the catalogue worse at the one job it has,
-- to make an English page tidy. `db/seed/dev_seed.sql` keeps all fifteen.
--
-- SO THE FILTER IS ON RENDERING, NEVER ON RETRIEVAL. `search_doc` is untouched,
-- `embedding` is untouched, and every function that RANKS still sees every
-- statement. What changes is that the five places which put a statement's text
-- on a page are given a column that says, of each row, whether it can be shown
-- on an English page — and they all filter on it. A statement can therefore
-- find a tool and still never be printed, which is what the owner asked for.
--
-- WHY A GENERATED COLUMN AND NOT A `lang` COLUMN THE SEED SETS. A column the
-- seed sets is a column somebody has to remember to set. Three of the four
-- writers of this table are not the seed — `public.store_generated_statement`
-- (0010), `public.set_owner_statements` (0017/0018), and the submit flow — and
-- a maker is perfectly entitled to type a statement in Hebrew about a Hebrew
-- tool. A STORED generated column is computed by the database on every insert
-- and every update, by everybody, for ever, and cannot be forgotten, bypassed
-- or set wrong. It is also indexable, which a filter on a text pattern is not.
--
-- WHAT THE TEST ACTUALLY TESTS, said plainly because the column's name must
-- not over-claim. It is `statement ~ '[֐-ۿ]'` — Hebrew (U+0590–
-- U+05FF) and Arabic (U+0600–U+06FF), the two scripts in this catalogue and
-- the two the owner named. It is not a language detector: a statement in
-- French, or in Russian, is `false` here and would render. That is the right
-- scope for today (nothing in the catalogue is in either) and the wrong name
-- would be the thing that made a later reader trust it too far, so the column
-- is called `non_english_script` and this paragraph is what it means.
--
-- Rendered by: lib/sql.ts (HOME_SQL, BROWSE_SQL, TOOL_SQL, SEARCH_DETAILED_SQL's
-- matched_problem) and lib/tool-sql.ts (MAKER_DASHBOARD_SQL). Not filtered, on
-- purpose: SEARCH_DETAILED_SQL's `statements` array, which is what the reranker
-- READS — a model reading a Hebrew statement about a Hebrew dictionary is the
-- vector leg's whole point, and nothing it returns is text on a page.
--
-- tests/english.test.mjs walks every route and fails on a character in this
-- range anywhere in the HTML. db/test/rls_test.sql is unaffected: a generated
-- column changes no policy.
-- ===========================================================================
begin;

alter table public.tool_problems
  add column if not exists non_english_script boolean
    generated always as (statement ~ '[֐-ۿ]') stored;

comment on column public.tool_problems.non_english_script is
  'True when the statement contains a Hebrew (U+0590-U+05FF) or Arabic '
  '(U+0600-U+06FF) character. It is a RENDERING gate and not a language: every '
  'row is still indexed, still embedded and still ranked, and the five queries '
  'that put statement text on a page filter it out. Generated, so no writer can '
  'forget to set it — the seed, the generator, a maker editing their own '
  'listing and the submit flow all get it computed for them (0022).';

-- Partial, because the query is always `where not non_english_script` and the
-- false rows are almost all of them: a partial index on the predicate the
-- planner is actually given is smaller than a full one and is the only shape
-- that can serve `tool_problems_by_tool` ordering under the same filter.
create index if not exists tool_problems_renderable
  on public.tool_problems (tool_id, sort_order, id)
  where not non_english_script;

commit;
