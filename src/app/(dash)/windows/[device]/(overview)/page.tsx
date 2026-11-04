import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { TrendChart, HourlyChart } from '@/components/Charts';
import { RangedStackCard } from '@/components/RangedCharts';
import { Callout } from '@/components/Callout';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { KindBar } from '@/components/KindBar';
import { SamplerEmpty } from '@/components/EmptyState';
import { deviceLabel, windowsSlug } from '@/lib/config';
import {
  getOverview, getApps, getDaily, getHourly, getDailyByApp, hasWindowsData,
  collectedAgo, windowsLogoScope, WINDOWS_DEVICE_ID,
  getWindowsColourOverrides,
} from '@/lib/queries';
import { peakOf } from '@/lib/stack';
import { rangedStacks } from '@/lib/ranged-stack';
import { ALL_HISTORY } from '@/lib/scope';
import { fillDays, heaviestDay, spikeThreshold } from '@/lib/trend';
import {
  splitDuration, formatDuration, formatDayLong, formatDayShort, formatPercent,
  formatHourOfDay,
} from '@/lib/format';
import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';

/** `<page> · <device>` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return windowsTitle((await params).device);
}

export const dynamic = 'force-dynamic';

/**
 * One headline figure.
 *
 * `active` marks the single most important number on the page. Exactly one
 * card should set it, or the emphasis means nothing.
 */
