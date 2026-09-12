-- ===========================================================================
-- Foundit — 0017_adding_a_tool
--
-- Phase 7. Until now nothing outside a migration has ever written the
-- catalogue: the 224 listings were seeded, the generated statements were
-- written by foundit_embed, and `foundit_app` held table-wide INSERT and
-- UPDATE on public.tools and public.tool_problems that nothing used. This is
-- the migration that makes those grants reachable, so it is also the migration
-- that has to make them narrow.
--
-- Nine sections, and the first three are the boundary:
--
--   1. Control characters, in one place. A statement, a name or a summary that
--      still carries C0, C1, U+2028 or U+2029 is refused by a CHECK, not by
--      the form.
--   2. public.tools: the table-wide INSERT and UPDATE are gone, replaced by
--      column lists. `submitted_by`, `owner_id`, `claimable`, `made_by_owner`,
--      the six counters and `published_at` are not in the UPDATE list, and the
--      four that are not in the INSERT list either are stamped by a trigger.
--   3. public.tool_problems: the application loses INSERT, UPDATE and DELETE
--      entirely. Every person-typed statement goes through ONE definer
--      function, which is what makes `source = 'user'` true by construction
--      rather than by the caller's good manners. Before this migration
--      foundit_app could have written a person's sentence and left `source` at
--      its default of 'seed'.
--
--   4. public.embedding_jobs — the queue that makes a new listing searchable
--      within a minute, filled by triggers so "re-queue only what changed" is
--      a property of the schema rather than something a server action
--      remembers. Drained by foundit_embed, which still holds no privilege on
--      any table.
--   5. public.claim_tool — one click, `claimable and owner_id is null` as its
--      whole precondition.
--   6. public.publish_tool — the only door from 'draft' to 'published',
--      because `published_at` is not in any grant the application holds.
--   7. public.ownership_changes and public.reassign_tool_owner — the recorded,
--      operator-only door that exists so "nobody takes a listing over" can be
--      a rule with one exception rather than a rule with a hole.
--   8. public.search_event_tools — which tools a search returned, and at what
--      rank, with no user column and no way to add one. Plus the maker's view
--      of it, which shows a sentence only once five separate searches have
--      typed it.
--   9. Grants, gathered in one place.
--
-- THE PRICE OF COLUMN PRIVILEGES, again: 0007 replaced foundit_app's
-- table-wide SELECT on public.tools and public.tool_problems with a generated
-- column list, and wrote down that a column added by a later migration has to
-- grant its own. This migration adds no column to either table, so there is
-- nothing to grant back — but it DOES take the table-wide INSERT and UPDATE
-- away in the same style, which means the same rule now applies in both
-- directions: a column added later is readable by nobody and writable by
-- nobody until a migration says otherwise. A missing grant fails loudly on
-- first use, which is the safe direction.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. Control characters, defined once
--
-- The submit flow takes free text from a stranger's keyboard and stores it,
-- and the characters that cause trouble are the invisible ones: a newline or a
-- U+2028 inside a problem statement forges a line in anything that treats one
-- statement per line, and lib/rerank.ts's candidate block is exactly that
-- shape. The reranker already JSON-encodes and strips on its way out
-- (0012, and the Phase 5 review that asked for it); this is the same guarantee
-- one layer down, where nothing can bypass it.
--
-- The class is built from chr() rather than written as a backslash escape, for
-- a small and specific reason: this file is edited by tools that mangle
-- backslash-u sequences, and a CHECK constraint whose pattern silently lost a
-- range is a CHECK that passes and protects nothing. chr() cannot be mistyped
-- into something that still parses.
--
-- chr(0) is deliberately absent: PostgreSQL cannot store a NUL in a text
-- value at all, so the range starts at chr(1) and is complete.
-- ===========================================================================
create or replace function public.control_character_class()
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  -- C0 (1..31), DEL and C1 (127..159), and the two Unicode separators that
  -- JavaScript used to treat as line terminators inside a string literal.
  select '[' || chr(1)    || '-' || chr(31)
             || chr(127)  || '-' || chr(159)
             || chr(8232) || chr(8233) || ']';
$fn$;

comment on function public.control_character_class() is
  'The one regex class this schema means by "a control character": C0, DEL, '
  'C1, U+2028 and U+2029. Built from chr() rather than backslash escapes so a '
  'mangled edit cannot leave a CHECK that parses and enforces less than it '
  'says. NUL is not in it because PostgreSQL cannot store one in a text value.';

