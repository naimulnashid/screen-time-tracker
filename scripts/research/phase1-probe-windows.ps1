<#
    Screen Time -- source probe. READ ONLY. Writes nothing outside -WorkDir.

    Answers ONE question that decides the whole architecture:

      Does SRUM's AppTimelineProvider table carry usable per-app foreground
      time on THIS machine?

    Windows 11 removed the Timeline feature, so the table may exist and be
    empty. If it is populated, the Screen Time collector is a near-clone of
    the Data Usage collector (same VSS snapshot, same recovery, same parse).
    If it is empty, Windows screen time needs a foreground-window sampler
    written from scratch, which shares no collector code at all.

    MUST RUN ELEVATED -- esentutl /vss is the only reason.
#>

[CmdletBinding()]
param(
    [string]$WorkDir       = "$env:TEMP\screentime-probe",
    [string]$SrumECmdDir   = "C:\Tools\ZimmermanTools",
    # Left EMPTY on purpose and resolved below. $PSScriptRoot is NOT populated
    # while param() defaults are being evaluated, so a default of
    # "$PSScriptRoot\srum-recover.ps1" expands to "\srum-recover.ps1" -- which
    # then fails with "not at \srum-recover.ps1" and looks like a missing file
    # rather than an empty variable.
    [string]$RecoverScript = '',
    [switch]$KeepWorkDir
)

$ErrorActionPreference = 'Stop'

# Safe here: the script body is where $PSScriptRoot actually exists.
if (-not $RecoverScript) {
    $RecoverScript = Join-Path $PSScriptRoot 'srum-recover.ps1'
}
function Write-Step { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

Write-Step "Preflight"
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Bad "Not elevated. Re-run this from an ADMINISTRATOR PowerShell."
    exit 1
}
Write-Ok "Elevated."

$srumECmd = Join-Path $SrumECmdDir 'SrumECmd.exe'
if (-not (Test-Path $srumECmd)) { Write-Bad "SrumECmd.exe not at $srumECmd"; exit 1 }
if (-not (Test-Path $RecoverScript)) { Write-Bad "srum-recover.ps1 not at $RecoverScript"; exit 1 }
. $RecoverScript
Write-Ok "SrumECmd + recovery helper found."

if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

# --- 1. Snapshot. Name MUST be SRUDB.dat or log replay finds nothing. --------
Write-Step "VSS snapshot"
$srcDb  = "$env:SystemRoot\System32\sru\SRUDB.dat"
$snap   = Join-Path $WorkDir 'SRUDB.dat'
& esentutl.exe /y $srcDb /vss /d $snap 2>&1 | Out-Null
if (-not (Test-Path $snap)) { Write-Bad "Snapshot failed."; exit 1 }
Write-Ok ("Snapshot: {0} MB" -f [math]::Round((Get-Item $snap).Length/1MB,1))

# --- 2. Soft recovery. Without it SrumECmd writes NO csv and still exits 0. --
Write-Step "Soft recovery"
$rec = Invoke-SrumSoftRecovery -WorkDir $WorkDir -SrumDir (Split-Path $srcDb -Parent)
if ($rec.Ok) { Write-Ok "Recovered ($($rec.LogsCopied) journals replayed)." }
else { Write-Warn "Recovery exit $($rec.ExitCode) -- continuing; parse is the real test." }

# --- 3. Parse -------------------------------------------------------------
Write-Step "Parse"
$csvDir = Join-Path $WorkDir 'csv'
New-Item -ItemType Directory -Path $csvDir -Force | Out-Null
$env:DOTNET_ROLL_FORWARD = 'Major'
& $srumECmd -f $snap --csv $csvDir 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

$csvs = @(Get-ChildItem $csvDir -Filter '*.csv' -ErrorAction SilentlyContinue)
if (-not $csvs.Count) { Write-Bad "SrumECmd produced no CSVs at all."; exit 1 }

Write-Step "Tables produced"
foreach ($c in $csvs | Sort-Object Name) {
    $n = 0
    try { $n = @(Import-Csv $c.FullName).Count } catch { $n = -1 }
    "{0,-46} {1,9} rows  {2,8} KB" -f ($c.Name -replace '^\d+_SrumECmd_',''), $n, [math]::Round($c.Length/1KB)
}

# --- 4. Report the real schema, then hand off ------------------------------
#
# MEASURED 2026-08-31: the table IS populated (46,243 rows), but SrumECmd
# 2026.5.0 surfaces only 12 columns and there is NO InFocusDuration. The single
# duration is `DurationMs`, sitting right beside `EndTime` -- which is exactly
# what a SPAN looks like, not a focus measurement.
#
# Settling that is arithmetic over 46k rows, not a preflight check, so this
# script stops at "here is the schema, here are the CSVs". The analysis lives
# in scripts/phase1-analyze-atp.ts, which needs no elevation and can be re-run
# as often as you like without another 99 MB snapshot.

function Show-Schema {
    param($File, $Label)
    $rows = @(Import-Csv $File)
    Write-Step $Label
    Write-Host "  rows: $($rows.Count)"
    if (-not $rows.Count) { Write-Bad "EMPTY."; return }
    $cols = $rows[0].PSObject.Properties.Name
    Write-Host "  columns ($($cols.Count)): $($cols -join ', ')"
    $ts = @($rows | ForEach-Object { $_.Timestamp } | Where-Object { $_ } | Sort-Object)
    if ($ts.Count) {
        $span = 0
        try { $span = ((Get-Date $ts[-1]) - (Get-Date $ts[0])).TotalDays } catch {}
        Write-Ok ("range: {0}  ->  {1}   ({2:N1} days retained)" -f $ts[0], $ts[-1], $span)
    }
}

$atp = $csvs | Where-Object { $_.Name -match 'AppTimelineProvider' } | Select-Object -First 1
if (-not $atp) {
    Write-Bad "No AppTimelineProvider CSV. Windows screen time needs a sampler instead."
} else {
    Show-Schema $atp.FullName "AppTimelineProvider -- the deciding table"
}

# ForegroundCycleTime / BackgroundCycleTime live in this one. CPU cycles are
# not wall time, so it can never BE screen time -- but if DurationMs turns out
# to be a span, this is the only other per-app signal SRUM offers, and its
# shape is worth knowing before anyone designs a sampler.
$aru = $csvs | Where-Object { $_.Name -match 'AppResourceUseInfo' } | Select-Object -First 1
if ($aru) { Show-Schema $aru.FullName "AppResourceUseInfo -- the fallback signal" }

# --- 5. Drop the 99 MB, keep the analysable part ---------------------------
#
# The snapshot and its journals are the bulk and are reproducible in seconds;
# the CSVs are small and are what the next step reads. Deleting the whole
# WorkDir -- the original behaviour -- meant every tweak to the analysis cost
# another elevated VSS run, which is a bad trade when the analysis is the part
# that will need several passes.
if (-not $KeepWorkDir) {
    Remove-Item (Join-Path $WorkDir 'SRUDB.dat') -Force -ErrorAction SilentlyContinue
    foreach ($pat in @('SRU*.log', '*.jfm', '*.chk')) {
        Get-ChildItem $WorkDir -Filter $pat -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
    Write-Host "`n  snapshot deleted; CSVs kept." -ForegroundColor DarkGray
}

Write-Step "Next"
Write-Host "  CSVs: $csvDir"
Write-Host ""
Write-Host "  Now run this, UNELEVATED, from the repo root:" -ForegroundColor Yellow
Write-Host "    npm run atp" -ForegroundColor Yellow
