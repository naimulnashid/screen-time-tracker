import 'server-only';

/**
 * Every read for the Android half.
 *
 * ===========================================================================
 * THREE RULES, all of which are silent when broken.
 *
 * 1. EVERY QUERY TAKES deviceId AS ITS FIRST BOUND PARAMETER. Without it two
 *    phones report identical numbers at different URLs, which reads as broken
 *    routing rather than a broken query.
 *
 * 2. THE HEADLINE COMES FROM android_screen, NEVER FROM SUM() OVER THE APP
 *    ROWS. Measured across 11 real days: per-app session time is 0.56-0.87 of
 *    screen-on, averaging 0.77x, because the lock screen and system surfaces
 *    hold time no app claims. Summing apps under-reports.
 *
 *    This is the OPPOSITE of the Windows side, where the sampler partitions
 *    time exclusively and SUM over apps IS the total. Do not reconcile them.
 *
 * 3. android_screen AND android_segments OVERLAP, and so do the two kinds
 *    INSIDE android_screen. An app session happens during screen-on, and
 *    unlocked time is a subset of screen-on time. Never sum across the two
 *    tables, and always filter `kind`.
 * ===========================================================================
 */

import { DatabaseSync } from 'node:sqlite';
import { dbPath, databaseExists } from './config';
import {
  stitchVisits, visitStats, visitCounts, openBuckets,
  type RawSession, type SessionBucket,
} from './visits';

function open(): DatabaseSync {
  const p = dbPath();
  if (!p) throw new Error('No databasePath configured');
  return new DatabaseSync(p, { readOnly: true });
}

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = open();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export interface AndroidDevice {
  deviceId: string;
  slug: string;
  label: string;
  model: string;
  brand: string;
  androidRelease: string;
  sdkInt: number;
  eventsReachUtc: string | null;
  lastSeenUtc: string;
}

export function getAndroidDeviceBySlug(slug: string): AndroidDevice | null {
  if (!databaseExists()) return null;
  try {
    return withDb((db) => {
      const r = db
        .prepare(
          `SELECT device_id, slug, label, model, brand, android_release,
                  sdk_int, events_reach_utc, last_seen_utc
             FROM android_devices WHERE slug = ?`,
        )
        .get(slug) as Record<string, string | number | null> | undefined;
      if (!r) return null;
      return {
        deviceId: String(r['device_id']),
        slug: String(r['slug']),
        label: String(r['label']),
        model: String(r['model'] ?? ''),
        brand: String(r['brand'] ?? ''),
        androidRelease: String(r['android_release'] ?? ''),
        sdkInt: Number(r['sdk_int'] ?? 0),
        eventsReachUtc: r['events_reach_utc'] ? String(r['events_reach_utc']) : null,
        lastSeenUtc: String(r['last_seen_utc']),
      };
    });
  } catch {
    return null;
  }
}

/** The phone with the most stored time, for the bare /android redirect. */
export function busiestAndroidSlug(): string | null {
  if (!databaseExists()) return null;
  try {
    return withDb((db) => {
      const r = db
        .prepare(
          `SELECT d.slug AS slug, COALESCE(SUM(s.duration_ms), 0) AS ms
             FROM android_devices d
             LEFT JOIN android_screen s
               ON s.device_id = d.device_id AND s.kind = 'screen_on'
            GROUP BY d.slug ORDER BY ms DESC LIMIT 1`,
        )
        .get() as { slug: string } | undefined;
      return r?.slug ?? null;
    });
  } catch {
    return null;
  }
}

export interface AndroidScope {
  days: number;
}

/**
 * The newest local_date with SCREEN data, which anchors every range.
 *
 * Anchored on data rather than on today: a phone that has not synced for a
 * week would otherwise show seven empty columns and a zero headline, which
 * reads as a broken collector rather than a phone that was off Wi-Fi.
 */
function latestDate(db: DatabaseSync, deviceId: string): string | null {
  const r = db
    .prepare('SELECT MAX(local_date) AS d FROM android_screen WHERE device_id = ?')
    .get(deviceId) as { d: string | null };
  return r.d;
}

function rangeStart(latest: string, days: number): string {
  const d = new Date(latest + 'T00:00:00');
  d.setDate(d.getDate() - (days - 1));
  return d.toLocaleDateString('en-CA');
}

