import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { currentViewer } from '@/lib/accounts';

/* ===========================================================================
 * The /admin segment's layout, and the only thing in it is a 404.
 *
 * THE PHASE 8 REVIEW'S F3. Both admin pages already answered a stranger with
 * the not-found page and with the root title (app/admin/metadata.ts). What
 * they did not answer with was a 404. A HEAD request made it starkest: no body
 * at all, and the only thing the response carried was the discriminator —
 * `/admin` 200, `/definitely-not-a-route` 404. Gate item 3 says the page for a
 * non-administrator is "the not-found page, NOT A HINT THAT /admin EXISTS",
 * and a status code that differs from every other missing route is exactly
 * that hint.
 *
 * WHY A LAYOUT AND NOT THE PAGE. `notFound()` sets a 404 only if nothing has
 * been sent yet; once a response has begun streaming the status line is
 * already gone and Next can do nothing but swap the body. A layout runs before
 * the page it wraps, so deciding here means the decision is made before any
 * part of either screen is rendered, let alone flushed. There is deliberately
 * no Suspense boundary, no loading.tsx and no streaming component above this
 * check anywhere in the segment — adding one would put the status code back
 * where it was, which is why this comment is longer than the file.
 *
 * THIS IS NOT THE APPLICATION DECIDING WHO MAY READ ANYTHING, and the
 * distinction is the one lib/admin.ts's header draws. It decides what somebody
 * is SHOWN. What they may HAVE is decided by the `admin_*` functions in 0019
 * and 0020, each of which checks `auth.is_admin()` itself and raises 42501
 * otherwise — which db/test/admin_test.sql §1 proves against a signed-out
 * claim, an ordinary account, a maker, four malformed claims and every
 * argument each function takes. Delete this file and the dashboard still
 * refuses everybody; it just refuses them with a worse page.
 *
 * `currentViewer()` is the same per-request read the header's Dashboard link
 * uses — `VIEWER_SQL` against `profiles.is_admin`, `cache()`d per request, and
 * never the session cookie — so this costs no extra round trip.
 * ======================================================================== */

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await currentViewer();
  if (!viewer?.isAdmin) notFound();
  return children;
}
