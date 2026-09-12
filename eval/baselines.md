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
| 2026-09-12 | 0ffd091 | 4 | yes | 60 | 0.7719 | 0.7763 | 70.0 | 103.2 | 0 of 60 | 13 of 30 | 11 of 25 | 0 of 240 | **WITHDRAWN — see "Phase 4, withdrawn" below.** Not a baseline. The numbers are real and describe a code path no visitor ran: the harness embedded the model's English restatement and the application embedded the rules residual, so the non-English figure belonged to nobody's search. Kept because deleting it would hide what happened. Originally recorded as: **The sentence, read.** `gpt-5-nano` through the Responses API with a strict schema, merged behind the rules pass, which keeps the last word. **The headline is now the SHIPPED path** — what a visitor gets — rather than the golden set's own constraints; the reference pass on the same run still reads 0.7618, so the instrument did not move. Nearly all the gain is non-English (0.6516 → 0.8254), from embedding the model's English restatement instead of the sentence. Against what a visitor got in Phase 3 (`--plan=rules`, 0.7411) it is +0.0352, and the reader's divergence goes from −0.0183 to **+0.0145**. The model may fill ONE dimension, pricing: flags and interface languages were measured and both made the search worse. A refusal needs two samples to agree, because one in seven called a question about splitting a bill "not software" — `eval/perturb.mjs` caught it. $0.000232 a search. See "Phase 4" below. |
| 2026-09-12 | 4f30bab | 4 | yes | 60 | 0.7636 | 0.7755 | 65.8 | 110.8 | 0 of 60 | 13 of 30 | 11 of 25 | 0 of 240 | **The sentence, read — re-measured after the review.** Replaces the withdrawn row above, which described a search the application did not run: `lib/reading.ts` computed the text to embed and `app/results/page.tsx` embedded the rules residual, so the non-English figure belonged to nobody's path. One function, `planSearch`, now returns every string a search needs and both callers use it; `tests/parity.test.mjs` holds them to it, and the six non-English golden queries return identical tools in identical order from the running application and from the harness on a cold cache. **This is the MEAN-NEAREST of five live recordings**, not the best: nDCG mean 0.7714, range 0.7620–0.7775; non-English mean 0.7963, range 0.7395–0.8329. The worst of the five would not have cleared the gate, so the claim is "beats Phase 3 by about a hundredth, four times out of five". Non-English 0.6516 → 0.8207; against the reader a visitor had in Phase 3 (`--plan=rules`, 0.7411) it is +0.0344. $0.000246 a search, and the daily caps now cost $4.21 a month at worst. See "Phase 4, re-measured" below. |
| 2026-09-12 | 48ee798 | 5 | yes | 60 | 0.7800 | 0.7508 | 126.4 | 183.8 | 0 of 60 | 13 of 30 | 11 of 25 | 0 of 240 | **REVERTED — see "Phase 5, deliverable A" below.** Not a baseline: the rows it measures were deleted and the code that wrote them writes nothing today. **363 generated problem statements**, written by `gpt-5-mini` for the 204 published tools carrying fewer than four, each checked against that tool's own name and summary by `gpt-5-nano` before storage. 791 candidates, 48 refused by the mechanical gate, 124 by the verifier, 0 as near-duplicates. nDCG@10 falls 0.7755 → 0.7508 while recall@10 rises 0.7636 → 0.7800: more statements give more tools a way into a result set, so more judged tools turn up somewhere in the top twenty and more unjudged ones turn up above them. Reverting restored 0.7755 to four decimals. The rows are kept in `db/seed/generated_statements.sql` and their vectors in the fixture, so the number reproduces; the tooling is kept and is not what failed. |
| 2026-09-12 | 67006e5 | 5 | yes | 60 | 0.7800 | 0.8605 | 62.3 | 105.7 | 0 of 60 | 22 of 30 | 20 of 25 | 0 of 240 | **The reranker.** Over the top TWENTY candidates the Phase 4 search returns, `gpt-5-nano` is shown the sentence and each candidate's own slug, name, summary and problem statements — and no score, rank, rating, like count or price — and grades each 0 to 3; 0 is dropped, the rest order by grade and then by the search's own order. **+0.0850 of nDCG**, and the near misses are the headline: held-out near misses 1 of 10 → 6 of 10 and ours 2 of 15 → 8 of 15, which is what the relevance floor could never do because "a recording studio that rents by the hour" really is about recording. Non-English 0.8207 → 0.8877. Twenty was measured against 30 and 50 and wins on the number, the money and the clock. **This is the MIDDLE of five live recordings** — 0.8515, 0.8585, **0.8605**, 0.8620, 0.8713, mean 0.86076 — not the best, and unlike Phase 4 the worst of the five would still have cleared the gate. Recall ran 0.7300–0.7800 across them, so the +0.0164 here is the most favourable reading of the five. $0.000434 a search against a $0.002 ceiling; the three daily caps are re-costed together to $4.05 a month. See "Phase 5, deliverable B" below. |

### Recorded baselines, continued

One column was added — **Rerank coverage**, the share of a run's searches that
had a reranker judgement — and adding it to the table above would have meant
editing rows that are already recorded, which is the one thing this file does
not do. So the table continues here, with the same columns and one more, and
this is the one a run is gated against.

| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero-result | Negatives empty | Held-out empty | Perturbed empty | Rerank coverage | What changed |
| ---- | ------ | ----- | ------- | ------- | --------- | ------- | ------- | ------ | ----------- | --------------- | -------------- | --------------- | --------------- | ------------ |
| 2026-09-12 | 15ff3a8 | 5 | yes | 60 | 0.7842 | 0.8707 | 78.6 | 108.1 | 0 of 60 | 20 of 30 | 19 of 25 | 0 of 240 | 347 of 353 | **The Phase 5 review's fixes, and the reranker's number re-recorded from artefacts anybody can open.** The search is unchanged; what changed is what may be claimed about it. Three fresh recordings at N=20 — `eval/recordings/n20-1.json`, `n20-2.json`, `n20-3.json` — read 0.8811, **0.8707** and 0.8711. The frozen one is `n20-2`, the LOWEST of the three, because it is the only one of the three that clears every gate: `n20-1` empties two of the 240 perturbations and `n20-3` empties one of them and a golden query outright. So the number is the worst of three rather than the middle of five, and the reason is written down. Against the previously recorded Phase 5 row the negatives share falls 22 of 30 → 20 of 30 and the held-out 20 of 25 → 19 of 25: the same code, a different recording, and that spread IS the finding. New: the reviewer's 25 blind negatives (20 of 25 empty, near misses 14 of 17) and 15 blind answerable sentences (rank 1 in **15 of 15**), both held out. Prompt injection through a candidate's own statement closed; two write paths closed (`0011`); `query_reranks_shape` made to mean what it says (`0011`, `0012`); the caps re-costed from output CEILINGS and cut to 120 first-ever searches a day. $0.000427 a search. See "Phase 5, re-measured" below. |
| 2026-09-12 | 033fe53 | 6+ | yes | 60 | 0.7875 | 0.8796 | 119.7 | 171.9 | 0 of 60 | 21 of 31 | 19 of 25 | 0 of 240 | 354 of 354 | **NOT A NEW MEASUREMENT — the row above, re-read with one negative added and the denominator changed from 30 to 31.** `eval/negatives.jsonl` gained the owner's own sentence, "app that transfer reels to recepies free", typed as he typed it; adding a test is allowed and the golden set is untouched. Nothing about the search changed, and the judgements are the frozen `n20-2` set plus one for the new sentence. The nDCG moves 0.8707 → 0.8796 for a reason that has nothing to do with quality: the frozen fixture was missing judgements for 6 of its 353 searches, which measured the Phase 4 order, and recording those six is what moved it — coverage 347 of 353 → 354 of 354. Reproduce exactly: `node eval/run.mjs --rerank-floor=1` against the committed fixture (`eval/recordings/shown1-frozen.json`). This is the BEFORE the row below is measured against. |
| 2026-09-12 | 033fe53 | 6+ | yes | 60 | 0.7269 | 0.8645 | 119.7 | 171.9 | 0 of 60 | 24 of 31 | 22 of 25 | 0 of 240 | 354 of 354 | **A "Loose" result is no longer shown.** `RERANK_SHOWN_FROM` is 2: the reranker's grade 1 — "in the right area rather than an answer to it" — is dropped from the page with its 0s. The owner searched "app that transfer reels to recepies free" and was shown a receipt splitter graded 3; his decision (`docs/product-decisions.md` §17) is that the page should say there is nothing rather than show something unrelated, and this is the half of it that could be shipped. **Sentences that should return nothing: 21 of 31 → 24 of 31, near misses 8 of 16 → 11 of 16, held-out 19 of 25 → 22 of 25, the reviewer's 25 → 22 of 25. The price is nDCG 0.8796 → 0.8645 (a DROP of 0.0151) and recall 0.7875 → 0.7269 (a drop of 0.0606)**, and the drop is the point rather than a footnote: a judged-relevant tool the model reads as "in the right area" now leaves the page. Nothing else moved — 0 golden queries emptied, 0 of 240 perturbations, 15 of 15 answerable sentences still at rank 1, coverage 354 of 354, $0.000428 a search. The threshold costs no API call, changes no judgement and was chosen by re-scoring one recording at every value of it. **Two samples per judgement with the lower mark — the other half, and the half that fixes the owner's sentence outright — was measured over three recordings and NOT shipped: it empties golden queries and perturbations.** See "Ranking precision (after Phase 6)" below. |

### Ranking precision (after Phase 6) — the owner's decision, measured

The owner searched **"app that transfer reels to recepies free"** on 12
September 2026 and was shown **Receiptly, a receipt splitter, as the only result
on the page**. The cached judgement in `public.query_reranks` graded it
**relevance 3**. Nothing about the two sentences agrees except that "recepies"
looks like "receipts". His words: he would rather the page say there is no
matching tool than show one that is not related.

That is a decision to weigh precision over recall, it is recorded as an
amendment to `docs/product-decisions.md` §17, and this section is what it cost
to find out how much of it can be bought.

**The sentence was added to `eval/negatives.jsonl` as `n31`, exactly as typed.**
Adding a test is allowed; the golden set is untouched and no negative was
removed or reworded. The denominators in every row and table below are 31 rather
than 30, and the two rows above are the same recording read at both thresholds
so that the before and the after differ by one constant and nothing else.

#### What ships, and the one gate it misses

`RERANK_SHOWN_FROM = 2`. A judgement of 1 no longer reaches a page. That is the
whole of the shipped change, it costs no API call, and it changes no judgement —
the threshold is applied when a judgement is USED, which is what made choosing
it a free re-score (`eval/run.mjs --rerank-floor=`) rather than three more paid
recordings.

| Gate | Target | Frozen recording | Lowest of three | Verdict |
| --- | --- | --- | --- | --- |
| `negatives.jsonl` empty | ≥ 28 of 31 | 24 of 31 | 23 of 31 | **MISSED by 4** |
| `negatives.review.jsonl` empty | ≥ 22 of 25 | 22 of 25 | 22 of 25 | met |
| `negatives.review2.jsonl` empty | ≥ 20 of 25 (recorded) | 22 of 25 | 22 of 25 | met |
| golden queries with no results | 0 | 0 | 0 | met |
| perturbation flips | 0 of 240 | 0 | **1** | met on the frozen one |
| nDCG@10 | ≥ 0.860 | 0.8645 | 0.8472 | met on the frozen one |
| `positives.review.jsonl` at rank 1 | ≥ 15 of 15 (recorded) | 15 of 15 | 15 of 15 | met |
| rerank coverage | within 5 points | 354 of 354 | 354 of 354 | met |
| cost per search | ≤ $0.002 | $0.000428 | — | met |
| monthly worst case at the caps | ≤ $5.00 | **$3.23** (was $4.68) | — | met |

**The one gate the shipped configuration misses is the headline one**, and it
misses it by four sentences: 24 of 31 rather than 28 of 31. The rest of this
section is why the other four could not be bought, measured rather than argued.

#### The frontier, measured for nothing

The threshold is applied at use time, so one recording's judgements score at
every value of it. Every row below is a full run — 60 golden queries, 31
negatives, two held-out files, 15 answerable sentences, 240 perturbations — and
not one of them cost an API call beyond the recording it scores.

