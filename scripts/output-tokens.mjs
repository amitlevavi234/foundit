#!/usr/bin/env node
// ===========================================================================
// Foundit — what the reader actually produces, per request.
//
//   node --env-file=.env.local scripts/output-tokens.mjs --measure
//   node --env-file=.env.local scripts/output-tokens.mjs --measure --limit=50
//   node scripts/output-tokens.mjs --dry-run
//
// WHY THIS EXISTS. `max_output_tokens` is the number the WORST case is billed
// at, so it — not the average — is what `tests/rate-limit.test.mjs` multiplies
// by the daily caps. The reader's was 900 against a measured mean of about 65,
// and `.env.example` had already named it as the binding constraint on the
// three caps: fourteen times the mean, on the dearest line of the bill, for no
// reason anybody had measured.
//
// A ceiling is not something to guess in either direction. Set it from the
// mean and one long sentence truncates into `status: incomplete`, which is a
// page with no reading on it. Leave it at fourteen times the mean and every
// cap in the project is sized against a bill nobody will ever be sent.
//
// So this measures the DISTRIBUTION, once, against the sentences the eval
// actually searches with — every golden query, every negative in all three
// files, the positives, and the 240 mechanical perturbations, which are where
// the long ones are. It prints p50, p90, p99 and the maximum, and the ceiling
// that follows from them.
//
// ONE REQUEST PER SENTENCE, deliberately. `readSentence` samples twice and
// votes; the bill is charged per REQUEST and the ceiling bounds one of them,
// so a distribution over readings would be a distribution over the wrong
// thing. It calls `readSentenceOrThrow` for the same reason.
//
// IT WRITES NOTHING. Not the fixture, not the cache, not the database — it
// does not open a database connection at all. The readings it produces are
// thrown away the moment their token count has been taken, because a reading
// recorded here would be a reading the fixture already holds, re-recorded for
// no reason, and this project's fixtures extend rather than re-record.
//
// Exit codes: 0 done, 1 configuration, 2 the model provider.
// ===========================================================================
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { READER_MODEL, readSentenceOrThrow, readerConfigured } from '../lib/reader-model.ts';
import { READER_INPUT_PER_MTOK, READER_OUTPUT_PER_MTOK } from '../lib/prices.ts';
import { perturbedTexts } from '../eval/perturb.mjs';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2 };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The same five files scripts/read.mjs records, in the same order. */
const SENTENCE_FILES = [
  join(ROOT, 'eval', 'golden.jsonl'),
  join(ROOT, 'eval', 'negatives.jsonl'),
  join(ROOT, 'eval', 'negatives.review.jsonl'),
  join(ROOT, 'eval', 'negatives.review2.jsonl'),
  join(ROOT, 'eval', 'positives.review.jsonl'),
];

/**
 * The headroom over p99 the ceiling is set with.
 *
 * THREE, and the number is a judgement rather than a measurement: p99 says
 * what the hundredth-longest answer of a hundred looks like and says nothing
 * at all about the thousandth. Three times it leaves room for a sentence
 * unlike every one of these — which is the case the ceiling exists for — while
 * still being a bound somebody can multiply by a daily cap and recognise as
 * money.
 */
const HEADROOM = 3;

const args = new Set(process.argv.slice(2));
const limitArg = [...args].find((a) => a.startsWith('--limit='));
if (limitArg) args.delete(limitArg);
const limit = limitArg ? Number.parseInt(limitArg.slice(8), 10) : Infinity;

for (const arg of args) {
  if (arg !== '--measure' && arg !== '--dry-run') {
    process.stderr.write(`unknown argument: ${arg}\n`);
    process.stderr.write(
      'usage: node --env-file=.env.local scripts/output-tokens.mjs '
        + '[--measure | --dry-run] [--limit=N]\n',
    );
    process.exit(EXIT.CONFIG);
  }
}
const measure = args.has('--measure');
if (measure === args.has('--dry-run')) {
  process.stderr.write(
    'choose exactly one of --measure and --dry-run.\n'
      + 'There is no default: --measure spends money and --dry-run does not.\n',
  );
  process.exit(EXIT.CONFIG);
}
if (!Number.isFinite(limit) && limitArg) {
  process.stderr.write('--limit must be a positive integer\n');
  process.exit(EXIT.CONFIG);
}

