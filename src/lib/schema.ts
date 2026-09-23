/**
 * Database schema.
 *
 * ===========================================================================
 * Every table here was designed AFTER measuring its source, not before. The
 * Phase 1 findings that shaped them, in the order they changed a column:
 *
 *   WINDOWS -- SRUM was rejected outright. Its AppTimelineProvider table is
 *   populated but measures process PRESENCE: 12,792 h summed inside a 160.9 h
 *   window, 439 rows concurrent, top "app" svchost.exe at 5,626 h. There is no
 *   InFocusDuration column at all. So `windows_segments` holds sampler output,
 *   not SRUM rows, and the sampler needed no elevation -- a better outcome
 *   than the table would have given.
 *
 *   ANDROID -- everything comes from queryEvents. The daily-rollup API
 *   (queryAndAggregateUsageStats) was tried and REMOVED: it reported more than
 *   24 hours of foreground time on 88 of 96 days, because it falls back to
 *   coarser buckets outside retention and counts overlapping buckets in full
 *   inside it. Events reach 10.0 days on this device, measured, which is all
 *   the rollup would have covered anyway.
 *
 * THE TRAP, corrected by measurement rather than assumed:
 *
 *   The sum of per-app time does not equal total screen time. The original
 *   guess was that apps overlap and the sum OVERSHOOTS. Measured, it
 *   UNDERSHOOTS -- 0.76x on Android -- because the lock screen, the launcher
 *   and system surfaces hold time no app claims. The overshoot risk is real
 *   but comes from summing the wrong FIELD.
 *
 *   Either way the rule stands: the headline comes from an independent
 *   screen-on measurement and NEVER from SUM() over the app rows.
 *
 * THE WRITE RULES DIFFER PER TABLE and getting them backwards is silent in
 * both directions -- INSERT OR IGNORE freezes a partial reading forever, and
 * MAX() on genuinely distinct rows is merely wasteful. The rule follows from
 * one question: CAN A ROW STILL GROW AFTER IT IS FIRST WRITTEN?
 *
 *   windows_segments  no   -> INSERT OR IGNORE
 *   android_segments  yes  -> upsert MAX()
 *   android_screen    yes  -> upsert MAX()
 *
 * The Windows row is the odd one out, and NOT because its sessions are more
 * "complete" than Android's. It is about where the in-flight span lives: the
 * Windows sampler writes a span only once it has ended and publishes the
 * current one to a heartbeat file that is never ingested, whereas the phone
 * must ship its in-flight session inside the sync payload -- discarding it
 * made "today" read a quarter below Digital Wellbeing's -- and that span
 * comes back longer next sync.
 *
 * MAX() rather than last-write-wins everywhere it applies, so a stale payload
 * arriving late cannot shrink a figure.
 * ===========================================================================
 */

export const SCHEMA_VERSION = 4;

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Schema version and any other single-value bookkeeping.
CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Collector runs.
--
-- This table CAN be written now, because none of the open questions above
-- touch it: a run either read some rows and stored some of them or it failed,
-- whatever the source turns out to be.
--
-- It carries device_id and source from the start, which the sibling project
-- does not. There, the Windows collector was the only writer for months and
-- the Android sync log was bolted on beside it later. Here both halves are
-- known to be coming on day one, and one run history that can be filtered
-- beats two tables that have to be unioned in every query.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 'zephyrus' for the laptop; the phone's own stable id for an Android push.
  device_id         TEXT    NOT NULL,

  -- Which collector wrote this run: win-sampler | android-events. Named
  -- rather than inferred from device_id so a device CAN have more than one;
  -- the SRUM reader and the Android daily-rollup API that once made it two
  -- per device were both measured and dropped (see CLAUDE.md).
  source            TEXT    NOT NULL,

  started_at        TEXT    NOT NULL,
  finished_at       TEXT,
  status            TEXT    NOT NULL,   -- running | success | failed

  rows_read         INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_skipped      INTEGER NOT NULL DEFAULT 0,

  -- The window the SOURCE covered, not the window this run added. Lets the
  -- sync page say "SRUM holds 2026-07-22 onward" independently of how much of
  -- that was new, which is the question you actually ask when checking whether
  -- history is being lost to eviction.
  source_oldest_utc TEXT,
  source_newest_utc TEXT,

  backup_status     TEXT,
  duration_ms       INTEGER,
  error             TEXT
);

