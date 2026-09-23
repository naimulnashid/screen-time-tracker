/**
 * Finding the logo file for an app, by name.
 *
 * Logos are dropped into `public/apps_logo/` by hand, and are LOCAL ONLY: the
 * folder is gitignored apart from its README, because third-party artwork is
 * not ours to license and a folder of it is an inventory of every app on every
 * device. Their brand colours live beside them in `config/app-colours.json`,
 * for the same reason. **The project downloads
 * nothing at runtime** -- that rule is inherited from the sibling Data Usage
 * Tracker and is not negotiable on a dashboard that describes itself as
 * local-only.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ WHY THESE ARE SERVED BY AN API ROUTE AND NOT FROM `public/` DIRECTLY
 *
 * `next start` SNAPSHOTS `public/` AT BOOT. A file added afterwards is a 404
 * until the server restarts, and this dashboard runs as a logon task that
 * stays up for weeks.
 *
 * Measured on 2026-09-01, against the live server on port 7844:
 *
 *   /apps_logo/Claude.svg   present at boot   -> 200  image/svg+xml
 *   /snapshot-probe.txt     added after boot  -> 404
 *
 * So a logo added today would not appear until the next reboot, and the
 * failure looks exactly like "the matching code is broken" -- the file is
 * right there on disk, spelled correctly. The route below reads from disk per
 * request, so a new file works the moment it lands.
 * ---------------------------------------------------------------------------
 *
 * This file has NO `server-only` marker on purpose, so `scripts/selftest.ts`
 * can import the matching rules directly. Same reasoning as `sampler-status.ts`
 * being split out of `queries.ts`. Do not import it from a client component --
 * pages resolve the URL server-side and pass a plain string down.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Extensions worth serving, and what to send back as the content type. */
const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function logoDir(): string {
  return path.join(process.cwd(), 'public', 'apps_logo');
}

/**
 * ---------------------------------------------------------------------------
 * ONE FOLDER PER DEVICE, and a shared root behind it
 * ---------------------------------------------------------------------------
 *
 * The root used to be a single namespace for every device, and the README
 * resolved clashes by renaming: the laptop's are `Windows Camera` and
 * `Windows Photos`. That works while the two sides are Windows and Android.
 *
 * It stops working with two Androids. **Measured 2026-09-04**, the Nothing and
 * the Redmi use the same display name for a DIFFERENT package twice:
 *
 *   Camera    com.nothing.camera   vs  com.android.camera
 *   Gallery   com.nothing.gallery  vs  com.miui.gallery
 *
 * Neither name can be renamed out of the clash, because the phone reports the
 * label and both phones are right. So a logo may now sit in a folder named
 * after the device, which wins over the root:
 *
 *   apps_logo/Gallery.png                     any device, unless overridden
 *   apps_logo/nothing-a001/Gallery.png        that phone only
 *   apps_logo/xiaomi-redmi-note-9-pro/...     that phone only
 *
 * **The folder is matched with `logoKey()`, exactly like a file name**, so
 * `nothing-a001`, `Nothing A001` and `NothingA001` are the same folder. That
 * is deliberate: the sidebar shows the label and the URL shows the slug, and
 * for every device here those normalise identically, so naming the folder
 * after "the device as the dashboard shows it" cannot be got wrong.
 *
 * Most logos stay in the root. Brave is Brave on both phones and the laptop,
 * and three copies of one file is how they drift apart.
 *
 * A device may answer to more than one name, so this takes a LIST and tries
 * them in order. The laptop is the case that needs it: the sidebar calls it
 * "Zephyrus G16" (`config.deviceLabel`) while the database calls it
 * `zephyrus`, and both are names a person would reasonably put on a folder.
 * The phones need only one -- their slug and their label normalise to the same
 * key, `nothing-a001` and `Nothing A001` alike.
 */
