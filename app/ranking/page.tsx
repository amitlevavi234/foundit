import type { Metadata } from 'next';

import Link from 'next/link';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'How the fit score works',
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
        own product corrected.
      </p>
      {/* The placeholder sentence that used to close this page said the fit
          score "is not built". It is now built, and it is bands rather than a
          percentage — which is a decision somebody reading a ranked list is
          entitled to have explained, so this paragraph is written even though
          the rest of the page is not. It is the one thing on /ranking that
          describes what ships today. */}
      <p style={{ margin: 0 }}>
        <strong>What the bands mean, and what a percentage would take.</strong> Each result carries
        one of three words — <strong>Strong</strong>, <strong>Possible</strong> or{' '}
        <strong>Loose</strong> — and they come from a model that was shown your sentence and that
        listing’s own description and problem statements, and nothing else: not its price, not its
        rating, not how many people liked it, not where the search had put it. Strong means the tool
        is for the thing you described; Possible means it does the job, perhaps as one part of
        something larger; Loose means it is in the right area rather than an answer. Anything it
        reads as not for you is not shown at all, which is why a page here can be short, or empty.
        Where that reading could not run — no answer from the model in time, or the day’s spending
        limit reached — the band instead names <em>where</em> your words turned up in a listing, and
        the line above the results says which of the two you are looking at. A band is a judgement
        about fit; a location is not, and they are deliberately worded so you can tell them apart.
      </p>
      <p style={{ margin: 0 }}>
        There is no percentage, and that is not modesty. A calibrated number means something precise
        — of the results shown at 80%, about eighty in a hundred are what the person was actually
        looking for — and it can only be fitted against examples that people have judged: a
        sentence, a tool, and a human answer to “is this what they wanted”. We have no such
        examples. The evaluation set this search is measured on was graded by a model, and it is the
        test; fitting a score on it and then reporting a score against it would be reporting a
        number about itself. So the bands stay until at least two hundred pairs have been judged by
        people, with a record of who judged each one and when. The code that would fit the curve
        exists and is tested (<code>eval/calibrate.mjs</code>); it is the judgements that do not. A
        rescaled similarity printed as “92% fit” would be available today, and it would be a lie
        told in a font that looks like measurement.
      </p>
    </UnwrittenPage>
  );
}
