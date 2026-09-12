import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ToolTile } from '@/components/ToolTile';
import { currentUserId } from '@/lib/accounts';
import { myListings } from '@/lib/maker';

/* ===========================================================================
 * Your listings — the way in to MakerDashboard.dc.html.
 *
 * The artboard is one listing's dashboard; this is the index in front of it,
 * because a person can maintain several and the artboard has no answer for
 * which one. It is deliberately thin: a row per listing, the numbers that fit
 * on a row, and a link.
 *
 * DRAFTS APPEAR HERE, and this is the only screen in the product where one
 * does. `tools_read` lets the person who added a draft see their own
 * (0001), everything else about it is invisible to everybody —
 * db/test/adding_a_tool_test.sql §1 proves that across all eight retrieval
 * paths — and a submit flow somebody abandoned halfway has to be findable
 * again or it is a row nobody can reach and nobody can delete.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Your listings',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function MakerIndex() {
  const me = await currentUserId();
  const listings = me ? await myListings() : [];

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="shell makerpage">
        <div className="page-head">
          <h1 className="h2" style={{ margin: 0 }}>
            Your listings
          </h1>
          <p className="muted" style={{ margin: '10px 0 0', lineHeight: 'var(--lh-body)' }}>
            Everything you maintain. Whoever adds a tool maintains it, and nobody can take one
            over.
          </p>
        </div>

        {!me ? (
          <div className="panel" style={{ padding: 22, marginTop: 26 }}>
            <p style={{ margin: '0 0 14px', lineHeight: 'var(--lh-body)' }}>
              Sign in to see the tools you maintain.
            </p>
            <Link className="btn btn-coral" href="/sign-in?next=%2Fmaker">
              Sign in
            </Link>
          </div>
        ) : listings.length === 0 ? (
          <div className="empty" style={{ marginTop: 26 }}>
            <p className="empty-title">You don’t maintain anything yet.</p>
            <p className="empty-body">
              Add a tool you made, or claim one of the listings we added at launch.
            </p>
            <p className="empty-actions">
              <Link className="btn btn-coral" href="/submit">
                Add a tool
              </Link>
              <Link className="btn" href="/browse">
                Browse the catalogue
              </Link>
            </p>
          </div>
        ) : (
          <ul style={{ margin: '26px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 16 }}>
            {listings.map((listing) => {
              const draft = listing.status !== 'published';
              return (
                <li key={listing.id} className="card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 14, minWidth: 0 }}>
                      <ToolTile name={listing.name} slug={listing.slug} size={48} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 'var(--t-h3)' }}>{listing.name}</strong>
                          {draft ? (
                            <span className="pillstat pillstat-attention">Draft</span>
                          ) : (
                            <span className="pillstat pillstat-live">Live</span>
                          )}
                        </p>
                        <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--t-body-sm)' }}>
                          {listing.summary}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {draft ? (
                        <Link className="btn btn-sm btn-coral" href={`/submit/preview?draft=${listing.id}`}>
                          Finish it
                          <Icon name="arrow" size={16} />
                        </Link>
                      ) : (
                        <>
                          <Link className="btn btn-sm" href={`/maker/${listing.slug}`}>
                            Dashboard
                          </Link>
                          <Link className="btn btn-sm btn-violet" href={`/maker/${listing.slug}/edit`}>
                            <Icon name="edit" size={16} />
                            Edit
                          </Link>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="muted" style={{ margin: '16px 0 0', fontSize: 'var(--t-micro)' }}>
                    {draft
                      ? `${count(listing.statementCount, 'problem statement', 'problem statements')} written. Nobody can see this listing but you.`
                      : [
                          count(listing.matchedCount, 'search matched', 'searches matched'),
                          count(listing.openCount, 'open', 'opens'),
                          count(listing.saveCount, 'save', 'saves'),
                          count(listing.likeCount, 'like', 'likes'),
                          count(listing.reviewCount, 'review', 'reviews'),
                        ].join(' · ')}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
