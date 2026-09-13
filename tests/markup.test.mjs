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
 * THREE, SINCE PHASE 6, and the list is exhaustive: a search embeds the
 * sentence somebody typed and asks a model to read it, and signing in sends a
 * 6-digit code to somebody's inbox. Everything below is written against these
 * pairs rather than against a blanket ban, because a rule with no exception
 * would have been deleted rather than narrowed the first time one was needed.
 * Adding a fourth entry is a decision somebody has to make on purpose, in this
 * file, with a reason.
 *
 * THE THIRD ENTRY'S REASON, since that is what this comment is for. A code has
 * to reach an inbox. The alternative to a provider is an SMTP client on the
 * box and a sending reputation to manage by hand (research/09 §6), and the
 * rule this list protects — the server never fetches an address a STRANGER
 * supplied — is untouched by one request to one address written out in full in
 * lib/email.ts. What goes in that request is asserted below, field by field,
 * exactly as the other two are.
 */
const EMBEDDINGS_FILE = 'lib/embeddings.ts';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const READER_FILE = 'lib/reader-model.ts';
const READER_URL = 'https://api.openai.com/v1/responses';
const EMAIL_FILE = 'lib/email.ts';
const EMAIL_URL = 'https://api.resend.com/emails';

/** file -> [the constant's name, the one address it holds]. */
const OUTBOUND = [
  [EMBEDDINGS_FILE, 'EMBEDDINGS_URL', EMBEDDINGS_URL],
  [READER_FILE, 'READER_URL', READER_URL],
  [EMAIL_FILE, 'RESEND_URL', EMAIL_URL],
];

/**
 * The one file that calls `fetch` and is not on the outbound list.
 *
 * THE RULE IS ABOUT THE SERVER, and this is not the server. It is a `'use
 * client'` component, the request is made by the visitor's own browser, and
 * the address is `/o` — a path on this site with no host in it, which cannot
 * reach anywhere else however it is called. It exists because the Phase 8
 * review's F5 moved the outbound-click beacon off the tool page's own URL, so
 * that the slug stops appearing in the request line of every access log beside
 * the visitor's address (app/o/route.ts).
 *
 * It is listed separately rather than added to OUTBOUND because OUTBOUND's
 * three entries are asserted field by field against a hardcoded external
 * address, and this one has no external address to assert.
 */
const SAME_ORIGIN_FETCHER = 'components/OutboundLink.tsx';

