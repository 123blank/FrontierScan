import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { claimBatchTask } from "../lib/batch-runtime.mjs";
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

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

async function advanceStoryToDone(root, stateFile, runId) {
  const statePath = path.join(root, stateFile);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const completedAt = "2026-07-22T00:00:19.000Z";
  const outputs = [
    `.harness/runs/${runId}/phases/04-unit-test/test-report.md`,
    `.harness/runs/${runId}/phases/05-code-review/code-review-report.md`,
    `.harness/runs/${runId}/phases/06-build-publish/build-report.md`,
    `.harness/runs/${runId}/phases/07-interface-verification/interface-verification-report.md`,
    `.harness/runs/${runId}/phases/08-git-delivery/delivery-report.md`,
  ];
  for (const [index, output] of outputs.entries()) {
    await mkdir(path.dirname(path.join(root, output)), { recursive: true });
    await writeFile(path.join(root, output), `fixture phase ${index + 4}\n`, "utf8");
  }

  await copyFile(statePath, `${statePath}.bak`);
  state.phase = "done";
  state.runtime.status = "completed";
  state.runtime.revision = Math.max(state.runtime.revision + 1, 9);
  state.runtime.previousPhase = "git-delivery";
  state.runtime.blocked = null;
  state.runtime.updatedAt = completedAt;
  await writeJson(statePath, state);
  await writeFile(
    path.join(root, `.harness/states/e2e-${state.storyId}.events.jsonl`),
    `${JSON.stringify({
      schemaVersion: "1.0",
      storyId: state.storyId,
      runId,
      revision: state.runtime.revision,
      command: "complete",
      phase: "done",
      status: "completed",
      occurredAt: completedAt,
    })}\n`,
    "utf8",
  );
  await rm(path.join(root, ".harness/states/active-run.json"), { force: true });
}

