'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { deviceOf } from '@/lib/accent';
import { Sidebar, type SidebarPhone } from './Sidebar';
import { Nav } from './Nav';
import { ScopeBar } from './ScopeBar';
import { SignOutButton } from './SignOutButton';
import { SyncNowButton } from './SyncNowButton';
import { Footer } from './Footer';

/**
 * The dashboard shell: sidebar, top bar, content, footer.
 *
 * A client component because it needs the pathname for two things a server
 * layout cannot know:
 *
 * - **`data-device`**, which is what swaps the accent. Every accent in the app
 *   is a CSS variable defined in `accent.ts`, so this one attribute repaints
 *   buttons, active tabs, focus rings, chart strokes and the heat-map ramp.
 * - **Which page tabs to show**, since each device has its own set.
 *
 * The Sync button lives here rather than on the Overview, and only on the
 * laptop's pages. The staleness it fixes belongs to the DATABASE, not to one
 * page -- By App and Sync Status read the same rows and were just as far
 * behind, with no way to close the gap without going back to the Overview
 * first. The phone has no button because it pushes on its own schedule; there
 * is nothing sitting on this machine's disk waiting to be folded in.
 */
export function Shell({
  phones, windowsLabel, windowsSlug, children,
}: {
  /** What the laptop is called, from config. */
  windowsLabel: string;
  /** The laptop's URL segment, derived from that label on the server. */
  windowsSlug: string;
  /** Android devices that have reported, for the sidebar. */
  phones: SidebarPhone[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const device = deviceOf(pathname);

  return (
    <div className="shell" data-device={device}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar phones={phones} windowsLabel={windowsLabel} windowsSlug={windowsSlug} />
      <div className="shell-body">
        <header className="topbar">
          <Nav />
          <div className="topbar-right">
            {/* Before the range chips. It shares their `chip` styling, so it
                reads as one of them if it sits between the group and Sign out;
                on the left it is the first thing in the group and its label and
                icon set it apart. */}
            {device !== 'android' && <SyncNowButton />}
            {/* ScopeBar reads useSearchParams, which opts any page containing
                it out of static prerendering. Without this boundary the
                built-in /_not-found page fails to prerender. */}
            <Suspense fallback={null}>
              <ScopeBar />
            </Suspense>
            <SignOutButton />
          </div>
        </header>
        {/* tabIndex -1 so the skip link moves focus here, not just the scroll. */}
        <main className="main" id="main" tabIndex={-1}>
          <div className="container">{children}</div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
