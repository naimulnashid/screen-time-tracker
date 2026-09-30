/**
 * Display names the user chose in the dashboard, overriding the resolved ones.
 *
 * **Stored in the database, not in config or code**, because the database is
 * the one thing guaranteed to survive a reset: it lives on D:, it is backed
 * up with the rest of the history, and a rename is a fact about that history.
 *
 * Keyed by what already identifies an app on each side, so a rename never
 * touches a recorded row:
 *
 *   laptop  device_id 'zephyrus',  app_key = the resolved key (app-name.ts)
 *   phone   device_id <phone>,     app_key = the package name
 *
 * On the laptop it renames the RESOLVED app, never an identity: the key is
 * what every page groups, charts and links on, and the detail page's
 * "Identities" card keeps showing the raw paths as they are.
 *
 * **A renamed app keeps its original logo, plate and colour** unless a logo
 * file matches the new name -- see `lookName()` in app-logo.ts. Renaming
 * "Microsoft Edge" to "Edge" must not turn the Edge mark into an initial.
 *
 * And a new name may not be one another app on the same device already shows,
 * or two rows would read identically with nothing to say which is which.
 *
 * Readers open the database read-only and must tolerate the table being
 * absent: `SCHEMA_SQL` creates it on the first write path to touch the file
 * after it shipped (an ingest, a phone sync, or a rename), and a page must not
 * fail in the gap.
 *
 * Ported from the sibling Data Usage Tracker, 2026-10-01. Not `server-only`,
 * so the self-test can import it; nothing here is reachable from a client
 * component anyway.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { MAX_NAME_LENGTH } from './rename-limits';

export { MAX_NAME_LENGTH };

/**
 * Names the charts use for something that is not one app. Taking one would
 * put an app's band beside the stacked charts' own "Other" with nothing to
 * tell them apart.
 */
const RESERVED = new Set(['other']);

/** app_key -> chosen name, for one device. Empty when none, or no table yet. */
export function readRenames(db: DatabaseSync, deviceId: string): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT app_key AS k, name AS n FROM app_renames WHERE device_id = ?')
      .all(deviceId) as { k: string; n: string }[];
    return new Map(rows.map((r) => [String(r.k), String(r.n)]));
  } catch {
    // "no such table" until the first write path runs the new schema.
    return new Map();
  }
}

/**
 * Tidy a submitted name: drop control characters, collapse inner whitespace,
 * trim. Returns null for a name that is unusable after that.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export type RenameError = 'unknown-app' | 'bad-name' | 'reserved' | 'taken';

/** What a device's apps are called right now, rename included, and without it. */
export type AppNames = Map<string, { name: string; base: string }>;

/**
 * Decide what a rename request means, without touching the database.
 *
 * `apps` is every app on the device, keyed like `app_key`. An empty name, or
 * the app's own base name, means "clear the override" -- `name` comes back as
 * the base and `clear` is true, so nothing redundant is stored.
 */
export function planRename(
  apps: AppNames,
  key: string,
  raw: unknown,
): { ok: true; name: string; clear: boolean } | { ok: false; error: RenameError } {
  const app = apps.get(key);
  if (!app) return { ok: false, error: 'unknown-app' };

  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, name: app.base, clear: true };
  const name = cleanName(raw);
  if (name === null) return { ok: false, error: 'bad-name' };
  if (name === app.base) return { ok: true, name, clear: true };

  const lower = name.toLowerCase();
  if (RESERVED.has(lower)) return { ok: false, error: 'reserved' };
  for (const [k, shown] of apps) {
    if (k !== key && shown.name.toLowerCase() === lower) return { ok: false, error: 'taken' };
  }
  return { ok: true, name, clear: false };
}

/**
 * Validate and store (or clear) one rename.
 *
 * Through `openDatabase`, like the phone's ingest: the system-drive guard and
 * the schema -- which is what creates `app_renames` -- apply here too. The
 * backup is left to the next ingest or phone push, both of which write one;
 * a rename is a handful of bytes, and the live file already holds it.
 */
export function saveRename(opts: {
  dbFile: string;
  deviceId: string;
  key: string;
  name: unknown;
  apps: AppNames;
  /** Tests only: a temp database under the system drive. */
  allowSystemDrive?: boolean;
}): { ok: true; name: string } | { ok: false; error: RenameError } {
  const plan = planRename(opts.apps, opts.key, opts.name);
  if (!plan.ok) return plan;

  const db = openDatabase(opts.dbFile, { allowSystemDrive: opts.allowSystemDrive });
  try {
    if (plan.clear) {
      db.prepare('DELETE FROM app_renames WHERE device_id = ? AND app_key = ?').run(opts.deviceId, opts.key);
    } else {
      db.prepare(
        `INSERT INTO app_renames (device_id, app_key, name, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (device_id, app_key) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      ).run(opts.deviceId, opts.key, plan.name, new Date().toISOString());
    }
  } finally {
    db.close();
  }
  return { ok: true, name: plan.name };
}
