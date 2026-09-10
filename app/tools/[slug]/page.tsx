import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';

import { Button } from '@/components/Button';
import { SatisfactionChip, Tag } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { OutboundButton, OutboundDomain } from '@/components/OutboundLink';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Stars } from '@/components/Stars';
import { ToolTile } from '@/components/ToolTile';
import {
  flagLabel,
  languageName,
  platformLabel,
  pricingLabel,
} from '@/lib/constraints';
import { getToolPage } from '@/lib/db';
import type { ToolFlag, ToolPageData } from '@/lib/types';

/* ===========================================================================
 * One tool — ToolDetail.dc.html.
 *
 * Everything the catalogue holds about a listing, and the link out to the
 * maker, which is the entire point of a recommendation
 * (docs/product-decisions.md §12): a new tab, `rel="noopener noreferrer"`, and
 * the domain printed beside it so a person can see where they are going before
 * they go. `OutboundButton` is the only thing in this codebase that renders
 * that anchor, and our server never asks that address for anything — no
 * favicon, no preview, no metadata read.
 *
 * The page is one round trip. The listing, its categories, its problem
 * statements, its reviews and their bylines, the rating histogram, the
 * per-aspect averages and three alternatives all arrive in a single row from
 * `TOOL_SQL`; `cache` below means the metadata and the page share it rather
 * than asking twice.
 * ======================================================================== */

export const dynamic = 'force-dynamic';

const load = cache(async (slug: string) => getToolPage(slug));

interface ToolProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ToolProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = await load(slug);
  if (!tool) return { title: 'Not found' };
  return { title: tool.name, description: tool.summary };
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}

/** The five things the catalogue tracks about every tool (§8). */
const TRACKED_FLAGS: ToolFlag[] = ['works_offline', 'no_account_needed', 'no_ads', 'exports_data'];

const GOOD_FOR: Partial<Record<ToolFlag, string>> = {
  works_offline: 'Using it with no connection',
  no_account_needed: 'Trying it without signing up for anything',
  no_ads: 'Working without advertising in the way',
  exports_data: 'Getting your own data back out again',
  e2e_encrypted: 'Anything you would rather nobody else could read',
  accessible: 'Screen readers and keyboard-only use',
  // has_free_tier is deliberately absent: the pricing line above these says
  // it already, and a panel that says the same thing twice reads as padding.
};

const NOT_CLAIMED: Partial<Record<ToolFlag, string>> = {
  works_offline: 'Offline use. Nothing here says it works without a connection',
  no_account_needed: 'Using it without an account',
  no_ads: 'Being free of advertising',
  exports_data: 'Exporting your data somewhere else',
};

