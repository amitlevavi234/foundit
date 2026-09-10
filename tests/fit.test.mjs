// ===========================================================================
// The fit meter's arithmetic.
//
// One number drives the width of the fill and the position of the numeral. If
// they ever disagree the meter lies about itself, and the fit score is the one
// thing on a result the product asks people to trust.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampFit,
  fitWidth,
  fitNumeral,
  fitBand,
  fitBandLabel,
  STRONG_AT,
  PARTIAL_AT,
} from '../lib/fit.ts';

test('a fit becomes the width of its fill', () => {
  assert.equal(fitWidth(92), '92%');
  assert.equal(fitWidth(74), '74%');
  assert.equal(fitWidth(48), '48%');
  assert.equal(fitWidth(0), '0%');
  assert.equal(fitWidth(100), '100%');
});

test('a fit outside the range is clamped, never allowed to overflow the track', () => {
  assert.equal(fitWidth(140), '100%');
  assert.equal(fitWidth(-20), '0%');
  assert.equal(clampFit(Number.NaN), 0);
  assert.equal(clampFit(Number.POSITIVE_INFINITY), 0);
});

test('the numeral is whole, and matches the width it rides on', () => {
  assert.equal(fitNumeral(91.6), 92);
  assert.equal(fitNumeral(48.2), 48);
  // The badge travels to --w and shows --t. They must describe the same fit.
  const fit = 73.5;
  assert.equal(fitWidth(fit), '73.5%');
  assert.equal(fitNumeral(fit), 74);
});

test('bands match the ones drawn on the artboards', () => {
  assert.equal(fitBandLabel(92), 'strong match');
  assert.equal(fitBandLabel(86), 'strong match');
  assert.equal(fitBandLabel(74), 'partial match');
  assert.equal(fitBandLabel(48), 'weak match');
});

test('band boundaries are inclusive at the bottom', () => {
  assert.equal(fitBand(STRONG_AT), 'strong');
  assert.equal(fitBand(STRONG_AT - 0.1), 'partial');
  assert.equal(fitBand(PARTIAL_AT), 'partial');
  assert.equal(fitBand(PARTIAL_AT - 0.1), 'weak');
});

test('a partial match must look like a partial match', () => {
  // The honesty rule from docs/product-decisions.md §6, as arithmetic: a 74
  // may not round, clamp or band its way into looking like a 92.
  assert.notEqual(fitBand(74), fitBand(92));
  assert.ok(Number.parseFloat(fitWidth(74)) < Number.parseFloat(fitWidth(92)));
});
