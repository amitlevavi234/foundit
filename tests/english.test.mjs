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
// THE RANGE IS NOT WRITTEN OUT HERE ANY MORE — OWNER FEEDBACK, ROUND 1, F14.
// It used to be, and `db/migrations/0022_english_only.sql` wrote the same range
// out a second time in its generated column, and both were too narrow in the
// same way: Hebrew and Arabic also live in Arabic Supplement (U+0750–077F),
// Arabic Extended-A (U+08A0–08FF), Alphabetic Presentation Forms (U+FB1D–FB4F)
// and Arabic Presentation Forms A and B (U+FB50–FDFF, U+FE70–FEFF), which is
// what text pasted out of a PDF or an older Windows application looks like. So
// the test agreed with the gap instead of catching it.
//
// There is now ONE list of ranges, in `db/non-english-script.mjs`, and both
// ends derive from it: this file builds its regular expression from
// `jsClass()`, `db/migrations/0031_english_script_widened.sql` contains
// `sqlClass()` verbatim, and the third test below asserts that it still does.
// Widening one of the two is no longer possible without failing that test.
//
// It is still deliberately not "every non-Latin script": a statement in French
// or in Russian is not caught, nothing in this catalogue is in either, and this
// test says what it checks.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

import { jsClass, sqlClass } from '../db/non-english-script.mjs';
import { refusalFor, serverKind } from './browser.mjs';
import { cleanUp, mintSession } from './throwaway.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Hebrew and Arabic, in every block either can appear in. Global, so a sweep
 * can count and locate every hit — and a FUNCTION rather than a constant,
 * because a global regular expression carries `lastIndex` between calls and a
 * shared one silently skips half a file.
 */
const nonEnglish = () => new RegExp(jsClass(), 'g');

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
      const hits = source.match(nonEnglish());
      if (!hits) continue;
      if (ALLOWED[path]) {
        seen.add(path);
        continue;
      }
      offenders.push(`${path} — ${hits.length} character(s), first at ${source.search(nonEnglish())}`);
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

test('the schema and this test mean the same by "Hebrew or Arabic"', () => {
  // OWNER FEEDBACK, ROUND 1, F14. The range lived in two files and both were
  // too narrow in the same way, so the test agreed with the gap. It now lives
  // in one — `db/non-english-script.mjs` — and this is the assertion that the
  // migration still contains what that module renders, character for
  // character. Widening one without the other fails here.
  const migration = readFileSync(
    join(ROOT, 'db', 'migrations', '0031_english_script_widened.sql'),
    'utf8',
  );
  assert.ok(
    migration.includes(sqlClass()),
    'db/migrations/0031_english_script_widened.sql does not contain '
      + `${sqlClass()}, which is what db/non-english-script.mjs renders. The generated `
      + 'column and this test are supposed to be two spellings of one list of ranges; '
      + 'if the ranges changed, the migration that changes them is a NEW one and this '
      + 'assertion should name it.',
  );

  // And the two spellings really do describe the same code points, rather than
  // merely both existing. One character from each end of every range.
  const re = new RegExp(jsClass(), 'u');
  for (const [lo, hi] of [
    [0x0590, 0x06ff],
    [0x0750, 0x077f],
    [0x08a0, 0x08ff],
    [0xfb1d, 0xfb4f],
    [0xfb50, 0xfdff],
    [0xfe70, 0xfeff],
  ]) {
    for (const code of [lo, hi]) {
      assert.ok(
        re.test(String.fromCodePoint(code)),
        `U+${code.toString(16).toUpperCase()} is in the schema's class and not in this test's`,
      );
    }
  }
  // And a Latin letter is in neither, so the class is not simply "everything".
  assert.equal(re.test('a'), false, 'the class matches an ordinary Latin letter');
  assert.equal(re.test('é'), false, 'the class matches an accented Latin letter');
});

test('the route walk covers the three listings this is about', () => {
  const paths = [...routePaths(), ...EXTRA_PATHS];
  assert.ok(paths.length >= 30, `only ${paths.length} routes — the walk is broken`);
  for (const one of ['/tools/morfix', '/tools/dicta-nakdan', '/tools/almaany', '/browse', '/']) {
    assert.ok(paths.includes(one), `${one} is not in the walk`);
  }
});

/** One walk of every route, with whatever cookie is handed to it. */
async function walkRoutes(origin, cookie, extra = []) {
  const paths = [...new Set([...routePaths(), ...EXTRA_PATHS, ...extra])];
  const offenders = [];
  const seen = [];

  for (const path of paths) {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(60_000),
    });
    seen.push({ path, status: response.status });
    // A redirect has no body worth reading; a 404 does, and its page has a
    // header and a footer on it like any other.
    if (response.status >= 300 && response.status < 400) continue;
    const body = await response.text();
    const at = body.search(nonEnglish());
    if (at === -1) continue;
    offenders.push(
      `${path} (${response.status}): ${JSON.stringify(body.slice(Math.max(0, at - 70), at + 70))}`,
    );
  }
  return { offenders, seen };
}

