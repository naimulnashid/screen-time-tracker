/**
 * `npm start`: the dashboard on :7844, restarted in place on a new build.
 *
 *   node scripts/run-next-start.mjs
 *
 * `next start` reads part of `.next` at boot and the rest lazily, so a build
 * run under it leaves a server serving two builds at once: pages fail with
 * the error boundary and stylesheets come back as HTML. The sibling Data
 * Usage Tracker lost By App on every phone to it on 2026-10-29, a server from
 * 13:35 serving an 18:40 build. So this watches `.next` and, once a build has
 * FINISHED, restarts Next on it: same wrapper, same log, same command line.
 * Pages are still broken while the build runs; nothing short of building
 * elsewhere avoids that.
 *
 * "Finished" is not "BUILD_ID changed": Next writes BUILD_ID before static
 * generation, traces and manifests (`writeBuildId` in
 * next/dist/build/index.js), so a restart on it alone boots a half-built
 * `.next`. It is BUILD_ID changed AND nothing under `.next` written for
 * QUIET_MS, apart from the caches the server itself writes.
 *
 * Next is started from THIS repo's node_modules by full path, so the
 * listener's command line still names `<repo>\node_modules\`: that is how
 * dashboard-stop.ps1 and dashboard-service.ps1 tell this dashboard from the
 * other node servers on the machine. It binds every interface, as plain
 * `next start` did: the phones post to it over the LAN.
 *
 * Telemetry is turned off for the server too, though only `next build`
 * reports anything.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NEXT = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const DIST = join(ROOT, '.next');
const PORT = process.env.PORT ?? '7844';
const POLL_MS = 2000;
const QUIET_MS = 15000;

/** The build's id, or null while there is none (a build clears `.next` first). */
function buildId() {
  try {
    return readFileSync(join(DIST, 'BUILD_ID'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Newest write under `.next`, leaving out what a running server writes on
 * requests: `cache/` and `server/route-cache/`. Counting those, a dashboard
 * in use could hold the quiet window open forever.
 */
function newestWrite(dir = DIST) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === DIST && entry.name === 'cache') continue;
      if (dir === join(DIST, 'server') && entry.name === 'route-cache') continue;
      newest = Math.max(newest, newestWrite(path));
    } else {
      try {
        newest = Math.max(newest, statSync(path).mtimeMs);
      } catch {
        // Deleted between the listing and the stat: the build is still going.
        return Date.now();
      }
    }
  }
  return newest;
}

/** Local time as dashboard-service.ps1 writes it, so the log reads as one. */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

let child;
let restarting = false;

function run() {
  child = spawn(process.execPath, [NEXT, 'start', '-p', PORT], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  // Exit with Next's own code, so the launchers see the server's outcome
  // rather than this wrapper's -- unless this wrapper stopped it to restart.
  child.on('exit', (code, signal) => {
    if (restarting) {
      restarting = false;
      run();
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (!existsSync(NEXT)) {
  console.error(`Next.js not found at ${NEXT}: run npm install first.`);
  process.exit(1);
}

run();

// Pass Ctrl+C and stop signals through.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restarting = false;
    child.kill(sig);
  });
}

let serving = buildId();
setInterval(() => {
  const id = buildId();
  if (restarting || !id || id === serving) return;
  if (!existsSync(join(DIST, 'server'))) return;
  if (Date.now() - newestWrite() < QUIET_MS) return;
  console.log(`${stamp()}  New build ${id} (was ${serving ?? 'none'}): restarting the server on it.`);
  serving = id;
  restarting = true;
  child.kill();
}, POLL_MS).unref();
