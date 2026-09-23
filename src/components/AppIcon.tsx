/**
 * An app's logo, or a readable stand-in for one.
 *
 * `src` is resolved server-side by `logoUrl()` and is null when no file
 * matches. That is deliberate: passing a URL that will 404 would leave the
 * browser to draw its own broken-image glyph, which looks like a bug. An app
 * with no logo is the NORMAL case here -- there are hundreds of executables
 * and thirty-odd logo files -- so the fallback has to look intentional.
 *
 * The fallback is the app's first character. Not a generic placeholder icon,
 * because a column of identical grey squares carries nothing; an initial at
 * least distinguishes rows at a glance.
 */
export function AppIcon({
  name, src, plate = false, size = 20,
}: {
  name: string;
  src?: string | null;
  /** Logo is black on transparent and needs a light plate behind it. */
  plate?: boolean;
  size?: number;
}) {
  const box = {
    width: size,
    height: size,
    flex: `0 0 ${size}px`,
    borderRadius: Math.max(4, Math.round(size * 0.22)),
  } as const;

  if (!src) {
    return (
      <span
        className="app-icon app-icon--initial"
        style={{ ...box, fontSize: Math.round(size * 0.52) }}
        aria-hidden="true"
      >
        {firstChar(name)}
      </span>
    );
  }

  return (
    <span
      className={`app-icon${plate ? ' app-icon--plate' : ''}`}
      style={box}
    >
      {/*
        A plain <img>, not next/image. These are already small hand-picked
        files served by our own route; the optimiser would add a second cache
        in front of a file the user expects to be able to replace by dropping a
        new one in the folder.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" />
    </span>
  );
}

/**
 * The first character, which is not always the first code unit.
 *
 * `[...name]` iterates by code point, so an app whose name starts outside the
 * BMP gets a whole character rather than half a surrogate pair.
 */
function firstChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return [...trimmed][0]!.toUpperCase();
}