| judgements | shown from | nDCG@10 | recall@10 | golden empty | perturbed empty | `negatives` | held-out | review2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shown1-frozen` | 1 | 0.8796 | 0.7875 | 0 | 0 | 21 of 31 | 19 of 25 | 20 of 25 |
| the same, **shipped** | **2** | **0.8645** | **0.7269** | **0** | **0** | **24 of 31** | **22 of 25** | **22 of 25** |
| `min2-1` | 1 | 0.8639 | 0.7250 | 0 | 1 | 25 of 31 | 20 of 25 | 20 of 25 |
| `min2-1` | 2 | 0.8505 | 0.6661 | 0 | 1 | 27 of 31 | 23 of 25 | 23 of 25 |
| `min2-1` | 3 | 0.7398 | 0.4967 | **3** | **6** | 29 of 31 | 23 of 25 | 24 of 25 |

Two things that table settles.

**Grade 3 alone is not a threshold.** It refuses 29 of 31 unanswerable
sentences and empties three golden queries and six perturbations doing it, and
it costs a seventh of the nDCG. It is in the table so that nobody has to try it
again.

**The negatives gate cannot be reached from here.** The only row that clears 28
of 31 is the one that empties golden queries, and that is the wall Phase 3 hit
with a cosine floor, one level up: every setting that refuses the near miss also
refuses a real question. A reading of the pair moved the wall without removing
it.

#### Two samples, the lower mark: three recordings, and not shipped

Lever 1 from the brief. Call the reranker twice per judgement and keep
`min(relevance_a, relevance_b)`, so a hallucinated 3 has to happen twice. It
works on exactly the sentence it was built for — and it empties pages this
catalogue answers.

| | `min2-1` | `min2-2` | `min2-3` | lowest |
| --- | --- | --- | --- | --- |
| nDCG@10 (shown from 2) | 0.8505 | 0.8428 | 0.8537 | 0.8428 |
| recall@10 | 0.6661 | 0.6625 | 0.6800 | 0.6625 |
| **golden queries emptied** | 0 | **1** (q028) | 0 | **1** |
| **perturbed empty of 240** | **1** (q018) | **2** (q028) | **1** (q042) | **2** |
| `negatives.jsonl` empty | 27 of 31 | 26 of 31 | 27 of 31 | 26 of 31 |
| held-out empty | 23 of 25 | 22 of 25 | 23 of 25 | 22 of 25 |
| review2 empty | 23 of 25 | 22 of 25 | 23 of 25 | 22 of 25 |
| answerable at rank 1 | 15 of 15 | 15 of 15 | 15 of 15 | 15 of 15 |
| coverage | 354 of 354 | 354 of 354 | 354 of 354 | — |
| judgements from one sample | 1 | 1 | 1 | — |
| cost per search | $0.000607 | $0.000607 | $0.000607 | — |

**Every one of the three failed the perturbation gate**, at both thresholds, and
one of the three emptied a golden query outright. `docs/build-phases.md` sets
that gate at zero rather than at "no worse than recorded", and the Phase 5
review's sentence for it stands: a floor that depends on a full stop is not a
floor. There was no recording to freeze.

**Why it fails is the same mechanism that makes it work.** A sample that grades
all twenty candidates 0 has refused the whole page, and under the lower mark
that one sample has a veto. On `min2-2` it used it on golden q028 — *"edit a
video for free without a watermark stamped across it"*, which this catalogue
answers with Shotcut, Kdenlive, DaVinci Resolve, CapCut and LosslessCut. The
judgement recorded for it is twenty zeros. The other sample in that pair had
graded LosslessCut 3 and five tools 2; one recording earlier, both samples had
judged the same sentence richly.

**And the obvious fix undoes the reason for the change.** `readSentence` has
said since Phase 4 that "a refusal which could not be corroborated is not a
refusal", so the rule was built: discard a sample that refuses everything when
the other one does not. It was recorded (`eval/recordings/vote-1.json`) and then
pointed at the owner's own sentence, six judgements of it:

```
the lower mark        Receiptly 0 on every recording taken
with the rescue rule  Receiptly 3 five times of six, 1 once
```

A single sample saying "none of these" is what a correct empty page and a wrong
empty page look like from here, and this instrument cannot tell them apart. So
the veto is the lower mark rather than a bug in it, `RERANK_SAMPLES` stays at 1,
and the mechanism is kept in `lib/rerank.ts` — tested, one constant away — for
the day the reranker is a steadier model.

For the record, `vote-1` at shown-from 2: nDCG 0.8452, recall 0.6928, **golden
empty 1 (q042)**, perturbed 2, negatives 25 of 31, held-out 22 of 25. The rescue
rule cost precision as well as principle: at shown-from 1 it refuses 21 of 31
against the plain lower mark's 25.

#### A stricter rubric: measured, worse, not shipped

Lever 2 from the brief, written exactly as the brief specifies it — 3 is "does
the specific thing", 2 is "does it in part or with a workaround", 1 is "same
problem area, not this task", 0 is "unrelated, or only shares words" — plus an
explicit paragraph that a name or a word resembling a word in the sentence is
not evidence, and a third worked example of that case. One recording,
`eval/recordings/min2p2-1.json`, on top of two samples:

| shown from | nDCG@10 | golden empty | perturbed empty | `negatives` | held-out | review2 |
| --- | --- | --- | --- | --- | --- | --- |
| 1, shipped prompt (`min2-1`) | 0.8639 | 0 | 1 | 25 of 31 | 20 of 25 | 20 of 25 |
| 1, revised rubric | 0.8571 | 0 | **3** | 23 of 31 | 20 of 25 | 21 of 25 |
| 2, shipped prompt (`min2-1`) | 0.8505 | 0 | 1 | 27 of 31 | 23 of 25 | 23 of 25 |
| 2, revised rubric | 0.8349 | 0 | **4** | 25 of 31 | 23 of 25 | 23 of 25 |

**Worse on the number, worse on the negatives it was written for, and three to
four times worse on the perturbation gate.** The cause is legible in the rubric
rather than mysterious: "does it in part, or with a workaround … two or three
steps rather than one" is generous, and it pulls near misses up from 1 to 2 —
which is precisely the grade the shipped threshold shows. The Phase 5 review
measured a different revision of the same prompt and found the same shape of
result; this is the second prompt revision to buy ordering and pay for it in
refusals.

Its one good sentence was measured on its own, too. The shipped prompt plus the
word-resemblance paragraph and nothing else, eight single judgements of the
owner's sentence, against the shipped prompt's own five:

```
shipped prompt                     Receiptly shown 3 times of 5
+ the word-resemblance paragraph   Receiptly shown 2 times of 8
the whole revised rubric           Receiptly shown 1 time of 8
two samples, the lower mark        Receiptly shown 0 times
```

A paragraph that moves a single sample from three in five to two in eight on one
sentence is not a fix, and it would need its own three recordings to ship.
Recorded here, not shipped.

#### The spread of the shipped configuration, on identical code

Three recordings, the same code, the same threshold. This is the Phase 5 finding
reproduced rather than a new one, and it is why the frozen number is not a claim
about the reranker:

| | `shown2-frozen` **frozen** | `shown2-b` | `shown2-c` |
| --- | --- | --- | --- |
| nDCG@10 | **0.8645** | 0.8472 | 0.8678 |
| recall@10 | 0.7269 | 0.6889 | 0.7261 |
| golden queries emptied | 0 | 0 | 0 |
| perturbed empty of 240 | 0 | **1** | 0 |
| `negatives.jsonl` empty | 24 of 31 | 23 of 31 | 24 of 31 |
| held-out empty | 22 of 25 | 22 of 25 | 23 of 25 |
| review2 empty | 22 of 25 | 22 of 25 | 23 of 25 |
| answerable at rank 1 | 15 of 15 | 15 of 15 | 15 of 15 |

Mean nDCG 0.8598, range 0.0206 — **wider than Phase 5's 0.0104 on the same
instrument** — and `shown2-b` would have cleared neither the perturbation gate
nor the 0.860 target. The frozen one is `shown2-frozen` because it is the
recording the fixture already held: the Phase 5 frozen `n20-2` judgement set
with one judgement added for the new sentence, so the shipped number is a
re-score of a recording that was frozen before this work started and could not
have been chosen to flatter it. `shown2-b` and `shown2-c` are fresh recordings
taken afterwards, for the spread alone.

#### The owner's sentence, after

```
select judgement from public.query_reranks
 where query_norm = 'app that transfer reels to recepies free';

