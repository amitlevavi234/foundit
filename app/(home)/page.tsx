import Link from 'next/link';

import { Contraption } from '@/components/Contraption';
import { ProblemCard } from '@/components/ProblemCard';
import { SearchField } from '@/components/SearchField';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TopRow } from '@/components/TopRow';
import { getHome } from '@/lib/db';

/* ===========================================================================
 * The homepage — Main.dc.html.
 *
 * One input, three problems somebody else already had, the tools the counters
 * put in front, and the three sentences that say how this works. Everything
 * below the fold is a real row: the problem statements are `tool_problems`,
 * the ranked strip is `tools.like_count` and `tools.save_count`, and the two
 * numbers in the copy are counts of the catalogue. One round trip for all of
 * it (`getHome`).
 *
 * The box submits to /results as a GET, so a search is a URL: shareable,
 * back-button-able, and working with JavaScript switched off.
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
    'Each result shows where it matched and which of your constraints it meets.',
    'var(--c-lime)',
  ],
];

/**
 * Rendered per request. The counters move, and a page cached at build time
 * would be a snapshot of a database that was not there when it was built.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const home = await getHome(6, 3);

  return (
    <div className="page">
      <SiteHeader />

      <main id="main" style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {/* A wash of violet behind the top right corner. A gradient, not a
            blur: nothing in this interface is filtered. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -120,
            right: -80,
            width: 720,
            height: 720,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(110,75,246,.14), transparent 62%)',
            pointerEvents: 'none',
          }}
        />

        <section
          className="shell"
          style={{
            position: 'relative',
            padding: '72px 56px 56px',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 56fr) minmax(0, 44fr)',
            gap: 40,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
            <h1 className="disp rise" style={{ fontSize: 'var(--t-hero)', margin: 0, maxWidth: 640 }}>
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
                maxWidth: 520,
                animationDelay: '120ms',
              }}
            >
              No app names, no categories. Describe the problem in a sentence or a few and get the
              tools that actually fit, with the reasons.
            </p>

            <div className="rise" style={{ animationDelay: '200ms' }}>
              <SearchField action="/results" autoFocus />
            </div>

            <div
              className="rise"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 12, animationDelay: '300ms' }}
            >
              {EXAMPLE_PROMPTS.map((prompt) => (
                <Link
                  key={prompt}
                  href={{ pathname: '/results', query: { q: prompt } }}
                  className="pill"
                  style={{ textDecoration: 'none' }}
                >
                  {prompt}
                </Link>
              ))}
            </div>
          </div>

          <div
            className="rise"
            style={{ display: 'flex', justifyContent: 'center', animationDelay: '260ms' }}
          >
            <Contraption />
          </div>
        </section>

        <section className="shell" style={{ padding: '40px 56px 72px' }}>
          <div className="section-head">
            <h2 className="disp" style={{ fontSize: 'var(--t-section)', margin: 0, fontWeight: 700 }}>
              Found lately
            </h2>
            <Link href="/browse" style={{ fontWeight: 'var(--fw-semibold)' }}>
              See all problems people solved
            </Link>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 28,
            }}
          >
            {home.found.map((problem, i) => (
              <ProblemCard key={problem.slug} problem={problem} lead index={i} />
            ))}
          </div>
        </section>

        <section className="shell" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2 className="disp" style={{ fontSize: 'var(--t-section)', margin: 0, fontWeight: 700 }}>
              Top tools
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
            {home.topTools.map((tool, i) => (
              <TopRow
                key={tool.slug}
                tool={tool}
                rank={i + 1}
                compact
                columnRule={i % 2 === 0}
                index={i}
              />
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
