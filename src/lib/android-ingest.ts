/**
 * Accepting a screen-time push from the phone.
 *
 * NOTE: deliberately NOT marked `server-only`, unlike `config.ts`.
 *
 * That guard exists to stop a module from dragging Node builtins into a client
 * bundle, and this one has nothing to drag: it takes an already-open
 * `DatabaseSync` as an argument and imports it only as a TYPE. What it does
 * hold is the hardest logic in the project -- the MAX-versus-ignore write
 * rules, hour splitting across a half-hour timezone -- and `server-only`
 * throws under tsx, so keeping it here would mean that logic could not be
 * unit-tested from `npm run selftest`. Testability wins over a guard with
 * nothing to guard. The route that calls this is server-side by construction.
 *
 * The phone sends already-derived facts, not raw events: it holds the
 * UsageStatsManager APIs and the PackageManager, and shipping 6,000 raw events
 * per sync to be re-derived on the server would move the reconstruction bugs
 * to the wrong side of the wire. What arrives is daily rollups, per-app
 * sessions, and screen-on spans.
 *
 * ---------------------------------------------------------------------------
 * THE WRITE RULES, and why they are not all the same
 *
 * Every table here upserts on MAX(), and the Windows table next door does not.
 * The question is whether a row can still GROW after it is first written:
 *
 *   android_segments  the app in the foreground when the sync ran has an open
 *                     session that comes back longer next time.
 *   android_screen    likewise -- the screen is on while you hold the phone.
 *
 * INSERT OR IGNORE on any of these freezes the first partial reading forever,
 * and it does so silently. MAX() rather than last-write-wins so a stale
 * payload arriving late cannot shrink a figure.
 *
 * Measured consequence of getting this wrong: discarding the in-flight span
 * made "today" read a quarter below Digital Wellbeing's figure.
 * ---------------------------------------------------------------------------
 */

import type { DatabaseSync } from 'node:sqlite';
import { slugify } from './slug';

const HOUR_MS = 3_600_000;

/* ------------------------------------------------------------------ */
/* The wire format                                                     */
/* ------------------------------------------------------------------ */

export interface AndroidDevicePayload {
  deviceId: string;
  label: string;
  model?: string;
  brand?: string;
  androidRelease?: string;
  sdkInt?: number;
  /** Oldest event queryEvents actually returned, ISO. Measured by the phone. */
  eventsReachUtc?: string | null;
}

export interface AppRow {
  packageName: string;
  label: string;
  isSystem?: boolean;
}

export interface SpanRow {
  /** Epoch ms. */
  start: number;
  end: number;
  packageName?: string;
  userProfile?: number;
  /** screen_on | unlocked, for screen spans only. */
  kind?: string;
  inFlight?: boolean;
}

export interface AndroidPayload {
  device: AndroidDevicePayload;
  /** Device-local UTC offset in minutes, as the PHONE sees it. */
  tzOffsetMinutes: number;
  /**
   * The instant this reading covers up to, epoch ms, as the phone saw it.
   *
   * Echoed back as `acceptedThrough` ONLY if the whole transaction committed,
   * and the phone advances its watermark from that rather than from what it
   * sent. An upload that fails halfway must be retried, not skipped -- and
   * since the route wraps the ingest in one transaction, a confirmation here
   * genuinely means everything landed.
   */
  coverageEndMs?: number;
  sessions?: SpanRow[];
  screen?: SpanRow[];
  apps?: AppRow[];
}

export interface IngestResult {
  deviceId: string;
  slug: string;
  appsWritten: number;
  sessionSegments: number;
  screenSegments: number;
  rejected: number;
  /** ISO echo of coverageEndMs. The phone's next watermark. */
  acceptedThrough: string | null;
}

/* ------------------------------------------------------------------ */
/* Local time, as the PHONE sees it                                    */
/* ------------------------------------------------------------------ */

