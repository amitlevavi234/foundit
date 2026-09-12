// ===========================================================================
// What the reader does when the provider misbehaves.
//
// The address is a hardcoded constant — that is the whole point of
// lib/reader-model.ts, and tests/markup.test.mjs asserts it — so there is no
// way to point this at a stub server, and there should not be. What CAN be
// stubbed is the transport, which exercises exactly the code between the
// provider's answer and ours: the status check, the JSON parse, the shape of
// the Responses envelope, the model check, and the validator.
//
// Every case here must come back as `null` from `readSentence`, never as an
// exception, because a search whose sentence could not be read is a rules-only
// search and a perfectly good page. And every log line must carry the reason
// and nothing else — not the sentence, not the key, not the response body.
//
// The vote is here too. `readSentence` makes two calls and a refusal needs
// both; the three cases at the bottom are the three ways that can go.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

const SENTENCE = 'a tool to split expenses';

const EMPTY = {
  pricing: [],
  platforms: [],
  languages: [],
  flags: [],
  english: '',
  asks_for_software: true,
  residual: SENTENCE,
};

const good = (over = {}) => ({ ...EMPTY, ...over });

/**
 * The two variables lib/reader-model.ts reads, named once.
 *
 * Reached through `process.env[name]` everywhere below and never written as
 * `process.env.THE_NAME = ...`, so `scripts/scan-secrets.sh` never has to
 * decide whether a line in a test is a real key being committed. A scanner
 * that has to be taught exceptions is a scanner somebody eventually loosens.
 */
const KEY_NAMES = ['OPENAI_API_KEY', 'EMBEDDINGS_API_KEY'];

const saveKeys = () => KEY_NAMES.map((name) => [name, process.env[name]]);

function restoreKeys(saved) {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const clearKeys = () => {
  for (const name of KEY_NAMES) delete process.env[name];
};

/**
 * Run `fn` with `fetch` replaced, a key present, and `console.error` captured.
 *
 * Everything is put back in a `finally`, including the two environment
 * variables: a test that left a stand-in key behind would make every test after
 * it in the same process behave differently.
 */
async function withStubbedFetch(handler, fn) {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const saved = saveKeys();
  const errors = [];
  globalThis.fetch = handler;
  process.env[KEY_NAMES[0]] = 'a value no stub ever looks at';
  console.error = (line) => errors.push(String(line));
  try {
    return { value: await fn(), errors };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    restoreKeys(saved);
  }
}

const ok = (payload) => () =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });

const status = (code) => () =>
  Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({}) });

/** A well-formed Responses envelope carrying `text` as the model's output. */
const envelope = (text) => ({
  model: 'gpt-5-nano-2025-08-07',
  status: 'completed',
  output: [
    { type: 'reasoning', content: [] },
    { type: 'message', content: [{ type: 'output_text', text }] },
  ],
  usage: { input_tokens: 100, output_tokens: 20 },
});

