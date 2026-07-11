param(
  [Parameter(Mandatory = $true)]
  [string]$Query,

  [ValidateSet("requirement-breakdown", "technical-design", "api-search", "knowledge-qa", "frontend-ui-search", "data-flow-trace")]
  [string]$Mode = "knowledge-qa",

  [ValidateSet("all", "backend", "frontend", "common")]
  [string]$Area = "all",

  [string]$Root,

  [int]$MaxMatches = 20
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-KnowledgeRoot {
  param([string]$RepoRoot)

  $knowledgeRoot = Join-Path $RepoRoot "llm-knowledge"
  if (-not (Test-Path -LiteralPath $knowledgeRoot)) {
    throw "Knowledge root not found: ${knowledgeRoot}"
  }

  return $knowledgeRoot
}

function Get-AreaRoots {
  param(
    [string]$KnowledgeRoot,
    [string]$SelectedArea
  )

  if ($SelectedArea -eq "all") {
    return @(
      $KnowledgeRoot,
      (Join-Path $KnowledgeRoot "backend"),
      (Join-Path $KnowledgeRoot "frontend"),
      (Join-Path $KnowledgeRoot "common")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -Unique
  }

  $areaRoot = Join-Path $KnowledgeRoot $SelectedArea
  if (-not (Test-Path -LiteralPath $areaRoot)) {
    throw "Knowledge area not found: ${SelectedArea}"
  }

  return @($areaRoot)
}

function Get-ModeFileHints {
  param([string]$SelectedMode)

  switch ($SelectedMode) {
    "requirement-breakdown" { return @("overview.md", "meta.yaml", "custom.md", "pitfalls.md") }
    "technical-design" { return @("architecture.md", "dependencies.md", "storage.md", "routes.md", "components.md", "api-usage.md", "overview.md") }
    "api-search" { return @("interfaces.md", "api-usage.md", "routes.md") }
    "frontend-ui-search" { return @("routes.md", "components.md", "state.md", "pitfalls.md", "overview.md") }
    "data-flow-trace" { return @("interfaces.md", "storage.md", "api-usage.md", "architecture.md", "dependencies.md") }
    default { return @("*.md", "*.yaml", "*.yml") }
  }
}

function Read-JsonFile {
  param([string]$Path)

  $parsed = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($parsed -is [System.Array]) {
    return $parsed
  }

  return @($parsed)
}

function Get-ModePreferredDocTypes {
  param([string]$SelectedMode)

  switch ($SelectedMode) {
    "requirement-breakdown" { return @("overview", "semantic", "conventions", "pitfalls") }
    "technical-design" { return @("architecture", "dependencies", "storage", "config", "semantic", "overview") }
    "api-search" { return @("interfaces", "api-usage", "routes", "facts") }
    "frontend-ui-search" { return @("routes", "components", "state", "pitfalls", "overview") }
    "data-flow-trace" { return @("interfaces", "api-usage", "storage", "architecture", "dependencies") }
    default { return @("conventions", "semantic", "overview", "architecture", "interfaces") }
  }
}

function Test-IsKnowledgeSourcePath {
  param(
    [string]$Path,
    [string]$SelectedArea
  )

  $normalizedPath = $Path.Replace("\\", "/").Trim('"')
  $isBackend = $normalizedPath.StartsWith("backend/", [System.StringComparison]::OrdinalIgnoreCase)
  $isFrontend = $normalizedPath.StartsWith("frontend/", [System.StringComparison]::OrdinalIgnoreCase)
  $isCommon = $normalizedPath.Equals("AGENTS.md", [System.StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.StartsWith("llm-knowledge/common/", [System.StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.StartsWith(".harness/workflows/", [System.StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.StartsWith(".codex/skills/", [System.StringComparison]::OrdinalIgnoreCase)

  switch ($SelectedArea) {
    "backend" { return $isBackend }
    "frontend" { return $isFrontend }
    "common" { return $isCommon }
    default { return $isBackend -or $isFrontend -or $isCommon }
  }
}

function Get-WorkingTreeSourceChanges {
  param(
    [string]$RepoRoot,
    [string]$SelectedArea
  )

  $statusLines = @(& git -C $RepoRoot -c core.quotepath=false status --short --untracked-files=all 2>$null)
  $relevantPaths = @()
  foreach ($line in $statusLines) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) {
      continue
    }

    $statusPath = $line.Substring(3)
    foreach ($candidatePath in @($statusPath -split " -> ")) {
      if (Test-IsKnowledgeSourcePath -Path $candidatePath -SelectedArea $SelectedArea) {
        $relevantPaths += $candidatePath.Replace("\\", "/").Trim('"')
      }
    }
  }

  return @($relevantPaths | Select-Object -Unique)
}

function Get-IndexFreshness {
  param(
    [string]$KnowledgeRoot,
    [string]$RepoRoot,
    [string]$SelectedArea
  )

  $manifestPath = Join-Path $KnowledgeRoot "index\manifest.json"
  $chunksPath = Join-Path $KnowledgeRoot "index\chunks.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    return [pscustomobject]@{ Status = "missing"; Semantic = "unknown"; Embeddings = "unknown"; Reason = "manifest missing" }
  }

  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $chunks = @(Read-JsonFile -Path $chunksPath)
  } catch {
    return [pscustomobject]@{ Status = "invalid"; Semantic = "unknown"; Embeddings = "unknown"; Reason = $_.Exception.Message }
  }

  $reasons = @()
  if ($manifest.chunk_count -ne $chunks.Count) {
    $reasons += "manifest chunk_count differs from chunks.json"
  }

  if (Test-Path -LiteralPath (Join-Path $RepoRoot ".git")) {
    $head = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
    if ($head -and $manifest.git_hash -and $manifest.git_hash -ne $head) {
      $reasons += "manifest git_hash differs from current HEAD"
    }

    $workingTreeSourceChanges = @(Get-WorkingTreeSourceChanges -RepoRoot $RepoRoot -SelectedArea $SelectedArea)
    if ($workingTreeSourceChanges.Count -gt 0) {
      $reasons += "working-tree source changes: $($workingTreeSourceChanges -join ', ')"
    }
  }

  return [pscustomobject]@{
    Status = if ($reasons.Count -eq 0) { "fresh" } else { "stale" }
    Semantic = if ($manifest.semantic_status) { $manifest.semantic_status } else { "unknown" }
    Embeddings = if ($manifest.embeddings_status) { $manifest.embeddings_status } else { "unknown" }
    Reason = $reasons -join "; "
  }
}

function Select-IndexMatches {
  param(
    [string]$KnowledgeRoot,
    [string]$Needle,
    [string]$SelectedArea,
    [string]$SelectedMode,
    [int]$Limit
  )

  $chunksPath = Join-Path $KnowledgeRoot "index\chunks.json"
  if (-not (Test-Path -LiteralPath $chunksPath)) {
    return @()
  }

  $terms = @(
    $Needle -split "\s+" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )

  if ($terms.Count -eq 0) {
    return @()
  }

  $preferredDocTypes = @(Get-ModePreferredDocTypes -SelectedMode $SelectedMode)

  try {
    $chunks = @(Read-JsonFile -Path $chunksPath)
  } catch {
    throw "Invalid knowledge index: ${chunksPath} ($($_.Exception.Message))"
  }

  $matches = @()
  foreach ($chunk in $chunks) {
    if ($SelectedArea -ne "all" -and $chunk.area -ne $SelectedArea) {
      continue
    }

    $haystack = @(
      $chunk.text,
      $chunk.area,
      $chunk.module,
      $chunk.doc_type,
      (@($chunk.keywords) -join " "),
      (@($chunk.source_files) -join " ")
    ) -join "`n"

    $score = 0
    $matchedTerms = 0
    foreach ($term in $terms) {
      $escaped = [regex]::Escape($term)
      $occurrences = ([regex]::Matches($haystack, $escaped, "IgnoreCase")).Count
      if ($occurrences -gt 0) {
        $matchedTerms += 1
        $score += $occurrences
      }
    }

    if ($matchedTerms -eq $terms.Count) {
      $score += 10
    }

    if ($haystack.IndexOf($Needle.Trim(), [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $score += 20
    }

    $docTypeIndex = [array]::IndexOf($preferredDocTypes, [string]$chunk.doc_type)
    if ($docTypeIndex -ge 0) {
      $score += [Math]::Max(2, 12 - ($docTypeIndex * 2))
    }

    if ($SelectedMode -eq "frontend-ui-search" -and $chunk.area -eq "frontend") {
      $score += 8
    }

    if ($score -le 0) {
      continue
    }

    $preview = (($chunk.text -replace "\s+", " ").Trim())
    if ($preview.Length -gt 180) {
      $preview = $preview.Substring(0, 180) + "..."
    }

    $matches += [pscustomobject]@{
      Score = $score
      Area = $chunk.area
      Module = $chunk.module
      DocType = $chunk.doc_type
      Path = $chunk.path
      BaselineStatus = $chunk.baseline_status
      SemanticStatus = $chunk.semantic_status
      Text = $preview
    }
  }

  return @($matches | Sort-Object Score -Descending | Select-Object -First $Limit)
}

function Get-CandidateFiles {
  param(
    [string[]]$Roots,
    [string[]]$Hints
  )

  $files = @()
  foreach ($rootPath in $Roots) {
    foreach ($hint in $Hints) {
      if ($hint -like "*") {
        $files += Get-ChildItem -LiteralPath $rootPath -Recurse -File -Include $hint -ErrorAction SilentlyContinue
      } else {
        $files += Get-ChildItem -LiteralPath $rootPath -Recurse -File -Filter $hint -ErrorAction SilentlyContinue
      }
    }
  }

  return $files | Sort-Object FullName -Unique
}

function Select-Matches {
  param(
    [System.IO.FileInfo[]]$Files,
    [string]$Needle,
    [int]$Limit
  )

  $terms = @(
    $Needle -split "\s+" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )

  if ($terms.Count -eq 0) {
    return @()
  }

  $queryResults = @()
  foreach ($file in $Files) {
    $content = @(Get-Content -LiteralPath $file.FullName -Encoding UTF8 -ErrorAction Stop)
    $fullText = ($content -join "`n")

    $allTermsFound = $true
    foreach ($term in $terms) {
      if ($fullText -notmatch [regex]::Escape($term)) {
        $allTermsFound = $false
        break
      }
    }

    if (-not $allTermsFound) {
      continue
    }

    for ($i = 0; $i -lt $content.Count; $i++) {
      $line = $content[$i]
      $lineMatchesAnyTerm = $false
      foreach ($term in $terms) {
        if ($line -match [regex]::Escape($term)) {
          $lineMatchesAnyTerm = $true
          break
        }
      }

      if ($lineMatchesAnyTerm) {
        $queryResults += [PSCustomObject]@{
          File = $file.FullName
          Line = $i + 1
          Text = $line.Trim()
        }
        if ($queryResults.Count -ge $Limit) {
          return $queryResults
        }
      }
    }
  }

  return $queryResults
}

$knowledgeRoot = Get-KnowledgeRoot -RepoRoot $Root
$areaRoots = Get-AreaRoots -KnowledgeRoot $knowledgeRoot -SelectedArea $Area
$hints = Get-ModeFileHints -SelectedMode $Mode
$candidateFiles = Get-CandidateFiles -Roots $areaRoots -Hints $hints

Write-Output "Frontier KB Query"
Write-Output "Mode: ${Mode}"
Write-Output "Area: ${Area}"
Write-Output "Query: ${Query}"

$indexResults = @(Select-IndexMatches -KnowledgeRoot $knowledgeRoot -Needle $Query -SelectedArea $Area -SelectedMode $Mode -Limit $MaxMatches)
if ($indexResults.Count -gt 0) {
  $indexFreshness = Get-IndexFreshness -KnowledgeRoot $knowledgeRoot -RepoRoot $Root -SelectedArea $Area
  Write-Output "Source: llm-knowledge/index/chunks.json"
  Write-Output "Index freshness: $($indexFreshness.Status) (semantic=$($indexFreshness.Semantic), embeddings=$($indexFreshness.Embeddings))"
  if ($indexFreshness.Reason) {
    Write-Output "Index freshness reason: $($indexFreshness.Reason)"
  }
  Write-Output "Matches: $($indexResults.Count)"
  foreach ($result in $indexResults) {
    Write-Output "- score=$($result.Score) area=$($result.Area) module=$($result.Module) doc=$($result.DocType) baseline=$($result.BaselineStatus) semantic=$($result.SemanticStatus) path=$($result.Path): $($result.Text)"
  }
  exit 0
}

Write-Output "Source: markdown-fallback"
Write-Output "Candidate files: $($candidateFiles.Count)"

$results = @(Select-Matches -Files $candidateFiles -Needle $Query -Limit $MaxMatches)

if ($results.Count -eq 0) {
  Write-Output "Matches: 0"
  Write-Output "No knowledge match found. Treat this as missing knowledge and verify source files directly."
  exit 0
}

Write-Output "Matches: $($results.Count)"
foreach ($result in $results) {
  $relative = Resolve-Path -LiteralPath $result.File -Relative
  Write-Output "- ${relative}:$($result.Line): $($result.Text)"
}
