import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import {
  claimBatchTask,
  finalizeSerialBatch,
  inspectSerialBatch,
  prepareSerialBatch,
  registerBatchWorktreePlan,
  recordBatchInheritedSnapshot,
  recordBatchIntegration,
  recordBatchWorkerReady,
} from "../lib/batch-runtime.mjs";
import { validateDispatchTaskStructure } from "../lib/dispatch-contract.mjs";
import { matchesPredictedFile } from "../lib/task-dag-contract.mjs";
import { resolveBatchBase } from "../lib/worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

function node(taskId, wave, overrides = {}) {
  return {
    taskId,
    title: `Implement ${taskId}`,
    type: taskId === "T2" ? "frontend" : "backend",
    status: "pending",
    ownerAgent: taskId === "T2" ? "frontend-developer" : "backend-developer",
    predictedFiles: taskId === "T2" ? ["frontend/src/views/**"] : ["backend/src/service/**"],
    acceptanceCriteria: [`${taskId} is completed.`],
    ...overrides,
    wave,
  };
}

function dagFor(storyId, options = {}) {
  const nodes = options.nodes ?? [node("T2", 2), node("T1", 1)];
  return {
    schemaVersion: "1.0",
    storyId: options.dagStoryId ?? storyId,
    nodes: nodes.map(({ wave, ...task }) => task),
    edges: options.edges ?? [{ from: "T1", to: "T2", reason: "T2 depends on T1." }],
    waves: options.waves ?? [["T1"], ["T2"]],
    globalChanges: [],
    risks: [],
  };
}

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontierscan-m5b3-batch-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m5b3@example.test");
  await git(root, "config", "user.name", "M5-B3 Test");
  await writeFile(path.join(root, "seed.txt"), "seed\n", "utf8");
  await git(root, "add", "seed.txt");
  await git(root, "commit", "-m", "fixture");

  const storyId = options.storyId ?? "M5-B3-B-FIXTURE";
  const stateFile = ".harness/states/e2e-fixture.json";
  const taskDagFile = ".harness/runs/M5-B3-B-FIXTURE/phases/02-task-dag/task-dag.json";
  const state = {
    schemaVersion: "1.0",
    storyId,
    phase: options.phase ?? "implementation",
    runtime: {
      runId: options.runId ?? storyId,
      status: "active",
      revision: options.revision ?? 4,
    },
  };
  const dag = dagFor(storyId, options);
  await mkdir(path.join(root, path.dirname(stateFile)), { recursive: true });
  await mkdir(path.join(root, path.dirname(taskDagFile)), { recursive: true });
  await writeFile(path.join(root, stateFile), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, taskDagFile), `${JSON.stringify(dag, null, 2)}\n`, "utf8");
  const base = await resolveBatchBase({ root });
  return { root, storyId, stateFile, taskDagFile, state, dag, base, ...base };
}

async function prepare(fixture) {
  return prepareSerialBatch({
    root: fixture.root,
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    base: fixture.base,
    now: () => "2026-07-24T00:00:00.000Z",
  });
}

function inspectionOptions(fixture, batchFile) {
  return {
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile,
    now: () => "2026-07-24T00:01:00.000Z",
  };
}

const RECEIPT_SHA256 = `sha256:${"a".repeat(64)}`;

