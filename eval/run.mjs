#!/usr/bin/env node
// ===========================================================================
// Foundit — search evaluation harness.
//
// Runs every query in eval/golden.jsonl through public.search_tools() and
// reports recall@10, nDCG@10, latency, and constraint compliance.
//
// This file is the measuring instrument. Every later phase has to beat the
// number it produces, so it is deliberately boring: no network beyond
// PostgreSQL, no model calls, no colour codes, no spinners, no cleverness in
// the arithmetic that a reader cannot check by hand.
//
// It never writes to the database. In particular it does not log to
// search_events — the app does that in production, and a benchmark run must
// not pollute the analytics it is meant to inform.
//
// Usage:
//   DATABASE_URL=... node eval/run.mjs [--json] [--baseline] [--limit=N]
//                                      [--timeout=MS] [--golden=PATH]
//                                      [--baselines=PATH] [--read-query]
//                                      [--negatives=PATH]
//
// The negatives (eval/negatives.jsonl) are the other half of the instrument
// since the relevance floor (db/migrations/0006_relevance_floor.sql): thirty
// sentences the catalogue genuinely cannot answer, whose right answer is an
// empty page. nDCG never asks a question that has no answer, so without them
// a search that pads every page with its nearest neighbours scores exactly as
// well as one that says "nothing fits". See eval/README.md, "The negatives".
//
// --read-query adds a second, opt-in slice that derives each query's
// constraints and search text from lib/constraints.ts instead of reading them
// out of golden.jsonl, and reports the two side by side. See eval/README.md,
// "Measuring the reader". Nothing about the default run changes.
//
// Exit codes (see eval/README.md):
//   0  success
//   1  usage / configuration error (no DATABASE_URL, no golden set, bad JSONL)
//   2  constraint violation — a returned tool broke a hard filter
//   3  connection or query error
//   4  regression against the recorded baseline
// ===========================================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

import { perturbations } from './perturb.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

// --- Tunables, all in one place --------------------------------------------

/** Cutoff for both metrics. recall@K and nDCG@K. */
export const K = 10;

/**
 * How many rows we ask search_tools for. Larger than K on purpose: scoring
 * only ever looks at the first K, but fetching a few more lets the "worst
 * queries" report say "the right answer was sitting at rank 14", which is the
 * difference between a number and a lead. Constraint checking applies to
 * every row returned, not just the first K — a hard filter is a WHERE clause,
 * so a violation at rank 17 is exactly as wrong as one at rank 1.
 */
const DEFAULT_FETCH_LIMIT = 20;

/** Per-query statement timeout, milliseconds. Also enforced server-side. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Regression tolerance on nDCG@10, absolute.
 *
 * 0.005 — half a point of nDCG. The harness is deterministic (same database,
 * same golden set, same SQL gives the same ranking), so in principle any drop
 * is real. The tolerance exists for the one source of genuine noise: ties in
 * ts_rank broken by whatever order the planner happened to produce. A change
 * that costs more than half a point is a regression and someone has to say
 * why. Raise this only with a written reason in eval/baselines.md.
 */
const REGRESSION_TOLERANCE = 0.005;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = path.join(ROOT, 'eval');
const GOLDEN_PATH = path.join(EVAL_DIR, 'golden.jsonl');
/** Sentences with no right answer but "nothing". Never merged into the golden set. */
const NEGATIVES_PATH = path.join(EVAL_DIR, 'negatives.jsonl');
/** The held-out negatives: written by a reviewer, never tuned against. */
const HELD_OUT_PATH = path.join(EVAL_DIR, 'negatives.review.jsonl');
/**
 * The SECOND held-out negatives file, written by the Phase 5 reviewer before
 * reading anything, and spent the moment it is tuned against — same rule as the
 * first, one review later. 25 sentences: 8 far, 17 near.
 */
const HELD_OUT2_PATH = path.join(EVAL_DIR, 'negatives.review2.jsonl');
/**
 * And 15 sentences that DO have answers, with the slugs a person would accept.
 *
 * Every other file here asks "does the search stop showing things it should
 * not". This one asks the opposite and is the reason it exists: a reranker that
 * empties more pages scores better on every negatives file and worse at the
 * job. Reported, never gated — it is held out, and gating on it would spend it.
 */
const POSITIVES_PATH = path.join(EVAL_DIR, 'positives.review.jsonl');
/**
 * Where a recording's summary is written, so a number in eval/baselines.md has
 * something behind it other than a sentence saying it happened.
 */
const RECORDINGS_DIR = path.join(EVAL_DIR, 'recordings');
/**
 * A negative is far from anything the catalogue does, a near miss, or
 * non-English. The held-out file uses the third; both files are read exactly
 * as their authors wrote them and neither is ever edited here.
 */
export const NEGATIVE_KINDS = ['far', 'near', 'nonen'];
const BASELINES_PATH = path.join(EVAL_DIR, 'baselines.md');
const RESULTS_DIR = path.join(EVAL_DIR, 'results');
/** The recorded vectors that let a keyless run measure the real hybrid search. */
const FIXTURE_PATH = path.join(ROOT, 'db', 'seed', 'embeddings.fixture.json');

/**
 * What this process exits with, and what each one means to a person reading a
 * red step in CI.
 *
 *   0  the run finished and nothing regressed
 *   1  the command line was wrong: an unknown flag, a missing file, a number
 *      where a number does not belong
 *   2  THERE WAS NO CONNECTION STRING. A separate code from 1 on purpose, and
 *      it is the Phase 8 review's margin note: this harness reads DATABASE_URL
 *      from the environment and from nowhere else, and the one way to run it
 *      is `node --env-file=.env.local eval/run.mjs`. A CI step that forgets
 *      the env file is not a typo in a flag — it is a step that measured
 *      nothing and must be told apart from one that measured something and
 *      found it wrong.
 *   3  the database answered badly, or stopped answering
 *   4  nDCG@10 fell below the recorded baseline by more than the tolerance
 *
 * `CONSTRAINT_VIOLATION` used to be 2 and was never returned by anything, so
 * nothing keyed on it and the number was free.
 */
export const EXIT = {
  OK: 0,
  USAGE: 1,
  NO_CONNECTION: 2,
  DATABASE: 3,
  REGRESSION: 4,
};

/** The constraint keys the golden set may carry, and the SQL type of each. */
const CONSTRAINT_KEYS = ['pricing', 'platforms', 'flags', 'languages'];

// ===========================================================================
// Scoring. Pure functions, no I/O — eval/scoring.test.mjs checks these
// against cases worked out by hand.
// ===========================================================================

/**
 * Graded gain for one result.
 *
 *   gain(rel) = 2^rel - 1
 *
 * So rel 3 -> 7, rel 2 -> 3, rel 1 -> 1, unjudged -> 0. The exponential is
 * the standard Järvelin & Kekäläinen formulation: it says a 3 is worth more
 * than two 2s, which is the behaviour we want from a search that is supposed
 * to put the one right tool first.
 */
export function gain(rel) {
  return Math.pow(2, rel) - 1;
}

/**
 * Discounted cumulative gain over an ordered list of relevance grades.
 *
 *   DCG@k = SUM over i = 1..min(k, n) of  (2^rel_i - 1) / log2(i + 1)
 *
 * i is 1-based rank, so the first result is divided by log2(2) = 1 (no
 * discount) and the tenth by log2(11) ~ 3.459.
 */
export function dcg(grades, k = K) {
  let total = 0;
  const upto = Math.min(k, grades.length);
  for (let i = 0; i < upto; i += 1) {
    total += gain(grades[i]) / Math.log2(i + 2); // i is 0-based -> rank i+1
  }
  return total;
}

/**
 * nDCG@k for one query.
 *
 *   nDCG@k = DCG@k(what came back) / DCG@k(the best possible ordering)
 *
 * The ideal ordering comes from *this query's own judgements*: take every
 * graded slug, sort the grades descending, and score the top k of them. That
 * is the ceiling a perfect search could reach for this query, so nDCG is 1.0
 * only when the top k are the k best judged tools in the right order.
 *
 * A query with no judgements has an ideal DCG of 0. There is no meaningful
 * ratio there, so this returns 0 and the caller flags the query — a golden
 * entry with an empty `relevant` map is a bug in the golden set, not a score
 * of zero for the search.
 */
export function ndcg(retrievedGrades, judgedGrades, k = K) {
  const ideal = [...judgedGrades].sort((a, b) => b - a);
  const idcg = dcg(ideal, k);
  if (idcg <= 0) return 0;
  return dcg(retrievedGrades, k) / idcg;
}

/**
 * recall@k — of every tool judged relevant for this query (any grade >= 1),
 * what fraction turned up in the top k?
 *
 *   recall@k = |relevant AND retrieved-in-top-k| / |relevant|
 *
 * Ungraded (grade 0) entries are not "relevant" and never count toward the
 * denominator. A query with no judged tools has no denominator; this returns
 * 0 and the caller flags it, same as nDCG.
 */
export function recall(retrievedSlugs, relevantMap, k = K) {
  const relevantSlugs = Object.keys(relevantMap).filter((s) => relevantMap[s] >= 1);
  if (relevantSlugs.length === 0) return 0;
  const top = new Set(retrievedSlugs.slice(0, k));
  let hits = 0;
  for (const slug of relevantSlugs) if (top.has(slug)) hits += 1;
  return hits / relevantSlugs.length;
}

/** Unweighted mean. Every query counts the same, whatever its difficulty. */
export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * p95 by the nearest-rank method: sort ascending, take the value at
 * ceil(0.95 * n). No interpolation — with 60 queries interpolating invents
 * precision that is not there, and nearest-rank always returns a latency that
 * was actually observed.
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Check one query's results against its hard constraints.
 *
 * This function is a second opinion on db/migrations/0002_search.sql, so its
 * semantics have to be the SAME semantics, key for key. Where the two ever
 * disagreed, "0 constraint violations" certified less than it looked like.
 * The mapping, and the line of SQL each one mirrors:
 *
 *   pricing    ANY-OF, membership.  `t.pricing = any (v_pricing)`
 *   platforms  ANY-OF, overlap.     `t.platforms && v_platforms`
 *   flags      ALL-OF, containment. `t.flags @> v_flags`
 *   languages  ANY-OF, overlap, and the wanted side is lower-cased first,
 *              exactly as the SQL lower-cases p_languages before comparing:
 *              `t.languages && v_langs`, v_langs = lower(btrim(...)).
 *
 * flags being ALL-OF is the whole reason a flag is not a platform: "offline
 * and no ads" states two requirements and a tool with only one of them is
 * out. An any-of test here would agree with the SQL on every catalogue that
 * happens not to breach it, and go quiet on the one that does.
 *
 * The languages comparison lower-cases only the WANTED side, because that is
 * all the SQL lower-cases. A catalogue row storing "EN" would be excluded by
 * search_tools and, if it somehow came back anyway, is reported here — which
 * is the behaviour we want from a checker, not a courtesy fold-case that
 * hides it.
 *
 * A tool with an empty array cannot satisfy an overlap constraint, and that is
 * correct: if a query asked for Spanish and the tool declares no languages,
 * the catalogue does not support the claim that it fits. An empty `flags` on
 * the tool likewise fails any non-empty all-of requirement.
 *
 * Independently of the query's own constraints, every returned tool must be
 * published. search_tools carries `t.status = 'published'` as an explicit
 * predicate rather than leaning on row-level security, precisely because RLS
 * lets an owner see their own drafts; if that predicate were ever dropped the
 * eval would have reported clean without this check.
 *
 * @param facts  {status, pricing, platforms, flags, languages} from public.tools
 * @returns array of violation objects, empty when clean
 */
export function checkConstraints(query, results, factsBySlug) {
  const constraints = query.constraints ?? {};
  const violations = [];

  for (const row of results) {
    const facts = factsBySlug.get(row.slug);
    if (!facts) {
      violations.push({
        queryId: query.id,
        slug: row.slug,
        rank: row.rank,
        key: '(lookup)',
        wanted: [],
        got: 'not found in public.tools',
        detail: 'search_tools returned a slug that does not exist in the tools table',
      });
      continue;
    }

    // Unpublished rows must never reach a search result, whatever the query
    // asked for. This is not one of the golden set's constraints; it is the
    // one predicate search_tools applies on every single call.
    if (facts.status !== 'published') {
      violations.push({
        queryId: query.id,
        slug: row.slug,
        rank: row.rank,
        key: 'status',
        wanted: ['published'],
        got: String(facts.status),
        detail: 'search_tools returned a tool that is not published',
      });
    }

    // Cross-check: the function must not report a pricing different from the
    // row it came from. If these disagree, one of them is lying to the user.
    if (row.pricing !== facts.pricing) {
      violations.push({
        queryId: query.id,
        slug: row.slug,
        rank: row.rank,
        key: 'pricing',
        wanted: [String(facts.pricing)],
        got: String(row.pricing),
        detail: 'search_tools reported a pricing that disagrees with public.tools',
      });
    }

    for (const key of CONSTRAINT_KEYS) {
      const wanted = constraints[key];
      if (!Array.isArray(wanted) || wanted.length === 0) continue;

      if (key === 'pricing') {
        if (!wanted.includes(facts.pricing)) {
          violations.push({
            queryId: query.id,
            slug: row.slug,
            rank: row.rank,
            key,
            wanted,
            got: String(facts.pricing),
            detail: 'pricing is not one of the requested values',
          });
        }
      } else if (key === 'flags') {
        // ALL-OF. Mirrors `t.flags @> v_flags`.
        const have = Array.isArray(facts.flags) ? facts.flags : [];
        const missing = wanted.filter((v) => !have.includes(v));
        if (missing.length > 0) {
          violations.push({
            queryId: query.id,
            slug: row.slug,
            rank: row.rank,
            key,
            wanted,
            got: have.length ? have.join(',') : '(none declared)',
            detail: `tool.flags is missing every requested flag it must have: ${missing.join(',')}`,
          });
        }
      } else {
        // ANY-OF. Mirrors `t.platforms && v_platforms` and
        // `t.languages && v_langs`; for languages the wanted side is
        // lower-cased first, because that is what the SQL does to p_languages.
        const have = Array.isArray(facts[key]) ? facts[key] : [];
        const want = key === 'languages' ? wanted.map((v) => String(v).trim().toLowerCase()) : wanted;
        const overlaps = have.some((v) => want.includes(v));
        if (!overlaps) {
          violations.push({
            queryId: query.id,
            slug: row.slug,
            rank: row.rank,
            key,
            wanted,
            got: have.length ? have.join(',') : '(none declared)',
            detail: `tool.${key} does not overlap the requested values`,
          });
        }
      }
    }
  }

  return violations;
}

/** True when the query carries at least one non-empty constraint array. */
export function isConstrained(query) {
  const c = query.constraints;
  if (!c || typeof c !== 'object') return false;
  return CONSTRAINT_KEYS.some((k) => Array.isArray(c[k]) && c[k].length > 0);
}

/** Aggregate a list of per-query results into the numbers we report. */
export function aggregate(perQuery) {
  const latencies = perQuery.map((q) => q.latencyMs);
  return {
    queries: perQuery.length,
    recallAt10: mean(perQuery.map((q) => q.recall)),
    ndcgAt10: mean(perQuery.map((q) => q.ndcg)),
    meanLatencyMs: mean(latencies),
    p95LatencyMs: percentile(latencies, 95),
    zeroResultQueries: perQuery.filter((q) => q.resultCount === 0).length,
  };
}

// ===========================================================================
// Golden set
// ===========================================================================

/**
 * Parse golden.jsonl. One JSON object per line; blank lines and lines whose
 * first non-space character is # are skipped. Every problem is reported with
 * its line number, because a silent skip in the measuring instrument is how
 * you end up confidently reporting a number for 43 of your 60 queries.
 */
export function parseGolden(text) {
  const queries = [];
  const errors = [];
  const seenIds = new Set();
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      errors.push(`line ${lineNo}: not valid JSON — ${err.message}`);
      return;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(`line ${lineNo}: expected a JSON object`);
      return;
    }
    if (typeof obj.id !== 'string' || obj.id === '') {
      errors.push(`line ${lineNo}: missing "id"`);
      return;
    }
    if (seenIds.has(obj.id)) {
      errors.push(`line ${lineNo}: duplicate id "${obj.id}"`);
      return;
    }
    seenIds.add(obj.id);
    if (typeof obj.query !== 'string' || obj.query.trim() === '') {
      errors.push(`line ${lineNo} (${obj.id}): missing "query"`);
      return;
    }
    if (obj.relevant === null || typeof obj.relevant !== 'object' || Array.isArray(obj.relevant)) {
      errors.push(`line ${lineNo} (${obj.id}): "relevant" must be an object of slug -> grade`);
      return;
    }
    // From here on, problems are collected rather than returned early, so one
    // bad line reports everything wrong with it at once. An entry with any
    // problem is not returned — `queries` only ever holds fully valid entries,
    // and the run aborts on the first error anyway.
    const entryErrors = [];

    for (const [slug, grade] of Object.entries(obj.relevant)) {
      if (!Number.isInteger(grade) || grade < 1 || grade > 3) {
        entryErrors.push(`line ${lineNo} (${obj.id}): grade for "${slug}" must be 1, 2 or 3 — got ${JSON.stringify(grade)}`);
      }
    }

    const constraints = {};
    if (obj.constraints !== undefined) {
      if (obj.constraints === null || typeof obj.constraints !== 'object' || Array.isArray(obj.constraints)) {
        errors.push(`line ${lineNo} (${obj.id}): "constraints" must be an object`);
        return;
      }
      for (const [key, value] of Object.entries(obj.constraints)) {
        if (!CONSTRAINT_KEYS.includes(key)) {
          entryErrors.push(`line ${lineNo} (${obj.id}): unknown constraint "${key}" (expected one of ${CONSTRAINT_KEYS.join(', ')})`);
          continue;
        }
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          entryErrors.push(`line ${lineNo} (${obj.id}): constraint "${key}" must be an array of strings`);
          continue;
        }
        // An empty array is treated as "no constraint": passing '{}' to an
        // overlap test would match nothing and silently zero the query.
        if (value.length > 0) constraints[key] = value;
      }
    }

    if (entryErrors.length > 0) {
      errors.push(...entryErrors);
      return;
    }

    queries.push({
      id: obj.id,
      query: obj.query,
      lang: typeof obj.lang === 'string' && obj.lang ? obj.lang : 'en',
      note: typeof obj.note === 'string' ? obj.note : '',
      constraints,
      relevant: obj.relevant,
      line: lineNo,
    });
  });

  return { queries, errors };
}

/**
 * Parse eval/negatives.jsonl: sentences the catalogue genuinely cannot answer.
 *
 * Same line format and the same strictness as the golden set — every problem
 * reported with its line number — with one difference that is the whole point:
 * a negative has NO `relevant` map. Its right answer is an empty page. An entry
 * that carries judgements is refused rather than quietly scored, because a
 * sentence with a right tool is a golden query and belongs in the golden set,
 * which this file must never become a side door into.
 *
 * `kind` is "far" (car repair, a lawyer, a jacket) or "near" (shares words
 * with real listings and wants something none of them does). It is reported,
 * never scored differently: a near miss that leaks is exactly as wrong as a far
 * one, it is just the more likely of the two.
 */
