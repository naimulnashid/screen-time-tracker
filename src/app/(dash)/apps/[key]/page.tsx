import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/config';
import { queryString } from '@/lib/scope';

export const dynamic = 'force-dynamic';

/**
 * Where one laptop app's detail page used to live.
 *
 * The key is passed through UNDECODED. It is already percent-encoded in the
 * incoming path and re-encoding a decoded key would double the escapes on
 * anything containing `%` -- and resolved keys like `exe:visual studio/setup`
 * genuinely carry characters that must stay escaped.
 */
export default async function LegacyAppDetailPage({
  params, searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  redirect(`/windows/${windowsSlug()}/apps/${key}${queryString(await searchParams)}`);
}
