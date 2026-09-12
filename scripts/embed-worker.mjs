#!/usr/bin/env node
// ===========================================================================
// Foundit — the embedding worker.
//
//   node --env-file=.env.local scripts/embed-worker.mjs
//   node --env-file=.env.local scripts/embed-worker.mjs --once
//   node --env-file=.env.local scripts/embed-worker.mjs --interval=2
//
// scripts/embed.mjs fills the whole catalogue when somebody runs it. This
// drains public.embedding_jobs on a short poll, which is what makes Phase 7's
// promise true: a listing published on the website is returned by a search
// that only its meaning could match, within a minute, with no human in the
// loop.
//
// The two jobs are deliberately separate rather than one with a flag:
//
//   embed.mjs        a batch. Reads a work PREDICATE over the whole catalogue
//                    (0005, 0007), can write and read the offline fixture, and
//                    ends. Run it after a migration or a re-seed.
//   this file        a queue. Reads public.embedding_work, which is rows a
//                    trigger put there because something changed, embeds them,
//                    and keeps going. Run it beside the application.
//
// SEVEN THINGS ABOUT IT ARE DELIBERATE, and the first three are 0005's.
//
//   1. IT CONNECTS AS foundit_embed AND REFUSES ANY OTHER ROLE BY NAME. The
//      power to write a vector and the power to ask which vector is nearest a
//      cached query, held by one role, read that cache out one sign bit at a
//      time. The application has the second. This has the first.
//
//   2. IT TOUCHES NO TABLE. foundit_embed holds no grant on public.tools, on
//      public.tool_problems, on public.embedding_jobs itself, or on anything
//      else. Three functions are the whole of what it may call here, plus the
//      two setters and the model name it shares with embed.mjs.
//
//   3. ITS POOL IS NOT IN lib/. tests/markup.test.mjs forbids the string
//      DATABASE_URL_EMBED anywhere under app/, components/ or lib/, and that
//      rule is right: the web process must never hold this role's credentials,
//      and a pool module under lib/ is one import away from being in the web
//      bundle's dependency graph. So the connection lives here, in the process
//      that is the only thing that should have it.
//
//   4. A BAD ROW DOES NOT STOP THE RUN, AND A BAD REQUEST DOES NOT PARK THE
//      BATCH. Three kinds, and each is handled rather than thrown: a job whose
//      row has been deleted or whose tool is not published comes back with a
//      null body and is retired; a job the provider refuses BY ITSELF is
//      recorded with its reason and retried twice before being parked; and a
//      request that fails as a whole is retried once and then BISECTED, so the
//      attempt is charged to the input that fails alone rather than to the
//      thirty-one that happened to be queued beside it. A failure that
//      survives bisection is the provider's and is charged to nobody: the jobs
//      stay queued and the next tick tries again.
//
//      The Phase 7 review is why this is not the loop it used to be. It
//      pointed an invalid key at a batch of four and watched all four get an
//      attempt each; three such batches and every one of them is parked, and a
//      parked job only un-parks when its text changes again. The file's own
//      comment claimed the opposite.
//
//   5. IT SPENDS AGAINST THE SAME DAILY CAPS — BOTH OF THEM. lib/rate-limit.ts
//      holds MAX_EMBEDDING_CALLS_PER_DAY, which counts requests, and
//      MAX_EMBEDDING_TOKENS_PER_DAY, which counts what the request carries.
//      This asks `mayEmbedTokens` with the batch's estimated size before every
//      request, because a request from this process holds up to
//      EMBEDDINGS_WORKER_BATCH documents and the old `mayCallEmbeddings(1)`
//      charged it the same as one search sentence — which the cost model then
//      priced at fifteen tokens against a real ceiling of 3,200.
//
//      The counters are per PROCESS, which is why only one of these runs; see
//      the advisory lock below.
//
//   6. EXACTLY ONE OF THESE RUNS, AND IT PROVES IT. A per-process counter
//      shared between two processes is two allowances, and the review found
//      two workers live on this machine at once, each holding its own. So the
//      worker takes a session-level advisory lock at start-up and REFUSES TO
//      START if another holds it. The lock dies with the connection, so a
//      worker that is killed leaves nothing to clean up.
//
//   7. NOTHING IT PRINTS IS SENSITIVE. Job ids, counts, tokens and elapsed
//      milliseconds. Never the key, never a connection string, and never the
//      text of a statement — a maker's unpublished problem statement is not
//      log material.
//
// Exit codes: 0 done or asked to stop, 1 configuration, 2 the embedding
// provider refused everything, 3 the database, 4 another worker is running.
// ===========================================================================
import pg from 'pg';

