/**
 * A sentence for each chart, for anyone who cannot see it.
 *
 * WCAG 1.1.1: an SVG of bars has no words, and the daily trend and the shape
 * of the day exist nowhere else on the page as text. Each summary says what a
 * sighted reader takes from the chart at a glance -- the range, the typical
 * value, the peak, the ranking -- rather than reading out every bar.
 *
 * Lives here rather than in `Charts.tsx` because that is a client component
 * that imports Recharts, so the self-test cannot import it. Same split, same
 * reason, as `axis.ts`.
 */

import { formatDayLong, formatHourOfDay } from './format';

type Fmt = (n: number) => string;

/**
 * Per-day series. `null` is a day with no recording, which is reported as
 * such rather than averaged in as zero -- the same rule the trend line follows.
 */
export function dailySummary(
  what: string,
  points: { date: string; value: number | null }[],
  fmt: Fmt,
): string {
  if (points.length === 0) return `${what}: no data in this range.`;
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const span = `${formatDayLong(points[0]!.date)} to ${formatDayLong(points[points.length - 1]!.date)}`;
  if (recorded.length === 0) return `${what}, ${span}: nothing recorded.`;
  const total = recorded.reduce((s, p) => s + p.value, 0);
  const peak = recorded.reduce((a, b) => (b.value > a.value ? b : a));
  const missing = points.length - recorded.length;
  return (
    `${what}, ${span}: ${recorded.length} day${recorded.length === 1 ? '' : 's'} recorded` +
    (missing ? `, ${missing} not recorded` : '') +
    `. Average ${fmt(total / recorded.length)} a day; highest ${fmt(peak.value)} on ${formatDayLong(peak.date)}.`
  );
}

/** By hour of day: the busiest three hours, and how much of the day saw any. */
export function hourlySummary(
  what: string,
  points: { hour: number; value: number }[],
  fmt: Fmt,
): string {
  const active = points.filter((p) => p.value > 0);
  if (active.length === 0) return `${what}: nothing recorded.`;
  const top = [...active].sort((a, b) => b.value - a.value).slice(0, 3);
  return (
    `${what}: busiest ${top.map((p) => `${formatHourOfDay(p.hour)} (${fmt(p.value)})`).join(', ')}. ` +
    `${active.length} of 24 hours have any.`
  );
}

/** Ranked apps: the leaders by name, and how many more the chart holds. */
export function rankedSummary(
  what: string,
  items: { name: string; value: number }[],
  fmt: Fmt,
  show = 5,
): string {
  if (items.length === 0) return `${what}: none in this range.`;
  const head = items.slice(0, show).map((d, i) => `${i + 1}. ${d.name}, ${fmt(d.value)}`);
  const rest = items.length - head.length;
  return `${what}: ${head.join('; ')}${rest > 0 ? `; and ${rest} more` : ''}.`;
}