/**
 * Bucket an instant into the phone's local day and hour.
 *
 * ⚠️ Uses the offset the PHONE reported, never the server's own timezone.
 * They are the same machine today and will not be the first time the phone
 * travels -- and a day boundary computed in the wrong zone silently files an
 * evening's use under the wrong date. The Windows side can use the local zone
 * directly because the sampler and the database are the same machine; this
 * side cannot.
 */
function localBuckets(
  epochMs: number,
  tzOffsetMinutes: number,
): { date: string; hour: number } {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const date =
    `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(shifted.getUTCDate()).padStart(2, '0')}`;
  return { date, hour: shifted.getUTCHours() };
}

/**
 * Split a span at the phone's local hour boundaries.
 *
 * Boundaries are walked rather than stepped by 3,600,000 so a zone whose
 * offset is not a whole number of hours (India, Nepal, parts of Australia)
 * still lands on real clock hours.
 */
export function splitIntoLocalHours(
  startMs: number,
  endMs: number,
  tzOffsetMinutes: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const off = tzOffsetMinutes * 60_000;
  let cur = startMs;
  let guard = 0;
  while (cur < endMs && guard++ < 100_000) {
    // Next local hour edge, expressed back in epoch ms.
    const local = cur + off;
    const nextEdge = Math.floor(local / HOUR_MS) * HOUR_MS + HOUR_MS - off;
    const boundary = Math.min(nextEdge, endMs);
    out.push({ start: cur, end: boundary });
    cur = boundary;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Slugs                                                               */
/* ------------------------------------------------------------------ */

function uniqueSlug(db: DatabaseSync, label: string, deviceId: string): string {
  const base = slugify(label);
  const taken = db
    .prepare('SELECT slug FROM android_devices WHERE slug LIKE ? AND device_id <> ?')
    .all(`${base}%`, deviceId) as { slug: string }[];
  const used = new Set(taken.map((t) => t.slug));
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${deviceId.slice(0, 6)}`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ceilings on what one push may carry.
 *
 * The endpoint is token-gated, so these are not about strangers. They are
 * about a buggy or compromised APK, and about the one thing a token holder
 * could otherwise do to the whole dashboard: send a payload large enough to
 * take the process down, and every page with it. A real ten-day sync is a few
 * thousand sessions and a few hundred labels, so each limit sits an order of
 * magnitude or more above anything a phone produces.
 */
export const PAYLOAD_LIMITS = {
  sessions: 200_000,
  screen: 50_000,
  apps: 20_000,
  deviceIdChars: 128,
  labelChars: 200,
  packageChars: 255,
  metaChars: 100,
} as const;

/**
 * Why a payload cannot be accepted AT ALL, or null when its shape is fine.
 *
 * Whole-payload problems only -- a missing device, an absurd offset, an
 * oversized array. A single bad ROW is not one of these: it is counted in
 * `rejected` and the rest of the push still lands, which is what the phone's
 * status line reports.
 */
export interface PayloadProblem {
  reason: string;
  /** 413 when the payload is merely too big, 400 when it is malformed. */
  status: 400 | 413;
}

export function payloadProblem(p: unknown): PayloadProblem | null {
  const bad = (reason: string): PayloadProblem => ({ reason, status: 400 });
  const L = PAYLOAD_LIMITS;
  const payload = p as Partial<AndroidPayload> | null;
  if (!payload || typeof payload !== 'object') return bad('body must be a JSON object');
  const device = payload.device as Partial<AndroidDevicePayload> | undefined;
  if (!device || typeof device.deviceId !== 'string' || !device.deviceId) {
    return bad('device.deviceId is required');
  }
  if (device.deviceId.length > L.deviceIdChars) return bad('device.deviceId is too long');
  for (const field of ['label', 'model', 'brand', 'androidRelease'] as const) {
    const v = device[field];
    const max = field === 'label' ? L.labelChars : L.metaChars;
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > max)) {
      return bad(`device.${field} must be a string of at most ${max} characters`);
    }
  }
  // Real offsets run from -12h to +14h. Anything outside is a clock bug, and
  // would file every span under the wrong day.
  if (!Number.isFinite(payload.tzOffsetMinutes) || Math.abs(payload.tzOffsetMinutes!) > 15 * 60) {
    return bad('tzOffsetMinutes is required');
  }
  for (const key of ['sessions', 'screen', 'apps'] as const) {
    const v = payload[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return bad(`${key} must be an array`);
    if (v.length > L[key]) {
      return { reason: `${key} has ${v.length} rows; the limit is ${L[key]}`, status: 413 };
    }
  }
  return null;
}

/** A package name the database will accept: present, a string, not absurd. */
function validPackage(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= PAYLOAD_LIMITS.packageChars;
}

/**
 * A span must be finite, ordered, and not absurd.
 *
 * The one-day ceiling is not paranoia about malice -- this endpoint is token
 * gated -- but about a phone whose clock jumped, which produces a single span
 * of implausible length that would then dominate every total it touches.
 */
const MAX_SPAN_MS = 24 * HOUR_MS;

function validSpan(s: SpanRow): boolean {
  return (
    Number.isFinite(s.start) &&
    Number.isFinite(s.end) &&
    s.end > s.start &&
    s.end - s.start <= MAX_SPAN_MS
  );
}

/* ------------------------------------------------------------------ */

export function ingestAndroid(db: DatabaseSync, payload: AndroidPayload): IngestResult {
  const { device, tzOffsetMinutes } = payload;
  const problem = payloadProblem(payload);
  if (problem) throw new Error(`payload rejected: ${problem.reason}`);

  const now = new Date().toISOString();
  const label = device.label?.trim() || 'Android device';
  const slug = uniqueSlug(db, label, device.deviceId);

  let rejected = 0;

  db.prepare(
    `INSERT INTO android_devices
       (device_id, slug, label, model, brand, android_release, sdk_int,
        events_reach_utc, first_seen_utc, last_seen_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       -- NULLIF/COALESCE on every descriptive field, so a payload that omits
       -- one does not ERASE it.
       --
       -- Found by re-pushing a minimal body during testing: android_release
       -- went from "16" to "". Device metadata is sent for the reader's
       -- benefit and a sync that only carries spans has no reason to restate
       -- it, so a bare excluded.x here quietly empties the sidebar.
       slug            = COALESCE(NULLIF(excluded.slug, ''), slug),
       label           = COALESCE(NULLIF(excluded.label, ''), label),
       model           = COALESCE(NULLIF(excluded.model, ''), model),
       brand           = COALESCE(NULLIF(excluded.brand, ''), brand),
       android_release = COALESCE(NULLIF(excluded.android_release, ''), android_release),
       sdk_int         = CASE WHEN excluded.sdk_int > 0 THEN excluded.sdk_int ELSE sdk_int END,
       -- ⚠️ The LAST measurement wins. It used to be MIN(stored, incoming) --
       -- "keep the furthest reach ever observed", so that a short reading
       -- taken right after a reboot could not spoil the figure.
       --
       -- That pinned an ABSOLUTE TIMESTAMP forever, and the Sync page reports
       -- the span from it, so the figure could only ever grow: it read 10.0
       -- days at the first sync and 12.1 days twelve days later, off a value
       -- that had not moved since. The card's own note says "if this figure
       -- falls, sync more often" -- under MIN it could not fall, which made
       -- the one number the Android design rests on unable to report the one
       -- thing it exists to warn about.
       --
       -- The reboot worry does not justify that. A short reading is corrected
       -- by the next sync, and a reach that really has shortened is exactly
       -- what the card is for.
       events_reach_utc = COALESCE(excluded.events_reach_utc, events_reach_utc),
       last_seen_utc = excluded.last_seen_utc`,
  ).run(
    device.deviceId, slug, label, device.model ?? '', device.brand ?? '',
    device.androidRelease ?? '', device.sdkInt ?? 0,
    device.eventsReachUtc ?? null, now, now,
  );

  /* --- package labels ------------------------------------------- */
  //
  // Replaces the removed daily rollup. The phone is the only thing that can
  // map a package to the name a person recognises, which is why this side
  // needs no curated table at all -- unlike Windows, where app-name.ts has to
  // do real work on exe paths.
  const app = db.prepare(
    `INSERT INTO android_apps (device_id, package_name, label, is_system)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id, package_name) DO UPDATE SET
       label = COALESCE(NULLIF(excluded.label, ''), label),
       is_system = excluded.is_system`,
  );

  let appsWritten = 0;
  for (const row of payload.apps ?? []) {
    if (
      !validPackage(row.packageName) || typeof row.label !== 'string' || !row.label ||
      row.label.length > PAYLOAD_LIMITS.labelChars
    ) { rejected++; continue; }
    app.run(device.deviceId, row.packageName, row.label, row.isSystem ? 1 : 0);
    appsWritten++;
  }

  /* --- app sessions: hour-split, MAX() upsert -------------------- */
  const seg = db.prepare(
    `INSERT INTO android_segments
       (device_id, session_start_utc, start_utc, end_utc, duration_ms,
        local_date, local_hour, package_name, user_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, session_start_utc, start_utc, package_name, user_profile)
     DO UPDATE SET
       end_utc     = MAX(end_utc,     excluded.end_utc),
       duration_ms = MAX(duration_ms, excluded.duration_ms)`,
  );

  let sessionSegments = 0;
  for (const s of payload.sessions ?? []) {
    if (!validSpan(s) || !validPackage(s.packageName)) { rejected++; continue; }
    const sessionStart = new Date(s.start).toISOString();
    for (const piece of splitIntoLocalHours(s.start, s.end, tzOffsetMinutes)) {
      const { date, hour } = localBuckets(piece.start, tzOffsetMinutes);
      seg.run(
        device.deviceId, sessionStart,
        new Date(piece.start).toISOString(), new Date(piece.end).toISOString(),
        piece.end - piece.start, date, hour,
        s.packageName, s.userProfile ?? 0,
      );
      sessionSegments++;
    }
  }

  /* --- screen spans: separate table, same MAX() rule ------------- */
  const scr = db.prepare(
    `INSERT INTO android_screen
       (device_id, session_start_utc, start_utc, end_utc, duration_ms,
        local_date, local_hour, kind, in_flight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, session_start_utc, start_utc, kind) DO UPDATE SET
       end_utc     = MAX(end_utc,     excluded.end_utc),
       duration_ms = MAX(duration_ms, excluded.duration_ms),
       -- Once a span is closed by a real event it stays closed, even if an
       -- older payload still believed it was open.
       in_flight   = MIN(in_flight,   excluded.in_flight)`,
  );

  let screenSegments = 0;
  for (const s of payload.screen ?? []) {
    const kind = s.kind === 'unlocked' ? 'unlocked' : 'screen_on';
    if (!validSpan(s)) { rejected++; continue; }
    const sessionStart = new Date(s.start).toISOString();
    for (const piece of splitIntoLocalHours(s.start, s.end, tzOffsetMinutes)) {
      const { date, hour } = localBuckets(piece.start, tzOffsetMinutes);
      scr.run(
        device.deviceId, sessionStart,
        new Date(piece.start).toISOString(), new Date(piece.end).toISOString(),
        piece.end - piece.start, date, hour, kind,
        s.inFlight ? 1 : 0,
      );
      screenSegments++;
    }
  }

  const acceptedThrough =
    Number.isFinite(payload.coverageEndMs) && (payload.coverageEndMs ?? 0) > 0
      ? new Date(payload.coverageEndMs as number).toISOString()
      : null;

  return {
    deviceId: device.deviceId, slug, appsWritten, sessionSegments,
    screenSegments, rejected, acceptedThrough,
  };
}
