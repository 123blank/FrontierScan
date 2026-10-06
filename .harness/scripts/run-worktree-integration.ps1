[CmdletBinding(DefaultParameterSetName = "SingleTask")]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Plan", "Status", "Apply")]
  [string]$Command,

  [Parameter(Mandatory = $true)]
  [string]$StateFile,

  [Parameter(Mandatory = $true)]
  [string]$TaskId,

  [Parameter(Mandatory = $true, ParameterSetName = "SingleTask")]
  [string]$TaskFile,

  [Parameter(Mandatory = $true, ParameterSetName = "Batch")]
  [string]$BatchFile,

  [string]$Root,
  [switch]$ConfirmApply,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$runtime = Join-Path $PSScriptRoot "lib\worktree-integration-runtime.mjs"
$arguments = @(
  $runtime,
  $Command.ToLowerInvariant(),
  "--root", $Root,
  "--state-file", $StateFile,
  "--task-id", $TaskId
)
if ($PSCmdlet.ParameterSetName -eq "Batch") {
  $arguments += "--batch-file", $BatchFile
} else {
  $arguments += "--task-file", $TaskFile
}
if ($ConfirmApply) { $arguments += "--confirm-apply" }
if ($Json) { $arguments += "--json" }

& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
