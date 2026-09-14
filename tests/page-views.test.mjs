// ===========================================================================
// What counts as a page view — OWNER FEEDBACK, ROUND 1, F3.
//
// The Visits panel's caption promised five exclusions and three of them were
// real. The one that was not is the one that mattered: "requests for a page
// somebody is already on". `app/layout.tsx` tested `incoming.get('rsc')`, and
// `headers()` in a Server Component does not expose `RSC` on this build — so
// that half of the guard was always true and EVERY client-side navigation in
// the application recorded a second page view for a page the visitor was
// already reading. The reviewer measured it against a production build:
//
//     GET /about, plain                            10 requests -> +11
//     GET /about with RSC: 1                       10 requests -> +11
//     GET /about with RSC + Next-Router-Prefetch   10 requests -> +0
//     HEAD /about                                  10 requests -> +10
//     GET /no-such-page (404)                      10 requests -> +10
//     GET /healthz                                 10 requests -> +0
//     POST /o (beacon)                             10 requests -> +0
//
// Three of those four inclusions are defensible for a page-view number; the
// RSC one is not, and it is the one the caption denied.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS A UNIT TEST AND NOT THE REVIEWER'S EXPERIMENT
//
// The reviewer's method — fire ten requests, wait for the sixty-second flush,
// read the delta out of `infra.page_views_daily` — is the right way to
// DISCOVER this and the wrong way to keep it discovered. `node --test` runs
// test files in parallel, and three other files in this directory walk every
// route on the same server; a delta measured while they do is a delta that
// includes them. It would fail on a busy afternoon and pass on a quiet one,
// which is a test that teaches nobody anything.
//
// So the decision was moved somewhere a test can hold it still
// (`lib/page-view-policy.ts`, for the same reason `lib/visitor-policy.ts`
// exists) and every row of the table above is a line below. The two ends are
// then bound to it by reading the source: `middleware.ts` must delete the
// header before it sets it, and `app/layout.tsx` must count on that header and
// nothing else.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { COUNT_HEADER, countsAsPageView } from '../lib/page-view-policy.ts';
import {
  ROUTER_DOCUMENT,
  ROUTER_HEADER,
  markRouterRequest,
} from '../lib/router-headers.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** One row of the reviewer's table, as arguments. */
const req = (over = {}) => ({
  method: 'GET',
  pathname: '/about',
  rsc: false,
  prefetch: false,
  ...over,
});

test('every row of the reviewer’s table', () => {
  const rows = [
    // what the reviewer sent                              counted?  why
    [req(), true, 'an ordinary page request is a page view'],
    [req({ rsc: true }), false, 'an RSC render is a page the visitor is already on — F3'],
    [
      req({ rsc: true, prefetch: true }),
      false,
      'a prefetch is a page nobody has looked at',
    ],
    [
      req({ prefetch: true }),
      false,
      'a prefetch header with no RSC header is not a prefetch a browser made, and it is '
        + 'not a page view either',
    ],
    [req({ method: 'HEAD' }), false, 'a HEAD asks whether a page exists; it does not read one'],
    [req({ pathname: '/no-such-page' }), true, 'a 404 is a page this deployment rendered'],
    [req({ pathname: '/healthz' }), false, 'the probe runs for ever and is not a page'],
    [req({ pathname: '/o', method: 'POST' }), false, 'the beacon answers 204 and has no document'],
    [req({ pathname: '/o' }), false, 'and not as a GET either'],
    [req({ pathname: '/_next/static/chunks/main.js' }), false, 'a chunk is bytes, not a page'],
    [req({ pathname: '/robots.txt' }), false, 'a file with a dot in its name is a file'],
    [req({ pathname: '/sitemap.xml' }), false, 'and so is this one'],
    [req({ method: 'POST', pathname: '/tools/anki' }), false, 'a Server Action post is not a read'],
    // And the things that ARE pages, including the ones whose names look like
    // something else. A slug, a handle and a share token can hold no dot, so
    // the "is it a file" rule cannot swallow one.
    [req({ pathname: '/' }), true, 'the homepage'],
    [req({ pathname: '/tools/organic-maps' }), true, 'a tool page with a hyphen in its slug'],
    [req({ pathname: '/u/priya' }), true, 'a profile'],
    [req({ pathname: '/c/abc123' }), true, 'a share link'],
    [req({ pathname: '/admin/reviews' }), true, 'the operator’s own screens'],
  ];

  for (const [request, expected, why] of rows) {
    assert.equal(
      countsAsPageView(request),
      expected,
      `${request.method} ${request.pathname}` +
        `${request.rsc ? ' +RSC' : ''}${request.prefetch ? ' +Next-Router-Prefetch' : ''}` +
        ` should ${expected ? '' : 'not '}count: ${why}`,
    );
  }
});

test('the header cannot be forged, and the layout believes nothing else', () => {
  const middleware = source('middleware.ts');

  // DELETED BEFORE IT IS SET, unconditionally. Without this line a visitor
  // could send `x-foundit-count: 1` and count as many page views as they
  // liked — the same defect as F3 with a worse cause.
  assert.ok(
    middleware.includes(`requestHeaders.delete(COUNT_HEADER)`),
    'middleware.ts must delete the count header before deciding, or a client can write it',
  );
  assert.ok(
    middleware.indexOf('requestHeaders.delete(COUNT_HEADER)')
      < middleware.indexOf('requestHeaders.set(COUNT_HEADER'),
    'and it must delete it BEFORE it sets it',
  );
  assert.ok(
    middleware.includes('countsAsPageView({'),
    'middleware.ts must use the shared decision rather than a second copy of the rule',
  );

  // And the layout counts on that header and on nothing else. The two headers
  // it used to read are what F3 is about; neither may come back.
  const layout = source('app/layout.tsx');
  assert.ok(
    layout.includes(`incoming.get('${COUNT_HEADER}') === '1'`),
    `app/layout.tsx must count exactly when ${COUNT_HEADER} is present`,
  );
  const code = layout.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(
    code,
    /incoming\.get\('rsc'\)/,
    'app/layout.tsx must not test `rsc`: headers() does not expose it, which is F3',
  );
  assert.doesNotMatch(
    code,
    /incoming\.get\('next-router-prefetch'\)/,
    'app/layout.tsx must not test the prefetch header either; middleware decides',
  );
});

