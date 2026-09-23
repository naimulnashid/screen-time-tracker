<#
    Remove unreferenced <defs> children from a hand-dropped SVG logo.

    This is Inkscape's "Vacuum Defs" (File > Clean Up Document) without
    Inkscape, which is not installed on this machine. It uses .NET's
    System.Xml -- a real parser, and no dependency to install, which matters
    given the rule against native modules that npm run restore would rebuild.

    WHY IT EXISTS. Notepad.svg arrived as a 92,380 byte Inkscape export of
    which 173 of its 177 <defs> children were unreferenced leftovers. That is
    not merely wasteful: measure-logo-colours.ts counts paint DECLARATIONS, so
    it ranked 142 candidates that never render and proposed a pale green for a
    mark that is sky blue. Vacuuming first cut that to 4 candidates.

    WHAT COUNTS AS REACHABLE. A definition is kept when the RENDERED tree
    points at it -- fill="url(#id)", style="filter:url(#id)", href="#id" -- or
    when a kept definition points at it in turn. The seed is deliberately
    taken from outside <defs> only: a reference from one dead cluster to
    another must not keep either alive, or nothing is ever collected. The
    closure matters in practice -- Notepad's body gradient reaches a second
    gradient through xlink:href, and nothing names that one directly.

    ---------------------------------------------------------------------
    VERIFY THE RESULT. Do not skip this.
    ---------------------------------------------------------------------

    Two checks, answering different questions:

      1. STRUCTURAL, done here and automatically. The rendered tree -- every
         element with no <defs> in its ancestry -- must be identical before
         and after, element for element and attribute for attribute. If it is
         not, nothing is written.

      2. VISUAL, done by you. The script writes an HTML page overlaying the
         two renders with mix-blend-mode:difference. Identical output is
         BLACK. Open it and look.

    The second check is not ceremony. The first version of check 1 sliced the
    file from the first "<defs" to the last "</defs>" and compared the rest --
    and Notepad.svg has FIVE defs blocks, one of them nested, so the whole
    middle of the document was cut from both sides and compared equal while
    differing. It reported success on a file that had lost 16 <path> elements.
    Those turned out to be unreferenced too, so the answer was right by luck;
    the check was wrong. A render cannot be fooled that way.

    KNOWN BLIND SPOT. Only attribute values are scanned. A reference living in
    CSS inside a <style> element would be invisible here and its target would
    be deleted, so a document containing <style> or <script> is refused unless
    -Force. Nothing in apps_logo has one today.

    Pure ASCII on purpose: PowerShell 5.1 reads a BOM-less .ps1 as ANSI, and a
    UTF-8 dash decodes to a character it accepts as a string delimiter.

    Usage:
      npm run logo:vacuum -- -Path "public/apps_logo/Thing.svg" -InPlace
      powershell -ExecutionPolicy Bypass -File scripts/vacuum-svg-defs.ps1 -Path in.svg -Out out.svg
#>
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Out = '',
    [switch]$InPlace,
    [string]$VerifyPage = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Resolved in the BODY, never as a param() default: $PSScriptRoot is empty
# until the body runs, so a default built from it expands to a bare filename
# and the failure reads as a missing file rather than an unset variable.
$srcPath = (Resolve-Path -LiteralPath $Path).Path
if ($InPlace) {
    if ($Out) { throw 'Pass -Out or -InPlace, not both.' }
    $Out = $srcPath
} elseif (-not $Out) {
    throw 'Pass -Out <file>, or -InPlace to overwrite the input.'
}
if (-not $VerifyPage) {
    $leaf = [IO.Path]::GetFileNameWithoutExtension($srcPath)
    $VerifyPage = Join-Path $env:TEMP ('vacuum-verify-' + $leaf + '.html')
}

$originalText = [System.IO.File]::ReadAllText($srcPath)

$xml = New-Object System.Xml.XmlDocument
$xml.PreserveWhitespace = $true
$xml.Load($srcPath)

