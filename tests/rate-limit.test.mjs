// ===========================================================================
// The rate limiter, driven by a fake clock.
//
// A limiter is the one piece of a system whose bugs are invisible until the
// bill arrives or a real person is locked out, and both of those are discovered
// in production by default. The clock is an argument precisely so that an hour,
// a day and a week can happen in a millisecond here instead.
//
// What is NOT tested here, because it cannot be: the hash. `visitorKey` salts
// with 32 random bytes generated when the module loads, so the same address
// hashes differently in two processes — which is the property that makes the
// key meaningless to anybody who does not have the salt, and nobody does. What
// is tested is that it is stable WITHIN a process (two searches from one
// visitor share a bucket) and different ACROSS addresses (two visitors do not).
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EMBEDDING_CALLS_PER_DAY,
  DEFAULT_READER_CALLS_PER_DAY,
  DEFAULT_SEARCHES_PER_IP_PER_HOUR,
  DailyCap,
  RefusalCircuit,
  TokenBuckets,
  limits,
  visitorKey,
} from '../lib/rate-limit.ts';
import { READER_REQUESTS_PER_READING } from '../lib/reader-model.ts';
import { costOf, MAX_MONTHLY_SPEND, worstCaseMonthly } from '../lib/prices.ts';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** A clock somebody else winds. */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

test('a fresh visitor gets the whole allowance and then is refused', () => {
  const clock = fakeClock();
  const buckets = new TokenBuckets(clock);

  for (let i = 0; i < 60; i += 1) {
    const out = buckets.take('someone', 60);
    assert.equal(out.allowed, true, `search ${i + 1} of 60 must be allowed`);
  }

  const over = buckets.take('someone', 60);
  assert.equal(over.allowed, false, 'the sixty-first in the same instant is not');
  assert.ok(over.retryAfterSeconds > 0, 'and it says when to come back');
  assert.ok(over.retryAfterSeconds <= 60, 'one token at sixty an hour is a minute away');
});

test('the bucket refills continuously, so waiting works', () => {
  const clock = fakeClock();
  const buckets = new TokenBuckets(clock);

  for (let i = 0; i < 60; i += 1) buckets.take('someone', 60);
  assert.equal(buckets.take('someone', 60).allowed, false);

  // Half a minute is half a token at sixty an hour: still not enough.
  clock.advance(30 * 1000);
  assert.equal(buckets.take('someone', 60).allowed, false, 'half a token is not a token');

  // A full minute from the refusal is one token.
  clock.advance(30 * 1000);
  assert.equal(buckets.take('someone', 60).allowed, true, 'a minute buys one search');
  assert.equal(buckets.take('someone', 60).allowed, false, 'and only one');
});

test('an idle hour restores the whole allowance, and no more than it', () => {
  const clock = fakeClock();
  const buckets = new TokenBuckets(clock);

  for (let i = 0; i < 60; i += 1) buckets.take('someone', 60);
  // A week away. The bucket must not have a week's worth of tokens in it.
  clock.advance(7 * 24 * HOUR);

  for (let i = 0; i < 60; i += 1) {
    assert.equal(buckets.take('someone', 60).allowed, true, `search ${i + 1} after a week`);
  }
  assert.equal(
    buckets.take('someone', 60).allowed,
    false,
    'a week idle is worth one hour of allowance, not a week of it',
  );
});

test('a fixed window would let somebody spend twice the limit; this does not', () => {
  // The failure a token bucket exists to avoid: sixty in the last second of one
  // window and sixty in the first second of the next, with no bug anywhere.
  const clock = fakeClock();
  const buckets = new TokenBuckets(clock);

  for (let i = 0; i < 60; i += 1) buckets.take('someone', 60);
  clock.advance(MINUTE); // one token back

  let allowed = 0;
  for (let i = 0; i < 60; i += 1) {
    if (buckets.take('someone', 60).allowed) allowed += 1;
  }
  assert.equal(allowed, 1, 'a minute later, exactly one more search is available');
});

