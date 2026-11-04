/**
 * Two choices the user makes about apps on the By App page: hiding one, and
 * merging one into another. Ported from the sibling Data Usage Tracker,
 * 2026-11-03.
 *
 * Stored in the database beside renames and colours (schema 7), keyed the
 * same way -- the laptop's device id + the resolved key, or a phone's device
 * id + the package -- and for the same reason: the database survives the
 * reset and is backed up, and these are facts about how the history is read.
 *
 * **Hiding is a view choice.** A hidden app leaves By App's list, grid and
 * rankings, and nothing else: the headline totals, the Overview's charts and
 * every other page still count it, or a hidden app would quietly make the
 * numbers stop adding up. "Show N hidden" lists them again.
 *
 * **Merging is a naming choice**, like a rename one level up. The merged app
 * is read as part of its target everywhere -- totals, charts, opens, colours,
 * the detail page -- exactly as `app-name.ts` folds ShellHost and sihost into
 * Windows Shell. The target's Merged apps card lists what was folded in and
 * undoes it. No row moves; deleting the merge restores the app.
 *
 * One level only: a target is never itself merged. Merging into an app that
 * is already merged stores the merge against ITS target, and merging an app
 * that others were merged into carries them along, so a lookup is one step
 * and a chain can never loop.
 *
 * Not `server-only`, so the self-test can import it, like app-renames.ts.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';

/** app_key -> the key it is merged into, for one device. Empty when none, or no table yet. */
export function readMerges(db: DatabaseSync, deviceId: string): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT app_key AS k, into_key AS t FROM app_merges WHERE device_id = ?')
      .all(deviceId) as { k: string; t: string }[];
    return new Map(rows.map((r) => [String(r.k), String(r.t)]));
  } catch {
    // "no such table" until the first write path runs the new schema.
    return new Map();
  }
}

/** The app keys hidden from By App, for one device. */
export function readHidden(db: DatabaseSync, deviceId: string): Set<string> {
  try {
    const rows = db
      .prepare('SELECT app_key AS k FROM app_hidden WHERE device_id = ?')
      .all(deviceId) as { k: string }[];
    return new Set(rows.map((r) => String(r.k)));
  } catch {
    return new Set();
  }
}

export type PrefError = 'unknown-app' | 'same-app';

interface WriteOpts {
  dbFile: string;
  deviceId: string;
  /** Tests only: a temp database under the system drive. */
  allowSystemDrive?: boolean;
}

function write<T>(opts: WriteOpts, fn: (db: DatabaseSync) => T): T {
  // Through openDatabase, like a rename: the system-drive guard, and the
  // schema that creates these tables.
  const db = openDatabase(opts.dbFile, { allowSystemDrive: opts.allowSystemDrive });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function setHidden(opts: WriteOpts & { key: string; hidden: boolean }): void {
  write(opts, (db) => {
    if (opts.hidden) {
      db.prepare(
        `INSERT INTO app_hidden (device_id, app_key, hidden_at) VALUES (?, ?, ?)
         ON CONFLICT (device_id, app_key) DO NOTHING`,
      ).run(opts.deviceId, opts.key, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM app_hidden WHERE device_id = ? AND app_key = ?').run(opts.deviceId, opts.key);
    }
  });
}

/**
 * Merge `key` into `into`, or undo `key`'s merge when `into` is null.
 * `known` is every app key on the device, merged ones included.
 */
export function setMerge(opts: WriteOpts & {
  key: string;
  into: string | null;
  known: Set<string>;
}): { ok: true } | { ok: false; error: PrefError } {
  const { deviceId, key, into, known } = opts;
  if (!known.has(key)) return { ok: false, error: 'unknown-app' };
  return write(opts, (db) => {
    if (into === null) {
      db.prepare('DELETE FROM app_merges WHERE device_id = ? AND app_key = ?').run(deviceId, key);
      return { ok: true } as const;
    }
    if (!known.has(into)) return { ok: false, error: 'unknown-app' } as const;
    // One level: follow the target to its own target first.
    const target = readMerges(db, deviceId).get(into) ?? into;
    if (target === key) return { ok: false, error: 'same-app' } as const;
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      // Whatever was merged into `key` follows it to the new target.
      db.prepare('UPDATE app_merges SET into_key = ?, updated_at = ? WHERE device_id = ? AND into_key = ?')
        .run(target, now, deviceId, key);
      db.prepare(
        `INSERT INTO app_merges (device_id, app_key, into_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (device_id, app_key) DO UPDATE SET into_key = excluded.into_key, updated_at = excluded.updated_at`,
      ).run(deviceId, key, target, now);
      // A merged app is not on the list to be hidden from.
      db.prepare('DELETE FROM app_hidden WHERE device_id = ? AND app_key = ?').run(deviceId, key);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { ok: true } as const;
  });
}