async function writeReceipt(root, relativeFile, receipt) {
  if (receipt?.outcome === "ready-for-integration" && typeof receipt.resultEvidenceFile === "string") {
    const resultPath = path.join(root, receipt.resultEvidenceFile);
    const existingResult = await readFile(resultPath, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existingResult === null) {
      const taskFile = path.join(root, path.dirname(receipt.resultEvidenceFile), "task.json");
      const task = JSON.parse(await readFile(taskFile, "utf8"));
      const result = completedTaskDispatchResult(task);
      const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, serializedResult, "utf8");
      receipt.resultSha256 = `sha256:${createHash("sha256").update(serializedResult).digest("hex")}`;
    }
  }
  const filePath = path.join(root, relativeFile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function fileSha256(root, relativeFile) {
  return `sha256:${createHash("sha256").update(await readFile(path.join(root, relativeFile))).digest("hex")}`;
}

async function writeFormalImplementationArtifacts(fixture) {
  const phaseRoot = `.harness/runs/${fixture.state.runtime.runId}/phases/03-implementation`;
  const artifacts = {
    taskFile: `${phaseRoot}/task.json`,
    resultFile: `${phaseRoot}/result.json`,
    notesFile: `${phaseRoot}/implementation-notes.md`,
  };
  await writeTextEvidence(fixture.root, artifacts.taskFile, '{"schemaVersion":"1.0"}\n');
  await writeTextEvidence(fixture.root, artifacts.resultFile, '{"schemaVersion":"1.0"}\n');
  await writeTextEvidence(fixture.root, artifacts.notesFile, "# Batch notes\n");
  return {
    ...artifacts,
    taskSha256: await fileSha256(fixture.root, artifacts.taskFile),
    resultSha256: await fileSha256(fixture.root, artifacts.resultFile),
    notesSha256: await fileSha256(fixture.root, artifacts.notesFile),
  };
}

async function writeTextEvidence(root, relativeFile, content) {
  const filePath = path.join(root, relativeFile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return fileEvidence(root, relativeFile);
}

async function fileEvidence(root, relativeFile) {
  const buffer = await readFile(path.join(root, relativeFile));
  return {
    sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
    bytes: buffer.length,
  };
}

function completedWorkerResult(ledger, task) {
  return {
    schemaVersion: "1.1",
    dispatchId: task.dispatchId,
    storyId: ledger.storyId,
    phase: "implementation",
    batchId: ledger.batchId,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    status: "completed",
    summary: `${task.taskId} completed.`,
    outputs: task.expectedOutputs.map((path) => ({ path })),
    records: [],
  };
}

function completedTaskDispatchResult(task) {
  return {
    schemaVersion: "1.1",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    batchId: task.batchId,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    status: "completed",
    summary: `${task.taskId} completed.`,
    outputs: task.expectedOutputs.map((path) => ({ path })),
    records: [],
  };
}

function executionReceipt(fixture, task, completedAt) {
  const receipt = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.state.runtime.runId,
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    phase: "implementation",
    ownerAgent: task.ownerAgent,
    baseCommit: fixture.baseCommit,
    headCommit: fixture.baseCommit,
    outcome: "ready-for-integration",
    planSha256: RECEIPT_SHA256,
    statusSha256: RECEIPT_SHA256,
    inputManifestSha256: RECEIPT_SHA256,
    resultEvidenceFile: task.resultFile,
    resultSha256: RECEIPT_SHA256,
    files: [
      { path: task.predictedFiles[0].replace("/**", "/candidate.txt"), sha256: RECEIPT_SHA256, bytes: 1, kind: task.type },
      { path: task.reportFile, sha256: RECEIPT_SHA256, bytes: 1, kind: "phase-output" },
    ],
    completedAt,
  };
  if (task.inheritedSnapshotSha256 !== null && task.inheritedSnapshotSha256 !== undefined) {
    receipt.inheritedSnapshotSha256 = task.inheritedSnapshotSha256;
  }
  return receipt;
}

function integrationReceipt(fixture, task, completedAt) {
  return {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.state.runtime.runId,
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    phase: "implementation",
    ownerAgent: task.ownerAgent,
    baseCommit: fixture.baseCommit,
    planSha256: RECEIPT_SHA256,
    resultFile: task.resultFile,
    resultSha256: RECEIPT_SHA256,
    appliedFiles: [
      { path: task.predictedFiles[0].replace("/**", "/candidate.txt"), kind: task.type, sha256: RECEIPT_SHA256, bytes: 1 },
      { path: task.reportFile, kind: "phase-output", sha256: RECEIPT_SHA256, bytes: 1 },
    ],
    completedAt,
  };
}

async function writeBoundExecutionEvidence(fixture, task, completedAt) {
  const dispatch = JSON.parse(await readFile(path.join(fixture.root, task.taskFile), "utf8"));
  await writeReceipt(fixture.root, task.resultFile, completedTaskDispatchResult(dispatch));
  const candidatePath = task.predictedFiles[0].replace("/**", "/candidate.txt");
  const candidate = await writeTextEvidence(fixture.root, candidatePath, `${task.taskId} candidate\n`);
  const report = await writeTextEvidence(fixture.root, task.reportFile, `${task.taskId} report\n`);
  const receipt = executionReceipt(fixture, task, completedAt);
  receipt.resultSha256 = await fileSha256(fixture.root, task.resultFile);
  receipt.files = [
    { path: candidatePath, sha256: candidate.sha256, bytes: candidate.bytes, kind: task.type },
    { path: task.reportFile, sha256: report.sha256, bytes: report.bytes, kind: "phase-output" },
  ];
  await writeReceipt(fixture.root, task.executionReceiptFile, receipt);
}

async function writeBoundIntegrationEvidence(fixture, ledger, task, completedAt) {
  const candidatePath = task.predictedFiles[0].replace("/**", "/candidate.txt");
  const candidate = await fileEvidence(fixture.root, candidatePath);
  const report = await fileEvidence(fixture.root, task.reportFile);
  const resultSha256 = await fileSha256(fixture.root, task.resultFile);
  const planFile = `${path.posix.dirname(task.integrationReceiptFile)}/integration-plan.json`;
  const plan = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.state.runtime.runId,
    batchId: ledger.batchId,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    dispatchId: task.dispatchId,
    phase: "implementation",
    ownerAgent: task.ownerAgent,
    baseCommit: fixture.baseCommit,
    resultFile: task.resultFile,
    executionReceiptFile: task.executionReceiptFile,
    executionReceiptSha256: task.executionReceiptSha256,
    workerResultEvidenceFile: task.resultFile,
    workerResultSha256: resultSha256,
  };
  await writeReceipt(fixture.root, planFile, plan);
  const receipt = integrationReceipt(fixture, task, completedAt);
  receipt.planSha256 = await fileSha256(fixture.root, planFile);
  receipt.resultSha256 = resultSha256;
  receipt.appliedFiles = [
    { path: candidatePath, kind: task.type, sha256: candidate.sha256, bytes: candidate.bytes },
    { path: task.reportFile, kind: "phase-output", sha256: report.sha256, bytes: report.bytes },
  ];
  await writeReceipt(fixture.root, task.integrationReceiptFile, receipt);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("prepare accepts only an active implementation batch of multiple pending backend/frontend tasks", async () => {
  const nonImplementation = await createFixture({ phase: "unit-test" });
  await assert.rejects(prepare(nonImplementation), /implementation phase/i);

  const docsTask = await createFixture({ nodes: [node("T1", 1), node("T2", 2, { type: "docs" })] });
  await assert.rejects(prepare(docsTask), /backend or frontend/i);

  const singleTask = await createFixture({ nodes: [node("T1", 1)], edges: [], waves: [["T1"]] });
  await assert.rejects(prepare(singleTask), /at least two tasks/i);

  const caseEquivalent = await createFixture({
    nodes: [node("T1", 1), node("t1", 2)],
    edges: [{ from: "T1", to: "t1", reason: "case collision" }],
    waves: [["T1"], ["t1"]],
  });
  await assert.rejects(prepare(caseEquivalent), /case-insensitive.*taskId/i);

  const nonPending = await createFixture({
    nodes: [node("T1", 1, { status: "running" }), node("T2", 2)],
  });
  await assert.rejects(prepare(nonPending), /pending/i);
});

test("serial batch ledger schema is strict and permits pending evidence fields to be null", async () => {
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas/serial-batch-ledger.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.tasks.items.additionalProperties, false);
  assert.equal(schema.properties.batchPlanSha256.type.includes("null"), true);
  assert.equal(schema.properties.tasks.items.properties.executionReceiptSha256.type.includes("null"), true);
  assert.equal(schema.properties.tasks.items.properties.type.type, "string");
  assert.equal(schema.properties.tasks.items.properties.dispatchId.type, "string");
  assert.equal(schema.properties.tasks.items.properties.expectedOutputs.type, "array");
  assert.equal(schema.properties.tasks.items.properties.inheritedSnapshotSha256.type.includes("null"), true);
});

