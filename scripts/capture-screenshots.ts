/**
 * The README's screenshots, from the DEMO -- never from real data.
 *
 *   npm run demo:shots            writes docs/screenshots/ (the opener + tour/)
 *
 * Every step CLAUDE.md lists for redoing them by hand, in one command:
 *
 *   1. A SCRATCH COPY of the repo is built, in TEMP. Never over the live
 *      `.next`: the dashboard serves from it, and a build underneath a running
 *      server breaks it (CLAUDE.md, "NEVER run next build while...").
 *      The copy leaves out everything local-only -- the logos, the real
 *      config -- so a real app inventory cannot reach a screenshot.
 *   2. The demo is seeded beside it (scripts/seed-demo.ts) and served on
 *      127.0.0.1:7849 with a throwaway password made up here.
 *   3. A session cookie is minted with issueSession(), and headless Edge is
 *      driven over the DevTools protocol (Node's own WebSocket, no
 *      dependency).
 *
 * Three traps CLAUDE.md records, each handled below:
 *
 *   - A fixed sleep is not a wait: wait for the URL, readyState, and the
 *     page height to stop changing.
 *   - Cards fade in on a staggered delay that reduced motion does not
 *     remove, so `animation: none` is injected and focus is emulated.
 *   - The Sync page reads "Running" only with a heartbeat under a minute
 *     old, so one is written just before that shot.
 *
 * Full-page shots grow the viewport to the page's scrollHeight rather than
 * stitching, at 1440px wide.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { issueSession, SESSION_COOKIE } from '../src/lib/auth';

const ROOT = resolve('.');
const WORK = resolve(process.argv[2] ?? join(tmpdir(), 'screentime-shots'));
const OUT = join(ROOT, 'docs', 'screenshots');
const PORT = 7849;
const CDP = 9333;
const WIDTH = 1440;
const HERO_HEIGHT = 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const LAPTOP = '/windows/my-laptop';
const PHONE = '/android/my-phone';

/** [file, path, full page?] -- the full-page tour, then the README's one-screen opener. */
const SHOTS: [string, string, boolean][] = [
  ['tour/laptop-1-overview.png', LAPTOP, true],
  ['tour/laptop-2-by-app.png', `${LAPTOP}/apps`, true],
  ['tour/laptop-3-app-detail.png', `${LAPTOP}/apps/exe%3Acode`, true],
  ['tour/laptop-4-activity.png', `${LAPTOP}/activity`, true],
  ['tour/laptop-5-sync.png', `${LAPTOP}/sync`, true],
  ['tour/phone-1-overview.png', PHONE, true],
  ['tour/phone-2-by-app.png', `${PHONE}/apps`, true],
  ['tour/phone-3-app-detail.png', `${PHONE}/apps/com.google.android.youtube`, true],
  ['tour/phone-4-activity.png', `${PHONE}/activity`, true],
  ['tour/phone-5-sync.png', `${PHONE}/sync`, true],
  ['laptop-overview.png', LAPTOP, false],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const children: ChildProcess[] = [];
function cleanup() {
  for (const c of children) {
    // A tree kill: next start and Edge both spawn children of their own.
    if (c.pid) try { execFileSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { /* gone */ }
  }
}
process.on('exit', cleanup);

async function up(url: string, ms = 60_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).status < 500) return true; } catch { /* not yet */ }
    await sleep(500);
  }
  return false;
}

/* ---------------------------------------------------------- 1. the copy -- */

