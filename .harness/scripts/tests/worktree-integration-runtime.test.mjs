import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { runWorktreeIntegration } from "../lib/worktree-integration-runtime.mjs";
import { runWorktreeWorker } from "../lib/worktree-worker-runtime.mjs";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryRoots = [];

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(root, relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function updateWorkerResult(fixture, mutate) {
  const receipt = await readJson(fixture.root, fixture.executionReceiptFile);
  const resultPath = path.join(fixture.root, receipt.resultEvidenceFile);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  mutate(result);
  const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(resultPath, bytes);
  receipt.resultSha256 = sha256(bytes);
  await writeJson(path.join(fixture.root, fixture.executionReceiptFile), receipt);
}

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b2-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5b2@example.test");
  await git(root, "config", "user.name", "M5-B2 Test");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, ".codex/agents"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), path.join(root, ".codex/agents/agents.yaml"));
  await copyFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), path.join(root, ".codex/agents/worker-policies.json"));
  await mkdir(path.join(root, ".harness/workflows"), { recursive: true });
  await copyFile(path.join(repositoryRoot, ".harness/workflows/e2e-development.yaml"), path.join(root, ".harness/workflows/e2e-development.yaml"));
  await mkdir(path.join(root, "backend/src/main"), { recursive: true });
  await writeFile(path.join(root, "backend/src/main/ExistingService.java"), "class ExistingService {}\n", "utf8");
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");
  await git(root, "add", ".gitignore", ".codex/agents", ".harness/workflows", "backend/src/main/ExistingService.java", "seed.txt");
  await git(root, "commit", "-m", "fixture");
  if (options.checkoutConvertedBase) {
    await git(root, "config", "core.autocrlf", "true");
    await rm(path.join(root, "backend/src/main/ExistingService.java"));
    await git(root, "checkout", "--", "backend/src/main/ExistingService.java");
    assert.equal((await git(root, "status", "--porcelain=v1", "--", "backend/src/main/ExistingService.java")).stdout, "");
  }

  const storyId = "M5-B2-FIXTURE";
  const runId = storyId;
  const taskId = "T1";
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = `.harness/runs/${runId}/phases/02-task-dag/task-dag.json`;
  const taskFile = `.harness/runs/${runId}/phases/03-implementation/task.json`;
  const checkpointFile = taskFile.replace(/task\.json$/, "checkpoint.json");
  const phaseOutput = `.harness/runs/${runId}/phases/03-implementation/implementation-notes.md`;
  const officialResultFile = taskFile.replace(/task\.json$/, "result.json");
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
      updatedAt: "2026-07-21T00:00:00.000Z",
    },
    requirement: { summary: "M5-B2 fixture", openQuestions: [], acceptanceCriteria: [] },
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
    nodes: [{
      taskId,
      title: "Integrate one Worker result",
      type: "integration",
      status: "pending",
      predictedFiles: ["backend/src/main/**"],
      acceptanceCriteria: ["The candidate is integrated safely."],
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
    preparedAt: "2026-07-21T00:00:00.000Z",
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

  await runWorktreeCommand({ root, command: "plan", stateFile, taskDagFile, taskId, now: () => "2026-07-21T00:00:01.000Z" });
  await runWorktreeCommand({ root, command: "create", stateFile, taskId, confirmCreate: true, now: () => "2026-07-21T00:00:02.000Z" });
  const existingFile = "backend/src/main/ExistingService.java";
  const newFile = "backend/src/generated/NewService.java";
  const collected = await runWorktreeWorker({
    root,
    stateFile,
    taskId,
    taskFile,
    contextFiles: [existingFile],
    now: () => "2026-07-21T00:00:03.000Z",
    provider: async ({ task: workerTask }) => ({
      files: options.phaseOnly ? [
        { path: phaseOutput, content: "implementation notes\n", capability: "phase-output" },
      ] : [
        { path: phaseOutput, content: "implementation notes\n", capability: "phase-output" },
        { path: existingFile, content: "class ExistingService { void updated() {} }\n", capability: "backend-write" },
        { path: newFile, content: "class NewService {}\n", capability: "backend-write" },
      ],
      result: {
        schemaVersion: "1.0",
        dispatchId: workerTask.dispatchId,
        storyId: workerTask.storyId,
        phase: workerTask.phase,
        status: "completed",
        summary: "Worker completed the integration fixture.",
        outputs: workerTask.expectedOutputs.map((output) => ({ path: output })),
        records: [],
      },
    }),
  });
  const executionReceiptFile = collected.receiptFile;
  const integrationDirectory = `.harness/runs/${runId}/worktrees/${taskId}/integration`;
  return {
    root,
    storyId,
    runId,
    taskId,
    stateFile,
    taskDagFile,
    taskFile,
    checkpointFile,
    phaseOutput,
    officialResultFile,
    existingFile,
    newFile,
    collected,
    executionReceiptFile,
    integrationPlanFile: `${integrationDirectory}/plan.json`,
    integrationStatusFile: `${integrationDirectory}/status.json`,
    integrationReceiptFile: `${integrationDirectory}/integration-receipt.json`,
    integrationLockFile: `${integrationDirectory}/integrate.lock`,
    integrationDirectory,
    input: {
      root,
      command: "plan",
      stateFile,
      taskId,
      taskFile,
      now: () => "2026-07-21T00:00:04.000Z",
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("exports the M5-B2 integration entry", () => {
  assert.equal(typeof runWorktreeIntegration, "function");
});

test("rejects a task identifier containing path syntax before reading integration evidence", async () => {
  const fixture = await createFixture();
  await assert.rejects(
    runWorktreeIntegration({ ...fixture.input, taskId: "../T1" }),
    /taskId.*identifier/i,
  );
  await assert.rejects(access(path.join(fixture.root, fixture.integrationPlanFile)), /ENOENT/);
});

test("plan rejects non-integration Worker outcomes before writing a bundle", async () => {
  const fixture = await createFixture({ phaseOnly: true });
  await assert.rejects(runWorktreeIntegration(fixture.input), /ready-for-integration/i);
  await assert.rejects(access(path.join(fixture.root, fixture.integrationPlanFile)), /ENOENT/);
});

test("plan rejects non-completed and identity-drifted Worker results", async () => {
  const failed = await createFixture();
  await updateWorkerResult(failed, (result) => { result.status = "failed"; });
  await assert.rejects(runWorktreeIntegration(failed.input), /completed/i);

  const drifted = await createFixture();
  await updateWorkerResult(drifted, (result) => { result.storyId = "OTHER-STORY"; });
  await assert.rejects(runWorktreeIntegration(drifted.input), /identity/i);
});

test("plan rejects candidate hash drift and an existing formal result", async () => {
  const drifted = await createFixture();
  const worktreeRoot = path.join(drifted.root, `.harness/worktrees/${drifted.storyId}/${drifted.taskId}`);
  await writeFile(path.join(worktreeRoot, drifted.newFile), "changed after receipt\n", "utf8");
  await assert.rejects(runWorktreeIntegration(drifted.input), /hash/i);

  const existing = await createFixture();
  await writeJson(path.join(existing.root, existing.officialResultFile), { already: "present" });
  await assert.rejects(runWorktreeIntegration(existing.input), /already exists/i);
});

test("plan rejects an unexplained main business change", async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.root, "backend/src/main/rogue-before-plan.txt"), "rogue\n", "utf8");
  await assert.rejects(
    runWorktreeIntegration(fixture.input),
    /unexplained.*rogue-before-plan\.txt/i,
  );
  await assert.rejects(access(path.join(fixture.root, fixture.integrationPlanFile)), /ENOENT/);
});

test("plan writes a stable content-addressed bundle and reuses identical evidence", async () => {
  const fixture = await createFixture();
  const first = await runWorktreeIntegration(fixture.input);
  const second = await runWorktreeIntegration(fixture.input);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.deepEqual(second.plan, first.plan);
  assert.equal(first.plan.artifacts.filter((item) => item.kind === "result").length, 1);
  assert.equal(first.plan.artifacts.filter((item) => ["backend", "frontend"].includes(item.kind)).length, 2);
  for (const artifact of first.plan.artifacts) {
    const bundle = await readFile(path.join(fixture.root, artifact.bundlePath));
    assert.equal(sha256(bundle), artifact.candidateSha256);
  }
});

test("integration accepts a Git-clean base after checkout line-ending conversion", async () => {
  const fixture = await createFixture({ checkoutConvertedBase: true });
  assert.match(await readFile(path.join(fixture.root, fixture.existingFile), "utf8"), /\r\n/);

  const planned = await runWorktreeIntegration(fixture.input);
  const observed = await runWorktreeIntegration({ ...fixture.input, command: "status" });
  const applied = await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });

  assert.equal(planned.reused, false);
  assert.equal(planned.plan.artifacts.find((item) => item.path === fixture.existingFile).kind, "backend");
  assert.equal(observed.status.state, "planned");
  assert.equal(applied.status.state, "ready-for-apply");
});

