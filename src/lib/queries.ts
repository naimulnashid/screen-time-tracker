import 'server-only';
import { deviceLabel } from './config';

/**
 * Every read the dashboard performs. Server-side only -- `node:sqlite` is a
 * Node builtin and never reaches the browser.
 *
 * ===========================================================================
 * THE ONE RULE, and it differs per device. Do NOT "fix" one to match the other.
 *
 *   WINDOWS   active time = SUM(duration_ms) WHERE kind = 'app'
 *   ANDROID   screen time = SUM over android_screen, NEVER over the app rows
 *
 * That looks inconsistent and is not. The sampler produces an EXCLUSIVE
 * PARTITION of tracked time -- at any instant exactly one span is open, and it
 * is app, locked, gap or unknown -- so summing the app spans is the total by
 * construction. Android's per-app sessions do NOT partition anything: measured
 * at 0.76x screen-on, because the lock screen, the launcher and system
 * surfaces hold time no app claims. Summing them there under-reports.
 *
 * The shared half of the rule: 'gap' and 'locked' are never active time, and
 * 'unknown' is never quietly folded into either.
 * ===========================================================================
 */

import { DatabaseSync } from 'node:sqlite';
import { dbPath, databaseExists } from './config';
import { resolveApp, type ResolvedApp } from './app-name';
import { readRenames, type AppNames } from './app-renames';
import { readColourOverrides } from './app-colour-overrides';
import {
  stitchVisits, visitStats, visitCounts, openBuckets, opensByDay,
  type RawSession, type SessionBucket,
} from './visits';
import type { StackInput } from './stack';
import { formatRelative } from './format';

export const WINDOWS_DEVICE_ID = 'zephyrus';

/**
 * What the laptop's logo folder may be called, most specific first.
 *
 * Two names because the laptop genuinely has two: the sidebar and the Overview
 * heading say `config.deviceLabel` ("Zephyrus G16"), while the database and
 * this file say `zephyrus`. Both are names somebody would put on a folder,
 * and accepting either costs one array.
 *
 * Exported rather than repeated at each call site: three pages resolve logos
 * for this device, and a folder that works on By App but not on the Overview
 * would be a genuinely baffling bug to chase.
 */
export function windowsLogoScope(): string[] {
  return [deviceLabel(), WINDOWS_DEVICE_ID];
}

/**
 * Open read-only, per request.
 *
 * Not pooled: the ingest writes to this file on a schedule, and holding a
 * long-lived handle across a WAL checkpoint is how you end up serving stale
 * pages. Opening costs well under a millisecond.
 */
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

/** True when there is a database with at least one recorded segment. */
/** A resolved app, with the user's rename applied and the name it had before. */
type Named = ResolvedApp & { base: string };

/**
 * `resolveApp`, with the user's renames (lib/app-renames.ts) applied. Every
 * query below that shows an app name goes through this, so a rename reaches
 * tables, charts, legends, callouts and the page title from one place.
 * `base` is kept because the logo, plate and colour stay keyed by it unless
 * a logo matches the new name -- see `lookName()`.
 */
function resolver(db: DatabaseSync): (path: string) => Named {
  const renames = readRenames(db, WINDOWS_DEVICE_ID);
  return (path) => {
    const r = resolveApp(path);
    return { ...r, base: r.name, name: renames.get(r.key) ?? r.name };
  };
}

export function hasWindowsData(): boolean {
  if (!databaseExists()) return false;
  try {
    return withDb((db) => {
      const r = db
        .prepare('SELECT COUNT(*) AS n FROM windows_segments WHERE device_id = ?')
        .get(WINDOWS_DEVICE_ID) as { n: number };
      return r.n > 0;
    });
  } catch {
    return false;
  }
}

export interface Scope {
  /** Window length in days, counted back from the newest recorded day. */
  days: number;
}

/**
 * The newest local_date with a RECORDING, which anchors every range.
 *
 * 'gap' rows are left out here, in the day count and in the daily series. A
 * gap is the absence of a measurement: the sampler writes one across a sleep
 * and, since it learned to recover after a logoff, across a shutdown too. A
 * laptop left off for three days therefore leaves three days holding nothing
 * BUT gap -- and counting those as "days with data" would divide the average
 * by days nobody used the machine and draw them as recorded quiet days.
 */
