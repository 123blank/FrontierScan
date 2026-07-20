import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5a-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5a@example.test");
  await git(root, "config", "user.name", "M5-A Test");
  const gitignore = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
  await writeFile(path.join(root, ".gitignore"), gitignore, "utf8");
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");
  await git(root, "add", ".gitignore", "seed.txt");
  await git(root, "commit", "-m", "fixture");

  const storyId = options.storyId ?? "M5-A-FIXTURE";
  const runId = options.runId ?? storyId;
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = ".harness/runs/fixture/task-dag.json";
  const state = {
    schemaVersion: "1.0",
    storyId,
    phase: "implementation",
    runtime: { runId, status: "active", revision: 4 },
  };
  const dag = {
    schemaVersion: "1.0",
    storyId: options.dagStoryId ?? storyId,
    nodes: [{
      taskId: "T1",
      title: "Implement safe worktree",
      type: "integration",
      status: options.taskStatus ?? "pending",
      predictedFiles: [".harness/scripts/lib/worktree-runtime.mjs"],
      acceptanceCriteria: ["Worktree is ready."],
      ownerAgent: "backend-developer",
    }],
    edges: [],
    waves: [["T1"]],
    globalChanges: [],
    risks: [],
  };
  await mkdir(path.join(root, path.dirname(stateFile)), { recursive: true });
  await mkdir(path.join(root, path.dirname(taskDagFile)), { recursive: true });
  await writeFile(path.join(root, stateFile), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, taskDagFile), `${JSON.stringify(dag, null, 2)}\n`, "utf8");
  if (options.commitHarness !== false) {
    await git(root, "add", "-f", stateFile, taskDagFile);
    await git(root, "commit", "-m", "add harness fixture");
  }
  return { root, stateFile, taskDagFile, state, dag };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("plan pins dev and writes deterministic plan and absent status without changing state", async () => {
  const fixture = await createFixture();
  const statePath = path.join(fixture.root, fixture.stateFile);
  const originalState = await readFile(statePath, "utf8");
  const baseCommit = (await git(fixture.root, "rev-parse", "dev^{commit}")).stdout.trim();

  const result = await runWorktreeCommand({
    root: fixture.root,
    command: "plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    taskId: "T1",
    now: () => "2026-07-20T00:00:00.000Z",
  });

  assert.equal(result.plan.baseRef, "dev");
  assert.equal(result.plan.baseCommit, baseCommit);
  assert.equal(result.plan.branch, "harness/m5-a-fixture/t1-implement-safe-worktree");
  assert.equal(result.plan.worktreePath, ".harness/worktrees/M5-A-FIXTURE/T1");
  assert.equal(result.plan.wave, 1);
  assert.equal(result.status.state, "absent");
  assert.equal(result.planFile, ".harness/runs/M5-A-FIXTURE/worktrees/T1/plan.json");
  assert.equal(result.statusFile, ".harness/runs/M5-A-FIXTURE/worktrees/T1/status.json");
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.root, result.planFile), "utf8")), result.plan);
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.root, result.statusFile), "utf8")), result.status);
  assert.equal(await readFile(statePath, "utf8"), originalState);

  const inspected = await runWorktreeCommand({ root: fixture.root, command: "status", stateFile: fixture.stateFile, taskId: "T1" });
  assert.equal(inspected.status.state, "absent");

  const reorderedPlan = Object.fromEntries(Object.entries(result.plan).reverse());
  await writeFile(path.join(fixture.root, result.planFile), `${JSON.stringify(reorderedPlan, null, 2)}\n`, "utf8");
  const repeated = await runWorktreeCommand({
    root: fixture.root,
    command: "plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    taskId: "T1",
    now: () => "2026-07-20T00:01:00.000Z",
  });
  assert.equal(repeated.reused, true);
  assert.deepEqual(repeated.plan, result.plan);
});

