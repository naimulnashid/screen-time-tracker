# CLAUDE.md — orientation for future Claude Code sessions

Read this first, and read the **Status** section before believing anything
else.

Phase 1 is done on both halves, so most of the numbers below were **measured on
this machine and this phone**, with the script that produced them named beside
them. Where something is still a guess, it says so — and one Phase 0 guess has
already been corrected by measurement (see the trap section), so treat
unmeasured claims here with the same suspicion that correction earned.

## Status

| Phase | | |
|---|---|---|
| **0** | Scaffold: repo, config, auth, shell, duration formatting, `sync_log` | ✅ done |
| **1a** | Measure the Windows source | ✅ **done — SRUM cannot do this, see below** |
| **1b** | Measure the Android sources over adb | ✅ **done 2026-08-31** |
| **2** | Android: APK, ingest, dashboard pages | ✅ **done 2026-08-31** |
| **3** | Windows: foreground sampler + dashboard pages | ✅ **done 2026-08-31** |
| **4** | Reset drill | ✅ **done 2026-08-31** |

Approval-gated — stop and confirm between each.

**The Windows question is closed.** SRUM's `AppTimelineProvider` is populated
but measures process presence, not focus, and retains only 7 days. Phase 3 is a
`GetForegroundWindow` sampler, which needs **no elevation at all** — a strictly
better position than the sibling project's collector is in. Full measurements
under *Where the data comes from*.

**Phase 1 is complete on both halves.** Android measurements are below;
`npm run android:capture` (phone on USB) then `npm run android:analyze` (no
device needed) reproduces every figure.

**The Digital Wellbeing check has been run, and it found two real bugs.** The
first comparison read more than five times the phone's own figure; the second,
after fixing the window, a quarter too low. Both gaps were the reconstruction's fault, not
the phone's - see *Two traps in reconstructing time from events*. After both
fixes the two agree. **Re-run that comparison after any change to the event
reconstruction**; it is the only external check this project has.

## What this is

A **local-only** dashboard over per-app **screen time** — how long each program
was actually in the foreground — for a Windows laptop and an Android phone.

It is the sibling of **Data Usage Tracker**, deliberately. That project answers
"how many bytes did this app move"; this one answers "how long did I look at
it". Same stack, same shape, same reset-survival goal, different measurement.

Both dashboards run at once, on adjacent ports:

| | Data Usage Tracker | Screen Time Tracker |
|---|---|---|
| Port | 7843 | **7844** |
| Database | `D:\PersistentData\data-usage\` | `D:\PersistentData\screen-time\` |
| Scratch | `D:\DataUsage-scratch` | `D:\ScreenTime-scratch` |
| Laptop accent | Tech Blue | **Violet `#7C5CFF`** |
| Session cookie | `datausage_session` | **`screentime_session`** |

Those last three rows are not cosmetic. See **Living beside the sibling**.

## The single most important fact

