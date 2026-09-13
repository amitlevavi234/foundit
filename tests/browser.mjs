// ===========================================================================
// A headless browser, with no browser-automation dependency.
//
// WHY THIS FILE EXISTS. Two of Phase 9a's gate items can only be answered by a
// real browser parsing a real Content-Security-Policy: "every page still
// renders with the CSP on" (item 6) and the Core Web Vitals table (item 5). A
// `fetch` cannot answer either — it does not execute script, does not enforce
// a policy, and has no layout.
//
// WHY NOT PUPPETEER OR PLAYWRIGHT. Each is a hundred-odd transitive packages
// and a second copy of Chromium downloaded at install time, in a repository
// that has seven runtime dependencies and counts them. Chrome is already on
// this machine, `chrome-launcher` (a dev dependency, and the same one
// `lighthouse` already pulls in) finds and starts it, and everything below is
// the Chrome DevTools Protocol over the WebSocket that Node has had a global
// for since v22. It is about two hundred lines and it does exactly two things.
//
// IT IS NOT A `.test.mjs` FILE, so `node --test tests/*.test.mjs` does not run
// it as a suite. It is imported by tests/csp.test.mjs and by scripts/vitals.mjs.
//
// EVERY TEST THAT USES IT SKIPS RATHER THAN FAILS when Chrome is absent, in
// the same way tests/links.test.mjs skips when no server is answering — and
// says so out loud, because a skip that looks like a pass is the failure this
// repository's test suite is built to avoid.
// ===========================================================================
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ---------------------------------------------------------------------------
 * WHICH SERVER IS ANSWERING — the Phase 9a review's F15
 *
 * `tests/csp.test.mjs` and `tests/links.test.mjs` resolve their base URL from
 * `FOUNDIT_BASE_URL ?? BETTER_AUTH_URL`, and `.env.local`'s BETTER_AUTH_URL is
 * `http://localhost:3000` — which is the `next dev` server this project runs
 * all day. Neither file checked what kind of server that was. They walked it,
 * `Page.navigate` exceeded the 30-second CDP timeout on a cold compile, and
 * the gate command in docs/loop-progress.md's own arrangement failed five
 * tests, reproducibly, in eight and a half minutes. `docs/launch-checklist.md`
 * G2 then pasted the PASSING result with no note that it needs
 * `npm run build && npm start` first.
 *
 * A DEV SERVER IS NOT A SLOW PRODUCTION SERVER, which is why raising the
 * timeout would have been the wrong fix. `next dev` compiles a route on first
 * request, ships an unminified bundle with the React refresh runtime in it, and
 * has a script inventory that is not the one that ships — so a CSP walk over it
 * proves something about a build nobody will ever run. The tests refuse, in one
 * sentence, and say what to do.
 *
 * HOW IT TELLS. Production emits content-hashed chunk names
 * (`/_next/static/chunks/main-app-8815dcbdb4d85f07.js`); development emits
 * unhashed ones with a cache-busting query (`…/main-app.js?v=1757…`). Reading
 * the HTML the server actually sent is the only signal that is about the BUILD
 * rather than about the machine.
 * ------------------------------------------------------------------------ */

/**
 * `production`, `development`, or `unknown` when nothing answered.
 *
 * Never throws: a helper that takes a test file down while deciding whether to
 * run it is worse than the thing it is checking for.
 */
