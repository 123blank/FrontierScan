import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5da-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5da@example.test");
  await git(root, "config", "user.name", "M5-D-A Test");
  const gitignore = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
  await writeFile(path.join(root, ".gitignore"), gitignore, "utf8");
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");
  await git(root, "add", ".gitignore", "seed.txt");
  await git(root, "commit", "-m", "fixture");

  const storyId = options.storyId ?? "M5-D-A-FIXTURE";
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = ".harness/runs/fixture/task-dag.json";
  const state = {
    schemaVersion: "1.0",
    storyId,
    phase: options.phase ?? "implementation",
    runtime: { runId: storyId, status: "active", revision: 4 },
  };
  const dag = {
    schemaVersion: "1.0",
    storyId: options.dagStoryId ?? storyId,
    nodes: options.nodes ?? [
      {
        taskId: "T2",
        title: "Implement frontend wave",
        type: "frontend",
        status: "pending",
        ownerAgent: "frontend-developer",
        predictedFiles: ["frontend/src/views/wave.ts"],
        acceptanceCriteria: ["Frontend candidate is isolated."],
      },
      {
        taskId: "T1",
        title: "Implement backend wave",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/main/java/Wave.java"],
        acceptanceCriteria: ["Backend candidate is isolated."],
      },
    ],
    edges: [],
    waves: options.waves ?? [["T2", "T1"]],
    globalChanges: options.globalChanges ?? [],
    risks: [],
  };
  await mkdir(path.join(root, path.dirname(stateFile)), { recursive: true });
  await mkdir(path.join(root, path.dirname(taskDagFile)), { recursive: true });
  await writeFile(path.join(root, stateFile), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, taskDagFile), `${JSON.stringify(dag, null, 2)}\n`, "utf8");
  await git(root, "add", "-f", stateFile, taskDagFile);
  await git(root, "commit", "-m", "add harness fixture");
  return { root, stateFile, taskDagFile, state, dag };
}

function waveLockFiles(planned) {
  const directory = path.posix.dirname(path.posix.dirname(planned.planFile));
  return {
    create: path.posix.join(directory, "create.lock"),
    recovery: path.posix.join(directory, "create-recovery.lock"),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("wave plan derives stable task branches and paths without changing Harness state", async () => {
  const fixture = await createFixture();
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");

  const result = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => "2026-07-30T05:00:00.000Z",
  });

  assert.equal(result.plan.storyId, fixture.state.storyId);
  assert.equal(result.plan.wave, 1);
  assert.equal(result.plan.baseRef, "dev");
  assert.match(result.plan.baseCommit, /^[a-f0-9]{40}$/);
  assert.deepEqual(result.plan.tasks.map((task) => task.taskId), ["T1", "T2"]);
  assert.deepEqual(
    result.plan.tasks.map(({ taskId, branch, worktreePath }) => ({ taskId, branch, worktreePath })),
    [
      {
        taskId: "T1",
        branch: "harness/m5-d-a-fixture/wave-1-t1-implement-backend-wave",
        worktreePath: ".harness/worktrees/M5-D-A-FIXTURE/wave-1/T1",
      },
      {
        taskId: "T2",
        branch: "harness/m5-d-a-fixture/wave-1-t2-implement-frontend-wave",
        worktreePath: ".harness/worktrees/M5-D-A-FIXTURE/wave-1/T2",
      },
    ],
  );
  assert.equal(result.status.state, "absent");
  assert.equal(await readFile(statePath, "utf8"), before);

  const repeated = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => "2026-07-30T05:01:00.000Z",
  });
  assert.equal(repeated.reused, true);
  assert.deepEqual(repeated.plan, result.plan);
});

test("wave create requires explicit approval and the exact stored plan hash before Git writes", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-APPROVAL" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const calls = [];
  const executeGit = async (args) => {
    calls.push(args);
    return git(fixture.root, ...args);
  };

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      executeGit,
    }),
    /ConfirmWaveCreate/,
  );
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: `sha256:${"0".repeat(64)}`,
      confirmWaveCreate: true,
      executeGit,
    }),
    /approved plan hash|ExpectedPlanSha256/i,
  );
  assert.equal(calls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
});

test("wave status exposes create and recovery lock facts without trusting age or pid", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-LOCK-STATUS" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => "2026-08-04T06:00:00.000Z",
  });
  const lock = {
    schemaVersion: "1.0",
    lockId: "11111111-1111-4111-8111-111111111111",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const lockFile = waveLockFiles(planned).create;
  const lockPath = path.join(fixture.root, lockFile);
  const lockSource = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(lockPath, lockSource, "utf8");

  const inspected = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => "2026-08-04T06:01:00.000Z",
  });

  assert.equal(inspected.locks.recovery, null);
  assert.deepEqual(inspected.locks.create, {
    file: lockFile,
    sha256: `sha256:${createHash("sha256").update(lockSource).digest("hex")}`,
    ...lock,
  });
});

test("wave create creates absent tasks in plan order and resumes branch-only tasks", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-CREATE" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const [first] = planned.plan.tasks;
  await git(fixture.root, "branch", first.branch, planned.plan.baseCommit);
  const additions = [];

  const created = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    executeGit: async (args) => {
      if (args[0] === "worktree" && args[1] === "add") additions.push(args);
      return git(fixture.root, ...args);
    },
  });

  assert.equal(created.status.state, "ready");
  assert.deepEqual(created.status.tasks.map((task) => task.state), ["created", "created"]);
  assert.equal(additions.length, 2);
  assert.equal(additions[0].includes("-b"), false);
  assert.equal(additions[1].includes("-b"), true);
  assert.equal(await readFile(statePath, "utf8"), before);
});

