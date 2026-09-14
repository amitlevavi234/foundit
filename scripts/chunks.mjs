#!/usr/bin/env node
// The client chunks a production build ships, largest first.
//
//   npm run build
//   node scripts/chunks.mjs            every chunk, by gzipped size
//   node scripts/chunks.mjs --top=5    just the biggest five
//
// WHY THIS EXISTS RATHER THAN `@next/bundle-analyzer` — the owner's item 3,
// 14 September 2026. He measured a Total Blocking Time of about a second on
// pages whose own client code is one input and one `useEffect`, and the first
// question is which JavaScript is actually being shipped. The analyzer is a
// build-time plugin, another dependency, and a treemap somebody has to open;
// what is needed here is a number in a log that a commit can quote, and Next
// has already written the answer down.
//
// `.next/app-build-manifest.json` lists, per route, the chunks that route
// loads; `.next/build-manifest.json` lists the ones every page loads. Joining
// either to the file sizes on disk — and gzipping each file, because gzipped
// is what a browser is sent and what `scripts/vitals.mjs` reports — is the
// whole measurement. No new dependency and nothing to keep in step.
//
// IT MEASURES BYTES AND NOT TIME. Total Blocking Time is execution, not
// download, and the Phase 9a review explicitly withdrew the claim that the
// cause was the size of the bundle. Bytes are where to LOOK; they are not the
// finding.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const CHUNKS = join(ROOT, '.next', 'static', 'chunks');
const top = Number(/--top=(\d+)/.exec(process.argv.join(' '))?.[1] ?? 0);

if (!existsSync(CHUNKS)) {
  console.error('.next/static/chunks is not there. Run `npm run build` first.');
  process.exit(2);
}

if (existsSync(join(ROOT, '.next', 'static', 'chunks', 'react-refresh.js'))) {
  console.error(
    '.next holds a DEVELOPMENT build (react-refresh.js is in it), and its chunk sizes mean '
      + 'nothing: they are unminified and carry the hot-reload client. Run `npm run build`.',
  );
  process.exit(2);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.js')) out.push(path);
  }
  return out;
}

const rows = walk(CHUNKS)
  .map((path) => {
    const bytes = readFileSync(path);
    return {
      name: relative(CHUNKS, path).split(sep).join('/'),
      raw: statSync(path).size,
      gz: gzipSync(bytes).length,
    };
  })
  .sort((a, b) => b.gz - a.gz);

/** Which routes load a chunk, from Next's own manifest. */
const manifestPath = join(ROOT, '.next', 'app-build-manifest.json');
const routesFor = new Map();
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [route, files] of Object.entries(manifest.pages ?? {})) {
    for (const file of files) {
      const name = file.replace(/^static\/chunks\//, '');
      if (!routesFor.has(name)) routesFor.set(name, []);
      routesFor.get(name).push(route);
    }
  }
}

const shown = top > 0 ? rows.slice(0, top) : rows;
const kb = (n) => (n / 1024).toFixed(1);

console.log(`Foundit — client chunks, ${new Date().toISOString().slice(0, 10)}`);
console.log('Gzipped, because that is what the browser is sent and what vitals.mjs reports.\n');
console.log(
  'chunk'.padEnd(44) + '  ' + 'raw kB'.padStart(8) + '  ' + 'gzip kB'.padStart(8) + '  routes',
);
console.log('-'.repeat(44) + '  ' + '-'.repeat(8) + '  ' + '-'.repeat(8) + '  ------');
for (const row of shown) {
  const routes = routesFor.get(row.name) ?? [];
  const where =
    routes.length === 0
      ? '(not in the app manifest — shared or lazy)'
      : routes.length > 6
        ? `every route (${routes.length})`
        : routes.join(' ');
  console.log(
    row.name.padEnd(44) + '  ' + kb(row.raw).padStart(8) + '  ' + kb(row.gz).padStart(8) + '  ' + where,
  );
}

const total = rows.reduce((sum, r) => sum + r.gz, 0);
console.log(`\n${rows.length} chunk(s), ${kb(total)} kB gzipped in total.`);
