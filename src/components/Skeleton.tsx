/**
 * Loading skeletons.
 *
 * These are not decorative grey boxes. Their job is that **nothing moves when
 * the data lands** -- so they reproduce each page section by section, in order.
 *
 * Since 2026-10-01 they do it by rendering the page's OWN markup: real
 * classes, real grids, and the real headings and fixed sentences as invisible
 * shimmering text (`SkText`). They therefore wrap exactly where the page
 * wraps, at every width. The previous generation carried one measured height
 * per section, the mid-range of two reference widths, and so was wrong by up
 * to half that range at both ends -- 47px on the Overview's heat map alone.
 * Ported from the sibling Data Usage Tracker, which made the same move a day
 * earlier.
 *
 * What is still a stand-in is only what depends on the data: figures, a
 * legend's app names, a table's length. Each is sized to what the page
 * usually shows, and the stand-in text is generic -- the repo is public, so
 * nothing here may be a real app inventory or a real figure.
 *
 * Re-measure after a panel changes shape: render each `loading.tsx` on its
 * own inside the shell (a temporary route that imports it) beside the real
 * page, at 997px and 1680px, and compare `.container > *` heights. In place a
 * skeleton cannot be caught: a client-side navigation is too quick for it to
 * paint.
 *
 * These are Next `loading.tsx` boundaries: they show while the server
 * component renders and during route transitions. A loading boundary is given
 * no params and no data, which is why the stand-ins exist at all.
 */

import type { ReactNode, CSSProperties } from 'react';

/** One shimmering block. */
export function Skeleton({
  height, width = '100%', radius, style,
}: {
  height: number | string;
  width?: number | string;
  radius?: string | number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      style={{ height, width, ...(radius !== undefined ? { borderRadius: radius } : {}), ...style }}
    />
  );
}

/** Text laid out exactly as the real text, painted as a shimmer bar per line. */
export function SkText({ children }: { children: ReactNode }) {
  return <span className="skeleton sk-text">{children}</span>;
}

/** Real markup, shown as one shimmering block: for paragraphs and lists. */
export function SkMask({ children }: { children: ReactNode }) {
  return <div className="sk-mask" aria-hidden>{children}</div>;
}

/** A square shimmer the size of an `AppIcon`. */
function SkIcon({ size }: { size: number }) {
  return (
    <span
      className="skeleton"
      style={{ display: 'inline-block', width: size, height: size, flex: `0 0 ${size}px`, borderRadius: Math.max(4, Math.round(size * 0.22)) }}
    />
  );
}

/** `.page-head`, laid out from its real text. */
export function SkPageHead({
  title, sub, back, appIcon = false, subMono = false,
}: {
  title: string;
  sub: string;
  /** The "back" link above a title. */
  back?: string;
  /** A detail page's title row: logo, name, rename pencil. */
  appIcon?: boolean;
  /** The phone's detail page puts the package, in mono, under its title. */
  subMono?: boolean;
}) {
  return (
    <div className="page-head">
      <span className="sr-only" role="status">Loading</span>
      {back && <span className="back-link"><SkText>&larr; {back}</SkText></span>}
      {appIcon ? (
        <h1 className="app-title">
          <SkIcon size={32} />
          <SkText>{title}</SkText>
          {/* The rename pencil's box, so the title keeps its height. */}
          <span style={{ width: 32, height: 32, flexShrink: 0 }} />
        </h1>
      ) : (
        <h1 style={back ? { marginTop: '0.6rem' } : undefined}><SkText>{title}</SkText></h1>
      )}
      <p className={subMono ? 'mono' : undefined} style={subMono ? { fontSize: '0.8rem' } : undefined}>
        <SkText>{sub}</SkText>
      </p>
    </div>
  );
}