test("wave create fails before git add for a dirty main tree or another Story wave Worktree", async () => {
  const dirty = await createFixture({ storyId: "M5-D-B-DIRTY" });
  const dirtyPlan = await runWorktreeCommand({
    root: dirty.root,
    command: "wave-plan",
    stateFile: dirty.stateFile,
    taskDagFile: dirty.taskDagFile,
    waveIndex: 1,
  });
  await writeFile(path.join(dirty.root, "dirty.txt"), "dirty\n", "utf8");
  const dirtyAdds = [];
  await assert.rejects(
    runWorktreeCommand({
      root: dirty.root,
      command: "wave-create",
      stateFile: dirty.stateFile,
      taskDagFile: dirty.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: dirtyPlan.status.wavePlanSha256,
      confirmWaveCreate: true,
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") dirtyAdds.push(args);
        return git(dirty.root, ...args);
      },
    }),
    /main repository must be clean/i,
  );
  assert.equal(dirtyAdds.length, 0);

  const otherWave = await createFixture({ storyId: "M5-D-B-OTHER-WAVE" });
  const otherPlan = await runWorktreeCommand({
    root: otherWave.root,
    command: "wave-plan",
    stateFile: otherWave.stateFile,
    taskDagFile: otherWave.taskDagFile,
    waveIndex: 1,
  });
  const unexpectedPath = path.join(
    otherWave.root,
    `.harness/worktrees/${otherWave.state.storyId}/wave-2/T9`,
  );
  await writeFile(
    path.join(otherWave.root, ".git/info/exclude"),
    ".harness/worktrees/\n",
    "utf8",
  );
  await git(
    otherWave.root,
    "worktree",
    "add",
    "-b",
    "harness/m5-d-b-other-wave/wave-2-t9-unplanned",
    unexpectedPath,
    otherPlan.plan.baseCommit,
  );
  await assert.rejects(
    runWorktreeCommand({
      root: otherWave.root,
      command: "wave-create",
      stateFile: otherWave.stateFile,
      taskDagFile: otherWave.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: otherPlan.status.wavePlanSha256,
      confirmWaveCreate: true,
    }),
    /another wave|unplanned.*Story|allowlist/i,
  );
});

test("wave create rejects a plan that changes after the create lock is acquired", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-PLAN-TOCTOU" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const planPath = path.join(fixture.root, planned.planFile);
  const additions = [];

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      afterWaveCreateLockAcquired: async () => {
        const changed = { ...planned.plan, plannedAt: "2026-08-04T07:00:00.000Z" };
        await writeFile(planPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
      },
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") additions.push(args);
        return git(fixture.root, ...args);
      },
    }),
    /approved plan hash|ExpectedPlanSha256/i,
  );
  assert.equal(additions.length, 0);
});

test("concurrent wave create calls allow only one create lock owner", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-CONCURRENT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  let releaseFirst;
  let signalAcquired;
  const firstMayContinue = new Promise((resolve) => { releaseFirst = resolve; });
  const firstAcquired = new Promise((resolve) => { signalAcquired = resolve; });
  const first = runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    afterWaveCreateLockAcquired: async () => {
      signalAcquired();
      await firstMayContinue;
    },
  });
  await firstAcquired;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
    }),
    /create lock already exists/i,
  );
  releaseFirst();
  assert.equal((await first).status.state, "ready");
});

test("different waves in one Story share one create lock", async () => {
  const nodes = [
    {
      taskId: "T1",
      title: "First backend wave",
      type: "backend",
      status: "pending",
      ownerAgent: "backend-developer",
      predictedFiles: ["backend/src/main/java/WaveOne.java"],
      acceptanceCriteria: ["First backend candidate is isolated."],
    },
    {
      taskId: "T2",
      title: "First frontend wave",
      type: "frontend",
      status: "pending",
      ownerAgent: "frontend-developer",
      predictedFiles: ["frontend/src/views/wave-one.ts"],
      acceptanceCriteria: ["First frontend candidate is isolated."],
    },
    {
      taskId: "T3",
      title: "Second backend wave",
      type: "backend",
      status: "pending",
      ownerAgent: "backend-developer",
      predictedFiles: ["backend/src/main/java/WaveTwo.java"],
      acceptanceCriteria: ["Second backend candidate is isolated."],
    },
    {
      taskId: "T4",
      title: "Second frontend wave",
      type: "frontend",
      status: "pending",
      ownerAgent: "frontend-developer",
      predictedFiles: ["frontend/src/views/wave-two.ts"],
      acceptanceCriteria: ["Second frontend candidate is isolated."],
    },
  ];
  const fixture = await createFixture({
    storyId: "M5-D-B-CROSS-WAVE",
    nodes,
    waves: [["T1", "T2"], ["T3", "T4"]],
  });
  const firstPlan = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const secondPlan = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 2,
  });
  let releaseFirst;
  let signalAcquired;
  const firstMayContinue = new Promise((resolve) => { releaseFirst = resolve; });
  const firstAcquired = new Promise((resolve) => { signalAcquired = resolve; });
  const first = runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: firstPlan.status.wavePlanSha256,
    confirmWaveCreate: true,
    afterWaveCreateLockAcquired: async () => {
      signalAcquired();
      await firstMayContinue;
    },
  });
  await firstAcquired;

  const additions = [];
  const secondOutcome = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 2,
    expectedPlanSha256: secondPlan.status.wavePlanSha256,
    confirmWaveCreate: true,
    executeGit: async (args) => {
      if (args[0] === "worktree" && args[1] === "add") additions.push(args);
      return git(fixture.root, ...args);
    },
  }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  releaseFirst();
  await first.catch(() => {});

  assert.equal(secondOutcome.ok, false);
  assert.match(secondOutcome.error.message, /create lock already exists/i);
  assert.equal(additions.length, 0);
});