test("batch Worktree plan schemas keep batch identity separate from task status identity", async () => {
  const planSchema = JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas/worktree-batch-plan.schema.json"), "utf8"));
  const statusSchema = JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas/worktree-batch-status.schema.json"), "utf8"));
  assert.equal(planSchema.additionalProperties, false);
  assert.equal(statusSchema.additionalProperties, false);
  assert.equal(planSchema.required.includes("batchId"), true);
  assert.equal(planSchema.required.includes("taskId"), false);
  assert.equal(statusSchema.required.includes("batchId"), true);
  assert.equal(statusSchema.required.includes("taskId"), false);
  assert.equal(statusSchema.required.includes("taskDagSha256"), true);
});

test("serial batch receipt schema preserves finalized task evidence", async () => {
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, ".harness/schemas/worktree-batch-receipt.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schemaVersion", "storyId", "runId", "phase", "batchId", "taskDagSha256", "baseCommit", "taskCount", "tasks", "finalizationArtifacts", "finalizedAt",
  ]);
  assert.equal(schema.properties.tasks.minItems, 2);
  assert.equal(schema.properties.tasks.items.additionalProperties, false);
  assert.equal(schema.properties.tasks.items.required.includes("executionReceiptSha256"), true);
  assert.equal(schema.properties.tasks.items.required.includes("integrationReceiptSha256"), true);
  assert.equal(schema.properties.finalizationArtifacts.additionalProperties, false);
  assert.deepEqual(schema.properties.finalizationArtifacts.required, [
    "taskFile", "taskSha256", "resultFile", "resultSha256", "notesFile", "notesSha256",
  ]);
});

test("batch Worktree plan evidence is registered atomically under the serial ledger lock and rejects drift", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const originalState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

  const registered = await registerBatchWorktreePlan({
    root: fixture.root,
    stateFile: fixture.stateFile,
    now: () => "2026-07-24T00:01:00.000Z",
  });

  assert.equal(registered.reused, false);
  assert.equal(registered.plan.batchId, prepared.ledger.batchId);
  assert.equal(registered.plan.branch, `harness/${fixture.storyId.toLowerCase()}/batch-${prepared.ledger.batchId}`);
  assert.equal(registered.plan.worktreePath, `.harness/worktrees/${fixture.storyId}/batch-${prepared.ledger.batchId}`);
  assert.equal(registered.ledger.batchPlanSha256, `sha256:${createHash("sha256").update(await readFile(path.join(fixture.root, registered.planFile))).digest("hex")}`);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), originalState);

  const repeated = await registerBatchWorktreePlan({ root: fixture.root, stateFile: fixture.stateFile });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.ledger.batchPlanSha256, registered.ledger.batchPlanSha256);

  const planPath = path.join(fixture.root, registered.planFile);
  const tampered = JSON.parse(await readFile(planPath, "utf8"));
  tampered.branch = "harness/tampered";
  await writeFile(planPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const ledgerBefore = await readFile(ledgerPath, "utf8");
  await assert.rejects(
    registerBatchWorktreePlan({ root: fixture.root, stateFile: fixture.stateFile }),
    /batch Worktree plan hash drifted|batch Worktree plan/i,
  );
  assert.equal(await readFile(ledgerPath, "utf8"), ledgerBefore);
});

