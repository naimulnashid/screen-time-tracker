/**
 * Which apps the By App table lists before "Show all apps" is pressed.
 *
 * Both devices collect a long tail nobody chose to look at: 59 apps on the
 * laptop and 91 on the Nothing, measured 2026-09-23, of which about half held
 * the foreground for under a minute across a month -- a credential prompt, a
 * picker sheet, a store app opened once. Listing them all buried the apps the
 * page is for under rows that are true and say nothing.
 *
 * An app is listed when it clears EITHER bar:
 *
 *   - **time**: at least `LIST_MIN_MS` in the range. The main bar, and on its
 *     own on purpose -- 38 minutes of Brave in one sitting on one day is a
 *     real use of the phone, and requiring several days or opens as well hid
 *     it.
 *   - **habit**: at least `LIST_MIN_OPENS` opens spread over at least
 *     `LIST_MIN_DAYS` days. An app you reach for daily for seconds at a time
 *     -- the phone's Drive and Photos, the laptop's Task Manager -- is a pattern even when its
 *     minutes are small. The days floor is what keeps one afternoon of
 *     alt-tabbing through a dialog from counting as one.
 *
 * Thresholds are absolute rather than scaled to the range, so "listed" means
 * the same thing on the 7-day view as on All. They are a judgement, not a
 * measurement, which is why they are named constants in one place. Measured
 * against the All range on 2026-09-23 they list 26 of 59 apps on the laptop,
 * 38 of 91 on the Nothing and 2 of 21 on the Redmi.
 *
 * Hidden rows are never dropped: they sit behind the button, whose label
 * carries their count and time, so the table still reconciles with the
 * Overview.
 */

export const LIST_MIN_MS = 10 * 60_000;
export const LIST_MIN_OPENS = 30;
export const LIST_MIN_DAYS = 5;

export interface ListCandidate {
  ms: number;
  opens: number;
  days: number;
}

export function isListed(a: ListCandidate): boolean {
  return a.ms >= LIST_MIN_MS || (a.opens >= LIST_MIN_OPENS && a.days >= LIST_MIN_DAYS);
}

/** The rule in words, for the table's subtitle. Built from the constants so the two cannot drift. */
export function listRule(): string {
  return `Listed: ${LIST_MIN_MS / 60_000} min or more, or ${LIST_MIN_OPENS}+ opens across ${LIST_MIN_DAYS}+ days.`;
}

/**
 * Split a ranked list into what is shown and what waits behind the button,
 * keeping each half in its original order.
 *
 * If NOTHING clears the bar -- a phone that registered yesterday, a 7-day
 * range over a quiet week -- everything is shown. A table that opens empty
 * above a button is a worse page than a table of small numbers.
 */
export function splitForList<T extends ListCandidate>(apps: T[]): { shown: T[]; rest: T[] } {
  const shown = apps.filter(isListed);
  if (shown.length === 0) return { shown: apps, rest: [] };
  return { shown, rest: apps.filter((a) => !isListed(a)) };
}
