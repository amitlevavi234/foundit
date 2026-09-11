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
