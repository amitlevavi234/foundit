-- ===========================================================================
-- Does the database actually refuse what 0004_vectors.sql promises?
--
-- Same shape and same rules as db/test/rls_test.sql and
-- db/test/search_events_test.sql: run against a seeded development database,
-- every check raises on failure, the script either finishes with one success
-- line or stops at the first problem.
--
-- THE WHOLE SUITE RUNS IN ONE TRANSACTION AND ALWAYS ROLLS BACK. It writes to
-- the query-embedding cache and to tool_problems, so it must leave nothing
-- behind; if a check fails, ON_ERROR_STOP abandons psql and the server rolls
-- the transaction back on disconnect. Either way the database is exactly as it
-- was. Run it three times in a row and the output is identical.
--
-- Four claims are worth a behavioural test, and they are the four an
-- adversarial review would go at first:
--
--   1. foundit_app cannot read or write public.query_embeddings directly. The
--      cache holds sentences people typed, and the table's defence is that it
--      has no policy and the application role has no grant — two refusals,
--      neither of which is a policy evaluating to `true`.
--
--   2. The setters work anyway, as foundit_app, because that is the only door
--      and a door that does not open is not a design.
--
--   3. THE VECTOR LEG CANNOT BYPASS A CONSTRAINT. A query whose nearest
--      neighbour by meaning is a paid tool must not return that tool when the
--      search says free. This is the one that matters: a new ranking signal is
--      the classic way a WHERE clause quietly becomes a preference.
--
--   4. The 200-character ceiling still bites. It is the only thing standing
--      between an anonymous stranger and an expensive endpoint, and 0004
--      recreated both halves of search, so it has to be proved again here
--      rather than assumed to have survived.
--
--   docker exec -i foundit-dev-db psql -v ON_ERROR_STOP=1 -U foundit_owner \
--     -d foundit < db/test/vectors_test.sql
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.be(p_user text)
returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  end if;
end;
$$;

create or replace function pg_temp.fail(msg text)
returns void language plpgsql as $$
begin
  raise exception 'VECTORS TEST FAILED: %', msg;
end;
$$;

-- A deterministic unit vector with a 1 in one position. Two of these are
-- orthogonal, so "nearest by meaning" below is arithmetic rather than luck,
-- and no API call is needed to test the plumbing.
create or replace function pg_temp.unit(p_at int)
returns halfvec language sql immutable as $$
  select ('[' || string_agg(case when i = p_at then '1' else '0' end, ',') || ']')::halfvec(512)
    from generate_series(0, 511) as i;
$$;

-- ===========================================================================
-- 0. The premise, again. Everything here is meaningless if the application
--    role can ignore row-level security.
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
--
--    RLS on and FORCED (rls_test.sql checks that for every table; repeated
--    here because this table's whole defence is that plus the absence of a
--    policy), no policy at all, and no privilege of any kind for foundit_app.
-- ===========================================================================
do $$
declare n integer;
begin
  if to_regclass('public.query_embeddings') is null then
    perform pg_temp.fail('public.query_embeddings does not exist');
  end if;

  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'query_embeddings'
     and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 1 then
    perform pg_temp.fail('row-level security is not enabled AND forced on query_embeddings');
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'query_embeddings';
  if n <> 0 then
    perform pg_temp.fail(n || ' policy/policies on query_embeddings. The design is NO policy: '
                      || 'with RLS forced that refuses everybody who is subject to policies, '
                      || 'and it needs no `true` anywhere to say so');
  end if;

  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'query_embeddings'
     and grantee = 'foundit_app';
  if n <> 0 then
    perform pg_temp.fail('foundit_app holds ' || n || ' grant(s) on query_embeddings; it must '
                      || 'reach the cache only through the definer functions');
  end if;
end
$$;

-- The cache has no column that could be a person, and must never grow one.
do $$
declare bad text;
begin
  select string_agg(a.attname, ', ') into bad
    from pg_attribute a
   where a.attrelid = 'public.query_embeddings'::regclass
     and a.attnum > 0 and not a.attisdropped
     and (a.attname ~ '(user|profile|session|ip|device|visitor|request|account)'
          or a.attname = 'id');
  if bad is not null then
    perform pg_temp.fail('query_embeddings has a column that could identify somebody: ' || bad);
  end if;

  -- A foreign key would do the same job by another route.
  select string_agg(conname, ', ') into bad
    from pg_constraint
   where conrelid = 'public.query_embeddings'::regclass and contype = 'f';
  if bad is not null then
    perform pg_temp.fail('query_embeddings has a foreign key: ' || bad);
  end if;
end
$$;

