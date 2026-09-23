/**
 * Fan the shared logo drop-zone out into per-device folders.
 *
 *   npm run logo:distribute            report only, changes nothing
 *   npm run logo:distribute -- --apply place the copies and clear the root
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROOT IS A DROP ZONE AND NOT A LIBRARY
 *
 * `app-logo.ts` resolves a device folder first and the root second, so a
 * shared root works perfectly well as a fallback. The layout here is a
 * deliberate choice on top of that: **every logo lives in the folder of the
 * device that shows it**, duplicated when two devices show the same app.
 *
 * The cost is real and worth stating. Two copies of `Brave.svg` can drift, and
 * nothing here will notice -- replace the artwork in one folder and the other
 * device keeps the old one. What it buys is that a folder is a complete,
 * readable answer to "what does this device show", and that changing one
 * device's icon cannot possibly affect another.
 *
 * So: drop a new logo in the root, run this, and it lands in the folders that
 * need it. The root is where things arrive, not where they live.
 * ---------------------------------------------------------------------------
 *
 * WHAT COUNTS AS "NEEDED". The app display names each device has actually
 * recorded, matched with the same rules the dashboard uses -- so a name that
 * resolves to a logo on the page resolves to one here.
 *
 * ⚠️ It never copies BETWEEN devices. A file in `nothing-a001/` is the Nothing's
 * artwork and may be the wrong picture entirely for another phone; that is the
 * whole reason the folders exist. A device needing a logo nobody has is
 * REPORTED, not filled in from a neighbour.
 *
 * ⚠️ A root file no device claims is LEFT ALONE. Deleting artwork because
 * nothing currently matches it would throw away a logo for an app that is
 * merely uninstalled today.
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { loadConfig, deviceLabel } from '../src/lib/config';
import { resolveApp } from '../src/lib/app-name';
import { logoDir, logoKey, logoManifest, allLogoFiles } from '../src/lib/app-logo';

const APPLY = process.argv.includes('--apply');

interface Device {
  /** The folder name to create, as a person would write it. */
  folder: string;
  /** Every name this device answers to, for matching an existing folder. */
  aliases: string[];
  /** Display names this device has recorded. */
  names: Set<string>;
}

function readDevices(dbPath: string): Device[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const devices: Device[] = [];

  try {
    // The laptop. Names come from `resolveApp`, exactly as the pages get them.
    const win = new Set<string>();
    for (const r of db.prepare(
      `SELECT DISTINCT app_path FROM windows_segments
        WHERE kind = 'app' AND app_path <> ''`,
    ).all() as { app_path: string }[]) {
      win.add(resolveApp(r.app_path).name);
    }
    if (win.size > 0) {
      devices.push({ folder: deviceLabel(), aliases: [deviceLabel(), 'zephyrus'], names: win });
    }

    // The phones. The label is what the phone itself reports, which is what
    // the dashboard shows and therefore what a logo file is named after.
    for (const d of db.prepare(
      'SELECT device_id, slug FROM android_devices ORDER BY slug',
    ).all() as { device_id: string; slug: string }[]) {
      const names = new Set<string>();
      for (const r of db.prepare(
        `SELECT DISTINCT COALESCE(a.label, s.package_name) AS label
           FROM android_segments s
           LEFT JOIN android_apps a
             ON a.device_id = s.device_id AND a.package_name = s.package_name
          WHERE s.device_id = ?`,
      ).all(d.device_id) as { label: string }[]) {
        names.add(r.label);
      }
      if (names.size > 0) devices.push({ folder: d.slug, aliases: [d.slug], names });
    }
  } finally {
    db.close();
  }

  return devices;
}

/**
 * The keys a display name can match, in the order the dashboard tries them.
 *
 * Mirrors `resolveLogo`'s candidate list. Kept here rather than exported from
 * `app-logo.ts` because that function answers "which file wins", and this one
 * needs "which files could ever apply".
 */
function candidateKeys(name: string): string[] {
  const keys = [logoKey(name)];
  const lower = name.toLowerCase();
  for (const vendor of ['google', 'microsoft']) {
    if (!lower.startsWith(`${vendor} `)) continue;
    const short = logoKey(name.slice(vendor.length + 1));
    if (short) keys.push(short);
  }
  return keys;
}

