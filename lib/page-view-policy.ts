/**
 * Which requests are a page view — the DECISION, with nothing around it.
 *
 * IT IS ITS OWN FILE SO THAT A TEST CAN DRIVE IT, which is the same reason
 * `lib/visitor-policy.ts` is its own file and the same story behind it. The
 * decision used to live in `app/layout.tsx`:
 *
 *     if (!incoming.get('rsc') && !incoming.get('next-router-prefetch'))
 *       countPageView();
 *
 * — where nothing could test it, because a Server Component cannot be imported
 * by `node --test`. It was wrong, and it was wrong in the flattering direction:
 * `headers()` does not expose `RSC` to a Server Component on this build, so
 * that half of the guard was always true and EVERY client-side navigation in
 * the application counted a second page view for a page the visitor was
 * already on. Ten requests carrying `RSC: 1` produced ten counts where the
 * panel's caption promised zero (OWNER FEEDBACK, ROUND 1, F3, and overclaim
 * 12). The prefetch half worked, which is why nobody noticed the other one.
 *
 * So the decision moved to `middleware.ts`, which still has the raw headers —
 * and the part of it that is a rule rather than a header lookup moved here, so
 * that every row of the reviewer's table is a line in
 * `tests/page-views.test.mjs` rather than a paragraph in a comment.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS COUNTED, AND WHAT IS NOT
 *
 *   GET only          a HEAD is a client asking whether a page exists, not
 *                     reading one. It was counted before F3.
 *   not RSC           a client-side navigation re-renders the tree on the
 *                     server for a page the visitor is already on.
 *   not a prefetch    `Next-Router-Prefetch` marks a render for a link nobody
 *                     has followed.
 *   not /healthz, /o  neither is a page. The probe runs every few seconds for
 *                     ever and would be most of this number; `/o` answers 204
 *                     and has no document at all.
 *   not /_next/*      and not a path whose last segment has a dot in it:
 *                     `robots.txt`, `sitemap.xml`, the web manifest. Bytes,
 *                     not pages.
 *
 * A 404 IS COUNTED, deliberately, and `app/admin/page.tsx`'s caption says so.
 * A request for a page that does not exist is still a page this deployment
 * rendered and served, and excluding it would need the status code, which is
 * not known until after the render this decision is read in.
 *
 * A BOT IS COUNTED TOO, for the same kind of reason: the only thing that could
 * separate one from a person is the user agent, which is a string anybody may
 * write, and a figure that filtered on it would be a figure whose accuracy
 * depended on a stranger's honesty. The caption says that as well.
 */

/** The request header `middleware.ts` writes and `app/layout.tsx` reads. */
export const COUNT_HEADER = 'x-foundit-count';

/**
 * Paths that are not pages, whatever else is true of the request.
 *
 * The third alternative is "the last segment has a dot in it", which is
 * `robots.txt`, `sitemap.xml` and the web manifest. No slug, handle or share
 * token in this product can contain a dot — `profiles_handle_format` is
 * `^[a-z0-9_]{3,24}$` and a tool slug is the same shape with hyphens — so
 * nothing that IS a page is caught by it.
 */
export const NOT_A_PAGE = /^\/(?:healthz|o)(?:\/|$)|^\/_next\/|\/[^/]*\.[^/]*$/;

export interface PageViewRequest {
  method: string;
  pathname: string;
  /** The `RSC` header was present. */
  rsc: boolean;
  /** The `Next-Router-Prefetch` header was present. */
  prefetch: boolean;
}

/** Is this request one page somebody read? */
export function countsAsPageView({ method, pathname, rsc, prefetch }: PageViewRequest): boolean {
  if (method !== 'GET') return false;
  if (rsc || prefetch) return false;
  return !NOT_A_PAGE.test(pathname);
}
