// ===========================================================================
// The sentence reader: what it will accept, and what it throws away.
//
// Two files under test, and they are two different jobs.
//
//   lib/reader-model.ts   validateReading — is this a well-formed answer at
//                         all? Refuses a wrong type, a missing field, an extra
//                         field, an enum value the catalogue does not have, and
//                         a residual longer than the sentence.
//
//   lib/reading.ts        guardReading and mergeReading — is this a BELIEVABLE
//                         answer, and what may it change? Every guard here is a
//                         failure that was observed while this was being built,
//                         with the real model, on the real sentences, and each
//                         one is named in the test that pins it.
//
// Nothing here makes a network call or needs a key. The readings below are
// handwritten, which is the point: a schema validator that is only ever fed
// well-formed input is a schema validator nobody has tested.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLAG_VALUES,
  LANGUAGE_VALUES,
  PLATFORM_VALUES,
  PRICING_VALUES,
  READER_MODEL,
  READER_SCHEMA,
  READER_URL,
  validateReading,
} from '../lib/reader-model.ts';
import {
  MODEL_FLAGS,
  guardReading,
  isDeletionOf,
  mergeReading,
  namesSoftware,
  readSentenceWith,
} from '../lib/reading.ts';
import { readQuery } from '../lib/constraints.ts';

/** A well-formed, entirely empty reading. The starting point for every case. */
const EMPTY = {
  pricing: [],
  platforms: [],
  languages: [],
  flags: [],
  english: '',
  asks_for_software: true,
  residual: 'a tool to split expenses',
};

const SENTENCE = 'a tool to split expenses';

const good = (over = {}) => ({ ...EMPTY, ...over });

/* ===========================================================================
 * 1. The schema validator
 * ======================================================================== */

test('a well-formed reading is accepted and comes back in the application’s shape', () => {
  const out = validateReading(good({ pricing: ['free', 'freemium'] }), SENTENCE);
  assert.ok('reading' in out, 'a valid reading must not be refused');
  assert.deepEqual(out.reading.pricing, ['free', 'freemium']);
  assert.equal(out.reading.asksForSoftware, true, 'snake_case becomes camelCase once, here');
  assert.equal(out.reading.residual, SENTENCE);
});

test('the schema and the validator agree on which fields exist', () => {
  // Two lists of seven strings in two files is two lists to forget to update.
  assert.deepEqual(
    [...READER_SCHEMA.required].sort(),
    ['asks_for_software', 'english', 'flags', 'languages', 'platforms', 'pricing', 'residual'],
  );
  assert.equal(READER_SCHEMA.additionalProperties, false);
  for (const field of READER_SCHEMA.required) {
    assert.ok(field in READER_SCHEMA.properties, `${field} is required but not described`);
  }
});

test('the enums in the schema are the database’s own labels', () => {
  assert.deepEqual([...READER_SCHEMA.properties.pricing.items.enum], [...PRICING_VALUES]);
  assert.deepEqual([...READER_SCHEMA.properties.platforms.items.enum], [...PLATFORM_VALUES]);
  assert.deepEqual([...READER_SCHEMA.properties.flags.items.enum], [...FLAG_VALUES]);
  assert.deepEqual([...READER_SCHEMA.properties.languages.items.enum], [...LANGUAGE_VALUES]);
});

test('a bad response is REJECTED — one case for every way it can be bad', () => {
  const cases = [
    ['not an object', 'nope', /not a JSON object/],
    ['an array', ['free'], /not a JSON object/],
    ['null', null, /not a JSON object/],
    [
      'a missing field',
      (() => {
        const o = good();
        delete o.residual;
        return o;
      })(),
      /has no "residual"/,
    ],
    ['an extra field', good({ tool: 'splitwise' }), /extra field "tool"/],
    ['an unknown pricing model', good({ pricing: ['cheap'] }), /known pricing models/],
    ['an unknown platform', good({ platforms: ['smartwatch'] }), /known platforms/],
    ['an unknown flag', good({ flags: ['fast'] }), /known flags/],
    ['a language name rather than a code', good({ languages: ['Hebrew'] }), /known language codes/],
    ['pricing that is not an array', good({ pricing: 'free' }), /known pricing models/],
    ['a boolean that is a string', good({ asks_for_software: 'yes' }), /not a boolean/],
    ['english that is not a string', good({ english: 42 }), /english is not a string/],
    ['residual that is not a string', good({ residual: null }), /residual is not a string/],
    [
      'a residual longer than the sentence',
      good({ residual: `${SENTENCE} with friends while travelling` }),
      /longer than the sentence/,
    ],
  ];

  for (const [name, value, expected] of cases) {
    const out = validateReading(value, SENTENCE);
    assert.ok('error' in out, `${name} must be refused, and was not`);
    assert.match(out.error, expected, `${name}: the reason must say what was wrong`);
    // And the reason never quotes the response back, because a model provider's
    // output is a place a sentence somebody typed can reappear.
    assert.ok(!out.error.includes(SENTENCE), `${name}: the reason must not quote the sentence`);
  }
});

