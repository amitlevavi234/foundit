import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { AnalyticsBeacon, SentryDsnMeta } from '@/components/AnalyticsBeacon';
import { fontClassNames } from '@/lib/fonts';
import { countPageView } from '@/lib/page-views';

import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/motion.css';
import '@/styles/components.css';

export const metadata: Metadata = {
  title: {
    default: 'Foundit — say what’s bugging you, we’ll find the tool',
    template: '%s · Foundit',
  },
  description:
    'Describe a problem in plain language and get the tools that actually solve it, ranked by how well they fit, with the reasons.',
  applicationName: 'Foundit',
  // No referrer leaves this origin. A referrer header on the way out would
  // carry the search query — which is the one thing that must never travel.
  referrer: 'no-referrer',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#FFFCF5',
  colorScheme: 'light',
};

/* ---------------------------------------------------------------------------
 * Cloudflare Web Analytics, and the browser's Sentry DSN.
 *
 * BOTH ARE READ AT REQUEST TIME, FROM THE CONTAINER'S ENVIRONMENT, and
 * components/AnalyticsBeacon.tsx is where the reasoning lives — this layout is
 * a Server Component, which is what makes that possible, and the Phase 9a
 * review's F6 is what made it necessary: both used to be `NEXT_PUBLIC_`
 * variables, which Next inlines at BUILD time, so neither could ever have a
 * value on this host.
 *
 * THE FIELD MEASUREMENT OF CORE WEB VITALS IS CLOUDFLARE'S, NOT SENTRY'S, and
 * docs/product-decisions.md §13 says why in full. In one line: it is cookieless
 * and stores no client-side state at all (research/11 §5.2 quotes Cloudflare
 * saying so), which is the only kind of measurement this product can take
 * without a consent banner it has spent two phases avoiding needing.
 * ------------------------------------------------------------------------ */

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by middleware.ts on every request. Absent only where middleware does
  // not run, and there is no such route that renders this layout.
  const incoming = await headers();
  const nonce = incoming.get('x-nonce') ?? '';

  /* ONE PAGE VIEW — the owner's item 10, 14 September 2026.
   *
   * This is the only place it is counted, because this is the one component
   * that renders for every HTML document and for nothing else: `/healthz` is a
   * Route Handler and `/o` answers 204, so neither reaches here at all, and
   * `_next/static` never touches a React render.
   *
   * WHAT THE TWO HEADERS ARE FOR. A client-side navigation re-renders the tree
   * on the server with `RSC: 1`, which would count a second view for a page
   * somebody is already on; `Next-Router-Prefetch` marks a render for a link
   * nobody has followed. Counting either would make the number bigger than
   * the truth in the direction that flatters it, which is the direction a
   * dashboard figure must never be wrong in.
   *
   * Nothing about the visitor is read, here or in lib/page-views.ts: the whole
   * of the state is a day and an integer, flushed once a minute. See that
   * file for why that is a fact about the deployment rather than about people.
   */
  if (!incoming.get('rsc') && !incoming.get('next-router-prefetch')) countPageView();

  return (
    <html lang="en" className={fontClassNames}>
      <body>
        <SentryDsnMeta />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <AnalyticsBeacon nonce={nonce} />
      </body>
    </html>
  );
}