-- Search must still run as the caller. A SECURITY DEFINER search would mean
-- row-level security stops applying to the tables it reads, and a draft
-- listing would become searchable.
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('search_tools', 'search_tools_impl')
     and p.prosecdef;
  if bad is not null then
    perform pg_temp.fail('SECURITY DEFINER on a function that must run as the caller: ' || bad);
  end if;
end
$$;

-- No approximate index on the vector column, at any point. An ANN index drops
-- matches once results are filtered, and this product filters constantly.
do $$
declare bad text;
begin
  select string_agg(i.indexname, ', ') into bad
    from pg_indexes i
   where i.schemaname = 'public'
     and i.tablename in ('tool_problems', 'query_embeddings')
     and (i.indexdef ilike '%using ivfflat%' or i.indexdef ilike '%using hnsw%');
  if bad is not null then
    perform pg_temp.fail('an approximate vector index exists: ' || bad);
  end if;
end
$$;

-- The two normalisations have not drifted apart. 0004's normalize_query is
-- deliberately the same four operators, in the same order, that
-- search_events_normalize applies before hashing, so that the query cache and
-- the search log bucket a sentence identically.
do $$
declare v_norm text; v_hash text;
begin
  v_norm := public.normalize_query('  Split   a  BILL  ');
  if v_norm <> 'split a bill' then
    perform pg_temp.fail('normalize_query produced ' || quote_literal(v_norm));
  end if;

  v_hash := encode(sha256(convert_to(v_norm, 'UTF8')), 'hex');
  if v_hash <> encode(
       sha256(convert_to(lower(regexp_replace(
         btrim(left(btrim('  Split   a  BILL  '), 200)), '\s+', ' ', 'g')), 'UTF8')), 'hex') then
    perform pg_temp.fail('normalize_query and the search_events hash normalisation disagree');
  end if;

  if public.normalize_query(repeat('a', 500)) <> repeat('a', 200) then
    perform pg_temp.fail('normalize_query does not cap at 200 characters');
  end if;
end
$$;

-- ===========================================================================
-- Everything below runs AS the application role, which is the only way any of
-- it is exercised in real life.
-- ===========================================================================
set role foundit_app;

-- ===========================================================================
-- 2. The cache is closed to the application, and open through its functions.
-- ===========================================================================
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  begin
    select count(*) into n from public.query_embeddings;
    perform pg_temp.fail('foundit_app read ' || n || ' row(s) straight off query_embeddings');
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.query_embeddings (query_norm, embedding, embedding_model)
    values ('a smuggled key', pg_temp.unit(0), 'text-embedding-3-small');
    perform pg_temp.fail('foundit_app wrote to query_embeddings directly');
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.query_embeddings;
    perform pg_temp.fail('foundit_app deleted from query_embeddings');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- The setter is the door, and it opens.
do $$
declare v_missing boolean;
begin
  perform pg_temp.be(null);

  if not public.query_embedding_missing('a sentence nobody has typed before') then
    perform pg_temp.fail('an unseen sentence was reported as cached');
  end if;

  perform public.store_query_embedding(
    '  A Sentence Nobody   Has Typed Before  ', pg_temp.unit(7), public.embedding_model());

  -- Stored under the NORMALISED key, so a differently-spaced, differently-cased
  -- retyping of the same thing is a hit.
  v_missing := public.query_embedding_missing('a sentence nobody has typed before');
  if v_missing then
    perform pg_temp.fail('the cache missed a sentence it had just been given, so the key is '
                      || 'not the normalised text');
  end if;

  -- A caller that already has a vector is never missing one.
  if public.query_embedding_missing('anything at all', pg_temp.unit(1)) then
    perform pg_temp.fail('a supplied vector was reported as missing');
  end if;

  -- An empty sentence has nothing to embed and is not a miss.
  if public.query_embedding_missing('   ') then
    perform pg_temp.fail('an empty sentence was reported as needing a vector');
  end if;

  -- The touch is the only other write, and it changes one timestamp.
  perform public.touch_query_embedding('a sentence nobody has typed before');
end
$$;

-- A vector from a different model is refused rather than quietly mixed in.
do $$
begin
  perform pg_temp.be(null);
  begin
    perform public.store_query_embedding('some sentence', pg_temp.unit(2), 'some-other-model');
    perform pg_temp.fail('a vector from another model was cached; cosine distance between two '
                      || 'embedding spaces is a number with no meaning');
  exception when invalid_parameter_value then null;
  end;
end
$$;

-- ===========================================================================
-- 3. THE ONE THAT MATTERS MOST.
--
--    A constraint is a WHERE clause, not a preference. Here a paid tool is
--    made the nearest possible neighbour of the query vector — distance 0,
--    orthogonal to everything else — and the search is told "free". The tool
--    must not appear at any rank, however close it is.
--
--    Done with hand-built orthogonal unit vectors rather than real embeddings
--    so that the test asserts the plumbing and not the model.
-- ===========================================================================
reset role;

