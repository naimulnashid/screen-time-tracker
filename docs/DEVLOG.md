# Development log

What changed, why, and what was measured to decide it -- newest first. This
was the project's CHANGELOG.md until v1.0.0; the release log is now
[`../CHANGELOG.md`](../CHANGELOG.md), and `CLAUDE.md` is the orientation doc.

## After 1.0.0

### Next.js 16 and React 19.3, from the first Dependabot PRs

- **Three PRs arrived with the first Dependabot run.** The minor/patch group
  (React 19.3, tsx 4.23, type packages) and Next 16 passed CI and are
  applied. TypeScript 7 failed CI and is declined, with its major versions
  now ignored in `dependabot.yml`.
- **Applied as commits authored here, not merged**, so master keeps one
  author. Next resolved to 16.3.6, a patch newer than the PR's 16.3.5.
- **Next 16 was A/B tested against Next 15** before it landed: both builds of
  the same commit served the synthetic demo on scratch ports. All eight
  device pages, the legacy redirects (keeping `?days=7`), sign-in, the
  cross-origin refusal, the security headers and the logo sandbox matched.
- **Two things differ, both handled.** The build rewrites `tsconfig.json`
  (`jsx: react-jsx`, plus `.next/dev/types`), so both values are now
  committed. And it warns that the `middleware` file convention is
  deprecated for `proxy`. The gate still runs; the rename is left for later.
- **Found while testing, and older than this change:** on a fresh production
  build, the login form rewritten in place over a dashboard URL is sent with
  `cache-control: s-maxage=31536000`, not the middleware's `no-store`.
  Because `/login` is prerendered as static, Next's own header replaces the
  middleware's. Next 15 does the same, and the long-running live server
  happened to send `no-store`, which is how this went unseen. A wrong device
  slug also renders the not-found page with status 200 on both versions.

### A signed release APK, published on GitHub Releases

- **The phone app now has a real release signing key**, and the APK is
  attached to the v1.0.0 GitHub Release rather than committed. The owner chose
  that over a committed binary, which would add ~2 MB to every clone's
  history for each version.
- **The key and passwords never enter git**, in either repo:
  `android/keystore.properties` (gitignored) points at a `.jks` kept in the
  non-synced recovery folder. The kit copies the properties file there, and
  the drill fails if the key is missing, on the system drive, or stale.
- **No key, no signature:** a clone without the properties file builds an
  UNSIGNED release and says so, rather than silently debug-signing it.
- The README now points phone users at Releases first, and says why a
  self-built APK cannot install over the released one.

### The sampler survives a logoff: startup recovers what the kill lost

- **The heartbeat now says whether its run closed cleanly.** `closed` is set
  only in `finally`, after the in-flight span is on disk. A logoff, a kill or
  a crash leaves it false.
- **A sampler that starts and finds an unclosed heartbeat repairs the
  record.** It writes the dead run's in-flight span up to that run's last
  sample, then a `gap` from there to its own start. A kill now loses at most
  one 2-second interval instead of the whole span, and time with the sampler
  down becomes an explicit `gap` rather than no rows at all. Tested with a
  real kill under Windows PowerShell 5.1: the recovered span, the gap and the
  new run meet to the millisecond. This adds no work at sign-out or shutdown;
  the repair happens at the next start.
- **Only one sampler per output folder**, by a named mutex. A second copy
  exits. Without that, it would double-count and "recover" live spans.
- **Span lengths are `[long]`, not `[int]`.** Int32 milliseconds overflow at
  24.8 days, so a month switched off would have crashed the sampler at
  startup. Tested with a 40-day heartbeat.
- **Gap-only days are not days with data.** The Windows day count, the range
  anchor and the daily series ignore `gap` rows. Otherwise a recovered gap
  across a switched-off day would lower the daily average and chart as a
  recorded zero rather than "Not recorded".

### The trend line is one continuous line; a missing day dips to zero

- **Reported: the laptop's Daily trend "looks broken" around one day.**
  The data was right. The laptop hibernated through that whole day (Kernel-Power
  42, then the clock jumping more than a day), so the day has no rows.
  `fillDays()` makes it null, and the line broke there by design. But a bare
  wedge cut out of the area read as a rendering fault.
- **First fix, reverted the same day:** a faint band labelled "Not recorded"
  over each hole. The owner did not want text in the middle of the chart.
- **What shipped:** the chart plots a null day at ZERO, so the line is one
  continuous line that dips to the floor. The null stays in the data, so the
  tooltip still says "Not recorded", and the text summary still counts those
  days separately and leaves them out of the average.
- **Why no `gap` row covers the day:** Windows logged the session off before
  hibernating (Winlogon 7002), which kills the sampler without its `finally`.
  The sampler started at the next logon has no memory of the last one, so
  nothing spans the hole. The few seconds in flight at the kill were lost too.
  Fixed in the entry above.

### Screenshots: every page, full length, in brand colours, with no device names

- **The demo phone is "My Phone"**, like "My Laptop". Its Pixel-specific apps
  became generic ones (Launcher, Camera).
- **Bars are in brand colours.** The seeder writes the demo's own
  config/app-colours.json. With no logo files, colours are keyed by app
  name, and Camera and Launcher are left out to show the accent fallback.
- **A tour of every page**, full length, in collapsible sections in the README:
  Overview, By App, app detail, Activity and Sync Status for both devices.
- **The demo now looks like a real installation.** Apps cover 0.75x of
  screen-on time (it was 0.97x, contradicting the 0.76x the README quotes).
  Sync runs are backdated onto the real cadence, not all stamped one minute.
  The capture writes a fresh heartbeat so the Sync page shows a running
  sampler.
- **npm run demo:seed renames before deleting**, so seeding while the demo
  runs fails cleanly with a message. rmSync would have deleted the running
  demo's database before failing on the busy folder.
- The capture waits for real readiness and disables animations. A fixed sleep
  plus throttled fade-in delays had produced half-empty pages. The social
  preview was re-rendered from the new shots.

### A social preview image

`docs/social-preview.png` (1280x640, 149 KB) is the card GitHub shows when the
repository link is shared. GitHub has no API for it: upload it under
Settings > General > Social preview. It is built from the demo screenshots, so
like them it shows synthetic data only. It was rendered with headless Edge from
a throwaway HTML page, using Geist from node_modules and the icon from
src/app/icon.svg.

## Before 1.0.0

### Ready to publish: licence, docs, CI, a demo

- **MIT licence.** The footer no longer says "All rights reserved", which
  contradicted it.
- **README rewritten.** It still described Phase 0 ("no collector yet").
  It now covers requirements, demo mode, setup for all three parts, backups,
  logos, security, accessibility and development. Its screenshots are of
  synthetic data.
- **SECURITY.md**: the threat model, its limits, and private reporting.
- **Demo mode**: scripts/seed-demo.ts writes a synthetic installation through
  the real write paths. The Windows insert moved into windows-ingest.ts as
  SEGMENT_INSERT_SQL and segmentRows() so the two cannot drift, with a
  self-test (368 pass). The demo serves on 7849, because 7845 was already
  taken by another dashboard on this machine.
- **CI** (Windows: typecheck, self-test, build, a PowerShell 5.1 ASCII and
  parse check; Linux: Gradle wrapper validation and the APK), and
  **Dependabot** (npm and Actions, monthly, grouped; Gradle deliberately
  not, since its plugins are pinned to the local cache).
- engines node >=22.16.0 (backup() arrived in 22.16; the old floor 22.5
  would fail at runtime), .nvmrc, .editorconfig, and android/gradlew marked
  executable in git (it was 100644).
- Next 15.5.24 -> 15.5.26. The two audit findings left are the build-time
  PostCSS inside Next, which only Next 16 fixes.
- The old CHANGELOG.md became this file, PROGRESS.md moved to docs/, and
  CHANGELOG.md is now a release log starting at 1.0.0.

### Dead code removed, and one real bug it was hiding

**Fixed**
- **The light plate behind black logos never drew.** `.app-icon--plate` read
  `var(--logo-plate)`, which was never defined, so the background resolved to
  transparent and X stayed an invisible black mark. An earlier duplicate rule
  hard-coded the right colour but was overridden by the broken one. The token
  now exists. Found because that duplicate was flagged as dead.

**Removed**
- Unused exports: `NoDataInScope`, `SkeletonGap`, `kindLabel`, `SpanKind` and
  `formatHours` (CLAUDE.md said chart axes used it; they use `hourTick`), plus
  an orphaned doc comment for a component that no longer exists.
- **283 lines of CSS** (1,313 -> 1,030):
  - 35 unused classes, mostly carried over from Data Usage Tracker (`net-*`,
    `ssid-*`, `pager`, `identity-table`, `sync-button`/`-icon`/`-spinner`, ...).
  - `@keyframes grow` and `--fs-hero`, whose only users were among them.
  - **The entire heat-map section, which existed twice.** Every declaration
    in the first copy was overridden by the second, so it had never had any
    effect.
  - Three more rules fully overridden by later duplicates. `.table-more` was
    defined twice with a MERGED result, and is folded into one rule that
    reproduces what rendered.
  - Verified by computing every selector's effective declarations before and
    after: **0 values changed**.
- The SRUM-era config keys (`srumPath`, `srumECmdDir`, `keepScratch`) and sync
  sources (`srum-atp`, `android-daily`). The live `sync_log` holds no row of
  either.
- `.gitattributes`/`.gitignore` rules for a `scripts/task/` folder that never
  existed, for an exported-XML approach the drill rejects on purpose.

**Moved**
- The Phase 1 measurements, with `csv.ts` (their only user), into
  `scripts/research/`, with a README saying nothing there is needed to run
  the tracker. `npm run atp` / `android:*` point at the new paths, and the
  drill's pure-ASCII check now recurses into subfolders and covers `.vbs` too.

**Corrected**
- CLAUDE.md's Layout section, which still described Phase 0 ("NO usage
  tables yet"), and stale retention comments in the phone app's `Prefs.kt`.

### Accessibility: WCAG 2.1 AA

**Fixed**
- **Contrast.** The active range chip on the phone's pages was white on green,
  **1.78:1**. It now has near-black text (10.6:1), and the laptop's violet fill
  moved to `#795af9` so white clears 4.5:1. The login button no longer
  lightens on hover, which had dropped it to 2.99:1. `--text-faint` went
  `#6b6b76 -> #7b7b86` (3.76:1 -> 4.73:1). The password field's border is now
  3:1.
