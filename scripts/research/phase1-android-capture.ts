/**
 * Phase 1b, Android half: capture and CHARACTERISE, do not parse yet.
 *
 * The counterpart of the Windows probe, and it is deliberately split the same
 * way for the same reason. On the Windows side, `phase1-probe-windows.ps1`
 * captured and reported the schema, and `phase1-analyze-atp.ts` did the
 * arithmetic afterwards; that split let the analysis be re-run a dozen times
 * against one capture instead of costing an elevated VSS snapshot each time.
 * It also stopped a wrong assumption about column meaning from being baked
 * into a parser before anyone had looked at the data.
 *
 * `dumpsys usagestats` is not a documented contract. Its sections and field
 * names move between Android versions and OEM skins, and this project cannot
 * afford a parser written against remembered format -- by the time the numbers
 * are found to be wrong, the history is already stored wrong.
 *
 * So this script answers "what is actually in there", and the parser comes
 * after. Specifically it reports:
 *
 *   - which section headers exist, and how big each is
 *   - the full event-type vocabulary with counts (ACTIVITY_RESUMED,
 *     SCREEN_INTERACTIVE, KEYGUARD_*, ...), which is what decides whether
 *     screen-off can be subtracted at all
 *   - whether `totalTimeVisible` is present as well as `totalTime` -- the
 *     API 29+ field that disagrees with `totalTimeInForeground`
 *   - the earliest and latest timestamps, per interval, which is RETENTION,
 *     and retention is what sets the collector cadence
 *
 * Needs USB debugging and a connected device. Does NOT need root, and does NOT
 * need Administrator -- the same advantage the sibling project's Android half
 * has over its Windows one, and now a bigger one, since this project's Windows
 * collector will not need elevation either.
 *
 *   npm run android:capture
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* Locating adb and the device                                         */
/* ------------------------------------------------------------------ */

function adbPath(): string {
  const local = process.env['LOCALAPPDATA'] ?? '';
  const candidates = [
    join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    join(local, 'Android', 'sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ];
  for (const c of candidates) if (c === 'adb' || existsSync(c)) return c;
  throw new Error('adb not found. Install Android platform-tools.');
}

const ADB = adbPath();

function adb(args: string[], allowFail = false): string {
  try {
    return execFileSync(ADB, args, {
      encoding: 'utf8',
      // dumpsys usagestats runs to tens of MB on a device with real history.
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (err) {
    if (allowFail) return `__FAILED__ ${(err as Error).message}`;
    throw err;
  }
}

function requireOneDevice(): string {
  const lines = adb(['devices'])
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);

  const ready = lines.filter((l) => l.endsWith('\tdevice')).map((l) => l.split('\t')[0]!);
  const unauthorised = lines.filter((l) => l.endsWith('\tunauthorized'));

  if (unauthorised.length) {
    throw new Error(
      'Device is connected but UNAUTHORISED.\n' +
        'Unlock the phone and accept the "Allow USB debugging?" prompt, then re-run.',
    );
  }
  if (ready.length === 0) {
    throw new Error(
      'No device. Connect the phone over USB with USB debugging enabled.\n' +
        'Check with: adb devices',
    );
  }
  if (ready.length > 1) {
    throw new Error(`More than one device attached: ${ready.join(', ')}`);
  }
  return ready[0]!;
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

/**
 * Defensive rather than known-necessary.
 *
 * The sibling project MEASURED the SIM's IMSI in every `dumpsys netstats`
 * mobile ident and strips it before anything reaches disk. Whether
 * `dumpsys usagestats` carries anything equivalent has not been measured --
 * which is exactly why the same pass runs here, and why the assertion below
 * runs afterwards. Strip first, confirm second; never capture raw and redact
 * on display.
 *
 * Package names are deliberately NOT stripped. They are the data.
 */
function redact(text: string): string {
  return text
    .replace(/subscriberId=[^,\]\s}]*/g, 'subscriberId=<redacted>')
    .replace(/subscriberIds=\[[^\]]*\]/g, 'subscriberIds=[<redacted>]')
    .replace(/imsi=[^,\]\s}]*/g, 'imsi=<redacted>')
    // IMEI/IMSI/ICCID-shaped runs of 14+ digits. Timestamps are 13, so this
    // does not eat them.
    .replace(/\b\d{14,22}\b/g, '<redacted-long-number>');
}

