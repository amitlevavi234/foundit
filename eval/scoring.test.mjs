#!/usr/bin/env node
// ===========================================================================
// Self-test for the scoring arithmetic in eval/run.mjs.
//
// Nobody is going to re-derive nDCG while reading a pull request, so it gets
// proved here instead. Every expected value below was worked out by hand and
// the working is written next to it. Where a case has an exact answer (1, 0,
// 1/2) it is asserted exactly; where it does not, the arithmetic is spelled
// out digit by digit and compared with a 1e-9 tolerance.
//
// Useful constants:
//   log2(2)  = 1                     log2(3) = 1.584962500721156
//   log2(4)  = 2                     log2(5) = 2.321928094887362
//   log2(11) = 3.4594316186372973
//   1/log2(3) = 0.630929753571457    1/log2(5) = 0.430676558073393
//   1/log2(11) = 0.28906482631788785
//
// Run:  node eval/scoring.test.mjs        (no database needed)
// ===========================================================================

import {
  gain, dcg, ndcg, recall, mean, percentile,
  checkConstraints, isConstrained, aggregate, buildSlices,
  parseGolden, parseBaselines, pickBaseline, checkRegression, renderTable,
  buildReport, buildViolationReport, K,
  parseNegatives, aggregateNegatives, parseCountOf, checkZeroResultRegression,
  checkNegativesRegression, buildNegativesReport,
} from './run.mjs';

let passed = 0;
const failures = [];

function check(name, actual, expected, tolerance = 0) {
  const ok = tolerance === 0
    ? Object.is(actual, expected) || actual === expected
    : Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed += 1;
    process.stdout.write(`  ok    ${name}\n`);
  } else {
    failures.push(name);
    process.stdout.write(`  FAIL  ${name}\n        expected ${expected}, got ${actual}\n`);
  }
}