- **Page titles**: `Overview · Zephyrus G16 · Screen Time`,
  `YouTube · Nothing A001 · Screen Time`, `Sign in · Screen Time`. Every page
  used to be "Screen Time".
- **Charts have text alternatives.** Each one has a screen-reader sentence
  with its range, average and peak, or the top five of its ranking.
- **Login errors are announced** (`role="alert"`).
- **The phone app's address field** had an input type with no class, so it
  never got the URL keyboard.

**Added**
- A "Skip to content" link, the first thing Tab reaches, which moves focus
  into the page.
- `aria-current` on the page tabs and on the sidebar's device links.
- TalkBack labels bound to the phone app's fields, and its heading marked as
  one.
- 9 self-tests for the chart summaries (364 pass).

**Verified** on the signed-in laptop and phone pages at a production build:
titles, computed chip colours, skip-link focus, `aria-current`, the summaries
and zero console errors. The Android app builds.

### Security hardening before publishing

Every item below was checked against a real production build on a scratch
port, not only in the self-test.

**Fixed**
- **Open redirect after sign-in.** `?next=/%5Cevil.example` passed the
  `startsWith('/') && !startsWith('//')` guard and resolved off-site. Both the
  login page and the middleware now use `safeNextPath()`, which lets the URL
  parser decide.
- **Brute force.** The 400 ms sleep per wrong guess is replaced by counting: an
  exponential per-client lockout after 5 misses, and a global budget of 30
  misses per 15 minutes. Live: 30 guesses admitted, then `429` with
  `Retry-After`, even with `x-forwarded-for` rotated on every request. The
  login form says how long to wait.
- **Unbounded phone uploads.** The 8 MB cap now holds while reading, so a
  chunked body with no `Content-Length` cannot bypass it. Gunzip is capped at
  64 MB, and array lengths and string sizes are bounded (`payloadProblem()`).
  Live: a 1 GiB gzip bomb gets `413` in 40 ms. The phone's reachability probe
  still gets its `400`.
- **Offline password guessing from a copied cookie.** Sessions are signed with
  a PBKDF2-derived key rather than the raw password. **Every device has to sign
  in once more.**
- **Cross-origin writes** are refused with `403`. Any other localhost port used
  to count as same-site.
- **Internal errors** from the phone endpoint go to `sync_log` only, not into
  the response.

**Added**
- Security headers on every response: CSP, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and no
  `X-Powered-By`. App logos get a sandboxing CSP of their own.
- `npm run firewall` (Administrator) blocks port 7844 on Public networks. It
  refuses while connected to a Public network, so the phone is never cut off
  by surprise.
- 38 self-tests: redirect payloads, the throttle on a fake clock including key
  rotation, cookie forgery and the old signing scheme, and payload limits. 355
  pass.

**Found by the live check, not by the tests**
- A CSP set in a route handler is overwritten by `next.config.mjs` headers. The
  logo sandbox moved into the config.
- Removed the empty `serverExternalPackages` and a "no telemetry" comment that
  disabled nothing.

### Logos, brand colours and machine config become local-only

Preparing the repository to be published. A pre-publication audit found that
the repo was an inventory of every app on three personal devices -- banking,
password and health apps included -- through three channels at once: the logo
file names, the brand-colour map, and test fixtures. Removing one would not
have closed it.

- **`public/apps_logo/` is gitignored** apart from its README. The logos are
  third-party artwork this repo cannot license anyway. A fresh clone draws
  initials, which the resolver already treated as the normal case.
- **Brand colours moved from `src/lib/app-colour.ts` to
  `config/app-colours.json`** (gitignored), loaded with an mtime check so an
  edit needs no restart. Entries are a hex or `{ hex, note }`; all 129 moved
  over, verified entry for entry, with the reasoning of the 46 hand calls
  kept in their notes. `config/app-colours.example.json` shows the shape.
  Without its logos the map was inert anyway: a colour only applies to a logo
  file that exists.
- **`config/collector.json` and `android/local.properties` are gitignored**,
  replaced by `config/collector.example.json`. Every script that needs the
  config now says to copy the example rather than failing on ENOENT.
- **Git no longer protects those files from a reset, so the kit does.**
  `npm run backup:kit` mirrors them into `local-files\` beside the backup, and
  `npm run drill` compares the mirror byte for byte and FAILS on anything
  missing or stale -- the same standard `.env.local` is held to. `RESTORE.txt`
  now restores them before step 3, which needs `collector.json` to find the
  database backup at all.
- `measure-logo-colours.ts` prints proposals **diffed** against the local map
  (NEW / DIFFERS) instead of a block to paste, since a blind paste reverts the
  hand corrections.
- Personal usage figures, times of day, LAN addresses and user-profile paths
  were replaced in the docs and code comments with the ratios and relative
  terms that carry the actual lessons.
- The self-test's colour rules run against a fixture map; neutral names replace
  the personal app names in fixtures. 317 pass, both here and in a simulated
  fresh clone with no local files at all.
- Removed `key()` from `app-colour.ts`, which nothing called.

### Brand colours for the 16 new logos; the coverage self-test passes again

Every logo was rendered beside its proposed bar before it was committed.
Twelve were taken from `measure-logo-colours.ts` as derived. Four were decided
at the render:

- **Edge (Nothing)** is byte-identical to the laptop's Microsoft Edge file and
  failed the same way, `#66eb6e` winning on count; it takes the same `#35c1f1`.
- **Clash of Clans**: the script chose the dark purple backdrop (`#3a0056`).
  The icon is recognised by the barbarian's golden hair, `#fef030`, its largest
  yellow at the file's native 1000px.
- **Permission controller** is a grey disc with a white glyph and yields no
  colour at all; it joins the light-neutral "no brand colour" group.
- **ClearScanner** now has different files on the two phones, so the Nothing
  gets its own scoped entry beside the Redmi's.

Kept despite being close, each with nothing else in the file to move to: the
Color Picker 3 from Start Menu, msinfo32 22 from Word. No new logo needs a light plate.

### Phones get the desktop layout; the sidebar starts collapsed

- **`viewport` is `width=1024`** (root layout), so a phone lays the page out on
  a 1024px canvas and scales it to the screen -- the desktop layout, as
  Chrome's "Desktop site" would show it, rather than a narrow reflow. 1024
  clears the 997px at which the three-across stat rows were measured, and the
  860px breakpoint, so no narrow-screen rule fires. `initial-scale` is removed
  deliberately: Next's default `initial-scale=1` beside a fixed width opens a
  phone zoomed in on the top-left corner. Desktop browsers ignore the tag.
  Checked on the phone itself before committing.
- **The sidebar is collapsed by default.** Only pressing the hamburger opens
  it, and that choice is remembered per browser; a browser that already
  stored an open sidebar keeps it.

### Every loading skeleton re-measured against its page

All ten routes, at 997 and 1680px, by rendering each `loading.tsx` beside its
real page and comparing where every section starts. Several had drifted:

- **Stat rows were 25px too tall** (`valueHeight` 80 -> 55) -- 50px on the
  phone's Overview, which now has two rows.
- **Sync Status was short**: its two status cards by 62px on the laptop and
  194px on the phone, so the run history jumped up on load.
- **Heads with a back link** differ per page now; `SkeletonPageHead` takes a
  `height` (Activity 106, app detail 97 / 93).
- The Overviews' heat map, trend title and trust card, the Activity card, and
  the detail table's title were each off by 10-20px.

Measured with the sidebar collapsed, which moves the 997px figures. What
remains is split evenly between the two widths, as `Skeleton.tsx` asks: at
most +-60px at the foot of an Overview, where the heat map's height follows
its width.

### By App drops its score cards; the phone's Overview gets totals

The System card was a split nobody needed, and on the phone it was also
misleading: it reads Android's `FLAG_SYSTEM`, which marks anything preinstalled,
so one preinstalled video app made the phone's "System" figure mostly that
app. All
three cards are gone from By App on both devices; everything is counted once,
in the totals.

The laptop's Overview already carries Range total. The phone's Overview is now
two rows of three: **Today, Daily average, Total screen time** above **Unlocks
today, Unlocks per day, Total unlocks** (`unlocksTotal`, counted per session
like the other two). `.grid--3` takes the 215px floor `.grid--4` had, so each
row stays three wide at an ordinary laptop width instead of breaking 2 + 1.

### Overview and By App reorganised; a heat map; the trend becomes a line

- **The By App table lists the apps that matter, and folds the rest.** An app
  is listed with 10 min or more in the range, or 30+ opens across 5+ days
  (`lib/app-list.ts`). The rest sit behind **Show all N apps**, whose label
  says how many and how much time they hold, so the table still adds up. On
  the All range that is 26 of 59 on the laptop, 38 of 91 on the Nothing, 2 of
  21 on the Redmi. If nothing clears the bar, everything is shown.
- **Top apps and Most opened moved from the Overview to By App**, above its
  three score cards. The Android launcher note travels with Most opened.
- **An Activity heat map on both Overviews**, ported from the sibling Data
  Usage Tracker: six months of Saturday-first week columns in the device's
  accent ramp, outlined where nothing was recorded, with **Expand** opening
  `/<platform>/<slug>/activity` -- the whole history, six months to a row, on
  one scale. Two deliberate departures from the sibling: shades are even steps
  (screen time has no torrent-day tail to compress), and Expand is always
  offered and starts at the data's month, because gated the sibling's way it
  would not appear until 2027.
- **Daily trend is a filled line with a Heaviest day callout**, shaped after
  the sibling's Trend chart. A day with no recording breaks the line rather
  than being joined across. App detail pages keep their bars.
- **"Where the time went" moved to the bottom of the laptop's Overview**, and
  the phone's counterpart, "Attributed vs unaccounted", with it.
- **Two merges on the laptop.** ShellHost, ShellExperienceHost and sihost are
  now one row, **Windows Shell** -- all three draw the taskbar's flyouts, and
  which exe owns which moves between builds. `NVDisplay.Container` folds into
  **NVIDIA Control Panel** (was `nvidiacontrolpanel`); the NVIDIA App stays
  its own program. Candidates checked and deliberately left apart are listed
  in `PROGRESS.md`.

### Stopping and starting go by this dashboard, not by whatever holds 7844

