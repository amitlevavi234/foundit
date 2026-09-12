// ===========================================================================
// The embedding worker's two Phase-7-review fixes, driven without spending a
// penny and without a network.
//
// WHAT IS TESTED HERE AND WHY IT IS TESTABLE AT ALL. The worker itself is a
// script with a connection pool, a provider key and a `for(;;)` in it, and
// nothing about that shape can be driven from a test. So the one piece that is
// pure policy — WHOSE FAULT a failure was — lives in scripts/embed-batch.mjs
// and is handed both the provider and the spending cap. Every branch below
// runs against a stub that counts its calls and returns whatever the case
// needs.
//
// The two findings:
//
//   F8  one bad input among four used to charge an attempt against all four,
//       so three good statements were parked beside it — and the file's own
//       comment claimed the opposite. Bisection charges the one that fails
//       alone; a failure that survives bisection is charged to nobody.
//
//   F4  two workers were found running at once on the development machine,
//       each holding its own per-process daily allowance, which costed the
//       pair at $9.25 a month against a $5 ceiling. The worker now takes a
//       session-level advisory lock and refuses to start if another holds it.
//       That half needs a real database and is skipped without one.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { embedBatch, mayBeOneInput } from '../scripts/embed-batch.mjs';
import { EmbeddingError } from '../lib/embeddings.ts';

const MODEL = 'text-embedding-3-small';

/** Rows shaped exactly as public.embedding_work returns them. */
function jobs(n, kind = 'problem') {
  return Array.from({ length: n }, (_, i) => ({
    job_id: 1000 + i,
    kind,
    ref_id: 2000 + i,
    body: `a problem statement number ${i} that a person typed about their own tool`,
  }));
}

/**
 * A provider that refuses the inputs named in `bad` and answers for the rest.
 *
 * `status` is what it refuses WITH, which is the whole of the distinction F8
 * turns on: a 400 may be one input's fault and is worth bisecting for; a 401
 * is a fact about the request.
 */
function stubProvider({ bad = [], status = 400 } = {}) {
  const calls = [];
  return {
    calls,
    async embed(bodies) {
      calls.push(bodies.length);
      const offending = bodies.filter((b) => bad.includes(b));
      if (offending.length > 0) {
        throw new EmbeddingError(`HTTP ${status}`, status);
      }
      return {
        vectors: bodies.map((_, i) => `[${i}]`),
        model: MODEL,
        tokens: bodies.length * 10,
        truncated: [],
      };
    },
  };
}

function options(provider, extra = {}) {
  return {
    model: MODEL,
    reasonOf: (error) => `embeddings: ${error?.message ?? 'unknown'}`,
    truncationReason: 'longer than 2000 characters; not stored',
    mayEmbed: () => true,
    embed: provider.embed,
    ...extra,
  };
}

test('a batch with nothing wrong in it is one request and every vector', async () => {
  const provider = stubProvider();
  const rows = jobs(4);
  const result = await embedBatch(rows, options(provider));

  assert.deepEqual(provider.calls, [4], 'one request for four documents');
  assert.equal(result.vectors.size, 4);
  assert.equal(result.blamed.length, 0);
  assert.equal(result.outage, false);
  assert.equal(result.tokens, 40);
});

test('ONE BAD INPUT AMONG FOUR LEAVES THREE EMBEDDED', async () => {
  // THE FINDING, PINNED. The old loop called embedding_job_failed on all four;
  // three such batches and four jobs are parked, and a parked job only
  // un-parks when its text changes again — so three makers would have to edit
  // a sentence they had already written to get it embedded.
  const rows = jobs(4);
  const provider = stubProvider({ bad: [rows[2].body], status: 400 });

  const result = await embedBatch(rows, options(provider));

  assert.equal(result.vectors.size, 3, 'the three good statements embedded');
  assert.equal(result.blamed.length, 1, 'and exactly one was charged an attempt');
  assert.equal(result.blamed[0].row.job_id, rows[2].job_id, 'and it is the bad one');
  assert.equal(result.outage, false);

  for (const good of [rows[0], rows[1], rows[3]]) {
    assert.ok(result.vectors.has(good.job_id), `job ${good.job_id} must have a vector`);
    assert.ok(
      !result.blamed.some((b) => b.row.job_id === good.job_id),
      `job ${good.job_id} must not be charged for somebody else's input`,
    );
  }

  // It cost one whole-batch attempt, one retry, and then halves. Six requests
  // to find one bad row in four is the price of not parking three good ones.
  assert.ok(provider.calls.length >= 3, 'it bisected rather than giving up');
  assert.ok(provider.calls.includes(1), 'and it got down to a request of one');
});

