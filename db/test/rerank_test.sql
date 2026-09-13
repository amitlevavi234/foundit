-- ===========================================================================
-- Does the database actually refuse what 0010_generated_statements.sql
-- promises?
--
-- Same shape and same rules as db/test/reader_test.sql: run against a seeded
-- development database, every check raises on failure, the script either
-- finishes with one success line or stops at the first problem.
--
-- THE WHOLE SUITE RUNS IN ONE TRANSACTION AND ALWAYS ROLLS BACK. It writes
-- judgements, search events and generated statements, so it must leave nothing
-- behind; if a check fails, ON_ERROR_STOP abandons psql and the server rolls
-- the transaction back on disconnect. Run it three times in a row and the
-- output is identical.
--
-- Eleven claims, in three groups.
--
-- The rerank cache (0010 §3):
--   1. foundit_app cannot read or write public.query_reranks directly: no
--      policy at all, and no grant, which is two refusals and neither of them
--      is a policy evaluating to `true`.
--   2. The three functions work anyway, as foundit_app, because that is the
--      only door.
--   3. The table has nothing that could identify a person, and no argument
--      anywhere could carry one in.
--   4. The key is a PAIR: the same sentence over a different candidate set is a
--      different question and must not be served the other's answer.
--   5. The 200-character ceiling raises rather than truncating.
--   6. A judgement of the wrong shape is refused by the database, not only by
--      TypeScript.
--   7. A judgement recorded under another model is invisible.
--
-- A good match (0010 §4):
--   8. search_events carries match_judged, and "good but not judged" is
--      refused by a CHECK rather than merely discouraged.
--   9. log_search_event still works with five arguments, so nothing that
--      called it before this migration broke.
--
-- Generated statements (0010 §1 and §2):
--  10. store_generated_statement belongs to foundit_embed and NOT to
--      foundit_app: the web application does not write the catalogue.
--  11. It refuses a tool that already has enough statements, refuses a tool
--      that is not published, and cannot write any `source` but 'generated'.
--
--   docker exec -i foundit-dev-db psql -v ON_ERROR_STOP=1 -U foundit_owner \
--     -d foundit < db/test/rerank_test.sql
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'RERANK TEST FAILED: %', msg;
end;
$$;

/**
 * THE OWNER'S WINDOW (db/migrations/0020_phase8_review.sql §2).
 *
 * `foundit_owner` has been NOSUPERUSER NOBYPASSRLS since 13 September 2026 —
 * which is what research/08 §9.3 has always said the server would be — so the
 * owner is subject to every policy in `public` exactly as the application is.
 * That IS the change: an owner statement reaching past a policy used to be a
 * silent no-op and is now an error.
 *
 * A test suite is one of the three things that legitimately reaches past a
 * policy as the owner. It plants fixtures no function could plant, and it
 * counts rows the person who wrote them would not be allowed to see. Every
 * call below is one of those, each with its own reason written beside it, and
 * the window is closed again on the next line.
 */
create or replace function pg_temp.owner_window(p_open boolean)
returns void language plpgsql as $$
begin
  perform set_config('foundit.definer',
                     case when p_open then 'on' else 'off' end, true);
end;
$$;

/** A well-formed judgement over two candidates. */
create or replace function pg_temp.judgement()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('slug', 'alpha', 'relevance', 3),
    jsonb_build_object('slug', 'bravo', 'relevance', 0)
  );
$$;

/** A 64-character hex string, which is the shape of a candidates hash. */
create or replace function pg_temp.hash(seed text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(seed, 'UTF8')), 'hex');
$$;

-- ===========================================================================
-- 0. The premise. Everything here is meaningless if the application role can
--    ignore row-level security.
-- ===========================================================================
do $$
declare r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = 'foundit_app';
  if not found then
    perform pg_temp.fail('role foundit_app does not exist');
  end if;
  if r.rolsuper or r.rolbypassrls then
    perform pg_temp.fail('foundit_app bypasses row-level security');
  end if;
end
$$;

