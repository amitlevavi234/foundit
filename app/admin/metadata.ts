import 'server-only';

import type { Metadata } from 'next';

import { currentViewer } from '@/lib/accounts';

/* ===========================================================================
 * What the browser tab says when somebody who is not an administrator asks for
 * an /admin page.
 *
 * THE PAGE ALREADY ANSWERS THEM WITH THE NOT-FOUND PAGE — `notFound()` in both
 * screens, for a stranger, an ordinary account and a maker alike. The title is
 * the one thing `notFound()` does not take back: Next has already resolved the
 * segment's metadata by the time the component throws, so the response carried
 * `<title>Dashboard · Foundit</title>` over a page saying "Nothing here",
 * which is precisely the hint docs/phase-goals.md Phase 8 item 3 says must not
 * exist. It is a small leak and an exact one: it confirms the route.
 *
 * So the title is resolved the same way the body is. `generateMetadata` asks
 * who is asking and, for anybody who is not an administrator, answers with the
 * root title — byte for byte what a genuinely missing route answers with.
 *
 * THIS IS NOT THE APPLICATION DECIDING WHO MAY READ ANYTHING. It decides what
 * a tab is called. What may be read is decided by the twelve `admin_*`
 * functions in 0019, each of which raises 42501 on its own, which is what
 * db/test/admin_test.sql §1 proves against three different non-administrators
 * and a malformed claim.
 * ======================================================================== */

/** The root title from app/layout.tsx, verbatim: what a 404 already answers. */
const NOT_FOUND: Metadata = {
  title: { absolute: 'Foundit — say what’s bugging you, we’ll find the tool' },
  robots: { index: false, follow: false },
};

/** `title` for an administrator; the not-found page's own head for everybody else. */
export async function adminMetadata(title: string): Promise<Metadata> {
  const viewer = await currentViewer();
  if (!viewer?.isAdmin) return NOT_FOUND;
  return { title, robots: { index: false, follow: false } };
}
