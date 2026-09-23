/**
 * The dominant brand colour of each logo in `public/apps_logo/`.
 *
 *   npx tsx scripts/measure-logo-colours.ts
 *
 * Prints proposals diffed against the local `config/app-colours.json`: new
 * logos to merge in, and entries where the map (usually a hand correction)
 * disagrees with the script.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THIS IS A SCRIPT, AND THE COLOURS IT PRINTS ARE MERGED BY HAND.
 *
 * It is deliberately NOT wired into the running dashboard, and `sharp` is
 * deliberately NOT added to package.json.
 *
 * `CLAUDE.md` picks `node:sqlite` over `better-sqlite3` on the grounds that a
 * native module with a build step is the most likely thing to break on a clean
 * `npm install` years from now -- which is precisely the reset-recovery
 * scenario this whole project exists for. `npm run restore` runs that install.
 * A native dependency that fails to build would fail the install outright, and
 * the database backup would be sitting there with nothing able to read it.
 *
 * So sharp is imported dynamically, only when this script runs, and only to
 * read PNG and JPG pixels. If it is missing, this script says so and exits;
 * nothing else in the project notices. The runtime does a plain map lookup.
 * ---------------------------------------------------------------------------
 *
 * SVGs need no decoder at all -- the paints are right there in the source.
 */

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { logoDir, allLogoFiles } from '../src/lib/app-logo';
import { loadBrandColours, brandColoursPath } from '../src/lib/app-colour';

/* ----------------------------------------------------------------- colour */

interface Rgb { r: number; g: number; b: number }

function parseHex(v: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const p = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** 0 (grey) .. 1 (fully saturated). */
function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** 0 (black) .. 1 (white). */
function lightness({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

/**
 * Is this pixel or paint worth considering as "the brand colour"?
 *
 * Logos are mostly white, black and transparency; those carry no identity, and
 * a naive average over every pixel returns a muddy grey for all of them.
 */
function isCandidate(c: Rgb): boolean {
  const l = lightness(c);
  return saturation(c) > 0.25 && l > 0.12 && l < 0.95;
}

/* -------------------------------------------------------------------- svg */

function fromSvg(source: string): { hex: string; note: string } | null {
  const attrs = [...source.matchAll(/(?:fill|stop-color|stroke)\s*=\s*"([^"]*)"/g)].map((m) => m[1]!);
  const styles = [...source.matchAll(/(?:fill|stop-color|stroke)\s*:\s*([^;"'}]+)/g)].map((m) => m[1]!.trim());

  const counts = new Map<string, number>();
  for (const raw of [...attrs, ...styles]) {
    const rgb = parseHex(raw);
    if (!rgb || !isCandidate(rgb)) continue;
    const hex = toHex(rgb);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  // Most-used wins; ties break toward the more saturated paint, which is the
  // one a person would call "the brand colour" rather than a shadow of it.
  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return saturation(parseHex(b[0])!) - saturation(parseHex(a[0])!);
  });
  return { hex: ranked[0]![0], note: `${counts.size} candidate paint(s), most used x${ranked[0]![1]}` };
}

/* ----------------------------------------------------------------- raster */

async function fromRaster(file: string): Promise<{ hex: string; note: string } | null> {
  // Typed loosely on purpose: sharp is not a declared dependency, so its types
  // are not guaranteed to be resolvable on a machine that has not installed it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharp: any;
  try {
    const mod: any = await import('sharp');
    sharp = mod.default ?? mod;
  } catch {
    throw new Error('sharp is not available. It is intentionally not a dependency -- install it just for this run:\n  npm i -D sharp\nand consider removing it again afterwards.');
  }

  // Small enough to be fast, big enough that a small brand mark on a white
  // field still contributes pixels.
  const { data, info } = await sharp(file)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Bucket by a coarse quantisation so near-identical pixels group, then take
  // the true average of the winning bucket for a colour that is actually in
  // the image rather than a quantised approximation of it.
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  const channels = info.channels;

  for (let i = 0; i < data.length; i += channels) {
    const a = channels === 4 ? data[i + 3]! : 255;
    if (a < 128) continue;
    const c = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    if (!isCandidate(c)) continue;
    const key = `${c.r >> 4}-${c.g >> 4}-${c.b >> 4}`;
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n += 1; b.r += c.r; b.g += c.g; b.b += c.b;
    buckets.set(key, b);
  }
  if (buckets.size === 0) return null;

  const win = [...buckets.values()].sort((x, y) => y.n - x.n)[0]!;
  return {
    hex: toHex({ r: win.r / win.n, g: win.g / win.n, b: win.b / win.n }),
    note: `${win.n} px in the winning bucket of ${buckets.size}`,
  };
}

/* ------------------------------------------------------------------- main */

const dir = logoDir();
const found: { key: string; name: string; hex: string; note: string }[] = [];
const missed: string[] = [];

// Every logo, root and device folders alike. The key emitted is the logo
// IDENTITY, so a scoped file proposes `nothing-a001/gallery` and lands in the
// map as its own entry rather than overwriting the shared one.
for (const logo of allLogoFiles()) {
  const ext = extname(logo.relPath).toLowerCase();
  const full = join(dir, logo.relPath);
  try {
    const result = ext === '.svg'
      ? fromSvg(readFileSync(full, 'utf8'))
      : await fromRaster(full);

    if (result) found.push({ key: logo.identity, name: logo.name, hex: result.hex, note: result.note });
    else missed.push(`${logo.relPath}  -- nothing but white, black or transparency`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('sharp is not available')) {
      console.error(`
${err.message}
`);
      process.exit(1);
    }
    missed.push(`${logo.relPath}  -- ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Diffed against the LOCAL map rather than printed whole, because the map is
// the answer and this script is a proposal: several entries are hand
// corrections of exactly what it prints, and a blind re-paste reverts them.
const current = loadBrandColours();
const fresh = found.filter((f) => !(f.key in current));
const differs = found.filter((f) => f.key in current && current[f.key] !== f.hex);
const entry = (f: (typeof found)[number]) =>
  `  ${JSON.stringify(f.key)}: ${JSON.stringify({ hex: f.hex, note: `DERIVED -- ${f.name} -- ${f.note}` })},`;

console.log(`\n${found.length} derived; ${found.length - fresh.length - differs.length} agree with ${brandColoursPath()}`);

console.log(`\nNEW (${fresh.length}) -- not in the map yet. Render each logo, then merge into "colours":\n`);
for (const f of fresh) console.log(entry(f));

console.log(`\nDIFFERS (${differs.length}) -- the map disagrees. Usually a HAND correction; do NOT paste blindly:\n`);
for (const f of differs) console.log(`  ${f.key}: map ${current[f.key]}, script ${f.hex}  (${f.name})`);

if (missed.length > 0) {
  console.log(`\nNO USABLE COLOUR (${missed.length}) -- these fall back to the device accent`);
  for (const m of missed) console.log(`  ${m}`);
}
console.log('');
