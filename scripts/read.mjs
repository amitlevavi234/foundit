#!/usr/bin/env node
// ===========================================================================
// Foundit — the sentence-reading job.
//
//   node --env-file=.env.local scripts/read.mjs --write-fixture
//   node --env-file=.env.local scripts/read.mjs --from-fixture
//   node --env-file=.env.local scripts/read.mjs --dry-run
//
// The sibling of scripts/embed.mjs, and it exists for the same one reason that
// file exists: **CI has no key and must not have one**, and a run with no
// readings measures a different search from the one that ships. So the readings
// are recorded once, by hand, with a key — and every later run, on a laptop or
// on a runner, loads the recorded ones and calls nothing.
//
// It shares db/seed/embeddings.fixture.json with the embedding job rather than
// having a file of its own. One fixture, one schema version, one thing to
// re-record: two files would drift the day somebody regenerated one of them.
//
// THE ORDER MATTERS, and it is the one thing about this job that is easy to get
// wrong:
//
//   1. scripts/read.mjs --write-fixture     records the readings
//   2. scripts/embed.mjs --write-fixture    records the vectors, INCLUDING the
//                                           vectors for the text the shipped
//                                           path embeds — which is derived from
//                                           the readings recorded in step 1
//
// Run them the other way round and the fixture holds no vector for the fused
// English restatement of a Hebrew sentence, so a keyless run measures that
// sentence text-only and quietly reports a different number.
//
// Five things about it are deliberate:
//
//   1. IT CONNECTS AS foundit_app, from DATABASE_URL, and refuses the owner by
//      name. Unlike the embedding job there is no third role: writing a reading
//      is exactly what the application does on every cache miss, and inventing
//      a role for it would be ceremony rather than a boundary. What 0005's rule
//      forbids is one role holding two halves of an oracle, and a reading has
//      no halves — see the header of db/migrations/0008_reader.sql.
//
//   2. IT TOUCHES NO TABLE. public.query_readings is revoked from everybody;
//      this goes through public.store_query_reading, the same definer function
//      the application uses, so a fixture cannot put anything in that table
//      that a visitor's search could not.
//
//   3. THE SENTENCES COME FROM THE EVAL FILES, never from the database. Four
//      kinds, and all four have to be here: the golden set, both negatives
//      files, and the 240 mechanical perturbations — because since Phase 4 the
//      perturbation gate measures the READER as well as the floor, and "does a
//      full stop change whether this is a request for software" is exactly the
//      question it exists to ask.
//
//   4. IT EXTENDS, NEVER RE-RECORDS. A reading already in the file is left
//      alone. gpt-5-nano at minimal reasoning effort is not deterministic, so
//      re-reading the same sentence moves the headline for a reason nobody
//      changed — the same rule, and the same reason, as the vectors.
//
//   5. NOTHING IT PRINTS IS SENSITIVE. Counts, token usage, and the sentences
//      from files that are already in the repository. Never the key, never a
//      connection string.
//
// Exit codes: 0 done, 1 configuration, 2 the model provider, 3 the database,
// 4 the fixture.
// ===========================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { normalizeQuery } from '../lib/embeddings.ts';
import { READER_MODEL, readSentence, readerConfigured } from '../lib/reader-model.ts';
import { perturbedTexts } from '../eval/perturb.mjs';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3, FIXTURE: 4 };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'db', 'seed', 'embeddings.fixture.json');

/** Bumped in Phase 4, when the readings joined the vectors in the same file. */
const FIXTURE_SCHEMA = 'foundit-embeddings/3';

const SENTENCE_FILES = [
  join(ROOT, 'eval', 'golden.jsonl'),
  join(ROOT, 'eval', 'negatives.jsonl'),
  join(ROOT, 'eval', 'negatives.review.jsonl'),
  // The Phase 5 reviewer's two held-out files. A sentence the eval searches
  // with and the fixture does not hold is a sentence CI measures differently
  // from a laptop, which is the whole failure this list exists to prevent.
  join(ROOT, 'eval', 'negatives.review2.jsonl'),
  join(ROOT, 'eval', 'positives.review.jsonl'),
];

