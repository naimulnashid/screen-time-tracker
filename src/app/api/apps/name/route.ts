/**
 * Rename an app, or clear its rename.
 *
 *   POST { platform: 'windows' | 'android', device: <slug>, key, name }
 *
 * `key` is the resolved app key on the laptop and the package name on a phone
 * -- what the detail URLs already carry. An empty `name` clears the rename,
 * and so does the app's original name.
 *
 * Auth and the cross-origin refusal come from the proxy, which covers every
 * `/api/*` route except the phone's bearer-token one. There is no extra check
 * here on purpose: a second, different rule is a second thing to get wrong.
 *
 * Checked against every app the device has EVER recorded, not the range on
 * screen, so a rename can never collide with an app outside the current view.
 */

import { dbPath, windowsSlug } from '@/lib/config';
import { getWindowsAppNames, WINDOWS_DEVICE_ID } from '@/lib/queries';
import { getAndroidAppNames, getAndroidDeviceBySlug } from '@/lib/android-queries';
import { saveRename, MAX_NAME_LENGTH, type AppNames, type RenameError } from '@/lib/app-renames';

export const dynamic = 'force-dynamic';

/** A name, a key and a slug. Anything near this size is not a rename. */
const MAX_BODY_BYTES = 4096;

const MESSAGES: Record<RenameError, string> = {
  'unknown-app': 'No such app on this device.',
  'bad-name': `A name needs 1 to ${MAX_NAME_LENGTH} characters.`,
  reserved: 'That name is reserved for grouped apps.',
  taken: 'Another app on this device already has that name.',
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
    return fail(400, 'bad-request', 'Not a rename request.');
  }
  const { platform, device, key, name } = body ?? {};
  if (typeof device !== 'string' || typeof key !== 'string' || typeof name !== 'string') {
    return fail(400, 'bad-request', 'Not a rename request.');
  }

  const file = dbPath();
  if (!file) return fail(500, 'no-database', 'No database is configured.');

  let deviceId: string;
  let apps: AppNames;
  if (platform === 'windows') {
    if (device !== windowsSlug()) return fail(404, 'unknown-device', 'No such device.');
    deviceId = WINDOWS_DEVICE_ID;
    apps = getWindowsAppNames();
  } else if (platform === 'android') {
    const phone = getAndroidDeviceBySlug(device);
    if (!phone) return fail(404, 'unknown-device', 'No such device.');
    deviceId = phone.deviceId;
    apps = getAndroidAppNames(phone.deviceId);
  } else {
    return fail(400, 'bad-request', 'Not a rename request.');
  }

  try {
    const result = saveRename({ dbFile: file, deviceId, key, name, apps });
    if (!result.ok) {
      return fail(result.error === 'unknown-app' ? 404 : 422, result.error, MESSAGES[result.error]);
    }
    return Response.json({ ok: true, name: result.name, renamed: result.name !== apps.get(key)?.base });
  } catch (err) {
    return fail(500, 'write-failed', err instanceof Error ? err.message : String(err));
  }
}
