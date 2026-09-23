/**
 * Which logos are black on transparent, and so invisible on a black page.
 *
 *   npx tsx scripts/measure-logo-plates.ts
 *
 * The sibling project's rule is that this "cannot be guessed, only measured",
 * and it is right: `X.svg` is a single `<path>` with NO `fill` attribute, and
 * SVG defaults that to black. Nothing about the file name says so, and the
 * result on the dashboard is a logo that loaded perfectly and shows nothing --
 * which reads as a failed lookup, so the instinct is to go debugging the
 * matching code.
 *
 * Anything this prints under NEEDS A LIGHT PLATE belongs in `NEEDS_PLATE` in
 * `src/lib/app-logo.ts`, keyed by `logoKey()`.
 *
 * ⚠️ It can only judge SVGs. A raster logo's pixels are not readable without
 * decoding it, so PNG and JPG files are listed separately and go in the set by
 * eye, when one turns up invisible on the page.
 */

import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { logoDir, allLogoFiles, logoKey } from '../src/lib/app-logo';

/** Paints that render as black, or as nothing, on this dashboard. */
const BLACK = new Set(['#000', '#000000', 'black', 'currentcolor', '#010101', '#111', '#111111']);

const dir = logoDir();
const needsPlate: string[] = [];
const fine: string[] = [];
const raster: string[] = [];

// Every logo, root and device folders alike -- a device-scoped SVG can be
// black-on-transparent exactly like a shared one, and reporting only the
// root would quietly stop covering the folders this project just gained.
for (const logo of allLogoFiles()) {
  const entry = logo.identity;
  const ext = extname(logo.relPath).toLowerCase();
  if (ext !== '.svg') { raster.push(entry); continue; }

  const svg = readFileSync(join(dir, logo.relPath), 'utf8');

  const attrs = [...svg.matchAll(/(?:fill|stroke)\s*=\s*"([^"]*)"/g)].map((m) => m[1]!.toLowerCase());
  const styles = [...svg.matchAll(/(?:fill|stroke)\s*:\s*([^;"'}]+)/g)].map((m) => m[1]!.trim().toLowerCase());
  const paints = [...attrs, ...styles].filter((v) => v && v !== 'none');

  // A file can draw shapes without naming a paint at all, which is the X case.
  const shapes = (svg.match(/<(path|circle|rect|polygon|polyline|ellipse)\b/g) ?? []).length;

  if (shapes === 0) { fine.push(entry); continue; }

  const coloured = paints.filter((v) => !BLACK.has(v));
  if (paints.length === 0) needsPlate.push(`${entry}  -- no paint named at all, so SVG defaults it to black`);
  else if (coloured.length === 0) needsPlate.push(`${entry}  -- every paint is black: ${[...new Set(paints)].join(', ')}`);
  else fine.push(entry);
}

console.log(`\nNEEDS A LIGHT PLATE (${needsPlate.length})`);
for (const line of needsPlate) console.log(`  ${line}`);
if (needsPlate.length > 0) {
  const keys = needsPlate.map((l) => `'${logoKey(basename(l.split('  --')[0]!, extname(l.split('  --')[0]!)))}'`);
  console.log(`\n  NEEDS_PLATE in src/lib/app-logo.ts should contain: ${keys.join(', ')}`);
}

console.log(`\nfine on dark (${fine.length})`);
console.log(`  ${fine.join(', ')}`);

console.log(`\nnot measurable here -- raster, judge by eye (${raster.length})`);
console.log(`  ${raster.join(', ')}\n`);
