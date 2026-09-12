// ===========================================================================
// Every internal link the app renders has to land on a route that exists.
//
// Seven of the nine links in the site chrome were 404s — `/submit`, `/saved`
// and `/sign-in` in the header, `/about`, `/guidelines`, `/contact` and
// `/privacy` in the footer — on every page of the site, for the whole of two
// adversarial code reviews. Nothing caught it because nothing was looking:
// each link reads perfectly well on its own, and the defect only exists in the
// relationship between a string in one file and a directory that is not in
// `app/`. The owner found it by clicking.
//
// So this walks the two halves and compares them.
//
//   The routes  are read from the filesystem, which is where Next's App Router
//               reads them from too: a directory under `app/` holding a
//               `page.tsx` is a route and nothing else is. Route groups
//               `(name)`, parallel slots `@name` and dynamic segments
//               `[slug]`, `[...rest]`, `[[...rest]]` are resolved the way the
//               router resolves them.
//
//   The links   are every path-shaped string literal in `app/`, `components/`
//               and `lib/`. Not just `href=`: half the hrefs in this codebase
//               arrive through a variable, an object (`href={{ pathname }}`)
//               or a helper that builds a query string, and a test that only
//               read attributes would have missed most of them. Comments are
//               stripped first, so prose about a route that no longer exists
//               is not mistaken for a link to it.
//
// A path with `${...}` in it becomes a `*`, which matches any one segment:
// `/tools/${slug}` is checked against the `[slug]` route rather than against a
// tool that happens to be in the database today.
//
// This is deliberately a static check and not a crawl. `npm test` runs with no
// server and no database, the route table it reads is the same one the router
// builds, and a crawl could only ever visit the pages somebody remembered to
// list — whereas a link added to a shared component tomorrow is inside this
// one automatically.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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

// --- the routes ------------------------------------------------------------

/** Every route `app/` defines, as a list of segments. `/` is the empty list. */
function routeTable() {
  const routes = [];
  for (const file of walk(join(ROOT, 'app'))) {
    const parts = rel(file).split('/');
    const name = parts.pop();
    if (!/^(page|route)\.(tsx?|jsx?|mjs)$/.test(name)) continue;

    const segments = parts
      .slice(1) // drop "app"
      .filter((s) => !(s.startsWith('(') && s.endsWith(')'))) // route groups
      .filter((s) => !s.startsWith('@')); // parallel slots

    routes.push({ segments, source: rel(file) });
  }
  return routes;
}

const ROUTES = routeTable();

/** Does one link's segments reach one route's segments? */
function reaches(link, route) {
  if (route.length === 0) return link.length === 0;

  const [head, ...rest] = route;

  // [[...rest]] swallows everything left, including nothing at all.
  if (head.startsWith('[[...') && head.endsWith(']]')) return rest.length === 0;
  // [...rest] swallows everything left, but needs at least one.
  if (head.startsWith('[...') && head.endsWith(']')) return rest.length === 0 && link.length > 0;

  if (link.length === 0) return false;
  const matched = head.startsWith('[') || link[0] === '*' || link[0] === head;
  return matched && reaches(link.slice(1), rest);
}

const resolves = (path) => {
  const segments = path.split('/').filter(Boolean);
  return ROUTES.some((route) => reaches(segments, route.segments));
};

// --- the links -------------------------------------------------------------

/**
 * Comments out, so that a sentence naming a route is not read as a link to it.
 * The `[^:]` in front of `//` is what keeps `https://` in a string from being
 * mistaken for the start of one.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** A quoted string that starts with `/` — the shape every internal path has. */
