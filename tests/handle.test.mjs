// ===========================================================================
// Where an @name comes from, and why it can never be one the database refuses.
//
// Nobody is asked to choose a handle during sign-in — the sign-in screen is
// two controls and a sentence, and that is the whole of its value — so the
// first one is derived from the address they signed in with. It is also the
// only string in this product that is generated for a person and then shown to
// everybody, which is why it gets a test of its own.
//
// THE RULE IS THE DATABASE'S. `profiles_handle_format` in
// db/migrations/0001_init.sql is the authority, and the pattern in
// lib/handle.ts is a transcription of it — so this file READS THE MIGRATION
// and fails if the two have drifted, rather than trusting a constant that was
// copied once.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HANDLE_FALLBACK,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  handleCandidates,
  handleStem,
  handleWithSuffix,
  normalizeHandle,
} from '../lib/handle.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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

test('an ordinary address becomes an ordinary name', () => {
  assert.equal(handleStem('noa@example.com'), 'noa');
  assert.equal(handleStem('amit.levavi@gmail.com'), 'amit_levavi');
  assert.equal(handleStem('Priya.Raman+foundit@example.co.uk'), 'priya_raman_foundit');
  assert.equal(handleStem('a-b-c@example.com'), 'a_b_c');
});

test('a name in another script is not transliterated into a guess', () => {
  // A wrong transliteration of somebody's name is worse than no name. They are
  // asked to pick one in Settings, which is a better first conversation than
  // being told what they are called.
  assert.equal(handleStem('יוסי@example.com'), HANDLE_FALLBACK);
  assert.equal(handleStem('юра@example.com'), HANDLE_FALLBACK);
  assert.equal(handleStem('…@example.com'), HANDLE_FALLBACK);
  assert.equal(handleStem(''), HANDLE_FALLBACK);
  assert.equal(handleStem(null), HANDLE_FALLBACK);
});

test('every candidate for every address is one the database accepts', () => {
  const addresses = [
    'noa@example.com',
    'al@example.com',
    'a@example.com',
    '__@example.com',
    '...@example.com',
    'יוסי@example.com',
    'A.VERY.LONG.NAME.INDEED.THAT.GOES.ON@example.com',
    'averyveryverylongaddresswithnodots@example.com',
    '12345@example.com',
    'no-at-sign-at-all',
    '@example.com',
  ];

  for (const address of addresses) {
    const candidates = handleCandidates(address, 120);
    assert.ok(candidates.length > 0, `${address} produced no candidate at all`);
    for (const candidate of candidates) {
      assert.match(candidate, HANDLE_PATTERN, `${address} -> ${candidate} is not a legal handle`);
      assert.ok(candidate.length >= HANDLE_MIN && candidate.length <= HANDLE_MAX);
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