export function parseNegatives(text) {
  const queries = [];
  const errors = [];
  const seenIds = new Set();

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      errors.push(`line ${lineNo}: not valid JSON — ${err.message}`);
      return;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(`line ${lineNo}: expected a JSON object`);
      return;
    }
    if (typeof obj.id !== 'string' || obj.id === '') {
      errors.push(`line ${lineNo}: missing "id"`);
      return;
    }
    if (seenIds.has(obj.id)) {
      errors.push(`line ${lineNo}: duplicate id "${obj.id}"`);
      return;
    }
    seenIds.add(obj.id);
    // "query" in eval/negatives.jsonl, "q" in the first held-out review file,
    // "sentence" in the second. All three are read; NO FILE IS EVER REWRITTEN
    // TO SUIT THIS PARSER — a held-out set edited to fit the harness is a
    // held-out set the harness has touched.
    const text =
      typeof obj.query === 'string'
        ? obj.query
        : typeof obj.q === 'string'
          ? obj.q
          : obj.sentence;
    if (typeof text !== 'string' || text.trim() === '') {
      errors.push(`line ${lineNo} (${obj.id}): missing "query" (or "q", or "sentence")`);
      return;
    }
    if (
      obj.relevant !== undefined &&
      (obj.relevant === null ||
        typeof obj.relevant !== 'object' ||
        Array.isArray(obj.relevant) ||
        Object.keys(obj.relevant).length > 0)
    ) {
      errors.push(
        `line ${lineNo} (${obj.id}): a negative has no right answer, so it carries no "relevant" map — ` +
          'a sentence with a right tool belongs in eval/golden.jsonl',
      );
      return;
    }
    const kind = obj.kind === undefined ? 'far' : obj.kind;
    if (!NEGATIVE_KINDS.includes(kind)) {
      errors.push(`line ${lineNo} (${obj.id}): "kind" must be one of ${NEGATIVE_KINDS.join(', ')}`);
      return;
    }

    const constraints = {};
    const entryErrors = [];
    if (obj.constraints !== undefined) {
      if (obj.constraints === null || typeof obj.constraints !== 'object' || Array.isArray(obj.constraints)) {
        errors.push(`line ${lineNo} (${obj.id}): "constraints" must be an object`);
        return;
      }
      for (const [key, value] of Object.entries(obj.constraints)) {
        if (!CONSTRAINT_KEYS.includes(key)) {
          entryErrors.push(`line ${lineNo} (${obj.id}): unknown constraint "${key}"`);
          continue;
        }
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          entryErrors.push(`line ${lineNo} (${obj.id}): constraint "${key}" must be an array of strings`);
          continue;
        }
        if (value.length > 0) constraints[key] = value;
      }
    }
    if (entryErrors.length > 0) {
      errors.push(...entryErrors);
      return;
    }

    queries.push({
      id: obj.id,
      query: text,
      lang: typeof obj.lang === 'string' && obj.lang ? obj.lang : 'en',
      note: typeof obj.note === 'string' ? obj.note : '',
      kind,
      constraints,
      relevant: {},
      line: lineNo,
    });
  });

  return { queries, errors };
}

/**
 * Parse a positives file: a sentence, and the slugs a person would accept.
 *
 * `expect` is a LIST because more than one tool can be a right answer — five
 * expense splitters all answer "who paid for what". What is scored is whether
 * ANY of them is first, and whether any is on the page at all.
 */
export function parsePositives(text) {
  const queries = [];
  const errors = [];
  const seen = new Set();

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      errors.push(`line ${lineNo}: not valid JSON — ${err.message}`);
      return;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(`line ${lineNo}: expected a JSON object`);
      return;
    }
    if (typeof obj.id !== 'string' || obj.id === '') {
      errors.push(`line ${lineNo}: missing "id"`);
      return;
    }
    if (seen.has(obj.id)) {
      errors.push(`line ${lineNo}: duplicate id "${obj.id}"`);
      return;
    }
    seen.add(obj.id);
    const sentence =
      typeof obj.sentence === 'string' ? obj.sentence : typeof obj.query === 'string' ? obj.query : obj.q;
    if (typeof sentence !== 'string' || sentence.trim() === '') {
      errors.push(`line ${lineNo} (${obj.id}): missing "sentence"`);
      return;
    }
    if (!Array.isArray(obj.expect) || obj.expect.length === 0 || obj.expect.some((s) => typeof s !== 'string')) {
      errors.push(`line ${lineNo} (${obj.id}): "expect" must be a non-empty array of slugs`);
      return;
    }

    queries.push({
      id: obj.id,
      query: sentence,
      lang: typeof obj.lang === 'string' && obj.lang ? obj.lang : 'en',
      expect: obj.expect.map(String),
      // So the same scoring code can run over them: a positive has no graded
      // map, and nothing here is scored with nDCG.
      relevant: {},
      constraints: {},
      kind: 'positive',
      line: lineNo,
    });
  });

  return { queries, errors };
}

/**
 * What the positives say: is an acceptable answer first, and is one there at
 * all.
 *
 * Two numbers rather than one, because they fail differently. A tool that slips
 * from rank 1 to rank 3 is a worse page; a tool that leaves the page is a
 * person who does not find it. The reranker can do both — it reorders and it
 * drops.
 */
export function aggregatePositives(entries) {
  const first = entries.filter((e) => e.results.length > 0 && e.query.expect.includes(e.results[0].slug));
  const anywhere = entries.filter((e) => e.results.some((r) => e.query.expect.includes(r.slug)));
  const empty = entries.filter((e) => e.results.length === 0);
  return {
    queries: entries.length,
    rankOne: first.length,
    onThePage: anywhere.length,
    empty: empty.length,
  };
}

/**
 * What the negatives say, in two numbers and a breakdown.
 *
 *   emptyRate   the share that came back with nothing at all — the right
 *               answer. The headline, and what --baseline gates.
 *   meanLeaked  how many rows came back per negative, averaged over all of
 *               them, at the fetch limit. A negative that leaks one tool and a
 *               negative that leaks twenty are both wrong, and this is the
 *               number that tells them apart.
 */
export function aggregateNegatives(entries) {
  const counts = entries.map((e) => e.results.length);
  const byKind = {};
  for (const kind of NEGATIVE_KINDS) {
    const subset = entries.filter((e) => e.query.kind === kind);
    byKind[kind] = {
      queries: subset.length,
      empty: subset.filter((e) => e.results.length === 0).length,
    };
  }
  const empty = counts.filter((c) => c === 0).length;
  return {
    queries: entries.length,
    empty,
    emptyRate: entries.length ? empty / entries.length : 0,
    meanLeaked: mean(counts),
    maxLeaked: counts.length ? Math.max(...counts) : 0,
    byKind,
    meanLatencyMs: mean(entries.map((e) => e.latencyMs)),
    p95LatencyMs: percentile(entries.map((e) => e.latencyMs), 95),
  };
}

// ===========================================================================
// Baselines
// ===========================================================================

/**
 * `"26 of 30"` -> {count: 26, total: 30}. `"**0 of 240**"` is the same thing
 * with markdown in it. An empty cell is null — that column gates nothing.
 *
 * Anything else THROWS. A gate whose input it cannot read must not quietly
 * become no gate: the previous version returned null for "twenty-six of
 * thirty", for "26 / 30", and for a typo, and null means "this row does not
 * gate that", so a mistake in the table silently switched the gate off. The
 * only two readings are a number and nothing.
 */
export function parseCountOf(cell, column = 'a count') {
  const text = String(cell ?? '').replace(/\*/g, '').trim();
  if (text === '' || text === '-' || text === '—') return null;
  const m = /^(\d+)\s*(?:of|\/)\s*(\d+)$/i.exec(text) ?? /^(\d+)$/.exec(text);
  if (!m) {
    throw new Error(
      `${column} reads ${JSON.stringify(String(cell))}, which is not "N of M", "N/M" or a number. ` +
        'Fix the row in eval/baselines.md: a gate that cannot read its own baseline must fail, not pass.',
    );
  }
  const count = Number(m[1]);
  const total = m[2] === undefined ? null : Number(m[2]);
  if (total !== null && (total === 0 || count > total)) {
    throw new Error(`${column} reads ${JSON.stringify(String(cell))}, which is not a share of anything.`);
  }
  return { count, total };
}

/**
 * Read eval/baselines.md and return every row that actually has numbers in it,
 * oldest first.
 *
 * Header-driven on purpose. baselines.md holds more than one markdown table,
 * and a positional parser would happily read the per-slice table's nDCG column
 * as if it were a headline baseline and then fail builds against it. So: a
 * table is only the recorded-baselines table if its header row carries both
 * "Commit" and "nDCG@10", and cells are looked up by column name, not index.
 * Rows still in template form — the empty Phase 2 row — have no parseable
 * nDCG and are skipped.
 */
export function parseBaselines(markdown) {
  const rows = [];
  let columns = null; // {name -> index} for the table currently being read

  const splitRow = (line) => {
    const t = line.trim();
    return t
      .slice(1, t.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
  };

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      // Any non-table line ends the current table.
      if (trimmed !== '') columns = null;
      continue;
    }
    const cells = splitRow(trimmed);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // separator

    const lower = cells.map((c) => c.toLowerCase());
    const looksLikeHeader = lower.includes('ndcg@10');
    if (looksLikeHeader) {
      if (lower.includes('commit') && lower.includes('phase')) {
        columns = {};
        lower.forEach((name, i) => {
          columns[name] = i;
        });
      } else {
        columns = null; // some other table that happens to report nDCG
      }
      continue;
    }
    if (!columns) continue;

    const cell = (name) => {
      const i = columns[name];
      return i === undefined ? '' : (cells[i] ?? '');
    };
    const ndcgValue = Number.parseFloat(cell('ndcg@10'));
    if (!Number.isFinite(ndcgValue)) continue; // template / not yet recorded

    // A row marked WITHDRAWN is not a baseline. eval/baselines.md already
    // holds one — a Phase 2 number measured against a corpus written to be
    // found, through a connection that bypassed row-level security — and it is
    // kept because deleting it would hide what happened.
    //
    // Only the status cell and the commit cell are read for that word, and
    // only where a marker belongs: at the START of the note, as
    // "**WITHDRAWN — …**". Reading every cell, anywhere in it, meant a later
    // row could withdraw ITSELF by describing what happened to an earlier one
    // ("the row above was withdrawn because…"), which would delete a perfectly
    // good baseline and quietly gate against an older number.
    // REVERTED is the second word, added in Phase 5, and it means something
    // different from WITHDRAWN. A withdrawn row described a code path nobody
    // ran. A reverted row is a real measurement of a real change that was then
    // taken out again because it did not move the number — Phase 5's generated
    // problem statements, which cost 0.0247 of nDCG and were deleted. Both
    // belong in the table, because deleting either would hide what happened,
    // and NEITHER may be the row a later run is gated against: the code that
    // produced it is not in the tree.
    const NOT_A_BASELINE = /^[*_\s]*(withdrawn|reverted)\b/i;
    if ([cell('what changed'), cell('commit')].some((c) => NOT_A_BASELINE.test(c))) continue;

    rows.push({
      date: cell('date') || '(no date)',
      commit: cell('commit') || '(no commit)',
      phase: cell('phase') || '?',
      queries: Number.parseInt(cell('queries'), 10),
      recallAt10: Number.parseFloat(cell('recall@10')),
      ndcgAt10: ndcgValue,
      // Whether that row was measured WITH the vector leg. A text-only number
      // and a hybrid number are measurements of two different searches, and
      // comparing one against the other is how a build goes red for a reason
      // that has nothing to do with anybody's change. Empty on rows recorded
      // before the column existed, which is handled in pickBaseline.
      vectors: cell('vectors').toLowerCase(),
      // Two gates besides nDCG, both read off the same row. Blank on rows
      // recorded before the relevance floor, and a blank gate is skipped
      // rather than invented.
      // What share of the searches in that run had a reranker judgement. A row
      // recorded at 96% and a run at 60% are measuring different amounts of
      // Phase 5, and without this the second passes quietly.
      rerankCoverage: parseCountOf(cell('rerank coverage'), 'the Rerank coverage column'),
      zeroResult: parseCountOf(cell('zero-result'), 'the Zero-result column'),
      negativesEmpty: parseCountOf(cell('negatives empty'), 'the Negatives empty column'),
      heldOutEmpty: parseCountOf(cell('held-out empty'), 'the Held-out empty column'),
      perturbedEmpty: parseCountOf(cell('perturbed empty'), 'the Perturbed empty column'),
      note: cell('what changed'),
    });
  }
  return rows;
}

/**
 * Which recorded row this run should be compared against.
 *
 * A run has a mode: either every sentence had a query vector, or some did not
 * — no key, no cache, a provider that was down. Those two produce different
 * numbers from the same code, so the gate picks the newest row recorded in the
 * SAME mode.
 *
 * When nothing matches — a baselines.md written before the column existed —
 * it falls back to the newest row and says so. Falling back rather than
 * skipping is deliberate: a gate that quietly turns itself off is worse than
 * one that occasionally compares the wrong pair loudly.
 */
export function pickBaseline(rows, vectorsUsed) {
  if (rows.length === 0) return null;
  const want = vectorsUsed ? 'yes' : 'no';
  const matching = rows.filter((r) => r.vectors === want);
  if (matching.length > 0) return { row: matching[matching.length - 1], sameMode: true };
  return { row: rows[rows.length - 1], sameMode: false };
}

/**
 * A run regresses when nDCG@10 falls more than REGRESSION_TOLERANCE below the
 * most recently recorded baseline. Improvements and small wobbles pass.
 */
export function checkRegression(current, baseline, tolerance = REGRESSION_TOLERANCE) {
  const delta = current - baseline.ndcgAt10;
  // 1e-12 guard: a drop of exactly the tolerance computes as -0.005000000000000004
  // in binary floating point and would otherwise fail a build on a rounding
  // artefact. The boundary is inclusive — a drop *of* the tolerance passes, a
  // drop *past* it does not.
  return {
    regressed: -delta > tolerance + 1e-12,
    delta,
    tolerance,
    baseline,
  };
}

/**
 * A golden query that comes back empty is a person with a real problem shown
 * a page saying Foundit has nothing for it. The relevance floor makes that
 * possible for the first time since Phase 3, so the count is gated: no more
 * empty golden queries than the recorded row had. Null when the row does not
 * record the count.
 */
export function checkZeroResultRegression(currentZero, baseline) {
  const recorded = baseline?.zeroResult;
  if (!recorded) return null;
  return {
    regressed: currentZero > recorded.count,
    current: currentZero,
    recorded: recorded.count,
  };
}

/**
 * The negatives gate: the share of eval/negatives.jsonl answered with an empty
 * page must not fall below the share the recorded row achieved. A rate rather
 * than a count, so adding negatives later does not trip it by arithmetic.
 *
 * `current` null means the negatives were not run. Against a row that records
 * them that is a FAILURE, not a pass: a gate that switches itself off when its
 * input file goes missing is the failure this harness keeps being built to
 * prevent.
 */
export function checkNegativesRegression(current, baseline) {
  return checkEmptyRateRegression(current, baseline?.negativesEmpty);
}

/** The same gate, against the held-out file's own recorded share. */
export function checkHeldOutRegression(current, baseline) {
  return checkEmptyRateRegression(current, baseline?.heldOutEmpty);
}

/**
 * Every golden query is also searched four ways it might have been typed — a
 * full stop, a question mark, a "please", one transposed letter. None of them
 * may empty a page.
 *
 * Zero is the gate, not "no worse than recorded": a floor that depends on
 * punctuation is not a floor, and the first version of this one sat a
 * thousandth above a golden query's best match. Without a vector there is no
 * floor at all, so the count is whatever Phase 2's retrieval does and the
 * recorded row is what it is compared against.
 */
export function checkPerturbationGate(currentEmpty, baseline, vectorsUsed) {
  if (vectorsUsed) {
    return { regressed: currentEmpty > 0, current: currentEmpty, allowed: 0, recorded: null };
  }
  const recorded = baseline?.perturbedEmpty;
  if (!recorded) return null;
  return {
    regressed: currentEmpty > recorded.count,
    current: currentEmpty,
    allowed: recorded.count,
    recorded,
  };
}

/**
 * How much of this run was actually Phase 5.
 *
 * A sentence with no recorded judgement measures the Phase 4 order. That is the
 * honest fallback and it is printed — and it was printed and nothing else, so a
 * fixture that had lost half its judgements would have produced a number
 * somewhere between the two phases with a green gate over it.
 *
 * Five percentage points, not zero, because a judgement is allowed to go
 * missing: a sentence added to an eval file has none until somebody records
 * one, and the run should say so rather than fail. Losing a twentieth of them
 * is a different thing and it fails.
 */
export const COVERAGE_TOLERANCE = 0.05;

export function checkCoverageRegression(current, baseline) {
  const recorded = baseline?.rerankCoverage;
  if (!recorded || !recorded.total) return null;
  const recordedRate = recorded.count / recorded.total;
  if (!current || !current.searches) {
    return { regressed: true, missing: true, recordedRate, recorded };
  }
  const rate = current.judged / current.searches;
  return {
    regressed: rate < recordedRate - COVERAGE_TOLERANCE - 1e-12,
    missing: false,
    rate,
    recordedRate,
    recorded,
    current,
  };
}

function checkEmptyRateRegression(current, recorded) {
  if (!recorded || !recorded.total) return null;
  const recordedRate = recorded.count / recorded.total;
  if (!current) {
    return { regressed: true, missing: true, recordedRate, recorded };
  }
  const rate = current.queries ? current.empty / current.queries : 0;
  return {
    // 1e-12 for the same reason checkRegression has one: two equal rates
    // computed from different counts must not differ in the last bit.
    regressed: rate < recordedRate - 1e-12,
    missing: false,
    rate,
    recordedRate,
    recorded,
    current,
  };
}

// ===========================================================================
// Plain text table. Aligned with spaces only — no ANSI, no box drawing,
// nothing that turns into mojibake when someone pastes the log into a chat
// window as evidence.
// ===========================================================================

export function renderTable(headers, rows, aligns = []) {
  const all = [headers, ...rows].map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const pad = (cell, i) => (aligns[i] === 'r' ? cell.padStart(widths[i]) : cell.padEnd(widths[i]));
  const line = (r) => r.map(pad).join('  ').trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(all[0]), rule, ...all.slice(1).map(line)].join('\n');
}

