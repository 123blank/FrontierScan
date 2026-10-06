param(
  [Parameter(Mandatory = $true)]
  [string]$StateFile,

  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$nodeScript = Join-Path $PSScriptRoot "lib\story-closure-verifier.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Story closure verifier not found: ${nodeScript}"
}

$arguments = @($nodeScript, "--root", $Root, "--state-file", $StateFile)
if ($Json) {
  $arguments += "--json"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
