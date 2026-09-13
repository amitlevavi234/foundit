import { isIP } from 'node:net';

/**
 * Which bucket a request's headers put it in — the DECISION, with nothing
 * around it.
 *
 * IT IS ITS OWN FILE SO THAT A TEST CAN DRIVE IT. `lib/visitor.ts` begins with
 * `import 'server-only'` and reads `headers()` from `next/headers`; neither
 * can be imported by `node --test`, so for two phases the only thing any test
 * could say about this decision was a regular expression over the source. The
 * Phase 9a review then found the decision was wrong — the header it trusted
 * first is one anybody can write — and a grep over a constant name would have
 * gone on passing. A pure function with a header getter and an environment is
 * the same logic with the two untestable imports lifted off it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RETURNS IS IMMEDIATELY HASHED WITH A SECRET SALT AND THROWN AWAY
 * (lib/rate-limit.ts, `visitorKey`). It is never stored, never logged, never
 * put in a database row and never sent anywhere. It exists for one purpose: so
 * that sixty searches an hour means sixty per person rather than sixty in
 * total.
 *
 * ---------------------------------------------------------------------------
 * THE HEADER IS ONLY BELIEVED WHERE SOMETHING OVERWRITES IT, AND THAT IS THE
 * PHASE 9a REVIEW'S F2.
 *
 * The previous version read `cf-connecting-ip`, then `x-real-ip`, then
 * `x-forwarded-for`, and returned the first that parsed as an address. Its own
 * comment said that traffic reaching the origin directly would share ONE
 * bucket, because "`x-forwarded-for` can be written by anybody and trusting it
 * there would let one attacker mint a fresh identity per request".
 *
 * `cf-connecting-ip` can be written by anybody too, and it was trusted FIRST.
 * The review sent sixty searches with one forged `cf-connecting-ip` and
 * exhausted that bucket, then forty more with a different forged address each
 * time and was refused none of them: one hundred searches, zero refusals, one
 * `curl` loop. The documented fallback was not merely weak, it was false in the
 * dangerous direction — off the tunnel every visitor got a FRESH bucket per
 * request rather than sharing one.
 *
 * So the header is believed only where the deployment says, explicitly, that
 * something in front of this process overwrites it:
 *
 *   TRUST_CLOUDFLARE_HEADERS=1   set on the host, in /root/.foundit/app.env,
 *                                by docs/launch-runbook.md step 1d, and
 *                                nowhere else. Not in .env.example's own
 *                                values, not in CI, not in a test.
 *
 * Unset, every visitor shares `SHARED_BUCKET` — one bucket between all of
 * them, which is what `.env.example` has claimed all along and is now true.
 * That fails in the safe direction for the bill and the unsafe one for
 * availability, and the arrangement that makes it unreachable is the tunnel:
 * the origin has no published port, so the only traffic that can arrive
 * without the header is traffic already on the host.
 *
 * `x-real-ip` and `x-forwarded-for` are NEVER read, with or without the flag.
 * Nothing in this deployment writes either of them — there is no reverse proxy
 * on the host (docs/product-decisions.md §13) — so a request carrying one has
 * had it written by the client, and a second trusted name is a second way
 * round the first.
 *
 * The socket address is not an option. `docs/build-phases.md` asks for it as
 * the fallback and Next 15 does not expose it: a Server Component is handed
 * request headers and nothing else, and `request.ip` was removed. Middleware
 * can see more, but it runs in a different runtime from the page, so the
 * in-memory bucket cannot be shared with it.
 */

/** The bucket everybody unattributable shares. Not one each — one between all. */
export const SHARED_BUCKET = 'unattributed';

/**
 * The ONE header that may become a bucket key, and only behind the flag.
 *
 * Cloudflare sets it on every request it proxies and overwrites whatever the
 * client sent, so behind the tunnel a visitor cannot forge it. In front of the
 * tunnel it is a string like any other, which is why the flag exists.
 */
export const TRUSTED_HEADER = 'cf-connecting-ip';

/** The environment variable that says an overwriting proxy is in front. */
export const TRUST_VARIABLE = 'TRUST_CLOUDFLARE_HEADERS';

/** Is something in front of this process overwriting `TRUSTED_HEADER`? */
export function trustsForwardedAddress(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[TRUST_VARIABLE] ?? '').trim() === '1';
}

/**
 * A real IP address, or null.
 *
 * `net.isIP` and not a regular expression. The shape check this replaced —
 * "three to forty-five characters of hex, colons and dots" — accepted `abc`,
 * `deadbeef` and `::::`, which meant a visitor could mint a fresh bucket per
 * request by putting a different meaningless string in the header. A rate limit
 * somebody can opt out of by typing is not a rate limit; it is a rate limit
 * shaped decoration, which is worse, because it stops anybody looking.
 */
export function validAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim() ?? '';
  // isIP returns 4, 6, or 0 for "not an address at all".
  return isIP(first) === 0 ? null : first;
}

/**
 * The bucket key for one request's headers.
 *
 * `get` is anything that answers a header by name — `Headers`, Next's
 * `ReadonlyHeaders`, or a plain function in a test.
 */
export function bucketFor(
  get: (name: string) => string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  if (!trustsForwardedAddress(env)) return SHARED_BUCKET;
  return validAddress(get(TRUSTED_HEADER)) ?? SHARED_BUCKET;
}
