// ===========================================================================
// A throwaway account, and the way to get rid of it again.
//
// It was written for `tests/no-script.test.mjs` and lived there; OWNER
// FEEDBACK, ROUND 1, F19 needed the same thing in `tests/english.test.mjs`, so
// it is here rather than in both. Two copies of a routine that CREATES A REAL
// ACCOUNT and then deletes it is two chances for one of them to stop deleting.
//
// THE SHORTCUT IS THE SAME ONE tests/links.test.mjs USES and docs/development.md
// explains at length: Better Auth issues the row, verifies the code, creates
// the session and signs the cookie, and the only thing supplied here is what an
// inbox would supply. It needs the auth role's password and the key codes are
// hashed under, so it is not a way in — anybody holding both can already sign
// in as anybody.
//
// NO REAL ADDRESS EVER. Every account it mints is `@example.invalid`, which is
// a name the DNS guarantees does not resolve, and the code is never sent
// anywhere: it is written straight into `auth_core.verification`.
// ===========================================================================
import assert from 'node:assert/strict';

import pg from 'pg';

import { hashSignInCode } from '../lib/auth-options.ts';

const TIMEOUT = 30_000;

/**
 * Sign a brand-new account in, and hand back its cookie.
 *
 * The caller MUST pass the result to `cleanUp` in a `finally`, whatever else
 * happens: this leaves a row in four tables until it does.
 */
export async function mintSession(origin, label = 'throwaway') {
  const auth = new pg.Pool({ connectionString: process.env.DATABASE_URL_AUTH });
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  const code = '424242';

  /* THE CODE ROW IS WRITTEN HERE RATHER THAN ASKED FOR OVER HTTP, and that is
   * about the RATE LIMITER rather than about speed.
   *
   * `POST /api/auth/email-otp/send-verification-otp` goes through
   * `allowSignInCode`, whose second ceiling is twenty per IP per hour — and
   * with `TRUST_CLOUDFLARE_HEADERS` unset (the default, and the state of this
   * laptop) every caller shares one bucket. So every test file that minted a
   * session spent from the same twenty, `node --test` runs files in parallel,
   * and the suite began failing with 429s that had nothing to do with what any
   * of those tests was checking: whether a test passed depended on how many
   * OTHER tests had run first, which is the worst property a test can have.
   *
   * The previous version already overwrote this row's value immediately after
   * asking for it, so the request bought nothing but the row's existence. It
   * is the same shortcut, one step further: Better Auth still verifies the
   * code, creates the account and signs the cookie, and the only thing
   * supplied here is what an inbox would supply.
   *
   * THE CEILING ITSELF IS NOT LEFT UNTESTED. `tests/rate-limit.test.mjs` drives
   * `allowSignInCode` directly, with both of its buckets and the defaults from
   * `.env.example`, and `tests/sign-in.test.mjs` covers the page. Neither needs
   * a throwaway account to do it. */
  await auth.query(
    `insert into auth_core.verification (id, identifier, value, "expiresAt")
     values ($1, $2, $3, now() + interval '10 minutes')`,
    [
      `test-otp-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      `sign-in-otp-${email}`,
      `${await hashSignInCode(code)}:0`,
    ],
  );

  /* AND THE SIGN-IN IS RETRIED ON A 429, because Better Auth has a rate limit
   * of its own and it is a short one: `getDefaultSpecialRules()` in
   * `better-auth/dist/api/rate-limiter` gives every path under `/sign-in`
   * THREE REQUESTS PER TEN SECONDS, per address — and `node --test` runs test
   * files in parallel, so four files minting a throwaway at the same moment is
   * four sign-ins in one window.
   *
   * Waiting is the honest answer rather than turning the limit off: the limit
   * is right, this is genuinely four requests from one machine in ten seconds,
   * and a test that disabled it would be testing a build nobody ships. Ten
   * seconds is the whole window, so one wait is almost always enough. */
  let signedIn = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    signedIn = await fetch(`${origin}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, otp: code }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (signedIn.status !== 429) break;
    const after = Number.parseInt(
      signedIn.headers.get('x-retry-after') ?? signedIn.headers.get('retry-after') ?? '',
      10,
    );
    const seconds = Number.isFinite(after) && after > 0 ? Math.min(after, 15) : 5;
    await new Promise((resolve) => setTimeout(resolve, (seconds + attempt) * 1000));
  }
  assert.ok(
    signedIn?.ok,
    `the throwaway account could not sign in (${signedIn?.status}). A 429 here after five `
      + 'tries is Better Auth’s own three-per-ten-seconds rule on /sign-in, which means '
      + 'more of this suite is minting accounts at once than it used to.',
  );

  const cookie = (signedIn.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(';')[0])
    .filter((pair) => pair.includes('session_token'))
    .join('; ');
  assert.notEqual(cookie, '', 'signing in produced no session cookie');

  const { rows } = await auth.query('select id from auth_core."user" where email = $1', [email]);
  return { auth, email, cookie, userId: rows[0]?.id ?? null };
}

/** And take it away again, from all four tables it reached. */
export async function cleanUp(session) {
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
