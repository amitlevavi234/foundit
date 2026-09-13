// ===========================================================================
// What an error report is allowed to carry off this machine.
//
// THE RULE: search text is never joinable to a person, including through
// Sentry (Phase 8's non-negotiables, docs/product-decisions.md §10). An
// unscrubbed error report is the easiest way to break that without writing a
// line of SQL — one crash on /results carries the sentence in the URL, the
// session cookie in the request headers and, for a signed-in person, an
// address in the user context. All three in one JSON object, timestamped, at a
// third party, where no policy in this database can reach them.
//
// So the centre of this file is one test that builds the event that failure
// would produce — a real search, a real session cookie, a real address — hands
// it to the real `beforeSend`, and asserts that none of the three survives
// ANYWHERE in the result, by searching the serialised output rather than by
// checking the fields somebody remembered.
//
// It needs no DSN, no network and no SDK: lib/sentry-scrub.ts is deliberately
// a pure module with no imports, and that is why.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REDACTED,
  SHARED_SENTRY_OPTIONS,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
  sentryDsn,
} from '../lib/sentry-scrub.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/**
 * Comments out, for the assertions about what a config file MUST NOT set:
 * sentry.server.config.ts explains in prose why `sendDefaultPii` is false in
 * the shared object, and next.config.mjs explains at length why there is no
 * `tunnelRoute`. A test that reads the prose finds the word in the sentence
 * forbidding it.
 */
const readCode = (path) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ---------------------------------------------------------------------------
 * The three things that must never travel
 * ------------------------------------------------------------------------ */

/** A sentence somebody typed. Long enough that a partial match is unlikely. */
const SENTENCE = 'my receipts are a mess at tax time and I keep losing them';
const ADDRESS = 'someone.real+tag@gmail.com';
const COOKIE = '__Secure-better-auth.session_token=9f2c1ab4deadbeefcafe0123456789ab';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.abcdefghij';

/**
 * The event a crash on /results would actually produce, as the Node SDK
 * assembles one: a request with a URL, a query string, headers, cookies and a
 * body; a user; a breadcrumb trail; and an exception whose message happens to
 * quote the input.
 */
function realisticEvent() {
  return {
    event_id: 'abc123',
    level: 'error',
    platform: 'node',
    release: 'sha-1a2b3c4',
    transaction: `/results?q=${encodeURIComponent(SENTENCE)}`,
    message: `ranking failed for ${ADDRESS} on /results?q=${encodeURIComponent(SENTENCE)}`,
    user: { id: 'u_9f2c1ab4', email: ADDRESS, ip_address: '203.0.113.45' },
    request: {
      method: 'POST',
      url: `https://foundit.tools/results?q=${encodeURIComponent(SENTENCE)}&intent=save`,
      query_string: `q=${encodeURIComponent(SENTENCE)}`,
      cookies: { '__Secure-better-auth.session_token': '9f2c1abdeadbeefcafe' },
      data: { query: SENTENCE, email: ADDRESS },
      headers: {
        Cookie: COOKIE,
        Authorization: TOKEN,
        'cf-connecting-ip': '203.0.113.45',
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'en-GB',
      },
    },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'cannot read properties of undefined (reading \'score\')',
          stacktrace: { frames: [{ filename: 'lib/rerank.ts', lineno: 412 }] },
        },
      ],
    },
    extra: { sentence: SENTENCE, signedInAs: ADDRESS },
    tags: { route: '/results', q: SENTENCE },
    contexts: { trace: { trace_id: 'd4e5f6' } },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/', to: `/results?q=${encodeURIComponent(SENTENCE)}` } },
      { category: 'fetch', data: { url: 'https://foundit.tools/api/auth/sign-in/email-otp', method: 'POST' } },
      { category: 'console', level: 'log', message: `signed in ${ADDRESS}` },
    ],
  };
}

