import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { claimBatchTask, prepareSerialBatch, recordBatchIntegration } from "../lib/batch-runtime.mjs";
import {
  claimWaveTask,
  createWaveExecutionLedger,
  finalizeWaveExecution,
  freezeWaveIntegration,
  inspectWaveExecution,
  integrateWave,
  recoverAttempt,
  recoverWaveIntegration,
  recoverWaveFreeze,
  runWaveExecutionCommand,
} from "../lib/worktree-wave-execution-runtime.mjs";
import { acquireImplementationOwner } from "../lib/implementation-owner-contract.mjs";
import { runStateCommand } from "../lib/state-runtime.mjs";
import { runWorktreeWorker } from "../lib/worktree-worker-runtime.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";
import { resolveBatchBase, runWorktreeCommand } from "../lib/worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryRoots = [];

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b1-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5b1@example.test");
  await git(root, "config", "user.name", "M5-B1 Test");
  await writeFile(path.join(root, ".gitignore"), await readFile(path.join(repositoryRoot, ".gitignore"), "utf8"), "utf8");
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await mkdir(path.join(root, ".harness/workflows"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".harness/workflows/e2e-development.yaml"), path.join(root, ".harness/workflows/e2e-development.yaml"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs/base.md"), "base context\n", "utf8");
  await mkdir(path.join(root, "backend/src/main"), { recursive: true });
  await writeFile(path.join(root, "backend/src/main/ExistingService.java"), "class ExistingService {}\n", "utf8");
  await git(root, "add", ".gitignore", "seed.txt", ".codex/agents", ".harness/workflows", "docs/base.md", "backend/src/main/ExistingService.java");
  await git(root, "commit", "-m", "fixture");

  const storyId = options.storyId ?? "M5-B1-FIXTURE";
  const runId = storyId;
  const taskId = "T1";
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = `.harness/runs/${runId}/phases/02-task-dag/task-dag.json`;
  const taskFile = `.harness/runs/${runId}/phases/03-implementation/task.json`;
  const runContextFile = `.harness/runs/${runId}/phases/00-requirement/requirement-breakdown.md`;
  const state = {
    schemaVersion: "1.0",
    storyId,
    phase: "implementation",
    runtime: {
      runId,
      workflow: ".harness/workflows/e2e-development.yaml",
      status: "active",
      revision: 4,
      previousPhase: "task-dag",
      blocked: null,
      records: [],
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z"
    },
    requirement: { summary: "M5-B1 fixture", openQuestions: [], acceptanceCriteria: [] },
    knowledge: { loadedFiles: [], staleFiles: [], missingAreas: [] },
    tasks: [],
    dag: { nodes: [], edges: [], waves: [] },
    worktrees: [],
    tests: { commands: [], results: [] },
    review: { findings: [], status: "pending" },
    verification: { cases: [], results: [] },
    delivery: { ownedFiles: [], commit: null, pr: null },
    logs: [],
  };
  const nodes = [{
    taskId,
    title: "Run one constrained Worker",
    type: "integration",
    status: "pending",
    predictedFiles: [".harness/scripts/lib/worktree-worker-runtime.mjs"],
    acceptanceCriteria: ["Worker result is collected safely."],
    ownerAgent: options.dagOwner ?? "backend-developer",
  }];
  if (options.additionalTask) {
    nodes.push({
      taskId: "T2",
      title: "A second task",
      type: "docs",
      status: "pending",
      predictedFiles: ["docs/second-task.md"],
      acceptanceCriteria: ["Second task is complete."],
      ownerAgent: "backend-developer",
    });
  }
  const dag = {
    schemaVersion: "1.0",
    storyId,
    nodes,
    edges: [],
    waves: options.additionalTask ? [[taskId], ["T2"]] : [[taskId]],
    globalChanges: [],
    risks: [],
  };
  const task = {
    schemaVersion: "1.0",
    dispatchId: "11111111-1111-4111-8111-111111111111",
    storyId,
    phase: "implementation",
    ownerAgent: options.taskOwner ?? "backend-developer",
    purpose: "Implement task-owned changes only.",
    preparedRevision: options.preparedRevision ?? 4,
    preparedAt: "2026-07-21T00:00:00.000Z",
    expectedOutputs: [`.harness/runs/${runId}/phases/03-implementation/implementation-notes.md`],
    allowedAdapters: [],
    next: "unit-test",
  };
  const checkpointFile = taskFile.replace(/task\.json$/, "checkpoint.json");
  const checkpoint = {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId,
    phase: task.phase,
    status: "prepared",
    preparedAt: task.preparedAt,
    updatedAt: task.preparedAt,
  };
  for (const [relative, value] of [[stateFile, state], [taskDagFile, dag], [taskFile, task], [checkpointFile, checkpoint]]) {
    const fullPath = path.join(root, relative);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  const runContextPath = path.join(root, runContextFile);
  await mkdir(path.dirname(runContextPath), { recursive: true });
  await writeFile(runContextPath, "current run context\n", "utf8");
  await runWorktreeCommand({ root, command: "plan", stateFile, taskDagFile, taskId });
  if (options.createWorktree !== false) {
    await runWorktreeCommand({ root, command: "create", stateFile, taskId, confirmCreate: true });
  }
  return { root, storyId, runId, taskId, stateFile, taskDagFile, taskFile, checkpointFile, runContextFile, state, dag, task };
}

async function createBatchWorkerFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b3-worker-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5b3-worker@example.test");
  await git(root, "config", "user.name", "M5-B3 Worker Test");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await mkdir(path.join(root, "backend/src/service"), { recursive: true });
  await writeFile(path.join(root, "backend/src/service/SharedService.java"), "class SharedService {}\n", "utf8");
  await git(root, "add", ".gitignore", ".codex/agents", "backend/src/service/SharedService.java");
  await git(root, "commit", "-m", "fixture");

  const storyId = options.storyId ?? "M5-B3-B-WORKER-FIXTURE";
  const runId = options.runId ?? storyId;
  const secondType = options.secondType ?? "backend";
  const secondOwner = options.secondOwner ?? (secondType === "frontend" ? "frontend-developer" : "backend-developer");
  const secondPredictedFiles = options.secondPredictedFiles
    ?? (secondType === "frontend" ? ["frontend/src/views/**"] : ["backend/src/service/**"]);
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = `.harness/runs/${runId}/phases/02-task-dag/task-dag.json`;
  const state = {
    schemaVersion: "1.0",
    storyId,
    phase: "implementation",
    runtime: { runId, status: "active", revision: 4 },
  };
  const dag = {
    schemaVersion: "1.0",
    storyId,
    nodes: [
      {
        taskId: "T1",
        title: "Implement shared backend change",
        type: "backend",
        status: "pending",
        predictedFiles: ["backend/src/service/**"],
        acceptanceCriteria: ["The first backend candidate is ready."],
        ownerAgent: "backend-developer",
      },
      {
        taskId: "T2",
        title: `Refine shared ${secondType} change`,
        type: secondType,
        status: "pending",
        predictedFiles: secondPredictedFiles,
        acceptanceCriteria: [`The inherited ${secondType} candidate is refined.`],
        ownerAgent: secondOwner,
      },
    ],
    edges: [{ from: "T1", to: "T2", reason: "T2 consumes T1 output." }],
    waves: [["T1"], ["T2"]],
    globalChanges: [],
    risks: [],
  };
  await mkdir(path.join(root, path.dirname(stateFile)), { recursive: true });
  await mkdir(path.join(root, path.dirname(taskDagFile)), { recursive: true });
  await writeFile(path.join(root, stateFile), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, taskDagFile), `${JSON.stringify(dag, null, 2)}\n`, "utf8");
  const prepared = await prepareSerialBatch({
    root,
    stateFile,
    taskDagFile,
    base: await resolveBatchBase({ root }),
    now: () => "2026-07-24T00:00:00.000Z",
  });
  await runWorktreeCommand({ root, command: "batch-plan", stateFile, now: () => "2026-07-24T00:01:00.000Z" });
  if (options.createWorktree !== false) {
    await runWorktreeCommand({ root, command: "batch-create", stateFile, confirmCreate: true });
  }
  return { root, storyId, runId, stateFile, taskDagFile, state, dag, prepared };
}

async function createWaveWorkerFixture({ claimTask = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5dc1-worker-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5dc1-worker@example.test");
  await git(root, "config", "user.name", "M5-D-C1 Worker Test");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");

  const storyId = "M5-D-C1-WORKTREE-WORKER";
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`;
  const state = {
    schemaVersion: "1.0",
    storyId,
    phase: "implementation",
    runtime: { runId: storyId, status: "active", revision: 7 },
  };
  const dag = {
    schemaVersion: "1.0",
    storyId,
    nodes: [
      {
        taskId: "T1",
        title: "Implement backend candidate",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/main/**"],
        acceptanceCriteria: ["Backend candidate is ready."],
      },
      {
        taskId: "T2",
        title: "Implement frontend candidate",
        type: "frontend",
        status: "pending",
        ownerAgent: "frontend-developer",
        predictedFiles: ["frontend/src/**"],
        acceptanceCriteria: ["Frontend candidate is ready."],
      },
    ],
    edges: [],
    waves: [["T1", "T2"]],
    globalChanges: [],
    risks: [],
  };
  for (const [relative, value] of [[stateFile, state], [taskDagFile, dag]]) {
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  await git(root, "add", "-f", ".gitignore", ".codex/agents", "seed.txt", stateFile, taskDagFile);
  await git(root, "commit", "-m", "fixture");

  const planned = await runWorktreeCommand({
    root,
    command: "wave-plan",
    stateFile,
    taskDagFile,
    waveIndex: 1,
  });
  const created = await runWorktreeCommand({
    root,
    command: "wave-create",
    stateFile,
    taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
  });
  const waveId = "wave-0123456789abcdef";
  const preparedTasks = planned.plan.tasks.map((planTask, index) => {
    const taskRoot = `.harness/runs/${storyId}/waves/${waveId}/tasks/${planTask.taskId}`;
    const task = {
      schemaVersion: "1.2",
      dispatchId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      storyId,
      runId: storyId,
      phase: "implementation",
      waveId,
      waveIndex: 1,
      taskId: planTask.taskId,
      taskRoot,
      ownerAgent: planTask.ownerAgent,
      purpose: planTask.title,
      preparedRevision: 7,
      preparedAt: "2026-08-06T00:00:00.000Z",
      expectedOutputs: [`${taskRoot}/task-report.md`],
      allowedAdapters: [],
      next: "unit-test",
    };
    return {
      task,
      taskFile: `${taskRoot}/task.json`,
      checkpointFile: `${taskRoot}/checkpoint.json`,
      checkpoint: {
        schemaVersion: "1.2",
        dispatchId: task.dispatchId,
        storyId,
        runId: storyId,
        phase: task.phase,
        waveId,
        waveIndex: 1,
        taskId: task.taskId,
        taskRoot,
        status: "prepared",
        preparedAt: task.preparedAt,
        updatedAt: task.preparedAt,
      },
    };
  });
  for (const item of preparedTasks) {
    for (const [relative, value] of [[item.taskFile, item.task], [item.checkpointFile, item.checkpoint]]) {
      await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
      await writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
  }
  const wave = {
    waveIndex: 1,
    taskDagFile,
    taskDagSha256: sha256(await readFile(path.join(root, taskDagFile))),
    planFile: planned.planFile,
    planSha256: planned.status.wavePlanSha256,
    creationReceiptFile: created.receiptFile,
    creationReceiptSha256: sha256(await readFile(path.join(root, created.receiptFile))),
    plan: planned.plan,
  };
  await acquireImplementationOwner({
    root,
    state,
    mode: "worktree-wave",
    ownerId: waveId,
    taskDagFile,
    now: () => "2026-08-06T00:00:00.000Z",
  });
  const ledger = await createWaveExecutionLedger({
    root,
    state,
    wave,
    waveId,
    tasks: preparedTasks,
    now: () => "2026-08-06T00:00:00.000Z",
  });
  const claimed = claimTask
    ? await claimWaveTask({
      root,
      ledgerFile: ledger.ledgerFile,
      taskId: "T1",
      expectedWaveLedgerSha256: sha256(await readFile(path.join(root, ledger.ledgerFile))),
      expectedCreationReceiptSha256: wave.creationReceiptSha256,
      now: () => "2026-08-06T00:01:00.000Z",
      randomUUID: (() => {
        const values = [
          "00000000-0000-4000-8000-000000000011",
          "00000000-0000-4000-8000-000000000012",
          "00000000-0000-4000-8000-000000000013",
        ];
        return () => values.shift();
      })(),
    })
    : null;
  return {
    root,
    stateFile,
    taskDagFile,
    state,
    planned,
    created,
    wave,
    ledger,
    claimed,
    task: preparedTasks[0].task,
    taskFile: preparedTasks[0].taskFile,
  };
}

function batchWorkerResponse(task, businessFile, content, capability = "backend-write") {
  return {
    files: [
      { path: task.expectedOutputs[0], content: `# ${task.taskId} report\n`, capability: "phase-output" },
      { path: businessFile, content, capability },
    ],
    result: {
      schemaVersion: "1.1",
      dispatchId: task.dispatchId,
      storyId: task.storyId,
      phase: task.phase,
      batchId: task.batchId,
      taskId: task.taskId,
      taskRoot: task.taskRoot,
      status: "completed",
      summary: `${task.taskId} completed its backend candidate.`,
      outputs: task.expectedOutputs.map((output) => ({ path: output })),
      records: [],
    },
  };
}

function batchWorkerFailureResponse(task, status) {
  const response = batchWorkerResponse(
    task,
    "backend/src/service/SharedService.java",
    "class SharedService { void failed() {} }\n",
  );
  response.result.status = status;
  response.result.summary = `${task.taskId} reported ${status}.`;
  if (status === "blocked") {
    response.result.blocker = {
      reason: "The mock Worker requires an external decision.",
      owner: "user",
      suggestedAction: "Resolve the fixture blocker and retry a new batch.",
    };
  }
  return response;
}

async function integrateBatchTask(fixture, task) {
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  const currentTask = ledger.tasks.find((candidate) => candidate.taskId === task.taskId);
  const execution = JSON.parse(await readFile(path.join(fixture.root, currentTask.executionReceiptFile), "utf8"));
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  for (const file of execution.files) {
    const target = path.join(fixture.root, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(worktreeRoot, file.path)));
  }
  const planFile = `${path.posix.dirname(currentTask.integrationReceiptFile)}/integration-plan.json`;
  const plan = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.runId,
    batchId: ledger.batchId,
    taskId: currentTask.taskId,
    taskRoot: currentTask.taskRoot,
    dispatchId: currentTask.dispatchId,
    phase: "implementation",
    ownerAgent: currentTask.ownerAgent,
    baseCommit: ledger.baseCommit,
    resultFile: currentTask.resultFile,
    executionReceiptFile: currentTask.executionReceiptFile,
    executionReceiptSha256: currentTask.executionReceiptSha256,
    workerResultEvidenceFile: currentTask.resultFile,
    workerResultSha256: execution.resultSha256,
  };
  const planBuffer = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(path.join(fixture.root, planFile)), { recursive: true });
  await writeFile(path.join(fixture.root, planFile), planBuffer);
  const receipt = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.runId,
    taskId: currentTask.taskId,
    dispatchId: currentTask.dispatchId,
    phase: "implementation",
    ownerAgent: currentTask.ownerAgent,
    baseCommit: ledger.baseCommit,
    planSha256: sha256(planBuffer),
    resultFile: currentTask.resultFile,
    resultSha256: execution.resultSha256,
    appliedFiles: execution.files.map(({ path: filePath, kind, sha256, bytes }) => ({ path: filePath, kind, sha256, bytes })),
    completedAt: "2026-07-24T00:03:00.000Z",
  };
  await writeFile(path.join(fixture.root, currentTask.integrationReceiptFile), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return recordBatchIntegration({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: currentTask.taskId,
    integrationReceiptFile: currentTask.integrationReceiptFile,
  });
}

