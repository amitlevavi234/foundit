import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Pricing',
  robots: { index: false, follow: false },
};

/**
 * Per-visitor, because the header is.
 *
 * Nothing on this page differs between two people — but the header above it
 * now shows an avatar or a Sign in button, which means the page cannot be one
 * static file served to everybody. The catalogue reads underneath are still
 * cached (lib/db.ts); what is no longer cached is the page.
 */
export const dynamic = 'force-dynamic';

/**
 * "Free today" plus "how we make money", folded into one page.
 *
 * `research/13-required-pages-and-notices.md` §3.7 and §3.8: a comparison site
 * with no pricing page reads as free until it isn't, and the moment to write
 * down what paid accounts will and will not buy is while the answer is still
 * "nothing, because there aren't any". `docs/product-decisions.md` §11 has the
 * plan — premium accounts eventually, not soon.
 */
export default function Pricing() {
  return (
    <UnwrittenPage title="Pricing">
      <p style={{ margin: 0 }}>
        Today the whole of Foundit is free, and there is nothing to buy. Searching, browsing and
        every tool page work without an account, and no money changes hands anywhere on the site.
      </p>
      <p style={{ margin: 0 }}>
        This page will say what stays free when that changes, what a paid account would buy, and
        what Foundit charges for instead of charging makers for position. The decision behind it is
        already written down: paid accounts will never affect where a tool appears in results. If
        that is ever false, the sentence on <Link href="/ranking">How the fit score works</Link>
        {' '}stops being true too, and both pages have to change together.
      </p>
      <p style={{ margin: 0 }}>
        No prices, tiers or dates are set, so none are printed here.
      </p>
    </UnwrittenPage>
  );
}
