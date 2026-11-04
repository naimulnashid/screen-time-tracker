import {
  SkPageHead, SkStats, SkStat, SkDuration, SkCard, SkCallout, SkPlot, SkHeatmap,
  SkStacked, SkKindDonut, SkRangeMenu, STACK_LEGEND,
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
      <SkPageHead
        title={deviceLabel()}
        sub="Latest data Wednesday, 30 September 2026 · collected 10 min ago"
        span="Sep 11 – Sep 30 · 20 days"
      />
      <SkStats columns={3}>
        <SkStat label="Today" value={<SkDuration value="9" unit="h" sub="37" subUnit="m" />} sub="so far" />
        <SkStat label="Daily average" value={<SkDuration value="8" unit="h" sub="16" subUnit="m" />} sub="over 20 days with data" />
        <SkStat label="All" value={<SkDuration value="165" unit="h" sub="35" subUnit="m" />} sub="10 apps" />
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
        sub="Active time per day. Outlined days were never recorded - before the sampler existed, or while it was not running - which is not the same as a quiet day."
      >
        <SkHeatmap />
      </SkCard>
      <SkCard
        title="Top apps by day"
        sub="Active time per day, top 8 apps stacked; everything else grouped as Other. Top app Code Editor, 57h 43m."
        aside={<SkRangeMenu />}
      >
        <SkStacked items={STACK_LEGEND} />
      </SkCard>
      <SkCard
        title="Most opened by day"
        sub="Opens per day, top 8 apps stacked; everything else grouped as Other. Most opened Code Editor, 122 opens."
        aside={<SkRangeMenu />}
      >
        <SkStacked items={STACK_LEGEND} />
      </SkCard>
      <SkCard
        title="Shape of the day"
        sub="Active time by hour of day, summed over all history."
        aside={<SkCallout label="Busiest hour" detail="2 PM" value="19h 41m" />}
      >
        <SkPlot height={240} />
      </SkCard>
      <SkCard title="Where the time went" sub="Every millisecond the sampler accounted for, and how.">
        <SkKindDonut
          rows={[
            ['Active', 'An application was in the foreground.', '165h 35m', '34.4%'],
            ['Locked', 'The lock screen was in front. Positively detected, not inferred.', '89h 6m', '18.5%'],
            ['Unattributed', 'No foreground window, and no positive evidence of a lock. Not guessed at.', '0s', '0.0%'],
            ['Asleep', 'The machine slept, or the sampler was not running. Absence of a measurement, not a quantity.', '225h 17m', '46.9%'],
          ]}
        />
      </SkCard>
    </>
  );
}
