// ===========================================================================
// Save, Like, Review and the add flow, posted the way a browser posts them
// before the page has hydrated.
//
// THE OWNER'S ITEMS 4, 5, 6 AND 7, WHICH WERE ONE BUG. He pressed Save and
// Like on `/tools/anki` and got a 500. The dev server's log:
//
//     POST /tools/anki?q=… 500
//     TypeError: Invalid URL, input: 'null'
//
// It is not our code. `next/dist/server/app-render/action-handler.js` opens
// the Server Action path with, verbatim:
//
//     const originDomain = typeof req.headers['origin'] === 'string'
//       ? new URL(req.headers['origin']).host : undefined;
//
// with no `try`. `Origin` is a header a browser is allowed to send as the four
// characters `null` — the header carries a SERIALIZED origin, and an opaque
// origin serializes to `null` — so `new URL('null')` throws before anything of
// ours runs, and the action never happens.
//
// WHY IT MATTERED THEN AND NOT BEFORE. `next dev` compiles a route's client
// bundle on first request, which took fifteen to twenty-nine seconds in his
// log. Until it lands, a `<form action={serverAction}>` is a plain form and a
// click is a plain navigational POST — which is exactly the request shape that
// carries the header Next cannot parse. Every one of his four items is that
// same window: the search box lost its Enter handler (item 7), Continue was
// never un-disabled (item 6), and Save and Like posted and 500ed (items 4, 5).
//
// ---------------------------------------------------------------------------
// WHAT THIS TEST POSTS, AND WHY IT IS NOT `application/x-www-form-urlencoded`
//
// The brief asks for urlencoded. Next 15.5 does not support it, and says so in
// its own source — `next/dist/server/lib/server-action-request-meta.js`:
//
//     // We don't actually support URL encoded actions, and the action handler
//     // will bail out if it sees one.
//
// Measured on this laptop: a urlencoded POST of a real action id answers 200
// with the page re-rendered and writes nothing. So a test that posted
// urlencoded and asserted a 303 would be asserting something no browser and no
// version of Next can produce, and the fix it was guarding would be untested.
//
// What a browser actually sends is what Next asks for in the markup it
// renders: `<form ... encType="multipart/form-data" method="POST">`. That is
// what this posts. The two things the brief is really asking for — NO
// `Next-Action` HEADER (so this is the no-script path and not the fetch one)
// and NO ORIGIN — are both asserted, and a third case is added that the brief
// could not have known to ask for: `Origin: null`, which is the exact header
// the owner's browser sent.
//
// IT SKIPS when no server answers and REFUSES a `next dev` server, the rule
// tests/csp.test.mjs and tests/links.test.mjs follow.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import pg from 'pg';

import { hashSignInCode } from '../lib/auth-options.ts';
import { refusalFor, serverKind } from './browser.mjs';

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
  if (!process.env.DATABASE_URL_AUTH || !process.env.BETTER_AUTH_SECRET) {
    t.skip(
      'DATABASE_URL_AUTH and BETTER_AUTH_SECRET are needed to mint the throwaway account '
        + 'these actions need a session for. Run with `node --env-file=.env.local`.',
    );
    return false;
  }
  const kind = await serverKind(origin);
  if (kind !== 'production') assert.fail(refusalFor(origin, kind));
  return true;
}

/* ---------------------------------------------------------------------------
 * The throwaway account.
 *
 * The same shortcut tests/links.test.mjs uses and docs/development.md explains
 * at length: Better Auth issues the row, verifies the code, creates the
 * session and signs the cookie, and the only thing supplied here is what an
 * inbox would supply. It needs the auth role's password and the key codes are
 * hashed under, so it is not a way in — anybody holding both can already sign
 * in as anybody.
 * ------------------------------------------------------------------------ */