import {
  EMBEDDINGS_BATCH_SIZE,
  EmbeddingError,
  MAX_DOCUMENT_INPUT,
  embedTexts,
  embeddingsConfigured,
} from '../lib/embeddings.ts';
import { EMBEDDINGS_WORKER_BATCH, EMBEDDING_DOCUMENT_TOKENS } from '../lib/prices.ts';
import { mayEmbedTokens } from '../lib/rate-limit.ts';
import { embedBatch } from './embed-batch.mjs';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3, LOCKED: 4 };

/**
 * The advisory lock one worker holds for its whole life.
 *
 * A session-level lock rather than a transaction one, and a bare number rather
 * than a name, because `pg_try_advisory_lock` takes a bigint and the number
 * only has to be ours. It is released when the connection closes, including
 * when the process is killed, so there is no stale lock to clear by hand and
 * no lease to renew. `pg_try_advisory_lock` and not `pg_advisory_lock`: the
 * second WAITS, and a second worker that quietly waits forever looks exactly
 * like a second worker that is running.
 */
const WORKER_LOCK_KEY = 7_017_180_042;

/** The role this worker runs as, and the only one it will accept. */
const ROLE = 'foundit_embed';
const URL_VARIABLE = 'DATABASE_URL_' + 'EMBED';

/**
 * How long between polls when the queue was empty, in seconds.
 *
 * Five, and the number comes from the promise: the gate is sixty seconds from
 * Publish to searchable, and the budget is one poll interval plus one API
 * round trip plus the write. Five leaves an order of magnitude of room and
 * costs one index probe on an empty partial index per tick — call it nothing.
 */
const DEFAULT_INTERVAL_SECONDS = 5;

/**
 * How many jobs to take per tick. One API request holds a hundred.
 *
 * The number lives in lib/prices.ts, because it is what decides what one
 * request costs and the cost model has to be able to see it. That is the same
 * arrangement the two `max_output_tokens` ceilings use, and it exists for the
 * same reason: the Phase 7 review found a cost model that had no idea how big
 * this caller's requests were.
 */
const BATCH = Math.min(EMBEDDINGS_WORKER_BATCH, EMBEDDINGS_BATCH_SIZE);

/**
 * What a batch is going to cost, before it is sent.
 *
 * Characters divided by four, which is the rule of thumb this provider's
 * tokeniser follows for English prose, floored at the document ceiling so the
 * estimate is never under the bill. A summary is capped at 400 characters and
 * a statement at 200, so a full batch is at most
 * BATCH * EMBEDDING_DOCUMENT_TOKENS.
 */
function estimateTokens(bodies) {
  let total = 0;
  for (const body of bodies) {
    total += Math.min(
      EMBEDDING_DOCUMENT_TOKENS,
      Math.ceil(String(body ?? '').length / 4) + 1,
    );
  }
  return Math.max(1, total);
}

const KNOWN = new Set(['--once']);
const args = process.argv.slice(2);
let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
let once = false;

for (const arg of args) {
  if (arg === '--once') {
    once = true;
    continue;
  }
  const interval = /^--interval=(\d+)$/.exec(arg);
  if (interval) {
    intervalSeconds = Math.max(1, Number.parseInt(interval[1], 10));
    continue;
  }
  if (!KNOWN.has(arg)) {
    process.stderr.write('unknown argument: ' + arg + '\n');
    process.stderr.write(
      'usage: node --env-file=.env.local scripts/embed-worker.mjs '
        + '[--once] [--interval=SECONDS]\n',
    );
    process.exit(EXIT.CONFIG);
  }
}

const databaseUrl = process.env[URL_VARIABLE];
if (!databaseUrl || databaseUrl.trim() === '') {
  process.stderr.write(
    URL_VARIABLE + ' is not set. It is the ' + ROLE + ' connection string, and this\n'
      + 'worker reads it from the environment and nowhere else. There is no fallback to\n'
      + 'the application or owner connections on purpose — see docs/development.md.\n',
  );
  process.exit(EXIT.CONFIG);
}

