// ===========================================================================
// The eval harness's one door into the sentence reader.
//
// `eval/run.mjs --read-query` measures the path a visitor actually takes:
// sentence in, the rules pass, the model's reading of what the rules missed,
// the merged constraints, the residual text searched, and the text embedded.
// This module is the only place in eval/ and scripts/ that names any of the
// modules that do that, so replacing them is a change here and nowhere else.
//
// The contract it depends on — and the whole of it:
//
//   readQuery(sentence)                  -> { constraints, text, emptyText }
//   toSearchConstraints(cs)              -> { pricing, platforms, flags, languages }
//   readSentenceWith(sentence, [], r, o) -> a merged reading
//   validateReading(value, input)        -> { reading } | { error }
//
// Composed in the same order app/results/page.tsx composes them, so a
// difference in the numbers can only have come from a difference in the
// reading, which is the point of the mode.
//
// WHERE THE MODEL'S READING COMES FROM. Never from the API, here. The harness
// must be reproducible by anyone with no key and no spend, so a reading is
// either handed in by the caller — eval/run.mjs reads it back out of
// public.query_readings, which scripts/read.mjs --from-fixture filled — or it
// is null and the sentence measures rules-only, exactly as a visitor's search
// would when the model is unreachable.
// ===========================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readQuery, toSearchConstraints } from '../lib/constraints.ts';
import { validateReading } from '../lib/reader-model.ts';
import { readSentenceWith } from '../lib/reading.ts';
import { normalizeQuery } from '../lib/embeddings.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(ROOT, 'db', 'seed', 'embeddings.fixture.json');

/** The constraint keys search_tools takes, in the order run.mjs passes them. */
const SEARCH_KEYS = ['pricing', 'platforms', 'flags', 'languages'];

/**
 * The recorded readings, keyed by normalised sentence, or an empty map.
 *
 * Used by scripts/embed.mjs when it works out which sentences the shipped path
 * will embed. eval/run.mjs does not use this: it reads the readings back out of
 * the database, so the migration and the definer functions are on the measured
 * path rather than beside it.
 */
export function fixtureReadings() {
  try {
    const parsed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    return parsed?.readings ?? {};
  } catch {
    return {};
  }
}

/**
 * Turn a stored reading — the seven snake_case fields, as the database holds
 * them — into the shape lib/reading.ts takes, or null if it will not validate.
 *
 * It is validated again here rather than trusted. A row in a cache is not more
 * trustworthy than the model answer it came from; it is the same answer, later.
 */
export function readingFromStored(stored, sentence) {
  if (!stored) return null;
  const checked = validateReading(stored, normalizeQuery(sentence));
  return 'reading' in checked ? checked.reading : null;
}

/**
 * Read one sentence the way the application reads it.
 *
 * @param {string} sentence  the query exactly as the eval file has it
 * @param {object|null} stored  the reading from public.query_readings, or null
 * @param {object} options   merge options — see lib/reading.ts
 * @returns {{
 *   text: string,            what full-text search ranks on
 *   embedText: string,       what the vector leg embeds
 *   emptyText: boolean,      true when nothing is left to rank on
 *   constraints: Record<string, string[]>,  golden-set shape: non-empty keys only
 *   keys: string[],          what was understood, for the report
 *   asksForSoftware: boolean,  false means the page refuses before searching
 *   usedModel: boolean,
 *   fromModel: string[],     which constraints the model contributed
 *   refused: object[],       what the guards threw away
 *   english: string,
 * }}
 *
 * The returned `constraints` object is deliberately in the golden set's own
 * shape — a key is present only when it has values — so both slices are scored
 * and constraint-checked by identical code.
 */
export function readForSearch(sentence, stored = null, options = {}) {
  const model = readingFromStored(stored, sentence);
  const merged = readSentenceWith(sentence, [], model, options);

  const search = toSearchConstraints(merged.constraints);
  const constraints = {};
  for (const key of SEARCH_KEYS) {
    const values = search[key];
    if (Array.isArray(values) && values.length > 0) {
      constraints[key] = values.map((v) => String(v));
    }
  }

  return {
    text: merged.text,
    embedText: merged.embedText,
    emptyText: merged.text === '',
    constraints,
    keys: merged.constraints.map((c) => String(c.key)),
    asksForSoftware: merged.asksForSoftware,
    usedModel: merged.usedModel,
    fromModel: merged.fromModel,
    refused: merged.refused,
    english: merged.english,
  };
}

/**
 * The rules pass alone — what Phase 3 shipped.
 *
 * Kept so `--read-query` can print the three columns side by side: the golden
 * set's own constraints, what the rules alone read, and what the rules and the
 * model read together. Without it, "the reader improved" is a claim about a
 * number with nothing under it.
 */
export function readRulesOnly(sentence) {
  const reading = readQuery(sentence);
  const search = toSearchConstraints(reading.constraints);
  const constraints = {};
  for (const key of SEARCH_KEYS) {
    const values = search[key];
    if (Array.isArray(values) && values.length > 0) {
      constraints[key] = values.map((v) => String(v));
    }
  }
  return {
    text: reading.text,
    embedText: reading.text,
    emptyText: Boolean(reading.emptyText),
    constraints,
    keys: reading.constraints.map((c) => String(c.key)),
    asksForSoftware: true,
    usedModel: false,
    fromModel: [],
    refused: [],
    english: '',
  };
}
