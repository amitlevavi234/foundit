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

  -- EXACTLY ONE POLICY, AND IT IS THE DEFINER WINDOW (0020 §2). The design
  -- was NO policy — with RLS forced that refuses everybody who is subject to
  -- policies and needs no `true` anywhere to say so — and it refused one role
  -- too many: `foundit_owner` became NOSUPERUSER NOBYPASSRLS on 13 September
  -- 2026, which is what the server has always been, and this cache's own
  -- SECURITY DEFINER writers run AS the owner.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'query_embeddings';
  if n <> 1 then
    perform pg_temp.fail(n || ' policy/policies on query_embeddings; there must be exactly '
                      || 'one, and that one is the 0020 definer window');
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'query_embeddings'
     and policyname = 'query_embeddings_definer'
     and roles::text = '{foundit_owner}'
     and qual like '%foundit.definer%'
     and with_check like '%foundit.definer%';
  if n <> 1 then
    perform pg_temp.fail('the one policy on query_embeddings is not the definer window: it '
                      || 'must be scoped TO foundit_owner and gated on foundit.definer');
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

-- --- the two guards 0005 added to the setter ------------------------------
do $$
begin
  perform pg_temp.be(null);

  -- A query over the cap is REFUSED, not truncated. normalize_query caps at
  -- 200 with left(), so two sentences sharing a 200-character prefix would
  -- otherwise normalise to the same key and the second would be served the
  -- first one's vector, silently, for as long as the row lived.
  begin
    perform public.store_query_embedding(repeat('a', 201), pg_temp.unit(3),
                                         public.embedding_model());
    perform pg_temp.fail('a 201-character query was cached; two sentences sharing a '
                      || '200-character prefix would share a vector');
  exception when string_data_right_truncation then null;
  end;

  -- A zero vector has no direction: cosine distance to it is NaN, the ordering
  -- collapses to the tie break, and the search looks like it is working while
  -- returning the catalogue in id order. Cached, that is served to everybody
  -- who types the same sentence until the row ages out.
  begin
    perform public.store_query_embedding(
      'a sentence with no direction',
      ('[' || repeat('0,', 511) || '0]')::halfvec(512),
      public.embedding_model());
    perform pg_temp.fail('a zero vector was cached');
  exception when invalid_parameter_value then null;
  end;
end
$$;

-- Neither refusal left anything behind, and the 200-character one in
-- particular must not have written a truncated key.
reset role;
do $$
declare n integer;
begin
  select count(*) into n from public.query_embeddings
   where query_norm = repeat('a', 200) or query_norm = 'a sentence with no direction';
  if n > 0 then
    perform pg_temp.fail(n || ' row(s) were cached by a call that was supposed to raise');
  end if;
end
$$;
set role foundit_app;

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

