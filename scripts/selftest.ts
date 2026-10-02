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
import { splitIntoHours, segmentRows, SEGMENT_INSERT_SQL, seamInstant, copyFromNative } from '../src/lib/windows-ingest';
import {
  splitDuration, formatDuration, formatDurationLike, durationShape, formatClock,
  formatRelative,
} from '../src/lib/format';
import { ingestAndroid, splitIntoLocalHours, payloadProblem, PAYLOAD_LIMITS } from '../src/lib/android-ingest';
import { safeNextPath } from '../src/lib/safe-next';
import { dailySummary, hourlySummary, rankedSummary } from '../src/lib/chart-summary';
import { LoginThrottle, clientKey, FREE_FAILURES, WINDOW_MS, GLOBAL_FAILURES } from '../src/lib/login-throttle';
import { issueSession, verifySession } from '../src/lib/auth';
import { slugify, decodeSegment } from '../src/lib/slug';
import { windowsPages, androidPages, pagesForPath } from '../src/lib/nav';
import { deviceOf, ACCENTS, LIGHT_ACCENTS, accentStyleSheet } from '../src/lib/accent';
import { ink } from '../src/lib/ink';
import { cleanName, planRename, saveRename, readRenames, type AppNames } from '../src/lib/app-renames';
import { cleanColour } from '../src/lib/colour-hex';
import { pageItems, clampPage } from '../src/lib/pager';
import { saveColourOverride, readColourOverrides } from '../src/lib/app-colour-overrides';
import { DatabaseSync } from 'node:sqlite';
import { THEME_SCRIPT, THEME_KEY, THEME_COLORS } from '../src/lib/theme';
import { getSamplerStatus } from '../src/lib/sampler-status';
import {
  logoDir, logoKey, logoUrl, needsLightPlate, allLogoFiles, deviceScopeKeys, logoIdentity,
  logoFileForKey,
  lookName,
} from '../src/lib/app-logo';
import { resolveApp, knownApps } from '../src/lib/app-name';
import {
  brandColour, brandColourForIdentity, ensureReadable, parseBrandColours, colourFor,
} from '../src/lib/app-colour';
import { hourTick, niceHourAxis, niceCountAxis } from '../src/lib/axis';
import { queryString } from '../src/lib/scope';
import { isHomeSurface } from '../src/lib/home-surface';
import { stitchVisits, visitStats, visitCounts, openBuckets, opensByDay } from '../src/lib/visits';
import { stackByApp, peakOf, OTHER } from '../src/lib/stack';
import { isListed, splitForList, listRule, LIST_MIN_MS, LIST_MIN_OPENS, LIST_MIN_DAYS } from '../src/lib/app-list';
import { fillDays, heaviestDay } from '../src/lib/trend';
import { headlineSource, unionMs, unionByHour } from '../src/lib/android-source';
import { PWA_MANIFEST, PWA_ICONS, glyphOnly } from '../src/lib/pwa';
import { config as proxyConfig } from '../src/proxy';
import {
  recentBlock, expandedBlocks, blockLabel, heatmapColor, HEATMAP_RAMP, WEEKS, DAY_LABELS,
} from '../src/lib/heatmap';
import { readFileSync, writeFileSync } from 'node:fs';

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
section('Screen Time Native as the source');

