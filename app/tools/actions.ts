'use server';

import { revalidatePath } from 'next/cache';
import { revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentUserId, deleteOwnReview, setLiked, writeReview } from '@/lib/accounts';
import { allowReview } from '@/lib/rate-limit';
import {
  DRAFT_COOKIE,
  DRAFT_MAX_AGE_SECONDS,
  draftPath,
  reviewNoticeUrl,
} from '@/lib/review-draft';

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

/* ---------------------------------------------------------------------------
 * Coming back to the page with something to say — the Phase 9a review's F12.
 *
 * Both halves of it are in lib/review-draft.ts, with the reasoning: the URL is
 * built with `URL` rather than by concatenation (the old spelling put
 * `?review=` inside the value of `?q=` on every visitor who arrived from a
 * search, so the notice never rendered), and the review they typed waits in a
 * five-minute httpOnly cookie scoped to the one listing, because the two
 * places that promised "the review they typed is still in the form" had
 * nothing behind them.
 * ------------------------------------------------------------------------ */

/** Write the draft where the page will find it, for one listing, briefly. */
async function keepDraft(slug: string, rating: number, body: string): Promise<void> {
  const jar = await cookies();
  jar.set(DRAFT_COOKIE, JSON.stringify({ rating, body }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: draftPath(slug),
    maxAge: DRAFT_MAX_AGE_SECONDS,
  });
}

/** And take it away again the moment the review is really written. */
async function dropDraft(slug: string): Promise<void> {
  const jar = await cookies();
  jar.set(DRAFT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: draftPath(slug),
    maxAge: 0,
  });
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

  const viewer = await currentUserId();
  if (!viewer) {
    redirect(`/sign-in?next=${encodeURIComponent(back)}&intent=review`);
  }

  const rating = Number.parseInt(String(formData.get('rating') ?? ''), 10);
  const body = String(formData.get('body') ?? '');

  // TEN AN HOUR (research/03 §9 item 14, lib/rate-limit.ts). This path had no
  // bound at all until Phase 9a: every post is an UPSERT that bumps
  // `tools.rating_count` and invalidates the catalogue cache for the listing,
  // and nothing stopped a script doing that once a second under one free
  // account. The refusal is a sentence on the page they are already on; the
  // listing and their existing review are untouched — and so are the words
  // they typed, which is what `keepDraft` is for.
  if (!allowReview(viewer).allowed) {
    await keepDraft(slug, rating, body);
    redirect(reviewNoticeUrl(back,'too-many'));
  }

  const written = await writeReview(slug, rating, body);
  if (!written) {
    await keepDraft(slug, rating, body);
    revalidatePath(back);
    redirect(reviewNoticeUrl(back,'refused'));
  }

  // It is written. Nothing is left in the browser.
  await dropDraft(slug);
  revalidateTag('catalogue');
  revalidatePath(back);
  redirect(`${back}#reviews`);
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
