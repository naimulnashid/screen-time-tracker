import { AttributedNote } from '@/components/Notes';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { TrendChart, HourlyChart } from '@/components/Charts';
import { RangedStackCard } from '@/components/RangedCharts';
import { Callout } from '@/components/Callout';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import {
  getAndroidDeviceBySlug, getAndroidOverview, getAndroidDaily, getAndroidHourly,
  getAndroidDailyByApp,
  getAndroidColourOverrides,
} from '@/lib/android-queries';
import { peakOf } from '@/lib/stack';
import { rangedStacks } from '@/lib/ranged-stack';
import { isHomeSurface } from '@/lib/home-surface';
import { collectedAgo } from '@/lib/queries';
import { ALL_HISTORY } from '@/lib/scope';
import { fillDays, heaviestDay, spikeThreshold } from '@/lib/trend';
import {
  splitDuration, formatDuration, formatDayLong, formatDayShort, formatPercent,
  formatHourOfDay,
} from '@/lib/format';
import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';

/** `<page> · <device>` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return androidTitle((await params).device);
}

export const dynamic = 'force-dynamic';

function StatCard({
  label, ms, sub, accent = false, delay,
}: {
  label: string; ms: number; sub?: string; accent?: boolean; delay: number;
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

/**
 * A whole-number headline: unlocks, opens, anything you can count.
 *
 * Deliberately shaped like `StatCard` above rather than folded into it. That
 * one splits a duration into two rungs and renders a unit beside each; a count
 * has no ladder and no unit, and threading a mode through would make the more
 * common card harder to read for the sake of saving a dozen lines.
 */
function CountCard({
  label, value, sub, delay,
}: {
  label: string; value: number; sub?: string; delay: number;
}) {
  return (
    <Card delay={delay}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ marginTop: '0.5rem' }}>
        <CountUp value={value} mode="count" />
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Card>
  );
}

