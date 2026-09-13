import * as Sentry from '@sentry/nextjs';

import {
  SHARED_SENTRY_OPTIONS,
  scrubBreadcrumb,
  scrubEvent,
  sentryDsn,
} from '@/lib/sentry-scrub';

/* ===========================================================================
 * Errors on the server reach somebody.
 *
 * research/10 §7.2, with the scrubbers this product needs and that document
 * does not discuss. Everything that decides WHAT LEAVES is in
 * lib/sentry-scrub.ts, so the server, the edge and the browser cannot drift
 * apart and so tests/sentry.test.mjs can drive it with no SDK and no DSN.
 *
 * KEYLESS IT IS INERT: `dsn: undefined` disables the client outright. Every
 * test in this repository, CI, and this machine all run without one.
 *
 * NO SOURCE MAPS ARE UPLOADED (next.config.mjs, `sourcemaps.disable`). That
 * would need a `SENTRY_AUTH_TOKEN` at image-build time, which is a credential
 * in CI for the sake of prettier stack traces. The Dockerfile says the same.
 * ======================================================================== */
Sentry.init({
  ...SHARED_SENTRY_OPTIONS,
  dsn: sentryDsn(process.env),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.APP_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE,
  // The default integrations include one that attaches request data — headers,
  // cookies and body — to an event. `sendDefaultPii: false` already limits it
  // and `beforeSend` removes what is left; this is the third layer, and the
  // reason for three is that the first two are the SDK's behaviour and can
  // change under us in a patch release.
  beforeSend: (event) => scrubEvent(event) as Sentry.ErrorEvent | null,
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb) as Sentry.Breadcrumb | null,
});
