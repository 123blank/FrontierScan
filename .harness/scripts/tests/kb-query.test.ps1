$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$queryScript = Join-Path $repoRoot ".harness\scripts\kb-query.ps1"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontier-kb-query-test-" + [System.Guid]::NewGuid().ToString("N"))

try {
  $indexRoot = Join-Path $tempRoot "llm-knowledge\index"
  New-Item -ItemType Directory -Path $indexRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $tempRoot "llm-knowledge\backend") -Force | Out-Null

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
    }
  )
  $chunks = ConvertTo-Json -InputObject $chunkObjects -Depth 8

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $indexRoot "chunks.json"), $chunks, $utf8NoBom)

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

  Write-Output "kb-query tests passed"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
