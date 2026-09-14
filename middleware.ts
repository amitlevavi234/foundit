import { NextResponse, type NextRequest } from 'next/server';

import { COUNT_HEADER, countsAsPageView } from './lib/page-view-policy.ts';
import { ROUTER_DOCUMENT, ROUTER_HEADER } from './lib/router-headers.ts';

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

/* ===========================================================================
 * ONE PAGE VIEW, DECIDED WHERE THE HEADERS ARE STILL READABLE — the owner's
 * item 10, and OWNER FEEDBACK, ROUND 1, F3.
 *
 * `app/layout.tsx` used to make this decision itself:
 *
 *     if (!incoming.get('rsc') && !incoming.get('next-router-prefetch'))
 *       countPageView();
 *
 * The prefetch half worked. The RSC half did not: `headers()` in a Server
 * Component does not expose `RSC` on this build, so `incoming.get('rsc')` was
 * always null and EVERY client-side navigation counted a second page view for
 * a page the visitor was already on. Ten requests carrying `RSC: 1` produced
 * ten counts where the panel's caption promised zero — which is the one
 * direction `app/layout.tsx`'s own comment says the number must never be wrong
 * in, "bigger than the truth in the direction that flatters it".
 *
 * Middleware still has the raw headers, so the decision is made here and
 * travels to the layout as ONE header it can only be told:
 *
 *     x-foundit-count: 1
 *
 * The RULE itself is in `lib/page-view-policy.ts`, so that every row of the
 * reviewer's table is a line in `tests/page-views.test.mjs` rather than a
 * paragraph in this comment; that file also lists what is counted and why.
 *
 * The header is SET OR DELETED on every request and never merely set. Without
 * the delete a visitor could send it themselves and count as many page views
 * as they liked, which would be the same defect with a worse cause.
 * ======================================================================== */

