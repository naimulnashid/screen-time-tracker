<#
    Restore the database from the backup.

        powershell -ExecutionPolicy Bypass -File scripts\restore.ps1
        powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -Force

    RESTORE FROM THE BACKUP, NEVER FROM THE LIVE FILE.

    In WAL mode a database is three files -- .db, .db-wal, .db-shm -- that must
    be mutually consistent. The live copy sits in a Google-Drive-synced folder,
    and a sync client can upload those three at three different instants, so
    the cloud copy of the LIVE file can look perfectly fine and restore wrong.

    The backup is written with SQLite's backup() API rather than copied, so it
    is always one complete, internally consistent file. That is the entire
    reason it exists.

    This refuses to overwrite a live database that has MORE rows than the
    backup unless you pass -Force. That is the shape of the accident worth
    guarding: reaching for restore.ps1 after a scare and silently throwing away
    the newer data you still had.

    Keep this file pure ASCII. See CLAUDE.md.
#>

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "         $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

$repo = Split-Path $PSScriptRoot -Parent
$cfgPath = Join-Path $repo 'config\collector.json'
if (-not (Test-Path $cfgPath)) {
    # Local-only, so a fresh clone does not have it. After a reset the kit's
    # copy is the one to use: it knows where the backup actually is.
    Write-Bad "config\collector.json not found"
    Write-Info "After a reset: copy it back from the local-files folder beside your"
    Write-Info "backup (see RESTORE.txt there). Fresh install: copy"
    Write-Info "config\collector.example.json to config\collector.json and edit it."
    exit 1
}
$raw = [System.IO.File]::ReadAllText($cfgPath)
if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 65279) { $raw = $raw.Substring(1) }
$cfg = $raw | ConvertFrom-Json

$backup = $cfg.backupPath
$live   = $cfg.databasePath

Write-Host "`n=== Restore ===" -ForegroundColor Cyan
Write-Info "from: $backup"
Write-Info "to:   $live"

if (-not (Test-Path $backup)) { Write-Bad "backup not found"; exit 1 }

$systemDrive = "$env:SystemDrive".ToUpper()
if ([System.IO.Path]::GetFullPath($live).ToUpper().StartsWith($systemDrive + '\')) {
    Write-Bad "refusing to restore onto the system drive: $live"
    Write-Info "that is the reset this project exists to survive. Fix databasePath first."
    exit 1
}

# Compare before clobbering.
$liveRows = -1
$backupRows = -1
function Get-Rows {
    param($Path)
    if (-not (Test-Path $Path)) { return -1 }
    try {
        $out = & node -e "
const {DatabaseSync}=require('node:sqlite');
try{
  const db=new DatabaseSync(process.argv[1],{readOnly:true});
  let n=0;
  for (const t of ['windows_segments','android_segments','android_screen']) {
    try { n += db.prepare('SELECT COUNT(*) c FROM '+t).get().c; } catch {}
  }
  db.close(); console.log(n);
}catch(e){ console.log(-1); }
" $Path
        return [int]($out | Select-Object -Last 1)
    } catch { return -1 }
}

$backupRows = Get-Rows $backup
$liveRows = Get-Rows $live
Write-Info "backup holds $backupRows rows; live holds $liveRows"

if ($liveRows -gt $backupRows -and -not $Force) {
    Write-Bad "the LIVE database has more rows than the backup ($liveRows > $backupRows)"
    Write-Info "restoring would discard $($liveRows - $backupRows) rows that only exist in live."
    Write-Info "If that is genuinely what you want, re-run with -Force."
    exit 1
}

# Move the current live aside rather than deleting it. Cheap, and the one time
# it matters is the time you restored the wrong file.
if (Test-Path $live) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $aside = "$live.superseded-$stamp"
    Move-Item $live $aside -Force
    Write-Ok "previous live database moved aside"
    Write-Info $aside
    # The sidecars belong to the file that just moved; leaving them next to a
    # freshly restored database is how you get a "database is locked" or worse.
    foreach ($suffix in @('-wal', '-shm')) {
        if (Test-Path ($live + $suffix)) { Remove-Item ($live + $suffix) -Force }
    }
    Write-Info "stale -wal/-shm removed"
}

$liveDir = Split-Path $live -Parent
if (-not (Test-Path $liveDir)) { New-Item -ItemType Directory -Path $liveDir -Force | Out-Null }
Copy-Item $backup $live -Force
Write-Ok "restored"

$restoredRows = Get-Rows $live
if ($restoredRows -eq $backupRows -and $restoredRows -ge 0) {
    Write-Ok "verified: $restoredRows rows readable from the restored database"
} else {
    Write-Warn "restored file reports $restoredRows rows, expected $backupRows"
}

Write-Host ""
Write-Info "Next: npm run drill, then install-sampler.ps1 -RunNow if the tasks are gone."
