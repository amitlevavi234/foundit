import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubmitEyebrow, SubmitSteps } from '@/components/SubmitSteps';
import { myDraft } from '@/lib/maker';
import { STATEMENTS_MAX, STATEMENT_MAX } from '@/lib/submit';

import { setProblems } from '../actions';

/* ===========================================================================
 * Step 4 — SubmitTool.dc.html. "What problems does this solve?"
 *
 * The most important screen in the flow, because this is the column search
 * matches against: 0001's comment on `tool_problems` calls it "the semantic
 * unit of the whole product", and a listing with no statement is a listing
 * nobody can find — which is why `public.publish_tool` refuses one.
 *
 * THE ASIDE THE ARTBOARD DRAWS IS NOT BUILT, and this is the one deferral on
 * these screens worth being blunt about. "People searching for this would find
 * you" shows three real searches from the last 30 days that would match what
 * is being typed, with a strength label. To do it honestly would mean running
 * the reranker against the person's half-written sentence on every keystroke —
 * a paid call, from an endpoint nobody has rate-limited, on text that changes
 * five times a second — and to do it dishonestly would mean showing plausible
 * numbers. So the panel says what it will say later, and the page keeps the
 * one piece of advice the aside was really carrying: describe the situation,
 * not the feature.
 *
 * EIGHT ROWS, THREE SHOWN. `public.statements_max()` is 8. The artboard draws
 * three, the first required; the rest appear as fast as somebody fills them,
 * with no JavaScript, because they are all in the HTML from the start.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Add a tool — the problems it solves',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const PLACEHOLDERS = [
  'e.g. Splitting a restaurant bill when everyone ordered different things',
  'e.g. Keeping track of shared groceries in a flat by photographing the receipt',
  'e.g. Settling up in a currency that isn’t your own',
];

export default async function SubmitProblems({ searchParams }: Props) {
  const params = await searchParams;
  const draftId = first(params.draft) ?? '';
  const problem = first(params.problem);

  // "Not yours" and "not there" are the same answer, and the answer is the
  // maker's own page rather than a message that tells somebody which it was.
  const draft = await myDraft(draftId);
  if (!draft) redirect('/maker');

  const existing = draft.statements;

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main id="main" className="shell submitpage">
        <SubmitSteps now="problems" back="/submit/details" saved />

        <SubmitEyebrow now="problems" aside={draft.name} />
        <h1 className="h2" style={{ margin: '0 0 12px' }}>
          What problems does this solve?
        </h1>
        <p
          className="muted"
          style={{ margin: '0 0 28px', fontSize: 'var(--t-lead)', lineHeight: 'var(--lh-body)' }}
        >
          Write like someone describing their situation, in a sentence. This is what people
          actually search. The first is required; two more make you findable from more angles.
        </p>

        {problem ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            {problem}
          </p>
        ) : null}

        <form action={setProblems}>
          <input type="hidden" name="draft" value={draft.id} />

          {[...Array(STATEMENTS_MAX).keys()].map((index) => {
            // Rows beyond the third are drawn only when there is something in
            // them or the one before it is filled, so the page is three fields
            // and not eight — and every row is still in the HTML the moment it
            // is reachable, with no JavaScript deciding.
            const value = existing[index] ?? '';
            const show = index < 3 || value !== '' || existing.length > index;
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
                    required={index === 0}
                    placeholder={PLACEHOLDERS[index] ?? 'Another situation it fits'}
                    className="field area"
                    style={{ width: '100%' }}
                  />
                </span>
              </div>
            );
          })}

          <p className="muted" style={{ fontSize: 'var(--t-micro)', marginTop: 4 }}>
            Up to {STATEMENTS_MAX}, at most {STATEMENT_MAX} characters each. Save this step and the
            next row appears.
          </p>

          <div className="panel panel-tint" style={{ padding: 16, marginTop: 22 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)' }}>
              <Icon name="info" size={16} /> Describe the situation, not the feature. “Splitting a
              bill unevenly” gets found. “Smart itemised splitting engine” doesn’t.
            </p>
          </div>

          <div className="panel panel-quiet" style={{ padding: 16, marginTop: 14 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)' }}>
              <strong>A live “searches that would find you” panel is not built.</strong> Doing it
              honestly means matching your half-written sentence against real searches as you type,
              which is a paid model call per keystroke; doing it any other way means showing you
              numbers we made up. Once this is live it appears on your dashboard, where the searches
              are real and already counted.
            </p>
          </div>

          <div className="submitfoot">
            <Link className="ghost" href="/submit/details">
              Back
            </Link>
            <button type="submit" className="btn btn-coral">
              Continue to constraints
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
