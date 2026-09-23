import { notFound } from 'next/navigation';
import { windowsSlug } from '@/lib/config';

/**
 * The slug check for every laptop page, done HERE so a wrong one is a real 404.
 *
 * In a page it rendered the not-found screen with status 200: each page sits
 * inside a loading.tsx Suspense boundary, and the 200 has already gone out
 * with the skeleton by the time the page runs. A layout is outside its own
 * segment's boundary, and nothing above this one has a loading.tsx -- which is
 * why the Overview and By App skeletons live in the (overview) and (list)
 * route groups rather than at [device] and apps, where they would wrap every
 * page underneath.
 *
 * There is exactly one laptop, so the slug is compared rather than looked up.
 * Without this every misspelling renders the real machine under a wrong
 * address, and the URL stops being an answer to "which device".
 */
export default async function WindowsDeviceLayout({
  params, children,
}: {
  params: Promise<{ device: string }>;
  children: React.ReactNode;
}) {
  if ((await params).device !== windowsSlug()) notFound();
  return children;
}
