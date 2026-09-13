#!/usr/bin/env node
// ===========================================================================
// How fast the five main pages are, measured rather than felt.
//
//   npm run build                 (a production build; `next dev` is not this)
//   npm start                     (in another terminal)
//   node scripts/vitals.mjs       (this)
//
// WHAT IT MEASURES. Lighthouse, in the Chrome already on this machine, over a
// simulated slow 4G connection with a 4x CPU slowdown — the mobile preset,
// which is the one worth optimising for and the one a desktop laptop flatters
// you out of. For each page: Largest Contentful Paint, Cumulative Layout
// Shift, Total Blocking Time, Speed Index, Time to First Byte, and the weight
// of the JavaScript the page shipped.
//
// WHY TBT AND NOT INP. Interaction to Next Paint needs a real person
// interacting; there is no lab equivalent, and Lighthouse says so. TBT is the
// lab proxy for it, and Google's own guidance is to use TBT in the lab and
// watch INP in the field. The field measurement for all three is Cloudflare
// Web Analytics (docs/product-decisions.md §13 says why that and not a
// script of our own), and it needs a site token that does not exist until 9b.
//
// WHAT A NUMBER HERE IS AND IS NOT. It is a lab measurement on one machine:
// useful as a COMPARISON against the row in eval/baselines.md and nearly
// meaningless as an absolute. Two runs on the same build differ by a few per
// cent; a change of thirty per cent is a change.
//
//   --json            print the table as JSON as well
//   --runs=N          median of N runs per page (default 1)
//   --url=...         a base URL other than BETTER_AUTH_URL
//   --page=/path      measure one page rather than the five
// ===========================================================================
import { writeFileSync } from 'node:fs';

/* ---------------------------------------------------------------------------
 * The five, and why these five
 * ------------------------------------------------------------------------ */

/**
 * THE FIVE MAIN PAGES, which is not the five most complicated ones.
 *
 *   /                 what everybody sees first.
 *   /results?q=…      the product. It is also the slowest thing here by
 *                     construction: it is dynamic, it is uncacheable, and it
 *                     may wait on two paid model calls.
 *   /browse           the catalogue, and the biggest list of cards.
 *   /tools/<slug>     one listing, which is the page most links land on.
 *   /top              the other list, ordered differently.
 *
 * /admin is deliberately absent: it is an operator's page behind a session,
 * nobody is waiting on it, and measuring it would mean holding an
 * administrator's cookie in a script.
 */
const PAGES = [
  { name: '/', path: '/' },
  {
    name: '/results?q=…',
    // A sentence with a warm cache, so this measures the PAGE rather than the
    // model: `--baseline`'s fixture has already embedded this one, and a cold
    // sentence would measure api.openai.com's latency today.
    path: `/results?q=${encodeURIComponent('my receipts are a mess at tax time')}`,
  },
  { name: '/browse', path: '/browse' },
  { name: '/tools/receiptly', path: '/tools/receiptly' },
  { name: '/top', path: '/top' },
];

/* ---------------------------------------------------------------------------
 * Arguments
 * ------------------------------------------------------------------------ */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const runs = Number.parseInt(/^--runs=(\d+)$/.exec(args.find((a) => a.startsWith('--runs=')) ?? '')?.[1] ?? '1', 10);
const onePage = /^--page=(.+)$/.exec(args.find((a) => a.startsWith('--page=')) ?? '')?.[1] ?? null;
const baseArg = /^--url=(.+)$/.exec(args.find((a) => a.startsWith('--url=')) ?? '')?.[1] ?? null;

const base = (baseArg ?? process.env.FOUNDIT_BASE_URL ?? process.env.BETTER_AUTH_URL ?? '').trim();
if (base === '') {
  process.stderr.write(
    'No base URL. Set BETTER_AUTH_URL (node --env-file=.env.local does) or pass --url=…\n',
  );
  process.exit(1);
}
const origin = new URL(base).origin;

/* ---------------------------------------------------------------------------
 * Is there anything to measure?
 * ------------------------------------------------------------------------ */

