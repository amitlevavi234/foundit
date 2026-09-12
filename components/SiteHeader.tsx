import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/app/sign-in/actions';
import { currentViewer } from '@/lib/accounts';

import { ButtonLink, GhostButton } from './Button';
import { Icon } from './Icon';
import { Wordmark } from './Logo';

/**
 * The header, from `header()` in design/canvas/build.mjs. 84px tall, the
 * wordmark at 30px on the left, four targets on the right.
 *
 * THREE OF THE FOUR WERE DISABLED UNTIL THIS PHASE and two of them are now
 * real. `Saved` and `Sign in` have screens behind them; `Add a tool` is Phase 7
 * and keeps the drawn-but-disabled treatment with its "Soon" badge, which is
 * what docs/product-decisions.md §14 settled: a control whose screen is a later
 * phase stays drawn and is disabled in place, because taking it out would hide
 * a plan that is real and a control that cannot be clicked beats one that can
 * be clicked and breaks.
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

        <NotYet note="Adding a tool arrives with the maker dashboard.">Add a tool</NotYet>

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