async function mintSession(origin) {
  const auth = new pg.Pool({ connectionString: process.env.DATABASE_URL_AUTH });
  const email = `no-script-${Date.now()}@example.invalid`;
  const code = '424242';

  const sent = await fetch(`${origin}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, type: 'sign-in' }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  assert.ok(sent.ok, `the server refused to issue a sign-in code (${sent.status})`);

  const updated = await auth.query(
    'update auth_core.verification set value = $1 where identifier = $2',
    [`${await hashSignInCode(code)}:0`, `sign-in-otp-${email}`],
  );
  assert.equal(updated.rowCount, 1, 'the sign-in code row was not there');

  const signedIn = await fetch(`${origin}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, otp: code }),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  assert.ok(signedIn.ok, `the throwaway account could not sign in (${signedIn.status})`);

  const cookie = (signedIn.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(';')[0])
    .filter((pair) => pair.includes('session_token'))
    .join('; ');
  assert.notEqual(cookie, '', 'signing in produced no session cookie');

  const { rows } = await auth.query('select id from auth_core."user" where email = $1', [email]);
  return { auth, email, cookie, userId: rows[0]?.id ?? null };
}

async function cleanUp(session) {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  try {
    if (session.userId) {
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query("select pg_catalog.set_config('foundit.definer','on',true)");
        await client.query("select pg_catalog.set_config('foundit.counters','on',true)");
        await client.query('delete from public.profiles where id = $1', [session.userId]);
        await client.query('commit');
      } catch {
        await client.query('rollback');
      } finally {
        client.release();
      }
      await session.auth.query('delete from auth_core.session where "userId" = $1', [session.userId]);
      await session.auth.query('delete from auth_core.account where "userId" = $1', [session.userId]);
      await session.auth.query('delete from auth_core."user" where id = $1', [session.userId]);
    }
    await session.auth.query('delete from auth_core.verification where identifier = $1', [
      `sign-in-otp-${session.email}`,
    ]);
  } finally {
    await Promise.all([owner.end(), session.auth.end()]);
  }
}

/* ---------------------------------------------------------------------------
 * Reading a form out of the HTML the way a browser does.
 * ------------------------------------------------------------------------ */

/** Every `<form>` on the page, with its hidden fields and its action id. */
function formsIn(html) {
  const out = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const attrs = match[1];
    const inner = match[2];
    const fields = {};
    let actionId = null;
    for (const input of inner.matchAll(/<input\b[^>]*>/g)) {
      const tag = input[0];
      const name = /name="([^"]*)"/.exec(tag)?.[1];
      if (!name) continue;
      if (name.startsWith('$ACTION_ID_')) {
        actionId = name;
        continue;
      }
      fields[name] = /value="([^"]*)"/.exec(tag)?.[1] ?? '';
    }
    for (const ta of inner.matchAll(/<textarea\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
      fields[ta[1]] = ta[2];
    }
    if (actionId) out.push({ actionId, fields, encType: /encType="([^"]*)"/i.exec(attrs)?.[1] ?? '' });
  }
  return out;
}

