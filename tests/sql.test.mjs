// ===========================================================================
// The data layer's two promises, tested without a database.
//
// Both are the kind of thing that breaks silently. A second query added to
// hydrate a row still returns the right answer, just slower and N+1; a log
// call that quietly gained a user argument still works. Neither shows up in a
// screenshot, so they are tested here.
//
// Run by `npm test` via `node --test tests/`. Node strips the types from the
// TypeScript modules it imports; there is no build step and no test framework.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runSearch,
  runLogSearchEvent,
  searchParams,
  logSearchEventParams,
  QueryTooLongError,
  MAX_QUERY_LENGTH,
  SQLSTATE_QUERY_TOO_LONG,
  SEARCH_SQL,
  LOG_SEARCH_EVENT_SQL,
} from '../lib/sql.ts';

/** A stand-in for `pg.Pool` that records every statement it is handed. */
function fakeExecutor(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows };
    },
  };
}

const ROW = {
  tool_id: '14',
  slug: 'splid',
  name: 'Splid',
  summary: 'Split group expenses without an account.',
  pricing: 'free',
  score: 0.036,
  match_source: 'both',
};

test('a search is exactly one round trip', async () => {
  const exec = fakeExecutor([ROW]);
  await runSearch(exec, 'split expenses with friends while travelling');
  assert.equal(exec.calls.length, 1, 'search must issue exactly one query');
  assert.equal(exec.calls[0].text, SEARCH_SQL);
});

test('constraints do not add queries — they are arguments to the one call', async () => {
  const exec = fakeExecutor([ROW]);
  await runSearch(
    exec,
    'expense splitter',
    {
      pricing: ['free'],
      platforms: ['ios', 'android'],
      flags: ['works_offline'],
      languages: ['es'],
    },
    10,
  );
  assert.equal(exec.calls.length, 1);
  assert.deepEqual(exec.calls[0].values, [
    'expense splitter',
    ['free'],
    ['ios', 'android'],
    ['works_offline'],
    ['es'],
    10,
  ]);
});

test('an empty constraint array means "nothing was asked for", not "nothing is acceptable"', () => {
  assert.deepEqual(searchParams('x', { pricing: [], platforms: [] }, 5), [
    'x',
    null,
    null,
    null,
    null,
    5,
  ]);
});

test('rows are mapped, not re-sorted or re-filtered', async () => {
  const second = { ...ROW, slug: 'settle-up', name: 'Settle Up', score: 0.019 };
  const exec = fakeExecutor([ROW, second]);
  const results = await runSearch(exec, 'split expenses');
  assert.deepEqual(
    results.map((r) => r.slug),
    ['splid', 'settle-up'],
    'the order the database returned must survive untouched',
  );
  assert.equal(results[0].toolId, '14');
  assert.equal(typeof results[0].score, 'number');
});

test('a query over the cap is refused before the round trip, and the text never appears', async () => {
  const exec = fakeExecutor();
  const long = 'a'.repeat(MAX_QUERY_LENGTH + 1);
  await assert.rejects(
    () => runSearch(exec, long),
    (err) => {
      assert.ok(err instanceof QueryTooLongError);
      assert.equal(err.status, 400);
      assert.equal(err.length, MAX_QUERY_LENGTH + 1);
      assert.ok(!err.message.includes(long), 'the error must not echo the query');
      assert.ok(!err.message.includes('aaaa'), 'not even a fragment of it');
      return true;
    },
  );
  assert.equal(exec.calls.length, 0, 'nothing should have been sent');
});

test('SQLSTATE 22001 from the database becomes the same clean 400', async () => {
  const exec = {
    calls: [],
    async query() {
      const err = new Error('search query is 4213 characters; the maximum is 200');
      err.code = SQLSTATE_QUERY_TOO_LONG;
      throw err;
    },
  };
  await assert.rejects(() => runSearch(exec, 'a normal looking query'), QueryTooLongError);
});

test('other database errors are not swallowed', async () => {
  const exec = {
    async query() {
      const err = new Error('connection terminated unexpectedly');
      err.code = '08006';
      throw err;
    },
  };
  await assert.rejects(() => runSearch(exec, 'anything'), /connection terminated/);
});

test('logging a search is one statement and carries nothing identifying', async () => {
  const exec = fakeExecutor();
  await runLogSearchEvent(exec, {
    query: 'split expenses',
    resultCount: 3,
    topScore: 0.036,
    hadGoodMatch: true,
    latencyMs: 12,
  });
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].text, LOG_SEARCH_EVENT_SQL);
  assert.equal(exec.calls[0].values.length, 5, 'five arguments, and there is no sixth to add');
  assert.deepEqual(exec.calls[0].values, ['split expenses', 3, 0.036, true, 12]);
});

test('log_search_event has no parameter that could carry a person', () => {
  // The SQL text is checked directly: a future edit that adds a user id would
  // have to add it here, and this assertion is where it gets stopped.
  for (const forbidden of ['user', 'session', 'ip', 'profile', 'device', 'visitor']) {
    assert.ok(
      !LOG_SEARCH_EVENT_SQL.toLowerCase().includes(`p_${forbidden}`),
      `log_search_event must not take a p_${forbidden} argument`,
    );
  }
});

test('an unmeasured latency stays unknown rather than becoming zero', () => {
  assert.deepEqual(logSearchEventParams({ query: 'q', resultCount: 0 }), ['q', 0, null, false, null]);
});