if (-not $Force) {
    foreach ($tag in @('style', 'script')) {
        if ($xml.GetElementsByTagName($tag).Count -gt 0) {
            throw "This file contains a <$tag> element. References hidden in CSS or script are not scanned, so a definition they use would be deleted. Re-run with -Force only after checking by hand."
        }
    }
}

# A signature of the RENDERED tree: every element with no <defs> ancestor.
# Sorted, so sibling order cannot produce a false difference.
function Get-RenderedSignature($doc) {
    $lines = New-Object System.Collections.Generic.List[string]
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push($doc.DocumentElement)
    while ($stack.Count -gt 0) {
        $n = $stack.Pop()
        if ($n.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
        if ($n.LocalName -eq 'defs') { continue }
        $attrs = @()
        if ($n.Attributes) {
            foreach ($a in ($n.Attributes | Sort-Object Name)) {
                $attrs += ($a.Name + '=' + ($a.Value -replace '\s+', ' '))
            }
        }
        $lines.Add($n.LocalName + '|' + ($attrs -join '|'))
        foreach ($c in $n.ChildNodes) { $stack.Push($c) }
    }
    return ($lines | Sort-Object)
}

# Every id-bearing reference an attribute can make.
function Get-Refs($node) {
    $found = New-Object System.Collections.Generic.List[string]
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push($node)
    while ($stack.Count -gt 0) {
        $n = $stack.Pop()
        if ($n.Attributes) {
            foreach ($a in $n.Attributes) {
                foreach ($m in [regex]::Matches($a.Value, 'url\(\s*#([^)\s]+)\s*\)')) {
                    $found.Add($m.Groups[1].Value)
                }
                if ($a.LocalName -eq 'href' -and $a.Value.StartsWith('#')) {
                    $found.Add($a.Value.Substring(1))
                }
            }
        }
        foreach ($c in $n.ChildNodes) { $stack.Push($c) }
    }
    return $found
}

$before = Get-RenderedSignature $xml

# The removable units: id-bearing direct children of any <defs>, including a
# nested one. An id-less child is left alone.
$byId = @{}
foreach ($d in @($xml.GetElementsByTagName('defs'))) {
    foreach ($c in @($d.ChildNodes)) {
        if ($c.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
        $id = $c.GetAttribute('id')
        if ($id) { $byId[$id] = $c }
    }
}

# Seed from the rendered tree only.
$pending = New-Object System.Collections.Generic.Queue[string]
$stack = New-Object System.Collections.Generic.Stack[object]
$stack.Push($xml.DocumentElement)
while ($stack.Count -gt 0) {
    $n = $stack.Pop()
    if ($n.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
    if ($n.LocalName -eq 'defs') { continue }
    if ($n.Attributes) {
        foreach ($a in $n.Attributes) {
            foreach ($m in [regex]::Matches($a.Value, 'url\(\s*#([^)\s]+)\s*\)')) {
                $pending.Enqueue($m.Groups[1].Value)
            }
            if ($a.LocalName -eq 'href' -and $a.Value.StartsWith('#')) {
                $pending.Enqueue($a.Value.Substring(1))
            }
        }
    }
    foreach ($c in $n.ChildNodes) { $stack.Push($c) }
}

$reachable = New-Object System.Collections.Generic.HashSet[string]
while ($pending.Count -gt 0) {
    $id = $pending.Dequeue()
    if (-not $reachable.Add($id)) { continue }
    if ($byId.ContainsKey($id)) {
        foreach ($r in (Get-Refs $byId[$id])) { $pending.Enqueue($r) }
    }
}

$removed = 0
foreach ($id in @($byId.Keys)) {
    if (-not $reachable.Contains($id)) {
        $node = $byId[$id]
        [void]$node.ParentNode.RemoveChild($node)
        $removed++
    }
}

$after = Get-RenderedSignature $xml
if ($null -ne (Compare-Object $before $after)) {
    throw "REFUSING TO WRITE: the rendered tree changed ($($before.Count) elements before, $($after.Count) after). That is a bug in the reachability pass, not a tidier file."
}

# BOM-less. XmlDocument.Save(path) emits a UTF-8 BOM, which the hand-authored
# files here do not have. The SVG readers in scripts/ regex over the whole text
# and would not notice today, but a gratuitous byte at the head of a file is
# how the sampler's JSONL trap started.
#
# NewLineHandling None matters as much as the BOM. The writer otherwise
# rewrites every newline to the platform's, so a source file with LF endings
# comes back CRLF and the whole file reads as changed in the diff -- burying
# the definitions you actually removed.
#
# The one gratuitous difference left is the declaration reading encoding=
# "utf-8" where the source said "UTF-8"; XmlWriter takes that name from the
# Encoding object. XML treats it case-insensitively and nothing here reads it.
$settings = New-Object System.Xml.XmlWriterSettings
$settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$settings.Indent = $false
$settings.NewLineHandling = [System.Xml.NewLineHandling]::None
$tmp = [System.IO.Path]::GetTempFileName()
$writer = [System.Xml.XmlWriter]::Create($tmp, $settings)
try { $xml.Save($writer) } finally { $writer.Close() }
Move-Item -LiteralPath $tmp -Destination $Out -Force

$cleanText = [System.IO.File]::ReadAllText($Out)

# The visual half. Both panes pinned to one explicit size: with height:auto a
# difference in intrinsic sizing shifts one layer and paints the whole outline,
# which looks exactly like lost content and is not.
$template = @'
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>vacuum verification</title>
<style>
  body { background:#333; color:#eee; font:13px system-ui; margin:0; padding:16px }
  .row { display:flex; gap:32px; align-items:flex-start; flex-wrap:wrap }
  .pane { position:relative; width:320px; height:420px }
  .stack { position:relative; width:320px; height:420px; background:#000; isolation:isolate }
  .stack > div { position:absolute; top:0; left:0; width:320px; height:420px }
  .stack > div:nth-child(2) { mix-blend-mode:difference }
  .pane svg, .stack svg { width:320px !important; height:420px !important; display:block; position:absolute; top:0; left:0 }
  h2 { font-size:13px; font-weight:600; margin:10px 0 0 }
</style>
<body>
<p><b>__NAME__</b> -- original __ABYTES__ bytes, vacuumed __BBYTES__ bytes,
   __REMOVED__ of __TOTAL__ definitions removed.</p>
<div class="row">
  <div><div class="pane">__A__</div><h2>original</h2></div>
  <div><div class="pane">__B__</div><h2>vacuumed</h2></div>
  <div><div class="stack"><div>__A__</div><div>__B__</div></div>
       <h2>difference -- black means identical</h2></div>
</div>
<p>A hairline at the outlines is anti-aliasing between the two composited
   layers and is expected. Any solid shape is lost content: do not commit it.</p>
</body>
'@

$html = $template
$html = $html.Replace('__NAME__', [IO.Path]::GetFileName($srcPath))
$html = $html.Replace('__ABYTES__', [string]$originalText.Length)
$html = $html.Replace('__BBYTES__', [string]$cleanText.Length)
$html = $html.Replace('__REMOVED__', [string]$removed)
$html = $html.Replace('__TOTAL__', [string]$byId.Count)
# .Replace(), not -replace: the SVG body is full of characters a regex
# replacement would read as backreferences.
$html = $html.Replace('__A__', ($originalText -replace '<\?xml[^>]*\?>', ''))
$html = $html.Replace('__B__', ($cleanText -replace '<\?xml[^>]*\?>', ''))
[System.IO.File]::WriteAllText($VerifyPage, $html, (New-Object System.Text.UTF8Encoding($false)))

''
"  definitions      : $($byId.Count) -> $($byId.Count - $removed)  ($removed removed)"
"  bytes            : $($originalText.Length) -> $($cleanText.Length)"
"  rendered tree    : $($after.Count) elements, unchanged"
"  wrote            : $Out"
''
'  NOW LOOK AT IT. Open this and confirm the third panel is black:'
"    $VerifyPage"
''