function latestDate(db: DatabaseSync): string | null {
  const r = db
    .prepare(`SELECT MAX(local_date) AS d FROM windows_segments WHERE device_id = ? AND kind <> 'gap'`)
    .get(WINDOWS_DEVICE_ID) as { d: string | null };
  return r.d;
}

/**
 * Ranges are anchored on the newest DAY WITH DATA, not on today.
 *
 * If the laptop was off for a week, anchoring on today would show seven empty
 * columns and a headline of zero -- which reads as "the collector is broken"
 * rather than "you were away".
 */
function rangeStart(db: DatabaseSync, days: number): string {
  const latest = latestDate(db) ?? new Date().toLocaleDateString('en-CA');
  const d = new Date(latest + 'T00:00:00');
  d.setDate(d.getDate() - (days - 1));
  return d.toLocaleDateString('en-CA');
}

export interface KindTotals {
  active: number;
  locked: number;
  gap: number;
  unknown: number;
}

export interface Overview {
  latestDate: string | null;
  /** Active time on the newest day with data. */
  today: number;
  /** Mean active time per day that has any recording at all. */
  dailyAverage: number;
  /** Active time across the whole scope. */
  rangeTotal: number;
  daysWithData: number;
  kinds: KindTotals;
  /** How much of the scope the sampler could not attribute. */
  unknownShare: number;
}

function emptyKinds(): KindTotals {
  return { active: 0, locked: 0, gap: 0, unknown: 0 };
}

