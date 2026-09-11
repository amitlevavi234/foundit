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