test('a provider that answers with garbage never reaches the search', async () => {
  const cases = [
    ['a 500', status(500), /HTTP 500/],
    ['a 429', status(429), /HTTP 429/],
    [
      'a body that is not JSON',
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('x')) }),
      /response was not JSON/,
    ],
    [
      'an envelope with no message',
      ok({ model: 'gpt-5-nano', status: 'incomplete', output: [] }),
      /carried no text/,
    ],
    ['prose instead of JSON', ok(envelope('I think they want a video editor!')), /was not JSON/],
    ['a different model', ok({ ...envelope('{}'), model: 'gpt-4o-mini' }), /answered with model/],
    ['JSON of the wrong shape', ok(envelope('{"pricing":["free"]}')), /schema: the response has no/],
    [
      'an enum value the catalogue does not have',
      ok(envelope(JSON.stringify(good({ flags: ['blazing_fast'] })))),
      /schema: .*known flags/,
    ],
    [
      'a residual longer than the sentence',
      ok(envelope(JSON.stringify(good({ residual: `${SENTENCE} and also a pony` })))),
      /schema: .*longer than the sentence/,
    ],
    [
      'an extra field, where a tool name would arrive',
      ok(envelope(JSON.stringify(good({ recommend: 'splitwise' })))),
      /schema: .*extra field "recommend"/,
    ],
  ];

  const { readSentence, readSentenceOrThrow } = await import('../lib/reader-model.ts');

  for (const [name, handler, expected] of cases) {
    // The throwing form says exactly what was wrong...
    const thrown = await withStubbedFetch(handler, async () => {
      try {
        await readSentenceOrThrow(SENTENCE);
        return null;
      } catch (error) {
        return error;
      }
    });
    assert.ok(thrown.value, `${name}: must be refused, and was not`);
    assert.match(thrown.value.message, expected, `${name}: the reason must name the problem`);
    assert.ok(
      !thrown.value.message.includes(SENTENCE),
      `${name}: the reason must not quote the sentence back`,
    );

    // ...and the form a search calls returns null and logs exactly one line.
    const quiet = await withStubbedFetch(handler, () => readSentence(SENTENCE));
    assert.equal(quiet.value, null, `${name}: a search must get null, not an exception`);
    assert.equal(quiet.errors.length, 1, `${name}: exactly one line on the log`);
    assert.match(quiet.errors[0], /the rules pass stands/);
    assert.ok(
      !quiet.errors[0].includes(SENTENCE),
      `${name}: the log line must not carry the sentence`,
    );
    assert.ok(!/key|Bearer/i.test(quiet.errors[0]), `${name}: nor the key`);
  }
});

test('with no key at all, the reader answers null without calling anything', async () => {
  const realFetch = globalThis.fetch;
  const saved = saveKeys();
  let called = 0;
  globalThis.fetch = () => {
    called += 1;
    throw new Error('the reader must not call anything when there is no key');
  };
  try {
    clearKeys();
    const { readSentence, readerConfigured } = await import('../lib/reader-model.ts');
    assert.equal(readerConfigured(), false);
    assert.equal(await readSentence(SENTENCE), null);
    assert.equal(called, 0, 'no key means no request, not a failed request');
  } finally {
    globalThis.fetch = realFetch;
    restoreKeys(saved);
  }
});

test('a refusal needs two votes, and one sample is not a vote', async () => {
  const { readSentence } = await import('../lib/reader-model.ts');
  const sentence = 'someone to come and fix the leak under the sink';
  const says = (asks) => JSON.stringify({ ...EMPTY, asks_for_software: asks, residual: sentence });

  // Both samples say "not software": the page is emptied.
  const both = await withStubbedFetch(ok(envelope(says(false))), () => readSentence(sentence));
  assert.equal(both.value.reading.asksForSoftware, false, 'two votes refuse');

  // They disagree: the search runs. The observed failure this exists for was
  // one sample in seven calling a question about splitting a bill "not
  // software", which would have emptied a page that had a right answer on it.
  let n = 0;
  const disagreeing = () => {
    n += 1;
    return ok(envelope(says(n !== 1)))();
  };
  const split = await withStubbedFetch(disagreeing, () => readSentence(sentence));
  assert.equal(split.value.reading.asksForSoftware, true, 'one dissenting vote is enough to search');

  // Only one call succeeds, and it says "not software": still a search, because
  // a refusal that could not be corroborated is not a refusal.
  let m = 0;
  const halfBroken = () => {
    m += 1;
    return m === 1 ? ok(envelope(says(false)))() : status(500)();
  };
  const lone = await withStubbedFetch(halfBroken, () => readSentence(sentence));
  assert.equal(lone.value.reading.asksForSoftware, true, 'one sample is not a vote');
});

