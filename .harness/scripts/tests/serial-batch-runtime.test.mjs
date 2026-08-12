import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { claimBatchTask } from "../lib/batch-runtime.mjs";
import { runStateCommand } from "../lib/state-runtime.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";
import { runWorktreeIntegration } from "../lib/worktree-integration-runtime.mjs";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";
import { runWorktreeWorker } from "../lib/worktree-worker-runtime.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryRoots = [];

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(root, relativeFile) {
  return JSON.parse(await readFile(path.join(root, relativeFile), "utf8"));
}

function workerResponse(task, businessFile, content) {
  return {
    files: [
      { path: task.expectedOutputs[0], content: `# ${task.taskId} report\n`, capability: "phase-output" },
      { path: businessFile, content, capability: "backend-write" },
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
      summary: `${task.taskId} completed the serial batch fixture.`,
      outputs: task.expectedOutputs.map((output) => ({ path: output })),
      records: [],
    },
  };
}

async function materializeCompletedV1State(root, stateFile) {
  const statePath = path.join(root, stateFile);
  const activeState = await readFile(statePath);
  const state = JSON.parse(activeState);
  state.phase = "done";
  state.runtime.status = "completed";
  state.runtime.previousPhase = "git-delivery";
  state.runtime.revision += 1;
  state.runtime.updatedAt = "2026-07-28T01:01:30.000Z";
  state.logs.push({
    type: "completed",
    from: "git-delivery",
    revision: state.runtime.revision,
    createdAt: state.runtime.updatedAt,
  });
  await writeFile(`${statePath}.bak`, activeState);
  await writeJson(statePath, state);
  await writeFile(
    statePath.replace(/\.json$/, ".events.jsonl"),
    `${JSON.stringify({
      event: "committed",
      action: "complete",
      transactionId: "historical-v1-completion",
      runId: state.runtime.runId,
      revision: state.runtime.revision,
      createdAt: state.runtime.updatedAt,
    })}\n`,
    "utf8",
  );
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b3-serial-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5b3-serial@example.test");
  await git(root, "config", "user.name", "M5-B3 Serial Test");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await mkdir(path.join(root, ".harness/workflows"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".harness/workflows/e2e-development.yaml"), path.join(root, ".harness/workflows/e2e-development.yaml"));
  await mkdir(path.join(root, "backend/src/service"), { recursive: true });
  await writeFile(path.join(root, "backend/src/service/SharedService.java"), "class SharedService {}\n", "utf8");
  await git(root, "add", ".gitignore", ".codex/agents", ".harness/workflows", "backend");
  await git(root, "commit", "-m", "serial batch fixture base");

  const storyId = "M5-B3-B-SERIAL-FIXTURE";
  const runId = storyId;
  const stateFile = `.harness/states/e2e-${storyId}.json`;
  const taskDagFile = `.harness/runs/${runId}/phases/02-task-dag/task-dag.json`;
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
      createdAt: "2026-07-28T01:00:00.000Z",
      updatedAt: "2026-07-28T01:00:00.000Z",
    },
    requirement: { summary: "Serial batch vertical fixture", openQuestions: [], acceptanceCriteria: [] },
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
  const dag = {
    schemaVersion: "1.0",
    storyId,
    nodes: [
      {
        taskId: "T1",
        title: "Implement the backend candidate",
        type: "backend",
        status: "pending",
        predictedFiles: ["backend/src/service/**"],
        acceptanceCriteria: ["The backend candidate is integrated."],
        ownerAgent: "backend-developer",
      },
      {
        taskId: "T2",
        title: "Refine the backend candidate",
        type: "backend",
        status: "pending",
        predictedFiles: ["backend/src/service/**"],
        acceptanceCriteria: ["The backend candidate is refined."],
        ownerAgent: "backend-developer",
      },
    ],
    edges: [{ from: "T1", to: "T2", reason: "The second backend task refines the integrated candidate." }],
    waves: [["T1"], ["T2"]],
    globalChanges: [],
    risks: [],
  };
  await writeJson(path.join(root, stateFile), state);
  await writeJson(path.join(root, taskDagFile), dag);
  return { root, storyId, runId, stateFile, taskDagFile };
}

