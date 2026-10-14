/**
 * The cloud inbox, laptop side: opening sealed envelopes and draining them in.
 *
 * Why an inbox at all: a phone used to post straight to this dashboard on the
 * LAN, so its address changed with every router reboot and every other house,
 * and nothing could be sent while the laptop was off. The inbox is a fixed
 * HTTPS address (a Supabase Edge Function, `supabase/functions/inbox`) that
 * the phone posts to from anywhere; the laptop empties it on the hourly
 * ingest and on Sync now, through the same `payloadProblem` + `ingestAndroid`
 * a direct upload goes through.
 *
 * **The inbox can read nothing.** The phone encrypts each upload to a P-256
 * key whose private half lives only on this machine (`inbox.keyPath` in
 * config, never in the repo), so the inbox holds ciphertext and a device id.
 *
 * ENVELOPE, version 1 (the Android app's Sealer.kt writes the same bytes):
 *
 *   "STI1"                 4 bytes   magic, and the version
 *   ephemeral public key  65 bytes   uncompressed P-256 point, new per upload
 *   nonce                 12 bytes
 *   ciphertext + tag       rest      AES-256-GCM, 16-byte tag at the end
 *
 *   shared = ECDH(ephemeral, laptop key)                 x-coordinate, 32 bytes
 *   salt   = HMAC-SHA256(ANDROID_INGEST_TOKEN, "screen-time inbox seal v1")
 *   key    = HKDF-SHA256(shared, salt, "screen-time inbox v1" || ephemeral, 32)
 *   aad    = magic || ephemeral
 *   plain  = gzip(the same JSON a direct upload sends)
 *
 * **The token in the salt is what makes an envelope authentic, not just
 * private.** The laptop's key is public by definition, so anyone could seal
 * to it; only a holder of the ingest token can derive a key the laptop will
 * accept. And the inbox never sees that token: phones authenticate to it with
 * `uploadBearer(token)`, an HMAC of it. Replaying an old envelope is harmless,
 * since every span is upserted with MAX().
 *
 * The same format as the sibling Data Usage Tracker's inbox, with its own
 * magic and labels, so an envelope can never be taken for the other app's.
 */

import {
  createHmac, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, createHash, type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from './config';
import {
  openDatabase, startSyncRun, finishSyncRun, checkpointWal, backupDatabase,
} from './db';
import { ingestAndroid, payloadProblem, type AndroidPayload } from './android-ingest';

export const MAGIC = Buffer.from('STI1', 'ascii');
const POINT_BYTES = 65;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SEAL_LABEL = 'screen-time inbox seal v1';
const UPLOAD_LABEL = 'screen-time inbox upload v1';
const INFO_LABEL = 'screen-time inbox v1';

/** Decompressed cap, the same as a direct upload's MAX_JSON_BYTES. */
const MAX_PLAIN_BYTES = 64 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface InboxConfig {
  /** e.g. https://<ref>.supabase.co/functions/v1/inbox/screen-time */
  url: string;
  /** PKCS#8 PEM of this laptop's P-256 key. Must not be under C:\ or the repo. */
  keyPath: string;
}

/** `inbox` in config/collector.json, or null when the inbox is not in use. */
export function inboxConfig(): InboxConfig | null {
  const i = loadConfig().inbox;
  if (!i || typeof i.url !== 'string' || typeof i.keyPath !== 'string' || !i.url || !i.keyPath) return null;
  if (!i.url.startsWith('https://')) throw new Error('inbox.url must be an https:// address');
  return { url: i.url.replace(/\/+$/, ''), keyPath: i.keyPath };
}

/**
 * A secret from the environment, else from `.env.local`.
 *
 * Next loads `.env.local` into the dashboard's environment; the hourly ingest
 * runs through `npm run ingest`, which gets no such help.
 */
export function secret(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return undefined;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0 || line.slice(0, eq).trim() !== name) continue;
    return line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

export function loadInboxKey(keyPath: string): KeyObject {
  const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error(`${keyPath} is not a P-256 key`);
  }
  return key;
}

export function newInboxKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

/** The public half as base64 SPKI DER: what the phone stores. */
export function publicKeyB64(key: KeyObject): string {
  return (createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
}

/**
 * Sixteen hex digits of SHA-256 over the SPKI, in groups of four. The phone
 * shows the same string, so the two can be compared by eye.
 */
export function fingerprint(spkiB64: string): string {
  const hex = createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 16);
  return hex.toUpperCase().match(/.{4}/g)!.join(' ');
}

