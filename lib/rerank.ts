/**
 * The reranker: one model, one question, over candidates the database has
 * already filtered.
 *
 * WHAT IT IS FOR. Phases 2 to 4 order results by a Reciprocal Rank Fusion sum
 * over five retrieval legs — words, trigrams, names, statement vectors, summary
 * vectors. That is a good way to FIND things and a poor way to judge them, and
 * `docs/loop-progress.md` records exactly where it runs out: a relevance floor
 * made of cosine similarity cannot separate "a recording studio that rents by
 * the hour" from a catalogue full of recording software, because the sentence
 * really is about recording. Every threshold that refuses the near miss also
 * empties a real question. That is not a tuning problem; it is the wrong
 * instrument. So a model reads the sentence and the candidates and says which
 * of them are for this, which is a different question with a different answer.
 *
 * WHAT IT MAY SEE, AND WHAT IT MAY NOT.
 *
 *   * **Only candidates the SQL already returned**, which means only tools that
 *     survived every hard constraint. A constraint is a WHERE clause; the
 *     reranker is handed the result of it and cannot reach past it. It has no
 *     database connection, no catalogue, and no way to name a tool that is not
 *     in the list it was given — the schema's `slug` is an enum of exactly
 *     those slugs, so tool invention is refused by the provider before the
 *     validator ever sees it, and by the validator if the provider's strict
 *     mode ever slips.
 *
 *   * **Only each candidate's own public text**: slug, name, summary, and the
 *     problem statements the listing carries. No score, no rank, no counters,
 *     no ratings, no likes, no pricing, no url. A rank would let it agree with
 *     the ranking it is supposed to second-guess; a counter would let
 *     popularity leak into a judgement about fit, which is the one thing
 *     `docs/product-decisions.md` §6 says the fit score is not.
 *
 *   * **Never the golden set.** Nothing in this file, and nothing it is given
 *     at runtime, comes from `eval/`. The harness calls the same function with
 *     the same arguments as the application.
 *
 * WHAT HAPPENS WHEN IT FAILS. The Phase 4 order, unchanged, and one log line
 * with no sentence in it. A timeout, a non-2xx, a malformed answer, a slug that
 * is not a candidate, a missing candidate, a duplicate, a relevance outside
 * {0,1,2,3}, an extra key, no key at all, the daily cap already spent: every
 * one of those is `null` from `rerank`, and `null` means the page is the page
 * Phase 4 shipped. That is a perfectly good page.
 *
 * WHY THE ORDERING LIVES HERE. Because the last two reviews both caught the
 * same class of defect — the harness and the application deciding the same
 * thing in two places — and the fix both times was one function that both call.
 * `applyRerank` is that function for this phase, and `tests/parity.test.mjs`
 * puts the same candidates and the same judgement through both callers.
 */

import { createHash } from 'node:crypto';

import { ReaderError, callResponses, capText } from './reader-model.ts';

/** The model. The same one that reads the sentence, and for the same reason. */
export const RERANK_MODEL = 'gpt-5-nano';

/**
 * How many times the model is asked, and what is done with the answers.
 *
 * ONE — AND TWO WAS BUILT, MEASURED OVER THREE RECORDINGS AND NOT SHIPPED.
 * This constant is a measurement, and it is the most expensive measurement in
 * the precision work, so the whole of it is written down here.
 *
 * THE SENTENCE THAT ASKED THE QUESTION. The owner searched "app that transfer
 * reels to recepies free" and was shown Receiptly — a receipt splitter — as the
 * only result, because the cached judgement graded it **3**. Nothing about the
 * two agrees except that "recepies" looks like "receipts". His decision, in
 * `docs/product-decisions.md` §17, is that he would rather the page say there is
 * no matching tool than show one that is not related.
 *
 * WHY TWO SAMPLES WAS THE OBVIOUS ANSWER. The Phase 5 review had already
 * measured the reranker changing 37 of 147 (slug, sentence) grades across three
 * live calls — 25.2% — with 26 of them crossing the line between shown and not
 * shown. A hallucinated 3 is that instability seen from the outside, and the
 * reader's own fix for the same problem is to sample twice and vote. Two
 * samples with the LOWER mark makes a grade have to happen twice before
 * anybody sees it. Six judgements of the owner's sentence at each setting:
 *
 *   one sample    Receiptly 3, -, 2, (timeout), 2, -   shown 3 times of 5
 *   two, lower    Receiptly 0 on every recording taken
 *
 * WHY IT IS NOT SHIPPED. A sample that grades ALL twenty candidates 0 has
 * refused the whole page, and under the lower mark that one sample has a VETO.
 * That veto is what empties the owner's page — and it is also what empties
 * pages this catalogue answers. Three full recordings at `RERANK_SAMPLES = 2`
 * (`eval/recordings/min2-{1,2,3}.json`), against a gate that allows ZERO:
 *
 *   golden queries emptied           0, 1 (q028), 0
 *   perturbed variants emptied       1 (q018), 2 (q028), 1 (q042)   of 240
 *
 * `docs/build-phases.md`'s rule for the perturbation gate is zero, not "no
 * worse than recorded", and the Phase 5 review's words for it stand: a floor
 * that depends on a full stop is not a floor. Every one of the three recordings
 * failed it, at both values of `RERANK_SHOWN_FROM`, so there was no recording
 * to freeze.
 *
 * AND THE FIX FOR THE VETO UNDOES THE REASON FOR THE CHANGE. `combineSamples`
 * carries the attempt: discard a sample that refuses everything when the other
 * one does not, which is `readSentence`'s own "a refusal that could not be
 * corroborated is not a refusal". It was built, recorded
 * (`eval/recordings/vote-1.json`) and pointed at the owner's sentence six
 * times: **Receiptly came back at 3 five times of six.** The rule that rescues
 * q028 is the rule that puts Receiptly back on his page. A single sample saying
 * "none of these" is what a correct empty page and a wrong empty page look like
 * from here, and this instrument cannot tell them apart.
 *
 * So the precision the owner asked for is bought by `RERANK_SHOWN_FROM` instead
 * — which costs nothing, changes no judgement, and is measured in
 * `eval/baselines.md` — and this stays at one. **The mechanism is kept rather
 * than deleted**, the way `RERANK_EFFORT` keeps the measurement that rejected
 * `low`: `rerankOrThrow` takes a `samples` option, `lowerOf` and
 * `combineSamples` are tested, and the day the reranker is a steadier model
 * this is one constant and three recordings away from being re-measured.
 *
 * IF IT IS EVER RAISED, THREE THINGS MOVE WITH IT, and they are named here
 * because the first one is invisible until it has already gone wrong:
 *
 *   1. `public.rerank_model()` must change in a migration. The cache is keyed
 *      on it, `query_rerank()` serves a row only when it matches, and a single
 *      sample and the lower of two are different answers to the same question —
 *      so without that, every judgement recorded the old way is served as if
 *      the new rule had produced it. 0010's comment on that function already
 *      says this about the prompt and the schema; the sampling belongs in the
 *      same sentence.
 *   2. `RERANK_REQUESTS_PER_JUDGEMENT` follows it, and with it
 *      `MAX_RERANK_CALLS_PER_DAY` in `.env.example` — the cap counts requests,
 *      and `tests/rate-limit.test.mjs` is where the arithmetic has to close.
 *   3. `eval/run.mjs`'s recording concurrency, which is `4 / samples`: four
 *      sentences at two calls each is eight requests in flight and the provider
 *      answers that with 429s. The first recording taken this way lost 145 of
 *      354 judgements.
 */