function assertRedacted(text: string, label: string): void {
  for (const pat of [/subscriberId=(?!<redacted)/, /\bimsi=(?!<redacted)/i]) {
    if (pat.test(text)) throw new Error(`Redaction failed in ${label}: ${pat}`);
  }
}

/* ------------------------------------------------------------------ */
/* Where captures land                                                 */
/* ------------------------------------------------------------------ */

function scratchDir(): string {
  // Read the JSON directly. src/lib/config.ts is `server-only` and importing
  // it from a plain tsx script throws.
  let base = '';
  try {
    const cfg = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
    ) as { scratchDir?: string };
    base = cfg.scratchDir ?? '';
  } catch {
    /* fall through */
  }
  // Fall back to TEMP rather than failing: a capture is worth having even on a
  // machine where D:\ does not exist.
  if (!base) base = join(process.env['TEMP'] ?? '.', 'screentime-scratch');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(base, 'android', stamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

interface Probe {
  name: string;
  args: string[];
  file: string;
  optional?: boolean;
}

const PROBES: Probe[] = [
  { name: 'usagestats (full)', args: ['shell', 'dumpsys', 'usagestats'], file: 'usagestats.txt' },
  // Documented on some builds as the compact per-package view. Optional
  // because it is not present everywhere, and it is cheap to ask.
  { name: 'usagestats --checkin', args: ['shell', 'dumpsys', 'usagestats', '--checkin'], file: 'usagestats-checkin.txt', optional: true },
  { name: 'app standby', args: ['shell', 'dumpsys', 'usagestats', 'appstandby'], file: 'usagestats-appstandby.txt', optional: true },
  { name: 'device properties', args: ['shell', 'getprop'], file: 'getprop.txt' },
  { name: 'package -> uid map', args: ['shell', 'pm', 'list', 'packages', '-U'], file: 'packages-uid.txt' },
  { name: 'battery/screen state', args: ['shell', 'dumpsys', 'power'], file: 'power.txt', optional: true },
];

/* ------------------------------------------------------------------ */
/* Characterisation                                                    */
/* ------------------------------------------------------------------ */

/** Tokens whose presence or absence changes the design. */
const TOKENS = [
  'totalTime=',
  'totalTimeVisible',
  'totalTimeFS',            // foreground-service time, API 29+
  'lastTimeUsed',
  'lastTimeVisible',
  'appLaunchCount',
  'timeRange',
  'package=',
  'ACTIVITY_RESUMED',
  'ACTIVITY_PAUSED',
  'ACTIVITY_STOPPED',
  'SCREEN_INTERACTIVE',
  'SCREEN_NON_INTERACTIVE',
  'KEYGUARD_SHOWN',
  'KEYGUARD_HIDDEN',
  'DEVICE_SHUTDOWN',
  'DEVICE_STARTUP',
  'FOREGROUND_SERVICE_START',
  'In-memory daily stats',
  'In-memory weekly stats',
  'In-memory monthly stats',
  'In-memory yearly stats',
];

function characterise(dump: string): void {
  const lines = dump.split(/\r?\n/);
  console.log(`\n  lines: ${lines.length.toLocaleString()}`);

  // --- section headers: shallow-indent lines that look structural ---
  const headers = new Map<string, number>();
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (!t || indent > 4) continue;
    if (/^(User |In-memory |Configurations|Events|Packages|ChooserCounts|Pending|Settings|App|Screen|Last|Idle|Flags)/i.test(t)
      || /:$/.test(t)) {
      // Collapse the varying tail so "User [0]" and "User [10]" group.
      const key = t.replace(/\d+/g, 'N').slice(0, 60);
      headers.set(key, (headers.get(key) ?? 0) + 1);
    }
  }
  console.log('\n  --- section headers (digits collapsed to N) ---');
  for (const [h, n] of [...headers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`    ${String(n).padStart(6)}  ${h}`);
  }

  // --- token census: what vocabulary exists at all ---
  console.log('\n  --- token census ---');
  for (const tok of TOKENS) {
    let n = 0;
    let idx = dump.indexOf(tok);
    while (idx !== -1) {
      n++;
      idx = dump.indexOf(tok, idx + tok.length);
    }
    const mark = n === 0 ? 'ABSENT' : String(n);
    console.log(`    ${tok.padEnd(26)} ${mark.padStart(9)}`);
  }

  // --- the event vocabulary, which decides whether screen-off is subtractable ---
  const types = new Map<string, number>();
  for (const m of dump.matchAll(/\btype=([A-Z_]+)/g)) {
    types.set(m[1]!, (types.get(m[1]!) ?? 0) + 1);
  }
  if (types.size) {
    console.log('\n  --- event types seen (type=...) ---');
    for (const [t, n] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(8)}  ${t}`);
    }
  } else {
    console.log('\n  --- no `type=` tokens; events may be rendered differently here ---');
  }

  // --- retention: the span of every timestamp-looking value we can find ---
  //
  // Two encodings appear in these dumps: epoch milliseconds, and rendered
  // "YYYY-MM-DD HH:MM:SS". Both are collected; the widest span is retention,
  // and retention is what sets the collector cadence.
  const epochs: number[] = [];
  for (const m of dump.matchAll(/\b(1[6-9]\d{11})\b/g)) epochs.push(Number(m[1]));
  const rendered: string[] = [];
  for (const m of dump.matchAll(/\b(20\d{2}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/g)) rendered.push(m[1]!);

  console.log('\n  --- apparent time range ---');
  if (epochs.length) {
    epochs.sort((a, b) => a - b);
    const lo = epochs[0]!;
    const hi = epochs[epochs.length - 1]!;
    console.log(`    epoch-ms values : ${epochs.length.toLocaleString()}`);
    console.log(`    earliest        : ${new Date(lo).toISOString()}`);
    console.log(`    latest          : ${new Date(hi).toISOString()}`);
    console.log(`    span            : ${((hi - lo) / 86_400_000).toFixed(1)} days`);
  } else {
    console.log('    no epoch-ms values found');
  }
  if (rendered.length) {
    rendered.sort();
    console.log(`    rendered stamps : ${rendered.length.toLocaleString()}`);
    console.log(`    earliest        : ${rendered[0]}`);
    console.log(`    latest          : ${rendered[rendered.length - 1]}`);
  }

  // --- a few real lines, so the next pass writes a parser against fact ---
  console.log('\n  --- sample lines containing "package=" ---');
  let shown = 0;
  for (const line of lines) {
    if (line.includes('package=') && line.trim()) {
      console.log(`    ${line.trim().slice(0, 160)}`);
      if (++shown >= 6) break;
    }
  }
  if (shown === 0) console.log('    none found');
}

/* ------------------------------------------------------------------ */

function main(): void {
  const serial = requireOneDevice();
  const outDir = scratchDir();

  const props = adb(['shell', 'getprop']);
  const prop = (k: string) =>
    (new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]: \\[([^\\]]*)\\]`).exec(props)?.[1] ?? '?');

  console.log('=== Device ===');
  console.log(`  serial   : ${serial}`);
  console.log(`  model    : ${prop('ro.product.model')}`);
  console.log(`  brand    : ${prop('ro.product.brand')}`);
  console.log(`  Android  : ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})`);
  console.log(`  capture  : ${outDir}`);

  console.log('\n=== Capturing ===');
  let mainDump = '';
  for (const p of PROBES) {
    const raw = adb(p.args, p.optional);
    if (raw.startsWith('__FAILED__')) {
      console.log(`  [skip] ${p.name}: not available on this build`);
      continue;
    }
    const clean = redact(raw);
    assertRedacted(clean, p.file);
    writeFileSync(join(outDir, p.file), clean, 'utf8');
    console.log(`  [ok]   ${p.name.padEnd(24)} ${(clean.length / 1024).toFixed(0).padStart(7)} KB  -> ${p.file}`);
    if (p.file === 'usagestats.txt') mainDump = clean;
  }

  if (!mainDump) {
    console.log('\n  dumpsys usagestats produced nothing. Nothing to characterise.');
    return;
  }

  console.log('\n=== Characterising dumpsys usagestats ===');
  characterise(mainDump);

  console.log(`

=== What to do next ===

  1. On the PHONE, open Settings -> Digital Wellbeing and note today's total
     screen time, and yesterday's. That is the number every figure this
     project produces has to be checked against -- Digital Wellbeing derives
     it from EVENTS, which is why apps that use totalTimeInForeground
     disagree with it.

  2. Paste this output back. The token census and event vocabulary above
     decide the schema, and the time range decides the collector cadence.

  Capture kept at:
    ${outDir}

  It is outside the repo and outside the Drive-synced tree, and it names every
  app you opened and when. Delete it once the parser is written.
`);
}

main();