/** The bearer a phone presents to the inbox. The inbox stores its SHA-256. */
export function uploadBearer(token: string): string {
  return createHmac('sha256', token).update(UPLOAD_LABEL).digest('hex');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

function pointOf(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' }) as { x: string; y: string };
  return Buffer.concat([
    Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url'),
  ]);
}

function keyFromPoint(point: Buffer): KeyObject {
  if (point.length !== POINT_BYTES || point[0] !== 0x04) throw new Error('bad ephemeral key');
  return createPublicKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
}

function aesKey(shared: Buffer, point: Buffer, token: string): Buffer {
  const salt = createHmac('sha256', token).update(SEAL_LABEL).digest();
  const info = Buffer.concat([Buffer.from(INFO_LABEL, 'ascii'), point]);
  return Buffer.from(hkdfSync('sha256', shared, salt, info, 32));
}

/**
 * Seal bytes to a laptop key. The phone does this, in Kotlin; this copy
 * exists for the self-test and for checking a deployed inbox end to end.
 */
export function sealEnvelope(plain: Buffer, recipientSpkiB64: string, token: string): Buffer {
  const recipient = createPublicKey({ key: Buffer.from(recipientSpkiB64, 'base64'), format: 'der', type: 'spki' });
  const eph = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const point = pointOf(eph.publicKey);
  const key = aesKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), point, token);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.concat([MAGIC, point]));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, point, nonce, body, cipher.getAuthTag()]);
}

/**
 * Open an envelope, or throw. A wrong key, a wrong token and a tampered byte
 * all fail the same way, at the GCM tag, and are reported as one error.
 */
export function openEnvelope(envelope: Buffer, key: KeyObject, token: string): Buffer {
  if (envelope.length < MAGIC.length + POINT_BYTES + NONCE_BYTES + TAG_BYTES) throw new Error('envelope too short');
  if (!envelope.subarray(0, 4).equals(MAGIC)) throw new Error('not an STI1 envelope');
  const point = envelope.subarray(4, 4 + POINT_BYTES);
  const nonce = envelope.subarray(4 + POINT_BYTES, 4 + POINT_BYTES + NONCE_BYTES);
  const body = envelope.subarray(4 + POINT_BYTES + NONCE_BYTES, envelope.length - TAG_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);

  const aes = aesKey(diffieHellman({ privateKey: key, publicKey: keyFromPoint(point) }), point, token);
  const decipher = createDecipheriv('aes-256-gcm', aes, nonce);
  decipher.setAAD(Buffer.concat([MAGIC, point]));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error(
      'cannot open envelope: sealed to another laptop key, with another ingest token, or altered',
    );
  }
}

/** Envelope -> the payload JSON a direct upload would have carried. */
export function envelopeJson(envelope: Buffer, key: KeyObject, token: string): unknown {
  const zipped = openEnvelope(envelope, key, token);
  return JSON.parse(gunzipSync(zipped, { maxOutputLength: MAX_PLAIN_BYTES }).toString('utf8'));
}

/* ------------------------------------------------------------------ */
/* Draining                                                            */
/* ------------------------------------------------------------------ */

interface Pending {
  id: number;
  received_at: string;
  device_hint: string | null;
  envelope: string;
}

export interface DrainOptions {
  /** Also try envelopes an earlier drain marked failed. */
  retryFailed?: boolean;
  /** Open and validate, write nothing, acknowledge nothing. */
  dryRun?: boolean;
  /** Test seam: another database than config's, and the guard bypass for TEMP. */
  dbPath?: string;
  allowSystemDrive?: boolean;
  log?: (line: string) => void;
}

export interface DrainOutcome {
  landed: number;
  failed: number;
  segments: number;
  backupStatus: string | null;
}