async function createCompletedIntegrationFixture({ refreshStatusBeforeCompletion = false, realFlow = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5c-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5c@example.test");
  await git(root, "config", "user.name", "M5-C Test");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await mkdir(path.join(root, ".harness/workflows"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".harness/workflows/e2e-development.yaml"), path.join(root, ".harness/workflows/e2e-development.yaml"));
  await mkdir(path.join(root, "backend/src/main"), { recursive: true });
  await writeFile(path.join(root, "backend/src/main/ExistingService.java"), "class ExistingService {}\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture base");

  const storyId = "M5-B2-RETIRE";
  const runId = storyId;
  const taskId = "T1";
  const stateFile = `.harness/states/e2e-${storyId}.json`;
  const taskDagFile = `.harness/runs/${runId}/phases/02-task-dag/task-dag.json`;
  const phaseDirectory = `.harness/runs/${runId}/phases/03-implementation`;
  const taskFile = `${phaseDirectory}/task.json`;
  const checkpointFile = `${phaseDirectory}/checkpoint.json`;
  const phaseOutput = `${phaseDirectory}/implementation-notes.md`;
  const resultFile = `${phaseDirectory}/result.json`;
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
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    },
    requirement: { summary: "M5-C retirement fixture", openQuestions: [], acceptanceCriteria: [] },
    knowledge: { loadedFiles: [], staleFiles: [], missingAreas: [] },
    tasks: [],
    dag: { nodes: [], edges: [], waves: [] },
    worktrees: [],
    tests: { commands: [], results: [] },
    review: { findings: [], status: "passed" },
    verification: { cases: [], results: [] },
    delivery: { ownedFiles: [], commit: null, pr: null },
    logs: [],
  };
  const dag = {
    schemaVersion: "1.0",
    storyId,
    nodes: [{
      taskId,
      title: "Retire integrated Worktree",
      type: "integration",
      status: "pending",
      predictedFiles: ["backend/src/main/**"],
      acceptanceCriteria: ["The Worktree can be retired safely."],
      ownerAgent: "backend-developer",
    }],
    edges: [],
    waves: [[taskId]],
    globalChanges: [],
    risks: [],
  };
  const task = {
    schemaVersion: "1.0",
    dispatchId: "11111111-1111-4111-8111-111111111111",
    storyId,
    phase: "implementation",
    ownerAgent: "backend-developer",
    purpose: "Implement task-owned changes only.",
    preparedRevision: 4,
    preparedAt: "2026-07-22T00:00:00.000Z",
    expectedOutputs: [phaseOutput],
    allowedAdapters: [],
    next: "unit-test",
  };
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
    await writeJson(path.join(root, relative), value);
  }

  await runWorktreeCommand({ root, command: "plan", stateFile, taskDagFile, taskId });
  await runWorktreeCommand({ root, command: "create", stateFile, taskId, confirmCreate: true });
  const worktreePath = path.join(root, `.harness/worktrees/${storyId}/${taskId}`);
  const planFile = `.harness/runs/${runId}/worktrees/${taskId}/plan.json`;
  const statusFile = `.harness/runs/${runId}/worktrees/${taskId}/status.json`;
  const plan = JSON.parse(await readFile(path.join(root, planFile), "utf8"));

  const candidatePath = "backend/src/main/ExistingService.java";
  const candidate = "class ExistingService { void integrated() {} }\n";
  const output = "implementation notes\n";
  const result = {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId,
    phase: task.phase,
    status: "completed",
    summary: "Worker completed the retirement fixture.",
    outputs: [{ path: phaseOutput }],
    records: [],
  };
  if (realFlow) {
    const collected = await runWorktreeWorker({
      root,
      stateFile,
      taskId,
      taskFile,
      contextFiles: [candidatePath],
      now: () => "2026-07-22T00:00:01.000Z",
      provider: async ({ task: workerTask }) => ({
        files: [
          { path: phaseOutput, content: output, capability: "phase-output" },
          { path: candidatePath, content: candidate, capability: "backend-write" },
        ],
        result: {
          ...result,
          dispatchId: workerTask.dispatchId,
          storyId: workerTask.storyId,
          phase: workerTask.phase,
          outputs: workerTask.expectedOutputs.map((expected) => ({ path: expected })),
        },
      }),
    });
    const executionReceiptFile = collected.receiptFile;
    const executionReceipt = JSON.parse(await readFile(path.join(root, executionReceiptFile), "utf8"));
    const statusSha256BeforeIntegration = await sha256File(path.join(root, statusFile));
    assert.equal(executionReceipt.statusSha256, statusSha256BeforeIntegration);

    const integrationInput = {
      root,
      command: "plan",
      stateFile,
      taskId,
      taskFile,
      now: () => "2026-07-22T00:00:02.000Z",
    };
    await runWorktreeIntegration(integrationInput);
    const statusSha256AfterIntegrationPlan = await sha256File(path.join(root, statusFile));
    await runWorktreeIntegration({ ...integrationInput, command: "apply", confirmApply: true, now: () => "2026-07-22T00:00:03.000Z" });
    await git(root, "add", candidatePath);
    await git(root, "commit", "-m", "integrate lifecycle fixture");
    await advanceStoryToDone(root, stateFile, runId);

    const integrationReceiptFile = `.harness/runs/${runId}/worktrees/${taskId}/integration/integration-receipt.json`;
    return {
      root,
      stateFile,
      taskId,
      plan,
      worktreePath,
      candidatePath,
      resultFile,
      executionReceiptFile,
      integrationReceiptFile,
      retirementReceiptFile: `.harness/runs/${runId}/worktrees/${taskId}/retirement-receipt.json`,
      retireLockFile: `.harness/runs/${runId}/worktrees/${taskId}/retire.lock`,
      statusSha256BeforeIntegration,
      statusSha256AfterIntegrationPlan,
    };
  }
  await mkdir(path.join(worktreePath, phaseDirectory), { recursive: true });
  await writeJson(path.join(worktreePath, taskFile), task);
  await writeFile(path.join(worktreePath, candidatePath), candidate, "utf8");
  await writeFile(path.join(worktreePath, phaseOutput), output, "utf8");
  await writeJson(path.join(worktreePath, resultFile), result);
  await writeFile(path.join(root, candidatePath), candidate, "utf8");
  await writeFile(path.join(root, phaseOutput), output, "utf8");
  await writeJson(path.join(root, resultFile), result);

  const manifestFile = `.harness/runs/${runId}/worktrees/${taskId}/input-manifest.json`;
  const workerResultFile = `.harness/runs/${runId}/worktrees/${taskId}/worker-result.json`;
  const executionReceiptFile = `.harness/runs/${runId}/worktrees/${taskId}/execution-receipt.json`;
  const integrationPlanFile = `.harness/runs/${runId}/worktrees/${taskId}/integration/plan.json`;
  const integrationReceiptFile = `.harness/runs/${runId}/worktrees/${taskId}/integration/integration-receipt.json`;
  const taskBytes = await readFile(path.join(root, taskFile));
  const taskHash = sha256(taskBytes);
  const resultBytes = await readFile(path.join(root, resultFile));
  const manifest = {
    schemaVersion: "1.0",
    storyId,
    runId,
    taskId,
    dispatchId: task.dispatchId,
    phase: task.phase,
    baseCommit: plan.baseCommit,
    worktreePath: plan.worktreePath,
    inputs: [{ source: "main-run", sourcePath: taskFile, targetPath: taskFile, sha256: taskHash, bytes: taskBytes.length }],
  };
  await writeJson(path.join(root, manifestFile), manifest);
  await writeJson(path.join(root, workerResultFile), result);
  const executionReceipt = {
    schemaVersion: "1.0",
    storyId,
    runId,
    taskId,
    dispatchId: task.dispatchId,
    phase: task.phase,
    ownerAgent: task.ownerAgent,
    baseCommit: plan.baseCommit,
    headCommit: plan.baseCommit,
    outcome: "ready-for-integration",
    planSha256: await sha256File(path.join(root, planFile)),
    statusSha256: await sha256File(path.join(root, statusFile)),
    inputManifestSha256: await sha256File(path.join(root, manifestFile)),
    resultEvidenceFile: workerResultFile,
    resultSha256: sha256(resultBytes),
    files: [
      { path: candidatePath, sha256: sha256(candidate), bytes: Buffer.byteLength(candidate), kind: "backend" },
      { path: phaseOutput, sha256: sha256(output), bytes: Buffer.byteLength(output), kind: "phase-output" },
    ],
    completedAt: "2026-07-22T00:00:01.000Z",
  };
  await writeJson(path.join(root, executionReceiptFile), executionReceipt);
  if (refreshStatusBeforeCompletion) {
    await runWorktreeCommand({
      root,
      command: "status",
      stateFile,
      taskId,
      now: () => "2026-07-22T00:00:01.500Z",
    });
  }
  const integrationPlan = {
    schemaVersion: "1.0",
    storyId,
    runId,
    taskId,
    dispatchId: task.dispatchId,
    phase: task.phase,
    ownerAgent: task.ownerAgent,
    baseCommit: plan.baseCommit,
    worktreePath: plan.worktreePath,
    executionReceiptFile,
    executionReceiptSha256: await sha256File(path.join(root, executionReceiptFile)),
  };
  await writeJson(path.join(root, integrationPlanFile), integrationPlan);
  const integrationReceipt = {
    schemaVersion: "1.0",
    storyId,
    runId,
    taskId,
    dispatchId: task.dispatchId,
    phase: task.phase,
    ownerAgent: task.ownerAgent,
    baseCommit: plan.baseCommit,
    planSha256: await sha256File(path.join(root, integrationPlanFile)),
    resultFile,
    resultSha256: sha256(resultBytes),
    appliedFiles: executionReceipt.files,
    completedAt: "2026-07-22T00:00:02.000Z",
  };
  await writeJson(path.join(root, integrationReceiptFile), integrationReceipt);
  await git(root, "add", ".harness/runs", candidatePath);
  await git(root, "commit", "-m", "integrated fixture");

  state.phase = "done";
  state.runtime.status = "completed";
  state.runtime.revision = 9;
  state.runtime.updatedAt = "2026-07-22T00:00:03.000Z";
  await writeJson(path.join(root, stateFile), state);
  return {
    root,
    stateFile,
    taskId,
    plan,
    worktreePath,
    candidatePath,
    resultFile,
    executionReceiptFile,
    integrationReceiptFile,
    retirementReceiptFile: `.harness/runs/${runId}/worktrees/${taskId}/retirement-receipt.json`,
    retireLockFile: `.harness/runs/${runId}/worktrees/${taskId}/retire.lock`,
  };
}

function batchWorkerResponse(task, businessFile, content) {
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
      summary: `${task.taskId} completed the batch fixture.`,
      outputs: task.expectedOutputs.map((output) => ({ path: output })),
      records: [],
    },
  };
}

