import type { ReactNode } from 'react';

import { Chip, ChipLink } from './Chip';

/**
 * "We don't have a good answer for this yet." — ResultsEmpty.dc.html.
 *
 * The design's argument, which the component keeps: an empty result is not a
 * shrug. It says plainly that the catalogue cannot serve this, names the
 * constraints that could not all be met, and offers to drop one at a time with
 * the count behind each option, so the person can decide what they are willing
 * to give up instead of guessing at a rephrase.
 */
export interface LoosenOption {
  label: string;
  /** e.g. "3 tools". Shown muted beside the label. */
  count?: string;
  href?: string;
  onSelect?: () => void;
}

export interface EmptyStateProps {
  title?: string;
  children: ReactNode;
  /** The constraints that could not all be met, in the person's own words. */
  loosen?: LoosenOption[];
  loosenTitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({
  title = 'We don’t have a good answer for this yet.',
  children,
  loosen,
  loosenTitle = 'Closest we found, if you loosen one constraint',
  actions,
  className,
}: EmptyStateProps) {
  return (
    <section className={['slab slab-ink rise empty', className].filter(Boolean).join(' ')}>
      <h2 className="empty-title">{title}</h2>
      <div className="empty-body">{children}</div>

      {loosen && loosen.length > 0 ? (
        <div className="empty-loosen">
          <div className="empty-loosen-title">{loosenTitle}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {loosen.map((option) => {
              const label = (
                <>
                  {option.label}
                  {option.count ? (
                    <span className="muted" style={{ fontWeight: 'var(--fw-medium)' }}>
                      {' '}
                      · {option.count}
                    </span>
                  ) : null}
                </>
              );

              // A loosened search is a different URL, so where one is given the
              // chip is a link: it survives a reload, a new tab and a browser
              // with JavaScript switched off.
              return option.href ? (
                <ChipLink key={option.label} href={option.href} label={label} state="plain" />
              ) : (
                <Chip key={option.label} state="plain" onClick={option.onSelect} label={label} />
              );
            })}
          </div>
        </div>
      ) : null}

      {actions ? <div className="empty-actions">{actions}</div> : null}
    </section>
  );
}
