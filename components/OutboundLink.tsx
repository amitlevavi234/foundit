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
 */
export interface OutboundLinkProps {
  url: string | null | undefined;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Hide the trailing external-link glyph. The default is to show it. */
  hideIcon?: boolean;
}

export function OutboundButton({
  url,
  children,
  variant = 'coral',
  size = 'md',
  className,
  hideIcon = false,
}: OutboundLinkProps) {
  const link = outboundLink(url);
  if (!link) return null;

  return (
    <a
      href={link.href}
      target={link.target}
      rel={link.rel}
      className={buttonClassName(variant, size, className)}
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