const n4 = (v) => v.toFixed(4);
const n1 = (v) => v.toFixed(1);
// Plain ASCII dots, not U+2026: the report is meant to be pasted anywhere,
// including a console that is not speaking UTF-8.
const truncate = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 3)}...`);

/** Wrap a list of short labels into indented lines of `perLine` items. */
function wrapList(items, label, perLine = 5) {
  if (items.length === 0) return [`    ${label.padEnd(9)} (nothing)`];
  const lines = [];
  for (let i = 0; i < items.length; i += perLine) {
    const chunk = items.slice(i, i + perLine).join('  ');
    lines.push(i === 0 ? `    ${label.padEnd(9)} ${chunk}` : `    ${' '.repeat(9)} ${chunk}`);
  }
  return lines;
}

// ===========================================================================
// Secret hygiene
// ===========================================================================

/**
 * pg puts the host and sometimes the whole connection target into error
 * messages. Nothing derived from DATABASE_URL is ever allowed onto stdout, so
 * every message goes through here first.
 */
function makeRedactor(databaseUrl) {
  const secrets = [];
  if (databaseUrl) {
    secrets.push(databaseUrl);
    try {
      const u = new URL(databaseUrl);
      if (u.password) secrets.push(decodeURIComponent(u.password), u.password);
      if (u.username) secrets.push(decodeURIComponent(u.username), u.username);
      if (u.host) secrets.push(u.host);
      if (u.hostname) secrets.push(u.hostname);
    } catch {
      // Not a URL we can parse; the whole-string replacement above still holds.
    }
  }
  const unique = [...new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 3))]
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text ?? '');
    for (const secret of unique) out = out.split(secret).join('[redacted]');
    return out;
  };
}

// ===========================================================================
// The run
// ===========================================================================

function parseArgs(argv) {
  const opts = {
    json: false,
    baseline: false,
    limit: DEFAULT_FETCH_LIMIT,
    timeout: DEFAULT_TIMEOUT_MS,
    golden: GOLDEN_PATH,
    baselines: BASELINES_PATH,
    baselinesExplicit: false,
    negatives: NEGATIVES_PATH,
    negativesExplicit: false,
    heldOut: HELD_OUT_PATH,
    heldOutExplicit: false,
    heldOut2: HELD_OUT2_PATH,
    positives: POSITIVES_PATH,
    /** Write a summary of this run into eval/recordings/<name>.json. */
    record: null,
    /**
     * How the headline pass reads each sentence.
     *
     *   shipped  rules + the model's cached reading, merged — what a visitor
     *            gets, and the default from Phase 4 on
     *   rules    lib/constraints.ts alone — what Phase 3 shipped
     *   written  the golden set's own hand-written constraints — the Phase 2
     *            and 3 instrument, kept so the old number is still reachable
     */
    plan: 'shipped',
    /** Merge options, so the alternatives are measured rather than argued. */
    merge: 'rules-win',
    text: 'rules',
    embed: 'english',
    /** Which dimensions the model may contribute; 'none' for none of them. */
    accept: 'pricing',
    /** Whether `asks_for_software: false` empties the page. */
    refuse: true,
    readQuery: false,
    /**
     * Phase 5's reranker.
     *
     * ON by default, because from Phase 5 it is part of the shipped path and
     * the headline number is what a visitor gets. `--no-rerank` measures the
     * Phase 4 search, which is how the before/after in eval/baselines.md was
     * taken and how it can be taken again.
     */
    rerank: true,
    /** How many candidates are judged. Measured at 20, 30 and 50. */
    rerankN: null,
    /**
     * The lowest grade that still reaches a page. Null means the shipped
     * `RERANK_SHOWN_FROM`.
     *
     * A SWEEP FLAG THAT COSTS NOTHING, which is the point of it. The threshold
     * is applied when a judgement is USED rather than when it is recorded, so
     * one recording's judgements score at every value of it and choosing it is
     * a free measurement rather than three more paid ones. `applyRerank` is
     * still the one function that decides the order; this is the argument it
     * takes.
     */
    rerankFloor: null,
    /**
     * Call the model for any (sentence, candidate set) the fixture does not
     * hold, and write the answers into it. The ONE path in this harness that
     * spends money, and it is never on by default.
     */
    recordReranks: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--baseline') opts.baseline = true;
    // Kept because npm run eval:read-query names it, and because it said
    // exactly this before Phase 4 made it the default: run the reader's pass
    // and print it beside the golden set's own constraints. It now costs
    // nothing because both always run.
    else if (arg === '--read-query') opts.readQuery = true;
    else if (arg.startsWith('--plan=')) opts.plan = arg.slice(7);
    else if (arg.startsWith('--merge=')) opts.merge = arg.slice(8);
    else if (arg.startsWith('--text=')) opts.text = arg.slice(7);
    else if (arg.startsWith('--embed=')) opts.embed = arg.slice(8);
    else if (arg.startsWith('--accept=')) opts.accept = arg.slice(9);
    else if (arg === '--no-refuse') opts.refuse = false;
    else if (arg === '--no-rerank') opts.rerank = false;
    else if (arg === '--record-reranks') opts.recordReranks = true;
    else if (arg.startsWith('--rerank-n=')) opts.rerankN = Number.parseInt(arg.slice(11), 10);
    else if (arg.startsWith('--rerank-floor=')) opts.rerankFloor = Number.parseInt(arg.slice(15), 10);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--limit=')) opts.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--timeout=')) opts.timeout = Number.parseInt(arg.slice(10), 10);
    else if (arg.startsWith('--golden=')) opts.golden = path.resolve(process.cwd(), arg.slice(9));
    // The regression gate is the one code path that could not be exercised
    // without editing a tracked file. CI points this at a fixture and proves
    // the gate fires; nothing else about the run changes.
    else if (arg.startsWith('--baselines=')) {
      opts.baselines = path.resolve(process.cwd(), arg.slice(12));
      opts.baselinesExplicit = true;
    }
    else if (arg.startsWith('--negatives=')) {
      opts.negatives = path.resolve(process.cwd(), arg.slice(12));
      opts.negativesExplicit = true;
    }
    else if (arg.startsWith('--held-out=')) {
      opts.heldOut = path.resolve(process.cwd(), arg.slice(11));
      opts.heldOutExplicit = true;
    }
    else if (arg.startsWith('--held-out2=')) opts.heldOut2 = path.resolve(process.cwd(), arg.slice(12));
    else if (arg.startsWith('--positives=')) opts.positives = path.resolve(process.cwd(), arg.slice(12));
    else if (arg.startsWith('--record=')) opts.record = arg.slice(9);
    else return { error: `unknown argument: ${arg}` , opts };
  }
  if (!Number.isInteger(opts.limit) || opts.limit < K) {
    return { error: `--limit must be an integer >= ${K}`, opts };
  }
  if (!Number.isInteger(opts.timeout) || opts.timeout < 100) {
    return { error: '--timeout must be an integer >= 100 (milliseconds)', opts };
  }
  for (const [flag, value, allowed] of [
    ['--plan', opts.plan, ['shipped', 'rules', 'written']],
    ['--merge', opts.merge, ['rules-win', 'model-wins']],
    ['--text', opts.text, ['rules', 'shorter', 'restated']],
    ['--embed', opts.embed, ['text', 'english', 'fused']],
  ]) {
    if (!allowed.includes(value)) {
      return { error: `${flag} must be one of ${allowed.join(', ')}, not "${value}"`, opts };
    }
  }
  if (opts.rerankN !== null && (!Number.isInteger(opts.rerankN) || opts.rerankN < 1)) {
    return { error: '--rerank-n must be a positive integer', opts };
  }
  if (
    opts.rerankFloor !== null &&
    (!Number.isInteger(opts.rerankFloor) || opts.rerankFloor < 1 || opts.rerankFloor > 3)
  ) {
    return { error: '--rerank-floor must be 1, 2 or 3', opts };
  }
  if (opts.recordReranks && !opts.rerank) {
    return { error: '--record-reranks and --no-rerank ask for opposite things', opts };
  }
  const dimensions = ['pricing', 'platforms', 'languages', 'flags'];
  opts.acceptList =
    opts.accept === 'none' ? [] : opts.accept.split(',').map((s) => s.trim()).filter(Boolean);
  for (const value of opts.acceptList) {
    if (!dimensions.includes(value)) {
      return { error: `--accept names "${value}"; it takes ${dimensions.join(', ')} or none`, opts };
    }
  }
  return { opts };
}

const USAGE = `Foundit search evaluation harness

  DATABASE_URL=postgres://... node eval/run.mjs [options]

  --json          also write eval/results/<timestamp>.json
  --baseline      compare against the latest recorded row in eval/baselines.md
                  and exit non-zero if nDCG@10 dropped by more than ${REGRESSION_TOLERANCE}
  --limit=N       rows to request from search_tools (default ${DEFAULT_FETCH_LIMIT}; metrics are always @${K})
  --timeout=MS    per-query statement timeout (default ${DEFAULT_TIMEOUT_MS})
  --golden=PATH   golden set to read (default eval/golden.jsonl)
  --baselines=PATH  baselines table to compare against with --baseline
                  (default eval/baselines.md)
  --negatives=PATH  sentences the catalogue cannot answer, whose right answer is
                  an empty page (default eval/negatives.jsonl). --baseline gates
                  the share that come back empty.
  --held-out=PATH   a second negatives file nobody tuned against
                  (default eval/negatives.review.jsonl). Reported separately and
                  gated separately: it is the honest number.
  --plan=WHICH    how the headline pass reads each sentence (default shipped)
                    shipped  the rules pass plus gpt-5-nano's cached reading,
                             merged — what a visitor gets
                    rules    lib/constraints.ts alone — what Phase 3 shipped
                    written  the golden set's own constraints — the Phase 2 and
                             3 instrument
  --merge=WHICH   rules-win (default) or model-wins, on a dimension both read
  --text=WHICH    rules (default), shorter, or restated: what is ranked on
  --embed=WHICH   english (default), text or fused: what the vector leg embeds
  --accept=LIST   which dimensions the model may contribute, comma separated
                  (default pricing; "none" for none)
  --no-refuse     ignore the model's "this is not a request for software"
  --read-query    accepted and ignored. Both passes always run since Phase 4.
  --no-rerank     measure the Phase 4 search: no reranker over the candidates.
                  The reranker is ON by default from Phase 5, because it is
                  what a visitor gets.
  --rerank-n=N    how many candidates the reranker judges (default: the shipped
                  RERANK_TOP_N in lib/rerank.ts). Measured at 20, 30 and 50.
  --rerank-floor=N  the lowest grade that still reaches a page: 1, 2 or 3
                  (default: the shipped RERANK_SHOWN_FROM in lib/rerank.ts).
                  Applied when a judgement is used, so one recording scores at
                  every value and the sweep costs nothing.
  --record-reranks  call the model for any (sentence, candidate set) the
                  fixture does not hold, and write the answers into it. THE ONE
                  PATH HERE THAT SPENDS MONEY. Needs a key.

