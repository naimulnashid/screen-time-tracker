/**
 * Set an app's bar colour, or clear it.
 *
 *   POST { platform: 'windows' | 'android', device: <slug>, key, colour }
 *
 * `key` is what `/api/apps/name` takes: the resolved app key on the laptop,
 * the package on a phone. `colour` is `#rgb` or `#rrggbb`; an empty string
 * clears it, and the app goes back to its brand colour or the device accent.
 *
 * Gated like every other `/api/*` write by the proxy: a signed-in session,
 * and a request from this origin.
 */

import { dbPath, windowsSlug } from '@/lib/config';
import { getWindowsAppNames, WINDOWS_DEVICE_ID } from '@/lib/queries';
import { getAndroidAppNames, getAndroidDeviceBySlug } from '@/lib/android-queries';
import { saveColourOverride, type ColourError } from '@/lib/app-colour-overrides';

export const dynamic = 'force-dynamic';

/** A hex, a key and a slug. Anything near this size is not a colour. */
const MAX_BODY_BYTES = 4096;

const MESSAGES: Record<ColourError, string> = {
  'unknown-app': 'No such app on this device.',
  'bad-colour': 'A colour is a hex code like #7c5cff.',
};

function fail(status: number, error: string, message: string) {
  return Response.json({ ok: false, error, message }, { status });
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, 'too-large', 'Request too large.');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail(400, 'bad-request', 'Not a colour request.');
  }
  const { platform, device, key, colour } = body ?? {};
  if (typeof device !== 'string' || typeof key !== 'string' || typeof colour !== 'string') {
    return fail(400, 'bad-request', 'Not a colour request.');
  }

  const file = dbPath();
  if (!file) return fail(500, 'no-database', 'No database is configured.');

  let deviceId: string;
  let known: Set<string>;
  if (platform === 'windows') {
    if (device !== windowsSlug()) return fail(404, 'unknown-device', 'No such device.');
    deviceId = WINDOWS_DEVICE_ID;
    known = new Set(getWindowsAppNames().keys());
  } else if (platform === 'android') {
    const phone = getAndroidDeviceBySlug(device);
    if (!phone) return fail(404, 'unknown-device', 'No such device.');
    deviceId = phone.deviceId;
    known = new Set(getAndroidAppNames(phone.deviceId).keys());
  } else {
    return fail(400, 'bad-request', 'Not a colour request.');
  }

  try {
    const result = saveColourOverride({ dbFile: file, deviceId, key, colour, known });
    if (!result.ok) {
      return fail(result.error === 'unknown-app' ? 404 : 422, result.error, MESSAGES[result.error]);
    }
    return Response.json({ ok: true, colour: result.colour });
  } catch (err) {
    return fail(500, 'write-failed', err instanceof Error ? err.message : String(err));
  }
}
