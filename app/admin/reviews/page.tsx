import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Stars } from '@/components/Stars';
import { allReviews } from '@/lib/admin';
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
  'reason-too-short': `A reason is at least ${MIN_REMOVAL_REASON} characters. Nothing was removed.`,
  'reason-too-long': `A reason is at most ${MAX_REMOVAL_REASON} characters. Nothing was removed.`,
  refused: 'The database refused that removal. Nothing was removed.',
  gone: 'That review is not live — it has already been taken down, or it is not there. Nothing was changed.',
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
  const reviews = await allReviews();
  if (!reviews) notFound();

  const params = await searchParams;
  const problem = first(params.problem);
  const told = first(params.told);

  const live = reviews.filter((r) => !r.removedAt);
  const down = reviews.filter((r) => r.removedAt);

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
              Removed
            </h2>
            <span className="admperiod">
              {down.length} {down.length === 1 ? 'review' : 'reviews'}
            </span>
          </div>

          {down.length === 0 ? (
            <p className="admnote">
              No review has ever been taken down. Every one that is will stay on this list, with
              the reason and who wrote it — a removal is a record, not an erasure.
            </p>
          ) : (
            <div className="panel">
              {down.map((review) => (
                <Row key={review.id} review={review} />
              ))}
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Row({ review }: { review: AdminReview }) {
  const removed = Boolean(review.removedAt);

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
      ) : (
        <p className="admreview-body faint">A rating with no words.</p>
      )}

      {removed ? (
        <p className="admnote" style={{ margin: 0 }}>
          <strong>Removed {day(review.removedAt)}</strong>
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
