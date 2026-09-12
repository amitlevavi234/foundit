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
  IS_DELETING_SQL,
  MARK_DELETION_SQL,
  UNMARK_DELETION_SQL,
  DeletionError,
  accountIsClosing,
  runDeletion,
} from '../lib/deletion.ts';

const ORDER = ['sessions', 'mark', 'publicRows', 'accounts', 'codes', 'user', 'unmark'];

/**
 * Steps that record themselves, fail wherever the test says, and keep a
 * standing set of marked accounts — so what a half-completed run LEAVES can be
 * asked about rather than assumed.
 */
function steps(failAt = null, userId = 'usr_1') {
  const ran = [];
  const marked = new Set();
  const make = (name, rows, effect) => async () => {
    if (name === failAt) throw new Error(`${name} is not answering`);
    ran.push(name);
    effect?.();
    return rows;
  };
  return {
    ran,
    marked,
    sessions: make('sessions', 3),
    mark: make('mark', 1, () => marked.add(userId)),
    publicRows: make('publicRows', 1),
    accounts: make('accounts', 1),
    codes: make('codes', 1),
    user: make('user', 1),
    unmark: make('unmark', 1, () => marked.delete(userId)),
  };
}

/** An `ask` for accountIsClosing, over a set of marked ids. */
const askOver = (marked) => async (sql, values) => {
  assert.equal(sql, IS_DELETING_SQL);
  return marked.has(values[0]) ? 1 : 0;
};

test('the session goes FIRST, and the marker is written before anything is removed', () => {
  // This is the whole of the design. The brief this phase was written from
  // said public first, then auth_core; that leaves a window where the profile
  // is gone and the session still works — a signed-in person with no profile,
  // whose very next request would create them a new one from the same session
  // and quietly undelete the account they had just closed.
  //
  // The marker is the review's F8 and is the mirror of the same thing: a
  // failure after `publicRows` leaves an account that can sign in with its
  // profile already gone. It is written second and removed last, so every
  // failure in between keeps it.
  assert.equal(DELETION_ORDER[0], 'sessions');
  assert.equal(DELETION_ORDER[1], 'mark');
  assert.equal(DELETION_ORDER[DELETION_ORDER.length - 1], 'unmark');
  assert.deepEqual([...DELETION_ORDER], ORDER);
  assert.ok(
    DELETION_ORDER.indexOf('mark') < DELETION_ORDER.indexOf('publicRows'),
    'nothing of theirs is removed before the marker exists',
  );
});

test('a clean run does every step in order, and leaves no marker either', async () => {
  const plan = steps();
  const outcome = await runDeletion(plan);

  assert.deepEqual(plan.ran, ORDER);
  assert.deepEqual(outcome, {
    sessions: 3,
    mark: 1,
    publicRows: 1,
    accounts: 1,
    codes: 1,
    user: 1,
    unmark: 1,
  });

  // "Zero rows for that id, everywhere" has to keep meaning everywhere.
  assert.equal(plan.marked.size, 0);
  assert.equal(await accountIsClosing('usr_1', askOver(plan.marked)), false);
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

test('NO HALF-COMPLETED DELETION LEAVES AN ACCOUNT THAT CAN BE RE-ANIMATED', async () => {
  // The mirror of the test above, and the review's F8. Fail at each step after
  // the marker in turn: whatever is left behind, `ensureProfile` will refuse to
  // make a profile for it, so the person cannot sign in again with the same
  // Google account and be handed a fresh, empty version of the account they
  // closed.
  for (const failAt of DELETION_ORDER) {
    const plan = steps(failAt);
    await assert.rejects(runDeletion(plan));

    const closing = await accountIsClosing('usr_1', askOver(plan.marked));

    if (failAt === 'sessions' || failAt === 'mark') {
      // Nothing of theirs has been removed, so there is nothing to re-animate:
      // they still have the account they had before they pressed the button,
      // and pressing it again is the whole of the repair.
      assert.ok(!plan.ran.includes('publicRows'), `${failAt} left the profile alone`);
      assert.equal(closing, false);
    } else {
      assert.equal(closing, true, `a run that stopped at ${failAt} must stay marked`);
    }
  }
});

test('a failure carries how far it got, so the screen can say something true', async () => {
  const plan = steps('accounts');
  await assert.rejects(runDeletion(plan), (error) => {
    assert.deepEqual(error.done, { sessions: 3, mark: 1, publicRows: 1 });
    assert.match(error.message, /account deletion stopped at "accounts"/);
    return true;
  });
});

test('and a marker that cannot be read is treated as one that is there', async () => {
  // Fail closed. A database that will not answer is not a reason to create a
  // profile for an account somebody asked us to close.
  const errors = [];
  const real = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const closing = await accountIsClosing('usr_1', async () => {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    });
    assert.equal(closing, true);
  } finally {
    console.error = real;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ECONNREFUSED/);
  assert.ok(!errors[0].includes('usr_1'), 'the reason, and never the account');
});

test('the statements name their table and nothing wider', () => {
  // Unqualified on purpose: the pool's search_path is auth_core and the role
  // can reach nothing else, so an unqualified name here cannot resolve to a
  // table in `public` even if one had the same name.
  assert.equal(DELETE_SESSIONS_SQL, 'delete from "session" where "userId" = $1');
  assert.equal(DELETE_ACCOUNTS_SQL, 'delete from "account" where "userId" = $1');
  assert.equal(DELETE_USER_SQL, 'delete from "user" where "id" = $1');

  // Ours, and lower case, because auth_core.deletions is not Better Auth's.
  assert.equal(
    MARK_DELETION_SQL,
    'insert into deletions (user_id) values ($1) on conflict do nothing',
  );
  assert.equal(UNMARK_DELETION_SQL, 'delete from deletions where user_id = $1');
  assert.equal(IS_DELETING_SQL, 'select 1 from deletions where user_id = $1');

  for (const sql of [
    DELETE_SESSIONS_SQL,
    DELETE_ACCOUNTS_SQL,
    DELETE_USER_SQL,
    DELETE_CODES_SQL,
    MARK_DELETION_SQL,
    UNMARK_DELETION_SQL,
    IS_DELETING_SQL,
  ]) {
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
