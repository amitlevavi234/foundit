import Link from 'next/link';
import type { CSSProperties } from 'react';

import { Button } from './Button';
import { SatisfactionChip } from './Chip';
import { FitMeter } from './FitMeter';
import { Icon } from './Icon';
import { OutboundButton } from './OutboundLink';
import { ToolTile } from './ToolTile';

/**
 * The result card, from `resultCard()` in design/canvas/build.mjs.
 *
 * Reading order down the card is the order the design puts the argument in:
 * how well it fits, what it is, why it matches, which constraints it meets and
 * which it misses, then what other people made of it and what you can do next.
 * The fit comes first because that is the claim the product is making.
 *
 * Everything below the name is optional. Phase 2's search returns a name, a
 * summary and an ordering score and nothing else, so the card has to be
 * legible with only those — and grow the meter, the reasons and the chips as
 * later phases produce them, without becoming a different component.
 */
export interface Satisfaction {
  label: string;
  met: boolean;
}

export interface ToolCardProps {
  name: string;
  slug: string;
  summary?: string | null;
  /** Where the tool's own page lives on Foundit. */
  href?: string;
  /** The maker's address. Rendered as a link out and never fetched. */
  url?: string | null;
  fit?: number;
  fitLabel?: string;
  why?: string;
  satisfactions?: Satisfaction[];
  rating?: string;
  ratingCount?: string;
  likes?: string;
  /** The first result on the page is drawn larger and spans two columns. */
  big?: boolean;
  /** Position in the list; staggers the entrance. */
  index?: number;
}

export function ToolCard({
  name,
  slug,
  summary,
  href,
  url,
  fit,
  fitLabel,
  why,
  satisfactions,
  rating,
  ratingCount,
  likes,
  big = false,
  index = 0,
}: ToolCardProps) {
  const toolHref = href ?? `/tools/${slug}`;
  const style: CSSProperties = {
    animationDelay: `${index * 90 + 100}ms`,
    ...(big ? { gridColumn: 'span 2' } : {}),
  };

  return (
    <article className={big ? 'card hov rise toolcard big' : 'card hov rise toolcard'} style={style}>
      {typeof fit === 'number' ? <FitMeter fit={fit} label={fitLabel} /> : null}

      <div className="toolcard-head">
        <ToolTile name={name} slug={slug} size={big ? 60 : 48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={toolHref} className="toolcard-name">
            {name}
          </Link>
          {summary ? <div className="toolcard-summary">{summary}</div> : null}
        </div>
      </div>

      {why ? (
        <div className="why" style={{ fontSize: big ? 'var(--t-body-lg)' : 'var(--t-body-sm)' }}>
          <b>Why it matches.</b> {why}
        </div>
      ) : null}

      {satisfactions && satisfactions.length > 0 ? (
        <div className="toolcard-chips">
          {satisfactions.map((s) => (
            <SatisfactionChip key={s.label} label={s.label} met={s.met} />
          ))}
        </div>
      ) : null}

      <div className="toolcard-foot">
        <div className="toolcard-stats tab">
          {rating ? (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--c-ink)' }}
            >
              <Icon name="star" size={15} color="var(--c-coral)" strokeWidth={2} />
              <strong style={{ fontWeight: 'var(--fw-semibold)' }}>{rating}</strong>
              {ratingCount ? <span className="muted">({ratingCount})</span> : null}
            </span>
          ) : null}
          {likes ? (
            <span className="ghost like" aria-label={`${likes} people found this useful`}>
              <Icon name="heart" size={17} strokeWidth={2} />
              {likes}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* Saving is Phase 6. The control is drawn now so the card is the
              card; it announces that it is not wired up rather than lying. */}
          <Button size="sm" disabled aria-describedby={`save-later-${slug}`}>
            <Icon name="bookmark" size={16} />
            Save
          </Button>
          <span id={`save-later-${slug}`} className="sr-only">
            Saving needs an account and is not available yet.
          </span>
          {big && url ? (
            <OutboundButton url={url} size="sm">
              Open {name}
            </OutboundButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}
