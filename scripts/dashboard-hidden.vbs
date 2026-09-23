' Launch the dashboard with NO console window.
'
' Not decoration. Task Scheduler's own "Hidden" checkbox does not suppress a
' console window, and `powershell -WindowStyle Hidden` still blinks one up at
' every logon -- in front of whatever you are doing, every single time.
' WScript.Shell.Run with window style 0 genuinely creates none, and the
' node.exe it launches inherits that hidden console rather than opening its own.
'
' Does NOT wait: the server runs for the whole logon session, so waiting would
' pin the task as "running" forever. Same shape as sampler-hidden.vbs.

Dim shell, here, cmd
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "dashboard-service.ps1"""

' 0 = hidden window, False = do not wait.
shell.Run cmd, 0, False
