import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'About',
  robots: { index: false, follow: false },
};

export default function About() {
  return (
    <UnwrittenPage title="About Foundit">
      <p style={{ margin: 0 }}>
        It will say what Foundit is for, who is building it, and how a tool gets into the
        catalogue. Until somebody writes that down, there is nothing here worth reading.
      </p>
      <p style={{ margin: 0 }}>
        What the product already does is on the homepage: describe a problem in your own words and
        get the tools that fit, with no account and no paid placement.
      </p>
    </UnwrittenPage>
  );
}
