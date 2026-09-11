import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Accessibility',
  robots: { index: false, follow: false },
};

/**
 * The one page on this list that is late rather than early.
 *
 * W3C names three parts an accessibility statement has to have: a commitment,
 * the standard applied, and a way for somebody who hits a barrier to reach a
 * human (`research/13-required-pages-and-notices.md` §3.7,
 * <https://www.w3.org/WAI/planning/statements/>). Israeli accessibility
 * regulations 34(ה) and 35ה ask for a published statement too, against IS 5568,
 * which is WCAG 2.0 level AA.
 *
 * Two of the three can be written the day somebody sits down to it. The third
 * cannot: there is no contact address yet (see `/contact`), and inventing one
 * would defeat the only part of the statement that does any work — a person
 * stuck on a page needs somebody to actually answer.
 */
export default function Accessibility() {
  return (
    <UnwrittenPage title="Accessibility">
      <p style={{ margin: 0 }}>
        It will say what Foundit is aiming at, how close it is, and what to do if you hit something
        you cannot use. The target is WCAG 2.2 level AA; the Israeli standard, IS 5568, is WCAG 2.0
        level AA and sits inside it. Neither is claimed as met here — the statement has to name what
        has actually been checked and what has not, and nobody has done that audit yet.
      </p>
      <p style={{ margin: 0 }}>
        It will also say, in plain words rather than in success-criterion numbers, which parts of
        the site are known to fall short and what is being done about them.
      </p>
      <p style={{ margin: 0 }}>
        The third part, and the one this page is missing most, is somewhere to report a barrier. No
        address has been decided yet — <Link href="/contact">Contact</Link> says the same — and one
        invented here would be one nobody is reading. It goes on this page the day it exists.
      </p>
    </UnwrittenPage>
  );
}
