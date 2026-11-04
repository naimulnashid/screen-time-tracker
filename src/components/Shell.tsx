'use client';

import { usePathname } from 'next/navigation';
import { deviceOf } from '@/lib/accent';
import { Sidebar, type SidebarPhone } from './Sidebar';
import { Nav } from './Nav';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
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
 * The Sync button lives here rather than on the Overview. The staleness it
 * fixes belongs to the DATABASE, not to one page -- By App and Sync Status
 * read the same rows and were just as far behind, with no way to close the gap
 * without going back to the Overview first. It is on the phone's pages only
 * when the cloud inbox is configured: a sync drains it, so a phone's upload
 * lands now rather than at the next hourly ingest. A phone that posts straight
 * to the dashboard has nothing waiting here, and there it gets no button.
 */
export function Shell({
  phones, windowsLabel, windowsSlug, phoneSync, children,
}: {
  /** What the laptop is called, from config. */
  windowsLabel: string;
  /** The laptop's URL segment, derived from that label on the server. */
  windowsSlug: string;
  /** Android devices that have reported, for the sidebar. */
  phones: SidebarPhone[];
  /** A sync drains the cloud inbox, so the phone pages get the button too. */
  phoneSync: boolean;
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
            {/* The range chips that sat beside it are gone (2026-11-03): pages
                cover all history, and the daily charts carry their own range. */}
            {(device !== 'android' || phoneSync) && <SyncNowButton />}
            <ThemeToggle />
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
