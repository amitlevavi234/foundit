// ===========================================================================
// The result card, rendered — not read as source.
//
// The owner asked for calmer cards: how a result matched does not need to be
// on the face of every card (docs/product-decisions.md §6, amended 11
// September 2026). The match label, its note and the matched statement now
// live behind a "Why this?" disclosure, and the constraint chips stay where
// they were. Both halves of that break silently — a prop rendered one level
// too high puts the pill straight back on every card, and nothing fails.
//
// Node strips TypeScript types but does not compile JSX, so the other tests in
// this folder read component SOURCE. This one renders the real component to
// static HTML: the two load hooks below compile .tsx with the TypeScript the
// repository already has, resolve the `@/` alias, and stand in for next/link
// with a plain anchor. What is asserted is the markup a browser would receive.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = new URL('..', import.meta.url);

// next/link needs the router; a card rendered to a string does not. The stub
// renders the anchor Link would, which is all a test of the card's markup needs.
const REACT_URL = import.meta.resolve('react');
const LINK_STUB =
  'data:text/javascript,' +
  encodeURIComponent(
    `import React from ${JSON.stringify(REACT_URL)};\n` +
      'export default function Link({ href, children, prefetch, ...rest }) {\n' +
      "  const to = typeof href === 'string' ? href : (href && href.pathname) || '#';\n" +
      "  return React.createElement('a', { href: to, ...rest }, children);\n" +
      '}\n',
  );

/**
 * The Server Actions the card's outbound link posts to.
 *
 * Since Phase 8 `components/OutboundLink.tsx` is a client component that tells
 * the server a link out was followed (docs/product-decisions.md §12), so
 * importing the card now pulls in `app/tools/actions.ts` — and that pulls in
 * next/cache, next/navigation, the connection pool and the authentication
 * library, none of which a test of MARKUP has any business starting.
 *
 * A `'use server'` module is a reference on the client and never code, so
 * standing in for it with functions that do nothing is exactly what the
 * browser receives. What this test asserts is the HTML, and the HTML is the
 * same either way.
 */