const ROLE = 'foundit_app';
const URL_VARIABLE = 'DATABASE_URL';

const KNOWN = new Set(['--dry-run', '--from-fixture', '--write-fixture']);
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!KNOWN.has(arg)) {
    process.stderr.write(`unknown argument: ${arg}\n`);
    process.stderr.write(
      'usage: node --env-file=.env.local scripts/read.mjs '
        + '[--dry-run | --from-fixture | --write-fixture]\n',
    );
    process.exit(EXIT.CONFIG);
  }
}
const dryRun = args.has('--dry-run');
const fromFixture = args.has('--from-fixture');
const writeFixture = args.has('--write-fixture');

if ([dryRun, fromFixture, writeFixture].filter(Boolean).length !== 1) {
  process.stderr.write(
    'choose exactly one of --dry-run, --from-fixture, --write-fixture.\n'
      + 'There is no default: the ordinary state of this job is "already done".\n',
  );
  process.exit(EXIT.CONFIG);
}

/** Every sentence eval/run.mjs will search with, in file order, de-duplicated. */
function evalSentences() {
  const authored = [];
  for (const file of SENTENCE_FILES) {
    if (!existsSync(file)) {
      process.stderr.write(
        `\n${file.slice(ROOT.length + 1)} is missing.\n`
          + 'Every sentence the eval searches with has to be in the fixture, or a keyless\n'
          + 'run measures a different search from a run with a key.\n',
      );
      process.exit(EXIT.FIXTURE);
    }
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const obj = JSON.parse(trimmed);
      // The golden set and eval/negatives.jsonl say "query"; the held-out
      // review set says "q". Both are read; neither file is ever edited.
      // "query", "q" or "sentence": three review files, three spellings, and
      // not one of them is edited to suit a script.
      const text =
        typeof obj.query === 'string' ? obj.query : typeof obj.q === 'string' ? obj.q : obj.sentence;
      if (typeof text === 'string' && text.trim() !== '') authored.push(text);
    }
  }

  const golden = [];
  for (const line of readFileSync(SENTENCE_FILES[0], 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const obj = JSON.parse(trimmed);
    if (typeof obj.query === 'string' && obj.query.trim() !== '') golden.push(obj.query);
  }

  return [...new Set([...authored, ...perturbedTexts(golden)])];
}

