import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Stars } from '@/components/Stars';
import { reviewPage } from '@/lib/admin';
import { MAX_REMOVAL_REASON, MIN_REMOVAL_REASON, type AdminReview } from '@/lib/admin-sql';

import { removeReviewAction } from '../actions';
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

export default async function AdminReviews({ searchParams }: Props) {
  const page = await reviewPage();
  if (!page) notFound();

  const params = await searchParams;
  const problem = first(params.problem);
  const told = first(params.told);

  // THREE LISTS, BECAUSE THERE ARE THREE STATES (Phase 8 review, F8).
  // `removedAt` used to be the review's `deleted_at`, which its AUTHOR sets
  // when they retract it — so an author's own deletion sat in the Removed
  // section with no reason and no remover, under copy promising both.
  const { rows: reviews } = page;
  const live = reviews.filter((r) => !r.removedByAdminAt && !r.authorDeletedAt);
  const down = reviews.filter((r) => r.removedByAdminAt);
  const retracted = reviews.filter((r) => !r.removedByAdminAt && r.authorDeletedAt);

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
            operator gets the listing, the handle and the date and not the text — the same rule
            that keeps a private saved list off this dashboard (§10, and <code>0015</code>).
            An administrator may still record a removal against one, and it is the only way to
            stop the same words being posted again: use the form on the row.
          </p>
        </section>

        {page.total > page.rows.length ? (
          <p className="admnote">
            Showing {page.rows.length} of {page.total} reviews, newest first. The rest are not on
            this page; there is no control for them yet and this sentence is here rather than a
            list that silently stops.
          </p>
        ) : null}
      </main>

      <SiteFooter />
    </div>
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
