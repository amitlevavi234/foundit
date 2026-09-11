#!/usr/bin/env node
// ===========================================================================
// Foundit — the embedding job.
//
//   node --env-file=.env.local scripts/embed.mjs
//   node --env-file=.env.local scripts/embed.mjs --dry-run
//
// Fills public.tool_problems.embedding for every problem statement on a
// published tool, using the model public.embedding_model() names, and does
// nothing at all on a second run because nothing changed.
//
// Four things about it are deliberate:
//
//   1. IT CONNECTS AS foundit_app, from DATABASE_URL, with no fallback to the
//      owner connection. A batch job is not an excuse to run as the role that
//      owns the schema; docs/development.md says there is deliberately no
//      fallback between the two, and a job that quietly reached for the owner
//      on the day somebody's environment was misconfigured would disable every
//      row-level security policy in the schema and look fine doing it.
//
//   2. IT WRITES THROUGH ONE SECURITY DEFINER FUNCTION. foundit_app cannot
//      update tool_problems: the policy from 0001 requires the caller to own
//      the listing, and this job has no identity — correctly, it is not a
//      person and must not set a request claim to pretend it is one. So the
//      write goes through public.store_problem_embedding, which can set three
//      columns and nothing else.
//
//   3. THE WORK PREDICATE IS ABOUT FRESHNESS, NOT ABOUT EMPTINESS. A row needs
//      work when it has never been embedded, when its statement changed after
//      it was embedded, or when it was embedded by a model this database no
//      longer uses. "embedding is null" alone would silently keep serving
//      vectors of text that has since been rewritten.
//
//   4. NOTHING IT PRINTS IS SENSITIVE. Counts, token usage and row ids. Never
//      the key, never a connection string, never a statement.
//
// Exit codes: 0 done (including "nothing to do"), 1 configuration, 2 the
// embedding provider, 3 the database.
// ===========================================================================
import pg from 'pg';

import {
  EMBEDDINGS_BATCH_SIZE,
  EmbeddingError,
  embedTexts,
  embeddingsConfigured,
} from '../lib/embeddings.ts';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3 };

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
for (const arg of args) {
  if (arg !== '--dry-run') {
    process.stderr.write(`unknown argument: ${arg}\n`);
    process.stderr.write('usage: node --env-file=.env.local scripts/embed.mjs [--dry-run]\n');
    process.exit(EXIT.CONFIG);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.trim() === '') {
  process.stderr.write(
    'DATABASE_URL is not set. It is the foundit_app connection string, and this job\n' +
      'reads it from the environment and nowhere else. There is no fallback to the\n' +
      'owner connection on purpose — see docs/development.md.\n',
  );
  process.exit(EXIT.CONFIG);
}

// The same refusal lib/db.ts makes. A misconfigured environment that handed
// this job the owner's credentials would work perfectly and bypass every
// policy in the schema while doing it.
try {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (user === 'foundit_owner' || user === 'postgres') {
    process.stderr.write(
      `DATABASE_URL connects as "${user}". The embedding job runs as foundit_app,\n` +
        'which owns nothing and bypasses nothing.\n',
    );
    process.exit(EXIT.CONFIG);
  }
} catch {
  // Not a URL that parses. pg will report it; nothing here repeats a string
  // that holds a password.
}

if (!embeddingsConfigured() && !dryRun) {
  process.stderr.write(
    'EMBEDDINGS_API_KEY is not set. It lives in .env.local, which is not committed;\n' +
      'run this as `node --env-file=.env.local scripts/embed.mjs`.\n',
  );
  process.exit(EXIT.CONFIG);
}

// Every statement this job sends. Two reads and one write, and the write is a
// function call.
const MODEL_SQL = 'select public.embedding_model() as model';

const WORK_SQL = `
  select tp.id, tp.statement
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   where tp.embedding is null
      or tp.embedded_at < tp.updated_at
      or tp.embedding_model is distinct from $1::text
   order by tp.id`;

// One round trip per batch rather than one per statement: the ids and the
// vectors go over as two arrays and unnest pairs them up.
const STORE_SQL = `
  select count(*) filter (where public.store_problem_embedding(x.id, x.embedding::halfvec, $3::text))
           as stored
    from unnest($1::bigint[], $2::text[]) as x(id, embedding)`;

const REMAINING_SQL = `
  select count(*) as n
    from public.tool_problems tp
    join public.tools t on t.id = tp.tool_id and t.status = 'published'
   where tp.embedding is null`;

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: 'foundit-embed',
  // Longer than the 5s default on the role: a batch write of 100 rows through
  // a definer function is still one statement.
  statement_timeout: 60_000,
});

let exitCode = EXIT.OK;

try {
  await client.connect();
} catch (error) {
  process.stderr.write(`could not connect to PostgreSQL: ${error.code ?? 'error'}\n`);
  process.exit(EXIT.DATABASE);
}

try {
  const { rows: modelRows } = await client.query(MODEL_SQL);
  const model = modelRows[0].model;

  const { rows: work } = await client.query(WORK_SQL, [model]);

  process.stdout.write(`model            ${model}\n`);
  process.stdout.write(`statements to do ${work.length}\n`);

  if (work.length === 0) {
    process.stdout.write('embedded         0 (nothing has changed)\n');
  } else if (dryRun) {
    process.stdout.write('embedded         0 (--dry-run: no request made, nothing written)\n');
  } else {
    let embedded = 0;
    let tokens = 0;
    let requests = 0;

    for (let i = 0; i < work.length; i += EMBEDDINGS_BATCH_SIZE) {
      const batch = work.slice(i, i + EMBEDDINGS_BATCH_SIZE);
      const result = await embedTexts(batch.map((row) => row.statement));
      requests += 1;
      tokens += result.tokens;

      const { rows } = await client.query(STORE_SQL, [
        batch.map((row) => row.id),
        result.vectors,
        result.model,
      ]);
      const stored = Number(rows[0].stored);
      embedded += stored;

      if (stored !== batch.length) {
        process.stdout.write(
          `  batch ${requests}: ${stored} of ${batch.length} rows written — ` +
            'a statement disappeared while the batch was in flight\n',
        );
      } else {
        process.stdout.write(`  batch ${requests}: ${stored} statements\n`);
      }
    }

    process.stdout.write(`embedded         ${embedded}\n`);
    process.stdout.write(`api requests     ${requests}\n`);
    process.stdout.write(`prompt tokens    ${tokens}\n`);
  }

  const { rows: remaining } = await client.query(REMAINING_SQL);
  process.stdout.write(`still unembedded ${remaining[0].n} (published statements)\n`);
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
