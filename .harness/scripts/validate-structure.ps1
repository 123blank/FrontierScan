param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"

function Get-ManifestList {
  param(
    [string[]]$Lines,
    [string]$Section
  )

  $items = @()
  $inSection = $false

  foreach ($line in $Lines) {
    if ($line -eq "${Section}:") {
      $inSection = $true
      continue
    }

    if ($inSection -and $line -match "^[a-zA-Z_]+:") {
      break
    }

    if ($inSection -and $line -match "^\s+-\s+(.+)$") {
      $items += $Matches[1].Trim()
    }
  }

  return $items
}

function Assert-Exists {
  param(
    [string]$RelativePath,
    [string]$Kind
  )

  $fullPath = Join-Path $Root $RelativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    throw "Missing ${Kind}: ${RelativePath}"
  }
}

function Assert-Json {
  param([string]$RelativePath)

  $fullPath = Join-Path $Root $RelativePath
  try {
    Get-Content -LiteralPath $fullPath -Raw | ConvertFrom-Json | Out-Null
  } catch {
    throw "Invalid JSON: ${RelativePath} ($($_.Exception.Message))"
  }
}

$manifestPath = Join-Path $Root ".harness\structure-manifest.yaml"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing manifest: .harness/structure-manifest.yaml"
}

$manifestLines = Get-Content -LiteralPath $manifestPath
$directories = Get-ManifestList -Lines $manifestLines -Section "required_directories"
$files = Get-ManifestList -Lines $manifestLines -Section "required_files"

foreach ($directory in $directories) {
  Assert-Exists -RelativePath $directory -Kind "directory"
}

foreach ($file in $files) {
  Assert-Exists -RelativePath $file -Kind "file"
}

@(
  ".harness/schemas/product-state.schema.json",
  ".harness/schemas/e2e-state.schema.json",
  ".harness/schemas/active-run.schema.json",
  ".harness/schemas/task-dag.schema.json",
  ".harness/schemas/dispatch-task.schema.json",
  ".harness/schemas/dispatch-result.schema.json",
  ".harness/schemas/worker-policies.schema.json",
  ".harness/schemas/worktree-plan.schema.json",
  ".harness/schemas/worktree-status.schema.json",
  ".codex/agents/worker-policies.json",
  ".harness/states/product-state.template.json",
  ".harness/states/e2e-state.template.json"
) | ForEach-Object {
  Assert-Json -RelativePath $_
}

$skillFiles = Get-ChildItem -LiteralPath (Join-Path $Root ".codex\skills") -Recurse -Filter "SKILL.md"
foreach ($skillFile in $skillFiles) {
  $firstLine = Get-Content -LiteralPath $skillFile.FullName -TotalCount 1
  if ($firstLine -ne "---") {
    throw "Missing Skill frontmatter: $($skillFile.FullName)"
  }
}

Write-Output "Harness structure validation passed."
Write-Output "Directories checked: $($directories.Count)"
Write-Output "Files checked: $($files.Count)"
Write-Output "Skill files checked: $($skillFiles.Count)"
