import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { runWorktreeWorker } from "../lib/worktree-worker-runtime.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryRoots = [];

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
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
