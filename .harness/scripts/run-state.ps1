param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("init", "status", "validate", "record", "next", "block", "resume", "complete")]
  [string]$Command,

  [string]$StoryId,
  [string]$Summary,
  [string]$StateFile,

  [ValidateSet("output", "test", "review", "approval", "note")]
  [string]$RecordType,

  [string]$Status,
  [string]$Path,
  [string]$Message,
  [string]$Actor,
  [string]$Reason,
  [string]$Owner,
  [string]$SuggestedAction,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$nodeScript = Join-Path $PSScriptRoot "lib\state-runtime.mjs"
if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "State runtime not found: ${nodeScript}"
}

$arguments = @($nodeScript, $Command, "--root", $Root)
$values = @(
  @{ Name = "--story-id"; Value = $StoryId },
  @{ Name = "--summary"; Value = $Summary },
  @{ Name = "--state-file"; Value = $StateFile },
  @{ Name = "--record-type"; Value = $RecordType },
  @{ Name = "--status"; Value = $Status },
  @{ Name = "--path"; Value = $Path },
  @{ Name = "--message"; Value = $Message },
  @{ Name = "--actor"; Value = $Actor },
  @{ Name = "--reason"; Value = $Reason },
  @{ Name = "--owner"; Value = $Owner },
  @{ Name = "--suggested-action"; Value = $SuggestedAction }
)

foreach ($item in $values) {
  if (-not [string]::IsNullOrWhiteSpace($item.Value)) {
    $arguments += @($item.Name, $item.Value)
  }
}
if ($Json) {
  $arguments += "--json"
}

& node @arguments
$nodeExitCode = $LASTEXITCODE
if ($nodeExitCode -ne 0) {
  exit $nodeExitCode
}