test("plan rejects a linked runtime output parent", async () => {
  const fixture = await createFixture({ storyId: "M5-A-OUTPUT-LINK" });
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5a-output-"));
  temporaryRoots.push(external);
  const runtimeParent = path.join(fixture.root, ".harness/runs/M5-A-OUTPUT-LINK");
  await mkdir(runtimeParent, { recursive: true });
  await symlink(external, path.join(runtimeParent, "worktrees"), "junction");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "plan", stateFile: fixture.stateFile, taskDagFile: fixture.taskDagFile, taskId: "T1" }),
    /real directory inside the repository/,
  );
});

test("plan rejects story mismatch, unknown task, non-pending task and invalid base ref", async () => {
  const mismatch = await createFixture({ dagStoryId: "OTHER" });
  await assert.rejects(
    runWorktreeCommand({ root: mismatch.root, command: "plan", stateFile: mismatch.stateFile, taskDagFile: mismatch.taskDagFile, taskId: "T1" }),
    /does not match the active Story/,
  );

  const unknown = await createFixture();
  await assert.rejects(
    runWorktreeCommand({ root: unknown.root, command: "plan", stateFile: unknown.stateFile, taskDagFile: unknown.taskDagFile, taskId: "T9" }),
    /unknown task 'T9'/,
  );

  const done = await createFixture({ taskStatus: "done" });
  await assert.rejects(
    runWorktreeCommand({ root: done.root, command: "plan", stateFile: done.stateFile, taskDagFile: done.taskDagFile, taskId: "T1" }),
    /must be pending/,
  );

  const invalidRef = await createFixture();
  await assert.rejects(
    runWorktreeCommand({ root: invalidRef.root, command: "plan", stateFile: invalidRef.stateFile, taskDagFile: invalidRef.taskDagFile, taskId: "T1", baseRef: "missing" }),
    /Cannot resolve base ref 'missing'/,
  );

  const optionRef = await createFixture();
  const invocations = [];
  const executeGit = async (args) => {
    invocations.push(args);
    return git(optionRef.root, ...args);
  };
  await assert.rejects(
    runWorktreeCommand({ root: optionRef.root, command: "plan", stateFile: optionRef.stateFile, taskDagFile: optionRef.taskDagFile, taskId: "T1", baseRef: "--help", executeGit }),
    /Cannot resolve base ref '--help'/,
  );
  assert.ok(invocations.some((args) => JSON.stringify(args) === JSON.stringify(["rev-parse", "--verify", "--end-of-options", "--help^{commit}"])));
});

