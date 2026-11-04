import { formatDuration, formatPercent } from '@/lib/format';
import type { KindTotals } from '@/lib/queries';

/**
 * Where the recorded time went: active, locked, unattributed, asleep, as a
 * donut with active time in its centre beside a legend that gives each its
 * time, share and meaning. A donut since 2026-11-04 (the owner's call); it
 * was one 12px bar. Screen Time Native draws the same card the same way.
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
 * `--hm-none`, which was `#0b0b0d` against the card's `#0a0a0b` -- one or two
 * points per channel, so the Asleep segment was invisible and the chart
 * simply looked SHORT: unrecorded time reading as no time, the exact
 * misreading this card exists to prevent. It takes a visible neutral, and
 * stays the dimmest of the four so absence still reads as absence.
 *
 * The SVG is hidden from screen readers: the legend states every value as
 * text, and the ring only draws the same numbers as arcs.
 */

export const KIND_SEGMENTS = [
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

/** The ring's geometry, in viewBox units; the skeleton draws the same. */
export const DONUT = { size: 200, radius: 82, thickness: 30 } as const;

/** Degrees left between two slices, so neighbours of one hue stay apart. */
const GAP_DEG = 1.5;

export function KindBar({ kinds }: { kinds: KindTotals }) {
  const total = kinds.active + kinds.locked + kinds.unknown + kinds.gap;
  if (total === 0) return null;

  const { size, radius, thickness } = DONUT;
  const c = 2 * Math.PI * radius;
  const shown = KIND_SEGMENTS.filter((s) => kinds[s.key] > 0).length;
  const gap = shown > 1 ? (GAP_DEG / 360) * c : 0;
  let offset = 0;

  return (
    <div className="kind-split">
      <figure className="kind-donut" aria-hidden="true">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          {/* Clockwise from twelve o'clock: a circle's stroke starts at three,
              so the group turns a quarter back. */}
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {KIND_SEGMENTS.map((s) => {
              const len = (kinds[s.key] / total) * c;
              const at = offset;
              offset += len;
              if (len <= 0) return null;
              return (
                <circle
                  key={s.key}
                  cx={size / 2} cy={size / 2} r={radius}
                  fill="none" stroke={s.fill} strokeWidth={thickness}
                  strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`}
                  strokeDashoffset={-(at + gap / 2)}
                >
                  <title>{`${s.label} - ${formatDuration(kinds[s.key])}`}</title>
                </circle>
              );
            })}
          </g>
        </svg>
        <figcaption className="kind-donut-centre">
          <span className="kind-donut-value">{formatDuration(kinds.active)}</span>
          <span className="kind-donut-caption">active</span>
        </figcaption>
      </figure>

      <table className="kind-legend">
        <tbody>
          {KIND_SEGMENTS.map((s) => (
            <tr key={s.key}>
              <td>
                <span className="kind-swatch" style={{ background: s.fill }} />
                <span className="kind-name">{s.label}</span>
                <span className="kind-hint">{s.hint}</span>
              </td>
              <td className="num mono kind-time">{formatDuration(kinds[s.key])}</td>
              <td className="num mono kind-share">{formatPercent((kinds[s.key] / total) * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