-- ===========================================================================
-- 1. Structural: the cache is guarded the way the migration says it is.
-- ===========================================================================
do $$
declare n integer;
begin
  if to_regclass('public.query_reranks') is null then
    perform pg_temp.fail('public.query_reranks does not exist');
  end if;

  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'query_reranks'
     and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 1 then
    perform pg_temp.fail('row-level security is not enabled AND forced on query_reranks');
  end if;

  -- EXACTLY ONE POLICY, AND IT IS THE DEFINER WINDOW (0020 §2). The design
  -- was no policy at all, which refused one role too many: `foundit_owner`
  -- became NOSUPERUSER NOBYPASSRLS on 13 September 2026 and this cache's own
  -- SECURITY DEFINER writers run AS the owner, so every judgement this
  -- product pays for silently failed to cache. TO foundit_owner, which no
  -- application role is a member of, and gated on a setting rather than on
  -- `true`.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'query_reranks';
  if n <> 1 then
    perform pg_temp.fail(
      format('query_reranks has %s policy/policies; it must have exactly one, and that '
             'one is the 0020 definer window', n));
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'query_reranks'
     and policyname = 'query_reranks_definer'
     and roles::text = '{foundit_owner}'
     and qual like '%foundit.definer%'
     and with_check like '%foundit.definer%';
  if n <> 1 then
    perform pg_temp.fail('the one policy on query_reranks is not the definer window: it '
                         'must be scoped TO foundit_owner and gated on foundit.definer');
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'query_reranks'
     and grantee = 'foundit_app';
  if n <> 0 then
    perform pg_temp.fail('foundit_app holds a grant on query_reranks; it must hold none');
  end if;
end
$$;

-- ===========================================================================
-- 2. No column, anywhere, that could be a person.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(column_name, ', ') into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'query_reranks'
     and column_name ~* '(user|person|profile|account|session|ip|addr|device|fingerprint|request|visitor)';
  if bad is not null then
    perform pg_temp.fail(format('query_reranks has a column that could identify somebody: %s', bad));
  end if;

  select string_agg(conname, ', ') into bad
    from pg_constraint
   where conrelid = 'public.query_reranks'::regclass and contype = 'f';
  if bad is not null then
    perform pg_temp.fail(format('query_reranks has a foreign key: %s', bad));
  end if;

  select string_agg(p.parameter_name, ', ') into bad
    from information_schema.parameters p
    join information_schema.routines r
      on r.specific_name = p.specific_name and r.specific_schema = p.specific_schema
   where r.routine_schema = 'public' and r.routine_name = 'store_query_rerank'
     and p.parameter_name ~* '(user|person|session|ip|addr|device|request|visitor)';
  if bad is not null then
    perform pg_temp.fail(format('store_query_rerank takes something identifying: %s', bad));
  end if;
end
$$;

-- ===========================================================================
-- 3. The application role is refused the table and allowed the doors.
-- ===========================================================================
set local role foundit_app;

do $$
begin
  begin
    perform 1 from public.query_reranks limit 1;
    perform pg_temp.fail('foundit_app can SELECT from query_reranks');
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.query_reranks (query_norm, candidates_hash, judgement, rerank_model)
    values ('a sentence', pg_temp.hash('x'), pg_temp.judgement(), public.rerank_model());
    perform pg_temp.fail('foundit_app can INSERT into query_reranks directly');
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- ===========================================================================
-- 4. The doors work, and the key is a PAIR.
-- ===========================================================================
do $$
declare j jsonb;
begin
  perform public.store_query_rerank(
    'Split A  BILL with friends', pg_temp.hash('set-one'), pg_temp.judgement(), public.rerank_model());

  -- Normalised on the way in, so the caller cannot invent half a key.
  j := public.query_rerank('split a bill with friends', pg_temp.hash('set-one'));
  if j is null then
    perform pg_temp.fail('a judgement stored under a raw sentence was not found under its normalised form');
  end if;
  if jsonb_array_length(j) <> 2 then
    perform pg_temp.fail('the judgement came back the wrong shape');
  end if;

  -- The same sentence over a DIFFERENT candidate set is a different question.
  -- Serving one answer for the other would reorder a page against a judgement
  -- of tools that are not on it.
  if public.query_rerank('split a bill with friends', pg_temp.hash('set-two')) is not null then
    perform pg_temp.fail('a judgement was served for a candidate set it was not about');
  end if;

  perform public.touch_query_rerank('split a bill with friends', pg_temp.hash('set-one'));
end
$$;

-- ===========================================================================
-- 5. The 200-character ceiling raises rather than truncating, so two sentences
--    sharing a 200-character prefix cannot share a judgement.
-- ===========================================================================
do $$
begin
  begin
    perform public.store_query_rerank(
      repeat('x', 201), pg_temp.hash('set-one'), pg_temp.judgement(), public.rerank_model());
    perform pg_temp.fail('a 201-character sentence was accepted');
  exception
    when string_data_right_truncation then null;
  end;
