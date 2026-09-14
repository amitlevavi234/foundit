// ===========================================================================
// The Origin rewrite, and the three things that read an Origin — OWNER
// FEEDBACK, ROUND 1, F7.
//
// `middleware.ts` normalises an unparseable or missing `Origin` to the
// request's own, because Next's Server Action handler does
// `new URL(req.headers['origin'])` with no `try` and a browser is allowed to
// send the four characters `null`. That fix is right and the owner's 500 is
// gone. What was wrong is that it ran for EVERY POST on EVERY route, and two
// things downstream had deliberately stricter rules of their own:
//
//   `app/o/route.ts` says in its own header that "a browser sends Origin on
//   every POST, including a same-origin one, so a missing Origin is not a
//   browser and is refused". That refusal was dead — the route was handed an
//   origin middleware had written — and a `POST /o` with no Origin header at
//   all counted a click. Neither tests/beacon.test.mjs nor
//   tests/outbound.test.mjs contained the word `origin`.
//
//   Better Auth's `validateOrigin` throws for a cookie-bearing POST whose
//   Origin is absent or `null`. It never saw what the client sent.
//
// So the rewrite is now scoped to requests Next's action handler will actually
// read — a `Next-Action` header, or a multipart POST to a page route — and
// `/api/*` and `/o` are outside its matcher. This file is the matrix for all
// three, which is what did not exist.
//
// IT ALSO COVERS F24, because that is the other request-shape defect
// middleware now answers: `Next-Router-Prefetch` with no `RSC` was a 500 any
// client could produce at will, from inside Next's own layout router.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import pg from 'pg';

import { refusalFor, serverKind } from './browser.mjs';
import { cleanUp, mintSession } from './throwaway.mjs';

const TIMEOUT = 60_000;

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
    const r = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return r.status > 0;
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

/** Headers for one row of a matrix. `undefined` means "do not send it". */
function head(extra, { origin, site }) {
  const headers = { ...extra };
  if (origin !== undefined) headers.origin = origin;
  if (site !== undefined) headers['sec-fetch-site'] = site;
  return headers;
}

/* ---------------------------------------------------------------------------
 * THE BEACON. `public.tools.open_count` for one listing, read before and after
 * each request and restored afterwards — the reviewer's own method, because it
 * is the only thing that distinguishes a counted click from a refused one:
 * `/o` answers 204 to everybody on purpose, so the status code says nothing.
 * ------------------------------------------------------------------------ */
