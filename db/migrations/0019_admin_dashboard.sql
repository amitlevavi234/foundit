-- ===========================================================================
-- Foundit — 0019_admin_dashboard
--
-- The rules underneath the operator dashboard (docs/product-decisions.md §10).
-- Written before the screen, which is Phase 8's first non-negotiable, and
-- landing with db/test/admin_test.sql beside it.
--
-- WHAT IS HERE, in five parts:
--
--   1. infra.ops_events — the row Phase 9's backup, restore-test and update
--      jobs will write, and the reader the Backups and Server panel draws.
--      Nothing writes it yet and the panel says so in words.
--   2. profiles.last_seen_day — so "last seen" on the People panel is a fact
--      rather than "when they last edited their display name".
--   3. public.record_tool_open — the writer tools.open_count has never had
--      (docs/product-decisions.md §12).
--   4. The admin_* panel functions. One per panel, SECURITY DEFINER, each
--      beginning with its own auth.is_admin() check.
--   5. Grants.
--
-- THE ADMIN FUNCTIONS ARE A FAMILY, AND THE PREFIX IS LOAD-BEARING.
-- db/test/admin_test.sql enumerates `public.admin\_%` out of pg_proc rather
-- than naming them, and asserts of EVERY member that a signed-out claim, an
-- ordinary user's claim and a maker's claim all get 42501. A function added
-- later with the same prefix is therefore tested the day it is written, and
-- one added WITHOUT the check fails the suite rather than quietly answering.
--
-- THE ONE RULE THAT SHAPES EVERY BODY BELOW: SEARCH TEXT AND A PERSON ARE
-- NEVER JOINED. docs/product-decisions.md §10 — "the two are never joined, so
-- the dashboard can never become a record of what a named person went looking
-- for". The mechanism is that no function below mentions a table from both
-- lists, and db/test/admin_test.sql §2 reads pg_get_functiondef for every
-- admin_* function and fails if one ever does. The two lists, written here so
-- the test and the migration cannot drift apart:
--
--   SEARCH TABLES   public.search_events, public.search_event_tools,
--                   public.query_embeddings, public.query_readings,
--                   public.query_reranks   (the query_* family)
--   PEOPLE TABLES   public.profiles, public.profiles_public, auth_core.*,
--                   public.collections, public.collection_items,
--                   public.tool_likes, public.reviews,
--                   public.review_removals, public.tool_claims,
--                   public.ownership_changes
--
-- public.tools is on NEITHER list and is the hinge the dashboard turns on: a
-- listing is a public object, so "which listings has nothing ever matched"
-- (search side) and "which listings did this handle add" (people side) are
-- both answerable without the two ever meeting in one statement.
--
-- HOW OFTEN SEARCH TEXT IS SHOWN AT ALL. Deduplicated by query_hash and
-- counted, with NO threshold — a count of one is allowed for the operator
-- (§10), unlike the five a maker needs (§19, public.maker_query_threshold).
-- The operator is the data controller; a maker is a stranger. The sentence
-- still arrives with nothing beside it that could say whose it was, because
-- public.search_events has no such column and 0001, 0005, 0010 and 0017 each
-- say in turn that it never will.
-- ===========================================================================

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- 1. infra.ops_events — what the machine did, and whether it worked
--
-- Phase 9 runs the backup, the restore test and the unattended-update check on
-- the server, as foundit_owner. This is where each of them records that it
-- ran. NOTHING WRITES IT TODAY, and that is the point of building it now: the
-- panel that reads it can say "never recorded" honestly, in words, instead of
-- showing a 0 that looks like a measurement.
--
-- WHY infra AND NOT public, and why there is no row-level security on it.
-- Every table in public carries RLS, enabled and forced, and db/test/rls_test.
-- sql fails if one does not. This table cannot satisfy that honestly: it has
-- exactly one writer (the owner, from a cron job) and one reader (a definer
-- function), and a policy over it would have to say `true` for the owner —
-- which is the anti-pattern those tests exist to catch. So it goes where
-- infra.schema_migrations already lives, in a schema `db/apply.sh` revokes
-- from PUBLIC, and THE GRANT IS THE BOUNDARY. That is the same argument
-- db/test/accounts_test.sql §1 makes about auth_core, and admin_test.sql §5
-- reads it back the same way: foundit_app and foundit_embed hold no USAGE on
-- schema infra and no privilege on this table, so the only door is
-- public.admin_ops_events() below.
-- ===========================================================================
create table if not exists infra.ops_events (
  id     bigint generated always as identity primary key,
  kind   text        not null,
  ok     boolean     not null,
  detail text        check (length(detail) <= 500),
  at     timestamptz not null default now(),

  -- Three kinds, named. A fourth is a migration, deliberately: the panel draws
  -- one row per kind and a kind nothing draws is a fact nobody reads.
  constraint ops_events_kind_is_known
    check (kind in ('backup', 'restore_test', 'update_check'))
);

