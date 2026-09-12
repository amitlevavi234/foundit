// ===========================================================================
// What a read of auth_core.verification is worth to somebody who has it.
//
// The Phase 6 review's F3. `storeOTP: 'hashed'` is Better Auth's
// `defaultKeyHasher` — `base64url(sha256(otp))`, no salt, no key, no work
// factor — and a 6-digit code is a search space of 10^6. The reviewer swept it
// in 2,838 ms on one core and read the code back out, which made the sentence
// this project had written next to the hash ("anybody with a backup or a read
// would not be able to sign in as whoever is waiting for it") untrue.
//
// So the test is the sweep itself, run both ways. It is the slowest file in
// this suite by some distance — two million digests — and that is the point:
// the claim is about how long a search takes, so the test has to take it.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

import { OTP_LENGTH, hashSignInCode, schemaOptions } from '../lib/auth-options.ts';

/** Better Auth's own hasher, reproduced from node_modules/better-auth. */
const defaultKeyHasher = (otp) => createHash('sha256').update(otp).digest('base64url');

const SPACE = 10 ** OTP_LENGTH;
const CODE = '482915';

/** Run `fn` with BETTER_AUTH_SECRET set to `secret`, then put it back. */
async function withSecret(secret, fn) {
  const saved = process.env.BETTER_AUTH_SECRET;
  try {
    if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = secret;
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = saved;
  }
}

/** Every 6-digit code, until one of them hashes to `target` under `hash`. */
function sweep(target, hash) {
  for (let n = 0; n < SPACE; n += 1) {
    const candidate = String(n).padStart(OTP_LENGTH, '0');
    if (hash(candidate) === target) return candidate;
  }
  return null;
}

test('the plugin is configured with a hash of ours, not the library’s', () => {
  const otp = schemaOptions().plugins[0].options;
  assert.equal(typeof otp.storeOTP, 'object', 'storeOTP is the object form, not a keyword');
  assert.equal(typeof otp.storeOTP.hash, 'function');
  assert.notEqual(otp.storeOTP, 'hashed');
  assert.equal(otp.storeOTP.hash, hashSignInCode, 'and it is the function this file drives');
});

test('the stored value is NOT base64url(sha256(code))', async () => {
  await withSecret('a-secret-nobody-outside-this-process-has', async () => {
    const stored = await hashSignInCode(CODE);
    assert.notEqual(stored, defaultKeyHasher(CODE), 'that digest is the one F3 reversed');
    // base64url, because Better Auth appends `:<attempts>` and splits on the
    // last colon. A digest containing one would eat the attempt counter.
    assert.match(stored, /^[A-Za-z0-9_-]+$/);
    assert.ok(!stored.includes(':'));
  });
});

test('two codes give two digests, and two keys give two digests for one code', async () => {
  const one = await withSecret('key-one', () => hashSignInCode(CODE));
  const other = await withSecret('key-one', () => hashSignInCode('482916'));
  const sameCodeOtherKey = await withSecret('key-two', () => hashSignInCode(CODE));

  assert.notEqual(one, other, 'two codes under one key');
  assert.notEqual(one, sameCodeOtherKey, 'one code under two keys');
  assert.equal(one, await withSecret('key-one', () => hashSignInCode(CODE)), 'and it is stable');

  // Which is what makes verification work at all: the library compares the
  // hash of what was typed against the stored string, in constant time.
  assert.equal(
    one,
    createHmac('sha256', 'key-one').update(CODE, 'utf8').digest('base64url'),
    'HMAC-SHA256 over the code, keyed by the secret',
  );
});

test('AN EMPTY SECRET IS REFUSED RATHER THAN USED', async () => {
  // An HMAC under an empty key is an unkeyed hash with a better name — which
  // is exactly the thing this replaced, arrived at by accident.
  await withSecret(undefined, async () => {
    await assert.rejects(hashSignInCode(CODE), /BETTER_AUTH_SECRET is required/);
  });
  await withSecret('   ', async () => {
    await assert.rejects(hashSignInCode(CODE), /BETTER_AUTH_SECRET is required/);
  });
});

test('THE SWEEP THAT READ THE CODE OUT NO LONGER READS ANYTHING OUT', async () => {
  // (a) The finding, reproduced: against the library's own hasher, the whole
  //     space is searched and the code falls out.
  const unkeyed = defaultKeyHasher(CODE);
  const started = Date.now();
  assert.equal(sweep(unkeyed, defaultKeyHasher), CODE, 'F3, as reported');
  const took = Date.now() - started;
  assert.ok(took < 60_000, `the space is small: ${took} ms for up to ${SPACE} digests`);

  // (b) The row as it is stored now, swept the same way by somebody who has
  //     the row and NOT the secret. Every one of the million candidates is
  //     checked and none of them matches.
  const stored = await withSecret('the-secret-this-deployment-uses', () => hashSignInCode(CODE));
  assert.equal(
    sweep(stored, defaultKeyHasher),
    null,
    'a read without the secret must recover nothing',
  );

  // (c) And the same sweep by somebody who HAS the secret still finds it in
  //     seconds — which is why the five-minute expiry and the three-attempt
  //     cap are the security of the scheme and the hash is defence in depth.
  const keyed = (candidate) =>
    createHmac('sha256', 'the-secret-this-deployment-uses').update(candidate, 'utf8').digest('base64url');
  assert.equal(sweep(stored, keyed), CODE, 'the hash is not a work factor and does not claim to be');
});
