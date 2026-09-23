/**
 * The daily trend line: one point per calendar day, and its heaviest day.
 *
 * Pure date arithmetic on `YYYY-MM-DD` strings, so the self-tests can reach it
 * -- `Charts.tsx` is a client component and cannot be imported from a script.
 */

export interface TrendPoint {
  date: string;
  /** Null for a day inside the range with no recording at all. */
  ms: number | null;
}

const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Every calendar day from the first point to the last, with a missing day as
 * NULL rather than zero.
 *
 * A bar chart could leave a missing day out and nobody noticed, because the
 * bars either side stood apart anyway. A LINE joins its points, so a laptop
 * left shut for three days would be drawn as a smooth slope through them --
 * usage invented where there was no measurement. A null breaks the line, and
 * the tooltip says the day was not recorded, which is a different thing from
 * a quiet one.
 */
export function fillDays(points: { date: string; ms: number }[]): TrendPoint[] {
  if (points.length === 0) return [];
  const byDate = new Map(points.map((p) => [p.date, p.ms]));
  const sorted = [...byDate.keys()].sort();
  const out: TrendPoint[] = [];
  for (let t = parseDay(sorted[0]!); t <= parseDay(sorted[sorted.length - 1]!); t += DAY_MS) {
    const date = isoDay(t);
    out.push({ date, ms: byDate.get(date) ?? null });
  }
  return out;
}

/**
 * Each unbroken stretch of unrecorded days, as the recorded days either side.
 *
 * The break `fillDays()` puts in the line is correct and it LOOKED BROKEN:
 * after a laptop hibernated through a whole day, the chart showed a bare
 * wedge cut out of the area either side of it, and it was reported as a
 * rendering fault rather than read as a day with no recording. So the chart
 * shades each stretch and labels it. The band runs from the recorded day before to
 * the recorded day after because that is where the line is missing -- a band
 * over the null day alone would be zero wide on a point axis.
 *
 * `fillDays()` output starts and ends on a recorded day, so every run has
 * both neighbours; a run that somehow lacks one is dropped rather than drawn
 * to an edge it does not have.
 */
export function unrecordedRuns(points: TrendPoint[]): { from: string; to: string; days: number }[] {
  const out: { from: string; to: string; days: number }[] = [];
  let i = 0;
  while (i < points.length) {
    if (points[i]!.ms !== null) { i++; continue; }
    let j = i;
    while (j < points.length && points[j]!.ms === null) j++;
    if (i > 0 && j < points.length) {
      out.push({ from: points[i - 1]!.date, to: points[j]!.date, days: j - i });
    }
    i = j;
  }
  return out;
}

/** The day with the most time, for the card's callout. Null when every day is empty. */
export function heaviestDay(points: { date: string; ms: number | null }[]): { date: string; ms: number } | null {
  let best: { date: string; ms: number } | null = null;
  for (const p of points) {
    if (p.ms !== null && p.ms > 0 && (!best || p.ms > best.ms)) best = { date: p.date, ms: p.ms };
  }
  return best;
}