test('a whole-batch failure that is NOT an input charges nobody', async () => {
  // The review's reproduction: a deliberately invalid key, a batch of four,
  // and "a batch of 4 failed and was recorded against each job". Four attempts
  // for something no statement did.
  const rows = jobs(4);
  const provider = stubProvider({ bad: rows.map((r) => r.body), status: 401 });

  const result = await embedBatch(rows, options(provider));

  assert.equal(result.outage, true, 'a 401 is the request, not the rows');
  assert.equal(result.blamed.length, 0, 'NO job is charged an attempt');
  assert.equal(result.vectors.size, 0);
  assert.match(result.reason ?? '', /401/, 'and the reason says what happened');
  // Two requests: the batch and its one retry. No bisection, because every
  // half would fail the same way and cost the same nothing.
  assert.deepEqual(provider.calls, [4, 4]);
});

test('a batch where every input fails ALONE is still the provider’s fault', async () => {
  // The subtle one. A 400 for every input is indistinguishable from a request
  // that is malformed, and charging all of them would park the queue.
  const rows = jobs(4);
  const provider = stubProvider({ bad: rows.map((r) => r.body), status: 400 });

  const result = await embedBatch(rows, options(provider));

  assert.equal(result.outage, true, 'everything failing alone is not everything being bad');
  assert.equal(result.blamed.length, 0);
  assert.equal(result.vectors.size, 0);
});

test('a transient failure is retried once before anything is bisected', async () => {
  const rows = jobs(8);
  let first = true;
  const provider = {
    calls: [],
    async embed(bodies) {
      provider.calls.push(bodies.length);
      if (first) {
        first = false;
        throw new EmbeddingError('timed out after 4000 ms');
      }
      return {
        vectors: bodies.map((_, i) => `[${i}]`),
        model: MODEL,
        tokens: bodies.length,
        truncated: [],
      };
    },
  };

  const result = await embedBatch(rows, options(provider));
  assert.deepEqual(provider.calls, [8, 8], 'the retry is the whole batch, not two halves');
  assert.equal(result.vectors.size, 8);
  assert.equal(result.blamed.length, 0);
});

test('a truncated input is charged to itself, which it always was', async () => {
  const rows = jobs(3);
  const provider = {
    calls: [],
    async embed(bodies) {
      provider.calls.push(bodies.length);
      return {
        vectors: bodies.map((_, i) => `[${i}]`),
        model: MODEL,
        tokens: bodies.length,
        truncated: [1],
      };
    },
  };

  const result = await embedBatch(rows, options(provider));
  assert.equal(result.vectors.size, 2);
  assert.equal(result.blamed.length, 1);
  assert.equal(result.blamed[0].row.job_id, rows[1].job_id);
  assert.match(result.blamed[0].reason, /not stored/);
});

test('a provider answering with the wrong model stores nothing and blames nobody', async () => {
  const rows = jobs(2);
  const provider = {
    async embed(bodies) {
      return {
        vectors: bodies.map(() => '[0]'),
        model: 'some-other-model',
        tokens: 7,
        truncated: [],
      };
    },
  };

  const result = await embedBatch(rows, options(provider));
  assert.equal(result.outage, true);
  assert.equal(result.vectors.size, 0, 'a table holding two vector spaces is a search going wrong');
  assert.equal(result.blamed.length, 0);
  assert.match(result.reason ?? '', /some-other-model/);
});

test('the spending cap is asked before every request, including inside a bisection', async () => {
  const rows = jobs(4);
  const provider = stubProvider({ bad: [rows[0].body], status: 400 });
  let asked = 0;
  const result = await embedBatch(
    rows,
    options(provider, {
      mayEmbed: () => {
        asked += 1;
        return asked <= 2;
      },
    }),
  );
  assert.ok(asked > 2, 'the cap is asked again for each half, not once for the tick');
  assert.equal(result.capped, true, 'and a bisection that runs out of budget says so');
});

