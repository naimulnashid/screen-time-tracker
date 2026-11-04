/**
 * What a screen-time database HOLDS, row by row, rather than how many rows.
 *
 *   node scripts/db-digest.mjs info <db>
 *   node scripts/db-digest.mjs compare <a.db> <b.db>
 *
 * Audit DB-003. The drill and restore.ps1 used to compare row COUNTS, and a
 * count cannot see most of what changes here: a phone's still-filling row is
 * upserted in place, a rename or a colour replaces a row, a merge rewrites
 * one, and the seam deletes rows as native ones arrive. Two databases with
 * equal counts could hold different history, and a restore guard that only
 * asked "does live have more rows" would discard every one of those edits
 * without a word.
 *
 * So each row of each table below is hashed whole, and two databases are
 * compared as sets of row hashes: how many rows each holds that the other
 * does not. `sync_log` and `meta` are left out: they record runs, not history,
 * and differ after every run.
 *
 * Read-only, through the WAL. Always exits 0 and prints one line of JSON; the
 * caller decides what a difference means. Imported by reset-drill.ts too.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const HISTORY_TABLES = [
  'windows_segments',
  'android_devices', 'android_apps', 'android_segments', 'android_screen',
  'app_renames', 'app_colours', 'app_hidden', 'app_merges',
];

function rowHash(row) {
  const h = createHash('sha1');
  for (const k of Object.keys(row).sort()) {
    const v = row[k];
    // Type-tagged, so 1 and '1' and null and 'null' cannot collide.
    const enc = v === null ? 'n' : v instanceof Uint8Array ? 'b' + Buffer.from(v).toString('hex') : typeof v + String(v);
    h.update(k).update('\u0000').update(enc).update('\u0001');
  }
  return h.digest('hex');
}

/** Each history table's rows as a set of hashes; a table the file lacks is empty. */
export function rowSets(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
    );
    const out = {};
    for (const t of HISTORY_TABLES) {
      const set = new Set();
      if (present.has(t)) for (const row of db.prepare(`SELECT * FROM ${t}`).iterate()) set.add(rowHash(row));
      out[t] = set;
    }
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    return { sets: out, integrity };
  } finally {
    db.close();
  }
}

/** One digest for the whole history: equal exactly when the rows are. */
export function digestOf(sets) {
  const h = createHash('sha256');
  for (const t of HISTORY_TABLES) h.update(t).update(':').update([...sets[t]].sort().join(',')).update(';');
  return h.digest('hex');
}

export function info(path) {
  if (!existsSync(path)) return { ok: false, rows: -1, error: 'missing' };
  try {
    const { sets, integrity } = rowSets(path);
    const rows = HISTORY_TABLES.reduce((n, t) => n + sets[t].size, 0);
    return { ok: true, rows, integrity, digest: digestOf(sets) };
  } catch (e) {
    return { ok: false, rows: -1, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Rows in `a` that `b` lacks, and the reverse, per table and in total. */
export function compare(a, b) {
  if (!existsSync(a) || !existsSync(b)) return { ok: false, error: 'missing' };
  try {
    const A = rowSets(a).sets;
    const B = rowSets(b).sets;
    const tables = {};
    let onlyA = 0;
    let onlyB = 0;
    for (const t of HISTORY_TABLES) {
      let x = 0;
      let y = 0;
      for (const h of A[t]) if (!B[t].has(h)) x++;
      for (const h of B[t]) if (!A[t].has(h)) y++;
      if (x || y) tables[t] = { onlyA: x, onlyB: y };
      onlyA += x;
      onlyB += y;
    }
    return { ok: true, onlyA, onlyB, tables };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const [cmd, a, b] = process.argv.slice(2);
  const result = cmd === 'info' && a ? info(a)
    : cmd === 'compare' && a && b ? compare(a, b)
    : { ok: false, error: 'usage: db-digest.mjs info <db> | compare <a> <b>' };
  console.log(JSON.stringify(result));
}
