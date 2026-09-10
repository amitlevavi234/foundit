import Link from 'next/link';
import { after } from 'next/server';

import { EmptyState } from '@/components/EmptyState';
import { SearchField } from '@/components/SearchField';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ToolCard } from '@/components/ToolCard';
import { ToolTile } from '@/components/ToolTile';
import { logSearchEvent, searchTools } from '@/lib/db';
import { QueryTooLongError } from '@/lib/sql';
import type { ToolResult } from '@/lib/types';

/* ===========================================================================
 * The homepage.
 *
 * Phase 2-UI owns the design system and the shell; the screens themselves
 * belong to the agent that comes next. This page is deliberately the smallest
 * thing that proves the whole stack is real: the tokens render, the fonts load
 * without shifting, the shared components compose, and a sentence typed into
 * the box comes back as rows out of PostgreSQL.
 *
 * The inline result list below the fold is scaffolding, not the results
 * screen. Results.dc.html is a conversation with a fit meter, satisfaction
 * chips and reasons on every card, and it lives at /results when someone
 * builds it. This is a list of what the database returned, so the data layer
 * can be seen working end to end.
 * ======================================================================== */

const EXAMPLE_PROMPTS = [
  'Scan receipts without an account',
  'Track habits offline',
  'Transcribe interviews in French',
  'Back up photos without Google',
];

const POINTS: Array<[title: string, body: string, colour: string]> = [
  [
    'Write it like you’d say it',
    'Constraints count. “Free”, “offline”, “in Spanish” change the answer. Any language works.',
    'var(--c-coral)',
  ],
  [
    'We match on problems, not names',
    'Every tool is indexed by the jobs it actually does, in plain language.',
    'var(--c-violet)',
  ],
  [
    'See why, not just what',
    'Each result shows how well it fits and which of your constraints it misses.',
    'var(--c-lime)',
  ],
];

/**
 * Rendered per request. Awaiting `searchParams` already makes this route
 * dynamic; saying so explicitly means `next build` can never decide to
 * prerender it and reach for a database that is not there at build time.
 */
export const dynamic = 'force-dynamic';