export interface AndroidOverview {
  latestDate: string | null;
  /** Screen-on on the newest day with data. THE headline. */
  today: number;
  dailyAverage: number;
  rangeScreenOn: number;
  rangeUnlocked: number;
  /**
   * How many times the phone was unlocked on the newest day with data.
   *
   * A COUNT, not a duration -- one per KEYGUARD_HIDDEN, which is the same
   * event Digital Wellbeing counts, so the two are comparable.
   */
  unlocksToday: number;
  /** Mean unlocks per day that has any screen data at all. */
  unlocksDailyAverage: number;
  /** Every unlock in the range, counted per session like the two above. */
  unlocksTotal: number;
  /** Sum over app sessions. ALWAYS <= screen-on; never the headline. */
  rangeApps: number;
  daysWithData: number;
  appCount: number;
  /** Screen-on time no app accounts for. */
  unaccounted: number;
}

/**
 * Unlocks per local day: one per KEYGUARD_HIDDEN the phone reported.
 *
 * ⚠️ COUNTED PER SESSION, NOT PER ROW. `android_screen` stores spans split at
 * local hour boundaries, so an unlock that lasted from 21:40 to 23:10 is three
 * rows. Counting rows would turn one unlock into three and would inflate long
 * sessions hardest -- exactly backwards, since a long unlocked stretch is one
 * deliberate pick-up, not several.
 *
 * `session_start_utc` is the same value on every piece of one span, so it is
 * the session's identity. The day a session belongs to is the day it STARTED
 * (`MIN(local_date)`), so an unlock that runs past midnight is counted once,
 * on the day you picked the phone up -- which is what Digital Wellbeing shows
 * and what a person means.
 */
function unlocksPerDay(
  db: DatabaseSync, deviceId: string, from: string, to: string,
): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT s.local_date AS d, COUNT(*) AS n
         FROM (
           SELECT session_start_utc, MIN(local_date) AS local_date
             FROM android_screen
            WHERE device_id = ? AND kind = 'unlocked'
            GROUP BY session_start_utc
         ) s
        WHERE s.local_date >= ? AND s.local_date <= ?
        GROUP BY s.local_date`,
    )
    .all(deviceId, from, to) as { d: string; n: number }[];
  return new Map(rows.map((r) => [r.d, r.n]));
}

export function getAndroidOverview(deviceId: string, scope: AndroidScope): AndroidOverview {
  return withDb((db) => {
    const latest = latestDate(db, deviceId);
    const empty: AndroidOverview = {
      latestDate: null, today: 0, dailyAverage: 0, rangeScreenOn: 0,
      rangeUnlocked: 0, unlocksToday: 0, unlocksDailyAverage: 0, unlocksTotal: 0,
      rangeApps: 0, daysWithData: 0, appCount: 0, unaccounted: 0,
    };
    if (!latest) return empty;
    const from = rangeStart(latest, scope.days);

    const screen = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN kind = 'screen_on' THEN duration_ms END), 0) AS on_ms,
           COALESCE(SUM(CASE WHEN kind = 'unlocked'  THEN duration_ms END), 0) AS un_ms,
           COUNT(DISTINCT local_date) AS days
         FROM android_screen
        WHERE device_id = ? AND local_date >= ? AND local_date <= ?`,
      )
      .get(deviceId, from, latest) as { on_ms: number; un_ms: number; days: number };

    const today = db
      .prepare(
        `SELECT COALESCE(SUM(duration_ms), 0) AS ms
           FROM android_screen
          WHERE device_id = ? AND local_date = ? AND kind = 'screen_on'`,
      )
      .get(deviceId, latest) as { ms: number };

    const apps = db
      .prepare(
        `SELECT COALESCE(SUM(duration_ms), 0) AS ms,
                COUNT(DISTINCT package_name) AS n
           FROM android_segments
          WHERE device_id = ? AND local_date >= ? AND local_date <= ?`,
      )
      .get(deviceId, from, latest) as { ms: number; n: number };

    const unlocks = unlocksPerDay(db, deviceId, from, latest);
    const unlockDays = unlocks.size;
    let unlockTotal = 0;
    for (const n of unlocks.values()) unlockTotal += n;

    return {
      latestDate: latest,
      today: today.ms,
      // Over days WITH data, never over the range length -- dividing by 30
      // when the phone has reported for 11 of them reports a third of the
      // truth and looks like a collapse in usage.
      dailyAverage: screen.days > 0 ? Math.round(screen.on_ms / screen.days) : 0,
      rangeScreenOn: screen.on_ms,
      rangeUnlocked: screen.un_ms,
      unlocksToday: unlocks.get(latest) ?? 0,
      // Over days that HAVE unlock data, matching the screen-time average
      // beside it. Dividing by the range length would report a fraction of the
      // truth the moment the range is longer than the phone has been syncing.
      unlocksDailyAverage: unlockDays > 0 ? Math.round(unlockTotal / unlockDays) : 0,
      unlocksTotal: unlockTotal,
      rangeApps: apps.ms,
      daysWithData: screen.days,
      appCount: apps.n,
      // Cannot go below zero even if a sync lands oddly.
      unaccounted: Math.max(0, screen.on_ms - apps.ms),
    };
  });
}

