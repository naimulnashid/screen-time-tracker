' Launch the sampler with NO console window.
'
' Not decoration. Task Scheduler's own "Hidden" checkbox does not suppress a
' console window, and `powershell -WindowStyle Hidden` still blinks one up --
' at every logon, in front of whatever you are doing. WScript.Shell.Run with
' window style 0 genuinely creates none.
'
' Same trick as the sibling project's dashboard-hidden.vbs.
'
' It WAITS for the sampler, and restarts it after a crash. The task's own
' RestartCount cannot: when this wrapper exited at once, Task Scheduler saw
' the task finish within a second, so a sampler that died an hour later
' simply stayed dead until the next logon - and recording is the half that
' cannot be caught up later.
'
' A clean exit is code 0 - the stop file, -RunSeconds, or "another sampler
' is already recording" - and ends this wrapper too. Anything else is a
' crash: wait a minute and run it again, at most 3 times in a row without a
' 10-minute stretch of recording between them, so a sampler that cannot
' start at all is not restarted forever. A logoff kills this wrapper along
' with the sampler, so nothing restarts then. Each restart is logged to
' logs\sampler-restarts.log. Waiting keeps the task "Running" for the
' session, which is why it is registered without a time limit.

Dim shell, fso, here, cmd, code, started, quick, maxRestarts
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "sampler.ps1"""

Sub LogLine(text)
    Dim logDir, f, t
    logDir = fso.BuildPath(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)), "logs")
    If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
    t = Now
    Set f = fso.OpenTextFile(fso.BuildPath(logDir, "sampler-restarts.log"), 8, True)
    f.WriteLine Year(t) & "-" & Right("0" & Month(t), 2) & "-" & Right("0" & Day(t), 2) & " " & _
        Right("0" & Hour(t), 2) & ":" & Right("0" & Minute(t), 2) & ":" & Right("0" & Second(t), 2) & "  " & text
    f.Close
End Sub

maxRestarts = 3
quick = 0
Do
    started = Now
    ' 0 = hidden window, True = wait, and hand back the exit code.
    code = shell.Run(cmd, 0, True)
    If code = 0 Then Exit Do
    If DateDiff("n", started, Now) >= 10 Then quick = 0
    quick = quick + 1
    If quick > maxRestarts Then
        LogLine "sampler exited with code " & code & ", " & quick & " times in a row -- not restarting until the next logon"
        Exit Do
    End If
    LogLine "sampler exited with code " & code & " -- restarting in 60 s (restart " & quick & " of " & maxRestarts & ")"
    WScript.Sleep 60000
Loop
WScript.Quit code