end
$$;

-- ===========================================================================
-- 6. A judgement of the wrong shape is refused by the DATABASE.
--
--    lib/rerank.ts refuses the same things in TypeScript. This is the layer a
--    future caller cannot skip.
-- ===========================================================================
do $$
declare
  bad jsonb;
  shapes jsonb[] := array[
    '{"results": []}'::jsonb,                                  -- not an array
    '["alpha"]'::jsonb,                                        -- not objects
    '[{"slug": "alpha", "relevance": 4}]'::jsonb,              -- out of range
    '[{"slug": "alpha", "relevance": -1}]'::jsonb,             -- out of range
    '[{"slug": 5, "relevance": 1}]'::jsonb,                    -- slug not a string
    '[{"slug": "alpha", "relevance": "high"}]'::jsonb,         -- relevance not a number
    '[]'::jsonb                                                -- empty
  ];
begin
  foreach bad in array shapes loop
    begin
      perform public.store_query_rerank(
        'a sentence about shapes', pg_temp.hash('shape'), bad, public.rerank_model());
      perform pg_temp.fail(format('a judgement of shape %s was accepted', bad));
    exception
      when check_violation then null;
    end;
  end loop;
end
$$;

-- ===========================================================================
-- 7. A judgement from another model is refused on the way in, and invisible if
--    it somehow got there.
-- ===========================================================================
do $$
begin
  begin
    perform public.store_query_rerank(
      'a sentence', pg_temp.hash('set-one'), pg_temp.judgement(), 'gpt-4o-mini');
    perform pg_temp.fail('a judgement from another model was accepted');
  exception
    when invalid_parameter_value then null;
  end;
end
$$;

reset role;

-- Put a row in under another model, as the owner, and check it is invisible.
--
-- The suite opens 0020 §2's window by hand to do it, and says so: since
-- 13 September 2026 foundit_owner is NOSUPERUSER NOBYPASSRLS and is subject to
-- this table's one policy like anybody else. There is no function that writes
-- a judgement under a retired model — store_query_rerank refuses one, which is
-- what §7 just proved — so the fixture has to be the owner saying plainly that
-- it is reaching past a policy.
select set_config('foundit.definer', 'on', false);

insert into public.query_reranks (query_norm, candidates_hash, judgement, rerank_model)
values ('a stale sentence', pg_temp.hash('set-one'), pg_temp.judgement(), 'a-retired-model');

select set_config('foundit.definer', 'off', false);

set local role foundit_app;
do $$
begin
  if public.query_rerank('a stale sentence', pg_temp.hash('set-one')) is not null then
    perform pg_temp.fail('a judgement recorded under a retired model was served');
  end if;
end
$$;
reset role;

-- ===========================================================================
-- 8. A good match, and the three states it can be in.
-- ===========================================================================
do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'search_events'
     and column_name = 'match_judged';
  if n <> 1 then
    perform pg_temp.fail('search_events has no match_judged column');
  end if;

  -- "Not judged but good" is not a state docs/product-decisions.md §17 can
  -- produce, and the database refuses it rather than trusting the caller.
  begin
    insert into public.search_events
      (query_text, query_hash, result_count, had_good_match, match_judged)
    values ('a sentence', repeat('0', 64), 3, true, false);
    perform pg_temp.fail('a row claiming a good match nobody judged was accepted');
  exception
    when check_violation then null;
  end;
end
$$;

-- The writes go in as foundit_app, because that is who writes them. The READS
-- are as the owner, because `search_events_read` is admin-only and an
-- application role that could read the search log would be the privacy defect
-- this table exists to prevent.
set local role foundit_app;
do $$
begin
  -- The three states, written the way the application writes them.
  perform public.log_search_event('nobody looked at this one', 12, 0.5, false, 40, false);
  perform public.log_search_event('judged, and nothing fitted', 0, null, false, 41, true);
  perform public.log_search_event('judged, and something fitted', 5, 0.9, true, 42, true);

  -- And the five-argument call, which is what everything written before this
  -- migration sends. It must still work, and it must record "nobody looked".
  perform public.log_search_event('the old five-argument call', 7, 0.4, false, 43);

  -- A caller that passes "good" without "judged" has misread the definition,
  -- and the safe reading of that pair is the one that claims less. The function
  -- records the honest row rather than failing a search that has already
  -- answered.
  perform public.log_search_event('good but unjudged, through the function', 4, 0.7, true, 44, false);
end
$$;
reset role;

