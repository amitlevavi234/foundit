import { databaseAnswers } from '@/lib/db';

/* ===========================================================================
 * GET /healthz — is this container able to serve a page?
 *
 * WHO ASKS. Three callers, and no browser among them:
 *
 *   the container      `healthcheck:` in server/compose.prod.yml, every 30
 *                      seconds, with `start_interval: 3s` while it boots.
 *   the deploy         `server/deploy.sh` waits on this before it calls a
 *                      deploy finished, and rolls back to the previous tag
 *                      when it never goes green.
 *   an uptime check    from outside the machine, in 9b.
 *
 * WHAT IT DOES. One `select 1` on the application's own pool, with a two
 * second ceiling (`databaseAnswers` in lib/db.ts). 200 and `{"ok":true}` when
 * it comes back, 503 and `{"ok":false}` when it does not. research/10 §3.2 is
 * explicit that a health endpoint must answer 503 rather than 200 with a false
 * in the body: the thing on the other end is a `docker compose --wait` and a
 * `curl -f`, and neither of them reads JSON.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   NO SESSION. `currentUserId()` is not called, no cookie is read, and there
 *   is nothing here for `auth.uid()` to be set from. A probe that authenticates
 *   is a probe that goes red when the authentication library is the thing that
 *   is broken, and a probe that reads a cookie is a probe that can be made to
 *   vary by whoever is holding one.
 *
 *   NO RATE LIMIT. It is excluded from every bucket in lib/rate-limit.ts,
 *   because the caller is a health check that runs every thirty seconds for
 *   ever and a limiter would eventually refuse it. It is unreachable from the
 *   internet in the production arrangement — the tunnel's ingress serves the
 *   site and this path is not something a visitor has a reason to find — and
 *   what it discloses is one bit that `GET /` already discloses.
 *
 *   NO BREADCRUMB. sentry.server.config.ts drops every breadcrumb and every
 *   event whose URL is this path (lib/sentry-scrub.ts, `IGNORED_PATHS`), so
 *   the probe does not become 2,880 breadcrumbs a day in front of the one
 *   error somebody needs to read.
 *
 *   NO COUNT. It writes nothing, anywhere. `infra.ops_events` is for jobs that
 *   ran, not for a liveness probe that runs continuously.
 *
 * `Cache-Control: no-store`, because a cached health check is a health check
 * that reports the state of the machine at some point in the past. Cloudflare's
 * Cache Rules bypass it too (server/cloudflare/README.md, rule 1), but the
 * origin says so itself rather than relying on the edge to be configured.
 * ======================================================================== */

/** Never prerendered, never revalidated, never reused. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function answer(ok: boolean): Response {
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export async function GET(): Promise<Response> {
  return answer(await databaseAnswers());
}

/**
 * HEAD, because `curl -I` and several uptime services send one, and Next would
 * otherwise answer it by running GET and discarding the body — which is the
 * same round trip, but says so nowhere.
 */
export async function HEAD(): Promise<Response> {
  const ok = await databaseAnswers();
  return new Response(null, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
  });
}
