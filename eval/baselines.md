# Baselines

The recorded score of the search, one row per phase. This file is the memory of
the project: it is how anyone can tell, six months from now, whether the clever
thing that shipped in Phase 5 actually helped.

**`node eval/run.mjs --baseline` reads the last row of the table below that has
numbers in it and fails the run if nDCG@10 has fallen more than 0.005 beneath
it.** Rows left blank are treated as not yet recorded and are skipped, so the
empty Phase 2 row costs nothing until it is filled in.

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

| Date | Commit | Phase | Queries | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero-result | What changed |
| ---- | ------ | ----- | ------- | --------- | ------- | ------- | ------ | ----------- | ------------ |
| 2026-09-10 | 364779b | 2 | 60 | 0.5406 | 0.6876 | 11.4 | 17.3 | 0 of 60 | **WITHDRAWN — see below.** Not a baseline. |

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
|  |  | 2 |  |  |  |  |  |  |  |

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