create or replace function public.has_control_characters(p_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  select coalesce(p_text ~ public.control_character_class(), false);
$fn$;

create or replace function public.strip_control_characters(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  select btrim(regexp_replace(coalesce(p_text, ''),
                              public.control_character_class(), '', 'g'));
$fn$;

comment on function public.strip_control_characters(text) is
  'Remove every control character and trim. The writer of a person-typed '
  'string calls this; the CHECK constraints below refuse anything that still '
  'carries one, so the strip is a convenience and the CHECK is the guarantee.';

-- The guarantees. Added NOT VALID nowhere: every existing row is checked, and
-- if the seed ever carried a control character this migration is where we want
-- to find out.
alter table public.tools
  add constraint tools_name_is_clean
    check (not public.has_control_characters(name)),
  add constraint tools_summary_is_clean
    check (not public.has_control_characters(summary));

alter table public.tool_problems
  add constraint tool_problems_statement_is_clean
    check (not public.has_control_characters(statement));

comment on constraint tool_problems_statement_is_clean on public.tool_problems is
  'A problem statement carries no control character. This is the constraint '
  'that makes "a statement cannot forge a line in the reranker''s candidate '
  'block" a fact about the table rather than about lib/rerank.ts remembering '
  'to strip. It is checked again in lib/rerank.ts on the way out, because two '
  'layers is the point.';

-- ===========================================================================
-- 2. public.tools: what a person may write, column by column
--
-- WHAT WAS THERE. 0001 granted foundit_app table-wide INSERT and UPDATE on
-- public.tools for this phase. Table-wide means `owner_id`, `claimable`,
-- `made_by_owner`, all six counters and `published_at` — so the first signed-in
-- person to reach an UPDATE could have given themselves a listing, made their
-- own listing claimable, awarded it 4,000 likes, or published it without
-- passing through any of the checks below. Row-level security narrows WHICH
-- ROWS, never WHICH COLUMNS, and `tools_update using (tool_is_mine(id))` is
-- satisfied by the person's own draft.
--
-- WHAT IS THERE NOW. Two generated column lists, in 0007's and 0011's style:
--
--   INSERT  everything except the identity column, the generated columns, the
--           vector columns, and the seven a person may not decide about their
--           own listing (owner_id, claimable, made_by_owner, published_at and
--           the counters). `submitted_by` and `status` ARE insertable, because
--           the insert policy is what makes them honest: submitted_by must be
--           you, and status must be 'draft'.
--   UPDATE  the eight fields the EditListing artboard actually edits. Not
--           `submitted_by` (who added this never changes), not `status` or
--           `published_at` (publish_tool, section 6), not `slug` or `url` (the
--           listing's public identity, and `url` is the unique key the
--           duplicate message reads), and none of the seven above.
-- ===========================================================================
do $$
declare
  v_insert text;
  v_update text;
  -- Nobody's to decide from the application role, on insert or update.
  c_never constant text[] := array[
    'owner_id', 'claimable', 'made_by_owner', 'published_at',
    'like_count', 'save_count', 'open_count',
    'review_count', 'rating_sum', 'rating_count',
    -- 0004/0007's vector columns. foundit_app cannot read these (0007) and has
    -- never been able to write them through a function; it must not be able to
    -- write them through a column grant either, which is the hole 0011 closed
    -- on tool_problems and this closes on tools.
    'embedding', 'embedding_model', 'embedded_at',
    -- The identity column: an INSERT cannot supply it anyway.
    'id'
  ];
  -- Additionally not editable once the row exists.
  c_insert_only constant text[] := array['slug', 'url', 'submitted_by', 'status'];
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_insert
    from pg_attribute a
   where a.attrelid = 'public.tools'::regclass
     and a.attnum > 0
     and not a.attisdropped
     -- `search_doc` and `rating_avg` are generated: PostgreSQL refuses INSERT
     -- and UPDATE privileges on a generated column, so naming one here would
     -- make this statement fail rather than make it stricter.
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

-- --- a listing somebody says they made is never claimable -------------------
--
-- The rule is docs/product-decisions.md §3: "Claiming applies only to listings
-- we seeded at launch", and "whoever adds a tool maintains it. Nobody can take
-- a listing over." Until now that was a default (`claimable boolean not null
-- default false`) and a seed file's good behaviour. A default is not a rule.
--
-- The invariant is written against `made_by_owner` rather than against
-- `submitted_by`, because the seeded rows DO have a submitter — they were
-- inserted as dev_admin — and what actually separates the two populations is
-- the tick. Every seeded row has made_by_owner = false and claimable = true;
-- every person-added row has made_by_owner = true, stamped by the trigger
-- below, and is therefore refused claimable by this CHECK.
alter table public.tools
  add constraint tools_made_by_owner_is_not_claimable
    check (not (claimable and made_by_owner));

comment on constraint tools_made_by_owner_is_not_claimable on public.tools is
  'Only listings we seeded may be claimed. A row whose submitter ticked "Yes, '
  'I made this tool" carries made_by_owner = true — stamped by '
  'public.tools_stamp_submission, not by the caller — and this CHECK refuses '
  'to let it be claimable. That is what makes a claim on a person-added '
  'listing refused AT THE DATABASE rather than merely not offered by the page.';

-- --- and the four columns a person's insert does not get to choose ----------
--
-- The trigger fires only for a row a SIGNED-IN PERSON is inserting as
-- themselves. The seed and the migrations run with no request claim, so
-- `auth.uid()` is null there and this does nothing at all to them — which is
-- what lets db/seed/dev_seed.sql keep inserting claimable rows with
-- made_by_owner = false.
--
-- made_by_owner is TRUE and not a choice, because in this version there is no
-- other kind of submission: docs/product-decisions.md §3, "users may only add
-- tools they made themselves", and the flow's first step is a required tick.
-- The tick is checked in the HTML, again in the server action, and here it
-- stops being a check and becomes the only thing the column can hold.
create or replace function public.tools_stamp_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.submitted_by is distinct from auth.uid() then
    return new;
  end if;

  new.made_by_owner := true;
  new.claimable     := false;
  new.owner_id      := coalesce(new.owner_id, new.submitted_by);
  new.published_at  := null;
  new.like_count    := 0;
  new.save_count    := 0;
  new.open_count    := 0;
  new.review_count  := 0;
  new.rating_sum    := 0;
  new.rating_count  := 0;
  return new;
end;
$$;

comment on function public.tools_stamp_submission() is
  'BEFORE INSERT on public.tools, for a row a signed-in person is adding as '
  'themselves: made_by_owner true, claimable false, owner_id the submitter, '
  'published_at null and every counter zero. Whatever the caller passed for '
  'those is discarded unread, which is the same shape of guarantee '
  'public.search_events_normalize() gives query_hash (0003). Does nothing when '
  'auth.uid() is null, so the seed and the migrations are unaffected.';

create trigger tools_stamp_submission
  before insert on public.tools
  for each row execute function public.tools_stamp_submission();

-- --- a person adds a DRAFT, and nothing else -------------------------------
-- 0001's policy is replaced rather than edited: 0001 has run, and a migration
-- that changes after it ran is a migration nobody can reason about.
drop policy tools_insert on public.tools;
create policy tools_insert on public.tools for insert
  with check (auth.uid() is not null
              and submitted_by = auth.uid()
              and status = 'draft');

comment on policy tools_insert on public.tools is
  'You may add a listing, credited to yourself, and it arrives as a draft. '
  'Publishing is public.publish_tool and nothing else, because `published_at` '
  'is in no grant the application role holds and `tools_published_has_date` '
  'refuses a published row without one.';

-- ===========================================================================
-- 3. public.tool_problems: one door for a person-typed statement
--
-- WHAT WAS THERE. 0011 took `source`, `generated_model`, `verified_model` and
-- `embedding` out of foundit_app's column list, so the application could not
-- forge a statement's provenance or plant a vector. What it left was INSERT,
-- UPDATE and DELETE on the remaining columns — including `statement` — with
-- `source` defaulting to 'seed'. So the first version of this phase's submit
-- flow would have written a stranger's sentence into the catalogue recorded as
-- something we wrote by hand, and 0011's carefully corrected comment on
-- `source` would have been wrong again, one row at a time.
--
-- WHAT IS THERE NOW. The application holds no write privilege on this table at
-- all. `public.set_owner_statements` is the whole door, `source = 'user'` is
-- not a parameter of it, and the function is the only thing that can reach the
-- column — exactly the arrangement 0011 describes for 'generated'.
-- ===========================================================================
revoke insert, update, delete on public.tool_problems from foundit_app;

-- How many typed statements one listing may carry. A number in the database,
-- beside public.statements_wanted() (0010, which is the GENERATOR's ceiling of
-- 4 and a different thing), so the form and the setter cannot disagree.
create or replace function public.statements_max()
returns int
language sql
immutable
set search_path = ''
as $fn$
  select 8;
$fn$;

comment on function public.statements_max() is
  'The most problem statements one listing may carry: 8. '
  'public.statements_wanted() is the number the GENERATOR fills a thin listing '
  'up to (4) and is deliberately lower — a maker who has eight real sentences '
  'about their own tool knows more about it than the generator does, and the '
  'generator refuses a tool that already has four.';

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
  v_clean  text[] := '{}';
  v_one    text;
  v_added  int := 0;
  v_removed int := 0;
  v_kept   int := 0;
  v_next   int;
begin
  -- The authorization, said once, here. A definer function runs as the schema
  -- owner, which is a superuser and therefore bypasses row-level security, so
  -- this is not belt and braces: it is the only thing between a signed-in
  -- stranger and somebody else's listing.
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

  -- Gone: everything this listing carries that the person did not type back.
  -- A seeded or generated statement an owner removed is removed; it is their
  -- listing, and the alternative is a maker who cannot take down a sentence a
  -- model wrote about their own tool.
  with dead as (
    delete from public.tool_problems tp
     where tp.tool_id = p_tool_id
       and not (tp.statement = any (v_clean))
    returning 1
  )
  select count(*)::int into v_removed from dead;

  -- Unchanged rows are NOT rewritten, and that is the whole of "an edit
  -- re-queues the embeddings that changed and nothing else": a row nobody
  -- touched keeps its embedding, its embedded_at and its source, so the
  -- trigger in section 4 never sees it.
  select count(*)::int into v_kept
    from public.tool_problems tp
   where tp.tool_id = p_tool_id
     and tp.statement = any (v_clean);

  select coalesce(max(tp.sort_order), -1) + 1 into v_next
    from public.tool_problems tp where tp.tool_id = p_tool_id;

  -- `source` is not a parameter. A row written through this door is a
  -- person-typed row by construction, which is the property 0011 asked for and
  -- could not have while the application held the column.
  foreach v_one in array v_clean loop
    insert into public.tool_problems (tool_id, statement, sort_order, source)
    values (p_tool_id, v_one, v_next::smallint, 'user')
    on conflict (tool_id, statement) do nothing;
    if found then
      v_added := v_added + 1;
      v_next := v_next + 1;
    end if;
  end loop;

  return query select v_added, v_removed, v_kept;
end;
$fn$;

comment on function public.set_owner_statements(bigint, text[]) is
  'Replace one listing''s problem statements with what its maintainer typed. '
  'The ONLY way a person-typed statement reaches public.tool_problems: since '
  '0017 the application role holds no INSERT, UPDATE or DELETE on that table '
  'at all. There is no `source` parameter, so a row written here is '
  'source = ''user'' by construction — the same guarantee 0011 gives '
  '''generated'' through store_generated_statement. Refuses a statement over '
  '200 characters or under 8, a set over public.statements_max(), and a '
  'listing that is not the caller''s (public.tool_is_mine, checked here '
  'because a definer function owned by a superuser bypasses row-level '
  'security). A statement whose text did not change is left alone, keeping its '
  'embedding and its provenance, which is what makes an edit re-queue only '
  'what changed.';

-- ===========================================================================
-- 4. The embedding queue
--
-- Phase 7's gate: a tool is "searchable within a minute, including its
-- embeddings". Before this there was no queue — scripts/embed.mjs read a work
-- PREDICATE (0005, 0007) and ran when somebody ran it, which is right for a
-- catalogue that changes in migrations and useless for one that changes when a
-- person presses Publish.
--
-- So: a table the publish path writes and the job drains.
--
-- WHY A TABLE AND NOT JUST THE PREDICATE. The predicate is still there and
-- still true, and a nightly sweep would still find everything. What the table
-- adds is the two things a minute needs: something to poll cheaply (an empty
-- table is one index probe, where the predicate is a scan of two tables), and
-- somewhere to record that a row FAILED, so one bad statement is skipped
-- rather than retried in a tight loop forever.
--
-- WHY TRIGGERS FILL IT. "Re-queue on edit only what changed" written in a
-- server action is a comment; written as a row-level trigger comparing OLD to
-- NEW it is arithmetic. It also means the queue cannot be bypassed — a psql
-- session, a future admin screen and the seed all fill it the same way.
-- ===========================================================================
create table public.embedding_jobs (
  id         bigint generated always as identity primary key,
  kind       text   not null check (kind in ('tool', 'problem')),
  ref_id     bigint not null,
  queued_at  timestamptz not null default now(),
  attempts   smallint not null default 0 check (attempts >= 0),
  failed_at  timestamptz,
  last_error text check (length(last_error) <= 500),
  -- One outstanding job per thing. A statement edited three times in a minute
  -- is embedded once, with its latest text.
  constraint embedding_jobs_one_per_ref unique (kind, ref_id)
);

-- The queue the worker reads: everything not parked. Tiny partial index.
create index embedding_jobs_live on public.embedding_jobs (id)
  where failed_at is null;

comment on table public.embedding_jobs is
  'What still needs a vector. Filled by triggers on public.tools and '
  'public.tool_problems, drained by scripts/embed-worker.mjs as foundit_embed. '
  'Row-level security is enabled and forced and there is NO POLICY ON IT AT '
  'ALL: every read and write goes through a SECURITY DEFINER function, '
  'foundit_app holds no grant on the table, and foundit_embed holds no grant '
  'on it either — it calls public.embedding_work, public.embedding_job_done '
  'and public.embedding_job_failed and cannot ask this table anything '
  'directly. It holds an id and a kind and no text, so it is not a second copy '
  'of the catalogue.';

alter table public.embedding_jobs enable row level security;
alter table public.embedding_jobs force row level security;

create or replace function public.queue_embedding(p_kind text, p_ref_id bigint)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  insert into public.embedding_jobs (kind, ref_id)
  values (p_kind, p_ref_id)
  on conflict (kind, ref_id) do update
    set queued_at  = now(),
        -- A thing that changed again is live work again, whatever happened to
        -- the last attempt. Otherwise one bad statement, once fixed by its
        -- owner, would stay parked forever.
        attempts   = 0,
        failed_at  = null,
        last_error = null;
$fn$;

comment on function public.queue_embedding(text, bigint) is
  'Queue one thing for embedding, or move an existing job back to the front '
  'and un-park it. Called by the two triggers below and by '
  'public.publish_tool; granted to no role, because nothing outside this '
  'schema has any business filling the queue directly.';

-- --- a published tool's summary --------------------------------------------
create or replace function public.tools_queue_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only published rows are searchable, so only published rows are work.
  -- 0005 §4 and 0007 both put `status = 'published'` in the work queue for the
  -- same reason, and public.query_vector_ranks refuses an unpublished tool
  -- whatever anybody passes it.
  if new.status <> 'published' then
    return null;
  end if;

  -- Newly published, or the summary changed, or it has no vector. Nothing else
  -- about a listing is embedded, so nothing else re-queues it: a maker fixing
  -- a typo in the name, adding a platform or gaining a like costs no tokens.
  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.summary is distinct from new.summary
     or new.embedding is null then
    perform public.queue_embedding('tool', new.id);

    -- Becoming published is also when every statement on it becomes work: a
    -- draft's statements were deliberately not queued, because
    -- public.problem_embedding_work has always excluded them.
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      perform public.queue_embedding('problem', tp.id)
         from public.tool_problems tp
        where tp.tool_id = new.id
          and (tp.embedding is null or tp.embedded_at < tp.updated_at);
    end if;
  end if;

  return null;
end;
$$;

create trigger tools_queue_embedding
  after insert or update on public.tools
  for each row execute function public.tools_queue_embedding();

-- --- and each of its problem statements ------------------------------------
create or replace function public.tool_problems_queue_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published boolean;
begin
  if tg_op <> 'INSERT' and old.statement is not distinct from new.statement then
    -- A sort order changed, or a vector was just written. Neither is work.
    return null;
  end if;

  select t.status = 'published' into v_published
    from public.tools t where t.id = new.tool_id;

  if coalesce(v_published, false) then
    perform public.queue_embedding('problem', new.id);
  end if;
  return null;
end;
$$;

create trigger tool_problems_queue_embedding
  after insert or update on public.tool_problems
  for each row execute function public.tool_problems_queue_embedding();

-- --- the worker's three doors ----------------------------------------------
--
-- Same arrangement as 0005 and 0007: foundit_embed holds no privilege on any
-- table, reads what to do through a function that returns exactly the columns
-- it uses, and cannot ask for a third.
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
           when 'problem' then tp.statement
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
  'row has since been deleted, or whose tool has been unpublished, comes back '
  'with a null body; the worker retires it rather than embedding nothing, '
  'which is one of the two "bad row" cases it has to survive.';

create or replace function public.embedding_job_done(p_job_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare v_gone boolean;
begin
  delete from public.embedding_jobs where id = p_job_id;
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$fn$;

comment on function public.embedding_job_done(bigint) is
  'Retire one job. Called after the vector has been stored — or when the body '
  'came back null, because a job for a row that no longer exists is finished '
  'rather than failed.';

create or replace function public.embedding_job_failed(
  p_job_id bigint,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  -- Two more goes, then park it. The number is small on purpose: a statement
  -- the provider refuses is not going to start working, and a queue that
  -- retries forever is a queue that spends money forever.
  c_tries constant int := 3;
  v_left  boolean;
begin
  update public.embedding_jobs
     set attempts   = attempts + 1,
         -- The reason is stripped and capped: it comes from a provider's
         -- error body, which is not ours and is not trusted.
         last_error = left(public.strip_control_characters(p_reason), 500),
         failed_at  = case when attempts + 1 >= c_tries then now() else null end
   where id = p_job_id;

  get diagnostics v_left = row_count;
  return v_left;
end;
$fn$;

comment on function public.embedding_job_failed(bigint, text) is
  'Record that one job failed, and park it after three attempts. The row stays '
  'so an operator can see what did not embed; public.queue_embedding un-parks '
  'it the moment the text changes again. This is what lets the worker survive '
  'a bad row: log it, mark it, carry on with the other thirty-one.';

-- ===========================================================================
-- 5. Claiming a seeded listing
--
-- docs/product-decisions.md §3: one click, no verification, and only for
-- listings we seeded. The precondition is the whole of it —
-- `claimable and owner_id is null` — and it is checked under a row lock,
-- because two people pressing the button at the same instant is exactly the
-- race this function exists to lose safely.
--
-- The evidence link is stored and never fetched. `tool_claims.evidence_url`
-- has carried a `^https://` CHECK since 0001; this repeats it here so the
-- refusal names the field rather than the constraint, and so nothing gets to
-- rely on a CHECK it did not write. docs/product-decisions.md §12 draws the
-- line this sits on: a browser opening a link is not our server fetching one,
-- and nothing in this codebase fetches anything a stranger typed.
-- ===========================================================================
create or replace function public.claim_tool(
  p_tool_id      bigint,
  p_evidence_url text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_me        text := auth.uid();
  v_slug      text;
  v_claimable boolean;
  v_owned     boolean;
  v_evidence  text := nullif(btrim(coalesce(p_evidence_url, '')), '');
begin
  if v_me is null then
    raise exception 'only a signed-in person can claim a listing'
      using errcode = '42501';
  end if;

  if v_evidence is not null then
    v_evidence := public.strip_control_characters(v_evidence);
    if v_evidence !~ '^https://' then
      raise exception 'an evidence link must begin with https://'
        using errcode = '22023',
              hint = 'It is stored as text and rendered as text. Nothing fetches it.';
    end if;
    if length(v_evidence) > 500 then
      raise exception 'an evidence link is at most 500 characters'
        using errcode = '22001';
    end if;
  end if;

  select t.slug::text, t.claimable, t.owner_id is not null
    into v_slug, v_claimable, v_owned
    from public.tools t
   where t.id = p_tool_id
     for update;

  if v_slug is null then
    raise exception 'no listing with id %', p_tool_id using errcode = '23503';
  end if;

  -- Two refusals, said apart, because they are different facts and a maker
  -- deserves to know which one they hit. Neither leaks anything a visitor
  -- cannot already read off the listing.
  if not v_claimable then
    raise exception 'that listing was added by the person who maintains it and cannot be claimed'
      using errcode = '42501',
            hint = 'Only the listings seeded at launch are claimable.';
  end if;
  if v_owned then
    raise exception 'that listing already has a maintainer'
      using errcode = '42501';
  end if;

  insert into public.tool_claims (tool_id, claimant_id, evidence_url, status)
  values (p_tool_id, v_me, v_evidence, 'approved');

  update public.tools set owner_id = v_me where id = p_tool_id;

  return v_slug;
end;
$fn$;

comment on function public.claim_tool(bigint, text) is
  'One click: record the claim as approved and set owner_id, for a listing '
  'that is `claimable` and has no owner. That pair, under a row lock, is the '
  'WHOLE precondition — docs/product-decisions.md §3 chose no verification on '
  'purpose. A second claim on an owned listing is refused, and a claim on a '
  'person-added listing is refused because '
  'tools_made_by_owner_is_not_claimable makes claimable false on every one of '
  'them. The optional evidence link is checked to be https, stripped, capped, '
  'stored and NEVER FETCHED. SECURITY DEFINER because `owner_id` is in no '
  'grant the application role holds and must not be.';

-- ===========================================================================
-- 6. Publishing
--
-- The only door from 'draft' to 'published'. It has to be a function rather
-- than an UPDATE, for a reason the schema already wrote down: `published_at`
-- is not in section 2's column list, and `tools_published_has_date` refuses a
-- published row without one. So the application cannot publish by hand even
-- if it forgets that it should not.
--
-- docs/product-decisions.md §5: nothing waits for approval. There is no queue
-- here, no reviewer and no approver — the row goes live in this statement, and
-- the triggers above put its vectors in the queue on the way out.
-- ===========================================================================
create or replace function public.publish_tool(p_tool_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_slug   text;
  v_status text;
  v_probs  int;
begin
  if not public.tool_is_mine(p_tool_id) then
    raise exception 'that listing is not yours to publish'
      using errcode = '42501';
  end if;

  select t.slug::text, t.status::text into v_slug, v_status
    from public.tools t where t.id = p_tool_id for update;

  if v_slug is null then
    raise exception 'no listing with id %', p_tool_id using errcode = '23503';
  end if;
  if v_status <> 'draft' then
    raise exception 'that listing is already %', v_status using errcode = '22023';
  end if;

  -- A listing with no problem statement is a listing search cannot find, and
  -- publishing one is the one outcome the submit flow must not allow: the
  -- catalogue's semantic unit is the statement (0001's comment on
  -- tool_problems), not the summary.
  select count(*)::int into v_probs
    from public.tool_problems tp where tp.tool_id = p_tool_id;
  if v_probs < 1 then
    raise exception 'a listing needs at least one problem statement before it goes live'
      using errcode = '22023';
  end if;

  update public.tools
     set status = 'published', published_at = now()
   where id = p_tool_id;

  return v_slug;
end;
$fn$;

comment on function public.publish_tool(bigint) is
  'Draft to published, now, with no approval queue — '
  'docs/product-decisions.md §5. Refuses a listing that is not the caller''s, '
  'one that is not a draft, and one with no problem statement. SECURITY '
  'DEFINER because `status` and `published_at` are in no grant the application '
  'role holds. The embedding queue is filled by the trigger on the UPDATE, not '
  'by this function remembering to.';

-- ===========================================================================
-- 7. Nobody takes a listing over — and the one recorded exception
--
-- The rule, from docs/product-decisions.md §3, is absolute in the schema: the
-- application role cannot write `owner_id` at all (section 2), so a person
-- cannot transfer their listing and cannot be given somebody else's. Two
-- doors write that column and both are here: public.claim_tool, which only
-- opens on a seeded listing with no owner, and this.
--
-- An operator still has to be able to fix a dispute — §3 says "disputes are
-- settled by hand" — and a power that exists and is not recorded is the one
-- that gets misused. So: a table with one writer, and the writer records who
-- did it, from whom, to whom and why.
--
-- WHO MAY CALL IT. Nobody in the application. EXECUTE is revoked from public
-- and granted to no role, which leaves foundit_owner — the migration role,
-- reached by an operator with a psql session and no web request. That is
-- deliberately inconvenient: docs/build-phases.md puts the admin dashboard in
-- Phase 8, and until a screen exists that can show WHO is asking, a
-- reassignment should cost somebody a terminal.
-- ===========================================================================
create table public.ownership_changes (
  id            bigint generated always as identity primary key,
  tool_id       bigint not null references public.tools(id) on delete cascade,
  -- Null when the listing had no maintainer; the foreign keys are ON DELETE
  -- SET NULL rather than CASCADE so closing an account does not erase the
  -- record that a listing changed hands.
  from_owner_id text references public.profiles(id) on delete set null,
  to_owner_id   text references public.profiles(id) on delete set null,
  -- Nullable, and it is the one column here that would rather not be: an
  -- admin who later closes their account must not take the record of what
  -- they did with them, and a NOT NULL column with ON DELETE SET NULL raises
  -- at deletion time instead. The function refuses a null actor on the way in,
  -- so a null here means "the account that did this is gone", which is a
  -- different and true statement.
  actor_id      text references public.profiles(id) on delete set null,
  reason        text not null check (length(btrim(reason)) between 8 and 500),
  created_at    timestamptz not null default now(),
  constraint ownership_changes_reason_is_clean
    check (not public.has_control_characters(reason))
  -- There is deliberately no `from <> to` CHECK. Both columns go null when the
  -- accounts close, which is an UPDATE, which re-checks the row — so a
  -- constraint that reads correctly would make closing an account fail two
  -- years later. The function refuses a no-op reassignment instead.
);

create index ownership_changes_by_tool on public.ownership_changes (tool_id, created_at desc);
create index ownership_changes_by_former_owner on public.ownership_changes (from_owner_id)
  where from_owner_id is not null;

comment on table public.ownership_changes is
  'Every time a listing changed hands other than by being claimed: who did it, '
  'from whom, to whom, and why. The ONLY writer is '
  'public.reassign_tool_owner, which is granted to no role at all — not '
  'foundit_app — so the row cannot be written from a web request. Readable by '
  'the former owner, the new owner and an admin, which is the point: a power '
  'used on somebody''s listing is visible to them.';

alter table public.ownership_changes enable row level security;
alter table public.ownership_changes force row level security;

create policy ownership_changes_read on public.ownership_changes for select
  using (from_owner_id = auth.uid()
         or to_owner_id = auth.uid()
         or auth.is_admin());

-- There is deliberately no INSERT, UPDATE or DELETE policy. Not a permissive
-- one with a hard predicate — none at all, which is the only way to say "no
-- row is writable through this table" and have it stay said.

create or replace function public.reassign_tool_owner(
  p_tool_id     bigint,
  p_to_owner_id text,
  p_actor_id    text,
  p_reason      text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_from   text;
  v_reason text := public.strip_control_characters(p_reason);
  v_id     bigint;
begin
  if p_actor_id is null
     or not coalesce((select p.is_admin from public.profiles p where p.id = p_actor_id), false) then
    raise exception 'only an admin can reassign a listing'
      using errcode = '42501';
  end if;
  if p_to_owner_id is null
     or not exists (select 1 from public.profiles p where p.id = p_to_owner_id) then
    raise exception 'no such person to hand it to' using errcode = '23503';
  end if;
  if length(v_reason) < 8 then
    raise exception 'a reassignment is recorded with a reason of at least 8 characters'
      using errcode = '22023';
  end if;

  select t.owner_id into v_from
    from public.tools t where t.id = p_tool_id for update;
  if not found then
    raise exception 'no listing with id %', p_tool_id using errcode = '23503';
  end if;
  if v_from is not distinct from p_to_owner_id then
    raise exception 'that listing already belongs to them' using errcode = '22023';
  end if;

  -- The record is written BEFORE the change, in the same transaction, so there
  -- is no ordering in which the listing moves and the row does not.
  insert into public.ownership_changes
    (tool_id, from_owner_id, to_owner_id, actor_id, reason)
  values (p_tool_id, v_from, p_to_owner_id, p_actor_id, v_reason)
  returning id into v_id;

  update public.tools set owner_id = p_to_owner_id where id = p_tool_id;

  return v_id;
end;
$fn$;

revoke execute on function public.reassign_tool_owner(bigint, text, text, text) from public;

comment on function public.reassign_tool_owner(bigint, text, text, text) is
  'Move a listing to a different maintainer, recording who, from whom, to whom '
  'and why in public.ownership_changes. EXECUTE IS GRANTED TO NO ROLE: not '
  'foundit_app, not foundit_embed, not foundit_auth. What is left is '
  'foundit_owner, which means an operator at a psql prompt — deliberately, '
  'because until Phase 8''s admin screens exist there is no web request that '
  'can prove who asked. The actor is a parameter rather than auth.uid() for '
  'the same reason, and it must name an admin.';

-- ===========================================================================
-- 8. Which tools a search returned
--
-- The maker dashboard's "searches that found you" needs the one join
-- public.search_events has never had: this event returned these tools, at
-- these ranks.
--
-- THE COLUMN THAT IS NOT HERE. There is no user column, no session column, no
-- IP column and no foreign key to anything that has one, and there never will
-- be. That is the same sentence 0001 wrote about search_events, 0005 wrote
-- about query_embeddings and 0010 wrote about query_reranks, and it is written
-- again because this is the first table to be joined TO search_events, which
-- is exactly when somebody notices that a user id here would make the
-- dashboard easier. It would also make every sentence anyone has typed
-- attributable to them, and "describe your problem" collects health, money and
-- relationship trouble. db/test/adding_a_tool_test.sql fails if a column
-- referencing public.profiles ever appears on this table.
--
-- WHY A DEFINER FUNCTION WRITES IT, when 0003 went out of its way not to add
-- one. 0003's reasoning holds — a definer function is an authorization bypass
-- wearing a helpful hat, and a BEFORE INSERT trigger reached the same
-- guarantee with no elevated code path. It does not reach THIS one. Writing a
-- child row needs the parent's id, and public.log_search_event returns no row
-- id ON PURPOSE: "an id handed back to the application is a correlation
-- handle". The choice is between handing the application every event id it
-- ever writes, or one function that inserts both sides and returns nothing.
-- The function is the smaller hole, and it is the whole reason this one exists.
-- ===========================================================================
create table public.search_event_tools (
  event_id bigint   not null references public.search_events(id) on delete cascade,
  tool_id  bigint   not null references public.tools(id) on delete cascade,
  rank     smallint not null check (rank between 1 and 200),
  primary key (event_id, tool_id)
);

create index search_event_tools_by_tool on public.search_event_tools (tool_id, event_id);

comment on table public.search_event_tools is
  'Which tools one search returned, and at what rank. NO USER COLUMN, no '
  'session column, no IP column, no foreign key to anything that has one, and '
  'there never will be one: this is the first table joined to '
  'public.search_events, which is precisely when a user id here starts looking '
  'convenient. It would make every typed sentence attributable to a person, '
  'which is the one thing that table exists to prevent. Written only by '
  'public.log_search_event_tools, which inserts the event and these rows '
  'together and returns nothing, so the event id never reaches the '
  'application.';

comment on column public.search_event_tools.rank is
  'Where this tool came on that page, 1 for the first result. For the maker '
  'dashboard''s "how well do I fit this search" bar, and for nothing else.';

alter table public.search_event_tools enable row level security;
alter table public.search_event_tools force row level security;

-- An admin may read the raw rows. Nobody else reads this table directly: a
-- maker reads public.maker_search_demand, which aggregates and withholds.
create policy search_event_tools_read on public.search_event_tools for select
  using (auth.is_admin());

create or replace function public.log_search_event_tools(
  p_query          text,
  p_result_count   int,
  p_top_score      real    default null,
  p_had_good_match boolean default false,
  p_latency_ms     int     default null,
  p_match_judged   boolean default false,
  p_tool_ids       bigint[] default null
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_event_id bigint;
begin
  insert into public.search_events
    (query_text, query_hash, result_count, top_score, had_good_match,
     latency_ms, match_judged)
  values
    (left(btrim(coalesce(p_query, '')), 200),
     -- Discarded and re-derived by public.search_events_normalize (0003); this
     -- placeholder only has to satisfy NOT NULL on the way in, exactly as
     -- public.log_search_event's does.
     '',
     least(greatest(coalesce(p_result_count, 0), 0), 32767)::smallint,
     p_top_score,
     coalesce(p_had_good_match, false) and coalesce(p_match_judged, false),
     case when p_latency_ms is null then null else greatest(p_latency_ms, 0) end,
     coalesce(p_match_judged, false))
  returning id into v_event_id;

  -- The id stays inside this function. `with ordinality` is the rank, so the
  -- caller cannot pass one that disagrees with the order it passed.
  insert into public.search_event_tools (event_id, tool_id, rank)
  select v_event_id, t.tool_id, t.ord::smallint
    from unnest(coalesce(p_tool_ids, '{}'::bigint[]))
         with ordinality as t(tool_id, ord)
   where t.ord <= 200
     -- A tool id that is not a published tool is dropped rather than raising:
     -- this runs after the response has gone out, and a listing unpublished
     -- between the search and the log must not turn a good page into an error
     -- nobody sees.
     and exists (select 1 from public.tools x
                  where x.id = t.tool_id and x.status = 'published')
  on conflict (event_id, tool_id) do nothing;
end;
$fn$;

comment on function public.log_search_event_tools(text, int, real, boolean, int, boolean, bigint[]) is
  'Record one search AND which tools it returned, in one statement, and return '
  'nothing. public.log_search_event still exists and still takes no tool ids; '
  'this is the same function with the join, and it returns void for the same '
  'reason that one does — the event id is a correlation handle and does not '
  'leave the database. Ranks come from `with ordinality` over the array the '
  'caller passed, so a caller cannot record a rank that disagrees with the '
  'order it reported.';

-- --- what a maker is allowed to see ----------------------------------------
--
-- The threshold is the whole privacy argument of the dashboard. A sentence one
-- person typed once, shown to a maker, is that person's problem shown to a
-- stranger — and "describe your problem" is where people type the thing they
-- have not told anyone. A sentence five DIFFERENT searches have typed is a
-- fact about demand.
--
-- Five is small, and it is chosen rather than derived: it is the smallest
-- number at which a sentence cannot be one person's session (the per-IP search
-- limiter allows 60 an hour, so one person CAN type the same sentence five
-- times — see the known weakness in docs/loop-progress.md, which says so
-- rather than pretending otherwise). Below it the maker gets the count and the
-- fit and no text, which is what the panel mostly needs anyway.
create or replace function public.maker_query_threshold()
returns int
language sql
immutable
set search_path = ''
as $fn$
  select 5;
$fn$;

comment on function public.maker_query_threshold() is
  'How many searches must have typed the same normalised sentence before a '
  'maker is shown the words: 5. Below it they see the count and the rank and '
  'no text. docs/product-decisions.md §19.';

create or replace function public.maker_search_demand(
  p_tool_id bigint,
  p_days    int default 30,
  p_limit   int default 10
)
returns table (
  query_text text,
  searches   bigint,
  best_rank  int,
  shown      boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select
    -- The withholding, in one CASE, in the database. A caller cannot ask for
    -- the text: it is null unless the count clears the threshold.
    case when count(*) >= public.maker_query_threshold()
         then min(e.query_text) end,
    count(*)::bigint,
    min(st.rank)::int,
    count(*) >= public.maker_query_threshold()
    from public.search_event_tools st
    join public.search_events e on e.id = st.event_id
   where public.tool_is_mine(p_tool_id)
     and st.tool_id = p_tool_id
     and e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   -- Grouped on the HASH, which 0003's trigger derives from the normalised
   -- text, so "Split a  BILL" and "split a bill" are one sentence here exactly
   -- as they are one bucket on the operator dashboard.
   group by e.query_hash
   order by count(*) desc, min(st.rank)
   limit greatest(coalesce(p_limit, 10), 1);
$fn$;

comment on function public.maker_search_demand(bigint, int, int) is
  'The "searches that found you" panel: one row per normalised sentence that '
  'returned this listing, with how many searches typed it and the best rank it '
  'reached. THE TEXT IS NULL below public.maker_query_threshold() searches, '
  'decided here rather than by the page, so there is no argument a caller can '
  'pass to see a sentence one person typed once. Returns nothing at all unless '
  'public.tool_is_mine — the predicate is in the WHERE clause, so an id that '
  'is not yours is an empty result rather than an error, which is this '
  'codebase''s rule about not distinguishing "not yours" from "not there".';

-- ===========================================================================
-- 9. Grants
--
-- Two audiences. The application gets the five functions a person's own
-- actions need; the embedding job gets the three the queue needs. Nothing gets
-- public.queue_embedding or public.reassign_tool_owner.
-- ===========================================================================
revoke all on public.embedding_jobs from public;
revoke all on public.search_event_tools from public;
revoke all on public.ownership_changes from public;

revoke execute on function public.control_character_class() from public;
revoke execute on function public.has_control_characters(text) from public;
revoke execute on function public.strip_control_characters(text) from public;
revoke execute on function public.statements_max() from public;
revoke execute on function public.set_owner_statements(bigint, text[]) from public;
revoke execute on function public.queue_embedding(text, bigint) from public;
revoke execute on function public.embedding_work(int) from public;
revoke execute on function public.embedding_job_done(bigint) from public;
revoke execute on function public.embedding_job_failed(bigint, text) from public;
revoke execute on function public.claim_tool(bigint, text) from public;
revoke execute on function public.publish_tool(bigint) from public;
revoke execute on function public.maker_query_threshold() from public;
revoke execute on function public.maker_search_demand(bigint, int, int) from public;
revoke execute on function
  public.log_search_event_tools(text, int, real, boolean, int, boolean, bigint[])
  from public;

-- The application: the submit flow, the claim, the edit, the dashboard, and
-- the search log that now also records which tools came back.
grant execute on function public.statements_max() to foundit_app;
grant execute on function public.set_owner_statements(bigint, text[]) to foundit_app;
grant execute on function public.claim_tool(bigint, text) to foundit_app;
grant execute on function public.publish_tool(bigint) to foundit_app;
grant execute on function public.maker_query_threshold() to foundit_app;
grant execute on function public.maker_search_demand(bigint, int, int) to foundit_app;
grant execute on function
  public.log_search_event_tools(text, int, real, boolean, int, boolean, bigint[])
  to foundit_app;
-- Read-only on the record of a change to its own listing. The policy decides
-- which rows; this decides that the verb is SELECT and nothing else.
grant select on public.ownership_changes to foundit_app;

-- SELECT only, so search_event_tools_read above is a live policy rather than
-- an unreachable one. What it lets through is an admin reading (event, tool,
-- rank) rows — which is Phase 8's operator dashboard, and which adds nothing
-- personal: an admin has been able to read public.search_events since 0001,
-- and this table carries no person either. A MAKER reading their own listing's
-- demand does NOT come through here; it comes through
-- public.maker_search_demand, which aggregates and withholds the text.
grant select on public.search_event_tools to foundit_app;

-- The app needs these two for the form's own validation messages, which have
-- to agree with the CHECK constraints exactly or a person is told their
-- statement is fine and then told it is not.
grant execute on function public.has_control_characters(text) to foundit_app;
grant execute on function public.strip_control_characters(text) to foundit_app;
grant execute on function public.control_character_class() to foundit_app;

-- The embedding job: the queue, and nothing else. Still no table grant
-- anywhere, still no access to the query cache, still no way to search.
grant execute on function public.embedding_work(int) to foundit_embed;
grant execute on function public.embedding_job_done(bigint) to foundit_embed;
grant execute on function public.embedding_job_failed(bigint, text) to foundit_embed;
grant execute on function public.strip_control_characters(text) to foundit_embed;
grant execute on function public.control_character_class() to foundit_embed;

-- And NOT these, said out loud because the gate asks for it and because a
-- grant nobody wrote is the one that appears by accident later:
--   * foundit_app gains nothing on public.tools.embedding, on
--     public.tool_problems.embedding, or on public.store_problem_embedding —
--     0005's oracle stays split.
--   * foundit_app gains nothing at all on public.embedding_jobs or
--     public.search_event_tools; both are reached through functions.
--   * foundit_embed gains no grant on any table, no execute on
--     public.query_vector_ranks, and nothing in auth_core.

commit;
