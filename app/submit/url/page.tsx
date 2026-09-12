import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubmitEyebrow, SubmitSteps } from '@/components/SubmitSteps';
import { ToolTile } from '@/components/ToolTile';

import { setSubmitUrl } from '../actions';

/* ===========================================================================
 * Step 2 — SubmitURL.dc.html. "Where does it live?"
 *
 * TWO THINGS THE ARTBOARD DRAWS THAT THIS SCREEN DOES NOT DO, and both are
 * said on the page rather than quietly dropped:
 *
 *   "We'll read the page and fill in what we can." WE DO NOT READ THE PAGE.
 *   docs/product-decisions.md §12: our server never fetches an address a
 *   stranger supplied — not the page, not a favicon, not a HEAD request to see
 *   whether it resolves. tests/markup.test.mjs pins the three files that may
 *   call `fetch` and none of them is reachable from here. The button is
 *   therefore "Check the address" rather than "Read the page", and the sentence
 *   under the field says what happens instead.
 *
 *   The duplicate slab. This screen cannot show it, because it does not know
 *   the address is taken until the row is attempted — `tools.url` is unique and
 *   the constraint is the check. So the slab is drawn HERE, on the way back:
 *   step 3 redirects to this screen with the existing listing's public name
 *   when the insert collides. Its public name and nothing else — not who
 *   maintains it, not whether it has an owner.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Add a tool — where it lives',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SubmitUrl({ searchParams }: Props) {
  const params = await searchParams;
  const problem = first(params.problem);
  const duplicate = first(params.duplicate);
  const listing = first(params.listing);
  const typed = first(params.url) ?? '';

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main id="main" className="shell submitpage">
        <SubmitSteps now="url" back="/submit" />

        <SubmitEyebrow now="url" />
        <h1 className="h2" style={{ margin: '0 0 12px' }}>
          Where does it live?
        </h1>
        <p
          className="muted"
          style={{ margin: '0 0 28px', fontSize: 'var(--t-lead)', lineHeight: 'var(--lh-body)' }}
        >
          A homepage, a store page, or a code repository all work. Paste the address people should
          end up at.
        </p>

        <form action={setSubmitUrl}>
          <label className="setrow-label" htmlFor="url">
            The address
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <input
              id="url"
              name="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              required
              defaultValue={typed}
              placeholder="https://"
              className={problem ? 'field wrong' : 'field'}
              style={{ flex: '1 1 320px', minWidth: 0, height: 56, fontSize: 'var(--t-body-lg)' }}
              aria-describedby="url-help"
              aria-invalid={problem ? true : undefined}
            />
            <button type="submit" className="btn btn-coral" style={{ height: 56 }}>
              Check the address
              <Icon name="arrow" size={18} />
            </button>
          </div>

          {problem ? (
            <p className="wrongnote" role="alert">
              {problem}
            </p>
          ) : null}

          <p id="url-help" className="muted" style={{ marginTop: 10, fontSize: 'var(--t-micro)' }}>
            <strong>https only</strong>, because the link is rendered for people to click. We check
            that it is an address a browser could open and then move on — we do not open it.
            Nothing on Foundit reads a page you give us, so the next step is yours to fill in.
          </p>
        </form>

        {duplicate ? (
          <div
            className="slab slab-coral"
            role="alert"
            style={{ marginTop: 32, padding: 22, display: 'grid', gap: 14 }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {listing ? <ToolTile name={duplicate} slug={listing} size={56} /> : null}
              <div>
                <p className="h3" style={{ margin: 0 }}>
                  {duplicate}
                </p>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 'var(--t-micro)' }}>
                  That address is already in the catalogue.
                </p>
              </div>
            </div>
            <p style={{ margin: 0, lineHeight: 'var(--lh-body)' }}>
              If something on that listing is wrong or out of date, telling us gets it fixed faster
              than a second listing. If you made it, you can take it over.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {listing ? (
                <Link className="btn btn-sm" href={`/tools/${listing}`}>
                  View listing
                </Link>
              ) : null}
              {listing ? (
                <Link className="btn btn-sm btn-violet" href={`/claim?tool=${listing}`}>
                  <Icon name="shield" size={16} />
                  Claim it instead
                </Link>
              ) : null}
              <Link className="ghost" href="/submit/url">
                This is a different tool
              </Link>
            </div>
          </div>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
