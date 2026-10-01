/**
 * Bar colours the user chose in the dashboard, overriding the brand colour.
 *
 * The same shape as renames (lib/app-renames.ts), for the same reasons:
 * stored in the database because it is on D:, backed up and survives the
 * reset, and keyed by what already identifies an app on each side --
 *
 *   laptop  device_id 'zephyrus',  app_key = the resolved key
 *   phone   device_id <phone>,     app_key = the package name
 *
 * An override REPLACES the brand colour and is then treated exactly like one:
 * lifted by `ensureReadable()` if it is too dark for the dark theme, and
 * painted through `ink()` so it separates from the card on the light one. So
 * a black chosen by hand shows on black, as a black logo's brand colour does.
 * Being keyed by app rather than by name, it survives a rename.
 *
 * Two apps may share a colour: unlike a name, a colour keys nothing. That is
 * the user's call to make.
 *
 * Readers tolerate the table being absent, exactly as `readRenames` does.
 *
 * Ported from the sibling Data Usage Tracker, 2026-10-01.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { cleanColour } from './colour-hex';

/** app_key -> #rrggbb, for one device. Empty when none, or no table yet. */
export function readColourOverrides(db: DatabaseSync, deviceId: string): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT app_key AS k, colour AS c FROM app_colours WHERE device_id = ?')
      .all(deviceId) as { k: string; c: string }[];
    // Re-validated on the way out: a hand-edited row must not become an
    // arbitrary string in a style attribute.
    return new Map(rows.flatMap((r) => {
      const c = cleanColour(r.c);
      return c ? [[String(r.k), c] as [string, string]] : [];
    }));
  } catch {
    return new Map();
  }
}

export type ColourError = 'unknown-app' | 'bad-colour';

/**
 * Validate and store (or clear) one colour. An empty string clears it, which
 * returns the app to its brand colour, or to the device accent without one.
 */
export function saveColourOverride(opts: {
  dbFile: string;
  deviceId: string;
  key: string;
  colour: unknown;
  /** Every app key the device has recorded. */
  known: Set<string>;
  /** Tests only: a temp database under the system drive. */
  allowSystemDrive?: boolean;
}): { ok: true; colour: string | null } | { ok: false; error: ColourError } {
  if (!opts.known.has(opts.key)) return { ok: false, error: 'unknown-app' };

  const reset = typeof opts.colour === 'string' && opts.colour.trim() === '';
  const colour = reset ? null : cleanColour(opts.colour);
  if (!reset && colour === null) return { ok: false, error: 'bad-colour' };

  const db = openDatabase(opts.dbFile, { allowSystemDrive: opts.allowSystemDrive });
  try {
    if (colour === null) {
      db.prepare('DELETE FROM app_colours WHERE device_id = ? AND app_key = ?').run(opts.deviceId, opts.key);
    } else {
      db.prepare(
        `INSERT INTO app_colours (device_id, app_key, colour, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (device_id, app_key) DO UPDATE SET colour = excluded.colour, updated_at = excluded.updated_at`,
      ).run(opts.deviceId, opts.key, colour, new Date().toISOString());
    }
  } finally {
    db.close();
  }
  return { ok: true, colour };
}
