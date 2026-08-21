$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script = Join-Path $root ".harness\scripts\run-provider.ps1"
if (-not (Test-Path -LiteralPath $script)) {
  throw "run-provider.ps1 is missing."
}

$source = Get-Content -LiteralPath $script -Raw
if ($source -notmatch 'ValidateSet\("Status", "Prepare", "Run", "Materialize"\)') {
  throw "run-provider.ps1 must expose only Status, Prepare, Run, and Materialize."
}
foreach ($parameter in @("StateFile", "Profile", "Model", "Root")) {
  if ($source -notmatch "\[string\]\`$$parameter") {
    throw "run-provider.ps1 is missing parameter $parameter."
  }
}
if ($source -notmatch '\[switch\]\$Json') {
  throw "run-provider.ps1 is missing the Json switch."
}
foreach ($forbiddenParameter in @(
  "Adapter",
  "Executable",
  "Argv",
  "Prompt",
  "ContextPath",
  "Timeout",
  "OutputPath"
)) {
  if ($source -match "\`$$forbiddenParameter\b") {
    throw "run-provider.ps1 must not expose $forbiddenParameter."
  }
}
foreach ($expected in @(
  "Profile and Model are only supported by Prepare.",
  "provider-runtime.mjs",
  "--state-file",
  "--profile",
  "--model",
  "--json"
)) {
  if ($source -notmatch [regex]::Escape($expected)) {
    throw "run-provider.ps1 is missing expected behavior: $expected"
  }
}

Write-Output "provider CLI tests passed"
