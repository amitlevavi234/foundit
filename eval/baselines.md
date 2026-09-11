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
recorded in the same mode. A run with no key and no fixture is a text-only run
and is measured against the text-only baseline, which is the honest comparison.

**`Zero-result` and `Negatives empty` are gates too, since the relevance
floor.** A run may not leave more golden queries empty than the row records,
and may not answer a smaller share of `eval/negatives.jsonl` with an empty
page than the row records — a rate, so a longer negatives file does not trip
it by arithmetic. A row that leaves either column blank gates nothing on it,
which is every row recorded before the floor. If a row records negatives and
the negatives were not run at all, that fails: a gate that switches itself off
when its input file goes missing is not a gate.

**A row marked WITHDRAWN is skipped**, whatever numbers are in it. The one
below is kept because deleting it would hide what happened, not because it is a
baseline.

**CI has no key and still measures the hybrid search.**
`db/seed/embeddings.fixture.json` holds the 504 statement vectors and the 60
golden query vectors as float16; `scripts/embed.mjs --from-fixture` loads the
first and `eval/run.mjs` warms the cache from the second, both with no network
call. Without it a keyless run measured the Phase 2 number and the gate said
nothing at all about the vector leg — setting the leg's weight to zero left CI
green, which an adversarial review demonstrated by doing it. With it, the same
change fails the gate by 0.18.

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

| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero-result | Negatives empty | What changed |
| ---- | ------ | ----- | ------- | ------- | --------- | ------- | ------- | ------ | ----------- | --------------- | ------------ |
| 2026-09-10 | 364779b | 2 | no | 60 | 0.5406 | 0.6876 | 11.4 | 17.3 | 0 of 60 | | **WITHDRAWN — see below.** Not a baseline. |
| 2026-09-10 | 39569ba | 2 | no | 60 | 0.4497 | 0.4878 | 49.7 | 90.9 | 4 of 60 | | First trustworthy baseline. Statements rewritten from each tool's own summary with the golden set unopened; measured as `foundit_app`, not the owner. |
| 2026-09-11 | bc9abfe | 3 | yes | 60 | 0.6747 | 0.7019 | 72.6 | 115.3 | 0 of 60 | | Hybrid retrieval: a fifth RRF leg at weight 3.0, cosine distance over `tool_problems.embedding` (`text-embedding-3-small`, 512 dimensions, `halfvec`), ranking only the constraint-filtered candidate set. |
| 2026-09-11 | 654f29d | 3 | yes | 60 | 0.6747 | 0.7018 | 66.7 | 117.2 | 0 of 60 | | The adversarial review's fixes. The search is unchanged; the -0.0001 is float16 rounding, now frozen by `db/seed/embeddings.fixture.json`. **This is the reproducible one** — every run, laptop or CI, key or no key, warms from the same recorded vectors. |
| 2026-09-11 | 9634cd6 | 3 | yes | 60 | 0.6719 | 0.7035 | 82.5 | 122.5 | 0 of 60 | 26 of 30 | **The relevance floor** (`0006_relevance_floor.sql`), after the owner's review. A result is returned only with evidence — close enough in meaning, every term of the sentence, or a close name. The golden set barely moves; the 30 sentences in `eval/negatives.jsonl` go from 0 of 30 answered with an empty page to 26 of 30, and from 20.0 to 2.2 rows leaked each. See "Phase 3 amended" below. |

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

---

## Phase 3, the real baseline — 654f29d

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero |
| ----- | - | --------- | ------- | ------- | ------ | ---- |
| all | 60 | 0.6747 | 0.7018 | 66.7 | 117.2 | 0 |
| english | 50 | 0.6847 | 0.7211 | 67.7 | 122.9 | 0 |
| non-english | 10 | 0.6250 | 0.6052 | 61.3 | 103.3 | 0 |
| constrained | 17 | 0.7020 | 0.6834 | 64.9 | 117.2 | 0 |
| unconstrained | 43 | 0.6640 | 0.7090 | 67.4 | 122.9 | 0 |

Constraint violations: **0**. Permission suites: **3 of 3 passing**. Warmed from the recorded fixture, so this run called nothing and is reproducible exactly.

`--read-query`, the slice that measures the reader and the ranker together —
the path a visitor actually takes:

| Slice | recall@10 | nDCG@10 | Phase 2 | Change |
| ----- | --------- | ------- | ------- | ------ |
| authored | 0.6747 | 0.7018 | 0.4878 | **+0.2140** |
| derived (`--read-query`) | 0.6781 | 0.6834 | 0.4785 | **+0.2049** |

