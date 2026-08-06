param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("prepare", "status", "run-adapter", "apply", "prepare-batch", "finalize-batch", "prepare-wave")]
  [string]$Command,

  [string]$StateFile,
  [string]$Adapter,
  [string]$ResultFile,
  [string]$TaskDagFile,
  [string]$BatchFile,
  [int]$WaveIndex = 0,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

if ($Command -eq "prepare-wave") {
  if ([string]::IsNullOrWhiteSpace($TaskDagFile) -or $WaveIndex -lt 1) {
    throw "prepare-wave requires TaskDagFile and a positive WaveIndex."
  }
  if (-not [string]::IsNullOrWhiteSpace($Adapter) -or
      -not [string]::IsNullOrWhiteSpace($ResultFile) -or
      -not [string]::IsNullOrWhiteSpace($BatchFile)) {
    throw "prepare-wave does not accept Adapter, ResultFile, or BatchFile."
  }
} elseif ($WaveIndex -ne 0) {
  throw "WaveIndex is only supported by prepare-wave."
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
if ($Json) {
  $arguments += "--json"
}

& node @arguments
$nodeExitCode = $LASTEXITCODE
if ($nodeExitCode -ne 0) {
  exit $nodeExitCode
}
