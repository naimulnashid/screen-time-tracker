'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { formatDayLong, formatDayShort, formatDuration } from '@/lib/format';
import {
  WEEKS, DAY_LABELS, HEATMAP_RAMP, heatmapColor, recentBlock, expandedBlocks, blockLabel,
  type HeatmapBlock, type HeatmapDay,
} from '@/lib/heatmap';

export type { HeatmapDay } from '@/lib/heatmap';

/** Keep in step with `WEEKS` in `lib/heatmap.ts`. */
const RANGE_LABEL = '6 months';

/**
 * One block of the heat map, GitHub-style, coloured with the device's ramp.
 *
 * Ported from the sibling Data Usage Tracker, and the reasons carry over:
 *
 * Month labels, weekday labels and cells all live in ONE grid with explicit
 * placement. That is what keeps the three registered with each other: the
 * cells size themselves from the shared column tracks, and the weekday labels
 * inherit the same row heights, so nothing can drift out of alignment.
 *
 * Cells are fluid (`1fr` columns plus `aspect-ratio: 1`) rather than a fixed
 * pixel size, so the grid fills whatever width the card has and stays square.
 *
 * Cells use native `title` tooltips deliberately. A styled, absolutely
 * positioned tooltip inside this grid would contribute layout width to the
 * scroll container even while hidden, which produces a phantom horizontal
 * scrollbar.
 *
 * Days with no row at all are drawn as "not recorded" rather than as a zero.
 * Before a collector existed there is genuinely nothing to report, and
 * colouring that the same as a quiet day would invent history this project
 * does not have -- the laptop's begins 2026-08-31 and nothing backfills it.
 *
 * `max` is passed in rather than taken from the block so that the expanded
 * page's blocks share one scale: a shade must mean the same hours in every
 * block.
 */
function HeatmapPlot({ block, max, label }: { block: HeatmapBlock; max: number; label: string }) {
  return (
    <div className="heatmap-scroll">
      <div
        className="heatmap-plot"
        role="img"
        aria-label={label}
        style={{
          gridTemplateColumns: `var(--hm-daycol) repeat(${WEEKS}, minmax(var(--hm-min), 1fr))`,
        }}
      >
        {block.months.map((mark) => (
          <span
            key={`${mark.label}-${mark.column}`}
            className="heatmap-month"
            style={{ gridColumn: mark.column + 2, gridRow: 1 }}
            aria-hidden
          >
            {mark.label}
          </span>
        ))}

        {DAY_LABELS.map((day, i) => (
          <span
            key={day}
            className="heatmap-day"
            style={{ gridColumn: 1, gridRow: i + 2 }}
            aria-hidden
          >
            {day}
          </span>
        ))}

        {block.cells.map((cell) => {
          const title = cell.hidden
            ? ''
            : cell.known
              ? `${formatDayLong(cell.date)} - ${formatDuration(cell.ms)}`
              : `${formatDayLong(cell.date)} - not recorded`;
          return (
            <span
              key={cell.date}
              className="heatmap-cell"
              data-nodata={!cell.hidden && !cell.known}
              title={title}
              style={{
                gridColumn: cell.column + 2,
                gridRow: cell.row + 2,
                background: cell.hidden || !cell.known
                  ? 'transparent'
                  : heatmapColor(cell.ms, max),
                visibility: cell.hidden ? 'hidden' : 'visible',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Summary on the left, colour scale on the right. `children`, when given, sits
 * centred between them -- the Overview puts its Expand button there.
 */
function HeatmapLegend({
  total, activeDays, span, children,
}: {
  total: number;
  activeDays: number;
  span: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`heatmap-legend${children ? ' heatmap-legend--split' : ''}`}>
      <span className="heatmap-summary">
        {formatDuration(total)} across {activeDays} active {activeDays === 1 ? 'day' : 'days'} {span}
      </span>
      {children && <span className="heatmap-legend-middle">{children}</span>}
      <span className="heatmap-scale">
        Less
        {HEATMAP_RAMP.map((color) => (
          <span key={color} className="heatmap-swatch" style={{ background: color }} />
        ))}
        More
      </span>
    </div>
  );
}

/**
 * The Overview card: the last `RANGE_LABEL`.
 *
 * ⚠️ The Expand button is ALWAYS offered, where the sibling shows it only once
 * data is older than this block reaches. Gated that way it would not appear
 * here until early 2027, because the laptop's history starts 2026-08-31 -- a
 * control asked for and then hidden for five months. The expanded page is
 * still worth opening before then: it starts at the data rather than six
 * months back, so it is the same days without the run of outlined weeks
 * before collection began.
 */
export function ActivityHeatmap({
  daily, expandHref, label,
}: {
  daily: HeatmapDay[];
  expandHref: string;
  /** What a day's value is, for the screen reader's description. */
  label: string;
}) {
  const block = useMemo(() => recentBlock(daily), [daily]);

  return (
    <div className="heatmap">
      <HeatmapPlot
        block={block}
        max={block.peak}
        label={`${label} over the last ${RANGE_LABEL}`}
      />
      <HeatmapLegend
        total={block.total}
        activeDays={block.activeDays}
        span={`in the last ${RANGE_LABEL}`}
      >
        <Link href={expandHref} className="chip">Expand</Link>
      </HeatmapLegend>
    </div>
  );
}

/**
 * The full history, as blocks of the Overview's width stacked oldest first.
 *
 * Growing downward rather than sideways is the point: every block has the
 * Overview's `WEEKS` columns, so cells stay the size they are there, however
 * many years accumulate.
 */
export function ExpandedHeatmap({
  daily, earliest, label,
}: {
  daily: HeatmapDay[];
  earliest: string | null;
  label: string;
}) {
  const { blocks, max, total, activeDays } = useMemo(() => {
    const all = expandedBlocks(daily, earliest);
    return {
      blocks: all,
      max: Math.max(0, ...all.map((b) => b.peak)),
      total: all.reduce((s, b) => s + b.total, 0),
      activeDays: all.reduce((s, b) => s + b.activeDays, 0),
    };
  }, [daily, earliest]);

  return (
    <div>
      {blocks.map((block) => {
        const heading = blockLabel(block);
        return (
          <section key={block.first} className="heatmap-block">
            <h3 className="heatmap-block-head">
              <span>{heading}</span>
              <span className="heatmap-block-total">{formatDuration(block.total)}</span>
            </h3>
            <HeatmapPlot block={block} max={max} label={`${label}, ${heading}`} />
          </section>
        );
      })}
      <HeatmapLegend
        total={total}
        activeDays={activeDays}
        span={blocks[0] ? `since ${formatDayShort(blocks[0].first)}, ${blocks[0].first.slice(0, 4)}` : ''}
      />
    </div>
  );
}
