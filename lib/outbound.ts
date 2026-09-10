/**
 * Links out to the maker's own site.
 *
 * docs/product-decisions.md §12: every result and every tool page carries a
 * link to the address the maker entered. It opens in a new tab so Foundit
 * stays where it was, it shows the domain beside it so people can see where
 * they are going before they go, it accepts `https` and nothing else, and it
 * carries `rel="noopener noreferrer"` so the opened page cannot reach back
 * into ours.
 *
 * The browser opening a link is not the same as our server fetching one. This
 * module produces an anchor's attributes and never performs a request: no
 * favicon fetch, no preview scrape, no image loader pointed at the address.
 */

export interface OutboundLink {
  href: string;
  /** Always. A visitor should never lose their results by following a link. */
  target: '_blank';
  /**
   * Always. `noopener` stops the opened page reaching back through
   * `window.opener`; `noreferrer` stops it learning what someone searched for
   * on the way in.
   */
  rel: 'noopener noreferrer';
  /** What to show beside the button, e.g. "splitwise.com". */
  domain: string;
}

/**
 * Build the attributes for one outbound link, or `null` if the address is not
 * something we are willing to render.
 *
 * Rejects anything that is not `https:` — that includes `http:`, `javascript:`,
 * `data:` and a protocol-relative `//host`, none of which may reach an `href`.
 */
export function outboundLink(url: string | null | undefined): OutboundLink | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;

  return {
    href: parsed.toString(),
    target: '_blank',
    rel: 'noopener noreferrer',
    domain: displayDomain(parsed),
  };
}

/** The hostname as a person reads it: no scheme, no `www.`, no trailing dot. */
export function displayDomain(url: URL | string): string {
  const host = typeof url === 'string' ? safeHostname(url) : url.hostname;
  return host.replace(/\.$/, '').replace(/^www\./, '');
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
