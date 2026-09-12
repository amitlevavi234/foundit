/**
 * The second — and last — place in this codebase that makes an outbound HTTP
 * request.
 *
 * `lib/embeddings.ts` is the first, and its header explains the rule both of
 * them are written against: **the server never fetches a URL a stranger
 * supplied.** A tool's address is rendered for a visitor's own browser to
 * follow and is never read by us. This module does not weaken that. It sends
 * one sentence somebody typed to a model provider, at an address written here
 * in full, and it cannot be pointed anywhere else without editing this file and
 * failing `tests/markup.test.mjs` — which now says, precisely, that exactly two
 * files in the application open a socket at all, that each holds exactly one
 * literal URL, that each request body's keys are the ones enumerated there, and
 * that neither logs its key.
 *
 * What this reads, and what it cannot do.
 *
 *   * **The input is the normalised, 200-character-capped sentence and nothing
 *     else.** No catalogue, no tool names, no slugs, no list of what we have.
 *     The model is not choosing an answer; it is reading a sentence.
 *
 *   * **It can name no tool, because no field can hold one.** Every field of
 *     the schema is an enum member, an ISO language code, a boolean, or a
 *     restatement of the sentence itself. There is no free-text field a tool
 *     name could arrive in except `english` and `residual`, and neither of
 *     those reaches the ranker as anything but text the person already typed —
 *     `residual` is rejected outright if it is longer than what went in.
 *
 *   * **Its answer is validated before use** by `validateReading` below: a
 *     hand-written validator, no new dependency, that refuses an unknown enum
 *     value, a wrong type, an extra key, a missing key, and a residual longer
 *     than the input. Structured output makes a bad response unlikely; the
 *     validator makes it harmless. A refused reading is not a failure a visitor
 *     ever sees — the search runs on the rules pass alone, which is the whole
 *     of Phase 2 and 3 and renders perfectly well.
 *
 *   * **Nothing it says can widen a search.** The merge in `lib/reading.ts`
 *     gives the rules the last word on every dimension they read, because they
 *     are deterministic and tested; the model may only fill a dimension the
 *     rules left empty.
 *
 * Three deliberate details, the same three as the embedder:
 *
 *   * **No `server-only` import.** `eval/run.mjs` and `scripts/read.mjs` are
 *     plain Node and import this directly so the harness measures the code the
 *     application runs. What keeps it off the client is that nothing marked
 *     `'use client'` imports it — asserted in tests/markup.test.mjs — and that
 *     the key is read from variables with no NEXT_PUBLIC_ prefix.
 *
 *   * **The key is read at call time and never stored, logged, echoed or put in
 *     an error.** Every failure reports a short reason and nothing else: no
 *     key, no sentence, no response body.
 *
 *   * **A failure is null, not an exception.** A search whose sentence could
 *     not be read is a rules-only search, which is a perfectly good page.
 *
 * `store: false` is in the request body on purpose. The Responses API retains
 * a response by default so it can be fetched back by id; the sentence somebody
 * typed is the text `search_events` refuses to attach to a person, and leaving
 * a copy of it in a provider's dashboard would undo that at the far end.
 */

import type { Platform, PricingModel, ToolFlag } from './types';

/** The one address. Not a base URL, not a template, not configurable. */
export const READER_URL = 'https://api.openai.com/v1/responses';

/**
 * The model.
 *
 * `gpt-5-nano` is the smallest of the family and the only one this can afford:
 * the search endpoint is public, so every search is a call somebody else can
 * make us pay for. See `lib/prices.ts` for what a thousand searches costs and
 * the ceiling it has to stay under.
 */
export const READER_MODEL = 'gpt-5-nano';

/**
 * How long a search will wait for a reading before giving up and going on.
 *
 * Shorter than the embedder's 4 s, because the two run concurrently and this
 * one is the optional half: with no vector the search loses its best leg, and
 * with no reading it loses whatever the rules did not already catch.
 */
export const READER_TIMEOUT_MS = 3_000;

/**
 * The cap on the sentence, in characters. The same 200 the search box, the
 * search function, `search_events` and the embedder all use, so there is one
 * number and a stranger has one ceiling on what they can make us pay for.
 */
export const MAX_READER_INPUT = 200;

