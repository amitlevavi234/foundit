#!/usr/bin/env node
// ===========================================================================
// Foundit — the embedding job.
//
//   node --env-file=.env.local scripts/embed.mjs
//   node --env-file=.env.local scripts/embed.mjs --dry-run
//   node --env-file=.env.local scripts/embed.mjs --from-fixture
//   node --env-file=.env.local scripts/embed.mjs --write-fixture
//
// Fills the two embedding columns this database has — every published tool's
// summary (public.tools.embedding, added in 0007) and every problem statement
// on a published tool (public.tool_problems.embedding) — using the model
// public.embedding_model() names, and does nothing at all on a second run
// because nothing changed.
//
// Six things about it are deliberate:
//
//   1. IT CONNECTS AS foundit_embed, from DATABASE_URL_EMBED, and refuses any
//      other role by name. Not foundit_app, and certainly not the owner.
//      db/migrations/0005_embed_role.sql explains why this is a role of its
//      own: the power to WRITE a vector and the power to ask which vector is
//      nearest a cached query, held together, read the query cache out one
//      sign bit at a time. The application has the second. This job has the
//      first. Nothing has both.
//
//   2. IT TOUCHES NO TABLE. foundit_embed holds no grant on tools, on
//      tool_problems, on query_embeddings or on search_events. The two queues
//      come from public.problem_embedding_work and public.tool_embedding_work,
//      the writes go through public.store_problem_embedding and
//      public.store_tool_embedding, and the fixture is written from
//      public.embedding_corpus. Those five functions plus
//      public.embedding_model() are the whole of what this role may call.
//
//   3. THE WORK PREDICATE LIVES IN THE DATABASE, not here, so the job and the
//      indexes that serve it cannot drift apart. A row is work when it has
//      never been embedded, when its text changed after it was embedded, or
//      when it was embedded by a model this database no longer uses.
//
//   4. THE DOCUMENT CAP IS NOT THE QUERY CAP, and a document that hits it is
//      never recorded. A query is capped at 200 characters because it comes
//      from an anonymous endpoint; a document is capped at MAX_DOCUMENT_INPUT
//      because one absurd row should not cost a fortune in a batch nobody is
//      watching. The ordinary job prints the id of anything it cuts;
//      --write-fixture REFUSES to record it, because a fixture entry is keyed
//      by the hash of the full text and would hand every later run the vector
//      of a prefix under the name of the whole.
//
//   5. THE FIXTURE IS WRITTEN FROM THE CORPUS, NOT THE QUEUE. The queue lists
//      what is outstanding, so on a filled database it is empty — and the
//      guard that used to notice that only worked when there was no fixture
//      yet. public.embedding_corpus() lists every text whether or not it is
//      embedded, so a fixture can be written or extended from any database.
//
//   6. NOTHING IT PRINTS IS SENSITIVE. Counts, token usage and row ids. Never
//      the key, never a connection string, never a statement.
//
// Exit codes: 0 done (including "nothing to do"), 1 configuration, 2 the
// embedding provider, 3 the database, 4 the fixture.
// ===========================================================================
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { perturbedTexts } from '../eval/perturb.mjs';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3, FIXTURE: 4 };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'db', 'seed', 'embeddings.fixture.json');

/**
 * Every file of sentences the eval searches with. All three are required: a
 * missing one is a smaller fixture and a keyless run that measures a different
 * thing, which is precisely the failure the fixture exists to prevent.
 */
const SENTENCE_FILES = [
  join(ROOT, 'eval', 'golden.jsonl'),
  join(ROOT, 'eval', 'negatives.jsonl'),
  join(ROOT, 'eval', 'negatives.review.jsonl'),
];

