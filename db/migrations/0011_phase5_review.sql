-- ===========================================================================
-- 0011 — three things the Phase 5 adversarial review found, and one it did not
--
-- 0010 is not edited: `infra.schema_migrations` has recorded it, and a
-- migration that changes after it has run is a migration nobody can reason
-- about. Where 0010 said something that turned out to be untrue, the sentence
-- is REPLACED here with `comment on`, which is the only honest way to correct a
-- claim that is already in the database.
--
-- Four sections:
--   1. foundit_app cannot write a statement's provenance — the review's
--      finding, and the one that matters most before Phase 6 gives listings
--      owners
--   2. ...nor its embedding, which is the same hole one column along and is
--      0005's oracle waiting for somebody to own a listing
--   3. query_reranks_shape now refuses what its own comment always claimed
--   4. store_generated_statement says WHY it refused, instead of returning null
-- ===========================================================================

-- ===========================================================================
-- 1. The provenance columns are the owner's, not the application's
--
-- WHAT THE REVIEW FOUND. `0001_init.sql` granted foundit_app table-wide INSERT,
-- UPDATE and DELETE on public.tool_problems, for the Phase 7 flow where a maker
-- edits their own listing. `0010` then added three columns to that table —
-- `source`, `generated_model`, `verified_model` — and a table-wide grant covers
-- a column added later. So the application role could write
-- `source = 'generated'` on a row nothing generated, or relabel a generated row
-- as seeded, or name any model it liked as the one that checked it.
--
-- Today that is unreachable: row-level security lets a caller write only rows
-- belonging to a tool it owns, and nobody owns anything because there are no
-- accounts. **Phase 6 is what makes it reachable**, which is why it is closed
-- now rather than then — a privilege that becomes exploitable on the day a
-- feature ships is a privilege nobody will be looking at that day.
--
-- 0010's comment on `source` claimed the CHECK made "every generated statement
-- was checked" a property of the TABLE. It is not, and the review was right to
-- say so: the CHECK requires a row CLAIMING to be generated to name two models,
-- and says nothing about whether either model ever saw it. What makes the claim
-- true is that the only writer of that value is a SECURITY DEFINER function
-- with no `source` parameter, and that nothing else may write the column at
-- all. The second half of that sentence is what this section adds, and the
-- comment is corrected below to say the smaller, true thing.
--
-- PostgreSQL cannot revoke one column from a table-wide grant, so the fix is
-- 0007's: take the table grant away and give back a column list, generated from
-- the catalogue rather than typed out. A column added by a LATER migration will
-- not be in it and that migration has to grant its own, which is the price of
-- column privileges and is the safe direction — a missing grant fails loudly on
-- first use.
-- ===========================================================================

-- ===========================================================================
-- 2. And the embedding column, found while closing section 1
--
-- The same table-wide INSERT and UPDATE also covered `tool_problems.embedding`.
-- `0005_embed_role.sql` exists precisely because a role that can WRITE a vector
-- and ASK which vector is nearest a cached query can read somebody else's
-- cached search out one sign bit at a time — a review recovered 16 of 16 as
-- foundit_app. 0005 took `store_problem_embedding` away from the application;
-- it did not take away the column, because the column grant was not what it was
-- looking at. `0007` then revoked SELECT on it and gave back a column list, so
-- the application can no longer READ a vector — and could still write one.
--
-- Both halves of the oracle need the write to be gone, and it is gone here.
-- Nothing loses anything: the application does not embed the catalogue, the
-- batch job connects as foundit_embed, and that job writes through a SECURITY
-- DEFINER function owned by the schema owner, which is unaffected by this.
-- ===========================================================================
do $$
declare
  v_cols text;
  -- The three provenance columns and the vector. A generated row's provenance
  -- is written by one definer function; a vector is written by another; and
  -- neither of them is the web application.
  c_owner_only constant text[] :=
    array['source', 'generated_model', 'verified_model', 'embedding'];
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.tool_problems'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and not (a.attname = any (c_owner_only))
     -- `search_doc` is a generated column: PostgreSQL refuses INSERT and UPDATE
     -- privileges on one, so naming it here would make this statement fail.
     and a.attgenerated = '';

  execute format('revoke insert, update on public.tool_problems from foundit_app');
  execute format('grant insert (%s), update (%s) on public.tool_problems to foundit_app',
                 v_cols, v_cols);
