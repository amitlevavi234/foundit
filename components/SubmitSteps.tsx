import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * The submit flow's chrome: the way back, the step rail, and the autosave note.
 *
 * From the strip every submit artboard draws under the header —
 * SubmitRelationship, SubmitURL, SubmitDetails, SubmitTool,
 * SubmitConstraints, SubmitPreview. Three columns: `Back` on the left, the rail
 * in the middle, "Draft saved, continue anytime" on the right.
 *
 * FIVE NODES, SIX SCREENS. The rail the artboards draw has five labels — URL,
 * Details, Problems, Constraints, Preview — and the flow has a sixth screen in
 * front of them: `SubmitRelationship`, whose eyebrow is "Before we start"
 * rather than "Step 0 of 5". So the gate is a step of the flow and is not a
 * node on the rail, which is what the artboards say and what
 * docs/product-decisions.md §3 means by "step one of the add flow is a single
 * required tick".
 *
 * THE AUTOSAVE NOTE ONLY APPEARS WHERE IT IS TRUE. The draft row is created at
 * the Details step, because `tools.summary` has a 20-character minimum and
 * there is nothing honest to put in it before somebody has written one. So the
 * first two screens carry no note — which is also what the artboards draw:
 * `SubmitRelationship`'s right-hand slot is empty.
 *
 * Nothing here links out and nothing here fetches. `Back` is a real link to a
 * real route, never `history.back()`, for the reason
 * docs/product-decisions.md §14 gives: a page opened from a link somebody sent
 * has no history to go back to.
 */
export const SUBMIT_STEPS = [
  { key: 'url', label: 'URL', href: '/submit/url' },
  { key: 'details', label: 'Details', href: '/submit/details' },
  { key: 'problems', label: 'Problems', href: '/submit/problems' },
  { key: 'constraints', label: 'Constraints', href: '/submit/constraints' },
  { key: 'preview', label: 'Preview', href: '/submit/preview' },
] as const;

export type SubmitStepKey = (typeof SUBMIT_STEPS)[number]['key'];

export interface SubmitStepsProps {
  /** Which node is current. The gate passes 'url', which shows nothing done. */
  now: SubmitStepKey;
  /** Where `Back` goes. A route, always. */
  back: string;
  /** True once there is a draft row behind the flow. */
  saved?: boolean;
}

export function SubmitSteps({ now, back, saved = false }: SubmitStepsProps) {
  const current = SUBMIT_STEPS.findIndex((step) => step.key === now);

  return (
    <div className="submitstrip">
      <Link href={back} className="ghost submitstrip-back">
        <Icon name="back" size={18} />
        Back
      </Link>

      <ol className="step" aria-label={`Step ${current + 1} of ${SUBMIT_STEPS.length}`}>
        {SUBMIT_STEPS.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'now' : 'todo';
          return (
            <li key={step.key} className={`step-node ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="step-dot" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <span className="step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="submitstrip-saved">
        {saved ? (
          <>
            <Icon name="check" size={16} />
            Draft saved, continue anytime
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The eyebrow every numbered step carries: "Step 3 of 5 · Receiptly".
 *
 * The tool's name is in it from the Details step onwards because that is when
 * there is one; before that the artboards show the domain instead, and the
 * gate shows neither.
 */
export function SubmitEyebrow({ now, aside }: { now: SubmitStepKey; aside?: string }) {
  const index = SUBMIT_STEPS.findIndex((step) => step.key === now);
  return (
    <p className="tab muted submit-eyebrow">
      Step {index + 1} of {SUBMIT_STEPS.length}
      {aside ? ` · ${aside}` : ''}
    </p>
  );
}

/** The footer row every numbered step carries: Back on the left, Continue right. */
export function SubmitFooter({ children }: { children: ReactNode }) {
  return <div className="submitfoot">{children}</div>;
}