const WHY_IT_MATTERS =
  'a page printed a Hebrew or Arabic character. The statements stay in the '
  + 'database for the vector leg and are filtered out of every query that '
  + 'renders one — see db/migrations/0022_english_only.sql, '
  + 'db/migrations/0031_english_script_widened.sql and '
  + 'docs/product-decisions.md §14.\n  ';

test('no route prints a Hebrew or Arabic character', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const { offenders } = await walkRoutes(origin, null);
  assert.deepEqual(offenders, [], WHY_IT_MATTERS + offenders.join('\n  '));
});

/* ---------------------------------------------------------------------------
 * THE SAME WALK, SIGNED IN, AS A MAKER WHO OWNS A LISTING WITH A NON-ENGLISH
 * STATEMENT ON IT — OWNER FEEDBACK, ROUND 1, F19.
 *
 * The walk above is signed out, so `/admin`, `/admin/reviews`, `/maker/<slug>`,
 * `/settings`, `/saved` and most of `/submit` answer 404 or redirect and are
 * skipped by the `>= 300 && < 400` line. `lib/tool-sql.ts`'s
 * `MAKER_DASHBOARD_SQL` is one of the five places 0022 names as printing a
 * statement, and it was therefore never exercised by the test that exists to
 * guard it: the maker dashboard is only reachable by the maker.
 *
 * So this mints a throwaway account the way tests/no-script.test.mjs does,
 * makes it the owner of a listing that really does carry a Hebrew statement,
 * walks the same list a second time with its cookie, and then puts the listing
 * back and deletes the account. If the listing's ownership is not restored the
 * catalogue is left wrong, so the restore is in a `finally` and runs even when
 * an assertion fails.
 * ------------------------------------------------------------------------ */
test('no route prints a Hebrew or Arabic character, signed in as its maker', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;
  if (!process.env.DATABASE_URL_OWNER || !process.env.DATABASE_URL_AUTH) {
    t.skip('DATABASE_URL_OWNER and DATABASE_URL_AUTH are needed to mint a throwaway maker');
    return;
  }

  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  /** In the owner's window (0020 §2), which is the only way to read or write these rows. */
  const asOwner = async (sql, params) => {
    const client = await owner.connect();
    try {
      await client.query('begin');
      await client.query("select pg_catalog.set_config('foundit.definer','on',true)");
      const result = await client.query(sql, params);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };

  const session = await mintSession(origin, 'english-walk');
  let listing = null;

  try {
    // A published listing that really carries a statement in the range. Read
    // rather than hardcoded: `morfix` is the one today, and a seed that
    // renamed it would otherwise make this test pass by testing nothing.
    const { rows } = await asOwner(
      `select t.id, t.slug::text as slug, t.owner_id
         from public.tools t
         join public.tool_problems tp on tp.tool_id = t.id
        where tp.non_english_script
          and t.status = 'published'
        order by t.id
        limit 1`,
    );
    listing = rows[0] ?? null;
    assert.ok(
      listing,
      'no published listing carries a non-English statement, so this test would pass '
        + 'without exercising the maker dashboard at all',
    );

    // A SIGNED-IN REQUEST FIRST, because `public.profiles` is written lazily:
    // Better Auth creates the row in `auth_core."user"` and the application
    // creates the profile the first time that account asks for a page. Setting
    // `tools.owner_id` before that is a foreign key violation, and the error it
    // gives says nothing about why.
    await fetch(`${origin}/settings`, {
      headers: { cookie: session.cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    const { rows: profile } = await asOwner('select id from public.profiles where id = $1', [
      session.userId,
    ]);
    assert.equal(
      profile.length,
      1,
      'the throwaway account has no profile yet, so it cannot own a listing',
    );

    await asOwner('update public.tools set owner_id = $1 where id = $2', [
      session.userId,
      listing.id,
    ]);

    // The maker's own dashboard, by the slug this test actually took over. The
    // generated walk uses one concrete slug for `[slug]` segments and it is not
    // necessarily this one.
    const { offenders, seen } = await walkRoutes(origin, session.cookie, [
      `/maker/${listing.slug}`,
      `/tools/${listing.slug}`,
    ]);

    // The point of signing in is that these stop being 404s and redirects. If
    // they have not, the walk covered no more than the signed-out one did and
    // saying "passed" would be false.
    const maker = seen.find((s) => s.path === `/maker/${listing.slug}`);
    assert.ok(maker, `/maker/${listing.slug} is not in the walk`);
    assert.equal(
      maker.status,
      200,
      `the throwaway maker could not open /maker/${listing.slug} (${maker.status}), so `
        + 'MAKER_DASHBOARD_SQL was not exercised',
    );
    const settings = seen.find((s) => s.path === '/settings');
    assert.equal(settings?.status, 200, 'the signed-in walk did not reach /settings');

    assert.deepEqual(offenders, [], WHY_IT_MATTERS + offenders.join('\n  '));
  } finally {
    // The catalogue goes back exactly as it was, whatever happened above.
    if (listing) {
      await asOwner('update public.tools set owner_id = $1 where id = $2', [
        listing.owner_id,
        listing.id,
      ]);
    }
    await owner.end();
    await cleanUp(session);
  }
});

/* ---------------------------------------------------------------------------
 * THE SHELL IS NEVER INSIDE A SUSPENSE BOUNDARY — OWNER FEEDBACK, ROUND 1, F2.
 *
 * Five routes had a `loading.tsx`, which Next compiles into a Suspense
 * boundary around the whole segment. React streams the fallback first and
 * sends the real subtree later inside `<div hidden id="S:n">`, followed by an
 * inline script that swaps it in — so with scripting refused the page stayed on
 * its skeleton for ever and the search box, the Save and Like forms, the
 * review form, the fit scales and the stars were all in the document and all
 * invisible. `components/SearchField.tsx` claimed twice that it "works with
 * JavaScript switched off", and the markup really did; the page did not.
 *
 * No assertion about markup could have caught that, which is why this one is
 * about POSITION: parse the HTML, find every hidden Suspense subtree, and
 * check what is left. The shell — the header, the search form, and on a tool
 * page the Save, Like and Review forms and the rating stars — has to be
 * OUTSIDE all of them. What may be inside is the data list and only the data
 * list, which is the arrangement each page's own header describes.
 * ------------------------------------------------------------------------ */

/** The contents of every `<div hidden id="S:n">`, by walking the tags. */
function hiddenSubtrees(html) {
  const out = [];
  const opener = /<div hidden id="S:[^"]*">/g;
  let start;
  while ((start = opener.exec(html)) !== null) {
    const from = start.index + start[0].length;
    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = from;
    let depth = 1;
    let end = html.length;
    let tag;
    while (depth > 0 && (tag = tags.exec(html)) !== null) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) end = tag.index;
    }
    out.push(html.slice(from, end));
  }
  return out;
}

