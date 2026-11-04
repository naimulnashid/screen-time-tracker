/**
 * Shared range constants.
 *
 * Lives apart from `queries.ts` because that module is `server-only` and the
 * range menus are client components -- both need these numbers.
 *
 * **Pages are not scoped any more** (since 2026-11-03, after the sibling Data
 * Usage Tracker). The top bar's 7d / 30d / 90d / All chips scoped every figure
 * on every page; now every page reads all history, and only the day-by-day
 * charts carry a range of their own, in a menu at their card's top right. An
 * old link carrying `?days=` shows everything rather than a filter with no
 * visible control.
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

/** Ranges offered in a chart's menu, shortest first. */
export const RANGES = [7, 30, 90, ALL_DAYS] as const;

export type ChartRange = (typeof RANGES)[number];

/** What a chart's menu opens on. A month: readable bands, recent enough to matter. */
export const DEFAULT_CHART_DAYS: ChartRange = 30;

/** Every page's scope: all history. */
export const ALL_HISTORY = { days: ALL_DAYS } as const;

export function rangeLabel(days: number): string {
  return days === ALL_DAYS ? 'All' : `${days}d`;
}

/** Spoken label, for the menu's options. */
export function rangeName(days: number): string {
  return days === ALL_DAYS ? 'All history' : `Last ${days} days`;
}

/**
 * The first local date each range covers, counted back from `latest` (the
 * newest day with data, which anchors every range, as the queries do).
 * `''` for All, which every date passes.
 */
export function rangeStarts(latest: string): Record<ChartRange, string> {
  const start = (days: number) => {
    const d = new Date(latest + 'T00:00:00');
    d.setDate(d.getDate() - (days - 1));
    return d.toLocaleDateString('en-CA');
  };
  return { 7: start(7), 30: start(30), 90: start(90), [ALL_DAYS]: '' } as Record<ChartRange, string>;
}

/** One value per range, built from that range's first date. */
export function perRange<T>(latest: string, build: (from: string) => T): Record<ChartRange, T> {
  const starts = rangeStarts(latest);
  return Object.fromEntries(RANGES.map((r) => [r, build(starts[r])])) as Record<ChartRange, T>;
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