async function main() {
  if (!EDGE) throw new Error('Microsoft Edge not found.');
  if (await up(BASE, 1000)) throw new Error(`Something already answers on ${PORT}; stop it first (npm run demo?).`);

  console.log(`scratch copy -> ${WORK}`);
  rmSync(WORK, { recursive: true, force: true });
  const SKIP = ['node_modules', '.next', '.git', '.claude', 'demo', 'docs', 'android', 'logs', 'private'];
  cpSync(ROOT, WORK, {
    recursive: true,
    filter: (src) => {
      const r = relative(ROOT, src).split(sep).join('/');
      if (!r) return true;
      if (SKIP.includes(r.split('/')[0]!)) return false;
      // Local-only: the logo files (an app inventory) and the real configs.
      if (r.startsWith('public/apps_logo/') && r !== 'public/apps_logo/README.md') return false;
      if (r === 'config/collector.json' || r === 'config/app-colours.json' || r === '.env.local') return false;
      return true;
    },
  });
  symlinkSync(join(ROOT, 'node_modules'), join(WORK, 'node_modules'), 'junction');
  // Turbopack refuses a node_modules link that points outside the project
  // root ("points out of the filesystem root"), and copying node_modules is
  // slow. So the COPY's config -- never the real one -- widens the root to
  // the nearest folder holding both.
  const a = WORK.split(sep);
  const b = ROOT.split(sep);
  let common = 0;
  while (common < a.length && common < b.length && a[common]!.toLowerCase() === b[common]!.toLowerCase()) common++;
  const shared = a.slice(0, common).join(sep) + sep;
  const config = join(WORK, 'next.config.mjs');
  writeFileSync(config, readFileSync(config, 'utf8').replace(
    'export default nextConfig;',
    `nextConfig.turbopack = { ...(nextConfig.turbopack ?? {}), root: ${JSON.stringify(shared)} };\nexport default nextConfig;`,
  ));

  console.log('building the scratch copy');
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { cwd: WORK, stdio: 'inherit' });

  /* ------------------------------------------------ 2. seed and serve -- */

  const demo = join(WORK, 'demo');
  console.log('seeding the demo');
  // Before noon, the demo is seeded as of 9 PM yesterday: every day it then
  // shows is complete, rather than a "today" a few minutes long.
  const asOf = new Date();
  if (asOf.getHours() < 12) { asOf.setDate(asOf.getDate() - 1); asOf.setHours(21, 0, 0, 0); }
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/seed-demo.ts', demo], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, DEMO_NOW: asOf.toISOString() },
  });

  const password = randomBytes(18).toString('base64url');
  const server = spawn(process.execPath, [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', WORK, '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: demo, env: { ...process.env, DASHBOARD_PASSWORD: password }, stdio: 'ignore',
  });
  children.push(server);
  if (!(await up(`${BASE}/login`))) throw new Error('the demo server did not start');

  /* ------------------------------------------------------- 3. capture -- */

  const profile = join(WORK, 'edge-profile');
  mkdirSync(profile, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HERO_HEIGHT}`, '--hide-scrollbars', '--force-device-scale-factor=1',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  children.push(edge);
  if (!(await up(`http://127.0.0.1:${CDP}/json/version`, 20_000))) throw new Error('Edge did not open its DevTools port');
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map<number, (v: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
  };
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result ?? {})));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return (r['result'] as { value: T }).value;
  };
  const size = (height: number) => send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });

  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const session = await issueSession(password);
  await send('Network.setCookie', { name: SESSION_COOKIE, value: session.value, domain: '127.0.0.1', path: '/', httpOnly: true });

  for (const [file, path, full] of SHOTS) {
    if (path.endsWith('/sync')) {
      writeFileSync(join(demo, 'sampler', 'sampler-status.json'), JSON.stringify({
        updated: new Date().toISOString(),
        interval_seconds: 2,
        in_flight: { kind: 'app', app: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', ms: 754_000 },
      }));
    }
    await size(HERO_HEIGHT);
    await send('Page.navigate', { url: BASE + path });
    // Wait for THIS document, not the last one: the URL, then readyState.
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      const ready = await evaluate<boolean>(`location.href === ${JSON.stringify(BASE + path)} && document.readyState === 'complete'`).catch(() => false);
      if (ready) break;
    }
    await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'; document.head.appendChild(s); })()`);
    // Then for the page to stop growing: charts measure themselves, and a
    // card arriving late changes the height a full-page shot is cut at.
    let last = -1;
    for (let stable = 0, i = 0; stable < 4 && i < 60; i++) {
      await sleep(250);
      const h = await evaluate<number>('document.documentElement.scrollHeight');
      stable = h === last ? stable + 1 : 0;
      last = h;
    }
    const height = full ? Math.max(HERO_HEIGHT, last) : HERO_HEIGHT;
    await size(height);
    // Charts re-measure on the resize; let their bars draw.
    await sleep(1500);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 } });
    mkdirSync(join(OUT, 'tour'), { recursive: true });
    writeFileSync(join(OUT, file), Buffer.from(String(shot['data']), 'base64'));
    console.log(`  ${file}  ${WIDTH}x${height}`);
  }

  ws.close();
  cleanup();
  children.length = 0;
  await sleep(500);
  rmSync(WORK, { recursive: true, force: true });
  console.log('done; look at every image before committing it.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  cleanup();
  process.exitCode = 1;
});