end
$$;

comment on column public.tool_problems.source is
  'Who wrote this statement: ''seed'' (by hand, in db/seed/dev_seed.sql), '
  '''generated'' (by the model named in generated_model and checked by the one '
  'in verified_model — db/migrations/0010, scripts/generate-statements.mjs), or '
  '''user'' (Phase 7, the person who added the tool). '
  'CORRECTED IN 0011, because 0010''s comment overclaimed. The CHECK on this '
  'table requires a row CLAIMING to be generated to name two models; it cannot '
  'know whether either model ever saw the row, so "every generated statement '
  'was checked" is NOT a property of the table. What makes it true is narrower '
  'and is worth stating exactly: the only writer of this value is '
  'public.store_generated_statement, which has no `source` parameter and is '
  'granted to foundit_embed alone, and since 0011 no other role may write this '
  'column at all.';

comment on column public.tool_problems.embedding is
  'The problem statement as a vector. foundit_app can neither read this column '
  '(0007) nor write it (0011). A role that can write a vector AND ask which '
  'vector is nearest a cached query reads that query out one sign bit at a '
  'time (0005); 0005 took the WRITE FUNCTION away from the application and left '
  'the column writable through the table grant, which is the same hole one '
  'column along. The embedding job writes through '
  'public.store_problem_embedding as foundit_embed, which is unaffected.';

-- ===========================================================================
-- 3. The rerank cache's shape CHECK now refuses what its comment claimed
--
-- WHAT THE REVIEW FOUND. 0010's constraint said "each element is an object
-- carrying exactly a slug and a relevance in 0..3" and enforced something
-- weaker: `[{}]` stored, and so did an element with extra keys, because the
-- jsonpath tests only fired on keys that were PRESENT. A cached row of that
-- shape is then refused by lib/rerank.ts on the way out — which is the safe
-- direction, and is also a page pinned to the Phase 4 order for as long as the
-- row lives, silently.
--
-- The constraint is dropped and rebuilt rather than edited, because a CHECK
-- cannot be altered in place. Two tests are new and are the two that were
-- missing: every element must HAVE both keys, and must have no third.
-- `@.keyvalue()` yields one object per key, so the filter runs per key rather
-- than over a sequence — which is the mistake that made the first attempt at
-- this refuse every valid judgement.
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
    -- ...and whose relevance is one of exactly four values. Enumerated rather
    -- than ranged, because jsonpath has no integer test and `1.5` is a number
    -- between 0 and 3.
    and not (judgement @? '$[*].relevance ? (@ != 0 && @ != 1 && @ != 2 && @ != 3)')
  );

comment on table public.query_reranks is
  'One row per (normalised sentence, candidate set): what gpt-5-nano judged '
  'each candidate''s relevance to be, so the next person who types the same '
  'thing and gets the same candidates costs nothing. Every element of the '
  'judgement is an object with exactly the keys slug and relevance, the slug a '
  'string and the relevance one of 0, 1, 2 and 3 — and since 0011 the CHECK '
  'actually enforces that, which 0010''s did not: it tested only the keys that '
  'happened to be present, so `[{}]` and an element with a third key both '
  'stored. It has no user column, no session column, no IP column and no '
  'foreign key to anything that has one, and it must never gain any of them. '
  'Row-level security is enabled and forced and there is no policy on it at '
  'all: every read and write goes through a SECURITY DEFINER function and '
  'foundit_app holds no grant on the table itself.';

