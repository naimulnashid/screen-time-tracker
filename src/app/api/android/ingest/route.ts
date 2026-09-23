import { NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { openDatabase, startSyncRun, finishSyncRun, checkpointWal, backupDatabase } from '@/lib/db';
import { ingestAndroid, payloadProblem, type AndroidPayload } from '@/lib/android-ingest';
import { safeEqual } from '@/lib/auth';
import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the phone pushes.
 *
 * `middleware.ts` lets this exact path through its session gate. That is not
 * an exemption -- the check below is STRICTER, since the phone has no browser
 * session and never will -- and it is scoped to this one path so a future
 * route under /api/android/ cannot inherit the bypass.
 *
 * The token is separate from DASHBOARD_PASSWORD on purpose: putting the
 * dashboard password on a device that leaves the house is a worse trade than a
 * token that can be rotated on its own.
 *
 * ⚠️ It FAILS CLOSED. An unset token rejects every push rather than accepting
 * them all. Never "helpfully" make a missing token mean open access -- this
 * endpoint writes to the database that the whole project exists to preserve.
 */

/**
 * Two ceilings, because a gzipped body has two sizes.
 *
 * MAX_BODY_BYTES bounds what arrives on the wire and is enforced WHILE
 * READING. It used to be checked against the Content-Length header only, which
 * a chunked upload simply does not send -- and `arrayBuffer()` then buffered
 * whatever came. MAX_JSON_BYTES bounds what gunzip may produce: a few KB of
 * gzip can inflate to gigabytes, and without a limit that is one request to
 * take the process, and every dashboard page, down with it.
 *
 * A real ten-day sync is well under 1 MB gzipped.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;

function configuredToken(): string | undefined {
  const t = process.env['ANDROID_INGEST_TOKEN'];
  return t && t.trim().length > 0 ? t : undefined;
}

/** The body, or null the moment it passes `max` bytes. */
async function readCapped(request: Request, max: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const tooLarge = () => NextResponse.json({ error: 'payload-too-large' }, { status: 413 });

export async function POST(request: Request) {
  const expected = configuredToken();
  if (!expected) {
    return NextResponse.json({ error: 'ingest-not-configured' }, { status: 503 });
  }

  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!presented || !(await safeEqual(presented, expected))) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // An honest oversized declaration is refused without reading a byte; a
  // missing or false one is caught by readCapped instead.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  /*
    DECOMPRESS THE BODY OURSELVES.

    The phone gzips its payload -- ten days of sessions is a few MB of very
    repetitive JSON -- and `request.json()` does NOT decompress a gzipped
    REQUEST body. Response bodies are handled automatically, which is what
    makes this easy to assume works. It does not: the first real sync from the
    phone failed with `bad-json`, having uploaded fine.
  */
  const buf = await readCapped(request, MAX_BODY_BYTES);
  if (!buf) return tooLarge();

  let payload: AndroidPayload;
  try {
    const encoding = (request.headers.get('content-encoding') ?? '').toLowerCase();
    const text = (
      encoding.includes('gzip') ? gunzipSync(buf, { maxOutputLength: MAX_JSON_BYTES }) : buf
    ).toString('utf8');
    payload = JSON.parse(text) as AndroidPayload;
  } catch (err) {
    // RangeError ERR_BUFFER_TOO_LARGE: the gzip bomb case, stopped at the cap.
    if ((err as { code?: string } | null)?.code === 'ERR_BUFFER_TOO_LARGE') return tooLarge();
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }

  /*
    VALIDATE BEFORE OPENING A RUN.

    A malformed body is a bad request, not a failed collection. Opening a
    sync_log run first meant the app's own reachability probe -- which posts
    `{}` on purpose -- wrote a `failed` row into the run history every time
    someone pressed "test connection", and reported it as a 500. The sync page
    is where you look to find out whether collection is healthy; filling it
    with entries from a button that worked is how that page stops being worth
    reading.
  */
  const problem = payloadProblem(payload);
  if (problem) return NextResponse.json({ error: problem.reason }, { status: problem.status });

  const cfg = loadConfig();
  if (!cfg.databasePath) {
    return NextResponse.json({ error: 'no-database-configured' }, { status: 503 });
  }

  const db = openDatabase(cfg.databasePath);
  const began = Date.now();
  const deviceId = payload.device.deviceId;
  const runId = startSyncRun(db, deviceId, 'android-events');

  try {
    // One transaction for the whole push. A sync is all-or-nothing: a payload
    // that fails halfway would otherwise leave a day with its screen spans
    // stored and its app sessions missing, which reads as a real drop in usage
    // rather than as a failed upload.
    db.exec('BEGIN');
    let result;
    try {
      result = ingestAndroid(db, payload);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    checkpointWal(db);
    let backupStatus: string | null = null;
    if (cfg.backupEnabled && cfg.backupPath) {
      backupStatus = await backupDatabase(db, cfg.backupPath);
    }

    const written = result.sessionSegments + result.screenSegments;
    finishSyncRun(db, runId, {
      status: 'success',
      rowsRead: written + result.rejected,
      rowsInserted: written,
      rowsSkipped: result.rejected,
      sourceOldestUtc: payload.device?.eventsReachUtc ?? null,
      sourceNewestUtc: new Date().toISOString(),
      backupStatus,
      durationMs: Date.now() - began,
      error: null,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncRun(db, runId, {
      status: 'failed',
      rowsRead: 0, rowsInserted: 0, rowsSkipped: 0,
      sourceOldestUtc: null, sourceNewestUtc: null,
      backupStatus: null, durationMs: Date.now() - began, error: message,
    });
    // The phone advances its watermark from what the SERVER confirmed, never
    // from what it sent, so a 500 here means it will retry this window.
    //
    // The detail goes to sync_log (above), where the dashboard's Sync page
    // shows it, and NOT into the response: an internal error can carry file
    // paths and SQL, and the phone only needs to know to retry.
    return NextResponse.json(
      { error: 'ingest-failed', message: 'see the Sync page for details' },
      { status: 500 },
    );
  } finally {
    db.close();
  }
}
