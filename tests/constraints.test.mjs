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

test('open source narrows free without losing it', () => {
  // Both were stated, so both are read. Keeping only the narrower one meant no
  // Free chip was ever drawn, ?drop=free named a chip that did not exist, and
  // dropping "open source" left a sentence that said "free" with no pricing
  // filter at all — a paid tool, for a query that said free.
  const found = keys('a free open source password manager');
  assert.deepEqual(found, ['free', 'open-source']);

  // The narrowing still happens, in the one place that decides what SQL sees.
  assert.deepEqual(toSearchConstraints(readConstraints('a free open source vault')).pricing, [
    'open_source',
  ]);
});

test('dropping the narrower pricing constraint leaves the broader one filtering', () => {
  const query = 'a free open source password manager';
  const pricing = (dropped) => toSearchConstraints(readConstraints(query, dropped)).pricing;

  assert.deepEqual(pricing([]), ['open_source'], 'the narrower one wins while it is standing');
  assert.deepEqual(
    pricing(['open-source']),
    ['free', 'open_source', 'donation', 'freemium'],
    'loosening "open source" must not make a paid tool reachable — the sentence still said free',
  );
  assert.deepEqual(pricing(['free']), ['open_source']);
  assert.equal(
    pricing(['free', 'open-source']),
    null,
    'both switched off is the person saying so twice, which is allowed',
  );

  // A chip that is never drawn cannot be switched off or put back.
  assert.deepEqual(
    readConstraints(query).map((c) => c.label),
    ['Free', 'Open source'],
  );
  assert.deepEqual(
    readConstraints(query, ['open-source']).map((c) => c.label),
    ['Free'],
  );

  // Two constraints, one word: a card does not say "Open source" twice.
  const tool = { pricing: 'open_source', platforms: ['linux'], languages: ['en'], flags: [] };
  assert.deepEqual(satisfactionsFor(tool, readConstraints(query)), [
    { label: 'Open source', met: true },
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

// ---------------------------------------------------------------------------
// Every sentence below was read wrongly by a shipped version of this file, in
// the one direction that cannot be recovered from: a WHERE clause that removes
// the right answer, and a search text with the subject cut out of it. They are
// here as a table because the rule they prove is one rule — a constraint has to
// be *stated*, and an English word that merely appears is not a statement.
// ---------------------------------------------------------------------------

test('ordinary English is not a constraint, however constraint-shaped the word', () => {
  const cases = [
    // sentence                                    constraints   what search ranks on
    ['app to free up space on my phone',           ['mobile'],   'app to free up space'],
    ['a tool to build a website for my bakery',    [],           'a tool to build a website for my bakery'],
    ['software to export my Kindle highlights',    [],           'software to export my Kindle highlights'],
    ['how to remove encryption from a PDF',        [],           'how to remove encryption from a PDF'],
    ['a tool to arrange windows on my desktop',    [],           'a tool to arrange windows on my desktop'],
    ['a PC game launcher',                         [],           'a PC game launcher'],
    ['a website builder',                          [],           'a website builder'],
    ['anonymous feedback form for my team',        [],           'anonymous feedback form for my team'],
    ['free up disk space on windows pc',           ['windows'],  'free up disk space'],
  ];

  for (const [query, expected, text] of cases) {
    assert.deepEqual(keys(query), [...expected].sort(), `constraints of: ${query}`);
    assert.equal(residual(query), text, `ranked on, for: ${query}`);
  }
});

test('the same word, actually stated, is still read', () => {
  // The fix is a narrowing, not a deletion: each of these is the requirement
  // shape the rule now asks for, and each must survive it.
  assert.deepEqual(keys('free app to split expenses'), ['free']);
  assert.deepEqual(keys('note taking app for windows'), ['windows']);
  assert.deepEqual(keys('a password manager on my pc'), ['windows']);
  assert.deepEqual(keys('a video editor for mac'), ['macos']);
  assert.deepEqual(keys('a macbook backup tool'), ['macos']);
  assert.deepEqual(keys('screen recorder for linux'), ['linux']);
  assert.deepEqual(keys('a budgeting app on my phone'), ['mobile']);
  assert.deepEqual(keys('an encrypted messaging app'), ['encrypted']);
  assert.deepEqual(keys('end-to-end encrypted notes'), ['encrypted']);
  assert.deepEqual(keys('a web app to sign a pdf'), ['web']);
  assert.deepEqual(keys('somewhere to keep notes in the browser'), ['web']);
  assert.deepEqual(keys('a notes app where I own my data'), ['exports']);
  assert.deepEqual(keys('a wiki I can self-host'), ['self-hosted']);

  // And the preposition it consumed leaves with it, rather than being left
  // hanging in the text the ranker sees.
  assert.equal(residual('note taking app for windows'), 'note taking app');
  assert.equal(residual('screen recorder for linux'), 'screen recorder');
  assert.equal(residual('a video editor for mac'), 'a video editor');
});

test('the words that were never a constraint and had never been caught', () => {
  // Found while fixing the ones that were reported. Same class, same direction.
  assert.deepEqual(keys('ad-free note taking'), ['no-ads'], '"ad-free" is not a price');
  assert.deepEqual(keys('hands free voice notes'), [], '"hands free" is not a price either');
  assert.deepEqual(keys('a watermark free video editor'), [], 'nor is "watermark free"');
  assert.deepEqual(keys('an end to end testing framework'), [], '"end to end" is testing jargon');
  assert.deepEqual(keys('e2e test runner for my app'), [], 'and so is "e2e"');
  assert.deepEqual(keys('open an encrypted zip file'), [], '"encrypted" describes the file here');
  assert.deepEqual(
    keys('keep my passwords in a file on my own machine'),
    [],
    '"my own machine" is a desktop app, and self_hosted would have removed every one of them',
  );
});

test('the alphabet the rule is written in is not the alphabet a person types', () => {
  // `\b` is defined on [A-Za-z0-9_], so it never sits between a space and a
  // Cyrillic or Hebrew letter: these three matched nothing at all, in a product
  // that starts in Israel and the US.
  assert.ok(keys('бесплатная программа для заметок').includes('free'));
  assert.ok(keys('תוכנה חינם לעריכת וידאו').includes('free'));
  assert.ok(keys('אפליקציה חינמית לחלוקת הוצאות').includes('free'));
  assert.deepEqual(keys('a note taking app in čeština'), ['lang-cs']);
  assert.deepEqual(keys('a note taking app in íslenska'), ['lang-is']);
  assert.deepEqual(keys('a note taking app in română'), ['lang-ro']);
});

// ---------------------------------------------------------------------------
// Lower-casing is length-preserving for nearly every letter there is, and the
// exception is a capital in daily use by 80 million people.
// ---------------------------------------------------------------------------

test('a Turkish capital İ comes back as itself, not as a decomposed lookalike', () => {
  const query = 'İnternet olmadan çalışan not uygulaması';
  const reading = readQuery(query);

  assert.equal(reading.text, query, 'nothing was read from it, so nothing may be changed in it');
  assert.ok(
    !reading.text.includes('̇'),
    'i + U+0307 is not the letter i to to_tsvector: it stems to itself and never to "internet"',
  );

  // And the offsets after the expansion still land where they should: the
  // constraint phrase comes out, and the capital in front of it stays put.
  assert.equal(residual('İnternet olmadan çalışan free notes app'), 'İnternet olmadan çalışan notes app');
  assert.equal(residual('notes for İstanbul in Spanish'), 'notes for İstanbul');
  assert.deepEqual(keys('notes for İstanbul in Spanish'), ['lang-es']);
});

// ---------------------------------------------------------------------------
// The platform table, which used to be two tables.
//
// `windows`, `mac` and `phone` asked for a requirement shape — a preposition or
// a possessive — and `iphone`, `ipad`, `ios`, `android`, `linux`, `ubuntu`,
// `macos` and a bare `mobile` did not, on the argument that no English noun
// collides with them. That is true of the word and false of the role: naming a
// platform is not requiring one, and each sentence below was turned into a hard
// WHERE clause with its own subject cut out of the text search.
// ---------------------------------------------------------------------------

test('naming a platform is not requiring one', () => {
  const cases = [
    // sentence                                        constraints  what search ranks on
    ['an app to sell my old iphone',                   [], 'an app to sell my old iphone'],
    ['learn linux commands from the terminal',         [], 'learn linux commands from the terminal'],
    ['a tool for android developers to test layouts',  [], 'a tool for android developers to test layouts'],
    ['generate ios app icons in every size',           [], 'generate ios app icons in every size'],
    ['ubuntu installation guide',                      [], 'ubuntu installation guide'],
    ['a mobile-first website builder',                 [], 'a mobile-first website builder'],
    ['compare macos and windows file managers',        [], 'compare macos and windows file managers'],
  ];

  for (const [query, expected, text] of cases) {
    assert.deepEqual(keys(query), expected, `constraints of: ${query}`);
    assert.equal(residual(query), text, `ranked on, for: ${query}`);
  }
});

test('every platform word still reads when the sentence actually states it', () => {
  assert.deepEqual(keys('a note taking app on my phone'), ['mobile']);
  assert.deepEqual(keys('a habit tracker on mobile'), ['mobile']);
  assert.deepEqual(keys('a screen reader for windows'), ['windows']);
  assert.deepEqual(keys('a note taking app that runs on linux'), ['linux']);
  assert.deepEqual(keys('a drawing app for my ipad'), ['ios']);
  assert.deepEqual(keys('an offline map for android'), ['android', 'offline']);
  assert.deepEqual(keys('a password manager on my iphone'), ['ios']);
  assert.deepEqual(keys('a screen recorder for ubuntu'), ['linux']);
  assert.deepEqual(keys('is there a mac version of it'), ['macos']);

  // The preposition it consumed leaves with it rather than hanging in the text.
  assert.equal(residual('a drawing app for my ipad'), 'a drawing app');
  assert.equal(residual('an offline map for android'), 'an map');
  assert.equal(residual('a note taking app that runs on linux'), 'a note taking app that runs');
});

test('a platform word in front of a person names an audience, not a machine', () => {
  // The layouts are Android's; the tool is a desktop one. Filtering to Android
  // removes every answer there is.
  assert.deepEqual(keys('a tool for android developers to test layouts'), []);
  assert.deepEqual(keys('a newsletter for windows users'), []);
  assert.deepEqual(keys('a course for linux beginners'), []);
});

test('a platform requirement is stated in other languages too', () => {
  assert.deepEqual(keys('un editor de fotos para el móvil'), ['mobile']);
  assert.deepEqual(keys('un lecteur de musique pour linux'), ['linux']);
});

test('the price is stated in an inflected language too', () => {
  // Same class as the alphabet above: the ending had to be nothing at all, so
  // every inflected form of the word went unread.
  assert.ok(keys('una app gratuita para notas').includes('free'));
  assert.ok(keys('eine kostenlose App für Notizen').includes('free'));
  assert.ok(keys('une application gratuite').includes('free'));
  // But not the English word that happens to start the same way.
  assert.deepEqual(keys('a filter for gratuitous violence in films'), []);
});

// ---------------------------------------------------------------------------
// Hebrew writes its prepositions, its article and its conjunction attached to
// the front of the word. `OPEN` asks for a non-letter before the match, so it
// refused every one of them — including "בחינם", which is not an inflection of
// "חינם" but the ordinary way to say "for free". Arabic and Turkish were simply
// absent.
// ---------------------------------------------------------------------------

test('the commonest way to say "free" in Hebrew is the one with a prefix on it', () => {
  assert.deepEqual(keys('אפליקציה חינם לעריכת וידאו'), ['free']);
  assert.deepEqual(keys('אפליקציה בחינם לעריכת וידאו'), ['free']);
  assert.deepEqual(keys('לחפש אפליקציה בחינם לעריכת וידאו'), ['free']);
  assert.deepEqual(keys('תוכנה שחינם לגמרי'), ['free']);

  // And the prefix leaves with the word, rather than being left behind as a
  // one-letter ranking term.
  assert.equal(residual('לחפש אפליקציה בחינם לעריכת וידאו'), 'לחפש אפליקציה לעריכת וידאו');
});

test('"free" in Arabic, in the forms people write it in', () => {
  assert.deepEqual(keys('برنامج مجاني لتقسيم المصاريف'), ['free']);
  assert.deepEqual(keys('أريد تطبيقا مجانيا لتحرير الفيديو'), ['free']);
  assert.deepEqual(keys('تطبيق مجانية للملاحظات'), ['free']);
  assert.deepEqual(keys('هل يوجد تطبيق ملاحظات مجانا'), ['free']);
  assert.equal(residual('برنامج مجاني لتقسيم المصاريف'), 'برنامج لتقسيم المصاريف');

  // "مجانين" is the plural of "mad" and starts with the same four letters.
  assert.deepEqual(keys('فيلم عن مجانين'), []);
});

test('"free" in Turkish', () => {
  assert.deepEqual(keys('video düzenlemek için ücretsiz bir uygulama'), ['free']);
  assert.deepEqual(keys('ücretsiz not uygulaması'), ['free']);
  assert.equal(residual('ücretsiz not uygulaması'), 'not uygulaması');
});
