// ===========================================================================
// The five screens' data layer.
//
// Every screen is one round trip, and that is the promise that breaks
// silently: a second query added to hydrate a list still returns the right
// answer, just N+1 times slower, and no screenshot shows it. So each of these
// counts the statements rather than checking the output.
//
// Run by `npm test` via `node --test tests/`. Node strips the types from the
// TypeScript modules it imports; there is no build step and no test framework.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runSearchDetailed,
  runHome,
  runBrowse,
  runTop,
  runToolPage,
  searchDetailedParams,
  SEARCH_DETAILED_SQL,
  HOME_SQL,
  BROWSE_SQL,
  TOP_SQL,
  TOOL_SQL,
  CATEGORY_WINDOW,
  QueryTooLongError,
  MAX_QUERY_LENGTH,
  SQLSTATE_QUERY_TOO_LONG,
} from '../lib/sql.ts';
import { resultsView, matchBand, matchedProblemOf, clarifier } from '../lib/results.ts';

/** A stand-in for `pg.Pool` that records every statement it is handed. */
function fakeExecutor(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows };
    },
  };
}

const DETAIL_ROW = {
  // Every row of SEARCH_DETAILED_SQL carries the flag, because the flag is the
  // one row the statement is anchored on.
  embedding_missing: false,
  tool_id: '11',
  slug: 'splitwise',
  name: 'Splitwise',
  summary: 'Tracks shared expenses in a group.',
  pricing: 'freemium',
  score: 0.036,
  match_source: 'both',
  url: 'https://www.splitwise.com',
  platforms: ['web', 'ios', 'android'],
  languages: ['en'],
  flags: ['has_free_tier'],
  rating_avg: '5.00',
  rating_count: 1,
  like_count: 3,
  save_count: 1,
  category_slug: 'money',
  category_name: 'Money',
  matched_problem: 'Six of us went away and now there are twenty small debts flying about',
  matched_strength: 0.05,
};

const HOME_ROW = {
  top_tools: [
    {
      slug: 'splitwise',
      name: 'Splitwise',
      summary: 'Tracks shared expenses.',
      pricing: 'freemium',
      like_count: 3,
      save_count: 1,
      open_count: 0,
      rating_avg: '5.00',
      rating_count: 1,
      category_slug: 'money',
      category_name: 'Money',
    },
  ],
  found: [
    {
      statement: 'Six of us went away and now there are twenty small debts flying about',
      slug: 'splitwise',
      name: 'Splitwise',
      summary: 'Tracks shared expenses.',
      pricing: 'freemium',
      platforms: ['web'],
      like_count: 3,
      category_slug: 'money',
      category_name: 'Money',
    },
  ],
  tool_count: '223',
  problem_count: '504',
};

const TOOL_ROW = {
  tool: {
    slug: 'splitwise',
    name: 'Splitwise',
    url: 'https://www.splitwise.com',
    summary: 'Tracks shared expenses in a group.',
    pricing: 'freemium',
    platforms: ['web'],
    languages: ['en'],
    flags: ['has_free_tier'],
    claimable: true,
    made_by_owner: false,
    like_count: 3,
    save_count: 1,
    open_count: 0,
    review_count: 1,
    rating_avg: '5.00',
    rating_count: 1,
    created_at: '2026-09-10T14:34:09.078Z',
    updated_at: '2026-09-10T14:34:09.078Z',
    published_at: '2026-01-20T14:34:09.078Z',
  },
  categories: [{ slug: 'money', name: 'Money', is_primary: true }],
  problems: ['Six of us went away and now there are twenty small debts flying about'],
  reviews: [
    {
      id: 5,
      rating: 5,
      body: 'The default answer for this.',
      created_at: '2026-09-10T14:34:09.078Z',
      solved_problem: true,
      ease_of_use: 5,
      worth_the_price: null,
      handle: 'tomer',
      display_name: 'Tomer Ben-Ari',
    },
  ],
  histogram: { 5: 1 },
  aspects: { solved_pct: '100', ease: '5.0', worth: null, solved_count: 1 },
  alternatives: [
    {
      slug: 'tabsplit',
      name: 'Tabsplit',
      summary: 'Splits a shared bill unevenly.',
      pricing: 'free',
      rating_avg: '4.50',
      like_count: 2,
    },
  ],
  keeper: { handle: 'admin', display_name: 'Foundit' },
  has_keeper: true,
};

/* --- one round trip, per screen ----------------------------------------- */

