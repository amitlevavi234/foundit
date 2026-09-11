import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Help',
  robots: { index: false, follow: false },
};

/**
 * `research/13-required-pages-and-notices.md` §3.7 lists an FAQ under the
 * pages whose absence reads badly, for a practical reason: it is the cheapest
 * thing a one-person team can do about support load. It cannot be written
 * usefully out of guesses about which questions arrive — that list comes from
 * questions people actually ask — so this page says what it is for and what
 * already answers itself.
 */
export default function Help() {
  return (
    <UnwrittenPage title="Help">
      <p style={{ margin: 0 }}>
        It will answer the questions people turn out to ask: how to describe a problem so the
        results are worth reading, what the constraints Foundit picks out of a sentence do to the
        answer, what an account will be for, and how a tool gets into the catalogue. Those answers
        are best written from real questions rather than imagined ones, and nobody has asked any
        yet.
      </p>
      <p style={{ margin: 0 }}>
        Two things it will not have to explain, because the site already says them where they
        matter: the results page states what it ordered the list by, and{' '}
        <Link href="/ranking">How the fit score works</Link> is where the longer version of that
        goes.
      </p>
    </UnwrittenPage>
  );
}
