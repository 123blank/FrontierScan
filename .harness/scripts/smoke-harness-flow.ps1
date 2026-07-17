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

Invoke-Step -Name "State Runtime" -Action {
  $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "frontierscan-harness-smoke-$([guid]::NewGuid().ToString('N'))"
  try {
    New-Item -ItemType Directory -Path (Join-Path $temporaryRoot ".harness\states") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $temporaryRoot ".harness\workflows") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root ".harness\states\e2e-state.template.json") -Destination (Join-Path $temporaryRoot ".harness\states\e2e-state.template.json")
    Copy-Item -LiteralPath (Join-Path $Root ".harness\workflows\e2e-development.yaml") -Destination (Join-Path $temporaryRoot ".harness\workflows\e2e-development.yaml")
    $stateRunner = Join-Path $Root ".harness\scripts\run-state.ps1"
    $storyRunner = Join-Path $Root ".harness\scripts\run-story.ps1"
    & $stateRunner -Command init -Root $temporaryRoot -StoryId "SMOKE-M3" -Summary "验证单 Story Dispatcher" -Json | Out-Null
    & $stateRunner -Command status -Root $temporaryRoot -Json | Out-Null
    & $stateRunner -Command validate -Root $temporaryRoot -Json | Out-Null
    & $storyRunner -Command prepare -Root $temporaryRoot -Json | Out-Null
    & $storyRunner -Command status -Root $temporaryRoot -Json | Out-Null
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
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

Invoke-Step -Name "Knowledge Generate Dry Run" -Action {
  & (Join-Path $Root ".harness\scripts\generate-kb.ps1") -Root $Root -Area all -Mode all -DryRun
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
