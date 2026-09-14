import * as Sentry from '@sentry/nextjs';

/* ===========================================================================
 * Next's one hook for "run this before anything else, once per runtime".
 *
 * research/10 §7.2's shape, verbatim in structure. The two imports are dynamic
 * because the server config pulls in `@sentry/node` and the edge config must
 * not: loading the Node SDK in the edge runtime is an error, and loading the
 * edge SDK in Node is a silently weaker client.
 *
 * `onRequestError` is what turns a thrown error in a Server Component or a
 * Server Action into an event. Without it the only errors Sentry ever sees are
 * the ones somebody remembered to `captureException` by hand, which is none of
 * them. It goes through the same `beforeSend` as everything else.
 * ======================================================================== */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');

  /* THE SPEND LEDGER'S SINK — the owner's item 10, 14 September 2026.
   *
   * `lib/reader-model.ts`, `lib/rerank.ts` and `lib/embeddings.ts` announce
   * what each paid call cost through `lib/spend-sink.ts`, which imports
   * nothing and does nothing until somebody is listening. This is where the
   * application starts listening, and it is here rather than in a module
   * because it must happen exactly once per process and before the first
   * search — which is the one thing this hook is for.
   *
   * NODE ONLY. The edge runtime has no `pg` and no pool, and the paid paths
   * never run there; installing a sink in it would be a writer that could
   * never write. The dynamic import is for the same reason the Sentry ones
   * above are: `lib/spend.ts` reaches `lib/db.ts`, which is `server-only`.
   */
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ onSpend }, { spent }] = await Promise.all([
      import('./lib/spend-sink'),
      import('./lib/spend'),
    ]);
    onSpend(spent);
  }
}

export const onRequestError = Sentry.captureRequestError;
