import type { ComponentProps } from 'react';

import { BackLink } from './BackLink';
import { SiteHeader } from './SiteHeader';
import { SkeletonGrid } from './SkeletonCard';

/**
 * What a route shows the instant a link to it is clicked, before its data
 * arrives — ResultsLoading.dc.html's grammar, used everywhere.
 *
 * Every catalogue page is one round trip to PostgreSQL, and in development
 * each is also compiled on first visit. Without this, a click on "Browse" did
 * nothing visible until the whole page was ready, and a page that does nothing
 * for a second after a click reads as broken rather than busy. Next renders a
 * route's `loading.tsx` immediately on navigation and prefetches it with the
 * link, so the header, the way back and the skeleton are on screen at once.
 *
 * The line says what is happening in plain words, and the skeleton holds the
 * shape of what is coming without a word in it (components/SkeletonCard.tsx).
 */
export function LoadingLine({ label, detail }: { label: string; detail?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 8, flexWrap: 'wrap' }}>
      <span className="spinner" aria-hidden="true" />
      <span className="disp" style={{ fontSize: 22, fontWeight: 700 }} role="status">
        {label}
      </span>
      {detail ? (
        <span className="faint" style={{ fontSize: 'var(--t-meta)' }}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export function RouteLoading({
  label,
  detail,
  active,
  back,
}: {
  label: string;
  detail?: string;
  active?: ComponentProps<typeof SiteHeader>['active'];
  /** Only where the destination's way back does not depend on the URL. */
  back?: { href: string; label: string };
}) {
  return (
    <div className="page">
      <SiteHeader active={active} />
      {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
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
        <LoadingLine label={label} detail={detail} />
        <SkeletonGrid />
      </main>
    </div>
  );
}