test("a recovery lock fences an existing wave create owner before the next Git write", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-FENCED" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const recoveryLockFile = waveLockFiles(planned).recovery;
  const recoveryLockPath = path.join(fixture.root, recoveryLockFile);
  const additions = [];

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      beforeWaveTaskCreate: async () => {
        const recoveryLock = {
          schemaVersion: "1.0",
          lockId: "22222222-2222-4222-8222-222222222222",
          mode: "recovery",
          storyId: planned.plan.storyId,
          runId: planned.plan.runId,
          wave: planned.plan.wave,
          planSha256: planned.status.wavePlanSha256,
          pid: 5252,
          createdAt: "2026-08-04T06:30:00.000Z",
        };
        await writeFile(recoveryLockPath, `${JSON.stringify(recoveryLock, null, 2)}\n`, "utf8");
      },
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") additions.push(args);
        return git(fixture.root, ...args);
      },
    }),
    /fenced.*recovery lock|recovery.*fenced/i,
  );
  assert.equal(additions.length, 0);
  await readFile(
    path.join(fixture.root, waveLockFiles(planned).create),
    "utf8",
  );
  await readFile(recoveryLockPath, "utf8");
});

test("a recovery lock fences an existing owner after branch probing and before Git write", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-GIT-WRITE-FENCED" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const recoveryLockPath = path.join(fixture.root, waveLockFiles(planned).recovery);
  const additions = [];

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      beforeWaveGitWrite: async () => {
        const recoveryLock = {
          schemaVersion: "1.0",
          lockId: "23232323-2323-4323-8323-232323232323",
          mode: "recovery",
          storyId: planned.plan.storyId,
          runId: planned.plan.runId,
          wave: planned.plan.wave,
          planSha256: planned.status.wavePlanSha256,
          pid: 5353,
          createdAt: "2026-08-04T06:32:00.000Z",
        };
        await writeFile(recoveryLockPath, `${JSON.stringify(recoveryLock, null, 2)}\n`, "utf8");
      },
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") additions.push(args);
        return git(fixture.root, ...args);
      },
    }),
    /fenced.*recovery lock|recovery.*fenced/i,
  );

  assert.equal(additions.length, 0);
});

test("a recovery lock fences an existing owner at the status write point", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-STATUS-FENCED" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const statusPath = path.join(fixture.root, planned.statusFile);
  const statusBefore = await readFile(statusPath, "utf8");
  const recoveryLockPath = path.join(fixture.root, waveLockFiles(planned).recovery);
  let injected = false;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      beforeWaveStatusWrite: async () => {
        if (injected) return;
        injected = true;
        const recoveryLock = {
          schemaVersion: "1.0",
          lockId: "25252525-2525-4525-8525-252525252525",
          mode: "recovery",
          storyId: planned.plan.storyId,
          runId: planned.plan.runId,
          wave: planned.plan.wave,
          planSha256: planned.status.wavePlanSha256,
          pid: 5454,
          createdAt: "2026-08-04T06:35:00.000Z",
        };
        await writeFile(recoveryLockPath, `${JSON.stringify(recoveryLock, null, 2)}\n`, "utf8");
      },
    }),
    /fenced.*recovery lock|recovery.*fenced/i,
  );

  assert.equal(await readFile(statusPath, "utf8"), statusBefore);
});

test("a stale WaveStatus cannot overwrite the status bound by a completed receipt", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-STATUS-CAS" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const first = planned.plan.tasks[0];
  await git(
    fixture.root,
    "worktree",
    "add",
    "-b",
    first.branch,
    path.join(fixture.root, first.worktreePath),
    planned.plan.baseCommit,
  );
  let releaseStaleStatus;
  let signalStaleStatus;
  const staleStatusMayContinue = new Promise((resolve) => { releaseStaleStatus = resolve; });
  const staleStatusComputed = new Promise((resolve) => { signalStaleStatus = resolve; });
  const staleStatus = runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    beforeWaveStatusWrite: async (status) => {
      assert.equal(status.state, "partial");
      signalStaleStatus();
      await staleStatusMayContinue;
    },
  });
  await staleStatusComputed;

  const created = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
  });
  releaseStaleStatus();
  await staleStatus;

  const statusSource = await readFile(path.join(fixture.root, planned.statusFile));
  assert.equal(
    created.receipt.statusSha256,
    `sha256:${createHash("sha256").update(statusSource).digest("hex")}`,
  );
});

test("wave lock recovery binds every lock hash and resumes after recovery interruption", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const { create: createLockFile, recovery: recoveryLockFile } = waveLockFiles(planned);
  const createLockPath = path.join(fixture.root, createLockFile);
  const recoveryLockPath = path.join(fixture.root, recoveryLockFile);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "33333333-3333-4333-8333-333333333333",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 6262,
    createdAt: "2026-08-04T06:40:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
    }),
    /ExpectedCreateLockSha256|lock hash/i,
  );
  assert.equal(await readFile(createLockPath, "utf8"), createLockSource);

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
      expectedCreateLockSha256: createLockSha256,
      afterWaveRecoveryLockAcquired: () => {
        throw new Error("simulated recovery interruption");
      },
    }),
    /simulated recovery interruption/,
  );
  const recoveryLockSource = await readFile(recoveryLockPath, "utf8");
  const recoveryLockSha256 = `sha256:${createHash("sha256").update(recoveryLockSource).digest("hex")}`;

  const recovered = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    confirmWaveLockRecovery: true,
    expectedCreateLockSha256: createLockSha256,
    expectedRecoveryLockSha256: recoveryLockSha256,
  });
  assert.equal(recovered.status.state, "ready");
  await assert.rejects(readFile(createLockPath, "utf8"), /ENOENT|no such file/i);
  await assert.rejects(readFile(recoveryLockPath, "utf8"), /ENOENT|no such file/i);
  assert.equal(await readFile(statePath, "utf8"), before);
});

