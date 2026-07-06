param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$Json
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

  $lines = @(Get-Content -LiteralPath $area.meta)
  $recordedHash = Get-MetaValue -Lines $lines -Name "git_hash"
  $generatedAt = Get-MetaValue -Lines $lines -Name "generated_at"
  $status = Get-MetaValue -Lines $lines -Name "status"
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

  if ($sourceChanged) {
    $reasons += "source files have working-tree changes"
  }

  $findings += [pscustomobject]@{
    area = $area.name
    status = if ($reasons.Count -eq 0) { "fresh" } else { "stale-or-incomplete" }
    reason = if ($reasons.Count -eq 0) { "Freshness metadata matches current repository state." } else { $reasons -join "; " }
    recorded_git_hash = $recordedHash
    current_git_hash = $headHash
    source_changed = $sourceChanged
  }
}

if ($Json) {
  [pscustomobject]@{
    root = $Root
    current_git_hash = $headHash
    changed_paths = $changedPaths
    findings = $findings
  } | ConvertTo-Json -Depth 6
  exit 0
}

Write-Output "# FrontierScan Knowledge Freshness Check"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output "HEAD: ${headHash}"
Write-Output ""
Write-Output "| Area | Status | Source Changed | Reason |"
Write-Output "| --- | --- | --- | --- |"
foreach ($finding in $findings) {
  Write-Output "| $($finding.area) | $($finding.status) | $($finding.source_changed) | $($finding.reason) |"
}
