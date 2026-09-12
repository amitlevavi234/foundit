import type { MatchSource, ToolResultDetail } from './types';

/* ===========================================================================
 * What the results screen decides before it draws anything.
 *
 * Kept out of the page component so each decision can be tested without a
 * database, a browser or a render: which of the four states the screen is in,
 * what may honestly be said about how well a result matched, and whether the
 * one clarifying question is worth asking.
 * ======================================================================== */

/** The four states drawn in Results, ResultsLoading, ResultsEmpty, ResultsClarifier. */
export type ResultsView = 'prompt' | 'too-long' | 'empty' | 'results';

export function resultsView(options: {
  query: string;
  tooLong: boolean;
  resultCount: number;
}): ResultsView {
  if (!options.query.trim()) return 'prompt';
  if (options.tooLong) return 'too-long';
  if (options.resultCount === 0) return 'empty';
  return 'results';
}

/**
 * Where a result matched, in words. Not how well.
 *
 * **This is the FALLBACK band since Phase 5.** Where the reranker ran, the band
 * on a card is its judgement — Strong, Possible or Loose, from `relevanceBand`
 * in lib/rerank.ts — because something has read the sentence against that
 * listing and formed a view. Where it did not run (no key, a timeout, the daily
 * cap), the band is what is described below: a LOCATION. The results page says
 * which of the two it is showing, and the two are worded so a reader can tell
 * them apart.
 *
 * There is no percentage in either of them, and there is not going to be one
 * until there are pairs a PERSON has judged to calibrate against — see
 * `/ranking` and `eval/calibrate.mjs`. `ToolResult.score` is a Reciprocal Rank
 * Fusion sum — an ordering number — and rescaling it into "92% fit" would be a
 * lie the interface tells with a straight face (lib/fit.ts says the same
 * thing, which is why it has no `scoreToFit`).
 *
 * `match_source` is the one fact the database reports about a match, and it is
 * a *location*: which of a tool's texts the query's lexemes turned up in. It
 * is not a measure of fit, and it must not be worded as one. Retrieval is
 * any-of with no relevance floor, so a single shared word — "split" — puts a
 * PDF splitter in the answer to a question about holiday expenses with
 * `match_source = 'both'`, because that word really does appear in a problem
 * PDFsam lists and in its own description. Calling that a "strong match" is
 * the interface asserting a ranking quality nothing measured; calling it
 * "matched: problem + description" is the truth, and lets the reader judge.
 *
 * So: the label names the place, the note says what turned up there, and
 * neither promises the tool is any good for the question that was asked.
 */
export type MatchTone = 'both' | 'one' | 'name';

export interface MatchBand {
  label: string;
  note: string;
  tone: MatchTone;
}

export function matchBand(source: MatchSource): MatchBand | null {
  switch (source) {
    case 'both':
      return {
        label: 'Matched: problem + description',
        note: 'Your words turned up in a problem this tool lists and in its own description.',
        tone: 'both',
      };
    case 'problem':
      return {
        label: 'Matched: problem',
        note: 'Your words turned up in a problem this tool says it solves.',
        tone: 'one',
      };
    case 'tool':
      return {
        label: 'Matched: description',
        note: 'Your words turned up in this tool’s own description.',
        tone: 'one',
      };
    case 'name':
      return {
        label: 'Matched: name only',
        note: 'Only the name looks like what you typed.',
        tone: 'name',
      };
    // The vector leg, added in db/migrations/0004_vectors.sql. Nothing the
    // person typed appears in this listing anywhere; it is here because the
    // sentence is close in meaning to a problem the tool says it solves. That
    // is a weaker claim than a word actually turning up, and it gets the same
    // quiet tone as a name-only rescue — but it is a different claim, so it
    // gets its own words rather than being folded into one of the others.
    case 'vector':
      return {
        label: 'Matched: meaning',
        note: 'Nothing you typed appears in this listing — it was matched by meaning, not by words.',
        tone: 'name',
      };
    // 'browse' is not a match at all: no sentence was typed, so there is
    // nothing that turned up anywhere.
    default:
      return null;
  }
}

/**
 * The problem statement this tool lists that the sentence actually matched, or
 * null when nothing in its statements did. `matchedStrength` is `ts_rank_cd`
 * of that statement against the same any-of query the search retrieves with,
 * so zero means "we are showing you its first statement, not a match" — and in
 * that case nothing is shown.
 */