test('POST /o believes the client’s own Origin and nothing middleware wrote', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;
  if (!process.env.DATABASE_URL_OWNER) {
    t.skip('DATABASE_URL_OWNER is needed to read the counter this asserts on');
    return;
  }

  const slug = 'anki';
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  const asOwner = async (sql, params) => {
    const client = await owner.connect();
    try {
      await client.query('begin');
      await client.query("select pg_catalog.set_config('foundit.definer','on',true)");
      await client.query("select pg_catalog.set_config('foundit.counters','on',true)");
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
  const count = async () =>
    Number(
      (await asOwner('select open_count from public.tools where slug = $1::citext', [slug]))
        .rows[0]?.open_count ?? -1,
    );

  const before = await count();
  assert.notEqual(before, -1, `there is no listing called ${slug} to count against`);

  try {
    const rows = [
      // what is sent                                          counted?
      [{ origin: undefined, site: undefined }, false, 'no Origin header at all is not a browser'],
      [{ origin: 'null', site: undefined }, false, '`Origin: null` is not this origin'],
      [
        { origin: 'null', site: 'cross-site' },
        false,
        '`Origin: null` from another site is certainly not',
      ],
      [{ origin: 'https://evil.example', site: undefined }, false, 'nor is a named other origin'],
      [{ origin: undefined, site: 'cross-site' }, false, 'nor is no Origin from another site'],
      // And the one that IS a browser posting our own page's beacon.
      [{ origin, site: 'same-origin' }, true, 'our own origin is counted'],
    ];

    for (const [how, counted, why] of rows) {
      const was = await count();
      const response = await fetch(`${origin}/o`, {
        method: 'POST',
        headers: head({ 'content-type': 'application/x-www-form-urlencoded' }, how),
        body: new URLSearchParams({ slug }).toString(),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      assert.equal(response.status, 204, '/o answers 204 to everybody; a varying status is an oracle');

      const now = await count();
      assert.equal(
        now - was,
        counted ? 1 : 0,
        `POST /o with origin=${how.origin ?? '(absent)'} sec-fetch-site=${how.site ?? '(absent)'} `
          + `moved the counter by ${now - was}: ${why}`,
      );
    }
  } finally {
    // The database is left exactly as it was found.
    await asOwner('update public.tools set open_count = $1 where slug = $2::citext', [
      before,
      slug,
    ]);
    await owner.end();
  }
});

/* ---------------------------------------------------------------------------
 * BETTER AUTH. Its `validateOrigin` throws MISSING_OR_NULL_ORIGIN for a
 * cookie-bearing POST whose Origin is absent or `null`, unless Sec-Fetch-Site
 * says same-origin. Before F7 it never saw what the client sent, so a
 * `POST /api/auth/sign-out` with no Origin header signed the session out.
 * ------------------------------------------------------------------------ */
test('POST /api/auth/* sees the client’s own Origin', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;
  if (!process.env.DATABASE_URL_AUTH || !process.env.DATABASE_URL_OWNER) {
    t.skip('a throwaway session needs DATABASE_URL_AUTH and DATABASE_URL_OWNER');
    return;
  }

  const session = await mintSession(origin, 'origin-matrix');
  try {
    const signOut = (how) =>
      fetch(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: head({ 'content-type': 'application/json', cookie: session.cookie }, how),
        body: '{}',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT),
      });

    // Every refusal first, so the session is still alive for each of them —
    // a refused sign-out changes nothing, which is the point.
    for (const [how, why] of [
      [{ origin: undefined, site: undefined }, 'no Origin header at all'],
      [{ origin: 'null', site: undefined }, '`Origin: null`'],
      [{ origin: 'null', site: 'cross-site' }, '`Origin: null` from another site'],
      [{ origin: 'https://evil.example', site: undefined }, 'a named other origin'],
    ]) {
      const response = await signOut(how);
      assert.ok(
        response.status >= 400,
        `sign-out with ${why} answered ${response.status}; Better Auth is supposed to refuse it, `
          + 'and before F7 it never saw the header at all',
      );
    }

    // And the real thing still works, which is the half that proves the four
    // above are about the Origin rather than about something being broken.
    const ok = await signOut({ origin, site: 'same-origin' });
    assert.equal(ok.status, 200, 'a same-origin sign-out must still work');
  } finally {
    await cleanUp(session);
  }
});

/* ---------------------------------------------------------------------------
 * A SERVER ACTION. `/report` is one of the three session-less actions the
 * origin rules actually protect — what makes a cross-site POST to Save, Like
 * or Review harmless is `SameSite=Lax` on the cookie, so those arrive signed
 * out and have nothing to do.
 *
 * THE REPORT IS DELIBERATELY REFUSED BY ITS OWN VALIDATION: the reason is one
 * character, so the action redirects with `problem=short` before it writes a
 * row, sends an email or spends a token from any bucket. The status code is
 * what this file is reading, and this way the matrix leaves nothing behind.
 * ------------------------------------------------------------------------ */
function actionFormIn(html) {
  for (const match of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
    const id = /name="(\$ACTION_ID_[^"]*)"/.exec(match[1])?.[1];
    if (id) return id;
  }
  return null;
}

function multipart(fields) {
  const boundary = '----founditOrigin' + Math.random().toString(16).slice(2);
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
}

