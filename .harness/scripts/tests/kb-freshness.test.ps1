$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$freshnessScript = Join-Path $repoRoot ".harness\scripts\check-kb-freshness.ps1"
$fingerprintScript = Join-Path $repoRoot ".harness\scripts\lib\source-fingerprint.mjs"
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

function Get-SourceFingerprints {
  param([string]$Root)
  $output = & node $fingerprintScript --root $Root --area all --json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "source-fingerprint exited with code ${LASTEXITCODE}: $($output -join "`n")"
  }
  return ($output -join "`n") | ConvertFrom-Json
}

function New-MetaContent {
  param(
    [string]$GitHash,
    [string]$SourceFingerprint,
    [string]$SemanticStatus = "pending"
  )
  return @"
schema_version: "2.0"
generated_at: "2026-07-11T00:00:00.000Z"
git_hash: "$GitHash"
source_fingerprint: "$SourceFingerprint"
source_fingerprint_status: complete
status: fresh
baseline_status: fresh
semantic_status: $SemanticStatus
index_status: fresh
"@
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  Write-Utf8File -Path (Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\Article.java") -Content "class Article {}"
  Write-Utf8File -Path (Join-Path $tempRoot "backend\src\main\resources\application.yml") -Content "app: fixture"
  Write-Utf8File -Path (Join-Path $tempRoot "frontend\src\views\Dashboard.vue") -Content "<template />"
  Write-Utf8File -Path (Join-Path $tempRoot "AGENTS.md") -Content "# Fixture rules"
  $skillFile = Join-Path $tempRoot ".codex\skills\frontier-test\SKILL.md"
  Write-Utf8File -Path $skillFile -Content "# Fixture skill"

  & git -C $tempRoot init --quiet
  & git -C $tempRoot config user.email "fixture@example.com"
  & git -C $tempRoot config user.name "Fixture"
  & git -C $tempRoot add backend frontend AGENTS.md .codex
  & git -C $tempRoot commit --quiet -m "fixture"
  $headHash = (& git -C $tempRoot rev-parse HEAD).Trim()
  $initialFingerprints = Get-SourceFingerprints -Root $tempRoot
  $backendMeta = New-MetaContent -GitHash $headHash -SourceFingerprint $initialFingerprints.backend.fingerprint
  $frontendMeta = New-MetaContent -GitHash $headHash -SourceFingerprint $initialFingerprints.frontend.fingerprint
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\backend\meta.yaml") -Content $backendMeta
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\frontend\meta.yaml") -Content $frontendMeta
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\index\manifest.json") -Content (@{
      git_hash = $headHash
      source_fingerprints = @{
        backend = $initialFingerprints.backend.fingerprint
        frontend = $initialFingerprints.frontend.fingerprint
        common = $initialFingerprints.common.fingerprint
      }
      source_fingerprint_status = @{
        backend = "complete"
        frontend = "complete"
        common = "complete"
      }
      semantic_status = "pending"
      embeddings_status = "skipped"
    } | ConvertTo-Json -Depth 8)

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
  if ($backendTask.reason -notmatch 'source fingerprint mismatch') {
    throw "Backend refresh task did not explain the fingerprint mismatch: $($backendTask.reason)"
  }
  if (@($task.targets | Where-Object { $_.area -eq "frontend" }).Count -ne 0) {
    throw "Fresh frontend area must not receive a refresh target."
  }

  Add-Content -LiteralPath (Join-Path $tempRoot "backend\src\main\resources\application.yml") -Value "`nchanged: true"
  $sharedSourceOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Shared-source freshness check exited with code ${LASTEXITCODE}: $($sharedSourceOutput -join "`n")"
  }
  $sharedSourceResult = ($sharedSourceOutput -join "`n") | ConvertFrom-Json
  $sharedSourceTask = @($sharedSourceResult.refresh_task.targets | Where-Object { $_.area -eq "backend" })[0]
  if ($sharedSourceTask.command -notmatch '-Area backend -Mode baseline') {
    throw "Shared backend source change did not fall back to area baseline refresh: $($sharedSourceTask.command)"
  }
  if ($sharedSourceTask.command -match '-Module article') {
    throw "Shared backend source change generated a non-converging module refresh: $($sharedSourceTask.command)"
  }
  & git -C $tempRoot restore backend/src/main/resources/application.yml

  Remove-Item -LiteralPath (Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\Article.java") -Force
  $deletedModuleOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Deleted module freshness check exited with code ${LASTEXITCODE}: $($deletedModuleOutput -join "`n")"
  }
  $deletedModuleResult = ($deletedModuleOutput -join "`n") | ConvertFrom-Json
  $deletedModuleTask = @($deletedModuleResult.refresh_task.targets | Where-Object { $_.area -eq "backend" })[0]
  if (-not $deletedModuleTask) {
    throw "Deleted backend module did not generate a refresh target."
  }
  if ($deletedModuleTask.command -notmatch '-Area backend -Mode baseline') {
    throw "Deleted backend module did not fall back to area baseline refresh: $($deletedModuleTask.command)"
  }
  if ($deletedModuleTask.command -match '-Module article') {
    throw "Deleted backend module generated an unusable module refresh command: $($deletedModuleTask.command)"
  }

  & git -C $tempRoot restore backend

  $articleSource = Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\Article.java"
  $renamedSource = Join-Path $tempRoot "backend\src\main\java\com\frontierscan\digest\Article.java"
  New-Item -ItemType Directory -Path (Split-Path -Parent $renamedSource) -Force | Out-Null
  Move-Item -LiteralPath $articleSource -Destination $renamedSource
  & git -C $tempRoot add -A backend
  $renamedModuleOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Renamed module freshness check exited with code ${LASTEXITCODE}: $($renamedModuleOutput -join "`n")"
  }
  $renamedModuleResult = ($renamedModuleOutput -join "`n") | ConvertFrom-Json
  $renamedModuleTask = @($renamedModuleResult.refresh_task.targets | Where-Object { $_.area -eq "backend" })[0]
  if (-not $renamedModuleTask) {
    throw "Renamed backend module did not generate a refresh target."
  }
  if ($renamedModuleTask.command -notmatch '-Area backend -Mode baseline') {
    throw "Renamed backend module did not fall back to area baseline refresh: $($renamedModuleTask.command)"
  }
  if ($renamedModuleTask.command -match '-Module digest') {
    throw "Renamed backend module generated a stale-module-preserving refresh command: $($renamedModuleTask.command)"
  }
  & git -C $tempRoot restore --staged backend
  & git -C $tempRoot restore backend
  $renamedDirectory = Split-Path -Parent $renamedSource
  if (Test-Path -LiteralPath $renamedDirectory) {
    Remove-Item -LiteralPath $renamedDirectory -Recurse -Force
  }

  $semanticFailureMeta = New-MetaContent -GitHash $headHash -SourceFingerprint $initialFingerprints.backend.fingerprint -SemanticStatus "failed"
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

  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\backend\meta.yaml") -Content $backendMeta
  Add-Content -LiteralPath (Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\Article.java") -Value "`n// indexed dirty change"
  $dirtyFingerprints = Get-SourceFingerprints -Root $tempRoot
  $dirtyBackendMeta = New-MetaContent -GitHash $headHash -SourceFingerprint $dirtyFingerprints.backend.fingerprint
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\backend\meta.yaml") -Content $dirtyBackendMeta
  $manifestPath = Join-Path $tempRoot "llm-knowledge\index\manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifest.source_fingerprints.backend = $dirtyFingerprints.backend.fingerprint
  Write-Utf8File -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 8)

  $dirtyIndexedOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  $dirtyIndexed = ($dirtyIndexedOutput -join "`n") | ConvertFrom-Json
  if (@($dirtyIndexed.refresh_task.targets | Where-Object { $_.area -eq "backend" }).Count -ne 0) {
    throw "Regenerated dirty backend incorrectly requires refresh: $($dirtyIndexedOutput -join "`n")"
  }

  & git -C $tempRoot add backend
  & git -C $tempRoot commit --quiet -m "commit indexed source"
  $committedOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  $committed = ($committedOutput -join "`n") | ConvertFrom-Json
  if (@($committed.refresh_task.targets | Where-Object { $_.area -eq "backend" }).Count -ne 0) {
    throw "Committing identical indexed source changed freshness: $($committedOutput -join "`n")"
  }

  Add-Content -LiteralPath $skillFile -Value "`nchanged"
  $commonOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  $commonResult = ($commonOutput -join "`n") | ConvertFrom-Json
  $commonTask = @($commonResult.refresh_task.targets | Where-Object { $_.area -eq "common" })[0]
  if (-not $commonTask) {
    throw "Common Skill change did not generate a refresh target: $($commonOutput -join "`n")"
  }
  if ($commonTask.command -notmatch '-Area all -Mode baseline') {
    throw "Common refresh command is not repairable: $($commonTask.command)"
  }
  if (@($commonResult.refresh_task.targets | Where-Object { $_.area -eq "backend" }).Count -ne 0) {
    throw "Common Skill change incorrectly affected backend freshness."
  }

  Write-Utf8File -Path (Join-Path $tempRoot "frontend\src\theme\only.scss") -Content ".theme { color: red; }"
  $unsupportedModuleOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Unsupported-module freshness check exited with code ${LASTEXITCODE}: $($unsupportedModuleOutput -join "`n")"
  }
  $unsupportedModuleResult = ($unsupportedModuleOutput -join "`n") | ConvertFrom-Json
  $unsupportedModuleTask = @($unsupportedModuleResult.refresh_task.targets | Where-Object { $_.area -eq "frontend" })[0]
  if ($unsupportedModuleTask.command -notmatch '-Area frontend -Mode baseline') {
    throw "Unsupported frontend module did not fall back to area baseline refresh: $($unsupportedModuleTask.command)"
  }
  if ($unsupportedModuleTask.command -match '-Module theme') {
    throw "Unsupported SCSS-only module generated an unusable module refresh: $($unsupportedModuleTask.command)"
  }

  Remove-Item -LiteralPath (Join-Path $tempRoot "frontend\src\theme\only.scss") -Force
  Write-Utf8File -Path (Join-Path $tempRoot "frontend\src\legacy\only.js") -Content "export const legacy = true;"
  $javascriptModuleOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "JavaScript-module freshness check exited with code ${LASTEXITCODE}: $($javascriptModuleOutput -join "`n")"
  }
  $javascriptModuleResult = ($javascriptModuleOutput -join "`n") | ConvertFrom-Json
  $javascriptModuleTask = @($javascriptModuleResult.refresh_task.targets | Where-Object { $_.area -eq "frontend" })[0]
  if ($javascriptModuleTask.command -notmatch '-Area frontend -Module legacy -Mode baseline') {
    throw "Supported JavaScript-only module did not receive a module refresh: $($javascriptModuleTask.command)"
  }

  $legacyBackendMeta = $dirtyBackendMeta -replace '(?m)^source_fingerprint:.*\r?\n', ''
  Write-Utf8File -Path (Join-Path $tempRoot "llm-knowledge\backend\meta.yaml") -Content $legacyBackendMeta
  $legacyOutput = & $freshnessScript -Root $tempRoot -Json 2>&1
  $legacyResult = ($legacyOutput -join "`n") | ConvertFrom-Json
  $legacyBackendTask = @($legacyResult.refresh_task.targets | Where-Object { $_.area -eq "backend" })[0]
  if (-not $legacyBackendTask -or $legacyBackendTask.mode -ne "baseline") {
    throw "Legacy metadata without fingerprint did not produce a baseline migration task."
  }

  Write-Output "kb-freshness tests passed"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
