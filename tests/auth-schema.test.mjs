// ===========================================================================
// Does db/migrations/0013_accounts.sql hold what Better Auth expects to find?
//
// The migration transcribes the DDL the library's own generator compiles,
// because this project keeps ONE record of what is in the database and that
// record is the migrations. Transcription drifts: an upgrade that adds a
// column would leave the library writing to a column that is not there — at
// two in the morning, on the one flow nobody can work around, with a message
// about a missing column that means nothing to the owner.
//
// So this asks the library itself, from the SAME configuration the application
// runs (lib/auth-options.ts), and compares table by table and column by
// column. It needs no database, no key and no network.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getAuthTables } from '@better-auth/core/db';

import { schemaOptions } from '../lib/auth-options.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIGRATION = readFileSync(join(ROOT, 'db', 'migrations', '0013_accounts.sql'), 'utf8');

/** The tables the migration creates in auth_core, with their column names. */
function tablesInMigration() {
  const tables = new Map();
  const re = /create table if not exists auth_core\."(\w+)" \(([\s\S]*?)\n\);/g;
  for (const [, name, body] of MIGRATION.matchAll(re)) {
    const columns = [...body.matchAll(/^\s*"(\w+)"\s+/gm)].map((m) => m[1]);
    tables.set(name, columns);
  }
  return tables;
}

const EXPECTED = getAuthTables(schemaOptions());
const FOUND = tablesInMigration();

test('the migration creates exactly the tables this configuration asks for', () => {
  const wanted = Object.values(EXPECTED).map((table) => table.modelName).sort();
  assert.deepEqual(
    [...FOUND.keys()].sort(),
    wanted,
    'a table Better Auth expects is missing from 0013_accounts.sql, or one is there that it does not use',
  );

  // The fifth one is there because lib/auth-options.ts asks for a
  // database-backed rate limiter rather than an in-memory one: memory resets
  // on every deploy, and a deploy is exactly when an attacker's counter
  // resetting matters (research/09 §6).
  assert.ok(wanted.includes('rateLimit'), 'the rate limiter is stored in the database');
});

test('and every column of every one of them', () => {
  for (const table of Object.values(EXPECTED)) {
    const columns = FOUND.get(table.modelName);
    assert.ok(columns, `auth_core."${table.modelName}" is not created by the migration`);

    const wanted = ['id', ...Object.values(table.fields).map((field) => field.fieldName)].sort();
    assert.deepEqual(
      [...columns].sort(),
      wanted,
      `auth_core."${table.modelName}" has drifted from what Better Auth writes to`,
    );
  }
});

test('the code is hashed at rest under a key, and neither is a library default', () => {
  // The library's default for `storeOTP` is 'plain'. A plaintext code in a
  // table is a live credential for its whole life: anybody with a backup, a
  // read replica or a SQL-injection foothold could sign in as whoever is
  // waiting for one.
  //
  // Its 'hashed' is not enough either, and that is the Phase 6 review's F3:
  // `defaultKeyHasher` is an unsalted, unkeyed SHA-256, and six digits is a
  // search space of 10^6 that sweeps in about two seconds. The configuration
  // is the object form with a hash of ours, keyed by BETTER_AUTH_SECRET, and
  // tests/otp-hash.test.mjs runs both sweeps against it.
  const options = schemaOptions();
  const source = readFileSync(join(ROOT, 'lib', 'auth-options.ts'), 'utf8');
  assert.match(source, /storeOTP: \{ hash: hashSignInCode \}/);
  // The old configuration line, not the prose about it two comments above.
  assert.doesNotMatch(
    source,
    /storeOTP: 'hashed' as const/,
    'the unkeyed digest does not come back',
  );
  assert.match(source, /createHmac\('sha256', signInCodeKey\(\)\)/);
  assert.match(source, /otpLength: OTP_LENGTH/);
  assert.match(source, /allowedAttempts: OTP_ALLOWED_ATTEMPTS/);
  assert.equal(options.rateLimit.storage, 'database');
});

test('only foundit_auth may touch any of it', () => {
  // The boundary in auth_core is the GRANT rather than a policy, because the
  // schema is not shared: one role reads and writes all of it. So the grant is
  // what this file can check from here, and db/test/accounts_test.sql §1
  // checks it from the database, from both sides.
  assert.match(
    MIGRATION,
    /grant select, insert, update, delete on\s*\n\s*auth_core\."user", auth_core\."session", auth_core\."account",\s*\n\s*auth_core\."verification", auth_core\."rateLimit"\s*\n\s*to foundit_auth;/,
    'the five tables are granted to foundit_auth and to nobody else',
  );
  assert.match(MIGRATION, /revoke all on schema auth_core from public;/);
  assert.match(MIGRATION, /alter role foundit_auth set search_path = auth_core;/);

  // And nothing anywhere in the migration hands the application role anything
  // in that schema.
  assert.doesNotMatch(
    MIGRATION,
    /grant[^;]*auth_core[^;]*to foundit_app/i,
    'foundit_app must hold nothing in auth_core',
  );
  assert.doesNotMatch(
    MIGRATION,
    /grant[^;]*public\.[^;]*to foundit_auth/i,
    'foundit_auth must hold nothing in public',
  );
});
