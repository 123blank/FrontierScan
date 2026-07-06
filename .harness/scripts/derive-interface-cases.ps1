param(
  [string]$TaskDagFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path ".harness\templates\task-dag.example.json"),
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $TaskDagFile)) {
  throw "Task DAG file not found: ${TaskDagFile}"
}

$dag = Get-Content -LiteralPath $TaskDagFile -Raw | ConvertFrom-Json
$cases = @()

foreach ($node in $dag.nodes) {
  $criteria = @($node.acceptanceCriteria)
  for ($i = 0; $i -lt $criteria.Count; $i++) {
    $caseType = switch ($node.type) {
      "backend" { "api" }
      "frontend" { "ui-flow" }
      "integration" { "api-or-ui-flow" }
      default { "manual-check" }
    }

    $cases += [pscustomobject]@{
      case_id = "$($node.taskId)-C$($i + 1)"
      task_id = $node.taskId
      type = $caseType
      request_or_action = "TBD from acceptance criterion and technical design"
      expected = $criteria[$i]
      actual = "TBD"
      result = "pending"
      evidence = "TBD"
    }
  }
}

$result = [pscustomobject]@{
  story_id = $dag.storyId
  source_task_dag = $TaskDagFile
  cases = $cases
  notes = @(
    "This script derives verification case drafts only.",
    "Fill concrete URLs, request bodies, UI actions, auth context, and expected response details before executing.",
    "Record unavailable environments instead of fabricating verification results."
  )
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
  exit 0
}

Write-Output "# FrontierScan Interface Case Drafts"
Write-Output ""
Write-Output "Story: $($dag.storyId)"
Write-Output "Source DAG: ${TaskDagFile}"
Write-Output ""
Write-Output "| Case | Task | Type | Request/Action | Expected | Result |"
Write-Output "| --- | --- | --- | --- | --- | --- |"
foreach ($case in $cases) {
  Write-Output ("| {0} | {1} | {2} | {3} | {4} | {5} |" -f $case.case_id, $case.task_id, $case.type, $case.request_or_action, $case.expected, $case.result)
}

Write-Output ""
Write-Output "## Notes"
foreach ($note in $result.notes) {
  Write-Output "- $note"
}
