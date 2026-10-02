/**
 * Fold the sampler's JSONL into SQLite.
 *
 * The sampler is a long-lived process and deliberately does NOT write to the
 * database: holding a SQLite handle open for weeks across WAL checkpoints is
 * how a dashboard ends up serving stale pages. It appends spans to a daily
 * JSONL file; this folds them in.
 *
 * Idempotent. A completed span is immutable -- it is bounded by a focus change
 * that already happened -- so re-running over the same files inserts zero rows.
 * That is the INSERT OR IGNORE case; do not copy it to the Android daily
 * rollup, whose buckets keep filling and need MAX().
 *
 * ---------------------------------------------------------------------------
 * This lives in `lib/` rather than in the script because it has TWO callers:
 * the scheduled task (`scripts/ingest-windows.ts`, hourly) and the Sync now
 * button (`POST /api/ingest`). It is the mirror of `android-ingest.ts`, which
 * has sat behind its own route since Phase 2.
 *
 * It returns its result rather than printing it. The script prints; the route
 * turns the same object into a sentence for a toast. A function that logs to
 * stdout is a function only one of those two can use.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  openDatabase, checkpointWal, backupDatabase, startSyncRun, finishSyncRun,
} from '@/lib/db';
import { nativeSource, type NativeSource } from '@/lib/config';

const HOUR_MS = 3_600_000;

export interface Span {
  start: string;
  end: string;
  ms: number;
  kind: string;
  app: string;
  idle_ms?: number;
  unresolved?: boolean;
}

interface Config {
  deviceLabel?: string;
  databasePath?: string;
  backupPath?: string;
  scratchDir?: string;
  samplerLogDir?: string;
  nativeDatabasePath?: string;
  nativeFrom?: string;
  nativeSamplerDir?: string;
  backupEnabled?: boolean;
}

export interface WindowsIngestResult {
  /** Set when there was nothing to read at all; every count is then zero. */
  note?: string;
  /** The sampler's JSONL, or Screen Time Native's database. */
  source: 'jsonl' | 'native';
  files: number;
  read: number;
  inserted: number;
  skipped: number;
  malformed: number;
  /** JSONL day files pruned after the run. */
  removed: number;
  /** Rows past the seam that Screen Time Native did not record: the other sampler's. */
  replaced: number;
  oldest: string | null;
  newest: string | null;
  backupStatus: string | null;
  durationMs: number;
  totals: { kind: string; n: number; ms: number }[];
}

function loadConfig(): Config {
  const file = join(process.cwd(), 'config', 'collector.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    // The file is local-only, so a fresh clone has just the example. Say so,
    // rather than surfacing ENOENT in a toast.
    throw new Error(
      'config/collector.json not found -- copy config/collector.example.json to it and set your paths',
    );
  }
  return JSON.parse(raw) as Config;
}

function logDir(cfg: Config): string {
  if (cfg.samplerLogDir) return cfg.samplerLogDir;
  if (cfg.scratchDir) return join(cfg.scratchDir, 'sampler');
  throw new Error('No samplerLogDir or scratchDir in config/collector.json');
}

/**
 * Local-time buckets for an instant.
 *
 * Computed from LOCAL time, never UTC. Grouping raw UTC into days shifts every
 * daily total by the offset (6h here), which puts an evening's use on the
 * wrong day -- and unlike a byte count, a reader notices that immediately.
 */