The divergence between the two is **-0.0183 nDCG**, against -0.0093 in Phase 2.
The reader costs roughly twice what it cost before, which is not the reader
getting worse — it is the ranker getting better, so a constraint the reader
fails to read now costs more. Six queries carry all of it and five of the six
are the same failure: "without paying for anything", "no server involved at
all" and "without uploading my documents" are not read as constraints at all.
That is Phase 4's list, already written.

### Where it moved

| Slice | Phase 2 | Phase 3 | Change |
| ----- | ------- | ------- | ------ |
| all | 0.4878 | 0.7018 | +0.2140 |
| english | 0.5514 | 0.7211 | +0.1697 |
| **non-english** | **0.1700** | **0.6052** | **+0.4352** |
| constrained | 0.4454 | 0.6834 | +0.2380 |
| unconstrained | 0.5046 | 0.7090 | +0.2044 |
| zero-result queries | 4 of 60 | 0 of 60 | -4 |

**Non-English was the single largest known weakness in the product** and it is
where most of this went. Documents are indexed with
`to_tsvector('english', ...)`, so Hebrew, Arabic and Russian could only ever
match on exact word forms; an embedding does not care what language the
sentence is in. It is not fixed — 0.6052 against English's 0.7212 is still a
gap, and Phase 4 owns closing it — but it is no longer a search that returns
nothing.

### The weight sweep

The vector leg's weight is the one number Phase 3 tuned. Every value tried, in
the order it was tried, each a full 60-query run against the same database and
the same golden set:

| Weight | recall@10 | nDCG@10 | | Weight | recall@10 | nDCG@10 |
| ------ | --------- | ------- | - | ------ | --------- | ------- |
| 0.5 | 0.5733 | 0.5989 | | 2.75 | 0.6747 | 0.7021 |
| 0.75 | 0.5775 | 0.6258 | | **3.0** | **0.6747** | **0.7018** |
| 1.0 | 0.5981 | 0.6417 | | 3.25 | 0.6747 | 0.7025 |
| 1.25 | 0.6147 | 0.6558 | | 3.5 | 0.6822 | 0.7029 |
| 1.5 | 0.6222 | 0.6660 | | 4.0 | 0.6767 | 0.7015 |
| 2.0 | 0.6394 | 0.6766 | | 6.0 | 0.6728 | 0.6948 |
| 2.5 | 0.6692 | 0.6952 | | 10.0 | 0.6508 | 0.6895 |
| | | | | 100.0 | 0.6447 | 0.6781 |

*(the 3.0 row above reads 0.7018 and the recorded baseline reads 0.7019: the
sweep ran against a database whose 504 statement vectors came from an earlier
job run, and float16 rounding of two separately-fetched embeddings of the same
text differs in the last bit. The difference is 0.0001 and is noise.)*

Three things that curve says:

- **The plateau is flat from 2.75 to 4.0** — four values within 0.0014 of each
  other. 3.5 is nominally best and picking it would be fitting the last
  thousandth of sixty queries. 3.0 sits in the middle and is a number somebody
  can remember.
- **It falls again after 4.0.** At 100.0 the other four legs are
  arithmetically irrelevant and the search is pure vector — 0.6781, below the
  fused 0.7018. The lexical legs are still earning their place; this is a
  fusion, not a vector search with decorations.
- **1.0 was leaving most of the gain on the table.** The leg started there,
  because "hybrid" sounds like it should mean peers, and the golden set said
  otherwise.

### Known weaknesses of this number

- **It was reproducible to about a ten-thousandth, not exactly — and now it is
  exact.** Emptying the query cache and re-fetching the same 60 embeddings
  moved the headline from 0.7019 to 0.7020: the provider's float32 output
  rounds into `halfvec`'s float16 differently between calls, two tools swap
  places on a tie, and the number moves in the fourth decimal.
  `db/seed/embeddings.fixture.json` removed that. Every run — laptop or CI, key
  or no key — now warms the cache from the same recorded float16 vectors, so
  the number is the same number. It settled at **0.7018**, a ten-thousandth
  below the first recording, and the difference is that rounding and nothing
  else.

- **Every query now returns something, and some of those somethings are
  nothing much.** The vector leg ranks every eligible tool that has an
  embedded statement, so the zero-result page is effectively gone — including
  for a sentence the catalogue genuinely cannot answer. nDCG@10 does not
  notice; a person would. There is no relevance floor to say "these are the
  nearest, and none of them is close", and there cannot honestly be one until
  Phase 5 calibrates a score.
  **Answered in 9634cd6, and the last sentence was wrong.** A floor did not
  need a calibrated score, only a measurement it could be chosen against —
  which is what `eval/negatives.jsonl` is. See "Phase 3 amended: the relevance
  floor" below.
- **The catalogue is 223 tools and 504 statements.** A sequential scan of 504
  half-precision vectors is the right implementation at that size and the
  measurement says nothing about the right implementation at fifty thousand.
