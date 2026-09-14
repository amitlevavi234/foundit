'use client';

import { useEffect } from 'react';

/* ===========================================================================
 * The error page for when the ROOT LAYOUT itself threw.
 *
 * app/error.tsx handles everything below the layout and is the page people
 * actually see. This one replaces `<html>` and `<body>`, so it renders them
 * itself and cannot use the site's header, footer, fonts or tokens — the
 * layout that loads all four is the thing that failed.
 *
 * IT EXISTS FOR ONE REASON: a React render error in the root layout is
 * invisible to `onRequestError`, so without this file the one class of failure
 * that takes every page down at once is the one class Sentry never hears
 * about. `Sentry.captureException` goes through the same `beforeSend` as
 * everything else (lib/sentry-scrub.ts) and is inert without a DSN.
 *
 * THE SDK IS IMPORTED HERE AND NOT AT THE TOP OF THE FILE — the owner's item
 * 3, 14 September 2026. A static `import * as Sentry from '@sentry/nextjs'`
 * in a client component puts a hundred kilobytes of SDK into the bundle of
 * every page that could ever render this boundary, which is all of them, to
 * cover a case that by definition has already gone wrong. `instrumentation-
 * client.ts` has usually loaded it by now anyway, in which case this `import()`
 * resolves from the module cache and costs a microtask; where it has not, the
 * page is already broken and one more fetch is not what is wrong with it.
 *
 * IT SAYS NOTHING ABOUT WHAT WAS TYPED, exactly as app/error.tsx does not:
 * no query, no digest in the body, no `error.message` on the page. A stack
 * trace on a public error page is free reconnaissance, and on /results it
 * would be the sentence itself.
 *
 * The styles are inline because there is no stylesheet to rely on: if
 * `styles/tokens.css` were loading, the root layout would not have thrown.
 * ======================================================================== */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Fire and forget, and swallowed: a reporter that threw inside the error
    // page would replace a page that says something with a blank one.
    void import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          textAlign: 'center',
          padding: 24,
          background: '#FFFCF5',
          color: '#1A1A1A',
          // `system-ui` first, and then font names only. The vendor prefix
          // that usually follows it in a stack like this is deliberately
          // absent: tests/markup.test.mjs refuses that vendor's name anywhere
          // under app/, because docs/product-decisions.md §2 defers their
          // sign-in button, and a font stack is not worth an exception in a
          // rule whose whole value is that it has none.
          font: '16px/1.6 system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <h1 style={{ font: '600 30px/1.2 system-ui, sans-serif', margin: 0 }}>
          Foundit is having a bad moment.
        </h1>
        <p style={{ maxWidth: 440, margin: 0 }}>
          Something fell over before the page could be drawn. Nothing you typed was lost and
          nothing about it was recorded against you.
        </p>
        {/* A plain anchor, and `<Link>` would be wrong here. `<Link>` does a
            client-side navigation through the router, and the router lives
            inside the tree that has just thrown. A full page load is the only
            thing that can be relied on from this component. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" style={{ color: '#C7563F' }}>
          Start over
        </a>
      </body>
    </html>
  );
}