export default async function ToolPage({ params }: ToolProps) {
  const { slug } = await params;
  const tool = await load(slug);
  if (!tool) notFound();

  const primary = tool.categories.find((c) => c.isPrimary) ?? tool.categories[0];
  const good = tool.flags.filter((flag) => GOOD_FOR[flag]);
  const missing = TRACKED_FLAGS.filter((flag) => !tool.flags.includes(flag));
  const reviewsShown = tool.reviews.length;

  return (
    <div className="page">
      <SiteHeader />

      <div className="shell crumbs" style={{ padding: '4px 56px 0' }}>
        <Link href="/browse">Browse problems</Link>
        <Icon name="chevronR" size={14} color="var(--c-faint)" />
        {primary ? (
          <>
            <Link href={{ pathname: '/browse', query: { in: primary.slug } }}>{primary.name}</Link>
            <Icon name="chevronR" size={14} color="var(--c-faint)" />
          </>
        ) : null}
        <span aria-current="page">{tool.name}</span>
      </div>

      <main id="main" className="shell toolpage" style={{ padding: '24px 56px 96px' }}>
        <div className="column">
          {/* --- who this is ------------------------------------------------ */}
          <section style={{ gap: 18 }}>
            <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
              <ToolTile name={tool.name} slug={tool.slug} size={84} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <h1 className="disp" style={{ fontSize: 'var(--t-tool)', margin: 0 }}>
                    {tool.name}
                  </h1>
                  {tool.claimable ? (
                    <span
                      className="pillstat pillstat-quiet"
                      title="We added this one at launch. Nobody from the tool looks after it yet."
                    >
                      Unclaimed
                    </span>
                  ) : (
                    <span className="pillstat pillstat-mine">
                      Maintained by {tool.keeperHandle ? `@${tool.keeperHandle}` : 'its maker'}
                    </span>
                  )}
                </div>
                <p className="muted" style={{ fontSize: 'var(--t-lead)', margin: 0 }}>
                  {tool.summary}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Tag>{pricingLabel(tool.pricing)}</Tag>
              {tool.platforms.length > 0 ? (
                <Tag>{tool.platforms.map(platformLabel).join(', ')}</Tag>
              ) : null}
              {tool.languages.length > 0 ? (
                <Tag>
                  {tool.languages.length === 1
                    ? `${languageName(tool.languages[0] ?? 'en')} only`
                    : `${tool.languages.length} languages`}
                </Tag>
              ) : null}
              {tool.flags.map((flag) => (
                <Tag key={flag}>{flagLabel(flag)}</Tag>
              ))}
            </div>

            <div
              className="tab"
              style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--t-body-sm)' }}
            >
              {tool.ratingAvg !== null ? (
                <>
                  <Stars
                    rating={tool.ratingAvg}
                    size={18}
                    label={`${tool.ratingAvg.toFixed(1)} out of 5`}
                  />
                  <strong style={{ fontWeight: 700, fontSize: 18 }}>
                    {tool.ratingAvg.toFixed(1)}
                  </strong>
                  <span className="muted">
                    {tool.ratingCount} {tool.ratingCount === 1 ? 'rating' : 'ratings'}
                  </span>
                </>
              ) : (
                <span className="muted">No ratings yet</span>
              )}
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="heart" size={16} color="var(--c-coral)" strokeWidth={2} />
                {tool.likeCount} found it useful
              </span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="bookmark" size={16} color="var(--c-violet)" strokeWidth={2} />
                {tool.saveCount} saved it
              </span>
            </div>
          </section>

          {/* --- what it is for --------------------------------------------- */}
          <section>
            <h2 className="h2" style={{ marginBottom: 10 }}>
              Solves these problems
            </h2>
            {tool.problems.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nobody has written down what this one is for yet.
              </p>
            ) : (
              tool.problems.map((statement) => (
                <Link
                  key={statement}
                  className="panel problem-row"
                  href={{ pathname: '/results', query: { q: statement } }}
                >
                  <span className="disp statement">{statement}</span>
                  <span
                    className="tab muted"
                    style={{
                      fontSize: 'var(--t-micro)',
                      whiteSpace: 'nowrap',
                      fontWeight: 'var(--fw-medium)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    See what else fits
                    <Icon name="arrow" size={14} color="var(--c-violet)" strokeWidth={2.25} />
                  </span>
                </Link>
              ))
            )}
          </section>

          <section
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 32 }}
          >
            <div className="panel panel-tint" style={{ padding: 24 }}>
              <h2 className="h3" style={{ marginBottom: 14 }}>
                Good for
              </h2>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <Point met>{`${pricingLabel(tool.pricing)}${
                  tool.pricing === 'paid' ? '' : ' — you can start without paying'
                }`}</Point>
                {good.map((flag) => (
                  <Point key={flag} met>
                    {GOOD_FOR[flag]}
                  </Point>
                ))}
                {primary ? <Point met>{`${primary.name}, mostly`}</Point> : null}
              </ul>
            </div>

            <div className="panel panel-quiet" style={{ padding: 24 }}>
              <h2 className="h3" style={{ marginBottom: 14 }}>
                Not claimed here
              </h2>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {missing.length === 0 ? (
                  <Point met={false}>Nothing. This listing claims all four.</Point>
                ) : (
                  missing.map((flag) => (
                    <Point key={flag} met={false}>
                      {NOT_CLAIMED[flag]}
                    </Point>
                  ))
                )}
              </ul>
              <p className="muted" style={{ fontSize: 'var(--t-meta-sm)', margin: '14px 0 0' }}>
                Not a promise that it can’t — only that the catalogue does not record it.
              </p>
            </div>
          </section>

          {/* --- how it is paid for ----------------------------------------- */}
          <section>
            <h2 className="h2">Pricing</h2>
            <div className="panel" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px minmax(0, 1fr)',
                  gap: 16,
                  padding: '12px 22px',
                  background: 'var(--c-sunk)',
                  fontSize: 'var(--t-micro-sm)',
                  fontWeight: 700,
                  color: 'var(--c-muted)',
                  borderBottom: 'var(--border)',
                }}
              >
                <span>How it is paid for</span>
                <span>What that means</span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px minmax(0, 1fr)',
                  gap: 16,
                  padding: '14px 22px',
                  fontSize: 'var(--t-body-sm)',
                }}
              >
                <strong style={{ fontWeight: 700 }}>{pricingLabel(tool.pricing)}</strong>
                <span className="muted">{PRICING_NOTE[tool.pricing]}</span>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 'var(--t-meta-sm)', margin: 0 }}>
              Plan-by-plan prices are the maker’s to publish, and this listing does not carry them.
              The link opens their own pricing page.
            </p>
          </section>

          {/* --- where it runs, and in what language ------------------------ */}
          <section>
            <h2 className="h2">Platforms and languages</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tool.platforms.length === 0 ? (
                <span className="muted">No platforms recorded.</span>
              ) : (
                tool.platforms.map((platform) => <Tag key={platform}>{platformLabel(platform)}</Tag>)
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tool.languages.length === 0 ? (
                <span className="muted">No interface languages recorded.</span>
              ) : (
                tool.languages.map((code) => (
                  <SatisfactionChip key={code} label={languageName(code)} met />
                ))
              )}
            </div>
          </section>

          {/* --- what people made of it ------------------------------------- */}
          <section>
            <h2 className="h2">Ratings</h2>
            {tool.ratingCount === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nobody has rated this yet. Ratings open with accounts.
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px minmax(0, 1fr) minmax(0, 1fr)',
                  gap: 40,
                  alignItems: 'start',
                }}
              >
                <div>
                  <div className="disp tab" style={{ fontSize: 72 }}>
                    {tool.ratingAvg?.toFixed(1)}
                  </div>
                  <Stars rating={tool.ratingAvg ?? 0} size={18} />
                  <div className="muted" style={{ fontSize: 'var(--t-meta-sm)', marginTop: 6 }}>
                    {tool.ratingCount} {tool.ratingCount === 1 ? 'rating' : 'ratings'}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[5, 4, 3, 2, 1].map((star) => {
                    const n = tool.histogram[String(star)] ?? 0;
                    const pct = tool.ratingCount > 0 ? Math.round((n / tool.ratingCount) * 100) : 0;
                    return (
                      <div className="barrow" key={star}>
                        <span className="tab muted" style={{ width: 14, fontWeight: 600 }}>
                          {star}
                        </span>
                        <div className="barrow-track">
                          <div className="barrow-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="tab muted" style={{ width: 34, textAlign: 'right' }}>
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="tab"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    fontSize: 'var(--t-body-sm)',
                  }}
                >
                  {/* A bare "100%" beside the word Ratings reads as
                      confidence, and here it is one person ticking one box.
                      The percentage is real, so it stays; what was missing is
                      its denominator, which is the only thing that says
                      whether it means anything. `solved_count` comes back on
                      the same row as the average (lib/sql.ts, `aspects`), so
                      showing it costs nothing. */}
                  <Aspect
                    label="Solved my problem"
                    value={
                      tool.aspects.solvedCount > 0 && tool.aspects.solvedPct !== null
                        ? `${tool.aspects.solvedPct}%`
                        : null
                    }
                    of={
                      tool.aspects.solvedCount > 0
                        ? `of ${tool.aspects.solvedCount} ${
                            tool.aspects.solvedCount === 1 ? 'review' : 'reviews'
                          }`
                        : null
                    }
                  />
                  <Aspect
                    label="Easy to start"
                    value={tool.aspects.ease !== null ? tool.aspects.ease.toFixed(1) : null}
                  />
                  <Aspect
                    label="Worth the price"
                    value={tool.aspects.worth !== null ? tool.aspects.worth.toFixed(1) : null}
                  />
                </div>
              </div>
            )}
          </section>

          <section>
            <h2 className="h2">Reviews</h2>
            {reviewsShown === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No reviews yet. Writing one needs an account, which arrives with sign-in.
              </p>
            ) : (
              <div>
                {tool.reviews.map((review) => {
                  const who = review.displayName ?? (review.handle ? `@${review.handle}` : 'Someone');
                  return (
                    <div className="review" key={review.id}>
                      <div className="review-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span
                            className="avatar"
                            aria-hidden="true"
                            style={{ width: 38, height: 38, fontSize: 16 }}
                          >
                            {who.replace('@', '').charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--t-body-sm)' }}>{who}</div>
                            <div className="faint" style={{ fontSize: 'var(--t-micro-sm)' }}>
                              {formatDate(review.createdAt)}
                            </div>
                          </div>
                        </div>
                        <Stars rating={review.rating} label={`${review.rating} out of 5`} />
                      </div>
                      {review.body ? (
                        <div style={{ lineHeight: 'var(--lh-prose)' }}>{review.body}</div>
                      ) : null}
                      {review.solvedProblem !== null || review.easeOfUse !== null ? (
                        <div className="muted" style={{ fontSize: 'var(--t-meta)' }}>
                          {review.solvedProblem === true ? 'Solved their problem' : null}
                          {review.solvedProblem === false ? 'Did not solve their problem' : null}
                          {review.easeOfUse !== null ? ` · Easy to start: ${review.easeOfUse}/5` : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {tool.reviewCount > reviewsShown ? (
                  <div className="muted" style={{ borderTop: 'var(--border-soft)', paddingTop: 16 }}>
                    Showing {reviewsShown} of {tool.reviewCount}.
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {tool.alternatives.length > 0 ? (
            <section>
              <h2 className="h2">Alternatives</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 24,
                }}
              >
                {tool.alternatives.map((alt) => (
                  <Link
                    key={alt.slug}
                    href={`/tools/${alt.slug}`}
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
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ToolTile name={alt.name} slug={alt.slug} size={40} />
                      <span className="disp" style={{ fontSize: 20, fontWeight: 700 }}>
                        {alt.name}
                      </span>
                    </span>
                    <span
                      className="muted"
                      style={{ fontSize: 14.5, lineHeight: 'var(--lh-body)' }}
                    >
                      {alt.summary}
                    </span>
                  </Link>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 'var(--t-meta-sm)', margin: 0 }}>
                The best-rated other tools in {primary?.name ?? 'the same part of the catalogue'}.
              </p>
            </section>
          ) : null}

          {tool.claimable ? (
            <div
              className="panel panel-tint"
              style={{
                padding: '22px 26px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <Icon name="shield" size={32} color="var(--c-violet)" strokeWidth={2} />
              <div>
                <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>
                  Do you work on {tool.name}?
                </div>
                <div className="muted" style={{ fontSize: 14.5, marginTop: 2 }}>
                  This is one of the tools we added at launch, so it is free to claim — one click,
                  nothing to verify. Claiming opens when sign-in does.
                </div>
              </div>
            </div>
          ) : null}

          <div
            className="muted"
            style={{
              borderTop: 'var(--border-soft)',
              paddingTop: 18,
              fontSize: 'var(--t-meta)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 20px',
              alignItems: 'center',
            }}
          >
            <span>
              Added by{' '}
              <strong style={{ color: 'var(--c-ink)', fontWeight: 600 }}>
                {tool.claimable ? 'Foundit' : (tool.keeperName ?? 'a maker')}
              </strong>
              {tool.claimable ? ' when we launched' : ''}
            </span>
            <span>{formatDate(tool.publishedAt ?? tool.createdAt)}</span>
          </div>
        </div>

        {/* --- the point of the whole page -------------------------------- */}
        <aside>
          <div
            className="slab slab-ink"
            style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <OutboundButton url={tool.url} className="btn-outbound">
              Open {tool.name}
            </OutboundButton>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                textAlign: 'center',
              }}
            >
              <span className="muted" style={{ fontSize: 'var(--t-meta-sm)' }}>
                Goes to
              </span>
              <OutboundDomain url={tool.url} />
            </div>

            <Button size="sm" disabled aria-describedby="save-needs-account">
              <Icon name="bookmark" size={16} />
              Save
            </Button>
            <span id="save-needs-account" className="sr-only">
              Saving needs an account and is not available yet.
            </span>
          </div>

          <div className="panel" style={{ padding: 20 }}>
            <dl className="facts">
              <dt>Looked after by</dt>
              <dd>{tool.claimable ? 'Nobody yet' : (tool.keeperHandle ? `@${tool.keeperHandle}` : 'Its maker')}</dd>
              <dt>Added</dt>
              <dd>{formatDate(tool.publishedAt ?? tool.createdAt)}</dd>
              <dt>Last updated</dt>
              <dd>{formatDate(tool.updatedAt)}</dd>
              <dt>Opened from here</dt>
              <dd>{tool.openCount}</dd>
            </dl>
          </div>

          <p className="facts-note">
            Foundit takes no referral fees and no paid placement. Rankings can’t be bought.
          </p>
        </aside>
      </main>

      <SiteFooter />
    </div>
  );
}

const PRICING_NOTE: Record<ToolPageData['pricing'], string> = {
  free: 'Free to use. No tier behind a payment.',
  freemium: 'There is a free tier, and a paid one above it.',
  free_trial: 'Free to try for a while, then paid.',
  paid: 'Paid. There is no free tier recorded.',
  open_source: 'Open source: free to use, and the source is public.',
  donation: 'Free, and funded by donations.',
};

function Point({ children, met }: { children: ReactNode; met: boolean }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 'var(--lh-body)' }}>
      <Icon
        name={met ? 'check' : 'dash'}
        size={20}
        color={met ? 'var(--c-violet)' : 'var(--c-faint)'}
        strokeWidth={2.5}
        style={{ marginTop: 2 }}
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * One aspect average. `of` is how many people it is an average of — a figure
 * that changes what the number means, so it is drawn beside it rather than
 * left for the reader to assume.
 */
function Aspect({
  label,
  value,
  of,
}: {
  label: string;
  value: string | null;
  of?: string | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        borderBottom: 'var(--border-quiet)',
        paddingBottom: 6,
      }}
    >
      <span className="muted">{label}</span>
      <span style={{ whiteSpace: 'nowrap' }}>
        <strong style={{ fontWeight: 700 }}>{value ?? 'Not rated'}</strong>
        {value && of ? (
          <span className="muted" style={{ fontWeight: 400 }}>
            {' '}
            {of}
          </span>
        ) : null}
      </span>
    </div>
  );
}
