import type * as SentryTypes from '@sentry/nextjs';

import {
  SHARED_SENTRY_OPTIONS,
  scrubBreadcrumb,
  scrubEvent,
} from '@/lib/sentry-scrub';

/* ===========================================================================
 * The browser's half.
 *
 * ---------------------------------------------------------------------------
 * THE SDK IS LOADED AFTER THE PAGE IS, AND IT USED TO BE LOADED BEFORE
 *
 * THE OWNER'S ITEM 3, 14 September 2026: "find why TBT is ~1 s on a page that
 * does almost nothing". `node scripts/chunks.mjs` answers it — this was the
 * largest client chunk in the build, it was loaded on EVERY route, and most of
 * it was Sentry:
 *
 *   chunk                          raw kB   gzip kB  routes
 *   4218-1617f939e76c4f8b.js        332.5     102.3  every route (54)
 *   main-95d3e51f346ac87a.js        266.1      83.1  (shared or lazy)
 *   framework-f2431946d98e80c4.js   213.9      67.0  (shared or lazy)
 *
 * TWO SENTENCES HERE USED TO OVERSTATE THAT, and both are corrected above —
 * OWNER FEEDBACK, ROUND 1, overclaims 4 and 5.
 *
 *   "by a factor of two" — the table printed directly underneath said 102.3 kB
 *   against 83.1 kB for the next one, which is a factor of 1.24. The chunk was
 *   the largest; it was not twice anything.
 *
 *   "it is 102 kB gzipped of Sentry" — the chunk was not all Sentry. Next's own
 *   breakdown puts the shared slot at 105 kB before this change and 46.6 kB
 *   after it, so about 58 kB of it was removable and the rest was this site's
 *   own code and shared vendor code. Sentry is also still SHIPPED — 121.7 kB
 *   and 119.5 kB gzipped in two lazy chunks on the current build — just after
 *   first paint, which is what the commit title says and what the paragraph
 *   below describes.
 *
 * The measured effect on the pages, from a three-run A/B against `next start`
 * taken on 14 September 2026 (`docs/loop-progress.md`): every page ships 61 to
 * 64 kB less JavaScript, and Total Blocking Time came down on all five.
 *
 * Total Blocking Time is EXECUTION rather than download — the Phase 9a review
 * withdrew the opposite claim and was right to — and a hundred kilobytes of
 * SDK that parses, evaluates and installs two global handlers before the page
 * is interactive is execution on the critical path. The whole of this site's
 * own client code is one `<input>` with a character counter, a `useEffect`,
 * two `useRef`s and an `<a>`: 2 kB. Everything else measured on this page was
 * this import.
 *
 * `import * as Sentry from '@sentry/nextjs'` at the top of this file is a
 * STATIC import in the entry Next loads first, so the bundler has no choice
 * but to put it in the first chunk. The dynamic `import()` below is the whole
 * change: the SDK becomes a chunk of its own that is fetched when the browser
 * is otherwise idle, and the first paint does not wait for it.
 *
 * WHAT IT COSTS, SAID PLAINLY. Between first paint and the idle callback —
 * a few hundred milliseconds on this laptop, longer on a slow phone — Sentry
 * is not installed, and an exception thrown in that window would reach nobody.
 * That window is not left uncovered: two plain listeners are installed
 * SYNCHRONOUSLY below, they cost nothing measurable, and whatever they catch
 * is replayed into the SDK the moment it arrives. An error that happens before
 * the page is interactive is now reported a little later rather than not at
 * all, which is a strictly better trade than the one this file used to make —
 * because until the Phase 9a review's F6 was fixed, the browser half of Sentry
 * was inert and every one of these errors reached nobody anyway.
 *
 * `requestIdleCallback` with a timeout, so a browser that never goes idle
 * still loads it within two seconds, and Safari — which has no
 * `requestIdleCallback` — gets a `setTimeout`.
 *
 * ---------------------------------------------------------------------------
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
 * NO TAG, NO CLIENT — AND NOW, NO DOWNLOAD EITHER. With no `<meta>` tag there
 * is no DSN, `Sentry.init({ dsn: undefined })` would create no transport and
 * queue nothing, and the import below is skipped altogether: a deployment with
 * no DSN configured, CI, and every development machine pay nothing at all for
 * this file. That is new, and it is the part of this change that costs nothing
 * to reason about.
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
 * so that the day somebody turns tracing on they find this comment first. It
 * is a thin wrapper now rather than the SDK's own function, because the SDK's
 * own function does not exist until the SDK does.
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

/**
 * Errors thrown before the SDK arrives, kept until it does.
 *
 * A small, fixed ceiling: this is a bridge across a few hundred milliseconds,
 * and a page in a crash loop must not fill memory with its own stack traces
 * while it waits. Twenty is far more than anything worth reading.
 */
const EARLY_CAP = 20;
const early: unknown[] = [];
let loaded = false;

function remember(error: unknown): void {
  if (loaded || early.length >= EARLY_CAP) return;
  early.push(error);
}

function onError(event: ErrorEvent): void {
  remember(event.error ?? event.message);
}

function onRejection(event: PromiseRejectionEvent): void {
  remember(event.reason);
}

/**
 * What a router transition does before the SDK is here: nothing, and it
 * remembers nothing either.
 *
 * With `tracesSampleRate: 0` the real function produces no span, so there is
 * nothing for a queue to hold. The day tracing is turned on, the first few
 * navigations of a page load will be missing from it, and this paragraph is
 * where somebody will find that out.
 */
type TransitionStart = (href: string, navigationType: string) => void;
let transitionStart: TransitionStart | null = null;

export const onRouterTransitionStart: TransitionStart = (href, navigationType) => {
  transitionStart?.(href, navigationType);
};

const configured = fromMeta();

if (typeof window !== 'undefined' && configured.dsn) {
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const start = async (): Promise<void> => {
    const Sentry = await import('@sentry/nextjs');

    Sentry.init({
      ...SHARED_SENTRY_OPTIONS,
      dsn: configured.dsn,
      environment: configured.environment,
      integrations: [],
      // A TYPE-ONLY import of the SDK, which the bundler erases: the types
      // are needed to write this call and the code is not needed until the
      // browser is idle.
      beforeSend: (event) => scrubEvent(event) as SentryTypes.ErrorEvent | null,
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb) as SentryTypes.Breadcrumb | null,
    });

    transitionStart = Sentry.captureRouterTransitionStart as TransitionStart;
    loaded = true;

    // The SDK's own handlers are installed by `init`, so ours come off — two
    // reports of the same error would be two issues in the inbox.
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);

    // And whatever happened while the browser was still painting.
    for (const error of early.splice(0)) Sentry.captureException(error);
  };

  const idle = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  if (typeof idle === 'function') {
    // The timeout is the guarantee: a tab that never goes idle still reports.
    idle(() => void start(), { timeout: 2_000 });
  } else {
    // Safari has no requestIdleCallback. One tick after the load event is the
    // same intent with the tool that exists there.
    window.setTimeout(() => void start(), 1_000);
  }
}
