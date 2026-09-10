import Link from 'next/link';
import type { CSSProperties } from 'react';

import { Button } from './Button';
import { SatisfactionChip, Tag } from './Chip';
import { FitMeter } from './FitMeter';
import { Icon } from './Icon';
import { OutboundButton, OutboundDomain } from './OutboundLink';
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
  /**
   * What matched, in words, for a card that has no calibrated number to show.
   * Drawn where the meter goes. See lib/results.ts: the label is a band, the
   * note is the fact underneath it, and neither is a rescaled score.
   */
  band?: { label: string; note: string; tone: 'strong' | 'possible' | 'loose' };
  why?: string;
  satisfactions?: Satisfaction[];
  /**
   * Neutral facts about the tool — how it is paid for, what it promises — for
   * a search that stated no constraints. A fact is a tag, not a tick: there is
   * nothing to meet when nothing was asked for.
   */
  facts?: string[];
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
  band,
  why,
  satisfactions,
  facts,
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

      {band ? (
        <div className={`band band-${band.tone}`}>
          <span className="band-label">{band.label}</span>
          <span>{band.note}</span>
        </div>
      ) : null}

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
      ) : facts && facts.length > 0 ? (
        <div className="toolcard-chips">
          {facts.map((fact) => (
            <Tag key={fact}>{fact}</Tag>
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
          {/* docs/product-decisions.md §12: every result carries the link to
              the address the maker entered, with the domain beside it so a
              person can see where they are going before they go. Our server
              never asks that address for anything. */}
          {url ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <OutboundButton url={url} size="sm">
                {big ? `Open ${name}` : 'Open'}
              </OutboundButton>
              <OutboundDomain url={url} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