/** The fixture format. Bumped in 0007, when tool summaries joined it. */
const FIXTURE_SCHEMA = 'foundit-embeddings/3';

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
// the application's privileges — which is the exact pairing 0005 keeps apart.
try {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (user !== ROLE) {
    process.stderr.write(
      `${URL_VARIABLE} connects as "${user}". The embedding job runs as ${ROLE}, which\n`
        + 'holds five function grants and no table privilege of any kind.\n'
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

// Every statement this job sends. Two reads, two writes, one corpus — all of
// them function calls, because this role may not touch a table.
const MODEL_SQL = 'select public.embedding_model() as model';
const PROBLEM_WORK_SQL = 'select id, statement as body from public.problem_embedding_work()';
const TOOL_WORK_SQL = 'select id, summary as body from public.tool_embedding_work()';
const CORPUS_SQL = 'select kind, id, body from public.embedding_corpus()';

// One round trip per batch rather than one per row: the ids and the vectors go
// over as two arrays and unnest pairs them up.
const STORE_PROBLEM_SQL = `
  select count(*) filter (where public.store_problem_embedding(x.id, x.embedding::halfvec, $3::text))
           as stored
    from unnest($1::bigint[], $2::text[]) as x(id, embedding)`;

const STORE_TOOL_SQL = `
  select count(*) filter (where public.store_tool_embedding(x.id, x.embedding::halfvec, $3::text))
           as stored
    from unnest($1::bigint[], $2::text[]) as x(id, embedding)`;

/** sha256 of a text, hex. The fixture's key, and its staleness check. */
const digest = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');

/** Which map in the fixture a corpus row belongs in. */
const mapFor = (fixture, kind) => (kind === 'tool' ? fixture.tools : fixture.statements);

/**
 * Every sentence eval/run.mjs will search with, for --write-fixture.
 *
 * Four kinds, and all four have to be here or a keyless run measures
 * something different from a run with a key:
 *
 *   the golden set as written           the default pass
 *   the negatives, both files           the relevance floor's other half
 *   every sentence as lib/constraints.ts reads it   the --read-query pass
 *   four mechanical variants of each golden query   the perturbation gate
 *
 * The reader is reached through eval/reader.mjs, the one file in the
 * repository that names lib/constraints.ts, so Phase 4 replacing it wholesale
 * changes an import and not this. If it cannot be loaded the fixture is
 * written without the derived sentences and says so loudly.
 */
async function evalSentences() {
  const authored = [];
  for (const file of SENTENCE_FILES) {
    if (!existsSync(file)) {
      process.stderr.write(
        `\n${file.slice(ROOT.length + 1)} is missing.\n`
          + 'Every sentence the eval searches with has to be in the fixture, or a keyless\n'
          + 'run measures a different search from a run with a key. Restore the file, or\n'
          + 'remove it from SENTENCE_FILES on purpose.\n',
      );
      process.exit(EXIT.FIXTURE);
    }
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const obj = JSON.parse(trimmed);
      // The golden set and eval/negatives.jsonl say "query"; the held-out
      // review set says "q". Both are read; neither file is edited.
      const text = typeof obj.query === 'string' ? obj.query : obj.q;
      if (typeof text === 'string' && text.trim() !== '') authored.push(text);
    }
  }

  // Perturbations are of the golden set only: they measure whether a real
  // question survives being typed slightly differently.
  const golden = [];
  for (const line of readFileSync(SENTENCE_FILES[0], 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const obj = JSON.parse(trimmed);
    if (typeof obj.query === 'string' && obj.query.trim() !== '') golden.push(obj.query);
  }
  const perturbed = perturbedTexts(golden);

  let derived = [];
  try {
    const { readForSearch, fixtureReadings } = await import('../eval/reader.mjs');
    // Since Phase 4 the shipped path embeds `embedText`, which is not the
    // searched text: for a non-English sentence it is the sentence fused with
    // the model's English restatement. So the fixture needs a vector for BOTH,
    // and for the perturbations as well as the sentences — the perturbation
    // gate now measures the reader, not only the floor.
    //
    // The readings come out of this same fixture, which is why
    // scripts/read.mjs --write-fixture has to run BEFORE this: with no reading
    // there is no restatement, no fused text, and no vector recorded for it.
    const readings = fixtureReadings();
    const plans = [...authored, ...perturbed].map((q) =>
      readForSearch(q, readings[normalizeQuery(q)] ?? null),
    );
    derived = plans
      .flatMap((plan) => [plan.text, plan.embedText])
      .filter((t) => typeof t === 'string' && t.trim() !== '');
  } catch (error) {
    process.stdout.write(
      `  NOTE: the sentence reader did not load (${error?.code ?? 'error'}), so the fixture\n`
        + '        carries no vectors for the --read-query pass.\n',
    );
  }

  return { authored, derived, perturbed };
}

function readFixture({ required = true } = {}) {
  if (!existsSync(FIXTURE_PATH)) {
    if (!required) return null;
    process.stderr.write(
      `could not read ${FIXTURE_PATH.slice(ROOT.length + 1)}\n`
        + 'Run `scripts/embed.mjs --write-fixture` with a key to record it.\n',
    );
    process.exit(EXIT.FIXTURE);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  } catch (error) {
    process.stderr.write(
      `could not read ${FIXTURE_PATH.slice(ROOT.length + 1)}: ${error.code ?? 'error'}\n`,
    );
    process.exit(EXIT.FIXTURE);
  }
  if (parsed?.schema !== FIXTURE_SCHEMA) {
    process.stderr.write(
      `the fixture's schema is ${parsed?.schema ?? '(missing)'}, not ${FIXTURE_SCHEMA}.\n`
        + 'A fixture recorded before 0007 has no tool-summary vectors, so loading it would\n'
        + 'leave half the vector leg empty and the measurement would be of neither search.\n'
        + 'Re-record it: scripts/embed.mjs --write-fixture.\n',
    );
    process.exit(EXIT.FIXTURE);
  }
  parsed.statements ??= {};
  parsed.tools ??= {};
  parsed.queries ??= {};
  // Phase 4's half of the same file. This job never writes it — scripts/read.mjs
  // does — but it must survive a round trip through here untouched.
  parsed.readings ??= {};
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

/** Embed a list of texts and write them back through one definer setter. */
async function fill(rows, storeSql, label) {
  let embedded = 0;
  let tokens = 0;
  let requests = 0;

  for (let i = 0; i < rows.length; i += EMBEDDINGS_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBEDDINGS_BATCH_SIZE);
    const result = await embedTexts(batch.map((row) => row.body), { cap: MAX_DOCUMENT_INPUT });
    requests += 1;
    tokens += result.tokens;

    // Anything the document cap cut is named, with its row id, rather than
    // embedded as a prefix of itself and forgotten.
    for (const n of result.truncated) {
      process.stdout.write(
        `  WARNING: ${label} ${batch[n].id} is longer than ${MAX_DOCUMENT_INPUT} characters `
          + 'and was cut before embedding\n',
      );
    }

    const { rows: out } = await client.query(storeSql, [
      batch.map((row) => row.id),
      result.vectors,
      result.model,
    ]);
    const stored = Number(out[0].stored);
    embedded += stored;

    if (stored !== batch.length) {
      process.stdout.write(
        `  batch ${requests}: ${stored} of ${batch.length} ${label} rows written — `
          + 'a row disappeared while the batch was in flight\n',
      );
    } else {
      process.stdout.write(`  batch ${requests}: ${stored} ${label}s\n`);
    }
  }

  return { embedded, tokens, requests };
}

try {
  const { rows: modelRows } = await client.query(MODEL_SQL);
  const model = modelRows[0].model;

  const { rows: problemWork } = await client.query(PROBLEM_WORK_SQL);
  const { rows: toolWork } = await client.query(TOOL_WORK_SQL);

  process.stdout.write(`role             ${(await client.query('select current_user')).rows[0].current_user}\n`);
  process.stdout.write(`model            ${model}\n`);
  process.stdout.write(`statements to do ${problemWork.length}\n`);
  process.stdout.write(`summaries to do  ${toolWork.length}\n`);

  // --- writing the fixture is its own job -----------------------------------
  if (writeFixture) {
    // Deliberately NOT read back out of the database: no query in this
    // codebase selects an embedding column, and this one is not going to be
    // the exception. The fixture is embedded fresh from the same text the
    // database holds, which is the same vector by construction.
    //
    // Extending, never re-recording. A vector already in the file is left
    // exactly as it is: re-fetching the same text returns float32 that rounds
    // into float16 differently, two tools swap on a tie, and the headline
    // moves in the fourth decimal for a reason nobody changed.
    const existing = readFixture({ required: false });
    if (existing && existing.model !== model) {
      process.stderr.write(
        `\nthe fixture was recorded from ${existing.model} and this database uses ${model}.\n`
          + 'Vectors from two models cannot share a file. Move the old fixture aside and\n'
          + 're-record from a freshly seeded database.\n',
      );
      exitCode = EXIT.FIXTURE;
    } else {
      const fixture = existing ?? {
        schema: FIXTURE_SCHEMA,
        model,
        dimensions: 512,
        recorded: new Date().toISOString().slice(0, 10),
        // Keyed by the sha256 of the text: a statement or summary that is
        // later rewritten no longer hashes to its entry, so --from-fixture
        // skips it and says so rather than loading the vector of text that no
        // longer exists.
        statements: {},
        tools: {},
        // Keyed by the normalised query, which is the query cache's own key.
        queries: {},
      };

      const { rows: corpus } = await client.query(CORPUS_SQL);
      const missing = corpus.filter((row) => mapFor(fixture, row.kind)[digest(row.body)] === undefined);

      const { authored, derived, perturbed } = await evalSentences();
      const keys = [
        ...new Set(
          [...authored, ...derived, ...perturbed].map((q) => normalizeQuery(q)).filter((q) => q !== ''),
        ),
      ].filter((key) => fixture.queries[key] === undefined);

      process.stdout.write(`mode             ${existing ? 'extending the existing fixture' : 'recording a new fixture'}\n`);
      process.stdout.write(`corpus           ${corpus.length} texts (${missing.length} not yet recorded)\n`);
      process.stdout.write(`eval sentences   ${authored.length} as written, ${derived.length} as read, ${perturbed.length} perturbed\n`);
      process.stdout.write(`  new sentences  ${keys.length}\n`);

      let requests = 0;
      let tokens = 0;
      let refused = 0;

      // The vectors come back as halfvec literals; the fixture stores float16
      // bytes, which is what a halfvec column actually holds.
      const pack = (literal) => toFloat16Base64(literal.slice(1, -1).split(',').map(Number));

      for (let i = 0; i < missing.length && exitCode === EXIT.OK; i += EMBEDDINGS_BATCH_SIZE) {
        const batch = missing.slice(i, i + EMBEDDINGS_BATCH_SIZE);
        const result = await embedTexts(batch.map((row) => row.body), { cap: MAX_DOCUMENT_INPUT });
        requests += 1;
        tokens += result.tokens;

        // A truncated document must never be recorded: the entry would be keyed
        // by the hash of the whole text and hold the vector of a prefix, and
        // every later --from-fixture run would load it as if it were the whole.
        if (result.truncated.length > 0) {
          for (const n of result.truncated) {
            process.stderr.write(
              `  REFUSED: ${batch[n].kind} ${batch[n].id} is longer than ${MAX_DOCUMENT_INPUT} `
                + 'characters, so its vector would be of a prefix under the name of the whole\n',
            );
            refused += 1;
          }
          exitCode = EXIT.FIXTURE;
          break;
        }

        batch.forEach((row, n) => {
          mapFor(fixture, row.kind)[digest(row.body)] = pack(result.vectors[n]);
        });
      }

      if (exitCode === EXIT.OK) {
        // The query side's tokens are accumulated separately from the corpus
        // side's, because only this half is a per-search cost: eval/run.mjs
        // prices a search from it, and a document batch is a one-off job.
        let queryTokens = 0;
        let queryCount = 0;
        for (let i = 0; i < keys.length; i += EMBEDDINGS_BATCH_SIZE) {
          const batch = keys.slice(i, i + EMBEDDINGS_BATCH_SIZE);
          const result = await embedTexts(batch);
          requests += 1;
          tokens += result.tokens;
          queryTokens += result.tokens;
          queryCount += batch.length;
          batch.forEach((text, n) => {
            fixture.queries[text] = pack(result.vectors[n]);
          });
        }
        if (queryCount > 0) {
          const prior = fixture.queryTokens ?? { in: 0, sentences: 0 };
          fixture.queryTokens = {
            in: prior.in + queryTokens,
            sentences: prior.sentences + queryCount,
          };
        }

        if (requests === 0) {
          process.stdout.write('\nnothing to add   the fixture already holds every text and sentence\n');
        } else {
          if (existing) fixture.extended = new Date().toISOString().slice(0, 10);
          writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture)}\n`, 'utf8');
          const bytes = readFileSync(FIXTURE_PATH).byteLength;
          process.stdout.write(`\nwrote            db/seed/embeddings.fixture.json\n`);
          process.stdout.write(`  statements     ${Object.keys(fixture.statements).length}\n`);
          process.stdout.write(`  tools          ${Object.keys(fixture.tools).length}\n`);
          process.stdout.write(`  queries        ${Object.keys(fixture.queries).length}\n`);
          process.stdout.write(`  size           ${(bytes / 1024).toFixed(0)} kB\n`);
          process.stdout.write(`  api requests   ${requests}\n`);
          process.stdout.write(`  prompt tokens  ${tokens}\n`);
        }
      } else {
        process.stderr.write(`\nnothing was written: ${refused} text(s) are too long to record.\n`);
      }
    }
  } else if (problemWork.length === 0 && toolWork.length === 0) {
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

      for (const [rows, storeSql, kind, label] of [
        [problemWork, STORE_PROBLEM_SQL, 'problem', 'statement'],
        [toolWork, STORE_TOOL_SQL, 'tool', 'summary'],
      ]) {
        for (let i = 0; i < rows.length; i += EMBEDDINGS_BATCH_SIZE) {
          const batch = rows.slice(i, i + EMBEDDINGS_BATCH_SIZE);
          const ids = [];
          const vectors = [];
          for (const row of batch) {
            const recorded = mapFor(fixture, kind)[digest(row.body)];
            if (recorded === undefined) {
              skipped += 1;
              continue;
            }
            ids.push(row.id);
            vectors.push(fromFloat16Base64(recorded));
          }
          if (ids.length === 0) continue;
          const { rows: out } = await client.query(storeSql, [ids, vectors, fixture.model]);
          embedded += Number(out[0].stored);
          process.stdout.write(`  ${label}: ${Number(out[0].stored)} loaded\n`);
        }
      }

      process.stdout.write(`embedded         ${embedded} (from the fixture; no request made)\n`);
      if (skipped > 0) {
        process.stdout.write(
          `SKIPPED          ${skipped} text(s) are not in the fixture, or have been\n`
            + '                 rewritten since it was recorded. They have no vector and will\n'
            + '                 not be found by the vector leg. Re-record with --write-fixture.\n',
        );
      }
    }
  } else {
    // --- the ordinary job ---------------------------------------------------
    const statements = await fill(problemWork, STORE_PROBLEM_SQL, 'statement');
    const summaries = await fill(toolWork, STORE_TOOL_SQL, 'summary');

    process.stdout.write(`embedded         ${statements.embedded} statements, ${summaries.embedded} summaries\n`);
    process.stdout.write(`api requests     ${statements.requests + summaries.requests}\n`);
    process.stdout.write(`prompt tokens    ${statements.tokens + summaries.tokens}\n`);
  }

  // The queues are the only thing this role can read, so "how much is left" is
  // asked the same way "what is left" was.
  const { rows: remainingProblems } = await client.query(PROBLEM_WORK_SQL);
  const { rows: remainingTools } = await client.query(TOOL_WORK_SQL);
  process.stdout.write(
    `still to do      ${remainingProblems.length} statement(s), ${remainingTools.length} summary/summaries\n`,
  );
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