Exit: 0 ok, 1 usage, 2 constraint violation, 3 database, 4 regression.`;

const SEARCH_SQL = `
  select tool_id, slug, name, summary, pricing, score, match_source
    from public.search_tools(
      p_query     => $1::text,
      p_pricing   => $2::pricing_model[],
      p_platforms => $3::platform[],
      p_flags     => $4::tool_flag[],
      p_languages => $5::text[],
      p_limit     => $6::int,
      p_embedding => $7::halfvec
    )`;

/**
 * Every published tool's name, for the guards that need the catalogue.
 *
 * The application reads the same list (cached for a minute) and passes it to
 * `planSearch`, so the harness has to as well or the two are measuring
 * different guards: a restatement naming one of our own tools is refused, and a
 * "this is not software" for a sentence that names one is refused too.
 */
const TOOL_NAMES_SQL = `
  select name from public.tools where status = 'published' order by name`;

const FACTS_SQL = `
  select slug::text as slug, status::text as status, pricing::text as pricing,
         platforms::text[] as platforms, flags::text[] as flags, languages
    from public.tools
   where slug = any($1::citext[])`;

/**
 * Which of these sentences has no cached vector. One statement, not one per
 * query: the answer is a boolean per row and the point is to find out cheaply.
 */
const MISSING_EMBEDDINGS_SQL = `
  select t as text
    from unnest($1::text[]) as t
   where public.query_embedding_missing(t)`;

/** Put the vectors where the search will find them. One statement per batch. */
const STORE_QUERY_EMBEDDINGS_SQL = `
  select public.store_query_embedding(x.q, x.e::halfvec, $3::text)
    from unnest($1::text[], $2::text[]) as x(q, e)`;

/**
 * Phase 4's half of the same arrangement: the model's reading of every sentence
 * this run is about to search with, loaded into public.query_readings from
 * db/seed/embeddings.fixture.json before the session is sealed read-only.
 *
 * Same reasoning as the vectors, and the same consequence: CI has no key, and
 * without this a keyless run would measure the rules-only search and gate
 * nothing at all about the model pass.
 */
const STORE_QUERY_READINGS_SQL = `
  select count(*)
    from unnest($1::text[], $2::jsonb[]) as x(q, r),
         lateral public.store_query_reading(x.q, x.r, $3::text)`;

/**
 * Read the readings back OUT of the database, rather than straight out of the
 * fixture.
 *
 * That is deliberate and it costs one statement. The application reads a
 * reading through public.query_reading, which is a SECURITY DEFINER function
 * over a table foundit_app holds no grant on; measuring from the fixture
 * instead would leave the migration, the grants and the shape CHECK beside the
 * measured path rather than on it.
 */
const QUERY_READINGS_SQL = `
  select t as text, public.query_reading(t) as reading
    from unnest($1::text[]) as t`;

/**
 * Phase 5's half of the same arrangement.
 *
 * Every published tool's problem statements, in the order the results screen's
 * own statement aggregates them, so the harness hands the reranker exactly what
 * the application hands it. One statement for the whole run rather than one per
 * candidate per query: the catalogue does not change while a run is measuring
 * it, and a query per candidate is the shape lib/sql.ts exists to prevent.
 */
const STATEMENTS_SQL = `
  select t.slug::text as slug,
         t.name::text as name,
         t.summary,
         coalesce(
           array_agg(tp.statement order by tp.sort_order, tp.id)
             filter (where tp.id is not null),
           '{}'::text[]
         ) as statements
    from public.tools t
    left join public.tool_problems tp on tp.tool_id = t.id
   where t.status = 'published'
   group by t.slug, t.name, t.summary`;

/** Load recorded judgements into the cache, so a keyless run reranks for free. */
const STORE_QUERY_RERANKS_SQL = `
  select count(*)
    from unnest($1::text[], $2::text[], $3::jsonb[]) as x(q, h, j),
         lateral public.store_query_rerank(x.q, x.h, x.j, $4::text)`;

/**
 * Read one judgement back OUT of the database rather than out of the fixture.
 *
 * The same reasoning as the readings, and it costs one statement per query: the
 * application reads a judgement through public.query_rerank, which is a
 * SECURITY DEFINER function over a table foundit_app holds no grant on.
 * Measuring from the fixture instead would leave the migration, the grants and
 * the shape CHECK beside the measured path rather than on it.
 */
const QUERY_RERANK_SQL = `select public.query_rerank($1::text, $2::text) as judgement`;

/**
 * Fill the query-embedding cache for every sentence this run is about to
 * search with, before the session is put into read-only mode.
 *
 * Why this exists, and why it is not cheating.
 *
 * The application's path on a cache MISS is: search (text-only, told that a
 * vector is missing), embed, store, search again with the vector. The second
 * search is the answer the visitor sees, and it is byte for byte the answer a
 * cache HIT produces, because both are `search_tools` with the same vector.
 * The two differ in latency and in nothing else.
 *
 * So the harness warms the cache and then measures the cached path. That keeps
 * three properties that matter more than reproducing the miss:
 *
 *   * the measured pass stays READ ONLY, which is structural rather than a
 *     promise, and is what stops a benchmark writing to search_events;
 *   * the reported latency is the latency of the shipped steady state — every
 *     repeated query — rather than of a first-ever sentence;
 *   * a run needs no API key once the cache is warm, so CI measures the same
 *     number as a laptop and calls nothing.
 *
 * With no key and a cold cache it degrades exactly as the application does:
 * the affected queries are searched text-only, the note says how many, and the
 * number is honestly lower rather than absent.
 */
/**
 * The recorded query vectors, or an empty map.
 *
 * db/seed/embeddings.fixture.json is what makes a keyless run measure the REAL
 * hybrid search. Without it, a run with no key measures the Phase 2 search —
 * which is a legitimate number, and is exactly why it gates nothing about the
 * vector leg: set the leg's weight to zero and a keyless CI stays green. An
 * adversarial review made that point by doing it.
 *
 * It is read before the API is, so a laptop with a key and a runner without
 * one produce the same number from the same recorded vectors rather than two
 * numbers a ten-thousandth apart.
 */
/** The fixture format this harness reads. Bumped in 0007 with tool summaries. */
const FIXTURE_SCHEMA = 'foundit-embeddings/3';

/** The whole fixture, or an empty object. Read fresh: --record-reranks writes it. */
function rerankFixture() {
  try {
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function fixtureQueryVectors(embeddings) {
  try {
    const parsed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    if (parsed?.schema !== FIXTURE_SCHEMA) {
      // Loudly, not silently: a fixture this harness cannot read means every
      // sentence goes to the API on a laptop and NONE is warmed on CI, where
      // the run would quietly measure the text-only search instead.
      process.stdout.write(
        `  NOTE: db/seed/embeddings.fixture.json is ${parsed?.schema ?? '(no schema)'}, ` +
          `not ${FIXTURE_SCHEMA}; no sentence can be warmed from it.\n` +
          '        Re-record it: scripts/embed.mjs --write-fixture.\n',
      );
      return {};
    }
    const out = {};
    for (const [key, encoded] of Object.entries(parsed.queries ?? {})) {
      out[key] = embeddings.fromFloat16Base64(encoded);
    }
    return out;
  } catch {
    // No fixture, or one this version cannot read. Not an error: the API path
    // below still works, and a run with neither says so and measures
    // text-only.
    return {};
  }
}

/**
 * Fill the query-embedding cache with each sentence's OWN vector.
 *
 * The cache is keyed on the searched text, so it can only ever hold one vector
 * per key — and two passes of this harness search the same text wanting two
 * different vectors, because the shipped plan embeds a non-English sentence's
 * English restatement instead. Writing one pass's vector under a key the other
 * pass also reads made the reference pass measure the shipped plan's vectors,
 * silently and only for the sentences where the rules stripped nothing.
 *
 * So the cache holds the plain thing and nothing else, and a pass that wants a
 * different vector carries it as an argument — `resolveVectors` below, and
 * `p_embedding`. That is the application's own cache-miss path, and it produces
 * the identical ranking to a hit by construction.
 */
async function warmQueryCache(client, texts, redact) {
  const summary = {
    wanted: 0,
    cached: 0,
    /** Loaded from db/seed/embeddings.fixture.json — no network, no spend. */
    fromFixture: 0,
    embedded: 0,
    /** Sentences still without a vector when the warm-up finished. */
    missing: 0,
    requests: 0,
    tokens: 0,
    note: null,
  };

  // Dynamic, for the same reason eval/reader.mjs is: a default run must not
  // fail to start because a module it may not need did not load.
  let embeddings;
  try {
    embeddings = await import('../lib/embeddings.ts');
  } catch (err) {
    summary.note = `lib/embeddings.ts did not load (${redact(err?.message ?? err)}); every query measures text-only`;
    return summary;
  }
  normalizeQueryImpl = embeddings.normalizeQuery;

  const normalized = [
    ...new Set(texts.map((t) => embeddings.normalizeQuery(t ?? '')).filter((t) => t !== '')),
  ];
  summary.wanted = normalized.length;
  if (normalized.length === 0) return summary;

  const { rows } = await client.query(MISSING_EMBEDDINGS_SQL, [normalized]);
  let missing = rows.map((r) => r.text);
  summary.cached = normalized.length - missing.length;
  summary.missing = missing.length;
  if (missing.length === 0) return summary;

  // --- the recorded vectors first: free, offline, and the same everywhere ---
  const recorded = fixtureQueryVectors(embeddings);
  const have = missing.filter((t) => recorded[t] !== undefined);
  if (have.length > 0) {
    try {
      await client.query(STORE_QUERY_EMBEDDINGS_SQL, [
        have,
        have.map((t) => recorded[t]),
        // The fixture records the model it was written from; a mismatch is
        // refused by store_query_embedding rather than mixed in.
        JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')).model,
      ]);
      summary.fromFixture = have.length;
      summary.missing -= have.length;
      missing = missing.filter((t) => recorded[t] === undefined);
    } catch (err) {
      summary.note = `the fixture could not be loaded (${redact(err?.message ?? err)})`;
      missing = missing.filter((t) => recorded[t] === undefined);
    }
  }
  if (missing.length === 0) return summary;

  if (!embeddings.embeddingsConfigured()) {
    summary.note =
      `${missing.length} sentence(s) are neither cached nor in the fixture, and ` +
      'EMBEDDINGS_API_KEY is not set; those queries measure text-only, exactly as the ' +
      'application would serve them';
    return summary;
  }

  for (let i = 0; i < missing.length; i += embeddings.EMBEDDINGS_BATCH_SIZE) {
    const batch = missing.slice(i, i + embeddings.EMBEDDINGS_BATCH_SIZE);
    let result;
    try {
      result = await embeddings.embedTexts(batch);
    } catch (err) {
      summary.note =
        `the embedding provider failed (${redact(err?.message ?? err)}); ` +
        `${missing.length - summary.embedded} sentence(s) measure text-only`;
      return summary;
    }
    summary.requests += 1;
    summary.tokens += result.tokens;
    try {
      await client.query(STORE_QUERY_EMBEDDINGS_SQL, [batch, result.vectors, result.model]);
    } catch (err) {
      // A read-only role, or a role without EXECUTE on the setter. That is a
      // legitimate way to run the harness and it is not a reason to fail:
      // report it and measure what the cache already holds.
      summary.note =
        `the query-embedding cache could not be written (${redact(err?.message ?? err)}); ` +
        `${missing.length - summary.embedded} sentence(s) measure text-only`;
      return summary;
    }
    summary.embedded += batch.length;
    summary.missing -= batch.length;
  }

  return summary;
}

/**
 * The vector literal for each of these texts, from the fixture or the API.
 *
 * Used for the one case the cache cannot serve: the shipped plan embedding a
 * sentence's English restatement rather than the sentence. The literal is then
 * passed to `search_tools` as `p_embedding`, which is what app/results/page.tsx
 * does on a cache miss, and what makes the measured pass independent of what
 * any other pass left in the cache.
 *
 * A text with no recorded vector and no key measures text-only, and is counted
 * so the run says so rather than quietly reporting a different search.
 */
async function resolveVectors(texts, redact) {
  const out = { vectors: new Map(), missing: 0, requests: 0, tokens: 0, note: null };
  let embeddings;
  try {
    embeddings = await import('../lib/embeddings.ts');
  } catch {
    out.missing = texts.length;
    return out;
  }

  const wanted = [
    ...new Set(texts.map((t) => embeddings.normalizeQuery(t ?? '')).filter((t) => t !== '')),
  ];
  if (wanted.length === 0) return out;

  const recorded = fixtureQueryVectors(embeddings);
  const missing = [];
  for (const text of wanted) {
    if (recorded[text] !== undefined) out.vectors.set(text, recorded[text]);
    else missing.push(text);
  }
  if (missing.length === 0) return out;

  if (!embeddings.embeddingsConfigured()) {
    out.missing = missing.length;
    out.note =
      `${missing.length} sentence(s) the shipped plan wants a vector for are not in the ` +
      'fixture and there is no key; those measure text-only. Re-record: ' +
      'scripts/read.mjs --write-fixture then scripts/embed.mjs --write-fixture';
    return out;
  }

  for (let i = 0; i < missing.length; i += embeddings.EMBEDDINGS_BATCH_SIZE) {
    const batch = missing.slice(i, i + embeddings.EMBEDDINGS_BATCH_SIZE);
    try {
      const result = await embeddings.embedTexts(batch);
      out.requests += 1;
      out.tokens += result.tokens;
      batch.forEach((text, n) => out.vectors.set(text, result.vectors[n]));
    } catch (err) {
      out.missing += batch.length;
      out.note = `the embedding provider failed (${redact(err?.message ?? err)})`;
    }
  }
  return out;
}

/**
 * Load the recorded readings into public.query_readings, then read them back
 * out through the definer function the application uses.
 *
 * Two statements, and the second one is the point: what the shipped plan gets
 * is what `public.query_reading()` returns, so the migration, the grant and the
 * table's shape CHECK are all on the measured path. A sentence with no recorded
 * reading comes back null and measures rules-only, exactly as a visitor's
 * search does when the model is unreachable.
 */
async function warmReadingCache(client, texts, redact) {
  const summary = { wanted: 0, loaded: 0, available: 0, missing: 0, note: null, readings: new Map() };

  let fixture;
  try {
    fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  } catch {
    summary.note = 'no fixture, so no sentence has a reading; every query measures rules-only';
    return summary;
  }
  const recorded = fixture?.readings ?? {};
  const model = fixture?.readingModel;

  const keys = [...new Set(texts.map((t) => normalizedKey(t)).filter((t) => t !== ''))];
  summary.wanted = keys.length;
  if (keys.length === 0) return summary;

  const have = keys.filter((k) => recorded[k] !== undefined);
  if (have.length > 0 && model) {
    const BATCH = 200;
    try {
      for (let i = 0; i < have.length; i += BATCH) {
        const batch = have.slice(i, i + BATCH);
        await client.query(STORE_QUERY_READINGS_SQL, [
          batch,
          batch.map((k) => JSON.stringify(recorded[k])),
          model,
        ]);
        summary.loaded += batch.length;
      }
    } catch (err) {
      // A role without EXECUTE on the setter, or a model mismatch. Report it
      // and measure what the cache already holds; this is not a reason to fail.
      summary.note = `the reading cache could not be written (${redact(err?.message ?? err)})`;
    }
  } else if (have.length > 0 && !model) {
    summary.note = 'the fixture holds readings but records no model, so none was loaded';
  }

  try {
    const { rows } = await client.query(QUERY_READINGS_SQL, [keys]);
    for (const row of rows) {
      if (row.reading) summary.readings.set(row.text, row.reading);
    }
  } catch (err) {
    summary.note = `the readings could not be read back (${redact(err?.message ?? err)})`;
  }
  summary.available = summary.readings.size;
  summary.missing = keys.length - summary.available;
  return summary;
}

/**
 * The reranker's cache, filled from the fixture before the session is sealed.
 *
 * The twin of `warmReadingCache`, and the same argument for it: CI has no key,
 * and a run with no judgements measures the Phase 4 search while claiming to
 * measure the Phase 5 one. `db/seed/embeddings.fixture.json` carries the
 * recorded judgements; this puts them where `public.query_rerank` will find
 * them.
 *
 * The fixture's key is `<normalised sentence>\n<candidates hash>`. A newline,
 * because `public.normalize_query` collapses every whitespace run to a single
 * space, so one cannot appear in either half.
 */
async function warmRerankCache(client, fixture, redact) {
  const summary = { recorded: 0, loaded: 0, note: null };
  const recorded = fixture?.reranks ?? {};
  const model = fixture?.rerankModel;
  const entries = Object.entries(recorded);
  summary.recorded = entries.length;
  if (entries.length === 0) return summary;
  if (!model) {
    summary.note = 'the fixture holds judgements but records no model, so none was loaded';
    return summary;
  }

  const BATCH = 200;
  try {
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const queries = [];
      const hashes = [];
      const judgements = [];
      for (const [key, judgement] of batch) {
        const at = key.indexOf('\n');
        if (at < 0) continue;
        queries.push(key.slice(0, at));
        hashes.push(key.slice(at + 1));
        judgements.push(JSON.stringify(judgement));
      }
      if (queries.length === 0) continue;
      await client.query(STORE_QUERY_RERANKS_SQL, [queries, hashes, judgements, model]);
      summary.loaded += queries.length;
    }
  } catch (err) {
    summary.note = `the rerank cache could not be written (${redact(err?.message ?? err)})`;
  }
  return summary;
}

/**
 * Record every judgement this run will need, BEFORE it measures anything.
 *
 * Two reasons, and the second is the one that matters.
 *
 * It is four times faster. Recording used to happen inside the measured pass,
 * one sentence at a time, because that is where the candidates are — and a full
 * recording took half an hour, which is long enough that "record five times and
 * freeze the middle" stops being something anybody does. Four calls in flight
 * turns it into minutes.
 *
 * And **a measured pass should not be making API calls at all**. When it did,
 * the latency column of a recording run was the model's rather than the
 * database's, and the run that produced a number was not the same shape as the
 * run that reproduced it. Now the recording is a separate phase with its own
 * counts, and every measured pass reads from the cache exactly as a keyless
 * run on CI does.
 *
 * It re-uses the cache: a sentence whose candidate set already has a judgement
 * costs nothing, so a second pass fills only what the first one's timeouts
 * missed.
 */
async function prerecordJudgements(client, sets, plan, reranker, opts, redact) {
  const wanted = new Map();
  const fetchLimit = Math.max(opts.limit, reranker.n);

  for (const q of sets) {
    const planned = plan(q);
    if (planned.asksForSoftware === false) continue;
    if (String(planned.text ?? '').trim() === '') continue;

    const constraints = planned.constraints ?? {};
    let rows;
    try {
      ({ rows } = await client.query(SEARCH_SQL, [
        planned.text,
        constraints.pricing ?? null,
        constraints.platforms ?? null,
        constraints.flags ?? null,
        constraints.languages ?? null,
        fetchLimit,
        planned.vector ?? null,
      ]));
    } catch (err) {
      reranker.stats.note = `a pre-recording search failed (${redact(err?.message ?? err)})`;
      continue;
    }
    if (rows.length === 0) continue;

    const candidates = reranker.lib.rerankCandidates(
      rows.map((r) => ({
        slug: String(r.slug),
        name: reranker.listings.get(String(r.slug))?.name ?? String(r.name),
        summary: reranker.listings.get(String(r.slug))?.summary ?? '',
        statements: reranker.listings.get(String(r.slug))?.statements ?? [],
      })),
      reranker.n,
    );
    const hash = reranker.lib.candidatesHash(candidates.map((c) => c.slug));
    const key = `${normalizedKey(q.query)}\n${hash}`;
    if (wanted.has(key)) continue;

    const { rows: cached } = await client.query(QUERY_RERANK_SQL, [q.query, hash]);
    if (cached[0]?.judgement) continue;
    wanted.set(key, { sentence: q.query, hash, candidates });
  }

  const work = [...wanted.values()];
  process.stdout.write(`  recording: ${work.length} judgement(s) to fetch.\n`);
  if (work.length === 0) return;

  // TWO SENTENCES AT A TIME, WHICH IS FOUR REQUESTS IN FLIGHT. It was four
  // sentences while a judgement was one call, and the day a judgement became
  // two calls (lib/rerank.ts, RERANK_SAMPLES) the same four sentences put eight
  // requests in flight and the provider answered with 429s: the first recording
  // taken that way lost 145 of 354 judgements outright and made another 72 from
  // a single sample, which is not a recording of this configuration at all. The
  // same arithmetic and the same ceiling as scripts/read.mjs, which reads two
  // sentences at a time for exactly this reason.
  const CONCURRENCY = Math.max(1, Math.floor(4 / (reranker.samples ?? 1)));
  let done = 0;
  let total = work.length;
  /** Judgements that failed, or came back short of their samples. */
  let retry = [];

  /**
   * One judgement, recorded — or put on the retry list.
   *
   * A JUDGEMENT SHORT OF ITS SAMPLES IS NOT RECORDED ON THE FIRST PASS. The
   * application uses one sample when the second does not return, because the
   * alternative there is no judgement at all and a visitor is waiting. A
   * RECORDING is not waiting for anything, and a fixture whose judgements are
   * part two-sample and part one-sample measures neither configuration — the
   * first recording taken this way had 72 of 209 made from a single call.
   * So it goes round once more, alone, and only then is one sample accepted
   * and counted on the `judgements from ONE sample` line.
   */
  const fetchOne = async (item, lastChance) => {
    try {
      const fresh = await reranker.rerankOrThrow(item.sentence, item.candidates);
      if ((fresh.samples ?? 1) < reranker.samples && !lastChance) {
        retry.push(item);
        return;
      }
      reranker.stats.recorded += 1;
      reranker.stats.tokensIn += fresh.tokensIn;
      reranker.stats.tokensOut += fresh.tokensOut;
      reranker.stats.outs.push(...(fresh.outs ?? []));
      if ((fresh.samples ?? 1) < reranker.samples) reranker.stats.oneSample += 1;
      reranker.fixture[`${normalizedKey(item.sentence)}\n${item.hash}`] = fresh.judgement;
      try {
        await client.query(STORE_QUERY_RERANKS_SQL, [
          [normalizedKey(item.sentence)],
          [item.hash],
          [JSON.stringify(fresh.judgement)],
          reranker.model,
        ]);
      } catch {
        // The cache is a convenience while recording; the fixture is the record.
      }
    } catch (err) {
      if (!lastChance) {
        retry.push(item);
        return;
      }
      reranker.stats.failed += 1;
      reranker.stats.note = `the reranker failed on one sentence (${redact(err?.message ?? err)})`;
    } finally {
      done += 1;
      if (done % 50 === 0) process.stdout.write(`    ${done} of ${total}\n`);
    }
  };

  for (let i = 0; i < work.length; i += CONCURRENCY) {
    await Promise.all(work.slice(i, i + CONCURRENCY).map((item) => fetchOne(item, false)));
  }

  // The second pass, one at a time, because what it is recovering from is a
  // burst the provider refused.
  const second = retry;
  retry = [];
  if (second.length > 0) {
    process.stdout.write(`  recording: ${second.length} to try once more, one at a time.\n`);
    total += second.length;
    for (const item of second) await fetchOne(item, true);
  }

  process.stdout.write(
    `  recorded: ${reranker.stats.recorded}, failed ${reranker.stats.failed}, ` +
      `from one sample ${reranker.stats.oneSample}.\n`,
  );
}

/**
 * Thrown to abandon a run from inside a helper. `main` opens the pool in a
 * `try/finally`, so a helper cannot simply `return EXIT.DATABASE` — it has to
 * unwind through that `finally` and hand the exit code back at the top.
 */
class EvalExit extends Error {
  constructor(code) {
    super(`eval exit ${code}`);
    this.name = 'EvalExit';
    this.code = code;
  }
}

/**
 * A "plan" answers, for one golden entry, the two questions a search takes:
 * what text to rank on, and what to filter by.
 *
 * The golden set read literally. The full sentence goes to full-text search
 * and the hand-written constraints go to the WHERE clause. This is what the
 * harness has always done and what it still does by default, and it measures
 * the ranker with the reading held constant and correct.
 *
 * Note what it does *not* measure: nothing here ever calls the code that turns
 * a sentence into constraints, so no change to that code can move this number
 * in either direction. `--read-query` and DERIVED plans exist because of that.
 */
const AUTHORED_PLAN = (q) => ({ text: q.query, constraints: q.constraints, embedText: q.query });

/**
 * Give a plan the vector of the text it says it embeds.
 *
 * EVERY pass does this now, including the authored one, and the reason is a
 * defect that survived one fix and came back wearing the other hat.
 *
 * The query-embedding cache maps a searched sentence to ONE vector. The
 * application stores, under that key, the vector it actually used — which for a
 * non-English sentence is the English restatement's. The harness runs two
 * passes over the same sentences and cannot store two different vectors under
 * one key, so at first it wrote the plain one and passed the restatement's
 * explicitly. That made the harness and the application disagree again: the
 * application read the restatement's vector out of its own cache, the harness
 * read the plain one for its reference pass, and on the sentences where the
 * rules strip nothing the two searched with different vectors.
 *
 * So the harness reads the cache for nothing. Every pass resolves its own
 * vector from db/seed/embeddings.fixture.json and hands it to `search_tools` as
 * `p_embedding`, which is the application's cache-miss path and produces the
 * identical ranking to its cache-hit path by construction. What is left in the
 * cache afterwards is then nobody's business.
 */
const withVector = (plan, vectors) => {
  const key = normalizedKey(plan.embedText ?? plan.text);
  return { ...plan, vector: vectors.get(key) ?? null };
};

/**
 * The shipped plan: the sentence read the way a visitor's search reads it.
 *
 * Rules first (lib/constraints.ts), then the model's cached reading, merged by
 * lib/reading.ts with the rules winning every dimension they spoke for. What
 * comes out is the text full-text search ranks on, the text the vector leg
 * embeds, the merged constraints, and whether this is a request for a software
 * tool at all.
 *
 * **This is the default pass from Phase 4 on**, and that is a change of
 * instrument recorded in eval/baselines.md rather than slipped in. Phases 2 and
 * 3 measured the ranker with the reading held constant and correct — the golden
 * set's own hand-written constraints — which was the right instrument while
 * nothing read a sentence. Phase 4 is the phase whose whole subject is reading
 * the sentence, so the number has to be what a visitor gets. `--plan=written`
 * still produces the old one, and the run prints both side by side.
 *
 * @param readings  normalised sentence -> the reading the database returned
 */
const shippedPlan = (readings, readForSearch, options, vectors = new Map()) => (q) => {
  const plan = readForSearch(q.query, readings.get(normalizedKey(q.query)) ?? null, options);
  return {
    text: plan.text,
    embedText: plan.embedText,
    vector: vectors.get(normalizedKey(plan.embedText)) ?? null,
    constraints: plan.constraints,
    keys: plan.keys,
    asksForSoftware: plan.asksForSoftware,
    usedModel: plan.usedModel,
    fromModel: plan.fromModel,
    refused: plan.refused,
    english: plan.english,
  };
};

/** The rules pass alone — Phase 3's reader, for the three-way comparison. */
const rulesPlan = (readRulesOnly) => (q) => readRulesOnly(q.query);

/**
 * The cache key for a sentence, mirrored from lib/embeddings.ts.
 *
 * Assigned once the module loads, because lib/embeddings.ts is a dynamic import
 * — a default run must not fail to start because a module it may not need did
 * not load.
 */
let normalizeQueryImpl = (t) => String(t ?? '').trim().toLowerCase();
function normalizedKey(text) {
  return normalizeQueryImpl(text);
}

/**
 * Every golden query, four ways it might have been typed instead.
 *
 * The judgements and the constraints travel with each variant: the same
 * question, differently typed, has the same right answers. What the harness
 * does with them is count the ones that come back EMPTY — a variant that
 * merely reorders is not interesting, and a variant that empties a page means
 * the floor is measuring the punctuation.
 */
export function perturbedQueries(queries) {
  const out = [];
  for (const q of queries) {
    for (const variant of perturbations(q.query)) {
      out.push({ ...q, id: `${q.id}/${variant.label}`, base: q.id, variant: variant.label, query: variant.text });
    }
  }
  return out;
}

/**
 * Run every golden query once under one plan and return the raw results.
 *
 * @throws EvalExit on any database error, after reporting it.
 */
async function runPass(client, queries, opts, plan, redact, reranker = null) {
  const entries = [];
  // With the reranker on, the search fetches the candidate window rather than
  // the scoring window: the judgement is made over N candidates and what
  // survives is cut back to `opts.limit` afterwards. That is what the
  // application does, in the same order, with the same two numbers.
  const fetchLimit = reranker ? Math.max(opts.limit, reranker.n) : opts.limit;

  for (const q of queries) {
    const planned = plan(q);
    const constraints = planned.constraints ?? {};
    const params = [
      planned.text,
      constraints.pricing ?? null,
      constraints.platforms ?? null,
      constraints.flags ?? null,
      constraints.languages ?? null,
      fetchLimit,
      // Null means "look in the cache", which is what the reference pass wants
      // and what a repeated search does. The shipped plan supplies the vector
      // of the text it chose to embed, exactly as the application does when the
      // cache did not have one.
      planned.vector ?? null,
    ];

    const t0 = performance.now();
    let rows;

    // The reader said this is not a request for a software tool at all, so the
    // page says so and never searches (app/results/page.tsx, the NotSoftware
    // empty state). Modelled here exactly: no statement is sent, and the
    // measured result is the empty page a visitor would see. A golden query
    // refused this way scores 0 and shows up in the zero-result gate, which is
    // the whole point — a reader that refuses a real question must fail the run.
    if (planned.asksForSoftware === false) {
      entries.push({
        query: q,
        searchText: planned.text,
        constraints,
        readerKeys: planned.keys ?? null,
        plan: planned,
        refusedAsNotSoftware: true,
        results: [],
        latencyMs: 0,
      });
      continue;
    }

    try {
      ({ rows } = await client.query(SEARCH_SQL, params));
    } catch (err) {
      const message = redact(err.message);
      process.stderr.write(`\nERROR running query ${q.id} (golden line ${q.line}).\n  ${message}\n`);
      if (/does not exist/i.test(message) && /search_tools/i.test(message)) {
        process.stderr.write(
          '  public.search_tools is missing. Apply db/migrations/0002_search.sql first.\n',
        );
      }
      if (/statement timeout|canceling statement/i.test(message)) {
        process.stderr.write(`  The query exceeded the ${opts.timeout} ms timeout.\n`);
      }
      if (/invalid input value for enum/i.test(message)) {
        process.stderr.write(
          [
            '  A constraint value is not one of the database enum labels.',
            '  If this is the --read-query pass, the reader produced a value the',
            '  schema does not have — that is a defect in the reader, not here.',
            '',
          ].join('\n'),
        );
      }
      if (/read-only transaction/i.test(message)) {
        process.stderr.write(
          [
            '  The session is read-only and search_tools tried to write.',
            '  That is the harness working as intended, not a configuration problem:',
            '  a benchmark run must not write rows, and logging to search_events in',
            '  particular would pollute the analytics this number exists to inform.',
            '  Move the logging out of search_tools and into the caller.',
            '',
          ].join('\n'),
        );
      }
      throw new EvalExit(EXIT.DATABASE);
    }
    let latencyMs = performance.now() - t0;

    let results = rows.map((r, i) => ({
      rank: i + 1,
      toolId: r.tool_id === null ? null : String(r.tool_id),
      slug: String(r.slug),
      name: r.name,
      pricing: r.pricing,
      score: r.score === null ? null : Number(r.score),
      matchSource: r.match_source,
    }));

    /* --- the reranker -----------------------------------------------------
     *
     * Every decision here is made by lib/rerank.ts and by nothing in this file:
     * which candidates are judged (`rerankCandidates`), what the cache key is
     * (`candidatesHash`), and what the final order is (`applyRerank`). The
     * application calls the same three with the same arguments, and
     * tests/parity.test.mjs holds the two callers to it — because the last two
     * reviews each caught the harness and the application deciding the same
     * thing in two places, and each time it invalidated a phase's number.
     */
    let judged = false;
    let judgement = null;
    if (reranker && results.length > 0 && String(planned.text ?? '').trim() !== '') {
      const rr = reranker.lib;
      const candidates = rr.rerankCandidates(
        results.map((r) => ({
          slug: r.slug,
          name: reranker.listings.get(r.slug)?.name ?? r.name,
          summary: reranker.listings.get(r.slug)?.summary ?? '',
          statements: reranker.listings.get(r.slug)?.statements ?? [],
        })),
        reranker.n,
      );
      const slugs = candidates.map((c) => c.slug);
      const hash = rr.candidatesHash(slugs);
      const key = `${normalizedKey(q.query)}\n${hash}`;

      let raw = null;
      const t1 = performance.now();
      try {
        const { rows: cached } = await client.query(QUERY_RERANK_SQL, [q.query, hash]);
        raw = cached[0]?.judgement ?? null;
      } catch (err) {
        reranker.stats.note = `the rerank cache could not be read (${redact(err?.message ?? err)})`;
      }
      latencyMs += performance.now() - t1;

      if (raw === null && reranker.record) {
        // The one path in this harness that calls a paid API. It runs only
        // under --record-reranks, and what it records goes into the fixture so
        // that every later run — here or on CI — is free and identical.
        try {
          const fresh = await reranker.rerankOrThrow(q.query, candidates);
          reranker.stats.recorded += 1;
          reranker.stats.tokensIn += fresh.tokensIn;
          reranker.stats.tokensOut += fresh.tokensOut;
          reranker.stats.outs.push(...(fresh.outs ?? []));
          if ((fresh.samples ?? 1) < reranker.samples) reranker.stats.oneSample += 1;
          reranker.fixture[key] = fresh.judgement;
          raw = fresh.judgement;
          try {
            await client.query(STORE_QUERY_RERANKS_SQL, [
              [normalizedKey(q.query)],
              [hash],
              [JSON.stringify(fresh.judgement)],
              reranker.model,
            ]);
          } catch {
            // The cache is a convenience while recording; the fixture is the
            // record. A failure to write it changes nothing about this run.
          }
        } catch (err) {
          reranker.stats.failed += 1;
          reranker.stats.note = `the reranker failed on ${q.id} (${redact(err?.message ?? err)})`;
        }
      }

      if (raw !== null && raw !== undefined) {
        const checked = rr.validateJudgement(raw, slugs);
        if ('judgement' in checked) {
          judged = true;
          judgement = checked.judgement;
          results = rr.applyRerank(results, checked.judgement, reranker.floor);
          reranker.stats.judged += 1;
        } else {
          reranker.stats.refused += 1;
          reranker.stats.note = `a recorded judgement was refused (${checked.error})`;
        }
      } else {
        reranker.stats.missing += 1;
      }
    }

    // Back to the scoring window. Above this line the rows are the candidate
    // set; below it they are what a visitor is shown, renumbered so a rank in
    // the report is a rank on the page.
    results = results.slice(0, opts.limit).map((r, i) => ({ ...r, rank: i + 1 }));

    entries.push({
      query: q,
      searchText: planned.text,
      constraints,
      // Only a reading plan sets these; they are reported, never asserted on.
      readerKeys: planned.keys ?? null,
      plan: planned,
      refusedAsNotSoftware: false,
      reranked: judged,
      judgement,
      results,
      latencyMs,
    });
  }

  return entries;
}

/**
 * Score one pass in place.
 *
 * Both passes go through this same function, so the only thing that can make
 * their numbers differ is the text and the constraints each was run with.
 * Judgements never move: a query's `relevant` map is the ground truth about
 * that question, not about how the question was phrased to the database.
 *
 * Constraints are checked against the constraints *that pass actually sent*,
 * which is the only honest check. Checking the derived pass against the
 * hand-written constraints would report a violation every time the reader
 * failed to read one, and a violation means "the SQL let through a row its
 * arguments excluded" — a different failure entirely, and one worth keeping
 * distinguishable from "the reader did not ask".
 */
function scorePass(entries, factsBySlug) {
  for (const entry of entries) {
    const q = entry.query;
    const slugs = entry.results.map((r) => r.slug);
    const grades = slugs.map((s) => q.relevant[s] ?? 0);
    const judged = Object.values(q.relevant);

    entry.resultCount = entry.results.length;
    entry.ndcg = ndcg(grades, judged, K);
    entry.recall = recall(slugs, q.relevant, K);
    entry.judgedCount = judged.length;
    entry.constrained = isConstrained({ constraints: entry.constraints });
    entry.violations = checkConstraints(
      { id: q.id, constraints: entry.constraints },
      entry.results,
      factsBySlug,
    );
  }
}

async function main(argv) {
  const { opts, error: argError } = parseArgs(argv);
  if (argError) {
    process.stderr.write(`${argError}\n\n${USAGE}\n`);
    return EXIT.USAGE;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.OK;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const redact = makeRedactor(databaseUrl);

  if (!databaseUrl || databaseUrl.trim() === '') {
    process.stderr.write(
      [
        'ERROR: DATABASE_URL is not set.',
        '',
        'The eval harness reads its connection string from the environment and',
        'from nowhere else. Nothing is hardcoded and no default is guessed.',
        '',
        'The usual cause is a missing --env-file, and the usual fix is:',
        '',
        '  node --env-file=.env.local eval/run.mjs --baseline',
        '',
        'Or set it for this command only, so it does not linger in your shell:',
        '',
        '  bash/zsh     DATABASE_URL=postgres://user:pass@host:5432/foundit node eval/run.mjs',
        '  PowerShell   $env:DATABASE_URL = \'postgres://user:pass@host:5432/foundit\'; node eval/run.mjs',
        '',
        'Use a read-only role. The harness only ever runs SELECT.',
        '',
        'This exits 2 rather than 1: nothing was measured, which is a different',
        'failure from a flag that was typed wrong, and a step that measured',
        'nothing must never be able to look like a step that passed.',
        '',
      ].join('\n'),
    );
    return EXIT.NO_CONNECTION;
  }

  // --- Golden set --------------------------------------------------------
  if (!existsSync(opts.golden)) {
    process.stderr.write(
      [
        `ERROR: golden set not found at ${opts.golden}`,
        '',
        'eval/golden.jsonl holds the 60 queries with known right answers. It is',
        'owned by a different agent in Phase 2 and this harness never writes it.',
        '',
      ].join('\n'),
    );
    return EXIT.USAGE;
  }

  const goldenText = await readFile(opts.golden, 'utf8');
  const { queries, errors: goldenErrors } = parseGolden(goldenText);

  if (goldenErrors.length > 0) {
    process.stderr.write(`ERROR: ${goldenErrors.length} problem(s) in ${opts.golden}:\n`);
    for (const e of goldenErrors) process.stderr.write(`  ${e}\n`);
    process.stderr.write('\nFix the golden set. Do not fix it by deleting the query that failed.\n');
    return EXIT.USAGE;
  }
  if (queries.length === 0) {
    process.stderr.write(`ERROR: ${opts.golden} contains no queries.\n`);
    return EXIT.USAGE;
  }

  const unjudged = queries.filter((q) => Object.keys(q.relevant).length === 0);

  // --- Negatives ---------------------------------------------------------
  // The default file missing is a note and a skipped section; a file somebody
  // NAMED missing is a typo, and a typo must not switch a gate off.
  let negatives = [];
  if (existsSync(opts.negatives)) {
    const parsed = parseNegatives(await readFile(opts.negatives, 'utf8'));
    if (parsed.errors.length > 0) {
      process.stderr.write(`ERROR: ${parsed.errors.length} problem(s) in ${opts.negatives}:\n`);
      for (const e of parsed.errors) process.stderr.write(`  ${e}\n`);
      return EXIT.USAGE;
    }
    negatives = parsed.queries;
  } else if (opts.negativesExplicit) {
    process.stderr.write(`ERROR: --negatives=${opts.negatives} does not exist.\n`);
    return EXIT.USAGE;
  }

  // --- The held-out negatives --------------------------------------------
  // A second file, written by a reviewer who had not read the first, and never
  // tuned against. It is the only number here that says anything about
  // sentences nobody anticipated.
  let heldOut = [];
  if (existsSync(opts.heldOut)) {
    const parsed = parseNegatives(await readFile(opts.heldOut, 'utf8'));
    if (parsed.errors.length > 0) {
      process.stderr.write(`ERROR: ${parsed.errors.length} problem(s) in ${opts.heldOut}:\n`);
      for (const e of parsed.errors) process.stderr.write(`  ${e}\n`);
      return EXIT.USAGE;
    }
    heldOut = parsed.queries;
  } else if (opts.heldOutExplicit) {
    process.stderr.write(`ERROR: --held-out=${opts.heldOut} does not exist.\n`);
    return EXIT.USAGE;
  }

  // --- The Phase 5 reviewer's two files -----------------------------------
  // 25 more negatives, written before they read anything, and 15 sentences that
  // DO have answers. The second is the one that keeps the first honest: a
  // reranker that empties more pages scores better on every negatives file and
  // worse at the job.
  let heldOut2 = [];
  if (existsSync(opts.heldOut2)) {
    const parsed = parseNegatives(await readFile(opts.heldOut2, 'utf8'));
    if (parsed.errors.length > 0) {
      process.stderr.write(`ERROR: ${parsed.errors.length} problem(s) in ${opts.heldOut2}:\n`);
      for (const e of parsed.errors) process.stderr.write(`  ${e}\n`);
      return EXIT.USAGE;
    }
    heldOut2 = parsed.queries.map((q) => ({ ...q, id: `r2-${q.id}` }));
  }

  let positives = [];
  if (existsSync(opts.positives)) {
    const parsed = parsePositives(await readFile(opts.positives, 'utf8'));
    if (parsed.errors.length > 0) {
      process.stderr.write(`ERROR: ${parsed.errors.length} problem(s) in ${opts.positives}:\n`);
      for (const e of parsed.errors) process.stderr.write(`  ${e}\n`);
      return EXIT.USAGE;
    }
    positives = parsed.queries;
  }

  // --- The perturbations --------------------------------------------------
  const perturbed = perturbedQueries(queries);

  // --- Connect -----------------------------------------------------------
  let pg;
  try {
    ({ default: pg } = await import('pg'));
  } catch {
    process.stderr.write("ERROR: the 'pg' package is not installed. Run: npm install\n");
    return EXIT.USAGE;
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 1_000,
    application_name: 'foundit-eval',
    // Belt and braces: the server enforces the per-query ceiling too.
    statement_timeout: opts.timeout,
    query_timeout: opts.timeout + 500,
  });
  // A pool error with no listener is an unhandled rejection that kills the
  // process without a usable message.
  pool.on('error', () => {});

  // --- The reader, when it was asked for ---------------------------------
  // Loaded here, before a connection is opened, so a broken import fails as a
  // configuration error rather than half-way through a run. It is a dynamic
  // import on purpose: the default run must not so much as touch
  // lib/constraints.ts, which is TypeScript and needs Node's type stripping.
  let reader = null;
  if (opts.plan !== 'written') {
    try {
      reader = await import('./reader.mjs');
    } catch (err) {
      process.stderr.write(
        [
          `ERROR: --plan=${opts.plan} could not load the sentence reader.`,
          `  ${redact(err?.message ?? err)}`,
          '',
          'eval/reader.mjs imports lib/constraints.ts, lib/reading.ts and',
          'lib/reader-model.ts directly, which needs a Node that strips TypeScript',
          `types (this repository requires >= 26; running ${process.version}).`,
          '',
          'To measure the ranker with the reading held constant instead, and touch',
          'none of those files: --plan=written.',
          '',
        ].join('\n'),
      );
      return EXIT.USAGE;
    }
  }

  const startedAt = new Date();
  /** What the cache warm-up did, reported and put in the JSON. */
  let warm = { wanted: 0, cached: 0, embedded: 0, requests: 0, tokens: 0, note: null };
  let perQuery = [];
  /** The vector of each restatement the shipped plan embeds, when it differs. */
  let shippedVectors = new Map();
  let writtenPerQuery = null;
  /** The negatives, as written and (with --read-query) as read. Null when not run. */
  let negPerQuery = null;
  let writtenNegPerQuery = null;
  /** The held-out negatives, and the golden set's mechanical variants. */
  let heldPerQuery = null;
  let held2PerQuery = null;
  let positivesPerQuery = null;
  let perturbedPerQuery = null;
  /** Phase 5's reranker, or null when it is off or could not be loaded. */
  let reranker = null;
  const allViolations = [];
  const writtenViolations = [];
  let client;

  try {
    try {
      client = await pool.connect();
      await client.query(`set statement_timeout = ${opts.timeout}`);
    } catch (err) {
      process.stderr.write(`ERROR: could not connect to PostgreSQL.\n  ${redact(err.message)}\n`);
      return EXIT.DATABASE;
    }

    process.stdout.write(
      `Foundit eval — ${queries.length} queries, metrics @${K}, fetching ${opts.limit} rows each.\n`,
    );
    process.stdout.write(
      `  headline pass: --plan=${opts.plan}` +
        (opts.plan === 'shipped'
          ? ` (merge=${opts.merge}, text=${opts.text}, embed=${opts.embed}, ` +
            `accept=${opts.acceptList.join('+') || 'none'}, ` +
            `refuse=${opts.refuse ? 'on' : 'off'})`
          : '') +
        '\n',
    );
    if (opts.plan !== 'written') {
      process.stdout.write(
        '  every query runs twice — once as the golden set writes it (the ranker\n' +
          '  alone), once as the shipped reader reads it. The gap is printed below.\n',
      );
    }

    // --- The model's reading, before anything else -------------------------
    // First, because the shipped plan's searched text and embedded text both
    // come out of it, so the vectors that have to be warmed are not known until
    // it has run. Loaded from the fixture, read back through the definer
    // function, and never fetched from the provider here.
    const everySentence = [...queries, ...negatives, ...heldOut, ...heldOut2, ...positives, ...perturbed].map((q) => q.query);
    let readings = { wanted: 0, loaded: 0, available: 0, missing: 0, note: null, readings: new Map() };
    if (opts.plan === 'shipped') {
      try {
        readings = await warmReadingCache(client, everySentence, redact);
        process.stdout.write(
          `  readings: ${readings.loaded} loaded from the fixture, ` +
            `${readings.available} of ${readings.wanted} sentences have one, ` +
            `${readings.missing} measure rules-only.\n`,
        );
        if (readings.note) process.stdout.write(`  NOTE: ${readings.note}\n`);
      } catch (err) {
        process.stderr.write(`ERROR warming the reading cache.\n  ${redact(err.message)}\n`);
        return EXIT.DATABASE;
      }
    }

    // --- The reranker, when it is on ---------------------------------------
    //
    // Loaded here, with the readings, because everything it needs is in place
    // by now and because a failure to load it must be a NOTE and a measured
    // Phase 4 number rather than a crash halfway through a run.
    if (opts.rerank) {
      try {
        const rr = await import('../lib/rerank.ts');
        const { rows } = await client.query(STATEMENTS_SQL, []);
        const listings = new Map();
        for (const row of rows) {
          listings.set(String(row.slug), {
            name: String(row.name),
            summary: row.summary ?? '',
            statements: row.statements ?? [],
          });
        }
        const warmed = await warmRerankCache(client, rerankFixture(), redact);
        reranker = {
          lib: rr,
          rerankOrThrow: rr.rerankOrThrow,
          // What goes in query_reranks.rerank_model, which public.rerank_model()
          // has to agree with. It is the model name and nothing else, and the
          // day RERANK_SAMPLES or the prompt moves it has to stop being that —
          // lib/rerank.ts says so where the constant is.
          model: rr.RERANK_MODEL,
          samples: rr.RERANK_SAMPLES,
          maxOutputTokens: rr.RERANK_MAX_OUTPUT_TOKENS,
          floor: opts.rerankFloor ?? rr.RERANK_SHOWN_FROM,
          n: opts.rerankN ?? rr.RERANK_TOP_N,
          listings,
          record: opts.recordReranks,
          fixture: {},
          stats: {
            judged: 0,
            missing: 0,
            refused: 0,
            recorded: 0,
            failed: 0,
            tokensIn: 0,
            tokensOut: 0,
            // Output tokens per REQUEST, one entry per call this recording
            // made, and the number of judgements that were made from one call
            // rather than two. The first is what a max_output_tokens ceiling
            // has to be set from; the second is how often the vote did not
            // happen. Both are empty on a run that records nothing.
            outs: [],
            oneSample: 0,
            note: null,
          },
        };
        process.stdout.write(
          `  reranker: top ${reranker.n} candidates, ${warmed.loaded} of ${warmed.recorded} ` +
            `recorded judgements loaded${opts.recordReranks ? ', RECORDING' : ''}.\n`,
        );
        if (warmed.note) process.stdout.write(`  NOTE: ${warmed.note}\n`);
      } catch (err) {
        process.stdout.write(
          `  NOTE: the reranker did not load (${redact(err?.message ?? err)}); ` +
            'this run measures the Phase 4 search.\n',
        );
        reranker = null;
      }
    } else {
      process.stdout.write('  reranker: off (--no-rerank) — this measures the Phase 4 search.\n');
    }

    // --- The plans ---------------------------------------------------------
    let toolNames = [];
    try {
      const { rows } = await client.query(TOOL_NAMES_SQL, []);
      toolNames = rows.map((r) => String(r.name));
      process.stdout.write(
        `  catalogue: ${toolNames.length} published tool names for the guards.\n`,
      );
    } catch (err) {
      process.stdout.write(
        `  NOTE: the tool names could not be read (${redact(err?.message ?? err)}); ` +
          'the readers catalogue guards did not run.\n',
      );
    }

    const mergeOptions = {
      toolNames,
      mode: opts.merge,
      text: opts.text,
      embed: opts.embed,
      accept: opts.acceptList,
      refuse: opts.refuse,
    };
    let headlinePlan =
      opts.plan === 'written'
        ? (q) => withVector(AUTHORED_PLAN(q), shippedVectors)
        : opts.plan === 'rules'
          ? rulesPlan(reader.readRulesOnly)
          : shippedPlan(readings.readings, reader.readForSearch, mergeOptions);

    // --- The vector leg's half of the search, before anything is measured ---
    // This is the only write the harness makes anywhere, it goes to a cache
    // with no user column, and it happens before the session is sealed
    // read-only rather than despite it.
    //
    // Two steps, and they are different things. The CACHE gets each searched
    // sentence's own vector — the steady state every repeated search reads. The
    // shipped plan additionally needs the vector of whatever it chose to embed,
    // which for a non-English sentence is the English restatement and is NOT
    // what belongs under that key; that one is carried as an argument instead.
    //
    // Writing it into the cache was the first arrangement and it was wrong: the
    // reference pass searches the same text and reads the same key, so for
    // every sentence the rules strip nothing from, the reference pass was
    // silently measuring the shipped plan's vectors. It showed up as a
    // reference number that had moved without the reference plan changing.
    try {
      const texts = [];
      const embedTexts = [];
      for (const q of [...queries, ...negatives, ...heldOut, ...heldOut2, ...positives, ...perturbed]) {
        const authored = AUTHORED_PLAN(q);
        texts.push(authored.text);
        embedTexts.push(authored.embedText);
        if (opts.plan !== 'written') {
          const plan = headlinePlan(q);
          texts.push(plan.text);
          embedTexts.push(plan.embedText ?? plan.text);
        }
      }
      warm = await warmQueryCache(client, texts, redact);
      process.stdout.write(
        `  query vectors: ${warm.cached} already cached, ${warm.fromFixture} from the fixture, ` +
          `${warm.embedded} embedded in ${warm.requests} request(s), ${warm.tokens} prompt tokens.\n`,
      );
      if (warm.note) process.stdout.write(`  NOTE: ${warm.note}\n`);

      if (embedTexts.length > 0) {
        const resolved = await resolveVectors(embedTexts, redact);
        shippedVectors = resolved.vectors;
        process.stdout.write(
          `  restatement vectors: ${resolved.vectors.size} resolved, ` +
            `${resolved.missing} not found, ${resolved.requests} request(s).\n`,
        );
        if (resolved.note) process.stdout.write(`  NOTE: ${resolved.note}\n`);
      }
    } catch (err) {
      process.stderr.write(`ERROR warming the query-embedding cache.\n  ${redact(err.message)}\n`);
      return EXIT.DATABASE;
    }

    // Rebuilt now that the vectors are in hand, so every plan carries the one
    // belonging to the text it says it embeds — and no pass reads the cache.
    if (opts.plan === 'shipped') {
      headlinePlan = shippedPlan(
        readings.readings,
        reader.readForSearch,
        mergeOptions,
        shippedVectors,
      );
    } else if (headlinePlan !== AUTHORED_PLAN) {
      const inner = headlinePlan;
      headlinePlan = (q) => withVector(inner(q), shippedVectors);
    }
    const referencePlan = (q) => withVector(AUTHORED_PLAN(q), shippedVectors);

    // Everything from here is measurement, and measurement does not write.
    //
    // The ONE exception is --record-reranks, which is a recording session
    // rather than a measurement: it calls the model and files what comes back
    // in the same cache the application writes, through the same definer
    // function, so that every later run is free. It is never on by default, it
    // says so above, and the row it writes is as unjoinable to a person as
    // every other row this harness touches.
    if (!opts.recordReranks) {
      await client.query('set session characteristics as transaction read only');
    } else {
      process.stdout.write(
        '  NOTE: --record-reranks, so this session is NOT read-only and this run calls a\n' +
          '        paid API. It is a recording, not a measurement — re-run without it.\n',
      );
      if (reranker) {
        // Everything the measured passes will need, fetched first and in
        // parallel. After this, the passes below read from the cache exactly as
        // a keyless run on CI does — which is what makes a recording run's
        // latency column mean the same thing as a measurement's.
        await prerecordJudgements(
          client,
          [...queries, ...negatives, ...heldOut, ...heldOut2, ...positives, ...perturbed],
          headlinePlan,
          reranker,
          opts,
          redact,
        );
        reranker.record = false;
        await client.query('set session characteristics as transaction read only');
      }
    }

    // --- Run every query, sequentially ------------------------------------
    // perQuery is the HEADLINE pass — what a visitor gets. writtenPerQuery is
    // the reference: the same ranker handed the golden set's own constraints,
    // which is what Phases 2 and 3 recorded. Both are printed; the first is the
    // one the gate reads.
    perQuery = await runPass(client, queries, opts, headlinePlan, redact, reranker);
    if (opts.plan !== 'written') {
      // The REFERENCE pass is deliberately not reranked. It is the ranker in
      // isolation — the Phase 2 and 3 instrument — and its job is to say
      // whether the instrument moved under the number. Reranking it would make
      // it a second measurement of Phase 5 rather than a control, and it would
      // double the judgements that have to be recorded, because a different
      // plan produces a different candidate set and therefore a different key.
      writtenPerQuery = await runPass(client, queries, opts, referencePlan, redact);
    }
    // The negatives go through exactly the same search, the same plan and the
    // same fetch limit. Nothing about them is special except what counts as
    // right.
    if (negatives.length > 0) {
      negPerQuery = await runPass(client, negatives, opts, headlinePlan, redact, reranker);
      if (opts.plan !== 'written') {
        writtenNegPerQuery = await runPass(client, negatives, opts, referencePlan, redact);
      }
    }
    if (heldOut.length > 0) {
      heldPerQuery = await runPass(client, heldOut, opts, headlinePlan, redact, reranker);
    }
    if (heldOut2.length > 0) {
      held2PerQuery = await runPass(client, heldOut2, opts, headlinePlan, redact, reranker);
    }
    if (positives.length > 0) {
      positivesPerQuery = await runPass(client, positives, opts, headlinePlan, redact, reranker);
    }
    // 240 more searches, and the only thing read off them is whether each came
    // back empty. Since Phase 4 they go through the headline plan, so the gate
    // asks of the reader what it already asked of the floor: does a full stop
    // decide whether this question has an answer?
    if (perturbed.length > 0) {
      perturbedPerQuery = await runPass(client, perturbed, opts, headlinePlan, redact, reranker);
    }

    // --- One lookup for the ground truth about every returned tool --------
    // Every pass is covered by the one lookup: a slug is a slug, and the
    // facts about it do not depend on which query brought it back.
    const returnedSlugs = [
      ...new Set(
        [
          ...perQuery,
          ...(writtenPerQuery ?? []),
          ...(negPerQuery ?? []),
          ...(writtenNegPerQuery ?? []),
          ...(heldPerQuery ?? []),
          ...(held2PerQuery ?? []),
          ...(positivesPerQuery ?? []),
          ...(perturbedPerQuery ?? []),
        ].flatMap((r) => r.results.map((x) => x.slug)),
      ),
    ];
    const factsBySlug = new Map();
    if (returnedSlugs.length > 0) {
      try {
        const { rows } = await client.query(FACTS_SQL, [returnedSlugs]);
        for (const r of rows) {
          factsBySlug.set(String(r.slug), {
            status: r.status,
            pricing: r.pricing,
            platforms: r.platforms ?? [],
            flags: r.flags ?? [],
            languages: r.languages ?? [],
          });
        }
      } catch (err) {
        process.stderr.write(`ERROR reading public.tools for constraint verification.\n  ${redact(err.message)}\n`);
        return EXIT.DATABASE;
      }
    }

    // --- Score -------------------------------------------------------------
    scorePass(perQuery, factsBySlug);
    for (const entry of perQuery) allViolations.push(...entry.violations);
    if (writtenPerQuery) {
      scorePass(writtenPerQuery, factsBySlug);
      for (const entry of writtenPerQuery) writtenViolations.push(...entry.violations);
    }
    // A negative that leaks is a quality failure. A negative that leaks a tool
    // its own constraints excluded is a WHERE clause leaking, and fails the run
    // exactly as a golden query would.
    for (const entry of [...(negPerQuery ?? []), ...(heldPerQuery ?? []), ...(held2PerQuery ?? []), ...(positivesPerQuery ?? []), ...(perturbedPerQuery ?? [])]) {
      allViolations.push(
        ...checkConstraints({ id: entry.query.id, constraints: entry.constraints }, entry.results, factsBySlug),
      );
    }
    for (const entry of writtenNegPerQuery ?? []) {
      writtenViolations.push(
        ...checkConstraints({ id: entry.query.id, constraints: entry.constraints }, entry.results, factsBySlug),
      );
    }
  } catch (err) {
    // runPass reports the detail and throws this to unwind past the `finally`
    // that closes the pool. Anything else is a real bug and keeps its stack.
    if (err instanceof EvalExit) return err.code;
    throw err;
  } finally {
    if (client) client.release();
    await pool.end(); // so the process actually exits
  }

  // --- Report ---------------------------------------------------------------
  /**
   * Did every sentence this run searched with have a query vector?
   *
   * This is the run's MODE, and it decides which recorded baseline it may be
   * compared against. A run with no key measures the text-only search, which
   * is a real and useful measurement — it is what Phase 2 recorded — but it is
   * not the same search as a run with vectors and must not be gated against
   * one. See pickBaseline.
   */
  const vectorsUsed = warm.wanted > 0 && warm.missing === 0;

  const overall = aggregate(perQuery);
  const slices = buildSlices(perQuery);
  const worst = [...perQuery]
    .sort((a, b) => a.ndcg - b.ndcg || a.recall - b.recall || a.query.id.localeCompare(b.query.id))
    .slice(0, 5);

  printReport({ overall, slices, worst, perQuery, unjudged, opts, startedAt });

  // --- The reader, when it was asked for ------------------------------------
  let readerComparison = null;
  if (writtenPerQuery) {
    // As written first, as read second: `compareReadings` calls the first
    // "authored" and the second "derived", and the derived one is the headline.
    readerComparison = compareReadings(writtenPerQuery, perQuery);
    process.stdout.write(`${buildReaderReport(readerComparison)}\n`);
  }

  // --- The negatives ---------------------------------------------------------
  const negOverall = negPerQuery ? aggregateNegatives(negPerQuery) : null;
  const writtenNegOverall = writtenNegPerQuery ? aggregateNegatives(writtenNegPerQuery) : null;
  if (negOverall) {
    process.stdout.write(
      `${buildNegativesReport({ overall: negOverall, perQuery: negPerQuery, derived: writtenNegOverall, golden: overall })}\n`,
    );
  } else {
    process.stdout.write(`\nNEGATIVES: ${path.relative(ROOT, opts.negatives).split(path.sep).join('/')} not found — not measured.\n`);
  }

  const heldOverall = heldPerQuery ? aggregateNegatives(heldPerQuery) : null;
  if (heldOverall) {
    process.stdout.write(
      `${buildNegativesReport({
        overall: heldOverall,
        perQuery: heldPerQuery,
        title: 'HELD OUT: negatives nobody tuned against',
        label: 'as the shipped reader reads it',
        note:
          'Written by a reviewer who had not read eval/negatives.jsonl. This is the\n' +
          'number that says whether the floor generalises; the other one says whether\n' +
          'it fits the file it was chosen on.',
      })}\n`,
    );
  } else {
    process.stdout.write(`\nHELD OUT: ${path.relative(ROOT, opts.heldOut).split(path.sep).join('/')} not found — not measured.\n`);
  }

  const held2Overall = held2PerQuery ? aggregateNegatives(held2PerQuery) : null;
  if (held2Overall) {
    process.stdout.write(
      `${buildNegativesReport({
        overall: held2Overall,
        perQuery: held2PerQuery,
        title: 'HELD OUT, SECOND FILE: the Phase 5 reviewer\'s own negatives',
        label: 'as the shipped reader reads it',
        note:
          'Written by the Phase 5 reviewer before reading any of ours, and spent the\n' +
          'moment anything is tuned against it — same rule as the first file, one\n' +
          'review later. 8 far, 17 near, and the near ones are the point.',
      })}\n`,
    );
  }

  const positivesOverall = positivesPerQuery ? aggregatePositives(positivesPerQuery) : null;
  if (positivesOverall) {
    process.stdout.write(`${buildPositivesReport(positivesOverall, positivesPerQuery)}\n`);
  }

  const perturbedEmpty = (perturbedPerQuery ?? []).filter((e) => e.results.length === 0).length;
  if (perturbedPerQuery) {
    process.stdout.write(`${buildPerturbationReport(perturbedPerQuery)}\n`);
  }

  // --- The reranker, measured ------------------------------------------------
  /** How much of this run was Phase 5 rather than Phase 4. Gated below. */
  let coverage = null;
  if (reranker) {
    const searched = [perQuery, negPerQuery, heldPerQuery, held2PerQuery, positivesPerQuery, perturbedPerQuery]
      .filter(Boolean)
      .flat()
      .filter((e) => !e.refusedAsNotSoftware && e.results.length + (e.judgement?.length ?? 0) > 0);
    coverage = { judged: reranker.stats.judged, searches: searched.length };
    process.stdout.write(
      `${buildRerankReport(reranker, [perQuery, negPerQuery, heldPerQuery, held2PerQuery, positivesPerQuery, perturbedPerQuery])}\n`,
    );
    if (reranker.stats.missing > 0) {
      // The same shape of note the vector path prints when a sentence has no
      // recorded vector: say what is missing and what it measured instead,
      // rather than leaving a reader to infer it from a number that moved.
      process.stdout.write(
        `  NOTE: ${reranker.stats.missing} sentence(s) have no recorded judgement in\n` +
          '        db/seed/embeddings.fixture.json, so they measured the Phase 4 order.\n' +
          '        Re-record: node eval/run.mjs --record-reranks (this one spends money).\n',
      );
    }

    // Recording is the only thing here that writes the fixture, and it EXTENDS
    // rather than re-records, for the same reason scripts/read.mjs does: this
    // model is not deterministic, so re-judging a sentence already in the file
    // moves the headline for a reason nobody changed.
    if (opts.recordReranks && Object.keys(reranker.fixture).length > 0) {
      const fixture = rerankFixture();
      fixture.reranks ??= {};
      let added = 0;
      for (const [key, judgement] of Object.entries(reranker.fixture)) {
        if (fixture.reranks[key] === undefined) added += 1;
        fixture.reranks[key] = judgement;
      }
      fixture.rerankModel = reranker.model;
      fixture.rerankTopN = reranker.n;
      fixture.reranksRecorded = new Date().toISOString().slice(0, 10);
      const prior = fixture.rerankTokens ?? { in: 0, out: 0, judgements: 0 };
      fixture.rerankTokens = {
        in: prior.in + reranker.stats.tokensIn,
        out: prior.out + reranker.stats.tokensOut,
        judgements: prior.judgements + reranker.stats.recorded,
      };
      await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture)}\n`, 'utf8');
      process.stdout.write(
        `  wrote ${added} new judgement(s) into db/seed/embeddings.fixture.json ` +
          `(${Object.keys(fixture.reranks).length} in the file).\n`,
      );
    }
  }

  // --- What it costs ---------------------------------------------------------
  // Dynamic, like every other TypeScript import here, so a run that cannot
  // strip types still produces its numbers and says why this section is absent.
  try {
    const prices = await import('../lib/prices.ts');
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    process.stdout.write(`${buildCostReport(fixture, prices, reranker)}\n`);
  } catch (err) {
    process.stdout.write(`\nCOST: not priced (${redact(err?.message ?? err)}).\n`);
  }

  // --- Hard failures --------------------------------------------------------
  let exitCode = EXIT.OK;

  if (allViolations.length > 0) {
    printViolations(allViolations);
    exitCode = EXIT.CONSTRAINT_VIOLATION;
  }

  // A violation in the derived pass is the same kind of failure as one in the
  // authored pass — search_tools returned a row its own arguments excluded —
  // so it fails the run too. It cannot affect anything that does not ask for
  // it: --read-query is opt-in and npm test does not pass it.
  if (writtenViolations.length > 0) {
    process.stdout.write(
      '\n(the violations below are from the reference pass — the same ranker handed\n' +
        ' the golden set\'s own constraints rather than the reader\'s)\n',
    );
    printViolations(writtenViolations);
    exitCode = EXIT.CONSTRAINT_VIOLATION;
  }

  // --- Regression -----------------------------------------------------------
  let regression = null;
  if (opts.baseline) {
    if (!existsSync(opts.baselines)) {
      // A missing DEFAULT baselines file is the ordinary state before the
      // first number is recorded, and passing is right. A missing file that
      // someone NAMED is a typo, and a typo that quietly turns the regression
      // gate off is worse than no gate at all.
      if (opts.baselinesExplicit) {
        process.stderr.write(`\nERROR: --baselines=${opts.baselines} does not exist.\n`);
        return EXIT.USAGE;
      }
      process.stdout.write(`\nBASELINE: ${opts.baselines} not found — nothing to compare against.\n`);
    } else {
      let rows;
      try {
        rows = parseBaselines(await readFile(opts.baselines, 'utf8'));
      } catch (err) {
        // An unreadable gate is not a passed gate.
        process.stderr.write(
          `\nERROR in ${path.relative(ROOT, opts.baselines).split(path.sep).join('/')}: ${err.message}\n`,
        );
        return EXIT.USAGE;
      }
      if (rows.length === 0) {
        process.stdout.write(
          `\nBASELINE: no baseline recorded yet in ${path.relative(ROOT, opts.baselines).split(path.sep).join('/')}.\n` +
            '          Record this run as the Phase 2 row and future runs will be checked against it.\n',
        );
      } else {
        const picked = pickBaseline(rows, vectorsUsed);
        const latest = picked.row;
        regression = checkRegression(overall.ndcgAt10, latest);
        const sign = regression.delta >= 0 ? '+' : '';
        process.stdout.write(
          '\n' +
            renderTable(
              ['BASELINE', 'phase', 'date', 'commit', 'vectors', 'nDCG@10', 'now', 'delta', 'tolerance', 'verdict'],
              [[
                '',
                latest.phase,
                latest.date,
                latest.commit,
                latest.vectors || '(not recorded)',
                n4(latest.ndcgAt10),
                n4(overall.ndcgAt10),
                `${sign}${n4(regression.delta)}`,
                n4(regression.tolerance),
                regression.regressed ? 'REGRESSION' : 'ok',
              ]],
              ['l', 'l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'l'],
            ) +
            '\n',
        );
        process.stdout.write(
          vectorsUsed
            ? '          Every sentence had a query vector, so this is compared against the newest\n' +
              '          row recorded with the vector leg running.\n'
            : `          ${warm.missing} sentence(s) had no query vector, so this measured the text-only\n` +
              '          search and is compared against the newest row recorded without the vector leg.\n',
        );
        if (!picked.sameMode) {
          process.stdout.write(
            '          NOTE: no recorded row says whether it was measured with the vector leg, so\n' +
              '          this compared against the newest row of any kind. Add a "Vectors" column to\n' +
              '          eval/baselines.md and the gate stops comparing two different searches.\n',
          );
        }
        if (regression.regressed) {
          process.stdout.write(
            `\nFAIL: nDCG@10 dropped ${n4(-regression.delta)} below the recorded baseline ` +
              `(tolerance ${regression.tolerance}).\n` +
              'The search got worse. Do not edit the golden set.\n',
          );
          if (exitCode === EXIT.OK) exitCode = EXIT.REGRESSION;
        }

        // --- Two more gates off the same row ---------------------------------
        const zero = checkZeroResultRegression(overall.zeroResultQueries, latest);
        if (zero) {
          process.stdout.write(
            `          golden queries with no results: ${zero.current} now, ${zero.recorded} recorded` +
              ` — ${zero.regressed ? 'REGRESSION' : 'ok'}\n`,
          );
          if (zero.regressed) {
            process.stdout.write(
              `\nFAIL: ${zero.current - zero.recorded} more golden quer${zero.current - zero.recorded === 1 ? 'y' : 'ies'} ` +
                'came back empty than the recorded baseline allows.\n' +
                'Each is a person with a real problem told that nothing fits. A floor that\n' +
                'empties a golden query is too high for that query, whatever the negatives say.\n',
            );
            if (exitCode === EXIT.OK) exitCode = EXIT.REGRESSION;
          }
        }

        const pctOf = (r) => `${(r * 100).toFixed(1)}%`;
        for (const [label, check, file] of [
          ['negatives answered with nothing', checkNegativesRegression(negOverall, latest), 'eval/negatives.jsonl'],
          ['held-out answered with nothing ', checkHeldOutRegression(heldOverall, latest), 'eval/negatives.review.jsonl'],
        ]) {
          if (!check) continue;
          process.stdout.write(
            check.missing
              ? `          ${label}: NOT MEASURED` +
                  ` (recorded ${check.recorded.count} of ${check.recorded.total}) — REGRESSION\n`
              : `          ${label}: ${check.current.empty} of ${check.current.queries}` +
                  ` (${pctOf(check.rate)}) now, ${check.recorded.count} of ${check.recorded.total}` +
                  ` (${pctOf(check.recordedRate)}) recorded — ${check.regressed ? 'REGRESSION' : 'ok'}\n`,
          );
          if (check.regressed) {
            process.stdout.write(
              check.missing
                ? `\nFAIL: the recorded baseline gates ${file} and it was not run.\n` +
                    'A gate that turns itself off when its file goes missing is not a gate.\n'
                : `\nFAIL: fewer of ${file} came back empty than the recorded baseline.\n` +
                    'Sentences the catalogue cannot answer are being answered with tools again.\n' +
                    `Do not edit ${file} to make this pass.\n`,
            );
            if (exitCode === EXIT.OK) exitCode = EXIT.REGRESSION;
          }
        }

        const cover = checkCoverageRegression(coverage, latest);
        if (cover) {
          process.stdout.write(
            cover.missing
              ? `          rerank coverage: NOT MEASURED (recorded ${cover.recorded.count} of ` +
                  `${cover.recorded.total}) — REGRESSION\n`
              : `          rerank coverage: ${cover.current.judged} of ${cover.current.searches}` +
                  ` (${pctOf(cover.rate)}) now, ${cover.recorded.count} of ${cover.recorded.total}` +
                  ` (${pctOf(cover.recordedRate)}) recorded, tolerance ${(COVERAGE_TOLERANCE * 100).toFixed(0)} points` +
                  ` — ${cover.regressed ? 'REGRESSION' : 'ok'}\n`,
          );
          if (cover.regressed) {
            process.stdout.write(
              '\nFAIL: fewer searches were judged than the recorded row was measured with.\n' +
                'A sentence with no judgement measures the PHASE 4 order, so a run that has\n' +
                'lost its judgements reports a number somewhere between the two phases while\n' +
                'looking like a measurement of this one. Re-record, or record a new row that\n' +
                'says what this build actually covers.\n',
            );
            if (exitCode === EXIT.OK) exitCode = EXIT.REGRESSION;
          }
        }

        const perturbation = checkPerturbationGate(perturbedEmpty, latest, vectorsUsed);
        if (perturbation) {
          process.stdout.write(
            `          perturbed golden queries empty: ${perturbation.current}` +
              `, allowed ${perturbation.allowed} — ${perturbation.regressed ? 'REGRESSION' : 'ok'}\n`,
          );
          if (perturbation.regressed) {
            process.stdout.write(
              '\nFAIL: a golden query comes back empty when it is typed slightly differently.\n' +
                'A full stop, a question mark, a "please" or one transposed letter must not\n' +
                'decide whether a question has an answer. The floor is too close to the\n' +
                'sentences it is judging.\n',
            );
            if (exitCode === EXIT.OK) exitCode = EXIT.REGRESSION;
          }
        }
      }
    }
  }

  // --- The recording's own summary ------------------------------------------
  //
  // `eval/baselines.md` cites recordings — "the middle of five", "0.8515 to
  // 0.8713" — and until the Phase 5 review those numbers existed only in the
  // sentence citing them. A spread nobody can open is a spread nobody can
  // check, and the fixture holds only the recording that was kept.
  //
  // So a run may write its own summary into eval/recordings/, which is
  // committed: the headline, every slice, the per-query nDCG and recall, what
  // each negatives file did, how much of the run was judged, and the tokens. It
  // is small (a few tens of kB), it is the evidence for one row, and it is
  // written only when asked for by name.
  if (opts.record) {
    const safe = String(opts.record).replace(/[^A-Za-z0-9._-]/g, '-');
    const summary = {
      schema: 'foundit-recording/1',
      name: safe,
      recordedAt: startedAt.toISOString(),
      plan: opts.plan,
      rerank: reranker
        ? {
            model: reranker.model,
            topN: reranker.n,
            samples: reranker.samples ?? 1,
            shownFrom: reranker.floor ?? 1,
            ...reranker.stats,
            // The raw per-call list is hundreds of integers and says nothing a
            // reader of a recording wants; the five numbers off it say all of
            // it. The list itself lives for the length of one process.
            outs: undefined,
            outputTokens: outputSpread(reranker.stats.outs ?? []),
          }
        : null,
      coverage,
      overall,
      slices,
      reference: writtenPerQuery ? aggregate(writtenPerQuery) : null,
      negatives: negOverall,
      heldOut: heldOverall,
      heldOut2: held2Overall,
      positives: positivesOverall,
      perturbed: perturbedPerQuery
        ? { variants: perturbedPerQuery.length, empty: perturbedEmpty }
        : null,
      violations: allViolations.length,
      queries: perQuery.map((e) => ({
        id: e.query.id,
        lang: e.query.lang,
        ndcgAt10: e.ndcg,
        recallAt10: e.recall,
        resultCount: e.resultCount,
        reranked: Boolean(e.reranked),
      })),
    };
    await mkdir(RECORDINGS_DIR, { recursive: true });
    const where = path.join(RECORDINGS_DIR, `${safe}.json`);
    await writeFile(where, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `\nRECORDING written to ${path.relative(ROOT, where).split(path.sep).join('/')}\n`,
    );
  }

  // --- Machine-readable -----------------------------------------------------
  if (opts.json) {
    const payload = {
      schema: 'foundit-eval/1',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      k: K,
      fetchLimit: opts.limit,
      timeoutMs: opts.timeout,
      goldenPath: path.relative(ROOT, opts.golden).split(path.sep).join('/'),
      baselinesPath: opts.baseline
        ? path.relative(ROOT, opts.baselines).split(path.sep).join('/')
        : null,
      overall,
      slices,
      queryVectorCache: warm,
      vectorsUsed,
      // Null when the reranker was off or could not be loaded, so a run of
      // either kind is distinguishable in the file rather than by arithmetic.
      rerank: reranker
        ? {
            model: reranker.model,
            topN: reranker.n,
            recording: opts.recordReranks,
            ...reranker.stats,
          }
        : null,
      constraintViolations: allViolations,
      regression,
      heldOut: heldOverall
        ? {
            path: path.relative(ROOT, opts.heldOut).split(path.sep).join('/'),
            overall: heldOverall,
            queries: heldPerQuery.map((e) => ({
              id: e.query.id,
              query: e.query.query,
              kind: e.query.kind,
              resultCount: e.results.length,
              returned: e.results.slice(0, 5).map((r) => ({ rank: r.rank, slug: r.slug })),
            })),
          }
        : null,
      perturbation: perturbedPerQuery
        ? {
            variants: perturbedPerQuery.length,
            empty: perturbedEmpty,
            emptyIds: perturbedPerQuery.filter((e) => e.results.length === 0).map((e) => e.query.id),
          }
        : null,
      // Null when eval/negatives.jsonl was not run.
      negatives: negOverall
        ? {
            path: path.relative(ROOT, opts.negatives).split(path.sep).join('/'),
            overall: negOverall,
            derived: writtenNegOverall,
            queries: negPerQuery.map((e) => ({
              id: e.query.id,
              query: e.query.query,
              lang: e.query.lang,
              kind: e.query.kind,
              resultCount: e.results.length,
              latencyMs: e.latencyMs,
              returned: e.results.map((r) => ({ rank: r.rank, slug: r.slug, matchSource: r.matchSource })),
            })),
          }
        : null,
      // Null unless --read-query was passed, so the shape of a default run's
      // JSON is unchanged and anything reading it keeps working.
      readQuery: readerComparison
        ? {
            authored: readerComparison.authored,
            derived: readerComparison.derived,
            divergence: readerComparison.divergence,
            worseCount: readerComparison.worseCount,
            betterCount: readerComparison.betterCount,
            unchangedCount: readerComparison.unchangedCount,
            relations: readerComparison.relations,
            emptiedText: readerComparison.emptiedText,
            constraintViolations: writtenViolations,
            queries: readerComparison.rows,
          }
        : null,
      exitCode,
      queries: perQuery.map((e) => ({
        id: e.query.id,
        query: e.query.query,
        lang: e.query.lang,
        constrained: e.constrained,
        constraints: e.query.constraints,
        judgedCount: e.judgedCount,
        resultCount: e.resultCount,
        ndcgAt10: e.ndcg,
        recallAt10: e.recall,
        latencyMs: e.latencyMs,
        violations: e.violations.length,
        reranked: Boolean(e.reranked),
        returned: e.results.map((r) => ({
          rank: r.rank,
          slug: r.slug,
          pricing: r.pricing,
          score: r.score,
          matchSource: r.matchSource,
          // What the reranker said about this row, or null where it did not
          // run. It is what eval/calibrate.mjs would fit against, and what a
          // reader of this file needs to tell a Strong from a Loose.
          relevance: e.judgement
            ? (e.judgement.find((v) => v.slug === r.slug)?.relevance ?? null)
            : null,
          grade: e.query.relevant[r.slug] ?? 0,
        })),
      })),
    };
    await mkdir(RESULTS_DIR, { recursive: true });
    // Colons are illegal in Windows filenames, so the ISO string is flattened
    // for the name; the true timestamp is inside the file.
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(RESULTS_DIR, `${stamp}.json`);
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    process.stdout.write(`\nJSON written to ${path.relative(ROOT, outPath).split(path.sep).join('/')}\n`);
  }

  return exitCode;
}