`dashboard-stop.ps1` -- and so `stop-dashboard.bat`, `npm run dashboard:stop`
and `npm run autostart -- -Remove` -- stopped **every process listening on
7844**, whatever it was. On Windows a server bound to `127.0.0.1` can share a
port with another program's wildcard listener, and the neighbouring dashboards
are node too, so "the thing on 7844" can be somebody else's server. The sibling
lost its dashboard for hours to exactly this shape of cleanup.

A listener now counts as this dashboard only when its command line runs Next.js
out of this repo's own `node_modules` -- the logon task's server, the `.bat`'s
and `npm run dev`'s all qualify. Anything else is left alone and named, and the
closing check reports on this dashboard rather than the port, so another
program still holding 7844 no longer reads as `[WARN] port 7844 still
listening`. `-WhatIf` shows which PID it would stop.

The logon launcher had the other half of the same mistake. `dashboard-service.ps1`
logged `port 7844 already served by <name>` and exited 0 for any owner at all,
so another program on the port kept the dashboard down until the next logon
behind a log that read as fine. It applies the same rule now: this dashboard is
"already served", exit 0; anything else is logged as another program, NOT
starting, exit 1.

### Brand colours for 10 more logos, and one file that changed underneath its entry

Nine new logos landed in `nothing-a001/`, which broke the coverage self-test --
a missing colour falls back to the device accent, so it does not look like a
gap, it looks like an app that chose green. Seven were taken from the script as
derived; two were corrected at the render, and every one of the ten was LOOKED
AT before it was committed.

**`Settings.png` was replaced, and nothing would have noticed.** The Nothing's
gear is now a teal disc where it was a slate blue one. `settings` was a BARE
entry whose comment said in as many words that both phones' gears were the same
slate blue -- true when written, false now, and the app NAME did not change, so
no test and no eye would have caught it. The Nothing is scoped to
`nothinga001/settings` and the bare entry is the Redmi's alone, with the warning
written where the next reader will hit it. **A bare entry that has quietly
become one device's answer looks exactly like a bare entry that is still both
devices'.**

**`packageinstaller` moved the other way, from scoped to bare.** The Nothing's
copy arrived with the same md5 as the Redmi's -- one file in two folders,
because the distributor copies rather than shares. Two scoped entries holding
one hex is the drift the `systemui` exception exists to prevent, so the scoped
one is gone.

Two corrections, both the failures CLAUDE.md already names:

- **Photos & videos** came back `#00133f`, which is **not a paint in the
  file**: at the 64px the script samples, the navy mark blends into the pale
  field behind it. At 384px the mark is `#041e49`. The field, `#d3e3fd` and
  57% of the icon, was considered and rejected -- at lightness 0.91 it lands
  next to the `#ececf1` the monochrome brands use, and near-white on this page
  already means "this brand has no colour".
- **Settings Suggestions** came back `#175aba`, **two** from `messages` on the
  same phone. Not the Facebook/Messenger case; one colour drawn twice. All
  three of the icon's blues were measured: the deep blue is 2 from Messages,
  the bright azure 9 from Contacts, and the pale chain is 46 from its nearest
  neighbour. The chain it is -- a real paint, plainly visible, and the one
  paint here that no other Google system icon on the phone uses.

Three convergences were weighed and KEPT, because no second true answer exists
in the file: Essential Recorder sits 13 from Keep Notes and 14 from Chrome on a
five-yellow ramp; Package Installer sits 1 from Settings, both being Nothing's
system teal on a flat disc; and Nothing Screenshot joins Launcher, Recorder,
Weather and Camera on Nothing red, which is one vendor painting its whole set
one colour rather than a tie-break going wrong.

Self-tests back to **271 passed, 0 failed**.

### Two double-clickable launchers, for when the logon task is off

`start-screen-time-dashboard.bat` and `stop-dashboard.bat`, adapted from the
AI Usage Tracker's pair. The dashboard normally comes up from the "Start Screen
Time Dashboard" logon task; these are the manual way in when that task is
disabled, and the stop file is the only off switch when it is not, since the
task runs the server HIDDEN and there is no console to Ctrl+C.

**Neither touches collection.** "Screen Time Sampler" and "Screen Time Ingest"
are separate tasks and neither waits on the dashboard being up -- which is the
right way round, since collection is the half that cannot be caught up later.

Three things the start file does deliberately:

- **It refuses to act when something already holds 7844**, and that check earns
  its place twice. Beyond "the logon task already started it", `npm run dev`
  binds 7844 too -- and a `next build` underneath a live dev server replaces
  chunks it holds open, killing it with `Cannot find module './331.js'` on the
  next request. Exiting first means this window can never do that.
- **A stale build is REPORTED, not fixed.** Rebuilding on every launch would
  turn a broken build into a start-up failure; serving the old one silently is
  worse still on a dashboard whose whole job is current numbers. The comparison
  is `src\` and `config\` against `.next\BUILD_ID` -- the same rule
  `dashboard-service.ps1` uses, so the task and this window never disagree
  about what "stale" means. A MISSING build is the one case it does build:
  `npm start` against no `.next` exits immediately, leaving nothing to open.
- **The browser poller accepts any HTTP answer, not only a 200.** This
  dashboard is behind a password gate, and `Invoke-WebRequest` throws on a 401
  as readily as on a refused connection -- so the catch has to tell "not
  listening yet" from "listening and saying no", or a gated server would never
  open the browser at all.

`*.bat text eol=crlf` in `.gitattributes`: cmd.exe reads a batch file a line at
a time AS IT RUNS, so an LF-only checkout can misparse a label or a
parenthesised block -- a launcher that half-works rather than a syntax error.

### The Asleep segment was invisible, and the bar just looked short

"Where the time went" drew `gap` in `--hm-none`, `#0b0b0d`, on a track of
`--bg-panel`, `#0a0a0b`. **One or two points per channel.** So a laptop that
slept for sixteen hours drew a bar that appeared to stop early, and unrecorded
time read as no time -- the precise misreading the card exists to prevent, and
the one its own docstring claims it prevents.

The heat map had already met this and answered it better: a no-data cell takes
a **hairline** (`.heatmap-cell[data-nodata]`) rather than a fill, because a
near-black fill on a near-black ground says nothing. KindBar borrowed the token
without the fix. A 12px band cannot carry a hairline the way a square cell can,
so `gap` is now `color-mix(in srgb, var(--text-dim) 28%, var(--bg-panel))` --
visible, and still the dimmest of the four, so absence reads as absence.

`--hm-none` is **deleted**. It described itself as the heat map's no-data
colour but the heat map had stopped using it; KindBar was its only consumer,
so the token existed solely to hold this bug where the next reader could find
and reuse it.

### Ranked bars are 34px, not 27px

Top apps and Most opened share `RankedApps`, whose row is 34px. Recharts'
default clearance is `barCategoryGap: '10%'` -- a PERCENTAGE of the band, 10%
either side -- so the bar came out at 27px with 7px of the row given to gap.

The gap is now a pixel figure, `ROW_PAD = 2`, named beside the `ROW_H` the
chart height already used. The bar is what is left over, so the two move for
their own reasons: row spacing is about fitting the card, thickness is about
comparing a bar against its neighbours.

That took the bar to 30px, and the remaining 4px of row was not enough to give
away, so `ROW_H` went 34 -> 38 for 34px bars. **A pixel gap hands the whole of
that increase to the bar**; the percentage default would have skimmed a
proportional share of it straight back into the gap. The card grows with it --
eight apps is 336px tall where it was 288px.

### Brand colours for 14 new logos, and one the script got dangerously wrong

`public/apps_logo/` went 106 -> 115 files (laptop 35, Nothing 66, Redmi 19),
and the coverage self-test caught all 14 newcomers at once -- which is what it
is for: a logo with no colour falls back to the device accent, so a gap does
not LOOK like a gap, it looks like an app that chose violet.

**Every one was rendered before its hex was committed**, and two of the three
documented failure modes turned up again:

- ⚠️ **MIUI Camera** -- the script said `#262a39`, the dark lens body. It is
  the largest coloured area of the icon and it is the `sheets: #263238`
  failure exactly: at lightness 0.19 `ensureReadable` lifts it to `#5f626d`,
  **a flat neutral grey**, which on this page is indistinguishable from an app
  with no colour known at all. The icon is a pink-to-blue ring around that
  lens, and the ring is what makes it recognisable. Corrected to `#f64786`,
  the hottest pink bucket in the file -- found only by sampling at the file's
  full 285px, because at the 64px the script uses a thin ring blurs into the
  pale field and disappears.
- ⚠️ **Microsoft Edge WebView2** -- `#66eb6e`, the green swirl stop declared
  twice. The Edge failure verbatim, in the same artwork, a second time.
  Matched to `microsoftedge`'s `#35c1f1`: WebView2 IS Edge, so two identical
  cyan bars is the Facebook/Messenger case rather than a clash.

**One convergence is kept and documented rather than fixed.** PowerToys
Shortcut Guide derives `#36c8f6` -- **9 away from Edge**, the laptop's
second-heaviest app. Unlike VLC-versus-File-Explorer there is no second real
reading to move to: the icon is a grey keyboard whose only chroma is that
cyan arrow. PowerToys' own amber is not a paint in this file, so reaching for
it would be the Chrome mistake -- a remembered brand hex that nothing can be
checked against.

**`systemui` is keyed BARE**, because the two phones' files are byte-identical
(same md5, the legacy Android robot) and the identity fallback covers both
from one entry. **Every other Redmi icon is scoped, and the laptop's are
not** -- an asymmetry with a cause: there is one Windows machine and always
will be, while phones multiply, and a third phone arrives with its own
Camera, Gallery, Security and File Manager. Generic names, device-specific
pictures.

**`settings` is now undiscoverable by the script and had to be pinned.** The
Redmi's `Settings.png` was replaced with flatter artwork whose field sits at
saturation 0.20, under `isCandidate`'s 0.25 floor, so that file now yields
nothing at all. The value is still right -- both phones' gears are the same
slate blue -- but a blind re-paste of the script's output would have dropped
the line and sent Settings to the device accent on a phone whose icon did not
visibly change.

No logo needed a light plate; `measure-logo-plates.ts` still reports none, and
every new raster was checked by eye since it cannot judge those.

### The laptop has a URL that names it: `/windows/zephyrus-g16`