[{"slug": "draftbin", "relevance": 0}, {"slug": "splitwise", "relevance": 0},
 {"slug": "tabsplit", "relevance": 0}, {"slug": "miniflux", "relevance": 0},
 {"slug": "receiptly", "relevance": 0}, ... all twenty at 0 ...]
```

Receiptly is 0 and the page says *"Nothing here does what you asked."*

**And that is one draw of an unstable judgement, not a property of the search.**
Five more single samples of the same question graded Receiptly 3, 2 and 2. What
the shipped change guarantees is narrower and worth stating exactly: a tool the
reranker reads as merely "in the right area" can no longer reach the page at
all. Whether *this* sentence returns nothing depends on the judgement that gets
cached for it, and the change that would have made it certain is the one in the
two-samples section above.

#### What it costs, and the cap rebalance that turned out to be a cut

The shipped change makes no call, so the per-search cost is unchanged at
**$0.000428**. The caps moved anyway, and downwards, because the precision work
had to measure something the project had been guessing:

```
per request     was      now    how it was chosen
reader out      900      360    3 x a measured p99 of 117 (max 127, 396 requests)
rerank out      700      750    3 x a measured p99 of 250 (max 293, 707 calls)

monthly worst case at MAX_READER_CALLS_PER_DAY=240, MAX_RERANK_CALLS_PER_DAY=120
  reader     $3.30  ->  $1.74
  rerank     $1.37  ->  $1.46
  embedding  $0.02      $0.02
  total      $4.68  ->  $3.23      against a $5.00 ceiling
