import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Cookies',
  robots: { index: false, follow: false },
};

/**
 * The research is unusually specific about this one
 * (`research/13-required-pages-and-notices.md` §1.5 and §4.3): Foundit carries
 * no advertising, no analytics and no third-party trackers, so the cookies in
 * play are the strictly-necessary kind and there is nothing to ask consent for.
 * A banner that asks for consent it will ignore on refusal is a false statement
 * about the site, so none is built. What is still missing is the list itself,
 * which cannot be finished before sign-in exists and puts a session cookie on
 * the page.
 */
export default function Cookies() {
  return (
    <UnwrittenPage title="Cookies">
      <p style={{ margin: 0 }}>
        It will list every cookie the site sets, say what each one is for, and say how long it
        lasts — in that order, and in plain words rather than in vendor names.
      </p>
      <p style={{ margin: 0 }}>
        The list is expected to be short. Foundit runs no advertising, no analytics product and no
        third-party trackers, so the cookies it expects to need are the ones that keep a signed-in
        session and keep the site standing up — the kind that are necessary for the site to work at
        all. On that basis there is nothing here to consent to, and no banner will be built to ask.
        This page is where that is explained once the list is final.
      </p>
      <p style={{ margin: 0 }}>
        Until it is written, nothing here is a statement about what the site currently sets.
      </p>
    </UnwrittenPage>
  );
}