test("apply requires explicit confirmation before acquiring the integration lock", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  const before = await readFile(path.join(fixture.root, fixture.existingFile), "utf8");
  await assert.rejects(
    runWorktreeIntegration({ ...fixture.input, command: "apply" }),
    /confirm/i,
  );
  assert.equal(await readFile(path.join(fixture.root, fixture.existingFile), "utf8"), before);
  await assert.rejects(access(path.join(fixture.root, fixture.integrationLockFile)), /ENOENT/);
});

test("status rejects main HEAD drift and unexplained business changes", async () => {
  const driftedHead = await createFixture();
  await runWorktreeIntegration(driftedHead.input);
  await writeFile(path.join(driftedHead.root, "head-drift.txt"), "drift\n", "utf8");
  await git(driftedHead.root, "add", "head-drift.txt");
  await git(driftedHead.root, "commit", "-m", "head drift");
  await assert.rejects(
    runWorktreeIntegration({ ...driftedHead.input, command: "status" }),
    /HEAD/i,
  );

  const unexplained = await createFixture();
  await runWorktreeIntegration(unexplained.input);
  await writeFile(path.join(unexplained.root, "backend/src/main/rogue.txt"), "rogue\n", "utf8");
  await assert.rejects(
    runWorktreeIntegration({ ...unexplained.input, command: "status" }),
    /unexplained.*rogue\.txt/i,
  );
});

