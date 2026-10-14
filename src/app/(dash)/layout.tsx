import { Shell } from '@/components/Shell';
import { deviceLabel, windowsSlug } from '@/lib/config';
import { getAndroidDevices } from '@/lib/queries';
import { inboxConfig } from '@/lib/inbox';

// The shell will query the database for the phone list once that table exists,
// so it must not be cached alongside a stale set of devices.
export const dynamic = 'force-dynamic';

/**
 * Everything behind the password gate renders inside the shell.
 *
 * This stays a server component purely to read config and, later, the device
 * list; the chrome itself is `Shell`, which needs the pathname to pick the
 * device accent.
 *
 * The sidebar lists whatever phones have actually reported, so adding a second
 * handset needs no code change at all. Until one reports the rail shows the
 * laptop alone, which is a fact about the data rather than a component that
 * forgot to render.
 */
export default function DashLayout({ children }: { children: React.ReactNode }) {
  const phones = getAndroidDevices();

  // A malformed inbox entry is the drain's error to report, not the shell's.
  let phoneSync = false;
  try {
    phoneSync = inboxConfig() !== null;
  } catch {
    /* leave the button off the phone pages */
  }

  return (
    <Shell
      phones={phones}
      windowsLabel={deviceLabel()}
      windowsSlug={windowsSlug()}
      phoneSync={phoneSync}
    >
      {children}
    </Shell>
  );
}