test("create fails closed before git add when approval or preconditions are invalid", async () => {
  const noApproval = await createFixture();
  const planned = await runWorktreeCommand({ root: noApproval.root, command: "plan", stateFile: noApproval.stateFile, taskDagFile: noApproval.taskDagFile, taskId: "T1" });
  await assert.rejects(
    runWorktreeCommand({ root: noApproval.root, command: "create", stateFile: noApproval.stateFile, taskId: "T1" }),
    /ConfirmCreate/,
  );
  assert.equal((await runWorktreeCommand({ root: noApproval.root, command: "status", stateFile: noApproval.stateFile, taskId: "T1" })).status.state, "absent");

  const dirty = await createFixture();
  await runWorktreeCommand({ root: dirty.root, command: "plan", stateFile: dirty.stateFile, taskDagFile: dirty.taskDagFile, taskId: "T1" });
  await writeFile(path.join(dirty.root, "dirty.txt"), "dirty\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: dirty.root, command: "create", stateFile: dirty.stateFile, taskId: "T1", confirmCreate: true }),
    /main repository must be clean/i,
  );

  const drifted = await createFixture();
  await runWorktreeCommand({ root: drifted.root, command: "plan", stateFile: drifted.stateFile, taskDagFile: drifted.taskDagFile, taskId: "T1" });
  await writeFile(path.join(drifted.root, "advance.txt"), "advance\n", "utf8");
  await git(drifted.root, "add", "advance.txt");
  await git(drifted.root, "commit", "-m", "advance dev");
  await assert.rejects(
    runWorktreeCommand({ root: drifted.root, command: "create", stateFile: drifted.stateFile, taskId: "T1", confirmCreate: true }),
    /base ref 'dev' has moved/,
  );

  const occupied = await createFixture();
  const occupiedPlan = await runWorktreeCommand({ root: occupied.root, command: "plan", stateFile: occupied.stateFile, taskDagFile: occupied.taskDagFile, taskId: "T1" });
  await mkdir(path.join(occupied.root, occupiedPlan.plan.worktreePath), { recursive: true });
  await assert.rejects(
    runWorktreeCommand({ root: occupied.root, command: "create", stateFile: occupied.stateFile, taskId: "T1", confirmCreate: true }),
    /inconsistent/,
  );

  const branchConflict = await createFixture();
  const conflictPlan = await runWorktreeCommand({ root: branchConflict.root, command: "plan", stateFile: branchConflict.stateFile, taskDagFile: branchConflict.taskDagFile, taskId: "T1" });
  await git(branchConflict.root, "checkout", "-b", "conflicting-source");
  await writeFile(path.join(branchConflict.root, "conflict.txt"), "conflict\n", "utf8");
  await git(branchConflict.root, "add", "conflict.txt");
  await git(branchConflict.root, "commit", "-m", "conflicting branch");
  await git(branchConflict.root, "branch", conflictPlan.plan.branch);
  await git(branchConflict.root, "checkout", "dev");
  await assert.rejects(
    runWorktreeCommand({ root: branchConflict.root, command: "create", stateFile: branchConflict.stateFile, taskId: "T1", confirmCreate: true }),
    /inconsistent/,
  );
});

test("create makes one worktree, reuses it and resumes an existing matching branch", async () => {
  const fixture = await createFixture();
  const statePath = path.join(fixture.root, fixture.stateFile);
  const originalState = await readFile(statePath, "utf8");
  const planned = await runWorktreeCommand({ root: fixture.root, command: "plan", stateFile: fixture.stateFile, taskDagFile: fixture.taskDagFile, taskId: "T1" });

  const created = await runWorktreeCommand({ root: fixture.root, command: "create", stateFile: fixture.stateFile, taskId: "T1", confirmCreate: true });
  assert.equal(created.reused, false);
  assert.equal(created.status.state, "created");
  assert.equal((await git(path.join(fixture.root, planned.plan.worktreePath), "rev-parse", "HEAD")).stdout.trim(), planned.plan.baseCommit);
  assert.equal(await readFile(statePath, "utf8"), originalState);
  const mainStatus = await git(fixture.root, "status", "--porcelain=v1", "--untracked-files=all");
  const normalizedMainStatus = mainStatus.stdout.replaceAll("\\", "/");
  assert.match(normalizedMainStatus, /\.harness\/runs\/M5-A-FIXTURE\/worktrees\/T1\/plan\.json/);
  assert.match(normalizedMainStatus, /\.harness\/runs\/M5-A-FIXTURE\/worktrees\/T1\/status\.json/);
  assert.doesNotMatch(normalizedMainStatus, /\.harness\/worktrees\//);

  const repeated = await runWorktreeCommand({ root: fixture.root, command: "create", stateFile: fixture.stateFile, taskId: "T1", confirmCreate: true });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.status.state, "created");

  const resumable = await createFixture({ storyId: "M5-A-RESUME" });
  const resumePlan = await runWorktreeCommand({ root: resumable.root, command: "plan", stateFile: resumable.stateFile, taskDagFile: resumable.taskDagFile, taskId: "T1" });
  await git(resumable.root, "branch", resumePlan.plan.branch, resumePlan.plan.baseCommit);
  const resumed = await runWorktreeCommand({ root: resumable.root, command: "create", stateFile: resumable.stateFile, taskId: "T1", confirmCreate: true });
  assert.equal(resumed.status.state, "created");
  assert.match(resumed.status.details.join(" "), /existing matching branch/i);
});