test("prepare pins a supplied base and writes a deterministic ledger with fixed task reports", async () => {
  const fixture = await createFixture();
  const originalState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const prepared = await prepare(fixture);
  assert.equal(prepared.ledger.status, "prepared");
  assert.deepEqual(prepared.ledger.tasks.map((task) => task.taskId), ["T1", "T2"]);
  assert.equal(prepared.ledger.tasks[0].taskRoot, ".harness/runs/M5-B3-B-FIXTURE/phases/03-implementation/tasks/T1");
  assert.equal(prepared.ledger.tasks[0].reportFile, ".harness/runs/M5-B3-B-FIXTURE/phases/03-implementation/tasks/T1/task-report.md");
  assert.equal(prepared.ledger.tasks[0].taskFile, ".harness/runs/M5-B3-B-FIXTURE/phases/03-implementation/tasks/T1/task.json");
  assert.equal(prepared.ledger.tasks[0].resultFile, ".harness/runs/M5-B3-B-FIXTURE/phases/03-implementation/tasks/T1/result.json");
  assert.equal(prepared.ledger.tasks[0].checkpointFile, ".harness/runs/M5-B3-B-FIXTURE/phases/03-implementation/tasks/T1/checkpoint.json");
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), originalState);
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.root, prepared.batchFile), "utf8")), prepared.ledger);

  const repeated = await prepare(fixture);
  assert.equal(repeated.reused, true);
  assert.deepEqual(repeated.ledger, prepared.ledger);
});

test("prepare materializes one valid v1.1 dispatch for every ledger task", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);

  for (const task of prepared.ledger.tasks) {
    const dispatch = JSON.parse(await readFile(path.join(fixture.root, task.taskFile), "utf8"));
    assert.equal(validateDispatchTaskStructure(dispatch), dispatch);
    assert.deepEqual(dispatch, {
      schemaVersion: "1.1",
      dispatchId: task.dispatchId,
      storyId: fixture.storyId,
      phase: "implementation",
      batchId: prepared.ledger.batchId,
      taskId: task.taskId,
      taskRoot: task.taskRoot,
      ownerAgent: task.ownerAgent,
      purpose: task.title,
      preparedRevision: fixture.state.runtime.revision,
      preparedAt: prepared.ledger.preparedAt,
      expectedOutputs: [task.reportFile],
      allowedAdapters: [],
      next: "unit-test",
    });
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.root, task.checkpointFile), "utf8")), {
      schemaVersion: "1.0",
      dispatchId: task.dispatchId,
      storyId: fixture.storyId,
      phase: "implementation",
      status: "prepared",
      preparedAt: prepared.ledger.preparedAt,
      updatedAt: prepared.ledger.preparedAt,
    });
  }
});

test("prepare rejects a raw or unverified batch base before creating a ledger", async () => {
  const fixture = await createFixture();
  for (const base of [undefined, null, {}, { baseRef: "dev", baseCommit: fixture.baseCommit }]) {
    await assert.rejects(
      prepareSerialBatch({
        root: fixture.root,
        stateFile: fixture.stateFile,
        taskDagFile: fixture.taskDagFile,
        base,
      }),
      /verified batch base/i,
    );
  }
});

test("prepare rejects a verified batch base from a different repository root", async () => {
  const source = await createFixture({ storyId: "M5-B3-B-SOURCE" });
  const target = await createFixture({ storyId: "M5-B3-B-TARGET" });

  await assert.rejects(
    prepareSerialBatch({
      root: target.root,
      stateFile: target.stateFile,
      taskDagFile: target.taskDagFile,
      base: source.base,
    }),
    /different repository root/i,
  );
});

test("ledger detects DAG drift before changing its task state", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const before = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");
  await assert.rejects(
    prepareSerialBatch({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      base: Object.freeze({ baseRef: fixture.baseRef, baseCommit: "b".repeat(40) }),
    }),
    /verified batch base/i,
  );
  fixture.dag.nodes[0].title = "Changed after preparation";
  await writeFile(path.join(fixture.root, fixture.taskDagFile), `${JSON.stringify(fixture.dag, null, 2)}\n`, "utf8");
  await assert.rejects(inspectSerialBatch(inspectionOptions(fixture, prepared.batchFile)), /Task DAG.*changed/i);
  assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), before);
});

test("prepare rejects a second Task DAG for the same active run and implementation phase", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const ledgerBefore = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");
  const firstDispatch = await readFile(path.join(fixture.root, prepared.ledger.tasks[0].taskFile), "utf8");
  fixture.dag.nodes[0].title = "Changed after first batch preparation";
  await writeFile(path.join(fixture.root, fixture.taskDagFile), `${JSON.stringify(fixture.dag, null, 2)}\n`, "utf8");

  await assert.rejects(prepare(fixture), /Task DAG|serial batch ledger/i);

  assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), ledgerBefore);
  assert.equal(await readFile(path.join(fixture.root, prepared.ledger.tasks[0].taskFile), "utf8"), firstDispatch);
  const batches = await readdir(path.join(fixture.root, ".harness/runs", fixture.state.runtime.runId, "batches"));
  assert.equal(batches.length, 1);
});

