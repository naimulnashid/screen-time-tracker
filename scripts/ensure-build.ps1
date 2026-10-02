<#
    Makes sure the dashboard has a production build to serve.

        powershell -ExecutionPolicy Bypass -File scripts\ensure-build.ps1
        powershell -ExecutionPolicy Bypass -File scripts\ensure-build.ps1 -RebuildStale
        powershell -ExecutionPolicy Bypass -File scripts\ensure-build.ps1 -Force

    Both launchers call this, so there is one answer to "is there a build, and
    is it current", in one place. Before this, each carried its own copy of the
    rule and nothing but a comment kept them alike.

      - start-screen-time-dashboard.bat calls it plainly. It builds only when
        there is no complete build, and WARNS when the source is newer than the
        build: the window is in front of you, so the warning is seen, and a
        build is a thing you run where its output and any failure are visible.
        FORCE_BUILD=1 there passes -Force.

      - dashboard-service.ps1 (the logon task) passes -RebuildStale. It has no
        window to warn in, and on a dashboard whose entire job is reporting
        current numbers, silently serving code from three weeks ago is a
        convincing kind of wrong -- everything renders, nothing errors, and the
        figures are computed by queries you have since fixed. So it rebuilds.

    "Stale" means anything under src\ or config\, or package.json,
    next.config.mjs or tsconfig.json, is newer than .next\BUILD_ID - the same
    list as the other local dashboards' launchers. A dependency bump in
    package.json with no change under src\ is still a different build.

    "A build" means BUILD_ID AND .next\server. BUILD_ID is written when a build
    finishes, but a .next emptied by hand, or half deleted, can leave it behind
    with nothing behind it -- and `next start` would then come up and fail
    every route.

    NEVER let this build while a dev server is up on the same project: they
    share .next, and the build replaces chunks the dev server holds open (the
    "Cannot find module './331.js'" trap). Both callers check the port first.

    Installs dependencies first if node_modules is missing.

    Writes to its output only, never to the log file; the logon task writes
    that output to logs\dashboard.log itself.

    Exit 0 means there is a build to serve; anything else means there is not.

    Keep this file pure ASCII: Windows PowerShell 5.1 reads a BOM-less script as ANSI.
#>

param(
    [switch]$RebuildStale,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Say([string]$message) {
    Write-Output ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
}

# npm is npm.cmd on Windows, and a scheduled task's PATH is not an interactive
# shell's, so resolve it explicitly rather than assuming. No ?. operator: this
# runs under Windows PowerShell 5.1, where that is a parse error.
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npm = if ($npmCommand) { $npmCommand.Source } else { $null }

# Runs npm, passing its output through as plain lines. The preference drops to
# Continue for the call: under Windows PowerShell 5.1, redirecting a native
# command's stderr while it is Stop turns any stderr line into a terminating
# error, and npm writes ordinary progress there.
function Invoke-Npm([string[]]$arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $npm @arguments 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $previous }
}

function Test-Built {
    return (Test-Path '.next\BUILD_ID') -and (Test-Path '.next\server')
}

if (-not (Test-Path 'node_modules')) {
    if (-not $npm) { Say 'ERROR: npm.cmd not found on PATH. Is Node.js installed?'; exit 1 }
    Say 'Installing dependencies. This happens once and takes a minute...'
    Invoke-Npm @('install')
    if ($LASTEXITCODE -ne 0) { Say "ERROR: npm install failed with exit code $LASTEXITCODE."; exit 1 }
}

$reason = $null
if (-not (Test-Path '.next\BUILD_ID')) {
    $reason = 'No production build found - building (about 30s)...'
}
elseif (-not (Test-Path '.next\server')) {
    $reason = 'The build in .next is incomplete (no .next\server) - building (about 30s)...'
}
elseif ($Force) {
    $reason = 'Rebuilding, as asked (about 30s)...'
}
else {
    $builtAt = (Get-Item '.next\BUILD_ID').LastWriteTime
    $sources = @(Get-ChildItem -Path 'src', 'config' -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($file in 'package.json', 'next.config.mjs', 'tsconfig.json') {
        if (Test-Path $file) { $sources += Get-Item $file }
    }
    $newest = $sources | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if ($newest -and $newest.LastWriteTime -gt $builtAt) {
        if ($RebuildStale) {
            $reason = "Rebuild needed: $($newest.Name) is newer than the build - building (about 30s)..."
        }
        else {
            Say ("WARNING: the build is from {0}, but {1} changed at {2}." -f
                $builtAt.ToString('yyyy-MM-dd HH:mm'), $newest.Name, $newest.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
            Say "Serving the OLD build. Run 'npm run build' (or set FORCE_BUILD=1) to pick the change up."
        }
    }
    else {
        Say "Build is current ($($builtAt.ToString('yyyy-MM-dd HH:mm:ss')))."
    }
}

if (-not $reason) { exit 0 }

if (-not $npm) { Say 'ERROR: npm.cmd not found on PATH. Is Node.js installed?'; exit 1 }
Say $reason
Invoke-Npm @('run', 'build')
if ($LASTEXITCODE -ne 0) { Say "ERROR: the build failed with exit code $LASTEXITCODE."; exit 1 }
if (-not (Test-Built)) {
    Say 'ERROR: the build reported success but left no .next\BUILD_ID or .next\server.'
    exit 1
}

Say 'Build complete.'
exit 0