```

`.env.example` had named the reader's 900 as the binding constraint on all three
caps and nobody had measured the distribution it bounds.
`scripts/output-tokens.mjs --measure` now does, in one command, over the same
396 sentences the eval searches with; every recording run prints the same
statistic for the reranker. **The reranker's ceiling went UP by fifty**, which is
the same rule honestly applied — 700 was 2.8 times its p99, not three.

`tests/rate-limit.test.mjs` recomputes every line of that from the fixture and
the two ceilings, so this block is the last recomputation rather than a promise.

#### Known weaknesses of this number

- **The negatives gate is missed by four sentences and the frontier says why.**
  24 of 31 is the honest figure for what ships. The seven that still leak are
  near misses graded 2 by a model that read the pair — not word matches, not the
  floor failing — and every setting that refuses them also refuses a real
  question.
- **Recall fell by 0.0606 and some of that is wrong.** Every tool the reranker
  graded 1 is gone from every page, including ones the golden set judges
  relevant. The owner asked for this; it is not free and the number is here.
- **The nDCG drop is 0.0151 against 0.011 named as acceptable.** It clears the
  0.860 floor by 0.0045 on the frozen recording and misses it by 0.0128 on the
  lowest of the three. One of three recordings of identical code would not have
  shipped.
- **A judgement is still one sample, so a page can still change under somebody
  who reloads it.** That is the Phase 5 weakness, unfixed, and the fix was
  measured here and cannot be afforded in golden empties.
- **`had_good_match` is now arithmetically `result_count > 0` on a judged
  search**, because everything shown is a 2 or a 3. §17 records that and names
  the way out if the two columns ever need to be independent again.
- **The perturbation gate holds on this fixture and is not a property of the
  reranker.** One of the three shipped-configuration recordings emptied a
  perturbed golden query, and the Phase 5 recordings did the same twice in three.
  The gate is real and the instrument under it wobbles.
- **The spend on all of it was $0.90 of a $3.00 ceiling**, of which $0.64 bought
  the two levers that were not shipped. A measurement that says no is worth what
  it costs.

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

## Phase 5, deliverable A: the generated problem statements — REVERTED

`gpt-5-mini` wrote problem statements for the 204 published tools carrying
fewer than four, and `gpt-5-nano` checked each candidate against that tool's
own name and summary before it was stored. The job is
`scripts/generate-statements.mjs`; the two prompts are in `lib/generate.ts` and
neither contains a word of `eval/golden.jsonl`.

| | count |
| --- | --- |
| tools under the ceiling | 204 |
| statements generated | 791 |
| refused by the mechanical gate | 48 |
| refused by the verifier | 124 |
| refused as a near-duplicate (cosine ≥ 0.92) | 0 |
| refused by the database | 0 |
| **stored** | **358** (363 with a three-tool trial run) |
| generator | 204 calls, 149,578 in / 18,977 out |
| verifier | 482 calls, 153,191 in / 23,023 out |
| cost of the whole run | about **$0.09** |

**And it made the search worse**, measured on the shipped path with the
reranker off, which is the Phase 4 search exactly:

| | before | after | change |
| --- | --- | --- | --- |
| nDCG@10 | 0.7755 | **0.7508** | **−0.0247** |
| recall@10 | 0.7636 | **0.7800** | +0.0164 |
| non-English nDCG@10 | 0.8207 | 0.8178 | −0.0029 |
| negatives empty | 13 of 30 | 13 of 30 | — |
| held-out empty | 11 of 25 | 11 of 25 | — |
| rows leaked per negative | 4.1 | 4.8 | worse |
| golden empty / perturbed empty / violations | 0 / 0 / 0 | 0 / 0 / 0 | — |

Recall up and nDCG down is the whole finding, and the two together say what
happened: more statements give more tools a way into a result set, so more
judged tools appear somewhere in the top twenty — and more unjudged ones appear
above them. **A statement that is true about a tool is not a statement that
should rank it first.** 363 more true sentences across 204 listings made the
catalogue easier to reach and harder to order.

`docs/build-phases.md`: *"Anything that does not move the number is reverted,
not kept out of politeness."* The rows were deleted, the number is recorded
here, and reverting restored 0.7755 to four decimals. The rows themselves are
in `db/seed/generated_statements.sql`, their vectors are still in the fixture,
and the header of that file holds the three commands that reproduce the 0.7508.

The tooling is kept and is not what failed. The day the catalogue is real
rather than seeded — where two hand-written statements per tool is a genuine
shortage rather than a development convenience — this re-runs in a minute.

## Phase 5, deliverable B: the reranker

### How many candidates to judge

Measured, not chosen. Three full runs of the golden set, both negatives files
and the 240 perturbations, at three candidate counts, each recording its own
judgements because the cache is keyed on the candidate SET and a different N is
a different question:

| N | nDCG@10 | recall@10 | negatives empty | held-out empty | perturbed empty | violations | unjudged | $/search |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **20** | **0.8682** | 0.7611 | 21 of 30 | 21 of 25 | 0 of 240 | 0 | 9 of 341 | 0.000433 |
| 30 | 0.8579 | 0.7633 | 22 of 30 | 21 of 25 | 0 of 240 | 0 | 7 of 341 | 0.000463 |
| 50 | 0.8477 | 0.7519 | 22 of 30 | 21 of 25 | 0 of 240 | 0 | 28 of 341 | 0.000487 |

**Twenty ships.** It wins on the number, on the money and on the clock, and it
is the only one of the three that is not also worse at answering: 30 and 50
empty one more of our own negatives and neither empties one more of the
held-out file, which is the number that says whether anything generalises.

`docs/build-phases.md` names fifty, and fifty is measurably the worst of the
three. The reason is legible in the run rather than mysterious: a longer
candidate list is a longer prompt, and at 50 the four-second timeout was missed
on **28 of 341** sentences against 9 at 20 — and every missed one measures the
Phase 4 order, so the pass is part Phase 5 and part Phase 4 in a way that gets
worse as N grows. The `$/search` column is the whole pipeline (reader +
embedding + reranker) from the providers' own usage fields.

*The `$/search` figures in this table are averaged over a fixture that held all
three recordings at once, so they are a little blurred between the three rows.
The shipped figure below is measured on a fixture holding the shipped N alone —
the 20, 30 and 50 judgements were cleared afterwards, because three sets in one
file also blur the cost the file is the source of.*

### The spread, and why the number is the middle one

Same finding as Phase 4's reader and the same procedure: `gpt-5-nano` has no
temperature control, so one recording of it is not a measurement. Record five
times, measure each, freeze the one nearest the MEAN — not the best.

Only the GOLDEN SET's judgements were re-recorded between them. The negatives,
the held-out file and the 240 perturbations were recorded once and are identical
in all five, which is why those columns do not move: the spread below is the
golden set's alone, exactly as Phase 4's was the restatement's alone.

| recording | nDCG@10 | recall@10 | negatives | held-out | perturbed empty |
| --------- | ------- | --------- | --------- | -------- | --------------- |
| 1 | 0.8515 | 0.7300 | 22 of 30 | 20 of 25 | 0 of 240 |
| 2 | 0.8585 | 0.7494 | 22 of 30 | 20 of 25 | 0 of 240 |
| **3 — frozen** | **0.8605** | **0.7800** | **22 of 30** | **20 of 25** | **0 of 240** |
| 4 | 0.8620 | 0.7500 | 22 of 30 | 20 of 25 | 0 of 240 |
| 5 | 0.8713 | 0.7611 | 22 of 30 | 20 of 25 | 0 of 240 |

Mean 0.86076; recording 3 is 0.00026 from it and recording 4 is 0.00124, so 3 is
the one that ships. The range is 0.0198 of nDCG — **wider than Phase 4's
0.0155**, and every one of the five beats the Phase 4 row by more than a
twentieth, which is the honest shape of this result: unlike Phase 4, the worst
recording would still have cleared the gate comfortably.

### What the reranker cost the recall

| | Phase 4 | Phase 5 | change |
| --- | --- | --- | --- |
| nDCG@10 | 0.7755 | **0.8605** | **+0.0850** |
| recall@10 | 0.7636 | 0.7800 | +0.0164 |
| non-English nDCG@10 | 0.8207 | 0.8877 | +0.0670 |
| constrained nDCG@10 | 0.7895 | 0.8275 | +0.0380 |
| negatives empty | 13 of 30 | **22 of 30** | far 11→14, near **2→8** |
| held-out empty | 11 of 25 | **20 of 25** | far 7→9, near **1→6**, non-English 3→5 |
| golden empty | 0 of 60 | 0 of 60 | — |
| perturbed empty | 0 of 240 | 0 of 240 | — |
| constraint violations | 0 | 0 | — |
| cost per search | $0.000246 | $0.000434 | ceiling $0.002 |

**The near misses are the headline.** They are what Phase 3's relevance floor
could not touch and what Phase 4's reader barely moved: held-out near misses
went 1 of 10 to 6 of 10 and our own 2 of 15 to 8 of 15. A cosine threshold
cannot separate "a recording studio that rents by the hour" from recording
software, because the sentence really is about recording. A reading of the pair
can.

Recall went UP here, which is worth stating because it need not have: the
reranker DROPS results, and a judged tool it grades 0 disappears from the page
and from recall@10. Across the five recordings recall ran 0.7300 to 0.7800 —
below the Phase 4 row in two of them. The frozen recording is the top of that
range, so the +0.0164 is the most favourable recall reading of the five, and the
honest summary is "recall is unchanged to a few hundredths and nDCG is up a
tenth".

18 pages were emptied by the judgement and 3,666 results were dropped as "not
for this" across 341 searches. Neither number is a quality claim on its own; put
beside 0 golden empties and 0 perturbed empties, they are what a floor that
finally works looks like.

## Phase 5, re-measured: what the second adversarial review found

The reranker ships. The NUMBER did not ship as written, and neither did several
sentences around it. This section is what replaced them.

### Five recordings nobody could open

The rule this project uses for anything a model decides is "record five times
and freeze the middle, never the best". Phase 5 followed it and then reported it
from notes — five numbers in a sentence, with no artefact behind any of them.
The review's objection is short and correct: five recordings nobody can open are
not five recordings.

`eval/recordings/` is now committed. `--record=<name>` writes the whole summary
of one run there — every slice, both negatives files, the held-out files, the
perturbations, the coverage, the violations and the per-query rows, about 13 KB
of JSON. Every model-dependent number quoted below names the file it came from.

### The three recordings at N=20, and why the frozen one is the worst of them

| | `n20-1` | `n20-2` **frozen** | `n20-3` |
| --- | --- | --- | --- |
| nDCG@10 | **0.8811** | 0.8707 | 0.8711 |
| recall@10 | 0.7697 | **0.7842** | 0.7694 |
| golden queries empty | 0 | 0 | **1** |
| perturbed empty (of 240) | **2** | 0 | **1** |
| `negatives.jsonl` empty | 24 of 30 | 20 of 30 | 24 of 30 |
| `negatives.review.jsonl` | 18 of 25 | 19 of 25 | 18 of 25 |
| `negatives.review2.jsonl` | 21 of 25 | 20 of 25 | 20 of 25 |
| `positives.review.jsonl` rank 1 | 15 of 15 | 15 of 15 | 14 of 15 |
| rerank coverage | 348 of 353 | 347 of 353 | 349 of 353 |

Mean nDCG 0.8743, range 0.0104. **The middle is `n20-3`, and `n20-3` cannot be
frozen**: it empties a golden query and one of the 240 perturbations, and the
perturbation gate is zero, not "no worse than recorded" — a floor that depends
on a transposed letter is not a floor. `n20-1` empties two perturbations.
`n20-2` is the only one of the three that clears every gate, and it is also the
lowest of the three on nDCG, so the frozen number is not a flattering choice.

**That two of three live recordings would have failed a gate is the finding**,
not a footnote. The reranker can empty a page for a golden query typed slightly
differently, and the fixture is one recording in which it did not. The gate
holds on this fixture; it is not a property of the reranker.

Against the previously recorded Phase 5 row the negatives share falls 22 of 30 →
20 of 30 and the held-out 20 of 25 → 19 of 25, on identical code. Both rows are
real and neither is edited.

### Twenty candidates, restated honestly

The first version of this decision compared ONE recording each at 20, 30 and 50
and called 20 the winner. One recording each cannot distinguish a knob from the
model's own wobble, which the section above measures at 0.0104 of nDCG across
three runs of identical code. Three recordings each at 20 and 30:

| | N=20 | N=30 |
| --- | --- | --- |
| recordings | `n20-{1,2,3}.json` | `n30-{1,2,3}.json` |
| nDCG@10 | 0.8811 / 0.8707 / 0.8711 | 0.8392 / 0.8585 / 0.8654 |
| mean | **0.8743** | 0.8544 |
| recall@10 | 0.7697 / 0.7842 / 0.7694 | 0.7333 / 0.7631 / 0.7769 |
| mean | **0.7744** | 0.7578 |
| `negatives.jsonl` empty | 24 / 20 / 24 → 22.7 | 23 / 22 / 23 → 22.7 |
| `negatives.review.jsonl` | 18 / 19 / 18 → 18.3 | 19 / 22 / 20 → 20.3 |
| `negatives.review2.jsonl` | 21 / 20 / 20 → 20.3 | 20 / 20 / 20 → 20.0 |
| searches judged (of 353) | 348 / 347 / 349 → 348.0 | 342 / 339 / 347 → 342.7 |
| cost per search | **$0.000427** | $0.000434-0.000441 |

**Twenty stays, and this time the evidence separates.** The lowest N=20
recording (0.8707) is above the highest N=30 one (0.8654), so the two sets of
three do not overlap at all — it is not "indistinguishable and 20 is cheaper".
Recall points the same way, so the "consider 30 if its recall is reproducibly
higher" case does not arise.

**The negatives columns are the instrument checking itself.** They come out
identical at both N, and they have to: a sentence the catalogue cannot answer
returns about four rows, and **0 of the 25 held-out negatives return more than
twenty rows at all**, so N cannot reach them. The 18.3 against 20.3 on the
held-out file is the model wobbling, and reading it as a win for N=30 would be
reading noise. Where N *does* bind is the golden set: 60% of those searches
return more than twenty rows and 42% more than thirty.

Why more candidates are worse is legible in the runs. A longer candidate list is
a longer prompt against the same four-second budget, and **coverage falls from
348 of 353 searches judged to 342.7** — every unjudged search measures the Phase
4 order. Money is almost not the argument: the floor keeps most result sets
under twenty rows, so N=30 costs about 2% more per search, not 50%.

**What twenty gives up, counted.** Over the 60 golden queries the search returns
195 graded-relevant tools inside its top 50, and **12 of them sit at ranks 21-50
— 6.2%, spread over 11 queries**. Those twelve are never shown to the reranker at
N=20. That is the price of the choice, stated rather than implied, and it is
paid to get the other 183 judged by a model that has not been handed a longer
prompt it answers worse.

### The reviewer's blind sentences

Twenty-five negatives and fifteen answerable sentences, written without reading
ours, are `eval/negatives.review2.jsonl` and `eval/positives.review.jsonl`. They
are held out: never edited, never tuned against, reported by every run.

On the frozen recording: **20 of 25** negatives answered with an empty page — far
6 of 8, and the near misses the file was built around **14 of 17**. And **15 of
15** of the answerable sentences returned the expected tool at rank 1, in five
languages, which is the part of Phase 4 and Phase 5 that is working.

### One prompt revision, measured and not shipped

The near misses that survive have a shape: the sentence asks for a person, a
service, an object or an errand, and the catalogue answers with software from
the same subject. The revision named that outright, with five worked examples.
Three recordings of each prompt, everything else identical:

| | shipped prompt | revised prompt |
| --- | --- | --- |
| recordings | `n20-json-oldprompt{,-2,-3}.json` | `n20-json-newprompt-{1,2,3}.json` |
| nDCG@10 | 0.8728 / 0.8520 / 0.8693 | 0.8807 / 0.8696 / 0.8771 |
| mean | 0.8647 | **0.8758** |
| `negatives.jsonl` empty | 24 / 23 / 22 → **23.0** | 21 / 21 / 21 → 21.0 |
| its near misses (of 15) | 11 / 10 / 9 → **10.0** | 8 / 8 / 8 → 8.0 |
| `negatives.review.jsonl` (of 25) | 20 / 18 / 22 → **20.0** | 17 / 17 / 19 → 17.7 |
| `negatives.review2.jsonl` (of 25) | 19 / 21 / 23 → 21.0 | 21 / 21 / 21 → 21.0 |
| its near misses (of 17) | 13 / 14 / 15 → **14.0** | 13 / 13 / 13 → 13.0 |
| positives rank 1 (of 15) | 15 / 15 / 15 | 15 / 15 / 14 |
| golden queries empty | 0 / 1 / 0 | 0 / 1 / 0 |

**Not shipped.** It buys about a hundredth of nDCG and pays two of our own
negatives, 2.3 of the held-out file and two of our own near misses for it — and
on the one set it was written for, `negatives.review2`'s near misses, it is
*worse* (14.0 → 13.0). It makes the reranker order the non-empty pages slightly
better by making it less willing to empty one, which is the trade this project
has already refused twice. Recorded here either way, with the six files, so the
next person can disagree with the reading rather than with a sentence.

### The reranker is unstable, and the obvious lever cannot be afforded

The review found 27 of 194 (slug, sentence) judgements changing across three
live calls — 14% — with 26 of them crossing the line between shown and not
shown. Re-measured here, ten sentences × three calls at each setting:

```
minimal  30 calls,  0 failed   37 of 147 pairs changed (25.2%), 26 crossed (17.7%)
low      12 calls, 18 FAILED    0 of  38 pairs changed, on the 12 that returned
tokens/judgement   minimal 2176 in 186 out $0.000183   low 1789 in 372 out $0.000238
slowest call       minimal 2975 ms                     low 4020 ms
```

**`reasoning: low` misses the four-second budget on eighteen of thirty calls.**
Its perfect stability is measured on the third of its calls that came back; the
other two thirds are a page with no judgement on it. It is also dearer, because
reasoning tokens are output tokens. `minimal` stays and the instability is
recorded rather than fixed: it is the reason the spread above is 0.0104 of nDCG
on identical code, and the reason two of three recordings failed a gate.

### The cost, re-measured from ceilings rather than averages

```
per search    tokens   $ / 1M      $ each
reader in     3930.6    0.050   0.00024794
reader out     128.5    0.400
embedding in    14.3    0.020   0.00000029
rerank in     1987.6    0.050   0.00017919
rerank out     199.5    0.400

