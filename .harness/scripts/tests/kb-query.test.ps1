$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$queryScript = Join-Path $repoRoot ".harness\scripts\kb-query.ps1"
$fingerprintScript = Join-Path $repoRoot ".harness\scripts\lib\source-fingerprint.mjs"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontier-kb-query-test-" + [System.Guid]::NewGuid().ToString("N"))

function Get-SourceFingerprints {
  param([string]$Root)
  $output = & node $fingerprintScript --root $Root --area all --json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "source-fingerprint exited with code ${LASTEXITCODE}: $($output -join "`n")"
  }
  return ($output -join "`n") | ConvertFrom-Json
}

try {
  $defaultRootOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $queryScript -Query "quality gate" -Mode knowledge-qa -Area all -MaxMatches 1 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "kb-query default root failed with code ${LASTEXITCODE}: $($defaultRootOutput -join "`n")"
  }
  if (($defaultRootOutput -join "`n") -notmatch "Frontier KB Query") {
    throw "kb-query default root did not return query output."
  }

  $indexRoot = Join-Path $tempRoot "llm-knowledge\index"
  New-Item -ItemType Directory -Path $indexRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $tempRoot "llm-knowledge\backend") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $tempRoot "llm-knowledge\common") -Force | Out-Null
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $sourceFile = Join-Path $tempRoot "backend\src\main\java\com\frontierscan\article\ArticleController.java"
  $skillFile = Join-Path $tempRoot ".codex\skills\frontier-test\SKILL.md"
  New-Item -ItemType Directory -Path (Split-Path -Parent $sourceFile) -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $skillFile) -Force | Out-Null
  [System.IO.File]::WriteAllText($sourceFile, "class ArticleController {}", $utf8NoBom)
  [System.IO.File]::WriteAllText((Join-Path $tempRoot "AGENTS.md"), "# Fixture rules", $utf8NoBom)
  [System.IO.File]::WriteAllText($skillFile, "# Fixture skill", $utf8NoBom)
  & git -C $tempRoot init --quiet
  & git -C $tempRoot config user.email "fixture@example.com"
  & git -C $tempRoot config user.name "Fixture"
  & git -C $tempRoot add backend AGENTS.md .codex
  & git -C $tempRoot commit --quiet -m "fixture"
  $headHash = (& git -C $tempRoot rev-parse HEAD).Trim()
  $initialFingerprints = Get-SourceFingerprints -Root $tempRoot

  $chunkObjects = @(
    [pscustomobject]@{
      id = "backend:article:overview"
      area = "backend"
      module = "article"
      doc_type = "overview"
      path = "llm-knowledge/backend/modules/article/overview.md"
      text = "ArticleController 中文知识索引"
      source_files = @("backend/src/main/java/com/frontierscan/article/ArticleController.java")
      baseline_status = "fresh"
      semantic_status = "pending"
      keywords = @("ArticleController", "中文")
    },
    [pscustomobject]@{
      id = "backend:llm:overview"
      area = "backend"
      module = "llm"
      doc_type = "overview"
      path = "llm-knowledge/backend/modules/llm/overview.md"
      text = "SummaryQualityEvaluator checks model output quality."
      source_files = @("backend/src/main/java/com/frontierscan/llm/SummaryQualityEvaluator.java")
      baseline_status = "fresh"
      semantic_status = "pending"
      keywords = @("quality", "llm")
    },
    [pscustomobject]@{
      id = "common:quality-gates:conventions"
      area = "common"
      module = "quality-gates"
      doc_type = "conventions"
      path = "llm-knowledge/common/conventions/quality-gates.md"
      text = "Quality Gate Conventions require tests and BLOCKER review findings before delivery."
      source_files = @("llm-knowledge/common/conventions/quality-gates.md")
      baseline_status = "curated"
      semantic_status = "not-applicable"
      keywords = @("quality gate", "review", "test")
    },
    [pscustomobject]@{
      id = "backend:article:interfaces"
      area = "backend"
      module = "article"
      doc_type = "interfaces"
      path = "llm-knowledge/backend/modules/article/interfaces.md"
      text = "GET /api/articles is handled by ArticleController."
      source_files = @("backend/src/main/java/com/frontierscan/article/ArticleController.java")
      baseline_status = "fresh"
      semantic_status = "pending"
      keywords = @("articles", "api")
    }
  )
  $chunks = ConvertTo-Json -InputObject $chunkObjects -Depth 8

  [System.IO.File]::WriteAllText((Join-Path $indexRoot "chunks.json"), $chunks, $utf8NoBom)

  $manifest = [pscustomobject]@{
    schema_version = "1.0"
    git_hash = $headHash
    source_fingerprints = [pscustomobject]@{
      backend = $initialFingerprints.backend.fingerprint
      frontend = $initialFingerprints.frontend.fingerprint
      common = $initialFingerprints.common.fingerprint
    }
    source_fingerprint_status = [pscustomobject]@{
      backend = "complete"
      frontend = "complete"
      common = "complete"
    }
    chunk_count = $chunkObjects.Count
    semantic_status = "pending"
    embeddings_status = "disabled"
  } | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $indexRoot "manifest.json"), $manifest, $utf8NoBom)

  $output = & $queryScript -Root $tempRoot -Query "ArticleController" -Mode api-search -Area backend 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "kb-query exited with code ${LASTEXITCODE}: $($output -join "`n")"
  }

  $joined = $output -join "`n"
  if ($joined -notmatch "Source: llm-knowledge/index/chunks.json") {
    throw "kb-query did not use index source. Output:`n${joined}"
  }
  if ($joined -notmatch "ArticleController") {
    throw "kb-query did not return expected match. Output:`n${joined}"
  }

  $qualityOutput = & $queryScript -Root $tempRoot -Query "quality gate" -Mode knowledge-qa -Area common 2>&1
  $qualityJoined = $qualityOutput -join "`n"
  if ($qualityJoined -notmatch "Index freshness: fresh") {
    throw "kb-query did not surface index freshness. Output:`n${qualityJoined}"
  }
  $qualityMatches = @($qualityOutput | Where-Object { $_ -like "- score=*" })
  if ($qualityMatches.Count -eq 0 -or $qualityMatches[0] -notmatch "area=common.*quality-gates") {
    throw "common quality gate knowledge was not ranked first. Output:`n${qualityJoined}"
  }

  Add-Content -LiteralPath $sourceFile -Value "`n// uncommitted change"
  $dirtyOutput = & $queryScript -Root $tempRoot -Query "ArticleController" -Mode api-search -Area backend 2>&1
  $dirtyJoined = $dirtyOutput -join "`n"
  if ($dirtyJoined -notmatch "Index freshness: stale") {
    throw "kb-query treated dirty backend source as fresh. Output:`n${dirtyJoined}"
  }
  if ($dirtyJoined -notmatch "source fingerprint mismatch") {
    throw "kb-query did not explain the source fingerprint mismatch. Output:`n${dirtyJoined}"
  }

  $dirtyFingerprints = Get-SourceFingerprints -Root $tempRoot
  $manifestObject = Get-Content -LiteralPath (Join-Path $indexRoot "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifestObject.source_fingerprints.backend = $dirtyFingerprints.backend.fingerprint
  [System.IO.File]::WriteAllText(
    (Join-Path $indexRoot "manifest.json"),
    ($manifestObject | ConvertTo-Json -Depth 8),
    $utf8NoBom
  )
  $regeneratedDirtyOutput = & $queryScript -Root $tempRoot -Query "ArticleController" -Mode api-search -Area backend 2>&1
  if (($regeneratedDirtyOutput -join "`n") -notmatch "Index freshness: fresh") {
    throw "Regenerated dirty source did not become fresh. Output:`n$($regeneratedDirtyOutput -join "`n")"
  }

  & git -C $tempRoot add backend
  & git -C $tempRoot commit --quiet -m "commit indexed source"
  $committedOutput = & $queryScript -Root $tempRoot -Query "ArticleController" -Mode api-search -Area backend 2>&1
  if (($committedOutput -join "`n") -notmatch "Index freshness: fresh") {
    throw "Committing identical indexed content changed freshness. Output:`n$($committedOutput -join "`n")"
  }

  New-Item -ItemType Directory -Path (Join-Path $tempRoot "docs") -Force | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $tempRoot "docs\note.md"), "ignored docs change", $utf8NoBom)
  $docsOutput = & $queryScript -Root $tempRoot -Query "ArticleController" -Mode api-search -Area backend 2>&1
  if (($docsOutput -join "`n") -notmatch "Index freshness: fresh") {
    throw "Out-of-scope docs change affected backend freshness. Output:`n$($docsOutput -join "`n")"
  }

  Add-Content -LiteralPath $skillFile -Value "`nchanged"
  $commonDirtyOutput = & $queryScript -Root $tempRoot -Query "quality gate" -Mode knowledge-qa -Area common 2>&1
  $commonDirtyJoined = $commonDirtyOutput -join "`n"
  if ($commonDirtyJoined -notmatch "Index freshness: stale" -or $commonDirtyJoined -notmatch "source fingerprint mismatch") {
    throw "Skill change did not make Common stale. Output:`n${commonDirtyJoined}"
  }
  $backendAfterSkillOutput = & $queryScript -Root $tempRoot -Query "ArticleController" -Mode api-search -Area backend 2>&1
  if (($backendAfterSkillOutput -join "`n") -notmatch "Index freshness: fresh") {
    throw "Skill change incorrectly affected backend freshness. Output:`n$($backendAfterSkillOutput -join "`n")"
  }

  $apiOutput = & $queryScript -Root $tempRoot -Query "articles" -Mode api-search -Area backend 2>&1
  $apiJoined = $apiOutput -join "`n"
  $apiMatches = @($apiOutput | Where-Object { $_ -like "- score=*" })
  if ($apiMatches.Count -eq 0 -or $apiMatches[0] -notmatch "doc=interfaces") {
    throw "api-search did not prioritize interface knowledge. Output:`n${apiJoined}"
  }

  Write-Output "kb-query tests passed"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
