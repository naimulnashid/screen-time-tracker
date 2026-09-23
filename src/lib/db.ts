/**
 * Database access.
 *
 * Uses node:sqlite -- Node's BUILT-IN SQLite (22.5+), not better-sqlite3.
 * Deliberate, and for the same reason as in the sibling project: the collector
 * must still run after a Windows reset and a clean `npm install` years from
 * now, and a native module with a node-gyp build step is the most likely thing
 * to break in that scenario. node:sqlite also gives us backup(), which is how
 * the Google Drive copy stays internally consistent.
 */

import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// Extensionless, not './schema.js'. This module is reached from Next route
// handlers as well as from the tsx scripts, and webpack cannot resolve the .js
// specifier against a .ts file. tsconfig uses moduleResolution 'bundler', so
// extensionless works for tsc and tsx too.
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export interface CollectorConfig {
  /** What the laptop is called in the dashboard. */
  deviceLabel: string;

  databasePath: string;
  backupPath: string;
  scratchDir: string;

  /**
   * Where the foreground sampler appends its JSONL and heartbeat.
   *
   * Deliberately on the same non-system drive as the database. Between
   * ingests this file is the ONLY copy of that day's screen time, so putting
   * it on C:\ would leave a day's history exposed to exactly the reset this
   * project exists to survive.
   */
  samplerLogDir: string;

  backupEnabled: boolean;
}

/**
 * Guard the one rule the whole project exists to enforce.
 *
 * A database under C:\ is destroyed by the Windows reset this tool is meant to
 * survive. Failing loudly at startup beats discovering it after a reset.
 */
export function assertNotOnSystemDrive(dbPath: string): void {
  const abs = resolve(dbPath);
  const systemDrive = (process.env['SystemDrive'] ?? 'C:').toUpperCase();
  if (abs.toUpperCase().startsWith(systemDrive + '\\')) {
    throw new Error(
      `Refusing to use a database on the system drive: ${abs}\n` +
        `It would be destroyed by a Windows reset, which is the exact failure ` +
        `this project exists to prevent.\n` +
        `Point databasePath in config/collector.json at another drive.`,
    );
  }
}

export interface OpenOptions {
  /**
   * Skip the system-drive guard.
   *
   * ONLY for the self-test, which uses a throwaway database in TEMP. The
   * collector must never set this: a real database on C:\ silently defeats the
   * entire point of the project, and the failure is invisible until a reset
   * has already destroyed the history.
   */
  allowSystemDrive?: boolean;
}

export function openDatabase(dbPath: string, opts: OpenOptions = {}): DatabaseSync {
  if (opts.allowSystemDrive) {
    console.warn('  ! system-drive guard bypassed (test mode)');
  } else {
    assertNotOnSystemDrive(dbPath);
  }

  const dir = dirname(resolve(dbPath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);

  db.prepare(
    `INSERT INTO meta(key, value) VALUES('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));

  return db;
}

/**
 * Fold the write-ahead log back into the main database file and truncate it.
 *
 * Matters because the live database sits inside a Google-Drive-synced folder.
 * In WAL mode a database is three files (.db, .db-wal, .db-shm) that must be
 * mutually consistent to restore; recent writes live in the -wal until a
 * checkpoint. Without this, Drive can upload a .db missing its latest rows
 * alongside a -wal it captured at a different instant.
 *
 * Checkpointing right after ingest leaves the main file complete and the
 * sidecars empty for the hours the collector is idle, which is when Drive
 * actually does its uploading. It does not make the synced live file a
 * trustworthy restore source -- that is what backupPath is for -- but it
 * shrinks the window where it is wrong from constant to momentary.
 */
export function checkpointWal(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Non-fatal: a failed checkpoint costs tidiness, not data.
  }
}

/**
 * How many times to re-attempt a backup that lost a lock race, and how long to
 * wait between attempts. A backup of this database takes tens of milliseconds,
 * so the whole ladder adds under 1.5s to an ingest in the worst case -- and
 * only when two collectors genuinely overlapped.
 */
const BACKUP_ATTEMPTS = 4;
const BACKUP_RETRY_MS = 250;

/**
 * Is this error a lost race for the backup file rather than a real failure?
 *
 * MEASURED 2026-09-04 by running concurrent backups against one destination,
 * both in one process and across four. The loser reports one of two things:
 *
 *   errcode 261  "database is locked"  -- SQLITE_BUSY, extended
 *   errcode 0    "not an error"        -- SQLite set no code at all, and
 *                                         node:sqlite formats sqlite3_errstr(0)
 *
 * The second is the one that showed up in `sync_log`, and it reads as a bug in
 * the reporting rather than as contention, which is exactly why it is worth
 * naming here. Primary code is the low byte; 5 is SQLITE_BUSY and 6 is
 * SQLITE_LOCKED.
 *
 * Anything else is a genuine failure -- a full disk, a bad path -- and must
 * NOT be retried into silence.
 *
 * Exported only so `npm run selftest` can pin those codes down: getting this
 * predicate wrong in the permissive direction turns a real, recurring failure
 * into four silent retries and a `busy`.
 */
export function isBackupContention(err: unknown): boolean {
  const code = (err as { errcode?: unknown } | null)?.errcode;
  if (typeof code !== 'number') return false;
  if (code === 0) return true;
  const primary = code & 0xff;
  return primary === 5 || primary === 6;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Serialises backups within THIS process.
 *
 * Two syncs 20ms apart -- which is what a phone retrying a push produces --
 * raced here on 2026-09-04 and wrote `failed: not an error` into `sync_log`.
 * Queueing rather than coalescing is deliberate: the in-flight backup may have
 * started before the second caller committed, so joining it would report a
 * backup that does not contain the caller's rows.
 */
let backupQueue: Promise<void> = Promise.resolve();

async function attemptBackup(db: DatabaseSync, backupPath: string): Promise<string> {
  // Inside the guard, not above it. This function's contract is that it
  // returns a status rather than throwing -- a backup that cannot be written
  // must not take a successful collection down with it.
  try {
    const dir = dirname(resolve(backupPath));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  for (let attempt = 1; attempt <= BACKUP_ATTEMPTS; attempt++) {
    try {
      await backup(db, backupPath);
      return 'ok';
    } catch (err) {
      if (!isBackupContention(err)) {
        return `failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (attempt < BACKUP_ATTEMPTS) await sleep(BACKUP_RETRY_MS * attempt);
    }
  }

  /*
    The destination is NOT at risk here, which is measured rather than assumed:
    across every concurrent run, the losing backup failed before writing a byte
    and the destination stayed complete and `integrity_check` clean. SQLite's
    own locking is what guarantees that.

    So this is not a failure -- the winning backup wrote a good file. It is
    also not `ok`: the winner may have started before THIS caller committed, so
    these particular rows might not be in it and are safe only in the live
    database until the next backup. It gets its own word for that reason.
  */
  return `busy: another backup held the file, ${BACKUP_ATTEMPTS} attempts`;
}

