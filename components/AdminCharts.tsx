import type { CSSProperties } from 'react';

/* ===========================================================================
 * The dashboard's charts — the owner's items 8 and 10, 14 September 2026.
 *
 * WHAT WAS THERE BEFORE. One chart: thirty `<span>`s with an inline `height`
 * percentage, `aria-hidden`, no title, no period and no caption. The owner
 * looked at it and asked what it was — which is the whole of item 8, and the
 * answer ("searches per day for thirty days") was nowhere on the page.
 *
 * SO EVERY CHART IN HERE IS A `<figure>` WITH A `<figcaption>`, and the
 * caption is not decoration: it says what the number is and where it comes
 * from, in a sentence, because a dashboard figure a person cannot source is a
 * figure they have to trust rather than read.
 *
 * ---------------------------------------------------------------------------
 * INLINE SVG, NO LIBRARY, NO SCRIPT
 *
 * These are server components rendering `<svg>` elements. No canvas, no chart
 * library, no client bundle, and nothing to hydrate — the same argument
 * `components/Contraption.tsx` makes: "nothing here is an image, so there is
 * nothing to load, nothing to shift when it arrives, and no request to
 * anybody". It also means these render before hydration, which after items 4
 * to 7 is a rule in this codebase rather than a nicety.
 *
 * ---------------------------------------------------------------------------
 * THE SIX RULES THESE FOLLOW, and each one is a decision rather than a habit
 *
 *   1. ONE AXIS, never two. A chart with two y-scales lets the author choose
 *      how dramatic a comparison looks. Where two series have different units
 *      they are two charts.
 *   2. A LEGEND WHENEVER THERE ARE TWO OR MORE SERIES, so identity is never
 *      carried by colour alone; one series needs none, because the title names
 *      it.
 *   3. COLOUR FOLLOWS THE SERIES, never its rank. `reader` is violet on every
 *      chart on this page, whatever it is worth today.
 *   4. A 2px GAP OF SURFACE between stacked segments and between adjacent
 *      bars, so two touching fills never read as one.
 *   5. RECESSIVE AXES. The baseline is the quiet rule colour and there is no
 *      grid: thirty days of a small number does not need one, and a grid is
 *      the first thing that makes a small chart unreadable.
 *   6. NOT ONE NUMBER ON EVERY POINT. The peak is labelled and the ends are
 *      dated, and everything else is in the table or the figure beside it.
 *
 * ---------------------------------------------------------------------------
 * "NOT RECORDED" IS DRAWN, AND IT IS NOT A ZERO
 *
 * docs/product-decisions.md §10: nothing on this page shows a 0 where the
 * truth is "nobody measured this". A day before the page-view counter existed
 * is hatched rather than empty, and a chart with nothing behind it at all
 * renders as a sentence instead of as thirty flat bars.
 * ======================================================================== */

/** The day labels under a thirty-day chart: the first, the last, nothing else. */
function endLabels(days: readonly { day: string }[]): [string, string] {
  const short = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.valueOf())
      ? ''
      : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  };
  return [short(days[0]?.day ?? ''), short(days[days.length - 1]?.day ?? '')];
}

export interface ChartFrameProps {
  title: string;
  period: string;
  caption: React.ReactNode;
  /** Rendered instead of the plot when there is nothing recorded to plot. */
  unrecorded?: string;
  legend?: Array<{ label: string; color: string }>;
  first?: string;
  last?: string;
  children?: React.ReactNode;
}

/**
 * The frame every chart on this page shares: a title, the period beside it, the
 * plot, the two dates under it, the legend, and the caption.
 *
 * The title and the period are a `<figcaption>`'s first line rather than an
 * `<h3>` because this is a figure inside a section that already has a heading,
 * and a page of nested headings is a page a screen reader reads as an outline
 * nobody wrote.
 */
