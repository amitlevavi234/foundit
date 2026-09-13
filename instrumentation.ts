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
}

export const onRequestError = Sentry.captureRequestError;