-- The sync page reads newest-first and nothing else does, so one index.
CREATE INDEX IF NOT EXISTS idx_sync_log_started
  ON sync_log(started_at DESC);

-- ---------------------------------------------------------------------------
-- Windows foreground segments.
--
-- The sampler emits SPANS (one per uninterrupted focus). This table stores
-- them split at local HOUR boundaries, which is a deliberate trade:
--
--   - local_date and local_hour become exact rather than approximate. A
--     three-hour coding session belongs in three hourly buckets, not filed
--     entirely under the hour it started. Bucketing on the start hour makes an
--     hour-of-day chart quietly wrong for exactly the long sessions that
--     matter most.
--   - local_date is computed from LOCAL time, never UTC. Grouping raw UTC
--     into days shifts every daily total by the offset (6h here), which for
--     screen time puts an evening on the wrong day -- immediately visible to
--     a reader in a way byte counts are not.
--   - The cost is row count: roughly 800/day here, ~300k/year. Trivial for
--     SQLite, and the alternative (splitting at query time) is procedural
--     logic that SQL does badly.
--
-- Session identity survives the split via session_start_utc, so
-- COUNT(DISTINCT session_start_utc) still answers "how many times did I open
-- this app" and MAX over a grouped sum still answers "longest session".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS windows_segments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id         TEXT    NOT NULL,

  -- The parent span's start. Constant across every segment of one session.
  session_start_utc TEXT    NOT NULL,

  -- This segment's own bounds.
  start_utc         TEXT    NOT NULL,
  end_utc           TEXT    NOT NULL,
  duration_ms       INTEGER NOT NULL,

  -- Denormalised local buckets. See the note above.
  local_date        TEXT    NOT NULL,   -- YYYY-MM-DD, machine-local
  local_hour        INTEGER NOT NULL,   -- 0-23, machine-local

  -- app | locked | gap | unknown.
  --
  -- NOT collapsed to "app or not". 'locked' is positive evidence the lock
  -- screen was foreground; 'unknown' means there was no foreground window and
  -- we declined to guess; 'gap' means the machine slept or the sampler was not
  -- running. Screen-on subtracts 'locked' and 'gap' but must be able to REPORT
  -- 'unknown' separately, because a growing unknown share is the signal that
  -- the sampler is mis-seeing the desktop.
  kind              TEXT    NOT NULL,

  -- Full exe path where available, bare process name where the path was
  -- refused. Display-name cleanup lives in code, never here, so the rules can
  -- be corrected without re-ingesting.
  app_path          TEXT    NOT NULL DEFAULT '',

  -- True when the UWP frame-host lookup could not get past
  -- ApplicationFrameHost. Stored so the gap is measurable rather than a silent
  -- misattribution of every store app to one host process.
  unresolved        INTEGER NOT NULL DEFAULT 0,

  -- Idle milliseconds at the end of the parent span. Stored, not applied:
  -- whether "idle but focused" counts as screen time is a policy question,
  -- and keeping the raw number means changing that policy later is a query
  -- change rather than a re-collection. Same reasoning as the sibling
  -- project storing l2_profile_id before it could name networks.
  idle_ms_at_end    INTEGER NOT NULL DEFAULT 0,

  -- A completed span is IMMUTABLE -- it is bounded by a focus change that
  -- already happened -- so re-ingesting the same JSONL inserts zero rows.
  -- This is the INSERT OR IGNORE case, unlike the Android daily rollup, whose
  -- buckets keep filling and need MAX(). Getting those two backwards is
  -- silent in both directions.
  UNIQUE (device_id, session_start_utc, start_utc, kind, app_path)
);