/* ------------------------------------------------------------------ */

const cfg = loadConfig();
if (!cfg.databasePath || !existsSync(cfg.databasePath)) {
  console.error(`\nNo database at ${cfg.databasePath}. Nothing to distribute against.\n`);
  process.exit(1);
}

const dir = logoDir();
const devices = readDevices(cfg.databasePath);
const manifest = logoManifest();
const root = manifest.get('') ?? new Map<string, string>();

console.log('');
console.log(APPLY ? 'DISTRIBUTING' : 'DRY RUN -- pass --apply to make these changes');
console.log('');

/** relPath in the root -> device folders that have taken a copy. */
const takenFrom = new Map<string, Set<string>>();
let placed = 0;
const missing: { device: string; names: string[] }[] = [];

for (const dev of devices) {
  const scopeKeys = dev.aliases.map(logoKey);
  const own = scopeKeys.map((k) => manifest.get(k)).find((m) => m) ?? new Map<string, string>();
  const target = join(dir, dev.folder);

  const already: string[] = [];
  const toCopy: { key: string; from: string }[] = [];
  const none: string[] = [];

  for (const name of [...dev.names].sort()) {
    const keys = candidateKeys(name);
    if (keys.some((k) => own.has(k))) { already.push(name); continue; }
    const hit = keys.map((k) => ({ k, rel: root.get(k) })).find((x) => x.rel);
    if (hit?.rel) toCopy.push({ key: hit.k, from: hit.rel });
    else none.push(name);
  }

  console.log(`${dev.folder}`);
  console.log(`  apps recorded        ${dev.names.size}`);
  console.log(`  already in place     ${already.length}`);
  console.log(`  copying from root    ${toCopy.length}`);
  console.log(`  no logo anywhere     ${none.length}`);

  for (const c of toCopy) {
    const dest = join(target, basename(c.from));
    if (APPLY) {
      mkdirSync(target, { recursive: true });
      copyFileSync(join(dir, c.from), dest);
    }
    if (!takenFrom.has(c.from)) takenFrom.set(c.from, new Set());
    takenFrom.get(c.from)!.add(dev.folder);
    placed++;
  }

  if (none.length > 0) missing.push({ device: dev.folder, names: none });
  console.log('');
}

/*
  Clear a root file once every device that wants it has its own copy.

  A file nobody claimed stays: no device shows an app by that name TODAY, which
  is not the same as the artwork being useless. Uninstalling an app would
  otherwise silently delete its logo.
*/
let cleared = 0;
const unclaimed: string[] = [];
for (const [key, rel] of root) {
  const takers = takenFrom.get(rel);
  if (!takers || takers.size === 0) { unclaimed.push(rel); continue; }
  if (APPLY) rmSync(join(dir, rel), { force: true });
  cleared++;
  void key;
}

console.log(`copies placed: ${placed}   root files cleared: ${cleared}   left in root: ${unclaimed.length}`);
if (unclaimed.length > 0) {
  console.log('\nLEFT IN THE ROOT -- no device currently shows a matching app:');
  for (const u of unclaimed.sort()) console.log(`  ${u}`);
  console.log('\nThey still resolve, because the root is the fallback. Move or');
  console.log('delete them by hand if they are genuinely dead.');
}

if (missing.length > 0) {
  console.log('\nAPPS WITH NO LOGO -- these draw their initial, which is the');
  console.log('normal case for most apps. Drop artwork in the device folder to fix one.');
  for (const m of missing) {
    console.log(`\n  ${m.device} (${m.names.length})`);
    for (const n of m.names.sort()) console.log(`    ${n}`);
  }
}

if (APPLY) {
  const after = allLogoFiles();
  const bytes = after.reduce((a, l) => a + statSync(join(dir, l.relPath)).size, 0);
  console.log(`\nlogo files now: ${after.length}, ${(bytes / 1024).toFixed(0)} KB`);
  for (const scope of [...new Set(after.map((l) => l.scope))].sort()) {
    const n = after.filter((l) => l.scope === scope).length;
    console.log(`  ${(scope || '(root)').padEnd(24)} ${n}`);
  }
} else {
  console.log('\nNothing was changed. Re-run with --apply.');
}
console.log('');
void extname;
