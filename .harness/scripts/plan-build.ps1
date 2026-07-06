param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string[]]$ChangedFile = @(),
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

function Test-AnyPath {
  param(
    [string[]]$Paths,
    [string[]]$Prefixes
  )

  foreach ($path in $Paths) {
    foreach ($prefix in $Prefixes) {
      if ($path.StartsWith($prefix)) {
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
$commands = @()

$hasBackend = Test-AnyPath -Paths $paths -Prefixes @("backend/")
$hasFrontend = Test-AnyPath -Paths $paths -Prefixes @("frontend/")
$hasDocker = Test-AnyPath -Paths $paths -Prefixes @("docker-compose.yml", "backend/Dockerfile", "frontend/Dockerfile", ".env.example")

if ($hasBackend) {
  $commands += [pscustomobject]@{
    gate = "backend-build"
    command = "Set-Location '${Root}\backend'; mvn package"
    reason = "Backend files changed."
    approval_required = $false
  }
}

if ($hasFrontend) {
  $commands += [pscustomobject]@{
    gate = "frontend-build"
    command = "Set-Location '${Root}\frontend'; npm run build"
    reason = "Frontend files changed."
    approval_required = $false
  }
}

if ($hasDocker) {
  $commands += [pscustomobject]@{
    gate = "docker-build-plan"
    command = "docker compose build"
    reason = "Docker or environment files changed."
    approval_required = $true
  }
}

if ($commands.Count -eq 0) {
  $commands += [pscustomobject]@{
    gate = "no-build-required"
    command = "N/A"
    reason = "No backend, frontend, Docker, or environment path detected."
    approval_required = $false
  }
}

$result = [pscustomobject]@{
  root = $Root
  changed_files = $paths
  build_plan = $commands
  publish_policy = "Publishing or deployment requires explicit user approval and is not performed by this script."
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6
  exit 0
}

Write-Output "# FrontierScan Build Plan"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output ""
Write-Output "| Gate | Command | Approval Required | Reason |"
Write-Output "| --- | --- | --- | --- |"
foreach ($command in $commands) {
  Write-Output ("| {0} | ``{1}`` | {2} | {3} |" -f $command.gate, $command.command, $command.approval_required, $command.reason)
}

Write-Output ""
Write-Output "Publish policy: $($result.publish_policy)"