Every page on the phone side already addressed a DEVICE -- `/android/<slug>`
-- while the laptop sat on the bare `/`, `/apps` and `/sync`. That asymmetry
was a deliberate choice once, on the reasoning that moving it would break
bookmarks for no gain a reader could see. The gain turned out to be that
**`/apps` cannot say whose apps it means**, and with three devices in the
sidebar that is a question the address has to answer.

So the laptop's pages moved under `/windows/<slug>/`, where the slug comes
from `deviceLabel()` through the same `slugify()` the phones use -- now in
`src/lib/slug.ts` rather than inside `android-ingest.ts`, so the laptop can
reach it without dragging `node:sqlite` into `config.ts`.

    /                       ->  /windows/zephyrus-g16
    /apps                   ->  /windows/zephyrus-g16/apps
    /apps/<key>             ->  /windows/zephyrus-g16/apps/<key>
    /sync                   ->  /windows/zephyrus-g16/sync
    /windows                ->  /windows/zephyrus-g16

**Every old address still works.** Each is a redirect page, and each carries
the query string across: `redirect()` does not do that on its own, so without
`queryString()` a bookmarked `/apps?days=7` would land on the full range with
nothing on the page saying the scope had moved. The `/apps/<key>` redirect
passes the key through **undecoded** -- it is already percent-encoded in the
path, and re-encoding a decoded key would double the escapes on the `%` and
`/` that resolved keys like `exe:visual studio/setup` genuinely carry.

`/` stays the way in and is where the sidebar's brand link still points: it is
the one URL guaranteed to mean "home" however the devices are named.

**A wrong slug is a 404, not the real machine under a wrong name.** There is
exactly one laptop, so the pages compare the segment against `windowsSlug()`
rather than looking it up. Without that check every misspelling would render
Zephyrus G16, and the URL would stop being an answer to "which device".

`pagesForPath()` now yields **no tabs** for a path that has not named a device
-- `/`, `/windows`, `/android`, or a legacy address mid-redirect. A tab strip
whose links all point at a device the URL has not chosen yet is worse than
none.

`NoDataInScope`'s "Show everything" link went relative for the same reason.
Absolute `/?days=36500` would have sent the reader to the laptop's Overview to
widen a range they were looking at on a phone.

### Every logo moved into a device folder, copied where two devices share one

The per-device folders landed as an OVERRIDE over a shared root. This makes
them the layout: 92 distinct logos became **106 files across three folders**,
and the root holds no images at all.

    Zephyrus G16              32
    nothing-a001              65
    xiaomi-redmi-note-9-pro    9

`Brave.svg` now exists three times, deliberately. A folder is a complete,
readable answer to "what does this device show", and one device's icon can no
longer affect another. **The cost is drift** -- replace artwork in one folder
and the others keep the old copy, with nothing to catch it.

`npm run logo:distribute` does the fan-out and is re-runnable: drop a logo in
the root, run it, and it lands in the folders whose devices need it, matching
recorded app names with the same rules the dashboard uses. It reports by
default and only writes with `--apply`. **It never copies between devices** --
a file in `nothing-a001/` may be the wrong picture entirely for another phone,
which is the whole reason the folders exist -- and it never deletes a root file
no device claims, since no app matching it today is not the same as it being
dead. It also lists, per device, the apps with no logo at all: 14 on the
laptop, 10 on the Nothing, 11 on the Redmi.

**`needsLightPlate` had to learn the same fallback `brandColour` already
had.** `NEEDS_PLATE` holds `x`, and once `X.png` was copied into the device
folders its identity became `zephyrusg16/x` -- a set keyed bare would have
stopped matching, the plate would have vanished, and X would have gone back to
being an invisible black mark on a near-black page. One entry still covers
every copy, and a scoped entry overrides it where one copy genuinely differs.

**Five self-tests were asserting the old layout** and correctly went red:
`logoUrl('Telegram')` with no device returns null now. They tested matching
RULES against whichever real artwork happened to exist, so they are rebuilt on
fixtures in a temporary folder -- otherwise they would break when a phone stops
reporting an app rather than when the matching changes.

### A logo can belong to one device

Two Androids broke the assumption `public/apps_logo/` was built on. Measured
across the Nothing and the Redmi, they report the same label for a different
package twice -- `Camera` is `com.nothing.camera` or `com.android.camera`,
`Gallery` is `com.nothing.gallery` or `com.miui.gallery` -- and the old fix,
renaming one of them (`Windows Camera`), cannot apply: the phone reports the
label and both phones are right.

So a logo may now sit in a folder named after the device, which wins over the
root per file:

    apps_logo/Brave.svg                        every device
    apps_logo/nothing-a001/Gallery.png         that phone only

The folder is matched with `logoKey()` like a file name, so the slug and the
label are the same folder; the laptop answers to `Zephyrus G16` and
`zephyrus` both. `/api/app-logo/` became a catch-all taking one segment or
two, and refuses anything longer rather than quietly using the first two.

**Artwork, light plate and brand colour share ONE identity.** `resolveLogo()`
returns the scope and key that `needsLightPlate()` and `brandColour()` are
then keyed by. A Redmi Gallery drawing MIUI's icon over the Nothing Gallery's
colour is worse than either alone, and three functions doing their own matching
is how that happens.

The Nothing's `Camera.png` and `Gallery.png` moved into `nothing-a001/` --
both are monochrome-with-a-red-dot, which is Nothing OS's icon language -- and
**their colour entries moved with them**. Left keyed bare they would have been
inherited, so the Redmi would have drawn no icon and a Nothing-red bar: the
mismatch the folders exist to stop, arriving through the fallback. The Redmi's
Gallery and Camera now draw their initial until MIUI artwork is dropped in,
which is the honest answer for a logo this project does not have.

**Two traps, both caught by tests that now exist:**

- ⚠️ **The manifest stores the folder's REAL name, not its key.**
  `nothing-a001` keys as `nothinga001`, and storing the key gives a path no
  file answers to -- every scoped logo 404ing with the file plainly on disk,
  which is exactly what the serving route exists to prevent, one layer down. It
  was written that way first and every string comparison passed. The self-test
  now OPENS the file, for the fixture and for all 92 logos; reintroducing the
  bug fails both checks.
- **The manifest stamp covers every subfolder's mtime.** The root's does not
  move when a file lands inside a subfolder, so stamping the root alone would
  have made a logo dropped into a device folder invisible until a restart.

`allLogoFiles()` is one enumeration for the two measure scripts and the
coverage check, which each used to call `readdirSync` on the root themselves --
all three would have silently ignored every scoped logo, and an uncoloured logo
does not look like a gap, it looks like an app that chose violet.

### `npm run logo:vacuum`, and the check that has to go with it

`scripts/vacuum-svg-defs.ps1` -- Inkscape's "Vacuum Defs" without Inkscape,
which is not installed here. It uses .NET's `System.Xml` rather than a regex
or an npm dependency, keeping the rule that a clean `npm install` after a
reset must not have anything to build.

It keeps a definition when the RENDERED tree points at it, or when a kept
definition does. Seeding only from outside `<defs>` is the part that matters:
a reference from one dead cluster to another would otherwise keep both alive
and nothing would ever be collected. The transitive step is not theoretical --
Notepad's body gradient reaches a second gradient through `xlink:href` and
nothing names that one directly.

**It refuses more often than it deletes.** A file carrying `<style>` or
`<script>` is rejected without `-Force`, because only attribute values are
scanned and a `url(#id)` in CSS would be invisible; and nothing is written at
all if the rendered tree changed, since that means the reachability pass is
wrong rather than that the file got tidier.

**Every run writes a difference-blend page and says to look at it.** Three
panels -- original, vacuumed, and the two overlaid with `mix-blend-mode:
difference`, which must be black. That is documented as a required step rather
than a nicety because the structural check was WRONG the first time it was
written: it sliced the file from the first `<defs` to the last `</defs>`, and
Notepad.svg has five `<defs>` blocks with one nested, so the middle of the
document was cut from both sides and compared equal while differing. It passed
a file that had lost 16 `<path>` elements. A render cannot be fooled that way.

Two things it now gets right that the throwaway version did not: the output has
**no BOM** (`XmlDocument.Save(path)` adds one, and the hand-authored files
here have none), and `NewLineHandling = None` keeps the source's line endings
instead of rewriting every line and burying the real change in the diff.
`Notepad.svg` is re-saved here by the committed script, so the file in the
repo is exactly what the tool produces.

### Notepad.svg vacuumed: 92,380 bytes to 4,630

**173 of its 177 `<defs>` children were unreferenced** -- Inkscape leftovers
that no painted element could reach. What actually draws the mark is four
definitions (two filters, and a body gradient that resolves through an
`xlink:href`) over 16 rendered elements.

Removed with a transitive reachability pass over the real XML rather than a
regex, seeded only from references made OUTSIDE `<defs>`, and verified three
ways: the rendered trees compare identical element-for-element and
attribute-for-attribute, the four surviving definitions are byte-identical, and
a difference-blend of the two renders is black.

**Two of those checks exist because the first one was wrong.** The initial
comparison sliced the file from the first `<defs` to the last `</defs>` --
and this file has **five** `<defs>` blocks, one of them nested, so everything
between them was cut from BOTH sides and compared equal while differing. The
element counts gave it away: 16 `<path>` elements before, 0 after. They turned
out to live inside a nested `<defs>` with no `<use>` anywhere in the document
to pull them into the render, so removing them was right -- but the check that
said so had not actually checked it.

Side effect worth knowing: `measure-logo-colours.ts` now sees 4 candidate
paints instead of 142 and proposes `#057093`, the rules and rings. Still not
the body gradient this commit keeps, but no longer a colour that is absent from
the image.

### Two uncoloured logos, and a paint that is in the file but not in the picture

`npm run selftest` was red: `Notepad` and `Processor Temperature Meter` had
logo files and no brand colour, so both fell back to the device accent.

**Notepad is the interesting one.** `measure-logo-colours.ts` proposed
`#d3ed89` -- a pale green -- and the rendered mark is a **sky-blue pad**. The
file is an Inkscape export carrying **149 gradients of which none is referenced
by a painted element**; 95% of its 92 KB is dead `<defs>`, and every colour the
count ranked was invisible. The live tree is 4.5 KB: a body of
`fill:url(#linearGradient60436)`, which resolves through an `xlink:href` to
stops `#43afcf -> #7ad6f2`, over `#057093` rules and rings. Committed
`#43afcf`, the deeper stop of the gradient that actually paints the pad.

