import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Copyright',
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
 * Relevant because listings are user-submitted and will carry copied marketing
 * copy and logos (`research/13-required-pages-and-notices.md` §3.7).
 *
 * The US safe harbour has a shape that cannot be half-done: §512(c) requires an
 * agent registered with the Copyright Office *and* that agent's details
 * published on the site. Publishing invented details would be the worse of the
 * two failures, because it looks like the protection is in place.
 */
export default function Copyright() {
  return (
    <UnwrittenPage title="Copyright">
      <p style={{ margin: 0 }}>
        It will say how to tell Foundit that something on the site infringes your copyright, what a
        notice has to contain for it to be actionable, what happens to the listing or review while
        it is looked at, and how whoever posted it can answer back.
      </p>
      <p style={{ margin: 0 }}>
        Under US law that route runs through a designated agent who has to be registered with the
        Copyright Office and named on the site. Neither has happened, so no agent, address or
        procedure is printed here. A made-up one would look like a working channel and be a dead
        letter.
      </p>
      <p style={{ margin: 0 }}>
        Nothing can be listed or reviewed on Foundit yet, so there is as yet nothing to complain
        about; the one channel that already works is the “Report this listing” link at the foot of
        any tool’s page, and <Link href="/report">Report a problem</Link> explains it.
      </p>
    </UnwrittenPage>
  );
}
