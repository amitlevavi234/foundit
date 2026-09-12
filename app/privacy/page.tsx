import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Privacy',
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
 * The one page in the footer that is not merely missing but overdue.
 *
 * A privacy notice is a legal requirement, not a nice-to-have, and it has to
 * be written by the people who decide what Foundit does with data — not
 * drafted here from what the code happens to do today. So this page says it is
 * missing, in the plainest words available, and says what that blocks. It
 * makes no statement about what is collected, kept or shared: a wrong one
 * would be worse than none, because it is the kind of wrong nobody checks.
 */
export default function Privacy() {
  return (
    <UnwrittenPage title="Privacy">
      <p style={{ margin: 0 }}>
        A privacy notice has to be written by the people responsible for Foundit, and it has not
        been. Nothing is claimed here about what is collected, how long it is kept, or who else
        sees it, because a notice guessed at from the outside is worse than an admission that
        there isn’t one — it stops anybody noticing that there isn’t one.
      </p>
      <p style={{ margin: 0 }}>
        Foundit is not open to the public yet. This page has to exist properly before it is.
      </p>
    </UnwrittenPage>
  );
}
