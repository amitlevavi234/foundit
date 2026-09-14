// ===========================================================================
// The site is English, and no page may print a Hebrew or Arabic character.
//
// THE OWNER'S ITEM 1, 14 September 2026. He used the site for the first time
// and found Hebrew and Arabic sentences on it — on Browse, on tool pages, and
// inside "Why this?" on results. The interface is English, nothing on it
// offers another language, and a Hebrew sentence in the middle of an English
// page reads as a defect.
//
// THE ROWS BEHIND THEM STAY. Fifteen seeded `tool_problems` statements are in
// Hebrew or Arabic ON PURPOSE: they are what lets a Hebrew or Arabic sentence
// find those tools by MEANING through the vector leg, which is the product
// working for the person most likely to need Morfix or Almaany. So the rule is
// not "no non-English text in the database" — it is "no non-English text in
// the HTML", and `db/migrations/0022_english_only.sql` is where the two are
// separated. This file is the test that they stay separated.
//
// TWO HALVES, AND THE FIRST ONE RUNS EVERYWHERE.
//
//   1. A source sweep of `app/`, `components/` and `lib/`. A Hebrew or Arabic
//      character in any of those is a finding unless the file is in the
//      allow-list below WITH a reason — and the allow-list is asserted in both
//      directions, so an entry whose file no longer has one is a failure too
//      and the list cannot rot into a blanket exemption.
//
//   2. A walk of every route on a running production server, failing on a
//      character in the range anywhere in the response body. It SKIPS when no
//      server answers and REFUSES a `next dev` server, the same rule
//      tests/csp.test.mjs and tests/links.test.mjs follow: a dev server serves
//      an unminified bundle and compiles on first request, and neither of
//      those is the thing being measured — but more to the point, the gate is
//      supposed to be run against what ships.
//
// The range is U+0590–U+06FF: Hebrew (U+0590–U+05FF) and Arabic (U+0600–
// U+06FF), the two scripts in this catalogue and the two the owner named. It
// is deliberately not "every non-Latin script": this test says what it checks.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { refusalFor, serverKind } from './browser.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Hebrew and Arabic. Global, so a sweep can count and locate every hit. */
const NON_ENGLISH = /[֐-ۿ]/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const rel = (path) => path.slice(ROOT.length).replace(/\\/g, '/').replace(/^\/+/, '');

/**
 * The files that may hold a Hebrew or Arabic character, and why each may.
 *
 * EVERY ONE OF THESE IS A MATCHER OR A PROMPT, NEVER A STRING THAT REACHES A
 * PAGE. That is the whole distinction this file exists to police: reading a
 * Hebrew sentence is something this product does on purpose, and printing one
 * is not. A new entry here is a decision somebody has to write a reason for.
 */
const ALLOWED = {
  'lib/constraints.ts':
    'the constraint parser. It has to recognise "חינם" and "مجاني" — free — in a '
    + 'sentence somebody typed, and the two language names it matches on. Regex '
    + 'literals and nothing else; no value from this file is rendered.',
  'lib/reading.ts':
    'the "does this sentence ask for software" matcher. Recognising תוכנה and '
    + 'برنامج is what stops a Hebrew or Arabic question being refused as not '
    + 'about software.',
  'lib/reader-model.ts':
    'the reader prompt and its few-shot examples, which are sent to the model '
    + 'and never rendered.',
  'lib/handle.ts':
    'one comment, giving a Hebrew display name as an example of a handle that '
    + 'has to be transliterated rather than used.',
  'app/accessibility/page.tsx':
    'one comment, naming the Israeli accessibility regulation by its own number.',
};

