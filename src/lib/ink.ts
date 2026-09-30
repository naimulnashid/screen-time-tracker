/**
 * An app's colour as PAINTED on the current theme: its OKLCH lightness
 * clamped to the band `--ink-lo`..`--ink-hi` that the theme defines, hue and
 * chroma kept.
 *
 * Brand colours were chosen against true black, and some are near-white --
 * the monochrome marks, the pale gradients. On the light theme they would be
 * white bars on a white card. Clamping lightness keeps the colour
 * recognisably itself while guaranteeing it separates from the page, and it
 * happens in CSS, so a theme switch repaints it with no server round trip.
 * Both themes' bands are in globals.css.
 *
 * The dark theme's band is a no-op on purpose: `ensureReadable()` in
 * `app-colour.ts` already lifts a dark brand colour on the server, and its
 * self-tests assert on what it returns.
 *
 * Relative colour syntax is valid anywhere a colour is: style attributes and
 * the SVG presentation attributes Recharts writes, where `var()` already
 * works. Its own module, not `app-colour.ts`, because that one reads the
 * colour map from disk and `Charts.tsx` is a client component.
 *
 * Ported from the sibling Data Usage Tracker, 2026-10-01.
 */
export function ink(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `oklch(from ${color} clamp(var(--ink-lo, 0), l, var(--ink-hi, 1)) c h)`;
}