/** `Card` + `CardTitle`, with the real title and sub. */
export function SkCard({
  title, sub, aside, children,
}: {
  title: string;
  sub?: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-title">
        <div style={{ minWidth: 0 }}>
          <h2><SkText>{title}</SkText></h2>
          {sub && <p style={{ margin: '0.3rem 0 0', fontSize: 'var(--fs-small)' }}><SkText>{sub}</SkText></p>}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** The figure in a card title's right slot: "Heaviest day", "Top app". */
export function SkCallout({ label, detail, value }: { label: string; detail: string; value: string }) {
  return (
    <div className="callout">
      <div className="callout-head">
        <span className="callout-label"><SkText>{label}</SkText></span>
        <span className="callout-date"><SkText>{detail}</SkText></span>
      </div>
      <div className="callout-value"><SkText>{value}</SkText></div>
    </div>
  );
}

/** A two-rung duration as a stat value renders it: `6h 42m`, units small. */
export function SkDuration({ value, unit, sub, subUnit }: {
  value: string; unit: string; sub?: string; subUnit?: string;
}) {
  return (
    <>
      {value}<span className="stat-unit">{unit}</span>
      {sub && <>{' '}{sub}<span className="stat-unit">{subUnit}</span></>}
    </>
  );
}

/** A score-card grid: the real `.grid--N`, so it wraps where the page does. */
export function SkStats({ columns, children }: { columns: 3 | 4; children: ReactNode }) {
  return <div className={`grid grid--${columns}`}>{children}</div>;
}

/** One score card, at the real `--fs-stat` (a vw clamp no fixed height can match). */
export function SkStat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="stat-label"><SkText>{label}</SkText></div>
      <div className="stat-value" style={{ marginTop: '0.5rem' }}><SkText>{value}</SkText></div>
      {sub && <div className="stat-sub"><SkText>{sub}</SkText></div>}
    </div>
  );
}

/** A chart's plot. Its ResponsiveContainer height is fixed in Charts.tsx. */
export function SkPlot({ height }: { height: number }) {
  return <Skeleton height={height} />;
}

/**
 * A ranked bar chart (Top apps, Most opened): `rows` bars at Charts.tsx's
 * `ROW_H` of 38px, plus 16, floored at 140 -- the chart's own rule.
 */
export function SkRanked({ rows = 8 }: { rows?: number }) {
  return <SkPlot height={Math.max(140, rows * 38 + 16)} />;
}

/** A stacked by-app chart: the 300px plot and its legend. Names are stand-ins. */
export function SkStacked({ items }: { items: string[] }) {
  return (
    <>
      <SkPlot height={300} />
      <div className="legend">
        {items.map((t) => (
          <span className="legend-item" key={t}>
            <SkIcon size={15} />
            <SkText>{t}</SkText>
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * Stand-ins for a stacked legend: nine entries, as the page has. The legend
 * wraps by the LENGTH of the names, and a phone's apps have shorter names than
 * a laptop's -- a laptop-length list wrapped to a third row on the phone at
 * 997px. The phone's list is the public demo's (scripts/seed-demo.ts).
 */
export const STACK_LEGEND = [
  'Browser', 'Code Editor', 'Terminal', 'File Explorer', 'Messenger', 'Music', 'Notes', 'Spreadsheet', 'Other',
];
export const PHONE_STACK_LEGEND = [
  'YouTube', 'WhatsApp', 'Chrome', 'Spotify', 'Telegram', 'Gmail', 'Maps', 'Duolingo', 'Other',
];

const HM_WEEKS = 26;

/** One heat-map plot: the real grid, so its square cells size exactly. */
function SkHeatmapPlot() {
  return (
    <div className="heatmap-scroll">
      <div
        className="heatmap-plot"
        style={{ gridTemplateColumns: `var(--hm-daycol) repeat(${HM_WEEKS}, minmax(var(--hm-min), 1fr))` }}
      >
        <span className="heatmap-month" style={{ gridColumn: 2, gridRow: 1 }}><SkText>Apr</SkText></span>
        {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
          <span key={d} className="heatmap-day" style={{ gridColumn: 1, gridRow: i + 2 }}><SkText>{d}</SkText></span>
        ))}
        {Array.from({ length: HM_WEEKS * 7 }, (_, i) => (
          <span
            key={i}
            className="heatmap-cell skeleton"
            style={{ gridColumn: Math.floor(i / 7) + 2, gridRow: (i % 7) + 2, borderRadius: 3 }}
          />
        ))}
      </div>
    </div>
  );
}

function SkHeatmapLegend({ summary, expand }: { summary: string; expand: boolean }) {
  return (
    <div className={`heatmap-legend${expand ? ' heatmap-legend--split' : ''}`}>
      <span className="heatmap-summary"><SkText>{summary}</SkText></span>
      {expand && (
        <span className="heatmap-legend-middle">
          <span className="chip"><SkText>Expand</SkText></span>
        </span>
      )}
      <span className="heatmap-scale">
        <SkText>Less</SkText>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="heatmap-swatch skeleton" />)}
        <SkText>More</SkText>
      </span>
    </div>
  );
}

/** The Overview's Activity card body: 26 weeks and the legend row. */
export function SkHeatmap() {
  return (
    <div className="heatmap">
      <SkHeatmapPlot />
      <SkHeatmapLegend summary="165h 35m across 20 active days in the last 6 months" expand />
    </div>
  );
}

/**
 * The expanded Activity page. It grows a block every six months, and a
 * `loading.tsx` is not given the data, so it draws ONE block -- what both
 * devices show until their history passes six months.
 */
export function SkActivityPage({ device, cardSub }: { device: string; cardSub: string }) {
  return (
    <>
      <SkPageHead back="Overview" title="Activity" sub="Every day recorded, six months to a row, on one colour scale" />
      <div className="card">
        <div className="card-title">
          <div style={{ minWidth: 0 }}>
            <h2><SkText>{device}</SkText></h2>
            <p style={{ margin: '0.3rem 0 0', fontSize: 'var(--fs-small)' }}><SkText>{cardSub}</SkText></p>
          </div>
        </div>
        <div>
          <section className="heatmap-block">
            <h3 className="heatmap-block-head">
              <span><SkText>Aug 1 – Jan 29, 2027</SkText></span>
              <span className="heatmap-block-total"><SkText>165h 35m</SkText></span>
            </h3>
            <SkHeatmapPlot />
          </section>
          <SkHeatmapLegend summary="165h 35m across 20 active days since Aug 1, 2026" expand={false} />
        </div>
      </div>
    </>
  );
}

/**
 * A 12px bar and its key, in the markup of the laptop's "Where the time
 * went" (KindBar) and the phone's "Attributed vs unaccounted".
 */
export function SkSplitBar({ items, gap = '0.4rem 1.2rem' }: { items: string[]; gap?: string }) {
  return (
    <div>
      <Skeleton height={12} radius={6} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap, marginTop: '0.85rem' }}>
        {items.map((t) => (
          <span key={t} style={{ fontSize: 'var(--fs-small)' }}><SkText>{t}</SkText></span>
        ))}
      </div>
    </div>
  );
}

