@echo off
setlocal

REM ---------------------------------------------------------------------------
REM Starts the Screen Time Dashboard and opens it in your browser.
REM
REM This is the MANUAL way in. Normally the "Start Screen Time Dashboard" logon
REM task does this at every logon (npm run autostart -- -RunNow). This file is
REM for when that task is disabled, removed, or you simply want a window you can
REM watch the server in.
REM
REM It does NOT touch COLLECTION. "Screen Time Sampler" records the foreground
REM window and "Screen Time Ingest" folds its output into SQLite; both are
REM separate tasks and neither needs the dashboard to be up. That is the right
REM way round -- collection is the half that cannot be caught up later.
REM
REM Double-click this file. It will, in order:
REM   1. install dependencies if node_modules is missing
REM   2. build the production bundle ONLY if there isn't one - after a code
REM      change you rebuild yourself with `npm run build`; this warns if you
REM      forgot rather than rebuilding behind your back
REM   3. start the server on http://localhost:7844
REM   4. open your browser once the server is actually responding
REM
REM Keep this window open - closing it stops the dashboard.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

set "PORT=7844"
set "URL=http://localhost:%PORT%"

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm was not found on your PATH.
    echo Install Node.js 22.5+ from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

REM --- Is something already serving the port? --------------------------------
REM This check earns its place twice over. Beyond the obvious "the logon task
REM already started it", `npm run dev` also binds 7844 - and a `next build`
REM underneath a live dev server replaces chunks it holds open, killing it with
REM "Cannot find module './331.js'" on the next request. Exiting here means this
REM window can never do that to a dev server. See CLAUDE.md.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>&1
if not errorlevel 1 (
    echo The dashboard is already running on port %PORT%.
    echo.
    echo NOTE: this window did not start it - something else is already serving
    echo that port. Most likely the "Start Screen Time Dashboard" logon task, or
    echo an "npm run dev" you left running. Nothing to do; opening the browser.
    start "" "%URL%"
    echo.
    pause
    exit /b 0
)

REM --- Dependencies ----------------------------------------------------------
if not exist "node_modules" (
    echo Installing dependencies. This happens once and takes a minute...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install failed. See the messages above.
        pause
        exit /b 1
    )
)

REM --- Production build ------------------------------------------------------
REM Build only when there ISN'T one. Building on every launch would cost ~30s
REM each time and would turn a broken build into a start-up failure. Building is
REM a thing you do after changing code (`npm run build`), where the output is in
REM front of you and a failure is obvious.
REM
REM A MISSING build is the one case that still has to build here: `npm start`
REM against no `.next` exits immediately, so there would be nothing to open.
REM
REM Set FORCE_BUILD=1 before running this to rebuild anyway.
set "DO_BUILD="
if not exist ".next\BUILD_ID" set "DO_BUILD=1"
if not "%FORCE_BUILD%"=="" set "DO_BUILD=1"

REM Stale builds are REPORTED, not fixed. Serving the previous build silently is
REM what this warning exists to prevent - on a dashboard whose whole job is
REM reporting current numbers, serving three-week-old query code is a convincing
REM kind of wrong: everything renders, nothing errors, and the figures come from
REM queries you have since fixed.
REM
REM The comparison is src\ and config\ against .next\BUILD_ID - deliberately the
REM SAME rule dashboard-service.ps1 uses, so the logon task and this window never
REM disagree about what "stale" means. PowerShell signals through its exit code
REM rather than stdout, so nothing here has to survive `for /f` quoting - and the
REM whole check sits inside the block so a leftover errorlevel from npm install
REM can never be read as "stale".
set "STALE="
if not defined DO_BUILD (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$b = (Get-Item '.next\BUILD_ID' -ErrorAction SilentlyContinue).LastWriteTime; if (-not $b) { exit 0 }; $s = @(); foreach ($d in 'src', 'config') { if (Test-Path $d) { $s += Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue } }; $n = ($s | Measure-Object -Property LastWriteTime -Maximum).Maximum; if ($n -and $n -gt $b) { exit 1 }; exit 0"
    if errorlevel 1 set "STALE=1"
)

if defined STALE (
    echo.
    echo WARNING: your source files are newer than the production build.
    echo          This window will serve the OLD build. Run "npm run build"
    echo          - or set FORCE_BUILD=1 - to pick up your changes.
    echo.
)

if not exist ".next\BUILD_ID" echo No production build found - this is the one case that builds here.
if defined DO_BUILD (
    echo Building the dashboard. This takes about 30 seconds...
    call npm run build
    if errorlevel 1 (
        echo.
        echo ERROR: build failed. See the messages above.
        pause
        exit /b 1
    )
)

REM --- Open the browser once the server responds -----------------------------
REM Launched first, in the background, so it can poll while the server boots.
REM Opening the URL immediately would just show a connection error.
REM
REM A 200 is not required: the dashboard is behind a password gate, so a cold
REM browser gets the login form rendered at the address it asked for. Any HTTP
REM answer at all means the server is up, and Invoke-WebRequest throws on a 401
REM as readily as on a refused connection - so the catch has to tell "not
REM listening yet" from "listening and saying no".
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "for ($i = 0; $i -lt 90; $i++) { try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break } catch { if ($_.Exception.Response) { Start-Process '%URL%'; break }; Start-Sleep -Seconds 1 } }"

echo.
echo Starting the dashboard on %URL%
echo Your browser will open automatically once it is ready.
echo.
echo Close this window to stop the dashboard.
echo.

call npm start