- **The four contaminated statements from Phase 2 are still contaminated**
  (keepassxc, home-assistant, audacity, signal), and they are now embedded as
  well as indexed.
- **The latency figure moves with whatever else the laptop is doing.** The
  same 60 queries measured between 45 ms and 142 ms mean across seven runs on
  the same code and the same data, while the quality figures did not move by a
  single digit in any of them. Read the latency as an order of magnitude, and
  read the single-query timing in `docs/loop-progress.md` — one round trip,
  measured five times in a row — as the number that speaks to the 150 ms gate.

---

## Phase 3 amended: the relevance floor

The owner read the live results page and said that a sentence the catalogue
cannot answer must not come back with twelve unrelated apps. Phase 3 had made
that the normal case: the vector leg ranks every eligible tool, so there was
always a nearest neighbour and never an empty page.

**nDCG could not see it.** It only ever asks questions that have answers. So
the instrument grew a second half — `eval/negatives.jsonl`, 30 sentences whose
right answer is nothing at all (`eval/README.md`, "The negatives") — and the
floor was chosen by measuring against both sets at once.

### The recorded run — 9634cd6

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero |
| ----- | - | --------- | ------- | ------- | ------ | ---- |
| all | 60 | 0.6719 | 0.7035 | 82.5 | 122.5 | 0 |
| english | 50 | 0.6913 | 0.7237 | 85.6 | 130.5 | 0 |
| non-english | 10 | 0.5750 | 0.6025 | 66.7 | 89.6 | 0 |
| constrained | 17 | 0.7020 | 0.6834 | 70.2 | 232.2 | 0 |
| unconstrained | 43 | 0.6601 | 0.7115 | 87.3 | 122.5 | 0 |

Constraint violations: **0**. Permission suites: **3 of 3 passing**. Warmed
from the recorded fixture, so this run called nothing.

| | Phase 3 (654f29d) | With the floor (9634cd6) |
| --- | --- | --- |
| nDCG@10, as written | 0.7018 | **0.7035** |
| nDCG@10, as read (`--read-query`) | 0.6834 | **0.6885** |
| divergence | -0.0183 | **-0.0151** |
| recall@10 | 0.6747 | 0.6719 |
| golden queries empty | 0 of 60 | 0 of 60 (both slices) |
| negatives answered with nothing | 0 of 30 | **26 of 30** as written, **27 of 30** as read |
| rows leaked per negative | 20.0 | **2.2** as written, 1.6 as read |

The negatives are new, so their Phase 3 column is what the same 30 sentences
did against `654f29d`: every one of them returned the full twenty rows.

### Every threshold tried

Four numbers, all in `public.relevance_floor()`: the per-result floor, the
gate a query's best eligible match must clear (one value for a sentence
containing Latin letters, one for a sentence with none), and the trigram
similarity at which a name counts as what was typed. Each row below is a full
run of both sets against the same database and the same fixture.

