<#
    The Windows screen time collector.

    Phase 1a settled that SRUM cannot answer this question: its
    AppTimelineProvider table measures process PRESENCE, not focus, summing to
    79x wall clock with svchost.exe on top. See CLAUDE.md. So Windows screen
    time is sampled directly, and that turned out to be the better position:

      - NO ELEVATION. No VSS, no esentutl, no dirty-shutdown recovery, no
        99 MB copy per run. This runs as an ordinary per-logon task.
      - Retention is ours, not Windows' seven days.
      - It is exact by definition: the foreground window IS the thing in focus.

    The cost is that it only records from the moment it is installed. There is
    no history to backfill, which is why this was worth building before the
    Android half was finished.

    ------------------------------------------------------------------------
    WHAT IT WRITES

    Append-only JSONL, one completed span per line, one file per local day.
    Not SQLite: this process runs for weeks, and a long-lived writer holding a
    database handle across a WAL checkpoint is how you end up serving stale
    pages. `ingest-windows.ts` folds the JSONL into SQLite afterwards.

    Append-only is also crash-safe. Every line is a complete span, so a kill
    -9 loses at most the span in flight.

    Each span is one of:
      app      a real foreground application
      locked   workstation locked, or the secure desktop is up
      gap      the machine slept, hibernated, or this process was not running
      unknown  a foreground window we could not attribute

    ------------------------------------------------------------------------
    FOUR THINGS THAT ARE EASY TO GET WRONG

    1. SLEEP MAKES THE CLOCK JUMP. When the machine suspends, this process is
       frozen mid-Start-Sleep and resumes minutes or hours later. Extending
       the current span across that invents screen time that never happened --
       and it would look plausible. Every tick therefore checks the wall-clock
       delta since the last sample and, if it exceeds GapSeconds, closes the
       span at the LAST GOOD SAMPLE and emits an explicit `gap` span.

    2. UWP APPS ALL LOOK LIKE ApplicationFrameHost.exe. Store apps -- Settings,
       the Claude desktop app, Photos -- are hosted in a frame process, so
       naive attribution files them all under one name. The fix is to walk the
       frame's child windows and take the first child owned by a DIFFERENT
       process. Without it a real chunk of usage is misattributed to a host
       process nobody has ever opened.

    3. THE IN-FLIGHT SPAN COUNTS. Measured on the Android side against Digital
       Wellbeing: discarding the currently-open session made "today" read
       a quarter below the phone's own figure. The two ends of the stream are not
       symmetrical -- a close with no open has an unknown start and must be
       dropped, but an open with no close has a known start and is real. This
       sampler therefore writes a heartbeat carrying the in-flight span so the
       dashboard can add it without waiting for the user to switch away.

    4. WINDOW TITLES ARE NOT CAPTURED, EVER. A title carries the document you
       are editing, the page you are reading, the person you are messaging.
       This project records which app and for how long, which is a different
       and far smaller disclosure. Do not add titles "just for the detail
       page" -- and note the dashboard is reachable over the LAN.

    Keep this file pure ASCII. See CLAUDE.md.
#>

[CmdletBinding()]
param(
    # Polling interval. Sessions shorter than this are missed, and every
    # boundary is quantised to it. 2s costs nothing measurable and bounds the
    # error at a couple of seconds per switch.
    [int]$IntervalSeconds = 2,

    # Wall-clock jump that means "we were not running". Must be comfortably
    # above IntervalSeconds or ordinary scheduling jitter looks like sleep.
    [int]$GapSeconds = 30,

    # Where the JSONL and heartbeat go. Defaults to samplerLogDir in
    # config/collector.json, then to a sibling of the scratch dir.
    [string]$OutDir = '',

    # Testing: run for N seconds and exit. 0 means run forever.
    [int]$RunSeconds = 0
)

$ErrorActionPreference = 'Stop'