CREATE INDEX IF NOT EXISTS idx_win_seg_date
  ON windows_segments(device_id, local_date);

CREATE INDEX IF NOT EXISTS idx_win_seg_app
  ON windows_segments(device_id, app_path, local_date);

-- ---------------------------------------------------------------------------
-- Android devices.
--
-- The phone reports its own label, so this side needs no curated name table.
-- slug is derived from the LABEL rather than the id, so the URL reads
-- /android/nothing-a001 instead of a hex string; duplicates of one model get a
-- numeric suffix rather than silently sharing a page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS android_devices (
  device_id        TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  model            TEXT NOT NULL DEFAULT '',
  brand            TEXT NOT NULL DEFAULT '',
  android_release  TEXT NOT NULL DEFAULT '',
  sdk_int          INTEGER NOT NULL DEFAULT 0,

  -- The oldest event queryEvents actually returned, as measured BY THE PHONE.
  -- Phase 1 could only see 24h of events through dumpsys, which is a property
  -- of the dump and not of the API. The app measures the real reach and
  -- reports it; until it does, this is empty and nothing should pretend to
  -- know. It decides whether events can be the primary store or only a
  -- high-fidelity recent layer.
  events_reach_utc TEXT,

  first_seen_utc   TEXT NOT NULL,
  last_seen_utc    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- REMOVED: android_daily.
--
-- It held queryAndAggregateUsageStats output and every figure in it was wrong.
-- Measured 2026-08-31 against a real 96-day pull: 88 of 96 days reported more
-- than 24 HOURS of foreground time in a single day, peaking at 478h.
--
-- Two separate defects, both in the API rather than in the parsing:
--
--   1. Outside daily-file retention it silently falls back to the enclosing
--      weekly/monthly/yearly bucket and returns that whole bucket's totals for
--      EVERY day inside it. Hence 29 consecutive days each reporting an
--      identical 236.65h.
--   2. Even inside retention it includes any bucket that OVERLAPS the range,
--      in full rather than clipped, which roughly doubles a day. 2026-08-30
--      reported 16.29h against 8.40h of measured screen-on -- 1.94x, where
--      Phase 1 had measured the true ratio at 0.94x.
--
-- The table existed only because daily rollups were expected to reach further
-- back than events. They do not: the phone measured queryEvents reaching
-- 10.0 days, which is the same ~10 days of daily files. So it bought nothing
-- and cost a whole class of silent corruption.
--
-- Event-derived rows over the same pull: 0 of 11 days exceeded 24h.
--
-- The DROP is unconditional so an existing database sheds the bad rows on next
-- open. Nothing reads this table; do not reintroduce it without re-measuring.
DROP TABLE IF EXISTS android_daily;

-- ---------------------------------------------------------------------------
-- Package labels, as the PHONE reports them.
--
-- The phone is the only thing that can answer package -> label, which is why
-- the Android half needs no curated name table at all. The Windows side has
-- app-name.ts precisely because nothing on that platform will tell you that
-- Claude.exe under a versioned WindowsApps folder is "Claude".
--
-- Labels change (an app rebrands, a locale changes), so this is an upsert on
-- the latest value rather than write-once.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS android_apps (
  device_id     TEXT    NOT NULL,
  package_name  TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  is_system     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, package_name)
);

