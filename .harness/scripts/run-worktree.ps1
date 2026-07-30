param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Plan", "Status", "Create", "Retire", "BatchPlan", "BatchStatus", "BatchCreate", "BatchRetire", "WavePlan", "WaveStatus")]
  [string]$Command,

  [Parameter(Mandatory = $true)]
  [string]$StateFile,

  [string]$TaskDagFile,

  [string]$TaskId,

  [int]$WaveIndex,
  [string]$BaseRef,
  [string]$Root,
  [switch]$ConfirmCreate,
  [switch]$ConfirmRetire,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$runtime = Join-Path $PSScriptRoot "lib\worktree-runtime.mjs"
$isBatchCommand = $Command -in @("BatchPlan", "BatchStatus", "BatchCreate", "BatchRetire")
$isWaveCommand = $Command -in @("WavePlan", "WaveStatus")
$runtimeCommand = switch ($Command) {
  "BatchPlan" { "batch-plan" }
  "BatchStatus" { "batch-status" }
  "BatchCreate" { "batch-create" }
  "BatchRetire" { "batch-retire" }
  "WavePlan" { "wave-plan" }
  "WaveStatus" { "wave-status" }
  default { $Command.ToLowerInvariant() }
}
$arguments = @($runtime, $runtimeCommand, "--root", $Root, "--state-file", $StateFile)
if ($isBatchCommand) {
  foreach ($parameterName in @("TaskId", "TaskDagFile", "BaseRef")) {
    if ($PSBoundParameters.ContainsKey($parameterName)) {
      throw "Batch Worktree commands derive identity, branch, path, and base from the serial batch ledger; -$parameterName is not accepted."
    }
  }
} elseif ($isWaveCommand) {
  if ($PSBoundParameters.ContainsKey("TaskId")) {
    throw "Wave Worktree commands derive tasks from the selected wave; -TaskId is not accepted."
  }
  if ([string]::IsNullOrWhiteSpace($TaskDagFile)) {
    throw "-TaskDagFile is required for $Command."
  }
  if (-not $PSBoundParameters.ContainsKey("WaveIndex") -or $WaveIndex -lt 1) {
    throw "-WaveIndex must be a positive 1-based index for $Command."
  }
  $effectiveBaseRef = if ([string]::IsNullOrWhiteSpace($BaseRef)) { "dev" } else { $BaseRef }
  $arguments += @("--task-dag-file", $TaskDagFile, "--wave-index", [string]$WaveIndex, "--base-ref", $effectiveBaseRef)
} else {
  if ([string]::IsNullOrWhiteSpace($TaskId)) {
    throw "-TaskId is required for $Command."
  }
  $effectiveBaseRef = if ([string]::IsNullOrWhiteSpace($BaseRef)) { "dev" } else { $BaseRef }
  $arguments += @("--task-id", $TaskId, "--base-ref", $effectiveBaseRef)
  if (-not [string]::IsNullOrWhiteSpace($TaskDagFile)) { $arguments += @("--task-dag-file", $TaskDagFile) }
}
if ($ConfirmCreate) { $arguments += "--confirm-create" }
if ($ConfirmRetire) { $arguments += "--confirm-retire" }
if ($Json) { $arguments += "--json" }

& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
