import {
  SkPageHead, SkStats, SkStat, SkDuration, SkCard, SkCallout, SkPlot, SkHeatmap,
  SkStacked, SkSplitBar, SkMask, PHONE_STACK_LEGEND,
} from '@/components/Skeleton';
import { AttributedNote, HomeOpensNote } from '@/components/Notes';

/**
 * Phone Overview skeleton: the page's own markup and headings
 * (components/Skeleton.tsx), so it wraps where the page wraps at every width.
 *
 * A loading boundary is given no params, so it cannot tell a phone on
 * Android 9+ from an older one: it draws the 9+ page, with the unlock row and
 * "Attributed vs unaccounted" -- every phone reporting today. The figures,
 * the phone's name and the legends' app names are stand-ins.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="My Phone" sub="Latest data Wednesday, 30 September 2026 · collected 15 min ago" />
      <SkStats columns={3}>
        <SkStat label="Today" value={<SkDuration value="4" unit="h" sub="19" subUnit="m" />} sub="screen on, so far" />
        <SkStat label="Daily average" value={<SkDuration value="6" unit="h" sub="16" subUnit="m" />} sub="over 27 days of data" />
        <SkStat label="Total screen time" value={<SkDuration value="169" unit="h" sub="35" subUnit="m" />} sub="11 apps" />
      </SkStats>
      <SkStats columns={3}>
        <SkStat label="Unlocks today" value="38" sub="pick-ups, so far" />
        <SkStat label="Unlocks per day" value="48" sub="over 27 days of data" />
        <SkStat label="Total unlocks" value="1,301" sub="pick-ups in this range" />
      </SkStats>
      <SkCard
        title="Daily trend"
        sub="Screen-on per day across 27 days of data."
        aside={<SkCallout label="Heaviest day" detail="Sep 5" value="9h 13m" />}
      >
        <SkPlot height={280} />
      </SkCard>
      <SkCard
        title="Activity"
        sub="Screen-on per day, whatever the range above. Outlined days were never recorded - before the phone first synced, or evicted before it did - which is not the same as a quiet day."
      >
        <SkHeatmap />
      </SkCard>
      <SkCard
        title="Top apps by day"
        sub="Time in apps per day, top 8 stacked; everything else grouped as Other. Apps never cover all of screen-on time: see the last card."
        aside={<SkCallout label="Top app" detail="Video" value="41h 2m" />}
      >
        <SkStacked items={PHONE_STACK_LEGEND} />
      </SkCard>
      <SkCard
        title="Most opened by day"
        sub="Opens per day, top 8 apps stacked; everything else grouped as Other."
        aside={<SkCallout label="Most opened" detail="Messenger" value="402 opens" />}
      >
        <SkStacked items={PHONE_STACK_LEGEND} />
        <SkMask><HomeOpensNote names="Launcher" verb="is" opens="1,108" /></SkMask>
      </SkCard>
      <SkCard
        title="Shape of the day"
        sub="When the screen is actually on."
        aside={<SkCallout label="Busiest hour" detail="9 PM" value="15h 9m" />}
      >
        <SkPlot height={240} />
      </SkCard>
      <SkCard title="Attributed vs unaccounted" sub="Screen-on time, and how much of it any app accounts for.">
        <SkSplitBar gap="0.4rem 1.6rem" items={['In an app 127h 10m (75%)', 'Unaccounted 42h 25m']} />
        <SkMask><AttributedNote ratio="0.75" /></SkMask>
      </SkCard>
    </>
  );
}
