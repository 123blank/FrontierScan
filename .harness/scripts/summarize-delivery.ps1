param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string[]]$OwnedPathPrefix = @(".harness/", ".codex/", "llm-knowledge/", "docs/harness", "AGENTS.md"),
  [switch]$Json
)

$ErrorActionPreference = "Stop"

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

  return $path.Trim('"').Replace("\", "/")
}

function Test-OwnedPath {
  param(
    [string]$Path,
    [string[]]$Prefixes
  )

  foreach ($prefix in $Prefixes) {
    if ($Path.StartsWith($prefix)) {
      return $true
    }
  }

  return $false
}

if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
  throw "Root is not a git repository: ${Root}"
}

$statusLines = @(Invoke-RepoGit -Arguments @("status", "--short", "--untracked-files=all"))
$paths = @(
  $statusLines | ForEach-Object { Get-PathFromStatusLine -Line $_ }
) | Where-Object { $_ } | Sort-Object -Unique

$owned = @()
$unrelated = @()
foreach ($path in $paths) {
  if (Test-OwnedPath -Path $path -Prefixes $OwnedPathPrefix) {
    $owned += $path
  } else {
    $unrelated += $path
  }
}

$result = [pscustomobject]@{
  root = $Root
  owned_path_prefixes = $OwnedPathPrefix
  owned_changes = $owned
  unrelated_dirty_files = $unrelated
  delivery_policy = "This script does not stage, commit, push, create PRs, or rewrite history."
  suggested_next_steps = @(
    "Review owned changes.",
    "Run required test/review/build/interface gates.",
    "Ask for explicit approval before staging or committing.",
    "Stage only owned files after approval."
  )
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6
  exit 0
}

Write-Output "# FrontierScan Delivery Summary"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output ""
Write-Output "## Owned Changes"
if ($owned.Count -eq 0) {
  Write-Output "None."
} else {
  $owned | ForEach-Object { Write-Output "- $_" }
}

Write-Output ""
Write-Output "## Unrelated Dirty Files"
if ($unrelated.Count -eq 0) {
  Write-Output "None."
} else {
  $unrelated | ForEach-Object { Write-Output "- $_" }
}

Write-Output ""
Write-Output "Delivery policy: $($result.delivery_policy)"
