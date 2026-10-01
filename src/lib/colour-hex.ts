/**
 * Tidy a submitted colour: `#rgb` or `#rrggbb`, any case, with or without the
 * `#`. Returns lowercase `#rrggbb`, or null for anything else.
 *
 * The result is written into style attributes and SVG fills, so nothing but a
 * plain hex may pass -- not a name, not a `var()`, not a `;` smuggling in a
 * second declaration.
 *
 * Its own module because both sides need it: the colour field (a client
 * component) checks as you type, and `app-colour-overrides.ts`, which imports
 * `node:sqlite`, enforces it on the way in and again on the way out.
 */
export function cleanColour(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const hex = m[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}
