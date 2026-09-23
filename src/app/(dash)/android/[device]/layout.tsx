import { notFound } from 'next/navigation';
import { getAndroidDeviceBySlug } from '@/lib/android-queries';

/**
 * The device check for every phone page, done HERE so a wrong slug is a real
 * 404 -- in a page, behind a loading.tsx, it went out as a 200. The reasoning
 * is in `windows/[device]/layout.tsx`.
 *
 * The pages still look the device up themselves, because they need the row;
 * this layout only decides whether the address exists.
 */
export default async function AndroidDeviceLayout({
  params, children,
}: {
  params: Promise<{ device: string }>;
  children: React.ReactNode;
}) {
  if (!getAndroidDeviceBySlug((await params).device)) notFound();
  return children;
}
