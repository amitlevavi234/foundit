# Working on Foundit locally

## Start the app

```bash
npm run dev
```

**`next dev` compiles each route the first time you ask for it, so the first
load of a page takes fifteen to thirty seconds on this laptop and every load
after it is instant.** That is the development server, not the site.
`npm run dev` prints that sentence before it starts, because the owner used the
site for the first time on 14 September 2026, waited through it on every page,
and reported the product as slow — which was half right, and nothing anywhere
said which half.

The other half was real and is measured separately: see **Measuring the
pages** below, which refuses to measure a `next dev` server at all.

It matters more than a wait. While a route is compiling its HTML has arrived
and its client bundle has not, so a Server Action form posts as a plain form,
an `onKeyDown` handler does not exist yet, and a button held shut by a
`useState` is never opened. Every one of the owner's four interaction bugs
lived in that window. They are fixed by **not depending on hydration** rather
than by making it faster — `tests/no-script.test.mjs` posts Save, Like, Review
and the add flow as an unhydrated browser posts them and asserts each one
completes — so this note explains the wait rather than trying to shorten it.

## Start the database

```bash
docker compose -f db/docker-compose.dev.yml up -d
node db/apply.mjs --fresh --seed
```

That is a throwaway PostgreSQL on your own machine, on port 5433, holding
invented data. Its password is in the compose file on purpose.

### When Docker will not start

Run this and go and make a coffee:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fix-docker-sockets.ps1
```

Docker leaves socket files behind when it is killed rather than shut down, and
Windows then cannot delete them, so Docker cannot start — it needs to remove
the old socket before binding a new one. **Rebooting does not help**: the files
survive a reboot. The script renames the folders containing them aside, which
works because renaming a folder does not require opening what is inside it.

**Do not press "Reset to factory defaults"** in Docker's error dialog. It does
not fix this, and it deletes every image and container you have.

## The schema owner is not a superuser, anywhere

**`foundit_owner` is `NOSUPERUSER NOBYPASSRLS` — in the development container,
in CI and on the server.** Since 13 September 2026 here, and since
`research/08` §9.3 was written on the server it will run on. It matters enough
to have its own section because the Phase 8 review found eight defects that
only a superuser owner was hiding, and every one of them was silent.

**What a superuser owner hid.** Every table in `public` is `FORCE ROW LEVEL
SECURITY`, which subjects the table's OWNER to its own policies. A SECURITY
DEFINER function runs as `foundit_owner`, so it is subject to them too — unless
that role is a superuser, in which case row-level security is switched off for
it entirely. `public.record_tool_open` updated `public.tools` outside 0014's
counters window, matched no policy, and updated zero rows. An UPDATE that
matches nothing is a success: no error, no log line, and a counter that would
have read 0 on every listing for ever. Seven more functions were the same
defect — the three query caches, the embedding queue, `search_event_tools`,
the two listing-ownership functions, and `public.profiles_public`, a view that
would have returned no rows to anybody and blanked every byline on the site.

**How the container is built.** `POSTGRES_USER` is `postgres`, not
`foundit_owner`, because PostgreSQL refuses to take SUPERUSER away from the
role `initdb` bootstrapped with — *"the bootstrap superuser must have the
SUPERUSER attribute"* — so a container started as `foundit_owner` has a
superuser owner for ever, whatever is written afterwards. `db/dev-roles.sql` is
mounted into `/docker-entrypoint-initdb.d` and runs once, as `postgres`, on an
empty `./db/.data`: it creates the four roles, hands the database and schema
`public` to `foundit_owner`, installs the three extensions, and grants the
owner two things a plain role cannot have.

`.github/workflows/ci.yml` runs the SAME FILE against its service container, so
the two cannot drift, and then fails the build if `foundit_owner` comes back
`rolsuper` or `rolbypassrls`.

**An existing `./db/.data` cannot be converted.** The bootstrap role's
attribute is fixed at `initdb`, so a container created before this date has to
be rebuilt. Keep the data:

```bash
docker exec foundit-dev-db pg_dump -U foundit_owner -d foundit -Fc -f /tmp/foundit.dump
docker cp foundit-dev-db:/tmp/foundit.dump ./foundit.dump
docker compose -f db/docker-compose.dev.yml down
# move ./db/.data aside rather than deleting it, until the restore has been checked
docker compose -f db/docker-compose.dev.yml up -d
docker cp ./foundit.dump foundit-dev-db:/tmp/foundit.dump
docker exec foundit-dev-db pg_restore -U postgres -d foundit /tmp/foundit.dump
```

`pg_dump` does not carry cluster-level settings, so put back the two things
`0003` and `0013` set with `ALTER ROLE`:

```bash
docker exec -i foundit-dev-db psql -U postgres -d foundit \
  -c "alter role foundit_app set statement_timeout = '5s'" \
  -c "alter role foundit_auth set search_path = auth_core" \
  -c "alter role foundit_auth set statement_timeout = '5s'"
```

Then check, because this is the whole point:

```bash
docker exec -i foundit-dev-db psql -U postgres -d foundit \
  -c "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'foundit_owner'"
```

### The owner's window, and when you have to open it by hand

`0020_phase8_review.sql` §2 gives every table in `public` one more policy,
`TO foundit_owner`, gated on `current_setting('foundit.definer') = 'on'`. It is
0014's counters window generalised: a SECURITY DEFINER function that needs to
reach past a policy carries `SET "foundit.definer" = 'on'` in its own
definition, which PostgreSQL applies on entry and **restores on exit, including
on an exception**, so the window is open for the body of one named function and
not one statement longer. `db/test/admin_test.sql` §11 holds the list of
functions that may carry it and fails on any that is not on it.

**None of this changes what the owner can do.** An owner connection could
always drop a policy — it owns the tables. What the window changes is that the
owner has to SAY it is reaching past one, and that everything which does not
say so gets an error where it used to get `UPDATE 0`.

So: **if you are connected as `foundit_owner` and a statement touches no rows
when you expected it to touch some, that is row-level security and not a typo.**
Open the window for the statement and close it again:

```sql
begin;
set local "foundit.definer" = 'on';
-- your statement
commit;
```

`set local` rather than `set`, so it goes away with the transaction whether the
transaction commits or rolls back.

**Three things open it by hand and say so**: `db/seed/dev_seed.sql`, which is
the owner loading 224 listings that belong to nobody; a handful of fixtures in
`db/test/`, each carrying a comment saying why no function could plant that
row; and the admin-flag statement below.

### Deleting rows as the owner

This is the one that catches everybody, and it caught the Phase 9a adversarial
review while it was tidying up after itself — which is why there is now a file
for it, `db/scripts/as-owner-window.sql`, rather than a paragraph somebody has
to remember.

```
foundit=> delete from public.search_events where id > 1245;
DELETE 0
```

**Zero rows, no error, no warning.** The policy did not match, so as far as the
database is concerned there was nothing there to delete. The natural reading is
"the rows are already gone" or "my `where` clause is wrong", and the next move
is to try it as the superuser — which works, and which is the Phase 8 review's
F1 failure mode arriving for a third time. A `select count(*)` with the same
`where` clause answers `0` too, so the two readings cannot be told apart
without knowing about the window.

So: count and delete inside the window, in one transaction.

```bash
docker exec -i foundit-dev-db psql -v ON_ERROR_STOP=1 -U foundit_owner -d foundit -f - \
  < db/scripts/as-owner-window.sql
