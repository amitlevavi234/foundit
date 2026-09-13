import * as Sentry from '@sentry/nextjs';

import {
  SHARED_SENTRY_OPTIONS,
  scrubBreadcrumb,
  scrubEvent,
  sentryDsn,
} from '@/lib/sentry-scrub';

/* ===========================================================================
 * The browser's half.
 *
 * THE ONE THING THAT IS DIFFERENT FROM THE SERVER'S: the DSN comes from
 * `NEXT_PUBLIC_SENTRY_DSN`, because a browser cannot read the server's
 * environment. A Sentry DSN is a public identifier by design — it appears in
 * the page source of every site that uses one and grants nothing but the
 * ability to send events to that project — so this is not a secret reaching a
 * client bundle. `SENTRY_DSN` without the prefix stays server-only, and the
 * two are separate variables so that a deployment can wire up server errors
 * without wiring up browser ones.
 *
 * `integrations: []` — NO DEFAULT INTEGRATIONS AT ALL, which is stricter than
 * the scrubbers and deliberately so. The browser SDK's defaults include
 * `breadcrumbs` (which records every fetch, every navigation and every console
 * line), `browserSession`, and the DOM-recording replay integration. Each of
 * those is a mechanism for the typed sentence to leave the page. What is left
 * is the exception handler and the unhandled-rejection handler, which are the
 * two things an error reporter is for.
 *
 * `onRouterTransitionStart` is exported because Next asks for it to instrument
 * navigations. With `tracesSampleRate: 0` it produces no span, and it is here
 * so that the day somebody turns tracing on they find this comment first.
 * ======================================================================== */
Sentry.init({
  ...SHARED_SENTRY_OPTIONS,
  dsn: sentryDsn(process.env as unknown as Record<string, string | undefined>),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
  integrations: [],
  beforeSend: (event) => scrubEvent(event) as Sentry.ErrorEvent | null,
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb) as Sentry.Breadcrumb | null,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
