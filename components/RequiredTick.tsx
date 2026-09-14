import type { ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * The one required tick, and the Continue beside it.
 *
 * `SubmitRelationship.dc.html` draws a clickable card with an unchecked box and
 * a Continue button that is DISABLED — grey arrow, no shadow — and
 * docs/product-decisions.md §3 states the rule it draws: "step one of the add
 * flow is a single required tick — 'Yes, I made this tool' — and Continue stays
 * disabled until it is ticked."
 *
 * THE `disabled` ATTRIBUTE IS GONE, AND THE RULE IT DREW IS NOT — the owner's
 * item 6, 14 September 2026. It was a client component for one reason: there is
 * no way to un-disable a button in CSS, so a `useState` had to. That made the
 * Continue button the one control on the add flow that a person could not use
 * until the route's client bundle had compiled and hydrated — 15 to 29 seconds
 * on `next dev`, which is exactly when the owner pressed it. A button that is
 * dead until script arrives is worse than a button that opens a browser's own
 * refusal, and the refusal was already there twice over:
 *
 *   1. The checkbox is `required`, so the browser refuses to submit the form
 *      without it and says so in its own words, next to the box, with no
 *      script involved at all.
 *   2. The Server Action refuses a POST without the tick whatever the page
 *      looked like, and refuses it with the tick's own sentence
 *      (app/submit/actions.ts).
 *
 * The `<noscript>` duplicate went with the `disabled` attribute: it existed to
 * put an enabled button in front of a person with no JavaScript, and now there
 * is only ever one button and it is always enabled. This is a server component
 * again — the submit flow has no client component left in it.
 */
export interface RequiredTickProps {
  /** The label on the card. The artboard's exact words. */
  title: string;
  /** The sentence under it. */
  children: ReactNode;
  /** The submit button's label. */
  action: string;
}

export function RequiredTick({ title, children, action }: RequiredTickProps) {
  return (
    <>
      <label className="card hov" style={{ display: 'block', cursor: 'pointer', padding: 22 }}>
        <span style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <input type="checkbox" name="made" value="yes" required className="check" />
          <span>
            <strong style={{ display: 'block', fontSize: 'var(--t-body-lg)' }}>{title}</strong>
            <span
              style={{
                display: 'block',
                marginTop: 6,
                color: 'var(--c-muted)',
                fontSize: 'var(--t-body-sm)',
                lineHeight: 'var(--lh-body)',
              }}
            >
              {children}
            </span>
          </span>
        </span>
      </label>

      <div className="submitfoot" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-coral">
          {action}
          <Icon name="arrow" size={18} />
        </button>
      </div>
    </>
  );
}
