import 'server-only';

import pg from 'pg';

/* ===========================================================================
 * Better Auth's door to PostgreSQL, and nothing else's.
 *
 * There are now TWO pools in this application and the difference between them
 * is the security boundary this phase draws:
 *
 *   lib/db.ts       connects as `foundit_app`. Every page, every action, every
 *                   search. Subject to row-level security on every statement,
 *                   and holds no grant at all in `auth_core`.
 *   this file       connects as `foundit_auth`. Better Auth's own five tables
 *                   in `auth_core`, and no grant anywhere else — not on the
 *                   catalogue, not on reviews, not on the search log.
 *
 * So a SQL-injection bug in the catalogue cannot read a session token, and a
 * bug in the authentication library cannot read a review. Neither role can do
 * the other's job, which is the point: they are two failures rather than one.
 *
 * There is deliberately no fallback between the two connection strings, for
 * the same reason docs/development.md gives about the other three: a fallback
 * would quietly reinstate the thing the split exists to prevent, on the day
 * somebody's environment was misconfigured, and nothing would look broken.
 * ======================================================================== */

/**
 * Sessions are read on nearly every request, so this pool is busy — but every
 * statement through it is a primary-key hit on a database on the same box.
 * Four is generous; PostgreSQL is configured for 30 connections in total and
 * the web pool already takes eight.
 */
const POOL_MAX = 4;

const STATEMENT_TIMEOUT_MS = 5_000;

declare global {
  var __founditAuthPool: pg.Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL_AUTH;
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL_AUTH is not set. It is the foundit_auth connection string — the one ' +
        'role that may touch the auth_core schema — and it is read from the environment ' +
        'and nowhere else. There is no fallback to DATABASE_URL on purpose.',
    );
  }

  // The same guard lib/db.ts has, pointing the other way. A deploy that hands
  // this pool the owner's credentials, or the application's, would work
  // perfectly and dissolve the boundary while doing it.
  let user = '';
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    // Not a URL this can parse. Let pg report it; nothing here repeats the
    // string back, because it holds a password.
    return url;
  }
  if (user !== 'foundit_auth') {
    throw new Error(
      `DATABASE_URL_AUTH connects as "${user}". Better Auth connects as foundit_auth, which ` +
        'holds nothing outside auth_core. The owner role is for migrations only and ' +
        'foundit_app is for the application.',
    );
  }
  return url;
}

function createPool(): pg.Pool {
  const pool = new pg.Pool({
    connectionString: connectionString(),
    max: POOL_MAX,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'foundit-auth',
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 500,
    // Better Auth's adapter writes unqualified table names — `"user"`,
    // `"session"` — so the search path is what puts them in auth_core. The
    // migration sets the same thing on the ROLE, so a psql session opened as
    // foundit_auth behaves identically and this is a statement of intent
    // rather than the only thing holding it up.
    options: '-c search_path=auth_core',
  });

  // An idle client that errors with no listener attached takes the process
  // down with an unhandled rejection. The message can carry the connection
  // string, so it is not re-raised anywhere it could reach a log or a page.
  pool.on('error', () => {});

  return pool;
}

/**
 * One pool, reused across requests, parked on `globalThis` so that Next's
 * development-mode module replacement does not leak four more connections on
 * every save.
 *
 * Exported rather than wrapped, because the consumer is a library: Better Auth
 * takes a `pg.Pool` and builds its own statements. That is the one place in
 * this codebase where a raw pool leaves a module, and it is why the role behind
 * it can do so little.
 */
export function authPool(): pg.Pool {
  globalThis.__founditAuthPool ??= createPool();
  return globalThis.__founditAuthPool;
}

/** True when there is a connection string to build a pool from at all. */
export function authDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL_AUTH;
  return typeof url === 'string' && url.trim() !== '';
}
