# Changelog

Notable changes per release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The day-by-day reasoning behind
each change -- what was measured, and what it overturned -- is in
[`docs/DEVLOG.md`](docs/DEVLOG.md).

## [Unreleased]

### Added
- **A project site** in `site/`, deployed on Vercel at
  <https://screen-time-tracker-site.vercel.app/> with Root Directory `site`:
  what the project is for, how both collectors work, a tour of every page in
  the matching theme, every chart type drawn live on invented data with a
  laptop / phone switch and Time / Opens toggles, and every feature. Plain
  HTML, CSS and one script; a push rebuilds it only when `site/` or
  `docs/screenshots/` changed. Linked from a README badge.
- **Light-theme screenshots.** `npm run demo:shots` takes every page in the
  dark theme and again in the light one (`*-light.png`), from one seeded
  demo, so each pair shows the same numbers.
- **Link previews for the project site**: Open Graph and Twitter card tags,
  with `docs/social-preview.png` copied in by `site/build.mjs` as the image,
  so a shared link unfurls with a picture. Vercel also rebuilds when the
  card changes.

### Changed
- **The project site's screenshot tour is hidden**, pending review: the
  section, its nav link and its script are kept, the hero's second button
  goes to the charts, and a Top 10 bar no longer offers to open a detail
  page while there is no tour to open it in.
- **The social preview's source is committed** (`docs/social-preview.html`),
  and the image shows the project site's address in place of the
  repository's.

- **The project site shows phones its desktop layout**, zoomed to fit, like
  the dashboard (`width=1024` viewport).
- **Sync now is on the phone pages too** when the cloud inbox is configured.
  It drains the inbox, so a phone's upload lands at once instead of at the
  next hourly ingest. Without an inbox it stays on the laptop's pages only.

### Fixed
- **`npm run demo:shots` failed when TEMP is on another drive than the
  repo**, as it is with the repo on `D:`: Turbopack refused the scratch
  copy's `node_modules` link across drives, in a panic halfway through the
  build. The scratch copy now goes on the repo's drive (TEMP when it is
  there, else `.screentime-shots` beside the repo), and a folder given on
  another drive, or inside the repo, is refused before anything is copied.

## [1.5.1] - 2026-10-14

### Changed
- **Screen Time Reporter 1.3.1: the app icon is Android Green**, the accent
  the dashboard gives a phone, on a dark green ground; it was violet. The
  clock shape is unchanged, so it still differs from the sibling Data Usage
  Reporter's bars.

## [1.5.0] - 2026-10-14

### Added
- **A cloud inbox, so a phone can report from any network, and while the PC
  is off.** Screen Time Reporter 1.3 can post to a fixed `https://` address
  instead of the dashboard's LAN address, which changed with every router
  reboot and did not exist away from home. The PC empties the inbox on the
  hourly ingest and on **Sync now**, through the same validation and upserts
  as a direct upload. Optional, and off unless `inbox` is set in
  `config/collector.json`.
- **The inbox stores only what it cannot read.** The app seals each upload to
  a P-256 key only the PC holds (ECDH, HKDF-SHA256, AES-256-GCM), with the
  ingest token in the key derivation so only the app can make an envelope the
  PC accepts, and authenticates to the inbox with an HMAC of the token rather
  than the token itself. Setup is one tap at home, **Set up from the
  dashboard**, which fetches the address and the PC's key from the dashboard
  over the LAN, never from the inbox. The inbox is a Supabase Edge Function
  and two tables (`supabase/`), shared with the sibling Data Usage Tracker as
  separate mailboxes, within the free tier.
- `npm run inbox -- keygen | key | drain-token | sql | drain`.

### Changed
- **The phone app's screen is redesigned** (Screen Time Reporter 1.3): true
  black and Android Green, a status card answering "is it working?" (green,
  amber after three days, red on a failure or when unsent history is about
  to be lost) above the data window, destination, the interval Android
  actually accepted and how many days the phone keeps; cards for the
  dashboard, the cloud inbox, background sync and full resync. Permissions
  show only while one is missing. Turning the inbox off and a full resync
  ask first. Still framework views only, no libraries.
- The phone's Sync page marks an upload that came through the inbox with
  when it reached the database; the laptop's run history labels it
  "Android, via inbox".

