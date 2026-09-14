import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Stars } from '@/components/Stars';
import { REVIEWS_PER_PAGE, reportPage, reviewPage } from '@/lib/admin';
import {
  LIST_LIMIT,
  MAX_REMOVAL_REASON,
  MIN_REMOVAL_REASON,
  type AdminReport,
  type AdminReview,
} from '@/lib/admin-sql';

import { removeReviewAction, resolveReportAction } from '../actions';
import { adminMetadata } from '../metadata';

/* ===========================================================================
 * /admin/reviews — the half of review moderation Phase 6 left.
 *
 * docs/product-decisions.md §4 has said since 11 September that only an
 * administrator may remove somebody else's review, that removing is not
 * editing, that the reason is recorded and that the author is told. 0013 and
 * 0015 built all of the database half of that in Phase 6. What was missing was
 * the screen, so a removal could only be done by hand in psql — which means it
 * was not a route anybody could take, which is what the Digital Services Act
 * (Arts 16–17, research/13 §2.1) actually requires.
 *
 * THE SHAPE COMES FROM ReviewQueue.dc.html, and departs from it in one way
 * that is worth saying out loud: the artboard is a three-pane queue — rail,
 * list, detail — designed for a moderation workload this product does not
 * have and has decided not to build (§5: "no review queue, no editor role, no
 * approver"). Drawing the rail would be drawing four queues that do not exist.
 * So this is the artboard's LIST column, full width, with the detail inlined
 * into each row: the same row shape (name and time on a baseline, the handle
 * under it, the body, the actions), the same `.btn-danger` for the
 * destructive control that ReviewQueue uses for Reject, and the same rule that
 * the destructive action is isolated from everything else on the row.
 *
 * THE REASON IS REQUIRED IN THREE PLACES and none of them trusts another: the
 * `required` and `minLength` attributes on the field, so a browser refuses the
 * form; `reasonProblem` in lib/admin-sql.ts, so a POST with no JavaScript and
 * no browser validation is refused with a sentence; and
 * `review_removals_reason_check`, which is where the number 8 actually lives.
 * ======================================================================== */

/** See app/admin/metadata.ts: the title must not confirm the route either. */
export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('Reviews');
}

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function day(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '—' : DATE.format(parsed);
}

const TROUBLE: Record<string, string> = {
  'reason-too-short': `A reason is at least ${MIN_REMOVAL_REASON} characters once control characters and repeated spaces are taken out. Nothing was removed.`,
  'reason-too-long': `A reason is at most ${MAX_REMOVAL_REASON} characters. Nothing was removed.`,
  // ONE SENTENCE FOR EVERY WAY IT DID NOT HAPPEN (Phase 8 review, F4). It used
  // to be two — "the database refused that" and "that review is not there" —
  // and the pair answered whether a review id existed to anybody who could
  // post the action.
  'not-removed': 'That removal did not happen, and nothing was changed.',
  // The owner's item 9. One sentence for every way a resolve did not
  // happen — an id nobody filed, one somebody else closed a moment ago —
  // for the reason F4 gives above: two sentences are an oracle over which
  // report ids exist.
  'not-resolved': 'That report was not closed. Either it is not there, or somebody closed it first.',
};

