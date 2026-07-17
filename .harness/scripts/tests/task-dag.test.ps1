$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$validator = Join-Path $root ".harness\scripts\validate-task-dag.ps1"
$worktreePlanner = Join-Path $root ".harness\scripts\plan-worktrees.ps1"
$caseDeriver = Join-Path $root ".harness\scripts\derive-interface-cases.ps1"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontierscan-task-dag-test-" + [guid]::NewGuid().ToString("N"))
$dagFile = Join-Path $temporaryRoot "task-dag.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  $unicodeTitle = -join @(
    [char]0x9A8C,
    [char]0x8BC1,
    [char]0x4E2D,
    [char]0x6587,
    [char]0x4EFB,
    [char]0x52A1
  )
  $dag = @{
    schemaVersion = "1.0"
    storyId = "UTF8-001"
    nodes = @(@{
      taskId = "T1"
      title = $unicodeTitle
      type = "docs"
      status = "pending"
      predictedFiles = @("docs/utf8.md")
      acceptanceCriteria = @($unicodeTitle + [char]0x3002)
    })
    edges = @()
    waves = @(, @("T1"))
    globalChanges = @()
    risks = @()
  }
  [System.IO.File]::WriteAllText($dagFile, ($dag | ConvertTo-Json -Depth 8), $utf8NoBom)

  $output = & $validator -TaskDagFile $dagFile
  if (($output -join "`n") -notmatch "Harness task DAG validation passed") {
    throw "UTF-8 task DAG did not pass validation."
  }

  $worktreePlan = (& $worktreePlanner -TaskDagFile $dagFile -Root $temporaryRoot -Json) | ConvertFrom-Json
  if ($worktreePlan.assignments[0].title -ne $unicodeTitle) {
    throw "Worktree planner did not preserve the UTF-8 task title."
  }

  $cases = (& $caseDeriver -TaskDagFile $dagFile -Json) | ConvertFrom-Json
  if ($cases.cases[0].expected -ne ($unicodeTitle + [char]0x3002)) {
    throw "Interface case derivation did not preserve the UTF-8 acceptance criterion."
  }

  Write-Output "Task DAG validator tests passed."
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
