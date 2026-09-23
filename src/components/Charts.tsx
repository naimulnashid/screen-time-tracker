'use client';

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { useRouter } from 'next/navigation';

import { formatCount, formatDayShort, formatDuration, formatHourOfDay, formatPercent } from '@/lib/format';
import { hourTick, niceCountAxis, niceHourAxis } from '@/lib/axis';
import type { TrendPoint } from '@/lib/trend';
import { dailySummary, hourlySummary, rankedSummary } from '@/lib/chart-summary';

/**
 * ⚠️ NO COLOUR HEX APPEARS IN THIS FILE.
 *
 * Every accent lives in `accent.ts` and reaches here as a CSS variable.
 * Recharts passes `fill` / `stroke` straight through to SVG attributes, where
 * `var(--accent)` and `color-mix()` are both valid, so there is never a reason
 * to inline one. The sibling project carried `#2f80ed` in this exact file,
 * which meant the trend chart stayed blue on a green page.
 */

const AXIS = 'var(--text-dim)';
const GRID = 'var(--border)';

/**
 * The one tooltip shape every chart here uses.
 *
 * `rows` exists for the Top apps chart, which moved its table columns in
 * here. A tooltip that lists figures needs the label and the number on
 * opposite edges of a fixed-width box, or the eye cannot scan down them --
 * hence the flex row rather than a "Share 34%" string.
 */
