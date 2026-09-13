'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import { currentViewer } from '@/lib/accounts';
import { removeReview } from '@/lib/admin';

/* ===========================================================================
 * The one write the operator dashboard makes.
 *
 * NOTHING HERE DECIDES WHETHER THE REMOVAL MAY HAPPEN. `removeReview` sends
 * two ordinary statements as whoever is asking, and 0013's policy, 0013's
 * restrictive policy and 0013's trigger are what decide — so a maker, an
 * ordinary account and a stranger are all refused by the database rather than
 * by a line of TypeScript that could be edited out.
 *
 * WHAT THE CHECK BELOW DECIDES IS WHAT SOMEBODY SEES, and it is the Phase 8
 * review's F4. This file used to say that "not allowed" and "not there" were
 * one answer, and they were two: `RECORD_REMOVAL_SQL` selected the live review
 * first, so no row gave `problem=gone` and a row followed by the database's
 * refusal gave `problem=refused`. A signed-out stranger with the action id —
 * lifted from an administrator's own rendered page — could ask that pair about
 * any review id and be told which of the two it was. Nothing was ever written
 * by any of it, but it was a per-id oracle over `public.reviews` reached
 * through a route that is supposed to be refused, and the 303 back to
 * `/admin/reviews` confirmed the route exists on the way out.
 *
 * So the first thing that happens is the same thing app/admin/layout.tsx does,
 * through the same per-request read of `profiles.is_admin`: anybody who is not
 * an administrator gets the not-found page, before the review id has been
 * looked at, before the reason has been measured, and before any statement is
 * sent. A live id, a missing id, a signed-in non-administrator and a
 * signed-out stranger are then one answer, because they are all the same
 * answer as a URL that does not exist.
 *
 * THE ADMIN FLAG IS NEVER WRITTEN BY ANY APPLICATION STATEMENT, and this file
 * is where somebody would eventually be tempted to write one. There is no
 * action here that touches `profiles.is_admin`, there is no screen that offers
 * one, and `foundit_app` holds no UPDATE privilege on the column (0015), so
 * the temptation is refused three deep. docs/development.md says how an
 * operator sets it by hand, as the schema owner.
 *
 * `revalidateTag('catalogue')` because a removed review is on a tool page that
 * is cached for a minute as the anonymous view (lib/db.ts's header names this
 * exact case: "an admin taking down a review ... must call revalidateTag in
 * the same action, or a removed review stays on the tool page for up to a
 * minute after somebody was told it was gone").
 * ======================================================================== */

export async function removeReviewAction(formData: FormData): Promise<void> {
  // Before the argument is touched. The same rule 0020 §3 applies inside the
  // database to `admin_catalogue_counts`, applied here to a Server Action.
  const viewer = await currentViewer();
  if (!viewer?.isAdmin) notFound();

  const reviewId = String(formData.get('review') ?? '');
  const reason = String(formData.get('reason') ?? '');

  const outcome = await removeReview(reviewId, reason);

  if (!outcome.ok) {
    redirect(`/admin/reviews?problem=${outcome.reason}&review=${encodeURIComponent(reviewId)}`);
  }

  revalidateTag('catalogue');
  revalidatePath('/admin/reviews');
  revalidatePath('/admin');
  redirect(`/admin/reviews?removed=${encodeURIComponent(reviewId)}&told=${outcome.told}`);
}