function localBuckets(t: number): { date: string; hour: number } {
  const d = new Date(t);
  const date =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`;
  return { date, hour: d.getHours() };
}

/** The next local hour boundary strictly after `t`. */
function nextHourBoundary(t: number): number {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime() + HOUR_MS;
}

/**
 * Split a span at local hour boundaries.
 *
 * DST is why this walks boundaries rather than adding 3,600,000 repeatedly: on
 * a transition an hour is 0 or 2 real hours long, and arithmetic on the epoch
 * would drift the buckets for the rest of the day. This machine does not
 * observe DST, which is exactly the sort of local fact that stops being true
 * when the code is reused.
 */
export function splitIntoHours(
  startMs: number,
  endMs: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cur = startMs;
  // A pathological span (clock change, corrupt line) must not spin forever.
  let guard = 0;
  while (cur < endMs && guard++ < 100_000) {
    const boundary = Math.min(nextHourBoundary(cur), endMs);
    out.push({ start: cur, end: boundary });
    cur = boundary;
  }
  return out;
}

function empty(note: string, source: WindowsIngestResult['source'] = 'jsonl'): WindowsIngestResult {
  return {
    note, source,
    files: 0, read: 0, inserted: 0, skipped: 0, malformed: 0, removed: 0, replaced: 0,
    oldest: null, newest: null, backupStatus: null, durationMs: 0, totals: [],
  };
}

/** The laptop's device id. There is one laptop, so it is a constant. */
const DEVICE_ID = 'zephyrus';

/**
 * In-flight run, if any.
 *
 * The hourly task and the Sync now button can land together, and a second
 * concurrent pass would do nothing useful: the spans are the same and
 * INSERT OR IGNORE would skip every one, while `sync_log` collected a
 * meaningless second run. Sharing the in-flight promise means a press during a
 * run reports that run's result rather than starting a duplicate.
 *
 * This only guards THIS process. The scheduled task is a separate one, and
 * that is fine -- SQLite serialises the writes and the operation is idempotent
 * by construction. The guard is about tidiness, not correctness.
 */
let inFlight: Promise<WindowsIngestResult> | null = null;

/**
 * The one insert every Windows span goes through -- the ingest, and the demo
 * seeder, which must not drift from it.
 */
export const SEGMENT_INSERT_SQL =
  `INSERT OR IGNORE INTO windows_segments
     (device_id, session_start_utc, start_utc, end_utc, duration_ms,
      local_date, local_hour, kind, app_path, unresolved, idle_ms_at_end)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** A span as rows for SEGMENT_INSERT_SQL: one per local clock hour it covers. */
export function segmentRows(deviceId: string, span: Span): (string | number)[][] {
  const startMs = Date.parse(span.start);
  const endMs = Date.parse(span.end);
  return splitIntoHours(startMs, endMs).map((seg) => {
    const { date, hour } = localBuckets(seg.start);
    return [
      deviceId, span.start,
      new Date(seg.start).toISOString(), new Date(seg.end).toISOString(),
      seg.end - seg.start, date, hour,
      span.kind, span.app ?? '', span.unresolved ? 1 : 0, span.idle_ms ?? 0,
    ];
  });
}

export function ingestWindows(opts: { keep?: boolean } = {}): Promise<WindowsIngestResult> {
  if (inFlight) return inFlight;
  inFlight = runIngest(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function runIngest({ keep = false }: { keep?: boolean }): Promise<WindowsIngestResult> {
  const cfg = loadConfig();
  if (!cfg.databasePath) throw new Error('No databasePath in config/collector.json');

  const native = nativeSource(cfg);
  if (native) return runNativeIngest(cfg, cfg.databasePath, native);

  const dir = logDir(cfg);
  if (!existsSync(dir)) return empty(`No sampler output at ${dir}`);

  const files = readdirSync(dir)
    .filter((f) => /^sessions-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort();

  if (files.length === 0) return empty(`No session files in ${dir}`);

  // The file for TODAY is still being appended to by a running sampler.
  // Ingest it (the spans in it are complete) but never delete it.
  const todayFile = `sessions-${localBuckets(Date.now()).date}.jsonl`;

  const db = openDatabase(cfg.databasePath);
  const deviceId = DEVICE_ID;
  const runId = startSyncRun(db, deviceId, 'win-sampler');
  const began = Date.now();

  const insert = db.prepare(SEGMENT_INSERT_SQL);

  let read = 0;
  let inserted = 0;
  let skipped = 0;
  let malformed = 0;
  let oldest: string | null = null;
  let newest: string | null = null;

  db.exec('BEGIN');
  try {
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let span: Span;
        try {
          span = JSON.parse(line) as Span;
        } catch {
          // A torn last line is expected if the sampler was killed mid-write.
          // Count it and move on rather than failing the whole run.
          malformed++;
          continue;
        }
        read++;

        const startMs = Date.parse(span.start);
        const endMs = Date.parse(span.end);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          malformed++;
          continue;
        }

        if (oldest === null || span.start < oldest) oldest = span.start;
        if (newest === null || span.end > newest) newest = span.end;

        for (const row of segmentRows(deviceId, span)) {
          const r = insert.run(...row);
          if (r.changes > 0) inserted++;
          else skipped++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    finishSyncRun(db, runId, {
      status: 'failed',
      rowsRead: read, rowsInserted: 0, rowsSkipped: 0,
      sourceOldestUtc: oldest, sourceNewestUtc: newest,
      backupStatus: null, durationMs: Date.now() - began,
      error: err instanceof Error ? err.message : String(err),
    });
    db.close();
    throw err;
  }

  const result = await finishRun(db, runId, cfg, began, {
    source: 'jsonl', files: files.length,
    read, inserted, skipped, malformed, removed: 0, replaced: 0, oldest, newest,
  });

  // Only remove files that can no longer be appended to. The sampler holds
  // today's file open for more spans; deleting it would lose the rest of today.
  if (!keep) {
    for (const file of files) {
      if (file === todayFile) continue;
      try { unlinkSync(join(dir, file)); result.removed++; } catch { /* keep going */ }
    }
  }
  return result;
}

type RunCounts = Omit<WindowsIngestResult, 'note' | 'backupStatus' | 'durationMs' | 'totals'>;

/**
 * The tail every successful run shares: checkpoint, backup, the run's row in
 * `sync_log`, and the stored totals. Closes the database.
 */
async function finishRun(
  db: DatabaseSync, runId: number, cfg: Config, began: number, counts: RunCounts,
): Promise<WindowsIngestResult> {
  checkpointWal(db);

  // AWAITED, not fire-and-forget. An un-awaited promise here would leave
  // backupStatus null in the sync_log row every single run -- so the one
  // column whose job is to tell you the Drive copy failed would always say
  // nothing, which is worse than not having it.
  let backupStatus: string | null = null;
  if (cfg.backupEnabled && cfg.backupPath) {
    backupStatus = await backupDatabase(db, cfg.backupPath);
  }

  finishSyncRun(db, runId, {
    status: 'success',
    rowsRead: counts.read, rowsInserted: counts.inserted, rowsSkipped: counts.skipped,
    sourceOldestUtc: counts.oldest, sourceNewestUtc: counts.newest,
    backupStatus, durationMs: Date.now() - began, error: null,
  });

  const totals = db
    .prepare(
      `SELECT kind, COUNT(*) AS n, SUM(duration_ms) AS ms
         FROM windows_segments WHERE device_id = ? GROUP BY kind ORDER BY ms DESC`,
    )
    .all(DEVICE_ID) as { kind: string; n: number; ms: number }[];

  db.close();

  return {
    ...counts,
    backupStatus,
    durationMs: Date.now() - began,
    // Rebuilt as plain objects: node:sqlite rows have a NULL PROTOTYPE, and
    // React refuses to serialise those across the server/client boundary. This
    // one currently only reaches a route, but the next caller may not.
    totals: totals.map((t) => ({ kind: String(t.kind), n: Number(t.n), ms: Number(t.ms) })),
  };
}

/* ------------------------------------------------- Screen Time Native -- */

/**
 * The seam as a canonical instant, or an error saying what is wrong with it.
 *
 * It must be a LOCAL HOUR EDGE. Both samplers split every span at local hour
 * edges, so at an edge neither has a row straddling it: everything before
 * belongs to one sampler and everything after to the other, with nothing cut
 * in half and no second of overlap. Anywhere else, the row in flight at the
 * seam would be in both databases under two different keys, counted twice.
 */
export function seamInstant(from: string): string {
  const t = Date.parse(from);
  if (!from || !Number.isFinite(t)) {
    throw new Error('nativeFrom in config/collector.json must be an ISO instant, e.g. 2026-10-03T02:00:00+06:00');
  }
  const d = new Date(t);
  if (d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0) {
    throw new Error(`nativeFrom (${from}) must be a local hour edge -- both samplers split their rows there, so nothing straddles it`);
  }
  return d.toISOString();
}

/** Screen Time Native's segment columns, in SEGMENT_INSERT_SQL's order after the device. */
const NATIVE_COLUMNS =
  'session_start_utc, start_utc, end_utc, duration_ms, local_date, local_hour, kind, app_path, unresolved, idle_ms_at_end';

interface NativeRow {
  session_start_utc: string;
  start_utc: string;
  end_utc: string;
  duration_ms: number;
  local_date: string;
  local_hour: number;
  kind: string;
  app_path: string;
  unresolved: number;
  idle_ms_at_end: number;
}

interface SegmentKey { session_start_utc: string; start_utc: string; kind: string; app_path: string }

const segmentKey = (r: SegmentKey) => `${r.session_start_utc}|${r.start_utc}|${r.kind}|${r.app_path}`;

/** How far back each run looks again, so a segment saved late is still caught. */
const NATIVE_LOOKBACK_MS = 24 * HOUR_MS;

export interface NativeCopy {
  read: number;
  inserted: number;
  skipped: number;
  replaced: number;
  oldest: string | null;
  newest: string | null;
}

/**
 * Copy Screen Time Native's rows from the seam on into this database, and
 * make this laptop's rows past the seam MATCH them.
 *
 * Its rows are this project's rows already: the native sampler is a port of
 * this one, writing the same columns, split at the same hour edges, with the
 * same ISO instants. Only `device_id` is missing, because that app knows one
 * machine. So the copy is INSERT OR IGNORE on the same key -- immutable
 * completed segments, exactly as from the JSONL.
 *
 * Each run re-reads a trailing day rather than everything since the seam, so
 * the cost stays flat as the history grows, and a segment the native app
 * saved late (it saves every 15 minutes, and recovers a killed run's span at
 * its next start) is still picked up.
 *
 * Within that window, a row of ours that the native database does not hold
 * is the OTHER sampler's -- the last spans the PowerShell sampler wrote past
 * the seam before it was stopped. Those are removed, which is what makes the
 * seam exact without a separate cut-over step. But only up to the end of what
 * the native app has COVERED: past that, a missing row means "not saved yet",
 * not "not the source", and is left for a later run to judge.
 *
 * Not transactional itself; the caller wraps it.
 */
export function copyFromNative(
  db: DatabaseSync, native: DatabaseSync, deviceId: string, fromIso: string,
): NativeCopy {
  const ours = db
    .prepare('SELECT MAX(start_utc) AS m FROM windows_segments WHERE device_id = ? AND start_utc >= ?')
    .get(deviceId, fromIso) as { m: string | null } | undefined;
  const lookback = ours?.m ? Date.parse(ours.m) - NATIVE_LOOKBACK_MS : -Infinity;
  const lower = lookback > Date.parse(fromIso) ? new Date(lookback).toISOString() : fromIso;

  const rows = native
    .prepare(`SELECT ${NATIVE_COLUMNS} FROM windows_segments WHERE start_utc >= ? ORDER BY start_utc`)
    .all(lower) as unknown as NativeRow[];

  const theirs = new Set<string>();
  let covered = lower;
  for (const r of rows) {
    theirs.add(segmentKey(r));
    if (r.end_utc > covered) covered = r.end_utc;
  }

  const candidates = db
    .prepare(
      `SELECT id, session_start_utc, start_utc, kind, app_path FROM windows_segments
        WHERE device_id = ? AND start_utc >= ? AND start_utc < ?`,
    )
    .all(deviceId, lower, covered) as unknown as (SegmentKey & { id: number })[];
  const remove = db.prepare('DELETE FROM windows_segments WHERE id = ?');
  let replaced = 0;
  for (const c of candidates) {
    if (!theirs.has(segmentKey(c))) replaced += Number(remove.run(c.id).changes);
  }

  const insert = db.prepare(SEGMENT_INSERT_SQL);
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const { changes } = insert.run(
      deviceId, r.session_start_utc, r.start_utc, r.end_utc, r.duration_ms,
      r.local_date, r.local_hour, r.kind, r.app_path ?? '', r.unresolved ? 1 : 0, r.idle_ms_at_end ?? 0,
    );
    if (Number(changes) > 0) inserted++;
    else skipped++;
  }

  return {
    read: rows.length, inserted, skipped, replaced,
    oldest: rows[0]?.start_utc ?? null,
    newest: rows.length > 0 ? covered : null,
  };
}

async function runNativeIngest(cfg: Config, databasePath: string, src: NativeSource): Promise<WindowsIngestResult> {
  const fromIso = seamInstant(src.from);
  if (!existsSync(src.databasePath)) return empty(`No Screen Time Native database at ${src.databasePath}`, 'native');

  // Read-only: this project never writes to the other app's database. A
  // reader beside its writer is what WAL mode is for.
  const native = new DatabaseSync(src.databasePath, { readOnly: true });
  const db = openDatabase(databasePath);
  const runId = startSyncRun(db, DEVICE_ID, 'win-sampler');
  const began = Date.now();

  let copy: NativeCopy;
  db.exec('BEGIN');
  try {
    copy = copyFromNative(db, native, DEVICE_ID, fromIso);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    finishSyncRun(db, runId, {
      status: 'failed',
      rowsRead: 0, rowsInserted: 0, rowsSkipped: 0,
      sourceOldestUtc: null, sourceNewestUtc: null,
      backupStatus: null, durationMs: Date.now() - began,
      error: err instanceof Error ? err.message : String(err),
    });
    db.close();
    native.close();
    throw err;
  }
  native.close();

  return finishRun(db, runId, cfg, began, {
    source: 'native', files: 0, malformed: 0, removed: 0, ...copy,
  });
}

/** "Added 663 spans" / "Up to date". One sentence for a toast. */
export function describeIngest(r: WindowsIngestResult): string {
  if (r.note) return `${r.note} -- nothing to ingest.`;
  if (r.source === 'native') {
    if (r.inserted === 0) return 'Up to date -- Screen Time Native has saved nothing new.';
    return `Added ${r.inserted.toLocaleString('en-US')} segment${r.inserted === 1 ? '' : 's'} from Screen Time Native.`;
  }
  if (r.inserted === 0) {
    return `Up to date -- read ${r.read} span${r.read === 1 ? '' : 's'}, nothing new.`;
  }
  const malformed = r.malformed > 0 ? `, ${r.malformed} malformed line${r.malformed === 1 ? '' : 's'} skipped` : '';
  return `Added ${r.inserted.toLocaleString('en-US')} segment${r.inserted === 1 ? '' : 's'} from ${r.read.toLocaleString('en-US')} span${r.read === 1 ? '' : 's'}${malformed}.`;
}