-- ---------------------------------------------------------------------------
-- Event-derived per-app foreground segments.
--
-- Hour-split like windows_segments, with session identity preserved via
-- session_start_utc.
--
-- WRITE RULE: upsert taking MAX(duration), NOT insert-or-ignore.
--
-- It is tempting to reason "a completed session is immutable, so ignore
-- duplicates" -- that IS true of windows_segments, and it is WRONG here. The
-- difference is where the in-flight session lives:
--
--   Windows  the sampler writes a span only once it has ENDED. The in-flight
--            span goes to a heartbeat file that is never ingested, so the
--            table only ever receives finished spans. INSERT OR IGNORE.
--   Android  the phone sends its in-flight session INSIDE the sync payload,
--            because it must -- discarding it made "today" read a quarter
--            below Digital Wellbeing's. That span comes back LONGER on the
--            next sync, and INSERT OR IGNORE would freeze the first short
--            reading forever.
--
-- MAX() rather than last-write-wins so a stale payload arriving late cannot
-- shrink a session. Only the final segment of a session can grow; the earlier
-- ones are already bounded by an hour edge and are written once.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS android_segments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id         TEXT    NOT NULL,
  session_start_utc TEXT    NOT NULL,
  start_utc         TEXT    NOT NULL,
  end_utc           TEXT    NOT NULL,
  duration_ms       INTEGER NOT NULL,
  local_date        TEXT    NOT NULL,
  local_hour        INTEGER NOT NULL,
  package_name      TEXT    NOT NULL,
  user_profile      INTEGER NOT NULL DEFAULT 0,

  UNIQUE (device_id, session_start_utc, start_utc, package_name, user_profile)
);

CREATE INDEX IF NOT EXISTS idx_android_seg_date
  ON android_segments(device_id, local_date);

CREATE INDEX IF NOT EXISTS idx_android_seg_pkg
  ON android_segments(device_id, package_name, local_date);

-- ---------------------------------------------------------------------------
-- Screen-on and unlocked spans. A SEPARATE TABLE, deliberately.
--
-- ⚠️ These OVERLAP the per-app segments and must never be summed with them.
--
-- On the Windows side one table with a kind column is safe, because a span is
-- either an app or locked or a gap -- the kinds are mutually exclusive and a
-- naive SUM is still meaningful. Here they are NOT: an app session happens
-- DURING screen-on, so one table would make SUM(duration_ms) count the same
-- minutes twice. Separating them means the double count requires writing an
-- explicit JOIN rather than merely forgetting a WHERE.
--
-- This is the headline source. Measured on Android: per-app time UNDERSHOOTS
-- screen-on at 0.76x, because the lock screen, the launcher and system
-- surfaces hold time no app claims. So the headline must come from here and
-- never from SUM() over the app tables.
--
-- kind is 'screen_on' or 'unlocked', and THOSE TWO ALSO OVERLAP -- unlocked
-- time is a subset of screen-on time (measured at 0.96x of it). Every
-- query against this table must filter kind.
--
-- Same MAX(duration) upsert rule as android_segments, and for the same reason:
-- the last screen-on span in any sync is still open.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS android_screen (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id         TEXT    NOT NULL,
  session_start_utc TEXT    NOT NULL,
  start_utc         TEXT    NOT NULL,
  end_utc           TEXT    NOT NULL,
  duration_ms       INTEGER NOT NULL,
  local_date        TEXT    NOT NULL,
  local_hour        INTEGER NOT NULL,
  kind              TEXT    NOT NULL,   -- screen_on | unlocked

  -- True when this span was still OPEN at the moment the phone read it, and
  -- was therefore clipped to "now" rather than closed by a real event.
  --
  -- Not cosmetic. Measured against Digital Wellbeing: discarding the in-flight
  -- span made "today" read a quarter below the phone's own. It must be
  -- counted -- but it is also the one span a later sync legitimately REPLACES
  -- with a longer version, which is why this table upserts on MAX(duration)
  -- rather than ignoring duplicates. Flagged so the sync page can say how much
  -- of "today" is still provisional.
  in_flight         INTEGER NOT NULL DEFAULT 0,

  UNIQUE (device_id, session_start_utc, start_utc, kind)
);

CREATE INDEX IF NOT EXISTS idx_android_screen_date
  ON android_screen(device_id, local_date, kind);
`;
