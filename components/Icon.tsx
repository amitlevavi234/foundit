import type { CSSProperties, ReactNode } from 'react';

/**
 * The icon set, verbatim from the `P` object in design/canvas/build.mjs.
 *
 * Drawn rather than loaded: one 24x24 grid, stroked in `currentColor`, so an
 * icon takes the colour of whatever it sits in and there is no icon font, no
 * sprite request and nothing to shift as it arrives.
 */
export const ICON_PATHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  bookmark: 'M6 4h12v17l-6-4-6 4z',
  heart: 'M12 20.5l-7.4-7.6a4.4 4.4 0 0 1 6.2-6.2L12 7.9l1.2-1.2a4.4 4.4 0 0 1 6.2 6.2z',
  check: 'M5 12l5 5 9-10',
  dash: 'M6 12h12',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 5h5v5M19 5l-8 8M18 14v5H5V6h5',
  chevron: 'M6 9l6 6 6-6',
  chevronR: 'M9 6l6 6-6 6',
  filter: 'M4 6h16M7 12h10M10 18h4',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  star: 'M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.7l-5.9 3.2 1.2-6.6L2.5 9.7l6.6-.9z',
  edit: 'M4 20h4l11-11-4-4L4 16z',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
} as const;

/** Icons whose shape needs more than one element. */
const COMPOUND: Partial<Record<IconName, ReactNode>> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M20 16l-5-5-7 8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  dup: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
};

export type IconName =
  | keyof typeof ICON_PATHS
  | 'search'
  | 'info'
  | 'clock'
  | 'grid'
  | 'share'
  | 'more'
  | 'image'
  | 'shield'
  | 'mail'
  | 'bell'
  | 'lock'
  | 'user'
  | 'dup';

export interface IconProps {
  name: IconName;
  size?: number;
  /** Defaults to `currentColor`, which is nearly always what you want. */
  color?: string;
  strokeWidth?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
}

export function Icon({
  name,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.75,
  fill = 'none',
  style,
  className,
}: IconProps) {
  const compound = COMPOUND[name];
  const path = (ICON_PATHS as Record<string, string | undefined>)[name];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none', ...style }}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {compound ?? (path ? <path d={path} /> : null)}
    </svg>
  );
}