-- ===========================================================================
-- 4. "I refused, and here is why"
--
-- WHAT THE REVIEW FOUND. store_generated_statement returned NULL for two
-- different things: the tool already has enough statements, and the tool
-- already has this exact statement. The job counted both as "the database
-- refused it" and could not tell a run that did nothing because it was finished
-- from a run that did nothing because it kept writing duplicates.
--
-- So the ceiling raises a distinct SQLSTATE and the conflict keeps the null.
-- `FN001` is in the implementation-defined range PostgreSQL leaves to
-- applications; it is named once here and once in
-- scripts/generate-statements.mjs, and there is no third place to drift.
--
-- The function's other refusals — an over-length statement, a missing model
-- name, an unpublished tool — already raise. What changes on the JOB side is
-- that each is caught per row rather than ending the run, which is the other
-- half of the same finding: one bad candidate out of 791 must not abandon the
-- other 790.
-- ===========================================================================
create or replace function public.store_generated_statement(
  p_tool_id         bigint,
  p_statement       text,
  p_generated_model text,
  p_verified_model  text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_have   int;
  v_status text;
  v_id     bigint;
  v_text   text := btrim(coalesce(p_statement, ''));
begin
  if p_generated_model is null or btrim(p_generated_model) = ''
     or p_verified_model is null or btrim(p_verified_model) = '' then
    raise exception 'a generated statement must name the model that wrote it and the model that checked it'
      using errcode = '22023';
  end if;

  if length(v_text) < 8 or length(v_text) > 200 then
    raise exception 'a problem statement is between 8 and 200 characters; this one is %', length(v_text)
      using errcode = '22023';
  end if;

  select t.status::text into v_status
    from public.tools t where t.id = p_tool_id;
  if v_status is null then
    raise exception 'no tool with id %', p_tool_id using errcode = '23503';
  end if;
  if v_status <> 'published' then
    raise exception 'tool % is %, not published', p_tool_id, v_status using errcode = '22023';
  end if;

  -- The refusal that makes this job idempotent. It now SAYS what it is, so a
  -- run can report "12 tools were already full" separately from "9 statements
  -- were already there word for word", which are different facts about a run.
  select count(*) into v_have from public.tool_problems where tool_id = p_tool_id;
  if v_have >= public.statements_wanted() then
    raise exception 'tool % already has % statements, which is the ceiling', p_tool_id, v_have
      using errcode = 'FN001',
            hint = 'public.statements_wanted() is the ceiling; it is raised in a migration.';
  end if;

  -- `source` is not a parameter, and that is the point of this function
  -- existing at all: there is no argument here that could write 'seed' or
  -- 'user', so a row written through this door is a generated row by
  -- construction. Since 0011 it is also the only door there is.
  insert into public.tool_problems
    (tool_id, statement, sort_order, source, generated_model, verified_model)
  values
    (p_tool_id, v_text, coalesce(v_have, 0)::smallint, 'generated',
     btrim(p_generated_model), btrim(p_verified_model))
  on conflict (tool_id, statement) do nothing
  returning id into v_id;

  -- Null now means ONE thing: this tool already carries this statement, word
  -- for word.
  return v_id;
end;
$fn$;

comment on function public.store_generated_statement(bigint, text, text, text) is
  'Write one generated problem statement onto a published tool. Returns the new '
  'row''s id, or NULL when the tool already carries that exact statement. '
  'RAISES SQLSTATE FN001 when the tool has reached '
  'public.statements_wanted(), which is what makes the job idempotent and, '
  'since 0011, distinguishable from a duplicate. There is no `source` '
  'parameter: a row written through this door is source = ''generated'' by '
  'construction, and it must name both the model that wrote it and the model '
  'that checked it. EXECUTE belongs to foundit_embed; the application role has '
  'no business writing the catalogue, and since 0011 no longer holds the column '
  'privileges to try.';
