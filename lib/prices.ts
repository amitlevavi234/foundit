/**
 * What the two paid calls cost, in one place, with the date they were read.
 *
 * `docs/build-phases.md` Phase 4 sets a ceiling: **cost per search stays under a
 * fifth of a US cent.** A ceiling nobody can check is a wish, so the numbers it
 * is checked against live here rather than in a comment in a report, and
 * `eval/run.mjs` prints the arithmetic from the provider's own usage counts
 * every time it runs.
 *
 * These are list prices for the standard (non-batch, non-priority) tier, read
 * from the provider's published pricing page on the date below. They are not
 * discovered at runtime and must not be: a price that changes under a running
 * service is a bill nobody read, and the honest failure is a stale number in a
 * file with a date on it that somebody has to update.
 *
 * Source: https://developers.openai.com/api/docs/pricing — the page
 * openai.com/api/pricing redirects to. Read 11 September 2026.
 *
 *   gpt-5-nano                input   $0.05  per 1M tokens
 *                             cached  $0.005 per 1M tokens
 *                             output  $0.40  per 1M tokens
 *   text-embedding-3-small    input   $0.02  per 1M tokens
 *
 * Two things about the arithmetic that are easy to get wrong:
 *
 *   * **Reasoning tokens are billed as output.** `usage.output_tokens` in a
 *     Responses API reply already includes them, so the number the eval reports
 *     is the number on the bill rather than the number of characters in the
 *     JSON. This is why `reasoning: { effort: 'minimal' }` is not a style
 *     choice — at `low` the same sentences cost three to five times as much and
 *     miss the 3-second timeout.
 *
 *   * **The cached-input rate is not claimed anywhere.** The reader's prompt is
 *     long enough (about 1,650 tokens, nearly all of it the same instructions
 *     every time) that the provider's automatic prefix caching will often apply
 *     it, which would make the real bill smaller than the figure printed. The
 *     eval deliberately prices every input token at the full rate: a ceiling
 *     wants the pessimistic number, and nothing here sets a cache key — that
 *     would be a correlation handle on somebody's sentence.
 */

/** US dollars per million tokens. */
export const PRICES_READ_ON = '2026-09-11';
export const PRICES_SOURCE = 'developers.openai.com/api/docs/pricing';

export const READER_INPUT_PER_MTOK = 0.05;
export const READER_CACHED_INPUT_PER_MTOK = 0.005;
export const READER_OUTPUT_PER_MTOK = 0.4;
export const EMBEDDING_INPUT_PER_MTOK = 0.02;

/**
 * The reranker's prices.
 *
 * The same model as the reader — `gpt-5-nano` — so the same two numbers, named
 * separately because they are a separate line on the bill and because the day
 * one of the two models changes, one of these changes and the other does not.
 */
export const RERANK_INPUT_PER_MTOK = 0.05;
export const RERANK_OUTPUT_PER_MTOK = 0.4;

/**
 * The statement generator's prices, for the record.
 *
 * `gpt-5-mini`, and it is NOT a per-search cost: the generation job runs once,
 * by hand, over the tools that have too few statements. It is priced here so
 * the report can say what that run cost rather than leaving it as "cents".
 *
 *   gpt-5-mini   input  $0.25 per 1M tokens
 *                output $2.00 per 1M tokens
 *
 * Read from the same page on the same date as the two above.
 */
export const GENERATOR_INPUT_PER_MTOK = 0.25;
export const GENERATOR_OUTPUT_PER_MTOK = 2.0;

/**
 * The ceiling from docs/build-phases.md, in US dollars per search.
 *
 * A fifth of a cent. Everything below is measured against it, and the eval
 * fails loudly rather than quietly if a change ever crosses it.
 */
export const MAX_COST_PER_SEARCH = 0.002;

/**
 * What this project is willing to lose in a month if every cap is spent every
 * day by somebody doing it on purpose.
 *
 * `docs/build-phases.md` puts a ceiling on the cost of a SEARCH. That bounds the
 * ordinary case and bounds nothing about the adversarial one, because the thing
 * that decides the bill is not the price of a search but how many searches a
 * stranger can make us run. This is the other number, and the daily caps in
 * `.env.example` are chosen against it rather than picked.
 *
 * Five dollars a month, against a server that costs about five euros: an
 * attacker who succeeds completely doubles the running cost of the project, and
 * does not produce a bill anybody has to find out about by reading a statement.
 */
