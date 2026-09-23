/**
 * Phase 1, Windows half: what IS `DurationMs`?
 *
 * `scripts/phase1-probe-windows.ps1` settled the first question -- SRUM's
 * AppTimelineProvider table IS populated on Windows 11 build 26200, with
 * 46,243 rows over ~7 days. It also produced a surprise: SrumECmd 2026.5.0
 * surfaces only 12 columns, and there is **no `InFocusDuration`**. The one
 * duration is `DurationMs`, sitting directly beside `EndTime`.
 *
 * That placement is suspicious. If `DurationMs == EndTime - Timestamp`, the
 * column is a SPAN -- "this app existed between these two instants" -- and is
 * emphatically NOT screen time. Two apps can span the same hour; only one can
 * be in focus. Summing spans as though they were focus time would produce a
 * dashboard reporting far more than 24 hours in a day, which is the project's
 * defining trap arriving on day one.
 *
 * This script decides it, with four tests that do not depend on each other:
 *
 *   1. SPAN TEST      does DurationMs equal EndTime - Timestamp?
 *   2. BUDGET TEST    does the sum exceed wall-clock time in the window?
 *   3. OVERLAP TEST   do different apps hold overlapping intervals?
 *   4. UNION TEST     how much of the window is covered by at least one row?
 *
 * Any ONE of "spans match", "budget over 100%", or "apps overlap" is enough to
 * disqualify DurationMs as screen time. They are all reported anyway, because
 * a disagreement between them would mean the data is stranger than either
 * hypothesis and is worth seeing before deciding anything.
 *
 * Unelevated, and reads only the CSVs the probe left in TEMP, so it can be
 * re-run freely without another 99 MB VSS snapshot.
 *
 *   npm run atp
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects, requireColumns } from './csv';

const HOUR = 3_600_000;

function csvDir(): string {
  const explicit = process.argv[2];
  const dir = explicit ?? join(process.env['TEMP'] ?? '', 'screentime-probe', 'csv');
  if (!existsSync(dir)) {
    throw new Error(
      `No CSVs at ${dir}\n` +
        `Run the probe first, from an ADMINISTRATOR PowerShell:\n` +
        `  powershell -ExecutionPolicy Bypass -File ` +
        `"${join(process.cwd(), 'scripts', 'research', 'phase1-probe-windows.ps1')}"`,
    );
  }
  return dir;
}

function findCsv(dir: string, table: string): string {
  const hit = readdirSync(dir).find((f) => f.includes(table) && f.endsWith('.csv'));
  if (!hit) throw new Error(`No ${table} CSV in ${dir}`);
  return join(dir, hit);
}

/**
 * SrumECmd emits `yyyy-MM-dd HH:mm:ss`, which `new Date()` reads as LOCAL
 * time. These timestamps are UTC. That does not matter for a duration (both
 * ends shift together) but it does for the window length and the union, so it
 * is parsed explicitly rather than left to the engine's guess.
 */
