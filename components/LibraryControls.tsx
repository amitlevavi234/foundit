import { saveToCollection } from '@/app/saved/actions';
import { toggleLike } from '@/app/tools/actions';
import type { ToolViewerState } from '@/lib/account-sql';
import { emailCodeConfigured, googleConfigured } from '@/lib/auth';

import { Button } from './Button';
import { Icon } from './Icon';
import { SignInGate } from './SignInGate';
import { SignInPanel } from './SignInPanel';

/**
 * Save and Like, in both of their states.
 *
 * Signed in they are forms posting to Server Actions, so they work with
 * scripting off and the database decides what happens. Signed out they are the
 * gate — a link to /sign-in that opens the sign-in panel over the page where
 * there is script, and navigates where there is not, carrying `next` back to
 * exactly the page and the tool the person was looking at.
 *
 * THE GATE IS THE ONLY PLACE THIS PRODUCT ASKS FOR AN ACCOUNT, and it asks at
 * the moment somebody saves, likes or reviews — never before a first set of
 * results, never on the homepage, never in the middle of reading
 * (docs/product-decisions.md §2).
 */

interface GateProps {
  slug: string;
  name: string;
  back: string;
}

function gateHref(back: string, intent: string): string {
  return `/sign-in?next=${encodeURIComponent(back)}&intent=${intent}`;
}

export interface LikeControlProps extends GateProps {
  /** Null when nobody is signed in; the gate is drawn instead. */
  liked: boolean | null;
  likes?: number | string;
}

export function LikeControl({ slug, name, back, liked, likes }: LikeControlProps) {
  const count = likes === undefined || likes === null ? null : String(likes);

  if (liked === null) {
    return (
      <SignInGate
        href={gateHref(back, 'like')}
        title={`Say ${name} helped`}
        line="A like is counted on the listing. It is never shown next to your name — this catalogue lists tools whose use is nobody else's business."
        panel={
          <SignInPanel
            next={back}
            google={googleConfigured()}
            email={emailCodeConfigured()}
            compact
          />
        }
        className="ghost like"
      >
        <Icon name="heart" size={17} strokeWidth={2} />
        {count}
        <span className="sr-only">
          {' '}
          — sign in to say this helped
        </span>
      </SignInGate>
    );
  }

  return (
    <form action={toggleLike}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="liked" value={liked ? 'yes' : 'no'} />
      <button
        type="submit"
        className={liked ? 'ghost like on' : 'ghost like'}
        aria-pressed={liked}
      >
        <Icon
          name="heart"
          size={17}
          strokeWidth={2}
          color={liked ? 'var(--c-coral)' : undefined}
        />
        {count}
        <span className="sr-only">
          {liked ? ` — you found ${name} useful` : ` — say ${name} was useful`}
        </span>
      </button>
    </form>
  );
}

export interface SaveControlProps extends GateProps {
  /** Null when nobody is signed in. Otherwise their collections. */
  state: ToolViewerState | null;
  size?: 'sm' | 'md';
}

export function SaveControl({ slug, name, back, state, size = 'sm' }: SaveControlProps) {
  if (!state) {
    return (
      <SignInGate
        href={gateHref(back, 'save')}
        title={`Save ${name} to your collection`}
        line="Sign in to keep this tool, and everything else you save. Free, no card, about five seconds."
        panel={
          <SignInPanel
            next={back}
            google={googleConfigured()}
            email={emailCodeConfigured()}
            compact
          />
        }
        className={size === 'sm' ? 'btn btn-sm' : 'btn'}
      >
        <Icon name="bookmark" size={16} />
        Save
      </SignInGate>
    );
  }

  const holding = state.collections.filter((c) => c.holds);
  const saved = holding.length > 0;

  return (
    <details className="accountmenu savemenu">
      <summary className={size === 'sm' ? 'btn btn-sm' : 'btn'} style={saved ? { background: 'var(--c-tint)' } : undefined}>
        <Icon name="bookmark" size={16} color={saved ? 'var(--c-violet)' : undefined} />
        {saved ? 'Saved' : 'Save'}
      </summary>

      <div className="accountmenu-sheet" style={{ minWidth: 280 }}>
        <div className="accountmenu-who">
          <strong>{saved ? `In ${holding.map((c) => c.name).join(', ')}` : 'Keep it somewhere'}</strong>
          <span className="faint" style={{ fontSize: 'var(--t-meta)' }}>
            A note about why is what makes a list worth having in a month.
          </span>
        </div>

        <form action={saveToCollection} style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="back" value={back} />

          <label className="sr-only" htmlFor={`save-into-${slug}`}>
            Which collection
          </label>
          <select
            id={`save-into-${slug}`}
            name="collectionId"
            className="field"
            style={{ height: 40, width: '100%' }}
            defaultValue={state.collections[0]?.id ?? 'new'}
          >
            {state.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.holds ? ' — already in it' : ''}
              </option>
            ))}
            <option value="new">New collection…</option>
          </select>

          <label className="sr-only" htmlFor={`save-newname-${slug}`}>
            Name for a new collection
          </label>
          <div className="field" style={{ height: 40 }}>
            <input
              id={`save-newname-${slug}`}
              name="newName"
              maxLength={60}
              placeholder="Name, if it is a new one"
            />
          </div>

          <label className="sr-only" htmlFor={`save-note-${slug}`}>
            Why you are keeping it
          </label>
          <div className="field" style={{ height: 40 }}>
            <input id={`save-note-${slug}`} name="note" maxLength={280} placeholder="Why? (optional)" />
          </div>

          <Button type="submit" size="sm" variant="coral">
            {saved ? 'Save again' : 'Save'}
          </Button>
        </form>
      </div>
    </details>
  );
}
