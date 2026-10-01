import { SkPageHead, SkStats, SkStat, SkCard, SkCallout, SkPlot } from '@/components/Skeleton';

/**
 * Phone app detail skeleton: the page's own markup (components/Skeleton.tsx).
 * The app's name and package are stand-ins, so the chart subs that quote the
 * name are too.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead back="All apps" appIcon title="Video" sub="com.example.video" subMono />
      <SkStats columns={4}>
        <SkStat label="Total" value="41h 2m" sub="24.2% of in-app time" />
        <SkStat label="Opens" value="163" sub="across 27 days" />
        <SkStat label="Typical session" value="6m 41s" sub="median, not mean" />
        <SkStat label="Longest" value="1h 52m" sub="single unbroken session" />
      </SkStats>
      <SkCard title="Daily trend" sub="Time in Video per day." aside={<SkCallout label="Heaviest day" detail="Sep 12" value="3h 4m" />}>
        <SkPlot height={260} />
      </SkCard>
      <SkCard title="Opens per day" sub="How many times Video was opened each day." aside={<SkCallout label="Most opens" detail="Sep 20" value="14 opens" />}>
        <SkPlot height={260} />
      </SkCard>
      <SkCard title="Shape of the day" sub="When this app is usually open." aside={<SkCallout label="Busiest hour" detail="10 PM" value="7h 31m" />}>
        <SkPlot height={240} />
      </SkCard>
      <SkCard title="When it gets opened" sub="The hour an open began, not the hours it went on for." aside={<SkCallout label="Busiest hour" detail="10 PM" value="22 opens" />}>
        <SkPlot height={240} />
      </SkCard>
    </>
  );
}
