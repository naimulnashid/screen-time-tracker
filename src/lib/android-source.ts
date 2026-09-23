/**
 * Where a phone's HEADLINE comes from. Two answers, chosen per device.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO
 *
 * The headline is screen-on time, from SCREEN_INTERACTIVE /
 * SCREEN_NON_INTERACTIVE pairs -- never a sum over the app rows, which
 * measured 0.76x of it. But Android only added those events, and
 * KEYGUARD_SHOWN / HIDDEN with them, in API 28 (Android 9).
 *
 * Measured 2026-09-23 on a Redmi 5 Plus, Android 8.1 / API 27: its event
 * stream holds MOVE_TO_FOREGROUND / MOVE_TO_BACKGROUND and nothing that marks
 * the screen or the lock. So a phone below 28 sends app sessions and no screen
 * spans at all -- not an outage, a fact about the OS -- and a screen-on
 * headline there would read zero every day, forever.
 *
 * For those phones the headline is APP TIME: the time covered by ANY app
 * session, launcher included. It is honestly a smaller number than screen-on
 * (it misses the lock screen and system surfaces), so every page that shows it
 * says "in apps", never "screen on". Unlocks do not exist at all there, and
 * the pages say that rather than showing a zero.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ A UNION, NOT A SUM
 *
 * Summing sessions double-counts any instant two packages both held: a
 * hand-off where the next app resumed a moment before the last one paused,
 * or split-screen. Small, but it is the one direction a headline must never
 * err in, since nothing else on the page can catch it. The union also keeps
 * the physical bound true by construction -- an hour cannot hold more than an
 * hour -- which a sum does not.
 *
 * Segments are stored split at local hour edges, so a union taken per
 * (local_date, local_hour) bucket is exact: no interval crosses a bucket.
 */

/** The Android API level that added SCREEN_* and KEYGUARD_* events. */
export const SCREEN_EVENTS_SDK = 28;

export type HeadlineSource = 'screen' | 'apps';

/**
 * Which headline a device gets.
 *
 * `0` means the phone never reported its API level -- only a build older than
 * the field could send that, and every such build required 29+ -- so it keeps
 * the screen headline rather than being silently demoted.
 */
export function headlineSource(sdkInt: number): HeadlineSource {
  return sdkInt === 0 || sdkInt >= SCREEN_EVENTS_SDK ? 'screen' : 'apps';
}

export interface Interval {
  start: number;
  end: number;
}

/** Milliseconds covered by at least one interval. Overlaps count once. */
export function unionMs(intervals: readonly Interval[]): number {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const i of sorted) {
    if (i.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    } else if (i.end > curEnd) {
      curEnd = i.end;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

export interface SegmentRow {
  date: string;
  hour: number;
  start: number;
  end: number;
}

export interface HourBucket {
  date: string;
  hour: number;
  ms: number;
}

/** Union per (local date, local hour), in date then hour order. */
export function unionByHour(rows: readonly SegmentRow[]): HourBucket[] {
  const groups = new Map<string, { date: string; hour: number; iv: Interval[] }>();
  for (const r of rows) {
    const key = `${r.date}|${r.hour}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { date: r.date, hour: r.hour, iv: [] }));
    g.iv.push({ start: r.start, end: r.end });
  }
  return [...groups.values()]
    .map((g) => ({ date: g.date, hour: g.hour, ms: unionMs(g.iv) }))
    .filter((b) => b.ms > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}