test('nothing on the server asks a stranger’s address for anything', () => {
  // Three exceptions, all named, plus one same-origin client component. A
  // tool's own URL is still never fetched by us, and the tests below say so
  // precisely for each of them.
  const fetchers = SOURCES.filter((path) => /(^|[^.\w])fetch\s*\(/.test(read(path))).map(rel);
  assert.deepEqual(
    fetchers.sort(),
    [EMBEDDINGS_FILE, READER_FILE, EMAIL_FILE, SAME_ORIGIN_FETCHER].sort(),
    `${EMBEDDINGS_FILE}, ${READER_FILE}, ${EMAIL_FILE} and ${SAME_ORIGIN_FETCHER} are the only `
      + 'files that may call fetch',
  );

  // And the fourth one goes to a path on this site and nowhere else: no
  // scheme, no host, no interpolation, nothing a caller could steer.
  const beacon = read(join(ROOT, SAME_ORIGIN_FETCHER));
  assert.match(beacon, /fetch\('\/o',/, `${SAME_ORIGIN_FETCHER} must post to /o and nothing else`);
  assert.doesNotMatch(
    beacon,
    /fetch\(\s*(`|[A-Za-z_$])/,
    `${SAME_ORIGIN_FETCHER} builds a fetch address rather than naming one`,
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
  // UPDATED DELIBERATELY IN PHASE 5, and the reason matters more than the diff.
  //
  // Phase 5 adds three more calls to the same endpoint: a reranker over the
  // candidates, a generator that writes problem statements, and a verifier that
  // checks each one. Writing three more `fetch` calls would have meant three
  // more places to arm a timeout wrongly, three more bodies to check, and a
  // third entry in OUTBOUND above — which is the rule this file exists to hold.
  //
  // So there is now ONE request site in this file, `callResponses`, and its body
  // takes its model, instructions, input, schema and ceilings from a typed
  // argument. The two assertions that used to name READER_MODEL and `capped`
  // therefore move: the KEYS are still exactly these seven, `store: false` is
  // still hardcoded rather than passed, and the cap is now asserted at each
  // entry point instead of at the body.
  const source = read(join(ROOT, READER_FILE));

  const body = /body:\s*JSON\.stringify\(\{([\s\S]*?)\n      \}\)/.exec(source);
  assert.ok(body, 'the request body must be one JSON.stringify of an object literal');

  const keys = [...body[1].matchAll(/^\s{8}([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
  assert.deepEqual(
    keys.sort(),
    ['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'text'].sort(),
    'seven fields: the model, the instructions, the sentence, the schema, the effort, the ceiling, and store:false',
  );
  assert.match(body[1], /model:\s*request\.model/, 'the model comes from the typed request');
  assert.match(body[1], /input:\s*request\.input/, 'and so does the input');

  // The 200-character ceiling is what bounds what a stranger can make this
  // cost, so every entry point has to apply it BEFORE the request is built.
  // `capText` counts code points, because a cap that counts UTF-16 units hands
  // the API half a surrogate pair.
  assert.match(
    source,
    /export function capText\(text: unknown, limit: number\): string \{\r?\n  return Array\.from\(String\(text \?\? ''\)\)\.slice\(0, limit\)\.join\(''\);/,
    'capText must be exactly a code-point slice',
  );
  assert.match(
    source,
    /const capped = capText\(sentence, MAX_READER_INPUT\);/,
    'the reader caps its sentence before it calls',
  );
  for (const [file, expected] of [
    ['lib/rerank.ts', /const capped = capText\(sentence, MAX_RERANK_INPUT\);/],
    ['lib/generate.ts', /capText\(statement, MAX_STATEMENT\)/],
  ]) {
    assert.match(read(join(ROOT, file)), expected, `${file} must cap what it sends`);
  }

  // The provider keeps a response by default. The sentence somebody typed is
  // the text search_events refuses to attach to a person. It is hardcoded here
  // rather than taken from the request, so no caller can turn it off.
  assert.match(body[1], /store:\s*false/, 'the provider must not retain the sentence');

  // Nothing about the visitor, the request or the catalogue may travel with it.
  for (const forbidden of ['user', 'session', 'cookie', 'referer', 'visitor', 'device']) {
    assert.doesNotMatch(
      body[1],
      new RegExp(`\\b${forbidden}`, 'i'),
      `the request body must not carry anything ${forbidden}-shaped`,
    );
  }

  // And no catalogue in the body's own text. The READER is reading a sentence
  // and must see no catalogue at all; the RERANKER is shown candidates on
  // purpose, and what it may see is fixed by the `RerankCandidate` type rather
  // than by this assertion — the test below is the one that holds it.
  for (const forbidden of ['slug', 'catalogue', 'catalog', 'tools', 'candidates']) {
    assert.doesNotMatch(
      body[1],
      new RegExp(`\\b${forbidden}\\b`, 'i'),
      `the request body must not carry the ${forbidden}`,
    );
  }
});

test('the reranker sees four things about a candidate, and no fifth', () => {
  // The privacy and fairness boundary of the whole feature. A rank or a score
  // would let the model agree with the ranking it is there to second-guess; a
  // like count, a rating or a price would let popularity or money into a
  // judgement about fit, which is the one thing docs/product-decisions.md §6
  // says the fit score is not about.
  const source = read(join(ROOT, 'lib', 'rerank.ts'));

  const shape = /export interface RerankCandidate \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(shape, 'RerankCandidate must be declared in lib/rerank.ts');
  const fields = [...shape[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.deepEqual(
    fields.sort(),
    ['name', 'slug', 'statements', 'summary'],
    'a candidate is a slug, a name, a summary and its statements — nothing else',
  );

  // And the builder copies those four across rather than spreading a row, so a
  // caller whose rows carry a score cannot leak one by passing the row through.
  assert.doesNotMatch(
    source,
    /\.\.\.row/,
    'rerankCandidates must not spread a caller’s row into what goes out',
  );

  // A slug the search did not return cannot be named, because the schema's
  // `slug` is an enum of exactly the candidates.
  assert.match(
    source,
    /slug: \{ type: 'string', enum: \[\.\.\.slugs\] \}/,
    'the schema must make a slug outside the candidate list impossible',
  );
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

test('every email carries four fields, and no fifth', () => {
  // Phase 6's addition to this file, and the reason it is here rather than in
  // a test of its own: the other two request bodies are enumerated exactly
  // like this, and the thing that must never happen to any of the three is a
  // field arriving that nobody decided on.
  //
  // What goes out is one recipient, one subject, a few lines of text — and for
  // the sign-in code, the code is in the subject as well as the body so it can
  // be read from a phone's notification without opening anything (research/09
  // §6). No HTML, no image, no tracking pixel, no link of any kind: a sign-in
  // code that looks like marketing arrives in Spam, and a link in one is a
  // phishing lesson taught by us.
  //
  // PHASE 8 ADDED A SECOND MESSAGE AND NOT A SECOND TRANSPORT. The review-
  // removal notice goes through the same private `post`, so this stays one
  // assertion about one request body — which is the property worth having,
  // because a third message must not be able to introduce a fifth field.
  const source = read(join(ROOT, EMAIL_FILE));

  const body = /body:\s*JSON\.stringify\(\{([\s\S]*?)\}\),/.exec(source);
  assert.ok(body, 'the request body must be one JSON.stringify of an object literal');

  const keys = [...body[1].matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?=[,:}]|$)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    keys.sort(),
    ['from', 'subject', 'text', 'to'].sort(),
    'four fields: who it is from, who it is to, the subject and the text',
  );

  // No HTML body, ever. `html` is the field a template would arrive in.
  assert.doesNotMatch(body[1], /\bhtml\b/i, 'a code email is plain text');
  // Nothing about the visitor travels with it.
  for (const forbidden of ['session', 'cookie', 'referer', 'visitor', 'device', 'query']) {
    assert.doesNotMatch(
      body[1],
      new RegExp(`\\b${forbidden}`, 'i'),
      `the request body must not carry anything ${forbidden}-shaped`,
    );
  }

  // The development-only log path, and the pairing that makes production
  // unable to reach it. tests/email.test.mjs runs this; here it is asserted as
  // a SHAPE, so the check cannot be moved into a variable somebody sets.
  assert.match(
    source,
    /process\.env\.NODE_ENV !== 'production' && trimmed\(process\.env\.AUTH_DEV_CODE_TO_LOG\) === '1'/,
    'both halves are required, and the production half is not configurable',
  );
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
    // The email client reads FOUR variables and reads each one by its literal
    // name rather than through `process.env[whatever]`, which is what lets
    // this list be exhaustive: these four, in this order, and nothing else.
    // RESEND_API_KEY is the secret; EMAIL_FROM is the verified sender;
    // NODE_ENV and AUTH_DEV_CODE_TO_LOG are the pair that decides whether a
    // code may be printed to a log instead of sent, and BOTH are required, so
    // production cannot reach that path however the second one is set.
    [
      EMAIL_FILE,
      ['RESEND_API_KEY', 'EMAIL_FROM', 'NODE_ENV', 'AUTH_DEV_CODE_TO_LOG'],
      /export const RESEND_URL = 'https:\/\/api\.resend\.com\/emails';/,
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
  //
  // THE SALT LIVES ON globalThis SINCE THE PHASE 7 REVIEW (F13). It was a
  // module-level const, and in development Next replaces the module on every
  // edit: the bucket map survived a recompile because it is parked on
  // globalThis, and the salt did not — so every key changed and every
  // allowance was fresh anyway. The review watched a publish allowance that
  // should have been spent come back, and `docs/loop-progress.md` blamed the
  // buckets. Both halves are asserted here, because "per process" is the
  // property and the parking is how it is true.
  assert.match(
    source,
    /globalThis\.__founditLimiterSalt \?\?= randomBytes\(32\);/,
    'the salt is random, per process, and parked beside the buckets',
  );
  assert.doesNotMatch(
    source,
    /^const SALT = /m,
    'a module-level salt is re-randomised on every recompile in development',
  );
  assert.match(
    source,
    /createHash\('sha256'\)\.update\(salt\(\)\)\.update\(address, 'utf8'\)/,
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

/* ===========================================================================
 * Phase 7: the ten new screens
 *
 * The rules above already cover these files — SOURCES walks app/ recursively,
 * so a new page is in scope for the fetch allow-list, the no-target rule, the
 * no-Apple rule and the rest the moment it exists. What this section adds is
 * the ONE thing a recursive walk cannot check: that each page the phase
 * promised is actually there, with the rules that particular screen turns on.
 *
 * The list is explicit on purpose. tests/links.test.mjs proves every link
 * resolves to a route; it cannot prove a route that should exist does.
 * ======================================================================== */

const PHASE_7_PAGES = [
  'app/submit/page.tsx',
  'app/submit/url/page.tsx',
  'app/submit/details/page.tsx',
  'app/submit/problems/page.tsx',
  'app/submit/constraints/page.tsx',
  'app/submit/preview/page.tsx',
  'app/submit/done/page.tsx',
  'app/claim/page.tsx',
  'app/maker/page.tsx',
  'app/maker/[slug]/page.tsx',
  'app/maker/[slug]/edit/page.tsx',
];

test('every screen this phase promised exists, and none of them is indexable', () => {
  for (const path of PHASE_7_PAGES) {
    const source = read(join(ROOT, path));
    assert.ok(source.length > 0, `${path} is missing`);
    // Every one of them is either a form carrying what somebody typed in its
    // query string or a per-person dashboard. Neither belongs in a search
    // index, and the four unwritten pages set the same flag for the same
    // reason.
    assert.match(
      source,
      /robots:\s*\{[^}]*\bindex:\s*false/,
      `${path} must set robots: { index: false } — it is a form or a private page`,
    );
    // Reading the session makes the page per-person, so it cannot be a static
    // file served to everybody.
    assert.match(source, /export const dynamic = 'force-dynamic'/, `${path} must be dynamic`);
  }
});

test('the submit flow never fetches what somebody typed, and says so', () => {
  // The fetch allow-list above already proves the first half over every file.
  // This is the second half: the two screens that PROMISE not to, because the
  // artboards draw a "Read the page" button and a favicon slot, have to be
  // the ones that say it out loud rather than quietly doing nothing.
  const url = read(join(ROOT, 'app/submit/url/page.tsx'));
  assert.match(url, /we do not open it|never opened by us|do not read the page/i,
    'app/submit/url/page.tsx must say that the address is not fetched');

  for (const path of ['app/submit/url/page.tsx', 'app/claim/page.tsx', 'lib/submit.ts']) {
    const source = read(join(ROOT, path));
    assert.doesNotMatch(source, /(^|[^.\w])fetch\s*\(/, `${path} must not fetch`);
    // No favicon, no logo download, no image proxy — the neighbouring version
    // of the same rule, which components/SiteHeader.tsx already writes down
    // about a Google avatar.
    assert.doesNotMatch(
      source,
      /favicon.*\$\{|google\.com\/s2\/favicons/i,
      `${path} must not build an icon URL`,
    );
  }
});

test('the required tick is disabled in the HTML and works with no JavaScript', () => {
  const tick = read(join(ROOT, 'components/RequiredTick.tsx'));

  // Disabled, not styled. docs/product-decisions.md §3 and the Phase 7 gate.
  assert.match(tick, /disabled=\{!ticked\}/, 'Continue must carry the disabled attribute');
  // ...which means it starts disabled on the server-rendered HTML, because the
  // initial state is false.
  assert.match(tick, /useState\(false\)/, 'and must start disabled');

  // And the three layers that stop that from being a dead end.
  assert.match(tick, /required/, 'the checkbox is required, so no-JS browsers refuse the form');
  assert.match(tick, /<noscript>/, 'and a no-JS Continue is drawn');

  // The server refuses it too, with the tick's own sentence.
  const actions = read(join(ROOT, 'app/submit/actions.ts'));
  assert.match(
    actions,
    /formData\.get\('made'\)[^;]*!==\s*'yes'/,
    'the action must refuse a POST without the tick',
  );
  assert.match(actions, /problem=tick/, 'and send them back to the tick');
});

test('no screen decides who may edit a listing', () => {
  // The rule lib/accounts.ts states and this phase inherits: there is no
  // `if (tool.ownerId === me)` anywhere, because that check is the database's
  // and an application that makes it will eventually make it wrong.
  for (const path of [...PHASE_7_PAGES, 'lib/maker.ts', 'lib/tool-sql.ts', 'app/submit/actions.ts']) {
    const source = read(join(ROOT, path));
    assert.doesNotMatch(
      source,
      /\bowner(?:Id|_id)\s*===\s*(?!true|false)/,
      `${path} compares an owner id; public.tool_is_mine is what decides`,
    );
    assert.doesNotMatch(
      source,
      /\bsubmitted(?:By|_by)\s*===\s*(?!true|false)/,
      `${path} compares a submitter id; public.tool_is_mine is what decides`,
    );
  }
});

test('the maker dashboard never decides the query-text threshold itself', () => {
  // The five-event rule is public.maker_query_threshold() and the CASE inside
  // public.maker_search_demand. If this page ever computed it, a future edit
  // could reveal a sentence one person typed once — which is the one thing the
  // panel must not do.
  const page = read(join(ROOT, 'app/maker/[slug]/page.tsx'));
  assert.doesNotMatch(page, /searches\s*>=?\s*\d/, 'the page must not compare a search count to a number');
  assert.match(page, /row\.shown/, 'it draws the answer the database gave it');

  const sql = read(join(ROOT, 'lib/tool-sql.ts'));
  assert.match(sql, /public\.maker_search_demand/, 'and the demand comes from that function');
  assert.doesNotMatch(
    sql,
    /from public\.search_event_tools[\s\S]{0,400}group by/,
    'lib must not aggregate the join table itself; the threshold lives in the function',
  );
});

/* ===========================================================================
 * Phase 8: the operator dashboard
 *
 * The rules above already cover these files — SOURCES walks app/ recursively —
 * so the fetch allow-list, the no-target rule and the no-Apple rule apply to
 * them the moment they exist. What this section adds is what a recursive walk
 * cannot check: that the screens the phase promised are there, that nothing on
 * them decides who may read them, and that no figure on them is invented.
 * ======================================================================== */

const PHASE_8_PAGES = ['app/admin/page.tsx', 'app/admin/reviews/page.tsx'];

test('the admin screens exist, are dynamic, and are never indexed', () => {
  for (const path of PHASE_8_PAGES) {
    const source = read(join(ROOT, path));
    assert.ok(source.length > 0, `${path} is missing`);
    assert.match(source, /export const dynamic = 'force-dynamic'/, `${path} must be dynamic`);

    // NOT a `metadata` export, and that is the point. Next resolves a
    // segment's metadata before the component runs, so a fixed title would
    // survive notFound() and confirm the route to anybody who guessed it.
    assert.doesNotMatch(
      source,
      /export const metadata\b/,
      `${path} must resolve its title per-viewer, not export a fixed one`,
    );
    assert.match(
      source,
      /export async function generateMetadata/,
      `${path} must resolve its title with generateMetadata`,
    );
    assert.match(source, /adminMetadata\(/, `${path} must go through app/admin/metadata.ts`);
  }

  // And both branches of that helper are noindex, including the one a stranger
  // gets — a 404 that asks to be crawled is still a 404 in a search index.
  const helper = read(join(ROOT, 'app/admin/metadata.ts'));
  const robots = [...helper.matchAll(/robots:\s*\{[^}]*\}/g)].map((m) => m[0]);
  assert.equal(robots.length, 2, 'app/admin/metadata.ts must set robots on both answers');
  for (const block of robots) {
    assert.match(block, /\bindex:\s*false/, `robots must be index: false — ${block}`);
  }
});

test('every admin route ends at the not-found page and never at a sign-in gate', () => {
  // docs/phase-goals.md Phase 8 item 3: "The page for a non-admin is the
  // not-found page, not a hint that /admin exists." A redirect to the sign-in
  // screen would be exactly that hint — it says there is something here worth
  // signing in for — so neither screen may redirect, and both call notFound().
  for (const path of PHASE_8_PAGES) {
    const source = read(join(ROOT, path));
    assert.match(source, /\bnotFound\(\)/, `${path} must answer with the not-found page`);
    assert.doesNotMatch(
      source,
      /redirect\(\s*['"`]\/sign-in/,
      `${path} must not send anybody to sign in; that confirms the route exists`,
    );
  }
});

test('NO SCREEN AND NO ACTION DECIDES WHO IS AN ADMINISTRATOR', () => {
  // The rule lib/accounts.ts states and this phase inherits, applied to the
  // one place it would be most tempting to break: every panel is an admin_*
  // function that checks auth.is_admin() itself and raises 42501 (0019), and
  // the removal is two ordinary statements the policies and the trigger
  // refuse. A comparison in TypeScript here would be a second opinion about
  // the same question, and a second opinion is what eventually disagrees.
  //
  // THREE FILES ARE DELIBERATELY NOT ON THIS LIST, and they are the three that
  // decide what somebody is SHOWN rather than what they may HAVE. The
  // distinction is lib/admin.ts's own and it is the whole of why this test can
  // be strict about the rest:
  //
  //   app/admin/metadata.ts    decides the text of the <title> element. Next
  //                            resolves a segment's metadata before the
  //                            component throws notFound(), so a fixed title
  //                            survived the refusal and confirmed the route.
  //   app/admin/layout.tsx     decides the 404. `notFound()` can only set a
  //                            status code while nothing has been sent, and a
  //                            layout runs before the page it wraps — so
  //                            /admin answering 200 where a missing route
  //                            answers 404 is fixed HERE or not at all
  //                            (Phase 8 review, F3).
  //   app/admin/actions.ts     decides that everybody who is not an
  //                            administrator gets the not-found page before
  //                            the action looks at its arguments. Without it
  //                            the pair of refusal sentences was a per-review
  //                            oracle to anybody holding the action id (F4).
  //
  // Delete all three and the dashboard still refuses everybody: every panel is
  // an admin_* function that raises 42501 on its own, and the removal is two
  // ordinary statements the policies and the trigger refuse. What would change
  // is only how badly it refuses them.
  //
  // Comments are stripped first, so a file SAYING that it does not read the
  // flag is not mistaken for a file that does.
  const withoutComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  for (const path of [...PHASE_8_PAGES, 'lib/admin.ts', 'lib/admin-sql.ts']) {
    const source = withoutComments(read(join(ROOT, path)));
    assert.doesNotMatch(
      source,
      /\bisAdmin\b/,
      `${path} reads an admin flag; the database is what decides`,
    );
  }

  // The three exceptions may read the flag and may do exactly one thing with
  // it: answer with the not-found page, or name a tab. None of them may send a
  // statement, so none of them can be the place a refusal is decided.
  for (const path of ['app/admin/layout.tsx', 'app/admin/actions.ts', 'app/admin/metadata.ts']) {
    const source = withoutComments(read(join(ROOT, path)));
    assert.match(
      source,
      /notFound\(\)|NOT_FOUND/,
      `${path} reads the admin flag and does something other than answer with the not-found page`,
    );
  }

  // And nothing anywhere in the application writes the flag.
  for (const path of SOURCES) {
    assert.doesNotMatch(
      read(path),
      /set\s+is_admin\s*=|is_admin\s*:\s*(true|false)/,
      `${rel(path)} writes profiles.is_admin; it is set by an operator as the schema owner`,
    );
  }
});

test('the dashboard reads admin functions and never the search tables', () => {
  // Every figure comes through an admin_* function, which is what makes
  // db/test/admin_test.sql §2 a complete statement about the page: the rule
  // that search text and a person are never joined is enforced over function
  // bodies, and a page with a SELECT of its own would be outside it.
  const sql = read(join(ROOT, 'lib/admin-sql.ts'));

  assert.doesNotMatch(
    sql,
    /\b(from|join)\s+public\.(search_events|search_event_tools|query_\w+)\b/i,
    'no statement in the application may read the search tables directly',
  );

  for (const fn of [
    'public.admin_demand',
    'public.admin_unmet_demand',
    'public.admin_top_queries',
    'public.admin_catalogue_counts',
    'public.admin_catalogue_added',
    'public.admin_catalogue_unmatched',
    'public.admin_signups',
    'public.admin_people',
    'public.admin_words',
    'public.admin_ops_events',
    'public.admin_database_bytes',
    'public.admin_reviews',
  ]) {
    assert.ok(sql.includes(fn), `${fn} is not read by lib/admin-sql.ts`);
  }

  // The People panel is public activity, so it may not name a collection: a
  // private saved list is the opposite of what somebody did in public, which
  // is why 0015 took the operator out of collections_read.
  // Comments stripped: this file now SAYS that 0015 took the operator out of
  // collections_read, in the paragraph explaining why the reason a removal
  // needs is cleaned, and a test that read the prose would fail on a sentence
  // promising exactly what it forbids.
  const sqlCode = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(
    sqlCode,
    /collections/i,
    'the dashboard must not read anybody\u2019s saved lists',
  );
});

test('a panel with no writer says so in words and never shows a zero', () => {
  const page = read(join(ROOT, 'app/admin/page.tsx'));

  // The three figures §10 asks for that nothing writes yet, each of which has
  // to appear as a sentence rather than as a number.
  assert.match(page, /Never recorded/, 'the ops panel must say "never recorded"');
  assert.match(page, /Not recorded/, 'reports must say they are not recorded');
  assert.match(
    page,
    /reach the team by email and are written down nowhere/i,
    'and must say WHY reports are not a number',
  );
  assert.match(page, /Not available/, 'a figure this process cannot read says so');

  // The honest label on the money panel: in-process counters are not a month
  // to date and the page may not call them one.
  //
  // IT USED TO SAY "Since this process started", AND THAT WAS THE ONE HEADING
  // IN THIS SET THAT WAS NOT TRUE (Phase 8 review, F9). `DailyCap` is a rolling
  // twenty-four-hour window, so the figure resets every day — it was never
  // "since this process started" — and `count` did not roll the window, so
  // after a quiet stretch it was not "today" either. The heading names the
  // window and prints when it began.
  assert.match(page, /In the last 24 hours, in this process, started/, 'the money panel names its own window');
  assert.doesNotMatch(
    page,
    /Since this process started/,
    'the money panel must not claim a period its counter does not have',
  );
  // And a process that has measured nothing says so rather than drawing a 0,
  // which is the rule the whole of this test is about.
  assert.match(page, /Nothing yet/, 'a process with no paid call yet says so in words');
  assert.match(
    page,
    /has not made a paid call in this window/i,
    'and says why that is not a zero',
  );
});

test('the numbers are tabular, and a wide table scrolls inside its own box', () => {
  const css = read(join(ROOT, 'styles/components.css'));

  for (const [rule, pattern] of [
    ['.admstat-n', /\.admstat-n\s*\{[^}]*\}/],
    ['.admtable .n', /\.admtable \.n\s*\{[^}]*\}/],
  ]) {
    const found = pattern.exec(css);
    assert.ok(found, `${rule} is missing from styles/components.css`);
    assert.match(found[0], /tabular-nums/, `${rule} must be tabular-nums`);
  }

  const scroller = /\.admscroll\s*\{[^}]*\}/.exec(css);
  assert.ok(scroller, '.admscroll is missing from styles/components.css');
  assert.match(
    scroller[0],
    /overflow:\s*auto/,
    'a wide table must scroll inside its own container rather than moving the page',
  );
  assert.match(
    scroller[0],
    /max-height:/,
    'and a long one must be bounded, or the dashboard is a wall of rows',
  );

  // And the page never hands a table straight to the document.
  for (const path of PHASE_8_PAGES) {
    const source = read(join(ROOT, path));
    const tables = [...source.matchAll(/<table className="admtable"/g)];
    const scrollers = [...source.matchAll(/<div className="admscroll">/g)];
    assert.equal(
      tables.length,
      scrollers.length,
      `${path} has ${tables.length} tables and ${scrollers.length} scrolling containers`,
    );
  }
});

