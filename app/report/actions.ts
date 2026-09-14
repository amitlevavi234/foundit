'use server';

import { redirect } from 'next/navigation';

import { currentUserId } from '@/lib/accounts';
import { fileReport } from '@/lib/admin';
import {
  MAX_REPORT_DETAILS,
  MAX_REPORT_REASON,
  cleanReportText,
  isReportKind,
  reportReasonProblem,
} from '@/lib/admin-sql';
import { sendReport } from '@/lib/email';
import { allowReport } from '@/lib/rate-limit';
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
 * ======================================================================== */

/** Where the form comes back to, with what happened on it. */
function back(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `/report?${query.toString()}`;
}

export async function submitReport(formData: FormData): Promise<void> {
  const rawKind = String(formData.get('kind') ?? '').trim();
  const kind = isReportKind(rawKind) ? rawKind : null;
  const target = cleanReportText(String(formData.get('target') ?? ''), 200);
  const reason = String(formData.get('reason') ?? '');
  const details = String(formData.get('details') ?? '');

  // WHAT IS KEPT ON A REFUSAL. The reason and the details go back on the query
  // string so the form can restore them: somebody who typed four sentences and
  // got "that is too short" must not have to type them again, and this page
  // has no client state to hold them in. They are the reporter's own words
  // coming straight back to the reporter's own browser — the same thing the
  // review draft cookie does on a tool page, done with a redirect because
  // there is only one page involved.
  const kept = {
    kind: rawKind,
    target,
    reason: cleanReportText(reason, MAX_REPORT_REASON),
    details: cleanReportText(details, MAX_REPORT_DETAILS),
  };

  if (!kind) redirect(back({ ...kept, problem: 'kind' }));
  if (target === '') redirect(back({ ...kept, problem: 'target' }));

  const problem = reportReasonProblem(reason);
  if (problem) redirect(back({ ...kept, problem }));

  // BOTH CEILINGS BEFORE EITHER SIDE EFFECT, so a refused report neither
  // writes a row nor sends a message. Five per address per hour and ten per
  // account per day (lib/rate-limit.ts): reporting is open to a signed-out
  // visitor, so the address is the only bound there is for one of the two.
  const viewer = await currentUserId();
  if (!allowReport(await visitorAddress(), viewer).allowed) {
    redirect(back({ ...kept, problem: 'too-many' }));
  }

  const reportId = await fileReport(kind, target, kept.reason, kept.details);

  // The email goes whether or not the row was written — see the header. A
  // failure to send is logged and is not shown to the reporter, because there
  // is nothing they could do about it and the row is already there.
  const sent = await sendReport({
    kind,
    target,
    reason: kept.reason,
    details: kept.details,
    reportId,
    // The HANDLE is what the dashboard shows and the id is what the row holds;
    // neither is in this message, because `lib/admin.ts` reads the reporter
    // inside the database and this action never learns their handle. Null says
    // "signed out", which is the only thing the email needs to know.
    reporter: null,
  });
  if (!sent.delivered) {
    console.error(`a report notice was not delivered (${sent.reason})`);
  }

  if (reportId === null && !sent.delivered) {
    // Neither half happened. This is the one case where the page must not say
    // "thank you": nothing was recorded and nobody was told.
    redirect(back({ ...kept, problem: 'lost' }));
  }

  redirect(back({ sent: reportId === null ? 'emailed' : 'recorded' }));
}
