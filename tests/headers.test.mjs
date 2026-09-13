// ===========================================================================
// The security headers, on a production build, checked one by one.
//
// research/03 §9 item 38 (four headers) and item 25 (the CSP's shape), plus
// the one header research/10 §5.2's Caddyfile adds that item 38 leaves out.
// The values live in middleware.ts; this file is the regression test that
// stops one of them being dropped by a later edit to a matcher.
//
// TWO HALVES, and the split is deliberate:
//
//   the SOURCE half   reads middleware.ts and asserts the directives and the
//                     header list are what they are. It runs everywhere, with
//                     no server, no database and no browser, so a deleted
//                     directive fails `npm test` on a laptop.
//
//   the LIVE half     asks a running server and reads what came back. It is
//                     what proves the middleware matcher actually covers the
//                     route, which the source half cannot see. It skips,
//                     loudly, when nothing is answering.
//
// A NOTE ON WHERE THESE ARE SET. research/10 §5.2 sets them in a Caddyfile.
// There is no Caddy on this host (docs/product-decisions.md §13): Cloudflare
// terminates TLS at the edge and `cloudflared` connects to 127.0.0.1:3000, so
// there is no proxy on the machine to set a header in. They are set by the
// application, which is also where research/10 itself says a CSP belongs.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const MIDDLEWARE = readFileSync(join(ROOT, 'middleware.ts'), 'utf8');

/**
 * The array of directives inside `policy()`, and nothing else in the file.
 *
 * NOT "the file with its comments stripped", which is what this was first and
 * which was wrong twice over. middleware.ts explains at length why
 * `'unsafe-inline'` is not in `script-src`, so a naive read finds the word in
 * the sentence forbidding it — and a comment stripper that removes `/* … *\/`
 * eats `https://*.ingest.sentry.io`, because `//*` opens a block comment as
 * far as a regular expression is concerned. Reading the one expression that
 * becomes the header is both narrower and exact.
 */
const DIRECTIVES = (() => {
  const body = /return \[([\s\S]*?)\]\.join\('; '\);/.exec(MIDDLEWARE);
  assert.ok(body, 'middleware.ts no longer builds the policy as one array — this file must follow');
  return body[1];
})();

/** The three external hosts, read from their own declarations. */
const HOST_CONSTANTS = MIDDLEWARE.slice(
  MIDDLEWARE.indexOf('const SENTRY_INGEST'),
  MIDDLEWARE.indexOf('function policy'),
);

/**
 * Header name -> the exact value, or a predicate over it.
 *
 * `Strict-Transport-Security` is two years WITH `preload`, which is stronger
 * than the Caddyfile in research/10 §5.2 ("add `preload` only once you are
 * certain about every subdomain"). We are certain: `foundit.tools` and
 * `www.foundit.tools` are the only names and both are the same tunnel
 * (server/setup/08-tunnel.sh). 63072000 is the two years the preload list
 * requires as a minimum.
 */
const REQUIRED = [
  ['strict-transport-security', 'max-age=63072000; includeSubDomains; preload'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['cross-origin-opener-policy', 'same-origin'],
];

/** Every one of these must be denied by Permissions-Policy. */
const DENIED_FEATURES = ['camera', 'microphone', 'geolocation'];

/**
 * The CSP directives item 25 names, plus the ones this product adds.
 *
 * `connect-src` is checked separately below, because its value is a list of
 * hosts rather than a constant.
 */
const REQUIRED_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "default-src 'self'",
  "img-src 'self' data:",
];

/* ---------------------------------------------------------------------------
 * The source half
 * ------------------------------------------------------------------------ */

test('middleware.ts sets every header research/03 §9 item 38 asks for', () => {
  for (const [name, value] of REQUIRED) {
    const expected = name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');
    assert.ok(
      MIDDLEWARE.includes(`'${expected}'`) || MIDDLEWARE.includes(`'${name}'`),
      `middleware.ts does not set ${expected}`,
    );
    assert.ok(MIDDLEWARE.includes(value), `middleware.ts does not set ${expected} to "${value}"`);
  }
  for (const feature of DENIED_FEATURES) {
    assert.match(
      MIDDLEWARE,
      new RegExp(`${feature}=\\(\\)`),
      `Permissions-Policy must deny ${feature} with ${feature}=()`,
    );
  }
});

