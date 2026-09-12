# The eval harness

This is the measuring instrument. Phase 2 builds a search with no AI in it, and
every phase after it has to beat the number this harness produces. That only
works if the harness is trustworthy and boring, so it is: no colour codes, no
randomness, no cleverness in the arithmetic that a reader cannot check by hand.

Since Phase 3 it makes **one** call that is not to PostgreSQL, before any
measurement starts, and the section [Vectors, and the one call that is not to
Postgres](#vectors-and-the-one-call-that-is-not-to-postgres) says exactly what
it is and why the measured pass is still read-only and still offline.

Since Phase 5 there is a **second** such call, and it is opt-in and never on by
default: `--record-reranks` asks the model to judge candidates it has no
recording for and writes the answers into the fixture. A run without that flag —
which is every run in CI, every `npm test`, and every `--baseline` — calls
nothing and is still read-only.

## The standing rule

**The golden set is never edited to make a score move.**

If the score is bad, the search is bad. `eval/golden.jsonl` is 60 queries with
known right answers, written *before* any tuning, precisely so that it cannot
become a rationalisation of whatever got built. Deleting the query that fails,
downgrading a judgement from 3 to 1 because the search missed it, or adding the
tool the search happened to return to the `relevant` map — each of those
destroys the only instrument the project has, and each is the exact move an
assistant reaches for when blocked.

Queries may be **added** to cover ground the set misses. When they are, every
earlier baseline becomes incomparable, and `eval/baselines.md` gets a fresh
start with the new set size recorded. Adding is honest; editing to win is not.

Corollary: `eval/run.mjs` never writes `eval/golden.jsonl`, and it never writes
to the database at all. In particular it does not log to `search_events` — the
app does that in production, and a benchmark run must not pollute the analytics
it exists to inform.

## Running it

```bash
npm install

# bash / zsh
DATABASE_URL='postgres://user:pass@host:5432/foundit' node eval/run.mjs

# PowerShell
$env:DATABASE_URL = 'postgres://user:pass@host:5432/foundit'; node eval/run.mjs
```

`DATABASE_URL` comes from the environment and from nowhere else. Nothing is
hardcoded, no default is guessed, no `.env` file is read by the harness itself,
and no connection string or password is ever printed — every error message is
passed through a redactor first. Set it for the one command rather than
exporting it.

The harness only ever runs `SELECT` **while it is measuring**, and it puts the
session into read-only mode before the first query to make that structural
rather than a promise. It makes exactly one kind of write, before that, and to
one table: the query-embedding cache. See [Vectors, and the one call that is not
to Postgres](#vectors-and-the-one-call-that-is-not-to-postgres). If the role you
point it at is read-only, the warm-up fails, the run says so, and the queries
are measured text-only.

It needs `public.search_tools` (from `db/migrations/0002_search.sql`) and a
loaded catalogue. Without the function it exits 3 and says so.

| Script | What it does |
| --- | --- |
| `npm run eval` | Run and print the table |
| `npm run eval:json` | Also write `eval/results/<timestamp>.json` |
| `npm run eval:baseline` | Check for regression against `eval/baselines.md`, write JSON |
| `npm run eval:read-query` | Run both slices and print the divergence (see below) |
| `npm test` | The scoring self-test, then the eval with the regression check |

| Flag | Default | Meaning |
| --- | --- | --- |
| `--json` | off | Write machine-readable results to `eval/results/` |
| `--baseline` | off | Compare against the last recorded row in `eval/baselines.md` |
| `--limit=N` | 20 | Rows requested per query. Metrics are always @10 |
| `--timeout=MS` | 5000 | Per-query statement timeout |
| `--golden=PATH` | `eval/golden.jsonl` | Which golden set to read |
| `--baselines=PATH` | `eval/baselines.md` | Which baselines table `--baseline` compares against |
| `--read-query` | off | Also run every query as the app reads it, and print both slices side by side |
| `--negatives=PATH` | `eval/negatives.jsonl` | Which negatives to run. A default file that is missing is a note; a path somebody named that is missing is a usage error |

`--baselines=` exists so the regression gate can be exercised against a
fixture. Without it the only way to see the gate fire was to edit a tracked
file, which meant the one check that fails builds was itself never tested.
A path given here that does not exist is a usage error (exit 1), not a pass:
a mistyped fixture path that quietly switches the gate off would be worse than
having no gate. A missing *default* `eval/baselines.md` still passes with a
notice, because that is the ordinary state before the first number is recorded.

`eval/scoring.test.mjs` needs no database and no network. Run it any time:
`node eval/scoring.test.mjs`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Everything passed |
| 1 | Usage or configuration: no `DATABASE_URL`, missing golden set, malformed JSONL |
| 2 | **Constraint violation** — a returned tool broke a hard filter |
| 3 | Connection or query error, including a statement timeout |
| 4 | Regression against the recorded baseline: nDCG@10 fell more than the tolerance, **or** more golden queries came back empty than the row records, **or** a smaller share of the negatives came back empty (see [The negatives](#the-negatives-sentences-the-catalogue-cannot-answer)) |

A constraint violation outranks the scores. If it fires, the run fails no matter
how good the numbers look, and the exit code stays 2 even if the run also
regressed — because a filter that leaks is a correctness bug, not a quality one.

## What each number means

### recall@10

Of every tool judged relevant for a query — any grade of 1, 2 or 3 — what
fraction turned up in the top ten?

```
recall@10 = |relevant AND in the top 10| / |relevant|
```

It ignores order entirely. It answers "did we find the right things at all",
which is the question that matters when the search is bad. A recall of 0.4 means
the search never even surfaced 60% of the good answers, and no amount of
reranking in a later phase can fix that — you cannot reorder a tool you did not
retrieve.

### nDCG@10

Order-sensitive quality, on a 0-to-1 scale where 1.0 means the top ten are the
ten best judged tools in the right order.

```
gain(rel) = 2^rel - 1              rel 3 -> 7,  rel 2 -> 3,  rel 1 -> 1,  unjudged -> 0

DCG@10  = SUM over i = 1..10 of  gain(rel at rank i) / log2(i + 1)

IDCG@10 = the same sum over this query's own judgements, sorted best-first

nDCG@10 = DCG@10 / IDCG@10
```

Three things about that formula are worth stating out loud, because a wrong
nDCG is worse than none — it looks authoritative:

- **The gain is exponential.** A grade-3 tool is worth more than two grade-2
  tools, which is what we want from a search meant to put the one right tool
  first.
- **The ideal comes from the query's own judgements**, not from an assumed row
  of perfect scores. A query whose best judged tool is a grade 1 can still reach
  nDCG 1.0 by returning it first. Anything else would punish queries for having
  modest answers.
- **A query with no judgements has an ideal DCG of zero.** There is no ratio
  there. The harness scores it 0 and prints it under "Golden set warnings" — an
  empty `relevant` map is a bug in the golden set, not a failure of the search.

Both metrics are **macro-averaged**: every query counts once, regardless of how
many relevant tools it has. A query with twelve good answers does not outvote a
query with one.

### Latency

`mean` is the average round trip for one `search_tools` call, measured in the
harness around the query only. `p95` is the **nearest-rank** 95th percentile:
sort ascending, take the value at `ceil(0.95 * n)`. No interpolation — with 60
queries, interpolating invents precision that is not there, and nearest-rank
always reports a latency that was actually observed.

These are *not* the numbers a user would see. There is no HTTP, no connection
setup, and no cold cache. Treat them as a floor and a regression alarm, not as a
product metric.

### Zero-result queries

How many queries returned nothing at all. This is the number a human acts on
first. In Phase 2 it is expected to be non-trivial — plain full-text search has
no idea that "split the bill" and "expense sharing" are the same thing — and
driving it down is most of what Phases 3 and 4 are for.

### Slices

The headline number hides where the search is weak, so it is broken down four
ways:

| Slice | What it tells you |
| --- | --- |
| `english` / `non-english` | Split on the query's `lang`. Phase 2 has no translation, so the non-English slice is expected to be poor; Phase 4 exists to move it |
| `constrained` / `unconstrained` | Whether the query carries a `pricing`, `platforms`, `flags` or `languages` filter. Constrained queries search a smaller pool, so they often score differently for reasons that have nothing to do with ranking quality |

### The five worst queries

The scores tell you *that* something is wrong; this tells you *what*. For each
of the five lowest-nDCG queries it prints the filters applied, what came back
with each result's grade, and every judged tool with where it actually landed —
`at 3`, `at 14, below the cutoff`, or `MISSING`. Those three cases have
completely different fixes. A tool at rank 14 is a ranking problem. A tool that
is `MISSING` from twenty results is a retrieval problem, and reranking will
never touch it.

## Constraint violations are a hard failure

Phase 2's central promise is that **"free" is never a vibe**. A constraint is a
`WHERE` clause, not a ranking signal: if someone says free, a paid tool does not
appear, however similar it looks.

So constraints are not scored, they are asserted. After the queries run, the
harness reads `pricing`, `platforms`, `flags` and `languages` straight from
`public.tools` for every slug that came back, and checks each returned row
against the constraints its query carried. Any violation prints loudly and
forces exit code 2 whatever the scores say.

It is checked against the **table**, not against what `search_tools` reported,
so a function that filters correctly but reports a wrong `pricing` column is
also caught — that would be a lie told directly to the user's screen.

**Semantics.** The harness is a second opinion on `search_tools`, so its rules
have to be *the same rules*, key for key — a divergence does not announce
itself, it just makes "0 constraint violations" certify less than it looks
like. Each row below names the SQL predicate it mirrors:

| Key | Rule | SQL in `0002_search.sql` |
| --- | --- | --- |
| `pricing` | **any-of**, membership | `t.pricing = any (v_pricing)` |
| `platforms` | **any-of**, overlap | `t.platforms && v_platforms` |
| `flags` | **all-of**, containment | `t.flags @> v_flags` |
| `languages` | **any-of**, overlap, wanted side lower-cased and trimmed first | `t.languages && v_langs` |

- `pricing: ["free","freemium","open_source"]` means the tool's pricing must be
  one of those three. `platforms: ["ios","android"]` means the tool must run on
  at least one of them, which is what "on my phone" means.
- `flags` is the odd one out, and deliberately: `["works_offline","no_ads"]`
  means *offline **and** no ads*. A tool declaring only one of them is out.
  A flag is a requirement someone stated, not an alternative they would accept.
- `languages: ["EN"]` matches a catalogue storing `en`, because `search_tools`
  lower-cases `p_languages` before comparing. Only the **wanted** side is
  folded — a catalogue row that stores `EN` is reported, not excused.
- A tool with an **empty** array cannot satisfy an overlap constraint, or any
  non-empty all-of requirement. That is deliberate: if a query asked for Spanish
  and the tool declares no languages, the catalogue does not support the claim
  that it fits.
- Independently of the query's constraints, every returned tool must have
  `status = 'published'`. `search_tools` carries that as an explicit predicate
  rather than leaning on row-level security — RLS lets an owner see their own
  drafts — so the harness asserts it separately.

Every one of these has a case in `eval/scoring.test.mjs`, including the all-of
flags case and the mixed-case language case, so a drift back to the wrong
semantics fails the self-test rather than passing quietly.

Violations are checked across every row returned, not just the top ten. A hard
filter that leaks at rank 17 is exactly as broken as one that leaks at rank 1.

## Vectors, and the one call that is not to Postgres

### What changed in Phase 3

`public.search_tools` gained a fifth ranking leg: cosine distance from the
sentence's embedding to each candidate tool's nearest problem statement
(`db/migrations/0004_vectors.sql`). It needs a vector for the query, and a
vector comes from a model provider, which is a network call — the thing this
harness had none of.

It is resolved by where the vector lives. Query vectors are cached in
PostgreSQL, keyed on the normalised sentence, and `search_tools` reads that
cache itself when no vector is passed. So the harness does not need to embed
during a run; it needs the cache to be warm.

### The warm-up

Before the first query is timed, and **before the session is put into read-only
mode**, the harness asks the database which of the sentences it is about to
search with have no cached vector, fills those it can from
`db/seed/embeddings.fixture.json`, embeds whatever is left in one batched
request through `lib/embeddings.ts`, and stores them. Then it seals the session
read-only and measures.

```
Foundit eval — 60 queries, metrics @10, fetching 20 rows each.
  query vectors: 0 already cached, 60 from the fixture, 0 embedded in 0 request(s), 0 prompt tokens.
```

**The fixture comes first, on purpose.** It holds the recorded float16 vectors
for all 60 golden sentences — exactly what a `halfvec` column stores — so a
laptop with a key and a runner without one warm the cache from the same numbers
and produce the same score. Before it existed, re-fetching the same 60
embeddings moved the headline by 0.0001, because the provider's float32 output
rounds into float16 differently between calls and two tools swap places on a
tie.

It is also the only reason the gate means anything on CI. There is no key
there, and there must not be; without recorded vectors a keyless run measured
the Phase 2 text-only search, so **setting the vector leg's weight to zero left
CI green** — an adversarial review made the point by doing it. With the fixture
loaded, the same change fails the gate by 0.18.

`scripts/embed.mjs --write-fixture` re-records it, from a freshly seeded
database, and costs one set of API calls.

That is the only write the harness makes anywhere, and it goes to
`public.query_embeddings`, which has no user column, no session column and no
foreign key to anything that has one. **It still never writes to
`search_events`**: a benchmark must not pollute the analytics it exists to
inform, and that rule is unchanged.

### Why warming is not cheating

The application's path on a cache **miss** is: search (text-only, told a vector
is missing), embed, store, search again with the vector. The second search is
what the visitor sees, and it is byte for byte what a cache **hit** produces —
both are `search_tools` with the same vector. The two differ in latency and in
nothing else.

So the harness measures the cached path, which is the shipped steady state:
every repeat of every sentence, by anybody. Three properties are worth more
than reproducing the miss:

- the measured pass stays read-only, structurally rather than by promise;
- the latency is the latency people will actually see, not that of a
  first-ever sentence waiting on a model provider;
- **a run needs no API key once the cache is warm**, so CI measures the same
  number as a laptop and calls nothing.

### With no key and no fixture

It degrades exactly as the application does. Sentences with no vector from
either source are searched text-only, the run says how many, and the number is
honestly lower rather than absent:

```
  query vectors: 0 already cached, 0 from the fixture, 0 embedded in 0 request(s), 0 prompt tokens.
  NOTE: 60 sentence(s) are neither cached nor in the fixture, and EMBEDDINGS_API_KEY
        is not set; those queries measure text-only, exactly as the application
        would serve them
```

Measured: **0.4878, 4 zero-result — the Phase 2 row to four decimals.** The
vector leg is purely additive, and `--baseline` compares that run against the
text-only row rather than the hybrid one, so a developer with no key gets a
real full-text gate instead of a red build.

The key is read from `EMBEDDINGS_API_KEY` and from nowhere else, it is never
printed, and every failure message from the embedder carries a short reason and
neither the key nor the text that was being embedded.

## Measuring the reader: `--read-query`

### Why this exists

Nobody types constraints.

The harness's default run takes `constraints` straight out of `eval/golden.jsonl`
and hands them to `search_tools`, and gives it the whole sentence as the search
text. That is a legitimate measurement — it isolates the ranker, with the reading
held correct by assumption — but it is not the product. A visitor types one
sentence. `lib/constraints.ts` decides which phrases in it are filters, turns
those into typed arguments, **removes them from the text**, and only the residue
is ranked on. Until this flag existed, that entire first step was outside the
instrument, and so was every defect in it.

That is not a hypothetical gap. Two examples, both real:

- A bug that put Proton Mail, Proton VPN and PDFsam Basic above every expense
  splitter for any query containing the word "free" was found and fixed, and the
  recorded score did not move by a single point. The harness had never read a
  sentence in its life, so it could not have moved.
- A review found the reader turning "a website builder" into a web-only filter,
  then ranking on the word "builder". Also invisible here, for the same reason.

A quality gate that cannot see the code that ships is not a quality gate for
that code. `--read-query` closes that.

### What it does

It runs every golden query **twice**, against the same database, scored by the
same functions, against the same judgements. The two runs differ in exactly one
thing — where the text and the constraints came from:

| Slice | Search text | Constraints | Measures |
| --- | --- | --- | --- |
| `authored` | the whole sentence | hand-written in `golden.jsonl` | the ranker, alone |
| `derived` | `readQuery(sentence).text` | `toSearchConstraints(readQuery(sentence).constraints)` | the reader **and** the ranker — what ships |

Then it prints both, and the difference between them:

```
slice        n  recall@10  nDCG@10  mean ms  p95 ms  zero
authored    60     0.4497   0.4878    209.5   342.0     4
derived     60     0.4600   0.4816    251.0   404.5     4
DIVERGENCE        +0.0103  -0.0062    +41.5            +0
```

**`DIVERGENCE` is the interesting number, not the two rows above it.** It is not
a second opinion on the ranker; it is the size of the part of the shipped search
that the default run cannot see. A ranking fix that mostly helps queries the
reader mangles first will move the `derived` row and leave `authored` exactly
where it was — which is precisely what happened, unmeasured, the last time one
landed.

Underneath, three more things are reported:

- **Per-query counts** — how many queries scored worse, better, or unchanged.
  A divergence near zero in aggregate can still be two large errors cancelling.
- **What the reader did to the constraints**, in four buckets. `same`, then
  `more` (the golden set states no filter and the reader applied one anyway —
  this silently deletes correct answers), `less` (a stated filter went unread —
  this lets wrong answers back in), and `other` (both filter, differently). The
  two asymmetric buckets fail in opposite directions and are counted separately.
- **Every query where the reading costs nDCG**, worst first, showing both
  readings of that sentence side by side: the filters each pass sent, the text
  each pass searched, and which constraint keys the reader says it understood.
  That is enough to tell a reader bug from a ranker bug without a second run.

### What it does not do

- **It changes nothing by default.** Without the flag, not one query, not one
  line of output, not one field of the JSON differs; `lib/constraints.ts` is not
  even imported (the import is dynamic for exactly that reason).
- **It needs no edit to `eval/golden.jsonl`.** The derived slice reads the same
  `query` string the authored slice reads. The golden set stays the golden set.
- **It does not touch the regression gate.** `--baseline` still compares the
  `authored` nDCG@10 against `eval/baselines.md`. Gating builds on the derived
  number would be gating on two moving parts at once, and Phase 4 is about to
  move one of them a long way.
- **It asserts nothing about the reader's rules.** It never checks that a
  particular rule exists, matches a particular phrase, or produces a particular
  key. Constraint keys are carried through as opaque strings that are only ever
  printed.

A constraint violation in the derived slice **does** fail the run (exit 2), for
the same reason one in the authored slice does: it means `search_tools` returned
a row that the arguments it was given exclude, which is a `WHERE` clause leaking.
A reader that fails to read a constraint is not a violation — nothing was asked,
so nothing leaked — and shows up as `less` in the buckets and as lost nDCG.

### The one seam, and how to keep it

`eval/reader.mjs` is the only file in `eval/` that names the reader. It depends
on **two exported functions and nothing else**:

```js
readQuery(sentence)      -> { constraints, text, emptyText }
toSearchConstraints(cs)  -> { pricing, platforms, flags, languages }
```

composed in the same order `app/results/page.tsx` composes them. **Phase 4
replaces `lib/constraints.ts` wholesale.** When it does, this mode survives if
those two names still mean those two things; if Phase 4 renames or reshapes them,
`eval/reader.mjs` is the single file to update, and the numbers it reports change
on their own — which is the whole point.

## The negatives: sentences the catalogue cannot answer

### Why this exists

nDCG only ever asks questions that have answers. Phase 3's vector leg ranks
every eligible tool, so a sentence the catalogue cannot answer came back with
its twelve nearest neighbours under a heading that sounded sure of them — and
nDCG scored that exactly as it scored an honest empty page, because neither
has a judged tool in it. The owner saw the result and called it ridiculous.
`db/migrations/0006_relevance_floor.sql` is the fix, and a fix nobody can
measure is a fix nobody can keep, so the instrument grew a second half.

`eval/negatives.jsonl` holds 30 sentences whose right answer is an empty page:

| Kind | n | What they are |
| --- | --- | --- |
| `far` | 15 | Nothing to do with software at all: car repair, a divorce lawyer, a waterproof jacket, a plumber, a babysitter, a skin cream. Ten English, five not (Hebrew ×2, Spanish, Russian, Arabic) |
| `near` | 15 | Share words with real listings and want something none of them does: "translate what my cat is trying to tell me" (DeepL translates between people), "back up my WhatsApp chats" (the backup tools back up a computer), "find someone to clean my flat" (Tody tracks cleaning; it is not a cleaner). Fourteen English, one French |

One of them (`n10`) carries a pricing constraint, so the empty answer is also
exercised on a constrained search. Each line's `note` says what it asks for
and, for a near miss, which listings share its words and why none of them
serves it.

It is a **separate file** and is never merged into `eval/golden.jsonl`. The
parser refuses a negative that carries a `relevant` map: a sentence with a
right tool is a golden query, and this file must not become a side door into
the golden set.

### The held-out set

`eval/negatives.review.jsonl` is 25 more sentences, written by an adversarial
reviewer **before reading ours** and never tuned against: ten far, ten near
misses, five non-English. It is the only number here that says whether a floor
generalises rather than fits.

It is read exactly as its author wrote it — `q` rather than `query`, a `nonen`
kind the first file never used — because editing a held-out file to suit the
parser is editing the measurement. `--baseline` gates it separately, against
its own `Held-out empty` column.

The first floor this project shipped scored 86.7% on the file it was tuned on
and **40% on this one**. That gap is what a held-out set is for.

### The perturbation gate

Every golden query is also searched four more ways: with a full stop, with a
question mark, with " please", and with one interior letter transposed
(`eval/perturb.mjs` defines them, and both the harness and the fixture writer
import it so the recorded vectors and the searched sentences cannot drift).

The only thing read off those 240 searches is whether any came back **empty**,
and the gate is zero whenever the floor is running.

This exists because the first floor was an absolute threshold that golden q052
sat 0.0015 above: a full stop moved its vector by more than that, and the page
emptied. Nobody types a sentence twice the same way. A search that answers a
question only in its canonical spelling does not answer it.

### How the sentences were checked

Every candidate was checked against the published catalogue before it was
kept — all 223 tools' names and summaries and all 504 problem statements,
dumped from the development database into one file and read against each
sentence. A candidate was dropped if any listing plausibly serves it, and nine
were: cheap flights next week (Google Flights, Skyscanner), filing a small
business's tax return (GnuCash keeps the books), splitting the rent with
flatmates (Tricount and Splitwise do exactly that), recording a phone call
(Otter records a call on speaker), turning holiday footage into a film
automatically (CapCut's templates), streaming a service from another country
(Proton VPN), digitising VHS tapes (OBS records a capture device), a mortgage
calculator (Wolfram Alpha), and hiring a car at an airport (Rome2Rio lists
driving). What was left is the 30 in the file.

The same rule as the golden set: **a negative is never edited or deleted to
make a number move.** The one legitimate reason to remove one is that the
catalogue changed — a tool that really does serve it was added — and then it
is removed with a note saying which tool, and the baseline row gets a note too.

### What the run reports

The negatives go through exactly the search, plan and fetch limit the golden
queries do, and the report puts the two side by side:

```
negatives    n  empty  empty %  mean leaked  max  far empty  near empty
----------  --  -----  -------  -----------  ---  ---------  ----------
as written  30     26    86.7%          2.2   20      14/15       12/15

  beside the golden set: nDCG@10 0.7035, recall@10 0.6719, 0 of 60 golden queries empty
```

- **empty %** — the share that came back with nothing at all. The headline,
  and what `--baseline` gates.
- **mean leaked** — rows returned per negative, averaged over all 30, at the
  fetch limit (20). One negative leaking a single tool and one leaking twenty
  are both wrong; this is the number that tells them apart.
- Every negative that leaked is listed with its first five rows, so a leak can
  be read rather than guessed at.

With `--read-query` the negatives run a second time as the app reads them, and
get their own row.

A constraint violation on a negative fails the run with exit 2, exactly as on
a golden query.

### Vectors, and the fixture

The floor only applies when the sentence has a vector (0006, point D), so the
negatives measure nothing unless their vectors are there. The fixture holds
them — the 30 as written and their `--read-query` readings, 32 new sentences
in all — so CI measures the floor with no key. `scripts/embed.mjs
--write-fixture` now **extends** an existing fixture with only the sentences
and statements it lacks, and never re-fetches one it already holds: a
re-fetched vector rounds into float16 differently and moves the golden number
in the fourth decimal for a reason nobody changed. Extending it for the
negatives left all 576 existing entries byte-identical.

With no key and no fixture, the floor does not apply, the negatives leak as
they did in Phase 3, and the run is compared against the text-only row —
which records no negatives, so nothing is gated on them.

## The reranker: `--rerank`, `--rerank-n=`, `--record-reranks`

### Why this is in the harness rather than in a script

Every other paid call has a recording job of its own — `scripts/embed.mjs`,
`scripts/read.mjs` — and this one does not. It needs the sentence planned, the
restatement's vector resolved and the search run before it knows what its
candidates even are, and all three of those already live here. A second
implementation of "plan, search, take the top N" is exactly the divergence the
Phase 4 review found and the Phase 3 review found before it, in two costumes.

So `--record-reranks` calls the model for any (sentence, candidate set) the
fixture does not hold and writes the answers into it. It is **the one path in
this harness that spends money**, it is never on by default, it prints a note
saying so, and it is the only thing that leaves the session writable.

### What it measures

The reranker is **on by default from Phase 5**, because it is what a visitor
gets, and `--no-rerank` measures the Phase 4 search. Both numbers are in
`eval/baselines.md` and the before/after there was taken with exactly that flag.

`--rerank-n=N` sets how many candidates are judged. The cache is keyed on the
sentence AND on a hash of the candidate slugs, so a run at a different N asks a
different question and files its answers separately — which is what made
measuring 20, 30 and 50 three runs rather than three fixtures.

The pass fetches `max(--limit, N)` rows, judges the top N, drops everything
graded 0, and cuts what is left back to `--limit` before scoring. That is the
application's own order of operations with the application's own two numbers.

### What it does not do

**It does not rerank the reference pass.** That pass is the ranker in isolation
— the Phase 2 and 3 instrument — and its job is to say whether the instrument
moved under the number. Reranking it would make it a second measurement of
Phase 5 rather than a control, and would double the judgements to record,
because a different plan produces a different candidate set and therefore a
different key.

**It decides nothing itself.** Which candidates are judged, what the cache key
is and what the final order is are `rerankCandidates`, `candidatesHash` and
`applyRerank` in `lib/rerank.ts`, and `app/results/page.tsx` calls the same
three. `tests/parity.test.mjs` asserts both callers get the same answer from the
same rows, and greps both files for a hand-rolled sort or hash.

### The fixture's schema version did not move, and that is a decision

`foundit-embeddings/3` still. The version exists to refuse a fixture that would
measure a DIFFERENT SEARCH while looking like the right one — which is what a
pre-`0007` fixture did, because it held no tool-summary vectors and half the
vector leg came back empty with nothing saying so.

A fixture with no `reranks` does not fail that way. Every run prints how many
judgements it loaded and how many sentences have none, the reranker section
says the Phase 4 order was measured for those, and `--baseline` then goes red
against a row recorded with the reranker running. That is loud in three places,
so it does not also need to be a refusal — and bumping the version would make
every fixture anybody has on disk unreadable to `scripts/embed.mjs` for a
reason that is already visible.

### A sentence with no recorded judgement

Measures the Phase 4 order, and is counted and printed:

```
  searches with a judgement     320 of 341
  searches with none recorded   11  (these measure the Phase 4 order)
```

That second line is the one to read before believing a headline. A run where a
tenth of the sentences had no judgement is a run measuring nine parts Phase 5
and one part Phase 4, and the only way to see it is to print it.

## Regressions

`--baseline` reads the last row of the recorded-baselines table in
`eval/baselines.md` that has numbers in it and compares nDCG@10 against it.

**Two more gates read the same row**, both added with the relevance floor:

- **Zero-result.** The run may not have more golden queries come back empty
  than the row's `Zero-result` column records. A floor that empties a golden
  query is too high for that query whatever the negatives say. (A count, not
  a per-query list; every row the floor has been measured against records 0,
  where the two are the same thing.)
- **Negatives empty.** The share of `eval/negatives.jsonl` answered with an
  empty page may not fall below the share in the row's `Negatives empty`
  column. A rate, so adding negatives later does not trip it by arithmetic.
  If the row records negatives and none were run, that FAILS — a gate that
  switches itself off when its input file goes missing is not a gate.

Both are skipped for a row that leaves the column blank, which is every row
recorded before the floor.

**Tolerance: 0.005 absolute** — half a point of nDCG, inclusive at the boundary
(a drop *of* 0.005 passes; a drop *past* it does not). The harness is
deterministic, so in principle any drop is real; the tolerance exists for the
one genuine source of noise, which is ties in `ts_rank` broken by whatever order
the planner happened to produce. A change that costs more than half a point is a
regression and someone has to say why. Raising the tolerance requires a written
reason in `eval/baselines.md`, because quietly widening the gate is how a
measuring instrument stops measuring.

With no baseline recorded yet, `--baseline` says so and passes. It never invents
one.

## JSON output

`--json` writes `eval/results/<timestamp>.json`, git-ignored, containing the
overall numbers, every slice, every violation, the regression verdict, and each
query's full result list with grades attached. Use it for plotting a trend
across phases or diffing two runs.

The filename flattens the ISO timestamp (`2026-09-10T09-15-00-000Z`) because
colons are illegal in Windows filenames; the true timestamp is inside the file.

With `--read-query` the payload carries an extra top-level `readQuery` object:
both slices' aggregates, the divergence, the bucket counts, any derived-slice
violations, and a per-query row with both readings of the sentence. Without the
flag that field is `null`, so the shape of a default run's JSON is unchanged and
anything already reading it keeps working.

Since Phase 5 there is a top-level `rerank` object — the model, the candidate
count, and the counts from the reranker section above — and every returned row
carries `relevance`, which is what the judgement said about it or `null` where
the reranker did not run. That per-row field is what `eval/calibrate.mjs` fits
against the day there are judged pairs to fit. `rerank` is `null` on a
`--no-rerank` run, so the two kinds of run are told apart in the file rather
than by arithmetic on the numbers.

## If you are about to change something here

The harness is the thing that decides whether every later phase shipped or got
reverted. Two rules:

1. **Change the search, not the ruler.** If a number is disappointing, that is
   information, not a bug in this file.
2. **If you touch the arithmetic, `eval/scoring.test.mjs` must still pass.** It
   checks the scoring against cases worked out by hand — perfect ranking is
   exactly 1, a lone grade-3 hit at rank 3 is exactly 0.5, a relevant tool at
   rank 11 contributes exactly nothing — with the working written next to each
   one. It needs no database. It has already caught real errors in the values in
   this file, which is the only reason to trust them.
