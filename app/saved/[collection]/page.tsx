import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { SavedView } from '@/components/SavedView';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentUserId, getSaved } from '@/lib/accounts';
import { baseUrl } from '@/lib/auth';

/* ===========================================================================
 * One of your collections.
 *
 * The same screen as /saved with a different one open, because it is the same
 * statement with a different argument. A slug that is not yours comes back
 * with no chosen collection — the policy saw to that — and this answers 404
 * rather than "not yours", which would confirm that it exists.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Saved',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface CollectionProps {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ shared?: string | string[] }>;
}

export default async function OneCollection({ params, searchParams }: CollectionProps) {
  const { collection } = await params;
  if (!(await currentUserId())) {
    redirect(`/sign-in?next=${encodeURIComponent(`/saved/${collection}`)}&intent=save`);
  }

  const data = await getSaved(collection);
  if (!data.chosen) notFound();

  const query = await searchParams;

  return (
    <div className="page">
      <SiteHeader active="saved" />
      <BackLink href="/saved">Saved</BackLink>

      <main id="main" className="shell" style={{ padding: '18px 56px 80px', flex: 1 }}>
        <SavedView data={data} origin={baseUrl()} justShared={Boolean(query.shared)} />
      </main>

      <SiteFooter />
    </div>
  );
}