export const MAX_MONTHLY_SPEND = 5;

/**
 * What one request costs, measured — and a number that goes stale.
 *
 * These are averages over everything recorded into
 * `db/seed/embeddings.fixture.json`, divided by the requests each operation is.
 * They are kept here as CONSTANTS rather than read from the fixture so that the
 * arithmetic below works with no file and no database, and that is exactly how
 * they go wrong: the Phase 5 review found the reader's figure still saying
 * 1,850 when the file said 1,965, and a comment citing "327 judgements /
 * 684,735 tokens" that matched no recording that shipped.
 *
 * So the numbers are no longer defended by a comment quoting a run. They are
 * defended by `tests/rate-limit.test.mjs`, which reads the fixture, recomputes
 * every one of them, and fails if a constant here has drifted more than a
 * tenth from what the file measures. A figure with a test under it can be
 * trusted; a figure with an anecdote under it cannot.
 */
export const READER_INPUT_TOKENS_PER_REQUEST = 1_965;
export const READER_OUTPUT_TOKENS_PER_REQUEST = 65;
/** A capped search sentence. Measured the same way: 2,352 tokens for 164. */
export const EMBEDDING_TOKENS_PER_REQUEST = 15;

/**
 * What one reranker request costs, measured.
 *
 * Averaged over every judgement recorded into db/seed/embeddings.fixture.json,
 * the same way as the reader's, and checked against that file by
 * tests/rate-limit.test.mjs rather than against a sentence here — the sentence
 * that used to stand in this place cited "327 judgements, 684,735 tokens" and
 * matched no recording that shipped.
 *
 * The figure is dominated by the CANDIDATES rather than by the instructions, so
 * it moves with RERANK_TOP_N and has to be re-measured when that does: at fifty
 * it was about 2,630 input tokens against about 2,130 at twenty.
 */
export const RERANK_INPUT_TOKENS_PER_REQUEST = 2_126;
export const RERANK_OUTPUT_TOKENS_PER_REQUEST = 206;

/**
 * The ceilings the two requests are made with — lib/reader-model.ts's and
 * lib/rerank.ts's `max_output_tokens`.
 *
 * THE WORST CASE FOR AN OUTPUT BILL IS NOT THE AVERAGE, it is the ceiling: a
 * model that starts reasoning to the limit on every call bills
 * `max_output_tokens` every time, and a daily cap is a bound on the worst case
 * rather than on the ordinary one. The average is what the per-search figure
 * uses; this is what the cap arithmetic uses.
 *
 * BOTH ARE NOW MEASURED RATHER THAN PICKED, and both came down. The rule is
 * three times the p99 of the per-request distribution, taken over the
 * sentences the eval searches with:
 *
 *   reader   900 -> 360   p99 117, max 127 over 396 requests
 *                         (scripts/output-tokens.mjs --measure)
 *   rerank   700 -> 750   p99 250, max 293 over 707 calls
 *                         (the "output tokens per request" line of any
 *                          --record-reranks run)
 *
 * The reranker's went UP by fifty, which is the same rule honestly applied:
 * its answer is twenty verdicts rather than seven fields, its p99 is twice the
 * reader's, and 700 was 2.8 times it rather than three. The two changes
 * together still free about $1.30 a month of worst case, which is what pays
 * for the reranker's second sample.
 *
 * Written here rather than imported so lib/prices.ts stays a leaf with no
 * imports of its own; tests/rate-limit.test.mjs asserts the two pairs agree.
 */
export const READER_MAX_OUTPUT_TOKENS = 360;
export const RERANK_MAX_OUTPUT_TOKENS = 750;

export interface DailyCaps {
  embeddingCallsPerDay: number;
  readerCallsPerDay: number;
  rerankCallsPerDay: number;
}

export interface WorstCase {
  reader: number;
  embedding: number;
  rerank: number;
  total: number;
}