The existing notes cover a script that picks the WRONG paint. This is a script
that picks a paint which is not in the image at all, and no amount of reading
hex values would have caught it -- rendering it took one screenshot.

**Processor Temperature Meter** took `#ff6b5c` rather than the proposed
`#ffb05c`. Both are stops of the mercury ramp, but the amber sits 25 away from
Internet Speed Meter's `#ffc46b`, and two meter apps converging on one bar
colour is the VLC / File Explorer collision again. The bulb is the largest mass
of colour in the mark and sits at the hot end of the ramp.

### A lost backup race reported itself as `failed: not an error`

The Nothing pushed twice 20 ms apart on 2026-09-04 and the second run wrote
`backup_status: "failed: not an error"` into `sync_log`. The sync page is
where you look to find out whether collection is healthy, and a line that reads
as a bug in the reporting is worth as little there as a line from a button that
worked.

**The backup file was never at risk, and that is measured rather than
reasoned.** Concurrent backups were run against one destination, in a single
process and across four, on a 65 MB database:

| | |
|---|---|
| Winners | exactly one per race |
| Losers | fail BEFORE writing a byte |
| Destination | `integrity_check` ok and complete, every run |

SQLite's own locking is what guarantees that. What the loser reports is either
errcode 261 (`database is locked`) or -- the one that reached `sync_log` --
errcode **0**, which node:sqlite renders as `"not an error"` because SQLite
set no code at all.

So the fix is about honesty and about not racing needlessly:

- **`backupDatabase` serialises within the process.** Queued, not coalesced:
  the in-flight backup may have started before the second caller committed, so
  joining it would report a backup that does not contain the caller's rows.
  This alone removes the case that was observed.
- **A lock lost to ANOTHER process is retried**, four attempts on a 250 ms
  ladder. The hourly ingest task and a phone push are separate processes and no
  in-process queue can order them.
- **If it still cannot get the file, the status is `busy:`, not `failed:`.**
  Not `ok` either -- the winning backup may predate this caller's commit, so
  those rows are safe only in the live database until the next backup. Three
  outcomes, three words.

`isBackupContention()` is exported so the self-test can pin the codes down.
The dangerous direction is permissive: classify a real, recurring failure as
contention and it becomes four silent retries and a `busy`.

**`mkdirSync` moved back inside the guard** while here. It had been lifted
above the `try`, which would have let a directory that cannot be created throw
out of a function whose whole contract is that it returns a status -- taking a
successful collection down with a failed backup.


### Chrome is yellow, and the reversal is the more useful record

`chrome` sat at `#4285f4` because the script had returned `#fcd209` -- the
yellow arc, off a four-way saturation tie -- and the blue centre disc looked
like the obvious repair. Restored to the yellow, and two things are worth
keeping about why.

**`#4285f4` was never a paint in `Chrome.svg`.** The file is the LEGACY
gradient logo, whose disc runs `#81B4E0 -> #0C5A94`, a muted steel blue. The
committed value came from brand knowledge instead, which quietly changed what
"hand-corrected" means: every other correction picks a different paint out of
the same file, and that is checkable against the file. A remembered brand hex
is not.

**And the disc is the middle of the mark, not the mark.** The ring is what a
person sees; a bar has to be recognisable from a colour already associated
with the app.

The script was right here by accident, off a tie-break it does not understand
-- so the lesson is not "trust the script", it is that a correction has to
name which paint in the file it chose. `gemini` is now the only entry whose
hex is not in its own logo file, and it is flagged as such rather than left
for the next reader to find.

### Brand colours for every logo, so the ranked charts stop reading as violet

Top apps and Most opened colour their bars by brand, but the map covered only
**27 of 91 logos** -- so seven of the laptop's top eight fell back to the
device accent and the chart read as one colour with a highlight on the leader.
Every logo now has a colour, and **31 of the 32 slots across the four charts
are branded**; the one that is not is Windows Search, which has no logo file
and so has nothing to derive a colour from.

Derived by re-running `scripts/measure-logo-colours.ts` over the folder, then
corrected by hand -- the workflow the map was built for. Four of the
corrections are the tie-break failure already recorded (the script counts paint
DECLARATIONS, not area), and they are worth naming because none of them looks
wrong as a hex:

| | script said | committed | why |
|---|---|---|---|
| Microsoft Edge | `#66eb6e` | `#35c1f1` | a green stop of the swirl, used twice where every other stop is used once, so it wins on COUNT. A green bar for a browser would read as WhatsApp before it read as a mistake. |
| Sheets | `#263238` | `#0f9d58` | the near-black document behind the mark |
| Google | `#fbbc05` | `#4285f4` | the same four-colour tie that already caught Gmail, Maps and Photos |
| VLC | `#ffb900` | `#f48200` | the lightest stop of the cone, which is amber -- and File Explorer's folder genuinely IS `#ffc928`, so two brands would have arrived at nearly one bar colour |

Three more are judgement rather than repair: `googledrive` matched to `drive`
(one brand, two logo files), Armoury Crate given its brushed silver rather
than the dark bezel behind it, and 7-Zip and Windows Terminal added to the
monochrome group beside ChatGPT, Threads, Uber and X.

**Screen Time Reporter is deliberately left uncoloured.** Its icon is this
dashboard's own violet, so committing the hex would put an accent colour
outside `accent.ts` -- and the null fallback already draws the same violet on
the laptop and the right green on the phone.

**`ensureReadable()` stopped being a precaution.** Its comment claimed nothing
in the map tripped the 0.40 lightness floor; that was wrong even when written
and is now emphatically wrong -- **about one entry in seven is lifted**,
the darkest a teal at lightness 0.227, which
would otherwise be a bar you could not see on a black page.

Two self-tests hold the coverage: every logo file must resolve to a colour
(with the one deliberate omission named in the test), and what `brandColour()`
actually returns must clear the floor -- checked on the way out, because the
chart draws that and not the raw map value.

### The hourly ingest no longer flashes a console window

"Screen Time Ingest" ran `cmd.exe /c ... npm run ingest`, so a black window
appeared **every hour, all day**, taking focus in front of whatever was on
screen. It now goes through `scripts/ingest-hidden.vbs`, the same launcher
shape the sampler and the dashboard have always used -- Task Scheduler's own
"Hidden" checkbox does not suppress a console window.

**⚠️ The ingest's launcher WAITS, and the other two must not.** They run for
the whole logon session, so waiting would pin their tasks as "running"
forever. The ingest is a job that finishes, and `ingest-windows.ts` exists in
its own words to "set an exit code that Task Scheduler will record in
`LastTaskResult`". Launch it detached and the task completes in milliseconds
reporting **success, whatever the ingest actually did** -- an hourly job that
fails silently while reporting 0 is worse than one that flashes a window. So
`Run(cmd, 0, True)` plus `WScript.Quit`, verified by probe: the same shape
around `cmd /c exit 3` returns 3.

Output now goes to `logs\ingest.log`, because after hiding the window there is
nowhere else for it to go. That is cmd's redirection, which is byte-level and
passes the child's UTF-8 through -- not PowerShell's `>>`, which writes
UTF-16LE and is the trap already recorded for `dashboard.log`.

### "Screen Time Dashboard" is now "Start Screen Time Dashboard"

A verb, because unlike the two collectors that task's own job is over as soon
as the server it launches is up.

**Task Scheduler has no rename, so this is an unregister plus a register --
and leaving the old entry behind would be worse than not renaming at all.**
Both would fire at the next logon, and the second server would find port 7844
already taken and die, having logged that to a file nobody reads.
`install-autostart.ps1` now clears `$OLD_TASKS` before registering the new
name, and on `-Remove` too.

The running server was left alone through the rename: unregistering a task
does not stop the process it started, and there was no reason to drop the site
to rename its launcher.


### Opens charts on the laptop's app detail pages

The phone's app pages have carried "Opens per day" and "When it gets opened"
since Phase 2; the laptop's carried only the two time charts. Same two shapes,
counted in opens instead of milliseconds, now on both.

The pair is what makes them worth reading: a tall time bar over a short opens
bar is one long sitting, and a short time bar over a tall opens bar is
compulsive checking. Neither chart alone can tell those apart. **Windows makes
the distinction sharper than the phone does, because alt-tab is cheap** —
measured over the three days on this laptop, Microsoft Edge took 497 opens and
File Explorer 461, against 29 for Telegram.

**An open is an instant, not a span**, and that is deliberately not how the
same visit's time is bucketed:
- A visit is filed under the day and hour it BEGAN. An app opened at 23:50 and
  used past midnight counts once, last night — its time is split across the
  boundary because time genuinely was spent on both sides, but splitting the
  open would invent an opening that never happened.
- A two-hour sitting from 09:50 puts one open in the 9 o'clock bar, not a
  smear across three.
- Opens are **visits**, not raw spans. The sampler ends a span on every focus
  change, so alt-tabbing away and back would otherwise be three opens.

**`openBuckets()` moved into `visits.ts`**, and the Android page now calls it
too — the rule is about what an "open" means, not about which device recorded
it. It went there rather than staying in `queries.ts` for the reason
`sampler-status.ts` and `axis.ts` did: `queries.ts` is `server-only` and a
self-test cannot import it. Eight new checks, including the midnight case and
that the two charts sum to the "Opens" stat above them. 218 pass.

Verified against the live database: for all 39 apps the laptop has recorded,
opens-per-day and opens-per-hour each sum exactly to the header's Opens count.

**Fixed**
- Both app-detail loading skeletons drew two chart cards for four. The phone's
  had lagged since its opens charts were added; the cards below jumped on load.


### Windows app names a person can read

The laptop's By App page was labelling rows with identifiers rather than
names. `B9 ECED6 F.Armoury Crate`, `Open AI.Codex`, `Microsoft.Windows.Photos`,
`GoogleDriveFS`, `mmc`, `qemu-system-x86_64`, `studio64`, `Resolve` — 15 of the
39 apps this machine has recorded were showing a string only Task Manager
would recognise, and two of those (`mmc` and `InternetSpeedMeter`) were in the
top six by time.

**Every replacement name was read off Windows itself** — `Get-StartApps`, the
package manifest, or the exe's `FileDescription` — rather than inferred from
the folder. That matters more than it sounds: the package family
`OpenAI.Codex` ships `ChatGPT.exe`, and Windows calls it **ChatGPT**.

