/**
 * Phase 1b, Android half: what do the numbers mean, and how far back do they go?
 *
 * Reads a capture left by `npm run android:capture`. Unelevated, needs no
 * device, and re-runnable -- same split as the Windows side, and for the same
 * reason: the analysis needed half a dozen passes there and would have cost a
 * fresh capture each time.
 *
 * MEASURED FORMAT, Nothing A001, Android 16 / API 36, 2026-08-31. Four things
 * here are easy to get wrong and each one silently changes the answer.
 *
 * 1. DURATIONS ARE RENDERED, NOT NUMERIC, and the rendering is AMBIGUOUS.
 *
 *      totalTimeUsed="10:52"      -> 10 minutes 52 seconds
 *      totalTime="12:30:14"       -> 12 hours 30 minutes 14 seconds
 *
 *    Android's DateUtils.formatElapsedTime drops the hours field when it is
 *    zero, so field width alone decides the unit. Reading "10:52" as h:mm is
 *    wrong by 60x, and wrong in the direction that makes a phone look like it
 *    was used all day. NOTE this is a dumpsys RENDERING artefact only -- the
 *    UsageStats API returns milliseconds, so the APK in Phase 2 does not
 *    inherit this problem. It matters here, for validation.
 *
 * 2. THE FIELD IS `totalTimeUsed`, NOT `totalTime`.
 *
 *    `totalTime=` in this dump belongs to the `config=` (configuration) rows,
 *    which are screen-orientation records, not app usage. A probe for
 *    "totalTime=" finds 14 configuration rows and misses all 645 package rows.
 *    Same class of bug as the sibling project's `SidType` / `Sid` mixup.
 *
 * 3. THERE ARE FOUR TIME FIELDS PER PACKAGE and only one is screen time.
 *
 *      totalTimeUsed     foreground, i.e. getTotalTimeInForeground()
 *      totalTimeVisible  API 29+ getTotalTimeVisible(), a DIFFERENT number
 *      totalTimeFS       foreground SERVICE time -- not screen time at all
 *
 *    Measured on this device: com.google.android.youtube had
 *    totalTimeUsed="16:04" but totalTimeFS="38:17". Foreground-service time
 *    exceeding foreground time is music playing with the screen off. Adding FS
 *    to screen time is the project's defining overshoot trap, pre-made.
 *
 * 4. THE DUMP CONTAINS MORE THAN ONE USER.
 *
 *    Two "In-memory daily stats" blocks and two "Database Summary" blocks
 *    appear. The sibling project found cloned apps under user profile 999.
 *    Summing across users double-counts shared packages, so identical event
 *    lines are deduplicated here and the count is reported.
 *
 *   npm run android:analyze
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 60_000;
const HOUR = 3_600_000;

/* ------------------------------------------------------------------ */
/* Locating the newest capture                                         */
/* ------------------------------------------------------------------ */

function captureDir(): string {
  const explicit = process.argv[2];
  if (explicit) return explicit;

  let base = '';
  try {
    const cfg = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
    ) as { scratchDir?: string };
    base = cfg.scratchDir ?? '';
  } catch {
    /* fall through */
  }
  if (!base) base = join(process.env['TEMP'] ?? '.', 'screentime-scratch');

  const root = join(base, 'android');
  if (!existsSync(root)) {
    throw new Error(`No captures at ${root}. Run: npm run android:capture`);
  }
  const dirs = readdirSync(root)
    .map((d) => join(root, d))
    .filter((d) => statSync(d).isDirectory())
    .sort();
  const newest = dirs[dirs.length - 1];
  if (!newest) throw new Error(`No captures inside ${root}. Run: npm run android:capture`);
  return newest;
}

/* ------------------------------------------------------------------ */
/* Parsing the measured format                                         */
/* ------------------------------------------------------------------ */

/**
 * "10:52" -> 652_000 ms. "12:30:14" -> 45_014_000 ms.
 *
 * Field COUNT decides the unit, because DateUtils.formatElapsedTime omits a
 * zero hours field. See trap 1 at the top of this file.
 */
