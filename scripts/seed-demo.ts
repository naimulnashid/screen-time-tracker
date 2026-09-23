/**
 * A demo installation with SYNTHETIC data, for trying the dashboard without a
 * sampler or a phone -- and for the README's screenshots, which must never show
 * anyone's real usage.
 *
 *   npm run demo:seed          writes demo/ (gitignored)
 *   npm run build
 *   npm run demo               serves it on http://localhost:7849
 *
 * Deterministic: a seeded PRNG, so two runs on the same day draw the same
 * weeks. Every row goes through the SAME write path the real collectors use --
 * `segmentRows()` for the laptop, `ingestAndroid()` for the phone -- so the
 * demo cannot quietly disagree with what real data looks like.
 *
 * The database is written under demo/, which is usually on the system drive.
 * That is the one place the system-drive guard is bypassed on purpose: this is
 * throwaway data, and the guard exists to protect history that is not.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase, startSyncRun, finishSyncRun } from '../src/lib/db';
import { SEGMENT_INSERT_SQL, segmentRows, type Span } from '../src/lib/windows-ingest';
import { ingestAndroid, type AndroidPayload } from '../src/lib/android-ingest';

const OUT = resolve(process.argv[2] ?? 'demo');
const DAYS = 28;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** mulberry32: small, seeded, good enough for fake afternoons. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260923);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
function pick<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1]![0];
}

/** Local midnight `n` days before today. */
function dayStart(n: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

/* ------------------------------------------------------------ laptop */

const PF = 'C:\\Program Files';
const LAPTOP_APPS: [string, number][] = [
  [`C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe`, 30],
  [`${PF}\\Google\\Chrome\\Application\\chrome.exe`, 24],
  [`${PF}\\WindowsApps\\Microsoft.WindowsTerminal_1.21.2361.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe`, 12],
  [`C:\\Users\\demo\\AppData\\Roaming\\Spotify\\Spotify.exe`, 6],
  [`C:\\Windows\\explorer.exe`, 6],
  [`C:\\Users\\demo\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe`, 5],
  [`${PF}\\Microsoft Office\\root\\Office16\\WINWORD.EXE`, 5],
  [`${PF}\\Mozilla Firefox\\firefox.exe`, 4],
  [`C:\\Windows\\System32\\notepad.exe`, 3],
  [`${PF}\\VideoLAN\\VLC\\vlc.exe`, 3],
];

function laptopDay(start: number, weekend: boolean): Span[] {
  const spans: Span[] = [];
  const push = (from: number, to: number, kind: string, app = '') => {
    if (to <= from) return;
    spans.push({
      start: new Date(from).toISOString(), end: new Date(to).toISOString(),
      ms: to - from, kind, app, idle_ms: kind === 'app' ? Math.round(between(0, 40_000)) : 0,
    });
  };
  // Work blocks on weekdays, a shorter afternoon and evening at weekends.
  const blocks: [number, number][] = weekend
    ? [[between(11, 13), between(14, 16)], [between(20, 21), between(22, 23.5)]]
    : [[between(8.5, 9.5), between(12, 12.8)], [between(13.3, 14), between(17.5, 18.8)], [between(20.5, 21.5), between(22, 23.2)]];
  let last = start;
  for (const [from, to] of blocks) {
    const a = start + from * HOUR;
    const b = start + to * HOUR;
    push(last, a, last === start ? 'gap' : 'locked');
    let t = a;
    while (t < b) {
      const next = Math.min(b, t + between(2, weekend ? 45 : 35) * MIN);
      push(t, next, 'app', pick(LAPTOP_APPS));
      t = next;
    }
    last = b;
  }
  push(last, start + 24 * HOUR, 'gap');
  return spans;
}

/* ------------------------------------------------------------- phone */

const PHONE_APPS: [string, string, number][] = [
  ['com.google.android.youtube', 'YouTube', 22],
  ['com.whatsapp', 'WhatsApp', 18],
  ['com.android.chrome', 'Chrome', 14],
  ['com.spotify.music', 'Spotify', 9],
  ['org.telegram.messenger', 'Telegram', 8],
  ['com.google.android.apps.maps', 'Maps', 6],
  ['com.google.android.gm', 'Gmail', 6],
  ['com.duolingo', 'Duolingo', 4],
  ['com.google.android.calendar', 'Calendar', 3],
  ['com.android.camera2', 'Camera', 3],
  ['com.android.launcher3', 'Launcher', 5],
];

function phoneDay(start: number, sessions: AndroidPayload['sessions'], screen: AndroidPayload['screen']) {
  // Pick-ups through the day, denser in the evening. Sorted, and one waits for
  // the last to end: a real screen is never on twice at once, and overlapping
  // spans would inflate screen-on time past anything a phone could report.
  const pickups = Math.round(between(35, 60));
  const hours = Array.from({ length: pickups }, () => (rand() < 0.35 ? between(19, 23.5) : between(7, 19)))
    .sort((a, b) => a - b);
  let free = start;
  for (const hour of hours) {
    const on = Math.max(start + hour * HOUR, free + 30_000);
    const length = rand() < 0.7 ? between(0.3, 4) * MIN : between(5, 40) * MIN;
    if (on + length > start + 24 * HOUR) break;
    free = on + length + 8_000;
    screen!.push({ kind: 'screen_on', start: Math.round(on), end: Math.round(on + length + 8_000) });
    screen!.push({ kind: 'unlocked', start: Math.round(on + 3_000), end: Math.round(on + length + 8_000) });
    // Apps do NOT fill a pick-up. The lock screen, the gaps between apps and
    // the last moments before the screen goes off belong to no app -- measured
    // on a real phone, apps account for about 0.76x of screen-on time -- so the
    // demo leaves that time unclaimed rather than packing sessions edge to edge.
    let t = on + between(4, 20) * 1000;
    const end = on + length * between(0.72, 0.9);
    while (t < end) {
      const pkg = pick(PHONE_APPS.map(([p, , w]) => [p, w] as [string, number]));
      const next = Math.min(end, t + between(0.2, 12) * MIN);
      sessions!.push({ packageName: pkg, start: Math.round(t), end: Math.round(next) });
      t = next + between(4, 25) * 1000;
    }
  }
}

/* ------------------------------------------------------ brand colours */

// The demo's own config/app-colours.json, so its ranked charts draw brand
// colours the way a real installation's do. Keyed by the app's display name:
// with no logo file, `logoIdentity()` falls back to `logoKey(name)`. Camera and
// Launcher are left out on purpose -- they show the device-accent fallback.
const DEMO_COLOURS: Record<string, string> = {
  // laptop
  vscode: '#0065a9', googlechrome: '#fcd209', windowsterminal: '#ececf1',
  spotify: '#1ed760', fileexplorer: '#ffc928', discord: '#5865f2',
  word: '#1146ac', firefox: '#ff7139', notepad: '#43afcf', vlc: '#f48200',
  // phone
  youtube: '#ff0033', whatsapp: '#23b33a', chrome: '#fcd209', telegram: '#1d93d2',
  maps: '#34a853', gmail: '#ea4335', duolingo: '#58cc02', calendar: '#4797ff',
};

/* -------------------------------------------------------------- write */

// Rename first, then delete. Windows will not remove a folder a running
// process is using -- and `npm run demo` runs with demo/ as its working
// directory -- but rmSync deletes the files INSIDE before failing on the
// folder itself, which would take the running demo's database with it. A
// rename of a busy folder fails with nothing touched.
const doomed = `${OUT}.old-${process.pid}`;
try {
  renameSync(OUT, doomed);
} catch (err) {
  const code = (err as { code?: string }).code;
  if (code === 'EPERM' || code === 'EBUSY') {
    console.error(`${OUT} is in use -- stop \`npm run demo\` first, then seed again.`);
    process.exit(1);
  }
  if (code !== 'ENOENT') throw err;
}
rmSync(doomed, { recursive: true, force: true });
mkdirSync(join(OUT, 'config'), { recursive: true });
mkdirSync(join(OUT, 'sampler'), { recursive: true });
const dbPath = join(OUT, 'demo.db');

writeFileSync(join(OUT, 'config', 'collector.json'), JSON.stringify({
  _comment: 'DEMO -- synthetic data written by scripts/seed-demo.ts. Safe to delete.',
  deviceLabel: 'My Laptop',
  databasePath: dbPath,
  backupPath: join(OUT, 'backup', 'demo.db'),
  scratchDir: join(OUT, 'scratch'),
  samplerLogDir: join(OUT, 'sampler'),
  backupEnabled: false,
}, null, 2));

writeFileSync(join(OUT, 'config', 'app-colours.json'), JSON.stringify({
  $schema_note: 'DEMO -- brand colours for the demo apps. See config/app-colours.example.json.',
  colours: DEMO_COLOURS,
}, null, 2));

const db = openDatabase(dbPath, { allowSystemDrive: true });
try {
  const now = Date.now();
  const insert = db.prepare(SEGMENT_INSERT_SQL);
  const sessions: NonNullable<AndroidPayload['sessions']> = [];
  const screen: NonNullable<AndroidPayload['screen']> = [];
  let laptopRows = 0;

  db.exec('BEGIN');
  for (let n = DAYS - 1; n >= 0; n--) {
    const start = dayStart(n);
    const weekend = [0, 6].includes(new Date(start).getDay());
    // The laptop's first week is missing, as it would be for a sampler that
    // started recording later -- so the trend chart shows its gap handling.
    if (n < DAYS - 7) {
      for (const span of laptopDay(start, weekend)) {
        if (Date.parse(span.end) > now) continue;
        for (const row of segmentRows('zephyrus', span)) {
          insert.run(...row);
          laptopRows++;
        }
      }
    }
    phoneDay(start, sessions, screen);
  }
  db.exec('COMMIT');

  const past = <T extends { end: number }>(rows: T[]) => rows.filter((r) => r.end <= now);
  const result = ingestAndroid(db, {
    device: {
      // Generic on purpose, like "My Laptop": the demo names no real device.
      deviceId: 'demo-phone', label: 'My Phone',
      androidRelease: '15', sdkInt: 35, eventsReachUtc: new Date(now - 10 * 24 * HOUR).toISOString(),
    },
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
    coverageEndMs: now,
    sessions: past(sessions),
    screen: past(screen),
    apps: PHONE_APPS.map(([packageName, label]) => ({ packageName, label, isSystem: false })),
  });

  // A run history on each collector's real cadence -- the laptop's ingest
  // hourly, the phone every six hours -- so the Sync pages read like a live
  // installation rather than twelve runs stamped the same minute.
  // startSyncRun() stamps "now", so each run is backdated afterwards.
  const backdate = db.prepare('UPDATE sync_log SET started_at = ?, finished_at = ? WHERE id = ?');
  const cadence = [['zephyrus', 'win-sampler', 1, 10], ['demo-phone', 'android-events', 6, 8]] as const;
  for (const [device, source, everyHours, runs] of cadence) {
    for (let i = runs - 1; i >= 0; i--) {
      const at = now - (i * everyHours + between(0.05, 0.3)) * HOUR;
      const took = Math.round(between(120, 900));
      const stored = Math.round(source === 'win-sampler' ? between(20, 90) : between(300, 900));
      const id = startSyncRun(db, device, source);
      finishSyncRun(db, id, {
        status: 'success', rowsRead: stored, rowsInserted: stored, rowsSkipped: 0,
        sourceOldestUtc: null, sourceNewestUtc: new Date(at).toISOString(),
        backupStatus: 'ok', durationMs: took, error: null,
      });
      backdate.run(new Date(at).toISOString(), new Date(at + took).toISOString(), id);
    }
  }

  console.log(`demo written to ${OUT}`);
  console.log(`  laptop: ${laptopRows} hour-segments over ${DAYS - 7} days`);
  console.log(`  phone:  ${result.sessionSegments} session + ${result.screenSegments} screen segments, ${result.rejected} rejected`);
} finally {
  db.close();
}
