/**
 * Writing problem statements for tools that have too few, and checking each
 * one before it is allowed anywhere near the catalogue.
 *
 * WHY. A problem statement is what the search actually matches against: the
 * full-text leg indexes it, the vector leg embeds it, and the reranker is shown
 * it. Today 182 of the 223 published tools carry two, 24 carry three and 17
 * carry four — so most of the catalogue is described by two sentences, and a
 * tool is findable only through the two situations somebody happened to think
 * of. More statements is more surface for a real question to land on.
 *
 * WHY IT IS DANGEROUS, AND WHAT IS DONE ABOUT IT. `docs/build-phases.md` puts
 * it in one line: **a hallucinated problem statement is worse than none.** A
 * statement is a claim, in the tool's own listing, that it solves something. If
 * a model invents one, the catalogue now says a thing that is not true, the
 * search ranks on it, and nobody finds out because it looks exactly like the
 * 504 statements a person wrote.
 *
 * So a candidate statement passes five gates before it is stored, and any one
 * of them refuses it outright:
 *
 *   1. **Shape** (`checkStatement`, below). English, one line, 8 to 200
 *      characters, no markup, no product words, no tool name, and not a
 *      paraphrase of the summary it was written from. All mechanical, all free.
 *   2. **A SECOND, INDEPENDENT MODEL CALL.** `gpt-5-nano` is shown the tool's
 *      name and summary and the one candidate sentence — never the generator's
 *      prompt, never its reasoning, never the other candidates — and answers a
 *      strict `{supported, reason}`. `false`, a timeout, or an answer the
 *      validator refuses all mean the statement is discarded and counted.
 *   3. **Dedupe by meaning.** The candidate is embedded and compared against
 *      the vectors of the statements the tool already has; within cosine 0.92
 *      it is a paraphrase and is discarded. The comparison happens inside
 *      PostgreSQL (`public.statement_similarity`) so no stored vector leaves
 *      the database.
 *   4. **The catalogue's own names.** A statement that names any published tool
 *      is an advertisement rather than a situation, and is discarded.
 *   5. **The database.** `public.store_generated_statement` refuses a tool that
 *      already has enough, refuses a tool that is not published, and has no
 *      argument that could write any `source` but `'generated'`.
 *
 * Nothing in this file opens a socket: the two calls go through
 * `callResponses` in lib/reader-model.ts, which is one of the two files in the
 * application allowed to. Nothing in this file touches a database either, so
 * `tests/generate.test.mjs` can put a handcrafted bad statement through every
 * gate with no key, no server and no stub.
 *
 * NO GOLDEN-SET TEXT APPEARS HERE OR REACHES THE MODEL. The generator is shown
 * a tool's own name, its own summary and its own existing statements, and
 * nothing else — not a query, not an eval file, not a list of what people
 * search for. A corpus written from the questions it will be asked measures
 * nothing but its own echo, which is the mistake Phase 2 made once and
 * withdrew a baseline over.
 */

import { ReaderError, callResponses, capText } from './reader-model.ts';

/**
 * The model that writes.
 *
 * `gpt-5-mini` rather than the `gpt-5-nano` everything else here uses, and this
 * is the one place in the codebase where the bigger model is worth it. This is
 * a batch job over 206 tools run once by hand, not a public endpoint: the whole
 * run costs cents and nobody can make us repeat it. Writing a natural sentence
 * in somebody's voice is also the task nano is worst at — its statements read
 * like feature lists, which is precisely the failure `checkStatement` below
 * exists to catch.
 */
export const GENERATOR_MODEL = 'gpt-5-mini';

/** The model that checks. Small, because the question is a yes or a no. */
export const VERIFIER_MODEL = 'gpt-5-nano';

/** Longer than a search's, because nobody is waiting for a batch job. */
export const GENERATOR_TIMEOUT_MS = 30_000;
export const VERIFIER_TIMEOUT_MS = 15_000;

/** The table's own rule (`tool_problems.statement`), repeated here so it bites early. */
export const MIN_STATEMENT = 8;
export const MAX_STATEMENT = 200;

/** How much of a tool's own text the generator is shown. */
const MAX_SUMMARY_INPUT = 400;
const MAX_NAME_INPUT = 80;

/**
 * What the generator is told.
 *
 * The voice is `db/seed/dev_seed.sql`'s header, quoted almost word for word,
 * because that file is the specification for what a statement is: "a situation
 * somebody is in, never a search query somebody typed", written "from the
 * tool's name and summary and from nothing else".
 */