test("wave recovery refuses a replacement lock written during ownership acquisition", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY-OWNER-RACE" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const locks = waveLockFiles(planned);
  const createLockPath = path.join(fixture.root, locks.create);
  const recoveryLockPath = path.join(fixture.root, locks.recovery);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "36363636-3636-4636-8636-363636363636",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 6666,
    createdAt: "2026-08-04T06:47:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;
  const replacement = {
    schemaVersion: "1.0",
    lockId: "37373737-3737-4737-8737-373737373737",
    mode: "recovery",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 6767,
    createdAt: "2026-08-04T06:48:00.000Z",
  };
  const replacementSource = `${JSON.stringify(replacement, null, 2)}\n`;
  const additions = [];

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
      expectedCreateLockSha256: createLockSha256,
      afterWaveRecoveryLockWrite: async () => {
        await writeFile(recoveryLockPath, replacementSource, "utf8");
      },
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") additions.push(args);
        return git(fixture.root, ...args);
      },
    }),
    /recovery lock ownership has changed/i,
  );

  assert.equal(await readFile(recoveryLockPath, "utf8"), replacementSource);
  assert.equal(additions.length, 0);
});

test("wave recovery refuses a new lock that appears before its replacement write", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY-PREWRITE-RACE" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const locks = waveLockFiles(planned);
  const createLockPath = path.join(fixture.root, locks.create);
  const recoveryLockPath = path.join(fixture.root, locks.recovery);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "43434343-4343-4343-8343-434343434343",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 7373,
    createdAt: "2026-08-04T06:54:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;
  const competitor = {
    schemaVersion: "1.0",
    lockId: "44444444-4444-4444-8444-444444444444",
    mode: "recovery",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 7474,
    createdAt: "2026-08-04T06:55:00.000Z",
  };
  const competitorSource = `${JSON.stringify(competitor, null, 2)}\n`;
  const additions = [];

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
      expectedCreateLockSha256: createLockSha256,
      beforeWaveRecoveryLockWrite: async () => {
        await writeFile(recoveryLockPath, competitorSource, "utf8");
      },
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add") additions.push(args);
        return git(fixture.root, ...args);
      },
    }),
    /ExpectedRecoveryLockSha256|lock hash/i,
  );

  assert.equal(await readFile(recoveryLockPath, "utf8"), competitorSource);
  assert.equal(additions.length, 0);
});

test("concurrent recovery calls cannot both own one approved lock snapshot", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY-CONCURRENT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const createLockPath = path.join(fixture.root, waveLockFiles(planned).create);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "39393939-3939-4939-8939-393939393939",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 6969,
    createdAt: "2026-08-04T06:50:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;
  let waiting = 0;
  let releaseWriters;
  const writersMayContinue = new Promise((resolve) => { releaseWriters = resolve; });
  const beforeWrite = async () => {
    waiting += 1;
    if (waiting === 2) releaseWriters();
    await writersMayContinue;
  };
  const recover = () => runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    confirmWaveLockRecovery: true,
    expectedCreateLockSha256: createLockSha256,
    beforeWaveRecoveryLockWrite: beforeWrite,
  });

  const outcomes = await Promise.allSettled([recover(), recover()]);
  assert.equal(waiting, 2);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.match(outcomes.find((outcome) => outcome.status === "rejected").reason.message, /ownership has changed/i);
});

test("wave create never deletes a replacement lock during release", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RELEASE-FENCED" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const createLockPath = path.join(fixture.root, waveLockFiles(planned).create);
  const replacement = {
    schemaVersion: "1.0",
    lockId: "38383838-3838-4838-8838-383838383838",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 6868,
    createdAt: "2026-08-04T06:49:00.000Z",
  };
  const replacementSource = `${JSON.stringify(replacement, null, 2)}\n`;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      beforeWaveLockRelease: async () => {
        await writeFile(createLockPath, replacementSource, "utf8");
      },
    }),
    /create lock ownership has changed/i,
  );

  assert.equal(await readFile(createLockPath, "utf8"), replacementSource);
});

test("wave recovery keeps both locks when interrupted after a Git write", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY-STATUS-INTERRUPT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const locks = waveLockFiles(planned);
  const createLockPath = path.join(fixture.root, locks.create);
  const recoveryLockPath = path.join(fixture.root, locks.recovery);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "34343434-3434-4434-8434-343434343434",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 6464,
    createdAt: "2026-08-04T06:45:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
      expectedCreateLockSha256: createLockSha256,
      beforeWaveStatusWrite: () => {
        throw new Error("simulated recovery status interruption");
      },
    }),
    /simulated recovery status interruption/,
  );

  assert.equal(await readFile(createLockPath, "utf8"), createLockSource);
  await readFile(recoveryLockPath, "utf8");
});

