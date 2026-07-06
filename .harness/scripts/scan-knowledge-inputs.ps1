param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Get-RelativePath {
  param([string]$Path)

  $rootWithSeparator = $Root.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  return $Path.Replace($rootWithSeparator, "").Replace("\", "/")
}

function Get-TopLevelChildren {
  param(
    [string]$Path,
    [string]$RelativePrefix
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  return @(
    Get-ChildItem -LiteralPath $Path -Directory |
      Sort-Object Name |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.Name
          path = "${RelativePrefix}/$($_.Name)"
          file_count = @(Get-ChildItem -LiteralPath $_.FullName -Recurse -File -ErrorAction SilentlyContinue).Count
        }
      }
  )
}

function Get-FileCount {
  param(
    [string]$Path,
    [string[]]$Include = @("*")
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }

  return @(Get-ChildItem -LiteralPath $Path -Recurse -File -Include $Include -ErrorAction SilentlyContinue).Count
}

$backendPackageRoot = Join-Path $Root "backend\src\main\java\com\frontierscan"
$frontendSrcRoot = Join-Path $Root "frontend\src"
$docsRoot = Join-Path $Root "docs"

$backendPackages = Get-TopLevelChildren -Path $backendPackageRoot -RelativePrefix "backend/src/main/java/com/frontierscan"
$frontendAreas = Get-TopLevelChildren -Path $frontendSrcRoot -RelativePrefix "frontend/src"

$result = [pscustomobject]@{
  root = $Root
  backend = [pscustomobject]@{
    package_root = "backend/src/main/java/com/frontierscan"
    java_file_count = Get-FileCount -Path $backendPackageRoot -Include @("*.java")
    packages = $backendPackages
  }
  frontend = [pscustomobject]@{
    source_root = "frontend/src"
    source_file_count = Get-FileCount -Path $frontendSrcRoot -Include @("*.ts", "*.vue", "*.css")
    areas = $frontendAreas
  }
  docs = [pscustomobject]@{
    path = "docs"
    file_count = Get-FileCount -Path $docsRoot -Include @("*.md")
  }
  suggested_knowledge_tasks = @(
    "Split backend knowledge by package when a package becomes a frequent change target.",
    "Keep frontend web-admin knowledge grouped unless route/component docs become too large.",
    "Preserve all custom/ notes and append to log.md instead of overwriting history.",
    "Refresh freshness metadata after code-derived knowledge is regenerated."
  )
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
  exit 0
}

Write-Output "# FrontierScan Knowledge Input Scan"
Write-Output ""
Write-Output "Root: ${Root}"
Write-Output ""
Write-Output "## Backend"
Write-Output "Package root: $($result.backend.package_root)"
Write-Output "Java files: $($result.backend.java_file_count)"
Write-Output ""
Write-Output "| Package | Path | Files |"
Write-Output "| --- | --- | --- |"
foreach ($package in $result.backend.packages) {
  Write-Output ("| {0} | ``{1}`` | {2} |" -f $package.name, $package.path, $package.file_count)
}

Write-Output ""
Write-Output "## Frontend"
Write-Output "Source root: $($result.frontend.source_root)"
Write-Output "Source files: $($result.frontend.source_file_count)"
Write-Output ""
Write-Output "| Area | Path | Files |"
Write-Output "| --- | --- | --- |"
foreach ($area in $result.frontend.areas) {
  Write-Output ("| {0} | ``{1}`` | {2} |" -f $area.name, $area.path, $area.file_count)
}

Write-Output ""
Write-Output "## Suggested Knowledge Tasks"
foreach ($task in $result.suggested_knowledge_tasks) {
  Write-Output "- $task"
}