/* ---------------------------------------------------------------------------
 * The test the whole file is for
 * ------------------------------------------------------------------------ */

test('a real search, a real session and a real address: none of them survives', () => {
  const scrubbed = scrubEvent(realisticEvent());
  assert.ok(scrubbed, 'the event was dropped entirely, which is not what should happen here');

  // SEARCHED, NOT INSPECTED. Asserting `event.user === undefined` proves the
  // field somebody thought of; serialising the whole object and searching it
  // proves the ones they did not. A new field on a future SDK version, an
  // `extra` somebody adds in a hurry, a nested context — all of them are in
  // this string.
  const serialised = JSON.stringify(scrubbed);

  assert.ok(!serialised.includes(SENTENCE), 'the typed sentence survived the scrubber');
  assert.ok(!serialised.includes('receipts'), 'part of the typed sentence survived');
  assert.ok(!serialised.includes(ADDRESS), 'an email address survived the scrubber');
  assert.ok(!serialised.includes('gmail.com'), 'the domain half of an address survived');
  assert.ok(!serialised.includes('9f2c1ab'), 'a session token survived the scrubber');
  assert.ok(!serialised.includes('eyJ'), 'a bearer token survived the scrubber');
  assert.ok(!serialised.includes('203.0.113.45'), 'the visitor’s address survived the scrubber');
  assert.ok(!serialised.includes('u_9f2c1ab4'), 'an account id survived the scrubber');

  // The URL-encoded spelling too, which is how it appears in a query string
  // and is a different set of bytes from the sentence itself.
  assert.ok(
    !serialised.includes(encodeURIComponent(SENTENCE)),
    'the typed sentence survived in its URL-encoded form',
  );
});

test('and what is left is still worth reading', () => {
  // A scrubber that returns an empty object passes every assertion above and
  // is useless. What makes a report worth having is the type, the frame, the
  // release, the method and the PATH.
  const scrubbed = scrubEvent(realisticEvent());
  const serialised = JSON.stringify(scrubbed);

  assert.ok(serialised.includes('TypeError'), 'the exception type must survive');
  assert.ok(serialised.includes('lib/rerank.ts'), 'the stack frame must survive');
  assert.ok(serialised.includes('sha-1a2b3c4'), 'the release must survive');
  assert.equal(scrubbed.request.method, 'POST', 'the HTTP method must survive');
  assert.equal(scrubbed.request.url, 'https://foundit.tools/results', 'the path must survive');
  assert.equal(scrubbed.request.headers['user-agent'], 'Mozilla/5.0', 'the user agent may survive');
});

test('the request body, the query string and the cookies are gone by omission', () => {
  const scrubbed = scrubEvent(realisticEvent());
  assert.equal(scrubbed.user, undefined, 'there must be no user object at all');
  assert.equal(scrubbed.request.data, undefined, 'the request body must not be rebuilt');
  assert.equal(scrubbed.request.cookies, undefined, 'the cookies must not be rebuilt');
  assert.equal(scrubbed.request.query_string, undefined, 'the query string must not be rebuilt');
  for (const header of ['Cookie', 'Authorization', 'cf-connecting-ip']) {
    assert.equal(scrubbed.request.headers[header], undefined, `${header} must be dropped`);
  }
});

test('a breadcrumb through /api/auth is dropped rather than scrubbed', () => {
  // Better Auth's routes carry six-digit codes, verification identifiers and
  // OAuth state, in query parameters whose names change with the library.
  // Enumerating them is a list that goes stale; dropping the crumb is not.
  assert.equal(
    scrubBreadcrumb({ category: 'fetch', data: { url: '/api/auth/sign-in/email-otp' } }),
    null,
  );
  assert.equal(
    scrubBreadcrumb({ category: 'xhr', data: { url: 'https://foundit.tools/api/auth/callback/google?code=4/0Ab' } }),
    null,
  );
  // And an event for one, not only a crumb.
  assert.equal(scrubEvent({ request: { url: 'https://foundit.tools/api/auth/session' } }), null);
});