test("create allows only the current uncommitted Harness state, DAG and run artifacts", async () => {
  const fixture = await createFixture({ storyId: "M5-A-UNCOMMITTED", commitHarness: false });
  const planned = await runWorktreeCommand({ root: fixture.root, command: "plan", stateFile: fixture.stateFile, taskDagFile: fixture.taskDagFile, taskId: "T1" });
  const phaseArtifact = path.join(fixture.root, `.harness/runs/${fixture.state.runtime.runId}/phases/02-task-dag/notes.md`);
  await mkdir(path.dirname(phaseArtifact), { recursive: true });
  await writeFile(phaseArtifact, "current run artifact\n", "utf8");

  const created = await runWorktreeCommand({ root: fixture.root, command: "create", stateFile: fixture.stateFile, taskId: "T1", confirmCreate: true });
  assert.equal(created.status.state, "created");
  assert.equal(created.plan.taskDagFile, planned.plan.taskDagFile);
});

test("create recovers when git succeeded before status persistence", async () => {
  const fixture = await createFixture({ storyId: "M5-A-RECOVER" });
  await runWorktreeCommand({ root: fixture.root, command: "plan", stateFile: fixture.stateFile, taskDagFile: fixture.taskDagFile, taskId: "T1" });
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "create",
      stateFile: fixture.stateFile,
      taskId: "T1",
      confirmCreate: true,
      afterCreate: () => { throw new Error("simulated interruption"); },
    }),
    /simulated interruption/,
  );

  const recovered = await runWorktreeCommand({ root: fixture.root, command: "create", stateFile: fixture.stateFile, taskId: "T1", confirmCreate: true });
  assert.equal(recovered.reused, true);
  assert.equal(recovered.status.state, "created");
});

test("create rejects a stale lock, another Story worktree and a linked parent", async () => {
  const locked = await createFixture({ storyId: "M5-A-LOCKED" });
  const lockedPlan = await runWorktreeCommand({ root: locked.root, command: "plan", stateFile: locked.stateFile, taskDagFile: locked.taskDagFile, taskId: "T1" });
  const lockFile = path.join(locked.root, path.dirname(lockedPlan.planFile), "create.lock");
  await writeFile(lockFile, "stale\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: locked.root, command: "create", stateFile: locked.stateFile, taskId: "T1", confirmCreate: true }),
    /create lock already exists/,
  );

  const second = await createFixture({ storyId: "M5-A-SINGLE" });
  const secondPlan = await runWorktreeCommand({ root: second.root, command: "plan", stateFile: second.stateFile, taskDagFile: second.taskDagFile, taskId: "T1" });
  const otherPath = path.join(second.root, ".harness/worktrees/M5-A-SINGLE/T2");
  await git(second.root, "worktree", "add", "-b", "harness/m5-a-single/t2-other", otherPath, secondPlan.plan.baseCommit);
  await assert.rejects(
    runWorktreeCommand({ root: second.root, command: "create", stateFile: second.stateFile, taskId: "T1", confirmCreate: true }),
    /Only one created Worktree/,
  );

  const linked = await createFixture({ storyId: "M5-A-LINKED" });
  await runWorktreeCommand({ root: linked.root, command: "plan", stateFile: linked.stateFile, taskDagFile: linked.taskDagFile, taskId: "T1" });
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5a-linked-"));
  temporaryRoots.push(external);
  await symlink(external, path.join(linked.root, ".harness/worktrees"), "junction");
  await assert.rejects(
    runWorktreeCommand({ root: linked.root, command: "create", stateFile: linked.stateFile, taskId: "T1", confirmCreate: true }),
    /real directory inside the repository/,
  );
});