```

That file is a **template**: it opens both windows — 0020's `foundit.definer`
and 0014's `foundit.counters` — prints a count, and ends in `rollback`. Edit
the statement, read the count, change the last line to `commit`, run it again.
It deliberately takes no table name as an argument: there is no safe generic
"delete some rows" script, and a file that looked like one would be worse than
this.

**`infra.ops_events` is not one of these.** It has no row-level security at
all — 0019 says why: one writer, one reader, and the GRANT is the boundary — so
`delete from infra.ops_events where …` works as the owner with no window.
Worth saying because a cleanup after a backup exercise touches both tables and
only one of them needs anything.

### If `db/apply.mjs --fresh` refuses to create `vector`

`--fresh` drops schema `public`, and the three extensions live in it.
`citext` and `pg_trgm` are *trusted* extensions and the owner may put them
back; **`vector` is not**, so a non-superuser cannot create it. Put it back as
the superuser and run the applier again:

```bash
docker exec -i foundit-dev-db psql -U postgres -d foundit \
  -c "create extension if not exists vector"
```

Or recreate the container, which runs `db/dev-roles.sql` and does all three.

## The server also runs PostgreSQL

Production lives there, not on the laptop.

### Two databases, one instance

| Database | For |
| --- | --- |
| `foundit` | production. Empty until Phase 9 deploys. |
| `foundit_dev` | development. This is the one you use. |

Both are configured from `research/08-postgres-selfhosted.md` §3.2, the CX23
profile: 512 MB shared buffers, `work_mem` 8 MB with `max_connections` 30, JIT
off, data checksums on, `pg_stat_statements` loaded. The container is bound to
`127.0.0.1:5432` on the server and nothing publishes it further.

**One departure from the researched config:** `archive_mode` is `off`. The
research turns it on with an `archive_command` that shells out to pgBackRest.
pgBackRest is not installed yet, and `archive_mode = on` with a failing
`archive_command` does not degrade gracefully — PostgreSQL keeps every WAL
segment it cannot archive until the disk is full. Turn it on in the same change
that installs pgBackRest, never before.

### Open the tunnel

```bash
ssh -N -L 5433:127.0.0.1:5432 founditops@167.233.217.138
```

Leave it running. Local port 5433 is now the server's database.

### Credentials, and the two roles

The application and the migrations connect as **different roles**, and this is
load-bearing rather than tidiness:

| Variable | Role | Owns | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | `foundit_app` | nothing, no `BYPASSRLS` | the web app, `eval/run.mjs` |
| `DATABASE_URL_OWNER` | `foundit_owner` | the schema | `db/apply.mjs` only |
| `DATABASE_URL_EMBED` | `foundit_embed` | nothing, a handful of function grants | `scripts/embed.mjs` and `scripts/embed-worker.mjs` only |
| `DATABASE_URL_AUTH` | `foundit_auth` | nothing, five tables in `auth_core` | Better Auth only |

**There is deliberately no fallback between any of them.** If the app could
quietly reach for the owner connection when its own was missing, every
row-level security policy in the schema would stop applying on the day
someone's environment was misconfigured — and nothing would look broken. A
missing variable must be a loud failure instead. Each of the three scripts also
refuses a connection string whose *role name* is not its own, so a copy-paste
into the wrong variable stops rather than silently working.

`foundit_embed` is the newest of the three and it exists for a specific
reason. `public.store_problem_embedding` writes a vector onto a problem
statement; `public.query_vector_ranks` says which statement's vector is nearest
a cached query. **A role holding both can read another visitor's cached query
embedding out one sign bit at a time**, by planting chosen vectors and reading
back the order — an adversarial review did exactly that, recovering 16 of 16
sign bits as `foundit_app`. So the write half moved to a role of its own, the
application lost it, and no role has both. `db/migrations/0005_embed_role.sql`
has the long version; `db/test/vectors_test.sql` proves the separation.

`foundit_auth` is the fourth, added by Phase 6, and it is the same idea pointing
the other way. Better Auth keeps its own `user`, `session`, `account`,
`verification` and `rateLimit` tables; they live in the `auth_core` schema and
this role is the only thing that may touch them. It holds **nothing** in
`public` — not the catalogue, not reviews, not the search log — and
`foundit_app` holds **nothing** in `auth_core`. So a SQL-injection bug in the
catalogue cannot read a session token, and a bug in the authentication library
cannot read a review: two incidents rather than one.
`db/migrations/0013_accounts.sql` has the long version and
`db/test/accounts_test.sql` proves it from both sides.

The eval harness connects as `foundit_app` for the same reason: measured as the
owner, latency reads about four times faster than a visitor will ever see it.
That mistake is why the first Phase 2 baseline was withdrawn.

Locally, both are in `.env.local` and their passwords are the throwaway
literals from `db/docker-compose.dev.yml`.

On the **server**, the credentials were generated on the machine and live in
`/root/.foundit/db.env`, readable by root only. They have never been typed into
a chat window, an editor, or a file git can see. To read one back:

```bash
ssh founditops@167.233.217.138 "sudo grep '^POSTGRES_PASSWORD=' /root/.foundit/db.env | cut -d= -f2"
```

## Applying migrations

```bash
node db/apply.mjs            # apply what has not been applied
node db/apply.mjs --fresh    # drop the schema and apply everything
node db/apply.mjs --seed     # ...and load the development catalogue
```

Which migrations have run is recorded in `infra.schema_migrations`, not inferred
from the files, so running it twice is safe. It sits in its own schema rather
than `public` because every table in `public` must have row-level security
enabled and forced, and bookkeeping for the migration runner cannot satisfy
that without a permissive policy — which is the exact anti-pattern the
permission tests exist to catch.

`db/apply.sh` does the same thing through `docker exec` and needs the database
to be a container on the same machine. Keep it for that case.

## Filling the embeddings

```bash
node --env-file=.env.local scripts/embed.mjs
node --env-file=.env.local scripts/embed.mjs --dry-run        # count the work, call nothing
node --env-file=.env.local scripts/embed.mjs --from-fixture   # load the recorded vectors, call nothing
node --env-file=.env.local scripts/embed.mjs --write-fixture  # re-record them (costs one set of API calls)
```

Every problem statement on a published tool gets a 512-dimension vector from
`text-embedding-3-small`, stored as `halfvec(512)`. The job is idempotent: a
second run embeds nothing, because a row is only work when it has never been
embedded, when its statement changed after it was embedded, or when it was
embedded by a model `public.embedding_model()` no longer names.

It connects as **`foundit_embed`**, from `DATABASE_URL_EMBED`, and refuses any
other role. It reads its queue through `public.problem_embedding_work` and
writes through `public.store_problem_embedding` — two security-definer
functions, and the only two things that role may call. A batch job has no
identity and must not invent one by setting a request claim.

`db/seed/embeddings.fixture.json` is the recorded output of one `--write-fixture`
run: the catalogue's statement vectors keyed by the SHA-256 of the statement,
and the golden set's query vectors keyed by the normalised query. `--from-fixture`
loads them with no network call, and `eval/run.mjs` warms the query cache from
the same file when no key is set. **That is how CI runs the real hybrid search
with no key and no spend** — without it, a keyless run measures the Phase 2
search and gates nothing about the vector leg. An entry whose statement no
longer hashes to its key is skipped and counted out loud, so a stale fixture
degrades noisily rather than silently.

`--env-file` is how the key reaches it. **`EMBEDDINGS_API_KEY` lives in
`.env.local` and must never be echoed, printed, `cat`-ed or `source`-d.** If you
need to know it is there, print its length.

Search needs no separate warming: the query vector for a sentence is cached in
`public.query_embeddings` the first time anybody searches for it, and the eval
harness fills that cache for its own 60 queries before it measures.

## Keeping a new listing searchable

```bash
node --env-file=.env.local scripts/embed-worker.mjs                # beside the app
node --env-file=.env.local scripts/embed-worker.mjs --once         # one tick, then stop
node --env-file=.env.local scripts/embed-worker.mjs --interval=2   # poll faster
```

**Run this alongside `npm run dev` whenever you are adding or editing
listings.** Without it a published tool is findable by name and by words and
not by meaning, because nothing has embedded its summary or its problem
statements — which looks like the ranking being bad and is not.

The difference from `scripts/embed.mjs` above is the difference between a batch
and a queue. That one reads a work PREDICATE over the whole catalogue and ends;
this one reads `public.embedding_work`, which is rows a trigger put there
because something changed, and keeps going. Run `embed.mjs` after a migration
or a re-seed; run this one while people are using the site.

It connects as **`foundit_embed`**, from `DATABASE_URL_EMBED`, refuses any
other role by name, holds no table grant of any kind, and calls three
functions: `public.embedding_work`, `public.embedding_job_done` and
`public.embedding_job_failed`. **Its pool is not in `lib/`** —
`tests/markup.test.mjs` forbids that connection string anywhere under
`app/`, `components/` or `lib/`, and the rule is right: the web process
must never hold this role's credentials.

### Exactly one of these runs

**A second worker is a second full daily allowance.** Both embedding ceilings
are counters in memory, in the process that holds them, so two workers spend
twice the budget and neither knows about the other. The Phase 7 review found
two live on this machine at once — one left over from the implementer's
evidence run — and costed the pair at $9.25 a month against a $5 ceiling.

So the worker takes a **session-level advisory lock** at start-up and refuses
to start if another holds it:

```
$ node --env-file=.env.local scripts/embed-worker.mjs
another embed-worker already holds the advisory lock on this database.
EXACTLY ONE runs at a time, because the daily embedding budget in
lib/rate-limit.ts is per process and a second worker is a second full
allowance. Stop the other one, or wait for it to finish; see
docs/development.md for how it runs on the server.
$ echo $?
4
```

`pg_try_advisory_lock` and not `pg_advisory_lock`: the second one WAITS, and a
second worker sitting silently in a queue looks exactly like a second worker
that is running. The lock is held by a connection that is checked out for the
life of the process and never handed back, so it is released when the process
ends **however it ends** — there is no stale lock to clear by hand and no lease
to renew. `tests/embed-worker.test.mjs` holds the lock itself and asserts the
refusal and the exit code.

**Before you start one, check nothing else is:**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*embed-worker*' } |
  Select-Object ProcessId, CreationDate
```