-- Two listings and their vectors, planted as the owner. There is no function that creates a published listing with a hand-built orthogonal unit vector on it — publish_tool is the maker's path and store_problem_embedding is the embedding job's — so the owner's window (0020 §2) is opened for the fixture and closed again immediately.
select pg_temp.owner_window(true);

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
select pg_temp.owner_window(false);


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

  -- And the free one is still there, so the filter narrowed rather than
  -- emptied. Two stems, not one: the free tool's only evidence is that its
  -- listing carries every term of the sentence, and since 0007 a sentence with
  -- a single stem does not count for that — "zzqqxx" alone is the same shape
  -- of match as "file" or "app", which would open every page. Its vector
  -- points elsewhere (unit(4) against a unit(3) query) on purpose.
  select count(*) into n
    from public.search_tools('zzqqxx free',
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
-- 6. THE ORACLE, AND THE TWO ROLES THAT CLOSE IT.
--
--    0004 gave foundit_app EXECUTE on store_problem_embedding. Row-level
--    security refuses that write directly — tool_problems_write requires the
--    caller to own the listing — and the definer function handed back exactly
--    what the policy had refused, over every row in the table.
--
--    That is a READ hole, not a write one. query_vector_ranks will rank any
--    candidate set against the vector cached for any sentence and return the
--    ORDER. Plant a chosen vector on one statement and its negation on
--    another, ask for the ranking, and the answer is one bit of the cached
--    vector. An adversarial review recovered 16 of 16 sign bits of somebody
--    else's search this way, holding no grant on query_embeddings at all.
--
--    0005 split the two powers between two roles. This section proves the
--    split from both sides, because a separation that only holds in one
--    direction is not one.
-- ===========================================================================

-- --- and foundit_app cannot read the vectors themselves (0007) -------------
-- 0006 promised in capitals that no distance leaves the database while
-- foundit_app could `select embedding from tool_problems` and compute every
-- distance it liked. Column privileges closed that; this is the check that it
-- stays closed, on both tables, without taking the rest of either away.
set role foundit_app;
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  begin
    select count(*) into n from public.tool_problems where embedding is not null;
    perform pg_temp.fail('foundit_app read tool_problems.embedding: it can compute the '
                      || 'distances query_vector_ranks exists to keep inside the database');
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.tools where embedding is not null;
    perform pg_temp.fail('foundit_app read tools.embedding');
  exception when insufficient_privilege then null;
  end;

  -- But everything the application actually draws is still readable, or the
  -- revoke above took the site down instead of a privilege.
  select count(*) into n from public.tool_problems tp where tp.statement is not null;
  if n = 0 then
    perform pg_temp.fail('foundit_app cannot read tool_problems.statement any more');
  end if;
  select count(*) into n from public.tools t where t.summary is not null and t.url is not null;
  if n = 0 then
    perform pg_temp.fail('foundit_app cannot read the columns a tool page draws');
  end if;
end
$$;

-- --- foundit_app has the READ half and must not have the WRITE half --------
do $$
declare v_id bigint;
begin
  perform pg_temp.be(null);

  select tp.id into v_id
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   order by tp.id
   limit 1;
  if v_id is null then
    perform pg_temp.fail('the seed has no published problem statements to embed');
  end if;

  -- Directly: refused by the policy, which affects zero rows rather than
  -- raising, so the row count is the test.
  begin
    update public.tool_problems set embedding = pg_temp.unit(9) where id = v_id;
    if found then
      perform pg_temp.fail('foundit_app wrote an embedding straight onto tool_problems');
    end if;
  exception when insufficient_privilege then null;
  end;

  -- Through the definer function: refused by the absence of EXECUTE. THIS IS
  -- THE FIX. If it ever passes again, the application role can plant vectors
  -- and read the query cache out one sign bit at a time.
  begin
    perform public.store_problem_embedding(v_id, pg_temp.unit(9), public.embedding_model());
    perform pg_temp.fail('foundit_app can execute store_problem_embedding: the role that can '
                      || 'ask which vector is nearest a cached query can now also plant the '
                      || 'vectors it asks about, which reads the cache out one bit at a time');
  exception when insufficient_privilege then null;
  end;

  -- And it cannot read the queue either, which is foundit_embed's alone.
  begin
    perform count(*) from public.problem_embedding_work();
    perform pg_temp.fail('foundit_app can read the embedding job''s work queue');
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- --- foundit_embed has the WRITE half and must not have the READ half ------
set role foundit_embed;

do $$
declare n integer;
begin
  -- No table it could read. Not the statements it embeds, not the cache, not
  -- the search log, not the catalogue.
  begin
    select count(*) into n from public.tool_problems;
    perform pg_temp.fail('foundit_embed read ' || n || ' row(s) from tool_problems directly');
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.query_embeddings;
    perform pg_temp.fail('foundit_embed read the query cache');
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.search_events;
    perform pg_temp.fail('foundit_embed read the search log');
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.tools;
    perform pg_temp.fail('foundit_embed read the catalogue');
  exception when insufficient_privilege then null;
  end;

  -- And no function that could read a cached vector or write one.
  begin
    perform count(*) from public.search_tools('split expenses with friends');
    perform pg_temp.fail('foundit_embed can search, which is the other half of the oracle');
  exception when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.query_vector_ranks(
      'split expenses with friends', null, array[1]::bigint[], 10);
    perform pg_temp.fail('foundit_embed can rank against a cached query vector');
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.store_query_embedding('a sentence', pg_temp.unit(1), public.embedding_model());
    perform pg_temp.fail('foundit_embed can write to the query cache');
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.query_embedding_missing('a sentence');
    perform pg_temp.fail('foundit_embed can probe the query cache');
  exception when insufficient_privilege then null;
  end;
end
$$;

-- --- and the job's own two functions still work ---------------------------
-- The queue is callable, and it hands back the two columns the job uses and
-- no third. An empty queue is the ordinary state of a development database
-- whose embeddings are filled, so the count is not asserted — being able to
-- ask at all is.
do $$
declare n integer; bad text;
begin
  select count(*) into n from public.problem_embedding_work();
  if n is null then
    perform pg_temp.fail('problem_embedding_work returned null');
  end if;

  select string_agg(a.attname, ', ') into bad
    from pg_proc p
    cross join lateral unnest(p.proargnames) with ordinality as a(attname, ord)
   where p.oid = 'public.problem_embedding_work(int)'::regprocedure
     and a.attname not in ('p_limit', 'id', 'statement');
  if bad is not null then
    perform pg_temp.fail('problem_embedding_work returns more than the id and the statement: '
                      || bad);
  end if;
end
$$;

-- The write itself. The row is chosen by the owner beforehand, so the test
-- does not depend on the queue being non-empty.
reset role;

-- The id travels in a session setting rather than a temporary table, because
-- foundit_embed holds no privilege on any table — including one this suite
-- made — and current_setting is readable by anybody.
do $$
declare v_id bigint; v_statement text;
begin
  select tp.id, tp.statement into v_id, v_statement
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   order by tp.id
   limit 1;
  if v_id is null then
    perform pg_temp.fail('the seed has no published problem statements to embed');
  end if;
  perform set_config('foundit.test_problem_id', v_id::text, true);
  perform set_config('foundit.test_problem_statement', v_statement, true);
end
$$;

set role foundit_embed;

do $$
declare v_id bigint := current_setting('foundit.test_problem_id')::bigint;
begin

  if not public.store_problem_embedding(v_id, pg_temp.unit(9), public.embedding_model()) then
    perform pg_temp.fail('store_problem_embedding did not write the row it was given');
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

reset role;

-- It cannot be used to rewrite what a tool says it solves, and it recorded the
-- model it used.
do $$
declare r record;
begin
  select tp.statement, tp.embedding_model, t.slug into r
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id
   where tp.id = current_setting('foundit.test_problem_id')::bigint;
  if r.statement is distinct from current_setting('foundit.test_problem_statement') then
    perform pg_temp.fail('store_problem_embedding changed the statement it was embedding');
  end if;
  if r.embedding_model is distinct from public.embedding_model() then
    perform pg_temp.fail('store_problem_embedding did not record the model');
  end if;
end
$$;

-- After the job has run, embedded_at is not behind updated_at — which is what
-- makes a second run of scripts/embed.mjs embed nothing. Asked as the OWNER:
-- since 0007 the application role cannot read an embedding column at all, and
-- this question is about one.
do $$
declare n integer;
begin
  select count(*) into n
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   where tp.embedding is not null and tp.embedded_at < tp.updated_at;
  if n > 0 then
    perform pg_temp.fail(n || ' embedded statement(s) are already stale the moment they are '
                      || 'written, so the job would never converge');
  end if;

  select count(*) into n
    from public.tools t
   where t.status = 'published' and t.embedding is not null and t.embedded_at < t.updated_at;
  if n > 0 then
    perform pg_temp.fail(n || ' embedded summary/summaries are stale the moment they are written');
  end if;
end
$$;

-- ===========================================================================
-- 7. THE RELEVANCE FLOOR (0006), AND WHAT IT MUST NEVER DO.
--
--    0006 drops every result without evidence — close in meaning, carrying
--    every term, or named what was typed. A new filter next to the
--    constraints is the other classic way a WHERE clause goes wrong: evidence
--    that is judged over the WHOLE catalogue can let a tool the constraints
--    removed decide what survives. These checks build the worst case on
--    purpose — a paid tool with every kind of evidence at once — and insist
--    that "free" still means free, and that a page with nothing left is empty
--    rather than padded.
-- ===========================================================================

-- --- structural: the floor is a constant, not something a caller can pass --
do $$
declare r record; n integer;
begin
  select * into r from public.relevance_floor();
  if r.result_min is null or r.result_min <= 0 then
    perform pg_temp.fail('relevance_floor() has no per-result floor');
  end if;
  if r.gate_min < r.result_min then
    perform pg_temp.fail('the gate is below the per-result floor, so the gate does nothing');
  end if;
  if r.name_min is null or r.name_min <= 0 or r.name_min > 1 then
    perform pg_temp.fail('relevance_floor() has no sensible name threshold');
  end if;
  -- One stem is not evidence. "file", "app", "notes" each match a large part
  -- of the catalogue, and an all-terms match on one of them would open every
  -- page the floor exists to close.
  if r.min_all_terms_stems < 2 then
    perform pg_temp.fail('a one-stem all-terms match counts as evidence');
  end if;

  -- INPUT arguments only: proargnames also lists a table function's result
  -- columns (mode 't'), and query_vector_ranks' `clears_floor` is an answer,
  -- not something a caller can set.
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   cross join lateral unnest(p.proargnames, p.proargmodes::text[]) as a(arg, mode)
   where ns.nspname = 'public'
     and p.proname in ('search_tools', 'search_tools_impl', 'query_vector_ranks')
     and coalesce(a.mode, 'i') in ('i', 'b', 'v')
     and a.arg ~* '(floor|threshold|gate|min_sim)';
  if n > 0 then
    perform pg_temp.fail('search takes a floor or threshold argument; a caller could pass zero');
  end if;

  -- query_vector_ranks still returns no distance: its result columns are the
  -- id, the rank and one boolean.
  select count(*) into n
    from pg_proc p
   cross join lateral unnest(p.proargnames, p.proargmodes::text[]) as a(arg, mode)
   where p.oid = 'public.query_vector_ranks(text, halfvec, bigint[], int)'::regprocedure
     and a.mode = 't'
     and a.arg not in ('tool_id', 'rank_ix', 'clears_floor');
  if n > 0 then
    perform pg_temp.fail('query_vector_ranks returns something besides a rank and a verdict');
  end if;
end
$$;

-- A vector pointing a given share of the way along one axis and the rest along
-- another: cosine similarity to unit(p_a) is exactly p_w.
create or replace function pg_temp.mix(p_a int, p_w real, p_b int)
returns halfvec language sql immutable as $$
  select ('[' || string_agg(
            case when i = p_a then p_w::text
                 when i = p_b then sqrt(1 - p_w * p_w)::real::text
                 else '0' end, ',') || ']')::halfvec(512)
    from generate_series(0, 511) as i;
$$;

-- The same fixture, for the relevance floor: two listings whose vectors are chosen arithmetic rather than a model's output. The owner's window (0020 §2) is open for the two inserts and closed on the next line.
select pg_temp.owner_window(true);

do $$
declare v_paid bigint; v_near bigint; v_w real;
begin
  -- Half the per-result floor: a tool that is somewhat close in meaning and
  -- not close enough to show. Read from the function, so this test follows the
  -- thresholds wherever a later migration moves them.
  select f.result_min / 2 into v_w from public.relevance_floor() f;

  -- A paid tool with EVERY kind of evidence for 'zzfloor lantern': its name is
  -- what will be typed, its statement carries every term, and its vector is the
  -- query vector itself.
  insert into public.tools (slug, name, url, summary, pricing, status, published_at)
  values ('zz-floor-paid', 'Zzfloor Lantern', 'https://zz-floor-paid.example',
          'A paid tool that exists only inside this test transaction.',
          'paid', 'published', now())
  returning id into v_paid;

  -- A free tool that is only moderately close in meaning and shares no word.
  insert into public.tools (slug, name, url, summary, pricing, status, published_at)
  values ('zz-floor-near', 'Qwvbnm Kettle', 'https://zz-floor-near.example',
          'A free tool that exists only inside this test transaction.',
          'free', 'published', now())
  returning id into v_near;

  insert into public.tool_problems (tool_id, statement, embedding, embedding_model, embedded_at)
  values (v_paid, 'zzfloor lantern glows in the dark', pg_temp.unit(6),
          public.embedding_model(), now()),
         (v_near, 'qwvbnm unrelated kettle descaling', pg_temp.mix(6, v_w, 7),
          public.embedding_model(), now());
end
$$;
select pg_temp.owner_window(false);


set role foundit_app;

do $$
declare n integer; v_slugs text;
begin
  perform pg_temp.be(null);

  -- Premise: unconstrained, the paid tool is there — it is the query vector
  -- itself — and the half-close free one is NOT, because being on a page that
  -- has an answer is not the same as being one. If the first is missing the
  -- checks below would pass for the wrong reason.
  select string_agg(s.slug::text, ',' order by s.slug) into v_slugs
    from public.search_tools('zzfloor lantern', p_limit => 50,
                             p_embedding => pg_temp.unit(6)) s
   where s.slug::text in ('zz-floor-paid', 'zz-floor-near');
  if v_slugs is distinct from 'zz-floor-paid' then
    perform pg_temp.fail('premise: unconstrained, expected only zz-floor-paid, got '
                      || coalesce(v_slugs, '(neither)'));
  end if;

  -- THE ONE THAT MATTERS. Say free. The paid tool has every kind of evidence
  -- the floor accepts and must still be gone, at any rank.
  select count(*) into n
    from public.search_tools('zzfloor lantern',
           p_pricing   => array['free']::pricing_model[],
           p_limit     => 50,
           p_embedding => pg_temp.unit(6)) s
   where s.slug::text = 'zz-floor-paid';
  if n > 0 then
    perform pg_temp.fail('the relevance floor surfaced a paid tool for a query that said free');
  end if;

  -- And the half-close free tool is still not shown with the paid one gone:
  -- it shares no word and no name with the sentence, and its similarity is
  -- below the per-result floor, so it has no evidence of its own. A floor that
  -- let an excluded tool vouch for it, or that shrugged once the page was
  -- otherwise empty, would surface it here.
  select count(*) into n
    from public.search_tools('zzfloor lantern',
           p_pricing   => array['free']::pricing_model[],
           p_limit     => 50,
           p_embedding => pg_temp.unit(6)) s
   where s.slug::text = 'zz-floor-near';
  if n > 0 then
    perform pg_temp.fail('a tool below the per-result floor was shown to fill an empty page');
  end if;
end
$$;

-- --- the two lexical hatches, tightened by 0007 ---------------------------
do $$
declare n integer;
begin
  perform pg_temp.be(null);

  -- ONE STEM IS NOT EVIDENCE. "glows" matches every term of a sentence with
  -- one term, and the vector points elsewhere, so nothing here is evidence and
  -- the tool must not appear.
  select count(*) into n
    from public.search_tools('glows', p_limit => 50, p_embedding => pg_temp.unit(500)) s
   where s.slug::text = 'zz-floor-paid';
  if n > 0 then
    perform pg_temp.fail('a one-stem all-terms match opened the page: "file" and "app" would too');
  end if;

  -- Two stems, both present in the listing: that IS evidence, and the same
  -- tool comes back with the same orthogonal vector. Without this the check
  -- above would pass if the all-terms hatch were simply broken.
  select count(*) into n
    from public.search_tools('zzfloor glows', p_limit => 50, p_embedding => pg_temp.unit(500)) s
   where s.slug::text = 'zz-floor-paid';
  if n <> 1 then
    perform pg_temp.fail('an all-terms match on two stems is not evidence, so the hatch is shut');
  end if;

  -- THE HALF-REMEMBERED NAME, which is what the trigram leg is for. At the
  -- 0.50 this project shipped first, the leg's own cited example failed:
  -- "notin" against Notion is 0.44 and "signel" against Signal is 0.40.
  if similarity('Notion', 'notin') > 0.50 or similarity('Signal', 'signel') > 0.50 then
    perform pg_temp.fail('the trigram examples changed; re-derive the name threshold');
  end if;
  if similarity('Signal', 'signel') < (select f.name_min from public.relevance_floor() f) then
    perform pg_temp.fail('the name threshold is above the case the fuzzy leg exists for');
  end if;

  -- And behaviourally: a mistyped name finds the tool with a vector that
  -- points nowhere near it.
  select count(*) into n
    from public.search_tools('zzfloor lantren', p_limit => 50, p_embedding => pg_temp.unit(500)) s
   where s.slug::text = 'zz-floor-paid';
  if n <> 1 then
    perform pg_temp.fail('a mistyped name no longer finds its tool');
  end if;
end
$$;

-- A sentence nothing is close to, sharing no word with any listing, with a
-- vector pointing away from everything: the page is EMPTY. Before 0006 the
-- vector leg ranked every eligible tool and this returned fifty rows.
do $$
declare n integer;
begin
  perform pg_temp.be(null);
  select count(*) into n
    from public.search_tools('qqzzxx vvbbnn', p_limit => 50,
                             p_embedding => pg_temp.unit(500)) s;
  if n <> 0 then
    perform pg_temp.fail('a sentence with no evidence anywhere returned ' || n
                      || ' row(s); the floor is not filtering');
  end if;

  -- No vector, no floor: the same sentence searched without one is the Phase 2
  -- search, exactly as 0004 promised. It matches nothing lexically either, so
  -- the check here is that the flag says a vector was missing — the page then
  -- goes and gets one rather than accepting an empty answer it did not judge.
  select count(*) into n
    from public.search_tools('split expenses with friends while travelling abroad zzz') s
   where s.embedding_missing;
  if n = 0 then
    perform pg_temp.fail('an uncached sentence did not report its missing vector, so the floor '
                      || 'could not tell "judged empty" from "not judged"');
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
