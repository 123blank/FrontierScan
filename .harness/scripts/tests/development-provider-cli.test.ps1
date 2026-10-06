$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script = Join-Path $root ".harness\scripts\run-development-provider.ps1"
if (-not (Test-Path -LiteralPath $script)) {
  throw "run-development-provider.ps1 is missing."
}

$source = Get-Content -LiteralPath $script -Raw
if ($source -notmatch 'ValidateSet\("Status", "Prepare", "Run", "Materialize", "Test", "Finalize", "Recover"\)') {
  throw "run-development-provider.ps1 must expose only the seven Development Provider commands."
}
foreach ($parameter in @("StateFile", "Profile", "Model", "ExpectedLockSha256", "Root")) {
  if ($source -notmatch "\[string\]\`$$parameter") {
    throw "run-development-provider.ps1 is missing parameter $parameter."
  }
}
if ($source -notmatch '\[switch\]\$Json') {
  throw "run-development-provider.ps1 is missing the Json switch."
}
foreach ($forbiddenParameter in @(
  "WorktreePath",
  "Sandbox",
  "Executable",
  "Argv",
  "CommandLine",
  "Shell",
  "Cwd",
  "CandidatePath",
  "TestCommand",
  "IntegrationTarget",
  "Timeout"
)) {
  if ($source -match "\`$$forbiddenParameter\b") {
    throw "run-development-provider.ps1 must not expose $forbiddenParameter."
  }
}
foreach ($expected in @(
  "Profile and Model are only supported by Prepare.",
  "ExpectedLockSha256 is required by Recover and unsupported by other commands.",
  "development-provider-runtime.mjs",
  "--state-file",
  "--profile",
  "--model",
  "--expected-lock-sha256",
  "--json"
)) {
  if ($source -notmatch [regex]::Escape($expected)) {
    throw "run-development-provider.ps1 is missing expected behavior: $expected"
  }
}

Write-Output "development provider CLI tests passed"
