import type { Metadata } from 'next';
import Link from 'next/link';

import { BackLink } from '@/components/BackLink';
import { ChipLink } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { ProblemCard } from '@/components/ProblemCard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getBrowse } from '@/lib/db';

/* ===========================================================================
 * Browse problems — BrowseProblems.dc.html.
 *
 * The catalogue read the way it is indexed: not by category, but by the
 * problems people wrote down. Every card is a row of `public.tool_problems` —
 * somebody's sentence about a situation — and following one runs it as a
 * search, because that is exactly what it is.
 *
 * At most one statement per tool, so a page of twelve is twelve different
 * tools rather than one thorough listing four times over.
 *
 * One round trip: the categories with their counts, the same categories in
 * depth order for the sidebar, the page of statements, and the two totals in
 * the standfirst all arrive together (`getBrowse`). Nothing on this page is
 * sorted, filtered or counted after it arrives.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Browse problems',
  description:
    'The problems people bring to Foundit, in their own words, and the tools that solve them.',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;

interface BrowseProps {
  searchParams: Promise<{ in?: string | string[] }>;
}

export default async function Browse({ searchParams }: BrowseProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.in) ? params.in[0] : params.in;
  const category = raw && raw !== 'all' ? raw : null;

  const data = await getBrowse(category, PAGE_SIZE);
  const active = data.categories.find((c) => c.slug === category);

  return (
    <div className="page">
      <SiteHeader active="browse" />

      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{
          padding: '18px 56px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          flex: 1,
        }}
      >
        <div className="page-head">
          <div>
            <h1 className="disp" style={{ fontSize: 'var(--t-title)', margin: '0 0 10px' }}>
              Problems people solve here
            </h1>
            <p className="muted" style={{ fontSize: 'var(--t-body-lg)', margin: 0 }}>
              {data.toolCount} tools, indexed by {data.problemCount} problems written in plain
              language. Pick one to see what fits, or describe your own.
            </p>
          </div>

          {/* A problem is a search. This box is the same search as the
              homepage's, narrow enough to sit in a header. */}
          <form action="/results" method="get" role="search" className="field" style={{ width: 340 }}>
            <Icon name="search" size={18} color="var(--c-faint)" />
            <label className="sr-only" htmlFor="browse-q">
              Describe the problem you want solved
            </label>
            <input id="browse-q" name="q" maxLength={200} placeholder="Describe a problem" />
            <button type="submit" className="ghost" aria-label="Search">
              <Icon name="arrow" size={18} strokeWidth={2.25} />
            </button>
          </form>
        </div>

        <div className="filter-row">
          <ChipLink
            href="/browse"
            label="All"
            state={category ? 'plain' : 'explicit'}
            current={!category}
          />
          {data.categories.map((c) => (
            <ChipLink
              key={c.slug}
              href={`/browse?in=${encodeURIComponent(c.slug)}`}
              label={`${c.name} · ${c.toolCount}`}
              state={c.slug === category ? 'explicit' : 'plain'}
              current={c.slug === category}
            />
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 340px',
            gap: 40,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 18,
              }}
            >
              {data.problems.map((problem, i) => (
                <ProblemCard key={`${problem.slug}-${i}`} problem={problem} index={i} />
              ))}
            </div>

            <p className="muted" style={{ fontSize: 'var(--t-meta)', margin: 0 }}>
              Showing {data.problems.length} of {data.matchedCount}
              {active ? ` in ${active.name}` : ''}, one per tool.
            </p>
          </div>

          <aside
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              position: 'sticky',
              top: 24,
            }}
          >
            {/* The artboard puts "Trending this week" here, off the back of
                what people searched for. That lives in `search_events`, which
                only an admin may read — the whole point of the table is that
                it is not a public record — so this panel shows the shape of
                the catalogue instead, which is a fact anyone may see. */}
            <div
              className="slab slab-lime"
              style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div className="h3">Where the catalogue is deepest</div>
              {data.deepest.map((c) => (
                <Link
                  key={c.slug}
                  href={`/browse?in=${encodeURIComponent(c.slug)}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    fontSize: 14.5,
                    color: 'var(--c-ink)',
                    padding: '8px 0',
                    borderTop: 'var(--border-soft)',
                  }}
                >
                  <span>{c.name}</span>
                  <span
                    className="tab"
                    style={{ color: 'var(--c-violet)', fontWeight: 700, whiteSpace: 'nowrap' }}
                  >
                    {c.toolCount} tools
                  </span>
                </Link>
              ))}
            </div>

            <div
              className="panel"
              style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div className="h3" style={{ fontSize: 18 }}>
                Don’t see yours?
              </div>
              <p className="muted" style={{ fontSize: 14.5, lineHeight: 'var(--lh-body)', margin: 0 }}>
                Describe it in your own words. You do not need an account, and you do not need to
                know what the thing is called.
              </p>
              <Link href="/" className="btn btn-sm btn-coral" style={{ alignSelf: 'flex-start' }}>
                Describe a problem
              </Link>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