test('two visitors do not share a bucket, and one visitor does not get two', () => {
  const clock = fakeClock();
  const buckets = new TokenBuckets(clock);

  for (let i = 0; i < 60; i += 1) buckets.take(visitorKey('198.51.100.7'), 60);
  assert.equal(buckets.take(visitorKey('198.51.100.7'), 60).allowed, false);
  assert.equal(
    buckets.take(visitorKey('198.51.100.8'), 60).allowed,
    true,
    'somebody else has their own allowance',
  );

  // The key is stable within the process — two searches from the same address
  // must land in the same bucket, or the limit is no limit at all.
  assert.equal(visitorKey('198.51.100.7'), visitorKey('198.51.100.7'));
  assert.notEqual(visitorKey('198.51.100.7'), visitorKey('198.51.100.8'));
  // And it is a hash, not the address: nothing about who this is survives.
  assert.match(visitorKey('198.51.100.7'), /^[0-9a-f]{64}$/);
  assert.ok(!visitorKey('198.51.100.7').includes('198'), 'the address is not in the key');
});

test('the bucket map is swept rather than grown without bound', () => {
  const clock = fakeClock();
  // A small ceiling so the sweep is reachable in a test rather than after
  // fifty thousand fabricated addresses.
  const buckets = new TokenBuckets(clock, 10);

  for (let i = 0; i < 10; i += 1) buckets.take(`visitor-${i}`, 60);
  assert.equal(buckets.size, 10);

  // Every one of them has refilled, so every one carries no information.
  clock.advance(2 * HOUR);
  buckets.take('someone-new', 60);
  assert.ok(buckets.size < 10, 'full buckets are forgotten when the map is at its ceiling');
});

test('a daily cap counts, refuses, and resets after a day', () => {
  const clock = fakeClock();
  const cap = new DailyCap(clock);

  for (let i = 0; i < 5; i += 1) assert.equal(cap.take(5), true, `call ${i + 1} of 5`);
  assert.equal(cap.take(5), false, 'the sixth is refused');
  assert.equal(cap.count, 5, 'and a refused call is not counted');

  clock.advance(23 * HOUR);
  assert.equal(cap.take(5), false, 'still the same day');

  clock.advance(2 * HOUR);
  assert.equal(cap.take(5), true, 'a new day, a new budget');
  assert.equal(cap.count, 1);
});