function parseUtc(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

interface Row {
  app: string;
  start: number;
  end: number;
  duration: number;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

/** Total length of the union of a set of intervals. */
function unionMs(intervals: { start: number; end: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0]!.start;
  let curEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const iv = sorted[i]!;
    if (iv.start > curEnd) {
      total += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    } else if (iv.end > curEnd) {
      curEnd = iv.end;
    }
  }
  return total + (curEnd - curStart);
}

/**
 * Peak concurrency: the largest number of rows covering any single instant.
 *
 * A sweep over endpoints rather than a pairwise scan, because 46k rows is
 * 1.1 billion pairs. If the peak is 1 the column could be exclusive; anything
 * above 1 means rows genuinely coexist and cannot all be foreground.
 */
function peakConcurrency(intervals: { start: number; end: number }[]): number {
  const events: [number, number][] = [];
  for (const iv of intervals) {
    if (iv.end <= iv.start) continue;
    events.push([iv.start, 1], [iv.end, -1]);
  }
  // Close before open at the same instant, so touching intervals do not
  // register as overlapping.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peak = 0;
  for (const [, delta] of events) {
    cur += delta;
    if (cur > peak) peak = cur;
  }
  return peak;
}

/** Strip the NT device path down to a basename, as Windows itself displays it. */
function shortName(exeInfo: string, appId: string): string {
  if (!exeInfo) return `AppId ${appId}`;
  const cleaned = exeInfo.replace(/\\+$/, '');
  const last = cleaned.split('\\').pop() ?? cleaned;
  return last || cleaned;
}

function main(): void {
  const dir = csvDir();
  const file = findCsv(dir, 'AppTimelineProvider');
  console.log(`Reading ${file}\n`);

  const raw = parseCsvObjects(readFileSync(file, 'utf8'));
  // Exact names only. A regex probe for /Sid/ matches SidType, which is an
  // enum -- the sibling project shipped exactly that bug once.
  requireColumns(raw, ['Timestamp', 'EndTime', 'DurationMs', 'ExeInfo', 'AppId']);

  const rows: Row[] = [];
  let unparsable = 0;
  for (const r of raw) {
    const start = parseUtc(r['Timestamp'] ?? '');
    const end = parseUtc(r['EndTime'] ?? '');
    const duration = Number(r['DurationMs'] ?? '');
    if (start === null || end === null || !Number.isFinite(duration)) {
      unparsable++;
      continue;
    }
    rows.push({ app: shortName(r['ExeInfo'] ?? '', r['AppId'] ?? ''), start, end, duration });
  }

  console.log(`rows parsed      : ${rows.length.toLocaleString()}`);
  if (unparsable) console.log(`rows unparsable  : ${unparsable.toLocaleString()}`);
  if (rows.length === 0) return;

  // Loops, not Math.min(...spread): 46k arguments is close enough to V8's
  // argument limit to be a stack overflow waiting for a bigger capture.
  let windowStart = Infinity;
  let windowEnd = -Infinity;
  for (const r of rows) {
    if (r.start < windowStart) windowStart = r.start;
    if (r.end > windowEnd) windowEnd = r.end;
  }
  const windowMs = windowEnd - windowStart;
  const windowDays = windowMs / (24 * HOUR);
  console.log(`window           : ${new Date(windowStart).toISOString()} -> ${new Date(windowEnd).toISOString()}`);
  console.log(`window length    : ${windowDays.toFixed(2)} days (${(windowMs / HOUR).toFixed(1)} h)`);
  console.log(`distinct apps    : ${new Set(rows.map((r) => r.app)).size}`);

  /* ---------------------------------------------------------------- */
  /* 1. SPAN TEST                                                      */
  /* ---------------------------------------------------------------- */
  console.log('\n=== 1. ORDER TEST: how do Timestamp, EndTime and DurationMs relate? ===');
  //
  // The first version of this script assumed [Timestamp, EndTime] was a
  // forward interval and got peak concurrency 0 and NEGATIVE coverage -- both
  // impossible, and both the same bug: EndTime precedes Timestamp in nearly
  // every row, so every "interval" had negative length and was either skipped
  // or subtracted. Measure the order before assuming it.
  let endAfter = 0;
  let endBefore = 0;
  let endEqual = 0;
  const spans: number[] = [];
  for (const r of rows) {
    const span = r.end - r.start;
    spans.push(span);
    if (span > 0) endAfter++;
    else if (span < 0) endBefore++;
    else endEqual++;
  }

  const quantiles = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
    return [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => (at(p) / 60000).toFixed(1));
  };

  console.log(`  EndTime AFTER Timestamp : ${endAfter.toLocaleString()}  (${pct(endAfter, rows.length)})`);
  console.log(`  EndTime BEFORE          : ${endBefore.toLocaleString()}  (${pct(endBefore, rows.length)})`);
  console.log(`  equal                   : ${endEqual.toLocaleString()}  (${pct(endEqual, rows.length)})`);
  console.log(`  EndTime - Timestamp, minutes  [p05 p25 p50 p75 p95]: ${quantiles(spans).join('  ')}`);
  console.log(`  DurationMs, minutes           [p05 p25 p50 p75 p95]: ${quantiles(rows.map((r) => r.duration)).join('  ')}`);
  if (endBefore > rows.length * 0.5) {
    console.log('  >> EndTime PRECEDES Timestamp in most rows. So Timestamp is when');
    console.log('     the row was WRITTEN and EndTime is when the measured period');
    console.log('     ended; the interval is [EndTime - DurationMs, EndTime].');
  }

  /* ---------------------------------------------------------------- */
  /* 2. BUDGET TEST                                                    */
  /* ---------------------------------------------------------------- */
  console.log('\n=== 2. BUDGET TEST: does the sum fit inside wall-clock time? ===');
  const totalMs = rows.reduce((a, r) => a + r.duration, 0);
  console.log(`  sum of DurationMs: ${(totalMs / HOUR).toFixed(1)} h`);
  console.log(`  wall clock       : ${(windowMs / HOUR).toFixed(1)} h`);
  console.log(`  ratio            : ${(totalMs / windowMs).toFixed(2)}x`);
  console.log(`  implied per day  : ${(totalMs / HOUR / windowDays).toFixed(1)} h/day`);
  console.log(
    totalMs > windowMs
      ? '  >> VERDICT: OVER BUDGET. Cannot be exclusive foreground time.'
      : '  >> VERDICT: fits inside the window. Exclusivity still possible.',
  );

  /* ---------------------------------------------------------------- */
  /* 3. OVERLAP TEST                                                   */
  /* ---------------------------------------------------------------- */
  // Which end the duration hangs off cannot be read from the schema, so both
  // readings are computed and reported. If either shows rows coexisting, the
  // column is not exclusive foreground time under that reading either -- and
  // agreement between the two makes the conclusion independent of the guess.
  console.log('\n=== 3 + 4. CONCURRENCY AND COVERAGE, under both readings ===');
  const readings: { name: string; ivs: { start: number; end: number }[] }[] = [
    {
      name: 'anchored at EndTime   [End - Duration, End]',
      ivs: rows.map((r) => ({ start: r.end - r.duration, end: r.end })),
    },
    {
      name: 'anchored at Timestamp [Ts, Ts + Duration]',
      ivs: rows.map((r) => ({ start: r.start, end: r.start + r.duration })),
    },
  ];

  for (const reading of readings) {
    const valid = reading.ivs.filter((iv) => iv.end > iv.start);
    const peak = peakConcurrency(valid);
    const covered = unionMs(valid);
    console.log(`\n  ${reading.name}`);
    console.log(`    usable intervals : ${valid.length.toLocaleString()} / ${reading.ivs.length.toLocaleString()}`);
    console.log(`    peak concurrent  : ${peak}`);
    console.log(`    union coverage   : ${(covered / HOUR).toFixed(1)} h of ${(windowMs / HOUR).toFixed(1)} h  (${pct(covered, windowMs)})`);
    console.log(
      peak > 1
        ? `    >> up to ${peak} rows coexist. Only one thing can be in focus.`
        : '    >> never more than one row at a time. Consistent with focus.',
    );
  }

  /* ---------------------------------------------------------------- */
  /* Top apps                                                          */
  /* ---------------------------------------------------------------- */
  const byApp = new Map<string, { ms: number; rows: number }>();
  for (const r of rows) {
    const e = byApp.get(r.app) ?? { ms: 0, rows: 0 };
    e.ms += r.duration;
    e.rows++;
    byApp.set(r.app, e);
  }
  const top = [...byApp.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 20);

  console.log('\n=== Top 20 apps by summed DurationMs ===');
  console.log('  ' + 'app'.padEnd(38) + 'hours'.padStart(10) + 'h/day'.padStart(9) + 'rows'.padStart(8));
  for (const [app, e] of top) {
    console.log(
      '  ' +
        app.slice(0, 37).padEnd(38) +
        (e.ms / HOUR).toFixed(1).padStart(10) +
        (e.ms / HOUR / windowDays).toFixed(1).padStart(9) +
        String(e.rows).padStart(8),
    );
  }

  console.log(
    '\nCompare the top few against the UserAssist baseline in CLAUDE.md\n' +
      '(per-app focus minutes, cumulative since install).\n' +
      'If these are wildly larger for a 7-day window, that is another sign\n' +
      'DurationMs measures presence rather than attention.',
  );
}

main();
