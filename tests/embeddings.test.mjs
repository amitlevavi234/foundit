// ===========================================================================
// The one module that opens a socket, and the one string it has to agree with
// PostgreSQL about.
//
// Two different kinds of thing are checked here, and both break silently:
//
//   1. THE CACHE KEY. `public.normalize_query` in the database and
//      `normalizeQuery` in TypeScript have to produce the same string for the
//      same sentence, or the query-embedding cache misses on a difference
//      nobody meant and every search pays for an API call it had already paid
//      for. The two are separate implementations on purpose — the database
//      cannot call the TypeScript and the TypeScript must not need a round
//      trip to normalise a string — so the only thing keeping them in step is
//      this file.
//
//      Twenty sentences, with the expected output of each taken from the
//      DATABASE rather than from the function under test. They cover Hebrew,
//      Russian, mixed case, runs of spaces, tabs and newlines, the 200-character
//      cap, and the cap landing in the middle of a string of astral characters
//      (where PostgreSQL counts code points and JavaScript's `.slice` would
//      count UTF-16 units and cut an emoji in half).
//
//      With DATABASE_URL set, every one of them is ALSO run through the real
//      SQL function, so the fixture cannot rot: if somebody edits
//      `public.normalize_query` in a later migration, this fails.
//
//   2. THE FAILURE MODE. With no key, `embedQuery` returns null, logs exactly
//      one line, and that line carries neither the key nor the query. Search
//      then runs text-only and the page renders — which is the whole of the
//      Phase 3 degradation promise, and it is tested here rather than
//      described, because "it degrades gracefully" is the sort of claim that is
//      true until the day it is not.
//
// Nothing in this file makes a network request. The one test that would is the
// one that proves the key is absent.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMBEDDINGS_BATCH_SIZE,
  EMBEDDINGS_TIMEOUT_MS,
  EMBEDDINGS_URL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EmbeddingError,
  MAX_EMBEDDING_INPUT,
  embedQuery,
  embedTexts,
  embeddingsConfigured,
  normalizeQuery,
  toVectorLiteral,
} from '../lib/embeddings.ts';

/**
 * Twenty sentences and what `public.normalize_query` makes of each.
 *
 * The right-hand side was produced by the database, not by the function these
 * tests exercise. Copying the implementation's own output into a fixture would
 * prove only that the implementation equals itself.
 */
const NORMALISED = [
  ['split a bill', 'split a bill'],
  ['  Split   a  BILL  ', 'split a bill'],
  ['SPLIT A BILL', 'split a bill'],
  [
    'אפליקציה חינמית לחלוקת הוצאות בין חברים בטיול',
    'אפליקציה חינמית לחלוקת הוצאות בין חברים בטיול',
  ],
  ['   אפליקציה   חינמית   ', 'אפליקציה חינמית'],
  ['Программа для разделения счёта', 'программа для разделения счёта'],
  ['tab\tseparated\twords', 'tab separated words'],
  ['line\nbreaks\nhere', 'line breaks here'],
  // The one wart, pinned on purpose. The normalisation is the search_events
  // trigger's, and that one trims before it collapses whitespace rather than
  // after — so a sentence beginning with a tab keys with a leading space. It
  // is why query_embeddings' CHECK constraint does not require a trimmed key.
  ['\t  mixed \n whitespace \r\n runs  \t', ' mixed whitespace runs '],
  ['   ', ''],
  ['', ''],
  ['a'.repeat(250), 'a'.repeat(200)],
  // 300 characters of "x " capped at 200, which lands on a space, which the
  // second trim then removes: 100 x's and 99 spaces.
  ['x '.repeat(150), `${'x '.repeat(99)}x`],
  ['Ünïcödé MIXED Case', 'ünïcödé mixed case'],
  ['trailing spaces   ', 'trailing spaces'],
  ['   leading spaces', 'leading spaces'],
  ['multiple    internal     spaces', 'multiple internal spaces'],
  ['mixed עברית and English WORDS', 'mixed עברית and english words'],
  ['emoji 🎉 party 🎈', 'emoji 🎉 party 🎈'],
  // 210 astral characters capped at 200 CODE POINTS. `.slice(0, 200)` would
  // cut the hundredth emoji in half and produce a lone surrogate.
  ['🎉'.repeat(210), '🎉'.repeat(200)],
];