**On the server** it is a unit rather than a terminal, which is what makes
"exactly one" a property of the machine rather than of somebody's memory.
`Restart=always` and `RestartSec` are the whole of it; the lock makes a
double-start harmless, and systemd will not start a second copy of a unit it
already has running:

```ini
# /etc/systemd/system/foundit-embed-worker.service
[Unit]
Description=Foundit embedding worker
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=foundit
WorkingDirectory=/srv/foundit/current
# The root-only file with DATABASE_URL_EMBED and EMBEDDINGS_API_KEY in it.
# Not .env.local, and not readable by the web user.
EnvironmentFile=/etc/foundit/worker.env
ExecStart=/usr/bin/node scripts/embed-worker.mjs --interval=5
Restart=always
RestartSec=5
# Exit 4 is "another worker holds the lock", which is not worth restarting for.
RestartPreventExitStatus=4
StandardOutput=journal
StandardError=journal
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now foundit-embed-worker
journalctl -u foundit-embed-worker -f     # job ids, counts, tokens; never text
```

### What a bad row costs, and what a bad request does not

A bad row does not stop a run. A job whose row was deleted **or whose tool is
not published** comes back with a null body and is retired; a job the provider
refuses **by itself** is recorded with its reason and retried twice before
being parked; a truncated input is refused rather than stored, because a vector
of a prefix filed under the whole statement is a search that is subtly wrong
forever. A parked job stays in the table where an operator can see it, and
`public.queue_embedding` un-parks it the moment its text changes again.

**A request that fails as a REQUEST is charged to nobody.** This was the Phase 7
review's F8: the worker looped over every job in a failed batch and recorded a
failure against each, so a provider outage parked up to thirty-one perfectly
good statements beside whatever happened to be queued with them — and a parked
job only un-parks when its text changes again, which for a maker means editing
a sentence they had already written. Now a whole-request failure is retried
once and then **bisected**, and only a request carrying ONE document that fails
is that document's fault. A 400 is the only status worth bisecting for; a 401,
a 429, a 5xx or a timeout is a fact about the request, so the jobs stay queued
and the next tick tries them again:

```
the provider refused a request of 4; no job was charged an attempt (embeddings: HTTP 401)
bisected a batch of 32: 1 input(s) failed alone, 31 embedded
```

### What it spends, and against what

Its requests count against `MAX_EMBEDDING_CALLS_PER_DAY` and their SIZE counts
against `MAX_EMBEDDING_TOKENS_PER_DAY`. The second ceiling is the Phase 7
review's F4 and it is the one that is about money: a request from this process
carries up to thirty-two documents, and the cost model priced every embedding
request at fifteen tokens, which is one capped search sentence. `.env.example`
has the arithmetic. Both counters are **in this process**, which is why exactly
one of these runs.

