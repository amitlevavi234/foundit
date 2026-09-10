# The eval harness

This is the measuring instrument. Phase 2 builds a search with no AI in it, and
every phase after it has to beat the number this harness produces. That only
works if the harness is trustworthy and boring, so it is: no model calls, no
network beyond PostgreSQL, no colour codes, no randomness, no cleverness in the
arithmetic that a reader cannot check by hand.

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
hardcoded, no default is guessed, no `.env` file is read, and no connection
string or password is ever printed — every error message is passed through a
redactor first. Set it for the one command rather than exporting it, and point
it at a **read-only role**: the harness only ever runs `SELECT`, and it puts the
session into read-only mode on connect to make that structural rather than a
promise.

It needs `public.search_tools` (from `db/migrations/0002_search.sql`) and a
loaded catalogue. Without the function it exits 3 and says so.

| Script | What it does |
| --- | --- |
| `npm run eval` | Run and print the table |
| `npm run eval:json` | Also write `eval/results/<timestamp>.json` |
| `npm run eval:baseline` | Check for regression against `eval/baselines.md`, write JSON |
| `npm test` | The scoring self-test, then the eval with the regression check |

| Flag | Default | Meaning |
| --- | --- | --- |
| `--json` | off | Write machine-readable results to `eval/results/` |
| `--baseline` | off | Compare against the last recorded row in `eval/baselines.md` |
| `--limit=N` | 20 | Rows requested per query. Metrics are always @10 |
| `--timeout=MS` | 5000 | Per-query statement timeout |
| `--golden=PATH` | `eval/golden.jsonl` | Which golden set to read |

`eval/scoring.test.mjs` needs no database and no network. Run it any time:
`node eval/scoring.test.mjs`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Everything passed |
| 1 | Usage or configuration: no `DATABASE_URL`, missing golden set, malformed JSONL |
| 2 | **Constraint violation** — a returned tool broke a hard filter |
| 3 | Connection or query error, including a statement timeout |
| 4 | Regression: nDCG@10 fell more than the tolerance below the recorded baseline |

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

**Semantics**, which matter because a false alarm here fails a build:

- A constraint array is **any-of**. `pricing: ["free","freemium","open_source"]`
  means the tool's pricing must be one of those three.
- `pricing` is a scalar on the tool, so it is tested with membership.
- `platforms`, `flags` and `languages` are arrays on the tool, so they are tested
  with **overlap** — the same `&&` a SQL `WHERE` clause would use.
  `platforms: ["ios","android"]` means the tool must run on at least one of them,
  which is what "on my phone" means.
- A tool with an **empty** array cannot satisfy an overlap constraint. That is
  deliberate: if a query asked for Spanish and the tool declares no languages,
  the catalogue does not support the claim that it fits.

Violations are checked across every row returned, not just the top ten. A hard
filter that leaks at rank 17 is exactly as broken as one that leaks at rank 1.

## Regressions

`--baseline` reads the last row of the recorded-baselines table in
`eval/baselines.md` that has numbers in it and compares nDCG@10 against it.

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