test("status marks target content outside base and candidate hashes inconsistent", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  await writeFile(path.join(fixture.root, fixture.existingFile), "unknown content\n", "utf8");
  const observed = await runWorktreeIntegration({ ...fixture.input, command: "status" });
  assert.equal(observed.status.state, "inconsistent");
  assert.equal(observed.status.artifacts.find((item) => item.path === fixture.existingFile).state, "inconsistent");
});

test("apply rejects target junctions bundle tampering and a legacy lock before writes", async () => {
  const linked = await createFixture();
  await runWorktreeIntegration(linked.input);
  const linkedTarget = path.join(linked.root, "linked-target");
  await mkdir(linkedTarget);
  await symlink(linkedTarget, path.join(linked.root, "backend/src/generated"), "junction");
  await assert.rejects(
    runWorktreeIntegration({ ...linked.input, command: "apply", confirmApply: true }),
    /symbolic link/i,
  );

  const tampered = await createFixture();
  const planned = await runWorktreeIntegration(tampered.input);
  await writeFile(path.join(tampered.root, planned.plan.artifacts[0].bundlePath), "tampered\n", "utf8");
  await assert.rejects(
    runWorktreeIntegration({ ...tampered.input, command: "apply", confirmApply: true }),
    /bundle hash/i,
  );

  const locked = await createFixture();
  await runWorktreeIntegration(locked.input);
  await writeFile(path.join(locked.root, locked.integrationLockFile), "legacy\n", "utf8");
  await assert.rejects(
    runWorktreeIntegration({ ...locked.input, command: "apply", confirmApply: true }),
    /lock already exists/i,
  );
  assert.equal(await readFile(path.join(locked.root, locked.integrationLockFile), "utf8"), "legacy\n");
});

test("status rejects task checkpoint and collected evidence drift", async () => {
  const taskDrift = await createFixture();
  await runWorktreeIntegration(taskDrift.input);
  const task = await readJson(taskDrift.root, taskDrift.taskFile);
  task.purpose = "changed after plan";
  await writeJson(path.join(taskDrift.root, taskDrift.taskFile), task);
  await assert.rejects(
    runWorktreeIntegration({ ...taskDrift.input, command: "status" }),
    /task evidence hash changed/i,
  );

  const receiptDrift = await createFixture();
  await runWorktreeIntegration(receiptDrift.input);
  const receipt = await readJson(receiptDrift.root, receiptDrift.executionReceiptFile);
  receipt.completedAt = "2026-07-21T00:00:05.000Z";
  await writeJson(path.join(receiptDrift.root, receiptDrift.executionReceiptFile), receipt);
  await assert.rejects(
    runWorktreeIntegration({ ...receiptDrift.input, command: "status" }),
    /execution receipt evidence hash changed/i,
  );
});

