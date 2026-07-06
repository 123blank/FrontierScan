param(
  [Parameter(Mandatory = $true)]
  [string]$Query,

  [ValidateSet("requirement-breakdown", "technical-design", "api-search", "knowledge-qa", "frontend-ui-search", "data-flow-trace")]
  [string]$Mode = "knowledge-qa",

  [ValidateSet("all", "backend", "frontend", "common")]
  [string]$Area = "all",

  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,

  [int]$MaxMatches = 20
)

$ErrorActionPreference = "Stop"

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
    $content = @(Get-Content -LiteralPath $file.FullName -ErrorAction Stop)
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
Write-Output "Candidate files: $($candidateFiles.Count)"

$results = Select-Matches -Files $candidateFiles -Needle $Query -Limit $MaxMatches

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
