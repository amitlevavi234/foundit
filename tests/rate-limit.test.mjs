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
  DEFAULT_EDITS_PER_ACCOUNT_PER_HOUR,
  DEFAULT_EMBEDDING_CALLS_PER_DAY,
  DEFAULT_EMBEDDING_TOKENS_PER_DAY,
  DEFAULT_OPENS_PER_DAY,
  DEFAULT_OPENS_PER_VISITOR_PER_HOUR,
  DEFAULT_READER_CALLS_PER_DAY,
  DEFAULT_RERANK_CALLS_PER_DAY,
  DEFAULT_SEARCHES_PER_IP_PER_HOUR,
  DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY,
  DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR,
  DailyCap,
  RefusalCircuit,
  TokenBuckets,
  allowEdit,
  allowOutboundOpen,
  allowPublish,
  allowSignInCode,
  limits,
  mayEmbedTokens,
  outboundOpensToday,
  paidCallsToday,
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
  EMBEDDING_DOCUMENT_TOKENS,
  EMBEDDING_STATEMENT_TOKENS,
  EMBEDDING_TOKENS_PER_REQUEST,
  EMBEDDINGS_WORKER_BATCH,
  MAX_MONTHLY_SPEND,
  READER_INPUT_TOKENS_PER_REQUEST,
  READER_MAX_OUTPUT_TOKENS,
  READER_OUTPUT_TOKENS_PER_REQUEST,
  RERANK_INPUT_TOKENS_PER_REQUEST,
  RERANK_MAX_OUTPUT_TOKENS,
  RERANK_OUTPUT_TOKENS_PER_REQUEST,
  WORKER_TOKENS_PER_REQUEST,
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
    MAX_EMBEDDING_TOKENS_PER_DAY: process.env.MAX_EMBEDDING_TOKENS_PER_DAY,
    MAX_READER_CALLS_PER_DAY: process.env.MAX_READER_CALLS_PER_DAY,
    MAX_RERANK_CALLS_PER_DAY: process.env.MAX_RERANK_CALLS_PER_DAY,
    MAX_CODES_PER_ADDRESS_PER_HOUR: process.env.MAX_CODES_PER_ADDRESS_PER_HOUR,
    MAX_CODES_PER_IP_PER_HOUR: process.env.MAX_CODES_PER_IP_PER_HOUR,
    MAX_TOOLS_PER_ACCOUNT_PER_DAY: process.env.MAX_TOOLS_PER_ACCOUNT_PER_DAY,
    MAX_TOOLS_PER_ADDRESS_PER_HOUR: process.env.MAX_TOOLS_PER_ADDRESS_PER_HOUR,
    MAX_EDITS_PER_ACCOUNT_PER_HOUR: process.env.MAX_EDITS_PER_ACCOUNT_PER_HOUR,
    MAX_OPENS_PER_VISITOR_PER_HOUR: process.env.MAX_OPENS_PER_VISITOR_PER_HOUR,
    MAX_OPENS_PER_DAY: process.env.MAX_OPENS_PER_DAY,
  };
  try {
    for (const name of Object.keys(saved)) delete process.env[name];
    // Deliberately exhaustive: a limit added without a default and without a
    // line in .env.example fails here rather than being discovered as an
    // undefined ceiling in production.
    assert.deepEqual(limits(), {
      searchesPerIpPerHour: DEFAULT_SEARCHES_PER_IP_PER_HOUR,
      embeddingCallsPerDay: DEFAULT_EMBEDDING_CALLS_PER_DAY,
      embeddingTokensPerDay: DEFAULT_EMBEDDING_TOKENS_PER_DAY,
      readerCallsPerDay: DEFAULT_READER_CALLS_PER_DAY,
      rerankCallsPerDay: DEFAULT_RERANK_CALLS_PER_DAY,
      codesPerAddressPerHour: DEFAULT_CODES_PER_ADDRESS_PER_HOUR,
      codesPerIpPerHour: DEFAULT_CODES_PER_IP_PER_HOUR,
      toolsPerAccountPerDay: DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY,
      toolsPerAddressPerHour: DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR,
      editsPerAccountPerHour: DEFAULT_EDITS_PER_ACCOUNT_PER_HOUR,
      opensPerVisitorPerHour: DEFAULT_OPENS_PER_VISITOR_PER_HOUR,
      opensPerDay: DEFAULT_OPENS_PER_DAY,
    });
    // Phase 7's review. The embedder has two ceilings now, and the second is
    // the one that is about the money: MAX_EMBEDDING_CALLS_PER_DAY counts
    // requests, and a request from scripts/embed-worker.mjs carries up to
    // EMBEDDINGS_WORKER_BATCH documents.
    assert.equal(DEFAULT_EMBEDDING_TOKENS_PER_DAY, 1_500_000, '.env.example says 1,500,000');
    assert.equal(DEFAULT_EDITS_PER_ACCOUNT_PER_HOUR, 30, '.env.example says 30');
    // Phase 7. docs/product-decisions.md §19: neither of these is about money.
    // They bound what a script can do to the CATALOGUE, which is a different
    // kind of damage and is not undone by a refund.
    //
    // THIS COMMENT USED TO SAY "so neither appears in the worst-case
    // arithmetic below", and the Phase 7 review quoted it back as the reason
    // the cost test passed while the worker spent the embedding cap at 213
    // times the modelled rate. What was missing was not these two limits — it
    // was the WORKER, which is now its own line of `worstCaseMonthly` and is
    // bounded by MAX_EMBEDDING_TOKENS_PER_DAY. A test whose comment explains
    // why it does not check something is a test to be suspicious of.
    assert.equal(DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY, 3, '.env.example says 3');
    assert.equal(DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR, 10, '.env.example says 10');
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

  // FOUR LINES, AND THE FOURTH IS THE WORKER. That is the Phase 7 review's F4:
  // the arithmetic modelled one embedding caller at fifteen tokens a request
  // and Phase 7 added a second that sends up to 3,200.
  assert.ok(worst.worker > 0, 'the worker has to be IN the arithmetic, not beside it');
  assert.equal(
    Number((worst.reader + worst.embedding + worst.worker + worst.rerank).toFixed(10)),
    Number(worst.total.toFixed(10)),
    'the total is the sum of the four lines',
  );
});

