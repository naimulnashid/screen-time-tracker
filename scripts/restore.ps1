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

    The database being replaced is kept beside it as one consistent copy
    (.superseded-<stamp>), made the same way. Moving only its main file aside
    lost every committed row still in its -wal. Nothing is replaced while
    another process holds it: stop the dashboard and the ingest task first.

    This refuses to overwrite a live database that has MORE rows than the
    backup unless you pass -Force. That is the shape of the accident worth
    guarding: reaching for restore.ps1 after a scare and silently throwing away
    the newer data you still had.

    Keep this file pure ASCII: Windows PowerShell 5.1 reads a BOM-less script as ANSI.
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

# Rows and integrity, read through node:sqlite so the WAL is included. Prints
# one line of JSON; ok=false for a missing or unreadable file.
function Get-DbInfo {
    param($Path)
    if (-not (Test-Path $Path)) { return [pscustomobject]@{ ok = $false; rows = -1; error = 'missing' } }
    try {
        $out = & node -e "
const {DatabaseSync}=require('node:sqlite');
try{
  const db=new DatabaseSync(process.argv[1],{readOnly:true});
  let n=0;
  for (const t of ['windows_segments','android_segments','android_screen']) {
    try { n += db.prepare('SELECT COUNT(*) c FROM '+t).get().c; } catch {}
  }
  const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close(); console.log(JSON.stringify({ok:true,rows:n,integrity}));
}catch(e){ console.log(JSON.stringify({ok:false,rows:-1,error:e.message})); }
" $Path
        return ($out | Select-Object -Last 1) | ConvertFrom-Json
    } catch { return [pscustomobject]@{ ok = $false; rows = -1; error = $_.Exception.Message } }
}

# A consistent single-file copy, WAL included -- see db-copy.mjs.
function Copy-Db {
    param([string]$From, [string]$To)
    $helper = Join-Path $PSScriptRoot 'db-copy.mjs'
    if (-not (Test-Path $helper)) { throw "Helper not found: $helper" }
    $json = & node $helper $From $To 2>&1 | Select-Object -Last 1
    return $json | ConvertFrom-Json
}

# Whether any process holds the file. Windows refuses a share-nothing open
# while another handle exists, which is exactly the question; the handle is
# closed at once.
function Test-InUse {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    try {
        $fs = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
        $fs.Close()
        return $false
    } catch {
        return $true
    }
}

$backupInfo = Get-DbInfo $backup
$liveInfo = Get-DbInfo $live
$liveExists = Test-Path $live
$backupRows = $backupInfo.rows
$liveRows = $liveInfo.rows
Write-Info "backup holds $backupRows rows; live holds $liveRows"

if (-not $backupInfo.ok -or $backupInfo.integrity -ne 'ok') {
    Write-Bad "the backup is unreadable or fails integrity_check; nothing was changed"
    exit 1
}

if ($liveRows -gt $backupRows -and -not $Force) {
    Write-Bad "the LIVE database has more rows than the backup ($liveRows > $backupRows)"
    Write-Info "restoring would discard $($liveRows - $backupRows) rows that only exist in live."
    Write-Info "If that is genuinely what you want, re-run with -Force."
    exit 1
}

$busy = @("$live", "$live-wal") | Where-Object { Test-InUse $_ }
if ($busy) {
    Write-Bad "in use by another process: $($busy -join ', ')"
    Write-Info "Stop the dashboard (npm run dashboard:stop) and the Screen Time Ingest"
    Write-Info "task, then run this again. Nothing was changed."
    exit 1
}

# Keep the current live database rather than deleting it. Cheap, and the one
# time it matters is the time you restored the wrong file.
#
# Kept as a consistent COPY, not by moving the main file: its newest committed
# rows can live only in -wal, and a .db moved without it silently lacks them.
# The copy is checked against what was just read from the live file before
# anything is removed. An unreadable file cannot be copied that way, so it is
# moved aside with its sidecars, renamed together so that SQLite still pairs
# them (it finds a WAL by appending -wal to the database's name).
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$aside = "$live.superseded-$stamp"
if ($liveExists) {
    if ($liveInfo.ok) {
        $copied = Copy-Db $live $aside
        if (-not $copied.ok) { Write-Bad "could not copy the live database aside: $($copied.error)"; exit 1 }
        $asideInfo = Get-DbInfo $aside
        if (-not $asideInfo.ok -or $asideInfo.integrity -ne 'ok' -or $asideInfo.rows -ne $liveInfo.rows) {
            Write-Bad "the copy of the live database does not match it; nothing was replaced"
            Write-Info "copy: $aside"
            exit 1
        }
        Write-Ok "previous live database kept ($($asideInfo.rows) rows, WAL included)"
        Write-Info $aside
        Remove-Item $live -Force
    } else {
        Move-Item -Path $live -Destination $aside
        Write-Ok "unreadable live database moved aside"
        Write-Info $aside
    }
}

# Clear the sidecars at the destination. They belong to the file just kept
# (its WAL is inside the copy); left beside a freshly restored database they
# would be replayed against it. An unreadable file keeps its own beside it.
foreach ($suffix in @('-wal', '-shm')) {
    $sidecar = $live + $suffix
    if (Test-Path $sidecar) {
        if ($liveExists -and -not $liveInfo.ok) {
            Move-Item -Path $sidecar -Destination ($aside + $suffix)
            Write-Info "moved its $suffix aside with it"
        } else {
            Remove-Item $sidecar -Force
            Write-Info "stale $suffix removed"
        }
    }
}

$liveDir = Split-Path $live -Parent
if (-not (Test-Path $liveDir)) { New-Item -ItemType Directory -Path $liveDir -Force | Out-Null }
# Staged, so a copy that fails partway never sits at the live path.
$staging = "$live.restoring"
Copy-Item $backup $staging -Force
Move-Item -Path $staging -Destination $live
Write-Ok "restored"

$check = Get-DbInfo $live
$problem = $null
if (-not $check.ok) { $problem = "restored file is unreadable: $($check.error)" }
elseif ($check.integrity -ne 'ok') { $problem = 'restored file failed integrity_check' }
elseif ($check.rows -ne $backupRows) { $problem = "restored file reports $($check.rows) rows, expected $backupRows" }
if ($problem) {
    Write-Bad $problem
    if ($liveExists) {
        Write-Info "The previous database is intact at:"
        Write-Info "  $aside"
        Write-Info "To go back to it, delete $live and rename that file to it."
    }
    exit 1
}
Write-Ok "verified: $($check.rows) rows, integrity ok"

Write-Host ""
Write-Info "Next: npm run drill, then install-sampler.ps1 -RunNow if the tasks are gone."