async function prepareSecondBatchTask(fixture) {
  const firstTask = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: firstTask.taskId,
  });
  await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: firstTask.taskId,
    taskFile: firstTask.taskFile,
    provider: ({ task }) => batchWorkerResponse(
      task,
      "backend/src/service/SharedService.java",
      "class SharedService { void first() {} }\n",
    ),
  });
  await integrateBatchTask(fixture, firstTask);
  return (await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: "T2",
  })).task;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("exports the M5-B1 internal orchestration entry", async () => {
  assert.equal(typeof runWorktreeWorker, "function");
});

test("rejects a DAG and M3 owner mismatch before calling the Provider", async () => {
  const fixture = await createFixture({ dagOwner: "frontend-developer" });
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /owner/i,
  );
  assert.equal(providerCalls, 0);
});

test("rejects a multi-task DAG before calling the Provider", async () => {
  const fixture = await createFixture({ additionalTask: true });
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /exactly one task/i,
  );
  assert.equal(providerCalls, 0);
});

test("batch Worker rejects missing ledger, identity drift, unclaimed tasks, and absent batch Worktrees before the Provider", async () => {
  const missingLedger = await createBatchWorkerFixture({ createWorktree: false });
  const missingTask = missingLedger.prepared.ledger.tasks[0];
  await rm(path.join(missingLedger.root, missingLedger.prepared.batchFile));
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: missingLedger.root,
      stateFile: missingLedger.stateFile,
      taskId: missingTask.taskId,
      taskFile: missingTask.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /serial batch.*ledger|batch.*ledger/i,
  );
  assert.equal(providerCalls, 0);

  const identityDrift = await createBatchWorkerFixture({ createWorktree: false });
  const identityTask = identityDrift.prepared.ledger.tasks[0];
  const taskPath = path.join(identityDrift.root, identityTask.taskFile);
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  task.ownerAgent = "frontend-developer";
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeWorker({
      root: identityDrift.root,
      stateFile: identityDrift.stateFile,
      taskId: identityTask.taskId,
      taskFile: identityTask.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /task dispatch.*ledger|dispatch.*identity/i,
  );
  assert.equal(providerCalls, 0);

  const unclaimed = await createBatchWorkerFixture();
  const unclaimedTask = unclaimed.prepared.ledger.tasks[0];
  await assert.rejects(
    runWorktreeWorker({
      root: unclaimed.root,
      stateFile: unclaimed.stateFile,
      taskId: unclaimedTask.taskId,
      taskFile: unclaimedTask.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /running task|claim/i,
  );
  assert.equal(providerCalls, 0);

  const mismatchedTaskId = await createBatchWorkerFixture();
  const mismatchedTask = mismatchedTaskId.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: mismatchedTaskId.root,
    stateFile: mismatchedTaskId.stateFile,
    batchFile: mismatchedTaskId.prepared.batchFile,
    taskId: mismatchedTask.taskId,
  });
  await assert.rejects(
    runWorktreeWorker({
      root: mismatchedTaskId.root,
      stateFile: mismatchedTaskId.stateFile,
      taskId: "T2",
      taskFile: mismatchedTask.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /taskId.*task file|task file.*taskId|task identity/i,
  );
  assert.equal(providerCalls, 0);

  const absent = await createBatchWorkerFixture({ createWorktree: false });
  const absentTask = absent.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: absent.root,
    stateFile: absent.stateFile,
    batchFile: absent.prepared.batchFile,
    taskId: absentTask.taskId,
  });
  await assert.rejects(
    runWorktreeWorker({
      root: absent.root,
      stateFile: absent.stateFile,
      taskId: absentTask.taskId,
      taskFile: absentTask.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /batch Worktree.*created|must be created/i,
  );
  assert.equal(providerCalls, 0);
});

test("batch Worker rejects a caller-supplied readiness-transition lock bypass", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      allowReadyTransitionLock: true,
      provider: async () => { providerCalls += 1; },
    }),
    /allowReadyTransitionLock.*internal|internal.*allowReadyTransitionLock/i,
  );

  assert.equal(providerCalls, 0);
});

test("batch Worker executes one claimed task into task-scoped evidence and only advances the ledger", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });

  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider: ({ task: workerTask }) => batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void first() {} }\n",
    ),
  });

  assert.equal(completed.outcome, "ready-for-integration");
  assert.equal(completed.receiptFile, task.executionReceiptFile);
  assert.equal(completed.resultFile, task.resultFile);
  const receipt = JSON.parse(await readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"));
  assert.equal(receipt.resultEvidenceFile, task.resultFile);
  assert.match(receipt.inheritedSnapshotSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, task.resultFile), "utf8")).taskId, task.taskId);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
});

test("batch Worker removes a failed collected-result temporary file before retrying", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const resultPath = path.join(fixture.root, task.resultFile);
  const resultDirectory = path.dirname(resultPath);
  const temporaryPrefix = `${path.basename(resultPath)}.tmp-`;
  let providerCalls = 0;
  const provider = ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void retryAfterCollectionFailure() {} }\n",
    );
  };

  await mkdir(resultPath, { recursive: true });
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
    }),
    /rename|EPERM|EEXIST|EISDIR/i,
  );
  assert.equal((await readdir(resultDirectory)).some((file) => file.startsWith(temporaryPrefix)), false);

  await rm(resultPath, { recursive: true, force: true });
  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider,
  });
  assert.equal(retried.outcome, "ready-for-integration");
  assert.equal(providerCalls, 1);
});

test("batch Worker clears its execution lock when lock initialization fails", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const lockPath = path.join(fixture.root, path.dirname(task.executionReceiptFile), "execute.lock");
  let providerCalls = 0;
  const provider = ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void retryAfterLockFailure() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      now: () => { throw new Error("simulated batch execution lock initialization failure"); },
    }),
    /simulated batch execution lock initialization failure/,
  );
  assert.equal(providerCalls, 0);
  await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/);

  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider,
  });
  assert.equal(retried.outcome, "ready-for-integration");
  assert.equal(providerCalls, 1);
});

test("batch Worker rejects unauthorized explicit context before writing inputs and supports a clean retry", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  const manifestFile = path.join(fixture.root, path.dirname(task.executionReceiptFile), "task-start-manifest.json");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      contextFiles: [".gitignore"],
      provider: async () => { providerCalls += 1; },
    }),
    /context file.*read policy|read policy.*\.gitignore/i,
  );

  assert.equal(providerCalls, 0);
  await assert.rejects(readFile(manifestFile, "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(worktreeRoot, task.taskFile), "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(worktreeRoot, task.checkpointFile), "utf8"), /ENOENT/);
  let ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");

  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider: ({ task: workerTask }) => batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void retried() {} }\n",
    ),
  });

  assert.equal(retried.outcome, "ready-for-integration");
  ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker accepts a Windows case-variant context allowed by its read policy", {
  skip: process.platform !== "win32",
}, async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  const manifestFile = path.join(fixture.root, path.dirname(task.executionReceiptFile), "task-start-manifest.json");
  let providerCalls = 0;
  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    contextFiles: ["BACKEND/src/service/SharedService.java"],
    provider: ({ task: workerTask }) => {
      providerCalls += 1;
      return batchWorkerResponse(
        workerTask,
        "backend/src/service/RetryService.java",
        "class RetryService { void caseVariant() {} }\n",
      );
    },
  });

  assert.equal(completed.outcome, "ready-for-integration");
  assert.equal(providerCalls, 1);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  assert.equal(manifest.inputs.find((input) => input.sourcePath === "BACKEND/src/service/SharedService.java")?.source, "worktree-base");
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker reads a Windows case-variant current-run context from the main run", {
  skip: process.platform !== "win32",
}, async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  const contextFile = `.harness/runs/${fixture.runId}/phases/03-implementation/main-run-context.md`;
  const caseVariantContext = contextFile.toUpperCase();
  await mkdir(path.dirname(path.join(fixture.root, contextFile)), { recursive: true });
  await writeFile(path.join(fixture.root, contextFile), "main-run-only context\n", "utf8");
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let receivedContext;

  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    contextFiles: [caseVariantContext],
    provider: ({ task: workerTask, context }) => {
      receivedContext = context;
      return batchWorkerResponse(
        workerTask,
        "backend/src/service/MainRunContextService.java",
        "class MainRunContextService {}\n",
      );
    },
  });

  assert.equal(completed.outcome, "ready-for-integration");
  assert.deepEqual(receivedContext, [{ path: caseVariantContext, content: "main-run-only context\n" }]);
  const manifest = JSON.parse(await readFile(path.join(fixture.root, path.dirname(task.executionReceiptFile), "task-start-manifest.json"), "utf8"));
  assert.equal(manifest.inputs.find((input) => input.sourcePath === caseVariantContext)?.source, "main-run");
});

test("batch Worker rejects oversized context before writing inputs and supports a clean retry", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const contextFiles = Array.from(
    { length: 5 },
    (_, index) => `.harness/runs/${fixture.runId}/phases/03-implementation/oversized-context-${index}.txt`,
  );
  for (const contextFile of contextFiles) {
    const target = path.join(fixture.root, contextFile);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.alloc(1_700_000, "x"));
  }
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  const manifestFile = path.join(fixture.root, path.dirname(task.executionReceiptFile), "task-start-manifest.json");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      contextFiles,
      provider: async () => { providerCalls += 1; },
    }),
    /context exceeds the 8 MiB total limit/i,
  );

  assert.equal(providerCalls, 0);
  await assert.rejects(readFile(manifestFile, "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(worktreeRoot, task.taskFile), "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(worktreeRoot, task.checkpointFile), "utf8"), /ENOENT/);
  let ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");

  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider: ({ task: workerTask }) => batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void retriedAfterLimit() {} }\n",
    ),
  });

  assert.equal(retried.outcome, "ready-for-integration");
  ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker binds a distinct active run ID through its ledger and task root", async () => {
  const fixture = await createBatchWorkerFixture({
    runId: "M5-B3-B-RUN-42",
  });
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });

  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider: ({ task: workerTask }) => batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void distinctRun() {} }\n",
    ),
  });

  assert.equal(task.taskRoot.startsWith(`.harness/runs/${fixture.runId}/`), true);
  assert.equal(completed.outcome, "ready-for-integration");
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.runId, fixture.runId);
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker rejects main-root inherited drift before calling the Provider", async () => {
  const fixture = await createBatchWorkerFixture();
  const firstTask = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: firstTask.taskId,
  });
  await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: firstTask.taskId,
    taskFile: firstTask.taskFile,
    provider: ({ task }) => batchWorkerResponse(
      task,
      "backend/src/service/SharedService.java",
      "class SharedService { void first() {} }\n",
    ),
  });
  await integrateBatchTask(fixture, firstTask);
  const secondTask = (await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: "T2",
  })).task;
  await writeFile(
    path.join(fixture.root, "backend/src/service/SharedService.java"),
    "class SharedService { void manualDrift() {} }\n",
    "utf8",
  );
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: secondTask.taskId,
      taskFile: secondTask.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /inherited main.*hash drifted|main.*inherited.*drift/i,
  );

  assert.equal(providerCalls, 0);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "integrated");
  assert.equal(ledger.tasks[1].status, "running");
  assert.equal(ledger.tasks[1].executionReceiptSha256, null);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
  await assert.rejects(readFile(path.join(fixture.root, secondTask.executionReceiptFile), "utf8"), /ENOENT/);
});

test("batch Worker gives a later task the integrated inherited file and permits its declared rewrite", async () => {
  const fixture = await createBatchWorkerFixture();
  const firstTask = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: firstTask.taskId,
  });
  await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: firstTask.taskId,
    taskFile: firstTask.taskFile,
    provider: ({ task }) => batchWorkerResponse(
      task,
      "backend/src/service/SharedService.java",
      "class SharedService { void first() {} }\n",
    ),
  });
  await integrateBatchTask(fixture, firstTask);
  const secondTask = (await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: "T2",
  })).task;
  let inheritedContent;

  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: secondTask.taskId,
    taskFile: secondTask.taskFile,
    provider: ({ task, context }) => {
      inheritedContent = context.find((file) => file.path === "backend/src/service/SharedService.java")?.content;
      return batchWorkerResponse(
        task,
        "backend/src/service/SharedService.java",
        "class SharedService { void second() {} }\n",
      );
    },
  });

  assert.equal(inheritedContent, "class SharedService { void first() {} }\n");
  assert.equal(completed.outcome, "ready-for-integration");
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  assert.equal(
    await readFile(path.join(fixture.root, status.plan.worktreePath, "backend/src/service/SharedService.java"), "utf8"),
    "class SharedService { void second() {} }\n",
  );
});

test("batch Worker filters inherited context for a later frontend task without weakening snapshot verification", async () => {
  const fixture = await createBatchWorkerFixture({
    secondType: "frontend",
    secondOwner: "frontend-developer",
  });
  const secondTask = await prepareSecondBatchTask(fixture);
  let receivedContext;

  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: secondTask.taskId,
    taskFile: secondTask.taskFile,
    provider: ({ task, context }) => {
      receivedContext = context;
      return batchWorkerResponse(
        task,
        "frontend/src/views/BatchView.vue",
        "<template><main>batch</main></template>\n",
        "frontend-write",
      );
    },
  });

  assert.equal(completed.outcome, "ready-for-integration");
  assert.equal(receivedContext.some((file) => file.path === "backend/src/service/SharedService.java"), false);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[1].status, "ready-for-integration");
  assert.match(ledger.tasks[1].inheritedSnapshotSha256, /^sha256:[a-f0-9]{64}$/);
});

test("batch Worker rejects an inherited rewrite outside the later task predicted files before landing", async () => {
  const fixture = await createBatchWorkerFixture({
    secondPredictedFiles: ["backend/src/service/SecondOnly.java"],
  });
  const secondTask = await prepareSecondBatchTask(fixture);
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: secondTask.taskId,
      taskFile: secondTask.taskFile,
      provider: ({ task }) => {
        providerCalls += 1;
        return batchWorkerResponse(
          task,
          "backend/src/service/SharedService.java",
          "class SharedService { void forbiddenSecond() {} }\n",
        );
      },
    }),
    /outside the task predicted files/i,
  );

  assert.equal(providerCalls, 1);
  assert.equal(
    await readFile(path.join(fixture.root, "backend/src/service/SharedService.java"), "utf8"),
    "class SharedService { void first() {} }\n",
  );
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[1].status, "running");
  assert.equal(ledger.tasks[1].executionReceiptSha256, null);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
  await assert.rejects(readFile(path.join(fixture.root, secondTask.resultFile), "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, secondTask.executionReceiptFile), "utf8"), /ENOENT/);
});

for (const mutation of [
  {
    label: "renamed",
    apply: async (worktreeRoot) => git(
      worktreeRoot,
      "mv",
      "backend/src/service/SharedService.java",
      "backend/src/service/RenamedService.java",
    ),
    expectedError: /must not rename or copy Worktree files/i,
  },
  {
    label: "deleted",
    apply: (worktreeRoot) => rm(path.join(worktreeRoot, "backend/src/service/SharedService.java")),
    expectedError: /must not delete Worktree files/i,
  },
]) {
  test(`batch Worker rejects a ${mutation.label} inherited file before calling the Provider`, async () => {
    const fixture = await createBatchWorkerFixture();
    const secondTask = await prepareSecondBatchTask(fixture);
    const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
    const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
    const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    await mutation.apply(worktreeRoot);
    let providerCalls = 0;

    await assert.rejects(
      runWorktreeWorker({
        root: fixture.root,
        stateFile: fixture.stateFile,
        taskId: secondTask.taskId,
        taskFile: secondTask.taskFile,
        provider: async () => { providerCalls += 1; },
      }),
      mutation.expectedError,
    );

    assert.equal(providerCalls, 0);
    const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
    assert.equal(ledger.tasks[1].status, "running");
    assert.equal(ledger.tasks[1].executionReceiptSha256, null);
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
    await assert.rejects(readFile(path.join(fixture.root, secondTask.resultFile), "utf8"), /ENOENT/);
    await assert.rejects(readFile(path.join(fixture.root, secondTask.executionReceiptFile), "utf8"), /ENOENT/);
  });
}

