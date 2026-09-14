-- ===========================================================================
-- 0029 — the application could not read the column it has to filter on
--
-- 0022 adds `public.tool_problems.non_english_script` and five queries in
-- `lib/sql.ts` and `lib/tool-sql.ts` filter on it. `foundit_app` does not have
-- SELECT on `public.tool_problems`; it has SELECT on TWELVE NAMED COLUMNS of
-- it, which is 0005's deliberate arrangement — the application may read a
-- statement and may not read its `embedding`, because the role that can plant
-- a vector must not also be able to read one out. A column added later is not
-- in that list, and a column-level grant refuses rather than filtering:
--
--     error: permission denied for table tool_problems
--     GET /submit/done?tool=tabsplit  500
--
-- Caught by `tests/links.test.mjs`, which walks every Phase 7 route against a
-- production build and fails on a 500. It did not show up against `next dev`
-- while the pages were being checked by hand, because `lib/db.ts` caches every
-- catalogue read for sixty seconds and the pages in question were answering
-- out of a cache filled before 0022 ran.
--
-- THE GRANT IS ONE COLUMN AND NOT THE TABLE. `grant select on
-- public.tool_problems to foundit_app` would have fixed the 500 and handed the
-- application the `embedding` column at the same time, which is the thing 0005
-- §4 and 0007 §3 exist to prevent. The list stays a list.
--
-- `non_english_script` is derived from `statement`, which the application can
-- already read, so this grant tells it nothing it could not compute. What it
-- buys is that the DATABASE computes it, once, on write, for every writer —
-- which is the whole argument for a generated column in 0022's header.
-- ===========================================================================
begin;

grant select (non_english_script) on public.tool_problems to foundit_app;

commit;
