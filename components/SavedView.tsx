import Link from 'next/link';

import { newCollection, removeCollection, removeSaved, startSharing, stopSharing } from '@/app/saved/actions';
import type { SavedPage } from '@/lib/account-sql';

import { Button } from './Button';
import { Icon } from './Icon';
import { OutboundButton, OutboundDomain } from './OutboundLink';
import { Tag } from './Chip';
import { ToolTile } from './ToolTile';

/**
 * Saved — `Saved.dc.html`, and `SavedEmpty.dc.html` when there is nothing in
 * it yet.
 *
 * The sidebar is every collection this person has with its count; the right
 * side is the one they are looking at. Both come out of a single statement
 * (lib/account-sql.ts, SAVED_SQL) under their own identity, so a collection
 * that is not theirs is not absent from the page — it was never in the result.
 *
 * WHAT SHARING IS HERE. `ShareCollection.dc.html` draws a toggle and a link,
 * and the toggle is the whole of the permission: turning it on mints 128 bits
 * of randomness and the link IS the address; turning it off sets the token
 * back to null and the old link stops opening anything immediately. There is
 * no "public" in between — a shared collection is readable by whoever holds
 * the link and by nobody else, which is a narrower promise than the `is_public`
 * flag 0001 shipped with and the one 0013 replaced it with.
 *
 * The notes go out with the list, which is why the panel says so before
 * anybody presses the button rather than after.
 */
export interface SavedViewProps {
  data: SavedPage;
  /** The origin the share link is built from, so it is copyable as it stands. */
  origin: string;
  /** True just after sharing was turned on, so the link can be pointed at. */
  justShared?: boolean;
}