for (const status of ["failed", "blocked"]) {
  test(`batch Worker records a valid ${status} result as blocked without an execution receipt`, async () => {
    const fixture = await createBatchWorkerFixture();
    const task = fixture.prepared.ledger.tasks[0];
    await claimBatchTask({
      root: fixture.root,
      stateFile: fixture.stateFile,
      batchFile: fixture.prepared.batchFile,
      taskId: task.taskId,
    });
    const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    const outcome = await runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: ({ task: workerTask }) => batchWorkerFailureResponse(workerTask, status),
    });

    assert.equal(outcome.outcome, "blocked");
    const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
    assert.equal(ledger.status, "blocked");
    assert.equal(ledger.tasks[0].status, "blocked");
    assert.equal(ledger.tasks[0].executionReceiptSha256, null);
    assert.equal(JSON.parse(await readFile(path.join(fixture.root, task.resultFile), "utf8")).status, status);
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
    await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
  });
}

test("batch Worker retries a claimed task after a Provider exception", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    if (providerCalls === 1) throw new Error("simulated batch Provider exception");
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void retry() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
    }),
    /simulated batch Provider exception/i,
  );
  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider,
  });

  assert.equal(retried.outcome, "ready-for-integration");
  assert.equal(providerCalls, 2);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker keeps a timed-out task retryable without a result, receipt, or lock", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  let aborted = false;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      timeoutMs: 10,
      provider: async ({ signal, task: workerTask }) => {
        providerCalls += 1;
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        aborted = signal.aborted;
        return batchWorkerResponse(
          workerTask,
          "backend/src/service/SharedService.java",
          "class SharedService { void late() {} }\n",
        );
      },
    }),
    /timed out/i,
  );

  assert.equal(aborted, true);
  let ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
  await assert.rejects(readFile(path.join(fixture.root, task.resultFile), "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, path.dirname(task.executionReceiptFile), "execute.lock"), "utf8"), /ENOENT/);

  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider: ({ task: workerTask }) => {
      providerCalls += 1;
      return batchWorkerResponse(
        workerTask,
        "backend/src/service/SharedService.java",
        "class SharedService { void retry() {} }\n",
      );
    },
  });

  assert.equal(retried.outcome, "ready-for-integration");
  assert.equal(providerCalls, 2);
  ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker collects a written result after interruption without rerunning the Provider", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void recoveredResult() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      afterWorker: () => { throw new Error("simulated result-to-receipt interruption"); },
    }),
    /simulated result-to-receipt interruption/i,
  );
  await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
  assert.equal(providerCalls, 1);

  const recovered = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider: async () => { throw new Error("Provider must not run during result recovery"); },
  });

  assert.equal(recovered.outcome, "ready-for-integration");
  assert.equal(providerCalls, 1);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, task.resultFile), "utf8")).status, "completed");
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker does not retain an incomplete recovery receipt when its fixed task report is missing", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void missingReport() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      afterWorker: () => { throw new Error("simulated result-to-receipt interruption"); },
    }),
    /simulated result-to-receipt interruption/i,
  );
  await unlink(path.join(worktreeRoot, task.reportFile));

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: async () => { throw new Error("Provider must not run during incomplete result recovery"); },
    }),
    /phase outputs.*expected outputs|fixed task report|expected output/i,
  );

  assert.equal(providerCalls, 1);
  await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
});

test("batch Worker reuses a receipt after collection completes before ledger readiness", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void receipt() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      beforeRecordWorkerReady: () => { throw new Error("simulated receipt-to-ledger interruption"); },
    }),
    /simulated receipt-to-ledger interruption/i,
  );
  assert.equal((await JSON.parse(await readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"))).outcome, "ready-for-integration");
  let ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");

  const recovered = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: task.taskId,
    taskFile: task.taskFile,
    provider,
  });

  assert.equal(recovered.reused, true);
  assert.equal(recovered.outcome, "ready-for-integration");
  assert.equal(providerCalls, 1);
  ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "ready-for-integration");
});

test("batch Worker rechecks Worktree Git facts before reusing an interrupted receipt", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void interrupted() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      beforeRecordWorkerReady: () => { throw new Error("simulated receipt interruption before Git drift"); },
    }),
    /simulated receipt interruption before Git drift/i,
  );
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  await git(worktreeRoot, "add", "backend/src/service/SharedService.java");
  await git(worktreeRoot, "commit", "-m", "drift batch worktree");

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
    }),
    /planned batch Worktree must be created|batch Worktree status/i,
  );
  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
});

test("batch Worker rechecks Worktree Git facts after collection before recording readiness", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: ({ task: workerTask }) => {
        providerCalls += 1;
        return batchWorkerResponse(
          workerTask,
          "backend/src/service/SharedService.java",
          "class SharedService { void postCollectionDrift() {} }\n",
        );
      },
      beforeRecordWorkerReady: async () => {
        await git(worktreeRoot, "add", "backend/src/service/SharedService.java");
        await git(worktreeRoot, "commit", "-m", "post-collection drift");
      },
    }),
    /planned batch Worktree must be created|batch Worktree status/i,
  );

  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
});

test("batch Worker rechecks Worktree Git facts while holding the readiness transition lock", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: ({ task: workerTask }) => batchWorkerResponse(
        workerTask,
        "backend/src/service/SharedService.java",
        "class SharedService { void transitionLockDrift() {} }\n",
      ),
      beforeReadyTransition: async () => {
        await git(worktreeRoot, "add", "backend/src/service/SharedService.java");
        await git(worktreeRoot, "commit", "-m", "readiness transition drift");
      },
    }),
    /planned batch Worktree must be created|batch Worktree status/i,
  );

  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
});

test("batch Worker rejects an interrupted receipt when persisted status evidence changes", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void statusEvidence() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      beforeRecordWorkerReady: () => { throw new Error("simulated status evidence interruption"); },
    }),
    /simulated status evidence interruption/i,
  );
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const statusPath = path.join(fixture.root, status.statusFile);
  const persisted = JSON.parse(await readFile(statusPath, "utf8"));
  persisted.observedAt = "2026-07-24T00:10:00.000Z";
  await writeFile(statusPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
    }),
    /status evidence.*hash/i,
  );
  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
});

test("batch Worker refuses a receipt when collected result evidence drifts before ledger readiness", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: async ({ task: workerTask }) => {
        providerCalls += 1;
        return batchWorkerResponse(
          workerTask,
          "backend/src/service/SharedService.java",
          "class SharedService { void resultDrift() {} }\n",
        );
      },
      beforeRecordWorkerReady: async () => {
        await writeFile(path.join(fixture.root, task.resultFile), "{\"tampered\":true}\n", "utf8");
      },
    }),
    /result evidence.*hash/i,
  );

  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
});

test("batch Worker refuses a receipt when a candidate drifts before ledger readiness", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: async ({ task: workerTask }) => {
        providerCalls += 1;
        return batchWorkerResponse(
          workerTask,
          "backend/src/service/SharedService.java",
          "class SharedService { void candidateDrift() {} }\n",
        );
      },
      beforeRecordWorkerReady: async () => {
        const receipt = JSON.parse(await readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"));
        assert.equal(receipt.files.find((file) => file.path === "backend/src/service/SharedService.java")?.kind, "backend");
        await writeFile(
          path.join(worktreeRoot, "backend/src/service/SharedService.java"),
          "class SharedService { void tamperedCandidate() {} }\n",
          "utf8",
        );
        assert.equal(
          await readFile(path.join(worktreeRoot, "backend/src/service/SharedService.java"), "utf8"),
          "class SharedService { void tamperedCandidate() {} }\n",
        );
      },
    }),
    /candidate.*hash|receipt.*file/i,
  );

  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
});

test("batch Worker rejects a receipt when its task-start manifest hash drifted", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  let providerCalls = 0;
  const provider = async ({ task: workerTask }) => {
    providerCalls += 1;
    return batchWorkerResponse(
      workerTask,
      "backend/src/service/SharedService.java",
      "class SharedService { void manifest() {} }\n",
    );
  };

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
      beforeRecordWorkerReady: () => { throw new Error("simulated manifest receipt interruption"); },
    }),
    /simulated manifest receipt interruption/i,
  );
  const manifestFile = path.join(fixture.root, path.dirname(task.executionReceiptFile), "task-start-manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.createdAt = "2026-07-24T00:09:00.000Z";
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider,
    }),
    /input manifest.*hash/i,
  );
  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
});

test("batch Worker rejects pre-existing Worktree drift before calling the Provider", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  await writeFile(
    path.join(fixture.root, status.plan.worktreePath, "backend/src/service/SharedService.java"),
    "class SharedService { void drifted() {} }\n",
    "utf8",
  );
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /unexpected.*Worktree|Worktree.*drift|inherited.*hash/i,
  );
  assert.equal(providerCalls, 0);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
  assert.match(ledger.tasks[0].inheritedSnapshotSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
  await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
});

test("batch Worker rejects undeclared Worktree writes without creating a receipt", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: async ({ task: workerTask }) => {
        providerCalls += 1;
        await writeFile(path.join(worktreeRoot, "backend/src/service/Rogue.java"), "class Rogue {}\n", "utf8");
        return batchWorkerResponse(
          workerTask,
          "backend/src/service/SharedService.java",
          "class SharedService { void first() {} }\n",
        );
      },
    }),
    /unexpected.*Worktree|undeclared.*Worktree/i,
  );
  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
  await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
});

test("batch Worker rejects an ignored undeclared Worktree write without creating a receipt", async () => {
  const fixture = await createBatchWorkerFixture();
  const task = fixture.prepared.ledger.tasks[0];
  await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: fixture.prepared.batchFile,
    taskId: task.taskId,
  });
  const status = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  const worktreeRoot = path.join(fixture.root, status.plan.worktreePath);
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: task.taskId,
      taskFile: task.taskFile,
      provider: async ({ task: workerTask }) => {
        providerCalls += 1;
        await writeFile(path.join(worktreeRoot, ".env"), "UNDECLARED=1\n", "utf8");
        return batchWorkerResponse(
          workerTask,
          "backend/src/service/SharedService.java",
          "class SharedService { void ignored() {} }\n",
        );
      },
    }),
    /unexpected.*Worktree|undeclared.*Worktree/i,
  );

  assert.equal(providerCalls, 1);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.prepared.batchFile), "utf8"));
  assert.equal(ledger.tasks[0].status, "running");
  assert.equal(ledger.tasks[0].executionReceiptSha256, null);
  await assert.rejects(readFile(path.join(fixture.root, task.executionReceiptFile), "utf8"), /ENOENT/);
});

test("rejects an absent Worktree before calling the Provider", async () => {
  const fixture = await createFixture({ createWorktree: false });
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /must be created/i,
  );
  assert.equal(providerCalls, 0);
});

test("rejects a stale M3 prepared revision before calling the Provider", async () => {
  const fixture = await createFixture({ preparedRevision: 3 });
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /prepared revision/i,
  );
  assert.equal(providerCalls, 0);
});

test("copies current-run inputs but reads committed context from the base Worktree", async () => {
  const fixture = await createFixture();
  const worktreeRoot = path.join(fixture.root, `.harness/worktrees/${fixture.storyId}/${fixture.taskId}`);
  const baseContext = await readFile(path.join(worktreeRoot, "docs/base.md"), "utf8");
  await writeFile(path.join(fixture.root, "docs/base.md"), "uncommitted main context\n", "utf8");
  let receivedContext;
  await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    contextFiles: [fixture.runContextFile, "docs/base.md"],
    provider: async ({ task, context }) => {
      receivedContext = context;
      return {
        files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
        result: {
          schemaVersion: "1.0",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          phase: task.phase,
          status: "completed",
          summary: "Worker completed the phase output.",
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      };
    },
  });

  assert.deepEqual(receivedContext, [
    { path: fixture.runContextFile, content: "current run context\n" },
    { path: "docs/base.md", content: baseContext },
  ]);
  const evidenceDirectory = path.join(fixture.root, `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}`);
  const manifest = JSON.parse(await readFile(path.join(evidenceDirectory, "input-manifest.json"), "utf8"));
  assert.equal(manifest.inputs[0].targetPath, fixture.taskFile);
  assert.equal(manifest.inputs[1].source, "main-run");
  assert.equal(manifest.inputs[2].source, "worktree-base");
  assert.match(manifest.inputs[2].sha256, /^sha256:[a-f0-9]{64}$/);
});

test("reads a Windows case-variant current-run context from the main run", {
  skip: process.platform !== "win32",
}, async () => {
  const fixture = await createFixture();
  const caseVariantContext = fixture.runContextFile.toUpperCase();
  let receivedContext;

  await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    contextFiles: [caseVariantContext],
    provider: async ({ task, context }) => {
      receivedContext = context;
      return {
        files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
        result: {
          schemaVersion: "1.0",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          phase: task.phase,
          status: "completed",
          summary: "Worker completed the phase output.",
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      };
    },
  });

  assert.deepEqual(receivedContext, [{ path: caseVariantContext, content: "current run context\n" }]);
  const manifestFile = path.join(fixture.root, `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}/input-manifest.json`);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  assert.equal(manifest.inputs.find((input) => input.targetPath === caseVariantContext)?.source, "main-run");
});

test("rejects an unexpected Worktree change made outside the Worker response", async () => {
  const fixture = await createFixture();
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const worktreeRoot = path.join(fixture.root, `.harness/worktrees/${fixture.storyId}/${fixture.taskId}`);
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async ({ task }) => {
        providerCalls += 1;
        await writeFile(path.join(worktreeRoot, "rogue.txt"), "unexpected\n", "utf8");
        return {
          files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
          result: {
            schemaVersion: "1.0",
            dispatchId: task.dispatchId,
            storyId: task.storyId,
            phase: task.phase,
            status: "completed",
            summary: "Worker completed the phase output.",
            outputs: task.expectedOutputs.map((output) => ({ path: output })),
            records: [],
          },
        };
      },
    }),
    /unexpected Worktree change.*rogue\.txt/i,
  );
  assert.equal(providerCalls, 1);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
});

test("collects phase-only output as ready-for-apply without advancing Harness state", async () => {
  const fixture = await createFixture();
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  let providerCalls = 0;
  const collected = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider: async ({ task }) => {
      providerCalls += 1;
      return {
        files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
        result: {
          schemaVersion: "1.0",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          phase: task.phase,
          status: "completed",
          summary: "Worker completed the phase output.",
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      };
    },
  });

  assert.equal(collected.outcome, "ready-for-apply");
  assert.equal(collected.reused, false);
  assert.equal(providerCalls, 1);
  assert.equal(await readFile(path.join(fixture.root, fixture.task.expectedOutputs[0]), "utf8"), "implementation notes\n");
  const resultFile = fixture.taskFile.replace(/task\.json$/, "result.json");
  const result = JSON.parse(await readFile(path.join(fixture.root, resultFile), "utf8"));
  assert.equal(result.dispatchId, fixture.task.dispatchId);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
  const receipt = JSON.parse(await readFile(path.join(fixture.root, collected.receiptFile), "utf8"));
  assert.equal(receipt.outcome, "ready-for-apply");
  assert.equal(receipt.files[0].kind, "phase-output");
});

