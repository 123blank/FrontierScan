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
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    & git -C $temporaryRoot init -b dev | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke git init failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot config user.email "state-smoke@example.test"
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke git config email failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot config user.name "State Runtime Smoke"
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke git config name failed with exit code $LASTEXITCODE" }
    Set-Content -LiteralPath (Join-Path $temporaryRoot "seed.txt") -Value "seed" -NoNewline -Encoding utf8
    & git -C $temporaryRoot add seed.txt
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke git add failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot commit -m "state runtime smoke fixture" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke git commit failed with exit code $LASTEXITCODE" }

    New-Item -ItemType Directory -Path (Join-Path $temporaryRoot ".harness\states") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $temporaryRoot ".harness\workflows") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $temporaryRoot ".codex\agents") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root ".harness\states\e2e-state.template.json") -Destination (Join-Path $temporaryRoot ".harness\states\e2e-state.template.json")
    Copy-Item -LiteralPath (Join-Path $Root ".harness\states\e2e-state-v2.template.json") -Destination (Join-Path $temporaryRoot ".harness\states\e2e-state-v2.template.json")
    Copy-Item -LiteralPath (Join-Path $Root ".harness\workflows\e2e-development.yaml") -Destination (Join-Path $temporaryRoot ".harness\workflows\e2e-development.yaml")
    Copy-Item -LiteralPath (Join-Path $Root ".harness\workflows\e2e-development-v2.yaml") -Destination (Join-Path $temporaryRoot ".harness\workflows\e2e-development-v2.yaml")
    Copy-Item -LiteralPath (Join-Path $Root ".codex\agents\agents.yaml") -Destination (Join-Path $temporaryRoot ".codex\agents\agents.yaml")
    Copy-Item -LiteralPath (Join-Path $Root ".codex\agents\worker-policies.json") -Destination (Join-Path $temporaryRoot ".codex\agents\worker-policies.json")
    & git -C $temporaryRoot add .harness .codex
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke git add Harness assets failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot commit -m "add Harness smoke assets" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "State Runtime smoke Harness asset commit failed with exit code $LASTEXITCODE" }
    $stateRunner = Join-Path $Root ".harness\scripts\run-state.ps1"
    $storyRunner = Join-Path $Root ".harness\scripts\run-story.ps1"
    & $stateRunner -Command init -Root $temporaryRoot -StoryId "SMOKE-M3" -Summary "验证单 Story Dispatcher" -Json | Out-Null
    & $stateRunner -Command status -Root $temporaryRoot -Json | Out-Null
    & $stateRunner -Command validate -Root $temporaryRoot -Json | Out-Null
    $prepared = (& $storyRunner -Command prepare -Root $temporaryRoot -Json | Out-String) | ConvertFrom-Json
    & $storyRunner -Command status -Root $temporaryRoot -Json | Out-Null

    $workerModuleUri = ([System.Uri]::new((Resolve-Path (Join-Path $Root ".harness\scripts\lib\worker-runtime.mjs")).Path)).AbsoluteUri
    $workerSource = @"
import { runWorkerTask } from '$workerModuleUri';
import { createHash } from 'node:crypto';
const root = process.argv[1];
const taskFile = process.argv[2];
await runWorkerTask({
  root,
  taskFile,
  provider: ({ task }) => {
    const content = '# Smoke requirement\n';
    return {
      files: task.expectedOutputs.map((output) => ({ path: output, content, capability: 'phase-output' })),
      result: {
        schemaVersion: task.schemaVersion,
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        runId: task.runId,
        phase: task.phase,
        preparedRevision: task.preparedRevision,
        status: 'completed',
        summary: 'Smoke mock worker completed.',
        outputs: task.expectedOutputs.map((output) => ({
          path: output,
          sha256: 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex'),
          bytes: Buffer.byteLength(content, 'utf8')
        })),
        records: [],
        payload: {
          acceptanceCriteria: [{
            criterionId: 'AC-001',
            description: 'The smoke requirement is captured.',
            source: 'smoke-fixture',
            required: true
          }],
          openQuestions: [],
          inScope: ['Harness smoke flow'],
          outOfScope: []
        }
      }
    };
  }
});
"@
    & node --input-type=module --eval $workerSource $temporaryRoot $prepared.taskFile
    if ($LASTEXITCODE -ne 0) { throw "M4-B worker smoke failed with exit code $LASTEXITCODE" }
    & $storyRunner -Command apply -Root $temporaryRoot -Json | Out-Null
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
}