test("create reports git add failure without producing a registered worktree", async () => {
  const fixture = await createFixture({ storyId: "M5-A-TIMEOUT" });
  await runWorktreeCommand({ root: fixture.root, command: "plan", stateFile: fixture.stateFile, taskDagFile: fixture.taskDagFile, taskId: "T1" });
  const executeGit = async (args) => {
    if (args[0] === "worktree" && args[1] === "add") throw new Error("simulated timeout");
    return git(fixture.root, ...args);
  };
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "create", stateFile: fixture.stateFile, taskId: "T1", confirmCreate: true, executeGit }),
    /git worktree add failed: simulated timeout/,
  );
  assert.equal((await runWorktreeCommand({ root: fixture.root, command: "status", stateFile: fixture.stateFile, taskId: "T1" })).status.state, "absent");
});

test("status and create reject a tampered plan or changed bound DAG", async () => {
  const tampered = await createFixture({ storyId: "M5-A-TAMPERED" });
  const planned = await runWorktreeCommand({ root: tampered.root, command: "plan", stateFile: tampered.stateFile, taskDagFile: tampered.taskDagFile, taskId: "T1" });
  const planPath = path.join(tampered.root, planned.planFile);
  const changedPlan = JSON.parse(await readFile(planPath, "utf8"));
  changedPlan.worktreePath = ".harness/worktrees/OTHER/T1";
  await writeFile(planPath, `${JSON.stringify(changedPlan, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: tampered.root, command: "create", stateFile: tampered.stateFile, taskId: "T1", confirmCreate: true }),
    /derived branch or path/,
  );

  const extraField = await createFixture({ storyId: "M5-A-EXTRA-FIELD" });
  const extraPlan = await runWorktreeCommand({ root: extraField.root, command: "plan", stateFile: extraField.stateFile, taskDagFile: extraField.taskDagFile, taskId: "T1" });
  const extraPlanPath = path.join(extraField.root, extraPlan.planFile);
  const extra = JSON.parse(await readFile(extraPlanPath, "utf8"));
  extra.unexpected = true;
  await writeFile(extraPlanPath, `${JSON.stringify(extra, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: extraField.root, command: "status", stateFile: extraField.stateFile, taskId: "T1" }),
    /unsupported fields/,
  );

  const changedDag = await createFixture({ storyId: "M5-A-DAG-DRIFT" });
  await runWorktreeCommand({ root: changedDag.root, command: "plan", stateFile: changedDag.stateFile, taskDagFile: changedDag.taskDagFile, taskId: "T1" });
  await writeFile(path.join(changedDag.root, changedDag.taskDagFile), `${JSON.stringify({ ...changedDag.dag, risks: ["changed"] }, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: changedDag.root, command: "status", stateFile: changedDag.stateFile, taskId: "T1" }),
    /bound Task DAG has changed/,
  );
});

test("PowerShell entry runs validate, plan, status, create and status without advancing Harness state", async () => {
  const fixture = await createFixture({ storyId: "M5-A-VERTICAL" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const validator = path.join(repositoryRoot, ".harness/scripts/validate-task-dag.ps1");
  const runner = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const powershell = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];

  await execFileAsync("powershell.exe", [...powershell, validator, "-TaskDagFile", path.join(fixture.root, fixture.taskDagFile)], { windowsHide: true });
  const common = ["-Root", fixture.root, "-StateFile", fixture.stateFile, "-TaskId", "T1", "-Json"];
  const planResult = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "Plan", ...common, "-TaskDagFile", fixture.taskDagFile], { windowsHide: true });
  assert.equal(JSON.parse(planResult.stdout).status.state, "absent");
  const absent = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "Status", ...common], { windowsHide: true });
  assert.equal(JSON.parse(absent.stdout).status.state, "absent");
  const created = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "Create", ...common, "-ConfirmCreate"], { windowsHide: true });
  assert.equal(JSON.parse(created.stdout).status.state, "created");
  const ready = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "Status", ...common], { windowsHide: true });
  assert.equal(JSON.parse(ready.stdout).status.state, "created");
  assert.equal(await readFile(statePath, "utf8"), before);
});
