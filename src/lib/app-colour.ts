/**
 * The colour a bar gets, so an app is recognisable before you read its name.
 *
 * ---------------------------------------------------------------------------
 * THIS DOES NOT BREAK THE "accent.ts IS THE ONLY PLACE A HEX LIVES" RULE.
 *
 * That rule is about the DASHBOARD'S OWN palette -- violet for the laptop,
 * green for the phone -- and it exists so recolouring the site is a one-file
 * change. `accent.ts` is still the only home for those.
 *
 * These are THIRD-PARTY BRAND colours. They are data about other people's
 * logos, not a palette this project chose, and they would be exactly as wrong
 * in `accent.ts` as a list of app names would be. `Charts.tsx` still contains
 * no hex of any kind: a colour reaches it inside the chart data, the same way
 * a logo URL does.
 * ---------------------------------------------------------------------------
 *
 * ## Where the values came from
 *
 * `npx tsx scripts/measure-logo-colours.ts` derives them from the logo files
 * themselves -- SVG paints read from source, PNG and JPG pixels bucketed and
 * averaged. Re-run it after adding logos and merge its proposals into
 * `config/app-colours.json` -- merge, never replace: see below.
 *
 * ⚠️ ITS OUTPUT IS A STARTING POINT, NOT THE ANSWER. The script counts paint
 * DECLARATIONS, not the area each one covers, and that has one systematic
 * failure: a Google logo carries four colours used once each, the tie breaks
 * toward the most saturated, and yellow wins every time. It proposed yellow
 * for Gmail, Maps, Photos and Google itself, and green for Gemini.
 *
 * A second run, over about ninety logos, found the same shape in three more
 * places -- and they are worth naming, because none of them LOOKS like a
 * tie-break when you read the hex alone:
 *
 *   - **Microsoft Edge** came back `#66eb6e`, a GREEN. It is a real stop in
 *     the swirl's gradient, used twice where every other stop is used once,
 *     so it wins on count rather than on the saturation tie. A green bar for
 *     a browser would read as WhatsApp before it read as a mistake.
 *   - **Sheets** came back `#263238`, near-black. That is the document behind
 *     the mark, and being unsaturated-but-not-quite it survives the filter.
 *   - **VLC** came back `#ffb900`, the lightest stop of the cone's gradient,
 *     which is amber rather than orange -- and File Explorer's folder is
 *     genuinely `#ffc928`, so the two would have arrived at nearly the same
 *     bar colour from different brands.
 *
 * Corrected by hand, and each correction says so in its `note` -- the map
 * being hand-maintained rather than regenerated is the whole reason that is
 * possible.
 *
 * ## Chrome is the correction that was REVERSED, and it is the useful one
 *
 * It sat at `#4285f4` for the same reason as Gmail and Maps: the script had
 * returned `#fcd209`, the yellow arc, off a four-way saturation tie, and the
 * blue centre disc looked like the obvious repair.
 *
 * Two things were wrong with that.
 *
 * **`#4285f4` is not a paint in `Chrome.svg`.** The file is the LEGACY
 * gradient logo, whose disc runs `#81B4E0 -> #0C5A94` -- a muted steel blue.
 * `#4285f4` came from brand knowledge, not from the file, which quietly
 * changed what "hand-corrected" means here: every other correction picks a
 * different paint out of the same file, and that is checkable. Typing a
 * remembered brand hex is not.
 *
 * **And the blue is the middle of the mark, not the mark.** The ring is what
 * a person sees, and on a chart the bar has to be recognisable at a glance
 * from a colour they already associate with the app.
 *
 * So the yellow stands. The lesson is not "the script was right after all" --
 * it was right by accident, off a tie-break it does not understand. It is
 * that a correction has to name which paint in the file it is choosing, or
 * there is nothing to argue with later.
 *
 * The same test applies to every entry: if its hex is not a paint in its own
 * file, the note should say so and why.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logoIdentity } from './app-logo';

/**
 * ---------------------------------------------------------------------------
 * THE MAP IS LOCAL, like the logos it describes.
 *
 * Brand colours live in `config/app-colours.json`, which is GITIGNORED, beside
 * `public/apps_logo/`, which is gitignored for the same reason. A colour is
 * keyed by a logo IDENTITY and only ever applies to a logo file that exists,
 * so a map without its logos is inert -- and together, the two are an
 * inventory of every app on every device, which is not something a public
 * repository should carry. `config/app-colours.example.json` shows the shape.
 *
 * Two forms per entry, so a hand correction can keep its reasoning:
 *
 *   "youtube": "#ff0033"
 *   "sheets":  { "hex": "#0f9d58", "note": "HAND -- script said #263238 ..." }
 *
 * `npm run backup:kit` copies the file off the system drive with the logos,
 * and `npm run drill` fails if that copy is missing or stale.
 * ---------------------------------------------------------------------------
 */

export type BrandMap = Record<string, string>;

