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
 * How well a result matched, in words, and why.
 *
 * There is no percentage here and there is not going to be one until Phase 5
 * calibrates against judged examples. `ToolResult.score` is a Reciprocal Rank
 * Fusion sum — an ordering number — and rescaling it into "92% fit" would be a
 * lie the interface tells with a straight face (lib/fit.ts says the same
 * thing, which is why it has no `scoreToFit`).
 *
 * What can be said honestly is where the match happened, because the database
 * reports that as a fact: `match_source`. Strong means the sentence matched
 * both a problem the tool lists and the tool's own description. Possible means
 * one of the two. Loose means only the name looked similar. The band is that
 * fact, worded; the note is the fact itself, so nobody has to trust the band.
 */
export type MatchTone = 'strong' | 'possible' | 'loose';

export interface MatchBand {
  label: string;
  note: string;
  tone: MatchTone;
}

export function matchBand(source: MatchSource): MatchBand | null {
  switch (source) {
    case 'both':
      return {
        label: 'Strong match',
        note: 'Matched a problem this tool lists and its own description.',
        tone: 'strong',
      };
    case 'problem':
      return {
        label: 'Possible match',
        note: 'Matched a problem this tool says it solves.',
        tone: 'possible',
      };
    case 'tool':
      return {
        label: 'Possible match',
        note: 'Matched this tool’s own description.',
        tone: 'possible',
      };
    case 'name':
      return {
        label: 'Loose match',
        note: 'Only the name looks like what you typed.',
        tone: 'loose',
      };
    // 'browse' is not a relevance judgement: no sentence was typed, so there
    // is nothing to say about how well anything matched.
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
 * One question per search, as the design says: once it has been answered or
 * skipped it does not come back.
 */
export function clarifier(options: {
  query: string;
  results: readonly ToolResultDetail[];
  answered: boolean;
  /** How many constraints the sentence stated. Any at all, and it is specific. */
  constraintCount?: number;
  minResults?: number;
  maxWords?: number;
  minCategories?: number;
}): Clarifier | null {
  const { query, results, answered } = options;
  const minResults = options.minResults ?? 6;
  const maxWords = options.maxWords ?? 5;
  const minCategories = options.minCategories ?? 3;

  if (answered) return null;
  // Somebody who said "free" and "in Spanish" has told us what they want; the
  // spread of the answer is the catalogue's shape, not their vagueness.
  if ((options.constraintCount ?? 0) > 0) return null;
  if (results.length < minResults) return null;
  if (contentWords(query).length > maxWords) return null;

  const counts = new Map<string, { slug: string; name: string; count: number }>();
  for (const result of results) {
    if (!result.categorySlug || !result.categoryName) continue;
    const entry = counts.get(result.categorySlug) ?? {
      slug: result.categorySlug,
      name: result.categoryName,
      count: 0,
    };
    entry.count += 1;
    counts.set(result.categorySlug, entry);
  }

  if (counts.size < minCategories) return null;

  const top = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    question: 'Which of these is it closest to?',
    options: top.slice(0, 4),
  };
}
