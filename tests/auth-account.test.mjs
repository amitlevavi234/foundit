// ===========================================================================
// What we ask Google for, what we keep afterwards, and which header the
// library's own rate limiter counts a client by.
//
// Three review items, all of them about a default that is not this project's
// default:
//
//   the scopes      Better Auth APPENDS a configured scope list to its own
//                   rather than replacing it, so the consent screen's URL read
//                   `email+profile+openid+openid+email+profile`.
//   the tokens      after a Google sign-in, `auth_core.account` held an access
//                   token and an ID token for an account this application never
//                   calls again. A credential to somebody else's system, in our
//                   database, for as long as it is valid, bought for nothing.
//   the limiter     Better Auth keys its rate limiter on `x-forwarded-for`,
//                   which anybody talking to the origin can write — a limit
//                   somebody can opt out of by typing is worse than none,
//                   because it looks like one.
//
// lib/auth.ts imports `server-only` and opens a pool, so the three decisions
// live in lib/auth-options.ts where plain Node can drive them, and this file
// checks the wiring by reading lib/auth.ts as text — the same arrangement
// tests/auth-schema.test.mjs uses.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getIP } from '@better-auth/core/utils/ip';
import { google } from '@better-auth/core/social-providers';

import {
  AUTH_IP_HEADERS,
  GOOGLE_SCOPES,
  PROVIDER_TOKEN_COLUMNS,
  withoutProviderTokens,
} from '../lib/auth-options.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const AUTH = readFileSync(join(ROOT, 'lib', 'auth.ts'), 'utf8');
const VISITOR = readFileSync(join(ROOT, 'lib', 'visitor.ts'), 'utf8');

/** The scope parameter Google would actually be sent, for some options. */
async function scopeParameter(options) {
  const url = await google({
    clientId: 'a-client-id',
    clientSecret: 'a-client-secret',
    ...options,
  }).createAuthorizationURL({
    state: 'state',
    codeVerifier: 'v'.repeat(43),
    redirectURI: 'http://localhost:3000/api/auth/callback/google',
  });
  return new URL(String(url)).searchParams.get('scope');
}

/* ===========================================================================
 * The scopes
 * ======================================================================== */

test('each scope appears exactly once in the URL a person is sent to', async () => {
  const scope = await scopeParameter({
    scope: [...GOOGLE_SCOPES],
    disableDefaultScope: true,
  });
  const asked = scope.split(/[\s+]+/).filter(Boolean);

  assert.deepEqual(asked, ['openid', 'email', 'profile']);
  assert.equal(new Set(asked).size, asked.length, 'no scope is asked for twice');
});

test('and without disableDefaultScope the library asks for all three twice', async () => {
  // The finding, reproduced, so that removing the option fails this file
  // rather than quietly restoring the URL the review read.
  const scope = await scopeParameter({ scope: [...GOOGLE_SCOPES] });
  const asked = scope.split(/[\s+]+/).filter(Boolean);

  assert.equal(asked.length, 6, 'the defaults are appended, not replaced');
  assert.notEqual(new Set(asked).size, asked.length);
  assert.match(AUTH, /disableDefaultScope: true/, 'so lib/auth.ts must turn the merge off');
  assert.match(AUTH, /scope: \[\.\.\.GOOGLE_SCOPES\]/);
});

/* ===========================================================================
 * The tokens
 * ======================================================================== */