test('the results screen is one round trip, however decorated the card is', async () => {
  const exec = fakeExecutor([DETAIL_ROW]);
  const { results, embeddingMissing } = await runSearchDetailed(
    exec,
    'split expenses with friends while travelling',
  );

  assert.equal(exec.calls.length, 1, 'a search must issue exactly one query');
  assert.equal(exec.calls[0].text, SEARCH_DETAILED_SQL);
  // The maker's address, the flags, the category and the matching problem
  // statement all came back on the same row rather than from a second look.
  assert.equal(results[0].url, 'https://www.splitwise.com');
  assert.equal(results[0].categoryName, 'Money');
  assert.equal(results[0].flags[0], 'has_free_tier');
  assert.ok(results[0].matchedProblem);
  // The vector was already cached, so this search is the whole of the page.
  assert.equal(embeddingMissing, false);
});

test('a cached query vector is one round trip; a missing one is reported, not fetched here', async () => {
  // The data layer never calls the embedding API. It reports that a vector is
  // missing and the screen decides what to do about it, which is what keeps
  // lib/embeddings.ts the only file in the codebase that opens a socket.
  const exec = fakeExecutor([{ ...DETAIL_ROW, embedding_missing: true }]);
  const { results, embeddingMissing } = await runSearchDetailed(exec, 'a sentence nobody typed yet');

  assert.equal(exec.calls.length, 1, 'still one statement — the flag rides along');
  assert.equal(embeddingMissing, true);
  assert.equal(results.length, 1, 'the text-only answer is a real answer');
  assert.equal(exec.calls[0].values[8], null, 'no vector was supplied, so the cache was consulted');
});

test('a search that matched nothing still says whether a vector is missing', async () => {
  // The zero-result case is the one the flag matters most in: a sentence that
  // shares no vocabulary with the catalogue is exactly what the vector leg
  // exists for. SEARCH_DETAILED_SQL is anchored on the flag's row for this.
  const exec = fakeExecutor([{ embedding_missing: true, tool_id: null }]);
  const { results, embeddingMissing } = await runSearchDetailed(exec, 'something nothing matches');

  assert.deepEqual(results, [], 'the flag row carries no tool, so it is not a result');
  assert.equal(embeddingMissing, true);
});

test('a supplied vector is an argument to the same one call', async () => {
  const exec = fakeExecutor([DETAIL_ROW]);
  await runSearchDetailed(exec, 'expense splitter', {}, 12, null, '[0.1,0.2]');

  assert.equal(exec.calls.length, 1, 'the second search is still one round trip');
  assert.equal(exec.calls[0].values[8], '[0.1,0.2]');
});

test('the homepage is one round trip for the strip, the cards and the totals', async () => {
  const exec = fakeExecutor([HOME_ROW]);
  const home = await runHome(exec);

  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].text, HOME_SQL);
  assert.equal(home.topTools.length, 1);
  assert.equal(home.found.length, 1);
  assert.equal(home.toolCount, 223);
  assert.equal(home.problemCount, 504);
});

test('browse is one round trip for the categories and the problems together', async () => {
  const exec = fakeExecutor([
    { categories: [{ slug: 'money', name: 'Money', sort_order: 1, tool_count: '14' }], problems: [], tool_count: '223', problem_count: '504', matched_count: '14' },
  ]);
  const browse = await runBrowse(exec, 'money');

  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].text, BROWSE_SQL);
  assert.deepEqual(exec.calls[0].values, ['money', 12]);
  assert.equal(browse.categories[0].toolCount, 14);
});

test('top is one round trip, and the ranking is an argument rather than a sort', async () => {
  const exec = fakeExecutor([
    { tools: [{ ...HOME_ROW.top_tools[0], rank: 1 }], categories: [], total: '223' },
  ]);
  const top = await runTop(exec, null, 'saves', 25);

  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].text, TOP_SQL);
  assert.deepEqual(exec.calls[0].values, [null, 'saves', 25]);
  assert.equal(top.tools[0].rank, 1);
});

test('a tool page is one round trip for eight sections', async () => {
  const exec = fakeExecutor([TOOL_ROW]);
  const tool = await runToolPage(exec, 'splitwise');

  assert.equal(exec.calls.length, 1, 'the whole page is one statement');
  assert.equal(exec.calls[0].text, TOOL_SQL);
  assert.equal(tool.name, 'Splitwise');
  assert.equal(tool.problems.length, 1);
  assert.equal(tool.reviews[0].displayName, 'Tomer Ben-Ari');
  assert.equal(tool.alternatives[0].slug, 'tabsplit');
  assert.equal(tool.histogram['5'], 1);
  assert.equal(tool.aspects.solvedPct, 100);
});

test('a slug nobody published is null, not an empty page', async () => {
  const exec = fakeExecutor([]);
  assert.equal(await runToolPage(exec, 'nothing-here'), null);
  assert.equal(exec.calls.length, 1);
});

