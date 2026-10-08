/**
 * Fold one phone entry's history into another entry for the SAME phone.
 *
 *   npm run android:merge -- --from nothing-a001 --into nothing-a001-2            report only
 *   npm run android:merge -- --from nothing-a001 --into nothing-a001-2 --apply    do it
 *
 * Either side may be named by slug or by device id.
 *
 * WHY. The phone app's device id is a random UUID kept in its own preferences
 * (Prefs.deviceId). Uninstalling the app deletes it -- and moving a phone from
 * a debug build to the signed release REQUIRES an uninstall -- so the
 * reinstalled app reports as a new phone: a second sidebar entry, slugged
 * "<slug>-2", holding only what Android still had, with every older day left
 * under the old id. Met on the Nothing, 2026-10-08.
 *
 * The phone goes on sending the NEW id, so history moves old -> new, and the
 * new entry takes the old slug back so the old address keeps working.
 *
 * Where the two overlap, the NEW rows win and the old ones are dropped. Both
 * are readings of the same Android events, but they need not share keys -- an
 * in-flight span clipped at a different moment, or a reconstruction fixed
 * between builds -- so keeping both could count the overlap twice. Per table,
 * an old row is kept only if it ENDS by the time the new entry's first row
 * STARTS. The report compares the two readings of the overlap day by day, so
 * the choice can be checked rather than trusted.
 *
 * --apply takes a backup into scratchDir first, writes in one transaction,
 * then refreshes the regular backup.
 */

import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/lib/config';
import { assertNotOnSystemDrive, backupDatabase, checkpointWal, openDatabase } from '../src/lib/db';

interface Device {
  device_id: string;
  slug: string;
  label: string;
  model: string;
  first_seen_utc: string;
}

/** Session tables: overlap is resolved by time. */
const TIMED = ['android_segments', 'android_screen'] as const;
/** Keyed tables: the new entry's row wins a clash. */
const KEYED = ['android_apps', 'app_renames', 'app_colours'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function find(db: DatabaseSync, key: string): Device {
  const row = db
    .prepare(
      `SELECT device_id, slug, label, model, first_seen_utc
       FROM android_devices WHERE slug = ? OR device_id = ?`,
    )
    .get(key, key) as Device | undefined;
  if (!row) throw new Error(`no phone with slug or id "${key}"`);
  return { ...row };
}

function count(db: DatabaseSync, sql: string, ...params: string[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number }).n);
}

