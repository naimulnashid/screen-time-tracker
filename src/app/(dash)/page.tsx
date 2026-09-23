import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/config';
import { queryString } from '@/lib/scope';

export const dynamic = 'force-dynamic';

/**
 * The landing page: straight to the laptop.
 *
 * The laptop's pages used to LIVE here. Moving them under `/windows/<slug>/`
 * is what gives its addresses the same shape as the phones' -- `/apps` could
 * not say whose apps it meant. `/` stays the way in, because it is what the
 * sidebar's brand link and every existing bookmark point at.
 */
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/windows/${windowsSlug()}${queryString(await searchParams)}`);
}
