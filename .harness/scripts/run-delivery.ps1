param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("PrepareManifest", "Summarize", "Record")]
  [string]$Command,

  [string]$StateFile,
  [string]$Commit,
  [string]$Remote,
  [string]$Ref,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

if ($Command -eq "Summarize" -and
    (-not [string]::IsNullOrWhiteSpace($Commit) -or
     -not [string]::IsNullOrWhiteSpace($Remote) -or
     -not [string]::IsNullOrWhiteSpace($Ref))) {
  throw "Summarize does not accept Commit, Remote, or Ref."
}
if ($Command -eq "PrepareManifest" -and
    (-not [string]::IsNullOrWhiteSpace($Commit) -or
     -not [string]::IsNullOrWhiteSpace($Remote) -or
     -not [string]::IsNullOrWhiteSpace($Ref))) {
  throw "PrepareManifest does not accept Commit, Remote, or Ref."
}
if ($Command -eq "Record" -and [string]::IsNullOrWhiteSpace($StateFile)) {
  throw "Record requires StateFile."
}
if ((-not [string]::IsNullOrWhiteSpace($Remote) -or -not [string]::IsNullOrWhiteSpace($Ref)) -and
    [string]::IsNullOrWhiteSpace($Commit)) {
  throw "Remote and Ref require Commit."
}
if ([string]::IsNullOrWhiteSpace($Remote) -ne [string]::IsNullOrWhiteSpace($Ref)) {
  throw "Remote and Ref must be provided together."
}

$nodeScript = Join-Path $PSScriptRoot "lib\delivery-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Delivery runtime not found: ${nodeScript}"
}

$nodeCommand = switch ($Command) {
  "PrepareManifest" { "prepare-manifest" }
  "Summarize" { "summarize" }
  "Record" { "record" }
}
$arguments = @($nodeScript, $nodeCommand, "--root", $Root)
if (-not [string]::IsNullOrWhiteSpace($StateFile)) {
  $arguments += @("--state-file", $StateFile)
}
if (-not [string]::IsNullOrWhiteSpace($Commit)) {
  $arguments += @("--commit", $Commit)
}
if (-not [string]::IsNullOrWhiteSpace($Remote)) {
  $arguments += @("--remote", $Remote)
}
if (-not [string]::IsNullOrWhiteSpace($Ref)) {
  $arguments += @("--ref", $Ref)
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
