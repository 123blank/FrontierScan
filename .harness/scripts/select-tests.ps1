param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string[]]$ChangedFile = @(),
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
  throw "Root is not a git repository: ${Root}"
}

function Invoke-RepoGit {
  param([string[]]$Arguments)
  & git -C $Root @Arguments
}

function Get-PathFromStatusLine {
  param([string]$Line)

  if ($Line -notmatch "^\s*(\S{1,2})\s+(.+)$") {
    return $null
  }

  $path = $Matches[2].Trim()
  if ($path -match "\s+->\s+") {
    $path = ($path -split "\s+->\s+")[-1]
  }

  return $path.Trim('"')
}

function Test-AnyPath {
  param(
    [string[]]$Paths,
    [string[]]$Prefixes
  )

  foreach ($path in $Paths) {
    $normalized = ($path -replace "\\", "/").TrimStart("/")
    foreach ($prefix in $Prefixes) {
      if ($normalized.StartsWith($prefix)) {
        return $true
      }
    }
  }

  return $false
}

if ($ChangedFile.Count -eq 0) {
  $ChangedFile = @(
    Invoke-RepoGit -Arguments @("status", "--short", "--untracked-files=all") |
      ForEach-Object { Get-PathFromStatusLine -Line $_ }
  ) | Where-Object { $_ } | Sort-Object -Unique
}

$paths = @($ChangedFile | Sort-Object -Unique)
$recommendations = @()

$hasBackend = Test-AnyPath -Paths $paths -Prefixes @("backend/")
$hasFrontend = Test-AnyPath -Paths $paths -Prefixes @("frontend/")
$hasHarness = Test-AnyPath -Paths $paths -Prefixes @(".harness/", ".codex/skills/", ".codex/agents/", "llm-knowledge/", "docs/harness")
$hasState = Test-AnyPath -Paths $paths -Prefixes @(".harness/states/", ".harness/schemas/")
$hasDag = Test-AnyPath -Paths $paths -Prefixes @(".harness/templates/task-dag", ".harness/schemas/task-dag")

if ($hasBackend) {
  $recommendations += [pscustomobject]@{
    Gate = "backend-tests"
    Command = "Set-Location '${Root}\backend'; mvn test"
    Reason = "Backend files changed."
  }
}

if ($hasFrontend) {
  $recommendations += [pscustomobject]@{
    Gate = "frontend-build"
    Command = "Set-Location '${Root}\frontend'; npm run build"
    Reason = "Frontend files changed."
  }
}

if ($hasHarness) {
  $recommendations += [pscustomobject]@{
    Gate = "harness-structure"
    Command = "& '${Root}\.harness\scripts\validate-structure.ps1' -Root '${Root}'"
    Reason = "Harness, Skill, Agent, docs, or knowledge files changed."
  }
}

if ($hasState) {
  $recommendations += [pscustomobject]@{
    Gate = "harness-state"
    Command = "Get-ChildItem '${Root}\.harness\states' -Filter *.json | ForEach-Object { & '${Root}\.harness\scripts\validate-state.ps1' -StateFile `$_.FullName }"
    Reason = "Harness state or schema files changed."
  }
}

if ($hasDag) {
  $recommendations += [pscustomobject]@{
    Gate = "task-dag"
    Command = "& '${Root}\.harness\scripts\validate-task-dag.ps1' -TaskDagFile '${Root}\.harness\templates\task-dag.example.json'"
    Reason = "Task DAG schema or template files changed."
  }
}

if ($recommendations.Count -eq 0) {
  $recommendations += [pscustomobject]@{
    Gate = "manual-inspection"
    Command = "git -C '${Root}' status --short"
    Reason = "No backend, frontend, or Harness paths detected."
  }
}

if ($Json) {
  [pscustomobject]@{
    root = $Root
    changed_files = $paths
    recommendations = $recommendations
  } | ConvertTo-Json -Depth 5
  exit 0
}

Write-Output "# FrontierScan Test Selection"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output ""
Write-Output "## Changed Files"
if ($paths.Count -eq 0) {
  Write-Output "None."
} else {
  $paths | ForEach-Object { Write-Output "- $_" }
}

Write-Output ""
Write-Output "## Recommended Gates"
$recommendations | Format-Table -AutoSize
