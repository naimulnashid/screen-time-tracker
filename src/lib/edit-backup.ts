/**
 * A backup after the user changes an app's name, colour, visibility or merge.
 *
 * Audit DB-002. Those choices live only in the database: nothing re-collects
 * them, unlike screen time, which the phones and the sampler resend. Before
 * this they reached the backup only at the next ingest, up to an hour later,
 * and a reset in that hour lost them.
 *
 * A backup that does not complete never fails the edit: the write itself
 * succeeded, and the next ingest's backup picks it up. The status is returned
 * so the route can report it.
 */

import 'server-only';
import { loadConfig } from './config';
import { openDatabase, checkpointWal, backupDatabase } from './db';

export async function backupAfterEdit(dbFile: string): Promise<string | null> {
  const cfg = loadConfig();
  if (!cfg.backupEnabled || !cfg.backupPath) return null;
  try {
    const db = openDatabase(dbFile);
    try {
      checkpointWal(db);
      return await backupDatabase(db, cfg.backupPath);
    } finally {
      db.close();
    }
  } catch {
    return 'failed';
  }
}