export const RERANK_SAMPLES = 1;

/**
 * How long a search will wait for a judgement, INCLUDING the body read.
 *
 * A second longer than the reader's three, because this call carries fifty
 * candidates rather than one sentence and has more to produce. It is also the
 * last thing between the search and the page, so a slow one is dead time a
 * visitor spends looking at a spinner — which is why it is four seconds and
 * not eight, and why the fallback is the order we already have rather than an
 * error.
 */
export const RERANK_TIMEOUT_MS = 4_000;

/**
 * How many candidates are judged.
 *
 * MEASURED, not chosen: `eval/run.mjs --rerank-n=` runs the whole golden set,
 * both negatives files and the 240 perturbations at a given N. The first time
 * this was decided it was decided on ONE recording each at 20, 30 and 50, which
 * the Phase 5 review pointed out is not enough to distinguish a knob from the
 * model's own wobble. THREE recordings each at 20 and 30, in
 * `eval/recordings/n20-{1,2,3}.json` and `n30-{1,2,3}.json`:
 *
 *   N    nDCG@10                      mean      recall mean   $/search
 *   20   0.8811  0.8707  0.8711       0.8743    0.7744        0.000427
 *   30   0.8392  0.8585  0.8654       0.8544    0.7578        0.000434
 *
 * **Every recording at 20 beats every recording at 30**, the lowest 20 (0.8707)
 * above the highest 30 (0.8654), so this is not the two distributions
 * overlapping — it is a real difference, and it points the way the first
 * measurement said it did. Recall says the same thing, so the "consider 30 if
 * its recall is reproducibly higher" case does not arise.
 *
 * The negatives columns are IDENTICAL at both — 22.7 of 30 either way — and
 * that is not a coincidence and not evidence either: a sentence the catalogue
 * cannot answer returns about four rows, and 0 of the 25 held-out negatives
 * return more than twenty at all, so N cannot reach them. Any difference there
 * is the model wobbling. The golden set is where N binds: 60% of those searches
 * return more than twenty rows and 42% more than thirty.
 *
 * Why MORE candidates make it WORSE is legible in the runs: a longer candidate
 * list is a longer prompt against the same four-second budget, and coverage
 * falls from 348 of 353 searches judged at N=20 to 342.7 at N=30. Every
 * unjudged search measures the Phase 4 order. At N=50, on the single recording
 * taken, the timeout was missed on 28 of 341.
 *
 * WHAT 20 GIVES UP, counted rather than waved at: over the 60 golden queries the
 * search returns 195 graded-relevant tools inside its top 50, and **12 of them
 * sit at ranks 21-50** — 6.2%, spread over 11 queries. Those twelve are never
 * shown to the reranker at N=20 and could have been promoted at N=50. That is
 * the price, and it is paid to get the other 183 judged by a model that has not
 * been handed a prompt it answers worse.
 *
 * `docs/build-phases.md` names fifty. Fifty is measurably the worst of the
 * three.
 */
export const RERANK_TOP_N = 20;

/**
 * The ceiling, whatever a caller asks for.
 *
 * Fifty is what `docs/build-phases.md` names, and it is also about where the
 * prompt stops being a prompt: fifty candidates with four statements each is
 * already several thousand tokens, and the search endpoint is public.
 */
export const RERANK_MAX_CANDIDATES = 50;

/** The cap on the sentence. The same 200 as everywhere else in this codebase. */
export const MAX_RERANK_INPUT = 200;

