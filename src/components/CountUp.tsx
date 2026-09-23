'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCount, formatDurationLike, formatPercent } from '@/lib/format';

/**
 * How to render the animated number.
 *
 * A mode string rather than a formatter function, because most callers are
 * server components and functions cannot cross the server/client boundary.
 */
export type CountUpMode =
  /** Leading rung only: the "6" of "6h 42m". */
  | 'durationValue'
  /** Second rung only: the "42" of "6h 42m". Empty when there is no sub-rung. */
  | 'durationSub'
  /** The whole thing: "6h 42m". */
  | 'duration'
  | 'count'
  | 'percent';

interface Props {
  /** Milliseconds for the duration modes; a plain number for count/percent. */
  value: number;
  mode?: CountUpMode;
  /** Length of the ANIMATION, not the value being animated. */
  animationMs?: number;
  className?: string;
}

/**
 * Counts a number up on mount.
 *
 * Eased rather than linear so it decelerates into the final value instead of
 * stopping dead. Honours prefers-reduced-motion by rendering the final value
 * immediately, and always lands exactly on `value` rather than on whatever the
 * last animation frame happened to produce.
 *
 * The prop is `animationMs`, not `durationMs` as in the sibling Data Usage
 * Tracker. There, "duration" could only mean the animation; here `value` is
 * itself a duration in milliseconds, and two unrelated millisecond props in
 * one signature is exactly the kind of thing that gets passed the wrong way
 * round at 1am.
 */
export function CountUp({ value, mode = 'durationValue', animationMs = 900, className }: Props) {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || value === 0) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / animationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, animationMs]);

  return <span className={className}>{render(mode, display, value)}</span>;
}

function render(mode: CountUpMode, current: number, final: number): string {
  switch (mode) {
    case 'count':
      return formatCount(Math.round(current));
    case 'percent':
      return formatPercent(current);

    // Both duration modes hold the in-flight number in the FINAL value's
    // rungs, so a total ending at "6h 42m" counts up in hours and minutes
    // rather than racing through seconds and reflowing the layout on the way.
    case 'duration':
      return formatDurationLike(current, final);

    // One rung each. The caller renders the units between them, so the big
    // numbers and the small units can be styled independently.
    case 'durationValue':
      return rung(current, final, 0);
    case 'durationSub':
      return rung(current, final, 1);
  }
}

/**
 * Rung `index` of `current`, measured on whichever ladder `final` settled on.
 *
 * Returns '' for a missing sub-rung rather than '0', so a headline of exactly
 * "1h" does not animate a phantom "0" beside it.
 */
function rung(current: number, final: number, index: 0 | 1): string {
  const part = formatDurationLike(current, final).split(' ')[index];
  return part === undefined ? '' : part.replace(/[a-z]/gi, '');
}
