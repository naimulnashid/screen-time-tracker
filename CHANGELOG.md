# Changelog

Notable changes per release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The day-by-day reasoning behind
each change -- what was measured, and what it overturned -- is in
[`docs/DEVLOG.md`](docs/DEVLOG.md).

## [Unreleased]

### Added
- **Install the dashboard as an app.** Edge and Chrome on the PC offer to
  install it from `http://localhost:7844`, and it then opens in its own
  window with the clock icon. There is no offline mode: an installed window
  shows live numbers or nothing. A phone on the LAN gets a home-screen
  shortcut at most, because browsers only install sites served over HTTPS or
  from `localhost`.

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

[Unreleased]: https://github.com/naimulnashid/screen-time-tracker/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.1.0
[1.0.0]: https://github.com/naimulnashid/screen-time-tracker/releases/tag/v1.0.0