export function buildSlices(perQuery) {
  const of = (label, subset) => ({
    slice: label,
    ...aggregate(subset),
  });
  return [
    of('all', perQuery),
    of('english', perQuery.filter((e) => e.query.lang === 'en')),
    of('non-english', perQuery.filter((e) => e.query.lang !== 'en')),
    of('constrained', perQuery.filter((e) => e.constrained)),
    of('unconstrained', perQuery.filter((e) => !e.constrained)),
  ];
}

// ===========================================================================
// --read-query: the reader, measured.
//
// Everything above this point scores a search that was handed its constraints.
// Nobody types constraints. A visitor types a sentence, lib/constraints.ts
// decides what in that sentence is a filter, removes those words, and the rest
// is what gets ranked. That whole first step sat outside the instrument: a bug
// that put Proton Mail, Proton VPN and PDFsam Basic above every expense
// splitter for any query containing the word "free" was fixed without the
// recorded score moving by a single point, because the harness had never read
// a sentence in its life. A separate review found the reader turning "a
// website builder" into a web-only filter ranked on the word "builder" — also
// invisible here.
//
// So: run the same queries twice. Once as written (the ranker, in isolation),
// once as read (the ranker with the reader in front of it, which is the thing
// that is deployed). The gap between the two is the part of the shipped
// product that the default number does not cover, and it is the figure this
// section prints largest.
// ===========================================================================

