/**
 * Hide an app from By App, or merge it into another.
 *
 *   POST { platform: 'windows' | 'android', device: <slug>, key,
 *          action: 'hide' | 'show' | 'merge' | 'unmerge', into? }
 *
 * `key` and `into` are what the detail URLs carry: the resolved key on the
 * laptop, the package on a phone. Covered by the proxy's session and
 * cross-origin checks, like every other `/api/*` write. See lib/app-prefs.ts.
 */

import { dbPath, windowsSlug } from '@/lib/config';
import { backupAfterEdit } from '@/lib/edit-backup';
import { getWindowsAppKeys, WINDOWS_DEVICE_ID } from '@/lib/queries';
import { getAndroidAppKeys, getAndroidDeviceBySlug } from '@/lib/android-queries';
import { setHidden, setMerge, type PrefError } from '@/lib/app-prefs';

export const dynamic = 'force-dynamic';

/** Two keys, a slug and an action. Anything near this size is not one. */
const MAX_BODY_BYTES = 4096;

const MESSAGES: Record<PrefError, string> = {
  'unknown-app': 'No such app on this device.',
  'same-app': 'An app cannot be merged into itself.',
};

function fail(status: number, error: string, message: string) {
  return Response.json({ ok: false, error, message }, { status });
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, 'too-large', 'Request too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'bad-request', 'Not an app request.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad-request', 'Not an app request.');
  const { platform, device, key, action, into } = body as Record<string, unknown>;
  if (typeof device !== 'string' || typeof key !== 'string' || typeof action !== 'string') {
    return fail(400, 'bad-request', 'Not an app request.');
  }

  const file = dbPath();
  if (!file) return fail(500, 'no-database', 'No database is configured.');

  let deviceId: string;
  let known: Set<string>;
  if (platform === 'windows') {
    if (device !== windowsSlug()) return fail(404, 'unknown-device', 'No such device.');
    deviceId = WINDOWS_DEVICE_ID;
    known = getWindowsAppKeys();
  } else if (platform === 'android') {
    const phone = getAndroidDeviceBySlug(device);
    if (!phone) return fail(404, 'unknown-device', 'No such device.');
    deviceId = phone.deviceId;
    known = getAndroidAppKeys(phone.deviceId);
  } else {
    return fail(400, 'bad-request', 'Not an app request.');
  }
  if (!known.has(key)) return fail(404, 'unknown-app', MESSAGES['unknown-app']);

  try {
    if (action === 'hide' || action === 'show') {
      setHidden({ dbFile: file, deviceId, key, hidden: action === 'hide' });
      return Response.json({ backup: await backupAfterEdit(file), ok: true });
    }
    if (action === 'merge' || action === 'unmerge') {
      if (action === 'merge' && typeof into !== 'string') return fail(400, 'bad-request', 'Merge into which app?');
      const result = setMerge({
        dbFile: file, deviceId, key, known,
        into: action === 'merge' ? (into as string) : null,
      });
      if (!result.ok) {
        return fail(result.error === 'unknown-app' ? 404 : 422, result.error, MESSAGES[result.error]);
      }
      return Response.json({ backup: await backupAfterEdit(file), ok: true });
    }
  } catch (err) {
    return fail(500, 'write-failed', err instanceof Error ? err.message : String(err));
  }
  return fail(400, 'bad-request', 'Not an app request.');
}
