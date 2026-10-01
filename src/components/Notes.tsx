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
