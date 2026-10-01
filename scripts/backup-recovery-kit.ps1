<#
    Put everything a rebuilt machine needs somewhere a reset cannot reach.

        powershell -ExecutionPolicy Bypass -File scripts\backup-recovery-kit.ps1

    The database already has a backup. This covers the things that do NOT,
    both found by `npm run drill`:

      1. THE CODE. A repo with no remote dies with its disk -- and a database
         backup nobody can read is not a backup. A git bundle is the whole
         history in one file, restored with `git clone`. It is written ONLY
         while the branch is not pushed: once a remote holds every commit,
         the bundle is a third copy of it, and a stale one is removed.

      2. THE SECRETS. `.env.local` is gitignored, so restoring the repo gives
         you everything except the two values that make it run. Worse, the
         failure is silent on the phone: it keeps pushing to a token the
         rebuilt server has never heard of and just records a 401.

      3. THE LOCAL-ONLY FILES. config\collector.json, config\app-colours.json
         and the logos in public\apps_logo\ are gitignored because they
         describe this installation (its drives, its devices, every app on
         them). A clone without collector.json cannot even find the database
         backup to restore. Only the ones git does NOT hold are copied: a
         private fork that commits them and pushes needs no copy at all.

      4. THE APK SIGNING KEY. The .jks must sit off the system drive (the
         drill checks); android\keystore.properties, which names it and holds
         its passwords, is gitignored and copied to the secrets folder. Without
         the key a new release cannot install over the old one.

    ------------------------------------------------------------------------
    THE DESTINATIONS ARE DIFFERENT ON PURPOSE.

      bundle      -> beside backupPath   Code is not secret, and off-machine
      local-files -> beside backupPath   (a synced folder) is exactly what you
                                         want. Personal, but not a credential.

      secrets -> <scratchDir>\recovery\  NOT synced (that is why the scratch
                                         dir lives outside the synced folder).
                                         The values survive a C:\ reset without
                                         being uploaded to anyone's cloud.

    The secrets copy is PLAINTEXT on a local disk -- the same protection the
    original has, and no worse. If that is not good enough for you, put them in
    a password manager instead and delete the copy; the drill will then warn
    rather than fail, which is the honest state.

    Keep this file pure ASCII: Windows PowerShell 5.1 reads a BOM-less script as ANSI.
#>

[CmdletBinding()]
param(
    [switch]$SkipSecrets
)

$ErrorActionPreference = 'Stop'

<#
    Run a native command without letting its stderr kill the script.

    git writes ordinary progress AND success messages to stderr -- `git bundle
    verify` reports "is okay" there. With $ErrorActionPreference = 'Stop', any
    stderr from a native command becomes a terminating NativeCommandError, so
    the FIRST version of this script created the bundle, verified it fine, and
    then died before saving the secrets. It reported success for the half it
    had done.

    Redirecting with 2>&1 does not help; it is the redirection that promotes
    the stream. The fix is to drop the preference around the call and judge the
    result by $LASTEXITCODE, which is the only thing that actually means
    failure for a native command.
#>
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>&1 | ForEach-Object { $_.ToString() }
        return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = @($output) }
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "         $m" -ForegroundColor DarkGray }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$cfgPath = Join-Path $repo 'config\collector.json'
if (-not (Test-Path $cfgPath)) {
    Write-Bad "config\collector.json not found -- copy config\collector.example.json and set your paths"
    exit 1
}
$raw = [System.IO.File]::ReadAllText($cfgPath)
if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 65279) { $raw = $raw.Substring(1) }
$cfg = $raw | ConvertFrom-Json

# --- 1. The code -------------------------------------------------------
$bundleDir = Split-Path $cfg.backupPath -Parent
if (-not (Test-Path $bundleDir)) { New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null }
$bundle = Join-Path $bundleDir 'screen-time-repo.bundle'

# Pushed means the branch has an upstream and no commit the upstream lacks.
# No upstream at all (a clone with no remote, or a branch never pushed with
# -u) counts as NOT pushed, so the bundle is still written.
$ahead = Invoke-Native git @('rev-list', '--count', '@{u}..HEAD')
$pushed = $ahead.ExitCode -eq 0 -and (($ahead.Output -join '').Trim() -eq '0')
$remoteUrl = ((Invoke-Native git @('remote', 'get-url', 'origin')).Output -join '').Trim()

