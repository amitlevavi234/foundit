/**
 * Closing an account, across a boundary that cannot be one transaction.
 *
 * A person's rows live in two schemas, reached by two roles, through two
 * connection pools. PostgreSQL has no way to make those one transaction —
 * two sessions as two roles cannot share one — so "all or nothing" is not
 * available, and pretending otherwise would be the actual danger. What is
 * available is an ORDER, chosen by what a half-completed deletion leaves
 * behind, and that order is this file.
 *
 *   1. THE SESSIONS GO FIRST. From that instant the cookie in their browser
 *      opens nothing, and neither does one anybody stole. Everything that can
 *      fail after this fails on an account nobody can sign into.
 *   2. THEN THE DELETION IS MARKED, in `auth_core.deletions`, before one row of
 *      theirs is touched. See below.
 *   3. THEN THE PERSONAL DATA in `public`: one delete, one row, and 0001's
 *      cascades take the reviews, likes, collections, saved items and claims
 *      with it.
 *   4. THEN THE ACCOUNT ITSELF: the OAuth links, any code still in flight, and
 *      the user row.
 *   5. AND ONLY THEN THE MARKER, which is the last statement of a run that got
 *      all the way through.
 *
 * WHY NOT PUBLIC FIRST. The order this phase was briefed with was public, then
 * auth_core. It leaves a window where the profile is gone and the session
 * still works — a signed-in person with no profile, whose very next request
 * would create them a new one from the same session and quietly undelete the
 * account they had just closed. Killing the credential first costs nothing and
 * closes that window, and it is the only change to the brief this phase made
 * to a stated order. docs/product-decisions.md §18 records it.
 *
 * WHY THE MARKER, which the Phase 6 review asked for (F8). Killing the session
 * closes one window and leaves its mirror: if a step AFTER `publicRows` fails,
 * `auth_core."user"` and the Google `account` row survive with the profile
 * already gone, so the person signs in again, `ensureProfile` makes them a
 * fresh profile from the same user id, and the account they closed comes back
 * as an empty shell. The marker is written before anything is removed and
 * removed after everything is, so:
 *
 *   a run that STOPPED leaves a marker, and lib/accounts.ts refuses to create
 *   a profile for an id that carries one — the shell cannot be re-animated;
 *   a run that FINISHED leaves nothing at all, marker included, which is what
 *   the phase's "zero rows for that id, everywhere" has to keep meaning.
 *
 * The alternative was to delete the user row before the public rows. It closes
 * the same window and opens a worse one: a failure would then leave a profile,
 * reviews, likes and saved lists behind with no account able to reach them and
 * nobody able to retry. Personal data that outlives the promise to delete it is
 * a bigger failure than an empty shell.
 *
 * The steps are an argument rather than an import so that tests/deletion.test.mjs
 * can fail each one in turn and watch what is left — the same function the
 * application runs, which is the only way that test means anything. No
 * `server-only` import, for that reason.
 */

/** The statements, against Better Auth's tables. Unqualified: the pool's
 * search_path is auth_core and the role can reach nothing else. */
export const DELETE_SESSIONS_SQL = 'delete from "session" where "userId" = $1';
export const DELETE_ACCOUNTS_SQL = 'delete from "account" where "userId" = $1';
export const DELETE_USER_SQL = 'delete from "user" where "id" = $1';

/**
 * Any code still in flight for this address.
 *
 * The three identifiers Better Auth's email-OTP plugin builds, written out
 * rather than matched with LIKE: an email address may contain `_` and `%`,
 * which are LIKE's own wildcards, so a pattern would quietly match other
 * people's rows. Exact strings cannot.
 */
export const DELETE_CODES_SQL = `
  delete from "verification"
   where "identifier" in ('sign-in-otp-' || $1,
                          'email-verification-otp-' || $1,
                          'forget-password-otp-' || $1)`;

/**
 * The marker, in `auth_core.deletions` (db/migrations/0016_deletion_marker.sql).
 *
 * Unqualified for the same reason as the three above, and lower case because
 * this table is ours rather than Better Auth's.
 *
 * `on conflict do nothing`: pressing the button twice, or retrying a run that
 * failed, is not an error — the marker means "a deletion has started", and it
 * has.
 */
export const MARK_DELETION_SQL =
  'insert into deletions (user_id) values ($1) on conflict do nothing';
export const UNMARK_DELETION_SQL = 'delete from deletions where user_id = $1';
export const IS_DELETING_SQL = 'select 1 from deletions where user_id = $1';

/** The steps, in the order they must happen. Named so a test can assert it. */
export const DELETION_ORDER = [
  'sessions',
  'mark',
  'publicRows',
  'accounts',
  'codes',
  'user',
  'unmark',
] as const;

export type DeletionStep = (typeof DELETION_ORDER)[number];

export interface DeletionSteps {
  /** Kill every session for this user. Runs first, always. */
  sessions(): Promise<number>;
  /** Write the marker, before anything of theirs is removed. */
  mark(): Promise<number>;
  /** Delete their profile row; the cascades do the rest. */
  publicRows(): Promise<number>;
  /** Their Google link, if they had one. */
  accounts(): Promise<number>;
  /** Any unused code sitting in the verification table. */
  codes(): Promise<number>;
  /** The account row itself. */
  user(): Promise<number>;
  /** Take the marker away. Last, so every failure before it keeps it. */
  unmark(): Promise<number>;
}

export type DeletionOutcome = Record<DeletionStep, number>;

/** Raised when a step fails, carrying what had already been done. */
export class DeletionError extends Error {
  readonly step: DeletionStep;
  readonly done: Partial<DeletionOutcome>;

  constructor(step: DeletionStep, done: Partial<DeletionOutcome>, cause: unknown) {
    super(`account deletion stopped at "${step}"`);
    this.name = 'DeletionError';
    this.step = step;
    this.done = done;
    this.cause = cause;
  }
}

/**
 * Run the steps in order, stopping at the first failure and reporting how far
 * it got.
 *
 * It does not retry and does not continue past a failure: a step that failed
 * once is a database that is not answering, and the next step is against the
 * same database. What it guarantees is the ordering — and therefore that
 * whatever is left behind, a session is not part of it.
 */
export async function runDeletion(steps: DeletionSteps): Promise<DeletionOutcome> {
  const done: Partial<DeletionOutcome> = {};
  for (const step of DELETION_ORDER) {
    try {
      done[step] = await steps[step]();
    } catch (error) {
      throw new DeletionError(step, done, error);
    }
  }
  return done as DeletionOutcome;
}

/**
 * Has a deletion started for this account and not finished?
 *
 * `ask` runs the statement — the auth pool in lib/accounts.ts, a fake in
 * tests/deletion.test.mjs — and answers how many rows came back. The argument
 * is what lets this be the same function in both places.
 *
 * IT FAILS CLOSED. A database that will not answer is not a reason to create a
 * profile for an account somebody asked us to close; it is a reason to do
 * nothing. The cost of being wrong in this direction is a signed-in person
 * seeing the signed-out header for as long as the database is down, which is
 * the same thing every other read on the page is about to do.
 */
export async function accountIsClosing(
  userId: string,
  ask: (sql: string, values: unknown[]) => Promise<number>,
): Promise<boolean> {
  try {
    return (await ask(IS_DELETING_SQL, [userId])) > 0;
  } catch (error) {
    console.error(
      `the deletion marker could not be read (${
        (error as { code?: string } | null)?.code ?? 'unknown'
      }); refusing to create a profile`,
    );
    return true;
  }
}
