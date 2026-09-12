import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Contact',
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

export default function Contact() {
  return (
    <UnwrittenPage title="Contact">
      <p style={{ margin: 0 }}>
        Nobody has decided yet how Foundit should be reached, so no address is printed here. An
        address invented on this page would be one nobody is reading.
      </p>
      <p style={{ margin: 0 }}>
        One channel does already exist and works: “Report this listing”, at the foot of any tool’s
        page, opens an email about that listing to the team.
      </p>
    </UnwrittenPage>
  );
}
