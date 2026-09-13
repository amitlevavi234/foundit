'use server';

import { revalidatePath } from 'next/cache';
import { revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentUserId, deleteOwnReview, setLiked, writeReview } from '@/lib/accounts';

/* ===========================================================================
 * Liking a tool, and reviewing one.
 *
 * Both are refused by the database for anybody who is not signed in, and
 * neither is offered to them by the interface — the control is the gate
 * instead (components/SignInGate.tsx). What is here is the signed-in path.
 *
 * `revalidateTag('catalogue')` is the part that is easy to forget and is
 * exactly what lib/db.ts's comment asked the first writer to remember: the
 * tool page, the homepage, browse and top are cached for a minute as the
 * anonymous view, and a like changes `tools.like_count` on that page. Without
 * this, a person presses Like and watches the number not move for up to sixty
 * seconds, which reads as a bug and is one.
 * ======================================================================== */

function safeBack(raw: string, slug: string): string {
  const value = String(raw ?? '');
  if (!value.startsWith('/') || value.startsWith('//')) return `/tools/${slug}`;
  return value;
}

export async function toggleLike(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const back = safeBack(String(formData.get('back') ?? ''), slug);

  if (!(await currentUserId())) {
    redirect(`/sign-in?next=${encodeURIComponent(back)}&intent=like`);
  }

  await setLiked(slug, String(formData.get('liked') ?? '') !== 'yes');
  revalidateTag('catalogue');
  revalidatePath(back);
  redirect(back);
}

/**
 * Write or rewrite your own review.
 *
 * There is one per person per tool and this is both the writing and the
 * editing of it — `UPSERT_REVIEW_SQL` is one statement, and the partial unique
 * index is what makes "one live review" a rule rather than a convention.
 */
export async function postReview(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const back = safeBack(String(formData.get('back') ?? ''), slug);

  if (!(await currentUserId())) {
    redirect(`/sign-in?next=${encodeURIComponent(back)}&intent=review`);
  }

  const rating = Number.parseInt(String(formData.get('rating') ?? ''), 10);
  const body = String(formData.get('body') ?? '');

  const written = await writeReview(slug, rating, body);
  revalidateTag('catalogue');
  revalidatePath(back);
  redirect(written ? `${back}#reviews` : `${back}?review=refused#reviews`);
}

/* ---------------------------------------------------------------------------
 * `recordOpen` WAS HERE, AND IT IS GONE ON PURPOSE (Phase 8 review, F5).
 *
 * Counting a click out to a maker's site is now `POST /o`, a Route Handler
 * with the slug in its body — see app/o/route.ts. A Server Action posts to the
 * URL of the page it sits on, so this one put `POST /tools/<slug>` in the
 * request line of every access log in front of the application, beside the
 * visitor's address: exactly the join 0019 §3 says this product does not make,
 * made by the transport rather than by the function. Its action id was also in
 * the public client bundle, unauthenticated and unbounded.
 *
 * Nothing replaces it in this file. `lib/accounts.ts`'s `recordToolOpen` is
 * still the only writer of `tools.open_count` in the codebase; what changed is
 * which request reaches it.
 * ------------------------------------------------------------------------ */

/** Take your own review down. Nobody else's, and nobody else can take yours. */
export async function removeMyReview(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const back = safeBack(String(formData.get('back') ?? ''), slug);

  if (!(await currentUserId())) redirect('/sign-in');

  await deleteOwnReview(slug);
  revalidateTag('catalogue');
  revalidatePath(back);
  redirect(`${back}#reviews`);
}