test('the policy has the shape item 25 asks for, and no unsafe-inline in script-src', () => {
  for (const directive of REQUIRED_DIRECTIVES) {
    assert.ok(DIRECTIVES.includes(directive), `the CSP is missing: ${directive}`);
  }

  // THE ONE THAT MATTERS. `'unsafe-inline'` in `script-src` removes most of
  // the benefit of having a policy at all (research/03 §6.2 says so in those
  // words), and it is the thing every "make the CSP work" snippet on the
  // internet adds. `style-src` may have it and does; an injected `<style>`
  // cannot call `fetch` or read a cookie, and a nonce cannot be attached to a
  // style ATTRIBUTE, which React writes.
  const scriptSrc = /script-src[^`\n]*/.exec(DIRECTIVES)?.[0] ?? '';
  assert.ok(scriptSrc.includes('nonce-'), 'script-src must carry a per-request nonce');
  assert.ok(scriptSrc.includes("'strict-dynamic'"), "script-src must carry 'strict-dynamic'");
  assert.doesNotMatch(scriptSrc, /unsafe-inline/, "script-src must never carry 'unsafe-inline'");
  assert.doesNotMatch(scriptSrc, /unsafe-eval/, "script-src must never carry 'unsafe-eval'");

  // The nonce is random per request, not derived from anything about the
  // request. A nonce that is a hash of the path is a constant.
  assert.match(
    MIDDLEWARE,
    /crypto\.getRandomValues\(/,
    'the nonce must come from a random source, not from anything about the request',
  );
});

/**
 * Every external host the policy is allowed to name, and the directive each
 * may appear in. Anything else is a finding, in the source and on the wire.
 *
 * The same rule tests/markup.test.mjs applies to the three files that may open
 * a socket, applied to the file that decides which sockets a BROWSER may open.
 */
const ALLOWED_HOSTS = new Set([
  'https://*.ingest.sentry.io',
  'https://*.ingest.de.sentry.io',
  'https://*.ingest.us.sentry.io',
  'https://static.cloudflareinsights.com',
  'https://cloudflareinsights.com',
]);

test('connect-src names only this origin, Sentry and the analytics beacon', () => {
  const connect = /connect-src[^`\n]*/.exec(DIRECTIVES)?.[0] ?? '';
  assert.ok(connect.includes("'self'"), 'connect-src must allow this origin');
  assert.ok(connect.includes('SENTRY_INGEST'), 'connect-src must allow Sentry’s ingest host');
  assert.ok(
    connect.includes('ANALYTICS_BEACON_HOST'),
    'connect-src must allow the analytics beacon',
  );

  // And the constants those names refer to hold the hosts we mean, and only
  // those. `HOST_CONSTANTS` is the declaration block, not the whole file, so
  // an address named in a paragraph of prose is not mistaken for one in the
  // policy.
  const named = [...HOST_CONSTANTS.matchAll(/https:\/\/[A-Za-z0-9.*-]+/g)].map((m) => m[0]);
  assert.ok(named.length >= 5, 'the host constants have gone missing from middleware.ts');
  const extra = [...new Set(named)].filter((host) => !ALLOWED_HOSTS.has(host));
  assert.deepEqual(extra, [], `middleware.ts names a host nobody decided on: ${extra.join(', ')}`);
  for (const wanted of ['https://*.ingest.sentry.io', 'https://static.cloudflareinsights.com']) {
    assert.ok(named.includes(wanted), `middleware.ts no longer names ${wanted}`);
  }
});

test('the policy on the wire names no host nobody decided on', async (t) => {
  // The source check above can be right about a file the matcher never runs.
  // This one reads the header a browser would be handed.
  const origin = baseUrl();
  const response = origin ? await head(origin, '/') : null;
  if (!response) { t.skip('no server answering.'); return; }

  const csp = response.headers.get('content-security-policy') ?? '';
  const hosts = [...csp.matchAll(/https?:\/\/[A-Za-z0-9.*-]+/g)].map((m) => m[0]);
  const extra = [...new Set(hosts)].filter((host) => !ALLOWED_HOSTS.has(host));
  assert.deepEqual(extra, [], `the live policy allows: ${extra.join(', ')}`);

  // And no directive is a bare wildcard, which would allow everything while
  // looking like a policy.
  for (const directive of csp.split(';').map((d) => d.trim())) {
    assert.ok(
      !/^\S+\s+\*$/.test(directive),
      `the live policy has a wildcard directive: ${directive}`,
    );
  }
  t.diagnostic(`the live policy allows ${new Set(hosts).size} external host(s)`);
});

test('the matcher covers the pages and not the immutable assets', () => {
  const matcher = /matcher:\s*\[([^\]]*)\]/.exec(MIDDLEWARE)?.[1] ?? '';
  assert.ok(matcher.includes('_next/static'), 'the matcher must exclude _next/static');
  assert.ok(matcher.includes('_next/image'), 'the matcher must exclude _next/image');
  // A negative lookahead, so everything NOT named is covered. A matcher that
  // listed the routes by hand is a matcher that forgets the next one.
  assert.match(matcher, /\(\?!/, 'the matcher must be an exclusion, not a list of routes');
});

