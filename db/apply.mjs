#!/usr/bin/env node
// Apply migrations over a network connection, rather than through `docker exec`.
//
// `apply.sh` needs the database to be a container on the same machine. It is
// not: development runs on the laptop and PostgreSQL runs on the server,
// reached through an SSH tunnel. CI will be in the same position. So this is
// the applier that works from anywhere, and apply.sh stays for the local
// container case.
//
//   node db/apply.mjs                  # apply what has not been applied
//   node db/apply.mjs --fresh          # drop the schema first, then apply all
//   node db/apply.mjs --seed           # ...and load db/seed/dev_seed.sql after
//   node db/apply.mjs --file db/x.sql  # run one file, recording nothing
//
// Which migrations have run is recorded in the database, never inferred from
// the files, so running this twice is safe.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const fileArg = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : null;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  console.error('It lives in .env.local, which is not committed. See docs/development.md.');
  process.exit(2);
}

// psql meta-commands (\set, \echo) are not SQL and node-pg cannot run them.
// The only one in use is `\set ON_ERROR_STOP on`, whose behaviour we get for
// free: any error here rejects and stops the run.
const stripMeta = (sql) =>
  sql.split('\n').filter((l) => !/^\s*\/.test(l)).join('\n');

const client = new pg.Client({ connectionString: url });
await client.connect();

const run = async (label, sql) => {
  process.stdout.write(`> ${label}\n`);
  await client.query(stripMeta(sql));
};

try {
  if (fileArg) {
    await run(basename(fileArg), readFileSync(join(root, fileArg), 'utf8'));
    console.log('Done.');
  } else {
    if (args.has('--fresh')) {
      console.log('Wiping the schema...');
      await client.query(`
        drop schema if exists public cascade;
        drop schema if exists auth cascade;
        create schema public;
      `);
    }

    await client.query(`
      create table if not exists public.schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )`);

    const { rows } = await client.query('select filename from public.schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const name of readdirSync(join(root, 'db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(name)) {
        console.log(`  skip ${name} (already applied)`);
        continue;
      }
      await run(name, readFileSync(join(root, 'db/migrations', name), 'utf8'));
      await client.query('insert into public.schema_migrations (filename) values ($1)', [name]);
    }

    if (args.has('--seed')) {
      await run('seed/dev_seed.sql', readFileSync(join(root, 'db/seed/dev_seed.sql'), 'utf8'));
    }

    const { rows: done } = await client.query(
      'select filename from public.schema_migrations order by filename');
    console.log('Applied so far:');
    for (const r of done) console.log(`  ${r.filename}`);
  }
} catch (err) {
  // Postgres puts the useful part in fields the default formatter drops.
  console.error(`\nFAILED: ${err.message}`);
  for (const k of ['detail', 'hint', 'where', 'position']) {
    if (err[k]) console.error(`  ${k}: ${err[k]}`);
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