async function createCompletedBatchFixture({ includeCurrentRunContext = false, commitCurrentRunContext = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5c-batch-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5c-batch@example.test");
  await git(root, "config", "user.name", "M5-C Batch Test");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await mkdir(path.join(root, ".harness/workflows"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".harness/workflows/e2e-development.yaml"), path.join(root, ".harness/workflows/e2e-development.yaml"));
  await mkdir(path.join(root, "backend/src/service"), { recursive: true });
  await writeFile(path.join(root, "backend/src/service/SharedService.java"), "class SharedService {}\n", "utf8");
  await git(root, "add", ".gitignore", ".codex/agents", ".harness/workflows", "backend/src/service/SharedService.java");
  await git(root, "commit", "-m", "batch lifecycle fixture base");

  const storyId = "M5-B3-B-RETIRE";
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
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    },
    requirement: { summary: "M5-C batch retirement fixture", openQuestions: [], acceptanceCriteria: [] },
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
  const nodes = [
    {
      taskId: "T1",
      title: "Integrate the first batch candidate",
      type: "backend",
      status: "pending",
      predictedFiles: ["backend/src/service/**"],
      acceptanceCriteria: ["The first candidate is integrated."],
      ownerAgent: "backend-developer",
    },
    {
      taskId: "T2",
      title: "Integrate the second batch candidate",
      type: "backend",
      status: "pending",
      predictedFiles: ["backend/src/service/**"],
      acceptanceCriteria: ["The second candidate is integrated."],
      ownerAgent: "backend-developer",
    },
  ];
  const dag = {
    schemaVersion: "1.0",
    storyId,
    nodes,
    edges: [{ from: "T1", to: "T2", reason: "The second task follows the first integration." }],
    waves: [["T1"], ["T2"]],
    globalChanges: [],
    risks: [],
  };
  await writeJson(path.join(root, stateFile), state);
  await writeJson(path.join(root, taskDagFile), dag);

  const prepared = await runStoryCommand({
    root,
    command: "prepare-batch",
    stateFile,
    taskDagFile,
    now: () => "2026-07-28T00:00:01.000Z",
  });
  const currentRunContextFile = includeCurrentRunContext
    ? `.harness/runs/${runId}/phases/03-implementation/current-run-context.md`
    : null;
  if (currentRunContextFile) {
    await writeFile(path.join(root, currentRunContextFile), "current run context\n", "utf8");
  }
  await runWorktreeCommand({
    root,
    command: "batch-plan",
    stateFile,
    now: () => "2026-07-28T00:00:02.000Z",
  });
  const created = await runWorktreeCommand({
    root,
    command: "batch-create",
    stateFile,
    confirmCreate: true,
    now: () => "2026-07-28T00:00:03.000Z",
  });

  const candidates = [
    ["backend/src/service/FirstBatchService.java", "class FirstBatchService {}\n"],
    ["backend/src/service/SecondBatchService.java", "class SecondBatchService {}\n"],
  ];
  for (const [index, ledgerTask] of prepared.ledger.tasks.entries()) {
    const claimed = await claimBatchTask({
      root,
      stateFile,
      batchFile: prepared.batchFile,
      taskId: ledgerTask.taskId,
      now: () => `2026-07-28T00:00:${String(4 + index * 4).padStart(2, "0")}.000Z`,
    });
    const [businessFile, content] = candidates[index];
    await runWorktreeWorker({
      root,
      stateFile,
      taskId: claimed.task.taskId,
      taskFile: claimed.task.taskFile,
      contextFiles: currentRunContextFile ? [currentRunContextFile] : [],
      provider: ({ task }) => batchWorkerResponse(task, businessFile, content),
      now: () => `2026-07-28T00:00:${String(5 + index * 4).padStart(2, "0")}.000Z`,
    });
    const integrationInput = {
      root,
      stateFile,
      batchFile: prepared.batchFile,
      taskId: claimed.task.taskId,
      now: () => `2026-07-28T00:00:${String(6 + index * 4).padStart(2, "0")}.000Z`,
    };
    await runWorktreeIntegration({ ...integrationInput, command: "plan" });
    await runWorktreeIntegration({ ...integrationInput, command: "apply", confirmApply: true });
    await assert.rejects(
      access(path.join(root, path.posix.dirname(claimed.task.integrationReceiptFile), "apply-marker.json")),
      /ENOENT/,
    );
  }

  const finalized = await runStoryCommand({
    root,
    command: "finalize-batch",
    stateFile,
    batchFile: prepared.batchFile,
    now: () => "2026-07-28T00:00:20.000Z",
  });
  await advanceStoryToDone(root, stateFile, runId);

  await git(root, "add", ".harness/states", ".harness/runs");
  if (currentRunContextFile && !commitCurrentRunContext) {
    await git(root, "reset", "--", currentRunContextFile);
  }
  await git(root, "commit", "-m", "complete batch lifecycle fixture");
  return {
    root,
    runId,
    stateFile,
    batchFile: prepared.batchFile,
    batchId: prepared.ledger.batchId,
    worktreePath: path.join(root, created.plan.worktreePath),
    branch: created.plan.branch,
    baseCommit: created.plan.baseCommit,
    candidatePaths: candidates.map(([relative]) => relative),
    currentRunContextFile,
    phaseTaskFile: finalized.taskFile,
    phaseResultFile: finalized.resultFile,
    phaseNotesFile: finalized.task.expectedOutputs[0],
  };
}

async function readBatchLedger(fixture) {
  return JSON.parse(await readFile(path.join(fixture.root, fixture.batchFile), "utf8"));
}

function batchRetirementReceiptFile(fixture) {
  return `.harness/runs/${fixture.runId}/batches/${fixture.batchId}/worktree-retirement-receipt.json`;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("batch-retire removes a complete serial batch Worktree and preserves its branch", async () => {
  const fixture = await createCompletedBatchFixture();
  const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile));
  const candidatesBefore = await Promise.all(fixture.candidatePaths.map((relative) => readFile(path.join(fixture.root, relative))));

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
  });

  assert.equal(retired.command, "batch-retire");
  assert.equal(retired.reused, false);
  await assert.rejects(readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java")), /ENOENT/);
  assert.equal((await git(fixture.root, "show-ref", "--verify", "--hash", `refs/heads/${fixture.branch}`)).stdout.trim(), fixture.baseCommit);
  assert.deepEqual(await Promise.all(fixture.candidatePaths.map((relative) => readFile(path.join(fixture.root, relative)))), candidatesBefore);
  assert.deepEqual(await readFile(path.join(fixture.root, fixture.stateFile)), stateBefore);
});

