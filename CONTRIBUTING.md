# Contributing

Thanks for looking. This is a personal project shared as is, so the bar is:
keep it working for its one real use, and keep it honest about its numbers.

- **Bugs and questions:** open an issue. Please leave out your own usage
  data, app lists, device names and network addresses; describe the shape of
  the problem instead.
- **Small fixes:** a pull request is welcome.
- **Anything larger:** open an issue first, so we can agree it fits before
  you spend the time. The design is deliberately narrow.
- **Security issues:** not in a public issue; see [SECURITY.md](SECURITY.md).

## Before sending a change

```bash
npm run typecheck
npm run selftest     # no device or database needed
```

CI runs both, plus a production build, a PowerShell 5.1 check and the APK
build. **Read [`CLAUDE.md`](CLAUDE.md) before changing anything**: it records
why the numbers are computed the way they are, and which parts are rules
rather than taste.

## Conventions

- **Conventional commit messages** (`feat:`, `fix:`, `docs:`), one concern
  per commit.
- **Never capture window titles**, on either device. A title can name the
  document, the page or the person on screen; this records the app and the
  duration only.
- **The headline is computed differently per device, on purpose.** The
  laptop's active time is the sum of its app spans; a phone's screen time
  comes from screen-on events and never from summing its apps. Do not make
  one match the other.
- **Auth fails closed.** An unset `DASHBOARD_PASSWORD` or
  `ANDROID_INGEST_TOKEN` locks the door; never make a missing value mean open
  access.
- **The database never lives on the system drive.** `openDatabase()` refuses
  it; do not weaken the guard to make a test pass.
- **Keep every `.ps1` pure ASCII.** Windows PowerShell 5.1 reads a BOM-less
  script as ANSI, and a UTF-8 dash can silently change its logic.
- **Never commit collected data**, logos or the local config files.
  `.gitignore` keeps them out.
- **Screenshots come from the demo data only.** `npm run demo:shots` retakes
  every README image from the invented history; never photograph your own.
- **No new dependencies without a reason**, and no native modules: the
  project is meant to restore with a plain `npm install` years from now.
