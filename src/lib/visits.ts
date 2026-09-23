/**
 * Turning raw foreground sessions into VISITS.
 *
 * Deliberately not `server-only`: this is pure arithmetic over plain objects
 * and it is the kind of logic that is wrong quietly, so it needs to be
 * reachable from `npm run selftest`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * A "session" is what the source hands over, and on both platforms that is
 * finer-grained than what a person means by opening an app:
 *
 *   ANDROID  ACTIVITY_RESUMED fires per ACTIVITY, not per app. Moving from
 *            Instagram's feed to a story to a profile is three sessions.
 *            Measured on real data: one social app had 158 sessions of
 *            which 88 (56%) were under five seconds, and 85 of 157 began
 *            within a minute of the previous one ending. Reported raw, the
 *            detail page said "158 opens, typical session 2s", which describes
 *            the Activity lifecycle rather than the person.
 *
 *   WINDOWS  the sampler ends a span whenever focus changes, so alt-tabbing to
 *            check something and back is three spans of one app.
 *
 * So consecutive sessions of the same app are stitched into one visit when
 * nothing else held the foreground in between and the gap is short.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THAT KEEP THIS HONEST
 *
 * 1. NOTHING ELSE IN BETWEEN. Adjacency is judged against the GLOBAL session
 *    order across every app, not just the target's own rows. If you left
 *    Instagram, used Messenger, and came back, that is genuinely two visits
 *    however small the gap -- and looking only at Instagram's rows cannot tell
 *    the difference.
 *
 * 2. DURATION IS SUMMED, NEVER SPANNED. A visit's length is the sum of its
 *    sessions, not last-end minus first-start. Spanning would silently invent
 *    the gap time as usage, which is the exact failure this project keeps
 *    finding elsewhere. The cost is that a visit's duration can be slightly
 *    less than the wall-clock time it covers, which is the correct direction
 *    to be wrong in.
 */

export interface RawSession {
  /** Whatever identifies the app: a package name or a resolved key. */
  app: string;
  start: number;
  end: number;
}

export interface Visit {
  app: string;
  start: number;
  end: number;
  /** Sum of the member sessions, NOT end - start. See rule 2. */
  ms: number;
  /** How many raw sessions were stitched together. */
  parts: number;
}

/**
 * The gap below which two sessions of one app are the same visit.
 *
 * 30 seconds. Long enough to cover an Activity transition, a permission
 * dialog, or a glance at a notification shade; short enough that genuinely
 * putting the phone down and picking it up again stays two visits.
 *
 * It is a judgement, not a measurement, which is why it is one named constant
 * rather than sprinkled through the queries.
 */
export const VISIT_GAP_MS = 30_000;

/**
 * Stitch sessions into visits.
 *
 * `sessions` must contain EVERY session in the window across all apps, not
 * only the app being asked about -- see rule 1. It is sorted here rather than
 * trusted, because callers assemble it from grouped SQL.
 */
export function stitchVisits(
  sessions: RawSession[],
  gapMs: number = VISIT_GAP_MS,
): Visit[] {
  const sorted = [...sessions].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Visit[] = [];
  let current: Visit | null = null;

  for (const s of sorted) {
    if (
      current !== null &&
      current.app === s.app &&
      s.start - current.end <= gapMs
    ) {
      // Same app, nothing else in between (it would have been the previous
      // element and broken the chain), close enough in time: one visit.
      current.end = Math.max(current.end, s.end);
      current.ms += s.end - s.start;
      current.parts++;
      continue;
    }
    if (current) out.push(current);
    current = { app: s.app, start: s.start, end: s.end, ms: s.end - s.start, parts: 1 };
  }
  if (current) out.push(current);
  return out;
}

export interface VisitStats {
  visits: number;
  medianMs: number;
  longestMs: number;
}

/** Visit statistics for one app, from an already-stitched list. */
export function visitStats(visits: Visit[], app: string): VisitStats {
  const mine = visits.filter((v) => v.app === app).map((v) => v.ms).sort((a, b) => a - b);
  if (mine.length === 0) return { visits: 0, medianMs: 0, longestMs: 0 };
  return {
    visits: mine.length,
    // Median, not mean: one three-hour visit drags a mean somewhere no actual
    // visit ever was, and both platforms are full of very short ones.
    medianMs: mine[Math.floor(mine.length / 2)]!,
    longestMs: mine[mine.length - 1]!,
  };
}

/**
 * Where an open HAPPENED: the local day and hour a visit began.
 *
 * Keyed by the epoch millisecond of a session's start, which is what
 * `Visit.start` carries.
 */
export interface SessionBucket {
  date: string;
  hour: number;
}

export interface OpenBuckets {
  byDate: Map<string, number>;
  byHour: Map<number, number>;
}

/**
 * Count one app's visits into local days and hours.
 *
 * ---------------------------------------------------------------------------
 * AN OPEN IS AN INSTANT, NOT A SPAN. A visit is filed under the day and hour it
 * BEGAN and nowhere else, so an app opened at 23:50 and used until 00:30 counts
 * once, last night, and a two-hour sitting that starts at 09:50 puts one open
 * in the 9 o'clock bar rather than spreading a fraction across three.
 *
 * That is deliberately NOT how the time charts bucket the same visit -- time
 * is split at each boundary, because time genuinely was spent on both sides.
 * Splitting an open would invent an opening that never occurred.
 *
 * `bucketOf` is built from the stored `local_date` / `local_hour` columns
 * rather than recomputed from the UTC stamp. Those were written at ingest from
 * the recording device's own offset; the phone's is not this machine's, and
 * even the laptop's own history would be re-dated by a process running under a
 * different one.
 *
 * A visit whose start is not in `bucketOf` is DROPPED, not guessed at. That is
 * the session which began before the range and ran into it: its first row is
 * outside the query, and the open it represents happened before the window.
 * Filing it under the first row we can see would draw a bar on a day the
 * person did not open the app.
 * ---------------------------------------------------------------------------
 */
export function openBuckets(
  visits: Visit[],
  app: string,
  bucketOf: Map<number, SessionBucket>,
): OpenBuckets {
  const byDate = new Map<string, number>();
  const byHour = new Map<number, number>();
  for (const v of visits) {
    if (v.app !== app) continue;
    const at = bucketOf.get(v.start);
    if (!at) continue;
    byDate.set(at.date, (byDate.get(at.date) ?? 0) + 1);
    byHour.set(at.hour, (byHour.get(at.hour) ?? 0) + 1);
  }
  return { byDate, byHour };
}

/** Visit counts for every app at once, for the tables. */
export function visitCounts(visits: Visit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of visits) counts.set(v.app, (counts.get(v.app) ?? 0) + 1);
  return counts;
}