test("wave recovery keeps locks through a receipt interruption and records recovery on retry", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY-RECEIPT-INTERRUPT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const locks = waveLockFiles(planned);
  const createLockPath = path.join(fixture.root, locks.create);
  const recoveryLockPath = path.join(fixture.root, locks.recovery);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "40404040-4040-4040-8040-404040404040",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 7070,
    createdAt: "2026-08-04T06:51:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
      expectedCreateLockSha256: createLockSha256,
      beforeWaveReceiptWrite: () => {
        throw new Error("simulated recovery receipt interruption");
      },
    }),
    /simulated recovery receipt interruption/,
  );
  assert.equal(await readFile(createLockPath, "utf8"), createLockSource);
  const recoveryLockSource = await readFile(recoveryLockPath, "utf8");
  const recoveryLockSha256 = `sha256:${createHash("sha256").update(recoveryLockSource).digest("hex")}`;

  const recovered = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    confirmWaveLockRecovery: true,
    expectedCreateLockSha256: createLockSha256,
    expectedRecoveryLockSha256: recoveryLockSha256,
  });
  assert.equal(recovered.receipt.lockRecovered, true);
});

test("wave recovery never deletes create evidence or a replacement recovery lock", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECOVERY-RELEASE-FENCED" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const locks = waveLockFiles(planned);
  const createLockPath = path.join(fixture.root, locks.create);
  const recoveryLockPath = path.join(fixture.root, locks.recovery);
  const createLock = {
    schemaVersion: "1.0",
    lockId: "41414141-4141-4141-8141-414141414141",
    mode: "create",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 7171,
    createdAt: "2026-08-04T06:52:00.000Z",
  };
  const createLockSource = `${JSON.stringify(createLock, null, 2)}\n`;
  await writeFile(createLockPath, createLockSource, "utf8");
  const createLockSha256 = `sha256:${createHash("sha256").update(createLockSource).digest("hex")}`;
  const replacement = {
    schemaVersion: "1.0",
    lockId: "42424242-4242-4242-8242-424242424242",
    mode: "recovery",
    storyId: planned.plan.storyId,
    runId: planned.plan.runId,
    wave: planned.plan.wave,
    planSha256: planned.status.wavePlanSha256,
    pid: 7272,
    createdAt: "2026-08-04T06:53:00.000Z",
  };
  const replacementSource = `${JSON.stringify(replacement, null, 2)}\n`;

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      confirmWaveLockRecovery: true,
      expectedCreateLockSha256: createLockSha256,
      beforeWaveLockRelease: async () => {
        await writeFile(recoveryLockPath, replacementSource, "utf8");
      },
    }),
    /recovery lock ownership has changed/i,
  );

  assert.equal(await readFile(createLockPath, "utf8"), createLockSource);
  assert.equal(await readFile(recoveryLockPath, "utf8"), replacementSource);
});

test("wave create preserves partial Git facts and retries only the missing task", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-PARTIAL" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  let additions = 0;
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      executeGit: async (args) => {
        if (args[0] === "worktree" && args[1] === "add" && ++additions === 2) {
          throw new Error("simulated second wave create failure");
        }
        return git(fixture.root, ...args);
      },
    }),
    /T2|second wave create failure/i,
  );
  const partial = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  assert.equal(partial.status.state, "partial");
  assert.deepEqual(partial.status.tasks.map((task) => task.state), ["created", "absent"]);

  const retriedAdds = [];
  const retried = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    executeGit: async (args) => {
      if (args[0] === "worktree" && args[1] === "add") retriedAdds.push(args);
      return git(fixture.root, ...args);
    },
  });
  assert.equal(retried.status.state, "ready");
  assert.equal(retriedAdds.length, 1);
});

test("wave create recovers when Git succeeds before the status write", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-STATUS-INTERRUPT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  let interrupted = false;
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      beforeWaveStatusWrite: () => {
        if (!interrupted) {
          interrupted = true;
          throw new Error("simulated wave status interruption");
        }
      },
    }),
    /simulated wave status interruption/,
  );

  const recovered = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
  });
  assert.equal(recovered.status.state, "ready");
});

test("wave create writes a bound receipt only after ready and repairs a receipt interruption", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-RECEIPT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const receiptPath = path.join(
    fixture.root,
    path.posix.dirname(planned.planFile),
    "creation-receipt.json",
  );
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      confirmWaveCreate: true,
      beforeWaveReceiptWrite: () => {
        throw new Error("simulated wave receipt interruption");
      },
    }),
    /simulated wave receipt interruption/,
  );
  await assert.rejects(readFile(receiptPath, "utf8"), /ENOENT|no such file/i);

  const recovered = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    now: () => "2026-08-04T07:30:00.000Z",
  });
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(recovered.receiptFile, path.posix.join(path.posix.dirname(planned.planFile), "creation-receipt.json"));
  assert.equal(receipt.planSha256, planned.status.wavePlanSha256);
  assert.equal(receipt.statusSha256, `sha256:${createHash("sha256").update(
    await readFile(path.join(fixture.root, planned.statusFile)),
  ).digest("hex")}`);
  assert.equal(receipt.lockRecovered, false);
  assert.equal(receipt.completedAt, "2026-08-04T07:30:00.000Z");
  assert.deepEqual(receipt.tasks.map((task) => task.headCommit), [
    planned.plan.baseCommit,
    planned.plan.baseCommit,
  ]);
});

