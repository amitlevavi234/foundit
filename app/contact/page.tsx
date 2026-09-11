import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Contact',
  robots: { index: false, follow: false },
};

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
