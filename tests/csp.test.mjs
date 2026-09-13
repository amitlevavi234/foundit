// ===========================================================================
// Every route, loaded in a real browser, with the Content-Security-Policy
// enforced — and nothing refused.
//
// WHY A BROWSER. A CSP is not a header, it is a thing a browser does with a
// header. `curl -I` proves the policy is SENT (tests/headers.test.mjs does
// that, and it runs everywhere with no Chrome). Only a browser proves the
// policy is SURVIVABLE: that every inline script Next emits carries the
// request's nonce, that `'strict-dynamic'` does not cut the chunk loader off
// from its own chunks, and that no page in the site has an inline `<script>`
// somebody added without one.
//
// The failure this exists to catch is silent in exactly the way that matters:
// a blocked script does not 500, does not log, and does not change the status
// code. The page renders its server HTML and nothing on it works.
//
// HOW IT WALKS. The route table is read from `app/` the way Next reads it —
// the same `routeTable()` shape tests/links.test.mjs uses — so a page added
// tomorrow is walked tomorrow. Dynamic segments are filled from the seeded
// development catalogue; a route whose segment has no honest value is walked
// at a value that resolves to the not-found page, which is still a page with a
// layout, a header and a footer, and is therefore still worth checking.
//
// IT SKIPS, LOUDLY, when there is no server or no Chrome — the same rule
// tests/links.test.mjs follows, for the same reason.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { chromeAvailable, openBrowser, refusalFor, serverKind } from './browser.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const rel = (path) => path.slice(ROOT.length).replace(/\\/g, '/').replace(/^\/+/, '');

/**
 * Concrete values for the dynamic segments, from db/seed.
 *
 * `receiptly` and `tabsplit` are seeded listings; the other two are values
 * that deliberately resolve to nothing, because "the not-found page under a
 * strict CSP" is a page this test should cover and there is no honest way to
 * mint a real share token or a real handle here.
 */
const SEGMENT_VALUES = {
  slug: 'receiptly',
  handle: 'nobody-here',
  token: 'not-a-real-share-token',
  collection: 'saved',
};

/** Every page route `app/` defines, as a concrete path a browser can be sent to. */
function routePaths() {
  const paths = [];
  for (const file of walk(join(ROOT, 'app'))) {
    const parts = rel(file).split('/');
    const name = parts.pop();
    // `page.tsx` only. A `route.ts` answers JSON or 204 and has no document
    // for a policy to apply to.
    if (!/^page\.(tsx?|jsx?|mjs)$/.test(name)) continue;

    const segments = parts
      .slice(1)
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
      .filter((s) => !s.startsWith('@'));

    let skip = false;
    const concrete = segments.map((segment) => {
      const dynamic = /^\[+\.{0,3}([^\]]+)\]+$/.exec(segment);
      if (!dynamic) return segment;
      const value = SEGMENT_VALUES[dynamic[1]];
      if (value === undefined) skip = true;
      return value;
    });
    if (skip) continue;

    paths.push(`/${concrete.join('/')}`);
  }
  return [...new Set(paths)].sort();
}

/** Pages with a query string that turns them into the screen people see. */
const WITH_QUERY = [
  // The one page whose URL carries what somebody typed, which makes it the one
  // page where a CSP failure and a privacy failure could be the same bug.
  '/results?q=' + encodeURIComponent('my receipts are a mess at tax time'),
  '/sign-in?next=%2Fsaved&intent=save',
];

