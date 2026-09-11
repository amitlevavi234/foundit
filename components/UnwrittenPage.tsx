import type { ReactNode } from 'react';

import { BackLink } from './BackLink';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/**
 * A page in the site chrome that somebody still has to write.
 *
 * About, Guidelines, Contact and Privacy are drawn in every artboard's footer
 * and were four links to a 404. They are not screens an agent can build: they
 * are text the people running Foundit have to decide on, and Privacy is a
 * legal document that must exist before a real person uses the site.
 *
 * So the route exists and says exactly that. It does not invent a policy, a
 * promise, an address or a date — the one thing worse than a missing privacy
 * page is a made-up one, because a made-up one stops anybody noticing it is
 * missing. `docs/product-decisions.md` §14 records the choice.
 *
 * Not indexed: an empty page under a real title is not what a search result
 * for "Foundit privacy" should be.
 */
export interface UnwrittenPageProps {
  title: string;
  /** What this page will say once it exists. Plain, and no commitments. */
  children: ReactNode;
}

export function UnwrittenPage({ title, children }: UnwrittenPageProps) {
  return (
    <div className="page">
      <SiteHeader />

      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{
          padding: '18px 56px 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          flex: 1,
        }}
      >
        <h1 className="disp" style={{ fontSize: 'var(--t-title)', margin: 0 }}>
          {title}
        </h1>

        <div
          className="panel panel-quiet"
          style={{
            padding: '22px 26px',
            maxWidth: 680,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            fontSize: 'var(--t-body)',
            lineHeight: 'var(--lh-body)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 'var(--fw-semibold)' }}>
            This page has not been written yet.
          </p>
          <div className="muted" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {children}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