test("status rejects a stored plan whose artifact mapping was changed", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  const plan = await readJson(fixture.root, fixture.integrationPlanFile);
  plan.artifacts[0].path = "backend/src/main/Injected.java";
  await writeJson(path.join(fixture.root, fixture.integrationPlanFile), plan);
  await assert.rejects(
    runWorktreeIntegration({ ...fixture.input, command: "status" }),
    /artifact.*receipt|mapping/i,
  );
});

test("status rejects a stored plan whose formal result target was redirected", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  const plan = await readJson(fixture.root, fixture.integrationPlanFile);
  const redirected = `.harness/runs/${fixture.runId}/redirected-result.json`;
  plan.resultFile = redirected;
  plan.artifacts.find((artifact) => artifact.kind === "result").path = redirected;
  await writeJson(path.join(fixture.root, fixture.integrationPlanFile), plan);
  await assert.rejects(
    runWorktreeIntegration({ ...fixture.input, command: "status" }),
    /result.*current M3 task|fixed.*result/i,
  );
});

test("apply updates existing and new business files and writes the result last", async () => {
  const fixture = await createFixture();
  const beforeState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  await runWorktreeIntegration(fixture.input);
  const observed = [];
  const applied = await runWorktreeIntegration({
    ...fixture.input,
    command: "apply",
    confirmApply: true,
    testHooks: {
      afterArtifactRename: async ({ kind }) => {
        observed.push(kind);
        if (kind === "backend") await assert.rejects(access(path.join(fixture.root, fixture.phaseOutput)), /ENOENT/);
        if (kind !== "result") await assert.rejects(access(path.join(fixture.root, fixture.officialResultFile)), /ENOENT/);
      },
      beforeReceiptWrite: async () => { observed.push("receipt"); },
    },
  });

  assert.equal(applied.outcome, "ready-for-apply");
  assert.equal(applied.reused, false);
  assert.equal(applied.status.state, "ready-for-apply");
  assert.deepEqual(observed, ["backend", "backend", "phase-output", "result", "receipt"]);
  assert.equal(await readFile(path.join(fixture.root, fixture.existingFile), "utf8"), "class ExistingService { void updated() {} }\n");
  assert.equal(await readFile(path.join(fixture.root, fixture.newFile), "utf8"), "class NewService {}\n");
  assert.equal(await readFile(path.join(fixture.root, fixture.phaseOutput), "utf8"), "implementation notes\n");
  assert.equal((await readJson(fixture.root, fixture.officialResultFile)).status, "completed");
  assert.equal((await readJson(fixture.root, fixture.integrationReceiptFile)).resultFile, fixture.officialResultFile);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), beforeState);
});

test("apply resumes after an artifact rename before status persistence", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  let interrupted = false;
  await assert.rejects(
    runWorktreeIntegration({
      ...fixture.input,
      command: "apply",
      confirmApply: true,
      testHooks: {
        afterArtifactRename: async () => {
          if (!interrupted) {
            interrupted = true;
            throw new Error("injected artifact interruption");
          }
        },
      },
    }),
    /injected artifact interruption/i,
  );
  await assert.rejects(access(path.join(fixture.root, fixture.integrationLockFile)), /ENOENT/);
  const recovered = await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });
  assert.equal(recovered.status.state, "ready-for-apply");
  assert.equal(recovered.reused, false);
});

test("apply resumes after result write before receipt write", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  await assert.rejects(
    runWorktreeIntegration({
      ...fixture.input,
      command: "apply",
      confirmApply: true,
      testHooks: { beforeReceiptWrite: async () => { throw new Error("injected receipt interruption"); } },
    }),
    /injected receipt interruption/i,
  );
  assert.equal((await readJson(fixture.root, fixture.officialResultFile)).status, "completed");
  await assert.rejects(access(path.join(fixture.root, fixture.integrationReceiptFile)), /ENOENT/);
  const recovered = await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });
  assert.equal(recovered.status.state, "ready-for-apply");
  assert.equal(recovered.reused, false);
});