export async function serverKind(origin) {
  let html;
  try {
    const response = await fetch(origin, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    html = await response.text();
  } catch {
    return 'unknown';
  }

  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"'\s]+/g)].map((m) => m[0]);
  if (chunks.length === 0) return 'unknown';
  // A cache-busting query on a chunk is `next dev` and nothing else.
  if (chunks.some((src) => src.includes('?v='))) return 'development';
  if (chunks.some((src) => /-[0-9a-f]{8,}\.js/.test(src))) return 'production';
  return 'development';
}

/** The one sentence a browser test refuses with. */
export function refusalFor(origin, kind) {
  return `${origin} is a ${kind === 'development' ? '`next dev`' : 'unrecognised'} server. `
    + 'These tests only mean something against a production build — `next dev` compiles a route '
    + 'on its first request and ships a script inventory that is not the one that ships — so '
    + 'they refuse rather than time out. Run `npm run build && npm start`, or point '
    + 'FOUNDIT_BASE_URL at a server that is one.';
}

/** Is there a Chrome on this machine at all? */
export async function chromeAvailable() {
  try {
    const { Launcher } = await import('chrome-launcher');
    return Launcher.getFirstInstallation() !== undefined;
  } catch {
    return false;
  }
}

/**
 * One CDP connection to one page, with the handful of methods we need.
 *
 * `--headless=new` is the real renderer rather than the old headless shell, so
 * what it enforces about a CSP is what a visitor's browser enforces.
 */
export async function openBrowser({ timeoutMs = 30_000 } = {}) {
  const { launch } = await import('chrome-launcher');
  const profile = mkdtempSync(join(tmpdir(), 'foundit-chrome-'));

  const chrome = await launch({
    chromeFlags: [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      // Deliberately NOT --disable-web-security and NOT
      // --allow-running-insecure-content. The whole point is that the browser
      // is enforcing.
      '--hide-scrollbars',
      '--mute-audio',
      `--user-data-dir=${profile}`,
    ],
    logLevel: 'silent',
  });

  /** A fresh tab, and the WebSocket that drives it. */
  const target = await (
    await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: 'PUT' })
  ).json();

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  /** Every event the page has raised since the last `drain()`. */
  let events = [];

  // A LISTENER THAT DOES NOTHING, AND IS NOT DECORATION. Chrome is killed at
  // the end of every run, and a WebSocket whose far end goes away raises an
  // `error` event; with no listener attached that surfaces as an unhandled
  // rejection AFTER the tests have finished, which the runner reports as a
  // failure of the whole FILE, with no message and no failing assertion in it.
  // The connection is EXPECTED to break — that is what `close()` does to it —
  // so the event is caught and dropped.
  socket.addEventListener('error', () => {});
  socket.addEventListener('close', () => {
    // Anything still waiting will never be answered. Reject it now, with a
    // sentence, rather than leaving it to time out thirty seconds later.
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(new Error(`the browser went away before ${waiter.method} answered`));
    }
  });

  socket.addEventListener('message', (message) => {
    const frame = JSON.parse(message.data);
    if (frame.id !== undefined) {
      const waiter = pending.get(frame.id);
      pending.delete(frame.id);
      if (!waiter) return;
      if (frame.error) waiter.reject(new Error(`${frame.error.message} (${waiter.method})`));
      else waiter.resolve(frame.result);
      return;
    }
    events.push(frame);
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  /**
   * Installed BEFORE any document loads, so it is listening when the very
   * first script on the page is blocked.
   *
   * `securitypolicyviolation` is the DOM event a browser fires at the document
   * for every directive it refuses — a blocked script, a blocked style, a
   * blocked connection. It is the only report that does not need a
   * `report-uri` endpoint, which is why the test uses it rather than
   * `report-to`.
   */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__foundit = { violations: [], errors: [] };
      document.addEventListener('securitypolicyviolation', function (e) {
        window.__foundit.violations.push({
          directive: e.effectiveDirective || e.violatedDirective,
          blocked: String(e.blockedURI || '').slice(0, 300),
          sample: String(e.sample || '').slice(0, 200),
          line: e.lineNumber || 0,
          source: String(e.sourceFile || '').slice(0, 300)
        });
      });
      window.addEventListener('error', function (e) {
        window.__foundit.errors.push(String(e && e.message || e).slice(0, 300));
      });
    `,
  });

  return {
    port: chrome.port,
    send,

    /** Everything the page has said since the last call. */
    drain() {
      const out = events;
      events = [];
      return out;
    },

    /**
     * Go to `url` and wait for the load event, or for `settleMs` to pass with
     * no load at all — a page that never fires `load` is still a page whose
     * CSP violations are worth reading.
     */
    async goto(url, { settleMs = 2_500 } = {}) {
      events = [];
      const loaded = new Promise((resolve) => {
        const started = Date.now();
        const tick = setInterval(() => {
          if (events.some((e) => e.method === 'Page.loadEventFired')
              || Date.now() - started > timeoutMs) {
            clearInterval(tick);
            resolve();
          }
        }, 50);
        tick.unref?.();
      });
      await send('Page.navigate', { url });
      await loaded;
      // A moment for deferred scripts, hydration and the beacon to run and be
      // refused. Without it a violation raised by hydration is missed.
      await new Promise((resolve) => { const t = setTimeout(resolve, settleMs); t.unref?.(); });
    },

    /** The violations and page errors the injected listener collected. */
    async report() {
      const { result } = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__foundit || {violations:[],errors:[]})',
        returnByValue: true,
      });
      try {
        return JSON.parse(result.value ?? '{}');
      } catch {
        return { violations: [], errors: [] };
      }
    },

    /** Anything the page's own console called an error. */
    consoleErrors() {
      return events
        .filter((e) => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
        .map((e) => String(e.params.entry.text ?? '').slice(0, 300));
    },

    /** Run an expression in the page and return it by value. */
    async evaluate(expression) {
      const { result } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.value;
    },

    async close() {
      try { socket.close(); } catch { /* already gone */ }
      try { await chrome.kill(); } catch { /* already gone */ }
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* already gone */ }
    },
  };
}
