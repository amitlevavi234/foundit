import * as Sentry from '@sentry/nextjs';

import {
  SHARED_SENTRY_OPTIONS,
  scrubBreadcrumb,
  scrubEvent,
} from '@/lib/sentry-scrub';

/* ===========================================================================
 * The browser's half.
 *
 * THE ONE THING THAT IS DIFFERENT FROM THE SERVER'S: where the DSN comes from.
 * It is read out of a `<meta name="sentry-dsn">` tag that the SERVER renders
 * on every request (components/AnalyticsBeacon.tsx), and not out of
 * `process.env`.
 *
 * THE PHASE 9a REVIEW'S F6 IS WHY. This file used to call
 * `sentryDsn(process.env)`, with a comment saying the DSN comes from
 * `NEXT_PUBLIC_SENTRY_DSN` "because a browser cannot read the server's
 * environment". Both halves of that were true and the conclusion did not
 * follow: `NEXT_PUBLIC_` is inlined by the bundler at `next build` time, the
 * image is built in CI where no DSN exists, and the runbook then set the name
 * in the container's environment — which is after the build and does nothing.
 * `process.env` does not exist in a browser at all, so this could only ever
 * evaluate to `undefined`, and the browser half of Sentry was permanently
 * inert whatever `/root/.foundit/app.env` held. Browser errors — the whole of
 * app/global-error.tsx — reached nobody.
 *
 * A DSN IN THE PAGE SOURCE IS NOT A LEAK. A DSN is a key, an organisation
 * number, a region and a project number in one string, and it is public by
 * design: Sentry's own documentation says so, it appears in the page source of
 * every site that uses one, and it grants exactly one ability — to SEND an
 * event to that project. It cannot read one, and it is not a credential this
 * repository's scanner is asked to treat as a secret. What stays server-only
 * is everything else in `app.env`.
 *
 * NO TAG, NO CLIENT. `Sentry.init({ dsn: undefined })` creates no transport
 * and queues nothing, which is the state here, in CI, and on any deployment
 * that has not configured one.
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

/** The server's answer, read off the document it rendered. */
function fromMeta(): { dsn: string | undefined; environment: string } {
  if (typeof document === 'undefined') return { dsn: undefined, environment: 'development' };
  const tag = document.querySelector('meta[name="sentry-dsn"]');
  const dsn = (tag?.getAttribute('content') ?? '').trim();
  const environment = (tag?.getAttribute('data-environment') ?? '').trim();
  return {
    dsn: dsn === '' ? undefined : dsn,
    environment: environment === '' ? 'development' : environment,
  };
}

const configured = fromMeta();

Sentry.init({
  ...SHARED_SENTRY_OPTIONS,
  dsn: configured.dsn,
  environment: configured.environment,
  integrations: [],
  beforeSend: (event) => scrubEvent(event) as Sentry.ErrorEvent | null,
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb) as Sentry.Breadcrumb | null,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
