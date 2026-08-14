param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Status", "Step", "Apply")]
  [string]$Command,

  [string]$StateFile,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$nodeScript = Join-Path $PSScriptRoot "lib\e2e-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "E2E runtime not found: ${nodeScript}"
}

$arguments = @($nodeScript, $Command.ToLowerInvariant(), "--root", $Root)
if (-not [string]::IsNullOrWhiteSpace($StateFile)) {
  $arguments += @("--state-file", $StateFile)
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