test("collects business writes as ready-for-integration without exposing an M3 result", async () => {
  const fixture = await createFixture();
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const businessFile = "backend/src/main/example.txt";
  const collected = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider: async ({ task }) => ({
      files: [
        { path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" },
        { path: businessFile, content: "business change\n", capability: "backend-write" },
      ],
      result: {
        schemaVersion: "1.0",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        phase: task.phase,
        status: "completed",
        summary: "Worker completed code and phase output.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    }),
  });

  assert.equal(collected.outcome, "ready-for-integration");
  await assert.rejects(readFile(path.join(fixture.root, businessFile)), /ENOENT/);
  const officialResult = fixture.taskFile.replace(/task\.json$/, "result.json");
  await assert.rejects(readFile(path.join(fixture.root, officialResult)), /ENOENT/);
  const evidenceResult = JSON.parse(await readFile(path.join(fixture.root, collected.resultFile), "utf8"));
  assert.equal(evidenceResult.dispatchId, fixture.task.dispatchId);
  assert.notEqual(collected.resultFile, officialResult);
  assert.equal(collected.receipt.files.find((file) => file.path === businessFile).kind, "backend");
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
});

test("runs a claimed v1.2 Worker inside its wave Worktree and records attempt evidence", async () => {
  const fixture = await createWaveWorkerFixture();
  const businessFile = "backend/src/main/WaveCandidate.java";
  const executionLockSha256 = sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)));
  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.task.taskId,
    taskFile: fixture.taskFile,
    ledgerFile: fixture.ledger.ledgerFile,
    attemptId: fixture.claimed.claim.attemptId,
    claimId: fixture.claimed.claim.claimId,
    lockId: fixture.claimed.claim.lockId,
    expectedExecutionLockSha256: executionLockSha256,
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    provider: async ({ task }) => ({
      files: [
        { path: task.expectedOutputs[0], content: "# Wave task report\n", capability: "phase-output" },
        { path: businessFile, content: "class WaveCandidate {}\n", capability: "backend-write" },
      ],
      result: {
        schemaVersion: "1.2",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        runId: task.runId,
        phase: task.phase,
        waveId: task.waveId,
        waveIndex: task.waveIndex,
        taskId: task.taskId,
        taskRoot: task.taskRoot,
        status: "completed",
        summary: "Wave candidate is ready.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    }),
  });

  assert.equal(completed.outcome, "ready-for-integration");
  assert.equal(completed.receiptFile, fixture.claimed.paths.receiptFile);
  assert.equal(completed.resultFile, fixture.claimed.paths.resultFile);
  assert.equal(await readFile(path.join(fixture.root, completed.resultFile), "utf8")
    .then((source) => JSON.parse(source).status), "completed");
  await assert.rejects(readFile(path.join(fixture.root, businessFile)), /ENOENT/);
  const worktreePath = fixture.planned.plan.tasks.find((task) => task.taskId === fixture.task.taskId).worktreePath;
  assert.equal(await readFile(path.join(fixture.root, worktreePath, businessFile), "utf8"), "class WaveCandidate {}\n");
  const inspected = await inspectWaveExecution({
    root: fixture.root,
    ledgerFile: fixture.ledger.ledgerFile,
  });
  assert.equal(inspected.ledger.tasks[0].status, "ready-for-integration");
  assert.equal(inspected.ledger.status, "partial");
  await assert.rejects(readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)), /ENOENT/);
});

test("recover-attempt finalizes complete v1.2 result and receipt evidence without rerunning the Provider", async () => {
  const fixture = await createWaveWorkerFixture();
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.task.taskId,
      taskFile: fixture.taskFile,
      ledgerFile: fixture.ledger.ledgerFile,
      attemptId: fixture.claimed.claim.attemptId,
      claimId: fixture.claimed.claim.claimId,
      lockId: fixture.claimed.claim.lockId,
      expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      beforeLedgerReadyWrite: () => { throw new Error("simulated ready-ledger interruption"); },
      provider: async ({ task }) => {
        providerCalls += 1;
        return {
          files: [
            { path: task.expectedOutputs[0], content: "# Recoverable report\n", capability: "phase-output" },
            { path: "backend/src/main/Recoverable.java", content: "class Recoverable {}\n", capability: "backend-write" },
          ],
          result: {
            schemaVersion: "1.2",
            dispatchId: task.dispatchId,
            storyId: task.storyId,
            runId: task.runId,
            phase: task.phase,
            waveId: task.waveId,
            waveIndex: task.waveIndex,
            taskId: task.taskId,
            taskRoot: task.taskRoot,
            status: "completed",
            summary: "Recoverable candidate is ready.",
            outputs: task.expectedOutputs.map((output) => ({ path: output })),
            records: [],
          },
        };
      },
    }),
    /simulated ready-ledger interruption/,
  );
  assert.equal(providerCalls, 1);
  assert.equal((await inspectWaveExecution({
    root: fixture.root,
    ledgerFile: fixture.ledger.ledgerFile,
  })).ledger.tasks[0].status, "running");

  const recovered = await recoverAttempt({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    taskId: fixture.task.taskId,
    expectedAttemptId: fixture.claimed.claim.attemptId,
    expectedClaimSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.claimFile))),
    expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    confirmAttemptRecovery: true,
  });
  assert.equal(recovered.task.status, "ready-for-integration");
  assert.equal(recovered.receiptFile, fixture.claimed.paths.receiptFile);
  assert.equal(providerCalls, 1);
  await assert.rejects(readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)), /ENOENT/);
});

test("recover-attempt releases a verified lock left after ledger readiness", async () => {
  const fixture = await createWaveWorkerFixture();
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.task.taskId,
      taskFile: fixture.taskFile,
      ledgerFile: fixture.ledger.ledgerFile,
      attemptId: fixture.claimed.claim.attemptId,
      claimId: fixture.claimed.claim.claimId,
      lockId: fixture.claimed.claim.lockId,
      expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      beforeExecutionLockRelease: () => {
        throw new Error("simulated ready-lock release interruption");
      },
      provider: async ({ task }) => ({
        files: [
          { path: task.expectedOutputs[0], content: "# Ready report\n", capability: "phase-output" },
          { path: "backend/src/main/Ready.java", content: "class Ready {}\n", capability: "backend-write" },
        ],
        result: {
          schemaVersion: "1.2",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          runId: task.runId,
          phase: task.phase,
          waveId: task.waveId,
          waveIndex: task.waveIndex,
          taskId: task.taskId,
          taskRoot: task.taskRoot,
          status: "completed",
          summary: "Ready candidate is complete.",
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      }),
    }),
    /simulated ready-lock release interruption/,
  );
  const interrupted = await inspectWaveExecution({
    root: fixture.root,
    ledgerFile: fixture.ledger.ledgerFile,
  });
  assert.equal(interrupted.ledger.tasks[0].status, "ready-for-integration");
  assert.equal(interrupted.diagnostics[0].recoveryRequired, true);

  const recovered = await recoverAttempt({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    taskId: fixture.task.taskId,
    expectedAttemptId: fixture.claimed.claim.attemptId,
    expectedClaimSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.claimFile))),
    expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    confirmAttemptRecovery: true,
  });
  assert.equal(recovered.task.status, "ready-for-integration");
  assert.equal(recovered.receiptFile, fixture.claimed.paths.receiptFile);
  await assert.rejects(readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)), /ENOENT/);
});

test("recover-attempt completes a blocked failure written before the ledger transition", async () => {
  const fixture = await createWaveWorkerFixture();
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.task.taskId,
      taskFile: fixture.taskFile,
      ledgerFile: fixture.ledger.ledgerFile,
      attemptId: fixture.claimed.claim.attemptId,
      claimId: fixture.claimed.claim.claimId,
      lockId: fixture.claimed.claim.lockId,
      expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      afterFailureWriteBeforeLedgerBlock: () => {
        throw new Error("simulated failure-ledger interruption");
      },
      provider: async () => {
        throw new Error("simulated Provider failure");
      },
    }),
    /simulated failure-ledger interruption/,
  );
  assert.equal((await inspectWaveExecution({
    root: fixture.root,
    ledgerFile: fixture.ledger.ledgerFile,
  })).ledger.tasks[0].status, "running");
  const failureBefore = await readFile(path.join(fixture.root, fixture.claimed.paths.failureFile), "utf8");

  const recovered = await recoverAttempt({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    taskId: fixture.task.taskId,
    expectedAttemptId: fixture.claimed.claim.attemptId,
    expectedClaimSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.claimFile))),
    expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    confirmAttemptRecovery: true,
  });
  assert.equal(recovered.task.status, "blocked");
  assert.equal(await readFile(path.join(fixture.root, fixture.claimed.paths.failureFile), "utf8"), failureBefore);
  await assert.rejects(readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)), /ENOENT/);
});

test("recover-attempt preserves a blocked v1.2 attempt and releases its verified stale lock", async () => {
  const fixture = await createWaveWorkerFixture();
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.task.taskId,
      taskFile: fixture.taskFile,
      ledgerFile: fixture.ledger.ledgerFile,
      attemptId: fixture.claimed.claim.attemptId,
      claimId: fixture.claimed.claim.claimId,
      lockId: fixture.claimed.claim.lockId,
      expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      beforeExecutionLockRelease: () => { throw new Error("simulated blocked-lock release interruption"); },
      provider: async ({ task }) => ({
        files: [
          { path: task.expectedOutputs[0], content: "# Blocked report\n", capability: "phase-output" },
        ],
        result: {
          schemaVersion: "1.2",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          runId: task.runId,
          phase: task.phase,
          waveId: task.waveId,
          waveIndex: task.waveIndex,
          taskId: task.taskId,
          taskRoot: task.taskRoot,
          status: "blocked",
          summary: "The task needs an external decision.",
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
          blocker: {
            reason: "Fixture blocker.",
            owner: "user",
            suggestedAction: "Resolve the fixture blocker and retry.",
          },
        },
      }),
    }),
    /simulated blocked-lock release interruption/,
  );
  const interrupted = await inspectWaveExecution({
    root: fixture.root,
    ledgerFile: fixture.ledger.ledgerFile,
  });
  assert.equal(interrupted.ledger.tasks[0].status, "blocked");
  const failureBefore = await readFile(path.join(fixture.root, fixture.claimed.paths.failureFile), "utf8");

  const recovered = await recoverAttempt({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    taskId: fixture.task.taskId,
    expectedAttemptId: fixture.claimed.claim.attemptId,
    expectedClaimSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.claimFile))),
    expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    confirmAttemptRecovery: true,
  });
  assert.equal(recovered.task.status, "blocked");
  assert.equal(await readFile(path.join(fixture.root, fixture.claimed.paths.failureFile), "utf8"), failureBefore);
  await assert.rejects(readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)), /ENOENT/);
});

test("recover-attempt fails closed when a running v1.2 attempt leaves an orphan Worktree candidate", async () => {
  const fixture = await createWaveWorkerFixture();
  const worktreePath = fixture.planned.plan.tasks.find((task) => task.taskId === fixture.task.taskId).worktreePath;
  const orphanFile = "backend/src/main/Orphan.java";
  await mkdir(path.join(fixture.root, worktreePath, path.dirname(orphanFile)), { recursive: true });
  await writeFile(path.join(fixture.root, worktreePath, orphanFile), "class Orphan {}\n", "utf8");

  const recovered = await recoverAttempt({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    taskId: fixture.task.taskId,
    expectedAttemptId: fixture.claimed.claim.attemptId,
    expectedClaimSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.claimFile))),
    expectedExecutionLockSha256: sha256(await readFile(path.join(fixture.root, fixture.claimed.paths.lockFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    confirmAttemptRecovery: true,
  });
  assert.equal(recovered.task.status, "blocked");
  assert.match(recovered.failure.reason, /orphan|candidate|Worktree/i);
  assert.equal(await readFile(path.join(fixture.root, worktreePath, orphanFile), "utf8"), "class Orphan {}\n");
  await assert.rejects(readFile(path.join(fixture.root, fixture.claimed.paths.lockFile)), /ENOENT/);
});

test("a stale v1.2 Worker cannot write or release after its attempt lock is replaced", async () => {
  const cases = [
    { label: "candidate rename", commitKind: "candidate", expectedStatus: "running" },
    { label: "result rename", commitKind: "result", expectedStatus: "running" },
    { label: "execution receipt", hook: "beforeExecutionReceiptWrite", expectedStatus: "running" },
    { label: "ledger readiness", hook: "beforeLedgerReadyWrite", expectedStatus: "running" },
    { label: "execution lock release", hook: "beforeExecutionLockRelease", expectedStatus: "ready-for-integration" },
  ];
  for (const testCase of cases) {
    const fixture = await createWaveWorkerFixture();
    const lockPath = path.join(fixture.root, fixture.claimed.paths.lockFile);
    const replacement = {
      ...JSON.parse(await readFile(lockPath, "utf8")),
      attemptId: "attempt-ffffffffffffffff",
      claimId: "claim-ffffffffffffffff",
      lockId: "lock-ffffffffffffffff",
    };
    const replacementSource = `${JSON.stringify(replacement, null, 2)}\n`;
    let replaced = false;
    const replaceOwner = async () => {
      if (replaced) return;
      replaced = true;
      await writeFile(lockPath, replacementSource, "utf8");
    };
    const hooks = testCase.commitKind
      ? {
        beforeWaveCommit: async ({ kind }) => {
          if (kind === testCase.commitKind) await replaceOwner();
        },
      }
      : { [testCase.hook]: replaceOwner };

    await assert.rejects(
      runWorktreeWorker({
        root: fixture.root,
        stateFile: fixture.stateFile,
        taskId: fixture.task.taskId,
        taskFile: fixture.taskFile,
        ledgerFile: fixture.ledger.ledgerFile,
        attemptId: fixture.claimed.claim.attemptId,
        claimId: fixture.claimed.claim.claimId,
        lockId: fixture.claimed.claim.lockId,
        expectedExecutionLockSha256: sha256(await readFile(lockPath)),
        expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
        ...hooks,
        provider: async ({ task }) => ({
          files: [
            { path: task.expectedOutputs[0], content: `# ${testCase.label}\n`, capability: "phase-output" },
            { path: "backend/src/main/Fenced.java", content: "class Fenced {}\n", capability: "backend-write" },
          ],
          result: {
            schemaVersion: "1.2",
            dispatchId: task.dispatchId,
            storyId: task.storyId,
            runId: task.runId,
            phase: task.phase,
            waveId: task.waveId,
            waveIndex: task.waveIndex,
            taskId: task.taskId,
            taskRoot: task.taskRoot,
            status: "completed",
            summary: `${testCase.label} fencing.`,
            outputs: task.expectedOutputs.map((output) => ({ path: output })),
            records: [],
          },
        }),
      }),
      /owner|lock|claim/i,
      testCase.label,
    );
    assert.equal(replaced, true, testCase.label);
    assert.equal(await readFile(lockPath, "utf8"), replacementSource, testCase.label);
    assert.equal((await inspectWaveExecution({
      root: fixture.root,
      ledgerFile: fixture.ledger.ledgerFile,
    })).ledger.tasks[0].status, testCase.expectedStatus, testCase.label);
    await assert.rejects(
      readFile(path.join(fixture.root, "backend/src/main/Fenced.java")),
      /ENOENT/,
      testCase.label,
    );
  }
});

test("execute-wave runs all claimed Workers concurrently and trusts settled disk evidence", async () => {
  const fixture = await createWaveWorkerFixture({ claimTask: false });
  const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const entered = new Set();
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const uuidValues = [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000013",
    "00000000-0000-4000-8000-000000000014",
    "00000000-0000-4000-8000-000000000015",
    "00000000-0000-4000-8000-000000000016",
  ];
  const execution = await runWaveExecutionCommand({
    root: fixture.root,
    command: "execute-wave",
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveExecute: true,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    randomUUID: () => uuidValues.shift(),
    provider: async ({ task }) => {
      entered.add(task.taskId);
      if (entered.size === 2) release();
      await barrier;
      const isBackend = task.taskId === "T1";
      return {
        files: [
          { path: task.expectedOutputs[0], content: `# ${task.taskId} report\n`, capability: "phase-output" },
          {
            path: isBackend ? "backend/src/main/T1.java" : "frontend/src/T2.ts",
            content: isBackend ? "class T1 {}\n" : "export const t2 = true;\n",
            capability: isBackend ? "backend-write" : "frontend-write",
          },
        ],
        result: {
          schemaVersion: "1.2",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          runId: task.runId,
          phase: task.phase,
          waveId: task.waveId,
          waveIndex: task.waveIndex,
          taskId: task.taskId,
          taskRoot: task.taskRoot,
          status: "completed",
          summary: `${task.taskId} is ready.`,
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      };
    },
  });

  assert.equal(entered.size, 2);
  assert.deepEqual(execution.claimedTaskIds, ["T1", "T2"]);
  assert.deepEqual(execution.settled.map((item) => item.status), ["fulfilled", "fulfilled"]);
  const blockedFailures = [];
  for (const ledgerTask of execution.ledger.tasks.filter((task) => task.status === "blocked")) {
    const failureFile = `${fixture.task.taskRoot.replace(/T1$/, ledgerTask.taskId)}/attempts/${ledgerTask.currentAttemptId}/failure.json`;
    blockedFailures.push(JSON.parse(await readFile(path.join(fixture.root, failureFile), "utf8")));
  }
  assert.equal(
    execution.ledger.status,
    "ready-for-integration",
    JSON.stringify({
      settled: execution.settled,
      blockedFailures,
      tasks: execution.ledger.tasks.map((task) => ({
        taskId: task.taskId,
        status: task.status,
        currentAttemptId: task.currentAttemptId,
      })),
    }),
  );
  assert.deepEqual(
    execution.ledger.tasks.map((task) => task.status),
    ["ready-for-integration", "ready-for-integration"],
  );
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  await assert.rejects(readFile(path.join(fixture.root, "backend/src/main/T1.java")), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, "frontend/src/T2.ts")), /ENOENT/);
});

