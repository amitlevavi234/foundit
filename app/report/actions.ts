'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentUserId } from '@/lib/accounts';
import { fileReport, profileIdForHandle } from '@/lib/admin';
import {
  MAX_REPORT_DETAILS,
  MAX_REPORT_REASON,
  cleanReportText,
  isReportKind,
  normaliseReportTarget,
  reportReasonProblem,
  reportTargetProblem,
} from '@/lib/admin-sql';
import { sendReport } from '@/lib/email';
import { allowReport } from '@/lib/rate-limit';
import {
  REPORT_DRAFT_COOKIE,
  REPORT_DRAFT_MAX_AGE_SECONDS,
  REPORT_DRAFT_PATH,
  serialiseReportDraft,
  type ReportDraft,
} from '@/lib/report-draft';
import { visitorAddress } from '@/lib/visitor';

/* ===========================================================================
 * Filing a report — the owner's item 9, and the supervisor's decision of 14
 * September 2026.
 *
 * BOTH, NOT EITHER. `docs/product-decisions.md` §5 used to say reports go to
 * the team by email rather than into a queue, and the operator dashboard said
 * so honestly: "Reports received — Not recorded". They are now written to
 * `public.reports` AND emailed. The row is what can be counted, listed and
 * closed; the email is what reaches a person the same evening.
 *
 * THE ORDER MATTERS AND IT IS THIS WAY ROUND. The row is written first, and
 * the email carries the id of the row it is about. If the write fails the
 * email still goes — with "NOT RECORDED" where the id would be, so the person
 * reading it knows the dashboard will not have it. A report that reached
 * nobody because the database was busy would be the worst outcome available
 * here, and it is the one this ordering rules out.
 *
 * IT WORKS WITH NO JAVASCRIPT, like every other form in this product: a plain
 * `<form action={submitReport}>` posting to a Server Action, a `redirect` back
 * to the page with a notice on the query string, and no client component
 * anywhere in it. That is the owner's items 4 to 7 read as a rule rather than
 * as three bugs.
 *
 * ---------------------------------------------------------------------------
 * OWNER FEEDBACK, ROUND 1 — WHAT CHANGED HERE, AND WHY EACH ONE MATTERED
 *
 * F6 — THE SHAPE IS CHECKED BEFORE ANYTHING HAPPENS. Nothing between the form
 * and `reports_target_shaped` looked at the target. Choosing "A review" and
 * typing the listing's address — the most natural mistake on this form —
 * produced no row, an email saying "NOT RECORDED", and a screen telling the
 * reporter it was "a fault our end and not yours". It was their typo, they
 * were told the opposite, and the review id they needed was rendered nowhere
 * in the product. Now the kind and the target are checked here, with their own
 * `problem=`, before either side effect.
 *
 * F13 — THE WORDS TRAVEL IN A COOKIE AND NOT IN THE URL. See
 * `lib/report-draft.ts`: a refusal used to 303 to a 2.5 kB URL carrying the
 * reporter's own accusation, which lands in every log in front of this
 * application and in the `Referer` of their next click.
 *
 * F15 — THE EMAIL SAYS WHICH KIND OF REPORTER IT WAS. It said "Reported by:
 * somebody signed out" on every report ever filed, including the signed-in
 * ones, while `viewer` was sitting in a variable three lines above. It still
 * does not say WHO — the handle is not this action's to know and an operator
 * triaging a flood does not need it — but "a signed-in account" and "a visitor
 * who was not signed in" are different facts and it now says which.
 *
 * F21 — A PROFILE REPORT STORES AN ID. The form asks for a handle, because a
 * handle is what a person can see; handles are editable (`app/settings/actions.ts`),
 * so a rename would re-point an old report at whoever took the name. The
 * handle is resolved to `profiles.id` here and the id is what is stored;
 * `admin_reports` hands the CURRENT handle back for the page to draw.
 * ======================================================================== */

/** Where the form comes back to, with what happened on it — and nothing else. */
function back(problem: string): string {
  return `/report?problem=${encodeURIComponent(problem)}`;
}

/** Put the draft where the page will find it, briefly, for this browser only. */
async function keepDraft(draft: ReportDraft): Promise<void> {
  const jar = await cookies();
  jar.set(REPORT_DRAFT_COOKIE, serialiseReportDraft(draft), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: REPORT_DRAFT_PATH,
    maxAge: REPORT_DRAFT_MAX_AGE_SECONDS,
  });
}

/** And take it away the moment the report is really filed. */
async function dropDraft(): Promise<void> {
  const jar = await cookies();
  jar.set(REPORT_DRAFT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: REPORT_DRAFT_PATH,
    maxAge: 0,
  });
}