test('no X-Robots-Tag is set for every route, because the private ones are private', () => {
  // THE PHASE 9a REVIEW'S F16. `middleware.ts` added
  // `['X-Robots-Tag', 'index, follow']` to every response its matcher covers,
  // which is every page — so the origin was telling crawlers to index /admin,
  // /saved, /results?q=<what somebody typed> and /c/<token>, the share link
  // whose own page sets `robots: { index: false, follow: false }` and whose
  // header says "a link somebody sent to one person is not a page a search
  // engine should be able to hand to everybody".
  //
  // A header set once for every route cannot know which pages are private.
  // Page metadata can and does.
  //
  // The HEADERS array and not the whole file: middleware.ts explains at length
  // why this header is not there, and a naive grep finds the word in the
  // paragraph forbidding it — the same trap `DIRECTIVES` above exists for.
  assert.ok(
    !MIDDLEWARE_HEADERS.some(([name]) => /^x-robots-tag$/i.test(name)),
    'middleware.ts must not set X-Robots-Tag: it cannot tell a private page from a public one',
  );
  const layout = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8');
  assert.match(
    layout,
    /robots: \{ index: true, follow: true \}/,
    'the default must be metadata on the root layout, which a page can override',
  );
  const share = readFileSync(join(ROOT, 'app', 'c', '[token]', 'page.tsx'), 'utf8');
  assert.match(
    share,
    /robots: \{ index: false, follow: false \}/,
    'the share page must still say noindex, which is what F16 was about',
  );
});

/* ---------------------------------------------------------------------------
 * The paths middleware skips — the Phase 9a review's F24
 * ------------------------------------------------------------------------ */

const CONFIG = readFileSync(join(ROOT, 'next.config.mjs'), 'utf8');

/** The `HEADERS` array in middleware.ts, as pairs. */
const MIDDLEWARE_HEADERS = (() => {
  const block = /const HEADERS: ReadonlyArray<readonly \[string, string\]> = \[([\s\S]*?)\n\];/
    .exec(MIDDLEWARE);
  assert.ok(block, 'middleware.ts no longer declares HEADERS as one array');
  return [...block[1].matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
})();

/** The `headers()` block, as pairs. */
const STATIC_HEADERS = (() => {
  const block = /async headers\(\)[\s\S]*?\n  \},/.exec(CONFIG);
  assert.ok(block, 'next.config.mjs no longer has a headers() block — F24 has been undone');
  return [...block[0].matchAll(/key: '([^']+)',\s+value: '([^']+)'/g)].map((m) => [m[1], m[2]]);
})();

test('the static paths get every header that does not vary per request', () => {
  // Not a hand-written list. The middleware's own array is the authority, and
  // the two that vary — the nonce and the policy that carries it — are the
  // two that must NOT be here, which is why `headers()` in next.config.mjs
  // could never have held the CSP.
  assert.ok(MIDDLEWARE_HEADERS.length >= 6, 'middleware.ts has lost a header');
  assert.deepEqual(
    STATIC_HEADERS,
    MIDDLEWARE_HEADERS,
    'next.config.mjs and middleware.ts disagree about the headers a response carries — '
      + 'a chunk and a page must not be protected differently',
  );

  // And the nonce-bearing pair is absent, or every asset response would vary.
  const block = /async headers\(\)[\s\S]*?\n  \},/.exec(CONFIG)[0];
  assert.doesNotMatch(block, /Content-Security-Policy/i, 'the CSP carries a nonce and cannot be static');
  assert.doesNotMatch(block, /x-nonce/i, 'the nonce is per request');

  // The source it covers is the middleware matcher's exclusion list, or one
  // of them is protected by neither.
  const matcher = /matcher:\s*\[([^\]]*)\]/.exec(MIDDLEWARE)?.[1] ?? '';
  for (const path of ['_next/static', '_next/image', 'favicon.ico', 'icon.svg', 'apple-icon.png']) {
    assert.ok(matcher.includes(path), `the matcher no longer excludes ${path}`);
    assert.ok(
      block.includes(path),
      `${path} is excluded from middleware and not covered by next.config.mjs headers()`,
    );
  }
});

