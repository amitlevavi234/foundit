#!/usr/bin/env node
// ===========================================================================
// Foundit — the embedding job.
//
//   node --env-file=.env.local scripts/embed.mjs
//   node --env-file=.env.local scripts/embed.mjs --dry-run
//   node --env-file=.env.local scripts/embed.mjs --from-fixture
//   node --env-file=.env.local scripts/embed.mjs --write-fixture
//
// Fills public.tool_problems.embedding for every problem statement on a
// published tool, using the model public.embedding_model() names, and does
// nothing at all on a second run because nothing changed.
//
// Five things about it are deliberate:
//
//   1. IT CONNECTS AS foundit_embed, from DATABASE_URL_EMBED, and refuses any
//      other role by name. Not foundit_app, and certainly not the owner.
//      db/migrations/0005_embed_role.sql explains why this is a role of its
//      own: the power to WRITE a vector onto a problem statement and the
//      power to ask which vector is nearest a cached query, held together,
//      read the query cache out one sign bit at a time. The application has
//      the second. This job has the first. Nothing has both.
//
//   2. IT TOUCHES NO TABLE. foundit_embed holds no grant on tool_problems, on
//      tools, on query_embeddings or on search_events. The queue comes from
//      public.problem_embedding_work and the write goes through
//      public.store_problem_embedding, and those two functions plus
//      public.embedding_model() are the whole of what this role may call.
//
//   3. THE WORK PREDICATE LIVES IN THE DATABASE, not here, so the job and the
//      index that serves it cannot drift apart. A row is work when it has
//      never been embedded, when its statement changed after it was embedded,
//      or when it was embedded by a model this database no longer uses.
//
//   4. THE DOCUMENT CAP IS NOT THE QUERY CAP. A query is capped at 200
//      characters because it comes from an anonymous endpoint; a statement is
//      capped at MAX_DOCUMENT_INPUT because the only risk there is one absurd
//      row costing a fortune in a batch nobody is watching. Anything this cuts
//      is printed with its row id rather than silently embedded as a prefix.
//
//   5. NOTHING IT PRINTS IS SENSITIVE. Counts, token usage and row ids. Never
//      the key, never a connection string, never a statement.
//
// Exit codes: 0 done (including "nothing to do"), 1 configuration, 2 the
// embedding provider, 3 the database, 4 the fixture.
// ===========================================================================
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  EMBEDDINGS_BATCH_SIZE,
  EmbeddingError,
  MAX_DOCUMENT_INPUT,
  embedTexts,
  embeddingsConfigured,
  fromFloat16Base64,
  normalizeQuery,
  toFloat16Base64,
} from '../lib/embeddings.ts';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3, FIXTURE: 4 };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'db', 'seed', 'embeddings.fixture.json');
const GOLDEN_PATH = join(ROOT, 'eval', 'golden.jsonl');

/** The role this job runs as, and the only one it will accept. */
const ROLE = 'foundit_embed';
const URL_VARIABLE = 'DATABASE_URL_EMBED';

const KNOWN = new Set(['--dry-run', '--from-fixture', '--write-fixture']);
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!KNOWN.has(arg)) {
    process.stderr.write(`unknown argument: ${arg}\n`);
    process.stderr.write(
      'usage: node --env-file=.env.local scripts/embed.mjs '
        + '[--dry-run | --from-fixture | --write-fixture]\n',
    );
    process.exit(EXIT.CONFIG);
  }
}
const dryRun = args.has('--dry-run');
const fromFixture = args.has('--from-fixture');
const writeFixture = args.has('--write-fixture');

if ([dryRun, fromFixture, writeFixture].filter(Boolean).length > 1) {
  process.stderr.write('--dry-run, --from-fixture and --write-fixture are three different jobs.\n');
  process.exit(EXIT.CONFIG);
}

const databaseUrl = process.env[URL_VARIABLE];
if (!databaseUrl || databaseUrl.trim() === '') {
  process.stderr.write(
    `${URL_VARIABLE} is not set. It is the ${ROLE} connection string, and this job\n`
      + 'reads it from the environment and nowhere else. There is no fallback to the\n'
      + 'application or owner connections on purpose — see docs/development.md.\n',
  );
  process.exit(EXIT.CONFIG);
}