test('the restatement takes whichever sample produced one', async () => {
  const { readSentence } = await import('../lib/reader-model.ts');
  const sentence = 'תוכנה לעריכת וידאו';
  let n = 0;
  const oneRestates = () => {
    n += 1;
    return ok(
      envelope(
        JSON.stringify({
          ...EMPTY,
          english: n === 1 ? '' : 'software for editing video',
          residual: sentence,
        }),
      ),
    )();
  };
  const out = await withStubbedFetch(oneRestates, () => readSentence(sentence));
  assert.equal(
    out.value.reading.english,
    'software for editing video',
    'an empty restatement is a missing answer, and the second sample answers it',
  );
});

test('the tokens a search is billed for are both calls, not one', async () => {
  const { readSentence } = await import('../lib/reader-model.ts');
  const out = await withStubbedFetch(ok(envelope(JSON.stringify(good()))), () =>
    readSentence(SENTENCE),
  );
  assert.equal(out.value.tokensIn, 200, 'two calls at 100 input tokens each');
  assert.equal(out.value.tokensOut, 40, 'and 20 output tokens each');
});

test('a stalled body times out, not just stalled headers', async () => {
  // `fetch` resolves when the HEADERS arrive. A provider that answers 200 and
  // then trickles — or never finishes — the body was bounded by nothing at all:
  // an adversarial review measured fifteen seconds against a three-second
  // timeout, because the abort timer was cleared the moment the headers landed.
  //
  // The stub below answers instantly and then hangs in `json()`, honouring the
  // abort signal the way a real body stream does.
  const { readSentenceOrThrow, READER_TIMEOUT_MS } = await import('../lib/reader-model.ts');

  const stalls = (_url, init) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    });

  const started = Date.now();
  const out = await withStubbedFetch(stalls, async () => {
    try {
      await readSentenceOrThrow(SENTENCE);
      return null;
    } catch (error) {
      return error;
    }
  });
  const elapsed = Date.now() - started;

  assert.ok(out.value, 'a stalled body must be refused, not awaited for ever');
  assert.match(out.value.message, /timed out after/);
  assert.ok(
    elapsed < READER_TIMEOUT_MS * 2,
    `it must give up near the timeout, not long after it (took ${elapsed} ms)`,
  );
});

test('the embedder bounds a stalled body too', async () => {
  const { embedTexts, EMBEDDINGS_TIMEOUT_MS } = await import('../lib/embeddings.ts');
  const saved = saveKeys();
  const realFetch = globalThis.fetch;
  try {
    process.env[KEY_NAMES[1]] = 'a value no stub ever looks at';
    globalThis.fetch = (_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      });

    const started = Date.now();
    let thrown = null;
    try {
      await embedTexts([SENTENCE]);
    } catch (error) {
      thrown = error;
    }
    const elapsed = Date.now() - started;

    assert.ok(thrown, 'a stalled body must be refused');
    assert.match(thrown.message, /timed out after/);
    assert.ok(elapsed < EMBEDDINGS_TIMEOUT_MS * 2, `took ${elapsed} ms`);
  } finally {
    globalThis.fetch = realFetch;
    restoreKeys(saved);
  }
});

