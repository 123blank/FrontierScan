import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { prepareSerialBatch } from "../lib/batch-runtime.mjs";
import { resolveBatchBase, runWorktreeCommand } from "../lib/worktree-runtime.mjs";

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

async function createBatchFixture(options = {}) {
  const storyId = options.storyId ?? "M5-B3-B-WORKTREE";
  const fixture = await createFixture({
    storyId,
    runId: options.runId ?? storyId,
  });
  fixture.dag = {
    schemaVersion: "1.0",
    storyId: fixture.state.storyId,
    nodes: [
      {
        taskId: "T1",
        title: "Implement batch backend",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/service/**"],
        acceptanceCriteria: ["Backend candidate is ready."],
      },
      {
        taskId: "T2",
        title: "Implement batch frontend",
        type: "frontend",
        status: "pending",
        ownerAgent: "frontend-developer",
        predictedFiles: ["frontend/src/views/**"],
        acceptanceCriteria: ["Frontend candidate is ready."],
      },
    ],
    edges: [{ from: "T1", to: "T2", reason: "Frontend depends on backend." }],
    waves: [["T1"], ["T2"]],
    globalChanges: [],
    risks: [],
  };
  await writeFile(path.join(fixture.root, fixture.taskDagFile), `${JSON.stringify(fixture.dag, null, 2)}\n`, "utf8");
  const base = await resolveBatchBase({ root: fixture.root });
  fixture.prepared = await prepareSerialBatch({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    base,
    now: () => "2026-07-24T00:00:00.000Z",
  });
  return fixture;
}

async function planBatch(fixture, options = {}) {
  return runWorktreeCommand({
    root: fixture.root,
    command: "batch-plan",
    stateFile: fixture.stateFile,
    ...options,
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("batch plan derives one deterministic worktree plan without changing Harness state", async () => {
  const fixture = await createBatchFixture();
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");

  const result = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-plan",
    stateFile: fixture.stateFile,
    now: () => "2026-07-24T00:01:00.000Z",
  });

  assert.equal(result.plan.storyId, fixture.state.storyId);
  assert.equal(result.plan.batchId, fixture.prepared.ledger.batchId);
  assert.equal(result.plan.baseCommit, fixture.prepared.ledger.baseCommit);
  assert.equal(result.plan.taskDagSha256, fixture.prepared.ledger.taskDagSha256);
  assert.equal(result.plan.branch, `harness/${fixture.state.storyId.toLowerCase()}/batch-${fixture.prepared.ledger.batchId}`);
  assert.equal(result.plan.worktreePath, `.harness/worktrees/${fixture.state.storyId}/batch-${fixture.prepared.ledger.batchId}`);
  assert.equal(result.status.state, "absent");
  assert.equal(await readFile(statePath, "utf8"), before);

  const inspected = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-status",
    stateFile: fixture.stateFile,
  });
  assert.equal(inspected.status.state, "absent");
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-plan", stateFile: fixture.stateFile, taskId: "T1" }),
    /batch Worktree.*taskId|does not accept.*taskId/i,
  );
  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, taskId: "T1" }),
    /batch Worktree.*taskId|does not accept.*taskId/i,
  );
});

test("batch status preserves stored evidence when Git facts have not changed", async () => {
  const fixture = await createBatchFixture({ storyId: "M5-B3-B-STABLE-STATUS" });
  const planned = await planBatch(fixture, { now: () => "2026-07-24T00:01:00.000Z" });
  const statusPath = path.join(fixture.root, planned.statusFile);
  const before = await readFile(statusPath, "utf8");

  const inspected = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-status",
    stateFile: fixture.stateFile,
    now: () => "2026-07-24T00:02:00.000Z",
  });

  assert.equal(inspected.status.observedAt, "2026-07-24T00:01:00.000Z");
  assert.equal(await readFile(statusPath, "utf8"), before);
});

test("batch create fails closed before git worktree add when approval or preconditions are invalid", async () => {
  const noApproval = await createBatchFixture({ storyId: "M5-B3-B-NO-APPROVAL" });
  await planBatch(noApproval);
  const noApprovalCalls = [];
  const noApprovalGit = async (args) => {
    noApprovalCalls.push(args);
    return git(noApproval.root, ...args);
  };
  await assert.rejects(
    runWorktreeCommand({ root: noApproval.root, command: "batch-create", stateFile: noApproval.stateFile, executeGit: noApprovalGit }),
    /ConfirmCreate/,
  );
  assert.equal(noApprovalCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);

  const dirty = await createBatchFixture({ storyId: "M5-B3-B-DIRTY" });
  await planBatch(dirty);
  await writeFile(path.join(dirty.root, "dirty.txt"), "dirty\n", "utf8");
  const dirtyCalls = [];
  await assert.rejects(
    runWorktreeCommand({
      root: dirty.root,
      command: "batch-create",
      stateFile: dirty.stateFile,
      confirmCreate: true,
      executeGit: async (args) => {
        dirtyCalls.push(args);
        return git(dirty.root, ...args);
      },
    }),
    /main repository must be clean/i,
  );
  assert.equal(dirtyCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);

  const drifted = await createBatchFixture({ storyId: "M5-B3-B-DRIFT" });
  await planBatch(drifted);
  await writeFile(path.join(drifted.root, "advance.txt"), "advance\n", "utf8");
  await git(drifted.root, "add", "advance.txt");
  await git(drifted.root, "commit", "-m", "advance dev");
  await assert.rejects(
    runWorktreeCommand({ root: drifted.root, command: "batch-create", stateFile: drifted.stateFile, confirmCreate: true }),
    /base ref 'dev' has moved/i,
  );

  const occupied = await createBatchFixture({ storyId: "M5-B3-B-OCCUPIED" });
  const occupiedPlan = await planBatch(occupied);
  await mkdir(path.join(occupied.root, occupiedPlan.plan.worktreePath), { recursive: true });
  await assert.rejects(
    runWorktreeCommand({ root: occupied.root, command: "batch-create", stateFile: occupied.stateFile, confirmCreate: true }),
    /inconsistent/,
  );

  const branchConflict = await createBatchFixture({ storyId: "M5-B3-B-BRANCH" });
  const conflictPlan = await planBatch(branchConflict);
  await git(branchConflict.root, "checkout", "-b", "conflicting-source");
  await writeFile(path.join(branchConflict.root, "conflict.txt"), "conflict\n", "utf8");
  await git(branchConflict.root, "add", "conflict.txt");
  await git(branchConflict.root, "commit", "-m", "conflicting branch");
  await git(branchConflict.root, "branch", conflictPlan.plan.branch);
  await git(branchConflict.root, "checkout", "dev");
  await assert.rejects(
    runWorktreeCommand({ root: branchConflict.root, command: "batch-create", stateFile: branchConflict.stateFile, confirmCreate: true }),
    /inconsistent/,
  );
});

for (const target of [
  {
    label: "missing",
    prepare: (worktreePath) => rm(worktreePath, { recursive: true, force: true }),
  },
  {
    label: "linked",
    prepare: async (worktreePath) => {
      await rm(worktreePath, { recursive: true, force: true });
      const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b3-linked-worktree-"));
      temporaryRoots.push(external);
      await symlink(external, worktreePath, "junction");
    },
  },
]) {
  test(`batch status rejects a ${target.label} registered Worktree instead of reusing it`, async () => {
    const fixture = await createBatchFixture({ storyId: `M5-B3-B-${target.label.toUpperCase()}-TARGET` });
    const planned = await planBatch(fixture);
    await runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, confirmCreate: true });
    await target.prepare(path.join(fixture.root, planned.plan.worktreePath));
    const gitCalls = [];
    const executeGit = async (args) => {
      gitCalls.push(args);
      if (args[0] === "worktree" && args[1] === "add") throw new Error("Worktree add must not run.");
      return git(fixture.root, ...args);
    };

    const inspected = await runWorktreeCommand({
      root: fixture.root,
      command: "batch-status",
      stateFile: fixture.stateFile,
      executeGit,
    });

    assert.equal(inspected.status.state, "inconsistent");
    await assert.rejects(
      runWorktreeCommand({
        root: fixture.root,
        command: "batch-create",
        stateFile: fixture.stateFile,
        confirmCreate: true,
        executeGit,
      }),
      /inconsistent/i,
    );
    assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
  });
}

test("batch status rejects a registered Worktree whose parent becomes a junction", async () => {
  const fixture = await createBatchFixture({ storyId: "M5-B3-B-LINKED-PARENT" });
  const planned = await planBatch(fixture);
  await runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, confirmCreate: true });

  const worktreePath = path.join(fixture.root, planned.plan.worktreePath);
  const parentPath = path.dirname(worktreePath);
  const gitFile = await readFile(path.join(worktreePath, ".git"), "utf8");
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b3-linked-parent-"));
  temporaryRoots.push(external);
  await rm(parentPath, { recursive: true, force: true });
  const externalWorktreePath = path.join(external, path.basename(worktreePath));
  await mkdir(externalWorktreePath, { recursive: true });
  await writeFile(path.join(externalWorktreePath, ".git"), gitFile, "utf8");
  await symlink(external, parentPath, "junction");

  const gitCalls = [];
  const executeGit = async (args) => {
    gitCalls.push(args);
    if (args[0] === "worktree" && args[1] === "add") throw new Error("Worktree add must not run.");
    return git(fixture.root, ...args);
  };

  const inspected = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-status",
    stateFile: fixture.stateFile,
    executeGit,
  });

  assert.equal(inspected.status.state, "inconsistent");
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "batch-create",
      stateFile: fixture.stateFile,
      confirmCreate: true,
      executeGit,
    }),
    /inconsistent|real directory inside the repository/i,
  );
  assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
});

test("status rejects a registered Worktree whose parent becomes a junction", async () => {
  const fixture = await createFixture({ storyId: "M5-A-LINKED-PARENT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    taskId: "T1",
  });
  await runWorktreeCommand({
    root: fixture.root,
    command: "create",
    stateFile: fixture.stateFile,
    taskId: "T1",
    confirmCreate: true,
  });

  const worktreePath = path.join(fixture.root, planned.plan.worktreePath);
  const parentPath = path.dirname(worktreePath);
  const gitFile = await readFile(path.join(worktreePath, ".git"), "utf8");
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5a-linked-parent-"));
  temporaryRoots.push(external);
  await rm(parentPath, { recursive: true, force: true });
  const externalWorktreePath = path.join(external, path.basename(worktreePath));
  await mkdir(externalWorktreePath, { recursive: true });
  await writeFile(path.join(externalWorktreePath, ".git"), gitFile, "utf8");
  await symlink(external, parentPath, "junction");

  const gitCalls = [];
  const executeGit = async (args) => {
    gitCalls.push(args);
    if (args[0] === "worktree" && args[1] === "add") throw new Error("Worktree add must not run.");
    return git(fixture.root, ...args);
  };

  const inspected = await runWorktreeCommand({
    root: fixture.root,
    command: "status",
    stateFile: fixture.stateFile,
    taskId: "T1",
    executeGit,
  });

  assert.equal(inspected.status.state, "inconsistent");
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "create",
      stateFile: fixture.stateFile,
      taskId: "T1",
      confirmCreate: true,
      executeGit,
    }),
    /inconsistent|real directory inside the repository/i,
  );
  assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
});

for (const command of [
  {
    name: "single-task",
    createOptions: (fixture) => ({
      root: fixture.root,
      command: "create",
      stateFile: fixture.stateFile,
      taskId: "T1",
      confirmCreate: true,
    }),
    prepare: (fixture) => runWorktreeCommand({
      root: fixture.root,
      command: "plan",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      taskId: "T1",
    }),
  },
  {
    name: "batch",
    createOptions: (fixture) => ({
      root: fixture.root,
      command: "batch-create",
      stateFile: fixture.stateFile,
      confirmCreate: true,
    }),
    prepare: (fixture) => planBatch(fixture),
  },
]) {
  test(`${command.name} create fails closed when the branch probe has an unexpected Git failure`, async () => {
    const fixture = command.name === "batch" ? await createBatchFixture() : await createFixture();
    await command.prepare(fixture);
    const gitCalls = [];
    const executeGit = async (args) => {
      gitCalls.push(args);
      if (args[0] === "show-ref") {
        const error = new Error("simulated ref probe failure");
        error.code = 128;
        error.stderr = "fatal: simulated ref probe failure";
        throw error;
      }
      if (args[0] === "worktree" && args[1] === "add") throw new Error("Worktree add must not run.");
      return git(fixture.root, ...args);
    };

    await assert.rejects(
      runWorktreeCommand({ ...command.createOptions(fixture), executeGit }),
      /ref.*probe|verify.*ref|Git.*ref/i,
    );
    assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
  });
}

for (const command of [
  {
    name: "single-task",
    createOptions: (fixture) => ({
      root: fixture.root,
      command: "create",
      stateFile: fixture.stateFile,
      taskId: "T1",
      confirmCreate: true,
    }),
    prepare: (fixture) => runWorktreeCommand({
      root: fixture.root,
      command: "plan",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      taskId: "T1",
    }),
  },
  {
    name: "batch",
    createOptions: (fixture) => ({
      root: fixture.root,
      command: "batch-create",
      stateFile: fixture.stateFile,
      confirmCreate: true,
    }),
    prepare: (fixture) => planBatch(fixture),
  },
]) {
  test(`${command.name} create rejects a branch that drifts after its initial status check`, async () => {
    const fixture = command.name === "batch" ? await createBatchFixture() : await createFixture();
    const planned = await command.prepare(fixture);
    const gitCalls = [];
    let movedBranch = false;
    const executeGit = async (args) => {
      gitCalls.push(args);
      if (args[0] === "worktree" && args[1] === "add") throw new Error("Worktree add must not run.");
      const result = await git(fixture.root, ...args);
      if (args[0] === "status" && !movedBranch) {
        movedBranch = true;
        await git(fixture.root, "branch", "-f", planned.plan.branch, `${planned.plan.baseCommit}^`);
      }
      return result;
    };

    await assert.rejects(
      runWorktreeCommand({ ...command.createOptions(fixture), executeGit }),
      /branch.*planned base commit|branch.*plan/i,
    );
    assert.equal(movedBranch, true);
    assert.equal(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
  });
}

test("batch create makes one Worktree, reuses it, resumes a matching branch, and recovers after status interruption", async () => {
  const fixture = await createBatchFixture({ storyId: "M5-B3-B-CREATE" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const planned = await planBatch(fixture);

  const created = await runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, confirmCreate: true });
  assert.equal(created.reused, false);
  assert.equal(created.status.state, "created");
  assert.equal((await git(path.join(fixture.root, planned.plan.worktreePath), "rev-parse", "HEAD")).stdout.trim(), planned.plan.baseCommit);
  assert.equal(await readFile(statePath, "utf8"), before);

  const repeated = await runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, confirmCreate: true });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.status.state, "created");

  const resumable = await createBatchFixture({ storyId: "M5-B3-B-RESUME" });
  const resumePlan = await planBatch(resumable);
  await git(resumable.root, "branch", resumePlan.plan.branch, resumePlan.plan.baseCommit);
  const resumed = await runWorktreeCommand({ root: resumable.root, command: "batch-create", stateFile: resumable.stateFile, confirmCreate: true });
  assert.equal(resumed.status.state, "created");
  assert.deepEqual(resumed.status.details, []);

  const interrupted = await createBatchFixture({ storyId: "M5-B3-B-RECOVER" });
  await planBatch(interrupted);
  await assert.rejects(
    runWorktreeCommand({
      root: interrupted.root,
      command: "batch-create",
      stateFile: interrupted.stateFile,
      confirmCreate: true,
      afterCreate: () => { throw new Error("simulated batch interruption"); },
    }),
    /simulated batch interruption/,
  );
  const recovered = await runWorktreeCommand({ root: interrupted.root, command: "batch-create", stateFile: interrupted.stateFile, confirmCreate: true });
  assert.equal(recovered.reused, true);
  assert.equal(recovered.status.state, "created");
});

test("batch status preserves resumed-branch evidence when Git facts have not changed", async () => {
  const fixture = await createBatchFixture({ storyId: "M5-B3-B-RESUMED-STABLE" });
  const planned = await planBatch(fixture, { now: () => "2026-07-24T00:01:00.000Z" });
  await git(fixture.root, "branch", planned.plan.branch, planned.plan.baseCommit);
  const created = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-create",
    stateFile: fixture.stateFile,
    confirmCreate: true,
    now: () => "2026-07-24T00:02:00.000Z",
  });
  const statusPath = path.join(fixture.root, created.statusFile);
  const before = await readFile(statusPath, "utf8");

  const inspected = await runWorktreeCommand({
    root: fixture.root,
    command: "batch-status",
    stateFile: fixture.stateFile,
    now: () => "2026-07-24T00:03:00.000Z",
  });

  assert.equal(inspected.status.observedAt, "2026-07-24T00:02:00.000Z");
  assert.equal(await readFile(statusPath, "utf8"), before);
});

test("batch create rejects reuse when another Worktree is registered for the same Story", async () => {
  const fixture = await createBatchFixture({ storyId: "M5-B3-B-REUSE-GUARD" });
  const planned = await planBatch(fixture);
  await runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, confirmCreate: true });

  const otherPath = path.join(fixture.root, `.harness/worktrees/${fixture.state.storyId}/T1`);
  await git(fixture.root, "worktree", "add", "-b", "harness/m5-b3-b-reuse-guard/t1-other", otherPath, planned.plan.baseCommit);

  await assert.rejects(
    runWorktreeCommand({ root: fixture.root, command: "batch-create", stateFile: fixture.stateFile, confirmCreate: true }),
    /Only one created Worktree/,
  );
});

test("batch create rejects lifecycle locks, another Story Worktree, and linked target parents", async () => {
  const locked = await createBatchFixture({ storyId: "M5-B3-B-LOCKED" });
  const lockedPlan = await planBatch(locked);
  const lockFile = path.join(locked.root, path.dirname(lockedPlan.planFile), "worktree-create.lock");
  await writeFile(lockFile, "stale\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: locked.root, command: "batch-create", stateFile: locked.stateFile, confirmCreate: true }),
    /create lock already exists/i,
  );

  const second = await createBatchFixture({ storyId: "M5-B3-B-SINGLE" });
  const secondPlan = await planBatch(second);
  const otherPath = path.join(second.root, `.harness/worktrees/${second.state.storyId}/T1`);
  await git(second.root, "worktree", "add", "-b", "harness/m5-b3-b-single/t1-other", otherPath, secondPlan.plan.baseCommit);
  await assert.rejects(
    runWorktreeCommand({ root: second.root, command: "batch-create", stateFile: second.stateFile, confirmCreate: true }),
    /Only one created Worktree/,
  );

  const linked = await createBatchFixture({ storyId: "M5-B3-B-LINKED" });
  await planBatch(linked);
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b3-linked-"));
  temporaryRoots.push(external);
  await symlink(external, path.join(linked.root, ".harness/worktrees"), "junction");
  await assert.rejects(
    runWorktreeCommand({ root: linked.root, command: "batch-create", stateFile: linked.stateFile, confirmCreate: true }),
    /real directory inside the repository/,
  );
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

test("resolveBatchBase returns only a verified immutable Git base", async () => {
  const fixture = await createFixture();
  const invocations = [];
  const executeGit = async (args) => {
    invocations.push(args);
    return git(fixture.root, ...args);
  };
  const base = await resolveBatchBase({ root: fixture.root, executeGit });
  assert.deepEqual(base, {
    baseRef: "dev",
    baseCommit: (await git(fixture.root, "rev-parse", "dev^{commit}")).stdout.trim(),
  });
  assert.ok(invocations.some((args) => JSON.stringify(args) === JSON.stringify(["rev-parse", "--verify", "--end-of-options", "dev^{commit}"])));
  await assert.rejects(resolveBatchBase({ root: fixture.root, baseRef: "missing" }), /Cannot resolve base ref 'missing'/);
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

  const retiring = await createFixture({ storyId: "M5-A-RETIRING" });
  const retiringPlan = await runWorktreeCommand({ root: retiring.root, command: "plan", stateFile: retiring.stateFile, taskDagFile: retiring.taskDagFile, taskId: "T1" });
  const retirementLock = path.join(retiring.root, path.dirname(retiringPlan.planFile), "retire.lock");
  const createLock = path.join(retiring.root, path.dirname(retiringPlan.planFile), "create.lock");
  await writeFile(retirementLock, "retiring\n", "utf8");
  await assert.rejects(
    runWorktreeCommand({ root: retiring.root, command: "create", stateFile: retiring.stateFile, taskId: "T1", confirmCreate: true }),
    /retirement lock/i,
  );
  assert.equal(await readFile(retirementLock, "utf8"), "retiring\n");
  await assert.rejects(readFile(createLock), /ENOENT/);

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

test("PowerShell batch commands run without TaskId and do not advance Harness state", async () => {
  const fixture = await createBatchFixture({ storyId: "M5-B3-B-POWERSHELL" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const runner = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const powershell = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];
  const common = ["-Root", fixture.root, "-StateFile", fixture.stateFile, "-Json"];

  const planned = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "BatchPlan", ...common], { windowsHide: true });
  assert.equal(JSON.parse(planned.stdout).status.state, "absent");
  const absent = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "BatchStatus", ...common], { windowsHide: true });
  assert.equal(JSON.parse(absent.stdout).status.state, "absent");
  const created = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "BatchCreate", ...common, "-ConfirmCreate"], { windowsHide: true });
  assert.equal(JSON.parse(created.stdout).status.state, "created");
  const ready = await execFileAsync("powershell.exe", [...powershell, runner, "-Command", "BatchStatus", ...common], { windowsHide: true });
  assert.equal(JSON.parse(ready.stdout).status.state, "created");
  assert.equal(await readFile(statePath, "utf8"), before);
});
