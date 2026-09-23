/**
 * Chart axis maths.
 *
 * Split out of `Charts.tsx` for the same reason `sampler-status.ts` was split
 * out of `queries.ts`: that file is a client component and pulls in Recharts,
 * so a self-test cannot import from it. These two functions are pure, and the
 * bug they exist to prevent is exactly the kind that a test catches and an eye
 * does not.
 */

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * An axis tick label, exact rather than rounded.
 *
 * The old version rendered anything past an hour as `Math.round(h) + 'h'`,
 * which is fine only while every tick lands on a whole hour. It does not
 * survive a half-hour step: 1.5h printed as "2h", one tick above 1h and one
 * below 2h, both claiming to be a round number. Since `niceHourAxis` below can
 * legitimately choose a 30-minute step, the formatter has to be exact.
 */
export function hourTick(ms: number): string {
  if (ms === 0) return '0';
  if (ms < HOUR_MS) return `${Math.round(ms / MIN_MS)}m`;
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.round((ms % HOUR_MS) / MIN_MS);
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/**
 * Steps an axis is allowed to count in. Every one divides cleanly into a way
 * of thinking about time -- there is no 7-minute or 5-hour tick here.
 */
const AXIS_STEPS = [
  MIN_MS, 2 * MIN_MS, 5 * MIN_MS, 10 * MIN_MS, 15 * MIN_MS, 30 * MIN_MS,
  HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 4 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS,
  24 * HOUR_MS,
];

/** At most this many intervals, so labels never crowd. */
const MAX_INTERVALS = 6;

/**
 * A domain and ticks that END AT THE DATA, not well past it.
 *
 * ⚠️ Left to itself, Recharts picks a "nice" ceiling from a FIXED TICK COUNT
 * (5 by default) and will happily overshoot to get there. Measured on the
 * phone's Top apps chart: YouTube peaked at 11h 5m and the axis ran to 17h --
 * more than half as much empty space again as data, which makes every bar look
 * shorter than it is and makes the chart read as though the day had 17 hours
 * of YouTube in it somewhere off to the right.
 *
 * So the step is chosen first, from a list of steps that mean something to a
 * person, and the ceiling falls out of it: the smallest allowed step that
 * covers the peak in at most six intervals. 11h 5m takes a 2h step and ends at
 * 12h, one step above the tallest bar rather than six.
 */
export function niceHourAxis(peak: number): { domain: [number, number]; ticks: number[] } {
  if (!(peak > 0)) return { domain: [0, MIN_MS], ticks: [0, MIN_MS] };

  const step = AXIS_STEPS.find((s) => peak / s <= MAX_INTERVALS)
    // Past a day, fall back to whole days' worth of hours rather than giving up.
    ?? Math.ceil(peak / MAX_INTERVALS / HOUR_MS) * HOUR_MS;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { domain: [0, max], ticks };
}

/**
 * Steps a COUNT axis is allowed to use.
 *
 * Same idea as `AXIS_STEPS`, different ladder: counts are decimal, so the
 * rungs people read easily are 1/2/5 and their powers of ten. 25 and 250 earn
 * their place because unlock counts land there -- a peak of 130 takes a 25
 * step and stops at 150, where a pure 1/2/5 ladder would jump to 200.
 */
const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/**
 * `niceHourAxis` for a whole-number quantity: opens, unlocks, sessions.
 *
 * Exists for the same reason and prevents the same failure -- Recharts
 * overshooting the data to reach a "nice" ceiling from a fixed tick count.
 * Every tick it returns is an INTEGER, which matters more here than on the
 * time axis: half an unlock is not a thing, and an axis that offers one says
 * the chart is measuring something it is not.
 */
export function niceCountAxis(peak: number): { domain: [number, number]; ticks: number[] } {
  if (!(peak > 0)) return { domain: [0, 1], ticks: [0, 1] };

  const step = COUNT_STEPS.find((s) => peak / s <= MAX_INTERVALS)
    // Past a thousand, keep counting in whole thousands rather than giving up.
    ?? Math.ceil(peak / MAX_INTERVALS / 1000) * 1000;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { domain: [0, max], ticks };
}