interface HomeProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (raw ?? '').trim();

  let results: ToolResult[] = [];
  let tooLong = false;

  if (query) {
    const startedAt = performance.now();
    try {
      results = await searchTools(query, {}, 12);
      const latencyMs = Math.round(performance.now() - startedAt);
      const top = results[0];

      // After the response, never before it. `after` runs the callback once
      // the page has been streamed, so logging cannot add a millisecond to
      // what the visitor waits for — and a failure in it cannot turn a good
      // search into an error page.
      //
      // Nothing identifying is passed, because there is nothing to pass: the
      // event has no user field and `public.search_events` has no user column.
      after(() => {
        logSearchEvent({
          query,
          resultCount: results.length,
          topScore: top ? top.score : null,
          hadGoodMatch: results.length > 0,
          latencyMs,
        });
      });
    } catch (error) {
      if (error instanceof QueryTooLongError) {
        tooLong = true;
      } else {
        throw error;
      }
    }
  }

  // Editorial order with no sentence typed: `search_tools` returns the
  // catalogue by rating and likes rather than an empty set, which is why
  // "top tools" needs no second code path.
  const top = await searchTools('', {}, 6);

  return (
    <div className="page">
      <SiteHeader />

      <main id="main" style={{ position: 'relative', flex: 1 }}>
        <section
          className="shell"
          style={{
            padding: '72px 56px 56px',
            display: 'flex',
            flexDirection: 'column',
            gap: 30,
            maxWidth: 980,
          }}
        >
          <h1 className="disp rise" style={{ fontSize: 'var(--t-hero)', margin: 0, maxWidth: 720 }}>
            Say what’s bugging you. We’ll{' '}
            <span className="hl" style={{ color: 'var(--c-on-fill)', padding: '0 6px' }}>
              find the tool.
            </span>
          </h1>

          <p
            className="rise muted"
            style={{
              margin: 0,
              fontSize: 'var(--t-lead)',
              maxWidth: 560,
              animationDelay: '120ms',
            }}
          >
            No app names, no categories. Describe the problem in a sentence or a few and get the
            tools that actually fit, with the reasons.
          </p>

          <div className="rise" style={{ animationDelay: '200ms' }}>
            <SearchField defaultValue={query} />
          </div>

          <div
            className="rise"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 12, animationDelay: '300ms' }}
          >
            {EXAMPLE_PROMPTS.map((prompt) => (
              <Link
                key={prompt}
                href={{ pathname: '/', query: { q: prompt } }}
                className="pill"
                style={{ textDecoration: 'none' }}
              >
                {prompt}
              </Link>
            ))}
          </div>
        </section>

        {tooLong ? (
          <section className="shell" style={{ paddingBottom: 56 }}>
            <EmptyState title="That’s a long one.">
              A search is capped at <strong>200 characters</strong>, which is about two sentences.
              Trim it to the part that describes the problem and try again.
            </EmptyState>
          </section>
        ) : null}

        {query && !tooLong ? (
          <section className="shell" style={{ paddingBottom: 72 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 26,
                gap: 16,
              }}
            >
              <h2 className="disp" style={{ fontSize: 'var(--t-display-lg)', margin: 0 }}>
                {results.length === 0
                  ? 'Nothing fits.'
                  : `${results.length} ${results.length === 1 ? 'tool' : 'tools'} fit.`}
              </h2>
              <div className="muted" style={{ fontSize: 'var(--t-body-sm)' }}>
                Sorted by{' '}
                <strong style={{ color: 'var(--c-ink)', fontWeight: 'var(--fw-semibold)' }}>
                  best fit
                </strong>
              </div>
            </div>

            {results.length === 0 ? (
              <EmptyState>
                Foundit only recommends tools people can stand behind, and nothing in the catalogue
                answers this yet. Try describing the problem rather than the tool — what you are
                trying to get done, and what would make an answer unusable.
              </EmptyState>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 28,
                  padding: 6,
                }}
              >
                {results.map((tool, i) => (
                  <ToolCard
                    key={tool.slug}
                    name={tool.name}
                    slug={tool.slug}
                    summary={tool.summary}
                    index={i}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className="shell" style={{ paddingBottom: 80 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 22,
            }}
          >
            <h2 className="disp" style={{ fontSize: 'var(--t-section)', margin: 0, fontWeight: 700 }}>
              Top tools this month
            </h2>
            <Link href="/top" style={{ fontWeight: 'var(--fw-semibold)' }}>
              See all top tools
            </Link>
          </div>

          <div
            className="panel"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              overflow: 'hidden',
            }}
          >
            {top.map((tool, i) => (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '34px 44px minmax(0, 1fr)',
                  gap: 14,
                  alignItems: 'center',
                  padding: '14px 22px',
                  color: 'var(--c-ink)',
                  textDecoration: 'none',
                  borderTop: i < 2 ? undefined : '2px solid var(--c-rule)',
                  borderRight: i % 2 === 0 ? '2px solid var(--c-rule)' : undefined,
                }}
              >
                <span
                  className="disp tab"
                  style={{ fontSize: 22, color: i < 3 ? 'var(--c-coral)' : 'var(--c-faint)' }}
                >
                  {i + 1}
                </span>
                <ToolTile name={tool.name} slug={tool.slug} size={44} />
                <span>
                  <span className="disp" style={{ fontSize: 18, fontWeight: 700, display: 'block' }}>
                    {tool.name}
                  </span>
                  <span className="muted" style={{ fontSize: 'var(--t-meta-sm)' }}>
                    {tool.summary}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section
          className="shell"
          style={{
            paddingBottom: 88,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 28,
          }}
        >
          {POINTS.map(([title, body, colour]) => (
            <div key={title} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: colour,
                  border: 'var(--border)',
                  flex: 'none',
                  marginTop: 4,
                }}
              />
              <div>
                <div className="h3" style={{ marginBottom: 6 }}>
                  {title}
                </div>
                <div className="muted" style={{ lineHeight: 'var(--lh-body)' }}>
                  {body}
                </div>
              </div>
            </div>
          ))}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

