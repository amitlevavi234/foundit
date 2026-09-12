import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { SavedView } from '@/components/SavedView';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentUserId, getSaved } from '@/lib/accounts';
import { baseUrl } from '@/lib/auth';

/* ===========================================================================
 * Saved — Saved.dc.html, and SavedEmpty.dc.html when there is nothing here.
 *
 * Signed out, this is not a screen with an empty state: it is a screen that
 * does not apply, so it sends people to sign in and brings them straight back.
 * The database would have returned nothing anyway — `collections_read` is
 * `owner_id = auth.uid()` — and an empty page for a stranger would be a page
 * that looks broken rather than one that says what to do.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Saved',
  description: 'The tools you kept, in your own collections, with your own notes.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface SavedProps {
  searchParams: Promise<{ shared?: string | string[] }>;
}

export default async function Saved({ searchParams }: SavedProps) {
  if (!(await currentUserId())) redirect('/sign-in?next=%2Fsaved&intent=save');
  const params = await searchParams;
  const data = await getSaved(null);

  return (
    <div className="page">
      <SiteHeader active="saved" />
      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{ padding: '18px 56px 80px', flex: 1 }}
      >
        <SavedView
          data={data}
          origin={baseUrl()}
          justShared={Boolean(params.shared)}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
