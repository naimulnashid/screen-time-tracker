/**
 * The reset drill.
 *
 * This project exists to survive a Windows reset. That claim is worth exactly
 * as much as the last time it was TESTED, so this script tests it:
 *
 *   npm run drill
 *
 * It changes nothing. It restores the backup into TEMP, queries it, and
 * enumerates what a reset would take with it. Anything that would be lost and
 * has no copy off the system drive is a FAILURE, not a note -- the whole point
 * is that C:\ is assumed gone.
 *
 * The four things people get wrong about "it's backed up" (the fourth is
 * the second again, for config, colours and logos -- see section 4):
 *
 *   1. The DATABASE is backed up and the CODE is not. A repo on C:\ with no
 *      remote dies with the machine, and then the backup is a file nobody can
 *      read.
 *   2. The SECRETS are gitignored, so restoring the repo restores everything
 *      except the two values that make it run. The phone keeps pushing to a
 *      token the rebuilt server has never heard of, and fails silently.
 *   3. A backup that has never been OPENED is a hypothesis. This one gets
 *      opened, integrity-checked and queried.
 *   4. The LOCAL-ONLY files are gitignored too: collector.json (without which
 *      a clone cannot find the backup at all), the brand colours, the logos.
 */

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SCHEMA_VERSION } from '../src/lib/schema';

let pass = 0;
let warn = 0;
let fail = 0;

function ok(msg: string, detail = '') {
  pass++;
  console.log(`  [PASS] ${msg}${detail ? '  -- ' + detail : ''}`);
}
function bad(msg: string, detail = '') {
  fail++;
  console.log(`  [FAIL] ${msg}${detail ? '  -- ' + detail : ''}`);
}
function note(msg: string, detail = '') {
  warn++;
  console.log(`  [WARN] ${msg}${detail ? '  -- ' + detail : ''}`);
}
function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

interface Config {
  databasePath?: string;
  backupPath?: string;
  samplerLogDir?: string;
}
if (!existsSync('config/collector.json')) {
  console.error('config/collector.json not found -- copy config/collector.example.json to it and set your paths.');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync('config/collector.json', 'utf8')) as Config;

const systemDrive = (process.env['SystemDrive'] ?? 'C:').toUpperCase();
const onSystemDrive = (p: string) => resolve(p).toUpperCase().startsWith(systemDrive + '\\');

/* ------------------------------------------------------------------ */
section('1. The backup is real, and it opens');

const backupPath = cfg.backupPath;
let restored: string | null = null;
const scratch = mkdtempSync(join(tmpdir(), 'screentime-drill-'));