/**
 * How many HTTP requests one judgement costs.
 *
 * ONE PER SAMPLE, so one — and it is written as `RERANK_SAMPLES` rather than as
 * a literal because the two must never disagree. The precision work measured
 * two samples and did not ship them (see above), and the reason this constant
 * is derived is that the cap counts REQUESTS: a judgement that quietly became
 * two calls against a constant still saying one would have doubled the
 * worst-case bill with nothing in the project to notice it. `mayCallRerank()`
 * defaults to this, `.env.example`'s MAX_RERANK_CALLS_PER_DAY is costed from
 * it, and `tests/rate-limit.test.mjs` is where the arithmetic has to close.
 */
export const RERANK_REQUESTS_PER_JUDGEMENT = RERANK_SAMPLES;

/**
 * The ceiling on what one judgement may produce.
 *
 * IT WAS 2,000, AND 2,000 WAS NOT A CEILING. Twenty verdicts of about a dozen
 * tokens each plus minimal reasoning measures ~206 output tokens across every
 * judgement in the fixture, so two thousand was nearly ten times the need — and
 * `max_output_tokens` is the number the WORST case is billed at, which is what
 * a daily cap has to bound. The Phase 5 review made the cap arithmetic compute
 * from these ceilings rather than from the averages, and at 2,000 the three
 * caps together came to $17.52 a month against a $5 ceiling.
 *
 * AND 700 WAS A MEAN TIMES THREE AND A HALF, which is the right shape of
 * number chosen from the wrong statistic. A ceiling belongs on the tail, and
 * the tail is now printed by every recording run — "output tokens per request:
 * p50 238, p90 247, p99 250, max 293 over 707 call(s)". The rule is the
 * reader's rule, three times the p99, which is 750: fifty MORE than the number
 * that was here, and the same rule that took the reader's from 900 to 360.
 *
 * If a judgement ever comes back with no text because it ran past this, the
 * response carries `status: incomplete`, `callResponses` refuses it by name,
 * and — since the precision work — the other sample is used alone. If both run
 * past it the page is the Phase 4 page, the same failure as a timeout, and
 * visible in the "recorded judgements refused" line of any run.
 */
export const RERANK_MAX_OUTPUT_TOKENS = 750;

/**
 * How hard the model may think before judging.
 *
 * MEASURED, and the measurement is in eval/baselines.md. The Phase 5 review
 * found that 27 of 194 (slug, sentence) judgements changed across three live
 * calls — 14% — and 26 of those crossed the line between shown and not shown,
 * which is a page that changes under a person who reloads it. The obvious lever
 * is reasoning effort, so it was tried rather than assumed.
 *
 * TEN SENTENCES, THREE CALLS EACH, AT BOTH SETTINGS:
 *
 *   minimal  30 calls, 0 failed   37 of 147 pairs changed (25.2%), 26 crossed
 *   low      12 calls, 18 FAILED   0 of  38 pairs changed, on the 12 that returned
 *
 * `low` is not a choice this timeout can make. Eighteen of its thirty calls did
 * not finish inside the four seconds a visitor is waiting — the slowest that did
 * took 4,020 ms — so the setting that looks perfectly stable is stable on the
 * third of its calls that came back, and the other two thirds are a page with no
 * judgement on it at all. Buying stability by not answering is not buying
 * stability. It is also dearer per judgement ($0.000238 against $0.000183),
 * because the reasoning tokens are output tokens.
 *
 * So: `minimal`, and the instability is written down rather than fixed —
 * `docs/loop-progress.md` known weaknesses, and beside the spread in
 * `eval/baselines.md`. The honest ways to spend money on it are a longer
 * timeout, or two samples that vote the way the reader's do; both are changes to
 * what a search costs and neither is a constant in this file.
 */
export const RERANK_EFFORT: 'minimal' | 'low' = 'minimal';

/** Candidate text is capped too: one listing may not fill the whole prompt. */
const MAX_CANDIDATE_SUMMARY = 300;
const MAX_CANDIDATE_STATEMENT = 200;

/**
 * How many of a candidate's problem statements the model is shown. FOUR.
 *
 * THE MODEL DOES NOT SEE THE WHOLE LISTING, and a claim that it judged "the
 * tool" is a claim about these four sentences and the summary. A listing with
 * nine statements is judged on the first four in `sort_order` — which is the
 * order the listing's own author chose, not a ranking against the sentence, so
 * the statement that would have answered this particular person can be the
 * fifth one and never leave the database.
 *
 * Four because the prompt is public and paid for by the request: twenty
 * candidates at four statements each is the ~2,100 input tokens the cost model
 * in `lib/prices.ts` is built on, and `docs/build-phases.md`'s own seed
 * requirement is four statements per tool, so four is what nearly every
 * published listing has. It is a budget, though, not a finding — nobody has
 * measured what eight would do, and the honest way to raise it is to measure
 * the nDCG and the bill together rather than to assume more text is better.
 *
 * `docs/loop-progress.md` and `docs/product-decisions.md` §6 say the same thing
 * in prose, because it is the kind of limit a reader of a ranked page would
 * want to know about and would never guess.
 */
export const MAX_CANDIDATE_STATEMENTS = 4;

/**
 * One candidate, as the model sees it. Four fields, and there is no fifth.
 *
 * This type is the privacy and fairness boundary of the whole feature: what is
 * not on it cannot reach the model. Adding a field here is a decision somebody
 * makes on purpose, and `tests/rerank.test.mjs` asserts the keys of what
 * actually goes out.
 */
export interface RerankCandidate {
  slug: string;
  name: string;
  summary: string;
  statements: string[];
}