// Checked by name, not hoped for. A connection string pasted into the wrong
// variable would otherwise work perfectly and hand this worker the
// application's privileges, which is the exact pairing 0005 keeps apart.
try {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (user !== ROLE) {
    process.stderr.write(
      URL_VARIABLE + ' connects as "' + user + '". The embedding worker runs as ' + ROLE + ',\n'
        + 'which holds a handful of function grants and no table privilege of any kind.\n'
        + 'See db/migrations/0005_embed_role.sql for why this is not interchangeable.\n',
    );
    process.exit(EXIT.CONFIG);
  }
} catch {
  process.stderr.write(URL_VARIABLE + ' is not a connection string this worker can parse.\n');
  process.exit(EXIT.CONFIG);
}

// THE KEY IS CHECKED AFTER THE LOCK, further down, and the order is the point:
// "another worker is already running" is a fact about the MACHINE and
// "EMBEDDINGS_API_KEY is not set" is a fact about this invocation's
// configuration, so a second instance has to say the first thing whether or not
// the second is also true. It used to be checked here, which made a second
// worker on a machine with no key exit 1 with a configuration message — the
// truth about the wrong problem, and a refusal that could not be tested
// anywhere without a key (CI has none).

// Every statement this worker sends. All of them function calls, because this
// role may not touch a table.
const MODEL_SQL = 'select public.embedding_model() as model';
const WORK_SQL = 'select job_id, kind, ref_id, body from public.embedding_work($1::int)';
const DONE_SQL = 'select public.embedding_job_done($1::bigint) as gone';
const FAILED_SQL = 'select public.embedding_job_failed($1::bigint, $2::text) as marked';

// One round trip per batch rather than one per row, exactly as embed.mjs does
// it: the ids and the vectors go over as two arrays and unnest pairs them up.
const STORE_PROBLEM_SQL = `
  select count(*) filter (where public.store_problem_embedding(x.id, x.embedding::halfvec, $3::text))
           as stored
    from unnest($1::bigint[], $2::text[]) as x(id, embedding)`;

const STORE_TOOL_SQL = `
  select count(*) filter (where public.store_tool_embedding(x.id, x.embedding::halfvec, $3::text))
           as stored
    from unnest($1::bigint[], $2::text[]) as x(id, embedding)`;

const pool = new pg.Pool({
  connectionString: databaseUrl,
  // Three rather than two: one of them is checked out for the life of the
  // process to hold the advisory lock below and is never handed back.
  max: 3,
  min: 0,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'foundit-embed-worker',
  statement_timeout: 15_000,
  query_timeout: 15_500,
});

// An idle client that errors with no listener attached takes the process down
// with an unhandled rejection, and the message can carry the connection
// string, so it is not re-raised anywhere it could reach a log.
pool.on('error', () => {});

const started = Date.now();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(EXIT.OK);
    stopping = true;
    process.stdout.write('\nstopping after this tick\n');
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The reason, short, and never the text that caused it. */
function reasonOf(error) {
  if (error instanceof EmbeddingError) return 'embeddings: ' + error.message;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return 'error' + (code ? ' ' + String(code) : '') + ': ' + String(error?.message ?? 'unknown');
}

/**
 * The three verdicts, and which of them a failure earns.
 *
 * The policy itself is in scripts/embed-batch.mjs, which owns no connection
 * and no key and is handed both the provider and the spending cap — so
 * tests/embed-worker.test.mjs can drive every branch of it with a stub that
 * spends nothing. This is the binding.
 */
function embedLive(rows, model) {
  return embedBatch(rows, {
    model,
    reasonOf,
    truncationReason: 'longer than ' + MAX_DOCUMENT_INPUT + ' characters; not stored',
    mayEmbed: (bodies) => mayEmbedTokens(estimateTokens(bodies)),
    embed: (bodies) => embedTexts(bodies, { cap: MAX_DOCUMENT_INPUT }),
  });
}

/**
 * One tick: take up to BATCH jobs, embed the ones with a body, store, retire.
 *
 * Returns how many jobs it retired, so the caller knows whether to poll again
 * at once or wait. A tick never throws for a reason that is one job's fault.
 */
