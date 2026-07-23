import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
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
  const phases = [
    {
      output: `.harness/runs/${runId}/phases/04-unit-test/test-report.md`,
      record: { recordType: "test", status: "passed", message: "Lifecycle fixture tests passed." },
    },
    {
      output: `.harness/runs/${runId}/phases/05-code-review/code-review-report.md`,
      record: { recordType: "review", status: "passed", message: "Lifecycle fixture review passed." },
    },
    { output: `.harness/runs/${runId}/phases/06-build-publish/build-report.md` },
    { output: `.harness/runs/${runId}/phases/07-interface-verification/interface-verification-report.md` },
    {
      output: `.harness/runs/${runId}/phases/08-git-delivery/delivery-report.md`,
      record: {
        recordType: "approval",
        status: "approved",
        actor: "user",
        message: "Approve the temporary fixture delivery.",
      },
      complete: true,
    },
  ];
  for (const [index, phase] of phases.entries()) {
    await mkdir(path.dirname(path.join(root, phase.output)), { recursive: true });
    await writeFile(path.join(root, phase.output), `fixture phase ${index + 4}\n`, "utf8");
    if (phase.record) {
      await runStateCommand({
        root,
        command: "record",
        stateFile,
        path: phase.output,
        ...phase.record,
        now: () => `2026-07-22T00:00:${String(10 + index * 2).padStart(2, "0")}.000Z`,
      });
    }
    await runStateCommand({
      root,
      command: phase.complete ? "complete" : "next",
      stateFile,
      now: () => `2026-07-22T00:00:${String(11 + index * 2).padStart(2, "0")}.000Z`,
    });
  }
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
    await runStoryCommand({
      root,
      command: "apply",
      stateFile,
      now: () => "2026-07-22T00:00:04.000Z",
    });
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