/* --- the search's arguments --------------------------------------------- */

test('narrowing to a category widens the window rather than adding a query', async () => {
  const plain = searchDetailedParams('expenses', {}, 12, null);
  const narrowed = searchDetailedParams('expenses', {}, 12, 'money');

  assert.equal(plain[5], 12, 'with no category, ask search_tools for what is shown');
  assert.equal(plain[6], null);
  assert.equal(narrowed[5], CATEGORY_WINDOW, 'narrowing cuts a full ranked list, not a short one');
  assert.equal(narrowed[6], 'money');
  assert.equal(narrowed[7], 12);
  assert.equal(plain[8], null, 'no vector unless the caller has one');
  assert.equal(narrowed[8], null);
});

test('constraints are arguments to the one call, never a second one', async () => {
  const exec = fakeExecutor([DETAIL_ROW]);
  await runSearchDetailed(
    exec,
    'expense splitter',
    { pricing: ['free'], flags: ['works_offline'], languages: ['es'], platforms: ['ios'] },
    12,
  );

  assert.equal(exec.calls.length, 1);
  const [, pricing, platforms, flags, languages] = exec.calls[0].values;
  assert.deepEqual(pricing, ['free']);
  assert.deepEqual(platforms, ['ios']);
  assert.deepEqual(flags, ['works_offline']);
  assert.deepEqual(languages, ['es']);
});

test('an over-long query is refused before the round trip, and after it', async () => {
  const exec = fakeExecutor([]);
  await assert.rejects(
    () => runSearchDetailed(exec, 'x'.repeat(MAX_QUERY_LENGTH + 1)),
    QueryTooLongError,
  );
  assert.equal(exec.calls.length, 0, 'nothing is sent');

  const angry = {
    async query() {
      const err = new Error('too long');
      err.code = SQLSTATE_QUERY_TOO_LONG;
      throw err;
    },
  };
  await assert.rejects(() => runSearchDetailed(angry, 'short enough'), QueryTooLongError);
});

/* --- what the screen decides before it draws ---------------------------- */

test('a search that returns nothing renders the empty state, not a blank page', () => {
  assert.equal(resultsView({ query: 'icelandic offline splitter', tooLong: false, resultCount: 0 }), 'empty');
  assert.equal(resultsView({ query: 'split a bill', tooLong: false, resultCount: 3 }), 'results');
  assert.equal(resultsView({ query: 'x'.repeat(300), tooLong: true, resultCount: 0 }), 'too-long');
  assert.equal(resultsView({ query: '   ', tooLong: false, resultCount: 0 }), 'prompt');
});

test('the match band is a fact about where it matched, never a rescaled score', () => {
  assert.equal(matchBand('both').tone, 'both');
  assert.equal(matchBand('problem').tone, 'one');
  assert.equal(matchBand('tool').tone, 'one');
  assert.equal(matchBand('name').tone, 'name');
  // Nothing the person typed appears in the listing at all: the quietest tone
  // there is, and a different claim from a name that merely looks similar.
  assert.equal(matchBand('vector').tone, 'name');
  // No sentence was typed, so there is nothing to claim about relevance.
  assert.equal(matchBand('browse'), null);

  for (const source of ['both', 'problem', 'tool', 'name', 'vector']) {
    const band = matchBand(source);
    assert.ok(!/\d/.test(band.label), `"${band.label}" must not carry a number`);
    assert.ok(!band.label.includes('%'));
  }
});

test('and it grades nothing: `match_source` says where, so the words say where', () => {
  // Retrieval is any-of with no relevance floor, so one shared word earns
  // `match_source = 'both'` — the word "split" puts a PDF splitter at the top
  // of a question about holiday expenses. Any wording that ranks the result
  // ("strong", "best", "good", a percentage) is the interface asserting a
  // quality nothing measured. The band may name a place and nothing else.
  const GRADED = /\b(strong|weak|good|best|poor|excellent|high|low|close|top)\b/i;

  for (const source of ['both', 'problem', 'tool', 'name', 'vector']) {
    const band = matchBand(source);
    assert.doesNotMatch(band.label, GRADED, `the band label grades the result: "${band.label}"`);
    assert.doesNotMatch(band.note, GRADED, `the band note grades the result: "${band.note}"`);
    assert.match(band.label, /^Matched:/, 'the label names where it matched');
  }

  // 'name' is the one source that says something limiting rather than
  // grading, and it is allowed to: it is a fact about what did not match.
  assert.match(matchBand('name').label, /name only/);

  // Likewise 'vector': it says what did NOT match, which is the honest thing
  // to say about a row no word of the query appears in.
  assert.match(matchBand('vector').label, /meaning/);
  assert.match(matchBand('vector').note, /Nothing you typed/);
});