async function createReadyWaveIntegrationFixture() {
  const fixture = await createWaveWorkerFixture({ claimTask: false });
  let workerQueue = Promise.resolve();
  const uuidValues = [
    "00000000-0000-4000-8000-000000000041",
    "00000000-0000-4000-8000-000000000042",
    "00000000-0000-4000-8000-000000000043",
    "00000000-0000-4000-8000-000000000044",
    "00000000-0000-4000-8000-000000000045",
    "00000000-0000-4000-8000-000000000046",
  ];
  const executed = await runWaveExecutionCommand({
    root: fixture.root,
    command: "execute-wave",
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveExecute: true,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    randomUUID: () => uuidValues.shift(),
    workerRunner: (options) => {
      const current = workerQueue.then(() => runWorktreeWorker(options));
      workerQueue = current.catch(() => {});
      return current;
    },
    provider: async ({ task }) => {
      const isBackend = task.taskId === "T1";
      return {
        files: [
          { path: task.expectedOutputs[0], content: `# ${task.taskId} report\n`, capability: "phase-output" },
          {
            path: isBackend ? "backend/src/main/T1.java" : "frontend/src/T2.ts",
            content: isBackend ? "class T1 {}\n" : "export const t2 = true;\n",
            capability: isBackend ? "backend-write" : "frontend-write",
          },
        ],
        result: {
          schemaVersion: "1.2",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          runId: task.runId,
          phase: task.phase,
          waveId: task.waveId,
          waveIndex: task.waveIndex,
          taskId: task.taskId,
          taskRoot: task.taskRoot,
          status: "completed",
          summary: `${task.taskId} is ready for integration.`,
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      };
    },
  });
  assert.equal(
    executed.ledger.status,
    "ready-for-integration",
    JSON.stringify({
      settled: executed.settled,
      tasks: executed.ledger.tasks.map((task) => ({
        taskId: task.taskId,
        status: task.status,
        currentAttemptId: task.currentAttemptId,
      })),
    }),
  );
  return { ...fixture, executed };
}

test("freeze-integration requires a fully ready wave", async () => {
  const fixture = await createWaveWorkerFixture({ claimTask: false });
  await assert.rejects(
    freezeWaveIntegration({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    }),
    /ready-for-integration|ready/i,
  );
});

test("freeze-integration writes one deterministic manifest without touching main business files", async () => {
  const fixture = await createReadyWaveIntegrationFixture();
  const frozen = await freezeWaveIntegration({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    now: () => "2026-08-06T00:10:00.000Z",
    randomUUID: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000051",
        "00000000-0000-4000-8000-000000000052",
      ];
      return () => values.shift();
    })(),
  });

  assert.equal(frozen.ledger.status, "integration-frozen");
  assert.equal(frozen.manifest.storyId, fixture.state.storyId);
  assert.deepEqual(frozen.manifest.tasks.map((task) => task.taskId), ["T1", "T2"]);
  assert.deepEqual(
    frozen.manifest.candidateFiles.map((file) => [file.taskId, file.path]),
    [
      ["T1", "backend/src/main/T1.java"],
      ["T1", `.harness/runs/${fixture.state.storyId}/waves/wave-0123456789abcdef/tasks/T1/task-report.md`],
      ["T2", "frontend/src/T2.ts"],
      ["T2", `.harness/runs/${fixture.state.storyId}/waves/wave-0123456789abcdef/tasks/T2/task-report.md`],
    ],
  );
  assert.equal(
    sha256(await readFile(path.join(fixture.root, frozen.manifestFile))),
    frozen.ledger.integrationManifestSha256,
  );
  await assert.rejects(readFile(path.join(fixture.root, frozen.preparationLockFile)), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, "backend/src/main/T1.java")), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, "frontend/src/T2.ts")), /ENOENT/);
});

test("recover-freeze binds an already written manifest and releases only the expected owner lock", async () => {
  const fixture = await createReadyWaveIntegrationFixture();
  let interrupted;
  await assert.rejects(
    freezeWaveIntegration({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      now: () => "2026-08-06T00:11:00.000Z",
      randomUUID: (() => {
        const values = [
          "00000000-0000-4000-8000-000000000061",
          "00000000-0000-4000-8000-000000000062",
        ];
        return () => values.shift();
      })(),
      afterManifestWriteBeforeLedgerBinding: (value) => {
        interrupted = value;
        throw new Error("simulated manifest binding interruption");
      },
    }),
    /manifest binding interruption/i,
  );
  const lockSource = await readFile(path.join(fixture.root, interrupted.preparationLockFile));
  const manifestBefore = await readFile(path.join(fixture.root, interrupted.manifestFile));
  const recovered = await recoverWaveFreeze({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    freezeId: interrupted.lock.freezeId,
    confirmManifestFreezeRecovery: true,
    expectedPreparationLockSha256: sha256(lockSource),
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
  });

  assert.equal(recovered.ledger.status, "integration-frozen");
  assert.equal(await readFile(path.join(fixture.root, recovered.manifestFile), "utf8"), manifestBefore.toString("utf8"));
  await assert.rejects(readFile(path.join(fixture.root, recovered.preparationLockFile)), /ENOENT/);
});

async function createFrozenWaveIntegrationFixture() {
  const fixture = await createReadyWaveIntegrationFixture();
  const frozen = await freezeWaveIntegration({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    now: () => "2026-08-06T00:12:00.000Z",
    randomUUID: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000071",
        "00000000-0000-4000-8000-000000000072",
      ];
      return () => values.shift();
    })(),
  });
  return { ...fixture, frozen };
}

test("integrate-wave applies manifest candidates in stable task order and retains its owner lock", async () => {
  const fixture = await createFrozenWaveIntegrationFixture();
  const integrated = await integrateWave({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveIntegrate: true,
    expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
    now: () => "2026-08-06T00:13:00.000Z",
    randomUUID: () => "00000000-0000-4000-8000-000000000081",
  });

  assert.equal(integrated.ledger.status, "integrated");
  assert.deepEqual(integrated.ledger.tasks.map((task) => task.status), ["integrated", "integrated"]);
  assert.equal(await readFile(path.join(fixture.root, "backend/src/main/T1.java"), "utf8"), "class T1 {}\n");
  assert.equal(await readFile(path.join(fixture.root, "frontend/src/T2.ts"), "utf8"), "export const t2 = true;\n");
  assert.match(await readFile(path.join(fixture.root, integrated.integrationLockFile), "utf8"), /integration-manifest|manifestSha256|lockId/i);
  assert.deepEqual(integrated.integratedTaskIds, ["T1", "T2"]);
});

test("recover-integration preserves the integrated prefix and completes only the remaining task", async () => {
  const fixture = await createFrozenWaveIntegrationFixture();
  let interrupted;
  await assert.rejects(
    integrateWave({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      confirmWaveIntegrate: true,
      expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
      now: () => "2026-08-06T00:14:00.000Z",
      randomUUID: () => "00000000-0000-4000-8000-000000000091",
      afterTaskCandidatesWriteBeforeReceipt: (value) => {
        if (value.taskId === "T2") {
          interrupted = value;
          throw new Error("simulated T2 integration interruption");
        }
      },
    }),
    /T2 integration interruption/i,
  );
  const ledgerAfterFailure = JSON.parse(
    await readFile(path.join(fixture.root, fixture.ledger.ledgerFile), "utf8"),
  );
  assert.equal(ledgerAfterFailure.status, "partial-integration");
  assert.deepEqual(ledgerAfterFailure.tasks.map((task) => task.status), ["integrated", "ready-for-integration"]);
  const prefixBefore = await readFile(path.join(fixture.root, "backend/src/main/T1.java"), "utf8");
  const integrationLockSource = await readFile(path.join(fixture.root, interrupted.integrationLockFile));

  const recovered = await recoverWaveIntegration({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveIntegrationRecovery: true,
    expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
    expectedIntegrationLockSha256: sha256(integrationLockSource),
    now: () => "2026-08-06T00:15:00.000Z",
    randomUUID: () => "00000000-0000-4000-8000-000000000092",
  });

  assert.equal(recovered.ledger.status, "integrated");
  assert.deepEqual(recovered.integratedTaskIds, ["T2"]);
  assert.equal(await readFile(path.join(fixture.root, "backend/src/main/T1.java"), "utf8"), prefixBefore);
  assert.equal(await readFile(path.join(fixture.root, "frontend/src/T2.ts"), "utf8"), "export const t2 = true;\n");
  assert.match(await readFile(path.join(fixture.root, recovered.integrationRecoveryLockFile), "utf8"), /lockId/i);
});

test("recover-integration refuses to continue after the integrated prefix drifts", async () => {
  const fixture = await createFrozenWaveIntegrationFixture();
  let interrupted;
  await assert.rejects(
    integrateWave({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      confirmWaveIntegrate: true,
      expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
      now: () => "2026-08-06T00:16:00.000Z",
      randomUUID: () => "00000000-0000-4000-8000-000000000101",
      afterTaskCandidatesWriteBeforeReceipt: (value) => {
        if (value.taskId === "T2") {
          interrupted = value;
          throw new Error("simulated prefix drift window");
        }
      },
    }),
    /prefix drift window/i,
  );
  await writeFile(path.join(fixture.root, "backend/src/main/T1.java"), "class T1 { void drifted() {} }\n", "utf8");
  const integrationLockSource = await readFile(path.join(fixture.root, interrupted.integrationLockFile));

  await assert.rejects(
    recoverWaveIntegration({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      confirmWaveIntegrationRecovery: true,
      expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
      expectedIntegrationLockSha256: sha256(integrationLockSource),
      now: () => "2026-08-06T00:17:00.000Z",
      randomUUID: () => "00000000-0000-4000-8000-000000000102",
    }),
    /prefix|business.*change|candidate.*changed/i,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile), "utf8")).status,
    "partial-integration",
  );
});

test("Wave finalization never deletes a replacement integration lock after recovery lock release", async () => {
  const fixture = await createFrozenWaveIntegrationFixture();
  let interrupted;
  await assert.rejects(
    integrateWave({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      confirmWaveIntegrate: true,
      expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
      now: () => "2026-08-06T00:17:30.000Z",
      randomUUID: () => "00000000-0000-4000-8000-000000000103",
      afterTaskCandidatesWriteBeforeReceipt: (value) => {
        if (value.taskId === "T2") {
          interrupted = value;
          throw new Error("simulated recovery-owned finalization");
        }
      },
    }),
    /recovery-owned finalization/i,
  );
  const recovered = await recoverWaveIntegration({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveIntegrationRecovery: true,
    expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
    expectedIntegrationLockSha256: sha256(
      await readFile(path.join(fixture.root, interrupted.integrationLockFile)),
    ),
    now: () => "2026-08-06T00:17:31.000Z",
    randomUUID: () => "00000000-0000-4000-8000-000000000104",
  });
  const phaseRoot = `.harness/runs/${fixture.state.storyId}/phases/03-implementation`;
  const phaseArtifacts = {
    taskFile: `${phaseRoot}/task.json`,
    resultFile: `${phaseRoot}/result.json`,
    notesFile: `${phaseRoot}/implementation-notes.md`,
  };
  for (const file of Object.values(phaseArtifacts)) {
    await mkdir(path.join(fixture.root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(fixture.root, file), `${file}\n`, "utf8");
  }
  const boundArtifacts = {
    ...phaseArtifacts,
    taskSha256: sha256(await readFile(path.join(fixture.root, phaseArtifacts.taskFile))),
    resultSha256: sha256(await readFile(path.join(fixture.root, phaseArtifacts.resultFile))),
    notesSha256: sha256(await readFile(path.join(fixture.root, phaseArtifacts.notesFile))),
  };
  const replacement = `${JSON.stringify({
    schemaVersion: "1.0",
    lockId: "lock-replacement0000",
    freezeId: fixture.frozen.manifest.freezeId,
    manifestSha256: fixture.frozen.ledger.integrationManifestSha256,
    storyId: fixture.state.storyId,
    runId: fixture.state.storyId,
    waveId: fixture.frozen.ledger.waveId,
    pid: process.pid,
    createdAt: "2026-08-06T00:17:32.000Z",
  }, null, 2)}\n`;

  await assert.rejects(
    finalizeWaveExecution({
      root: fixture.root,
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
      expectedIntegrationLockSha256: recovered.integrationLockSha256,
      phaseArtifacts: boundArtifacts,
      now: () => "2026-08-06T00:17:33.000Z",
      bindCheckpoint: async () => {},
      afterIntegrationRecoveryLockReleaseBeforeIntegrationLockRelease: async () => {
        await writeFile(path.join(fixture.root, recovered.integrationLockFile), replacement, "utf8");
      },
    }),
    /owner|lock.*changed/i,
  );
  assert.equal(await readFile(path.join(fixture.root, recovered.integrationLockFile), "utf8"), replacement);
});

async function createFinalizableWaveFixture() {
  const fixture = await createFrozenWaveIntegrationFixture();
  const integrated = await integrateWave({
    root: fixture.root,
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveIntegrate: true,
    expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
    now: () => "2026-08-06T00:18:00.000Z",
    randomUUID: () => "00000000-0000-4000-8000-000000000111",
  });
  await mkdir(path.join(fixture.root, ".harness/workflows"), { recursive: true });
  await copyFile(
    path.join(repositoryRoot, ".harness/workflows/e2e-development.yaml"),
    path.join(fixture.root, ".harness/workflows/e2e-development.yaml"),
  );
  const state = {
    schemaVersion: "1.0",
    storyId: fixture.state.storyId,
    phase: "implementation",
    runtime: {
      runId: fixture.state.storyId,
      workflow: ".harness/workflows/e2e-development.yaml",
      status: "active",
      revision: 7,
      previousPhase: "task-dag",
      blocked: null,
      records: [],
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    },
    requirement: { summary: "Wave finalization fixture", openQuestions: [], acceptanceCriteria: [] },
    knowledge: { loadedFiles: [], staleFiles: [], missingAreas: [] },
    tasks: [],
    dag: { nodes: [], edges: [], waves: [] },
    worktrees: [],
    tests: { commands: [], results: [] },
    review: { findings: [], status: "pending" },
    verification: { cases: [], results: [] },
    delivery: { ownedFiles: [], commit: null, pr: null },
    logs: [],
  };
  await writeFile(path.join(fixture.root, fixture.stateFile), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { ...fixture, state, integrated };
}

async function finalizeWaveFixture(fixture) {
  return runStoryCommand({
    root: fixture.root,
    command: "finalize-wave",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedIntegrationManifestSha256: fixture.frozen.ledger.integrationManifestSha256,
    expectedIntegrationLockSha256: fixture.integrated.integrationLockSha256,
    now: () => "2026-08-06T00:19:00.000Z",
  });
}

async function advanceWaveStoryToDone(fixture) {
  const phases = [
    {
      output: `.harness/runs/${fixture.state.storyId}/phases/04-unit-test/test-report.md`,
      record: { recordType: "test", status: "passed", message: "Wave retirement fixture tests passed." },
    },
    {
      output: `.harness/runs/${fixture.state.storyId}/phases/05-code-review/code-review-report.md`,
      record: { recordType: "review", status: "passed", message: "Wave retirement fixture review passed." },
    },
    { output: `.harness/runs/${fixture.state.storyId}/phases/06-build-publish/build-report.md` },
    { output: `.harness/runs/${fixture.state.storyId}/phases/07-interface-verification/interface-verification-report.md` },
    {
      output: `.harness/runs/${fixture.state.storyId}/phases/08-git-delivery/delivery-report.md`,
      record: {
        recordType: "approval",
        status: "approved",
        actor: "user",
        message: "Approve the temporary Wave retirement fixture delivery.",
      },
      complete: true,
    },
  ];
  for (const [index, phase] of phases.entries()) {
    await mkdir(path.join(fixture.root, path.dirname(phase.output)), { recursive: true });
    await writeFile(path.join(fixture.root, phase.output), `fixture phase ${index + 4}\n`, "utf8");
    if (phase.record) {
      await runStateCommand({
        root: fixture.root,
        command: "record",
        stateFile: fixture.stateFile,
        path: phase.output,
        ...phase.record,
        now: () => `2026-08-06T00:2${index}:00.000Z`,
      });
    }
    await runStateCommand({
      root: fixture.root,
      command: phase.complete ? "complete" : "next",
      stateFile: fixture.stateFile,
      now: () => `2026-08-06T00:2${index}:30.000Z`,
    });
  }
}

async function createCompletedWaveRetirementFixture() {
  const fixture = await createFinalizableWaveFixture();
  const finalized = await finalizeWaveFixture(fixture);
  await runStoryCommand({
    root: fixture.root,
    command: "apply",
    stateFile: fixture.stateFile,
    now: () => "2026-08-06T00:20:00.000Z",
  });
  await advanceWaveStoryToDone(fixture);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile), "utf8"));
  return {
    ...fixture,
    finalized,
    ledgerFile: fixture.ledger.ledgerFile,
    ledger,
    ledgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    waveReceiptSha256: sha256(await readFile(path.join(fixture.root, ledger.waveReceiptFile))),
  };
}