export const GENERATOR_INSTRUCTIONS = [
  'You write PROBLEM STATEMENTS for a directory of software tools.',
  '',
  'A problem statement is one sentence in the voice of a person describing the',
  'situation they are in, before they know any tool exists that helps. It is what',
  'somebody would say to a friend, not what a product would say about itself.',
  '',
  'You are given one tool: its name, its own one-line summary, and the statements',
  'it already has. Write the number of NEW statements you are asked for.',
  '',
  'RULES, and every one of them is refused mechanically before your answer is',
  'used, so a statement that breaks one is simply thrown away:',
  '',
  '  * ENGLISH. One line. Between 8 and 200 characters.',
  '  * NO PRODUCT WORDS. Never "app", "tool", "software", "program", "platform",',
  '    "website", "service", "extension", "plugin", "dashboard", "feature".',
  '    A person with a problem does not say any of them.',
  '  * NAME NO TOOL. Not this one, not any other, not a company, not a brand.',
  '  * DO NOT REPHRASE THE SUMMARY. The summary says what the tool does. You are',
  '    saying what somebody\'s week looks like without it. If your sentence is the',
  '    summary with the words moved around, it is wrong.',
  '  * DO NOT REPEAT AN EXISTING STATEMENT, or say the same thing in other words.',
  '    Each new one is a DIFFERENT situation the same tool answers.',
  '  * ONLY WHAT THE SUMMARY SUPPORTS. If the summary does not say the tool does',
  '    something, do not describe somebody needing that thing. A second model',
  '    will be shown your sentence next to the summary and asked whether this',
  '    tool genuinely addresses it, and will throw out anything it cannot see.',
  '  * NO SOLUTION IN THE SENTENCE. Describe the problem and stop. Not "I need a',
  '    way to X" — just the situation that makes X necessary.',
  '',
  'If you cannot write a truthful new statement for this tool, return fewer than',
  'you were asked for, or none at all. An empty list is a correct answer and is',
  'much better than a sentence nobody could stand behind.',
  '',
  'The shape, on invented tools, so that nothing here is copied from the real',
  'catalogue:',
  '',
  'name: Sprout Diary',
  'summary: Logs when you watered each houseplant and reminds you when one is due.',
  '  "Half the plants are drowning and the other half are crisp"',
  '  "I came back from a fortnight away with no idea which ones had been done"',
  '',
  'name: Clearout',
  'summary: Finds the files on your disk that are copies of each other.',
  '  "The disk is full and I am sure most of it is the same holiday twice"',
  '  "Every phone backup has left another copy of the same three thousand photos"',
  '',
  'Notice what those are not: they do not say what the tool does, they do not use',
  'the word "app", and each one is a different moment rather than the same',
  'complaint reworded.',
].join('\n');

export const GENERATOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statements: { type: 'array', items: { type: 'string' } },
  },
  required: ['statements'],
} as const;

/**
 * What the verifier is told.
 *
 * It is shown the tool and ONE sentence, and it has no idea a model wrote the
 * sentence. That is the point of the second call: an independent reader of the
 * same evidence, asked the narrow question, with no stake in the answer.
 */
export const VERIFIER_INSTRUCTIONS = [
  'You are shown a software tool — its name and its own one-line summary — and',
  'ONE sentence describing a situation somebody might be in.',
  '',
  'Answer one question: does this tool, AS DESCRIBED BY THAT SUMMARY, genuinely',
  'address that situation?',
  '',
  'supported = true only when somebody in that situation would be helped by this',
  'tool, and the summary is what tells you so.',
  '',
  'supported = false when:',
  '  * the summary does not say the tool does that, and you would be relying on',
  '    something you happen to know or assume about the product;',
  '  * the tool is in the right subject area but does a different job;',
  '  * the sentence describes wanting a person, an object, or an errand;',
  '  * the sentence is vague enough that almost any tool would "address" it.',
  '',
  'Judge only against the summary. Being nearly right is false. You are the last',
  'check before this sentence is published on the tool\'s own listing as a thing',
  'it solves, so a wrong yes is much more expensive than a wrong no.',
  '',
  'reason: one short clause saying why, for a person reading a log. Never more',
  'than twenty words.',
].join('\n');

export const VERIFIER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    supported: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['supported', 'reason'],
} as const;

/* ===========================================================================
 * The mechanical gate
 * ======================================================================== */

/**
 * Words a person in trouble does not use about their own situation.
 *
 * Every one of these was in a statement the model wrote on the first run. They
 * are how a generated statement gives itself away: "I need an app that…" is a
 * product description with a first-person pronoun bolted on, and it matches the
 * search in a way a real sentence does not, because half the catalogue's
 * summaries contain the same words.
 */