test('a Server Action POST, across the whole Origin matrix', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const page = `${origin}/report`;
  const html = await (await fetch(page, { signal: AbortSignal.timeout(TIMEOUT) })).text();
  const actionId = actionFormIn(html);
  assert.ok(actionId, '/report renders no Server Action form to post');

  const { body, contentType } = multipart({
    kind: 'tool',
    target: 'anki',
    reason: 'x',
    details: '',
    [actionId]: '',
  });

  const post = (how) =>
    fetch(page, {
      method: 'POST',
      headers: head({ 'content-type': contentType }, how),
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    });

  const rows = [
    // THE PAIR NO BROWSER PRODUCES. Refused by middleware with a sentence.
    [{ origin: undefined, site: undefined }, 403, 'no Origin and no Sec-Fetch-Site is a script'],
    [{ origin: 'null', site: undefined }, 403, 'and so is `Origin: null` with no Fetch Metadata'],
    // AN UNPARSEABLE ORIGIN FROM OUR OWN SITE. This is the owner's 500: the
    // header is normalised and the action runs.
    [{ origin: 'null', site: 'same-origin' }, 303, '`Origin: null` from our own page still works'],
    [{ origin: undefined, site: 'same-origin' }, 303, 'and so does a missing one'],
    // CROSS-SITE. Next refuses it with its own message.
    [{ origin: 'null', site: 'cross-site' }, 500, '`Origin: null` from another site is refused'],
    [{ origin: undefined, site: 'cross-site' }, 500, 'and so is no Origin from another site'],
    [{ origin: 'https://evil.example', site: undefined }, 500, 'and a named other origin'],
    [
      { origin: 'https://evil.example', site: 'same-origin' },
      500,
      'a real other origin is refused whatever Fetch Metadata claims',
    ],
    // AND THE ORDINARY CASE.
    [{ origin, site: 'same-origin' }, 303, 'our own origin runs the action'],
  ];

  for (const [how, expected, why] of rows) {
    const response = await post(how);
    assert.equal(
      response.status,
      expected,
      `POST /report with origin=${how.origin ?? '(absent)'} sec-fetch-site=${how.site ?? '(absent)'} `
        + `answered ${response.status} and should answer ${expected}: ${why}`,
    );
    // Every row that ran the action came back to the form with the reason it
    // was refused, and with nothing the reporter typed on the query string —
    // F13.
    if (expected === 303) {
      const location = response.headers.get('location') ?? '';
      assert.equal(location, '/report?problem=short', `the redirect was ${location}`);
    }
  }

  // The refusal says why, in words, rather than answering "Forbidden".
  const refused = await post({ origin: undefined, site: undefined });
  assert.match(await refused.text(), /no browser sends that pair/);
});

/* ---------------------------------------------------------------------------
 * F24 — a prefetch header with no RSC header used to be a 500.
 *
 * `ReferenceError: location is not defined`, out of Next's own
 * `InnerLayoutRouter` while rendering on the server. Three of three on the
 * reviewed build and three of three on the build before it, so this range did
 * not introduce it — but it is a 500 any client can produce at will, which on
 * a deployment with a DSN is an issue in Sentry per request.
 * ------------------------------------------------------------------------ */
test('a prefetch header with no RSC header answers 200', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  for (const path of ['/about', '/', '/browse']) {
    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${origin}${path}`, {
        headers: { 'next-router-prefetch': '1' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT),
      });
      assert.equal(
        response.status,
        200,
        `GET ${path} with Next-Router-Prefetch and no RSC answered ${response.status}`,
      );
    }
  }

  // And a REAL prefetch — both headers, which is what the router sends — is
  // still a prefetch and is still answered.
  const real = await fetch(`${origin}/about`, {
    headers: { rsc: '1', 'next-router-prefetch': '1' },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  assert.equal(real.status, 200, 'a real prefetch must still be answered');
});
