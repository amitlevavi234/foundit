'use client';

import type { ReactNode } from 'react';

import { buttonClassName, type ButtonSize, type ButtonVariant } from './Button';
import { Icon } from './Icon';
import { outboundLink } from '@/lib/outbound';

/**
 * The link out to the maker's own site — "Open Splitwise" on the tool page.
 *
 * This is the whole point of a recommendation, and it is the only anchor in
 * the codebase that points at an address a stranger supplied. Everything about
 * it is fixed by docs/product-decisions.md §12 and none of it is a prop:
 *
 *   - `target="_blank"`, so Foundit stays where it was;
 *   - `rel="noopener noreferrer"`, so the opened page cannot reach back into
 *     ours and does not learn what was searched for on the way;
 *   - `https` only — anything else renders nothing at all;
 *   - the domain shown beside it, so people can see where they are going.
 *
 * The visitor's browser makes that request. Our server never does.
 *
 * WHY THIS IS A CLIENT COMPONENT SINCE PHASE 8, and what that bought.
 * §12 has said since 10 September that the click is counted, and it was not:
 * `tools.open_count` had no writer anywhere in the codebase and the maker
 * dashboard drew 0 on every listing and said so rather than inventing a
 * figure. Counting it needs the click to reach our server, and there are only
 * two ways to do that: send the visitor through a redirect of ours, or leave
 * the anchor pointing straight at the maker and tell the server separately.
 *
 * THIS IS THE SECOND, deliberately. A redirect would mean the href on every
 * result card was a Foundit URL — so the status bar would stop telling people
 * where they are going, a copied link would be ours rather than the maker's,
 * and a person with JavaScript off would be routed through us for a counter.
 * Instead the `href` is exactly what it was, and `onClick` posts to `/o`
 * beside it. Never awaited: the new tab is already opening and nobody waits on
 * bookkeeping (lib/db.ts's rule about the search log, applied to a click).
 *
 * IT POSTS TO `/o` AND NOT TO THE TOOL PAGE, and that is the Phase 8 review's
 * F5. Phase 8 used a Server Action, and a Server Action posts to the URL of
 * the page it is on — so every counted click was `POST /tools/<slug>` in the
 * request line of every access log in front of the application, beside the
 * visitor's address and a timestamp. The function logged nothing; the
 * transport logged everything. `/o` is one character, the same for every
 * listing, and the slug travels in the body where no access log will carry it.
 * app/o/route.ts is the whole of the reasoning, including why it answers 204
 * to everybody and how it is bounded.
 *
 * WHAT THE BEACON CARRIES: the slug, and nothing else. No cookie is read, no
 * address is sent, and `public.record_tool_open` underneath it has no second
 * argument to give it. Two people opening the same listing are the same
 * statement.
 *
 * `keepalive` so the request survives the page being left behind, and the
 * promise is dropped on the floor: there is nothing a failed count should do
 * to somebody who is on their way to a maker's site.
 *
 * WITH JAVASCRIPT OFF, THE LINK STILL WORKS AND THE CLICK IS NOT COUNTED.
 * That is the right way round: the recommendation is the product and the
 * counter is a number on a dashboard, so the counter is what degrades.
 */
export interface OutboundLinkProps {
  url: string | null | undefined;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Hide the trailing external-link glyph. The default is to show it. */
  hideIcon?: boolean;
  /**
   * The listing this link is on, so the click can be counted.
   *
   * Optional, because the component sheet at /components renders three of
   * these to show the rule and none of them is a listing. Absent, nothing is
   * counted and the link is exactly what it always was.
   */
  slug?: string;
}

/**
 * Tell the server a listing was opened. One POST, one field, no answer read.
 *
 * `catch(() => {})` rather than nothing at all, because an unhandled rejection
 * in a browser is a console error on a page somebody is using, and the route
 * answers 204 to everything so there is never anything here worth reporting.
 */
function beacon(slug: string): void {
  try {
    void fetch('/o', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // A browser with no fetch is a browser that opens the link and counts
    // nothing, which is the same thing JavaScript being off does.
  }
}

export function OutboundButton({
  url,
  children,
  variant = 'coral',
  size = 'md',
  className,
  hideIcon = false,
  slug,
}: OutboundLinkProps) {
  const link = outboundLink(url);
  if (!link) return null;

  return (
    <a
      href={link.href}
      target={link.target}
      rel={link.rel}
      className={buttonClassName(variant, size, className)}
      onClick={slug ? () => beacon(slug) : undefined}
    >
      {children}
      {hideIcon ? null : (
        <Icon
          name="external"
          size={16}
          color={variant === 'coral' || variant === 'violet' ? 'var(--c-on-fill)' : 'currentColor'}
        />
      )}
      <span className="sr-only">(opens {link.domain} in a new tab)</span>
    </a>
  );
}

/**
 * The domain caption that sits under or beside the button.
 *
 * Its type and colour live in `.outbound-domain` rather than in an inline
 * style, because it also has to be told how to behave when there is not enough
 * room for it — a caption that cannot shrink is a caption that goes over the
 * edge of whatever is holding it.
 */
export function OutboundDomain({ url }: { url: string | null | undefined }) {
  const link = outboundLink(url);
  if (!link) return null;
  return <span className="tab outbound-domain">{link.domain}</span>;
}
