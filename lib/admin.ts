import 'server-only';

import { cache } from 'react';

import {
  ADMIN_REVIEWS_SQL,
  AUTHOR_ADDRESS_SQL,
  CATALOGUE_DAYS,
  DASHBOARD_DAYS,
  DASHBOARD_SQL,
  LIST_LIMIT,
  MY_REMOVALS_SQL,
  RECORD_REMOVAL_SQL,
  REMOVE_REVIEW_SQL,
  cleanReason,
  reasonProblem,
  toAdminReviewPage,
  toDashboard,
  toMyRemovals,
  type AdminReviewPage,
  type Dashboard,
  type MyRemoval,
} from './admin-sql';
import { currentUserId } from './accounts';
import { authPool } from './auth-db';
import { withIdentity } from './db';
import { sendReviewRemoved } from './email';

/* ===========================================================================
 * The operator's half of the application.
 *
 * It inherits lib/accounts.ts's two rules unchanged, and they matter more here
 * than anywhere else in the codebase:
 *
 *   NOTHING HERE DECIDES WHO MAY DO WHAT. Every function opens a transaction
 *   carrying the caller's identity and sends a statement. Each of those
 *   statements is a call to an `admin_*` function that checks auth.is_admin()
 *   itself and raises 42501 otherwise (0019). There is no `if (viewer.isAdmin)`
 *   in this file, and the one in the pages is about what a stranger SEES —
 *   the not-found page — rather than about what they may have.
 *
 *   AN ERROR NEVER DISTINGUISHES "not yours" FROM "not there". A refusal here
 *   is `null` or `false` and the page draws the same screen it would for a
 *   listing that does not exist.
 *
 * WHY A REFUSAL IS CAUGHT AT ALL, rather than thrown up into the error page:
 * a 42501 out of one of these functions means somebody reached a page they
 * should not have, and the answer to that is the not-found page (the gate's
 * item 3), not a stack trace and a 500 that confirms the route exists.
 * ======================================================================== */

/** Run one statement with this request's identity attached. */
async function asViewer<T>(fn: Parameters<typeof withIdentity>[1]): Promise<T> {
  return withIdentity({ userId: await currentUserId() }, fn) as Promise<T>;
}

/** 42501 — the database said no. Anything else is ours and is logged. */
function refused(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code === '42501') return true;
  console.error(`an operator read failed (${code || 'unknown'})`);
  return false;
}

/**
 * Everything /admin draws, in one round trip, or null.
 *
 * Null for a stranger, for a signed-in person who is not an administrator, and
 * for a database that is not answering — one answer, on purpose, and the page
 * turns all three into the not-found page.
 */
export const dashboard = cache(async (): Promise<Dashboard | null> => {
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(DASHBOARD_SQL, [
        DASHBOARD_DAYS,
        CATALOGUE_DAYS,
        LIST_LIMIT,
      ]);
      return toDashboard(rows[0] as Record<string, unknown> | undefined);
    } catch (error) {
      refused(error);
      return null;
    }
  });
});

/** How many reviews one page of /admin/reviews draws. */
export const REVIEWS_PER_PAGE = 100;

/**
 * One page of reviews, newest first, with the total beside it. Null for
 * everybody who is not an administrator.
 *
 * The total is what the page needs to say "showing 100 of N" rather than
 * quietly dropping the rest, which is the smaller half of the Phase 8 review's
 * F8: `allReviews()` defaulted to 100, the page passed no argument, and with
 * more than a hundred reviews the older removals fell off the Removed list
 * with nothing anywhere saying so.
 */
export const reviewPage = cache(
  async (limit = REVIEWS_PER_PAGE, offset = 0): Promise<AdminReviewPage | null> => {
    return asViewer(async (tx) => {
      try {
        const { rows } = await tx.query(ADMIN_REVIEWS_SQL, [limit, offset]);
        return toAdminReviewPage(
          (rows[0] as { rows?: unknown } | undefined)?.rows,
          limit,
          offset,
        );
      } catch (error) {
        refused(error);
        return null;
      }
    });
  },
);

/* `allReviews` WAS HERE and is gone with the thing that needed it. It returned
 * a page of rows and no count, which is how `/admin/reviews` came to draw 100
 * of N and say nothing about the rest (Phase 8 review, F8). `reviewPage` is
 * the only reader now, and it cannot hand back rows without the total beside
 * them. */

/**
 * The removals of this person's own reviews, for their Settings page.
 *
 * Empty for somebody who has had none and empty for a stranger, which is the
 * same empty list: `review_removals_read` is the whole of the scoping and the
 * statement carries no id.
 */
export const myRemovals = cache(async (): Promise<MyRemoval[]> => {
  if (!(await currentUserId())) return [];
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(MY_REMOVALS_SQL, []);
      return toMyRemovals(rows as Array<Record<string, unknown>>);
    } catch (error) {
      refused(error);
      return [];
    }
  });
});

/**
 * Why a removal did not happen, in a shape the page turns into a sentence.
 *
 * `refused` AND `gone` ARE ONE OUTCOME NOW, and the Phase 8 review's F4 is
 * why. They were two sentences that told a caller whether a review id existed,
 * and that caller did not have to be an administrator to get one. The
 * authorisation half is fixed where it belongs — app/admin/actions.ts answers
 * everybody else with the not-found page before any of this runs — and the
 * difference is collapsed here as well, so the comment that file has always
 * carried is true of the code as well as of the intent.
 */
