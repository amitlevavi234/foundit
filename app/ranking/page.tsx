import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'How the fit score works',
  robots: { index: false, follow: false },
};

/**
 * The highest-value trust page on the site
 * (`research/13-required-pages-and-notices.md` §3.8), and the one page a site
 * that ranks other people's products owes its users. It is linked from the
 * results page as well as the footer, because the footer is not where somebody
 * looking at a ranked list will look for it.
 *
 * The calibration the research sets, from the European Commission's
 * ranking-transparency guidelines: name the main parameters and why each weighs
 * as it does, without publishing enough of the mechanism for anybody to game
 * it. That text has to be written against the scoring that actually ships, and
 * the fit score is a later phase — so this page describes its own contents and
 * claims nothing about numbers that do not exist yet.
 */
export default function Ranking() {
  return (
    <UnwrittenPage title="How the fit score works">
      <p style={{ margin: 0 }}>
        It will say what the fit score is, which parameters feed it, and why each one weighs as much
        as it does — enough to judge a result by, and not so much that a listing could be written to
        game it. It will say where listings come from and that they publish before anyone reviews
        them, and how reviews are collected, moderated and added up, including that unfavourable
        ones stay up.
      </p>
      <p style={{ margin: 0 }}>
        It will carry one sentence that is worth more than the rest: nothing about a tool’s
        relationship with Foundit moves it up the page. No tool can pay to rank higher, and no
        maker can influence their own score. That is the commitment the page exists to make legible
        — and it has to stay true, which is why <Link href="/pricing">Pricing</Link> says the same
        thing about the paid accounts that come later.
      </p>
      <p style={{ margin: 0 }}>
        It will end with the honest part: what the score cannot tell you, how much of the field is
        missing, that no tool here has been tested by us, and how a maker gets a listing about their
        own product corrected. None of that can be written yet — the ordering on the results page
        today is words and meaning together, which the results page says out loud on every search,
        and the fit score itself is not built.
      </p>
    </UnwrittenPage>
  );
}
