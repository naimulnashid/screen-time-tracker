import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** Where the laptop's sync page used to live. See `windows/[device]/sync`. */
export default function LegacySyncPage() {
  redirect(`/windows/${windowsSlug()}/sync`);
}