/** `pricing=[a,b] platforms=[c]`, keys and values sorted so two are comparable. */
export function canonicalConstraints(constraints) {
  const c = constraints ?? {};
  const keys = Object.keys(c)
    .filter((k) => Array.isArray(c[k]) && c[k].length > 0)
    .sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=[${[...c[k]].map(String).sort().join(',')}]`).join(' ');
}

/**
 * How a golden entry's hand-written constraints and its derived ones relate.
 *
 * Four outcomes, and the two asymmetric ones are the interesting ones. "more"
 * is the reader inventing a filter nobody asked for, which silently deletes
 * correct answers; "less" is the reader missing one that was stated, which
 * lets wrong answers back in. They fail in opposite directions and are worth
 * counting separately.
 */
export function readingRelation(authored, derived) {
  const a = canonicalConstraints(authored);
  const d = canonicalConstraints(derived);
  if (a === d) return 'same';
  if (a === '') return 'more';
  if (d === '') return 'less';
  return 'other';
}

/** Pair the two passes up query by query and work out where they part company. */
export function compareReadings(authored, derived) {
  const derivedById = new Map(derived.map((e) => [e.query.id, e]));

  const rows = authored.map((a) => {
    const d = derivedById.get(a.query.id);
    return {
      id: a.query.id,
      lang: a.query.lang,
      query: a.query.query,
      authoredNdcg: a.ndcg,
      derivedNdcg: d.ndcg,
      ndcgDelta: d.ndcg - a.ndcg,
      authoredRecall: a.recall,
      derivedRecall: d.recall,
      recallDelta: d.recall - a.recall,
      authoredText: a.searchText,
      derivedText: d.searchText,
      authoredConstraints: canonicalConstraints(a.constraints),
      derivedConstraints: canonicalConstraints(d.constraints),
      readerKeys: d.readerKeys ?? [],
      authoredCount: a.resultCount,
      derivedCount: d.resultCount,
      relation: readingRelation(a.constraints, d.constraints),
    };
  });

  const overallAuthored = aggregate(authored);
  const overallDerived = aggregate(derived);

  // 1e-9: these are ratios of small sums of floats, and a query whose ranking
  // did not move can still differ in the last bit or two. Anything at that
  // scale is arithmetic noise, not a change in the search.
  const EPS = 1e-9;

  return {
    authored: overallAuthored,
    derived: overallDerived,
    divergence: {
      recallAt10: overallDerived.recallAt10 - overallAuthored.recallAt10,
      ndcgAt10: overallDerived.ndcgAt10 - overallAuthored.ndcgAt10,
      meanLatencyMs: overallDerived.meanLatencyMs - overallAuthored.meanLatencyMs,
      zeroResultQueries: overallDerived.zeroResultQueries - overallAuthored.zeroResultQueries,
    },
    worseCount: rows.filter((r) => r.ndcgDelta < -EPS).length,
    betterCount: rows.filter((r) => r.ndcgDelta > EPS).length,
    unchangedCount: rows.filter((r) => Math.abs(r.ndcgDelta) <= EPS).length,
    relations: {
      same: rows.filter((r) => r.relation === 'same').length,
      more: rows.filter((r) => r.relation === 'more').length,
      less: rows.filter((r) => r.relation === 'less').length,
      other: rows.filter((r) => r.relation === 'other').length,
    },
    // Text the reader emptied completely: search_tools reads that as browse,
    // so the sentence stops selecting anything at all.
    emptiedText: rows.filter((r) => r.derivedText.trim() === '').length,
    rows,
    worst: rows
      .filter((r) => r.ndcgDelta < -EPS)
      .sort((x, y) => x.ndcgDelta - y.ndcgDelta || x.id.localeCompare(y.id)),
  };
}

const WORST_READINGS = 10;

export function buildReaderReport(cmp) {
  const out = [];
  const signed4 = (v) => `${v >= 0 ? '+' : ''}${n4(v)}`;
  const signed1 = (v) => `${v >= 0 ? '+' : ''}${n1(v)}`;
  const signedInt = (v) => `${v >= 0 ? '+' : ''}${v}`;

  out.push('');
  out.push('=== The reader, measured (--read-query) ===================================');
  out.push('Two slices. Same queries, same database, same judgements. They differ in');
  out.push('one thing: where the constraints and the search text came from.');
  out.push('');
  out.push('  authored   constraints written by hand in eval/golden.jsonl, and the whole');
  out.push('             sentence given to full-text search. Measures the ranker, with');
  out.push('             the reading held correct by assumption.');
  out.push('  derived    constraints read out of the sentence by lib/constraints.ts, and');
  out.push('             the residual text given to full-text search. Measures the reader');
  out.push('             and the ranker together — the path a visitor actually takes.');
  out.push('');
  out.push(
    renderTable(
      ['slice', 'n', 'recall@10', 'nDCG@10', 'mean ms', 'p95 ms', 'zero'],
      [
        [
          'authored',
          String(cmp.authored.queries),
          n4(cmp.authored.recallAt10),
          n4(cmp.authored.ndcgAt10),
          n1(cmp.authored.meanLatencyMs),
          n1(cmp.authored.p95LatencyMs),
          String(cmp.authored.zeroResultQueries),
        ],
        [
          'derived',
          String(cmp.derived.queries),
          n4(cmp.derived.recallAt10),
          n4(cmp.derived.ndcgAt10),
          n1(cmp.derived.meanLatencyMs),
          n1(cmp.derived.p95LatencyMs),
          String(cmp.derived.zeroResultQueries),
        ],
        [
          'DIVERGENCE',
          '',
          signed4(cmp.divergence.recallAt10),
          signed4(cmp.divergence.ndcgAt10),
          signed1(cmp.divergence.meanLatencyMs),
          '',
          signedInt(cmp.divergence.zeroResultQueries),
        ],
      ],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
  );
  out.push('');
  out.push('--- The divergence --------------------------------------------------------');
  out.push('DIVERGENCE is the number this mode exists for. It is not a second opinion on');
  out.push('the ranker; it is the size of the part of the shipped search that the default');
  out.push('run cannot see. A ranking fix that only helps queries the reader mangles');
  out.push('first will move the derived row and leave the authored row exactly where it');
  out.push('was — which is what happened, unmeasured, the last time one landed.');
  out.push('');
  out.push(
    `  nDCG@10   ${n4(cmp.authored.ndcgAt10)} authored -> ${n4(cmp.derived.ndcgAt10)} derived ` +
      `(${signed4(cmp.divergence.ndcgAt10)})`,
  );
  out.push(
    `  recall@10 ${n4(cmp.authored.recallAt10)} authored -> ${n4(cmp.derived.recallAt10)} derived ` +
      `(${signed4(cmp.divergence.recallAt10)})`,
  );
  out.push(
    `  per query ${cmp.worseCount} worse, ${cmp.betterCount} better, ${cmp.unchangedCount} unchanged ` +
      `(of ${cmp.rows.length})`,
  );
  out.push('');
  out.push('--- What the reader did to the constraints --------------------------------');
  out.push(
    renderTable(
      ['reading', 'queries', 'meaning'],
      [
        ['same', String(cmp.relations.same), 'derived constraints match the hand-written ones'],
        ['more', String(cmp.relations.more), 'golden set states none; the reader filtered anyway'],
        ['less', String(cmp.relations.less), 'golden set states some; the reader read none'],
        ['other', String(cmp.relations.other), 'both state constraints, and they differ'],
        ['(text emptied)', String(cmp.emptiedText), 'nothing left to rank on; search_tools browses'],
      ],
      ['l', 'r', 'l'],
    ),
  );
  out.push('');

  if (cmp.worst.length === 0) {
    out.push('--- Where the reading costs the most --------------------------------------');
    out.push('No query scored worse when read than when handed its constraints.');
    out.push('');
    return out.join('\n');
  }

  const shown = cmp.worst.slice(0, WORST_READINGS);
  out.push(
    `--- Where the reading costs the most (${shown.length} of ${cmp.worst.length}) ` +
      '-'.repeat(Math.max(0, 30 - String(cmp.worst.length).length)),
  );
  out.push(
    renderTable(
      ['id', 'lang', 'rel', 'authored', 'derived', 'delta', 'query'],
      shown.map((r) => [
        r.id,
        r.lang,
        r.relation,
        n4(r.authoredNdcg),
        n4(r.derivedNdcg),
        signed4(r.ndcgDelta),
        truncate(r.query, 44),
      ]),
      ['l', 'l', 'l', 'r', 'r', 'r', 'l'],
    ),
  );
  out.push('');

  for (const r of shown) {
    out.push(`  ${r.id}  ${r.query}`);
    out.push(
      `    authored  nDCG ${n4(r.authoredNdcg)}  n=${r.authoredCount}  ` +
        `filters ${r.authoredConstraints || '(none)'}`,
    );
    out.push(`              text "${r.authoredText}"`);
    out.push(
      `    derived   nDCG ${n4(r.derivedNdcg)}  n=${r.derivedCount}  ` +
        `filters ${r.derivedConstraints || '(none)'}`,
    );
    out.push(
      `              text "${r.derivedText}"` +
        (r.readerKeys.length ? `   read: ${r.readerKeys.join(', ')}` : ''),
    );
    out.push(`    delta     ${signed4(r.ndcgDelta)} nDCG@10, ${signed4(r.recallDelta)} recall@10`);
    out.push('');
  }

  return out.join('\n');
}

/**
 * The negatives section: how many of the sentences the catalogue cannot
 * answer came back empty, beside the golden numbers so the trade is on one
 * screen, and every one that leaked with what it leaked.
 */
export function buildNegativesReport({
  overall,
  perQuery,
  derived = null,
  golden = null,
  title = 'The negatives: sentences the catalogue cannot answer',
  note = null,
  label = 'as the shipped reader reads it',
  derivedLabel = 'as written, no reader',
}) {
  const out = [];
  const pctOf = (r) => `${(r * 100).toFixed(1)}%`;
  out.push('');
  out.push(`=== ${title} ${'='.repeat(Math.max(0, 74 - title.length))}`);
  out.push('Right answer: an empty page. Every row returned here is a tool shown to');
  out.push('somebody whose problem nothing in the catalogue solves.');
  if (note) out.push(note);
  out.push('');
  const rows = [
    [
      label,
      String(overall.queries),
      `${overall.empty}`,
      pctOf(overall.emptyRate),
      n1(overall.meanLeaked),
      String(overall.maxLeaked),
      `${overall.byKind.far?.empty ?? 0}/${overall.byKind.far?.queries ?? 0}`,
      `${overall.byKind.near?.empty ?? 0}/${overall.byKind.near?.queries ?? 0}`,
      // eval/negatives.jsonl has no non-English kind and eval/negatives.review.jsonl
      // has five. The column is printed for both so the two tables line up and so
      // a report can quote far / near / non-English without arithmetic.
      `${overall.byKind.nonen?.empty ?? 0}/${overall.byKind.nonen?.queries ?? 0}`,
    ],
  ];
  if (derived) {
    rows.push([
      derivedLabel,
      String(derived.queries),
      `${derived.empty}`,
      pctOf(derived.emptyRate),
      n1(derived.meanLeaked),
      String(derived.maxLeaked),
      `${derived.byKind.far?.empty ?? 0}/${derived.byKind.far?.queries ?? 0}`,
      `${derived.byKind.near?.empty ?? 0}/${derived.byKind.near?.queries ?? 0}`,
      `${derived.byKind.nonen?.empty ?? 0}/${derived.byKind.nonen?.queries ?? 0}`,
    ]);
  }
  out.push(
    renderTable(
      ['negatives', 'n', 'empty', 'empty %', 'mean leaked', 'max', 'far empty', 'near empty', 'non-en empty'],
      rows,
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
  );
  if (golden) {
    out.push('');
    out.push(
      `  beside the golden set: nDCG@10 ${n4(golden.ndcgAt10)}, recall@10 ${n4(golden.recallAt10)}, ` +
        `${golden.zeroResultQueries} of ${golden.queries} golden queries empty`,
    );
  }
  const leaked = perQuery.filter((e) => e.results.length > 0);
  out.push('');
  if (leaked.length === 0) {
    out.push('No negative returned anything.');
  } else {
    out.push(`--- The ${leaked.length} that leaked ---------------------------------------------------`);
    for (const e of leaked) {
      out.push(`  ${e.query.id}  ${e.query.kind.padEnd(4)}  ${e.query.lang.padEnd(3)}  n=${String(e.results.length).padStart(2)}  ${e.query.query}`);
      out.push(`        ${e.results.slice(0, 5).map((r) => `${r.rank}.${r.slug}(${r.matchSource})`).join('  ')}`);
    }
  }
  out.push('');
  return out.join('\n');
}

/**
 * The perturbation gate: every golden query, typed four slightly different
 * ways, and the only question asked of each is whether the page emptied.
 *
 * This exists because the first relevance floor was an absolute threshold that
 * one golden query sat 0.0015 above. A full stop moved it under. Nobody types
 * a sentence twice the same way, and a search that answers a question only in
 * its canonical spelling does not answer it.
 */
/**
 * What a search costs, from the providers' own usage numbers.
 *
 * Not an estimate and not a token count of the prompt as written: these are the
 * `usage` fields the two APIs returned, totalled over every sentence that has
 * ever been recorded into db/seed/embeddings.fixture.json and divided by how
 * many that was. A keyless run makes no call to count, so the fixture carrying
 * the numbers is what makes this figure available at all — and it is the same
 * figure on a laptop and on CI, which is the point.
 *
 * Priced at the FULL input rate. The reader's prompt is about 1,650 tokens of
 * instructions that never change, so the provider's automatic prefix caching
 * will often bill a tenth of that; a ceiling wants the pessimistic number, and
 * nothing here sets a cache key because a cache key on somebody's sentence is a
 * correlation handle.
 *
 * @param fixture   the parsed fixture, for its recorded token totals
 * @param embedding tokens this run's own embedding calls used, if any
 */
/**
 * What the reranker did, in counts rather than in adjectives.
 *
 * `judged` is the number this run's claim rests on: a run where half the
 * sentences had no recorded judgement is a run measuring half of Phase 5 and
 * half of Phase 4, and the only way to see that is to print it.
 */
/**
 * The sentences that DO have answers.
 *
 * This is the counterweight to every negatives file in this directory. Each of
 * those rewards a search for showing less, and a reranker is a machine for
 * showing less — so a change that empties more near misses and also drops the
 * right answer on a real question scores BETTER on four files out of five. This
 * is the fifth.
 *
 * Two numbers, because they fail differently. "Rank one" is the page a person
 * reads first. "On the page" is whether they find it at all. The reranker can
 * move a tool down and it can remove it, and only the second is unrecoverable.
 */
export function buildPositivesReport(overall, perQuery) {
  const out = [];
  out.push('');
  out.push(`=== The reviewer's answerable sentences ${'='.repeat(36)}`);
  out.push('Fifteen sentences with an expected answer, written by the Phase 5 reviewer');
  out.push('before reading anything of ours. Reported, never gated: it is held out, and');
  out.push('a set that is gated on has been tuned against.');
  out.push('');
  out.push(`  an expected tool FIRST      ${overall.rankOne} of ${overall.queries}`);
  out.push(`  an expected tool anywhere   ${overall.onThePage} of ${overall.queries}`);
  out.push(`  came back EMPTY             ${overall.empty} of ${overall.queries}`);
  out.push('');

  const missed = perQuery.filter((e) => !e.results.some((r) => e.query.expect.includes(r.slug)));
  if (missed.length === 0) {
    out.push('Every one of them has an acceptable answer on the page.');
  } else {
    out.push(`--- The ${missed.length} the search did not answer ${'-'.repeat(30)}`);
    for (const e of missed) {
      out.push(`  ${e.query.id}  ${e.query.lang}  n=${String(e.results.length).padStart(2)}  ${e.query.query}`);
      out.push(`        wanted any of: ${e.query.expect.join(', ')}`);
      out.push(`        got: ${e.results.slice(0, 5).map((r) => `${r.rank}.${r.slug}`).join('  ') || '(nothing)'}`);
    }
  }
  out.push('');
  return out.join('\n');
}

