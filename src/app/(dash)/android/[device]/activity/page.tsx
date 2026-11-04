import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { ExpandedHeatmap } from '@/components/ActivityHeatmap';
import { getAndroidDeviceBySlug, getAndroidDaily } from '@/lib/android-queries';
import { ALL_HISTORY } from '@/lib/scope';
import { BackKey } from '@/components/BackKey';
import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';

/** `<page> · <device>` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return androidTitle((await params).device, 'Activity');
}

export const dynamic = 'force-dynamic';

/** The Android Overview's Activity card, expanded. See the laptop's page. */
export default async function AndroidActivityPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  const { device: slug } = await params;
  const device = getAndroidDeviceBySlug(slug);
  if (!device) notFound();

  const daily = getAndroidDaily(device.deviceId, ALL_HISTORY)
    .map((d) => ({ date: d.date, ms: d.screenOn }));
  const back = `/android/${slug}`;

  return (
    <>
      <BackKey href={back} />
      <div className="page-head">
        <Link href={back} className="back-link">&larr; Overview</Link>
        <h1 style={{ marginTop: '0.6rem' }}>Activity</h1>
        <p>Every day recorded, six months to a row, on one colour scale</p>
      </div>

      <Card hover={false}>
        <CardTitle sub="Screen-on per day. Outlined days were never recorded - before the phone first synced, or evicted before it did - which is not the same as a quiet day.">
          {device.label}
        </CardTitle>
        {daily.length === 0 ? (
          <p className="prose-note">{device.label} has not sent any screen time yet.</p>
        ) : (
          <ExpandedHeatmap daily={daily} earliest={daily[0]!.date} label="Daily screen-on time" />
        )}
      </Card>
    </>
  );
}