test('a reader that refuses EVERYTHING stops emptying pages', async () => {
  // The review's attack: point the reader at a model that answers
  // `asks_for_software: false` for every sentence, and three of four real
  // questions came back with "Foundit only lists software". The two-sample vote
  // does not help — two samples of a broken model agree with each other.
  //
  // What follows is exactly the two lines app/results/page.tsx runs, over the
  // functions it runs them on:
  //
  //     if (fresh) recordRefusal(!plan.asksForSoftware);
  //     notSoftware = !plan.asksForSoftware && refusalsTrusted();
  //
  // The address the reader calls is a hardcoded constant and there is no
  // supported way to point a running server somewhere else, which is the whole
  // design; so the transport is stubbed and the composition is driven here.
  const { readSentence } = await import('../lib/reader-model.ts');
  const { planSearch } = await import('../lib/reading.ts');
  const { RefusalCircuit } = await import('../lib/rate-limit.ts');

  // Real questions, every one of which has an answer in the catalogue. None
  // says "app" or names a tool, so nothing else in the guards saves them —
  // only the circuit can.
  const QUESTIONS = [
    'we all paid for different bits of the holiday and now nobody knows who owes who',
    'I get to the end of every month with no idea where the money went',
    'my video file is too big to email, how do I shrink it',
    'stop myself opening the same distracting websites while I am trying to work',
    'cut all the long silences out of an interview I recorded',
    'keep a folder identical on two computers without a cloud company in the middle',
    'send money to family in another country without losing a chunk to the exchange rate',
    'sketch a quick diagram of how our system works and send someone the link',
    'get a written transcript of a meeting I was in',
    'have long articles read out loud to me while I am walking',
    'follow the blogs I care about without an algorithm deciding what I see',
    'scan all the paper in my filing cabinet so I can search it later',
    'find out where my working hours actually go so I can bill a client honestly',
    'shopping list the whole household can add to from their own phones',
    'draw a logo that will still look sharp when it is printed on a banner',
    'check my English grammar before I send an email to a client',
    'make all my podcast episodes come out at the same loudness',
    'open and edit a photoshop file without owning photoshop',
    'somewhere to write a novel where I can move the chapters around',
    'back up my whole laptop so I can get everything back if it is stolen',
    'merge two pdfs without uploading my documents to some website',
    'keep all the flight and hotel bookings for one trip in a single place',
    'record my screen and stream it live',
    'block distracting sites',
  ];

  const brokenModel = (sentence) =>
    ok(
      envelope(
        JSON.stringify({ ...EMPTY, asks_for_software: false, residual: sentence }),
      ),
    )();

  const circuit = new RefusalCircuit();
  const realError = console.error;
  console.error = () => {};

  let emptied = 0;
  let reachedTheSearchAfterwards = 0;
  try {
    for (const sentence of QUESTIONS) {
      const fresh = await withStubbedFetch(
        () => brokenModel(sentence),
        () => readSentence(sentence),
      );
      const plan = planSearch(sentence, [], fresh.value.reading, { toolNames: [] });
      // The page's two lines, with this test's own circuit standing in for the
      // process-wide one.
      if (fresh.value) circuit.record(!plan.asksForSoftware);
      const notSoftware = !plan.asksForSoftware && circuit.trusted;
      if (notSoftware) emptied += 1;
      // Once it is open, the rest of the run has to reach the search. Counted
      // rather than assumed, because "the circuit opened" and "the pages came
      // back" are two different claims and only the second one is the product.
      if (!circuit.trusted && !notSoftware) reachedTheSearchAfterwards += 1;
    }
  } finally {
    console.error = realError;
  }

  assert.equal(circuit.trusted, false, 'the circuit must be open after a run like that');
  // THE BOUND MOVED IN THE PHASE 5 REVIEW, and this number is the price of that
  // change. The circuit used to conclude from ten samples and a half-share, and
  // it tripped twice during a legitimate run of unanswerable sentences —
  // deciding a working reader was broken, which is the expensive direction of
  // the two. It now needs a FULL WINDOW of twenty and four fifths of them, so a
  // genuinely broken model gets up to twenty pages rather than up to ten before
  // it is cut off. Sixteen here, because four of these twenty-four sentences
  // are rescued by the rules pass before the reader's verdict is consulted at
  // all — which is also why the run trips at exactly 16 of 20.
  assert.ok(emptied <= 20, `at most twenty pages may be emptied before it trips, not ${emptied}`);
  assert.ok(
    reachedTheSearchAfterwards >= 4,
    'and every question after it trips must reach the search',
  );
});

test('a working reader is not punished for the occasional real refusal', async () => {
  // The other direction: the circuit must not trip on ordinary traffic, or it
  // would quietly disable the feature the phase is for.
  const { RefusalCircuit } = await import('../lib/rate-limit.ts');
  const circuit = new RefusalCircuit();
  // Roughly the mix both negatives files together produce: about a fifth.
  for (let i = 0; i < 40; i += 1) circuit.record(i % 5 === 0);
  assert.equal(circuit.trusted, true, 'one in five refusing is a normal week');
});
