/**
 * Accent colours. **The single place any of them is defined.**
 *
 * Each device gets its own accent so you can tell at a glance which machine
 * you are looking at. Everything downstream reads `var(--accent)` and friends,
 * so switching device is one attribute on the shell (`data-device`) and
 * nothing else. The rule that makes that work, and which must not be broken:
 *
 *   **Never hardcode an accent hex anywhere else.** Not in CSS, not in a
 *   chart. In the sibling project `Charts.tsx` carried `#2f80ed` inline, which
 *   meant the trend chart stayed blue on a green page. Recharts passes
 *   stroke/fill straight through to SVG attributes, where `var(--accent)` is
 *   valid, so there is never a reason to inline one.
 *
 * These are emitted as CSS custom properties by `accentStyleSheet()`, which
 * the root layout inlines into <head>. They are deliberately NOT duplicated in
 * `globals.css` -- two sources would drift, and the point of this file is that
 * there is one.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE COLOURS DIFFER FROM DATA USAGE TRACKER
 *
 * Both dashboards run on this machine at once, on adjacent ports, showing the
 * same laptop and the same phone. Two windows that look identical is a real
 * problem: you read a number off the wrong one.
 *
 * So the laptop accent moves blue -> **violet**, and the phone accent stays
 * **Android green**. That split is deliberate and not arbitrary:
 *
 *   - The laptop accent is the dominant colour of the site, because the
 *     laptop is the default landing page. Changing it is what makes the two
 *     dashboards distinguishable from across the room.
 *   - Green identifies the DEVICE, not the site -- it is Android's own mark.
 *     Keeping it stable across both projects means "green means phone"
 *     everywhere, which is worth more than making the phone pages differ too.
 *
 * Violet also stays clear of the red reserved for genuine anomalies, which
 * amber or orange would have crowded.
 * ---------------------------------------------------------------------------
 */

export type DeviceId = 'zephyrus' | 'android';

export interface AccentTheme {
  /** Primary. Buttons, active tabs, the headline total. */
  accent: string;
  /** Lifted variant for hover and for text on black. */
  accentBright: string;
  /** Translucent fill behind active chips and badges. */
  accentDim: string;
  /** Glow, since a black-on-black drop shadow does nothing. */
  accentGlow: string;
  /**
   * A FILLED control carrying text -- the active range chip, the Unlock
   * button -- and the text colour on it. Separate from `accent` because the
   * pair has to clear WCAG AA 4.5:1, and neither accent can with white:
   *
   *   white on #7c5cff  4.35:1  -- fails; #795af9 is the nearest violet that
   *                                passes (4.52:1) and is indistinguishable
   *   white on #3ddc84  1.78:1  -- fails badly; no green that still reads as
   *                                Android green can carry white, so the
   *                                phone's text goes near-black (10.6:1)
   */
  accentFill: string;
  onAccent: string;
  /**
   * Six-step heat map ramp, in the accent's own hue family.
   *
   * Step 0 is a real but quiet day and stays near-neutral. A day with no
   * collected data at all is not on this ramp and gets no fill: it takes a
   * hairline outline instead (`.heatmap-cell[data-nodata]`), because a
   * near-black fill on a near-black page is not visible, and a no-data day
   * must never read as a quiet one.
   */
  heatmap: [string, string, string, string, string, string];
}

/** `rgba()` from a #rrggbb, so a theme is defined by one hex per role. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const FOCUS_VIOLET = '#7c5cff';
const ANDROID_GREEN = '#3ddc84';

/** The dark theme's accents -- the dashboard's original, true-black look. */
export const ACCENTS: Record<DeviceId, AccentTheme> = {
  zephyrus: {
    accent: FOCUS_VIOLET,
    accentBright: '#9b82ff',
    accentDim: alpha(FOCUS_VIOLET, 0.16),
    accentGlow: alpha(FOCUS_VIOLET, 0.28),
    accentFill: '#795af9',
    onAccent: '#ffffff',
    heatmap: ['#131519', '#241a5c', '#33228a', '#4c33bd', '#7c5cff', '#a795ff'],
  },
  android: {
    accent: ANDROID_GREEN,
    // Android's own green is already light; the "bright" step lifts it just
    // enough to stay distinct on hover without turning mint.
    accentBright: '#66eda5',
    accentDim: alpha(ANDROID_GREEN, 0.16),
    accentGlow: alpha(ANDROID_GREEN, 0.28),
    accentFill: ANDROID_GREEN,
    onAccent: '#05140c',
    heatmap: ['#131519', '#0d3a24', '#125234', '#1a7b4c', '#3ddc84', '#8af0b8'],
  },
};

