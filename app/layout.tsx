import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { fontClassNames } from '@/lib/fonts';

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
 * Cloudflare Web Analytics, and why it is rendered here rather than injected.
 *
 * THE FIELD MEASUREMENT OF CORE WEB VITALS IS CLOUDFLARE'S, NOT SENTRY'S, and
 * docs/product-decisions.md §13 says why in full. In one line: it is cookieless
 * and stores no client-side state at all (research/11 §5.2 quotes Cloudflare
 * saying so), which is the only kind of measurement this product can take
 * without a consent banner it has spent two phases avoiding needing.
 *
 * A PROXIED ZONE CAN INJECT THE BEACON AT THE EDGE, AND WE TURN THAT OFF. An
 * edge-injected `<script src>` arrives after the response has left this
 * process, so it cannot carry the request's nonce, and `'strict-dynamic'` in
 * middleware.ts blocks it — silently, which is the worst of both. Rendering it
 * here with the nonce is the same beacon, from the same host, under a policy
 * that is actually enforced. server/cloudflare/README.md carries the matching
 * instruction not to enable automatic injection.
 *
 * NO TOKEN, NO TAG. `NEXT_PUBLIC_CF_BEACON_TOKEN` is created by the owner in
 * 9b and is absent here and in CI, so nothing is rendered, nothing is loaded
 * and no request leaves the page. It is `NEXT_PUBLIC_` because the token is a
 * site identifier that appears in the page source of every site using it — it
 * is not a secret, and scripts/scan-secrets.sh is not asked to treat it as one.
 * ------------------------------------------------------------------------ */
function beaconToken(): string {
  return (process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ?? '').trim();
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const token = beaconToken();
  // Set by middleware.ts on every request. Absent only where middleware does
  // not run, and there is no such route that renders this layout.
  const nonce = token === '' ? '' : ((await headers()).get('x-nonce') ?? '');

  return (
    <html lang="en" className={fontClassNames}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        {token !== '' && nonce !== '' ? (
          <script
            nonce={nonce}
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token })}
          />
        ) : null}
      </body>
    </html>
  );
}
