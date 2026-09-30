import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { accentStyleSheet } from '@/lib/accent';
import { THEME_SCRIPT, THEME_COLORS } from '@/lib/theme';

export const metadata: Metadata = {
  // Pages set `<page> · <device>` (lib/page-title.ts); this suffixes the app.
  title: { default: 'Screen Time', template: '%s · Screen Time' },
  description: 'Local dashboard over per-app screen time history, across a laptop and a phone.',
  // The manifest (app/manifest.ts) covers installing on Chromium. iOS reads
  // neither it nor its icons, and wants this and app/apple-icon.tsx instead.
  // NOT `icons` here: that replaces the file-based favicon.
  appleWebApp: { capable: true, title: 'Screen Time Dashboard', statusBarStyle: 'black' },
};

/**
 * A phone gets the DESKTOP layout, zoomed out to fit, as Chrome's "Desktop
 * site" would give it -- not a narrow reflow.
 *
 * `width=1024` makes the phone lay the page out on a 1024px canvas and scale
 * it to the screen; desktop browsers ignore the tag entirely. 1024 rather
 * than Chrome's own 980 because the Overview's three-across stat rows were
 * measured to fit at 997px, and a little margin over that keeps them three
 * wide. It also clears the 860px breakpoint, so none of the narrow-screen
 * rules fire -- which is the point: the page reads the same on every device.
 *
 * `initialScale` is cleared on purpose. Next's default viewport carries
 * `initial-scale=1`, and merged with a fixed width that means "show 1024px at
 * 100%" -- a phone would open zoomed in on the top-left corner with the rest
 * a sideways scroll away. Undefined is dropped from the tag.
 */
export const viewport: Viewport = {
  width: 1024,
  initialScale: undefined,
  // The installed app's title bar, and a phone browser's address bar, in the
  // page's own canvas colour so neither frames it. This is the dark theme's;
  // the theme script (lib/theme.ts) rewrites it when the light one is on.
  themeColor: THEME_COLORS.dark,
};

/**
 * Root layout: fonts, globals, nothing else.
 *
 * The dashboard chrome (sidebar, top bar, scope selector) lives in the `(dash)`
 * route group instead, so `/login` can render without it. That group changes no
 * URLs -- it exists purely so the login screen does not inherit a shell that
 * queries the database and renders navigation the visitor cannot use yet.
 *
 * The accent layer is inlined here rather than written into `globals.css`
 * because it is generated from `accent.ts`, which is the one place any accent
 * colour is defined. Inlining it in <head> also means the correct accent is
 * painted with the first frame, with no flash of the default.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme and
    // color-scheme on <html> before React hydrates, by design.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* First in <head>, so the right theme is set before anything paints. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: accentStyleSheet() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