/** Label / value rows, as the Sync pages' "Stored" cards lay them out. */
export function SkRows({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ display: 'grid', gap: '0.55rem' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <span style={{ fontSize: 'var(--fs-small)' }}><SkText>{k}</SkText></span>
          <span className="mono"><SkText>{v}</SkText></span>
        </div>
      ))}
    </div>
  );
}

/**
 * A data table in the real table markup: `head` for the header row, `cells`
 * for every body row, `rows` of them. A cell is plain text, or `{ text,
 * sub }` for a cell that carries a second line (a phone app's package), or
 * `{ badge }` for a status pill. `icon` puts an app-logo box before the first
 * cell, as the By App tables do.
 */
export type SkCell = string | { text: string; sub?: string } | { badge: string };

export function SkDataTable({ head, rows, cells, icon = false, className = 'app-table' }: {
  head: string[];
  rows: number;
  cells: SkCell[];
  icon?: boolean;
  /** The page's own table class: the app tables use `.app-table`, the run histories none. */
  className?: string;
}) {
  const right = (i: number) => (i > 0 && head[i] !== 'Status' && head[i] !== 'Source' && head[i] !== 'Backup');
  return (
    <div className="table-wrap">
      <table className={className || undefined}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={right(i) ? { textAlign: 'right' } : undefined}><SkText>{h}</SkText></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {cells.map((c, i) => (
                <td key={i} className={right(i) ? 'num mono' : undefined}>
                  {typeof c === 'string' ? (
                    i === 0 && icon ? (
                      <span className="app-cell"><SkIcon size={20} /><SkText>{c}</SkText></span>
                    ) : <SkText>{c}</SkText>
                  ) : 'badge' in c ? (
                    <span className="badge" style={{ borderColor: 'transparent' }}><SkText>{c.badge}</SkText></span>
                  ) : (
                    <>
                      {icon && i === 0
                        ? <span className="app-cell"><SkIcon size={20} /><SkText>{c.text}</SkText></span>
                        : <SkText>{c.text}</SkText>}
                      {c.sub && (
                        <div className="mono" style={{ fontSize: '0.72rem' }}><SkText>{c.sub}</SkText></div>
                      )}
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