export function deviceScopeKeys(device?: string | string[] | null): string[] {
  if (!device) return [];
  const list = Array.isArray(device) ? device : [device];
  const out: string[] = [];
  for (const d of list) {
    const k = logoKey(d ?? '');
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * The lookup key for a name.
 *
 * Everything that is not a letter or a digit is dropped, so the file on disk
 * can be named the way a person would write it: `Keep Notes.svg`,
 * `Acme e-Reader.png` and `iPlayer.png` all match their display names without
 * anybody having to remember a slug format.
 */
export function logoKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Vendor words that a display name carries and a logo file usually does not.
 *
 * Windows calls it "Google Chrome"; the logo the world ships is `Chrome.svg`.
 * Applied ONLY as a second attempt, after the exact key misses, so a file that
 * does spell the vendor out (`Google Play Store.png`) still wins on its own
 * name. Kept to two entries deliberately: each one is a chance to match the
 * wrong logo, and the fallback for a miss is perfectly acceptable.
 */
const VENDOR_PREFIXES = ['google', 'microsoft'];

/**
 * Logos that are black on transparent, and so invisible on this dashboard.
 *
 * MEASURED, never guessed -- the sibling project's rule, and it is a real
 * trap: `X.svg` is a single `<path>` with no `fill` attribute at all, and SVG
 * defaults that to black. On a near-black page it renders as nothing, which
 * reads as a broken lookup rather than as a logo that is present and working.
 *
 * `scripts/measure-logo-plates.ts` re-runs the measurement over the SVGs. It
 * cannot judge a PNG or a JPG, so those get added here by eye when one turns
 * up invisible.
 *
 * Entries are logo IDENTITIES, so a device-scoped file gets its own answer:
 * `x` is the shared root's, `nothing-a001/x` would be that phone's copy. A
 * plate is a property of the artwork, and two devices no longer necessarily
 * share it.
 */
const NEEDS_PLATE = new Set(['x']);

export function needsLightPlate(name: string, device?: string | string[]): boolean {
  // Scoped first, then the bare key -- the same fallback `brandColour` uses,
  // and for the same reason. Once every logo lives in a device folder, `x`
  // becomes `zephyrusg16/x` and `nothing-a001/x`, and a set keyed bare would
  // quietly stop matching any of them: the plate would vanish and X would go
  // back to being an invisible black mark on a near-black page. One entry
  // still covers every copy, and a scoped entry overrides it where one copy
  // genuinely differs.
  const identity = logoIdentity(name, device);
  if (NEEDS_PLATE.has(identity)) return true;
  const slash = identity.indexOf('/');
  return slash >= 0 && NEEDS_PLATE.has(identity.slice(slash + 1));
}

interface Manifest {
  /** Directory mtimes the map was built from -- root AND every subfolder. */
  stamp: string;
  /**
   * scope key -> logo key -> path relative to `logoDir()`.
   *
   * The shared root is the entry under `''`. Storing the relative path rather
   * than the bare file name is what keeps the serving route free of any path
   * arithmetic of its own.
   */
  scopes: Map<string, Map<string, string>>;
}

let cached: Manifest | null = null;

/**
 * A stamp that moves when ANY of the folders changes.
 *
 * ⚠️ The root's mtime does NOT move when a file is added inside a subfolder.
 * Stamping the root alone would mean a logo dropped into `nothing-a001/` was
 * invisible until the server restarted -- which is the exact failure the
 * measurement at the top of this file exists to prevent, reintroduced by the
 * feature that was supposed to be free of it.
 */
function manifestStamp(dir: string): string {
  const parts: string[] = [];
  let entries: fs.Dirent[];
  try {
    parts.push(String(fs.statSync(dir).mtimeMs));
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      parts.push(e.name + ':' + fs.statSync(path.join(dir, e.name)).mtimeMs);
    } catch {
      // Removed between the listing and the stat. The next call settles it.
    }
  }
  return parts.join('|');
}

/**
 * Every logo currently on disk, keyed for lookup.
 *
 * Rebuilt whenever the directory's mtime moves, which on Windows covers a file
 * being added, removed or renamed. That is what makes "I'll add more later"
 * work against a server that has been up for a month -- there is no restart
 * and no cache to clear.
 *
 * Replacing a file's CONTENT in place does not move the directory mtime, but
 * it does not need to: the name is unchanged, and the route reads the bytes
 * from disk on every request.
 */
export function logoManifest(): Map<string, Map<string, string>> {
  const dir = logoDir();
  const stamp = manifestStamp(dir);

  if (!stamp) {
    // No directory at all is a normal state, not an error. Every app just
    // falls back to its initial.
    cached = { stamp: '', scopes: new Map() };
    return cached.scopes;
  }
  if (cached && cached.stamp === stamp) return cached.scopes;

  const scopes = new Map<string, Map<string, string>>();

  /*
    ⚠️ `scope` is the normalised KEY and `folderName` is what the folder is
    actually called on disk. They differ -- `nothing-a001` keys as
    `nothinga001` -- and the stored path must use the REAL name or every
    scoped logo resolves to a URL whose file cannot be opened.

    That bug shipped for about a minute: the manifest returned
    `nothinga001/Gallery.png`, every unit check passed because they compared
    the returned string, and the route would have 404'd on a file plainly
    sitting on disk. Which is, exactly, the failure this whole module exists
    to prevent -- reintroduced one layer down.
  */
  const readInto = (scope: string, folderName: string) => {
    const folder = folderName ? path.join(dir, folderName) : dir;
    let entries: string[];
    try {
      entries = fs.readdirSync(folder);
    } catch {
      return;
    }
    const files = new Map<string, string>();
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!TYPES[ext]) continue;
      const key = logoKey(path.basename(entry, path.extname(entry)));
      // First writer wins, so `Chrome.svg` is not shadowed by a later
      // `chrome.png`. Deterministic because readdir is sorted on every
      // platform this runs on.
      if (!files.has(key)) files.set(key, folderName ? path.join(folderName, entry) : entry);
    }
    if (files.size > 0) scopes.set(scope, files);
  };

  readInto('', '');
  // One level only. A device folder holds logo files, not more folders, and
  // recursing would make a stray copy of the whole set somewhere below start
  // resolving.
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    readInto(logoKey(e.name), e.name);
  }

  cached = { stamp, scopes };
  return scopes;
}

