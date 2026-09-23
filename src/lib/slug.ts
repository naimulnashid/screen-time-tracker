/**
 * Label -> URL slug. **One rule, for every device.**
 *
 * Its own module rather than a helper inside `android-ingest.ts`, which is
 * where it started, because the laptop needs it too: `/windows/zephyrus-g16`
 * and `/android/nothing-a001` are the same shape and must be produced by the
 * same code. `android-ingest.ts` reaches `node:sqlite` through `db.ts`, so
 * importing it from `config.ts` -- which is deliberately NOT server-only --
 * would drag the database driver into every module that only wanted a path.
 */

/**
 * "Nothing A001" -> "nothing-a001". "Zephyrus G16" -> "zephyrus-g16".
 *
 * Derived from the LABEL rather than a device id so the address is readable.
 * Two Android phones of one model would collide, so `android-ingest.ts`
 * disambiguates with a numeric suffix rather than letting them silently share
 * a page. The laptop cannot collide with anything: there is exactly one, and
 * it lives under a different path segment.
 */
export function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'device';
}

/**
 * A percent-encoded path segment -> its text, or null when it is malformed.
 *
 * App keys and package names travel URL-encoded (see the Windows app detail
 * page for why they are not slugified). `decodeURIComponent` THROWS on a stray
 * `%`, so `/apps/100%` was a 500 where it should be a 404: an address that
 * names nothing, not a server fault.
 */
export function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
