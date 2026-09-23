/**
 * Loading skeletons.
 *
 * These are not decorative grey boxes. Their job is that **nothing moves when
 * the data lands** -- so they reproduce each page section by section, in order,
 * at measured heights.
 *
 * Three rules keep them honest:
 *
 * 1. **Reuse the real classes.** `SkeletonCard` renders an actual `.card` with
 *    an actual title block, so padding, border and title spacing come from the
 *    same CSS the real page uses and cannot drift. Only the content area needs
 *    a number.
 * 2. **Grids use the real class and the real cell count** (`grid grid--3` with
 *    three children), so `auto-fit` wraps them exactly as the real grid does at
 *    every width. A hand-tuned cell count matches at one window size and is
 *    wrong at every other.
 * 3. **Width-sensitive heights carry the mid-range of two measurements**, at
 *    997px and 1680px viewport, so the error is split rather than piled on one
 *    end. Every number in the loading files is annotated with both.
 *
 * Measure with the sidebar COLLAPSED, its default since 2026-09-23. At 997px
 * the rail is what decides whether the trend's callout wraps and how wide the
 * heat map's cells grow; measured expanded, both Overviews came out 30-50px
 * off.
 *
 * Re-measure if a panel changes shape. The measurement harness is in the commit
 * that added these; it renders each route into a detached iframe at both widths
 * and reads `.container > *` heights.
 *
 * Unlike the sibling AI Usage Tracker, whose skeleton covers a client-side
 * fetch, these are Next `loading.tsx` boundaries: they show while the server
 * component renders and during route transitions. Same purpose, different
 * mechanism -- which is why they live next to the pages rather than inside a
 * provider.
 */

/**
 * The Activity heat map's content height: grid, scroll gutter and legend.
 *
 * The one panel on the Overviews whose height is set by its WIDTH -- 26 week
 * columns of square, fluid cells -- so it is the mid-range of the two
 * reference widths (rule 3), shared by both Overviews.
 *
 * Card measured 427 @997 / 523 @1680 with the sidebar collapsed, which is
 * the default -> 325 of content under a 79px title (its sub runs to two lines
 * at both widths).
 */
export const HEATMAP_HEIGHT = 325;

/** One shimmering block. */
export function Skeleton({
  height,
  width = '100%',
  radius,
  style,
}: {
  height: number | string;
  width?: number | string;
  radius?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      style={{ height, width, ...(radius ? { borderRadius: radius } : {}), ...style }}
    />
  );
}

/**
 * Mirrors `page-head`: an h1 and one line of sub text.
 *
 * Measured 64px @997 / 73px @1680 -> 68.
 *
 * `backLink` is for the pages whose head carries a "back" line above the
 * title. Without it they start ~40px short and every card below them jumps on
 * load. Those heads differ -- an app detail title carries a logo row, the
 * Activity page does not -- so `height` overrides the default. Re-measured
 * 2026-09-23: Activity 101 / 111 -> 106 (the default), Windows app detail
 * 92 / 101 -> 97, Android app detail 88 / 98 -> 93.
 */
export function SkeletonPageHead({
  backLink = false, height,
}: { backLink?: boolean; height?: number } = {}) {
  return (
    <div style={{ height: height ?? (backLink ? 106 : 68), marginBottom: '2.2rem' }}>
      {backLink && <Skeleton height={14} width={110} style={{ marginBottom: 12 }} />}
      <Skeleton height={30} width={190} />
      <Skeleton height={17} width={330} style={{ marginTop: 10 }} />
    </div>
  );
}

/**
 * Mirrors `Card` + `CardTitle`.
 *
 * `titleHeight` defaults to 55px, which is what a one-line title with a
 * one-line sub measures at both widths. The 1.15rem bottom margin matches
 * `CardTitle`'s exactly.
 */
export function SkeletonCard({
  contentHeight,
  titleHeight = 55,
  children,
}: {
  contentHeight: number;
  titleHeight?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="card">
      <div style={{ height: titleHeight, marginBottom: '1.15rem' }}>
        <Skeleton height={24} width={160} />
        <Skeleton height={17} width="60%" style={{ marginTop: 7 }} />
      </div>
      {children ?? <Skeleton height={contentHeight} />}
    </div>
  );
}

/**
 * Mirrors a `.grid.grid--3` of stat cards.
 *
 * Uses the real grid class and a real three-card count, so it wraps identically
 * at every width -- which is why no height is passed for the grid itself.
 *
 * `valueHeight` 55 makes the card 159: the Overviews' stat cards measured
 * 152 @997 / 166 @1680 on 2026-09-23. The old 80 left every Overview's
 * skeleton 25px tall per stat row -- 50px on the phone's, which has two.
 */
export function SkeletonStatGrid({
  valueHeight = 55,
  columns = 3,
}: {
  valueHeight?: number;
  columns?: 3 | 4;
}) {
  return (
    <div className={`grid grid--${columns}`} style={{ marginBottom: '1.15rem' }}>
      {Array.from({ length: columns }, (_, i) => (
        <div className="card" key={i}>
          <Skeleton height={13} width={92} />
          <Skeleton height={valueHeight} width="72%" style={{ marginTop: 12 }} />
          <Skeleton height={16} width="55%" style={{ marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Mirrors a table: header rule plus `rows` body rows.
 *
 * `rowHeight` is measured, not guessed. A Sync Status row is taller than an app
 * row because it carries a status badge, and a shared default left the run
 * history skeleton 13px short per row.
 */
export function SkeletonTable({
  rows, columns = 6, rowHeight = 42,
}: {
  rows: number;
  columns?: number;
  rowHeight?: number;
}) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.9rem', padding: '0.7rem 0.9rem' }}>
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} height={14} width={i === 0 ? '26%' : '12%'} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            display: 'flex',
            gap: '0.9rem',
            alignItems: 'center',
            height: rowHeight,
            padding: '0 0.9rem',
            borderTop: '1px solid var(--border)',
            boxSizing: 'border-box',
          }}
        >
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} height={17} width={i === 0 ? '26%' : '12%'} />
          ))}
        </div>
      ))}
    </div>
  );
}
