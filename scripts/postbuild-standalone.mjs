#!/usr/bin/env node
// ===========================================================================
// Finish the standalone build.
//
// `output: 'standalone'` in next.config.mjs writes `.next/standalone/` — the
// server, the compiled routes, and the traced subset of node_modules the
// server actually requires. It deliberately does **not** write the browser's
// half of the build into that directory: `.next/static/` (every JS chunk and
// every stylesheet the HTML links) and `public/` are left where they are, and
// Next.js documents that they "should be copied" into the standalone folder by
// whatever packages the app.
//
// Nothing in this repository did that copy. The result was a production
// artefact that booted, answered `/` with 200, and served 404 for the
// stylesheet its own HTML asked for — an unstyled site, which is not a
// degraded site but a broken one, and which no test noticed because the test
// suite never starts the built server.
//
// So this script is that copy, run automatically as npm's `postbuild`. It
// performs exactly the two copies research/10-deploy-and-ops.md §6.6 has the
// production Dockerfile perform:
//
//   COPY --from=builder /app/public              ./public
//   COPY --from=builder /app/.next/static        ./.next/static
//
// Same two directories, same two destinations, so the image and a local
// `node .next/standalone/server.js` are packaging the same bytes. Running it
// at build time rather than only at image-build time means the deployable
// directory is complete the moment `next build` finishes, and the Dockerfile's
// two COPY lines become a restatement rather than the only place the knowledge
// lives.
//
// Run:  node scripts/postbuild-standalone.mjs      (npm run build does this)
// ===========================================================================

import { cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');

/** Directory, or null when it is absent. Anything else is a real error. */
async function dirOrNull(target) {
  try {
    const info = await stat(target);
    return info.isDirectory() ? target : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

async function main() {
  if (!(await dirOrNull(STANDALONE))) {
    process.stderr.write(
      [
        `ERROR: ${rel(STANDALONE)} does not exist.`,
        '',
        'This script runs after `next build` and packages what that build left',
        'outside the standalone directory. There is nothing to package yet.',
        '',
        'Run `npm run build`, which runs this script for you.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  // The one file that decides whether the artefact is runnable at all. If the
  // output mode is ever changed away from 'standalone', this is the line that
  // says so out loud instead of leaving a half-copied directory behind.
  if (!(await dirOrNull(path.join(STANDALONE, '.next')))) {
    process.stderr.write(
      `ERROR: ${rel(STANDALONE)} has no .next/ — that is not a standalone build.\n`,
    );
    return 1;
  }

  const copies = [
    // Required. Without this every /_next/static/... URL in the HTML 404s.
    { from: path.join(ROOT, '.next', 'static'), to: path.join(STANDALONE, '.next', 'static'), required: true },
    // Optional: this repository has no public/ today (the app router serves
    // its own icons). The Dockerfile in §6.6 copies it unconditionally and
    // would fail the image build if it were ever added and then removed; here
    // an absent public/ is simply nothing to do, and an added one starts being
    // packaged the moment it exists, with no second place to remember.
    { from: path.join(ROOT, 'public'), to: path.join(STANDALONE, 'public'), required: false },
  ];

  for (const { from, to, required } of copies) {
    if (!(await dirOrNull(from))) {
      if (required) {
        process.stderr.write(
          `ERROR: ${rel(from)} is missing. The build did not produce the browser assets.\n`,
        );
        return 1;
      }
      process.stdout.write(`  skip  ${rel(from)} (not present)\n`);
      continue;
    }
    // `force` so a rebuild overwrites the previous build's chunks rather than
    // layering a new hash set on top of a stale one.
    await cp(from, to, { recursive: true, force: true });
    process.stdout.write(`  copy  ${rel(from)}  ->  ${rel(to)}\n`);
  }

  process.stdout.write(
    // `npm start`, not `node .next/standalone/server.js`: the generated server
    // binds 0.0.0.0 unless HOSTNAME says otherwise, and scripts/start.mjs is
    // where this repository says otherwise.
    `\n${rel(STANDALONE)} is complete. Run it with: npm start\n`,
  );
  return 0;
}

process.exitCode = await main();