/* ===========================================================================
 * THE `Origin: null` FIVE HUNDRED — the owner's items 4, 5, 6 and 7.
 *
 * The owner pressed Save and Like on `/tools/anki` and got a 500. The log:
 *
 *     POST /tools/anki?q=… 500
 *     TypeError: Invalid URL, input: 'null'
 *
 * It is not our code. `next/dist/server/app-render/action-handler.js` opens
 * the Server Action path with, verbatim:
 *
 *     const originDomain = typeof req.headers['origin'] === 'string'
 *       ? new URL(req.headers['origin']).host : undefined;
 *
 * — no `try`. `Origin` is a header a browser is allowed to send as the three
 * letters `null`: the header carries a SERIALIZED origin, and an opaque origin
 * serializes to `null` (HTML, "origin"; Fetch, "append a request Origin
 * header"). A document reached through a redirect chain, one whose referrer
 * the policy stripped, and a sandboxed frame all produce it. Chrome then posts
 * the form — a `<form encType="multipart/form-data">` is exactly what Next
 * renders for a Server Action, and exactly what the browser submits when the
 * page is not hydrated yet — and `new URL('null')` throws before anything of
 * ours runs. Reproduced on this laptop against `next dev` 15.5.25:
 *
 *     Origin: null                  → 500   TypeError: Invalid URL
 *     (no Origin header at all)     → 303   the action ran
 *     Origin: http://localhost:3000 → 303   the action ran
 *
 * Next already treats a MISSING `Origin` as "an old browser", logs a warning
 * and runs the action. So an unparseable one is not a stricter case than a
 * missing one — it is the same case arriving in a shape that crashes. This
 * normalises it to the request's own origin before Next looks at it, which is
 * the "same-site default" the brief asks for, and leaves the crash impossible
 * rather than caught.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT GIVE AWAY — REWRITTEN, because the first version of this
 * paragraph was wrong in three places and it is the paragraph the next person
 * to touch this file reasons from (OWNER FEEDBACK, ROUND 1, F7 and overclaims
 * 6, 7 and 7b).
 *
 * IT SAID: "A genuine cross-site POST always carries a real `Origin`; it never
 * arrives missing." That is false. Fetch, "append a request `Origin` header",
 * sets the serialized origin to the four characters `null` for a non-GET
 * request whose mode is not "cors" when the referrer policy is `no-referrer` —
 * so an attacker page that sends `Referrer-Policy: no-referrer` produces
 * exactly the header this normalises. Opaque origins (a sandboxed frame, a
 * document reached through a redirect chain) produce it too.
 *
 * IT SAID: "`Sec-Fetch-Site` is sent by every browser that sends `Origin` at
 * all." Also false, twice over. Fetch Metadata is appended only for a
 * POTENTIALLY TRUSTWORTHY url, so a plain-HTTP origin that is not localhost
 * sends `Origin` and no `Sec-Fetch-*`; and Safari before 16.4 and Firefox
 * before 90 send `Origin` and no `Sec-Fetch-*` anywhere.
 *
 * IT CITED `lib/auth-options.ts` for `SameSite=Lax`. That file contains no
 * `sameSite` at all. It is `lib/auth.ts`.
 *
 * WHAT IS ACTUALLY TRUE, and it is still enough:
 *
 *   The session cookie is `SameSite=Lax` (`lib/auth.ts`), so a cross-site POST
 *   does not carry a session at all. That — not `Sec-Fetch-Site` — is what
 *   makes a forged POST to Save, Like, Review or the add flow harmless: it
 *   arrives signed out and those actions have nothing to do signed out.
 *
 *   So the exposure the origin rules are actually protecting is the SESSIONLESS
 *   actions: filing a report, asking for a sign-in code, and the beacon. Those
 *   work for a stranger by design, which means a cross-site POST can reach
 *   them, which means the only thing standing in front of them is whether the
 *   request looks like a browser doing an ordinary thing.
 *
 *   `Sec-Fetch-Site: cross-site` beside an unparseable origin is therefore
 *   still worth acting on — it gets an origin that can never match our host,
 *   so Next refuses it with its own message rather than throwing — but it is a
 *   signal and not a backstop, and this file no longer claims otherwise.
 *
 *   AND THE PAIR NO BROWSER PRODUCES IS REFUSED OUTRIGHT. A Server Action POST
 *   with no parseable `Origin` AND no `Sec-Fetch-Site` at all is not any of the
 *   cases above: a browser old enough to omit Fetch Metadata is old enough to
 *   send a real `Origin`, and a browser new enough to send `Origin: null` sends
 *   `Sec-Fetch-Site` with it. That combination is a script, and it gets a 403
 *   with a sentence instead of a normalised origin.
 *
 * ---------------------------------------------------------------------------
 * AND IT IS SCOPED TO SERVER ACTIONS NOW, WHICH IT WAS NOT — F7.
 *
 * The rewrite ran for EVERY POST on EVERY route, and two things downstream had
 * deliberately stricter rules of their own that it silently disabled:
 *
 *   `app/o/route.ts` says in its own header that "a missing Origin is not a
 *   browser and is refused". That refusal was dead: the route was handed an
 *   origin middleware had written, so a `POST /o` with no Origin header at all
 *   counted a click. Reproduced, twice, on the reviewed build.
 *
 *   Better Auth's `validateOrigin` throws `MISSING_OR_NULL_ORIGIN` for a
 *   cookie-bearing POST whose `Origin` is absent or `null`. It never saw what
 *   the client sent.
 *
 * Neither of those is Next's action handler, which is the only consumer the
 * rewrite was ever written for. So the rewrite now runs only where Next's
 * action handler will actually read the header — a `Next-Action` header, or a
 * `multipart/form-data` POST to a page route, which is what an unhydrated
 * browser submits and what carries the `$ACTION_ID_` field. `/api/*` and `/o`
 * are outside the rewrite's own matcher, so Better Auth and the beacon are
 * handed exactly what the client sent.
 *
 * They are still handed it a second way as well: `x-original-origin` carries
 * the client's value verbatim on every request, and `app/o/route.ts` is the one
 * thing that reads it. Belt and braces, so that a later widening of the scope
 * above cannot quietly disarm the beacon's own check again.
 * ======================================================================== */

/** An origin Next can parse, or null. `'null'` and `''` are not origins. */
function parsedOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host ? value : null;
  } catch {
    return null;
  }
}

/**
 * Routes the Origin rewrite never touches, whatever they are posting.
 *
 * `/api/*` is Better Auth (and any route handler added later), `/o` is the
 * beacon. Both have origin rules of their own that are stricter than Next's,
 * and both are the reason F7 exists. This is the rewrite's OWN matcher and not
 * `config.matcher` at the foot of the file, because these paths must keep the
 * security headers and the nonce — excluding them from middleware altogether
 * would trade one finding for a worse one.
 */
const NO_ORIGIN_REWRITE = /^\/(?:api|o)(?:\/|$)/;

/** The header `app/o/route.ts` reads. Never believed from a client. */
const ORIGINAL_ORIGIN_HEADER = 'x-original-origin';