async function claimAndCompleteTask(fixture, prepared, taskId, businessFile, content, options = {}) {
  const claimed = await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: prepared.batchFile,
    taskId,
    now: () => `2026-07-28T01:01:${taskId === "T1" ? "00" : "10"}.000Z`,
  });
  const completed = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId,
    taskFile: claimed.task.taskFile,
    provider: ({ task }) => workerResponse(task, businessFile, content),
    contextFiles: options.contextFiles,
    now: () => `2026-07-28T01:01:${taskId === "T1" ? "01" : "11"}.000Z`,
  });
  const integrationInput = {
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: prepared.batchFile,
    taskId,
    now: () => `2026-07-28T01:01:${taskId === "T1" ? "02" : "12"}.000Z`,
  };
  await runWorktreeIntegration({ ...integrationInput, command: "plan" });
  const integrated = await runWorktreeIntegration({ ...integrationInput, command: "apply", confirmApply: true });
  return { claimed, completed, integrationInput, integrated };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("runs two serial batch tasks through one explicit phase apply and idempotent retirement", async () => {
  const fixture = await createFixture();
  const prepared = await runStoryCommand({
    root: fixture.root,
    command: "prepare-batch",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    now: () => "2026-07-28T01:00:01.000Z",
  });
  const beforeFirstIntegration = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-plan",
    stateFile: fixture.stateFile,
    now: () => "2026-07-28T01:00:02.000Z",
  });
  assert.equal(planned.status.state, "absent");
  const absent = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  assert.equal(absent.status.state, "absent");
  const created = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-create",
    stateFile: fixture.stateFile,
    confirmCreate: true,
    now: () => "2026-07-28T01:00:03.000Z",
  });
  assert.equal(created.status.state, "created");
  const createdStatus = await runWorktreeCommand({ root: fixture.root, command: "batch-status", stateFile: fixture.stateFile });
  assert.equal(createdStatus.status.state, "created");
  const mainRunContext = `.harness/runs/${fixture.runId}/phases/03-implementation/main-run-context.md`;
  await writeFile(path.join(fixture.root, mainRunContext), "# Main run context\n", "utf8");

  const first = await claimAndCompleteTask(
    fixture,
    prepared,
    "T1",
    "backend/src/service/SharedService.java",
    "class SharedService { void first() {} }\n",
    { contextFiles: [mainRunContext] },
  );
  assert.equal(first.completed.outcome, "ready-for-integration");
  assert.equal(first.integrated.outcome, "integrated");
  assert.equal(await readFile(path.join(fixture.root, created.plan.worktreePath, mainRunContext), "utf8"), "# Main run context\n");
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeFirstIntegration);
  const afterFirst = await readJson(fixture.root, prepared.batchFile);
  assert.equal(afterFirst.tasks.find((task) => task.taskId === "T1").status, "integrated");
  assert.equal(afterFirst.tasks.find((task) => task.taskId === "T2").status, "pending");
  const repeatedIntegration = await runWorktreeIntegration({ ...first.integrationInput, command: "apply", confirmApply: true });
  assert.equal(repeatedIntegration.reused, true);

  const secondClaim = await claimBatchTask({
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: prepared.batchFile,
    taskId: "T2",
    now: () => "2026-07-28T01:01:10.000Z",
  });
  let providerCalls = 0;
  await assert.rejects(
    runWorktreeWorker({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskId: "T2",
      taskFile: secondClaim.task.taskFile,
      contextFiles: [mainRunContext],
      provider: async () => {
        providerCalls += 1;
        throw new Error("simulated T2 provider failure");
      },
    }),
    /simulated T2 provider failure/,
  );
  assert.equal(providerCalls, 1);
  await assert.rejects(
    readFile(path.join(fixture.root, `.harness/runs/${fixture.runId}/phases/03-implementation/result.json`)),
    /ENOENT/,
  );
  const afterFailure = await readJson(fixture.root, prepared.batchFile);
  const failedTask = afterFailure.tasks.find((task) => task.taskId === "T2");
  assert.equal(failedTask.status, "running");
  await assert.rejects(readFile(path.join(fixture.root, failedTask.resultFile)), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.root, failedTask.executionReceiptFile)), /ENOENT/);

  const second = await runWorktreeWorker({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskId: "T2",
    taskFile: secondClaim.task.taskFile,
    contextFiles: [mainRunContext],
    provider: ({ task }) => workerResponse(task, "backend/src/service/SharedService.java", "class SharedService { void second() {} }\n"),
    now: () => "2026-07-28T01:01:11.000Z",
  });
  assert.equal(second.outcome, "ready-for-integration");
  const secondIntegration = {
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile: prepared.batchFile,
    taskId: "T2",
    now: () => "2026-07-28T01:01:12.000Z",
  };
  await runWorktreeIntegration({ ...secondIntegration, command: "plan" });
  const integratedSecond = await runWorktreeIntegration({ ...secondIntegration, command: "apply", confirmApply: true });
  assert.equal(integratedSecond.outcome, "integrated");
  const repeatedSecondIntegration = await runWorktreeIntegration({ ...secondIntegration, command: "apply", confirmApply: true });
  assert.equal(repeatedSecondIntegration.reused, true);

  const beforeFinalization = await readJson(fixture.root, fixture.stateFile);
  const finalized = await runStoryCommand({
    root: fixture.root,
    command: "finalize-batch",
    stateFile: fixture.stateFile,
    batchFile: prepared.batchFile,
    now: () => "2026-07-28T01:01:20.000Z",
  });
  assert.equal(finalized.status, "ready-for-apply");
  assert.deepEqual(await readJson(fixture.root, fixture.stateFile), beforeFinalization);
  await assert.rejects(
    runStoryCommand({ root: fixture.root, command: "apply", stateFile: fixture.stateFile }),
    /State v1 is read-only/i,
  );

  const checkpoint = await readJson(
    fixture.root,
    `.harness/runs/${fixture.runId}/phases/03-implementation/checkpoint.json`,
  );
  checkpoint.status = "completed";
  checkpoint.completedAt = "2026-07-28T01:01:29.000Z";
  checkpoint.updatedAt = checkpoint.completedAt;
  await writeJson(
    path.join(fixture.root, `.harness/runs/${fixture.runId}/phases/03-implementation/checkpoint.json`),
    checkpoint,
  );
  await materializeCompletedV1State(fixture.root, fixture.stateFile);
  await git(fixture.root, "add", "-f", ".harness/states", ".harness/runs");
  await git(fixture.root, "commit", "-m", "complete serial batch fixture");
  const completedState = await readFile(path.join(fixture.root, fixture.stateFile));
  let removalCompleted = 0;
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "batch-retire",
      stateFile: fixture.stateFile,
      confirmRetire: true,
      afterBatchRetireRemove: () => {
        removalCompleted += 1;
        throw new Error("simulated retirement receipt interruption");
      },
    }),
    /simulated retirement receipt interruption/,
  );
  await assert.rejects(
    readFile(path.join(fixture.root, created.plan.worktreePath, "backend/src/service/SharedService.java")),
    /ENOENT/,
  );
  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
    now: () => "2026-07-28T01:02:00.000Z",
  });
  assert.equal(retired.reused, false);
  assert.equal(retired.receipt.recovered, true);
  assert.equal(removalCompleted, 1);
  assert.equal((await git(fixture.root, "show-ref", "--verify", "--hash", `refs/heads/${created.plan.branch}`)).stdout.trim(), created.plan.baseCommit);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), completedState.toString("utf8"));
  const repeatedRetirement = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
  });
  assert.equal(repeatedRetirement.reused, true);
});