# --- Win32 --------------------------------------------------------------
# Add-Type compiles this once per process against the in-box C# compiler.
# Nothing here needs elevation.
if (-not ('ScreenTime.Win32' -as [type])) {
    Add-Type -Namespace 'ScreenTime' -Name 'Win32' -MemberDefinition @'
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc cb, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    // The owning process of a window, resolving the UWP frame-host case.
    //
    // ApplicationFrameHost.exe hosts every store app, so the frame window is
    // owned by the host while the actual app owns a CHILD window. Take the
    // first child whose process differs from the frame's; that is the app.
    public static uint RealProcessId(IntPtr hWnd)
    {
        uint framePid = 0;
        GetWindowThreadProcessId(hWnd, out framePid);
        uint found = framePid;
        EnumChildWindows(hWnd, delegate(IntPtr child, IntPtr lp)
        {
            uint childPid = 0;
            GetWindowThreadProcessId(child, out childPid);
            if (childPid != 0 && childPid != framePid) { found = childPid; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WTSQuerySessionInformationW(
        IntPtr hServer, uint sessionId, int infoClass,
        out IntPtr ppBuffer, out uint pBytesReturned);

    [DllImport("wtsapi32.dll")]
    public static extern void WTSFreeMemory(IntPtr pMemory);

    // Authoritative lock state for THIS session.
    //
    //   0  locked      1  unlocked      -1 Windows says unknown
    //  -2  the call failed or returned too little data
    //
    // Returned by WTSQuerySessionInformation(WTSSessionInfoEx), which is the
    // documented API for this and needs no elevation for your own session.
    //
    // The alternatives were both tried and both are wrong:
    //   - "is LockApp.exe foreground" misses a locked machine whose screen has
    //     gone off, because then nothing is foreground at all. That is what
    //     put 61% of a night into 'unattributed'.
    //   - "does LogonUI.exe exist" reports locked while unlocked, because the
    //     process lingers after unlock on Windows 11. Measured.
    public static int SessionLockState()
    {
        IntPtr buf = IntPtr.Zero;
        uint got = 0;
        // WTS_CURRENT_SERVER_HANDLE = 0, WTS_CURRENT_SESSION = (DWORD)-1,
        // WTSSessionInfoEx = 25.
        if (!WTSQuerySessionInformationW(IntPtr.Zero, 0xFFFFFFFF, 25, out buf, out got))
            return -2;
        try
        {
            // WTSINFOEXW is { DWORD Level; WTSINFOEX_LEVEL1_W Data; }. Data
            // starts at offset 8, not 4: LEVEL1 contains LARGE_INTEGER members
            // further down, which give it 8-byte alignment and force four bytes
            // of padding after Level. Inside LEVEL1 the first fields are
            // SessionId(4), SessionState(4), SessionFlags(4) -- so SessionFlags
            // sits at 8 + 8 = 16.
            if (got < 20) return -2;
            return Marshal.ReadInt32(buf, 16);
        }
        finally
        {
            if (buf != IntPtr.Zero) WTSFreeMemory(buf);
        }
    }

    // Milliseconds since the last keyboard or mouse input.
    //
    // Unsigned arithmetic on purpose: Environment.TickCount wraps every 24.9
    // days, and the subtraction stays correct across the wrap only if both
    // sides are uint.
    public static uint IdleMs()
    {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref lii)) { return 0; }
        return (uint)Environment.TickCount - lii.dwTime;
    }
'@
    # NOTE: no -UsingNamespace here. Add-Type -MemberDefinition already emits
    # `using System.Runtime.InteropServices;`, and adding it again is a
    # duplicate-using warning that PS 5.1 escalates to a hard error.
}

# --- Where output goes --------------------------------------------------
function Resolve-OutDir {
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }

    $cfgPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'config\collector.json'
    if (Test-Path $cfgPath) {
        try {
            $raw = [System.IO.File]::ReadAllText($cfgPath)
            # Set-Content -Encoding utf8 writes a BOM under PS 5.1 and
            # ConvertFrom-Json throws on it. Strip it. See CLAUDE.md.
            if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 65279) { $raw = $raw.Substring(1) }
            $cfg = $raw | ConvertFrom-Json
            if ($cfg.samplerLogDir) { return $cfg.samplerLogDir }
            if ($cfg.scratchDir)    { return (Join-Path $cfg.scratchDir 'sampler') }
        } catch { }
    }
    return (Join-Path $env:LOCALAPPDATA 'ScreenTimeSampler')
}

$outDir = Resolve-OutDir -Explicit $OutDir
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$heartbeatPath = Join-Path $outDir 'sampler-status.json'

# Touch this file to ask the sampler to stop CLEANLY.
#
# Stop-Process does not run the finally block below, so killing the sampler
# discards whatever span is in flight -- which on a machine you have been using
# all morning is the whole morning. Restarting is not rare either: every change
# to this file needs one. So there is a polite way to ask.
$stopPath = Join-Path $outDir 'sampler.stop'
if (Test-Path $stopPath) { Remove-Item $stopPath -Force -ErrorAction SilentlyContinue }

function Get-LogPath {
    # One file per LOCAL day, so a day's spans stay together and old files can
    # be pruned after ingest without parsing them.
    Join-Path $outDir ("sessions-{0}.jsonl" -f (Get-Date).ToString('yyyy-MM-dd'))
}