do $$
declare v_paid bigint; v_free bigint;
begin
  -- A paid tool and a free one, each with one problem statement, each embedded
  -- on its own axis. The query will be exactly the paid one's vector.
  insert into public.tools (slug, name, url, summary, pricing, status, published_at)
  values ('zz-vector-paid', 'ZZ Vector Paid', 'https://zz-vector-paid.example',
          'A paid tool that exists only inside this test transaction.',
          'paid', 'published', now())
  returning id into v_paid;

  insert into public.tools (slug, name, url, summary, pricing, status, published_at)
  values ('zz-vector-free', 'ZZ Vector Free', 'https://zz-vector-free.example',
          'A free tool that exists only inside this test transaction.',
          'free', 'published', now())
  returning id into v_free;

  insert into public.tool_problems (tool_id, statement, embedding, embedding_model, embedded_at)
  values (v_paid, 'zzqqxx the paid one', pg_temp.unit(3), public.embedding_model(), now()),
         (v_free, 'zzqqxx the free one', pg_temp.unit(4), public.embedding_model(), now());
end
$$;

set role foundit_app;

do $$
declare n integer; v_top text;
begin
  perform pg_temp.be(null);

  -- Unconstrained, the paid tool is the nearest thing there is: same vector,
  -- distance 0. If it is not first, the vector leg is not running and the rest
  -- of this check proves nothing.
  select s.slug::text into v_top
    from public.search_tools('zzqqxx', p_embedding => pg_temp.unit(3)) s
   limit 1;
  if v_top is distinct from 'zz-vector-paid' then
    perform pg_temp.fail('the vector leg did not put the identical vector first; it returned '
                      || coalesce(v_top, '(nothing)') || ', so the constraint check below '
                      || 'would pass for the wrong reason');
  end if;

  -- Now say free. The nearest neighbour by meaning is paid, and it must be
  -- gone — not demoted, not last, GONE — at any rank, up to the maximum the
  -- function will return.
  select count(*) into n
    from public.search_tools('zzqqxx',
           p_pricing   => array['free']::pricing_model[],
           p_limit     => 50,
           p_embedding => pg_temp.unit(3)) s
   where s.slug::text = 'zz-vector-paid';
  if n > 0 then
    perform pg_temp.fail('the vector leg returned a paid tool for a query that said free: a '
                      || 'ranking signal bypassed a hard constraint');
  end if;

  -- And the free one is still there, so the filter narrowed rather than emptied.
  select count(*) into n
    from public.search_tools('zzqqxx',
           p_pricing   => array['free']::pricing_model[],
           p_limit     => 50,
           p_embedding => pg_temp.unit(3)) s
   where s.slug::text = 'zz-vector-free';
  if n <> 1 then
    perform pg_temp.fail('the free tool disappeared too, so the filter is not narrowing, it is '
                      || 'emptying');
  end if;

  -- The same, one level down: query_vector_ranks can only return tools whose
  -- ids it was handed. This is the guarantee itself rather than its effect.
  select count(*) into n
    from public.query_vector_ranks('zzqqxx', pg_temp.unit(3), array[]::bigint[], 100);
  if n <> 0 then
    perform pg_temp.fail('query_vector_ranks returned rows for an empty candidate set');
  end if;
end
$$;

-- A flag constraint behaves the same way, because "offline" is a requirement
-- and not a hint either.
do $$
declare n integer;
begin
  perform pg_temp.be(null);
  select count(*) into n
    from public.search_tools('zzqqxx',
           p_flags     => array['works_offline']::tool_flag[],
           p_limit     => 50,
           p_embedding => pg_temp.unit(3)) s
   where s.slug::text in ('zz-vector-paid', 'zz-vector-free');
  if n > 0 then
    perform pg_temp.fail('a tool declaring no flags was returned for a query requiring one');
  end if;
end
$$;

-- ===========================================================================
-- 4. Without a vector, search is exactly what Phase 2 was.
--
--    This is the degradation promise from the database's side: no key, no
--    cache entry, no API — the leg contributes nothing and the answer is the
--    text-only one, with embedding_missing saying so.
-- ===========================================================================
do $$
declare v_missing boolean; n integer;
begin
  perform pg_temp.be(null);

  select s.embedding_missing into v_missing
    from public.search_tools('a sentence that is definitely not cached anywhere') s
   limit 1;
  if v_missing is distinct from true then
    perform pg_temp.fail('an uncached sentence did not report embedding_missing');
  end if;

  select count(*) into n from public.search_tools('split expenses with friends');
  if n = 0 then
    perform pg_temp.fail('search returned nothing for a query that should match');
  end if;

  -- A maintainer may read their own drafts, and search must still refuse to
  -- show them. 0004 recreated both halves of search, so this is re-proved
  -- rather than assumed.
  perform pg_temp.be('dev_maker');
  select count(*) into n
    from public.search_tools('split expenses with friends', p_limit => 50) s
    join public.tools t on t.id = s.tool_id
   where t.status <> 'published';
  if n > 0 then
    perform pg_temp.fail('search returned ' || n || ' unpublished listing(s)');
  end if;
