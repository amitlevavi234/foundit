/* ===========================================================================
 * Where a paid call says what it cost, without knowing who is listening.
 *
 * THE OWNER'S ITEM 10, 14 September 2026. The spend ledger has to be written
 * by `lib/reader-model.ts`, `lib/rerank.ts`, `lib/embeddings.ts` and the
 * worker, because those four are the only places that see the provider's own
 * usage fields — and those four are ALSO imported directly by `eval/run.mjs`,
 * `scripts/embed.mjs` and `scripts/embed-worker.mjs`, which are plain Node
 * processes with no Next runtime around them.
 *
 * So they cannot import `lib/spend.ts`: that reaches `lib/db.ts`, which is
 * `server-only` and imports `next/cache`, and the first thing that would
 * happen is `node eval/run.mjs` failing to start. The dependency has to go the
 * other way.
 *
 * THIS MODULE IS A LEAF WITH NO IMPORTS, like `lib/prices.ts` and for the same
 * reason. The four paid paths call `reportSpend` and know nothing else; the
 * application installs a sink that writes to the database
 * (`instrumentation.ts`); the worker installs its own, which writes through
 * its own connection; and everything else — every test, every eval run, every
 * one-shot script — gets the default, which is to do nothing.
 *
 * THE DEFAULT BEING A NO-OP IS THE DESIGN AND NOT A GAP. `infra.spend_ledger`
 * records what THIS DEPLOYMENT spent, and the panel's caption says exactly
 * that. An evaluation run on a laptop is not the deployment, and folding its
 * spend in would make the month-to-date figure depend on who ran what locally.
 *
 * IT CANNOT THROW INTO A PAID PATH. `reportSpend` swallows whatever the sink
 * does, because the sink is installed by somebody else and the caller is in
 * the middle of answering a search.
 *
 * ---------------------------------------------------------------------------
 * THE SINK IS PARKED ON `globalThis`, AND A MODULE-LEVEL `let` DID NOT WORK
 *
 * Found by running it: an uncached search on a production build made a paid
 * call, took 2.4 seconds doing it, and wrote no row. `instrumentation.ts` is
 * compiled into its own bundle by Next — a different layer from the one the
 * pages are built in — so `onSpend` set a variable in one copy of this module
 * and `reportSpend` read another copy's. Both ran, neither was wrong, and
 * nothing was recorded.
 *
 * `lib/rate-limit.ts` parks the limiter on `globalThis` and `lib/page-views.ts`
 * parks the counter there, both with a paragraph saying why. This is a third
 * instance of the same rule, arrived at the same way: **state that has to be
 * the same object for two bundles is state that goes on `globalThis`.** In
 * development it also survives the module being replaced on every edit, which
 * is the reason the other two give.
 * ======================================================================== */

export type SpendKindName = 'reader' | 'rerank' | 'embed' | 'worker';

export type SpendSink = (
  kind: SpendKindName,
  requests: number,
  tokensIn: number,
  tokensOut: number,
) => void;

declare global {
  var __founditSpendSink: SpendSink | null | undefined;
}

function sink(): SpendSink | null {
  return globalThis.__founditSpendSink ?? null;
}

/**
 * Install the sink. Last one wins; there is only ever one process here.
 *
 * Pass `null` to remove it, which is what a test does when it is finished so
 * the next test in the same process is not still writing into its assertions.
 */
export function onSpend(fn: SpendSink | null): void {
  globalThis.__founditSpendSink = fn;
}

/** What is installed, for a test that wants to know. */
export function spendSinkInstalled(): boolean {
  return sink() !== null;
}

/**
 * One paid call, with the provider's own numbers.
 *
 * `requests` is not always one: one READING is two samples and a vote
 * (lib/reader-model.ts, `READER_REQUESTS_PER_READING`), and a judgement is
 * `RERANK_SAMPLES` of them. Recording either as a single request would make
 * the requests column disagree with the bill it is meant to explain.
 */
export function reportSpend(
  kind: SpendKindName,
  requests: number,
  tokensIn: number,
  tokensOut: number,
): void {
  const installed = sink();
  if (!installed) return;
  try {
    installed(kind, requests, tokensIn, tokensOut);
  } catch {
    // A ledger that failed is a number that is too low. It is never a reason
    // for a search to fail, and this is the line that guarantees it.
  }
}
