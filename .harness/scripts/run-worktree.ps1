param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Plan", "Status", "Create")]
  [string]$Command,

  [Parameter(Mandatory = $true)]
  [string]$StateFile,

  [string]$TaskDagFile,

  [Parameter(Mandatory = $true)]
  [string]$TaskId,

  [string]$BaseRef = "dev",
  [string]$Root,
  [switch]$ConfirmCreate,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$runtime = Join-Path $PSScriptRoot "lib\worktree-runtime.mjs"
$arguments = @($runtime, $Command.ToLowerInvariant(), "--root", $Root, "--state-file", $StateFile, "--task-id", $TaskId, "--base-ref", $BaseRef)
if (-not [string]::IsNullOrWhiteSpace($TaskDagFile)) { $arguments += @("--task-dag-file", $TaskDagFile) }
if ($ConfirmCreate) { $arguments += "--confirm-create" }
if ($Json) { $arguments += "--json" }

& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