create index if not exists ops_events_recent on infra.ops_events (kind, at desc);

comment on table infra.ops_events is
  'One row per run of a machine job: a backup, a restore test, an unattended-'
  'update check. Written by infra.record_ops_event as foundit_owner and read '
  'by public.admin_ops_events; no application role can reach it directly, '
  'which is why it has no row-level security and lives outside public. '
  'Phase 9 writes the first row. Until then every kind reads as never '
  'recorded, and the dashboard says exactly that.';

comment on column infra.ops_events.ok is
  'Whether the run succeeded. A red row on the Backups panel outranks '
  'everything else on the page (docs/product-decisions.md §10), so this is a '
  'boolean and not a status string somebody has to interpret.';

comment on column infra.ops_events.detail is
  'One short sentence for a person: how many rows the restore counted, how '
  'large the dump was, which update was held back. Never a stack trace and '
  'never a path with a credential in it.';

-- The one door in. SECURITY DEFINER is belt and braces here — the caller is
-- the owner, who owns the table — but it means Phase 9's jobs name a function
-- rather than an INSERT, and a job that learns a new column later changes
-- here rather than in three cron scripts.
create or replace function infra.record_ops_event(
  p_kind   text,
  p_ok     boolean,
  p_detail text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, infra
as $fn$
begin
  insert into infra.ops_events (kind, ok, detail)
  values (p_kind, coalesce(p_ok, false), left(nullif(btrim(coalesce(p_detail, '')), ''), 500));
end;
$fn$;

comment on function infra.record_ops_event(text, boolean, text) is
  'Record that a machine job ran. Granted to foundit_owner and to nobody '
  'else: Phase 9''s jobs run on the server as the owner, the web application '
  'never runs one, and a dashboard that could write its own "last backup '
  'succeeded" row would be a dashboard nobody should believe.';

revoke all on function infra.record_ops_event(text, boolean, text) from public;
grant execute on function infra.record_ops_event(text, boolean, text) to foundit_owner;

-- ===========================================================================
-- 2. profiles.last_seen_day — a day, and only a day
--
-- §10's People panel wants "last seen". The two candidates already in the
-- schema are both wrong:
--
--   profiles.updated_at   moves when somebody edits their display name, which
--                         is "last changed their profile" wearing this
--                         column's name — the same category of mistake §17
--                         describes about had_good_match being result_count>0.
--   auth_core.session     has the truth and is out of reach: foundit_app holds
--                         nothing at all in auth_core (0013), and the whole
--                         point of that separation is that the application
--                         half cannot read the session half.
--
-- So: a DATE, bumped at most once a day, by the statement the application
-- already runs to find out who is asking (VIEWER_SQL, lib/account-sql.ts), so
-- it costs no extra round trip. A date rather than a timestamp on purpose —
-- the panel shows a day, and a to-the-second last-seen time is a surveillance
-- figure nobody on this dashboard needs.
--
-- foundit_app gets no UPDATE privilege on the column. 0015 named the three
-- writable columns and this is not a fourth; the writer is the definer
-- function below, which can only ever write current_date, and only ever onto
-- auth.uid()'s own row.
-- ===========================================================================
alter table public.profiles add column if not exists last_seen_day date;

comment on column public.profiles.last_seen_day is
  'The last day this person made a request the application knew them on. A '
  'DAY, never a time. Written only by public.note_seen_today(), which writes '
  'current_date onto auth.uid()''s own row and nothing else; foundit_app holds '
  'no UPDATE privilege on it (0015''s rule, applied to a new column). Read by '
  'the operator dashboard''s People panel, which shows public activity only.';

create or replace function public.note_seen_today()
returns date
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_day date;
begin
  if auth.uid() is null then
    return null;
  end if;

  -- At most one write per person per day. The WHERE is what makes that true
  -- rather than intended: on the second request of the day no row matches and
  -- the statement is a no-op, so profiles.updated_at does not move either.
  update public.profiles
     set last_seen_day = current_date
   where id = auth.uid()
     and (last_seen_day is null or last_seen_day < current_date)
  returning last_seen_day into v_day;

  if v_day is null then
    select p.last_seen_day into v_day from public.profiles p where p.id = auth.uid();
  end if;
  return v_day;
end;
$fn$;

comment on function public.note_seen_today() is
  'Stamp today onto the caller''s own profile, once a day, and answer the day '
  'that is now on it. Takes no argument and reads auth.uid(), so there is no '
  'id a caller could pass to stamp somebody else; writes current_date and '
  'nothing else, so there is no value a caller could choose.';

-- ===========================================================================
-- 3. public.record_tool_open — the writer tools.open_count has never had
--
-- docs/product-decisions.md §12 has said since 10 September that the click out
-- to a maker's site is counted. It was not: open_count was 0 on every listing
-- and the maker dashboard said so rather than drawing a plausible figure
-- (docs/loop-progress.md, Phase 7's known weaknesses). §12 permits the count
-- explicitly — "the count is recorded without attaching it to a person" — so
-- Phase 8 builds it rather than deleting the promise.
--
-- WHAT THIS FUNCTION CANNOT DO, by construction:
--
--   It takes a slug and nothing else. There is no visitor argument, no
--   session argument, no address argument, and no column on public.tools this
--   could be stored against even if one were passed.
--   It reads no setting: not auth.uid(), not request.share_token, nothing.
--   Two people opening the same listing are the same statement.
--   It writes one integer and returns nothing — not a row id, not a count.
--   An id handed back is a correlation handle (0017 §8) and there is nothing
--   for a caller to do with this one.
--   It logs nothing. A log line carrying a slug beside a timestamp, next to a
--   web server's access log carrying an address beside the same timestamp, is
--   the join this product does not make.
--
-- Published listings only, so a draft nobody can see cannot have its counter
-- moved by somebody guessing its slug.
--
-- WHAT IT DOES NOT BOUND. Nothing stops the same visitor pressing the link a
-- hundred times; open_count counts CLICKS and says so on the maker dashboard.
-- That is the same honesty §19 and docs/loop-progress.md apply to the
-- five-search threshold — it bounds events, not people — and it is written
-- down rather than dressed up.
-- ===========================================================================
create or replace function public.record_tool_open(p_slug citext)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
begin
  update public.tools
     set open_count = open_count + 1
   where slug = p_slug
     and status = 'published';
end;
$fn$;

comment on function public.record_tool_open(citext) is
  'Count one click on the link out to a maker''s site. One argument, and it '
  'is the listing: no visitor argument, no setting read, no row returned and '
  'nothing logged, so the number can never become a record of who went where. '
  'Published listings only. docs/product-decisions.md §12.';

-- ===========================================================================
-- 4. The panels
--
-- Every one of them is SECURITY DEFINER with a pinned search_path and opens
-- with the same three lines. The check is INSIDE the function rather than in a
-- policy on the tables, because most of these read several tables and a
-- dashboard assembled from six policies is six places to be wrong; and it
-- raises 42501 rather than returning nothing, because the caller of an
-- operator function is either the operator or a bug.
--
-- Compare public.maker_search_demand (0017 §8), which puts tool_is_mine in its
-- WHERE clause so that a listing which is not yours is an empty result rather
-- than an error. That is the right shape THERE — a maker may legitimately ask
-- about a slug that turns out not to be theirs, and telling "not yours" from
-- "not there" is an enumeration leak. It is the wrong shape here: these
-- functions take no id at all, so there is nothing to enumerate, and a
-- non-administrator calling one is not a near miss.
-- ===========================================================================

-- --- Demand ---------------------------------------------------------------
--
-- Searches per day, and of those, how many were judged and how many the
-- reranker judged and found nothing good.
--
-- THE NOTE THE PANEL CARRIES, from docs/product-decisions.md §17 as amended:
-- with the shown-threshold at relevance 2, every result on a JUDGED page is a
-- 2 or a 3 — so on a judged search "nothing good" now means the page was
-- empty. `match_judged` is what still separates the three states (nobody
-- looked / it was read and nothing fitted / it was read and something did),
-- and the middle one is this panel.
create or replace function public.admin_demand(p_days int default 30)
returns table (
  day          date,
  searches     bigint,
  judged       bigint,
  nothing_good bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    with days as (
      select generate_series(
               (current_date - (greatest(coalesce(p_days, 30), 1) - 1)),
               current_date,
               interval '1 day'
             )::date as d
    )
    select days.d,
           count(e.id)::bigint,
           count(e.id) filter (where e.match_judged)::bigint,
           count(e.id) filter (where e.match_judged and not e.had_good_match)::bigint
      from days
      left join public.search_events e
        on (e.created_at at time zone 'UTC')::date = days.d
     group by days.d
     order by days.d;
end;
$fn$;

comment on function public.admin_demand(int) is
  'Searches per day for the last p_days, with how many were judged and how '
  'many were judged and found nothing good. Days with no searches are zero '
  'rows counted, not missing rows: the absence IS the record. Reads '
  'public.search_events and nothing else — no table on the people list is '
  'named in this body, which is what db/test/admin_test.sql §2 asserts.';

-- The most valuable list on the page (§10): demand the catalogue cannot serve.
create or replace function public.admin_unmet_demand(
  p_days  int default 30,
  p_limit int default 50
)
returns table (
  query_text text,
  searches   bigint,
  last_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select min(e.query_text),
           count(*)::bigint,
           max(e.created_at)
      from public.search_events e
     where e.match_judged
       and not e.had_good_match
       and e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
     group by e.query_hash
     order by max(e.created_at) desc
     limit greatest(coalesce(p_limit, 50), 1);
end;
$fn$;

comment on function public.admin_unmet_demand(int, int) is
  'The sentences that were read and answered by nothing: grouped on '
  'query_hash — which 0003''s trigger derives from the normalised text, so '
  '"Split a  BILL" and "split a bill" are one row — counted, newest first. '
  'No threshold: a count of one is allowed for the operator '
  '(docs/product-decisions.md §10), unlike the five a maker needs (§19). The '
  'three columns are the sentence, a number and a time; there is no fourth, '
  'and nothing in public.search_events could have filled one.';

-- --- What people ask for ---------------------------------------------------
create or replace function public.admin_top_queries(
  p_days  int default 30,
  p_limit int default 25
)
returns table (
  query_text text,
  searches   bigint,
  last_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select min(e.query_text),
           count(*)::bigint,
           max(e.created_at)
      from public.search_events e
     where e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
     group by e.query_hash
     order by count(*) desc, max(e.created_at) desc
     limit greatest(coalesce(p_limit, 25), 1);
end;
$fn$;

comment on function public.admin_top_queries(int, int) is
  'The most frequent sentences over p_days, grouped on query_hash and '
  'counted. The same three columns as public.admin_unmet_demand and for the '
  'same reason: text without a name attached (docs/product-decisions.md §10).';

-- --- Catalogue -------------------------------------------------------------
--
-- Three functions rather than one, and the split is the privacy line rather
-- than taste: "which listings has nothing ever matched" has to read
-- public.search_event_tools, and "who added this listing" has to read
-- public.profiles. Neither body may name both, so neither body does.
create or replace function public.admin_catalogue_counts(p_days int default 7)
returns table (
  added             bigint,
  published         bigint,
  claims_made       bigint,
  ownership_changed bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select (select count(*) from public.tools t where t.created_at >= v_since)::bigint,
           (select count(*) from public.tools t
             where t.status = 'published' and t.published_at >= v_since)::bigint,
           (select count(*) from public.tool_claims c where c.created_at >= v_since)::bigint,
           (select count(*) from public.ownership_changes o where o.created_at >= v_since)::bigint;
end;
$fn$;

comment on function public.admin_catalogue_counts(int) is
  'Four numbers about the catalogue over p_days: listings added, listings '
  'published, claims made, owners changed. Counts only — 0015 took '
  'auth.is_admin() out of collections_read on exactly this reasoning, that '
  'the dashboard''s figures are numbers rather than somebody''s rows.';

create or replace function public.admin_catalogue_added(
  p_days  int default 7,
  p_limit int default 25
)
returns table (
  slug       text,
  name       text,
  handle     text,
  status     text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select t.slug::text,
           t.name,
           p.handle::text,
           t.status::text,
           t.created_at
      from public.tools t
      left join public.profiles p on p.id = coalesce(t.owner_id, t.submitted_by)
     where t.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
     order by t.created_at desc
     limit greatest(coalesce(p_limit, 25), 1);
end;
$fn$;

comment on function public.admin_catalogue_added(int, int) is
  'Listings added over p_days and the handle that added each. A HANDLE, which '
  'is already on the listing''s public page, and never an address — '
  'foundit_app holds nothing in auth_core and this function, running as the '
  'owner, still names no table there. No search table is named in this body.';

create or replace function public.admin_catalogue_unmatched(p_limit int default 25)
returns table (
  slug         text,
  name         text,
  published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select t.slug::text, t.name, t.published_at
      from public.tools t
     where t.status = 'published'
       and not exists (select 1 from public.search_event_tools st where st.tool_id = t.id)
     order by t.published_at nulls last, t.id
     limit greatest(coalesce(p_limit, 25), 1);
end;
$fn$;

comment on function public.admin_catalogue_unmatched(int) is
  'Published listings no search has ever returned. Reads public.tools and '
  'public.search_event_tools; NAMES NO PEOPLE TABLE, which is why the handle '
  'that added a listing is in public.admin_catalogue_added and not here. A '
  'listing is a public object, so asking the search side about one attaches '
  'nothing to anybody.';

-- --- People ----------------------------------------------------------------
create or replace function public.admin_signups(p_days int default 30)
returns table (day date, signups bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    with days as (
      select generate_series(
               (current_date - (greatest(coalesce(p_days, 30), 1) - 1)),
               current_date,
               interval '1 day'
             )::date as d
    )
    select days.d, count(p.id)::bigint
      from days
      left join public.profiles p
        on (p.created_at at time zone 'UTC')::date = days.d
     group by days.d
     order by days.d;
end;
$fn$;

comment on function public.admin_signups(int) is
  'Profiles created per day over p_days. A count of rows, with no handle and '
  'no address in the result at all.';

create or replace function public.admin_people(p_limit int default 50)
returns table (
  handle          text,
  tools_added     bigint,
  reviews_written bigint,
  likes_given     bigint,
  last_seen_day   date,
  joined_day      date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  -- THE COLUMN LIST IS THE WHOLE DESIGN OF THIS FUNCTION.
  -- docs/product-decisions.md §10: "Individual users are visible through what
  -- they did in public." Every figure below is on a page a stranger can
  -- already read — the listings they added, the reviews they wrote, the likes
  -- tool_likes_read has published since 0001 — except the two dates, which are
  -- a day each and no finer. LIKES ARE A COUNT AND NOT A LIST, and saved
  -- collections are absent entirely: 0015 took auth.is_admin() out of
  -- collections_read because a private list is the opposite of public
  -- activity, and a function here that read one would put it straight back.
  -- There is no address in this result and nowhere for one to come from: an
  -- address is kept in the authentication schema, which this body does not
  -- name and this function does not reach.
  return query
    select p.handle::text,
           (select count(*) from public.tools t
             where coalesce(t.owner_id, t.submitted_by) = p.id)::bigint,
           (select count(*) from public.reviews r
             where r.author_id = p.id and r.deleted_at is null)::bigint,
           (select count(*) from public.tool_likes l where l.user_id = p.id)::bigint,
           p.last_seen_day,
           (p.created_at at time zone 'UTC')::date
      from public.profiles p
     order by p.last_seen_day desc nulls last, p.created_at desc
     limit greatest(coalesce(p_limit, 50), 1);
end;
$fn$;

comment on function public.admin_people(int) is
  'Per handle, the PUBLIC counts: listings added, live reviews written, likes '
  'given as a number, the day last seen and the day they joined. No address, '
  'no saved list, no search. The handle is the only identifier and it is the '
  'one already printed on every review they wrote.';

-- --- Words -----------------------------------------------------------------
--
-- Reviews posted per day, and removals per day beside them. REPORTS ARE NOT
-- HERE and are not a zero: §5 says reports reach the team by email and are
-- never written down, so there is no table to count and the panel says that
-- sentence instead of drawing a 0 that would read as "nobody has reported
-- anything".
create or replace function public.admin_words(p_days int default 30)
returns table (day date, reviews bigint, removed bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    with days as (
      select generate_series(
               (current_date - (greatest(coalesce(p_days, 30), 1) - 1)),
               current_date,
               interval '1 day'
             )::date as d
    )
    select days.d,
           (select count(*) from public.reviews r
             where (r.created_at at time zone 'UTC')::date = days.d)::bigint,
           (select count(*) from public.review_removals rr
             where (rr.created_at at time zone 'UTC')::date = days.d)::bigint
      from days
     order by days.d;
end;
$fn$;

comment on function public.admin_words(int) is
  'Reviews written and reviews removed, per day, over p_days. Reports are '
  'deliberately absent: docs/product-decisions.md §5 sends them to an inbox '
  'and records nothing, so a number here would be a number nothing writes.';

-- --- Money -----------------------------------------------------------------
--
-- The model-call counters are in-process (lib/rate-limit.ts) and the dashboard
-- is rendered by the same Node process, so the page imports them; there is
-- nothing for the database to say about them. What the database knows is how
-- big it has got.
create or replace function public.admin_database_bytes()
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return pg_database_size(current_database());
end;
$fn$;

comment on function public.admin_database_bytes() is
  'How many bytes this database occupies. A definer function because '
  'pg_database_size needs CONNECT on the database and foundit_app should not '
  'be granted anything it does not need for a page; this way the one figure '
  'the Money panel wants costs no new privilege.';

-- --- Backups and Server ----------------------------------------------------
--
-- One row per KIND, always, whether or not anything has ever been recorded.
-- `recorded` is the column the page draws its sentence from: false means the
-- panel says "never recorded" in words, and the three other columns are null
-- rather than zero, so there is no way to render a plausible figure by
-- accident.
create or replace function public.admin_ops_events()
returns table (
  kind     text,
  recorded boolean,
  ok       boolean,
  detail   text,
  at       timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select k.kind,
           (last.id is not null),
           last.ok,
           last.detail,
           last.at
      from (values ('backup'), ('restore_test'), ('update_check')) as k(kind)
      left join lateral (
        select e.id, e.ok, e.detail, e.at
          from infra.ops_events e
         where e.kind = k.kind
         order by e.at desc, e.id desc
         limit 1
      ) as last on true
     order by k.kind;
end;
$fn$;

comment on function public.admin_ops_events() is
  'The last backup, the last restore test and the last update check — one row '
  'each, always. `recorded` is false and the rest null where nothing has ever '
  'been written, which is every kind today: infra.record_ops_event has no '
  'caller until Phase 9. The dashboard renders that as a sentence and never '
  'as a zero.';

-- --- Review moderation -----------------------------------------------------
--
-- /admin/reviews. Newest first, with the tool, the handle, the stars, the
-- body, and — for one already taken down — when and why and by whom.
--
-- WHY A DEFINER FUNCTION AT ALL, when reviews_read already lets an admin see
-- a removed review: so that every row on the dashboard arrives the same way,
-- through one function with one check, which is what makes the enumeration in
-- db/test/admin_test.sql §1 a complete statement about the page rather than a
-- statement about most of it.
create or replace function public.admin_reviews(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  review_id      bigint,
  tool_slug      text,
  tool_name      text,
  handle         text,
  rating         smallint,
  body           text,
  created_at     timestamptz,
  removed_at     timestamptz,
  removal_reason text,
  removed_by     text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not auth.is_admin() then
    raise exception 'the operator dashboard is an administrator''s'
      using errcode = '42501';
  end if;

  return query
    select r.id,
           t.slug::text,
           t.name,
           a.handle::text,
           r.rating,
           r.body,
           r.created_at,
           r.deleted_at,
           rr.reason,
           adm.handle::text
      from public.reviews r
      join public.tools t on t.id = r.tool_id
      join public.profiles a on a.id = r.author_id
      left join lateral (
        select x.reason, x.admin_id
          from public.review_removals x
         where x.review_id = r.id
         order by x.id desc
         limit 1
      ) rr on true
      left join public.profiles adm on adm.id = rr.admin_id
     order by r.created_at desc, r.id desc
     limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

comment on function public.admin_reviews(int, int) is
  'Every review, newest first, with its listing, its author''s handle and — '
  'where there is one — the removal that took it down. Reading is all this '
  'does: the removal itself is two ordinary statements sent as the '
  'administrator (0013 §7 and 0015 §1), so the policy, the restrictive policy '
  'and the trigger all still decide, and no elevated code path can remove a '
  'review.';

-- ===========================================================================
-- 5. Grants
--
-- Every panel function to foundit_app, and nothing else anywhere. Said out
-- loud, for the reason 0017 §9 says it — a grant nobody wrote down is the one
-- that appears by accident later:
--
--   * foundit_app gains NOTHING on infra: no USAGE on the schema, no
--     privilege on infra.ops_events, no execute on infra.record_ops_event.
--     The only way to the table is public.admin_ops_events().
--   * foundit_app gains NO new privilege on public.profiles. last_seen_day is
--     written by public.note_seen_today() and by nothing else; 0015's three
--     writable columns are still three.
--   * foundit_embed gains nothing at all. Its three functions are still its
--     three functions, and it still holds no table grant anywhere.
--   * Nothing anywhere gains a write on public.tools.open_count. It moves
--     through public.record_tool_open and through no other statement.
-- ===========================================================================
revoke execute on function public.note_seen_today() from public;
revoke execute on function public.record_tool_open(citext) from public;
revoke execute on function public.admin_demand(int) from public;
revoke execute on function public.admin_unmet_demand(int, int) from public;
revoke execute on function public.admin_top_queries(int, int) from public;
revoke execute on function public.admin_catalogue_counts(int) from public;
revoke execute on function public.admin_catalogue_added(int, int) from public;
revoke execute on function public.admin_catalogue_unmatched(int) from public;
revoke execute on function public.admin_signups(int) from public;
revoke execute on function public.admin_people(int) from public;
revoke execute on function public.admin_words(int) from public;
revoke execute on function public.admin_database_bytes() from public;
revoke execute on function public.admin_ops_events() from public;
revoke execute on function public.admin_reviews(int, int) from public;

grant execute on function public.note_seen_today() to foundit_app;
grant execute on function public.record_tool_open(citext) to foundit_app;
grant execute on function public.admin_demand(int) to foundit_app;
grant execute on function public.admin_unmet_demand(int, int) to foundit_app;
grant execute on function public.admin_top_queries(int, int) to foundit_app;
grant execute on function public.admin_catalogue_counts(int) to foundit_app;
grant execute on function public.admin_catalogue_added(int, int) to foundit_app;
grant execute on function public.admin_catalogue_unmatched(int) to foundit_app;
grant execute on function public.admin_signups(int) to foundit_app;
grant execute on function public.admin_people(int) to foundit_app;
grant execute on function public.admin_words(int) to foundit_app;
grant execute on function public.admin_database_bytes() to foundit_app;
grant execute on function public.admin_ops_events() to foundit_app;
grant execute on function public.admin_reviews(int, int) to foundit_app;

commit;
