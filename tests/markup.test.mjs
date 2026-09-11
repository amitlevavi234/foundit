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
 * The one file allowed to open a socket, and the address it is allowed to open
 * it to. Everything below is written against this pair rather than against a
 * blanket ban, because Phase 3 needed exactly one outbound call and a rule with
 * no exception would have been deleted rather than narrowed.
 */
const EMBEDDINGS_FILE = 'lib/embeddings.ts';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

test('nothing on the server asks a stranger’s address for anything', () => {
  // One exception, named. Phase 3 embeds the sentence somebody typed, which is
  // a request to an address written out in full in one file; a tool's own URL
  // is still never fetched by us, and the tests below say so precisely.
  const fetchers = SOURCES.filter((path) => /(^|[^.\w])fetch\s*\(/.test(read(path))).map(rel);
  assert.deepEqual(
    fetchers,
    [EMBEDDINGS_FILE],
    `${EMBEDDINGS_FILE} is the only file that may make an outbound request`,
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

test('that one request goes to one hardcoded address and can go nowhere else', () => {
  const source = read(join(ROOT, 'lib', 'embeddings.ts'));

  // The constant is the literal address, written out, not assembled.
  assert.match(
    source,
    new RegExp(`export const EMBEDDINGS_URL = '${EMBEDDINGS_URL.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}';`),
    'EMBEDDINGS_URL must be the literal address and nothing else',
  );

  // The call site takes that identifier. Not a variable, not a parameter, not
  // a property of something somebody supplied.
  const calls = [...source.matchAll(/(^|[^.\w])fetch\s*\(\s*([^,\s)]+)/g)].map((m) => m[2]);
  assert.deepEqual(calls, ['EMBEDDINGS_URL'], 'fetch must be called with the constant');

  // No second address, anywhere in the file, in any form.
  const urls = [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, [EMBEDDINGS_URL], 'the file may contain exactly one URL');

  // And no URL assembled out of pieces: a template literal is how a hardcoded
  // address becomes a configurable one without anybody noticing.
  for (const literal of source.match(/`[^`]*`/g) ?? []) {
    assert.doesNotMatch(literal, /https?:|\/\/|\w+\.(com|net|org|io|ai)/i, `a template literal builds an address: ${literal}`);
  }
  assert.doesNotMatch(source, /process\.env\.\w*(URL|HOST|ENDPOINT|BASE)/i, 'the address is not read from the environment');
  assert.doesNotMatch(source, /new URL\(/, 'nothing here parses or builds a URL');
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

test('the key is read from one variable, and never written anywhere', () => {
  const source = read(join(ROOT, 'lib', 'embeddings.ts'));

  // One name, one read, and it is the name docs/development.md and .env.local
  // use. A second source for a secret is a second place to leak one from.
  assert.match(source, /const KEY_VARIABLE = 'EMBEDDINGS_API_KEY';/);
  const reads = [...source.matchAll(/process\.env\[?\.?([A-Za-z_$][\w$]*)\]?/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(reads)], ['KEY_VARIABLE'], 'the key has exactly one source');

  // No console call in this file may name the key or the thing it is put in.
  for (const call of source.match(/console\.\w+\([^)]*\)/g) ?? []) {
    assert.doesNotMatch(call, /key|Bearer|authorization/i, `a log line names the key: ${call}`);
  }

  // And the one place the key appears in a string is the Authorization header.
  const interpolations = (source.match(/`[^`]*\$\{key\}[^`]*`/g) ?? []).map((s) => s.trim());
  assert.deepEqual(interpolations, ['`Bearer ${key}`'], 'the key goes in a header and nowhere else');
});

test('no client component pulls the embedder — or the key — into a browser bundle', () => {
  // lib/embeddings.ts deliberately has no `server-only` import: eval/run.mjs
  // and scripts/embed.mjs are plain Node and import it directly, so the
  // harness measures the code that ships. This is what replaces that guard.
  const clients = SOURCES.filter((path) => /^\s*['"]use client['"]/m.test(read(path)));
  for (const path of clients) {
    assert.doesNotMatch(
      read(path),
      /from ['"](@\/lib\/embeddings|.*\/embeddings)['"]/,
      `${rel(path)} is a client component and must not import the embedder`,
    );
  }
  assert.ok(!/import ['"]server-only['"]/.test(read(join(ROOT, 'lib', 'embeddings.ts'))));
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
      /select\s+\*\s+from\s+public\.(tool_problems|query_embeddings)/i,
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
