import {
  SkPageHead, SkStats, SkStat, SkCard, SkCallout, SkPlot, SkDataTable, SkMask,
} from '@/components/Skeleton';

/**
 * Laptop app detail skeleton: the page's own markup (components/Skeleton.tsx).
 * The app's name is a stand-in, so the chart subs that quote it are too.
 * Merged from draws the one-identity case, which is most apps.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead back="All apps" appIcon title="Code Editor" sub="34.9% of active time in this range" />
      <SkStats columns={4}>
        <SkStat label="Total" value="57h 43m" sub="across 20 days" />
        <SkStat label="Opens" value="122" sub="times brought to the foreground" />
        <SkStat label="Typical session" value="25m 53s" sub="median, not mean" />
        <SkStat label="Longest" value="1h 38m" sub="single unbroken session" />
      </SkStats>
      <SkCard title="Daily trend" sub="Time in Code Editor per day." aside={<SkCallout label="Heaviest day" detail="Sep 24" value="5h 30m" />}>
        <SkPlot height={260} />
      </SkCard>
      <SkCard title="Opens per day" sub="How many times Code Editor was opened each day." aside={<SkCallout label="Most opens" detail="Sep 16" value="11 opens" />}>
        <SkPlot height={260} />
      </SkCard>
      <SkCard title="Shape of the day" sub="When this app is usually open." aside={<SkCallout label="Busiest hour" detail="2 PM" value="9h 12m" />}>
        <SkPlot height={240} />
      </SkCard>
      <SkCard title="When it gets opened" sub="The hour an open began, not the hours it went on for." aside={<SkCallout label="Busiest hour" detail="9 AM" value="18 opens" />}>
        <SkPlot height={240} />
      </SkCard>
      <SkCard title="Merged from" sub="Everything that resolved into this entry, so a merge is never silent.">
        <SkDataTable head={['Recorded identity', 'Time']} rows={1} cells={['C:\\Program Files\\Editor\\editor.exe', '57h 43m']} />
        {/* Most apps resolve from one path, and then the page says so. */}
        <SkMask>
          <p className="prose-note" style={{ marginTop: '0.9rem' }}>One identity, so nothing was merged here.</p>
        </SkMask>
      </SkCard>
    </>
  );
}
