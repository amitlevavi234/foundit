// ===========================================================================
// The calibration's arithmetic, on data whose answer is known.
//
// eval/calibrate.mjs cannot be tested against reality, because the reality it
// needs — 200 pairs a person has judged — does not exist yet. That is the whole
// point of the file. What CAN be tested, and is the part that would be believed
// if the file ever ran, is the fitter: give it data generated from coefficients
// we chose, and see whether it recovers them.
//
// A calibration nobody can check is exactly the kind of number this project
// refuses to print, so this is not optional scaffolding.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_JUDGED,
  bucketOf,
  calibrationCurve,
  featuresOf,
  fitLogistic,
  logLoss,
  parseJudged,
  predict,
  sigmoid,
} from '../eval/calibrate.mjs';

/* --- the pieces ----------------------------------------------------------- */

test('the sigmoid is a sigmoid, and does not overflow at either end', () => {
  assert.equal(sigmoid(0), 0.5);
  assert.ok(sigmoid(10) > 0.9999);
  assert.ok(sigmoid(-10) < 0.0001);
  assert.equal(sigmoid(1000), 1);
  assert.equal(sigmoid(-1000), 0);
  assert.ok(Number.isFinite(sigmoid(-1000)));
});

test('the features are the intercept, the relevance, and the nDCG discount', () => {
  assert.deepEqual(featuresOf({ relevance: 3, rank: 1 }), [1, 3, 1]);
  assert.deepEqual(featuresOf({ relevance: 0, rank: 3 }), [1, 0, 2]);
  // Rank 1 gets log2(2) = 1, the same discount nDCG applies at the same place.
  assert.equal(featuresOf({ relevance: 0, rank: 1 })[2], 1);
});

test('a rank falls into the largest bucket at or below it', () => {
  const ranks = [1, 2, 3, 5, 8, 12];
  assert.equal(bucketOf(1, ranks), 1);
  assert.equal(bucketOf(4, ranks), 3);
  assert.equal(bucketOf(7, ranks), 5);
  assert.equal(bucketOf(20, ranks), 12);
});

/* --- the fit -------------------------------------------------------------- */

/** A deterministic pseudo-random source, so a failure is reproducible. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Synthetic pairs from coefficients we chose.
 *
 * For each (relevance, rank) the true probability is sigmoid(b0 + b1*rel +
 * b2*log2(rank+1)); a label is drawn from it. With enough draws the fitter
 * should come back with something close to b.
 */
function synthesise(truth, n, seed = 42) {
  const random = lcg(seed);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const relevance = Math.floor(random() * 4);
    const rank = 1 + Math.floor(random() * 20);
    const features = featuresOf({ relevance, rank });
    let z = 0;
    for (let j = 0; j < truth.length; j += 1) z += truth[j] * features[j];
    const label = random() < sigmoid(z) ? 1 : 0;
    rows.push({ relevance, rank, label, features });
  }
  return rows;
}

test('it recovers the coefficients it was given', () => {
  // A relevance of 3 should be strongly positive, a 0 strongly negative, and a
  // worse rank mildly negative — which is what these three numbers say.
  const truth = [-3.2, 1.9, -0.35];
  const rows = synthesise(truth, 8000);
  const fit = fitLogistic(rows);

  for (let j = 0; j < truth.length; j += 1) {
    assert.ok(
      Math.abs(fit.coefficients[j] - truth[j]) < 0.35,
      `coefficient ${j}: fitted ${fit.coefficients[j].toFixed(3)} against a true ${truth[j]}`,
    );
  }

  // And the fit is better than saying "the base rate" for everybody, which is
  // the null model a calibration has to beat to be worth drawing.
  const base = rows.filter((r) => r.label === 1).length / rows.length;
  const nullLoss = -(base * Math.log(base) + (1 - base) * Math.log(1 - base));
  assert.ok(fit.logLoss < nullLoss - 0.05, `fit ${fit.logLoss.toFixed(4)} against null ${nullLoss.toFixed(4)}`);
});