/**
 * How many HTTP requests one reading costs.
 *
 * TWO: `readSentence` samples the model twice and lets the samples vote on the
 * one answer that can empty a page. The daily cap in lib/rate-limit.ts counts
 * REQUESTS rather than readings, so this is the number it takes per reading —
 * it used to take one for the pair, which meant a cap of 2,000 permitted 4,000
 * requests and twice the bill it was set to bound.
 */
export const READER_REQUESTS_PER_READING = 2;

/**
 * Where the key comes from, in order.
 *
 * Two names, not one, and the reason is that there is one account behind both:
 * `EMBEDDINGS_API_KEY` already reaches api.openai.com from lib/embeddings.ts,
 * and requiring a second copy of the same secret in a second variable is two
 * places to leak it from rather than one. `OPENAI_API_KEY` is read first so a
 * deployment that wants them separated can separate them — a key scoped to
 * this model alone, say — without touching any code.
 *
 * Nothing else is read from the environment in this file, and neither name is
 * ever printed, logged, compared or put in an error.
 */
const KEY_VARIABLES = ['OPENAI_API_KEY', 'EMBEDDINGS_API_KEY'] as const;

/* ===========================================================================
 * The vocabulary. Every one of these is a database enum label, written out
 * here so a drift is a type error rather than a silent filter that stops
 * filtering. `lib/types.ts` holds the unions; these are the same labels as
 * runtime values, which is what a JSON schema needs.
 * ======================================================================== */

export const PRICING_VALUES = [
  'free',
  'freemium',
  'free_trial',
  'paid',
  'open_source',
  'donation',
] as const satisfies readonly PricingModel[];

export const PLATFORM_VALUES = [
  'web',
  'ios',
  'android',
  'windows',
  'macos',
  'linux',
  'browser_extension',
  'cli',
  'api',
  'self_hosted',
] as const satisfies readonly Platform[];

export const FLAG_VALUES = [
  'works_offline',
  'no_account_needed',
  'no_ads',
  'has_free_tier',
  'exports_data',
  'e2e_encrypted',
  'accessible',
] as const satisfies readonly ToolFlag[];

/**
 * The languages a person may ask for an interface in.
 *
 * Exactly the codes `lib/constraints.ts` already knows how to name, because a
 * code this application cannot turn into a word is a chip with no label on it.
 * An enum rather than a free string, so the validator can refuse `"Hebrew"` —
 * which is what the model answers when nobody tells it not to.
 */
export const LANGUAGE_VALUES = [
  'en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'ja', 'zh', 'ar',
  'he', 'hi', 'tr', 'uk', 'is', 'sv', 'no', 'da', 'fi', 'cs', 'el', 'ko',
  'id', 'vi', 'hu', 'ro',
] as const;

/**
 * What the model is allowed to say.
 *
 * `strict: true`, `additionalProperties: false`, every field required. A strict
 * schema is not a substitute for validating the answer — it is the thing that
 * makes a valid answer overwhelmingly likely, and `validateReading` is the
 * thing that makes an invalid one harmless.
 */
export const READER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pricing: { type: 'array', items: { type: 'string', enum: [...PRICING_VALUES] } },
    platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORM_VALUES] } },
    languages: { type: 'array', items: { type: 'string', enum: [...LANGUAGE_VALUES] } },
    flags: { type: 'array', items: { type: 'string', enum: [...FLAG_VALUES] } },
    english: { type: 'string' },
    asks_for_software: { type: 'boolean' },
    residual: { type: 'string' },
  },
  required: [
    'pricing',
    'platforms',
    'languages',
    'flags',
    'english',
    'asks_for_software',
    'residual',
  ],
} as const;

/** The keys, in one place, so the validator and the schema cannot drift. */
const READING_KEYS = READER_SCHEMA.required;

/**
 * What the model is told.
 *
 * Every paragraph here is a mistake somebody made first. The rules pass in
 * lib/constraints.ts is a decade of the same lessons in regular expressions:
 * a constraint is a WHERE clause, so a missed one returns too much and a wrong
 * one returns the wrong thing, and only the first is recoverable by the person
 * typing another word. That asymmetry is the whole of this prompt.
 */
