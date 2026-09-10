import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The button, as drawn on Components.dc.html:
 * "Hover moves 2px into the shadow, press lands flat. 44px minimum height."
 *
 * Variants: the default white one, coral (the action colour), violet
 * (structure), lime (reward), tint, and a danger variant that is ink on white
 * with red type — destructive actions are never a red block.
 *
 * Disabled is a real state, not a dimmed one: sunk fill, faint type, quiet
 * border, no shadow, and the press is switched off so it cannot pretend to
 * respond.
 */
export type ButtonVariant = 'default' | 'coral' | 'violet' | 'lime' | 'tint' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'xs';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: '',
  coral: 'btn-coral',
  violet: 'btn-violet',
  lime: 'btn-lime',
  tint: 'btn-tint',
  danger: 'btn-danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: '',
  sm: 'btn-sm',
  xs: 'btn-xs',
};

export function buttonClassName(
  variant: ButtonVariant = 'default',
  size: ButtonSize = 'md',
  extra?: string,
): string {
  return ['btn', VARIANT_CLASS[variant], SIZE_CLASS[size], extra].filter(Boolean).join(' ');
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  className?: string;
}

export type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = 'default',
  size = 'md',
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, className)}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A button that navigates. Same chrome, an anchor underneath, so it keeps
 * middle-click, "open in new tab" and the browser's own status bar.
 *
 * For links out to a maker's site use `OutboundButton` instead — it is the
 * only thing that may set `target` and `rel`.
 */
export type ButtonLinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

export function ButtonLink({
  variant = 'default',
  size = 'md',
  className,
  children,
  href,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClassName(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

/**
 * A button with no chrome until you touch it. "Not now", "Skip", the header's
 * navigation. `tall` raises it to the 44px minimum where it sits beside a
 * full-size button.
 */
export type GhostButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tall?: boolean;
  active?: boolean;
  children?: ReactNode;
};

export function GhostButton({
  tall = false,
  active = false,
  className,
  children,
  type = 'button',
  ...rest
}: GhostButtonProps) {
  const cls = ['ghost', tall ? 'ghost-tall' : '', active ? 'on' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
