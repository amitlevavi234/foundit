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
  readQuery,
  toSearchConstraints,
  satisfactionsFor,
  pricingLabel,
} from '../lib/constraints.ts';

const keys = (query, dropped) => readConstraints(query, dropped).map((c) => c.key).sort();
const residual = (query, dropped) => readQuery(query, dropped).text;

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

// ---------------------------------------------------------------------------
// A constraint is a WHERE clause, so the words that stated it must not also be
// ranking terms. Retrieval is any-of: "free" left in the text matches every
// summary that happens to contain it, and the sentence's actual subject gets
// out-ranked by the word that was supposed to narrow it.
// ---------------------------------------------------------------------------

test('what stated a constraint is not what search ranks on', () => {
  assert.equal(
    residual('a free tool to split expenses with friends while travelling, in Spanish'),
    'a tool to split expenses with friends while travelling',
  );
  assert.equal(residual('habit tracker that works offline'), 'habit tracker that works');
  assert.equal(residual('note taking app with no ads'), 'note taking app with');
});

test('the span a rule matched comes out, not every occurrence of the word', () => {
  // No rule ever matched these, so nothing is removed from them.
  assert.equal(residual('screen reader by Freedom Scientific'), 'screen reader by Freedom Scientific');
  assert.equal(residual('something with a free trial'), 'something with a free trial');
  assert.equal(residual('invoicing for a freelance designer'), 'invoicing for a freelance designer');
  // A language named as a subject is a subject: the words stay in the query.
  assert.equal(
    residual('learn Spanish vocabulary with spaced repetition'),
    'learn Spanish vocabulary with spaced repetition',
  );
  // The rule matched "in Spanish" — the preposition it consumed goes with it.
  assert.equal(residual('flashcards in Spanish'), 'flashcards');
});

test('the same rule matching twice removes both spans and nothing else', () => {
  assert.equal(residual('free notes and a free password vault'), 'notes and a password vault');
});

test('a phrase read as a constraint leaves even when the constraint is dropped', () => {
  // Dropping says "stop filtering on that", never "rank on that word": putting
  // it back in the text is how a loosened search gets noisier than the one it
  // loosened.
  const reading = readQuery('free offline notes', ['free']);
  assert.deepEqual(reading.constraints.map((c) => c.key), ['offline']);
  assert.equal(reading.text, 'notes');

  // Same reason: "free" lost to "open source" as a constraint, but it was
  // still a constraint word, so it is not a ranking term either.
  assert.equal(residual('a free open source password manager'), 'a password manager');
});

test('a sentence that was nothing but constraints searches on nothing, not on itself', () => {
  // An empty query is browse: the catalogue in editorial order with the hard
  // constraints still applied, every row flagged match_source = 'browse'. That
  // is a real answer to "free"; ranking on the word "free" is not.
  const bare = readQuery('free');
  assert.equal(bare.text, '');
  assert.equal(bare.emptyText, true);
  assert.deepEqual(bare.constraints.map((c) => c.key), ['free']);

  const two = readQuery('open source, offline');
  assert.equal(two.text, '');
  assert.deepEqual(two.constraints.map((c) => c.key).sort(), ['offline', 'open-source']);

  // Nothing stated is nothing stripped.
  const plain = readQuery('somewhere to keep recipes');
  assert.equal(plain.text, 'somewhere to keep recipes');
  assert.equal(plain.emptyText, false);
});

test('readConstraints still answers exactly what it used to', () => {
  const query = 'free offline note taking in German with no account';
  assert.deepEqual(
    readConstraints(query).map((c) => c.key),
    readQuery(query).constraints.map((c) => c.key),
  );
});

test('pricing is said in English, and never as a number', () => {
  assert.equal(pricingLabel('free'), 'Free');
  assert.equal(pricingLabel('freemium'), 'Free tier');
  assert.equal(pricingLabel('paid'), 'Paid');
  assert.equal(pricingLabel('open_source'), 'Open source');
});