const PATH_LITERAL = /(['"`])(\/[^'"`\n\s]*)\1/g;

function linksIn(source) {
  const found = [];
  for (const [, , raw] of stripComments(source).matchAll(PATH_LITERAL)) {
    // Protocol-relative and network paths are not ours to resolve.
    if (raw.startsWith('//')) continue;
    // Interpolation stands in for one unknown segment.
    const path = raw.replace(/\$\{[^}]*\}/g, '*').split(/[?#]/)[0];
    if (path.includes('${')) continue; // a nested brace we cannot read
    found.push(path);
  }
  return found;
}

const SOURCES = [
  ...walk(join(ROOT, 'app')),
  ...walk(join(ROOT, 'components')),
  ...walk(join(ROOT, 'lib')),
].filter((path) => /\.(tsx?|jsx?|mjs)$/.test(path));

const LINKS = SOURCES.flatMap((path) =>
  linksIn(readFileSync(path, 'utf8')).map((href) => ({ href, source: rel(path) })),
);

// --- the tests -------------------------------------------------------------

test('the route table is read from app/, and is not empty', () => {
  assert.ok(ROUTES.length >= 5, `only ${ROUTES.length} routes found under app/`);

  const paths = ROUTES.map((r) => `/${r.segments.join('/')}`.replace(/^\/$/, '/'));
  for (const expected of ['/', '/browse', '/top', '/results', '/tools/[slug]']) {
    assert.ok(paths.includes(expected), `${expected} is missing from the route table`);
  }
});

test('the link scanner still finds links', () => {
  // Without this, every assertion below passes the day the scanner stops
  // matching anything — which is the one way a test like this fails silently.
  const hrefs = new Set(LINKS.map((l) => l.href));
  for (const expected of ['/', '/browse', '/top', '/tools/*']) {
    assert.ok(hrefs.has(expected), `the scanner found no link to ${expected}`);
  }
  assert.ok(LINKS.length >= 15, `only ${LINKS.length} internal links found`);
});

test('every internal link the app renders resolves to a route', () => {
  const dead = LINKS.filter((link) => !resolves(link.href))
    .map((link) => `${link.source} → ${link.href}`)
    .sort();

  assert.deepEqual(
    [...new Set(dead)],
    [],
    'these links have no route under app/ and would 404 for anyone who clicked them',
  );
});

test('the site chrome in particular, since that is on every page', () => {
  // A dead link anywhere is a bug; a dead link in the header or the footer is
  // the same bug repeated on every screen in the product, which is how seven
  // of them survived two reviews.
  for (const file of ['components/SiteHeader.tsx', 'components/SiteFooter.tsx']) {
    for (const href of linksIn(readFileSync(join(ROOT, file), 'utf8'))) {
      assert.ok(resolves(href), `${file} links to ${href}, which is not a route`);
    }
  }
});

/* ===========================================================================
 * Phase 7's eleven routes
 *
 * THE PHASE 7 REVIEW'S F14. This file reached exactly one of them — `/submit`,
 * at line 190, in the list of chrome controls — and the maker and claim routes
 * were "covered" by tests/markup.test.mjs's file-existence list, which is a
 * different question: a file being present says nothing about the router
 * resolving a path to it, and a route resolving says nothing about the page
 * answering.
 *
 * So both questions, separately.
 * ======================================================================== */

/** Every route this phase added, as a path the router has to resolve. */
const PHASE_7_ROUTES = [
  '/submit',
  '/submit/url',
  '/submit/details',
  '/submit/problems',
  '/submit/constraints',
  '/submit/preview',
  '/submit/done',
  '/claim',
  '/maker',
  '/maker/*',
  '/maker/*/edit',
];

test('every route Phase 7 added is a route the router resolves', () => {
  for (const path of PHASE_7_ROUTES) {
    assert.ok(resolves(path), `${path} is not a route under app/`);
  }
  // And the dynamic ones are dynamic rather than a literal directory called
  // "[slug]" that only matches that string.
  const paths = ROUTES.map((r) => `/${r.segments.join('/')}`);
  assert.ok(paths.includes('/maker/[slug]'), '/maker/[slug] is missing from the route table');
  assert.ok(
    paths.includes('/maker/[slug]/edit'),
    '/maker/[slug]/edit is missing from the route table',
  );
});

/**
 * The base URL to walk, or null.
 *
 * `BETTER_AUTH_URL` because that is the one variable that already says where
 * this deployment answers, and `node --env-file=.env.local --test` — the
 * command the gate runs — has it. No server, no walk, and the test says so
 * rather than failing: `npm test` runs with no server at all.
 */
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
    // Thirty seconds, because `next dev` COMPILES a route on its first
    // request: four seconds was enough for a warm server and not for a cold
    // one, which is a skip that looks exactly like a missing server.
    const response = await fetch(origin, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

/** The eleven, as concrete addresses a browser could be pointed at. */
function walkable(slug) {
  return [
    '/submit',
    '/submit/url',
    '/submit/details',
    '/submit/problems?draft=1',
    '/submit/constraints?draft=1',
    '/submit/preview?draft=1',
    '/submit/done?tool=tabsplit',
    '/claim?tool=tabsplit',
    '/maker',
    `/maker/${slug}`,
    `/maker/${slug}/edit`,
  ];
}

/**
 * Walk them, and report the status of each.
 *
 * `redirect: 'manual'`, because a 303 to /sign-in IS the answer for most of
 * these when signed out and following it would hide that. What is never
 * acceptable is a 5xx: that is what F1 was — a duplicate address answered with
 * an HTTP 500 — and it is the one thing a walk can catch that a static check
 * cannot.
 */
async function walkRoutes(origin, paths, cookie) {
  const out = [];
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(20_000),
    });
    out.push({
      path,
      status: response.status,
      location: response.headers.get('location'),
    });
  }
  return out;
}

test('every Phase 7 route answers a stranger without a 500', async (t) => {
  const origin = baseUrl();
  if (!origin || !(await reachable(origin))) {
    t.skip(
      `no server answering at ${origin ?? '(no BETTER_AUTH_URL)'}, so the routes could not be `
        + 'walked. The route table above was still checked. Start `npm run dev` to walk them.',
    );
    return;
  }

  const results = await walkRoutes(origin, walkable('receiptly'));
  for (const { path, status, location } of results) {
    assert.ok(status < 500, `${path} answered ${status} to a stranger${location ? ` -> ${location}` : ''}`);
    assert.ok(status !== 404 || path.startsWith('/maker/'), `${path} does not exist`);
  }

  // The two that MUST send a stranger to sign in rather than showing them a
  // maker's screen. The others gate inside the page and answer 200 with a
  // sign-in panel, which is the product's own pattern.
  const byPath = new Map(results.map((r) => [r.path, r]));
  for (const gated of ['/maker', '/maker/receiptly', '/maker/receiptly/edit']) {
    const row = byPath.get(gated);
    assert.ok(row, `${gated} was not walked`);
    assert.ok(
      row.status === 404 || row.status === 200 || (row.status >= 300 && row.status < 400),
      `${gated} answered ${row.status} to a stranger`,
    );
    if (row.status === 200) {
      // A 200 to a stranger is only acceptable if the BODY is not somebody's
      // dashboard — and a 200 is what Next serves here: `notFound()` in a
      // Server Component renders the not-found page, and a Server Component
      // cannot set a status code (the same limitation .env.example records for
      // the rate-limit page being a 200 rather than a 429). So the status
      // cannot tell a stranger from the maker and the body has to.
      const body = await (await fetch(`${origin}${gated}`, { redirect: 'manual' })).text();
      assert.doesNotMatch(
        body,
        /Searches matched/,
        `${gated} showed a stranger a maker's dashboard`,
      );
      assert.match(
        body,
        /Nothing here|Sign in/,
        `${gated} answered a stranger with something that is neither the not-found page `
          + 'nor the sign-in gate',
      );
    }
  }
});

test('every Phase 7 route answers the MAKER without a 500', async (t) => {
  const origin = baseUrl();
  const cookie = process.env.FOUNDIT_TEST_SESSION;
  if (!origin || !(await reachable(origin))) {
    t.skip('no server answering, so the signed-in walk could not run.');
    return;
  }
  if (!cookie || cookie.trim() === '') {
    t.skip(
      'FOUNDIT_TEST_SESSION is not set, so the signed-in walk could not run. It is a session '
        + 'cookie for an account that maintains FOUNDIT_TEST_SLUG; sign in through the flow with '
        + 'AUTH_DEV_CODE_TO_LOG=1 and pass the cookie header.',
    );
    return;
  }

  const slug = process.env.FOUNDIT_TEST_SLUG ?? 'receiptly';
  const results = await walkRoutes(origin, walkable(slug), cookie);
  for (const { path, status, location } of results) {
    assert.ok(
      status < 500,
      `${path} answered ${status} to the maker${location ? ` -> ${location}` : ''}`,
    );
  }

  // And the maker's own screens are HERS rather than a redirect to sign in.
  const byPath = new Map(results.map((r) => [r.path, r]));
  for (const own of ['/maker', `/maker/${slug}`, `/maker/${slug}/edit`]) {
    const row = byPath.get(own);
    assert.equal(row.status, 200, `${own} answered ${row.status} to the maker who maintains it`);
  }
  // The submit flow's later steps are asked for a draft that is not hers, and
  // "not yours" and "not there" are the same answer: her own listings page.
  for (const step of ['/submit/problems?draft=1', '/submit/constraints?draft=1', '/submit/preview?draft=1']) {
    const row = byPath.get(step);
    assert.ok(
      row.status === 200 || (row.status >= 300 && row.status < 400),
      `${step} answered ${row.status}`,
    );
    if (row.location) {
      assert.match(
        row.location,
        /\/maker/,
        `${step} sent her somewhere other than her own listings for a draft that is not hers`,
      );
    }
  }
});

test('no control in the chrome is a link to a screen a later phase builds', () => {
  // The three Phase 6/7 controls stay drawn — the artboards have them — but as
  // disabled controls saying so, never as anchors. If one of these paths comes
  // back as an href, either the phase shipped and the route exists (in which
  // case the check above covers it) or somebody re-introduced the 404.
  const chrome = ['components/SiteHeader.tsx', 'components/SiteFooter.tsx']
    .map((f) => readFileSync(join(ROOT, f), 'utf8'))
    .join('\n');

  for (const path of ['/submit', '/saved', '/sign-in']) {
    if (resolves(path)) continue; // the phase shipped; nothing to police
    assert.doesNotMatch(
      stripComments(chrome),
      new RegExp(`['"\`]${path}(["'\`?/])`),
      `the chrome links to ${path}, which no route serves`,
    );
  }
});
