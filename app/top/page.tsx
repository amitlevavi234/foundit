import type { Metadata } from 'next';
import Link from 'next/link';

import { BackLink } from '@/components/BackLink';
import { ChipLink } from '@/components/Chip';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TopRow } from '@/components/TopRow';
import { getTop } from '@/lib/db';
import type { TopRanking } from '@/lib/types';

/* ===========================================================================
 * Top tools — TopTools.dc.html.
 *
 * Ranked by the counters on `public.tools` and by nothing else: how many
 * people said a tool was useful, and how many saved it. No editorial thumb, no
 * paid placement, and no arithmetic here — the ordering is the database's, in
 * one statement (`getTop`).
 *
 * The artboard's two tabs are "This month" and "All time". A counter is a
 * running total with no time in it, so "this month" is not a thing this data
 * can answer honestly — a monthly figure would need a table of dated events
 * that does not exist yet. The two tabs are therefore the two counters that do
 * exist, which is a real choice a reader can make rather than a label over a
 * number that means something else.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Top tools',
  description:
    'The tools people found most useful on Foundit, ranked by likes and saves. No paid placement.',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const RANKINGS: Array<[TopRanking, string]> = [
  ['likes', 'Most useful'],
  ['saves', 'Most saved'],
];

interface TopProps {
  searchParams: Promise<{ in?: string | string[]; by?: string | string[] }>;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Top({ searchParams }: TopProps) {
  const params = await searchParams;
  const rawCategory = one(params.in);
  const category = rawCategory && rawCategory !== 'all' ? rawCategory : null;
  const ranking: TopRanking = one(params.by) === 'saves' ? 'saves' : 'likes';

  const data = await getTop(category, ranking, PAGE_SIZE);
  const active = data.categories.find((c) => c.slug === category);

  const href = (next: { in?: string | null; by?: TopRanking }) => {
    const search = new URLSearchParams();
    const inValue = next.in === undefined ? category : next.in;
    const byValue = next.by ?? ranking;
    if (inValue) search.set('in', inValue);
    if (byValue !== 'likes') search.set('by', byValue);
    const qs = search.toString();
    return qs ? `/top?${qs}` : '/top';
  };

  return (
    <div className="page">
      <SiteHeader active="top" />

      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{
          padding: '18px 56px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 26,
          flex: 1,
        }}
      >
        <div className="page-head">
          <div>
            <h1 className="disp" style={{ fontSize: 'var(--t-title)', margin: '0 0 10px' }}>
              Top tools
            </h1>
            <p className="muted" style={{ fontSize: 'var(--t-body-lg)', margin: 0 }}>
              Ranked by how many people said a tool was useful and how many saved it. No paid
              placement — rankings can’t be bought.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {RANKINGS.map(([key, label]) => (
              <ChipLink
                key={key}
                href={href({ by: key })}
                label={label}
                state={key === ranking ? 'explicit' : 'plain'}
                current={key === ranking}
              />
            ))}
          </div>
        </div>

        <div className="filter-row">
          <ChipLink
            href={href({ in: null })}
            label="All"
            state={category ? 'plain' : 'explicit'}
            current={!category}
          />
          {data.categories.map((c) => (
            <ChipLink
              key={c.slug}
              href={href({ in: c.slug })}
              label={c.name}
              state={c.slug === category ? 'explicit' : 'plain'}
              current={c.slug === category}
            />
          ))}
        </div>

        {data.tools.length === 0 ? (
          <p className="muted">Nothing in this category yet.</p>
        ) : (
          <div className="panel" style={{ overflow: 'hidden' }}>
            {data.tools.map((tool, i) => (
              <TopRow key={tool.slug} tool={tool} rank={tool.rank} index={i} />
            ))}
          </div>
        )}

        {/* This used to end "Every one of them links straight out to the
            maker", and no row on this page does: a row is a link to the tool's
            own page, which is where the address the maker entered is drawn,
            beside the domain it goes to (components/OutboundLink.tsx). A table
            of 25 outbound links would also be 25 chances to leave before
            reading anything, which is not what a ranked list is for. So the
            sentence says where the link out actually is. */}
        <p className="muted" style={{ fontSize: 'var(--t-meta)', margin: 0 }}>
          Showing {data.tools.length} of {data.total}
          {active ? ` in ${active.name}` : ' published tools'}. Each row opens its page here, where
          the maker’s own address is — <Link href="/browse">browse by problem</Link> if a name means
          nothing to you, which is rather the point.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