test('the model can name no tool, because there is nowhere to put one', () => {
  // The only two free-text fields are checked: `english` is never a filter, and
  // `residual` has to be a deletion of the sentence. A tool name in either is
  // either refused or is a word the person typed themselves.
  const out = validateReading(good({ residual: 'splitwise' }), SENTENCE);
  assert.ok('reading' in out, 'the validator only checks length here');
  const guarded = guardReading(out.reading, SENTENCE);
  assert.equal(guarded.residual, '', 'a residual that is not a deletion is thrown away');
  assert.equal(
    guarded.refused.find((r) => r.field === 'residual')?.reason,
    'the residual is not the sentence with phrases deleted',
  );
});

test('the one address and the one model are what the rest of the system expects', () => {
  assert.equal(READER_URL, 'https://api.openai.com/v1/responses');
  assert.equal(READER_MODEL, 'gpt-5-nano');
});

/* ===========================================================================
 * 2. The deletion check
 * ======================================================================== */

test('a residual is only accepted when it is the sentence with pieces cut out', () => {
  assert.ok(isDeletionOf('a tool to split expenses', 'a free tool to split expenses'));
  assert.ok(isDeletionOf('a tool to split expenses', 'a tool to split expenses'));
  assert.ok(isDeletionOf('', 'anything at all'), 'deleting everything is still a deletion');

  // Reordered, translated, corrected, expanded: none of these is a deletion.
  assert.ok(!isDeletionOf('split expenses a tool to', 'a free tool to split expenses'));
  assert.ok(!isDeletionOf('an expense splitter', 'a free tool to split expenses'));
  assert.ok(!isDeletionOf('a tool to split expenses with friends', 'a tool to split expenses'));
  assert.ok(!isDeletionOf('una herramienta', 'a tool to split expenses'));

  // Whitespace left behind by a cut is not a rewrite, and case is not either.
  assert.ok(isDeletionOf('a tool  to   split expenses', 'A free tool to split expenses'));
});

/* ===========================================================================
 * 3. The guards — every one of these is an observed failure
 * ======================================================================== */

test('a pricing set nobody could have asked for is thrown away', () => {
  // Observed: ["paid"] for "we all paid for different bits of the holiday",
  // which would have deleted every free tool from a question about splitting a
  // bill. Only two sets are readings; everything else is a guess.
  const paid = guardReading(validateReading(good({ pricing: ['paid'] }), SENTENCE).reading, SENTENCE);
  assert.deepEqual(paid.pricing, []);
  assert.match(paid.refused[0].reason, /not a pricing requirement/);

  const free = guardReading(
    validateReading(good({ pricing: ['free', 'freemium', 'open_source', 'donation'] }), SENTENCE).reading,
    SENTENCE,
  );
  assert.equal(free.pricing.length, 4, 'the four free models are one reading');

  const oss = guardReading(
    validateReading(good({ pricing: ['open_source'] }), SENTENCE).reading,
    SENTENCE,
  );
  assert.deepEqual(oss.pricing, ['open_source']);
});

test('a model listing the whole enum is a model that is guessing', () => {
  // Observed: ten platforms and seven flags at once for "record my screen and
  // stream it live without paying for anything".
  const many = guardReading(
    validateReading(
      good({ platforms: [...PLATFORM_VALUES], flags: [...FLAG_VALUES] }),
      SENTENCE,
    ).reading,
    SENTENCE,
  );
  assert.deepEqual(many.platforms, [], 'ten platforms is not ten requirements');
  assert.deepEqual(many.flags, [], 'seven flags is not seven requirements');
  assert.equal(many.refused.filter((r) => r.field === 'platforms').length, 1);
});

test('only the two flags a sentence really states may come from the model', () => {
  const wanted = guardReading(
    validateReading(good({ flags: ['works_offline', 'no_ads'] }), SENTENCE).reading,
    SENTENCE,
  );
  assert.deepEqual(wanted.flags, ['works_offline'], 'no_ads is a thing people want, not a thing said');
  assert.match(wanted.refused[0].reason, /thing people want/);
  assert.deepEqual([...MODEL_FLAGS], ['works_offline', 'no_account_needed']);
});

test('a restatement that is just the sentence back is not a restatement', () => {
  const echo = guardReading(validateReading(good({ english: SENTENCE }), SENTENCE).reading, SENTENCE);
  assert.equal(echo.english, '');
  assert.match(echo.refused[0].reason, /the sentence itself/);

  const real = guardReading(
    validateReading(good({ english: 'a tool for splitting a bill' }), SENTENCE).reading,
    SENTENCE,
  );
  assert.equal(real.english, 'a tool for splitting a bill');
});