/** The document with every hidden Suspense subtree taken out of it. */
function shellOf(html) {
  let shell = html;
  for (const hidden of hiddenSubtrees(html)) shell = shell.replace(hidden, '');
  return shell;
}

test('the shell of every main route renders outside any Suspense boundary', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const query = encodeURIComponent('a free way to split expenses on a trip');
  const routes = [
    { path: '/', wants: ['<form'] },
    { path: '/browse', wants: ['<form'] },
    { path: '/top', wants: [] },
    { path: `/results?q=${query}`, wants: ['<form'] },
    { path: '/tools/anki', wants: ['<form', 'class="stars"'] },
  ];

  for (const route of routes) {
    const html = await (
      await fetch(`${origin}${route.path}`, { signal: AbortSignal.timeout(60_000) })
    ).text();
    const shell = shellOf(html);
    const hidden = hiddenSubtrees(html).join('');

    for (const wanted of route.wants) {
      assert.ok(
        shell.includes(wanted),
        `${route.path} renders no ${wanted} outside a hidden Suspense subtree. That is F2: `
          + 'the page is a skeleton until a script runs, whatever the markup says.',
      );
    }

    // AND NOTHING THAT IS PART OF THE SHELL IS HIDDEN. A form, a fit scale or a
    // star inside a hidden subtree on one of these four is the defect coming
    // back: `/results` is the one route whose data list legitimately carries
    // all three, and its own boundary is around the answer alone.
    if (route.path !== `/results?q=${query}`) {
      for (const forbidden of ['<form', 'class="fitscale"', 'class="stars"']) {
        assert.ok(
          !hidden.includes(forbidden),
          `${route.path} streams ${forbidden} inside <div hidden id="S:…">, so it is invisible `
            + 'without script. Only the data list may sit in a Suspense slot.',
        );
      }
    }
  }

  // And the boundaries that are left are the ones the pages describe: `/` ,
  // `/browse` and `/top` defer a catalogue list, `/results` defers the answer,
  // and `/tools/[slug]` defers nothing at all.
  const tool = await (
    await fetch(`${origin}/tools/anki`, { signal: AbortSignal.timeout(60_000) })
  ).text();
  assert.equal(
    hiddenSubtrees(tool).length,
    0,
    'the tool page streams part of itself into a hidden subtree; it is one round trip and '
      + 'has nothing to defer',
  );
});
