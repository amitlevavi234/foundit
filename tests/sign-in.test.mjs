// ===========================================================================
// The three decisions the sign-in screen makes on its own.
//
// `safeNext` is the important one. A sign-in screen that will redirect
// anywhere is how a phishing page borrows somebody else's domain: the link
// really is foundit.tools, the sign-in really is ours, and the landing
// afterwards is theirs — and the person has just typed a code into a page they
// were right to trust.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { codeFromForm, looksLikeEmail, safeNext } from '../lib/sign-in.ts';

/** A stand-in for FormData: anything that answers get(name). */
const fields = (values) => ({ get: (name) => values[name] ?? null });

test('an internal path survives, with its query intact', () => {
  assert.equal(safeNext('/saved'), '/saved');
  assert.equal(safeNext('/tools/splitwise?q=split%20the%20bill'), '/tools/splitwise?q=split%20the%20bill');
  assert.equal(safeNext('/results?q=a&drop=pricing'), '/results?q=a&drop=pricing');
});

test('anything that could leave this site becomes the homepage', () => {
  for (const hostile of [
    'https://evil.example/login',
    'http://evil.example',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '//\\evil.example',
    'javascript:alert(1)',
    'evil.example',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeNext(hostile), '/', `${String(hostile)} must not be followed`);
  }
});

test('a loop back through sign-in is not a destination', () => {
  assert.equal(safeNext('/sign-in'), '/');
  assert.equal(safeNext('/sign-in/code'), '/');
  assert.equal(safeNext('/sign-in?next=/sign-in'), '/');
});

test('an address is checked loosely, on purpose', () => {
  // Loose because the only thing this decides is whether to SPEND a code on
  // the string; the address is proved by a code arriving. A strict pattern
  // refuses somebody's real address and tells them it is wrong.
  for (const good of [
    'noa@example.com',
    'a.b+tag@sub.example.co.uk',
    "o'brien@example.ie",
    'ПОЧТА@пример.рф',
  ]) {
    assert.equal(looksLikeEmail(good), true, `${good} is worth a code`);
  }

  for (const bad of ['', 'noa', 'noa@', '@example.com', 'noa@example', 'two words@example.com', 'a@b']) {
    assert.equal(looksLikeEmail(bad), false, `${bad} is not an address`);
  }

  // 254 is the longest an address can be. Beyond it, nothing is sent.
  assert.equal(looksLikeEmail(`${'a'.repeat(250)}@example.com`), false);
});

test('six boxes become one code, however a person fills them in', () => {
  assert.equal(codeFromForm(fields({ d1: '4', d2: '8', d3: '2', d4: '9', d5: '1', d6: '5' })), '482915');
  // Nothing typed yet.
  assert.equal(codeFromForm(fields({})), '');
  // Half filled in — the screen says "that is not six digits yet" rather than
  // spending one of the three attempts on it.
  assert.equal(codeFromForm(fields({ d1: '4', d2: '8' })), '48');
});

test('a pasted code is accepted in the shapes people actually paste', () => {
  // The enhancement in components/CodeBoxes.tsx spreads a paste across the
  // boxes; this is the server's half, and it has to cope with the paste
  // landing in the hidden field or in one box.
  assert.equal(codeFromForm(fields({ code: '482915' })), '482915');
  assert.equal(codeFromForm(fields({ code: '482 915' })), '482915');
  assert.equal(codeFromForm(fields({ code: 'Your code is 482915' })), '482915');
  assert.equal(codeFromForm(fields({ d1: '482915' })), '482915');
});

test('a code is six digits and nothing else, whatever arrives', () => {
  assert.equal(codeFromForm(fields({ code: '4829157777' })), '482915', 'capped at six');
  assert.equal(codeFromForm(fields({ code: "48'2915; drop table" })), '482915');
  assert.equal(codeFromForm(fields({ code: '<script>1</script>' })), '1');
});