### Fixed
- **The app showed the ingest token in clear.** Every earlier build made the
  token field single-line after giving it a password input type, and
  `setSingleLine()` replaces the masking. It is masked now, with Show / Hide.

## [1.4.1] - 2026-10-08

### Added
- **`npm run android:merge`** folds one phone entry's history into another
  for the same phone. Reinstalling the phone app (for example to switch
  between a self-built and a released APK) gives it a new device id, so its
  next sync appears as a second phone holding only recent days. The script
  reports what it would move and compares the overlap day by day; `--apply`
  backs up first, keeps the new entry's rows where the two overlap, and gives
  the merged phone its old address back.

### Fixed
- **A freshly installed phone app could report as two phones** (Screen Time
  Reporter 1.2.1). Its device id was created on first use without a lock,
  and the first background sync and **Sync now** could both create one.

### Security
- **Next.js 16.3.8**, which fixes server-side request forgery in image
  optimisation, cache poisoning of statically generated pages, information
  disclosure through metadata image routes and the development server, and
  draft-mode content leaking into cached responses. Also **sharp 0.35.5**
  (a librsvg vulnerability) and **source-map-js 1.2.2** (a denial of
  service). `npm audit` reports none outstanding.

## [1.4.0] - 2026-10-08

### Added
- **The phone warns before its unsent history is lost** (Screen Time
  Reporter 1.2). A daily check, which runs with or without a network, posts
  a notification when the dashboard has not received the phone's history for
  168 hours -- sooner on a phone that keeps less: the limit is the phone's own
  measured history reach minus 48 hours. Syncing clears it. The app asks for
  notification permission on Android 13 and later, and its status says when
  notifications are off.

## [1.3.0] - 2026-10-03

### Added
- **Screen Time Native can be the laptop's sampler.** Set
  `nativeDatabasePath` and `nativeFrom` in `config/collector.json` and the
  ingest (hourly, and Sync now) copies the laptop's screen time from that
  app's database instead of reading this project's JSONL; Sync Status reads
  its sampler's heartbeat. `nativeFrom` must be a local hour edge, where both
  samplers split their rows, so nothing straddles the seam. The PowerShell
  sampler's last rows past the seam are replaced automatically once the
  native app has covered that time. `install-sampler.ps1 -IngestOnly` stops
  this project's sampler cleanly, removes its task and keeps the ingest.
- **`CONTRIBUTING.md`**: how to report, what to run before a change, and the
  rules a change must keep.

### Changed
- **The dashboard and the sampler restart themselves after a crash.** Both
  tasks run a VBS launcher that exited as soon as its child was running, so
  Task Scheduler never saw a crash and their restart setting could not act:
  a crashed sampler stayed down until the next logon, losing recording that
  cannot be caught up. `dashboard-service.ps1` now restarts a server that
  exits unasked (`stop-dashboard.bat` marks its stop as wanted first), and
  `sampler-hidden.vbs` waits for the sampler and restarts it on a non-zero
  exit, logging to `logs/sampler-restarts.log`. Both retry 60 s apart, at
  most 3 times; a clean exit is never restarted. The Ingest task also
  retries 3 times, a minute apart, when it fails to start.
- **The start `.bat` opens your browser once the server's port is
  listening,** instead of probing over HTTP, like the other dashboards'
  launchers; and its already-running message points at `stop-dashboard.bat`.
  An HTTP probe of `localhost` costs about 2 s to fall back from `::1` against
  a server on `127.0.0.1` alone, and the login redirect names `localhost`.
- **Both dashboard launchers share one build rule,** in
  `scripts/ensure-build.ps1`. The logon task (which rebuilds a stale build)
  and `start-screen-time-dashboard.bat` (which warns) each carried their own
  copy; now they call the same script. A build now also needs `.next/server`,
  not just `.next/BUILD_ID`, so a half-deleted `.next` is rebuilt instead of
  served. A change to `package.json`, `next.config.mjs` or `tsconfig.json` now
  counts as newer source too, so a dependency update is rebuilt at logon.
- **The expanded Activity page opens on the first recorded day**, not on the
  1st of that month: a laptop whose history began on the 31st no longer
  opens on a month of outlined, never-recorded days. The days before it in
  its week are hidden. Both the laptop's and the phones' pages.

### Fixed
- **`install-sampler.ps1 -RunNow` always reported the sampler running.** Its
  process check matched `*sampler.ps1*`, which `install-sampler.ps1` itself
  matches, so it found its own process. It now requires `\sampler.ps1` and
  skips its own PID.

