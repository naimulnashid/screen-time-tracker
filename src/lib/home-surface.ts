/**
 * Which Android package is the HOME SCREEN.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The launcher is not an app you open; it is the surface you pass THROUGH on
 * the way to one. Measured on this phone over 13 days: `com.nothing.launcher`
 * recorded **2,908 opens** against 999 for the next entry -- nearly three
 * times the tallest real bar -- while sitting only third by time. On a
 * ranking of "what did I reach for", that is one bar answering a different
 * question and flattening every bar that answers the right one.
 *
 * It is excluded from the OPENS ranking only. It stays in the time ranking,
 * in the By App table, and on its own detail page, because nine hours on the
 * home screen is a real fact about the phone and hiding it would be the more
 * misleading choice. Time and opens are different questions; only one of them
 * has a wrong answer here.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE CARD NAMES WHAT IT DROPPED
 *
 * A filter that silently removes a row is exactly the class of bug this
 * project keeps finding elsewhere, so the Overview card prints the label of
 * whatever this matched. If the rule ever catches the wrong package, the page
 * says so on its face rather than quietly serving a shorter list.
 *
 * ---------------------------------------------------------------------------
 * HOW IT DECIDES
 *
 * Android has no queryable "is this the home app" signal in what the phone
 * uploads -- the launcher is a `CATEGORY_HOME` intent resolution, which lives
 * on the device. So this is a name rule, and it is deliberately narrow.
 *
 * Nearly every launcher ends its package name in `launcher`, optionally with a
 * digit: `com.nothing.launcher`, `com.android.launcher3`,
 * `com.sec.android.app.launcher`, `com.google.android.apps.nexuslauncher`.
 * The ones that do not are listed by hand.
 *
 * A game or store front-end whose package ends in `.launcher` would be caught
 * wrongly. The cost is one bar missing from one chart, on a card that names
 * the app it dropped -- which is why a narrow rule with an escape hatch beats
 * a clever one that cannot be checked.
 */

/**
 * Launchers whose package name does not end in `launcher`.
 *
 * Add to this rather than loosening the pattern: a wider pattern silently
 * catches more, and a list is reviewable.
 */
const NAMED_HOME_PACKAGES = new Set([
  'com.miui.home',            // Xiaomi / Redmi / POCO
  'com.mi.android.globallauncher',
  'com.hihonor.android.home',
  'com.transsion.hilauncher', // Tecno / Infinix
]);

/** True when the package is the phone's home screen rather than an app. */
export function isHomeSurface(packageName: string): boolean {
  const pkg = packageName.toLowerCase();
  return NAMED_HOME_PACKAGES.has(pkg) || /(^|\.)[a-z0-9]*launcher\d*$/.test(pkg);
}
