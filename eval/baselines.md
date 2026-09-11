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

**Four more columns are gates, not decoration.** A run may not leave more
golden queries empty than `Zero-result` records; may not answer a smaller share
of `eval/negatives.jsonl` than `Negatives empty` records, nor of the held-out
`eval/negatives.review.jsonl` than `Held-out empty` records (rates, so a longer
file does not trip them by arithmetic); and, whenever the floor is running at
all, may not empty a single one of the golden set's 240 mechanical
perturbations. A row that leaves a column blank gates nothing on it, which is
every row recorded before the floor. If a row records a file and that file was
not run, the gate FAILS — a gate that switches itself off when its input goes
missing is not a gate — and a cell it cannot parse is a hard error rather than
a shrug.

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

| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero-result | Negatives empty | Held-out empty | Perturbed empty | What changed |
| ---- | ------ | ----- | ------- | ------- | --------- | ------- | ------- | ------ | ----------- | --------------- | -------------- | --------------- | ------------ |
| 2026-09-10 | 364779b | 2 | no | 60 | 0.5406 | 0.6876 | 11.4 | 17.3 | 0 of 60 | | | | **WITHDRAWN — see below.** Not a baseline. |
| 2026-09-10 | 39569ba | 2 | no | 60 | 0.4497 | 0.4878 | 49.7 | 90.9 | 4 of 60 | | | | First trustworthy baseline. Statements rewritten from each tool's own summary with the golden set unopened; measured as `foundit_app`, not the owner. |
| 2026-09-11 | bc9abfe | 3 | yes | 60 | 0.6747 | 0.7019 | 72.6 | 115.3 | 0 of 60 | | | | Hybrid retrieval: a fifth RRF leg at weight 3.0, cosine distance over `tool_problems.embedding` (`text-embedding-3-small`, 512 dimensions, `halfvec`), ranking only the constraint-filtered candidate set. |
| 2026-09-11 | 654f29d | 3 | yes | 60 | 0.6747 | 0.7018 | 66.7 | 117.2 | 0 of 60 | | | | The adversarial review's fixes. The search is unchanged; the -0.0001 is float16 rounding, now frozen by `db/seed/embeddings.fixture.json`. **This is the reproducible one** — every run, laptop or CI, key or no key, warms from the same recorded vectors. |
| 2026-09-11 | 9634cd6 | 3 | yes | 60 | 0.6719 | 0.7035 | 82.5 | 122.5 | 0 of 60 | 26 of 30 | | | **The relevance floor** (`0006_relevance_floor.sql`), after the owner's review. A result is returned only with evidence — close enough in meaning, every term of the sentence, or a close name. The golden set barely moves; the 30 sentences in `eval/negatives.jsonl` go from 0 of 30 answered with an empty page to 26 of 30, and from 20.0 to 2.2 rows leaked each. See "Phase 3 amended" below. |
| 2026-09-11 | 5c002ff | 3 | yes | 60 | 0.7364 | 0.7618 | 84.6 | 119.8 | 0 of 60 | 10 of 30 | 10 of 25 | 0 of 240 | **Tool summaries embedded** (`0007`), and the floor re-tuned against a held-out negatives file and 240 perturbations. The summaries are the gain: nDCG 0.7035 → 0.7618, recall 0.6719 → 0.7364, non-English 0.6025 → 0.6516. **The negatives share falls, 26 of 30 → 10 of 30, and that is the honest direction**: the old value was fitted to that file, and on the held-out file — which nobody had tuned against — the old floor and this one both refuse 40%. The relative gate the review asked for was built first and refuses nothing at all; see "Phase 3 amended again" below. |
| 2026-09-12 | 0ffd091 | 4 | yes | 60 | 0.7719 | 0.7763 | 70.0 | 103.2 | 0 of 60 | 13 of 30 | 11 of 25 | 0 of 240 | **The sentence, read.** `gpt-5-nano` through the Responses API with a strict schema, merged behind the rules pass, which keeps the last word. **The headline is now the SHIPPED path** — what a visitor gets — rather than the golden set's own constraints; the reference pass on the same run still reads 0.7618, so the instrument did not move. Nearly all the gain is non-English (0.6516 → 0.8254), from embedding the model's English restatement instead of the sentence. Against what a visitor got in Phase 3 (`--plan=rules`, 0.7411) it is +0.0352, and the reader's divergence goes from −0.0183 to **+0.0145**. The model may fill ONE dimension, pricing: flags and interface languages were measured and both made the search worse. A refusal needs two samples to agree, because one in seven called a question about splitting a bill "not software" — `eval/perturb.mjs` caught it. $0.000232 a search. See "Phase 4" below. |

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