**Fixed**
- **A package family is not a display name.** Everything before the last dot is
  a publisher namespace: `Microsoft.Windows.Photos` is Photos and
  `B9ECED6F.ArmouryCrate` is Armoury Crate. The namespace stays in the grouping
  key, where it keeps two vendors apart, and is dropped from the name.
- **The CamelCase splitter was wrecking acronyms.** `([a-z0-9])([A-Z])` turns
  `HWiNFO64` into "HWi NFO64" — a name that reads as corrupted data rather than
  as a program. It now requires the capital to be followed by a lowercase
  letter, so a break is only made where a new word demonstrably starts.
- **Unknown exes get word breaks too**, which is safe in a way no other edit
  would be: `logoKey()` strips spaces, so "InternetSpeedMeter" and "Internet
  Speed Meter" remain the same app to the logo and colour lookups, and the same
  string to a person searching Task Manager for it.
- **`7zG.exe` and `7zFM.exe` now share a key**, not just the label "7-Zip". Two
  rows with one name silently share a colour — the map's own rule 3, which it
  was breaking.
- **A temp installer says what it is**: `hwi64_852.tmp` →
  `Installer (hwi64_852.tmp)`. The random name is the only handle on it, so it
  is kept rather than prettified away.

**⚠️ Three names disambiguated, and one wrong logo found doing it**
Windows calls them Camera, Photos and Settings; so does the phone, for
completely different programs. Measured against `android_apps`, the full
overlap is `Brave ChatGPT Claude Telegram VLC` — the same app on both devices,
which *should* share a logo — plus `Camera Photos Settings`, which should not.
- The laptop's are now **Windows Camera**, **Windows Photos** and **Windows
  Settings**.
- Doing it surfaced a live bug in the other direction: `Photos.png` (the
  Windows icon) sorted ahead of `Photos.svg` in the manifest and was being
  served for the **phone's Google Photos**. Renamed to `Windows Photos.png`,
  and the phone gets its pinwheel back.

**Logos**
- `Open AI.Codex.svg` and `GoogleDriveFS.svg` removed — byte-identical
  duplicates of `ChatGPT.svg` and `Drive.svg`, and dead once the names changed.
- `mmc.png` → `Microsoft Management Console.png`,
  `InternetSpeedMeter.svg` → `Internet Speed Meter.svg`.

**Tests**
- A `windows app names` section in `npm run selftest`, including a mechanical
  check that **no two keys share a display name** across the whole map — the
  failure that is otherwise silent. 210 pass.

### 50 more app logos, and two that were invisible

**Added**
- 50 files in `public/apps_logo/` — the phone's system surfaces (Phone,
  Messages, Camera, Clock, Settings, Files, Gallery, Contacts, Weather,
  Recorder, Calculator, Digital Wellbeing) and this laptop's own tools
  (VS Code, Windows Terminal, Task Manager, File Explorer, 7-Zip, HWiNFO64, Total Commander, Armoury Crate, Microsoft Edge, Microsoft Store).

  **75 of the 80 now match an app the database has actually seen.** The five
  that do not — Android Studio, Armoury Crate, Google Drive, Microsoft Store,
  Windows Camera — are waiting on apps this laptop has not opened in the three
  days it has been sampling, not on a spelling mistake. Checked by resolving
  every `app_path` through `resolveApp()` and every Android label, then asking
  `logoUrl()` for each.

**⚠️ Fixed — two logos that loaded perfectly and rendered as nothing**
- **`X.svg` is gone, replaced by `X.png`.** It was a single `<path>` with no
  `fill`, and SVG defaults that to black: on this near-black page it drew
  nothing, so a logo that had loaded fine read as a failed lookup. This is the
  file the trap in `CLAUDE.md` was written about.
- **`Uber.svg` had the same defect in a different costume** — not a missing
  fill but an explicit `fill="#000203"`, which is black in all but name.
  Replaced with the app icon, whose glyph is white.

  Both were invisible in the way that is hardest to notice: the request
  succeeds, the element is in the DOM, and the pixel is simply the colour of
  the page behind it.

- `npx tsx scripts/measure-logo-plates.ts` now reports **0 needing a light
  plate** across 31 SVGs. Raster files it cannot judge, and says so.

### There is no Windows backfill, and now the file says so

Windows was installed 2026-06-28 and the sampler started 2026-08-31, so 64
days of laptop history are missing. Every source that might hold them was
probed on this machine. None can.

**Documented**
- `CLAUDE.md` gains *There is NO Windows backfill*, with the full table of
  what was tried and how each one fails. The question is obvious enough to be
  asked again, and re-running these probes costs an hour.
- **`ActivitiesCache.db` (Windows Timeline) is dead, not empty.** It is a live
  5.6 MB SQLite file written today, and **all 866 rows have
  `EndTime == StartTime`**. `ActivityType` 5 and 6 -- the two that carry
  focus -- are absent; Windows 11 removed the collection with the Timeline UI.
  It passes every liveness check while carrying zero duration.
- **`powercfg /batteryreport` ignores `/duration`.** 7, 14 and 30 days all
  returned the identical 19 rows: weekly buckets from 07-04, daily for the last
  ~11 days. Its resolution cannot be widened.
- **The sibling's `usage_records` is the near-miss.** It covers 2026-06-27 to
  2026-09-02 -- 66 days, per app, per hour, exactly the range and grain wanted.
  It measures bytes. It stays out.

**⚠️ Corrected**
- **UserAssist is not a durable cumulative.** Re-read 2026-09-02, every figure
  `CLAUDE.md` quoted from 2026-08-31 had shrunk ~10x, the session counter
  `UEME_CTLSESSION` included. Entry count GREW while the times fell, so it is a
  reset rather than a pruning. It was described as a usable one-time sanity
  baseline; it is not one, and the note now says so.
- The ROT13 decode must use `-cmatch`. PowerShell's `-match` is
  case-insensitive, so uppercase letters take the lowercase branch and
  `MSEdge` decodes as `gS_dge` -- which reads as a corrupt registry value
  rather than as a bug in the reader.


### The home screen leaves the Most opened ranking

**Changed**
- `com.nothing.launcher` is excluded from the phone's **Most opened** chart.
  Measured: **2,908 opens against 999 for the next entry**, nearly three times
  the tallest real bar, while sitting only third by time. The launcher is what
  you pass THROUGH between apps, not something you open, so on a ranking of
  "what did I reach for" it was one bar answering a different question and
  flattening every bar that answered the right one. The chart's spread goes
  from 29x to 10.4x, and Maps is promoted into the eight.
- **It is excluded from the opens ranking ONLY.** It keeps its place in Top
  apps, in the By App table and on its own detail page: nine hours on the home
  screen is a real fact about the phone, and hiding that would be the more
  misleading choice. Time and opens are different questions and only one of
  them had a wrong answer.

**⚠️ The card NAMES what it dropped**
- A filter that silently removes a row is exactly the class of bug this project
  keeps finding elsewhere, so the Overview prints the label of whatever matched
  and why. If the rule ever catches the wrong package, the page says so on its
  face rather than quietly serving a shorter list.

**Added**
- `src/lib/home-surface.ts`, with ten self-tests. Android gives the phone no
  queryable "is this the home app" signal in what it uploads -- that is a
  `CATEGORY_HOME` intent resolution, which lives on the device -- so this is a
  name rule, deliberately narrow: the package name must END in `launcher`
  (optionally with a digit), plus a hand-written list for the launchers that do
  not say so, such as Xiaomi's `com.miui.home`.
- The tests guard the failure that matters: `com.launcher.example.reader` must
  NOT match. A rule written as `includes('launcher')` would have dropped it.

**Not changed**
- The laptop's Most opened is untouched. It has no runaway equivalent -- Edge
  442 against Explorer 441 against Claude 260 -- so there was nothing to fix.

### Most opened

**Added**
- **A "Most opened" chart on both Overviews**: the same eight ranked bars as
  Top apps, ranked by how many times each app was opened. The tooltip carries
  whichever figure the bars do not, so a bar in one chart can be placed in the
  other without leaving the card.
- The two rankings genuinely disagree, which is the argument for having both.
  On this phone, **Google, Phone and Telegram appear in the top eight by opens
  and nowhere in the top eight by time**, and Nothing Launcher is third by time
  but first by opens with 2,908 -- passing through the home screen is not the
  same activity as using an app, and only one of the two charts can see it.
- The launcher is left IN rather than filtered out. What counts as an app is
  the reader's judgement, and a hidden filter is the kind of thing this project
  keeps finding as a bug elsewhere.

**Refactored**
- `TopAppsChart` and `MostOpenedChart` share `RankedApps`, the way the four
  daily/hourly charts already share `DailyBars` / `HourlyBars`. Both take the
  same `Metric` (axis, tick, tooltip value) plus a tooltip-rows builder.

**Verified**
- Rankings compared against the live database, the figures above measured
  rather than assumed. `npm run selftest` 187 passed / 0 failed.

### Unlocks on the phone's Overview, opens on its app pages

**Added**
- **Two unlock cards** on the Android Overview: unlocks on the latest day, and
  unlocks per day over the days with data. One per `KEYGUARD_HIDDEN`, which is
  the event Digital Wellbeing counts, so the two figures are comparable.
- **Two charts on every Android app page**: *Opens per day* and *When it gets
  opened*, mirroring Daily trend and Shape of the day.
- `niceCountAxis()` in `axis.ts`, with self-tests. Same job as `niceHourAxis`
  on a decimal ladder, plus one property the time axis does not need: every
  tick is a WHOLE number. Half an unlock is not a thing, and an axis offering
  one says the chart measures something it does not.

**Removed**
- The **Unlocked** card, which reported unlocked TIME as a share of screen-on
  time. That ratio barely moves -- the phone is unlocked for nearly all the
  time its screen is on -- so it answered a question nobody asks. The figure
  itself is still on Sync Status.

**⚠️ Unlocks are counted PER SESSION, not per row**
- `android_screen` stores spans split at local hour boundaries, so one unlock
  from 21:40 to 23:10 is three rows. Measured on this phone: **1,203 rows are
  1,113 real unlocks** -- counting rows would have overstated by 8%, and would
  have inflated long sessions hardest, which is exactly backwards.