test("batch-retire requires confirmation and a completed target Story", async () => {
  const fixture = await createCompletedBatchFixture();
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile }),
    /ConfirmRetire/i,
  );
  await readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, taskId: "T1", confirmRetire: true }),
    /taskId is not accepted/i,
  );

  const state = JSON.parse(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"));
  state.phase = "implementation";
  state.runtime.status = "active";
  await writeJson(path.join(fixture.root, fixture.stateFile), state);
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
    /completed Story/i,
  );
  await readFile(path.join(fixture.worktreePath, "backend/src/service/SecondBatchService.java"), "utf8");
});

test("batch-retire clears its lock when lock initialization fails", async () => {
  const fixture = await createCompletedBatchFixture();
  const lockPath = path.join(
    fixture.root,
    `.harness/runs/${fixture.runId}/batches/${fixture.batchId}/worktree-retire.lock`,
  );

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "batch-retire",
      stateFile: fixture.stateFile,
      confirmRetire: true,
      now: () => { throw new Error("simulated batch retirement lock initialization failure"); },
    }),
    /simulated batch retirement lock initialization failure/,
  );
  await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/);
  await readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
  });
  assert.equal(retired.reused, false);
});

test("batch-retire releases the exact lock it acquired after reloading context", async () => {
  const source = await readFile(path.join(repositoryRoot, ".harness/scripts/lib/worktree-runtime.mjs"), "utf8");
  const start = source.indexOf("async function batchRetire(root, options)");
  const end = source.indexOf("\nasync function retire", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const batchRetireSource = source.slice(start, end);

  assert.match(batchRetireSource, /const retirementLockPath = context\.retirementLockPath;\s+await acquireLock\(retirementLockPath, options\);/);
  assert.match(batchRetireSource, /finally \{\s+await unlink\(retirementLockPath\)/);
});

test("batch-retire rejects missing or tampered batch evidence before removal", async () => {
  const missing = await createCompletedBatchFixture();
  const missingLedger = await readBatchLedger(missing);
  await rm(path.join(missing.root, missingLedger.batchReceiptFile));
  await assert.rejects(
    runWorktreeCommand({ root: missing.root, command: "batch-retire", stateFile: missing.stateFile, confirmRetire: true }),
    /batch receipt.*missing|receipt.*missing|receipt.*not found/i,
  );
  await readFile(path.join(missing.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");

  const tampered = await createCompletedBatchFixture();
  const tamperedLedger = await readBatchLedger(tampered);
  await writeFile(
    path.join(tampered.root, tamperedLedger.tasks[0].integrationReceiptFile),
    '{"tampered":true}\n',
    "utf8",
  );
  await assert.rejects(
    runWorktreeCommand({ root: tampered.root, command: "batch-retire", stateFile: tampered.stateFile, confirmRetire: true }),
    /integration receipt hash drifted|integration receipt/i,
  );
  await readFile(path.join(tampered.worktreePath, "backend/src/service/SecondBatchService.java"), "utf8");
});

test("batch-retire rejects a tampered execution receipt before removal", async () => {
  const fixture = await createCompletedBatchFixture();
  const ledger = await readBatchLedger(fixture);
  await writeFile(
    path.join(fixture.root, ledger.tasks[0].executionReceiptFile),
    '{"tampered":true}\n',
    "utf8",
  );
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
    /execution receipt hash drifted|execution receipt/i,
  );
  await readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
});

test("batch-retire rejects a drifted implementation result or latest applied candidate", async () => {
  const resultDrift = await createCompletedBatchFixture();
  await writeFile(path.join(resultDrift.root, resultDrift.phaseResultFile), '{"drifted":true}\n', "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: resultDrift.root, command: "batch-retire", stateFile: resultDrift.stateFile, confirmRetire: true }),
    /result.*hash|implementation.*result|result.*evidence/i,
  );
  await readFile(path.join(resultDrift.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");

  const candidateDrift = await createCompletedBatchFixture();
  await writeFile(path.join(candidateDrift.root, candidateDrift.candidatePaths[0]), "class DriftedService {}\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: candidateDrift.root, command: "batch-retire", stateFile: candidateDrift.stateFile, confirmRetire: true }),
    /latest.*target|applied.*hash|candidate/i,
  );
  await readFile(path.join(candidateDrift.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
});

test("batch-retire rejects content-tampered formal implementation artifacts before removal", async () => {
  const fixture = await createCompletedBatchFixture();
  const taskPath = path.join(fixture.root, fixture.phaseTaskFile);
  const resultPath = path.join(fixture.root, fixture.phaseResultFile);
  const notesPath = path.join(fixture.root, fixture.phaseNotesFile);
  const taskOriginal = await readFile(taskPath, "utf8");
  const resultOriginal = await readFile(resultPath, "utf8");
  const task = JSON.parse(taskOriginal);
  const result = JSON.parse(resultOriginal);
  const notes = await readFile(notesPath, "utf8");
  const cases = [
    {
      name: "task",
      change: async () => {
        task.ownerAgent = "code-fixer";
        await writeJson(taskPath, task);
      },
      restore: async () => { await writeFile(taskPath, taskOriginal, "utf8"); },
    },
    {
      name: "result",
      change: async () => {
        result.summary = "tampered but still schema-valid";
        await writeJson(resultPath, result);
      },
      restore: async () => { await writeFile(resultPath, resultOriginal, "utf8"); },
    },
    {
      name: "notes",
      change: async () => { await writeFile(notesPath, `${notes}tampered\n`, "utf8"); },
      restore: async () => { await writeFile(notesPath, notes, "utf8"); },
    },
  ];

  for (const artifact of cases) {
    await artifact.change();
    await assert.rejects(
      runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
      /finalization.*artifact|implementation.*artifact|result.*binding/i,
      artifact.name,
    );
    await readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
    await artifact.restore();
  }
});

test("batch-retire rejects coordinated result and checkpoint hash drift before removal", async () => {
  const fixture = await createCompletedBatchFixture();
  const resultPath = path.join(fixture.root, fixture.phaseResultFile);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  result.summary = "tampered but still schema-valid";
  await writeJson(resultPath, result);
  const checkpointPath = path.join(fixture.root, path.posix.dirname(fixture.phaseTaskFile), "checkpoint.json");
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  checkpoint.batchFinalization.resultSha256 = await sha256File(resultPath);
  await writeJson(checkpointPath, checkpoint);
  const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const ledgerBefore = await readFile(path.join(fixture.root, fixture.batchFile), "utf8");
  const checkpointBefore = await readFile(checkpointPath, "utf8");
  const retirementReceiptFile = batchRetirementReceiptFile(fixture);
  await assert.rejects(access(path.join(fixture.root, retirementReceiptFile)), (error) => error?.code === "ENOENT");

  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
    /finalization.*artifact|implementation.*artifact|result.*binding/i,
  );
  await readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  assert.equal(await readFile(path.join(fixture.root, fixture.batchFile), "utf8"), ledgerBefore);
  assert.equal(await readFile(checkpointPath, "utf8"), checkpointBefore);
  await assert.rejects(access(path.join(fixture.root, retirementReceiptFile)), (error) => error?.code === "ENOENT");
});

test("batch-retire accepts an explicit current-run context copied into the Worktree", async () => {
  const fixture = await createCompletedBatchFixture({ includeCurrentRunContext: true });
  assert.ok(fixture.currentRunContextFile);
  const ledger = await readBatchLedger(fixture);
  const firstTask = ledger.tasks[0];
  const manifestFile = path.join(fixture.root, path.dirname(firstTask.executionReceiptFile), "task-start-manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const input = manifest.inputs.find((candidate) => candidate.sourcePath === fixture.currentRunContextFile);
  assert.deepEqual(input && {
    source: input.source,
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
  }, {
    source: "main-run",
    sourcePath: fixture.currentRunContextFile,
    targetPath: fixture.currentRunContextFile,
  });
  const mainRunContent = await readFile(path.join(fixture.root, fixture.currentRunContextFile));
  const worktreeContent = await readFile(path.join(fixture.worktreePath, fixture.currentRunContextFile));
  assert.equal(input.sha256, sha256(mainRunContent));
  assert.equal(input.bytes, mainRunContent.length);
  assert.equal(sha256(worktreeContent), input.sha256);
  assert.equal(worktreeContent.length, input.bytes);

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
  });

  assert.equal(retired.reused, false);
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.currentRunContextFile)), /ENOENT/);
});

test("batch-retire accepts a hash-bound uncommitted current-run context", async () => {
  const fixture = await createCompletedBatchFixture({
    includeCurrentRunContext: true,
    commitCurrentRunContext: false,
  });

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
  });

  assert.equal(retired.reused, false);
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.currentRunContextFile)), /ENOENT/);
});

