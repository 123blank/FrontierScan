param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $Root ".harness\scripts\run-e2e.ps1"
$stateRunner = Join-Path $Root ".harness\scripts\run-state.ps1"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "frontierscan-e2e-cli-$([guid]::NewGuid().ToString('N'))"

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
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  & git -C $temporaryRoot init -b dev | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "E2E CLI fixture git init failed." }
  & git -C $temporaryRoot config user.email "e2e-cli@example.test"
  & git -C $temporaryRoot config user.name "E2E CLI Test"
  Set-Content -LiteralPath (Join-Path $temporaryRoot "seed.txt") -Value "seed" -NoNewline -Encoding utf8
  & git -C $temporaryRoot add seed.txt
  & git -C $temporaryRoot commit -m "seed" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "E2E CLI fixture seed commit failed." }

  foreach ($directory in @(".harness\states", ".harness\workflows", ".codex\agents")) {
    New-Item -ItemType Directory -Path (Join-Path $temporaryRoot $directory) -Force | Out-Null
  }
  Copy-Item -LiteralPath (Join-Path $Root ".harness\states\e2e-state.template.json") `
    -Destination (Join-Path $temporaryRoot ".harness\states\e2e-state.template.json")
  Copy-Item -LiteralPath (Join-Path $Root ".harness\states\e2e-state-v2.template.json") `
    -Destination (Join-Path $temporaryRoot ".harness\states\e2e-state-v2.template.json")
  Copy-Item -LiteralPath (Join-Path $Root ".harness\workflows\e2e-development-v2.yaml") `
    -Destination (Join-Path $temporaryRoot ".harness\workflows\e2e-development-v2.yaml")
  Copy-Item -LiteralPath (Join-Path $Root ".codex\agents\agents.yaml") `
    -Destination (Join-Path $temporaryRoot ".codex\agents\agents.yaml")
  Copy-Item -LiteralPath (Join-Path $Root ".codex\agents\worker-policies.json") `
    -Destination (Join-Path $temporaryRoot ".codex\agents\worker-policies.json")
  & git -C $temporaryRoot add .harness .codex
  & git -C $temporaryRoot commit -m "add harness fixture" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "E2E CLI fixture Harness commit failed." }

  & $stateRunner -Command init -Root $temporaryRoot -StoryId "M7-B-CLI" -Summary "E2E CLI fixture" -Json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "E2E CLI fixture State init failed." }

  $statusJson = (& $runner -Command Status -Root $temporaryRoot -Json | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "E2E CLI Status failed." }
  $status = $statusJson | ConvertFrom-Json
  if ($status.action -ne "prepare" -or $status.phase -ne "requirement" -or $status.storyId -ne "M7-B-CLI") {
    throw "E2E CLI Status returned unexpected JSON."
  }

  $exitCode = Invoke-NegativeCli @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner,
    "-Command", "Unknown", "-Root", $temporaryRoot, "-Json"
  )
  if ($exitCode -eq 0) { throw "E2E CLI accepted an unknown command." }

  $exitCode = Invoke-NegativeCli @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner,
    "-Command", "Status", "-Root", $temporaryRoot, "-UnknownValue", "x", "-Json"
  )
  if ($exitCode -eq 0) { throw "E2E CLI accepted an unknown parameter." }

  $v1StateFile = Join-Path $temporaryRoot ".harness\states\e2e-v1.json"
  Copy-Item -LiteralPath (Join-Path $Root ".harness\states\e2e-state.template.json") -Destination $v1StateFile
  $exitCode = Invoke-NegativeCli @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner,
    "-Command", "Status", "-Root", $temporaryRoot,
    "-StateFile", ".harness/states/e2e-v1.json", "-Json"
  )
  if ($exitCode -eq 0) { throw "E2E CLI did not propagate the Node failure exit code." }

  Write-Output "e2e CLI tests passed"
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
