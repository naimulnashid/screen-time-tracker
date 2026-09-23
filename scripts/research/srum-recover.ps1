<#
    Soft recovery for a VSS copy of SRUDB.dat. Dot-source this; it defines
    Invoke-SrumSoftRecovery and nothing else.

    A VSS copy of a live ESE database is in 'Dirty Shutdown' state, and
    SrumECmd's ESE attach REFUSES it outright -- it throws
    EsentDatabaseDirtyShutdownException instead of parsing what it can. So
    replaying the journals is not an optional nicety here: without it there is
    no CSV at all, and the collector fails with "produced no NetworkUsage CSV".

    That is a narrower claim than the one CLAUDE.md used to make. "Do not fix
    the dirty shutdown by replaying the SRU*.log journals" was about chasing
    the last uncommitted hour, which is not worth a line of code because SRUM
    retains 30+ days. It was never about the parse itself, which depends on
    recovery and always did.

    Two things make this cheap:

      - The journals sit beside SRUDB.dat and, unlike the database, are opened
        share-read. A plain read works, unelevated, with no second VSS pass.
      - They are copied AFTER the snapshot, so they can only be newer than it.
        That is the direction soft recovery resolves -- and it means the
        recovered copy carries the most recent hour, which the snapshot alone
        does not.

    Deliberately NOT copied:

      SRU.chk       the checkpoint can name a log generation Windows has since
                    deleted. Without it, recovery starts from the oldest log
                    actually present, which exists by construction.
      SRUtmp.log    ESE's scratch file for the next generation, not a record.
      SRUres*.jrs   reserve space, no records.

    The database in $WorkDir MUST be named SRUDB.dat. The log stream records
    the database by name; /d only redirects the directory it is looked up in.
#>

function Invoke-SrumSoftRecovery {
    param(
        # Directory holding the snapshot, named SRUDB.dat. Journals are copied
        # here and every esentutl path is scoped to it, so nothing below can
        # touch the live SRUM directory.
        [Parameter(Mandatory = $true)][string]$WorkDir,

        # The live SRUM directory -- the parent of C:\...\sru\SRUDB.dat.
        [Parameter(Mandatory = $true)][string]$SrumDir
    )

    $copied   = 0
    $warnings = @()

    foreach ($lg in @(Get-ChildItem $SrumDir -Filter 'SRU*.log' -ErrorAction SilentlyContinue)) {
        if ($lg.Name -eq 'SRUtmp.log') { continue }
        try {
            [System.IO.File]::WriteAllBytes(
                (Join-Path $WorkDir $lg.Name),
                [System.IO.File]::ReadAllBytes($lg.FullName))
            $copied++
        } catch {
            $warnings += "could not copy $($lg.Name): $($_.Exception.Message)"
        }
    }

    # /r sru replays the 'sru' log stream; /i tolerates the attachment mismatch
    # a snapshot always has; /l /s /d scope log, checkpoint and database
    # lookups to $WorkDir rather than the paths recorded inside the journals.
    $out  = & esentutl.exe /r sru /i /l $WorkDir /s $WorkDir /d $WorkDir 2>&1
    $code = $LASTEXITCODE

    [pscustomobject]@{
        Ok         = ($code -eq 0)
        ExitCode   = $code
        LogsCopied = $copied
        Warnings   = $warnings
        Output     = @($out)
    }
}
