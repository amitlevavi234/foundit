import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/Icon';
import { Mark } from '@/components/Logo';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getToolPage } from '@/lib/db';

/* ===========================================================================
 * SubmitSuccess.dc.html. "Receiptly is live."
 *
 * THE ONE SENTENCE THAT HAD TO CHANGE. The artboard says "It's searchable
 * now." It is not, quite: publishing queued the summary and every statement
 * for embedding (0017 §4) and a worker running beside the application drains
 * that queue within a few seconds. Text search finds it immediately; the
 * meaning half — the thing Foundit is actually for — arrives when the vectors
 * land. The gate for this phase is sixty seconds and the measured time is a
 * few, but "now" and "in a moment" are different promises and this screen
 * makes the one that is true.
 *
 * The page is reached once, after a redirect, and shows what the listing is.
 * It reads the tool page's own data — one cached round trip — so the name here
 * is the name the catalogue has rather than the one carried in a query string.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Your tool is live',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SubmitDone({ searchParams }: Props) {
  const params = await searchParams;
  const slug = first(params.tool) ?? '';
  const tool = slug ? await getToolPage(slug, 1) : null;
  const name = tool?.name ?? 'Your tool';
  const statements = tool?.problems.length ?? 0;

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main
        id="main"
        className="shell submitpage"
        style={{ textAlign: 'center', paddingTop: 60 }}
      >
        <p style={{ margin: '0 0 18px' }}>
          <Mark size={80} />
        </p>
        <h1 className="h2" style={{ margin: '0 0 14px', fontSize: 'var(--t-title)' }}>
          {name} is live.
        </h1>
        <p
          className="muted"
          style={{
            margin: '0 auto 32px',
            maxWidth: '52ch',
            fontSize: 'var(--t-lead)',
            lineHeight: 'var(--lh-body)',
          }}
        >
          The listing is yours to keep up to date. It can be found by name and by words right now;
          searches that match its <em>meaning</em> start working within a minute, once the problem
          statements have been read.
          {statements > 0 && statements < 3
            ? ` ${statements === 1 ? 'One problem statement is' : `${statements} problem statements are`} in — add another any time to reach more searches.`
            : ''}
        </p>

        <div
          style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          <Link className="btn" href="/submit">
            Add another
          </Link>
          {slug ? (
            <Link className="btn btn-coral" href={`/tools/${slug}`}>
              See the listing
              <Icon name="arrow" size={18} />
            </Link>
          ) : null}
        </div>

        <p className="muted" style={{ marginTop: 34, fontSize: 'var(--t-meta)' }}>
          <Link href={slug ? `/maker/${slug}` : '/maker'}>Your dashboard</Link> shows which searches
          found it, once five separate people have typed the same thing.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
