import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button, GhostButton } from './Button';
import { Icon } from './Icon';
import { Wordmark } from './Logo';

/**
 * The header, from `header()` in design/canvas/build.mjs. 84px tall, the
 * wordmark at 30px on the left, four targets on the right.
 *
 * Sign-in is Google and a 6-digit emailed code, and those are the only two
 * that exist anywhere in this codebase. docs/product-decisions.md §2 settles
 * which providers ship; the designed sign-in artboards were drawn before that
 * decision and show one more than the product has.
 *
 * Three of the four targets have nothing behind them yet. `Add a tool` is
 * Phase 7, `Saved` and `Sign in` are Phase 6 (docs/build-phases.md), and until
 * those phases run `/submit`, `/saved` and `/sign-in` are not routes — all
 * three were links to a 404. They stay in the header, because the artboards
 * draw them and because a person should be able to see what Foundit intends to
 * have; they are drawn in the disabled state the design already specifies,
 * with "Soon" beside them, so they read as *not yet* rather than as *broken*.
 * The sentence saying when is in the footer, where there is room for one.
 *
 * This is the choice the tool page already makes about claiming — "Claiming
 * opens when sign-in does" — rather than a control that pretends.
 */
export type HeaderSection = 'browse' | 'add' | 'saved' | 'top' | undefined;

export interface SiteHeaderProps {
  active?: HeaderSection;
}

export function SiteHeader({ active }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Wordmark />
      <nav aria-label="Main">
        <NavLink href="/browse" active={active === 'browse'}>
          Browse problems
        </NavLink>

        <NotYet note="Adding a tool arrives after accounts do.">Add a tool</NotYet>

        <NotYet note="Saved lists arrive with accounts.">
          <Icon name="bookmark" size={18} />
          Saved
        </NotYet>

        <Button size="sm" disabled style={{ marginLeft: 8 }}>
          Sign in
          <span className="soon" aria-hidden="true">
            Soon
          </span>
          <span className="sr-only">— not built yet. Signing in arrives with accounts.</span>
        </Button>
      </nav>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={active ? 'ghost on' : 'ghost'}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

/**
 * A header target whose screen has not been built yet.
 *
 * A `<button disabled>` and not a `<span>`: it is announced as a disabled
 * control rather than as stray text, it is left out of the tab order instead
 * of being a focus stop that does nothing, and it picks up `.ghost[disabled]`,
 * which the design already defines. The badge is the sighted reader's version
 * of the sentence and the `sr-only` line is everybody else's, so exactly one
 * of the two is read out.
 */
function NotYet({ note, children }: { note: string; children: ReactNode }) {
  return (
    <GhostButton disabled>
      {children}
      <span className="soon" aria-hidden="true">
        Soon
      </span>
      <span className="sr-only">— not built yet. {note}</span>
    </GhostButton>
  );
}