**The database must not live on `C:\`.** Same rule, same reason, same guard as
the sibling project — `openDatabase()` refuses a path under the system drive
and throws. A Windows reset destroys `C:\`, and surviving that is the entire
point.

`D:\PersistentData` is mirrored to Google Drive by the Drive desktop client.
The live database and a `backup()`-written sibling file sit there; **restore
from the backup, never the live file**, because in WAL mode a database is three
files that a sync client can upload at three different instants. All of this is
inherited wholesale from the sibling project's `CLAUDE.md`, which explains it at
length.

### Backups are serialised, and a lost race is `busy`, not `failed`

Two collectors can call `backupDatabase()` at once -- two phone pushes 20 ms
apart did on 2026-09-04, and the hourly ingest task and a phone push are
separate PROCESSES besides. **MEASURED that day, in one process and across
four, on a 65 MB database: the destination is never at risk.** SQLite's locking
lets exactly one backup win and the losers fail BEFORE writing a byte;
`integrity_check` came back ok and complete on every run.

⚠️ **The loser's error message is nonsense, and it reached `sync_log`.** It
reports errcode 261 (`database is locked`) or errcode **0**, which node:sqlite
renders as `"not an error"` -- SQLite set no code at all. `failed: not an
error` on the sync page reads as a bug in the reporting rather than as
contention, which is how it went unexplained for days.

So there are three outcomes and they get three words:

| | |
|---|---|
| `ok` | the file was written |
| `busy` | another backup held it; the FILE is good, these ROWS are not in it |
| `failed` | something real -- a full disk, a bad path |

`busy` is deliberately not `ok`: the winning backup may have started before
this caller committed, so its rows are safe only in the live database until the
next backup. Callers queue rather than race, and a lock lost to another process
is retried four times on a 250 ms ladder before it gives up.

**Do not widen `isBackupContention()` to catch a stubborn error.** The
permissive direction is the dangerous one -- a real, recurring failure
reclassified as contention becomes four silent retries and a `busy`, and the
backup this project exists for stops being written with nothing saying so.

## ⚠️ The trap that defines this project

**The sum of per-app screen time DOES NOT equal total screen time, and there is
no aggregate row to check it against.**

This is the mirror image of the sibling project's `AppId = 1` trap, and it is
worse, because that one was *detectable*: SRUM writes an aggregate row whose
bytes equal the sum of the named apps, so adding them double-counted and the
error announced itself as a figure roughly twice what Windows reported.

Here there is no such row. **Measured 2026-08-31, the mechanism is not the one
this section originally guessed**, and the correction matters because it points
at a different defence.

The guess was that apps overlap and the sum overshoots. On Android, per-app
session time reconstructed from events actually **undershoots** screen-on time
— 0.76x, over a 24-hour window. `ACTIVITY_RESUMED` /
`ACTIVITY_PAUSED` really is close to exclusive, and the missing quarter is the
lock screen, the launcher between apps, and system surfaces.

**The overshoot comes from picking the wrong FIELD, not from overlapping apps.**
Same device, same day:

| Sum over all packages | vs screen-on |
|---|---:|
| `totalTimeUsed` (foreground) | 0.94x — sane |
| `totalTimeVisible` (API 29+) | 0.95x — 1.0% above used |
| **`totalTimeFS`** (foreground *service*) | **2.07x — nonsense** |

`com.niksatyr.volumecontroller` reports `used=0m` and `FS=16h18m`. It is a
volume widget with a background service. Include foreground-service time and a
volume widget becomes the day's top "screen time" entry.

**So the rules are:**

1. **The headline comes from `SCREEN_INTERACTIVE` / `SCREEN_NON_INTERACTIVE`
   event pairs**, never a `SUM()` over the app table. Not because the sum
   overshoots, but because it *undershoots* — apps genuinely do not account
   for all screen-on time, and a headline built from them under-reports.
2. **Per-app screen time is `totalTimeUsed` only.** Never `totalTimeFS`, and
   never the two added.
3. **Deduplicate across users.** The dump carries a section per Android user
   and 1,206 of 6,739 event lines were the same system event repeated under a
   second profile. Summing them doubles those.

The Windows sampler has no equivalent ambiguity — it records exactly one
foreground window at a time — but it will need its own screen-on/lock signal
for the same headline reason.

## Where the data comes from

### Android — the strong half

`UsageStatsManager`, on the phone, is the direct analogue of the sibling's
`NetworkStatsManager`. The existing Data Usage reporter app **already holds
`PACKAGE_USAGE_STATS`**, which is exactly the permission screen time needs — so
the permission dance, the uid→package→label resolution, the JobScheduler and
the upload path are all already solved and proven on this device.

#### MEASURED 2026-08-31, Nothing A001, Android 16 / API 36

**Retention, from the on-disk file lists — this is what sets the cadence:**

| Granularity | Files | Reaches back to |
|---|---:|---|
| **daily** | **10** | 2026-08-21 (~10 days) |
| weekly | 4 | 2026-08-06 |
| monthly | 6 | 2026-03-03 |
| yearly | 2 | 2025-07-31 |

**Per-day resolution survives about ten days.** Older history exists only as
weekly/monthly/yearly rollups, which cannot draw a daily chart. So the
collector must run well inside ten days — the sibling project's 6-hour job is
comfortably enough, and the same rule applies: collect faster than eviction,
not faster than writing.

**`queryEvents` reaches 10.0 days — ANSWERED 2026-08-31 by the APK.** dumpsys
showed 23.9 h, but that was the *dump's* "Last 24 hour events" section, not the
API's limit. The app measures the real reach every sync (`measureEventReach`)
and reports it, because the answer can change and a one-off number would go
stale.

Ten days matches the daily-file retention, which is what makes events the
**only** source this project uses — see below.

**The event vocabulary is complete**, which is the good news — everything
Digital Wellbeing derives its number from is here:

```
ACTIVITY_RESUMED 1056   ACTIVITY_PAUSED 1055   ACTIVITY_STOPPED 1007
SCREEN_INTERACTIVE 400  SCREEN_NON_INTERACTIVE 400
KEYGUARD_SHOWN 254      KEYGUARD_HIDDEN 254
USER_INTERACTION 176    FOREGROUND_SERVICE_START/STOP 109
```

`DEVICE_SHUTDOWN` and `DEVICE_STARTUP` are **absent**, so a session open when
the phone powers off has no closing event. Reconstruction must tolerate a
dangling open rather than treating it as an error — `pairedDuration()` in
`phase1-android-analyze.ts` counts one dangling open per stream and discards it.

**`totalTimeUsed` does NOT balloon with the screen off on this device.** It
summed to 0.94x of screen-on, and `totalTimeVisible` was only
1.0% higher. The screen-off-accrual worry that makes third-party apps disagree
with Digital Wellbeing did not reproduce here. Re-check it if the device or
Android version changes; do not assume it holds everywhere.

#### Two traps in RECONSTRUCTING time from events

Both were found by comparing against Digital Wellbeing, and neither would have
been found any other way. Together they made "today" read a quarter below
the phone's own figure — low, and plausible enough to ship.

**1. ⚠️ COUNT THE IN-FLIGHT SESSION, clipped to the moment of observation.**

The screen is almost always ON when you take a capture — you are holding the
phone. That last `SCREEN_INTERACTIVE` has no matching `SCREEN_NON_INTERACTIVE`
yet, and discarding it loses however long the current session has run.

The two ends of the stream are **not symmetrical**:

| | |
|---|---|
| CLOSE with no matching open | **discard** — it began before the window, start unknown |
| OPEN with no matching close | **count it**, clipped to now — start is known, time is real |

Caught by capturing twice seven minutes apart: the per-app sum grew by eight
minutes while screen-on stayed frozen. **A figure that does not move
while its own components do is the tell.** After the fix, screen-on picked up a
36-minute in-flight session.

This also answers the question left open for the Windows sampler — whether it
persists the in-flight session or writes only on focus change. It **must**
count it, or every "today" figure under-reports all day and only becomes
correct once you put the machine down.

**2. A rolling 24-hour window is not a calendar day.**

The first comparison against Digital Wellbeing was more than five times the
phone's figure and looked catastrophic. It was not an error at all: ours
covered a rolling 24h spanning two dates, while the phone reports *today*,
which shortly after midnight was under two hours old. Bucketing screen-on per **local** calendar day, splitting
intervals at midnight, made the two comparable.

This is the same denormalisation the schema needs (`local_date`), and it is
worth more here than on the network side: an evening's use lands on the wrong
day under UTC bucketing, and a screen-time reader notices immediately.

#### Four traps in the `dumpsys usagestats` format

These bite the *validation* path only. The `UsageStats` API returns proper
milliseconds, so the Phase 2 APK does not inherit them — but every figure above
was read through these, so they are load-bearing for trusting the figures.

**1. Durations are rendered, and the rendering is ambiguous.**

```
totalTimeUsed="10:52"   ->  10 minutes 52 seconds
totalTime="12:30:14"    ->  12 hours 30 minutes 14 seconds
```

`DateUtils.formatElapsedTime` drops the hours field when it is zero, so field
*count* decides the unit. Reading `"10:52"` as `h:mm` is wrong by 60x, and
wrong in the direction that makes a phone look used all day. Parse right to
left: seconds, minutes, hours.

**2. The field is `totalTimeUsed`, not `totalTime`.** A probe for `totalTime=`
finds **14** matches — all of them `config=` rows, which record screen
orientation — and misses all **645** package rows. Exactly the sibling
project's `SidType` / `Sid` mistake in a new costume: match exact names.

**3. There are four time fields per package** and only one is screen time:
`totalTimeUsed` (foreground), `totalTimeVisible` (API 29+, a different number),
`totalTimeFS` (foreground *service*), plus `lastTime*` variants. See the trap
section above for what including `totalTimeFS` does.

**4. The dump contains one section per Android user.** Two `In-memory daily
stats` blocks and two `Database Summary` blocks appear here; the second profile
held 6 packages and zero time, but 1,206 event lines were duplicated across
both. Deduplicate identical `time`/`type`/`package` triples.

### Windows — SETTLED 2026-08-31: SRUM cannot do this. Build a sampler.

**`AppTimelineProvider` is populated, and it is not screen time.** Both halves
of that were measured, not assumed, and the second one is the important one.

The probe (`scripts/research/phase1-probe-windows.ps1`, elevated) and the analysis
(`npm run atp`, unelevated) found:

| | |
|---|---|
| Rows | 46,243 over 522 distinct apps |
| Retention | **6.7 days** (2026-08-24 → 2026-08-30) |
| Columns | **12, and NO `InFocusDuration`** |

SrumECmd 2026.5.0 surfaces only `Id, Timestamp, ExeInfo, ExeInfoDescription,
ExeTimestamp, SidType, Sid, UserName, UserId, AppId, EndTime, DurationMs`. The
foreground columns the table is famous for are simply not there.

**`DurationMs` is process presence, not focus.** Four independent measurements,
any one of which is disqualifying:

| Test | Result |
|---|---|
| Budget | sum is **12,792 h** inside a **160.9 h** window — **79.5x over**, 1,909 h/day |
| Concurrency | **439** rows live at one instant (1,159 under the other reading) |
| Coverage | union is 69.1 h, 43% of the window — 10.3 h/day, i.e. "the machine was on" |
| Top app | **`svchost.exe`, 5,626 h across 15,922 rows** |

`svchost.exe` is a service host. Nobody has ever looked at it. The rest of the
top twenty is `WmiPrvSE`, `conhost`, `dwm`, `taskhostw`, `nvcontainer` — the
list is background infrastructure, which is exactly what per-process activity
looks like and nothing like what a person did.

**Do not try to rescue this with a custom ESE parser.** The underlying table
may well still hold `InFocusDuration`, with SrumECmd merely not emitting it.
Chasing that is a bad trade anyway: retention here is **7 days**, so even a
perfect read would lose history within a week of any collector outage, and the
sibling project already rejected hand-writing an ESE parser for good reasons.

**Phase 3 is therefore a foreground-window sampler**, and that is a better
outcome than the SRUM path would have been:

- **It needs no elevation.** No VSS, no `esentutl`, no dirty-shutdown recovery,
  no 99 MB copy per run. The sibling collector's entire elevated apparatus
  disappears. A per-logon task is enough.
- **Retention becomes ours**, not Windows' 7 days.
- **It is exact.** Poll `GetForegroundWindow` on a short interval and the
  answer is definitionally the thing in focus, with no inference.
- Its rows are **sessions**, not hourly buckets, so the dedup rule is
  `INSERT OR IGNORE` on a completed session — the immutable case.

The cost is that it only records from the moment it is installed; there is no
history to backfill. Given SRUM would have offered 7 days of the wrong number,
that is not much of a loss.

### `EndTime` precedes `Timestamp` — a trap for anyone re-reading this table

`EndTime` is never *after* `Timestamp`: equal in 66% of rows, earlier in 34%.
So `Timestamp` is when the row was **written** and `EndTime` is when the
measured period **ended**; the interval is `[EndTime - DurationMs, EndTime]`.

The first version of `phase1-analyze-atp.ts` assumed a forward
`[Timestamp, EndTime]` interval and reported **peak concurrency 0** and
**negative coverage** — both impossible, and both the same bug. Impossible
output is a gift; it fails loudly. A subtler wrong assumption here would have
produced merely *wrong* numbers.

### UserAssist — measured, and deliberately not used

`HKCU\...\Explorer\UserAssist\{CEBFF5CD-...}\Count` really does carry focus
time, and it reads **unelevated**. Decoded 2026-08-31 (names are ROT13; the
Win7+ value is a 72-byte struct with `RunCount` at 0x04, `FocusCount` at 0x08
and `FocusTime` ms at 0x0C):

The decoded values looked like plausible per-app focus minutes for browsers,
editors and media players. 295 entries total. **Rejected as a primary source** for three reasons: it is
cumulative since install with **no time series**, it only records
Explorer-launched GUI apps, and `UEME_CTLSESSION` is a session counter
rather than an app.

**It is not even a durable cumulative — re-read 2026-09-02, every figure above
had SHRUNK by roughly 10x.** Same machine, same install, two days later,
every entry had fallen by about an order of magnitude, `UEME_CTLSESSION`
included, while the entry count rose from 295 to 351. Entry *count* grew while the times fell, so this
is a counter reset rather than a pruning. A cumulative-since-install number
that quietly restarts is worse than no baseline at all, because nothing about
the value says when it started counting. Do not quote its figures as ground
truth for anything.

⚠️ **The decode is case-sensitive.** PowerShell's `-match` is
case-INSENSITIVE, so a ROT13 that tests `$c -match '[a-z]'` sends uppercase
letters down the lowercase branch and garbles every name — `MSEdge` came out
as `gS_dge`, which reads like a corrupt registry value rather than a bug in
the reader. Use `-cmatch`.

### There is NO Windows backfill. The laptop's history starts 2026-08-31.

Asked 2026-09-02: Windows was installed **2026-06-28**, so where is the
screen time for the 64 days before the sampler existed? **Nowhere.** Every
candidate on this machine was probed rather than assumed, and each one fails
for a different reason — which is worth recording, because the question is
obvious enough to be asked again.

| Source | Reaches back to | Why it cannot answer |
|---|---|---|
| `windows_segments` (the sampler) | **2026-08-31** | the only real screen time this project has |
| SRUM `AppTimelineProvider` | ~7 days | process presence, not focus — settled above |
| `ActivitiesCache.db` (Timeline) | rows to 2023 | **866 rows, ALL zero-duration** |
| UserAssist | since install, in principle | cumulative, no series, and it resets — above |
| Prefetch | — | launch counts, never duration |
| System event log | 2026-07-05 | boot/sleep/wake: machine-on, not per-app |
| `powercfg /batteryreport` | 2026-07-04 | weekly ACTIVE totals, not per-app |
| sibling `data-usage.db` | **2026-06-27** | per-app and per-hour — but **bytes** |

**Windows Timeline is dead, not merely empty.** `ActivitiesCache.db` is a live
SQLite file (5.6 MB, written today) and it looks promising right up until you
sum it: **every row has `EndTime == StartTime`**. The surviving
`ActivityType`s are 11, 12 and 15; the two that carry focus — 5
(*Open App/File/Page*) and 6 (*App In Use*) — are **absent**, because Windows 11
removed the collection along with the Timeline UI. A row still lands for
today's date, so the file passes every liveness check while carrying zero
duration.

**`powercfg /batteryreport` ignores `/duration`.** Asked for 7, 14 and 30
days it returned the **identical 19 rows** every time: weekly buckets from
07-04, then daily rows for the last ~11 days only. There is no flag that buys
per-day resolution further back, so the shape of that table is fixed and
cannot be widened.

**The sibling's database is the near-miss, and it must stay a near-miss.**
`usage_records` covers **2026-06-27 to 2026-09-02, 66 days**, per app, per
hour — the exact range and the exact grain this project wants. It measures
**bytes**. Turning bytes into minutes-in-focus would be inventing the number,
and background updaters and `svchost` are the loudest rows in it. That is the
same mistake as `totalTimeFS` and as summing SRUM's aggregate row, arriving
in the friendliest costume yet: a table that already has the right columns.

**So nothing is backfilled, and `windows_segments` keeps meaning exactly one
thing — foreground time this project measured itself.** A proxy folded in
under a `source` column would make every pre-08-31 figure on the dashboard
unfalsifiable. The laptop's history is short and true, and gets longer daily.

## The dedup rules will differ per source — plan for three

The sibling project has exactly one dedup rule per platform and both are
already subtle. This project is likely to need three, and mixing them up is the
kind of error that is invisible until the numbers have been wrong for a month.

| Source | A row is | Rule |
|---|---|---|
| Android daily rollup | a **still-filling** bucket | upsert `MAX()` — a later read supersedes |
| Android event sessions | a **completed** session | `INSERT OR IGNORE` — immutable |
| Windows sampler | a **completed** focus session | `INSERT OR IGNORE` — immutable |

The Windows row was settled on 2026-08-31 along with the source itself: a
sampler emits a session only once it has ended, so it is the immutable case.
The one row still genuinely open is whether the *in-flight* session gets
written at all, or is only persisted on focus change — which decides whether
the current app appears on the dashboard before you switch away from it.

The sibling's own note is worth re-reading: on SRUM, bytes belong **in** the
dedup key and `INSERT OR IGNORE` is correct; on `NetworkStats`, bytes must be
**out** of the key and the write is a `MAX()` upsert. Both mistakes are silent.

## Living beside the sibling

Two dashboards for the same two devices on one machine. Three collisions found
while scaffolding, two of them real:

**1. The session cookie MUST have a different name.** ⚠️ **Cookies are scoped
by HOST, not by origin — the port is not part of the key.** So
`localhost:7843` and `localhost:7844` share one cookie jar, and two dashboards
both using `datausage_session` would overwrite each other's session on every
login. With different passwords the symptom is especially nasty: signing into
one silently signs you out of the other, and it reads as sessions expiring at
random. Hence `screentime_session`.

Note the sibling's `CLAUDE.md` says "the cookie is per-ORIGIN" — that is about
two different *hosts* (`localhost` vs a LAN address) and does **not** extend
to ports.

**2. `localStorage` does NOT collide.** It *is* partitioned by port. The
sidebar key is namespaced anyway, but only for the human reading DevTools.

**3. Scratch directories must not be shared.** Both collectors may hold a
~99 MB VSS copy of `SRUDB.dat` at once, under the same filename. One directory
is a race that fires only when the two scheduled tasks overlap — rarely, and
unreproducibly.

**Accents**: the laptop moves blue → violet so the two dashboards are
distinguishable at a glance; the phone stays Android green, because green
identifies the *device* and is worth keeping stable across both projects. The
favicon is a clock rather than a recoloured bar chart — at 16px in a tab strip,
hue alone is not enough. All of this reasoning lives in `src/lib/accent.ts`,
which remains **the only place any accent hex appears**.

## Durations are not bytes

`src/lib/format.ts` is the one piece of genuinely new logic in Phase 0.

Bytes have one ladder with one base and one rung is always enough — `1.09 TB`
says everything. Durations have a **mixed-radix** ladder (60s, 60min, 24h)
where one rung routinely is not: `6h` threw away 42 minutes, and `6.7h` is
precise and unreadable because nobody thinks about their day in decimal hours.

So `splitDuration()` returns **two rungs**, and callers that want one number
have to ask. Chart axes are the one place a single rung is right, and they
format their own ticks with `hourTick()` in `axis.ts`.

**The ladder stops at hours — there is no day rung.** A multi-day total reads
`51h 12m`, not `2d 3h`. Partly because screen time is judged against a 24-hour
day, so hours need no unpacking; mostly because `d` is already spoken for on
these pages as a **count of calendar days** ("11 days of data", the `Days`
column), and one letter meaning two different quantities on one page is a trap.
Anything else that reports a span — the `queryEvents` reach on the Sync page —
follows the same rule.

The count-up animation needs `formatDurationLike(current, final)`: re-formatting
the in-flight value makes it change *shape* as it climbs, so a total ending at
"6h 42m" would race through "3s", "2m 10s", "58m 4s" and only settle into hours
at the end. Locking the shape to the final value is the same fix as the
sibling's `scaleToFinalUnit`, with two rungs to hold still instead of one.

`formatElapsed()` measures a collector *run* and is deliberately named apart
from `formatDuration()`, which measures a person. They want opposite precision.

## Traps found while scaffolding

**Do not run the dev server from an 8.3 short path.** Using
`C:\Users\<you>\CLAUDE~2\SCREEN~1` as the working directory crashes Next's
file watcher on startup:

```
Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72
```

That is libuv comparing a watch event's path against the watched directory and
finding they disagree because one is short-form. The long path works fine. This
matters because the project directory contains spaces, and a short path is the
obvious workaround when something mangles them — it starts, prints "Ready", and
then dies.

**`npm --prefix` through `.claude/launch.json` does not survive spaces.** The
args reach `cmd.exe` unquoted and it fails with `'C:\Program' is not
recognized`. Run the dev server from the project's own directory instead.

**`$PSScriptRoot` is EMPTY inside a `param()` block.** It is not populated
until the script body runs, so a default of `"$PSScriptRoot\helper.ps1"`
expands to `"\helper.ps1"`. Measured 2026-08-31:

```
in param() default : '\thing.ps1'
in script body     : 'C:\Users\<you>\AppData\Local\Temp\thing.ps1'
```

This bit `phase1-probe-windows.ps1` on its first real run. The failure message
was `srum-recover.ps1 not at \srum-recover.ps1`, which reads as a missing file
rather than an unpopulated variable — so the instinct is to go looking for the
helper, which is sitting right there. **Default such a parameter to `''` and
resolve it in the body.**

## Stack

Matches the sibling deliberately, so the two projects stay legible together.

- **Next.js 16** (App Router, Turbopack builds) + **React 19** + **TypeScript 5**
  - Moved from 15 on 2026-09-23, A/B tested against a Next 15 build of the
    same commit: every page, the auth rewrite, the headers and the redirects
    behaved identically.
  - **The auth gate is `src/proxy.ts`**, exporting `proxy`. Next 16 renamed
    the `middleware.ts` convention and now runs it on Node, not Edge. Older
    notes in this file and in the DEVLOG say "middleware"; that means this
    file.
  - **`next build` rewrites `tsconfig.json`** if `jsx` is not `react-jsx` or
    `.next/dev/types/**/*.ts` is missing from `include`, and reformats every
    array while it is there. Both values are now in the file, so it is left
    alone.
  - **TypeScript stays on 5.** Dependabot ignores its major versions:
    TypeScript 7 failed CI on 2026-09-23 (it rejects the untyped
    `import './globals.css'`), and `next build` type-checks through the
    compiler's JS API, which 7 may not provide yet. Move by hand, together
    with Next.
- **Recharts** for charts, **Geist** for type
- **`node:sqlite`** — Node's *built-in* SQLite. **Not `better-sqlite3`.** A
  native module with a node-gyp build step is the most likely thing to break on
  a clean `npm install` years from now, which is exactly the scenario this
  project exists for. It also exposes `backup()`.

## Layout

```
config/
  collector.json            LOCAL ONLY: every path; nothing hardcodes D:\
  app-colours.json          LOCAL ONLY: brand colours for the local logos
  *.example.json            the committed shapes of both
