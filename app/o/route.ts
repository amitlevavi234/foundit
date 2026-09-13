import { headers } from 'next/headers';

import { recordToolOpen } from '@/lib/accounts';
import { allowOutboundOpen } from '@/lib/rate-limit';
import { visitorAddress } from '@/lib/visitor';

/* ===========================================================================
 * POST /o — the outbound-click beacon.
 *
 * WHY THIS ROUTE EXISTS, AND WHY IT IS NOT ON THE TOOL PAGE. Phase 8 counted
 * the click with a Server Action, and a Server Action posts to the page's own
 * URL. So every counted click was a `POST /tools/<slug>` in the request line of
 * every access log in front of the application, beside the visitor's address
 * and a timestamp — which is precisely the join 0019 §3 says this product does
 * not make:
 *
 *     "A log line carrying a slug beside a timestamp, next to a web server's
 *      access log carrying an address beside the same timestamp, is the join
 *      this product does not make."
 *
 * That was true of the function and false of the request. The slug moves into
 * the BODY, the path becomes one character that is the same for every listing,
 * and the access log learns that somebody opened something. Which something is
 * not in it.
 *
 * WHAT THIS ROUTE ANSWERS: 204, always, to everybody. Not 200 for a slug that
 * exists and 404 for one that does not; not 429 when the bound is reached; not
 * 403 when the Origin is wrong. A status code that varies is an oracle, and
 * the thing on the other end of it is a script.
 *
 * ORIGIN-CHECKED, because a Route Handler gets none of the protection a Server
 * Action gets. Next verifies the Origin of a Server Action request itself;
 * nothing verifies one of these, so it is done here. A browser sends `Origin`
 * on every POST, including a same-origin one, so a missing Origin is not a
 * browser and is refused with the same 204 as everything else.
 *
 * BOUNDED, which the Server Action was not: `allowOutboundOpen` spends one
 * token from the visitor's own hourly bucket and one from a daily cap for the
 * whole process. Over either, this returns 204 and counts nothing. The address
 * is hashed with the per-process salt inside `visitorKey` and dropped, exactly
 * as it is for a search — nothing new is stored anywhere.
 *
 * NO SESSION IS READ. `currentUserId()` is not called, no cookie is looked at,
 * and `recordToolOpen` opens its transaction with no identity claim at all
 * (lib/accounts.ts). A signed-in person's click and a stranger's are the same
 * statement.
 *
 * THE LINK ITSELF IS UNTOUCHED. components/OutboundLink.tsx still renders a
 * plain `https` anchor straight at the maker with `rel="noopener noreferrer"`,
 * it still works with JavaScript off, and the beacon never blocks the
 * navigation — it is a `fetch` with `keepalive`, fired and not awaited.
 * ======================================================================== */

/** Nothing here may be cached, prerendered or reused. */
export const dynamic = 'force-dynamic';

/** One answer, and it is the only answer. A new Response each time, because a
 *  Response is consumed once and a shared one is a bug waiting for traffic. */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Is this POST from our own pages?
 *
 * `origin` against `host`, and not against a configured URL: behind the
 * Cloudflare Tunnel the request's own Host header is what the browser typed,
 * and comparing the two needs no environment variable to be right. A missing
 * or unparseable Origin is not a browser.
 */
function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The slug, out of the body, in either of the two shapes a browser sends.
 *
 * `application/json` is what `fetch` sends from the component; a form post is
 * what a future no-JavaScript fallback would send. Anything else is nothing.
 */
async function slugFrom(request: Request): Promise<string> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = (await request.json()) as { slug?: unknown };
      return typeof body?.slug === 'string' ? body.slug : '';
    }
    if (
      type.includes('application/x-www-form-urlencoded')
      || type.includes('multipart/form-data')
    ) {
      const form = await request.formData();
      const slug = form.get('slug');
      return typeof slug === 'string' ? slug : '';
    }
  } catch {
    // A body that is not what it said it was counts as no slug at all.
  }
  return '';
}

export async function POST(request: Request): Promise<Response> {
  const incoming = await headers();
  if (!sameOrigin(incoming.get('origin'), incoming.get('host'))) return noContent();

  const slug = await slugFrom(request);
  // The same shape check lib/accounts.ts makes, here so that a wildly wrong
  // value is not even a rate-limiter key.
  if (slug === '' || slug.length > 120) return noContent();

  if (!allowOutboundOpen(await visitorAddress())) return noContent();

  await recordToolOpen(slug);
  return noContent();
}

/**
 * Every other method, so that GET /o is not a 405 that says the route is here
 * for something.
 */
export async function GET(): Promise<Response> {
  return noContent();
}
