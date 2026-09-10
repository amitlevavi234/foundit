// ===========================================================================
// The eval harness's one door into the sentence reader.
//
// `eval/run.mjs --read-query` measures the path a visitor actually takes:
// sentence in, constraints read out of it, the residual text searched. To do
// that it has to call the same reader the results screen calls. This module is
// the only place in eval/ that names that reader, and it exists so there is
// exactly one line to change when Phase 4 replaces lib/constraints.ts
// wholesale.
//
// The contract it depends on — and the whole of it:
//
//   readQuery(sentence)            -> { constraints, text, emptyText }
//   toSearchConstraints(cs)        -> { pricing, platforms, flags, languages }
//
// Two exported names, composed in the same order app/results/page.tsx composes
// them. Nothing here knows which rules exist, how many there are, what any of
// them match, or what a constraint key is called: `key` is carried through as
// an opaque string that is only ever printed. A reader that reads different
// things, or reads them a different way, changes the numbers this mode reports
// — which is the point of the mode — without changing a character of it.
// ===========================================================================

import { readQuery, toSearchConstraints } from '../lib/constraints.ts';

/** The constraint keys search_tools takes, in the order run.mjs passes them. */
const SEARCH_KEYS = ['pricing', 'platforms', 'flags', 'languages'];

/**
 * Read one golden sentence the way the app reads it.
 *
 * @param {string} sentence  the query exactly as it appears in golden.jsonl
 * @returns {{
 *   text: string,            what full-text search should rank on
 *   emptyText: boolean,      true when the sentence was nothing but constraints
 *   constraints: Record<string, string[]>,  golden-set shape: only non-empty keys
 *   keys: string[],          what the reader says it understood, for the report
 * }}
 *
 * The returned `constraints` object is deliberately in the golden set's own
 * shape — a key is present only when it has values — so the two slices are
 * scored and constraint-checked by the identical code, and a difference in the
 * numbers can only have come from a difference in the constraints or the text.
 */
export function readForSearch(sentence) {
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
    emptyText: Boolean(reading.emptyText),
    constraints,
    keys: reading.constraints.map((c) => String(c.key)),
  };
}