test('no Hebrew or Arabic in app/, components/ or lib/ except where it is a matcher', () => {
  const offenders = [];
  const seen = new Set();

  for (const dir of ['app', 'components', 'lib']) {
    for (const file of walk(join(ROOT, dir))) {
      if (!/\.(tsx?|jsx?|mjs|css)$/.test(file)) continue;
      const path = rel(file);
      const source = readFileSync(file, 'utf8');
      const hits = source.match(NON_ENGLISH);
      if (!hits) continue;
      if (ALLOWED[path]) {
        seen.add(path);
        continue;
      }
      offenders.push(`${path} — ${hits.length} character(s), first at ${source.search(NON_ENGLISH)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Hebrew or Arabic in a file that renders. The site is English '
      + '(docs/product-decisions.md §14): a statement in another script stays in the '
      + 'database for the vector leg and is filtered out of every query that prints '
      + 'one (db/migrations/0022_english_only.sql). If this is a matcher or a prompt '
      + 'rather than something rendered, add it to ALLOWED in this file with the '
      + 'reason.\n  ' + offenders.join('\n  '),
  );

  // And the other direction, so the list cannot rot. An entry whose file no
  // longer contains one of these characters is an exemption nobody needs, and
  // a stale exemption is how the next real one gets waved through.
  const stale = Object.keys(ALLOWED).filter((path) => !seen.has(path));
  assert.deepEqual(stale, [], `ALLOWED names ${stale.join(', ')}, which no longer has a Hebrew or Arabic character in it. Remove the entry.`);
});

/* ---------------------------------------------------------------------------
 * The live walk.
 * ------------------------------------------------------------------------ */

/**
 * Concrete values for the dynamic segments — the same table tests/csp.test.mjs
 * uses, plus the three listings this item is actually about. `morfix`,
 * `dicta-nakdan` and `almaany` are the three whose summaries carried a Hebrew
 * or Arabic phrase and whose problem statements still do; a walk that did not
 * include them would pass without testing anything.
 */
const SEGMENT_VALUES = {
  slug: 'morfix',
  handle: 'nobody-here',
  token: 'not-a-real-share-token',
  collection: 'saved',
};

const EXTRA_PATHS = [
  '/tools/dicta-nakdan',
  '/tools/almaany',
  '/tools/anki',
  '/tools/duolingo',
  '/tools/gimp',
  '/tools/organic-maps',
  '/browse?in=language',
  // The three sentences whose answers are the listings with non-English
  // statements on them: the vector leg has to find them and the page has to
  // print nothing of what it matched on.
  '/results?q=' + encodeURIComponent('I need a Hebrew English dictionary'),
  '/results?q=' + encodeURIComponent('help me learn Arabic vocabulary'),
  '/results?q=' + encodeURIComponent('add vowel points to Hebrew text'),
];

function routePaths() {
  const paths = [];
  for (const file of walk(join(ROOT, 'app'))) {
    const parts = rel(file).split('/');
    const name = parts.pop();
    if (!/^page\.(tsx?|jsx?|mjs)$/.test(name)) continue;

    const segments = parts
      .slice(1)
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
      .filter((s) => !s.startsWith('@'));

    let skip = false;
    const concrete = segments.map((segment) => {
      const dynamic = /^\[+\.{0,3}([^\]]+)\]+$/.exec(segment);
      if (!dynamic) return segment;
      const value = SEGMENT_VALUES[dynamic[1]];
      if (value === undefined) skip = true;
      return value;
    });
    if (skip) continue;

    paths.push(`/${concrete.join('/')}`);
  }
  return [...new Set(paths)].sort();
}

function baseUrl() {
  const raw = process.env.FOUNDIT_BASE_URL ?? process.env.BETTER_AUTH_URL ?? '';
  if (raw.trim() === '') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

async function reachable(origin) {
  try {
    const response = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function usable(t, origin) {
  if (!origin || !(await reachable(origin))) {
    t.skip(
      `no server answering at ${origin ?? '(no BETTER_AUTH_URL)'}. Start one with `
        + '`npm run build && npm start` and run this again.',
    );
    return false;
  }
  const kind = await serverKind(origin);
  if (kind !== 'production') assert.fail(refusalFor(origin, kind));
  return true;
}

test('the route walk covers the three listings this is about', () => {
  const paths = [...routePaths(), ...EXTRA_PATHS];
  assert.ok(paths.length >= 30, `only ${paths.length} routes — the walk is broken`);
  for (const one of ['/tools/morfix', '/tools/dicta-nakdan', '/tools/almaany', '/browse', '/']) {
    assert.ok(paths.includes(one), `${one} is not in the walk`);
  }
});

test('no route prints a Hebrew or Arabic character', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const paths = [...routePaths(), ...EXTRA_PATHS];
  const offenders = [];

  for (const path of paths) {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    // A redirect has no body worth reading; a 404 does, and its page has a
    // header and a footer on it like any other.
    if (response.status >= 300 && response.status < 400) continue;
    const body = await response.text();
    const at = body.search(NON_ENGLISH);
    if (at === -1) continue;
    offenders.push(
      `${path} (${response.status}): ${JSON.stringify(body.slice(Math.max(0, at - 70), at + 70))}`,
    );
  }

  assert.deepEqual(
    offenders,
    [],
    'a page printed a Hebrew or Arabic character. The statements stay in the '
      + 'database for the vector leg and are filtered out of every query that '
      + 'renders one — see db/migrations/0022_english_only.sql and '
      + 'docs/product-decisions.md §14.\n  ' + offenders.join('\n  '),
  );
});