public/apps_logo/           LOCAL ONLY apart from its README
android/                    the Screen Time Reporter APK (Kotlin, no deps)
scripts/
  sampler.ps1               the foreground-window sampler (Phase 3)
  ingest-windows.ts         JSONL -> SQLite, hourly and on "Sync now"
  install-*.ps1, *.vbs      the three logon/hourly tasks, all hidden
  backup-recovery-kit.ps1   code bundle, secrets, local-only files off C:\
  reset-drill.ts, restore.ps1
  firewall-private-only.ps1 block 7844 on Public networks (Administrator)
  selftest.ts               npm run selftest
  measure-logo-*.ts, distribute-logos.ts, vacuum-svg-defs.ps1
  research/                 the Phase 1 measurements this file quotes;
                            not needed to run anything
src/
  lib/
    accent.ts        the ONLY place an accent hex exists
    auth.ts          Web Crypto only - pulled into the proxy
    login-throttle.ts, safe-next.ts   the sign-in hardening
    config.ts        reads collector.json, once
    db.ts, schema.ts node:sqlite, backup, sync_log, DDL
    queries.ts, android-queries.ts    read-only page queries
    windows-ingest.ts, android-ingest.ts   the two write paths
    app-name.ts, app-logo.ts, app-colour.ts   naming, logos, colours
    format.ts, axis.ts, chart-summary.ts, page-title.ts
    visits.ts, trend.ts, heatmap.ts, app-list.ts, scope.ts, nav.ts, slug.ts
    home-surface.ts  which Android packages are launchers, not apps
    sampler-status.ts  reads the sampler's heartbeat for the Sync page
  components/        Shell, Sidebar, Nav, ScopeBar, Charts, ...
  app/               (dash) route group + /login outside it
                     /windows/<slug>/* and /android/<slug>/*; the old
                     bare /, /apps, /sync survive as redirects
  proxy.ts           the single auth gate, the cross-origin check, and the
                     400 for a malformed path
```

`scripts/research/srum-recover.ps1` is a **copy** of the sibling's, not a reference to
it. Cross-repo dot-sourcing would mean this repo could not be restored and run
on its own, which defeats the purpose.

## Rules inherited from the sibling that still apply

- **Keep every `.ps1` pure ASCII.** Windows PowerShell 5.1 reads a BOM-less
  `.ps1` as ANSI, so a UTF-8 em-dash decodes to CP1252 `0x94` = U+201D, which
  PowerShell accepts as a **string delimiter** — silently changing the logic of
  the enclosing block with no error.
- **`local_date` / `local_hour` get denormalised at ingest**, computed from the
  UTC timestamp. Grouping raw UTC into days shifts every daily total by the UTC
  offset (6h here). This matters *more* for screen time than for bytes, because
  a day boundary in the middle of the evening is immediately visible.
- **Display names are resolved in code, never stored**, so the rules can be
  corrected without re-ingesting.
- **Auth fails closed.** An unset `DASHBOARD_PASSWORD` locks the door rather
  than opening it. Never "helpfully" make a missing password mean open access.
- **The session cookie must not be `secure`** — this is plain HTTP on the LAN,
  and a secure cookie is silently never stored. The symptom is a login form
  that appears to do nothing.
- **`/login` must stay outside the `(dash)` route group**, or an
  unauthenticated visitor triggers the shell's database queries behind the form.

## Conventions

- **Commit author is `naimulnashid` only.** Never add `Co-authored-by:` or any
  other co-author trailer — the Vercel free hobby tier rejects multi-author
  commits on import.
- Conventional commit messages (`feat:`, `fix:`, `docs:`). Don't batch
  unrelated changes.
- `.gitignore` blocks `*.db`, `*.dat`, `*.csv` and the Android capture files.
  **If you add a new collector output format, add it to `.gitignore` before you
  run the collector.** The repo must only ever contain code.
- Update `docs/DEVLOG.md` (what changed, and why) and `docs/PROGRESS.md` (the
  running log) as you go, not at the end. `CHANGELOG.md` at the root is the
  RELEASE log -- one entry per version, for people using the project.

## Running it

```bash
npm run dev        # localhost:7844
npm run typecheck
npm run selftest
npm run demo:seed  # synthetic data into demo/ (gitignored)
npm run demo       # serve it on 7849 -- needs a build
```

**Ports on this machine are crowded.** 7842, 7843 and 7845 are the owner's
other local dashboards (7843 is the sibling Data Usage Tracker, 7845 is the
Internet Speed Meter). The demo went to 7849 after 7845 turned out to be
taken. Check with `Get-NetTCPConnection -State Listen` before picking a port.

**The README's screenshots are of the DEMO**, never of real data: "My
Laptop" and "My Phone", generic apps, and brand colours from the demo's own
`app-colours.json` (bars are coloured by name even with no logo files). To
redo them: seed, build and serve a scratch copy (never build over the live
`.next`), mint a session cookie with `issueSession()` and the scratch
server's throwaway password, and capture with headless Edge over the
DevTools protocol. `docs/screenshots/` holds three one-screen hero shots, and
`tour/` holds a full-page shot of every page, taken by growing the viewport to
`scrollHeight`, not by stitching. Three traps, all hit on 2026-09-23:

- **A fixed sleep is not a wait.** On a slow render the old document was still
  up, so three different pages came out the same height, measured from the
  previous page. Wait for the target URL and `readyState`, then for the height
  to stop changing.
- **Cards fade in on a staggered DELAY that reduced motion does not remove**,
  and a headless or background tab throttles animations. So shots caught cards
  at opacity 0. Inject `animation: none` for the capture, and bring the page to
  the front with focus emulated. The site itself is fine.
- **The demo must look like a real phone.** Packing app sessions edge to edge
  made the Overview say apps covered 0.97x of screen-on, contradicting the
  measured 0.76x the README quotes. The seeder now leaves lock-screen and
  between-app time unclaimed (~0.75x). The Sync page needs a heartbeat under
  a minute old to read "Running", so the capture writes one just before that
  shot. `npm run demo:seed` refuses, with nothing deleted, while `npm run
  demo` holds the folder.

The Windows probe, from an **Administrator** shell. Absolute path on purpose:
the relative form only works from the repo root, and running it from inside
`scripts\` resolves to `scripts\scripts\...` and fails with "does not exist",
which reads like a missing file rather than a wrong working directory.

```bash
powershell -ExecutionPolicy Bypass -File "<repo>\scripts\research\phase1-probe-windows.ps1"
```

It is read-only, snapshots to `%TEMP%`, and cleans up after itself. It checks
for elevation first and exits 1 with instructions if it does not have it, so a
non-elevated run costs nothing.

## The Windows sampler (Phase 3)

`scripts/sampler.ps1`, registered by `scripts/install-sampler.ps1` as a
**per-logon, unelevated** task. It polls `GetForegroundWindow` every 2s and
appends completed spans to daily JSONL; `scripts/ingest-windows.ts` folds those
into `windows_segments`.

```bash
powershell -ExecutionPolicy Bypass -File scripts\install-sampler.ps1 -RunNow
npm run ingest      # or wait for the daily 03:30 task
npm run selftest
```

### Why JSONL and not straight to SQLite

The sampler runs for weeks. A long-lived writer holding a SQLite handle across
WAL checkpoints is how a dashboard ends up serving stale pages -- and the
append-only file is crash-safe, since every line is a complete span and a
kill -9 loses at most the one in flight.

### Traps, all found by running it rather than reasoning about it

- **`Add-Type -MemberDefinition` already emits
  `using System.Runtime.InteropServices;`.** Passing `-UsingNamespace` for it
  duplicates the directive, and PS 5.1 escalates that warning to a hard error.
- **`Add-Content -Encoding UTF8` writes a BOM**, at the head of the file, so
  the first JSON line of every day fails `JSON.parse`. Use
  `[System.IO.File]::AppendAllText` with `UTF8Encoding($false)`. The sibling
  project hit this exact trap with `network.json`, where it failed silently.
- **Lock state comes from `WTSQuerySessionInformation(WTSSessionInfoEx)`,
  and every cheaper signal was tried and is wrong.**
    - *Null foreground window means locked* -- no. A test run promptly recorded
      a lock that never happened; nothing holds focus while a window closes or
      during a desktop switch either.
    - *LogonUI.exe exists* -- no. Measured it running while the session was
      demonstrably unlocked; it lingers after unlock on Windows 11.
    - *LockApp.exe is foreground* -- correct when true, but it MISSES a locked
      machine whose screen has gone off, because then nothing is foreground at
      all. That single gap put **61% of one stretch's tracked time into
      `unattributed`**, several times the real activity in it.

  The WTS call is the documented API, needs no elevation for your own session,
  and is checked BEFORE the foreground window. `SessionFlags` sits at **byte
  offset 16** of `WTSINFOEXW`: `Level`(4) + 4 bytes of padding, then
  `SessionId`(4), `SessionState`(4), `SessionFlags`(4). The padding is forced
  by `LARGE_INTEGER` members further down giving the union 8-byte alignment.
  Verified empirically rather than assumed -- a raw dump read
  `[0]=1 [4]=0 [8]=1 [12]=0 [16]=1 [20]=0x006F0043`, and that last value is
  `"Co"`, the start of `WinStationName`, which pins the field boundary exactly.

  Only `0` means locked. `-1` (Windows does not know) and `-2` (call failed)
  fall through to the window logic rather than guessing, because `locked` is
  subtracted from active time and a false one under-reports invisibly.

- **To restart the sampler, use the stop file, not Stop-Process.** `finally`
  does not run on a kill, so killing it discards the in-flight span -- which on
  a machine you have been using all morning is the whole morning. Touch
  `<samplerLogDir>\sampler.stop` and it leaves the loop cleanly. (If you must
  kill an old build that predates the stop file, read the in-flight span out of
  `sampler-status.json` and append it to the day's JSONL first; that is how
  29.7 minutes were saved on 2026-08-31.)
- **A LOGOFF is a kill, and the next start repairs it.** Windows can sign the
  session out before it hibernates (Winlogon 7002), which kills the sampler
  without `finally`. That once left a day and more with no row at all, and
  lost the span in flight. Now the heartbeat carries `closed`, which only
  `finally` sets, after the span is flushed. A sampler that starts and finds
  an UNCLOSED heartbeat writes the dead run's in-flight span up to its last
  sample, and a `gap` from there to its own start. So a kill loses at most
  one interval (~2s), and every shutdown is now a recorded `gap`. It all
  happens at STARTUP: sign-out and shutdown do no extra work. Measured
  2026-09-23 with a real kill: recovered span, gap and new run meet to the
  millisecond. A heartbeat with no `closed` field at all is from the old
  code, and counts as unclosed.
- **One sampler per output folder, by named mutex.** A second copy exits at
  once. Without that, it would double-count every span, and now it would also
  "recover" the span the first copy is still recording. The mutex is named
  from a hash of the folder, so a test run with its own `-OutDir` works
  beside the real one. A killed owner's mutex comes back ABANDONED, which
  still grants it to the next sampler.
- **Span lengths are `[long]`.** An `[int]` of milliseconds overflows at 24.8
  days, so a laptop left off for a month would have crashed the sampler at
  startup, on the gap it was trying to write.
- **A day holding only `gap` is not a day with data.** `latestDate()`, the
  day count behind the averages, and `getDaily()` all ignore `gap` rows.
  Without that, three days switched off would divide the average by three
  more days and chart as recorded quiet days.
- **The task reports `Ready`, not `Running`, and that is correct.** The VBS
  launcher does not wait, so the task completes in milliseconds while the
  sampler carries on detached. Check the PROCESS, or the heartbeat file.
- **`ExecutionTimeLimit` must be zero.** Task Scheduler otherwise kills the
  sampler after three days, and the symptom is screen time that just stops
  being recorded on a machine left running, with no error anywhere.
- **Backticks cannot appear inside `SCHEMA_SQL`.** It is a template literal, so
  a markdown-style `` `column` `` in a SQL comment terminates the string and
  the compiler errors point somewhere else entirely.

### Two things it deliberately does NOT do

- **It never captures window titles.** A title carries the document you are
  editing, the page you are reading, the person you are messaging. This records
  which app and for how long -- a far smaller disclosure, and this dashboard is
  reachable over the LAN. Do not add titles "just for the detail page".
- **It does not apply an idle policy.** `idle_ms_at_end` is stored raw and left
  alone. Whether "focused but idle for 40 minutes" counts as screen time is a
  policy question, and keeping the number means changing that answer later is a
  query change rather than a re-collection -- the same reasoning as the sibling
  project storing `l2_profile_id` before it could name networks.

### Still open

- **Monitor-off while UNLOCKED is still not detected.** Lock is now
  authoritative and sleep is caught by the clock jump, but a screen that blanks
  while the session stays unlocked still reads as ordinary foreground time.
  `idle_ms_at_end` is the raw material for fixing that without re-collecting.
  The honest fix is `RegisterPowerSettingNotification` for
  `GUID_MONITOR_POWER_ON`, which needs a message loop.

- **Data recorded before 2026-08-31 03:00 over-reports `unattributed`.** Those
  spans were written before lock detection existed and cannot be
  reclassified -- there is no record of what the session state was. The share
  should drop sharply from here; if it does not, something else is wrong.
- **The UWP frame-host resolution is unverified end to end.** It cannot be
  tested against a background window -- a suspended store app has no
  `CoreWindow` child, measured 2026-08-31 -- and it only matters while the app
  is foreground. Failures are FLAGGED (`unresolved`) rather than silently
  filed under the host, so the gap is measurable in real data.

## The headline is computed DIFFERENTLY per device. This is not a bug.

    WINDOWS   active time = SUM(duration_ms) WHERE kind = 'app'
    ANDROID   screen time = SUM over android_screen, NEVER over the app rows

Do not "fix" one to match the other. The reason is structural:

- The Windows sampler produces an **exclusive partition** of tracked time. At
  any instant exactly one span is open and it is `app`, `locked`, `gap` or
  `unknown`, so summing the app spans IS the total, by construction.
- Android's per-app sessions **partition nothing**. Measured at 0.76x
  screen-on, because the lock screen, the launcher and system surfaces hold
  time no app claims. Summing them there under-reports.

The shared half: `gap` and `locked` are never active time, and `unknown` is
never quietly folded into either.

### `unknown` is shown, not hidden

The Overview's "Where the time went" card reports `unknown` as its own segment
and warns above 10%. That is time the sampler saw no foreground window and
DECLINED TO GUESS -- a growing share means it is not seeing the desktop
properly. Folding it into "not active" would hide exactly the thing worth
noticing. `gap` is drawn in a neutral colour and deliberately left OUT of the
daily trend chart: a sleeping laptop is the absence of a measurement, not a
quantity, and charting it invites reading sleep as usage.

### Averages divide by days WITH DATA

Not by the range length. Dividing by 30 when the sampler has run for two days
reports a fifteenth of the truth and looks like a collapse in usage. Ranges are
likewise anchored on the newest day that HAS data, not on today, so a laptop
left off for a week shows its last real week rather than seven empty columns.

### The Sync page reads the heartbeat, not the task state

`Get-ScheduledTask` reports `Ready` while the sampler runs, because the VBS
launcher does not wait for its child. Task state therefore answers a different
question. `getSamplerStatus()` reads `sampler-status.json`, tolerates a BOM,
and treats a heartbeat older than a minute as dead -- all three covered by
self-tests, because a sampler that has silently died loses data permanently:
nothing backfills.

## The daily-rollup API is unusable. Do not reintroduce it.

`queryAndAggregateUsageStats` was implemented, shipped to the phone, and
**removed the same day** after measuring what it returns. Against a real
96-day pull it reported **more than 24 HOURS of foreground time on 88 of 96
days**, peaking at **478 h in one day**.

Two defects, both in the API rather than in the parsing, and both silent:

1. **Outside daily-file retention it falls back to the enclosing
   weekly/monthly/yearly bucket** and returns that whole bucket's totals for
   *every* day inside it. The tell was 29 consecutive days each reporting an
   identical `236.65h`.
2. **Even inside retention it counts any bucket that OVERLAPS the range, in
   full rather than clipped.** 2026-08-30 reported **1.94x** its measured
   screen-on, where the true ratio is 0.94x.

It bought nothing anyway: its entire justification was reaching further back
than events, and events measured 10.0 days -- the same ~10 days of daily
files. Event-derived rows over the identical pull had **0 of 11 days exceeding
24 h**.

`schema.ts` carries an unconditional `DROP TABLE IF EXISTS android_daily` so an
existing database sheds the bad rows on next open.

**The physical bound is the check that catches this class of bug**: a day
cannot contain more than 24 hours of foreground time. Any per-day figure that
exceeds it is wrong, whatever the API says.

### What the phone actually sends

Sessions, screen-on/unlocked spans, and package labels. Verified end to end
2026-08-31 -- 11 days, apps/screen-on ratio 0.56-0.87 averaging **0.77x**,
which independently reproduces the 0.76x measured in Phase 1 by a completely
different route.

### Two wire-format traps, both caught by counters rather than by inspection

- **Next does NOT decompress a gzipped REQUEST body.** Response bodies are
  handled automatically, which is what makes this easy to assume. The first
  real sync failed with `bad-json` having uploaded perfectly. The route now
  gunzips by hand.
- **The field is `packageName`, not `package`.** A mismatch rejected all 414
  labels while every session and screen span stored fine -- visible only as
  `rejected: 414` in the response. That counter is why it took a minute to
  find rather than a week.

### The reachability probe must not write to the run history

The app's "test connection" posts `{}` on purpose. The route originally opened
a `sync_log` run before validating, so every press wrote a **failed** row and
returned a 500. The sync page is where you look to find out whether collection
is healthy; filling it with entries from a button that worked is how that page
stops being worth reading. Validate before opening a run.

## Every address names a DEVICE, on both halves

    /windows/zephyrus-g16[/apps|/sync]      the laptop
    /android/nothing-a001[/apps|/sync]      a phone
    /android/xiaomi-redmi-note-9-pro/...    the other phone

The laptop used to live on the bare `/`, `/apps` and `/sync`, and this file
used to argue for that: moving it would break bookmarks for no gain a reader
could see. **The gain is that `/apps` cannot say whose apps it means.** With
one phone that was a shrug; with three devices in the sidebar it is a question
the URL has to answer, and the phone side had already answered it.

The slug comes from `slugify(deviceLabel())` -- the same function the phones
use, which is why it moved out of `android-ingest.ts` into `src/lib/slug.ts`.
`config.ts` is deliberately NOT `server-only`, so it could not import
`android-ingest.ts` without dragging `node:sqlite` into every module that
merely wanted a path.

**Nothing persists the laptop's slug**, unlike the phones', whose slugs are a
column in `android_devices`. There is exactly one laptop and nothing to
disambiguate against, so renaming it in `collector.json` moves its URL along
with its heading and its sidebar entry -- one edit, no drift. The cost is that
a rename breaks a bookmark, which is the right trade for the config file
staying the single source of what this machine is called.

**A wrong slug 404s.** The segment is compared against `windowsSlug()`
instead of ignoring it. Skip that and every misspelling renders Zephyrus G16
under a wrong name, which is the URL quietly going back to meaning nothing.

⚠️ **The check lives in a LAYOUT, and the skeletons live in route groups.**
From v1.0.0 until 2026-09-23, the pages made the check themselves, and a wrong
slug rendered the not-found screen **with status 200**. Every page sits inside
a `loading.tsx` Suspense boundary, and the 200 goes out with the skeleton
before the page runs. Nothing looked wrong in a browser; only the status
code did.

So `windows/[device]/layout.tsx` and `android/[device]/layout.tsx` do the
check, and `apps/[key]` and `apps/[pkg]` have layouts that 404 an app never
recorded. A layout is outside its OWN segment's boundary but inside every
boundary ABOVE it. That is why the Overview and By App skeletons moved into
`[device]/(overview)/` and `apps/(list)/`. At `[device]/loading.tsx` the
Overview skeleton wrapped every laptop page, so no check below it could
return a 404. **Do not put a `loading.tsx` back at `[device]` or `apps`.**

A malformed `%` (`/apps/100%`) never reaches any of this. Next validates a
param's encoding before route code runs and answered with a bare 500, so
`proxy.ts` answers a path that does not decode with a 400 first. Params
arrive still ENCODED (`exe%253A` is not `exe:`), and `decodeSegment()` in
`slug.ts` decodes them without throwing.

⚠️ **A redirect does NOT carry the query string.** `redirect('/windows/x')`
drops `?days=7`, so a bookmarked `/apps?days=7` would land on the full range
with nothing on the page saying the scope had moved -- a redirect that
silently changes what was asked for is worse than a 404. `queryString()` in
`scope.ts` rebuilds it, and every legacy redirect uses it.

**The `/apps/<key>` redirect passes the key through UNDECODED.** It is already
percent-encoded in the incoming path; decoding and re-encoding would double
the escapes on the `%` and `/` that resolved keys like `exe:visual
studio/setup` genuinely carry.

`/` stays the way in -- the sidebar's brand link still points there, because
it is the one URL guaranteed to mean "home" however the devices are named.

**`pagesForPath()` yields no tabs for a path with no device in it** -- `/`,
`/windows`, `/android`, or a legacy address in the instant before its redirect
lands. A tab strip whose links all point at a device the URL has not chosen is
worse than no tab strip.

**`deviceOf()` still tests only for `/android`**, and everything else falls to
the laptop. That asymmetry is deliberate: the laptop's violet is also the
`:root` accent, so an unrecognised path renders in the site's own colour
rather than in none.

## The auth gate REWRITES, it does not redirect

An unauthenticated **page load** gets the login form rendered at the address it
asked for -- `/windows/<slug>`, its `/apps`, its `/sync` -- with the URL
untouched. Sign in and that
page renders underneath you; `router.refresh()` re-fetches the current URL and
there is no `?next=` round trip.

**Why.** A redirect moves the address bar, and the browser reloads a tab it
discarded while you were away. So a tab left on the Overview came back as
`/login` with the page you were on erased from the URL. It is not an expiry:
the session is 30 days and renews daily. It reads as one because the reload is
invisible.

**The phone pages were never immune** -- that was the reported symptom, and
`curl` disproved it in one command: every path 307'd to `/login` identically
when the cookie was absent. The asymmetry was in how often each page is
reloaded from cold, not in the code. Worth remembering as a shape: "page A does
it, page B doesn't" is a claim about *behaviour*, and the cheapest test is to
ask the server directly rather than to go looking for the branch.

**The redirect survives for RSC requests**, and must. A soft navigation or
prefetch expects a flight response and would choke on HTML; Next turns the
redirect into a hard navigation, which is the right answer for walking into a
locked route anyway. `isDocumentRequest()` reads `sec-fetch-dest`, falls back to
`accept`, and **excludes Next's `RSC` header and `_rsc` query FIRST** -- a
prefetch carries an HTML `accept` too, so the accept check alone would
misclassify it.

The rewritten response carries `cache-control: no-store`. Nothing may hold the
login form under a dashboard URL.

⚠️ **That header only survives because `/login` is DYNAMIC** (`force-dynamic`
in `login/layout.tsx`). A prerendered /login is served with Next's own
`s-maxage=31536000`, which REPLACED the gate's `no-store`. Measured
2026-09-23 on fresh Next 15 and 16 builds alike. The long-running live server
happened to send `no-store`, so checking only against it would have missed
the bug. **Check this header on a fresh build**, with curl.

## Security hardening, and two traps it found

Done 2026-09-23 before publishing, and verified against a real production
build (a scratch copy on another port, never over the live `.next`).

- **The post-login redirect is decided by the URL parser**, `safeNextPath()` in
  `src/lib/safe-next.ts`. The old `startsWith('/') && !startsWith('//')`
  passed `/\evil.example`, which the WHATWG parser resolves to
  `http://evil.example/` -- an open redirect straight after sign-in.
- **Login is throttled by COUNTING**, `src/lib/login-throttle.ts`: a
  per-client exponential lockout after 5 misses, and a GLOBAL budget of 30
  misses per 15 minutes. An attempt is charged before the password is checked
  and refunded on success, so parallel bursts are counted as they arrive.
- **The phone endpoint is capped on the wire AND after gunzip**: the body is
  read with a byte limit (8 MB), gunzip gets `maxOutputLength` (64 MB), and
  `payloadProblem()` bounds array lengths and string sizes. A 1 GiB gzip bomb
  is refused in 40 ms.
- **Cross-origin writes are refused in the proxy** by comparing `Origin`
  to `Host`. SameSite=Lax alone treats every localhost PORT as the same site.
- **The session key is PBKDF2-derived** from the password (200k iterations,
  cached per process). Keyed by the raw password, a copied cookie was an
  offline password oracle. Changing the scheme signed every device out once.
- **Security headers** come from `next.config.mjs`: CSP, frame blocking,
  nosniff, no-referrer, Permissions-Policy, no `X-Powered-By`.

### ⚠️ `x-forwarded-for` is whatever the CLIENT says

Next fills it in only when it is absent (`??=` in `base-server.js`), so a
caller can send any value and be a new "client" every request. That is why the
throttle has a global layer: **the global budget is the real bound**, and the
per-client layer exists for honest clients. Never key a security decision on
that header alone.

### ⚠️ Config headers OVERWRITE a route handler's headers

The logo route set a sandboxing CSP on its own response and the browser
received the site-wide one instead: `next.config.mjs` headers are applied after
the route's, and for a repeated key the later rule wins. The logo policy
therefore lives in `next.config.mjs` as a second rule after the site-wide one.
**Check a security header with curl, not by reading the code that sets it.**

### Keeping it off public networks is the owner's step

`npm run firewall`, from an ADMINISTRATOR shell, adds one inbound block rule
for port 7844 on the Public profile. It refuses while any connected network is
Public, because Windows often files a home network as Public, and blocking
there would cut the phone off. Mark the home network Private first. The script
changes a security setting, which is why it is never run on anyone's behalf.

## Accessibility: WCAG 2.1 AA, measured, with two known exceptions

Audited 2026-09-23. Every ratio below was computed from the real tokens, and
every fix was checked on the signed-in pages in a browser.

- **Text on a filled accent uses `--accent-fill` / `--on-accent`**, defined per
  device in `accent.ts`. White on Android green was **1.78:1**. The phone's
  active chip now has near-black text (10.6:1), and the violet fill moved
  `#7c5cff -> #795af9` (4.52:1, indistinguishable). Do not put `#fff` back on
  `var(--accent)`.
- **`--text-faint` is `#7b7b86`** (4.54:1 or better on every surface). It was
  3.76:1 and carries small text in twenty-odd places.
- **The password field's edge is `--border-input`** (3:1, WCAG 1.4.11).
  Decorative dividers keep the quieter `--border-strong`.
- **Every page has its own title**, `<page> · <device> · Screen Time`, from
  `lib/page-title.ts`. They were all just "Screen Time".
- **Every chart carries a `.sr-only` sentence** from `lib/chart-summary.ts`:
  range, average, peak, or the ranking. The trend and the shape of the day
  exist nowhere else as text.
- A skip link, `aria-current` on the tabs and the sidebar, `role="alert"` on
  the login error, and TalkBack labels and headings in the phone app.

**Known exceptions, kept on purpose:** the fixed 1024px phone layout (1.4.10
Reflow -- see *Phones get the DESKTOP layout*), and the heat map's lowest
shades, which sit near the panel colour by design; the map has a text summary
and a title on every cell.

### ⚠️ Testing signed-in pages in the browser pane

Cookies are per HOST, so the pane sends the real `localhost` session to any
localhost port, and JavaScript cannot overwrite that httpOnly cookie with a
test one. The pane's autofill also POSTs to `/api/login` by itself -- three
requests in 20 ms were seen in its network log, from a page that never
submits on its own. That is the likely explanation of Phase B's 29-vs-30
throttle count. **Test a scratch server at `127.0.0.1`**, which is a different
host with its own cookie jar and no saved logins.

## node:sqlite rows are NOT plain objects

`db.prepare(...).all()` returns objects with a **null prototype**, and React
refuses to serialise those from a Server Component into a Client Component:

    Only plain objects, and a few built-ins, can be passed to Client
    Components from Server Components.

`getAndroidDevices()` fed driver rows straight into `Shell` (a client
component) for the sidebar. **The bug was latent for as long as no phone had
reported**, because an empty array serialises fine -- it appeared the instant
real data existed, which is the worst kind: it passes every check right up
until the feature actually works.

Rebuild rows as plain objects before they cross that boundary. Anything else
that hands driver rows to a client component needs the same treatment; the
query functions that `.map()` their results are already safe by accident, and
that is worth making deliberate if one is ever simplified.

## The phone app is released SIGNED, on GitHub Releases

Decided 2026-09-23: the APK is published as an asset on a GitHub Release,
never committed. Git history stays code-only, and `*.apk` stays ignored.

    cd android && ./gradlew assembleRelease     (JAVA_HOME = Android Studio's jbr)
    -> app/build/outputs/apk/release/app-release.apk
    apksigner verify --print-certs <apk>        check before uploading

- **The key is `<scratchDir>\recovery\screen-time-release.jks`**: RSA 4096,
  100-year validity, alias `screentime`, DN `CN=Screen Time Reporter,
  O=naimulnashid`. The certificate DN is readable by anyone who downloads
  the APK, so it carries only the public GitHub handle.
- **`android/keystore.properties` names it and holds the passwords.** It is
  gitignored, along with `*.jks` and `*.keystore`, in BOTH repos. Anyone with
  the key can ship an update the phones will accept, so the private repo does
  not get it either. `npm run backup:kit` copies the properties file into
  `recovery\`, and `npm run drill` fails if the key is missing, on the system
  drive, or its properties copy is stale.
- **Without the properties file, `assembleRelease` builds UNSIGNED and warns.**
  It does not fall back to the debug key: a debug-signed "release" would
  install once and then refuse every real update.
- **Losing the key costs no data, but it breaks updates.** A release signed
  by any other key will not install over this one, so each phone would have
  to uninstall the app, re-grant usage access and re-enter the token. The
  debug build that was sideloaded before is in the same position: switching
  a phone to the release APK means uninstalling the debug one first.
  Server-side history is unaffected, and the first sync backfills ~10 days.
- **Bump `versionCode` for every release**, or Android refuses the update as
  a downgrade. The v1.0.0 asset is `versionCode 1` / `versionName "1.0"`,
  built from the v1.0.0 app sources plus the signing config.

## Phase 4: the reset drill

    npm run drill        verify recoverability; changes nothing
    npm run backup:kit   put the code and the secrets off the system drive
    npm run restore      restore the database from the backup

`npm run drill` restores the backup into TEMP, integrity-checks it and queries
it, then enumerates what a reset would take. Anything that would be lost with
no copy off the system drive is a FAILURE, not a note.

### It found two real gaps on its first run, and both were severe

**1. The code had no copy off the system drive.** The repo lives under
`C:\Users\...` with **no git remote**. A reset would have destroyed it, leaving
a perfectly good database backup that nothing could read. A database backup
without the code is not a backup.

**2. `.env.local` is gitignored**, so restoring the repo restores everything
except the two values that make it run. The phone's failure mode is the nasty
one: it keeps pushing to a token the rebuilt server has never heard of and only
records a 401 in its own status line.

`backup-recovery-kit.ps1` fixes both, and the **two destinations differ on
purpose**:

| | | |
|---|---|---|
| repo bundle | `D:\PersistentData\...` | Drive-synced. Code is not secret; off-machine is the point. |
| secrets | `D:\ScreenTime-scratch\recovery\` | **NOT** Drive-synced -- which is why scratch sits outside PersistentData. Survives a reset without going to anyone's cloud. |

A `git bundle` is the whole history in one file, restored with `git clone`. It
is verified after writing, because an unverified bundle is the same hypothesis
the database backup used to be. **A remote would be better and would make the
bundle unnecessary** -- the drill accepts either.

`RESTORE.txt` is written beside the bundle, not merely committed: a recovery
procedure that lives only inside the repo you are trying to restore is not a
procedure.

### restore.ps1 has actually been run, not just written

Exercised for real on 2026-08-31: 9,779 rows restored and verified, and the
dashboard read the restored file afterwards. It **moves the old live database
aside rather than deleting it**, removes the stale `-wal`/`-shm` (which belong
to the file that just moved), and **refuses to overwrite a live database
holding MORE rows than the backup** without `-Force`. That guard is the shape
of the real accident: reaching for restore after a scare and silently
discarding newer data you still had.

### PowerShell trap: native stderr kills the script

`git bundle verify` writes its **success** message ("is okay") to stderr. With
`$ErrorActionPreference = 'Stop'`, stderr from a native command becomes a
terminating `NativeCommandError` -- so the first version of the kit script
created the bundle, verified it fine, and then **died before saving the
secrets, having reported success for the half it did**. Redirecting with `2>&1`
does not help; the redirection is what promotes the stream. Wrap native calls
and judge them by `$LASTEXITCODE`, the only thing that means failure.

## The dashboard runs as a logon task

    npm run autostart -- -RunNow      register and start
    npm run autostart -- -Remove      unregister and stop
    npm run dashboard:stop            stop it, leave the task registered

`scripts/install-autostart.ps1` registers **"Start Screen Time Dashboard"**,
which runs `wscript dashboard-hidden.vbs`, which runs `dashboard-service.ps1`
hidden, which serves `npm start` on port 7844. Unelevated: the dashboard reads a
database and serves pages, and nothing it does needs Administrator.

### Two .bat files are the manual way in

    start-screen-time-dashboard.bat   serve 7844, open the browser when it answers
    stop-dashboard.bat                stop THIS project's server on 7844

For when the task is disabled, or you want a window to watch. The stop file is
also the only off switch while the task IS in charge, because that path runs
the server hidden and there is no console to Ctrl+C.

**"This project's server" is not "whatever holds 7844".** `dashboard-stop.ps1`
used to stop every process listening on the port, of any name. On Windows a
server bound to `127.0.0.1` starts happily beside another program's wildcard
(`0.0.0.0` / `::`) listener on the same port, so a port can have two owners --
and the neighbouring dashboards are node too. That is exactly how the sibling
was once taken down for hours: a demo server shared its port, and a cleanup
that killed "the listener on 7843" killed both.

So a listener now counts as ours only when its command line runs Next.js out of
**this repo's own `node_modules\`** -- which covers the logon task's server,
the `.bat`'s and `npm run dev`'s alike. It is anchored there rather than on the
repo path, which a folder named like this one plus a suffix would also match.
Anything else, including a process whose command line cannot be read, is left
alone and named. `-WhatIf` shows which PID it would stop; `-Port` tries the
rule on a spare port.

**The logon launcher asks the same question.** `dashboard-service.ps1` carries
the same rule inline -- change the two together. It used to log `port 7844
already served by <name>` and exit 0 for ANY owner, so another program on the
port left the dashboard down until the next logon behind a log that read as
fine. Now only this dashboard is "already served" (exit 0); anything else is
logged as another program, NOT starting, exit 1 -- and it never starts beside
it.

`start-...bat` **exits if anything already holds 7844**, and that guard is
doing more than it looks. `npm run dev` binds 7844 as well, so the check is
what stops this window from running `next build` underneath a live dev server
-- the `Cannot find module './331.js'` trap above. It also only builds when
there is NO build, warning instead when `src\`/`config\` are newer, using
the same comparison `dashboard-service.ps1` makes so the two never disagree
about what "stale" means.

**This is a THIRD task, separate from the two collectors.** "Screen Time
Sampler" records the foreground window and "Screen Time Ingest" folds its
output into SQLite. Removing the dashboard task stops the site and changes
nothing about collection -- which is the right way round, since collection is
the half that cannot be caught up later.

### Four things that are load-bearing

- **The VBS wrapper is not decoration.** Task Scheduler's own "Hidden"
  checkbox does not suppress a console window and `-WindowStyle Hidden` still
  blinks one up at every logon. `WScript.Shell.Run` with window style 0
  genuinely creates none. **All three tasks go through one now**, and the
  ingest's had to differ -- see the ingest section.
- **Renaming a task is unregister + register, and the OLD NAME MUST GO.** Task
  Scheduler has no rename. Leave the old entry behind and both fire at the next
  logon; the second server finds port 7844 taken and dies, logging that where
  nobody reads it. `$OLD_TASKS` in `install-autostart.ps1` is cleared before
  the new name is registered, and on `-Remove` as well. A RUNNING server is
  left alone throughout: unregistering a task does not stop the process it
  started, and there is no reason to drop the site to rename its launcher.
- **It rebuilds when `src/` or `config/` is newer than `.next/BUILD_ID`.**
  Without that check the launcher builds once and then serves that build
  forever -- on a dashboard whose whole job is reporting current numbers,
  silently serving three-week-old query code is a convincing kind of wrong.
- **`ExecutionTimeLimit` must be zero.** Otherwise Task Scheduler kills the
  server after three days and the symptom is a dashboard that worked on Monday
  and is simply gone on Thursday, with no error anywhere.
- **The task reports `Ready`, not `Running`.** The VBS launcher does not wait
  for its child. Check the port or `logs/dashboard.log`.

### NEVER run `next build` while a dev server is up on this project

They share `.next`, and the build replaces chunks the dev server holds open.
The symptom is the dev server dying on the next request with

    Error: Cannot find module './331.js'

which reads as a code bug rather than as two processes fighting over a
directory. Run `npm run dashboard:stop` first.

### Two PowerShell traps this file hit

- **A backtick is the escape character in a double-quoted string.** Writing a
  command in markdown backticks -- ``"Before `npm run dev`"`` -- renders as a
  NEWLINE followed by `pm run dev`. Use single quotes. Same family as the
  em-dash trap: punctuation that is inert everywhere else and load-bearing here.
- **`>>` redirection writes UTF-16LE and `Add-Content` defaults to ANSI**, so
  mixing them gives one log file in two encodings that no ordinary tool reads.
  `tail` showed the build output as `" R e a d y   i n "`. Write through
  `[System.IO.File]::AppendAllText` with `UTF8Encoding($false)`.

## Ingest is HOURLY, and there is a Sync now button

    npm run ingest              fold pending JSONL into SQLite
    POST /api/ingest            the same thing, from the dashboard

**The cadence was daily and that was wrong.** The original note said "daily is
plenty" and was right about the half it considered: nothing evicts the JSONL,
unlike SRUM's 7 days or the phone's 240 hours, so a missed run costs no data.

It was wrong about **freshness**. The sampler writes continuously and the
dashboard reads only the database, so the page is stale by however long it has
been since the last ingest. On 2026-09-01 the laptop's Overview reported **one
day of data and under an hour of use while 722 unread spans sat on disk** --
and nothing about the page suggested it was a day behind rather than idle. For
a dashboard whose job is reporting current numbers, that is the failure mode
that matters.

The trigger is `-Once` at midnight with an hourly repetition, not 24 daily
triggers, and `-StartWhenAvailable` catches up a run missed while the laptop
slept.

### The ingest's launcher WAITS. The other two must not.

All three tasks run through a `.vbs` so no console window appears -- and it
mattered most here, because this one fires **every hour**, so the flash was not
a one-off at logon but a black window taking focus hourly, all day.

`ingest-hidden.vbs` is nevertheless the odd one out: it passes `True` to
`WScript.Shell.Run` and returns the child's code through `WScript.Quit`.

**Because the ingest is a job that FINISHES.** The sampler and the dashboard
run for the whole logon session, so waiting would pin their tasks as "running"
forever. `ingest-windows.ts` exists, in its own words, to "set an exit code
that Task Scheduler will record in `LastTaskResult`" -- launch it detached and
the task completes in milliseconds reporting **success, whatever the ingest
actually did**. An hourly job that fails silently while reporting 0 is worse
than one that flashes a window. Verified by probe: a `Run(..., 0, True)` around
`cmd /c exit 3` returns 3.

Its output goes to `logs\ingest.log`, because after hiding the window there is
nowhere else for it to go. **This is not the UTF-16 trap** in the autostart
section: that one is PowerShell's `>>`, and this redirection is cmd's, which is
byte-level and passes the child's UTF-8 through unchanged.

**The ingest logic moved to `src/lib/windows-ingest.ts`** because it now has
two callers: the scheduled task and the button. It RETURNS its result instead
of printing; the script prints, the route turns the same object into a
sentence. A function that logs to stdout is one only the script could use. This
mirrors `android-ingest.ts`, which has sat behind its own route since Phase 2.

**The button lives in the TOP BAR, on the laptop's pages only.** It was on the
Overview first, and that was the wrong home: the hour of staleness it closes
belongs to the *database*, so By App and Sync Status were equally behind with
no way to fix it without navigating back. Not on the phone's pages -- the phone
pushes on its own schedule and nothing waits on this machine's disk.

**The button is safe to press at any time.** It fetches nothing -- everything
it folds in is already on disk -- and the ingest is idempotent, so a second
press inserts zero rows and says "Up to date". A module-level in-flight promise
means overlapping presses share one run rather than stacking.

## Chart axes must END AT THE DATA

⚠️ **Recharts picks a "nice" ceiling from a FIXED TICK COUNT, and overshoots to
reach it.** Measured on the phone's Top apps chart: the tallest bar was
**11h 5m** and the axis ran to **17h**. Half as much empty space again as data,
every bar foreshortened, and the chart reading as though there were hours of
use somewhere off to the right.

`niceHourAxis()` in `src/lib/axis.ts` picks the STEP first -- the smallest
from a list that means something to a person (1m, 2m, 5m, 10m, 15m, 30m, 1h,
2h, 3h, 4h, 6h, 12h, 24h) that covers the peak in at most six intervals -- and
lets the ceiling fall out of it. 11h 5m takes a 2h step and stops at 12h.

**Every time axis on the dashboard uses it**, and that is not optional once the
tick formatter is exact. Recharts' own tick VALUES are not round numbers -- the
old rounding formatter merely hid it, printing 3h33 as "4h". Give a chart an
exact formatter without choosing its ticks and the axis starts reading
"3h33 / 7h55 / 9h17". Ticks and formatter have to change together.

It lives in `axis.ts` rather than `Charts.tsx` **so it can be self-tested**:
`Charts.tsx` is a client component and imports Recharts, so a script cannot
import from it. Same split, same reason, as `sampler-status.ts` leaving
`queries.ts`.

**The tick formatter has to be exact, not rounded.** A 30-minute step is
allowed, and the old `Math.round(h) + 'h'` printed 1.5h as "2h" -- a tick one
step below the real 2h, both claiming the same label.

## Bar colours come from the app's brand, and are HAND-MAINTAINED, not computed

`config/app-colours.json` maps a logo identity to a brand hex, and
`src/lib/app-colour.ts` reads it. **The file is local-only (gitignored)**, like
the logos it describes: a colour only ever applies to a logo file that exists,
and the two together are an inventory of every app on every device.
`config/app-colours.example.json` shows the shape; each entry is a hex, or
`{ hex, note }` when the choice needs its reasoning kept beside it.
`scripts/measure-logo-colours.ts` derives those from the logo files -- SVG
paints read from source, PNG/JPG pixels bucketed and averaged with `sharp`.

**`sharp` is NOT in package.json, on purpose.** `CLAUDE.md` already rejects
native modules because `npm run restore` runs `npm install`, and a native
dependency that fails to build fails the restore this project exists for. The
script imports it dynamically and says so if it is missing; the runtime does a
plain map lookup.

**The script's output is a starting point, not the answer.** It counts paint
DECLARATIONS, not the area each covers. A Google logo carries four colours used
once each, the tie breaks toward the most saturated, and **yellow wins every
time** -- it proposed yellow for Gmail, Maps, Photos and Google itself, and
green for Gemini. Those are corrected by hand and marked `HAND` with the
reason. The map being hand-maintained is what makes that possible.

**A wrong value does not look wrong as a hex, which is why the correction has
to happen at the logo.** Covering all 91 logos on 2026-09-03 turned up three
more of the same failure, and the Edge one is the case to remember: the script
returned `#66eb6e`, a GREEN, because that stop appears twice in the swirl's
gradient where every other stop appears once -- so it won on COUNT, not on the
saturation tie. Edge is the laptop's second-heaviest app; a green bar for it
reads as WhatsApp long before it reads as a bug. Sheets came back `#263238`
(the near-black document behind the mark) and VLC `#ffb900`, the lightest stop
of the cone -- amber, which File Explorer's folder genuinely is, so two brands
would have converged on one bar colour.

**Both of those failures recurred on 2026-09-04**, over 14 new logos, which is
the point worth taking from them: they are not one-off quirks of two files.
Edge's `#66eb6e` came back on **Microsoft Edge WebView2**, the same swirl in
the same artwork; and the Sheets shape came back on the **MIUI Camera** as
`#262a39`, the dark lens body. That one is the more instructive: it is
genuinely the largest coloured area of the icon, and it is so dark that
`ensureReadable` lifts it to `#5f626d`, a flat neutral grey -- so the bar ends
up saying "no colour known" for an app whose icon is a vivid pink-to-blue
ring. Corrected to `#f64786`, a real pink in the file, **found only by
sampling at the file's native 285px**: at the 64px the script uses, a thin
ring blurs into the pale field and leaves no bucket at all. When a logo's
identity lives in a THIN element, re-measure at full resolution before
believing the script found nothing there.

⚠️ **Some convergences have no honest fix, and those are kept and written
down.** PowerToys Shortcut Guide derives `#36c8f6`, **9 away from Edge**. VLC
could move off File Explorer's amber because its cone genuinely reads orange
-- a second true answer. Here there is none: the icon is a grey keyboard whose
only chroma is that cyan arrow, and PowerToys' own amber is not a paint in
this file, so reaching for it would be the Chrome mistake. Kept, with the
reasoning in place, so the next reader knows it was weighed rather than
missed.

⚠️ **A logo swap can also make a committed colour WRONG, and the bare/scoped
split is where that hides.** The Nothing's `Settings.png` was replaced with a
teal disc on 2026-09-05, where it had been the same slate blue gear as the
Redmi's. `settings` was a BARE entry, and its comment said so in as many
words -- so the map went on asserting a fact about two devices that was now
true of one. Nothing catches this: the app NAME did not change, coverage still
passed, and a bare entry that has quietly become one device's answer is
indistinguishable from a bare entry that is still both devices'. Only opening
the file shows it. **When a logo file changes, re-derive it and re-read the
comment, not just the hex.**

The move goes both ways. `packageinstaller` went scoped -> BARE the same day,
because the Nothing's copy arrived with the same md5 as the Redmi's -- one
file in two folders, since the distributor copies rather than shares. That is
the `systemui` case, and two scoped entries holding one hex is exactly the
drift the bare exception exists to prevent.

⚠️ **A logo swap can make a committed colour UNDERIVABLE.** The Redmi's
`Settings.png` was replaced with flatter artwork whose field sits at
saturation 0.20, under `isCandidate`'s 0.25 floor -- so the file that used to
propose a colour now yields nothing at all, while looking almost unchanged.
The map entry is still correct (both phones' gears are the same slate blue),
but a blind re-paste of the script's output would have dropped the line and
sent Settings to the device accent. **Diff the script's output against the map
rather than replacing the map with it.**

⚠️ **A paint can be in the file and still not be in the PICTURE.** `Notepad.svg`
arrived as an Inkscape export in which **173 of its 177 `<defs>` children were
unreferenced** and 95% of its 92 KB never rendered. The script proposed
`#d3ed89`, a pale green, off 24 declarations that nothing paints with -- the
mark is a SKY BLUE pad. This is worse than the Edge and Sheets cases, which at
least picked a colour you could see: here every candidate the count produced was
invisible. **Render the logo before committing a colour for it**; the file is a
list of paints, not a picture of one.

**So vacuum a hand-dropped SVG before deriving a colour from it** --
`npm run logo:vacuum -- -Path "public/apps_logo/Thing.svg" -InPlace`, which
is `scripts/vacuum-svg-defs.ps1`. Notepad went 92,380 -> 4,627 bytes and its
colour candidates 142 -> 4, after which the script proposes `#057093`: the
rules and rings, a real paint, though still not the body. **The vacuum narrows
that failure without removing it, so the render is still the check.**

The script refuses to write when the rendered tree changes, and refuses a file
carrying `<style>` or `<script>` outright, since a `url(#id)` hiding in CSS
is invisible to an attribute scan. It also writes a difference-blend page and
tells you to look at it. **Look at it.** The structural check was wrong the
first time it was written -- it compared the file either side of the defs and
this file has five `<defs>` blocks, one nested, so it cut the middle out of
both sides and passed a file that had lost 16 `<path>` elements. The full
account is in `public/apps_logo/README.md`.

**A correction must name a paint IN THE FILE.** Chrome is the case that made
this explicit. It was hand-corrected to `#4285f4` on the reasoning that the
centre disc is blue -- true, but `#4285f4` is not a paint in `Chrome.svg`,
which carries the LEGACY gradient logo whose disc runs `#81B4E0 -> #0C5A94`.
The value came from brand knowledge, and a remembered hex cannot be checked
against anything, which is a different failure from picking the wrong paint.
Reverted to `#fcd209`, the yellow arc, which is also what a person sees.
`gemini` is the only remaining entry whose hex is not in its own file, and it
says so in place.

**Colour is recognition, not encoding, so honest collisions stay.** Facebook
and Messenger are both blue; X and ChatGPT are both monochrome. Bar length and
the axis label carry the data. Nudging one of a pair apart would mean
inventing a brand colour, which is the thing this map exists not to do.

**Coverage is a self-test, not a habit.** Every logo file must resolve to a
colour, because a missing one falls back to the device accent and so does not
look like a gap -- it looks like an app that chose violet. The single
deliberate omission is Screen Time Reporter, whose icon IS the dashboard
accent: adding that hex would put an accent colour outside `accent.ts`,
and the fallback already draws the right thing on both devices. An app with no
logo file keeps the fallback too, since there is nothing to derive from --
Windows Search is the only one in any chart today.

**A dark brand colour is the black-logo problem again.** `ensureReadable()`
mixes toward white until lightness clears 0.40, keeping the hue. **About one
entry in seven trips it**, the darkest a teal at lightness 0.227.
An earlier version of this paragraph said nothing did -- that was wrong when
written and badly wrong once the map covered everything, so the
self-test asserts on what `brandColour()` RETURNS rather than on the map,
which is what the chart actually draws.

**This does not break "accent.ts is the only place a hex lives."** That rule is
about the dashboard's OWN palette. These are third-party brand colours: data
about other people's logos, as out of place in `accent.ts` as a list of app
names. `Charts.tsx` still contains no hex; a colour reaches it inside the chart
data, exactly as a logo URL does.

## EVERY logo lives in a device folder. The root is a drop zone.

⚠️ **The whole folder is LOCAL-ONLY** -- gitignored apart from its README,
since 2026-09-23 when the repo was prepared for publishing. Third-party icons
are not this repo's to license, and a folder of them is an inventory of every
app on every device, banking and password apps included. A fresh clone draws
initials. Git therefore no longer protects the logos from a reset: `npm run
backup:kit` mirrors them (with `collector.json` and `app-colours.json`) into
`local-files\` beside the backup, and `npm run drill` fails if that mirror is
missing or stale. The file counts below describe this installation, not the
repo.

`public/apps_logo/` was a single namespace for every device, and clashes were
settled by renaming -- the laptop's were `Windows Camera` and `Windows Photos`.
**That stops working with two Androids.** Measured 2026-09-04, the Nothing and
the Redmi report the same label for a genuinely different package twice:

| Display name | Nothing A001 | Redmi Note 9 Pro |
|---|---|---|
| Camera | `com.nothing.camera` | `com.android.camera` |
| Gallery | `com.nothing.gallery` | `com.miui.gallery` |

Neither can be renamed out of it: the phone reports the label and both phones
are right. So the folder is now organised per device, and a logo two devices
both show is **COPIED**, not shared:

    apps_logo/Zephyrus G16/            32 files
    apps_logo/nothing-a001/            65 files
    apps_logo/xiaomi-redmi-note-9-pro/  9 files

106 files for 92 distinct logos. `Brave.svg` exists three times on purpose.

**The resolver still falls back to the root**, so the layout is a choice on top
of the code rather than something it enforces. The root is where a new logo
ARRIVES: drop it there and run `npm run logo:distribute` (report only) then
`-- --apply`, which matches each device's recorded app names with the same
rules the dashboard uses and fans the file out.

⚠️ **The distributor never copies BETWEEN devices**, because a file in
`nothing-a001/` may be the wrong picture entirely for another phone -- which
is the whole reason the folders exist. A device needing a logo nobody has is
reported, never filled in from a neighbour. It also never deletes a root file
no device claims: no app matching it today is not the same as it being dead.

**The cost is drift.** Replace artwork in one folder and the other devices keep
the old copy, and nothing here will notice. That is the trade for a folder
being a complete, readable answer to "what does this device show", and for one
device's icon never being able to affect another.

**An app whose device has no copy draws its initial** -- the normal case for
most apps, and the honest one. The Redmi has 11 such apps today, listed by the
distributor on every run.


### One identity behind the artwork, the plate AND the colour

`resolveLogo()` returns a scope and a key; `logoIdentity()` joins them.
`needsLightPlate()` and `brandColour()` are both keyed by that, never by the
app name. **A Redmi Gallery drawing MIUI's icon over the Nothing Gallery's
brand colour is worse than either alone**, and three functions each doing their
own matching is exactly how that happens.

Both fall back from `nothing-a001/gallery` to a bare `gallery`, which is what
keeps ONE colour entry and ONE plate entry covering all three copies of a
shared logo. `NEEDS_PLATE` would otherwise have quietly stopped matching when
`X.png` was copied into the device folders, and X would have gone back to being
an invisible black mark on a near-black page.

**Scope a phone's icons; leave the laptop's bare.** Every Redmi-only entry in
`BRAND` is keyed `xiaomiredminote9pro/...` while every laptop-only one is
bare, and that asymmetry has a cause rather than being an oversight: there is
one Windows machine and there always will be (`deviceLabel` is a single config
field), while phones multiply. A third phone arrives with its own Camera,
Gallery, Security and File Manager -- generic names over device-specific
pictures. The exception is `systemui`, keyed BARE because the two phones' files
are byte-identical (same md5, the legacy Android robot): one entry covers both
through the fallback, and two copies of one fact is how they drift apart.

That fallback needs watching where a logo is genuinely device-specific: when
the Nothing's Camera and Gallery moved into its folder, **their colour entries
had to move with them**, or the Redmi would have drawn no icon and a
Nothing-red bar -- the mismatch the folders exist to stop, arriving through the
fallback.

### ⚠️ The manifest stores the REAL folder name, not the key

`nothing-a001` keys as `nothinga001`. Storing the key produces a path no file
answers to, so every scoped logo 404s **with the file plainly on disk** -- which
is the precise failure the serving route exists to prevent, reintroduced one
layer down. It was written that way first and every string comparison passed,
because the string looks entirely reasonable.

The self-test now **opens** the file rather than comparing the path, both for
the scoped fixture and for all 92 logos on disk. Verified by reintroducing the
bug: both checks fail, and pass again on the fix.

### And the manifest is stamped on EVERY folder's mtime

The root's mtime does not move when a file is added inside a subfolder. Stamping
the root alone would mean a logo dropped into `nothing-a001/` stayed invisible
until the server restarted -- the same "add a logo without a restart" promise
below, broken by the feature that was supposed to inherit it.

## App logos are served by a ROUTE, never linked from `public/`

`public/apps_logo/` holds hand-dropped image files; `src/lib/app-logo.ts`
matches them to display names and `/api/app-logo/[key]` serves them. Its README
is the one to read before adding a logo.

**⚠️ `next start` SNAPSHOTS `public/` AT BOOT.** Measured 2026-09-01 against
the live server:

| Request | |
|---|---|
| `/apps_logo/Claude.svg` — present at boot | 200 |
| `/snapshot-probe.txt` — added after boot | **404** |

The dashboard runs as a logon task and stays up for weeks, so a logo added
today would not appear until the machine rebooted — with the file sitting on
disk, correctly spelled. That failure is indistinguishable from broken matching
code, which is exactly why it is worth a route. The manifest is rebuilt
whenever the folder's mtime moves, so "I'll add more later" needs no restart.

**The key is never joined into a path.** It is looked up in the manifest and
the manifest's own file name is read. `path.join(dir, params.key)` would serve
any file on the machine to anyone on the LAN.

**A miss returns null, not a URL that will 404**, and the caller draws the app's
initial. Most apps have no logo — that has to look deliberate rather than like
a broken image.

**Which logos need a light plate is MEASURED, not guessed** —
`npx tsx scripts/measure-logo-plates.ts`, and `NEEDS_PLATE` is keyed by the
logo IDENTITY, so a scoped file gets its own answer. The rule was written for
`X.svg`: one `<path>` with no `fill`, which SVG defaults to black, so on this
near-black page a logo that loaded perfectly read as a failed lookup.

That file is `X.png` now, so the script no longer sees it — it reads SVG source
and cannot judge a raster, which is why the entry stays in the set by eye. The
script currently lists nothing, and that is the right answer rather than a
regression.

## Visits, not raw sessions

`src/lib/visits.ts`. Both platforms hand over sessions finer-grained than what
a person means by "opening an app", so consecutive sessions of one app are
stitched into a **visit** when nothing else held the foreground in between and
the gap is under 30s.

- **Android** fires `ACTIVITY_RESUMED` per ACTIVITY, not per app. Measured:
  one social app had **158 sessions, 56% of them under five seconds**,
  85 of 157 starting within a minute of the previous ending. The detail page
  read "158 opens, typical session 2.6s" -- a description of the Activity
  lifecycle, not of the person. After stitching: **99 opens, typical 1m 3s**.
- **Windows** ends a span on every focus change, so alt-tabbing away and back
  is three spans of one app.

Two rules keep it honest, both tested:

1. **Adjacency is judged against the GLOBAL session order**, across every app.
   If you left Instagram, used Messenger and came back, that is two visits
   however small the gap -- and looking only at one app's rows cannot tell the
   difference.
2. **Duration is SUMMED, never spanned.** A visit is the sum of its sessions,
   not last-end minus first-start. Spanning would invent the gap time as usage,
   which is the exact failure this project keeps finding elsewhere.

`VISIT_GAP_MS` is a judgement (30s), not a measurement, which is why it is one
named constant rather than sprinkled through the queries.

## Spacing between top-level cards

`.card` carries no margin and `.grid`'s gap only applies INSIDE a grid, so
consecutive full-width cards sat flush -- separated by nothing but their two
1px borders, which reads as a seam rather than two panels. Measured at **0px**
between every sibling before `.container > * + *` was added.

It went unnoticed while most pages kept their cards in grids. Giving the charts
a full-width row each made four cards stack directly and the seams became the
most obvious thing on the page.

## Charts get a full-width row each

Side by side they were ~380px, which is not enough for 24 hourly bars or a
month of days: bars collapse to a few pixels and axis labels collide. A time
series is read left to right, so width is the dimension carrying information.

## What each page holds, and in what order

    Overview   score cards (laptop: one row of three; phone: screen time
               over unlocks, two rows of three, each latest day / per day /
               range total), Daily trend (line), Activity heat map,
               Shape of the day, then "Where the time went" (laptop) or
               "Attributed vs unaccounted" (phone) LAST
    By App     Top apps, Most opened, then the app table. NO score cards:
               the totals are on the Overview, and the system/non-system
               split was dropped -- on the phone it read FLAG_SYSTEM, which
               counts preinstalled YouTube as "system".
    Activity   the heat map expanded: every day, six months to a row

The rankings live on By App because that is the page the apps are on. The
trust card sits last on the Overview because it answers "can these numbers be
believed", not "how was the day spent".

### The app table folds its tail, and says what it folded

`lib/app-list.ts`: listed with **10 min or more**, OR **30+ opens across 5+
days**. Time alone is deliberately enough -- requiring opens and days too hid
38 minutes of a browser on one phone, one sitting on one day. The days floor on
the habit clause keeps one afternoon of alt-tabbing through a dialog out.

The rest are behind **Show all N apps**, whose note gives their count and
their time, so on Windows the table still visibly sums to the active total.
If nothing clears the bar, everything is shown -- an empty table over a button
is worse than a table of small numbers. The charts always rank every app;
only the table folds.

### The trend is ONE continuous LINE; a missing day is drawn at ZERO

`TrendChart` on the Overviews; the app detail pages keep `DailyTrendChart`'s
bars, read beside the same-shaped opens chart. A bar chart could omit a
missing day and nobody noticed. A line JOINS its points, so a week the laptop
sat shut would be drawn as a slope of invented usage. `fillDays()` puts a NULL
on every unrecorded day, and the chart plots that null at zero. The Heaviest
day callout is the sibling's, from `heaviestDay()`.

**The owner's call, made 2026-09-23: one unbroken line, dipping to zero.**
Two earlier versions were rejected. Breaking the line at a null was reported
as a broken chart, over a day the laptop spent hibernated. Shading the hole
with a "Not recorded" label was then rejected as clutter in the middle of the
chart. Do not reintroduce either.

The null is still kept in the DATA, not replaced by 0 in `fillDays()`. The
tooltip says "Not recorded", and the screen-reader summary counts those days
apart from quiet ones and leaves them out of the average. Only the plotted
`plot` field is zero.

### The heat map is the sibling's, with two departures

Ported class for class from Data Usage Tracker (`lib/heatmap.ts`,
`ActivityHeatmap.tsx`): 26 Saturday-first weeks, the device's `--hm-N` ramp
from `accent.ts`, a hairline for never-recorded days. It ignores the range
selector, as the sibling's does.

- **Shades are EVEN steps.** The sibling skews them to the low end because
  torrent days are an order of magnitude above the rest. A day of screen time
  cannot pass 24 hours; borrow the skewed steps and nearly every day lands in
  the top two shades.
- **Expand is always offered, and the expanded page starts at the 1st of the
  data's first month.** The sibling hides Expand until data is older than six
  months and opens its page on a fixed 1 January. Here that would hide the
  button until 2027 and open the page on seven months of outlined days before
  the sampler existed.

## Apps merged by key, and the ones deliberately left apart

`KNOWN` in `app-name.ts` merges by sharing a `key`, as 7-Zip always did.
Merged 2026-09-23: **ShellHost, ShellExperienceHost and sihost -> Windows
Shell** (all draw taskbar flyouts; which exe owns which moves between builds),
and **NVDisplay.Container -> NVIDIA Control Panel** (the container is recorded
as a bare name, so it cannot inherit the package key and is pointed at it).

Weighed and kept apart, so the question is not reopened from scratch: the
NVIDIA App (a different program), Start Menu and Windows Search (surfaces a
person names), Edge WebView2 (other apps' UI runtime, not Edge), the two
PowerShells, and the PowerToys utilities (one product, but each has its own
icon; about a minute between them). The phones have no merge layer at all --
rows are packages, which the phone names itself -- and nothing there was worth
building one for. The table with reasons is in `docs/PROGRESS.md`, 2026-09-23.

## Phones get the DESKTOP layout, on purpose

`export const viewport = { width: 1024, initialScale: undefined }` in the root
layout. A phone renders the 1024px page scaled to fit, exactly as it does on
the laptop, instead of reflowing. Confirmed on the phone 2026-09-23.

- **Do not "fix" it back to `device-width`.** The narrow-screen rules (860px,
  720px) now only ever fire for a narrow DESKTOP window.
- **`initialScale` must stay cleared.** Next's default viewport carries
  `initial-scale=1`, and with a fixed width that opens the page at 100% --
  zoomed in on the top-left corner, the rest a sideways scroll away.
  `undefined` drops it from the tag; check with
  `curl -H "Accept: text/html" -H "Sec-Fetch-Dest: document" http://<lan>:7844/`.
- **1024, not Chrome's 980**, because the three-across stat rows were measured
  to fit at 997px with the sidebar collapsed.

The sidebar is **collapsed by default** (`Sidebar.tsx`): only a stored `'0'`,
written when someone opens it with the hamburger, expands it. On a 1024px
canvas a 232px sidebar is a fifth of a phone's screen spent on device names.
Skeletons are measured with it collapsed for the same reason.
