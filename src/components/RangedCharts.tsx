'use client';

import { useState } from 'react';
import { DEFAULT_CHART_DAYS, type ChartRange } from '@/lib/scope';
import type { StackPoint } from '@/lib/stack';
import { formatCount, formatDayShort, formatDuration, formatOpens } from '@/lib/format';
import { Card, CardTitle } from './Card';
import { StackedDailyChart, DailyTrendChart, DailyOpensChart, type StackSeriesDatum } from './Charts';
import { RangeMenu } from './RangeMenu';
import { HomeOpensNote } from './Notes';

export type RangedStack = {
  points: StackPoint[];
  series: StackSeriesDatum[];
  /** Opens left out of this range's stack: a phone's home screen (lib/home-surface.ts). */
  excluded?: number;
};

/**
 * The Overview's "Top apps by day" or "Most opened by day", with its own
 * range menu. Every range arrives ready-made and ranks ITS OWN top eight --
 * slicing the all-time stack would show last week through the year's top
 * apps -- so the menu only picks one.
 *
 * The range's leading app sits in the subtitle, which leaves the head's right
 * slot to the menu.
 */
export function RangedStackCard({
  ranges, measure, title, sub, delay, excludedNames,
}: {
  ranges: Record<ChartRange, RangedStack>;
  measure: 'time' | 'opens';
  title: string;
  sub: string;
  delay: number;
  /** Who `excluded` counts, for the note under the chart, and how many there are. */
  excludedNames?: { names: string; count: number };
}) {
  const [days, setDays] = useState<ChartRange>(DEFAULT_CHART_DAYS);
  const { points, series, excluded = 0 } = ranges[days];
  const top = series.find((s) => s.key !== 'other');
  const lead = top
    ? measure === 'time'
      ? ` Top app ${top.name}, ${formatDuration(top.total)}.`
      : ` Most opened ${top.name}, ${formatOpens(top.total)}.`
    : '';
  return (
    <Card delay={delay}>
      <CardTitle sub={sub + lead} aside={<RangeMenu value={days} onChange={setDays} label={`${title} range`} />}>
        {title}
      </CardTitle>
      {points.length > 1 ? (
        <StackedDailyChart points={points} series={series} measure={measure} />
      ) : (
        <p className="prose-note">{points.length === 1 ? 'One day of data in this range.' : 'Nothing recorded in this range.'}</p>
      )}
      {excludedNames && excluded > 0 && (
        <HomeOpensNote
          names={excludedNames.names}
          verb={excludedNames.count === 1 ? 'is' : 'are'}
          opens={formatCount(excluded)}
        />
      )}
    </Card>
  );
}

/**
 * An app's two day-by-day cards, time and opens, under ONE range: they are
 * read together (a tall time bar over a short opens bar is one long sitting),
 * so changing either menu moves both. Each range's heaviest day sits in its
 * subtitle.
 */
export function AppDailyCards({
  daily, opens, starts, name, delay,
}: {
  daily: { date: string; active: number }[];
  opens: { date: string; opens: number }[];
  /** The first local date of each range, anchored on the device's newest day. */
  starts: Record<ChartRange, string>;
  name: string;
  delay: number;
}) {
  const [days, setDays] = useState<ChartRange>(DEFAULT_CHART_DAYS);
  const from = starts[days];
  const shownDaily = daily.filter((d) => d.date >= from);
  const shownOpens = opens.filter((d) => d.date >= from);
  const heaviest = shownDaily.reduce<(typeof daily)[number] | null>((b, d) => (d.active > (b?.active ?? 0) ? d : b), null);
  const most = shownOpens.reduce<(typeof opens)[number] | null>((b, d) => (d.opens > (b?.opens ?? 0) ? d : b), null);
  const menu = (label: string) => <RangeMenu value={days} onChange={setDays} label={label} />;
  const none = (n: number) => (
    <p className="prose-note">{n === 1 ? 'One day of data for this app in this range.' : 'Nothing recorded in this range.'}</p>
  );
  return (
    <>
      <Card delay={delay}>
        <CardTitle
          sub={`Time in ${name} per day.${heaviest ? ` Heaviest day ${formatDayShort(heaviest.date)}, ${formatDuration(heaviest.active)}.` : ''}`}
          aside={menu('Daily trend range')}
        >
          Daily trend
        </CardTitle>
        {shownDaily.length > 1 ? <DailyTrendChart data={shownDaily} /> : none(shownDaily.length)}
      </Card>

      {/*
        The same shape, counted in opens. Kept a separate card rather than a
        second series on one axis: hours and counts on two scales invite
        comparing bar heights that mean different things.
      */}
      <Card delay={delay + 60}>
        <CardTitle
          sub={`How many times ${name} was opened each day.${most ? ` Most ${formatDayShort(most.date)}, ${formatOpens(most.opens)}.` : ''}`}
          aside={menu('Opens per day range')}
        >
          Opens per day
        </CardTitle>
        {shownOpens.length > 1 ? <DailyOpensChart data={shownOpens} /> : none(shownOpens.length)}
      </Card>
    </>
  );
}
