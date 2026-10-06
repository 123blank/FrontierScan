param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Status", "Prepare", "Run", "Materialize", "Test", "Finalize", "Recover")]
  [string]$Command,

  [string]$StateFile,
  [string]$Profile,
  [string]$Model,
  [string]$ExpectedLockSha256,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ($Command -ne "Prepare" -and
    (-not [string]::IsNullOrWhiteSpace($Profile) -or
     -not [string]::IsNullOrWhiteSpace($Model))) {
  throw "Profile and Model are only supported by Prepare."
}
if (($Command -eq "Recover") -ne (-not [string]::IsNullOrWhiteSpace($ExpectedLockSha256))) {
  throw "ExpectedLockSha256 is required by Recover and unsupported by other commands."
}

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$nodeScript = Join-Path $PSScriptRoot "lib\development-provider-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Development Provider runtime not found: ${nodeScript}"
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
if (-not [string]::IsNullOrWhiteSpace($ExpectedLockSha256)) {
  $arguments += @("--expected-lock-sha256", $ExpectedLockSha256)
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