/** Where the new entry's history begins, per session table. */
function cutoffs(db: DatabaseSync, into: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const t of TIMED) {
    out[t] = (db.prepare(`SELECT MIN(start_utc) AS lo FROM ${t} WHERE device_id = ?`)
      .get(into) as { lo: string | null }).lo;
  }
  return out;
}

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(2)}h`;
}

async function main(): Promise<void> {
  const fromKey = arg('--from');
  const intoKey = arg('--into');
  const apply = process.argv.includes('--apply');
  if (!fromKey || !intoKey) {
    console.error('usage: npm run android:merge -- --from <slug|id> --into <slug|id> [--apply]');
    process.exit(2);
  }

  const cfg = loadConfig();
  if (!cfg.databasePath) throw new Error('databasePath is not set in config/collector.json');
  assertNotOnSystemDrive(cfg.databasePath);

  const db = apply ? openDatabase(cfg.databasePath) : new DatabaseSync(cfg.databasePath, { readOnly: true });
  const from = find(db, fromKey);
  const into = find(db, intoKey);
  if (from.device_id === into.device_id) throw new Error('--from and --into are the same phone');
  // A guard, not a formality: merging two DIFFERENT phones would interleave
  // their days into one chart with nothing on the page to say so.
  if (from.model !== into.model) {
    throw new Error(`refusing: models differ ("${from.model}" vs "${into.model}")`);
  }

  console.log(`from : ${from.slug}  ${from.device_id}  first seen ${from.first_seen_utc}`);
  console.log(`into : ${into.slug}  ${into.device_id}  first seen ${into.first_seen_utc}`);
  console.log(`after: ${into.device_id} at /android/${from.slug}\n`);

  const cut = cutoffs(db, into.device_id);
  for (const t of TIMED) {
    const c = cut[t] ?? null;
    const all = count(db, `SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ?`, from.device_id);
    const keep = c === null ? all
      : count(db, `SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ? AND end_utc <= ?`, from.device_id, c);
    console.log(`${t.padEnd(17)} move ${keep}, drop ${all - keep} in the overlap` +
      (c ? ` (new rows start ${c})` : ' (new entry has none)'));
  }
  for (const t of KEYED) {
    const all = count(db, `SELECT COUNT(*) AS n FROM ${t} WHERE device_id = ?`, from.device_id);
    console.log(`${t.padEnd(17)} ${all} rows, the new entry's own win a clash`);
  }
  console.log(`${'sync_log'.padEnd(17)} move ${count(db,
    'SELECT COUNT(*) AS n FROM sync_log WHERE device_id = ?', from.device_id)} runs`);

  // The check on "new rows win": both readings of each WHOLE day they share.
  // They should agree closely; a large gap means the overlap is not the same
  // history, and the merge should not go ahead blind.
  // Below Android 9 there is no screen-on, so compare app time instead.
  const compare = (table: string, where: string) => db.prepare(
    `SELECT local_date,
            SUM(CASE WHEN device_id = ? THEN duration_ms ELSE 0 END) AS old_ms,
            SUM(CASE WHEN device_id = ? THEN duration_ms ELSE 0 END) AS new_ms
     FROM ${table}
     WHERE ${where} device_id IN (?, ?)
     GROUP BY local_date
     HAVING old_ms > 0 AND new_ms > 0
     ORDER BY local_date`,
  ).all(from.device_id, into.device_id, from.device_id, into.device_id) as
    { local_date: string; old_ms: number; new_ms: number }[];
  let measure = 'screen-on';
  let days = compare('android_screen', "kind = 'screen_on' AND");
  if (days.length <= 2) {
    measure = 'app time';
    days = compare('android_segments', '');
  }
  if (days.length > 0) {
    console.log(`
${measure} on the days both hold (first and last are partial):`);
    for (const d of days) {
      console.log(`  ${d.local_date}  old ${hours(d.old_ms).padStart(7)}  new ${hours(d.new_ms).padStart(7)}`);
    }
  }

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to merge.');
    return;
  }

  if (!cfg.scratchDir) throw new Error('scratchDir is not set in config/collector.json');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(cfg.scratchDir, { recursive: true });
  const safety = join(cfg.scratchDir, `pre-merge-${stamp}.db`);
  await backup(db, safety);
  console.log(`\nbackup before merge: ${safety}`);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of TIMED) {
      const c = cut[t] ?? null;
      if (c === null) {
        db.prepare(`UPDATE OR IGNORE ${t} SET device_id = ? WHERE device_id = ?`)
          .run(into.device_id, from.device_id);
      } else {
        db.prepare(`UPDATE OR IGNORE ${t} SET device_id = ? WHERE device_id = ? AND end_utc <= ?`)
          .run(into.device_id, from.device_id, c);
      }
      db.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(from.device_id);
    }
    for (const t of KEYED) {
      db.prepare(`UPDATE OR IGNORE ${t} SET device_id = ? WHERE device_id = ?`)
        .run(into.device_id, from.device_id);
      db.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(from.device_id);
    }
    db.prepare('UPDATE sync_log SET device_id = ? WHERE device_id = ?').run(into.device_id, from.device_id);

    // Old row first: slug is UNIQUE, and the new entry is about to take it.
    db.prepare('DELETE FROM android_devices WHERE device_id = ?').run(from.device_id);
    db.prepare(
      `UPDATE android_devices SET slug = ?, first_seen_utc = MIN(first_seen_utc, ?)
       WHERE device_id = ?`,
    ).run(from.slug, from.first_seen_utc, into.device_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const ok = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  console.log(`merged; integrity_check: ${ok}`);
  checkpointWal(db);
  if (cfg.backupEnabled !== false && cfg.backupPath) {
    console.log(`regular backup: ${await backupDatabase(db, cfg.backupPath)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
