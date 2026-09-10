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

// The OWNER connection, deliberately not DATABASE_URL. Migrations create and
// alter objects; the application role owns nothing and must never be able to.
// There is no fallback to DATABASE_URL on purpose: a fallback would quietly
// reintroduce the thing the split exists to prevent, and it would do it on the
// day someone's environment was misconfigured rather than the day they meant it.
const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('DATABASE_URL_OWNER is not set.');
  console.error('Migrations run as the schema owner, not as the application role.');
  console.error('It lives in .env.local, which is not committed. See docs/development.md.');
  process.exit(2);
}

// psql meta-commands (\set, \echo) are not SQL and node-pg cannot run them, so
// they have to come out before the file is sent. The only one in use is
// `\set ON_ERROR_STOP on`, whose behaviour we get for free: any error here
// rejects and stops the run.
//
// Two rules, and the second one is the point:
//
//   1. A line is only a candidate if it starts a line of ACTUAL SQL — not if
//      it happens to sit inside a dollar-quoted function body, a string
//      literal, a quoted identifier or a comment. `\set` is meaningless to
//      psql in those places too, and a plpgsql body containing a line that
//      begins with a backslash is perfectly legal SQL that this used to
//      truncate on its way to the server.
//
//   2. Outside those, only the meta-commands this repository actually uses are
//      removed. Anything else that begins with a backslash is an error, loudly,
//      rather than a line that quietly disappears. If a future migration needs
//      another meta-command, it gets added here on purpose — the failure mode
//      to avoid is a file that runs and does something other than what it says.
const META_ALLOWED = ['set', 'unset', 'echo', 'qecho'];

// Scan for the offsets at which a new line starts in ordinary SQL, skipping
// everything Postgres treats as a body rather than as code. Postgres block
// comments nest, single-quoted strings escape a quote by doubling it (and
// additionally with a backslash inside E''), double quotes delimit identifiers,
// and $tag$...$tag$ ends only on its own tag.
function sqlLineStarts(sql) {
  const starts = [];
  let atLineStart = true; // no code seen yet on the current line
  let i = 0;
  let blockDepth = 0;
  let inLineComment = false;
  let quote = null; // "'" | '"' | the full dollar tag, e.g. '$$' or '$fn$'
  let escapeString = false; // the current '' was opened as E''

  const isIdent = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '\n') {
      inLineComment = false;
      atLineStart = quote === null && blockDepth === 0;
      i += 1;
      continue;
    }

    if (inLineComment) { i += 1; continue; }

    if (blockDepth > 0) {
      if (ch === '/' && next === '*') { blockDepth += 1; i += 2; continue; }
      if (ch === '*' && next === '/') { blockDepth -= 1; i += 2; continue; }
      i += 1;
      continue;
    }

    if (quote !== null) {
      if (quote === "'") {
        if (escapeString && ch === '\\') { i += 2; continue; }
        if (ch === "'" && next === "'") { i += 2; continue; }
        if (ch === "'") { quote = null; escapeString = false; i += 1; continue; }
        i += 1;
        continue;
      }
      if (quote === '"') {
        if (ch === '"' && next === '"') { i += 2; continue; }
        if (ch === '"') { quote = null; i += 1; continue; }
        i += 1;
        continue;
      }
      // dollar-quoted
      if (ch === '$' && sql.startsWith(quote, i)) { i += quote.length; quote = null; continue; }
      i += 1;
      continue;
    }

    // --- ordinary SQL ------------------------------------------------------
    if (atLineStart && !/\s/.test(ch)) {
      starts.push(i);
      atLineStart = false;
    }

    if (ch === '-' && next === '-') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && next === '*') { blockDepth = 1; i += 2; continue; }
    if (ch === '"') { quote = '"'; i += 1; continue; }
    if (ch === "'") {
      quote = "'";
      // E'...' (or e'...') gives backslash its escaping meaning back.
      const prev = sql[i - 1];
      escapeString = (prev === 'E' || prev === 'e') && !isIdent(sql[i - 2]);
      i += 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      // $1, $2 are parameter placeholders, not dollar quotes; the regex above
      // already refuses them.
      if (tag) { quote = tag[0]; i += tag[0].length; continue; }
    }
    i += 1;
  }
  return starts;
}

const stripMeta = (sql, label = 'sql') => {
  const NL = String.fromCharCode(10);
  const BACKSLASH = String.fromCharCode(92);
  const lines = sql.split(NL);

  // A line is "code" when its own first non-whitespace character is one of the
  // offsets the scanner reported as starting a line of ordinary SQL.
  const starts = new Set(sqlLineStarts(sql));
  const codeLines = new Set();
  {
    let offset = 0;
    for (let n = 0; n < lines.length; n += 1) {
      const indent = lines[n].length - lines[n].trimStart().length;
      if (starts.has(offset + indent)) codeLines.add(n);
      offset += lines[n].length + 1; // +1 for the newline that split() removed
    }
  }

  return lines
    .filter((line, n) => {
      if (line.trimStart()[0] !== BACKSLASH) return true;
      // Inside a dollar-quoted body, a string or a comment: leave it alone.
      if (!codeLines.has(n)) return true;
      const command = /^\\([A-Za-z?!]*)/.exec(line.trimStart())[1];
      if (META_ALLOWED.includes(command)) return false;
      throw new Error(
        `${label}: line ${n + 1} is a psql meta-command this applier does not `
        + `understand and will not silently drop:${NL}    ${line.trim()}${NL}`
        + `  Known meta-commands: ${META_ALLOWED.map((c) => BACKSLASH + c).join(', ')}.${NL}`
        + '  Either rewrite it as SQL, or add it to META_ALLOWED in db/apply.mjs on purpose.',
      );
    })
    .join(NL);
};

const client = new pg.Client({ connectionString: url });
await client.connect();

const run = async (label, sql) => {
  process.stdout.write(`> ${label}\n`);
  await client.query(stripMeta(sql, label));
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
