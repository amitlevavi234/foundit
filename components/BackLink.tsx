import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * The way back, on every screen below the homepage.
 *
 * The control is the artboards' own: `<a class="ghost">←  Back</a>`, sitting
 * on its own row under the header at `justify-self: start` — see the row
 * `submitShell()` and `SubmitTool.dc.html` draw in design/canvas/build.mjs.
 * Nothing new is invented here; only the label is, because the artboard's
 * "Back" is a wireframe word and a person needs to know where back *is*.
 *
 * It is a link to a place, never `history.back()`. A results page opened from
 * a link somebody sent has no history to go back to, and a control that does
 * nothing on some arrivals is worse than no control; the browser's own Back
 * button already covers the case where there is a history. So every caller
 * passes the page this one sits under, and the tool page passes the search
 * that found it when the URL carries one.
 *
 * It is an anchor, so it is in the tab order and takes the `:focus-visible`
 * ring from styles/base.css like everything else.
 */
export interface BackLinkProps {
  /** Where this page sits. A real route, not a referrer. */
  href: string;
  /** Names the destination: "All results", "Browse problems", "Home". */
  children: ReactNode;
}

export function BackLink({ href, children }: BackLinkProps) {
  return (
    <div className="shell backrow">
      <Link href={href} className="ghost backlink">
        <Icon name="back" size={16} />
        {children}
      </Link>
    </div>
  );
}
