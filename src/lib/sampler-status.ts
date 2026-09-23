/**
 * Reading the sampler's heartbeat.
 *
 * Its own module, and deliberately NOT `server-only`, so the parsing can be
 * exercised by `npm run selftest`. It touches no database -- just one small
 * JSON file -- and the logic in it (BOM handling, staleness) is exactly the
 * kind that fails silently.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config';

export interface SamplerStatus {
  /** True when the heartbeat exists and is recent enough to trust. */
  alive: boolean;
  updated: string | null;
  /** Seconds since the heartbeat was last written. */
  staleSeconds: number | null;
  intervalSeconds: number | null;
  inFlight: { kind: string; app: string; ms: number } | null;
}

/**
 * Is the sampler actually running right now?
 *
 * Read from the heartbeat file, NOT from the scheduled task's state. The task
 * reports 'Ready' even while the sampler runs, because its VBS launcher does
 * not wait for the child -- so task state answers a different question than
 * the one being asked here.
 *
 * The in-flight span is included because it is real time that has not been
 * written to the database yet. Measured on the Android side: ignoring the
 * in-flight session made "today" read a quarter below the phone's own figure.
 */
function samplerDir(): string | null {
  const cfg = loadConfig();
  if (cfg.samplerLogDir) return cfg.samplerLogDir;
  return cfg.scratchDir ? join(cfg.scratchDir, 'sampler') : null;
}

/** `overrideDir` exists only for the self-test; production passes nothing. */
export function getSamplerStatus(overrideDir?: string): SamplerStatus {
  const dead: SamplerStatus = {
    alive: false, updated: null, staleSeconds: null,
    intervalSeconds: null, inFlight: null,
  };

  const dir = overrideDir ?? samplerDir();
  if (!dir) return dead;

  const path = join(dir, 'sampler-status.json');
  try {
    if (!existsSync(path)) return dead;
    let raw = readFileSync(path, 'utf8');
    // Strip a BOM defensively. PowerShell 5.1 writes one from several APIs and
    // JSON.parse throws on it -- the sibling project lost a whole subsystem to
    // exactly this, where it failed silently and looked like no data.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

    const hb = JSON.parse(raw) as {
      updated?: string;
      interval_seconds?: number;
      in_flight?: { kind?: string; app?: string; ms?: number };
    };
    if (!hb.updated) return dead;

    const age = (Date.now() - Date.parse(hb.updated)) / 1000;
    const interval = hb.interval_seconds ?? 2;
    return {
      // Allow a generous multiple of the interval: the sampler sleeps between
      // ticks and the machine may be busy. Anything past a minute is dead.
      alive: Number.isFinite(age) && age >= 0 && age < Math.max(60, interval * 10),
      updated: hb.updated,
      staleSeconds: Number.isFinite(age) ? Math.round(age) : null,
      intervalSeconds: interval,
      inFlight: hb.in_flight
        ? {
            kind: hb.in_flight.kind ?? 'unknown',
            app: hb.in_flight.app ?? '',
            ms: hb.in_flight.ms ?? 0,
          }
        : null,
    };
  } catch {
    return dead;
  }
}
