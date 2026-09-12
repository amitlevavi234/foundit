import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Guidelines',
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

export default function Guidelines() {
  return (
    <UnwrittenPage title="Guidelines">
      <p style={{ margin: 0 }}>
        It will say what may be added to the catalogue, how a listing should be written, and what
        is expected of a review.
      </p>
      <p style={{ margin: 0 }}>
        Nothing can be added or reviewed on Foundit yet — both arrive with accounts — so there is
        as yet nothing for these rules to govern. They need to exist before that changes.
      </p>
    </UnwrittenPage>
  );
}