function readFixture({ required = true } = {}) {
  if (!existsSync(FIXTURE_PATH)) {
    if (!required) return null;
    process.stderr.write(
      `could not read ${FIXTURE_PATH.slice(ROOT.length + 1)}\n`
        + 'Run `scripts/embed.mjs --write-fixture` first, then this with --write-fixture.\n',
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
  parsed.statements ??= {};
  parsed.tools ??= {};
  parsed.queries ??= {};
  parsed.readings ??= {};
  return parsed;
}

/* --- --write-fixture: the only path that spends anything ------------------ */

if (writeFixture) {
  if (!readerConfigured()) {
    process.stderr.write(
      'No key is set. OPENAI_API_KEY is read first and EMBEDDINGS_API_KEY second;\n'
        + 'both live in .env.local, which is not committed. Run this as\n'
        + '`node --env-file=.env.local scripts/read.mjs --write-fixture`.\n',
    );
    process.exit(EXIT.CONFIG);
  }

  const fixture = readFixture();
  if (fixture.readingModel && fixture.readingModel !== READER_MODEL) {
    process.stderr.write(
      `\nthe fixture's readings came from ${fixture.readingModel} and this build reads with\n`
        + `${READER_MODEL}. Readings from two models cannot share a file: the prompt and the\n`
        + 'guards in lib/reading.ts are tuned against one model\'s failures. Move the old\n'
        + 'fixture aside and re-record.\n',
    );
    process.exit(EXIT.FIXTURE);
  }

  const sentences = evalSentences();
  const keys = [...new Set(sentences.map(normalizeQuery).filter((k) => k !== ''))];
  const missing = keys.filter((k) => fixture.readings[k] === undefined);

  process.stdout.write(`model            ${READER_MODEL}\n`);
  process.stdout.write(`eval sentences   ${sentences.length} (${keys.length} distinct)\n`);
  process.stdout.write(`already recorded ${keys.length - missing.length}\n`);
  process.stdout.write(`to read          ${missing.length}\n`);

  let tokensIn = 0;
  let tokensOut = 0;
  let failed = 0;

  /**
   * Two sentences at a time, which is four requests in flight.
   *
   * The application reads ONE sentence per search and this is not a model of
   * that — it is a recording session that would otherwise take twenty minutes
   * sequentially, which is twenty minutes of nobody being able to re-record
   * after a prompt change. Kept low because each sentence is now two calls and
   * the provider answered a burst of six with 429s.
   */
  const CONCURRENCY = 2;
  let done = 0;

  // `readSentence`, not `readSentenceOrThrow`: the fixture has to record what a
  // visitor's search would get, and what a search gets is the reading AFTER the
  // two samples have voted on whether this is a request for software.
  // Recording one sample would put a reading in the fixture that the
  // application would never have produced.
  const readOne = async (key) => {
    const result = await readSentence(key);
    if (result) {
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      fixture.readings[key] = {
        pricing: result.reading.pricing,
        platforms: result.reading.platforms,
        languages: result.reading.languages,
        flags: result.reading.flags,
        english: result.reading.english,
        asks_for_software: result.reading.asksForSoftware,
        residual: result.reading.residual,
      };
    } else {
      // One sentence that could not be read is not a reason to throw away the
      // other three hundred. It is counted and reported; a sentence with no
      // reading measures rules-only, which is exactly what a visitor gets.
      failed += 1;
    }
    done += 1;
    if (done % 50 === 0) process.stdout.write(`  ${done} of ${missing.length}\n`);
  };

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(missing.slice(i, i + CONCURRENCY).map(readOne));
  }

  if (missing.length === 0) {
    process.stdout.write('\nnothing to add   the fixture already holds every sentence\n');
  } else {
    fixture.schema = FIXTURE_SCHEMA;
    fixture.readingModel = READER_MODEL;
    fixture.readingsRecorded = new Date().toISOString().slice(0, 10);
    // The provider's own usage numbers, accumulated across every sentence this
    // job has ever read into this file. eval/run.mjs turns them into the cost
    // per thousand searches it prints, so that figure is measured rather than
    // estimated — and it is the only place the real numbers survive, because a
    // keyless run makes no call to count.
    const prior = fixture.readingTokens ?? { in: 0, out: 0, sentences: 0 };
    fixture.readingTokens = {
      in: prior.in + tokensIn,
      out: prior.out + tokensOut,
      sentences: prior.sentences + (missing.length - failed),
    };
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture)}\n`, 'utf8');
    const bytes = readFileSync(FIXTURE_PATH).byteLength;
    process.stdout.write('\nwrote            db/seed/embeddings.fixture.json\n');
    process.stdout.write(`  readings       ${Object.keys(fixture.readings).length}\n`);
    process.stdout.write(`  could not read ${failed}\n`);
    process.stdout.write(`  size           ${(bytes / 1024).toFixed(0)} kB\n`);
    process.stdout.write(`  input tokens   ${tokensIn}\n`);
    process.stdout.write(`  output tokens  ${tokensOut}\n`);
  }
  process.exit(EXIT.OK);
}

/* --- --dry-run: what is outstanding, calling nothing ---------------------- */

if (dryRun) {
  const fixture = readFixture({ required: false }) ?? { readings: {} };
  const keys = [...new Set(evalSentences().map(normalizeQuery).filter((k) => k !== ''))];
  const missing = keys.filter((k) => fixture.readings[k] === undefined);
  process.stdout.write(`model            ${READER_MODEL}\n`);
  process.stdout.write(`eval sentences   ${keys.length} distinct\n`);
  process.stdout.write(`recorded         ${keys.length - missing.length}\n`);
  process.stdout.write(`would read       ${missing.length} (--dry-run: nothing called)\n`);
  process.exit(EXIT.OK);
}

/* --- --from-fixture: fill the cache with no network ----------------------- */

const databaseUrl = process.env[URL_VARIABLE];
if (!databaseUrl || databaseUrl.trim() === '') {
  process.stderr.write(
    `${URL_VARIABLE} is not set. It is the ${ROLE} connection string, and this job\n`
      + 'reads it from the environment and nowhere else.\n',
  );
  process.exit(EXIT.CONFIG);
}
try {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (user !== ROLE) {
    process.stderr.write(
      `${URL_VARIABLE} connects as "${user}". This job runs as ${ROLE}, which owns nothing\n`
        + 'and bypasses nothing — the same role the application uses, writing through the\n'
        + 'same definer function a visitor\'s search would.\n',
    );
    process.exit(EXIT.CONFIG);
  }
} catch {
  process.stderr.write(`${URL_VARIABLE} is not a connection string this job can parse.\n`);
  process.exit(EXIT.CONFIG);
}

const fixture = readFixture();
if (fixture.readingModel && fixture.readingModel !== READER_MODEL) {
  process.stderr.write(
    `\nthe fixture's readings came from ${fixture.readingModel} and this build reads with\n`
      + `${READER_MODEL}. Re-record with --write-fixture, or change READER_MODEL back.\n`,
  );
  process.exit(EXIT.FIXTURE);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: 'foundit-read',
  statement_timeout: 60_000,
});

