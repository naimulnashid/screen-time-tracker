import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { ExpandedHeatmap } from '@/components/ActivityHeatmap';
import { SamplerEmpty } from '@/components/EmptyState';
import { deviceLabel, windowsSlug } from '@/lib/config';
import { getDaily, hasWindowsData } from '@/lib/queries';
import { ALL_DAYS, queryString } from '@/lib/scope';
import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return windowsTitle((await params).device, 'Activity');
}

export const dynamic = 'force-dynamic';

/**
 * The Overview's Activity card, expanded to the whole history.
 *
 * Reached from that card's Expand button. Ignores the day range, like the
 * card does, but carries the query string back to the Overview so the range
 * you left is the range you return to.
 */
export default async function WindowsActivityPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { device: slug } = await params;
  if (slug !== windowsSlug()) notFound();
  if (!hasWindowsData()) return <SamplerEmpty />;

  const sp = await searchParams;
  const daily = getDaily({ days: ALL_DAYS }).map((d) => ({ date: d.date, ms: d.active }));
  if (daily.length === 0) return <SamplerEmpty />;

  return (
    <>
      <div className="page-head">
        <Link href={`/windows/${slug}${queryString(sp)}`} className="back-link">&larr; Overview</Link>
        <h1 style={{ marginTop: '0.6rem' }}>Activity</h1>
        <p>Every day recorded, six months to a row, on one colour scale</p>
      </div>

      <Card hover={false}>
        <CardTitle sub="Active time per day. Outlined days were never recorded - before the sampler existed, or while it was not running - which is not the same as a quiet day.">
          {deviceLabel()}
        </CardTitle>
        <ExpandedHeatmap daily={daily} earliest={daily[0]!.date} label="Daily active time" />
      </Card>
    </>
  );
}
