/**
 * The fixed explanatory paragraphs that a page and its loading skeleton
 * share. The skeleton renders the same markup, masked, so it wraps to the
 * same number of lines -- which only holds while both render THESE words.
 * Change a note here and both move together.
 */

/** The phone Overview's last card: why apps never add up to screen-on. */
export function AttributedNote({ ratio }: { ratio: string }) {
  return (
    <p className="prose-note" style={{ marginTop: '1rem' }}>
      Per-app time never adds up to screen-on time, and that is expected:
      the lock screen, the launcher between apps and system surfaces all
      hold time no app claims. Measured here at{' '}
      <strong>{ratio}&times;</strong>. The
      headline above therefore comes from screen-on events, never from
      summing the apps below.
    </p>
  );
}

/** Under the phone Overview's Most opened by day: the launcher left out. */
export function HomeOpensNote({ names, verb, opens }: { names: string; verb: 'is' | 'are'; opens: string }) {
  return (
    <p className="prose-note" style={{ marginTop: '0.9rem' }}>
      {names} {verb} left out, with {opens} opens: the home screen is what you
      pass through between apps, not something you open. It keeps its band in
      Top apps by day above.
    </p>
  );
}

/** Under the phone By App's Most opened: the launcher left out. */
export function HomeRankNote({ names, verb, opens }: { names: string; verb: 'is' | 'are'; opens: string }) {
  return (
    <p className="prose-note" style={{ marginTop: '0.9rem' }}>
      {names} {verb} left out. The home screen is what you pass through
      between apps, not something you open, and at {opens} it stood nearly
      three times taller than the biggest bar left, flattening every one of
      them. It keeps its place in Top apps above, where the time is real.
    </p>
  );
}

/**
 * The laptop Sync page's Sampler card names whichever sampler is the source:
 * this project's own, or Screen Time Native's (see `nativeSource()`).
 */
export function samplerSub(native: boolean): string {
  return native
    ? "Screen Time Native's, read from its heartbeat file."
    : 'Read from the heartbeat file, not the task state.';
}

/** After "Currently in X for 12m": why that span is not in the totals yet. */
export function InFlightTail({ native }: { native: boolean }) {
  return native ? (
    <>
      This span is not in the database yet &mdash; Screen Time Native saves
      every 15 minutes and this dashboard copies from it hourly or on Sync
      now, so today&rsquo;s totals below lag it.
    </>
  ) : (
    <>
      This span is not in the database yet &mdash; it is written when the
      foreground changes, so today&rsquo;s totals below exclude it.
    </>
  );
}
