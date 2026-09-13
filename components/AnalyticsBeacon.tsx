import { sentryDsn } from '@/lib/sentry-scrub';

/* ===========================================================================
 * The two things the browser is told about telemetry, rendered by the SERVER
 * at request time.
 *
 * THE PHASE 9a REVIEW'S F6, AND IT IS THE WHOLE REASON THIS FILE EXISTS.
 * Both of these used to be `NEXT_PUBLIC_` variables, which Next inlines into
 * the client bundle at `next build` time. `docs/launch-runbook.md` step 4d
 * told the operator to put the beacon token into `/root/.foundit/app.env` and
 * redeploy — which sets it in the CONTAINER's environment, long after the
 * build — and `.github/workflows/release.yml` passed no `--build-arg`. So the
 * name was dead-code-eliminated to `''` in the image, the beacon could never
 * render, and `process.env` does not exist in a browser at all, so
 * `sentryDsn(process.env)` in instrumentation-client.ts could only ever return
 * undefined. Cloudflare Web Analytics is this product's only field measurement
 * of Core Web Vitals (docs/product-decisions.md §13) and it was inert; browser
 * errors, including the whole of app/global-error.tsx, reached nobody.
 *
 * THE FIX IS THAT NEITHER IS A BUILD-TIME VALUE ANY MORE. There is no
 * `NEXT_PUBLIC_` anything in this repository. `app/layout.tsx` is a Server
 * Component, it runs on every request, and it reads both names out of the
 * container's environment at that moment — so one image runs anywhere and the
 * operator's `app.env` is what decides.
 *
 * NEITHER VALUE IS A SECRET, and that is stated here rather than assumed:
 *
 *   CF_BEACON_TOKEN   a Cloudflare Web Analytics SITE token. It appears in the
 *                     page source of every site using one; it identifies a
 *                     site to a public beacon endpoint and grants nothing.
 *   SENTRY_DSN        a Sentry DSN. It is `https://<key>@o<org>.ingest.<region>
 *                     .sentry.io/<project>`, it is public by design — Sentry's
 *                     own documentation says so — and all it permits is
 *                     SENDING events to that project. It cannot read one.
 *
 * The names carry no prefix all the same, because a prefix is a promise about
 * a build and these are read at runtime.
 * ======================================================================== */

/** The Cloudflare Web Analytics site token, or `''`. Read per request. */
export function beaconToken(env: Record<string, string | undefined> = process.env): string {
  return (env.CF_BEACON_TOKEN ?? '').trim();
}

/**
 * The analytics beacon, or nothing.
 *
 * IT IS RENDERED HERE RATHER THAN INJECTED AT THE EDGE. A proxied Cloudflare
 * zone can inject this script itself, and we turn that off
 * (server/cloudflare/README.md): an edge-injected `<script src>` arrives after
 * the response has left this process, so it cannot carry the request's nonce,
 * and `'strict-dynamic'` in middleware.ts blocks it — silently, which is the
 * worst of both. Rendered here it is the same beacon from the same host under
 * a policy that is actually enforced.
 *
 * NO TOKEN OR NO NONCE, NO TAG: nothing is rendered, nothing is loaded, and no
 * request leaves the page. That is the state here and in CI.
 */
export function AnalyticsBeacon({ nonce }: { nonce: string }) {
  const token = beaconToken();
  if (token === '' || nonce === '') return null;
  return (
    <script
      nonce={nonce}
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}

/**
 * The browser's Sentry DSN and environment, in a meta tag.
 *
 * A META TAG AND NOT A VARIABLE, because there is no third option. A browser
 * cannot read the server's environment; `NEXT_PUBLIC_` would put the value in
 * the bundle at build time, which is the defect this file exists to fix and
 * would also mean one image per deployment. So the server renders what the
 * browser needs into the document it is already sending, and
 * `instrumentation-client.ts` reads it from there.
 *
 * NO TAG WHEN THERE IS NO DSN, so the browser client stays inert rather than
 * being configured with an empty string — which is the state every test in
 * this repository runs in.
 */
export function SentryDsnMeta() {
  const dsn = sentryDsn(process.env);
  if (dsn === undefined) return null;
  return (
    <meta
      name="sentry-dsn"
      content={dsn}
      data-environment={(process.env.SENTRY_ENVIRONMENT ?? 'development').trim() || 'development'}
    />
  );
}