## [1.2.0] - 2026-10-01

The phone app is unchanged: 1.1 (`versionCode 2`), from the
[v1.1.0 release](https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.1.0).

### Added
- **Light theme.** A Dark / Light / System menu in the top bar, shown as a
  sun or a moon. It is its own design rather than the dark one inverted: a
  pale grey page under white cards, real borders and soft shadows, hover as
  lift, greys measured for contrast on white (secondary text 7.7:1, the
  faintest 5.3:1), and each device's accent deepened until it reads as text
  on white (violet `#6644e8`, Android green `#0d7340`, both 5.9:1). The heat
  map runs light to dark, never-recorded days keep a visible outline, and app
  colours are painted within a lightness band so a near-white brand colour
  still shows on a white card. The choice is kept per browser and applied
  before the first paint, so no page flashes the other theme; the installed
  app's title bar follows it. Dark stays the default.

- **Rename any app from the dashboard.** A pencil beside the name on each
  app's page, and on hover in the By App tables, opens an inline field:
  Enter saves, Escape cancels, Reset returns to the original name. The new
  name reaches every table, chart, legend, callout and page title. Stored in
  a new `app_renames` table (schema 5) in the database, so it is backed up
  and survives a reset. The laptop renames the resolved app; a phone renames
  the package. A renamed app keeps its logo and bar colour unless a logo file
  matches the new name. Refused: a name another app on the same device
  already shows, `Other`, and anything outside 1-60 characters.

- **Choose any app's bar colour.** The rename pencil also edits the colour:
  a colour picker and a hex field that stay in step, and "Default colour" to
  go back to the brand colour (or the device accent, for an app without
  one). Stored in a new `app_colours` table (schema 6) beside the renames,
  so it is backed up and survives a reset. It wins everywhere the app's
  colour is drawn, survives a rename, and is kept readable on both themes
  the same way a brand colour is. Only `#rgb` / `#rrggbb` is accepted, and
  it is checked again when read back.

- **Page through the whole run history.** Both Sync pages show 25 runs at a
  time with a pager: Newest and Oldest at the ends, Newer and Older one step
  each, the page numbers around the current one (`1 … 4 5 [6] 7 8 … 13`),
  and a "Go to page" box. The card title says which runs are showing
  ("26-50 of 318"). Links and a plain form, so every page is a URL
  (`?runs=`). The history used to stop at the newest 40 runs on the laptop
  and 60 on a phone.

- **Install the dashboard as an app.** Edge and Chrome on the PC offer to
  install it from `http://localhost:7844`, and it then opens in its own
  window with the clock icon. There is no offline mode: an installed window
  shows live numbers or nothing. A phone on the LAN gets a home-screen
  shortcut at most, because browsers only install sites served over HTTPS or
  from `localhost`. It installs as **Screen Time Dashboard**.

- **Top apps by day** and **Most opened by day** on every Overview, after
  the Activity heat map: each day's time and opens stacked by app, the top
  eight named and the rest grouped as Other, with logos in the legend and a
  per-app breakdown on hover. On a phone the home screen is left out of the
  opens chart, as it is on By App, and the card says so.

### Changed
- **The README shows every page in full.** All ten pages, top to bottom,
  retaken from the demo with today's dashboard (theme menu, pager, exact
  skeletons) and shown open rather than collapsed. `npm run demo:shots`
  retakes them in one command.

- **Loading skeletons match the page at every width.** They render each
  page's own markup -- real classes and grids, the real headings and fixed
  sentences as invisible shimmering text, score values at the real font,
  the real heat-map grid -- instead of one averaged height per section.
  Measured against all ten pages at 997px and 1680px: every section now
  lands to the pixel, where the Overview's heat map used to be 47px off and
  its stacked charts 23px. Only the long tables keep a fixed length, below
  the first screen. The fixed explanatory notes they share with their
  pages moved to `components/Notes.tsx`, so the two cannot drift.

- **Every chart names its headline figure in its top right corner**: the
  busiest hour on Shape of the day, the top app on the new stacked charts,
  and on each app's page the heaviest day, the day with the most opens and
  the busiest hour for time and for opens.