There is no `--from-fixture` and there cannot be: a queue is about text nobody
has written before, so there is nothing recorded to load. With no
`EMBEDDINGS_API_KEY` the worker refuses to start rather than spinning.

## Reading the sentences

```bash
node --env-file=.env.local scripts/read.mjs --dry-run        # count the work, call nothing
node --env-file=.env.local scripts/read.mjs --write-fixture  # record them (costs API calls)
node --env-file=.env.local scripts/read.mjs --from-fixture   # load the recorded ones, call nothing
```

The sibling of `scripts/embed.mjs`, and it exists for the same reason: **CI has
no key and must not have one**, and a run with no readings measures a different
search from the one that ships. Every sentence `eval/run.mjs` searches with —
the golden set, both negatives files, and the 240 mechanical perturbations — is
read once, by hand, with a key; every later run loads the recorded readings and
calls nothing.

**The order matters.** `scripts/read.mjs --write-fixture` first, then
`scripts/embed.mjs --write-fixture`. The shipped path embeds the English
restatement of a non-English sentence, and that restatement does not exist until
the readings do; run them the other way round and the fixture holds no vector
for it, so a keyless run measures those sentences text-only and quietly reports
a different number.

It connects as **`foundit_app`**, from `DATABASE_URL`, and writes through
`public.store_query_reading` — the same definer function a visitor's search
uses, so the fixture cannot put anything in `public.query_readings` that a
search could not. There is no fourth role: what `0005` forbids is one role
holding two halves of an oracle, and a reading has no halves.

`OPENAI_API_KEY` is read first and `EMBEDDINGS_API_KEY` second — one account,
two names, so a deployment can scope a key to the model without a code change
and nobody has to keep a second copy of the same secret. **Neither may ever be
echoed, printed, `cat`-ed or `source`-d.** If you need to know one is there,
print its length.

### Why a sentence is read twice

`gpt-5-nano` has no temperature control — the API refuses the parameter — so at
minimal reasoning effort its answers have a tail. Measured on one sentence:

```
"we all paid for different bits of the holiday and now nobody knows who owes who?"
  recorded once as  asks_for_software: false
  sampled six more times:  true true true true true true
```

One sample in seven would have told somebody with a real question that Foundit
has nothing for it. So `readSentence` makes two calls, in flight together, and
**a refusal needs both votes**; either sample saying "yes, software" is a
search. The English restatement takes the opposite rule — whichever sample
produced one wins — because there the tail is a *missing* answer and a
restatement is only ever embedded, so a second chance at it can add a vector and
can never delete an answer.

Two calls, together, is about $0.00028 a search against a ceiling of $0.002, and
a cached sentence costs neither.

## Judging the candidates (Phase 5)

```bash
node eval/run.mjs --record-reranks           # call the model for anything the
                                             # fixture does not hold, and write
                                             # the answers into it. COSTS MONEY.
node eval/run.mjs                            # measure, using the recorded ones
node eval/run.mjs --no-rerank                # measure the Phase 4 search
node eval/run.mjs --rerank-n=50              # judge fifty candidates instead
node eval/run.mjs --record-reranks --record=n20-4   # …and keep the whole summary
                                             # of that recording in eval/recordings/
```

`--record=<name>` writes `eval/recordings/<name>.json`, and that directory is
committed. "The middle of five recordings" was being reported from notes until
the Phase 5 review pointed out that five recordings nobody can open are not five
recordings; every model-dependent number in `eval/baselines.md` now names the
file behind it.

The reranker is the third paid call and the only one whose recording lives in
the harness rather than in a script of its own. That is deliberate: it needs the
sentence planned, the vectors resolved and the search run before it knows what
its candidates are, and all three of those already exist here. A second
implementation of "plan, search, take the top N" is exactly the divergence the
last two reviews each caught.

`--record-reranks` is the one path in `eval/run.mjs` that spends anything, it is
never on by default, and it says so on stdout. It **extends** the fixture rather
than re-recording it, for the same reason `scripts/read.mjs` does: this model is
not deterministic, so re-judging a sentence already in the file moves the
headline for a reason nobody changed.

The cache is keyed on the sentence **and** on a hash of the candidate slugs, so
a run at a different `--rerank-n` is a different question and gets its own
entries. That is what made measuring 20, 30 and 50 a matter of running it three
times rather than of clearing anything. It is also why `--baseline` fails on a
run at the wrong N: no candidate set matches, so nothing is judged, and the
**Rerank coverage** gate says so rather than quietly measuring Phase 4.

To take a genuinely FRESH recording of a sentence the fixture already holds —
which is what "record three times and freeze one" needs — the entries have to be
cleared first, from the fixture and from `public.query_reranks` both. There is no
flag for that on purpose: it costs money and it is not something to do by
accident.

## Writing problem statements (Phase 5, and reverted)

```bash
node --env-file=.env.local scripts/generate-statements.mjs --dry-run   # the two prompts
node --env-file=.env.local scripts/generate-statements.mjs --limit=3   # three tools
node --env-file=.env.local scripts/generate-statements.mjs             # the queue
```

`gpt-5-mini` writes problem statements for published tools that carry fewer than
`public.statements_wanted()`, and `gpt-5-nano` checks every candidate against
the tool's own name and summary before it is stored. Five gates, listed in
`lib/generate.ts`.

It connects as **`foundit_embed`**, from `DATABASE_URL_EMBED`, and touches no
table: the queue is `public.statement_work()`, the dedupe is
`public.statement_similarity()` — the arithmetic happens in PostgreSQL and one
number comes out — and the write is `public.store_generated_statement()`, which
has no argument that could write any `source` but `'generated'`.

**The rows it produced are not loaded, and that is a measurement rather than an
oversight.** 363 statements made nDCG@10 fall from 0.7755 to 0.7508 while
recall@10 rose from 0.7636 to 0.7800: easier to reach, harder to order. They are
recorded in `db/seed/generated_statements.sql`, whose header holds the numbers
and the two commands that load or undo them.

## Running the search evaluation

```bash
node eval/run.mjs
```

It scores the golden set in `eval/golden.jsonl` and prints recall@10 and
nDCG@10. **The golden set is never edited to make a score move.** If the number
is bad, the search is bad.

**Since Phase 4 the headline pass is the SHIPPED path** — the rules, plus the
model's cached reading, merged — rather than the golden set's own hand-written
constraints. That is a change of instrument and it is recorded as one in
`eval/baselines.md`: phases 2 and 3 measured the ranker with the reading held
correct by assumption, which was right while nothing read a sentence, and Phase
4's whole subject is reading the sentence. Both passes still run and both are
printed; `--plan=written` makes the old one the headline again.

