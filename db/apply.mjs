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
// Which migrations have run is recorded in infra.schema_migrations, never inferred from
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
  sql.split(String.fromCharCode(10)).filter((l) => l.trimStart().charCodeAt(0) !== 92).join(String.fromCharCode(10));

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
        drop schema if exists infra cascade;
        create schema public;
      `);
    }

    // Deliberately NOT in `public`. Every table in that schema must have
    // row-level security enabled and forced — db/test/rls_test.sql enforces
    // it — and this one cannot satisfy that honestly: forcing RLS with no
    // policy would lock out the migration runner itself, and writing a
    // permissive policy to get around that is exactly the anti-pattern the
    // test exists to catch. It is not application data, so it lives in its
    // own schema with no grants to the application role at all, which is a
    // stronger position than any policy could give it.
    await client.query(`
      create schema if not exists infra;
      revoke all on schema infra from public;
      create table if not exists infra.schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )`);

    // Anything left in the old location from before this moved.
    await client.query(`
      do $$
      begin
        if to_regclass('public.schema_migrations') is not null then
          insert into infra.schema_migrations (filename, applied_at)
            select filename, applied_at from public.schema_migrations
            on conflict (filename) do nothing;
          drop table public.schema_migrations;
        end if;
      end
      $$;`);

    const { rows } = await client.query('select filename from infra.schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const name of readdirSync(join(root, 'db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(name)) {
        console.log(`  skip ${name} (already applied)`);
        continue;
      }
      await run(name, readFileSync(join(root, 'db/migrations', name), 'utf8'));
      await client.query('insert into infra.schema_migrations (filename) values ($1)', [name]);
    }

    if (args.has('--seed')) {
      await run('seed/dev_seed.sql', readFileSync(join(root, 'db/seed/dev_seed.sql'), 'utf8'));
    }

    const { rows: done } = await client.query(
      'select filename from infra.schema_migrations order by filename');
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
