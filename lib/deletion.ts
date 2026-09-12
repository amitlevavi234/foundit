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
 *   2. THEN THE PERSONAL DATA in `public`: one delete, one row, and 0001's
 *      cascades take the reviews, likes, collections, saved items and claims
 *      with it.
 *   3. THEN THE ACCOUNT ITSELF: the OAuth links, any code still in flight, and
 *      the user row.
 *
 * WHY NOT PUBLIC FIRST. The order this phase was briefed with was public, then
 * auth_core. It leaves a window where the profile is gone and the session
 * still works — a signed-in person with no profile, whose very next request
 * would create them a new one from the same session and quietly undelete the
 * account they had just closed. Killing the credential first costs nothing and
 * closes that window, and it is the only change to the brief this phase made
 * to a stated order. docs/product-decisions.md §18 records it.
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

/** The steps, in the order they must happen. Named so a test can assert it. */
export const DELETION_ORDER = ['sessions', 'publicRows', 'accounts', 'codes', 'user'] as const;

export type DeletionStep = (typeof DELETION_ORDER)[number];

export interface DeletionSteps {
  /** Kill every session for this user. Runs first, always. */
  sessions(): Promise<number>;
  /** Delete their profile row; the cascades do the rest. */
  publicRows(): Promise<number>;
  /** Their Google link, if they had one. */
  accounts(): Promise<number>;
  /** Any unused code sitting in the verification table. */
  codes(): Promise<number>;
  /** The account row itself. */
  user(): Promise<number>;
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
