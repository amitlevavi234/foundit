import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/Icon';
import { OutboundDomain } from '@/components/OutboundLink';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Stars } from '@/components/Stars';
import { ToolTile } from '@/components/ToolTile';
import { makerDashboard } from '@/lib/maker';

/* ===========================================================================
 * MakerDashboard.dc.html — one listing, and who found it.
 *
 * THE PANEL THIS SCREEN IS FOR, and the rule that shapes it: "what people
 * searched to find you" shows the WORDS of a sentence only when at least five
 * separate searches have typed it. Below that a maker sees the count and the
 * rank and no text.
 *
 * That threshold is not in this file. It is `public.maker_query_threshold()`
 * and the CASE inside `public.maker_search_demand` (0017 §8), so there is no
 * argument this page could pass to see a sentence one person typed once, and
 * no future edit to this component that could reveal one. The row arrives with
 * `queryText: null` and `shown: false`, and the page draws what it was given.
 *
 * WHY IT MATTERS THAT MUCH. "Describe your problem" is where people type the
 * thing they have not told anyone — 0001's comment on `search_events` says it
 * plainly, and that table has no user column for the same reason. A sentence
 * shown to a maker is a sentence shown to a stranger, and the only defence
 * against recognising yourself in it is that several people typed the same
 * words.
 *
 * FIVE IS SMALL, AND IT IS NOT FIVE PEOPLE. The per-IP search limiter allows
 * sixty searches an hour, so one determined person can type the same sentence
 * five times and see it here. That is written down in
 * docs/loop-progress.md as a known weakness rather than described as five
 * people, because it is five EVENTS.
 *
 * "OPENED FROM FOUNDIT" IS ZERO ON EVERY LISTING, and the number is real
 * rather than invented: `tools.open_count` has no writer anywhere in this
 * codebase. docs/product-decisions.md §12 says the click is counted and it is
 * not. The card says so rather than showing a plausible figure.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Your listing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function when(value: Date | null): string {
  return value ? DATE.format(value) : '—';
}

function Metric({
  n,
  label,
  sub,
}: {
  n: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="metric">
      <span className="metric-n">{n}</span>
      <span className="metric-label">{label}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

export default async function MakerListingDashboard({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const saved = query.saved === '1';

  // One answer for "not yours", "not there" and "not signed in".
  const data = await makerDashboard(slug);
  if (!data) notFound();

  const { listing, demand, reviews, statements, addedBy, ownershipChanges } = data;
  const busiest = demand.reduce((most, row) => Math.max(most, row.searches), 0) || 1;

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="shell makerpage">
        <p className="crumbs">
          <Link href="/maker">Your listings</Link>
          <Icon name="chevronR" size={14} />
          <span>{listing.name}</span>
        </p>

        {saved ? (
          <p className="pillstat pillstat-live" role="status" style={{ marginTop: 16 }}>
            <Icon name="check" size={16} />
            Saved. It is live now.
          </p>
        ) : null}

        {/* --- who this is ------------------------------------------------- */}
        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            margin: '18px 0 0',
          }}
        >
          <div style={{ display: 'flex', gap: 18, minWidth: 0 }}>
            <ToolTile name={listing.name} slug={listing.slug} size={72} />
            <div style={{ minWidth: 0 }}>
              <h1 className="h2" style={{ margin: 0, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {listing.name}
                <span className="pillstat pillstat-mine">
                  <Icon name="shield" size={16} />
                  You maintain this
                </span>
              </h1>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 'var(--t-meta)' }}>
                {listing.status === 'published'
                  ? `Live since ${when(listing.publishedAt)}`
                  : 'Not published yet'}
                {addedBy ? ` · Added by @${addedBy}` : ''}
                {' · '}
                <OutboundDomain url={listing.url} />
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="btn btn-sm" href={`/tools/${listing.slug}`}>
              View public page
            </Link>
            <Link className="btn btn-sm btn-coral" href={`/maker/${listing.slug}/edit`}>
              <Icon name="edit" size={16} />
              Edit listing
            </Link>
          </div>
        </div>

        {/* --- the four numbers -------------------------------------------- */}
        <div className="metricgrid">
          <Metric
            n={String(listing.matchedCount)}
            label="Searches matched"
            sub="Last 30 days"
          />
          <Metric
            n={String(listing.openCount)}
            label="Opened from Foundit"
            sub={
              listing.openCount === 0
                ? 'Not counted yet — the click is not recorded'
                : 'Clicks through to your address'
            }
          />
          <Metric n={String(listing.saveCount)} label="Saved" sub="Into people’s collections" />
          <Metric
            n={listing.ratingAvg === null ? '—' : listing.ratingAvg.toFixed(1)}
            label="Rating"
            sub={
              listing.ratingCount === 0
                ? 'No ratings yet'
                : `From ${listing.ratingCount} rating${listing.ratingCount === 1 ? '' : 's'}`
            }
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)',
            gap: 40,
            alignItems: 'start',
          }}
          className="makergrid"
        >
          {/* --- what people searched ------------------------------------- */}
          <section className="panel" style={{ padding: 24 }}>
            <div className="section-head">
              <h2 className="h3" style={{ margin: 0 }}>
                What people searched to find you
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: 'var(--t-micro)' }}>
                Last 30 days
              </p>
            </div>

            {demand.length === 0 ? (
              <p className="muted" style={{ margin: '16px 0 0', lineHeight: 'var(--lh-body)' }}>
                No searches have returned this listing yet. Text search finds it by name and by
                words straight away; the meaning half needs the problem statements to have been
                read, which happens within a minute of publishing or editing one.
              </p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {demand.map((row, index) => (
                  <div className="demandrow" key={`${row.queryText ?? 'withheld'}-${index}`}>
                    <p className={row.shown ? 'demandrow-q' : 'demandrow-q withheld'} style={{ margin: 0 }}>
                      {row.shown && row.queryText ? (
                        `“${row.queryText}”`
                      ) : (
                        <>
                          A sentence we are not showing you
                          <span className="muted"> — fewer than five searches typed it</span>
                        </>
                      )}
                    </p>
                    <p className="demandrow-n" style={{ margin: 0 }}>
                      {row.searches} search{row.searches === 1 ? '' : 'es'}
                      {row.bestRank ? ` · best #${row.bestRank}` : ''}
                    </p>
                    <span
                      className={row.bestRank !== null && row.bestRank <= 3 ? 'demandrow-bar' : 'demandrow-bar weak'}
                      aria-hidden="true"
                    >
                      <span style={{ width: `${Math.round((row.searches / busiest) * 100)}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="muted" style={{ marginTop: 22, fontSize: 'var(--t-micro)', lineHeight: 'var(--lh-body)' }}>
              <strong>Why some sentences are hidden.</strong> A search sentence reaches you only
              once five separate searches have typed the same thing. Below that you get the count
              and where you came, and not the words: “describe your problem” is where people type
              what they have not told anybody, and one person’s sentence is not demand.{' '}
              <Link href="/privacy">What we keep</Link>.
            </p>
          </section>

          <div style={{ display: 'grid', gap: 22 }}>
            {/* --- make it findable in more places ----------------------- */}
            <section className="slab slab-lime" style={{ padding: 22 }}>
              <h2 className="h3" style={{ margin: '0 0 14px' }}>
                Make it findable in more places
              </h2>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
                <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--c-violet)', flexShrink: 0 }}>
                    <Icon name={statements.length > 0 ? 'check' : 'plus'} size={18} />
                  </span>
                  <span style={{ lineHeight: 'var(--lh-body)' }}>
                    {statements.length === 0
                      ? 'No problem statements yet — this is what search matches against'
                      : `${statements.length} problem statement${statements.length === 1 ? '' : 's'} written`}
                  </span>
                </li>
                {statements.length < 4 ? (
                  <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--c-coral)', flexShrink: 0 }}>
                      <Icon name="plus" size={18} />
                    </span>
                    <span style={{ lineHeight: 'var(--lh-body)' }}>
                      <Link href={`/maker/${listing.slug}/edit`}>Add another statement</Link> — each
                      one is a different way somebody can describe the same need
                    </span>
                  </li>
                ) : null}
              </ul>
              <p className="muted" style={{ margin: '16px 0 0', fontSize: 'var(--t-micro)' }}>
                Editing a statement re-reads only that one. The others keep what they have.
              </p>
            </section>

            {/* --- latest reviews ---------------------------------------- */}
            <section className="panel" style={{ padding: 22 }}>
              <h2 className="h3" style={{ margin: '0 0 14px' }}>
                Latest reviews
              </h2>
              {reviews.length === 0 ? (
                <p className="muted" style={{ margin: 0, lineHeight: 'var(--lh-body)' }}>
                  Nobody has written one yet.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 18 }}>
                  {reviews.map((review, index) => (
                    <div key={`${review.handle}-${index}`}>
                      <p style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
                        <Link href={`/u/${review.handle}`}>@{review.handle}</Link>
                        <Stars rating={review.rating} size={14} />
                      </p>
                      {review.body ? (
                        <p style={{ margin: '6px 0 0', fontSize: 'var(--t-body-sm)', lineHeight: 'var(--lh-body)' }}>
                          {review.body}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              <p className="muted" style={{ margin: '16px 0 0', fontSize: 'var(--t-micro)', lineHeight: 'var(--lh-body)' }}>
                Ratings and reviews belong to the people who wrote them. You cannot edit or remove
                one, however unfair it is — <Link href="/report">report it</Link> like anyone else
                and an admin looks.
              </p>
            </section>

            {/* --- this listing changed hands ---------------------------- */}
            {ownershipChanges.length > 0 ? (
              <section className="slab slab-coral" style={{ padding: 22 }}>
                <h2 className="h3" style={{ margin: '0 0 12px' }}>
                  This listing changed hands
                </h2>
                {ownershipChanges.map((change, index) => (
                  <p key={index} style={{ margin: index === 0 ? 0 : '12px 0 0', lineHeight: 'var(--lh-body)' }}>
                    {when(change.at)} — {change.reason}
                  </p>
                ))}
                <p className="muted" style={{ margin: '14px 0 0', fontSize: 'var(--t-micro)' }}>
                  An admin can only do this through a door that records who, from whom, to whom and
                  why, and the person it was taken from can read the record. Nobody else can move a
                  listing at all.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