/**
 * Every session in the window, across EVERY app.
 *
 * Visits are stitched against the global ordering, so asking only about one
 * package cannot tell "came back after using something else" from "moved
 * between two screens of the same app". See visits.ts, rule 1.
 */
function allSessions(db: DatabaseSync, deviceId: string, from: string, to: string): RawSession[] {
  const rows = db
    .prepare(
      `SELECT package_name AS app, session_start_utc AS s, MAX(end_utc) AS e
         FROM android_segments
        WHERE device_id = ? AND local_date >= ? AND local_date <= ?
        GROUP BY package_name, session_start_utc`,
    )
    .all(deviceId, from, to) as { app: string; s: string; e: string }[];
  return rows.map((r) => ({
    app: r.app,
    start: Date.parse(r.s),
    end: Date.parse(r.e),
  }));
}

export interface AndroidAppRow {
  packageName: string;
  label: string;
  system: boolean;
  ms: number;
  opens: number;
  days: number;
  share: number;
}

export function getAndroidApps(deviceId: string, scope: AndroidScope): AndroidAppRow[] {
  return withDb((db) => {
    const latest = latestDate(db, deviceId);
    if (!latest) return [];
    const from = rangeStart(latest, scope.days);

    const rows = db
      .prepare(
        `SELECT g.package_name AS pkg,
                COALESCE(a.label, g.package_name) AS label,
                COALESCE(a.is_system, 0) AS sys,
                SUM(g.duration_ms) AS ms,
                COUNT(DISTINCT g.local_date) AS days
           FROM android_segments g
           LEFT JOIN android_apps a
             ON a.device_id = g.device_id AND a.package_name = g.package_name
          WHERE g.device_id = ? AND g.local_date >= ? AND g.local_date <= ?
          GROUP BY g.package_name
          ORDER BY ms DESC`,
      )
      .all(deviceId, from, latest) as
      { pkg: string; label: string; sys: number; ms: number; days: number }[];

    // "Opens" counts VISITS, not raw sessions: ACTIVITY_RESUMED fires per
    // Activity, so a raw count reports the Android lifecycle rather than the
    // person. See visits.ts.
    const opens = visitCounts(stitchVisits(allSessions(db, deviceId, from, latest)));

    const total = rows.reduce((a, r) => a + r.ms, 0);
    return rows.map((r) => ({
      packageName: r.pkg,
      label: r.label,
      system: r.sys === 1,
      ms: r.ms,
      opens: opens.get(r.pkg) ?? 0,
      days: r.days,
      share: total > 0 ? (r.ms / total) * 100 : 0,
    }));
  });
}

export interface AndroidDayPoint {
  date: string;
  screenOn: number;
  apps: number;
}