function Stamp {
    param([datetime]$T)
    $T.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

# --- Sampling one instant ----------------------------------------------
# Secondary lock signal, kept for the secure desktop (UAC consent, credential
# prompts) which WTS does not report as a session lock but which is equally not
# something the user is "using". The PRIMARY signal is SessionLockState().
$LOCK_PROCESSES = @('lockapp', 'logonui', 'consent', 'credentialuihost')

function Get-CurrentTarget {
    # Ask Windows whether the session is locked BEFORE looking at the
    # foreground window. This is the authoritative answer and it does not
    # depend on anything being foreground -- which is exactly the case that
    # used to be lost, because a locked machine whose screen has gone off has
    # no foreground window at all.
    #
    # Measured before this check existed: 1h18m of a night went to
    # 'unattributed' against 15m of real activity, 61% of tracked time.
    #
    # Only 0 means locked. -1 (Windows does not know) and -2 (the call failed)
    # deliberately fall through to the window logic rather than guessing, since
    # 'locked' is subtracted from active time and a false one under-reports
    # invisibly.
    $lock = [ScreenTime.Win32]::SessionLockState()
    if ($lock -eq 0) {
        return @{ kind = 'locked'; app = ''; unresolved = $false }
    }

    $h = [ScreenTime.Win32]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) {
        # A null foreground window is NOT proof of a lock.
        #
        # This originally returned 'locked' here, and a 12-second test run
        # promptly recorded a lock that had not happened -- the desktop simply
        # had nothing focused for a moment, which also occurs while a window
        # closes, during a desktop switch, and when the caller cannot reach the
        # interactive window station.
        #
        # That error is not symmetrical: 'locked' is SUBTRACTED from screen-on,
        # so a false lock silently under-reports, while 'unknown' is visible in
        # the data and can be investigated.
        #
        # Reaching here means the session is NOT locked (the WTS check above
        # already returned for that) and yet nothing holds focus -- a window
        # closing, a desktop switch, or a caller without access to the
        # interactive window station. 'unknown' is the truthful answer.
        return @{ kind = 'unknown'; app = ''; unresolved = $false }
    }

    $pid2 = [ScreenTime.Win32]::RealProcessId($h)
    if ($pid2 -eq 0) { return @{ kind = 'unknown'; app = ''; unresolved = $false } }

    try {
        $proc = Get-Process -Id $pid2 -ErrorAction Stop
    } catch {
        return @{ kind = 'unknown'; app = ''; unresolved = $false }
    }

    if ($LOCK_PROCESSES -contains $proc.ProcessName.ToLower()) {
        return @{ kind = 'locked'; app = ''; unresolved = $false }
    }

    # Did the UWP frame-host resolution actually get past the host?
    #
    # MEASURED 2026-08-31: a BACKGROUND ApplicationFrameWindow has only
    # ApplicationFrameTitleBarWindow / ApplicationFrameInputSinkWindow
    # children, all owned by the host -- the app's Windows.UI.Core.CoreWindow
    # child does not exist while the app is suspended. It appears when the app
    # is foreground, which is exactly when this function runs, so the lookup
    # should normally succeed.
    #
    # "Should normally" is not "does", and this cannot be proven from a
    # background window. So the failure is RECORDED rather than assumed away:
    # ingest counts these and the sync page can report what fraction of
    # foreground time never got past the host. A visible gap beats a silent
    # misattribution of every store app to one process nobody opens.
    $unresolved = ($proc.ProcessName -eq 'ApplicationFrameHost')

    $path = ''
    try { $path = $proc.Path } catch { }
    if (-not $path) {
        # Protected and some system processes refuse .Path unelevated. The
        # process NAME is still worth keeping -- it is what Windows itself
        # displays -- so this is a partial answer, not a failure.
        return @{ kind = 'app'; app = $proc.ProcessName; unresolved = $unresolved }
    }
    return @{ kind = 'app'; app = $path; unresolved = $unresolved }
}

