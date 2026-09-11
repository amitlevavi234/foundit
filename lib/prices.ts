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
 * What one reader request costs, measured.
 *
 * Averages over the 355 readings recorded into db/seed/embeddings.fixture.json,
 * divided by the two requests each of them is. Kept here rather than read from
 * the fixture so the arithmetic below works with no file and no database — the
 * eval prints the live figure from the fixture itself and the two agree.
 */
export const READER_INPUT_TOKENS_PER_REQUEST = 1_850;
export const READER_OUTPUT_TOKENS_PER_REQUEST = 60;
/** A capped search sentence. Measured over the golden set: 866 tokens for 60. */
export const EMBEDDING_TOKENS_PER_REQUEST = 15;

export interface DailyCaps {
  embeddingCallsPerDay: number;
  readerCallsPerDay: number;
}

export interface WorstCase {
  reader: number;
  embedding: number;
  total: number;
}

/**
 * What spending every day's cap, every day, for thirty days would cost.
 *
 * The caps count HTTP REQUESTS, so this multiplies request prices by request
 * counts — which is the fix for the defect where one token was taken for the
 * reader's two calls and the real ceiling was double the stated one.
 */
export function worstCaseMonthly(caps: DailyCaps): WorstCase {
  const perReaderRequest =
    (READER_INPUT_TOKENS_PER_REQUEST * READER_INPUT_PER_MTOK +
      READER_OUTPUT_TOKENS_PER_REQUEST * READER_OUTPUT_PER_MTOK) /
    1e6;
  const perEmbeddingRequest = (EMBEDDING_TOKENS_PER_REQUEST * EMBEDDING_INPUT_PER_MTOK) / 1e6;

  const reader = caps.readerCallsPerDay * perReaderRequest * 30;
  const embedding = caps.embeddingCallsPerDay * perEmbeddingRequest * 30;
  return { reader, embedding, total: reader + embedding };
}

export interface Usage {
  /** Reader input tokens, billed at the full rate. */
  readerIn: number;
  /** Reader output tokens — reasoning tokens included, as the provider bills. */
  readerOut: number;
  /** Embedding prompt tokens. */
  embeddingIn: number;
  /** How many searches these totals are for. */
  searches: number;
}

export interface Cost {
  reader: number;
  embedding: number;
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
  const total = reader + embedding;
  const searches = usage.searches > 0 ? usage.searches : 1;
  const perSearch = total / searches;
  return {
    reader,
    embedding,
    total,
    perSearch,
    perThousand: perSearch * 1000,
    withinCeiling: perSearch < MAX_COST_PER_SEARCH,
  };
}
