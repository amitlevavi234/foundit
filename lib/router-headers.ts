/* ===========================================================================
 * The two headers Next hides from its own middleware, put back under a name it
 * does not hide — and the one request shape it crashes on, refused before it
 * reaches it.
 *
 * OWNER FEEDBACK, ROUND 1, F3 and F24. Both of those turned out to rest on the
 * same fact about Next, which is written down here because it is not written
 * down anywhere obvious and two rounds of this codebase have now been wrong
 * about it.
 *
 * ---------------------------------------------------------------------------
 * WHAT NEXT DOES WITH `rsc` AND `next-router-prefetch`
 *
 * `node_modules/next/dist/server/web/adapter.js`, in the middleware adapter:
 *
 *     const flightHeaders = new Map();
 *     // Headers should only be stripped for middleware
 *     if (!isEdgeRendering) {
 *       for (const header of FLIGHT_HEADERS) {
 *         const value = requestHeaders.get(header);
 *         if (value !== null) { flightHeaders.set(header, value);
 *                               requestHeaders.delete(header); }
 *       }
 *     }
 *
 * and, at the end of the same function:
 *
 *     // Flight headers are not overridable / removable so they are applied at
 *     // the end.
 *
 * `FLIGHT_HEADERS` is `rsc`, `next-router-state-tree`, `next-router-prefetch`,
 * `next-hmr-refresh` and `next-router-segment-prefetch`. So middleware CANNOT
 * SEE THEM and CANNOT CHANGE THEM: they are taken out before the `NextRequest`
 * is built and put back, at their original values, after it returns.
 *
 * `node_modules/next/dist/server/async-storage/request-store.js` does the same
 * to `headers()` in a Server Component:
 *
 *     function getHeaders(headers) {
 *       const cleaned = HeadersAdapter.from(headers);
 *       for (const header of FLIGHT_HEADERS) cleaned.delete(header);
 *       return HeadersAdapter.seal(cleaned);
 *     }
 *
 * — which is the whole of F3's cause. `app/layout.tsx` tested
 * `incoming.get('rsc')`, that is always null, and so every client-side
 * navigation counted a second page view for a page the visitor was already on.
 * It is also why the obvious fix does not work: a middleware that reads the
 * same header sees the same null, and one that deletes it changes nothing.
 * Measured rather than assumed — with the delete in place,
 * `Next-Router-Prefetch: 1` still answered 500 while `2` and `x` answered 200.
 *
 * ---------------------------------------------------------------------------
 * SO THE DECISION MOVES ONE LAYER OUT, TO THE HTTP SERVER ITSELF
 *
 * This runs from `instrumentation.ts`'s `register()`, which Next awaits before
 * it serves anything, in the Node runtime, in development and in production
 * alike. It does exactly two things to a request, both of them before Next has
 * looked at it:
 *
 *   1. It writes `x-foundit-router`, which is NOT a flight header and
 *      therefore survives into middleware, saying which of the two flight
 *      headers were on the request. `middleware.ts` reads it to decide whether
 *      a request is a page view (`lib/page-view-policy.ts`). It is written
 *      unconditionally, so a client that sends one of its own is overwritten
 *      rather than believed.
 *
 *   2. It DELETES `next-router-prefetch` when `rsc` is absent. That pair is
 *      not something a browser produces — the router sets `RSC: 1` on every
 *      request it makes — and it is the one request shape Next crashes on:
 *
 *          GET /about, Next-Router-Prefetch: 1, no RSC
 *          -> 500  ReferenceError: location is not defined
 *             at InnerLayoutRouter (next/dist/client/components/layout-router.js)
 *
 *      `app-render.js` reads `isPrefetchRequest = headers['next-router-prefetch']
 *      === '1'` and renders an HTML document from a prefetch tree; a segment is
 *      then missing on the client, the layout router reaches for
 *      `location.origin` while still on the server, and every request in that
 *      shape is a 500 — which on a deployment with a DSN is one Sentry issue
 *      per request, mintable by anybody with `curl`. It is Next's bug and this
 *      is the last place we can decline to hand it the input.
 *
 * ---------------------------------------------------------------------------
 * WHY `Server.prototype.emit` AND NOT `http.createServer`
 *
 * Patching `createServer` only works if this runs BEFORE the server is made,
 * and `register()` does not: Next builds its server first and awaits
 * instrumentation during start-up. Patching the prototype's `emit` catches
 * every server in the process, including one that already exists, and it is
 * one function deep — the request object is handed to it, its headers are
 * ordinary strings, and the original `emit` is called with the same arguments
 * either way. Nothing else in this process creates an HTTP server.
 *
 * Installed once. A second call is a no-op, because `register()` can run more
 * than once in development when Next reloads the runtime.
 *
 * ---------------------------------------------------------------------------
 * THE INSTALLER IS IN `lib/router-headers-shim.ts` AND NOT HERE, and the split
 * is not tidiness: `middleware.ts` imports the two constants below, middleware
 * is bundled for the EDGE runtime, and an `import('node:http')` anywhere in
 * that module graph is a build error. So this file has no Node import in it at
 * all, and the one function that needs one lives next door where only
 * `instrumentation.ts` reaches it.
 * ======================================================================== */

/** The header this shim writes and `middleware.ts` reads. Never a client's. */
export const ROUTER_HEADER = 'x-foundit-router';

/** What `ROUTER_HEADER` says when neither flight header was on the request. */
export const ROUTER_DOCUMENT = 'document';

/** Anything with a mutable header bag on it — a Node request, or a test's. */
export interface HeaderBag {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Rewrite one request's headers. Exported so `tests/page-views.test.mjs` can
 * drive it without an HTTP server: it is the half of this file that is a rule
 * rather than a monkey patch.
 */
export function markRouterRequest(request: HeaderBag): void {
  const headers = request.headers;
  const rsc = headers.rsc !== undefined;
  const prefetch = headers['next-router-prefetch'] !== undefined;

  const marks: string[] = [];
  if (rsc) marks.push('rsc');
  if (prefetch) marks.push('prefetch');
  // SET and never append: a client may send this name and must never be
  // believed. `document` rather than an absent header, so that "absent" means
  // "this shim did not run" and nothing else.
  headers[ROUTER_HEADER] = marks.length > 0 ? marks.join(',') : ROUTER_DOCUMENT;

  // The pair no browser produces, and the one Next crashes on.
  if (prefetch && !rsc) delete headers['next-router-prefetch'];
}
