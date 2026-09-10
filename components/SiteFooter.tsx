import Link from 'next/link';

import { Wordmark } from './Logo';

/** The footer, from `footer()` in design/canvas/build.mjs. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Wordmark size={20} />
      <nav aria-label="Footer">
        <Link href="/about">About</Link>
        <Link href="/guidelines">Guidelines</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </footer>
  );
}