function waveRetireOptions(fixture, overrides = {}) {
  return {
    root: fixture.root,
    command: "wave-retire",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedWaveLedgerSha256: fixture.ledgerSha256,
    expectedWaveReceiptSha256: fixture.waveReceiptSha256,
    confirmRetire: true,
    ...overrides,
  };
}

async function registeredWaveWorktreeCount(fixture) {
  const worktrees = (await git(fixture.root, "worktree", "list", "--porcelain")).stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).replaceAll("\\", "/").toLowerCase());
  return fixture.planned.plan.tasks.filter((task) => (
    worktrees.includes(path.resolve(fixture.root, task.worktreePath).replaceAll("\\", "/").toLowerCase())
  )).length;
}

function waveRetirementLockFiles(fixture) {
  const waveRoot = path.posix.dirname(fixture.ledgerFile);
  return {
    normal: `${waveRoot}/worktree-retire.lock`,
    recovery: `${waveRoot}/worktree-retire-recovery.lock`,
  };
}

function waveRetirementLockValue(fixture, mode = "retire") {
  return {
    schemaVersion: "1.0",
    lockId: mode === "retire"
      ? "00000000-0000-4000-8000-000000000201"
      : "00000000-0000-4000-8000-000000000202",
    retirementId: "00000000-0000-4000-8000-000000000200",
    mode,
    storyId: fixture.state.storyId,
    runId: fixture.state.storyId,
    waveId: fixture.ledger.waveId,
    waveIndex: fixture.ledger.waveIndex,
    wavePlanSha256: fixture.ledger.wavePlanSha256,
    creationReceiptSha256: fixture.ledger.creationReceiptSha256,
    waveLedgerSha256: fixture.ledgerSha256,
    waveReceiptSha256: fixture.waveReceiptSha256,
    pid: process.pid,
    createdAt: "2026-08-06T00:30:00.000Z",
  };
}

test("wave-retire requires a completed Story and a finalized ledger before preflight", async () => {
  const active = await createFinalizableWaveFixture();
  await assert.rejects(
    runWorktreeCommand({
      root: active.root,
      command: "wave-retire",
      stateFile: active.stateFile,
      taskDagFile: active.taskDagFile,
      waveIndex: 1,
      expectedWaveLedgerSha256: sha256(await readFile(path.join(active.root, active.ledger.ledgerFile))),
      expectedWaveReceiptSha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      confirmRetire: true,
    }),
    /completed Story/i,
  );
  assert.equal(await registeredWaveWorktreeCount(active), 2);

  const completed = await createCompletedWaveRetirementFixture();
  const ledgerPath = path.join(completed.root, completed.ledgerFile);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.status = "integrated";
  ledger.waveReceiptFile = null;
  ledger.waveReceiptSha256 = null;
  ledger.finalizedAt = null;
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(completed, {
      expectedWaveLedgerSha256: sha256(await readFile(ledgerPath)),
    })),
    /finalized.*ledger/i,
  );
  assert.equal(await registeredWaveWorktreeCount(completed), 2);
});

test("wave-retire validates all completion evidence before any Worktree removal", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const checkpoint = JSON.parse(await readFile(path.join(fixture.root, fixture.finalized.checkpointFile), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(fixture.root, fixture.ledger.integrationManifestFile), "utf8"));
  const receipt = JSON.parse(await readFile(path.join(fixture.root, fixture.ledger.waveReceiptFile), "utf8"));
  const cases = [
    [fixture.taskDagFile, /Task DAG.*changed|bound Task DAG/i],
    [fixture.planned.planFile, /Wave Worktree plan.*changed|plan.*hash|status.*invalid/i],
    [fixture.created.receiptFile, /creation receipt.*changed|creation receipt.*hash/i],
    [fixture.ledger.integrationManifestFile, /integration manifest.*changed|manifest.*hash/i],
    [fixture.ledger.waveReceiptFile, /ExpectedWaveReceiptSha256|Wave receipt.*changed/i],
    [checkpoint.waveFinalization.notesFile, /implementation notes.*changed/i],
    [receipt.tasks[0].executionReceiptFile, /execution receipt.*changed/i],
    [receipt.tasks[0].integrationReceiptFile, /integration receipt.*changed/i],
    [
      manifest.candidateFiles.find((file) => file.type !== "phase-output").path,
      /applied.*changed|candidate.*changed|business.*changed/i,
    ],
  ];

  for (const [relativeFile, expectedError] of cases) {
    const filePath = path.join(fixture.root, relativeFile);
    const original = await readFile(filePath);
    await writeFile(filePath, Buffer.concat([original, Buffer.from("\n ")]));
    await assert.rejects(
      runWorktreeCommand(waveRetireOptions(fixture)),
      expectedError,
      relativeFile,
    );
    assert.equal(await registeredWaveWorktreeCount(fixture), 2, relativeFile);
    await writeFile(filePath, original);
  }
});

test("wave-retire rejects M3 Wave finalization binding drift before any Worktree removal", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const checkpointPath = path.join(fixture.root, fixture.finalized.checkpointFile);
  const original = await readFile(checkpointPath);
  const cases = [
    ["preparedRevision", (binding) => { binding.preparedRevision += 1; }],
    ["finalizedAt", (binding) => { binding.finalizedAt = "2026-08-06T00:19:01.000Z"; }],
    ["taskFile", (binding) => { binding.taskFile = `${path.posix.dirname(binding.taskFile)}/other-task.json`; }],
    ["resultFile", (binding) => { binding.resultFile = `${path.posix.dirname(binding.resultFile)}/other-result.json`; }],
    ["notesFile", (binding) => { binding.notesFile = `${path.posix.dirname(binding.notesFile)}/other-notes.md`; }],
  ];

  for (const [field, mutate] of cases) {
    const checkpoint = JSON.parse(original.toString("utf8"));
    mutate(checkpoint.waveFinalization);
    await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await assert.rejects(
      runWorktreeCommand(waveRetireOptions(fixture, {
        afterWaveRetirePreflight: () => {
          throw new Error(`unrejected ${field} drift`);
        },
      })),
      /checkpoint|finalized ledger|Wave finalization|implementation phase/i,
      field,
    );
    assert.equal(await registeredWaveWorktreeCount(fixture), 2, field);
  }
});

test("wave-retire rejects a completed State revision older than the finalized Wave", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const checkpoint = JSON.parse(await readFile(
    path.join(fixture.root, fixture.finalized.checkpointFile),
    "utf8",
  ));
  const statePath = path.join(fixture.root, fixture.stateFile);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.runtime.revision = checkpoint.waveFinalization.preparedRevision - 1;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveRetirePreflight: () => {
        throw new Error("unexpectedly reached preflight");
      },
    })),
    /State revision|checkpoint|finalized Wave/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire rejects Wave receipt identity drift before any Worktree removal", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const receiptPath = path.join(fixture.root, fixture.ledger.waveReceiptFile);
  const ledgerPath = path.join(fixture.root, fixture.ledgerFile);
  const checkpointPath = path.join(fixture.root, fixture.finalized.checkpointFile);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.storyId = "M5-D-D-OTHER";
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const receiptSha256 = sha256(await readFile(receiptPath));
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.waveReceiptSha256 = receiptSha256;
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  const ledgerSha256 = sha256(await readFile(ledgerPath));
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  checkpoint.waveFinalization.waveReceiptSha256 = receiptSha256;
  checkpoint.waveFinalization.waveLedgerSha256 = ledgerSha256;
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      expectedWaveLedgerSha256: ledgerSha256,
      expectedWaveReceiptSha256: receiptSha256,
      afterWaveRetirePreflight: () => {
        throw new Error("unexpectedly reached preflight");
      },
    })),
    /Wave receipt.*identity|checkpoint|finalized ledger/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire rejects completed State record hash drift before any Worktree removal", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const files = [
    `.harness/runs/${fixture.state.storyId}/phases/04-unit-test/test-report.md`,
    `.harness/runs/${fixture.state.storyId}/phases/05-code-review/code-review-report.md`,
  ];

  for (const relativeFile of files) {
    const filePath = path.join(fixture.root, relativeFile);
    const original = await readFile(filePath);
    await writeFile(filePath, Buffer.concat([original, Buffer.from("drift\n")]));
    await assert.rejects(
      runWorktreeCommand(waveRetireOptions(fixture, {
        afterWaveRetirePreflight: () => {
          throw new Error("unexpectedly reached preflight");
        },
      })),
      /State record|record evidence.*changed|record.*SHA-256/i,
      relativeFile,
    );
    assert.equal(await registeredWaveWorktreeCount(fixture), 2, relativeFile);
    await writeFile(filePath, original);
  }
});

test("wave-retire performs a global zero-deletion preflight across every task", async () => {
  const drifted = await createCompletedWaveRetirementFixture();
  const secondTask = drifted.planned.plan.tasks[1];
  const tree = (await git(drifted.root, "rev-parse", `${secondTask.branch}^{tree}`)).stdout.trim();
  const driftCommit = (await git(drifted.root, "commit-tree", tree, "-m", "retirement branch drift")).stdout.trim();
  await git(drifted.root, "update-ref", `refs/heads/${secondTask.branch}`, driftCommit);
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(drifted)),
    /branch.*base commit|branch.*drift/i,
  );
  assert.equal(await registeredWaveWorktreeCount(drifted), 2);

  const ready = await createCompletedWaveRetirementFixture();
  let reachedPreflight = false;
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(ready, {
      afterWaveRetirePreflight: () => {
        reachedPreflight = true;
        throw new Error("stop after Wave retirement preflight");
      },
    })),
    /stop after Wave retirement preflight/i,
  );
  assert.equal(reachedPreflight, true);
  assert.equal(await registeredWaveWorktreeCount(ready), 2);
});