test('only a 400 is ever treated as one input’s fault', () => {
  assert.equal(mayBeOneInput(new EmbeddingError('HTTP 400', 400)), true);
  for (const status of [401, 403, 404, 408, 429, 500, 502, 503]) {
    assert.equal(
      mayBeOneInput(new EmbeddingError(`HTTP ${status}`, status)),
      false,
      `HTTP ${status} is a fact about the request, not about a statement`,
    );
  }
  assert.equal(mayBeOneInput(new EmbeddingError('timed out after 4000 ms')), false);
  assert.equal(mayBeOneInput(new EmbeddingError('EMBEDDINGS_API_KEY is not set')), false);
  assert.equal(mayBeOneInput(new Error('something else')), false);
  assert.equal(mayBeOneInput(null), false);
});

/* ===========================================================================
 * Exactly one worker
 * ======================================================================== */

test('the worker refuses to start when another holds the advisory lock', async (t) => {
  const url = process.env.DATABASE_URL_EMBED;
  if (!url || url.trim() === '') {
    t.skip(
      'DATABASE_URL_EMBED is not set, so the second-worker refusal could not be driven. '
        + 'Run with `node --env-file=.env.local`.',
    );
    return;
  }

  // The key is read from the worker rather than copied here, so a changed
  // constant fails this test rather than making it pass vacuously.
  const source = readFileSync(new URL('../scripts/embed-worker.mjs', import.meta.url), 'utf8');
  const declared = /const WORKER_LOCK_KEY = ([0-9_]+);/.exec(source);
  assert.ok(declared, 'the worker must declare WORKER_LOCK_KEY');
  const key = Number(declared[1].replaceAll('_', ''));

  const { default: pg } = await import('pg');
  const holder = new pg.Client({ connectionString: url, application_name: 'foundit-test-lock' });
  await holder.connect();
  try {
    const { rows } = await holder.query('select pg_try_advisory_lock($1::bigint) as held', [key]);
    assert.equal(rows[0].held, true, 'the test has to be the one holding it, or nothing is proved');

    // `--once` so that a worker which DID start would stop by itself. It must
    // not start: the lock is the last thing the worker does before it is
    // usable, and it is taken before the key is checked and before anything
    // reaches the provider.
    //
    // WITH NO KEY IN THE CHILD'S ENVIRONMENT, deliberately, and that is what CI
    // caught. This ran green here because .env.local has a key, and on CI —
    // which has none — the worker checked the key first and exited 1 with a
    // configuration message. Both sentences were true and the wrong one was
    // said. Deleting the key here means the test is the same test on both
    // machines, and it pins the ORDER rather than trusting it.
    //
    // AND `fetch` IS POISONED, so "it made no network call" is asserted rather
    // than reasoned about. A data: URL rather than a fixture file because it is
    // three lines and belongs to this test; anything that reaches the provider
    // exits 99 and prints a marker, so the exit code below could not be 4.
    const NO_NETWORK =
      'data:text/javascript,'
      + encodeURIComponent(
        'globalThis.fetch = () => {'
          + ' process.stderr.write("NETWORK CALL FROM A LOCKED-OUT WORKER\\n");'
          + ' process.exit(99); };',
      );
    const childEnv = { ...process.env };
    delete childEnv.EMBEDDINGS_API_KEY;
    delete childEnv.OPENAI_API_KEY;

    const child = spawn(
      process.execPath,
      ['--import', NO_NETWORK, 'scripts/embed-worker.mjs', '--once'],
      { cwd: new URL('..', import.meta.url), env: childEnv },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    assert.equal(code, 4, `a second worker must exit 4; it exited ${code}. stderr: ${stderr}`);
    assert.match(stderr, /already holds the advisory lock/, 'and it says why');
    assert.doesNotMatch(
      stderr,
      /EMBEDDINGS_API_KEY is not set/,
      'a second worker says it is a second worker, not that it is misconfigured',
    );
    assert.doesNotMatch(stdout, /embed-worker: foundit_embed/, 'it must not have started a run');
    // IT MADE NO NETWORK CALL. The poisoned `fetch` above would have printed
    // this and exited 99.
    assert.doesNotMatch(
      stderr,
      /NETWORK CALL FROM A LOCKED-OUT WORKER/,
      'a locked-out worker reached the provider',
    );
    // And nothing sensitive in either stream.
    for (const stream of [stdout, stderr]) {
      assert.doesNotMatch(stream, /postgresql:\/\//, 'no connection string is ever printed');
      assert.doesNotMatch(stream, /sk-/, 'no key is ever printed');
    }
  } finally {
    await holder.query('select pg_advisory_unlock_all()');
    await holder.end();
  }
});
