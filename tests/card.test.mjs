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

const BASE = {
  name: 'Splitwise',
  slug: 'splitwise',
  summary: 'Tracks shared expenses in a group.',
  href: '/tools/splitwise?q=split%20the%20bill',
  url: 'https://www.splitwise.com',
  rating: '4.5',
  ratingCount: '12',
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
