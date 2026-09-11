import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Report a problem',
  robots: { index: false, follow: false },
};

/**
 * `research/13-required-pages-and-notices.md` §4.5 is blunt about this: a
 * footer-only "contact us" is not a notice mechanism. What it asks for is
 * per-item reporting with a reason taxonomy, an acknowledgement to the
 * reporter, a statement of reasons to the author, and separate routes for
 * security and copyright so one shared inbox cannot swallow a vulnerability
 * report.
 *
 * One of those exists today — the per-listing report link on the tool page —
 * and this page says so rather than implying the rest is already there.
 */
export default function Report() {
  return (
    <UnwrittenPage title="Report a problem">
      <p style={{ margin: 0 }}>
        One route already works. At the foot of any tool’s page, “Report this listing” opens an
        email about that listing to the team. It is the only reporting channel Foundit has built so
        far, and it is per-listing on purpose: a report that names what it is about can be acted on,
        and one that does not usually cannot.
      </p>
      <p style={{ margin: 0 }}>
        This page will gather the rest: how to report a review as well as a listing, the reasons a
        report can be made for, what you should expect to hear back and when, and what the person
        who posted the thing is told. Reviews cannot be written yet — they arrive with accounts — so
        there is nothing of that kind to report today.
      </p>
      <p style={{ margin: 0 }}>
        A security flaw is a different kind of report and will have its own route, kept separate so
        it is not lost among the rest; see <Link href="/security">Security</Link>. A copyright
        complaint has a third route, on <Link href="/copyright">Copyright</Link>. Neither of those
        has an address yet.
      </p>
    </UnwrittenPage>
  );
}
