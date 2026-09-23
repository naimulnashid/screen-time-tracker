import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { CountUp } from '@/components/CountUp';
import { TrendChart, HourlyChart } from '@/components/Charts';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import {
  getAndroidDeviceBySlug, getAndroidOverview, getAndroidDaily, getAndroidHourly,
} from '@/lib/android-queries';
import { collectedAgo } from '@/lib/queries';
import { ALL_DAYS, parseDays, queryString } from '@/lib/scope';
import { fillDays, heaviestDay } from '@/lib/trend';
import {
  splitDuration, formatDuration, formatDayLong, formatDayShort, formatPercent,
} from '@/lib/format';
import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
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
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { device: slug } = await params;
  const device = getAndroidDeviceBySlug(slug);
  if (!device) notFound();

  const sp = await searchParams;
  const scope = { days: parseDays(sp.days) };

  const data = getAndroidOverview(device.deviceId, scope);
  const daily = getAndroidDaily(device.deviceId, scope);
  const hourly = getAndroidHourly(device.deviceId, scope);
  // Ignores the range selector, like the laptop's: see the note there.
  const history = getAndroidDaily(device.deviceId, { days: ALL_DAYS })
    .map((d) => ({ date: d.date, ms: d.screenOn }));

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

  const attributedPct = data.rangeScreenOn > 0
    ? (data.rangeApps / data.rangeScreenOn) * 100
    : 0;

  return (
    <>
      <div className="page-head">
        <h1>{device.label}</h1>
        {/* Same two facts as the laptop's Overview, in the same order and the
            same words, because they mean the same thing. The Android release
            moved to Sync Status: it is a property of the device, not of how
            current these numbers are. */}
        <p>
          Latest data {formatDayLong(data.latestDate)}
          {collected ? ` · collected ${collected}` : ''}
        </p>
      </div>

      {/*
        Two rows of three: screen time on top, unlocks beneath, each as the
        latest day, the per-day average and the range total -- so the columns
        read down as well as across. The totals live here because By App no
        longer carries score cards; the laptop's Overview has its Range total
        in the same place.

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
          sub={isToday ? 'screen on, so far' : 'screen on'}
          delay={0}
        />
        <StatCard
          label="Daily average"
          ms={data.dailyAverage}
          sub={`over ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} of data`}
          delay={60}
        />
        <StatCard
          label="Total screen time"
          ms={data.rangeScreenOn}
          sub={`${data.appCount} app${data.appCount === 1 ? '' : 's'}`}
          delay={120}
        />
      </div>

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
          sub="pick-ups in this range"
          delay={300}
        />
      </div>

      {/* One chart per row. See the note on the Windows overview: side by side
          these are too narrow for 24 hourly bars or a month of days. Top apps
          and Most opened moved to By App, as they did on the laptop. */}
      <Card delay={360}>
        <CardTitle
          sub={`Screen-on per day across ${data.daysWithData} day${data.daysWithData === 1 ? '' : 's'} of data.`}
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
          <p className="prose-note">One day of data so far.</p>
        )}
      </Card>

      <Card delay={420}>
        <CardTitle sub="Screen-on per day, whatever the range above. Outlined days were never recorded - before the phone first synced, or evicted before it did - which is not the same as a quiet day.">
          Activity
        </CardTitle>
        <ActivityHeatmap
          daily={history}
          label="Daily screen-on time"
          expandHref={`/android/${slug}/activity${queryString(sp)}`}
        />
      </Card>

      <Card delay={480}>
        <CardTitle sub="When the screen is actually on.">Shape of the day</CardTitle>
        <HourlyChart data={hourly} />
      </Card>

      {/* Last, the laptop's "Where the time went" counterpart: how far the
          per-app figures can be trusted to add up, rather than how the day
          was spent. */}
      <Card delay={540}>
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
        <p className="prose-note" style={{ marginTop: '1rem' }}>
          Per-app time never adds up to screen-on time, and that is expected:
          the lock screen, the launcher between apps and system surfaces all
          hold time no app claims. Measured here at{' '}
          <strong>{(attributedPct / 100).toFixed(2)}&times;</strong>. The
          headline above therefore comes from screen-on events, never from
          summing the apps below.
        </p>
      </Card>

    </>
  );
}
