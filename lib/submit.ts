/**
 * What a submitted listing has to be, checked without a database.
 *
 * The rule this file exists to keep: **every check here is made again in
 * PostgreSQL**, and the database's answer is the one that counts. 0017 carries
 * the CHECK constraints, the column grants and the definer functions; what is
 * here is the same arithmetic done early so a person is told which field is
 * wrong instead of being shown a constraint name.
 *
 * Two consequences of that ordering, both deliberate:
 *
 *   NOTHING HERE IS A PERMISSION CHECK. Who may edit what is
 *   `public.tool_is_mine`, in the database, and this file does not know who is
 *   asking.
 *
 *   A REFUSAL HERE IS A FIELD AND A SENTENCE, never a stack trace and never
 *   the submitted text echoed into a log. `lib/sql.ts`'s `QueryTooLongError`
 *   is the pattern: carry the length, not the string.
 *
 * Nothing in this file opens a socket, and nothing in it fetches the submitted
 * URL. Not a HEAD request to see whether it resolves, not a favicon, not a
 * page read to fill the form in. docs/product-decisions.md §12 draws the line:
 * the visitor's browser goes to the maker's site, our server never does, and
 * tests/markup.test.mjs pins the list of files that may call `fetch` at three.
 * The SubmitURL artboard draws a "Read the page" button; what it does here is
 * check the address and move to the next step, and the screen says so.
 */
import type { Platform, PricingModel, ToolFlag } from './types';

/* ===========================================================================
 * Control characters
 *
 * The same set `public.control_character_class()` names in 0017: C0, DEL, C1,
 * U+2028 and U+2029. If these two ever disagree, the database wins and a
 * person sees a constraint violation instead of a helpful message, which is
 * the safe direction and is still a bug.
 *
 * Written with String.fromCharCode for the two separators rather than an
 * escape, for the reason scripts/scan-control-bytes.mjs exists: on this
 * machine a shell heredoc turns a written escape into the byte itself, and a
 * character class that silently lost a range is a guard that passes and
 * protects nothing.
 * ======================================================================== */

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const CONTROL_CHARACTERS = new RegExp(
  `[\\x00-\\x1F\\x7F-\\x9F${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`,
  'gu',
);

/** True when `text` still carries something the database would refuse. */
export function hasControlCharacters(text: string): boolean {
  CONTROL_CHARACTERS.lastIndex = 0;
  return CONTROL_CHARACTERS.test(text);
}

/**
 * Remove every control character, collapse runs of whitespace, and trim.
 *
 * The whitespace collapse is this side only and is not a disagreement with the
 * database: stripping a newline out of "one thing.<newline>Another thing."
 * would otherwise leave "one thing.Another thing.", which is a worse sentence
 * than the one the person typed. The database's function strips and trims; it
 * does not need to collapse, because by the time a string reaches it there is
 * nothing left to collapse.
 */
