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
import { readFileSync, readdirSync } from 'node:fs';
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
 * The free-text guard, which is the one route out that a scrubber cannot close
 * ------------------------------------------------------------------------ */

/**
 * The files the typed sentence passes through.
 *
 * ELEVEN SINCE THE PHASE 9a REVIEW, not eight. `lib/constraints.ts`,
 * `lib/accounts.ts` and `lib/maker.ts` all see text a person typed — a
 * constraint answer, a review body, a listing's own statements — and were not
 * on the list, so a message built out of one of them in any of the three would
 * not have been looked at.
 */
const CARRIERS = ['lib/results.ts', 'lib/reading.ts', 'lib/rerank.ts', 'lib/embeddings.ts',
  'lib/reader-model.ts', 'lib/db.ts', 'lib/sql.ts', 'app/results/page.tsx',
  'lib/constraints.ts', 'lib/accounts.ts', 'lib/maker.ts'];

/**
 * The names the typed sentence travels under in this codebase.
 *
 * Six became fifteen. The six were the ones somebody remembered; `q` is the
 * name it has in the URL, on the form field and in half the signatures in
 * lib/results.ts, and it was not among them.
 */
const TYPED_NAMES = ['q', 'query', 'sentence', 'sentenceText', 'searchText', 'search_text',
  'text', 'input', 'statement', 'statements', 'raw', 'body', 'phrase', 'typed', 'payload'];

const NAME_ALTERNATION = TYPED_NAMES.join('|');

/**
 * Every `new Error(…)` / `console.error|warn|log(…)` argument list in a source
 * file, WHOLE — to the matching close paren rather than to the first one.
 *
 * `([^)]*)` was the third hole: `console.error(String(error.code) + ' on ' + q)`
 * was examined as far as `String(error.code` and no further, so everything
 * after the first nested call was invisible to the guard.
 */