async function answering() {
  try {
    const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(15_000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await answering())) {
  process.stderr.write(
    `Nothing is answering at ${origin}/healthz.\n\n`
      + 'This measures a PRODUCTION build, because `next dev` compiles on the first request and\n'
      + 'ships an unminified bundle — measuring it would produce numbers that mean nothing.\n\n'
      + '  npm run build\n  npm start\n  node --env-file=.env.local scripts/vitals.mjs\n',
  );
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * Lighthouse
 * ------------------------------------------------------------------------ */

let launch;
let lighthouse;
try {
  ({ launch } = await import('chrome-launcher'));
  ({ default: lighthouse } = await import('lighthouse'));
} catch (error) {
  process.stderr.write(
    'lighthouse and chrome-launcher are development dependencies and are not installed:\n'
      + `  ${(error && error.message) || error}\n\n`
      + '  npm install\n',
  );
  process.exit(1);
}

const chrome = await launch({
  chromeFlags: [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    // Deliberately NOT --disable-web-security: the CSP is part of what is
    // being measured, because a blocked script is a very fast page.
  ],
  logLevel: 'silent',
});

/** One measurement of one page. */
async function measure(path) {
  const result = await lighthouse(
    `${origin}${path}`,
    { port: chrome.port, output: 'json', logLevel: 'silent' },
    {
      extends: 'lighthouse:default',
      settings: {
        // Performance only. Accessibility has its own audit
        // (docs/loop-progress.md, Phase 2-UI) and best-practices would fail on
        // http:// for reasons that are about this being localhost.
        onlyCategories: ['performance'],
        // The MOBILE preset: 4x CPU slowdown, simulated slow 4G. A desktop
        // measurement on a developer's laptop is a number that flatters.
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
        throttlingMethod: 'simulate',
      },
    },
  );
  // SAY WHY A PAGE MEASURED NOTHING. A run that fails — a page that never
  // paints, a navigation Lighthouse could not complete — still returns a
  // report, with a score of 0 and every metric null. A table of dashes with no
  // explanation is worse than no table.
  if (result.lhr.runtimeError) {
    process.stderr.write(
      `  ! ${path}: ${result.lhr.runtimeError.code} — ${result.lhr.runtimeError.message}\n`,
    );
  }
  const audits = result.lhr.audits;
  for (const id of ['largest-contentful-paint', 'total-blocking-time', 'speed-index']) {
    if (audits[id]?.errorMessage) {
      process.stderr.write(`  ! ${path}: ${id}: ${audits[id].errorMessage}\n`);
    }
  }
  const n = (id) => {
    const value = audits[id]?.numericValue;
    return typeof value === 'number' ? Math.round(value) : null;
  };
  return {
    score: Math.round((result.lhr.categories.performance.score ?? 0) * 100),
    lcp: n('largest-contentful-paint'),
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    tbt: n('total-blocking-time'),
    si: n('speed-index'),
    ttfb: n('server-response-time'),
    js: Math.round(
      (audits['network-requests']?.details?.items ?? [])
        .filter((item) => String(item.mimeType ?? '').includes('javascript'))
        .reduce((sum, item) => sum + (item.transferSize ?? 0), 0) / 1024,
    ),
  };
}

const median = (values) => {
  const clean = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (clean.length === 0) return null;
  return clean[Math.floor(clean.length / 2)];
};

const chosen = onePage ? [{ name: onePage, path: onePage }] : PAGES;
const rows = [];

try {
  // A DISCARDED FIRST RUN. The very first Lighthouse navigation in a
  // freshly-launched browser is the one that comes back with `NO_NAVSTART`
  // here — reproducibly, whichever page is first — and the retry below then
  // spends two more runs on it. Measuring something and throwing it away costs
  // one page's time and makes the first row in the table as trustworthy as the
  // last. It also warms the server's route cache, which is the other reason
  // a first measurement is not comparable with a fifth.
  process.stderr.write('  warming up (this run is discarded)…\n');
  await measure(chosen[0].path).catch(() => null);

  for (const page of chosen) {
    const taken = [];
    for (let i = 0; i < Math.max(1, runs); i += 1) {
      process.stderr.write(`  measuring ${page.name}${runs > 1 ? ` (${i + 1}/${runs})` : ''}…\n`);
      // RETRIED, BECAUSE LIGHTHOUSE ASKS TO BE. A trace that comes back with
      // no navigationStart — `NO_NAVSTART`, whose own message is "Please run
      // Lighthouse again" — is a recording failure rather than a measurement:
      // every metric is null and the score is 0, which would go into the table
      // as a row of dashes and read as "this page is broken". It happens
      // reproducibly on the two routes in this application that stream (`/`
      // and `/results`, the two with a `loading.tsx`), and a second attempt
      // gets a trace. Three attempts, then the dashes are honest.
      let result = await measure(page.path);
      for (let attempt = 2; attempt <= 3 && result.lcp === null; attempt += 1) {
        process.stderr.write(`    no trace; attempt ${attempt} of 3\n`);
        result = await measure(page.path);
      }
      taken.push(result);
    }
    rows.push({
      page: page.name,
      score: median(taken.map((t) => t.score)),
      lcp: median(taken.map((t) => t.lcp)),
      cls: median(taken.map((t) => t.cls)),
      tbt: median(taken.map((t) => t.tbt)),
      si: median(taken.map((t) => t.si)),
      ttfb: median(taken.map((t) => t.ttfb)),
      js: median(taken.map((t) => t.js)),
    });
  }
} finally {
  // `kill()` also deletes the temporary profile directory, and on Windows that
  // throws EPERM if any Chrome process still has a handle open — which,
  // milliseconds after asking it to exit, it usually does. Losing the table
  // because a temp folder outlived the browser would be an absurd way to fail
  // a measurement that has already been taken, so the browser is killed and
  // the tidying is allowed not to work.
  try {
    await chrome.kill();
  } catch (error) {
    process.stderr.write(
      `  (the browser exited but its temporary profile could not be removed: ${
        (error && error.code) || error})\n`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

// Google's thresholds, so a number is readable without looking them up.
const GOOD = { lcp: 2500, cls: 0.1, tbt: 200 };
const mark = (value, good) => (value === null ? ' ' : value <= good ? ' ' : '!');

const head = ['page', 'score', 'LCP ms', 'CLS', 'TBT ms', 'SpeedIdx', 'TTFB ms', 'JS kB'];
const body = rows.map((r) => [
  r.page,
  String(r.score),
  `${r.lcp ?? '—'}${mark(r.lcp, GOOD.lcp)}`,
  `${r.cls === null ? '—' : r.cls.toFixed(3)}${mark(r.cls, GOOD.cls)}`,
  `${r.tbt ?? '—'}${mark(r.tbt, GOOD.tbt)}`,
  String(r.si ?? '—'),
  String(r.ttfb ?? '—'),
  String(r.js ?? '—'),
]);

const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();

process.stdout.write(`\nFoundit — Core Web Vitals, lab, ${new Date().toISOString().slice(0, 10)}\n`);
process.stdout.write(
  `Lighthouse ${runs > 1 ? `median of ${runs} runs` : '1 run'} per page, mobile preset `
    + '(4x CPU, simulated slow 4G), against a production build.\n\n',
);
process.stdout.write(`${line(head)}\n`);
process.stdout.write(`${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
for (const row of body) process.stdout.write(`${line(row)}\n`);
process.stdout.write(
  `\n"!" is over Google's "good" threshold: LCP ${GOOD.lcp}ms, CLS ${GOOD.cls}, TBT ${GOOD.tbt}ms.\n`
    + 'A lab number is a comparison against the row in eval/baselines.md, not an absolute:\n'
    + 'two runs on the same build differ by a few per cent, and INP cannot be measured here\n'
    + 'at all (it needs a person). Cloudflare Web Analytics is the field measurement, and it\n'
    + 'starts in 9b.\n',
);

if (asJson) {
  const path = `eval/results/vitals-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const payload = JSON.stringify({ at: new Date().toISOString(), origin, runs, rows }, null, 2);
  try {
    writeFileSync(path, payload);
    process.stdout.write(`\nwrote ${path}\n`);
  } catch {
    process.stdout.write(`\n${payload}\n`);
  }
}
