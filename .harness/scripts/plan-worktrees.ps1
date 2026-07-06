param(
  [string]$TaskDagFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path ".harness\templates\task-dag.example.json"),
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$BaseBranch = "main",
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $TaskDagFile)) {
  throw "Task DAG file not found: ${TaskDagFile}"
}

$dag = Get-Content -LiteralPath $TaskDagFile -Raw | ConvertFrom-Json
$nodesById = @{}
foreach ($node in $dag.nodes) {
  $nodesById[$node.taskId] = $node
}

$assignments = @()
for ($waveIndex = 0; $waveIndex -lt $dag.waves.Count; $waveIndex++) {
  foreach ($taskId in $dag.waves[$waveIndex]) {
    if (-not $nodesById.ContainsKey($taskId)) {
      throw "Wave references unknown task: ${taskId}"
    }

    $node = $nodesById[$taskId]
    $safeTitle = ($node.title.ToLowerInvariant() -replace "[^a-z0-9]+", "-" -replace "^-|-$", "")
    if ([string]::IsNullOrWhiteSpace($safeTitle)) {
      $safeTitle = "task"
    }

    $branchName = "harness/$($dag.storyId.ToLowerInvariant())/$($taskId.ToLowerInvariant())-${safeTitle}"
    $worktreePath = Join-Path $Root ".harness\worktrees\$($dag.storyId)\$($taskId)"

    $assignments += [pscustomobject]@{
      story_id = $dag.storyId
      task_id = $taskId
      title = $node.title
      type = $node.type
      wave = $waveIndex + 1
      owner_agent = if ($node.PSObject.Properties.Name -contains "ownerAgent") { $node.ownerAgent } else { "" }
      branch = $branchName
      worktree_path = $worktreePath
      predicted_files = @($node.predictedFiles)
      create_command = "git -C '${Root}' worktree add -b '${branchName}' '${worktreePath}' '${BaseBranch}'"
    }
  }
}

$result = [pscustomobject]@{
  root = $Root
  task_dag_file = $TaskDagFile
  base_branch = $BaseBranch
  assignments = $assignments
  safety_notes = @(
    "This script only plans worktrees; it does not create branches or directories.",
    "Check git status before creating any worktree.",
    "Do not parallelize tasks that touch the same predicted files.",
    "Do not delete or clean worktrees without explicit approval."
  )
}

if ($Json) {
  $result | ConvertTo-Json -Depth 8
  exit 0
}

Write-Output "# FrontierScan Worktree Plan"
Write-Output ""
Write-Output "Task DAG: ${TaskDagFile}"
Write-Output "Base branch: ${BaseBranch}"
Write-Output ""
Write-Output "| Wave | Task | Type | Branch | Worktree |"
Write-Output "| --- | --- | --- | --- | --- |"
foreach ($assignment in $assignments) {
  Write-Output ("| {0} | {1} | {2} | ``{3}`` | ``{4}`` |" -f $assignment.wave, $assignment.task_id, $assignment.type, $assignment.branch, $assignment.worktree_path)
}

Write-Output ""
Write-Output "## Create Commands"
foreach ($assignment in $assignments) {
  Write-Output "- $($assignment.create_command)"
}

Write-Output ""
Write-Output "## Safety Notes"
foreach ($note in $result.safety_notes) {
  Write-Output "- $note"
}