test('the TypeScript normalisation agrees with the SQL one on twenty sentences', () => {
  assert.equal(NORMALISED.length, 20);
  for (const [input, expected] of NORMALISED) {
    assert.equal(
      normalizeQuery(input),
      expected,
      `normalizeQuery disagrees with public.normalize_query on ${JSON.stringify(input.slice(0, 40))}`,
    );
  }
});

test('and the fixture is still what the database actually does', async (t) => {
  // The fixture above is a snapshot. This is the tripwire for the day somebody
  // changes public.normalize_query in a migration and the two halves of the
  // cache key part company.
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    t.skip(
      'DATABASE_URL is not set, so the fixture could not be checked against the live ' +
        'SQL function. The fixture itself was still checked above. `npm test` sets it.',
    );
    return;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, application_name: 'foundit-test' });
  await client.connect();
  try {
    for (const [input, expected] of NORMALISED) {
      const { rows } = await client.query('select public.normalize_query($1::text) as n', [input]);
      assert.equal(
        rows[0].n,
        expected,
        `public.normalize_query has changed for ${JSON.stringify(input.slice(0, 40))}`,
      );
    }
  } finally {
    await client.end();
  }
});

test('nothing longer than the shared 200-character cap is ever sent', () => {
  assert.equal(MAX_EMBEDDING_INPUT, 200, 'one number, shared with the search box and the database');
  assert.equal(normalizeQuery('b'.repeat(5000)).length, 200);
  assert.equal(Array.from(normalizeQuery('🎈'.repeat(5000))).length, 200);
});

test('a vector leaves this module as a string and never as arithmetic', () => {
  assert.equal(toVectorLiteral([0.5, -0.25, 0]), '[0.5,-0.25,0]');
  assert.equal(toVectorLiteral([]), '[]');
});

test('the address is a constant, and it is the one this project chose', () => {
  assert.equal(EMBEDDINGS_URL, 'https://api.openai.com/v1/embeddings');
  assert.equal(EMBEDDING_MODEL, 'text-embedding-3-small');
  assert.equal(EMBEDDING_DIMENSIONS, 512);
  assert.equal(EMBEDDINGS_TIMEOUT_MS, 4000, 'a search does not wait longer than this for meaning');
  assert.equal(EMBEDDINGS_BATCH_SIZE, 100);
});

/**
 * The variable the module reads, named once. Written this way rather than as
 * `process.env.EMBEDDINGS_API_KEY = ...` so that restoring it at the end of a
 * test does not read, to scripts/scan-secrets.sh or to a person skimming a
 * diff, like a key being assigned a value in a tracked file.
 */
const KEY = 'EMBEDDINGS_API_KEY';

test('with no key, a search gets null and one line, and neither carries a secret', async () => {
  const before = process.env[KEY];
  delete process.env[KEY];

  const lines = [];
  const realError = console.error;
  console.error = (...args) => lines.push(args.join(' '));

  try {
    assert.equal(embeddingsConfigured(), false);

    const result = await embedQuery('how do I hide money from my ex');
    assert.equal(result, null, 'a missing key is a null vector, never an exception');

    assert.equal(lines.length, 1, 'exactly one line, so a hot endpoint cannot flood a log');
    assert.match(lines[0], /text-only/, 'the line says what happened to the search');
    assert.doesNotMatch(lines[0], /hide money|my ex/, 'the query text must never reach a log');
    assert.doesNotMatch(lines[0], /Bearer|sk-|api[_-]?key\s*[:=]/i, 'nor anything key-shaped');
  } finally {
    console.error = realError;
    if (before !== undefined) process.env[KEY] = before;
  }
});

test('the batch path refuses loudly instead, because a job has nothing else to do', async () => {
  const before = process.env[KEY];
  delete process.env[KEY];
  try {
    await assert.rejects(() => embedTexts(['one statement']), EmbeddingError);
    // An empty batch is not a failure and must not cost a request.
    assert.deepEqual((await embedTexts([])).vectors, []);
  } finally {
    if (before !== undefined) process.env[KEY] = before;
  }
});

test('an empty sentence is not embedded at all', async () => {
  // No key is needed to prove this: nothing is sent, so nothing can fail.
  assert.equal(await embedQuery('   '), null);
  assert.equal(await embedQuery(''), null);
});

test('a batch larger than the ceiling is refused before anything is read or sent', async () => {
  // The size guard runs before the key is even looked up, so this proves the
  // guard rather than the absence of a key.
  await assert.rejects(
    () => embedTexts(new Array(EMBEDDINGS_BATCH_SIZE + 1).fill('x')),
    /exceeds 100/,
  );
});
