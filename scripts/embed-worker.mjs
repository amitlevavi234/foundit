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
// SIX THINGS ABOUT IT ARE DELIBERATE, and the first three are 0005's.
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
//   4. A BAD ROW DOES NOT STOP THE RUN. Three kinds, and each is handled
//      rather than thrown: a job whose row has been deleted or whose tool has
//      been unpublished comes back with a null body and is retired; a job the
//      provider refuses is recorded with its reason and retried twice before
//      being parked; and a batch that fails as a whole is recorded against
//      every job in it, so one absurd statement cannot hold the other
//      thirty-one behind it forever.
//
//   5. IT SPENDS AGAINST THE SAME DAILY CAP. lib/rate-limit.ts's
//      mayCallEmbeddings is what MAX_EMBEDDING_CALLS_PER_DAY means, and this
//      asks it before every request. The counter is per PROCESS, so this
//      worker and the web process each hold their own — written down in
//      docs/loop-progress.md as a known weakness rather than glossed. The
//      vendor-side cap is the ceiling that is actually shared.
//
//   6. NOTHING IT PRINTS IS SENSITIVE. Job ids, counts, tokens and elapsed
//      milliseconds. Never the key, never a connection string, and never the
//      text of a statement — a maker's unpublished problem statement is not
//      log material.
//
// Exit codes: 0 done or asked to stop, 1 configuration, 2 the embedding
// provider refused everything, 3 the database.
// ===========================================================================
import pg from 'pg';

import {
  EMBEDDINGS_BATCH_SIZE,
  EmbeddingError,
  MAX_DOCUMENT_INPUT,
  embedTexts,
  embeddingsConfigured,
} from '../lib/embeddings.ts';
import { mayCallEmbeddings } from '../lib/rate-limit.ts';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3 };

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

/** How many jobs to take per tick. One API request holds a hundred. */
const BATCH = Math.min(32, EMBEDDINGS_BATCH_SIZE);

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

if (!embeddingsConfigured()) {
  process.stderr.write(
    'EMBEDDINGS_API_KEY is not set. It lives in .env.local, which is not committed;\n'
      + 'run this as `node --env-file=.env.local scripts/embed-worker.mjs`.\n'
      + 'With no key there is nothing this worker can do: unlike scripts/embed.mjs it\n'
      + 'has no fixture to read, because a queue is about text nobody has seen before.\n',
  );
  process.exit(EXIT.CONFIG);
}

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
  max: 2,
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

  if (!mayCallEmbeddings(1)) {
    // The daily cap. Nothing is marked failed — the work is still work, and
    // tomorrow it will be done. Said once per tick and no more.
    process.stdout.write(
      'the daily embedding cap is spent; ' + live.length + ' job(s) left in the queue\n',
    );
    return { done: retired, failed, tokens: 0, capped: true };
  }

  let batch;
  try {
    batch = await embedTexts(
      live.map((row) => String(row.body)),
      { cap: MAX_DOCUMENT_INPUT },
    );
  } catch (error) {
    // The whole request failed. Every job in it gets the reason, which is what
    // moves them towards being parked instead of retried forever.
    const reason = reasonOf(error);
    for (const row of live) {
      await pool.query(FAILED_SQL, [row.job_id, reason]);
      failed += 1;
    }
    process.stdout.write(
      'a batch of ' + live.length + ' failed and was recorded against each job\n',
    );
    return { done: retired, failed, tokens: 0 };
  }

  if (batch.model !== model) {
    // Loud, and nothing is stored: the setters would refuse it anyway (0005,
    // 0007), and a table holding vectors from two spaces is a search quietly
    // getting worse.
    const reason = 'provider returned model ' + batch.model + ', not ' + model;
    for (const row of live) {
      await pool.query(FAILED_SQL, [row.job_id, reason]);
      failed += 1;
    }
    process.stderr.write(reason + '\n');
    return { done: retired, failed, tokens: batch.tokens };
  }

  // Truncated inputs are recorded as failures rather than stored. A vector of
  // a prefix filed under the whole statement is a search that is subtly wrong
  // forever, which is worse than a statement with no vector at all.
  const cut = new Set(batch.truncated);
  for (const index of cut) {
    await pool.query(FAILED_SQL, [
      live[index].job_id,
      'longer than ' + MAX_DOCUMENT_INPUT + ' characters; not stored',
    ]);
    failed += 1;
  }

  for (const kind of ['problem', 'tool']) {
    const ids = [];
    const vectors = [];
    const jobs = [];
    live.forEach((row, index) => {
      if (row.kind !== kind || cut.has(index)) return;
      ids.push(row.ref_id);
      vectors.push(batch.vectors[index]);
      jobs.push(row.job_id);
    });
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

  return { done: retired, failed, tokens: batch.tokens };
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
  // twenty listings does not take twenty intervals to clear.
  if (result.done === 0 && result.failed === 0) {
    await sleep(intervalSeconds * 1000);
  } else if (result.capped) {
    await sleep(intervalSeconds * 1000);
  }
}

process.stdout.write(
  'embed-worker: retired ' + totalDone + ', failed ' + totalFailed
    + ', ' + totalTokens + ' tokens, ' + Math.round((Date.now() - started) / 1000) + 's\n',
);

await pool.end();
process.exit(totalDone === 0 && totalFailed > 0 ? EXIT.PROVIDER : EXIT.OK);