async function tick(model) {
  const { rows } = await pool.query(WORK_SQL, [BATCH]);
  if (rows.length === 0) return { done: 0, failed: 0, tokens: 0 };

  let retired = 0;
  let failed = 0;

  // A job whose row has gone, or whose tool has been unpublished since it was
  // queued, comes back with no body. It is finished rather than failed: there
  // is nothing to embed and nothing to fix.
  const vanished = rows.filter((row) => row.body === null || String(row.body).trim() === '');
  for (const row of vanished) {
    await pool.query(DONE_SQL, [row.job_id]);
    retired += 1;
  }

  const live = rows.filter((row) => !vanished.includes(row));
  if (live.length === 0) return { done: retired, failed, tokens: 0 };

  const result = await embedLive(live, model);

  if (result.capped && result.vectors.size === 0 && result.blamed.length === 0) {
    // A daily cap. Nothing is marked failed — the work is still work, and
    // tomorrow it will be done. Said once per tick and no more.
    process.stdout.write(
      'the daily embedding budget is spent; ' + live.length + ' job(s) left in the queue\n',
    );
    return { done: retired, failed, tokens: result.tokens, capped: true };
  }

  if (result.outage) {
    // NOBODY IS CHARGED. The request failed as a request — the provider is not
    // answering, or is answering with the wrong model — and the jobs are still
    // work. The next tick tries them again.
    process.stderr.write(
      'the provider refused a request of ' + live.length + '; no job was charged an attempt ('
        + (result.reason ?? 'no reason given') + ')\n',
    );
    return { done: retired, failed, tokens: result.tokens, outage: true };
  }

  // The rows that failed ON THEIR OWN, and only those.
  for (const { row, reason } of result.blamed) {
    await pool.query(FAILED_SQL, [row.job_id, reason]);
    failed += 1;
  }
  if (result.blamed.length > 0 && live.length > 1) {
    process.stdout.write(
      'bisected a batch of ' + live.length + ': ' + result.blamed.length
        + ' input(s) failed alone, ' + result.vectors.size + ' embedded\n',
    );
  }

  for (const kind of ['problem', 'tool']) {
    const ids = [];
    const vectors = [];
    const jobs = [];
    for (const row of live) {
      if (row.kind !== kind) continue;
      const vector = result.vectors.get(row.job_id);
      if (vector === undefined) continue;
      ids.push(row.ref_id);
      vectors.push(vector);
      jobs.push(row.job_id);
    }
    if (ids.length === 0) continue;

    const sql = kind === 'problem' ? STORE_PROBLEM_SQL : STORE_TOOL_SQL;
    try {
      await pool.query(sql, [ids, vectors, model]);
    } catch (error) {
      const reason = reasonOf(error);
      for (const job of jobs) {
        await pool.query(FAILED_SQL, [job, reason]);
        failed += 1;
      }
      continue;
    }
    for (const job of jobs) {
      await pool.query(DONE_SQL, [job]);
      retired += 1;
    }
  }

  return { done: retired, failed, tokens: result.tokens };
}

/* ---------------------------------------------------------------------------
 * EXACTLY ONE WORKER.
 *
 * The daily caps in lib/rate-limit.ts are per process, so a second worker is a
 * second full allowance and the bill is whatever number of workers happen to
 * be running times the ceiling. The Phase 7 review found two live on this
 * machine at once and costed the pair at $9.25 a month against a $5 ceiling.
 *
 * A session-level advisory lock is the cheapest honest answer: it needs no
 * table, so foundit_embed keeps its "no table privilege of any kind"; it is
 * held by a CONNECTION, so it goes away when the process does, however it
 * does; and `pg_try_advisory_lock` answers rather than waiting, so a second
 * worker says what is wrong and exits instead of sitting silently in a queue
 * that looks like work.
 *
 * The client is checked out of the pool and never returned. That is the point:
 * a session lock lives on a session, and handing the connection back would
 * hand the lock back with it.
 * ------------------------------------------------------------------------ */