const TOLD: Record<string, string> = {
  emailed: 'The review is down and its author has been emailed the reason.',
  logged:
    'The review is down. The notice to its author was written to the server log rather than sent, because this machine has AUTH_DEV_CODE_TO_LOG=1.',
  'no-address': 'The review is down. No address could be found for its author, so no email was sent — they will see the removal and the reason on their own Settings page.',
  'not-configured':
    'The review is down. No email was sent, because email is not configured — they will see the removal and the reason on their own Settings page.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/* ===========================================================================
 * THREE TABS, AND THE FIRST ONE IS A QUEUE — the owner's item 9.
 *
 * This page was three sections stacked down one scroll: Live, Removed by an
 * administrator, Taken down by its author. That is a fine way to READ the
 * reviews and a poor way to WORK, because the thing an operator opens this
 * page to do — look at what somebody reported — was not on it at all: reports
 * went to an inbox and were written down nowhere.
 *
 * Reported is now the first tab and the default, because it is the only one
 * with anything waiting in it. All and Removed are the same rows as before.
 *
 * THE TABS ARE LINKS AND NOT A CONTROL. `?tab=` on an ordinary anchor: it
 * works before hydration, it works with JavaScript off, each tab is a URL
 * somebody can send to somebody else, and the back button does what a back
 * button does. After the owner's items 4 to 7 that is a rule in this codebase
 * rather than a preference.
 * ======================================================================== */

const TABS = [
  { id: 'reported', label: 'Reported' },
  { id: 'all', label: 'All' },
  { id: 'removed', label: 'Removed' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabOf(raw: string | undefined): TabId {
  return raw === 'all' || raw === 'removed' ? raw : 'reported';
}

/**
 * `?from=` — how many rows to skip, and nothing a URL can do to it is an error.
 *
 * OWNER FEEDBACK, ROUND 1, F11. Both lists on this page are now paged with the
 * same parameter, because the Reported tab was fifty rows with no control for
 * the rest and its own badge counted the truncated array. A nonsense value is
 * the first page rather than a 500: this is an operator's screen and an
 * operator who mangles a URL should get the list back, not an error page.
 */
function offsetOf(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
}

/**
 * "Older" and "Newer", when there is anything either way.
 *
 * Links and not a control, for the reason the tabs are links: it works before
 * hydration, it works with JavaScript off, each page is a URL somebody can
 * send to somebody else, and the back button does what a back button does.
 */
function Pager({
  tab,
  offset,
  shown,
  total,
  what,
}: {
  tab: TabId;
  offset: number;
  shown: number;
  total: number;
  what: string;
}) {
  const older = offset + shown;
  const newer = Math.max(0, offset - shown);
  if (total <= shown && offset === 0) return null;

  return (
    <p className="admnote" style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span>
        Showing {total === 0 ? 0 : offset + 1}–{offset + shown} of {total} {what}.
      </span>
      {offset > 0 ? (
        <Link href={`/admin/reviews?tab=${tab}${newer > 0 ? `&from=${newer}` : ''}`}>Newer</Link>
      ) : null}
      {older < total ? <Link href={`/admin/reviews?tab=${tab}&from=${older}`}>Older</Link> : null}
    </p>
  );
}

export default async function AdminReviews({ searchParams }: Props) {
  const params = await searchParams;
  const problem = first(params.problem);
  const told = first(params.told);
  const resolved = first(params.resolved);
  const tab = tabOf(first(params.tab));
  const from = offsetOf(first(params.from));

  // ONE OFFSET FOR WHICHEVER TAB IS OPEN. The three lists are three different
  // queries and a person is looking at one of them, so `?from=` means "this
  // tab, from row N" and switching tabs starts again from the top — which is
  // what the tab links do, because they carry no `from`.
  const page = await reviewPage(REVIEWS_PER_PAGE, tab === 'reported' ? 0 : from);
  if (!page) notFound();

  // Null only for somebody who is not an administrator, and the layout has
  // already answered them with the not-found page by the time this runs.
  //
  // OWNER FEEDBACK, ROUND 1, F11: this used to be `reports()` with no argument
  // at all, so the tab was fifty rows and the fifty-first was unreachable from
  // the only screen in the product that lists reports.
  const filedPage = await reportPage(LIST_LIMIT, tab === 'reported' ? from : 0);
  const filed = filedPage?.rows ?? [];

  // AND THE BADGE COMES FROM THE DATABASE, not from the length of a truncated
  // array — the other half of F11. `admin_report_counts().open` has no window
  // on it and no limit, so with sixty open reports the tab says sixty and
  // shows the fifty oldest.
  const openCount = filedPage?.open ?? 0;

  // THREE LISTS, BECAUSE THERE ARE THREE STATES (Phase 8 review, F8).
  // `removedAt` used to be the review's `deleted_at`, which its AUTHOR sets
  // when they retract it — so an author's own deletion sat in the Removed
  // section with no reason and no remover, under copy promising both.
  const { rows: reviews } = page;
  const live = reviews.filter((r) => !r.removedByAdminAt && !r.authorDeletedAt);
  const down = reviews.filter((r) => r.removedByAdminAt);
  const retracted = reviews.filter((r) => !r.removedByAdminAt && r.authorDeletedAt);

  const open = filed.filter((r) => r.resolvedAt === null);
  const closed = filed.filter((r) => r.resolvedAt !== null);

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/admin">Dashboard</BackLink>

      <main id="main" className="shell admpage">
        <div className="page-head">
          <div>
            <h1 className="h2" style={{ margin: 0 }}>
              Reviews
            </h1>
            <p className="muted" style={{ margin: '10px 0 0', lineHeight: 'var(--lh-body)' }}>
              Newest first. Removing is not editing: the words are never changed, the review is
              taken down whole, the reason goes on the record and its author is told.
            </p>
          </div>
        </div>

        <nav className="admtabs" aria-label="Which reviews">
          {TABS.map((t) => {
            // The Reported badge is `admin_report_counts().open` — the real
            // backlog, with no window and no limit on it — rather than the
            // length of whatever this page happened to receive. F11: with
            // sixty open reports the badge said fifty and nothing said the
            // other ten existed.
            const count =
              t.id === 'reported' ? openCount : t.id === 'removed' ? down.length : reviews.length;
            return (
              <Link
                key={t.id}
                href={`/admin/reviews?tab=${t.id}`}
                className={t.id === tab ? 'admtab on' : 'admtab'}
                aria-current={t.id === tab ? 'page' : undefined}
              >
                {t.label}
                <span className="tab faint"> {count}</span>
              </Link>
            );
          })}
        </nav>

        {problem && TROUBLE[problem] ? (
          <p role="alert" className="admnote" style={{ borderColor: 'var(--c-red)', color: 'var(--c-red)' }}>
            {TROUBLE[problem]}
          </p>
        ) : null}
        {told && TOLD[told] ? (
          <p role="status" className="panel-tint admnote">
            {TOLD[told]}
          </p>
        ) : null}
        {resolved ? (
          <p role="status" className="panel-tint admnote">
            That report is closed, with your handle and the time on it. It stays on the list under
            &ldquo;Closed&rdquo; — a resolution is a record, not an erasure.
          </p>
        ) : null}

        {/* --- Reported ---------------------------------------------------- */}
        {tab === 'reported' ? (
          <>
            <section className="admsection">
              <div className="section-head">
                <h2 className="h3" style={{ margin: 0 }}>
                  Open
                </h2>
                <span className="admperiod">
                  {openCount} {openCount === 1 ? 'report' : 'reports'}, oldest first
                </span>
              </div>

              {open.length === 0 ? (
                <p className="admnote">
                  Nothing is waiting. A report arrives from <Link href="/report">/report</Link> or
                  from the link at the foot of a listing, is written to <code>public.reports</code>{' '}
                  and is emailed to the team at the same time — so this being empty means there is
                  nothing to do, rather than that nobody is watching the inbox.
                </p>
              ) : (
                <div className="panel">
                  {open.map((report) => (
                    <ReportRow key={report.id} report={report} />
                  ))}
                </div>
              )}
            </section>

            <section className="admsection">
              <div className="section-head">
                <h2 className="h3" style={{ margin: 0 }}>
                  Closed
                </h2>
                <span className="admperiod">
                  {closed.length} {closed.length === 1 ? 'report' : 'reports'}
                </span>
              </div>
              {closed.length === 0 ? (
                <p className="admnote">Nothing has been closed yet.</p>
              ) : (
                <div className="panel">
                  {closed.map((report) => (
                    <ReportRow key={report.id} report={report} />
                  ))}
                </div>
              )}
              <p className="admnote">
                <strong>Closing a report does nothing to the thing reported.</strong> It records
                that somebody looked, who they were and when — and nothing else. Taking a review
                down is the separate control on the row above, it needs its own reason, and it
                tells the author. Most reports are closed by looking and finding it fine, which is
                why the note is optional.
              </p>
            </section>

            {/* F11. Open reports are oldest first, so this page drains from
                the front and "Older" reaches what the limit left behind.
                Before this the tab was fifty rows and the fifty-first was
                unreachable from the only screen that lists reports. */}
            <Pager
              tab="reported"
              offset={from}
              shown={filed.length}
              total={filedPage?.total ?? filed.length}
              what="reports, open first and then closed"
            />
          </>
        ) : null}

        {/* --- All --------------------------------------------------------- */}
        {tab === 'all' ? (
          <>
            <section className="admsection">
              <div className="section-head">
                <h2 className="h3" style={{ margin: 0 }}>
                  Live
                </h2>
                <span className="admperiod">
                  {live.length} {live.length === 1 ? 'review' : 'reviews'}
                </span>
              </div>

              {live.length === 0 ? (
                <p className="admnote">Nobody has written a review yet.</p>
              ) : (
                <div className="panel">
                  {live.map((review) => (
                    <Row key={review.id} review={review} />
                  ))}
                </div>
              )}
            </section>

            <section className="admsection">
              <div className="section-head">
                <h2 className="h3" style={{ margin: 0 }}>
                  Taken down by its author
                </h2>
                <span className="admperiod">
                  {retracted.length} {retracted.length === 1 ? 'review' : 'reviews'}
                </span>
              </div>

              {retracted.length === 0 ? (
                <p className="admnote">Nobody has retracted a review of their own.</p>
              ) : (
                <div className="panel">
                  {retracted.map((review) => (
                    <Row key={review.id} review={review} />
                  ))}
                </div>
              )}
              <p className="admnote">
                <strong>These are not takedowns and their words are not here.</strong> Somebody
                deleted what they wrote, which is their own decision about their own words, so the
                operator gets the listing, the handle and the date and not the text — the same
                rule that keeps a private saved list off this dashboard (§10, and{' '}
                <code>0015</code>). An administrator may still record a removal against one, and it
                is the only way to stop the same words being posted again: use the form on the row.
              </p>
            </section>
          </>
        ) : null}

        {/* --- Removed ----------------------------------------------------- */}
        {tab === 'removed' ? (
          <section className="admsection">
            <div className="section-head">
              <h2 className="h3" style={{ margin: 0 }}>
                Removed by an administrator
              </h2>
              <span className="admperiod">
                {down.length} {down.length === 1 ? 'review' : 'reviews'}
              </span>
            </div>

            {down.length === 0 ? (
              <p className="admnote">
                No review has ever been taken down by an administrator. Every one that is will stay
                on this list, with the reason and who wrote it — a removal is a record, not an
                erasure.
              </p>
            ) : (
              <div className="panel">
                {down.map((review) => (
                  <Row key={review.id} review={review} />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {tab !== 'reported' ? (
          <Pager
            tab={tab}
            offset={from}
            shown={page.rows.length}
            total={page.total}
            what="reviews, newest first"
          />
        ) : null}
      </main>

      <SiteFooter />
    </div>
  );
}

const WHAT: Record<string, string> = {
  review: 'A review',
  tool: 'A listing',
  profile: 'A profile',
};

/**
 * What "not found" means for each kind, on hover.
 *
 * OWNER FEEDBACK, ROUND 1, F20. Two quite different things end up here and the
 * operator has to be able to tell them apart: junk somebody typed, and a real
 * report whose subject has been deleted since — which is exactly the case the
 * missing foreign key on `reports.target` exists to allow.
 */
const GONE: Record<string, string> = {
  review: 'No review has this number. Either it was typed wrong, or the review has been deleted outright since the report was filed.',
  tool: 'No listing has this address. Either it was typed wrong, or the listing is a draft or has been removed since.',
  profile: 'No account has this id or handle. Either it was typed wrong, or the account has been deleted since.',
};

/**
 * One report, with the thing it is about under it.
 *
 * THE REVIEW COMES WITH THE REPORT rather than being looked up here. A
 * reported review may be three thousand rows down the list this page is
 * showing, so `public.admin_reports` (0023, 0027) carries it in the same row;
 * see that migration for why a wide result is the right shape.
 */
function ReportRow({ report }: { report: AdminReport }) {
  /* WHAT THE TARGET IS, AND WHETHER IT IS STILL THERE — OWNER FEEDBACK, ROUND
   * 1, F20 and F21.
   *
   * F21: a `kind=profile` report stores `profiles.id`, because a handle is
   * user-editable and an old report pointing at a name somebody else has taken
   * since would be an accusation attached to the wrong person. So the link is
   * built from `targetHandle`, which is what that account is called RIGHT NOW,
   * and the stored id is never drawn — it is not a name anybody would
   * recognise.
   *
   * F20: filing is deliberately permissive. A report may name a listing that
   * does not exist, a draft, or a review that has since been deleted — and it
   * must, because filing has to leak no existence and a report has to outlive
   * its target. `targetResolves` is how the operator tells the two apart
   * without following a link to find out, so junk can be closed at a glance
   * and a real report about something that has gone is not mistaken for it. */
  const label =
    report.kind === 'profile' ? (report.targetHandle ?? report.target) : report.target;

  const target = !report.targetResolves ? (
    <span className="tab faint">{label}</span>
  ) : report.kind === 'tool' ? (
    <Link href={`/tools/${label}`}>{label}</Link>
  ) : report.kind === 'profile' ? (
    <Link href={`/u/${label}`}>@{label}</Link>
  ) : (
    <span className="tab">#{label}</span>
  );

  return (
    <article className="admreview">
      <div className="admreview-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <strong>{WHAT[report.kind] ?? report.kind}</strong>
          {target}
          {report.targetResolves ? null : (
            <span className="tab" style={{ color: 'var(--c-red)' }} title={GONE[report.kind]}>
              not found
            </span>
          )}
          <span className="tab faint">
            {report.reporter ? `reported by @${report.reporter}` : 'reported by somebody signed out'}
          </span>
        </div>
        <span className="tab faint">{day(report.createdAt)}</span>
      </div>

      {/* THE REASONS, which is what the owner asked to see on this tab. They
          are somebody's own words, cleaned of control characters on the way in
          (public.file_report) and rendered as text by React, which escapes. */}
      <p className="admreview-body">{report.reason}</p>
      {report.details ? <p className="admreview-body faint">{report.details}</p> : null}

      {report.review ? (
        <div className="admreported">
          <Row review={report.review} />
        </div>
      ) : null}

      {report.resolvedAt ? (
        <p className="admnote" style={{ margin: 0 }}>
          <strong>Closed {day(report.resolvedAt)}</strong>
          {report.resolvedBy ? ` by @${report.resolvedBy}` : ''}
          {report.resolution ? `: ${report.resolution}` : '. No note was left.'}
        </p>
      ) : (
        <form action={resolveReportAction} className="admreview-form">
          <input type="hidden" name="report" value={report.id} />
          <div className="field" style={{ flex: '1 1 320px' }}>
            <label className="sr-only" htmlFor={`resolution-${report.id}`}>
              What you did about this report. Optional.
            </label>
            <input
              id={`resolution-${report.id}`}
              name="resolution"
              maxLength={MAX_REMOVAL_REASON}
              placeholder="What you did about it — optional"
            />
          </div>
          <Button type="submit" size="sm">
            Resolve
          </Button>
        </form>
      )}
    </article>
  );
}

function Row({ review }: { review: AdminReview }) {
  // The form is drawn for anything an administrator has not already removed —
  // INCLUDING a review its author retracted, which is the decision of
  // 13 September 2026 (Phase 8 review, F8): recording a removal against one is
  // what arms the permanent bar in 0015 and stops the same words going back up.
  const removed = Boolean(review.removedByAdminAt);

  return (
    <article className="admreview">
      <div className="admreview-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Link href={`/tools/${review.toolSlug}`} className="disp" style={{ fontSize: 18 }}>
            {review.toolName}
          </Link>
          <Link href={`/u/${review.handle}`} className="tab faint">
            @{review.handle}
          </Link>
          <Stars rating={review.rating} size={14} label={`${review.rating} out of 5`} />
        </div>
        <span className="tab faint">{day(review.createdAt)}</span>
      </div>

      {review.body ? (
        <p className="admreview-body">{review.body}</p>
      ) : review.authorDeletedAt && !review.removedByAdminAt ? (
        <p className="admreview-body faint">
          Taken down by its author on {day(review.authorDeletedAt)}. The words are not shown
          here.
        </p>
      ) : (
        <p className="admreview-body faint">A rating with no words.</p>
      )}

      {review.authorDeletedAt && review.removedByAdminAt ? (
        <p className="admnote" style={{ margin: 0 }}>
          Its author had already taken it down on {day(review.authorDeletedAt)}.
        </p>
      ) : null}

      {removed ? (
        <p className="admnote" style={{ margin: 0 }}>
          <strong>Removed {day(review.removedByAdminAt)}</strong>
          {review.removedBy ? ` by @${review.removedBy}` : ''}: {review.removalReason}
        </p>
      ) : (
        <form action={removeReviewAction} className="admreview-form">
          <input type="hidden" name="review" value={review.id} />
          <div className="field" style={{ flex: '1 1 320px' }}>
            <label className="sr-only" htmlFor={`reason-${review.id}`}>
              Why this review of {review.toolName} is being removed
            </label>
            <input
              id={`reason-${review.id}`}
              name="reason"
              required
              minLength={MIN_REMOVAL_REASON}
              maxLength={MAX_REMOVAL_REASON}
              placeholder={`Why, in at least ${MIN_REMOVAL_REASON} characters — the author is told this`}
            />
          </div>
          <Button type="submit" variant="danger" size="sm">
            Remove
          </Button>
        </form>
      )}
    </article>
  );
}
