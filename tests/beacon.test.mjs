// ===========================================================================
// The analytics beacon and the browser's Sentry DSN, rendered.
//
// THE PHASE 9a REVIEW'S F6. Both of these were `NEXT_PUBLIC_` variables, which
// Next inlines into the client bundle at `next build` time. The image is built
// in CI, where neither exists; `docs/launch-runbook.md` step 4d then told the
// operator to set the beacon token in `/root/.foundit/app.env` and redeploy,
// which sets it in the CONTAINER's environment — after the build, and to no
// effect. The review ran the image with both variables set at container start
// and found no beacon script tag, no DSN anywhere in the page, and the name
// `NEXT_PUBLIC_CF_BEACON_TOKEN` absent from `/app/.next` altogether: the
// branch had been dead-code-eliminated to `''`. `process.env` does not exist
// in a browser at all, so the browser half of Sentry was inert whatever the
// env file held.
//
// Nothing failed. Nothing logged. Cloudflare Web Analytics is this product's
// only field measurement of Core Web Vitals (docs/product-decisions.md §13)
// and there was no way to get one without changing the build pipeline.
//
// WHAT THIS TEST IS. The two tags are now rendered by a Server Component out
// of the environment AT REQUEST TIME, so the fix is testable without a build,
// a registry or a container: set the variable, render the component, read the
// markup. A render that reads `process.env` when it runs is exactly the
// property that was missing, and a `NEXT_PUBLIC_` variable could not pass
// this — the value would have been frozen before the test set it.
//
// Node strips TypeScript types but does not compile JSX, so this file compiles
// the component with the TypeScript the repository already has, the same way
// tests/card.test.mjs does.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = specifier;
    if (target.startsWith('@/')) target = new URL(target.slice(2), ROOT).href;

    const relative = target.startsWith('./') || target.startsWith('../') || target.startsWith('file:');
    if (relative && context.parentURL && !context.parentURL.startsWith('data:')) {
      for (const ext of ['', '.tsx', '.ts']) {
        const url = new URL(target + ext, context.parentURL);
        if (isFile(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.tsx')) {
      const path = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
        fileName: path,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { createElement } = await import('react');
const { default: ReactDOMServer } = await import('react-dom/server');
const { AnalyticsBeacon, SentryDsnMeta, beaconToken } = await import(
  '../components/AnalyticsBeacon.tsx'
);

const render = (component, props = {}) =>
  ReactDOMServer.renderToStaticMarkup(createElement(component, props));

/** Set some variables for the length of one call, then put them back. */
function withEnv(values, body) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return body();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef';
const NONCE = 'UHGQsg16RwcsFvLdo9s2NQ==';
const DSN = 'https://abc123@o42.ingest.de.sentry.io/1';

/* ---------------------------------------------------------------------------
 * The beacon
 * ------------------------------------------------------------------------ */

test('the beacon renders, with the request’s nonce, when the variable is set at run time', () => {
  const html = withEnv({ CF_BEACON_TOKEN: TOKEN }, () => render(AnalyticsBeacon, { nonce: NONCE }));

  assert.match(html, /<script\b/, 'no script tag at all — this is the F6 failure exactly');
  assert.ok(
    html.includes('src="https://static.cloudflareinsights.com/beacon.min.js"'),
    'the beacon must load from the host middleware.ts allows in script-src',
  );
  assert.ok(html.includes(`nonce="${NONCE}"`), 'without the nonce, strict-dynamic blocks it silently');
  assert.ok(html.includes(TOKEN), 'the site token must reach the tag');
  assert.match(html, /defer/, 'the beacon must not block the page it is measuring');

  // The variable was set for the duration of that render and nothing else, so
  // the value can only have been read while the component ran. That is the
  // whole property: a NEXT_PUBLIC_ variable is frozen at build time and could
  // not pass this test.
  assert.equal(beaconToken({}), '', 'the token is read from the environment handed in');
  assert.equal(beaconToken({ CF_BEACON_TOKEN: `  ${TOKEN}  ` }), TOKEN, 'and it is trimmed');
});

test('no token, no tag — which is this machine, and CI', () => {
  for (const value of [undefined, '', '   ']) {
    const html = withEnv({ CF_BEACON_TOKEN: value }, () =>
      render(AnalyticsBeacon, { nonce: NONCE }));
    assert.equal(html, '', `a beacon rendered with CF_BEACON_TOKEN=${JSON.stringify(value)}`);
  }
  // And no nonce means no tag either: an un-nonced script is one the browser
  // refuses, which is worse than none because nothing says so.
  const html = withEnv({ CF_BEACON_TOKEN: TOKEN }, () => render(AnalyticsBeacon, { nonce: '' }));
  assert.equal(html, '', 'a beacon rendered without a nonce would be refused silently');
});

/* ---------------------------------------------------------------------------
 * The browser's DSN
 * ------------------------------------------------------------------------ */

test('the browser’s DSN is rendered by the server, not inlined by the bundler', () => {
  const html = withEnv({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'production' }, () =>
    render(SentryDsnMeta));

  assert.ok(html.includes('name="sentry-dsn"'), 'the meta tag the client reads must be rendered');
  assert.ok(html.includes(`content="${DSN}"`), 'and it must carry the DSN');
  assert.ok(html.includes('data-environment="production"'), 'and which environment this is');

  // A DSN is public by design and this is the one value in app.env that may
  // appear in a page. Everything else must not, so the tag carries the DSN
  // and nothing else.
  assert.doesNotMatch(html, /DATABASE_URL|BETTER_AUTH_SECRET|RESEND|OPENAI/);
});

test('no DSN, no tag, and the client stays inert', () => {
  for (const value of [undefined, '', '   ']) {
    assert.equal(
      withEnv({ SENTRY_DSN: value }, () => render(SentryDsnMeta)),
      '',
      `a meta tag rendered with SENTRY_DSN=${JSON.stringify(value)}`,
    );
  }
});

/* ---------------------------------------------------------------------------
 * And the prefix is gone from the repository
 * ------------------------------------------------------------------------ */

test('nothing in this application is named NEXT_PUBLIC_ any more', () => {
  // The rule, not the instance. `NEXT_PUBLIC_` is a promise about a BUILD, and
  // this image is built once and run anywhere: every value it needs is read
  // from the environment at request time. A name with that prefix would either
  // be inert (F6) or force one image per deployment.
  for (const file of ['app/layout.tsx', 'instrumentation-client.ts', 'lib/sentry-scrub.ts',
    'components/AnalyticsBeacon.tsx', 'Dockerfile', '.github/workflows/release.yml',
    '.github/workflows/ci.yml', '.env.example', 'server/compose.prod.yml',
    'docs/launch-runbook.md', 'server/cloudflare/README.md']) {
    const source = read(file);
    // The Dockerfile and the two components explain at length why the prefix
    // is not used; the prohibition is on a NAME, which is the prefix followed
    // by an identifier character.
    const uses = [...source.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0]);
    const declared = uses.filter((name) => new RegExp(
      `(?:process\\.env\\.${name}|env\\.${name}|^\\s*(?:ARG|ENV)\\s+${name}|^${name}=)`,
      'm',
    ).test(source));
    assert.deepEqual(
      declared,
      [],
      `${file} still reads or sets ${declared.join(', ')} — a build-time value on a host that `
        + 'sets it at run time is the F6 failure',
    );
  }

  // And the client entry point does not touch `process.env` at all, because in
  // a browser there is no such object.
  const client = read('instrumentation-client.ts').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(
    client,
    /process\.env/,
    'instrumentation-client.ts runs in a browser, where process.env does not exist',
  );
  assert.match(
    client,
    /meta\[name="sentry-dsn"\]/,
    'the browser must read the DSN the server rendered for it',
  );
});