/**
 * Is this a request Next's Server Action handler will read `Origin` from?
 *
 * Two shapes and no others. `Next-Action` is what the hydrated client sends.
 * A `multipart/form-data` POST to a page route is what an UNHYDRATED browser
 * sends — `<form encType="multipart/form-data">` is exactly what Next renders
 * for a Server Action — and it is the shape the owner's own 500 arrived in.
 */
function isServerAction(request: NextRequest): boolean {
  if (request.method !== 'POST') return false;
  if (NO_ORIGIN_REWRITE.test(request.nextUrl.pathname)) return false;
  if (request.headers.get('next-action') !== null) return true;
  return (request.headers.get('content-type') ?? '').startsWith('multipart/form-data');
}

/** The origin this request was addressed to, as the browser would write it. */
function ownOrigin(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    '';
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (request.nextUrl.protocol === 'https:' ? 'https' : 'http');
  return host ? `${proto}://${host}` : 'https://foundit.invalid';
}

/** One that is valid, and can never be ours. */
const REFUSING_ORIGIN = 'https://cross-site.invalid';

/**
 * The refusal, with a sentence in it.
 *
 * Plain text and not a page: whatever sent this is not a browser rendering
 * HTML, and a person who somehow sees it is owed the reason rather than the
 * word "Forbidden". The security headers go on it like any other response,
 * because a refusal is a response.
 */
function refuse(csp: string): NextResponse {
  const response = new NextResponse(
    'This looks like a form posted by something that is not a browser: it carries no '
      + 'usable Origin header and no Sec-Fetch-Site header either, and no browser sends '
      + 'that pair. Nothing was recorded and nothing was changed.\n',
    { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of HEADERS) response.headers.set(name, value);
  return response;
}

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

  /* --- what the client actually sent, kept where only we can write it ------
   * Deleted first: this is a name a visitor can type, and a forged one would
   * hand `app/o/route.ts` any origin the sender liked. */
  const clientOrigin = request.headers.get('origin');
  // Always SET, never conditionally: the header is present on every request
  // this middleware touches, and `none` is the value when the client sent no
  // Origin at all. That makes "absent" mean "middleware did not run" and
  // nothing else, so `app/o/route.ts` can tell the two apart — and `none` is
  // not a URL, so a check that reads it refuses rather than passing.
  requestHeaders.set(ORIGINAL_ORIGIN_HEADER, clientOrigin ?? 'none');

  /* --- F3: the page-view decision, made where the answer can be seen ------
   *
   * `rsc` and `next-router-prefetch` are NOT READABLE HERE. Next strips both
   * before it builds this request and restores them, unchanged, after this
   * function returns — `lib/router-headers.ts` quotes the source and explains
   * why that makes both the obvious fixes useless. `x-foundit-router` is what
   * that file writes at the HTTP server, before Next has looked at the
   * request, and it is not a flight header so it arrives here intact.
   *
   * It is also the same file that declines the `Next-Router-Prefetch` with no
   * `RSC` that Next answers 500 to (F24) — that has to happen before Next sees
   * the request too, so it cannot happen in this function either.
   *
   * ABSENT MEANS THE SHIM DID NOT RUN, which in this codebase means nothing:
   * `instrumentation.ts` installs it in the Node runtime before the first
   * request. Reading it as "neither header" is the safe way to be wrong —
   * it counts a navigation that should not have been counted, which is the
   * behaviour F3 found, rather than silently counting nothing at all. */
  const router = request.headers.get(ROUTER_HEADER) ?? ROUTER_DOCUMENT;
  const rsc = router.includes('rsc');
  const prefetch = router.includes('prefetch');

  requestHeaders.delete(COUNT_HEADER);
  if (
    countsAsPageView({
      method: request.method,
      pathname: request.nextUrl.pathname,
      rsc,
      prefetch,
    })
  ) {
    requestHeaders.set(COUNT_HEADER, '1');
  }

  /* --- F7: the Origin normalisation, for Server Actions and nothing else --- */
  if (isServerAction(request)) {
    const site = request.headers.get('sec-fetch-site');
    if (parsedOrigin(clientOrigin) === null) {
      if (site === null) {
        // The pair no browser produces. See the header: a browser old enough
        // to omit Fetch Metadata sends a real Origin, and one new enough to
        // send `Origin: null` sends Sec-Fetch-Site with it.
        return refuse(csp);
      }
      requestHeaders.set('origin', site === 'cross-site' ? REFUSING_ORIGIN : ownOrigin(request));
    }
  }

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