**It is still the right trade, and the golden set did pay something.** Before
it, every one of the thirty unanswerable sentences returned twenty tools; after
it, twenty-six return nothing and the other four return fewer. nDCG went up by
0.0017 — but that average hid a bill, and an earlier draft of this section said
"the golden set did not pay for it", which was not true:

- **recall@10 fell**, 0.6747 to 0.6719: a judged tool that used to scrape into
  a top ten is now below the floor.
- **the non-English slice fell**, 0.6052 to 0.6025.
- **individual queries lost ground** — among them q020, q059 and q007 — because
  the floor removes a row that was doing no harm where it was.

An average that moves a thousandth while its parts move hundredths is not a
statement that nothing changed. The parts are recorded here from now on.

Phase 5 is where a score means something. When it arrives, this floor is the
first thing it should replace.

---

## Phase 3 amended again: the floor the review asked for cannot be built

A second adversarial review read the floor above and did not pass it. It wrote
**its own 25 negatives before opening ours** — `eval/negatives.review.jsonl`,
held out and never tuned against — and found that seven of ten near misses came
back with a full page; that golden q052 sat 0.0015 above the gate, so a full
stop emptied it; that one Latin token inside a Hebrew sentence flipped which
gate applied; and that `foundit_app` could read every vector in the database,
which made 0006's "no distance leaves the database" false.

The instruction was to replace the absolute gate with a **relative** one: score
the whole catalogue, and ask whether a sentence's best match is a peak against
its own background (z = (best − mean)/sd ≥ Z), with each result judged the same
way. It was built and measured before anything was written. **It does not
work**, and the reason is worth more than the measurement.

### The recorded run — 5c002ff

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero |
| ----- | - | --------- | ------- | ------- | ------ | ---- |
| all | 60 | 0.7364 | 0.7618 | 84.6 | 119.8 | 0 |
| english | 50 | 0.7620 | 0.7838 | 86.3 | 129.3 | 0 |
| non-english | 10 | 0.6083 | 0.6516 | 76.3 | 103.8 | 0 |
| constrained | 17 | 0.8098 | 0.7628 | 75.7 | 194.7 | 0 |
| unconstrained | 43 | 0.7074 | 0.7614 | 88.2 | 119.8 | 0 |

Constraint violations **0**, across the golden set, both negative files and all
240 perturbations. Negatives 10 of 30 empty (5.1 rows leaked each), held-out 10
of 25 (4.1 each), perturbations 0 of 240 empty. Warmed entirely from the
fixture: 355 sentences, no API call.

### The relative gate, measured

| Z | golden empty | perturbed empty | negatives empty | held-out empty |
| - | ------------ | --------------- | --------------- | -------------- |
| 2.0–2.6 | 0 | 0–1 | 0 of 30 (0%) | 0 of 25 (0%) |
| 2.8 | 1 | 2 | 0 of 30 (0%) | 1 of 25 (4%) |
| 3.0 | 2 | 7 | 6 of 30 (20%) | 2 of 25 (8%) |
| 3.2 | 5 | 13 | 11 of 30 (37%) | 8 of 25 (32%) |

The robust form (median/MAD) behaves the same: at Z = 3.0 it refuses nothing at
all, and by the time it refuses anything it has emptied golden queries.

**Peakedness is anti-correlated with answerability here.** A sentence the
catalogue cannot answer has a flat, low background, so its nearest tool stands
out sharply against it — "I need a recording studio that rents by the hour"
peaks at 0.58 against a catalogue full of recording software. A real question
often stands out *less*, because its several genuinely relevant tools raise its
own mean and spread. The statistic measures how lonely the best match is, and
loneliness is not relevance.

### The absolute frontier, on the same four sets

| gate | golden empty | perturbed empty | negatives empty | held-out empty |
| ---- | ------------ | --------------- | --------------- | -------------- |
| 0.30 | 0 | 0 | 5 of 30 (17%) | 4 of 25 (16%) |
| 0.32 | 0 | 0 | 8 of 30 (27%) | 8 of 25 (32%) |
| **0.34** | **0** | **0** | **10 of 30 (33%)** | **10 of 25 (40%)** |
| 0.36 | 0 | 1 | 13 of 30 (43%) | 12 of 25 (48%) |
| 0.38 | 1 | 5 | 14 of 30 (47%) | 14 of 25 (56%) |
| 0.46 | 2 | 8 | 25 of 30 (83%) | 17 of 25 (68%) |
| 0.52 | 6 | 33 | 29 of 30 (97%) | 21 of 25 (84%) |
| 0.58 | 21 | 104 | 30 of 30 (100%) | 25 of 25 (100%) |

