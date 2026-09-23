import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { TopAppsChart, MostOpenedChart } from '@/components/Charts';
import { AppListTable } from '@/components/AppListTable';
import {
  getAndroidDeviceBySlug, getAndroidApps, getAndroidOverview,
  androidEarnsDetailPage,
} from '@/lib/android-queries';
import { AppIcon } from '@/components/AppIcon';
import { brandColour } from '@/lib/app-colour';
import { logoUrl, needsLightPlate } from '@/lib/app-logo';
import { splitForList, listRule } from '@/lib/app-list';
import { isHomeSurface } from '@/lib/home-surface';
import { parseDays } from '@/lib/scope';
import { formatCount, formatDuration, formatPercent } from '@/lib/format';
import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return androidTitle((await params).device, 'By App');
}

export const dynamic = 'force-dynamic';

export default async function AndroidAppsPage({
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
  const apps = getAndroidApps(device.deviceId, scope).filter((a) => a.ms > 0);
  const overview = getAndroidOverview(device.deviceId, scope);

  // Resolved here rather than in the chart: `androidEarnsDetailPage` comes from
  // `android-queries.ts`, which is server-only and unimportable from a client
  // component. The chart just receives an href, or does not.
  const datum = (a: (typeof apps)[number]) => ({
    name: a.label,
    ms: a.ms,
    share: a.share,
    opens: a.opens,
    system: a.system,
    href: androidEarnsDetailPage(a.ms)
      ? `/android/${slug}/apps/${encodeURIComponent(a.packageName)}`
      : undefined,
    icon: logoUrl(a.label, slug),
    plate: needsLightPlate(a.label, slug),
    colour: brandColour(a.label, slug),
  });

  // `apps` arrives sorted by time, so the second ranking needs its own sort:
  // the top eight by time are not the top eight by opens, which is the entire
  // reason for the second chart. Copied before sorting -- `apps` is read again.
  const top = apps.slice(0, 8).map(datum);

  // The home screen is dropped from the OPENS ranking only -- it is passed
  // through between apps rather than opened, and at 2,908 against 999 for the
  // next entry it flattened every bar that answered the question the chart
  // asks. It keeps its place in the time ranking, where nine hours on the home
  // screen is a real fact rather than an artefact of how you get anywhere.
  //
  // Named below the chart, never dropped silently: if the rule ever matches
  // the wrong package, the card says which one.
  const home = apps.filter((a) => isHomeSurface(a.packageName));
  const mostOpened = [...apps]
    .filter((a) => a.opens > 0 && !isHomeSurface(a.packageName))
    .sort((a, b) => b.opens - a.opens || b.ms - a.ms)
    .slice(0, 8)
    .map(datum);

  // The charts rank every app; only the TABLE folds its tail away.
  const { shown, rest } = splitForList(apps);
  const restMs = rest.reduce((n, a) => n + a.ms, 0);

  const row = (a: (typeof apps)[number]) => (
    <tr key={a.packageName}>
      <td>
        <span className="app-cell">
          <AppIcon name={a.label} src={logoUrl(a.label, slug)} plate={needsLightPlate(a.label, slug)} />
          {androidEarnsDetailPage(a.ms) ? (
            <Link
              href={`/android/${slug}/apps/${encodeURIComponent(a.packageName)}`}
              className="app-link"
            >
              {a.label}
            </Link>
          ) : (
            <span className="app-name">{a.label}</span>
          )}
          {a.system && <span className="app-kind">system</span>}
        </span>
        {/* The package name is the only stable identifier, and
            two apps can share a label. Kept visible, quietly. */}
        <div
          className="mono"
          style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}
        >
          {a.packageName}
        </div>
      </td>
      <td className="num mono">{formatDuration(a.ms)}</td>
      <td className="num mono">{formatPercent(a.share, 1)}</td>
      <td className="num mono">{a.opens}</td>
      <td className="num mono">{a.days}</td>
    </tr>
  );

  return (
    <>
      <div className="page-head">
        <h1>By App</h1>
        {/* No device label. The sidebar says which phone you are on and the
            accent says it again in colour; a third copy on every subtitle is
            chrome repeating itself. Same wording as the laptop's By App. */}
        <p>
          {apps.length} app{apps.length === 1 ? '' : 's'} across{' '}
          {overview.daysWithData} day{overview.daysWithData === 1 ? '' : 's'}
        </p>
      </div>

      {/* The rankings lead, as on the laptop's By App. No score cards: the
          totals, screen-on and unlocks, are on the Overview. */}
      <Card delay={0}>
        <CardTitle sub="Named by the phone itself. Hover a bar for time, share and opens.">
          Top apps
        </CardTitle>
        {top.length === 0 ? (
          <p className="prose-note">No app activity recorded in this range.</p>
        ) : (
          <TopAppsChart data={top} />
        )}
      </Card>

      {/*
        Ranked by a different question, and on a phone the gap between the two
        is wider than on the laptop: opens here are VISITS, so this measures
        how often you picked the app up rather than how many Activities it
        started. See visits.ts.
      */}
      <Card delay={60}>
        <CardTitle sub="Ranked by how often you opened it. Hover a bar for share and time.">
          Most opened
        </CardTitle>
        {mostOpened.length === 0 ? (
          <p className="prose-note">No app activity recorded in this range.</p>
        ) : (
          <MostOpenedChart data={mostOpened} />
        )}
        {home.length > 0 && (
          <p className="prose-note" style={{ marginTop: '0.9rem' }}>
            {home.map((a) => a.label).join(', ')}{' '}
            {home.length === 1 ? 'is' : 'are'} left out. The home screen is what
            you pass through between apps, not something you open, and at{' '}
            {formatCount(home.reduce((n, a) => n + a.opens, 0))} it stood
            nearly three times taller than the biggest bar left, flattening
            every one of them. It keeps its place in Top apps above, where the
            time is real.
          </p>
        )}
      </Card>

      <Card delay={120}>
        <CardTitle
          sub={
            `${rest.length > 0 ? `${listRule()} ` : ''}` +
            'These rows do NOT sum to screen-on time, unlike the Windows side. ' +
            'A phone session leaves gaps no app claims; the laptop sampler ' +
            'partitions its time exclusively.'
          }
        >
          {rest.length > 0 ? `Apps · ${shown.length} of ${apps.length}` : 'All apps'}
        </CardTitle>
        {apps.length === 0 ? (
          <p className="prose-note">No app sessions recorded in this range.</p>
        ) : (
          <AppListTable
            head={
              <thead>
                <tr>
                  <th>App</th>
                  <th style={{ textAlign: 'right' }}>Time</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                  <th style={{ textAlign: 'right' }}>Opens</th>
                  <th style={{ textAlign: 'right' }}>Days</th>
                </tr>
              </thead>
            }
            shown={shown.map(row)}
            rest={rest.map(row)}
            restSummary={rest.length > 0 ? `${rest.length} more, ${formatDuration(restMs)} between them` : ''}
            total={apps.length}
          />
        )}
      </Card>
    </>
  );
}
