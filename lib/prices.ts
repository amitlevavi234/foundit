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