test("batch-retire rejects a drifted current-run context from the task manifest", async () => {
  const fixture = await createCompletedBatchFixture({ includeCurrentRunContext: true });
  await writeFile(path.join(fixture.root, fixture.currentRunContextFile), "drifted current run context\n", "utf8");

  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
    /main-run input hash drifted/i,
  );
  await readFile(path.join(fixture.worktreePath, fixture.currentRunContextFile), "utf8");
});

test("batch-retire rejects a deleted hash-bound current-run context in the Worktree", async () => {
  const fixture = await createCompletedBatchFixture({ includeCurrentRunContext: true });
  await rm(path.join(fixture.worktreePath, fixture.currentRunContextFile));
  const gitCalls = [];
  const executeGit = async (args) => {
    gitCalls.push(args);
    return git(fixture.root, ...args);
  };

  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true, executeGit }),
    /Worktree.*input|Worktree.*candidate|main-run input/i,
  );
  await readFile(path.join(fixture.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
  assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "remove"), false);
});

test("batch-retire rejects unexplained main repository and Worktree changes", async () => {
  const mainChange = await createCompletedBatchFixture();
  await writeFile(path.join(mainChange.root, "backend/src/service/UnknownBatchService.java"), "class UnknownBatchService {}\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: mainChange.root, command: "batch-retire", stateFile: mainChange.stateFile, confirmRetire: true }),
    /unexplained.*change/i,
  );
  await readFile(path.join(mainChange.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");

  const worktreeChange = await createCompletedBatchFixture();
  await writeFile(path.join(worktreeChange.worktreePath, "unknown-batch-worktree.txt"), "unexplained\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: worktreeChange.root, command: "batch-retire", stateFile: worktreeChange.stateFile, confirmRetire: true }),
    /unexplained.*change|Worktree.*change/i,
  );
  await readFile(path.join(worktreeChange.worktreePath, "unknown-batch-worktree.txt"), "utf8");
});

test("batch-retire rejects an ignored main repository change", async () => {
  const fixture = await createCompletedBatchFixture();
  const ignoredPath = "backend/src/service/IgnoredBatchService.java";
  await writeFile(path.join(fixture.root, ".git/info/exclude"), `${ignoredPath}\n`, "utf8");
  await writeFile(path.join(fixture.root, ignoredPath), "class IgnoredBatchService {}\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
    /unexplained.*change/i,
  );
  await readFile(path.join(fixture.worktreePath, "backend/src/service/SecondBatchService.java"), "utf8");
});

test("batch-retire rejects lifecycle locks and a retained branch drift", async () => {
  const locked = await createCompletedBatchFixture();
  const lockedLedger = await readBatchLedger(locked);
  const lockFiles = [
    lockedLedger.lockFile,
    `.harness/runs/${locked.runId}/phases/03-implementation/batch-finalization.lock`,
    `${path.posix.dirname(lockedLedger.batchPlanFile)}/worktree-create.lock`,
    lockedLedger.tasks[0].executionReceiptFile.replace(/execution-receipt\.json$/, "execute.lock"),
    lockedLedger.tasks[1].integrationReceiptFile.replace(/integration-receipt\.json$/, "integrate.lock"),
    `${path.posix.dirname(lockedLedger.batchPlanFile)}/worktree-retire.lock`,
  ];
  for (const lockFile of lockFiles) {
    await writeFile(path.join(locked.root, lockFile), "active lifecycle operation\n", "utf8");
    await assert.rejects(
      runWorktreeCommand({ root: locked.root, command: "batch-retire", stateFile: locked.stateFile, confirmRetire: true }),
      /lock.*exists|lifecycle lock/i,
    );
    await rm(path.join(locked.root, lockFile));
  }
  await readFile(path.join(locked.worktreePath, "backend/src/service/SecondBatchService.java"), "utf8");

  const branchDrift = await createCompletedBatchFixture();
  const rootHead = (await git(branchDrift.root, "rev-parse", "HEAD")).stdout.trim();
  await git(branchDrift.root, "update-ref", `refs/heads/${branchDrift.branch}`, rootHead);
  await assert.rejects(
    runWorktreeCommand({ root: branchDrift.root, command: "batch-retire", stateFile: branchDrift.stateFile, confirmRetire: true }),
    /branch.*base commit|branch.*drifted/i,
  );
  await readFile(path.join(branchDrift.worktreePath, "backend/src/service/FirstBatchService.java"), "utf8");
});

test("batch-retire reuses a valid retirement receipt", async () => {
  const reusedFixture = await createCompletedBatchFixture();
  const first = await runWorktreeCommand({ root: reusedFixture.root, command: "batch-retire", stateFile: reusedFixture.stateFile, confirmRetire: true });
  const repeated = await runWorktreeCommand({ root: reusedFixture.root, command: "batch-retire", stateFile: reusedFixture.stateFile, confirmRetire: true });
  assert.equal(first.reused, false);
  assert.equal(repeated.reused, true);
  await readFile(path.join(reusedFixture.root, batchRetirementReceiptFile(reusedFixture)), "utf8");
});

test("batch-retire recovers after removal before receipt writing", async () => {
  const recoveredFixture = await createCompletedBatchFixture();
  await assert.rejects(
    runWorktreeCommand({
      root: recoveredFixture.root,
      command: "batch-retire",
      stateFile: recoveredFixture.stateFile,
      confirmRetire: true,
      afterBatchRetireRemove: () => { throw new Error("simulated batch receipt interruption"); },
    }),
    /simulated batch receipt interruption/i,
  );
  await assert.rejects(readFile(path.join(recoveredFixture.worktreePath, "backend/src/service/FirstBatchService.java")), /ENOENT/);
  const recovered = await runWorktreeCommand({ root: recoveredFixture.root, command: "batch-retire", stateFile: recoveredFixture.stateFile, confirmRetire: true });
  assert.equal(recovered.receipt.recovered, true);
  await readFile(path.join(recoveredFixture.root, batchRetirementReceiptFile(recoveredFixture)), "utf8");
});

test("batch-retire clears a failed retirement receipt temporary file before retrying", async () => {
  const fixture = await createCompletedBatchFixture();
  const receiptPath = path.join(fixture.root, batchRetirementReceiptFile(fixture));
  const receiptDirectory = path.dirname(receiptPath);
  const temporaryPrefix = `${path.basename(receiptPath)}.tmp-`;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "batch-retire",
      stateFile: fixture.stateFile,
      confirmRetire: true,
      afterBatchRetireRemove: async () => {
        await mkdir(receiptPath);
      },
    }),
    /EEXIST|EPERM|EISDIR|rename/i,
  );
  await rm(receiptPath, { recursive: true, force: true });
  const recovered = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-retire",
    stateFile: fixture.stateFile,
    confirmRetire: true,
  });
  assert.equal(recovered.receipt.recovered, true);
  assert.equal((await readdir(receiptDirectory)).some((file) => file.startsWith(temporaryPrefix)), false);
});

