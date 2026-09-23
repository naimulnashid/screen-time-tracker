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
 * A LINE joins its points, so without the filled-in day a laptop left shut for
 * three days would be drawn as a smooth slope through them -- usage invented
 * where there was no measurement. The trend chart draws a null at zero, so
 * the line dips to the floor and stays continuous. The null itself survives,
 * so the tooltip says the day was not recorded, which is a different thing
 * from a quiet one.
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

/** The day with the most time, for the card's callout. Null when every day is empty. */
export function heaviestDay(points: { date: string; ms: number | null }[]): { date: string; ms: number } | null {
  let best: { date: string; ms: number } | null = null;
  for (const p of points) {
    if (p.ms !== null && p.ms > 0 && (!best || p.ms > best.ms)) best = { date: p.date, ms: p.ms };
  }
  return best;
}
