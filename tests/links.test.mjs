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
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { hashSignInCode } from '../lib/auth-options.ts';
import { SET_IDENTITY_SQL, identityParams } from '../lib/identity.ts';

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

/**
 * Absolute paths that are not routes and were never meant to be.
 *
 * The scanner looks for a quoted string starting with `/`, which is the shape
 * every internal link has — and also the shape a path ON THE MACHINE has. The
 * list is exhaustive and each entry needs a reason here, for the same reason
 * the fetch allow-list in tests/markup.test.mjs does: a rule with no exception
 * gets deleted the first time one is needed, and a rule with an unwritten
 * exception is a rule nobody can check.
 *
 *   /proc/meminfo  lib/server-stats.ts, for the Server panel's swap figure.
 *                  Node's `os` has no swap at all, so it comes from the file
 *                  Linux reports it in — and on a machine with no /proc the
 *                  panel says "not available from this process" rather than
 *                  drawing a zero.
 */
const NOT_ROUTES = new Set(['/proc/meminfo']);

const SOURCES = [
  ...walk(join(ROOT, 'app')),
  ...walk(join(ROOT, 'components')),
  ...walk(join(ROOT, 'lib')),
].filter((path) => /\.(tsx?|jsx?|mjs)$/.test(path));

const LINKS = SOURCES.flatMap((path) =>
  linksIn(readFileSync(path, 'utf8'))
    .filter((href) => !NOT_ROUTES.has(href))
    .map((href) => ({ href, source: rel(path) })),
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
      signal: AbortSignal.timeout(60_000),
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

/**
 * The same eleven routes, SIGNED IN.
 *
 * IT NO LONGER SKIPS, which is the other half of the Phase 8 review's F12.
 * This used to require `FOUNDIT_TEST_SESSION` by hand and nothing anywhere
 * supplied it, so a walk that exists to find 5xx answers — F1 was a duplicate
 * address answered with an HTTP 500 — had never run in CI at all.
 *
 * TWO MODES, and the stronger one is still available:
 *
 *   FOUNDIT_TEST_SESSION set   a real maker's cookie, and FOUNDIT_TEST_SLUG a
 *                              listing she maintains. Her own screens must be
 *                              HERS: three 200s.
 *   nothing set                a throwaway account minted here through the
 *                              emailed-code path, which maintains nothing. Her
 *                              own listings page is still hers and empty, and
 *                              a listing she does not maintain is "not yours
 *                              and not there are one answer" — which is the
 *                              rule the maker screens are built on and is
 *                              worth asserting on its own.
 *
 * Either way every route is walked and no route may answer 5xx.
 */
test('every Phase 7 route answers a signed-in account without a 500', async (t) => {
  const origin = baseUrl();
  if (!origin || !(await reachable(origin))) {
    t.skip('no server answering, so the signed-in walk could not run.');
    return;
  }

  const supplied = (process.env.FOUNDIT_TEST_SESSION ?? '').trim();
  const cookie = supplied === '' ? (await sharedSession(origin)).cookie : supplied;
  const maintainsIt = supplied !== '';
  const slug = process.env.FOUNDIT_TEST_SLUG ?? 'receiptly';

  {
    t.diagnostic(
      maintainsIt
        ? `walking as the account FOUNDIT_TEST_SESSION names, which maintains ${slug}`
        : 'walking as a throwaway account minted here, which maintains nothing',
    );

    const results = await walkRoutes(origin, walkable(slug), cookie);
    for (const { path, status, location } of results) {
      assert.ok(
        status < 500,
        `${path} answered ${status} to a signed-in account${location ? ` -> ${location}` : ''}`,
      );
    }

    const byPath = new Map(results.map((r) => [r.path, r]));

    // Her own listings page is hers either way: a maker with listings sees
    // them, a person with none sees an empty one. What it must never be is a
    // redirect to sign in, because she is signed in.
    const mine = byPath.get('/maker');
    assert.equal(mine.status, 200, `/maker answered ${mine.status} to a signed-in account`);

    if (maintainsIt) {
      for (const own of [`/maker/${slug}`, `/maker/${slug}/edit`]) {
        const row = byPath.get(own);
        assert.equal(
          row.status,
          200,
          `${own} answered ${row.status} to the maker who maintains it`,
        );
      }
    } else {
      // "Not yours" and "not there" are the same answer (lib/accounts.ts's
      // rule), so a listing somebody else maintains is the not-found page and
      // never a 403 that says it exists.
      for (const hers of [`/maker/${slug}`, `/maker/${slug}/edit`]) {
        const row = byPath.get(hers);
        assert.ok(
          row.status === 404 || row.status === 200,
          `${hers} answered ${row.status} to somebody who does not maintain it`,
        );
        if (row.status === 200) {
          const body = await (
            await fetch(`${origin}${hers}`, {
              redirect: 'manual',
              headers: { cookie },
              signal: AbortSignal.timeout(60_000),
            })
          ).text();
          assert.doesNotMatch(
            body,
            /Searches matched/,
            `${hers} showed somebody else's dashboard to an account that does not maintain it`,
          );
          assert.match(
            body,
            /Nothing here/,
            `${hers} answered with something that is neither the not-found page nor a refusal`,
          );
        }
      }
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
  }
});

/* ===========================================================================
 * Phase 8: every /admin route, to everybody who is not an administrator
 *
 * docs/phase-goals.md Phase 8 item 3: every admin route is refused to a
 * stranger and to a signed-in non-administrator, "proven by a test that walks
 * all of them from the route tree (not a hand-written list)".
 *
 * FROM THE ROUTE TREE IS THE WHOLE POINT. A list of two paths in this file is
 * a list that does not grow when somebody adds /admin/reports next month, and
 * the route nobody added to the list is the route nobody checked. `ROUTES` is
 * already read from the filesystem at the top of this file, so filtering it is
 * free and a third admin page is walked the day its directory exists.
 *
 * THE NON-ADMIN WALK MINTS ITS OWN SESSION, which is the Phase 8 review's F12.
 * It used to skip unless `FOUNDIT_TEST_SESSION` was supplied by hand, and
 * nothing in package.json or .github/workflows/ci.yml supplied it — so the
 * half of gate item 3 that matters ("and with a non-admin session") had never
 * run anywhere, including in CI. It now signs a throwaway account in through
 * the real emailed-code path, walks every admin route with its cookie, and
 * deletes the account afterwards. If a server is answering and the session
 * cannot be minted, it FAILS with a sentence rather than skipping: a skip that
 * looks like a pass is what F12 was.
 *
 * WHAT THIS CANNOT SEE, said plainly: a Server Action is a POST with a
 * generated id in a header, so it cannot be posted from here without the id.
 * The POST below therefore proves only that these paths do not answer an
 * unsolicited POST with a 200. The action itself is covered from both ends
 * instead — tests/admin.test.mjs asserts that the removal action answers
 * everybody who is not an administrator with the not-found page before it
 * looks at its arguments, and db/test/admin_test.sql §6 proves the database
 * refuses the removal to a maker, to an ordinary account and to a stranger.
 * ======================================================================== */

/** Every /admin route, read from app/ rather than typed out here. */
const ADMIN_ROUTES = ROUTES.filter((r) => r.segments[0] === 'admin')
  .map((r) => `/${r.segments.join('/')}`)
  .sort();

test('there are admin routes, and the tree is where they come from', () => {
  assert.ok(
    ADMIN_ROUTES.includes('/admin'),
    `/admin is not in the route table; found ${JSON.stringify(ADMIN_ROUTES)}`,
  );
  assert.ok(ADMIN_ROUTES.includes('/admin/reviews'), '/admin/reviews is not in the route table');
  // None of them is dynamic, so every one is walkable as written. If that ever
  // stops being true, this fails rather than quietly walking a literal
  // "[slug]" directory.
  for (const path of ADMIN_ROUTES) {
    assert.doesNotMatch(path, /\[/, `${path} is dynamic and the walk below cannot reach it`);
  }
});

/** The not-found page's own words, from app/not-found.tsx. */
const NOT_FOUND = /Nothing here/;

/** Anything on an admin screen that a non-administrator must never read. */
const ADMIN_ONLY = [
  /What people ask for/,
  /Found nothing good/,
  /Opened from Foundit/,
  /pg_database_size/,
  /Removing is not editing/,
  /Never recorded/,
];

/**
 * Sixty seconds, and every route is warmed once before anything is asserted.
 *
 * `next dev` COMPILES a route on its first request, and the supervisor watched
 * a ten-second first response under the reviewer's load. A walk that fails on
 * a cold compile is a walk that fails for a reason that has nothing to do with
 * what it is testing.
 */
const ROUTE_TIMEOUT_MS = 60_000;

/**
 * Does `notFound()` produce a 404 on this server?
 *
 * Under `next dev` it does not: a Server Component cannot set a status code
 * once the response has begun, and dev renders every page that way. Under
 * `next start` it does. THAT IS THE DETECTION — it asks the application's own
 * not-found path rather than guessing from an environment variable, so a
 * production build is recognised wherever it is running.
 *
 * `/u/<a handle nobody has>` AND NOT `/tools/<a slug nobody has>`, and the
 * difference is worth knowing: `app/tools/[slug]/loading.tsx` is a Suspense
 * boundary, so that route's shell — with its 200 — is flushed before the page
 * decides anything, and its not-found answers 200 on every server. `/u/` has
 * no `loading.tsx`, so it answers what the server is capable of answering.
 * That is the same mechanism as the Phase 8 review's F3, which was
 * `app/loading.tsx` doing it to every route in the product at once.
 */
async function notFoundIsA404(origin) {
  const response = await fetch(`${origin}/u/definitely-not-a-handle-anybody-has`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });
  return response.status === 404;
}

/** Ask for a path once, so the next request is not paying for a compile. */
async function warm(origin, paths, cookie) {
  for (const path of paths) {
    try {
      await fetch(`${origin}${path}`, {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
        signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      });
    } catch {
      // A cold route that times out on the warming pass is given its chance
      // again in the assertion below, where failing is the point.
    }
  }
}

async function assertRefused(origin, path, cookie, who, expect404) {
  const response = await fetch(`${origin}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });
  assert.ok(response.status < 500, `${path} answered ${response.status} to ${who}`);

  if (expect404) {
    // THE PHASE 8 REVIEW'S F3. `/admin` answered 200 where
    // `/definitely-not-a-route` answered 404, and a HEAD request carried
    // nothing but that discriminator. app/admin/layout.tsx decides the 404
    // before anything streams.
    assert.equal(
      response.status,
      404,
      `${path} answered ${response.status} to ${who}; a route that does not exist answers 404 `
        + 'and this one must be indistinguishable from it',
    );
  }

  const body = await response.text();
  assert.match(body, NOT_FOUND, `${path} did not answer ${who} with the not-found page`);
  for (const secret of ADMIN_ONLY) {
    assert.doesNotMatch(body, secret, `${path} showed ${who} something from the dashboard`);
  }
  // And the tab does not confirm the route either: the title a real 404
  // carries, byte for byte (app/admin/metadata.ts).
  assert.doesNotMatch(
    body,
    /<title>(Dashboard|Reviews) · Foundit<\/title>/,
    `${path} told ${who} the route exists in its <title>`,
  );
}

/** A HEAD request has no body, so the status code is all there is. */
async function assertHeadRefused(origin, path, cookie, who, expect404) {
  const response = await fetch(`${origin}${path}`, {
    method: 'HEAD',
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });
  assert.ok(response.status < 500, `HEAD ${path} answered ${response.status} to ${who}`);
  if (expect404) {
    assert.equal(
      response.status,
      404,
      `HEAD ${path} answered ${response.status} to ${who}, and a HEAD response is nothing but `
        + 'its status line',
    );
  }
}

test('every admin route answers a stranger with the not-found page', async (t) => {
  const origin = baseUrl();
  if (!origin || !(await reachable(origin))) {
    t.skip('no server answering, so the admin routes could not be walked.');
    return;
  }

  const expect404 = await notFoundIsA404(origin);
  t.diagnostic(
    expect404
      ? 'notFound() answers 404 on this server (a production build), so the status code is '
        + 'asserted as well as the body'
      : 'notFound() answers 200 on this server (next dev, where a Server Component cannot set '
        + 'a status code), so only the body is asserted — run the walk against `next start` to '
        + 'check the status line',
  );

  await warm(origin, [...ADMIN_ROUTES, '/definitely-not-a-route'], null);

  for (const path of ADMIN_ROUTES) {
    await assertRefused(origin, path, null, 'a signed-out stranger', expect404);
    await assertHeadRefused(origin, path, null, 'a signed-out stranger', expect404);
  }

  // And a route that genuinely does not exist, so the comparison is between
  // two live answers rather than between one answer and an expectation. This
  // one is 404 on every server, dev included — the router answers it before
  // anything renders, which is exactly why `/admin` answering 200 was a
  // discriminator worth having.
  const missing = await fetch(`${origin}/definitely-not-a-route`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });
  assert.equal(missing.status, 404, 'a route that does not exist did not answer 404');

  // An unsolicited POST is not a way in either. Without Next's action id this
  // is not the Server Action; what it proves is that the path does not answer
  // a bare POST with a page.
  for (const path of ADMIN_ROUTES) {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'review=1&reason=because+i+said+so',
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    assert.ok(response.status < 500, `POST ${path} answered ${response.status}`);
    if (response.status === 200) {
      const body = await response.text();
      for (const secret of ADMIN_ONLY) {
        assert.doesNotMatch(body, secret, `POST ${path} answered a stranger with the dashboard`);
      }
    }
  }
});

/* ===========================================================================
 * Minting the non-administrator
 *
 * Through the REAL emailed-code path, against the running server, with one
 * shortcut that is stated rather than hidden: the test writes the code it is
 * about to use into `auth_core.verification` itself, hashed with the
 * application's own `hashSignInCode`. It does that rather than reading a code
 * out of a log because a log is wherever the operator pointed it, and rather
 * than guessing the code because the stored value is HMAC-SHA256 under
 * BETTER_AUTH_SECRET (0013, lib/auth-options.ts) and guessing it would mean a
 * million hashes for every run.
 *
 * WHAT IS STILL REAL, which is the part that matters: Better Auth issues the
 * row, Better Auth verifies the code, Better Auth creates the session and
 * signs the cookie, and the cookie is what the walk carries. The only thing
 * the test supplies is the six digits — which is exactly what an inbox
 * supplies to a person.
 *
 * @example.invalid, always, and never a real address: `sendVerificationOTP`
 * writes to the log rather than sending when AUTH_DEV_CODE_TO_LOG=1, and this
 * address could not be delivered to even if it did not.
 * ======================================================================== */

/** The throwaway's address, unique per run so two runs cannot collide. */
function throwawayEmail() {
  return `phase8-walk-${randomUUID()}@example.invalid`;
}

/**
 * ONE throwaway account for the whole file, minted on first use and deleted
 * when the file is done.
 *
 * Two walks need a signed-in account and they need the same kind of account,
 * so minting two was two sign-ins per run — and Better Auth's own rate limiter
 * answers the second one 429 on a run that follows another closely, which is a
 * failing test that is about nothing. It is also just less traffic through the
 * one flow nobody can work around.
 */
let shared = null;

async function sharedSession(origin) {
  shared ??= await mintNonAdminSession(origin);
  return shared;
}

after(async () => {
  if (shared) {
    const session = shared;
    shared = null;
    await deleteThrowaway(session);
  }
});

async function authClient() {
  const url = process.env.DATABASE_URL_AUTH;
  if (!url) return null;
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function appClient() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * Sign a throwaway account in and answer its cookie, or throw saying why.
 *
 * Never returns null: a walk that cannot mint a session is a walk that did not
 * happen, and F12 is what that looks like when it is quiet about it.
 */
async function mintNonAdminSession(origin) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set, so the sign-in code cannot be written the way the '
        + 'application stores it. Run this with `node --env-file=.env.local`.',
    );
  }
  const auth = await authClient();
  if (!auth) {
    throw new Error(
      'DATABASE_URL_AUTH is not set, so the throwaway account cannot be minted or cleaned up. '
        + 'It is the authentication role from db/migrations/0013_accounts.sql.',
    );
  }

  const email = throwawayEmail();
  const code = '424242';

  try {
    // `origin`, because Better Auth checks it on every POST and answers 403
    // without one — which is the protection app/o/route.ts had to write by
    // hand for a Route Handler.
    const sent = await fetch(`${origin}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, type: 'sign-in' }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    if (!sent.ok) {
      throw new Error(
        `the server refused to issue a sign-in code (${sent.status}): `
          + `${(await sent.text()).slice(0, 200)}`,
      );
    }

    // The row Better Auth just wrote, with our own code hashed into it the way
    // the application hashes one. `:0` is the attempt counter Better Auth
    // appends and splits on the last colon (lib/auth-options.ts says why the
    // encoding is base64url).
    const hashed = `${await hashSignInCode(code)}:0`;
    const updated = await auth.query(
      'update auth_core.verification set value = $1 where identifier = $2',
      [hashed, `sign-in-otp-${email}`],
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new Error(
        `the sign-in code row for the throwaway account was not there (${updated.rowCount} rows). `
          + 'Better Auth\'s email-otp plugin writes it as `sign-in-otp-<address>`.',
      );
    }

    const signedIn = await fetch(`${origin}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, otp: code }),
      redirect: 'manual',
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    if (!signedIn.ok) {
      throw new Error(`the throwaway account could not sign in (${signedIn.status})`);
    }

    const setCookie = signedIn.headers.getSetCookie?.() ?? [];
    const cookie = setCookie
      .map((line) => line.split(';')[0])
      .filter((pair) => pair.includes('session_token'))
      .join('; ');
    if (cookie === '') {
      throw new Error('signing in produced no session cookie, so there is nothing to walk with');
    }

    const { rows } = await auth.query(
      'select id from auth_core."user" where email = $1',
      [email],
    );
    return { cookie, email, userId: rows[0]?.id ?? null, auth };
  } catch (error) {
    await auth.end();
    throw error;
  }
}

/**
 * Take the throwaway away again.
 *
 * The profile is deleted AS THE APPLICATION ROLE under the throwaway's own
 * claim, which is the path `profiles_delete` exists for — the owner would have
 * to reach past a policy to do it, and a test that reaches past a policy to
 * clean up is a test that could be hiding one. The account itself goes as
 * foundit_auth, which is the only role that may see auth_core at all.
 */
async function deleteThrowaway({ email, userId, auth }) {
  try {
    if (userId) {
      const app = await appClient();
      if (app) {
        try {
          await app.query('begin');
          await app.query(SET_IDENTITY_SQL, identityParams({ userId }));
          await app.query('delete from public.profiles where id = $1', [userId]);
          await app.query('commit');
        } finally {
          await app.end();
        }
      }
    }
    await auth.query('delete from auth_core."user" where email = $1', [email]);
  } finally {
    await auth.end();
  }
}

test('every admin route answers a signed-in NON-ADMIN with the not-found page', async (t) => {
  const origin = baseUrl();
  if (!origin || !(await reachable(origin))) {
    t.skip('no server answering, so the signed-in admin walk could not run.');
    return;
  }

  // From here on there is no skip. A server is answering, so the half of gate
  // item 3 that says "and with a non-admin session" either runs or fails.
  const session = await sharedSession(origin);
  {
    const expect404 = await notFoundIsA404(origin);
    t.diagnostic(
      `${expect404 ? 'production build: status AND body asserted' : 'next dev: body asserted, '
        + 'status cannot be set by a Server Component'} — walking ${ADMIN_ROUTES.length} `
        + 'admin route(s) as a freshly minted non-administrator',
    );

    await warm(origin, ADMIN_ROUTES, session.cookie);

    for (const path of ADMIN_ROUTES) {
      await assertRefused(origin, path, session.cookie, 'a signed-in non-administrator', expect404);
      await assertHeadRefused(
        origin,
        path,
        session.cookie,
        'a signed-in non-administrator',
        expect404,
      );
    }

    // The session is real: it is somebody, and that somebody is not an
    // administrator. Without this the walk would pass just as well with a
    // cookie the server ignores, which is the same hole F12 was.
    const home = await fetch(`${origin}/settings`, {
      redirect: 'manual',
      headers: { cookie: session.cookie },
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    assert.ok(
      home.status === 200,
      `the minted session did not reach a signed-in page (/settings answered ${home.status}), `
        + 'so the walk above proved nothing about a signed-in non-administrator',
    );
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
