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

function Get-CurrentSourceFingerprints {
  $fingerprintScript = Join-Path $PSScriptRoot "lib\source-fingerprint.mjs"
  if (-not (Test-Path -LiteralPath $fingerprintScript)) {
    throw "Source fingerprint engine not found: ${fingerprintScript}"
  }
  $output = & node $fingerprintScript --root $Root --area all --json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Source fingerprint engine failed: $($output -join ' ')"
  }
  return ($output -join "`n") | ConvertFrom-Json
}

function Get-ObjectPropertyValue {
  param(
    [object]$Object,
    [string]$Name,
    [object]$DefaultValue = $null
  )
  if (-not $Object) { return $DefaultValue }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $DefaultValue
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

function Test-ModuleSourceExists {
  param(
    [string]$RepoRoot,
    [string]$Area,
    [string]$Module
  )

  $modulePath = if ($Area -eq "backend") {
    Join-Path $RepoRoot "backend\src\main\java\com\frontierscan\$Module"
  } else {
    Join-Path $RepoRoot "frontend\src\$Module"
  }
  if (-not (Test-Path -LiteralPath $modulePath -PathType Container)) {
    return $false
  }

  $extensions = if ($Area -eq "backend") {
    @(".java")
  } else {
    @(".ts", ".tsx", ".js", ".vue", ".css")
  }
  return @(
    Get-ChildItem -LiteralPath $modulePath -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in $extensions } |
      Select-Object -First 1
  ).Count -gt 0
}

function Test-ModuleOwnsAllChangedSources {
  param(
    [string[]]$Paths,
    [string]$Area,
    [string]$Module
  )

  $areaPrefix = if ($Area -eq "backend") { "backend/src/" } else { "frontend/src/" }
  $modulePrefix = if ($Area -eq "backend") {
    "backend/src/main/java/com/frontierscan/${Module}/"
  } else {
    "frontend/src/${Module}/"
  }
  $areaSourcePaths = @($Paths | Where-Object { $_.StartsWith($areaPrefix) })
  return $areaSourcePaths.Count -gt 0 -and @(
    $areaSourcePaths | Where-Object { -not $_.StartsWith($modulePrefix) }
  ).Count -eq 0
}