function builtMessages(source) {
  const out = [];
  const opener = /(?:new Error\s*\(|console\.(?:error|warn|log)\s*\()/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    for (; i < source.length && depth > 0; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    out.push(source.slice(start, depth === 0 ? i - 1 : source.length));
  }
  return out;
}

/** Does one argument list put a typed-input identifier into a string? */
function carriesTypedInput(built) {
  // Interpolated: `${q}`, `${query.trim()}`, `${a ? b : sentence}`.
  if (new RegExp(String.raw`\$\{[^}]*\b(${NAME_ALTERNATION})\b[^}]*\}`).test(built)) return true;
  // Concatenated, either side of the `+`. This is the brief's own example and
  // the shape the review's probe used, and it used to pass.
  if (new RegExp(String.raw`\+\s*\b(${NAME_ALTERNATION})\b`).test(built)) return true;
  if (new RegExp(String.raw`\b(${NAME_ALTERNATION})\b\s*(?:\.\w+\(\))?\s*\+`).test(built)) return true;
  return false;
}

/* ---------------------------------------------------------------------------
 * The three things that must never travel
 * ------------------------------------------------------------------------ */

/** A sentence somebody typed. Long enough that a partial match is unlikely. */
const SENTENCE = 'my receipts are a mess at tax time and I keep losing them';
const ADDRESS = 'someone.real+tag@gmail.com';
const COOKIE = '__Secure-better-auth.session_token=9f2c1ab4deadbeefcafe0123456789ab';
/**
 * A bearer token of the shape a real one has.
 *
 * ASSEMBLED RATHER THAN WRITTEN DOWN, because scripts/scan-secrets.sh has a
 * `json web token` rule — three base64url segments separated by dots, starting
 * `eyJ` — and it is right to: nobody types one of those by accident. A test
 * fixture that trips the credential scanner would have to be exempted in the
 * scanner, and loosening that rule to accommodate a test is exactly the
 * trade that file's own header refuses. Three pieces and a join cost nothing
 * and the test is unchanged.
 */
const TOKEN = ['Bearer ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey',
  'JzdWIiOiIxMjM0In0.abcdefghij'].join('');

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

/* ---------------------------------------------------------------------------
 * The capability in a path segment — Phase 9a review, F1
 * ------------------------------------------------------------------------ */

/** A share token of the shape app/c/[token] actually carries. */
const SHARE_TOKEN = '6f3a91c0b2e14d77';

test('a share token in the path is a secret, and the whole event goes', () => {
  // THE ADDRESS IS THE PERMISSION. app/c/[token]/page.tsx has no owner check
  // and no `is_public` flag behind it: the token out of the URL is compared to
  // the column, and a wrong token returns no rows. So `/c/<token>` in
  // `request.url` is a credential in an error report — which the scrubber used
  // to keep, deliberately, because it kept the PATH and dropped only the
  // query.
  assert.equal(
    scrubEvent({
      request: { url: `https://foundit.tools/c/${SHARE_TOKEN}`, method: 'GET' },
      transaction: `/c/${SHARE_TOKEN}`,
    }),
    null,
    'an event for a /c/ route must be dropped entirely, not scrubbed',
  );
  // The transaction alone is enough to drop it: a render error on that route
  // arrives with no `request` at all.
  assert.equal(scrubEvent({ transaction: `/c/${SHARE_TOKEN}` }), null);

  // And every breadcrumb of that navigation, because the token is in `from`
  // and `to` as well as in the fetch that followed it.
  for (const crumb of [
    { category: 'navigation', data: { from: '/saved', to: `/c/${SHARE_TOKEN}` } },
    { category: 'fetch', data: { url: `https://foundit.tools/c/${SHARE_TOKEN}?_rsc=ab12` } },
    { category: 'navigation', data: { from: `/c/${SHARE_TOKEN}`, to: '/' } },
  ]) {
    assert.equal(scrubBreadcrumb(crumb), null, `a /c/ breadcrumb survived: ${JSON.stringify(crumb)}`);
  }

  // A crumb that is carried INSIDE an event is dropped there too, so the
  // event-level rule and the breadcrumb-level rule cannot disagree.
  const carried = scrubEvent({
    transaction: '/saved',
    breadcrumbs: [{ category: 'navigation', data: { to: `/c/${SHARE_TOKEN}` } }],
  });
  assert.ok(!JSON.stringify(carried).includes(SHARE_TOKEN), 'a token survived inside breadcrumbs');
});

test('no path parameter reaches Sentry, on any route that has one', () => {
  // THE RULE, STATED ONCE: every segment that is a parameter becomes
  // `[redacted]`, whether or not that particular parameter is a secret. A slug
  // is on every result card and a handle is on every review; the reason to
  // redact them anyway is that "which of these is safe" is a judgement somebody
  // has to make again every time a dynamic route is added, and this is a rule
  // a test can hold.
  assert.equal(scrubUrl('https://foundit.tools/tools/receiptly'), 'https://foundit.tools/tools/[redacted]');
  assert.equal(scrubUrl('/u/amit'), '/u/[redacted]');
  assert.equal(scrubUrl('/maker/receiptly/edit'), '/maker/[redacted]/edit');
  assert.equal(scrubUrl('/saved/weekend-reading'), '/saved/[redacted]');
  // The pages with no parameter are untouched, or the reports stop being
  // worth reading.
  assert.equal(scrubUrl('/results?q=anything'), '/results');
  assert.equal(scrubUrl('/browse'), '/browse');
  assert.equal(scrubUrl('/saved'), '/saved');
  assert.equal(scrubUrl('https://foundit.tools/top'), 'https://foundit.tools/top');

  // Both fields, on an event of the shape a throw in a Server Component makes.
  const event = scrubEvent({
    request: { url: 'https://foundit.tools/tools/receiptly?q=tax', method: 'GET' },
    transaction: '/tools/receiptly',
  });
  assert.equal(event.request.url, 'https://foundit.tools/tools/[redacted]');
  assert.equal(event.transaction, '/tools/[redacted]');

  // A HOST is not a segment. `scrubUrl` parses an absolute URL rather than
  // splitting it, so a machine called `tools` cannot redact its own path.
  assert.equal(scrubUrl('https://tools/healthy'), 'https://tools/healthy');
});

test('every dynamic route in app/ has its parent on the redaction list', () => {
  // THE HALF THAT SURVIVES A NEW ROUTE. The list in lib/sentry-scrub.ts is
  // five strings; this reads the route tree the way the router does and fails
  // when a sixth dynamic segment appears under a parent nobody added.
  const parents = new Set();
  const stack = [join(ROOT, 'app')];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(path); continue; }
      if (!/^(page|route)\.(tsx?|jsx?|mjs)$/.test(entry.name)) continue;
      const segments = path
        .slice(join(ROOT, 'app').length)
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .slice(0, -1)
        .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
        .filter((s) => !s.startsWith('@'));
      // A route the scrubber drops OUTRIGHT needs no segment rule, and proving
      // that it is dropped is the stronger assertion. `/api/auth/[...all]` is
      // the only one of these today.
      const concrete = `/${segments.map((s) => (s.startsWith('[') ? 'x' : s)).join('/')}`;
      if (scrubEvent({ request: { url: `https://foundit.tools${concrete}` } }) === null) continue;

      segments.forEach((segment, i) => {
        if (!segment.startsWith('[')) return;
        parents.add(i === 0 ? '' : segments[i - 1]);
      });
    }
  }

  const source = read('lib/sentry-scrub.ts');
  const listed = /const REDACTED_PARENTS = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? '';
  const known = new Set([...listed.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const parent of parents) {
    assert.ok(
      known.has(parent),
      `app/ has a dynamic segment under "${parent || '(the root)'}" and REDACTED_PARENTS in `
        + 'lib/sentry-scrub.ts does not list it, so that parameter would reach Sentry verbatim',
    );
  }
  assert.ok(parents.size >= 4, `only ${parents.size} dynamic parents found — the walk is broken`);
});