/** One judged candidate. */
export interface RerankVerdict {
  slug: string;
  /** 0 not for this, 1 loosely, 2 fits, 3 clearly fits. */
  relevance: 0 | 1 | 2 | 3;
}

/** A validated judgement: every candidate, once, with a known relevance. */
export type RerankJudgement = RerankVerdict[];

export interface RerankResult {
  judgement: RerankJudgement;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /**
   * Output tokens per REQUEST, one entry per sample that came back.
   *
   * The totals above are what the judgement cost; this is what each call
   * produced, and it is a different question with a different use. A daily cap
   * is multiplied by `max_output_tokens`, so the ceiling has to be set from the
   * distribution of these rather than from their mean — `eval/run.mjs` prints
   * p50, p99 and the maximum of every call a recording made, and
   * `scripts/output-tokens.mjs` does the same for the reader.
   */
  outs: number[];
  /** How many of the `RERANK_SAMPLES` calls came back. 1 means no vote. */
  samples: number;
}

/**
 * What the model is told.
 *
 * NO GOLDEN-SET TEXT APPEARS HERE, and none may. `docs/phase-goals.md` Phase 5
 * item 2 says it of the generator; it is true twice over of the reranker,
 * which is scored on that set directly. The worked examples below are invented
 * situations about invented tools, chosen to carry the four grades rather than
 * to resemble anything measured.
 *
 * Every paragraph is a failure somebody has already had with this catalogue.
 * The asymmetry at the top of it is the same one the reader's prompt is built
 * on, pointed the other way: the reader must not invent a filter, because a
 * wrong filter hides the right answer. The reranker must not be generous,
 * because a 2 on something that does not fit is how a page of near misses
 * survives the one thing that was supposed to empty it.
 */
export const RERANK_INSTRUCTIONS = [
  'You are given ONE sentence from somebody describing a problem, and a list of',
  'software tools that a search returned for it. For each tool, say how well it',
  'answers THAT sentence.',
  '',
  'Return one entry per tool, using the tool\'s slug exactly as given. Judge every',
  'tool in the list. Add nothing and leave nothing out.',
  '',
  'relevance:',
  '  3  clearly fits — this tool exists to do the thing the sentence describes.',
  '     Somebody with this problem would be glad to be shown it first.',
  '  2  fits — it does the thing, perhaps as one feature among many, perhaps in a',
  '     heavier or lighter way than asked for. A reasonable answer.',
  '  1  loosely — it is in the right area and might help sideways, but it is not',
  '     what was asked for. Worth showing below better answers, not on its own.',
  '  0  NOT FOR THIS — it shares words, or a topic, or a category, and does not',
  '     do what the sentence asks. Show it to nobody.',
  '',
  'BE STRICT, AND UNDERSTAND WHY. These tools were retrieved because they share',
  'words or meaning with the sentence, which is not the same as answering it.',
  'The commonest wrong answer is a tool from the same subject area: the sentence',
  'is about recording, the tool records; the sentence is about contracts, the tool',
  'handles contracts — and the person asked for something a program cannot be.',
  'Sharing a subject is 0, not 1. Reserve 1 for a tool that would genuinely help',
  'a bit.',
  '',
  'A tool is 0 when the sentence asks for a person, an object, a fact, an errand',
  'somewhere, or a service performed by somebody else, and the tool merely works',
  'in that subject. It is also 0 when it does a neighbouring job: a sentence about',
  'getting a file back is not answered by a tool that makes files smaller.',
  '',
  'You are judging FIT, not quality, popularity or price. Nothing about how good,',
  'well known or expensive a tool is belongs in this answer, and you are not told',
  'any of it. If two tools fit equally, give them the same number.',
  '',
  'Everything you need is in the sentence and in each tool\'s own name, summary',
  'and problem statements. You have no other knowledge of these tools that counts.',
  '',
  'It is correct and expected for every tool in the list to be 0. A search that',
  'found nothing that fits should empty the page, and your 0s are how it does.',
  '',
  'Two worked examples. The tools in them are invented.',
  '',
  'sentence: "I keep forgetting which of the plants I watered this week"',
  '  sprout-diary   "Logs when you watered each houseplant and reminds you"   -> 3',
  '  garden-planner "Designs a vegetable bed layout by season"                -> 1',
  '  waterworks-pro "Monitors municipal water mains for leaks"                -> 0',
  '',
  'sentence: "somebody has to come and take the old fridge away"',
  '  clearout-app  "Books a licensed waste carrier to collect large items"    -> 0',
  '  homelist      "Keeps a list of jobs to do around the house"              -> 0',
  '',
  'The second example has no answer at all, and that is the right answer: the',
  'person wants a van and two people, not a program. Booking one through an app',
  'is still the app booking somebody else to do it.',
].join('\n');

/**
 * The schema, built for one candidate list.
 *
 * `slug` is an ENUM of exactly the slugs that were given. That is the strongest
 * form of "the model may name no tool": the provider's structured output will
 * not emit a value outside it, so a hallucinated slug is impossible rather than
 * merely rejected. `validateJudgement` refuses one anyway, because a guarantee
 * that lives entirely at somebody else's end of a socket is a guarantee on
 * loan.
 *
 * `minItems`/`maxItems` are deliberately absent: they are not supported in the
 * provider's strict mode, and a schema that is silently relaxed is worse than
 * one that never claimed. Completeness is the validator's job.
 */
