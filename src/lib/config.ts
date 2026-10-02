/**
 * Reading `config/collector.json`.
 *
 * NOT `server-only`. It reads one JSON file and imports no Node database
 * driver, and marking it would make every module that needs a path -- including
 * the unit-testable sampler-status reader -- untestable from a plain script.
 *
 * Its own module, unlike the sibling project where the same JSON is read in
 * two different places inside `queries.ts` -- once for the database path and
 * once for the device label, each with its own inline cast and its own
 * fallback. That is two chances to disagree about the shape of one file.
 *
 * Nothing in this project hardcodes `D:\`. Every path lives in that JSON, so a
 * restore onto a machine with different drive letters is a config edit rather
 * than a search through the source.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectorConfig } from './db';
import { slugify } from './slug';

let cached: Partial<CollectorConfig> | null = null;

/**
 * The config, or an empty object if it cannot be read.
 *
 * Deliberately does not throw. The dashboard has to be able to render a "no
 * database yet" state before the collector has ever run, and on a fresh clone
 * that includes the case where `config/collector.json` has not been filled in.
 * The collector scripts, which genuinely cannot proceed without it, validate
 * their own required fields instead.
 */
export function loadConfig(): Partial<CollectorConfig> {
  if (cached) return cached;
  try {
    cached = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'collector.json'), 'utf8'),
    ) as Partial<CollectorConfig>;
  } catch {
    cached = {};
  }
  return cached;
}

export function dbPath(): string | undefined {
  return loadConfig().databasePath;
}

/**
 * What this machine is called.
 *
 * From config, so the two places that show it -- the sidebar and the Overview
 * title -- cannot drift, and renaming the laptop is a config edit rather than
 * a code change. The Android side reads the equivalent from the phone;
 * Windows has nothing to read, and a hostname is rarely what a person calls
 * their machine.
 */
export function deviceLabel(): string {
  return loadConfig().deviceLabel?.trim() || 'This PC';
}

/**
 * The laptop's URL segment: "Zephyrus G16" -> "zephyrus-g16".
 *
 * The laptop's pages live at `/windows/<slug>/...`, the same shape as
 * `/android/<slug>/...`, so an address names a DEVICE on both halves rather
 * than naming one on the phone side and nothing at all on the laptop's. The
 * bare `/`, `/apps` and `/sync` still work and redirect here, so every
 * bookmark and doc link written before the move survives.
 *
 * Derived from `deviceLabel()` rather than stored, because there is exactly
 * one laptop and nothing to disambiguate against: renaming the machine in
 * `collector.json` moves its URL with it, which is the same edit that moves
 * its heading and its sidebar entry. Nothing persists the old slug, so a
 * rename does break a bookmark -- an acceptable trade for the config file
 * staying the single source of what this machine is called.
 */
export function windowsSlug(): string {
  return slugify(deviceLabel());
}

/**
 * Where the laptop's screen time comes from, when it is NOT this project's own
 * sampler: Screen Time Native, the standalone Windows app, recording into its
 * own database. Null means the PowerShell sampler and its JSONL, as before.
 *
 * Two samplers on one machine record the same seconds twice, in two places
 * that never agree to the row (each samples on its own 2-second phase). So
 * one of them has to be the source, and from a stated instant: `nativeFrom`.
 * The ingest copies native rows from there on; everything earlier stays as
 * this project's sampler recorded it.
 *
 * The heartbeat is Screen Time Native's too -- it is the sampler that is
 * actually running. Its folder is on C: (the native app keeps its working
 * folder there on purpose), and only the heartbeat is read from it.
 */
export interface NativeSource {
  databasePath: string;
  from: string;
  heartbeatDir: string | null;
}

export function nativeSource(cfg: Partial<CollectorConfig> = loadConfig()): NativeSource | null {
  if (!cfg.nativeDatabasePath) return null;
  const local = process.env.LOCALAPPDATA;
  return {
    databasePath: cfg.nativeDatabasePath,
    from: cfg.nativeFrom ?? '',
    heartbeatDir: cfg.nativeSamplerDir ?? (local ? join(local, 'Screen Time Native', 'sampler') : null),
  };
}

export function databaseExists(): boolean {
  const p = dbPath();
  try {
    return p !== undefined && existsSync(p);
  } catch {
    return false;
  }
}
