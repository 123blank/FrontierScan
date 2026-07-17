param(
  [Parameter(Mandatory = $true)]
  [string]$StateFile
)

$ErrorActionPreference = "Stop"

function Assert-HasProperty {
  param(
    [object]$Object,
    [string]$Name,
    [string]$Context
  )

  if (-not ($Object.PSObject.Properties.Name -contains $Name)) {
    throw "${Context} is missing required property '${Name}'."
  }
}

function Assert-Array {
  param(
    [object]$Value,
    [string]$Context
  )

  if ($null -eq $Value -or $Value -isnot [System.Array]) {
    throw "${Context} must be an array."
  }
}

function Assert-Enum {
  param(
    [string]$Value,
    [string[]]$Allowed,
    [string]$Context
  )

  if ($Allowed -notcontains $Value) {
    throw "${Context} has invalid value '${Value}'. Allowed: $($Allowed -join ', ')"
  }
}

function Read-StateJson {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "State file not found: ${Path}"
  }

  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Invalid JSON in state file '${Path}': $($_.Exception.Message)"
  }
}

function Test-E2EState {
  param([object]$State)

  $required = @(
    "schemaVersion",
    "storyId",
    "phase",
    "runtime",
    "requirement",
    "knowledge",
    "tasks",
    "dag",
    "worktrees",
    "tests",
    "review",
    "verification",
    "delivery",
    "logs"
  )

  foreach ($name in $required) {
    Assert-HasProperty -Object $State -Name $name -Context "E2E state"
  }

  Assert-Enum -Value $State.phase -Allowed @(
    "requirement",
    "technical-design",
    "task-dag",
    "implementation",
    "unit-test",
    "code-review",
    "build-publish",
    "interface-verification",
    "git-delivery",
    "done",
    "blocked"
  ) -Context "E2E state phase"

  foreach ($name in @("runId", "workflow", "status", "revision", "previousPhase", "blocked", "records", "createdAt", "updatedAt")) {
    Assert-HasProperty -Object $State.runtime -Name $name -Context "E2E runtime"
  }
  Assert-Enum -Value $State.runtime.status -Allowed @("template", "active", "blocked", "completed") -Context "E2E runtime status"
  Assert-Array -Value $State.runtime.records -Context "E2E runtime records"
  if ($State.runtime.runId -ne $State.storyId) {
    throw "E2E runtime runId must match storyId."
  }
  if ($State.runtime.revision -isnot [int] -and $State.runtime.revision -isnot [long]) {
    throw "E2E runtime revision must be an integer."
  }
  if ($State.runtime.revision -lt 0) {
    throw "E2E runtime revision cannot be negative."
  }

  foreach ($name in @("summary", "openQuestions", "acceptanceCriteria")) {
    Assert-HasProperty -Object $State.requirement -Name $name -Context "E2E requirement"
  }

  foreach ($name in @("loadedFiles", "staleFiles", "missingAreas")) {
    Assert-HasProperty -Object $State.knowledge -Name $name -Context "E2E knowledge"
  }

  foreach ($name in @("nodes", "edges", "waves")) {
    Assert-HasProperty -Object $State.dag -Name $name -Context "E2E DAG"
  }

  foreach ($name in @("commands", "results")) {
    Assert-HasProperty -Object $State.tests -Name $name -Context "E2E tests"
  }

  Assert-HasProperty -Object $State.review -Name "findings" -Context "E2E review"
  Assert-HasProperty -Object $State.review -Name "status" -Context "E2E review"

  foreach ($name in @("cases", "results")) {
    Assert-HasProperty -Object $State.verification -Name $name -Context "E2E verification"
  }

  foreach ($name in @("ownedFiles", "commit", "pr")) {
    Assert-HasProperty -Object $State.delivery -Name $name -Context "E2E delivery"
  }

  Assert-Array -Value $State.tasks -Context "E2E tasks"
  Assert-Array -Value $State.worktrees -Context "E2E worktrees"
  Assert-Array -Value $State.logs -Context "E2E logs"

  return "e2e"
}

