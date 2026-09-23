import type { DeviceId } from './accent';

/**
 * What each device is, and what pages it has.
 *
 * Shared by the sidebar (which lists devices) and the top bar (which lists that
 * device's pages), so the two cannot disagree about which routes exist.
 *
 * **Every page lives under `/<platform>/<slug>/`, on both halves.** The laptop
 * kept the bare `/`, `/apps` and `/sync` for a while, on the reasoning that
 * moving it would break bookmarks for no visible gain -- but the gain turned
 * out to be that an address names a DEVICE. `/apps` cannot say whose apps it
 * means, and the moment the sidebar holds three entries that is a question the
 * URL has to answer. The old paths redirect, so the bookmarks survive.
 */

export interface DevicePage {
  href: string;
  label: string;
  /** True for a section root, which needs an exact match to light up. */
  root?: boolean;
}

/** The laptop's page set, rooted at its device slug. */
export function windowsPages(slug: string): DevicePage[] {
  const base = `/windows/${slug}`;
  return [
    { href: base, label: 'Overview', root: true },
    { href: `${base}/apps`, label: 'By App' },
    { href: `${base}/sync`, label: 'Sync Status' },
  ];
}

/** The Android page set, rooted at one device. */
export function androidPages(slug: string): DevicePage[] {
  const base = `/android/${slug}`;
  return [
    { href: base, label: 'Overview', root: true },
    { href: `${base}/apps`, label: 'By App' },
    { href: `${base}/sync`, label: 'Sync Status' },
  ];
}

/**
 * The tabs for whatever page is currently open.
 *
 * Derives the slug from the path rather than taking it as a prop: the top bar
 * renders inside a client shell that has the pathname anyway, and threading
 * the slug down from a server layout would mean the tabs briefly disagreeing
 * with the URL during a device switch.
 *
 * A path with no slug -- `/`, `/windows`, `/android`, or one of the redirected
 * legacy addresses -- yields no tabs. Those render for the instant before the
 * redirect lands, and a tab strip whose links all point at a device the URL
 * has not named yet is worse than none.
 */
export function pagesForPath(device: DeviceId, pathname: string): DevicePage[] {
  const parts = pathname.split('/');
  const slug = parts[1] === (device === 'android' ? 'android' : 'windows') ? parts[2] : undefined;
  if (!slug) return [];
  return device === 'android' ? androidPages(slug) : windowsPages(slug);
}
