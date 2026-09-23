import { redirect } from 'next/navigation';
import { busiestAndroidSlug } from '@/lib/android-queries';

export const dynamic = 'force-dynamic';

/**
 * `/android` holds no content of its own.
 *
 * There can be more than one phone, so a bare "android" URL cannot say which
 * one. It forwards to whichever has the most stored screen time. Same rule as
 * the sibling project: an address names a DEVICE, not a platform.
 */
export default function AndroidIndexPage() {
  const slug = busiestAndroidSlug();
  if (!slug) {
    return (
      <div className="empty">
        <h1 style={{ marginBottom: '0.8rem' }}>No phone has reported</h1>
        <p style={{ maxWidth: 560, margin: '0 auto' }}>
          Install Screen Time Reporter on the phone, grant usage access, and
          enter this dashboard&rsquo;s address and ingest token.
        </p>
      </div>
    );
  }
  redirect(`/android/${slug}`);
}
