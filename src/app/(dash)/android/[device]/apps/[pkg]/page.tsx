import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { HourlyChart, HourlyOpensChart } from '@/components/Charts';
import { AppDailyCards } from '@/components/RangedCharts';
import {
  getAndroidDeviceBySlug, getAndroidAppDetail,
  androidEarnsDetailPage, getAndroidColourOverrides,
} from '@/lib/android-queries';
import { AppIcon } from '@/components/AppIcon';
import { Callout } from '@/components/Callout';
import { peakOf } from '@/lib/stack';
import { logoUrl, needsLightPlate, lookName } from '@/lib/app-logo';
import { RenameApp } from '@/components/RenameApp';
import { UnmergeButton } from '@/components/AppMenu';
import { BackKey } from '@/components/BackKey';
import { brandColour } from '@/lib/app-colour';
import { ACCENTS } from '@/lib/accent';
import { ALL_HISTORY, rangeStarts } from '@/lib/scope';
import { decodeSegment } from '@/lib/slug';
import {
  formatDuration, formatPercent, formatHourOfDay, formatOpens,
} from '@/lib/format';
import type { Metadata } from 'next';
import { androidAppTitle } from '@/lib/page-title';

/** `<page> · <device>` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string; pkg: string }>;
}): Promise<Metadata> {
  const { device, pkg } = await params;
  return androidAppTitle(device, pkg);
}

export const dynamic = 'force-dynamic';

/**
 * One app on one phone, over time.
 *
 * No "merged from" card, unlike the Windows detail page: a package name IS the
 * identity here, and the phone hands over the label directly. Nothing is
 * merged, so there is nothing that could be merged wrongly.
 */
export default async function AndroidAppDetailPage({
  params,
}: {
  params: Promise<{ device: string; pkg: string }>;
}) {
  const { device: slug, pkg: rawPkg } = await params;
  const device = getAndroidDeviceBySlug(slug);
  if (!device) notFound();

  // layout.tsx has already 404'd a malformed or unrecorded package; this only
  // narrows the type, since the page renders alongside the layout.
  const pkg = decodeSegment(rawPkg);
  if (pkg === null) notFound();
  // All history; the two by-day charts carry their own range. No rows means
  // no such app: there is no range left to be empty.
  const detail = getAndroidAppDetail(device.deviceId, ALL_HISTORY, pkg);
  const backHref = `/android/${slug}/apps`;
  if (!detail) notFound();

  // Re-checked here, not just on the table's link: a bookmarked URL for a
  // trivial app must not render a page of one bar.
  if (!androidEarnsDetailPage(detail.ms)) {
    return (
      <div className="empty">
        <h1 style={{ marginBottom: '0.8rem' }}>{detail.label}</h1>
        <p style={{ maxWidth: 560, margin: '0 auto 1.4rem' }}>
          Only {formatDuration(detail.ms)} recorded. There is nothing to show
          over time yet.
        </p>
        <Link href={backHref} className="chip" style={{ display: 'inline-block' }}>
          Back to all apps
        </Link>
      </div>
    );
  }

  // Each hourly chart's headline figure, for the top right of its card. The
  // by-day charts put theirs in their subtitle, beside their range menu.
  const busiest = peakOf(detail.hourly, (h) => h.ms);
  const busiestOpens = peakOf(detail.hourlyOpens, (h) => h.opens);
  const look = lookName(detail.label, detail.baseLabel, slug);
  const ownColour = getAndroidColourOverrides(device.deviceId).get(detail.packageName);

  return (
    <>
      <BackKey href={backHref} />
      <div className="page-head">
        <Link href={backHref} className="back-link">&larr; All apps</Link>
        <RenameApp
          platform="android" device={slug}
          appKey={detail.packageName} name={detail.label} baseName={detail.baseLabel}
          colour={ownColour ?? brandColour(look, slug) ?? ACCENTS.android.accent}
          customColour={ownColour !== undefined}
          icon={<AppIcon name={detail.label} src={logoUrl(look, slug)} plate={needsLightPlate(look, slug)} size={32} />}
        />
        <p className="mono" style={{ fontSize: '0.8rem' }}>
          {detail.packageName}
          {detail.system ? ' · system' : ''}
        </p>
      </div>

      <div className="grid grid--4">
        <Card delay={0}>
          <div className="stat-label">Total</div>
          <div className="stat-value stat-value--accent" style={{ marginTop: '0.5rem' }}>
            {formatDuration(detail.ms)}
          </div>
          <div className="stat-sub">
            {formatPercent(detail.share, 1)} of in-app time
          </div>
        </Card>
        <Card delay={60}>
          <div className="stat-label">Opens</div>
          <div className="stat-value" style={{ marginTop: '0.5rem' }}>{detail.opens}</div>
          <div className="stat-sub">across {detail.days} day{detail.days === 1 ? '' : 's'}</div>
        </Card>
        <Card delay={120}>
          <div className="stat-label">Typical session</div>
          <div className="stat-value" style={{ marginTop: '0.5rem' }}>
            {formatDuration(detail.medianSessionMs)}
          </div>
          {/* Median, not mean. Phone usage is full of three-second glances, and
              a mean would sit somewhere no actual session ever was. */}
          <div className="stat-sub">median, not mean</div>
        </Card>
        <Card delay={180}>
          <div className="stat-label">Longest</div>
          <div className="stat-value" style={{ marginTop: '0.5rem' }}>
            {formatDuration(detail.longestSessionMs)}
          </div>
          <div className="stat-sub">single unbroken session</div>
        </Card>
      </div>

      {/*
        Time and opens per day, under one range: the pair worth reading
        TOGETHER. A tall time bar over a short opens bar is one long sitting,
        and a short time bar over a tall opens bar is compulsive checking.
      */}
      <AppDailyCards
        daily={detail.daily}
        opens={detail.dailyOpens}
        starts={rangeStarts(detail.latestDate)}
        name={detail.label}
        delay={240}
      />

      <Card delay={360}>
        <CardTitle
          sub="When this app is usually open."
          aside={
            busiest && (
              <Callout label="Busiest hour" detail={formatHourOfDay(busiest.hour)} value={formatDuration(busiest.ms)} />
            )
          }
        >
          Shape of the day
        </CardTitle>
        <HourlyChart data={detail.hourly} />
      </Card>

      <Card delay={420}>
        <CardTitle
          sub="The hour an open began, not the hours it went on for."
          aside={
            busiestOpens && (
              <Callout label="Busiest hour" detail={formatHourOfDay(busiestOpens.hour)} value={formatOpens(busiestOpens.opens)} />
            )
          }
        >
          When it gets opened
        </CardTitle>
        <HourlyOpensChart data={detail.hourlyOpens} />
      </Card>
      {detail.members.length > 0 && (
        <Card delay={540}>
          <CardTitle sub="Apps you merged into this one. Their time and opens are counted here, on every page.">
            Merged apps
          </CardTitle>
          <div className="table-wrap">
            <table className="app-table member-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th style={{ textAlign: 'right' }}>Time</th>
                  <th className="undo-col"><span className="sr-only">Separate</span></th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((m) => (
                  <tr key={m.key}>
                    <td>{m.name}</td>
                    <td className="num mono">{formatDuration(m.ms)}</td>
                    <td className="num undo-col">
                      <UnmergeButton platform="android" device={slug} appKey={m.key} name={m.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
