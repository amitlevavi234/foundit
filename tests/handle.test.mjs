// ===========================================================================
// Where an @name comes from, which names nobody may have, and the one thing it
// must never be made of.
//
// Nobody is asked to choose a handle during sign-in — the sign-in screen is
// two controls and a sentence, and that is the whole of its value — so the
// first one is derived. It is also the only string in this product that is
// generated for a person and then shown to everybody, which is why it gets a
// test of its own.
//
// TWO THINGS THE PHASE 6 REVIEW ADDED TO THIS FILE.
//
//   F6, first half: there was no reserved list, so `admin`, `settings`, `api`,
//   `saved` and `browse` were all perfectly good handles. `@admin` on a review
//   byline is an impersonation of an operator.
//
//   F6, second half: the handle was derived from the LOCAL PART OF THE EMAIL
//   ADDRESS, so `amitlevavi234@gmail.com` became `@amitlevavi234` — a mailbox
//   name published on a page strangers read, beside everything that person has
//   reviewed. Nobody chose it and nobody was asked.
//
// THE RULE IS THE DATABASE'S. `profiles_handle_format` in
// db/migrations/0001_init.sql is the authority, and the pattern in
// lib/handle.ts is a transcription of it — so this file READS THE MIGRATION
// and fails if the two have drifted, rather than trusting a constant that was
// copied once. It reads `app/` for the same reason.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  HANDLE_WORDS,
  RESERVED_HANDLES,
  handleCandidates,
  handleStem,
  handleWithSuffix,
  isReservedHandle,
  neutralHandle,
  normalizeHandle,
} from '../lib/handle.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** A fake `Math.random`, so a collision can be watched rather than hoped for. */
function sequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('the pattern is the one the database will actually enforce', () => {
  const migration = readFileSync(join(ROOT, 'db', 'migrations', '0001_init.sql'), 'utf8');
  const check = /constraint profiles_handle_format check \(handle::text ~ '([^']+)'\)/.exec(
    migration,
  );
  assert.ok(check, 'profiles_handle_format must still be in 0001_init.sql');
  assert.equal(
    HANDLE_PATTERN.source,
    check[1],
    'lib/handle.ts and the CHECK constraint must be the same expression',
  );
  // And the ::text cast is load-bearing: citext's regex operators are
  // case-insensitive, so without it the CHECK cheerfully accepts `AmitL`.
  assert.match(check.input, /handle::text ~/);
});

/* ===========================================================================
 * The reserved list
 * ======================================================================== */

test('every reserved name is refused, typed or derived', () => {
  for (const name of RESERVED_HANDLES) {
    assert.ok(isReservedHandle(name), `${name} must be reserved`);
    assert.equal(normalizeHandle(name), null, `${name} must not be a handle somebody types`);
    assert.equal(normalizeHandle(`@${name}`), null);
    assert.equal(normalizeHandle(name.toUpperCase()), null, `nor ${name.toUpperCase()}`);
  }

  // The five the review named, spelled out, because a list is easy to shorten
  // and these are the ones that were actually accepted.
  for (const name of ['admin', 'settings', 'api', 'saved', 'browse']) {
    assert.equal(normalizeHandle(name), null, `${name} was accepted before the review`);
  }

  // And one character of deniability is not enough.
  for (const name of ['admin_support', 'admin_2', 'admin_billing']) {
    assert.ok(isReservedHandle(name));
    assert.equal(normalizeHandle(name), null);
  }
});

test('every first path segment under app/ is a name nobody can be called', () => {
  // Read from disk rather than listed here: a route added next month is a name
  // somebody could otherwise take, and this is what makes that a failing test
  // rather than a thing somebody remembers.
  const segments = readdirSync(join(ROOT, 'app'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('(') && !name.startsWith('_') && !name.startsWith('@'));

  assert.ok(segments.length > 10, 'the app directory should have more routes than this');
  for (const segment of segments) {
    assert.ok(
      isReservedHandle(segment),
      `app/${segment}/ is a route and must be in RESERVED_HANDLES`,
    );
  }
});

test('an ordinary name is not reserved, and reserved is not a synonym for short', () => {
  for (const name of ['noa', 'amit', 'priya_raman', 'tomer', 'maker_4821']) {
    assert.ok(!isReservedHandle(name), `${name} is somebody's name`);
    assert.equal(normalizeHandle(name), name);
  }
});

/* ===========================================================================
 * Where the default comes from — and where it does not
 * ======================================================================== */

test('THE EMAIL LOCAL PART IS NEVER USED, whatever is passed in', () => {
  // The function that used to take an address now refuses anything containing
  // an `@`, so a caller that still passes one gets a neutral handle rather
  // than `noa_example_com` — which would be the same mailbox published, in a
  // form that looks deliberate.
  assert.equal(handleStem('amitlevavi234@gmail.com'), null);
  assert.equal(handleStem('noa@example.com'), null);
  assert.equal(handleStem('Priya.Raman+foundit@example.co.uk'), null);

  for (const address of ['amitlevavi234@gmail.com', 'noa@example.com', 'a.b.c@example.com']) {
    const local = address.slice(0, address.indexOf('@')).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const candidate of handleCandidates(address, 20)) {
      assert.ok(
        !candidate.replace(/_/g, '').includes(local),
        `${address} produced ${candidate}, which is the mailbox name`,
      );
    }
  }
});