export async function submitReport(formData: FormData): Promise<void> {
  const rawKind = String(formData.get('kind') ?? '').trim();
  const kind = isReportKind(rawKind) ? rawKind : null;
  const rawTarget = String(formData.get('target') ?? '');
  const reason = String(formData.get('reason') ?? '');
  const details = String(formData.get('details') ?? '');

  // WHAT IS KEPT ON A REFUSAL, and where. Somebody who typed four sentences
  // and got "that is too short" must not have to type them again — but their
  // words are not going in a URL to say so (F13). The draft is a five-minute
  // httpOnly cookie scoped to `/report`, exactly the arrangement
  // `lib/review-draft.ts` uses for a review, and the redirect carries the
  // reason for the refusal and nothing else.
  const draft: ReportDraft = {
    kind: kind ?? '',
    target: cleanReportText(rawTarget, 200),
    reason: cleanReportText(reason, MAX_REPORT_REASON),
    details: cleanReportText(details, MAX_REPORT_DETAILS),
  };

  /* --- everything that can be answered without touching anything ----------
   *
   * ALL OF IT BEFORE EITHER SIDE EFFECT. A refusal here writes no row, sends
   * no email and spends no token from any bucket, which is what makes "nothing
   * was recorded and nothing was sent" on the page a true sentence rather than
   * a hopeful one. */
  if (!kind) {
    await keepDraft(draft);
    redirect(back('kind'));
  }
  if (draft.target === '') {
    await keepDraft(draft);
    redirect(back('target'));
  }
  // F6. The shape, per kind, with its own sentence on the page. It does NOT
  // ask whether the thing exists — that would answer "is there a user called
  // X" to anybody with a form — and `admin_reports.target_resolves` is where
  // existence is answered instead.
  if (reportTargetProblem(kind, draft.target)) {
    await keepDraft(draft);
    redirect(back(`target-${kind}`));
  }

  const problem = reportReasonProblem(reason);
  if (problem) {
    await keepDraft(draft);
    redirect(back(problem));
  }

  const target = normaliseReportTarget(kind, draft.target);

  // THE CEILING, before either side effect, so a refused report neither writes
  // a row nor sends a message. One reporter, one ceiling: a signed-in account
  // is judged by its own daily ceiling and by nothing a stranger did — which
  // is F5, and is why `viewer` is read before this line rather than after it.
  const viewer = await currentUserId();
  if (!allowReport(await visitorAddress(), viewer).allowed) {
    await keepDraft(draft);
    redirect(back('too-many'));
  }

  /* --- F21: a profile is stored by id ------------------------------------
   *
   * The form asks for a handle because a handle is the only name a reporter
   * can see. `profiles.id` is what goes in the row, because a handle is
   * editable and an old report pointing at a name somebody else has taken
   * since would be an accusation attached to the wrong person.
   *
   * A handle that resolves to nothing is stored AS TYPED rather than refused.
   * Refusing it would make this form an existence oracle over every account on
   * the site, one post at a time; storing it keeps the reporter's words and
   * lets `admin_reports.target_resolves` tell the operator it is junk. */
  const stored =
    kind === 'profile' ? ((await profileIdForHandle(target)) ?? target) : target;

  const reportId = await fileReport(kind, stored, draft.reason, draft.details);

  // The email goes whether or not the row was written — see the header. A
  // failure to send is logged and is not shown to the reporter, because there
  // is nothing they could do about it and the row is already there.
  const sent = await sendReport({
    kind,
    target: stored,
    reason: draft.reason,
    details: draft.details,
    reportId,
    // F15. WHICH KIND OF REPORTER, never which one. `lib/admin.ts` reads the
    // reporter inside the database and this action never learns their handle —
    // but "signed out" was being asserted of every report ever filed, which is
    // worse than saying nothing, and whether there is an account behind a
    // report is the first thing an operator triaging a flood needs.
    reporter: viewer ? 'a signed-in account' : 'a visitor who was not signed in',
  });
  if (!sent.delivered) {
    console.error(`a report notice was not delivered (${sent.reason})`);
  }

  if (reportId === null && !sent.delivered) {
    // Neither half happened. This is the one case where the page must not say
    // "thank you": nothing was recorded and nobody was told, and the words
    // stay in the cookie so the reporter can try again without retyping.
    await keepDraft(draft);
    redirect(back('lost'));
  }

  // Filed. The draft is not a record and does not outlive the thing it was a
  // draft of.
  await dropDraft();
  redirect(`/report?sent=${reportId === null ? 'emailed' : 'recorded'}`);
}
