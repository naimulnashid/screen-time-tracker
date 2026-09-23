/**
 * Serving an app logo from `public/apps_logo/`.
 *
 * Why this route exists at all rather than linking the file directly: see the
 * measurement at the top of `src/lib/app-logo.ts`. `next start` snapshots
 * `public/` at boot, this dashboard stays up for weeks, and a logo added in
 * the meantime would 404 with the file plainly sitting on disk.
 *
 * ⚠️ THE KEY IS NEVER JOINED INTO A PATH. It is looked up in the manifest, and
 * the manifest's own relative path is what gets read -- the manifest builds
 * that path from a directory listing, so no part of it comes from the URL.
 * That matters more now the path can carry a device folder: a route that did
 * `path.join(dir, ...params.key)` would serve any file on the machine to
 * anyone who can reach the dashboard, and this one is reachable over the LAN.
 * The
 * lookup also normalises away every character that could form a traversal, so
 * there are two independent reasons a `../` cannot get through -- but the
 * lookup is the one being relied on.
 *
 * The auth middleware covers this path like everything else; only
 * `/api/android/ingest` and the login pair are exempt.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logoDir, logoFileForKey, logoKey } from '@/lib/app-logo';

/**
 * One segment is a shared logo, two are a device-scoped one:
 *
 *   /api/app-logo/gallery                        the root file
 *   /api/app-logo/nothinga001/gallery            that phone's, root as fallback
 *
 * A catch-all rather than two routes, because the fallback means the same
 * handler answers both. Anything longer is refused outright rather than
 * quietly using its first two parts -- a URL nobody generates is a URL worth
 * being strict about.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const segments = (await params).key ?? [];
  if (segments.length < 1 || segments.length > 2) {
    return new Response('Not found', { status: 404 });
  }

  // Normalised again here rather than trusted. The caller is our own page, but
  // the URL is reachable by hand. Both segments go through `logoKey()`, which
  // strips every character a traversal could be built from -- though it is the
  // manifest lookup below, not this, that is being relied on.
  const scope = segments.length === 2 ? logoKey(segments[0]!) : '';
  const found = logoFileForKey(scope, logoKey(segments[segments.length - 1]!));
  if (!found) return new Response('Not found', { status: 404 });

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(logoDir(), found.file));
  } catch {
    // On disk a moment ago, gone now -- a file deleted between the manifest
    // scan and the read. Not worth a 500.
    return new Response('Not found', { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': found.type,
      // Short, not immutable. A logo replaced in place keeps its file name, so
      // a long cache would serve the old artwork for as long as it lasted.
      'Cache-Control': 'private, max-age=60',
      // These are static artwork files, but they are served through a dynamic
      // route; say so, so nothing downstream tries to sniff a type.
      'X-Content-Type-Options': 'nosniff',
      // The sandboxing Content-Security-Policy for these files is set in
      // next.config.mjs, NOT here: a header set here is overwritten by the
      // site-wide one. See the note there.
    },
  });
}