test("prepare rejects an existing run-phase batch after state revision or state file drift", async () => {
  const fixture = await createFixture();
  await prepare(fixture);
  fixture.state.runtime.revision += 1;
  await writeFile(path.join(fixture.root, fixture.stateFile), `${JSON.stringify(fixture.state, null, 2)}\n`, "utf8");
  await assert.rejects(prepare(fixture), /serial batch ledger/i);

  fixture.state.runtime.revision -= 1;
  const alternateStateFile = ".harness/states/e2e-alternate.json";
  await writeFile(path.join(fixture.root, alternateStateFile), `${JSON.stringify(fixture.state, null, 2)}\n`, "utf8");
  await assert.rejects(
    prepareSerialBatch({
      root: fixture.root,
      stateFile: alternateStateFile,
      taskDagFile: fixture.taskDagFile,
      base: fixture.base,
    }),
    /serial batch ledger/i,
  );
});

test("prepare fails closed while the run and implementation preparation lock exists", async () => {
  const fixture = await createFixture();
  const lockPath = path.join(
    fixture.root,
    ".harness/runs",
    fixture.state.runtime.runId,
    "phases",
    "03-implementation",
    "batch-preparation.lock",
  );
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx");
  await lock.close();

  await assert.rejects(prepare(fixture), /preparation lock already exists/i);
  await assert.rejects(readFile(path.join(fixture.root, ".harness/runs", fixture.state.runtime.runId, "batches")), /ENOENT/);
});

test("lock metadata failure removes the newly acquired lock so preparation can retry", async () => {
  const fixture = await createFixture();
  let clockCalls = 0;
  await assert.rejects(
    prepareSerialBatch({
      root: fixture.root,
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      base: fixture.base,
      now: () => {
        clockCalls += 1;
        if (clockCalls === 2) throw new Error("simulated lock metadata failure");
        return "2026-07-24T00:00:00.000Z";
      },
    }),
    /simulated lock metadata failure/i,
  );

  const retried = await prepare(fixture);
  assert.equal(retried.reused, false);
});

test("a run-phase preparation lock prevents inspection and claiming without changing the ledger", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const before = await readFile(ledgerPath, "utf8");
  const lockPath = path.join(
    fixture.root,
    ".harness/runs",
    fixture.state.runtime.runId,
    "phases",
    "03-implementation",
    "batch-preparation.lock",
  );
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx");
  await lock.close();

  await assert.rejects(inspectSerialBatch(inspectionOptions(fixture, prepared.batchFile)), /preparation lock already exists/i);
  await assert.rejects(
    claimBatchTask({ ...inspectionOptions(fixture, prepared.batchFile), taskId: "T1" }),
    /preparation lock already exists/i,
  );
  assert.equal(await readFile(ledgerPath, "utf8"), before);
});

test("ledger rejects a tampered derived batch evidence path", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.batchPlanFile = "outside/worktree-plan.json";
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  await assert.rejects(
    inspectSerialBatch(inspectionOptions(fixture, prepared.batchFile)),
    /derived batch evidence paths/i,
  );
});

test("ledger rejects a finalized batch without verified integration receipts", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const options = inspectionOptions(fixture, prepared.batchFile);
  const firstTask = prepared.ledger.tasks[0];
  await claimBatchTask({ ...options, taskId: firstTask.taskId });
  const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: firstTask.taskId, inheritedFiles: [] });
  await writeReceipt(fixture.root, firstTask.executionReceiptFile, executionReceipt(fixture, snapshot.task, "2026-07-24T00:02:00.000Z"));
  const ready = await recordBatchWorkerReady({
    ...options,
    taskId: firstTask.taskId,
    executionReceiptFile: firstTask.executionReceiptFile,
  });
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.status = "finalized";
  ledger.finalizedAt = "2026-07-24T00:03:00.000Z";
  for (const [index, task] of ledger.tasks.entries()) {
    task.status = "integrated";
    task.startedAt = "2026-07-24T00:01:00.000Z";
    task.workerReadyAt = "2026-07-24T00:02:00.000Z";
    task.integratedAt = "2026-07-24T00:03:00.000Z";
    task.inheritedSnapshotSha256 = index === 0 ? ready.task.inheritedSnapshotSha256 : RECEIPT_SHA256;
    task.executionReceiptSha256 = index === 0 ? ready.task.executionReceiptSha256 : RECEIPT_SHA256;
    task.integrationReceiptSha256 = RECEIPT_SHA256;
  }
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  await assert.rejects(
    inspectSerialBatch(inspectionOptions(fixture, prepared.batchFile)),
    /integration receipt/i,
  );
});