test('/healthz is dropped, so the probe does not bury the one real error', () => {
  assert.equal(scrubBreadcrumb({ category: 'fetch', data: { url: '/healthz' } }), null);
  assert.equal(scrubEvent({ request: { url: 'http://127.0.0.1:3000/healthz' } }), null);
});

test('the scrubber does not fall over on the shapes an SDK actually sends', () => {
  // An error handler that throws inside `beforeSend` loses the event and, in
  // some SDK versions, the process's error handling with it.
  for (const odd of [null, undefined, 0, '', 'a string', [], { request: null }, { request: 1 },
    { breadcrumbs: 'not an array' }, { extra: { a: { b: { c: { d: {} } } } } }]) {
    assert.doesNotThrow(() => scrubEvent(odd), `scrubEvent threw on ${JSON.stringify(odd)}`);
    assert.doesNotThrow(() => scrubBreadcrumb(odd), `scrubBreadcrumb threw on ${JSON.stringify(odd)}`);
  }

  // A cyclic object, which `extra` can hold and which a naive walk follows
  // until the stack runs out.
  const cyclic = { name: 'a' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => scrubEvent({ extra: cyclic }), 'scrubEvent followed a cycle');
});

test('the one route out that a scrubber cannot close, and what closes it instead', () => {
  // THE HONEST LIMIT, stated as a test rather than as a comment somewhere.
  //
  // `message` and each exception's `value` are prose written by whatever
  // threw. A sentence somebody typed, quoted inside one of them, is ordinary
  // English: there is no regular expression for "this is not ours". Every
  // other route out is closed by the NAME of the field; this one is not, and
  // pretending otherwise would be worse than saying so.
  const leaks = scrubEvent({ message: `while ranking "${SENTENCE}"` });
  assert.ok(
    JSON.stringify(leaks).includes('receipts'),
    'if this now passes, the scrubber has learned to recognise free text and this test — '
      + 'and the paragraph in lib/sentry-scrub.ts it documents — should be rewritten',
  );

  // TWO THINGS CLOSE IT INSTEAD.
  //
  // One: free text is capped, so a whole page of quoted input, a rendered
  // template or a stringified request body cannot travel inside one.
  const long = scrubEvent({ message: 'x'.repeat(5_000) });
  assert.ok(long.message.length < 400, 'free text must be capped');
  assert.ok(long.message.endsWith(REDACTED), 'and the cap must say it happened');

  // Two: nothing in the search path builds such a message. These are the
  // files the typed sentence passes through, and none of them may put it into
  // an Error, a console line or a thrown string.
  const carriers = ['lib/results.ts', 'lib/reading.ts', 'lib/rerank.ts', 'lib/embeddings.ts',
    'lib/reader-model.ts', 'lib/db.ts', 'lib/sql.ts', 'app/results/page.tsx'];
  for (const file of carriers) {
    const source = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const [, built] of source.matchAll(/(?:new Error\(|console\.(?:error|warn|log)\()([^)]*)/g)) {
      assert.doesNotMatch(
        built,
        /\$\{[^}]*\b(query|sentence|searchText|text|input|statement)\b[^}]*\}/,
        `${file} builds a log line or an error out of the typed sentence:\n    ${built.trim().slice(0, 160)}`,
      );
    }
  }
});

test('the pieces behave on their own', () => {
  assert.equal(scrubText(`write to ${ADDRESS} please`), `write to ${REDACTED} please`);
  assert.equal(scrubText('two: a@b.co and c.d+e@f.example.org'), `two: ${REDACTED} and ${REDACTED}`);
  assert.equal(scrubUrl('https://foundit.tools/results?q=secret#frag'), 'https://foundit.tools/results');
  assert.equal(scrubUrl('/results?q=secret'), '/results');
  assert.equal(scrubUrl(`/u/${ADDRESS}`), `/u/${REDACTED}`);
  assert.equal(scrubUrl(undefined), '');
});

