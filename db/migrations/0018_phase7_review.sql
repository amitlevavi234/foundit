-- ===========================================================================
-- Foundit — 0018_phase7_review
--
-- What the Phase 7 adversarial review found in the database half of the phase,
-- fixed. Nothing in 0017 is edited: it has run, and a migration that changes
-- after it ran is a migration nobody can reason about. Every correction below
-- is a new object or a `create or replace` over an existing one.
--
-- Nine sections, in the order the review's findings are numbered:
--
--   1. F3  `public.tool_is_mine` means MINE. The `auth.is_admin()` clause
--          comes out, so an admin can no longer read a maker's unpublished
--          draft or rewrite their listing through the application role.
--   2. F2  `public.url_key` and a generated column, so "one listing per
--          address" is about the address rather than about the exact bytes.
--   3. F11 `created_at`, `updated_at`, `links` and `logo_path` leave the
--          application's INSERT and UPDATE column lists.
--   4. F10 The control-character class gains the bidi and zero-width
--          controls, and the stripper replaces rather than deletes.
--   5. F5  `public.embedding_work` finally consults the join it added to
--          check that a statement's tool is published.
--   6. F9  `public.set_owner_statements` REUSES the row when a statement's
--          text changes, so `embedding_jobs_one_per_ref` collapses repeated
--          edits the way its comment always claimed.
--   7. F4  A ceiling on `public.embedding_jobs`, so a stopped worker cannot
--          become a disk problem.
--   8. F6  `public.maker_listing_metrics`, so "Searches matched" is read
--          through a definer function like the sentences beside it, rather
--          than through a policy that filters it to zero.
--   9. Grants, gathered in one place, as 0017 does.
--
-- THE ONE THING THIS MIGRATION DELIBERATELY DOES NOT DO. It does not give an
-- admin a recorded door to a listing's CONTENT. The supervisor's decision of
-- 12 September 2026 is that `tool_is_mine` means mine and that any admin power
-- over listing content is Phase 8's job, designed as `reassign_tool_owner`
-- was: a definer function with a recorded actor, a reason, and a screen that
-- can prove who is asking. docs/product-decisions.md §19 records that door as
-- one Phase 8 opens and this migration leaves shut.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. F3 — an admin is not a maker
--
-- `public.tool_is_mine` has carried `or auth.is_admin()` since 0001, and the
-- review found what that means now that a listing can be written from a web
-- request: through `foundit_app` and ordinary routes, an admin could read any
-- maker's unpublished draft, rename it, rewrite its summary, replace every
-- problem statement (recorded as `source = 'user'`, which is to say as the
-- maker's own words), re-categorise it and publish it — with nothing recorded
-- anywhere. `reassign_tool_owner` exists precisely because a power that is not
-- recorded is the one that gets misused; this was the same power over
-- everything on the row except the one column it guards.
--
-- SO THE FUNCTION IS NARROWED RATHER THAN ITS CALLERS PATCHED, and that is the
-- whole audit: every caller wanted this meaning.
--
--   tools_update                 (0001) an admin no longer edits somebody
--                                       else's listing
--   tool_categories_write        (0001) nor re-categorises it
--   tool_problems_write          (0001) nor rewrites its statements
--   public.set_owner_statements  (0017) the same, through the one door
--   public.publish_tool          (0017) nor publishes their draft
--   public.maker_search_demand   (0017) nor reads their demand panel; an
--                                       admin reads search_event_tools
--                                       directly under its own policy
--   MY_DRAFT_SQL, MY_LISTING_SQL (lib/tool-sql.ts) nor reads their draft
--
-- WHAT AN ADMIN KEEPS, unchanged and on purpose: `public.tool_is_visible`
-- still has its own `auth.is_admin()`, so an admin still READS a draft through
-- `tools_read` and `tool_problems_read`, which is what the operator dashboard
-- of Phase 8 is going to need. Reading is not writing, and 0001 wrote the two
-- functions apart for exactly this reason.
-- ===========================================================================
create or replace function public.tool_is_mine(p_tool_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tools t
     where t.id = p_tool_id
       and auth.uid() is not null
       and (t.owner_id = auth.uid()
            or (t.owner_id is null and t.submitted_by = auth.uid()))
  );
$$;

comment on function public.tool_is_mine(bigint) is
  'May this person edit this listing? Whoever added it maintains it, and an '
  'approved claim transfers that to the maker. THERE IS NO ADMIN CLAUSE, and '
  '0018 took the one 0001 had out: an admin is not a maker, and a power over '
  'somebody else''s listing that nothing records is the power that gets '
  'misused. public.tool_is_visible keeps its own admin clause, so an admin '
  'still READS a draft; this is the write meaning and it is narrow on '
  'purpose. Any admin power over a listing''s content is Phase 8''s recorded '
  'door — docs/product-decisions.md §19.';

-- ===========================================================================
-- 2. F2 — one listing per ADDRESS
--
-- `tools.url` is text with a case-sensitive UNIQUE and nothing normalises, so
-- `https://tabsplit.example`, `https://tabsplit.example/`,
-- `https://www.tabsplit.example`, `https://Tabsplit.example` and
-- `https://tabsplit.example?ref=1` were five listings of one page. The review
-- published one of them through the real flow to prove it.
--
-- THE RULE, written down here and in docs/product-decisions.md §19:
--
--   * the fragment is dropped              #anything is a place on a page
--   * the query is dropped                 ?ref=1 is a campaign, not a tool
--   * the scheme is lower-cased            HTTPS:// is https://
--   * the host is lower-cased              Tabsplit.example is tabsplit.example
--   * a leading `www.` is dropped          www.x.example is x.example
--   * a bare trailing slash, `/.` or `/./`
--     on an otherwise empty path is dropped
--   * EVERYTHING ELSE IS KEPT, path case included: /Pricing and /pricing are
--     two addresses, because on a case-sensitive server they are two pages.
--
-- Dropping the query is the one line of this that costs something, and it is
-- deliberate: a tracking parameter is the commonest way the same page arrives
-- twice, and a tool whose home page genuinely needs a query string is rare
-- enough to be a conversation. `tools.url` still holds the address AS TYPED
-- and that is what every screen renders, so nobody's link loses its
-- parameters — only the key that decides whether two rows are the same page.
-- ===========================================================================
create or replace function public.url_key(p_url text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_raw    text := btrim(coalesce(p_url, ''));
  v_scheme text;
  v_rest   text;
  v_auth   text;
  v_path   text;
  v_at     int;
begin
  if v_raw = '' then
    return '';
  end if;

  -- Neither the fragment nor the query says which page this is.
  v_raw := split_part(v_raw, '#', 1);
  v_raw := split_part(v_raw, '?', 1);

  v_at := position('://' in v_raw);
  if v_at = 0 then
    -- Not an absolute address. `tools_url_check` refuses it anyway; lowering
    -- it is the most this can honestly do.
    return lower(v_raw);
  end if;
  v_scheme := lower(left(v_raw, v_at - 1));
  v_rest   := substr(v_raw, v_at + 3);

  v_at := position('/' in v_rest);
  if v_at = 0 then
    v_auth := v_rest;
    v_path := '';
  else
    v_auth := left(v_rest, v_at - 1);
    v_path := substr(v_rest, v_at);
  end if;

  -- The authority is case-insensitive by the DNS spec; the path is not.
  v_auth := lower(v_auth);
  if left(v_auth, 4) = 'www.' then
    v_auth := substr(v_auth, 5);
  end if;

  if v_path in ('/', '/.', '/./') then
    v_path := '';
  end if;

  return v_scheme || '://' || v_auth || v_path;
end;
$fn$;

comment on function public.url_key(text) is
  'The address, as the catalogue decides whether two listings are the same '
  'page: fragment and query dropped, scheme and host lower-cased, a leading '
  '"www." dropped, a bare trailing slash on an empty path dropped. The path '
  'keeps its case because a case-sensitive server serves /Pricing and '
  '/pricing as two pages. IMMUTABLE because public.tools.url_key is a stored '
  'generated column over it; lib/submit.ts carries the same rule in '
  'JavaScript and tests/submit.test.mjs checks the two against each other '
  'through this function.';

-- A stored generated column rather than a normalising trigger, for the reason
-- 0001 chose generated columns for `search_doc` and `rating_avg`: a trigger is
-- something that can be forgotten by an INSERT that goes round it, and there
-- is no going round a generated column.
alter table public.tools
  add column url_key text generated always as (public.url_key(url)) stored;

comment on column public.tools.url_key is
  'public.url_key(url), stored. THE unique key for "one listing per address"; '
  '`url` is kept exactly as the maker typed it because that is what the page '
  'renders and what the outbound link opens. Not writable by anybody: '
  'PostgreSQL refuses INSERT and UPDATE privileges on a generated column, so '
  'the column lists in 0017 §2 and section 3 below exclude it by arithmetic '
  'rather than by remembering to.';

-- The 224 seeded rows already have 224 distinct keys; this fails loudly rather
-- than quietly if that ever stops being true.
create unique index tools_one_listing_per_address on public.tools (url_key);

comment on index public.tools_one_listing_per_address is
  'One listing per address, for real. `tools_url_key` — 0001''s UNIQUE on the '
  'raw `url` — is left in place: it is a strict subset of this one (two equal '
  'urls have equal keys) and it costs nothing, and removing a constraint a '
  'migration has already applied buys nothing either.';

-- ===========================================================================
-- 3. F11 — four more columns the application role does not write
--
-- `created_at` and `updated_at` are ordering keys — MY_LISTINGS_SQL orders on
-- `published_at`, and `updated_at` is drawn on the dashboard — and `links` and
-- `logo_path` are free-form columns nothing in the flow writes. None of the
-- four was reachable, because no statement in lib/ names them; 0017 §2's whole
-- argument is that the column list is the boundary rather than the statement
-- list, and these four were on the wrong side of it.
--
-- The lists are regenerated by the same arithmetic 0017 used rather than typed
-- out, so `url_key` above is excluded because it is generated and not because
-- anybody remembered it.
-- ===========================================================================
do $$
declare
  v_insert text;
  v_update text;
  c_never constant text[] := array[
    'owner_id', 'claimable', 'made_by_owner', 'published_at',
    'like_count', 'save_count', 'open_count',
    'review_count', 'rating_sum', 'rating_count',
    'embedding', 'embedding_model', 'embedded_at',
    'id',
    -- 0018. Two timestamps the database stamps, and two columns nothing
    -- writes: back-dating your own listing, or bumping it up an ordering, is
    -- not a thing a maker gets to do from a form.
    'created_at', 'updated_at', 'links', 'logo_path'
  ];
  c_insert_only constant text[] := array['slug', 'url', 'submitted_by', 'status'];
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_insert
    from pg_attribute a
   where a.attrelid = 'public.tools'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and not (a.attname = any (c_never));

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_update
    from pg_attribute a
   where a.attrelid = 'public.tools'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and not (a.attname = any (c_never))
     and not (a.attname = any (c_insert_only));

  execute 'revoke insert, update on public.tools from foundit_app';
  execute format('grant insert (%s) on public.tools to foundit_app', v_insert);
  execute format('grant update (%s) on public.tools to foundit_app', v_update);
end
$$;

-- The duplicate lookup reads it, so the application has to be able to name it
-- in a WHERE clause. SELECT and nothing else, and there is nothing else to
-- have: a generated column takes no INSERT or UPDATE privilege at all.
grant select (url_key) on public.tools to foundit_app;

-- ===========================================================================
-- 4. F10 — the invisible characters that are not controls
--
-- 0017's class is C0, DEL, C1, U+2028 and U+2029, which is exactly what the
-- gate and §19 name, and every one of them is stripped. A zero-width joiner
-- and a right-to-left override are neither, and they reached
-- `tool_problems.statement` — which is rendered as text on the tool page, in
-- results and on a maker's dashboard. U+202E visually reverses everything
-- after it, which is a display-spoofing primitive in a field strangers read.
--
-- So the class gains three ranges:
--
--   U+200B..U+200D  zero-width space, non-joiner, joiner
--   U+202A..U+202E  the bidi embedding and override controls
--   U+2066..U+2069  the bidi isolates
--
-- U+FEFF is deliberately absent: it is a zero-width no-break space in the
-- middle of a string and a byte-order mark at the front, and refusing a
-- pasted BOM outright would refuse a sentence somebody copied out of a text
-- file for a reason they cannot see. It is neither a joiner nor a direction
-- control, so it cannot do either of the things this class exists to stop.
--
-- AND THE STRIPPER NOW REPLACES RATHER THAN DELETES. 0017's removed, so
-- "line one" + LF + "CANDIDATE 9: ..." came out as `line oneCANDIDATE 9: ...`
-- — two words welded together — for any write that reached the function
-- directly rather than through lib/submit.ts's `cleanText`, which replaces
-- with a space. The two now agree: replace, collapse runs of whitespace, trim.
-- ===========================================================================
create or replace function public.control_character_class()
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  -- C0 (1..31), DEL and C1 (127..159), the two Unicode separators, the three
  -- zero-width joiners, the five bidi embedding/override controls and the four
  -- bidi isolates.
  select '[' || chr(1)    || '-' || chr(31)
             || chr(127)  || '-' || chr(159)
             || chr(8232) || chr(8233)
             || chr(8203) || '-' || chr(8205)
             || chr(8234) || '-' || chr(8238)
             || chr(8294) || '-' || chr(8297) || ']';
$fn$;

comment on function public.control_character_class() is
  'The one regex class this schema means by "a character that has no business '
  'in a person-typed string": C0, DEL, C1, U+2028 and U+2029 (0017), plus '
  'U+200B-U+200D, U+202A-U+202E and U+2066-U+2069 (0018, the Phase 7 review — '
  'a zero-width joiner and a right-to-left override are neither controls nor '
  'harmless in a field strangers read). Built from chr() rather than backslash '
  'escapes so a mangled edit cannot leave a CHECK that parses and enforces '
  'less than it says. NUL is not in it because PostgreSQL cannot store one in '
  'a text value.';

create or replace function public.strip_control_characters(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  -- REPLACE, then collapse, then trim — the same three steps, in the same
  -- order, as cleanText() in lib/submit.ts. Deleting instead welded the word
  -- before a newline to the word after it.
  select btrim(regexp_replace(
           regexp_replace(coalesce(p_text, ''),
                          public.control_character_class(), ' ', 'g'),
           '[[:space:]]+', ' ', 'g'));
$fn$;

comment on function public.strip_control_characters(text) is
  'Replace every character in public.control_character_class() with a space, '
  'collapse runs of whitespace, and trim — which is cleanText() in '
  'lib/submit.ts, step for step. 0017 REMOVED rather than replaced and welded '
  '"line one" to "CANDIDATE 9:" for any write that reached this function '
  'directly. The CHECK constraints remain the guarantee; this is the '
  'convenience that means a person rarely meets one.';

-- The class just grew, and PostgreSQL does not re-validate a CHECK when the
-- function behind it changes. Nothing in the catalogue carries one of the new
-- characters today; this is the statement that finds out rather than assuming,
-- and it fails the migration if it ever stops being true.
do $$
declare n bigint;
begin
  select count(*) into n from public.tools t
   where public.has_control_characters(t.name)
      or public.has_control_characters(t.summary);
  if n > 0 then
    raise exception
      'F10: % listing(s) carry a character the widened class now refuses; '
      'clean them before this migration runs', n;
  end if;

  select count(*) into n from public.tool_problems tp
   where public.has_control_characters(tp.statement);
  if n > 0 then
    raise exception
      'F10: % statement(s) carry a character the widened class now refuses', n;
  end if;

  select count(*) into n from public.ownership_changes oc
   where public.has_control_characters(oc.reason);
  if n > 0 then
    raise exception 'F10: % ownership reason(s) would now be refused', n;
  end if;
end
$$;

-- ===========================================================================
-- 5. F5 — `embedding_work` hands out nothing for an unpublished tool
--
-- 0017's function left-joined `pt` to check the parent tool is published and
-- then never consulted it. For `kind = 'tool'` the guard worked, because the
-- join on `t` carries it. For `kind = 'problem'` the body came back whatever
-- the statement said, even when the tool was a draft — so the worker spent a
-- request and wrote a vector onto a draft's statement, and the function's own
-- comment said the opposite.
--
-- The vector never made the draft findable (every route gates on
-- `status = 'published'`, and the review proved that separately and at
-- length). It was money spent on text nobody can search, and a comment that
-- said the case was handled.
-- ===========================================================================
create or replace function public.embedding_work(p_limit int default 32)
returns table (job_id bigint, kind text, ref_id bigint, body text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select j.id, j.kind, j.ref_id,
         case j.kind
           when 'tool'    then t.summary
           -- `pt` is the join that checks the statement's tool is published,
           -- and this is where it is finally consulted. Null body, and the
           -- worker retires the job without a call.
           when 'problem' then case when pt.id is not null then tp.statement end
         end
    from public.embedding_jobs j
    left join public.tools t
      on j.kind = 'tool' and t.id = j.ref_id and t.status = 'published'
    left join public.tool_problems tp
      on j.kind = 'problem' and tp.id = j.ref_id
    left join public.tools pt
      on j.kind = 'problem' and pt.id = tp.tool_id and pt.status = 'published'
   where j.failed_at is null
   order by j.id
   limit greatest(coalesce(p_limit, 32), 1);
$fn$;

comment on function public.embedding_work(int) is
  'The queue, as the worker sees it: a job id, what kind of thing it is, its '
  'id and the one string to embed. Four columns and there is no fifth to ask '
  'for — no tool id for a statement, no status, no timestamps. A job whose '
  'row has since been deleted, or whose tool is not published, comes back '
  'with a null body; the worker retires it rather than embedding nothing. '
  'THE UNPUBLISHED CASE IS 0018''s: 0017 joined `pt` to check exactly that '
  'and never read it, so a draft''s statement was handed out and embedded.';

-- ===========================================================================
-- 6. F9 — an edit is an UPDATE, so the one-job key can collapse it
--
-- `embedding_jobs_one_per_ref` is `unique (kind, ref_id)` and its comment says
-- "a statement edited three times in a minute is embedded once, with its
-- latest text". It could not: editing a statement DELETED its row and
-- INSERTED a new one, so `ref_id` changed every time and the key never fired
-- for the case it describes. Fifty edits of one sentence left fifty rows.
--
-- The money was bounded anyway — the 49 stale jobs point at deleted rows and
-- retire free — but the stated mechanism was not the one operating, and the
-- table had no ceiling at all.
--
-- SO AN EDIT REUSES THE ROW. The rule is the obvious one and it is written
-- down here because it is the only part of this function that is not:
--
--   the statements that are GOING, oldest first, are paired with the
--   statements that are ARRIVING, in the order the person typed them; each
--   pair is one UPDATE of the existing row's text.
--
-- Whatever is left over on either side is a DELETE or an INSERT, exactly as
-- before. A one-statement edit — which is what an edit almost always is — is
-- therefore one UPDATE of one row, one queue row, and the fiftieth edit
-- overwrites the same job.
--
-- AND THE REUSED ROW LOSES ITS VECTOR IN THE SAME STATEMENT. That is not
-- tidiness: a row whose text changed while its embedding did not is a listing
-- findable by words it no longer contains, and it would stay that way for as
-- long as the queue took to drain. Deleting and inserting never had that
-- problem, so reusing the row has to take the vector with it.
-- ===========================================================================
create or replace function public.set_owner_statements(
  p_tool_id    bigint,
  p_statements text[]
)
returns table (added int, removed int, kept int)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_clean   text[] := '{}';
  v_arriving text[] := '{}';
  v_going   bigint[] := '{}';
  v_one     text;
  v_added   int := 0;
  v_removed int := 0;
  v_kept    int := 0;
  v_reuse   int;
  i         int;
begin
  -- The authorization, said once, here. A definer function runs as the schema
  -- owner, which is a superuser and therefore bypasses row-level security, so
  -- this is not belt and braces: it is the only thing between a signed-in
  -- stranger and somebody else's listing. Since 0018 it is also the only thing
  -- between an ADMIN and somebody else's listing.
  if not public.tool_is_mine(p_tool_id) then
    raise exception 'that listing is not yours to edit'
      using errcode = '42501';
  end if;

  -- Strip, trim, drop the blanks, and keep the first of any duplicate so the
  -- order the person typed survives. The strip happens before the length
  -- check, so "200 characters" means 200 characters of text rather than 200
  -- characters of which some were invisible.
  foreach v_one in array coalesce(p_statements, '{}'::text[]) loop
    v_one := public.strip_control_characters(v_one);
    if v_one = '' then
      continue;
    end if;
    if length(v_one) > 200 then
      raise exception 'a problem statement is at most 200 characters; this one is %',
        length(v_one) using errcode = '22001';
    end if;
    if length(v_one) < 8 then
      raise exception 'a problem statement is at least 8 characters; this one is %',
        length(v_one) using errcode = '22023';
    end if;
    if not (v_one = any (v_clean)) then
      v_clean := v_clean || v_one;
    end if;
  end loop;

  if array_length(v_clean, 1) > public.statements_max() then
    raise exception 'a listing carries at most % problem statements; this one has %',
      public.statements_max(), array_length(v_clean, 1)
      using errcode = '23514';
  end if;

  -- Unchanged rows are NOT touched, and that is the whole of "an edit
  -- re-queues the embeddings that changed and nothing else": a row nobody
  -- rewrote keeps its embedding, its embedded_at and its source, so the
  -- trigger in 0017 §4 never sees it.
  select count(*)::int into v_kept
    from public.tool_problems tp
   where tp.tool_id = p_tool_id
     and tp.statement = any (v_clean);

  -- What is arriving, in the order it was typed.
  foreach v_one in array v_clean loop
    if not exists (select 1 from public.tool_problems tp
                    where tp.tool_id = p_tool_id and tp.statement = v_one) then
      v_arriving := v_arriving || v_one;
    end if;
  end loop;

  -- What is going, oldest position first. A seeded or generated statement an
  -- owner removed is removed; it is their listing, and the alternative is a
  -- maker who cannot take down a sentence a model wrote about their own tool.
  select coalesce(array_agg(tp.id order by tp.sort_order, tp.id), '{}'::bigint[])
    into v_going
    from public.tool_problems tp
   where tp.tool_id = p_tool_id
     and not (tp.statement = any (v_clean));

  v_removed := coalesce(array_length(v_going, 1), 0);
  v_added   := coalesce(array_length(v_arriving, 1), 0);
  v_reuse   := least(v_removed, v_added);

  -- 1. The rows nothing arrived to replace. Deleted FIRST, so step 2 cannot
  --    collide with one of them on tool_problems_unique_per_tool.
  if v_removed > v_reuse then
    delete from public.tool_problems tp
     where tp.id = any (v_going[v_reuse + 1 : v_removed]);
  end if;

  -- 2. The pairs. One UPDATE each, same id, so `embedding_jobs_one_per_ref`
  --    has something to collapse. `source` is not a parameter here either: a
  --    row rewritten through this door is a person-typed row by construction,
  --    whatever it used to be, so the generator's attribution goes with the
  --    text it described.
  for i in 1 .. v_reuse loop
    update public.tool_problems tp
       set statement       = v_arriving[i],
           source          = 'user',
           generated_model = null,
           verified_model  = null,
           -- The vector belonged to the OLD text. Leaving it would make the
           -- listing findable by words it no longer contains until the worker
           -- caught up.
           embedding       = null,
           embedding_model = null,
           embedded_at     = null
     where tp.id = v_going[i];
  end loop;

  -- 3. Whatever arrived with no row to reuse.
  for i in v_reuse + 1 .. v_added loop
    insert into public.tool_problems (tool_id, statement, sort_order, source)
    values (p_tool_id, v_arriving[i], 0::smallint, 'user')
    on conflict (tool_id, statement) do nothing;
  end loop;

  -- 4. The order the person typed. A sort-order-only change is not work —
  --    0017's trigger returns null for it — so this costs nothing, and the
  --    `is distinct from` keeps it from being an UPDATE at all where the row
  --    is already in the right place.
  for i in 1 .. coalesce(array_length(v_clean, 1), 0) loop
    update public.tool_problems tp
       set sort_order = (i - 1)::smallint
     where tp.tool_id = p_tool_id
       and tp.statement = v_clean[i]
       and tp.sort_order is distinct from (i - 1)::smallint;
  end loop;

  return query select v_added, v_removed, v_kept;
end;
$fn$;

comment on function public.set_owner_statements(bigint, text[]) is
  'Replace one listing''s problem statements with what its maintainer typed. '
  'The ONLY way a person-typed statement reaches public.tool_problems: since '
  '0017 the application role holds no INSERT, UPDATE or DELETE on that table '
  'at all. There is no `source` parameter, so a row written here is '
  'source = ''user'' by construction. Refuses a statement over 200 characters '
  'or under 8, a set over public.statements_max(), and a listing that is not '
  'the caller''s (public.tool_is_mine, checked here because a definer function '
  'owned by a superuser bypasses row-level security). A statement whose text '
  'did not change is left alone, keeping its embedding and its provenance. '
  'SINCE 0018 A CHANGED STATEMENT IS AN UPDATE OF THE EXISTING ROW rather '
  'than a delete and an insert, so `embedding_jobs_one_per_ref` collapses '
  'fifty edits of one sentence into one job — which is what its comment '
  'claimed and could not do while every edit minted a new id. The reused row '
  'loses its vector in the same statement, because a vector of the old text '
  'under the new text is a search that is wrong rather than merely stale.';

-- ===========================================================================
-- 7. F4 — a ceiling on the queue
--
-- With the worker stopped, `public.embedding_jobs` grew one row per edit with
-- nothing to stop it. Nothing in the flow limited edits either, which is fixed
-- in lib/rate-limit.ts; this is the other half, in the place a restart cannot
-- reach.
--
-- WHAT HAPPENS AT THE CEILING, and this is the part worth being precise about
-- because it is the part a person experiences: the edit is SAVED. The row is
-- written, the listing changes, the person is told nothing is wrong — because
-- nothing is. What is refused is the queue row, and the queue is an
-- optimisation rather than the record: `public.tool_embedding_work` and
-- `public.problem_embedding_work` (0005, 0007) are predicates over the whole
-- catalogue and still find everything, so `scripts/embed.mjs` picks up exactly
-- what the queue declined. Nothing is lost. A NOTICE says so, in the server
-- log, once per declined row.
--
-- An existing job being re-queued is never refused: it adds no row, and
-- refusing it would leave a parked job parked after its text was fixed.
-- ===========================================================================
create or replace function public.embedding_jobs_ceiling()
returns int
language sql
immutable
set search_path = ''
as $fn$
  select 5000;
$fn$;

comment on function public.embedding_jobs_ceiling() is
  'How many rows public.embedding_jobs may hold: 5,000, against a catalogue '
  'of 224 listings and 504 statements — about seven times everything there is '
  'to embed, so reaching it means something is wrong rather than busy. Past '
  'it, a NEW job is declined with a NOTICE and the change is still saved: the '
  'work predicates in 0005 and 0007 are the record, and the queue is the '
  'thing that makes it fast.';

create or replace function public.embedding_jobs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n bigint;
begin
  -- Re-queueing something already in the table adds no row, so it is never
  -- the thing that has to be refused.
  if exists (select 1 from public.embedding_jobs j
              where j.kind = new.kind and j.ref_id = new.ref_id) then
    return new;
  end if;

  select count(*) into n from public.embedding_jobs;
  if n >= public.embedding_jobs_ceiling() then
    raise notice
      'the embedding queue is at its ceiling of %; this change was saved and '
      'the next sweep of scripts/embed.mjs will embed it',
      public.embedding_jobs_ceiling();
    return null;
  end if;
  return new;
end;
$$;

create trigger embedding_jobs_guard
  before insert on public.embedding_jobs
  for each row execute function public.embedding_jobs_guard();

comment on function public.embedding_jobs_guard() is
  'BEFORE INSERT on public.embedding_jobs: past public.embedding_jobs_ceiling '
  'a NEW job is declined and the statement that caused it still commits. The '
  'trade is deliberate and is the one the Phase 7 review asked to be stated: '
  'the edit is saved, the re-embed is refused with a sentence in the log, and '
  'nothing is lost because the work predicates find it anyway.';

-- ===========================================================================
-- 8. F6 — "Searches matched" is the real number
--
-- `MY_LISTINGS_SQL` counted `public.search_event_tools` directly, and the only
-- SELECT policy on that table is `auth.is_admin()` — so for a maker the
-- subquery counted nothing and the dashboard said 0 above a panel listing the
-- sentences. Row-level security FILTERS, it does not refuse, which is the
-- exact defect class lib/maker.ts's own header says every write in that file
-- guards against, applied to a read.
--
-- So the count is read the way the text beside it is read: through a definer
-- function with `public.tool_is_mine` in its WHERE clause, so an id that is
-- not yours is a zero rather than an error.
-- ===========================================================================
create or replace function public.maker_listing_metrics(
  p_tool_id bigint,
  p_days    int default 30
)
returns table (matched_count bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select count(*)::bigint
    from public.search_event_tools st
    join public.search_events e on e.id = st.event_id
   where public.tool_is_mine(p_tool_id)
     and st.tool_id = p_tool_id
     and e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
$fn$;

comment on function public.maker_listing_metrics(bigint, int) is
  'How many searches returned this listing in the last p_days. The same rows '
  'public.maker_search_demand groups and withholds the text of, counted — so '
  'the number on the dashboard and the sum of the panel beneath it are the '
  'same arithmetic over the same rows, and db/test/adding_a_tool_test.sql §13 '
  'asserts they agree. A definer function because search_event_tools'' only '
  'SELECT policy is auth.is_admin(): a maker reading that table directly '
  'counts nothing at all, which is what the dashboard did. Zero for a listing '
  'that is not yours AND for one that does not exist, which is this '
  'codebase''s rule about not telling the two apart.';

-- ===========================================================================
-- 9. Grants
-- ===========================================================================
revoke execute on function public.url_key(text) from public;
revoke execute on function public.embedding_jobs_ceiling() from public;
revoke execute on function public.embedding_jobs_guard() from public;
revoke execute on function public.maker_listing_metrics(bigint, int) from public;

-- The application: the duplicate lookup reads the key, and the dashboard reads
-- the count.
grant execute on function public.url_key(text) to foundit_app;
grant execute on function public.maker_listing_metrics(bigint, int) to foundit_app;

-- And NOT these, said out loud for the reason 0017 §9 says it:
--   * nobody gains public.embedding_jobs_ceiling or public.embedding_jobs_guard
--     — the ceiling is the trigger's business and no caller's.
--   * foundit_embed gains nothing new at all. Its three functions are still
--     its three functions.
--   * nothing anywhere gains a write on public.tools.url_key: it is generated,
--     and PostgreSQL will not grant INSERT or UPDATE on one.

commit;
