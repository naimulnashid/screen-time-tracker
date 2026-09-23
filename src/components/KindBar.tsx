import { formatDuration } from '@/lib/format';
import type { KindTotals } from '@/lib/queries';

/**
 * Where the recorded time went: active, locked, unattributed, asleep.
 *
 * This exists to keep the sampler honest in public. `unknown` is time the
 * sampler saw no foreground window and DECLINED TO GUESS -- a growing share is
 * the signal that it is mis-seeing the desktop, and burying it inside "not
 * active" would hide exactly the thing worth noticing.
 *
 * `gap` is shown too, in the quietest colour on the card, because a sleeping
 * laptop is not a quiet day and the two must not look alike.
 *
 * ⚠ That colour is mixed from `--text-dim`. It used to be the heat map's
 * `--hm-none`, which was `#0b0b0d` against this bar's `--bg-panel` track of
 * `#0a0a0b` -- one or two points per channel, so the Asleep segment was
 * invisible and the bar simply looked SHORT. That is the exact misreading this
 * card exists to prevent: unrecorded time reading as no time.
 *
 * The heat map had already solved the same problem and solved it better --
 * `.heatmap-cell[data-nodata]` draws a hairline instead of a fill, precisely
 * because a near-black fill on a near-black ground says nothing. KindBar
 * borrowed the token without the fix, and was its only consumer -- the token
 * is gone now, so nobody reaches for it again. A 12px band cannot carry a
 * hairline the way a square cell can, so it takes a visible neutral instead,
 * and stays the dimmest of the four so absence still reads as absence.
 */

const SEGMENTS = [
  {
    key: 'active' as const,
    label: 'Active',
    fill: 'var(--accent)',
    hint: 'An application was in the foreground.',
  },
  {
    key: 'locked' as const,
    label: 'Locked',
    fill: 'color-mix(in srgb, var(--accent) 34%, var(--bg-panel))',
    hint: 'The lock screen was in front. Positively detected, not inferred.',
  },
  {
    key: 'unknown' as const,
    label: 'Unattributed',
    fill: 'color-mix(in srgb, var(--text-dim) 55%, var(--bg-panel))',
    hint: 'No foreground window, and no positive evidence of a lock. Not guessed at.',
  },
  {
    key: 'gap' as const,
    label: 'Asleep',
    fill: 'color-mix(in srgb, var(--text-dim) 28%, var(--bg-panel))',
    hint: 'The machine slept, or the sampler was not running. Absence of a measurement, not a quantity.',
  },
];

export function KindBar({ kinds }: { kinds: KindTotals }) {
  const total = kinds.active + kinds.locked + kinds.unknown + kinds.gap;
  if (total === 0) return null;

  return (
    <div>
      {/* Hidden from screen readers: the legend below states every value as
          text, and this bar only draws the same numbers as widths. */}
      <div
        aria-hidden="true"
        style={{
          display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden',
          border: '1px solid var(--border)', background: 'var(--bg-panel)',
        }}
      >
        {SEGMENTS.map((s) => {
          const pct = (kinds[s.key] / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.key}
              title={`${s.label} - ${formatDuration(kinds[s.key])}`}
              style={{ width: `${pct}%`, background: s.fill }}
            />
          );
        })}
      </div>

      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem',
          marginTop: '0.85rem',
        }}
      >
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            title={s.hint}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <span
              style={{
                width: 9, height: 9, borderRadius: 2, background: s.fill,
                border: '1px solid var(--border)', flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-dim)' }}>
              {s.label}
            </span>
            <span
              style={{
                fontSize: 'var(--fs-small)', fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatDuration(kinds[s.key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
