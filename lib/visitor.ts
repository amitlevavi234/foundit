import 'server-only';

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
 * WHERE IT COMES FROM, AND WHAT IS HONEST ABOUT THAT.
 *
 * `docs/build-phases.md` and the Phase 4 brief say: `CF-Connecting-IP` when
 * present, and the socket address otherwise. The first half is exact and is
 * what production uses — every request reaches this application through the
 * Cloudflare Tunnel, and Cloudflare sets that header on every one of them.
 *
 * **The second half is not reachable in this framework, and pretending
 * otherwise would be worse than saying so.** A Next 15 Server Component is
 * handed request headers and nothing else; there is no supported API that
 * exposes the socket's remote address, and `request.ip` was removed. So the
 * fallback is the two headers a reverse proxy conventionally sets, and then a
 * single shared bucket.
 *
 * A shared bucket fails in the SAFE direction — everybody together gets sixty
 * an hour rather than everybody separately getting sixty an hour — so a
 * misconfigured deploy costs availability rather than money. It is also
 * unreachable in production: if `CF-Connecting-IP` is ever absent there, the
 * tunnel is not what is in front of us and that is a much larger problem than a
 * rate limit.
 *
 * NOTHING HERE TRUSTS A VISITOR-SUPPLIED HEADER IN PRODUCTION. `CF-Connecting-IP`
 * is set by Cloudflare and overwritten on every request, so a visitor cannot
 * forge it through the tunnel. `X-Forwarded-For` CAN be forged by anyone
 * talking to the origin directly — which is why it is last, why only its first
 * entry is read, and why it is worth remembering that the origin is not
 * reachable directly (no published port, `docs/loop-progress.md` Phase 0b).
 */

/** The bucket everybody shares when no address can be determined. */
export const SHARED_BUCKET = 'unattributed';

const ADDRESS_HEADERS = ['cf-connecting-ip', 'x-real-ip'] as const;

/**
 * A plausible address, or the shared bucket.
 *
 * Only the shape is checked, not the value: this string is about to be hashed,
 * and the only thing that matters is that two requests from the same visitor
 * produce the same one and a visitor cannot produce a fresh one per request by
 * putting junk in a header. Anything that is not an address-shaped string is
 * therefore ignored rather than used as a key of its own.
 */
const ADDRESS_SHAPE = /^[0-9a-fA-F:.]{3,45}$/;

function firstValid(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim() ?? '';
  return ADDRESS_SHAPE.test(first) ? first : null;
}

/**
 * The visitor's address as far as this process can tell.
 *
 * Async because `headers()` is async in Next 15. Returns `SHARED_BUCKET` rather
 * than throwing when there is nothing to go on, so a rate limiter never takes a
 * page down.
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
    const found = firstValid(list.get(name));
    if (found) return found;
  }
  return firstValid(list.get('x-forwarded-for')) ?? SHARED_BUCKET;
}
