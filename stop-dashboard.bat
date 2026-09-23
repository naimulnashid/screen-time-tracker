@echo off
REM ---------------------------------------------------------------------------
REM Stops the Screen Time Dashboard. Double-click this.
REM
REM When the dashboard runs from its logon task it runs HIDDEN - there is no
REM console window to Ctrl+C - so this is the off switch. It also works on a
REM server started by start-screen-time-dashboard.bat or `npm run dev`: it
REM stops THIS project's server on port 7844, however it was started, and
REM leaves any other program on that port alone. See CLAUDE.md.
REM
REM Run it before `npm run dev` or `npm run build`: they share .next with the
REM running server, and a build under a live server replaces chunks it holds
REM open. See CLAUDE.md.
REM
REM It stops the SERVER only. Collection carries on - "Screen Time Sampler" and
REM "Screen Time Ingest" are separate tasks, and nothing about them waits on the
REM dashboard being up. It also leaves the logon task REGISTERED, so the
REM dashboard comes back at your next logon; to unregister it as well, run
REM `npm run autostart -- -Remove`.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\dashboard-stop.ps1"
echo.
pause
