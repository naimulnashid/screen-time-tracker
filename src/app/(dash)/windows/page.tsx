import { redirect } from 'next/navigation';
import { windowsSlug } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * `/windows` holds no content of its own, exactly as `/android` does not.
 *
 * There is only one laptop, so unlike the phone side there is nothing to
 * choose between -- but an address that names a platform rather than a device
 * is still the wrong shape, and leaving it a 404 would make the obvious
 * shortened URL fail for no reason.
 */
export default function WindowsIndexPage() {
  redirect(`/windows/${windowsSlug()}`);
}
