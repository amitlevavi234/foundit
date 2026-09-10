import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * Chips, in the three families the component sheet separates.
 *
 * Constraint chip — what we understood from the sentence, and removable.
 *   filled  = the person said it
 *   dashed  = we inferred it
 *   struck  = they turned it off
 * All three read without colour, which is the point: greyscale, a colour-blind
 * reader and a screenshot all still show the difference.
 *
 * Satisfaction chip — whether one result meets one constraint. Met is tinted
 * violet with a check; unmet is neutral with a dash, never red. Missing a
 * constraint is information, not an error.
 *
 * Tag — a neutral fact about a tool. No judgement in it at all.
 */

export type ChipState = 'explicit' | 'inferred' | 'plain' | 'removed';

const STATE_CLASS: Record<ChipState, string> = {
  explicit: 'on',
  inferred: 'soft',
  plain: 'flat',
  removed: 'off',
};

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: ReactNode;
  state?: ChipState;
  small?: boolean;
  /** Show the dismiss cross. Set `onRemove` to make it do something. */
  removable?: boolean;
  onRemove?: () => void;
  children?: ReactNode;
}

export function Chip({
  label,
  state = 'plain',
  small = true,
  removable = false,
  onRemove,
  className,
  type = 'button',
  children,
  ...rest
}: ChipProps) {
  const cls = ['pill', small ? 'sm' : '', STATE_CLASS[state], className].filter(Boolean).join(' ');
  const crossColour = state === 'explicit' ? 'var(--c-on-fill)' : 'currentColor';

  return (
    <button
      type={type}
      className={cls}
      onClick={removable && onRemove ? onRemove : rest.onClick}
      {...rest}
    >
      {label}
      {children}
      {removable ? (
        <>
          <Icon name="x" size={14} color={crossColour} strokeWidth={2.25} />
          <span className="sr-only">Remove this constraint</span>
        </>
      ) : null}
    </button>
  );
}

/**
 * A chip that navigates: the category filters on browse and top, and the
 * constraint chips on results, whose cross removes the constraint by going to
 * the same search without it.
 *
 * An anchor rather than a button on purpose. The whole of Phase 2's interface
 * is server-rendered and every state it can be in is a URL, so filtering and
 * un-filtering work with JavaScript switched off, can be opened in a new tab,
 * and leave something to link to.
 */
export interface ChipLinkProps {
  href: string;
  label: ReactNode;
  state?: ChipState;
  small?: boolean;
  /** Draws the cross. The link itself is what removes the constraint. */
  removable?: boolean;
  /** What the cross means, for a screen reader: "Search without Free". */
  removeLabel?: string;
  current?: boolean;
  title?: string;
  className?: string;
}

export function ChipLink({
  href,
  label,
  state = 'plain',
  small = true,
  removable = false,
  removeLabel,
  current = false,
  title,
  className,
}: ChipLinkProps) {
  const cls = ['pill', small ? 'sm' : '', STATE_CLASS[state], className].filter(Boolean).join(' ');
  const crossColour = state === 'explicit' ? 'var(--c-on-fill)' : 'currentColor';

  return (
    <Link
      href={href}
      className={cls}
      title={title}
      aria-current={current ? 'page' : undefined}
      style={{ textDecoration: 'none' }}
    >
      {label}
      {removable ? (
        <>
          <Icon name="x" size={14} color={crossColour} strokeWidth={2.25} />
          <span className="sr-only">{removeLabel ?? 'Remove this constraint'}</span>
        </>
      ) : null}
    </Link>
  );
}

/** The "+ Add a constraint" chip. Same family, an addition rather than a state. */
export function AddChip({
  label = 'Add a constraint',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) {
  return (
    <button type="button" className="pill sm flat" {...rest}>
      <Icon name="plus" size={16} strokeWidth={2.25} />
      {label}
    </button>
  );
}

export interface SatisfactionChipProps {
  label: ReactNode;
  met: boolean;
}

export function SatisfactionChip({ label, met }: SatisfactionChipProps) {
  return (
    <span className={met ? 'sat' : 'sat unmet'}>
      <Icon name={met ? 'check' : 'dash'} size={14} strokeWidth={2.25} />
      <span className="sr-only">{met ? 'Meets: ' : 'Does not meet: '}</span>
      {label}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}