function StatCard({
  label, ms, sub, accent = false, delay,
}: {
  label: string;
  ms: number;
  sub?: string;
  accent?: boolean;
  delay: number;
}) {
  const parts = splitDuration(ms);
  return (
    <Card delay={delay}>
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value${accent ? ' stat-value--accent' : ''}`}
        style={{ marginTop: '0.5rem' }}
      >
        <CountUp value={ms} mode="durationValue" />
        <span className="stat-unit">{parts.unit}</span>
        {parts.sub && (
          <>
            {' '}
            <CountUp value={ms} mode="durationSub" />
            <span className="stat-unit">{parts.sub.unit}</span>
          </>
        )}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Card>
  );
}

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  // The real check, the one that makes a wrong slug a 404, is in
  // [device]/layout.tsx. This one only keeps the page honest on its own.
  const { device: slug } = await params;
  if (slug !== windowsSlug()) notFound();

  if (!hasWindowsData()) return <SamplerEmpty />;

  // Every figure covers all history; the two by-day charts carry a range of
  // their own (lib/scope.ts).
  const scope = ALL_HISTORY;

  const data = getOverview(scope);
  const appCount = getApps(scope).filter((a) => a.ms > 0).length;
  const daily = getDaily(scope);
  const hourly = getHourly(scope);
  const history = daily.map((d) => ({ date: d.date, ms: d.active }));

  if (!data.latestDate) return <SamplerEmpty />;

  const todayIso = new Date().toLocaleDateString('en-CA');
  const isToday = data.latestDate === todayIso;
  const dayLabel = isToday ? 'Today' : 'Latest day';
  const collected = collectedAgo(WINDOWS_DEVICE_ID);

  const trend = fillDays(daily.map((d) => ({ date: d.date, ms: d.active })));
  const heaviest = heaviestDay(trend);
  const spikeOver = spikeThreshold(trend);
  const spikes = spikeOver === null ? 0 : trend.filter((d) => d.ms !== null && d.ms > spikeOver).length;
  const busiest = peakOf(hourly, (h) => h.ms);
  // The span of history held, at the right of the line under the heading.
  const first = daily[0]?.date;
  const span = first
    ? `${formatDayShort(first)} – ${formatDayShort(data.latestDate)} · ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'}`
    : null;

  // The two stacked charts: every app past the top eight is folded into
  // Other, ranked separately for each, because the apps you spend longest in
  // are not the ones you open most -- the same reason By App has two charts.
  const byApp = getDailyByApp(scope);
  const stackOpts = {
    recorded: daily.map((d) => d.date),
    latest: data.latestDate,
    nameOf: (id: string) => byApp.names.get(id) ?? { name: id, base: id },
    device: windowsLogoScope(),
    picked: getWindowsColourOverrides(),
  };
  const timeRanges = rangedStacks({ rows: byApp.time, ...stackOpts });
  const opensRanges = rangedStacks({ rows: byApp.opens, ...stackOpts });

  return (
    <>
      {/* The Sync button used to sit here. It is in the top bar now: the hour
          of staleness it closes is the database's, not this page's. */}
      <div className="page-head">
        <h1>{deviceLabel()}</h1>
        {/*
          Two facts, and they answer different questions. The DATE says which
          day the numbers below describe; "collected" says how long ago the
          database last took delivery. A dashboard that shows only the first
          cannot distinguish "quiet day" from "collector died on Tuesday" --
          which is exactly the confusion the hourly ingest was meant to end.
        */}
        <p className="page-head-line">
          <span>
            Latest data {formatDayLong(data.latestDate)}
            {collected ? ` · collected ${collected}` : ''}
          </span>
          {span && <span>{span}</span>}
        </p>
      </div>

      <div className="grid grid--3">
        <StatCard
          label={dayLabel}
          ms={data.today}
          accent
          sub={isToday ? 'so far' : data.latestDate}
          delay={0}
        />
        <StatCard
          label="Daily average"
          ms={data.dailyAverage}
          // Averaged over days that HAVE data, never over the range length --
          // dividing by 30 when the sampler has run for two of them reports a
          // fifteenth of the truth and looks like a collapse in usage.
          sub={`over ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} with data`}
          delay={60}
        />
        <StatCard
          label="All"
          ms={data.rangeTotal}
          sub={`${appCount} app${appCount === 1 ? '' : 's'}`}
          delay={120}
        />
      </div>

      {/* Each chart gets its own full-width row.
          Side by side they were ~380px wide, which is not enough for 24 hourly
          bars or a month of days: the bars collapse to a few pixels and the
          axis labels start colliding. A time series is read left to right, so
          width is the dimension that actually carries information here.

          Top apps and Most opened moved to By App, above its score cards: they
          rank apps, and that page is where the apps are. */}
      <Card delay={180}>
        <CardTitle
          sub={`Active time per day across ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} with data${spikes ? ` · ${spikes} day${spikes === 1 ? '' : 's'} well above trend` : ''}. Asleep time is deliberately not drawn.`}
          aside={
            heaviest && (
              <Callout label="Heaviest day" detail={formatDayShort(heaviest.date)} value={formatDuration(heaviest.ms)} />
            )
          }
        >
          Daily trend
        </CardTitle>
        {daily.length > 1 ? (
          <TrendChart data={trend} spikeOver={spikeOver} />
        ) : (
          <p className="prose-note">
            One day of data so far. The trend appears once the sampler has run
            across more than one day.
          </p>
        )}
      </Card>

      <Card delay={240}>
        <CardTitle sub="Active time per day. Outlined days were never recorded - before the sampler existed, or while it was not running - which is not the same as a quiet day.">
          Activity
        </CardTitle>
        <ActivityHeatmap
          daily={history}
          label="Daily active time"
          expandHref={`/windows/${slug}/activity`}
        />
      </Card>

      {/* The By App rankings, day by day: which apps made each day's total,
          and which ones were reached for. Every band together IS the active
          time above, since the sampler partitions it -- Other included. */}
      <RangedStackCard
        ranges={timeRanges}
        measure="time"
        title="Top apps by day"
        sub="Active time per day, top 8 apps stacked; everything else grouped as Other."
        delay={300}
      />

      <RangedStackCard
        ranges={opensRanges}
        measure="opens"
        title="Most opened by day"
        sub="Opens per day, top 8 apps stacked; everything else grouped as Other."
        delay={360}
      />

      <Card delay={420}>
        <CardTitle
          sub="Active time by hour of day, summed over all history."
          aside={
            busiest && (
              <Callout label="Busiest hour" detail={formatHourOfDay(busiest.hour)} value={formatDuration(busiest.ms)} />
            )
          }
        >
          Shape of the day
        </CardTitle>
        <HourlyChart data={hourly} />
      </Card>

      {/* Last, because it answers "can these numbers be trusted" rather than
          "how did I spend my time" -- worth a look, not worth the top of the
          page. The unknown-share warning travels with it. */}
      <Card delay={480}>
        <CardTitle sub="Every millisecond the sampler accounted for, and how.">
          Where the time went
        </CardTitle>
        <KindBar kinds={data.kinds} />
        {data.unknownShare >= 10 && (
          <p className="prose-note" style={{ marginTop: '1rem' }}>
            <strong>{formatPercent(data.unknownShare)}</strong> of tracked time is
            unattributed &mdash; the sampler saw no foreground window and declined
            to guess. A large or growing share means it is not seeing the desktop
            properly, not that the machine was idle.
          </p>
        )}
      </Card>
    </>
  );
}
