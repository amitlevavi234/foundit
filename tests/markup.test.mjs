// ===========================================================================
// Two rules that live in the markup, and would break without a sound.
//
//   1. Every page that shows a tool links out to the maker's own address, in a
//      new tab, with rel="noopener noreferrer" and the domain beside it. A
//      missing `noopener` still opens the page; only a human reading the
//      markup would notice, and nobody reads markup twice.
//
//   2. The server never fetches an address a stranger supplied. No favicon
//      fetch, no preview scrape, no metadata read, no remote image loader
//      pointed at a tool's domain. This is the easiest rule in the codebase to
//      break by accident and the most expensive one to break.
//
// The components are .tsx and Node's type stripping does not do JSX, so these
// read the source rather than the rendered output. `tests/outbound.test.mjs`
// covers what the attributes are; this covers who is allowed to write them and
// that every screen goes through that one component.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(tsx?|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const SOURCES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'lib'))];

const read = (path) => readFileSync(path, 'utf8');
const rel = (path) => path.slice(ROOT.length).replace(/\\/g, '/');

test('only one component in the codebase may open a new tab', () => {
  const offenders = SOURCES.filter(
    (path) => /target\s*=\s*["'{]/.test(read(path)) && !path.endsWith('OutboundLink.tsx'),
  ).map(rel);

  assert.deepEqual(
    offenders,
    [],
    'target="_blank" belongs to components/OutboundLink.tsx, which pairs it with rel="noopener noreferrer"',
  );
});

test('that component sets both halves of the rule, and shows the domain', () => {
  const source = read(join(ROOT, 'components', 'OutboundLink.tsx'));
  assert.match(source, /target=\{link\.target\}/);
  assert.match(source, /rel=\{link\.rel\}/);
  assert.match(source, /link\.domain/, 'the domain is shown so a person knows where they are going');

  const outbound = read(join(ROOT, 'lib', 'outbound.ts'));
  assert.match(outbound, /target: '_blank'/);
  assert.match(outbound, /rel: 'noopener noreferrer'/);
  assert.match(outbound, /protocol !== 'https:'/, 'https and nothing else');
});

test('every screen that shows a tool goes through it', () => {
  // The tool page is the one the product decision names outright, and the
  // result card carries the same link on every result.
  for (const path of ['app/tools/[slug]/page.tsx', 'components/ToolCard.tsx']) {
    const source = read(join(ROOT, path));
    assert.match(source, /OutboundButton/, `${path} must link out through OutboundButton`);
    assert.match(source, /OutboundDomain/, `${path} must show the domain beside it`);
    assert.doesNotMatch(source, /<a\s+href=\{[^}]*url/, `${path} must not hand-roll the anchor`);
  }
});

/**
 * The files allowed to open a socket, and the one address each is allowed to
 * open it to.
 *
 * TWO, since Phase 4, and the list is exhaustive: a search embeds the sentence
 * somebody typed and asks a model to read it. Everything below is written
 * against these pairs rather than against a blanket ban, because a rule with no
 * exception would have been deleted rather than narrowed the first time one was
 * needed. Adding a third entry to this list is a decision somebody has to make
 * on purpose, in this file, with a reason.
 */
const EMBEDDINGS_FILE = 'lib/embeddings.ts';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const READER_FILE = 'lib/reader-model.ts';
const READER_URL = 'https://api.openai.com/v1/responses';

/** file -> [the constant's name, the one address it holds]. */
const OUTBOUND = [
  [EMBEDDINGS_FILE, 'EMBEDDINGS_URL', EMBEDDINGS_URL],
  [READER_FILE, 'READER_URL', READER_URL],
];

test('nothing on the server asks a stranger’s address for anything', () => {
  // Two exceptions, both named. A tool's own URL is still never fetched by us,
  // and the tests below say so precisely for each of them.
  const fetchers = SOURCES.filter((path) => /(^|[^.\w])fetch\s*\(/.test(read(path))).map(rel);
  assert.deepEqual(
    fetchers.sort(),
    [EMBEDDINGS_FILE, READER_FILE].sort(),
    `${EMBEDDINGS_FILE} and ${READER_FILE} are the only files that may make an outbound request`,
  );

  const imageLoaders = SOURCES.filter((path) => /from ['"]next\/image['"]/.test(read(path))).map(rel);
  assert.deepEqual(
    imageLoaders,
    [],
    'a remote image loader pointed at a submitted URL is the server fetching it',
  );

  for (const path of SOURCES) {
    const source = read(path);
    assert.doesNotMatch(source, /favicon.*\$\{|google\.com\/s2\/favicons/i, `${rel(path)} fetches a favicon`);
  }
});

test('each request goes to one hardcoded address and can go nowhere else', () => {
  for (const [file, constant, url] of OUTBOUND) {
    const source = read(join(ROOT, file));
    const where = (what) => `${file}: ${what}`;

    // The constant is the literal address, written out, not assembled.
    assert.match(
      source,
      new RegExp(`export const ${constant} = '${url.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}';`),
      where(`${constant} must be the literal address and nothing else`),
    );

    // The call site takes that identifier. Not a variable, not a parameter, not
    // a property of something somebody supplied.
    const calls = [...source.matchAll(/(^|[^.\w])fetch\s*\(\s*([^,\s)]+)/g)].map((m) => m[2]);
    assert.deepEqual(calls, [constant], where('fetch must be called with the constant'));

    // No second address, anywhere in the file, in any form.
    const urls = [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
    assert.deepEqual(urls, [url], where('the file may contain exactly one URL'));

    // And no URL assembled out of pieces: a template literal is how a hardcoded
    // address becomes a configurable one without anybody noticing.
    for (const literal of source.match(/`[^`]*`/g) ?? []) {
      assert.doesNotMatch(
        literal,
        /https?:|\/\/|\w+\.(com|net|org|io|ai)/i,
        where(`a template literal builds an address: ${literal}`),
      );
    }
    assert.doesNotMatch(
      source,
      /process\.env\.\w*(URL|HOST|ENDPOINT|BASE)/i,
      where('the address is not read from the environment'),
    );
    assert.doesNotMatch(source, /new URL\(/, where('nothing here parses or builds a URL'));
  }
});

test('the reader sends the sentence and six settings — nothing else', () => {
  const source = read(join(ROOT, READER_FILE));

  const body = /body:\s*JSON\.stringify\(\{([\s\S]*?)\n      \}\)/.exec(source);
  assert.ok(body, 'the request body must be one JSON.stringify of an object literal');

  const keys = [...body[1].matchAll(/^\s{8}([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
  assert.deepEqual(
    keys.sort(),
    ['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'text'].sort(),
    'seven fields: the model, the instructions, the sentence, the schema, the effort, the ceiling, and store:false',
  );
  assert.match(body[1], /model:\s*READER_MODEL/);
  // `capped` is the sentence after MAX_READER_INPUT has been applied. The raw
  // argument must not be what goes out — the 200-character ceiling is what
  // bounds what a stranger can make this cost.
  assert.match(body[1], /input:\s*capped/, 'the capped sentence is sent, not the caller’s string');
  assert.match(
    source,
    /const capped = points\.slice\(0, MAX_READER_INPUT\)\.join\(''\);/,
    'and `capped` must be exactly that',
  );
  // The provider keeps a response by default. The sentence somebody typed is
  // the text search_events refuses to attach to a person.
  assert.match(body[1], /store:\s*false/, 'the provider must not retain the sentence');

  // Nothing about the visitor, the request or the catalogue may travel with it.
  for (const forbidden of ['user', 'session', 'cookie', 'referer', 'visitor', 'device']) {
    assert.doesNotMatch(
      body[1],
      new RegExp(`\\b${forbidden}`, 'i'),
      `the request body must not carry anything ${forbidden}-shaped`,
    );
  }

  // And no catalogue: the model is reading a sentence, not choosing an answer.
  for (const forbidden of ['slug', 'catalogue', 'catalog', 'tools', 'candidates']) {
    assert.doesNotMatch(
      body[1],
      new RegExp(`\\b${forbidden}\\b`, 'i'),
      `the request body must not carry the ${forbidden}`,
    );
  }
});

test('the reader can name no tool, because no field can hold one', () => {
  // The schema is the guarantee. Four enum arrays, a boolean, and two strings
  // that are restatements of the sentence the person typed — `english`, which
  // never reaches a filter, and `residual`, which lib/reading.ts accepts only
  // when it is a DELETION of the input. There is nowhere for a tool name to
  // arrive and be used.
  const source = read(join(ROOT, READER_FILE));
  const required = /required:\s*\[([\s\S]*?)\]/.exec(source);
  assert.ok(required, 'the schema must list its required fields');
  const fields = [...required[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    fields.sort(),
    ['asks_for_software', 'english', 'flags', 'languages', 'platforms', 'pricing', 'residual'],
    'the seven fields, and no eighth one a tool could arrive in',
  );
  assert.match(source, /additionalProperties:\s*false/, 'the schema must be closed');
  assert.match(source, /strict:\s*true/, 'the schema must be strict');

  // And the merge checks the one field that could smuggle text into the ranker.
  const reading = read(join(ROOT, 'lib', 'reading.ts'));
  assert.match(
    reading,
    /if \(!isDeletionOf\(residual, input\)\)/,
    'the residual must be proved to be a deletion of the sentence, not trusted',
  );
});

test('and it sends the model, the length, and the capped sentence — nothing else', () => {
  const source = read(join(ROOT, 'lib', 'embeddings.ts'));

  const body = /body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/.exec(source);
  assert.ok(body, 'the request body must be one JSON.stringify of an object literal');

  const keys = [...body[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
  assert.deepEqual(
    keys.sort(),
    ['dimensions', 'input', 'model'],
    'three fields: the model name, the length wanted back, and the text',
  );
  assert.match(body[1], /model:\s*EMBEDDING_MODEL/);
  assert.match(body[1], /dimensions:\s*EMBEDDING_DIMENSIONS/);
  // `capped` is the input list after MAX_EMBEDDING_INPUT has been applied to
  // every entry. The raw argument must not be what goes out.
  assert.match(body[1], /input:\s*capped/, 'the capped text is sent, not the caller’s string');
  // `capped` is the inputs with a character ceiling applied to every one. The
  // ceiling defaults to the QUERY cap — an anonymous endpoint's ceiling — and
  // a caller may raise it only to the separate document cap.
  assert.match(
    source,
    /const limit = options\.cap \?\? MAX_EMBEDDING_INPUT;/,
    'the default ceiling is the query cap, so a caller that forgets gets the strict one',
  );
  assert.match(
    source,
    /const capped = inputs\.map\([\s\S]*?slice\(0, limit\)/,
    'and `capped` must be exactly that',
  );

  // Nothing about the visitor, the request or the catalogue may travel with it.
  for (const forbidden of ['user', 'session', 'ip', 'cookie', 'referer', 'visitor', 'device']) {
    assert.doesNotMatch(
      body[1],
      new RegExp(`\\b${forbidden}`, 'i'),
      `the request body must not carry anything ${forbidden}-shaped`,
    );
  }
});

test('each key is read from a named variable, and never written anywhere', () => {
  // One name for the embedder. Two for the reader, and that is deliberate
  // rather than sloppy: there is ONE account behind both, OPENAI_API_KEY is
  // read first so a deployment can scope a separate key to the model, and
  // EMBEDDINGS_API_KEY — which already reaches the same host from the file
  // above — is the fallback rather than a second copy of the same secret in a
  // second place to leak it from. Both names are listed here so adding a third
  // source for a secret is a change to this test.
  for (const [file, names, declaration] of [
    [EMBEDDINGS_FILE, ['KEY_VARIABLE'], /const KEY_VARIABLE = 'EMBEDDINGS_API_KEY';/],
    // The reader reads `process.env[name]`, where `name` can only have come
    // from the list below — asserted separately, under the loop.
    [
      READER_FILE,
      ['name'],
      /const KEY_VARIABLES = \['OPENAI_API_KEY', 'EMBEDDINGS_API_KEY'\] as const;/,
    ],
  ]) {
    const source = read(join(ROOT, file));
    assert.match(source, declaration, `${file}: the key's source must be declared here`);

    const reads = [...source.matchAll(/process\.env\[?\.?([A-Za-z_$][\w$]*)\]?/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(reads)],
      names,
      `${file}: the key is read through the named constant and nothing else`,
    );

    // No console call in either file may name the key or the thing it goes in.
    for (const call of source.match(/console\.\w+\([^)]*\)/g) ?? []) {
      assert.doesNotMatch(call, /key|Bearer|authorization/i, `${file}: a log line names the key: ${call}`);
    }

    // And the one place the key appears in a string is the Authorization header.
    const interpolations = (source.match(/`[^`]*\$\{key\}[^`]*`/g) ?? []).map((s) => s.trim());
    assert.deepEqual(
      interpolations,
      ['`Bearer ${key}`'],
      `${file}: the key goes in a header and nowhere else`,
    );
  }

  // `name` in the reader is only ever bound by iterating KEY_VARIABLES, so
  // "read through the named constant" is true of it as well.
  const reader = read(join(ROOT, READER_FILE));
  const bindings = [...reader.matchAll(/for \(const name of ([A-Za-z_$][\w$]*)\)/g)].map((m) => m[1]);
  assert.ok(bindings.length > 0, 'the reader must iterate its key variables');
  assert.deepEqual(
    [...new Set(bindings)],
    ['KEY_VARIABLES'],
    'the only thing `name` is ever bound from is KEY_VARIABLES',
  );
  // A bare `name = …` / `const name = …` would be a second source for the key
  // variable; `this.name = 'ReaderError'` on the error class is not, so the
  // member access is excluded. (An earlier version of this regex had its `\b`
  // corrupted into a backspace byte by a shell heredoc, which made the
  // assertion match nothing and pass on every input.)
  assert.doesNotMatch(
    reader,
    /(?<![.\w$])name\s*=\s*(?!=)/,
    'nothing else may assign `name` in the reader',
  );
});

test('no client component pulls a paid call — or a key — into a browser bundle', () => {
  // Neither lib/embeddings.ts nor lib/reader-model.ts has a `server-only`
  // import: eval/run.mjs, scripts/embed.mjs and scripts/read.mjs are plain Node
  // and import them directly, so the harness measures the code that ships.
  // lib/rate-limit.ts is the same case for tests/rate-limit.test.mjs. This is
  // what replaces that guard for all three.
  const guarded = ['embeddings', 'reader-model', 'rate-limit'];
  const clients = SOURCES.filter((path) => /^\s*['"]use client['"]/m.test(read(path)));
  for (const path of clients) {
    for (const guardedModule of guarded) {
      assert.doesNotMatch(
        read(path),
        new RegExp(`from ['"](@/lib/${guardedModule}|.*/${guardedModule})['"]`),
        `${rel(path)} is a client component and must not import lib/${guardedModule}`,
      );
    }
  }
  for (const guardedModule of guarded) {
    assert.ok(!/import ['"]server-only['"]/.test(read(join(ROOT, 'lib', `${guardedModule}.ts`))));
  }
});

test('nothing about a visitor is persisted or logged by the rate limiter', () => {
  const source = read(join(ROOT, 'lib', 'rate-limit.ts'));

  // No database, no file. The whole thing is two Maps and a counter, and a
  // restart forgetting everybody is the point.
  assert.doesNotMatch(
    source,
    /from ['"]pg['"]|writeFile|appendFile|localStorage/,
    'nothing is written down',
  );
  assert.doesNotMatch(source, /insert into|INSERT INTO/, 'no row is ever written about a visitor');

  // It DOES log, twice, and both lines are about the refusal circuit rather
  // than about a visitor: "the reader refused 14 of the last 20 readings" is
  // worth waking somebody for, and carries counts. What may never appear in one
  // is a visitor, a key or a sentence — so the check is on the CONTENT of every
  // log call rather than on there being none, which is what it used to be and
  // which would have been traded away the first time a line was needed.
  const calls = source.match(/console\.\w+\([\s\S]*?\);/g) ?? [];
  assert.ok(calls.length > 0, 'the circuit says when it opens and when it closes');
  for (const call of calls) {
    // Only an INTERPOLATION can carry a value out of this module; the prose
    // around it is prose. "the sentence reader refused 14 of the last 20" names
    // a component and reports two counts, and an earlier version of this
    // assertion failed it for containing the word "sentence" — which is the
    // kind of false positive that gets a check deleted rather than fixed.
    for (const [, expression] of call.matchAll(/\$\{([^}]*)\}/g)) {
      assert.doesNotMatch(
        expression,
        /address|\bip\b|key|query|sentence|salt|bucket/i,
        `a rate-limiter log line interpolates something it must not: \${${expression}}`,
      );
    }
  }

  // The address is hashed with a salt generated in this process and never
  // stored raw. `sha256(ip)` alone is four billion hashes to reverse.
  assert.match(source, /const SALT = randomBytes\(32\);/, 'the salt is random and per process');
  assert.match(
    source,
    /createHash\('sha256'\)\.update\(SALT\)\.update\(address, 'utf8'\)/,
    'the key is a salted hash of the address',
  );

  // And the page that reads the address never keeps it either.
  const visitor = read(join(ROOT, 'lib', 'visitor.ts'));
  assert.doesNotMatch(visitor, /\bconsole\.\w+\(/, 'lib/visitor.ts must not log an address');
  assert.doesNotMatch(visitor, /from ['"]pg['"]/, 'lib/visitor.ts must not reach a database');
});

test('the application never reaches for the embedding job’s write', () => {
  // public.store_problem_embedding writes a vector onto a problem statement.
  // public.query_vector_ranks says which statement's vector is nearest a
  // cached query. A role holding both reads the query cache out one sign bit
  // at a time — an adversarial review recovered 16 of 16 as foundit_app — so
  // 0005_embed_role.sql revoked the first from the application role and gave
  // it to foundit_embed alone. The database refuses the call; this stops the
  // call being written in the first place, in the half of the codebase that
  // connects as foundit_app.
  //
  // scripts/embed.mjs is deliberately not in SOURCES: it is the job, it
  // connects as foundit_embed, and it is the one thing that may say this.
  for (const path of SOURCES) {
    assert.doesNotMatch(
      read(path),
      /store_problem_embedding|problem_embedding_work/,
      `${rel(path)} calls a function that belongs to foundit_embed alone`,
    );
  }

  // And the connection string for that role appears nowhere in the
  // application either — same rule as DATABASE_URL_OWNER.
  const leaks = SOURCES.filter((path) => read(path).includes('DATABASE_URL_EMBED')).map(rel);
  assert.deepEqual(leaks, [], 'the application connects as foundit_app and never as the embedder');
});

test('no embedding column is ever selected into application memory', () => {
  // A halfvec(512) is about a kilobyte per row. Selecting one costs egress for
  // a value the application cannot do anything with — the distance arithmetic
  // happens in PostgreSQL and ranks come back. The only vector that crosses the
  // wire is the one being STORED, as a parameter.
  const dbSources = [
    ...SOURCES,
    join(ROOT, 'eval', 'run.mjs'),
    join(ROOT, 'scripts', 'embed.mjs'),
  ];

  for (const path of dbSources) {
    const source = read(path);
    for (const statement of source.match(/select[\s\S]{0,400}?from/gi) ?? []) {
      assert.doesNotMatch(
        statement,
        /(^|[\s,.])embedding\s*(,|$|\s+as\b)/im,
        `${rel(path)} selects an embedding column:\n${statement.slice(0, 200)}`,
      );
    }
    assert.doesNotMatch(
      source,
      /select\s+\*\s+from\s+public\.(tools|tool_problems|query_embeddings)/i,
      `${rel(path)} does select * on a table with a vector column`,
    );
  }
});

test('the owner’s connection string appears nowhere in application code', () => {
  const leaks = SOURCES.filter((path) => read(path).includes('DATABASE_URL_OWNER')).map(rel);
  assert.deepEqual(leaks, [], 'the application connects as foundit_app and never as the owner');
});

test('no Apple sign-in anywhere — Google and an emailed code only', () => {
  const apple = SOURCES.filter((path) => /apple/i.test(read(path))).map(rel);
  assert.deepEqual(apple, [], 'docs/product-decisions.md §2: Apple sign-in is deferred');
});

test('the fit meter is never fed the search score', () => {
  const fit = readFileSync(join(ROOT, 'lib', 'fit.ts'), 'utf8');
  assert.doesNotMatch(fit, /scoreToFit|function .*score.*Fit/i);

  // A screen may draw the meter with a number it was given; none of them may
  // manufacture one out of `score`, which is an ordering value.
  for (const path of SOURCES) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /fit=\{[^}]*score/,
      `${rel(path)} turns an ordering number into a fit`,
    );
  }
});

test('and no card carries a fit, because no card has one to carry', () => {
  // The homepage illustration already refuses this: components/Contraption.tsx
  // draws no badge rather than a badge with an invented 92 in it. A result
  // card is the same claim with a real tool's name beside it, so `fit` may not
  // be handed to a ToolCard anywhere in the application — including the
  // component sheet, which is a live route. The meter itself survives for
  // Phase 5 and is shown there as a captioned specimen with no tool attached.
  for (const path of SOURCES) {
    const source = read(path);
    if (!/<ToolCard/.test(source)) continue;
    for (const card of source.split('<ToolCard').slice(1)) {
      const props = card.slice(0, card.indexOf('/>') + 1 || card.length);
      assert.doesNotMatch(
        props,
        /\bfit=\{/,
        `${rel(path)} draws a fit meter over a named tool before Phase 5 calibrated one`,
      );
    }
  }
});

test('the component sheet prints the palette’s real values', () => {
  // The artboard prints hex under each swatch, not the token name, because the
  // number is what somebody matching a mock-up needs. Printing a literal means
  // it can drift from the token that paints the chip beside it, so the two are
  // compared here rather than trusted.
  const tokens = readFileSync(join(ROOT, 'styles', 'tokens.css'), 'utf8');
  const sheet = read(join(ROOT, 'app', 'components', 'page.tsx'));

  const swatches = [...sheet.matchAll(/\['[^']+', '(--c-[a-z-]+)', '(#[0-9A-Fa-f]{6})'\]/g)];
  assert.ok(swatches.length >= 8, 'the sheet still lists the eight swatches');

  for (const [, token, hex] of swatches) {
    const declared = new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{3,8})`).exec(tokens);
    assert.ok(declared, `${token} is not declared in styles/tokens.css`);
    assert.equal(
      hex.toLowerCase(),
      declared[1].toLowerCase(),
      `the sheet prints ${hex} for ${token}, which styles/tokens.css sets to ${declared[1]}`,
    );
  }
});

test('every page the footer promises exists, is unwritten out loud, and is noindex', () => {
  // The footer links thirteen pages and not one of them is written
  // (docs/product-decisions.md §14). Three things have to stay true of each,
  // and all three are the kind that break silently.
  //
  //   The route exists          — otherwise the footer is back to linking 404s,
  //                               which tests/links.test.mjs also catches.
  //   It renders UnwrittenPage  — the component is what says, in one panel,
  //                               that nobody has written this yet. A page that
  //                               quietly grew real-looking prose instead would
  //                               be policy nobody agreed to.
  //   robots: { index: false }  — an empty page under a real title is not what
  //                               a search for "Foundit privacy" should return.
  const UNWRITTEN = [
    'about',
    'accessibility',
    'contact',
    'cookies',
    'copyright',
    'guidelines',
    'help',
    'pricing',
    'privacy',
    'ranking',
    'report',
    'security',
    'terms',
  ];

  for (const route of UNWRITTEN) {
    const path = join(ROOT, 'app', route, 'page.tsx');
    let source;
    try {
      source = read(path);
    } catch {
      assert.fail(`app/${route}/page.tsx does not exist, so the footer links a 404`);
    }

    assert.match(
      source,
      /<UnwrittenPage\b/,
      `app/${route}/page.tsx must render UnwrittenPage, which is what says it is unwritten`,
    );
    assert.match(
      source,
      /robots:\s*\{[^}]*\bindex:\s*false/,
      `app/${route}/page.tsx must set robots: { index: false }`,
    );
  }
});

test('the reduced-motion block and the canvas it came from say the same five things', () => {
  // styles/motion.css calls its last block "`RM` from design/canvas/build.mjs,
  // verbatim". It was not verbatim: the app had added `animation-delay` and
  // `transition-delay` and the canvas had not, so every artboard shipped the
  // bug the app had already fixed, invisibly, because an artboard is a still.
  // Neither file can drift again without this failing.
  const motion = readFileSync(join(ROOT, 'styles', 'motion.css'), 'utf8');
  const canvas = readFileSync(join(ROOT, 'design', 'canvas', 'build.mjs'), 'utf8');
  const artboard = readFileSync(join(ROOT, 'design', 'canvas', 'Main.dc.html'), 'utf8');

  const REQUIRED = [
    /animation-duration:\s*\.?0?\.?01ms\s*!important/,
    /animation-iteration-count:\s*1\s*!important/,
    /animation-delay:\s*0s\s*!important/,
    /transition-duration:\s*\.?0?\.?01ms\s*!important/,
    /transition-delay:\s*0s\s*!important/,
  ];

  const reduced = /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\}\s*\}/.exec(motion);
  assert.ok(reduced, 'styles/motion.css has a reduced-motion block');

  for (const rule of REQUIRED) {
    assert.match(reduced[0], rule, `styles/motion.css is missing ${rule}`);
    assert.match(canvas, rule, `design/canvas/build.mjs RM is missing ${rule}`);
    assert.match(artboard, rule, 'the artboards were not regenerated after RM changed');
  }
});
