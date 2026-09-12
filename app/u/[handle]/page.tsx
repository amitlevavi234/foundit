import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Stars } from '@/components/Stars';
import { ToolTile } from '@/components/ToolTile';
import { getPublicProfile } from '@/lib/accounts';

/* ===========================================================================
 * A public profile — ProfilePublic.dc.html.
 *
 * WHAT IS ON IT IS WHAT `profiles_public` CARRIES, and no more: the handle,
 * the display name, the avatar's letter, the bio and the join date. Not
 * `is_admin`, which is an attack map, and not `plan`, which is a commercial
 * fact about a person. 0003_hardening.sql made the profiles TABLE readable
 * only by its owner and by administrators for exactly this reason, and this
 * page reads the view.
 *
 * Beside that: what this person did in public. Listings they added, and
 * reviews they wrote.
 *
 * THREE THINGS ARE DELIBERATELY ABSENT.
 *
 *   Their likes. 0003 made who-liked-what private, because this catalogue
 *   lists tools for leaving an abusive partner, hiding money and managing an
 *   illness, and a per-person like list is that harm arriving already attached
 *   to a name.
 *
 *   Their collections. The artboard counts "3 public collections", but a
 *   shared collection's address IS its permission (0013), so listing them here
 *   would turn "anybody with the link" into "anybody".
 *
 *   Anything they searched for. There is no join that could produce it and
 *   there never will be: `search_events` has no user column.
 * ======================================================================== */

export const dynamic = 'force-dynamic';

interface ProfileProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: ProfileProps): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `@${handle}`,
    description: `Tools and reviews by @${handle} on Foundit.`,
  };
}

export default async function PublicProfilePage({ params }: ProfileProps) {
  const { handle } = await params;
  const profile = await getPublicProfile(handle);
  if (!profile) notFound();

  const name = profile.displayName?.trim() || `@${profile.handle}`;
  const joined = new Date(profile.createdAt).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/browse">Browse problems</BackLink>

      <div
        style={{
          borderTop: 'var(--border)',
          borderBottom: 'var(--border)',
          background: 'var(--c-tint)',
          marginTop: 8,
        }}
      >
        <div
          className="shell"
          style={{ padding: '44px 56px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}
        >
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <span className="avatar" style={{ width: 96, height: 96, fontSize: 40 }} aria-hidden="true">
              {name.replace('@', '').slice(0, 1).toUpperCase()}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <h1 className="disp" style={{ fontSize: 42, margin: 0 }}>
                {name}
              </h1>
              <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-sm)' }}>
                @{profile.handle} · joined {joined}
              </p>
              {profile.bio ? (
                <p style={{ margin: 0, maxWidth: 560, lineHeight: 1.5 }}>{profile.bio}</p>
              ) : null}
            </div>
          </div>

          <div
            className="tab muted"
            style={{ display: 'flex', gap: 40, fontSize: 'var(--t-body-sm)' }}
          >
            <div>
              <strong
                className="disp"
                style={{ fontSize: 26, color: 'var(--c-ink)', fontWeight: 'var(--fw-display)' }}
              >
                {profile.listingCount}
              </strong>{' '}
              {profile.listingCount === 1 ? 'tool added' : 'tools added'}
            </div>
            <div>
              <strong
                className="disp"
                style={{ fontSize: 26, color: 'var(--c-ink)', fontWeight: 'var(--fw-display)' }}
              >
                {profile.reviewCount}
              </strong>{' '}
              {profile.reviewCount === 1 ? 'review' : 'reviews'}
            </div>
          </div>
        </div>
      </div>

      <main
        id="main"
        className="shell"
        style={{ padding: '28px 56px 80px', flex: 1, display: 'flex', flexDirection: 'column', gap: 32 }}
      >
        <section>
          <h2 className="h2" style={{ marginBottom: 14 }}>
            Tools they added
          </h2>
          {profile.listings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None yet.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 24,
              }}
            >
              {profile.listings.map((tool) => (
                <Link
                  key={tool.slug}
                  href={`/tools/${tool.slug}`}
                  className="card hov"
                  style={{
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    color: 'var(--c-ink)',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ToolTile name={tool.name} slug={tool.slug} size={44} />
                    <span className="disp" style={{ fontSize: 21, fontWeight: 'var(--fw-heading)' }}>
                      {tool.name}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 'var(--t-body-sm)', lineHeight: 1.5 }}>
                    {tool.summary}
                  </span>
                  <span
                    className="muted"
                    style={{
                      fontSize: 'var(--t-meta-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 'auto',
                    }}
                  >
                    <Icon name="heart" size={14} color="var(--c-coral)" strokeWidth={2.25} />
                    {tool.likeCount}
                    {tool.maintained ? ' · maintained by them' : null}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="h2" style={{ marginBottom: 14 }}>
            Reviews they wrote
          </h2>
          {profile.reviews.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {profile.reviews.map((review) => (
                <article
                  key={`${review.toolSlug}-${review.createdAt}`}
                  className="panel"
                  style={{ padding: 20 }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}
                  >
                    <Stars rating={review.rating} />
                    <Link href={`/tools/${review.toolSlug}`} style={{ fontWeight: 'var(--fw-semibold)' }}>
                      {review.toolName}
                    </Link>
                  </div>
                  {review.body ? (
                    <p style={{ margin: 0, lineHeight: 1.55 }}>{review.body}</p>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      A rating with no words.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