# --- Emitting -----------------------------------------------------------
function Write-Span {
    param([datetime]$Start, [datetime]$End, [string]$Kind, [string]$App, [int]$IdleMsAtEnd,
          [bool]$Unresolved = $false)

    $ms = [int][math]::Round(($End - $Start).TotalMilliseconds)
    if ($ms -le 0) { return }

    $row = [ordered]@{
        start    = Stamp $Start
        end      = Stamp $End
        ms       = $ms
        kind     = $Kind
        app      = $App
        idle_ms  = $IdleMsAtEnd
        # Only written when true, so the common case stays one short line.
        unresolved = $(if ($Unresolved) { $true } else { $null })
    }
    if (-not $Unresolved) { $row.Remove('unresolved') }
    # -Compress keeps one span to one line, which is what makes the file
    # append-only and crash-safe.
    $line = ($row | ConvertTo-Json -Compress)

    # NOT Add-Content -Encoding UTF8. Under Windows PowerShell 5.1 that writes
    # a BOM, and it writes it at the START OF THE FILE -- so the first JSON
    # line of every day begins with U+FEFF and JSON.parse throws on it. The
    # sibling project hit exactly this with network.json, where it failed
    # silently and looked like "no network was recorded". Measured here on the
    # first real run: the file opened with a BOM before `{`.
    #
    # AppendAllText with UTF8Encoding($false) writes no BOM, and creates the
    # file if it does not exist.
    [System.IO.File]::AppendAllText(
        (Get-LogPath),
        $line + [Environment]::NewLine,
        (New-Object System.Text.UTF8Encoding($false)))
}

function Write-Heartbeat {
    param([datetime]$Now, $Current, [datetime]$CurrentStart)

    # Carries the IN-FLIGHT span so the dashboard can add it without waiting
    # for a focus change. See note 3 at the top of this file.
    $hb = [ordered]@{
        updated          = Stamp $Now
        interval_seconds = $IntervalSeconds
        in_flight = [ordered]@{
            start = Stamp $CurrentStart
            kind  = $Current.kind
            app   = $Current.app
            ms    = [int][math]::Round(($Now - $CurrentStart).TotalMilliseconds)
        }
    }
    $tmp = "$heartbeatPath.tmp"
    [System.IO.File]::WriteAllText($tmp, ($hb | ConvertTo-Json -Compress -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Path $tmp -Destination $heartbeatPath -Force
}

# --- Main loop ----------------------------------------------------------
Write-Host "screen-time sampler"
Write-Host "  out      : $outDir"
Write-Host "  interval : ${IntervalSeconds}s   gap threshold: ${GapSeconds}s"
Write-Host "  titles   : NOT captured, by design"
Write-Host ""

$current      = Get-CurrentTarget
$currentStart = Get-Date
$lastSample   = $currentStart
$started      = $currentStart
$spans        = 0

try {
    while ($true) {
        Start-Sleep -Seconds $IntervalSeconds
        $now = Get-Date

        # 1. Did the machine sleep, or were we not running?
        $delta = ($now - $lastSample).TotalSeconds
        if ($delta -gt $GapSeconds) {
            Write-Span -Start $currentStart -End $lastSample -Kind $current.kind -App $current.app -IdleMsAtEnd 0 -Unresolved ([bool]$current.unresolved)
            Write-Span -Start $lastSample -End $now -Kind 'gap' -App '' -IdleMsAtEnd 0
            $spans += 2
            $current      = Get-CurrentTarget
            $currentStart = $now
            $lastSample   = $now
            continue
        }

        # 2. Did the foreground change?
        $target = Get-CurrentTarget
        if ($target.kind -ne $current.kind -or $target.app -ne $current.app) {
            $idle = [int][ScreenTime.Win32]::IdleMs()
            Write-Span -Start $currentStart -End $now -Kind $current.kind -App $current.app -IdleMsAtEnd $idle -Unresolved ([bool]$current.unresolved)
            $spans++
            $current      = $target
            $currentStart = $now
        }

        $lastSample = $now
        Write-Heartbeat -Now $now -Current $current -CurrentStart $currentStart

        if ($RunSeconds -gt 0 -and ($now - $started).TotalSeconds -ge $RunSeconds) { break }

        # A stop request leaves the loop so the finally block runs and the
        # in-flight span is written, rather than lost to a kill.
        if (Test-Path $stopPath) {
            Remove-Item $stopPath -Force -ErrorAction SilentlyContinue
            Write-Host "  stop requested"
            break
        }
    }
} finally {
    # Flush the in-flight span on any exit -- Ctrl-C, task stop, logoff.
    # Without this the last span of every session is lost, which on a machine
    # that is shut down each evening is the whole evening.
    $now = Get-Date
    Write-Span -Start $currentStart -End $now -Kind $current.kind -App $current.app -IdleMsAtEnd ([int][ScreenTime.Win32]::IdleMs()) -Unresolved ([bool]$current.unresolved)
    $spans++
    Write-Host ""
    Write-Host "  spans written: $spans"
    Write-Host "  log          : $(Get-LogPath)"
}
