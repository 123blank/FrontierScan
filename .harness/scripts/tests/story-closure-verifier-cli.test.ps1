param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $Root ".harness\scripts\verify-story-closure.ps1"
$helperPath = (Resolve-Path (Join-Path $PSScriptRoot "story-closure-verifier.test.mjs")).Path
$helperUrl = ([System.Uri]$helperPath).AbsoluteUri
$fixture = $null

function Invoke-NegativeCli {
  param([string[]]$Arguments)

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & powershell.exe @Arguments 2>$null | Out-Null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

try {
  $fixtureJson = & node --input-type=module -e @"
import { createCompletedFixture } from '$helperUrl';
const fixture = await createCompletedFixture();
console.log(JSON.stringify({ root: fixture.root, stateFile: fixture.stateFile }));
"@
  if ($LASTEXITCODE -ne 0) { throw "Closure CLI fixture creation failed." }
  $fixture = $fixtureJson | ConvertFrom-Json

  $resultJson = (& $runner -Root $fixture.root -StateFile $fixture.stateFile -Json | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Closure CLI positive verification failed." }
  $result = $resultJson | ConvertFrom-Json
  if ($result.status -ne "passed" -or $result.storyId -ne "M7-D-CLOSURE") {
    throw "Closure CLI returned unexpected JSON."
  }

  $exitCode = Invoke-NegativeCli @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner,
    "-Root", $fixture.root, "-StateFile", ".harness/states/../../outside.json", "-Json"
  )
  if ($exitCode -eq 0) { throw "Closure CLI accepted a path escape." }

  $exitCode = Invoke-NegativeCli @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner,
    "-Root", $fixture.root, "-StateFile", $fixture.stateFile, "-UnknownValue", "x", "-Json"
  )
  if ($exitCode -eq 0) { throw "Closure CLI accepted an unknown parameter." }

  Write-Output "story closure verifier CLI tests passed"
} finally {
  if ($fixture -and (Test-Path -LiteralPath $fixture.root)) {
    Remove-Item -LiteralPath $fixture.root -Recurse -Force
  }
}