export function rerankSchema(slugs: readonly string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slug: { type: 'string', enum: [...slugs] },
            relevance: { type: 'integer', enum: [0, 1, 2, 3] },
          },
          required: ['slug', 'relevance'],
        },
      },
    },
    required: ['results'],
  };
}

/**
 * The other half of the cache key: which candidates this judgement is about.
 *
 * Sorted before hashing, so the key is about the SET and not about the order
 * the search happened to return it in — two searches that retrieved the same
 * tools in a different order ask the model the same question and get the same
 * answer. Joined with a newline, which cannot appear in a slug.
 */
export function candidatesHash(slugs: readonly string[]): string {
  return createHash('sha256').update([...slugs].sort().join('\n'), 'utf8').digest('hex');
}

/**
 * Which of a search's results are judged, and in what shape.
 *
 * **The one function that decides what the reranker sees**, and both callers
 * use it — `app/results/page.tsx` on a decorated search row and `eval/run.mjs`
 * on a bare one. That is not tidiness: the last two reviews each caught the
 * application and the harness deciding the same thing in two places, and each
 * time it invalidated a phase's number. `tests/parity.test.mjs` puts the same
 * rows through both callers and asserts the candidates and the hash are
 * identical.
 *
 * It takes the top `n`, capped at `RERANK_MAX_CANDIDATES`, in the order the
 * search returned them — and it copies across exactly four fields, so a caller
 * that has a score, a rank, a rating or a like count on its rows cannot leak
 * one into the prompt by passing the row through.
 */
export function rerankCandidates(
  results: readonly {
    slug: string;
    name: string;
    summary?: string | null;
    statements?: readonly string[] | null;
  }[],
  n: number = RERANK_TOP_N,
): RerankCandidate[] {
  const take = Math.max(0, Math.min(n, RERANK_MAX_CANDIDATES));
  return results.slice(0, take).map((row) => ({
    slug: String(row.slug),
    name: String(row.name),
    summary: String(row.summary ?? ''),
    statements: (row.statements ?? []).map((s) => String(s)),
  }));
}

/**
 * Control characters, and everything a line-oriented prompt can be split with.
 *
 * THIS IS THE FIX FOR A REAL ATTACK, and the attack is worth writing down
 * because the damage was invisible. The first version of `rerankInput` built a
 * line-per-field YAML-ish block by interpolation, so a problem statement
 * containing a newline — `"...\n- slug: something-else"` — forged a second
 * candidate in the list. The model then answered about a slug that was not in
 * the schema's enum, or omitted a real one, and `validateJudgement` refused the
 * WHOLE judgement. Every search whose candidate set contained that tool fell
 * silently back to the Phase 4 order, for ever, with one log line nobody reads.
 *
 * A statement is written by a person today and by a MAKER from Phase 7, so this
 * is the path a listing owner will one day control.
 *
 * Two defences, because either alone is thin. The candidates go out as JSON
 * rather than as lines, so a newline inside a value is escaped by
 * `JSON.stringify` and cannot start a new field. And every field is stripped of
 * control characters first, so the escaped form does not reach the model as
 * `\n` either — it is not there at all.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;

/** One candidate field, capped and stripped. Never a place to hide a newline. */
function clean(text: unknown, limit: number): string {
  return capText(String(text ?? '').replace(CONTROL_CHARACTERS, ' '), limit).replace(/\s+/gu, ' ').trim();
}

/**
 * The one string the model is given. Exported so a test can read what goes out.
 *
 * JSON, not prose: `{"sentence": ..., "tools": [{slug, name, summary, solves}]}`.
 * The shape is fixed by `JSON.stringify` rather than by this function's
 * formatting, which is what makes a candidate unable to forge a sibling.
 */
export function rerankInput(sentence: string, candidates: readonly RerankCandidate[]): string {
  return JSON.stringify(
    {
      sentence: clean(capText(sentence, MAX_RERANK_INPUT), MAX_RERANK_INPUT),
      tools: candidates.map((candidate) => ({
        slug: clean(candidate.slug, 120),
        name: clean(candidate.name, 120),
        summary: clean(candidate.summary, MAX_CANDIDATE_SUMMARY),
        solves: candidate.statements
          .slice(0, MAX_CANDIDATE_STATEMENTS)
          .map((statement) => clean(statement, MAX_CANDIDATE_STATEMENT))
          .filter(Boolean),
      })),
    },
    // COMPACT, with no indentation, and that is part of the guarantee rather
    // than a saving: with no pretty-printing there is not a single control
    // character anywhere in what goes out, so "this prompt contains no control
    // characters" is one assertion over the whole string rather than a walk of
    // its values. It is also a few hundred tokens cheaper per search.
  );
}

export type RerankFailure = string;

/**
 * Turn whatever came back into a judgement, or say why it will not be used.
 *
 * Hand-written, like `validateReading`, and for the same reason: a schema
 * validator is a dependency on the path between a stranger's sentence and our
 * database, and the shape being checked here is two fields.
 *
 * It refuses, in this order: a non-object; a missing or non-array `results`; an
 * extra key at either level; an entry that is not an object; a missing `slug`
 * or `relevance`; a relevance that is not one of 0, 1, 2, 3; a slug that was
 * not a candidate; a duplicate slug; and a candidate the model did not judge.
 * The last two are the ones that matter: a duplicate is the model voting twice,
 * and a missing candidate is a result silently dropped from a page by nobody's
 * decision.
 */
