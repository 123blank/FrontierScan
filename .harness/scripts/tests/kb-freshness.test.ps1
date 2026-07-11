$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$freshnessScript = Join-Path $repoRoot ".harness\scripts\check-kb-freshness.ps1"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontier-kb-freshness-test-" + [System.Guid]::NewGuid().ToString("N"))
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8File {
  param([string]$Path, [string]$Content)
  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  Write-Utf8File -Path (Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\Article.java") -Content "class Article {}"
  Write-Utf8File -Path (Join-Path $tempRoot "frontend\src\views\Dashboard.vue") -Content "<template />"

  & git -C $tempRoot init --quiet
  & git -C $tempRoot config user.email "fixture@example.com"
  & git -C $tempRoot config user.name "Fixture"
  & git -C $tempRoot add backend frontend
  & git -C $tempRoot commit --quiet -m "fixture"
  $headHash = (& git -C $tempRoot rev-parse HEAD).Trim()

  $metaTemplate = @"
schema_version: "2.0"
generated_at: "2026-07-11T00:00:00.000Z"
git_hash: "$headHash"
status: fresh
baseline_status: fresh
semantic_status: pending
index_status: fresh
"@
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\backend\meta.yaml") -Content $metaTemplate
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\frontend\meta.yaml") -Content $metaTemplate
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\index\manifest.json") -Content (@{
      git_hash = $headHash
      semantic_status = "pending"
      embeddings_status = "skipped"
    } | ConvertTo-Json)

  Add-Content -LiteralPath (Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\Article.java") -Value "`n// changed"
  $taskPath = Join-Path $tempRoot ".harness\outputs\kb-refresh-task.json"
  $output = & $freshnessScript -Root $tempRoot -Json -WriteRefreshTask -RefreshTaskPath $taskPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "check-kb-freshness exited with code ${LASTEXITCODE}: $($output -join "`n")"
  }
  if (-not (Test-Path -LiteralPath $taskPath)) {
    throw "Refresh task was not written: ${taskPath}"
  }

  $task = Get-Content -LiteralPath $taskPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($task.status -ne "pending") {
    throw "Expected pending refresh task status, got '$($task.status)'."
  }
  $backendTask = @($task.targets | Where-Object { $_.area -eq "backend" })[0]
  if (-not $backendTask) {
    throw "Backend refresh target was not generated."
  }
  if (@($backendTask.modules) -notcontains "article") {
    throw "Backend refresh target did not identify article module."
  }
  if ($backendTask.command -notmatch '-Area backend -Module article -Mode baseline') {
    throw "Backend refresh command is not module scoped: $($backendTask.command)"
  }
  if (@($task.targets | Where-Object { $_.area -eq "frontend" }).Count -ne 0) {
    throw "Fresh frontend area must not receive a refresh target."
  }

  & git -C $tempRoot restore backend
  $semanticFailureMeta = $metaTemplate.Replace("semantic_status: pending", "semantic_status: failed")
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\backend\meta.yaml") -Content $semanticFailureMeta
  $semanticTaskPath = Join-Path $tempRoot ".harness\outputs\kb-semantic-refresh-task.json"
  $semanticOutput = & $freshnessScript -Root $tempRoot -Json -WriteRefreshTask -RefreshTaskPath $semanticTaskPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Semantic freshness check exited with code ${LASTEXITCODE}: $($semanticOutput -join "`n")"
  }

  $semanticTask = Get-Content -LiteralPath $semanticTaskPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $semanticBackendTask = @($semanticTask.targets | Where-Object { $_.area -eq "backend" })[0]
  if (-not $semanticBackendTask) {
    throw "Semantic failure did not generate a backend refresh target."
  }
  if ($semanticBackendTask.mode -ne "semantic") {
    throw "Semantic failure generated mode '$($semanticBackendTask.mode)' instead of semantic."
  }
  if ($semanticBackendTask.command -notmatch '-Area backend -Mode semantic') {
    throw "Semantic failure generated an incorrect refresh command: $($semanticBackendTask.command)"
  }
  if ($semanticBackendTask.command -match '-Mode baseline') {
    throw "Semantic failure cannot be repaired by a baseline-only refresh: $($semanticBackendTask.command)"
  }

  Write-Output "kb-freshness tests passed"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