test("batch-retire rejects a tampered existing retirement receipt", async () => {
  const fixture = await createCompletedBatchFixture();
  await runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true });
  const receiptPath = path.join(fixture.root, batchRetirementReceiptFile(fixture));
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.ledgerSha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  await writeJson(receiptPath, receipt);
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-retire", stateFile: fixture.stateFile, confirmRetire: true }),
    /retirement receipt.*hash|retirement receipt/i,
  );
});

test("batch retirement schema and PowerShell entry preserve the derived batch scope", async () => {
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas/worktree-batch-retirement-receipt.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert.equal(schema.additionalProperties, false);
  for (const field of ["storyId", "runId", "batchId", "branch", "worktreePath", "baseCommit", "stateEventsSha256", "stateBackupSha256", "ledgerSha256", "batchReceiptSha256", "implementationResultSha256", "tasks", "appliedFiles", "retiredAt", "recovered"]) {
    assert.ok(schema.required.includes(field), `schema must require ${field}`);
  }

  const fixture = await createCompletedBatchFixture();
  const script = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const first = await execFileAsync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Command", "BatchRetire", "-StateFile", fixture.stateFile, "-Root", fixture.root, "-ConfirmRetire", "-Json",
  ], { windowsHide: true });
  const repeated = await execFileAsync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Command", "BatchRetire", "-StateFile", fixture.stateFile, "-Root", fixture.root, "-ConfirmRetire", "-Json",
  ], { windowsHide: true });
  assert.equal(JSON.parse(first.stdout).reused, false);
  assert.equal(JSON.parse(repeated.stdout).reused, true);
});

test("retire removes a verified completed M5-B2 Worktree and keeps its branch", async () => {
  const fixture = await createCompletedIntegrationFixture();

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "retire",
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    confirmRetire: true,
  });

  assert.equal(retired.command, "retire");
  assert.equal(retired.reused, false);
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.candidatePath)), /ENOENT/);
  assert.equal((await git(fixture.root, "show-ref", "--verify", "--hash", `refs/heads/${fixture.plan.branch}`)).stdout.trim(), fixture.plan.baseCommit);
  assert.equal(await readFile(path.join(fixture.root, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire rejects a registered Worktree whose parent becomes a junction before removal", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const parentPath = path.dirname(fixture.worktreePath);
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5c-linked-parent-"));
  temporaryRoots.push(external);
  const externalWorktreePath = path.join(external, path.basename(fixture.worktreePath));
  await cp(fixture.worktreePath, externalWorktreePath, { recursive: true });
  await rm(parentPath, { recursive: true, force: true });
  await symlink(external, parentPath, "junction");

  const gitCalls = [];
  const executeGit = async (args) => {
    gitCalls.push(args);
    if (args[0] === "worktree" && args[1] === "remove") throw new Error("Worktree remove must not run.");
    return git(fixture.root, ...args);
  };

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "retire",
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      confirmRetire: true,
      executeGit,
    }),
    /real directory inside the repository/i,
  );
  assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "remove"), false);
});

test("retire accepts the M5-A status refresh performed during M5-B2 planning", async () => {
  const fixture = await createCompletedIntegrationFixture({ refreshStatusBeforeCompletion: true });

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "retire",
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    confirmRetire: true,
  });

  assert.equal(retired.command, "retire");
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.candidatePath)), /ENOENT/);
});

test("real M5-A through M5-C flow retires without changing integrated evidence or completed state", async () => {
  const fixture = await createCompletedIntegrationFixture({ realFlow: true });
  assert.notEqual(fixture.statusSha256AfterIntegrationPlan, fixture.statusSha256BeforeIntegration);
  const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile));
  const candidateBefore = await readFile(path.join(fixture.root, fixture.candidatePath));
  const resultBefore = await readFile(path.join(fixture.root, fixture.resultFile));

  const retired = await runWorktreeCommand({
    root: fixture.root,
    command: "retire",
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    confirmRetire: true,
  });

  assert.equal(retired.command, "retire");
  assert.equal(retired.reused, false);
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.candidatePath)), /ENOENT/);
  assert.doesNotMatch((await git(fixture.root, "worktree", "list", "--porcelain")).stdout, new RegExp(fixture.plan.worktreePath.replaceAll("/", "[\\\\/]"), "i"));
  assert.equal((await git(fixture.root, "show-ref", "--verify", "--hash", `refs/heads/${fixture.plan.branch}`)).stdout.trim(), fixture.plan.baseCommit);
  assert.deepEqual(await readFile(path.join(fixture.root, fixture.candidatePath)), candidateBefore);
  assert.deepEqual(await readFile(path.join(fixture.root, fixture.resultFile)), resultBefore);
  assert.deepEqual(await readFile(path.join(fixture.root, fixture.stateFile)), stateBefore);
});

