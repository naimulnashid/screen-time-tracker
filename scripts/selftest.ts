/**
 * Pipeline self-tests. No admin, no phone, no real SRUM, no dev server.
 *
 * Run this after touching ingest, the schema, or the duration formatter:
 *
 *   npm run selftest
 *
 * The database it opens lives in TEMP and is the ONLY thing in this project
 * permitted to pass `allowSystemDrive`. The collector must never set it: a
 * real database on C:\ silently defeats the whole point, and the failure is
 * invisible until a reset has already destroyed the history.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, backupDatabase, isBackupContention } from '../src/lib/db';
import { splitIntoHours, segmentRows, SEGMENT_INSERT_SQL } from '../src/lib/windows-ingest';
import {
  splitDuration, formatDuration, formatDurationLike, durationShape, formatClock,
  formatRelative,
} from '../src/lib/format';
import { ingestAndroid, splitIntoLocalHours, payloadProblem, PAYLOAD_LIMITS } from '../src/lib/android-ingest';
import { safeNextPath } from '../src/lib/safe-next';
import { dailySummary, hourlySummary, rankedSummary } from '../src/lib/chart-summary';
import { LoginThrottle, clientKey, FREE_FAILURES, WINDOW_MS, GLOBAL_FAILURES } from '../src/lib/login-throttle';
import { issueSession, verifySession } from '../src/lib/auth';
import { slugify } from '../src/lib/slug';
import { windowsPages, androidPages, pagesForPath } from '../src/lib/nav';
import { deviceOf } from '../src/lib/accent';
import { getSamplerStatus } from '../src/lib/sampler-status';
import {
  logoDir, logoKey, logoUrl, needsLightPlate, allLogoFiles, deviceScopeKeys, logoIdentity,
  logoFileForKey,
} from '../src/lib/app-logo';
import { resolveApp, knownApps } from '../src/lib/app-name';
import {
  brandColour, brandColourForIdentity, ensureReadable, parseBrandColours,
} from '../src/lib/app-colour';
import { hourTick, niceHourAxis, niceCountAxis } from '../src/lib/axis';
import { queryString } from '../src/lib/scope';
import { isHomeSurface } from '../src/lib/home-surface';
import { stitchVisits, visitStats, visitCounts, openBuckets } from '../src/lib/visits';
import { isListed, splitForList, listRule, LIST_MIN_MS, LIST_MIN_OPENS, LIST_MIN_DAYS } from '../src/lib/app-list';
import { fillDays, heaviestDay } from '../src/lib/trend';
import {
  recentBlock, expandedBlocks, blockLabel, heatmapColor, HEATMAP_RAMP, WEEKS, DAY_LABELS,
} from '../src/lib/heatmap';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

function section(name: string): void {
  console.log(`\n=== ${name} ===`);
}

const MIN = 60_000;
const HOUR = 3_600_000;

/* ------------------------------------------------------------------ */
section('duration ladder');

// The everyday case, and the reason splitDuration returns two rungs.
check('6h42m', formatDuration(6 * HOUR + 42 * MIN), '6h 42m');
// Exactly on the hour: no decorative "0m".
check('exactly 1h', formatDuration(HOUR), '1h');
check('1h has no sub-rung', splitDuration(HOUR).sub, undefined);
// The last tick below the hour rung must not round up into it.
check('59m59s', formatDuration(59 * MIN + 59_000), '59m 59s');
// Sub-minute stays honest rather than collapsing to "0m".
check('45s', formatDuration(45_000), '45s');
// The ladder STOPS at hours. A multi-day total keeps counting hours rather
// than rolling into a "d" rung, because "d" on this dashboard already means a
// count of calendar days -- and because screen time is compared against a day
// of 24 hours, so hours are the unit that needs no unpacking.
check('26h', formatDuration(26 * HOUR), '26h');
check('26h30m', formatDuration(26 * HOUR + 30 * MIN), '26h 30m');
// A month-scale range: four digits, still hours.
check('720h', formatDuration(720 * HOUR), '720h');
// Sub-second is a measurement artefact, not a fact about a person.
check('340ms', formatDuration(340), '0s');

// The count-up must not change SHAPE as it climbs. A total ending at "6h 42m"
// has to render in h/m the whole way up, not race through seconds.
const finalValue = 6 * HOUR + 42 * MIN;
check('countup at 1%', formatDurationLike(finalValue * 0.01, finalValue), '0h 4m');
check('countup at 50%', formatDurationLike(finalValue * 0.5, finalValue), '3h 21m');
check('countup lands exactly', formatDurationLike(finalValue, finalValue), '6h 42m');
check('shape is stable', durationShape(finalValue * 0.01) !== durationShape(finalValue), true);

check('clock format', formatClock(6 * HOUR + 42 * MIN), '6:42');
check('clock pads minutes', formatClock(6 * HOUR + 5 * MIN), '6:05');

// The freshness line on both Overviews. It rounds to minutes BEFORE choosing
// a rung: testing the raw value and rounding afterwards printed 59.7 minutes
// as "60 min ago", a rung it had already left.
check('relative, fresh', formatRelative(12 / 60), '12 min ago');
check('relative, under a minute', formatRelative(20 / 3600), 'just now');
check('relative, 59.7 min', formatRelative(59.7 / 60), '1h ago');
check('relative, hours', formatRelative(2.2), '2h ago');
check('relative, a day', formatRelative(30), 'yesterday');
check('relative, days', formatRelative(72), '3 days ago');

/* ------------------------------------------------------------------ */
section('hour splitting');

// A span wholly inside one hour is not split.
{
  const s = new Date(2026, 7, 31, 9, 10, 0).getTime();
  const e = new Date(2026, 7, 31, 9, 40, 0).getTime();
  check('within one hour -> 1 segment', splitIntoHours(s, e).length, 1);
}

// A span crossing boundaries is split at each one, and NO TIME IS LOST.
// Conservation is the property that matters: if splitting could drop or
// duplicate milliseconds, every total on the dashboard would be wrong by an
// amount that scales with how long the sessions are.
{
  const s = new Date(2026, 7, 31, 9, 40, 0).getTime();
  const e = new Date(2026, 7, 31, 13, 0, 0).getTime();
  const segs = splitIntoHours(s, e);
  check('9:40->13:00 segment count', segs.length, 4);
  check('total conserved', segs.reduce((a, x) => a + (x.end - x.start), 0), e - s);
  check('first segment ends on the hour', new Date(segs[0]!.end).getMinutes(), 0);
  check('segments are contiguous',
    segs.every((x, i) => i === 0 || x.start === segs[i - 1]!.end), true);
  check('each segment sits in one hour',
    segs.every((x) => new Date(x.start).getHours() === new Date(x.end - 1).getHours()), true);
}

// Crossing local midnight must land in two different local dates, or an
// evening's use is filed under the wrong day.
{
  const s = new Date(2026, 7, 31, 23, 30, 0).getTime();
  const e = new Date(2026, 8, 1, 0, 30, 0).getTime();
  const segs = splitIntoHours(s, e);
  check('midnight -> 2 segments', segs.length, 2);
  check('dates differ',
    new Date(segs[0]!.start).getDate() !== new Date(segs[1]!.start).getDate(), true);
}

// Degenerate input must terminate rather than spin.
check('zero-length span', splitIntoHours(1000, 1000).length, 0);
check('inverted span', splitIntoHours(2000, 1000).length, 0);

/* ------------------------------------------------------------------ */
section('ingest dedup');

const dir = mkdtempSync(join(tmpdir(), 'screentime-selftest-'));
const dbPath = join(dir, 'test.db');