export function parseRenderedDuration(s: string): number | null {
  const parts = s.trim().split(':');
  if (parts.length < 2 || parts.length > 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  // Read right-to-left: seconds, minutes, hours, days.
  const scale = [1000, MIN, HOUR, 24 * HOUR];
  let ms = 0;
  for (let i = 0; i < nums.length; i++) {
    ms += nums[nums.length - 1 - i]! * scale[i]!;
  }
  return ms;
}

/** `"2026-08-30 22:22:17"` in DEVICE-LOCAL time. Durations are unaffected. */
function parseStamp(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const t = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
  // The epoch sentinel Android writes for "never".
  return t < 86_400_000 * 365 ? null : t;
}

interface PkgStat {
  pkg: string;
  used: number;
  visible: number;
  fs: number;
  launches: number;
}

function parsePackageRows(block: string): PkgStat[] {
  const out: PkgStat[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.includes('package=') || !line.includes('totalTimeUsed=')) continue;
    const pkg = /package=(\S+)/.exec(line)?.[1];
    if (!pkg) continue;
    const grab = (field: string) => {
      const v = new RegExp(`${field}="([^"]*)"`).exec(line)?.[1];
      return v ? (parseRenderedDuration(v) ?? 0) : 0;
    };
    out.push({
      pkg,
      used: grab('totalTimeUsed'),
      visible: grab('totalTimeVisible'),
      fs: grab('totalTimeFS'),
      launches: Number(/appLaunchCount=(\d+)/.exec(line)?.[1] ?? 0),
    });
  }
  return out;
}

interface Event {
  time: number;
  type: string;
  pkg: string;
}