```bash
node eval/run.mjs --plan=written    # the Phase 2 and 3 instrument
node eval/run.mjs --plan=rules      # lib/constraints.ts alone: what Phase 3 shipped
node eval/run.mjs --accept=none     # the reader, contributing no constraints
node eval/run.mjs --no-refuse       # ignore "this is not a request for software"
node eval/run.mjs --embed=text      # embed the sentence rather than its restatement
node eval/run.mjs --no-rerank       # the Phase 4 search, with no judgement over it
node eval/run.mjs --rerank-n=20     # judge twenty candidates rather than the shipped N
```

Every one of those was run before the defaults were chosen, and the table is in
`eval/baselines.md`. None of them is a knob to turn when the number is
disappointing; they are how the number was arrived at.

## Signing in, locally

```bash
docker compose -f db/docker-compose.dev.yml up -d
node db/apply.mjs --fresh --seed
npm run dev
```

Then open `/sign-in`. With nothing configured, both controls are drawn disabled
and say which one is missing — that is the honest state, not a broken one, and
the rest of the site works exactly as it did before Phase 6.

To sign in for real on your own machine you need **two lines in `.env.local`**
and nothing else:

```bash
DATABASE_URL_AUTH=postgresql://foundit_auth:local_development_only_auth@127.0.0.1:5433/foundit
BETTER_AUTH_SECRET=<32 random characters>
AUTH_DEV_CODE_TO_LOG=1
```

Generate the secret on the machine and do not print it anywhere:

```bash
openssl rand -base64 33 | tr -d '\n/+=' | cut -c1-32
```

`AUTH_DEV_CODE_TO_LOG=1` is what makes this work with no email account at all:
the 6-digit code is **printed to the server log** instead of being sent. It is
generated, hashed, stored, expired after five minutes and thrown away after
three wrong guesses exactly as it would be in production — only the delivery is
a console line:

```
[development] sign-in code for noa@example.com: 482915 — printed because AUTH_DEV_CODE_TO_LOG=1 and this is not production; nothing was sent
```

**It now forces the log even when RESEND_API_KEY and EMAIL_FROM are set**
(changed 12 September 2026, after the Phase 6 review). The check used to sit
inside the "there is no provider" branch, so on a machine that had ever tested
real delivery the variable was inert and asking for a code posted a real email
to whatever address was typed. So: set it and nothing leaves the process, and
**leave it empty when you actually want to test real delivery** — that is now
the only way to send one from your laptop, which is the right way round.

**That path cannot be reached in production.** `lib/email.ts` requires
`NODE_ENV` to be something other than `production` *and* the variable to be
exactly `1`, and `tests/email.test.mjs` asserts the pairing — a deployment that
sets it by mistake still sends, and still prints nothing. Never set it on the
server.

If the dev container already exists, the role's password has to be set by hand
once, because the init script only runs on an empty data directory:

```bash
docker exec -i foundit-dev-db psql -U foundit_owner -d foundit \
  -c "alter role foundit_auth login noinherit password 'local_development_only_auth'"
```

### How the route walk signs itself in, and why that is not a back door