export const READER_INSTRUCTIONS = [
  'You read ONE sentence from somebody looking for a software tool and report',
  'what that sentence REQUIRES. You never name, suggest or consider a particular',
  'tool: nothing you can return has room for one.',
  '',
  'THE DEFAULT IS EMPTY. pricing [], platforms [], languages [], flags [],',
  'english "". Fill one only when the sentence says that requirement in words.',
  'Most sentences state no requirement at all and their answer is four empty',
  'arrays.',
  '',
  'Why: a requirement you report becomes a filter. Report "free" and every tool',
  'that is not free vanishes from the answer, however well it fits. A missed',
  'requirement is recoverable — the person adds a word. A wrong one hides the',
  'right answer and they never find out why.',
  '',
  'pricing — only if the sentence talks about what the TOOL costs.',
  '  wants it to cost nothing (free, "without paying", gratis, בחינם,',
  '    бесплатно, ücretsiz, مجاني) -> ["free","freemium","open_source","donation"]',
  '  wants open source, FOSS, libre -> ["open_source"]',
  '  everything else -> []. In particular the word "paid" about something in the',
  '    past ("we all paid for the holiday") is not a requirement.',
  '',
  'platforms — only if the sentence says where the TOOL must run: "on my phone",',
  '  "for Linux", "in the browser", "on my own server". A platform that is the',
  '  subject ("sell my old iphone", "generate ios app icons", "learn linux',
  '  commands") or the audience ("for android developers") is not a requirement.',
  '  Never list a platform the sentence did not name. AT MOST TWO: if you are',
  '  listing three, the sentence named none and the answer is [].',
  '',
  'languages — only if the sentence asks for the INTERFACE in a language: "in',
  '  Spanish", "with a Russian interface", "en español". THE LANGUAGE THE',
  '  SENTENCE IS WRITTEN IN IS NEVER A REQUIREMENT: a sentence typed in Hebrew,',
  '  Russian, Arabic, Spanish or French asks for nothing about interface language',
  '  unless it also says so in words. A language that is the subject ("learn',
  '  Spanish", "an Arabic-English dictionary") is never a requirement either.',
  '  ISO 639-1, two letters, lower case. AT MOST ONE.',
  '',
  'flags — only if the sentence states it.',
  '  works_offline      works with no internet',
  '  no_account_needed  no sign-up, no account, no email address',
  '  no_ads             no adverts',
  '  has_free_tier      a free tier specifically',
  '  exports_data       "let me take my data out", "I want to own my data"',
  '  e2e_encrypted      end-to-end encrypted, said in those words',
  '  accessible         screen reader, keyboard only, colour blindness',
  '  AT MOST TWO: if you are listing three, the sentence stated none and the',
  '  answer is [].',
  '',
  'english — ALWAYS fill this when the sentence is not written in English. It is',
  '  not optional and it is not a copy: it is the sentence said again in plain',
  '  English, same meaning, nothing added and nothing left out. A sentence that',
  '  IS in English gets "" and nothing else.',
  '',
  'asks_for_software — could the WHOLE of what this person asked for arrive as a',
  '  program they install or open?',
  '',
  '  One question decides it. Could the thing this person needs APPEAR ON A',
  '  SCREEN? Or does it have to arrive in the post, knock on the door, be told to',
  '  them as an answer, or be done at a counter?',
  '',
  '  false when what they want is:',
  '    an OBJECT they would hold        a jacket, a lock, a keyboard, a notebook,',
  '                                     a bicycle, an appliance, a spare part',
  '    a PERSON or that person\'s labour a lawyer, a plumber, a cleaner, a tutor,',
  '                                     a babysitter, a studio with an engineer,',
  '                                     a doctor, an accountant, a human editor',
  '    a FACT or ADVICE, not a tool     how to cure a sore throat, a cake recipe,',
  '                                     what a fair price per square metre is,',
  '                                     how to replace a part on a particular car',
  '    an ERRAND at an organisation     renew a passport, recover an account at',
  '                                     somebody else\'s provider, get a refund,',
  '                                     have something delivered, book a table',
  '    THE WORK ITSELF done for them    write my essay, proofread my thesis',
  '',
  '  true when a program could do the job, EVEN IF the person never says "app"',
  '  and even if no such tool exists. Most people here describe a PROBLEM rather',
  '  than naming a tool, and that is the ordinary way to ask for software: "I get',
  '  to the end of every month with no idea where the money went", "nobody knows',
  '  who owes who", "my video file is too big to email", "stop myself opening the',
  '  same distracting sites", "sketch a diagram and send someone the link". All',
  '  true. The job is done on a screen.',
  '',
  '  The line is the KIND of thing wanted, not how hard it would be to build.',
  '',
  'residual — the sentence with the requirement phrases you reported deleted, in',
  '  its own language. DELETE ONLY. Never rewrite, reorder, translate or add.',
  '  Reported nothing -> the sentence unchanged. Never longer than the input.',
  '',
  'Worked examples. Not one of these sentences is from the set this reader is',
  'measured on, and none may ever be: an example copied from a test is a reader',
  'taught the answer key.',
  '',
  'I never remember which of us is supposed to pick up the shopping',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":true,"residual":"I never remember which of us is supposed to pick up the shopping"}',
  '',
  'I keep missing the bin collection and putting it out on the wrong week',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":true,"residual":"I keep missing the bin collection and putting it out on the wrong week"}',
  '',
  'my holiday photos are spread across four phones and nobody has all of them',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":true,"residual":"my holiday photos are spread across four phones and nobody has all of them"}',
  '',
  'the boiler stopped heating water and I cannot work out why',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":false,"residual":"the boiler stopped heating water and I cannot work out why"}',
  '',
  'someone to paint the hallway next month',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":false,"residual":"someone to paint the hallway next month"}',
  '',
  'a folding umbrella small enough for a handbag',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":false,"residual":"a folding umbrella small enough for a handbag"}',
  '',
  'change the address on my driving licence before the fine arrives',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":false,"residual":"change the address on my driving licence before the fine arrives"}',
  '',
  'an accountant who understands freelance income',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":false,"residual":"an accountant who understands freelance income"}',
  '',
  'how much salt goes into a two kilo ham',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":false,"residual":"how much salt goes into a two kilo ham"}',
  '',
  'everyone chipped in for the taxi and I have lost track of the amounts',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":true,"residual":"everyone chipped in for the taxi and I have lost track of the amounts"}',
  '',
  'a free tool to rename hundreds of photos at once',
  '{"pricing":["free","freemium","open_source","donation"],"platforms":[],"languages":[],',
  '"flags":[],"english":"","asks_for_software":true,',
  '"residual":"a tool to rename hundreds of photos at once"}',
  '',
  'a music player that runs on Linux',
  '{"pricing":[],"platforms":["linux"],"languages":[],"flags":[],"english":"",',
  '"asks_for_software":true,"residual":"a music player"}',
  '',
  'a diary I can still write in on a train with no signal',
  '{"pricing":[],"platforms":[],"languages":[],"flags":["works_offline"],"english":"",',
  '"asks_for_software":true,"residual":"a diary I can still write in"}',
  '',
  'תוכנה חינמית לעריכת תמונות',
  '{"pricing":["free","freemium","open_source","donation"],"platforms":[],"languages":[],',
  '"flags":[],"english":"free software for editing photos","asks_for_software":true,',
  '"residual":"תוכנה לעריכת תמונות"}',
  '',
  'quiero una aplicación en español para aprender a tocar la guitarra',
  '{"pricing":[],"platforms":[],"languages":["es"],"flags":[],',
  '"english":"I want an app in Spanish for learning to play the guitar",',
  '"asks_for_software":true,"residual":"quiero una aplicación para aprender a tocar la guitarra"}',
  '',
  'как убрать пятно от вина с ковра',
  '{"pricing":[],"platforms":[],"languages":[],"flags":[],',
  '"english":"how to get a wine stain out of the carpet",',
  '"asks_for_software":false,"residual":"как убрать пятно от вина с ковра"}',
].join('\n');