test("receipt transitions are serial, evidence-bound, and finalize a complete batch", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const originalState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  let ledger = prepared.ledger;

  for (const task of ledger.tasks) {
    await claimBatchTask({ ...inspectionOptions(fixture, prepared.batchFile), taskId: task.taskId });
    const snapshot = await recordBatchInheritedSnapshot({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
    });
    await writeBoundExecutionEvidence(fixture, snapshot.task, "2026-07-24T00:04:00.000Z");
    const workerReady = await recordBatchWorkerReady({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
      executionReceiptFile: task.executionReceiptFile,
    });
    assert.equal(workerReady.task.status, "ready-for-integration");
    const workerRetry = await recordBatchWorkerReady({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
      executionReceiptFile: task.executionReceiptFile,
    });
    assert.equal(workerRetry.reused, true);
    await writeBoundIntegrationEvidence(fixture, workerReady.ledger, workerReady.task, "2026-07-24T00:05:00.000Z");
    const integrated = await recordBatchIntegration({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
      integrationReceiptFile: task.integrationReceiptFile,
    });
    assert.equal(integrated.task.status, "integrated");
    const integrationRetry = await recordBatchIntegration({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
      integrationReceiptFile: task.integrationReceiptFile,
    });
    assert.equal(integrationRetry.reused, true);
    ledger = integrated.ledger;
  }

  assert.equal(ledger.status, "ready-for-finalization");
  const formalArtifacts = await writeFormalImplementationArtifacts(fixture);
  const ledgerBeforeFinalization = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");
  await assert.rejects(
    finalizeSerialBatch({
      ...inspectionOptions(fixture, prepared.batchFile),
      testHooks: {
        afterReceiptPersistedBeforeLedgerFinalize: async () => {
          throw new Error("injected receipt-to-ledger interruption");
        },
      },
    }),
    /injected receipt-to-ledger interruption/i,
  );
  const receiptBeforeLedgerFinalize = await readFile(path.join(fixture.root, prepared.ledger.batchReceiptFile), "utf8");
  assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), ledgerBeforeFinalization);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, prepared.batchFile), "utf8")).status, "ready-for-finalization");
  const finalized = await finalizeSerialBatch(inspectionOptions(fixture, prepared.batchFile));
  assert.equal(finalized.ledger.status, "finalized");
  assert.ok(finalized.ledger.batchReceiptSha256);
  const receipt = JSON.parse(await readFile(path.join(fixture.root, finalized.ledger.batchReceiptFile), "utf8"));
  assert.equal(receipt.batchId, finalized.ledger.batchId);
  assert.equal(receipt.taskCount, 2);
  assert.deepEqual(receipt.finalizationArtifacts, formalArtifacts);
  assert.equal(await readFile(path.join(fixture.root, finalized.ledger.batchReceiptFile), "utf8"), receiptBeforeLedgerFinalize);
  assert.equal(
    finalized.ledger.batchReceiptSha256,
    `sha256:${createHash("sha256").update(await readFile(path.join(fixture.root, finalized.ledger.batchReceiptFile))).digest("hex")}`,
  );
  const finalizedRetry = await finalizeSerialBatch(inspectionOptions(fixture, prepared.batchFile));
  assert.equal(finalizedRetry.reused, true);
  await writeFile(path.join(fixture.root, finalized.ledger.batchReceiptFile), "{}\n", "utf8");
  await assert.rejects(finalizeSerialBatch(inspectionOptions(fixture, prepared.batchFile)), /batch receipt hash drifted/i);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), originalState);
});

test("worker receipt identity drift leaves a claimed task running", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const task = prepared.ledger.tasks[0];
  const options = inspectionOptions(fixture, prepared.batchFile);
  await claimBatchTask({ ...options, taskId: task.taskId });
  const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: task.taskId });
  const receipt = executionReceipt(fixture, snapshot.task, "2026-07-24T00:04:00.000Z");
  receipt.ownerAgent = "different-agent";
  await writeReceipt(fixture.root, task.executionReceiptFile, receipt);
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const before = await readFile(ledgerPath, "utf8");

  await assert.rejects(
    recordBatchWorkerReady({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
      executionReceiptFile: task.executionReceiptFile,
    }),
    /execution receipt.*identity|execution receipt.*match/i,
  );
  assert.equal(await readFile(ledgerPath, "utf8"), before);
});

for (const invalidResult of [
  {
    label: "identity",
    mutate: (result) => { result.batchId = "different-batch"; },
    expectedError: /Worker result.*identity|Worker result.*task/i,
  },
  {
    label: "status",
    mutate: (result) => { result.status = "failed"; },
    expectedError: /Worker result.*completed/i,
  },
  {
    label: "output set",
    mutate: (result) => { result.outputs = []; },
    expectedError: /Worker result.*output/i,
  },
]) {
  test(`worker-ready rejects an execution receipt whose formal result has invalid ${invalidResult.label}`, async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture);
    const task = prepared.ledger.tasks[0];
    const options = inspectionOptions(fixture, prepared.batchFile);
    await claimBatchTask({ ...options, taskId: task.taskId });
    const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: task.taskId });
    const result = completedWorkerResult(snapshot.ledger, snapshot.task);
    invalidResult.mutate(result);
    await writeReceipt(fixture.root, task.resultFile, result);
    const receipt = executionReceipt(fixture, snapshot.task, "2026-07-24T00:04:00.000Z");
    receipt.resultSha256 = await fileSha256(fixture.root, task.resultFile);
    await writeReceipt(fixture.root, task.executionReceiptFile, receipt);
    const before = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");

    await assert.rejects(
      recordBatchWorkerReady({ ...options, taskId: task.taskId, executionReceiptFile: task.executionReceiptFile }),
      invalidResult.expectedError,
    );
    assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), before);
  });
}

