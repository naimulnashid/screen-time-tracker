/**
 * The calendar arithmetic behind the activity heat map, shared by the
 * six-month card on each Overview and the full-history page it expands into.
 *
 * Ported from the sibling Data Usage Tracker, whose Activity card this is
 * deliberately built to match: same Saturday-first week columns, same
 * six-month block, same "outlined means never recorded" rule. Two things
 * differ, and both are about screen time rather than bytes -- see
 * `heatmapColor()` and `expandedBlocks()`.
 *
 * Both views draw blocks of `WEEKS` week columns, so they share one builder.
 * The full page is more blocks of the same width stacked vertically, which is
 * what keeps its cells the size of the Overview's however long history grows.
 */

/**
 * Six months per block. The single source of truth for the column count --
 * the component sets the grid template from it inline, so the CSS never
 * hard-codes it.
 */
export const WEEKS = 26;

/** Weeks run Saturday -> Friday, so row 0 is Saturday. Matches the sibling. */
export const DAY_LABELS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * The ramp, as the CSS variables `accent.ts` emits per device -- so the map
 * is violet on the laptop and green on a phone without a hex in sight.
 */
export const HEATMAP_RAMP = [
  'var(--hm-0)', 'var(--hm-1)', 'var(--hm-2)',
  'var(--hm-3)', 'var(--hm-4)', 'var(--hm-5)',
] as const;

/**
 * Bucket a day's time against the period's busiest day.
 *
 * ⚠️ EVEN steps, unlike the sibling. Its thresholds are skewed toward the low
 * end (5%, 15%, 35%, 70%) because data usage is dominated by torrent days an
 * order of magnitude above the rest, and linear buckets there paint every
 * ordinary day the palest shade. Screen time has no such tail: a day cannot
 * exceed 24 hours, and ordinary days sit within a factor of three or four of
 * the busiest. Borrowing the skewed thresholds would push almost every day
 * into the top two shades and flatten the map into one colour.
 */
export function heatmapColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HEATMAP_RAMP[0];
  const ratio = value / max;
  if (ratio <= 0.2) return HEATMAP_RAMP[1];
  if (ratio <= 0.4) return HEATMAP_RAMP[2];
  if (ratio <= 0.6) return HEATMAP_RAMP[3];
  if (ratio <= 0.8) return HEATMAP_RAMP[4];
  return HEATMAP_RAMP[5];
}

export interface HeatmapDay {
  date: string;
  ms: number;
}

export interface HeatmapCell {
  date: string;
  ms: number;
  /** A day the data covers. Unknown days are drawn as "not recorded". */
  known: boolean;
  /** After today, or before the block's `from`: not drawn at all. */
  hidden: boolean;
  column: number;
  row: number;
}

export interface HeatmapBlock {
  cells: HeatmapCell[];
  months: Array<{ label: string; column: number }>;
  /** First and last day the block draws -- `from`-clipped, not today-clipped. */
  first: string;
  last: string;
  peak: number;
  total: number;
  activeDays: number;
}

const DAY_MS = 86_400_000;

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Local midnight today, expressed in UTC terms so the arithmetic stays on
 * whole days. `local_date` is already machine-local, so the last column lines
 * up with the reader's calendar day.
 */
export function localToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Saturday-first: Sat = 6 in getUTCDay(), so (day + 1) % 7 puts it at row 0. */
function rowOf(date: Date): number {
  return (date.getUTCDay() + 1) % 7;
}

function weekStartOf(date: Date): Date {
  return addDays(date, -rowOf(date));
}

/**
 * One block of `WEEKS` columns starting on `firstWeek` (a Saturday).
 *
 * Days before `from` are hidden rather than drawn as "not recorded": they are
 * outside what the page is showing, not a gap in what was collected.
 */
function buildBlock(
  byDate: Map<string, number>,
  firstWeek: Date,
  today: Date,
  from: Date | null,
): HeatmapBlock {
  const cells: HeatmapCell[] = [];
  const months: HeatmapBlock['months'] = [];
  let peak = 0;
  let total = 0;
  let activeDays = 0;
  let lastMonth = -1;

  for (let column = 0; column < WEEKS; column += 1) {
    const weekStart = addDays(firstWeek, column * 7);

    // Label a column by the first day it actually draws, so a block clipped
    // to the 1st of a month opens on that month rather than on the days it
    // hides.
    const labelDay = from && weekStart < from ? from : weekStart;
    const month = labelDay.getUTCMonth();
    if (month !== lastMonth) {
      months.push({ label: MONTH_NAMES[month]!, column });
      lastMonth = month;
    }

    for (let row = 0; row < 7; row += 1) {
      const cellDate = addDays(weekStart, row);
      const date = isoDay(cellDate);
      const hidden = cellDate > today || (from !== null && cellDate < from);
      const known = !hidden && byDate.has(date);
      const value = byDate.get(date) ?? 0;

      if (known) {
        peak = Math.max(peak, value);
        total += value;
        if (value > 0) activeDays += 1;
      }

      cells.push({ date, ms: value, known, hidden, column, row });
    }
  }

  // A block opening on a month's last week or two labels that month in column
  // 0 and the next one right beside it, and "JunJul" overlap. Drop the stub.
  if (months.length > 1 && months[1]!.column - months[0]!.column < 3) months.shift();

  const start = from && firstWeek < from ? from : firstWeek;
  return {
    cells, months, peak, total, activeDays,
    first: isoDay(start),
    last: isoDay(addDays(firstWeek, WEEKS * 7 - 1)),
  };
}

function toMap(daily: HeatmapDay[]): Map<string, number> {
  return new Map(daily.map((d) => [d.date, d.ms]));
}

/** The Overview's block: the `WEEKS` weeks ending with the current one. */
export function recentBlock(daily: HeatmapDay[], today = localToday()): HeatmapBlock {
  const firstWeek = addDays(weekStartOf(today), -(WEEKS - 1) * 7);
  return buildBlock(toMap(daily), firstWeek, today, null);
}

/**
 * Every block from the 1st of the month the data begins in, to today, oldest
 * first. Consecutive blocks are contiguous weeks, so no week is split or drawn
 * twice where one block meets the next.
 *
 * ⚠️ Starts at the data, NOT at a fixed date. The sibling opens its page on
 * 1 January 2026, which suits a collector that inherited months of SRUM
 * history. Here the laptop's history begins 2026-08-31 and cannot be
 * backfilled (see CLAUDE.md), so a fixed January start would open the page on
 * a full block of outlined, never-recorded days. The 1st of the month keeps
 * the sibling's point -- a calendar that opens mid-month reads as truncated --
 * without drawing seven empty months first.
 */
export function expandedBlocks(
  daily: HeatmapDay[],
  earliest: string | null,
  today = localToday(),
): HeatmapBlock[] {
  const byDate = toMap(daily);
  const first = earliest ? parseDay(earliest) : today;
  const from = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));

  const blocks: HeatmapBlock[] = [];
  for (let week = weekStartOf(from); week <= today; week = addDays(week, WEEKS * 7)) {
    blocks.push(buildBlock(byDate, week, today, from));
  }
  return blocks;
}

/** "Aug 1 – Jan 29, 2027", or with both years when a block spans New Year. */
export function blockLabel(block: HeatmapBlock): string {
  const short = (iso: string) => {
    const d = parseDay(iso);
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  const y1 = block.first.slice(0, 4);
  const y2 = block.last.slice(0, 4);
  return y1 === y2
    ? `${short(block.first)} – ${short(block.last)}, ${y2}`
    : `${short(block.first)}, ${y1} – ${short(block.last)}, ${y2}`;
}
