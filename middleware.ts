import { NextResponse, type NextRequest } from 'next/server';

/* ===========================================================================
 * The security headers, and a Content-Security-Policy with a nonce per
 * request.
 *
 * research/03 §9 item 25 and item 38, adapted. research/10 §5.2 sets the same
 * headers in a Caddyfile; there is no Caddy on the host (docs/product-
 * decisions.md §13, the addendum of 13 September 2026), so they are set here,
 * which is also where research/10 §1016 says a CSP belongs:
 *
 *     "Set it in next.config.js with a per-request nonce where the app knows
 *      its own script inventory, not in the proxy where it does not."
 *
 * It is `middleware.ts` rather than `next.config.mjs` because a nonce has to
 * be different on every response and `headers()` in the config is static.
 *
 * ---------------------------------------------------------------------------
 * HOW THE NONCE REACHES THE SCRIPT TAGS
 *
 * Next's documented pattern, and the two lines are not interchangeable:
 *
 *   requestHeaders.set('Content-Security-Policy', csp)   Next reads the nonce
 *                                                        OUT of this and puts
 *                                                        it on every script it
 *                                                        renders itself.
 *   response.headers.set('Content-Security-Policy', csp) what the BROWSER
 *                                                        enforces.
 *
 * `x-nonce` is set too, so a component that renders a script of its own can
 * read it from `headers()` — app/layout.tsx does, for the analytics beacon.
 *
 * ---------------------------------------------------------------------------
 * WHY `strict-dynamic`, AND WHAT IT COSTS
 *
 * `'strict-dynamic'` tells the browser to ignore every host in `script-src`
 * and trust only what a nonced script loads. That is the point: an allow-list
 * of hosts is bypassable through any one of them, and Next loads its chunks
 * from its own bootstrap, which carries the nonce.
 *
 * The cost is that a `<script src>` the app did NOT render — one injected
 * downstream, for instance by Cloudflare's automatic Web Analytics beacon — is
 * blocked. So the beacon is rendered by app/layout.tsx with the nonce instead
 * of being injected at the edge, and server/cloudflare/README.md says to leave
 * the automatic injection off. That is a deliberate trade and it is written
 * down in both places.
 *
 * ---------------------------------------------------------------------------
 * WHY `style-src` STILL HAS `'unsafe-inline'`
 *
 * item 25 forbids `'unsafe-inline'` **in `script-src`**, and that is where the
 * whole of its value is: an injected `<style>` cannot call `fetch`, cannot read
 * a cookie and cannot post a form. React writes inline `style` attributes, and
 * `'unsafe-inline'` is the only way to allow a style ATTRIBUTE — a nonce
 * cannot be attached to one. Saying so here is better than a
 * `style-src-attr` that silently does nothing in the browsers that matter.
 * ======================================================================== */

/**
 * Sentry's ingest hosts, by region, as wildcards.
 *
 * A DSN is `https://<key>@o<org>.ingest.<region>.sentry.io/<project>` and the
 * org number is not known until 9b creates the project. The alternative to a
 * wildcard is reading `SENTRY_DSN` here, and middleware runs in the Edge
 * runtime where `process.env` is replaced at BUILD time — so the value baked
 * into the image would be whatever the builder had, which is nothing. A
 * wildcard over one vendor's ingest subdomains is the honest version.
 *
 * `connect-src` and nothing else: Sentry's browser SDK is bundled by us and
 * loaded from `'self'`, so no Sentry host appears in `script-src`.
 */
const SENTRY_INGEST = [
  'https://*.ingest.sentry.io',
  'https://*.ingest.de.sentry.io',
  'https://*.ingest.us.sentry.io',
];

/** Cloudflare Web Analytics: the beacon's script, and where it reports to. */
const ANALYTICS_SCRIPT_HOST = 'https://static.cloudflareinsights.com';
const ANALYTICS_BEACON_HOST = 'https://cloudflareinsights.com';