export function ChartFrame({
  title,
  period,
  caption,
  unrecorded,
  legend,
  first,
  last,
  children,
}: ChartFrameProps) {
  return (
    <figure className="admchart">
      <div className="admchart-head">
        <span className="admchart-title">{title}</span>
        <span className="admperiod">{period}</span>
      </div>

      {unrecorded ? (
        <p className="admnote unrecorded" style={{ margin: '10px 0 0' }}>
          {unrecorded}
        </p>
      ) : (
        <>
          {children}
          {first || last ? (
            <div className="admchart-axis tab" aria-hidden="true">
              <span>{first}</span>
              <span>{last}</span>
            </div>
          ) : null}
          {legend && legend.length > 1 ? (
            <ul className="admlegend">
              {legend.map((l) => (
                <li key={l.label}>
                  <span className="admswatch" style={{ background: l.color }} />
                  {l.label}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <figcaption className="admnote">{caption}</figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------------------
 * The three plots.
 *
 * All of them are drawn in a 300x72 user-space box and stretched by CSS, so a
 * bar is 10 wide with a 2 gap whatever the panel's real width is and the
 * maths below never has to know about pixels.
 * ------------------------------------------------------------------------ */

const W = 300;
const H = 72;

export interface BarSeries {
  label: string;
  color: string;
  values: number[];
}

/**
 * One or more series of daily counts, as columns.
 *
 * TWO SERIES ARE DRAWN SIDE BY SIDE AND NEVER STACKED, unless they are parts
 * of one total. "Searches" and "found nothing good" are the case that made
 * this explicit: the second is a SUBSET of the first, so stacking them would
 * draw a column taller than the number of searches there were. Side by side,
 * a reader can see one against the other and neither is invented.
 */
export function Bars({
  series,
  stacked = false,
  zeroNote,
}: {
  series: BarSeries[];
  /** True only where the series really are parts of one total. */
  stacked?: boolean;
  /** What a day with no bar means, for the accessible summary. */
  zeroNote?: string;
}) {
  const n = Math.max(1, series[0]?.values.length ?? 0);
  const slot = W / n;
  const gap = 2;
  const bar = stacked ? slot - gap : (slot - gap) / Math.max(1, series.length);

  const peak = Math.max(
    1,
    ...Array.from({ length: n }, (_, i) =>
      stacked
        ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
        : Math.max(...series.map((s) => s.values[i] ?? 0)),
    ),
  );

  const total = series.reduce((sum, s) => sum + s.values.reduce((a, b) => a + b, 0), 0);

  return (
    <svg
      className="admsvg"
      viewBox={`0 0 ${W} ${H + 2}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={
        `${series.map((s) => s.label).join(' and ')} over ${n} days. ` +
        `${total} in total, and the tallest day is ${peak}.` +
        (zeroNote ? ` ${zeroNote}` : '')
      }
    >
      {Array.from({ length: n }, (_, i) => {
        let bottom = H;
        return series.map((s, k) => {
          const value = s.values[i] ?? 0;
          // A day with nothing in it gets no mark at all rather than a 1px
          // stub: a stub is a value, and zero is not one.
          if (value <= 0) return null;
          const height = Math.max(1.5, (value / peak) * H);
          const x = stacked ? i * slot : i * slot + k * bar;
          const y = stacked ? bottom - height : H - height;
          if (stacked) bottom -= height + (height > 2 ? gap / 2 : 0);
          return (
            <rect
              key={`${s.label}-${i}`}
              x={x}
              y={y}
              width={Math.max(1, bar - (stacked ? 0 : 0.5))}
              height={height}
              // 4px rounded data-ends, in this box's units.
              rx={1.5}
              fill={s.color}
            />
          );
        });
      })}
      <line x1="0" y1={H + 1} x2={W} y2={H + 1} className="admaxis" />
    </svg>
  );
}

/**
 * A single daily count as a line, for a figure that is a LEVEL rather than an
 * amount.
 *
 * Accounts seen on a day is a level: it is not added to the day before it, and
 * a column chart of it invites exactly that reading. The area under it is the
 * same violet at a tenth of its opacity, which is what makes a line with three
 * points on it still look like a chart.
 */
export function Line({
  values,
  color,
  label,
}: {
  values: number[];
  color: string;
  label: string;
}) {
  const n = Math.max(1, values.length);
  const peak = Math.max(1, ...values);
  const step = n > 1 ? W / (n - 1) : W;
  const y = (v: number) => H - (v / peak) * (H - 4) - 2;
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`);

  return (
    <svg
      className="admsvg"
      viewBox={`0 0 ${W} ${H + 2}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} over ${n} days. The highest day is ${peak}.`}
    >
      <polygon
        points={`0,${H} ${points.join(' ')} ${W},${H}`}
        fill={color}
        opacity="0.12"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <line x1="0" y1={H + 1} x2={W} y2={H + 1} className="admaxis" />
    </svg>
  );
}

/**
 * Days with a value, days with a zero, and days with NO COUNTER — three
 * states, and the third is the one §10 is about.
 *
 * A hatched column is "nothing was counting this day". An empty slot is
 * "nothing happened". Drawing both as an empty slot would be the page telling
 * somebody that Foundit had no visitors on a day before the counter existed.
 */
export function RecordedBars({
  days,
  color,
  label,
}: {
  days: Array<{ day: string; views: number; recording: boolean }>;
  color: string;
  label: string;
}) {
  const n = Math.max(1, days.length);
  const slot = W / n;
  const bar = slot - 2;
  const peak = Math.max(1, ...days.map((d) => d.views));
  const counted = days.filter((d) => d.recording).length;
  const total = days.reduce((sum, d) => sum + d.views, 0);

  const hatch: CSSProperties = {};

  return (
    <svg
      className="admsvg"
      viewBox={`0 0 ${W} ${H + 2}`}
      preserveAspectRatio="none"
      role="img"
      style={hatch}
      aria-label={
        `${label}: ${total} over ${counted} of the last ${n} days. ` +
        `The other ${n - counted} are drawn hatched because nothing was counting yet.`
      }
    >
      <defs>
        <pattern id="notcounting" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 4 L4 0" className="admhatch" />
        </pattern>
      </defs>
      {days.map((d, i) => {
        const x = i * slot;
        if (!d.recording) {
          return (
            <rect key={d.day} x={x} y={H - 6} width={Math.max(1, bar)} height={6} fill="url(#notcounting)" />
          );
        }
        if (d.views <= 0) return null;
        const height = Math.max(1.5, (d.views / peak) * H);
        return (
          <rect
            key={d.day}
            x={x}
            y={H - height}
            width={Math.max(1, bar)}
            height={height}
            rx={1.5}
            fill={color}
          />
        );
      })}
      <line x1="0" y1={H + 1} x2={W} y2={H + 1} className="admaxis" />
    </svg>
  );
}

export { endLabels };