test('the fitted probabilities move the way the features say they should', () => {
  const truth = [-3.2, 1.9, -0.35];
  const fit = fitLogistic(synthesise(truth, 8000));

  const atRank1 = [0, 1, 2, 3].map((relevance) => predict(fit.coefficients, { relevance, rank: 1 }));
  for (let i = 1; i < atRank1.length; i += 1) {
    assert.ok(atRank1[i] > atRank1[i - 1], 'a higher relevance must not predict a lower probability');
  }

  const atRelevance3 = [1, 5, 20].map((rank) => predict(fit.coefficients, { relevance: 3, rank }));
  for (let i = 1; i < atRelevance3.length; i += 1) {
    assert.ok(atRelevance3[i] < atRelevance3[i - 1], 'a worse rank must not predict a higher probability');
  }
});

test('the curve reports what actually happened beside what the model says', () => {
  const truth = [-2.0, 1.5, -0.3];
  const rows = synthesise(truth, 4000, 7);
  const fit = fitLogistic(rows);
  const curve = calibrationCurve(rows, fit.coefficients);

  assert.equal(curve.length, 4 * 6, 'four relevance grades by six rank buckets');

  // Where a cell has enough observations, the fitted and observed numbers must
  // agree — that is what "calibrated" means, and a curve whose two columns
  // disagree is the thing this column exists to show.
  const populated = curve.filter((p) => p.n >= 60);
  assert.ok(populated.length >= 8, 'the synthetic set should populate most cells');
  for (const point of populated) {
    assert.ok(
      Math.abs(point.fitted - point.observed) < 0.12,
      `relevance ${point.relevance} rank ${point.rank}: fitted ${point.fitted.toFixed(3)} ` +
        `against observed ${point.observed.toFixed(3)} over ${point.n}`,
    );
  }

  // An empty cell reports null rather than a number, because zero out of zero
  // is not zero.
  const empty = calibrationCurve([], fit.coefficients);
  assert.ok(empty.every((p) => p.observed === null && p.n === 0));
});

test('log loss is the thing being minimised, and it notices a worse model', () => {
  const rows = synthesise([-3.2, 1.9, -0.35], 2000, 11);
  const fit = fitLogistic(rows);
  const worse = fit.coefficients.map((b) => -b);
  assert.ok(logLoss(rows, fit.coefficients) < logLoss(rows, worse));
});

/* --- the file it reads ---------------------------------------------------- */

test('the judged file is parsed strictly, and every problem names its line', () => {
  const good = [
    '{"query":"split a bill","slug":"splitwise","label":1,"judge":"amit","judged_at":"2026-10-01"}',
    '# a comment',
    '',
    '{"query":"split a bill","slug":"gimp","label":0,"judge":"amit","judged_at":"2026-10-01"}',
    // The same pair judged by a SECOND person is evidence, not a duplicate.
    '{"query":"split a bill","slug":"gimp","label":1,"judge":"dana","judged_at":"2026-10-02"}',
  ].join('\n');
  const parsed = parseJudged(good);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].judgedAt, '2026-10-01');

  const bad = [
    'not json',
    '[]',
    '{"slug":"x","label":1,"judge":"a","judged_at":"b"}',
    '{"query":"q","slug":"x","label":2,"judge":"a","judged_at":"b"}',
    '{"query":"q","slug":"x","label":1,"judge":"a","judged_at":"b"}',
    '{"query":"q","slug":"x","label":0,"judge":"a","judged_at":"b"}',
  ].join('\n');
  const refused = parseJudged(bad);
  assert.equal(refused.rows.length, 1, 'only the one good line survives');
  assert.equal(refused.errors.length, 5);
  for (const error of refused.errors) assert.match(error, /^line \d+/);
  assert.match(refused.errors[2], /missing "query"/);
  assert.match(refused.errors[3], /"label" must be 0 or 1/);
  assert.match(refused.errors[4], /judged \(x\) for this sentence twice/);
});

test('the floor is the phase goal’s number, and it is a floor', () => {
  assert.equal(MIN_JUDGED, 200);
});

test('it refuses to fit nothing', () => {
  assert.throws(() => fitLogistic([]), /nothing to fit/);
});
