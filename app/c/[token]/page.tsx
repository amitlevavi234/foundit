import type { Metadata } from 'next';
import Link from 'next/link';

import { BackLink } from '@/components/BackLink';
import { Tag } from '@/components/Chip';
import { OutboundButton, OutboundDomain } from '@/components/OutboundLink';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ToolTile } from '@/components/ToolTile';
import { getSharedCollection } from '@/lib/accounts';

/* ===========================================================================
 * A shared collection — PublicCollection.dc.html.
 *
 * The address IS the permission. There is no owner check on this page and no
 * `is_public` flag behind it: the token out of the URL is set as a
 * transaction-local setting, `collections_read` compares it to the column, and
 * a wrong token returns no rows. Nothing here decides anything.
 *
 * IT IS `noindex`, WHICH IS PART OF THE PROMISE. A link somebody sent to one
 * person is not a page a search engine should be able to hand to everybody,
 * and a crawler that finds the token in a referrer or a shared browser history
 * would otherwise publish a list that was meant for one reader.
 *
 * A link that opens nothing — revoked, mistyped, from an account that has been
 * closed — gets one answer, in the product's voice, and no way to tell which
 * of the three it was.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'A shared collection',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface SharedProps {
  params: Promise<{ token: string }>;
}

export default async function SharedCollectionPage({ params }: SharedProps) {
  const { token } = await params;
  const data = await getSharedCollection(token);

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{
          padding: '18px 56px 80px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 26,
          maxWidth: 1100,
        }}
      >
        {data ? (
          <>
            <div>
              <p
                className="muted"
                style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}
              >
                <span className="avatar" aria-hidden="true">
                  {(data.ownerName ?? data.ownerHandle ?? '?').slice(0, 1).toUpperCase()}
                </span>
                A collection by{' '}
                {data.ownerHandle ? (
                  <Link href={`/u/${data.ownerHandle}`}>
                    <strong style={{ fontWeight: 'var(--fw-semibold)' }}>
                      @{data.ownerHandle}
                    </strong>
                  </Link>
                ) : (
                  <strong style={{ fontWeight: 'var(--fw-semibold)' }}>a closed account</strong>
                )}
              </p>
              <h1 className="disp" style={{ fontSize: 54, margin: '0 0 8px' }}>
                {data.name}
              </h1>
              <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-lg)' }}>
                {data.description ? `${data.description} · ` : ''}
                {data.items.length} {data.items.length === 1 ? 'tool' : 'tools'} · read-only
              </p>
            </div>

            <div className="savedcards">
              {data.items.map((item) => (
                <article key={item.slug} className="card hov" style={{ padding: 22, gap: 14 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <ToolTile name={item.name} slug={item.slug} size={46} />
                    <Link href={`/tools/${item.slug}`} className="toolcard-name">
                      {item.name}
                    </Link>
                  </div>

                  <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
                    {item.summary}
                  </p>

                  <div className="toolcard-chips">
                    <Tag>{item.pricing.replace(/_/g, ' ')}</Tag>
                    {item.rating ? <Tag>{item.rating.toFixed(1)} out of 5</Tag> : null}
                  </div>

                  {item.note ? (
                    <p className="savednote" style={{ margin: 0 }}>
                      {item.note}
                    </p>
                  ) : null}

                  <div className="toolcard-foot">
                    <span />
                    <div className="toolcard-out">
                      <OutboundButton url={item.url} slug={item.slug} size="sm">
                        Open
                      </OutboundButton>
                      <OutboundDomain url={item.url} />
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div
              className="slab"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 24,
                padding: '22px 28px',
                boxShadow: '6px 6px 0 var(--c-lime)',
              }}
            >
              <div>
                <div className="disp" style={{ fontSize: 24, fontWeight: 'var(--fw-display)' }}>
                  Keep your own list.
                </div>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  Save any of these to your own collections, with your own notes.
                </p>
              </div>
              <Link href="/sign-in?intent=save" className="btn btn-coral">
                Sign in
              </Link>
            </div>
          </>
        ) : (
          <div className="panel" style={{ padding: 32, maxWidth: 720 }}>
            <h1 className="disp" style={{ fontSize: 34, margin: '0 0 12px' }}>
              This link does not open anything.
            </h1>
            <p className="muted" style={{ margin: '0 0 8px', lineHeight: 1.6 }}>
              A shared collection is readable only by whoever holds its link, and a link stops
              working the moment the person who made it turns sharing off or closes their account.
              That is the whole of the mechanism, so there is nothing here to try again.
            </p>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              If somebody sent you this, ask them for a fresh link. Or{' '}
              <Link href="/browse">browse the problems people solve here</Link>.
            </p>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
