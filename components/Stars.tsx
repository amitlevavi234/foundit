import { ICON_PATHS } from './Icon';

/**
 * Five stars, filled to a rating — `stars()` in design/canvas/build.mjs.
 *
 * Filled is coral with an ink outline, empty is a quiet outline and no fill,
 * so the rating reads in greyscale and at a glance. The number is also
 * written out beside it everywhere this is used; the stars are the shape of
 * the number, never the only statement of it.
 *
 * ---------------------------------------------------------------------------
 * THE DRAWING NEVER CLAIMS MORE THAN THE NUMBER BESIDE IT — OWNER FEEDBACK,
 * ROUND 1, F10.
 *
 * This was `Math.round(rating)`, which is the obvious thing and is wrong in the
 * one direction that matters. `tabsplit` has two reviews averaging 4.5; the
 * page printed "4.5" and drew FIVE FILLED STARS, which is what 5.0 looks like,
 * and 3.5 and 4.4 were both drawn as four. The screen-reader name was right in
 * every case — only the picture lied, to the people reading the picture.
 *
 * So a star is filled when the rating reaches it whole, and the star after the
 * last full one is HALF filled when the rating is at least half way past it.
 * 4.5 is four full and one half; 4.4 is four; 4.9 is four and a half, never
 * five. Rounding up to a star nobody earned is the one thing this must not do,
 * because five stars is a claim people read off a page in a quarter of a
 * second and never check.
 *
 * ---------------------------------------------------------------------------
 * HOW THE HALF IS DRAWN, because the obvious two ways are both worse.
 *
 * A NESTED `<svg>`, which establishes its own viewport and therefore CLIPS. The
 * inner one is twelve of the twenty-four units wide with a matching `viewBox`,
 * so the coral copy of the same path is drawn in the same coordinates and
 * simply stops half way across.
 *
 * Not a `<clipPath>`, because that needs an `id`, an id has to be unique in the
 * document, and a page of twelve cards renders twelve of these — which in a
 * Server Component means no `useId`, since hooks do not run there. Not a
 * `clip-path: inset()` either: Safari before 16.4 ignores it on an SVG child
 * and would draw a FULL coral star, which is the exact defect this is fixing,
 * in the one browser nobody testing it would be using.
 */
export interface StarsProps {
  rating: number;
  size?: number;
  /** What a screen reader says. Omit where the number is already in the text. */
  label?: string;
}

/**
 * Whole stars, and whether the one after them is drawn as a half.
 *
 * Exported because `tests/card.test.mjs` walks it across the range, and because
 * the rule is easier to read as arithmetic than as JSX.
 */
export function starFill(rating: number): { full: number; half: boolean } {
  const value = Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : 0;
  const full = Math.floor(value);
  // `>= 0.5` and not `> 0.5`: 4.5 is the case this exists for. There is no
  // sixth star, so five and a bit is five.
  return { full, half: full < 5 && value - full >= 0.5 };
}

export function Stars({ rating, size = 15, label }: StarsProps) {
  const { full, half } = starFill(rating);

  return (
    <span className="stars" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {[1, 2, 3, 4, 5].map((i) => {
        const isFull = i <= full;
        const isHalf = !isFull && half && i === full + 1;
        return (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={isFull ? 'var(--c-coral)' : 'none'}
            // A half star's outline is ink, like a full one: the star is there,
            // it is the fill that is partial.
            stroke={isFull || isHalf ? 'var(--c-ink)' : 'var(--c-rule)'}
            strokeWidth="2"
            strokeLinejoin="round"
            focusable="false"
          >
            <path d={ICON_PATHS.star} />
            {isHalf ? (
              <svg x="0" y="0" width="12" height="24" viewBox="0 0 12 24">
                <path d={ICON_PATHS.star} fill="var(--c-coral)" stroke="none" />
              </svg>
            ) : null}
          </svg>
        );
      })}
    </span>
  );
}
