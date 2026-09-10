import type { CSSProperties } from 'react';

import { clampFit, EMPHASIS_AT, fitBandLabel, fitNumeral, fitWidth } from '@/lib/fit';

/**
 * The fit meter — the signature element on Components.dc.html.
 *
 * "A gradient meter from violet through coral to lime, with the numeral riding
 * its end and counting up."
 *
 * All of the motion is CSS. There is no timer, no requestAnimationFrame and no
 * state: the component renders two custom properties, `--w` for the width and
 * `--t` for the target numeral, and the stylesheet does the rest. That is why
 * it works in a server component, why it costs nothing on a cold page, and why
 * `prefers-reduced-motion` can switch it off wholesale without leaving a meter
 * stuck at zero — the keyframes fill `both`, so a 0.01ms animation lands on its
 * final frame.
 *
 * The number is supplied, never derived from the search score. That number is
 * an ordering value, not a percentage, and rescaling it would be a lie.
 *
 * Nothing in the running product has such a number yet, so no screen draws
 * this meter over a real result: the caption is the whole claim, and until
 * Phase 5 there is nothing to caption. It is kept, and shown as a specimen on
 * /components, because the calibration it is waiting for is a scheduled piece
 * of work rather than an abandoned one.
 */
export interface FitMeterProps {
  /** 0 to 100. Values outside the range are clamped rather than overflowing. */
  fit: number;
  /** Overrides the band wording. Defaults to strong / partial / weak match. */
  label?: string;
  /**
   * What the number is about. It is the claim the meter makes — in the product
   * it will be "Fits what you asked"; on a sheet showing the component with an
   * invented number it must say so instead, because the same numerals under
   * that caption are an assertion about a tool. It captions the accessible
   * name too, so the two cannot drift apart.
   */
  caption?: string;
  /** Set false on a page where the meter's caption is already stated above it. */
  showCaption?: boolean;
  className?: string;
  style?: CSSProperties;
}

type MeterVars = CSSProperties & { '--w': string; '--t': number };

export function FitMeter({
  fit,
  label,
  caption = 'Fits what you asked',
  showCaption = true,
  className,
  style,
}: FitMeterProps) {
  const value = clampFit(fit);
  const width = fitWidth(value);
  const numeral = fitNumeral(value);
  const band = label ?? fitBandLabel(value);

  const vars: MeterVars = { '--w': width, '--t': numeral };

  return (
    <div className={['fm', className].filter(Boolean).join(' ')} style={style}>
      {showCaption ? (
        <div className="fm-label">
          {caption}
          <span className={value >= EMPHASIS_AT ? 'fm-band fm-band-strong' : 'fm-band'}>
            {band}
          </span>
        </div>
      ) : null}
      <div
        className="meter"
        style={vars}
        role="img"
        aria-label={`${caption}: ${numeral} out of 100 — ${band}.`}
      >
        <div className="fill" style={{ '--w': width } as CSSProperties} />
        <div className="badge count tab" aria-hidden="true" />
      </div>
    </div>
  );
}
