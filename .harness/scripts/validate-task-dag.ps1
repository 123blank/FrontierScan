param(
  [Parameter(Mandatory = $true)]
  [string]$TaskDagFile
)

$ErrorActionPreference = "Stop"

$validator = Join-Path $PSScriptRoot "lib\task-dag-contract.mjs"
if (-not (Test-Path -LiteralPath $validator)) {
  throw "Task DAG contract not found: ${validator}"
}

& node $validator $TaskDagFile
if ($LASTEXITCODE -ne 0) {
  throw "Task DAG validation failed."
}