/**
 * The file on disk for a scope and key, or null. Used by the serving route.
 *
 * Falls back to the shared root, so a device folder needs to hold only the
 * logos that actually differ.
 */
export function logoFileForKey(
  scope: string,
  key: string,
): { file: string; type: string } | null {
  const scopes = logoManifest();
  const file = (scope ? scopes.get(scope)?.get(key) : undefined) ?? scopes.get('')?.get(key);
  if (!file) return null;
  const type = TYPES[path.extname(file).toLowerCase()];
  return type ? { file, type } : null;
}

/**
 * The URL to render for an app, or null when there is no logo for it.
 *
 * Returning null rather than a URL that will 404 is the point: the caller
 * draws an initial instead, so a missing logo is a deliberate fallback rather
 * than a browser-rendered broken image.
 */
/**
 * Which file a name resolves to, as a scope and a key.
 *
 * This is the ONE identity behind the artwork, the light plate and the brand
 * colour. They have to agree: a Redmi "Gallery" drawing MIUI's icon beside the
 * Nothing Gallery's brand colour is a worse result than either of them alone,
 * and three functions each doing their own matching is how that happens.
 *
 * The device folder is tried in full -- exact name, then vendor-stripped --
 * before the shared root gets a turn. Trying exact-everywhere first would let
 * a root file beat a device file whose name needed the vendor rule, which
 * inverts the override the folder exists to express.
 */
export function resolveLogo(
  name: string,
  device?: string | string[],
): { scope: string; key: string } | null {
  const scopes = logoManifest();
  const lower = name.toLowerCase();

  const candidates = [logoKey(name)];
  for (const vendor of VENDOR_PREFIXES) {
    if (!lower.startsWith(`${vendor} `)) continue;
    const short = logoKey(name.slice(vendor.length + 1));
    if (short) candidates.push(short);
  }

  for (const scope of [...deviceScopeKeys(device), '']) {
    const files = scopes.get(scope);
    if (!files) continue;
    for (const key of candidates) {
      if (files.has(key)) return { scope, key };
    }
  }

  return null;
}

export interface LogoFile {
  /** '' for the shared root, else the device folder's key. */
  scope: string;
  key: string;
  /** `scope/key`, or `key` at the root. What plates and colours are keyed by. */
  identity: string;
  /** The file's own name, without extension, as a person wrote it. */
  name: string;
  /** Path relative to `logoDir()`. */
  relPath: string;
}

/**
 * Every logo on disk, root and device folders alike.
 *
 * One enumeration for the two measure scripts and the self-test's coverage
 * check. They each used to call `readdirSync(logoDir())` themselves, which was
 * fine while the folder was flat -- and the day it stopped being flat, all
 * three would have silently ignored every device-scoped logo. A logo with no
 * brand colour falls back to the device accent, so that gap does not look like
 * a gap; it looks like an app that chose violet.
 */
export function allLogoFiles(): LogoFile[] {
  const out: LogoFile[] = [];
  for (const [scope, files] of logoManifest()) {
    for (const [key, relPath] of files) {
      const ext = path.extname(relPath);
      out.push({
        scope,
        key,
        identity: scope ? `${scope}/${key}` : key,
        name: path.basename(relPath, ext),
        relPath,
      });
    }
  }
  return out.sort((a, b) => a.identity.localeCompare(b.identity));
}

/** `scope/key`, or just `key` in the shared root. The plate and colour keys. */
export function logoIdentity(name: string, device?: string | string[]): string {
  const hit = resolveLogo(name, device);
  if (!hit) return logoKey(name);
  return hit.scope ? `${hit.scope}/${hit.key}` : hit.key;
}

export function logoUrl(name: string, device?: string | string[]): string | null {
  const hit = resolveLogo(name, device);
  if (!hit) return null;
  return hit.scope
    ? `/api/app-logo/${hit.scope}/${hit.key}`
    : `/api/app-logo/${hit.key}`;
}
