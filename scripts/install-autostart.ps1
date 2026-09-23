<#
    Register the dashboard as a per-logon task, so it is up without anyone
    starting it.

        .\install-autostart.ps1            register (or re-register)
        .\install-autostart.ps1 -RunNow    register, then start it
        .\install-autostart.ps1 -Remove    unregister and stop

    NO ELEVATION. The dashboard reads a database and serves pages; nothing it
    does needs Administrator, and the sibling project is explicit that making
    the web server elevated would be a mistake. The Windows collector here does
    not need elevation either, so this whole project runs unprivileged.

    THIS IS A DIFFERENT TASK FROM THE COLLECTORS. "Screen Time Sampler" records
    the foreground window and "Screen Time Ingest" folds its output into
    SQLite; this one only serves pages. It is named "Start Screen Time
    Dashboard" -- a verb, because unlike the other two it is the one whose own
    job is over as soon as the thing it starts is up. Removing it stops the dashboard and
    changes nothing about collection -- which is the right way round, because
    collection is the half that cannot be caught up later.

    Keep this file pure ASCII. See CLAUDE.md.
#>

[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$RunNow,
    [int]$Port = 7844
)

$ErrorActionPreference = 'Stop'

$TASK = 'Start Screen Time Dashboard'

# What this task used to be called. Task Scheduler has no rename, so a rename
# is an unregister plus a register -- and leaving the old entry behind would be
# WORSE than not renaming at all: both would fire at the next logon, and the
# second server to start would find port 7844 already taken and die, having
# logged that to a file nobody reads. So the old name is cleared on every path
# through this script.
$OLD_TASKS = @('Screen Time Dashboard')
$repo = Split-Path $PSScriptRoot -Parent
$vbs  = Join-Path $PSScriptRoot 'dashboard-hidden.vbs'

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "         $m" -ForegroundColor DarkGray }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

if ($Remove) {
    $gone = $false
    foreach ($t in @($TASK) + $OLD_TASKS) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
            Write-Ok "removed '$t'"
            $gone = $true
        }
    }
    if (-not $gone) { Write-Info "'$TASK' was not registered" }
    & (Join-Path $PSScriptRoot 'dashboard-stop.ps1') -Port $Port
    Write-Info "collection is unaffected: the sampler and ingest tasks are separate"
    exit 0
}

if (-not (Test-Path $vbs)) { Write-Bad "dashboard-hidden.vbs not found at $vbs"; exit 1 }

# Clear the old name BEFORE registering the new one, so there is never a moment
# where both exist and a logon could start two servers.
foreach ($t in $OLD_TASKS) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
        Write-Ok "removed the old task name '$t'"
        # A RUNNING server is deliberately left alone: unregistering a task does
        # not stop the process it started, and stopping it here would take the
        # dashboard down mid-rename for no reason. It keeps serving, and the
        # renamed task owns the next logon.
    }
}

$action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument ('"{0}"' -f $vbs) `
    -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# ExecutionTimeLimit 0 means NO LIMIT. Without it Task Scheduler kills the
# server after its default three days, and the symptom is a dashboard that was
# working on Monday and is simply gone on Thursday, with no error anywhere.
#
# RestartCount brings it back if node dies. StartWhenAvailable is deliberately
# NOT set: this is an at-logon task and a missed logon is not worth catching up.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TASK `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Serves the Screen Time dashboard on http://localhost:$Port at logon. Unelevated. Rebuilds first if src/ or config/ changed." `
    -Force | Out-Null

Write-Ok "registered '$TASK' (at logon, no time limit)"
Write-Info "serves http://localhost:$Port"

if ($RunNow) {
    Start-ScheduledTask -TaskName $TASK
    Write-Info "starting; the first run builds, which takes ~30s"

    $deadline = (Get-Date).AddSeconds(150)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            $up = $true
            break
        }
    }

    Write-Host ""
    if ($up) {
        Write-Ok "dashboard is listening on port $Port"
        # Check the PROCESS, not the task state: the VBS launcher does not wait
        # for its child, so the TASK reports 'Ready' while the server runs. An
        # earlier script in this project announced 'Running' as the healthy
        # state and would have sent a reader hunting a fault that is not there.
        Write-Info "the TASK will show 'Ready' -- expected, the launcher does not wait"
    } else {
        Write-Bad "nothing is listening on port $Port after 150s"
        Write-Info "check logs\dashboard.log -- a failed build exits without serving"
    }
}

Write-Host ""
# SINGLE quotes on purpose. In a double-quoted PowerShell string a backtick is
# the escape character, so "`npm" renders as a NEWLINE followed by "pm" -- the
# markdown habit of quoting a command in backticks silently mangles the output.
# Same family as the em-dash trap in CLAUDE.md: punctuation that is inert in
# every other language and load-bearing here.
Write-Info 'Before `npm run dev` or `next build` by hand: scripts\dashboard-stop.ps1'
Write-Info 'They share .next, and a build under a live server breaks both.' 