/** Build the multipart body a browser would send for these fields. */
function multipart(fields, actionId) {
  const boundary = '----founditNoScript' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [name, value] of Object.entries({ ...fields, [actionId]: '' })) {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${value}\r\n`,
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Post a form the way an unhydrated page posts it.
 *
 * NO `Next-Action` HEADER, which is what makes this the no-script path rather
 * than the fetch one; the header is the only thing that distinguishes them.
 * `origin` is what the three cases vary.
 */
async function postForm(url, form, { origin, cookie }) {
  const { body, contentType } = multipart(form.fields, form.actionId);
  const headers = { 'content-type': contentType, cookie };
  if (origin !== undefined) headers.origin = origin;
  return fetch(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

/* ---------------------------------------------------------------------------
 * The tests.
 * ------------------------------------------------------------------------ */

test('every form Next renders for a Server Action is a real form', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const html = await (await fetch(`${origin}/tools/anki`, { signal: AbortSignal.timeout(TIMEOUT) })).text();
  const forms = formsIn(html);
  assert.ok(forms.length > 0, 'the tool page renders no Server Action form at all');

  // `multipart/form-data` is Next's own choice and it is the reason this file
  // does not post urlencoded: see the header.
  for (const form of forms) {
    assert.equal(
      form.encType,
      'multipart/form-data',
      'Next renders its action forms as multipart, so that is what a browser sends',
    );
  }
});

test('Save, Like, Review and the add flow complete with no script and no Origin', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const session = await mintSession(origin);

  /* THE ROWS ARE READ AS THE OWNER, IN THE OWNER'S WINDOW, and not as the
   * application. `tool_likes`, `collection_items` and `reviews` all carry
   * row-level security scoped to `auth.uid()`, and a connection with no claim
   * on it sees nothing — so an assertion that read them as `foundit_app`
   * would report "the like was not written" for a like that was. That is the
   * failure mode 0020's own header is about, met in a test rather than in a
   * migration. db/test/reports_test.sql reads rows the same way and for the
   * same reason. */
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  const asOwner = async (sql, params) => {
    const client = await owner.connect();
    try {
      await client.query('begin');
      await client.query("select pg_catalog.set_config('foundit.definer','on',true)");
      const result = await client.query(sql, params);
      await client.query('commit');
      return result;
    } finally {
      client.release();
    }
  };

  try {
    const slug = 'anki';
    const page = `${origin}/tools/${slug}?q=${encodeURIComponent('need to edit PDF free')}`;

    // --- LIKE, with NO Origin header at all --------------------------------
    {
      const html = await (await fetch(page, { headers: { cookie: session.cookie } })).text();
      const form = formsIn(html).find((f) => 'liked' in f.fields);
      assert.ok(form, 'the tool page renders no Like form for a signed-in person');

      const res = await postForm(page, form, { cookie: session.cookie });
      assert.equal(res.status, 303, 'a Like posted with no Origin must redirect, not 500');

      const { rows } = await asOwner(
        'select 1 from public.tool_likes l join public.tools t on t.id = l.tool_id '
          + 'where t.slug = $1 and l.user_id = $2',
        [slug, session.userId],
      );
      assert.equal(rows.length, 1, 'the like was not written');
    }

    // --- SAVE, with `Origin: null` — the owner's own header -----------------
    {
      const html = await (await fetch(page, { headers: { cookie: session.cookie } })).text();
      const form = formsIn(html).find((f) => 'newName' in f.fields);
      assert.ok(form, 'the tool page renders no Save form for a signed-in person');

      // `collectionId` is a `<select>`, and a browser submits its selected
      // option. `new` is the one option a brand-new account has — it has no
      // lists yet — and `newName` is the box beside it, so this is exactly
      // what the menu posts on a first save.
      form.fields.collectionId = 'new';
      form.fields.newName = 'Saved with no script';

      const res = await postForm(page, form, { origin: 'null', cookie: session.cookie });
      assert.equal(
        res.status,
        303,
        'a Save posted with `Origin: null` must redirect. This is the owner\'s 500: '
          + 'Next does `new URL(req.headers.origin)` with no try, and middleware.ts '
          + 'normalises an unparseable origin to the request\'s own before it gets there.',
      );

      const { rows } = await asOwner(
        'select 1 from public.collection_items i '
          + 'join public.tools t on t.id = i.tool_id '
          + 'join public.collections c on c.id = i.collection_id '
          + 'where t.slug = $1 and c.owner_id = $2',
        [slug, session.userId],
      );
      assert.equal(rows.length, 1, 'the save was not written');
    }

    // --- REVIEW, with `Origin: null` ---------------------------------------
    {
      const html = await (await fetch(page, { headers: { cookie: session.cookie } })).text();
      const form = formsIn(html).find((f) => 'rating' in f.fields || 'body' in f.fields);
      assert.ok(form, 'the tool page renders no review form for a signed-in person');

      form.fields.rating = '4';
      form.fields.body = 'Posted with no JavaScript at all, which is the point of this test.';

      const res = await postForm(page, form, { origin: 'null', cookie: session.cookie });
      assert.equal(res.status, 303, 'a review posted with `Origin: null` must redirect');

      const { rows } = await asOwner(
        'select rating from public.reviews r join public.tools t on t.id = r.tool_id '
          + 'where t.slug = $1 and r.author_id = $2 and r.deleted_at is null',
        [slug, session.userId],
      );
      assert.equal(rows.length, 1, 'the review was not written');
      assert.equal(Number(rows[0].rating), 4, 'the rating that was written is not the one posted');
    }
    // --- THE ADD FLOW, in the same test and on the same session ----------
    //
    // ONE SESSION FOR ALL FOUR ACTIONS, and that is not tidiness. Minting one
    // asks the server for a sign-in code, and `MAX_CODES_PER_IP_PER_HOUR` is
    // twenty from one address — which is this machine, for every test in this
    // file and every other file that mints one. A second session here made
    // this test fail with a 429 that had nothing to do with what it was
    // testing.
    {
      const page = `${origin}/submit`;
    const html = await (await fetch(page, { headers: { cookie: session.cookie } })).text();

    // ITEM 6: the button is enabled in the server-rendered HTML. It used to
    // carry `disabled` and be un-disabled by a `useState`, which made it the
    // one control on this flow that a person could not use until the route's
    // client bundle had compiled.
    assert.doesNotMatch(html, /<button[^>]*\bdisabled\b/, 'Continue must not be disabled');
    assert.doesNotMatch(html, /<noscript>/, 'and needs no <noscript> duplicate');
    assert.match(html, /required=""/, 'the checkbox is `required`, which is what refuses it');

    // THE FORM WITH THE TICK IN IT, and not `[0]`: the first form on any page
    // is the header's sign-out. This test failed once by posting to that one
    // and reading the redirect to `/` as the add flow refusing something.
    const form = formsIn(html).find((f) => 'made' in f.fields);
    assert.ok(form, 'the first step of the add flow renders no form with the tick in it');

    // Unticked: the browser refuses it, and so does the server if something
    // gets past the browser.
    const refused = await postForm(page, { ...form, fields: {} }, {
      origin: 'null',
      cookie: session.cookie,
    });
    assert.equal(refused.status, 303, 'an unticked POST is answered, not 500ed');
    assert.match(
      refused.headers.get('location') ?? '',
      /problem=tick/,
      'and it comes back to the tick with a reason',
    );

    // Ticked, with `Origin: null`.
    const ticked = await postForm(page, { ...form, fields: { made: 'yes' } }, {
      origin: 'null',
      cookie: session.cookie,
    });
    assert.equal(ticked.status, 303, 'a ticked POST with `Origin: null` must go on');
    assert.match(
      ticked.headers.get('location') ?? '',
      /\/submit\/url/,
      'and it goes to the next step',
    );
    }
  } finally {
    await owner.end();
    await cleanUp(session);
  }
});

test('a cross-site POST is still refused', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  // The other half of middleware.ts's normalisation, and the half that makes
  // it safe: an unparseable origin becomes the request's own ONLY when
  // `Sec-Fetch-Site` is not `cross-site`. A browser that says the request came
  // from another site gets an origin that can never match our host, so Next
  // refuses it with its own message rather than throwing.
  const html = await (await fetch(`${origin}/tools/anki`, { signal: AbortSignal.timeout(TIMEOUT) })).text();
  const form = formsIn(html)[0];
  assert.ok(form, 'no form to post');

  const { body, contentType } = multipart(form.fields, form.actionId);
  const res = await fetch(`${origin}/tools/anki`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      origin: 'null',
      'sec-fetch-site': 'cross-site',
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  assert.equal(res.status, 500, 'a cross-site action POST must be refused, not run');

  const named = await fetch(`${origin}/tools/anki`, {
    method: 'POST',
    headers: { 'content-type': contentType, origin: 'https://evil.example' },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  assert.equal(named.status, 500, 'and so must one from a named other origin');
});