export function validateJudgement(
  value: unknown,
  slugs: readonly string[],
): { judgement: RerankJudgement } | { error: RerankFailure } {
  // TWO SHAPES, on purpose, and it is the same judgement either way.
  //
  // The model answers `{"results": [...]}`, because a strict JSON schema's root
  // has to be an object. What is STORED — in the cache and in the fixture — is
  // the array, because the wrapper carries nothing and a row that is an array
  // is a row a jsonpath CHECK can describe. So this accepts either, and the
  // one place that mattered is the cache read: an earlier version took the
  // object only, and every cached judgement came back refused with "the
  // response is not a JSON object" while the search quietly fell back to the
  // Phase 4 order. It looked exactly like a working fallback.
  let rows: unknown;
  if (Array.isArray(value)) {
    rows = value;
  } else if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const field of Object.keys(obj)) {
      if (field !== 'results') return { error: `the response has an extra field "${field}"` };
    }
    rows = obj.results;
  } else {
    return { error: 'the response is not a JSON object' };
  }
  if (!Array.isArray(rows)) return { error: 'results is not an array' };

  const allowed = new Set(slugs);
  const seen = new Set<string>();
  const judgement: RerankJudgement = [];

  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return { error: 'a judgement entry is not an object' };
    }
    const entry = row as Record<string, unknown>;
    for (const field of Object.keys(entry)) {
      if (field !== 'slug' && field !== 'relevance') {
        return { error: `a judgement entry has an extra field "${field}"` };
      }
    }
    const slug = entry.slug;
    const relevance = entry.relevance;
    if (typeof slug !== 'string') return { error: 'a judgement entry has no slug' };
    if (typeof relevance !== 'number' || !Number.isInteger(relevance) || relevance < 0 || relevance > 3) {
      return { error: `relevance for "${slug}" is not one of 0, 1, 2, 3` };
    }
    if (!allowed.has(slug)) {
      // The one that would be a tool invention. The schema's enum makes it
      // impossible at the provider's end; this makes it harmless at ours.
      return { error: `"${slug}" was not one of the candidates` };
    }
    if (seen.has(slug)) return { error: `"${slug}" was judged twice` };
    seen.add(slug);
    judgement.push({ slug, relevance: relevance as 0 | 1 | 2 | 3 });
  }

  if (seen.size !== allowed.size) {
    const missing = [...allowed].filter((s) => !seen.has(s));
    return {
      error: `${missing.length} candidate(s) were not judged, starting with "${missing[0]}"`,
    };
  }

  return { judgement };
}

/**
 * The lowest grade that still reaches a page.
 *
 * IT WAS 1, AND 1 MEANT SHOWING "LOOSE". The band's own words are "this is in
 * the right area rather than an answer to it", `docs/product-decisions.md` §17
 * has said since Phase 5 that "relevance 1 is not a good match", and the owner
 * asked on 12 September 2026 for a page that says there is no matching tool
 * rather than one that shows a tool that is not related. A row the product
 * describes as not an answer, on a page it does not count as a match, is
 * exactly the row he was talking about.
 *
 * MEASURED, AND MEASURED FOR NOTHING. The threshold is applied when a judgement
 * is USED rather than when it is recorded, so ONE recording's judgements score
 * at every value of it: `eval/run.mjs --rerank-floor=` re-scores the whole
 * instrument — 60 golden queries, 31 negatives, two held-out files, 15
 * answerable sentences, 240 perturbations — without an API call. That is the
 * only reason this is a decision rather than a preference. The same frozen
 * recording at each value (`eval/recordings/shown1-frozen.json`,
 * `shown2-frozen.json`, and the frontier table in `eval/baselines.md` under
 * "Ranking precision (after Phase 6)"):
 *
 *   shown from   nDCG@10   recall@10   golden empty   negatives   held-out
 *   1            0.8796    0.7875      0              21 of 31    19 of 25
 *   2 (ships)    0.8645    0.7269      0              24 of 31    22 of 25
 *   3            0.7398    0.4967      3              29 of 31    23 of 25
 *
 * THREE IS WHY THERE IS A CEILING ON THIS. It refuses 29 of 31 unanswerable
 * sentences and empties three golden queries and six of the 240 perturbations
 * doing it. A page that is empty for somebody with a real question is the one
 * failure this project treats as absolute, so 3 is in the table to save the
 * next person the recording.
 *
 * What 2 costs is real and is recorded beside it: every graded-relevant tool
 * the model calls 1 leaves the page, so recall@10 falls 0.0606 and nDCG@10
 * 0.0151. It is the trade the owner asked for, priced rather than assumed.
 */
export const RERANK_SHOWN_FROM: 1 | 2 = 2;

/**
 * The final order, and the only place it is decided.
 *
 * Relevance descending, then the order the Phase 4 search already produced —
 * which is what "then Phase 4 rank" means and why the second key is the index
 * rather than the score: the score is an RRF sum whose ties the database
 * already broke, and re-breaking them here would be a second opinion nobody
 * asked for. Anything judged below `shownFrom` is dropped.
 *
 * `items` may be anything with a slug, so the application can pass its
 * decorated result rows and the harness can pass its bare ones and both get the
 * same answer. A candidate the judgement does not mention is dropped as well:
 * `validateJudgement` makes that unreachable, and if it ever became reachable,
 * showing an unjudged tool on a judged page is the wrong way to fail.
 *
 * `shownFrom` is a PARAMETER with the shipped constant as its default, and it
 * is a parameter for one reason: the harness sweeps it (`--rerank-floor=`) over
 * judgements that are already recorded, so choosing it costs no API call. Both
 * callers in the application pass nothing and get `RERANK_SHOWN_FROM`, which is
 * what keeps this the one function that decides the order.
 */