/* ===========================================================================
 * The reading, and the validator.
 * ======================================================================== */

/** One validated reading. Every field is present and every value is known. */
export interface QueryReading {
  pricing: PricingModel[];
  platforms: Platform[];
  languages: string[];
  flags: ToolFlag[];
  /** The sentence in English, or '' when it already was. */
  english: string;
  asksForSoftware: boolean;
  /** The sentence with the reported requirement phrases removed. */
  residual: string;
}

/** What one call cost and produced. `reading` is null when nothing valid came back. */
export interface ReaderResult {
  reading: QueryReading;
  model: string;
  tokensIn: number;
  /** Output tokens, reasoning tokens included — the provider bills both as output. */
  tokensOut: number;
}

/**
 * Raised inside this module. Carries a short reason and never the sentence.
 *
 * One error type for every call this file makes — the reader, the reranker and
 * the two halves of the statement generator — because every one of them fails
 * the same way and must report the same amount: a shape, never a body. The
 * name stays `ReaderError` because ten tests and two callers use it, and
 * renaming it would be churn dressed as tidiness.
 */
export class ReaderError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ReaderError';
  }
}

/** Why a response was refused, or null. Never quotes the response back. */
export type ValidationFailure = string;

function isStringArrayOf(value: unknown, allowed: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' && allowed.includes(v))
  );
}