- A session is filed under the day it STARTED, so an unlock running past
  midnight counts once, on the day you picked the phone up.

**Opens are visits, filed by when they began**
- Time is split across a midnight boundary because time genuinely was spent on
  both sides. An open happened at one instant, so splitting it would invent an
  opening that never occurred.
- Verified on the busiest app: 201 visits, 201 opens summed across the daily
  columns, 0 visits that could not be placed in an hour.

**Refactored**
- `DailyTrendChart` / `HourlyChart` now share their implementation with the two
  new charts through `DailyBars` / `HourlyBars` plus a `Metric` (axis, tick,
  tooltip). The four charts differ only in those three functions, and one
  implementation is what stops the count charts drifting away from the time
  charts they are meant to be read beside.

**Verified**
- `npm run selftest` **187 passed / 0 failed**, `npm run typecheck` clean.

### Page subtitles say freshness, and stop repeating the device

**Changed**
- **Both Overviews** now read `Latest data Wednesday, 2 September 2026 -
  collected 12 min ago`. Identical wording on the laptop and the phone, since
  the two facts mean the same thing on both.
- **The device name is gone from every Android subtitle.** By App and Sync
  Status led with "Nothing A001" on a page the sidebar and the accent colour
  already identify.
- **Windows By App** is now just `39 apps across 3 days`. The trailing
  ", to <date>" moved out.
- The Android release moved from the Overview subtitle to a **Stored** row on
  Sync Status, beside the `queryEvents` reach it helps explain. It is a fact
  about the device, not about how current the numbers are.

**Added**
- `lastCollectedAt()` / `collectedAgo()` in `queries.ts`, serving both
  platforms off `sync_log`.

**Why a freshness line at all**
- A date alone cannot separate "quiet day" from "the collector died on
  Tuesday" -- the exact confusion the hourly ingest was meant to end, and the
  Overview was still not saying which it was looking at.
- It reads the newest **successful** run, never merely the newest. A failed run
  collected nothing, and stamping the page with its timestamp would claim the
  numbers are fresh at the moment they stopped being.

**Fixed**
- `formatRelative()` rounds to minutes BEFORE comparing. Testing the raw value
  and rounding afterwards let 59.7 minutes print as "60 min ago", a rung it had
  already left. Under a minute now reads "just now" rather than "0 min ago",
  which is what you saw right after pressing Sync now.
- Six self-tests cover it, including that boundary. It had none before, which
  is why the rounding bug had been sitting in an unused function.

**Verified**
- Against the live database: laptop `collected 40 min ago`, phone
  `collected 12 min ago`, from `finished_at` on each device's newest successful
  run.
- `npm run selftest` **135 passed / 0 failed**, `npm run typecheck` clean.

### The auth gate rewrites instead of redirecting

**Changed**
- **An unauthenticated page load is REWRITTEN, not redirected.** The login form
  renders at whatever address you asked for -- `/`, `/apps`, `/sync` -- and the
  URL does not change. Sign in and that page renders underneath you, so the
  `?next=` round trip is gone for ordinary page loads.

**Why**
- A tab left open on the Overview and reloaded after a while -- which is what
  the browser does to a tab it discarded while you were away -- came back as
  `/login`, and the page you were on was gone from the address bar. The phone
  pages looked immune only because you reach them less often; `curl` shows both
  redirecting identically, so the asymmetry was in the browsing, not the code.
  It is not an expiry either: the session is 30 days and renews daily.
- The redirect SURVIVES for RSC requests -- a soft navigation or prefetch into
  a locked route. Those expect a flight response and would choke on HTML, and
  Next turns the redirect into a hard navigation, which is the right answer
  anyway. `isDocumentRequest()` splits the two on `sec-fetch-dest`, with the
  `accept` header as the fallback and Next's own `RSC` / `_rsc` markers
  excluded first, because a prefetch carries an HTML `accept` too.
- The rewritten response is `cache-control: no-store`. Nothing may hold the
  login form under a dashboard URL.

**Verified**
- `curl` with a document `accept`: `/`, `/apps`, `/sync` and
  `/android/nothing-a001` all return **200 with the login screen**, no
  `Location`. With `RSC: 1`, `/apps` still returns **307 to
  `/login?next=%2Fapps`**. `POST /api/ingest` still returns **401**.
- In the browser: loading `/apps` cold shows the unlock card with the address
  bar still reading `/apps`.
- `npm run typecheck` clean, `npm run selftest` 129 passed / 0 failed.

### Sync now moved to the top bar

**Changed**
- **Sync now moved from the laptop's Overview to the top bar**, on the laptop's
  pages only. `.page-head--actions` went with it; the heading is a plain
  `.page-head` again.

**Why**
- The staleness it closes belongs to the DATABASE, not to one page. By App and
  Sync Status read the same rows and were just as far behind, with no way to
  close the gap without navigating back to the Overview first.
- It sits at the LEFT of the right-hand group, before the range chips. It
  shares their `chip` styling, so between the group and Sign out it read as a
  fourth range; leading the group, its label and icon set it apart.
- Not on the phone's pages: the phone pushes on its own schedule, and there is
  nothing on this machine's disk waiting to be folded in.

### Hourly ingest, and a Sync now button

**Changed**
- The "Screen Time Ingest" task runs **hourly** instead of daily 03:30.
  `-Once` at midnight with an hourly repetition, so it is one trigger rather
  than 24, and `-StartWhenAvailable` catches up a run missed during sleep.
- Ingest logic moved from `scripts/ingest-windows.ts` to
  `src/lib/windows-ingest.ts` and now returns its result instead of printing
  it. The script prints; the route turns the same object into a toast sentence.
  Mirrors `android-ingest.ts`.

**Added**
- `POST /api/ingest` and a **Sync now** button on the laptop's Overview.

**Why the cadence changed**
- "Daily is plenty" was right that nothing evicts the JSONL -- a missed run
  costs no data. It was wrong about freshness: the dashboard reads only the
  database, so it is stale by however long since the last ingest. On
  2026-09-01 the Overview showed one day of data and under an hour of use with
  **722 unread spans on disk**, and nothing on the page said "a day behind"
  rather than "idle".

**Verified by pressing it**
- First press: "Added 9 segments from 105 spans", and Today moved up by 12 minutes
  without a page reload (`router.refresh()`, every page being force-dynamic).
- Second press: "Up to date -- read 105 spans, nothing new", numbers unchanged.
- `npm run ingest` still behaves identically after the refactor.

### No logos on the Top apps axis

**Changed**
- The chart's y-axis shows the app name only. Logos stay where they earn their
  space: the By App tables, the app detail pages, and this chart's tooltip.
- The 26px the logo column took goes back to the bars.

**Fixed, and it was mine**
- Making the tick formatter exact (last commit) had a consequence on the two
  charts that were NOT given chosen ticks: Recharts' own tick VALUES were never
  round, and the old formatter had been hiding that by rounding on the way out.
  The Daily trend axis started reading **"3h33", "7h55", "9h17"**.
- Both axes now use `niceHourAxis` as well, so the values are genuinely round
  and the labels are honest rather than rounded-to-look-tidy. They also stop
  overshooting their data, which is the same win the Top apps axis got.

### Top apps: an axis that ends at the data, and bars in each app's colour

**Fixed**
- The Top apps x-axis overshot badly. On the phone, the top app peaked at 11h 5m
  and the axis ran to **17h** -- more empty space than half the data again,
  which makes every bar look shorter than it is. Recharts picks a "nice"
  ceiling from a FIXED TICK COUNT and overshoots to reach it.
- `niceHourAxis()` chooses the STEP first, from a list of steps that mean
  something to a person (1m..24h), taking the smallest that covers the peak in
  at most six intervals; the ceiling falls out of it. 11h 5m now takes a 2h
  step and ends at 12h.
- The tick formatter rounded anything past an hour, so a 30-minute step would
  have printed 1.5h as "2h", one tick below the real 2h. Now exact.

**Added**
- Bars are drawn in the app's brand colour (`src/lib/app-colour.ts`), so a bar
  is recognisable before its name is read. Apps with no known colour keep the
  device accent, and the peak-is-brighter rule still applies to them.
- `scripts/measure-logo-colours.ts` derives those colours from the logo files
  themselves -- SVG paints from source, PNG/JPG pixels bucketed and averaged.
- `src/lib/axis.ts`, split out of `Charts.tsx` so the axis maths is testable:
  that file is a client component and pulls in Recharts. Same reasoning as
  `sampler-status.ts` leaving `queries.ts`. **129 self-tests now**, including a
  property test that the ceiling always lands within one step of the peak.

**Two judgement calls worth keeping**
- `sharp` is used by the measurement script but deliberately NOT added to
  package.json, and the derived colours are committed by hand. `CLAUDE.md`
  rejects native modules precisely because `npm run restore` runs
  `npm install`, and a native dep that fails to build would fail the restore
  the whole project exists for.
- The script's output is a starting point, not the answer: it counts paint
  DECLARATIONS rather than area, so a four-colour Google logo ties and breaks
  toward the most saturated paint -- yellow every time. It proposed yellow for
  Gmail and Maps and green for Gemini. Corrected by hand, each marked as such.

**Also**
- `Charts.tsx` contains no colour hex again. The logo plate introduced one
  last commit; it is now `var(--logo-plate)`.

### App logos

**Added**
- `src/lib/app-logo.ts`, `/api/app-logo/[key]`, and an `AppIcon` component.
  Logos now show on both Overviews' Top apps chart, both By App tables and both
  app detail pages.
- `scripts/measure-logo-plates.ts`, and 13 self-tests over the matching rules.

**Why they were not showing**
- Nothing read the folder. `public/apps_logo/` shipped in the Phase 0 scaffold
  with a README saying the serving route would arrive "in Phase 2"; it never
  did, so thirty-odd files sat on disk unreferenced by any component.

**Why a route and not a `public/` link**
- `next start` SNAPSHOTS `public/` at boot. Measured against the live server:
  a logo present at boot served 200, a file added afterwards 404'd. This
  dashboard runs as a logon task for weeks at a time, so every logo added from
  now on would have been invisible until a reboot -- with the file on disk and
  correctly named, which looks exactly like broken matching code.
- The manifest rebuilds on the folder's mtime, so new files need no restart.

**Two rules worth keeping**
- The lookup key is never joined into a path; the manifest's own file name is
  what gets read. This dashboard is reachable over the LAN.
