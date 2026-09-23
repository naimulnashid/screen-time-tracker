import { notFound } from 'next/navigation';
import { appExists } from '@/lib/queries';
import { decodeSegment } from '@/lib/slug';

/**
 * An app nothing ever recorded is a real 404, decided outside the page's
 * loading.tsx for the reason given in `windows/[device]/layout.tsx`.
 *
 * "Exists" means recorded at ALL, not in the current range: an app with no
 * time in the selected range still has a page, which says so.
 */
export default async function WindowsAppLayout({
  params, children,
}: {
  params: Promise<{ key: string }>;
  children: React.ReactNode;
}) {
  const key = decodeSegment((await params).key);
  if (key === null || !appExists(key)) notFound();
  return children;
}