export function getAndroidDaily(deviceId: string, scope: AndroidScope): AndroidDayPoint[] {
  return withDb((db) => {
    const latest = latestDate(db, deviceId);
    if (!latest) return [];
    const from = rangeStart(latest, scope.days);

    // Two separate aggregates joined by date. Deliberately NOT one query with
    // a join across the tables: android_screen and android_segments overlap in
    // time, and a join would multiply rows before summing them.
    const screen = db
      .prepare(
        `SELECT local_date AS d, SUM(duration_ms) AS ms
           FROM android_screen
          WHERE device_id = ? AND kind = 'screen_on'
            AND local_date >= ? AND local_date <= ?
          GROUP BY local_date`,
      )
      .all(deviceId, from, latest) as { d: string; ms: number }[];

    const apps = db
      .prepare(
        `SELECT local_date AS d, SUM(duration_ms) AS ms
           FROM android_segments
          WHERE device_id = ? AND local_date >= ? AND local_date <= ?
          GROUP BY local_date`,
      )
      .all(deviceId, from, latest) as { d: string; ms: number }[];

    const appMap = new Map(apps.map((r) => [r.d, r.ms]));
    return screen
      .map((r) => ({ date: r.d, screenOn: r.ms, apps: appMap.get(r.d) ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}

export function getAndroidHourly(
  deviceId: string,
  scope: AndroidScope,
): { hour: number; ms: number }[] {
  return withDb((db) => {
    const latest = latestDate(db, deviceId);
    if (!latest) return Array.from({ length: 24 }, (_, h) => ({ hour: h, ms: 0 }));
    const from = rangeStart(latest, scope.days);

    const rows = db
      .prepare(
        `SELECT local_hour AS hour, SUM(duration_ms) AS ms
           FROM android_screen
          WHERE device_id = ? AND kind = 'screen_on'
            AND local_date >= ? AND local_date <= ?
          GROUP BY local_hour`,
      )
      .all(deviceId, from, latest) as { hour: number; ms: number }[];

    const map = new Map(rows.map((r) => [r.hour, r.ms]));
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, ms: map.get(h) ?? 0 }));
  });
}

export interface AndroidSyncInfo {
  lastSuccessUtc: string | null;
  lastStatus: string | null;
  lastError: string | null;
  runs: number;
  /** Fraction of stored screen-on still marked in-flight, as a percentage. */
  provisionalShare: number;
}

export function getAndroidSyncInfo(deviceId: string): AndroidSyncInfo {
  return withDb((db) => {
    const last = db
      .prepare(
        `SELECT finished_at, status, error FROM sync_log
          WHERE device_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(deviceId) as { finished_at: string | null; status: string; error: string | null } | undefined;

    const runs = db
      .prepare('SELECT COUNT(*) AS n FROM sync_log WHERE device_id = ?')
      .get(deviceId) as { n: number };

    // How much of what is stored is still a clipped, in-flight reading. A
    // large share means the last sync caught the phone mid-use and those
    // figures will grow.
    const flight = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN in_flight = 1 THEN duration_ms END), 0) AS f,
                COALESCE(SUM(duration_ms), 0) AS t
           FROM android_screen WHERE device_id = ? AND kind = 'screen_on'`,
      )
      .get(deviceId) as { f: number; t: number };

    return {
      lastSuccessUtc: last?.finished_at ?? null,
      lastStatus: last?.status ?? null,
      lastError: last?.error ?? null,
      runs: runs.n,
      provisionalShare: flight.t > 0 ? (flight.f / flight.t) * 100 : 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/* App detail                                                          */
/* ------------------------------------------------------------------ */

export interface AndroidAppDetail {
  packageName: string;
  label: string;
  system: boolean;
  ms: number;
  opens: number;
  days: number;
  share: number;
  longestSessionMs: number;
  medianSessionMs: number;
  daily: { date: string; active: number }[];
  hourly: { hour: number; ms: number }[];
  /**
   * The same two shapes, counted in OPENS instead of milliseconds.
   *
   * Opens are visits, not raw sessions -- see visits.ts. A visit is filed
   * under the day and hour it BEGAN, so an app opened at 23:50 and used past
   * midnight counts once, last night. Time is split across the boundary
   * because time genuinely was spent on both sides; an open happened at one
   * instant and splitting it would invent an opening that never occurred.
   */
  dailyOpens: { date: string; opens: number }[];
  hourlyOpens: { hour: number; opens: number }[];
}

/**
 * Whether an app earns a page of its own.
 *
 * Same threshold as the Windows side. A detail page shows behaviour over time,
 * so the question is whether there is a shape to look at; under a minute is a
 * stray resume event and its page would be one bar.
 */
export function androidEarnsDetailPage(ms: number): boolean {
  return ms >= 60_000;
}

export function getAndroidAppDetail(
  deviceId: string,
  scope: AndroidScope,
  packageName: string,
): AndroidAppDetail | null {
  return withDb((db) => {
    const latest = latestDate(db, deviceId);
    if (!latest) return null;
    const from = rangeStart(latest, scope.days);

    const rows = db
      .prepare(
        `SELECT session_start_utc, start_utc, local_date, local_hour, duration_ms
           FROM android_segments
          WHERE device_id = ? AND package_name = ?
            AND local_date >= ? AND local_date <= ?`,
      )
      .all(deviceId, packageName, from, latest) as {
      session_start_utc: string; start_utc: string; local_date: string;
      local_hour: number; duration_ms: number;
    }[];

    if (rows.length === 0) return null;

    const meta = db
      .prepare(
        'SELECT label, is_system AS sys FROM android_apps WHERE device_id = ? AND package_name = ?',
      )
      .get(deviceId, packageName) as { label: string; sys: number } | undefined;

    const total = db
      .prepare(
        `SELECT COALESCE(SUM(duration_ms), 0) AS ms FROM android_segments
          WHERE device_id = ? AND local_date >= ? AND local_date <= ?`,
      )
      .get(deviceId, from, latest) as { ms: number };

    let ms = 0;
    const byDate = new Map<string, number>();
    const byHour = new Map<number, number>();

    // Where each SESSION started, in phone-local terms. Only the first piece
    // of a split span carries the session's own start, which is why the row
    // has to match on `start_utc` rather than merely belonging to the session.
    // The local buckets are read back off the row instead of being recomputed:
    // they were written at ingest from the phone's own UTC offset, which this
    // machine does not necessarily share.
    const sessionBucket = new Map<number, SessionBucket>();

    for (const r of rows) {
      ms += r.duration_ms;
      byDate.set(r.local_date, (byDate.get(r.local_date) ?? 0) + r.duration_ms);
      byHour.set(r.local_hour, (byHour.get(r.local_hour) ?? 0) + r.duration_ms);
      if (r.start_utc === r.session_start_utc) {
        sessionBucket.set(Date.parse(r.session_start_utc), {
          date: r.local_date, hour: r.local_hour,
        });
      }
    }

    // Visits, not raw sessions. Instagram measured 158 sessions with a 2.6s
    // median before this -- which described ACTIVITY_RESUMED firing per
    // Activity, not how often the app was actually opened.
    const visits = stitchVisits(allSessions(db, deviceId, from, latest));
    const stats = visitStats(visits, packageName);

    // An open is an instant, not a span: filed under the day and hour the
    // visit BEGAN. Shared with the Windows detail page -- the rule is about
    // what an "open" means, not about which device recorded it.
    const opens = openBuckets(visits, packageName, sessionBucket);

    return {
      packageName,
      label: meta?.label ?? packageName,
      system: meta?.sys === 1,
      ms,
      opens: stats.visits,
      days: byDate.size,
      share: total.ms > 0 ? (ms / total.ms) * 100 : 0,
      longestSessionMs: stats.longestMs,
      medianSessionMs: stats.medianMs,
      daily: [...byDate.entries()]
        .map(([date, active]) => ({ date, active }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, ms: byHour.get(h) ?? 0 })),
      // Every day the app had TIME gets a column, even if it had no open of
      // its own -- a day carried entirely by a visit that began the night
      // before is a real zero, not a missing column.
      dailyOpens: [...byDate.keys()]
        .map((date) => ({ date, opens: opens.byDate.get(date) ?? 0 }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      hourlyOpens: Array.from({ length: 24 }, (_, h) => ({
        hour: h, opens: opens.byHour.get(h) ?? 0,
      })),
    };
  });
}

/** Does this package exist for this device at all, ignoring the range? */
/** The label the phone reported for a package, for the page title. */
export function androidAppLabel(deviceId: string, packageName: string): string | null {
  try {
    return withDb((db) => {
      const r = db
        .prepare('SELECT label FROM android_apps WHERE device_id = ? AND package_name = ?')
        .get(deviceId, packageName) as { label: string } | undefined;
      return r?.label ?? null;
    });
  } catch {
    return null;
  }
}

export function androidAppExists(deviceId: string, packageName: string): boolean {
  try {
    return withDb((db) => {
      const r = db
        .prepare(
          'SELECT COUNT(*) AS n FROM android_segments WHERE device_id = ? AND package_name = ?',
        )
        .get(deviceId, packageName) as { n: number };
      return r.n > 0;
    });
  } catch {
    return false;
  }
}