export function SavedView({ data, origin, justShared = false }: SavedViewProps) {
  const chosen = data.chosen;

  return (
    <div className="savedgrid">
      <nav className="savednav" aria-label="Collections">
        <div
          className="disp"
          style={{ fontSize: 'var(--t-h3)', fontWeight: 'var(--fw-heading)', padding: '0 12px 12px' }}
        >
          Collections
        </div>

        {data.collections.map((c) => (
          <Link
            key={c.id}
            href={`/saved/${c.slug}`}
            className={chosen?.id === c.id ? 'on' : undefined}
            aria-current={chosen?.id === c.id ? 'page' : undefined}
          >
            <span>{c.name}</span>
            <span className="tab muted" style={{ fontSize: 'var(--t-meta-sm)' }}>
              {c.itemCount}
            </span>
          </Link>
        ))}

        <form action={newCollection} style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <div className="field" style={{ flex: 1, height: 40 }}>
            <label className="sr-only" htmlFor="new-collection">
              Name for a new collection
            </label>
            <input
              id="new-collection"
              name="name"
              maxLength={60}
              required
              placeholder="New collection"
            />
          </div>
          <Button type="submit" size="sm" aria-label="Make the collection">
            <Icon name="plus" size={16} strokeWidth={2.5} />
          </Button>
        </form>
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {chosen ? (
          <>
            <div className="page-head">
              <div>
                <h1 className="disp" style={{ fontSize: 46, margin: '0 0 8px' }}>
                  {chosen.name}
                </h1>
                <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-sm)' }}>
                  {chosen.description ? `${chosen.description} · ` : ''}
                  {chosen.itemCount} {chosen.itemCount === 1 ? 'tool' : 'tools'} ·{' '}
                  {chosen.shared ? 'Anyone with the link can view' : 'Private'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {chosen.shared ? (
                  <form action={stopSharing}>
                    <input type="hidden" name="id" value={chosen.id} />
                    <input type="hidden" name="slug" value={chosen.slug} />
                    <Button type="submit" size="sm">
                      <Icon name="lock" size={16} />
                      Stop sharing
                    </Button>
                  </form>
                ) : (
                  <form action={startSharing}>
                    <input type="hidden" name="id" value={chosen.id} />
                    <input type="hidden" name="slug" value={chosen.slug} />
                    <Button type="submit" size="sm">
                      <Icon name="share" size={16} />
                      Share
                    </Button>
                  </form>
                )}

                <form action={removeCollection}>
                  <input type="hidden" name="id" value={chosen.id} />
                  <Button type="submit" size="sm" variant="danger">
                    <Icon name="trash" size={16} />
                    Delete list
                  </Button>
                </form>
              </div>
            </div>

            {chosen.shared && chosen.shareToken ? (
              <div
                className="panel-tint"
                style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
                {...(justShared ? { 'aria-live': 'polite' as const } : {})}
              >
                <strong style={{ fontWeight: 'var(--fw-semibold)' }}>
                  Anyone with this link can read the list, and nobody else can.
                </strong>
                <code
                  className="tab"
                  style={{
                    display: 'block',
                    padding: '10px 12px',
                    background: 'var(--c-surface)',
                    border: 'var(--border)',
                    borderRadius: 'var(--r-md)',
                    wordBreak: 'break-all',
                    fontSize: 'var(--t-meta)',
                  }}
                >
                  {origin}/c/{chosen.shareToken}
                </code>
                <span className="muted" style={{ fontSize: 'var(--t-meta)', lineHeight: 1.5 }}>
                  Your notes go with it. Take out anything you would rather keep to yourself before
                  you send it, and press Stop sharing to kill the link.
                </span>
              </div>
            ) : null}

            {data.items.length === 0 ? (
              <div className="panel" style={{ padding: 28 }}>
                <h2 className="h3" style={{ margin: '0 0 6px' }}>
                  Nothing in this one yet.
                </h2>
                <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                  Press Save on any result to keep it here, with a note about why.
                </p>
              </div>
            ) : (
              <div className="savedcards">
                {data.items.map((item) => (
                  <article key={item.slug} className="card hov" style={{ padding: 22, gap: 14 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <ToolTile name={item.name} slug={item.slug} size={46} />
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/tools/${item.slug}`} className="toolcard-name">
                          {item.name}
                        </Link>
                      </div>
                    </div>

                    <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
                      {item.summary}
                    </p>

                    <div className="toolcard-chips">
                      <Tag>{item.pricing.replace(/_/g, ' ')}</Tag>
                      {item.rating ? <Tag>{item.rating.toFixed(1)} out of 5</Tag> : null}
                    </div>

                    <p className={item.note ? 'savednote' : 'savednote empty'} style={{ margin: 0 }}>
                      {item.note ??
                        'No note. A line about why you kept it is what makes this list worth having in a month.'}
                    </p>

                    <div className="toolcard-foot">
                      <form action={removeSaved}>
                        <input type="hidden" name="collectionId" value={chosen.id} />
                        <input type="hidden" name="slug" value={item.slug} />
                        <input type="hidden" name="back" value={`/saved/${chosen.slug}`} />
                        <button type="submit" className="ghost">
                          <Icon name="x" size={16} />
                          Remove
                        </button>
                      </form>

                      <div className="toolcard-out">
                        <OutboundButton url={item.url} size="sm">
                          Open
                        </OutboundButton>
                        <OutboundDomain url={item.url} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
              textAlign: 'center',
              padding: '80px 0',
            }}
          >
            <div
              className="slab rise"
              style={{
                width: 120,
                height: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 28,
                boxShadow: '6px 6px 0 var(--c-coral)',
              }}
            >
              <Icon name="bookmark" size={52} color="var(--c-violet)" strokeWidth={2} />
            </div>
            <h1 className="disp rise" style={{ fontSize: 40, margin: 0 }}>
              Nothing saved yet.
            </h1>
            <p
              className="rise muted"
              style={{ margin: 0, fontSize: 'var(--t-body-lg)', maxWidth: 420, lineHeight: 1.5 }}
            >
              Press Save on any result to keep it here, add a note about why, and sort tools into
              collections.
            </p>
            <Link href="/" className="btn btn-coral rise">
              Start a search
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