/**
 * The light theme's accents. Same hue per device, deepened until it reads as
 * TEXT on white: the dark theme's violet is 4.35:1 on white and Android green
 * 1.78:1, and both are used for links, the headline figure and active tabs.
 * Measured 2026-10-01 against white, the #f4f5f7 page and the accent-dim tint
 * behind an active tab:
 *
 *   #6644e8  5.90 / 5.41 / 5.09     #5a38d6 (bright)  7.07 / 6.48 / 6.04
 *   #0d7340  5.93 / 5.43 / 5.13     #0b6b3a (bright)  6.61 / 6.06 / 5.68
 *
 * "Bright" is the hover and emphasis step, so on white it goes DARKER, not
 * lighter. White on either fill clears 5.9:1, so both phones and the laptop
 * carry white text on a filled control here -- unlike the dark theme, where
 * the green fill needs near-black text.
 *
 * The green is the sibling Data Usage Tracker's, measured there; "green means
 * phone" holds across both projects in this theme too.
 *
 * The heat map runs light to dark here -- more time, more ink -- which is the
 * convention on a light page, and step 0 is a pale neutral deep enough to
 * read as a filled square on a white card (the sibling's first #e9edf3 barely
 * showed and was deepened to this).
 */
export const LIGHT_ACCENTS: Record<DeviceId, AccentTheme> = {
  zephyrus: {
    accent: '#6644e8',
    accentBright: '#5a38d6',
    accentDim: alpha('#6644e8', 0.1),
    accentGlow: alpha('#6644e8', 0.24),
    accentFill: '#6644e8',
    onAccent: '#ffffff',
    heatmap: ['#e1e6ed', '#ddd5fd', '#bcaaf9', '#9479f1', '#6c4ce6', '#4a2bb8'],
  },
  android: {
    accent: '#0d7340',
    accentBright: '#0b6b3a',
    accentDim: alpha('#0d7340', 0.1),
    accentGlow: alpha('#0d7340', 0.24),
    accentFill: '#0d7340',
    onAccent: '#ffffff',
    heatmap: ['#e1e6ed', '#c3ead3', '#8dd6ad', '#4dba80', '#1f9457', '#0d6b3c'],
  },
};

/**
 * The device a path belongs to. One rule, used by both the shell and the nav.
 *
 * Only `/android` is tested for, and everything else -- `/windows/...`, the
 * legacy `/apps` and `/sync` redirects, `/login`, a 404 -- falls to the
 * laptop. That asymmetry is deliberate: the laptop's violet is also the
 * `:root` accent, so an unrecognised path renders in the site's own colour
 * rather than in no colour at all.
 */
export function deviceOf(pathname: string): DeviceId {
  return pathname === '/android' || pathname.startsWith('/android/') ? 'android' : 'zephyrus';
}

function block(selector: string, t: AccentTheme): string {
  return `${selector}{`
    + `--accent:${t.accent};`
    + `--accent-bright:${t.accentBright};`
    + `--accent-dim:${t.accentDim};`
    + `--accent-glow:${t.accentGlow};`
    + `--accent-fill:${t.accentFill};`
    + `--on-accent:${t.onAccent};`
    + t.heatmap.map((c, i) => `--hm-${i}:${c};`).join('')
    + '}';
}

/**
 * The whole accent layer as CSS text, inlined by the root layout, for both
 * themes.
 *
 * `:root` carries the laptop's violet so anything outside the device shell --
 * the login page, the not-found page -- still has an accent. Each device then
 * overrides it from `[data-device]` on the shell.
 */
export function accentStyleSheet(): string {
  return [
    block(':root', ACCENTS.zephyrus),
    ...Object.entries(ACCENTS).map(([id, t]) => block(`[data-device='${id}']`, t)),
    // The light theme is `data-theme` on <html>, set before first paint by
    // the script in the root layout (lib/theme.ts). One more attribute in
    // each selector outranks the dark blocks above without !important.
    block(":root[data-theme='light']", LIGHT_ACCENTS.zephyrus),
    ...Object.entries(LIGHT_ACCENTS).map(([id, t]) => block(`[data-theme='light'] [data-device='${id}']`, t)),
  ].join('');
}
