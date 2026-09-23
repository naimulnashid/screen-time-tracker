import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { SamplerEmpty } from '@/components/EmptyState';
import { TopAppsChart, MostOpenedChart } from '@/components/Charts';
import { AppListTable } from '@/components/AppListTable';
import { getApps, getOverview, hasWindowsData, earnsDetailPage, windowsLogoScope } from '@/lib/queries';
import { AppIcon } from '@/components/AppIcon';
import { brandColour } from '@/lib/app-colour';
import { logoUrl, needsLightPlate } from '@/lib/app-logo';
import { splitForList, listRule } from '@/lib/app-list';
import { windowsSlug } from '@/lib/config';
import { parseDays } from '@/lib/scope';
import { formatDuration, formatPercent } from '@/lib/format';
import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return windowsTitle((await params).device, 'By App');
}

export const dynamic = 'force-dynamic';

/**
 * Every app the sampler has seen in the current range: the ones that clear
 * `isListed()` up front, the rest behind "Show all apps".
 *
 * System components are listed rather than hidden, but marked. Hiding them
 * would make the numbers stop adding up against the Overview total, and
 * `explorer.exe` genuinely IS foreground time -- you were looking at a folder.
 */
export default async function AppsPage({
  params, searchParams,
}: {
  params: Promise<{ device: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { device: slug } = await params;
  if (slug !== windowsSlug()) notFound();

  if (!hasWindowsData()) return <SamplerEmpty />;

  const sp = await searchParams;
  const scope = { days: parseDays(sp.days) };
  const apps = getApps(scope).filter((a) => a.ms > 0);
  const overview = getOverview(scope);
  const laptop = windowsLogoScope();

  // The bar charts carry the click-through the app name does in the table, so
  // the detail-page rule is resolved HERE: `earnsDetailPage` lives in
  // `queries.ts`, which is server-only and unimportable from a client chart.
  const datum = (a: (typeof apps)[number]) => ({
    name: a.name,
    ms: a.ms,
    share: a.share,
    opens: a.sessions,
    system: a.system,
    href: earnsDetailPage(a.ms) ? `/windows/${slug}/apps/${encodeURIComponent(a.key)}` : undefined,
    icon: logoUrl(a.name, laptop),
    plate: needsLightPlate(a.name, laptop),
    colour: brandColour(a.name, laptop),
  });

  // `apps` arrives sorted by time, so the second ranking has to be built from
  // its own sort rather than sliced off the same list -- the top eight by time
  // are not the top eight by opens, which is the entire reason for the second
  // chart. Copied before sorting: `apps` is read again below.
  const top = apps.slice(0, 8).map(datum);
  const mostOpened = [...apps]
    .filter((a) => a.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || b.ms - a.ms)
    .slice(0, 8)
    .map(datum);

  // The charts rank every app; only the TABLE folds its tail away.
  const { shown, rest } = splitForList(apps.map((a) => ({ ...a, opens: a.sessions })));
  const restMs = rest.reduce((n, a) => n + a.ms, 0);

  const row = (a: (typeof apps)[number]) => (
    <tr key={a.key}>
      <td>
        <span className="app-cell">
          <AppIcon name={a.name} src={logoUrl(a.name, laptop)} plate={needsLightPlate(a.name, laptop)} />
          {earnsDetailPage(a.ms) ? (
            <Link href={`/windows/${slug}/apps/${encodeURIComponent(a.key)}`} className="app-link">
              {a.name}
            </Link>
          ) : (
            <span className="app-name">{a.name}</span>
          )}
          {a.system && <span className="app-kind">system</span>}
        </span>
      </td>
      <td className="num mono">{formatDuration(a.ms)}</td>
      <td className="num mono">{formatPercent(a.share, 1)}</td>
      <td className="num mono">{a.sessions}</td>
      <td className="num mono">{a.days}</td>
    </tr>
  );

  return (
    <>
      <div className="page-head">
        <h1>By App</h1>
        {/* Count and span, nothing else. The date the recording runs to is on
            the Overview, where it sits beside the freshness line that gives it
            meaning; repeated here it was a second date with no context. */}
        <p>
          {apps.length} app{apps.length === 1 ? '' : 's'} across{' '}
          {overview.daysWithData} day{overview.daysWithData === 1 ? '' : 's'}
        </p>
      </div>

      {/* The rankings lead. They moved here from the Overview: they rank
          apps, and this is the page the apps are on. No score cards follow --
          the totals are on the Overview, and a split into system and non-
          system time was dropped (2026-09-23) as not worth a row of its own. */}
      <Card delay={0}>
        <CardTitle sub="Grouped by resolved app, not by executable path. Hover a bar for time, share and opens.">
          Top apps
        </CardTitle>
        {top.length === 0 ? (
          <p className="prose-note">No foreground activity recorded in this range.</p>
        ) : (
          <TopAppsChart data={top} />
        )}
      </Card>

      {/*
        The same eight-bar shape, ranked by a different question. The app you
        spend longest in and the app you reach for most are routinely not the
        same one, and either ranking alone reads as "what I use most" while
        meaning something narrower.
      */}
      <Card delay={60}>
        <CardTitle sub="Ranked by how often you switched to it. Hover a bar for share and time.">
          Most opened
        </CardTitle>
        {mostOpened.length === 0 ? (
          <p className="prose-note">No foreground activity recorded in this range.</p>
        ) : (
          <MostOpenedChart data={mostOpened} />
        )}
      </Card>

      <Card delay={120}>
        <CardTitle
          sub={
            `${rest.length > 0 ? `${listRule()} ` : ''}` +
            'On Windows every row together DOES sum to the active total: the ' +
            'sampler records exactly one foreground app at a time, so the rows ' +
            'partition the time rather than overlapping it.'
          }
        >
          {rest.length > 0 ? `Apps · ${shown.length} of ${apps.length}` : 'All apps'}
        </CardTitle>
        {apps.length === 0 ? (
          <p className="prose-note">No foreground activity recorded in this range.</p>
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
