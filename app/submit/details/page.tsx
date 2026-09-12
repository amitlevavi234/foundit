import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubmitEyebrow, SubmitSteps } from '@/components/SubmitSteps';
import { displayDomain } from '@/lib/outbound';
import { NAME_MAX, SUMMARY_MAX, SUMMARY_MIN } from '@/lib/submit';

import { createListing } from '../actions';

/* ===========================================================================
 * Step 3 — SubmitDetails.dc.html. "Check the basics."
 *
 * The artboard's lead is "We pulled these from the page. Fix anything that's
 * off." Nothing was pulled from anywhere, so the lead says what is true: this
 * is where you write them. That is the same correction the previous step makes
 * and it is the one honest consequence of never fetching a stranger's URL.
 *
 * THIS IS WHERE THE DRAFT ROW IS CREATED, and the reason is `tools.summary`'s
 * 20-character CHECK: before there is a summary there is nothing to insert
 * that is not invented. From here on "Draft saved, continue anytime" is true
 * and the rail says so.
 *
 * THE ICON AND THE SCREENSHOTS ARE NOT BUILT, and the screen says so in one
 * sentence rather than drawing a drop target that does nothing. There is no
 * file upload anywhere in Foundit yet: `tools.logo_path` exists and is null on
 * all 224 listings, and every tile on the site is drawn from the name
 * (components/ToolTile.tsx). docs/product-decisions.md §14's rule is that a
 * control whose screen is a later phase stays drawn and disabled, and its
 * reason — an honest gap beats a convincing lie — applies to a field the same
 * way.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Add a tool — the basics',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SubmitDetails({ searchParams }: Props) {
  const params = await searchParams;
  const problem = first(params.problem);
  const field = first(params.field);
  const name = first(params.name) ?? '';
  const summary = first(params.summary) ?? '';
  const domain = first(params.from);

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main id="main" className="shell submitpage">
        <SubmitSteps now="details" back="/submit/url" />

        <SubmitEyebrow now="details" aside={domain ? displayDomain(domain) : undefined} />
        <h1 className="h2" style={{ margin: '0 0 12px' }}>
          The basics.
        </h1>
        <p
          className="muted"
          style={{ margin: '0 0 28px', fontSize: 'var(--t-lead)', lineHeight: 'var(--lh-body)' }}
        >
          Two things: what it is called, and one line saying what it does.
        </p>

        {problem ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            {problem}
          </p>
        ) : null}

        <form action={createListing}>
          <div style={{ marginBottom: 24 }}>
            <label className="setrow-label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={NAME_MAX}
              defaultValue={name}
              autoComplete="off"
              className={problem && field === 'name' ? 'field wrong' : 'field'}
              style={{ marginTop: 8, width: '100%' }}
              aria-invalid={problem && field === 'name' ? true : undefined}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label className="setrow-label" htmlFor="summary">
              One-line summary
            </label>
            <textarea
              id="summary"
              name="summary"
              required
              rows={3}
              minLength={SUMMARY_MIN}
              maxLength={SUMMARY_MAX}
              defaultValue={summary}
              className={problem && field === 'summary' ? 'field area wrong' : 'field area'}
              style={{ marginTop: 8, width: '100%' }}
              aria-describedby="summary-help"
              aria-invalid={problem && field === 'summary' ? true : undefined}
            />
            <p id="summary-help" className="muted" style={{ marginTop: 8, fontSize: 'var(--t-micro)' }}>
              Say what it does, not why it’s great. “Splits shared expenses across a group” beats
              “the #1 expense app”. Between {SUMMARY_MIN} and {SUMMARY_MAX} characters.
            </p>
          </div>

          <div className="panel panel-quiet" style={{ padding: 16, marginTop: 24 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)' }}>
              <Icon name="info" size={16} /> <strong>An icon and screenshots are not built yet.</strong>{' '}
              Foundit has no file upload anywhere, and every tile on the site is drawn from the
              name. Rather than a drop target that does nothing, this step leaves them out; the
              listing looks the same as the 224 already here.
            </p>
          </div>

          <div className="submitfoot">
            <Link className="ghost" href="/submit/url">
              Back
            </Link>
            <button type="submit" className="btn btn-coral">
              Continue to problems
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
