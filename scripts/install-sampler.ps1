<#
    Register the sampler as a per-logon task.

    NO ELEVATION REQUIRED, and that is the headline difference from the sibling
    project. Its collector must run elevated because snapshotting SRUM needs
    VSS; this one reads the foreground window, which any ordinary user process
    can do. So this registers an unelevated task in the user's own namespace.

    Also registers an hourly INGEST task, which folds the sampler's JSONL into
    SQLite. Two tasks rather than one because they have genuinely different
    lifetimes: the sampler runs for the whole logon session, the ingest runs
    for a few seconds an hour.

    BOTH run with no console window, through the .vbs launchers beside this
    file. The ingest's waits for its child and returns its exit code; the
    sampler's does not, and must not. See ingest-hidden.vbs.

      .\install-sampler.ps1            register (or re-register) both
      .\install-sampler.ps1 -Remove    unregister both
      .\install-sampler.ps1 -RunNow    register, then start the sampler

    Keep this file pure ASCII. See CLAUDE.md.
#>

[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'

$SAMPLER_TASK = 'Screen Time Sampler'
$INGEST_TASK  = 'Screen Time Ingest'

$repo = Split-Path $PSScriptRoot -Parent
$vbs  = Join-Path $PSScriptRoot 'sampler-hidden.vbs'
$ingestVbs = Join-Path $PSScriptRoot 'ingest-hidden.vbs'

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "  $m" -ForegroundColor DarkGray }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

if ($Remove) {
    foreach ($t in @($SAMPLER_TASK, $INGEST_TASK)) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
            Write-Ok "removed '$t'"
        } else {
            Write-Info "'$t' was not registered"
        }
    }
    # Leave any running sampler alone; it exits at logoff. Killing it here
    # would discard the in-flight span, and the finally block that flushes it
    # only runs on a clean exit.
    Write-Info "a running sampler is left alone; it flushes and exits at logoff"
    exit 0
}

if (-not (Test-Path $vbs)) { Write-Bad "sampler-hidden.vbs not found at $vbs"; exit 1 }
if (-not (Test-Path $ingestVbs)) { Write-Bad "ingest-hidden.vbs not found at $ingestVbs"; exit 1 }

# --- 1. The sampler: at logon, runs all session ---------------------------
$samplerAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument ('"{0}"' -f $vbs) `
    -WorkingDirectory $repo

$samplerTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# ExecutionTimeLimit 0 means NO LIMIT. Without it Task Scheduler kills the
# sampler after its default 3 days, and the symptom is screen time that simply
# stops being recorded on a machine left running -- with no error anywhere.
#
# RestartCount/RestartInterval bring it back if it dies. StartWhenAvailable is
# deliberately NOT set: this is an at-logon task, and a missed logon is not
# something to catch up on later.
$samplerSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $SAMPLER_TASK `
    -Action $samplerAction `
    -Trigger $samplerTrigger `
    -Settings $samplerSettings `
    -Description 'Records which application is in the foreground, for the Screen Time dashboard. Runs unelevated; captures no window titles.' `
    -Force | Out-Null
Write-Ok "registered '$SAMPLER_TASK' (at logon, no time limit)"

# --- 2. The ingest: hourly, and HIDDEN ------------------------------------
# Through wscript, exactly like the other two tasks, and for the same reason:
# Task Scheduler's "Hidden" checkbox does not suppress a console window. It
# mattered more here than anywhere else -- this task fires EVERY HOUR, so the
# flash was not a one-off at logon, it was a black window taking focus hourly
# all day.
#
# The launcher WAITS and passes the exit code back, unlike the sampler's and
# the dashboard's. Those two run for the whole session; this is a job that
# finishes, and ingest-windows.ts sets an exit code specifically so it lands in
# LastTaskResult. Launching it detached would report success in milliseconds
# whatever the ingest did. See the header of ingest-hidden.vbs.
$ingestAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument ('"{0}"' -f $ingestVbs) `
    -WorkingDirectory $repo

# HOURLY, and the reason is worth stating because "daily is plenty" was the
# original call and it was wrong for the right reason.
#
# It is right about DATA LOSS: nothing evicts the JSONL, unlike SRUM's 7 days
# or the phone's 240 hours. Spans sit on D: until ingested, so a missed run
# costs nothing permanent. That part still holds.
#
# It is wrong about FRESHNESS. The sampler writes continuously and the
# dashboard reads only the database, so the page is stale by however long it
# has been since the last ingest. At daily that was up to 24 hours, and it
# showed: on 2026-09-01 the laptop's Overview reported ONE DAY of data and
# under an hour of use while 722 unread spans sat on disk. The dashboard's
# whole job is reporting current numbers, and it was quietly a day behind.
#
# -Once at midnight with an hourly repetition, rather than 24 separate daily
# triggers. -StartWhenAvailable then catches the run up after sleep, which
# matters on a laptop that is shut more than it is open.
$ingestTrigger = New-ScheduledTaskTrigger `
    -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours 1)

$ingestSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
    -TaskName $INGEST_TASK `
    -Action $ingestAction `
    -Trigger $ingestTrigger `
    -Settings $ingestSettings `
    -Description 'Folds the Screen Time sampler JSONL into SQLite and writes the backup copy.' `
    -Force | Out-Null
Write-Ok "registered '$INGEST_TASK' (hourly, hidden, catches up if missed)"

# --- 3. Report -----------------------------------------------------------
Write-Host ""
foreach ($t in @($SAMPLER_TASK, $INGEST_TASK)) {
    $info = Get-ScheduledTaskInfo -TaskName $t
    Write-Info ("{0,-22} next run: {1}" -f $t, $(if ($info.NextRunTime) { $info.NextRunTime } else { 'at next logon' }))
}

if ($RunNow) {
    Start-ScheduledTask -TaskName $SAMPLER_TASK
    Start-Sleep -Seconds 4

    # Check the PROCESS, not the task state.
    #
    # The task will report 'Ready', not 'Running', and that is correct: the VBS
    # launcher starts the sampler WITHOUT waiting (see sampler-hidden.vbs), so
    # the task itself finishes in milliseconds while the sampler carries on
    # detached. An earlier version of this script announced that 'Running' was
    # the steady state, which would have sent a future reader hunting for a
    # fault that does not exist.
    $proc = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -like '*sampler.ps1*' }

    Write-Host ""
    if ($proc) {
        Write-Ok ("sampler is running (PID {0})" -f ($proc | Select-Object -First 1).ProcessId)
        Write-Info "The TASK shows 'Ready' -- that is expected, the launcher does not wait."
    } else {
        Write-Bad "no sampler process found. Check: Get-ScheduledTaskInfo -TaskName '$SAMPLER_TASK'"
    }
}

Write-Host ""
Write-Info "The sampler records WHICH app and FOR HOW LONG. Never window titles."
Write-Info "Check it is alive:  Get-Content '<samplerLogDir>\sampler-status.json'"
Write-Info "Neither task opens a window. The ingest's output goes to logs\ingest.log,"
Write-Info "and its exit code to LastTaskResult."
