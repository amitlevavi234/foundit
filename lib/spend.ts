import 'server-only';

import { recordSpend, type SpendKind } from './db';
import { today } from './page-views';
import { callCost } from './prices';

/* ===========================================================================
 * What this deployment has actually spent, written down as it happens.
 *
 * THE OWNER'S ITEM 10, 14 September 2026: "Money spent so far". The Money
 * panel could say what the WORST CASE was — every daily cap spent every day
 * for thirty days — and it could say what this process had counted in the last
 * twenty-four hours, and it could not say what had been spent, because nothing
 * was writing it down. `lib/rate-limit.ts`'s counters are in memory, per
 * process, and a restart forgets them: that is deliberate and it stays, but it
 * means the panel's own copy had to say "there is no month-to-date figure to
 * show that would not be a guess".
 *
 * There is now. `infra.spend_ledger` (0024) is a day, a kind and four numbers,
 * and this is the one module that writes to it.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS ARE THE PROVIDER'S, NOT OURS
 *
 * Every call site already has the answer and every one of them threw it away:
 * `lib/reader-model.ts` returns `tokensIn`/`tokensOut` from
 * `payload.usage.input_tokens`, `lib/rerank.ts` the same, `lib/embeddings.ts`
 * returns `tokens` from `payload.usage.prompt_tokens`. Those fields are what
 * the invoice is computed from, so recording anything else — an estimate, a
 * character count, a constant per request — would be recording a guess under a
 * heading that says "spent".
 *
 * `lib/prices.ts` turns tokens into dollars, with the date the prices were
 * read on beside them. The dollars are stored as well as the tokens on
 * purpose: a price change must not rewrite what last month cost.
 *
 * ---------------------------------------------------------------------------
 * A FAILURE TO RECORD MUST NEVER FAIL A SEARCH
 *
 * That is the brief's sentence and it is the whole contract of this module.
 * Nothing here is awaited, nothing here throws, and the statement underneath
 * (`recordSpend` in lib/db.ts) catches and logs a warning. The worst outcome
 * of a broken ledger is a number on a dashboard that is too low; the worst
 * outcome of one that could throw is a person's search failing because the
 * bookkeeping did.
 *
 * It is called AFTER the answer exists, never before — so a call that is about
 * to be made is not recorded as one that was.
 * ======================================================================== */

/**
 * Record one paid call.
 *
 * @param kind     which of the four paths: `reader`, `rerank`, `embed` (a
 *                 sentence being embedded for a search) or `worker` (the
 *                 batch embedder filling the catalogue).
 * @param requests how many HTTP requests this was. It is not always one: one
 *                 READING is two samples and a vote (lib/reader-model.ts), and
 *                 recording it as one request would make the requests column
 *                 disagree with the bill.
 */
export function spent(
  kind: SpendKind,
  requests: number,
  tokensIn: number,
  tokensOut: number,
): void {
  try {
    const n = Number.isFinite(requests) && requests > 0 ? Math.round(requests) : 0;
    const input = Number.isFinite(tokensIn) && tokensIn > 0 ? Math.round(tokensIn) : 0;
    const output = Number.isFinite(tokensOut) && tokensOut > 0 ? Math.round(tokensOut) : 0;

    // NOTHING AT ALL IS RECORDED FOR A CALL THAT DID NOT HAPPEN. A cached
    // sentence makes no request and reports no tokens, and a row of zeroes for
    // it would put a day on the chart that spent nothing but looks recorded.
    // §10's rule, in the one place it is easiest to get wrong.
    if (n === 0 && input === 0 && output === 0) return;

    recordSpend(today(), kind, n, input, output, callCost(kind, input, output));
  } catch {
    // See the header. There is no failure of this function that is worth a
    // visitor's page.
  }
}