let lockHolder;
try {
  lockHolder = await pool.connect();
  const { rows } = await lockHolder.query('select pg_try_advisory_lock($1::bigint) as held', [
    WORKER_LOCK_KEY,
  ]);
  if (rows[0]?.held !== true) {
    process.stderr.write(
      'another embed-worker already holds the advisory lock on this database.\n'
        + 'EXACTLY ONE runs at a time, because the daily embedding budget in\n'
        + 'lib/rate-limit.ts is per process and a second worker is a second full\n'
        + 'allowance. Stop the other one, or wait for it to finish; see\n'
        + 'docs/development.md for how it runs on the server.\n',
    );
    lockHolder.release();
    await pool.end();
    process.exit(EXIT.LOCKED);
  }
} catch (error) {
  process.stderr.write('the database would not answer: ' + reasonOf(error) + '\n');
  if (lockHolder) lockHolder.release();
  await pool.end();
  process.exit(EXIT.DATABASE);
}

/* ---------------------------------------------------------------------------
 * AND ONLY NOW THE KEY.
 *
 * This check sat above the pool until CI ran the second-worker test on a
 * machine with no key and got exit 1 with a configuration message. Both
 * sentences were true; the wrong one was said. A second worker's first duty is
 * to say that it is a second worker, and it reaches the provider on no path
 * between start-up and here — the lock above is the last thing it does.
 * ------------------------------------------------------------------------ */
if (!embeddingsConfigured()) {
  process.stderr.write(
    'EMBEDDINGS_API_KEY is not set. It lives in .env.local, which is not committed;\n'
      + 'run this as `node --env-file=.env.local scripts/embed-worker.mjs`.\n'
      + 'With no key there is nothing this worker can do: unlike scripts/embed.mjs it\n'
      + 'has no fixture to read, because a queue is about text nobody has seen before.\n',
  );
  lockHolder.release();
  await pool.end();
  process.exit(EXIT.CONFIG);
}

let model;
try {
  model = (await pool.query(MODEL_SQL)).rows[0]?.model;
} catch (error) {
  process.stderr.write('the database would not answer: ' + reasonOf(error) + '\n');
  await pool.end();
  process.exit(EXIT.DATABASE);
}
if (!model) {
  process.stderr.write('public.embedding_model() returned nothing.\n');
  await pool.end();
  process.exit(EXIT.DATABASE);
}

process.stdout.write(
  'embed-worker: ' + ROLE + ', model ' + model + ', polling every ' + intervalSeconds + 's'
    + (once ? ' (one tick)' : '') + '\n',
);

let totalDone = 0;
let totalFailed = 0;
let totalTokens = 0;
let consecutiveDatabaseErrors = 0;

for (;;) {
  let result;
  try {
    result = await tick(model);
    consecutiveDatabaseErrors = 0;
  } catch (error) {
    // Not one job's fault: the queue itself could not be read, or a retire
    // failed. Back off rather than spinning, and give up after a while so a
    // supervisor restarts the process rather than watching it churn.
    consecutiveDatabaseErrors += 1;
    process.stderr.write(
      'tick ' + consecutiveDatabaseErrors + ' failed: ' + reasonOf(error) + '\n',
    );
    if (consecutiveDatabaseErrors >= 5) {
      await pool.end();
      process.exit(EXIT.DATABASE);
    }
    await sleep(intervalSeconds * 1000);
    continue;
  }

  totalDone += result.done;
  totalFailed += result.failed;
  totalTokens += result.tokens;

  if (result.done > 0 || result.failed > 0) {
    process.stdout.write(
      new Date().toISOString() + '  retired ' + result.done
        + ', failed ' + result.failed
        + ', ' + result.tokens + ' tokens\n',
    );
  }

  if (once || stopping) break;

  // An empty tick waits; a full one goes straight round again, so a burst of
  // twenty listings does not take twenty intervals to clear. A provider that
  // is refusing everything waits too, rather than spinning through the same
  // batch as fast as the socket allows.
  if (result.done === 0 && result.failed === 0) {
    await sleep(intervalSeconds * 1000);
  } else if (result.capped || result.outage) {
    await sleep(intervalSeconds * 1000);
  }
}

process.stdout.write(
  'embed-worker: retired ' + totalDone + ', failed ' + totalFailed
    + ', ' + totalTokens + ' tokens, ' + Math.round((Date.now() - started) / 1000) + 's\n',
);

// The lock goes when the connection does, and the connection has to be handed
// back before the pool will close.
lockHolder.release();
await pool.end();
process.exit(totalDone === 0 && totalFailed > 0 ? EXIT.PROVIDER : EXIT.OK);
