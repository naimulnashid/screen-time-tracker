/**
 * Formatting helpers.
 *
 * Every numeric string produced here is meant to be rendered with
 * `font-variant-numeric: tabular-nums` (applied globally in globals.css), so
 * digits keep a fixed width and nothing jitters during count-up animations.
 *
 * ---------------------------------------------------------------------------
 * This is the file that differs most from the sibling Data Usage Tracker, and
 * the difference is the whole domain: that project formats BYTES, this one
 * formats DURATIONS. They are not the same problem wearing different units.
 *
 *   - Bytes have one ladder with one base (1024), and one rung is always
 *     enough: "1.09 TB" says everything.
 *   - Durations have a MIXED-RADIX ladder (60s, 60min, 24h) where one rung is
 *     routinely not enough. "6h" threw away 42 minutes; "6.7h" is precise and
 *     unreadable, because nobody thinks about their day in decimal hours.
 *
 * So the primitive here returns TWO rungs, not one, and every caller that
 * wants a single number has to ask for it.
 * ---------------------------------------------------------------------------
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * A duration split into at most two rungs, for styled rendering.
 *
 * `sub` is absent when the second rung would be zero, so "4h 0m" renders as
 * "4h" rather than carrying a decorative zero.
 */
export interface DurationParts {
  value: string;
  unit: string;
  sub?: { value: string; unit: string };
}

/**
 * Pick the two rungs for a duration.
 *
 * The cut-offs are about what a reader is actually asking:
 *
 *   >= 1 hour  "6h 42m"    the everyday case, and the reason for two rungs
 *   >= 1 min   "12m 30s"   seconds still matter for a short session
 *   else       "45s"       a glance at an app, kept honest rather than "0m"
 *
 * THE LADDER STOPS AT HOURS. There is deliberately no day rung, so a
 * multi-day total reads "51h 12m" rather than "2d 3h". Days are the wrong
 * unit for this dashboard twice over:
 *
 *   - Screen time is spent in hours and compared against a day that has 24 of
 *     them. "2d 3h" of screen time across a fortnight has to be unpacked back
 *     into hours before it means anything, and unpacking it in your head is
 *     where the mixed radix actually hurts.
 *   - A "d" here reads as a COUNT OF CALENDAR DAYS, which this dashboard also
 *     reports ("11 days of data") and which is a completely different
 *     quantity. Two units spelled the same on one page is a trap.
 *
 * The ceiling is not a problem in practice: a 30-day range tops out around
 * 720h, which is four digits at worst.
 *
 * Sub-second is floored to "0s" rather than shown in milliseconds. A screen
 * time dashboard that reports "340 ms" is reporting a measurement artefact,
 * not a fact about the person using the machine.
 */
export function splitDuration(ms: number): DurationParts {
  const t = Math.max(0, Math.round(ms));

  if (t >= HOUR) {
    const h = Math.floor(t / HOUR);
    const m = Math.floor((t % HOUR) / MINUTE);
    return m > 0
      ? { value: String(h), unit: 'h', sub: { value: String(m), unit: 'm' } }
      : { value: String(h), unit: 'h' };
  }

  if (t >= MINUTE) {
    const m = Math.floor(t / MINUTE);
    const s = Math.floor((t % MINUTE) / SECOND);
    return s > 0
      ? { value: String(m), unit: 'm', sub: { value: String(s), unit: 's' } }
      : { value: String(m), unit: 'm' };
  }

  return { value: String(Math.floor(t / SECOND)), unit: 's' };
}

/** "6h 42m". The default rendering wherever a duration appears as plain text. */
export function formatDuration(ms: number): string {
  const p = splitDuration(ms);
  return p.sub ? `${p.value}${p.unit} ${p.sub.value}${p.sub.unit}` : `${p.value}${p.unit}`;
}

/**
 * Which rungs `splitDuration` chose. Exists for the count-up animation.
 *
 * Animating a duration by re-formatting the in-flight value makes it change
 * shape as it climbs: a total ending at "6h 42m" would race through "3s",
 * "2m 10s", "58m 4s" and only settle into hours at the very end. Locking the
 * shape to the FINAL value and filling the rungs from the current one keeps
 * the digits in place, which is the whole reason the count-up is pleasant to
 * watch rather than seasick.
 *
 * The bytes version of this problem is `scaleToFinalUnit` in the sibling
 * project. Same bug; harder here, because there are two rungs to hold still.
 */
export type DurationShape = 'h' | 'm' | 's';

export function durationShape(ms: number): DurationShape {
  const t = Math.max(0, Math.round(ms));
  if (t >= HOUR) return 'h';
  if (t >= MINUTE) return 'm';
  return 's';
}

/** Format `ms` using the rungs `final` would have chosen. */
export function formatDurationLike(ms: number, final: number): string {
  const t = Math.max(0, Math.round(ms));
  const hasSub = splitDuration(final).sub !== undefined;

  switch (durationShape(final)) {
    case 'h': {
      const h = Math.floor(t / HOUR);
      return hasSub ? `${h}h ${Math.floor((t % HOUR) / MINUTE)}m` : `${h}h`;
    }
    case 'm': {
      const m = Math.floor(t / MINUTE);
      return hasSub ? `${m}m ${Math.floor((t % MINUTE) / SECOND)}s` : `${m}m`;
    }
    default:
      return `${Math.floor(t / SECOND)}s`;
  }
}

/** "6:42" -- compact and fixed width, for dense table cells. */
export function formatClock(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / HOUR);
  const m = Math.floor((t % HOUR) / MINUTE);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function formatPercent(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "2026-08-21" -> "Aug 21" */
export function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

/** "2026-08-21" -> "Thursday, 21 August 2026" */
export function formatDayLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * The hour buckets a daily chart is drawn on. 14 -> "2 PM".
 *
 * Screen time has a shape across the day that network traffic does not -- a
 * torrent runs at 4am, a person mostly does not -- so the hour-of-day axis is
 * a first-class thing here rather than an afterthought.
 */
export function formatHourOfDay(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatRelative(hours: number): string {
  // Rounded FIRST, then compared. Testing the raw value and rounding after
  // lets 59.7 minutes print as "60 min ago", a rung it has already left.
  const minutes = Math.round(hours * 60);
  // "0 min ago" is what you get right after pressing Sync now, and it reads as
  // a stopped clock rather than as a fresh number.
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 2) return 'yesterday';
  return `${Math.round(days)} days ago`;
}

/**
 * How long a collector RUN took. NOT a screen-time duration.
 *
 * Named apart from `formatDuration` on purpose: this one measures the tool,
 * that one measures the person, and they want opposite precision. Conflating
 * them is how a sync-status page ends up reporting a 1.4-second run as "0m".
 */
export function formatElapsed(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
