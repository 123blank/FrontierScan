param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("prepare", "status", "run-adapter", "apply")]
  [string]$Command,

  [string]$StateFile,
  [string]$Adapter,
  [string]$ResultFile,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$nodeScript = Join-Path $PSScriptRoot "lib\story-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Story runtime not found: ${nodeScript}"
}

$arguments = @($nodeScript, $Command, "--root", $Root)
if (-not [string]::IsNullOrWhiteSpace($StateFile)) {
  $arguments += @("--state-file", $StateFile)
}
if (-not [string]::IsNullOrWhiteSpace($Adapter)) {
  $arguments += @("--adapter", $Adapter)
}
if (-not [string]::IsNullOrWhiteSpace($ResultFile)) {
  $arguments += @("--result-file", $ResultFile)
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
$nodeExitCode = $LASTEXITCODE
if ($nodeExitCode -ne 0) {
  exit $nodeExitCode
}
