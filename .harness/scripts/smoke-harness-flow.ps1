param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$TaskDagFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path ".harness\templates\task-dag.example.json")
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Output "== ${Name} =="
  & $Action
  Write-Output ""
}

Invoke-Step -Name "Structure" -Action {
  & (Join-Path $Root ".harness\scripts\validate-structure.ps1") -Root $Root
}

Invoke-Step -Name "E2E State" -Action {
  & (Join-Path $Root ".harness\scripts\validate-state.ps1") -StateFile (Join-Path $Root ".harness\states\e2e-state.template.json")
}

Invoke-Step -Name "Product State" -Action {
  & (Join-Path $Root ".harness\scripts\validate-state.ps1") -StateFile (Join-Path $Root ".harness\states\product-state.template.json")
}

Invoke-Step -Name "Task DAG" -Action {
  & (Join-Path $Root ".harness\scripts\validate-task-dag.ps1") -TaskDagFile $TaskDagFile
}

Invoke-Step -Name "Knowledge Query" -Action {
  & (Join-Path $Root ".harness\scripts\kb-query.ps1") -Root $Root -Query "quality gate" -Mode knowledge-qa -Area common -MaxMatches 3
}

Invoke-Step -Name "Knowledge Freshness" -Action {
  & (Join-Path $Root ".harness\scripts\check-kb-freshness.ps1") -Root $Root
}

Invoke-Step -Name "Worktree Plan" -Action {
  & (Join-Path $Root ".harness\scripts\plan-worktrees.ps1") -Root $Root -TaskDagFile $TaskDagFile
}

Invoke-Step -Name "Interface Cases" -Action {
  & (Join-Path $Root ".harness\scripts\derive-interface-cases.ps1") -TaskDagFile $TaskDagFile
}

Invoke-Step -Name "Build Plan" -Action {
  & (Join-Path $Root ".harness\scripts\plan-build.ps1") -Root $Root
}

Invoke-Step -Name "Delivery Summary" -Action {
  & (Join-Path $Root ".harness\scripts\summarize-delivery.ps1") -Root $Root
}

Write-Output "Harness smoke flow completed."