/* ===========================================================================
 * `english`, and why it needs its own rules
 *
 * Until an adversarial review went at it, `english` was the one field with no
 * shape at all: the schema says "a string" and the only check was that it was
 * not a copy of the input. That was tolerable while nothing used it. It is not
 * tolerable now, because the restatement is what gets EMBEDDED — it reaches the
 * ranker, and a free-text field that reaches the ranker is a field somebody can
 * write the ranking with.
 *
 * The review fed it, and it accepted, all of these:
 *
 *   "Splitwise Tricount Settle Up Splid Tabsplit"   a list of our own tools
 *   a 399-character paragraph of advice
 *   injection prose addressed to a later reader
 *   a JSON object
 *
 * A restatement of a 200-character sentence is a short line of prose. So:
 * ======================================================================== */

/** At most this many words, however short they are. */
const MAX_ENGLISH_WORDS = 30;
/** Never shorter than this, so a terse input still permits a normal sentence. */
const MIN_ENGLISH_CHARS = 120;
/** Structure, not prose: a restatement is one line and carries no markup. */
const ENGLISH_FORBIDDEN = /[{}[\]<>\n\r\t]/;

/**
 * Is this a restatement, or is it something else wearing the field?
 *
 * Returns null when it is fine, or the reason it is not. Length is measured in
 * code points against twice the input, because a language that needs more words
 * than English to say the same thing is ordinary and a restatement three times
 * the length of the sentence is not.
 *
 * The tool-name check is NOT here, and that is deliberate: it needs the
 * catalogue, this module must stay callable with no database, and the catalogue
 * changes while a recorded reading does not. `guardReading` in lib/reading.ts
 * does it at the moment the reading is used, against the tools that exist then.
 */
export function checkEnglish(english: string, input: string): ValidationFailure | null {
  const trimmed = english.trim();
  if (trimmed === '') return null;

  const limit = Math.max(Array.from(input).length * 2, MIN_ENGLISH_CHARS);
  if (Array.from(trimmed).length > limit) {
    return `the restatement is longer than ${limit} characters`;
  }
  if (trimmed.split(/\s+/u).length > MAX_ENGLISH_WORDS) {
    return `the restatement is more than ${MAX_ENGLISH_WORDS} words`;
  }
  if (ENGLISH_FORBIDDEN.test(english)) {
    return 'the restatement carries markup or more than one line';
  }
  return null;
}

/**
 * Turn whatever came back into a reading, or say why it will not be used.
 *
 * Hand-written on purpose: a schema validator is a dependency, a dependency on
 * the path between a stranger's sentence and our database is a supply chain,
 * and the shape being checked here is seven fields.
 *
 * It refuses, in this order: a non-object; a missing key; an extra key; a value
 * of the wrong type; an enum value the catalogue does not have; a `residual`
 * longer than the sentence that produced it. The last is the one that matters
 * most — it is what stops a model that has decided to be helpful from putting
 * words into the text the ranker sees.
 *
 * @param value  the parsed JSON the model returned
 * @param input  the sentence it was given, for the residual length check
 */