function parseEvents(dump: string): { events: Event[]; duplicates: number } {
  const seen = new Set<string>();
  const events: Event[] = [];
  let duplicates = 0;

  for (const line of dump.split(/\r?\n/)) {
    const m = /time="([^"]+)"\s+type=([A-Z_]+)\s+package=(\S+)/.exec(line);
    if (!m) continue;
    const time = parseStamp(m[1]!);
    if (time === null) continue;

    // Deduplicate identical lines: the dump carries a section per user and
    // system events appear in both. See trap 4.
    const key = `${m[1]}|${m[2]}|${m[3]}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    events.push({ time, type: m[2]!, pkg: m[3]! });
  }
  events.sort((a, b) => a.time - b.time);
  return { events, duplicates };
}

/**
 * Intervals between `open` -> `close` pairs.
 *
 * A dump is a slice of a running system, so the stream can start closed and
 * can end open. The two ends are NOT symmetrical and must not be treated the
 * same way:
 *
 *   - a CLOSE with no matching open began before the window: discard it,
 *     because its start time is unknown;
 *   - an OPEN with no matching close is still running: **count it**, clipped
 *     to `closeAt`, because its start time is known and the time is real.
 *
 * Discarding the second is what made "today" under-report. See the note in
 * the body.
 */
function pairedIntervals(
  events: Event[],
  open: string,
  close: string,
  closeAt: number,
): { intervals: { start: number; end: number }[]; danglingOpen: number; inFlightMs: number } {
  const intervals: { start: number; end: number }[] = [];
  let openedAt: number | null = null;
  let danglingOpen = 0;
  let inFlightMs = 0;

  for (const e of events) {
    if (e.type === open) {
      if (openedAt !== null) danglingOpen++;
      openedAt = e.time;
    } else if (e.type === close) {
      if (openedAt !== null) {
        intervals.push({ start: openedAt, end: e.time });
        openedAt = null;
      }
    }
  }

  /*
    ⚠️ CLOSE THE IN-FLIGHT SESSION AT CAPTURE TIME. Do not discard it.

    The screen is usually ON at the moment you take a capture -- you are
    holding the phone. That last SCREEN_INTERACTIVE has no matching
    SCREEN_NON_INTERACTIVE yet, and the first version of this function threw it
    away, so "today" was short by however long the current session had run.

    Caught by capturing twice seven minutes apart: the per-app sum grew by
    eight minutes while screen-on stayed frozen. A figure that does not
    move while its components do is the tell.

    This is the same question flagged in CLAUDE.md for the Windows sampler --
    whether the in-flight session is persisted or only written on focus change
    -- and the answer is now measured rather than guessed: it MUST be counted,
    clipped to the moment of observation.
  */
  if (openedAt !== null) {
    danglingOpen++;
    if (closeAt > openedAt) {
      intervals.push({ start: openedAt, end: closeAt });
      inFlightMs = closeAt - openedAt;
    }
  }
  return { intervals, danglingOpen, inFlightMs };
}

function totalMs(intervals: { start: number; end: number }[]): number {
  return intervals.reduce((a, iv) => a + (iv.end - iv.start), 0);
}

/**
 * Split intervals across LOCAL midnights and total them per calendar day.
 *
 * This is not a reporting nicety, it is the whole comparison. Digital
 * Wellbeing reports a CALENDAR DAY; a rolling 24-hour window is a different
 * quantity and the two disagreed by 5.7x on the first attempt purely because
 * of that. A screen-on stretch that runs past midnight belongs to both days,
 * split at the boundary.
 *
 * It is also the same denormalisation the schema needs: bucketing on UTC
 * instead of local time shifts every daily total by the offset, which for a
 * screen-time dashboard puts late-evening use on the wrong day.
 */
function byLocalDay(intervals: { start: number; end: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const key = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const nextMidnight = (t: number) => {
    const d = new Date(t);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  };

  for (const iv of intervals) {
    let cur = iv.start;
    while (cur < iv.end) {
      const boundary = Math.min(nextMidnight(cur), iv.end);
      out.set(key(cur), (out.get(key(cur)) ?? 0) + (boundary - cur));
      cur = boundary;
    }
  }
  return out;
}

/**
 * Per-package foreground intervals from RESUMED -> PAUSED/STOPPED.
 *
 * Returns intervals rather than totals so they can be split across local
 * midnights the same way screen-on is. The app open at capture time is closed
 * at `closeAt` for the reason documented in `pairedIntervals`.
 */
function sessionsByPackage(
  events: Event[],
  closeAt: number,
): Map<string, { intervals: { start: number; end: number }[] }> {
  const openAt = new Map<string, number>();
  const out = new Map<string, { intervals: { start: number; end: number }[] }>();
  const push = (pkg: string, start: number, end: number) => {
    if (end <= start) return;
    const entry = out.get(pkg) ?? { intervals: [] };
    entry.intervals.push({ start, end });
    out.set(pkg, entry);
  };

  for (const e of events) {
    if (e.type === 'ACTIVITY_RESUMED') {
      openAt.set(e.pkg, e.time);
    } else if (e.type === 'ACTIVITY_PAUSED' || e.type === 'ACTIVITY_STOPPED') {
      const started = openAt.get(e.pkg);
      if (started === undefined) continue;
      openAt.delete(e.pkg);
      push(e.pkg, started, e.time);
    }
  }
  for (const [pkg, started] of openAt) push(pkg, started, closeAt);
  return out;
}

function fmt(ms: number): string {
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / MIN);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ------------------------------------------------------------------ */

function main(): void {
  const dir = captureDir();
  const file = join(dir, 'usagestats.txt');
  if (!existsSync(file)) throw new Error(`No usagestats.txt in ${dir}`);
  console.log(`Reading ${file}\n`);
  const dump = readFileSync(file, 'utf8');

  /* --- 1. RETENTION ------------------------------------------------ */
  console.log('=== 1. RETENTION: how far back does each granularity reach? ===');
  console.log('    (this sets the collector cadence: collect faster than eviction)');
  const intervals = ['daily', 'weekly', 'monthly', 'yearly'] as const;
  for (const iv of intervals) {
    const re = new RegExp(`${iv} stats files: (\\d+), sorted list of files:([\\s\\S]*?)(?=\\n\\s*\\w+ stats files:|\\n\\s*\\n|$)`, 'g');
    const stamps = new Set<string>();
    let count = 0;
    for (const m of dump.matchAll(re)) {
      count = Math.max(count, Number(m[1]));
      for (const s of (m[2] ?? '').matchAll(/="([^"]+)"/g)) stamps.add(s[1]!);
    }
    const sorted = [...stamps].sort();
    console.log(
      `  ${iv.padEnd(8)} files=${String(count).padStart(3)}   ` +
        (sorted.length
          ? `${sorted[0]}  ->  ${sorted[sorted.length - 1]}`
          : '(no file list found)'),
    );
  }

  /* --- 2. EVENTS --------------------------------------------------- */
  const { events, duplicates } = parseEvents(dump);
  console.log(`\n=== 2. EVENTS ===`);
  console.log(`  unique events    : ${events.length.toLocaleString()}`);
  console.log(`  duplicates dropped: ${duplicates.toLocaleString()}  (same line under a second user)`);
  if (events.length === 0) {
    console.log('  No events parsed; the rest of this analysis needs them.');
    return;
  }
  const evStart = events[0]!.time;
  const evEnd = events[events.length - 1]!.time;
  const evSpanMs = evEnd - evStart;
  console.log(`  span             : ${new Date(evStart).toLocaleString()}  ->  ${new Date(evEnd).toLocaleString()}`);
  console.log(`  span length      : ${(evSpanMs / HOUR).toFixed(1)} h  (${(evSpanMs / (24 * HOUR)).toFixed(2)} days)`);
  console.log('  >> EVENT retention is the real constraint on session-level fidelity.');

  /* --- 3. THE TRAP TEST -------------------------------------------- */
  console.log('\n=== 3. THE TRAP TEST: does per-app time exceed screen-on time? ===');
  // The moment of observation: the newest event in the dump. Anything still
  // open is clipped here rather than discarded.
  const closeAt = evEnd;
  const screenOn = pairedIntervals(events, 'SCREEN_INTERACTIVE', 'SCREEN_NON_INTERACTIVE', closeAt);
  const unlocked = pairedIntervals(events, 'KEYGUARD_HIDDEN', 'KEYGUARD_SHOWN', closeAt);
  const screenOnMs = totalMs(screenOn.intervals);
  const unlockedMs = totalMs(unlocked.intervals);
  const perApp = sessionsByPackage(events, closeAt);
  const appIntervals = [...perApp.values()].flatMap((e) => e.intervals);
  const appTotal = totalMs(appIntervals);

  console.log(`  screen ON  (INTERACTIVE pairs) : ${fmt(screenOnMs).padStart(9)}   pairs=${screenOn.intervals.length}  in-flight=${fmt(screenOn.inFlightMs)}`);
  console.log(`  UNLOCKED   (KEYGUARD pairs)    : ${fmt(unlockedMs).padStart(9)}   pairs=${unlocked.intervals.length}  in-flight=${fmt(unlocked.inFlightMs)}`);
  console.log(`  sum of per-app sessions        : ${fmt(appTotal).padStart(9)}   apps=${perApp.size}`);
  console.log(`  rolling window                 : ${fmt(evSpanMs).padStart(9)}`);
  console.log('');
  console.log(`  app-sum / screen-on : ${screenOnMs ? (appTotal / screenOnMs).toFixed(2) + 'x' : 'n/a'}`);
  console.log(`  app-sum / unlocked  : ${unlockedMs ? (appTotal / unlockedMs).toFixed(2) + 'x' : 'n/a'}`);
  console.log(
    screenOnMs && appTotal > screenOnMs * 1.02
      ? '  >> OVERSHOOT. Per-app time exceeds screen-on time, so the headline\n' +
        '     MUST come from screen-on events, never SUM() over apps.'
      : '  >> Per-app time fits inside screen-on time in this window.',
  );

  /* --- 3b. PER CALENDAR DAY -- the only figure comparable to the phone --- */
  console.log('\n=== 3b. SCREEN-ON PER LOCAL CALENDAR DAY ===');
  console.log('    Digital Wellbeing reports a CALENDAR DAY. A rolling 24h window is a');
  console.log('    different quantity; comparing the two is how you get a 5.7x "error"');
  console.log('    that is really just two different questions.');
  const dayScreen = byLocalDay(screenOn.intervals);
  const dayUnlocked = byLocalDay(unlocked.intervals);
  const dayApps = byLocalDay(appIntervals);

  const days = [...new Set([...dayScreen.keys(), ...dayUnlocked.keys()])].sort();
  console.log('');
  console.log('  ' + 'day'.padEnd(14) + 'screen on'.padStart(11) + 'unlocked'.padStart(11) + 'app sum'.padStart(11) + '   coverage');
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  for (const d of days) {
    const partial =
      d === firstDay ? ' (PARTIAL - window starts mid-day)'
        : d === lastDay ? ' (PARTIAL - up to capture time)'
          : '';
    console.log(
      '  ' + d.padEnd(14) +
        fmt(dayScreen.get(d) ?? 0).padStart(11) +
        fmt(dayUnlocked.get(d) ?? 0).padStart(11) +
        fmt(dayApps.get(d) ?? 0).padStart(11) +
        partial,
    );
  }
  console.log(`
  >> Compare Digital Wellbeing's TODAY against the LAST row, and only that
     row. Every other day here is clipped by the 24h event window.`);

  /* --- 4. THE THREE TIME FIELDS ------------------------------------ */
  console.log('\n=== 4. totalTimeUsed vs totalTimeVisible vs totalTimeFS ===');
  const dailyBlocks = [...dump.matchAll(/In-memory daily stats\s*\n\s*timeRange="([^"]*)"([\s\S]*?)(?=\n\s*In-memory|\n\s*UsageStatsDatabase|$)/g)];
  let bi = 0;
  for (const block of dailyBlocks) {
    bi++;
    const rows = parsePackageRows(block[2] ?? '');
    if (!rows.length) continue;
    const used = rows.reduce((a, r) => a + r.used, 0);
    const visible = rows.reduce((a, r) => a + r.visible, 0);
    const fs = rows.reduce((a, r) => a + r.fs, 0);
    console.log(`\n  block ${bi}  timeRange="${block[1]}"   packages=${rows.length}`);
    console.log(`    sum totalTimeUsed    : ${fmt(used)}`);
    console.log(`    sum totalTimeVisible : ${fmt(visible)}   (${used ? ((visible / used - 1) * 100).toFixed(1) : '0'}% vs used)`);
    console.log(`    sum totalTimeFS      : ${fmt(fs)}   <- foreground SERVICE, not screen time`);
    const worst = rows.filter((r) => r.fs > r.used).sort((a, b) => b.fs - a.fs).slice(0, 3);
    if (worst.length) {
      console.log('    apps whose FS time exceeds foreground time (media with screen off):');
      for (const r of worst) {
        console.log(`      ${r.pkg.padEnd(42)} used=${fmt(r.used).padStart(8)}  FS=${fmt(r.fs).padStart(8)}`);
      }
    }
  }

  /* --- 5. TOP APPS BY RECONSTRUCTED SESSIONS ----------------------- */
  console.log('\n=== 5. Top apps by session time, reconstructed from events ===');
  const top = [...perApp.entries()].map((e) => [e[0], { ms: totalMs(e[1].intervals), sessions: e[1].intervals.length }] as const).sort((a, b) => b[1].ms - a[1].ms).slice(0, 15);
  console.log('  ' + 'package'.padEnd(46) + 'time'.padStart(10) + 'sessions'.padStart(10));
  for (const [pkg, e] of top) {
    console.log('  ' + pkg.slice(0, 45).padEnd(46) + fmt(e.ms).padStart(10) + String(e.sessions).padStart(10));
  }

  console.log(`
=== Check against the phone ===

  Open Settings -> Digital Wellbeing on the phone. Its figure is derived from
  these same events, so the screen-on total in section 3 should land close to
  it for the same window. If it does not, the reconstruction is wrong and
  nothing built on it can be trusted.
`);
}

main();