/**
 * What spending every day's cap, every day, for thirty days would cost.
 *
 * The caps count HTTP REQUESTS, so this multiplies request prices by request
 * counts — which is the fix for the defect where one token was taken for the
 * reader's two calls and the real ceiling was double the stated one.
 */
/**
 * Per-request token counts, so a caller with better numbers than the constants
 * can hand them over.
 *
 * `tests/rate-limit.test.mjs` passes the fixture's own measurements and the
 * `max_output_tokens` ceilings, which is the arithmetic the daily caps are
 * actually chosen against; everything else uses the defaults.
 */
export interface PerRequestTokens {
  readerIn: number;
  readerOut: number;
  rerankIn: number;
  rerankOut: number;
  embeddingIn: number;
}

export const DEFAULT_PER_REQUEST: PerRequestTokens = {
  readerIn: READER_INPUT_TOKENS_PER_REQUEST,
  readerOut: READER_OUTPUT_TOKENS_PER_REQUEST,
  rerankIn: RERANK_INPUT_TOKENS_PER_REQUEST,
  rerankOut: RERANK_OUTPUT_TOKENS_PER_REQUEST,
  embeddingIn: EMBEDDING_TOKENS_PER_REQUEST,
};

export function worstCaseMonthly(
  caps: DailyCaps,
  tokens: PerRequestTokens = DEFAULT_PER_REQUEST,
): WorstCase {
  const perReaderRequest =
    (tokens.readerIn * READER_INPUT_PER_MTOK + tokens.readerOut * READER_OUTPUT_PER_MTOK) / 1e6;
  const perEmbeddingRequest = (tokens.embeddingIn * EMBEDDING_INPUT_PER_MTOK) / 1e6;
  const perRerankRequest =
    (tokens.rerankIn * RERANK_INPUT_PER_MTOK + tokens.rerankOut * RERANK_OUTPUT_PER_MTOK) / 1e6;

  const reader = caps.readerCallsPerDay * perReaderRequest * 30;
  const embedding = caps.embeddingCallsPerDay * perEmbeddingRequest * 30;
  const rerank = (caps.rerankCallsPerDay ?? 0) * perRerankRequest * 30;
  return { reader, embedding, rerank, total: reader + embedding + rerank };
}

export interface Usage {
  /** Reader input tokens, billed at the full rate. */
  readerIn: number;
  /** Reader output tokens — reasoning tokens included, as the provider bills. */
  readerOut: number;
  /** Embedding prompt tokens. */
  embeddingIn: number;
  /** Reranker input tokens. Zero on a search the reranker did not run on. */
  rerankIn?: number;
  /** Reranker output tokens, reasoning included. */
  rerankOut?: number;
  /** How many searches these totals are for. */
  searches: number;
}

export interface Cost {
  reader: number;
  embedding: number;
  rerank: number;
  total: number;
  perSearch: number;
  perThousand: number;
  withinCeiling: boolean;
}

/** What a set of measured token counts costs, at the prices above. */
export function costOf(usage: Usage): Cost {
  const reader =
    (usage.readerIn * READER_INPUT_PER_MTOK + usage.readerOut * READER_OUTPUT_PER_MTOK) / 1e6;
  const embedding = (usage.embeddingIn * EMBEDDING_INPUT_PER_MTOK) / 1e6;
  const rerank =
    ((usage.rerankIn ?? 0) * RERANK_INPUT_PER_MTOK +
      (usage.rerankOut ?? 0) * RERANK_OUTPUT_PER_MTOK) /
    1e6;
  const total = reader + embedding + rerank;
  const searches = usage.searches > 0 ? usage.searches : 1;
  const perSearch = total / searches;
  return {
    reader,
    embedding,
    rerank,
    total,
    perSearch,
    perThousand: perSearch * 1000,
    withinCeiling: perSearch < MAX_COST_PER_SEARCH,
  };
}

/** What one generation run cost. Not a per-search figure; see the constants. */
export function generationCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * GENERATOR_INPUT_PER_MTOK + tokensOut * GENERATOR_OUTPUT_PER_MTOK) / 1e6;
}
