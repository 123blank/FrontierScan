param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$Json,
  [switch]$WriteRefreshTask,
  [string]$RefreshTaskPath
)

$ErrorActionPreference = "Stop"

function Invoke-RepoGit {
  param([string[]]$Arguments)
  & git -C $Root @Arguments
}

function Get-MetaValue {
  param(
    [string[]]$Lines,
    [string]$Name
  )

  foreach ($line in $Lines) {
    if ($line -match "^\s*${Name}:\s*(.*)$") {
      return $Matches[1].Trim().Trim('"')
    }
  }

  return ""
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

  return $path.Trim('"').Replace("\", "/")
}

function Test-AnyChangedPath {
  param(
    [string[]]$Paths,
    [string]$Prefix
  )

  foreach ($path in $Paths) {
    if ($path.StartsWith($Prefix)) {
      return $true
    }
  }

  return $false
}

function Get-ChangedModules {
  param(
    [string[]]$Paths,
    [string]$Area
  )

  $pattern = if ($Area -eq "backend") {
    '^backend/src/main/java/com/frontierscan/([^/]+)/'
  } else {
    '^frontend/src/([^/]+)/'
  }
  return @(
    $Paths |
      ForEach-Object { if ($_ -match $pattern) { $Matches[1] } } |
      Where-Object { $_ } |
      Sort-Object -Unique
  )
}

function Get-RefreshMode {
  param([pscustomobject]$Finding)

  $semanticNeedsRefresh = $Finding.semantic_status -and $Finding.semantic_status -notin @("fresh", "pending")
  $baselineOrIndexNeedsRefresh = $Finding.status -eq "missing-meta" -or
    $Finding.source_changed -or
    [string]::IsNullOrWhiteSpace($Finding.recorded_git_hash) -or
    $Finding.recorded_git_hash -ne $Finding.current_git_hash -or
    ($Finding.baseline_status -and $Finding.baseline_status -ne "fresh") -or
    ($Finding.index_status -and $Finding.index_status -ne "fresh") -or
    $Finding.reason -match "generated_at|knowledge index manifest|index\.git_hash"

  if ($semanticNeedsRefresh -and $baselineOrIndexNeedsRefresh) {
    return "all"
  }
  if ($semanticNeedsRefresh) {
    return "semantic"
  }
  return "baseline"
}

if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
  throw "Root is not a git repository: ${Root}"
}

$headHash = (Invoke-RepoGit -Arguments @("rev-parse", "HEAD")).Trim()
$changedPaths = @(
  Invoke-RepoGit -Arguments @("status", "--short", "--untracked-files=all") |
    ForEach-Object { Get-PathFromStatusLine -Line $_ }
) | Where-Object { $_ } | Sort-Object -Unique

$areas = @(
  [pscustomobject]@{
    name = "backend"
    meta = Join-Path $Root "llm-knowledge\backend\meta.yaml"
    source_prefix = "backend/"
  },
  [pscustomobject]@{
    name = "frontend"
    meta = Join-Path $Root "llm-knowledge\frontend\meta.yaml"
    source_prefix = "frontend/"
  }
)

