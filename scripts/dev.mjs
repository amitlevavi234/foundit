#!/usr/bin/env node
// ===========================================================================
// `npm run dev`, with the one sentence that would have saved the owner an
// afternoon printed above it.
//
// THE OWNER'S ITEM 3, 14 September 2026. He used the site on this laptop for
// the first time, found every page slow, and reported it as a speed problem.
// Two different things were true and only one of them was about the product:
//
//   ON THIS MACHINE it was `next dev` COMPILING each route on its first
//   request. His log shows 15 to 29 seconds per route, once each. That is not
//   the site being slow; it is a development server doing what a development
//   server does, and nothing anywhere said so.
//
//   IN PRODUCTION the numbers really were slow — LCP 2.2 to 3.9 seconds and a
//   Total Blocking Time near a second on every page — and that half was a real
//   finding, measured with `scripts/vitals.mjs` and fixed separately.
//
// The first one is a fact about the tool, so the tool says it. Four lines
// before the server starts, once, where somebody about to wait ten seconds for
// a page will read them.
//
// IT ALSO MATTERED MORE THAN A SLOW PAGE. While a route is compiling, its
// HTML has arrived and its client bundle has not — so a Server Action form
// posts as a plain form, `onKeyDown` does not exist, and a button held shut by
// a `useState` is never opened. That window is where all four of the owner's
// interaction bugs lived (items 4 to 7). They are fixed by not depending on
// hydration rather than by making it faster, which is why this file only
// explains the wait and does not try to shorten it.
//
// Written as a Node script rather than as a shell one-liner in package.json
// for the reason scripts/start.mjs gives: npm runs scripts through cmd.exe on
// Windows, where shell syntax is a syntax error rather than a feature.
// ===========================================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.stdout.write(
  [
    '',
    '  next dev compiles each route the first time you ask for it.',
    '  The first load of a page takes 15-30 seconds on this laptop and every',
    '  load after it is instant. That is the dev server, not the site: measure',
    '  speed with `npm run build && npm start` and `node --env-file=.env.local',
    '  scripts/vitals.mjs`, which refuses to measure a dev server at all.',
    '',
  ].join('\n') + '\n',
);

// `next` from the local install, and the arguments after `npm run dev --`
// passed through so `npm run dev -- --port 4000` still works.
const next = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [next, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: ROOT,
});

// Pass the exit code through, so a failure to start is a failure of
// `npm run dev` rather than a success with an error printed in it.
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