test('a name from the provider becomes a name', () => {
  assert.equal(handleStem('AMIT LEVAVI'), 'amit_levavi');
  assert.equal(handleStem('Noa'), 'noa');
  assert.equal(handleStem('  Priya Raman  '), 'priya_raman');
  assert.equal(handleStem('Jean-Luc'), 'jean_luc');
  assert.equal(handleStem('Al'), 'al_', 'padded to the three the CHECK needs');
});

test('a name in another script is not transliterated into a guess', () => {
  // A wrong transliteration of somebody's name is worse than no name. They are
  // asked to pick one in Settings, which is a better first conversation than
  // being told what they are called.
  assert.equal(handleStem('יוסי'), null);
  assert.equal(handleStem('юра'), null);
  assert.equal(handleStem('…'), null);
  assert.equal(handleStem(''), null);
  assert.equal(handleStem(null), null);
});

test('with no name at all — which is every emailed-code sign-in — it is a word and a number', () => {
  // Better Auth stores an empty `name` for an email-OTP sign-up, so this is
  // the common path and not the exotic one.
  for (const nothing of [null, '', '   ', 'יוסי', 'noa@example.com']) {
    const candidates = handleCandidates(nothing, 12);
    assert.ok(candidates.length > 0, `${nothing} produced no candidate at all`);
    for (const candidate of candidates) {
      assert.match(candidate, HANDLE_PATTERN);
      assert.match(candidate, /^[a-z]+_\d{4}$/, `${candidate} is not word_number`);
      assert.ok(HANDLE_WORDS.includes(candidate.split('_')[0]));
      assert.ok(!isReservedHandle(candidate));
    }
  }

  const fixed = neutralHandle(sequence([0, 0.5]));
  assert.equal(fixed, `${HANDLE_WORDS[0]}_5500`);
});

test('a name that is taken is suffixed, and a name that is reserved is not', () => {
  const candidates = handleCandidates('Amit Levavi', 4);
  assert.deepEqual(candidates.slice(0, 4), [
    'amit_levavi',
    'amit_levavi1',
    'amit_levavi2',
    'amit_levavi3',
  ]);

  // Somebody genuinely called Admin gets a neutral handle and an invitation to
  // pick one — not `admin2`, which is the same impersonation with a digit.
  for (const candidate of handleCandidates('Admin', 6)) {
    assert.ok(!candidate.startsWith('admin'), `${candidate} is still an operator's name`);
    assert.match(candidate, /^[a-z]+_\d{4}$/);
  }
  for (const candidate of handleCandidates('Support', 6)) {
    assert.ok(!isReservedHandle(candidate));
  }
});

test('every candidate for every input is one the database accepts', () => {
  const inputs = [
    'AMIT LEVAVI',
    'Noa',
    'Al',
    'A',
    '__',
    '...',
    'יוסי',
    'A VERY LONG NAME INDEED THAT GOES ON AND ON',
    'averyveryverylongnamewithnospaces',
    '12345',
    'admin',
    null,
    '',
    'noa@example.com',
  ];

  for (const input of inputs) {
    const candidates = handleCandidates(input, 60);
    assert.ok(candidates.length > 0, `${input} produced no candidate at all`);
    for (const candidate of candidates) {
      assert.match(candidate, HANDLE_PATTERN, `${input} -> ${candidate} is not a legal handle`);
      assert.ok(candidate.length >= HANDLE_MIN && candidate.length <= HANDLE_MAX);
      assert.ok(!isReservedHandle(candidate), `${input} -> ${candidate} is reserved`);
    }
    assert.equal(new Set(candidates).size, candidates.length, 'no candidate is offered twice');
  }
});

test('a long name makes room for its number rather than overflowing', () => {
  const long = 'a'.repeat(HANDLE_MAX);
  assert.equal(handleWithSuffix(long, 0), long);
  assert.equal(handleWithSuffix(long, 7).length, HANDLE_MAX);
  assert.equal(handleWithSuffix(long, 100).length, HANDLE_MAX);
  // And the trim takes trailing underscores with it, so nobody becomes
  // `some_name__2`.
  assert.equal(handleWithSuffix('some_name_______________', 2).endsWith('_2'), false);
});

test('a handle somebody types is cleaned or refused, never silently changed', () => {
  assert.equal(normalizeHandle('Amit'), 'amit');
  assert.equal(normalizeHandle('@amit'), 'amit');
  assert.equal(normalizeHandle('  amit  '), 'amit');
  assert.equal(normalizeHandle('amit_levavi'), 'amit_levavi');

  // Refused rather than mangled: being quietly renamed is worse than being
  // told no, because the @name is on every review they have written.
  assert.equal(normalizeHandle('am'), null, 'too short');
  assert.equal(normalizeHandle('a'.repeat(25)), null, 'too long');
  assert.equal(normalizeHandle('amit levavi'), null, 'a space is not a handle');
  assert.equal(normalizeHandle('amit-levavi'), null, 'nor is a dash');
  assert.equal(normalizeHandle('יוסי'), null);
  assert.equal(normalizeHandle(''), null);
  assert.equal(normalizeHandle(null), null);
});
