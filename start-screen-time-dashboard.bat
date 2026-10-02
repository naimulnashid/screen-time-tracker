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
REM window can never do that to a dev server.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>&1
if not errorlevel 1 (
    echo The dashboard is already running on port %PORT%.
    echo.
    echo NOTE: this window did not start it - something else is already serving
    echo that port. Most likely the "Start Screen Time Dashboard" logon task, or
    echo an "npm run dev" you left running. Nothing to do; opening the browser.
    echo Run stop-dashboard.bat first if you want this window to serve it instead.
    start "" "%URL%"
    echo.
    pause
    exit /b 0
)

REM --- Dependencies and a production build -----------------------------------
REM scripts\ensure-build.ps1 decides, and it is the SAME script the logon task
REM runs, so the two launchers never disagree about what "a build" or "stale"
REM means. Called plainly, as here, it:
REM   - installs dependencies if node_modules is missing
REM   - builds when there is no complete build (BUILD_ID and .next\server) -
REM     `npm start` against no `.next` exits immediately, so there would be
REM     nothing to open
REM   - only WARNS when the source is newer than the build. Building on
REM     every launch would cost ~30s each time and turn a broken build into a
REM     start-up failure; a build is a thing you run after changing code, where
REM     its output is in front of you. Serving the old build SILENTLY is what
REM     the warning prevents: on a dashboard whose whole job is reporting
REM     current numbers, three-week-old query code is a convincing kind of
REM     wrong. (The logon task rebuilds instead: it has no window to warn in.)
REM
REM Set FORCE_BUILD=1 before running this to rebuild anyway.
set "FORCE="
if not "%FORCE_BUILD%"=="" set "FORCE=-Force"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ensure-build.ps1" %FORCE%
if errorlevel 1 (
    echo.
    echo ERROR: there is no build to serve. See the messages above.
    pause
    exit /b 1
)

REM --- Open the browser once the server is listening -------------------------
REM A listening port is the signal, not an HTTP answer. `next start` opens the
REM port a moment before it has finished starting, but holds any request that
REM arrives in that moment until it is ready, rather than refusing it - so once
REM the port listens, the browser's request will be answered. Nothing else can
REM be the listener: the check above exits if anything held the port already.
REM
REM This is what the Data Usage dashboard's launcher does, and it sidesteps
REM everything an HTTP probe has to get right: localhost resolving to ::1 first
REM (a ~2 s fallback against a server on 127.0.0.1 alone), a login redirect
REM that names localhost, and a password gate answering 401.
REM
REM /b keeps the waiter in this console, so closing the window takes it along,
REM and its "did not start" message lands here rather than in a window of its
REM own.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(180); while ((Get-Date) -lt $deadline) { if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { Start-Process '%URL%'; exit 0 }; Start-Sleep -Milliseconds 400 }; Write-Host 'The server did not start within 3 minutes - see the output above.'; exit 1"

echo.
echo Starting the dashboard on %URL%
echo Your browser will open automatically once it is ready.
echo.
echo Close this window to stop the dashboard.
echo.

call npm start