test("worker-ready requires the fixed task report in a completed execution receipt", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const task = prepared.ledger.tasks[0];
  const options = inspectionOptions(fixture, prepared.batchFile);
  await claimBatchTask({ ...options, taskId: task.taskId });
  const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: task.taskId });
  const result = completedWorkerResult(snapshot.ledger, snapshot.task);
  await writeReceipt(fixture.root, task.resultFile, result);
  const receipt = executionReceipt(fixture, snapshot.task, "2026-07-24T00:04:00.000Z");
  receipt.resultSha256 = await fileSha256(fixture.root, task.resultFile);
  receipt.files = receipt.files.filter((file) => file.kind !== "phase-output");
  await writeReceipt(fixture.root, task.executionReceiptFile, receipt);
  const before = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");

  await assert.rejects(
    recordBatchWorkerReady({ ...options, taskId: task.taskId, executionReceiptFile: task.executionReceiptFile }),
    /fixed task report|expected output/i,
  );
  assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), before);
});

test("worker receipt rejects a non-business candidate even when the Task DAG also predicts it", async () => {
  const fixture = await createFixture();
  fixture.dag.nodes.find((node) => node.taskId === "T1").predictedFiles.push(".harness/unrelated-candidate.txt");
  await writeFile(path.join(fixture.root, fixture.taskDagFile), `${JSON.stringify(fixture.dag, null, 2)}\n`, "utf8");
  const prepared = await prepare(fixture);
  const task = prepared.ledger.tasks[0];
  const options = inspectionOptions(fixture, prepared.batchFile);
  await claimBatchTask({ ...options, taskId: task.taskId });
  const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: task.taskId });
  const receipt = executionReceipt(fixture, snapshot.task, "2026-07-24T00:04:00.000Z");
  receipt.files[0].path = ".harness/unrelated-candidate.txt";
  await writeReceipt(fixture.root, task.executionReceiptFile, receipt);

  await assert.rejects(
    recordBatchWorkerReady({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: task.taskId,
      executionReceiptFile: task.executionReceiptFile,
    }),
    /business source area|candidate.*capability/i,
  );
});

test("integration rejects a valid later-task receipt before its predecessor is integrated", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const laterTask = ledger.tasks.find((task) => task.taskId === "T2");
  laterTask.inheritedSnapshotSha256 = RECEIPT_SHA256;
  await writeReceipt(fixture.root, laterTask.executionReceiptFile, executionReceipt(fixture, laterTask, "2026-07-24T00:04:00.000Z"));
  laterTask.status = "ready-for-integration";
  laterTask.startedAt = "2026-07-24T00:03:00.000Z";
  laterTask.workerReadyAt = "2026-07-24T00:04:00.000Z";
  laterTask.executionReceiptSha256 = `sha256:${createHash("sha256").update(await readFile(path.join(fixture.root, laterTask.executionReceiptFile))).digest("hex")}`;
  ledger.status = "active";
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await writeReceipt(fixture.root, laterTask.integrationReceiptFile, integrationReceipt(fixture, laterTask, "2026-07-24T00:05:00.000Z"));

  await assert.rejects(
    recordBatchIntegration({
      ...inspectionOptions(fixture, prepared.batchFile),
      taskId: laterTask.taskId,
      integrationReceiptFile: laterTask.integrationReceiptFile,
    }),
    /predecessors.*integrated|serial task order/i,
  );
});

test("claim rejects a missing or tampered task dispatch without changing the ledger", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const ledgerPath = path.join(fixture.root, prepared.batchFile);
  const before = await readFile(ledgerPath, "utf8");
  const taskFile = path.join(fixture.root, prepared.ledger.tasks[0].taskFile);
  await writeFile(taskFile, `${JSON.stringify({ schemaVersion: "1.1" }, null, 2)}\n`, "utf8");

  await assert.rejects(
    claimBatchTask({ ...inspectionOptions(fixture, prepared.batchFile), taskId: "T1" }),
    /task dispatch.*match/i,
  );
  assert.equal(await readFile(ledgerPath, "utf8"), before);
});

test("claim permits only the deterministic next pending task and reuses its running retry", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const originalState = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
  const options = inspectionOptions(fixture, prepared.batchFile);
  await assert.rejects(claimBatchTask({ ...options, taskId: "T2" }), /next pending task/i);

  const lockPath = path.join(fixture.root, prepared.ledger.lockFile);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx");
  await lock.close();
  await assert.rejects(claimBatchTask({ ...options, taskId: "T1" }), /lock already exists/i);
  await rm(lockPath);

  const claimed = await claimBatchTask({ ...options, taskId: "T1" });
  assert.equal(claimed.task.status, "running");
  const retried = await claimBatchTask({ ...options, taskId: "T1" });
  assert.equal(retried.reused, true);
  assert.equal(retried.task.status, "running");
  await assert.rejects(claimBatchTask({ ...options, taskId: "T2" }), /next pending task|predecessors/i);
  assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), originalState);
});