Invoke-Step -Name "Serial Batch Protocol" -Action {
  $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "frontierscan-harness-batch-smoke-$([guid]::NewGuid().ToString('N'))"
  try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    & git -C $temporaryRoot init -b dev | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Batch smoke git init failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot config user.email "batch-smoke@example.test"
    if ($LASTEXITCODE -ne 0) { throw "Batch smoke git config email failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot config user.name "Batch Smoke"
    if ($LASTEXITCODE -ne 0) { throw "Batch smoke git config name failed with exit code $LASTEXITCODE" }
    Set-Content -LiteralPath (Join-Path $temporaryRoot "seed.txt") -Value "seed" -NoNewline -Encoding utf8
    & git -C $temporaryRoot add seed.txt
    if ($LASTEXITCODE -ne 0) { throw "Batch smoke git add failed with exit code $LASTEXITCODE" }
    & git -C $temporaryRoot commit -m "batch smoke fixture" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Batch smoke git commit failed with exit code $LASTEXITCODE" }

    $storyRuntimeUri = ([System.Uri]::new((Resolve-Path (Join-Path $Root ".harness\scripts\lib\story-runtime.mjs")).Path)).AbsoluteUri
    $worktreeRuntimeUri = ([System.Uri]::new((Resolve-Path (Join-Path $Root ".harness\scripts\lib\worktree-runtime.mjs")).Path)).AbsoluteUri
    $batchSource = @"
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runStoryCommand } from '$storyRuntimeUri';
import { runWorktreeCommand } from '$worktreeRuntimeUri';

const execFileAsync = promisify(execFile);
const root = process.argv[1];
const stateFile = '.harness/states/e2e-smoke-batch.json';
const taskDagFile = '.harness/runs/SMOKE-BATCH/phases/02-task-dag/task-dag.json';
const state = {
  schemaVersion: '1.0',
  storyId: 'SMOKE-BATCH',
  phase: 'implementation',
  requirement: { summary: 'Serial batch smoke', openQuestions: [], acceptanceCriteria: [] },
  knowledge: { loadedFiles: [], staleFiles: [], missingAreas: [] },
  tasks: [],
  dag: { nodes: [], edges: [], waves: [] },
  worktrees: [],
  tests: { commands: [], results: [] },
  review: { findings: [], status: 'pending' },
  verification: { cases: [], results: [] },
  delivery: { ownedFiles: [], commit: null, pr: null },
  logs: [],
  runtime: {
    runId: 'SMOKE-BATCH', status: 'active', revision: 4,
    workflow: '.harness/workflows/e2e-development.yaml', records: [],
    previousPhase: null, blocked: null,
    createdAt: '2026-07-28T02:00:00.000Z', updatedAt: '2026-07-28T02:00:00.000Z',
  },
};
const dag = {
  schemaVersion: '1.0',
  storyId: state.storyId,
  nodes: [
    {
      taskId: 'T1', title: 'Backend smoke candidate', type: 'backend', status: 'pending',
      ownerAgent: 'backend-developer', predictedFiles: ['backend/src/**'], acceptanceCriteria: ['Backend candidate is planned.'],
    },
    {
      taskId: 'T2', title: 'Frontend smoke candidate', type: 'frontend', status: 'pending',
      ownerAgent: 'frontend-developer', predictedFiles: ['frontend/src/**'], acceptanceCriteria: ['Frontend candidate is planned.'],
    },
  ],
  edges: [{ from: 'T1', to: 'T2', reason: 'The frontend task follows the backend task.' }],
  waves: [['T1'], ['T2']],
  globalChanges: [],
  risks: [],
};
const executeGit = async (args) => {
  if (args[0] === 'worktree' && (args[1] === 'add' || args[1] === 'remove')) {
    throw new Error('Serial batch smoke must not create or remove a Worktree.');
  }
  return execFileAsync('git', args, { cwd: root, windowsHide: true });
};
await mkdir(path.dirname(path.join(root, stateFile)), { recursive: true });
await mkdir(path.dirname(path.join(root, taskDagFile)), { recursive: true });
await mkdir(path.dirname(path.join(root, state.runtime.workflow)), { recursive: true });
await writeFile(path.join(root, stateFile), JSON.stringify(state, null, 2) + '\n', 'utf8');
await writeFile(path.join(root, taskDagFile), JSON.stringify(dag, null, 2) + '\n', 'utf8');
await writeFile(path.join(root, state.runtime.workflow),
  'schema_version: "1.0"\n'
  + 'name: frontier-e2e-development\n'
  + 'state_file: .harness/states/e2e-state.template.json\n'
  + 'phases:\n'
  + '  - id: implementation\n'
  + '    order: 1\n'
  + '    owner_agent: backend-developer\n'
  + '    purpose: Serial batch smoke\n'
  + '    required_outputs:\n'
  + '    next:\n'
  + '      - done\n',
  'utf8');
const before = await readFile(path.join(root, stateFile), 'utf8');
const prepared = await runStoryCommand({
  root,
  command: 'prepare-batch',
  stateFile,
  taskDagFile,
  executeGit,
  now: () => '2026-07-28T02:00:00.000Z',
});
if (prepared.ledger.tasks.length !== 2) throw new Error('Serial batch smoke did not create two tasks.');
const planned = await runWorktreeCommand({
  root,
  command: 'batch-plan',
  stateFile,
  executeGit,
  now: () => '2026-07-28T02:00:01.000Z',
});
if (planned.plan.batchId !== prepared.ledger.batchId || planned.status.state !== 'absent') {
  throw new Error('Serial batch smoke plan did not match the prepared ledger.');
}
const observed = await runWorktreeCommand({ root, command: 'batch-status', stateFile, executeGit });
if (observed.status.state !== 'absent') throw new Error('Serial batch smoke unexpectedly created a Worktree.');
if (await readFile(path.join(root, stateFile), 'utf8') !== before) {
  throw new Error('Serial batch smoke changed the Harness state.');
}
"@
    & node --input-type=module --eval $batchSource $temporaryRoot
    if ($LASTEXITCODE -ne 0) { throw "Serial batch protocol smoke failed with exit code $LASTEXITCODE" }
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
}

Invoke-Step -Name "Task DAG" -Action {
  & (Join-Path $Root ".harness\scripts\validate-task-dag.ps1") -TaskDagFile $TaskDagFile
}

Invoke-Step -Name "M7-A3 Acceptance Gates" -Action {
  & node (Join-Path $Root ".harness\scripts\tests\acceptance-gate.test.mjs")
  if ($LASTEXITCODE -ne 0) { throw "M7-A3 acceptance gate smoke failed with exit code $LASTEXITCODE" }
  & node (Join-Path $Root ".harness\scripts\tests\approval-contract.test.mjs")
  if ($LASTEXITCODE -ne 0) { throw "M7-A3 approval contract smoke failed with exit code $LASTEXITCODE" }
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
