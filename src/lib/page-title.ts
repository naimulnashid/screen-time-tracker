import type { Metadata } from 'next';
import { deviceLabel, windowsSlug } from './config';
import { appNameForKey } from './queries';
import { getAndroidDeviceBySlug, androidAppLabel } from './android-queries';

/**
 * Page titles, as `<page> · <device>`, which the root layout suffixes with
 * `· Screen Time`.
 *
 * WCAG 2.4.2: every page used to be titled just "Screen Time", so a tab strip
 * or a screen reader's window list could not tell Overview from Sync Status,
 * or one phone from another. The page comes first because that is the part a
 * narrow tab has room for.
 *
 * A slug that names no device gets the bare default; the page itself 404s.
 */

export type Section = 'By App' | 'Activity' | 'Sync Status';

const title = (parts: (string | null | undefined)[]): Metadata => ({
  title: parts.filter(Boolean).join(' · '),
});

export function windowsTitle(slug: string, section?: Section): Metadata {
  if (slug !== windowsSlug()) return {};
  return title([section ?? 'Overview', deviceLabel()]);
}

export function windowsAppTitle(slug: string, rawKey: string): Metadata {
  if (slug !== windowsSlug()) return {};
  return title([appNameForKey(decodeURIComponent(rawKey)) ?? 'App', deviceLabel()]);
}

export function androidTitle(slug: string, section?: Section): Metadata {
  const device = getAndroidDeviceBySlug(slug);
  if (!device) return {};
  return title([section ?? 'Overview', device.label]);
}

export function androidAppTitle(slug: string, rawPkg: string): Metadata {
  const device = getAndroidDeviceBySlug(slug);
  if (!device) return {};
  const pkg = decodeURIComponent(rawPkg);
  return title([androidAppLabel(device.deviceId, pkg) ?? pkg, device.label]);
}
