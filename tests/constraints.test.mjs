// ===========================================================================
// The rules pass that reads a sentence.
//
// Small on purpose, and replaced wholesale by Phase 4. What is tested here is
// the thing that must stay true whoever writes the reader: a constraint it
// finds becomes a WHERE clause, so a wrong one is worse than a missing one.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readConstraints,
  toSearchConstraints,
  satisfactionsFor,
  pricingLabel,
} from '../lib/constraints.ts';

const keys = (query, dropped) => readConstraints(query, dropped).map((c) => c.key).sort();

test('the words people actually type', () => {
  assert.deepEqual(keys('a free tool to split expenses'), ['free']);
  assert.deepEqual(keys('habit tracker that works offline'), ['offline']);
  assert.deepEqual(keys('scan receipts without an account'), ['no-account']);
  assert.deepEqual(keys('note taking with no ads'), ['no-ads']);
  assert.deepEqual(
    keys('free expense splitter in Spanish for my phone'),
    ['free', 'lang-es', 'mobile'],
  );
});

test('a sentence in another language still states its constraints', () => {
  assert.ok(keys('una app gratis para dividir gastos').includes('free'));
  assert.ok(keys('kostenlos notizen machen').includes('free'));
});

test('a language is a subject until somebody asks for it as a requirement', () => {
  // The interface, asked for: a filter.
  assert.deepEqual(keys('a note taking app in Icelandic'), ['lang-is']);
  assert.deepEqual(keys('flashcards with a Spanish interface'), ['lang-es']);
  assert.deepEqual(keys('una app gratis en español'), ['free', 'lang-es']);

  // The subject, described: not a filter. Reading "learn Spanish vocabulary"
  // as "the interface must be Spanish" would drop the flashcard app that was
  // being asked for.
  assert.deepEqual(keys('learn Spanish vocabulary with spaced repetition'), []);
  assert.deepEqual(keys('transcribe a French interview'), []);
});

test('what it must not read', () => {
  // "freelance" is not "free", and a trial is not free either.
  assert.deepEqual(keys('invoicing for a freelance designer'), []);
  assert.deepEqual(keys('something with a free trial'), []);
  // A word that only looks like a constraint is left alone.
  assert.deepEqual(keys('a tool for account managers'), []);
});

test('open source is narrower than free, and wins over it', () => {
  const found = keys('a free open source password manager');
  assert.deepEqual(found, ['open-source']);
  assert.deepEqual(toSearchConstraints(readConstraints('a free open source vault')).pricing, [
    'open_source',
  ]);
});

test('a dropped constraint is read and then discarded, so it can be put back', () => {
  assert.deepEqual(keys('free offline notes', ['free']), ['offline']);
  assert.deepEqual(keys('free offline notes', ['free', 'offline']), []);
  // The chip drawn as removed still knows its own label.
  const dropped = readConstraints('free offline notes').filter((c) => c.key === 'free');
  assert.equal(dropped[0].label, 'Free');
});

test('constraints become the search function’s own arguments', () => {
  const parsed = readConstraints('free offline note taking in German with no account');
  const constraints = toSearchConstraints(parsed);

  assert.deepEqual(constraints.pricing, ['free', 'open_source', 'donation', 'freemium']);
  assert.deepEqual(constraints.flags.sort(), ['no_account_needed', 'works_offline']);
  assert.deepEqual(constraints.languages, ['de']);
  assert.equal(constraints.platforms, null, 'nothing asked for is null, not an empty array');
});

test('nothing stated is nothing constrained', () => {
  const constraints = toSearchConstraints(readConstraints('somewhere to keep recipes'));
  assert.deepEqual(constraints, {
    pricing: null,
    platforms: null,
    flags: null,
    languages: null,
  });
});

test('a satisfaction chip states a fact about the tool, not a hope', () => {
  const parsed = readConstraints('free offline notes in Spanish');
  const tool = {
    pricing: 'freemium',
    platforms: ['web', 'ios'],
    languages: ['en', 'es'],
    flags: ['works_offline'],
  };

  const chips = satisfactionsFor(tool, parsed);
  assert.deepEqual(chips, [
    { label: 'Free tier', met: true },
    { label: 'Works offline', met: true },
    { label: 'Spanish interface', met: true },
  ]);

  const paid = satisfactionsFor(
    { pricing: 'paid', platforms: [], languages: ['en'], flags: [] },
    parsed,
  );
  assert.deepEqual(
    paid.map((c) => c.met),
    [false, false, false],
    'an unmet constraint reads as unmet rather than quietly disappearing',
  );
});

test('pricing is said in English, and never as a number', () => {
  assert.equal(pricingLabel('free'), 'Free');
  assert.equal(pricingLabel('freemium'), 'Free tier');
  assert.equal(pricingLabel('paid'), 'Paid');
  assert.equal(pricingLabel('open_source'), 'Open source');
});