### Fixed
- **A phone's run history could be crowded out by the other devices.** It
  took the newest 60 runs across every device and only then kept this
  phone's, so with the laptop ingesting hourly a phone could show few of its
  own syncs, or none. It now asks for this phone's runs directly.

- **The laptop's run history lost its Backup column.** The table borrowed
  the app table's fixed widths, which cover six columns, and the seventh got
  no width at all. Both run histories now size their own columns.

## [1.1.0] - 2026-09-23

### Added
- **Phones on Android 8.1 and 9.** The phone app now installs on Android 8.1
  (API 27) and up, from 10 before (*Screen Time Reporter* 1.1, `versionCode
  2`, attached to the
  [v1.1.0 release](https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.1.0)).
  Android only records screen-on and unlock events from version 9, so an
  8.x phone's pages show **time in apps**: the time any app or the home
  screen was in front, with overlaps counted once. They say so, leave the
  unlock figures out instead of showing zero, and explain why. Phones on 9
  and up are unchanged.
- **A signed release APK** of *Screen Time Reporter*, attached to the
  [v1.0.0 release](https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.0.0).
  The signing key is never in the repository; builds without it come out
  unsigned rather than debug-signed.

### Changed
- **Phones are listed in the sidebar in the order they were added**, so a new
  phone joins the end instead of reshuffling the list. They were
  alphabetical.
- **Next.js 16** (from 15) and **React 19.3**, with the other minor and patch
  updates Dependabot grouped. Nothing visible changes; after pulling, run
  `npm install` and rebuild. The auth gate is now `src/proxy.ts`, Next 16's
  name for what was `middleware.ts`.

### Fixed
- **A wrong address is a real 404.** A misspelt device, or an app that was
  never recorded, showed the not-found page but sent status 200. A malformed
  `%` in the path now gets 400 instead of a server error.
- **The sign-in form is never cacheable.** Served in place of a dashboard
  page, it could go out marked cacheable for a year on a fresh build.
- **The daily trend line** is one continuous line again: a day with no
  recording dips to zero instead of breaking the line. The tooltip still
  says "Not recorded".
- **The Windows sampler survives a logoff.** A logoff kills it without its
  cleanup; the next start now recovers the lost span and records the time it
  was down as a gap. One sampler per output folder is enforced, and a long
  switched-off period no longer overflows span lengths at 24.8 days.
- **Days holding only gap** no longer count as days with data, so time
  switched off does not lower the daily average.

## [1.0.0] - 2026-09-23

First public release.

### Added
- **Windows collector**: an unelevated foreground-window sampler (logon task),
  with lock detection through `WTSQuerySessionInformation`. It writes
  crash-safe JSONL, which an hourly task and a "Sync now" button fold into
  SQLite. Window titles are never captured.
- **Android collector**: *Screen Time Reporter*, a dependency-free APK that
  reads `UsageStatsManager` events and pushes sessions and screen-on spans
  over the LAN, gzipped, with a server-confirmed watermark.
- **Dashboard** (Next.js, port 7844): per-device Overview, By App, Activity
  heat map and Sync Status pages, with app detail pages, range scoping,
  brand-coloured bars and local logos.
- **Reset survival**: the database lives off the system drive and is backed up
  with SQLite's `backup()`. `npm run backup:kit` saves the code, the secrets
  and the local-only config, and `npm run drill` proves a restore would work.
- **Demo mode**: `npm run demo:seed` builds a synthetic installation through
  the real write paths, so the dashboard can be tried without a sampler or a
  phone.
- `npm run selftest` (368 checks), GitHub Actions CI and Dependabot.

### Security
- Fail-closed shared-password gate; login throttling with a global budget; a
  PBKDF2-derived session key; a safe post-login redirect; cross-origin writes
  refused; size-capped phone uploads; CSP and related headers; sandboxed SVG
  logos; `npm run firewall` to keep the port off Public networks. See
  [`SECURITY.md`](SECURITY.md).

### Accessibility
- WCAG 2.1 AA contrast throughout, per-page titles, a text summary on every
  chart, a skip link, `aria-current` navigation and announced login errors.
  Two documented exceptions: the fixed-width phone layout, and the heat map's
  lowest shades.

[Unreleased]: https://github.com/naimulnashid/screen-time-tracker/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.4.1
[1.4.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.4.0
[1.3.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.3.0
[1.2.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.2.0
[1.1.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.1.0
[1.0.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.0.0
