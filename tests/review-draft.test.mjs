// ===========================================================================
// The review limiter's refusal, and the words it refused.
//
// THE PHASE 9a REVIEW'S F12, which was two defects on one journey and both of
// them silent.
//
// ONE. `postReview` sent the visitor back with `${back}?review=too-many#reviews`,
// and `back` is the page they are on — which carries `?q=<the sentence>`
// whenever they arrived from a search, which is the ordinary way anybody
// reaches a tool page. A URL has one query string, so the result was
// `/tools/receiptly?q=my%20receipts%20are%20a%20mess?review=too-many#reviews`
// and `review` was not a parameter at all: it was the tail of the value of
// `q`. `searchParams.review` came back null, the notice never rendered, and
// the "All results" link on that page was rebuilt from a corrupted query.
//
// TWO. Two files promised that "the review they typed is still in the form".
// `redirect()` re-renders the page from the server and the form had nothing to
// restore from, so the words went every time.
//
// Both halves live in lib/review-draft.ts precisely so that this file can
// drive them: `app/tools/actions.ts` is `'use server'`, so nothing it exports
// can be imported by a test, and the first defect shipped because nobody
// could look at it.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DRAFT_COOKIE,
  DRAFT_MAX_AGE_SECONDS,
  draftPath,
  parseDraft,
  reviewNoticeUrl,
} from '../lib/review-draft.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The sentence the whole product is arranged around not leaking. */
const SENTENCE = 'my receipts are a mess at tax time';
/** What `app/tools/[slug]/page.tsx` puts in the form's hidden `back` field. */
const FROM_A_SEARCH = `/tools/receiptly?q=${encodeURIComponent(SENTENCE)}`;
const FROM_BROWSE = '/tools/receiptly';

/* ---------------------------------------------------------------------------
 * One — the refusal is visible
 * ------------------------------------------------------------------------ */

test('the refusal is a real parameter, even when the visitor came from a search', () => {
  const target = reviewNoticeUrl(FROM_A_SEARCH, 'too-many');

  // The shape that used to be produced, pinned so it cannot come back.
  assert.ok(!target.includes('?q=') || target.indexOf('?') === target.lastIndexOf('?'),
    `two question marks in ${target} — this is the concatenation defect`);

  // And what the page reads, read the way the page reads it.
  const url = new URL(target, 'https://foundit.tools');
  assert.equal(url.searchParams.get('review'), 'too-many', 'the notice must be its own parameter');
  assert.equal(url.searchParams.get('q'), SENTENCE, 'and the search must survive it intact');
  assert.equal(url.hash, '#reviews', 'and the page must land on the reviews section');
  assert.equal(url.pathname, '/tools/receiptly');
});

test('the same for the other refusal, and for the plainer journey', () => {
  for (const notice of ['too-many', 'refused']) {
    for (const back of [FROM_A_SEARCH, FROM_BROWSE]) {
      const url = new URL(reviewNoticeUrl(back, notice), 'https://foundit.tools');
      assert.equal(url.searchParams.get('review'), notice, `${back} lost the ${notice} notice`);
      assert.equal(url.hash, '#reviews');
    }
  }

  // A query string that already carries other things keeps them.
  const busy = reviewNoticeUrl('/tools/receiptly?q=one%20two&from=browse', 'refused');
  const url = new URL(busy, 'https://foundit.tools');
  assert.equal(url.searchParams.get('q'), 'one two');
  assert.equal(url.searchParams.get('from'), 'browse');
  assert.equal(url.searchParams.get('review'), 'refused');

  // And a second refusal does not stack a second `review=`.
  const twice = reviewNoticeUrl(busy.split('#')[0], 'too-many');
  assert.equal(new URL(twice, 'https://foundit.tools').searchParams.getAll('review').length, 1);
});

test('no notice URL is built by concatenation any more', () => {
  // THE GUARD. The defect was one template literal, and the fix is one
  // function; what keeps them together is that nothing else may build this
  // URL. `redirect(`${back}?…`)` in a Server Action is exactly what shipped.
  const actions = read('app/tools/actions.ts')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(
    actions,
    /\$\{back\}\?/,
    'app/tools/actions.ts builds a query string by concatenating onto `back`, which already '
      + 'has one whenever the visitor arrived from a search',
  );
  assert.match(actions, /reviewNoticeUrl\(back,/, 'the notice URL must come from lib/review-draft.ts');
});

/* ---------------------------------------------------------------------------
 * Two — the review they typed
 * ------------------------------------------------------------------------ */

test('what they typed comes back, and comes back to the right listing only', () => {
  const draft = parseDraft(JSON.stringify({ rating: 4, body: SENTENCE }), 2000);
  assert.deepEqual(draft, { rating: 4, body: SENTENCE });

  // Scoped to one listing's own path, so a draft about one tool cannot appear
  // under another.
  assert.equal(draftPath('receiptly'), '/tools/receiptly');
  assert.notEqual(draftPath('receiptly'), draftPath('tabsplit'));

  // Five minutes: long enough to survive a redirect, short enough that it is
  // not a surprise an hour later.
  assert.equal(DRAFT_MAX_AGE_SECONDS, 300);
  assert.equal(DRAFT_COOKIE, 'foundit_review_draft');
});

test('a cookie is a string a client can rewrite, and none of those is an exception', () => {
  for (const raw of [undefined, null, '', '   ', 'not json', '[]', '"a string"', '42',
    '{"rating":"; drop"}', '{"body":null}', '{}']) {
    assert.doesNotThrow(() => parseDraft(raw, 2000), `parseDraft threw on ${JSON.stringify(raw)}`);
  }
  assert.equal(parseDraft('{}', 2000), null, 'a draft of nothing is not a draft');
  assert.equal(parseDraft('{"rating":9}', 2000), null, 'nine stars is not a rating');
  assert.equal(parseDraft('{"rating":0}', 2000), null, 'nor is none');
  assert.deepEqual(
    parseDraft('{"rating":"3","body":"ok"}', 2000),
    { rating: 3, body: 'ok' },
    'a rating that arrived as a string is still a rating',
  );

  // The body is capped on the way out as well as in the database: a restored
  // draft is a courtesy and is not worth a large render.
  const huge = parseDraft(JSON.stringify({ rating: 5, body: 'x'.repeat(100_000) }), 2000);
  assert.equal(huge.body.length, 2000, 'the restored body must be capped');
});

test('the form renders the draft over a saved review, and the page hands it over', () => {
  const form = read('components/ReviewForm.tsx');
  assert.match(
    form,
    /const rating = draft\?\.rating \?\? mine\?\.rating \?\? null;/,
    'the draft is newer than the saved review and must win',
  );
  assert.match(form, /defaultValue=\{body\}/, 'the textarea must render the restored body');
  assert.match(form, /defaultChecked=\{rating === value\}/, 'and the stars must come back too');

  const page = read('app/tools/[slug]/page.tsx');
  assert.match(page, /parseDraft\(\(await cookies\(\)\)\.get\(DRAFT_COOKIE\)\?\.value/,
    'the tool page must read the draft cookie');
  assert.match(page, /draft=\{draft\}/, 'and pass it to the form');
});

test('the two files that promised this now describe what is there', () => {
  // The claim that was false. It is worth asserting because it was written in
  // two places and believed for a phase.
  for (const file of ['lib/rate-limit.ts', '.env.example']) {
    const source = read(file);
    assert.ok(
      !/the review they typed is still in the form/.test(source)
        || /review-draft/.test(source),
      `${file} still promises the typed review survives and does not say what makes it so`,
    );
  }
});