cost per search              $0.000427
ceiling (docs/build-phases)  $0.002000 per search — within it, by 4.7x
```

That is the average, and an average is the right thing for "what a search
costs". **It is the wrong thing for a cap**, which is what the review caught.
`MAX_*_CALLS_PER_DAY` bounds the bill, and the bill's worst case is every call
reasoning to its `max_output_tokens`:

| | requests/day | worst case/month |
| --- | --- | --- |
| reader (900 output ceiling) | 240 | $3.30 |
| reranker (700, was 2,000) | 120 | $1.37 |
| embeddings | 2,000 | $0.02 |
| | | **$4.68** against $5 |

At the old ceilings and the old caps the same three lines came to **$17.52**.
`tests/rate-limit.test.mjs` now recomputes every figure in that table from
`db/seed/embeddings.fixture.json` and the two output ceilings, so a stale
constant in `lib/prices.ts` fails a test.

### The verifier's false-accept rate

Deliverable A is reverted, so this is a recorded number and not a gate. Twenty
planted pairs — ten tools with one of their own seed statements, ten with a
statement from a tool in another category:

| | false accepts (of 10 wrong) | false rejects (of 10 right) |
| --- | --- | --- |
| the prompt as Phase 5 shipped it | 0 | 3 |
| tightened to "only what the summary itself states" | 0 | **6** |

The tightening is kept — a generator that stores less is the safer failure — but
it bought nothing measurable here and doubled what it refuses wrongly, and the
sample is twenty pairs.

### The gate a lost fixture walked through

A sentence with no recorded judgement measures the Phase 4 order. That was
printed and nothing else, so a build that had lost half its judgements would
have reported a number between the two phases under three green gates.
`--baseline` now reads the **Rerank coverage** column and fails when the share
judged falls more than five percentage points below the recorded row. A run at a
different `--rerank-n=` has no matching judgements at all and fails loudly,
which is the intended way to notice that a flag and a fixture disagree.

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

## Phase 4, WITHDRAWN: what the first recording measured

**Every number in this section is real and none of it describes the product.**
An adversarial review found that `eval/run.mjs` and `app/results/page.tsx` did
not run the same search — the harness embedded the model's English restatement
and the application embedded the rules residual — so the headline below belongs
to a code path no visitor ever took. The row it produced is marked WITHDRAWN in
the table at the top of this file and is kept for the same reason the Phase 2
withdrawal is: deleting it would hide what happened.

It is left here unedited because the sweeps in it are still the sweeps that
chose the defaults — `--accept`, `--embed`, `--text` and the merge mode were all
measured on the harness's path, which is the path that decides which reading is
better, and the fix did not change their ordering. What it changed is the
headline. Read this section for the reasoning and
**"Phase 4, re-measured" below for the numbers.**

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

## Phase 4, re-measured: what an adversarial review found

The section above was written from a run that measured a search the application
did not perform. This one is written from a run that measures the one it does.

### The defect, because it is the useful part

`lib/reading.ts` computed `embedText` — for a non-English sentence, the model's
English restatement, which is the whole of where the non-English gain came from.
`app/results/page.tsx` took `filters` and `text` off the same object and then
embedded a string it had worked out for itself, before the reading existed.

So the harness handed `search_tools` the restatement's vector and the
application handed it the sentence's. Measured on the application's actual path,
the recorded 0.8254 non-English was **0.6523** — Phase 3 to four decimals — and
the all-60 figure was 0.7474, which is 0.0144 BELOW the row it claimed to beat.

Every test passed throughout. Each half was correct on its own and nothing
compared them. What exists now: one function, `planSearch`, returns every string
a search needs, both callers use it, and `tests/parity.test.mjs` puts ten
sentences through the application's call and the harness's and asserts the
filters and the embedded text come out byte-identical. Separately, the harness
no longer reads the query-vector cache at all — both passes carry their own
vector — because the cache holds one vector per sentence and two passes wanting
two different ones is the same divergence in a second costume. It was: the fix
above passed and the application still disagreed, until that changed too.

**Proved end to end rather than by reading the code.** With the cache emptied,
the six non-English golden queries were put through the running application and
through the harness, and the returned tools are identical in identical order:

```
        harness                                    application
