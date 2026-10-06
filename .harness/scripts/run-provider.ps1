param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Status", "Prepare", "Run", "Materialize")]
  [string]$Command,

  [string]$StateFile,
  [string]$Profile,
  [string]$Model,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ($Command -ne "Prepare" -and
    (-not [string]::IsNullOrWhiteSpace($Profile) -or
     -not [string]::IsNullOrWhiteSpace($Model))) {
  throw "Profile and Model are only supported by Prepare."
}

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$nodeScript = Join-Path $PSScriptRoot "lib\provider-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Provider runtime not found: ${nodeScript}"
}

$arguments = @($nodeScript, $Command.ToLowerInvariant(), "--root", $Root)
if (-not [string]::IsNullOrWhiteSpace($StateFile)) {
  $arguments += @("--state-file", $StateFile)
}
if (-not [string]::IsNullOrWhiteSpace($Profile)) {
  $arguments += @("--profile", $Profile)
}
if (-not [string]::IsNullOrWhiteSpace($Model)) {
  $arguments += @("--model", $Model)
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
