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
import {
  openDatabase, checkpointWal, backupDatabase, startSyncRun, finishSyncRun,
} from '@/lib/db';

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
  backupEnabled?: boolean;
}

export interface WindowsIngestResult {
  /** Set when there was nothing to read at all; every count is then zero. */
  note?: string;
  files: number;
  read: number;
  inserted: number;
  skipped: number;
  malformed: number;
  removed: number;
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

function empty(note: string): WindowsIngestResult {
  return {
    note,
    files: 0, read: 0, inserted: 0, skipped: 0, malformed: 0, removed: 0,
    oldest: null, newest: null, backupStatus: null, durationMs: 0, totals: [],
  };
}

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
  const deviceId = 'zephyrus';
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
    rowsRead: read, rowsInserted: inserted, rowsSkipped: skipped,
    sourceOldestUtc: oldest, sourceNewestUtc: newest,
    backupStatus, durationMs: Date.now() - began, error: null,
  });

  // Only remove files that can no longer be appended to. The sampler holds
  // today's file open for more spans; deleting it would lose the rest of today.
  let removed = 0;
  if (!keep) {
    for (const file of files) {
      if (file === todayFile) continue;
      try { unlinkSync(join(dir, file)); removed++; } catch { /* keep going */ }
    }
  }

  const totals = db
    .prepare(
      `SELECT kind, COUNT(*) AS n, SUM(duration_ms) AS ms
         FROM windows_segments WHERE device_id = ? GROUP BY kind ORDER BY ms DESC`,
    )
    .all(deviceId) as { kind: string; n: number; ms: number }[];

  db.close();

  return {
    files: files.length,
    read, inserted, skipped, malformed, removed,
    oldest, newest, backupStatus,
    durationMs: Date.now() - began,
    // Rebuilt as plain objects: node:sqlite rows have a NULL PROTOTYPE, and
    // React refuses to serialise those across the server/client boundary. This
    // one currently only reaches a route, but the next caller may not.
    totals: totals.map((t) => ({ kind: String(t.kind), n: Number(t.n), ms: Number(t.ms) })),
  };
}

/** "Added 663 spans" / "Up to date". One sentence for a toast. */
export function describeIngest(r: WindowsIngestResult): string {
  if (r.note) return `${r.note} -- nothing to ingest.`;
  if (r.inserted === 0) {
    return `Up to date -- read ${r.read} span${r.read === 1 ? '' : 's'}, nothing new.`;
  }
  const malformed = r.malformed > 0 ? `, ${r.malformed} malformed line${r.malformed === 1 ? '' : 's'} skipped` : '';
  return `Added ${r.inserted.toLocaleString('en-US')} segment${r.inserted === 1 ? '' : 's'} from ${r.read.toLocaleString('en-US')} span${r.read === 1 ? '' : 's'}${malformed}.`;
}
