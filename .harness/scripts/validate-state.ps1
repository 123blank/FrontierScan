param(
  [Parameter(Mandatory = $true)]
  [string]$StateFile
)

$ErrorActionPreference = "Stop"

try {
  $resolvedStateFile = (Resolve-Path -LiteralPath $StateFile).Path
  $nodeScript = Join-Path $PSScriptRoot "lib\state-contract.mjs"
  & node $nodeScript validate-file --state-file $resolvedStateFile
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
