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
//
// ---------------------------------------------------------------------------
// AND IT BINDS THE LOOPBACK ADDRESS, for the reason scripts/start.mjs gives at
// length and this file did not — OWNER FEEDBACK, ROUND 1, F9.
//
// `next dev`'s default is the same `0.0.0.0` the built server's is: every
// interface the machine has. This file was written in the round before because
// the owner develops on a laptop, and it then started a server on every café
// wifi it was opened on. That is worse here than in production, because a
// development server gives away more: Next serialises the server's own `fetch`
// calls into the RSC payload, so a `/results` page whose reader actually ran
// carries the reader's entire system prompt, the OpenAI response headers —
// `openai-project`, the rate-limit headers, a `Set-Cookie` for
// `api.openai.com` — and the response body, in the page source. A production
// build carries none of it. The review found 9.3 kB of `lib/reader-model.ts`'s
// prompt in a page `npm run dev` had served.
//
//   npm run dev                          -> http://127.0.0.1:3000
//   npm run dev -- --hostname 0.0.0.0    -> every interface, said out loud
//   HOSTNAME=0.0.0.0 npm run dev         -> the same, from the environment
//   npm run dev -- --port 4000           -> the port, as before
//
// `??=` rather than `=`: an empty string is a deliberate value to Next (it
// falls back to 0.0.0.0), and only an unset variable is us choosing. And a
// `--hostname` on the command line is passed straight through and wins over
// both, because somebody typing it means it.
// ===========================================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);

/** Did somebody ask for a host themselves? `-H`, `--hostname`, `--hostname=x`. */
const askedForHost = argv.some(
  (arg) => arg === '-H' || arg === '--hostname' || arg.startsWith('--hostname='),
);

// Only where nobody said otherwise, in either of the two places they could.
if (!askedForHost) process.env.HOSTNAME ??= '127.0.0.1';

process.stdout.write(
  [
    '',
    '  next dev compiles each route the first time you ask for it.',
    '  The first load of a page takes 15-30 seconds on this laptop and every',
    '  load after it is instant. That is the dev server, not the site: measure',
    '  speed with `npm run build && npm start` and `node --env-file=.env.local',
    '  scripts/vitals.mjs`, which refuses to measure a dev server at all.',
    '',
    `  It is bound to ${askedForHost ? 'the host you asked for' : `${process.env.HOSTNAME}, this machine only`}.`,
    '  A dev server puts the reader\'s prompt and the provider\'s response',
    '  headers in the page source; pass `--hostname 0.0.0.0` if you mean to',
    '  serve that to the network.',
    '',
  ].join('\n') + '\n',
);

// `next` from the local install, and the arguments after `npm run dev --`
// passed through so `npm run dev -- --port 4000` still works.
const next = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [next, 'dev', ...argv], {
  stdio: 'inherit',
  cwd: ROOT,
});

// Pass the exit code through, so a failure to start is a failure of
// `npm run dev` rather than a success with an error printed in it.
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
