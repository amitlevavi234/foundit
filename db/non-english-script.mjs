// ===========================================================================
// The one definition of "a character this English site must never print".
//
// OWNER FEEDBACK, ROUND 1 — F14. `0022_english_only.sql` generated
// `tool_problems.non_english_script` from `statement ~ '[<U+0590>-<U+06FF>]'`
// and `tests/english.test.mjs` spelled the same range out a second time, in a
// second file, as a second literal. Both were too narrow in the same way:
// Hebrew and Arabic also live in Arabic Supplement (U+0750–077F), Arabic
// Extended-A (U+08A0–08FF), Alphabetic Presentation Forms (U+FB1D–FB4F) and
// Arabic Presentation Forms A and B (U+FB50–FDFF, U+FE70–FEFF) — which is what
// text pasted out of a PDF or an older Windows application looks like. A maker
// using `set_owner_statements`, or the submit flow, could plant such a
// statement and all five render filters passed it through.
//
// Widening one of two copies would have left the schema and its test
// disagreeing, silently, in the direction where the test says yes and the page
// says Arabic. So there is now ONE list of ranges, here, and everything else is
// derived from it:
//
//   jsClass()   the character class `tests/english.test.mjs` builds its regular
//               expression from, and sweeps both the source tree and every
//               rendered page with.
//   sqlClass()  the same class as PostgreSQL spells it — a `U&'…'` Unicode
//               string constant, so this repository holds no literal Hebrew or
//               Arabic character in a migration and `scripts/scan-control-bytes.mjs`
//               has nothing to trip over. It is the exact text
//               `db/migrations/0031_english_script_widened.sql` contains, and
//               `tests/english.test.mjs` asserts that it still does.
//
// WHAT IT IS NOT, said here because the column's name must not over-claim: this
// is not a language detector. A statement in French or in Russian is `false`
// and would render. That is the right scope — nothing in this catalogue is in
// either — and the wrong name would be the thing that made a later reader trust
// it too far.
// ===========================================================================

/**
 * Every block in which a Hebrew or Arabic letter can appear, as inclusive code
 * point pairs. Order matters only for legibility; the classes below are
 * rendered in this order and compared as text.
 */
export const NON_ENGLISH_RANGES = Object.freeze([
  // Hebrew, and Arabic.
  Object.freeze([0x0590, 0x06ff]),
  // Arabic Supplement.
  Object.freeze([0x0750, 0x077f]),
  // Arabic Extended-A.
  Object.freeze([0x08a0, 0x08ff]),
  // Alphabetic Presentation Forms — the Hebrew half of it.
  Object.freeze([0xfb1d, 0xfb4f]),
  // Arabic Presentation Forms-A.
  Object.freeze([0xfb50, 0xfdff]),
  // Arabic Presentation Forms-B.
  Object.freeze([0xfe70, 0xfeff]),
]);

const hex4 = (code) => code.toString(16).toUpperCase().padStart(4, '0');

/** The class as JavaScript spells it: `[֐-ۿ…]`. */
export function jsClass() {
  return `[${NON_ENGLISH_RANGES.map(([lo, hi]) => `\\u${hex4(lo)}-\\u${hex4(hi)}`).join('')}]`;
}

/**
 * The class as PostgreSQL spells it, including the `U&` prefix and the quotes:
 * `U&'[\0590-\06FF…]'`. Inside a `U&'…'` constant a backslash followed by four
 * hexadecimal digits is one character, and `[`, `]` and `-` are themselves.
 */
export function sqlClass() {
  return `U&'[${NON_ENGLISH_RANGES.map(([lo, hi]) => `\\${hex4(lo)}-\\${hex4(hi)}`).join('')}]'`;
}

/** A fresh regular expression over the class. `g` so a sweep can count hits. */
export function nonEnglishRegExp(flags = 'g') {
  return new RegExp(jsClass(), flags);
}