function Test-ProductState {
  param([object]$State)

  $required = @("schemaVersion", "requestId", "phase", "sourceRequest", "stories", "join", "decisions", "logs")

  foreach ($name in $required) {
    Assert-HasProperty -Object $State -Name $name -Context "Product state"
  }

  Assert-Enum -Value $State.phase -Allowed @("breakdown", "forking", "joining", "done", "blocked") -Context "Product state phase"
  Assert-Array -Value $State.stories -Context "Product stories"
  Assert-Array -Value $State.decisions -Context "Product decisions"
  Assert-Array -Value $State.logs -Context "Product logs"

  foreach ($story in $State.stories) {
    foreach ($name in @("storyId", "title", "status", "stateFile", "affectedModules", "acceptanceCriteria")) {
      Assert-HasProperty -Object $story -Name $name -Context "Product story"
    }

    Assert-Enum -Value $story.status -Allowed @("pending", "running", "reviewed", "joined", "blocked", "done") -Context "Product story status"
    Assert-Array -Value $story.affectedModules -Context "Product story affectedModules"
    Assert-Array -Value $story.acceptanceCriteria -Context "Product story acceptanceCriteria"
  }

  foreach ($name in @("integrationBranch", "mergeStatus", "verificationStatus")) {
    Assert-HasProperty -Object $State.join -Name $name -Context "Product join"
  }

  Assert-Enum -Value $State.join.mergeStatus -Allowed @("pending", "running", "done", "blocked") -Context "Product join mergeStatus"
  Assert-Enum -Value $State.join.verificationStatus -Allowed @("pending", "passed", "failed", "skipped") -Context "Product join verificationStatus"

  return "product"
}

function Test-ActiveRunState {
  param([object]$State)

  foreach ($name in @("schemaVersion", "runId", "stateFile", "status", "revision", "updatedAt")) {
    Assert-HasProperty -Object $State -Name $name -Context "Active run"
  }

  if ($State.schemaVersion -isnot [string] -or [string]::IsNullOrWhiteSpace($State.schemaVersion)) {
    throw "Active run schemaVersion must be a non-empty string."
  }
  if ($State.runId -isnot [string] -or $State.runId -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$") {
    throw "Active run runId is invalid."
  }
  if ($State.stateFile -isnot [string]) {
    throw "Active run stateFile must be a string."
  }
  $normalizedStateFile = $State.stateFile.Replace("\", "/")
  if ($normalizedStateFile -ne ".harness/states/e2e-$($State.runId).json") {
    throw "Active run stateFile must match runId."
  }
  if ($State.status -isnot [string]) {
    throw "Active run status must be a string."
  }
  Assert-Enum -Value $State.status -Allowed @("active", "blocked", "completed") -Context "Active run status"
  if (($State.revision -isnot [int] -and $State.revision -isnot [long]) -or $State.revision -lt 1) {
    throw "Active run revision must be a positive integer."
  }
  if ($State.updatedAt -isnot [string] -or [string]::IsNullOrWhiteSpace($State.updatedAt)) {
    throw "Active run updatedAt must be a non-empty string."
  }

  return "active-run"
}

$state = Read-StateJson -Path $StateFile

$stateType = $null
if ($state.PSObject.Properties.Name -contains "storyId") {
  $stateType = Test-E2EState -State $state
} elseif ($state.PSObject.Properties.Name -contains "requestId") {
  $stateType = Test-ProductState -State $state
} elseif ($state.PSObject.Properties.Name -contains "runId" -and $state.PSObject.Properties.Name -contains "stateFile") {
  $stateType = Test-ActiveRunState -State $state
} else {
  throw "Unknown state file type. Expected storyId, requestId, or an active run pointer."
}

Write-Output "Harness state validation passed."
Write-Output "State type: ${stateType}"
Write-Output "State file: ${StateFile}"