/* ---------------------------------------------------------------------------
 * The configuration
 * ------------------------------------------------------------------------ */

test('keyless it is inert, and the DSN is read from the environment only', () => {
  assert.equal(sentryDsn({}), undefined, 'no DSN must mean no client');
  assert.equal(sentryDsn({ SENTRY_DSN: '   ' }), undefined, 'a blank DSN must mean no client');
  assert.equal(sentryDsn({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2' }), 'https://k@o1.ingest.sentry.io/2');
  assert.equal(
    sentryDsn({ NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/3' }),
    'https://k@o1.ingest.sentry.io/3',
    'the browser reads its own variable',
  );

  // And this is the state every test in this repository and every CI run is
  // actually in.
  assert.equal(
    sentryDsn(process.env),
    undefined,
    'a DSN is set in this environment, so these tests are not measuring the keyless case',
  );

  // No DSN is written down anywhere in the tree.
  for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts',
    'instrumentation-client.ts', 'lib/sentry-scrub.ts', 'next.config.mjs']) {
    assert.doesNotMatch(
      read(file),
      /ingest\.[a-z.]*sentry\.io\/\d/,
      `${file} has a DSN written into it`,
    );
  }
});

test('no traces, no replay, no PII — in one object, spread by all three configs', () => {
  // A trace is a tree of spans, and a span for an HTTP request carries the
  // full URL including its query string. Scrubbing every span in every
  // integration for ever is a promise; zero traces is a guarantee.
  assert.equal(SHARED_SENTRY_OPTIONS.tracesSampleRate, 0);
  assert.equal(SHARED_SENTRY_OPTIONS.sendDefaultPii, false);
  assert.equal(SHARED_SENTRY_OPTIONS.replaysSessionSampleRate, 0);
  assert.equal(SHARED_SENTRY_OPTIONS.replaysOnErrorSampleRate, 0);

  for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts', 'instrumentation-client.ts']) {
    const source = readCode(file);
    assert.match(source, /\.\.\.SHARED_SENTRY_OPTIONS/, `${file} must spread the shared options`);
    assert.match(source, /beforeSend:/, `${file} must set beforeSend`);
    assert.match(source, /beforeBreadcrumb:/, `${file} must set beforeBreadcrumb`);
    assert.match(source, /sentryDsn\(/, `${file} must read the DSN through sentryDsn`);
    // And none of them may quietly re-enable what the shared object turned off.
    assert.doesNotMatch(source, /tracesSampleRate/, `${file} must not set tracesSampleRate itself`);
    assert.doesNotMatch(source, /sendDefaultPii/, `${file} must not set sendDefaultPii itself`);
    assert.doesNotMatch(source, /replays\w*SampleRate/, `${file} must not set a replay rate itself`);
  }
});

test('the browser SDK ships with no default integrations', () => {
  // The defaults include `breadcrumbs` (every fetch, every navigation, every
  // console line), `browserSession`, and the DOM-recording replay integration.
  // Each of those is a mechanism for the typed sentence to leave the page.
  assert.match(
    read('instrumentation-client.ts'),
    /integrations: \[\]/,
    'the browser client must start from no integrations at all',
  );
});

test('no source map and no build-time token reach the image', () => {
  const config = readCode('next.config.mjs');
  assert.match(config, /sourcemaps: \{ disable: true \}/, 'source maps must not be generated');
  assert.doesNotMatch(config, /authToken/, 'no auth token may be read at build time');
  assert.doesNotMatch(config, /tunnelRoute/, 'a tunnel route is the server fetching for a visitor');

  const dockerfile = read('Dockerfile').replace(/^#.*$/gm, '');
  assert.doesNotMatch(dockerfile, /SENTRY_AUTH_TOKEN/, 'the image build must not take a Sentry token');
});