export function applyRerank<T extends { slug: string }>(
  items: readonly T[],
  judgement: RerankJudgement,
  shownFrom: number = RERANK_SHOWN_FROM,
): T[] {
  const relevance = new Map(judgement.map((v) => [v.slug, v.relevance]));
  return items
    .map((item, index) => ({ item, index, relevance: relevance.get(item.slug) ?? 0 }))
    .filter((row) => row.relevance >= shownFrom)
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .map((row) => row.item);
}

/** The relevance a judgement gave one slug, or null when it judged no such thing. */
export function relevanceOf(judgement: RerankJudgement | null, slug: string): 0 | 1 | 2 | 3 | null {
  if (!judgement) return null;
  for (const verdict of judgement) if (verdict.slug === slug) return verdict.relevance;
  return null;
}

/**
 * The bands, which is all Phase 5 draws.
 *
 * THE `1` CASE IS UNREACHABLE FROM A PAGE while `RERANK_SHOWN_FROM` is 2, and
 * it is kept rather than deleted: the scale is still four points, the threshold
 * is a measured number a later measurement may move, and the words for a grade
 * belong in one place whether or not today's page shows them. `/ranking` tells
 * a visitor that only two of the three appear, which is the sentence that has
 * to stay true.
 *
 * `docs/build-phases.md` forbids a rescaled similarity shown as a percentage,
 * and Phase 5 does not have the judged pairs to calibrate a real one — see
 * `/ranking` and `eval/calibrate.mjs`. What it does have, where the reranker
 * ran, is a judgement on a four-point scale from a model that was shown the
 * sentence and the tool and nothing else. That is a weaker claim than a
 * percentage and a stronger one than "your words turned up here", and these
 * three words are the whole of it.
 */
export function relevanceBand(
  relevance: 1 | 2 | 3,
): { label: string; note: string; tone: 'both' | 'one' | 'name' } {
  switch (relevance) {
    case 3:
      // SOFTENED after the Phase 5 review. It used to read "this is what the
      // tool is for", which is a claim about the TOOL — and the judgement
      // behind it is one model's reading of one listing's own description
      // against one sentence, which cannot establish what a product is for. It
      // can say that the two were read together and came out looking like a
      // close match, and that is what it now says.
      return {
        label: 'Strong',
        note: 'Your sentence and this listing were read together, and this looked like a close match.',
        tone: 'both',
      };
    case 2:
      return {
        label: 'Possible',
        note: 'Your sentence and this listing were read together: it does the job, perhaps as one part of a larger tool.',
        tone: 'one',
      };
    default:
      return {
        label: 'Loose',
        note: 'Your sentence and this listing were read together: this is in the right area rather than an answer to it.',
        tone: 'name',
      };
  }
}

/**
 * True when at least one result was judged to fit. The definition of a good
 * match, and `docs/product-decisions.md` §17 is where it is decided.
 *
 * SINCE `RERANK_SHOWN_FROM` BECAME 2 THIS IS TRUE EXACTLY WHEN `shown` IS NOT
 * EMPTY, on a judged search, because nothing below 2 reaches a page any more.
 * §17 was written to stop this column being `result_count > 0` wearing a name
 * that promises more, and the two have now coincided — not because a guess
 * crept back in, but because the owner's precision decision made the bar for
 * being shown the same as the bar for fitting. It is recorded there rather than
 * here, `match_judged` still separates "nobody looked" from "read and nothing
 * fitted", and this function is still the ONE place either question is
 * answered, which is what matters if a later phase separates them again.
 */
export function hadGoodMatch(judgement: RerankJudgement | null, shown: readonly string[]): boolean {
  if (!judgement) return false;
  const on = new Set(shown);
  return judgement.some((v) => v.relevance >= 2 && on.has(v.slug));
}

/**
 * The lower mark of two judgements of the same candidate list, slug by slug.
 *
 * The whole of lever 1, and it is four lines because it has to be readable:
 * the number a person sees is the SMALLER of what two readings of the same
 * pair produced, so a grade that appears once and not twice never reaches a
 * page. Exported so `tests/rerank.test.mjs` can put two judgements through it
 * rather than through a live model.
 *
 * The order is the FIRST judgement's, which is the order the search returned
 * the candidates in — `applyRerank` re-sorts anyway, and keeping one side's
 * order makes the result of `lowerOf(a, b)` and `lowerOf(b, a)` identical in
 * content and stable in sequence. A slug in one and not the other cannot
 * happen: `validateJudgement` has already refused any judgement that does not
 * name every candidate exactly once. If it somehow did, the missing side
 * counts as 0, which is the refusing direction.
 */
export function lowerOf(a: RerankJudgement, b: RerankJudgement): RerankJudgement {
  const other = new Map(b.map((v) => [v.slug, v.relevance]));
  return a.map((verdict) => ({
    slug: verdict.slug,
    relevance: Math.min(verdict.relevance, other.get(verdict.slug) ?? 0) as 0 | 1 | 2 | 3,
  }));
}

/**
 * True when a sample graded every candidate 0: "nothing here is for this".
 *
 * Exported because it names the thing the measurement below is about, and
 * because `eval/run.mjs` counts how many of a recording's judgements are of
 * this shape — a run that refuses every page is a run to distrust.
 */
export function refusedEverything(judgement: RerankJudgement): boolean {
  return judgement.length > 0 && judgement.every((v) => v.relevance === 0);
}