// The role is checked by name, not hoped for. A connection string pasted into
// the wrong variable would otherwise work perfectly and quietly hand this job
// the application's privileges — which is the exact pairing 0005 exists to
// keep apart.
try {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (user !== ROLE) {
    process.stderr.write(
      `${URL_VARIABLE} connects as "${user}". The embedding job runs as ${ROLE}, which\n`
        + 'holds two function grants and no table privilege of any kind.\n'
        + 'See db/migrations/0005_embed_role.sql for why this is not interchangeable.\n',
    );
    process.exit(EXIT.CONFIG);
  }
} catch {
  process.stderr.write(`${URL_VARIABLE} is not a connection string this job can parse.\n`);
  process.exit(EXIT.CONFIG);
}

const needsApi = !dryRun && !fromFixture;
if (needsApi && !embeddingsConfigured()) {
  process.stderr.write(
    'EMBEDDINGS_API_KEY is not set. It lives in .env.local, which is not committed;\n'
      + 'run this as `node --env-file=.env.local scripts/embed.mjs`.\n'
      + 'To load the recorded vectors instead, and call nothing: --from-fixture.\n',
  );
  process.exit(EXIT.CONFIG);
}

// Every statement this job sends. One read, one write, both function calls.
const MODEL_SQL = 'select public.embedding_model() as model';

const WORK_SQL = 'select id, statement from public.problem_embedding_work()';

// One round trip per batch rather than one per statement: the ids and the
// vectors go over as two arrays and unnest pairs them up.
const STORE_SQL = `
  select count(*) filter (where public.store_problem_embedding(x.id, x.embedding::halfvec, $3::text))
           as stored
    from unnest($1::bigint[], $2::text[]) as x(id, embedding)`;

/** sha256 of a statement, hex. The fixture's key, and its staleness check. */
const digest = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');

/**
 * The sentences eval/run.mjs will search with, for --write-fixture. Ids and
 * grades are not read.
 *
 * TWO texts per golden entry, not one. The default pass searches the sentence
 * as written; `--read-query` searches what lib/constraints.ts leaves once the
 * constraint phrases are taken out, and that is a different string with a
 * different cache key. A fixture holding only the first makes a keyless
 * `--read-query` run measure a derived slice that is half text-only — which is
 * not wrong, exactly, but it is a number nobody can interpret.
 *
 * The reader is loaded through eval/reader.mjs, which is the one file in the
 * repository that names it, so Phase 4 replacing lib/constraints.ts wholesale
 * changes one import and not this. If it cannot be loaded the fixture is
 * written without the derived texts and says so.
 */
async function evalQueries() {
  const authored = [];
  for (const line of readFileSync(GOLDEN_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const obj = JSON.parse(trimmed);
    if (typeof obj.query === 'string' && obj.query.trim() !== '') authored.push(obj.query);
  }

  let derived = [];
  try {
    const { readForSearch } = await import('../eval/reader.mjs');
    derived = authored.map((q) => readForSearch(q).text).filter((t) => t.trim() !== '');
  } catch (error) {
    process.stdout.write(
      `  NOTE: the sentence reader did not load (${error?.code ?? 'error'}), so the fixture\n`
        + '        carries no vectors for the --read-query pass.\n',
    );
  }

  return { authored, derived };
}

function readFixture() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  } catch (error) {
    process.stderr.write(
      `could not read ${FIXTURE_PATH.slice(ROOT.length + 1)}: ${error.code ?? 'error'}\n`
        + 'Run `scripts/embed.mjs --write-fixture` with a key to record it.\n',
    );
    process.exit(EXIT.FIXTURE);
  }
  if (parsed?.schema !== 'foundit-embeddings/1') {
    process.stderr.write(`the fixture's schema is ${parsed?.schema ?? '(missing)'}, not foundit-embeddings/1\n`);
    process.exit(EXIT.FIXTURE);
  }
  return parsed;
}

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: 'foundit-embed',
  // Longer than the 5s default on the application role: a batch write of 100
  // rows through a definer function is still one statement.
  statement_timeout: 60_000,
});

let exitCode = EXIT.OK;

try {
  await client.connect();
} catch (error) {
  process.stderr.write(`could not connect to PostgreSQL as ${ROLE}: ${error.code ?? 'error'}\n`);
  if (error.code === '28P01' || error.code === '28000') {
    process.stderr.write(
      `  ${ROLE} exists but cannot log in with that password. The migrations create it\n`
        + '  without one, on purpose. db/docker-compose.dev.yml sets it in development and\n'
        + '  server/setup/09-postgres-service.sh sets it on the server.\n',
    );
  }
  process.exit(EXIT.DATABASE);
}