Hybrids of the two (absolute AND relative) are identical to the absolute column:
at any gate worth having, the z condition never binds.

### Why the bar cannot be met

The bar asked for **≥85% of the held-out set empty, with zero golden and zero
perturbed-golden empties**. The two ends of that are 0.15 of cosine apart in
the wrong direction:

```
lowest golden peaks          q009 0.3764   q057 0.3969   q049 0.4979
  (q009 with a "?" appended) 0.3524
highest held-out peaks       near-06 0.5782  near-01 0.5534  near-02 0.5385
                             nonen-he 0.5230  near-10 0.5094  near-03 0.4956
```

Eight held-out negatives peak above the weakest real questions. No threshold
separates them, because on this evidence they are not separable: "a recording
studio that rents time by the hour" really is about recording, and a Hebrew
sentence about driving lessons really does look like the catalogue's Hebrew
statements. Cosine similarity to a 223-tool catalogue cannot tell "about this
subject" from "answerable by one of these tools".

**So the bar was not met and nothing pretends otherwise.** What ships is
gate 0.34: the highest value at which no golden query and none of its 240
perturbations comes back empty, refusing 33% of our negatives and 40% of the
held-out ones. It is reported as a partial answer to the owner's complaint, not
a solved problem, and the frontier above is the evidence for whoever decides
what to do next.

### What did move: the summaries

`0007` embeds each tool's own summary and takes the better of it and the
nearest problem statement. That is worth more than every floor in this
document:

| | Phase 3 (654f29d) | With summaries, floor off | Shipped (summaries + 0.34) |
| --- | --- | --- | --- |
| nDCG@10 | 0.7018 | 0.7589 | **0.7618** |
| recall@10 | 0.6747 | 0.7350 | **0.7364** |
| non-English nDCG | 0.6052 | — | **0.6516** |
| negatives empty | 0 of 30 | 0 of 30 | 10 of 30 |
| held-out empty | 0 of 25 | 0 of 25 | 10 of 25 |
| perturbations empty | — | 0 of 240 | 0 of 240 |

Against Phase 3, per query: **32 better, 12 worse, 16 unchanged.** The gains are
large (q044 +0.46, q031 +0.42, q050 +0.35, q038 +0.27) and the losses are real
and recorded: q032 −0.23, q020 −0.11, q059 −0.10, q035 −0.09, q034 −0.08,
q036 −0.07, and six smaller. q032's answer set is a food diary and the floor
now cuts its page from twenty rows to nine, which costs it two judged tools
below the cutoff.

The floor itself costs the golden set nothing at 0.34 — 0.7589 → 0.7618 — which
is the whole reason it is set there rather than higher.

## Phase 4: reading the sentence

### The instrument changed, and that is recorded rather than slipped in

Every row above measured the **authored** plan: the golden set's own
hand-written constraints, and the whole sentence handed to full-text search.
That was the right instrument while nothing in the product read a sentence — it
holds the reading correct by assumption and measures the ranker alone.

Phase 4's entire subject is reading the sentence, so from this row on the
headline is the **shipped** plan: the rules pass, plus gpt-5-nano's cached
reading, merged. It is what a visitor gets.

Both passes still run on every invocation and both are printed. The comparison
below is the one the phase was set — beat 0.7618 — and it is deliberately
across that change of instrument. The reference pass reproduces 0.7618 exactly
on the same run, which is what says the instrument itself did not move:

```
slice        n  recall@10  nDCG@10  mean ms  p95 ms  zero
----------  --  ---------  -------  -------  ------  ----
authored    60     0.7364   0.7618     58.4    95.6     0
derived     60     0.7719   0.7763     70.0   103.2     0
DIVERGENCE        +0.0356  +0.0145    +11.5            +0
```

**That divergence is the headline result.** In Phase 3 it was **−0.0183**: the
reader cost the search a fifth of a point, and `docs/loop-progress.md` listed
the six queries that carried all of it. It is now **+0.0145**. For the first
time the reading in front of the ranker makes the ranker better rather than
worse.

