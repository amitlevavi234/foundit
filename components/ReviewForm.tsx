import { postReview, removeMyReview } from '@/app/tools/actions';
import type { ViewerReview } from '@/lib/account-sql';
import { MAX_REVIEW_BODY } from '@/lib/accounts';

import { Button } from './Button';
import { Icon } from './Icon';
import { SignInGate } from './SignInGate';
import { SignInPanel } from './SignInPanel';

/**
 * Rate and review — `RateReview.dc.html`, reduced to what the database
 * actually stores and a person actually owes.
 *
 * The artboard asks for six things: stars, what you used it for, who you would
 * recommend it for, three sliders, and the written review. Three of those are
 * built — the stars, the words, and taking it down again — and the other three
 * are not, for one reason each rather than for a general one:
 *
 *   "What did you use it for" is a required free-text field that lands in a
 *   column the schema does not have. `reviews` carries `solved_problem`,
 *   `ease_of_use` and `worth_the_price`, and none of them is a sentence.
 *
 *   The recommend-for chips and the sliders are the three numeric columns in a
 *   dress. They can be built whenever somebody wants them, on top of columns
 *   that exist; what they cannot be is invented into a form that then writes
 *   nothing.
 *
 *   "Reviews from accounts under 7 days old are held for a check" is a
 *   moderation queue, and docs/product-decisions.md §5 says plainly there is
 *   no review queue. A sentence promising one would be a lie in the footer of
 *   a form.
 *
 * ONE REVIEW PER PERSON PER TOOL, and this is both the writing and the editing
 * of it: the same form, filled in, with the same action behind it. The
 * database enforces the "one" with a partial unique index, not this component.
 *
 * THE STARS ARE FIVE RADIO BUTTONS. Not a slider, not a row of buttons with
 * script behind them: a rating is one of five named things, it has to be
 * reachable and settable from the keyboard, and it has to submit with no
 * JavaScript at all.
 */
export interface ReviewFormProps {
  slug: string;
  name: string;
  /** Where to return to — the page they are on, with its query intact. */
  back: string;
  /** Their existing review, if they have one. */
  mine: ViewerReview | null;
  signedIn: boolean;
  google: boolean;
  email: boolean;
}

const STAR_WORDS = [
  'Did not work for me',
  'Some of the way',
  'Does the job',
  'Good',
  'Solved it completely',
];

export function ReviewForm({ slug, name, back, mine, signedIn, google, email }: ReviewFormProps) {
  if (!signedIn) {
    return (
      <div
        className="panel"
        style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}
      >
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          Used {name}? A review is the most useful thing on this page for the next person.
        </p>
        <SignInGate
          href={`/sign-in?next=${encodeURIComponent(back)}&intent=review`}
          title={`Review ${name}`}
          line="Reviews are posted under your @name, and yours is yours to edit or take down. Nobody else can touch it — not the maker, not us."
          panel={<SignInPanel next={back} google={google} email={email} compact />}
          className="btn btn-sm btn-coral"
        >
          Write a review
        </SignInGate>
      </div>
    );
  }

  return (
    <form
      action={postReview}
      className="panel"
      style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="back" value={back} />

      <div>
        <h3 className="h3" style={{ margin: '0 0 4px' }}>
          {mine ? 'Your review' : `How well did ${name} work for you?`}
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-sm)' }}>
          {mine
            ? 'Yours to change or take down whenever you like. Nobody else can do either.'
            : 'It is posted under your @name. Specifics help more than adjectives.'}
        </p>
      </div>

      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend
          style={{
            fontWeight: 'var(--fw-semibold)',
            fontSize: 'var(--t-body-sm)',
            marginBottom: 8,
          }}
        >
          Your rating
        </legend>
        <div className="ratefield">
          {[1, 2, 3, 4, 5].map((value) => (
            <span key={value}>
              <input
                type="radio"
                id={`rating-${slug}-${value}`}
                name="rating"
                value={value}
                required
                defaultChecked={mine?.rating === value}
              />
              <label htmlFor={`rating-${slug}-${value}`}>
                <Icon name="star" size={20} strokeWidth={2} />
                <span className="sr-only">
                  {value} — {STAR_WORDS[value - 1]}
                </span>
              </label>
            </span>
          ))}
        </div>
      </fieldset>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label
          htmlFor={`review-body-${slug}`}
          style={{ fontWeight: 'var(--fw-semibold)', fontSize: 'var(--t-body-sm)' }}
        >
          What happened when you used it{' '}
          <span className="faint" style={{ fontWeight: 'var(--fw-regular)' }}>
            optional
          </span>
        </label>
        <div className="field area" style={{ minHeight: 96 }}>
          <textarea
            id={`review-body-${slug}`}
            name="body"
            rows={4}
            maxLength={MAX_REVIEW_BODY}
            defaultValue={mine?.body ?? ''}
            placeholder="What surprised you, good or bad?"
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="faint" style={{ fontSize: 'var(--t-meta)', maxWidth: 320, lineHeight: 1.45 }}>
          Nothing here waits for approval. It is on the page as soon as you post it.
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="submit" variant="coral">
            {mine ? 'Save changes' : 'Post review'}
          </Button>
        </div>
      </div>

      {mine ? (
        <div style={{ borderTop: 'var(--border-soft)', paddingTop: 14 }}>
          {/* A second form, outside this one, because a form cannot be nested
              and "delete" must not be a second submit button on "save". */}
          <span className="muted" style={{ fontSize: 'var(--t-meta)' }}>
            Changed your mind about it entirely?
          </span>{' '}
          {/* `formAction` rather than a nested form: HTML has no nested forms,
              and a submit button may name its own action — so this reuses the
              slug and the return path already in the fields above. It is a
              soft delete, which is the same door an admin's removal goes
              through and the same one the author holds the only key to. */}
          <button type="submit" className="ghost" formAction={removeMyReview} formNoValidate>
            <Icon name="trash" size={15} />
            Take my review down
          </button>
        </div>
      ) : null}
    </form>
  );
}