/** Every sentence the eval searches with, de-duplicated, in file order. */
function evalSentences() {
  const authored = [];
  const golden = [];
  for (const file of SENTENCE_FILES) {
    if (!existsSync(file)) {
      process.stderr.write(`${file.slice(ROOT.length + 1)} is missing.\n`);
      process.exit(EXIT.CONFIG);
    }
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const obj = JSON.parse(trimmed);
      // "query", "q" or "sentence": three spellings across five files, and not
      // one of the files is edited to suit a script.
      const text =
        typeof obj.query === 'string' ? obj.query : typeof obj.q === 'string' ? obj.q : obj.sentence;
      if (typeof text !== 'string' || text.trim() === '') continue;
      authored.push(text);
      if (file === SENTENCE_FILES[0]) golden.push(text);
    }
  }
  return [...new Set([...authored, ...perturbedTexts(golden)])];
}

/** The value at `p` of a sorted-ascending array, nearest rank. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const sentences = evalSentences().slice(0, limit);

process.stdout.write(`model            ${READER_MODEL}\n`);
process.stdout.write(`sentences        ${sentences.length}\n`);
process.stdout.write('requests         one per sentence (the bill is per request)\n');

if (!measure) {
  process.stdout.write('\n--dry-run: nothing called, nothing spent.\n');
  process.exit(EXIT.OK);
}

if (!readerConfigured()) {
  process.stderr.write(
    '\nNo key is set. OPENAI_API_KEY is read first and EMBEDDINGS_API_KEY second;\n'
      + 'both live in .env.local, which is not committed. Run this as\n'
      + '`node --env-file=.env.local scripts/output-tokens.mjs --measure`.\n',
  );
  process.exit(EXIT.CONFIG);
}

const outs = [];
let tokensIn = 0;
let failed = 0;
let done = 0;

/** Two in flight. The same reasoning as scripts/read.mjs: six earns 429s. */
const CONCURRENCY = 2;
const one = async (sentence) => {
  try {
    const result = await readSentenceOrThrow(sentence);
    outs.push(result.tokensOut);
    tokensIn += result.tokensIn;
  } catch {
    // One sentence that could not be read is not a reason to lose the other
    // three hundred and ninety-five. It is counted and reported.
    failed += 1;
  }
  done += 1;
  if (done % 50 === 0) process.stdout.write(`  ${done} of ${sentences.length}\n`);
};

for (let i = 0; i < sentences.length; i += CONCURRENCY) {
  await Promise.all(sentences.slice(i, i + CONCURRENCY).map(one));
}

if (outs.length === 0) {
  process.stderr.write('\nevery call failed; nothing was measured.\n');
  process.exit(EXIT.PROVIDER);
}

const sorted = [...outs].sort((a, b) => a - b);
const mean = outs.reduce((a, b) => a + b, 0) / outs.length;
const p99 = percentile(sorted, 99);
const tokensOut = outs.reduce((a, b) => a + b, 0);
const spent = (tokensIn * READER_INPUT_PER_MTOK + tokensOut * READER_OUTPUT_PER_MTOK) / 1e6;

process.stdout.write('\noutput tokens per request\n');
for (const [label, value] of [
  ['min', sorted[0]],
  ['mean', Math.round(mean)],
  ['p50', percentile(sorted, 50)],
  ['p90', percentile(sorted, 90)],
  ['p95', percentile(sorted, 95)],
  ['p99', p99],
  ['max', sorted[sorted.length - 1]],
]) {
  process.stdout.write(`  ${label.padEnd(6)} ${String(value).padStart(6)}\n`);
}

process.stdout.write(`\n  measured on    ${outs.length} request(s), ${failed} failed\n`);
process.stdout.write(`  ceiling        ${HEADROOM} x p99 = ${HEADROOM * p99}\n`);
process.stdout.write(`  input tokens   ${tokensIn}\n`);
process.stdout.write(`  output tokens  ${tokensOut}\n`);
process.stdout.write(`  this run cost  $${spent.toFixed(4)}\n`);
process.exit(EXIT.OK);