export type RemovalOutcome =
  | {
      ok: true;
      toolName: string;
      told: 'emailed' | 'logged' | 'no-address' | 'not-configured';
      /** False when the author had already taken it down themselves. */
      tookItDown: boolean;
    }
  | { ok: false; reason: 'reason-too-short' | 'reason-too-long' | 'not-removed' };

/**
 * Take a review down, and tell its author.
 *
 * THE TWO STATEMENTS ARE IN ONE TRANSACTION AND IN THIS ORDER, because 0013's
 * trigger will not allow any other: the reason has to be on the record, written
 * by the same administrator, before `deleted_at` may be set. Sending them
 * separately would leave a reason attached to a live review — a row saying
 * something untrue — the moment the second one failed.
 *
 * NEITHER OF THEM IS A DEFINER FUNCTION, and that is deliberate. Every other
 * number on this dashboard arrives through one, because reading eleven panels
 * through eleven policies is eleven places to be wrong. A WRITE is the
 * opposite case: 0013 §7 built three mechanisms for this one update — the
 * policy, the restrictive policy and the trigger — and an elevated code path
 * would step around all three. So the removal is two ordinary statements sent
 * as the administrator, and if they are not an administrator the database
 * refuses them exactly as it refuses a maker.
 *
 * THE AUTHOR IS TOLD TWICE. Their Settings page reads `myRemovals` above, and
 * that copy works whatever happens to the mail; the message here is the one
 * the Digital Services Act asks for (research/13 §2.1). The address is fetched
 * on the AUTHENTICATION pool, goes straight into lib/email.ts and is never
 * returned to a page — `told` says what happened to the message and nothing
 * about who it went to.
 *
 * The send is awaited rather than fired and forgotten, unlike the sign-in
 * code: nobody is waiting on a timing side channel here, and an administrator
 * pressing Remove is entitled to be told whether the author was told.
 */
export async function removeReview(
  reviewId: string,
  rawReason: string,
): Promise<RemovalOutcome> {
  const problem = reasonProblem(rawReason);
  if (problem === 'short') return { ok: false, reason: 'reason-too-short' };
  if (problem === 'long') return { ok: false, reason: 'reason-too-long' };
  if (!/^[0-9]{1,19}$/.test(reviewId)) return { ok: false, reason: 'not-removed' };

  // The reason as it will be STORED. Every other person-typed string in this
  // codebase goes through this function before it reaches the database, and
  // this was the one that did not (Phase 8 review, F10). The CHECK added in
  // 0020 §6 is the guarantee; this is what keeps an administrator from meeting
  // a constraint name.
  const reason = cleanReason(rawReason);

  const removal = await asViewer<
    { authorId: string; toolName: string; when: Date; tookItDown: boolean } | 'no'
  >(async (tx) => {
    try {
      const written = await tx.query(RECORD_REMOVAL_SQL, [reviewId, reason]);
      // No row means there is no review with that id at all. A review its
      // author already deleted DOES get one: the reason goes on the record,
      // the permanent bar in `reviews_removal_is_final` is armed, and the
      // author is told (supervisor's decision, 13 September 2026).
      if (written.rows.length === 0) return 'no';

      const { rows } = await tx.query(REMOVE_REVIEW_SQL, [reviewId]);
      const row = rows[0] as
        | { author_id?: string; tool_name?: string; deleted_at?: Date; took_it_down?: boolean }
        | undefined;
      if (!row?.author_id) return 'no';
      return {
        authorId: row.author_id,
        toolName: String(row.tool_name ?? ''),
        when: row.deleted_at ?? new Date(),
        tookItDown: row.took_it_down === true,
      };
    } catch (error) {
      // 42501 from the policy or the trigger, a CHECK on the reason, a second
      // removal refused by the unique index, or something of ours: all of them
      // are "it did not come down", and the screen says that rather than
      // which. The transaction rolls back, so no reason is left behind.
      refused(error);
      return 'no';
    }
  });

  if (removal === 'no') return { ok: false, reason: 'not-removed' };

  return {
    ok: true,
    toolName: removal.toolName,
    tookItDown: removal.tookItDown,
    told: await tell(removal.authorId, removal.toolName, removal.when, reason),
  };
}

const NOTICE_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

async function tell(
  authorId: string,
  toolName: string,
  when: Date,
  reason: string,
): Promise<'emailed' | 'logged' | 'no-address' | 'not-configured'> {
  let recipient = '';
  try {
    const { rows } = await authPool().query<{ email: string }>(AUTHOR_ADDRESS_SQL, [authorId]);
    recipient = (rows[0]?.email ?? '').trim();
  } catch {
    // The reason and nothing else — and there is nothing else worth saying,
    // because the only detail is an address. A removal whose notice could not
    // be addressed is still a removal, and Settings still tells them.
    console.error('the address for a review-removal notice could not be read');
  }
  if (recipient === '') return 'no-address';

  const sent = await sendReviewRemoved(recipient, {
    toolName,
    when: NOTICE_DATE.format(when),
    reason,
  });
  if (sent.reason === 'logged') return 'logged';
  if (sent.delivered) return 'emailed';
  if (sent.reason === 'not-configured') return 'not-configured';
  console.error(`a review-removal notice was not delivered (${sent.reason})`);
  return 'not-configured';
}
