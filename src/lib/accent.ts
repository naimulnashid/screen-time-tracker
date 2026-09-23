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
 * The whole accent layer as CSS text, inlined by the root layout.
 *
 * `:root` carries the laptop's violet so anything outside the device shell --
 * the login page, the not-found page -- still has an accent. Each device then
 * overrides it from `[data-device]` on the shell.
 */
export function accentStyleSheet(): string {
  return [
    block(':root', ACCENTS.zephyrus),
    ...Object.entries(ACCENTS).map(([id, t]) => block(`[data-device='${id}']`, t)),
  ].join('');
}
