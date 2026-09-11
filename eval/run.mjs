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
import { existsSync } from 'node:fs';
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
const BASELINES_PATH = path.join(EVAL_DIR, 'baselines.md');
const RESULTS_DIR = path.join(EVAL_DIR, 'results');

export const EXIT = {
  OK: 0,
  USAGE: 1,
  CONSTRAINT_VIOLATION: 2,
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

// ===========================================================================
// Baselines
// ===========================================================================

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
    readQuery: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--baseline') opts.baseline = true;
    else if (arg === '--read-query') opts.readQuery = true;
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
    else return { error: `unknown argument: ${arg}` , opts };
  }
  if (!Number.isInteger(opts.limit) || opts.limit < K) {
    return { error: `--limit must be an integer >= ${K}`, opts };
  }
  if (!Number.isInteger(opts.timeout) || opts.timeout < 100) {
    return { error: '--timeout must be an integer >= 100 (milliseconds)', opts };
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
  --read-query    also run every query through lib/constraints.ts — derived
                  constraints, residual text — and print both slices and the
                  divergence between them. Off by default; changes nothing
                  about the headline numbers or the regression gate.

Exit: 0 ok, 1 usage, 2 constraint violation, 3 database, 4 regression.`;

const SEARCH_SQL = `
  select tool_id, slug, name, summary, pricing, score, match_source
    from public.search_tools(
      p_query     => $1::text,
      p_pricing   => $2::pricing_model[],
      p_platforms => $3::platform[],
      p_flags     => $4::tool_flag[],
      p_languages => $5::text[],
      p_limit     => $6::int
    )`;

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
async function warmQueryCache(client, texts, redact) {
  const summary = {
    wanted: 0,
    cached: 0,
    embedded: 0,
    /** Sentences still without a vector when the warm-up finished. */
    missing: 0,
    requests: 0,
    tokens: 0,
    note: null,
  };

  const unique = [...new Set(texts.map((t) => String(t ?? '')).filter((t) => t.trim() !== ''))];
  if (unique.length === 0) return summary;

  // Dynamic, for the same reason eval/reader.mjs is: a default run must not
  // fail to start because a module it may not need did not load.
  let embeddings;
  try {
    embeddings = await import('../lib/embeddings.ts');
  } catch (err) {
    summary.note = `lib/embeddings.ts did not load (${redact(err?.message ?? err)}); every query measures text-only`;
    return summary;
  }

  const normalized = [...new Set(unique.map((t) => embeddings.normalizeQuery(t)).filter((t) => t !== ''))];
  summary.wanted = normalized.length;

  const { rows } = await client.query(MISSING_EMBEDDINGS_SQL, [normalized]);
  const missing = rows.map((r) => r.text);
  summary.cached = normalized.length - missing.length;
  summary.missing = missing.length;
  if (missing.length === 0) return summary;

  if (!embeddings.embeddingsConfigured()) {
    summary.note =
      `${missing.length} sentence(s) have no cached vector and EMBEDDINGS_API_KEY is not set; ` +
      'those queries measure text-only, exactly as the application would serve them';
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
const AUTHORED_PLAN = (q) => ({ text: q.query, constraints: q.constraints });

/**
 * Run every golden query once under one plan and return the raw results.
 *
 * @throws EvalExit on any database error, after reporting it.
 */
async function runPass(client, queries, opts, plan, redact) {
  const entries = [];

  for (const q of queries) {
    const planned = plan(q);
    const constraints = planned.constraints ?? {};
    const params = [
      planned.text,
      constraints.pricing ?? null,
      constraints.platforms ?? null,
      constraints.flags ?? null,
      constraints.languages ?? null,
      opts.limit,
    ];

    const t0 = performance.now();
    let rows;
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
    const latencyMs = performance.now() - t0;

    const results = rows.map((r, i) => ({
      rank: i + 1,
      toolId: r.tool_id === null ? null : String(r.tool_id),
      slug: String(r.slug),
      name: r.name,
      pricing: r.pricing,
      score: r.score === null ? null : Number(r.score),
      matchSource: r.match_source,
    }));

    entries.push({
      query: q,
      searchText: planned.text,
      constraints,
      // Only the derived plan sets these; they are reported, never asserted on.
      readerKeys: planned.keys ?? null,
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
        'Set it for this command only, so it does not linger in your shell:',
        '',
        '  bash/zsh     DATABASE_URL=postgres://user:pass@host:5432/foundit node eval/run.mjs',
        '  PowerShell   $env:DATABASE_URL = \'postgres://user:pass@host:5432/foundit\'; node eval/run.mjs',
        '',
        'Use a read-only role. The harness only ever runs SELECT.',
        '',
      ].join('\n'),
    );
    return EXIT.USAGE;
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
  let derivedPlan = null;
  if (opts.readQuery) {
    try {
      const { readForSearch } = await import('./reader.mjs');
      derivedPlan = (q) => readForSearch(q.query);
    } catch (err) {
      process.stderr.write(
        [
          'ERROR: --read-query could not load the sentence reader.',
          `  ${redact(err?.message ?? err)}`,
          '',
          'eval/reader.mjs imports lib/constraints.ts directly, which needs a Node',
          `that strips TypeScript types (this repository requires >= 26; running ${process.version}).`,
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
  let derivedPerQuery = null;
  const allViolations = [];
  const derivedViolations = [];
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
    if (derivedPlan) {
      process.stdout.write(
        '  --read-query: running each query twice — once as written in the golden\n' +
          '  set, once as lib/constraints.ts reads it.\n',
      );
    }

    // --- The vector leg's half of the search, before anything is measured ---
    // This is the only write the harness makes anywhere, it goes to a cache
    // with no user column, and it happens before the session is sealed
    // read-only rather than despite it.
    try {
      const texts = queries.map((q) => AUTHORED_PLAN(q).text);
      if (derivedPlan) {
        for (const q of queries) texts.push(derivedPlan(q).text);
      }
      warm = await warmQueryCache(client, texts, redact);
      process.stdout.write(
        `  query vectors: ${warm.cached} already cached, ${warm.embedded} embedded ` +
          `in ${warm.requests} request(s), ${warm.tokens} prompt tokens.\n`,
      );
      if (warm.note) process.stdout.write(`  NOTE: ${warm.note}\n`);
    } catch (err) {
      process.stderr.write(`ERROR warming the query-embedding cache.\n  ${redact(err.message)}\n`);
      return EXIT.DATABASE;
    }

    // Everything from here is measurement, and measurement does not write.
    await client.query('set session characteristics as transaction read only');

    // --- Run every query, sequentially ------------------------------------
    perQuery = await runPass(client, queries, opts, AUTHORED_PLAN, redact);
    if (derivedPlan) {
      derivedPerQuery = await runPass(client, queries, opts, derivedPlan, redact);
    }

    // --- One lookup for the ground truth about every returned tool --------
    // Both passes are covered by the one lookup: a slug is a slug, and the
    // facts about it do not depend on which query brought it back.
    const returnedSlugs = [
      ...new Set(
        [...perQuery, ...(derivedPerQuery ?? [])].flatMap((r) => r.results.map((x) => x.slug)),
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
    if (derivedPerQuery) {
      scorePass(derivedPerQuery, factsBySlug);
      for (const entry of derivedPerQuery) derivedViolations.push(...entry.violations);
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
  if (derivedPerQuery) {
    readerComparison = compareReadings(perQuery, derivedPerQuery);
    process.stdout.write(`${buildReaderReport(readerComparison)}\n`);
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
  if (derivedViolations.length > 0) {
    process.stdout.write('\n(the violations below are from the --read-query derived pass)\n');
    printViolations(derivedViolations);
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
      const rows = parseBaselines(await readFile(opts.baselines, 'utf8'));
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
      }
    }
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
      constraintViolations: allViolations,
      regression,
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
            constraintViolations: derivedViolations,
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
        returned: e.results.map((r) => ({
          rank: r.rank,
          slug: r.slug,
          pricing: r.pricing,
          score: r.score,
          matchSource: r.matchSource,
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
