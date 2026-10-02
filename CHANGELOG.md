# Changelog

Notable changes per release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The day-by-day reasoning behind
each change -- what was measured, and what it overturned -- is in
[`docs/DEVLOG.md`](docs/DEVLOG.md).

## [Unreleased]

### Changed
- **Both dashboard launchers share one build rule,** in
  `scripts/ensure-build.ps1`. The logon task (which rebuilds a stale build)
  and `start-screen-time-dashboard.bat` (which warns) each carried their own
  copy; now they call the same script. A build now also needs `.next/server`,
  not just `.next/BUILD_ID`, so a half-deleted `.next` is rebuilt instead of
  served.
- **The expanded Activity page opens on the first recorded day**, not on the
  1st of that month: a laptop whose history began on the 31st no longer
  opens on a month of outlined, never-recorded days. The days before it in
  its week are hidden. Both the laptop's and the phones' pages.

### Added
- **`CONTRIBUTING.md`**: how to report, what to run before a change, and the
  rules a change must keep.

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

[Unreleased]: https://github.com/naimulnashid/screen-time-tracker/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.2.0
[1.1.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.1.0
[1.0.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.0.0