export function validateReading(
  value: unknown,
  input: string,
): { reading: QueryReading } | { error: ValidationFailure } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'the response is not a JSON object' };
  }
  const obj = value as Record<string, unknown>;

  // `field` rather than `key`: in this file `key` means the API key, and
  // tests/markup.test.mjs asserts that the only string it is ever interpolated
  // into is the Authorization header. A loop variable sharing the name would
  // make that assertion meaningless.
  const present = Object.keys(obj);
  for (const field of READING_KEYS) {
    if (!present.includes(field)) return { error: `the response has no "${field}"` };
  }
  for (const field of present) {
    if (!(READING_KEYS as readonly string[]).includes(field)) {
      return { error: `the response has an extra field "${field}"` };
    }
  }

  if (!isStringArrayOf(obj.pricing, PRICING_VALUES)) {
    return { error: 'pricing is not an array of known pricing models' };
  }
  if (!isStringArrayOf(obj.platforms, PLATFORM_VALUES)) {
    return { error: 'platforms is not an array of known platforms' };
  }
  if (!isStringArrayOf(obj.languages, LANGUAGE_VALUES)) {
    return { error: 'languages is not an array of known language codes' };
  }
  if (!isStringArrayOf(obj.flags, FLAG_VALUES)) {
    return { error: 'flags is not an array of known flags' };
  }
  if (typeof obj.english !== 'string') return { error: 'english is not a string' };
  if (typeof obj.asks_for_software !== 'boolean') {
    return { error: 'asks_for_software is not a boolean' };
  }
  if (typeof obj.residual !== 'string') return { error: 'residual is not a string' };

  // Code points, not UTF-16 units, for the same reason the caps elsewhere are:
  // one emoji is one character everywhere else in this codebase.
  const inputLength = Array.from(input).length;
  if (Array.from(obj.residual).length > inputLength) {
    return { error: 'residual is longer than the sentence it was given' };
  }
  // An outer bound only. The PRECISE rules for a restatement — word count, one
  // line, no markup, no tool name — live in `checkEnglish` and are applied by
  // guardReading, which drops the field and falls back to the sentence rather
  // than throwing the whole reading away: a bad restatement is one field going
  // wrong, and the pricing and the asks_for_software beside it are still worth
  // having. What is refused HERE is a response that cannot be a restatement of
  // a 200-character sentence at all, which is a malformed answer.
  if (Array.from(obj.english).length > MAX_READER_INPUT * 2) {
    return { error: 'english is longer than any restatement of a capped sentence' };
  }

  // Duplicates are not a lie, but they would become duplicate chips and a
  // longer WHERE clause for no reason.
  return {
    reading: {
      pricing: [...new Set(obj.pricing)] as PricingModel[],
      platforms: [...new Set(obj.platforms)] as Platform[],
      languages: [...new Set(obj.languages)],
      flags: [...new Set(obj.flags)] as ToolFlag[],
      english: obj.english,
      asksForSoftware: obj.asks_for_software,
      residual: obj.residual,
    },
  };
}

/** True when a key is present. Never returns, prints or compares the key. */
export function readerConfigured(): boolean {
  for (const name of KEY_VARIABLES) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return true;
  }
  return false;
}

function apiKey(): string {
  for (const name of KEY_VARIABLES) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  throw new ReaderError('no key is set for the reader');
}

interface ResponsesPayload {
  model?: string;
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Pull the one text part out of a Responses payload.
 *
 * The output array carries a reasoning item as well as the message, and the
 * message is the one with content in it. `output_text` is the convenience field
 * the SDK synthesises; it is read first when the provider sends it and the
 * array is the fallback, so a shape change on either side is survivable.
 */
function outputText(payload: ResponsesPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text !== '') {
    return payload.output_text;
  }
  for (const item of payload.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (typeof part?.text === 'string' && part.text !== '') return part.text;
    }
  }
  return '';
}

/* ===========================================================================
 * The transport, and why there is only one of it
 *
 * Phase 5 adds three more model calls to the two Phase 4 had: a reranker over
 * the top candidates, a generator that writes problem statements for tools
 * with too few, and a verifier that checks each generated statement against
 * the tool it is about. Every one of them is the same request to the same
 * address with a different prompt and a different schema.
 *
 * They all go through `callResponses` below, and that is a rule rather than a
 * convenience. `tests/markup.test.mjs` says exactly two files in the
 * application may open a socket at all, that each holds exactly one literal
 * URL, and that `fetch` is called with that constant and nothing else. A third
 * fetch site — even in this file — would be a second place for a timeout to be
 * armed wrongly, a second place for `store: false` to be forgotten, and a
 * second body for a reviewer to check. So the feature modules (lib/rerank.ts,
 * lib/generate.ts) hold prompts, schemas and validators, import this, and
 * cannot reach the network any other way.
 *
 * What the caller may vary: the model, the instructions, the input, the
 * schema, the timeout and the output ceiling. What it may not vary: the
 * address, `store: false`, the key's source, how the timeout is armed, and the
 * fact that no error ever carries a response body.
 * ======================================================================== */

/** One request to the Responses API. Every field is required on purpose. */
export interface ResponsesRequest {
  /** The model, which the answer is then checked against. */
  model: string;
  /** The system prompt. */
  instructions: string;
  /** The user text. Already capped by the caller — see `capText` below. */
  input: string;
  /** A name for the schema, for the provider's own error messages. */
  schemaName: string;
  /** A strict, closed JSON schema. */
  schema: object;
  /** How long to wait, INCLUDING the body read. */
  timeoutMs: number;
  /** The ceiling on output tokens, reasoning tokens included. */
  maxOutputTokens: number;
}