function Test-AreaHasRename {
  param(
    [string[]]$StatusLines,
    [string]$Area
  )

  $sourcePrefix = if ($Area -eq "backend") { "backend/src/" } else { "frontend/src/" }
  return @(
    $StatusLines |
      Where-Object { $_ -match "\s+->\s+" -and $_.Replace("\", "/").Contains($sourcePrefix) }
  ).Count -gt 0
}

function Get-RefreshMode {
  param([pscustomobject]$Finding)

  $semanticNeedsRefresh = $Finding.semantic_status -and $Finding.semantic_status -notin @("fresh", "pending")
  $baselineOrIndexNeedsRefresh = $Finding.status -eq "missing-meta" -or
    $Finding.source_changed -or
    ($Finding.baseline_status -and $Finding.baseline_status -ne "fresh") -or
    ($Finding.index_status -and $Finding.index_status -ne "fresh") -or
    $Finding.reason -match "generated_at|knowledge index manifest|source fingerprint"

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
$changedStatusLines = @(Invoke-RepoGit -Arguments @("status", "--short", "--untracked-files=all"))
$changedPaths = @(
  $changedStatusLines |
    ForEach-Object { Get-PathFromStatusLine -Line $_ }
) | Where-Object { $_ } | Sort-Object -Unique
$currentFingerprints = Get-CurrentSourceFingerprints
$indexManifestPath = Join-Path $Root "llm-knowledge\index\manifest.json"
$manifest = $null
$manifestError = ""
if (-not (Test-Path -LiteralPath $indexManifestPath)) {
  $manifestError = "knowledge index manifest is missing"
} else {
  try {
    $manifest = Get-Content -LiteralPath $indexManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    $manifestError = "knowledge index manifest is invalid"
  }
}

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
      recorded_source_fingerprint = ""
      current_source_fingerprint = (Get-ObjectPropertyValue -Object $currentFingerprints -Name $area.name).fingerprint
      source_changed = $true
      baseline_status = "missing"
      semantic_status = "pending"
      index_status = "missing"
    }
    continue
  }

  $lines = @(Get-Content -LiteralPath $area.meta -Encoding UTF8)
  $recordedHash = Get-MetaValue -Lines $lines -Name "git_hash"
  $recordedSourceFingerprint = Get-MetaValue -Lines $lines -Name "source_fingerprint"
  $recordedSourceFingerprintStatus = Get-MetaValue -Lines $lines -Name "source_fingerprint_status"
  $generatedAt = Get-MetaValue -Lines $lines -Name "generated_at"
  $status = Get-MetaValue -Lines $lines -Name "status"
  $baselineStatus = Get-MetaValue -Lines $lines -Name "baseline_status"
  $semanticStatus = Get-MetaValue -Lines $lines -Name "semantic_status"
  $indexStatus = Get-MetaValue -Lines $lines -Name "index_status"
  $currentSourceFingerprint = Get-ObjectPropertyValue -Object $currentFingerprints -Name $area.name
  $sourceChanged = [string]::IsNullOrWhiteSpace($recordedSourceFingerprint) -or
    $recordedSourceFingerprintStatus -ne "complete" -or
    $currentSourceFingerprint.status -ne "complete" -or
    $recordedSourceFingerprint -ne $currentSourceFingerprint.fingerprint

  $reasons = @()
  if ([string]::IsNullOrWhiteSpace($recordedSourceFingerprint)) {
    $reasons += "source fingerprint missing for $($area.name)"
  } elseif ($recordedSourceFingerprintStatus -ne "complete" -or $currentSourceFingerprint.status -ne "complete") {
    $reasons += "source fingerprint incomplete for $($area.name)"
  } elseif ($recordedSourceFingerprint -ne $currentSourceFingerprint.fingerprint) {
    $reasons += "source fingerprint mismatch for $($area.name)"
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

  if ($manifestError) {
    $reasons += $manifestError
  } else {
    $indexedFingerprint = [string](Get-ObjectPropertyValue -Object $manifest.source_fingerprints -Name $area.name -DefaultValue "")
    $indexedStatus = [string](Get-ObjectPropertyValue -Object $manifest.source_fingerprint_status -Name $area.name -DefaultValue "missing")
    if ([string]::IsNullOrWhiteSpace($indexedFingerprint)) {
      $reasons += "index source fingerprint missing for $($area.name)"
    } elseif ($indexedStatus -ne "complete") {
      $reasons += "index source fingerprint incomplete for $($area.name)"
    } elseif ($indexedFingerprint -ne $currentSourceFingerprint.fingerprint) {
      $reasons += "index source fingerprint mismatch for $($area.name)"
    }
  }

  $findings += [pscustomobject]@{
    area = $area.name
    status = if ($reasons.Count -eq 0) { "fresh" } else { "stale-or-incomplete" }
    reason = if ($reasons.Count -eq 0) { "Freshness metadata matches current repository state." } else { $reasons -join "; " }
    recorded_git_hash = $recordedHash
    current_git_hash = $headHash
    recorded_source_fingerprint = $recordedSourceFingerprint
    current_source_fingerprint = $currentSourceFingerprint.fingerprint
    source_changed = $sourceChanged
    baseline_status = $baselineStatus
    semantic_status = $semanticStatus
    index_status = $indexStatus
  }
}

$commonCurrent = Get-ObjectPropertyValue -Object $currentFingerprints -Name "common"
$commonRecorded = if ($manifest) { [string](Get-ObjectPropertyValue -Object $manifest.source_fingerprints -Name "common" -DefaultValue "") } else { "" }
$commonRecordedStatus = if ($manifest) { [string](Get-ObjectPropertyValue -Object $manifest.source_fingerprint_status -Name "common" -DefaultValue "missing") } else { "missing" }
$commonReasons = @()
if ($manifestError) {
  $commonReasons += $manifestError
} elseif ([string]::IsNullOrWhiteSpace($commonRecorded)) {
  $commonReasons += "source fingerprint missing for common"
} elseif ($commonRecordedStatus -ne "complete" -or $commonCurrent.status -ne "complete") {
  $commonReasons += "source fingerprint incomplete for common"
} elseif ($commonRecorded -ne $commonCurrent.fingerprint) {
  $commonReasons += "source fingerprint mismatch for common"
}
$findings += [pscustomobject]@{
  area = "common"
  status = if ($commonReasons.Count -eq 0) { "fresh" } else { "stale-or-incomplete" }
  reason = if ($commonReasons.Count -eq 0) { "Freshness metadata matches current repository state." } else { $commonReasons -join "; " }
  recorded_git_hash = if ($manifest) { [string]$manifest.git_hash } else { "" }
  current_git_hash = $headHash
  recorded_source_fingerprint = $commonRecorded
  current_source_fingerprint = $commonCurrent.fingerprint
  source_changed = $commonReasons.Count -gt 0
  baseline_status = if ($commonReasons.Count -eq 0) { "fresh" } else { "stale" }
  semantic_status = "pending"
  index_status = if ($commonReasons.Count -eq 0) { "fresh" } else { "partial" }
}

$refreshTargets = @(
  foreach ($finding in $findings | Where-Object { $_.status -ne "fresh" }) {
    $modules = @()
    if ($finding.area -ne "common") {
      $modules = @(Get-ChangedModules -Paths $changedPaths -Area $finding.area)
    }
    $mode = Get-RefreshMode -Finding $finding
    $command = if ($finding.area -eq "common") {
      ".\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline"
    } elseif ($mode -ne "semantic" -and $modules.Count -eq 1 -and -not (Test-AreaHasRename -StatusLines $changedStatusLines -Area $finding.area) -and (Test-ModuleSourceExists -RepoRoot $Root -Area $finding.area -Module $modules[0]) -and (Test-ModuleOwnsAllChangedSources -Paths $changedPaths -Area $finding.area -Module $modules[0])) {
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