-- The owner counts the rows the application just logged. search_events_read is auth.is_admin(), so without the 0020 §2 window the owner sees none of them and this reads as five searches that were never recorded.
select pg_temp.owner_window(true);

do $$
declare r record;
begin
  select count(*) filter (where match_judged and had_good_match) as good,
         count(*) filter (where match_judged and not had_good_match) as judged_no,
         count(*) filter (where not match_judged) as unjudged
    into r
    from public.search_events
   where query_text in ('nobody looked at this one', 'judged, and nothing fitted',
                        'judged, and something fitted', 'the old five-argument call',
                        'good but unjudged, through the function');
  if r.good <> 1 or r.judged_no <> 1 or r.unjudged <> 3 then
    perform pg_temp.fail(
      format('the states came out as good=%s judged-no=%s unjudged=%s', r.good, r.judged_no, r.unjudged));
  end if;

  if (select had_good_match from public.search_events
       where query_text = 'good but unjudged, through the function') then
    perform pg_temp.fail('log_search_event recorded a good match nobody judged');
  end if;
end
$$;
select pg_temp.owner_window(false);


-- ===========================================================================
-- 9. The catalogue's write belongs to foundit_embed alone.
-- ===========================================================================
set local role foundit_app;
do $$
declare v_id bigint;
begin
  begin
    select public.store_generated_statement(
      (select id from public.tools where status = 'published' order by id limit 1),
      'a statement the application should never be able to write',
      'gpt-5-mini', 'gpt-5-nano') into v_id;
    perform pg_temp.fail('foundit_app can write a problem statement');
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.statement_work(1);
    perform pg_temp.fail('foundit_app can read the generation job''s work queue');
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- ===========================================================================
-- 10. And what it refuses, as the role that holds it.
-- ===========================================================================
set local role foundit_embed;
do $$
declare
  v_tool   bigint;
  v_full   bigint;
  v_id     bigint;
begin
  -- Note what this block does NOT do: read public.tool_problems. foundit_embed
  -- holds no grant on it and is not getting one — the queue, the dedupe and the
  -- write are all functions, and "how many statements does this tool have" is
  -- a question the setter answers by refusing, not one the job may ask.
  select tool_id into v_tool from public.statement_work(1);
  if v_tool is null then
    -- Every published tool already has enough. That is a legitimate state and
    -- the rest of this block has nothing to test against, so say so rather
    -- than passing silently.
    raise notice 'no tool is under the ceiling; the acceptance path was not exercised';
  else
    select public.store_generated_statement(
      v_tool, 'The fridge hums all night and nobody can sleep through it',
      'gpt-5-mini', 'gpt-5-nano') into v_id;
    if v_id is null then
      perform pg_temp.fail('a tool under the ceiling refused a statement');
    end if;
  end if;

  -- Both models are required: a generated statement with no verifier is a
  -- statement nobody checked.
  begin
    perform public.store_generated_statement(v_tool, 'A perfectly ordinary situation to be in', null, 'gpt-5-nano');
    perform pg_temp.fail('a statement with no generator was accepted');
  exception
    when invalid_parameter_value then null;
  end;

  -- The table's own 8..200, said early so the error is readable.
  begin
    perform public.store_generated_statement(v_tool, 'short', 'gpt-5-mini', 'gpt-5-nano');
    perform pg_temp.fail('a five-character statement was accepted');
  exception
    when invalid_parameter_value then null;
  end;

end
$$;
reset role;

-- A tool that already has enough is left alone, whatever the caller asks. That
-- is what makes the job idempotent, and it is checked as the OWNER because
-- finding such a tool means reading public.tool_problems, which foundit_embed
-- may not do. The refusal is the setter's and does not depend on who calls it.
do $$
declare
  v_full bigint;
  v_id   bigint;
begin
  select tp.tool_id into v_full
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   group by tp.tool_id
  having count(*) >= public.statements_wanted()
   limit 1;

  if v_full is null then
    raise notice 'no published tool is at the ceiling; the refusal was not exercised';
  else
    -- Since 0011 this RAISES rather than returning null, so that the job can
    -- count "this tool is full" separately from "this tool already has this
    -- statement". Both used to be a null and the job could not tell a finished
    -- run from one writing duplicates.
    begin
      select public.store_generated_statement(
        v_full, 'Another situation entirely, for a tool that has enough already',
        'gpt-5-mini', 'gpt-5-nano') into v_id;
      perform pg_temp.fail('a tool at the ceiling accepted another statement');
    exception
      when sqlstate 'FN001' then null;
    end;
  end if;