/** What one call produced, before anything has validated its shape. */
export interface ResponsesAnswer {
  /** The parsed JSON the model returned. Unvalidated: the caller checks it. */
  parsed: unknown;
  model: string;
  tokensIn: number;
  /** Output tokens, reasoning tokens included — the provider bills both. */
  tokensOut: number;
}

/**
 * Cap a string at `limit` CODE POINTS, not UTF-16 units.
 *
 * `String.slice` counts UTF-16 units, so a string of emoji capped that way
 * hands the API half a surrogate pair. Every cap in this codebase counts code
 * points; this is the one place that does it for this file.
 */
export function capText(text: unknown, limit: number): string {
  return Array.from(String(text ?? '')).slice(0, limit).join('');
}

/**
 * Make one request. Throws `ReaderError` on anything that is not a well-formed
 * 2xx response carrying parseable JSON from the model that was asked.
 */
export async function callResponses(request: ResponsesRequest): Promise<ResponsesAnswer> {
  const key = apiKey();

  // AbortController rather than AbortSignal.timeout so the timer is cleared on
  // the success path too: a pending timer keeps a short-lived process alive,
  // and scripts/read.mjs is a short-lived process.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);

  // The timer is cleared in ONE place, after the body has been read, and that
  // is a fix rather than a tidy-up. `fetch` resolves when the HEADERS arrive;
  // a server that then trickles the body — or never finishes it — was bounded
  // by nothing, and a stalled body measured fifteen seconds against a
  // three-second timeout. `response.json()` is inside the same armed window,
  // so the abort reaches the body stream too.
  let response: Response;
  let payload: ResponsesPayload;
  try {
    response = await fetch(READER_URL, {
      method: 'POST',
      headers: {
        // The key goes in a header, which is the only place it appears in this
        // process. It is never interpolated into a URL, a log line or an error.
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      // Seven fields, and not one of them is about the visitor, the request or
      // the session. `store: false` is one of the seven: the provider keeps a
      // response by default, and the sentence somebody typed is the text
      // search_events refuses to attach to a person.
      body: JSON.stringify({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
        reasoning: { effort: 'minimal' },
        max_output_tokens: request.maxOutputTokens,
        store: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The status, and not the body: an error body from a model provider
      // routinely echoes the input back.
      throw new ReaderError(`HTTP ${response.status}`);
    }

    try {
      payload = (await response.json()) as ResponsesPayload;
    } catch (error) {
      // An abort DURING the body read arrives here rather than at the fetch,
      // so the timeout has to be recognised in both places.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ReaderError(`timed out after ${request.timeoutMs} ms`);
      }
      throw new ReaderError('response was not JSON');
    }
  } catch (error) {
    if (error instanceof ReaderError) throw error;
    // The provider's error strings can carry the request, so only the shape of
    // the failure is reported.
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new ReaderError(aborted ? `timed out after ${request.timeoutMs} ms` : 'request failed');
  } finally {
    clearTimeout(timer);
  }

  const answered =
    typeof payload.model === 'string' && payload.model ? payload.model : request.model;
  if (!answered.startsWith(request.model)) {
    throw new ReaderError(`provider answered with model ${answered}`);
  }

  const text = outputText(payload);
  if (text === '') {
    // Usually `incomplete` because the reasoning ran past max_output_tokens.
    throw new ReaderError(`the response carried no text (status ${payload.status ?? 'unknown'})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ReaderError('the response text was not JSON');
  }

  return {
    parsed,
    model: request.model,
    tokensIn: Number(payload.usage?.input_tokens ?? 0),
    tokensOut: Number(payload.usage?.output_tokens ?? 0),
  };
}

/**
 * Ask the model to read one sentence. Throws `ReaderError` on anything that is
 * not a well-formed 2xx response carrying a valid reading.
 *
 * The sentence is capped here rather than by the caller, so the 200-character
 * ceiling holds whoever is calling — the same arrangement, and the same
 * reason, as `embedTexts`.
 */
export async function readSentenceOrThrow(sentence: string): Promise<ReaderResult> {
  const capped = capText(sentence, MAX_READER_INPUT);
  if (capped.trim() === '') throw new ReaderError('the sentence is empty');

  const answer = await callResponses({
    model: READER_MODEL,
    instructions: READER_INSTRUCTIONS,
    input: capped,
    schemaName: 'query_reading',
    schema: READER_SCHEMA,
    timeoutMs: READER_TIMEOUT_MS,
    maxOutputTokens: 900,
  });

  const checked = validateReading(answer.parsed, capped);
  if ('error' in checked) throw new ReaderError(`schema: ${checked.error}`);

  return {
    reading: checked.reading,
    model: READER_MODEL,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
  };
}

/**
 * Read one sentence twice, and let the two samples vote on the one answer that
 * can empty a page.
 *
 * WHY TWICE. `asks_for_software: false` is the only field whose cost is
 * unbounded: it tells somebody with a real question that this catalogue has
 * nothing, on a page that never ran a search. And gpt-5-nano has no temperature
 * control — the parameter is refused — so at minimal reasoning effort the
 * answer has a tail. Measured, on one sentence, on the day this was written:
 *
 *   "we all paid for different bits of the holiday and now nobody knows who
 *    owes who?"          recorded once as FALSE
 *                        sampled six more times: true true true true true true
 *
 * One sample in seven, on a question about splitting a bill, would have shown
 * the "we only list software" page. Over 240 mechanical perturbations of the
 * golden set that is not a rare event, it is a certainty, and eval/run.mjs's
 * perturbation gate caught it by going red.
 *
 * So a refusal needs two votes. Both samples must say false; either one saying
 * true is a search. The other six fields come from the first sample — they are
 * bounded (a wrong constraint is one filter, and lib/reading.ts's guards throw
 * away the ones that are guesses) and a second opinion on them buys much less.
 *
 * WHAT IT COSTS. Two calls instead of one, in flight together, so no extra wall
 * time and about $0.00028 a search against a ceiling of $0.002. A cached
 * sentence costs neither, because what is stored is the reading after the vote.
 *
 * Null — and one line on the server's error log, with no key and no sentence in
 * it — when no key is set, the provider is down, both calls time out, the
 * status is not 2xx, the response is malformed, or the validator refused it.
 * Every one of those leaves the caller with the rules-only reading it already
 * has, which is the Phase 3 product and renders perfectly well.
 *
 * ONE SAMPLE IS NOT A VOTE. When the second call fails and the first says
 * false, the reading is used with `asksForSoftware` forced back to true: a
 * refusal that could not be corroborated is not a refusal.
 */
export async function readSentence(sentence: string): Promise<ReaderResult | null> {
  if (!readerConfigured()) return null;

  const [first, second] = await Promise.allSettled([
    readSentenceOrThrow(sentence),
    readSentenceOrThrow(sentence),
  ]);

  const primary = first.status === 'fulfilled' ? first.value : null;
  const secondary = second.status === 'fulfilled' ? second.value : null;
  const chosen = primary ?? secondary;

  if (!chosen) {
    const failure = first.status === 'rejected' ? first.reason : second.status === 'rejected' ? second.reason : null;
    const reason = failure instanceof ReaderError ? failure.message : 'unexpected failure';
    // One line, no sentence, no key, no response body. The search carries on
    // with what the rules read; nobody sees an error page over this.
    console.error(`the sentence reader was unavailable (${reason}); the rules pass stands`);
    return null;
  }

  const corroborated =
    primary !== null &&
    secondary !== null &&
    primary.reading.asksForSoftware === false &&
    secondary.reading.asksForSoftware === false;

  // The restatement gets the second sample too, and for the opposite reason:
  // here the tail is a MISSING answer rather than a wrong one. Told to restate
  // a non-English sentence in English, the model sometimes returns the empty
  // string — measured at five of the ten non-English golden queries in one
  // recording and none in the next — and an empty restatement costs the vector
  // leg the whole of what it was for.
  //
  // Taking whichever sample produced one is safe in a way that taking either
  // sample's CONSTRAINTS would not be: a restatement is only ever embedded. It
  // cannot become a WHERE clause, so a second chance at it can add a vector and
  // can never delete an answer.
  const english =
    chosen.reading.english.trim() !== ''
      ? chosen.reading.english
      : ((primary?.reading.english.trim() ? primary.reading.english : null) ??
        (secondary?.reading.english.trim() ? secondary.reading.english : null) ??
        '');

  return {
    reading: { ...chosen.reading, asksForSoftware: !corroborated, english },
    model: chosen.model,
    tokensIn: (primary?.tokensIn ?? 0) + (secondary?.tokensIn ?? 0),
    tokensOut: (primary?.tokensOut ?? 0) + (secondary?.tokensOut ?? 0),
  };
}