test('a real chunk comes back with them, off a running server', async (t) => {
  // THE HALF THAT PROVES THE SOURCE. `curl -sI` on a chunk used to return a
  // `Cache-Control` and nothing else, and no test looked: the live half of
  // this file checked `/`, `/healthz` and `/o` only.
  const origin = baseUrl();
  const page = origin ? await head(origin, '/') : null;
  if (!page) { t.skip('no server answering.'); return; }

  const html = await page.text();
  const chunk = /\/_next\/static\/[^"']+\.js/.exec(html)?.[0];
  assert.ok(chunk, 'the home page references no chunk under /_next/static — cannot test F24');

  const asset = await head(origin, chunk);
  assert.ok(asset, `${chunk} did not answer`);
  assert.equal(asset.status, 200, `${chunk} answered ${asset.status}`);

  for (const [name, value] of STATIC_HEADERS) {
    assert.equal(
      asset.headers.get(name.toLowerCase()),
      value,
      `${chunk} came back without ${name} — the static paths are unprotected again`,
    );
  }
  // And it is still cacheable for ever, which is the reason the matcher skips
  // it in the first place.
  assert.match(
    asset.headers.get('cache-control') ?? '',
    /immutable/,
    'the chunk stopped being immutable, which is a cache regression',
  );
  t.diagnostic(`${chunk}: ${STATIC_HEADERS.length} header(s) present, still immutable`);
});

/* ---------------------------------------------------------------------------
 * The live half
 * ------------------------------------------------------------------------ */

function baseUrl() {
  const raw = process.env.FOUNDIT_BASE_URL ?? process.env.BETTER_AUTH_URL ?? '';
  if (raw.trim() === '') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

async function head(origin, path) {
  try {
    return await fetch(`${origin}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return null;
  }
}

test('a running server sends every one of them, on a page and on a route handler', async (t) => {
  const origin = baseUrl();
  const response = origin ? await head(origin, '/') : null;
  if (!response) {
    t.skip(
      `no server answering at ${origin ?? '(no BETTER_AUTH_URL)'}. The source half above still `
        + 'ran. Start one with `npm run build && npm start`.',
    );
    return;
  }

  for (const [name, value] of REQUIRED) {
    assert.equal(response.headers.get(name), value, `GET / did not send ${name} correctly`);
  }

  const permissions = response.headers.get('permissions-policy') ?? '';
  for (const feature of DENIED_FEATURES) {
    assert.match(permissions, new RegExp(`${feature}=\\(\\)`), `${feature} is not denied`);
  }

  const csp = response.headers.get('content-security-policy') ?? '';
  assert.ok(csp !== '', 'GET / sent no Content-Security-Policy');
  assert.doesNotMatch(
    csp.split('script-src')[1]?.split(';')[0] ?? '',
    /unsafe-inline|unsafe-eval/,
    'the live script-src carries unsafe-inline or unsafe-eval',
  );
  assert.match(csp, /'nonce-[A-Za-z0-9+/=]+'/, 'the live policy carries no nonce');
  for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(directive), `the live policy is missing: ${directive}`);
  }

  // Report-Only would make every assertion above true and none of them mean
  // anything.
  assert.equal(
    response.headers.get('content-security-policy-report-only'),
    null,
    'the policy is being sent as report-only, which enforces nothing',
  );

  // And the same on a Route Handler, because a matcher that only covered
  // pages would be a matcher that stopped covering /o and /healthz the day
  // somebody tidied it.
  for (const path of ['/healthz', '/o']) {
    const other = await head(origin, path);
    assert.ok(other, `${path} did not answer`);
    assert.equal(
      other.headers.get('x-content-type-options'),
      'nosniff',
      `${path} got none of the security headers — the matcher does not cover it`,
    );
  }

  // Version and stack are free reconnaissance (next.config.mjs says so).
  assert.equal(response.headers.get('x-powered-by'), null, 'X-Powered-By is being sent');

  // And no X-Robots-Tag on the wire either, on a public page or a private one
  // (F16). `/c/<token>` is the one that mattered: its page sets `noindex` and
  // the header said `index, follow` over the top of it.
  for (const path of ['/', '/admin', '/saved', '/c/not-a-real-share-token']) {
    const other = await head(origin, path);
    assert.ok(other, `${path} did not answer`);
    assert.equal(
      other.headers.get('x-robots-tag'),
      null,
      `${path} is telling crawlers what to do from a header that cannot tell it apart from /about`,
    );
  }

  t.diagnostic(`checked against ${origin}`);
});

test('the health check is never cached', async (t) => {
  const origin = baseUrl();
  const response = origin ? await head(origin, '/healthz') : null;
  if (!response) { t.skip('no server answering.'); return; }

  const cache = response.headers.get('cache-control') ?? '';
  assert.match(cache, /no-store/, '/healthz must be no-store, or a probe reads a cached answer');
});
