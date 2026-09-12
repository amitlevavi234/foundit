import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Security',
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
 * Two things live here: what the site does with data, and how somebody tells us
 * it is broken (`research/13-required-pages-and-notices.md` §3.3 and §3.4).
 *
 * The second half is why `/.well-known/security.txt` is not in this commit.
 * RFC 9116 makes exactly two fields mandatory, and one of them is `Contact:` —
 * a security.txt whose contact address was made up is worse than none, because
 * it is the file a researcher trusts instead of looking further. It ships the
 * day there is an address that somebody reads.
 */
export default function Security() {
  return (
    <UnwrittenPage title="Security">
      <p style={{ margin: 0 }}>
        It will say what is encrypted and where, which machine the data sits on and in which
        country, and which outside companies process any of it on Foundit’s behalf — named, with
        what each one gets and why. That list has to describe the stack as deployed rather than as
        planned, and Foundit is not deployed yet.
      </p>
      <p style={{ margin: 0 }}>
        It will also be the page a security researcher lands on: what is in scope, that testing in
        good faith will not be met with a lawyer, where to send a report, and how fast an answer
        should come back. A machine-readable pointer at{' '}
        <code>.well-known/security.txt</code> belongs with it and will exist alongside it. Neither
        is built yet, and for the same reason: both are mostly a contact address, and no address has
        been decided — <Link href="/contact">Contact</Link> says so as well.
      </p>
      <p style={{ margin: 0 }}>
        Nothing on this page is a claim about how Foundit is currently secured.
      </p>
    </UnwrittenPage>
  );
}
