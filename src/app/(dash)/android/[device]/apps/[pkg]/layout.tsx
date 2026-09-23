import { notFound } from 'next/navigation';
import { getAndroidDeviceBySlug, androidAppExists } from '@/lib/android-queries';
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
  return children;
}