test("wave status reports branch-only, partial and ready from Git facts", async () => {
  const fixture = await createFixture({ storyId: "M5-D-A-STATUS" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const [first, second] = planned.plan.tasks;

  await git(fixture.root, "branch", first.branch, planned.plan.baseCommit);
  const branchOnly = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  assert.equal(branchOnly.status.state, "partial");
  assert.deepEqual(branchOnly.status.tasks.map((task) => task.state), ["branch-only", "absent"]);

  await git(fixture.root, "worktree", "add", path.join(fixture.root, first.worktreePath), first.branch);
  const partial = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  assert.equal(partial.status.state, "partial");
  assert.deepEqual(partial.status.tasks.map((task) => task.state), ["created", "absent"]);

  await git(fixture.root, "worktree", "add", "-b", second.branch, path.join(fixture.root, second.worktreePath), planned.plan.baseCommit);
  const ready = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => "2026-07-30T05:10:00.000Z",
  });
  assert.equal(ready.status.state, "ready");
  assert.deepEqual(ready.status.tasks.map((task) => task.state), ["created", "created"]);
  assert.equal(await readFile(statePath, "utf8"), before);

  const statusPath = path.join(fixture.root, ready.statusFile);
  const stored = await readFile(statusPath, "utf8");
  const repeated = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-status",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => "2026-07-30T05:11:00.000Z",
  });
  assert.equal(repeated.status.state, "ready");
  assert.equal(repeated.status.observedAt, "2026-07-30T05:11:00.000Z");
  assert.equal(await readFile(statusPath, "utf8"), stored);
});

test("wave status rejects an unplanned registered Worktree without replacing trusted status", async () => {
  const fixture = await createFixture({ storyId: "M5-D-A-EXTRA" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const statusPath = path.join(fixture.root, planned.statusFile);
  const before = await readFile(statusPath, "utf8");
  const extraPath = path.join(fixture.root, `.harness/worktrees/${fixture.state.storyId}/wave-1/T9`);
  await git(fixture.root, "worktree", "add", "-b", "harness/m5-d-a-extra/wave-1-t9-extra", extraPath, planned.plan.baseCommit);

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-status",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
    }),
    /unplanned|unexpected|extra Worktree/i,
  );
  assert.equal(await readFile(statusPath, "utf8"), before);
});

test("PowerShell wave commands plan and inspect without requiring TaskId", async () => {
  const fixture = await createFixture({ storyId: "M5-D-A-POWERSHELL" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const runner = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const powershell = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner];
  const common = [
    "-Root", fixture.root,
    "-StateFile", fixture.stateFile,
    "-TaskDagFile", fixture.taskDagFile,
    "-WaveIndex", "1",
    "-Json",
  ];

  const planned = await execFileAsync("powershell.exe", [...powershell, "-Command", "WavePlan", ...common], { windowsHide: true });
  assert.equal(JSON.parse(planned.stdout).status.state, "absent");
  const inspected = await execFileAsync("powershell.exe", [...powershell, "-Command", "WaveStatus", ...common], { windowsHide: true });
  assert.equal(JSON.parse(inspected.stdout).status.state, "absent");
  assert.equal(await readFile(statePath, "utf8"), before);
});

test("PowerShell WaveCreate requires the approved plan hash and rejects external identity inputs", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-POWERSHELL-CREATE" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const runner = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const powershell = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner];
  const common = [
    "-Root", fixture.root,
    "-StateFile", fixture.stateFile,
    "-TaskDagFile", fixture.taskDagFile,
    "-WaveIndex", "1",
    "-ExpectedPlanSha256", planned.status.wavePlanSha256,
    "-ConfirmWaveCreate",
    "-Json",
  ];

  const created = await execFileAsync(
    "powershell.exe",
    [...powershell, "-Command", "WaveCreate", ...common],
    { windowsHide: true },
  );
  assert.equal(JSON.parse(created.stdout).status.state, "ready");

  await assert.rejects(
    execFileAsync(
      "powershell.exe",
      [...powershell, "-Command", "WaveCreate", ...common, "-BaseRef", "dev"],
      { windowsHide: true },
    ),
    /BaseRef.*not accepted|BaseRef.*拒绝/i,
  );
  await assert.rejects(
    execFileAsync(
      "powershell.exe",
      [...powershell, "-Command", "WaveCreate", ...common, "-TaskId", "T1"],
      { windowsHide: true },
    ),
    /TaskId.*not accepted|TaskId.*拒绝/i,
  );
});

test("PowerShell WaveRetire requires wave evidence and rejects external identity inputs", async () => {
  const runner = path.join(repositoryRoot, ".harness/scripts/run-worktree.ps1");
  const powershell = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner];
  const hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  const common = [
    "-Command", "WaveRetire",
    "-Root", repositoryRoot,
    "-StateFile", ".harness/states/missing-wave-retire-state.json",
    "-TaskDagFile", ".harness/runs/missing/task-dag.json",
    "-WaveIndex", "1",
    "-ExpectedWaveLedgerSha256", hash,
    "-ExpectedWaveReceiptSha256", hash,
    "-ConfirmRetire",
  ];

  await assert.rejects(
    execFileAsync("powershell.exe", [
      ...powershell,
      "-Command", "WaveRetire",
      "-Root", repositoryRoot,
      "-StateFile", ".harness/states/missing-wave-retire-state.json",
    ], { windowsHide: true }),
    /TaskDagFile/i,
  );
  await assert.rejects(
    execFileAsync("powershell.exe", [
      ...powershell,
      "-Command", "WaveRetire",
      "-Root", repositoryRoot,
      "-StateFile", ".harness/states/missing-wave-retire-state.json",
      "-TaskDagFile", ".harness/runs/missing/task-dag.json",
      "-WaveIndex", "1",
      "-ConfirmRetire",
    ], { windowsHide: true }),
    /ExpectedWaveLedgerSha256/i,
  );
  for (const forbidden of [
    ["-TaskId", "T1"],
    ["-BaseRef", "dev"],
    ["-ConfirmCreate"],
  ]) {
    await assert.rejects(
      execFileAsync("powershell.exe", [...powershell, ...common, ...forbidden], { windowsHide: true }),
      /not accepted/i,
    );
  }
});

