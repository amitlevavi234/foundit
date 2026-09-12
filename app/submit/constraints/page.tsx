import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubmitEyebrow, SubmitSteps } from '@/components/SubmitSteps';
import { flagLabel, platformLabel, pricingLabel } from '@/lib/constraints';
import { myDraft } from '@/lib/maker';
import { LANGUAGES, PLATFORMS, PRICING_MODELS, TOOL_FLAGS } from '@/lib/submit';

import { setConstraints } from '../actions';

/* ===========================================================================
 * Step 5 — SubmitConstraints.dc.html. "What's true about it today?"
 *
 * These are the five things docs/product-decisions.md §8 says Foundit tracks
 * per tool — pricing, platforms, languages, offline capability and whether an
 * account is needed — and they are the five things search FILTERS on, which is
 * why the lead says "only tick what's true today".
 *
 * OFFLINE AND ACCOUNT ARE FLAGS, not the three-way radios the artboard draws.
 * `tools.flags` is an enum array with `works_offline` and `no_account_needed`
 * in it (0001) and search's hard filter is "has this flag or does not". A
 * "partly, syncs later" that the database cannot represent would be a chip a
 * person ticks and a filter that ignores, which is worse than the question not
 * being asked. So each is a single tick meaning "fully", and the helper text
 * says what a half-answer should do with it.
 *
 * EVERY CONTROL IS A NATIVE CHECKBOX OR RADIO, styled by `.pill`. No
 * JavaScript, no client component: the artboard's toggle pills are `<input>`s
 * with a `<label>`, which is also what makes them reachable from the keyboard
 * and announced as what they are.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Add a tool — what is true about it',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A pill that is a real checkbox. `.pill` styles the label; the input is the control. */
function PillCheck({
  name,
  value,
  label,
  checked,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
}) {
  const id = `${name}-${value}`;
  return (
    <span className="ratefield" style={{ display: 'inline-flex' }}>
      <input type="checkbox" id={id} name={name} value={value} defaultChecked={checked} />
      <label htmlFor={id} className="pill" style={{ width: 'auto', height: 'auto', padding: '8px 14px' }}>
        {label}
      </label>
    </span>
  );
}

function PillRadio({
  name,
  value,
  label,
  checked,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
}) {
  const id = `${name}-${value}`;
  return (
    <span className="ratefield" style={{ display: 'inline-flex' }}>
      <input type="radio" id={id} name={name} value={value} defaultChecked={checked} />
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

export default async function SubmitConstraints({ searchParams }: Props) {
  const params = await searchParams;
  const draftId = first(params.draft) ?? '';
  const problem = first(params.problem);

  const draft = await myDraft(draftId);
  if (!draft) redirect('/maker');

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main id="main" className="shell submitpage">
        <SubmitSteps now="constraints" back={`/submit/problems?draft=${draft.id}`} saved />

        <SubmitEyebrow now="constraints" aside={draft.name} />
        <h1 className="h2" style={{ margin: '0 0 12px' }}>
          What’s true about it today?
        </h1>
        <p
          className="muted"
          style={{ margin: '0 0 28px', fontSize: 'var(--t-lead)', lineHeight: 'var(--lh-body)' }}
        >
          These are the constraints people search with, so a tick here is a filter somewhere. Only
          tick what is true today — people will tell you fast if something is off.
        </p>

        {problem ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            {problem}
          </p>
        ) : null}

        <form action={setConstraints}>
          <input type="hidden" name="draft" value={draft.id} />

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">Price</legend>
            <div style={GROUP}>
              {PRICING_MODELS.map((pricing) => (
                <PillRadio
                  key={pricing}
                  name="pricing"
                  value={pricing}
                  label={pricingLabel(pricing)}
                  checked={draft.pricing === pricing}
                />
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">Platforms</legend>
            <div style={GROUP}>
              {PLATFORMS.map((platform) => (
                <PillCheck
                  key={platform}
                  name="platforms"
                  value={platform}
                  label={platformLabel(platform)}
                  checked={draft.platforms.includes(platform)}
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
                <PillCheck
                  key={language}
                  name="languages"
                  value={language}
                  label={language}
                  checked={draft.languages.includes(language)}
                />
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="setrow-label">And these, if they are true</legend>
            <div style={GROUP}>
              {TOOL_FLAGS.map((flag) => (
                <PillCheck
                  key={flag}
                  name="flags"
                  value={flag}
                  label={flagLabel(flag)}
                  checked={draft.flags.includes(flag)}
                />
              ))}
            </div>
          </fieldset>

          <div className="panel panel-quiet" style={{ padding: 16 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)' }}>
              <Icon name="info" size={16} /> These are yes-or-no because search filters on them.
              “Works offline” means fully — if entries queue and sync later, leave it off and say so
              in the summary, or somebody searching for offline will be handed something that is
              not.
            </p>
          </div>

          <div className="submitfoot">
            <Link className="ghost" href={`/submit/problems?draft=${draft.id}`}>
              Back
            </Link>
            <button type="submit" className="btn btn-coral">
              Preview the listing
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
