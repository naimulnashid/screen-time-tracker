import {
  SkPageHead, SkStats, SkStat, SkDuration, SkCard, SkCallout, SkPlot, SkHeatmap,
  SkStacked, SkSplitBar, STACK_LEGEND,
} from '@/components/Skeleton';
import { deviceLabel } from '@/lib/config';

/**
 * Laptop Overview skeleton: the page's own markup and headings
 * (components/Skeleton.tsx), so it wraps where the page wraps at every width.
 *
 * Stand-ins, because a loading boundary has no data: the figures and the
 * stacked legends' app names, sized to what the page usually shows. The
 * "unattributed" warning under Where the time went is left out: it shows
 * only above 10%, and the card is the last on the page.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title={deviceLabel()} sub="Latest data Wednesday, 30 September 2026 · collected 10 min ago" />
      <SkStats columns={3}>
        <SkStat label="Today" value={<SkDuration value="9" unit="h" sub="37" subUnit="m" />} sub="so far" />
        <SkStat label="Daily average" value={<SkDuration value="8" unit="h" sub="16" subUnit="m" />} sub="over 20 days with data" />
        <SkStat label="Range total" value={<SkDuration value="165" unit="h" sub="35" subUnit="m" />} sub="10 apps" />
      </SkStats>
      <SkCard
        title="Daily trend"
        sub="Active time per day across 20 days with data. Asleep time is deliberately not drawn."
        aside={<SkCallout label="Heaviest day" detail="Sep 15" value="10h 42m" />}
      >
        <SkPlot height={280} />
      </SkCard>
      <SkCard
        title="Activity"
        sub="Active time per day, whatever the range above. Outlined days were never recorded - before the sampler existed, or while it was not running - which is not the same as a quiet day."
      >
        <SkHeatmap />
      </SkCard>
      <SkCard
        title="Top apps by day"
        sub="Active time per day, top 8 apps stacked; everything else grouped as Other."
        aside={<SkCallout label="Top app" detail="Code Editor" value="57h 43m" />}
      >
        <SkStacked items={STACK_LEGEND} />
      </SkCard>
      <SkCard
        title="Most opened by day"
        sub="Opens per day, top 8 apps stacked; everything else grouped as Other."
        aside={<SkCallout label="Most opened" detail="Code Editor" value="122 opens" />}
      >
        <SkStacked items={STACK_LEGEND} />
      </SkCard>
      <SkCard
        title="Shape of the day"
        sub="Active time by hour of day, summed across the range."
        aside={<SkCallout label="Busiest hour" detail="2 PM" value="19h 41m" />}
      >
        <SkPlot height={240} />
      </SkCard>
      <SkCard title="Where the time went" sub="Every millisecond the sampler accounted for, and how.">
        <SkSplitBar items={['■ Active 165h 35m', '■ Locked 89h 6m', '■ Unattributed 0s', '■ Asleep 225h 17m']} />
      </SkCard>
    </>
  );
}