test('nothing from the provider survives the hook except who they are', () => {
  // The row Better Auth wants to write after a Google sign-in, with the shape
  // db/migrations/0013_accounts.sql gives auth_core."account".
  const fromGoogle = {
    id: 'acc_1',
    accountId: '104729...',
    providerId: 'google',
    userId: 'usr_1',
    accessToken: 'ya29.a0AfB_by...',
    refreshToken: '1//09xyz...',
    idToken: 'eyJhbGciOi...',
    accessTokenExpiresAt: new Date('2026-09-12T12:00:00Z'),
    refreshTokenExpiresAt: new Date('2026-10-12T12:00:00Z'),
    scope: 'openid email profile',
    password: null,
    createdAt: new Date('2026-09-12T11:00:00Z'),
    updatedAt: new Date('2026-09-12T11:00:00Z'),
  };

  const stored = withoutProviderTokens(fromGoogle);

  for (const column of PROVIDER_TOKEN_COLUMNS) {
    assert.equal(stored[column], null, `${column} must not be stored`);
  }
  // And the identity, which is the entire reason the row exists, is untouched.
  assert.equal(stored.providerId, 'google');
  assert.equal(stored.accountId, '104729...');
  assert.equal(stored.userId, 'usr_1');
  assert.equal(stored.scope, 'openid email profile');
  assert.equal(stored.createdAt, fromGoogle.createdAt);

  // The argument is not mutated: the hook returns a row, it does not edit the
  // library's.
  assert.equal(fromGoogle.accessToken, 'ya29.a0AfB_by...');
});

test('a partial update is not given columns it was not going to write', () => {
  const partial = { idToken: 'eyJhbGciOi...', updatedAt: new Date('2026-09-12T11:30:00Z') };
  const stored = withoutProviderTokens(partial);

  assert.deepEqual(Object.keys(stored).sort(), ['idToken', 'updatedAt']);
  assert.equal(stored.idToken, null);
  assert.equal(stored.updatedAt, partial.updatedAt);
});

test('the hook is wired on the update as well as the create', () => {
  // `updateAccountOnSignIn` defaults to true, so a hook on the create alone
  // would be undone by the second sign-in.
  assert.match(AUTH, /databaseHooks: \{/);
  assert.match(AUTH, /create: \{\s*before: async \(account\) => \(\{ data: withoutProviderTokens\(account\) \}\),/);
  assert.match(AUTH, /update: \{\s*before: async \(account\) => \(\{ data: withoutProviderTokens\(account\) \}\),/);
});

/* ===========================================================================
 * The limiter's idea of who a client is
 * ======================================================================== */

test('a forged x-forwarded-for is not a bucket of its own', () => {
  const options = { advanced: { ipAddress: { ipAddressHeaders: [...AUTH_IP_HEADERS] } } };

  // The default the library ships with, and what it would do with a header
  // anybody talking to the origin can write.
  assert.equal(getIP(new Headers({ 'x-forwarded-for': '1.2.3.4' }), {}), '1.2.3.4');

  // Ours: the same request resolves to no client at all, which the limiter
  // keys as one shared bucket per path rather than as a fresh identity.
  assert.equal(getIP(new Headers({ 'x-forwarded-for': '1.2.3.4' }), options), null);
  assert.equal(
    getIP(new Headers({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }), options),
    null,
    'nor a chain of them',
  );
});

test('cf-connecting-ip is what counts, and it outranks anything the client sent', () => {
  const options = { advanced: { ipAddress: { ipAddressHeaders: [...AUTH_IP_HEADERS] } } };
  const headers = new Headers({ 'cf-connecting-ip': '5.6.7.8', 'x-forwarded-for': '1.2.3.4' });

  assert.equal(getIP(headers, options), '5.6.7.8');
  assert.equal(getIP(new Headers({ 'cf-connecting-ip': '5.6.7.8' }), options), '5.6.7.8');
});

test('and it is the same header the application’s own limiter counts', () => {
  // Two limiters keyed on two different ideas of a visitor would be two
  // different limits, and the weaker one would be the real one.
  assert.deepEqual([...AUTH_IP_HEADERS], ['cf-connecting-ip']);
  assert.match(
    VISITOR,
    /const ADDRESS_HEADERS = \['cf-connecting-ip'/,
    'lib/visitor.ts must still trust the same header first',
  );
  assert.match(AUTH, /ipAddress: \{ ipAddressHeaders: \[\.\.\.AUTH_IP_HEADERS\] \}/);
});
