param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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

$statusLines = @(Invoke-RepoGit -Arguments @("status", "--short", "--untracked-files=all"))
$changedFiles = @(
  $statusLines | ForEach-Object { Get-PathFromStatusLine -Line $_ }
) | Where-Object { $_ } | Sort-Object -Unique

Write-Output "# FrontierScan Diff Context"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output ""

Write-Output "## Git Status"
if ($statusLines.Count -eq 0) {
  Write-Output "Clean working tree."
} else {
  $statusLines | ForEach-Object { Write-Output $_ }
}

Write-Output ""
Write-Output "## Changed Files"
if ($changedFiles.Count -eq 0) {
  Write-Output "None."
} else {
  $changedFiles | ForEach-Object { Write-Output "- $_" }
}

Write-Output ""
Write-Output "## Unstaged Diff Stat"
$unstagedStat = @(Invoke-RepoGit -Arguments @("diff", "--stat"))
if ($unstagedStat.Count -eq 0) {
  Write-Output "None."
} else {
  $unstagedStat | ForEach-Object { Write-Output $_ }
}

Write-Output ""
Write-Output "## Staged Diff Stat"
$stagedStat = @(Invoke-RepoGit -Arguments @("diff", "--cached", "--stat"))
if ($stagedStat.Count -eq 0) {
  Write-Output "None."
} else {
  $stagedStat | ForEach-Object { Write-Output $_ }
}
