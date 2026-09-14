-- ===========================================================================
-- 0031 — the English gate missed the presentation forms
--
-- OWNER FEEDBACK, ROUND 1 — F14. 0022 added
-- `tool_problems.non_english_script`, generated from
--
--     statement ~ '[<U+0590>-<U+06FF>]'
--
-- and its own header claimed the range covered "Hebrew (U+0590–U+05FF) and
-- Arabic (U+0600–U+06FF), the two scripts in this catalogue". It covers those
-- two BLOCKS. It does not cover those two SCRIPTS: real Hebrew and Arabic also
-- live in
--
--   U+0750–077F  Arabic Supplement
--   U+08A0–08FF  Arabic Extended-A
--   U+FB1D–FB4F  Alphabetic Presentation Forms (the Hebrew half)
--   U+FB50–FDFF  Arabic Presentation Forms-A
--   U+FE70–FEFF  Arabic Presentation Forms-B
--
-- and the presentation forms in particular are what text pasted out of a PDF or
-- an older Windows application looks like. A maker using
-- `public.set_owner_statements`, or the submit flow, could store such a
-- statement and every one of the five render filters would pass it through — so
-- the guarantee 0022 exists to give ("no Hebrew or Arabic renders") was
-- evadable by ordinary pasted text, with no malice required.
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN IS DROPPED AND REMADE RATHER THAN ALTERED
--
-- A STORED generated column's expression cannot be changed in place: there is
-- no `alter column ... set expression` that recomputes it in PostgreSQL 16, and
-- the values are on disk. So the column goes and comes back, which takes
-- `tool_problems_renderable` with it — a partial index whose predicate names
-- the column cannot outlive it. The two are dropped and recreated TOGETHER, in
-- one transaction, because an index that exists for part of a migration over a
-- predicate that does not is a plan the planner will happily use.
--
-- The rows themselves are untouched. 0022's decision stands and this migration
-- does not revisit it: the fifteen Hebrew and Arabic statements stay, they are
-- still embedded, still indexed and still ranked, and what changes is only
-- which of them the five printing queries are allowed to show.
--
-- ---------------------------------------------------------------------------
-- ONE RANGE, IN ONE PLACE
--
-- 0022's range was written out twice — here and in `tests/english.test.mjs` —
-- so the test agreed with the gap rather than catching it. Both now derive from
-- `db/non-english-script.mjs`, and `tests/english.test.mjs` asserts that the
-- `U&'…'` literal below is character-for-character what that module renders. A
-- widening that touched only one of the two would fail that test rather than
-- leaving the schema and its test quietly disagreeing.
--
-- The literal is a `U&'…'` Unicode string constant on purpose: it puts the code
-- points in the file instead of the characters, so nothing in `db/` has to
-- carry a right-to-left character that an editor may reorder on screen.
-- ===========================================================================
begin;

drop index if exists public.tool_problems_renderable;

alter table public.tool_problems drop column if exists non_english_script;

alter table public.tool_problems
  add column non_english_script boolean
    generated always as (statement ~ U&'[\0590-\06FF\0750-\077F\08A0-\08FF\FB1D-\FB4F\FB50-\FDFF\FE70-\FEFF]') stored;

comment on column public.tool_problems.non_english_script is
  'True when the statement contains a character from any block a Hebrew or '
  'Arabic letter can appear in: U+0590-06FF, U+0750-077F, U+08A0-08FF, '
  'U+FB1D-FB4F, U+FB50-FDFF and U+FE70-FEFF — the last four being what text '
  'pasted out of a PDF looks like, which 0022 missed (0031). It is a RENDERING '
  'gate and not a language: every row is still indexed, still embedded and '
  'still ranked, and the five queries that put statement text on a page filter '
  'it out. Generated, so no writer can forget to set it — the seed, the '
  'generator, a maker editing their own listing and the submit flow all get it '
  'computed for them (0022, 0031).';

-- Partial, because the query is always `where not non_english_script` and the
-- false rows are almost all of them: a partial index on the predicate the
-- planner is actually given is smaller than a full one and is the only shape
-- that can serve `tool_problems_by_tool` ordering under the same filter. Back
-- in the same transaction the column returned in, for the reason in the header.
create index tool_problems_renderable
  on public.tool_problems (tool_id, sort_order, id)
  where not non_english_script;

-- 0029 granted the application SELECT on this column by name. The column is a
-- new one as far as the catalogue is concerned, so the grant has to be made
-- again — a dropped column takes its own privileges with it, and the symptom of
-- forgetting is 0029's: a hard 500 on every page that reads a statement.
grant select (non_english_script) on public.tool_problems to foundit_app;

commit;