- A miss returns null rather than a URL that 404s, and the caller draws the
  app's initial. Most apps have no logo, so the fallback has to look
  deliberate.

**Measured, not guessed**
- `X.svg` is a single `<path>` with no `fill`, which SVG defaults to black --
  invisible on a near-black page, and indistinguishable from a failed lookup.
  It gets a light plate. The script re-runs the measurement over the SVGs; it
  cannot judge a PNG, so those go in the set by eye.

### Top apps is a chart, not a table

**Changed**
- Both Overview pages draw their top eight apps as ranked horizontal bars
  (`TopAppsChart`). Time, Share and Opens moved into the tooltip, along with
  the `system` tag that used to sit beside the name.

**Why a chart**
- Ranking is the point, and a column of durations hides it: reading
  "51m 33s / 4m 18s" means subtracting in your head to learn the first is
  twelve times the second. Bar length says it without arithmetic.
- Horizontal, not vertical: app names are long proper nouns, and rotated under
  a vertical bar they collide and stop being readable.

**Why the tooltip is an acceptable home for the figures**
- `/apps` still carries the full four-column table, so no number left the
  dashboard -- only this card. Anything that makes this chart the SOLE home of
  a figure should put that figure back on the page.

**Three defects found by rendering it rather than by reasoning about it**
- Recharts' `<Text>` WRAPS a y-axis tick at word boundaries once it exceeds the
  axis width, against an effective width well under the 132px given to the
  axis. "Desktop Window Mana" broke onto two lines even at a 16-character clip,
  leaving one label two rows tall beside neighbours that were one. Fixed with a
  raw SVG `<text>` tick, which has no wrapping logic to trip over.
- That custom tick then made Recharts fall back to its own collision
  avoidance, which dropped ALTERNATE labels -- four of eight apps came back
  unnamed. `interval={0}`: one tick is one app, so there is nothing to thin.
- The bars keep the click-through the app name used to carry. `href` is
  resolved server-side, because `earnsDetailPage` lives in `queries.ts`, which
  is `server-only` and unimportable from a client chart.

### The duration ladder stops at hours

**Changed**
- `splitDuration`, `durationShape` and `formatDurationLike` no longer have a
  day rung. A multi-day total now reads `51h 12m` rather than `2d 3h`.
- The Android Sync page reports `queryEvents` reach in hours rather than days.

**Why**
- Screen time is spent in hours and judged against a day that holds 24 of them,
  so a "d" total has to be unpacked back into hours before it means anything.
- `d` also collided with the OTHER quantity this dashboard reports in days --
  "11 days of data", the `Days` column in the app tables -- which is a count of
  calendar days, not a duration. Two units spelled the same on one page.

### Dashboard pages for the Windows half

**Added**
- Overview, By App and Sync Status pages, plus `queries.ts`, `app-name.ts`,
  `Charts.tsx` and `KindBar.tsx`.
- `sampler-status.ts`, extracted from `queries.ts` so the heartbeat parsing can
  be unit-tested -- `queries.ts` is `server-only` and unimportable from a
  script. 49 self-tests now, including BOM-prefixed and stale heartbeats.

**Design decisions worth keeping**
- The headline is computed differently per device and that is deliberate: the
  Windows sampler partitions time exclusively so SUM over apps IS the total,
  while Android's per-app sessions measured 0.76x screen-on.
- `unknown` is surfaced as its own segment with a warning above 10%, rather
  than folded into "not active". `gap` is excluded from the trend chart, since
  a sleeping laptop is the absence of a measurement rather than a quantity.
- Averages divide by days WITH DATA, and ranges anchor on the newest day that
  has data rather than on today.

### Phase 2 - Android schema, ingest and endpoint

**Added**
- `android_devices`, `android_daily`, `android_segments`, `android_screen`.
- `src/lib/android-ingest.ts` and `POST /api/android/ingest`, bearer-token
  gated and failing closed on an unset token.
- 43 self-tests, including the write rules, half-hour-timezone hour splitting,
  and that a minimal payload cannot erase device metadata.

**Corrected**
- The documented rule "android events -> INSERT OR IGNORE" was wrong. The
  phone ships its in-flight session, which grows between syncs, so all three
  Android tables upsert on MAX(). The real question is not whether a session is
  complete but whether a row can still grow.
- `android_screen` is a separate table from `android_segments` because they
  OVERLAP; one table with a kind column would let a naive SUM count the same
  minutes twice.

**Fixed**
- A sync carrying only spans erased device metadata (`android_release` went
  "16" -> ""), because the device upsert wrote empty strings unconditionally.

### Phase 1b - the Android sources, measured

Phone connected; `npm run android:capture` then `npm run android:analyze`.

**Retention sets the cadence.** 10 daily files (~10 days), 4 weekly, 6 monthly,
2 yearly. Per-day resolution is gone after ten days, so the collector must run
well inside that. Events in the dump span only 24 h, but that is a property of
`dumpsys`, not of `queryEvents` - the API's real reach must be measured from
the APK in Phase 2.

**A Phase 0 assumption was wrong.** Per-app session time UNDERSHOOTS screen-on
time (0.76x); it does not overshoot. The rule it implies
is unchanged - the headline comes from SCREEN_INTERACTIVE event pairs, never a
SUM over apps - but for the opposite reason, and the real overshoot risk is
`totalTimeFS`, which summed to 2.07x screen-on. One volume widget
reported 16h18m of foreground-service time with zero foreground time.

**Four `dumpsys usagestats` format traps**, all documented in CLAUDE.md:
durations render as `MM:SS` or `HH:MM:SS` so field count decides the unit (a
60x error in the flattering direction); the field is `totalTimeUsed`, while
`totalTime=` matches 14 configuration rows and misses all 645 package rows;
there are four time fields per package and only one is screen time; and the
dump carries a section per Android user, duplicating 1,206 event lines.

**Added**
- `scripts/phase1-android-capture.ts` (`npm run android:capture`) - captures
  and CHARACTERISES rather than parsing, with redaction asserted before write.
- `scripts/phase1-android-analyze.ts` (`npm run android:analyze`) - retention,
  the trap test, the three time fields, and session reconstruction.

**Still outstanding**: comparison against the phone's own Digital Wellbeing
figure. It derives from the same events, so a material disagreement would mean
the reconstruction is wrong.

### Phase 1a - the Windows source, measured and rejected

**Finding: SRUM cannot provide Windows screen time.**

`AppTimelineProvider` IS populated on Windows 11 build 26200 - 46,243 rows over
522 apps - but SrumECmd 2026.5.0 exposes 12 columns and `InFocusDuration` is
not among them. The only duration, `DurationMs`, measures per-process presence:

| Test | Result |
|---|---|
| Budget | 12,792 h summed inside a 160.9 h window - 79.5x over |
| Concurrency | 439 rows live at one instant |
| Coverage | union 69.1 h, 43% of the window |
| Top app | `svchost.exe`, 5,626 h across 15,922 rows |

Retention is 6.7 days, against 30+ for the network table.

**Consequence:** Phase 3 becomes a `GetForegroundWindow` sampler. That needs no
elevation, no VSS, no dirty-shutdown recovery and no 99 MB copy per run - the
sibling collector's entire elevated apparatus disappears - and retention
becomes ours rather than Windows' 7 days.

**Added**
- `scripts/phase1-analyze-atp.ts` (`npm run atp`) - four independent tests of
  whether a duration column can be foreground time. Unelevated, and re-runnable
  against the probe's CSVs without another snapshot.

**Changed**
- `scripts/phase1-probe-windows.ps1` now reports the real schema and keeps the
  CSVs, deleting only the 99 MB snapshot. The first version deleted everything,
  so every analysis tweak would have cost another elevated VSS run.

**Fixed**
- `$PSScriptRoot` is empty inside a `param()` block, so the probe's helper path
  expanded to `\srum-recover.ps1` and preflight failed with what looked like a
  missing file. Resolved in the body instead.
- Probe command in the docs is now an absolute path; the relative form only
  worked from the repo root.

## [0.1.0] - 2026-08-31

### Phase 0 - scaffold

First commit. The project builds and serves, and deliberately collects nothing.

**Added**
- Next.js 15 / React 19 / TypeScript scaffold on port 7844, with the `(dash)`
  route group, the shared-password gate, and the sidebar/top-bar shell carried
  over from the sibling Data Usage Tracker.
- `src/lib/format.ts` - a mixed-radix duration ladder replacing the sibling's
  byte formatter. `splitDuration()` returns two rungs because one is routinely
  not enough; `formatDurationLike()` holds the count-up animation's shape to
  the final value so it does not reflow on the way up.
- `src/lib/accent.ts` - violet for the laptop, Android green kept for the
  phone, plus a clock favicon. So the two dashboards are distinguishable at a
  glance and in a tab strip.
- `src/lib/schema.ts` - `meta` and `sync_log` only. `sync_log` carries
  `device_id` and `source` from the start, unlike the sibling where the Android
  run history was bolted on beside the Windows one later.
- `scripts/phase1-probe-windows.ps1` - read-only, elevated. Settles whether
  SRUM's `AppTimelineProvider` table is populated on Windows 11.
- `scripts/srum-recover.ps1` - a copy, not a cross-repo reference, so this repo
  can be restored and run on its own.

**Deliberately absent**
- Any usage table. Phase 1 measures the sources first; writing those columns
  from memory would bake guesses into the layer that is most expensive to
  change, because by the time it is wrong there is history stored in the wrong
  shape.
- Any collector.

**Measured**
- `SrumECmd.exe` emits `AppTimelineProvider_Output.csv` (confirmed from its
  UTF-16 strings). Whether the table has rows is still unknown - the database
  is locked and the SRUM registry key denied access unelevated.
- UserAssist carries real focus time unelevated (295 entries) but is cumulative with no time series, so it is
  a sanity baseline rather than a source.
- The existing Data Usage reporter APK already holds `PACKAGE_USAGE_STATS`,
  which is exactly the permission `UsageStatsManager` needs.

**Traps recorded**
- Cookies are scoped by host, NOT origin - the port is not part of the key - so
  the session cookie had to be renamed or the two dashboards would overwrite
  each other's sessions.
- Running the dev server from an 8.3 short path crashes libuv's file watcher
  (`fs-event.c` line 72) after printing "Ready".