| result | gate Latin | gate other | name | recall@10 | nDCG@10 | non-English | golden empty | negatives empty | mean leaked |
| ------ | ---------- | ---------- | ---- | --------- | ------- | ----------- | ------------ | --------------- | ----------- |
| 0 | 0 | 0 | 0.50 | 0.6747 | 0.7018 | 0.6052 | 0 | **0 of 30** | 20.00 |
| 0.30 | 0.30 | 0.30 | 0.50 | 0.6719 | 0.7035 | 0.6025 | 0 | 5 of 30 | 7.57 |
| 0.35 | 0.35 | 0.35 | 0.50 | 0.6489 | 0.6997 | 0.6073 | 0 | 12 of 30 | 3.43 |
| 0.40 | 0.40 | 0.40 | 0.50 | 0.5644 | 0.6653 | 0.4889 | **2** | 21 of 30 | 0.90 |
| 0.45 | 0.45 | 0.45 | 0.50 | 0.4150 | **0.5306** | 0.4174 | **3** | 26 of 30 | 0.30 |
| 0.25 | 0.45 | 0.37 | 0.50 | 0.6706 | 0.7013 | 0.6023 | 0 | 26 of 30 | 2.63 |
| 0.30 | 0.45 | 0.37 | 0.50 | 0.6719 | 0.7035 | 0.6025 | 0 | 26 of 30 | 2.23 |
| 0.35 | 0.45 | 0.37 | 0.50 | 0.6489 | 0.6997 | 0.6073 | 0 | 26 of 30 | 1.50 |
| 0.40 | 0.45 | 0.37 | 0.50 | 0.5644 | 0.6653 | 0.4889 | **2** | 26 of 30 | 0.60 |
| 0.30 | 0.43 | 0.37 | 0.50 | 0.6719 | 0.7035 | 0.6025 | 0 | 23 of 30 | 3.97 |
| 0.30 | 0.44 | 0.37 | 0.50 | 0.6719 | 0.7035 | 0.6025 | 0 | 25 of 30 | 2.90 |
| 0.30 | 0.46 | 0.37 | 0.50 | 0.6553 | 0.6952 | 0.6025 | **1** | 26 of 30 | 2.23 |
| 0.30 | 0.47 | 0.37 | 0.50 | 0.6553 | 0.6952 | 0.6025 | **1** | 27 of 30 | 1.57 |
| **0.30** | **0.45** | **0.35** | **0.50** | **0.6719** | **0.7035** | **0.6025** | **0** | **26 of 30** | **2.23** |
| 0.30 | 0.45 | 0.36 | 0.50 | 0.6719 | 0.7035 | 0.6025 | 0 | 26 of 30 | 2.23 |
| 0.30 | 0.45 | 0.38 | 0.50 | 0.6719 | 0.7035 | 0.6025 | **1** | 26 of 30 | 2.23 |
| 0.30 | 0.45 | 0.40 | 0.50 | 0.6664 | 0.6911 | 0.5280 | **2** | 26 of 30 | 2.23 |
| 0.30 | 0.45 | 0.45 | 0.50 | 0.6497 | 0.6790 | 0.4553 | **3** | 26 of 30 | 2.23 |
| 0.30 | 0.45 | 0.37 | 0.30 | 0.6719 | 0.7035 | 0.6025 | 0 | 26 of 30 | 2.23 |
| 0.30 | 0.45 | 0.37 | 0.70 | 0.6719 | 0.7035 | 0.6025 | 0 | 26 of 30 | 2.23 |

*"golden empty" is how many of the 60 golden queries came back with nothing —
a person with a real problem told that nothing fits. "mean leaked" is rows
returned per negative, averaged over all 30, at the fetch limit of 20.*

### What the sweep says, in four findings

- **One threshold cannot do both jobs.** Every single-value row is either
  useless against the negatives (0.30 empties five of thirty) or destroys the
  answers (0.45 costs 0.17 of nDCG and empties three golden queries). The
  overlap is real: three English negatives' nearest tools sit at 0.47–0.49,
  above the lowest golden query's best match at 0.451.
- **So the gate and the floor are different questions.** "Is anything in the
  catalogue clearly about this?" is asked once per query at 0.45; "is this one
  close enough to show?" is asked per result at 0.30. That pair keeps every
  golden query answered *and* empties 26 of 30 negatives.
- **A sentence with no Latin letters needs its own gate.** Against an English
  catalogue, cross-script similarity runs lower: the three golden queries that
  never reach 0.45 are Hebrew, Hebrew and Russian, while a Hebrew *negative*
  reaches 0.52 by matching the catalogue's own Hebrew statements. One gate for
  both (0.45/0.45) empties those three and costs 0.15 of the non-English
  slice. 0.35, 0.36 and 0.37 are indistinguishable on the table above, and
  0.38 empties q009.
- **0.35 rather than 0.37, and the reason is `--read-query`.** Every row above
  searches the golden set as written. The path a visitor takes reads the
  sentence first, and at 0.37 the Hebrew q009 comes back EMPTY once
  `lib/constraints.ts` has lifted "free" out of it: the text changes, the
  vector changes, and its best match falls a thousandth under the gate.
  Authored numbers are identical at both values (0.7035, 0 empty, 26 of 30);
  derived zero-result goes 1 → 0. The table alone would not have caught it,
  which is the whole reason that mode exists.
- **The name threshold changes nothing measurable** between 0.30 and 0.70 on
  these 90 sentences. It is kept at 0.50 as the stricter reading of "the name
  is what was typed", and recorded as unmeasured rather than as tuned.

### What is honest to say about these numbers

**The margins are thin, and they are thin in the direction that matters.** The
Latin gate sits at 0.45 with the lowest golden query at 0.451 — one
thousandth — and the non-Latin gate at 0.37 with the lowest at 0.376. A
catalogue change, a re-embedding, or sixty different queries could move either
side of that. This is a floor fitted to ninety sentences, not a calibrated
relevance score, and the four leaks it leaves (`n13`, `n16`, `n19`, `n25`) are
the near misses and the same-script case it cannot separate.

**It is still the right trade.** Before it, every one of the thirty
unanswerable sentences returned twenty tools; after it, twenty-six return
nothing and the other four return fewer. The golden set did not pay for it:
nDCG went up by 0.0017, because the rows the floor removes from a good page
were below the good answers anyway.

Phase 5 is where a score means something. When it arrives, this floor is the
first thing it should replace.