async function call(cfg: InboxConfig, drainToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${cfg.url}/${path}`, {
    ...init,
    redirect: 'error',
    headers: { Authorization: `Bearer ${drainToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(`inbox ${path}: HTTP ${res.status} ${body.error ?? ''}`.trim());
  return body;
}

/** "landed 2, 1 failed" for the console and the Sync now toast. */
export function describeDrain(r: DrainOutcome | null): string | null {
  if (!r || (r.landed === 0 && r.failed === 0)) return null;
  const failed = r.failed > 0 ? `, ${r.failed} could not be read (see the phone's Sync page)` : '';
  return `${r.landed} phone upload${r.landed === 1 ? '' : 's'} from the cloud inbox${failed}.`;
}

/**
 * Empty the inbox into the database.
 *
 * Each envelope is one `sync_log` run with source `android-inbox`: started at
 * the moment the PHONE sent it, finished when it landed here, so a laptop off
 * for three days does not read as three days of uploads made at once. Its
 * ingest is one transaction, exactly as the route's. Acknowledged only after
 * the commit: a lost acknowledgement means the next drain ingests it again,
 * which the MAX() upserts make harmless.
 *
 * An envelope that cannot be opened or is rejected is marked failed in the
 * inbox and skipped from then on, rather than retried and logged every hour.
 * The phone has already moved past that window, so the fix is to correct the
 * cause and run with `retryFailed`, or press Full resync on the phone.
 */
export async function drainInbox(opts: DrainOptions = {}): Promise<DrainOutcome | null> {
  const cfg = inboxConfig();
  if (!cfg) return null;
  const log = opts.log ?? (() => {});

  const ingestToken = secret('ANDROID_INGEST_TOKEN');
  const drainToken = secret('INBOX_DRAIN_TOKEN');
  if (!ingestToken) throw new Error('ANDROID_INGEST_TOKEN is not set in .env.local');
  if (!drainToken) throw new Error('INBOX_DRAIN_TOKEN is not set in .env.local');
  const key = loadInboxKey(cfg.keyPath);

  const conf = loadConfig();
  const dbPath = opts.dbPath ?? conf.databasePath;
  if (!dbPath) throw new Error('no databasePath in config/collector.json');

  const out: DrainOutcome = { landed: 0, failed: 0, segments: 0, backupStatus: null };
  const landedRuns: number[] = [];
  const db = opts.dryRun ? null : openDatabase(dbPath, { allowSystemDrive: opts.allowSystemDrive });
  db?.exec('PRAGMA busy_timeout = 15000');

  try {
    // Paged by id rather than by "whatever is left", so an envelope that
    // stays behind -- a dry run, a retry that fails again -- is never
    // fetched twice.
    let after = 0;
    for (;;) {
      const page = (await call(
        cfg, drainToken, `pending?limit=10&after=${after}${opts.retryFailed ? '&failed=1' : ''}`,
      )) as { envelopes: Pending[] };
      if (page.envelopes.length === 0) break;

      const done: number[] = [];
      const failed: { id: number; error: string }[] = [];

      for (const e of page.envelopes) {
        after = Math.max(after, e.id);
        const receivedAt = new Date(e.received_at).toISOString();
        let deviceId = e.device_hint;
        const began = Date.now();
        try {
          const payload = envelopeJson(Buffer.from(e.envelope, 'base64'), key, ingestToken) as AndroidPayload;
          const problem = payloadProblem(payload);
          if (problem) throw new Error(`payload rejected: ${problem.reason}`);
          deviceId = payload.device.deviceId;
          if (!db) {
            log(`#${e.id} ${deviceId}: opens, ${payload.sessions?.length ?? 0} sessions (dry run)`);
            continue;
          }

          const runId = startSyncRun(db, deviceId, 'android-inbox', receivedAt);
          try {
            db.exec('BEGIN');
            let result;
            try {
              result = ingestAndroid(db, payload);
              db.exec('COMMIT');
            } catch (err) {
              db.exec('ROLLBACK');
              throw err;
            }
            const written = result.sessionSegments + result.screenSegments;
            finishSyncRun(db, runId, {
              status: 'success',
              rowsRead: written + result.rejected,
              rowsInserted: written,
              rowsSkipped: result.rejected,
              sourceOldestUtc: payload.device?.eventsReachUtc ?? null,
              sourceNewestUtc: receivedAt,
              backupStatus: null,
              durationMs: Date.now() - began,
              error: null,
            });
            landedRuns.push(runId);
            out.landed++;
            out.segments += written;
            done.push(e.id);
            log(`#${e.id} ${deviceId}: ${written} segments`);
          } catch (err) {
            finishSyncRun(db, runId, {
              status: 'failed', rowsRead: 0, rowsInserted: 0, rowsSkipped: 0,
              sourceOldestUtc: null, sourceNewestUtc: null, backupStatus: null,
              durationMs: Date.now() - began, error: `inbox: ${err instanceof Error ? err.message : String(err)}`,
            });
            // Already logged as a run; skip the generic failure log below.
            throw Object.assign(err instanceof Error ? err : new Error(String(err)), { logged: true });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`#${e.id} ${deviceId ?? 'unknown phone'}: ${message}`);
          if (!db) continue;
          if (deviceId && !(err as { logged?: boolean }).logged) {
            // Could not be opened or was refused before a run began: record
            // it under the clear-text device hint, so the phone's Sync page
            // says so instead of the upload vanishing.
            const runId = startSyncRun(db, deviceId, 'android-inbox', receivedAt);
            finishSyncRun(db, runId, {
              status: 'failed', rowsRead: 0, rowsInserted: 0, rowsSkipped: 0,
              sourceOldestUtc: null, sourceNewestUtc: null, backupStatus: null,
              durationMs: Date.now() - began, error: `inbox: ${message}`,
            });
          }
          out.failed++;
          failed.push({ id: e.id, error: message });
        }
      }

      if (db && (done.length > 0 || failed.length > 0)) {
        await call(cfg, drainToken, 'ack', { method: 'POST', body: JSON.stringify({ done, failed }) });
      }
    }

    // One backup for the whole drain, as the route makes one per push.
    if (db && out.landed > 0) {
      checkpointWal(db);
      if (conf.backupEnabled && conf.backupPath && !opts.dbPath) {
        out.backupStatus = await backupDatabase(db, conf.backupPath);
        const set = db.prepare('UPDATE sync_log SET backup_status = ? WHERE id = ?');
        for (const id of landedRuns) set.run(out.backupStatus, id);
      }
    }
  } finally {
    db?.close();
  }
  return out;
}