/**
 * The one judgement, out of however many samples came back: **the lower mark,
 * and nothing else.**
 *
 * IT IS WORTH KNOWING WHAT WAS TRIED HERE AND MEASURED AWAY, because the thing
 * that was tried is the obvious fix for the plain lower mark's one bad habit.
 *
 * The habit: a sample that grades ALL twenty candidates 0 has refused the whole
 * page, and under the lower mark that one sample has a VETO. On
 * `eval/recordings/min2-2.json` it used it on golden q028 — "edit a video for
 * free without a watermark stamped across it", which this catalogue answers
 * five ways — and on two of the 240 perturbations.
 *
 * The fix: `readSentence`'s own rule, that "a refusal which could not be
 * corroborated is not a refusal". Discard a sample that refuses everything when
 * the other one does not. It was built and recorded
 * (`eval/recordings/vote-1.json`) and then aimed at the sentence this whole
 * change exists for, six judgements of it, `scratch`-side:
 *
 *   the lower mark        receiptly=0 every time (the refusing sample wins)
 *   corroboration rule    receiptly=3 five times of six, =1 once
 *
 * **The veto is not a bug in the lower mark; it is the lower mark.** The same
 * mechanism that empties the owner's page empties q028, and no rule that keeps
 * one can drop the other: a single sample saying "none of these" is exactly
 * what a correct empty page and a wrong empty page look like from here. So the
 * veto stays, the cost is recorded in `eval/baselines.md` as a golden empty on
 * one of three recordings, and the honest summary is that this instrument
 * cannot tell the two apart.
 */
export function combineSamples(judgements: readonly RerankJudgement[]): RerankJudgement {
  if (judgements.length === 0) throw new ReaderError('there are no samples to combine');
  return [...judgements].reduce(lowerOf);
}

/** One call, validated. The unit `rerankOrThrow` takes `RERANK_SAMPLES` of. */
async function judgeOnce(
  sentence: string,
  candidates: readonly RerankCandidate[],
  slugs: readonly string[],
  effort: 'minimal' | 'low',
): Promise<{ judgement: RerankJudgement; tokensIn: number; tokensOut: number }> {
  const answer = await callResponses({
    model: RERANK_MODEL,
    instructions: RERANK_INSTRUCTIONS,
    input: rerankInput(sentence, candidates),
    schemaName: 'rerank_judgement',
    schema: rerankSchema(slugs),
    timeoutMs: RERANK_TIMEOUT_MS,
    maxOutputTokens: RERANK_MAX_OUTPUT_TOKENS,
    effort,
  });

  const checked = validateJudgement(answer.parsed, slugs);
  if ('error' in checked) throw new ReaderError(`schema: ${checked.error}`);

  return { judgement: checked.judgement, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut };
}

/**
 * Ask the model to judge these candidates. Throws `ReaderError` on anything
 * that is not a well-formed 2xx response carrying a valid judgement.
 *
 * `RERANK_SAMPLES` calls, IN FLIGHT TOGETHER so the judgement still costs one
 * round trip of wall time rather than two, and the lower mark of whatever came
 * back. It throws only when every sample failed, and the message is the first
 * failure's — a page with no judgement is the Phase 4 page, and the caller
 * that logs it wants a reason rather than a count.
 */
export async function rerankOrThrow(
  sentence: string,
  candidates: readonly RerankCandidate[],
  options: { effort?: 'minimal' | 'low'; samples?: number } = {},
): Promise<RerankResult> {
  const capped = capText(sentence, MAX_RERANK_INPUT);
  if (capped.trim() === '') throw new ReaderError('the sentence is empty');
  if (candidates.length === 0) throw new ReaderError('there are no candidates to judge');
  if (candidates.length > RERANK_MAX_CANDIDATES) {
    throw new ReaderError(`${candidates.length} candidates is more than the ${RERANK_MAX_CANDIDATES} ceiling`);
  }

  const slugs = candidates.map((c) => c.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new ReaderError('the candidate list has a duplicate slug');
  }

  const wanted = Math.max(1, options.samples ?? RERANK_SAMPLES);
  const effort = options.effort ?? RERANK_EFFORT;
  const settled = await Promise.allSettled(
    Array.from({ length: wanted }, () => judgeOnce(capped, candidates, slugs, effort)),
  );

  const got = [];
  let firstFailure: unknown = null;
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') got.push(outcome.value);
    else if (firstFailure === null) firstFailure = outcome.reason;
  }

  if (got.length === 0) {
    if (firstFailure instanceof ReaderError) throw firstFailure;
    throw new ReaderError('every sample failed');
  }

  return {
    judgement: combineSamples(got.map((g) => g.judgement)),
    model: RERANK_MODEL,
    tokensIn: got.reduce((sum, g) => sum + g.tokensIn, 0),
    tokensOut: got.reduce((sum, g) => sum + g.tokensOut, 0),
    outs: got.map((g) => g.tokensOut),
    samples: got.length,
  };
}

/**
 * Judge these candidates, or return null.
 *
 * Null — and one line on the server's error log, with no key, no sentence and
 * no candidate in it — when there is no key, the provider is down, the call
 * times out, the status is not 2xx, the response is malformed, or the validator
 * refused it. Every one of those leaves the caller with the Phase 4 order it
 * already has.
 */
export async function rerank(
  sentence: string,
  candidates: readonly RerankCandidate[],
): Promise<RerankResult | null> {
  try {
    return await rerankOrThrow(sentence, candidates);
  } catch (error) {
    const reason = error instanceof ReaderError ? error.message : 'unexpected failure';
    console.error(`the reranker was unavailable (${reason}); the search order stands`);
    return null;
  }
}
