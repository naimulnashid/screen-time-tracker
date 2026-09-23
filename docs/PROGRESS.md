# Progress

Working notes. `CLAUDE.md` is the orientation doc; this is the running log.

## Now

**Phase 0 complete. Phase 1a (Windows) complete and it came back negative.**

- [x] **Windows probe.** SRUM's `AppTimelineProvider` IS populated - and is not
      screen time. `DurationMs` is process presence: 79.5x over wall-clock
      budget, 439 rows concurrent, and `svchost.exe` on top with 5,626 hours.
      Retention is 7 days. **Phase 3 becomes a foreground-window sampler**,
      which needs no elevation - a better position than we expected to be in.
- [x] **Phone on USB.** Connected 2026-08-31. Capture and analysis both run.

## Phase 1 - what has to be answered

### Android - MEASURED 2026-08-31

- [x] Retention of the daily rollup: **10 daily files, ~10 days.** Weekly 4,
      monthly 6, yearly 2. Per-day resolution is gone after ten days, so the
      collector must run well inside that. 6-hourly is ample.
- [~] Retention of `queryEvents`: **dumpsys shows only 24 h**, but that is a
      property of the DUMP, not the API. Must be measured from the APK in
      Phase 2 - it decides whether events can be the primary store.
- [x] Does `totalTimeUsed` accrue with the screen off? **Not measurably here.**
      0.94x of screen-on; `totalTimeVisible` only 1.0%
      higher. Re-check if the device or Android version changes.
- [x] Agreement with Digital Wellbeing. **Run, and it caught two bugs.**
      We read over five times the phone's figure (rolling window vs calendar
      day), then a quarter too little (in-flight session discarded). Both fixed; the figures now
      reconcile. This is the only external check the project has - re-run it
      after any change to the event reconstruction.
- [x] Per-app sum vs screen-on: **0.76x - it UNDERSHOOTS**, which corrects the
      assumption written into CLAUDE.md during Phase 0. The overshoot risk is
      `totalTimeFS` (2.07x screen-on), not overlapping apps.
- [x] Which packages are not "apps": the launcher accrues 57m across 355
      sessions, and `com.niksatyr.volumecontroller` reports 16h18m of
      foreground-SERVICE time with zero foreground time.

### Windows - CLOSED 2026-08-31

- [x] Is `AppTimelineProvider` populated on Windows 11 build 26200? **Yes** -
      46,243 rows, 522 apps, 6.7 days retained.
- [x] Units of `InFocusDuration`? **The column does not exist.** SrumECmd
      2026.5.0 emits 12 columns and the only duration is `DurationMs`.
- [x] Is `DurationMs` usable as screen time? **No.** Four independent tests
      agree: sum 12,792 h in a 160.9 h window (79.5x), peak concurrency 439,
      union coverage 43%, and the top app by a factor of 40 is `svchost.exe`.
      It measures per-process presence.
- [x] Decision: **foreground-window sampler**, unelevated. Do NOT chase
      `InFocusDuration` through a custom ESE parser - 7-day retention makes
      even a perfect read fragile, and the sibling project rejected
      hand-written ESE parsing for good reasons.

Left open for Phase 3, small: does the sampler persist the IN-FLIGHT session,
or only on focus change? That decides whether the app you are looking at right
now shows up before you switch away from it.

## Decisions made

- **Separate repo**, not a section inside Data Usage Tracker. Costs a forked
  copy of the app-identity layer later; keeps one project per domain, matching
  the rest of this machine.
- **Android first.** The permission is already granted on the phone, the API is
  public and documented, and phone screen time is the more interesting number.
  The Windows half is the one with an open question at its foundation.
- **No usage tables until Phase 1 lands.** See CHANGELOG.

## Log

### 2026-09-04 - brand colours for 14 new logos

106 -> 115 logo files (laptop 35, Nothing 66, Redmi 19). The coverage
self-test caught every newcomer at once, which is what it exists for: a
missing colour falls back to the device accent, so a gap reads as an app that
chose violet rather than as a gap.

Two of the three documented failure modes recurred, which is the useful part
-- they are not quirks of two particular files:

