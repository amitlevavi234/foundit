import Link from 'next/link';

import { Tag } from './Chip';
import { Icon } from './Icon';
import { ToolTile } from './ToolTile';
import type { ToolSummary } from '@/lib/types';

/**
 * One row of a ranked list — `topRow()` on the homepage artboard and the wide
 * row on TopTools.dc.html, which are the same row at two widths.
 *
 * The rank, the counters and the order are the database's: likes and saves as
 * they stand on `public.tools`. Nothing here re-sorts and nothing weights one
 * signal against another, so "top" means what the counters say and cannot be
 * bought (TopTools.dc.html: "No paid placement.")
 */
export interface TopRowProps {
  tool: ToolSummary;
  rank: number;
  /** The homepage's two-column strip. The full row shows category and counts. */
  compact?: boolean;
  /** The homepage strip draws a column rule between its two columns. */
  columnRule?: boolean;
  index?: number;
}

export function TopRow({ tool, rank, compact = false, columnRule = false, index = 0 }: TopRowProps) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={compact ? 'toprow compact rise' : 'toprow rise'}
      style={{
        animationDelay: `${index * 40}ms`,
        ...(columnRule ? { borderRight: '2px solid var(--c-rule)' } : {}),
      }}
    >
      <span className={rank <= 3 ? 'disp tab toprow-rank lead' : 'disp tab toprow-rank'}>
        {rank}
      </span>
      <ToolTile name={tool.name} slug={tool.slug} size={compact ? 44 : 52} />
      <span style={{ minWidth: 0 }}>
        <span className="disp toprow-name">{tool.name}</span>
        <span className="toprow-summary">{tool.summary}</span>
      </span>

      {compact ? (
        <Counts tool={tool} />
      ) : (
        <>
          <span>{tool.categoryName ? <Tag>{tool.categoryName}</Tag> : null}</span>
          <Counts tool={tool} />
        </>
      )}
    </Link>
  );
}

function Counts({ tool }: { tool: ToolSummary }) {
  return (
    <span className="tab toprow-counts">
      <span>
        <Icon name="heart" size={15} color="var(--c-coral)" strokeWidth={2.25} />
        {tool.likeCount}
        <span className="sr-only">
          {tool.likeCount === 1 ? ' person found it useful' : ' people found it useful'}
        </span>
      </span>
      <span>
        <Icon name="bookmark" size={15} color="var(--c-violet)" strokeWidth={2.25} />
        {tool.saveCount}
        <span className="sr-only">{tool.saveCount === 1 ? ' person saved it' : ' people saved it'}</span>
      </span>
    </span>
  );
}
