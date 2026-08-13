param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("prepare", "status", "run-adapter", "apply", "approve-gap", "prepare-batch", "finalize-batch", "prepare-wave", "finalize-wave")]
  [string]$Command,

  [string]$StateFile,
  [string]$Adapter,
  [string]$ResultFile,
  [string]$TaskDagFile,
  [string]$BatchFile,
  [int]$WaveIndex = 0,
  [string]$ExpectedIntegrationManifestSha256,
  [string]$ExpectedIntegrationLockSha256,
  [string]$CaseId,
  [string]$Reason,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

if ($Command -in @("prepare-wave", "finalize-wave")) {
  if ([string]::IsNullOrWhiteSpace($TaskDagFile) -or $WaveIndex -lt 1) {
    throw "${Command} requires TaskDagFile and a positive WaveIndex."
  }
  if (-not [string]::IsNullOrWhiteSpace($Adapter) -or
      -not [string]::IsNullOrWhiteSpace($ResultFile) -or
      -not [string]::IsNullOrWhiteSpace($BatchFile)) {
    throw "${Command} does not accept Adapter, ResultFile, or BatchFile."
  }
  if ($Command -eq "finalize-wave" -and
      ([string]::IsNullOrWhiteSpace($ExpectedIntegrationManifestSha256) -or
       [string]::IsNullOrWhiteSpace($ExpectedIntegrationLockSha256))) {
    throw "finalize-wave requires ExpectedIntegrationManifestSha256 and ExpectedIntegrationLockSha256."
  }
  if ($Command -eq "prepare-wave" -and
      (-not [string]::IsNullOrWhiteSpace($ExpectedIntegrationManifestSha256) -or
       -not [string]::IsNullOrWhiteSpace($ExpectedIntegrationLockSha256))) {
    throw "prepare-wave does not accept integration manifest or lock hashes."
  }
} elseif ($WaveIndex -ne 0) {
  throw "WaveIndex is only supported by prepare-wave and finalize-wave."
}

if ($Command -eq "approve-gap") {
  if ([string]::IsNullOrWhiteSpace($CaseId) -or [string]::IsNullOrWhiteSpace($Reason)) {
    throw "approve-gap requires CaseId and Reason."
  }
  if (-not [string]::IsNullOrWhiteSpace($Adapter) -or
      -not [string]::IsNullOrWhiteSpace($ResultFile) -or
      -not [string]::IsNullOrWhiteSpace($TaskDagFile) -or
      -not [string]::IsNullOrWhiteSpace($BatchFile) -or
      $WaveIndex -ne 0) {
    throw "approve-gap does not accept Adapter, ResultFile, TaskDagFile, BatchFile, or WaveIndex."
  }
} elseif (-not [string]::IsNullOrWhiteSpace($CaseId) -or -not [string]::IsNullOrWhiteSpace($Reason)) {
  throw "CaseId and Reason are only supported by approve-gap."
}

$nodeScript = Join-Path $PSScriptRoot "lib\story-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Story runtime not found: ${nodeScript}"
}

$arguments = @($nodeScript, $Command, "--root", $Root)
if (-not [string]::IsNullOrWhiteSpace($StateFile)) {
  $arguments += @("--state-file", $StateFile)
}
if (-not [string]::IsNullOrWhiteSpace($Adapter)) {
  $arguments += @("--adapter", $Adapter)
}
if (-not [string]::IsNullOrWhiteSpace($ResultFile)) {
  $arguments += @("--result-file", $ResultFile)
}
if (-not [string]::IsNullOrWhiteSpace($TaskDagFile)) {
  $arguments += @("--task-dag-file", $TaskDagFile)
}
if (-not [string]::IsNullOrWhiteSpace($BatchFile)) {
  $arguments += @("--batch-file", $BatchFile)
}
if ($WaveIndex -gt 0) {
  $arguments += @("--wave-index", [string]$WaveIndex)
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedIntegrationManifestSha256)) {
  $arguments += @("--expected-integration-manifest-sha256", $ExpectedIntegrationManifestSha256)
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedIntegrationLockSha256)) {
  $arguments += @("--expected-integration-lock-sha256", $ExpectedIntegrationLockSha256)
}
if (-not [string]::IsNullOrWhiteSpace($CaseId)) {
  $arguments += @("--case-id", $CaseId)
}
if (-not [string]::IsNullOrWhiteSpace($Reason)) {
  $arguments += @("--reason", $Reason)
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
$nodeExitCode = $LASTEXITCODE
if ($nodeExitCode -ne 0) {
  exit $nodeExitCode
}
