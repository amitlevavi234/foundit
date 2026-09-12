import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/app/sign-in/actions';
import { currentViewer } from '@/lib/accounts';

import { ButtonLink } from './Button';
import { Icon } from './Icon';
import { Wordmark } from './Logo';

/**
 * The header, from `header()` in design/canvas/build.mjs. 84px tall, the
 * wordmark at 30px on the left, four targets on the right.
 *
 * ALL FOUR ARE REAL NOW. Three of them were disabled in place until Phase 6,
 * and `Add a tool` was the last one left — it kept the "Soon" badge
 * docs/product-decisions.md §14 specified for a control whose screen is a later
 * phase. Phase 7 built the screen, so the badge is gone and the control is a
 * link, and the `NotYet` helper that drew it is gone with it — a dead
 * component is not documentation. §14's rule still stands and the shape it
 * asks for is in this file's history: a `<button disabled>` rather than a
 * `<span>`, so it is announced as a disabled control and left out of the tab
 * order, with a `Soon` badge for sighted readers and an `sr-only` sentence for
 * everybody else.
 *
 * SIGNED IN, THE RIGHT-HAND CONTROL BECOMES THE AVATAR MENU the artboards draw
 * — and it is a native `<details>`, so it opens from the keyboard, announces
 * its own state, and needs no JavaScript. Sign out is a form posting to a
 * Server Action rather than a link, because signing out is a change and a
 * change is never a GET: a link would be followed by every preloader and
 * antivirus proxy that walks a page.
 *
 * READING THE SESSION MAKES EVERY PAGE THAT CARRIES THIS HEADER PER-PERSON,
 * which is why the pages carrying it declare `dynamic = 'force-dynamic'`. What
 * is cached is the catalogue underneath (lib/db.ts), not the page, and nothing
 * that ran with somebody's identity ever goes in that cache.
 */
export type HeaderSection = 'browse' | 'add' | 'saved' | 'top' | undefined;

export interface SiteHeaderProps {
  active?: HeaderSection;
  /**
   * Draw the signed-out header without asking who this is.
   *
   * For the two places that cannot ask: `loading.tsx`, which is a still frame
   * rendered before anything is known, and `not-found.tsx`, which Next
   * pre-renders at build time where there is no request to read a session
   * from. Both are momentary and neither carries anything personal.
   */
  anonymous?: boolean;
}

export async function SiteHeader({ active, anonymous = false }: SiteHeaderProps) {
  const viewer = anonymous ? null : await currentViewer();

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

        {viewer ? (
          <AccountMenu handle={viewer.handle} displayName={viewer.displayName} />
        ) : (
          <ButtonLink href="/sign-in" size="sm" style={{ marginLeft: 8 }}>
            Sign in
          </ButtonLink>
        )}
      </nav>
    </header>
  );
}

/**
 * The header on the sign-in screens themselves.
 *
 * No Sign in control, because it is the page, and no Saved, because Saved is
 * where they are being sent afterwards. Synchronous: this screen has already
 * established that nobody is signed in.
 */
export function SignInHeader() {
  return (
    <header className="site-header">
      <Wordmark />
      <nav aria-label="Main">
        <NavLink href="/browse" active={false}>
          Browse problems
        </NavLink>
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
 * The avatar and its menu.
 *
 * The avatar is an initial on a coloured ground, not a photograph. Google
 * hands us a picture URL with the profile and storing it would mean every page
 * this header appears on asking Google's CDN for a file — which is a visitor's
 * browser telling a third party where they are, on every page, for a decoration.
 * docs/product-decisions.md §12's distinction is about our server fetching a
 * URL; this is the neighbouring one, and the answer is the same shape: draw it
 * ourselves.
 */
function AccountMenu({ handle, displayName }: { handle: string; displayName: string | null }) {
  const name = displayName?.trim() || `@${handle}`;
  const initial = (displayName?.trim() || handle).slice(0, 1).toUpperCase();

  return (
    <details className="accountmenu">
      <summary aria-label={`Account menu for ${name}`}>
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      <div className="accountmenu-sheet">
        <div className="accountmenu-who">
          <strong>{name}</strong>
          <span className="faint tab">@{handle}</span>
        </div>
        <Link href="/saved">Saved</Link>
        <Link href={`/u/${handle}`}>Your public profile</Link>
        <Link href="/settings">Settings</Link>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}