try {
  if (!backupPath || !existsSync(backupPath)) {
    bad('backup file exists', backupPath ?? '(no backupPath configured)');
  } else {
    const size = statSync(backupPath).size;
    if (size === 0) {
      bad('backup is non-empty', backupPath);
    } else {
      ok('backup exists', `${(size / 1024 / 1024).toFixed(2)} MB`);

      if (onSystemDrive(backupPath)) {
        bad('backup is OFF the system drive', `${backupPath} dies with the machine`);
      } else {
        ok('backup is off the system drive', backupPath);
      }

      // Restore it somewhere else entirely and use it from there. Reading the
      // backup in place would not prove it is a self-contained file -- which
      // is the property that matters, since WAL sidecars are not copied.
      restored = join(scratch, 'restored.db');
      copyFileSync(backupPath, restored);
      ok('backup copies out cleanly', 'single file, no -wal/-shm needed');

      const db = new DatabaseSync(restored, { readOnly: true });
      try {
        const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (integrity.integrity_check === 'ok') ok('PRAGMA integrity_check', 'ok');
        else bad('PRAGMA integrity_check', integrity.integrity_check);

        const version = db
          .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
          .get() as { value: string } | undefined;
        if (Number(version?.value) === SCHEMA_VERSION) {
          ok('schema version matches the code', `v${SCHEMA_VERSION}`);
        } else {
          note('schema version differs from the code',
            `backup v${version?.value ?? '?'} vs code v${SCHEMA_VERSION}; the schema is applied on open, so this self-heals`);
        }

        const expected = [
          'meta', 'sync_log', 'windows_segments',
          'android_devices', 'android_apps', 'android_segments', 'android_screen',
        ];
        const present = new Set(
          (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
            .map((r) => r.name),
        );
        const missing = expected.filter((t) => !present.has(t));
        if (missing.length === 0) ok('every table is present', `${expected.length} tables`);
        else bad('tables missing from the backup', missing.join(', '));

        // The point of the drill: can you actually READ your history back?
        const counts: string[] = [];
        for (const t of ['windows_segments', 'android_segments', 'android_screen']) {
          if (!present.has(t)) continue;
          const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
          counts.push(`${t}=${n.n}`);
        }
        const win = db
          .prepare('SELECT MIN(local_date) AS a, MAX(local_date) AS b FROM windows_segments')
          .get() as { a: string | null; b: string | null };
        const droid = db
          .prepare('SELECT MIN(local_date) AS a, MAX(local_date) AS b FROM android_segments')
          .get() as { a: string | null; b: string | null };
        ok('history is queryable from the restored copy', counts.join(', '));
        console.log(`         windows ${win.a ?? '-'} .. ${win.b ?? '-'}`);
        console.log(`         android ${droid.a ?? '-'} .. ${droid.b ?? '-'}`);
      } finally {
        db.close();
      }
    }
  }

  /* ---------------------------------------------------------------- */
  section('2. The backup is not stale');

  if (backupPath && existsSync(backupPath) && cfg.databasePath && existsSync(cfg.databasePath)) {
    const liveDb = new DatabaseSync(cfg.databasePath, { readOnly: true });
    const backDb = new DatabaseSync(restored!, { readOnly: true });
    try {
      let drift = 0;
      for (const t of ['windows_segments', 'android_segments', 'android_screen']) {
        const l = (liveDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
        const b = (backDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
        drift += l - b;
      }
      // A small positive drift is normal and healthy -- the collectors have
      // written since the last backup. A large one means the backup step is
      // failing quietly, which sync_log would also show.
      if (drift === 0) ok('backup matches live exactly', 'no rows written since');
      else if (drift > 0 && drift < 2000) ok('backup is current', `${drift} rows written since`);
      else if (drift >= 2000) note('backup is behind', `${drift} rows written since the last backup`);
      else note('backup has MORE rows than live', `${-drift} -- did live get rebuilt?`);
    } finally {
      liveDb.close();
      backDb.close();
    }
  } else {
    note('cannot compare backup to live', 'one of them is missing');
  }

  /* ---------------------------------------------------------------- */
  section('3. The CODE survives too');

  // The database is useless without something that can read it. This is the
  // check people skip, because the repo feels safe merely by existing.
  const repoOnSystemDrive = onSystemDrive(process.cwd());
  let remotes = '';
  try {
    remotes = execFileSync('git', ['remote', '-v'], { encoding: 'utf8' }).trim();
  } catch {
    remotes = '';
  }

  let bundlePath = '';
  const backupDir = backupPath ? resolve(backupPath, '..') : '';
  if (backupDir) {
    const candidate = join(backupDir, 'screen-time-repo.bundle');
    if (existsSync(candidate)) bundlePath = candidate;
  }

  if (remotes) {
    ok('git remote configured', remotes.split('\n')[0]);
  } else if (bundlePath) {
    const age = (Date.now() - statSync(bundlePath).mtimeMs) / 86_400_000;
    if (age < 7) ok('no remote, but a repo bundle exists off C:\\', `${age.toFixed(1)} days old`);
    else note('repo bundle is stale', `${age.toFixed(1)} days old -- run npm run backup:kit`);
  } else if (repoOnSystemDrive) {
    bad(
      'the CODE has no copy off the system drive',
      'no git remote and no bundle; a reset destroys the repo and the backup becomes unreadable',
    );
  } else {
    note('no remote, but the repo is not on the system drive', process.cwd());
  }

  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (!dirty) ok('working tree is clean', 'everything committed');
    else note('uncommitted changes', `${dirty.split('\n').length} file(s) would not be in a bundle/push`);
  } catch {
    bad('not a git repository', process.cwd());
  }

  /* ---------------------------------------------------------------- */
  section('4. What a reset takes with it');

  // Enumerated rather than assumed. Each of these lives only on C:\.
  if (existsSync('.env.local')) {
    const env = readFileSync('.env.local', 'utf8');
    const keys = [...env.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);

    // The copy lives on the NON-synced drive on purpose: it survives a C:\
    // reset without being uploaded to anyone's cloud. That is why the scratch
    // dir sits outside PersistentData. See backup-recovery-kit.ps1.
    const secretCopy = cfg.samplerLogDir
      ? join(resolve(cfg.samplerLogDir, '..'), 'recovery', '.env.local')
      : '';
    if (secretCopy && existsSync(secretCopy)) {
      // Compare contents: a copy taken before the password was rotated is
      // worse than none, because it looks like protection.
      const same = readFileSync(secretCopy, 'utf8').trim() === env.trim();
      if (same) ok('secrets have a copy off the system drive', secretCopy);
      else bad('secrets copy is STALE', `${secretCopy} differs from .env.local -- run npm run backup:kit`);
    } else {
      bad(
        'secrets are gitignored and live only on C:\\',
        `${keys.join(', ')} would be LOST. The phone keeps pushing to a token the rebuilt server never heard of, and fails silently. Run: npm run backup:kit`,
      );
    }
  } else {
    note('.env.local is absent', 'the dashboard fails closed without DASHBOARD_PASSWORD');
  }

  // The APK signing key. Losing it does not lose data, but every later
  // release stops installing over the published one: the phones would have
  // to uninstall the app, re-grant usage access and re-enter the token. The
  // .jks is created in the recovery dir, so it must NOT be on C:\, and the
  // properties file naming it (gitignored, with the passwords) needs its copy.
  const ksProps = join('android', 'keystore.properties');
  if (existsSync(ksProps)) {
    const text = readFileSync(ksProps, 'utf8');
    const store = /^storeFile=(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    const propsCopy = cfg.samplerLogDir
      ? join(resolve(cfg.samplerLogDir, '..'), 'recovery', 'keystore.properties')
      : '';
    if (!store || !existsSync(store)) {
      bad('APK signing key is MISSING', `${ksProps} names ${store || 'nothing'}, which does not exist`);
    } else if (onSystemDrive(store)) {
      bad('APK signing key lives on the system drive', `${store} -- move it to <scratchDir>\\recovery\\ and update ${ksProps}`);
    } else if (!propsCopy || !existsSync(propsCopy)) {
      bad('APK signing passwords live only on C:\\', `${ksProps} has no copy -- run npm run backup:kit`);
    } else if (readFileSync(propsCopy, 'utf8').trim() !== text.trim()) {
      bad('APK signing properties copy is STALE', `${propsCopy} differs from ${ksProps} -- run npm run backup:kit`);
    } else {
      ok('APK signing key and passwords are off the system drive', store);
    }
  } else {
    note('no APK signing key configured', 'assembleRelease would build UNSIGNED');
  }

  // The local-only files: gitignored, so the repo's remote does not have them
  // and only the kit's mirror survives a reset. Compared BYTE FOR BYTE, for the
  // same reason as the secrets above: a copy taken before the last logo was
  // added looks like protection and is not.
  const localCopy = backupDir ? join(backupDir, 'local-files') : '';
  const localFiles = ['config/collector.json', 'config/app-colours.json'].filter((f) => existsSync(f));
  const walk = (dir: string): string[] => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? walk(p) : e.name === 'README.md' ? [] : [p];
    });
  };
  const logoFiles = walk(join('public', 'apps_logo'));
  const missing: string[] = [];
  const stale: string[] = [];
  for (const f of [...localFiles, ...logoFiles]) {
    const copy = join(localCopy, f);
    if (!localCopy || !existsSync(copy)) missing.push(f);
    else if (!readFileSync(copy).equals(readFileSync(f))) stale.push(f);
  }
  const extra = localCopy
    ? walk(join(localCopy, 'public', 'apps_logo')).filter(
        (c) => !existsSync(join('public', 'apps_logo', c.slice(join(localCopy, 'public', 'apps_logo').length + 1))),
      )
    : [];
  const what = `${localFiles.length} config file(s) + ${logoFiles.length} logo(s)`;
  if (missing.length === 0 && stale.length === 0) {
    ok('local-only files have a current copy off the system drive', `${what} in ${localCopy}`);
  } else {
    bad(
      'local-only files are NOT all backed up',
      `${missing.length} missing, ${stale.length} stale (e.g. ${[...missing, ...stale].slice(0, 3).join(', ')}). They are gitignored, so a reset loses them. Run: npm run backup:kit`,
    );
  }
  if (extra.length > 0) note('the copy holds files deleted here', `${extra.length} -- re-run npm run backup:kit to mirror`);

  // Scheduled tasks live in the C:\ task store and die with it. Rebuilding
  // them from a script beats exporting XML, whose embedded <UserId> is this
  // install's SID and will not resolve on a rebuilt machine.
  const taskScripts: [string, string][] = [
    ['scripts/install-sampler.ps1', 'Screen Time Sampler + Screen Time Ingest (collection)'],
    ['scripts/install-autostart.ps1', 'Start Screen Time Dashboard (serving)'],
  ];
  for (const [script, what] of taskScripts) {
    if (existsSync(script)) ok(`${what} is rebuildable`, script);
    else bad(`no way to recreate ${what}`, `${script} missing`);
  }
  console.log('         (scripts, not exported XML: no stale SID to fix)');

  const logDir = cfg.samplerLogDir;
  if (logDir && !onSystemDrive(logDir)) {
    ok('un-ingested sampler output survives', logDir);
  } else {
    bad('sampler JSONL is on the system drive', `${logDir} -- up to a day of screen time lost`);
  }

  /* ---------------------------------------------------------------- */
  section('5. Hygiene that only bites during recovery');

  // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so a UTF-8 em-dash
  // becomes a string delimiter and silently changes the logic of the enclosing
  // block. It would be discovered while rebuilding a machine.

  // Recursive: the research scripts live in scripts/research/ and are just as
  // likely to be re-run on a rebuilt machine. .vbs too -- same host, same rule.
  const scripts = (readdirSync('scripts', { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ps1') || f.endsWith('.vbs'));
  const nonAscii = scripts.filter((f) => /[^\x00-\x7F]/.test(readFileSync(join('scripts', f), 'utf8')));
  if (nonAscii.length === 0) ok('every .ps1/.vbs is pure ASCII', `${scripts.length} script(s)`);
  else bad('non-ASCII in a PowerShell script', nonAscii.join(', '));

  if (cfg.databasePath && onSystemDrive(cfg.databasePath)) {
    bad('the live database is on the system drive', cfg.databasePath);
  } else {
    ok('the live database is off the system drive', cfg.databasePath ?? '');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
console.log('');
console.log(`${pass} passed, ${warn} warnings, ${fail} FAILURES`);
if (fail > 0) {
  console.log('');
  console.log('A failure here means the reset this project exists to survive would');
  console.log('cost you something. Fix it before trusting the backup.');
  process.exitCode = 1;
}