- **MIUI Camera**, `#262a39`: the dark lens body. Largest coloured area of the
  icon, and dark enough that `ensureReadable` lifts it to `#5f626d`, a flat
  grey. Fixed to `#f64786`, the ring's pink -- found only by sampling at the
  file's native 285px, since at 64px the thin ring blurs away entirely.
- **Edge WebView2**, `#66eb6e`: the Edge green-stop failure, verbatim, second
  time. Matched to `microsoftedge`.

Kept and documented rather than fixed: PowerToys Shortcut Guide at `#36c8f6`,
9 from Edge. No second honest reading exists -- the icon is a grey keyboard
with one cyan arrow -- and PowerToys' amber is not a paint in that file.

`systemui` is bare (the two phones' files are byte-identical); every other
Redmi icon is scoped, the laptop's are not, because phones multiply and there
is only ever one laptop.

`settings` had to be pinned with a note: the Redmi's artwork was swapped for a
flatter version at saturation 0.20, under the 0.25 candidate floor, so the
script now proposes nothing for a file that looks unchanged.

### 2026-09-04 - the laptop gets an address that names it

`/windows/zephyrus-g16`, the same shape as `/android/nothing-a001`. The
laptop had kept the bare `/`, `/apps` and `/sync`, and CLAUDE.md argued for
that on the grounds that moving it would break bookmarks for no visible gain.
The gain showed up when the sidebar reached three devices: **`/apps` cannot
say whose apps it means.**

The slug is `slugify(deviceLabel())`, so `slugify` moved out of
`android-ingest.ts` into its own `src/lib/slug.ts` -- `config.ts` is
deliberately not `server-only` and could not import a module that reaches
`node:sqlite`.

Nothing persists the laptop's slug, unlike the phones' (a column in
`android_devices`). One machine, nothing to disambiguate, so a rename in
`collector.json` moves the URL along with the heading and the sidebar entry.

Every old address redirects, and **carries the query string**: `redirect()`
does not do that on its own, so a bookmarked `/apps?days=7` would otherwise
have landed on the full range with nothing saying the scope had moved.
`/apps/<key>` passes the key through undecoded -- it is already
percent-encoded, and re-encoding a decoded key doubles the escapes on the `%`
and `/` that keys like `exe:visual studio/setup` genuinely carry.

Verified against the running server rather than reasoned about: all six
redirects land where they should with `?days=7` intact, the three laptop
pages render their own headings, the sidebar and tab hrefs come out scoped,
and the app table's links now read
`/windows/zephyrus-g16/apps/appx%3Aclaude_pzs8sxrjxfjjc`. 16 new self-tests
assert the two page sets have the same shape, so changing one without the
other shows up in a single diff.

### 2026-09-04 - second phone added, and a backup status that lied

- **Xiaomi Redmi Note 9 Pro registered.** Android 12 / SDK 31. No code change:
  `ingestAndroid` writes the device row and derives the slug. Two syncs, 395
  rows, 0 rejected, 389 labels. App-time to screen-on came out at **0.94x and
  0.82x** on the two days with real use -- inside the 0.76-0.87x band measured
  on the Nothing, which reproduces the ratio on different hardware and a
  four-year-older Android.
- **`backup_status: "failed: not an error"`** turned out to be a lost lock
  race, not a failure. Measured: the destination is never at risk, the loser
  fails before writing, and errcode 0 is what node:sqlite prints when SQLite
  set no code. Backups now queue in-process, retry across processes, and report
  `busy` when they still cannot get the file. See CHANGELOG.

### 2026-08-31 - Phase 0

Scaffolded, builds clean, typechecks clean, serves on 7844.

Chased two Windows-specific dead ends worth remembering: `npm --prefix` with a
spaced path mangles through `cmd.exe`, and the obvious workaround - an 8.3
short path - makes Next's file watcher assert and die *after* printing "Ready".
Both are written up in CLAUDE.md.

Also confirmed the two dashboards would have shared a session cookie, since
cookies ignore the port. Renamed before it could bite.

### 2026-08-31 - Phase 1a, Windows

Probe run elevated; analysis re-run several times unelevated against the CSVs
it left in TEMP. Changed the probe to keep those CSVs and delete only the 99 MB
snapshot, because the first version deleted everything and every tweak to the
analysis would have cost another elevated VSS run.

Two bugs in my own analysis worth remembering, both caught by output that was
impossible rather than merely surprising:

- Assumed `[Timestamp, EndTime]` was a forward interval. It is not - `EndTime`
  is at or before `Timestamp` - so every interval had negative length, giving
  peak concurrency 0 and NEGATIVE coverage. Now both readings are computed and
  reported, and they agree on the verdict.
- `Math.min(...rows.map(...))` over 46k rows is close enough to V8's argument
  limit to be a future stack overflow. Replaced with a loop.

### 2026-08-31 - Phase 1b, Android

Phone connected mid-session. Capture + characterise first, parse second - the
same split that worked on the Windows side, and it paid off again: the
characterisation pass is what revealed `totalTime=` matches 14 configuration
rows rather than 645 package rows, before any parser depended on it.

Four format traps found and written up. The nastiest is that durations are
rendered `MM:SS` or `HH:MM:SS` depending on magnitude, so field count decides
the unit - a 60x error waiting to happen, in the flattering direction.

Corrected a Phase 0 assumption: per-app time UNDERSHOOTS screen-on rather than
overshooting it. The rule it implies is unchanged (headline from screen-on
events, never SUM over apps) but the reason is the opposite of what was
written, and the real overshoot risk is summing `totalTimeFS`.

### 2026-08-31 - the Digital Wellbeing check earned its keep

Asked for one number off the phone and it invalidated two things I had already
written down as measured.

1. Compared a rolling 24h window against a calendar-day figure: over five
   times the phone's number. Not an error in the data, an error in the question.
2. Then low by a quarter - plausible enough that it would have
   shipped. The cause was discarding the in-flight screen-on session. Found by
   capturing twice seven minutes apart and noticing that screen-on did not move
   while the per-app sum did. A figure that stays still while its components
   change is the tell.

The second one also settles the open Windows-sampler question: the in-flight
session must be counted, clipped to now, or every "today" figure under-reports
until you put the device down.

### 2026-08-31 - Phase 2 begins: schema, ingest, endpoint

Foundation done and verified end to end against the running server; the
reporter APK is the remaining piece.

Writing the schema surfaced a contradiction in something I had already
written down as settled. CLAUDE.md said Android event sessions were
"completed, immutable -> INSERT OR IGNORE". That is wrong, and it is the
exact bug the Digital Wellbeing check had just caught: the phone must ship its
IN-FLIGHT session inside the payload, and that span comes back longer next
sync. INSERT OR IGNORE would freeze the first short reading forever.

The rule is not "is the session complete" but "can this row still GROW":

  windows_segments  no   -> INSERT OR IGNORE   (in-flight lives in a heartbeat
                                                file that is never ingested)
  android_daily     yes  -> upsert MAX()
  android_segments  yes  -> upsert MAX()
  android_screen    yes  -> upsert MAX()

Also decided android_screen must be a SEPARATE table from android_segments,
not one table with a kind column like the Windows side. There the kinds are
mutually exclusive so a naive SUM is meaningful; here an app session happens
DURING screen-on, so one table would count the same minutes twice. Two tables
make the double count require an explicit JOIN rather than a forgotten WHERE.

One real bug found by testing rather than reasoning: a sync carrying only
spans erased the device metadata, because the upsert wrote excluded.model etc
unconditionally and a minimal payload sends ''. android_release went "16" ->
"". Now COALESCE(NULLIF(...)) per field, with a test.

## Next

- [ ] The reporter APK. It also has to MEASURE queryEvents' real reach, which
      is still the one open question from Phase 1 - dumpsys showed 24h but
      that is a property of the dump, not the API.
- [ ] Android dashboard pages, and the Windows pages, which still do not exist.

### 2026-08-31 - Phases 2 and 4 complete

Android pages landed, closing Phase 2 and fixing a sidebar entry that had been
pointing at a route which did not exist. Loading the page immediately surfaced
a latent bug: node:sqlite returns rows with a NULL PROTOTYPE and React refuses
to pass those from a server component to a client one. It had been invisible
for as long as no phone had reported, because an empty array serialises fine.

Then the reset drill - the first thing in this project to test the claim the
whole project rests on. It failed on its first run, twice over: the CODE had no
copy off the system drive (no git remote, repo on C:), and the SECRETS were
gitignored with no copy anywhere. Either one would have turned a reset into
total loss while the database backup sat there looking healthy.

restore.ps1 was then actually RUN rather than merely written: 9,779 rows
restored and verified, dashboard still reading afterwards.

## Still open

- [ ] **No git remote.** The bundle is a stopgap that has to be re-run by hand
      after commits. A remote would be strictly better.
- [ ] **No dashboard autostart.** The site runs only while a dev server is up,
      while both collectors keep writing. Needs the equivalent of the sibling's
      install-autostart.ps1.
- [ ] Loading skeletons, app detail pages, logos.
- [ ] Monitor-off while UNLOCKED is still undetected on Windows.
- [ ] The `unresolved` UWP flag is stored but nothing surfaces it.

### 2026-08-31 - dashboard autostart

The dashboard now survives this session ending. Three logon/scheduled tasks in
total, all unelevated: Sampler (records), Ingest (stores), Dashboard (serves).

Ordering matters and cost time earlier: the dev server had to be stopped and
.next cleared BEFORE registering, because `next build` against a live
`next dev` replaces chunks the dev server holds open. dashboard-stop.ps1 exists
so that is one command rather than a hunt.

Two PowerShell traps hit while writing it, both the same shape as the em-dash
rule - punctuation that is inert in every other language and load-bearing here:
a backtick in a double-quoted string is an escape, so a markdown-quoted command
printed as a newline; and `>>` writes UTF-16 while Add-Content writes ANSI, so
the log came out in two encodings and tail rendered it as " R e a d y   i n ".

### 2026-09-02 - the gate stops moving you, and Sync now goes in the chrome

Reported as an asymmetry: leaving the tab on the Overview and coming back put
the address bar on `/login`, while the phone's Overview seemed not to. `curl`
settled that half immediately - `/`, `/apps`, `/sync` and
`/android/nothing-a001` all 307 to `/login` when the cookie is absent, so the
code was symmetric and the difference was in how often each page gets reloaded
from cold. The session itself is 30 days and renews daily; what moves the URL
is a browser reload of a discarded tab, not an expiry.

So the fix is not to the auth lifetime but to what the gate DOES. Middleware now
REWRITES the login form over the requested path for a document request, and the
address bar keeps the page you were on. The `?next=` dance falls out entirely:
after a successful login `router.refresh()` re-renders the current URL. The
redirect survives for RSC requests, which want a flight response rather than
HTML - `isDocumentRequest()` reads `sec-fetch-dest`, falls back to `accept`,
and excludes Next's `RSC` header and `_rsc` query first, since a prefetch
carries an HTML `accept` too.

Sync now moved to the top bar at the same time, laptop pages only. It closes a
gap in the DATABASE, and By App and Sync Status were as stale as the Overview
with no button of their own. It leads the right-hand group, to the left of the
range chips: it shares their `chip` styling, so sitting among them it read as a
fourth range.

### 2026-09-02 - subtitles say how fresh the numbers are

Both Overviews now lead with `Latest data <day> - collected <n> ago`. The date
alone could not separate "quiet day" from "the collector died on Tuesday",
which is the confusion the hourly ingest was supposed to end and the page was
still not resolving.

`collectedAgo()` reads the newest **successful** `sync_log` run, never merely
the newest. A failed run collected nothing, and stamping the page with its
timestamp would claim the numbers are fresh at the exact moment they stopped
being - the one lie a freshness line must not tell.

The device name came out of every Android subtitle at the same time: the
sidebar names the phone and the accent colour says it again, so a third copy on
every page was chrome repeating itself. The Android release moved to a Stored
row on Sync Status, beside the `queryEvents` reach it helps explain.

`formatRelative` had been written in Phase 0 and never called. Wiring it up
found it rounding AFTER comparing, so 59.7 minutes printed as "60 min ago" - a
rung it had already left. Six self-tests now hold the boundaries.

### 2026-09-02 - unlocks, opens-over-time, and why history stops at 21 August

The phone's Overview traded its "Unlocked" card - unlocked time as a share of
screen-on, a ratio that barely moves - for two unlock COUNTS. Same habit,
measured in a way that varies. App pages gained Opens per day and When it gets
opened, beside the two time charts they are meant to be read against: a tall
time bar over a short opens bar is one long sitting, the reverse is compulsive
checking, and neither chart alone can tell those apart.

Both counts had the same trap in them. `android_screen` and `android_segments`
store spans split at local hour boundaries, so counting ROWS multiplies any
span that crossed an hour. Measured: 1,203 unlocked rows are 1,113 real
unlocks. Both now count sessions, filed under the day or hour they STARTED -
time is split at midnight because time was genuinely spent on both sides, but
an open happened at one instant and splitting it would invent one.

**Why Digital Wellbeing reaches back to 8 August and this does not.** Traced
through `sync_log`: the first successful phone sync ran 2026-08-31T03:13 and
`queryEvents` reached exactly **10.0 days**, to 2026-08-21T03:21. That is the
floor, and it is the documented reach behaving exactly as measured in Phase 1.
Digital Wellbeing is not reading `queryEvents` - it keeps its own long-lived
store and the weekly/monthly rollups, which is the `queryAndAggregateUsageStats`
path this project implemented, measured and removed the same day for reporting
more than 24 hours of foreground time on 88 of 96 days. So 8-20 August is
permanently unavailable: it was already gone from the events API before the app
was installed, and the only API reaching further returns figures that break the
physical bound. It does not recur, because the database persists - already 13
days stored against 12.1 reachable, the store outliving its source.

### 2026-09-02 - the reach figure, fixed

`events_reach_utc` could only ever grow. The upsert kept `MIN(stored,
incoming)` so a short reading after a reboot could not spoil it, which pinned
an absolute timestamp forever - the Sync page reports the span from it, so the
figure rose with the clock: 10.0 days at the first sync, 12.1 days twelve days
later, off a value that had not moved. The card says "if this figure falls,
sync more often"; under MIN it could not fall.

Two changes. The last measurement now wins - a short reading is corrected by
the next sync, and a reach that really has shortened is the thing the card
exists to report. And the span is measured against `last_seen_utc` rather than
`Date.now()`, so it stops creeping between syncs; a phone silent for a week was
otherwise claiming a week more history than it had when last asked. No
migration: the stored value corrects itself on the next sync.

### 2026-09-02 - a second ranking

A "Most opened" chart joined Top apps on both Overviews. The two rankings
disagree enough to justify both: on the phone, Google, Phone and Telegram are
in the top eight by opens and nowhere in the top eight by time, and Nothing
Launcher is third by time but first by opens with 2,908 - passing through the
home screen is not using an app, and only one of the charts can see it. The
launcher is left in rather than filtered out; what counts as an app is the
reader's judgement, and a hidden filter is the kind of thing this project keeps
finding as a bug elsewhere.

### 2026-09-02 - the launcher leaves the opens ranking

Nothing Launcher recorded 2,908 opens against 999 for the next entry - nearly
three times the tallest real bar - while sitting only third by time. The
launcher is the surface you pass through between apps, so on a ranking of "what
did I reach for" it answered a different question and flattened every bar that
answered the right one. Excluding it takes the chart's spread from 29x to
10.4x and promotes Maps into the eight.

Excluded from the OPENS ranking only. It keeps Top apps, the By App table and
its detail page, because nine hours on the home screen is a real fact and
hiding it would be the more misleading choice. Two questions, one wrong answer.

The card names what it dropped, and that is the load-bearing part. Android
gives no queryable "is this the home app" signal in what the phone uploads -
that is a CATEGORY_HOME intent resolution, resolved on the device - so
`home-surface.ts` is a NAME rule, and a name rule can be wrong. Printing the
label of whatever it matched turns a silent filter into a visible one; if it
ever catches a real app, the page says which. Ten self-tests hold the rule,
including that `com.launcher.example.reader` does not match - `includes` would
have dropped it.

The laptop was checked and left alone: Edge 442, Explorer 441, Claude 260. No
runaway, nothing to fix.

### 2026-09-03 - brand colours for all 91 logos

The ranked charts have coloured bars by brand since the map existed, but the
map held 27 entries against 91 logo files, so most bars fell back to the device
accent. On the laptop that meant seven of the top eight were violet and the
chart read as a single colour.

Re-ran `measure-logo-colours.ts` (sharp installed with `--no-save` for the run
and removed after, exactly as the script's own header says to), then hand-fixed
seven values. Four are the documented tie-break failure - Edge came back GREEN,
Sheets near-BLACK, Google yellow again, VLC amber - and the Edge one is the
instructive case: `#66eb6e` is a real stop in its gradient, used twice where
every other stop appears once, so it wins on count rather than on saturation.
Reading the hex alone would not tell you anything was wrong.

Coverage now: 31 of the 32 slots across the four charts carry a brand colour.
The exception is Windows Search, which has no logo file, and inventing a colour
for an app with nothing to derive it from is the one thing this map must not
do.

Found while re-checking: the claim in `app-colour.ts` that no colour tripped
the readability floor was already false. About one entry in seven trips it
now. Corrected there and in `CLAUDE.md`, and a self-test now asserts on
`brandColour()`'s output rather than on the map, which is what the chart draws.

### 2026-09-03 - Chrome goes back to yellow

Asked why Chrome's bar was blue when there is no blue in the logo. There is -
the centre disc, a #81B4E0 -> #0C5A94 gradient - but the question was the right
one to ask, because it exposed something the hex alone does not show: #4285f4
is not a paint in Chrome.svg at all. The repo carries the LEGACY gradient logo,
whose blue is a muted steel; #4285f4 came from brand knowledge.

That is a different kind of error from the tie-break failures. Those are the
script picking the wrong paint FROM the file, and the fix is to pick another
one. This was a value with no provenance in the file at all, which means
nothing about it can be argued with later. Checked the rest: Gmail, Maps,
Photos, Google, Edge, Sheets and VLC all take a hex that IS in their own file.
Gemini does not, and is now flagged in place rather than left to be found.

Chrome is #fcd209, which is what the script said in the first place - right by
accident, off a saturation tie it does not understand. The ring is what a
person sees; the blue is the middle of the mark.

No new collisions: Chrome is not in either phone chart's top eight today. The
collisions that DO exist are honest ones - Facebook and Messenger really are
both blue, X and ChatGPT really are both monochrome - and separating them would
mean inventing a colour, which is the thing this map must not do. Bar length
and the axis label carry the data; colour is recognition, not encoding.

### 2026-09-21 - stopping and starting go by this dashboard, not the port

`dashboard-stop.ps1` stopped every process listening on 7844, with no check
at all on what it was. The sibling had just lost its dashboard for hours to the
same shape: a demo server bound `127.0.0.1` on its port beside the real
wildcard listener, and a kill-by-port cleanup took both.

Ownership is now by command line: a listener is ours only when it runs Next.js
out of this repo's `node_modules\`. Anything else is left alone and named, an
unreadable command line counts as not ours, and the closing check asks whether
THIS dashboard is gone rather than whether the port is free. `-WhatIf` names the
PID it would stop.

Verified on a spare port with stand-in listeners, both ways round, with
strangers carrying another dashboard's `node_modules` path and a folder name
that only starts with this one's: only ours was stopped, and `-WhatIf` stopped
nothing. Then `-WhatIf` against the live servers on 7842-7846: it named this
dashboard's PID on 7844 and nothing on the other four.

The logon launcher's "already served?" check got the same rule. It used to
exit 0 for any owner of 7844; now another program is logged, NOT starting,
exit 1. Verified with guarded copies of `dashboard-service.ps1` (an `exit 99`
right after the check, so nothing could build or start): port free reaches the
guard; another dashboard's path, or a folder name that only starts with this
one's, is refused with exit 1 (the committed version said `already served`,
exit 0); ours beside a stranger is `already served by this dashboard` with
ours' PID; and against the live server on 7844 it named the live PID.


### 2026-09-23 - By App trimmed, a heat map, a trend line

Five asks in one pass: a cut-off for the By App table with a Show all button;
a look for apps that should merge; "Where the time went" to the bottom of the
Overview; Top apps and Most opened moved to By App above the score cards; and
the sibling's Activity heat map (with Expand) plus a line-shaped trend with a
Heaviest day callout on the Overview.

**The cut-off** is 10 min, or 30+ opens across 5+ days. Time alone is enough
on purpose: requiring opens and days as well hid 38 minutes of a browser on
one phone, one sitting on one day. The habit clause keeps apps opened often
but briefly -- dozens of opens over weeks, a few minutes in total.

**Merges, decided app by app against the real list:**

| Rows | Verdict |
|---|---|
| Windows Shell Host, Windows Shell, sihost | **merged** -> Windows Shell. All draw taskbar flyouts; which exe owns which moves between builds. You had given the first two one logo already. |
| nvidiacontrolpanel, NVDisplay.Container | **merged** -> NVIDIA Control Panel. The container hosts the panel's right-click entry and tray menu. |
| NVIDIA App | kept. A different program (GeForce Experience's successor), even with the same logo. |
| Start Menu, Windows Search | kept. Surfaces a person names, each with its own logo. |
| Microsoft Edge, Edge WebView2 | kept. WebView2 is the runtime OTHER apps draw their UI in, not Edge. |
| PowerShell 7, Windows PowerShell | kept. Two products, two logos. |
| PowerToys Settings and its four module rows | kept, for now. One product, but each utility has its own icon and the Color Picker one had just been added; together they are about a minute. Worth merging if the rows bother you. |
| Android Emulator, Android Studio | kept. The emulator runs without the IDE. |
| Phones: Settings / Settings Suggestions, Files / Files by Google, the photo pickers | kept. Different packages the phone names itself; merging would need a package-alias layer the Android queries do not have, for under a minute of time. |

With the merges the laptop has 59 apps where it had 62. The keys
`exe:shellhost` and `exe:nvdisplay.container` no longer exist, so their detail
URLs 404. Only Windows Shell Host had a detail page (20 minutes); its time is
on the Windows Shell page now, which kept its own key and URL.

**Left as found:** `npm run selftest` fails one check, `every logo has a brand
colour`, over the 17 logos sitting untracked in `public/apps_logo/`. They are
not part of this change. Two of them -- `Windows Shell Host.svg` and
`NVDisplay.Container.svg` -- no longer name an app after the merges, and each
is byte-identical to the logo that does.

### 2026-09-23 - no system split; the phone's Overview gets totals

Asked what By App's cards meant, the answer exposed the phone's System card as
misleading: `FLAG_SYSTEM` marks preinstalled apps, so one preinstalled video app
was most of it. All three cards are gone from By App on both devices. The phone's
Overview is two rows of three, screen time over unlocks, each ending in a range
total -- the laptop already had Range total. `.grid--3` drops its floor to
215px so the rows stay three wide at 997px; checked there and at 1680px.

The row-level `system` badge in the tables stays for now; it has the same
FLAG_SYSTEM caveat on the phone.

### 2026-09-23 - preparing to publish: logos, colours and config go local

Asked whether the repo was ready to make public. A full audit (kept out of the
repo, since it describes the private data) said no, for reasons that had
nothing to do with the code: the repo named every app on three personal
devices, banking and password apps included, and the docs quoted personal
usage figures. Decisions: publish from a fresh single-commit history, keep
logos and colours local, MIT, scrub and keep the docs.

Phase A of six is this one. The part worth remembering is the consequence:
**gitignoring a file removes git's protection from a reset**, and this
project exists to survive one. So the kit now mirrors the local-only files
beside the backup and the drill fails on a stale mirror -- otherwise the
logos, colours and, worst, collector.json (without which a clone cannot even
find the backup) would have been lost silently by the first reset after
publishing. Checked in a simulated fresh clone: 138 files, typecheck clean,
317 self-tests pass, and the drill names the missing config instead of
crashing.

### 2026-09-23 - Phase B: security, checked against a real build

Every fix went through the self-test (355 pass) and then through a production
build served from a scratch copy on port 7899 with throwaway secrets, so the
live dashboard's .next was never touched. The live pass was worth it: it
found that the logo route's sandboxing CSP never reached the browser, because
next.config headers overwrite a route's own. The unit tests could not have
seen that.

Two things the owner has to do, both deliberately not automated:

- **Sign in again on each device** once the dashboard rebuilds. The session
  key changed, so every existing cookie is invalid.
- **Run npm run firewall from an Administrator shell** to keep 7844 off Public
  networks. First mark the home Wi-Fi Private: it is filed as Public today, and
  node.exe is allowed on Public for every port, so the dashboard is currently
  reachable on any network the laptop joins.

Unexplained and recorded: on the first live run the throttle admitted 29
guesses rather than 30. Three fresh runs admitted exactly 30, including one
that replayed the same preceding requests. It erred toward fewer guesses.

### 2026-09-23 - Phase C: accessibility

Contrast, titles, chart summaries, live regions, a skip link and aria-current,
checked on the signed-in pages in a real browser as well as in the self-test
(364 pass). The worst failure was the one most visible: the phone pages'
active chip, white on green at 1.78:1.

Getting a signed-in page into the browser pane turned up a trap worth
keeping: the pane holds an httpOnly session for localhost, cookies ignore the
port, and its autofill posts to /api/login on its own -- three requests in
20 ms that no code in the page sends. Test on 127.0.0.1 instead. That is
almost certainly why Phase B's first throttle run admitted 29 guesses rather
than 30: the browser tab sitting on the login page had already spent one.

### 2026-09-23 - Phase D: dead code, and the bug under it

The sweep was meant to delete things. The most useful thing it found was a
live bug: the logo plate's CSS variable was never defined, so the X logo has
been invisible all along, and the one rule that did draw a plate was the
duplicate being deleted as dead. Removing dead code by proving it dead --
effective declarations diffed before and after, 0 values changed -- is what
surfaced it; deleting on a hunch would have made the bug permanent.

Also worth knowing: the whole heat-map CSS section existed twice, the first
copy fully shadowed, and .table-more rendered as a merge of two definitions
that neither comment described.

### 2026-09-23 - Phase E: licence, docs, CI and a demo

The screenshots were the interesting problem: a public README wants them, and
a screenshot of this dashboard is exactly the personal data the earlier phases
removed. So the README shows a synthetic installation, seeded through the real
write paths, served from a scratch copy and captured by headless Edge. The
live dashboard was then stopped only for the Next update and rebuilt by its
own logon task, with all five phases in it. Signing in again is expected.

### 2026-09-23 - a hole in the trend line

Reported as a broken chart. It was a correct chart that looked broken: the
laptop hibernated through a whole day, and the line break that
`fillDays()` deliberately puts there looked like a glitch with nothing around
it. A labelled band over the hole was tried first and rejected as clutter.
What shipped is the owner's preference: one continuous line, drawing a
missing day at zero. The tooltip still tells a missing day apart from a
quiet one, since the null survives in the data.

### 2026-09-23 - the sampler repairs a logoff at its next start

The hole in the trend line had a cause worth fixing. A logoff kills the
sampler without its cleanup, and the next one started blind. Now the
heartbeat says whether its run closed, and a sampler that finds it did not
writes the lost span and a gap before it begins. That work happens at
startup, so shutdown time is unaffected. A mutex keeps it to one sampler per
folder. Tested with a real kill, a second copy, and a heartbeat 40 days old,
which also exposed an Int32 overflow in span lengths that is now fixed.

### 2026-09-23 - a signed APK on GitHub Releases

There were no releases, only the v1.0.0 tag, and no APK anywhere public. The
phone app now has a release key, kept with the other secrets and covered by
the kit and the drill, and the signed APK is attached to a v1.0.0 Release.
Phones running the old debug build must uninstall it before installing the
release, because the signatures differ.
