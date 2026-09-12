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
 * What the card shows by default is what a person deciding needs: the name,
 * what the tool is, which of their constraints it meets and which it misses,
 * what other people made of it, and what they can do next.
 *
 * How it matched is NOT on the face of the card any more. The owner looked at
 * a page of twelve cards each carrying "Matched: problem + description", a
 * sentence explaining that, and a quoted problem statement, and said that how
 * the match goes does not need to show on every card (docs/product-decisions.md
 * §6, amended 11 September 2026). It is one small "Why this?" away instead —
 * a native <details>, so it needs no JavaScript, is reachable and operable
 * from the keyboard, and announces its own expanded state.
 *
 * The designed fit meter still has its slot (`fit`), and it is still empty
 * after Phase 5. That phase did give the band something to say — where the
 * reranker ran, `band` is its judgement (Strong, Possible, Loose) rather than a
 * location — but a PERCENTAGE needs a calibration, a calibration needs pairs
 * that people have judged, and there are none. `/ranking` says so in two
 * paragraphs and `eval/calibrate.mjs` is the command that fits the curve the
 * day they exist. A rescaled similarity shown as a percentage stays forbidden
 * by docs/build-phases.md.
 *
 * Constraint chips stay on the face of the card, met and unmet alike. That is
 * a Phase 5 non-negotiable and the one part of the match a person must never
 * have to open something to see.
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
   * Where it matched, in words — a location, never a rescaled score or a claim
   * about fit. See lib/results.ts. Drawn inside "Why this?", not on the card.
   */
  band?: { label: string; note: string; tone: 'both' | 'one' | 'name' };
  /** A fact about the match, drawn inside "Why this?" under `whyLabel`. */
  why?: string;
  /**
   * The bold lead-in above `why`. It defaults to a claim — "Why it matches" —
   * so a caller that has only a fact about *where* the words landed must say
   * so instead: nothing on this card may assert a reason the ranking did not
   * give. See app/results/page.tsx.
   */
  whyLabel?: string;
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
  whyLabel = 'Why it matches.',
  satisfactions,
  facts,
  rating,
  ratingCount,
  likes,
  big = false,
  index = 0,
}: ToolCardProps) {
  const toolHref = href ?? `/tools/${slug}`;
  // The two-column span is `.toolcard.big` in styles/components.css, not an
  // inline style: inline wins over every rule in the sheet, and the one-column
  // layout has to be able to take the span back.
  const style: CSSProperties = { animationDelay: `${index * 90 + 100}ms` };
  const explained = Boolean(band || why);

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

      {/* "Why this?" — everything about HOW it matched, and nothing else, lives
          in here. tests/card.test.mjs renders this component and fails if the
          match label, its note or the matched statement appear anywhere on
          the card outside this element. */}
      {explained ? (
        <details className="whythis">
          <summary className="whythis-toggle">
            <Icon name="chevronR" size={14} strokeWidth={2.25} className="whythis-chevron" />
            Why this?
            <span className="sr-only"> ({name})</span>
          </summary>
          <div className="whythis-body">
            {band ? (
              <div className={`band band-${band.tone}`}>
                <span className="band-label">{band.label}</span>
                <span>{band.note}</span>
              </div>
            ) : null}
            {why ? (
              <p className="why">
                <b>{whyLabel}</b> {why}
              </p>
            ) : null}
          </div>
        </details>
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
            /* A span is not a control and takes no accessible name, so an
               aria-label here is simply dropped: a screen reader would read
               the bare numeral with no idea what it counts. The words go in
               the element instead, where they are read in order — "218 people
               found this useful" — and stay invisible. */
            <span className="ghost like">
              <Icon name="heart" size={17} strokeWidth={2} />
              {likes}
              <span className="sr-only">
                {likes === '1' ? ' person found this useful' : ' people found this useful'}
              </span>
            </span>
          ) : null}
        </div>

        <div className="toolcard-actions">
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
            <div className="toolcard-out">
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