/**
 * The policy, minus the nonce.
 *
 * `img-src 'self' data:` and no remote host: a tool's logo is never fetched
 * (next.config.mjs, tests/markup.test.mjs), so there is no third-party image
 * in this product and an allowance for one would be an allowance nobody needs.
 *
 * `form-action 'self'` is not in item 25 and is here anyway: every form in the
 * application posts to a Server Action on this origin, and an injected form
 * pointed somewhere else is the cheapest way to turn a markup bug into a
 * credential-harvesting page.
 */
function policy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${ANALYTICS_SCRIPT_HOST}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${SENTRY_INGEST.join(' ')} ${ANALYTICS_BEACON_HOST}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * The four headers of research/03 §9 item 38, plus the one research/10 §5.2
 * adds and item 38 leaves out.
 *
 * HSTS IS TWO YEARS WITH `preload`, which research/10 §5.2 explicitly declines
 * ("add `preload` only once you are certain about every subdomain"). We are
 * certain: `foundit.tools` and `www.foundit.tools` are the only names, both are
 * the same tunnel (server/setup/08-tunnel.sh), and nothing else will ever be
 * served from this zone over plain HTTP. 63072000 seconds is the two years the
 * preload list requires.
 *
 * `X-Frame-Options` is deliberately absent: `frame-ancestors 'none'` above is
 * its successor and says the same thing to every browser that matters. It is
 * not "missing"; it is covered.
 *
 * `X-Robots-Tag` IS DELIBERATELY ABSENT TOO, AND USED NOT TO BE. This list
 * carried `['X-Robots-Tag', 'index, follow']` and the matcher covers every
 * page, so the origin was affirmatively telling crawlers to index `/admin`,
 * `/saved`, `/results?q=<what somebody typed>` and — worst — `/c/<token>`, the
 * share link whose own page sets `robots: { index: false, follow: false }`
 * because "a link somebody sent to one person is not a page a search engine
 * should be able to hand to everybody". Google resolves that conflict in
 * favour of the more restrictive directive; nothing obliges another crawler
 * to. A header set in one place for every route cannot know which pages are
 * private, and page metadata already does: `app/layout.tsx` sets `index,
 * follow` as the default and each page overrides it. That is the Phase 9a
 * review's F16.
 *
 * THE SAME LIST, MINUS THE CSP, IS IN `next.config.mjs`. See `config.matcher`
 * at the foot of this file: the immutable assets are excluded from middleware
 * on purpose, and until F24 that meant they were served with no security
 * headers at all. `next.config.mjs`'s `headers()` puts the non-nonce ones back
 * on those paths, and tests/headers.test.mjs asserts the two lists agree.
 */
const HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
];

export function middleware(request: NextRequest): NextResponse {
  // 16 random bytes, base64. `crypto` is the Web Crypto global, which is what
  // the Edge runtime has; `node:crypto` is not importable here.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const csp = policy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of HEADERS) response.headers.set(name, value);
  return response;
}

/**
 * Everything except the build's own immutable assets.
 *
 * `_next/static` and `_next/image` are bytes with no HTML in them and no
 * script to nonce; running middleware over them would mint a nonce per chunk
 * and make every asset response vary, which is exactly what Cloudflare's cache
 * rule 2 (server/cloudflare/README.md) is trying not to do. `favicon.ico` and
 * the icon routes are the same kind of thing.
 *
 * THE EXCLUSION IS RIGHT AND ITS CONSEQUENCE WAS NOT (F24). Skipping
 * middleware skipped `nosniff`, `Referrer-Policy`, HSTS, COOP and CORP as
 * well as the nonce, so every chunk came back with nothing but a
 * `Cache-Control` — and `server/cloudflare/README.md` forbids putting them
 * back with a Transform Rule at the edge. `next.config.mjs`'s `headers()`
 * covers exactly these paths with exactly the headers above, none of which
 * varies per request.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)'],
};
