import type { FitBand } from './types';

/**
 * The fit meter's arithmetic.
 *
 * A deliberate non-feature: nothing here turns `ToolResult.score` into a fit.
 * That number is a Reciprocal Rank Fusion sum — an ordering number, not a
 * probability — and rescaling it into "92% fit" would be a lie the interface
 * tells with a straight face. db/migrations/0002_search.sql says so in the
 * function's own comment, and docs/build-phases.md Phase 5 makes the
 * calibration a separate, measured step. Until that exists, a fit is supplied
 * by whatever produced it and this module only draws it.
 */

export const FIT_MIN = 0;
export const FIT_MAX = 100;

/**
 * Band thresholds, read off the artboards: 92 and 86 are drawn as "strong
 * match", 74 as "partial match", 48 as "weak match".
 */
export const STRONG_AT = 80;
export const PARTIAL_AT = 55;

/** Above this the band label is inked rather than muted — meter() in build.mjs. */
export const EMPHASIS_AT = 90;

/**
 * Clamp a fit to 0..100. A value outside the range, or one that is not a
 * number at all, becomes 0 rather than a meter that overflows its track.
 */
export function clampFit(fit: number): number {
  if (!Number.isFinite(fit)) return FIT_MIN;
  if (fit < FIT_MIN) return FIT_MIN;
  if (fit > FIT_MAX) return FIT_MAX;
  return fit;
}

/**
 * The meter's `--w`: the width of the fill, and the position the numeral
 * badge travels to. One value drives both, so they cannot disagree.
 */
export function fitWidth(fit: number): string {
  return `${clampFit(fit)}%`;
}

/** The numeral shown in the badge — a whole number, never a decimal. */
export function fitNumeral(fit: number): number {
  return Math.round(clampFit(fit));
}

export function fitBand(fit: number): FitBand {
  const f = clampFit(fit);
  if (f >= STRONG_AT) return 'strong';
  if (f >= PARTIAL_AT) return 'partial';
  return 'weak';
}

export function fitBandLabel(fit: number): string {
  switch (fitBand(fit)) {
    case 'strong':
      return 'strong match';
    case 'partial':
      return 'partial match';
    default:
      return 'weak match';
  }
}