try {
  const { rows: modelRows } = await client.query(MODEL_SQL);
  const model = modelRows[0].model;

  const { rows: work } = await client.query(WORK_SQL);

  process.stdout.write(`role             ${(await client.query('select current_user')).rows[0].current_user}\n`);
  process.stdout.write(`model            ${model}\n`);
  process.stdout.write(`statements to do ${work.length}\n`);

  // --- writing the fixture is its own job -----------------------------------
  if (writeFixture) {
    // Deliberately NOT read back out of the database: no query in this
    // codebase selects an embedding column, and this one is not going to be
    // the exception. The fixture is embedded fresh from the same text the
    // database holds, which is the same vector by construction.
    //
    // The queue is the only thing this role can read, and it lists what is
    // OUTSTANDING — so a fixture is written from a freshly seeded database,
    // where everything is outstanding, and never from a filled one. Identical
    // statements on two different tools collapse to one entry, because the key
    // is the hash of the text.
    const statements = new Map();
    for (const row of work) statements.set(row.statement, null);
    if (statements.size === 0) {
      process.stderr.write(
        '\nThere is no outstanding work, so there are no statements to record.\n'
          + 'A fixture is written from a database whose embeddings are NOT yet filled:\n'
          + '  node db/apply.mjs --fresh --seed && node --env-file=.env.local \\\n'
          + '    scripts/embed.mjs --write-fixture\n',
      );
      exitCode = EXIT.FIXTURE;
    } else {
      const { authored, derived } = await evalQueries();
      const queries = [...authored, ...derived];
      process.stdout.write(`golden queries   ${authored.length} as written, ${derived.length} as read\n`);

      const fixture = {
        schema: 'foundit-embeddings/1',
        model,
        dimensions: 512,
        recorded: new Date().toISOString().slice(0, 10),
        // Keyed by the sha256 of the statement: a statement that is later
        // rewritten no longer hashes to its entry, so --from-fixture skips it
        // and says how many it skipped rather than loading a vector of text
        // that no longer exists.
        statements: {},
        // Keyed by the normalised query, which is exactly the query cache's
        // own key.
        queries: {},
      };

      let requests = 0;
      let tokens = 0;

      const texts = [...statements.keys()];
      for (let i = 0; i < texts.length; i += EMBEDDINGS_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBEDDINGS_BATCH_SIZE);
        const result = await embedTexts(batch, { cap: MAX_DOCUMENT_INPUT });
        requests += 1;
        tokens += result.tokens;
        batch.forEach((text, n) => {
          fixture.statements[digest(text)] = result.vectors[n];
        });
      }

      const keys = [...new Set(queries.map((q) => normalizeQuery(q)).filter((q) => q !== ''))];
      for (let i = 0; i < keys.length; i += EMBEDDINGS_BATCH_SIZE) {
        const batch = keys.slice(i, i + EMBEDDINGS_BATCH_SIZE);
        const result = await embedTexts(batch);
        requests += 1;
        tokens += result.tokens;
        batch.forEach((text, n) => {
          fixture.queries[text] = result.vectors[n];
        });
      }

      // The vectors come back as halfvec literals; the fixture stores float16
      // bytes, which is what a halfvec column actually holds, and is a third
      // of the size as text.
      for (const map of [fixture.statements, fixture.queries]) {
        for (const [key, literal] of Object.entries(map)) {
          map[key] = toFloat16Base64(literal.slice(1, -1).split(',').map(Number));
        }
      }

      writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture)}\n`, 'utf8');
      const bytes = readFileSync(FIXTURE_PATH).byteLength;
      process.stdout.write(`\nwrote            db/seed/embeddings.fixture.json\n`);
      process.stdout.write(`  statements     ${Object.keys(fixture.statements).length}\n`);
      process.stdout.write(`  queries        ${Object.keys(fixture.queries).length}\n`);
      process.stdout.write(`  size           ${(bytes / 1024).toFixed(0)} kB\n`);
      process.stdout.write(`  api requests   ${requests}\n`);
      process.stdout.write(`  prompt tokens  ${tokens}\n`);
    }
  } else if (work.length === 0) {
    process.stdout.write('embedded         0 (nothing has changed)\n');
  } else if (dryRun) {
    process.stdout.write('embedded         0 (--dry-run: no request made, nothing written)\n');
  } else if (fromFixture) {
    // --- the recorded vectors, no network -----------------------------------
    const fixture = readFixture();
    if (fixture.model !== model) {
      process.stderr.write(
        `\nthe fixture was recorded from ${fixture.model} and this database uses ${model}.\n`
          + 'Re-record it with --write-fixture, or change public.embedding_model() back.\n',
      );
      exitCode = EXIT.FIXTURE;
    } else {
      let embedded = 0;
      let skipped = 0;

      for (let i = 0; i < work.length; i += EMBEDDINGS_BATCH_SIZE) {
        const batch = work.slice(i, i + EMBEDDINGS_BATCH_SIZE);
        const ids = [];
        const vectors = [];
        for (const row of batch) {
          const recorded = fixture.statements[digest(row.statement)];
          if (recorded === undefined) {
            skipped += 1;
            continue;
          }
          ids.push(row.id);
          vectors.push(fromFloat16Base64(recorded));
        }
        if (ids.length === 0) continue;
        const { rows } = await client.query(STORE_SQL, [ids, vectors, fixture.model]);
        embedded += Number(rows[0].stored);
      }

      process.stdout.write(`embedded         ${embedded} (from the fixture; no request made)\n`);
      if (skipped > 0) {
        process.stdout.write(
          `SKIPPED          ${skipped} statement(s) are not in the fixture, or have been\n`
            + '                 rewritten since it was recorded. They have no vector and will\n'
            + '                 not be found by the vector leg. Re-record with --write-fixture.\n',
        );
      }
    }
  } else {
    // --- the ordinary job ---------------------------------------------------
    let embedded = 0;
    let tokens = 0;
    let requests = 0;

    for (let i = 0; i < work.length; i += EMBEDDINGS_BATCH_SIZE) {
      const batch = work.slice(i, i + EMBEDDINGS_BATCH_SIZE);
      const result = await embedTexts(
        batch.map((row) => row.statement),
        { cap: MAX_DOCUMENT_INPUT },
      );
      requests += 1;
      tokens += result.tokens;

      // Anything the document cap cut is named, with its row id, rather than
      // embedded as a prefix of itself and forgotten.
      for (const n of result.truncated) {
        process.stdout.write(
          `  WARNING: statement ${batch[n].id} is longer than ${MAX_DOCUMENT_INPUT} characters `
            + 'and was cut before embedding\n',
        );
      }

      const { rows } = await client.query(STORE_SQL, [
        batch.map((row) => row.id),
        result.vectors,
        result.model,
      ]);
      const stored = Number(rows[0].stored);
      embedded += stored;

      if (stored !== batch.length) {
        process.stdout.write(
          `  batch ${requests}: ${stored} of ${batch.length} rows written — `
            + 'a statement disappeared while the batch was in flight\n',
        );
      } else {
        process.stdout.write(`  batch ${requests}: ${stored} statements\n`);
      }
    }

    process.stdout.write(`embedded         ${embedded}\n`);
    process.stdout.write(`api requests     ${requests}\n`);
    process.stdout.write(`prompt tokens    ${tokens}\n`);
  }

  // The queue is the only thing this role can read, so "how much is left" is
  // asked the same way "what is left" was.
  const { rows: remaining } = await client.query(WORK_SQL);
  process.stdout.write(`still to do      ${remaining.length} (published statements)\n`);
} catch (error) {
  if (error instanceof EmbeddingError) {
    // The reason and nothing else: EmbeddingError is built to carry no key, no
    // response body and no input.
    process.stderr.write(`the embedding provider failed: ${error.message}\n`);
    exitCode = EXIT.PROVIDER;
  } else {
    process.stderr.write(`database error: ${error.message}\n`);
    for (const field of ['detail', 'hint', 'where']) {
      if (error[field]) process.stderr.write(`  ${field}: ${error[field]}\n`);
    }
    exitCode = EXIT.DATABASE;
  }
} finally {
  await client.end();
}

// Not process.exit(): the writes above go to a pipe on Windows and exiting
// outright can cut the last line off.
process.exitCode = exitCode;
