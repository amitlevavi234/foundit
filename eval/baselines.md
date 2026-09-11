# Baselines

The recorded score of the search, one row per phase. This file is the memory of
the project: it is how anyone can tell, six months from now, whether the clever
thing that shipped in Phase 5 actually helped.

**`node eval/run.mjs --baseline` reads the last row of the table below that has
numbers in it and fails the run if nDCG@10 has fallen more than 0.005 beneath
it.** Rows left blank are treated as not yet recorded and are skipped, so the
empty Phase 2 row costs nothing until it is filled in.

**The `Vectors` column decides which row a run is compared against.** Since
Phase 3 a run has a mode: either every sentence had a query vector, or some did
not — no `EMBEDDINGS_API_KEY`, a cold cache, a provider that was down. Those two
produce different numbers from the same code, so the gate picks the newest row
recorded in the same mode. A run with no key is a text-only run and is measured
against the text-only baseline, which is the honest comparison and is why CI can
still catch a full-text regression without a key.

## How a row gets added

1. Apply the migrations, load the seed, and run `npm run eval:baseline`.
2. The run must exit 0. A run with a constraint violation is not a baseline; it
   is a bug report.
3. Copy the numbers off the "Overall" and "Slices" tables into a new row at the
   **bottom** of the table. Newest last.
4. `Commit` is the short SHA the numbers were produced from — `git rev-parse --short HEAD`
   with a clean tree. Numbers from a dirty tree are not reproducible and are not
   a baseline.
5. `What changed` is one line. Not a changelog: the single thing that moved the
   number, or "first recorded".

A number that goes down is recorded anyway, with the reason. The table is a
record of what happened, not a highlight reel.

## The rule that outranks all of this

**The golden set is never edited to make a score move.** If a change makes the
number worse, the change is wrong. Editing `eval/golden.jsonl` to rescue it
destroys the only instrument the project has. New queries may be *added* to
cover ground the set misses — and when they are, every earlier row below becomes
incomparable and the table gets a horizontal rule and a fresh start, with the
size of the set noted.

## Recorded baselines

| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero-result | What changed |
| ---- | ------ | ----- | ------- | ------- | --------- | ------- | ------- | ------ | ----------- | ------------ |
| 2026-09-10 | 364779b | 2 | no | 60 | 0.5406 | 0.6876 | 11.4 | 17.3 | 0 of 60 | **WITHDRAWN — see below.** Not a baseline. |
| 2026-09-10 | 39569ba | 2 | no | 60 | 0.4497 | 0.4878 | 49.7 | 90.9 | 4 of 60 | First trustworthy baseline. Statements rewritten from each tool's own summary with the golden set unopened; measured as `foundit_app`, not the owner. |

### Phase 2, by slice

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms |
| ----- | - | --------- | ------- | ------- | ------ |
| english | 50 | 0.5937 | 0.7341 | 12.0 | 18.2 |
| non-english | 10 | 0.2750 | 0.4550 | 8.1 | 10.2 |
| constrained | 17 | 0.6392 | 0.6837 | 11.3 | 45.6 |
| unconstrained | 43 | 0.5016 | 0.6891 | 11.4 | 17.3 |

### Why this row is withdrawn

I wrote, in this file, that nothing had been tuned to hide the weakness in the
non-English slice. That was not true, and an adversarial review proved it.

The catalogue and the golden set were written by the same hand in the same
commit, and the problem statements — the text search actually matches against —
came out as near-paraphrases of the queries meant to find them. 37 of 60
queries had a graded-relevant tool sharing 60% or more of the query's content
words. Deleting 8% of the statements dropped golden hits from 112 to 98. Worse,
17 of 504 statements were non-ASCII and sat precisely on the grade-3 answers of
the non-English queries: deleting them halved non-English recall. The one query
scoring a perfect 1.0000 was one of the paraphrases.