/**
 * Write a consistent copy to the backup location.
 *
 * Uses SQLite's backup API rather than copying the file: a plain copy of an
 * open database can be torn mid-write, and in WAL mode would miss the WAL
 * entirely. Returns a status string for sync_log instead of throwing -- a
 * failed backup must not discard a successful collection.
 *
 * Three outcomes, and the third is the reason this is not a one-liner:
 *
 *   ok      the file was written
 *   busy    another backup held it; the file is good, these rows are not in it
 *   failed  something real went wrong
 *
 * Callers wait their turn rather than racing. See backupQueue.
 */
export async function backupDatabase(
  db: DatabaseSync,
  backupPath: string,
): Promise<string> {
  const prior = backupQueue;
  let release!: () => void;
  backupQueue = new Promise<void>((r) => { release = r; });
  try {
    await prior;
    return await attemptBackup(db, backupPath);
  } finally {
    release();
  }
}

/**
 * Which collector wrote a run.
 *
 * A closed union rather than a free string so a typo cannot quietly create a
 * third source that the sync page then fails to group. `srum-atp` and
 * `android-daily` used to be here too; both sources were measured, rejected
 * and never wrote a row (checked against the live sync_log, 2026-09-23).
 */
export type SyncSource = 'win-sampler' | 'android-events';

export function startSyncRun(
  db: DatabaseSync,
  deviceId: string,
  source: SyncSource,
): number {
  const r = db
    .prepare(
      `INSERT INTO sync_log(device_id, source, started_at, status)
       VALUES(?, ?, ?, 'running')`,
    )
    .run(deviceId, source, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export interface SyncResult {
  status: 'success' | 'failed';
  rowsRead: number;
  rowsInserted: number;
  rowsSkipped: number;
  sourceOldestUtc: string | null;
  sourceNewestUtc: string | null;
  backupStatus: string | null;
  durationMs: number;
  error: string | null;
}

export function finishSyncRun(db: DatabaseSync, id: number, r: SyncResult): void {
  db.prepare(
    `UPDATE sync_log SET
       finished_at = ?, status = ?, rows_read = ?, rows_inserted = ?,
       rows_skipped = ?, source_oldest_utc = ?, source_newest_utc = ?,
       backup_status = ?, duration_ms = ?, error = ?
     WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    r.status,
    r.rowsRead,
    r.rowsInserted,
    r.rowsSkipped,
    r.sourceOldestUtc,
    r.sourceNewestUtc,
    r.backupStatus,
    r.durationMs,
    r.error,
    id,
  );
}
