$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script = Join-Path $root ".harness\scripts\run-delivery.ps1"
$source = Get-Content -LiteralPath $script -Raw

if ($source -notmatch 'ValidateSet\("PrepareManifest", "Summarize", "Record"\)') {
  throw "run-delivery.ps1 must expose only PrepareManifest, Summarize, and Record."
}
if ($source -match 'git\s+(add|commit|push|checkout|reset|merge|rebase)') {
  throw "run-delivery.ps1 must not contain Git write commands."
}
foreach ($parameter in @("Commit", "Remote", "Ref", "StateFile")) {
  if ($source -notmatch "\[string\]\`$$parameter") {
    throw "run-delivery.ps1 is missing parameter $parameter."
  }
}

$summarySource = Get-Content -LiteralPath (Join-Path $root ".harness\scripts\summarize-delivery.ps1") -Raw
if ($summarySource -notmatch '\[string\]\$StateFile') {
  throw "summarize-delivery.ps1 must accept StateFile."
}
if ($summarySource -notmatch 'delivery-runtime\.mjs') {
  throw "summarize-delivery.ps1 State mode must use delivery Runtime."
}

foreach ($expected in @(
  'Summarize does not accept Commit, Remote, or Ref',
  'PrepareManifest does not accept Commit, Remote, or Ref',
  'Record requires StateFile',
  'Remote and Ref require Commit'
)) {
  if ($source -notmatch [regex]::Escape($expected)) {
    throw "run-delivery.ps1 is missing strict argument validation: $expected"
  }
}

Write-Output "delivery CLI tests passed"
