import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ToolTile } from '@/components/ToolTile';
import { flagLabel, platformLabel, pricingLabel } from '@/lib/constraints';
import { categoryOptions, makerDashboard, myDraft } from '@/lib/maker';
import {
  LANGUAGES,
  NAME_MAX,
  PLATFORMS,
  PRICING_MODELS,
  STATEMENTS_MAX,
  STATEMENT_MAX,
  SUMMARY_MAX,
  SUMMARY_MIN,
  TOOL_FLAGS,
} from '@/lib/submit';

import { saveListing } from '../../../submit/actions';

/* ===========================================================================
 * EditListing.dc.html. "You maintain this listing."
 *
 * Owner-only, and the owner check is not here: `public.tool_is_mine` decides,
 * `MAKER_DASHBOARD_SQL` returns no row when it says no, and this page shows
 * the same 404 for "not yours", "not there" and "not signed in". There is no
 * comparison of ids anywhere in this file.
 *
 * WHAT IT EDITS, and what it cannot. The eight columns 0017 grants UPDATE on —
 * name, summary, pricing, platforms, languages, flags, logo_path, links — plus
 * the problem statements through their own door. NOT the address: `tools.url`
 * is the unique key the duplicate message reads and changing it makes the
 * listing a different tool, so it is not in the grant and is not drawn here,
 * which is also what the artboard does.
 *
 * THE PRICING PLANS TABLE THE ARTBOARD DRAWS IS NOT BUILT. `tools.pricing` is
 * one enum value (0001) and docs/product-decisions.md §8 lists "pricing model"
 * as the thing tracked, not a price list. A table of plans and prices that the
 * catalogue cannot store and search cannot filter on would be a form somebody
 * fills in and nothing reads.
 *
 * WHAT AN EDIT RE-READS. Only what changed. A statement whose text is
 * identical keeps its row, its vector and its provenance, because
 * `public.set_owner_statements` deletes what is gone, inserts what is new and
 * leaves the rest alone — and the trigger on `tool_problems` only fires for a
 * row whose statement actually moved. A name change re-reads nothing at all.
 * db/test/adding_a_tool_test.sql §7 is the proof.
 *
 * AND THE CACHES. `saveListing` calls `revalidateTag('catalogue')` plus the
 * four paths, which is the Phase 3 note in lib/db.ts being closed rather than
 * restated: the tool page, browse, /top and the homepage are cached for a
 * minute as the anonymous view, and without this a maker saves a summary and
 * watches the old one for up to sixty seconds.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Edit your listing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function PillInput({
  type,
  name,
  value,
  label,
  checked,
}: {
  type: 'checkbox' | 'radio';
  name: string;
  value: string;
  label: string;
  checked: boolean;
}) {
  const id = `${name}-${value}`;
  return (
    <span className="ratefield" style={{ display: 'inline-flex' }}>
      <input type={type} id={id} name={name} value={value} defaultChecked={checked} />
      <label htmlFor={id} className="pill" style={{ width: 'auto', height: 'auto', padding: '8px 14px' }}>
        {label}
      </label>
    </span>
  );
}

const GROUP: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  margin: '10px 0 26px',
};

export default async function EditListing({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const problem = first(query.problem);
  const field = first(query.field);

  const data = await makerDashboard(slug);
  if (!data) notFound();

  // The full row, with the arrays the form needs. One more round trip, and it
  // is the same statement the submit flow's steps use — MY_DRAFT_SQL, which is
  // `tool_is_mine` all over again rather than a second rule.
  const listing = await myDraft(data.listing.id);
  if (!listing) notFound();
  const categories = await categoryOptions();

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="shell makerpage" style={{ maxWidth: 820 }}>
        <div className="ownerband">
          <span>
            <Icon name="shield" size={18} />
            You maintain this listing. Changes go live as soon as you save.
          </span>
          <Link href={`/tools/${listing.slug}`}>View public page</Link>
        </div>

        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginBottom: 26 }}>
          <ToolTile name={listing.name} slug={listing.slug} size={72} />
          <div>
            <h1 className="h2" style={{ margin: 0 }}>
              {listing.name}
            </h1>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 'var(--t-meta)' }}>
              {listing.url}
              <br />
              <span className="faint">The address is not editable — a different address is a different tool.</span>
            </p>
          </div>
        </div>

        {problem ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            {problem}
          </p>
        ) : null}

        <form action={saveListing}>
          <input type="hidden" name="slug" value={listing.slug} />
          <input type="hidden" name="tool" value={listing.id} />
          <input type="hidden" name="url" value={listing.url} />

          <div style={{ marginBottom: 24 }}>
            <label className="setrow-label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={NAME_MAX}
              defaultValue={listing.name}
              className={problem && field === 'name' ? 'field wrong' : 'field'}
              style={{ marginTop: 8, width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 26 }}>
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
              defaultValue={listing.summary}
              className={problem && field === 'summary' ? 'field area wrong' : 'field area'}
              style={{ marginTop: 8, width: '100%' }}
            />
            <p className="muted" style={{ marginTop: 8, fontSize: 'var(--t-micro)' }}>
              Changing this re-reads the summary and nothing else.
            </p>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
            <legend className="setrow-label">Problems it solves</legend>
            <p className="muted" style={{ margin: '6px 0 14px', fontSize: 'var(--t-micro)' }}>
              Up to {STATEMENTS_MAX}, at most {STATEMENT_MAX} characters each. Clear a box to remove
              that one. A statement you leave alone keeps what it has; only the ones you change are
              read again.
            </p>
            {[...Array(STATEMENTS_MAX).keys()].map((index) => {
              const value = listing.statements[index] ?? '';
              const show = index < listing.statements.length + 1 || value !== '';
              if (!show) return null;
              return (
                <div className="statementrow" key={index}>
                  <span className="statementrow-n" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>
                    <label className="sr-only" htmlFor={`statement${index}`}>
                      Problem statement {index + 1}
                    </label>
                    <textarea
                      id={`statement${index}`}
                      name={`statement${index}`}
                      rows={2}
                      maxLength={STATEMENT_MAX}
                      defaultValue={value}
                      placeholder={index === 0 ? 'The situation somebody is in when they need this' : 'Another situation it fits'}
                      className={problem && field === 'statements' ? 'field area wrong' : 'field area'}
                      style={{ width: '100%' }}
                    />
                  </span>
                </div>
              );
            })}
          </fieldset>

          <div style={{ marginBottom: 26 }}>
            <label className="setrow-label" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              name="category"
              required
              defaultValue={listing.category ?? ''}
              className="field"
              style={{ marginTop: 8, maxWidth: 360 }}
            >
              <option value="" disabled>
                Pick one
              </option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
            <p className="muted" style={{ marginTop: 8, fontSize: 'var(--t-micro)' }}>
              What puts it on Browse problems and the top lists.
            </p>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">Price</legend>
            <div style={GROUP}>
              {PRICING_MODELS.map((pricing) => (
                <PillInput
                  key={pricing}
                  type="radio"
                  name="pricing"
                  value={pricing}
                  label={pricingLabel(pricing)}
                  checked={listing.pricing === pricing}
                />
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">Platforms</legend>
            <div style={GROUP}>
              {PLATFORMS.map((platform) => (
                <PillInput
                  key={platform}
                  type="checkbox"
                  name="platforms"
                  value={platform}
                  label={platformLabel(platform)}
                  checked={listing.platforms.includes(platform)}
                />
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">
              Languages{' '}
              <span className="muted" style={{ fontWeight: 400, fontSize: 'var(--t-micro)' }}>
                full interface only
              </span>
            </legend>
            <div style={GROUP}>
              {LANGUAGES.map((language) => (
                <PillInput
                  key={language}
                  type="checkbox"
                  name="languages"
                  value={language}
                  label={language}
                  checked={listing.languages.includes(language)}
                />
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">And these, if they are true</legend>
            <div style={GROUP}>
              {TOOL_FLAGS.map((flag) => (
                <PillInput
                  key={flag}
                  type="checkbox"
                  name="flags"
                  value={flag}
                  label={flagLabel(flag)}
                  checked={listing.flags.includes(flag)}
                />
              ))}
            </div>
          </fieldset>

          <div className="panel panel-quiet" style={{ padding: 16 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)' }}>
              <Icon name="info" size={16} /> Ratings and reviews belong to the people who wrote
              them, and nothing here can change one.
            </p>
          </div>

          <div className="savebar">
            <span className="muted" style={{ fontSize: 'var(--t-meta)' }}>
              Saving publishes the change immediately. Nothing waits for approval.
            </span>
            <span style={{ display: 'flex', gap: 12 }}>
              <Link className="ghost" href={`/maker/${listing.slug}`}>
                Discard
              </Link>
              <button type="submit" className="btn btn-coral">
                Save and publish
              </button>
            </span>
          </div>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
