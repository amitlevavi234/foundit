import Link from 'next/link';

import { Tag } from './Chip';
import { Icon } from './Icon';
import { ToolTile } from './ToolTile';
import { pricingLabel } from '@/lib/constraints';
import type { ProblemCard as ProblemCardData } from '@/lib/types';

/**
 * A problem somebody has, and the tool that says it solves it — the three
 * cards under "Found this week" on the homepage, and the grid on
 * BrowseProblems.dc.html.
 *
 * The statement is the tool's own, written in a person's words rather than a
 * feature list; that is what the catalogue is indexed by and what search
 * matches against, so a card here is a real row of `public.tool_problems` and
 * never a category name dressed up as a sentence.
 *
 * Following one runs it as a search, because that is what it is: the statement
 * goes into the box exactly as written and the ranking does the rest.
 */
export interface ProblemCardProps {
  problem: ProblemCardData;
  /** The larger, quoted treatment the homepage uses. */
  lead?: boolean;
  index?: number;
}

export function ProblemCard({ problem, lead = false, index = 0 }: ProblemCardProps) {
  const classes = ['card', 'hov', 'rise', 'problem-card', lead ? 'lead' : ''];

  return (
    <Link
      href={{ pathname: '/results', query: { q: problem.statement } }}
      className={classes.filter(Boolean).join(' ')}
      style={{
        animationDelay: `${index * 40}ms`,
        ...(lead ? {} : { boxShadow: '4px 4px 0 var(--c-ink)' }),
      }}
    >
      <span className="statement">
        {lead ? `“${problem.statement}”` : problem.statement}
      </span>

      {lead ? (
        <span className="solver">
          <ToolTile name={problem.name} slug={problem.slug} size={48} />
          <span>
            <span style={{ fontWeight: 'var(--fw-semibold)', fontSize: 17, display: 'block' }}>
              {problem.name}
            </span>
            <span className="muted" style={{ fontSize: 'var(--t-meta)' }}>
              {[pricingLabel(problem.pricing), platformSummary(problem)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </span>
      ) : null}

      <span className="meta">
        {problem.categoryName ? <Tag>{problem.categoryName}</Tag> : <span />}
        <span className="tab" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {lead ? (
            // The tool's name is already on the card above this line, so the
            // only thing worth saying here is how many people found it useful,
            // and only when somebody has.
            problem.likeCount > 0 ? (
              <>
                <Icon name="heart" size={15} color="var(--c-coral)" strokeWidth={2} />
                {problem.likeCount}{' '}
                {problem.likeCount === 1 ? 'person found it useful' : 'people found it useful'}
              </>
            ) : (
              <>
                See what fits
                <Icon name="arrow" size={14} color="var(--c-violet)" strokeWidth={2.25} />
              </>
            )
          ) : (
            <>
              {problem.name}
              <Icon name="arrow" size={14} color="var(--c-violet)" strokeWidth={2.25} />
            </>
          )}
        </span>
      </span>
    </Link>
  );
}

function platformSummary(problem: ProblemCardData): string {
  if (problem.platforms.length === 0) return '';
  const named = problem.platforms.slice(0, 3).map((p) => PLATFORM_SHORT[p] ?? p);
  const rest = problem.platforms.length - named.length;
  return rest > 0 ? `${named.join(', ')} +${rest}` : named.join(', ');
}

const PLATFORM_SHORT: Record<string, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  browser_extension: 'Extension',
  cli: 'CLI',
  api: 'API',
  self_hosted: 'Self-hosted',
};
