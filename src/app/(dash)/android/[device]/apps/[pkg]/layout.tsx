import { notFound, redirect } from 'next/navigation';
import { getAndroidDeviceBySlug, androidAppExists, androidMergedInto } from '@/lib/android-queries';
import { decodeSegment } from '@/lib/slug';

/**
 * A package this phone never recorded is a real 404, decided outside the
 * page's loading.tsx for the reason given in `windows/[device]/layout.tsx`.
 * Recorded at all, not in the current range -- that case has its own page.
 */
export default async function AndroidAppLayout({
  params, children,
}: {
  params: Promise<{ device: string; pkg: string }>;
  children: React.ReactNode;
}) {
  const { device: slug, pkg: raw } = await params;
  const device = getAndroidDeviceBySlug(slug);
  const pkg = decodeSegment(raw);
  if (!device || pkg === null || !androidAppExists(device.deviceId, pkg)) notFound();
  // Merged into another app (lib/app-prefs.ts): its page is that app's.
  const into = androidMergedInto(device.deviceId, pkg);
  if (into !== null) redirect(`/android/${slug}/apps/${encodeURIComponent(into)}`);
  return children;
}