test('a problem statement is only shown when it is the one that matched', () => {
  const matched = { ...DETAIL_ROW, matchedProblem: 'a statement', matchedStrength: 0.04 };
  const unmatched = { ...DETAIL_ROW, matchedProblem: 'a statement', matchedStrength: 0 };
  assert.equal(matchedProblemOf(matched), 'a statement');
  assert.equal(matchedProblemOf(unmatched), null);
});

/** `['money', 'money', 'audio']` -> three results in those categories. */
function spread(categories) {
  return categories.map((slug, i) => ({
    ...DETAIL_ROW,
    slug: `tool-${i}`,
    categorySlug: slug,
    categoryName: slug[0].toUpperCase() + slug.slice(1),
  }));
}

/** `{ money: 6, audio: 2 }` -> eight results, six of them in Money. */
function withCounts(counts) {
  return spread(Object.entries(counts).flatMap(([slug, n]) => Array(n).fill(slug)));
}

test('the clarifier asks once, and only when the answer really is scattered', () => {
  const scattered = spread(['money', 'travel', 'files', 'money', 'audio', 'travel']);

  const asked = clarifier({ query: 'track spending', results: scattered, answered: false });
  assert.ok(asked, 'a two-word question over six scattered results is worth one question');
  assert.equal(asked.options[0].slug, 'money');

  assert.equal(
    clarifier({ query: 'track spending', results: scattered, answered: true }),
    null,
    'one question per search: answered or skipped, it does not come back',
  );

  assert.equal(
    clarifier({
      query: 'free tool to split expenses with friends while travelling in spain',
      results: scattered,
      answered: false,
    }),
    null,
    'a specific sentence is not ambiguous enough to interrupt',
  );

  assert.equal(
    clarifier({ query: 'split bill', results: spread(['money', 'money', 'money', 'money', 'money', 'money']), answered: false }),
    null,
    'six results in one category are not scattered',
  );

  assert.equal(
    clarifier({ query: 'track spending', results: scattered, answered: false, constraintCount: 2 }),
    null,
    'a sentence that stated constraints has already said what it wants',
  );
});

test('a category holding half the answer is the answer, not an ambiguity', () => {
  // Measured against the running app. Five of six two-word queries used to
  // fire the question; on all four of these the catalogue had already picked a
  // corner, and interrupting spends the one question a search gets on a choice
  // that had already been made.
  const decided = {
    notes: { writing: 6, audio: 2, health: 1, privacy: 1 },
    'track money': { money: 6, audio: 2, focus: 2, documents: 1 },
    'record audio': { audio: 6, video: 2, health: 1, money: 1 },
  };

  for (const [query, counts] of Object.entries(decided)) {
    assert.equal(
      clarifier({ query, results: withCounts(counts), answered: false }),
      null,
      `"${query}" is answered by ${Object.keys(counts)[0]}, not scattered across four`,
    );
  }

  // Genuinely spread: the largest corner holds four of ten.
  const shared = clarifier({
    query: 'share files',
    results: withCounts({ files: 4, money: 3, privacy: 2, audio: 1 }),
    answered: false,
  });
  assert.ok(shared, 'four of ten in the largest category is a real spread');
  assert.deepEqual(
    shared.options.map((o) => o.slug),
    ['files', 'money', 'privacy'],
    'the stray single result is not offered as a way to narrow anything',
  );

  // Exactly half is not "less than about half".
  assert.equal(
    clarifier({ query: 'split bill', results: withCounts({ money: 5, files: 3, audio: 2 }), answered: false }),
    null,
    'half the answer in one category decides it',
  );
});

test('an option holding one result is that result, so it is not an option', () => {
  // Every category but one holds a single tool: there is a spread, but no
  // corner of the catalogue to steer towards, and "Health · 1" is a link to a
  // tool dressed up as a way to narrow a search.
  assert.equal(
    clarifier({
      query: 'notes',
      results: withCounts({ writing: 2, audio: 1, health: 1, privacy: 1, focus: 1, money: 1 }),
      answered: false,
    }),
    null,
    'one surviving option is not a choice',
  );

  const two = clarifier({
    query: 'notes',
    results: withCounts({ writing: 2, audio: 2, health: 1, privacy: 1, focus: 1 }),
    answered: false,
  });
  assert.ok(two, 'two corners with more than one tool each is a choice');
  assert.deepEqual(
    two.options.map((o) => `${o.slug}:${o.count}`),
    ['audio:2', 'writing:2'],
    'and only those two are offered',
  );
});
