import { ICON_PATHS } from './Icon';

/**
 * Five stars, filled to a rating — `stars()` in design/canvas/build.mjs.
 *
 * Filled is coral with an ink outline, empty is a quiet outline and no fill,
 * so the rating reads in greyscale and at a glance. The number is also
 * written out beside it everywhere this is used; the stars are the shape of
 * the number, never the only statement of it.
 */
export interface StarsProps {
  rating: number;
  size?: number;
  /** What a screen reader says. Omit where the number is already in the text. */
  label?: string;
}

export function Stars({ rating, size = 15, label }: StarsProps) {
  const filled = Math.round(rating);

  return (
    <span className="stars" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={i <= filled ? 'var(--c-coral)' : 'none'}
          stroke={i <= filled ? 'var(--c-ink)' : 'var(--c-rule)'}
          strokeWidth="2"
          strokeLinejoin="round"
          focusable="false"
        >
          <path d={ICON_PATHS.star} />
        </svg>
      ))}
    </span>
  );
}
