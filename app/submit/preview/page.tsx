import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/Icon';
import { OutboundDomain } from '@/components/OutboundLink';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubmitEyebrow, SubmitSteps } from '@/components/SubmitSteps';
import { Tag } from '@/components/Chip';
import { ToolTile } from '@/components/ToolTile';
import { flagLabel, platformLabel, pricingLabel } from '@/lib/constraints';
import { myDraft, myListing } from '@/lib/maker';
import { checkSubmission } from '@/lib/submit';
import type { Platform, ToolFlag } from '@/lib/types';

import { publishDraft } from '../actions';

/* ===========================================================================
 * Step 6 — SubmitPreview.dc.html. "This is how it will appear."
 *
 * NO FIT METER, and this is the one difference from the artboard that is a
 * product decision rather than a deferral. The artboard draws the result card
 * complete with a meter at 88% and the caption "example fit for 'split a
 * restaurant bill unevenly'". There is no such number: a fit is against a
 * SENTENCE somebody typed, docs/product-decisions.md §6 as amended says a
 * percentage appears only from at least 200 human-judged pairs, and
 * tests/markup.test.mjs refuses handing a card's fit prop an ordering score on
 * any screen for exactly this reason — a rule this comment tripped over by
 * quoting it, because that test reads the file as text and does not care that
 * it was a comment. Drawing 88% here would be inventing the product's central
 * number on the screen where a maker decides whether it is honest.
 *
 * So the preview is the card without the meter: the tile, the name, the
 * summary, the constraint chips as tags, the statements, and the address as a
 * domain. That is what a person sees on /browse and on the tool page, and it is
 * everything about this listing that does not depend on a question nobody has
 * asked yet.
 *
 * THE WHOLE SUBMISSION IS CHECKED HERE, in the page as well as in the action:
 * the two gaps a person can reach this screen with are no platform and no
 * problem statement, and both of them are told here with a link back to the
 * step that fixes it, rather than being a refusal after pressing Publish.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Add a tool — preview',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const STEP_FOR: Record<string, { href: string; label: string }> = {
  name: { href: '/submit/details', label: 'the basics' },
  summary: { href: '/submit/details', label: 'the basics' },
  url: { href: '/submit/url', label: 'the address' },
  statements: { href: '/submit/problems', label: 'the problems' },
  pricing: { href: '/submit/constraints', label: 'the constraints' },
  platforms: { href: '/submit/constraints', label: 'the constraints' },
};

export default async function SubmitPreview({ searchParams }: Props) {
  const params = await searchParams;
  const draftId = first(params.draft) ?? '';
  const problem = first(params.problem);
  const refused = first(params.refused);
  const wait = Number.parseInt(first(params.wait) ?? '', 10);

  // A DRAFT, and this page is about drafts. A listing that is already live has
  // no Preview step left — the Phase 7 review (F7) found this page drawing an
  // enabled "Publish it" for one, so a resubmit spent one of three daily
  // publishes on a no-op and the person was then told they had hit the
  // ceiling. Their own dashboard is the honest place to send them.
  const draft = await myDraft(draftId);
  if (!draft) {
    const row = await myListing(draftId);
    if (row && row.status !== 'draft') redirect(`/maker/${row.slug}?published=1`);
    redirect('/maker');
  }

  const checked = checkSubmission(draft);

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main id="main" className="shell submitpage" style={{ maxWidth: 860 }}>
        <SubmitSteps now="preview" back={`/submit/constraints?draft=${draft.id}`} saved />

        <SubmitEyebrow now="preview" aside={draft.name} />
        <h1 className="h2" style={{ margin: '0 0 12px' }}>
          This is how it will appear.
        </h1>
        <p
          className="muted"
          style={{ margin: '0 0 28px', fontSize: 'var(--t-lead)', lineHeight: 'var(--lh-body)' }}
        >
          What somebody sees when {draft.name} shows up in their results. Anything off? Go back and
          fix it.
        </p>

        {refused ? (
          <div className="slab slab-coral" role="alert" style={{ padding: 22, marginBottom: 26 }}>
            <p className="h3" style={{ margin: '0 0 8px' }}>
              {refused === 'account'
                ? 'That is three listings today.'
                : 'That is a lot of listings from one connection.'}
            </p>
            <p style={{ margin: 0, lineHeight: 'var(--lh-body)' }}>
              {refused === 'account'
                ? 'Three a day per account is the limit while Foundit is small — it is about what a script can do to the catalogue, not about you. '
                : 'Ten an hour from one address is the limit, and it is there because accounts are free and this is what survives somebody making several. '}
              <strong>Nothing is lost.</strong> This draft is saved and publishing it
              {Number.isFinite(wait) && wait > 0
                ? ` will work again in about ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? '' : 's'}.`
                : ' will work again shortly.'}{' '}
              It is on <Link href="/maker">your listings</Link> until then.
            </p>
          </div>
        ) : null}

        {problem === 'accuracy' ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            Tick the box to say you have checked these details. Nobody reviews a listing before it
            goes live, so that tick is the only check there is.
          </p>
        ) : problem ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            {problem}
          </p>
        ) : null}

        {/* --- the card, as browse and the tool page draw it ----------------- */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <ToolTile name={draft.name} slug={draft.slug} size={60} />
            <div style={{ minWidth: 0 }}>
              <p className="h3" style={{ margin: 0, fontSize: 'var(--t-display-sm)' }}>
                {draft.name}
              </p>
              <p style={{ margin: '6px 0 0', lineHeight: 'var(--lh-body)' }}>{draft.summary}</p>
              <p style={{ margin: '10px 0 0' }}>
                <OutboundDomain url={draft.url} />
              </p>
            </div>
          </div>

          <div
            className="toolcard-chips"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}
          >
            <Tag>{pricingLabel(draft.pricing)}</Tag>
            {draft.platforms.map((platform: Platform) => (
              <Tag key={platform}>{platformLabel(platform)}</Tag>
            ))}
            {draft.flags.map((flag: ToolFlag) => (
              <Tag key={flag}>{flagLabel(flag)}</Tag>
            ))}
            {draft.languages.map((language) => (
              <Tag key={language}>{language}</Tag>
            ))}
          </div>

          <p className="faint" style={{ margin: '18px 0 0', fontSize: 'var(--t-micro)' }}>
            No ratings yet. Where the fit bar goes, nothing is drawn: a fit is against a sentence
            somebody typed, and this preview has no sentence. <Link href="/ranking">How ranking works</Link>.
          </p>
        </div>

        {/* --- the statements ---------------------------------------------- */}
        <div className="panel" style={{ padding: 22, marginTop: 24 }}>
          <p className="h3" style={{ margin: '0 0 14px' }}>
            Problems it solves
          </p>
          {draft.statements.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None yet. <Link href={`/submit/problems?draft=${draft.id}`}>Write at least one</Link> —
              this is what search matches against.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
              {draft.statements.map((statement) => (
                <li key={statement} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--c-violet)', flexShrink: 0 }}>
                    <Icon name="check" size={18} />
                  </span>
                  <span style={{ lineHeight: 'var(--lh-body)' }}>{statement}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- anything still missing -------------------------------------- */}
        {checked.problems.length > 0 ? (
          <div className="slab slab-coral" style={{ padding: 22, marginTop: 24 }}>
            <p className="h3" style={{ margin: '0 0 10px' }}>
              Not quite ready.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 'var(--lh-body)' }}>
              {checked.problems.map((gap) => {
                const step = STEP_FOR[gap.field];
                return (
                  <li key={`${gap.field}:${gap.message}`}>
                    {gap.message}{' '}
                    {step ? (
                      <Link href={step.href === '/submit/problems' || step.href === '/submit/constraints' ? `${step.href}?draft=${draft.id}` : step.href}>
                        Fix it in {step.label}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <form action={publishDraft} style={{ marginTop: 28 }}>
          <input type="hidden" name="draft" value={draft.id} />

          <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <input type="checkbox" name="accurate" value="yes" required className="check" />
            <span style={{ lineHeight: 'var(--lh-body)' }}>
              I’ve checked these details are accurate.
            </span>
          </label>

          <div className="submitfoot">
            <Link className="ghost" href={`/submit/constraints?draft=${draft.id}`}>
              Back
            </Link>
            <span style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 'var(--t-micro)' }}>
                Goes live as soon as you publish. You can edit it any time.
              </span>
              <button type="submit" className="btn btn-coral" disabled={checked.problems.length > 0}>
                Publish it
                <Icon name="arrow" size={18} />
              </button>
            </span>
          </div>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
