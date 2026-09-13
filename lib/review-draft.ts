/* ===========================================================================
 * Coming back to a tool page with something to say — and with the words the
 * visitor typed.
 *
 * THE PHASE 9a REVIEW'S F12, WHICH WAS TWO DEFECTS IN ONE JOURNEY.
 *
 * ONE — THE REFUSAL WAS INVISIBLE. `postReview` sent the visitor back with
 * `` `${back}?review=too-many#reviews` ``, and `back` is the page they are on,
 * which already carries `?q=<the sentence>` whenever they arrived from a
 * search — which is the ordinary way anybody reaches a tool page. A URL has
 * one query string, so the result was
 *
 *     /tools/receiptly?q=my%20receipts%20are%20a%20mess?review=too-many#reviews
 *
 * and `review` was not a parameter at all: it was the tail of the value of
 * `q`. `searchParams.review` came back null, the notice never rendered, and
 * the "All results" link on that page was rebuilt from a corrupted query. The
 * visitor pressed Save, the page reloaded unchanged, nothing was written, and
 * nothing said so.
 *
 * TWO — THE REVIEW WAS LOST. `lib/rate-limit.ts` and `.env.example` both said
 * of this path that "the refusal is a sentence on the page they are already on
 * and the review they typed is still in the form". `redirect()` re-renders the
 * page from the server and `components/ReviewForm.tsx` had nothing to restore
 * from, so the words went every time, notice or no notice.
 *
 * WHY THIS IS ITS OWN MODULE. `app/tools/actions.ts` is `'use server'`, so
 * everything it exports is a Server Action and nothing in it can be imported
 * by a test. Both halves above are ordinary string handling, and both are
 * things a test should be able to drive directly — the first one shipped
 * because nobody could.
 * ======================================================================== */

/**
 * `back`, with one notice parameter set and the reviews anchor on the end.
 *
 * `URL` and `URLSearchParams` rather than concatenation, because they know
 * where a query string starts and this code does not. The base is a throwaway
 * origin that never appears in the result: `back` is already a site-relative
 * path (`safeBack` in app/tools/actions.ts), and only the path, the query and
 * the hash come back.
 */
export function reviewNoticeUrl(back: string, notice: 'too-many' | 'refused'): string {
  const url = new URL(back, 'https://foundit.invalid');
  url.searchParams.set('review', notice);
  url.hash = 'reviews';
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The cookie the typed review waits in while the page re-renders.
 *
 * THE NARROWEST COOKIE THAT WORKS. It holds what this person just typed about
 * one listing, in their own browser, and nothing else:
 *
 *   httpOnly   no script can read it. The body is the one free-text field on
 *              this page.
 *   sameSite   lax — it is read by a GET navigation back to our own page.
 *   maxAge     300 seconds. It exists to survive one redirect; a draft that
 *              reappeared an hour later would be a surprise, not a courtesy.
 *   path       the listing's own page, so a draft about one tool cannot turn
 *              up under another.
 *
 * It is deleted the moment a review is actually written, so the ordinary path
 * leaves nothing behind.
 */
export const DRAFT_COOKIE = 'foundit_review_draft';
export const DRAFT_MAX_AGE_SECONDS = 300;

/** The path the draft cookie is scoped to. One listing, and no other. */
export function draftPath(slug: string): string {
  return `/tools/${slug}`;
}

export interface ReviewDraft {
  /** 1–5, or null when what came back was not a rating. */
  rating: number | null;
  body: string;
}

/**
 * What the cookie holds, or null.
 *
 * DEFENSIVE, because a cookie is a string a client can rewrite. A malformed
 * one, a rating of `"; drop"`, a body of a megabyte — each of those is "no
 * draft" rather than an exception on a page that has nothing to do with
 * reviewing. The body is capped here as well as in the database: a restored
 * draft is a courtesy and is not worth a large render.
 */
export function parseDraft(raw: string | undefined | null, maxBody: number): ReviewDraft | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const { rating, body } = parsed as { rating?: unknown; body?: unknown };
  const n = typeof rating === 'number' ? rating : Number.parseInt(String(rating ?? ''), 10);
  const draft: ReviewDraft = {
    rating: Number.isInteger(n) && n >= 1 && n <= 5 ? n : null,
    body: typeof body === 'string' ? body.slice(0, maxBody) : '',
  };
  // A draft of nothing at all is not a draft.
  return draft.rating === null && draft.body === '' ? null : draft;
}
