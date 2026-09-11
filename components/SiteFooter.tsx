import Link from 'next/link';

import { Wordmark } from './Logo';

/**
 * The footer, from `footer()` in design/canvas/build.mjs — with one departure
 * from the artboards, which draw a single row of four links.
 *
 * The page list grew from four to thirteen (docs/product-decisions.md §14): a
 * real site owes its users Terms, a cookie notice, an accessibility statement,
 * a page explaining how it ranks the products it ranks, pricing while it is
 * still free, a security page, a copyright route, a reporting route and a help
 * page. Thirteen links in one row is not a footer, it is a pile, so they sit in
 * three labelled columns — what Foundit is, what the community does, and the
 * legal set — which is the ordinary shape and the one people scan without being
 * taught it.
 *
 * Every one of those pages is currently an `UnwrittenPage`: a real route that
 * says plainly it has not been written and what it will cover, inventing no
 * policy, promise or address, and `noindex`. The alternative — linking nothing
 * until somebody writes them — hides a gap rather than closing it.
 *
 * The line underneath is the other half of the same honesty: the header shows
 * Add a tool, Saved and Sign in, all three disabled, and this is the sentence
 * that says why. It sits here because it is a fact about the whole site rather
 * than about the page, and because the header has room for a badge and not for
 * a sentence.
 */
const COLUMNS = [
  {
    id: 'footer-foundit',
    heading: 'Foundit',
    links: [
      { href: '/about', label: 'About' },
      { href: '/ranking', label: 'How the fit score works' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/help', label: 'Help' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    id: 'footer-community',
    heading: 'Community',
    links: [
      { href: '/guidelines', label: 'Guidelines' },
      { href: '/report', label: 'Report a problem' },
      { href: '/copyright', label: 'Copyright' },
    ],
  },
  {
    id: 'footer-legal',
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/cookies', label: 'Cookies' },
      { href: '/accessibility', label: 'Accessibility' },
      { href: '/security', label: 'Security' },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-row">
        <Wordmark size={20} />

        <div className="site-footer-cols">
          {COLUMNS.map((column) => (
            <nav key={column.id} className="site-footer-col" aria-labelledby={column.id}>
              <h2 id={column.id} className="site-footer-head">
                {column.heading}
              </h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <p className="site-footer-note">
        Foundit is still being built. Searching and browsing work; signing in, saved lists and
        adding a tool are not built yet and arrive together with accounts. Every page linked above
        says plainly whether it has been written.
      </p>
    </footer>
  );
}