`tests/links.test.mjs` walks every `/admin` route twice: with no session, and
with a signed-in account that is **not** an administrator. The second half used
to need `FOUNDIT_TEST_SESSION` set by hand, and nothing anywhere set it — so
the half of Phase 8's gate item 3 that matters had never run, including in CI
(the review's F12). It mints its own account now, and it fails rather than
skipping when a server is answering and the minting does not work.

What it does, in order:

1. `POST /api/auth/email-otp/send-verification-otp` for a fresh
   `@example.invalid` address, with an `Origin` header — Better Auth answers
   403 without one.
2. **Writes the six digits it is about to use** into
   `auth_core.verification.value`, hashed with the application's own
   `hashSignInCode`, as `foundit_auth`.
3. `POST /api/auth/sign-in/email-otp` with those digits, and keeps the cookie
   Better Auth signs.
4. Walks the routes, checks the cookie really is a session (it reaches
   `/settings`), and deletes the account: the profile as `foundit_app` under
   the throwaway's own claim, which is the path `profiles_delete` exists for,
   and the `auth_core` rows as `foundit_auth`.

**Step 2 is a shortcut and it is stated rather than hidden.** The stored value
is HMAC-SHA256 under `BETTER_AUTH_SECRET` (0013, and the Phase 6 review is
why), so recovering a code the honest way is a million hashes — four seconds,
measured — and reading it out of a log means knowing where the operator pointed
their log. Everything else is real: Better Auth issues the row, verifies the
code, creates the session and signs the cookie, and the cookie is what the walk
carries. The only thing the test supplies is what an inbox would supply.

**It is not a way in.** The step needs `DATABASE_URL_AUTH` and
`BETTER_AUTH_SECRET`, which is to say it needs the authentication role's
password and the key the codes are hashed under. Anybody holding both can
already sign in as anybody; the test holds them because
`node --env-file=.env.local --test` hands them to it, and nothing in the
application reads either from anywhere a request can reach.

The addresses are always `@example.invalid` and `AUTH_DEV_CODE_TO_LOG=1` keeps
every message in the log, so no message is ever sent anywhere even if the
address were deliverable, which it is not.

## Counting a click on a link out (`POST /o`)

The "Opened from Foundit" number on a maker's dashboard is
`tools.open_count`, and the only statement that moves it is
`public.record_tool_open(citext)`. What reaches that function is **`POST /o`**,
a Route Handler with the slug in the request body.

**Why a route of its own rather than a Server Action.** A Server Action posts
to the URL of the page it sits on, so counting a click from `/tools/tabsplit`
put `POST /tools/tabsplit` in the request line of every access log in front of
the application, beside the visitor's address and the same timestamp. That is
the one join `0019` §3 says this product does not make, made by the transport
rather than by the function (the Phase 8 review's F5). `/o` is one character
and the same for every listing.

Things to know if you touch it:

- **It answers 204 to everything.** Not 200 for a slug that exists, not 404 for
  one that does not, not 429 over the bound, not 403 on a bad `Origin`. If you
  are debugging it, read `tools.open_count`, not the response.
- **It checks `Origin` itself.** Next verifies the Origin of a Server Action
  and verifies nothing about a Route Handler. A browser sends `Origin` on every
  POST including a same-origin one, so a request without one is not a browser.
  A `curl` without `-H "origin: http://localhost:3000"` counts nothing, and
  that is not a bug.
- **It is bounded**: `MAX_OPENS_PER_VISITOR_PER_HOUR` (30) and
  `MAX_OPENS_PER_DAY` (20,000) in `.env.example`. Both come out of the bucket
  map `lib/rate-limit.ts` already keeps; the address is hashed with the
  per-process salt and dropped, so nothing new is stored anywhere.
- **It reads no cookie**, and `recordToolOpen` still opens its transaction with
  no identity claim at all. A signed-in person's click and a stranger's are the
  same statement.


## Making yourself an administrator (and why no screen can)

The operator dashboard at `/admin` is behind `profiles.is_admin`, and **nothing
in the application can write that column.** `0015_phase6_review.sql` revoked
`UPDATE` on `public.profiles` from `foundit_app` and granted it back on three
columns — `display_name`, `bio`, `handle` — so a signed-in person sending a
statement of their own choosing is refused by the privilege rather than by a
policy, and an administrator is refused too. There is no form, no Server Action
and no API route that sets it. `db/test/admin_test.sql` §5 tries it as an
ordinary account and as an administrator and fails if either succeeds.

So it is set out of band, **as the schema owner**, which is the one connection
the application never has:

```bash
# Sign in first, through /sign-in, so the profile row exists.
docker exec -i foundit-dev-db psql -U foundit_owner -d foundit \
  -c "begin; set local \"foundit.definer\" = 'on'; \
      update public.profiles set is_admin = true where handle = 'your_handle'; \
      commit"
```

Take it away the same way, and take it away when you are finished with it:

```bash
docker exec -i foundit-dev-db psql -U foundit_owner -d foundit \
  -c "begin; set local \"foundit.definer\" = 'on'; \
      update public.profiles set is_admin = false where handle = 'your_handle'; \
      commit"
```

**`set local "foundit.definer" = 'on'` is not decoration, and it is new on
13 September 2026.** `profiles_update` is `id = auth.uid()`, `public.profiles`
is FORCE ROW LEVEL SECURITY, and `foundit_owner` is no longer a superuser — so
without the window this statement is `UPDATE 0`: no error, no warning, and a
handle that is not an administrator when you go and look. It is the same defect
as the Phase 8 review's F1, in the operator's own runbook, and the answer is
the same: **read the `UPDATE 1` the statement prints.** If it says `UPDATE 0`,
the window is what is missing.

On the server the same statement runs through the tunnel as `foundit_owner`
(see *Credentials, and the two roles* above). It is deliberately a thing you
have to mean to do.

**The Dashboard link in the account menu is a convenience and not the lock.**
It is drawn only for an administrator, but a person who types `/admin` gets the
not-found page — the same page, with the same title **and the same 404** that a
mistyped URL gets — and a person who sends the SQL themselves gets `42501` from
every one of the twelve `admin_*` functions. The link's absence protects
nothing, and it is not supposed to.

The 404 is `app/admin/layout.tsx`, and it is a layout rather than a line in each
page for one reason: `notFound()` can only set a status code while nothing has
been sent, and a layout runs before the page it wraps. Until 13 September 2026
this sentence said "the same page, with the same title" and was true of both
halves and of neither — `/admin` answered **200** where
`/definitely-not-a-route` answered 404, and `HEAD /admin` answered 200 with no
body at all, so the only thing in that response was the difference.

**Do not put a `loading.tsx` at `app/`.** A `loading.tsx` is a Suspense
boundary, and one at the root wraps every route in the product — so Next
flushes the shell, with its 200, before any page has decided anything, and
`notFound()` can no longer set a status code ANYWHERE in the application. That
is what it was doing: `/tools/<missing>`, `/u/<nobody>`, `/maker/<not mine>`
and `/admin` all answered 200 under `next start`. The homepage's loading state
lives at `app/(home)/loading.tsx` now, in a route group, so the URL is still
`/` and the boundary wraps the homepage and nothing else; every catalogue route
keeps its own. `tests/admin.test.mjs` fails if `app/loading.tsx` or
`app/admin/loading.tsx` reappears, and `tests/links.test.mjs` fails against a
production build if the status goes back to 200.

## Four settings that only the server sets

Every other variable in `.env.example` is something a laptop can have. These
four are deliberately unset here and set on the host, and each of them exists
because of a Phase 9a review finding.

**`TRUST_CLOUDFLARE_HEADERS=1`** — F2. `lib/visitor-policy.ts` believes
`cf-connecting-ip` only when this says something in front of the process
overwrites it, which on the host is the tunnel and here is nothing. Unset,
every visitor shares one rate-limit bucket; that is the conservative direction
and it is what `.env.example` has always claimed. `x-real-ip` and
`x-forwarded-for` are never read at all. Set it on a machine where the header
is not overwritten and one client can mint a fresh identity per request by
typing one — which is what the review did, sixty times and then forty more.

**`CF_BEACON_TOKEN`** — F6, and note there is **no `NEXT_PUBLIC_` prefix**.
`components/AnalyticsBeacon.tsx` is a Server Component and reads it on every
request, so one image runs anywhere. The old `NEXT_PUBLIC_CF_BEACON_TOKEN` was
inlined by the bundler at build time and could never have a value on a host
that sets it at run time. Unset here, so the beacon renders nothing and no
request leaves the page.

**`SENTRY_DSN`** — the same variable the server and edge clients read, and
since F6 also what the browser gets: the server renders it into
`<meta name="sentry-dsn">` and `instrumentation-client.ts` reads it from there,
because `process.env` does not exist in a browser. A DSN is public by design
and may appear in a page; there is no `NEXT_PUBLIC_SENTRY_DSN` any more.

**`FOUNDIT_RECORD_DB`** — F9, and it is an override rather than a setting.
`server/backup/pg-dump-offsite.sh` writes its `infra.ops_events` row to
`foundit` regardless of which database it was told to dump, because a failed
backup has to record itself and the review's own reproduction pointed the dump
at a database that does not exist. Set this only where the application's
database is not called `foundit`.

## What the owner must create

Two accounts, neither of which an agent can make for you, and both of which the
application is written to work without. Until they exist the matching control
says "not set up yet" rather than failing after somebody clicks it.

### 1. A Google OAuth client

You are not a developer and this page is designed for people who are, so here
is exactly what to press.

1. Go to **console.cloud.google.com** and sign in with the Google account that
   should own this.
2. Top left, the project dropdown → **New project**. Call it `Foundit`. Create
   it, then make sure it is the project selected in that dropdown.
3. Left menu → **APIs & Services** → **OAuth consent screen**.
   - User type: **External**. Create.
   - App name: `Foundit`. User support email: your own address.
   - **App domain**: home page `https://foundit.tools`, privacy policy
     `https://foundit.tools/privacy`, terms of service
     `https://foundit.tools/terms`. Google *requires* the last two before it
     will let the screen out of testing, and both of those pages exist and say
     plainly that they are unwritten (`docs/product-decisions.md` §14) — which
     is a gap to close before launch, not a reason to invent a policy now.
   - Developer contact: your own address. Save and continue.
   - Scopes: add **`openid`**, **`.../auth/userinfo.email`** and
     **`.../auth/userinfo.profile`**, and nothing else. Foundit asks for a name
     and an email address and has no use for anything more.
   - While the app is in **Testing**, only addresses you add under **Test
     users** can sign in. Add your own. Publishing it is a separate step and
     needs the two URLs above to be real pages.
4. Left menu → **Credentials** → **Create credentials** → **OAuth client ID**.
   - Application type: **Web application**. Name: `Foundit web`.
   - **Authorised redirect URIs** → Add URI. This must match to the character,
     including the scheme and with no trailing slash:
     - for your laptop: `http://localhost:3000/api/auth/callback/google`
     - for the server: `https://foundit.tools/api/auth/callback/google`
   - Google allows `http` only for `localhost`; everything else must be
     `https`, and a raw IP address is refused.
   - Create. It shows a **Client ID** and a **Client secret**.
5. Put them in `.env.local` (laptop) or `/root/.foundit/app.env` (server) as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and set `BETTER_AUTH_URL` to
   the address you registered the redirect URI under. **The redirect URI is
   built from `BETTER_AUTH_URL`**, so if the two disagree Google refuses the
   sign-in with `redirect_uri_mismatch` and nothing else is wrong.

   **`BETTER_AUTH_URL` must be the exact origin the browser is on** — scheme,
   host AND port, with no trailing slash and no path. `http://localhost:3000`
   and `http://localhost:3001` are two different origins to Google and to
   `trustedOrigins`, and `http://127.0.0.1:3000` is a third. This is not
   hypothetical: the first `redirect_uri_mismatch` on this project came from
   `BETTER_AUTH_URL` still pointing at `:3001` after a test run had taken 3000,
   with the registered URI, the client id and the secret all correct. If you
   run the dev server on another port, change this line as well, or register
   that port's callback URI too — Google accepts several.

The secret is a secret: it goes in a file git does not track, it is never
pasted into a chat window, and if it ever leaks you press **Reset secret** on
that credentials page and replace it.

### 2. Resend, and the DNS records that stop the codes going to Spam

Resend sends the 6-digit codes. Free tier at the time of writing: 3,000 emails
a month, 100 a day (`research/09` §6), which is far more than a directory's
early traffic.

1. **resend.com** → create an account.
2. **Domains** → **Add domain**. Use a **subdomain**, not the root:
   `mail.foundit.tools`. Reputation then stays isolated — a bad month for
   transactional mail never poisons anything else on the domain.
3. Resend shows a list of DNS records. Add each one in Cloudflare exactly as
   shown. There will be three kinds, and each does a different job:
   - **SPF** (a `TXT` record on `mail.foundit.tools`) says which servers may
     send as this domain. **Exactly one SPF record per name** — two is a
     permanent error and a permanent error is a hard fail, not a soft one.
   - **DKIM** (`CNAME` records) lets the receiver check the mail was not
     altered. Copy the values verbatim.
   - **DMARC** (a `TXT` record on `_dmarc.foundit.tools`) says what to do when
     the first two fail. **Start at `p=none`**:
     `v=DMARC1; p=none; rua=mailto:you@foundit.tools; adkim=s; aspf=s`
4. Wait for Resend to show the domain as **Verified**.
5. **API Keys** → **Create API Key**, sending permission only. Put it in
   `RESEND_API_KEY`, and set `EMAIL_FROM` to an address on the verified
   subdomain — `Foundit <no-reply@mail.foundit.tools>`. **Both are required**:
   a key with an unverified sender fails at the far end where nobody is
   watching, so `lib/email.ts` treats a missing sender as "not configured".
6. Register the domain in **Google Postmaster Tools**. It is the only place you
   can see your actual Gmail spam rate, and Gmail's own threshold is 0.3%.
7. Watch the DMARC reports for two to four weeks, confirm all your legitimate
   mail passes, and only then move `p=none` → `p=quarantine` → `p=reject`.
   Going straight to `p=reject` is how people silently blackhole their own
   sign-in emails.

## Building the image, and running the production stack locally

Everything in `server/` runs on this machine as well as on the host, which is
the whole reason Phase 9a could prove any of it. Every path in those scripts is
a variable with the server's value as its default, so the difference between
here and there is four environment variables and no edited file.

### The image

```bash
docker build -t ghcr.io/amitlevavi234/foundit:sha-$(git rev-parse --short=7 HEAD) .
```

Three minutes cold, under one warm. It is `node:26-alpine` **pinned to a
digest**, multi-stage, and what comes out is about 370 MB running as uid 1001
with no shell script in front of it. `.dockerignore` is what keeps `.env.local`
out of the build context, and `COPY . .` is why that file is load-bearing
rather than tidiness: a layer cannot be un-published.

**Moving the base image is one command and one commit** (the Phase 9a review's
F19 — the file argued for digest pinning and did not do it):

```bash
docker buildx imagetools inspect node:26-alpine --format '{{.Manifest.Digest}}'
```

Put that in all three `FROM` lines. Every `uses:` in both workflows is pinned
the same way, to a commit SHA with the tag in a comment; `gh api
repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` is how to move one.
`tests/deploy.test.mjs` fails on anything unpinned.

### The compose file

`server/compose.prod.yml` needs four things that are not true on a laptop, and
each is a variable:

```bash
export IMAGE_TAG=sha-$(git rev-parse --short=7 HEAD)
export FOUNDIT_IMAGE_REPO=127.0.0.1:5000/foundit   # or ghcr.io/amitlevavi234/foundit
export FOUNDIT_ENV_DIR=/some/throwaway/dir         # holds app.env, embed.env, migrate.env
export FOUNDIT_DB_NETWORK=db_default               # what db/docker-compose.dev.yml calls its bridge

docker compose -f server/compose.prod.yml config     # validates; prints every env file
docker compose -f server/compose.prod.yml up -d --wait app
curl -s http://127.0.0.1:3000/healthz                # {"ok":true}
docker compose -f server/compose.prod.yml down
```

**`config` prints the CONTENTS of every env file it reads**, which is why
`server/deploy.sh` never runs it and `tests/deploy.test.mjs` asserts that no
script in `server/` does. Run it by hand when you want to check the file;
never in anything whose output goes to a log.

**`DATABASE_URL` in that env file must name the container, not `127.0.0.1`.**
`db/docker-compose.dev.yml` publishes 5433 on the HOST's loopback, and a
container's own loopback is the container. Use `foundit-dev-db:5432` as the host in that connection string, with the
password `db/docker-compose.dev.yml` publishes.

### The deploy, and its rollback

`server/deploy.sh` pulls, so it needs a registry. A local one is thirty
seconds:

```bash
docker run -d --name foundit-local-registry --network db_default \
  -p 127.0.0.1:5000:5000 registry:2
docker tag  ghcr.io/amitlevavi234/foundit:sha-abc1234 127.0.0.1:5000/foundit:sha-abc1234
docker push 127.0.0.1:5000/foundit:sha-abc1234

FOUNDIT_BASE=/some/throwaway/dir/srv bash server/deploy.sh sha-abc1234
```

`FOUNDIT_BASE` is where it writes `state/current_tag`, `state/deploy.log` and
the pre-migration dumps; on the host it is `/srv/foundit`.

**One deploy at a time, and the second one says so.** Since the Phase 9a
review's F3 both scripts take a lock in `$FOUNDIT_BASE/state` before they read
or write anything, and the loser exits **75** with `a deploy is already
running` having taken no dump, run no migration and made no `docker` call.
`flock` where the machine has one — the host does — and an atomic `mkdir`
where it does not, which is Git Bash here. A run killed outright on the `mkdir`
path leaves the directory behind; the refusal says to remove it.

**The lock is taken before the environment and before `docker info`, and a CI
run is why.** It used to come after the env-file checks, which is fine on a
machine where a deploy takes a minute and useless on one where the first check
fails in milliseconds: on a runner with no reachable daemon the first
`deploy.sh` died immediately and had released the lock before the second one
started, so both proceeded. The only thing in front of the lock now is the tag
check, which touches nothing — a run about to exit 64 has no business holding a
lock the operator's next attempt needs. A consequence worth knowing: the state
directory has to be creatable before anything else happens, so a `FOUNDIT_BASE`
this account cannot write to is now its own refusal (exit 78, with the variable
named) rather than a bare `mkdir: Permission denied`.

**The exit codes now say which half failed.** 64 a bad tag, 70 the pull, 71 the
dump, 72 a migration, 75 health never came (or another deploy holds the lock),
**76 the app is up and the worker is not**, 77 run as root, 78 an env file is
missing or is not mode 0600. 76 is the one that is new: a crash-looping worker
fails the deploy and the site is deliberately **left running**, because putting
the previous image back would take a healthy site down for a queue.

**The 0600 check is skipped here and nowhere else.** `server/deploy.sh` refuses
an env file that is not mode 0600 — F11, which found the comment claiming that
check and the code not making it. Git Bash maps every file to 0644 whatever
`chmod` is told, so the script writes a probe file, chmods it, reads the mode
back, and says out loud that it is not checking when the filesystem cannot
answer. On ext4 it answers 600 and the check is made.

**To prove the rollback rather than trusting it**, build an image that starts
and answers 503:

```dockerfile
FROM 127.0.0.1:5000/foundit:sha-abc1234
CMD ["node","-e","require('http').createServer((q,s)=>{s.writeHead(503);s.end('{\"ok\":false}')}).listen(3000,'0.0.0.0')"]
```

Tag it `sha-badbad0`, push it, and deploy it. `deploy.sh` waits, gives up, puts
the previous tag back, writes `ROLLED BACK` to `state/deploy.log` and exits 75
— and `state/current_tag` still names the good one, because it is written only
after health comes.

### The backups, against a directory instead of R2

`server/backup/` takes its settings from `$FOUNDIT_ENV_DIR/backup.env`, and the
repository is either a bucket or a directory depending on which variable is
set. Locally it is a directory, which exercises the whole chain with no R2
account and no credential:

```bash
printf 'BACKUP_REPO_PATH=/some/throwaway/dir/repo\nBACKUP_KEEP_DAYS=14\n' \
  > "$FOUNDIT_ENV_DIR/backup.env"

bash server/backup/pg-dump-offsite.sh   # dumps, proves it readable, files it
bash server/backup/verify-restore.sh    # restores it into foundit_verify and counts
```

The second one takes the **newest artefact out of the repository** — not the
file just written — rebuilds it into `foundit_verify`, compares every table's
row count with the source, runs a real `<=>` query and a real full-text query,
and writes one row through `infra.record_ops_event`. It drops the scratch
database on the way out, including when it fails.

Read what it wrote:

```bash
docker exec foundit-dev-db psql -U postgres -d foundit \
  -c "select kind, ok, at, detail from infra.ops_events order by at desc limit 5"
```

That is what the dashboard's Backups panel draws. It says "NOT ENCRYPTED" every
time it runs here, loudly, because `DUMP_AGE_RECIPIENT` is unset — correct on a
machine holding invented data, and a launch blocker on the server.

### Measuring the pages

```bash
npm run build
npm start                                     # in another terminal
node --env-file=.env.local scripts/vitals.mjs --runs=3
```

Lighthouse, in the Chrome already on this machine, mobile preset — 4x CPU
slowdown and simulated slow 4G. **A production build, never `next dev`**, which
compiles on the first request and ships an unminified bundle. It throws the
first measurement away, because the first navigation in a freshly-launched
browser reliably comes back with no trace at all.

The numbers go in `eval/baselines.md`, and they are a comparison against that
row rather than absolutes. **They do not differ by "a few per cent"** — this
line used to say that and the Phase 9a review withdrew it: the same bundle
re-measured on this machine gave 3886 ms where the recorded row said 1546 ms.
Compare orders rather than figures, and never draw a conclusion from one run.

### Which JavaScript a page actually ships

```bash
npm run build
node scripts/chunks.mjs --top=8
```

Every client chunk, largest first, gzipped — which is what the browser is sent
and what `vitals.mjs` reports — with the routes that load each one, read out of
Next's own `app-build-manifest.json`. It refuses to run against a development
build, whose chunk sizes mean nothing.

It is what answered the owner's "why is TBT about a second on a page that does
almost nothing" in one line, on 14 September 2026: the largest chunk in the
build was 102 kB gzipped of Sentry's browser SDK, loaded on every one of the
54 routes, against 2 kB of this site's own client code.
`instrumentation-client.ts` loads it at idle now instead, and First Load JS
went from 163 kB to 106 kB. **Bytes are where to look and they are not the
finding**: Total Blocking Time is execution rather than download, which is a
claim the Phase 9a review withdrew once and is worth not making again.

### The headless browser the tests use

`tests/csp.test.mjs` and `scripts/vitals.mjs` both drive the Chrome that is
already installed, through `chrome-launcher` and the DevTools protocol
(`tests/browser.mjs`). There is no Puppeteer and no Playwright, and no second
copy of Chromium downloaded at install time. Both **skip, loudly**, when there
is no Chrome or no server answering — a skip that reads as a pass is the
failure this repository's suite is built to avoid, so they say which it was.

## Rules that are not negotiable

- No real password, key or token in any file git tracks. Ever. That includes
  `OPENAI_API_KEY`, which is the same secret as `EMBEDDINGS_API_KEY` unless
  somebody has deliberately separated them.
- Never disable row-level security, never connect as a superuser or as the
  table owner, never write a policy that evaluates to `true`. If one of those
  looks like the fix, you have found a real problem — stop and say so.
- The server never fetches a URL someone submitted.