test("wave-retire preserves an interrupted owner and requires explicit recovery hashes", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveRetirementOwnerAcquired: () => {
        throw new Error("simulated Wave retirement owner interruption");
      },
    })),
    /owner interruption/i,
  );
  const normalSource = await readFile(path.join(fixture.root, locks.normal));

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture)),
    /retirement lock already exists|inspect.*lock/i,
  );
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      confirmWaveRetireLockRecovery: true,
    })),
    /ExpectedRetirementLockSha256/i,
  );
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      confirmWaveRetireLockRecovery: true,
      expectedRetirementLockSha256: sha256(normalSource),
      afterWaveRetirementOwnerAcquired: () => {
        throw new Error("simulated Wave retirement recovery interruption");
      },
    })),
    /recovery interruption/i,
  );
  await readFile(path.join(fixture.root, locks.recovery));
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire fences an owner when its recovery lock is replaced", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  const normal = waveRetirementLockValue(fixture);
  await mkdir(path.dirname(path.join(fixture.root, locks.normal)), { recursive: true });
  await writeFile(path.join(fixture.root, locks.normal), `${JSON.stringify(normal, null, 2)}\n`, "utf8");
  const replacement = {
    ...waveRetirementLockValue(fixture, "recovery"),
    lockId: "00000000-0000-4000-8000-000000000299",
    retirementLockFile: locks.normal,
    retirementLockSha256: sha256(await readFile(path.join(fixture.root, locks.normal))),
  };

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      confirmWaveRetireLockRecovery: true,
      expectedRetirementLockSha256: replacement.retirementLockSha256,
      afterWaveRetirementOwnerAcquired: async () => {
        await writeFile(path.join(fixture.root, locks.recovery), `${JSON.stringify(replacement, null, 2)}\n`, "utf8");
      },
    })),
    /ownership.*changed|fenced/i,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(fixture.root, locks.recovery), "utf8")).lockId,
    replacement.lockId,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire rejects a retirement lock whose identifiers violate the strict schema", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  const invalid = {
    ...waveRetirementLockValue(fixture),
    lockId: "not-a-uuid",
  };
  await mkdir(path.dirname(path.join(fixture.root, locks.normal)), { recursive: true });
  await writeFile(path.join(fixture.root, locks.normal), `${JSON.stringify(invalid, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      confirmWaveRetireLockRecovery: true,
      expectedRetirementLockSha256: sha256(await readFile(path.join(fixture.root, locks.normal))),
    })),
    /retirement.*lock.*invalid structure/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire rejects normal and recovery locks with non-RFC3339 createdAt values", async () => {
  const normalFixture = await createCompletedWaveRetirementFixture();
  const normalLocks = waveRetirementLockFiles(normalFixture);
  const invalidNormal = {
    ...waveRetirementLockValue(normalFixture),
    createdAt: "2026-08-06",
  };
  await mkdir(path.dirname(path.join(normalFixture.root, normalLocks.normal)), { recursive: true });
  await writeFile(
    path.join(normalFixture.root, normalLocks.normal),
    `${JSON.stringify(invalidNormal, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(normalFixture, {
      confirmWaveRetireLockRecovery: true,
      expectedRetirementLockSha256: sha256(
        await readFile(path.join(normalFixture.root, normalLocks.normal)),
      ),
      afterWaveRetirementOwnerAcquired: () => {
        throw new Error("unexpectedly acquired normal owner");
      },
    })),
    /retirement.*lock.*invalid structure/i,
  );
  assert.equal(await registeredWaveWorktreeCount(normalFixture), 2);

  const recoveryFixture = await createCompletedWaveRetirementFixture();
  const recoveryLocks = waveRetirementLockFiles(recoveryFixture);
  const normal = waveRetirementLockValue(recoveryFixture);
  await mkdir(path.dirname(path.join(recoveryFixture.root, recoveryLocks.normal)), { recursive: true });
  await writeFile(
    path.join(recoveryFixture.root, recoveryLocks.normal),
    `${JSON.stringify(normal, null, 2)}\n`,
    "utf8",
  );
  const normalSource = await readFile(path.join(recoveryFixture.root, recoveryLocks.normal));
  const invalidRecovery = {
    ...waveRetirementLockValue(recoveryFixture, "recovery"),
    createdAt: "2026-08-06",
    retirementLockFile: recoveryLocks.normal,
    retirementLockSha256: sha256(normalSource),
  };
  await writeFile(
    path.join(recoveryFixture.root, recoveryLocks.recovery),
    `${JSON.stringify(invalidRecovery, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(recoveryFixture, {
      confirmWaveRetireLockRecovery: true,
      expectedRetirementLockSha256: sha256(normalSource),
      expectedRetirementRecoveryLockSha256: sha256(
        await readFile(path.join(recoveryFixture.root, recoveryLocks.recovery)),
      ),
      afterWaveRetirementOwnerAcquired: () => {
        throw new Error("unexpectedly acquired recovery owner");
      },
    })),
    /retirement.*lock.*invalid structure/i,
  );
  assert.equal(await registeredWaveWorktreeCount(recoveryFixture), 2);
});

test("wave-retire rejects every Wave and implementation writer lock before ownership", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const waveRoot = path.posix.dirname(fixture.ledgerFile);
  const conflicts = [
    `.harness/runs/${fixture.state.storyId}/waves/create.lock`,
    `.harness/runs/${fixture.state.storyId}/waves/create-recovery.lock`,
    `${waveRoot}/ledger-mutation.lock`,
    `${waveRoot}/manifest-preparation.lock`,
    `${waveRoot}/integration.lock`,
    `${waveRoot}/integration-recovery.lock`,
    `.harness/runs/${fixture.state.storyId}/phases/03-implementation/batch-preparation.lock`,
    `.harness/runs/${fixture.state.storyId}/phases/03-implementation/batch-finalization.lock`,
    ...fixture.ledger.tasks.map((task) => `${waveRoot}/tasks/${task.taskId}/execute.lock`),
  ];
  const locks = waveRetirementLockFiles(fixture);

  for (const relativeFile of conflicts) {
    const lockPath = path.join(fixture.root, relativeFile);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "active writer\n", "utf8");
    await assert.rejects(
      runWorktreeCommand(waveRetireOptions(fixture)),
      /lifecycle lock|writer lock|conflicting lock/i,
      relativeFile,
    );
    await assert.rejects(access(path.join(fixture.root, locks.normal)), (error) => error?.code === "ENOENT");
    await unlink(lockPath);
  }
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire removes a finalized Wave in order, preserves branches, and reuses its final receipt", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile));
  const result = await runWorktreeCommand(waveRetireOptions(fixture, {
    now: () => "2026-08-06T00:40:00.000Z",
  }));

  assert.equal(result.command, "wave-retire");
  assert.equal(result.reused, false);
  assert.equal(await registeredWaveWorktreeCount(fixture), 0);
  for (const task of fixture.planned.plan.tasks) {
    assert.equal(
      (await git(fixture.root, "show-ref", "--verify", "--hash", `refs/heads/${task.branch}`)).stdout.trim(),
      fixture.planned.plan.baseCommit,
    );
    const receiptFile = `${path.posix.dirname(fixture.ledgerFile)}/tasks/${task.taskId}/retirement-receipt.json`;
    const receipt = JSON.parse(await readFile(path.join(fixture.root, receiptFile), "utf8"));
    assert.equal(receipt.taskId, task.taskId);
    assert.equal(receipt.recovered, false);
  }
  assert.deepEqual(await readFile(path.join(fixture.root, fixture.stateFile)), stateBefore);

  const repeated = await runWorktreeCommand(waveRetireOptions(fixture));
  assert.equal(repeated.reused, true);
  assert.equal(repeated.receipt.retirementId, result.receipt.retirementId);
});

test("PowerShell WaveRetire completes a temporary Wave and reports its Wave identity", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const script = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const common = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Command", "WaveRetire",
    "-Root", fixture.root,
    "-StateFile", fixture.stateFile,
    "-TaskDagFile", fixture.taskDagFile,
    "-WaveIndex", "1",
    "-ExpectedWaveLedgerSha256", fixture.ledgerSha256,
    "-ExpectedWaveReceiptSha256", fixture.waveReceiptSha256,
    "-ConfirmRetire",
  ];
  const completed = await execFileAsync("powershell.exe", [...common, "-Json"], { windowsHide: true });
  assert.equal(JSON.parse(completed.stdout).command, "wave-retire");
  const repeated = await execFileAsync("powershell.exe", common, { windowsHide: true });
  assert.match(repeated.stdout, new RegExp(fixture.ledger.waveId, "i"));
  assert.doesNotMatch(repeated.stdout, /undefined/i);
});

test("wave-retire recovers a task removed before its receipt and completes the remaining suffix", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveRetireRemove: ({ taskId }) => {
        if (taskId === "T1") throw new Error("simulated task retirement receipt interruption");
      },
    })),
    /receipt interruption/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 1);
  const normalSha256 = sha256(await readFile(path.join(fixture.root, locks.normal)));

  const recovered = await runWorktreeCommand(waveRetireOptions(fixture, {
    confirmWaveRetireLockRecovery: true,
    expectedRetirementLockSha256: normalSha256,
    now: () => "2026-08-06T00:41:00.000Z",
  }));
  assert.equal(recovered.receipt.recovered, true);
  assert.equal(await registeredWaveWorktreeCount(fixture), 0);
  const firstReceipt = JSON.parse(await readFile(
    path.join(fixture.root, path.posix.dirname(fixture.ledgerFile), "tasks/T1/retirement-receipt.json"),
    "utf8",
  ));
  assert.equal(firstReceipt.recovered, true);
});

test("wave-retire recovers when every task receipt exists but the final receipt is missing", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  const finalReceiptPath = path.join(
    fixture.root,
    path.posix.dirname(fixture.ledgerFile),
    "wave-retirement-receipt.json",
  );
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveTaskRetirementReceipt: ({ taskId }) => {
        if (taskId === "T2") throw new Error("simulated final retirement receipt interruption");
      },
    })),
    /final retirement receipt interruption/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 0);
  await assert.rejects(access(finalReceiptPath), (error) => error?.code === "ENOENT");

  const recovered = await runWorktreeCommand(waveRetireOptions(fixture, {
    confirmWaveRetireLockRecovery: true,
    expectedRetirementLockSha256: sha256(await readFile(path.join(fixture.root, locks.normal))),
  }));
  assert.equal(recovered.receipt.recovered, true);
  await readFile(finalReceiptPath);
});

test("wave-retire rejects a tampered stable receipt prefix before touching the suffix", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveTaskRetirementReceipt: ({ taskId }) => {
        if (taskId === "T1") throw new Error("stop after stable T1 retirement receipt");
      },
    })),
    /stable T1 retirement receipt/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 1);
  const firstReceiptPath = path.join(
    fixture.root,
    path.posix.dirname(fixture.ledgerFile),
    "tasks/T1/retirement-receipt.json",
  );
  const receipt = JSON.parse(await readFile(firstReceiptPath, "utf8"));
  receipt.executionReceiptSha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  await writeFile(firstReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      confirmWaveRetireLockRecovery: true,
      expectedRetirementLockSha256: sha256(await readFile(path.join(fixture.root, locks.normal))),
    })),
    /task retirement receipt|stable.*prefix/i,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 1);
});

test("wave-retire rejects existing task receipts with non-schema UUIDs or date-times", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveTaskRetirementReceipt: ({ taskId }) => {
        if (taskId === "T1") throw new Error("stop after T1 receipt");
      },
    })),
    /stop after T1 receipt/i,
  );
  const receiptPath = path.join(
    fixture.root,
    path.posix.dirname(fixture.ledgerFile),
    "tasks/T1/retirement-receipt.json",
  );
  const original = await readFile(receiptPath);
  const cases = [
    ["retirementId", "not-a-uuid"],
    ["retiredAt", "2026-08-06"],
  ];

  for (const [field, value] of cases) {
    const receipt = JSON.parse(original.toString("utf8"));
    receipt[field] = value;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await assert.rejects(
      runWorktreeCommand(waveRetireOptions(fixture, {
        confirmWaveRetireLockRecovery: true,
        expectedRetirementLockSha256: sha256(await readFile(path.join(fixture.root, locks.normal))),
        afterWaveRetirePreflight: () => {
          throw new Error("unexpectedly reached preflight");
        },
      })),
      /task retirement receipt.*stable evidence|invalid structure/i,
      field,
    );
    assert.equal(await registeredWaveWorktreeCount(fixture), 1, field);
  }
});

test("wave-retire rejects existing final receipts with non-schema UUIDs or date-times", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  await runWorktreeCommand(waveRetireOptions(fixture));
  const waveRoot = path.posix.dirname(fixture.ledgerFile);
  const finalPath = path.join(fixture.root, waveRoot, "wave-retirement-receipt.json");
  const taskPaths = fixture.planned.plan.tasks.map((task) => (
    path.join(fixture.root, waveRoot, `tasks/${task.taskId}/retirement-receipt.json`)
  ));
  const originalFinal = await readFile(finalPath);
  const originalTasks = await Promise.all(taskPaths.map((taskPath) => readFile(taskPath)));

  const invalidUuidFinal = JSON.parse(originalFinal.toString("utf8"));
  invalidUuidFinal.retirementId = "not-a-uuid";
  for (const [index, taskPath] of taskPaths.entries()) {
    const taskReceipt = JSON.parse(originalTasks[index].toString("utf8"));
    taskReceipt.retirementId = "not-a-uuid";
    await writeFile(taskPath, `${JSON.stringify(taskReceipt, null, 2)}\n`, "utf8");
    invalidUuidFinal.tasks[index].retirementReceiptSha256 = sha256(await readFile(taskPath));
  }
  await writeFile(finalPath, `${JSON.stringify(invalidUuidFinal, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture)),
    /retirement receipt.*invalid structure|task retirement receipt.*stable evidence/i,
  );

  for (const [index, taskPath] of taskPaths.entries()) await writeFile(taskPath, originalTasks[index]);
  const invalidDateFinal = JSON.parse(originalFinal.toString("utf8"));
  invalidDateFinal.retiredAt = "2026-08-06";
  await writeFile(finalPath, `${JSON.stringify(invalidDateFinal, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture)),
    /retirement receipt.*invalid structure/i,
  );
});

test("wave-retire writes no task receipt when Git reports success without satisfying postconditions", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const waveRoot = path.posix.dirname(fixture.ledgerFile);
  const executeGit = async (args, cwd) => {
    if (args[0] === "worktree" && args[1] === "remove") return { stdout: "", stderr: "" };
    return git(cwd, ...args);
  };

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, { executeGit })),
    /postcondition|still registered|directory still exists/i,
  );
  await assert.rejects(
    access(path.join(fixture.root, `${waveRoot}/tasks/T1/retirement-receipt.json`)),
    (error) => error?.code === "ENOENT",
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 2);
});

test("wave-retire fences replacement ownership at the task receipt write point", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  const taskReceiptPath = path.join(
    fixture.root,
    path.posix.dirname(fixture.ledgerFile),
    "tasks/T1/retirement-receipt.json",
  );
  let replacement;

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      beforeWaveTaskRetirementReceiptWrite: async ({ taskId }) => {
        if (taskId !== "T1") return;
        const normalSource = await readFile(path.join(fixture.root, locks.normal));
        const normal = JSON.parse(normalSource.toString("utf8"));
        replacement = {
          ...waveRetirementLockValue(fixture, "recovery"),
          lockId: "00000000-0000-4000-8000-000000000291",
          retirementId: normal.retirementId,
          retirementLockFile: locks.normal,
          retirementLockSha256: sha256(normalSource),
        };
        await writeFile(
          path.join(fixture.root, locks.recovery),
          `${JSON.stringify(replacement, null, 2)}\n`,
          "utf8",
        );
      },
    })),
    /ownership.*changed|fenced/i,
  );
  await assert.rejects(access(taskReceiptPath), (error) => error?.code === "ENOENT");
  assert.equal(
    JSON.parse(await readFile(path.join(fixture.root, locks.recovery), "utf8")).lockId,
    replacement.lockId,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 1);
});

test("wave-retire fences replacement ownership at the final receipt write point", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  const finalReceiptPath = path.join(
    fixture.root,
    path.posix.dirname(fixture.ledgerFile),
    "wave-retirement-receipt.json",
  );
  let replacement;

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      beforeWaveRetirementReceiptWrite: async () => {
        const normalSource = await readFile(path.join(fixture.root, locks.normal));
        const normal = JSON.parse(normalSource.toString("utf8"));
        replacement = {
          ...waveRetirementLockValue(fixture, "recovery"),
          lockId: "00000000-0000-4000-8000-000000000292",
          retirementId: normal.retirementId,
          retirementLockFile: locks.normal,
          retirementLockSha256: sha256(normalSource),
        };
        await writeFile(
          path.join(fixture.root, locks.recovery),
          `${JSON.stringify(replacement, null, 2)}\n`,
          "utf8",
        );
      },
    })),
    /ownership.*changed|fenced/i,
  );
  await assert.rejects(access(finalReceiptPath), (error) => error?.code === "ENOENT");
  assert.equal(
    JSON.parse(await readFile(path.join(fixture.root, locks.recovery), "utf8")).lockId,
    replacement.lockId,
  );
  assert.equal(await registeredWaveWorktreeCount(fixture), 0);
});

test("wave-retire preserves a replacement normal lock at the release point", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  let replacement;

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      beforeWaveRetirementLockRelease: async ({ lockMode }) => {
        if (lockMode !== "retire") return;
        const normal = JSON.parse(await readFile(path.join(fixture.root, locks.normal), "utf8"));
        replacement = {
          ...waveRetirementLockValue(fixture),
          lockId: "00000000-0000-4000-8000-000000000293",
          retirementId: normal.retirementId,
        };
        await writeFile(
          path.join(fixture.root, locks.normal),
          `${JSON.stringify(replacement, null, 2)}\n`,
          "utf8",
        );
      },
    })),
    /ownership.*changed|lock.*changed|fenced/i,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(fixture.root, locks.normal), "utf8")).lockId,
    replacement.lockId,
  );
});

test("wave-retire rejects a drifted final receipt instead of trusting absent Worktrees", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  await runWorktreeCommand(waveRetireOptions(fixture));
  const receiptPath = path.join(
    fixture.root,
    path.posix.dirname(fixture.ledgerFile),
    "wave-retirement-receipt.json",
  );
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.waveReceiptSha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture)),
    /wave retirement receipt|final receipt/i,
  );
});

test("wave-retire explicitly recovers a final receipt written before owner lock release", async () => {
  const fixture = await createCompletedWaveRetirementFixture();
  const locks = waveRetirementLockFiles(fixture);
  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture, {
      afterWaveRetirementReceipt: () => {
        throw new Error("simulated retirement lock release interruption");
      },
    })),
    /lock release interruption/i,
  );
  const normalSha256 = sha256(await readFile(path.join(fixture.root, locks.normal)));

  await assert.rejects(
    runWorktreeCommand(waveRetireOptions(fixture)),
    /owner locks|explicit recovery/i,
  );
  const recovered = await runWorktreeCommand(waveRetireOptions(fixture, {
    confirmWaveRetireLockRecovery: true,
    expectedRetirementLockSha256: normalSha256,
  }));
  assert.equal(recovered.reused, true);
  await assert.rejects(access(path.join(fixture.root, locks.normal)), (error) => error?.code === "ENOENT");
  await assert.rejects(access(path.join(fixture.root, locks.recovery)), (error) => error?.code === "ENOENT");
});

test("finalize-wave binds formal phase artifacts and M3 apply advances exactly once", async () => {
  const fixture = await createFinalizableWaveFixture();
  const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const finalized = await finalizeWaveFixture(fixture);
  const checkpoint = JSON.parse(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"));
  const ledger = JSON.parse(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile), "utf8"));

  assert.equal(finalized.status, "ready-for-apply");
  assert.equal(ledger.status, "finalized");
  assert.equal(checkpoint.waveFinalization.waveId, fixture.frozen.ledger.waveId);
  assert.equal(checkpoint.waveFinalization.waveLedgerSha256, sha256(
    await readFile(path.join(fixture.root, fixture.ledger.ledgerFile)),
  ));
  assert.match(await readFile(path.join(fixture.root, finalized.notesFile), "utf8"), /T1[\s\S]*T2/);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  await assert.rejects(readFile(path.join(fixture.root, fixture.integrated.integrationLockFile)), /ENOENT/);

  const repeatedFinalize = await finalizeWaveFixture(fixture);
  assert.equal(repeatedFinalize.status, "ready-for-apply");
  const applied = await runStoryCommand({
    root: fixture.root,
    command: "apply",
    stateFile: fixture.stateFile,
    now: () => "2026-08-06T00:20:00.000Z",
  });
  assert.equal(applied.state.phase, "unit-test");
  const repeatedApply = await runStoryCommand({
    root: fixture.root,
    command: "apply",
    stateFile: fixture.stateFile,
    now: () => "2026-08-06T00:21:00.000Z",
  });
  assert.equal(repeatedApply.status, "already-applied");
});

test("Wave M3 apply resumes both before and after the state advance boundary", async () => {
  const before = await createFinalizableWaveFixture();
  await finalizeWaveFixture(before);
  await assert.rejects(
    runStoryCommand({
      root: before.root,
      command: "apply",
      stateFile: before.stateFile,
      now: () => "2026-08-06T00:22:00.000Z",
      beforeAdvance: () => { throw new Error("simulated Wave pre-advance interruption"); },
    }),
    /pre-advance interruption/i,
  );
  assert.equal(JSON.parse(await readFile(path.join(before.root, before.stateFile), "utf8")).phase, "implementation");
  assert.equal((await runStoryCommand({
    root: before.root,
    command: "apply",
    stateFile: before.stateFile,
    now: () => "2026-08-06T00:23:00.000Z",
  })).state.phase, "unit-test");

  const after = await createFinalizableWaveFixture();
  await finalizeWaveFixture(after);
  await assert.rejects(
    runStoryCommand({
      root: after.root,
      command: "apply",
      stateFile: after.stateFile,
      now: () => "2026-08-06T00:24:00.000Z",
      afterAdvance: () => { throw new Error("simulated Wave post-advance interruption"); },
    }),
    /post-advance interruption/i,
  );
  assert.equal(JSON.parse(await readFile(path.join(after.root, after.stateFile), "utf8")).phase, "unit-test");
  assert.equal((await runStoryCommand({
    root: after.root,
    command: "apply",
    stateFile: after.stateFile,
    now: () => "2026-08-06T00:25:00.000Z",
  })).status, "already-applied");
});

test("execute-wave preserves a successful receipt and leaves a failed task blocked without implicit retry", async () => {
  const fixture = await createWaveWorkerFixture({ claimTask: false });
  const uuidValues = [
    "00000000-0000-4000-8000-000000000021",
    "00000000-0000-4000-8000-000000000022",
    "00000000-0000-4000-8000-000000000023",
    "00000000-0000-4000-8000-000000000024",
    "00000000-0000-4000-8000-000000000025",
    "00000000-0000-4000-8000-000000000026",
  ];
  let providerCalls = 0;
  const provider = async ({ task }) => {
    providerCalls += 1;
    if (task.taskId === "T2") throw new Error("simulated T2 failure");
    return {
      files: [
        { path: task.expectedOutputs[0], content: "# T1 report\n", capability: "phase-output" },
        { path: "backend/src/main/T1.java", content: "class T1 {}\n", capability: "backend-write" },
      ],
      result: {
        schemaVersion: "1.2",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        runId: task.runId,
        phase: task.phase,
        waveId: task.waveId,
        waveIndex: task.waveIndex,
        taskId: task.taskId,
        taskRoot: task.taskRoot,
        status: "completed",
        summary: "T1 is ready.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    };
  };
  const first = await runWaveExecutionCommand({
    root: fixture.root,
    command: "execute-wave",
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveExecute: true,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    randomUUID: () => uuidValues.shift(),
    provider,
  });

  assert.equal(first.ledger.status, "partial");
  assert.deepEqual(first.ledger.tasks.map((task) => task.status), ["ready-for-integration", "blocked"]);
  assert.match(first.settled.find((item) => item.taskId === "T2").outcome, /blocked/);
  const readyReceipt = first.ledger.tasks[0].executionReceiptFile;
  const readyReceiptBefore = await readFile(path.join(fixture.root, readyReceipt), "utf8");

  const repeated = await runWaveExecutionCommand({
    root: fixture.root,
    command: "execute-wave",
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    confirmWaveExecute: true,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    provider,
  });
  assert.deepEqual(repeated.claimedTaskIds, []);
  assert.equal(providerCalls, 2);
  assert.equal(await readFile(path.join(fixture.root, readyReceipt), "utf8"), readyReceiptBefore);
  await assert.rejects(readFile(path.join(fixture.root, "backend/src/main/T1.java")), /ENOENT/);

  const blockedTask = repeated.ledger.tasks.find((task) => task.taskId === "T2");
  const previousAttemptId = blockedTask.currentAttemptId;
  const previousFailureFile = `${fixture.task.taskRoot.replace(/T1$/, "T2")}/attempts/${previousAttemptId}/failure.json`;
  const previousFailureSha256 = sha256(await readFile(path.join(fixture.root, previousFailureFile)));
  const previousFailureBefore = await readFile(path.join(fixture.root, previousFailureFile), "utf8");
  await assert.rejects(
    runWaveExecutionCommand({
      root: fixture.root,
      command: "retry-task",
      stateFile: fixture.stateFile,
      ledgerFile: fixture.ledger.ledgerFile,
      taskId: "T2",
      expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      expectedPreviousFailureSha256: previousFailureSha256,
      provider,
    }),
    /ConfirmWaveTaskRetry/i,
  );
  const retryUuidValues = [
    "10000000-0000-4000-8000-000000000031",
    "20000000-0000-4000-8000-000000000032",
    "30000000-0000-4000-8000-000000000033",
  ];
  const retried = await runWaveExecutionCommand({
    root: fixture.root,
    command: "retry-task",
    stateFile: fixture.stateFile,
    ledgerFile: fixture.ledger.ledgerFile,
    taskId: "T2",
    confirmWaveTaskRetry: true,
    expectedWaveLedgerSha256: sha256(await readFile(path.join(fixture.root, fixture.ledger.ledgerFile))),
    expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
    expectedPreviousFailureSha256: previousFailureSha256,
    randomUUID: () => retryUuidValues.shift(),
    provider: async ({ task }) => ({
      files: [
        { path: task.expectedOutputs[0], content: "# T2 retry report\n", capability: "phase-output" },
        { path: "frontend/src/T2.ts", content: "export const retried = true;\n", capability: "frontend-write" },
      ],
      result: {
        schemaVersion: "1.2",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        runId: task.runId,
        phase: task.phase,
        waveId: task.waveId,
        waveIndex: task.waveIndex,
        taskId: task.taskId,
        taskRoot: task.taskRoot,
        status: "completed",
        summary: "T2 retry is ready.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    }),
  });
  assert.equal(retried.ledger.status, "ready-for-integration");
  assert.notEqual(retried.task.currentAttemptId, previousAttemptId);
  assert.equal(await readFile(path.join(fixture.root, previousFailureFile), "utf8"), previousFailureBefore);
});

test("allows a declared Worker candidate to update an existing base context file", async () => {
  const fixture = await createFixture();
  const businessFile = "backend/src/main/ExistingService.java";
  const original = await readFile(path.join(fixture.root, businessFile), "utf8");
  const collected = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    contextFiles: [businessFile],
    provider: async ({ task, context }) => {
      assert.equal(context[0].path, businessFile);
      assert.match(context[0].content, /class ExistingService/);
      return {
        files: [
          { path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" },
          { path: businessFile, content: "class ExistingService { void updated() {} }\n", capability: "backend-write" },
        ],
        result: {
          schemaVersion: "1.0",
          dispatchId: task.dispatchId,
          storyId: task.storyId,
          phase: task.phase,
          status: "completed",
          summary: "Worker updated an existing business file.",
          outputs: task.expectedOutputs.map((output) => ({ path: output })),
          records: [],
        },
      };
    },
  });

  assert.equal(collected.outcome, "ready-for-integration");
  assert.equal(await readFile(path.join(fixture.root, businessFile), "utf8"), original);
  const worktreeRoot = path.join(fixture.root, `.harness/worktrees/${fixture.storyId}/${fixture.taskId}`);
  assert.equal(
    await readFile(path.join(worktreeRoot, businessFile), "utf8"),
    "class ExistingService { void updated() {} }\n",
  );
  const repeated = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    contextFiles: [businessFile],
    provider: async () => { throw new Error("Provider must not run when reusing the receipt."); },
  });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.outcome, "ready-for-integration");
});

test("reuses a matching execution receipt without calling the Provider twice", async () => {
  const fixture = await createFixture();
  let providerCalls = 0;
  const provider = async ({ task }) => {
    providerCalls += 1;
    return {
      files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
      result: {
        schemaVersion: "1.0",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        phase: task.phase,
        status: "completed",
        summary: "Worker completed the phase output.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    };
  };
  const first = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider,
  });
  const repeated = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider,
  });

  assert.equal(first.outcome, "ready-for-apply");
  assert.equal(repeated.outcome, "ready-for-apply");
  assert.equal(repeated.reused, true);
  assert.equal(providerCalls, 1);
});

test("recovers collection after the Worker completed without rerunning the Provider", async () => {
  const fixture = await createFixture();
  let providerCalls = 0;
  const provider = async ({ task }) => {
    providerCalls += 1;
    return {
      files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
      result: {
        schemaVersion: "1.0",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        phase: task.phase,
        status: "completed",
        summary: "Worker completed before interruption.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    };
  };
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider,
      afterWorker: () => { throw new Error("simulated collection interruption"); },
    }),
    /simulated collection interruption/,
  );

  const recovered = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider,
  });
  assert.equal(recovered.outcome, "ready-for-apply");
  assert.equal(recovered.reused, false);
  assert.equal(providerCalls, 1);
});

test("rejects an existing execution lock without calling the Provider", async () => {
  const fixture = await createFixture();
  const lockFile = path.join(fixture.root, `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}/execute.lock`);
  await writeFile(lockFile, "stale\n", "utf8");
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /execution lock already exists/i,
  );
  assert.equal(providerCalls, 0);
  assert.equal(await readFile(lockFile, "utf8"), "stale\n");
});

test("rejects a retirement lock after acquiring the execution lock", async () => {
  const fixture = await createFixture();
  const retirementLock = path.join(fixture.root, `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}/retire.lock`);
  const executionLock = path.join(fixture.root, `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}/execute.lock`);
  await writeFile(retirementLock, "retiring\n", "utf8");
  let providerCalls = 0;

  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => {
        providerCalls += 1;
        throw new Error("Provider must not run while retirement is active.");
      },
    }),
    /retirement lock/i,
  );

  assert.equal(providerCalls, 0);
  assert.equal(await readFile(retirementLock, "utf8"), "retiring\n");
  await assert.rejects(readFile(executionLock), /ENOENT/);
});

test("advances exactly once only after the caller explicitly applies a ready result", async () => {
  const fixture = await createFixture();
  const collected = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider: async ({ task }) => ({
      files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
      result: {
        schemaVersion: "1.0",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        phase: task.phase,
        status: "completed",
        summary: "Ready for explicit apply.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    }),
  });
  const beforeApply = JSON.parse(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"));
  assert.equal(collected.outcome, "ready-for-apply");
  assert.equal(beforeApply.phase, "implementation");
  assert.equal(beforeApply.runtime.revision, 4);

  const applied = await runStoryCommand({
    root: fixture.root,
    command: "apply",
    stateFile: fixture.stateFile,
    now: () => "2026-07-21T00:01:00.000Z",
  });
  assert.equal(applied.status, "completed");
  assert.equal(applied.state.phase, "unit-test");
  assert.equal(applied.state.runtime.revision, 5);
});

test("reuses a verified input snapshot after a Provider failure", async () => {
  const fixture = await createFixture();
  let providerCalls = 0;
  const provider = async ({ task }) => {
    providerCalls += 1;
    if (providerCalls === 1) throw new Error("simulated Provider failure");
    return {
      files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
      result: {
        schemaVersion: "1.0",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        phase: task.phase,
        status: "completed",
        summary: "Explicit retry completed.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    };
  };
  await assert.rejects(
    runWorktreeWorker({ root: fixture.root, stateFile: fixture.stateFile, taskId: fixture.taskId, taskFile: fixture.taskFile, provider }),
    /simulated Provider failure/,
  );
  const retried = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
    provider,
  });
  assert.equal(retried.outcome, "ready-for-apply");
  assert.equal(providerCalls, 2);
});

test("leaves the Worktree clean when a later input fails validation", async () => {
  const fixture = await createFixture();
  const missingContext = `.harness/runs/${fixture.runId}/phases/01-technical-design/missing.md`;
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      contextFiles: [fixture.runContextFile, missingContext],
      provider: async () => { providerCalls += 1; },
    }),
    /input file is missing/i,
  );
  const worktreeRoot = path.join(fixture.root, `.harness/worktrees/${fixture.storyId}/${fixture.taskId}`);
  assert.equal((await git(worktreeRoot, "status", "--porcelain=v1", "--untracked-files=all")).stdout, "");
  assert.equal(providerCalls, 0);
});

test("rejects a task that does not match the current M3 checkpoint", async () => {
  const fixture = await createFixture();
  const checkpointPath = path.join(fixture.root, fixture.checkpointFile);
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  checkpoint.dispatchId = "22222222-2222-4222-8222-222222222222";
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider: async () => { providerCalls += 1; },
    }),
    /M3 checkpoint.*dispatch/i,
  );
  assert.equal(providerCalls, 0);
});

test("fails closed when recovering business files without a durable candidate list", async () => {
  const fixture = await createFixture();
  const businessFile = "backend/src/main/recovery.txt";
  let providerCalls = 0;
  const provider = async ({ task }) => {
    providerCalls += 1;
    return {
      files: [
        { path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" },
        { path: businessFile, content: "business change\n", capability: "backend-write" },
      ],
      result: {
        schemaVersion: "1.0",
        dispatchId: task.dispatchId,
        storyId: task.storyId,
        phase: task.phase,
        status: "completed",
        summary: "Business files need durable collection evidence.",
        outputs: task.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    };
  };
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      taskFile: fixture.taskFile,
      provider,
      afterWorker: () => { throw new Error("simulated collection interruption"); },
    }),
    /simulated collection interruption/,
  );
  await assert.rejects(
    runWorktreeWorker({ root: fixture.root, stateFile: fixture.stateFile, taskId: fixture.taskId, taskFile: fixture.taskFile, provider }),
    /cannot safely recover business writes/i,
  );
  assert.equal(providerCalls, 1);
});

test("rejects Worktree changes added after the execution receipt", async () => {
  const fixture = await createFixture();
  const provider = async ({ task }) => ({
    files: [{ path: task.expectedOutputs[0], content: "implementation notes\n", capability: "phase-output" }],
    result: {
      schemaVersion: "1.0",
      dispatchId: task.dispatchId,
      storyId: task.storyId,
      phase: task.phase,
      status: "completed",
      summary: "Receipt is complete.",
      outputs: task.expectedOutputs.map((output) => ({ path: output })),
      records: [],
    },
  });
  await runWorktreeWorker({ root: fixture.root, stateFile: fixture.stateFile, taskId: fixture.taskId, taskFile: fixture.taskFile, provider });
  const worktreeRoot = path.join(fixture.root, `.harness/worktrees/${fixture.storyId}/${fixture.taskId}`);
  await writeFile(path.join(worktreeRoot, "late-change.txt"), "late\n", "utf8");
  await assert.rejects(
    runWorktreeWorker({ root: fixture.root, stateFile: fixture.stateFile, taskId: fixture.taskId, taskFile: fixture.taskFile, provider }),
    /unexpected Worktree change.*late-change\.txt/i,
  );
});