function baseUrl() {
  const raw = process.env.FOUNDIT_BASE_URL ?? process.env.BETTER_AUTH_URL ?? '';
  if (raw.trim() === '') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

async function reachable(origin) {
  try {
    const response = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * No server, skip. A server that is not a production build, REFUSE.
 *
 * THE PHASE 9a REVIEW'S F15, and the difference between the two answers is the
 * point. "Nothing is answering" is a fact about the machine and a skip is
 * honest; "a `next dev` server is answering" is a fact about what is being
 * measured, and walking it produced five reproducible failures and eight and a
 * half minutes of CDP timeouts that read as a broken CSP rather than as the
 * wrong server. tests/browser.mjs has the full account.
 *
 * Returns true when the caller should go on.
 */
async function usable(t, origin) {
  if (!origin || !(await reachable(origin))) {
    t.skip(
      `no server answering at ${origin ?? '(no BETTER_AUTH_URL)'}. Start one with `
        + '`npm run build && npm start` and run this again.',
    );
    return false;
  }
  const kind = await serverKind(origin);
  if (kind !== 'production') assert.fail(refusalFor(origin, kind));
  return true;
}

test('the route tree has routes in it at all', () => {
  const paths = routePaths();
  assert.ok(paths.length >= 30, `only ${paths.length} routes found under app/ — the walk is broken`);
  assert.ok(paths.includes('/'), 'the home page is not in the route table');
  assert.ok(paths.includes('/results'), '/results is not in the route table');
  assert.ok(paths.includes('/admin'), '/admin is not in the route table');
});

test('every route loads with the CSP enforced, and nothing is refused', async (t) => {
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;
  if (!(await chromeAvailable())) {
    t.skip(
      'no Chrome on this machine, so the policy could not be enforced by anything. '
        + 'tests/headers.test.mjs still checked that it is sent.',
    );
    return;
  }

  const paths = [...routePaths(), ...WITH_QUERY];
  const browser = await openBrowser();
  const offenders = [];

  try {
    for (const path of paths) {
      await browser.goto(`${origin}${path}`);
      const { violations, errors } = await browser.report();

      // A violation is a violation whatever it blocked. There is no allow-list
      // here on purpose: the moment one exists, the next page's real failure
      // goes in it.
      for (const v of violations) {
        offenders.push(`${path}  ${v.directive} blocked ${v.blocked || v.sample || '(inline)'}`);
      }

      // And the second half, because a CSP failure does not always fire the
      // event: a chunk that never loads shows up as a script error instead.
      for (const message of errors) {
        if (/Content Security Policy|Refused to (execute|load|connect|apply)/i.test(message)) {
          offenders.push(`${path}  ${message}`);
        }
      }
      t.diagnostic(`${path}: ${violations.length} violation(s)`);
    }
  } finally {
    await browser.close();
  }

  assert.deepEqual(offenders, [], `the CSP refused something on:\n  ${offenders.join('\n  ')}`);
});

test('the page actually hydrated, so "no violations" is not "no scripts"', async (t) => {
  // THE TEST ABOVE PASSES TRIVIALLY IF NOTHING RUNS. A policy that blocks
  // every script raises one violation per script; a build that ships no
  // script at all raises none, and would read as a pass. So: load the one page
  // with real client components on it and ask the page whether React is
  // running.
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;
  if (!(await chromeAvailable())) { t.skip('no Chrome on this machine.'); return; }

  const browser = await openBrowser();
  try {
    await browser.goto(`${origin}/tools/receiptly`);
    const hydrated = await browser.evaluate(
      // Next sets this on the document element once the client bootstrap has
      // run. `__next_f` is the streaming payload the bootstrap consumes; if
      // scripts were blocked it is undefined.
      'JSON.stringify({ payload: Array.isArray(self.__next_f), '
        + 'scripts: document.scripts.length, '
        + 'nonced: Array.from(document.scripts).filter(s => s.nonce || s.getAttribute("nonce")).length })',
    );
    const state = JSON.parse(hydrated);
    assert.ok(state.scripts > 0, 'the page shipped no scripts at all, so the walk proved nothing');
    assert.ok(
      state.payload,
      'self.__next_f is not an array: the client bootstrap did not run, so every page in the '
        + 'walk above was a static shell and the CSP was never really exercised',
    );
    t.diagnostic(`/tools/receiptly: ${state.scripts} script tag(s), bootstrap ran`);
  } finally {
    await browser.close();
  }
});

test('the browser is really enforcing it: a call to another origin is refused', async (t) => {
  // THE CONTROL. Everything above proves the site is unharmed by the policy.
  // This proves the policy is THERE. Without a control, a header a browser
  // silently ignored — a typo in a directive name, a policy accidentally sent
  // as `Content-Security-Policy-Report-Only` — would read as a clean pass on
  // every route in the walk.
  //
  // IT TESTS `connect-src` AND NOT `script-src`, and the reason is
  // `'strict-dynamic'` itself. Under `strict-dynamic` a script element created
  // and appended BY AN ALREADY-TRUSTED SCRIPT is allowed to run — that is the
  // whole mechanism, and it is why Next's chunk loader works. So "create a
  // script element and see if it runs" tests nothing: it is supposed to run.
  // `connect-src` has no such propagation. A `fetch` to an origin that is not
  // on the list is refused however trusted the caller is, which makes it the
  // honest question to ask.
  //
  // The address is `example.com`, which is reserved by the IANA for exactly
  // this and is never reached: the browser refuses before a socket is opened.
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;
  if (!(await chromeAvailable())) { t.skip('no Chrome on this machine.'); return; }

  const browser = await openBrowser();
  try {
    await browser.goto(`${origin}/about`);
    const outcome = await browser.evaluate(
      "fetch('https://example.com/').then(() => 'allowed').catch(() => 'refused')",
    );
    assert.equal(
      outcome,
      'refused',
      'a fetch to https://example.com/ was ALLOWED from a page of this site — '
        + 'connect-src is not being enforced, so nothing the walk above proved is worth anything',
    );

    const { violations } = await browser.report();
    assert.ok(
      violations.some((v) => String(v.directive).startsWith('connect-src')),
      'the fetch failed but raised no connect-src violation, which means something other than '
        + 'the policy stopped it',
    );

    // And an image from somewhere else, for the second directive that has no
    // `strict-dynamic` escape hatch.
    await browser.evaluate(
      "(function(){var i=new Image();i.src='https://example.com/pixel.png';})()",
    );
    await new Promise((resolve) => { const timer = setTimeout(resolve, 600); timer.unref?.(); });
    const after = await browser.report();
    assert.ok(
      after.violations.some((v) => String(v.directive).startsWith('img-src')),
      'a remote image was not refused — img-src is not being enforced',
    );
  } finally {
    await browser.close();
  }
});

test('every script tag the server renders carries the nonce, and the nonce is per request', async (t) => {
  // THE OTHER HALF OF THE CONTROL, and it needs no browser.
  //
  // Under `'strict-dynamic'` a PARSER-INSERTED script — one that came down in
  // the HTML — runs only if it carries the nonce, whether it is inline or has
  // a `src`. So this reads the HTML the server actually sent and insists that
  // every `<script` in it has one, and that the one it has is the one the
  // response's own CSP header names. That is the assertion that fails the day
  // somebody adds an inline `<script>` to a component without a nonce: the
  // browser walk would only catch it on the page that renders it, and this
  // catches it in the served bytes of every page it is on.
  const origin = baseUrl();
  if (!(await usable(t, origin))) return;

  const nonces = [];
  for (const path of ['/', '/about', '/tools/receiptly']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    const csp = response.headers.get('content-security-policy') ?? '';
    const html = await response.text();

    const declared = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
    assert.ok(declared, `${path}: the CSP header carries no nonce`);
    nonces.push(declared);

    const tags = html.match(/<script\b[^>]*>/g) ?? [];
    assert.ok(tags.length > 0, `${path}: no script tags at all, so this proves nothing`);
    const bare = tags.filter((tag) => !tag.includes(`nonce="${declared}"`));
    assert.deepEqual(
      bare,
      [],
      `${path}: ${bare.length} script tag(s) came down without this response's nonce:\n  `
        + bare.map((t) => t.slice(0, 160)).join('\n  '),
    );
  }

  assert.equal(
    new Set(nonces).size,
    nonces.length,
    'the same nonce was served on more than one response — it is not per request, and a '
      + 'reusable nonce is an allow-list of one string that an attacker only has to read once',
  );
});