test('a sentence that names a program is never refused as "not software"', () => {
  // The measurement that forced this: the model answered false for "budgeting
  // app where my bank details never leave my own computer" while four
  // mechanical variants of the same sentence answered true.
  const named = 'budgeting app where my bank details never leave my own computer';
  const refused = guardReading(
    validateReading(good({ asks_for_software: false, residual: named }), named).reading,
    named,
  );
  assert.equal(refused.asksForSoftware, true, 'a sentence with "app" in it asks for software');
  assert.match(refused.refused[0].reason, /names a program/);

  // And a sentence that names none is still refusable, which is the whole point.
  const plumber = 'someone to come and fix the leak under the sink';
  const stands = guardReading(
    validateReading(good({ asks_for_software: false, residual: plumber }), plumber).reading,
    plumber,
  );
  assert.equal(stands.asksForSoftware, false);

  // In every language the catalogue serves, not only English.
  assert.ok(namesSoftware('תוכנה לעריכת וידאו'));
  assert.ok(namesSoftware('una aplicación para dividir gastos'));
  assert.ok(namesSoftware('бесплатная программа чтобы убрать шум'));
  assert.ok(namesSoftware('تطبيق لتقسيم النفقات'));
  assert.ok(!namesSoftware('a babysitter for Saturday night'));
  assert.ok(!namesSoftware('my car makes a grinding noise'));
});

/* ===========================================================================
 * 4. The merge
 * ======================================================================== */

test('the rules win every dimension they read, and the model fills the rest', () => {
  // The rules read "free" from this and nothing else: "no server involved at
  // all" is one of the phrasings their word lists were never going to catch,
  // and is exactly what the model is here for.
  const sentence = 'a free tool with no server involved at all';
  const rules = readQuery(sentence);
  const model = validateReading(
    good({
      // Both dimensions offered. The rules already spoke for pricing.
      pricing: ['open_source'],
      flags: ['no_account_needed'],
      residual: sentence,
    }),
    sentence,
  ).reading;

  const merged = mergeReading(rules, guardReading(model, sentence), { accept: ['pricing', 'flags'] });
  const keys = merged.constraints.map((c) => c.key);
  assert.ok(keys.includes('free'), 'the rules read free and keep it');
  assert.ok(
    !keys.includes('open-source'),
    'the model may not narrow a dimension the rules already read',
  );
  assert.ok(keys.includes('flag-no_account_needed'), 'a dimension the rules missed is filled');
  assert.deepEqual(merged.fromModel, ['flag-no_account_needed']);
});

test('model-wins is reachable, and is not what ships', () => {
  const sentence = 'a free tool that works offline';
  const rules = readQuery(sentence);
  const model = guardReading(
    validateReading(good({ pricing: ['open_source'], residual: sentence }), sentence).reading,
    sentence,
  );

  const shipped = mergeReading(rules, model, { accept: ['pricing'] });
  const alternative = mergeReading(rules, model, { mode: 'model-wins', accept: ['pricing'] });

  assert.ok(shipped.constraints.some((c) => c.key === 'free'));
  assert.ok(alternative.constraints.some((c) => c.key === 'open-source'));
  assert.ok(
    !alternative.constraints.some((c) => c.key === 'free'),
    'model-wins replaces the dimension rather than adding to it',
  );
});

test('a dropped constraint stays dropped whichever half of the reader produced it', () => {
  const sentence = 'a tool to split expenses';
  const model = validateReading(
    good({ pricing: ['free', 'freemium', 'open_source', 'donation'] }),
    sentence,
  ).reading;

  const kept = readSentenceWith(sentence, [], model);
  assert.ok(kept.constraints.some((c) => c.key === 'free'));

  const dropped = readSentenceWith(sentence, ['free'], model);
  assert.ok(
    !dropped.constraints.some((c) => c.key === 'free'),
    '?drop= must work on a model-read chip exactly as it does on a rules-read one',
  );
  assert.equal(dropped.filters.pricing, null, 'and the filter goes with the chip');
});

test('with no reading at all, the merge is exactly the rules pass', () => {
  const sentence = 'a free note taking app that runs on Linux';
  const rules = readQuery(sentence);
  const merged = readSentenceWith(sentence, [], null);

  assert.deepEqual(
    merged.constraints.map((c) => c.key).sort(),
    rules.constraints.map((c) => c.key).sort(),
    'no model, no change — this is the Phase 3 search',
  );
  assert.equal(merged.text, rules.text);
  assert.equal(merged.asksForSoftware, true, 'no reading is never a refusal');
  assert.equal(merged.usedModel, false);
});

test('the English restatement is embedded, and never filtered on or ranked on', () => {
  const sentence = 'תוכנה לעריכת וידאו';
  const model = validateReading(
    { ...EMPTY, english: 'software for editing video', residual: sentence },
    sentence,
  ).reading;

  const merged = readSentenceWith(sentence, [], model);
  assert.equal(merged.english, 'software for editing video');
  assert.equal(merged.embedText, 'software for editing video', 'the restatement is what is embedded');
  assert.equal(merged.text, sentence, 'and the ranker still sees only what the person typed');
  assert.deepEqual(merged.filters.languages, null, 'a restatement is never a language filter');
});