let exitCode = EXIT.OK;
try {
  await client.connect();
} catch (error) {
  process.stderr.write(`could not connect to PostgreSQL as ${ROLE}: ${error.code ?? 'error'}\n`);
  process.exit(EXIT.DATABASE);
}

// One statement per batch, through the same definer function the application
// calls. There is no path from here to the table itself.
const STORE_SQL = `
  select count(*)
    from unnest($1::text[], $2::jsonb[]) as x(q, r),
         lateral public.store_query_reading(x.q, x.r, $3::text)`;

try {
  const { rows: modelRows } = await client.query('select public.reading_model() as model');
  const model = modelRows[0].model;
  if (model !== READER_MODEL) {
    process.stderr.write(
      `\nthis database reads with ${model} and lib/reader-model.ts reads with ${READER_MODEL}.\n`
        + 'public.reading_model() is changed in a migration, on purpose.\n',
    );
    exitCode = EXIT.FIXTURE;
  } else {
    const entries = Object.entries(fixture.readings ?? {});
    process.stdout.write(`role             ${(await client.query('select current_user')).rows[0].current_user}\n`);
    process.stdout.write(`model            ${model}\n`);
    process.stdout.write(`readings in file ${entries.length}\n`);

    const BATCH = 200;
    let loaded = 0;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await client.query(STORE_SQL, [
        batch.map(([key]) => key),
        batch.map(([, reading]) => JSON.stringify(reading)),
        model,
      ]);
      loaded += batch.length;
    }
    process.stdout.write(`loaded           ${loaded} (from the fixture; no request made)\n`);
  }
} catch (error) {
  process.stderr.write(`database error: ${error.message}\n`);
  for (const field of ['detail', 'hint', 'where']) {
    if (error[field]) process.stderr.write(`  ${field}: ${error[field]}\n`);
  }
  exitCode = EXIT.DATABASE;
} finally {
  await client.end();
}

process.exitCode = exitCode;