test("retire rejects missing confirmation, non-terminal state, root drift, unknown changes and locks before removal", async () => {
  const fixture = await createCompletedIntegrationFixture();
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId }),
    /ConfirmRetire/i,
  );
  assert.equal(await readFile(path.join(fixture.worktreePath, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");

  const state = JSON.parse(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"));
  state.phase = "implementation";
  state.runtime.status = "active";
  await writeJson(path.join(fixture.root, fixture.stateFile), state);
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /completed Story/i,
  );

  state.phase = "done";
  state.runtime.status = "completed";
  await writeJson(path.join(fixture.root, fixture.stateFile), state);
  await writeFile(path.join(fixture.root, fixture.candidatePath), "unexpected root drift\n", "utf8");
  await git(fixture.root, "add", fixture.candidatePath);
  await git(fixture.root, "commit", "-m", "drift fixture");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /hash drifted/i,
  );
  await writeFile(path.join(fixture.root, fixture.candidatePath), "class ExistingService { void integrated() {} }\n", "utf8");
  await git(fixture.root, "add", fixture.candidatePath);
  await git(fixture.root, "commit", "-m", "restore fixture");

  await writeFile(path.join(fixture.worktreePath, "unknown.txt"), "unexplained\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /unexplained change/i,
  );
  await rm(path.join(fixture.worktreePath, "unknown.txt"));

  await writeFile(path.join(fixture.root, fixture.retireLockFile), "stale\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /lifecycle lock/i,
  );
  await rm(path.join(fixture.root, fixture.retireLockFile));
  assert.equal(await readFile(path.join(fixture.worktreePath, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire rejects the real M5-B2 integration lock before removing the Worktree", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const integrationLock = fixture.integrationReceiptFile.replace(/integration-receipt\.json$/, "integrate.lock");
  await writeFile(path.join(fixture.root, integrationLock), "active integration\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /lifecycle lock/i,
  );
  assert.equal(await readFile(path.join(fixture.worktreePath, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire rechecks lifecycle locks after taking the retirement lock", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const integrationLock = fixture.integrationReceiptFile.replace(/integration-receipt\.json$/, "integrate.lock");

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "retire",
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      confirmRetire: true,
      afterRetireLock: () => writeFile(path.join(fixture.root, integrationLock), "active integration\n", "utf8"),
    }),
    /lifecycle lock/i,
  );
  assert.equal(await readFile(path.join(fixture.worktreePath, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire recovers after Git removal succeeds before the receipt is written", async () => {
  const fixture = await createCompletedIntegrationFixture();
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "retire",
      stateFile: fixture.stateFile,
      taskId: fixture.taskId,
      confirmRetire: true,
      afterRetireRemove: () => { throw new Error("simulated receipt interruption"); },
    }),
    /simulated receipt interruption/,
  );
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.candidatePath)), /ENOENT/);

  const recovered = await runWorktreeCommand({
    root: fixture.root,
    command: "retire",
    stateFile: fixture.stateFile,
    taskId: fixture.taskId,
    confirmRetire: true,
  });
  assert.equal(recovered.receipt.recovered, true);
  assert.equal(await readFile(path.join(fixture.root, fixture.retirementReceiptFile), "utf8") !== "", true);
});

test("retire schema fixes receipt identity and recovery fields", async () => {
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas/worktree-retirement-receipt.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert.equal(schema.properties.recovered.type, "boolean");
  assert.equal(schema.additionalProperties, false);
  for (const field of ["storyId", "runId", "taskId", "branch", "worktreePath", "baseCommit", "planSha256", "statusSha256", "executionReceiptSha256", "integrationPlanSha256", "integrationReceiptSha256", "resultFile", "resultSha256", "retiredAt", "recovered"]) {
    assert.ok(schema.required.includes(field), `schema must require ${field}`);
  }
});

test("PowerShell Retire forwards ConfirmRetire and reuses the retirement receipt", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const script = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const first = await execFileAsync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Command", "Retire", "-StateFile", fixture.stateFile,
    "-TaskId", fixture.taskId, "-Root", fixture.root, "-ConfirmRetire", "-Json",
  ], { windowsHide: true });
  const repeated = await execFileAsync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Command", "Retire", "-StateFile", fixture.stateFile,
    "-TaskId", fixture.taskId, "-Root", fixture.root, "-ConfirmRetire", "-Json",
  ], { windowsHide: true });
  assert.equal(JSON.parse(first.stdout).reused, false);
  assert.equal(JSON.parse(repeated.stdout).reused, true);
});

test("PowerShell Retire reports success without requiring Json output", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const script = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const completed = await execFileAsync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Command", "Retire", "-StateFile", fixture.stateFile,
    "-TaskId", fixture.taskId, "-Root", fixture.root, "-ConfirmRetire",
  ], { windowsHide: true });

  assert.match(completed.stdout, /Worktree command 'retire' completed/i);
  await assert.rejects(readFile(path.join(fixture.worktreePath, fixture.candidatePath)), /ENOENT/);
});

