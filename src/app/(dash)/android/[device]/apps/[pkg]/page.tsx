import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import {
  DailyTrendChart, HourlyChart, DailyOpensChart, HourlyOpensChart,
} from '@/components/Charts';
import {
  getAndroidDeviceBySlug, getAndroidAppDetail, androidAppExists,
  androidEarnsDetailPage,
} from '@/lib/android-queries';
import { AppIcon } from '@/components/AppIcon';
import { logoUrl, needsLightPlate } from '@/lib/app-logo';
import { parseDays } from '@/lib/scope';
import { formatDuration, formatPercent } from '@/lib/format';
import type { Metadata } from 'next';
import { androidAppTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
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
  params, searchParams,
}: {
  params: Promise<{ device: string; pkg: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { device: slug, pkg: rawPkg } = await params;
  const device = getAndroidDeviceBySlug(slug);
  if (!device) notFound();

  const pkg = decodeURIComponent(rawPkg);
  const sp = await searchParams;
  const scope = { days: parseDays(sp.days) };

  const detail = getAndroidAppDetail(device.deviceId, scope, pkg);
  const backHref = `/android/${slug}/apps`;

  // "Not found" and "nothing in this range" are different answers. An app with
  // no rows in the current scope still exists.
  if (!detail) {
    if (androidAppExists(device.deviceId, pkg)) {
      return (
        <div className="empty">
          <h1 style={{ marginBottom: '0.8rem' }}>Nothing in this range</h1>
          <p style={{ maxWidth: 520, margin: '0 auto 1.4rem' }}>
            This app has recorded time, but none inside the selected range.
          </p>
          <Link href={backHref} className="chip" style={{ display: 'inline-block' }}>
            Back to all apps
          </Link>
        </div>
      );
    }
    notFound();
  }

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

  return (
    <>
      <div className="page-head">
        <Link href={backHref} className="back-link">&larr; All apps</Link>
        <h1 className="app-cell" style={{ gap: '0.7rem' }}>
          <AppIcon name={detail.label} src={logoUrl(detail.label, slug)} plate={needsLightPlate(detail.label, slug)} size={32} />
          {detail.label}
        </h1>
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

      <Card delay={240}>
        <CardTitle sub={`Time in ${detail.label} per day.`}>Daily trend</CardTitle>
        {detail.daily.length > 1 ? (
          <DailyTrendChart data={detail.daily} />
        ) : (
          <p className="prose-note">Only one day of data for this app so far.</p>
        )}
      </Card>

      {/*
        The same two shapes, counted in opens rather than milliseconds. They
        are the pair worth reading TOGETHER: a tall time bar over a short opens
        bar is one long sitting, and a short time bar over a tall opens bar is
        compulsive checking. Either one alone cannot tell those apart, which is
        why these are separate cards rather than a second series squeezed onto
        the same axis -- one chart with hours and counts on two scales invites
        comparing bar heights that mean different things.
      */}
      <Card delay={300}>
        <CardTitle sub={`How many times ${detail.label} was opened each day.`}>
          Opens per day
        </CardTitle>
        {detail.dailyOpens.length > 1 ? (
          <DailyOpensChart data={detail.dailyOpens} />
        ) : (
          <p className="prose-note">Only one day of data for this app so far.</p>
        )}
      </Card>

      <Card delay={360}>
        <CardTitle sub="When this app is usually open.">Shape of the day</CardTitle>
        <HourlyChart data={detail.hourly} />
      </Card>

      <Card delay={420}>
        <CardTitle sub="The hour an open began, not the hours it went on for.">
          When it gets opened
        </CardTitle>
        <HourlyOpensChart data={detail.hourlyOpens} />
      </Card>
    </>
  );
}