test('a breadcrumb carries no header and no body, whatever they are called', () => {
  // F20. `DROPPED_HEADERS` was applied in exactly one place —
  // `event.request.headers` — so a fetch integration recording response
  // headers put a live session cookie into a breadcrumb, past a module header
  // saying every cookie is removed.
  const crumb = scrubBreadcrumb({
    category: 'fetch',
    data: {
      url: 'https://foundit.tools/api/session',
      status_code: 200,
      response_headers: { 'set-cookie': COOKIE, 'content-type': 'text/html' },
      request_headers: { authorization: TOKEN, 'cf-connecting-ip': '203.0.113.45' },
    },
  });
  const serialised = JSON.stringify(crumb);
  assert.ok(!serialised.includes('9f2c1ab'), 'a session token survived in a breadcrumb header');
  assert.ok(!serialised.includes('eyJ'), 'a bearer token survived in a breadcrumb header');
  assert.ok(!serialised.includes('203.0.113.45'), 'an address survived in a breadcrumb header');
  assert.equal(crumb.data.status_code, 200, 'the status code is what makes the crumb worth having');
  assert.equal(crumb.data['content-type'], undefined, 'headers stay under their own key');
  assert.equal(crumb.data.response_headers['content-type'], 'text/html', 'and the harmless ones stay');

  // And the request body, under each of the names an integration gives it.
  for (const key of ['body', 'input', 'arguments', 'request_body', 'response_body']) {
    const one = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://api.openai.com/v1/embeddings', method: 'POST', [key]: `{"input":"${SENTENCE}"}` },
    });
    assert.ok(
      !JSON.stringify(one).includes('receipts'),
      `a breadcrumb's \`${key}\` carried the typed sentence off the machine`,
    );
  }
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
  //
  // THE GUARD USED TO HAVE THREE HOLES AND THE PHASE 9a REVIEW FOUND ALL THREE.
  // It matched only `${…}` interpolation, so `new Error('bad query: ' + q)` —
  // the commonest spelling, and the one the review's own probe used — passed.
  // It knew six identifier names, so `q`, `raw`, `body` and `sentenceText`
  // passed. And `([^)]*)` stopped at the first `)`, so anything after a nested
  // call in the same argument was never examined. A guard that will not catch
  // the regression it exists for is worse than no guard, because it stops
  // anybody looking.
  for (const file of CARRIERS) {
    const source = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const built of builtMessages(source)) {
      assert.ok(
        !carriesTypedInput(built),
        `${file} builds a log line or an error out of the typed sentence:\n    ${built.trim().slice(0, 200)}`,
      );
    }
  }
});

test('the free-text guard catches the spellings it used to miss', () => {
  // THE GUARD'S OWN TEST. Every one of these is a real way to put a typed
  // sentence into an error message, and every one of them passed the version
  // of this check that shipped in Phase 9a.
  for (const line of [
    "new Error('bad query: ' + q)",
    'new Error("while ranking " + sentence)',
    'console.error(`ranking failed for ${q}`)',
    "console.warn('reader said no to ' + searchText)",
    "console.log('body was ' + body)",
    'new Error(`${raw} could not be read`)',
    "console.error(String(error.code) + ' on ' + sentenceText)",
    "new Error('statement: ' + statement)",
  ]) {
    const [built] = builtMessages(line);
    assert.ok(built !== undefined, `the scanner found no message at all in: ${line}`);
    assert.ok(carriesTypedInput(built), `the guard would not catch: ${line}`);
  }

  // And the shapes the codebase actually uses, which must keep passing — a
  // guard that fires on an error code is a guard somebody deletes.
  for (const line of [
    'console.error(`the reranker was unavailable (${reason}); the search order stands`)',
    "new Error('DATABASE_URL is not set. It is the foundit_app connection string.')",
    'console.error(`[timeline] ${label}  ${line}`)',
    "console.error('a maker\\'s write failed (' + (code || 'unknown') + ')')",
  ]) {
    const [built] = builtMessages(line);
    assert.ok(!carriesTypedInput(built ?? ''), `the guard fires on an innocent line: ${line}`);
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
  // ONE NAME, AND NOT TWO. `NEXT_PUBLIC_SENTRY_DSN` was a second name for the
  // browser's half and could never have carried a value: `NEXT_PUBLIC_` is
  // inlined at build time and `process.env` does not exist in a browser
  // (F6). The browser reads a meta tag the server renders, so this function
  // has one variable and the server is the only caller.
  assert.equal(
    sentryDsn({ NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/3' }),
    undefined,
    'a NEXT_PUBLIC_ name must not be a way in: it is a build-time value',
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
    // WHERE THE DSN COMES FROM DIFFERS FOR THE BROWSER, AND ONLY THERE. The
    // two server-side configs read the environment through `sentryDsn`; the
    // browser cannot, so it reads the meta tag `components/AnalyticsBeacon.tsx`
    // renders with the value `sentryDsn` returned on the server. Before F6 it
    // called `sentryDsn(process.env)` in a browser, which is an object that
    // does not exist there, and was therefore inert on every deployment.
    assert.match(
      source,
      file === 'instrumentation-client.ts' ? /meta\[name="sentry-dsn"\]/ : /sentryDsn\(/,
      `${file} must read the DSN from the one place its runtime can see it`,
    );
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