The judgements were not read off the results — recall is 0.54 and plenty of
graded tools come back missing — so the golden set itself is sound. But the
corpus was shaped so that lexical search would find the answers, which is the
same failure approached from the other side.

Two further reasons this row could not stand:

- **It was measured as a superuser.** The connection used `foundit_owner`
  (`rolsuper`, `rolbypassrls`). Result sets are identical under the application
  role, so the quality figures were not affected, but latency roughly trebles —
  the recorded 11.4 ms mean is about a third of what the application will see.
- **A fourth ranking leg was added in the same commit that created the golden
  set.** The AND-to-OR change was a bug fix, but adding a weighted fusion leg is
  ranking design, and it landed alongside the answer key.

A number nobody can trust is worse than no number, because Phase 3 would have
spent its effort clearing a bar that was never real. The statements are being
rewritten from each tool's own description with the golden set unopened, and
the baseline will be re-measured under the application role.

## Per-slice detail

The headline number hides where the search is weak. Record the slices too — the
non-English slice in particular is the one Phase 4 exists to move.

| Date | Phase | Slice | Queries | recall@10 | nDCG@10 |
| ---- | ----- | ----- | ------- | --------- | ------- |
|  | 2 | english |  |  |  |
|  | 2 | non-english |  |  |  |
|  | 2 | constrained |  |  |  |
|  | 2 | unconstrained |  |  |  |

> Only the first table drives `--baseline`. The parser reads columns by name and
> only accepts a table whose header carries both `Commit` and `nDCG@10`, so this
> one is ignored no matter what is filled into it.

## Targets each later phase has to clear

| Phase | Has to beat | Where the document says so |
| ----- | ----------- | -------------------------- |
| 3 — vectors | Phase 2's nDCG@10 | `docs/build-phases.md` §Phase 3 gate |
| 4 — sentence understanding | Phase 3, especially the non-English slice | §Phase 4 gate |
| 5 — ranking | Phase 4, each of the three steps measured separately | §Phase 5 gate |


---

## Phase 2, the real baseline — 39569ba

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero |
| ----- | - | --------- | ------- | ------- | ------ | ---- |
| all | 60 | 0.4497 | 0.4878 | 49.7 | 90.9 | 4 |
| english | 50 | 0.5080 | 0.5514 | 50.9 | 92.4 | 0 |
| non-english | 10 | 0.1583 | 0.1700 | 43.7 | 84.6 | 4 |
| constrained | 17 | 0.4588 | 0.4454 | 37.9 | 90.9 | 3 |
| unconstrained | 43 | 0.4461 | 0.5046 | 54.3 | 92.4 | 1 |

Constraint violations: **0**. Permission suites: **2 of 2 passing**.

**It went down, and that is the point.** nDCG fell from a withdrawn 0.6876 to
0.4878 and latency roughly quadrupled. Nothing got worse: the first number was
measured against a corpus written to be found and through a connection that
bypassed row-level security. This one is what the product does.

**Non-English collapsed to 0.17, with four queries returning nothing at all.**
That is the honest state of a search whose documents are indexed with
`to_tsvector('english', ...)`. Hebrew, Arabic and Russian get no stemming, so
only exact word forms can match, and the earlier 0.455 came almost entirely
from planted statements that repeated the query. This is the single largest
known weakness in the product and Phase 4 owns it.

**Four tools carry a caveat.** The brief that commissioned the rewrite quoted
four golden queries verbatim as examples of the problem, so the statements for
keepassxc, home-assistant, audacity and signal were written with partial
knowledge of the answer key. Treat their scores as the least trustworthy in the
set. That was my error in writing the brief, not the agent's in following it.

**Latency is now measured as `foundit_app`** — 49.7 ms mean, 90.9 ms p95,
against 6.3 / 10.8 for the owner on the same queries. Phase 3's "cached
searches under 150 ms" is set against these figures, which is what a visitor
will experience.