test('the outbound link counts a click and still points straight at the tool', () => {
  const link = read(join(ROOT, 'components/OutboundLink.tsx'));

  // The href is the maker's address and nothing of ours, which is what a
  // redirect route would have taken away (docs/product-decisions.md §12).
  assert.match(link, /href=\{link\.href\}/, 'the anchor points at the maker, not at us');

  // THE BEACON POSTS TO `/o` AND NOT TO THE TOOL PAGE (Phase 8 review, F5).
  //
  // It used to be a Server Action, and this test used to assert that it was —
  // "the beacon must not be a fetch". That was the wrong thing to assert. A
  // Server Action posts to the URL of the page it sits on, so every counted
  // click was `POST /tools/<slug>` in the request line of every access log in
  // front of the application, beside the visitor's address and a timestamp:
  // exactly the join 0019 §3 says this product does not make, made by the
  // transport rather than by the function. Its action id was also in the
  // public client bundle, unauthenticated and unbounded.
  assert.match(link, /beacon\(slug\)/, 'the click posts the slug');
  assert.match(link, /fetch\('\/o',/, 'and it posts it to /o, whose path carries no slug');
  assert.match(link, /keepalive: true/, 'so leaving the page does not cancel the count');
  assert.doesNotMatch(link, /await fetch/, 'and the beacon never blocks the navigation');

  // What it posts is the slug and nothing else.
  const beacon = /function beacon\(([^)]*)\)[\s\S]*?\n\}/.exec(link);
  assert.ok(beacon, 'components/OutboundLink.tsx must have a beacon function');
  assert.equal(
    beacon[1].replace(/\s+/g, ' ').trim(),
    'slug: string',
    'the beacon takes the listing and nothing else — no visitor, no session, no address',
  );
  assert.doesNotMatch(
    beacon[0],
    /document\.|navigator\.|localStorage|cookie/i,
    'the beacon must not read anything about the visitor on its way out',
  );

  // And the Server Action whose id was in the client bundle is gone rather
  // than left beside the new route.
  const actions = read(join(ROOT, 'app/tools/actions.ts'));
  assert.doesNotMatch(
    actions,
    /export async function recordOpen/,
    'app/tools/actions.ts must not export recordOpen any more',
  );

  // The route is the one door, it answers 204 to everything, and it reads no
  // session at all.
  const stripped = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const code = stripped(read(join(ROOT, 'app/o/route.ts')));
  assert.match(code, /status: 204/, 'POST /o answers 204');
  assert.doesNotMatch(code, /status: (200|403|404|429|500)/, 'and never anything else');
  assert.doesNotMatch(
    code,
    /currentUserId|currentViewer|cookies\(/,
    'POST /o must not read who is asking',
  );
  assert.doesNotMatch(code, /console\./, 'and must not log');
  assert.match(code, /allowOutboundOpen\(/, 'it is bounded by the existing visitor bucket');
  assert.match(code, /sameOrigin\(/, 'and Origin-checked, which a Route Handler is not given');
});

test('the removal tells the author, and the notice is not a second transport', () => {
  const admin = read(join(ROOT, 'lib/admin.ts'));
  assert.match(admin, /sendReviewRemoved/, 'the author is emailed the reason');
  assert.match(
    admin,
    /RECORD_REMOVAL_SQL[\s\S]{0,600}REMOVE_REVIEW_SQL/,
    'the reason is written BEFORE the review comes down; 0013\u2019s trigger requires it',
  );
  assert.doesNotMatch(admin, /(^|[^.\w])fetch\s*\(/, 'lib/admin.ts must not open a socket');

  // The Settings copy, which works whatever happens to the mail.
  const settings = read(join(ROOT, 'app/settings/page.tsx'));
  assert.match(settings, /myRemovals/, 'Settings must read the author\u2019s own removals');
  assert.match(settings, /Removing is not editing/, 'and say what a removal is');
  assert.match(settings, /\/contact/, 'and where to appeal');
});