$findings = @()
foreach ($area in $areas) {
  if (-not (Test-Path -LiteralPath $area.meta)) {
    $findings += [pscustomobject]@{
      area = $area.name
      status = "missing-meta"
      reason = "Meta file is missing."
      recorded_git_hash = ""
      current_git_hash = $headHash
      source_changed = Test-AnyChangedPath -Paths $changedPaths -Prefix $area.source_prefix
    }
    continue
  }

  $lines = @(Get-Content -LiteralPath $area.meta -Encoding UTF8)
  $recordedHash = Get-MetaValue -Lines $lines -Name "git_hash"
  $generatedAt = Get-MetaValue -Lines $lines -Name "generated_at"
  $status = Get-MetaValue -Lines $lines -Name "status"
  $baselineStatus = Get-MetaValue -Lines $lines -Name "baseline_status"
  $semanticStatus = Get-MetaValue -Lines $lines -Name "semantic_status"
  $indexStatus = Get-MetaValue -Lines $lines -Name "index_status"
  $sourceChanged = Test-AnyChangedPath -Paths $changedPaths -Prefix $area.source_prefix

  $reasons = @()
  if ([string]::IsNullOrWhiteSpace($recordedHash)) {
    $reasons += "freshness.git_hash is empty"
  } elseif ($recordedHash -ne $headHash) {
    $reasons += "freshness.git_hash differs from current HEAD"
  }

  if ([string]::IsNullOrWhiteSpace($generatedAt)) {
    $reasons += "freshness.generated_at is empty"
  }

  if ($status -ne "fresh") {
    $reasons += "freshness.status is '${status}'"
  }

  if ($baselineStatus -and $baselineStatus -ne "fresh") {
    $reasons += "baseline_status is '${baselineStatus}'"
  }

  if ($semanticStatus -and $semanticStatus -notin @("fresh", "pending")) {
    $reasons += "semantic_status is '${semanticStatus}'"
  }

  if ($indexStatus -and $indexStatus -ne "fresh") {
    $reasons += "index_status is '${indexStatus}'"
  }

  if ($sourceChanged) {
    $reasons += "source files have working-tree changes"
  }

  $indexManifest = Join-Path $Root "llm-knowledge\index\manifest.json"
  if (-not (Test-Path -LiteralPath $indexManifest)) {
    $reasons += "knowledge index manifest is missing"
  } else {
    try {
      $manifest = Get-Content -LiteralPath $indexManifest -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($manifest.git_hash -ne $headHash) {
        $reasons += "index.git_hash differs from current HEAD"
      }
    } catch {
      $reasons += "knowledge index manifest is invalid"
    }
  }

  $findings += [pscustomobject]@{
    area = $area.name
    status = if ($reasons.Count -eq 0) { "fresh" } else { "stale-or-incomplete" }
    reason = if ($reasons.Count -eq 0) { "Freshness metadata matches current repository state." } else { $reasons -join "; " }
    recorded_git_hash = $recordedHash
    current_git_hash = $headHash
    source_changed = $sourceChanged
    baseline_status = $baselineStatus
    semantic_status = $semanticStatus
    index_status = $indexStatus
  }
}

$refreshTargets = @(
  foreach ($finding in $findings | Where-Object { $_.status -ne "fresh" }) {
    $modules = @(Get-ChangedModules -Paths $changedPaths -Area $finding.area)
    $mode = Get-RefreshMode -Finding $finding
    $command = if ($mode -ne "semantic" -and $modules.Count -eq 1) {
      ".\.harness\scripts\generate-kb.ps1 -Area $($finding.area) -Module $($modules[0]) -Mode $mode"
    } else {
      ".\.harness\scripts\generate-kb.ps1 -Area $($finding.area) -Mode $mode"
    }
    [pscustomobject]@{
      area = $finding.area
      modules = $modules
      mode = $mode
      reason = $finding.reason
      command = $command
    }
  }
)

$refreshTask = [pscustomobject]@{
  schema_version = "1.0"
  generated_by = "frontier-kb-refresh-check"
  generated_at = [DateTime]::UtcNow.ToString("o")
  root = $Root
  current_git_hash = $headHash
  status = if ($refreshTargets.Count -gt 0) { "pending" } else { "not-required" }
  changed_paths = $changedPaths
  targets = $refreshTargets
}

if ($WriteRefreshTask) {
  if ([string]::IsNullOrWhiteSpace($RefreshTaskPath)) {
    $RefreshTaskPath = Join-Path $Root ".harness\outputs\kb-refresh-task.json"
  }
  $refreshTaskDirectory = Split-Path -Parent $RefreshTaskPath
  if ($refreshTaskDirectory) {
    New-Item -ItemType Directory -Path $refreshTaskDirectory -Force | Out-Null
  }
  $refreshTask | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RefreshTaskPath -Encoding UTF8
}

if ($Json) {
  [pscustomobject]@{
    root = $Root
    current_git_hash = $headHash
    changed_paths = $changedPaths
    findings = $findings
    refresh_task = $refreshTask
    refresh_task_path = if ($WriteRefreshTask) { $RefreshTaskPath } else { $null }
  } | ConvertTo-Json -Depth 6
  exit 0
}

Write-Output "# FrontierScan Knowledge Freshness Check"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output "HEAD: ${headHash}"
Write-Output ""
Write-Output "| Area | Status | Baseline | Semantic | Index | Source Changed | Reason |"
Write-Output "| --- | --- | --- | --- | --- | --- | --- |"
foreach ($finding in $findings) {
  Write-Output "| $($finding.area) | $($finding.status) | $($finding.baseline_status) | $($finding.semantic_status) | $($finding.index_status) | $($finding.source_changed) | $($finding.reason) |"
}
