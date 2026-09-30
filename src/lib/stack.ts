/**
 * The Overviews' stacked "by day" charts: per-app values per day, folded into
 * the top few apps plus Other.
 *
 * Shaped after the sibling Data Usage Tracker's "Daily by app", and pure so
 * the self-test can reach it -- `Charts.tsx` is a client component that
 * imports Recharts, and a script cannot import from it.
 */

import { fillDays } from './trend';

/** One app's value on one day: milliseconds, or a count of opens. */
export interface StackInput {
  date: string;
  /** The app's identity: a resolved Windows key or an Android package. */
  id: string;
  value: number;
}

export interface StackSeries {
  /**
   * The chart's data key: `s0`..`s7`, or `other`. Synthetic on purpose.
   * Recharts reads a dotted dataKey as a PATH, so a package name like
   * `com.android.chrome` -- or an app called `Node.js` -- would plot nothing.
   */
  key: string;
  /** Null for Other, which is many apps. */
  id: string | null;
  total: number;
}

export interface StackPoint {
  date: string;
  /**
   * False on a day with no recording at all. Plotted at zero, like the trend
   * line, so the bands stay continuous; the tooltip says "Not recorded"
   * rather than listing a row of zeros.
   */
  recorded: boolean;
  v: Record<string, number>;
}

export const OTHER = 'other';

/**
 * `recorded` is the set of days the HEADLINE recorded -- the same days the
 * trend line above draws as points -- so the two charts agree about which
 * days are gaps. A day holding app rows counts as recorded as well, so
 * nothing is ever dropped for falling outside that set.
 *
 * The top `topN` apps are ranked by their total over the whole range, and
 * everything else is summed into Other. Other appears only when there IS an
 * everything else: a legend entry for an empty band would be noise.
 */
export function stackByApp(
  rows: StackInput[],
  recorded: Iterable<string>,
  topN = 8,
): { series: StackSeries[]; points: StackPoint[] } {
  const totals = new Map<string, number>();
  const perDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.value <= 0) continue;
    totals.set(r.id, (totals.get(r.id) ?? 0) + r.value);
    const day = perDay.get(r.date) ?? new Map<string, number>();
    day.set(r.id, (day.get(r.id) ?? 0) + r.value);
    perDay.set(r.date, day);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, topN);
  const rest = ranked.slice(topN);
  const series: StackSeries[] = top.map(([id, total], i) => ({ key: `s${i}`, id, total }));
  if (rest.length > 0) {
    series.push({ key: OTHER, id: null, total: rest.reduce((n, [, t]) => n + t, 0) });
  }
  const keyOf = new Map(top.map(([id], i) => [id, `s${i}`]));

  const days = new Set([...recorded, ...perDay.keys()]);
  const calendar = fillDays([...days].map((date) => ({ date, ms: 0 })));
  const points = calendar.map(({ date, ms }) => {
    const v: Record<string, number> = Object.fromEntries(series.map((s) => [s.key, 0]));
    for (const [id, value] of perDay.get(date) ?? []) {
      const key = keyOf.get(id) ?? OTHER;
      v[key] = (v[key] ?? 0) + value;
    }
    return { date, recorded: ms !== null, v };
  });
  return { series, points };
}

/**
 * The first item with the strictly greatest POSITIVE value, for a card's
 * callout -- the busiest hour, the day with the most opens. Null when every
 * value is zero: "Busiest hour 12 AM, 0 opens" would be the first bucket
 * winning a tie, not a finding.
 */
export function peakOf<T>(items: readonly T[], value: (t: T) => number): T | null {
  let best: T | null = null;
  let bestValue = 0;
  for (const item of items) {
    const v = value(item);
    if (v > bestValue) {
      best = item;
      bestValue = v;
    }
  }
  return best;
}