test("wave status rejects a linked Worktree wave parent even when task paths are absent", async () => {
  const fixture = await createFixture({ storyId: "M5-D-A-LINKED-PARENT" });
  await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const external = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5da-linked-"));
  temporaryRoots.push(external);
  const waveParent = path.join(fixture.root, `.harness/worktrees/${fixture.state.storyId}/wave-1`);
  await mkdir(path.dirname(waveParent), { recursive: true });
  await symlink(external, waveParent, "junction");

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-status",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
    }),
    /real directory inside the repository/i,
  );
});

test("wave status rejects a plan that duplicates one task and omits another", async () => {
  const fixture = await createFixture({ storyId: "M5-D-A-DUPLICATE-PLAN" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const planPath = path.join(fixture.root, planned.planFile);
  const tampered = JSON.parse(await readFile(planPath, "utf8"));
  tampered.tasks[1] = structuredClone(tampered.tasks[0]);
  await writeFile(planPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  await rm(path.join(fixture.root, planned.statusFile));

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-status",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
    }),
    /does not match|duplicate|task set/i,
  );
});

test("wave plan rejects task identifiers that can escape the derived wave path", async () => {
  const fixture = await createFixture({
    storyId: "M5-D-A-UNSAFE-TASK",
    nodes: [
      {
        taskId: "../T1",
        title: "Unsafe backend task",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/main/java/Unsafe.java"],
        acceptanceCriteria: ["Unsafe identifier is rejected."],
      },
      {
        taskId: "T2",
        title: "Safe frontend task",
        type: "frontend",
        status: "pending",
        ownerAgent: "frontend-developer",
        predictedFiles: ["frontend/src/views/safe.ts"],
        acceptanceCriteria: ["Safe task remains isolated."],
      },
    ],
    waves: [["../T1", "T2"]],
  });

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-plan",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
    }),
    /Task ID must be a safe identifier/i,
  );
});

