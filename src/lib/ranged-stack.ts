import 'server-only';
import type { RangedStack } from '@/components/RangedCharts';
import { perRange, type ChartRange } from './scope';
import { stackByApp, type StackInput } from './stack';
import { stackSeries } from './stack-series';

/**
 * One stacked chart per range, each ranking ITS OWN top eight: last week
 * drawn through the year's top apps would fold last week's real leaders into
 * Other. Built here from one read of the rows; the range menu only picks one.
 */
export function rangedStacks(opts: {
  rows: StackInput[];
  /** Every day with a recording, so a quiet day still gets a column. */
  recorded: string[];
  /** The newest day with data, which anchors every range. */
  latest: string;
  nameOf: (id: string) => { name: string; base: string };
  device: string | string[];
  picked: Map<string, string>;
  /** Ids left out of the stack and counted instead (a phone's home screen). */
  exclude?: (id: string) => boolean;
}): Record<ChartRange, RangedStack> {
  const { rows, recorded, latest, nameOf, device, picked, exclude = () => false } = opts;
  return perRange(latest, (from) => {
    const inRange = rows.filter((r) => r.date >= from);
    const excluded = inRange.filter((r) => exclude(r.id)).reduce((n, r) => n + r.value, 0);
    const s = stackByApp(inRange.filter((r) => !exclude(r.id)), recorded.filter((d) => d >= from));
    return { points: s.points, series: stackSeries(s.series, nameOf, device, picked), excluded };
  });
}
