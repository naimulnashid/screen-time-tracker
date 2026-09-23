' Launch the sampler with NO console window.
'
' Not decoration. Task Scheduler's own "Hidden" checkbox does not suppress a
' console window, and `powershell -WindowStyle Hidden` still blinks one up --
' at every logon, in front of whatever you are doing. WScript.Shell.Run with
' window style 0 genuinely creates none.
'
' Same trick as the sibling project's dashboard-hidden.vbs. Unlike that one
' this does NOT wait for the child: the sampler runs for the whole logon
' session, so waiting would pin the task as "running" forever -- which is
' correct here, and is exactly why the task is registered without a time limit.

Dim shell, here, cmd
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "sampler.ps1"""

' 0 = hidden window, False = do not wait.
shell.Run cmd, 0, False
