import 'server-only';

import { headers } from 'next/headers';

import { SHARED_BUCKET, bucketFor } from './visitor-policy.ts';

/**
 * Which visitor a request came from, for the rate limiter and for nothing else.
 *
 * THE BRIDGE ONLY. Everything about WHICH header is believed, and when, is in
 * lib/visitor-policy.ts — a pure module a test can import, which this one
 * cannot be because of the two imports above. This file's whole job is to hand
 * the request's headers to that decision.
 *
 * THE GUARANTEE THIS ACTUALLY PROVIDES, stated plainly:
 *
 *   **The per-visitor limit holds only where something in front of this
 *   process overwrites `cf-connecting-ip` on every request, and only when the
 *   deployment says so with `TRUST_CLOUDFLARE_HEADERS=1`.** That is the
 *   production arrangement — every request reaches this application through
 *   the Cloudflare Tunnel and there is no published port to reach the origin
 *   by (Phase 0b) — and under it a visitor cannot forge the header and cannot
 *   spread their searches across buckets.
 *
 *   **Everything else shares one bucket.** Not one bucket each: one bucket
 *   between all of it. Until the Phase 9a review that sentence was written
 *   down in three places and was false; `cf-connecting-ip` was trusted
 *   unconditionally and first, so one client could mint a fresh identity per
 *   request by typing one. It is true now because the flag is what decides,
 *   and nothing sets the flag except the host.
 *
 * The raw address never leaves this process: `lib/rate-limit.ts` hashes it
 * with a per-process random salt on the way in and drops the string.
 */

export { SHARED_BUCKET } from './visitor-policy.ts';

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

  return bucketFor((name) => list.get(name));
}
