import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { HourlyChart, HourlyOpensChart } from '@/components/Charts';
import { AppDailyCards } from '@/components/RangedCharts';
import {
  getAppDetail, earnsDetailPage, windowsLogoScope, getWindowsColourOverrides,
} from '@/lib/queries';
import { AppIcon } from '@/components/AppIcon';
import { Callout } from '@/components/Callout';
import { peakOf } from '@/lib/stack';
import { logoUrl, needsLightPlate, lookName } from '@/lib/app-logo';
import { RenameApp } from '@/components/RenameApp';
import { UnmergeButton } from '@/components/AppMenu';
import { BackKey } from '@/components/BackKey';
import { brandColour } from '@/lib/app-colour';
import { ACCENTS } from '@/lib/accent';
import { windowsSlug } from '@/lib/config';
import { decodeSegment } from '@/lib/slug';
import { ALL_HISTORY, rangeStarts } from '@/lib/scope';
import {
  formatDuration, formatPercent, formatHourOfDay, formatOpens,
} from '@/lib/format';
import type { Metadata } from 'next';
import { windowsAppTitle } from '@/lib/page-title';

/** `<page> · <device>` -- see lib/page-title.ts. */
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
  params,
}: {
  params: Promise<{ device: string; key: string }>;
}) {
  const { device: slug, key: raw } = await params;
  if (slug !== windowsSlug()) notFound();

  // layout.tsx has already 404'd a malformed or unrecorded key; this only
  // narrows the type, since the page renders alongside the layout.
  const key = decodeSegment(raw);
  if (key === null) notFound();
  const backHref = `/windows/${slug}/apps`;
  // All history: the page is not scoped; its two by-day charts carry a range.
  // With no range there is no "nothing in this range" answer any more: no
  // rows means no such app.
  const detail = getAppDetail(ALL_HISTORY, key);
  const laptop = windowsLogoScope();
  if (!detail) notFound();

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

  // Each hourly chart's headline figure, for the top right of its card. The
  // by-day charts put theirs in their subtitle, beside their range menu.
  const busiest = peakOf(detail.hourly, (h) => h.ms);
  const busiestOpens = peakOf(detail.hourlyOpens, (h) => h.opens);
  const look = lookName(detail.name, detail.baseName, laptop);
  const ownColour = getWindowsColourOverrides().get(detail.key);

  return (
    <>
      <BackKey href={backHref} />
      <div className="page-head">
        <Link href={backHref} className="back-link">&larr; All apps</Link>
        <RenameApp
          platform="windows" device={slug}
          appKey={detail.key} name={detail.name} baseName={detail.baseName}
          colour={ownColour ?? brandColour(look, laptop) ?? ACCENTS.zephyrus.accent}
          customColour={ownColour !== undefined}
          icon={<AppIcon name={detail.name} src={logoUrl(look, laptop)} plate={needsLightPlate(look, laptop)} size={32} />}
        />
        <p>
          {formatPercent(detail.share, 1)} of all active time
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

      {/*
        Time and opens per day, under one range. They are the pair worth
        reading TOGETHER: a tall time bar over a short opens bar is one long
        sitting, and a short time bar over a tall opens bar is compulsive
        checking. Windows makes the distinction sharper than the phone does,
        because alt-tab is cheap: a browser can hold an hour across forty opens.
      */}
      <AppDailyCards
        daily={detail.daily}
        opens={detail.dailyOpens}
        starts={rangeStarts(detail.latestDate)}
        name={detail.name}
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
                      <UnmergeButton platform="windows" device={slug} appKey={m.key} name={m.name} />
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
