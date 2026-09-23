/**
 * Shared scope constants.
 *
 * Lives apart from `queries.ts` because that module is `server-only` and the
 * scope bar is a client component -- both need these numbers.
 */

/**
 * The "All" range.
 *
 * A large day count rather than a sentinel like 0, so every query keeps using
 * the same `local_date >= ?` comparison and there is no special case to forget.
 * Anchored on the newest stored day, 36,500 days reaches back a century, which
 * covers all history without pretending to be unbounded.
 */
export const ALL_DAYS = 36500;

/** Ranges offered in the scope bar, shortest first. */
export const RANGES = [7, 30, 90, ALL_DAYS] as const;

/** Opening view. All history, so the dashboard leads with everything it holds. */
export const DEFAULT_DAYS = ALL_DAYS;

export function rangeLabel(days: number): string {
  return days === ALL_DAYS ? 'All' : `${days}d`;
}

/** Parse `?days=` into a range we actually offer, falling back to the default. */
export function parseDays(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAYS;
}

/**
 * A page's `searchParams` back into a `?a=b` string, or `''` when there are none.
 *
 * For the redirects that keep the pre-`/windows/<slug>/` addresses working.
 * `redirect()` takes a whole URL and does not carry the incoming query across,
 * so without this a bookmarked `/apps?days=7` would land on the full range --
 * a redirect that silently changes what was asked for is worse than a 404,
 * because nothing about the page says the scope moved.
 *
 * A repeated key keeps its LAST value, matching what Next hands a page for
 * `?days=7&days=30` when it collapses the pair itself.
 */
export function queryString(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (last !== undefined) q.set(key, last);
    } else if (value !== undefined) {
      q.set(key, value);
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
