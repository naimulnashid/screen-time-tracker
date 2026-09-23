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

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  ['com.google.android.GoogleCamera', 'Camera', 3],
  ['com.google.android.apps.nexuslauncher', 'Pixel Launcher', 5],
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
    let t = on + 3_000;
    const end = on + length;
    while (t < end) {
      const pkg = pick(PHONE_APPS.map(([p, , w]) => [p, w] as [string, number]));
      const next = Math.min(end, t + between(0.2, 12) * MIN);
      sessions!.push({ packageName: pkg, start: Math.round(t), end: Math.round(next) });
      t = next + between(1, 6) * 1000;
    }
  }
}

/* -------------------------------------------------------------- write */

rmSync(OUT, { recursive: true, force: true });
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
      deviceId: 'demo-pixel-8', label: 'Pixel 8', brand: 'Google', model: 'Pixel 8',
      androidRelease: '15', sdkInt: 35, eventsReachUtc: new Date(now - 10 * 24 * HOUR).toISOString(),
    },
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
    coverageEndMs: now,
    sessions: past(sessions),
    screen: past(screen),
    apps: PHONE_APPS.map(([packageName, label]) => ({ packageName, label, isSystem: false })),
  });

  // A few collection runs, so the Sync pages have a history to show.
  for (const [device, source] of [['zephyrus', 'win-sampler'], ['demo-pixel-8', 'android-events']] as const) {
    for (let i = 0; i < 6; i++) {
      const id = startSyncRun(db, device, source);
      finishSyncRun(db, id, {
        status: 'success', rowsRead: 40 + i, rowsInserted: 40 + i, rowsSkipped: 0,
        sourceOldestUtc: null, sourceNewestUtc: new Date(now - i * 6 * HOUR).toISOString(),
        backupStatus: null, durationMs: 180 + i * 20, error: null,
      });
    }
  }

  console.log(`demo written to ${OUT}`);
  console.log(`  laptop: ${laptopRows} hour-segments over ${DAYS - 7} days`);
  console.log(`  phone:  ${result.sessionSegments} session + ${result.screenSegments} screen segments, ${result.rejected} rejected`);
} finally {
  db.close();
}