function checkDeep(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    process.stdout.write(`  ok    ${name}\n`);
  } else {
    failures.push(name);
    process.stdout.write(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}\n`);
  }
}

const EPS = 1e-9;

// Built from character codes rather than escape sequences so no editor,
// shell or copy-paste on the way here can quietly turn it into something
// else. 27 is ESC, 155 is the 8-bit CSI: either one means the output has
// colour codes in it and will not survive being pasted into a chat window.
const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
function hasControlCodes(text) {
  return text.includes(ESC) || text.includes(CSI);
}

// ---------------------------------------------------------------------------
process.stdout.write('\ngain(rel) = 2^rel - 1\n');
// ---------------------------------------------------------------------------
check('gain(0) = 0', gain(0), 0);
check('gain(1) = 1', gain(1), 1);
check('gain(2) = 3', gain(2), 3);
check('gain(3) = 7', gain(3), 7);

// ---------------------------------------------------------------------------
process.stdout.write('\nDCG@10 = SUM (2^rel_i - 1) / log2(i+1)\n');
// ---------------------------------------------------------------------------

// Nothing came back.
check('DCG of an empty list = 0', dcg([]), 0);

// One rel-3 hit at rank 1. gain 7, discount log2(2) = 1.  DCG = 7.
check('DCG [3] = 7 exactly', dcg([3]), 7);

// One rel-3 hit at rank 3. gain 7, discount log2(4) = 2.  DCG = 7/2 = 3.5.
check('DCG [0,0,3] = 3.5 exactly', dcg([0, 0, 3]), 3.5);

// rel 3 then rel 2:  7/log2(2) + 3/log2(3)
//                  = 7/1       + 3 x 0.630929753571457
//                  = 7         + 1.892789260714371
//                  = 8.892789260714371
check('DCG [3,2] = 8.892789260714371', dcg([3, 2]), 8.892789260714371, EPS);

// rel 2 then rel 3:  3/1 + 7 x 0.630929753571457
//                  = 3   + 4.416508275000199
//                  = 7.416508275000199
check('DCG [2,3] = 7.416508275000199', dcg([2, 3]), 7.416508275000199, EPS);

// A rel-1 hit sitting at rank 10 — the last rank inside the cutoff.
// gain 1, discount log2(11) = 3.4594316186372973 -> 0.28906482631788785
check(
  'DCG of a rel-1 hit at rank 10 = 1/log2(11) = 0.28906482631788785',
  dcg([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
  0.28906482631788785,
  EPS,
);

// Rank 11 is outside K, so it contributes nothing at all.
check('DCG@10 ignores rank 11', dcg([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]), 0);

// ---------------------------------------------------------------------------
process.stdout.write('\nnDCG@10 = DCG@10(returned) / DCG@10(ideal from this query\'s own grades)\n');
// ---------------------------------------------------------------------------

// Perfect ordering: DCG and IDCG are the same list, so the ratio is exactly 1.
check('perfect ranking [3,2] against {3,2} = 1', ndcg([3, 2], [3, 2]), 1);

// One judged tool, returned first. 7/7 = 1.
check('single rel-3 at rank 1 = 1', ndcg([3], [3]), 1);

// One judged tool at rank 3. DCG = 7/log2(4) = 3.5, IDCG = 7.  3.5/7 = 0.5.
check('single rel-3 at rank 3 = 0.5 exactly', ndcg([0, 0, 3], [3]), 0.5);

// Swapped ordering: the rel-2 tool put above the rel-3 tool.
//   nDCG = 7.416508275000199 / 8.892789260714371
//   8.892789260714371 x 0.834 = 7.416586243435785, which overshoots by
//   0.000077968435586; divided by 8.892789260714371 that is 0.0000087676
//   -> 0.834 - 0.0000087676 = 0.8339912324
check(
  'swapped [2,3] against {3,2} = 0.8339912324',
  ndcg([2, 3], [3, 2]),
  0.8339912324,
  1e-9,
);

// Nothing relevant came back at all.
check('no relevant results = 0', ndcg([0, 0, 0], [3, 2]), 0);
check('empty result list = 0', ndcg([], [3, 2]), 0);

// The relevant tool exists but landed at rank 11, outside the cutoff.
check('relevant tool below the cutoff = 0', ndcg([...Array(10).fill(0), 3], [3]), 0);

// A query with no judgements has IDCG 0. There is no ratio; we return 0 and
// the harness flags the query rather than pretending the search failed.
check('no judgements at all = 0 (flagged, not scored)', ndcg([3, 2], []), 0);

// The ideal is capped at K too. 12 judged rel-3 tools, but only the best 10
// can fit in the top 10, so a perfect top-10 still scores exactly 1.
{
  const judged = Array(12).fill(3);
  const returned = Array(10).fill(3);
  check('ideal DCG is also capped at K (12 judged, perfect top-10) = 1', ndcg(returned, judged), 1);
}

// Ideal is built from this query's own grades, not from an assumed all-3s.
// Returned [1] against judged {1}: DCG = 1, IDCG = 1 -> 1, not 1/7.
check('ideal uses the query\'s own grades, not a hardcoded max', ndcg([1], [1]), 1);

// Mixed, fully worked:
//   returned grades [1, 3, 0, 2]
//   DCG  = 1/log2(2) + 7/log2(3) + 0/log2(4) + 3/log2(5)
//        = 1 + 7 x 0.630929753571457 + 0 + 3 x 0.430676558073393
//        = 1 + 4.416508275000199 + 0 + 1.292029674220179
//        = 6.708537949220378
//   ideal grades sorted [3, 2, 1]
//   IDCG = 7/log2(2) + 3/log2(3) + 1/log2(4)
//        = 7 + 1.892789260714371 + 0.5
//        = 9.392789260714371
//   nDCG = 6.708537949220378 / 9.392789260714371
//        9.392789260714371 x 0.714 = 6.706451532150061
//        remainder 0.002086417070317 / 9.392789260714371 = 0.00022213
//        -> 0.7142221297
check('mixed [1,3,0,2] against {3,2,1} = 0.7142221297', ndcg([1, 3, 0, 2], [3, 2, 1]), 0.7142221297, 1e-9);

// ---------------------------------------------------------------------------
process.stdout.write('\nrecall@10 = |relevant in top 10| / |relevant|\n');
// ---------------------------------------------------------------------------
const three = { splitwise: 3, tricount: 2, settleup: 1 };
check('all three found = 1', recall(['splitwise', 'tricount', 'settleup'], three), 1);
check('two of three found = 2/3', recall(['splitwise', 'zzz', 'settleup'], three), 2 / 3, EPS);
check('none found = 0', recall(['aaa', 'bbb'], three), 0);
check('recall ignores grade, only presence', recall(['settleup'], three), 1 / 3, EPS);
check(
  'a hit at rank 11 does not count toward recall@10',
  recall([...Array(10).fill('filler'), 'splitwise'], { splitwise: 3 }),
  0,
);
check(
  'a hit at rank 10 does count',
  recall([...Array(9).fill('filler'), 'splitwise'], { splitwise: 3 }),
  1,
);
check('no judgements = 0', recall(['anything'], {}), 0);
check('K is 10', K, 10);

// ---------------------------------------------------------------------------
process.stdout.write('\nmean and p95 (nearest rank, no interpolation)\n');
// ---------------------------------------------------------------------------
check('mean of empty = 0', mean([]), 0);
check('mean [1,2,3,4] = 2.5', mean([1, 2, 3, 4]), 2.5);
// 100 values 1..100: ceil(0.95 * 100) = 95 -> the 95th smallest, which is 95.
check('p95 of 1..100 = 95', percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
// 20 values 1..20: ceil(0.95 * 20) = 19 -> 19.
check('p95 of 1..20 = 19', percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95), 19);
// A single value is its own p95.
check('p95 of [7] = 7', percentile([7], 95), 7);
check('p95 is order-independent', percentile([9, 1, 5, 3, 7], 95), 9);

// ---------------------------------------------------------------------------
process.stdout.write('\nconstraint checking — the hard failure\n');
// ---------------------------------------------------------------------------
//
// Every fact row carries `status`, because "is this row even published?" is
// checked on every returned tool independently of the query's constraints.
const facts = new Map([
  ['splitwise', { status: 'published', pricing: 'freemium', platforms: ['ios', 'android', 'web'], flags: ['no_ads'], languages: ['en', 'es'] }],
  ['expensify', { status: 'published', pricing: 'paid', platforms: ['ios', 'web'], flags: [], languages: ['en'] }],
  ['deskonly', { status: 'published', pricing: 'free', platforms: ['windows'], flags: [], languages: [] }],
  // Declares exactly one of the two flags a "offline and no ads" query wants.
  // This is the row that the old any-of flags test could not see.
  ['halfflags', { status: 'published', pricing: 'free', platforms: ['web'], flags: ['works_offline'], languages: ['en'] }],
  ['bothflags', { status: 'published', pricing: 'free', platforms: ['web'], flags: ['works_offline', 'no_account_needed', 'no_ads'], languages: ['en'] }],
  // Stores its language code the way a careless import would.
  ['shoutylang', { status: 'published', pricing: 'free', platforms: ['web'], flags: [], languages: ['EN'] }],
  // Never published. Must never appear in a result, constraints or not.
  ['draftling', { status: 'draft', pricing: 'free', platforms: ['web'], flags: [], languages: ['en'] }],
  ['deprecatling', { status: 'deprecated', pricing: 'free', platforms: ['web'], flags: [], languages: ['en'] }],
]);
const row = (rank, slug) => ({ rank, slug, pricing: facts.get(slug).pricing });

checkDeep(
  'no constraints, no violations',
  checkConstraints({ id: 'q1' }, [row(1, 'expensify')], facts).length,
  0,
);
check(
  'a paid tool for a free query is one violation',
  checkConstraints(
    { id: 'q1', constraints: { pricing: ['free', 'freemium', 'open_source'] } },
    [row(1, 'splitwise'), row(2, 'expensify')],
    facts,
  ).length,
  1,
);
check(
  'a violation at rank 17 still counts — a filter is a WHERE clause',
  checkConstraints(
    { id: 'q1', constraints: { pricing: ['free'] } },
    [row(17, 'expensify')],
    facts,
  ).length,
  1,
);
check(
  'platform constraint is any-of (overlap): ios+android matches an ios tool',
  checkConstraints(
    { id: 'q2', constraints: { platforms: ['ios', 'android'] } },
    [row(1, 'expensify')],
    facts,
  ).length,
  0,
);
check(
  'a windows-only tool violates an ios+android query',
  checkConstraints(
    { id: 'q2', constraints: { platforms: ['ios', 'android'] } },
    [row(1, 'deskonly')],
    facts,
  ).length,
  1,
);
check(
  'a tool declaring no languages cannot satisfy a language constraint',
  checkConstraints(
    { id: 'q3', constraints: { languages: ['es'] } },
    [row(1, 'deskonly')],
    facts,
  ).length,
  1,
);
check(
  'two broken constraints on one row are two violations',
  checkConstraints(
    { id: 'q4', constraints: { pricing: ['free'], platforms: ['ios'] } },
    [{ rank: 1, slug: 'deskonly', pricing: 'free' }],
    facts,
  ).length,
  1, // pricing free is fine; only the platform breaks
);
check(
  'search_tools reporting a pricing that disagrees with public.tools is a violation',
  checkConstraints({ id: 'q5' }, [{ rank: 1, slug: 'expensify', pricing: 'free' }], facts).length,
  1,
);
check(
  'a slug that is not in public.tools is a violation',
  checkConstraints({ id: 'q6' }, [{ rank: 1, slug: 'ghost', pricing: 'free' }], facts).length,
  1,
);

// ---------------------------------------------------------------------------
process.stdout.write('\n  ...one case per constraint kind, matched to the SQL it verifies\n');
// ---------------------------------------------------------------------------
//
// The harness is a second opinion on search_tools(). When the two drift, "0
// constraint violations" certifies less than it looks like and nothing says
// so. One assertion per key, written against the SQL predicate it mirrors.

// --- pricing: ANY-OF, membership.  t.pricing = any (v_pricing) -------------
check(
  'pricing: a matching value passes',
  checkConstraints({ id: 'p1', constraints: { pricing: ['free', 'freemium'] } }, [row(1, 'splitwise')], facts).length,
  0,
);
check(
  'pricing: any-of means one of the listed values is enough',
  checkConstraints({ id: 'p2', constraints: { pricing: ['paid', 'free'] } }, [row(1, 'deskonly')], facts).length,
  0, // deskonly is free, which is in the list
);
check(
  'pricing: a value outside the list is a violation',
  checkConstraints({ id: 'p3', constraints: { pricing: ['free'] } }, [row(1, 'expensify')], facts).length,
  1,
);

// --- platforms: ANY-OF, overlap.  t.platforms && v_platforms ---------------
check(
  'platforms: any-of, one shared platform is enough',
  checkConstraints({ id: 'pl1', constraints: { platforms: ['android', 'linux', 'web'] } }, [row(1, 'expensify')], facts).length,
  0,
);
check(
  'platforms: NOT all-of — a query naming three platforms does not require all three',
  checkConstraints({ id: 'pl2', constraints: { platforms: ['ios', 'android', 'web'] } }, [row(1, 'expensify')], facts).length,
  0, // expensify has ios+web and not android; overlap is satisfied
);
check(
  'platforms: no shared platform is a violation',
  checkConstraints({ id: 'pl3', constraints: { platforms: ['ios', 'android'] } }, [row(1, 'deskonly')], facts).length,
  1,
);

// --- flags: ALL-OF, containment.  t.flags @> v_flags -----------------------
//
// THE case the self-test used to miss entirely, because it never passed flags
// to checkConstraints at all. "offline and no ads" states two requirements.
check(
  'flags: all-of — declaring only one of two required flags IS a violation',
  checkConstraints(
    { id: 'f1', constraints: { flags: ['works_offline', 'no_account_needed'] } },
    [row(1, 'halfflags')],
    facts,
  ).length,
  1,
);
check(
  'flags: all-of — declaring both required flags passes',
  checkConstraints(
    { id: 'f2', constraints: { flags: ['works_offline', 'no_account_needed'] } },
    [row(1, 'bothflags')],
    facts,
  ).length,
  0,
);
check(
  'flags: a superset of the requirements still passes (@> is containment, not equality)',
  checkConstraints({ id: 'f3', constraints: { flags: ['no_ads'] } }, [row(1, 'bothflags')], facts).length,
  0,
);
check(
  'flags: a single required flag the tool lacks is a violation',
  checkConstraints({ id: 'f4', constraints: { flags: ['no_ads'] } }, [row(1, 'halfflags')], facts).length,
  1,
);
check(
  'flags: a tool declaring no flags cannot satisfy any requirement',
  checkConstraints({ id: 'f5', constraints: { flags: ['no_ads'] } }, [row(1, 'deskonly')], facts).length,
  1,
);
check(
  'flags: the violation names the flags that are missing, not just the key',
  /no_account_needed/.test(
    checkConstraints(
      { id: 'f6', constraints: { flags: ['works_offline', 'no_account_needed'] } },
      [row(1, 'halfflags')],
      facts,
    )[0].detail,
  ),
  true,
);

// --- languages: ANY-OF, overlap, wanted side lower-cased -------------------
//
// search_tools does `lower(btrim(x))` to every element of p_languages before
// comparing. A golden entry written ["EN"] is therefore a match, and used to
// produce a screenful of false violations here.
check(
  'languages: a mixed-case request matches a lower-case catalogue (the SQL lower-cases p_languages)',
  checkConstraints({ id: 'l1', constraints: { languages: ['EN'] } }, [row(1, 'expensify')], facts).length,
  0,
);
check(
  'languages: mixed case, mixed list, still matches',
  checkConstraints({ id: 'l2', constraints: { languages: ['De', 'ES'] } }, [row(1, 'splitwise')], facts).length,
  0,
);
check(
  'languages: surrounding whitespace is trimmed, as btrim() does in the SQL',
  checkConstraints({ id: 'l3', constraints: { languages: [' en '] } }, [row(1, 'expensify')], facts).length,
  0,
);
check(
  'languages: a language the tool does not declare is still a violation',
  checkConstraints({ id: 'l4', constraints: { languages: ['DE'] } }, [row(1, 'expensify')], facts).length,
  1,
);
check(
  'languages: only the WANTED side is folded — a catalogue row storing "EN" is reported, not excused',
  checkConstraints({ id: 'l5', constraints: { languages: ['en'] } }, [row(1, 'shoutylang')], facts).length,
  1,
);

// --- status: not a golden-set constraint, checked on every row -------------
check(
  'status: a draft tool in the results is a violation even with no constraints',
  checkConstraints({ id: 's1' }, [row(1, 'draftling')], facts).length,
  1,
);
check(
  'status: a deprecated tool is a violation too — published is the only acceptable status',
  checkConstraints({ id: 's2' }, [row(1, 'deprecatling')], facts).length,
  1,
);
check(
  'status: the violation is reported under the "status" key',
  checkConstraints({ id: 's3' }, [row(1, 'draftling')], facts)[0].key,
  'status',
);
check(
  'status: a published tool raises nothing',
  checkConstraints({ id: 's4' }, [row(1, 'splitwise')], facts).length,
  0,
);
check(
  'status: an unpublished row that ALSO breaks a constraint reports both',
  checkConstraints(
    { id: 's5', constraints: { pricing: ['paid'] } },
    [row(1, 'draftling')],
    facts,
  ).length,
  2,
);

// --- all four keys at once, on one row -------------------------------------
check(
  'every constraint kind together: a fully compliant row is clean',
  checkConstraints(
    {
      id: 'x1',
      constraints: {
        pricing: ['free'],
        platforms: ['web', 'ios'],
        flags: ['works_offline', 'no_ads'],
        languages: ['EN'],
      },
    },
    [row(1, 'bothflags')],
    facts,
  ).length,
  0,
);
check(
  'every constraint kind together: one row can break three of them at once',
  checkConstraints(
    {
      id: 'x2',
      constraints: {
        pricing: ['free'],          // expensify is paid           -> violation
        platforms: ['ios'],         // expensify has ios           -> ok
        flags: ['no_ads'],          // expensify declares none     -> violation
        languages: ['de'],          // expensify declares en only  -> violation
      },
    },
    [row(1, 'expensify')],
    facts,
  ).length,
  3,
);

check('isConstrained: absent', isConstrained({ id: 'a' }), false);
check('isConstrained: empty object', isConstrained({ id: 'a', constraints: {} }), false);
check('isConstrained: empty array', isConstrained({ id: 'a', constraints: { pricing: [] } }), false);
check('isConstrained: real', isConstrained({ id: 'a', constraints: { pricing: ['free'] } }), true);

// ---------------------------------------------------------------------------
process.stdout.write('\naggregate\n');
// ---------------------------------------------------------------------------
{
  const agg = aggregate([
    { ndcg: 1, recall: 1, latencyMs: 10, resultCount: 3 },
    { ndcg: 0, recall: 0, latencyMs: 30, resultCount: 0 },
    { ndcg: 0.5, recall: 0.5, latencyMs: 20, resultCount: 5 },
  ]);
  check('aggregate: nDCG is the unweighted mean', agg.ndcgAt10, 0.5, EPS);
  check('aggregate: recall is the unweighted mean', agg.recallAt10, 0.5, EPS);
  check('aggregate: mean latency', agg.meanLatencyMs, 20, EPS);
  check('aggregate: p95 latency (ceil(0.95*3)=3 -> largest)', agg.p95LatencyMs, 30);
  check('aggregate: zero-result count', agg.zeroResultQueries, 1);
  check('aggregate: query count', agg.queries, 3);
}

// ---------------------------------------------------------------------------
process.stdout.write('\ngolden.jsonl parsing\n');
// ---------------------------------------------------------------------------
{
  const good = [
    '{"id":"q001","query":"free app to split expenses","lang":"en","note":"why","constraints":{"pricing":["free","freemium"]},"relevant":{"splitwise":3,"tricount":2}}',
    '',
    '# a comment line',
    '{"id":"q002","query":"app para dividir gastos","lang":"es","relevant":{"tricount":3}}',
  ].join('\n');
  const { queries, errors } = parseGolden(good);
  check('parses two queries', queries.length, 2);
  check('no errors', errors.length, 0);
  check('lang defaults are respected', queries[1].lang, 'es');
  checkDeep('constraints survive', queries[0].constraints, { pricing: ['free', 'freemium'] });
  check('missing constraints become an empty object', Object.keys(queries[1].constraints).length, 0);
  check('line numbers are kept for error reporting', queries[1].line, 4);
}
{
  const bad = [
    '{"id":"q001","query":"a","relevant":{"x":3}}',
    '{"id":"q001","query":"duplicate id","relevant":{"x":3}}',
    '{"query":"no id","relevant":{}}',
    '{"id":"q003","relevant":{}}',
    '{"id":"q004","query":"bad grade","relevant":{"x":5}}',
    '{"id":"q005","query":"bad constraint","constraints":{"colour":["red"]},"relevant":{"x":1}}',
    'not json at all',
  ].join('\n');
  const { queries, errors } = parseGolden(bad);
  // Only q001 is clean. Every other line has something wrong with it, and an
  // entry with any problem is dropped rather than half-loaded.
  check('only the valid line survives', queries.length, 1);
  check('the surviving one is q001', queries[0].id, 'q001');
  check('every problem is reported', errors.length, 6);
  check('errors carry line numbers', /line 2/.test(errors.join('\n')), true);
}
{
  // An empty constraint array must not become '{}' in SQL, where it would
  // match nothing and silently zero the query.
  const { queries } = parseGolden('{"id":"q1","query":"x","constraints":{"pricing":[]},"relevant":{"a":1}}');
  check('empty constraint array is dropped, not passed through', Object.keys(queries[0].constraints).length, 0);
  check('...and the query is therefore unconstrained', isConstrained(queries[0]), false);
}

// ---------------------------------------------------------------------------
process.stdout.write('\nbaselines.md parsing and the regression gate\n');
// ---------------------------------------------------------------------------
{
  const md = [
    '| Date | Commit | Phase | Queries | recall@10 | nDCG@10 | Mean ms | p95 ms | Zero-result | What changed |',
    '| ---- | ------ | ----- | ------- | --------- | ------- | ------- | ------ | ----------- | ------------ |',
    '| 2026-09-10 | abc1234 | 2 | 60 | 0.6100 | 0.5400 | 12.0 | 30.0 | 3 | first recorded |',
    '| 2026-10-01 | def5678 | 3 | 60 | 0.7200 | 0.6600 | 40.0 | 90.0 | 1 | hybrid retrieval |',
    '|  |  | 4 |  |  |  |  |  |  |  |',
    '',
    '| Date | Phase | Slice | Queries | recall@10 | nDCG@10 |',
    '| ---- | ----- | ----- | ------- | --------- | ------- |',
    '| 2026-10-01 | 3 | non-english | 12 | 0.90 | 0.99 |',
  ].join('\n');
  const rows = parseBaselines(md);
  check('two recorded rows, template row skipped', rows.length, 2);
  check('newest is last', rows[rows.length - 1].phase, '3');
  check('nDCG read by column name', rows[1].ndcgAt10, 0.66);
  check('the per-slice table is ignored entirely', rows.some((r) => r.ndcgAt10 === 0.99), false);

  const latest = rows[rows.length - 1];
  check('an improvement passes', checkRegression(0.70, latest).regressed, false);
  check('an identical score passes', checkRegression(0.66, latest).regressed, false);
  check('a drop inside tolerance passes', checkRegression(0.6570, latest, 0.005).regressed, false);
  check('a drop exactly at tolerance passes', checkRegression(0.655, latest, 0.005).regressed, false);
  check('a drop past tolerance fails', checkRegression(0.6540, latest, 0.005).regressed, true);
  check('the delta is reported signed', checkRegression(0.60, latest).delta, -0.06, 1e-9);
}
{
  check('a file with only template rows yields no baseline', parseBaselines(
    ['| Date | Commit | Phase | Queries | recall@10 | nDCG@10 |',
      '| - | - | - | - | - | - |',
      '|  |  | 2 |  |  |  |'].join('\n'),
  ).length, 0);
}

// ---------------------------------------------------------------------------
process.stdout.write('\nthe gate compares like with like\n');
// ---------------------------------------------------------------------------
{
  // A text-only run and a hybrid run are measurements of two DIFFERENT
  // searches. Gating one against the other turns "this machine has no
  // EMBEDDINGS_API_KEY" into "the search got worse", which is a build failing
  // for a reason nobody changed.
  const md = [
    '| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 |',
    '| - | - | - | - | - | - | - |',
    '| 2026-09-10 | aaa1111 | 2 | no | 60 | 0.4497 | 0.4878 |',
    '| 2026-09-11 | bbb2222 | 3 | yes | 60 | 0.6747 | 0.7019 |',
  ].join('\n');
  const rows = parseBaselines(md);

  check('the Vectors column is read', rows[1].vectors, 'yes');
  check('a run with vectors is gated on the hybrid row',
    pickBaseline(rows, true).row.commit, 'bbb2222');
  check('a run without them is gated on the text-only row',
    pickBaseline(rows, false).row.commit, 'aaa1111');
  check('and both are exact matches rather than a fallback',
    pickBaseline(rows, false).sameMode, true);

  // The real point: a keyless run scores about what Phase 2 scored, and that
  // must pass rather than read as a 0.21 collapse.
  check('a keyless run passes against the text-only row',
    checkRegression(0.4878, pickBaseline(rows, false).row).regressed, false);
  check('and would have FAILED against the hybrid one',
    checkRegression(0.4878, pickBaseline(rows, true).row).regressed, true);

  // A full-text regression is still caught in either mode, which is what keeps
  // the gate worth having on a machine with no key.
  check('a text-only regression still fails',
    checkRegression(0.4000, pickBaseline(rows, false).row).regressed, true);
}
{
  // A row the file itself calls WITHDRAWN is not a baseline, whatever numbers
  // are in it. eval/baselines.md keeps one — deleting it would hide what
  // happened — and the gate must not adopt it.
  const rows = parseBaselines([
    '| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 | What changed |',
    '| - | - | - | - | - | - | - | - |',
    '| 2026-09-10 | aaa1111 | 2 | no | 60 | 0.4497 | 0.4878 | first trustworthy |',
    '| 2026-09-12 | ccc3333 | 3 | yes | 60 | 0.9000 | 0.9500 | **WITHDRAWN** measured wrong |',
  ].join('\n'));
  check('a withdrawn row is not a recorded baseline', rows.length, 1);
  check('and the gate does not adopt its number', rows[0].commit, 'aaa1111');
  check('a withdrawn hybrid row leaves no hybrid row to match',
    pickBaseline(rows, true).sameMode, false);
}
{
  // baselines.md written before the column existed: fall back to the newest
  // row and say so, rather than silently switching the gate off.
  const rows = parseBaselines([
    '| Date | Commit | Phase | Queries | recall@10 | nDCG@10 |',
    '| - | - | - | - | - | - |',
    '| 2026-09-10 | aaa1111 | 2 | 60 | 0.4497 | 0.4878 |',
  ].join('\n'));
  check('no Vectors column means no row is in either mode', rows[0].vectors, '');
  check('so the gate falls back to the newest row', pickBaseline(rows, true).row.commit, 'aaa1111');
  check('and says it is not comparing like with like', pickBaseline(rows, true).sameMode, false);
  check('an empty table has nothing to pick', pickBaseline([], true), null);
}

// ---------------------------------------------------------------------------
process.stdout.write('\nthe negatives: sentences whose right answer is an empty page\n');
// ---------------------------------------------------------------------------
{
  const text = [
    '# a comment',
    '{"id":"n01","kind":"far","lang":"en","query":"my car grinds when I brake","note":"car repair"}',
    '{"id":"n02","kind":"near","query":"translate my cat","constraints":{"pricing":["free"]}}',
    '{"id":"n03","query":"no kind given","relevant":{}}',
    '',
  ].join('\n');
  const { queries, errors } = parseNegatives(text);
  check('three negatives parsed, the comment skipped', queries.length, 3);
  check('no errors in a clean file', errors.length, 0);
  check('kind is read', queries[1].kind, 'near');
  check('kind defaults to far', queries[2].kind, 'far');
  check('an empty relevant map is allowed', queries[2].id, 'n03');
  checkDeep('constraints are carried like the golden set', queries[1].constraints, { pricing: ['free'] });
  checkDeep('and a negative never has judgements', queries[0].relevant, {});
}
{
  // A sentence with a right tool is a golden query. The negatives file must
  // never become a side door into the golden set.
  const refused = parseNegatives('{"id":"n09","query":"split a bill","relevant":{"splitwise":3}}');
  check('a negative carrying judgements is refused', refused.queries.length, 0);
  check('with an error that says where it belongs', /golden/.test(refused.errors[0] ?? ''), true);
  check('an unknown kind is refused',
    parseNegatives('{"id":"n1","query":"x","kind":"medium"}').errors.length, 1);
  check('a duplicate id is refused',
    parseNegatives('{"id":"n1","query":"x"}\n{"id":"n1","query":"y"}').errors.length, 1);
  check('an unknown constraint is refused',
    parseNegatives('{"id":"n1","query":"x","constraints":{"colour":["red"]}}').errors.length, 1);
}
{
  const mk = (id, kind, n) => ({
    query: { id, kind, lang: 'en', query: `${id} sentence` },
    results: Array.from({ length: n }, (_, i) => ({ rank: i + 1, slug: `tool-${i}`, matchSource: 'vector' })),
    latencyMs: 10,
  });
  const agg = aggregateNegatives([mk('n1', 'far', 0), mk('n2', 'far', 0), mk('n3', 'near', 3), mk('n4', 'near', 0)]);
  check('four negatives', agg.queries, 4);
  check('three came back empty', agg.empty, 3);
  check('empty rate is 3/4', agg.emptyRate, 0.75, EPS);
  // (0 + 0 + 3 + 0) / 4 = 0.75 rows leaked per negative.
  check('mean leaked is averaged over ALL negatives, not the leaky ones', agg.meanLeaked, 0.75, EPS);
  check('max leaked', agg.maxLeaked, 3);
  check('far: both empty', agg.byKind.far.empty, 2);
  check('near: one of two empty', agg.byKind.near.empty, 1);
  check('no negatives is a rate of 0, not NaN', aggregateNegatives([]).emptyRate, 0);

  const report = buildNegativesReport({ overall: agg, perQuery: [mk('n3', 'near', 3)], golden: { ndcgAt10: 0.7, recallAt10: 0.6, zeroResultQueries: 0, queries: 60 } });
  check('the report lists what leaked', report.includes('n3') && report.includes('tool-0'), true);
  check('the report puts the golden numbers beside it', report.includes('nDCG@10 0.7000'), true);
  check('the negatives report carries no ANSI escapes', hasControlCodes(report), false);
}
{
  checkDeep('"26 of 30" is a count and a total', parseCountOf('26 of 30'), { count: 26, total: 30 });
  checkDeep('"0 of 60" is zero of sixty', parseCountOf('0 of 60'), { count: 0, total: 60 });
  checkDeep('a bare number has no total', parseCountOf('4'), { count: 4, total: null });
  check('a blank cell is nothing, not zero', parseCountOf(''), null);
  check('a dash is nothing, not zero', parseCountOf('-'), null);
}
{
  const rows = parseBaselines([
    '| Date | Commit | Phase | Vectors | Queries | recall@10 | nDCG@10 | Zero-result | Negatives empty | What changed |',
    '| - | - | - | - | - | - | - | - | - | - |',
    '| 2026-09-10 | aaa1111 | 2 | no | 60 | 0.4497 | 0.4878 | 4 of 60 | | text only |',
    '| 2026-09-11 | bbb2222 | 3 | yes | 60 | 0.6719 | 0.7035 | 0 of 60 | 26 of 30 | the floor |',
  ].join('\n'));
  check('the Zero-result column is read', rows[1].zeroResult.count, 0);
  check('the Negatives empty column is read', rows[1].negativesEmpty.count, 26);
  check('a row that did not record negatives has none', rows[0].negativesEmpty, null);

  const floor = rows[1];
  check('no new empty golden query passes', checkZeroResultRegression(0, floor).regressed, false);
  check('one new empty golden query fails', checkZeroResultRegression(1, floor).regressed, true);
  check('the text-only row allows its own four', checkZeroResultRegression(4, rows[0]).regressed, false);
  check('a row with no Zero-result column gates nothing', checkZeroResultRegression(9, { zeroResult: null }), null);

  check('the same share of negatives empty passes',
    checkNegativesRegression({ empty: 26, queries: 30 }, floor).regressed, false);
  check('more negatives empty passes',
    checkNegativesRegression({ empty: 29, queries: 30 }, floor).regressed, false);
  check('one fewer negative empty fails',
    checkNegativesRegression({ empty: 25, queries: 30 }, floor).regressed, true);
  // A floor of zero: every negative answered with twenty tools. The broken
  // floor this gate exists to catch.
  check('a floor of zero fails the gate',
    checkNegativesRegression({ empty: 0, queries: 30 }, floor).regressed, true);
  // A rate, so a larger negatives file is judged on its share, not its count:
  // 35 of 40 (87.5%) is better than 26 of 30 (86.7%).
  check('a rate, not a count: 35 of 40 passes against 26 of 30',
    checkNegativesRegression({ empty: 35, queries: 40 }, floor).regressed, false);
  const missing = checkNegativesRegression(null, floor);
  check('negatives not run against a row that gates them FAILS', missing.regressed, true);
  check('and says they were not run', missing.missing, true);
  check('a row that records no negatives gates nothing', checkNegativesRegression({ empty: 0, queries: 30 }, rows[0]), null);
}

// ---------------------------------------------------------------------------
process.stdout.write('\ntable rendering stays paste-safe\n');
// ---------------------------------------------------------------------------
{
  const table = renderTable(['metric', 'value'], [['nDCG@10', '0.5400'], ['p95 ms', '31.2']], ['l', 'r']);
  check('no ANSI escapes in the output', hasControlCodes(table), false);
  // Column 0 is 7 wide ('nDCG@10'), column 1 is 6 ('0.5400'), separator is two
  // spaces, and column 1 is right-aligned: 'metric ' + '  ' + ' value'.
  check('columns are aligned with spaces', table.split('\n')[0], 'metric    value');
  check('there is a rule under the header', table.split('\n')[1], '-------  ------');
}

// ---------------------------------------------------------------------------
process.stdout.write('\nthe report renders offline (this path normally needs a database)\n');
// ---------------------------------------------------------------------------
{
  // A synthetic run: one perfect English query, one non-English miss, one
  // constrained query whose results are fine, and one that returned nothing.
  const mk = (id, lang, constraints, relevant, slugs, latencyMs) => {
    const results = slugs.map((slug, i) => ({ rank: i + 1, slug, pricing: 'free', score: 1 - i / 10, matchSource: 'fts' }));
    const grades = slugs.map((s) => relevant[s] ?? 0);
    const query = { id, query: `${id} sample query text`, lang, note: 'a reason', constraints, relevant, line: 1 };
    return {
      query,
      results,
      latencyMs,
      resultCount: results.length,
      ndcg: ndcg(grades, Object.values(relevant)),
      recall: recall(slugs, relevant),
      judgedCount: Object.keys(relevant).length,
      constrained: isConstrained(query),
      violations: [],
    };
  };
  const perQuery = [
    mk('q001', 'en', {}, { splitwise: 3 }, ['splitwise', 'tricount'], 11.2),
    mk('q002', 'es', {}, { tricount: 3 }, ['unrelated'], 24.9),
    mk('q003', 'en', { pricing: ['free'] }, { deskonly: 2 }, ['deskonly'], 8.4),
    mk('q004', 'de', {}, { ghost: 3 }, [], 41.0),
  ];
  const overall = aggregate(perQuery);
  const slices = buildSlices(perQuery);
  const worst = [...perQuery].sort((a, b) => a.ndcg - b.ndcg).slice(0, 5);
  const report = buildReport({
    overall, slices, worst, perQuery, unjudged: [],
    opts: { golden: 'eval/golden.jsonl', limit: 20 },
    startedAt: new Date('2026-09-10T00:00:00.000Z'),
  });

  check('report renders without throwing', typeof report, 'string');
  check('report has an Overall section', report.includes('--- Overall'), true);
  check('report has a Slices section', report.includes('--- Slices'), true);
  check('report lists non-english as its own slice', report.includes('non-english'), true);
  check('report shows the five-worst section', report.includes('Five worst queries'), true);
  check('report names the query that returned nothing', report.includes('(nothing)'), true);
  check('report says where a wanted tool actually landed', report.includes('MISSING'), true);
  check('report carries no ANSI escapes', hasControlCodes(report), false);
  check('report carries no carriage returns', report.includes('\r'), false);
  check(
    'zero-result count is reported',
    report.includes('zero-result queries'),
    true,
  );

  const vr = buildViolationReport([
    { queryId: 'q003', rank: 2, slug: 'expensify', key: 'pricing', wanted: ['free'], got: 'paid' },
  ]);
  check('violation report renders', vr.includes('CONSTRAINT VIOLATIONS'), true);
  check('violation report names the offending slug', vr.includes('expensify'), true);
  check('violation report explains the rule', vr.includes('never a'), true);
  check('violation report carries no ANSI escapes', hasControlCodes(vr), false);
}

// ---------------------------------------------------------------------------
process.stdout.write(
  `\n${passed} passed, ${failures.length} failed\n`,
);
if (failures.length > 0) {
  process.stdout.write(`FAILED: ${failures.join('; ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Scoring arithmetic verified against hand-worked cases.\n');
}