export function cleanText(text: unknown): string {
  return String(text ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ===========================================================================
 * The field rules, which are 0001's and 0017's CHECK constraints in English
 * ======================================================================== */

export const NAME_MAX = 120;
export const SUMMARY_MIN = 20;
export const SUMMARY_MAX = 400;
export const STATEMENT_MIN = 8;
export const STATEMENT_MAX = 200;
/** `public.statements_max()`. One number, and the database holds the other copy. */
export const STATEMENTS_MAX = 8;
export const URL_MAX = 500;
export const EVIDENCE_MAX = 500;

export const PRICING_MODELS: readonly PricingModel[] = [
  'free',
  'freemium',
  'free_trial',
  'paid',
  'open_source',
  'donation',
];

export const PLATFORMS: readonly Platform[] = [
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
];

export const TOOL_FLAGS: readonly ToolFlag[] = [
  'works_offline',
  'no_account_needed',
  'no_ads',
  'has_free_tier',
  'exports_data',
  'e2e_encrypted',
  'accessible',
];

/**
 * The languages the SubmitConstraints artboard's token field offers.
 *
 * English names, stored as English names, because that is what
 * `db/seed/dev_seed.sql` put in `tools.languages` and search compares against
 * it. A closed list rather than free text: "full interface only" is a claim
 * somebody can check, and a free-text field would fill the column with
 * "english", "EN", "Eng" and "english (mostly)", none of which a filter can
 * match.
 */
export const LANGUAGES: readonly string[] = [
  'English',
  'Spanish',
  'Portuguese',
  'French',
  'German',
  'Italian',
  'Dutch',
  'Polish',
  'Russian',
  'Turkish',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Chinese',
  'Japanese',
  'Korean',
];

/* ===========================================================================
 * A refusal
 * ======================================================================== */

export interface FieldProblem {
  /** The form control to point at. */
  field: string;
  /** One sentence, in the product's voice, naming what to do about it. */
  message: string;
}

/** The URL as submitted: https, parseable, and nothing we will ever fetch. */
export function checkUrl(raw: unknown): FieldProblem | null {
  const value = cleanText(raw);
  if (value === '') {
    return { field: 'url', message: 'Paste the address where the tool lives.' };
  }
  if (value.length > URL_MAX) {
    return {
      field: 'url',
      message: `That address is ${value.length} characters; ${URL_MAX} is the most we store.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      field: 'url',
      message: 'That is not an address a browser could open. It should start with https://',
    };
  }
  if (parsed.protocol !== 'https:') {
    return {
      field: 'url',
      message:
        'Only https addresses are stored, because the link is rendered for people to click.',
    };
  }
  if (parsed.hostname === '' || !parsed.hostname.includes('.')) {
    return { field: 'url', message: 'That address has no domain in it.' };
  }
  return null;
}

/**
 * An evidence link on a claim: optional, https, stored and never fetched.
 *
 * The same shape as `checkUrl` and a separate function on purpose — the
 * messages are the claim screen's, and "optional" means an empty value is fine
 * here and is not fine there.
 */
export function checkEvidenceUrl(raw: unknown): FieldProblem | null {
  const value = cleanText(raw);
  if (value === '') return null;
  if (value.length > EVIDENCE_MAX) {
    return {
      field: 'evidence',
      message: `That link is ${value.length} characters; ${EVIDENCE_MAX} is the most we store.`,
    };
  }
  if (!value.startsWith('https://')) {
    return {
      field: 'evidence',
      message: 'An evidence link has to start with https:// — it is shown as text, never opened by us.',
    };
  }
  try {
    new URL(value);
  } catch {
    return { field: 'evidence', message: 'That is not a link a browser could open.' };
  }
  return null;
}

/* ===========================================================================
 * The whole submission
 * ======================================================================== */

export interface Submission {
  name: string;
  url: string;
  summary: string;
  pricing: PricingModel;
  platforms: Platform[];
  languages: string[];
  flags: ToolFlag[];
  statements: string[];
}

export interface SubmissionCheck {
  /** Cleaned and ready for the database, whether or not it passed. */
  value: Submission;
  problems: FieldProblem[];
}

function pickMany<T extends string>(
  raw: readonly unknown[] | null | undefined,
  allowed: readonly T[],
): T[] {
  const set = new Set(allowed as readonly string[]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of raw ?? []) {
    const value = cleanText(item);
    // An unknown value is DROPPED rather than refused. These are checkboxes
    // and the only way to send one the form did not draw is to send it by
    // hand, and a person who does that gets the listing they asked for minus
    // the value the database has no enum member for — which is what the
    // database would say anyway, less politely.
    if (!set.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value as T);
  }
  return out;
}

/**
 * Clean and check one submission.
 *
 * Returns the cleaned value ALONGSIDE the problems, so a form that has to be
 * redrawn shows what the person typed rather than an empty page. That is why
 * this does not throw.
 */
export function checkSubmission(input: {
  name?: unknown;
  url?: unknown;
  summary?: unknown;
  pricing?: unknown;
  platforms?: readonly unknown[] | null;
  languages?: readonly unknown[] | null;
  flags?: readonly unknown[] | null;
  statements?: readonly unknown[] | null;
}): SubmissionCheck {
  const problems: FieldProblem[] = [];

  const name = cleanText(input.name);
  if (name === '') {
    problems.push({ field: 'name', message: 'What is it called?' });
  } else if (name.length > NAME_MAX) {
    problems.push({
      field: 'name',
      message: `That name is ${name.length} characters; ${NAME_MAX} is the most that fits.`,
    });
  }

  const url = cleanText(input.url);
  const urlProblem = checkUrl(url);
  if (urlProblem) problems.push(urlProblem);

  const summary = cleanText(input.summary);
  if (summary.length < SUMMARY_MIN) {
    problems.push({
      field: 'summary',
      message:
        summary === ''
          ? 'One line saying what it does.'
          : `A summary is at least ${SUMMARY_MIN} characters; this one is ${summary.length}.`,
    });
  } else if (summary.length > SUMMARY_MAX) {
    problems.push({
      field: 'summary',
      message: `That summary is ${summary.length} characters; ${SUMMARY_MAX} is the most that fits.`,
    });
  }

  const pricingValue = cleanText(input.pricing) as PricingModel;
  const pricing = PRICING_MODELS.includes(pricingValue) ? pricingValue : 'free';
  if (!PRICING_MODELS.includes(pricingValue)) {
    problems.push({ field: 'pricing', message: 'Pick how it is paid for.' });
  }

  const platforms = pickMany(input.platforms, PLATFORMS);
  if (platforms.length === 0) {
    problems.push({ field: 'platforms', message: 'Pick at least one place it runs.' });
  }

  const languages = pickMany(input.languages, LANGUAGES);
  const flags = pickMany(input.flags, TOOL_FLAGS);

  // Statements: cleaned, blanks dropped, duplicates dropped, order kept. The
  // same order as public.set_owner_statements, and for the same reason — the
  // person typed them in that order and the first one is the one shown under a
  // result.
  const statements: string[] = [];
  for (const raw of input.statements ?? []) {
    const value = cleanText(raw);
    if (value === '') continue;
    if (statements.includes(value)) continue;
    if (value.length < STATEMENT_MIN) {
      problems.push({
        field: 'statements',
        message: `"${value}" is too short to search for. A problem statement is at least ${STATEMENT_MIN} characters.`,
      });
      continue;
    }
    if (value.length > STATEMENT_MAX) {
      problems.push({
        field: 'statements',
        message: `One of the problem statements is ${value.length} characters; ${STATEMENT_MAX} is the most.`,
      });
      continue;
    }
    statements.push(value);
  }
  if (statements.length === 0) {
    problems.push({
      field: 'statements',
      message: 'Describe at least one problem it solves — this is what people search for.',
    });
  }
  if (statements.length > STATEMENTS_MAX) {
    problems.push({
      field: 'statements',
      message: `${STATEMENTS_MAX} problem statements is the most one listing carries.`,
    });
  }

  return {
    value: { name, url, summary, pricing, platforms, languages, flags, statements },
    problems,
  };
}

/**
 * Just enough to create the draft row: a name, an https address, a summary.
 *
 * A narrower check than `checkSubmission` on purpose. The draft is created at
 * step 3 of six, before anybody has said what platforms it runs on or what
 * problems it solves, and those two are what `checkSubmission` refuses a
 * listing for. Refusing them here would mean refusing the row that the next two
 * steps exist to fill in.
 *
 * The Preview step runs the WHOLE check before publishing, so a listing cannot
 * reach the catalogue with the gaps this one tolerates.
 */
export function checkDraftBasics(input: {
  name?: unknown;
  url?: unknown;
  summary?: unknown;
}): { value: { name: string; url: string; summary: string }; problems: FieldProblem[] } {
  const checked = checkSubmission({ ...input, pricing: 'free', platforms: ['web'], statements: [
    // A placeholder that satisfies only the statements rule, which this check
    // deliberately does not make. It never reaches the database: the caller
    // takes name, url and summary off the result and nothing else.
    'a placeholder that this check does not return',
  ] });
  return {
    value: {
      name: checked.value.name,
      url: checked.value.url,
      summary: checked.value.summary,
    },
    problems: checked.problems.filter(
      (problem) => problem.field === 'name' || problem.field === 'url' || problem.field === 'summary',
    ),
  };
}

/* ===========================================================================
 * The slug
 *
 * `tools.slug` is citext and unique, and it is the listing's public address.
 * It is derived from the name here rather than typed, because a person typing
 * their own URL segment is a person typing somebody else's.
 * ======================================================================== */

/** A slug from a name: lower case, ASCII, hyphens, no leading or trailing one. */
export function slugFor(name: string): string {
  const base = cleanText(name)
    .toLowerCase()
    // Anything that is not a letter, a digit or a hyphen becomes a hyphen.
    // Deliberately ASCII-only: a slug is a URL segment, and a percent-encoded
    // one is not an address anybody can read out loud.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base;
}

/**
 * Candidate slugs for one name, in the order to try them.
 *
 * The same shape as `collectionSlugCandidates` in lib/account-sql.ts, and for
 * the same reason: uniqueness belongs to the database, so the application
 * offers it a list and takes the first one it accepts rather than asking
 * whether a slug is free and then racing somebody to it.
 *
 * A name with nothing ASCII in it — "日本語のツール" — slugs to the empty
 * string, which is not a URL. Those fall back to `tool-<n>`, which is honest:
 * the name is still the name and the address is just an address.
 */
export function slugCandidates(name: string, attempts = 50): string[] {
  const base = slugFor(name) || 'tool';
  const out = [base];
  for (let n = 2; out.length < attempts; n += 1) out.push(`${base}-${n}`);
  return out;
}
