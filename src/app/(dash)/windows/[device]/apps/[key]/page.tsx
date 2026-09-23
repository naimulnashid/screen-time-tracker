import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import {
  DailyTrendChart, HourlyChart, DailyOpensChart, HourlyOpensChart,
} from '@/components/Charts';
import { getAppDetail, appExists, earnsDetailPage, windowsLogoScope } from '@/lib/queries';
import { AppIcon } from '@/components/AppIcon';
import { logoUrl, needsLightPlate } from '@/lib/app-logo';
import { windowsSlug } from '@/lib/config';
import { parseDays } from '@/lib/scope';
import { formatDuration, formatPercent } from '@/lib/format';
import type { Metadata } from 'next';
import { windowsAppTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string; key: string }>;
}): Promise<Metadata> {
  const { device, key } = await params;
  return windowsAppTitle(device, key);
}

export const dynamic = 'force-dynamic';

/**
 * One app, over time.
 *
 * The key is URL-encoded rather than slugified. Resolved keys look like
 * `appx:claude_pzs8sxrjxfjjc` or `exe:visual studio/setup`, and inventing a
 * URL-safe slug for them would need a uniqueness pass of its own -- two apps
 * whose slugs collided would silently share a page, which is exactly the class
 * of bug the device slugs already have to guard against. Encoding is uglier in
 * the address bar and cannot collide.
 */
export default async function AppDetailPage({
  params, searchParams,
}: {
  params: Promise<{ device: string; key: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { device: slug, key: raw } = await params;
  if (slug !== windowsSlug()) notFound();

  const key = decodeURIComponent(raw);
  const backHref = `/windows/${slug}/apps`;
  const sp = await searchParams;
  const scope = { days: parseDays(sp.days) };

  const detail = getAppDetail(scope, key);
  const laptop = windowsLogoScope();

  // "Not found" and "nothing in this range" are DIFFERENT answers. An app with
  // no rows in the current scope still exists -- the range is just empty, and
  // telling the reader it does not exist sends them hunting for a page that is
  // right there.
  if (!detail) {
    if (appExists(key)) {
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

  // Re-checked here, not just on the table's link: a pasted or bookmarked URL
  // for a trivial app must not render a page of one bar.
  if (!earnsDetailPage(detail.ms)) {
    return (
      <div className="empty">
        <h1 style={{ marginBottom: '0.8rem' }}>{detail.name}</h1>
        <p style={{ maxWidth: 560, margin: '0 auto 1.4rem' }}>
          Only {formatDuration(detail.ms)} recorded. A page here would be a
          single bar, so there is nothing to show over time yet.
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
          <AppIcon name={detail.name} src={logoUrl(detail.name, laptop)} plate={needsLightPlate(detail.name, laptop)} size={32} />
          {detail.name}
        </h1>
        <p>
          {formatPercent(detail.share, 1)} of active time in this range
          {detail.system ? ' · Windows component' : ''}
        </p>
      </div>

      <div className="grid grid--4">
        <Card delay={0}>
          <div className="stat-label">Total</div>
          <div className="stat-value stat-value--accent" style={{ marginTop: '0.5rem' }}>
            {formatDuration(detail.ms)}
          </div>
          <div className="stat-sub">across {detail.days} day{detail.days === 1 ? '' : 's'}</div>
        </Card>
        <Card delay={60}>
          <div className="stat-label">Opens</div>
          <div className="stat-value" style={{ marginTop: '0.5rem' }}>{detail.sessions}</div>
          <div className="stat-sub">times brought to the foreground</div>
        </Card>
        <Card delay={120}>
          <div className="stat-label">Typical session</div>
          <div className="stat-value" style={{ marginTop: '0.5rem' }}>
            {formatDuration(detail.medianSessionMs)}
          </div>
          {/* Median, not mean: one four-hour session drags a mean somewhere no
              actual session ever was. */}
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
        <CardTitle sub={`Time in ${detail.name} per day.`}>Daily trend</CardTitle>
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

        Windows makes the distinction sharper than the phone does, because
        alt-tab is cheap: a browser can hold an hour across forty opens in a
        way an app on a phone rarely does.
      */}
      <Card delay={300}>
        <CardTitle sub={`How many times ${detail.name} was opened each day.`}>
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

      <Card delay={480}>
        <CardTitle
          sub="Everything that resolved into this entry, so a merge is never silent."
        >
          Merged from
        </CardTitle>
        {/*
          The point of this card. app-name.ts folds every versioned WindowsApps
          folder into one app, which is right -- but a reader looking at
          "Claude" deserves to see it came from a path with a version number in
          it. Without this, the day a merge is WRONG there is nothing to notice.
        */}
        <div className="table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Recorded identity</th>
                <th style={{ textAlign: 'right' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {detail.identities.map((i) => (
                <tr key={i.path}>
                  <td className="mono" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                    {i.path}
                  </td>
                  <td className="num mono">{formatDuration(i.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail.identities.length === 1 && (
          <p className="prose-note" style={{ marginTop: '0.9rem' }}>
            One identity, so nothing was merged here.
          </p>
        )}
      </Card>
    </>
  );
}
