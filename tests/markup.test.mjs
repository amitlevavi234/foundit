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

test('nothing on the server asks a stranger’s address for anything', () => {
  const fetchers = SOURCES.filter((path) => /(^|[^.\w])fetch\s*\(/.test(read(path))).map(rel);
  assert.deepEqual(fetchers, [], 'no server-side fetch anywhere in the application');

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