q009    tricount tabsplit splitwise wanderlog …    (identical)
q018    duolingo anki almaany quizlet koreader     (identical)
q059    almaany morfix wordreference koreader …    (identical)
q027    quietroom audacity auphonic ocenaudio …    (identical)
q031    handbrake dropbox shotcut photopea vlc     (identical)
q007    rome2rio trainline                         (identical)
```

### The recorded run — the mean-nearest of five

| Slice | n | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero |
| ----- | - | --------- | ------- | ------- | ------ | ---- |
| all | 60 | 0.7636 | 0.7755 | 65.8 | 110.8 | 0 |
| english | 50 | 0.7413 | 0.7665 | 67.1 | 111.1 | 0 |
| non-english | 10 | 0.8750 | 0.8207 | 59.4 | 90.5 | 0 |
| constrained | 15 | 0.8367 | 0.7895 | 56.4 | 110.8 | 0 |
| unconstrained | 45 | 0.7393 | 0.7708 | 68.9 | 111.1 | 0 |

The reference pass on the same run reads **0.7618**, which is the Phase 3
row exactly and is what says the instrument did not move underneath the number.
The reader's divergence is **+0.0137**, against −0.0183 in Phase 3.

### The spread, which is the honest part

The first recorded 0.8254 was not only measured on the wrong path — it was the
best of a spread rather than the middle of one. A reviewer re-recorded the
non-English readings five times and got 0.7396 to 0.8231, mean 0.7866, with the
recorded figure above all five.

So the recording procedure is now explicit: record the non-English readings five
times, measure each, and freeze the one nearest the MEAN. The five, after the
fixes:

| recording | nDCG@10 | non-English | negatives | held-out | perturbed empty | golden empty |
| --------- | ------- | ----------- | --------- | -------- | --------------- | ------------ |
| 1 | 0.7620 | 0.7395 | 12 of 30 | 11 of 25 | 0 of 240 | 0 |
| **2 — frozen** | **0.7755** | **0.8207** | **13 of 30** | **11 of 25** | **0 of 240** | **0** |
| 3 | 0.7775 | 0.8329 | 13 of 30 | 11 of 25 | 0 of 240 | 0 |
| 4 | 0.7666 | 0.7671 | 13 of 30 | 11 of 25 | 0 of 240 | 0 |
| 5 | 0.7756 | 0.8213 | 12 of 30 | 11 of 25 | 0 of 240 | 0 |

```
nDCG@10      mean 0.7714   range 0.7620 – 0.7775
non-English  mean 0.7963   range 0.7395 – 0.8329
```

Trial 2 is frozen because 0.7755 is nearest the mean, not because 0.7775 was
available. **The worst of the five, 0.7620, would not have cleared the gate**
(0.7618 + 0.005 = 0.7668), and saying so is the point of running five: the
honest claim is "this beats Phase 3 by about a hundredth, four times out of
five", not "this beats Phase 3 by 0.0145".

Everything that is not a restatement is identical across the five recordings —
the English slice is 0.7665 in all of them — because only the non-English
readings were re-recorded. The spread is the restatement's alone.

### Against what a visitor got in Phase 3

| | rules only (Phase 3's reader) | shipped, frozen recording | change |
| --- | --- | --- | --- |
| nDCG@10 | 0.7411 | **0.7755** | +0.0344 |
| english nDCG | 0.7588 | **0.7665** | +0.0077 |
| **non-English nDCG** | 0.6523 | **0.8207** | **+0.1684** |
| negatives empty | 10 of 30 | **13 of 30** | +3 |
| held-out empty | 10 of 25 | **11 of 25** | +1 |

### What else the review found, and what each cost

Ten findings, and the three that changed behaviour rather than wording:

**`english` was unvalidated prose that now reaches the ranker.** It accepted a
list of our own tools ("Splitwise Tricount Settle Up Splid Tabsplit"), a
399-character advice paragraph, injection prose and a JSON object — and it is
the one model output that gets embedded. It is now checked like an input: at
most thirty words, one line, no markup, no longer than twice the sentence, and
it may not contain a published tool's name as a whole word. The catalogue's
names reach the guard as an argument (one cached query) rather than as a lookup,
so `lib/reading.ts` stays pure and the check runs against the tools that exist
when the reading is USED rather than when it was recorded. On rejection the
sentence itself is embedded and the refusal is counted.

**A broken model emptied three of four real questions.** Pointed at a stub
answering `asks_for_software: false` for everything, the two-sample vote did
nothing — two samples of a broken model agree with each other. There is now an
in-process circuit: if more than half of the last twenty LIVE readings refused,
no refusal is honoured until that stops. It needs ten samples before it will
conclude anything, which bounds the damage at about ten pages rather than at
every page until somebody notices. A cached refusal also expires after 24 hours
(`0009`), because it is the one answer that empties a page without searching.

**The reader's daily cap counted one token for two HTTP calls**, so a cap of
2,000 permitted 4,000 requests and twice the money it was set to bound. It
counts requests now — and once it did, the default was wrong: 2,000 reader
requests a day is $7.01 a month, over the $5 ceiling this project is willing to
lose. The default is 1,200, which is 600 readings a day and **$4.21 a month**
with the embedder's 2,000 alongside it. `tests/rate-limit.test.mjs` fails, with
the figure in the message, if either drifts above it.

Also: the 3-second timeout bounded headers only and a stalled body ran for
fifteen seconds — the abort timer now stays armed until the body has been read,
in both outbound files; `net.isIP()` replaced a shape check that accepted `abc`
and `::::` as addresses; and the harness and the application validated the
model's residual against two different strings (raw versus normalised), which
`planSearch` now normalises once.

### What it costs, re-measured

```
per search    tokens   $ / 1M      $ each
reader in     3915.0    0.050   0.00024568
reader out     122.4    0.400
embedding in    14.4    0.020   0.00000029

cost per search              $0.000246
cost per thousand searches   $0.2456
ceiling (docs/build-phases)  $0.002000 per search — within it, by 8.1x
```

And the other ceiling, which the first version of this phase did not have:
spending both daily caps every day for a month is **$4.21**, against $5.