export default async function AndroidOverviewPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  const { device: slug } = await params;
  const device = getAndroidDeviceBySlug(slug);
  if (!device) notFound();

  // All history, like the laptop's; the by-day charts carry their own range.
  const scope = ALL_HISTORY;

  const data = getAndroidOverview(device.deviceId, scope);
  const daily = getAndroidDaily(device.deviceId, scope);
  const hourly = getAndroidHourly(device.deviceId, scope);
  const history = daily.map((d) => ({ date: d.date, ms: d.screenOn }));

  if (!data.latestDate) {
    return (
      <div className="empty">
        <h1 style={{ marginBottom: '0.8rem' }}>Nothing synced yet</h1>
        <p style={{ maxWidth: 520, margin: '0 auto' }}>
          {device.label} has registered but has not sent any screen time.
          Open Screen Time Reporter on the phone and press <strong>Sync now</strong>.
        </p>
      </div>
    );
  }

  const todayIso = new Date().toLocaleDateString('en-CA');
  const isToday = data.latestDate === todayIso;
  const collected = collectedAgo(device.deviceId);

  const trend = fillDays(daily.map((d) => ({ date: d.date, ms: d.screenOn })));
  const heaviest = heaviestDay(trend);
  const spikeOver = spikeThreshold(trend);
  const spikes = spikeOver === null ? 0 : trend.filter((d) => d.ms !== null && d.ms > spikeOver).length;
  const busiest = peakOf(hourly, (h) => h.ms);
  const first = daily[0]?.date;
  const span = first
    ? `${formatDayShort(first)} – ${formatDayShort(data.latestDate)} · ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'}`
    : null;

  // The two stacked charts, each ranked by its own measure. See the laptop's
  // Overview; the one difference is that app rows here do NOT add up to the
  // headline, which the last card explains.
  const byApp = getAndroidDailyByApp(device.deviceId, scope);
  const nameOf = (id: string) => byApp.labels.get(id) ?? { name: id, base: id };
  const stackOpts = {
    recorded: daily.map((d) => d.date),
    latest: data.latestDate,
    nameOf,
    device: slug,
    picked: getAndroidColourOverrides(device.deviceId),
  };
  const timeRanges = rangedStacks({ rows: byApp.time, ...stackOpts });
  // The home screen leaves the OPENS stack only, as it leaves By App's Most
  // opened: it is passed through, not opened, and would be the tallest band
  // by far. It stays in the time stack, and the card names it -- see
  // home-surface.ts.
  const opensRanges = rangedStacks({ rows: byApp.opens, ...stackOpts, exclude: isHomeSurface });
  const homeIds = [...new Set(byApp.opens.map((r) => r.id).filter(isHomeSurface))];

  const attributedPct = data.rangeScreenOn > 0
    ? (data.rangeApps / data.rangeScreenOn) * 100
    : 0;

  // A phone below Android 9 records no screen or unlock events, so its
  // headline is app time -- and every word on this page has to say so. See
  // lib/android-source.ts.
  const screen = data.source === 'screen';
  const measure = screen ? 'screen on' : 'in apps';
  const perDay = screen ? 'Screen-on per day' : 'Time in apps per day';

  return (
    <>
      <div className="page-head">
        <h1>{device.label}</h1>
        {/* Same two facts as the laptop's Overview, in the same order and the
            same words, because they mean the same thing. The Android release
            moved to Sync Status: it is a property of the device, not of how
            current these numbers are. */}
        <p className="page-head-line">
          <span>
            Latest data {formatDayLong(data.latestDate)}
            {collected ? ` · collected ${collected}` : ''}
          </span>
          {span && <span>{span}</span>}
        </p>
      </div>

      {/*
        Two rows of three: screen time on top, unlocks beneath, each as the
        latest day, the per-day average and all history -- so the columns
        read down as well as across. The totals live here because By App no
        longer carries score cards; the laptop's Overview has its All card in
        the same place.

        The unlock cards replaced one that reported unlocked TIME as a share of
        screen-on time -- a ratio that barely moves, because the phone is
        unlocked for nearly all of the time its screen is on. How many times
        you picked the phone up is a different measurement of the same habit,
        and one that varies. Unlocked time is still on Sync Status.
      */}
      <div className="grid grid--3">
        <StatCard
          label={isToday ? 'Today' : 'Latest day'}
          ms={data.today}
          accent
          sub={isToday ? `${measure}, so far` : measure}
          delay={0}
        />
        <StatCard
          label="Daily average"
          ms={data.dailyAverage}
          sub={`over ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} of data`}
          delay={60}
        />
        <StatCard
          label={screen ? 'Total screen time' : 'Total app time'}
          ms={data.rangeScreenOn}
          sub={`${data.appCount} app${data.appCount === 1 ? '' : 's'}`}
          delay={120}
        />
      </div>

      {screen && (
      <div className="grid grid--3">
        <CountCard
          label={isToday ? 'Unlocks today' : 'Unlocks, latest day'}
          value={data.unlocksToday}
          sub={isToday ? 'pick-ups, so far' : 'pick-ups'}
          delay={180}
        />
        <CountCard
          label="Unlocks per day"
          value={data.unlocksDailyAverage}
          sub={`over ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} of data`}
          delay={240}
        />
        <CountCard
          label="Total unlocks"
          value={data.unlocksTotal}
          sub="pick-ups in all history"
          delay={300}
        />
      </div>
      )}

      {/* One chart per row. See the note on the Windows overview: side by side
          these are too narrow for 24 hourly bars or a month of days. Top apps
          and Most opened moved to By App, as they did on the laptop. */}
      <Card delay={360}>
        <CardTitle
          sub={`${perDay} across ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} of data${spikes ? ` · ${spikes} day${spikes === 1 ? '' : 's'} well above trend` : ''}.`}
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
          <p className="prose-note">One day of data so far.</p>
        )}
      </Card>

      <Card delay={420}>
        <CardTitle sub={`${perDay}. Outlined days were never recorded - before the phone first synced, or evicted before it did - which is not the same as a quiet day.`}>
          Activity
        </CardTitle>
        <ActivityHeatmap
          daily={history}
          label={screen ? 'Daily screen-on time' : 'Daily time in apps'}
          expandHref={`/android/${slug}/activity`}
        />
      </Card>

      <RangedStackCard
        ranges={timeRanges}
        measure="time"
        title="Top apps by day"
        sub={
          screen
            ? 'Time in apps per day, top 8 stacked; everything else grouped as Other. Apps never cover all of screen-on time: see the last card.'
            : 'Time in apps per day, top 8 stacked; everything else grouped as Other.'
        }
        delay={480}
      />

      <RangedStackCard
        ranges={opensRanges}
        measure="opens"
        title="Most opened by day"
        sub="Opens per day, top 8 apps stacked; everything else grouped as Other."
        delay={540}
        excludedNames={
          homeIds.length > 0
            ? { names: homeIds.map((id) => nameOf(id).name).join(', '), count: homeIds.length }
            : undefined
        }
      />

      <Card delay={600}>
        <CardTitle
          sub={screen ? 'When the screen is actually on.' : 'When an app is actually in front.'}
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

      {/* Last, the laptop's "Where the time went" counterpart: how far the
          per-app figures can be trusted to add up, rather than how the day
          was spent. A pre-9 phone has nothing to compare against, and says
          why instead of drawing apps against themselves. */}
      {!screen && (
        <Card delay={660}>
          <CardTitle sub="Why this phone's figures are app time, and why there are no unlocks.">
            No screen events on Android {device.androidRelease}
          </CardTitle>
          <p className="prose-note">
            Android only started recording when the screen turns on and off,
            and when the phone is unlocked, in version 9. This phone runs{' '}
            {device.androidRelease}, so it reports which app was in front and
            for how long, and nothing more. The figures above are the time any
            app, the home screen included, was in the foreground, with
            overlaps counted once. They leave out the lock screen and system
            screens, so they read lower than screen-on time would: about a
            quarter lower on a phone that records both. Unlocks are not
            recorded at all, so they are left out rather than shown as zero.
          </p>
        </Card>
      )}
      {screen && (
      <Card delay={660}>
        <CardTitle sub="Screen-on time, and how much of it any app accounts for.">
          Attributed vs unaccounted
        </CardTitle>

        <div
          style={{
            display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden',
            border: '1px solid var(--border)', background: 'var(--bg-panel)',
          }}
        >
          <div
            style={{ width: `${attributedPct}%`, background: 'var(--accent)' }}
            title={`In an app - ${formatDuration(data.rangeApps)}`}
          />
          <div
            style={{
              width: `${100 - attributedPct}%`,
              background: 'color-mix(in srgb, var(--text-dim) 55%, var(--bg-panel))',
            }}
            title={`Unaccounted - ${formatDuration(data.unaccounted)}`}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.6rem', marginTop: '0.85rem' }}>
          <span style={{ fontSize: 'var(--fs-small)' }}>
            <span style={{ color: 'var(--text-dim)' }}>In an app </span>
            <span className="mono">{formatDuration(data.rangeApps)}</span>
            <span style={{ color: 'var(--text-dim)' }}> ({formatPercent(attributedPct, 0)})</span>
          </span>
          <span style={{ fontSize: 'var(--fs-small)' }}>
            <span style={{ color: 'var(--text-dim)' }}>Unaccounted </span>
            <span className="mono">{formatDuration(data.unaccounted)}</span>
          </span>
        </div>

        {/*
          This gap is a FINDING, not a defect, and saying so matters -- it is
          the single most counter-intuitive number on the Android side, and
          without an explanation the obvious "fix" is to make the headline sum
          the apps instead, which would under-report every day.
        */}
        <AttributedNote ratio={(attributedPct / 100).toFixed(2)} />
      </Card>
      )}

    </>
  );
}
