/* ===========================================================================
 * The words somebody typed into /report, while the page re-renders.
 *
 * OWNER FEEDBACK, ROUND 1, F13. Every refusal on `/report` used to send the
 * reporter back with their own accusation on the query string:
 *
 *     303 See Other
 *     Location: /report?kind=tool&target=anki&reason=<up to 500 characters>
 *               &details=<up to 2000 characters>&problem=too-many
 *
 * A 2.5 kB `Location` header, and the URL behind it lands in every access log
 * and proxy log in front of the application, in the browser's history, and —
 * because the app sends `Referrer-Policy: strict-origin-when-cross-origin` and
 * `/report` links to `/guidelines`, `/security` and `/copyright` — in the
 * `Referer` of the next same-origin click. The page's own copy says "nothing
 * about you was recorded beyond your account". An accusation about a named
 * listing, in a log, is a record about the person who filed it.
 *
 * The most likely refusal is `too-many`, which F5 made easy to reach.
 *
 * ---------------------------------------------------------------------------
 * SO THE DRAFT TRAVELS THE WAY A REVIEW DRAFT ALREADY DOES, and this module is
 * `lib/review-draft.ts` written again for a form with four fields instead of
 * two. The redirect carries `problem=` and nothing else.
 *
 * THE NARROWEST COOKIE THAT WORKS:
 *
 *   httpOnly   no script can read it. Three of the four fields are free text
 *              somebody typed about somebody else.
 *   sameSite   lax — it is read by a GET navigation back to our own page.
 *   maxAge     300 seconds. It exists to survive one redirect; a draft that
 *              reappeared an hour later would be a surprise, not a courtesy.
 *   path       `/report`, so it is not sent with any other request on this
 *              origin.
 *
 * It is deleted the moment a report is actually filed, so the ordinary path
 * leaves nothing behind — and it is deleted on the way OUT of the page as well
 * as on success, which is the difference between a draft and a record.
 *
 * WHY THIS IS ITS OWN MODULE rather than four lines in the action: the action
 * file is `'use server'`, so everything it exports is a Server Action and
 * nothing in it can be imported by a test. This is ordinary string handling
 * and `tests/review-draft.test.mjs`'s sibling can drive it directly.
 * ======================================================================== */

import {
  MAX_REPORT_DETAILS,
  MAX_REPORT_REASON,
  isReportKind,
  type ReportKind,
} from './admin-sql.ts';

export const REPORT_DRAFT_COOKIE = 'foundit_report_draft';
export const REPORT_DRAFT_MAX_AGE_SECONDS = 300;
export const REPORT_DRAFT_PATH = '/report';

export interface ReportDraft {
  /** What the radio said, or '' when it was not one of the three. */
  kind: ReportKind | '';
  target: string;
  reason: string;
  details: string;
}

/**
 * What the cookie holds, or null.
 *
 * DEFENSIVE, because a cookie is a string a client can rewrite. A malformed
 * one, a kind of `"; drop"`, a reason of a megabyte — each of those is "no
 * draft" rather than an exception on a page whose whole job is to accept a
 * complaint. Every field is capped here as well as in the database: a restored
 * draft is a courtesy and is not worth a large render.
 */
export function parseReportDraft(raw: string | undefined | null): ReportDraft | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const { kind, target, reason, details } = parsed as Record<string, unknown>;
  const text = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.slice(0, max) : '';

  const draft: ReportDraft = {
    kind: typeof kind === 'string' && isReportKind(kind) ? kind : '',
    target: text(target, 200),
    reason: text(reason, MAX_REPORT_REASON),
    details: text(details, MAX_REPORT_DETAILS),
  };

  // A draft of nothing at all is not a draft, and restoring one would make an
  // empty form look like it had been half filled in.
  return draft.kind === '' && draft.target === '' && draft.reason === '' && draft.details === ''
    ? null
    : draft;
}

/** The cookie's value for one draft. One place, so the two ends agree. */
export function serialiseReportDraft(draft: ReportDraft): string {
  return JSON.stringify(draft);
}
