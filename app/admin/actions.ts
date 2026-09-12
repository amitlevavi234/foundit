'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';

import { removeReview } from '@/lib/admin';

/* ===========================================================================
 * The one write the operator dashboard makes.
 *
 * WHAT IS NOT HERE IS THE POINT. There is no `if (viewer.isAdmin)` in this
 * file. `removeReview` sends two ordinary statements as whoever is asking, and
 * 0013's policy, 0013's restrictive policy and 0013's trigger are what decide
 * — so a maker, an ordinary account and a stranger are all refused by the
 * database rather than by a line of TypeScript that could be edited out. What
 * a refusal turns into is a sentence in the query string, and the sentence is
 * the same one a review that was already down produces, because "not allowed"
 * and "not there" are one answer (lib/accounts.ts's rule).
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
