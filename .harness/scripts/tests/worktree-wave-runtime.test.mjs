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
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5da-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5da@example.test");
  await git(root, "config", "user.name", "M5-D-A Test");
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");
  await git(root, "add", "seed.txt");
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
  assert.equal(repeated.status.observedAt, ready.status.observedAt);
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
