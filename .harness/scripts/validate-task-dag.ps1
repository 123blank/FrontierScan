param(
  [Parameter(Mandatory = $true)]
  [string]$TaskDagFile
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

function Visit-Node {
  param(
    [string]$Node,
    [hashtable]$Adjacency,
    [hashtable]$Temporary,
    [hashtable]$Permanent
  )

  if ($Permanent.ContainsKey($Node)) {
    return
  }

  if ($Temporary.ContainsKey($Node)) {
    throw "DAG contains a cycle involving task '${Node}'."
  }

  $Temporary[$Node] = $true

  foreach ($next in $Adjacency[$Node]) {
    Visit-Node -Node $next -Adjacency $Adjacency -Temporary $Temporary -Permanent $Permanent
  }

  $Temporary.Remove($Node)
  $Permanent[$Node] = $true
}

if (-not (Test-Path -LiteralPath $TaskDagFile)) {
  throw "Task DAG file not found: ${TaskDagFile}"
}

try {
  $dag = Get-Content -LiteralPath $TaskDagFile -Raw | ConvertFrom-Json
} catch {
  throw "Invalid JSON in task DAG file '${TaskDagFile}': $($_.Exception.Message)"
}

foreach ($name in @("schemaVersion", "storyId", "nodes", "edges", "waves", "globalChanges", "risks")) {
  Assert-HasProperty -Object $dag -Name $name -Context "Task DAG"
}

Assert-Array -Value $dag.nodes -Context "Task DAG nodes"
Assert-Array -Value $dag.edges -Context "Task DAG edges"
Assert-Array -Value $dag.waves -Context "Task DAG waves"
Assert-Array -Value $dag.globalChanges -Context "Task DAG globalChanges"
Assert-Array -Value $dag.risks -Context "Task DAG risks"

$taskIds = @{}
$adjacency = @{}

foreach ($node in $dag.nodes) {
  foreach ($name in @("taskId", "title", "type", "status", "predictedFiles", "acceptanceCriteria")) {
    Assert-HasProperty -Object $node -Name $name -Context "Task node"
  }

  if ($taskIds.ContainsKey($node.taskId)) {
    throw "Duplicate taskId: $($node.taskId)"
  }

  Assert-Enum -Value $node.type -Allowed @("backend", "frontend", "database", "docs", "test", "integration", "unknown") -Context "Task node type"
  Assert-Enum -Value $node.status -Allowed @("pending", "running", "done", "blocked") -Context "Task node status"
  Assert-Array -Value $node.predictedFiles -Context "Task node predictedFiles"
  Assert-Array -Value $node.acceptanceCriteria -Context "Task node acceptanceCriteria"

  if ($node.PSObject.Properties.Name -contains "ownerAgent") {
    if ($node.type -eq "backend" -and $node.ownerAgent -eq "frontend-developer") {
      throw "Backend task '$($node.taskId)' should not be owned by frontend-developer."
    }

    if ($node.type -eq "frontend" -and $node.ownerAgent -eq "backend-developer") {
      throw "Frontend task '$($node.taskId)' should not be owned by backend-developer."
    }
  }

  $taskIds[$node.taskId] = $true
  $adjacency[$node.taskId] = @()
}

foreach ($edge in $dag.edges) {
  foreach ($name in @("from", "to", "reason")) {
    Assert-HasProperty -Object $edge -Name $name -Context "Task edge"
  }

  if (-not $taskIds.ContainsKey($edge.from)) {
    throw "Task edge references unknown source task: $($edge.from)"
  }

  if (-not $taskIds.ContainsKey($edge.to)) {
    throw "Task edge references unknown target task: $($edge.to)"
  }

  $adjacency[$edge.from] = @($adjacency[$edge.from]) + $edge.to
}

foreach ($wave in $dag.waves) {
  Assert-Array -Value $wave -Context "Task DAG wave"
  foreach ($taskId in $wave) {
    if (-not $taskIds.ContainsKey($taskId)) {
      throw "Task wave references unknown task: ${taskId}"
    }
  }
}

$temporary = @{}
$permanent = @{}
foreach ($taskId in $taskIds.Keys) {
  Visit-Node -Node $taskId -Adjacency $adjacency -Temporary $temporary -Permanent $permanent
}

Write-Output "Harness task DAG validation passed."
Write-Output "Task DAG file: ${TaskDagFile}"
Write-Output "Tasks checked: $($dag.nodes.Count)"
Write-Output "Edges checked: $($dag.edges.Count)"
Write-Output "Waves checked: $($dag.waves.Count)"