/**
 * The distribution of one recording's per-request output tokens, or null when
 * it made no call.
 *
 * A MEAN IS THE WRONG STATISTIC HERE and that is the whole reason this exists.
 * `max_output_tokens` is what the worst case is billed at, so the number the
 * daily caps are multiplied by has to come off the tail rather than the middle
 * — the reader's ceiling stood at 900 against a mean of 65 and a p99 of 117
 * until somebody measured the three.
 */
export function outputSpread(outs) {
  if (!Array.isArray(outs) || outs.length === 0) return null;
  const sorted = [...outs].sort((a, b) => a - b);
  return {
    calls: sorted.length,
    mean: Math.round(mean(sorted)),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

export function buildRerankReport(reranker, passes) {
  const out = [];
  const s = reranker.stats;
  const searched = passes
    .filter(Boolean)
    .flat()
    .filter((e) => !e.refusedAsNotSoftware);
  // The same denominator the Rerank coverage gate uses, and it has to be: two
  // numbers for "how much of this run was Phase 5" that disagree by fifteen
  // searches is how a reader stops believing either. A search that came back
  // with nothing at all had no candidates to judge, so counting it as an
  // unjudged search would blame the reranker for an empty result set.
  const judgeable = searched.filter((e) => e.results.length + (e.judgement?.length ?? 0) > 0);
  const reranked = searched.filter((e) => e.reranked);
  const emptied = reranked.filter((e) => e.results.length === 0).length;
  const dropped = reranked.reduce(
    (a, e) => a + Math.max(0, (e.judgement?.length ?? 0) - e.results.length),
    0,
  );

  out.push('');
  out.push(`=== The reranker ${'='.repeat(58)}`);
  out.push('Every candidate the search returned, read against the sentence by');
  out.push(`${reranker.model} and graded 0 to 3. Anything graded 0 is dropped.`);
  out.push('');
  out.push(`  candidates judged per search  top ${reranker.n}`);
  out.push(
    `  samples per judgement         ${reranker.samples ?? 1}` +
      ((reranker.samples ?? 1) > 1 ? ' (the LOWER mark of them is the grade)' : ''),
  );
  out.push(
    `  shown from relevance          ${reranker.floor ?? 1}` +
      (reranker.floor >= 2 ? ' (a "Loose" 1 is dropped, not shown)' : ' (0 is dropped)'),
  );
  out.push(`  searches with a judgement     ${s.judged} of ${judgeable.length}`);
  out.push(`  searches with none recorded   ${s.missing}  (these measure the Phase 4 order)`);
  out.push(`  recorded judgements refused   ${s.refused}`);
  if (reranker.record) {
    out.push(`  judgements recorded this run  ${s.recorded} (${s.failed} failed)`);
    out.push(`  judgements from ONE sample    ${s.oneSample ?? 0} (the other call did not return)`);
    out.push(`  tokens                        ${s.tokensIn} in, ${s.tokensOut} out`);
    // The distribution rather than the mean, because a max_output_tokens
    // ceiling bounds ONE request and a daily cap is multiplied by it. The
    // reader's half of the same question is scripts/output-tokens.mjs.
    const spread = outputSpread(s.outs ?? []);
    if (spread) {
      out.push(
        `  output tokens per request     p50 ${spread.p50}, p90 ${spread.p90}, ` +
          `p99 ${spread.p99}, max ${spread.max} over ${spread.calls} call(s)`,
      );
      out.push(
        `  a 3x-p99 ceiling would be     ${3 * spread.p99}` +
          (reranker.maxOutputTokens ? ` (lib/rerank.ts sends ${reranker.maxOutputTokens})` : ''),
      );
    }
  }
  out.push(`  results dropped as "not for this"  ${dropped}`);
  out.push(`  pages emptied by the judgement     ${emptied}`);
  if (s.note) out.push(`  NOTE: ${s.note}`);
  out.push('');
  return out.join('\n');
}

export function buildCostReport(fixture, prices, reranker = null) {
  const out = [];
  const recorded = fixture?.readingTokens ?? null;

  out.push('');
  out.push(`=== What a search costs ${'='.repeat(52)}`);

  if (!recorded || !recorded.sentences) {
    out.push('No recorded token counts in db/seed/embeddings.fixture.json, so this run');
    out.push('cannot price a search. Re-record: scripts/read.mjs --write-fixture.');
    return out.join('\n');
  }

  // The embedding side: one query embedding per uncached search. The document
  // side is a one-off batch job and is not a per-search cost.
  const readerIn = recorded.in / recorded.sentences;
  const readerOut = recorded.out / recorded.sentences;
  // Measured the same way: the whole fixture's query vectors cost this many
  // prompt tokens for this many sentences. A short sentence is a few tokens and
  // it barely registers beside the reader, which is itself the point.
  const embeddingIn = fixture?.queryTokens?.sentences
    ? fixture.queryTokens.in / fixture.queryTokens.sentences
    : 8;

  // The reranker's half, measured the same way and counted only when it ran.
  // A search where it did not run does not cost this, and a run with it off
  // must not report a cost that includes it.
  const judgements = fixture?.rerankTokens?.judgements ?? 0;
  const rerankIn = reranker && judgements ? fixture.rerankTokens.in / judgements : 0;
  const rerankOut = reranker && judgements ? fixture.rerankTokens.out / judgements : 0;

  const cost = prices.costOf({ readerIn, readerOut, embeddingIn, rerankIn, rerankOut, searches: 1 });

  out.push(
    renderTable(
      ['per search', 'tokens', '$ / 1M', '$ each'],
      [
        ['reader in', n1(readerIn), prices.READER_INPUT_PER_MTOK.toFixed(3), cost.reader.toFixed(8)],
        ['reader out', n1(readerOut), prices.READER_OUTPUT_PER_MTOK.toFixed(3), ''],
        ['embedding in', n1(embeddingIn), prices.EMBEDDING_INPUT_PER_MTOK.toFixed(3), cost.embedding.toFixed(8)],
        ['rerank in', n1(rerankIn), prices.RERANK_INPUT_PER_MTOK.toFixed(3), cost.rerank.toFixed(8)],
        ['rerank out', n1(rerankOut), prices.RERANK_OUTPUT_PER_MTOK.toFixed(3), ''],
      ],
      ['l', 'r', 'r', 'r'],
    ),
  );
  out.push('');
  out.push(`  cost per search              $${cost.perSearch.toFixed(6)}`);
  out.push(`  cost per thousand searches   $${cost.perThousand.toFixed(4)}`);
  out.push(
    `  ceiling (docs/build-phases) $${prices.MAX_COST_PER_SEARCH.toFixed(6)} per search — ` +
      `${cost.withinCeiling ? 'within it' : 'OVER IT'}`,
  );
  out.push(
    `  measured from ${recorded.sentences} readings recorded on ${fixture.readingsRecorded ?? 'an unknown date'}, ` +
      `at prices read from ${prices.PRICES_SOURCE} on ${prices.PRICES_READ_ON}`,
  );
  out.push('');
  out.push('  Every sentence typed twice costs nothing at all: both caches are keyed on');
  out.push('  the normalised text, so the figures above are the price of a FIRST-EVER');
  out.push('  sentence and the steady state is cheaper than this by whatever share of');
  out.push('  searches repeat.');

  return out.join('\n');
}

export function buildPerturbationReport(entries) {
  const out = [];
  const empty = entries.filter((e) => e.results.length === 0);
  const byBase = new Map();
  for (const e of empty) {
    const base = e.query.base ?? e.query.id;
    byBase.set(base, [...(byBase.get(base) ?? []), e.query.variant ?? '?']);
  }

  out.push('');
  out.push('=== Perturbed golden queries ==============================================');
  out.push('Each golden query, typed four ways somebody might actually type it: a full');
  out.push('stop, a question mark, " please", and one transposed letter. A variant that');
  out.push('empties a page means the floor is measuring the punctuation.');
  out.push('');
  out.push(`  variants searched   ${entries.length}`);
  out.push(`  came back EMPTY     ${empty.length}`);
  out.push(`  queries affected    ${byBase.size}`);
  if (byBase.size > 0) {
    out.push('');
    for (const [base, variants] of byBase) {
      out.push(`  ${base}  empty under: ${variants.join(', ')}`);
    }
  }
  out.push('');
  return out.join('\n');
}

/**
 * Build the whole stdout report as a string. Separated from writing it so the
 * self-test can render a synthetic run and check the output without a
 * database — this is the one code path that otherwise never runs offline.
 */
export function buildReport({ overall, slices, worst, perQuery, unjudged, opts, startedAt }) {
  const out = [];

  out.push('');
  out.push('=== Foundit search eval ===================================================');
  out.push(`run at        ${startedAt.toISOString()}`);
  out.push(`golden set    ${path.relative(ROOT, opts.golden).split(path.sep).join('/')}`);
  out.push(`queries       ${overall.queries}`);
  out.push(`cutoff        K = ${K} (rows fetched per query: ${opts.limit})`);
  out.push('');

  out.push('--- Overall ---------------------------------------------------------------');
  out.push(
    renderTable(
      ['metric', 'value'],
      [
        ['recall@10', n4(overall.recallAt10)],
        ['nDCG@10', n4(overall.ndcgAt10)],
        ['mean latency ms', n1(overall.meanLatencyMs)],
        ['p95 latency ms', n1(overall.p95LatencyMs)],
        ['zero-result queries', `${overall.zeroResultQueries} of ${overall.queries}`],
        ['constraint violations', String(perQuery.reduce((a, e) => a + e.violations.length, 0))],
      ],
      ['l', 'r'],
    ),
  );
  out.push('');

  out.push('--- Slices ----------------------------------------------------------------');
  out.push(
    renderTable(
      ['slice', 'n', 'recall@10', 'nDCG@10', 'mean ms', 'p95 ms', 'zero'],
      slices.map((s) => [
        s.slice,
        String(s.queries),
        s.queries ? n4(s.recallAt10) : '-',
        s.queries ? n4(s.ndcgAt10) : '-',
        s.queries ? n1(s.meanLatencyMs) : '-',
        s.queries ? n1(s.p95LatencyMs) : '-',
        String(s.zeroResultQueries),
      ]),
      ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
  );
  out.push('');

  out.push('--- Five worst queries by nDCG@10 -----------------------------------------');
  out.push(
    renderTable(
      ['id', 'lang', 'cons', 'nDCG@10', 'recall@10', 'n', 'query'],
      worst.map((e) => [
        e.query.id,
        e.query.lang,
        e.constrained ? 'yes' : 'no',
        n4(e.ndcg),
        n4(e.recall),
        String(e.resultCount),
        truncate(e.query.query, 52),
      ]),
      ['l', 'l', 'l', 'r', 'r', 'r', 'l'],
    ),
  );
  out.push('');

  for (const e of worst) {
    const q = e.query;
    out.push(`  ${q.id}  ${q.query}`);
    if (q.note) out.push(`    note      ${q.note}`);
    const constraintText = Object.entries(q.constraints)
      .map(([k, v]) => `${k}=[${v.join(',')}]`)
      .join(' ');
    if (constraintText) out.push(`    filters   ${constraintText}`);

    const got = e.results.slice(0, K).map((r) => {
      const grade = q.relevant[r.slug] ?? 0;
      return `${r.rank}.${r.slug}(rel ${grade})`;
    });
    out.push(...wrapList(got, 'got'));

    const rankBySlug = new Map(e.results.map((r) => [r.slug, r.rank]));
    const wanted = Object.entries(q.relevant)
      .sort((a, b) => b[1] - a[1])
      .map(([slug, grade]) => {
        const rank = rankBySlug.get(slug);
        const where = rank === undefined
          ? 'MISSING'
          : rank <= K
            ? `at ${rank}`
            : `at ${rank}, below the cutoff`;
        return `${slug}(rel ${grade}, ${where})`;
      });
    out.push(...(wanted.length ? wrapList(wanted, 'wanted', 4) : ['    wanted    (no judgements)']));
    out.push('');
  }

  if (unjudged.length > 0) {
    out.push('--- Golden set warnings ---------------------------------------------------');
    out.push(`${unjudged.length} query/queries have an empty "relevant" map and score 0 by definition:`);
    for (const q of unjudged) out.push(`  ${q.id} (line ${q.line}) ${truncate(q.query, 60)}`);
    out.push('');
  }

  return out.join('\n');
}

function printReport(args) {
  process.stdout.write(`${buildReport(args)}\n`);
}

/** Same split as buildReport: build the text, then write it. */
export function buildViolationReport(violations) {
  const out = [];
  out.push('');
  out.push('!!! CONSTRAINT VIOLATIONS !!!==============================================');
  out.push(`${violations.length} returned row(s) broke a hard filter.`);
  out.push('');
  out.push('A constraint is a WHERE clause, not a ranking signal. "Free" is never a');
  out.push('vibe. This fails the run regardless of the scores above.');
  out.push('');
  out.push(
    renderTable(
      ['query', 'rank', 'slug', 'constraint', 'wanted', 'tool actually has'],
      violations.slice(0, 50).map((v) => [
        v.queryId,
        String(v.rank),
        v.slug,
        v.key,
        truncate(v.wanted.join(','), 40),
        truncate(String(v.got), 40),
      ]),
      ['l', 'r', 'l', 'l', 'l', 'l'],
    ),
  );
  if (violations.length > 50) out.push(`... and ${violations.length - 50} more.`);
  out.push('');
  out.push('===========================================================================');
  return out.join('\n');
}

function printViolations(violations) {
  process.stdout.write(`${buildViolationReport(violations)}\n`);
}

// Run only when invoked directly, so scoring.test.mjs can import the maths.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    const redact = makeRedactor(process.env.DATABASE_URL);
    process.stderr.write(`\nERROR: ${redact(err?.stack ?? err?.message ?? err)}\n`);
    process.exitCode = EXIT.DATABASE;
  }
}

export { main };
