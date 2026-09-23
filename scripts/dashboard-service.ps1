<#
    Serve the dashboard. Started by dashboard-hidden.vbs at logon.

    Not meant to be run by hand -- use install-autostart.ps1. It is a separate
    file rather than inline in the VBS because the interesting part is the
    staleness check, and that deserves to be readable.

    ------------------------------------------------------------------------
    WHY IT REBUILDS

    A logon task that only ran `npm start` would build once and then serve that
    build forever. On a dashboard whose entire job is reporting current
    numbers, silently serving code from three weeks ago is a convincing kind of
    wrong -- everything renders, nothing errors, and the figures are computed
    by queries you have since fixed.

    So it compares the newest file under src/ and config/ against
    .next/BUILD_ID and rebuilds when anything is newer. A no-op check costs
    milliseconds; the build costs ~30s and only happens after you change
    something.

    ------------------------------------------------------------------------
    NEVER RUN `next build` WHILE A DEV SERVER IS UP ON THE SAME PROJECT

    They share .next, and the build replaces chunks the dev server holds open.
    The symptom is the dev server dying with

        Error: Cannot find module './331.js'

    on the next request, which reads as a code bug rather than as two processes
    fighting over a directory. Learned the expensive way on 2026-08-31. This
    script only runs at logon, when no dev server exists, but if you are
    debugging it by hand: stop `npm run dev` first.

    Keep this file pure ASCII. See CLAUDE.md.
#>

[CmdletBinding()]
param(
    [int]$Port = 7844,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'dashboard.log'

<#
    Everything written here is UTF-8 without a BOM, explicitly.

    PowerShell 5.1's `>>` redirection writes UTF-16LE, and Add-Content defaults
    to the ANSI codepage, so a script that mixes them produces one file in two
    encodings that no ordinary tool reads. The first version did exactly that
    and `tail` rendered the build output as " R e a d y   i n " -- a log you
    cannot grep is half a log.
#>
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log {
    param($Message)
    $line = "{0}  {1}`r`n" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    [System.IO.File]::AppendAllText($log, $line, $Utf8NoBom)
}

function Write-LogLines {
    param([string[]]$Lines)
    if (-not $Lines) { return }
    [System.IO.File]::AppendAllText($log, (($Lines -join "`r`n") + "`r`n"), $Utf8NoBom)
}

<#
    Is whatever holds the port THIS dashboard? The same rule as
    dashboard-stop.ps1; change the two together.

    A port is not an identity. On Windows a server bound to 127.0.0.1 can share
    one with another program's wildcard (0.0.0.0 or ::) listener, and the other
    local dashboards are node too. A listener is this dashboard only when its
    command line runs Next.js out of this repo's own node_modules - anchored
    there, since the bare repo path would also match a sibling folder whose
    name merely starts with this one's.
#>
$modules = (Join-Path $repo 'node_modules') + '\'

function ConvertTo-ComparablePath([string]$Text) {
    return (($Text -replace '/', '\') -replace '\\{2,}', '\')
}

function Test-ThisDashboard([string]$CommandLine) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $needle = ConvertTo-ComparablePath $modules
    return (ConvertTo-ComparablePath $CommandLine).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-PortHolder {
    $found = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($procId in ($found.OwningProcess | Select-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        [pscustomobject]@{ Id = [int]$procId; Name = $proc.Name; Ours = Test-ThisDashboard $proc.CommandLine }
    }
}

Write-Log "--- starting, port $Port ---"

# --- Is anything already serving this port? ---------------------------
# Registering the task and then logging in twice would otherwise leave two
# servers racing for the port, and the loser's error goes nowhere.
#
# Only THIS dashboard counts as "already served". Any other owner used to be
# logged as serving 7844 with exit 0, which left the dashboard down until the
# next logon behind a log that read as fine. That is an error, and it is not
# a reason to start alongside either: a different bind address would let both
# listen. (This repo's own `npm run dev` DOES count as ours - it runs the same
# node_modules - so the guard against building under a dev server still holds.)
$held = @(Get-PortHolder)
if ($held.Count -gt 0) {
    $ours = @($held | Where-Object { $_.Ours })
    if ($ours.Count -gt 0) {
        Write-Log "port $Port already served by this dashboard (PID $(($ours.Id) -join ', ')); exiting"
        exit 0
    }
    $others = ($held | ForEach-Object { "$($_.Name) PID $($_.Id)" }) -join '; '
    Write-Log "port $Port is held by another program ($others), not this dashboard -- NOT starting"
    exit 1
}

# --- Rebuild if the source is newer than the build --------------------
$buildId = Join-Path $repo '.next\BUILD_ID'
$needsBuild = $true

if ($SkipBuild) {
    $needsBuild = $false
    Write-Log "build skipped by request"
} elseif (Test-Path $buildId) {
    $builtAt = (Get-Item $buildId).LastWriteTime
    $newest = Get-ChildItem -Path (Join-Path $repo 'src'), (Join-Path $repo 'config') -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest -and $newest.LastWriteTime -gt $builtAt) {
        Write-Log "rebuild needed: $($newest.Name) is newer than the build"
    } else {
        $needsBuild = $false
        Write-Log "build is current ($builtAt)"
    }
} else {
    Write-Log "no build found"
}

if ($needsBuild) {
    Write-Log "building..."
    # Captured and written through Write-LogLines rather than redirected with
    # *>> so the encoding stays consistent (see the note above).
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $buildOut = & npm run build 2>&1 | ForEach-Object { $_.ToString() }
    $buildCode = $LASTEXITCODE
    $ErrorActionPreference = $prev
    Write-LogLines $buildOut
    if ($buildCode -ne 0) {
        Write-Log "BUILD FAILED (exit $buildCode) -- not starting"
        exit 1
    }
    Write-Log "build ok"
}

# --- Serve -------------------------------------------------------------
# `next start` binds every interface, which is deliberate: the phone posts to
# this machine's LAN address. The password gate in middleware.ts is what makes
# that acceptable, and it fails closed.
Write-Log "serving on port $Port"
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& npm run start 2>&1 | ForEach-Object { Write-LogLines @($_.ToString()) }
$serveCode = $LASTEXITCODE
$ErrorActionPreference = $prev
Write-Log "server exited (code $serveCode)"