end
$$;

-- ===========================================================================
-- 11. There is no argument that could write any source but 'generated'.
--
--     The brief asked for a refusal; not offering the choice is stronger. This
--     asserts the function's signature rather than its behaviour, because the
--     behaviour cannot be tested for an argument that does not exist.
-- ===========================================================================
do $$
declare args text;
begin
  select string_agg(p.parameter_name, ', ' order by p.ordinal_position) into args
    from information_schema.parameters p
    join information_schema.routines r
      on r.specific_name = p.specific_name and r.specific_schema = p.specific_schema
   where r.routine_schema = 'public' and r.routine_name = 'store_generated_statement';
  if args <> 'p_tool_id, p_statement, p_generated_model, p_verified_model' then
    perform pg_temp.fail(format('store_generated_statement takes (%s)', args));
  end if;

  -- And a generated row must name both models, as a property of the TABLE.
  --
  -- The owner's window (0020 §2) is open for this one statement, because the
  -- subject is the CHECK and nothing else: the owner maintains no listing, so
  -- tool_problems_write refuses the insert first and the CHECK never runs. A
  -- 42501 here would look exactly like a pass.
  perform pg_temp.owner_window(true);
  begin
    insert into public.tool_problems (tool_id, statement, source)
    values ((select id from public.tools where status = 'published' order by id limit 1),
            'A generated row with no models named at all', 'generated');
    perform pg_temp.owner_window(false);
    perform pg_temp.fail('a generated row with no models was accepted');
  exception
    when check_violation then null;
  end;
  perform pg_temp.owner_window(false);
end
$$;

-- ===========================================================================
-- 12. 0011: the application cannot write a statement's provenance, nor its
--     vector.
--
--     The Phase 5 review's finding. 0001 granted foundit_app table-wide INSERT
--     and UPDATE on tool_problems for the Phase 7 maker flow, and a table-wide
--     grant covers a column added later — so 0010's three provenance columns
--     were writable by the application from the moment they existed. Today
--     row-level security makes it unreachable because nobody owns a listing;
--     PHASE 6 IS WHAT MAKES IT REACHABLE, which is why the column privileges
--     are gone now.
--
--     Checked as privileges rather than behaviourally, and on purpose: a
--     behavioural test would need a tool this role owns, which needs an
--     account, which is Phase 6 — so the test would pass today by accident and
--     say nothing about the thing it is named after.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(format('%s:%s', column_name, privilege_type), ', ' order by column_name)
    into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'tool_problems'
     and grantee = 'foundit_app'
     and privilege_type in ('INSERT', 'UPDATE')
     and column_name in ('source', 'generated_model', 'verified_model', 'embedding');
  if bad is not null then
    perform pg_temp.fail(format(
      'foundit_app can write a statement''s provenance or its vector: %s', bad));
  end if;

  -- REPLACED BY 0017, and the original sentence is worth keeping so the change
  -- is visible. Phase 5 asserted here that foundit_app must KEEP UPDATE on
  -- `statement`, "or the revoke went too far", because Phase 7 was expected to
  -- edit statements through the column grant and row-level security.
  --
  -- Phase 7 decided otherwise, and the reason is the hole this very section is
  -- about. `source` defaults to 'seed'. An application that can INSERT a
  -- statement without being able to write `source` writes a stranger's sentence
  -- into the catalogue recorded as something we wrote by hand — 0011's
  -- carefully corrected comment on that column, wrong again, one row at a time.
  --
  -- So 0017 took INSERT, UPDATE and DELETE on this table away from the
  -- application altogether and made public.set_owner_statements the one door,
  -- with no `source` parameter. The assertion is now the opposite one.
  if exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'tool_problems'
       and grantee = 'foundit_app'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) or exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'tool_problems'
       and grantee = 'foundit_app'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    perform pg_temp.fail(
      'foundit_app can write public.tool_problems directly; since 0017 every '
      || 'person-typed statement goes through public.set_owner_statements, '
      || 'which is what makes source = ''user'' true by construction');
  end if;

  -- And the door it is supposed to use exists and is granted.
  if not has_function_privilege('foundit_app',
       'public.set_owner_statements(bigint, text[])', 'EXECUTE') then
    perform pg_temp.fail('the one door for a person-typed statement is not granted to foundit_app');
  end if;
end
$$;