const ACTIONS_STUB =
  'data:text/javascript,' +
  encodeURIComponent(
    'export async function recordOpen() {}\n' +
      'export async function toggleLike() {}\n' +
      'export async function postReview() {}\n' +
      'export async function removeMyReview() {}\n',
  );

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/link') return { url: LINK_STUB, shortCircuit: true };
    if (specifier === '@/app/tools/actions') return { url: ACTIONS_STUB, shortCircuit: true };

    let target = specifier;
    if (target.startsWith('@/')) target = new URL(target.slice(2), ROOT).href;

    const relative = target.startsWith('./') || target.startsWith('../') || target.startsWith('file:');
    if (relative && context.parentURL && !context.parentURL.startsWith('data:')) {
      // Extensionless imports, the way the bundler resolves them.
      for (const ext of ['', '.tsx', '.ts']) {
        const url = new URL(target + ext, context.parentURL);
        if (isFile(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.tsx')) {
      const path = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
        fileName: path,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { createElement } = await import('react');
const { default: ReactDOMServer } = await import('react-dom/server');
const { ToolCard } = await import('../components/ToolCard.tsx');

const render = (props) => ReactDOMServer.renderToStaticMarkup(createElement(ToolCard, props));

/*
 * NUMBERS, NOT STRINGS — OWNER FEEDBACK, ROUND 1, F18.
 *
 * `rating` and `ratingCount` changed from strings to numbers when the owner's
 * item 2b landed (`app/components/page.tsx` and `app/results/page.tsx` were
 * both updated) and this file was not. `ToolCard` asks
 * `typeof rating === 'number' && typeof ratingCount === 'number'`, so these
 * props took the "no reviews" branch: the one test in the repository that
 * renders a card was rendering a card no page can produce, and every assertion
 * below it was about the wrong card.
 */
const BASE = {
  name: 'Splitwise',
  slug: 'splitwise',
  summary: 'Tracks shared expenses in a group.',
  href: '/tools/splitwise?q=split%20the%20bill',
  url: 'https://www.splitwise.com',
  rating: 4.5,
  ratingCount: 12,
  likes: '3',
};

const EXPLAINED = {
  ...BASE,
  band: {
    label: 'Matched: problem + description',
    note: 'Your words turned up in a problem this tool lists and in its own description.',
    tone: 'both',
  },
  whyLabel: 'The statement your words matched.',
  why: '“Six of us went away and now there are twenty small debts flying about”',
  satisfactions: [
    { label: 'Free', met: true },
    { label: 'Works offline', met: false },
  ],
};

/** The <details> element, and the card with it cut out. */
function split(html) {
  const found = /<details\b[^>]*>[\s\S]*?<\/details>/.exec(html);
  return { disclosure: found ? found[0] : null, outside: found ? html.replace(found[0], '') : html };
}

test('the match pill, its note and the matched statement render only inside "Why this?"', () => {
  const html = render(EXPLAINED);
  const { disclosure, outside } = split(html);

  assert.ok(disclosure, 'a card with an explanation renders a <details> disclosure');

  for (const needle of [
    'Matched:',
    'band-label',
    'class="band',
    'Your words turned up',
    'Six of us went away',
    'The statement your words matched',
  ]) {
    assert.ok(!outside.includes(needle), `"${needle}" is on the face of the card, outside "Why this?"`);
    assert.ok(disclosure.includes(needle), `"${needle}" is missing from inside "Why this?"`);
  }
});

test('"Why this?" is a real, closed disclosure with a named summary', () => {
  const { disclosure } = split(render(EXPLAINED));

  assert.match(disclosure, /^<details class="whythis">/, 'closed by default: no `open` attribute');
  assert.doesNotMatch(disclosure, /<details[^>]*\sopen/);
  // <summary> is what makes it keyboard-operable with no script: the browser
  // makes it focusable, toggles it on Enter and Space, and exposes its state.
  assert.match(disclosure, /<summary class="whythis-toggle">[\s\S]*?Why this\?[\s\S]*?<\/summary>/);
  // Twelve cards each with a control called only "Why this?" is twelve
  // identical names in a screen reader's list of controls.
  assert.match(disclosure, /<span class="sr-only"> \(Splitwise\)<\/span>/);
});

test('the constraint chips stay on the face of the card, met and unmet alike', () => {
  const { outside } = split(render(EXPLAINED));

  // Phase 5's non-negotiable: constraints shown as met or unmet on every
  // result. Neither may be tucked away behind the disclosure.
  assert.ok(outside.includes('Free'), 'a met constraint is visible');
  assert.ok(outside.includes('Works offline'), 'an unmet constraint is visible');
  assert.match(outside, /class="sat unmet"/, 'and the unmet one is drawn as unmet');
});

test('everything else a person decides with is still on the card', () => {
  const { outside } = split(render(EXPLAINED));

  assert.match(outside, /<a href="\/tools\/splitwise\?q=split%20the%20bill" class="toolcard-name">Splitwise<\/a>/);
  assert.ok(outside.includes('Tracks shared expenses in a group.'), 'summary');
  assert.ok(outside.includes('people found this useful'), 'likes, with their words');
  assert.match(outside, />\s*Save\s*</, 'Save');
  assert.match(outside, /href="https:\/\/www\.splitwise\.com\/?"/, 'the link out');
  assert.match(outside, /rel="noopener noreferrer"/);
  assert.ok(outside.includes('splitwise.com'), 'the domain beside it');
});

test('no card prints a percentage, and a card with nothing to explain has no disclosure', () => {
  const explained = render(EXPLAINED);
  assert.doesNotMatch(explained, /\d\s*%/, 'no fit percentage until Phase 5 calibrates one');
  assert.doesNotMatch(explained, /class="(fm|meter)\b/, 'no fit meter over a named tool');

  const plain = render({ ...BASE, facts: ['Freemium'] });
  assert.doesNotMatch(plain, /<details/, 'nothing to explain, so nothing to open');
  assert.doesNotMatch(plain, /Why this\?/);
  assert.ok(plain.includes('Freemium'), 'the neutral facts still render');
});

test('the results page hands the match to the card and never draws it itself', () => {
  // The disclosure only helps if the page does not put the pill back beside
  // the card. The page is a server component with a database behind it, so
  // this half is a source check: no band markup anywhere in the page file.
  const page = readFileSync(new URL('app/results/page.tsx', ROOT), 'utf8');
  assert.doesNotMatch(page, /className=["'{`][^"'}`]*\bband\b/, 'the results page draws a band itself');
  assert.doesNotMatch(page, /className=["'{`][^"'}`]*\bwhy\b/, 'the results page draws the why box itself');
  assert.ok(existsSync(new URL('components/ToolCard.tsx', ROOT)));
});

/* ===========================================================================
 * THE WHOLE OF THE OWNER'S ITEM 2, WHICH SHIPPED WITH NO TEST AT ALL —
 * OWNER FEEDBACK, ROUND 1, F10 and F18.
 *
 * Nothing in this directory asserted the stars, the fit scale, "No reviews
 * yet" or the legend:
 *
 *     $ grep -rln "No reviews yet\|reviewCount\|FitScale\|fitscale" tests/
 *     (no matches)
 *
 * These are pure markup and the harness above already renders components, so
 * "a test cannot express it" was never true of any of them.
 * ======================================================================== */
const { Stars, starFill } = await import('../components/Stars.tsx');
const { FitScale } = await import('../components/FitScale.tsx');
const { FIT_LEGEND } = await import('../lib/rerank.ts');

const renderOne = (component, props) =>
  ReactDOMServer.renderToStaticMarkup(createElement(component, props));

/** How many of the five stars are drawn coral, and whether one is a half. */
function starsDrawn(html) {
  const svgs = html.match(/<svg\b[\s\S]*?<\/svg>/g) ?? [];
  // A nested `<svg>` is the half, and the naive match above swallows its
  // closing tag — so count on the outer five by splitting on the fill.
  const full = (html.match(/fill="var\(--c-coral\)" stroke="var\(--c-ink\)"/g) ?? []).length;
  const half = (html.match(/<svg x="0" y="0" width="12" height="24"/g) ?? []).length;
  return { svgs: svgs.length, full, half };
}

test('a rating never draws more stars than the number beside it', () => {
  // F10. `Math.round` filled 4.5 as five, which is what 5.0 looks like, and
  // drew 3.5 and 4.4 identically as four. The screen-reader name was right in
  // every case; only the picture was wrong, for the people reading the picture.
  const cases = [
    [5, 5, false, 'five full and no half'],
    [4.5, 4, true, 'four full and ONE HALF — never five'],
    [4.4, 4, false, 'four, and no half: 0.4 is not half way'],
    [4, 4, false, 'four'],
    [3.5, 3, true, 'three and a half'],
    [0, 0, false, 'none at all'],
  ];

  for (const [rating, full, half, why] of cases) {
    const drawn = starFill(rating);
    assert.equal(drawn.full, full, `starFill(${rating}).full should be ${full}: ${why}`);
    assert.equal(drawn.half, half, `starFill(${rating}).half should be ${half}: ${why}`);

    const html = renderOne(Stars, { rating, label: `${rating.toFixed(1)} out of 5` });
    const picture = starsDrawn(html);
    assert.equal(picture.full, full, `Stars(${rating}) drew ${picture.full} filled: ${why}`);
    assert.equal(picture.half, half ? 1 : 0, `Stars(${rating}) drew the half wrongly: ${why}`);
    // The drawing never claims more than the number, which is the rule.
    assert.ok(
      full + (half ? 0.5 : 0) <= rating,
      `Stars(${rating}) drew ${full + (half ? 0.5 : 0)} stars, which is more than the rating`,
    );
    // And the accessible name is still the number itself.
    assert.ok(
      html.includes(`aria-label="${rating.toFixed(1)} out of 5"`),
      `Stars(${rating}) lost its accessible name`,
    );
  }

  // 4.9 is the case that catches a "round the half up" fix: four and a half,
  // never five, because nobody has given it five.
  assert.deepEqual(starFill(4.9), { full: 4, half: true });
  // And a rating outside the scale is clamped rather than drawn off the end.
  assert.deepEqual(starFill(7), { full: 5, half: false });
  assert.deepEqual(starFill(-1), { full: 0, half: false });
  assert.deepEqual(starFill(Number.NaN), { full: 0, half: false });
});

test('a card with reviews draws stars, and a card with none draws the words', () => {
  // F18. `BASE` now passes numbers, which is what every page passes, so this
  // renders the card a page can actually produce.
  const withReviews = render(BASE);
  assert.match(
    withReviews,
    /<span class="stars" role="img" aria-label="4\.5 out of 5">/,
    'a rated card draws the stars with the number as their accessible name',
  );
  assert.equal(
    starsDrawn(withReviews).full,
    4,
    'a 4.5 card draws four full stars, not five',
  );
  assert.equal(starsDrawn(withReviews).half, 1, 'and one half');
  assert.match(withReviews, /<strong[^>]*>4\.5<\/strong>/, 'and prints the number beside them');
  assert.match(withReviews, /12 reviews/, 'and how many reviews it is out of');
  assert.ok(
    !withReviews.includes('No reviews yet'),
    'a card with twelve reviews must not say it has none',
  );

  // NO STARS AT ALL rather than five empty ones: five empty stars is a rating
  // of zero drawn in the shape of a rating, and nobody has given this one.
  const none = render({ ...BASE, rating: undefined, ratingCount: undefined });
  assert.match(none, /<span class="muted">No reviews yet<\/span>/);
  assert.ok(!none.includes('class="stars"'), 'a card with no reviews draws no stars');

  // And a listing that exists with zero reviews recorded is the same case.
  const zero = render({ ...BASE, rating: 0, ratingCount: 0 });
  assert.ok(zero.includes('No reviews yet'), 'a count of zero is "no reviews yet"');
  assert.ok(!zero.includes('class="stars"'), 'and still draws no stars');
});

test('the fit scale draws three positions and says which it is', () => {
  const seen = [];
  for (const [steps, label] of [[3, 'Strong'], [2, 'Possible'], [1, 'Loose']]) {
    const html = renderOne(FitScale, { steps, label });
    seen.push(html);
    assert.match(
      html,
      new RegExp(`aria-label="${label}: ${steps} of 3 on the fit scale\."`),
      `the ${label} scale does not name itself`,
    );
    assert.equal(
      (html.match(/class="fitscale-on"/g) ?? []).length,
      steps,
      `${label} should fill ${steps} of three`,
    );
    assert.equal(
      (html.match(/class="fitscale-off"/g) ?? []).length,
      3 - steps,
      `${label} should leave ${3 - steps} empty`,
    );
  }
  // Three different pictures, which is the whole point: a word has no position
  // and three bars do.
  assert.equal(new Set(seen).size, 3, 'two of the three fit scales are drawn identically');
});

test('the legend is the owner’s words, and the third entry is honest about itself', () => {
  // Overclaim 8. The write-up said the three entries were "his words verbatim:
  // does exactly this / does part of it / same area". The third rendered as
  // "same area — never shown", because `applyRerank` stops at Possible since
  // the precision decision, so a Loose result never reaches a page.
  //
  // Both halves are true and they are different statements, so they are two
  // fields now: the owner's words, and the note about the threshold.
  assert.deepEqual(
    FIT_LEGEND.map((entry) => entry.means),
    ['does exactly this', 'does part of it', 'same area'],
    'the legend must render the owner’s words and nothing appended to them',
  );
  assert.deepEqual(
    FIT_LEGEND.map((entry) => entry.note ?? null),
    [null, null, 'never shown'],
    'and the fact that a Loose result is never shown is a separate, muted note',
  );
  assert.deepEqual(FIT_LEGEND.map((entry) => entry.steps), [3, 2, 1]);
  assert.deepEqual(FIT_LEGEND.map((entry) => entry.label), ['Strong', 'Possible', 'Loose']);
});