export function getOverview(scope: Scope): Overview {
  return withDb((db) => {
    const latest = latestDate(db);
    if (!latest) {
      return {
        latestDate: null, today: 0, dailyAverage: 0, rangeTotal: 0,
        daysWithData: 0, kinds: emptyKinds(), unknownShare: 0,
      };
    }
    const from = rangeStart(db, scope.days);

    const kinds = emptyKinds();
    const rows = db
      .prepare(
        `SELECT kind, SUM(duration_ms) AS ms
           FROM windows_segments
          WHERE device_id = ? AND local_date >= ? AND local_date <= ?
          GROUP BY kind`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as { kind: string; ms: number }[];
    for (const r of rows) {
      if (r.kind === 'app') kinds.active += r.ms;
      else if (r.kind === 'locked') kinds.locked += r.ms;
      else if (r.kind === 'gap') kinds.gap += r.ms;
      else kinds.unknown += r.ms;
    }

    const today = db
      .prepare(
        `SELECT COALESCE(SUM(duration_ms), 0) AS ms
           FROM windows_segments
          WHERE device_id = ? AND local_date = ? AND kind = 'app'`,
      )
      .get(WINDOWS_DEVICE_ID, latest) as { ms: number };

    // Averaged over days that have ANY recording, not over the scope length.
    // Dividing by 30 when the sampler has run for two of them reports a
    // fifteenth of the real figure and looks like a collapse in usage.
    const days = db
      .prepare(
        `SELECT COUNT(DISTINCT local_date) AS n
           FROM windows_segments
          WHERE device_id = ? AND kind <> 'gap' AND local_date >= ? AND local_date <= ?`,
      )
      .get(WINDOWS_DEVICE_ID, from, latest) as { n: number };

    const tracked = kinds.active + kinds.locked + kinds.unknown;
    return {
      latestDate: latest,
      today: today.ms,
      rangeTotal: kinds.active,
      daysWithData: days.n,
      dailyAverage: days.n > 0 ? Math.round(kinds.active / days.n) : 0,
      kinds,
      unknownShare: tracked > 0 ? (kinds.unknown / tracked) * 100 : 0,
    };
  });
}

/**
 * Every session in the window, across EVERY app, keyed by RESOLVED app.
 *
 * Global ordering matters: visits are stitched by adjacency, so looking at one
 * app's rows alone cannot distinguish "came back after using something else"
 * from "the sampler split one stretch on a focus blip". See visits.ts, rule 1.
 */
function allSessions(db: DatabaseSync, from: string, to: string): RawSession[] {
  const rows = db
    .prepare(
      `SELECT app_path, session_start_utc AS s, MAX(end_utc) AS e
         FROM windows_segments
        WHERE device_id = ? AND kind = 'app'
          AND local_date >= ? AND local_date <= ?
        GROUP BY app_path, session_start_utc`,
    )
    .all(WINDOWS_DEVICE_ID, from, to) as { app_path: string; s: string; e: string }[];
  return rows.map((r) => ({
    app: resolveApp(r.app_path).key,
    start: Date.parse(r.s),
    end: Date.parse(r.e),
  }));
}

export interface AppRow {
  key: string;
  name: string;
  /** The name without the user's rename; equal to `name` when there is none. */
  baseName: string;
  system: boolean;
  ms: number;
  sessions: number;
  days: number;
  share: number;
}

/**
 * Per-app totals for the scope, grouped by RESOLVED key.
 *
 * Grouping happens in JS rather than SQL because the resolution rules live in
 * `app-name.ts` and must stay changeable without re-ingesting -- which is the
 * whole reason display names are not stored.
 */
export function getApps(scope: Scope): AppRow[] {
  return withDb((db) => {
    const latest = latestDate(db);
    if (!latest) return [];
    const from = rangeStart(db, scope.days);

    const rows = db
      .prepare(
        `SELECT app_path,
                SUM(duration_ms) AS ms,
                COUNT(DISTINCT session_start_utc) AS sessions,
                COUNT(DISTINCT local_date) AS days
           FROM windows_segments
          WHERE device_id = ? AND kind = 'app'
            AND local_date >= ? AND local_date <= ?
          GROUP BY app_path`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as
      { app_path: string; ms: number; sessions: number; days: number }[];

    // "Opens" counts VISITS, not raw spans: the sampler ends a span on every
    // focus change, so alt-tabbing away and back is three spans of one app.
    const opens = visitCounts(stitchVisits(allSessions(db, from, latest)));

    const merged = new Map<string, AppRow>();
    const resolve = resolver(db);
    for (const r of rows) {
      const app = resolve(r.app_path);
      const e = merged.get(app.key) ?? {
        key: app.key, name: app.name, baseName: app.base, system: app.system,
        ms: 0, sessions: 0, days: 0, share: 0,
      };
      e.ms += r.ms;
      // Distinct days cannot be summed across paths without double counting;
      // the max is the honest lower bound and never exceeds the real figure.
      e.days = Math.max(e.days, r.days);
      merged.set(app.key, e);
    }

    const list = [...merged.values()].sort((a, b) => b.ms - a.ms);
    const total = list.reduce((a, r) => a + r.ms, 0);
    for (const r of list) {
      r.share = total > 0 ? (r.ms / total) * 100 : 0;
      r.sessions = opens.get(r.key) ?? 0;
    }
    return list;
  });
}

export interface DayPoint {
  date: string;
  active: number;
  locked: number;
  unknown: number;
}

/** Active time per local day, for the trend chart. */
export function getDaily(scope: Scope): DayPoint[] {
  return withDb((db) => {
    const latest = latestDate(db);
    if (!latest) return [];
    const from = rangeStart(db, scope.days);

    const rows = db
      .prepare(
        `SELECT local_date, kind, SUM(duration_ms) AS ms
           FROM windows_segments
          WHERE device_id = ? AND kind <> 'gap' AND local_date >= ? AND local_date <= ?
          GROUP BY local_date, kind
          ORDER BY local_date`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as
      { local_date: string; kind: string; ms: number }[];

    const byDate = new Map<string, DayPoint>();
    for (const r of rows) {
      const e = byDate.get(r.local_date) ?? {
        date: r.local_date, active: 0, locked: 0, unknown: 0,
      };
      if (r.kind === 'app') e.active += r.ms;
      else if (r.kind === 'locked') e.locked += r.ms;
      else if (r.kind === 'unknown') e.unknown += r.ms;
      // 'gap' is deliberately not charted, and filtered out above so that a
      // day holding nothing but gap is NOT a point: it is the absence of a
      // measurement, not a quantity, and becomes a "Not recorded" day.
      byDate.set(r.local_date, e);
    }
    return [...byDate.values()];
  });
}

export interface HourPoint {
  hour: number;
  ms: number;
}

/**
 * Active time by hour of day, summed across the scope.
 *
 * This is the chart the hour-splitting at ingest exists for. Bucketing a
 * session on its START hour instead would file a three-hour evening entirely
 * under 19:00 and leave 20:00 and 21:00 empty.
 */
export function getHourly(scope: Scope): HourPoint[] {
  return withDb((db) => {
    const latest = latestDate(db);
    if (!latest) return [];
    const from = rangeStart(db, scope.days);

    const rows = db
      .prepare(
        `SELECT local_hour AS hour, SUM(duration_ms) AS ms
           FROM windows_segments
          WHERE device_id = ? AND kind = 'app'
            AND local_date >= ? AND local_date <= ?
          GROUP BY local_hour`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as { hour: number; ms: number }[];

    const map = new Map(rows.map((r) => [r.hour, r.ms]));
    // Always 24 points, so the chart's shape is comparable between ranges and
    // an empty hour reads as empty rather than as missing.
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, ms: map.get(h) ?? 0 }));
  });
}

export interface DailyByApp {
  /** Time per local day per resolved app. */
  time: StackInput[];
  /** Opens (visits) per local day per resolved app, filed where each BEGAN. */
  opens: StackInput[];
  /** Resolved key -> display name (rename applied) and base name, for every id above. */
  names: Map<string, { name: string; base: string }>;
}

/**
 * Per-app, per-day time and opens, for the Overview's two stacked charts.
 *
 * Time is summed per local day and RESOLVED app, so a versioned WindowsApps
 * folder is one band, as it is one row on By App. Opens are visits, bucketed
 * exactly as the app detail page buckets them -- see `opensByDay()`.
 */
export function getDailyByApp(scope: Scope): DailyByApp {
  return withDb((db) => {
    const names = new Map<string, { name: string; base: string }>();
    const latest = latestDate(db);
    if (!latest) return { time: [], opens: [], names };
    const resolve = resolver(db);
    const from = rangeStart(db, scope.days);

    const rows = db
      .prepare(
        `SELECT local_date AS d, app_path, SUM(duration_ms) AS ms
           FROM windows_segments
          WHERE device_id = ? AND kind = 'app'
            AND local_date >= ? AND local_date <= ?
          GROUP BY local_date, app_path`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as { d: string; app_path: string; ms: number }[];

    const time: StackInput[] = [];
    for (const r of rows) {
      const app = resolve(r.app_path);
      names.set(app.key, { name: app.name, base: app.base });
      time.push({ date: r.d, id: app.key, value: r.ms });
    }

    // Where each session started, read off its FIRST row -- the one whose own
    // start is the session's. See getAppDetail() for why the stored local
    // date is used rather than recomputed.
    const starts = db
      .prepare(
        `SELECT session_start_utc AS s, local_date AS d
           FROM windows_segments
          WHERE device_id = ? AND kind = 'app' AND start_utc = session_start_utc
            AND local_date >= ? AND local_date <= ?`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as { s: string; d: string }[];
    const bucketOf = new Map<number, SessionBucket>(
      starts.map((r) => [Date.parse(r.s), { date: r.d, hour: 0 }]),
    );
    const opens = opensByDay(stitchVisits(allSessions(db, from, latest)), bucketOf);
    return { time, opens, names };
  });
}

/**
 * When the database last took delivery of anything for a device, UTC ISO.
 *
 * The newest SUCCESSFUL run, never merely the newest. A failed run collected
 * nothing, and stamping the page with its timestamp would claim the numbers
 * are fresh at the exact moment they stopped being -- the one lie a
 * freshness line must not tell.
 *
 * Serves both platforms: the laptop's ingest folds the sampler's JSONL in, the
 * phone pushes. Either way this is the last moment the stored rows moved.
 */
export function lastCollectedAt(deviceId: string): string | null {
  if (!databaseExists()) return null;
  try {
    return withDb((db) => {
      const row = db
        .prepare(
          `SELECT finished_at FROM sync_log
            WHERE device_id = ? AND status = 'success' AND finished_at IS NOT NULL
            ORDER BY id DESC LIMIT 1`,
        )
        .get(deviceId) as { finished_at: string } | undefined;
      return row?.finished_at ?? null;
    });
  } catch {
    return null;
  }
}

/**
 * "collected 2h ago", or null when nothing has ever been collected.
 *
 * Computed at render, which every dashboard page being `force-dynamic` makes
 * honest: a page left open overnight is re-rendered before it is re-read.
 */
export function collectedAgo(deviceId: string): string | null {
  const iso = lastCollectedAt(deviceId);
  if (!iso) return null;
  const then = Date.parse(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  if (!Number.isFinite(then)) return null;
  return formatRelative(Math.max(0, Date.now() - then) / 3_600_000);
}

/** How many runs the history holds, for the pager. Same `deviceId` rule as getSyncRuns. */
export function countSyncRuns(deviceId?: string): number {
  if (!databaseExists()) return 0;
  try {
    return withDb((db) => {
      const r = (deviceId
        ? db.prepare('SELECT COUNT(*) AS n FROM sync_log WHERE device_id = ?').get(deviceId)
        : db.prepare('SELECT COUNT(*) AS n FROM sync_log').get()) as { n: number };
      return Number(r.n);
    });
  } catch {
    return 0;
  }
}

export interface SyncRun {
  id: number;
  deviceId: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsInserted: number;
  rowsSkipped: number;
  backupStatus: string | null;
  durationMs: number | null;
  error: string | null;
}

/**
 * One page of the run history, newest first.
 *
 * `deviceId` narrows it to one device's runs -- in SQL, not afterwards: a
 * phone's page used to take the newest 60 runs across every device and
 * filter them, so a busy laptop could push a phone's own syncs off its page.
 */
export function getSyncRuns(
  { limit = 25, offset = 0, deviceId }: { limit?: number; offset?: number; deviceId?: string } = {},
): SyncRun[] {
  if (!databaseExists()) return [];
  try {
    const where = deviceId ? 'WHERE device_id = ?' : '';
    const args = deviceId ? [deviceId, limit, offset] : [limit, offset];
    return withDb((db) =>
      (db
        .prepare(
          `SELECT id, device_id, source, started_at, finished_at, status,
                  rows_inserted, rows_skipped, backup_status, duration_ms, error
             FROM sync_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args) as Record<string, never>[]).map((r) => ({
        id: r['id'] as unknown as number,
        deviceId: r['device_id'] as unknown as string,
        source: r['source'] as unknown as string,
        startedAt: r['started_at'] as unknown as string,
        finishedAt: r['finished_at'] as unknown as string | null,
        status: r['status'] as unknown as string,
        rowsInserted: r['rows_inserted'] as unknown as number,
        rowsSkipped: r['rows_skipped'] as unknown as number,
        backupStatus: r['backup_status'] as unknown as string | null,
        durationMs: r['duration_ms'] as unknown as number | null,
        error: r['error'] as unknown as string | null,
      })),
    );
  } catch {
    return [];
  }
}

/**
 * Android devices that have reported, for the sidebar.
 *
 * ⚠️ The rows are REBUILT as plain objects rather than returned as they come
 * back from the driver.
 *
 * `node:sqlite` hands back objects with a NULL PROTOTYPE, and this list is
 * passed from the `(dash)` server layout into `Shell`, which is a client
 * component. React refuses to serialise those across the boundary:
 *
 *   Only plain objects, and a few built-ins, can be passed to Client
 *   Components from Server Components.
 *
 * The bug was latent for as long as no phone had reported, because an empty
 * array serialises fine. It appeared the moment real data existed -- which is
 * the worst kind, since it passes every check until the feature actually works.
 * Anything else that sends driver rows to a client component needs the same
 * treatment.
 */
export function getAndroidDevices(): { slug: string; label: string }[] {
  if (!databaseExists()) return [];
  try {
    return withDb((db) => {
      const rows = db
        // In the order the phones first reported, so a new phone joins the
        // END of the sidebar instead of shuffling the others. Alphabetical
        // put "Redmi 5 Plus" above "Redmi Note 9 Pro", which was added first.
        .prepare('SELECT slug, label FROM android_devices ORDER BY first_seen_utc, label')
        .all() as { slug: string; label: string }[];
      return rows.map((r) => ({ slug: String(r.slug), label: String(r.label) }));
    });
  } catch {
    return [];
  }
}

// getSamplerStatus lives in ./sampler-status so it can be unit-tested: this
// module is `server-only` and therefore unimportable from `npm run selftest`.
export { getSamplerStatus, type SamplerStatus } from './sampler-status';

/* ------------------------------------------------------------------ */
/* App detail                                                          */
/* ------------------------------------------------------------------ */

export interface AppIdentity {
  path: string;
  ms: number;
}

export interface AppDetail {
  key: string;
  name: string;
  /** The name without the user's rename; equal to `name` when there is none. */
  baseName: string;
  system: boolean;
  ms: number;
  sessions: number;
  days: number;
  share: number;
  longestSessionMs: number;
  medianSessionMs: number;
  daily: { date: string; active: number }[];
  hourly: { hour: number; ms: number }[];
  /**
   * The same two shapes, counted in OPENS instead of milliseconds.
   *
   * Opens are visits, not raw spans -- see visits.ts. The sampler ends a span
   * on every focus change, so alt-tabbing away to check something and back is
   * three spans of one app and would be three "opens" here.
   *
   * A visit is filed under the day and hour it BEGAN, so an app opened at
   * 23:50 and used past midnight counts once, last night. Time is split across
   * the boundary because time genuinely was spent on both sides; an open
   * happened at one instant, and splitting it would invent an opening that
   * never occurred.
   */
  dailyOpens: { date: string; opens: number }[];
  hourlyOpens: { hour: number; opens: number }[];
  /**
   * The raw identities that resolved into this app.
   *
   * Shown so a merge is never SILENT. `app-name.ts` folds every versioned
   * WindowsApps folder into one entry, which is right, but a reader looking at
   * "Claude" deserves to see that it came from a path with a version number in
   * it -- otherwise the day a merge is wrong there is nothing to notice.
   */
  identities: AppIdentity[];
}

/**
 * Does this app earn a page of its own?
 *
 * The sibling project gates on bytes; the equivalent here is that a page shows
 * behaviour OVER TIME, so the question is whether there is a shape to look at.
 * Under a minute in total is a stray focus event, and its page would be one
 * bar. Anything above that gets in.
 */
export function earnsDetailPage(ms: number): boolean {
  return ms >= 60_000;
}

export function getAppDetail(scope: Scope, key: string): AppDetail | null {
  return withDb((db) => {
    const latest = latestDate(db);
    if (!latest) return null;
    const from = rangeStart(db, scope.days);

    // Pull every app-kind row in range and keep the ones resolving to `key`.
    // Resolution lives in code, so it cannot be a WHERE clause -- the same
    // reason display names are never stored.
    const rows = db
      .prepare(
        `SELECT app_path, session_start_utc, start_utc,
                local_date, local_hour, duration_ms
           FROM windows_segments
          WHERE device_id = ? AND kind = 'app'
            AND local_date >= ? AND local_date <= ?`,
      )
      .all(WINDOWS_DEVICE_ID, from, latest) as {
      app_path: string; session_start_utc: string; start_utc: string;
      local_date: string; local_hour: number; duration_ms: number;
    }[];

    let name = '';
    let baseName = '';
    let system = false;
    let ms = 0;
    const byDate = new Map<string, number>();
    const byHour = new Map<number, number>();
    const byIdentity = new Map<string, number>();
    const dates = new Set<string>();

    // Where each SESSION started, in machine-local terms. A span that crosses
    // an hour boundary is stored as several rows, and only the first carries
    // the session's own start -- hence matching on `start_utc` rather than
    // merely belonging to the session. The local buckets are read back off the
    // row rather than recomputed from the UTC stamp: they were written at
    // ingest, and recomputing them here would quietly re-date every open if
    // this process ever ran under a different offset than the sampler did.
    const sessionBucket = new Map<number, SessionBucket>();

    const resolve = resolver(db);
    for (const r of rows) {
      const app = resolve(r.app_path);
      if (app.key !== key) continue;
      name = app.name;
      baseName = app.base;
      system = app.system;
      ms += r.duration_ms;
      dates.add(r.local_date);
      byDate.set(r.local_date, (byDate.get(r.local_date) ?? 0) + r.duration_ms);
      byHour.set(r.local_hour, (byHour.get(r.local_hour) ?? 0) + r.duration_ms);
      byIdentity.set(r.app_path, (byIdentity.get(r.app_path) ?? 0) + r.duration_ms);
      if (r.start_utc === r.session_start_utc) {
        sessionBucket.set(Date.parse(r.session_start_utc), {
          date: r.local_date, hour: r.local_hour,
        });
      }
    }

    if (!name) return null;

    // Visits, not raw spans. See visits.ts.
    const visits = stitchVisits(allSessions(db, from, latest));
    const stats = visitStats(visits, key);
    const total = rows.reduce((a, r) => a + r.duration_ms, 0);

    // An open is an instant, not a span: filed under the day and hour the
    // visit BEGAN. See openBuckets() for why that differs from how the same
    // visit's time is bucketed.
    const opens = openBuckets(visits, key, sessionBucket);

    return {
      key,
      name,
      baseName,
      system,
      ms,
      sessions: stats.visits,
      days: dates.size,
      share: total > 0 ? (ms / total) * 100 : 0,
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
      identities: [...byIdentity.entries()]
        .map(([path, v]) => ({ path, ms: v }))
        .sort((a, b) => b.ms - a.ms),
    };
  });
}

/** Does this app exist at all, ignoring the current range? */
export function appExists(key: string): boolean {
  return appNameForKey(key) !== null;
}

/**
 * The display name behind an app key, or null when nothing recorded has it.
 *
 * For the page title, which needs the name without the cost of the whole
 * detail query. Resolved in code, like everywhere else -- names are never
 * stored.
 */
export function appNameForKey(key: string): string | null {
  if (!databaseExists()) return null;
  try {
    return withDb((db) => {
      const rows = db
        .prepare(
          `SELECT DISTINCT app_path FROM windows_segments
            WHERE device_id = ? AND kind = 'app'`,
        )
        .all(WINDOWS_DEVICE_ID) as { app_path: string }[];
      const resolve = resolver(db);
      for (const r of rows) {
        const app = resolve(r.app_path);
        if (app.key === key) return app.name;
      }
      return null;
    });
  } catch {
    return null;
  }
}

/**
 * Every app the laptop has ever recorded, as shown now and as resolved, keyed
 * by resolved key. What a rename is checked against: a new name must not be
 * one another app already shows, across ALL history rather than the range on
 * screen, or widening the range would reveal two apps with one name.
 */
export function getWindowsAppNames(): AppNames {
  const out: AppNames = new Map();
  if (!databaseExists()) return out;
  return withDb((db) => {
    const rows = db
      .prepare(
        `SELECT DISTINCT app_path FROM windows_segments
          WHERE device_id = ? AND kind = 'app'`,
      )
      .all(WINDOWS_DEVICE_ID) as { app_path: string }[];
    const resolve = resolver(db);
    for (const r of rows) {
      const app = resolve(r.app_path);
      out.set(app.key, { name: app.name, base: app.base });
    }
    return out;
  });
}

/** Resolved key -> the colour the user chose for it (lib/app-colour-overrides.ts). */
export function getWindowsColourOverrides(): Map<string, string> {
  if (!databaseExists()) return new Map();
  try {
    return withDb((db) => readColourOverrides(db, WINDOWS_DEVICE_ID));
  } catch {
    return new Map();
  }
}

/**
 * The display name for one raw identity, rename applied. For the Sync page's
 * "currently in", which names the sampler's in-flight app outside any query.
 */
export function windowsDisplayName(path: string): string {
  const r = resolveApp(path);
  if (!databaseExists()) return r.name;
  try {
    return withDb((db) => readRenames(db, WINDOWS_DEVICE_ID).get(r.key) ?? r.name);
  } catch {
    return r.name;
  }
}
