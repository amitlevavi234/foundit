# Working on Foundit locally

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

A bad row does not stop a run. A job whose row was deleted or whose tool was
unpublished comes back with a null body and is retired; a job the provider
refuses is recorded with its reason and retried twice before being parked; a
truncated input is refused rather than stored, because a vector of a prefix
filed under the whole statement is a search that is subtly wrong forever. A
parked job stays in the table where an operator can see it, and
`public.queue_embedding` un-parks it the moment its text changes again.

Its calls count against `MAX_EMBEDDING_CALLS_PER_DAY` — **in its own
process**, which is the honest limitation: this worker and the web process each
hold their own counter, and the vendor-side cap is the only ceiling actually
shared between them.

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

## Rules that are not negotiable

- No real password, key or token in any file git tracks. Ever. That includes
  `OPENAI_API_KEY`, which is the same secret as `EMBEDDINGS_API_KEY` unless
  somebody has deliberately separated them.
- Never disable row-level security, never connect as a superuser or as the
  table owner, never write a policy that evaluates to `true`. If one of those
  looks like the fix, you have found a real problem — stop and say so.
- The server never fetches a URL someone submitted.
