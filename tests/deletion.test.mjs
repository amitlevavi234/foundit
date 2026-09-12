// ===========================================================================
// Closing an account across a boundary that cannot be one transaction.
//
// A person's rows live in two schemas, reached by two roles, through two
// pools. PostgreSQL has no way to make those one transaction — two sessions as
// two roles cannot share one — so "all or nothing" is not on offer, and
// pretending otherwise would be the actual danger.
//
// What IS on offer is an order, and the order is chosen by what a
// half-completed deletion leaves behind. This file fails each step in turn and
// checks the answer to one question every time: is a usable session part of
// what is left?
//
// The database's half — that deleting the profile really does take the
// reviews, likes, collections, saved items and claims with it, and really does
// leave the listings behind — is db/test/accounts_test.sql §7, against a real
// PostgreSQL.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DELETE_ACCOUNTS_SQL,
  DELETE_CODES_SQL,
  DELETE_SESSIONS_SQL,
  DELETE_USER_SQL,
  DELETION_ORDER,
  DeletionError,
  runDeletion,
} from '../lib/deletion.ts';

/** Steps that record themselves, and fail wherever the test says. */
function steps(failAt = null) {
  const ran = [];
  const make = (name, rows) => async () => {
    if (name === failAt) throw new Error(`${name} is not answering`);
    ran.push(name);
    return rows;
  };
  return {
    ran,
    sessions: make('sessions', 3),
    publicRows: make('publicRows', 1),
    accounts: make('accounts', 1),
    codes: make('codes', 1),
    user: make('user', 1),
  };
}

test('the session goes FIRST, before anything else is touched', () => {
  // This is the whole of the design. The brief this phase was written from
  // said public first, then auth_core; that leaves a window where the profile
  // is gone and the session still works — a signed-in person with no profile,
  // whose very next request would create them a new one from the same session
  // and quietly undelete the account they had just closed.
  assert.equal(DELETION_ORDER[0], 'sessions');
  assert.deepEqual([...DELETION_ORDER], ['sessions', 'publicRows', 'accounts', 'codes', 'user']);
});

test('a clean run does every step in order and reports what each one removed', async () => {
  const plan = steps();
  const outcome = await runDeletion(plan);

  assert.deepEqual(plan.ran, ['sessions', 'publicRows', 'accounts', 'codes', 'user']);
  assert.deepEqual(outcome, { sessions: 3, publicRows: 1, accounts: 1, codes: 1, user: 1 });
});

test('NO HALF-COMPLETED DELETION LEAVES A USABLE SESSION', async () => {
  // Fail at each step in turn. Whatever is left behind, the session rows are
  // not part of it — except in the one case where the session delete itself
  // failed, and then nothing has been deleted at all and the person still has
  // the account they had before they pressed the button.
  for (const failAt of DELETION_ORDER) {
    const plan = steps(failAt);

    await assert.rejects(runDeletion(plan), (error) => {
      assert.ok(error instanceof DeletionError, `failing at ${failAt} must raise DeletionError`);
      assert.equal(error.step, failAt, 'and say which step');
      return true;
    });

    if (failAt === 'sessions') {
      assert.deepEqual(plan.ran, [], 'nothing at all happened, which is a whole account intact');
    } else {
      assert.equal(plan.ran[0], 'sessions', `failing at ${failAt} still killed the session first`);
    }

    // And it stops rather than carrying on into a database that just refused.
    assert.ok(!plan.ran.includes(failAt), `${failAt} did not half-happen`);
    const after = DELETION_ORDER.slice(DELETION_ORDER.indexOf(failAt) + 1);
    for (const later of after) {
      assert.ok(!plan.ran.includes(later), `${later} must not run after ${failAt} failed`);
    }
  }
});

test('a failure carries how far it got, so the screen can say something true', async () => {
  const plan = steps('accounts');
  await assert.rejects(runDeletion(plan), (error) => {
    assert.deepEqual(error.done, { sessions: 3, publicRows: 1 });
    assert.match(error.message, /account deletion stopped at "accounts"/);
    return true;
  });
});

test('the statements name their table and nothing wider', () => {
  // Unqualified on purpose: the pool's search_path is auth_core and the role
  // can reach nothing else, so an unqualified name here cannot resolve to a
  // table in `public` even if one had the same name.
  assert.equal(DELETE_SESSIONS_SQL, 'delete from "session" where "userId" = $1');
  assert.equal(DELETE_ACCOUNTS_SQL, 'delete from "account" where "userId" = $1');
  assert.equal(DELETE_USER_SQL, 'delete from "user" where "id" = $1');

  for (const sql of [DELETE_SESSIONS_SQL, DELETE_ACCOUNTS_SQL, DELETE_USER_SQL, DELETE_CODES_SQL]) {
    assert.match(sql, /\$1/, 'every one takes the id as a bind parameter');
    assert.doesNotMatch(sql, /\$\{/, 'and none of them is built by interpolation');
  }
});

test('pending codes are matched exactly, because an email address may contain a wildcard', () => {
  // `_` and `%` are LIKE's own wildcards and both are legal in an email
  // address, so a pattern would quietly match other people's rows. The three
  // identifiers Better Auth's email-OTP plugin builds are written out instead.
  assert.doesNotMatch(DELETE_CODES_SQL, /\blike\b/i);
  for (const type of ['sign-in-otp-', 'email-verification-otp-', 'forget-password-otp-']) {
    assert.ok(DELETE_CODES_SQL.includes(`'${type}' || $1`), `${type} must be matched exactly`);
  }
});