-- And behaviourally, for the half that does not need an owner: a direct write
-- naming the column is refused before row-level security is even consulted.
set local role foundit_app;
do $$
begin
  begin
    update public.tool_problems set source = 'generated' where false;
    perform pg_temp.fail('foundit_app can UPDATE tool_problems.source');
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.tool_problems (tool_id, statement, source)
    values (1, 'a statement the application labelled itself', 'generated');
    perform pg_temp.fail('foundit_app can INSERT a source');
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.tool_problems set embedding = null where false;
    perform pg_temp.fail('foundit_app can UPDATE tool_problems.embedding — 0005''s oracle is open');
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- ===========================================================================
-- 13. 0011: the shape CHECK refuses what its comment claims.
--
--     0010's version tested only the keys that were PRESENT, so `[{}]` stored
--     and so did an element with a third key. A row of that shape is then
--     refused by lib/rerank.ts on the way out, which pins that page to the
--     Phase 4 order for as long as the row lives.
-- ===========================================================================
set local role foundit_app;
do $$
declare
  bad jsonb;
  shapes jsonb[] := array[
    '[{}]'::jsonb,                                              -- the review's
    '[{"slug": "alpha", "relevance": 1, "why": "x"}]'::jsonb,   -- a third key
    '[{"slug": "alpha"}]'::jsonb,                               -- no relevance
    '[{"relevance": 1}]'::jsonb,                                -- no slug
    '[{"slug": "alpha", "relevance": 1.5}]'::jsonb              -- not an integer
  ];
begin
  foreach bad in array shapes loop
    begin
      perform public.store_query_rerank(
        'a sentence about shapes', pg_temp.hash('tightened'), bad, public.rerank_model());
      perform pg_temp.fail(format('a judgement of shape %s was accepted', bad));
    exception
      when check_violation then null;
    end;
  end loop;

  -- And the good shape still stores, or the constraint refuses everything.
  perform public.store_query_rerank(
    'a sentence about shapes', pg_temp.hash('tightened'),
    '[{"slug": "alpha", "relevance": 3}, {"slug": "bravo", "relevance": 0}]'::jsonb,
    public.rerank_model());
  if public.query_rerank('a sentence about shapes', pg_temp.hash('tightened')) is null then
    perform pg_temp.fail('a well-formed judgement was refused by the tightened CHECK');
  end if;
end
$$;
reset role;

-- ===========================================================================
-- 14. 0011: the ceiling raises rather than returning null.
--
--     Two different refusals used to look identical to the job: "this tool is
--     full" and "this tool already has this statement".
-- ===========================================================================
-- As the OWNER, because finding a tool at the ceiling means reading
-- public.tool_problems and foundit_embed holds no grant on it — which is
-- section 10's point and not something to weaken for a test's convenience. The
-- refusal is the function's and does not depend on who calls it; section 10
-- exercises the same path as foundit_embed against a tool it found through the
-- queue.
do $$
declare
  v_full bigint;
  v_id   bigint;
begin
  select tp.tool_id into v_full
    from public.tool_problems tp
   group by tp.tool_id
  having count(*) >= public.statements_wanted()
   limit 1;

  if v_full is null then
    raise notice 'no tool is at the ceiling; the FN001 path was not exercised';
  else
    begin
      perform public.store_generated_statement(
        v_full, 'A situation for a tool that is already full up',
        'gpt-5-mini', 'gpt-5-nano');
      perform pg_temp.fail('a tool at the ceiling did not raise');
    exception
      when sqlstate 'FN001' then null;
    end;
  end if;
end
$$;

-- The owner can find a tool under the ceiling and prove the OTHER null still
-- means what it now means: this exact statement is already there.
do $$
declare
  v_tool bigint;
  v_text text;
  v_id   bigint;
begin
  -- The queue is the authority on "under the ceiling", so the test asks it
  -- rather than re-deriving the predicate and getting it subtly different — an
  -- earlier version of this block did exactly that and picked a tool the
  -- section above had just filled.
  select w.tool_id into v_tool from public.statement_work(1) w;

  if v_tool is null then
    raise notice 'no tool is under the ceiling; the duplicate path was not exercised';
  else
    select tp.statement into v_text
      from public.tool_problems tp where tp.tool_id = v_tool limit 1;
    select public.store_generated_statement(v_tool, v_text, 'gpt-5-mini', 'gpt-5-nano') into v_id;
    if v_id is not null then
      perform pg_temp.fail('a statement this tool already carries was written twice');
    end if;
  end if;
end
$$;

select 'RERANK TEST PASSED — 0010 and 0011 refuse what they say they refuse' as result;

rollback;
