// ===========================================================================
// The request wrapper — the thing that makes auth.uid() mean anything.
//
// Self-hosted, nothing sets `request.jwt.claims` for us. PostgREST used to;
// take Supabase away and if the application writes no extra code, auth.uid()
// is null on every request and either everything is denied or — much worse —
// the app connects as the owner and every policy is silently skipped
// (research/09 §3).
//
// So this file drives `runWithIdentity` directly, with a client that records
// what it was asked to do. It is the SAME function lib/db.ts uses: that module
// adds a checked-out connection and nothing else, which is exactly why the
// interesting part lives where a test can reach it.
//
// The database's half of "fails closed" — an unset, empty, malformed or stale
// claim reading nothing and writing nothing — is db/test/accounts_test.sql §2,
// against a real PostgreSQL. This is the half that decides what is sent.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SET_IDENTITY_SQL,
  claimsFor,
  identityParams,
  runWithIdentity,
} from '../lib/identity.ts';

/** A client that writes down every statement instead of running one. */
function recorder(behaviour = {}) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      if (behaviour[text.trim().split(/\s/)[0]]) throw behaviour[text.trim().split(/\s/)[0]];
      return { rows: [], rowCount: 0 };
    },
  };
}

test('a stranger is an EMPTY claim, not a user id and not "{}"', () => {
  assert.equal(claimsFor(null), '');
  assert.equal(claimsFor(undefined), '');
  assert.equal(claimsFor(''), '');
  // An empty string is what auth.uid()'s first nullif is for. '{}' would parse
  // and then fail to find a `sub`, which reaches the same answer by a longer
  // route with a cast in it.
  assert.notEqual(claimsFor(null), '{}');
});

test('a signed-in person is a JSON object with one key', () => {
  assert.equal(claimsFor('user_abc'), '{"sub":"user_abc"}');
  assert.deepEqual(JSON.parse(claimsFor('user_abc')), { sub: 'user_abc' });
});

test('an id that is trying to be SQL is escaped, not concatenated', () => {
  // This is why the claim is a BIND PARAMETER and the value is built with
  // JSON.stringify. `SET LOCAL` cannot take a parameter, so using it would
  // mean putting this string into SQL text — an injection hole inside the
  // authorization layer, which research/09 §8 calls the worst possible place
  // for one.
  const nasty = `x', true); drop table public.reviews; --`;
  const claim = claimsFor(nasty);
  assert.equal(JSON.parse(claim).sub, nasty, 'it survives as data');
  assert.match(SET_IDENTITY_SQL, /set_config\('request\.jwt\.claims', \$1, true\)/);
  assert.doesNotMatch(SET_IDENTITY_SQL, /\$\{/, 'nothing in the statement is interpolated');
});

test('the settings are transaction-local, both of them', () => {
  // `is_local = true` is the whole safety property: COMMIT or ROLLBACK wipes
  // the value before the connection goes back to the pool. With `false`, the
  // next request to take that connection inherits the previous person's
  // identity — privilege escalation that only shows up under concurrency,
  // which is to say never in testing.
  const locals = [...SET_IDENTITY_SQL.matchAll(/set_config\([^)]*?,\s*(\w+)\)/g)].map((m) => m[1]);
  assert.deepEqual(locals, ['true', 'true'], 'every set_config in the statement is local');
  assert.match(SET_IDENTITY_SQL, /request\.share_token/, 'the share token rides along');
});

test('a share token is a second parameter, and absent means empty', () => {
  assert.deepEqual(identityParams({ userId: null }), ['', '']);
  assert.deepEqual(identityParams({ userId: 'u1' }), ['{"sub":"u1"}', '']);
  assert.deepEqual(identityParams({ userId: null, shareToken: 'abc' }), ['', 'abc']);
});

test('one transaction, one client, claim first and commit last', async () => {
  const client = recorder();
  const seen = [];

  const out = await runWithIdentity(client, { userId: 'user_1' }, async (tx) => {
    assert.equal(tx, client, 'the callback gets the SAME client the claim was set on');
    await tx.query('select 1', []);
    seen.push('ran');
    return 42;
  });

  assert.equal(out, 42);
  assert.deepEqual(seen, ['ran']);
  assert.deepEqual(
    client.calls.map((c) => c.text.trim().split(/\s/)[0]),
    ['begin', 'select', 'select', 'commit'],
    'begin, the claim, the work, commit — in that order',
  );
  assert.deepEqual(client.calls[1].values, ['{"sub":"user_1"}', '']);
});

test('a failure rolls back and re-raises, and never commits', async () => {
  const client = recorder();
  const boom = new Error('the policy refused');

  await assert.rejects(
    runWithIdentity(client, { userId: 'user_1' }, async () => {
      throw boom;
    }),
    /the policy refused/,
  );

  const verbs = client.calls.map((c) => c.text.trim().split(/\s/)[0]);
  assert.ok(verbs.includes('rollback'), 'it rolls back');
  assert.ok(!verbs.includes('commit'), 'and it does not commit');
});

test('a connection that dies during rollback still reports the original failure', async () => {
  // The failure this guards is a swallowed error: if the rollback throws and
  // nothing catches it, the caller is told the connection is broken and never
  // hears what actually went wrong.
  const client = recorder({ rollback: new Error('connection terminated') });

  await assert.rejects(
    runWithIdentity(client, { userId: 'user_1' }, async () => {
      throw new Error('the real problem');
    }),
    /the real problem/,
  );
});
