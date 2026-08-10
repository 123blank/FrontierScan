param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Plan", "Status", "Create", "Retire", "BatchPlan", "BatchStatus", "BatchCreate", "BatchRetire", "WavePlan", "WaveStatus", "WaveCreate", "WaveRetire")]
  [string]$Command,

  [Parameter(Mandatory = $true)]
  [string]$StateFile,

  [string]$TaskDagFile,

  [string]$TaskId,

  [int]$WaveIndex,
  [string]$BaseRef,
  [string]$ExpectedPlanSha256,
  [string]$ExpectedCreateLockSha256,
  [string]$ExpectedRecoveryLockSha256,
  [string]$ExpectedWaveLedgerSha256,
  [string]$ExpectedWaveReceiptSha256,
  [string]$ExpectedRetirementLockSha256,
  [string]$ExpectedRetirementRecoveryLockSha256,
  [string]$Root,
  [switch]$ConfirmCreate,
  [switch]$ConfirmRetire,
  [switch]$ConfirmWaveCreate,
  [switch]$ConfirmWaveLockRecovery,
  [switch]$ConfirmWaveRetireLockRecovery,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$runtime = Join-Path $PSScriptRoot "lib\worktree-runtime.mjs"
$isBatchCommand = $Command -in @("BatchPlan", "BatchStatus", "BatchCreate", "BatchRetire")
$isWaveCommand = $Command -in @("WavePlan", "WaveStatus", "WaveCreate", "WaveRetire")
$isWaveCreate = $Command -eq "WaveCreate"
$isWaveRetire = $Command -eq "WaveRetire"
$runtimeCommand = switch ($Command) {
  "BatchPlan" { "batch-plan" }
  "BatchStatus" { "batch-status" }
  "BatchCreate" { "batch-create" }
  "BatchRetire" { "batch-retire" }
  "WavePlan" { "wave-plan" }
  "WaveStatus" { "wave-status" }
  "WaveCreate" { "wave-create" }
  "WaveRetire" { "wave-retire" }
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
  $arguments += @("--task-dag-file", $TaskDagFile, "--wave-index", [string]$WaveIndex)
  if ($isWaveCreate) {
    if ($PSBoundParameters.ContainsKey("BaseRef")) {
      throw "WaveCreate derives its base from the approved plan; -BaseRef is not accepted."
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedPlanSha256)) {
      throw "-ExpectedPlanSha256 is required for WaveCreate."
    }
    if (-not $ConfirmWaveCreate) {
      throw "-ConfirmWaveCreate is required for WaveCreate."
    }
    $arguments += @("--expected-plan-sha256", $ExpectedPlanSha256, "--confirm-wave-create")
    if (-not [string]::IsNullOrWhiteSpace($ExpectedCreateLockSha256)) {
      $arguments += @("--expected-create-lock-sha256", $ExpectedCreateLockSha256)
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedRecoveryLockSha256)) {
      $arguments += @("--expected-recovery-lock-sha256", $ExpectedRecoveryLockSha256)
    }
    if ($ConfirmWaveLockRecovery) {
      $arguments += "--confirm-wave-lock-recovery"
    }
  } elseif ($isWaveRetire) {
    foreach ($parameterName in @(
      "BaseRef",
      "ExpectedPlanSha256",
      "ExpectedCreateLockSha256",
      "ExpectedRecoveryLockSha256",
      "ConfirmCreate",
      "ConfirmWaveCreate",
      "ConfirmWaveLockRecovery"
    )) {
      if ($PSBoundParameters.ContainsKey($parameterName)) {
        throw "WaveRetire derives identity, branch, path, and base from finalized Wave evidence; -$parameterName is not accepted."
      }
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedWaveLedgerSha256)) {
      throw "-ExpectedWaveLedgerSha256 is required for WaveRetire."
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedWaveReceiptSha256)) {
      throw "-ExpectedWaveReceiptSha256 is required for WaveRetire."
    }
    if (-not $ConfirmRetire) {
      throw "-ConfirmRetire is required for WaveRetire."
    }
    $arguments += @(
      "--expected-wave-ledger-sha256", $ExpectedWaveLedgerSha256,
      "--expected-wave-receipt-sha256", $ExpectedWaveReceiptSha256
    )
    if (-not [string]::IsNullOrWhiteSpace($ExpectedRetirementLockSha256)) {
      $arguments += @("--expected-retirement-lock-sha256", $ExpectedRetirementLockSha256)
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedRetirementRecoveryLockSha256)) {
      $arguments += @("--expected-retirement-recovery-lock-sha256", $ExpectedRetirementRecoveryLockSha256)
    }
    if ($ConfirmWaveRetireLockRecovery) {
      $arguments += "--confirm-wave-retire-lock-recovery"
    }
  } else {
    foreach ($parameterName in @(
      "ExpectedPlanSha256",
      "ExpectedCreateLockSha256",
      "ExpectedRecoveryLockSha256",
      "ExpectedWaveLedgerSha256",
      "ExpectedWaveReceiptSha256",
      "ExpectedRetirementLockSha256",
      "ExpectedRetirementRecoveryLockSha256",
      "ConfirmWaveCreate",
      "ConfirmWaveLockRecovery",
      "ConfirmWaveRetireLockRecovery"
    )) {
      if ($PSBoundParameters.ContainsKey($parameterName)) {
        throw "$Command does not accept -$parameterName."
      }
    }
    $effectiveBaseRef = if ([string]::IsNullOrWhiteSpace($BaseRef)) { "dev" } else { $BaseRef }
    $arguments += @("--base-ref", $effectiveBaseRef)
  }
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
