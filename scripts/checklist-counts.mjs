#!/usr/bin/env node
// ===========================================================================
// Count docs/launch-checklist.md's own rows, so its header does not have to be
// believed.
//
//   node scripts/checklist-counts.mjs
//
// THE PHASE 9a REVIEW'S F17. The file said "**24 evidenced here in 9a**, **10
// tagged 9b, owner**, **6 not applicable**" under its own rule that "no item
// is ticked by assertion" — and tallying the forty rows by their own markers
// gave 7 N/A, 11 tagged 9b and 34 tagged 9a, because rows carried two tags at
// once and the arithmetic was done by hand. The two lists of "the ten that are
// 9b's" disagreed with each other as well: `docs/loop-progress.md` named
// Dependabot and omitted item 33, and the checklist did the opposite.
//
// So the counts are computed, and `tests/markup.test.mjs` runs this and fails
// when the header disagrees with the table.
//
// THE TAG IS THE FIRST BOLD TOKEN OF THE EVIDENCE CELL, and there is exactly
// one per row. That is the other half of the fix: an item is 9a **or** 9b
// **or** N/A, and a sub-part that belongs to the other phase is spelled out in
// the prose of the cell rather than given a second tag nobody can tally.
//
// Exit codes: 0 the header agrees with the table, 1 it does not, 2 cannot run.
// ===========================================================================
import { readFileSync } from 'node:fs';

const FILE = 'docs/launch-checklist.md';

let text;
try {
  text = readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8');
} catch (error) {
  process.stderr.write(`could not read ${FILE}: ${error.message}\n`);
  process.exit(2);
}

/** Every numbered row of every tier table, in file order. */
// The tier tables only. The closing list at the foot of the file is numbered
// rows too, and counting those would be counting the same items twice.
const CLOSING = '## The ones that are 9b';
const tables = text.includes(CLOSING) ? text.slice(0, text.indexOf(CLOSING)) : text;

const rows = [];
for (const line of tables.split('\n')) {
  if (!/^\|\s*\d+[a-z]?\s*\|/.test(line)) continue;
  // The cells, with the empty strings the leading and trailing pipes make.
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  const number = cells[0];
  // THE LAST CELL IS THE EVIDENCE, in a three-column table and a four-column
  // one alike, and the tag is its FIRST bold token. One tag per row is the
  // whole point: an item is 9a or 9b or N/A and never two of them.
  const evidence = cells[cells.length - 1];
  const tag = /\*\*([^*]+?)\*\*/.exec(evidence)?.[1]?.trim() ?? null;
  rows.push({ number, tag, evidence });
}

const KNOWN = new Set(['9a', '9b, owner', 'N/A']);
const tally = { '9a': 0, '9b, owner': 0, 'N/A': 0 };
const untagged = [];
for (const row of rows) {
  if (row.tag !== null && KNOWN.has(row.tag)) tally[row.tag] += 1;
  else untagged.push(`${row.number} (${row.tag === null ? 'no tag' : `"${row.tag}"`})`);
}

/** The counts the header claims, read out of the header. */
const claimed = {
  '9a': Number(/\*\*(\d+) evidenced here in 9a\*\*/.exec(text)?.[1] ?? NaN),
  '9b, owner': Number(/\*\*(\d+) tagged 9b, owner\*\*/.exec(text)?.[1] ?? NaN),
  'N/A': Number(/\*\*(\d+) not applicable\*\*/.exec(text)?.[1] ?? NaN),
};

/** And the closing list of the ones only the host can prove. */
const listed = [...(
  text.includes(CLOSING) ? text.slice(text.indexOf(CLOSING)) : ''
).matchAll(/^\|\s*(\d+[a-z]?)\s*\|/gm)].map((m) => m[1]);
const tagged9b = rows.filter((r) => r.tag === '9b, owner').map((r) => r.number);

const nl = '\n';
let bad = false;

process.stdout.write(`${rows.length} numbered rows in ${FILE}${nl}${nl}`);
for (const key of ['9a', '9b, owner', 'N/A']) {
  const ok = tally[key] === claimed[key];
  if (!ok) bad = true;
  process.stdout.write(
    `  ${key.padEnd(10)} table ${String(tally[key]).padStart(3)}   header ` +
      `${String(claimed[key]).padStart(3)}   ${ok ? 'ok' : 'DISAGREE'}${nl}`,
  );
}

if (untagged.length > 0) {
  bad = true;
  process.stdout.write(`${nl}rows with no single recognised tag: ${untagged.join(', ')}${nl}`);
}

const missing = tagged9b.filter((n) => !listed.includes(n));
const extra = listed.filter((n) => !tagged9b.includes(n));
process.stdout.write(
  `${nl}the closing list names ${listed.length} of the ${tagged9b.length} rows tagged 9b${nl}`,
);
if (missing.length > 0 || extra.length > 0) {
  bad = true;
  if (missing.length > 0) process.stdout.write(`  tagged 9b and not listed: ${missing.join(', ')}${nl}`);
  if (extra.length > 0) process.stdout.write(`  listed and not tagged 9b: ${extra.join(', ')}${nl}`);
}

process.stdout.write(`${nl}${bad ? 'DISAGREES with its own table.' : 'The header matches the table.'}${nl}`);
process.exit(bad ? 1 : 0);
