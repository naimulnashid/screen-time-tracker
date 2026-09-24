/**
 * The installable-app half of the dashboard: the web app manifest and the
 * icons it names. Pure data, so the self-test can hold it to the install
 * rules without a browser; `src/app/manifest.ts` serves it and
 * `src/app/pwa/[icon]/route.tsx` draws the icons.
 *
 * ⚠️ Every path here is fetched WITHOUT the session cookie. A browser loads a
 * manifest with credentials omitted, so behind the auth gate it would get the
 * login redirect instead and the page would silently stop being installable.
 * `proxy.ts` lets these paths through, and the self-test checks that its
 * matcher does. They carry the app's name and a clock -- nothing the login
 * page does not already show.
 */

/**
 * The page background, `--bg` in `globals.css`. Also the installed window's
 * title bar and splash screen, so the app opens on the colour it paints
 * rather than flashing white first. Black, not an accent: the window belongs
 * to no one device, and the accent layer lives in `accent.ts` alone.
 */
export const APP_BACKGROUND = '#000000';

/**
 * The glyph box inside a MASKABLE icon, as a share of the icon's edge.
 *
 * A launcher may crop a maskable icon to any shape containing the centre
 * circle of radius 0.4 x edge. The clock's outer reach is the ring (r 9.5)
 * plus half its 3-unit stroke, 11 of the glyph's 32 units, and its centre sits
 * half a unit low -- so at 7/8 it reaches 0.314 x edge from the icon's centre,
 * comfortably inside the circle every mask keeps.
 */
export const MASKABLE_GLYPH = 7 / 8;

export interface PwaIcon {
  /** The file name under `/pwa/`, and the route's static param. */
  file: string;
  size: number;
  /**
   * `any` draws `icon.svg` as it is, rounded tile and all. `maskable` puts
   * the clock alone on a full-bleed square, because a launcher's own mask
   * would otherwise cut the tile's corners and leave its hairline edge
   * showing as a clipped outline.
   */
  purpose: 'any' | 'maskable';
}

/** 192 and 512 are the two sizes Chromium's install check asks for. */
export const PWA_ICONS: readonly PwaIcon[] = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'maskable-512.png', size: 512, purpose: 'maskable' },
];

/**
 * Served by `app/apple-icon.tsx`. Maskable-shaped, because iOS applies its
 * own rounded mask and paints any transparency black.
 */
export const APPLE_ICON: Pick<PwaIcon, 'size' | 'purpose'> = { size: 180, purpose: 'maskable' };

/**
 * `icon.svg` with its tile removed, leaving the clock, for the maskable
 * icons. Derived rather than drawn a second time, so the favicon stays the
 * one definition of the mark: its proportions are a legibility argument
 * written down in that file, and a copy would drift from it.
 */
export function glyphOnly(svg: string): string {
  return svg.replace(/<rect\b[^>]*\/>/g, '');
}

export function iconDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export const PWA_MANIFEST = {
  // Scoped by ORIGIN, which includes the port -- so this and the sibling
  // dashboard on 7843 install as two separate apps even though both are
  // `localhost`, unlike their cookies.
  id: '/',
  name: 'Screen Time',
  short_name: 'Screen Time',
  description: 'Local dashboard over per-app screen time history, across a laptop and a phone.',
  // `/` is the one address guaranteed to mean "home" however the devices are
  // named; it redirects to the laptop's Overview.
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: APP_BACKGROUND,
  theme_color: APP_BACKGROUND,
  icons: [
    // Vector first, for a desktop that can use it at any size.
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ...PWA_ICONS.map((i) => ({
      src: `/pwa/${i.file}`,
      sizes: `${i.size}x${i.size}`,
      type: 'image/png',
      purpose: i.purpose,
    })),
  ],
} as const;