end
$$;

-- ===========================================================================
-- 5. The 200-character ceiling survived the rewrite.
-- ===========================================================================
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  begin
    perform count(*) from public.search_tools(repeat('a', 300));
    perform pg_temp.fail('a 300-character query was accepted; the cap is 200');
  exception when string_data_right_truncation then null;
  end;

  -- One character over, to prove the boundary is where it says it is, and
  -- again with a vector supplied, because that is a second code path into the
  -- same wrapper.
  begin
    perform count(*) from public.search_tools(repeat('a', 201), p_embedding => pg_temp.unit(5));
    perform pg_temp.fail('a 201-character query with a vector was accepted');
  exception when string_data_right_truncation then null;
  end;

  -- The refusal must not echo the query back: this endpoint collects health,
  -- money and relationship trouble and an error message ends up in a log.
  begin
    perform count(*) from public.search_tools(repeat('leaving my husband ', 20));
    perform pg_temp.fail('a 380-character query was accepted');
  exception when string_data_right_truncation then
    if sqlerrm like '%husband%' then
      perform pg_temp.fail('the length error quotes the query text back: ' || sqlerrm);
    end if;
  end;

  select count(*) into n
    from public.search_tools(rpad('split expenses with friends', 200, ' x'));
  if n = 0 then
    perform pg_temp.fail('a 200-character query returned nothing; the cap is too tight');
  end if;
end
$$;

-- ===========================================================================
-- 6. The embedding job's write, as the job makes it.
--
--    foundit_app cannot update tool_problems — the policy from 0001 requires
--    the caller to own the listing and a batch job has no identity — so the
--    definer function is the only door, and it may set three columns and no
--    others.
-- ===========================================================================
do $$
declare v_id bigint; v_statement text; r record;
begin
  perform pg_temp.be(null);

  select tp.id, tp.statement into v_id, v_statement
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   order by tp.id
   limit 1;
  if v_id is null then
    perform pg_temp.fail('the seed has no published problem statements to embed');
  end if;

  begin
    update public.tool_problems set embedding = pg_temp.unit(9) where id = v_id;
    -- An UPDATE refused by a policy affects zero rows rather than raising, so
    -- the row count is the test.
    if found then
      perform pg_temp.fail('foundit_app wrote an embedding straight onto tool_problems');
    end if;
  exception when insufficient_privilege then null;
  end;

  if not public.store_problem_embedding(v_id, pg_temp.unit(9), public.embedding_model()) then
    perform pg_temp.fail('store_problem_embedding did not write the row it was given');
  end if;

  -- It cannot be used to rewrite what a tool says it solves.
  select statement, embedding_model into r from public.tool_problems where id = v_id;
  if r.statement is distinct from v_statement then
    perform pg_temp.fail('store_problem_embedding changed the statement');
  end if;
  if r.embedding_model is distinct from public.embedding_model() then
    perform pg_temp.fail('store_problem_embedding did not record the model');
  end if;

  -- A row that no longer exists is reported rather than counted as done.
  if public.store_problem_embedding(-1, pg_temp.unit(9), public.embedding_model()) then
    perform pg_temp.fail('store_problem_embedding claimed to write a row that does not exist');
  end if;

  begin
    perform public.store_problem_embedding(v_id, pg_temp.unit(9), 'some-other-model');
    perform pg_temp.fail('a vector from another model was written onto a problem statement');
  exception when invalid_parameter_value then null;
  end;
end
$$;

-- After the job has run, embedded_at is not behind updated_at — which is what
-- makes a second run of scripts/embed.mjs embed nothing.
do $$
declare n integer;
begin
  perform pg_temp.be(null);
  select count(*) into n
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   where tp.embedding is not null and tp.embedded_at < tp.updated_at;
  if n > 0 then
    perform pg_temp.fail(n || ' embedded statement(s) are already stale the moment they are '
                      || 'written, so the job would never converge');
  end if;
end
$$;

reset role;

select 'All vector, cache and constraint-filter checks passed.' as result;

-- Nothing this file did survives it. Reached only when every check above
-- passed; a failure gets here by another route — psql stops on the error and
-- the server rolls the transaction back when the connection closes — and
-- either way the database is as it was.
rollback;