Write-Host "`n=== Code ===" -ForegroundColor Cyan
$dirty = (Invoke-Native git @('status', '--porcelain')).Output -join "`n"
if ($dirty) {
    # Uncommitted work is in neither a bundle nor a push, and saying so beats
    # a green tick that quietly excludes your last hour.
    Write-Host "  [WARN] uncommitted changes are NOT backed up until committed:" -ForegroundColor Yellow
    foreach ($line in ($dirty -split "`n")) { Write-Info $line }
}

if ($pushed) {
    Write-Ok "every commit is on the remote; no bundle needed"
    Write-Info $remoteUrl
    if (Test-Path $bundle) {
        Remove-Item $bundle -Force
        Write-Info "removed the old bundle, now a stale third copy: $bundle"
    }
} else {
$create = Invoke-Native git @('bundle', 'create', $bundle, '--all')
foreach ($line in $create.Output) { Write-Info $line }
if ($create.ExitCode -ne 0) { Write-Bad "git bundle create failed (exit $($create.ExitCode))" }
if (Test-Path $bundle) {
    $mb = [math]::Round((Get-Item $bundle).Length / 1MB, 2)
    Write-Ok "repo bundle written ($mb MB)"
    Write-Info $bundle
    # Verify it, because an unverified bundle is the same hypothesis the
    # database backup used to be.
    $verify = Invoke-Native git @('bundle', 'verify', $bundle)
    if ($verify.ExitCode -eq 0) {
        Write-Ok "bundle verifies"
    } else {
        Write-Bad "bundle did NOT verify"
        foreach ($line in $verify.Output) { Write-Info $line }
    }
} else {
    Write-Bad "bundle was not created"
}
}

# --- 2. The secrets ----------------------------------------------------
Write-Host "`n=== Secrets ===" -ForegroundColor Cyan
if ($SkipSecrets) {
    Write-Info "skipped by request; keep them in a password manager instead"
} else {
    $envFile = Join-Path $repo '.env.local'
    if (-not (Test-Path $envFile)) {
        Write-Bad ".env.local not found -- nothing to preserve"
    } else {
        $secretDir = Join-Path $cfg.scratchDir 'recovery'
        if (-not (Test-Path $secretDir)) { New-Item -ItemType Directory -Path $secretDir -Force | Out-Null }
        Copy-Item $envFile (Join-Path $secretDir '.env.local') -Force
        Write-Ok "secrets copied to the NON-synced drive"
        Write-Info (Join-Path $secretDir '.env.local')
        Write-Info "plaintext, local disk only -- not uploaded anywhere"
    }

    # The APK signing properties. The key itself must already sit off the
    # system drive; a key on C:\ would die with the reset, so say so.
    $ksProps = Join-Path $repo 'android\keystore.properties'
    if (Test-Path $ksProps) {
        $secretDir = Join-Path $cfg.scratchDir 'recovery'
        if (-not (Test-Path $secretDir)) { New-Item -ItemType Directory -Path $secretDir -Force | Out-Null }
        Copy-Item $ksProps (Join-Path $secretDir 'keystore.properties') -Force
        $store = ((Get-Content $ksProps | Where-Object { $_ -like 'storeFile=*' }) -replace '^storeFile=', '').Trim()
        if (-not $store -or -not (Test-Path $store)) {
            Write-Bad "APK signing key not found at '$store'"
        } elseif ($store -like "$($env:SystemDrive)*") {
            Write-Bad "APK signing key is on the system drive ($store) -- move it to another drive and update storeFile"
        } else {
            Write-Ok "APK signing properties copied; key at $store"
        }
    } else {
        Write-Info "no android\keystore.properties -- no APK signing key to preserve"
    }
}

# --- 3. The local-only files -------------------------------------------
# A MIRROR, not an accumulation: rebuilt from nothing each run, so a logo
# deleted here is deleted from the copy too. `npm run drill` compares the two
# file by file, which is only meaningful if the copy is exactly this.
#
# A file git already holds, unmodified, on a pushed branch is NOT copied: the
# remote is its off-machine copy. That is every one of them in a private fork
# that commits them, and none in a plain clone of the public repo, where
# .gitignore keeps them out of git.
Write-Host "`n=== Local-only files ===" -ForegroundColor Cyan
$localDir = Join-Path $bundleDir 'local-files'
$tracked = @{}
foreach ($p in (Invoke-Native git @('ls-files')).Output) { $tracked[$p] = $true }
$modified = @{}
foreach ($p in (Invoke-Native git @('diff', '--name-only', 'HEAD')).Output) { $modified[$p] = $true }

