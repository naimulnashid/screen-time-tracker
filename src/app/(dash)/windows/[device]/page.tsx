import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { TrendChart, HourlyChart } from '@/components/Charts';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { KindBar } from '@/components/KindBar';
import { SamplerEmpty } from '@/components/EmptyState';
import { deviceLabel, windowsSlug } from '@/lib/config';
import {
  getOverview, getApps, getDaily, getHourly, hasWindowsData,
  collectedAgo, WINDOWS_DEVICE_ID,
} from '@/lib/queries';
import { ALL_DAYS, parseDays, queryString } from '@/lib/scope';
import { fillDays, heaviestDay } from '@/lib/trend';
import {
  splitDuration, formatDuration, formatDayLong, formatDayShort, formatPercent,
} from '@/lib/format';
import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
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
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  // There is exactly one laptop, so the slug is checked rather than looked up.
  // Without this every misspelling renders the real machine under a wrong
  // address, and the URL stops being an answer to "which device".
  const { device: slug } = await params;
  if (slug !== windowsSlug()) notFound();

  if (!hasWindowsData()) return <SamplerEmpty />;

  const sp = await searchParams;
  const scope = { days: parseDays(sp.days) };

  const data = getOverview(scope);
  const appCount = getApps(scope).filter((a) => a.ms > 0).length;
  const daily = getDaily(scope);
  const hourly = getHourly(scope);
  // The heat map ignores the range selector, as the sibling's does: it answers
  // "what does the last six months look like", which a 7-day scope would
  // reduce to one lit column.
  const history = getDaily({ days: ALL_DAYS }).map((d) => ({ date: d.date, ms: d.active }));

  if (!data.latestDate) return <SamplerEmpty />;

  const todayIso = new Date().toLocaleDateString('en-CA');
  const isToday = data.latestDate === todayIso;
  const dayLabel = isToday ? 'Today' : 'Latest day';
  const collected = collectedAgo(WINDOWS_DEVICE_ID);

  const trend = fillDays(daily.map((d) => ({ date: d.date, ms: d.active })));
  const heaviest = heaviestDay(trend);
  const busiest = hourly.reduce((m, h) => (h.ms > m.ms ? h : m), hourly[0] ?? { hour: 0, ms: 0 });

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
        <p>
          Latest data {formatDayLong(data.latestDate)}
          {collected ? ` · collected ${collected}` : ''}
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
          label="Range total"
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
          sub={`Active time per day across ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} with data. Asleep time is deliberately not drawn.`}
          aside={
            heaviest && (
              <div className="callout">
                <div className="callout-head">
                  <span className="callout-label">Heaviest day</span>
                  <span className="callout-date">{formatDayShort(heaviest.date)}</span>
                </div>
                <div className="callout-value">{formatDuration(heaviest.ms)}</div>
              </div>
            )
          }
        >
          Daily trend
        </CardTitle>
        {daily.length > 1 ? (
          <TrendChart data={trend} />
        ) : (
          <p className="prose-note">
            One day of data so far. The trend appears once the sampler has run
            across more than one day.
          </p>
        )}
      </Card>

      <Card delay={240}>
        <CardTitle sub="Active time per day, whatever the range above. Outlined days were never recorded - before the sampler existed, or while it was not running - which is not the same as a quiet day.">
          Activity
        </CardTitle>
        <ActivityHeatmap
          daily={history}
          label="Daily active time"
          expandHref={`/windows/${slug}/activity${queryString(sp)}`}
        />
      </Card>

      <Card delay={300}>
        <CardTitle
          sub={
            busiest.ms > 0
              ? `Busiest hour: ${busiest.hour}:00 with ${formatDuration(busiest.ms)}`
              : 'Active time by hour of day.'
          }
        >
          Shape of the day
        </CardTitle>
        <HourlyChart data={hourly} />
      </Card>

      {/* Last, because it answers "can these numbers be trusted" rather than
          "how did I spend my time" -- worth a look, not worth the top of the
          page. The unknown-share warning travels with it. */}
      <Card delay={360}>
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
