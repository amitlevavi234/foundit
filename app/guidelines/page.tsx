import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Guidelines',
  robots: { index: false, follow: false },
};

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