test("apply rechecks each pending target before overwriting it", async () => {
  const fixture = await createFixture();
  const planned = await runWorktreeIntegration(fixture.input);
  const business = planned.plan.artifacts.filter((artifact) => artifact.kind === "backend" || artifact.kind === "frontend");
  const first = business[0];
  const second = business[1];
  await assert.rejects(
    runWorktreeIntegration({
      ...fixture.input,
      command: "apply",
      confirmApply: true,
      testHooks: {
        afterArtifactRename: async ({ path: writtenPath }) => {
          if (writtenPath === first.path) await writeFile(path.join(fixture.root, second.path), "manual concurrent edit\n", "utf8");
        },
      },
    }),
    /changed after preflight|precondition/i,
  );
  assert.equal(await readFile(path.join(fixture.root, second.path), "utf8"), "manual concurrent edit\n");
  await assert.rejects(access(path.join(fixture.root, fixture.integrationReceiptFile)), /ENOENT/);
});

test("apply rechecks every artifact after the final hook and before writing the receipt", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  await assert.rejects(
    runWorktreeIntegration({
      ...fixture.input,
      command: "apply",
      confirmApply: true,
      testHooks: {
        beforeReceiptWrite: async () => {
          await writeFile(path.join(fixture.root, fixture.existingFile), "manual edit before receipt\n", "utf8");
        },
      },
    }),
    /changed before receipt|candidate hash/i,
  );
  assert.equal(await readFile(path.join(fixture.root, fixture.existingFile), "utf8"), "manual edit before receipt\n");
  await assert.rejects(access(path.join(fixture.root, fixture.integrationReceiptFile)), /ENOENT/);
});

test("repeated apply reuses a matching receipt and rejects later drift", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });
  const repeated = await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.outcome, "ready-for-apply");

  await writeFile(path.join(fixture.root, fixture.existingFile), "changed after integration\n", "utf8");
  await assert.rejects(
    runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true }),
    /inconsistent|hash/i,
  );
});

test("repeated apply rejects unsupported integration receipt fields", async () => {
  const fixture = await createFixture();
  await runWorktreeIntegration(fixture.input);
  await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });
  const receipt = await readJson(fixture.root, fixture.integrationReceiptFile);
  receipt.unsupported = true;
  await writeJson(path.join(fixture.root, fixture.integrationReceiptFile), receipt);
  await assert.rejects(
    runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true }),
    /supported receipt fields|unsupported/i,
  );
});

test("PowerShell entry plans checks and applies only with confirmation", async () => {
  const fixture = await createFixture();
  const script = path.join(repositoryRoot, ".harness/scripts/run-worktree-integration.ps1");
  const baseArguments = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Root", fixture.root,
    "-StateFile", fixture.stateFile,
    "-TaskId", fixture.taskId,
    "-TaskFile", fixture.taskFile,
    "-Json",
  ];
  const planned = await execFileAsync("powershell.exe", [...baseArguments, "-Command", "Plan"], { windowsHide: true });
  assert.equal(JSON.parse(planned.stdout).command, "plan");
  const status = await execFileAsync("powershell.exe", [...baseArguments, "-Command", "Status"], { windowsHide: true });
  assert.equal(JSON.parse(status.stdout).status.state, "planned");
  await assert.rejects(
    execFileAsync("powershell.exe", [...baseArguments, "-Command", "Apply"], { windowsHide: true }),
    /confirm/i,
  );
  const applied = await execFileAsync(
    "powershell.exe",
    [...baseArguments, "-Command", "Apply", "-ConfirmApply"],
    { windowsHide: true },
  );
  assert.equal(JSON.parse(applied.stdout).status.state, "ready-for-apply");
});

test("vertical flow advances exactly once only after explicit M3 apply", async () => {
  const fixture = await createFixture();
  const before = await readJson(fixture.root, fixture.stateFile);
  await runWorktreeIntegration(fixture.input);
  const integrated = await runWorktreeIntegration({ ...fixture.input, command: "apply", confirmApply: true });
  const afterIntegration = await readJson(fixture.root, fixture.stateFile);
  assert.equal(integrated.status.state, "ready-for-apply");
  assert.equal(afterIntegration.runtime.revision, before.runtime.revision);
  assert.equal(afterIntegration.phase, before.phase);

  const applied = await runStoryCommand({
    root: fixture.root,
    command: "apply",
    stateFile: fixture.stateFile,
    now: () => "2026-07-21T00:00:06.000Z",
  });
  assert.equal(applied.status, "completed");
  assert.equal(applied.state.phase, "unit-test");
  assert.equal(applied.state.runtime.revision, before.runtime.revision + 1);
  const checkpoint = await readJson(fixture.root, fixture.checkpointFile);
  assert.equal(checkpoint.status, "completed");
});
