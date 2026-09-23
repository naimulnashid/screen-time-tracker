<#
    Stop the dashboard server.

        powershell -ExecutionPolicy Bypass -File scripts\dashboard-stop.ps1

    Needed before running `npm run dev` or `next build` by hand: they share
    .next with the running server, and a build under a live server replaces
    chunks it holds open. See the warning in dashboard-service.ps1.

    It stops only THIS project's server - the logon task's, the .bat's or
    `npm run dev`'s - never "whatever is listening on the port". On Windows a
    server bound to 127.0.0.1 can share a port with another program's wildcard
    (0.0.0.0 or ::) listener, so a port can have two owners, and the other
    local dashboards are node too. A listener counts as this dashboard only
    when its command line runs Next.js out of this project's own node_modules.
    Anything else, including a process whose command line cannot be read, is
    left alone and named.

        -WhatIf    show which process would be stopped, and stop nothing
        -Port      try the rule on a spare port; the dashboard is on 7844

    Keep this file pure ASCII. See CLAUDE.md.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param([int]$Port = 7844)

$ErrorActionPreference = 'Stop'

# -WhatIf would otherwise reach PowerShell's automatic import of the two
# modules used below and print a "What if: Set Alias" line for every alias they
# define. Import them first with it off; ShouldProcess still sees -WhatIf.
$dryRun = $WhatIfPreference
$WhatIfPreference = $false
Import-Module NetTCPIP, CimCmdlets
$WhatIfPreference = $dryRun

# "<project>\node_modules\" rather than "<project>": the bare path would also
# match a sibling folder whose name merely starts with this one's.
$modules = (Join-Path (Split-Path -Parent $PSScriptRoot) 'node_modules') + '\'

# Launchers spell the same path differently: forward slashes, and the doubled
# separators npm writes into its shims ("node_modules\.bin\\..\next").
function ConvertTo-ComparablePath([string]$Text) {
    return (($Text -replace '/', '\') -replace '\\{2,}', '\')
}

function Test-ThisDashboard([string]$CommandLine) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $needle = ConvertTo-ComparablePath $modules
    return (ConvertTo-ComparablePath $CommandLine).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

# Each listening process once, split into this dashboard's and everyone else's.
function Get-Listeners {
    $found = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($procId in ($found.OwningProcess | Select-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        [pscustomobject]@{ Id = [int]$procId; Name = $proc.Name; CommandLine = $proc.CommandLine
                           Ours = Test-ThisDashboard $proc.CommandLine }
    }
}

$listeners = @(Get-Listeners)
if ($listeners.Count -eq 0) {
    Write-Host "  nothing listening on port $Port" -ForegroundColor DarkGray
    exit 0
}

foreach ($l in $listeners) {
    if (-not $l.Ours) {
        $what = if ($l.CommandLine) { $l.CommandLine } else { 'command line unreadable' }
        Write-Host ("  leaving {0} (PID {1}) alone - not this dashboard: {2}" -f $l.Name, $l.Id, $what) -ForegroundColor DarkGray
        continue
    }
    if ($PSCmdlet.ShouldProcess("$($l.Name), PID $($l.Id), port $Port", 'Stop the dashboard')) {
        Write-Host ("  stopping {0} (PID {1})" -f $l.Name, $l.Id) -ForegroundColor Yellow
        Stop-Process -Id $l.Id -Force
    }
}
if ($WhatIfPreference) { exit 0 }

Start-Sleep -Seconds 1
$after = @(Get-Listeners)
if (@($after | Where-Object { $_.Ours }).Count -gt 0) { Write-Host "  [WARN] the dashboard is still listening on port $Port" -ForegroundColor Yellow }
elseif ($after.Count -gt 0) { Write-Host "  [OK] the dashboard is stopped; port $Port is still held by another program" -ForegroundColor Green }
else { Write-Host "  [OK] port $Port is free" -ForegroundColor Green }
