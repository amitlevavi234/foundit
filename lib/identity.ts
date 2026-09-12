/**
 * Who a request is, expressed as two transaction-local settings.
 *
 * This is the mechanism managed Supabase's PostgREST used to provide and
 * which, self-hosted, is ours to build — research/09 §3 calls it the heart of
 * the whole report. It lives in its own file, apart from the connection pool,
 * for the reason every load-bearing thing in this codebase does: so it can be
 * driven directly by a test, with a client that records what it was asked to
 * do, rather than being tested by inference from a page.
 *
 * FOUR THINGS HERE ARE LOAD-BEARING, and each is a documented way this fails
 * SILENTLY (research/09 §3, "the failure modes, in order of how badly they
 * end"):
 *
 *   ONE CLIENT, ONE TRANSACTION. The claim is set on a checked-out client and
 *   every statement runs on that same client. `pool.query()` hands the work to
 *   whichever connection is free, and the claim would then apply to nobody —
 *   or, worse, to somebody else's statement.
 *
 *   `is_local = true`, ALWAYS. That is what makes the setting die at COMMIT or
 *   ROLLBACK. Set it session-wide and the next request to take that pooled
 *   connection inherits the previous person's identity: horizontal privilege
 *   escalation that only appears under concurrency, which is to say never in
 *   testing and always in production.
 *
 *   `set_config($1, $2, true)` AND NOT `SET LOCAL`. `SET LOCAL` cannot take a
 *   bind parameter, so using it means concatenating a user id into SQL inside
 *   the authorization layer, which is the worst place in a codebase for an
 *   injection hole.
 *
 *   IT FAILS CLOSED. No claim, an empty claim or a malformed one all make
 *   `auth.uid()` null (0001 and 0013), `null = user_id` is null, no policy
 *   passes, reads return nothing and writes are refused. Forgetting to call
 *   this is a bug report rather than a breach.
 *
 * No `server-only` import: tests/session.test.mjs drives it in plain Node. What
 * keeps it off the client is that only lib/db.ts imports it.
 */

/** Who the request is, as far as the database is concerned. */
export interface RequestIdentity {
  /** The signed-in person, or null for a stranger. */
  userId: string | null;
  /** A collection share token out of the URL, or null. */
  shareToken?: string | null;
}

/** The narrow slice of `pg.PoolClient` this needs. */
export interface Transactional {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * The one statement that attaches an identity to a transaction.
 *
 * Both settings, in one round trip, both transaction-local. The share token
 * rides beside the claim because it is the same KIND of thing — a fact about
 * this request that a policy reads — and the opposite kind in every other way:
 * a capability somebody pasted, not an identity, opening exactly one row.
 */
export const SET_IDENTITY_SQL = `select set_config('request.jwt.claims', $1, true),
              set_config('request.share_token', $2, true)`;

/**
 * The claim string for a user id.
 *
 * An EMPTY STRING for a stranger, not `'{}'`: `auth.uid()` nullifs it before it
 * ever reaches a cast, which is the path with the fewest ways to go wrong. The
 * id goes through `JSON.stringify`, so an id containing a quote is escaped
 * rather than producing a claim that parses into something else.
 */
export function claimsFor(userId: string | null | undefined): string {
  return userId ? JSON.stringify({ sub: userId }) : '';
}

/** The two bind parameters, in order. */
export function identityParams(identity: RequestIdentity): [string, string] {
  return [claimsFor(identity.userId), identity.shareToken ?? ''];
}

/**
 * Run `fn` inside ONE transaction on ONE client, with `identity` applied as
 * transaction-local settings.
 *
 * The caller owns the client — lib/db.ts checks one out of the pool and
 * releases it — because acquiring and releasing is the pool's business and
 * this is the part that has to be right.
 */
export async function runWithIdentity<T>(
  client: Transactional,
  identity: RequestIdentity,
  fn: (tx: Transactional) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(SET_IDENTITY_SQL, identityParams(identity));
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection is already gone; the server rolls back on disconnect,
      // and the original error is the one worth reporting.
    }
    throw error;
  }
}