const PRODUCT_WORDS =
  /(?<![\p{L}\p{N}])(?:apps?|applications?|software|programs?|programmes?|platforms?|websites?|web\s?apps?|services?|extensions?|plug-?ins?|add-?ons?|dashboards?|features?|tools?|utilit(?:y|ies)|clients?|suites?)(?![\p{L}\p{N}])/iu;

/**
 * Letters from a script this job does not write in.
 *
 * The catalogue carries Hebrew, Arabic, Russian, Spanish, French and
 * Portuguese statements, written by hand — see `db/seed/dev_seed.sql`. This
 * job writes English only, because the verifier's prompt, the echo check and
 * the product-word list are all English, and a generated Hebrew statement
 * would pass three gates that were not looking. Written as script properties
 * rather than as code-point ranges, so what it refuses is legible.
 */
const NON_ENGLISH_LETTERS =
  /\p{Script=Hebrew}|\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}|\p{Script=Thai}/u;

/** Structure, not prose: one line, and nothing that could be markup. */
const FORBIDDEN_SHAPE = /[{}[\]<>\n\r\t|]/;

/** A letter or a digit: the difference between a sentence and punctuation. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/** Words too common to count as evidence that two sentences say the same thing. */
const COMMON = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'i', 'my', 'me', 'you', 'your', 'we', 'our', 'they', 'them', 'their', 'not',
  'no', 'so', 'as', 'at', 'by', 'from', 'up', 'out', 'into', 'over', 'then',
  'than', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'will', 'would',
  'every', 'each', 'all', 'any', 'some', 'one', 'two', 'again', 'still', 'just',
]);

function contentWords(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !COMMON.has(w));
}

/**
 * Is this sentence the summary with the words moved around?
 *
 * Two tests, because the two failures look different. A model that paraphrases
 * reuses the same content words in a different order, which the overlap catches;
 * a model that gives up quotes a span of the summary outright, which the shared
 * run catches. Both were observed.
 */
export function echoesSummary(statement: string, summary: string): boolean {
  const a = contentWords(statement);
  const b = new Set(contentWords(summary));
  if (a.length === 0) return false;

  const shared = a.filter((w) => b.has(w)).length;
  if (shared / a.length >= 0.6) return true;

  // Five words in a row, verbatim. Long enough that ordinary English overlap
  // ("when I am away from") does not trip it.
  const words = String(statement ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
  const haystack = ` ${String(summary ?? '').toLowerCase().replace(/\s+/gu, ' ')} `;
  for (let i = 0; i + 5 <= words.length; i += 1) {
    if (haystack.includes(` ${words.slice(i, i + 5).join(' ')} `)) return true;
  }
  return false;
}

/** `Splitwise` as a whole word, in any case, with punctuation around it. */
export function namesAnyTool(text: string, names: readonly string[]): string | null {
  if (names.length === 0 || !text) return null;
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  for (const name of names) {
    const needle = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // One- and two-letter names would match half the language; the catalogue
    // has none, and if it ever does this is the safe direction.
    if (needle.length < 3) continue;
    if (haystack.includes(` ${needle} `)) return name;
  }
  return null;
}

export interface StatementContext {
  /** The tool's own name, which a statement may not contain either. */
  name: string;
  /** Its summary, for the echo check. */
  summary: string;
  /** The statements it already has, verbatim. */
  existing: readonly string[];
  /** Every published tool's name, for the catalogue check. */
  toolNames: readonly string[];
}

/**
 * Put one candidate statement through every mechanical gate.
 *
 * Returns null when it is fine, or the reason it is not — in the shape the job
 * prints, so a run's refusals are readable rather than a count.
 */
export function checkStatement(statement: string, context: StatementContext): string | null {
  const text = String(statement ?? '').trim();
  if (!HAS_WORD.test(text)) return 'it has no words in it';
  if (text.length < MIN_STATEMENT) return `it is ${text.length} characters; the minimum is ${MIN_STATEMENT}`;
  if (text.length > MAX_STATEMENT) return `it is ${text.length} characters; the maximum is ${MAX_STATEMENT}`;
  if (FORBIDDEN_SHAPE.test(text)) return 'it carries markup or more than one line';
  if (NON_ENGLISH_LETTERS.test(text)) return 'it is not written in English';

  const product = PRODUCT_WORDS.exec(text);
  if (product) return `it says "${product[0]}", which is a product word rather than a situation`;

  const named = namesAnyTool(text, [context.name, ...context.toolNames]);
  if (named) return `it names a tool (${named})`;

  if (echoesSummary(text, context.summary)) return 'it is the summary rephrased rather than a situation';

  const already = context.existing.find((s) => s.trim().toLowerCase() === text.toLowerCase());
  if (already) return 'it is a statement this tool already has, word for word';

  return null;
}

/* ===========================================================================
 * The two calls
 * ======================================================================== */

export interface GeneratorResult {
  statements: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface VerifierResult {
  supported: boolean;
  reason: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** What the generator is shown. Exported so a test can read what goes out. */
export function generatorInput(
  tool: { name: string; summary: string; existing: readonly string[] },
  wanted: number,
): string {
  const lines = [
    `name: ${capText(tool.name, MAX_NAME_INPUT)}`,
    `summary: ${capText(tool.summary, MAX_SUMMARY_INPUT)}`,
  ];
  if (tool.existing.length > 0) {
    lines.push('statements it already has:');
    for (const statement of tool.existing) lines.push(`  ${capText(statement, MAX_STATEMENT)}`);
  } else {
    lines.push('statements it already has: none');
  }
  lines.push(`write: ${wanted}`);
  return lines.join('\n');
}

/** What the verifier is shown: the tool, and one sentence. Nothing else. */
export function verifierInput(
  tool: { name: string; summary: string },
  statement: string,
): string {
  return [
    `tool: ${capText(tool.name, MAX_NAME_INPUT)}`,
    `summary: ${capText(tool.summary, MAX_SUMMARY_INPUT)}`,
    `situation: ${capText(statement, MAX_STATEMENT)}`,
  ].join('\n');
}

export function validateGenerated(value: unknown): { statements: string[] } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'the response is not a JSON object' };
  }
  const obj = value as Record<string, unknown>;
  for (const field of Object.keys(obj)) {
    if (field !== 'statements') return { error: `the response has an extra field "${field}"` };
  }
  if (!Array.isArray(obj.statements)) return { error: 'statements is not an array' };
  if (!obj.statements.every((s) => typeof s === 'string')) {
    return { error: 'statements holds something that is not a string' };
  }
  return { statements: obj.statements as string[] };
}

