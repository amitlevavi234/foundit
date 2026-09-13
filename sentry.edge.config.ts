import * as Sentry from '@sentry/nextjs';

import {
  SHARED_SENTRY_OPTIONS,
  scrubBreadcrumb,
  scrubEvent,
  sentryDsn,
} from '@/lib/sentry-scrub';

/* ===========================================================================
 * The edge runtime — which, in this application, is `middleware.ts` and
 * nothing else.
 *
 * The same options and the same scrubbers as the server. It is a separate file
 * because Next loads one or the other by `NEXT_RUNTIME` (instrumentation.ts),
 * not because anything about it differs.
 *
 * WHAT AN EDGE EVENT WOULD CARRY, and why the scrubber matters here too: a
 * throw in middleware happens on every request to every route, so the URL in
 * it is whatever somebody typed — including /results?q=<sentence>. `scrubUrl`
 * cuts at the first `?`, here as everywhere.
 * ======================================================================== */
Sentry.init({
  ...SHARED_SENTRY_OPTIONS,
  dsn: sentryDsn(process.env),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.APP_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE,
  beforeSend: (event) => scrubEvent(event) as Sentry.ErrorEvent | null,
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb) as Sentry.Breadcrumb | null,
});