test('the limits come from the environment, with the documented defaults', () => {
  const saved = {
    MAX_SEARCHES_PER_IP_PER_HOUR: process.env.MAX_SEARCHES_PER_IP_PER_HOUR,
    MAX_EMBEDDING_CALLS_PER_DAY: process.env.MAX_EMBEDDING_CALLS_PER_DAY,
    MAX_READER_CALLS_PER_DAY: process.env.MAX_READER_CALLS_PER_DAY,
  };
  try {
    for (const name of Object.keys(saved)) delete process.env[name];
    assert.deepEqual(limits(), {
      searchesPerIpPerHour: DEFAULT_SEARCHES_PER_IP_PER_HOUR,
      embeddingCallsPerDay: DEFAULT_EMBEDDING_CALLS_PER_DAY,
      readerCallsPerDay: DEFAULT_READER_CALLS_PER_DAY,
    });
    assert.equal(DEFAULT_SEARCHES_PER_IP_PER_HOUR, 60, '.env.example says 60');
    assert.equal(DEFAULT_EMBEDDING_CALLS_PER_DAY, 2000, '.env.example says 2000');
    assert.equal(DEFAULT_READER_CALLS_PER_DAY, 1200, '.env.example says 1200 — two requests per reading, costed to $4.19 a month');

    process.env.MAX_SEARCHES_PER_IP_PER_HOUR = '5';
    assert.equal(limits().searchesPerIpPerHour, 5, 'the environment wins');

    // Nonsense falls back rather than disabling the limit. "0" and "-1" are the
    // two that would otherwise switch it off or make every search refused.
    for (const bad of ['0', '-1', 'lots', '']) {
      process.env.MAX_SEARCHES_PER_IP_PER_HOUR = bad;
      assert.equal(
        limits().searchesPerIpPerHour,
        DEFAULT_SEARCHES_PER_IP_PER_HOUR,
        `"${bad}" must not switch the limit off`,
      );
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the cap counts HTTP REQUESTS, so the number means the bill', () => {
  // The defect this pins: one reading is TWO requests — two samples and a vote
  // — and the cap took one token for the pair, so a cap of 2,000 permitted
  // 4,000 requests and twice the money it was set to bound.
  const clock = fakeClock();
  const cap = new DailyCap(clock);

  assert.equal(READER_REQUESTS_PER_READING, 2, 'a reading is two requests');

  // A cap of 10 must permit five readings, not ten.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(cap.take(10, READER_REQUESTS_PER_READING), true, `reading ${i + 1} of 5`);
  }
  assert.equal(cap.take(10, READER_REQUESTS_PER_READING), false, 'the sixth reading is refused');
  assert.equal(cap.count, 10, 'and the counter equals the requests actually permitted');

  // All or nothing: a pair that does not fit is not half made.
  const odd = new DailyCap(fakeClock());
  assert.equal(odd.take(3, 2), true);
  assert.equal(odd.take(3, 2), false, 'one token left is not enough for a pair');
  assert.equal(odd.count, 2, 'and the refused pair counted nothing');
  assert.equal(odd.take(3, 1), true, 'a single request still fits');
});

test('the worst case at the default caps is under the monthly ceiling', () => {
  // A cap nobody has costed is a number somebody picked. This is the arithmetic
  // that says the defaults in .env.example are the right size, from the same
  // prices lib/prices.ts uses for the per-search figure.
  const worst = worstCaseMonthly(limits());
  assert.ok(
    worst.total < MAX_MONTHLY_SPEND,
    `spending every day's cap for a month costs $${worst.total.toFixed(2)}, ` +
      `over the $${MAX_MONTHLY_SPEND.toFixed(2)} ceiling`,
  );
  // And it is not absurdly under it either: a ceiling ten thousand times the
  // worst case is not a ceiling, it is a decoration.
  assert.ok(worst.total > MAX_MONTHLY_SPEND / 100, 'the caps should be meaningful, not theatre');
  assert.ok(costOf({ readerIn: 1, readerOut: 1, embeddingIn: 1, searches: 1 }).total > 0);
});

test('a reader that refuses everything stops being believed', () => {
  // Two samples of a broken model are two samples of a broken model. A review
  // pointed a stub that refused every sentence at the page and three of four
  // real questions came back with "Foundit only lists software".
  const circuit = new RefusalCircuit();
  const said = [];
  const realError = console.error;
  console.error = (line) => said.push(String(line));

  try {
    // A handful of genuine refusals must NOT trip it: a quiet morning with
    // three plumbers in it is an ordinary morning.
    for (let i = 0; i < 3; i += 1) circuit.record(true);
    assert.equal(circuit.trusted, true, 'three refusals in a row is not a broken reader');

    // Ordinary traffic, mostly software, keeps it closed.
    for (let i = 0; i < 17; i += 1) circuit.record(false);
    assert.equal(circuit.trusted, true, 'three in twenty is a normal rate');

    // Now the broken model: everything refuses.
    for (let i = 0; i < 20; i += 1) circuit.record(true);
    assert.equal(circuit.trusted, false, 'a reader refusing everything is not believed');
    assert.equal(said.length, 1, 'and it says so once, not once per search');
    assert.match(said[0], /refused \d+ of the last \d+ readings/);
    assert.ok(!said[0].includes('plumber'), 'the line carries counts, not sentences');

    // And it closes again when the rate comes back down.
    for (let i = 0; i < 20; i += 1) circuit.record(false);
    assert.equal(circuit.trusted, true, 'it recovers rather than latching for ever');
    assert.equal(said.length, 2);
    assert.match(said[1], /normal rate again/);
  } finally {
    console.error = realError;
  }
});

test('the circuit needs enough evidence before it trips', () => {
  const circuit = new RefusalCircuit();
  const realError = console.error;
  console.error = () => {};
  try {
    // Nine refusals out of nine is 100% and still under the minimum sample
    // count, so it holds its nerve.
    for (let i = 0; i < 9; i += 1) circuit.record(true);
    assert.equal(circuit.trusted, true, 'nine samples is not enough to conclude anything');
    circuit.record(true);
    assert.equal(circuit.trusted, false, 'ten is');
    assert.equal(circuit.samples, 10);
  } finally {
    console.error = realError;
  }
});