export function validateVerdict(
  value: unknown,
): { supported: boolean; reason: string } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'the response is not a JSON object' };
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 2 || keys[0] !== 'reason' || keys[1] !== 'supported') {
    return { error: `the response has the fields ${keys.join(', ') || '(none)'}` };
  }
  if (typeof obj.supported !== 'boolean') return { error: 'supported is not a boolean' };
  if (typeof obj.reason !== 'string') return { error: 'reason is not a string' };
  // A reason is a clause, not an essay, and it ends up in a log line.
  return { supported: obj.supported, reason: capText(obj.reason, 200) };
}

/** Ask for `wanted` new statements. Throws `ReaderError` on anything malformed. */
export async function generateStatements(
  tool: { name: string; summary: string; existing: readonly string[] },
  wanted: number,
): Promise<GeneratorResult> {
  if (wanted < 1) throw new ReaderError('nothing was asked for');
  const answer = await callResponses({
    model: GENERATOR_MODEL,
    instructions: GENERATOR_INSTRUCTIONS,
    input: generatorInput(tool, wanted),
    schemaName: 'problem_statements',
    schema: GENERATOR_SCHEMA,
    timeoutMs: GENERATOR_TIMEOUT_MS,
    maxOutputTokens: 1_200,
  });
  const checked = validateGenerated(answer.parsed);
  if ('error' in checked) throw new ReaderError(`schema: ${checked.error}`);
  return {
    statements: checked.statements,
    model: GENERATOR_MODEL,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
  };
}

/**
 * The second, independent call. Throws `ReaderError` on anything malformed —
 * and the job treats a throw exactly as it treats `supported: false`, because a
 * statement nobody could check is a statement nobody checked.
 */
export async function verifyStatement(
  tool: { name: string; summary: string },
  statement: string,
): Promise<VerifierResult> {
  const answer = await callResponses({
    model: VERIFIER_MODEL,
    instructions: VERIFIER_INSTRUCTIONS,
    input: verifierInput(tool, statement),
    schemaName: 'statement_verdict',
    schema: VERIFIER_SCHEMA,
    timeoutMs: VERIFIER_TIMEOUT_MS,
    maxOutputTokens: 400,
  });
  const checked = validateVerdict(answer.parsed);
  if ('error' in checked) throw new ReaderError(`schema: ${checked.error}`);
  return {
    supported: checked.supported,
    reason: checked.reason,
    model: VERIFIER_MODEL,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
  };
}
