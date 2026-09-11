import Link from 'next/link';

import { Wordmark } from './Logo';

/**
 * The footer, from `footer()` in design/canvas/build.mjs.
 *
 * The four links behind it — About, Guidelines, Contact, Privacy — were all
 * 404s. They are pages somebody has to sit down and write, and Privacy is not
 * optional before real users. Rather than dropping them out of the chrome or
 * inventing policy nobody has agreed to, each one is a real route that says
 * plainly it has not been written yet (docs/product-decisions.md §14).
 *
 * The line underneath is the other half of the same honesty: the header shows
 * Add a tool, Saved and Sign in, all three disabled, and this is the sentence
 * that says why. It sits here because it is a fact about the whole site rather
 * than about the page, and because the header has room for a badge and not for
 * a sentence.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-row">
        <Wordmark size={20} />
        <nav aria-label="Footer">
          <Link href="/about">About</Link>
          <Link href="/guidelines">Guidelines</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </div>
      <p className="site-footer-note">
        Foundit is still being built. Searching and browsing work; signing in, saved lists and
        adding a tool are not built yet and arrive together with accounts.
      </p>
    </footer>
  );
}
