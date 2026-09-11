// ===========================================================================
// The application and the eval harness must plan a search identically.
//
// WHY THIS FILE EXISTS. They did not. `lib/reading.ts` computed `embedText` —
// the English restatement of a non-English sentence — and `app/results/page.tsx`
// took `filters` and `text` off the same object and then embedded a string it
// had worked out for itself before the reading existed. The harness passed the
// restatement's vector to `search_tools`; the application passed the sentence's.
//
// So the recorded Phase 4 non-English number, 0.8254, described a code path no
// visitor ever ran. The path they did run measured 0.6523 — Phase 3, to four
// decimals. Every test passed throughout, because each half was correct on its
// own and nothing compared them.
//
// What makes it visible now: there is ONE function, `planSearch`, it returns
// every string a search needs, and this file puts sentences through the
// application's call and the harness's call and asserts they are byte-identical.
// A future edit that makes one of them clever again fails here.
//
// It needs no database, no key and no network: the readings are handwritten, so
// the sentences below include the shapes that matter rather than whatever
// happens to be in the fixture.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { planSearch } from '../lib/reading.ts';
import { validateReading } from '../lib/reader-model.ts';
import { readForSearch } from '../eval/reader.mjs';
import { normalizeQuery } from '../lib/embeddings.ts';

/** The seven snake_case fields, as the database and the fixture hold them. */
const reading = (over = {}) => ({
  pricing: [],
  platforms: [],
  languages: [],
  flags: [],
  english: '',
  asks_for_software: true,
  residual: '',
  ...over,
});

/**
 * Ten sentences, chosen so that every branch of the planner is exercised at
 * least once: a plain English one, one where the rules read a constraint, one
 * where only the model does, four non-English ones (which are the whole reason
 * `embedText` differs from `text`), a refusal, a sentence that is nothing but
 * constraints, and one where the guards throw the restatement away.
 */
const CASES = [
  ['a tool to split expenses with friends', reading({ residual: 'a tool to split expenses with friends' })],
  [
    'a free tool to rename hundreds of photos at once',
    reading({ pricing: ['free', 'freemium', 'open_source', 'donation'] }),
  ],
  [
    'keep my passwords in a file on my own machine with no server involved at all',
    reading({ flags: ['works_offline', 'no_account_needed'] }),
  ],
  [
    'אפליקציה חינמית לחלוקת הוצאות בין חברים בטיול',
    reading({
      pricing: ['free', 'freemium', 'open_source', 'donation'],
      english: 'a free app for splitting expenses between friends on a trip',
    }),
  ],
  [
    'бесплатная программа чтобы убрать шум из аудиозаписи',
    reading({
      pricing: ['free', 'freemium', 'open_source', 'donation'],
      english: 'free program to remove noise from an audio recording',
    }),
  ],
  [
    'قاموس عربي إنجليزي للبحث عن معنى كلمة',
    reading({ english: 'an Arabic-English dictionary for looking up what a word means' }),
  ],
  [
    'je cherche une recette de gâteau sans gluten',
    reading({ asks_for_software: false, english: 'I am looking for a gluten-free cake recipe' }),
  ],
  ['someone to paint the hallway next month', reading({ asks_for_software: false })],
  ['free and open source', reading({ pricing: ['open_source'] })],
  [
    // The restatement here is a tool list, which the guards refuse — so the two
    // sides must ALSO agree about what was thrown away.
    'משהו שיעזור לי לחלק חשבון במסעדה',
    reading({ english: 'Splitwise Tricount Settle Up Splid Tabsplit' }),
  ],
];

/** The catalogue, as far as the guards are concerned. */
const TOOL_NAMES = ['Splitwise', 'Tricount', 'Settle Up', 'Splid', 'Tabsplit', 'Anki'];

test('the application and the harness plan every search identically', () => {
  for (const [sentence, stored] of CASES) {
    // The application's call, exactly as app/results/page.tsx makes it.
    const app = planSearch(sentence, [], readingOf(stored, sentence), { toolNames: TOOL_NAMES });
    // The harness's call, through the one module in eval/ that names the reader.
    const harness = readForSearch(sentence, stored, { toolNames: TOOL_NAMES });

    const where = `"${sentence.slice(0, 40)}"`;

    assert.equal(harness.text, app.text, `${where}: the text ranked on must match`);
    assert.equal(
      harness.embedText,
      app.embedText,
      `${where}: THE TEXT EMBEDDED MUST MATCH — this is the one that diverged`,
    );
    assert.equal(
      harness.asksForSoftware,
      app.asksForSoftware,
      `${where}: whether the page is emptied must match`,
    );
    assert.equal(harness.english, app.english, `${where}: the restatement must match`);

    // The filters, compared in the harness's own shape — a key present only
    // when it has values — so a null and an absent key cannot read as a
    // difference that is not one.
    assert.deepEqual(
      harness.constraints,
      shapeOf(app.filters),
      `${where}: the filters must match`,
    );
  }
});

test('a non-English sentence really does embed something other than it searches', () => {
  // If this ever stops being true the parity test above becomes vacuous: two
  // functions agreeing that embedText === text prove nothing about the bug this
  // file exists for.
  const differ = CASES.filter(([sentence, stored]) => {
    const plan = planSearch(sentence, [], readingOf(stored, sentence), { toolNames: TOOL_NAMES });
    return plan.embedText !== plan.text;
  });
  assert.ok(
    differ.length >= 3,
    'at least three of the cases must embed the restatement rather than the sentence',
  );
});

test('the residual is guarded against the same string on both sides', () => {
  // The second half of the same defect: the application validated the model's
  // residual against the raw query and the harness against the normalised one,
  // which differ by case, whitespace runs and the 200-character cap.
  const sentence = '  A Free Tool   To Split Expenses  ';
  const stored = reading({
    pricing: ['free', 'freemium', 'open_source', 'donation'],
    // A deletion of the NORMALISED sentence, which the raw one would also
    // accept — the point is that both sides take the same view of it.
    residual: 'a tool to split expenses',
  });
  const app = planSearch(sentence, [], readingOf(stored, sentence), { toolNames: TOOL_NAMES });
  const harness = readForSearch(sentence, stored, { toolNames: TOOL_NAMES });
  assert.equal(app.text, harness.text);
  assert.equal(app.embedText, harness.embedText);
  assert.deepEqual(
    app.refused.map((r) => `${r.field}:${r.reason}`),
    harness.refused.map((r) => `${r.field}:${r.reason}`),
    'the two sides must throw away the same fields for the same reasons',
  );
});

/* --- the two helpers, mirroring what each caller does ------------------- */

/** What app/results/page.tsx hands planSearch: a validated reading, or null. */
function readingOf(stored, sentence) {
  const checked = validateReading(stored, normalizeQuery(sentence));
  return 'reading' in checked ? checked.reading : null;
}

/** The eval's constraint shape: a key only when it has values. */
function shapeOf(filters) {
  const out = {};
  for (const key of ['pricing', 'platforms', 'flags', 'languages']) {
    const values = filters[key];
    if (Array.isArray(values) && values.length > 0) out[key] = values.map(String);
  }
  return out;
}
