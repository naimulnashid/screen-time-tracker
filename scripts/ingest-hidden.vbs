' Run the hourly ingest with NO console window.
'
' Not decoration. Task Scheduler's own "Hidden" checkbox does not suppress a
' console window, and this task fires EVERY HOUR -- so the flash was not a
' one-off at logon like the other two, it was a black window stealing focus
' hourly, all day, in front of whatever you were doing.
'
' ---------------------------------------------------------------------------
' THIS ONE WAITS. The other two launchers do not, and the difference is
' load-bearing.
'
' The sampler and the dashboard run for the whole logon session, so waiting
' would pin their tasks as "running" forever. The ingest is a JOB THAT
' FINISHES, and ingest-windows.ts exists to "set an exit code that Task
' Scheduler will record in LastTaskResult" -- its own words. Launch it without
' waiting and the task completes in milliseconds reporting success, whatever
' the ingest actually did. An hourly job that fails silently while reporting
' 0 is worse than one that flashes a window.
'
' So: window style 0 (hidden), wait True, and pass the child's exit code back
' out through WScript.Quit.
' ---------------------------------------------------------------------------
'
' The output goes to logs\ingest.log, because after this change there is no
' window for it to go to at all. cmd.exe's own redirection is byte-level and
' writes the child's UTF-8 through unchanged -- this is NOT the PowerShell
' ">> writes UTF-16LE" trap in CLAUDE.md, which applies to PowerShell's
' redirection operator and not to cmd's.

Option Explicit

Dim shell, here, repo, cmd, code
Set shell = CreateObject("WScript.Shell")

' ...\Screen Time Tracker\scripts\  ->  ...\Screen Time Tracker
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
repo = Left(here, InStrRev(here, "\") - 1)

' npm is a .cmd shim, so it has to go through cmd. The repo path contains
' spaces, hence the quoting; `cd /d` because the repo is not on C:.
cmd = "cmd.exe /c cd /d """ & repo & """ && npm run ingest >> """ & repo & "\logs\ingest.log"" 2>&1"

' 0 = hidden window. True = WAIT, so the exit code below is the real one.
code = shell.Run(cmd, 0, True)
WScript.Quit code