test("wave plan fails closed for unsupported phase, wave, task and base inputs", async () => {
  const wrongPhase = await createFixture({ storyId: "M5-D-A-WRONG-PHASE", phase: "unit-test" });
  await assert.rejects(
    runWorktreeCommand({
      root: wrongPhase.root,
      command: "wave-plan",
      stateFile: wrongPhase.stateFile,
      taskDagFile: wrongPhase.taskDagFile,
      waveIndex: 1,
    }),
    /implementation phase/i,
  );

  const single = await createFixture({
    storyId: "M5-D-A-SINGLE-WAVE",
    nodes: [{
      taskId: "T1",
      title: "Single backend task",
      type: "backend",
      status: "pending",
      ownerAgent: "backend-developer",
      predictedFiles: ["backend/src/main/java/Single.java"],
      acceptanceCriteria: ["Single task stays on the existing path."],
    }],
    waves: [["T1"]],
  });
  await assert.rejects(
    runWorktreeCommand({
      root: single.root,
      command: "wave-plan",
      stateFile: single.stateFile,
      taskDagFile: single.taskDagFile,
      waveIndex: 1,
    }),
    /at least two tasks/i,
  );

  const nonPending = await createFixture({ storyId: "M5-D-A-NON-PENDING" });
  nonPending.dag.nodes[0].status = "running";
  await writeFile(path.join(nonPending.root, nonPending.taskDagFile), `${JSON.stringify(nonPending.dag, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand({
      root: nonPending.root,
      command: "wave-plan",
      stateFile: nonPending.stateFile,
      taskDagFile: nonPending.taskDagFile,
      waveIndex: 1,
    }),
    /every task to be pending/i,
  );

  const unsupportedType = await createFixture({ storyId: "M5-D-A-UNSUPPORTED-TYPE" });
  unsupportedType.dag.nodes[0].type = "docs";
  await writeFile(path.join(unsupportedType.root, unsupportedType.taskDagFile), `${JSON.stringify(unsupportedType.dag, null, 2)}\n`, "utf8");
  await assert.rejects(
    runWorktreeCommand({
      root: unsupportedType.root,
      command: "wave-plan",
      stateFile: unsupportedType.stateFile,
      taskDagFile: unsupportedType.taskDagFile,
      waveIndex: 1,
    }),
    /only supports backend and frontend/i,
  );

  const mismatch = await createFixture({ storyId: "M5-D-A-MISMATCH", dagStoryId: "OTHER" });
  await assert.rejects(
    runWorktreeCommand({
      root: mismatch.root,
      command: "wave-plan",
      stateFile: mismatch.stateFile,
      taskDagFile: mismatch.taskDagFile,
      waveIndex: 1,
    }),
    /does not match the active Story/i,
  );

  const missingWave = await createFixture({ storyId: "M5-D-A-MISSING-WAVE" });
  await assert.rejects(
    runWorktreeCommand({
      root: missingWave.root,
      command: "wave-plan",
      stateFile: missingWave.stateFile,
      taskDagFile: missingWave.taskDagFile,
      waveIndex: 2,
    }),
    /does not contain wave 2/i,
  );

  const invalidBase = await createFixture({ storyId: "M5-D-A-INVALID-BASE" });
  await assert.rejects(
    runWorktreeCommand({
      root: invalidBase.root,
      command: "wave-plan",
      stateFile: invalidBase.stateFile,
      taskDagFile: invalidBase.taskDagFile,
      waveIndex: 1,
      baseRef: "missing",
    }),
    /Cannot resolve base ref 'missing'/,
  );
});

test("wave status fails closed when DAG, base, branch, path or HEAD drifts", async () => {
  const dagDrift = await createFixture({ storyId: "M5-D-A-DAG-DRIFT" });
  await runWorktreeCommand({
    root: dagDrift.root,
    command: "wave-plan",
    stateFile: dagDrift.stateFile,
    taskDagFile: dagDrift.taskDagFile,
    waveIndex: 1,
  });
  await writeFile(
    path.join(dagDrift.root, dagDrift.taskDagFile),
    `${JSON.stringify({ ...dagDrift.dag, risks: ["changed"] }, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    runWorktreeCommand({
      root: dagDrift.root,
      command: "wave-status",
      stateFile: dagDrift.stateFile,
      taskDagFile: dagDrift.taskDagFile,
      waveIndex: 1,
    }),
    /bound Task DAG has changed/i,
  );

  const baseDrift = await createFixture({ storyId: "M5-D-A-BASE-DRIFT" });
  await runWorktreeCommand({
    root: baseDrift.root,
    command: "wave-plan",
    stateFile: baseDrift.stateFile,
    taskDagFile: baseDrift.taskDagFile,
    waveIndex: 1,
  });
  await writeFile(path.join(baseDrift.root, "advance.txt"), "advance\n", "utf8");
  await git(baseDrift.root, "add", "advance.txt");
  await git(baseDrift.root, "commit", "-m", "advance dev");
  await assert.rejects(
    runWorktreeCommand({
      root: baseDrift.root,
      command: "wave-status",
      stateFile: baseDrift.stateFile,
      taskDagFile: baseDrift.taskDagFile,
      waveIndex: 1,
    }),
    /base ref 'dev' has moved/i,
  );

  const branchDrift = await createFixture({ storyId: "M5-D-A-BRANCH-DRIFT" });
  const branchPlan = await runWorktreeCommand({
    root: branchDrift.root,
    command: "wave-plan",
    stateFile: branchDrift.stateFile,
    taskDagFile: branchDrift.taskDagFile,
    waveIndex: 1,
  });
  await git(branchDrift.root, "branch", branchPlan.plan.tasks[0].branch, `${branchPlan.plan.baseCommit}^`);
  await assert.rejects(
    runWorktreeCommand({
      root: branchDrift.root,
      command: "wave-status",
      stateFile: branchDrift.stateFile,
      taskDagFile: branchDrift.taskDagFile,
      waveIndex: 1,
    }),
    /branch does not point to the planned base commit/i,
  );

  const occupied = await createFixture({ storyId: "M5-D-A-OCCUPIED" });
  const occupiedPlan = await runWorktreeCommand({
    root: occupied.root,
    command: "wave-plan",
    stateFile: occupied.stateFile,
    taskDagFile: occupied.taskDagFile,
    waveIndex: 1,
  });
  await mkdir(path.join(occupied.root, occupiedPlan.plan.tasks[0].worktreePath), { recursive: true });
  await assert.rejects(
    runWorktreeCommand({
      root: occupied.root,
      command: "wave-status",
      stateFile: occupied.stateFile,
      taskDagFile: occupied.taskDagFile,
      waveIndex: 1,
    }),
    /occupied but not registered by Git/i,
  );

  const headDrift = await createFixture({ storyId: "M5-D-A-HEAD-DRIFT" });
  const headPlan = await runWorktreeCommand({
    root: headDrift.root,
    command: "wave-plan",
    stateFile: headDrift.stateFile,
    taskDagFile: headDrift.taskDagFile,
    waveIndex: 1,
  });
  const task = headPlan.plan.tasks[0];
  const worktreePath = path.join(headDrift.root, task.worktreePath);
  await git(headDrift.root, "worktree", "add", "-b", task.branch, worktreePath, headPlan.plan.baseCommit);
  await writeFile(path.join(worktreePath, "drift.txt"), "drift\n", "utf8");
  await git(worktreePath, "add", "drift.txt");
  await git(worktreePath, "commit", "-m", "drift head");
  await assert.rejects(
    runWorktreeCommand({
      root: headDrift.root,
      command: "wave-status",
      stateFile: headDrift.stateFile,
      taskDagFile: headDrift.taskDagFile,
      waveIndex: 1,
    }),
    /branch or HEAD does not match the plan/i,
  );
});

test("wave status rejects a planned branch that is mounted at another Worktree path", async () => {
  const fixture = await createFixture({ storyId: "M5-D-A-BRANCH-MOUNT" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const task = planned.plan.tasks[0];
  const otherPath = path.join(fixture.root, ".harness/worktrees/other/T1");
  await git(fixture.root, "worktree", "add", "-b", task.branch, otherPath, planned.plan.baseCommit);

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-status",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
    }),
    /branch.*another Worktree|mounted.*another/i,
  );
});

test("wave plan sorts safe task identifiers without locale-dependent collation", async () => {
  const fixture = await createFixture({
    storyId: "M5-D-A-STABLE-SORT",
    nodes: [
      {
        taskId: "T_1",
        title: "Underscore task",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/main/java/Underscore.java"],
        acceptanceCriteria: ["Task ordering is stable."],
      },
      {
        taskId: "T.3",
        title: "Dot task",
        type: "frontend",
        status: "pending",
        ownerAgent: "frontend-developer",
        predictedFiles: ["frontend/src/views/dot.ts"],
        acceptanceCriteria: ["Task ordering is stable."],
      },
      {
        taskId: "T-2",
        title: "Dash task",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/main/java/Dash.java"],
        acceptanceCriteria: ["Task ordering is stable."],
      },
    ],
    waves: [["T_1", "T.3", "T-2"]],
  });

  const result = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  assert.deepEqual(result.plan.tasks.map((task) => task.taskId), ["T-2", "T.3", "T_1"]);
});