test("retire rejects missing execution evidence and a drifted retained branch", async () => {
  const missingEvidence = await createCompletedIntegrationFixture();
  await rm(path.join(missingEvidence.root, missingEvidence.executionReceiptFile));
  await assert.rejects(
    runWorktreeCommand({ root: missingEvidence.root, command: "retire", stateFile: missingEvidence.stateFile, taskId: missingEvidence.taskId, confirmRetire: true }),
    /execution receipt not found/i,
  );
  assert.equal(await readFile(path.join(missingEvidence.worktreePath, missingEvidence.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");

  const branchDrift = await createCompletedIntegrationFixture();
  const rootHead = (await git(branchDrift.root, "rev-parse", "HEAD")).stdout.trim();
  await git(branchDrift.root, "update-ref", `refs/heads/${branchDrift.plan.branch}`, rootHead);
  await assert.rejects(
    runWorktreeCommand({ root: branchDrift.root, command: "retire", stateFile: branchDrift.stateFile, taskId: branchDrift.taskId, confirmRetire: true }),
    /branch.*base commit/i,
  );
  assert.equal(await readFile(path.join(branchDrift.worktreePath, branchDrift.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire rejects a tampered receipt instead of accepting an absent Worktree", async () => {
  const fixture = await createCompletedIntegrationFixture();
  await runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true });
  const receipt = JSON.parse(await readFile(path.join(fixture.root, fixture.retirementReceiptFile), "utf8"));
  receipt.resultSha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  await writeJson(path.join(fixture.root, fixture.retirementReceiptFile), receipt);
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /retirement receipt/i,
  );
});

test("retire rejects a worker result whose persisted evidence no longer matches its receipt", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const workerResultFile = fixture.executionReceiptFile.replace(/execution-receipt\.json$/, "worker-result.json");
  await writeFile(path.join(fixture.root, workerResultFile), "tampered worker result\n", "utf8");
  await git(fixture.root, "add", workerResultFile);
  await git(fixture.root, "commit", "-m", "tamper worker result fixture");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /Worker result evidence hash drifted/i,
  );
  assert.equal(await readFile(path.join(fixture.worktreePath, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire rejects an integration receipt that omits a Worker candidate", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const receiptPath = path.join(fixture.root, fixture.integrationReceiptFile);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.appliedFiles = receipt.appliedFiles.filter((file) => file.path !== fixture.candidatePath);
  await writeJson(receiptPath, receipt);
  await rm(path.join(fixture.root, fixture.candidatePath));
  await git(fixture.root, "add", fixture.candidatePath);
  await git(fixture.root, "commit", "-m", "remove omitted integration target");

  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /artifact|candidate|receipt/i,
  );
  assert.equal(await readFile(path.join(fixture.worktreePath, fixture.candidatePath), "utf8"), "class ExistingService { void integrated() {} }\n");
});

test("retire rejects ignored Worktree files before forced removal", async () => {
  const fixture = await createCompletedIntegrationFixture();
  const ignoredFile = path.join(fixture.worktreePath, ".env");
  await writeFile(ignoredFile, "LOCAL_ONLY=value\n", "utf8");

  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "retire", stateFile: fixture.stateFile, taskId: fixture.taskId, confirmRetire: true }),
    /ignored|unexplained change/i,
  );
  assert.equal(await readFile(ignoredFile, "utf8"), "LOCAL_ONLY=value\n");
});

test("wave-retire requires approval and complete derived wave inputs before loading evidence", async () => {
  const hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  const base = {
    root: repositoryRoot,
    command: "wave-retire",
    stateFile: ".harness/states/missing-wave-retire-state.json",
    waveIndex: 1,
  };

  await assert.rejects(runWorktreeCommand(base), /ConfirmRetire/i);
  await assert.rejects(
    runWorktreeCommand({ ...base, confirmRetire: true }),
    /TaskDagFile/i,
  );
  await assert.rejects(
    runWorktreeCommand({ ...base, confirmRetire: true, taskDagFile: "missing-task-dag.json" }),
    /ExpectedWaveLedgerSha256/i,
  );
  await assert.rejects(
    runWorktreeCommand({
      ...base,
      confirmRetire: true,
      taskDagFile: "missing-task-dag.json",
      expectedWaveLedgerSha256: hash,
    }),
    /ExpectedWaveReceiptSha256/i,
  );
});

test("wave retirement schemas define strict lock and receipt evidence contracts", async () => {
  const schemas = new Map();
  for (const name of [
    "worktree-wave-retirement-lock.schema.json",
    "worktree-wave-retirement-recovery-lock.schema.json",
    "worktree-wave-task-retirement-receipt.schema.json",
    "worktree-wave-retirement-receipt.schema.json",
  ]) {
    schemas.set(name, JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas", name), "utf8")));
  }

  const lockFields = [
    "schemaVersion", "lockId", "retirementId", "mode", "storyId", "runId", "waveId", "waveIndex",
    "wavePlanSha256", "creationReceiptSha256", "waveLedgerSha256", "waveReceiptSha256", "pid", "createdAt",
  ];
  const lock = schemas.get("worktree-wave-retirement-lock.schema.json");
  assert.equal(lock.additionalProperties, false);
  assert.deepEqual(lock.required, lockFields);
  assert.deepEqual(lock.properties.mode.enum, ["retire"]);

  const recovery = schemas.get("worktree-wave-retirement-recovery-lock.schema.json");
  assert.equal(recovery.additionalProperties, false);
  assert.deepEqual(
    recovery.required,
    [...lockFields, "retirementLockFile", "retirementLockSha256"],
  );
  assert.deepEqual(recovery.properties.mode.enum, ["recovery"]);

  const taskReceipt = schemas.get("worktree-wave-task-retirement-receipt.schema.json");
  assert.equal(taskReceipt.additionalProperties, false);
  assert.ok(taskReceipt.properties.appliedFiles.items.required.includes("taskId"));
  for (const field of [
    "storyId", "runId", "waveId", "waveIndex", "retirementId", "taskId", "branch", "worktreePath",
    "baseCommit", "executionReceiptFile", "executionReceiptSha256", "integrationReceiptFile",
    "integrationReceiptSha256", "appliedFiles", "retiredAt", "recovered",
  ]) {
    assert.ok(taskReceipt.required.includes(field), `task retirement schema must require ${field}`);
  }

  const waveReceipt = schemas.get("worktree-wave-retirement-receipt.schema.json");
  assert.equal(waveReceipt.additionalProperties, false);
  assert.ok(waveReceipt.properties.appliedFiles.items.required.includes("taskId"));
  for (const field of [
    "storyId", "runId", "waveId", "waveIndex", "retirementId", "stateFile", "stateSha256",
    "stateEventsFile", "stateEventsSha256", "stateBackupFile", "stateBackupSha256", "taskDagFile",
    "taskDagSha256", "wavePlanFile", "wavePlanSha256", "creationReceiptFile", "creationReceiptSha256",
    "integrationManifestFile", "integrationManifestSha256", "waveLedgerFile", "waveLedgerSha256",
    "waveReceiptFile", "waveReceiptSha256", "implementationTaskFile", "implementationTaskSha256",
    "implementationResultFile", "implementationResultSha256", "implementationCheckpointFile",
    "implementationCheckpointSha256", "implementationNotesFile", "implementationNotesSha256",
    "tasks", "appliedFiles", "retiredAt", "recovered",
  ]) {
    assert.ok(waveReceipt.required.includes(field), `wave retirement schema must require ${field}`);
  }
});
