$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$selector = Join-Path $root ".harness\scripts\select-tests.ps1"

$result = (& $selector `
  -Root $root `
  -ChangedFile ".harness/runs/M7-A3/phases/02-task-dag/task-dag.json" `
  -Json) | ConvertFrom-Json

$taskDagGate = @($result.recommendations | Where-Object { $_.Gate -eq "task-dag" })
if ($taskDagGate.Count -ne 1) {
  throw "Runtime task DAG changes must recommend exactly one task-dag gate."
}

$unrelated = (& $selector `
  -Root $root `
  -ChangedFile ".harness/runs/M7-A3/phases/00-requirement/requirement.md" `
  -Json) | ConvertFrom-Json

if (@($unrelated.recommendations | Where-Object { $_.Gate -eq "task-dag" }).Count -ne 0) {
  throw "Non-DAG runtime artifacts must not recommend the task-dag gate."
}

Write-Output "Test selection tests passed."
