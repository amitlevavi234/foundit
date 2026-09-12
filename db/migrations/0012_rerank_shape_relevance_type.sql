-- ===========================================================================
-- 0012 — 0011's tightened CHECK had a hole of its own
--
-- 0011 replaced `query_reranks_shape` with a version that refuses `[{}]`, an
-- element with a third key, and a relevance of 1.5. Its last test enumerates
-- the four permitted values:
--
--     not (judgement @? '$[*].relevance ? (@ != 0 && @ != 1 && @ != 2 && @ != 3)')
--
-- and a jsonpath comparison between a STRING and a number is neither true nor
-- false — it is unknown, so the filter does not match and the row stores.
-- `{"slug": "alpha", "relevance": "high"}` went in. `db/test/rerank_test.sql`
-- caught it on the first run, which is what that suite is for; 0011 is not
-- edited, because it has been applied.
--
-- The fix is the type test the enumeration was quietly assumed to imply. It is
-- the same lesson as the one 0011 itself records about `@.keyvalue()`: a
-- jsonpath filter answers "does any value here satisfy this", and a value that
-- cannot be compared satisfies nothing — including a negation.
-- ===========================================================================
alter table public.query_reranks drop constraint if exists query_reranks_shape;

alter table public.query_reranks
  add constraint query_reranks_shape check (
    jsonb_typeof(judgement) = 'array'
    and jsonb_array_length(judgement) between 1 and 100
    -- every element is an object...
    and not (judgement @? '$[*] ? (@.type() != "object")')
    -- ...with both keys...
    and not (judgement @? '$[*] ? (!exists(@.slug) || !exists(@.relevance))')
    -- ...and no third key...
    and not (judgement @? '$[*].keyvalue() ? (@.key != "slug" && @.key != "relevance")')
    -- ...whose slug is a string...
    and not (judgement @? '$[*].slug ? (@.type() != "string")')
    -- ...and whose relevance is a NUMBER (0012: without this, a string
    -- compares unknown against every value below and the row stores)...
    and not (judgement @? '$[*].relevance ? (@.type() != "number")')
    -- ...and one of exactly four values. Enumerated rather than ranged, because
    -- jsonpath has no integer test and 1.5 is a number between 0 and 3.
    and not (judgement @? '$[*].relevance ? (@ != 0 && @ != 1 && @ != 2 && @ != 3)')
  );
