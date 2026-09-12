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
 * ONE. The reader samples twice and votes because its `asks_for_software` can
 * empty a page with no search behind it; a reranker mistake reorders a page or
 * drops one result from it, which is recoverable by reading the next line. The
 * daily cap counts REQUESTS, so this is the number it takes per judgement.
 */
export const RERANK_REQUESTS_PER_JUDGEMENT = 1;

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
 * 700 is three and a half times the measured mean, which is headroom for a
 * candidate list that reasons harder than usual and is still a bound. If a
 * judgement ever comes back with no text because it ran past this, the response
 * carries `status: incomplete`, `callResponses` refuses it by name, and the
 * page is the Phase 4 page — the same failure as a timeout, and visible in the
 * "recorded judgements refused" line of any run.
 */
export const RERANK_MAX_OUTPUT_TOKENS = 700;

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
 * The final order, and the only place it is decided.
 *
 * Relevance descending, then the order the Phase 4 search already produced —
 * which is what "then Phase 4 rank" means and why the second key is the index
 * rather than the score: the score is an RRF sum whose ties the database
 * already broke, and re-breaking them here would be a second opinion nobody
 * asked for. Anything judged 0 is dropped.
 *
 * `items` may be anything with a slug, so the application can pass its
 * decorated result rows and the harness can pass its bare ones and both get the
 * same answer. A candidate the judgement does not mention is dropped as well:
 * `validateJudgement` makes that unreachable, and if it ever became reachable,
 * showing an unjudged tool on a judged page is the wrong way to fail.
 */
export function applyRerank<T extends { slug: string }>(
  items: readonly T[],
  judgement: RerankJudgement,
): T[] {
  const relevance = new Map(judgement.map((v) => [v.slug, v.relevance]));
  return items
    .map((item, index) => ({ item, index, relevance: relevance.get(item.slug) ?? 0 }))
    .filter((row) => row.relevance >= 1)
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

/** True when at least one result was judged to fit. The definition of a good match. */
export function hadGoodMatch(judgement: RerankJudgement | null, shown: readonly string[]): boolean {
  if (!judgement) return false;
  const on = new Set(shown);
  return judgement.some((v) => v.relevance >= 2 && on.has(v.slug));
}

/**
 * Ask the model to judge these candidates. Throws `ReaderError` on anything
 * that is not a well-formed 2xx response carrying a valid judgement.
 */
export async function rerankOrThrow(
  sentence: string,
  candidates: readonly RerankCandidate[],
  options: { effort?: 'minimal' | 'low' } = {},
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

  const answer = await callResponses({
    model: RERANK_MODEL,
    instructions: RERANK_INSTRUCTIONS,
    input: rerankInput(capped, candidates),
    schemaName: 'rerank_judgement',
    schema: rerankSchema(slugs),
    timeoutMs: RERANK_TIMEOUT_MS,
    maxOutputTokens: RERANK_MAX_OUTPUT_TOKENS,
    effort: options.effort ?? RERANK_EFFORT,
  });

  const checked = validateJudgement(answer.parsed, slugs);
  if ('error' in checked) throw new ReaderError(`schema: ${checked.error}`);

  return {
    judgement: checked.judgement,
    model: RERANK_MODEL,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
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