### The recorded run

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero |
| ----- | - | --------- | ------- | ------- | ------ | ---- |
| all | 60 | 0.7719 | 0.7763 | 70.0 | 103.2 | 0 |
| english | 50 | 0.7413 | 0.7665 | 71.6 | 105.4 | 0 |
| non-english | 10 | 0.9250 | 0.8254 | 62.0 | 82.8 | 0 |
| constrained | 15 | 0.8367 | 0.7890 | 63.3 | 103.2 | 0 |
| unconstrained | 45 | 0.7504 | 0.7721 | 72.2 | 105.4 | 0 |

### Against what a visitor got in Phase 3

The honest like-for-like: `--plan=rules` is `lib/constraints.ts` alone, which is
exactly the reader Phase 3 shipped, measured on this same database and fixture.

| | rules only (Phase 3's reader) | shipped (rules + model) | change |
| --- | --- | --- | --- |
| nDCG@10 | 0.7411 | **0.7763** | +0.0352 |
| recall@10 | 0.7192 | **0.7719** | +0.0527 |
| english nDCG | 0.7588 | **0.7665** | +0.0077 |
| **non-English nDCG** | 0.6523 | **0.8254** | **+0.1731** |
| golden queries empty | 0 of 60 | 0 of 60 | — |
| perturbed empty | 0 of 240 | 0 of 240 | — |
| negatives empty | 10 of 30 (far 8/15, near 2/15) | **13 of 30** (far 10/15, near 3/15) | +3 |
| held-out empty | 10 of 25 (far 7/10, near 0/10) | **11 of 25** (far 7/10, near 1/10) | +1 |

**Almost the whole gain is non-English**, and it comes from one thing: the
model restates a non-English sentence in English and that restatement is what
gets embedded. The catalogue is English, so a Hebrew or Arabic sentence used to
reach the vector leg through a cross-lingual embedding and reach the other four
legs not at all.

**The negatives moved less than the phase hoped.** `docs/build-phases.md` and
the brief expected "not asking for software" to lift the NEAR misses the
relevance floor could not reach. It lifted the far ones: on the held-out file
the near-miss share went from 0 of 10 to 1 of 10, and on ours from 2 of 15 to
3 of 15. That is an improvement and it is a small one, and the reason is
visible in the file — "I need a lawyer to actually read the contract before I
sign it" and "guitar lessons where the app listens to me play" are sentences
where a program really is part of what is wanted. Reading the sentence does not
help there because the sentence is not the problem; the catalogue is.

### Which dimensions the model may fill, measured

Every row is a full run of the golden set with `--accept=`, everything else at
the shipped defaults.

| accept | nDCG@10 | english | non-English | golden empty |
| ------ | ------- | ------- | ----------- | ------------ |
| none | 0.7559 | 0.7588 | 0.7412 | 0 |
| **pricing** | **0.7623** | **0.7665** | **0.7412** | **0** |
| flags | 0.6895 | 0.6991 | 0.6412 | 0 |
| pricing,flags | 0.6909 | 0.7009 | 0.6412 | 0 |
| pricing,platforms | 0.7623 | 0.7665 | 0.7412 | 0 |
| pricing,languages | 0.7214 | 0.7665 | **0.4961** | 0 |

(Measured on the recording before the two-sample vote, so the absolute numbers
are a hundredth below the shipped row; the ordering is what the choice was made
on and it is not close.)

**Flags cost a tenth of a point even with a whitelist**, and the mechanism is
worth writing down because it will come back. Asked what a sentence requires, a
model offers the things people generally want. Four golden queries lost their
entire page to flags nobody asked for:

| query | flags the model read | nDCG |
| ----- | -------------------- | ---- |
| q055 have long articles read out loud to me while I am walking | has_free_tier, works_offline | 0.9385 → 0.0000 |
| q003 budgeting app where my bank details never leave my own computer | e2e_encrypted, no_ads | 0.8090 → 0.0000 |
| q010 notes app where my notes stay as files on my own computer | accessible, no_ads | 0.6338 → 0.0000 |
| q044 stop adverts and trackers following me around the internet | e2e_encrypted, no_ads | 0.6169 → 0.0000 |

**Languages are worse still, and in the one place it hurts most.** On five of
the six non-English golden queries the model returned the language the sentence
was WRITTEN in — `he`, `ru`, `fr`, `pt` — which filters an overwhelmingly
English catalogue down to almost nothing. Being told not to, in capitals, with
a worked example, did not stop it. The rules read "with a Russian interface"
correctly and keep that job.

### What the vector leg embeds, measured

| embed | text | nDCG@10 | non-English |
| ----- | ---- | ------- | ----------- |
| text | rules | 0.7475 | 0.6523 |
| text | restated | 0.7607 | 0.7318 |
| **english** | **rules** | **0.7623** | **0.7412** |
| english | restated | 0.7609 | 0.7328 |
| fused | rules | 0.7619 | 0.7391 |
| fused | restated | 0.7612 | 0.7346 |

`english` — embed the restatement INSTEAD of the sentence — wins over fusing
the two into one vector, and wins over giving the restatement to full-text
search as well (`text=restated`). The last of those is the interesting
negative: appending an English restatement to the text the ranker sees does
light up the lexical legs for a non-English sentence, and it is still worse
than leaving them dark, because the restatement's words are not the
catalogue's words and the trigram leg in particular starts matching noise.

### The residual, and a knob that turned out to do nothing

`--text=shorter` uses the model's residual when it deleted more than the rules
did. Over all 115 eval sentences **it fired zero times**: the model reports a
constraint and then hands back the sentence unchanged. So the shipped default
is `rules`, the model's `residual` earns nothing today, and the field is kept
because the guard that validates it — every character present, in order — is
what makes "the model cannot put words into the ranker" a checkable sentence
rather than a promise.

`--merge=model-wins` measured identical to `rules-win` to four decimals, because
with only pricing accepted the two sides almost never disagree. `rules-win`
ships because it is the safe direction, not because it won.

### The reader is not deterministic, and the perturbation gate found it

The most useful measurement of the phase. gpt-5-nano refuses the `temperature`
parameter, so at minimal reasoning effort its answers have a tail. Recorded, on
one sentence:

```
"we all paid for different bits of the holiday and now nobody knows who owes who?"
  recorded once as   asks_for_software: false
  sampled six more:  true true true true true true
```

One sample in seven, on a question about splitting a bill, would have shown the
"we only list software" page. The golden set did not catch it — the sentence
without the question mark read true. **`eval/perturb.mjs` caught it**, because
the perturbation gate now runs on the shipped plan, and the run went red with
`perturbed golden queries empty: 1, allowed 0`.

Two fixes, both measured:

1. **A refusal is corroborated against the sentence itself.** If the sentence
   names a program in any language the catalogue serves, the search runs
   whatever the model says. Nobody asks for a free plumber or an offline
   babysitter.
2. **A refusal needs two votes.** `readSentence` makes two calls, in flight
   together, and both must say "not software". The English restatement takes
   the opposite rule — whichever sample produced one wins — because there the
   tail is a MISSING answer and a restatement can only ever add a vector.

The second one also fixed something nobody was looking for: in the recording
before it, **five of the ten non-English golden queries came back with an empty
restatement**, and the non-English slice read 0.6770. With the vote it is
0.8254.

| recording | nDCG@10 | non-English | perturbed empty |
| --------- | ------- | ----------- | --------------- |
| one sample | 0.7623 | 0.7412 | **1 of 240** |
| one sample, re-recorded | 0.7516 | 0.6770 | 0 of 240 |
| **two samples, voting** | **0.7763** | **0.8254** | **0 of 240** |

The middle row is the honest one to stare at: the same code, the same prompt,
re-recorded, moved the headline by 0.011 and the non-English slice by 0.064.
**A single sample of this model is not a stable measurement**, and the fixture
is what freezes the one that ships.

### What it costs

From the providers' own `usage` fields, totalled over all 355 recorded
readings and priced at list rates read from `developers.openai.com/api/docs/pricing`
on 11 September 2026.

| per search | tokens | $ / 1M | $ each |
| ---------- | ------ | ------ | ------ |
| reader in | 3691.0 | 0.050 | 0.00023136 |
| reader out | 117.0 | 0.400 | (included above) |
| embedding in | 13.0 | 0.020 | 0.00000026 |

```
cost per search              $0.000232
cost per thousand searches   $0.2316
ceiling (docs/build-phases)  $0.002000 per search — within it, by 8.6x
```

Three things about that number:

* **It is two reader calls, not one.** 3,691 input tokens is the ~1,850-token
  prompt twice. The vote doubles the bill and the bill is still a twelfth of a
  cent.
* **It is priced pessimistically.** The prompt is nearly all fixed instructions,
  so the provider's automatic prefix caching will often bill a tenth of the
  input rate. Nothing here claims that discount, and nothing sets a cache key,
  because a cache key on somebody's sentence is a correlation handle.
* **It is the price of a FIRST-EVER sentence.** Both caches are keyed on the
  normalised text, so a repeat costs nothing at all.
