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
| `DATABASE_URL_EMBED` | `foundit_embed` | nothing, two function grants | `scripts/embed.mjs` only |

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
```

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
times rather than of clearing anything.

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

## Rules that are not negotiable

- No real password, key or token in any file git tracks. Ever. That includes
  `OPENAI_API_KEY`, which is the same secret as `EMBEDDINGS_API_KEY` unless
  somebody has deliberately separated them.
- Never disable row-level security, never connect as a superuser or as the
  table owner, never write a policy that evaluates to `true`. If one of those
  looks like the fix, you have found a real problem — stop and say so.
- The server never fetches a URL someone submitted.