try {
  const db = openDatabase(dbPath, { allowSystemDrive: true });

  const insert = db.prepare(
    `INSERT OR IGNORE INTO windows_segments
       (device_id, session_start_utc, start_utc, end_utc, duration_ms,
        local_date, local_hour, kind, app_path, unresolved, idle_ms_at_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  type Bind = string | number;
  const row: Bind[] = [
    'zephyrus', '2026-08-31T09:00:00.000Z', '2026-08-31T09:00:00.000Z',
    '2026-08-31T09:30:00.000Z', 1_800_000, '2026-08-31', 15, 'app',
    'C:\\app.exe', 0, 0,
  ];

  check('first insert', insert.run(...row).changes, 1);

  // A completed span is IMMUTABLE, so re-ingesting the same JSONL must be a
  // no-op. This is the opposite of the Android daily rollup, whose buckets
  // keep filling and need MAX(). Both mistakes are silent, in both directions.
  check('re-insert is ignored', insert.run(...row).changes, 0);

  // A different app in the same slot is a genuinely different row: the
  // uniqueness is per (session, segment, kind, app), not per timestamp.
  const other: Bind[] = [...row];
  other[8] = 'C:\\other.exe';
  check('different app is a new row', insert.run(...other).changes, 1);

  const count = db
    .prepare('SELECT COUNT(*) AS n FROM windows_segments')
    .get() as { n: number };
  check('two rows stored', count.n, 2);

  // The kinds must stay distinguishable: screen-on subtracts locked and gap,
  // but has to be able to report unknown separately.
  const kinds = ['app', 'locked', 'gap', 'unknown'];
  for (const k of kinds) {
    insert.run('zephyrus', `2026-08-31T10:00:00.000Z`, `2026-08-31T10:00:00.000Z`,
      '2026-08-31T10:10:00.000Z', 600_000, '2026-08-31', 16, k, '', 0, 0);
  }
  const distinct = db
    .prepare('SELECT COUNT(DISTINCT kind) AS n FROM windows_segments')
    .get() as { n: number };
  check('all four kinds stored distinctly', distinct.n, 4);

  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
section('android write rules');

// These are the tests that matter most in the whole file. The Android tables
// upsert on MAX() while the Windows table ignores duplicates, and BOTH
// mistakes are silent: INSERT OR IGNORE here would freeze a partial reading
// forever, and it would look exactly like a quiet day.
{
  const dir2 = mkdtempSync(join(tmpdir(), 'screentime-android-'));
  try {
    const db = openDatabase(join(dir2, 'a.db'), { allowSystemDrive: true });
    const device = {
      deviceId: 'test-device-1',
      label: 'Nothing A001',
      androidRelease: '16',
      sdkInt: 36,
    };
    // UTC+6, this phone's zone.
    const tz = 360;
    const base = Date.UTC(2026, 7, 31, 4, 0, 0); // 10:00 local

    // --- package labels replace the removed daily rollup ---
    //
    // android_daily was deleted after measuring it: 88 of 96 days reported
    // more than 24 HOURS of foreground time, because
    // queryAndAggregateUsageStats falls back to coarser buckets outside
    // retention and counts overlapping buckets in full inside it. The test
    // that matters now is that a label survives and can be corrected.
    ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      apps: [{ packageName: 'com.x', label: 'Ex', isSystem: false }],
    });
    ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      apps: [{ packageName: 'com.x', label: 'Example', isSystem: true }],
    });
    const lbl = db.prepare(
      'SELECT label, is_system AS sys FROM android_apps WHERE package_name = ?',
    ).get('com.x') as { label: string; sys: number };
    check('label is updated, not duplicated', lbl.label, 'Example');
    check('is_system follows the latest report', lbl.sys, 1);

    const rowCount = db.prepare(
      'SELECT COUNT(*) AS n FROM android_apps',
    ).get() as { n: number };
    check('one row per package', rowCount.n, 1);

    // The dropped table must be gone, so nothing can quietly start writing to
    // it again and reintroduce 478-hour days.
    const stale = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='android_daily'",
    ).get() as { n: number };
    check('android_daily no longer exists', stale.n, 0);

    // --- the in-flight session must be allowed to grow too ---
    ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      sessions: [{ start: base, end: base + 5 * MIN, packageName: 'com.y' }],
    });
    ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      sessions: [{ start: base, end: base + 20 * MIN, packageName: 'com.y' }],
    });
    const sess = db.prepare(
      'SELECT SUM(duration_ms) AS ms FROM android_segments WHERE package_name = ?',
    ).get('com.y') as { ms: number };
    check('in-flight session grows, not duplicates', sess.ms, 20 * MIN);

    // --- screen spans: same rule, and CLOSING sticks ---
    ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      screen: [{ start: base, end: base + 5 * MIN, kind: 'screen_on', inFlight: true }],
    });
    ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      screen: [{ start: base, end: base + 25 * MIN, kind: 'screen_on', inFlight: false }],
    });
    const scr = db.prepare(
      `SELECT SUM(duration_ms) AS ms, MAX(in_flight) AS f
         FROM android_screen WHERE kind = 'screen_on'`,
    ).get() as { ms: number; f: number };
    check('screen span grows', scr.ms, 25 * MIN);
    check('closed stays closed', scr.f, 0);

    // --- screen and app tables must stay SEPARATE ---
    // They overlap in time -- an app session happens DURING screen-on -- so
    // one table would make a naive SUM count the same minutes twice.
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN
         ('android_segments','android_screen')`,
    ).all() as { name: string }[];
    check('app and screen are different tables', tables.length, 2);

    // --- device identity ---
    const dev = db.prepare('SELECT slug, label FROM android_devices').get() as
      { slug: string; label: string };
    check('slug derives from label', dev.slug, 'nothing-a001');

    // A later sync that carries only spans must NOT erase device metadata.
    // Found by re-pushing a minimal body: android_release went "16" -> "".
    ingestAndroid(db, {
      device: { deviceId: 'test-device-1', label: 'Nothing A001' },
      tzOffsetMinutes: tz,
      screen: [{ start: base, end: base + MIN, kind: 'screen_on' }],
    });
    const kept = db.prepare(
      'SELECT android_release AS r, sdk_int AS s FROM android_devices',
    ).get() as { r: string; s: number };
    check('minimal payload keeps android_release', kept.r, '16');
    check('minimal payload keeps sdk_int', kept.s, 36);

    // --- bad input is rejected, not stored ---
    const bad = ingestAndroid(db, {
      device, tzOffsetMinutes: tz,
      sessions: [
        { start: base, end: base, packageName: 'com.z' },            // zero length
        { start: base + 1000, end: base, packageName: 'com.z' },     // inverted
        { start: base, end: base + 48 * HOUR, packageName: 'com.z' },// clock jump
      ],
    });
    check('three bad spans rejected', bad.rejected, 3);

    db.close();
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
section('phone-local time');

// The phone's offset, never the server's. Same machine today; not the first
// time the phone travels, and a day boundary computed in the wrong zone files
// an evening under the wrong date.
{
  // Half-hour zone (India, +330). Boundaries must land on real clock hours,
  // which stepping by 3,600,000 from the span start would not do.
  const tz = 330;
  const start = Date.UTC(2026, 7, 31, 4, 10, 0);  // 09:40 local
  const end = Date.UTC(2026, 7, 31, 7, 0, 0);     // 12:30 local
  const segs = splitIntoLocalHours(start, end, tz);
  check('half-hour zone conserves total',
    segs.reduce((a, s) => a + (s.end - s.start), 0), end - start);
  const edgesOnClockHour = segs
    .slice(1)
    .every((s) => ((s.start + tz * 60_000) % HOUR) === 0);
  check('splits land on local clock hours', edgesOnClockHour, true);
}

check('slugify strips punctuation', slugify('Nothing A001'), 'nothing-a001');
check('slugify handles junk', slugify('!!!'), 'device');

/* ------------------------------------------------------------------ */
section('visit stitching');

// ACTIVITY_RESUMED fires per Activity on Android, and the Windows sampler ends
// a span on every focus change, so raw session counts describe the platform
// rather than the person. Measured before this existed: Instagram showed 158
// sessions with a 2.6s median, 56% of them under five seconds.
{
  const t = (min: number) => Date.UTC(2026, 7, 31, 9, min, 0);

  // Two chunks of one app, 10s apart, nothing in between -> ONE visit.
  const stitched = stitchVisits([
    { app: 'a', start: t(0), end: t(5) },
    { app: 'a', start: t(5) + 10_000, end: t(9) },
  ]);
  check('adjacent chunks merge', stitched.length, 1);
  check('parts are counted', stitched[0]!.parts, 2);
  // Rule 2: duration is SUMMED, never spanned. The two chunks are 5min and
  // 3min50s, so the visit is 8min50s -- NOT the 9min it spans. Spanning would
  // invent the 10-second gap as usage.
  check('duration is summed', stitched[0]!.ms, 5 * MIN + (4 * MIN - 10_000));
  check('duration is NOT spanned', stitched[0]!.ms !== stitched[0]!.end - stitched[0]!.start, true);

  // A long gap splits them even with nothing in between.
  check('a long gap splits', stitchVisits([
    { app: 'a', start: t(0), end: t(5) },
    { app: 'a', start: t(40), end: t(45) },
  ]).length, 2);

  // ⚠️ Rule 1: another app in between means two visits, however short the gap.
  const interleaved = stitchVisits([
    { app: 'a', start: t(0), end: t(5) },
    { app: 'b', start: t(5), end: t(5) + 2000 },
    { app: 'a', start: t(5) + 3000, end: t(9) },
  ]);
  check('another app in between splits the visit',
    interleaved.filter((v) => v.app === 'a').length, 2);

  // Unsorted input must not change the answer; callers assemble from grouped SQL.
  const unsorted = stitchVisits([
    { app: 'a', start: t(5) + 10_000, end: t(9) },
    { app: 'a', start: t(0), end: t(5) },
  ]);
  check('input order does not matter', unsorted.length, 1);

  const stats = visitStats(stitchVisits([
    { app: 'a', start: t(0), end: t(2) },
    { app: 'a', start: t(30), end: t(40) },
    { app: 'a', start: t(60), end: t(64) },
  ]), 'a');
  check('visit count', stats.visits, 3);
  check('median visit', stats.medianMs, 4 * MIN);
  check('longest visit', stats.longestMs, 10 * MIN);

  const counts = visitCounts(stitchVisits([
    { app: 'a', start: t(0), end: t(1) },
    { app: 'b', start: t(10), end: t(11) },
    { app: 'a', start: t(20), end: t(21) },
  ]));
  check('per-app visit counts', [counts.get('a'), counts.get('b')], [2, 1]);

  check('empty input', stitchVisits([]).length, 0);
}

/* ------------------------------------------------------------------ */
section('opens per day and hour');

// Both detail pages draw two charts off this: opens per day, and the hour an
// open began. It is the arithmetic that is wrong QUIETLY -- a chart of the
// wrong buckets still looks like a chart -- so every rule gets a case.
{
  const at = (day: number, hour: number, min = 0) => Date.UTC(2026, 7, day, hour, min, 0);

  // Three visits: two on the 31st (09:00, 14:00) and one just before midnight
  // that runs into the 1st.
  const sessions = [
    { app: 'a', start: at(31, 9), end: at(31, 9, 30) },
    { app: 'b', start: at(31, 10), end: at(31, 10, 5) },
    { app: 'a', start: at(31, 14), end: at(31, 14, 20) },
    { app: 'a', start: at(31, 23, 50), end: at(32, 0, 30) },
  ];
  // What ingest stored for each of those session starts. Read back, never
  // recomputed -- the phone's offset is not this machine's.
  const bucket = new Map([
    [at(31, 9), { date: '2026-08-31', hour: 9 }],
    [at(31, 10), { date: '2026-08-31', hour: 10 }],
    [at(31, 14), { date: '2026-08-31', hour: 14 }],
    [at(31, 23, 50), { date: '2026-08-31', hour: 23 }],
  ]);

  const visits = stitchVisits(sessions);
  const opens = openBuckets(visits, 'a', bucket);

  check('opens land on the starting day', opens.byDate.get('2026-08-31'), 3);
  // ⚠️ THE MIDNIGHT RULE. The 23:50 visit ran 40 minutes into the next day and
  // its TIME is split there, but the open happened once, last night. A second
  // open on the 1st would be an opening that never occurred.
  check('a visit across midnight opens once', opens.byDate.get('2026-09-01'), undefined);
  check('...and it opens on the night it began', opens.byHour.get(23), 1);
  // A long visit is one open in the hour it started, not a smear across the
  // hours it covered -- the opposite of how the time chart buckets it.
  check('an open is an instant, not a span', opens.byHour.get(10), undefined);
  check('another app is not counted', openBuckets(visits, 'b', bucket).byDate.get('2026-08-31'), 1);

  // Every open must land somewhere: the two charts and the "Opens" stat above
  // them are three views of one number, and a silent drop would show as a
  // header that disagrees with the bars underneath it.
  const total = [...opens.byDate.values()].reduce((a, b) => a + b, 0);
  check('byDate sums to the visit count', total, visitStats(visits, 'a').visits);
  check('byHour sums to the same', [...opens.byHour.values()].reduce((a, b) => a + b, 0), total);

  // A visit whose start is not in the map began BEFORE the range: its first
  // row is outside the query, so the open belongs to a day off the chart.
  // Dropped, never filed under the first row we happen to see.
  const clipped = openBuckets(visits, 'a', new Map([[at(31, 9), { date: '2026-08-31', hour: 9 }]]));
  check('a visit starting before the range is dropped', clipped.byDate.get('2026-08-31'), 1);
}

/* ------------------------------------------------------------------ */
section('sampler heartbeat');

// The heartbeat is how the dashboard answers "is the sampler alive". It is
// written by PowerShell, so it is exactly the kind of file that shows up with
// a BOM one day and silently stops parsing.
{
  const hbDir = mkdtempSync(join(tmpdir(), 'screentime-hb-'));
  try {
    const write = (o: unknown, bom = false) =>
      writeFileSync(
        join(hbDir, 'sampler-status.json'),
        (bom ? '﻿' : '') + JSON.stringify(o),
        'utf8',
      );

    check('missing file is not alive', getSamplerStatus(hbDir).alive, false);

    const fresh = {
      updated: new Date().toISOString(),
      interval_seconds: 2,
      in_flight: { start: '', kind: 'app', app: 'C:\\Tools\\Code.exe', ms: 90_000 },
    };
    write(fresh);
    const ok = getSamplerStatus(hbDir);
    check('fresh heartbeat is alive', ok.alive, true);
    check('in-flight is surfaced', ok.inFlight?.ms, 90_000);

    // PowerShell 5.1 writes a BOM from several APIs and JSON.parse throws on
    // it. The sibling project lost a whole subsystem to exactly this, where it
    // failed silently and looked like no data had been recorded.
    write(fresh, true);
    check('BOM-prefixed heartbeat still parses', getSamplerStatus(hbDir).alive, true);

    // A stale heartbeat means the sampler died. Reporting it as alive would
    // hide the one failure that loses data permanently -- nothing backfills.
    write({ updated: new Date(Date.now() - 10 * 60_000).toISOString(), interval_seconds: 2 });
    check('stale heartbeat is not alive', getSamplerStatus(hbDir).alive, false);

    write({ nonsense: true });
    check('malformed heartbeat is not alive', getSamplerStatus(hbDir).alive, false);
  } finally {
    rmSync(hbDir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
section('system-drive guard');

// The one rule the whole project exists to enforce. It must throw, and it must
// throw for the collector's real config path shape, not just any C:\ string.
{
  let threw = false;
  try {
    openDatabase('C:\\Users\\somebody\\screen-time.db');
  } catch {
    threw = true;
  }
  check('refuses a database on C:\\', threw, true);
}

/* ------------------------------------------------------------------ */
section('app logo matching');

// The key drops everything that is not a letter or a digit, so a logo file can
// be named the way a person writes the app's name.
check('spaces', logoKey('Keep Notes'), 'keepnotes');
check('mixed case', logoKey('iPlayer'), 'iplayer');
check('punctuation', logoKey('Acme e-Reader'), 'acmeereader');
check('single letter', logoKey('X'), 'x');
check('trims to nothing safely', logoKey('!!'), '');

// The matching RULES, against fixtures rather than against whichever real
// artwork happens to exist.
//
// These used to run against the shared root -- `logoUrl('Telegram')` with no
// device. Every logo now lives in a device folder, so that call correctly
// returns null, and pinning the rules to a real file would additionally mean
// the tests break when a phone stops reporting an app rather than when the
// matching changes. The fixture says what is being tested.
{
  const fixtures = join(logoDir(), '__selftest-match');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  try {
    mkdirSync(fixtures, { recursive: true });
    for (const f of ['Telegram.svg', 'Keep Notes.svg', 'Chrome.svg', 'Google Play Store.svg']) {
      writeFileSync(join(fixtures, f), svg);
    }
    const dev = '__selftest-match';
    const url = (k: string) => `/api/app-logo/selftestmatch/${k}`;

    check('exact match wins', logoUrl('Telegram', dev), url('telegram'));
    check('case-insensitive', logoUrl('tELEGRAM', dev), url('telegram'));
    check('space-insensitive', logoUrl('Keep Notes', dev), url('keepnotes'));

    // The vendor-prefix fallback: Windows says "Google Chrome", the file is
    // Chrome.svg. It must only apply AFTER an exact miss.
    check('vendor prefix dropped', logoUrl('Google Chrome', dev), url('chrome'));
    check('exact beats the prefix rule', logoUrl('Google Play Store', dev), url('googleplaystore'));

    // A miss must be null, never a URL that would 404 -- the caller draws an
    // initial instead, and a broken image would read as a bug.
    check('unknown app -> null', logoUrl('Definitely Not An App 12345', dev), null);

    // A device that has no folder gets nothing, now that there is no shared
    // root to fall back to. This is the layout's one real cost, and it should
    // fail loudly here rather than quietly on a page.
    check('another device sees none of them', logoUrl('Telegram', 'some-other-device'), null);
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
  }
}

// Measured, not guessed: X was one <path> with no fill, which SVG defaults to
// black, and black on this page is invisible. The entry is keyed bare and the
// file now lives in device folders, so this also covers that fallback -- see
// needsLightPlate.
check('X needs a plate, wherever its copy lives',
  needsLightPlate('X', 'nothing-a001') || needsLightPlate('X', 'Zephyrus G16'), true);
check('a bare-keyed plate still applies to a scoped copy',
  needsLightPlate('X', 'nothing-a001'), needsLightPlate('X'));
check('Telegram does not', needsLightPlate('Telegram', 'nothing-a001'), false);

/* ------------------------------------------------------------------ */
section('windows app names');

// Every expectation below is a path this machine actually recorded, and every
// display name was read off Windows itself (`Get-StartApps`, the package
// manifest, or the exe's FileDescription) rather than guessed from the folder.
const APPX = 'C:\\\\Program Files\\\\WindowsApps\\\\';

// Rule 5: the package family carries a publisher namespace, and the exe inside
// is often named something else again. Both halves were visible on the By App
// page as "B9 ECED6 F.Armoury Crate" and "Open AI.Codex".
check(
  'publisher namespace dropped',
  resolveApp(`${APPX}B9ECED6F.ArmouryCrate_6.5.7.0_x64__qmba6cd70vzyy\\\\ArmouryCrate.exe`).name,
  'Armoury Crate',
);
check(
  'exe name beats the package family',
  resolveApp(`${APPX}OpenAI.Codex_26.825.6671.0_x64__2p2nqsd0c76g0\\\\app\\\\ChatGPT.exe`).name,
  'ChatGPT',
);
// ...and the version-proof key survives, so an update does not split the app.
check(
  'packaged key survives the version bump',
  resolveApp(`${APPX}Claude_1.40609.0.0_x64__pzs8sxrjxfjjc\\\\app\\\\Claude.exe`).key,
  resolveApp(`${APPX}Claude_1.40609.1.0_x64__pzs8sxrjxfjjc\\\\app\\\\claude.exe`).key,
);

// The word splitter has to break words WITHOUT breaking acronyms. The naive
// split turned HWiNFO64 into "HWi NFO64", which reads as corrupted data rather
// than as a program.
check('camel case is split', resolveApp('C:\\\\bin\\\\InternetSpeedMeter.exe').name, 'Internet Speed Meter');
check('an acronym is not', resolveApp('HWiNFO64').name, 'HWiNFO64');
check('nor is ChatGPT', resolveApp('C:\\\\x\\\\ChatGPT.exe').name, 'ChatGPT');

// Splitting must not move the logo. That is the whole reason spaces are the
// only edit rule 4 allows.
check('the split keeps the logo key', logoKey('Internet Speed Meter'), logoKey('InternetSpeedMeter'));

// Rule 3, mechanically: two exes that are one app share a KEY, not just a name.
check(
  '7-Zip is one app',
  resolveApp('C:\\\\Program Files\\\\7-Zip\\\\7zG.exe').key,
  resolveApp('C:\\\\Program Files\\\\7-Zip\\\\7zFM.exe').key,
);

// Different programs, one word. Sharing the name would share the logo and the
// brand colour with the phone's apps of the same name.
check('windows camera is named apart', resolveApp('C:\\\\x\\\\WindowsCamera.exe').name, 'Windows Camera');
check('windows photos is named apart', resolveApp('C:\\\\x\\\\Photos.exe').name, 'Windows Photos');
// ...while the SAME app on both devices must not be split apart that way.
check('telegram is shared', resolveApp('C:\\\\x\\\\Telegram.exe').name, 'Telegram');

// A random name unpacked into TEMP is the one thing no map can cover. Keep the
// string -- it is the only handle on it -- and say what kind of thing it was.
check(
  'temp installer',
  resolveApp('C:\\\\Temp\\\\is-60IT7.tmp\\\\hwi64_852.tmp').name,
  'Installer (hwi64_852.tmp)',
);

// Rule 3 over the WHOLE map, not just the cases above: a display name shared
// by two keys is silent, and hands both rows one logo and one colour. Checked
// mechanically because the map is where a duplicate would be introduced.
{
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const [base, entry] of Object.entries(knownApps())) {
    const key = entry.key ?? `exe:${base}`;
    const prev = seen.get(entry.name);
    if (prev && prev !== key) collisions.push(`${entry.name} (${prev} / ${key})`);
    seen.set(entry.name, key);
  }
  check('no two keys share a display name', collisions, []);
}

// Merges, each one a set of rows that were one habit split by which exe drew
// it. The paths are the ones this machine recorded.
{
  const shell = resolveApp('C:\\\\Windows\\\\SystemApps\\\\ShellExperienceHost_cw5n1h2txyewy\\\\ShellExperienceHost.exe');
  check('shell flyouts are one app: ShellHost', resolveApp('C:\\\\Windows\\\\System32\\\\ShellHost.exe').key, shell.key);
  check('shell flyouts are one app: sihost', resolveApp('C:\\\\WINDOWS\\\\system32\\\\sihost.exe').key, shell.key);
  check('the merged shell is named once', resolveApp('C:\\\\Windows\\\\System32\\\\ShellHost.exe').name, 'Windows Shell');
  // Start and Search are surfaces a person names, and stay their own rows.
  check('start menu stays apart', resolveApp('C:\\\\x\\\\StartMenuExperienceHost.exe').key === shell.key, false);

  const cpl = resolveApp(`${APPX}nvidiacorp.nvidiacontrolpanel_8.1.969.0_x64__56jybvy8sckqj\\\\nvcplui.exe`);
  check('nvidia control panel is named', cpl.name, 'NVIDIA Control Panel');
  // The container is recorded as a BARE name -- Windows refuses its path --
  // so it has no package folder to inherit a key from.
  check('its container folds into it', resolveApp('NVDisplay.Container').key, cpl.key);
  // ...and a version bump of the panel still lands on the same row.
  check(
    'the panel key survives the version bump',
    resolveApp(`${APPX}nvidiacorp.nvidiacontrolpanel_8.1.970.0_x64__56jybvy8sckqj\\\\nvcplui.exe`).key,
    cpl.key,
  );
  // A different program with the same vendor, and not merged.
  check(
    'the NVIDIA App stays apart',
    resolveApp('C:\\\\Program Files\\\\NVIDIA Corporation\\\\NVIDIA App\\\\CEF\\\\NVIDIA App.exe').key === cpl.key,
    false,
  );
}

/* ------------------------------------------------------------------ */
section('by-app list cut-off');

{
  const MIN = 60_000;
  // Time alone lists an app: 38 minutes in one sitting on one day is real use.
  check('time alone lists', isListed({ ms: 38 * MIN, opens: 2, days: 1 }), true);
  check('just under the time bar', isListed({ ms: LIST_MIN_MS - 1, opens: 0, days: 0 }), false);
  // A daily habit of seconds is listed too...
  check('a habit lists', isListed({ ms: 2 * MIN, opens: LIST_MIN_OPENS, days: LIST_MIN_DAYS }), true);
  // ...but not one afternoon of alt-tabbing through a dialog.
  check('opens on one day do not', isListed({ ms: 2 * MIN, opens: 200, days: 1 }), false);
  check('days without opens do not', isListed({ ms: 2 * MIN, opens: 7, days: 20 }), false);

  const apps = [
    { k: 'a', ms: 60 * MIN, opens: 1, days: 1 },
    { k: 'b', ms: MIN, opens: 1, days: 1 },
    { k: 'c', ms: 20 * MIN, opens: 1, days: 1 },
  ];
  const split = splitForList(apps);
  check('shown keeps rank order', split.shown.map((a) => a.k), ['a', 'c']);
  check('rest keeps rank order', split.rest.map((a) => a.k), ['b']);
  // Nothing clears the bar: show everything rather than an empty table over a
  // button.
  const quiet = splitForList([{ ms: MIN, opens: 1, days: 1 }, { ms: 2 * MIN, opens: 1, days: 1 }]);
  check('nothing listed shows everything', [quiet.shown.length, quiet.rest.length], [2, 0]);
  check('the rule names its own numbers', listRule().includes(`${LIST_MIN_MS / MIN} min`), true);
}

/* ------------------------------------------------------------------ */
section('trend line');

{
  // A missing day is NULL, so the line breaks there instead of drawing a slope
  // across days nothing was recorded.
  const filled = fillDays([
    { date: '2026-08-30', ms: 5 },
    { date: '2026-09-02', ms: 9 },
  ]);
  check('fills every day between', filled.map((p) => p.date),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  check('a missing day is null, not zero', filled.map((p) => p.ms), [5, null, null, 9]);
  // Across a month end with 31 days, and in input order that is not sorted.
  check('unsorted input still runs forward', fillDays([
    { date: '2026-11-01', ms: 1 }, { date: '2026-10-31', ms: 2 },
  ]).map((p) => p.date), ['2026-10-31', '2026-11-01']);
  check('no points, no days', fillDays([]), []);

  check('heaviest day', heaviestDay(filled), { date: '2026-09-02', ms: 9 });
  // A recorded zero is not a heaviest day.
  check('an empty range has no heaviest day', heaviestDay([{ date: '2026-09-01', ms: 0 }, { date: '2026-09-02', ms: null }]), null);
}

/* ------------------------------------------------------------------ */
section('activity heat map');

{
  const today = new Date(Date.UTC(2026, 8, 23)); // Wed 23 Sep 2026
  const block = recentBlock([
    { date: '2026-09-23', ms: 100 },
    { date: '2026-09-22', ms: 0 },
    { date: '2025-01-01', ms: 999 }, // outside the block
  ], today);

  check('26 columns of 7 days', block.cells.length, WEEKS * 7);
  // Saturday-first: the last column is the current week, and today (a
  // Wednesday) sits in row 4 of it.
  const t = block.cells.find((c) => c.date === '2026-09-23')!;
  check('today is in the last column', t.column, WEEKS - 1);
  check('Wednesday is row 4', [t.row, DAY_LABELS[t.row]], [4, 'Wed']);
  check('tomorrow is hidden, not empty', block.cells.find((c) => c.date === '2026-09-24')!.hidden, true);
  // A recorded zero is KNOWN; a day with no row is not. The first draws the
  // quiet shade, the second an outline.
  check('a recorded zero is known', block.cells.find((c) => c.date === '2026-09-22')!.known, true);
  check('an unrecorded day is not', block.cells.find((c) => c.date === '2026-09-21')!.known, false);
  check('only the block counts toward its total', [block.total, block.peak, block.activeDays], [100, 100, 1]);

  // Even steps, not the sibling's torrent-skewed ones: half the busiest day is
  // a middle shade, not the second-brightest.
  check('zero is the quiet step', heatmapColor(0, 100), HEATMAP_RAMP[0]);
  check('half is the middle step', heatmapColor(50, 100), HEATMAP_RAMP[3]);
  check('the busiest day is the top step', heatmapColor(100, 100), HEATMAP_RAMP[5]);
  check('a fifth is the first lit step', heatmapColor(20, 100), HEATMAP_RAMP[1]);

  // The expanded page starts on the 1st of the month the data begins in -- not
  // on a fixed January that would open on months of outlined days.
  const blocks = expandedBlocks([{ date: '2026-08-31', ms: 1 }], '2026-08-31', today);
  check('expanded starts at the data month', blocks[0]!.first, '2026-08-01');
  check('one block while history is short', blocks.length, 1);
  // 1 October 2026 is a Thursday, so its week column opens on Saturday 26
  // September -- and those five September days are hidden, not outlined.
  const oct = expandedBlocks([], '2026-10-15', new Date(Date.UTC(2026, 10, 10)))[0]!;
  check('the column opens on the Saturday before', oct.cells[0]!.date, '2026-09-26');
  check('days before the 1st are hidden', oct.cells.find((c) => c.date === '2026-09-30')!.hidden, true);
  check('the 1st itself is drawn', oct.cells.find((c) => c.date === '2026-10-01')!.hidden, false);
  check('a clipped block is labelled from the 1st', oct.first, '2026-10-01');
  check('the block is labelled across the year', blockLabel(blocks[0]!), 'Aug 1, 2026 – Jan 29, 2027');
}

/* ------------------------------------------------------------------ */
section('chart axis');

// THE BUG THIS EXISTS FOR. Left to itself Recharts picks a nice ceiling from a
// fixed tick count and overshoots: the phone's top app peaked at 11h 5m and
// the axis ran to 17h, so every bar looked shorter than it was.
{
  const peak = 11 * HOUR + 5 * MIN;
  const { domain, ticks } = niceHourAxis(peak);
  check('11h05m axis ends at 12h', domain[1], 12 * HOUR);
  check('11h05m never reaches 17h', domain[1] < 17 * HOUR, true);
  check('11h05m ticks every 2h', ticks.length, 7);
}

// The ceiling must always be at or above the data, and within one step of it,
// across a wide spread of peaks. This is the property that actually matters.
for (const peak of [
  30_000, 45 * MIN, 59 * MIN, HOUR, 3 * HOUR + 7 * MIN,
  11 * HOUR + 5 * MIN, 23 * HOUR, 47 * HOUR, 400 * HOUR,
]) {
  const { domain, ticks } = niceHourAxis(peak);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : domain[1];
  check(`${peak}ms: ceiling covers the peak`, domain[1] >= peak, true);
  check(`${peak}ms: ceiling is within one step`, domain[1] - peak < step, true);
  check(`${peak}ms: at most 7 labels`, ticks.length <= 7, true);
  check(`${peak}ms: last tick IS the ceiling`, ticks[ticks.length - 1], domain[1]);
}

// A zero-height chart must not produce a degenerate axis.
check('no data still gives an axis', niceHourAxis(0).domain[1] > 0, true);

// The label has to be exact, because a 30-minute step is allowed. The old
// formatter rounded, so 1.5h printed as "2h" one tick below the real 2h.
check('exact on the hour', hourTick(2 * HOUR), '2h');
check('half hours do not round', hourTick(90 * MIN), '1h30');
check('under an hour is minutes', hourTick(45 * MIN), '45m');
check('zero is bare', hourTick(0), '0');

// The count axis, for opens and unlocks. Same property as the time axis --
// covers the peak, within one step of it -- plus one the time axis does not
// need: every tick must be a WHOLE number. Half an unlock is not a thing, and
// an axis offering one says the chart is measuring something it is not.
for (const peak of [1, 3, 7, 12, 30, 47, 130, 222, 999, 4321]) {
  const { domain, ticks } = niceCountAxis(peak);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : domain[1];
  check(`${peak} opens: ceiling covers the peak`, domain[1] >= peak, true);
  check(`${peak} opens: ceiling is within one step`, domain[1] - peak < step, true);
  check(`${peak} opens: at most 7 labels`, ticks.length <= 7, true);
  check(`${peak} opens: every tick is whole`, ticks.every(Number.isInteger), true);
  check(`${peak} opens: last tick IS the ceiling`, ticks[ticks.length - 1], domain[1]);
}

// A single open must not collapse the axis to zero height.
check('one open still has a ceiling', niceCountAxis(1).domain[1], 1);
check('no opens still gives an axis', niceCountAxis(0).domain[1] > 0, true);

/* ------------------------------------------------------------------ */
section('home surface');

// The launcher is excluded from the Most opened ranking, so a rule that
// matched the wrong package would quietly drop a real app from a chart. The
// card names what it dropped for that reason; these hold the rule itself.
check('this phone', isHomeSurface('com.nothing.launcher'), true);
check('AOSP', isHomeSurface('com.android.launcher3'), true);
check('Samsung', isHomeSurface('com.sec.android.app.launcher'), true);
check('Pixel', isHomeSurface('com.google.android.apps.nexuslauncher'), true);
check('Nova', isHomeSurface('com.teslacoilsw.launcher'), true);
// Xiaomi's does not say "launcher" anywhere, which is why the list exists.
check('Xiaomi', isHomeSurface('com.miui.home'), true);

// Ordinary apps must survive. The mid-name match is the one to guard: a rule
// testing `includes('launcher')` would drop the third of these.
check('not Instagram', isHomeSurface('com.instagram.android'), false);
check('not YouTube', isHomeSurface('com.google.android.youtube'), false);
check('not a launcher-ish middle', isHomeSurface('com.launcher.example.reader'), false);
check('not a settings home', isHomeSurface('com.android.settings'), false);

/* ------------------------------------------------------------------ */
section('brand colours');

// The RULES, against a fixture map. The real map is config/app-colours.json,
// which is local-only like the logos it describes, so a fresh clone has none.
const FIXTURE_COLOURS = parseBrandColours({
  colours: {
    youtube: '#FF0033',
    keepnotes: { hex: '#ffba00', note: 'the object form keeps a reason' },
    brave: '#ff2000',
    'devicex/brave': '#22cc22',
    broken: 'not-a-colour',
    alsobroken: { note: 'no hex at all' },
  },
});
check('string form, lower-cased', brandColourForIdentity('youtube', FIXTURE_COLOURS), '#ff0033');
check('object form', brandColourForIdentity('keepnotes', FIXTURE_COLOURS), '#ffba00');
check('a malformed hex is dropped', 'broken' in FIXTURE_COLOURS, false);
check('an entry with no hex is dropped', 'alsobroken' in FIXTURE_COLOURS, false);
check('unknown identity -> null', brandColourForIdentity('someappwithnologo', FIXTURE_COLOURS), null);
check('a scoped entry wins', brandColourForIdentity('devicex/brave', FIXTURE_COLOURS), '#22cc22');
check('a scoped identity falls back to the bare entry',
  brandColourForIdentity('otherdevice/brave', FIXTURE_COLOURS), '#ff2000');
check('no file shape at all is an empty map', Object.keys(parseBrandColours(null)).length, 0);
check('an app with no logo and no colour -> null', brandColour('Some App With No Logo 12345'), null);

// A dark brand colour on a #000 page is the same failure as the black logo
// that needed a plate: it renders correctly and reads as missing.
check('already light is untouched', ensureReadable('#ff0033'), '#ff0033');
check('near-black is lifted', ensureReadable('#000080') !== '#000080', true);
{
  const lifted = ensureReadable('#000080');
  const r = parseInt(lifted.slice(1, 3), 16);
  const g = parseInt(lifted.slice(3, 5), 16);
  const b = parseInt(lifted.slice(5, 7), 16);
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
  check('lifted past the floor', l >= 0.399, true);
  check('lift keeps blue dominant', b > r && b > g, true);
}

// EVERY logo gets a colour, because the two ranked-app charts colour their
// bars by brand and a logo without one falls back to the device accent -- so
// the gap does not look like a gap, it looks like an app that chose violet.
// This is the check that catches a logo dropped into the folder and a colour
// forgotten; the fallback is deliberate only where this list says it is.
{
  const DELIBERATELY_UNCOLOURED = new Set([
    // Its icon IS this dashboard's accent, so committing the hex here would
    // put an accent colour outside `accent.ts`. The null fallback draws the
    // same violet on the laptop and the right green on the phone.
    'screentimereporter',
  ]);

  // allLogoFiles(), not readdirSync: the folder is no longer flat, and a scan
  // of the root alone would report full coverage while every device-scoped
  // logo went uncoloured -- which does not look like a gap, it looks like an
  // app that chose violet.
  const logos = allLogoFiles();

  const uncoloured = logos.filter(
    (l) => !brandColourForIdentity(l.identity) && !DELIBERATELY_UNCOLOURED.has(l.key),
  ).map((l) => l.identity);
  check(`every logo has a brand colour (${logos.length} logos)`, uncoloured.join(', '), '');

  // What the chart draws is `brandColour()`, not the raw map value, so the
  // floor has to be checked on the way out.
  const tooDark = logos.map((l) => l.identity).filter((n) => {
    const hex = brandColourForIdentity(n);
    if (!hex) return false;
    const v = parseInt(hex.slice(1), 16);
    const [r2, g2, b2] = [v >> 16, (v >> 8) & 255, v & 255];
    return (Math.max(r2, g2, b2) + Math.min(r2, g2, b2)) / 2 / 255 < 0.399;
  });
  check('no drawn colour is below the floor', tooDark.join(', '), '');

  // Same rule over the real folder: a manifest entry that cannot be opened
  // is a logo that silently 404s in the browser.
  const unreadable = logos.filter((l) => {
    try { readFileSync(join(logoDir(), l.relPath)); return false; } catch { return true; }
  }).map((l) => l.relPath);
  check('every logo on disk opens from its manifest path', unreadable.join(', '), '');
}

/* ------------------------------------------------------------------ */
section('backup contention');

/*
  A lost race for the backup file is NOT a failed backup, and telling them
  apart is this predicate's whole job.

  MEASURED 2026-09-04 with concurrent backups against one destination, in one
  process and across four: the loser reports errcode 261 ("database is
  locked") or -- the one that actually reached sync_log -- errcode 0, which
  node:sqlite renders as "not an error" because SQLite set no code at all.

  The dangerous direction is permissive: classify a real, recurring failure as
  contention and it becomes four silent retries and a 'busy'.
*/
check('errcode 0 is contention', isBackupContention({ errcode: 0 }), true);
check('SQLITE_BUSY is contention', isBackupContention({ errcode: 5 }), true);
check('extended SQLITE_BUSY is contention', isBackupContention({ errcode: 261 }), true);
check('SQLITE_LOCKED is contention', isBackupContention({ errcode: 6 }), true);
check('SQLITE_ERROR is a real failure', isBackupContention({ errcode: 1 }), false);
check('SQLITE_CANTOPEN is a real failure', isBackupContention({ errcode: 14 }), false);
check('SQLITE_FULL is a real failure', isBackupContention({ errcode: 13 }), false);
check('a plain Error is a real failure', isBackupContention(new Error('disk full')), false);
check('null is a real failure', isBackupContention(null), false);

{
  /*
    Two syncs 20ms apart -- a phone retrying a push -- raced inside one process
    on 2026-09-04 and wrote `failed: not an error` into sync_log. Serialised,
    every caller gets its own backup and none of them reports a failure.
  */
  const bdir = mkdtempSync(join(tmpdir(), 'screentime-backup-'));
  try {
    const db = openDatabase(join(bdir, 'source.db'), { allowSystemDrive: true });
    const dest = join(bdir, 'backup.db');

    db.prepare(
      `INSERT OR IGNORE INTO windows_segments
         (device_id, session_start_utc, start_utc, end_utc, duration_ms,
          local_date, local_hour, kind, app_path, unresolved, idle_ms_at_end)
       VALUES ('t', 's', 'a', 'b', 1000, '2026-09-04', 3, 'app', 'x.exe', 0, 0)`,
    ).run();

    const statuses = await Promise.all([
      backupDatabase(db, dest),
      backupDatabase(db, dest),
      backupDatabase(db, dest),
    ]);
    check('concurrent backups do not collide', statuses.join('|'), 'ok|ok|ok');

    const restored = openDatabase(dest, { allowSystemDrive: true });
    check(
      'the backup is intact',
      (restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
        .integrity_check,
      'ok',
    );
    check(
      'the backup holds the row',
      (restored.prepare('SELECT COUNT(*) n FROM windows_segments').get() as { n: number }).n,
      1,
    );
    restored.close();
    db.close();

    // A destination that is a DIRECTORY: a genuine SQLITE_CANTOPEN, which must
    // not be mistaken for contention and retried into a 'busy'.
    const other = openDatabase(join(bdir, 'other.db'), { allowSystemDrive: true });
    const bad = await backupDatabase(other, bdir);
    other.close();
    check('a real failure still says failed', bad.startsWith('failed:'), true);
    check('a real failure is not retried into busy', bad.startsWith('busy:'), false);
  } finally {
    rmSync(bdir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
section('device-scoped logos');

check('scope key normalises like a file name', deviceScopeKeys('Nothing A001')[0], 'nothinga001');
check('a slug and a label agree', deviceScopeKeys('nothing-a001')[0], 'nothinga001');
check('several names, in order', deviceScopeKeys(['Zephyrus G16', 'zephyrus']).join(','), 'zephyrusg16,zephyrus');
check('duplicates collapse', deviceScopeKeys(['Nothing A001', 'nothing-a001']).length, 1);
check('no device is no scope', deviceScopeKeys(undefined).length, 0);

{
  /*
    A real folder, created and removed inside this test.

    It is doing two jobs. The obvious one is that a device folder wins over the
    root and falls back to it. The one worth the file I/O is that the manifest
    NOTICES: adding a file inside a subfolder does not move the root's mtime, so
    a manifest stamped on the root alone would serve a stale map until the
    server restarted -- reintroducing, inside the new feature, the exact bug the
    serving route exists to avoid.
  */
  const scopeDir = join(logoDir(), '__selftest-device');
  const before = logoUrl('Selftest Shared');

  try {
    // Two files: one that also exists at the root, one that does not.
    writeFileSync(join(logoDir(), 'Selftest Shared.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, 'Selftest Shared.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(scopeDir, 'Selftest Only.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    check('root file resolves with no device',
      logoUrl('Selftest Shared'), '/api/app-logo/selftestshared');
    check('the device folder wins',
      logoUrl('Selftest Shared', '__selftest-device'), '/api/app-logo/selftestdevice/selftestshared');
    check('a device-only file resolves',
      logoUrl('Selftest Only', '__selftest-device'), '/api/app-logo/selftestdevice/selftestonly');
    check('and is invisible to another device',
      logoUrl('Selftest Only', 'some-other-phone'), null);
    check('an unscoped name still falls back to the root',
      logoUrl('Selftest Shared', 'some-other-phone'), '/api/app-logo/selftestshared');

    check('identity carries the scope',
      logoIdentity('Selftest Shared', '__selftest-device'), 'selftestdevice/selftestshared');
    check('identity is bare at the root',
      logoIdentity('Selftest Shared'), 'selftestshared');

    check('the folder is listed', allLogoFiles().some((l) => l.scope === 'selftestdevice'), true);

    // The manifest must store the folder's REAL name, not its key.
    //
    // `__selftest-device` keys as `selftestdevice`, and storing the key
    // would produce a path no file answers to -- a URL that 404s with the
    // file plainly on disk, which is the exact failure the serving route
    // exists to prevent, one layer further down. It was written that way
    // during this feature and every string comparison passed, because the
    // string looked entirely reasonable.
    //
    // So this check OPENS the file. That is the difference between testing
    // what the lookup says and testing what the route will do with it.
    const hit = logoFileForKey('selftestdevice', 'selftestonly');
    check('the stored path uses the real folder name',
      hit?.file, join('__selftest-device', 'Selftest Only.svg'));
    check('and the file it names actually opens',
      hit ? readFileSync(join(logoDir(), hit.file)).length > 0 : false, true);
  } finally {
    rmSync(scopeDir, { recursive: true, force: true });
    rmSync(join(logoDir(), 'Selftest Shared.svg'), { force: true });
  }

  // And it is gone again without a restart, for the same reason.
  check('removal is noticed too', logoUrl('Selftest Shared'), before);
}

/* ------------------------------------------------------------------ */
section('device URLs');

// Both halves address a DEVICE, not a platform. `/apps` could not say whose
// apps it meant, which is the whole reason the laptop moved off the bare
// paths -- so the two shapes are asserted side by side here, where a change
// to one without the other is visible in a single diff.
check('the laptop slugs like a phone does', slugify('Zephyrus G16'), 'zephyrus-g16');
check('windows pages root at the device',
  windowsPages('zephyrus-g16').map((p) => p.href).join(' '),
  '/windows/zephyrus-g16 /windows/zephyrus-g16/apps /windows/zephyrus-g16/sync');
check('android pages have the same shape',
  androidPages('nothing-a001').map((p) => p.href).join(' '),
  '/android/nothing-a001 /android/nothing-a001/apps /android/nothing-a001/sync');
check('and the same labels, in the same order',
  windowsPages('x').map((p) => p.label).join(),
  androidPages('x').map((p) => p.label).join());

// `deviceOf` decides the accent, so a laptop URL must not read as a phone --
// and `windows` must not be mistaken for a device slug under `/android/`.
check('a windows path is the laptop', deviceOf('/windows/zephyrus-g16/apps'), 'zephyrus');
check('an android path is the phone', deviceOf('/android/nothing-a001/apps'), 'android');
check('an unknown path falls to the laptop', deviceOf('/login'), 'zephyrus');

// The tabs are derived from the path. A path that has not named a device yet
// -- `/`, `/windows`, or one of the legacy addresses mid-redirect -- must
// yield NO tabs: a strip whose links all point at a device the URL has not
// chosen is worse than none.
check('tabs for a laptop page', pagesForPath('zephyrus', '/windows/zephyrus-g16/sync').length, 3);
check('tabs for a phone page', pagesForPath('android', '/android/nothing-a001/sync').length, 3);
check('no tabs at the bare root', pagesForPath('zephyrus', '/').length, 0);
check('no tabs at /windows', pagesForPath('zephyrus', '/windows').length, 0);
check('no tabs at /android', pagesForPath('android', '/android').length, 0);
// The legacy paths still resolve to the laptop, and still show no tabs: they
// exist only long enough to redirect.
check('no tabs on the legacy /apps', pagesForPath('zephyrus', '/apps').length, 0);

// The redirects carry the range across. Dropping `?days=` would silently
// widen a bookmarked link's scope, and nothing on the page would say so.
check('a query survives the redirect', queryString({ days: '7' }), '?days=7');
check('no query stays empty', queryString({}), '');
check('undefined is not a value', queryString({ days: undefined }), '');
check('a repeated key keeps the last', queryString({ days: ['7', '30'] }), '?days=30');

/* ------------------------------------------------------------------ */
section('login redirect target');

// The prefix check this replaced accepted every one of the first three. Each
// resolves to http://evil.example/ in a browser, which Next then navigates to.
const BS = String.fromCharCode(92);
check('backslash host is refused', safeNextPath(`/${BS}evil.example`), null);
check('encoded-then-decoded backslash is refused', safeNextPath(decodeURIComponent('/%5Cevil.example')), null);
check('backslash after a slash is refused', safeNextPath(`/${BS}/evil.example`), null);
check('a tab the parser strips is refused', safeNextPath('/\t/evil.example'), null);
check('protocol-relative is refused', safeNextPath('//evil.example'), null);
check('absolute URL is refused', safeNextPath('https://evil.example/'), null);
check('javascript: is refused', safeNextPath('javascript:alert(1)'), null);
check('empty is refused', safeNextPath(''), null);
check('a real page passes, query intact', safeNextPath('/android/pixel-8/apps?days=7'), '/android/pixel-8/apps?days=7');
check('an encoded app key survives', safeNextPath('/windows/x/apps/exe%3Avlc'), '/windows/x/apps/exe%3Avlc');

/* ------------------------------------------------------------------ */
section('login throttle');
{
  let clock = 1_000_000;
  const t = new LoginThrottle(() => clock);
  const admitted = (c: string) => t.attempt(c).allowed;

  // The free allowance, then an exponential lockout on the SAME client.
  for (let i = 1; i < FREE_FAILURES; i++) admitted('a');
  check('the last free attempt is admitted', admitted('a'), true);
  const locked = t.attempt('a');
  check('the next is refused', locked.allowed, false);
  check('with a retry-after', !locked.allowed && locked.retryAfterMs > 0, true);
  check('another client is unaffected', admitted('b'), true);
  clock += 1_000;
  check('the first lockout lasts one second', admitted('a'), true);
  check('and the next one is longer', t.attempt('a').allowed, false);

  // A correct password clears the client and refunds its charge.
  const v = t.attempt('c');
  if (v.allowed) t.succeeded(v.ticket);
  for (let i = 1; i < FREE_FAILURES; i++) admitted('c');
  check('success resets the free allowance', admitted('c'), true);

  // A quiet window forgives.
  clock += WINDOW_MS;
  check('a quiet window forgives a locked client', admitted('a'), true);
}
{
  // The layer that matters: a caller rotating x-forwarded-for is a new
  // "client" every time, and still cannot get past the global budget.
  let clock = 5_000_000;
  const t = new LoginThrottle(() => clock);
  let got = 0;
  for (let i = 0; i < GLOBAL_FAILURES * 3; i++) if (t.attempt(`spoofed-${i}`).allowed) got++;
  check('rotating client keys cannot beat the global budget', got, GLOBAL_FAILURES);
  const refused = t.attempt('the-owner');
  check('...which then refuses everyone until it cools', refused.allowed, false);
  clock += WINDOW_MS;
  check('...and recovers after the window', t.attempt('the-owner').allowed, true);
}
check('client key is the first forwarded address',
  clientKey(new Headers({ 'x-forwarded-for': '10.0.0.5, 127.0.0.1' })), '10.0.0.5');
check('no header is one shared bucket', clientKey(new Headers()), 'unknown');

/* ------------------------------------------------------------------ */
section('session cookie');
{
  const issued = await issueSession('correct horse');
  check('a fresh session verifies', await verifySession('correct horse', issued.value), true);
  check('another password rejects it', await verifySession('battery staple', issued.value), false);
  const [expiry, sig] = issued.value.split('.');
  check('a forged expiry is rejected',
    await verifySession('correct horse', `${Number(expiry) + 86_400_000}.${sig}`), false);
  check('the signature is not a bare HMAC keyed by the password', await (async () => {
    // The old scheme, rebuilt. If it still matches, the PBKDF2 step is gone
    // and a copied cookie is an offline password oracle again.
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', enc.encode('correct horse'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const raw = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(expiry!)));
    let s = '';
    for (const b of raw) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === sig;
  })(), false);
}

/* ------------------------------------------------------------------ */
section('phone payload limits');
{
  const ok = { device: { deviceId: 'abc', label: 'Pixel 8' }, tzOffsetMinutes: 360 };
  check('a minimal payload is fine', payloadProblem(ok), null);
  check('the reachability probe is a 400', payloadProblem({})?.status, 400);
  check('a non-object is a 400', payloadProblem('x')?.status, 400);
  check('a numeric deviceId is refused', payloadProblem({ ...ok, device: { deviceId: 7 } })?.status, 400);
  check('an overlong deviceId is refused',
    payloadProblem({ ...ok, device: { deviceId: 'x'.repeat(PAYLOAD_LIMITS.deviceIdChars + 1) } })?.status, 400);
  check('an overlong label is refused',
    payloadProblem({ ...ok, device: { deviceId: 'a', label: 'x'.repeat(PAYLOAD_LIMITS.labelChars + 1) } })?.status, 400);
  check('an impossible offset is refused', payloadProblem({ ...ok, tzOffsetMinutes: 24 * 60 })?.status, 400);
  check('a non-array is refused', payloadProblem({ ...ok, sessions: {} })?.status, 400);
  check('too many rows is a 413, not a 400',
    payloadProblem({ ...ok, apps: new Array(PAYLOAD_LIMITS.apps + 1).fill({}) })?.status, 413);

  // A bad ROW is rejected on its own; the rest of the push still lands.
  const dir3 = mkdtempSync(join(tmpdir(), 'screentime-limits-'));
  const db3 = openDatabase(join(dir3, 't.db'), { allowSystemDrive: true });
  try {
    const r = ingestAndroid(db3, {
      ...ok,
      apps: [
        { packageName: 'com.example.ok', label: 'OK' },
        { packageName: 'p'.repeat(PAYLOAD_LIMITS.packageChars + 1), label: 'Too long' },
        { packageName: 'com.example.nolabel', label: '' },
      ],
    });
    check('one good label stored', r.appsWritten, 1);
    check('two bad labels counted, not fatal', r.rejected, 2);
  } finally {
    db3.close();
    rmSync(dir3, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
section('windows segment rows');
{
  // The one conversion the ingest and the demo seeder share. A span over a
  // local hour boundary is two rows whose durations add back to the span.
  const at = new Date(2026, 8, 1, 10, 50).getTime();
  const rows = segmentRows('zephyrus', {
    start: new Date(at).toISOString(), end: new Date(at + 20 * MIN).toISOString(),
    ms: 20 * MIN, kind: 'app', app: 'C:\\x\\Code.exe', idle_ms: 5,
  });
  check('split at the hour', rows.length, 2);
  check('durations add back up', Number(rows[0]![4]) + Number(rows[1]![4]), 20 * MIN);
  check('local hours, in order', `${rows[0]![6]},${rows[1]![6]}`, '10,11');
  check('one row per SEGMENT_INSERT_SQL placeholder',
    rows[0]!.length, (SEGMENT_INSERT_SQL.match(/\?/g) ?? []).length);
}

/* ------------------------------------------------------------------ */
section('chart summaries');
{
  const fmt = (n: number) => `${n}m`;
  const s = dailySummary('Time per day', [
    { date: '2026-09-01', value: 30 },
    { date: '2026-09-02', value: null },
    { date: '2026-09-03', value: 90 },
  ], fmt);
  check('a gap is reported, not averaged in as zero', s.includes('2 days recorded, 1 not recorded'), true);
  check('the average is over recorded days only', s.includes('Average 60m a day'), true);
  check('the peak is named with its day', /highest 90m on .*3/.test(s), true);
  check('an empty series says so', dailySummary('X', [], fmt), 'X: no data in this range.');
  check('an all-gap series says nothing was recorded',
    dailySummary('X', [{ date: '2026-09-01', value: null }], fmt).endsWith('nothing recorded.'), true);

  const h = hourlySummary('By hour', [
    { hour: 9, value: 10 }, { hour: 21, value: 50 }, { hour: 22, value: 30 }, { hour: 3, value: 0 },
  ], fmt);
  check('busiest hours come first, in order', h.indexOf('(50m)') < h.indexOf('(30m)') && h.indexOf('(30m)') < h.indexOf('(10m)'), true);
  check('silent hours are not counted as active', h.includes('3 of 24 hours'), true);

  const r = rankedSummary('Top', [1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `App ${i}`, value: 8 - i })), fmt);
  check('ranked: the first five by name', r.includes('1. App 1, 7m') && r.includes('5. App 5'), true);
  check('ranked: the rest are counted, not dropped', r.endsWith('and 2 more.'), true);
}

/* ------------------------------------------------------------------ */
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
