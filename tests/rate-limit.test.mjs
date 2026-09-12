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
import { readFileSync } from 'node:fs';

import {
  DEFAULT_CODES_PER_ADDRESS_PER_HOUR,
  DEFAULT_CODES_PER_IP_PER_HOUR,
  DEFAULT_EMBEDDING_CALLS_PER_DAY,
  DEFAULT_READER_CALLS_PER_DAY,
  DEFAULT_RERANK_CALLS_PER_DAY,
  DEFAULT_SEARCHES_PER_IP_PER_HOUR,
  DailyCap,
  RefusalCircuit,
  TokenBuckets,
  allowSignInCode,
  limits,
  visitorKey,
} from '../lib/rate-limit.ts';
import {
  READER_MAX_OUTPUT_TOKENS as READER_CEILING_SENT,
  READER_REQUESTS_PER_READING,
} from '../lib/reader-model.ts';
import {
  RERANK_MAX_OUTPUT_TOKENS as RERANK_CEILING_SENT,
  RERANK_REQUESTS_PER_JUDGEMENT,
} from '../lib/rerank.ts';
import {
  costOf,
  EMBEDDING_TOKENS_PER_REQUEST,
  MAX_MONTHLY_SPEND,
  READER_INPUT_TOKENS_PER_REQUEST,
  READER_MAX_OUTPUT_TOKENS,
  READER_OUTPUT_TOKENS_PER_REQUEST,
  RERANK_INPUT_TOKENS_PER_REQUEST,
  RERANK_MAX_OUTPUT_TOKENS,
  RERANK_OUTPUT_TOKENS_PER_REQUEST,
  worstCaseMonthly,
} from '../lib/prices.ts';

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
    MAX_RERANK_CALLS_PER_DAY: process.env.MAX_RERANK_CALLS_PER_DAY,
    MAX_CODES_PER_ADDRESS_PER_HOUR: process.env.MAX_CODES_PER_ADDRESS_PER_HOUR,
    MAX_CODES_PER_IP_PER_HOUR: process.env.MAX_CODES_PER_IP_PER_HOUR,
  };
  try {
    for (const name of Object.keys(saved)) delete process.env[name];
    // Deliberately exhaustive: a limit added without a default and without a
    // line in .env.example fails here rather than being discovered as an
    // undefined ceiling in production.
    assert.deepEqual(limits(), {
      searchesPerIpPerHour: DEFAULT_SEARCHES_PER_IP_PER_HOUR,
      embeddingCallsPerDay: DEFAULT_EMBEDDING_CALLS_PER_DAY,
      readerCallsPerDay: DEFAULT_READER_CALLS_PER_DAY,
      rerankCallsPerDay: DEFAULT_RERANK_CALLS_PER_DAY,
      codesPerAddressPerHour: DEFAULT_CODES_PER_ADDRESS_PER_HOUR,
      codesPerIpPerHour: DEFAULT_CODES_PER_IP_PER_HOUR,
    });
    // Phase 6. research/09 §6: five an hour for one address protects a
    // stranger's inbox and our sending reputation; twenty for one connection
    // is the enumeration bound. Neither is what protects an ACCOUNT — that is
    // the 3-attempt cap on the code itself, in lib/auth.ts.
    assert.equal(DEFAULT_CODES_PER_ADDRESS_PER_HOUR, 5, '.env.example says 5');
    assert.equal(DEFAULT_CODES_PER_IP_PER_HOUR, 20, '.env.example says 20');
    assert.equal(DEFAULT_SEARCHES_PER_IP_PER_HOUR, 60, '.env.example says 60');
    assert.equal(DEFAULT_EMBEDDING_CALLS_PER_DAY, 2000, '.env.example says 2000');
    // PHASE 5 MOVED THIS, and the reason is in lib/rate-limit.ts: the reranker
    // is a third paid call and the dearest per request, the $5 ceiling did not
    // move, so the reader's 1,200 would have put the three together at $9.05 a
    // month. The three caps are now set together from one number — how many
    // first-ever searches a day a stranger may make us pay for — which is 320.
    assert.equal(DEFAULT_READER_CALLS_PER_DAY, 240, '.env.example says 240 — two requests per reading, 120 readings');
    // UNCHANGED BY THE PRECISION WORK, which is a result rather than an
    // oversight: two samples per judgement were measured over three recordings
    // and not shipped (lib/rerank.ts RERANK_SAMPLES). What did change is the two
    // output ceilings the worst case below is billed at — measured rather than
    // guessed, see scripts/output-tokens.mjs — so the same 120 searches a day
    // now cost $3.23 a month instead of $4.68.
    assert.equal(DEFAULT_RERANK_CALLS_PER_DAY, 120, '.env.example says 120 — one request per judgement');
    assert.equal(
      DEFAULT_RERANK_CALLS_PER_DAY / RERANK_REQUESTS_PER_JUDGEMENT,
      DEFAULT_READER_CALLS_PER_DAY / READER_REQUESTS_PER_READING,
      'the three caps are set together, from ONE number: first-ever searches a day',
    );

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

test('the cap arithmetic is computed from the fixture, not from a comment', () => {
  // THE PHASE 5 REVIEW'S FINDING. lib/prices.ts held per-request token counts
  // as constants defended by a sentence quoting a run — and the sentence quoted
  // a run that never shipped, while the constant said 1,850 where the file said
  // 1,965. A cost model nobody recomputes is a cost model that is wrong by an
  // unknown amount in an unknown direction.
  //
  // So the fixture is the authority, and this test recomputes everything from
  // it. Two assertions, and the second is the one that catches drift:
  //
  //   * the WORST case, from the fixture's measured input and the
  //     max_output_tokens ceilings — because a model that reasons to the limit
  //     on every call bills the ceiling, and a daily cap bounds the worst case
  //     rather than the ordinary one;
  //   * and the constants in lib/prices.ts, against the fixture, within a
  //     tenth. A constant that has drifted further than that fails here with
  //     both numbers in the message.
  const fixture = JSON.parse(
    readFileSync(new URL('../db/seed/embeddings.fixture.json', import.meta.url), 'utf8'),
  );
  const { readingTokens: rd, rerankTokens: rr, queryTokens: qt } = fixture;
  assert.ok(rd?.sentences > 0, 'the fixture must carry reader token counts');
  assert.ok(rr?.judgements > 0, 'the fixture must carry reranker token counts');
  assert.ok(qt?.sentences > 0, 'the fixture must carry embedding token counts');

  // PER REQUEST, NOT PER READING OR PER JUDGEMENT, because the caps count
  // requests. The reranker's divisor was 1 until a judgement became two calls,
  // and leaving it at 1 would have made every figure below exactly twice what
  // the bill is — the cap arithmetic would have read $7.52 and a cap would have
  // been cut to fix a division.
  const measured = {
    readerIn: rd.in / (rd.sentences * READER_REQUESTS_PER_READING),
    readerOut: rd.out / (rd.sentences * READER_REQUESTS_PER_READING),
    rerankIn: rr.in / (rr.judgements * RERANK_REQUESTS_PER_JUDGEMENT),
    rerankOut: rr.out / (rr.judgements * RERANK_REQUESTS_PER_JUDGEMENT),
    embeddingIn: qt.in / qt.sentences,
  };

  // The ceilings the requests are actually made with, asserted against the
  // modules that make them so the two cannot drift apart. lib/prices.ts holds
  // its own copy because it must stay a leaf with no imports; this is the one
  // place the two copies meet, and it used to compare the copy with a literal
  // — which proves nothing about what goes out on the wire.
  assert.equal(
    READER_MAX_OUTPUT_TOKENS,
    READER_CEILING_SENT,
    'lib/prices.ts and lib/reader-model.ts disagree about max_output_tokens',
  );
  assert.equal(
    RERANK_MAX_OUTPUT_TOKENS,
    RERANK_CEILING_SENT,
    'lib/prices.ts and lib/rerank.ts disagree about max_output_tokens',
  );
  // And they are three times a measured p99 rather than a number somebody
  // liked: reader p99 117 over 396 requests (scripts/output-tokens.mjs),
  // reranker p99 250 over 707 calls (any --record-reranks run's own report).
  assert.equal(READER_MAX_OUTPUT_TOKENS, 360, '3 x a measured p99 of 117, rounded up');
  assert.equal(RERANK_MAX_OUTPUT_TOKENS, 750, '3 x a measured p99 of 250');

  const worstCase = worstCaseMonthly(limits(), {
    ...measured,
    readerOut: READER_MAX_OUTPUT_TOKENS,
    rerankOut: RERANK_MAX_OUTPUT_TOKENS,
  });
  assert.ok(
    worstCase.total < MAX_MONTHLY_SPEND,
    `at the fixture's measured input and every call reasoning to its output ceiling, ` +
      `spending every cap for a month costs $${worstCase.total.toFixed(2)} — over the ` +
      `$${MAX_MONTHLY_SPEND.toFixed(2)} ceiling. Lower a cap in lib/rate-limit.ts.`,
  );

  for (const [name, constant, from] of [
    ['READER_INPUT_TOKENS_PER_REQUEST', READER_INPUT_TOKENS_PER_REQUEST, measured.readerIn],
    ['READER_OUTPUT_TOKENS_PER_REQUEST', READER_OUTPUT_TOKENS_PER_REQUEST, measured.readerOut],
    ['RERANK_INPUT_TOKENS_PER_REQUEST', RERANK_INPUT_TOKENS_PER_REQUEST, measured.rerankIn],
    ['RERANK_OUTPUT_TOKENS_PER_REQUEST', RERANK_OUTPUT_TOKENS_PER_REQUEST, measured.rerankOut],
    ['EMBEDDING_TOKENS_PER_REQUEST', EMBEDDING_TOKENS_PER_REQUEST, measured.embeddingIn],
  ]) {
    assert.ok(
      Math.abs(constant - from) <= Math.max(from * 0.1, 1),
      `lib/prices.ts says ${name} = ${constant}; db/seed/embeddings.fixture.json ` +
        `measures ${from.toFixed(1)}. Correct the constant.`,
    );
  }
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

test('the circuit needs a full window before it concludes anything', () => {
  const circuit = new RefusalCircuit();
  const realError = console.error;
  console.error = () => {};
  try {
    // Nineteen refusals out of nineteen is 100% and still under the minimum
    // sample count, so it holds its nerve.
    for (let i = 0; i < 19; i += 1) circuit.record(true);
    assert.equal(circuit.trusted, true, 'nineteen samples is not a full window');
    circuit.record(true);
    assert.equal(circuit.trusted, false, 'twenty of twenty is');
    assert.equal(circuit.samples, 20);
  } finally {
    console.error = realError;
  }
});

test('a legitimate run of unanswerable sentences does not trip it', () => {
  // THE PHASE 5 REVIEW'S FINDING, and the reason the threshold moved from half
  // to four fifths. The reviewer ran their own 25 unanswerable sentences
  // through the shipped path — a legitimate thing to do, and exactly what a
  // person evaluating the product does — and tripped the circuit twice: 6
  // refusals in the first 10 samples, 11 in the first 20. The reader was
  // working perfectly. The circuit then stopped honouring correct refusals and
  // started answering "I need a plumber" with software, which is the failure it
  // exists to prevent, caused by the thing that prevents it.
  const circuit = new RefusalCircuit();
  const realError = console.error;
  const said = [];
  console.error = (line) => said.push(String(line));
  try {
    // The review's first ten: six refused, four did not.
    for (let i = 0; i < 6; i += 1) circuit.record(true);
    for (let i = 0; i < 4; i += 1) circuit.record(false);
    assert.equal(circuit.trusted, true, 'six of ten unanswerable sentences is not a broken reader');

    // Their first twenty: eleven refused.
    for (let i = 0; i < 5; i += 1) circuit.record(true);
    for (let i = 0; i < 5; i += 1) circuit.record(false);
    assert.equal(circuit.samples, 20);
    assert.equal(circuit.trusted, true, 'eleven of twenty is a hard set, not a broken reader');

    // A whole file of them — fifteen in twenty, three quarters — is still
    // somebody working through difficult cases rather than a model that has
    // stopped reading.
    const window = [];
    for (let i = 0; i < 20; i += 1) window.push(i < 15);
    for (const refused of window) circuit.record(refused);
    assert.equal(circuit.trusted, true, 'fifteen of twenty is still under the bar');

    assert.deepEqual(said, [], 'and it has said nothing at all');

    // Sixteen is not.
    for (let i = 0; i < 20; i += 1) circuit.record(i < 16);
    assert.equal(circuit.trusted, false, 'sixteen of twenty is a model refusing four fifths');
    assert.equal(said.length, 1);
  } finally {
    console.error = realError;
  }
});

test('the sixth code for one address is refused, and so is the twenty-first from one connection', () => {
  // Phase 6, research/09 §6. Two ceilings that defend two different things:
  //
  //   PER ADDRESS, five an hour, protects a STRANGER'S INBOX. Anybody who
  //   knows somebody's email address can point this flow at it; without this,
  //   they could have Foundit mail them a sign-in code once a second, from a
  //   domain whose sending reputation is then ours to explain.
  //
  //   PER CONNECTION, twenty an hour, is the enumeration bound: one script
  //   working through a list of addresses is one connection here.
  //
  // Neither of them is what protects an ACCOUNT. That is `allowedAttempts: 3`
  // on the code itself (lib/auth.ts): three guesses against a million codes is
  // three in a million, and the same code with no attempt cap is guessable by
  // a script in minutes.
  //
  // These run against the process-wide buckets with the real clock, which is
  // why each case uses addresses of its own: a bucket refills at limit/hour,
  // so nothing here refills within a test.
  const ip = '203.0.113.7';

  for (let i = 1; i <= 5; i += 1) {
    const allowance = allowSignInCode('noa@example.com', ip);
    assert.equal(allowance.allowed, true, `code ${i} of 5 for one address`);
    assert.equal(allowance.refusedBy, null);
  }

  const sixth = allowSignInCode('noa@example.com', ip);
  assert.equal(sixth.allowed, false, 'the sixth code for that address is refused');
  assert.equal(sixth.refusedBy, 'address', 'and it says which ceiling refused');
  assert.ok(sixth.retryAfterSeconds > 0, 'with a wait that is a real number of seconds');

  // Case matters to nobody's mail server and must not mint a fresh bucket.
  const shouty = allowSignInCode('  NOA@EXAMPLE.COM ', ip);
  assert.equal(shouty.allowed, false, 'the same address in capitals is the same address');

  // A different address from the same connection still has its own five — and
  // the connection's twenty is what stops that going on for ever. Fifteen have
  // been spent above (five allowed, plus the two refusals which do not touch
  // the IP bucket); walk the rest of them from fresh addresses.
  let allowed = 0;
  let refusedByIp = false;
  for (let i = 0; i < 40 && !refusedByIp; i += 1) {
    const allowance = allowSignInCode(`person${i}@example.com`, ip);
    if (allowance.allowed) allowed += 1;
    else if (allowance.refusedBy === 'ip') refusedByIp = true;
    else assert.fail('a fresh address was refused by the address ceiling');
  }
  assert.equal(refusedByIp, true, 'one connection cannot ask for codes for ever');
  assert.equal(allowed, 15, 'twenty an hour, five of which went to the first address');

  // And another connection is unaffected, because this is per connection.
  const elsewhere = allowSignInCode('someone@example.com', '198.51.100.22');
  assert.equal(elsewhere.allowed, true, 'a different connection has its own twenty');
});
