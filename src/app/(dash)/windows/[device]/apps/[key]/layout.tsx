import { notFound, redirect } from 'next/navigation';
import { appExists, mergedInto } from '@/lib/queries';
import { decodeSegment } from '@/lib/slug';

/**
 * An app nothing ever recorded is a real 404, decided outside the page's
 * loading.tsx for the reason given in `windows/[device]/layout.tsx`.
 *
 * "Exists" means recorded at all. An app the user merged into another
 * redirects to that one (lib/app-prefs.ts), so a bookmark made before the
 * merge still lands on the app.
 */
export default async function WindowsAppLayout({
  params, children,
}: {
  params: Promise<{ device: string; key: string }>;
  children: React.ReactNode;
}) {
  const { device, key: raw } = await params;
  const key = decodeSegment(raw);
  if (key === null || !appExists(key)) notFound();
  const into = mergedInto(key);
  if (into !== null) redirect(`/windows/${device}/apps/${encodeURIComponent(into)}`);
  return children;
}