export function brandColoursPath(): string {
  return path.join(process.cwd(), 'config', 'app-colours.json');
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Parse the file's JSON into identity -> hex, dropping anything malformed.
 *
 * Exported for the self-test. A bad entry is skipped rather than thrown on:
 * the cost of one is one bar in the device accent, and a page that fails to
 * render over a typo in a colour file would be a far worse trade.
 */
export function parseBrandColours(json: unknown): BrandMap {
  const colours = (json as { colours?: unknown } | null)?.colours;
  const out: BrandMap = {};
  if (!colours || typeof colours !== 'object') return out;
  for (const [key, value] of Object.entries(colours as Record<string, unknown>)) {
    const hex = typeof value === 'string' ? value : (value as { hex?: unknown } | null)?.hex;
    if (typeof hex === 'string' && HEX.test(hex)) out[key] = hex.toLowerCase();
  }
  return out;
}

let cached: { mtimeMs: number; map: BrandMap } | null = null;

/**
 * The local map, re-read whenever the file's mtime moves, so editing a colour
 * needs no restart -- the same promise the logo manifest makes. A missing or
 * unreadable file is a normal state (a fresh clone has none) and yields an
 * empty map: every bar falls back to the device accent.
 */
export function loadBrandColours(): BrandMap {
  const file = brandColoursPath();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    cached = { mtimeMs: -1, map: {} };
    return cached.map;
  }
  if (cached && cached.mtimeMs === mtimeMs) return cached.map;
  let map: BrandMap = {};
  try {
    map = parseBrandColours(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // Half-written or malformed. Empty until the next save fixes it.
  }
  cached = { mtimeMs, map };
  return map;
}

/* -------------------------------------------------------------- contrast */

/**
 * The floor a bar's lightness must clear to be visible on this page.
 *
 * The dashboard background is #000000. A dark brand colour on it is the same
 * failure as the black-on-transparent logo that needed a light plate: the bar
 * renders correctly and reads as missing.
 *
 * ⚠️ THIS IS LOAD-BEARING NOW, not a precaution. An earlier version of this
 * comment claimed nothing in the map tripped it -- that was wrong even when
 * written, and emphatically wrong once the map covered every logo: about one
 * entry in seven is lifted, and the darkest, a teal at lightness 0.227, would
 * otherwise be a bar you could not see against the page.
 *
 * `npx tsx scripts/measure-logo-colours.ts` prints raw values; run
 * `brandColour()` on them, not the map, to see what actually gets drawn.
 */
const MIN_LIGHTNESS = 0.4;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const h = m[1]!;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const p = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/**
 * Raise a colour toward white until it clears `MIN_LIGHTNESS`, keeping its
 * hue.
 *
 * Mixing toward white rather than scaling the channels, because scaling drives
 * an already-dark colour toward its own hue's brightest form and can shift the
 * hue noticeably; a white mix keeps the hue and only drains saturation, which
 * is the more forgiving failure.
 */
export function ensureReadable(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const l = (Math.max(rgb.r, rgb.g, rgb.b) + Math.min(rgb.r, rgb.g, rgb.b)) / 2 / 255;
  if (l >= MIN_LIGHTNESS) return hex;

  // How far toward white to travel, as a fraction. Derived rather than
  // guessed at: mixing by t moves lightness to l + t(1 - l).
  const t = Math.min(1, (MIN_LIGHTNESS - l) / (1 - l));
  return toHex(
    rgb.r + (255 - rgb.r) * t,
    rgb.g + (255 - rgb.g) * t,
    rgb.b + (255 - rgb.b) * t,
  );
}

/**
 * The bar colour for an app, or null when there is no brand colour for it.
 *
 * Null rather than a default, so the caller decides -- and it falls back to
 * the DEVICE accent, which keeps an unknown app looking like part of the
 * dashboard rather than like a failed lookup.
 */
export function brandColour(name: string, device?: string | string[]): string | null {
  // Keyed by the LOGO IDENTITY, not the app name, so a device folder carries
  // its colour along with its artwork. Without this a Redmi Gallery would draw
  // MIUI's icon over the Nothing Gallery's colour -- worse than either alone,
  // and the kind of mismatch that reads as a rendering bug rather than as a
  // missing map entry.
  return brandColourForIdentity(logoIdentity(name, device));
}

/**
 * The colour for a resolved logo identity.
 *
 * `nothing-a001/gallery` falls back to `gallery`, so a device folder only
 * needs an entry for the logos whose colour actually differs -- the same
 * fallback the artwork itself gets, and for the same reason.
 *
 * Separate from `brandColour` so the self-test can check the map covers every
 * file on disk without going through a display name, which for a scoped logo
 * would mean knowing which device shows it. `map` defaults to the local file;
 * the self-test passes a fixture so the RULES are tested without it.
 */
export function brandColourForIdentity(
  identity: string,
  map: BrandMap = loadBrandColours(),
): string | null {
  const slash = identity.indexOf('/');
  const bare = slash >= 0 ? identity.slice(slash + 1) : identity;
  const hex = map[identity] ?? map[bare];
  return hex ? ensureReadable(hex) : null;
}