function TooltipBox({
  label, value, sub, tag, rows, icon, plate,
}: {
  label: string;
  value: string;
  sub?: string;
  tag?: string;
  rows?: { k: string; v: string }[];
  icon?: string | null;
  plate?: boolean;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.6rem 0.8rem',
        fontSize: 'var(--fs-small)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          color: 'var(--text-dim)', marginBottom: '0.2rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}
      >
        {icon && (
          <span className={`app-icon${plate ? ' app-icon--plate' : ''}`} style={{ width: 16, height: 16, flex: '0 0 16px', borderRadius: 4 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon} alt="" width={16} height={16} />
          </span>
        )}
        {label}
        {tag && (
          <span
            style={{
              marginLeft: '0.4rem', fontSize: '0.75em', textTransform: 'uppercase',
              letterSpacing: '0.04em', opacity: 0.75,
            }}
          >
            {tag}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {rows && rows.length > 0 && (
        <div
          style={{
            marginTop: '0.45rem', paddingTop: '0.45rem',
            borderTop: '1px solid var(--border)',
            display: 'grid', gap: '0.2rem', minWidth: '9.5rem',
          }}
        >
          {rows.map((r) => (
            <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', gap: '1.2rem' }}>
              <span style={{ color: 'var(--text-dim)' }}>{r.k}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
            </div>
          ))}
        </div>
      )}
      {sub && <div style={{ color: 'var(--text-dim)', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

/**
 * How a bar chart's numbers are read: axis maths, tick label, tooltip value.
 *
 * Two quantities are plotted on these shapes now -- milliseconds and a count
 * of opens -- and they differ ONLY in these three functions. Keeping one
 * implementation is what stops the count charts drifting away from the time
 * charts they are meant to be read beside; the alternative was two more
 * near-copies of the same forty lines, where a fix to one silently misses the
 * other three.
 */
interface Metric {
  axis: (peak: number) => { domain: [number, number]; ticks: number[] };
  tick: (v: number) => string;
  value: (v: number) => string;
}

const TIME: Metric = { axis: niceHourAxis, tick: hourTick, value: formatDuration };

const OPENS: Metric = {
  axis: niceCountAxis,
  tick: (n) => formatCount(n),
  value: (n) => `${formatCount(n)} open${n === 1 ? '' : 's'}`,
};

function DailyBars({
  data, dataKey, metric, what,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  metric: Metric;
  /** Names the series in the screen-reader summary. */
  what: string;
}) {
  // Recharts' own tick VALUES are not round numbers -- they only looked round
  // because the old formatter rounded them on the way out, printing 3h33 as
  // "4h". Choosing the ticks makes the labels honest AND clean, and stops this
  // axis overshooting its data the way the Top apps one did.
  const axis = metric.axis(
    data.reduce((m, d) => Math.max(m, Number(d[dataKey])), 0),
  );
  const summary = dailySummary(
    what,
    data.map((d) => ({ date: String(d['date']), value: Number(d[dataKey]) })),
    metric.value,
  );
  return (
    <>
      <p className="sr-only">{summary}</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayShort}
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            domain={axis.domain}
            ticks={axis.ticks}
            tickFormatter={metric.tick}
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent-dim)' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  label={formatDayShort(String(label))}
                  value={metric.value(Number(payload[0]!.value))}
                />
              ) : null
            }
          />
          <Bar dataKey={dataKey} fill="var(--accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/**
 * The busiest bar is lifted to the bright accent so the shape of a day is
 * readable at a glance -- screen time has a daily rhythm that network traffic
 * does not, which is why this chart exists here and not in the sibling.
 */
function HourlyBars({
  data, dataKey, metric, what,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  metric: Metric;
  /** Names the series in the screen-reader summary. */
  what: string;
}) {
  const peak = data.reduce((m, d) => Math.max(m, Number(d[dataKey])), 0);
  const axis = metric.axis(peak);
  const summary = hourlySummary(
    what,
    data.map((d) => ({ hour: Number(d['hour']), value: Number(d[dataKey]) })),
    metric.value,
  );
  return (
    <>
      <p className="sr-only">{summary}</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="hour"
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            // Every third hour, or the labels collide on a narrow card.
            ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
            tickFormatter={(h: number) => formatHourOfDay(h).replace(' ', '')}
          />
          <YAxis
            domain={axis.domain}
            ticks={axis.ticks}
            tickFormatter={metric.tick}
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent-dim)' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  label={formatHourOfDay(Number(label))}
                  value={metric.value(Number(payload[0]!.value))}
                />
              ) : null
            }
          />
          <Bar dataKey={dataKey} radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  Number(d[dataKey]) === peak && peak > 0
                    ? 'var(--accent-bright)'
                    : 'var(--accent)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/**
 * Time per day as a filled LINE, for the Overviews.
 *
 * Shaped after the sibling Data Usage Tracker's Trend chart -- accent stroke
 * over a gradient that fades to nothing, a dashed cursor, no dots until
 * hovered -- so the two dashboards' headline charts read alike. The heaviest
 * day is not marked on the line; the card carries it as a callout, which is
 * where the sibling puts it too.
 *
 * A line rather than bars because the Overview asks about DIRECTION -- am I
 * using this more than last week -- and a line answers that without the eye
 * having to join thirty bar tops itself. The app detail pages keep
 * `DailyTrendChart`'s bars, where each is read beside the same-shaped opens
 * chart under it.
 *
 * `data` must come through `fillDays()`. A null day -- nothing recorded, such
 * as a laptop asleep all day -- is DRAWN AT ZERO so the line stays one
 * continuous line; a break in it read as a rendering fault. The null is kept
 * in the data rather than replaced, so the tooltip can still say "Not
 * recorded" and the text summary can still count those days apart from a
 * genuinely quiet one.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const axis = niceHourAxis(data.reduce((m, d) => Math.max(m, d.ms ?? 0), 0));
  const summary = dailySummary(
    'Time per day',
    data.map((d) => ({ date: d.date, value: d.ms })),
    formatDuration,
  );
  const plotted = data.map((d) => ({ ...d, plot: d.ms ?? 0 }));
  return (
    <>
      <p className="sr-only">{summary}</p>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={plotted} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayShort}
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={28}
          />
          <YAxis
            domain={axis.domain}
            ticks={axis.ticks}
            tickFormatter={hourTick}
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as TrendPoint;
              return (
                <TooltipBox
                  label={formatDayShort(String(label))}
                  value={p.ms === null ? 'Not recorded' : formatDuration(p.ms)}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="plot"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#trendFill)"
            animationDuration={900}
            animationEasing="ease-out"
            dot={false}
            activeDot={{ r: 5, fill: 'var(--accent-bright)', stroke: 'var(--bg)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

/** Active time per day, as bars. The app detail pages' chart. */
export function DailyTrendChart({ data }: { data: { date: string; active: number }[] }) {
  return <DailyBars data={data} dataKey="active" metric={TIME} what="Time per day" />;
}

/** Active time by hour of day. */
export function HourlyChart({ data }: { data: { hour: number; ms: number }[] }) {
  return <HourlyBars data={data} dataKey="ms" metric={TIME} what="Time by hour of day" />;
}

/** How many times the app was opened, per day. */
export function DailyOpensChart({ data }: { data: { date: string; opens: number }[] }) {
  return <DailyBars data={data} dataKey="opens" metric={OPENS} what="Opens per day" />;
}

/** How many times the app was opened, by hour of day. */
export function HourlyOpensChart({ data }: { data: { hour: number; opens: number }[] }) {
  return <HourlyBars data={data} dataKey="opens" metric={OPENS} what="Opens by hour of day" />;
}

/* -------------------------------------------------------------------------- */

/** One ranked app. `href` is absent when the app is too small for a detail page. */
export interface TopAppDatum {
  name: string;
  ms: number;
  share: number;
  opens: number;
  system: boolean;
  href?: string;
  /** Resolved server-side by `logoUrl()`; null when no logo file matches. */
  icon?: string | null;
  /** Logo is black on transparent and needs a light plate behind it. */
  plate?: boolean;
  /**
   * The app's brand colour, resolved server-side by `brandColour()`; null when
   * none is known.
   *
   * Passed in rather than looked up here so this file keeps its promise that
   * NO COLOUR HEX APPEARS IN IT -- the brand map is data about other people's
   * logos and lives in `app-colour.ts`, exactly as the logo URL does.
   */
  colour?: string | null;
}


/**
 * Y-axis labels carry the app's real name; only the tick is clipped.
 *
 * The full name is always in the tooltip, so the clip costs nothing.
 */
function clipName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}\u2026` : name;
}

/**
 * The y-axis tick: the app's name, drawn as raw SVG text.
 *
 * ⚠️ Do NOT hand this back to Recharts' own tick rendering. Its <Text> WRAPS a
 * tick at word boundaries once it exceeds the axis width, measured against an
 * effective width well under the 132px the axis is given -- "Desktop Window
 * Mana" broke onto two lines even at a 16-character clip, leaving one label
 * two rows tall beside neighbours that were one row, which reads as a
 * rendering fault rather than as a long name. A plain <text> has no wrapping
 * logic to trip over.
 *
 * A custom tick element also makes Recharts fall back to its own collision
 * avoidance, which drops ALTERNATE labels -- four of eight apps came back
 * unnamed. Hence `interval={0}` on the axis.
 *
 * The logo deliberately does NOT appear here. It was tried, at 18px to the
 * right of the name; the app is identified well enough by its name and its
 * brand-coloured bar, and the logo column cost every bar 26px of length for
 * information already on the row. Logos still appear where they earn their
 * space: the By App tables, the app detail pages, and this chart's tooltip.
 */
function AppTick({ x, y, payload }: {
  x?: number; y?: number;
  payload?: { value?: string | number };
}) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={AXIS} fontSize={12}>
      {clipName(String(payload?.value ?? ''))}
    </text>
  );
}

/**
 * The vertical slice one app gets in a ranked chart, and the clearance either
 * side of its bar within that slice. The bar is what is left: `ROW_H - 2 *
 * ROW_PAD`, so the two move independently -- row spacing is about fitting the
 * card, bar thickness is about the bar being easy to compare against its
 * neighbours.
 */
const ROW_H = 38;
const ROW_PAD = 2;

/**
 * Top apps, as ranked horizontal bars.
 *
 * This replaced a four-column table, and the reasons are worth keeping:
 *
 *   - **Ranking is the point, and a table hides it.** Reading a column of
 *     "1h 12m / 47m / 44m" means subtracting in your head to learn that the
 *     first is not quite twice the second. A bar length says it without
 *     arithmetic, which is the entire argument for a chart over a table.
 *   - **Bars are horizontal, not vertical.** App names are long, arbitrary and
 *     proper nouns; rotated 45 degrees under a vertical bar they are unreadable
 *     and collide. Along a y-axis they read straight.
 *
 * Time, Share and Opens moved into the tooltip. That trades always-visible for
 * uncluttered, and the trade is only acceptable because **`/apps` still carries
 * the full table** -- no figure was removed from the dashboard, only from this
 * card. Anything that leaves this chart as the sole home of a number should put
 * that number back on the page.
 *
 * The bar carries the click-through the app name used to. `href` is computed
 * server-side and passed in, because the `earnsDetailPage` rule lives in
 * `queries.ts`, which is `server-only` and cannot be imported here.
 */
function RankedApps({
  data, dataKey, metric, rows, what,
}: {
  data: TopAppDatum[];
  dataKey: 'ms' | 'opens';
  metric: Metric;
  /** Names the ranking in the screen-reader summary. */
  what: string;
  /** The tooltip's secondary figures: whatever the headline is not. */
  rows: (d: TopAppDatum) => { k: string; v: string }[];
}) {
  const router = useRouter();
  const peak = data.reduce((m, d) => Math.max(m, Number(d[dataKey])), 0);

  const axis = metric.axis(peak);

  // A fixed height would crush eight rows or strand two. Each bar gets a
  // constant slice instead, so the chart is as tall as it needs to be.
  const height = Math.max(140, data.length * ROW_H + 16);
  const summary = rankedSummary(
    what,
    data.map((d) => ({ name: d.name, value: Number(d[dataKey]) })),
    metric.value,
  );

  return (
    <>
      <p className="sr-only">{summary}</p>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          // Recharts' default clearance is a PERCENTAGE of the row -- 10% either
          // side, which meant thickening a bar handed a proportional slice back
          // to the gap. A pixel figure gives the whole of any ROW_H increase to
          // the bar, and says what it means without arithmetic.
          barCategoryGap={ROW_PAD}
        >
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis
            type="number"
            domain={axis.domain}
            ticks={axis.ticks}
            tickFormatter={metric.tick}
            stroke={AXIS}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={AXIS}
            tick={<AppTick />}
            // Every row gets its name. A custom tick element makes Recharts fall
            // back to its own collision avoidance, which dropped ALTERNATE labels
            // -- the chart came back with four of its eight apps unnamed, which is
            // worse than any wrapping. Here one tick IS one app, so there is
            // nothing to thin out.
            interval={0}
            tickLine={false}
            axisLine={false}
            width={132}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent-dim)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as TopAppDatum;
              return (
                <TooltipBox
                  label={d.name}
                  icon={d.icon}
                  plate={d.plate}
                  tag={d.system ? 'system' : undefined}
                  value={metric.value(Number(d[dataKey]))}
                  rows={rows(d)}
                  sub={d.href ? 'Click for detail' : undefined}
                />
              );
            }}
          />
          <Bar
            dataKey={dataKey}
            radius={[0, 3, 3, 0]}
            onClick={(entry: unknown) => {
              // Recharts hands back either the datum or a wrapper holding it,
              // depending on version and on where inside the bar the click landed.
              const e = entry as { href?: string; payload?: { href?: string } };
              const href = e?.payload?.href ?? e?.href;
              if (href) router.push(href);
            }}
          >
            {data.map((d) => (
              <Cell
                key={d.name}
                // The app's own colour when one is known, so a bar is
                // recognisable before its name is read.
                //
                // The peak-is-brighter rule still applies to everything else. It
                // was the only way to pick the leader out when every bar was one
                // accent; where a brand colour exists it says more than the
                // highlight would, and stacking both would leave the top bar
                // wearing a colour that belongs to no app at all.
                fill={
                  d.colour
                  ?? (Number(d[dataKey]) === peak && peak > 0
                    ? 'var(--accent-bright)'
                    : 'var(--accent)')
                }
                style={{ cursor: d.href ? 'pointer' : 'default' }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/** Apps ranked by time in the foreground. `data` must arrive sorted. */
export function TopAppsChart({ data }: { data: TopAppDatum[] }) {
  return (
    <RankedApps
      data={data}
      dataKey="ms"
      metric={TIME}
      what="Top apps by time"
      rows={(d) => [
        { k: 'Share', v: formatPercent(d.share, 0) },
        { k: 'Opens', v: formatCount(d.opens) },
      ]}
    />
  );
}

/**
 * Apps ranked by how many times they were OPENED. `data` must arrive sorted.
 *
 * The counterpart to `TopAppsChart`, and the pair is the point: the app you
 * spend longest in and the app you reach for most are routinely not the same
 * one, and either ranking alone reads as "the app I use most" while meaning
 * something different. The tooltip carries whichever figure the bars do not,
 * so a bar in one chart can be placed in the other without leaving the card.
 */
export function MostOpenedChart({ data }: { data: TopAppDatum[] }) {
  return (
    <RankedApps
      data={data}
      dataKey="opens"
      metric={OPENS}
      what="Most opened apps"
      rows={(d) => [
        { k: 'Share', v: formatPercent(d.share, 0) },
        { k: 'Time', v: formatDuration(d.ms) },
      ]}
    />
  );
}
