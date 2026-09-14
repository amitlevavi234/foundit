/**
 * The fit scale — three bars, filled three, two or one.
 *
 * THE OWNER'S ITEM 2a, 14 September 2026. Results carry one of three words —
 * Strong, Possible, Loose — and the owner could not tell from the word how many
 * there were or which end of the scale he was looking at. A word has no
 * position. Three bars do: filled three, two or one, in that order, every time,
 * so "Possible" is visibly one notch below "Strong" rather than a different
 * kind of thing.
 *
 * WHAT IT IS NOT. It is not the fit meter (components/FitMeter.tsx) and it is
 * not a percentage. `docs/build-phases.md` forbids a rescaled similarity shown
 * as a number, and the reranker's four-point judgement is not a calibrated
 * probability — see `/ranking`. Three bars out of three is the same claim the
 * word already makes, drawn so it can be compared at a glance. The word stays
 * beside it: this is the shape of the word, never a replacement for it.
 *
 * It is only ever drawn for a judged band. A location band — which of a
 * listing's texts your words turned up in — is not a point on this scale, and
 * `lib/results.ts`'s `MatchBand` has no `steps` field so it cannot be given one
 * by accident.
 *
 * No script, no state, three spans. The colour comes from the band's own tone
 * class on the parent, so the scale is painted the same as the word beside it,
 * and it reads in greyscale because filled and empty are different shapes of
 * fill rather than two colours.
 */
export interface FitScaleProps {
  /** 3 Strong, 2 Possible, 1 Loose. */
  steps: 1 | 2 | 3;
  /** The word this scale is drawing, for the accessible name. */
  label: string;
}

export const FIT_STEPS = 3;

export function FitScale({ steps, label }: FitScaleProps) {
  return (
    <span
      className="fitscale"
      role="img"
      aria-label={`${label}: ${steps} of ${FIT_STEPS} on the fit scale.`}
    >
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= steps ? 'fitscale-on' : 'fitscale-off'} />
      ))}
    </span>
  );
}
