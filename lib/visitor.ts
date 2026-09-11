import 'server-only';

import { isIP } from 'node:net';
import { headers } from 'next/headers';

/**
 * Which visitor a request came from, for the rate limiter and for nothing else.
 *
 * WHAT THIS RETURNS IS IMMEDIATELY HASHED WITH A SECRET SALT AND THROWN AWAY
 * (lib/rate-limit.ts, `visitorKey`). It is never stored, never logged, never
 * put in a database row and never sent anywhere. It exists for one purpose: so
 * that sixty searches an hour means sixty per person rather than sixty in
 * total.
 *
 * THE GUARANTEE THIS ACTUALLY PROVIDES, stated plainly because an earlier
 * version of this comment overstated it:
 *
 *   **The per-visitor limit holds only with Cloudflare in front of us,
 *   overwriting `cf-connecting-ip` on every request.** That is the production
 *   arrangement — every request reaches this application through the Cloudflare
 *   Tunnel and there is no published port to reach the origin by (Phase 0b) —
 *   and under it a visitor cannot forge the header and cannot spread their
 *   searches across buckets.
 *
 *   **Traffic that reaches the origin directly shares one bucket.** Not one
 *   bucket each: one bucket between all of it. `x-forwarded-for` can be written
 *   by anybody talking to the origin, so trusting it there would let one
 *   attacker mint a fresh identity per request, which is worse than no limit at
 *   all because it would look like one. Sharing a bucket fails in the safe
 *   direction for the bill and the unsafe one for availability, and the
 *   arrangement that makes it unreachable is the tunnel.
 *
 * The socket address is not an option. `docs/build-phases.md` asks for it as
 * the fallback and Next 15 does not expose it: a Server Component is handed
 * request headers and nothing else, and `request.ip` was removed. Middleware
 * can see more, but it runs in a different runtime from this page, so the
 * in-memory bucket cannot be shared with it.
 */

/** The bucket everybody unattributable shares. Not one each — one between all. */
export const SHARED_BUCKET = 'unattributed';

/**
 * In order of how much they can be trusted.
 *
 * `cf-connecting-ip` is set by Cloudflare and overwritten on every request, so
 * a visitor cannot forge it through the tunnel. `x-real-ip` is the convention a
 * reverse proxy on the same host sets. `x-forwarded-for` is last and only its
 * first entry is read, because the rest of the list is whatever the client sent.
 */
const ADDRESS_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for'] as const;

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
function validAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim() ?? '';
  // isIP returns 4, 6, or 0 for "not an address at all".
  return isIP(first) === 0 ? null : first;
}

/**
 * The visitor's address as far as this process can tell, or `SHARED_BUCKET`.
 *
 * Async because `headers()` is async in Next 15. Returns the shared bucket
 * rather than throwing when there is nothing to go on, so a rate limiter never
 * takes a page down.
 */
export async function visitorAddress(): Promise<string> {
  let list: Awaited<ReturnType<typeof headers>>;
  try {
    list = await headers();
  } catch {
    // Rendered outside a request — a build-time prerender, say. There is no
    // visitor to limit.
    return SHARED_BUCKET;
  }

  for (const name of ADDRESS_HEADERS) {
    const found = validAddress(list.get(name));
    if (found) return found;
  }
  return SHARED_BUCKET;
}
