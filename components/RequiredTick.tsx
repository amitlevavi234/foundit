'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * The one required tick, and the Continue it holds shut.
 *
 * `SubmitRelationship.dc.html` draws a clickable card with an unchecked box and
 * a Continue button that is DISABLED — grey arrow, no shadow — and
 * docs/product-decisions.md §3 states the rule it draws: "step one of the add
 * flow is a single required tick — 'Yes, I made this tool' — and Continue stays
 * disabled until it is ticked."
 *
 * THE ONLY CLIENT COMPONENT IN THE SUBMIT FLOW, and it is one because there is
 * no way to un-disable a button in CSS. Everything else on these screens is a
 * server component posting a form to a Server Action.
 *
 * IT WORKS WITH NO JAVASCRIPT, which needs saying because a disabled button
 * that only JavaScript can enable would otherwise be a dead end. Three layers,
 * and each is enough on its own:
 *
 *   1. The checkbox is `required`, so a browser with no JavaScript refuses to
 *      submit the form without it and says so in its own words.
 *   2. `<noscript>` carries a second Continue that is not disabled, because
 *      layer 1 is what guards it there.
 *   3. The Server Action refuses a POST without the tick whatever the page
 *      looked like, and refuses it with the tick's own sentence
 *      (app/submit/actions.ts).
 *
 * So the server-rendered HTML contains `disabled` — which is what the gate
 * asks to see, and what tests/screens.test.mjs checks — and a person who has
 * switched JavaScript off can still add their tool.
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
  const [ticked, setTicked] = useState(false);

  return (
    <>
      <label className="card hov" style={{ display: 'block', cursor: 'pointer', padding: 22 }}>
        <span style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            name="made"
            value="yes"
            required
            checked={ticked}
            onChange={(event) => setTicked(event.currentTarget.checked)}
            className="check"
          />
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
        <button type="submit" className="btn btn-coral" disabled={!ticked}>
          {action}
          <Icon name="arrow" size={18} />
        </button>
      </div>

      <noscript>
        <div className="submitfoot" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
          <button type="submit" className="btn btn-coral">
            {action}
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </noscript>
    </>
  );
}