test('the worker is priced at what one of ITS requests costs', () => {
  // THE DEFECT, PINNED. `mayCallEmbeddings(1)` once per tick charged one token
  // of a 2,000-request-a-day allowance for a request carrying up to 32
  // documents, and the cost model priced that request at EMBEDDING_TOKENS_PER-
  // REQUEST — fifteen, measured, and correct for a search sentence. The review
  // costed one worker at $3.84 a month and two at $9.25, against $5.
  assert.equal(EMBEDDING_DOCUMENT_TOKENS, 100, 'a 400-character summary, at four chars a token');
  assert.equal(EMBEDDING_STATEMENT_TOKENS, 50, 'a 200-character statement, the same way');
  assert.equal(WORKER_TOKENS_PER_REQUEST, EMBEDDINGS_WORKER_BATCH * EMBEDDING_DOCUMENT_TOKENS);
  assert.ok(
    WORKER_TOKENS_PER_REQUEST > EMBEDDING_TOKENS_PER_REQUEST * 100,
    'the whole point: one worker request is two orders of magnitude more than one sentence',
  );

  // lib/prices.ts keeps its own copy of the batch size, because it is a leaf
  // with no imports. This is the one place the two copies meet — the same
  // arrangement the two max_output_tokens ceilings use.
  const worker = readFileSync(
    new URL('../scripts/embed-worker.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    worker,
    /const BATCH = Math\.min\(EMBEDDINGS_WORKER_BATCH, EMBEDDINGS_BATCH_SIZE\);/,
    'the worker takes its batch size from lib/prices.ts, so the cost model can see it',
  );

  // THE OLD MODEL WOULD NOW FAIL, which is the assertion that says the fix is
  // load-bearing rather than decorative: the worker priced against the REQUEST
  // cap at its real per-request ceiling — which is what one worker with no
  // token cap can spend — is over the ceiling on its own.
  const unbounded = worstCaseMonthly({
    embeddingCallsPerDay: limits().embeddingCallsPerDay,
    readerCallsPerDay: limits().readerCallsPerDay,
    rerankCallsPerDay: limits().rerankCallsPerDay,
  });
  assert.ok(
    unbounded.total > MAX_MONTHLY_SPEND,
    'with no token ceiling, one worker spending the request cap at its own per-request ' +
      `ceiling costs $${unbounded.total.toFixed(2)} — that is what MAX_EMBEDDING_TOKENS_PER_DAY ` +
      'exists to bound, and if this is under $5 the bound is no longer doing anything',
  );
});

test('an embedding request is charged by its SIZE, and both ceilings hold', () => {
  const saved = {
    tokens: process.env.MAX_EMBEDDING_TOKENS_PER_DAY,
    calls: process.env.MAX_EMBEDDING_CALLS_PER_DAY,
  };
  // The module-level counters are on globalThis and shared with whatever else
  // ran first, so this asserts about the DELTA rather than about the total.
  const before = paidCallsToday();
  try {
    process.env.MAX_EMBEDDING_TOKENS_PER_DAY = String(before.embeddingTokens + 1000);
    process.env.MAX_EMBEDDING_CALLS_PER_DAY = String(before.embeddings + 100);

    assert.equal(mayEmbedTokens(600), true, 'six hundred tokens fit in a thousand');
    assert.equal(paidCallsToday().embeddingTokens, before.embeddingTokens + 600);
    assert.equal(paidCallsToday().embeddings, before.embeddings + 1, 'and it is one request');

    // 600 spent of 1,000: a batch of 500 does not fit, and being refused costs
    // nothing — neither a token nor a request.
    assert.equal(mayEmbedTokens(500), false, 'a batch that does not fit is not half sent');
    assert.equal(paidCallsToday().embeddingTokens, before.embeddingTokens + 600);
    assert.equal(
      paidCallsToday().embeddings,
      before.embeddings + 1,
      'a refused request must not spend the REQUEST allowance either',
    );

    assert.equal(mayEmbedTokens(400), true, 'exactly the room left still fits');
    assert.equal(mayEmbedTokens(1), false, 'and then nothing does');
  } finally {
    if (saved.tokens === undefined) delete process.env.MAX_EMBEDDING_TOKENS_PER_DAY;
    else process.env.MAX_EMBEDDING_TOKENS_PER_DAY = saved.tokens;
    if (saved.calls === undefined) delete process.env.MAX_EMBEDDING_CALLS_PER_DAY;
    else process.env.MAX_EMBEDDING_CALLS_PER_DAY = saved.calls;
  }
});

test('a daily cap can be asked whether something fits without counting it', () => {
  const clock = fakeClock();
  const cap = new DailyCap(clock);
  assert.equal(cap.fits(10, 4), true);
  assert.equal(cap.count, 0, 'a peek counts nothing');
  assert.equal(cap.take(10, 8), true);
  assert.equal(cap.fits(10, 4), false, 'four does not fit in the two that are left');
  assert.equal(cap.fits(10, 2), true);

  // And it rolls the day, so the first question of a new day is not answered
  // from yesterday's total.
  clock.advance(25 * HOUR);
  assert.equal(cap.fits(10, 10), true, 'a new day, a new budget');
  assert.equal(cap.count, 0, 'and asking rolled it rather than pretending');
});

test('an account may not save a listing without limit', () => {
  // F4: `allowPublish` was called in publishDraft and nowhere else, so
  // `saveListing` and `setProblems` had no ceiling at all and every statement
  // edit writes a row to public.embedding_jobs. The review edited one sentence
  // fifty times.
  const saved = process.env.MAX_EDITS_PER_ACCOUNT_PER_HOUR;
  try {
    process.env.MAX_EDITS_PER_ACCOUNT_PER_HOUR = '3';
    const who = `edit-test-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) {
      assert.equal(allowEdit(who).allowed, true, `save ${i + 1} of 3`);
    }
    const refused = allowEdit(who);
    assert.equal(refused.allowed, false, 'the fourth save in an hour is refused');
    assert.ok(refused.retryAfterSeconds > 0, 'and it says how long to wait');
    assert.ok(refused.retryAfterSeconds <= 60 * 60, 'which is inside the hour');

    // A different account is a different bucket.
    assert.equal(allowEdit(`${who}-other`).allowed, true, 'one person cannot lock out another');
  } finally {
    if (saved === undefined) delete process.env.MAX_EDITS_PER_ACCOUNT_PER_HOUR;
    else process.env.MAX_EDITS_PER_ACCOUNT_PER_HOUR = saved;
  }
});

test('a peeked publish allowance answers and spends nothing', () => {
  // F7: the token was spent BEFORE public.publish_tool, so anything the
  // database then refused — an already-published listing replayed from the
  // Preview form, most of all — cost one of the three publishes a person gets
  // for the day. Five replays spent two of three on no-ops and were refused on
  // the third with an eight-hour wait.
  const saved = process.env.MAX_TOOLS_PER_ACCOUNT_PER_DAY;
  try {
    process.env.MAX_TOOLS_PER_ACCOUNT_PER_DAY = '2';
    const who = `publish-test-${Math.random()}`;
    const where = '198.51.100.7';

    // Five peeks, which is what five refused publishes now cost.
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        allowPublish(who, where, { peek: true }).allowed,
        true,
        `peek ${i + 1} is allowed and spends nothing`,
      );
    }
    // ...and the two real publishes are still there.
    assert.equal(allowPublish(who, where).allowed, true, 'the first publish');
    assert.equal(allowPublish(who, where).allowed, true, 'the second publish');
    assert.equal(allowPublish(who, where).allowed, false, 'and the third is refused');
    assert.equal(
      allowPublish(who, where, { peek: true }).allowed,
      false,
      'a peek tells the truth once the allowance is gone',
    );
  } finally {
    if (saved === undefined) delete process.env.MAX_TOOLS_PER_ACCOUNT_PER_DAY;
    else process.env.MAX_TOOLS_PER_ACCOUNT_PER_DAY = saved;
  }
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

/* ===========================================================================
 * Phase 7: publishing a listing
 * ======================================================================== */

test("a token bucket's window belongs to the instance, so a day is expressible", () => {
  const clock = fakeClock();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  // The defect this pins: before Phase 7 the window was hardcoded to an hour
  // inside take(), so "three per day" written as take(key, 3) was three per
  // HOUR — seventy-two a day — and would have looked like it worked.
  const daily = new TokenBuckets(clock, 50_000, DAY);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(daily.take('k', 3).allowed, true, `publish ${i + 1} of 3`);
  }
  const refused = daily.take('k', 3);
  assert.equal(refused.allowed, false, 'the fourth in one day is refused');
  assert.ok(refused.retryAfterSeconds > HOUR / 1000, 'and the wait is hours, not seconds');
  assert.ok(refused.retryAfterSeconds <= DAY / 1000, 'and no longer than the window');

  clock.advance(HOUR);
  assert.equal(daily.take('k', 3).allowed, false, 'an hour later, still refused');

  clock.advance(8 * HOUR);
  assert.equal(daily.take('k', 3).allowed, true, 'a third of a day refills one token');

  // And the hourly default is unchanged, which is the other half of the claim.
  const hourly = new TokenBuckets(clock);
  for (let i = 0; i < 10; i += 1) hourly.take('h', 10);
  assert.equal(hourly.take('h', 10).allowed, false);
  clock.advance(6 * 60 * 1000 + 1000);
  assert.equal(hourly.take('h', 10).allowed, true, 'a tenth of an hour refills one token');
});

test('publishing is limited per account per day and per address per hour', () => {
  // Against the process-wide buckets with the real clock, exactly like the
  // allowSignInCode tests below: fresh ids per case, no advancing.
  const account = `acct-${Math.random()}`;
  const address = `198.51.100.${Math.floor(Math.random() * 200)}`;

  for (let i = 0; i < DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY; i += 1) {
    const allowed = allowPublish(account, address);
    assert.equal(allowed.allowed, true, `publish ${i + 1} of the day`);
    assert.equal(allowed.refusedBy, null);
  }

  const fourth = allowPublish(account, address);
  assert.equal(fourth.allowed, false, 'the fourth listing in a day is refused');
  assert.equal(fourth.refusedBy, 'account', 'and the page must say WHICH ceiling');
  assert.ok(fourth.retryAfterSeconds > 0, 'with something to tell the person');

  // A different account from the same address gets through, until the address
  // ceiling. That is the point of there being two.
  let allowed = 0;
  let refusedByAddress = 0;
  for (let i = 0; i < 20; i += 1) {
    const answer = allowPublish(`${account}-other-${i}`, address);
    if (answer.allowed) allowed += 1;
    else if (answer.refusedBy === 'address') refusedByAddress += 1;
  }
  assert.ok(refusedByAddress > 0, 'the per-address ceiling must bite for a second account');
  assert.ok(
    allowed <= DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR,
    `${allowed} listings from one address in an hour, over the ceiling of ${DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR}`,
  );
});

test('the publishing limiter keeps neither the account id nor the address', () => {
  // The same rule as every other bucket in this file, and the reason it is
  // worth a test of its own: this is the first limiter keyed on something that
  // IS a person rather than on a connection.
  const source = readFileSync(new URL('../lib/rate-limit.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function allowPublish'));
  // The function body, which ends at the first `}` in the first column.
  // String.fromCharCode rather than an escape, because an escape written into
  // this file by a shell heredoc becomes the byte itself — the hazard
  // scripts/scan-control-bytes.mjs exists to catch.
  const fn = body.slice(0, body.indexOf(String.fromCharCode(10) + '}'));
  assert.match(fn, /visitorKey\(`publish-account:/, 'the account id is hashed, not kept');
  assert.match(fn, /visitorKey\(`publish-address:/, 'and so is the address');
  assert.doesNotMatch(fn, /console\./, 'and neither is logged');
});

/* ===========================================================================
 * Phase 8's review: the two limiter findings
 * ======================================================================== */

test('the Money panel figure is the window it says it is, not an expired one', () => {
  // F9, driven by the reviewer's own sequence. `count` was a bare getter that
  // did not roll the window, so after a quiet day the panel showed yesterday's
  // total until the next paid call happened to roll it — a number that was
  // neither "today" nor "since this process started", under a heading that
  // claimed the second.
  const clock = fakeClock(1_000_000_000_000);
  const cap = new DailyCap(clock);

  for (let i = 0; i < 7; i += 1) assert.equal(cap.take(1000), true);
  assert.equal(cap.count, 7, 'day 1, after 7 reader calls');

  clock.advance(24 * HOUR + MINUTE);
  assert.equal(
    cap.count,
    0,
    'day 2 with no call made yet: the window expired, and reading it rolls it',
  );

  assert.equal(cap.take(1000), true);
  assert.equal(cap.count, 1, 'day 2, after the first call');
});

test('the Money panel can tell "none yet" from "none today"', () => {
  // The other half of F9: a freshly restarted process drew `0 / 0 / 0`, which
  // is a measurement, where the truth was "this process has not measured
  // anything" — the exact thing the page's own header says it never does.
  const before = paidCallsToday();
  assert.equal(typeof before.measured, 'boolean');
  assert.equal(typeof before.startedAt, 'number');
  assert.ok(before.startedAt > 0, 'the window has a beginning the page can print');
  assert.ok(
    before.startedAt <= Date.now(),
    'and it is in the past, because it is when this process started counting',
  );
});

test('the outbound click is bounded per visitor and per process per day', () => {
  // F5. `tools.open_count` got a writer in Phase 8 and no bound at all: 200
  // anonymous posts moved it by 146 in 23 seconds and starved the pool that
  // renders pages while they ran.
  const visitor = `1.2.3.${Math.floor(Math.random() * 200) + 1}`;
  let counted = 0;
  for (let i = 0; i < DEFAULT_OPENS_PER_VISITOR_PER_HOUR * 4; i += 1) {
    if (allowOutboundOpen(visitor)) counted += 1;
  }
  assert.equal(
    counted,
    DEFAULT_OPENS_PER_VISITOR_PER_HOUR,
    'one visitor may have exactly the hourly bound counted, and no more',
  );

  // A second visitor has their own bucket, so the bound is per visitor rather
  // than per site — which is what makes it a fairness limit and not an outage.
  assert.equal(allowOutboundOpen(`9.9.9.${Math.floor(Math.random() * 200) + 1}`), true);

  // And the daily cap is a real ceiling above it, spent only by clicks the
  // per-visitor bucket allowed.
  assert.ok(outboundOpensToday() >= DEFAULT_OPENS_PER_VISITOR_PER_HOUR);
  assert.ok(outboundOpensToday() <= DEFAULT_OPENS_PER_DAY);
});

test('the outbound bound keeps nothing about the visitor', () => {
  // The same rule as every other bucket here: the address is hashed with the
  // per-process salt on the way in and the string is dropped. This is the
  // answer to loop-progress's Phase 8 note that bounding the beacon "would
  // mean reading the visitor's address on a path whose whole design is that it
  // reads nothing about the visitor".
  const source = readFileSync(new URL('../lib/rate-limit.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function allowOutboundOpen'));
  const fn = body.slice(0, body.indexOf(String.fromCharCode(10) + '}'));
  assert.match(fn, /visitorKey\(`open:/, 'the address is hashed, not kept');
  assert.doesNotMatch(fn, /console\./, 'and it is not logged');

  // Two visitors, two buckets; one visitor, one bucket. Stated over the key
  // rather than over the limiter, because the key is the whole of it.
  assert.notEqual(visitorKey('open:1.1.1.1'), visitorKey('open:2.2.2.2'));
  assert.equal(visitorKey('open:1.1.1.1'), visitorKey('open:1.1.1.1'));
  assert.notEqual(visitorKey('open:1.1.1.1'), visitorKey('1.1.1.1'));
});

test('the beacon route answers 204 to everything and reads no cookie', () => {
  // F5's other half: the count used to be a Server Action, which posts to the
  // page's own URL — so `POST /tools/<slug>` was in the request line of every
  // access log, beside the visitor's address. The route's own source is the
  // thing to assert here, because the alternative is a live server.
  // Comments out first: this file says "currentUserId() is not called" in
  // prose, and a test that read the prose would be asserting the opposite of
  // what it means to.
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const route = stripComments(
    readFileSync(new URL('../app/o/route.ts', import.meta.url), 'utf8'),
  );
  assert.match(route, /status: 204/, 'one status, and it is 204');
  assert.doesNotMatch(route, /status: (200|403|404|429|500)/, 'and there is no second one');
  assert.doesNotMatch(route, /cookies\(\)/, 'no cookie is read');
  assert.doesNotMatch(route, /currentUserId|currentViewer/, 'and nobody is identified');
  assert.match(route, /sameOrigin\(/, 'the Origin is checked, because a Route Handler is not');
  assert.match(route, /allowOutboundOpen\(/, 'and it is bounded');

  // And the action it replaced is gone rather than left beside it.
  const actions = stripComments(
    readFileSync(new URL('../app/tools/actions.ts', import.meta.url), 'utf8'),
  );
  assert.doesNotMatch(
    actions,
    /export async function recordOpen/,
    'the Server Action whose id was in the public client bundle is gone',
  );
});