export function matchedProblemOf(result: ToolResultDetail): string | null {
  if (!result.matchedProblem) return null;
  return result.matchedStrength > 0 ? result.matchedProblem : null;
}

/* --- the one clarifying question ---------------------------------------- */

export interface Clarifier {
  question: string;
  options: Array<{ slug: string; name: string; count: number }>;
}

/** Words that carry no subject. Enough to tell a short sentence from a bare one. */
const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'with', 'and', 'or', 'my', 'me', 'i',
  'is', 'it', 'that', 'this', 'something', 'anything', 'tool', 'app', 'need', 'want',
  'looking', 'help', 'some', 'way', 'can', 'find', 'get', 'good', 'best',
]);

export function contentWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

/**
 * Ask one question, or none.
 *
 * The artboard asks a specific question — "a one-off trip, or ongoing shared
 * costs like a flat?" — which needs a model reading the sentence, and that is
 * Phase 4. What can be asked honestly today comes out of the answer we already
 * have: when a short, unspecific sentence returns tools scattered across
 * several parts of the catalogue, the spread itself is the ambiguity, and the
 * categories are the options. Nothing is invented and nothing is hidden — the
 * results are drawn underneath the question, not held back behind it.
 *
 * "Scattered" has to mean something, though, or the question fires on every
 * short sentence and is noise. Two floors, and both come from what the word
 * means rather than from a number that made the tests pass:
 *
 *   the answer is not already decided — the largest category holds less than
 *   about half of the categorised results. "notes" returning Writing·6 out of
 *   ten is not scattered, it is answered, and interrupting it to offer
 *   "Health · 1" wastes the one question a search gets.
 *
 *   an option is a corner of the catalogue, not a stray — a category with a
 *   single tool in the answer is that tool, and picking it is the same as
 *   clicking it, so it is not offered as a way to narrow anything.
 *
 * Below two surviving options there is no choice left to make, so no question
 * is asked. One question per search, as the design says: once it has been
 * answered or skipped it does not come back.
 */
export function clarifier(options: {
  query: string;
  results: readonly ToolResultDetail[];
  answered: boolean;
  /** How many constraints the sentence stated. Any at all, and it is specific. */
  constraintCount?: number;
  minResults?: number;
  maxWords?: number;
  /** How many options must survive the floor before a question is worth asking. */
  minOptions?: number;
  /** An option holding fewer than this is a stray result, not a corner. */
  minPerOption?: number;
  /** The largest category must hold less than this share, or it is the answer. */
  maxTopShare?: number;
}): Clarifier | null {
  const { query, results, answered } = options;
  const minResults = options.minResults ?? 6;
  const maxWords = options.maxWords ?? 5;
  const minOptions = options.minOptions ?? 2;
  const minPerOption = options.minPerOption ?? 2;
  const maxTopShare = options.maxTopShare ?? 0.5;

  if (answered) return null;
  // Somebody who said "free" and "in Spanish" has told us what they want; the
  // spread of the answer is the catalogue's shape, not their vagueness.
  if ((options.constraintCount ?? 0) > 0) return null;
  if (results.length < minResults) return null;
  if (contentWords(query).length > maxWords) return null;

  const counts = new Map<string, { slug: string; name: string; count: number }>();
  let categorised = 0;
  for (const result of results) {
    if (!result.categorySlug || !result.categoryName) continue;
    const entry = counts.get(result.categorySlug) ?? {
      slug: result.categorySlug,
      name: result.categoryName,
      count: 0,
    };
    entry.count += 1;
    counts.set(result.categorySlug, entry);
    categorised += 1;
  }

  // The share is measured against the results the options actually describe.
  // A row with no primary category is in none of them and cannot be narrowed
  // to, so counting it would make every answer look more scattered than it is.
  if (categorised < minResults) return null;

  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );

  const largest = ranked[0];
  if (!largest || largest.count >= categorised * maxTopShare) return null;

  const offered = ranked.filter((entry) => entry.count >= minPerOption).slice(0, 4);
  if (offered.length < minOptions) return null;

  return {
    question: 'Which of these is it closest to?',
    options: offered,
  };
}
