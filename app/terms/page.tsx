import type { Metadata } from 'next';

import { UnwrittenPage } from '@/components/UnwrittenPage';

export const metadata: Metadata = {
  title: 'Terms of use',
  robots: { index: false, follow: false },
};

/**
 * Terms are one of the two pages Google's sign-in review asks for by name
 * (`research/13-required-pages-and-notices.md` §3.7), and the only place the
 * liability for a third-party tool Foundit points at can be disclaimed. They
 * have to be written by the people responsible for Foundit; nothing is stated
 * here as though it were already in force.
 */
export default function Terms() {
  return (
    <UnwrittenPage title="Terms of use">
      <p style={{ margin: 0 }}>
        They will set out what you agree to by using Foundit, and what Foundit does and does not
        stand behind. The part that matters most: every tool listed here belongs to somebody else.
        Foundit describes them and links to them; it does not run them, has not audited them, and
        the terms will say where its responsibility for them ends.
      </p>
      <p style={{ margin: 0 }}>
        They will also carry the acceptable-use rules — scraping the catalogue, submitting listings
        automatically, and posting links that carry malware or phishing — and what happens to an
        account that breaks them.
      </p>
      <p style={{ margin: 0 }}>
        None of that is in force yet, because none of it is written. Nothing on this page is a term,
        and no term should be read into its absence.
      </p>
    </UnwrittenPage>
  );
}