test("only a claimed task can record one immutable inherited snapshot", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const options = inspectionOptions(fixture, prepared.batchFile);
  const task = prepared.ledger.tasks[0];

  await assert.rejects(
    recordBatchInheritedSnapshot({ ...options, taskId: task.taskId, inheritedFiles: [] }),
    /running task/i,
  );

  await claimBatchTask({ ...options, taskId: task.taskId });
  const recorded = await recordBatchInheritedSnapshot({
    ...options,
    taskId: task.taskId,
    inheritedFiles: [],
  });
  assert.equal(recorded.reused, false);
  assert.match(recorded.task.inheritedSnapshotSha256, /^sha256:[a-f0-9]{64}$/);
  const snapshot = JSON.parse(await readFile(path.join(fixture.root, task.inheritedSnapshotFile), "utf8"));
  assert.equal(snapshot.taskId, task.taskId);
  assert.deepEqual(snapshot.inheritedFiles, []);
  assert.deepEqual(snapshot.predecessorIntegrationReceipts, []);

  const reused = await recordBatchInheritedSnapshot({
    ...options,
    taskId: task.taskId,
    inheritedFiles: [],
  });
  assert.equal(reused.reused, true);

  await assert.rejects(
    recordBatchInheritedSnapshot({
      ...options,
      taskId: task.taskId,
      inheritedFiles: [{ path: "backend/src/service/Changed.java", sha256: RECEIPT_SHA256, bytes: 1, kind: "backend" }],
    }),
    /snapshot.*match|inherited.*match/i,
  );
});

test("worker-ready requires an immutable inherited snapshot bound to its execution receipt", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const task = prepared.ledger.tasks[0];
  const options = inspectionOptions(fixture, prepared.batchFile);
  await claimBatchTask({ ...options, taskId: task.taskId });
  await writeReceipt(fixture.root, task.executionReceiptFile, executionReceipt(fixture, task, "2026-07-24T00:04:00.000Z"));
  const before = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");

  await assert.rejects(
    recordBatchWorkerReady({ ...options, taskId: task.taskId, executionReceiptFile: task.executionReceiptFile }),
    /inherited snapshot/i,
  );
  assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), before);
});

test("ledger evidence rejects a tampered immutable inherited snapshot", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const task = prepared.ledger.tasks[0];
  const options = inspectionOptions(fixture, prepared.batchFile);
  await claimBatchTask({ ...options, taskId: task.taskId });
  const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: task.taskId, inheritedFiles: [] });
  const receipt = executionReceipt(fixture, snapshot.task, "2026-07-24T00:04:00.000Z");
  await writeReceipt(fixture.root, task.executionReceiptFile, receipt);
  await recordBatchWorkerReady({ ...options, taskId: task.taskId, executionReceiptFile: task.executionReceiptFile });

  const snapshotPath = path.join(fixture.root, task.inheritedSnapshotFile);
  const tampered = JSON.parse(await readFile(snapshotPath, "utf8"));
  tampered.inheritedFiles = [{
    path: "backend/src/service/Tampered.java",
    sha256: RECEIPT_SHA256,
    bytes: 1,
    kind: "backend",
  }];
  await writeFile(snapshotPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

  await assert.rejects(inspectSerialBatch(options), /inherited snapshot/i);
});

test("claim rejects a later task until every predecessor is integrated", async () => {
  const fixture = await createFixture();
  const prepared = await prepare(fixture);
  const options = inspectionOptions(fixture, prepared.batchFile);
  const task = prepared.ledger.tasks[0];
  await claimBatchTask({ ...options, taskId: task.taskId });
  const snapshot = await recordBatchInheritedSnapshot({ ...options, taskId: task.taskId });
  await writeReceipt(fixture.root, task.executionReceiptFile, executionReceipt(fixture, snapshot.task, "2026-07-24T00:02:00.000Z"));
  await recordBatchWorkerReady({
    ...options,
    taskId: task.taskId,
    executionReceiptFile: task.executionReceiptFile,
  });

  await assert.rejects(
    claimBatchTask({ ...options, taskId: "T2" }),
    /predecessors.*integrated/i,
  );
});

test("predicted path matching is Windows case-insensitive and only supports exact paths or trailing ranges", () => {
  assert.equal(matchesPredictedFile("backend/src/Service.java", "BACKEND\\SRC\\service.java"), true);
  assert.equal(matchesPredictedFile("frontend/src/views/**", "FRONTEND/src/views/Sites.vue"), true);
  assert.equal(matchesPredictedFile("frontend/src/views/**", "frontend/src/views"), false);
  assert.equal(matchesPredictedFile("frontend/src/views/**", "frontend/src/api/sites.ts"), false);
  assert.equal(matchesPredictedFile("backend/src/Service.java", "backend/src/Service.java/child"), false);
  assert.throws(() => matchesPredictedFile("frontend/**/*.vue", "frontend/src/View.vue"), /trailing '\/\*\*'/i);
});