$candidates = @()
foreach ($rel in @('config\collector.json', 'config\app-colours.json')) {
    if (Test-Path (Join-Path $repo $rel)) { $candidates += $rel } else { Write-Info "$rel absent -- nothing to copy" }
}
$logoSrc = Join-Path $repo 'public\apps_logo'
if (Test-Path $logoSrc) {
    $candidates += @(Get-ChildItem $logoSrc -Recurse -File | Where-Object { $_.Name -ne 'README.md' } |
        ForEach-Object { $_.FullName.Substring($repo.Length + 1) })
}
$need = @($candidates | Where-Object {
    $g = $_ -replace '\\', '/'
    -not ($pushed -and $tracked.ContainsKey($g) -and -not $modified.ContainsKey($g))
})

if (Test-Path $localDir) { Remove-Item $localDir -Recurse -Force }
if ($need.Count -eq 0) {
    Write-Ok "all $($candidates.Count) local-only file(s) are committed and pushed; no copy needed"
} else {
    foreach ($rel in $need) {
        $dst = Join-Path $localDir $rel
        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item (Join-Path $repo $rel) $dst -Force
    }
    Write-Ok "$($need.Count) of $($candidates.Count) local-only file(s) copied (the rest are in the pushed repo)"
    Write-Info $localDir
}

# --- 4. The instructions ----------------------------------------------
# Written beside the database backup, because a recovery procedure that lives
# only in the repo you are trying to restore is not a procedure.
$restoreDoc = Join-Path $bundleDir 'RESTORE.txt'
$cloneFrom = if ($pushed -and $remoteUrl) { $remoteUrl } else { $bundle }
$localStep = if ($need.Count -gt 0) {
    "xcopy /E /I /Y `"$localDir`" ."
} else {
    "nothing to do: they were committed and pushed, so the clone has them."
}
$doc = @"
Screen Time Tracker -- recovery
Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm')

Everything below assumes C:\ is gone and D:\ survived.

1. CODE
   git clone "$cloneFrom" "Screen Time Tracker"
   cd "Screen Time Tracker"
   npm install

2. SECRETS
   copy "$($cfg.scratchDir)\recovery\.env.local" .env.local
   (or set DASHBOARD_PASSWORD and ANDROID_INGEST_TOKEN by hand -- but then the
    phone needs the new token typed into Screen Time Reporter, or it will 401
    on every sync and only say so in its own status line)

   APK SIGNING KEY -- only needed to build a new release of the phone app:
   copy "$($cfg.scratchDir)\recovery\keystore.properties" android\keystore.properties

   LOCAL-ONLY FILES -- config, brand colours and logos; gitignored, so the
   clone may not have them, and step 3 needs collector.json:
   $localStep

3. DATABASE
   The live copy may be torn: in WAL mode it is three files that a sync client
   can upload at three different instants. Restore from the BACKUP, which is
   written with SQLite's backup() API and is always one consistent file.

   powershell -ExecutionPolicy Bypass -File scripts\restore.ps1

4. COLLECTORS
   powershell -ExecutionPolicy Bypass -File scripts\install-sampler.ps1 -RunNow

   Rebuilds both scheduled tasks against whatever SID the new install has.
   Do NOT import exported task XML -- the SID inside it belongs to the dead
   machine.

5. VERIFY
   npm run drill
   npm run selftest

Windows screen time only exists from the moment the sampler runs, so step 4 is
the urgent one. Android backfills about 10 days on its own once the phone
syncs again.
"@
[System.IO.File]::WriteAllText($restoreDoc, $doc, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`n=== Instructions ===" -ForegroundColor Cyan
Write-Ok "RESTORE.txt written beside the database backup"
Write-Info $restoreDoc
Write-Info "a procedure that lives only inside the repo you are restoring is not a procedure"

Write-Host ""
Write-Info "Re-run this after changing .env.local or the signing setup; with a pushed remote, code and local-only files need nothing more."
