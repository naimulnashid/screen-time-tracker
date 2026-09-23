import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/config';
import { queryString } from '@/lib/scope';

export const dynamic = 'force-dynamic';

/** Where the laptop's app list used to live. See `windows/[device]/apps`. */
export default async function LegacyAppsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/windows/${windowsSlug()}/apps${queryString(await searchParams)}`);
}
