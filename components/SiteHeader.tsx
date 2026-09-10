import Link from 'next/link';
import type { ReactNode } from 'react';

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
        <NavLink href="/submit" active={active === 'add'}>
          Add a tool
        </NavLink>
        <NavLink href="/saved" active={active === 'saved'}>
          <Icon name="bookmark" size={18} />
          Saved
        </NavLink>
        <Link href="/sign-in" className="btn btn-sm" style={{ marginLeft: 8 }}>
          Sign in
        </Link>
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