{
  // The seam must be a LOCAL hour edge: both samplers split their rows there,
  // so at an edge no row straddles it. Built from local fields, so the test
  // holds in any time zone.
  const edge = new Date(2026, 9, 3, 2, 0, 0, 0);
  check('an hour edge is a seam', seamInstant(edge.toISOString()), edge.toISOString());
  const threw = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
  check('half past is refused', threw(() => seamInstant(new Date(2026, 9, 3, 2, 30).toISOString())), true);
  check('a missing seam is refused', threw(() => seamInstant('')), true);
  check('garbage is refused', threw(() => seamInstant('soon')), true);

  const nd = mkdtempSync(join(tmpdir(), 'screentime-native-'));
  try {
    const db = openDatabase(join(nd, 'web.db'), { allowSystemDrive: true });
    const native = new DatabaseSync(join(nd, 'native.db'));
    native.exec(`CREATE TABLE windows_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_start_utc TEXT NOT NULL,
      start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, duration_ms INTEGER NOT NULL,
      local_date TEXT NOT NULL, local_hour INTEGER NOT NULL, kind TEXT NOT NULL,
      app_path TEXT NOT NULL DEFAULT '', unresolved INTEGER NOT NULL DEFAULT 0,
      idle_ms_at_end INTEGER NOT NULL DEFAULT 0,
      UNIQUE (session_start_utc, start_utc, kind, app_path))`);

    const S = edge.getTime();
    const at = (min: number) => new Date(S + min * MIN).toISOString();
    const ours = db.prepare(SEGMENT_INSERT_SQL);
    const theirs = native.prepare(
      `INSERT INTO windows_segments (session_start_utc, start_utc, end_utc, duration_ms,
         local_date, local_hour, kind, app_path, unresolved, idle_ms_at_end)
       VALUES (?, ?, ?, ?, '2026-10-03', 2, 'app', ?, 0, 0)`);
    const mine = (from: number, to: number, app: string) =>
      ours.run('zephyrus', at(from), at(from), at(to), (to - from) * MIN, '2026-10-03', 2, 'app', app, 0, 0);
    const native1 = (from: number, to: number, app: string) =>
      theirs.run(at(from), at(from), at(to), (to - from) * MIN, app);

    // The PowerShell sampler: one row before the seam, two past it in time
    // the native app has covered, one past the end of what it has saved.
    mine(-20, 0, 'C:\\before.exe');
    mine(0, 9, 'C:\\ps-a.exe');
    mine(9, 31, 'C:\\ps-b.exe');
    mine(70, 75, 'C:\\ps-late.exe');
    // Screen Time Native: a row before the seam (already the other's), and
    // two after it, covering up to +60 minutes.
    native1(-20, 0, 'C:\\before-native.exe');
    native1(0, 30, 'C:\\code.exe');
    native1(30, 60, 'C:\\edge.exe');

    const run = () => {
      db.exec('BEGIN');
      const c = copyFromNative(db, native, 'zephyrus', edge.toISOString());
      db.exec('COMMIT');
      return [c.inserted, c.skipped, c.replaced];
    };
    const apps = () => (db.prepare('SELECT app_path AS a FROM windows_segments ORDER BY start_utc, app_path').all() as { a: string }[]).map((r) => r.a);

    check('copies past the seam, replaces the other sampler there', run(), [2, 0, 2]);
    check('before the seam stays; past what native saved stays too', apps(),
      ['C:\\before.exe', 'C:\\code.exe', 'C:\\edge.exe', 'C:\\ps-late.exe']);
    check('a second run is a no-op', run(), [0, 2, 0]);

    // Native saves the next stretch: the late stray is now covered, so judged.
    native1(60, 80, 'C:\\code.exe');
    check('the later stray goes once native covers it', run(), [1, 2, 1]);
    const after = db.prepare('SELECT SUM(duration_ms) AS ms FROM windows_segments WHERE start_utc >= ?').get(edge.toISOString()) as { ms: number };
    check('past the seam, totals are exactly native\'s', after.ms, 80 * MIN);

    db.close();
    native.close();
  } finally {
    rmSync(nd, { recursive: true, force: true });
  }
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
check('decodeSegment decodes an app key', decodeSegment('exe%3Avisual%20studio%2Fsetup'), 'exe:visual studio/setup');
check('decodeSegment: a stray % is null, not a throw', decodeSegment('100%'), null);

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
  // A missing day is NULL, so the chart draws it at zero instead of a slope
  // across days nothing was recorded, and the tooltip can still say so.
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
section('stacked by-app charts');

{
  const rows = [
    { date: '2026-09-01', id: 'a', value: 50 },
    { date: '2026-09-01', id: 'b', value: 30 },
    { date: '2026-09-01', id: 'c', value: 5 },
    { date: '2026-09-03', id: 'a', value: 10 },
    { date: '2026-09-03', id: 'd', value: 4 },
    // Two rows for one app and day -- two exe paths resolving to one app --
    // are one value in the band, not two.
    { date: '2026-09-03', id: 'b', value: 3 },
    { date: '2026-09-03', id: 'b', value: 3 },
    { date: '2026-09-03', id: 'z', value: 0 },
  ];
  const { series, points } = stackByApp(rows, ['2026-09-01', '2026-09-03'], 2);
  check('the top apps by total, then Other',
    series.map((s) => [s.key, s.id, s.total]), [['s0', 'a', 60], ['s1', 'b', 36], [OTHER, null, 9]]);
  // Keys are synthetic: Recharts reads a dotted dataKey as a PATH, so a
  // package like com.android.chrome must never become one.
  check('no key carries a dot', series.every((s) => !s.key.includes('.')), true);
  check('every calendar day, the gap included', points.map((p) => p.date),
    ['2026-09-01', '2026-09-02', '2026-09-03']);
  check('an unrecorded day is flagged, not dropped', points.map((p) => p.recorded), [true, false, true]);
  check('a day folds its tail into Other', points[2]!.v, { s0: 10, s1: 6, other: 4 });
  check('an unrecorded day plots at zero', points[1]!.v, { s0: 0, s1: 0, other: 0 });
  // The bands must add up to what the apps held: nothing is lost to Other.
  const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
  check('the stack conserves the total', points.reduce((n, p) => n + sum(p.v), 0), 105);

  const few = stackByApp([{ date: '2026-09-01', id: 'a', value: 1 }], ['2026-09-01']);
  check('no Other when nothing is left over', few.series.map((s) => s.key), ['s0']);
  // A day holding app rows but no headline still gets its column.
  check('app rows extend the calendar', stackByApp(
    [{ date: '2026-09-02', id: 'a', value: 1 }], ['2026-09-01'],
  ).points.map((p) => [p.date, p.recorded]), [['2026-09-01', true], ['2026-09-02', true]]);
  check('nothing at all, no days', stackByApp([], []).points, []);

  check('peak: the first strictly greatest', peakOf([{ h: 1, v: 2 }, { h: 2, v: 5 }, { h: 3, v: 5 }], (x) => x.v), { h: 2, v: 5 });
  // "Busiest hour 12 AM, 0 opens" would be a tie-break, not a finding.
  check('peak: nothing when everything is zero', peakOf([{ v: 0 }, { v: 0 }], (x) => x.v), null);

  // Opens are filed on the day the visit BEGAN, one pass for every app.
  const t = (h: number) => Date.UTC(2026, 8, 1, h);
  const visits = stitchVisits([
    { app: 'a', start: t(1), end: t(1) + 1000 },
    { app: 'b', start: t(2), end: t(2) + 1000 },
    { app: 'a', start: t(3), end: t(3) + 1000 },
    { app: 'a', start: t(0) - 5000, end: t(0) - 4000 },
  ]);
  const bucketOf = new Map([
    [t(1), { date: '2026-09-01', hour: 1 }],
    [t(2), { date: '2026-09-01', hour: 2 }],
    [t(3), { date: '2026-09-02', hour: 3 }],
  ]);
  check('opens by day, per app, pre-range visit dropped',
    opensByDay(visits, bucketOf).sort((x, y) => (x.date + x.id).localeCompare(y.date + y.id)),
    [
      { date: '2026-09-01', id: 'a', value: 1 },
      { date: '2026-09-01', id: 'b', value: 1 },
      { date: '2026-09-02', id: 'a', value: 1 },
    ]);
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

  // The expanded page starts on the first recorded day -- not on a fixed
  // January, nor on the 1st of its month, both of which opened on outlined days.
  const blocks = expandedBlocks([{ date: '2026-08-31', ms: 1 }], '2026-08-31', today);
  check('expanded starts at the first recorded day', blocks[0]!.first, '2026-08-31');
  check('one block while history is short', blocks.length, 1);
  // 15 October 2026 is a Thursday, so its week column opens on Saturday 10
  // October -- and those five earlier days are hidden, not outlined.
  const oct = expandedBlocks([], '2026-10-15', new Date(Date.UTC(2026, 10, 10)))[0]!;
  check('the column opens on the Saturday before', oct.cells[0]!.date, '2026-10-10');
  check('days before the first are hidden', oct.cells.find((c) => c.date === '2026-10-14')!.hidden, true);
  check('the first day itself is drawn', oct.cells.find((c) => c.date === '2026-10-15')!.hidden, false);
  check('a clipped block is labelled from the first day', oct.first, '2026-10-15');
  check('the block is labelled across the year', blockLabel(blocks[0]!), 'Aug 31, 2026 – Feb 26, 2027');
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
check('a real page passes, query intact', safeNextPath('/android/my-phone/apps?days=7'), '/android/my-phone/apps?days=7');
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
  const ok = { device: { deviceId: 'abc', label: 'My Phone' }, tzOffsetMinutes: 360 };
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
section('android headline source');

{
  // API 28 added SCREEN_* and KEYGUARD_*. Below it there is no screen-on to
  // report, so the headline falls back to app time (Redmi 5 Plus, API 27).
  check('API 27 -> app time', headlineSource(27), 'apps');
  check('API 28 -> screen-on', headlineSource(28), 'screen');
  check('API 36 -> screen-on', headlineSource(36), 'screen');
  // 0 = never reported, which only builds that required 29+ could send.
  check('unknown API keeps screen-on', headlineSource(0), 'screen');

  check('union of nothing is zero', unionMs([]), 0);
  check('disjoint intervals add', unionMs([{ start: 0, end: 10 }, { start: 20, end: 25 }]), 15);
  // The hand-off: next app resumed before the last one paused. A SUM says 20.
  check('overlap counts once', unionMs([{ start: 0, end: 10 }, { start: 5, end: 15 }]), 15);
  check('contained interval adds nothing', unionMs([{ start: 0, end: 100 }, { start: 10, end: 20 }]), 100);
  check('touching intervals merge', unionMs([{ start: 10, end: 20 }, { start: 0, end: 10 }]), 20);
  check('inverted interval ignored', unionMs([{ start: 10, end: 5 }]), 0);

  const b = unionByHour([
    { date: '2026-09-23', hour: 21, start: 0, end: 30 * MIN },
    { date: '2026-09-23', hour: 21, start: 20 * MIN, end: 40 * MIN },
    { date: '2026-09-22', hour: 9, start: 0, end: MIN },
  ]);
  check('buckets come out in date, hour order', b.map((x) => `${x.date} ${x.hour}`), ['2026-09-22 9', '2026-09-23 21']);
  check('a bucket is the union of its rows', b[1]?.ms, 40 * MIN);
  // The physical bound, by construction: stacked full-hour sessions of
  // several apps still make one hour.
  const stacked = unionByHour([1, 2, 3].map(() => ({ date: 'd', hour: 0, start: 0, end: HOUR })));
  check('an hour never holds more than an hour', stacked[0]?.ms, HOUR);
}

/* ------------------------------------------------------------------ */
section('installable app');

{
  // What Chromium's install check reads. A manifest missing any of these is
  // still served, still parses, and simply never offers the install button.
  const m = PWA_MANIFEST;
  check('manifest has a name', m.name.length > 0 && m.short_name.length > 0, true);
  // What the Start menu, the taskbar and the install prompt call it.
  check('it installs as Screen Time Dashboard', [m.name, m.short_name], ['Screen Time Dashboard', 'Screen Time Dashboard']);
  check('it opens standalone', m.display, 'standalone');
  check('start_url sits inside the scope', m.start_url.startsWith(m.scope), true);
  const sizes = m.icons.filter((i) => i.type === 'image/png').map((i) => i.sizes);
  check('a 192px PNG icon', sizes.includes('192x192'), true);
  check('a 512px PNG icon', sizes.includes('512x512'), true);
  check('a maskable icon', m.icons.some((i) => i.purpose === 'maskable'), true);
  // Every icon it names must be one the route can draw -- dynamicParams is
  // off, so anything else is a 404 the browser reports nowhere visible.
  const drawable = new Set(PWA_ICONS.map((i) => `/pwa/${i.file}`));
  check('every PNG icon is drawn by the route',
    m.icons.filter((i) => i.src.startsWith('/pwa/')).every((i) => drawable.has(i.src)), true);

  // The maskable icons are the favicon minus its tile. If icon.svg changes
  // shape so the tile no longer strips, a launcher mask would cut its corners.
  const favicon = readFileSync(join('src', 'app', 'icon.svg'), 'utf8');
  const glyph = glyphOnly(favicon);
  check('the tile strips out', /<rect\b/.test(glyph), false);
  check('the clock survives it', /<circle\b/.test(glyph) && (glyph.match(/<path\b/g) ?? []).length, 2);

  // A browser fetches the manifest WITHOUT cookies. Behind the gate it would
  // get the login redirect and the app would silently stop being installable.
  const gated = new RegExp(`^${proxyConfig.matcher[0]}$`);
  check('the manifest bypasses the gate', gated.test('/manifest.webmanifest'), false);
  check('so do its icons', PWA_ICONS.every((i) => !gated.test(`/pwa/${i.file}`)), true);
  check('the svg icon it names too', gated.test('/icon.svg'), false);
  // iOS asks for this one with no cookie either.
  check('the apple touch icon too', gated.test('/apple-icon'), false);
  check('a dashboard page is still gated', gated.test('/windows/zephyrus-g16'), true);
  check('an API route is still gated', gated.test('/api/ingest'), true);
}

/* ------------------------------------------------------------------ */
section('light theme');
{
  // WCAG relative luminance and contrast, so the ratios quoted in accent.ts
  // are recomputed on every run rather than trusted from a comment.
  const lum = (hex: string) => [16, 8, 0]
    .map((sh) => ((parseInt(hex.slice(1), 16) >> sh) & 255) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // The tint behind an active tab: the accent at 10% over white.
  const tint = (hex: string) => '#' + [16, 8, 0]
    .map((sh) => Math.round(((parseInt(hex.slice(1), 16) >> sh) & 255) * 0.1 + 255 * 0.9))
    .map((v) => v.toString(16).padStart(2, '0')).join('');
  for (const [id, t] of Object.entries(LIGHT_ACCENTS)) {
    // Accents are TEXT on the light theme: links, the headline figure, the
    // active tab. AA for body text is 4.5:1, on the card, the canvas and the tint.
    for (const [role, hex] of [['accent', t.accent], ['bright', t.accentBright]] as const) {
      check(`${id} light ${role} reads on white`, contrast(hex, '#ffffff') >= 4.5, true);
      check(`${id} light ${role} reads on the canvas`, contrast(hex, THEME_COLORS.light) >= 4.5, true);
      check(`${id} light ${role} reads on its tint`, contrast(hex, tint(t.accent)) >= 4.5, true);
    }
    check(`${id} light fill carries its text`, contrast(t.onAccent, t.accentFill) >= 4.5, true);
    // "Bright" is the emphasis step; on white that means DARKER.
    check(`${id} light bright is darker`, lum(t.accentBright) < lum(t.accent), true);
    // More time, more ink: the ramp darkens step by step.
    check(`${id} light heat map darkens`,
      t.heatmap.every((c, i) => i === 0 || lum(c) < lum(t.heatmap[i - 1]!)), true);
  }
  check('both themes cover the same devices',
    Object.keys(LIGHT_ACCENTS).sort().join(), Object.keys(ACCENTS).sort().join());

  // The stylesheet carries both themes, and the light blocks come AFTER the
  // dark ones: equal specificity would otherwise let dark win.
  const sheet = accentStyleSheet();
  check('the light root block is emitted', sheet.includes(":root[data-theme='light']{"), true);
  check('a light device block is emitted', sheet.includes("[data-theme='light'] [data-device='android']{"), true);
  check('light comes after dark',
    sheet.indexOf("[data-theme='light']") > sheet.lastIndexOf("[data-device='android']{--accent:" + ACCENTS.android.accent), true);

  // ink(): a hex is wrapped in the theme's lightness band; anything already a
  // var() or a mix is left alone, since it has no single lightness to clamp.
  check('ink wraps a hex in the theme band',
    ink('#dcdcdc'), 'oklch(from #dcdcdc clamp(var(--ink-lo, 0), l, var(--ink-hi, 1)) c h)');
  check('ink leaves a var() alone', ink('var(--accent)'), 'var(--accent)');
  check('ink leaves a short hex alone', ink('#abc'), '#abc');

  // The script is the one implementation: it must read the key the toggle
  // writes, and paint the same canvas colours the manifest meta expects.
  check('the theme script reads the toggle key', THEME_SCRIPT.includes(`localStorage.getItem('${THEME_KEY}')`), true);
  check('it sets both canvas colours',
    THEME_SCRIPT.includes(THEME_COLORS.light) && THEME_SCRIPT.includes(THEME_COLORS.dark), true);
  check('dark is the default', THEME_SCRIPT.includes(`||'dark'`), true);
  // It runs before anything else, as plain ES5: no arrows, no let/const.
  check('the theme script is ES5', /=>|let|const|`/.test(THEME_SCRIPT), false);
}

/* ------------------------------------------------------------------ */
section('app renames');
{
  // Tidying: what reaches the database and every page is one clean line.
  check('a name is trimmed', cleanName('  Edge  '), 'Edge');
  check('inner whitespace collapses', cleanName('Visual 	 Studio   Code'), 'Visual Studio Code');
  check('control characters go', cleanName('Ed ge'), 'Edge');
  check('an empty name is refused', cleanName('   '), null);
  check('60 characters pass', cleanName('x'.repeat(60)), 'x'.repeat(60));
  check('61 do not', cleanName('x'.repeat(61)), null);
  check('a non-string is refused', cleanName(42), null);

  const apps: AppNames = new Map([
    ['msedge', { name: 'Microsoft Edge', base: 'Microsoft Edge' }],
    ['code', { name: 'Editor', base: 'VS Code' }],
  ]);
  check('an unknown app is refused', planRename(apps, 'nope', 'X'), { ok: false, error: 'unknown-app' });
  check('a new name is planned', planRename(apps, 'msedge', 'Edge'), { ok: true, name: 'Edge', clear: false });
  check('an empty name clears it', planRename(apps, 'code', ''), { ok: true, name: 'VS Code', clear: true });
  check('the base name clears it', planRename(apps, 'code', 'VS Code'), { ok: true, name: 'VS Code', clear: true });
  // Another app's SHOWN name is taken, whatever its case. Its base is not:
  // nothing on screen says "VS Code" any more.
  check('a shown name is taken', planRename(apps, 'msedge', 'editor'), { ok: false, error: 'taken' });
  check('a renamed-away base is free', planRename(apps, 'msedge', 'VS Code').ok, true);
  check('an app may keep its own name', planRename(apps, 'code', 'Editor').ok, true);
  check('Other is reserved', planRename(apps, 'msedge', 'other'), { ok: false, error: 'reserved' });
  check('a bad name is refused', planRename(apps, 'msedge', 'x'.repeat(61)), { ok: false, error: 'bad-name' });

  // The real write path, on a temp database: set, overwrite, clear.
  const rdir = mkdtempSync(join(tmpdir(), 'screentime-renames-'));
  try {
    const file = join(rdir, 'r.db');
    const save = (key: string, name: string) =>
      saveRename({ dbFile: file, deviceId: 'zephyrus', key, name, apps, allowSystemDrive: true });
    const read = () => {
      const db = openDatabase(file, { allowSystemDrive: true });
      try { return [...readRenames(db, 'zephyrus')]; } finally { db.close(); }
    };
    check('a rename is stored', (save('msedge', 'Edge'), read()), [['msedge', 'Edge']]);
    check('and overwritten', (save('msedge', 'Browser'), read()), [['msedge', 'Browser']]);
    check('and cleared, leaving no row', (save('msedge', ''), read()), []);
    check('a refused rename writes nothing', (save('msedge', 'Other'), read()), []);

    // A page can open a database whose last writer predates the table.
    const bare = new DatabaseSync(join(rdir, 'bare.db'));
    try {
      check('no table reads as no renames', readRenames(bare, 'zephyrus').size, 0);
    } finally {
      bare.close();
    }
  } finally {
    rmSync(rdir, { recursive: true, force: true });
  }

  // A renamed app keeps the look of its ORIGINAL name unless a logo answers
  // to the new one. No logo file is called this, on any device.
  check('an unrenamed app looks like itself', lookName('Qx Nothing', 'Qx Nothing'), 'Qx Nothing');
  check('a rename with no logo keeps the base look', lookName('Qx Renamed', 'Qx Base'), 'Qx Base');
}

/* ------------------------------------------------------------------ */
section('app colours');
{
  // What passes is written into style attributes and SVG fills, so nothing
  // but a plain hex may get through.
  check('a colour accepts #rrggbb, lowercased', cleanColour('#7C5CFF'), '#7c5cff');
  check('a colour accepts #rgb, expanded', cleanColour('#abc'), '#aabbcc');
  check('a colour accepts a bare hex', cleanColour(' 7c5cff '), '#7c5cff');
  for (const bad of ['red', '#12345', '#1234567', 'url(x)', '#7c5cff;background:red', 'var(--accent)', '', 42, null]) {
    check(`a colour rejects ${JSON.stringify(bad)}`, cleanColour(bad), null);
  }

  // A picked colour replaces the brand colour and is lifted like one, so a
  // black chosen by hand still shows on the dark theme.
  check('a picked colour wins', colourFor('#3366cc', 'Qx Nothing'), '#3366cc');
  check('a picked black is lifted', colourFor('#000000', 'Qx Nothing') !== '#000000', true);
  check('no pick and no brand means the accent', colourFor(undefined, 'Qx Nothing'), null);

  const cdir = mkdtempSync(join(tmpdir(), 'screentime-colours-'));
  try {
    const file = join(cdir, 'c.db');
    const known = new Set(['msedge']);
    const save = (key: string, colour: unknown) =>
      saveColourOverride({ dbFile: file, deviceId: 'zephyrus', key, colour, known, allowSystemDrive: true });
    const read = () => {
      const db = openDatabase(file, { allowSystemDrive: true });
      try { return [...readColourOverrides(db, 'zephyrus')]; } finally { db.close(); }
    };
    check('a colour is stored, tidied', (save('msedge', '#ABC'), read()), [['msedge', '#aabbcc']]);
    check('and cleared', (save('msedge', ''), read()), []);
    check('a bad colour is refused', save('msedge', 'red'), { ok: false, error: 'bad-colour' });
    check('an unknown app is refused', save('nope', '#abc'), { ok: false, error: 'unknown-app' });
    check('a refused colour writes nothing', read(), []);

    // A hand-edited row must not reach a style attribute.
    const db = openDatabase(file, { allowSystemDrive: true });
    try {
      db.prepare("INSERT INTO app_colours VALUES ('zephyrus', 'msedge', 'red;x', '')").run();
      check('a bad stored row is dropped on read', readColourOverrides(db, 'zephyrus').size, 0);
    } finally {
      db.close();
    }
    const bare = new DatabaseSync(join(cdir, 'bare.db'));
    try {
      check('no table reads as no colours', readColourOverrides(bare, 'zephyrus').size, 0);
    } finally {
      bare.close();
    }
  } finally {
    rmSync(cdir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
section('history pager');
{
  const items = (p: number, c: number) => pageItems(p, c).map((x) => (x === 'gap' ? '…' : x)).join(' ');
  check('a middle page', items(6, 12), '1 … 4 5 6 7 8 … 12');
  check('near the start', items(2, 12), '1 2 3 4 … 12');
  check('near the end', items(12, 12), '1 … 10 11 12');
  check('no gap hides a single page', items(4, 12), '1 2 3 4 5 6 … 12');
  check('few pages, no gaps', items(3, 5), '1 2 3 4 5');
  check('one page', items(1, 1), '1');
  // The page number arrives from the URL, so anything can.
  check('a page past the end is the last', clampPage('99', 12), 12);
  check('junk is page 1', [clampPage('abc', 12), clampPage(undefined, 12), clampPage('-3', 12)], [1, 1, 1]);
  check('a fraction is floored', clampPage('4.7', 12), 4);
  check('an empty history still has page 1', clampPage('3', 1), 1);
}

/* ------------------------------------------------------------------ */
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
