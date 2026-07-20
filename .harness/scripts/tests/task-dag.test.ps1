$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$validator = Join-Path $root ".harness\scripts\validate-task-dag.ps1"
$worktreePlanner = Join-Path $root ".harness\scripts\plan-worktrees.ps1"
$caseDeriver = Join-Path $root ".harness\scripts\derive-interface-cases.ps1"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("frontierscan-task-dag-test-" + [guid]::NewGuid().ToString("N"))
$dagFile = Join-Path $temporaryRoot "task-dag.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-DagFile {
  param([object]$Dag)
  [System.IO.File]::WriteAllText($dagFile, ($Dag | ConvertTo-Json -Depth 12), $utf8NoBom)
}

function Copy-Dag {
  param([object]$Dag)
  return (($Dag | ConvertTo-Json -Depth 12) | ConvertFrom-Json)
}

function Assert-ValidationFails {
  param(
    [object]$Dag,
    [string]$Pattern
  )

  Write-DagFile -Dag $Dag
  try {
    & $validator -TaskDagFile $dagFile 2>&1 | Out-Null
  } catch {
    if ($_.Exception.Message -notmatch $Pattern) {
      throw "Expected validation error matching '${Pattern}', got: $($_.Exception.Message)"
    }
    return
  }
  throw "Expected task DAG validation to fail with '${Pattern}'."
}

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
  Write-DagFile -Dag $dag

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

  $secondNode = @{
    taskId = "T2"
    title = "Second task"
    type = "docs"
    status = "pending"
    predictedFiles = @("docs/second.md")
    acceptanceCriteria = @("Second task passes.")
  }

  $missingWave = Copy-Dag -Dag $dag
  $missingWave.nodes = @($missingWave.nodes) + $secondNode
  Assert-ValidationFails -Dag $missingWave -Pattern "exactly one wave"

  $duplicateWave = Copy-Dag -Dag $dag
  $duplicateWave.waves = @(@("T1"), @("T1"))
  Assert-ValidationFails -Dag $duplicateWave -Pattern "exactly one wave"

  $reverseDependency = Copy-Dag -Dag $dag
  $reverseDependency.nodes = @($reverseDependency.nodes) + $secondNode
  $reverseDependency.edges = @(@{ from = "T1"; to = "T2"; reason = "T2 depends on T1." })
  $reverseDependency.waves = @(@("T2"), @("T1"))
  Assert-ValidationFails -Dag $reverseDependency -Pattern "later wave"

  $caseConflict = Copy-Dag -Dag $dag
  $caseConflict.nodes = @($caseConflict.nodes) + $secondNode
  $caseConflict.nodes[0].predictedFiles = @("docs/Result.md")
  $caseConflict.nodes[1].predictedFiles = @("docs/result.md")
  $caseConflict.waves = @(, @("T1", "T2"))
  Assert-ValidationFails -Dag $caseConflict -Pattern "overlapping predicted files"

  $rangeConflict = Copy-Dag -Dag $dag
  $rangeConflict.nodes = @($rangeConflict.nodes) + $secondNode
  $rangeConflict.nodes[0].predictedFiles = @("docs/**")
  $rangeConflict.nodes[1].predictedFiles = @("docs/result.md")
  $rangeConflict.waves = @(, @("T1", "T2"))
  Assert-ValidationFails -Dag $rangeConflict -Pattern "overlapping predicted files"

  $parentEscape = Copy-Dag -Dag $dag
  $parentEscape.nodes[0].predictedFiles = @("../outside.md")
  Assert-ValidationFails -Dag $parentEscape -Pattern "repository-relative"

  $driveRelative = Copy-Dag -Dag $dag
  $driveRelative.nodes[0].predictedFiles = @("C:outside.md")
  Assert-ValidationFails -Dag $driveRelative -Pattern "repository-relative"

  $unsupportedWildcard = Copy-Dag -Dag $dag
  $unsupportedWildcard.nodes[0].predictedFiles = @("docs/*.md")
  Assert-ValidationFails -Dag $unsupportedWildcard -Pattern "only supports"

  $parallelGlobal = Copy-Dag -Dag $dag
  $parallelGlobal.nodes = @($parallelGlobal.nodes) + $secondNode
  $parallelGlobal.waves = @(, @("T1", "T2"))
  $parallelGlobal.globalChanges = @("Shared Harness change")
  Assert-ValidationFails -Dag $parallelGlobal -Pattern "globalChanges"

  $emptyDag = Copy-Dag -Dag $dag
  $emptyDag.nodes = @()
  $emptyDag.waves = @()
  Assert-ValidationFails -Dag $emptyDag -Pattern "at least one task"

  $invalidGlobal = Copy-Dag -Dag $dag
  $invalidGlobal.globalChanges = @(1)
  Assert-ValidationFails -Dag $invalidGlobal -Pattern "globalChanges.*string"

  $invalidRisk = Copy-Dag -Dag $dag
  $invalidRisk.risks = @(1)
  Assert-ValidationFails -Dag $invalidRisk -Pattern "risks.*string"

  $invalidOwner = Copy-Dag -Dag $dag
  $invalidOwner.nodes[0] | Add-Member -NotePropertyName ownerAgent -NotePropertyValue 42
  Assert-ValidationFails -Dag $invalidOwner -Pattern "ownerAgent"

  Write-Output "Task DAG validator tests passed."
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