test('the caption on the dashboard says what is true', () => {
  // Overclaim 12. The caption listed five exclusions and one of them —
  // "requests for a page somebody is already on" — was the RSC guard that
  // never fired. It has to name the two INCLUSIONS a reader would otherwise
  // assume away, because both of them make the number bigger.
  const admin = source('app/admin/page.tsx');
  assert.match(admin, /<strong>Excluded:<\/strong>/, 'the Visits caption must say what is excluded');
  assert.match(admin, /<strong>Counted:<\/strong>/, 'and what is counted that a reader would not expect');
  assert.match(admin, /404/, 'a 404 is counted and the caption has to say so');
});

/* ---------------------------------------------------------------------------
 * AND THE REASON THE DECISION IS NOT MADE FROM THE HEADERS THEMSELVES.
 *
 * `rsc` and `next-router-prefetch` are FLIGHT_HEADERS: Next strips them before
 * it builds the middleware's request and restores them, unchanged, after it
 * returns ("Flight headers are not overridable / removable so they are applied
 * at the end" — next/dist/server/web/adapter.js), and `headers()` in a Server
 * Component drops them as well. So neither place can see whether a request is
 * a client-side navigation, which is F3's cause, and neither can decline the
 * request shape Next crashes on, which is F24's.
 *
 * `lib/router-headers.ts` runs one layer out, at the HTTP server, before Next
 * has looked at the request. These are its two rules.
 * ------------------------------------------------------------------------ */
test('the shim says which flight headers were on the request', () => {
  const mark = (headers) => {
    const request = { headers: { ...headers } };
    markRouterRequest(request);
    return request.headers;
  };

  assert.equal(mark({}) [ROUTER_HEADER], ROUTER_DOCUMENT, 'a plain document request');
  assert.equal(mark({ rsc: '1' })[ROUTER_HEADER], 'rsc', 'a client-side navigation');
  assert.equal(
    mark({ rsc: '1', 'next-router-prefetch': '1' })[ROUTER_HEADER],
    'rsc,prefetch',
    'a prefetch, which is what the router actually sends',
  );
  assert.equal(
    mark({ 'next-router-prefetch': '1' })[ROUTER_HEADER],
    'prefetch',
    'and the shape no browser sends is still reported honestly',
  );

  // A CLIENT CANNOT WRITE IT. The name is ours and the shim sets it on every
  // request, so a forged one is overwritten rather than believed — without
  // that line, counting a page view would be something anybody could ask for.
  assert.equal(
    mark({ [ROUTER_HEADER]: 'rsc' })[ROUTER_HEADER],
    ROUTER_DOCUMENT,
    'a forged x-foundit-router survived the shim',
  );
  assert.equal(
    mark({ rsc: '1', [ROUTER_HEADER]: ROUTER_DOCUMENT })[ROUTER_HEADER],
    'rsc',
    'a forged x-foundit-router hid a real RSC request',
  );
});

test('the shim declines the request shape Next answers 500 to', () => {
  // F24. `GET /about` with `Next-Router-Prefetch: 1` and no `RSC` answered 500
  // with `ReferenceError: location is not defined`, from inside Next's own
  // layout router, three times out of three on this build and on the build
  // before it. A real prefetch carries both headers; this pair is a script,
  // and on a deployment with a DSN it is one Sentry issue per request.
  const lone = { headers: { 'next-router-prefetch': '1' } };
  markRouterRequest(lone);
  assert.equal(
    lone.headers['next-router-prefetch'],
    undefined,
    'a prefetch header with no RSC header must not reach Next',
  );

  // A REAL prefetch is untouched: it is a shape Next handles, and dropping the
  // header would turn every prefetch into a full render.
  const real = { headers: { rsc: '1', 'next-router-prefetch': '1' } };
  markRouterRequest(real);
  assert.equal(real.headers['next-router-prefetch'], '1', 'a real prefetch must go through');
  assert.equal(real.headers.rsc, '1');

  // And an ordinary request is left completely alone apart from the mark.
  const plain = { headers: { host: 'foundit.tools' } };
  markRouterRequest(plain);
  assert.deepEqual(plain.headers, {
    host: 'foundit.tools',
    [ROUTER_HEADER]: ROUTER_DOCUMENT,
  });
});

test('middleware reads the shim’s header and not the ones Next hides', () => {
  const middleware = source('middleware.ts');
  assert.ok(
    middleware.includes('request.headers.get(ROUTER_HEADER)'),
    'middleware.ts must read x-foundit-router',
  );
  const code = middleware.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(
    code,
    /headers\.get\('rsc'\)/,
    'middleware.ts must not read `rsc`: Next strips it before middleware sees it',
  );
  assert.doesNotMatch(
    code,
    /headers\.get\('next-router-prefetch'\)/,
    'middleware.ts must not read the prefetch header either, for the same reason',
  );
  // And the shim is actually installed, once, in the one hook that runs before
  // the first request.
  const instrumentation = source('instrumentation.ts');
  assert.match(instrumentation, /installRouterHeaderShim\(\)/);
  assert.match(instrumentation, /NEXT_RUNTIME === 'nodejs'/);
});
