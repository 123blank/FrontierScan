import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  claimBatchTask,
  recordBatchInheritedSnapshot,
  recordBatchIntegration,
  recordBatchWorkerReady,
} from "../lib/batch-runtime.mjs";
import {
  validateDispatchResultStructure,
  validateDispatchTaskStructure,
} from "../lib/dispatch-contract.mjs";
import { runStateCommand } from "../lib/state-runtime.mjs";
import { phaseOutputs, runStoryCommand } from "../lib/story-runtime.mjs";
import { runE2ECommand } from "../lib/e2e-runtime.mjs";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";
import { prepareOwnedManifest } from "../lib/delivery-runtime.mjs";
import { computeAreaSourceFingerprint } from "../lib/source-fingerprint.mjs";
import { checkKnowledgeArea as materializeKnowledgeArea } from "../lib/knowledge-runtime.mjs";

const FIXED_NOW = "2026-07-16T00:00:00.000Z";
const FIXED_DISPATCH_ID = "00000000-0000-4000-8000-000000000001";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

async function runStoryPowerShell(root, argumentsList) {
  return execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.join(REPOSITORY_ROOT, ".harness/scripts/run-story.ps1"),
    ...argumentsList,
  ], { cwd: root, windowsHide: true });
}

async function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function testContentId(prefix, value) {
  return `${prefix}-${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
    .slice(0, 32)}`;
}

function testReworkUsesVersionedPhaseOutputs() {
  const reworkId = "00000000-0000-4000-8000-200000000000";
  const state = {
    runtime: {
      reworks: [{
        reworkId,
        supersededDispatchIds: ["00000000-0000-4000-8000-000000000004"],
      }],
      records: [{
        type: "phase-result",
        phase: "implementation",
        status: "applied",
        dispatchId: "00000000-0000-4000-8000-000000000004",
      }],
    },
  };
  const phaseRoot = ".harness/runs/M7-D-REWORK/phases/03-implementation";
  assert.deepEqual(
    phaseOutputs(process.cwd(), {
      id: "implementation",
      required_outputs: [`${phaseRoot}/implementation-notes.md`],
    }, phaseRoot, state),
    [`${phaseRoot}/implementation-notes.rework-${reworkId}.md`],
  );
}

async function writeKnowledgeArtifact(root, directory, prefix, idField, body) {
  const id = testContentId(prefix, body);
  const value = { ...body, [idField]: id };
  const relativePath = `${directory}/${id}.json`;
  await write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
  return {
    value,
    relativePath,
    sha256: `sha256:${createHash("sha256")
      .update(await readFile(path.join(root, relativePath)))
      .digest("hex")}`,
  };
}

async function createFixture(storyId = "M3-PREP", fixtureParent = os.tmpdir()) {
  const root = await mkdtemp(path.join(fixtureParent, "frontier-story-runtime-"));
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "story-runtime@example.test");
  await git(root, "config", "user.name", "Story Runtime Test");
  await write(root, "seed.txt", "seed\n");
  await git(root, "add", "seed.txt");
  await git(root, "commit", "-m", "seed");
  const template = {
    schemaVersion: "1.0",
    storyId: "S1",
    phase: "requirement",
    requirement: { summary: "", openQuestions: [], acceptanceCriteria: [] },
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
  await write(root, ".harness/states/e2e-state.template.json", `${JSON.stringify(template, null, 2)}\n`);
  await write(
    root,
    ".harness/states/e2e-state-v2.template.json",
    await readFile(path.join(REPOSITORY_ROOT, ".harness/states/e2e-state-v2.template.json"), "utf8"),
  );
  await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: requirement
    order: 0
    owner_agent: requirement-analyst
    purpose: Clarify the story.
    required_outputs:
      - .harness/runs/{runId}/phases/00-requirement/requirement-breakdown.md
    next:
      - technical-design
  - id: technical-design
    order: 1
    owner_agent: requirement-analyst
    purpose: Design the change.
    required_outputs:
      - .harness/runs/{runId}/phases/01-technical-design/technical-design.md
    next:
      - unit-test
  - id: unit-test
    order: 4
    owner_agent: unit-tester
    purpose: Run tests.
    required_outputs:
      - .harness/runs/{runId}/phases/04-unit-test/test-report.md
    next:
      - code-review
  - id: code-review
    order: 5
    owner_agent: code-reviewer
    purpose: Review changes.
    required_outputs:
      - .harness/runs/{runId}/phases/05-code-review/code-review-report.md
    next:
      - build-publish
  - id: build-publish
    order: 6
    owner_agent: publisher
    purpose: Build without publishing.
    required_outputs:
      - .harness/runs/{runId}/phases/06-build-publish/build-report.md
    next:
      - interface-verification
  - id: interface-verification
    order: 7
    owner_agent: interface-verifier
    purpose: Verify interfaces.
    required_outputs:
      - .harness/runs/{runId}/phases/07-interface-verification/interface-verification-report.md
    next:
      - done
quality_gates:
  - phase: unit-test
    rule: Failed tests block.
  - phase: code-review
    rule: BLOCKER findings block.
`);
  await git(root, "add", ".harness");
  await git(root, "commit", "-m", "add harness fixtures");
  await runStateCommand({ root, command: "init", storyId, summary: "M3 fixture", now: () => FIXED_NOW });
  return { root, storyId };
}

function storyOptions(root, extra = {}) {
  return {
    root,
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_DISPATCH_ID,
    ...extra,
  };
}

async function setFixtureState(root, storyId, transform) {
  const relativePath = `.harness/states/e2e-${storyId}.json`;
  const state = await readJson(root, relativePath);
  transform(state);
  await write(root, relativePath, `${JSON.stringify(state, null, 2)}\n`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitForSignal(promise, label) {
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 2_000);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

async function createBatchPrepareFixture(storyId = "M3-BATCH-PREPARE") {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-story-runtime-v1-batch-"));
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m3-batch@example.test");
  await git(root, "config", "user.name", "M3 Batch Test");
  await write(root, "seed.txt", "seed\n");
  await git(root, "add", "seed.txt");
  await git(root, "commit", "-m", "seed");
  await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
state_file: .harness/states/e2e-state.template.json
phases:
  - id: implementation
    order: 3
    owner_agent: backend-developer
    purpose: Implement changes.
    required_outputs:
      - .harness/runs/{runId}/phases/03-implementation/implementation-notes.md
    next:
      - unit-test
  - id: unit-test
    order: 4
    owner_agent: unit-tester
    purpose: Run tests.
    required_outputs:
      - .harness/runs/{runId}/phases/04-unit-test/test-report.md
    next:
      - done
quality_gates: []
`);
  const stateFile = `.harness/states/e2e-${storyId}.json`;
  await write(root, stateFile, `${JSON.stringify({
    schemaVersion: "1.0",
    storyId,
    phase: "implementation",
    requirement: { summary: "M3 batch fixture", openQuestions: [], acceptanceCriteria: [] },
    knowledge: { loadedFiles: [], staleFiles: [], missingAreas: [] },
    tasks: [],
    dag: { nodes: [], edges: [], waves: [] },
    worktrees: [],
    tests: { commands: [], results: [] },
    review: { findings: [], status: "pending" },
    verification: { cases: [], results: [] },
    delivery: { ownedFiles: [], commit: null, pr: null },
    logs: [],
    runtime: {
      runId: storyId,
      workflow: ".harness/workflows/e2e-development.yaml",
      status: "active",
      revision: 1,
      previousPhase: null,
      blocked: null,
      records: [],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    },
  }, null, 2)}\n`);
  await write(root, ".harness/states/active-run.json", `${JSON.stringify({
    schemaVersion: "1.0",
    runId: storyId,
    stateFile,
    status: "active",
    revision: 1,
    updatedAt: FIXED_NOW,
  }, null, 2)}\n`);
  const taskDagFile = `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`;
  await write(root, taskDagFile, `${JSON.stringify({
    schemaVersion: "1.0",
    storyId,
    nodes: [
      {
        taskId: "T1",
        title: "Implement backend candidate",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/T1.java"],
        acceptanceCriteria: ["Backend candidate is ready."],
      },
      {
        taskId: "T2",
        title: "Implement frontend candidate",
        type: "frontend",
        status: "pending",
        ownerAgent: "frontend-developer",
        predictedFiles: ["frontend/src/T2.ts"],
        acceptanceCriteria: ["Frontend candidate is ready."],
      },
    ],
    edges: [{ from: "T1", to: "T2", reason: "T2 follows T1." }],
    waves: [["T1"], ["T2"]],
    globalChanges: [],
    risks: [],
  }, null, 2)}\n`);
  return {
    root,
    storyId,
    stateFile,
    taskDagFile,
  };
}

async function createWavePrepareFixture(storyId = "M3-WAVE-PREPARE", { createWorktrees = true } = {}) {
  const fixture = await createBatchPrepareFixture(storyId);
  const dag = await readJson(fixture.root, fixture.taskDagFile);
  dag.edges = [];
  dag.waves = [["T1", "T2"]];
  await write(fixture.root, fixture.taskDagFile, `${JSON.stringify(dag, null, 2)}\n`);
  await git(fixture.root, "add", ".");
  await git(fixture.root, "commit", "-m", "wave fixture");
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    now: () => FIXED_NOW,
  });
  if (!createWorktrees) return { ...fixture, planned, created: null };
  const created = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    now: () => FIXED_NOW,
  });
  assert.equal(created.status.state, "ready");
  return { ...fixture, planned, created };
}

function waveTaskFixture(overrides = {}) {
  const taskRoot = ".harness/runs/M5-D-C1-FIXTURE/waves/wave-0123456789abcdef/tasks/T1";
  return {
    schemaVersion: "1.2",
    dispatchId: FIXED_DISPATCH_ID,
    storyId: "M5-D-C1-FIXTURE",
    runId: "M5-D-C1-FIXTURE",
    phase: "implementation",
    waveId: "wave-0123456789abcdef",
    waveIndex: 1,
    taskId: "T1",
    taskRoot,
    ownerAgent: "backend-developer",
    purpose: "Implement backend candidate",
    preparedRevision: 7,
    preparedAt: FIXED_NOW,
    expectedOutputs: [`${taskRoot}/report.md`],
    allowedAdapters: [],
    next: "unit-test",
    ...overrides,
  };
}

async function testDispatchV12RequiresRuntimeDerivedWaveIdentity() {
  const task = waveTaskFixture();
  assert.doesNotThrow(() => validateDispatchTaskStructure(task));

  for (const field of ["runId", "waveId", "waveIndex", "taskId", "taskRoot"]) {
    const invalid = structuredClone(task);
    delete invalid[field];
    assert.throws(() => validateDispatchTaskStructure(invalid), new RegExp(field, "i"));
  }
  assert.throws(
    () => validateDispatchTaskStructure({ ...task, batchId: "batch-forbidden" }),
    /unsupported field|batchId/i,
  );
}

async function testDispatchResultV12RequiresWaveScopedEvidence() {
  const task = waveTaskFixture();
  const result = {
    schemaVersion: "1.2",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    waveId: task.waveId,
    waveIndex: task.waveIndex,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    status: "completed",
    summary: "Candidate is ready.",
    outputs: [{ path: `${task.taskRoot}/report.md` }],
    records: [{
      type: "note",
      status: "recorded",
      path: `${task.taskRoot}/evidence/note.json`,
      message: "Wave task completed.",
    }],
  };
  assert.doesNotThrow(() => validateDispatchResultStructure(result));
  assert.throws(
    () => validateDispatchResultStructure({ ...result, batchId: "batch-forbidden" }),
    /unsupported field|batchId/i,
  );
  assert.throws(
    () => validateDispatchResultStructure({
      ...result,
      outputs: [{ path: ".harness/runs/M5-D-C1-FIXTURE/outside.md" }],
    }),
    /taskRoot/i,
  );
}

async function testPrepareWaveCreatesRuntimeDerivedDispatchesWithoutAdvancingState() {
  const fixture = await createWavePrepareFixture();
  try {
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    let dispatchSequence = 1;
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-wave",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      randomUUID: () => `00000000-0000-4000-8000-${String(dispatchSequence++).padStart(12, "0")}`,
    }));

    assert.equal(prepared.command, "prepare-wave");
    assert.match(prepared.waveId, /^wave-[a-f0-9]{16}$/);
    assert.deepEqual(prepared.tasks.map((item) => item.task.taskId), ["T1", "T2"]);
    assert.equal(prepared.ledger.status, "prepared");
    assert.deepEqual(prepared.ledger.tasks.map((item) => item.status), ["pending", "pending"]);
    assert.equal((await readJson(fixture.root, prepared.ledgerFile)).waveId, prepared.waveId);
    for (const item of prepared.tasks) {
      assert.equal(item.task.schemaVersion, "1.2");
      validateDispatchTaskStructure(item.task);
      assert.equal((await readJson(fixture.root, item.taskFile)).dispatchId, item.task.dispatchId);
      assert.equal((await readJson(fixture.root, item.checkpointFile)).status, "prepared");
    }
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    for (const name of ["task.json", "result.json", "checkpoint.json"]) {
      await assert.rejects(access(path.join(fixture.root, phaseRoot, name)), (error) => error?.code === "ENOENT");
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPrepareWaveRejectsCoordinatedStoredStatusAndReceiptDrift() {
  const fixture = await createWavePrepareFixture("M3-WAVE-STATUS-DRIFT");
  try {
    const storedStatus = await readJson(fixture.root, fixture.planned.statusFile);
    storedStatus.state = "partial";
    storedStatus.tasks[0].state = "absent";
    storedStatus.tasks[0].headCommit = null;
    await write(fixture.root, fixture.planned.statusFile, `${JSON.stringify(storedStatus, null, 2)}\n`);
    const receiptFile = `${path.posix.dirname(fixture.planned.planFile)}/creation-receipt.json`;
    const receipt = await readJson(fixture.root, receiptFile);
    receipt.statusSha256 = await batchFileSha256(fixture.root, fixture.planned.statusFile);
    await write(fixture.root, receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "prepare-wave",
        stateFile: fixture.stateFile,
        taskDagFile: fixture.taskDagFile,
        waveIndex: 1,
      })),
      /stored.*status|creation receipt|ready/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPrepareWaveRejectsUnsupportedScopeAndCallerIdentity() {
  const multiWave = await createBatchPrepareFixture("M3-WAVE-MULTIPLE");
  try {
    await assert.rejects(
      runStoryCommand(storyOptions(multiWave.root, {
        command: "prepare-wave",
        stateFile: multiWave.stateFile,
        taskDagFile: multiWave.taskDagFile,
        waveIndex: 1,
      })),
      /one complete|only wave|dependency-free/i,
    );
  } finally {
    await rm(multiWave.root, { recursive: true, force: true });
  }

  const conflicting = await createBatchPrepareFixture("M3-WAVE-CONFLICT");
  try {
    const dag = await readJson(conflicting.root, conflicting.taskDagFile);
    dag.edges = [];
    dag.waves = [["T1", "T2"]];
    dag.nodes[0].predictedFiles = ["backend/src/Feature"];
    dag.nodes[1].predictedFiles = ["BACKEND/src/feature/Child.java"];
    await write(conflicting.root, conflicting.taskDagFile, `${JSON.stringify(dag, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(conflicting.root, {
        command: "prepare-wave",
        stateFile: conflicting.stateFile,
        taskDagFile: conflicting.taskDagFile,
        waveIndex: 1,
      })),
      /predictedFiles conflict/i,
    );
  } finally {
    await rm(conflicting.root, { recursive: true, force: true });
  }

  const uncreated = await createWavePrepareFixture(
    "M3-WAVE-NOT-CREATED",
    { createWorktrees: false },
  );
  try {
    await assert.rejects(
      runStoryCommand(storyOptions(uncreated.root, {
        command: "prepare-wave",
        stateFile: uncreated.stateFile,
        taskDagFile: uncreated.taskDagFile,
        waveIndex: 1,
      })),
      /Worktree.*created|common base|ready/i,
    );
  } finally {
    await rm(uncreated.root, { recursive: true, force: true });
  }

  const owned = await createWavePrepareFixture("M3-WAVE-OWNER-CONFLICT");
  try {
    await runStoryCommand(storyOptions(owned.root, {
      command: "prepare",
      stateFile: owned.stateFile,
    }));
    await assert.rejects(
      runStoryCommand(storyOptions(owned.root, {
        command: "prepare-wave",
        stateFile: owned.stateFile,
        taskDagFile: owned.taskDagFile,
        waveIndex: 1,
      })),
      /ordinary.*implementation phase|implementation owner/i,
    );
    await assert.rejects(
      runStoryCommand(storyOptions(owned.root, {
        command: "prepare-wave",
        stateFile: owned.stateFile,
        taskDagFile: owned.taskDagFile,
        waveIndex: 1,
        waveId: "wave-injected",
      })),
      /caller-provided waveId/i,
    );
  } finally {
    await rm(owned.root, { recursive: true, force: true });
  }
}

async function testImplementationOwnerPreventsPreparationModeOverlap() {
  const fixture = await createBatchPrepareFixture("M3-IMPLEMENTATION-OWNER");
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const ownerFile = `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`;
    await write(fixture.root, ownerFile, `${JSON.stringify({
      schemaVersion: "1.0",
      storyId: fixture.storyId,
      runId: state.runtime.runId,
      phase: "implementation",
      mode: "worktree-wave",
      ownerId: "wave-0123456789abcdef",
      preparedRevision: state.runtime.revision,
      taskDagFile: fixture.taskDagFile,
      taskDagSha256: await batchFileSha256(fixture.root, fixture.taskDagFile),
      acquiredAt: FIXED_NOW,
    }, null, 2)}\n`);

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "prepare",
        stateFile: fixture.stateFile,
      })),
      /implementation owner|worktree-wave/i,
    );
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "prepare-batch",
        stateFile: fixture.stateFile,
        taskDagFile: fixture.taskDagFile,
      })),
      /implementation owner|worktree-wave/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testOrdinaryPrepareAcquiresImplementationOwner() {
  const fixture = await createBatchPrepareFixture("M3-ORDINARY-OWNER");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare",
      stateFile: fixture.stateFile,
    }));
    const state = await readJson(fixture.root, fixture.stateFile);
    const ownerFile = `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`;
    assert.deepEqual(await readJson(fixture.root, ownerFile), {
      schemaVersion: "1.0",
      storyId: fixture.storyId,
      runId: state.runtime.runId,
      phase: "implementation",
      mode: "ordinary",
      ownerId: prepared.task.dispatchId,
      preparedRevision: state.runtime.revision,
      taskDagFile: fixture.taskDagFile,
      taskDagSha256: await batchFileSha256(fixture.root, fixture.taskDagFile),
      acquiredAt: FIXED_NOW,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testOrdinaryApplyRejectsImplementationOwnerIdentityDrift() {
  const fixture = await createBatchPrepareFixture("M3-ORDINARY-OWNER-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare",
      stateFile: fixture.stateFile,
    }));
    await write(fixture.root, prepared.task.expectedOutputs[0], "# Ordinary implementation\n");
    await writePreparedResult(fixture.root, prepared, dispatchResult(prepared.task));
    const ownerFile = `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`;
    const owner = await readJson(fixture.root, ownerFile);
    owner.ownerId = "00000000-0000-4000-8000-000000000099";
    await write(fixture.root, ownerFile, `${JSON.stringify(owner, null, 2)}\n`);
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const checkpointBefore = await readFile(path.join(fixture.root, prepared.checkpointFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
      })),
      /implementation owner|owner.*identity/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    assert.equal(await readFile(path.join(fixture.root, prepared.checkpointFile), "utf8"), checkpointBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testImplementationOwnerRejectsTaskDagPathDriftWithMatchingContent() {
  const fixture = await createBatchPrepareFixture("M3-OWNER-DAG-PATH-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare",
      stateFile: fixture.stateFile,
    }));
    await write(fixture.root, prepared.task.expectedOutputs[0], "# Ordinary implementation\n");
    await writePreparedResult(fixture.root, prepared, dispatchResult(prepared.task));
    const copiedTaskDagFile = `.harness/runs/${fixture.storyId}/phases/02-task-dag/copied-task-dag.json`;
    await write(
      fixture.root,
      copiedTaskDagFile,
      await readFile(path.join(fixture.root, fixture.taskDagFile), "utf8"),
    );
    const ownerFile = `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`;
    const owner = await readJson(fixture.root, ownerFile);
    owner.taskDagFile = copiedTaskDagFile;
    await write(fixture.root, ownerFile, `${JSON.stringify(owner, null, 2)}\n`);

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
      })),
      /implementation owner|task dag.*path|identity/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBatchPrepareAcquiresImplementationOwner() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-OWNER");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    const state = await readJson(fixture.root, fixture.stateFile);
    const ownerFile = `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`;
    assert.deepEqual(await readJson(fixture.root, ownerFile), {
      schemaVersion: "1.0",
      storyId: fixture.storyId,
      runId: state.runtime.runId,
      phase: "implementation",
      mode: "serial-batch",
      ownerId: prepared.ledger.batchId,
      preparedRevision: state.runtime.revision,
      taskDagFile: fixture.taskDagFile,
      taskDagSha256: await batchFileSha256(fixture.root, fixture.taskDagFile),
      acquiredAt: FIXED_NOW,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testLegacyWaveLedgerPreventsOrdinaryOwnerInference() {
  const fixture = await createBatchPrepareFixture("M3-LEGACY-WAVE-OWNER");
  try {
    await write(
      fixture.root,
      `.harness/runs/${fixture.storyId}/waves/wave-1/execution-ledger.json`,
      "{}\n",
    );
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "prepare",
        stateFile: fixture.stateFile,
      })),
      /worktree-wave|wave.*owner/i,
    );
    await assert.rejects(
      access(path.join(
        fixture.root,
        `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`,
      )),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPrepareBatchCreatesTaskScopedDispatchesWithoutPhaseRootArtifacts() {
  const fixture = await createBatchPrepareFixture();
  try {
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    assert.equal(prepared.command, "prepare-batch");
    assert.equal(prepared.ledger.tasks.length, 2);
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    for (const name of ["task.json", "result.json", "checkpoint.json"]) {
      await assert.rejects(access(path.join(fixture.root, phaseRoot, name)), (error) => error?.code === "ENOENT");
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBatchPreparationOwnsImplementationBeforeResolvingBase() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-PREPARATION-RACE");
  let releaseBaseResolution;
  let signalBaseResolution;
  const baseResolutionPaused = new Promise((resolve) => {
    signalBaseResolution = resolve;
  });
  const continueBaseResolution = new Promise((resolve) => {
    releaseBaseResolution = resolve;
  });
  let pauseOnce = true;
  try {
    const batchPreparation = runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      executeGit: async (args) => {
        if (pauseOnce) {
          pauseOnce = false;
          signalBaseResolution();
          await continueBaseResolution;
        }
        return execFileAsync("git", args, { cwd: fixture.root, windowsHide: true, shell: false });
      },
    }));
    await baseResolutionPaused;

    let ordinaryError = null;
    try {
      await runStoryCommand(storyOptions(fixture.root, {
        command: "prepare",
        stateFile: fixture.stateFile,
      }));
    } catch (error) {
      ordinaryError = error;
    }
    releaseBaseResolution();
    const prepared = await batchPreparation;

    assert.ok(ordinaryError, "Ordinary prepare must not run while batch preparation owns implementation.");
    assert.match(String(ordinaryError.message), /batch preparation lock/i);
    assert.equal(prepared.ledger.tasks.length, 2);
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    for (const name of ["task.json", "result.json", "checkpoint.json"]) {
      await assert.rejects(access(path.join(fixture.root, phaseRoot, name)), (error) => error?.code === "ENOENT");
    }
  } finally {
    releaseBaseResolution?.();
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBatchCliArgumentsAndPowerShellEntryPointAreRegistered() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-CLI");
  try {
    const prepared = JSON.parse((await runStoryPowerShell(fixture.root, [
      "-Command", "prepare-batch",
      "-Root", fixture.root,
      "-StateFile", fixture.stateFile,
      "-TaskDagFile", fixture.taskDagFile,
      "-Json",
    ])).stdout);
    assert.equal(prepared.command, "prepare-batch");
    assert.equal(prepared.ledger.tasks.length, 2);

    await readyFixtureBatch(fixture, prepared);
    const finalized = JSON.parse((await runStoryPowerShell(fixture.root, [
      "-Command", "finalize-batch",
      "-Root", fixture.root,
      "-StateFile", fixture.stateFile,
      "-BatchFile", prepared.batchFile,
      "-Json",
    ])).stdout);
    assert.equal(finalized.command, "finalize-batch");
    assert.equal(finalized.status, "ready-for-apply");
    assert.equal((await readJson(fixture.root, prepared.batchFile)).status, "finalized");
    await readJson(fixture.root, finalized.receiptFile);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }

  const invalidBase = await createBatchPrepareFixture("M3-BATCH-CLI-BASE");
  try {
    const script = path.join(REPOSITORY_ROOT, ".harness/scripts/lib/story-runtime.mjs");
    await assert.rejects(
      execFileAsync(process.execPath, [
        script,
        "prepare-batch",
        "--root", invalidBase.root,
        "--state-file", invalidBase.stateFile,
        "--task-dag-file", invalidBase.taskDagFile,
        "--base-ref", "HEAD",
        "--json",
      ], { cwd: invalidBase.root, windowsHide: true }),
      (error) => /Unsupported or incomplete argument: --base-ref/.test(error?.stderr ?? ""),
    );
  } finally {
    await rm(invalidBase.root, { recursive: true, force: true });
  }
}

async function testPrepareBatchRejectsNonImplementationAndSingleNodeInputsWithoutArtifacts() {
  const wrongPhase = await createBatchPrepareFixture("M3-BATCH-WRONG-PHASE");
  try {
    await setFixtureState(wrongPhase.root, wrongPhase.storyId, (state) => {
      state.phase = "unit-test";
    });
    const stateBefore = await readFile(path.join(wrongPhase.root, wrongPhase.stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(wrongPhase.root, {
        command: "prepare-batch",
        stateFile: wrongPhase.stateFile,
        taskDagFile: wrongPhase.taskDagFile,
      })),
      /implementation/i,
    );
    assert.equal(await readFile(path.join(wrongPhase.root, wrongPhase.stateFile), "utf8"), stateBefore);
    await assert.rejects(
      access(path.join(wrongPhase.root, `.harness/runs/${wrongPhase.storyId}/batches`)),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(wrongPhase.root, { recursive: true, force: true });
  }

  const singleTask = await createBatchPrepareFixture("M3-BATCH-SINGLE-TASK");
  try {
    const dag = await readJson(singleTask.root, singleTask.taskDagFile);
    dag.nodes = [dag.nodes[0]];
    dag.edges = [];
    dag.waves = [["T1"]];
    await write(singleTask.root, singleTask.taskDagFile, `${JSON.stringify(dag, null, 2)}\n`);
    const stateBefore = await readFile(path.join(singleTask.root, singleTask.stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(singleTask.root, {
        command: "prepare-batch",
        stateFile: singleTask.stateFile,
        taskDagFile: singleTask.taskDagFile,
      })),
      /multiple|at least two/i,
    );
    assert.equal(await readFile(path.join(singleTask.root, singleTask.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(singleTask.root, { recursive: true, force: true });
  }

  const customBase = await createBatchPrepareFixture("M3-BATCH-CUSTOM-BASE");
  try {
    await assert.rejects(
      runStoryCommand(storyOptions(customBase.root, {
        command: "prepare-batch",
        stateFile: customBase.stateFile,
        taskDagFile: customBase.taskDagFile,
        baseRef: "HEAD",
      })),
      /base ref.*dev/i,
    );
  } finally {
    await rm(customBase.root, { recursive: true, force: true });
  }
}

async function testOrdinaryPrepareCannotBypassAnUnfinalizedBatch() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-PREPARE-BYPASS");
  try {
    await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "prepare", stateFile: fixture.stateFile })),
      /serial batch|batch.*final/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    for (const name of ["task.json", "result.json", "checkpoint.json", "implementation-notes.md"]) {
      await assert.rejects(access(path.join(fixture.root, phaseRoot, name)), (error) => error?.code === "ENOENT");
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPrepareBatchRejectsExistingOrdinaryImplementationArtifacts() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-REVERSE-BYPASS");
  try {
    await runStoryCommand(storyOptions(fixture.root, { command: "prepare", stateFile: fixture.stateFile }));
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "prepare-batch",
        stateFile: fixture.stateFile,
        taskDagFile: fixture.taskDagFile,
      })),
      /phase artifact|ordinary.*phase/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    await assert.rejects(
      access(path.join(fixture.root, `.harness/runs/${fixture.storyId}/batches`)),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testOrdinaryApplyCannotBypassAnUnfinalizedBatch() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-APPLY-BYPASS");
  try {
    const ordinary = await runStoryCommand(storyOptions(fixture.root, { command: "prepare", stateFile: fixture.stateFile }));
    await rm(path.join(fixture.root, ordinary.taskFile));
    await rm(path.join(fixture.root, ordinary.checkpointFile));
    await rm(path.join(
      fixture.root,
      `.harness/runs/${fixture.storyId}/phases/03-implementation/implementation-owner.json`,
    ));
    await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await write(fixture.root, ordinary.taskFile, `${JSON.stringify(ordinary.task, null, 2)}\n`);
    await write(fixture.root, ordinary.checkpointFile, `${JSON.stringify(ordinary.checkpoint, null, 2)}\n`);
    await write(fixture.root, ordinary.task.expectedOutputs[0], "# Ordinary implementation\n");
    await writePreparedResult(fixture.root, ordinary, dispatchResult(ordinary.task));

    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const checkpointBefore = await readFile(path.join(fixture.root, ordinary.checkpointFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /serial batch|batch.*final/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    assert.equal(await readFile(path.join(fixture.root, ordinary.checkpointFile), "utf8"), checkpointBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testOrdinaryM3FailsClosedOnAnInvalidBatchDirectory() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-INVALID-DIRECTORY");
  try {
    const batches = `.harness/runs/${fixture.storyId}/batches`;
    await write(fixture.root, batches, "not a directory\n");
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "prepare", stateFile: fixture.stateFile })),
      /serial batch directory/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsLedgerRevisionDriftBeforePhaseArtifacts() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-REVISION-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    await setFixtureState(fixture.root, fixture.storyId, (state) => {
      state.runtime.revision += 1;
    });

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /ledger|revision|state/i,
    );
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    await assert.rejects(access(path.join(fixture.root, phaseRoot, "task.json")), (error) => error?.code === "ENOENT");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsNonImplementationPhaseWithoutStateChange() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-FINALIZE-WRONG-PHASE");
  try {
    await setFixtureState(fixture.root, fixture.storyId, (state) => {
      state.phase = "unit-test";
    });
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: `.harness/runs/${fixture.storyId}/batches/not-a-ledger/ledger.json`,
      })),
      /active implementation/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

const RECEIPT_PLACEHOLDER_SHA256 = `sha256:${"a".repeat(64)}`;

async function batchFileSha256(root, relativePath) {
  return `sha256:${createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex")}`;
}

function batchInspectionOptions(fixture, batchFile) {
  return {
    root: fixture.root,
    stateFile: fixture.stateFile,
    batchFile,
    now: () => FIXED_NOW,
  };
}

function taskRecords(task) {
  return [
    { type: "note", status: "recorded", message: "shared batch observation", actor: "worker" },
    { type: "note", status: "recorded", message: `${task.taskId} specific observation`, actor: "worker" },
  ];
}

async function writeCompletedBatchTaskEvidence(fixture, ledger, task, records = taskRecords(task)) {
  const report = `# ${task.taskId} report\n\n${task.title}\n`;
  await write(fixture.root, task.reportFile, report);
  const result = {
    schemaVersion: "1.1",
    dispatchId: task.dispatchId,
    storyId: fixture.storyId,
    phase: "implementation",
    batchId: ledger.batchId,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    status: "completed",
    summary: `${task.taskId} completed`,
    outputs: [{ path: task.reportFile }],
    records,
  };
  await write(fixture.root, task.resultFile, `${JSON.stringify(result, null, 2)}\n`);

  const reportBytes = Buffer.byteLength(report, "utf8");
  const reportSha256 = await batchFileSha256(fixture.root, task.reportFile);
  const resultSha256 = await batchFileSha256(fixture.root, task.resultFile);
  const candidateContent = `${task.taskId}\n`;
  await write(fixture.root, task.predictedFiles[0], candidateContent);
  const candidate = {
    path: task.predictedFiles[0],
    kind: task.type,
    sha256: await batchFileSha256(fixture.root, task.predictedFiles[0]),
    bytes: Buffer.byteLength(candidateContent, "utf8"),
  };
  const reportFile = {
    path: task.reportFile,
    kind: "phase-output",
    sha256: reportSha256,
    bytes: reportBytes,
  };
  const executionReceipt = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.storyId,
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    phase: "implementation",
    ownerAgent: task.ownerAgent,
    baseCommit: ledger.baseCommit,
    headCommit: ledger.baseCommit,
    outcome: "ready-for-integration",
    planSha256: RECEIPT_PLACEHOLDER_SHA256,
    statusSha256: RECEIPT_PLACEHOLDER_SHA256,
    inputManifestSha256: RECEIPT_PLACEHOLDER_SHA256,
    inheritedSnapshotSha256: task.inheritedSnapshotSha256,
    resultEvidenceFile: task.resultFile,
    resultSha256,
    files: [candidate, reportFile],
    completedAt: FIXED_NOW,
  };
  await write(fixture.root, task.executionReceiptFile, `${JSON.stringify(executionReceipt, null, 2)}\n`);
}

async function writeCompletedBatchIntegrationEvidence(fixture, ledger, task) {
  const candidateContent = await readFile(path.join(fixture.root, task.predictedFiles[0]), "utf8");
  const report = await readFile(path.join(fixture.root, task.reportFile), "utf8");
  const resultSha256 = await batchFileSha256(fixture.root, task.resultFile);
  const planFile = `${path.posix.dirname(task.integrationReceiptFile)}/integration-plan.json`;
  const plan = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.storyId,
    batchId: ledger.batchId,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    dispatchId: task.dispatchId,
    phase: "implementation",
    ownerAgent: task.ownerAgent,
    baseCommit: ledger.baseCommit,
    resultFile: task.resultFile,
    executionReceiptFile: task.executionReceiptFile,
    executionReceiptSha256: task.executionReceiptSha256,
    workerResultEvidenceFile: task.resultFile,
    workerResultSha256: resultSha256,
  };
  await write(fixture.root, planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const integrationReceipt = {
    schemaVersion: "1.0",
    storyId: fixture.storyId,
    runId: fixture.storyId,
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    phase: "implementation",
    ownerAgent: task.ownerAgent,
    baseCommit: ledger.baseCommit,
    planSha256: await batchFileSha256(fixture.root, planFile),
    resultFile: task.resultFile,
    resultSha256,
    appliedFiles: [
      {
        path: task.predictedFiles[0],
        kind: task.type,
        sha256: await batchFileSha256(fixture.root, task.predictedFiles[0]),
        bytes: Buffer.byteLength(candidateContent, "utf8"),
      },
      {
        path: task.reportFile,
        kind: "phase-output",
        sha256: await batchFileSha256(fixture.root, task.reportFile),
        bytes: Buffer.byteLength(report, "utf8"),
      },
    ],
    completedAt: FIXED_NOW,
  };
  await write(fixture.root, task.integrationReceiptFile, `${JSON.stringify(integrationReceipt, null, 2)}\n`);
}

async function readyFixtureBatch(fixture, prepared, recordsForTask = taskRecords) {
  let ledger = prepared.ledger;
  for (const taskId of ledger.tasks.map((task) => task.taskId)) {
    const claimed = await claimBatchTask({ ...batchInspectionOptions(fixture, prepared.batchFile), taskId });
    const snapshot = await recordBatchInheritedSnapshot({
      ...batchInspectionOptions(fixture, prepared.batchFile),
      taskId,
    });
    const task = snapshot.task;
    await writeCompletedBatchTaskEvidence(fixture, snapshot.ledger, task, recordsForTask(task));
    const workerReady = await recordBatchWorkerReady({
      ...batchInspectionOptions(fixture, prepared.batchFile),
      taskId,
      executionReceiptFile: task.executionReceiptFile,
    });
    await writeCompletedBatchIntegrationEvidence(fixture, workerReady.ledger, workerReady.task);
    const integrated = await recordBatchIntegration({
      ...batchInspectionOptions(fixture, prepared.batchFile),
      taskId,
      integrationReceiptFile: task.integrationReceiptFile,
    });
    assert.equal(workerReady.task.status, "ready-for-integration");
    assert.equal(integrated.task.status, "integrated");
    ledger = integrated.ledger;
  }
  assert.equal(ledger.status, "ready-for-finalization");
  return ledger;
}

async function testFinalizeBatchMaterializesPhaseArtifactsAndLeavesStateForApply() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-FINALIZE");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);

    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const result = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    const task = await readJson(fixture.root, `${phaseRoot}/task.json`);
    const phaseResult = await readJson(fixture.root, `${phaseRoot}/result.json`);
    const checkpoint = await readJson(fixture.root, `${phaseRoot}/checkpoint.json`);
    const notes = await readFile(path.join(fixture.root, phaseRoot, "implementation-notes.md"), "utf8");
    const ledger = await readJson(fixture.root, prepared.batchFile);
    const receipt = await readJson(fixture.root, result.receiptFile);

    assert.equal(result.status, "ready-for-apply");
    assert.equal(ledger.status, "finalized");
    assert.equal(receipt.batchId, ledger.batchId);
    assert.deepEqual(receipt.finalizationArtifacts, {
      taskFile: `${phaseRoot}/task.json`,
      taskSha256: await batchFileSha256(fixture.root, `${phaseRoot}/task.json`),
      resultFile: `${phaseRoot}/result.json`,
      resultSha256: await batchFileSha256(fixture.root, `${phaseRoot}/result.json`),
      notesFile: `${phaseRoot}/implementation-notes.md`,
      notesSha256: await batchFileSha256(fixture.root, `${phaseRoot}/implementation-notes.md`),
    });
    assert.equal(task.schemaVersion, "1.0");
    assert.equal(phaseResult.schemaVersion, "1.0");
    assert.equal(checkpoint.status, "prepared");
    assert.deepEqual(checkpoint.batchFinalization, {
      schemaVersion: "1.0",
      storyId: fixture.storyId,
      runId: fixture.storyId,
      stateFile: fixture.stateFile,
      phase: "implementation",
      preparedRevision: 1,
      batchId: ledger.batchId,
      ledgerFile: prepared.batchFile,
      ledgerSha256: await batchFileSha256(fixture.root, prepared.batchFile),
      receiptFile: result.receiptFile,
      receiptSha256: await batchFileSha256(fixture.root, result.receiptFile),
      taskSha256: await batchFileSha256(fixture.root, `${phaseRoot}/task.json`),
      resultSha256: await batchFileSha256(fixture.root, `${phaseRoot}/result.json`),
      notesSha256: await batchFileSha256(fixture.root, `${phaseRoot}/implementation-notes.md`),
    });
    assert.equal(Object.hasOwn(task, "batchFinalization"), false);
    assert.equal(Object.hasOwn(phaseResult, "batchFinalization"), false);
    assert.deepEqual(phaseResult.outputs, [{ path: `${phaseRoot}/implementation-notes.md` }]);
    assert.deepEqual(phaseResult.records, [
      { type: "note", status: "recorded", message: "shared batch observation", actor: "worker" },
      { type: "note", status: "recorded", message: "T1 specific observation", actor: "worker" },
      { type: "note", status: "recorded", message: "T2 specific observation", actor: "worker" },
    ]);
    assert.match(notes, /# T1 report/);
    assert.match(notes, /# T2 report/);
    assert.match(notes, new RegExp(ledger.batchReceiptFile.replaceAll(".", "\\.")));
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
      })),
      /State v1 is read-only/i,
    );
    const stateAfterApply = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    assert.equal(stateAfterApply, stateBefore);
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /State v1 is read-only/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateAfterApply);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizedBatchReceiptDriftBlocksApplyWithoutMutation() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-RECEIPT-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const finalized = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const receipt = await readFile(path.join(fixture.root, finalized.receiptFile), "utf8");
    await write(fixture.root, finalized.receiptFile, `${receipt}\n`);
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const checkpointBefore = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /receipt.*drift|batch.*binding|finalized.*batch/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsLinkedImplementationPhaseBeforeExternalWrites() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-LINKED-PHASE");
  const external = await mkdtemp(path.join(os.tmpdir(), "frontier-story-runtime-linked-phase-"));
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const phaseRoot = path.join(fixture.root, ".harness", "runs", fixture.storyId, "phases", "03-implementation");
    await rm(phaseRoot, { recursive: true, force: true });
    await mkdir(path.dirname(phaseRoot), { recursive: true });
    await symlink(external, phaseRoot, "junction");
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /symbolic link|real directory|repository root/i,
    );

    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    for (const name of ["batch-preparation.lock", "task.json", "checkpoint.json", "implementation-notes.md", "result.json"]) {
      await assert.rejects(access(path.join(external, name)), (error) => error?.code === "ENOENT", name);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
}

async function testConcurrentFinalizeBatchRejectsOverlappingCheckpointBinding() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-CONCURRENT-FINALIZE");
  const firstLedgerFinalized = deferred();
  const releaseFirst = deferred();
  const firstAtRename = deferred();
  const releaseRename = deferred();
  let firstFinalize;
  let secondFinalize;
  const hooks = {
    afterLedgerFinalizedBeforeCheckpointBinding: async () => {
      firstLedgerFinalized.resolve();
      await releaseFirst.promise;
    },
    beforeCheckpointBindingRename: async () => {
      firstAtRename.resolve();
      await releaseRename.promise;
    },
  };
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const input = {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
      testHooks: hooks,
    };
    firstFinalize = runStoryCommand(storyOptions(fixture.root, input));
    firstFinalize.catch((error) => firstLedgerFinalized.reject(error));
    await waitForSignal(firstLedgerFinalized.promise, "the first finalized ledger");
    releaseFirst.resolve();
    await waitForSignal(firstAtRename.promise, "the first checkpoint temporary write");
    secondFinalize = runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    await assert.rejects(secondFinalize, /batch finalization lock already exists/i);
    releaseRename.resolve();

    const first = await firstFinalize;
    assert.equal(first.status, "ready-for-apply");
    const repeated = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    assert.equal(repeated.status, "ready-for-apply");
    const phaseRoot = path.join(fixture.root, ".harness", "runs", fixture.storyId, "phases", "03-implementation");
    const checkpoint = await readJson(fixture.root, `.harness/runs/${fixture.storyId}/phases/03-implementation/checkpoint.json`);
    assert.ok(checkpoint.batchFinalization);
    assert.deepEqual((await readdir(phaseRoot)).filter((entry) => entry.includes(".tmp")), []);
  } finally {
    releaseFirst.resolve();
    releaseRename.resolve();
    await Promise.allSettled([firstFinalize, secondFinalize].filter(Boolean));
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testCoordinatedResultAndCheckpointHashDriftBlocksBatchApplyWithoutMutation() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-COORDINATED-RESULT-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const finalized = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const resultFile = `.harness/runs/${fixture.storyId}/phases/03-implementation/result.json`;
    const result = await readJson(fixture.root, resultFile);
    result.summary = "tampered but still schema-valid";
    await write(fixture.root, resultFile, `${JSON.stringify(result, null, 2)}\n`);
    const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
    checkpoint.batchFinalization.resultSha256 = await batchFileSha256(fixture.root, resultFile);
    await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    const checkpointBefore = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /finalized.*batch|receipt.*artifact|batch.*binding/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBefore);
    assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "implementation");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizedV1BatchCannotMutateReadOnlyState() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-APPLY-RESUME");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
        beforeAdvance: async () => { throw new Error("simulated pre-advance interruption"); },
      })),
      /State v1 is read-only/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBatchRecoveryRejectsReceiptDriftAfterStateAdvance() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-RECOVERY-RECEIPT-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const finalized = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));

    const receipt = await readFile(path.join(fixture.root, finalized.receiptFile), "utf8");
    await write(fixture.root, finalized.receiptFile, `${receipt}\n`);
    const checkpointBeforeRetry = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /receipt.*drift|batch.*binding|finalized.*batch/i,
    );
    assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBeforeRetry);
    assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "implementation");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBatchRecoveryRejectsLedgerAndBindingDriftAfterStateAdvance() {
  const cases = [
    {
      suffix: "LEDGER",
      mutate: async (fixture, prepared) => {
        const ledger = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");
        await write(fixture.root, prepared.batchFile, `${ledger}\n`);
      },
      expected: /ledger.*drift|batch.*binding|finalized.*batch/i,
    },
    {
      suffix: "BINDING",
      mutate: async (fixture, _prepared, finalized) => {
        const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
        checkpoint.batchFinalization.batchId = "batch-mismatched";
        await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
      },
      expected: /binding|finalized.*batch/i,
    },
    {
      suffix: "MISSING-BINDING",
      mutate: async (fixture, _prepared, finalized) => {
        const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
        delete checkpoint.batchFinalization;
        await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
      },
      expected: /binding|finalized.*batch/i,
    },
    {
      suffix: "COORDINATED-RECEIPT-BINDING",
      mutate: async (fixture, _prepared, finalized) => {
        const receipt = await readFile(path.join(fixture.root, finalized.receiptFile), "utf8");
        await write(fixture.root, finalized.receiptFile, `${receipt}\n`);
        const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
        checkpoint.batchFinalization.receiptSha256 = await batchFileSha256(fixture.root, finalized.receiptFile);
        await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
      },
      expected: /receipt.*binding|receipt.*drift|finalized.*batch/i,
    },
  ];
  for (const scenario of cases) {
    const fixture = await createBatchPrepareFixture(`M3-BATCH-RECOVERY-${scenario.suffix}-DRIFT`);
    try {
      const prepared = await runStoryCommand(storyOptions(fixture.root, {
        command: "prepare-batch",
        stateFile: fixture.stateFile,
        taskDagFile: fixture.taskDagFile,
      }));
      await readyFixtureBatch(fixture, prepared);
      const finalized = await runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
      }));
      await scenario.mutate(fixture, prepared, finalized);
      const checkpointBeforeRetry = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");
      await assert.rejects(
        runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
        scenario.expected,
      );
      assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBeforeRetry);
      assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "implementation");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}

async function testBatchRecoveryRejectsCoordinatedLedgerStateFileAndBindingDriftAfterStateAdvance() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-RECOVERY-COORDINATED-LEDGER-STATE-FILE-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const finalized = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));

    const ledger = await readJson(fixture.root, prepared.batchFile);
    ledger.stateFile = ".harness/states/tampered.json";
    await write(fixture.root, prepared.batchFile, `${JSON.stringify(ledger, null, 2)}\n`);
    const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
    checkpoint.batchFinalization.ledgerSha256 = await batchFileSha256(fixture.root, prepared.batchFile);
    await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    const checkpointBeforeRetry = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");
    const stateBeforeRetry = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /state.*file|active Story|ledger.*binding|finalized.*batch/i,
    );
    assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBeforeRetry);
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBeforeRetry);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testOrdinaryImplementationRecoveryAfterStateAdvance() {
  const fixture = await createFixture("M3-ORDINARY-IMPLEMENTATION-RECOVERY");
  try {
    fixture.stateFile = `.harness/states/e2e-${fixture.storyId}.json`;
    await write(fixture.root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: implementation
    order: 3
    owner_agent: backend-developer
    purpose: Implement changes.
    required_outputs:
      - .harness/runs/{runId}/phases/03-implementation/implementation-notes.md
    next:
      - unit-test
  - id: unit-test
    order: 4
    owner_agent: unit-tester
    purpose: Run tests.
    required_outputs:
      - .harness/runs/{runId}/phases/04-unit-test/test-report.md
    next:
      - done
quality_gates: []
`);
    await setFixtureState(fixture.root, fixture.storyId, (state) => { state.phase = "implementation"; });
    await write(
      fixture.root,
      `.harness/runs/${fixture.storyId}/phases/02-task-dag/task-dag.json`,
      `${JSON.stringify({
        schemaVersion: "2.0",
        storyId: fixture.storyId,
        nodes: [{
          taskId: "T1",
          title: "Implement ordinary candidate",
          type: "backend",
          status: "pending",
          ownerAgent: "backend-developer",
          predictedFiles: ["backend/src/T1.java"],
          acceptanceCriteria: ["Ordinary candidate is ready."],
        }],
        edges: [],
        waves: [["T1"]],
        globalChanges: [],
        risks: [],
      }, null, 2)}\n`,
    );
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare",
      stateFile: fixture.stateFile,
    }));
    await write(fixture.root, prepared.task.expectedOutputs[0], "# Ordinary implementation\n");
    await writePreparedResult(fixture.root, prepared, dispatchResult(prepared.task));

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
        afterAdvance: async () => { throw new Error("simulated post-advance interruption"); },
      })),
      /post-advance interruption/i,
    );
    assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "unit-test");
    assert.equal((await readJson(fixture.root, prepared.checkpointFile)).status, "prepared");
    await assert.rejects(
      access(path.join(fixture.root, `.harness/runs/${fixture.storyId}/batches`)),
      (error) => error?.code === "ENOENT",
    );

    const resumed = await runStoryCommand(storyOptions(fixture.root, {
      command: "apply",
      stateFile: fixture.stateFile,
    }));
    assert.equal(resumed.status, "already-applied");
    assert.equal(resumed.state.phase, "unit-test");
    assert.equal((await readJson(fixture.root, prepared.checkpointFile)).status, "completed");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizedBatchRequiresAMatchingCheckpointBinding() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-BINDING");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const finalized = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
    const binding = checkpoint.batchFinalization;
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    delete checkpoint.batchFinalization;
    await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /batch.*binding/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);

    checkpoint.batchFinalization = {
      ...binding,
      batchId: "batch-mismatched",
    };
    await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /batch.*binding/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBatchApplyRejectsCoordinatedFormalArtifactAndCheckpointDrift() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-FORMAL-ARTIFACT-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const finalized = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const result = await readJson(fixture.root, finalized.resultFile);
    result.summary = "tampered formal result";
    await write(fixture.root, finalized.resultFile, `${JSON.stringify(result, null, 2)}\n`);
    const notesFile = finalized.task.expectedOutputs[0];
    const notes = await readFile(path.join(fixture.root, notesFile), "utf8");
    await write(fixture.root, notesFile, `${notes}tampered formal notes\n`);
    const checkpoint = await readJson(fixture.root, finalized.checkpointFile);
    checkpoint.batchFinalization.resultSha256 = await batchFileSha256(fixture.root, finalized.resultFile);
    checkpoint.batchFinalization.notesSha256 = await batchFileSha256(fixture.root, notesFile);
    await write(fixture.root, finalized.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /formal implementation artifact|finalized batch artifact/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsAnUnfinishedLedgerWithoutStateChange() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-UNFINISHED");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /integration receipt|finalized|complete/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsPreexistingPhaseArtifactsBeforeFinalizingLedger() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-PHASE-ARTIFACT");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    await write(fixture.root, `${phaseRoot}/task.json`, "{}\n");
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /phase artifact|existing.*phase/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);
    const ledger = await readJson(fixture.root, prepared.batchFile);
    assert.equal(ledger.status, "ready-for-finalization");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsTaskScopedEvidenceRecordsBeforeFinalizingLedger() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-TASK-RECORD");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared, (task) => ([
      {
        type: "test",
        status: "passed",
        path: task.reportFile,
        message: `${task.taskId} evidence remains task-scoped`,
        actor: "worker",
      },
    ]));
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /evidence path.*phase result/i,
    );
    const ledger = await readJson(fixture.root, prepared.batchFile);
    assert.equal(ledger.status, "ready-for-finalization");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchRejectsTaskResultAndReportHashDriftBeforeFinalization() {
  const resultFixture = await createBatchPrepareFixture("M3-BATCH-RESULT-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(resultFixture.root, {
      command: "prepare-batch",
      stateFile: resultFixture.stateFile,
      taskDagFile: resultFixture.taskDagFile,
    }));
    await readyFixtureBatch(resultFixture, prepared);
    const ledger = await readJson(resultFixture.root, prepared.batchFile);
    const result = await readJson(resultFixture.root, ledger.tasks[0].resultFile);
    result.summary = "tampered after integration";
    await write(resultFixture.root, ledger.tasks[0].resultFile, `${JSON.stringify(result, null, 2)}\n`);

    await assert.rejects(
      runStoryCommand(storyOptions(resultFixture.root, {
        command: "finalize-batch",
        stateFile: resultFixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /result hash.*(?:drifted|does not match)/i,
    );
    assert.equal((await readJson(resultFixture.root, prepared.batchFile)).status, "ready-for-finalization");
  } finally {
    await rm(resultFixture.root, { recursive: true, force: true });
  }

  const reportFixture = await createBatchPrepareFixture("M3-BATCH-REPORT-DRIFT");
  try {
    const prepared = await runStoryCommand(storyOptions(reportFixture.root, {
      command: "prepare-batch",
      stateFile: reportFixture.stateFile,
      taskDagFile: reportFixture.taskDagFile,
    }));
    await readyFixtureBatch(reportFixture, prepared);
    const ledger = await readJson(reportFixture.root, prepared.batchFile);
    await write(reportFixture.root, ledger.tasks[0].reportFile, "# tampered task report\n");

    await assert.rejects(
      runStoryCommand(storyOptions(reportFixture.root, {
        command: "finalize-batch",
        stateFile: reportFixture.stateFile,
        batchFile: prepared.batchFile,
      })),
      /(?:report hash.*drifted|applied target hash.*does not match)/i,
    );
    assert.equal((await readJson(reportFixture.root, prepared.batchFile)).status, "ready-for-finalization");
  } finally {
    await rm(reportFixture.root, { recursive: true, force: true });
  }
}

async function testFinalizeBatchReusesFinalizedLedgerBeforeApply() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-FINALIZE-RETRY");
  try {
    const prepared = await runStoryCommand(storyOptions(fixture.root, {
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }));
    await readyFixtureBatch(fixture, prepared);
    const stateBefore = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "finalize-batch",
        stateFile: fixture.stateFile,
        batchFile: prepared.batchFile,
        testHooks: {
          afterLedgerFinalizedBeforeCheckpointBinding: async () => {
            throw new Error("injected ledger-to-checkpoint interruption");
          },
        },
      })),
      /injected ledger-to-checkpoint interruption/i,
    );
    const phaseRoot = `.harness/runs/${fixture.storyId}/phases/03-implementation`;
    const ledgerBeforeRetry = await readFile(path.join(fixture.root, prepared.batchFile), "utf8");
    const ledger = JSON.parse(ledgerBeforeRetry);
    const receiptBeforeRetry = await readFile(path.join(fixture.root, ledger.batchReceiptFile), "utf8");
    const taskBeforeRetry = await readFile(path.join(fixture.root, `${phaseRoot}/task.json`), "utf8");
    const resultBeforeRetry = await readFile(path.join(fixture.root, `${phaseRoot}/result.json`), "utf8");
    const notesBeforeRetry = await readFile(path.join(fixture.root, `${phaseRoot}/implementation-notes.md`), "utf8");
    const checkpointBeforeRetry = await readJson(fixture.root, `${phaseRoot}/checkpoint.json`);
    assert.equal(ledger.status, "finalized");
    assert.equal(checkpointBeforeRetry.batchFinalization, undefined);
    assert.equal(await readFile(path.join(fixture.root, fixture.stateFile), "utf8"), stateBefore);

    const first = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    const second = await runStoryCommand(storyOptions(fixture.root, {
      command: "finalize-batch",
      stateFile: fixture.stateFile,
      batchFile: prepared.batchFile,
    }));
    assert.equal(second.status, "ready-for-apply");
    assert.equal(second.task.dispatchId, first.task.dispatchId);
    assert.equal(await readFile(path.join(fixture.root, first.resultFile), "utf8"), resultBeforeRetry);
    assert.equal(await readFile(path.join(fixture.root, prepared.batchFile), "utf8"), ledgerBeforeRetry);
    assert.equal(await readFile(path.join(fixture.root, ledger.batchReceiptFile), "utf8"), receiptBeforeRetry);
    assert.equal(await readFile(path.join(fixture.root, `${phaseRoot}/task.json`), "utf8"), taskBeforeRetry);
    assert.equal(await readFile(path.join(fixture.root, `${phaseRoot}/implementation-notes.md`), "utf8"), notesBeforeRetry);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPrepareCreatesStructuredTaskAndCheckpoint() {
  const { root, storyId } = await createFixture();
  try {
    const result = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const phaseRoot = `.harness/runs/${storyId}/phases/00-requirement`;
    const attemptRoot = `${phaseRoot}/attempts/${FIXED_DISPATCH_ID}`;
    assert.equal(result.command, "prepare");
    assert.equal(result.taskFile, `${attemptRoot}/task.json`);
    assert.equal(result.checkpointFile, `${attemptRoot}/checkpoint.json`);
    assert.equal(result.activeAttemptFile, `${phaseRoot}/active-attempt.json`);

    const task = await readJson(root, result.taskFile);
    assert.deepEqual(task, {
      schemaVersion: "2.0",
      dispatchId: FIXED_DISPATCH_ID,
      storyId,
      runId: storyId,
      phase: "requirement",
      ownerAgent: "requirement-analyst",
      purpose: "Clarify the story.",
      preparedRevision: 1,
      preparedAt: FIXED_NOW,
      resultSchemaVersion: "2.0",
      attemptRoot,
      resultFile: `${attemptRoot}/result.json`,
      checkpointFile: `${attemptRoot}/checkpoint.json`,
      expectedOutputs: [`${phaseRoot}/requirement-breakdown.md`],
      allowedAdapters: [],
      next: "technical-design",
    });
    const checkpoint = await readJson(root, result.checkpointFile);
    assert.equal(checkpoint.status, "prepared");
    assert.equal(checkpoint.dispatchId, FIXED_DISPATCH_ID);
    assert.equal(checkpoint.preparedAt, FIXED_NOW);
    assert.equal(checkpoint.updatedAt, FIXED_NOW);
    assert.equal((await readJson(root, result.activeAttemptFile)).taskFile, result.taskFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPrepareReusesCurrentPhaseTask() {
  const { root } = await createFixture();
  try {
    const first = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const second = await runStoryCommand(storyOptions(root, {
      command: "prepare",
      randomUUID: () => "00000000-0000-4000-8000-000000000002",
    }));
    assert.equal(second.task.dispatchId, first.task.dispatchId);
    assert.equal(second.reused, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStatusIsReadOnly() {
  const { root } = await createFixture();
  try {
    const result = await runStoryCommand(storyOptions(root, { command: "status" }));
    assert.equal(result.state.phase, "requirement");
    assert.equal(result.dispatch.status, "not-prepared");
    await assert.rejects(access(path.join(root, ".harness/runs")), (error) => error?.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCheckKnowledgeUsesPreparedTechnicalDesignWithoutStateMutation() {
  const { root, storyId } = await createFixture("M7-C-CHECK");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "technical-design"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const pointerFile = ".harness/states/active-run.json";
    const eventsFile = `.harness/states/e2e-${storyId}.events.jsonl`;
    const before = await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]);
    let received;
    const area = {
      area: "backend",
      relevant: true,
      observedStatus: "stale",
      status: "stale",
      sourceFingerprint: `sha256:${"a".repeat(64)}`,
      loadedFiles: [],
      missing: [],
      checkedAt: FIXED_NOW,
      freshnessEvidencePath: `${prepared.task.attemptRoot}/knowledge/checks/CHK-001.json`,
      freshnessEvidenceSha256: `sha256:${"b".repeat(64)}`,
      refreshTaskPath: `${prepared.task.attemptRoot}/knowledge/tasks/KRT-001.json`,
      refreshTaskSha256: `sha256:${"c".repeat(64)}`,
      refreshReceiptPath: null,
      refreshReceiptSha256: null,
      approvalId: null,
    };
    const checked = await runStoryCommand(storyOptions(root, {
      command: "check-knowledge",
      area: "backend",
      checkKnowledgeArea: async (options) => {
        received = options;
        return { area };
      },
    }));
    assert.equal(checked.command, "check-knowledge");
    assert.deepEqual(checked.area, area);
    assert.equal(received.task.dispatchId, prepared.task.dispatchId);
    assert.equal(received.area, "backend");
    assert.deepEqual(await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]), before);
    await assert.rejects(access(path.join(root, prepared.resultFile)), (error) => error?.code === "ENOENT");

    await setFixtureState(root, storyId, (state) => { state.phase = "requirement"; });
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "check-knowledge",
        area: "backend",
        checkKnowledgeArea: async () => ({ area }),
      })),
      /technical-design/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectReportsKnowledgeRefreshAndEvidenceDrift() {
  const { root, storyId } = await createFixture("M7-C-INSPECT");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "technical-design"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Technical design\n");
    const currentFingerprint = await computeAreaSourceFingerprint(root, "backend");
    const evidenceArtifact = await writeKnowledgeArtifact(
      root,
      `${prepared.task.attemptRoot}/knowledge/checks`,
      "CHK",
      "checkId",
      {
      schemaVersion: "1.0",
      storyId,
      runId: storyId,
      dispatchId: prepared.task.dispatchId,
      preparedRevision: prepared.task.preparedRevision,
      area: "backend",
      status: "stale",
      recordedSourceFingerprint: `sha256:${"1".repeat(64)}`,
      currentSourceFingerprint: currentFingerprint.fingerprint,
      baselineStatus: "fresh",
      semanticStatus: "pending",
      indexStatus: "fresh",
      reason: "source fingerprint mismatch",
      checkedAt: FIXED_NOW,
      },
    );
    const evidence = evidenceArtifact.value;
    const evidencePath = evidenceArtifact.relativePath;
    const evidenceSha256 = evidenceArtifact.sha256;
    const refreshTaskArtifact = await writeKnowledgeArtifact(
      root,
      `${prepared.task.attemptRoot}/knowledge/tasks`,
      "KRT",
      "refreshTaskId",
      {
      schemaVersion: "1.0",
      storyId,
      runId: storyId,
      dispatchId: prepared.task.dispatchId,
      preparedRevision: prepared.task.preparedRevision,
      area: "backend",
      parameters: { area: "backend", module: null, mode: "baseline" },
      protectedAreas: ["backend"],
      reason: "source fingerprint mismatch",
      sourcePaths: ["backend/src/main/java/com/frontierscan/article/Article.java"],
      customSnapshots: [{ area: "backend", files: [] }],
      createdAt: FIXED_NOW,
      },
    );
    const refreshTaskPath = refreshTaskArtifact.relativePath;
    const refreshTaskSha256 = refreshTaskArtifact.sha256;
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      payload: {
        decisions: [],
        affectedAreas: ["backend"],
        knowledgeSnapshot: [{
          area: "backend",
          relevant: true,
          observedStatus: "stale",
          status: "stale",
          sourceFingerprint: evidence.currentSourceFingerprint,
          loadedFiles: ["llm-knowledge/backend/meta.yaml"],
          missing: [],
          checkedAt: FIXED_NOW,
          freshnessEvidencePath: evidencePath,
          freshnessEvidenceSha256: evidenceSha256,
          refreshTaskPath,
          refreshTaskSha256,
          refreshReceiptPath: null,
          refreshReceiptSha256: null,
          approvalId: null,
        }],
        risks: [],
      },
    }));

    const inspection = await runStoryCommand(storyOptions(root, { command: "inspect" }));
    assert.equal(inspection.inspection.status, "knowledge-refresh-required");
    assert.deepEqual(inspection.inspection.knowledge.subjectIds, ["backend"]);

    const statePath = path.join(root, `.harness/states/e2e-${storyId}.json`);
    const stateBeforeDrift = await readFile(statePath, "utf8");
    await write(root, "backend/src/ChangedAfterKnowledgeCheck.java", "class ChangedAfterKnowledgeCheck {}\n");
    const sourceDrifted = await runStoryCommand(storyOptions(root, { command: "inspect" }));
    assert.equal(sourceDrifted.inspection.status, "result-invalid");
    assert.match(sourceDrifted.inspection.diagnostics.message, /source fingerprint changed/i);
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /source fingerprint changed/i,
    );
    assert.equal(await readFile(statePath, "utf8"), stateBeforeDrift);
    await rm(path.join(root, "backend"), { recursive: true, force: true });

    await write(root, evidencePath, "{}\n");
    const drifted = await runStoryCommand(storyOptions(root, { command: "inspect" }));
    assert.equal(drifted.inspection.status, "result-invalid");
    assert.match(drifted.inspection.diagnostics.message, /freshness evidence.*changed|hash/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function prepareStaleKnowledgeFixture(storyId) {
  const fixture = await createFixture(storyId);
  await setFixtureState(fixture.root, storyId, (state) => { state.phase = "technical-design"; });
  const prepared = await runStoryCommand(storyOptions(fixture.root, { command: "prepare" }));
  await write(fixture.root, prepared.task.expectedOutputs[0], "# Technical design\n");
  const currentFingerprint = await computeAreaSourceFingerprint(fixture.root, "backend");
  const evidenceArtifact = await writeKnowledgeArtifact(
    fixture.root,
    `${prepared.task.attemptRoot}/knowledge/checks`,
    "CHK",
    "checkId",
    {
    schemaVersion: "1.0",
    storyId,
    runId: storyId,
    dispatchId: prepared.task.dispatchId,
    preparedRevision: prepared.task.preparedRevision,
    area: "backend",
    status: "stale",
    recordedSourceFingerprint: `sha256:${"1".repeat(64)}`,
    currentSourceFingerprint: currentFingerprint.fingerprint,
    baselineStatus: "fresh",
    semanticStatus: "pending",
    indexStatus: "fresh",
    reason: "source fingerprint mismatch",
    checkedAt: FIXED_NOW,
    },
  );
  const evidence = evidenceArtifact.value;
  const evidencePath = evidenceArtifact.relativePath;
  const evidenceSha256 = evidenceArtifact.sha256;
  const refreshTaskArtifact = await writeKnowledgeArtifact(
    fixture.root,
    `${prepared.task.attemptRoot}/knowledge/tasks`,
    "KRT",
    "refreshTaskId",
    {
    schemaVersion: "1.0",
    storyId,
    runId: storyId,
    dispatchId: prepared.task.dispatchId,
    preparedRevision: prepared.task.preparedRevision,
    area: "backend",
    parameters: { area: "backend", module: null, mode: "baseline" },
    protectedAreas: ["backend"],
    reason: "source fingerprint mismatch",
    sourcePaths: ["backend/src/main/java/com/frontierscan/article/Article.java"],
    customSnapshots: [{ area: "backend", files: [] }],
    createdAt: FIXED_NOW,
    },
  );
  const refreshTaskPath = refreshTaskArtifact.relativePath;
  const refreshTaskSha256 = refreshTaskArtifact.sha256;
  const area = {
    area: "backend",
    relevant: true,
    observedStatus: "stale",
    status: "stale",
    sourceFingerprint: evidence.currentSourceFingerprint,
    loadedFiles: ["llm-knowledge/backend/meta.yaml"],
    missing: [],
    checkedAt: FIXED_NOW,
    freshnessEvidencePath: evidencePath,
    freshnessEvidenceSha256: evidenceSha256,
    refreshTaskPath,
    refreshTaskSha256,
    refreshReceiptPath: null,
    refreshReceiptSha256: null,
    approvalId: null,
  };
  await writePreparedResult(fixture.root, prepared, dispatchResult(prepared.task, {
    payload: {
      decisions: [],
      affectedAreas: ["backend"],
      knowledgeSnapshot: [area],
      risks: [],
    },
  }));
  return { ...fixture, prepared, area };
}

async function testRecheckKnowledgeReplacesDriftedResultArea() {
  const fixture = await prepareStaleKnowledgeFixture("M7-C-RECHECK");
  try {
    const statePath = path.join(fixture.root, `.harness/states/e2e-${fixture.storyId}.json`);
    const stateBeforeDrift = await readFile(statePath, "utf8");
    await write(fixture.root, "backend/src/ChangedAfterKnowledgeCheck.java", "class ChangedAfterKnowledgeCheck {}\n");
    const drifted = await runStoryCommand(storyOptions(fixture.root, { command: "inspect" }));
    assert.equal(drifted.inspection.status, "result-invalid");
    assert.match(drifted.inspection.diagnostics.message, /source fingerprint changed/i);

    const rechecked = await runStoryCommand(storyOptions(fixture.root, {
      command: "check-knowledge",
      area: "backend",
      checkKnowledgeArea: async (options) => {
        const current = await computeAreaSourceFingerprint(options.root, "backend");
        return materializeKnowledgeArea({
          ...options,
          runFreshness: async () => ({
            findings: [{
              area: "backend",
              status: "fresh",
              reason: "Freshness metadata matches current repository state.",
              recorded_source_fingerprint: current.fingerprint,
              current_source_fingerprint: current.fingerprint,
              baseline_status: "fresh",
              semantic_status: "fresh",
              index_status: "fresh",
            }],
            refresh_task: { changed_paths: [], targets: [] },
          }),
        });
      },
    }));
    assert.equal(rechecked.rechecked, true);
    assert.equal(rechecked.area.status, "fresh");
    assert.equal(await readFile(statePath, "utf8"), stateBeforeDrift);

    const inspection = await runStoryCommand(storyOptions(fixture.root, { command: "inspect" }));
    assert.equal(inspection.inspection.status, "result-ready");
    const applied = await runStoryCommand(storyOptions(fixture.root, { command: "apply" }));
    assert.equal(applied.state.knowledge.areas[0].status, "fresh");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testApproveStaleProjectsFormalKnowledgeApproval() {
  const fixture = await prepareStaleKnowledgeFixture("M7-C-APPROVE");
  try {
    const approved = await runStoryCommand(storyOptions(fixture.root, {
      command: "approve-stale",
      area: "backend",
      reason: "已通过源码核验，接受当前 stale 知识",
    }));
    assert.equal(approved.command, "approve-stale");
    assert.match(approved.approvalId, /^APR-[a-f0-9]{32}$/);
    const result = await readJson(fixture.root, fixture.prepared.resultFile);
    assert.equal(result.payload.knowledgeSnapshot[0].status, "accepted-stale");
    assert.equal(result.payload.knowledgeSnapshot[0].observedStatus, "stale");
    assert.equal(result.payload.knowledgeSnapshot[0].approvalId, approved.approvalId);
    const receipt = await readJson(fixture.root, approved.receiptFile);
    assert.equal(receipt.subjectType, "knowledge-stale");
    assert.equal(receipt.subjectId, "backend");
    assert.equal(receipt.actor, "user");

    const reused = await runStoryCommand(storyOptions(fixture.root, {
      command: "approve-stale",
      area: "backend",
      reason: "已通过源码核验，接受当前 stale 知识",
    }));
    assert.equal(reused.approvalId, approved.approvalId);
    assert.equal(reused.reused, true);

    const inspection = await runStoryCommand(storyOptions(fixture.root, { command: "inspect" }));
    assert.equal(inspection.inspection.status, "result-ready");
    const applied = await runStoryCommand(storyOptions(fixture.root, { command: "apply" }));
    assert.equal(applied.state.phase, "unit-test");
    assert.equal(applied.state.knowledge.areas[0].status, "accepted-stale");
    assert.equal(applied.state.approvals.length, 1);
    assert.equal(applied.state.approvals[0].approvalId, approved.approvalId);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testRefreshKnowledgeUpdatesOnlyCurrentResult() {
  const fixture = await prepareStaleKnowledgeFixture("M7-C-REFRESH-COMMAND");
  try {
    const stateFile = `.harness/states/e2e-${fixture.storyId}.json`;
    const pointerFile = ".harness/states/active-run.json";
    const eventsFile = `.harness/states/e2e-${fixture.storyId}.events.jsonl`;
    const before = await Promise.all([
      readFile(path.join(fixture.root, stateFile), "utf8"),
      readFile(path.join(fixture.root, pointerFile), "utf8"),
      readFile(path.join(fixture.root, eventsFile), "utf8"),
    ]);
    const refreshedArea = {
      ...fixture.area,
      observedStatus: "fresh",
      status: "fresh",
      checkedAt: "2026-08-14T01:00:00.000Z",
      freshnessEvidencePath: `${fixture.prepared.task.attemptRoot}/knowledge/checks/CHK-fresh.json`,
      freshnessEvidenceSha256: `sha256:${"d".repeat(64)}`,
      refreshReceiptPath: `${fixture.prepared.task.attemptRoot}/knowledge/refreshes/KRR-fresh.json`,
      refreshReceiptSha256: `sha256:${"e".repeat(64)}`,
    };
    let received;
    const refreshed = await runStoryCommand(storyOptions(fixture.root, {
      command: "refresh-knowledge",
      area: "backend",
      refreshKnowledgeArea: async (options) => {
        received = options;
        return { area: refreshedArea, reused: false };
      },
    }));
    assert.equal(refreshed.command, "refresh-knowledge");
    assert.deepEqual(refreshed.area, refreshedArea);
    assert.equal(received.area.status, "stale");
    const result = await readJson(fixture.root, fixture.prepared.resultFile);
    assert.deepEqual(result.payload.knowledgeSnapshot[0], refreshedArea);
    assert.deepEqual(await Promise.all([
      readFile(path.join(fixture.root, stateFile), "utf8"),
      readFile(path.join(fixture.root, pointerFile), "utf8"),
      readFile(path.join(fixture.root, eventsFile), "utf8"),
    ]), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testInspectReportsValidatedCurrentDispatchState() {
  const { root, storyId } = await createFixture("M7-B-INSPECT");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const before = await readFile(path.join(root, stateFile), "utf8");
    const initial = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(initial.inspection.status, "not-prepared");
    assert.equal(await readFile(path.join(root, stateFile), "utf8"), before);

    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    const awaiting = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(awaiting.inspection.status, "awaiting-result");
    assert.equal(awaiting.inspection.taskFile, prepared.taskFile);
    assert.equal(awaiting.inspection.dispatchId, prepared.task.dispatchId);

    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    const ready = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(ready.inspection.status, "result-ready");
    assert.equal(ready.inspection.resultStatus, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectTracksRequiredAdapterRuns() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-ADAPTER");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));

    const required = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(required.inspection.status, "adapter-required");
    assert.deepEqual(required.inspection.allowedAdapters, prepared.task.allowedAdapters);

    await write(root, prepared.task.expectedOutputs[0], "# Test report\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    const resultStillRequiresAdapter = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(resultStillRequiresAdapter.inspection.status, "adapter-required");

    await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      stateFile,
      adapter: "harness-state-tests",
      execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "" }),
    }));
    const ready = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(ready.inspection.status, "result-ready");

    const checkpoint = await readJson(root, prepared.checkpointFile);
    const adapterEvidence = await readJson(root, checkpoint.adapterRuns[0].evidencePath);
    adapterEvidence.stdout = "tampered";
    await write(root, checkpoint.adapterRuns[0].evidencePath, `${JSON.stringify(adapterEvidence, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "inspect", stateFile })),
      /adapter evidence.*changed|changed.*adapter evidence/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectKeepsAdapterActionWhenAnyRunFailed() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-MIXED-ADAPTER");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "run-adapter",
        stateFile,
        adapter: "harness-state-tests",
        execute: async () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
      })),
      /failed with exit code 1/i,
    );
    await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      stateFile,
      adapter: "harness-structure",
      execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "" }),
    }));

    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "adapter-required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectPrioritizesFailedResultOverAdapterRequirement() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-FAILED");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      status: "failed",
      outputs: [],
      summary: "Tests failed.",
    }));
    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "failed-result");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectPrioritizesBlockedResultOverAdapterRequirement() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-BLOCKED");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      status: "blocked",
      outputs: [],
      summary: "Test environment is unavailable.",
      blocker: {
        reason: "Test environment is unavailable.",
        owner: "user",
        suggestedAction: "Restore the test environment.",
      },
    }));
    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "result-ready");
    assert.equal(inspected.inspection.resultStatus, "blocked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectReportsAdvancedResultRecovery() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-RECOVERY");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        stateFile,
        afterAdvance: async () => { throw new Error("simulated inspection recovery window"); },
      })),
      /inspection recovery window/i,
    );

    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "recovery-required");
    assert.equal(inspected.inspection.phase, "requirement");
    assert.equal(inspected.inspection.dispatchId, prepared.task.dispatchId);
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "prepared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectPrefersCurrentAttemptOverHistoricalRecovery() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-CURRENT-ATTEMPT");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        stateFile,
        afterAdvance: async () => { throw new Error("simulated historical recovery"); },
      })),
      /historical recovery/i,
    );
    const current = await runStoryCommand(storyOptions(root, {
      command: "prepare",
      stateFile,
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    }));
    assert.equal(current.task.phase, "technical-design");

    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "awaiting-result");
    assert.equal(inspected.inspection.dispatchId, current.task.dispatchId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectRequiresApprovalForAnyAcceptedGap() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-APPROVAL");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    await setFixtureState(root, storyId, (state) => {
      state.phase = "interface-verification";
      state.requirement.acceptanceCriteria = [{
        criterionId: "AC-001",
        description: "The required behavior is verified.",
        source: "fixture",
        required: true,
      }];
      state.acceptance.criteria = [{
        criterionId: "AC-001",
        required: true,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      }];
    });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await write(root, prepared.task.expectedOutputs[0], "# Verification\n");
    const evidencePath = `${prepared.task.attemptRoot}/evidence/optional-gap.md`;
    await write(root, evidencePath, "known gap\n");
    const evidence = await readFile(path.join(root, evidencePath));
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      payload: {
        cases: [{
          caseId: "VC-OPTIONAL",
          type: "ui-flow",
          required: false,
          criterionIds: ["AC-001"],
          action: "Inspect optional UI behavior",
          expected: "The optional behavior is available.",
        }],
        results: [{
          caseId: "VC-OPTIONAL",
          status: "accepted-with-known-gaps",
          actual: "The optional environment is unavailable.",
          evidencePath,
          evidenceSha256: `sha256:${createHash("sha256").update(evidence).digest("hex")}`,
          approvalId: null,
          executedAt: FIXED_NOW,
        }],
        environment: {
          status: "unavailable",
          summary: "Optional UI environment is unavailable.",
          evidencePath: null,
          evidenceSha256: null,
        },
      },
    }));

    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "approval-required");
    assert.deepEqual(inspected.inspection.approval.subjectIds, ["VC-OPTIONAL"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInspectRejectsResultThatCannotPassPhaseGate() {
  const { root, storyId } = await createFixture("M7-B-INSPECT-PREFLIGHT");
  try {
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    await setFixtureState(root, storyId, (state) => { state.phase = "code-review"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare", stateFile }));
    await write(root, prepared.task.expectedOutputs[0], "# Review report\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      payload: { findings: [], status: "passed" },
    }));

    const inspected = await runStoryCommand(storyOptions(root, { command: "inspect", stateFile }));
    assert.equal(inspected.inspection.status, "result-invalid");
    assert.match(inspected.inspection.diagnostics.message, /code-review.*passed|passed.*review/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPrepareRejectsBlockedAndCompletedRuns() {
  const blocked = await createFixture("M3-BLOCKED");
  try {
    await runStateCommand({
      root: blocked.root,
      command: "block",
      reason: "decision",
      owner: "user",
      suggestedAction: "decide",
      now: () => FIXED_NOW,
    });
    await assert.rejects(
      runStoryCommand(storyOptions(blocked.root, { command: "prepare" })),
      /blocked/i,
    );
  } finally {
    await rm(blocked.root, { recursive: true, force: true });
  }

  const completed = await createFixture("M3-DONE");
  try {
    await setFixtureState(completed.root, completed.storyId, (state) => {
      state.phase = "done";
      state.runtime.status = "completed";
    });
    const pointer = await readJson(completed.root, ".harness/states/active-run.json");
    pointer.status = "completed";
    await write(completed.root, ".harness/states/active-run.json", `${JSON.stringify(pointer, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(completed.root, { command: "prepare" })),
      /completed|done/i,
    );
  } finally {
    await rm(completed.root, { recursive: true, force: true });
  }
}

async function testPrepareFailsClosedOnDamagedExistingTask() {
  const { root } = await createFixture();
  try {
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.taskFile, "{invalid");
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "prepare" })),
      /task.*JSON|JSON.*task/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPrepareRejectsTaskOrCheckpointContractMismatch() {
  const taskFixture = await createFixture("M3-BAD-TASK");
  try {
    const prepared = await runStoryCommand(storyOptions(taskFixture.root, { command: "prepare" }));
    const task = await readJson(taskFixture.root, prepared.taskFile);
    task.expectedOutputs = [];
    await write(taskFixture.root, prepared.taskFile, `${JSON.stringify(task, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(taskFixture.root, { command: "prepare" })),
      /workflow contract|expectedOutputs/i,
    );
  } finally {
    await rm(taskFixture.root, { recursive: true, force: true });
  }

  const checkpointFixture = await createFixture("M3-BAD-CHECKPOINT");
  try {
    const prepared = await runStoryCommand(storyOptions(checkpointFixture.root, { command: "prepare" }));
    const checkpoint = await readJson(checkpointFixture.root, prepared.checkpointFile);
    checkpoint.dispatchId = "00000000-0000-4000-8000-000000000099";
    await write(checkpointFixture.root, prepared.checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(checkpointFixture.root, { command: "prepare" })),
      /checkpoint.*task/i,
    );
  } finally {
    await rm(checkpointFixture.root, { recursive: true, force: true });
  }
}

async function testPrepareRejectsNormalizedOutputOutsidePhaseDirectory() {
  const { root } = await createFixture("M3-TRAVERSAL");
  try {
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: requirement
    order: 0
    owner_agent: requirement-analyst
    purpose: Clarify the story.
    required_outputs:
      - .harness/runs/{runId}/phases/00-requirement/../../escaped.md
    next:
      - technical-design
  - id: technical-design
    order: 1
    owner_agent: requirement-analyst
    purpose: Design the change.
    required_outputs:
      - .harness/runs/{runId}/phases/01-technical-design/technical-design.md
    next:
      - done
quality_gates: []
`);
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "prepare" })),
      /current phase directory/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRunAdapterUsesFixedArgvAndRecordsPassedTest() {
  const { root, storyId } = await createFixture("M3-ADAPTER-PASS");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const stateBefore = await readFile(path.join(root, `.harness/states/e2e-${storyId}.json`), "utf8");
    let invocation = null;
    const result = await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      adapter: "harness-structure",
      execute: async (specification) => {
        invocation = specification;
        return { exitCode: 0, stdout: "structure passed", stderr: "" };
      },
    }));

    assert.equal(result.status, "passed");
    assert.equal(invocation.executable, "powershell.exe");
    assert.equal(invocation.options.shell, false);
    assert.deepEqual(invocation.args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
    const evidence = await readJson(root, result.evidencePath);
    assert.equal(evidence.adapter, "harness-structure");
    assert.equal(evidence.phase, "unit-test");
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.stdout, "structure passed");
    assert.equal(evidence.executable, "powershell.exe");
    assert.deepEqual(evidence.args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
    assert.equal(evidence.cwd, root.replaceAll("\\", "/"));
    assert.equal(evidence.startedAt, FIXED_NOW);
    assert.equal(evidence.finishedAt, FIXED_NOW);

    assert.equal(
      await readFile(path.join(root, `.harness/states/e2e-${storyId}.json`), "utf8"),
      stateBefore,
    );
    const checkpoint = await readJson(root, prepared.checkpointFile);
    assert.equal(checkpoint.adapterRuns.at(-1).status, "passed");
    assert.equal(checkpoint.adapterRuns.at(-1).evidencePath, result.evidencePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRunAdapterRejectsUnknownOrWrongPhaseAdapter() {
  const unknown = await createFixture("M3-ADAPTER-UNKNOWN");
  try {
    await setFixtureState(unknown.root, unknown.storyId, (state) => { state.phase = "unit-test"; });
    await runStoryCommand(storyOptions(unknown.root, { command: "prepare" }));
    let executed = false;
    await assert.rejects(
      runStoryCommand(storyOptions(unknown.root, {
        command: "run-adapter",
        adapter: "harness-structure; git status",
        execute: async () => { executed = true; },
      })),
      /adapter/i,
    );
    assert.equal(executed, false);
  } finally {
    await rm(unknown.root, { recursive: true, force: true });
  }

  const wrongPhase = await createFixture("M3-ADAPTER-PHASE");
  try {
    await runStoryCommand(storyOptions(wrongPhase.root, { command: "prepare" }));
    await assert.rejects(
      runStoryCommand(storyOptions(wrongPhase.root, {
        command: "run-adapter",
        adapter: "harness-structure",
        execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      })),
      /not allowed.*requirement|requirement.*not allowed/i,
    );
  } finally {
    await rm(wrongPhase.root, { recursive: true, force: true });
  }
}

async function testRunAdapterPersistsAndRecordsFailure() {
  const { root, storyId } = await createFixture("M3-ADAPTER-FAIL");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const stateBefore = await readFile(path.join(root, `.harness/states/e2e-${storyId}.json`), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "run-adapter",
        adapter: "harness-state-tests",
        execute: async () => ({ exitCode: 7, stdout: "", stderr: "test failed" }),
      })),
      /exit code 7/i,
    );

    const checkpoint = await readJson(root, prepared.checkpointFile);
    const evidencePath = checkpoint.adapterRuns.at(-1).evidencePath;
    const evidence = await readJson(root, evidencePath);
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.exitCode, 7);
    assert.equal(
      await readFile(path.join(root, `.harness/states/e2e-${storyId}.json`), "utf8"),
      stateBefore,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPlatformCommandAdaptersUseFixedExecutableAndArguments() {
  const { root, storyId } = await createFixture("M3-PLATFORM-ARGV");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    await runStoryCommand(storyOptions(root, { command: "prepare" }));
    let invocation = null;
    await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      adapter: "backend-tests",
      execute: async (specification) => {
        invocation = specification;
        return { exitCode: 0, stdout: "passed", stderr: "" };
      },
    }));
    if (process.platform === "win32") {
      assert.match(invocation.executable, /(?:cmd|cmd\.exe)$/i);
      assert.deepEqual(invocation.args, ["/d", "/s", "/c", "mvn.cmd", "test"]);
    } else {
      assert.equal(invocation.executable, "mvn");
      assert.deepEqual(invocation.args, ["test"]);
    }
    assert.equal(invocation.options.shell, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRunAdapterSupportsNormalLargeCommandOutput() {
  const { root, storyId } = await createFixture("M3-LARGE-OUTPUT", REPOSITORY_ROOT);
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    await write(
      root,
      ".harness/scripts/tests/state-runtime.test.mjs",
      'process.stdout.write("x".repeat(2 * 1024 * 1024));\n',
    );
    await runStoryCommand(storyOptions(root, { command: "prepare" }));

    let result;
    try {
      result = await runStoryCommand(storyOptions(root, {
        command: "run-adapter",
        adapter: "harness-state-tests",
      }));
    } catch (error) {
      const evidence = await readJson(
        root,
        `.harness/runs/${storyId}/phases/04-unit-test/evidence/harness-state-tests.json`,
      );
      assert.fail(`${error.message}\n${evidence.stderr}`);
    }

    assert.equal(result.status, "passed");
    assert.equal(result.evidence.stdout.length, 2 * 1024 * 1024);
    assert.equal(result.evidence.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function dispatchResult(task, overrides = {}) {
  return {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    status: "completed",
    summary: "phase completed",
    outputs: task.expectedOutputs.map((outputPath) => ({ path: outputPath })),
    records: [],
    ...overrides,
  };
}

function defaultV2Payload(task, records = []) {
  if (task.phase === "requirement") {
    return {
      acceptanceCriteria: [{
        criterionId: "AC-001",
        description: "The phase acceptance criterion is satisfied.",
        source: "fixture",
        required: true,
      }],
      openQuestions: [],
      inScope: ["Fixture scope"],
      outOfScope: [],
    };
  }
  if (task.phase === "technical-design") {
    return { decisions: [], affectedAreas: [], knowledgeSnapshot: [], risks: [] };
  }
  if (task.phase === "task-dag") {
    return { taskDagFile: task.expectedOutputs[0], taskDagSha256: `sha256:${"0".repeat(64)}` };
  }
  if (task.phase === "implementation") {
    return {
      taskUpdates: [],
      actualFiles: [],
      method: "tdd",
      exceptionReason: null,
      notes: ["Fixture performs no business file changes."],
    };
  }
  if (task.phase === "unit-test") return { cases: [], commands: [], results: [] };
  if (task.phase === "code-review") {
    const blockers = records
      .filter((item) => item.type === "review" && item.status === "BLOCKER")
      .map((item, index) => ({
        findingId: `F-${index + 1}`,
        severity: "BLOCKER",
        status: "open",
        summary: item.message,
        file: null,
        line: null,
        evidence: null,
      }));
    return { findings: blockers, status: blockers.length ? "blocked" : "passed" };
  }
  if (task.phase === "build-publish") return { results: [], artifacts: [], externalActions: [] };
  if (task.phase === "interface-verification") {
    return {
      cases: [],
      results: [],
      environment: {
        status: "unavailable",
        summary: "Fixture environment is unavailable.",
        evidencePath: null,
        evidenceSha256: null,
      },
    };
  }
  return {
    status: "ready",
    ownedFiles: [],
    outOfPredictionFiles: [],
    unrelatedDirtyFiles: [],
    remainingRisks: [],
    summaryFile: null,
    summarySha256: null,
    ownedManifestFile: null,
    ownedManifestSha256: null,
    gitStatus: "not-requested",
  };
}

function dispatchTaskV2(overrides = {}) {
  const dispatchId = FIXED_DISPATCH_ID;
  const attemptRoot = `.harness/runs/M7-A2-CONTRACT/phases/00-requirement/attempts/${dispatchId}`;
  return {
    schemaVersion: "2.0",
    dispatchId,
    storyId: "M7-A2-CONTRACT",
    runId: "M7-A2-CONTRACT",
    phase: "requirement",
    ownerAgent: "requirement-analyst",
    purpose: "Clarify the story.",
    preparedRevision: 1,
    preparedAt: FIXED_NOW,
    resultSchemaVersion: "2.0",
    attemptRoot,
    resultFile: `${attemptRoot}/result.json`,
    checkpointFile: `${attemptRoot}/checkpoint.json`,
    expectedOutputs: [
      ".harness/runs/M7-A2-CONTRACT/phases/00-requirement/requirement-breakdown.md",
    ],
    allowedAdapters: [],
    next: "technical-design",
    ...overrides,
  };
}

function dispatchResultV2(task, overrides = {}) {
  return {
    schemaVersion: "2.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    preparedRevision: task.preparedRevision,
    status: "completed",
    summary: "Requirement completed.",
    outputs: [{
      path: task.expectedOutputs[0],
      sha256: `sha256:${"a".repeat(64)}`,
      bytes: 128,
    }],
    records: [],
    payload: {
      acceptanceCriteria: [{
        criterionId: "AC-001",
        description: "The behavior is verifiable.",
        source: "user",
        required: true,
      }],
      openQuestions: [],
      inScope: ["Harness result projection"],
      outOfScope: ["Git automation"],
    },
    ...overrides,
  };
}

async function testDispatchV2ContractsUseAttemptScopedIdentity() {
  const task = dispatchTaskV2();
  const result = dispatchResultV2(task);
  assert.equal(validateDispatchTaskStructure(task), task);
  assert.equal(validateDispatchResultStructure(result), result);

  assert.throws(
    () => validateDispatchTaskStructure({ ...task, preparedRevision: 0 }),
    /preparedRevision/i,
  );
  assert.throws(
    () => validateDispatchTaskStructure({
      ...task,
      resultFile: ".harness/runs/M7-A2-CONTRACT/phases/00-requirement/result.json",
    }),
    /resultFile|attempt/i,
  );
  const wrongPhaseAttemptRoot = task.attemptRoot.replace("/00-requirement/", "/99-wrong/");
  assert.throws(
    () => validateDispatchTaskStructure({
      ...task,
      attemptRoot: wrongPhaseAttemptRoot,
      resultFile: `${wrongPhaseAttemptRoot}/result.json`,
      checkpointFile: `${wrongPhaseAttemptRoot}/checkpoint.json`,
    }),
    /attemptRoot|phase/i,
  );
  assert.throws(
    () => validateDispatchResultStructure(dispatchResultV2(task, {
      outputs: [{ path: task.expectedOutputs[0], sha256: "sha256:bad", bytes: 128 }],
    })),
    /sha-256|sha256/i,
  );
  assert.throws(
    () => validateDispatchResultStructure(dispatchResultV2(task, {
      status: "failed",
      outputs: [],
      payload: undefined,
      diagnostics: { code: "TEST_FAILED", message: "Tests failed.", details: [] },
    })),
    /unsupported field 'payload'|payload/i,
  );
}

async function testDispatchV2PhasePayloadsAreStrict() {
  const task = dispatchTaskV2();
  const evidenceSha256 = `sha256:${"c".repeat(64)}`;
  const payloads = new Map([
    ["technical-design", {
      decisions: [{ decisionId: "D1", summary: "Use v2", rationale: "Explicit protocol" }],
      affectedAreas: ["common"],
      knowledgeSnapshot: [{
        area: "common",
        relevant: true,
        observedStatus: "fresh",
        status: "fresh",
        sourceFingerprint: evidenceSha256,
        loadedFiles: ["llm-knowledge/common/overview.md"],
        missing: [],
        checkedAt: FIXED_NOW,
        freshnessEvidencePath: ".harness/runs/M7-A2-CONTRACT/phases/01-technical-design/attempts/00000000-0000-4000-8000-000000000001/knowledge/checks/CHK-001.json",
        freshnessEvidenceSha256: evidenceSha256,
        refreshTaskPath: null,
        refreshTaskSha256: null,
        refreshReceiptPath: null,
        refreshReceiptSha256: null,
        approvalId: null,
      }],
      risks: [{ riskId: "R1", description: "Protocol drift", severity: "medium", mitigation: "Shared validation" }],
    }],
    ["task-dag", {
      taskDagFile: ".harness/runs/M7-A2-CONTRACT/phases/02-task-dag/task-dag.json",
      taskDagSha256: `sha256:${"b".repeat(64)}`,
    }],
    ["implementation", {
      taskUpdates: [{ taskId: "T1", status: "done" }],
      actualFiles: ["backend/src/T1.java"],
      method: "tdd",
      exceptionReason: null,
      notes: [],
    }],
    ["unit-test", {
      cases: [{
        caseId: "TC1",
        type: "unit",
        required: true,
        criterionIds: ["AC-001"],
        expected: "The contract rejects drift.",
      }],
      commands: [{
        commandId: "CMD1",
        command: "node tests.mjs",
        status: "passed",
        exitCode: 0,
        evidencePath: "evidence/tests.json",
        evidenceSha256,
        executedAt: FIXED_NOW,
      }],
      results: [{
        caseId: "TC1",
        status: "passed",
        actual: "The contract rejected drift.",
        evidencePath: "evidence/tests.json",
        evidenceSha256,
        executedAt: FIXED_NOW,
      }],
    }],
    ["code-review", {
      findings: [{
        findingId: "F1",
        severity: "WARNING",
        status: "resolved",
        summary: "Tighten the contract.",
        file: ".harness/scripts/lib/dispatch-contract.mjs",
        line: 1,
        evidence: "evidence/review.md",
      }],
      status: "passed",
    }],
    ["build-publish", {
      results: [{
        buildId: "B1",
        type: "no-build",
        status: "passed",
        command: "no build required",
        evidencePath: "evidence/build.json",
        evidenceSha256,
        executedAt: FIXED_NOW,
      }],
      artifacts: [{
        artifactId: "A1",
        type: "report",
        path: "evidence/build.json",
        sha256: evidenceSha256,
        bytes: 128,
      }],
      externalActions: [{
        actionId: "EA1",
        type: "publish",
        status: "not-requested",
        approvalId: null,
        evidencePath: null,
        evidenceSha256: null,
      }],
    }],
    ["interface-verification", {
      cases: [{
        caseId: "VC1",
        type: "api",
        required: true,
        criterionIds: ["AC-001"],
        action: "Call the endpoint.",
        expected: "The endpoint succeeds.",
      }],
      results: [{
        caseId: "VC1",
        status: "blocked",
        actual: "Environment unavailable.",
        evidencePath: null,
        evidenceSha256: null,
        approvalId: null,
        executedAt: FIXED_NOW,
      }],
      environment: {
        status: "unavailable",
        summary: "No environment",
        evidencePath: null,
        evidenceSha256: null,
      },
    }],
    ["delivery-preparation", {
      status: "ready",
      ownedFiles: [],
      outOfPredictionFiles: [],
      unrelatedDirtyFiles: [],
      remainingRisks: [{
        riskId: "R2",
        description: "UI not exercised.",
        severity: "low",
        mitigation: "Verify in M11.",
        status: "open",
        approvalId: null,
      }],
      summaryFile: ".harness/runs/M7-A2-CONTRACT/phases/08-delivery-preparation/delivery-report.md",
      summarySha256: `sha256:${"b".repeat(64)}`,
      ownedManifestFile: ".harness/runs/M7-A2-CONTRACT/delivery/owned-manifest.json",
      ownedManifestSha256: `sha256:${"c".repeat(64)}`,
      gitStatus: "not-requested",
    }],
  ]);
  for (const [phase, payload] of payloads) {
    const phaseTask = {
      ...task,
      phase,
      next: phase === "delivery-preparation" ? "done" : "next-phase",
    };
    assert.doesNotThrow(() => validateDispatchResultStructure(
      dispatchResultV2(phaseTask, { phase, payload }),
    ));
    assert.throws(
      () => validateDispatchResultStructure(
        dispatchResultV2(phaseTask, { phase, payload: { ...payload, unexpected: true } }),
      ),
      /unsupported field.*unexpected/i,
    );
  }
  const readyDelivery = payloads.get("delivery-preparation");
  for (const invalid of [
    { ...readyDelivery, summaryFile: null, summarySha256: null },
    { ...readyDelivery, ownedManifestFile: null, ownedManifestSha256: null },
  ]) {
    assert.throws(
      () => validateDispatchResultStructure(dispatchResultV2({
        ...task,
        phase: "delivery-preparation",
        next: "done",
      }, {
        phase: "delivery-preparation",
        payload: invalid,
      })),
      /ready.*summary|ready.*manifest/i,
    );
  }

  const invalidPayloads = [
    ["requirement", {
      ...dispatchResultV2(task).payload,
      openQuestions: [{ questionId: "Q1", question: "Choose?", status: "invalid", resolution: null }],
    }],
    ["technical-design", {
      ...payloads.get("technical-design"),
      risks: [{ riskId: "R1", description: "Risk", severity: "critical", mitigation: "None" }],
    }],
    ["unit-test", {
      ...payloads.get("unit-test"),
      commands: [{ ...payloads.get("unit-test").commands[0], evidenceSha256: null }],
    }],
    ["code-review", {
      ...payloads.get("code-review"),
      findings: [{ ...payloads.get("code-review").findings[0], line: 0 }],
    }],
    ["build-publish", {
      ...payloads.get("build-publish"),
      externalActions: [{ ...payloads.get("build-publish").externalActions[0], status: "executed", approvalId: null }],
    }],
    ["interface-verification", {
      ...payloads.get("interface-verification"),
      results: [{ ...payloads.get("interface-verification").results[0], status: "unknown" }],
    }],
    ["delivery-preparation", {
      ...payloads.get("delivery-preparation"),
      remainingRisks: [{ ...payloads.get("delivery-preparation").remainingRisks[0], status: "unknown" }],
    }],
  ];
  for (const [phase, payload] of invalidPayloads) {
    const phaseTask = { ...task, phase, next: "next-phase" };
    assert.throws(
      () => validateDispatchResultStructure(dispatchResultV2(phaseTask, { phase, payload })),
      /invalid|evidence|line|approval|status/i,
    );
  }
}

async function writePreparedResult(root, prepared, result) {
  if (prepared.task.schemaVersion === "2.0" && result.schemaVersion !== "2.0") {
    const outputs = [];
    for (const output of result.outputs ?? []) {
      const fullPath = path.join(root, output.path);
      const content = await readFile(fullPath).catch(() => Buffer.alloc(0));
      outputs.push({
        path: output.path,
        sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        bytes: content.length,
      });
    }
    const records = [];
    for (const [index, record] of (result.records ?? []).entries()) {
      let evidencePath = null;
      let sha256 = null;
      let bytes = null;
      if (record.path) {
        const source = await readFile(path.join(root, record.path));
        evidencePath = `${prepared.task.attemptRoot}/evidence/record-${index + 1}.md`;
        await write(root, evidencePath, source);
        sha256 = `sha256:${createHash("sha256").update(source).digest("hex")}`;
        bytes = source.length;
      }
      records.push({
        type: record.type,
        status: record.status,
        path: evidencePath,
        sha256,
        bytes,
        message: record.message,
        actor: record.actor ?? "fixture",
      });
    }
    const common = {
      schemaVersion: "2.0",
      dispatchId: result.dispatchId,
      storyId: prepared.task.storyId,
      runId: prepared.task.runId,
      phase: prepared.task.phase,
      preparedRevision: prepared.task.preparedRevision,
      status: result.status,
      summary: result.summary,
      outputs: result.status === "completed" ? outputs : [],
      records,
    };
    if (result.status === "completed") {
      result = { ...common, payload: result.payload ?? defaultV2Payload(prepared.task, result.records) };
      if (prepared.task.phase === "task-dag" && outputs[0]) {
        result.payload.taskDagSha256 = outputs[0].sha256;
      }
    } else {
      result = {
        ...common,
        diagnostics: result.diagnostics ?? {
          code: result.status === "failed" ? "PHASE_FAILED" : "PHASE_BLOCKED",
          message: result.summary,
          details: [],
        },
        ...(result.status === "blocked" ? { blocker: result.blocker } : {}),
      };
    }
  }
  await write(root, prepared.resultFile, `${JSON.stringify(result, null, 2)}\n`);
}

async function testApplyCompletedResultAdvancesThroughM2() {
  const { root, storyId } = await createFixture("M3-APPLY-PASS");
  try {
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));

    const applied = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(applied.status, "completed");
    assert.equal(applied.state.phase, "technical-design");
    const checkpoint = await readJson(root, prepared.checkpointFile);
    assert.equal(checkpoint.status, "completed");
    assert.equal(checkpoint.completedAt, FIXED_NOW);
    const state = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(
      state.runtime.records.find((record) => record.type === "output")?.path,
      prepared.task.expectedOutputs[0],
    );
    assert.equal(
      state.runtime.records.find((record) => record.type === "output")?.status,
      "produced",
    );
    assert.equal(
      state.runtime.records.find((record) => record.type === "phase-result")?.path,
      prepared.resultFile,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testApplyDeduplicatesManualAndAutomaticOutputRecords() {
  const { root, storyId } = await createFixture("M7-A4-OUTPUT-DEDUPE");
  try {
    const stateBefore = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    const outputPath = `.harness/runs/${stateBefore.runtime.runId}/phases/00-requirement/requirement-breakdown.md`;
    await write(root, outputPath, "# Requirement\n");
    await runStateCommand({
      root,
      command: "record",
      recordType: "output",
      status: "present",
      path: outputPath,
      message: "manual evidence",
      actor: "codex",
      now: () => FIXED_NOW,
    });

    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    const applied = await runStoryCommand(storyOptions(root, { command: "apply" }));

    assert.equal(
      applied.state.runtime.records.filter((record) => (
        record.type === "output"
        && record.phase === "requirement"
        && record.path === outputPath
      )).length,
      1,
    );
    assert.equal(
      applied.state.runtime.records.filter((record) => (
        record.type === "phase-result"
        && record.dispatchId === prepared.task.dispatchId
        && record.status === "applied"
      )).length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testApplyRejectsMissingOutputAndIdentityMismatchWithoutStateChange() {
  const missing = await createFixture("M3-APPLY-MISSING");
  try {
    const prepared = await runStoryCommand(storyOptions(missing.root, { command: "prepare" }));
    await writePreparedResult(missing.root, prepared, dispatchResult(prepared.task));
    const before = await readJson(missing.root, `.harness/states/e2e-${missing.storyId}.json`);
    await assert.rejects(
      runStoryCommand(storyOptions(missing.root, { command: "apply" })),
      /required output.*missing|missing.*required output|result output.*regular file/i,
    );
    const after = await readJson(missing.root, `.harness/states/e2e-${missing.storyId}.json`);
    assert.equal(after.phase, before.phase);
    assert.equal(after.runtime.revision, before.runtime.revision);
  } finally {
    await rm(missing.root, { recursive: true, force: true });
  }

  const mismatch = await createFixture("M3-APPLY-MISMATCH");
  try {
    const prepared = await runStoryCommand(storyOptions(mismatch.root, { command: "prepare" }));
    await write(mismatch.root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(mismatch.root, prepared, dispatchResult(prepared.task, { dispatchId: FIXED_DISPATCH_ID.replace(/1$/, "9") }));
    const before = await readJson(mismatch.root, `.harness/states/e2e-${mismatch.storyId}.json`);
    await assert.rejects(
      runStoryCommand(storyOptions(mismatch.root, { command: "apply" })),
      /result.*task|dispatch/i,
    );
    const after = await readJson(mismatch.root, `.harness/states/e2e-${mismatch.storyId}.json`);
    assert.equal(after.runtime.revision, before.runtime.revision);
  } finally {
    await rm(mismatch.root, { recursive: true, force: true });
  }
}

async function testApplyFailedAndBlockedResultsKeepDeterministicState() {
  const failed = await createFixture("M3-APPLY-FAILED");
  try {
    const prepared = await runStoryCommand(storyOptions(failed.root, { command: "prepare" }));
    const stateFile = `.harness/states/e2e-${failed.storyId}.json`;
    const pointerFile = ".harness/states/active-run.json";
    const eventsFile = `.harness/states/e2e-${failed.storyId}.events.jsonl`;
    const stateBefore = await readFile(path.join(failed.root, stateFile), "utf8");
    const pointerBefore = await readFile(path.join(failed.root, pointerFile), "utf8");
    const eventsBefore = await readFile(path.join(failed.root, eventsFile), "utf8");
    await writePreparedResult(failed.root, prepared, dispatchResult(prepared.task, {
      status: "failed",
      summary: "worker failed",
      outputs: [],
      records: [{ type: "note", status: "recorded", message: "worker failed" }],
    }));
    const applied = await runStoryCommand(storyOptions(failed.root, { command: "apply" }));
    assert.equal(applied.status, "failed");
    assert.equal(applied.state.phase, "requirement");
    assert.equal((await readJson(failed.root, prepared.checkpointFile)).status, "failed");
    assert.equal((await readJson(failed.root, prepared.activeAttemptFile)).status, "failed");
    assert.equal(await readFile(path.join(failed.root, stateFile), "utf8"), stateBefore);
    assert.equal(await readFile(path.join(failed.root, pointerFile), "utf8"), pointerBefore);
    assert.equal(await readFile(path.join(failed.root, eventsFile), "utf8"), eventsBefore);

    const retried = await runStoryCommand(storyOptions(failed.root, { command: "prepare" }));
    assert.equal(retried.reused, true);
    assert.equal(retried.task.dispatchId, prepared.task.dispatchId);
    assert.equal(retried.task.preparedRevision, prepared.task.preparedRevision);
  } finally {
    await rm(failed.root, { recursive: true, force: true });
  }

  const blocked = await createFixture("M3-APPLY-BLOCKED");
  try {
    const prepared = await runStoryCommand(storyOptions(blocked.root, { command: "prepare" }));
    const stateFile = `.harness/states/e2e-${blocked.storyId}.json`;
    const stateBefore = await readJson(blocked.root, stateFile);
    await writePreparedResult(blocked.root, prepared, dispatchResult(prepared.task, {
      status: "blocked",
      summary: "decision required",
      outputs: [],
      records: [{ type: "note", status: "recorded", message: "waiting for user decision" }],
      blocker: { reason: "decision required", owner: "user", suggestedAction: "choose an option" },
    }));
    const applied = await runStoryCommand(storyOptions(blocked.root, { command: "apply" }));
    assert.equal(applied.status, "blocked");
    assert.equal(applied.state.phase, "blocked");
    assert.equal(applied.state.runtime.revision, stateBefore.runtime.revision + 1);
    assert.equal(applied.state.runtime.activeBlock.previousPhase, "requirement");
    assert.deepEqual(applied.state.requirement, stateBefore.requirement);
    assert.equal(
      applied.state.runtime.records.filter((record) => record.type === "note").length,
      1,
    );
    const official = applied.state.runtime.records.filter((record) => (
      record.type === "phase-result" && record.dispatchId === prepared.task.dispatchId
    ));
    assert.equal(official.length, 1);
    assert.equal(official[0].status, "blocked");
    assert.equal(official[0].preparedRevision, prepared.task.preparedRevision);
    assert.equal(official[0].appliedRevision, stateBefore.runtime.revision + 1);
    assert.equal((await readJson(blocked.root, prepared.checkpointFile)).status, "blocked");
    assert.equal((await readJson(blocked.root, prepared.activeAttemptFile)).status, "blocked");

    const oldAttemptBeforeResume = await Promise.all([
      readFile(path.join(blocked.root, prepared.taskFile), "utf8"),
      readFile(path.join(blocked.root, prepared.resultFile), "utf8"),
      readFile(path.join(blocked.root, prepared.checkpointFile), "utf8"),
    ]);
    await runStateCommand({
      root: blocked.root,
      command: "resume",
      stateFile,
      now: () => FIXED_NOW,
    });
    const nextDispatchId = "00000000-0000-4000-8000-000000000002";
    const resumed = await runStoryCommand(storyOptions(blocked.root, {
      command: "prepare",
      randomUUID: () => nextDispatchId,
    }));
    assert.equal(resumed.reused, false);
    assert.equal(resumed.task.dispatchId, nextDispatchId);
    assert.equal(resumed.task.preparedRevision, stateBefore.runtime.revision + 2);
    assert.deepEqual(await Promise.all([
      readFile(path.join(blocked.root, prepared.taskFile), "utf8"),
      readFile(path.join(blocked.root, prepared.resultFile), "utf8"),
      readFile(path.join(blocked.root, prepared.checkpointFile), "utf8"),
    ]), oldAttemptBeforeResume);
  } finally {
    await rm(blocked.root, { recursive: true, force: true });
  }
}

async function testApplyKeepsStateUnchangedBeforeAtomicProjection() {
  const { root, storyId } = await createFixture("M3-APPLY-RESUME");
  try {
    await setFixtureState(root, storyId, (state) => {
      state.phase = "unit-test";
      state.requirement.acceptanceCriteria = [{
        criterionId: "AC-001",
        description: "The targeted tests pass.",
        source: "fixture",
        required: true,
      }];
      state.acceptance.criteria = [{
        criterionId: "AC-001",
        required: true,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      }];
    });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      adapter: "harness-structure",
      execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "" }),
    }));
    const reportPath = prepared.task.expectedOutputs[0];
    await write(root, reportPath, "# Tests passed\n");
    const reportContent = await readFile(path.join(root, reportPath));
    const reportSha256 = `sha256:${createHash("sha256").update(reportContent).digest("hex")}`;
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      records: [{ type: "test", status: "passed", path: reportPath, message: "targeted tests passed" }],
      payload: {
        cases: [{
          caseId: "TC-001",
          type: "unit",
          required: true,
          criterionIds: ["AC-001"],
          expected: "The targeted tests pass.",
        }],
        commands: [{
          commandId: "CMD-001",
          command: "node targeted-test.mjs",
          status: "passed",
          exitCode: 0,
          evidencePath: reportPath,
          evidenceSha256: reportSha256,
          executedAt: FIXED_NOW,
        }],
        results: [{
          caseId: "TC-001",
          status: "passed",
          actual: "The targeted tests passed.",
          evidencePath: reportPath,
          evidenceSha256: reportSha256,
          executedAt: FIXED_NOW,
        }],
      },
    }));
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const stateBefore = await readFile(path.join(root, stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        beforeAdvance: async () => { throw new Error("simulated interruption"); },
      })),
      /simulated interruption/,
    );
    assert.equal(await readFile(path.join(root, stateFile), "utf8"), stateBefore);

    const resumed = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(resumed.state.phase, "code-review");
    const completed = await readJson(root, stateFile);
    assert.equal(completed.tests.results[0].status, "passed");
    assert.equal(
      completed.runtime.records.some((record) => record.type === "test" && record.status === "passed"),
      true,
    );
    assert.equal(
      completed.runtime.records.some((record) => record.type === "phase-result" && record.status === "applied"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testApplyReconcilesAfterAdvanceBeforeCheckpointWrite() {
  const { root, storyId } = await createFixture("M3-APPLY-POST-ADVANCE");
  try {
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));

    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        afterAdvance: async () => { throw new Error("simulated post-advance interruption"); },
      })),
      /post-advance interruption/,
    );
    const interrupted = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(interrupted.phase, "technical-design");
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "prepared");

    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const pointerFile = ".harness/states/active-run.json";
    const eventsFile = `.harness/states/e2e-${storyId}.events.jsonl`;
    const stateBeforeRetry = await readFile(path.join(root, stateFile), "utf8");
    const pointerBeforeRetry = await readFile(path.join(root, pointerFile), "utf8");
    const eventsBeforeRetry = await readFile(path.join(root, eventsFile), "utf8");
    const resumed = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(resumed.status, "already-applied");
    assert.equal(resumed.state.phase, "technical-design");
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "completed");
    assert.equal(await readFile(path.join(root, stateFile), "utf8"), stateBeforeRetry);
    assert.equal(await readFile(path.join(root, pointerFile), "utf8"), pointerBeforeRetry);
    assert.equal(await readFile(path.join(root, eventsFile), "utf8"), eventsBeforeRetry);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testApplyRebuildsMissingAttemptPointerFromFormalResultIndex() {
  const { root, storyId } = await createFixture("M3-APPLY-MISSING-ACTIVE");
  try {
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        afterAdvance: async () => { throw new Error("simulated active-attempt loss"); },
      })),
      /active-attempt loss/i,
    );
    await rm(path.join(root, prepared.activeAttemptFile));
    await rm(path.join(root, prepared.checkpointFile));

    const resumed = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(resumed.status, "already-applied");
    assert.equal(resumed.state.phase, "technical-design");
    const active = await readJson(root, prepared.activeAttemptFile);
    assert.equal(active.dispatchId, prepared.task.dispatchId);
    assert.equal(active.preparedRevision, prepared.task.preparedRevision);
    assert.equal(active.status, "completed");
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "completed");

    const result = await readJson(root, prepared.resultFile);
    result.summary = "drifted after apply";
    await write(root, prepared.resultFile, `${JSON.stringify(result, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /formal phase result drifted|result.*drift/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBlockedApplyRecoversProcessFilesFromFormalResultIndex() {
  const { root, storyId } = await createFixture("M3-APPLY-BLOCKED-RECOVERY");
  try {
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      status: "blocked",
      summary: "decision required",
      outputs: [],
      blocker: { reason: "decision required", owner: "user", suggestedAction: "choose an option" },
    }));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        afterAdvance: async () => { throw new Error("simulated blocked process-file interruption"); },
      })),
      /blocked process-file interruption/i,
    );
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const eventsFile = `.harness/states/e2e-${storyId}.events.jsonl`;
    const stateBeforeRetry = await readFile(path.join(root, stateFile), "utf8");
    const eventsBeforeRetry = await readFile(path.join(root, eventsFile), "utf8");
    await rm(path.join(root, prepared.activeAttemptFile));
    await rm(path.join(root, prepared.checkpointFile));

    const resumed = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(resumed.status, "already-applied");
    assert.equal(resumed.state.phase, "blocked");
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "blocked");
    assert.equal((await readJson(root, prepared.activeAttemptFile)).status, "blocked");
    assert.equal(await readFile(path.join(root, stateFile), "utf8"), stateBeforeRetry);
    assert.equal(await readFile(path.join(root, eventsFile), "utf8"), eventsBeforeRetry);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testFailedAdapterAndBlockerCannotAdvanceUntilResolved() {
  const testFixture = await createFixture("M3-GATE-TEST");
  try {
    await setFixtureState(testFixture.root, testFixture.storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(testFixture.root, { command: "prepare" }));
    await assert.rejects(
      runStoryCommand(storyOptions(testFixture.root, {
        command: "run-adapter",
        adapter: "harness-state-tests",
        execute: async () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
      })),
      /exit code 1/i,
    );
    await write(testFixture.root, prepared.task.expectedOutputs[0], "# Test report\n");
    await writePreparedResult(testFixture.root, prepared, dispatchResult(prepared.task));
    await assert.rejects(
      runStoryCommand(storyOptions(testFixture.root, { command: "apply" })),
      /failed adapter|failed required tests/i,
    );
    await runStoryCommand(storyOptions(testFixture.root, {
      command: "run-adapter",
      adapter: "harness-state-tests",
      execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "" }),
    }));
    const applied = await runStoryCommand(storyOptions(testFixture.root, { command: "apply" }));
    assert.equal(applied.state.phase, "code-review");
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }

  const reviewFixture = await createFixture("M3-GATE-REVIEW");
  try {
    await setFixtureState(reviewFixture.root, reviewFixture.storyId, (state) => { state.phase = "code-review"; });
    const prepared = await runStoryCommand(storyOptions(reviewFixture.root, { command: "prepare" }));
    const reportPath = prepared.task.expectedOutputs[0];
    await write(reviewFixture.root, reportPath, "# Review\n");
    await writePreparedResult(reviewFixture.root, prepared, dispatchResult(prepared.task, {
      records: [{ type: "review", status: "BLOCKER", path: reportPath, message: "main flow is broken" }],
    }));
    await assert.rejects(
      runStoryCommand(storyOptions(reviewFixture.root, { command: "apply" })),
      /BLOCKER/i,
    );
    await writePreparedResult(reviewFixture.root, prepared, dispatchResult(prepared.task, {
      records: [
        { type: "review", status: "resolved", path: reportPath, message: "main flow is broken" },
        { type: "review", status: "passed", path: reportPath, message: "review passed" }
      ],
    }));
    const applied = await runStoryCommand(storyOptions(reviewFixture.root, { command: "apply" }));
    assert.equal(applied.state.phase, "build-publish");
  } finally {
    await rm(reviewFixture.root, { recursive: true, force: true });
  }
}

async function testBuildPhaseRequiresACommandAdapterResult() {
  const { root, storyId } = await createFixture("M3-BUILD-GATE");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "build-publish"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      adapter: "harness-structure",
      execute: async () => ({ exitCode: 0, stdout: "structure passed", stderr: "" }),
    }));
    await write(root, prepared.task.expectedOutputs[0], "# Build report\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /build-publish.*adapter|adapter.*build-publish/i,
    );
    const state = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(state.phase, "build-publish");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNoBuildAdapterRejectsBackendOrFrontendChanges() {
  const { root, storyId } = await createFixture("M3-NO-BUILD-DIRTY");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "build-publish"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "run-adapter",
        adapter: "no-build-required",
        execute: async () => ({
          exitCode: 0,
          stdout: " M backend/pom.xml\n?? frontend/src/new-view.ts\n",
          stderr: "",
        }),
      })),
      /backend or frontend changes require a build/i,
    );
    const checkpoint = await readJson(root, prepared.checkpointFile);
    assert.equal(checkpoint.adapterRuns[0].status, "failed");
    const evidence = await readJson(root, checkpoint.adapterRuns[0].evidencePath);
    assert.equal(evidence.exitCode, 1);
    assert.match(evidence.stderr, /backend or frontend changes require a build/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBuildPhaseRejectsChangedAdapterEvidence() {
  const { root, storyId } = await createFixture("M3-BUILD-EVIDENCE");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "build-publish"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const adapter = await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      adapter: "no-build-required",
      execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    }));
    const checkpoint = await readJson(root, prepared.checkpointFile);
    assert.match(checkpoint.adapterRuns[0].sha256, /^sha256:[a-f0-9]{64}$/);

    const evidence = await readJson(root, adapter.evidencePath);
    evidence.stdout = "changed after the adapter completed";
    await write(root, adapter.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await write(root, prepared.task.expectedOutputs[0], "# Build report\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));

    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /adapter evidence.*changed|changed.*adapter evidence/i,
    );
    const state = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(state.phase, "build-publish");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCodeReviewRequiresPassedReviewEvidence() {
  const { root, storyId } = await createFixture("M3-REVIEW-GATE");
  try {
    await setFixtureState(root, storyId, (state) => {
      state.phase = "code-review";
      state.review.status = "passed";
    });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Review report\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task));
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /code-review.*passed|passed.*review/i,
    );
    const state = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(state.phase, "code-review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCompleteSingleStoryVerticalSlice() {
  const { root, storyId } = await createFixture("M3-VERTICAL");
  try {
    const runE2E = (command, overrides = {}) => runE2ECommand({
      root,
      command,
      runStory: (options) => runStoryCommand(storyOptions(root, { ...options, ...overrides })),
    });
    let testEvidencePath;
    let verificationEvidencePath;
    let approvalReceiptPath;
    let knowledgeApprovalReceiptPath;
    let historicalResultPath;
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: requirement
    order: 0
    owner_agent: requirement-analyst
    purpose: Clarify the story.
    required_outputs:
      - .harness/runs/{runId}/phases/00-requirement/requirement-breakdown.md
    next:
      - technical-design
  - id: technical-design
    order: 1
    owner_agent: requirement-analyst
    purpose: Design the change.
    required_outputs:
      - .harness/runs/{runId}/phases/01-technical-design/technical-design.md
    next:
      - task-dag
  - id: task-dag
    order: 2
    owner_agent: task-planner
    purpose: Plan tasks.
    required_outputs:
      - .harness/runs/{runId}/phases/02-task-dag/task-dag.json
    next:
      - implementation
  - id: implementation
    order: 3
    owner_agent: backend-developer
    purpose: Implement changes.
    required_outputs:
      - .harness/runs/{runId}/phases/03-implementation/implementation-notes.md
    next:
      - unit-test
  - id: unit-test
    order: 4
    owner_agent: unit-tester
    purpose: Run tests.
    required_outputs:
      - .harness/runs/{runId}/phases/04-unit-test/test-report.md
    next:
      - code-review
  - id: code-review
    order: 5
    owner_agent: code-reviewer
    purpose: Review changes.
    required_outputs:
      - .harness/runs/{runId}/phases/05-code-review/code-review-report.md
    next:
      - build-publish
  - id: build-publish
    order: 6
    owner_agent: publisher
    purpose: Build without publishing.
    required_outputs:
      - .harness/runs/{runId}/phases/06-build-publish/build-report.md
    next:
      - interface-verification
  - id: interface-verification
    order: 7
    owner_agent: interface-verifier
    purpose: Verify interfaces.
    required_outputs:
      - .harness/runs/{runId}/phases/07-interface-verification/interface-verification-report.md
    next:
      - delivery-preparation
  - id: delivery-preparation
    order: 8
    owner_agent: git-committer
    purpose: Prepare delivery summary.
    required_outputs:
      - .harness/runs/{runId}/phases/08-delivery-preparation/delivery-report.md
    next:
      - done
quality_gates:
  - phase: task-dag
    rule: DAG must be valid.
  - phase: unit-test
    rule: Failed tests block.
  - phase: code-review
    rule: BLOCKER findings block.
`);
    await write(root, ".harness/scripts/validate-task-dag.ps1", "param([string]$TaskDagFile)\nexit 0\n");
    const phases = [
      "requirement", "technical-design", "task-dag", "implementation", "unit-test",
      "code-review", "build-publish", "interface-verification", "delivery-preparation",
    ];

    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      const stepped = await runE2E("step", {
        randomUUID: () => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      });
      assert.equal(
        stepped.action,
        phase === "code-review"
          ? "provider-prepare-required"
          : ["unit-test", "build-publish"].includes(phase)
            ? "adapter-selection-required"
            : "cognitive-action-required",
      );
      const inspected = await runStoryCommand(storyOptions(root, { command: "inspect" }));
      const prepared = {
        task: await readJson(root, inspected.inspection.taskFile),
        taskFile: inspected.inspection.taskFile,
        resultFile: inspected.inspection.resultFile,
        checkpointFile: inspected.inspection.checkpointFile,
      };
      assert.equal(prepared.task.phase, phase);
      assert.equal(prepared.task.preparedAt, FIXED_NOW);
      assert.match(
        prepared.taskFile,
        new RegExp(`/phases/${String(index).padStart(2, "0")}-${phase}/attempts/.+/task\\.json$`),
      );
      const outputPath = prepared.task.expectedOutputs[0];
      await write(root, outputPath, phase === "task-dag" ? `${JSON.stringify({
        schemaVersion: "2.0",
        storyId,
        nodes: [
          {
            taskId: "T1",
            title: "Implement required behavior",
            type: "backend",
            status: "pending",
            ownerAgent: "backend-developer",
            predictedFiles: ["backend/src/T1.java"],
            criterionIds: ["AC-001"],
          },
          {
            taskId: "T2",
            title: "Implement gap and optional behavior",
            type: "frontend",
            status: "pending",
            ownerAgent: "frontend-developer",
            predictedFiles: ["frontend/src/T2.ts"],
            criterionIds: ["AC-002", "AC-OPT"],
          },
        ],
        edges: [{ from: "T1", to: "T2", reason: "The shared contract is implemented first." }],
        waves: [["T1"], ["T2"]],
        globalChanges: [],
        risks: [],
      }, null, 2)}\n` : `# ${phase}\n`);

      if (phase === "unit-test") {
        testEvidencePath = outputPath;
        await runStoryCommand(storyOptions(root, {
          command: "run-adapter",
          adapter: "harness-structure",
          execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "" }),
        }));
      }
      if (phase === "build-publish") {
        await runStoryCommand(storyOptions(root, {
          command: "run-adapter",
          adapter: "no-build-required",
          execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        }));
      }
      const records = phase === "code-review"
        ? [{ type: "review", status: "passed", path: outputPath, message: "review passed" }]
        : [];
      let payload;
      if (phase === "requirement") {
        payload = {
          acceptanceCriteria: [
            {
              criterionId: "AC-001",
              description: "The primary behavior is verified.",
              source: "fixture",
              required: true,
            },
            {
              criterionId: "AC-002",
              description: "The known verification gap is explicitly accepted.",
              source: "fixture",
              required: true,
            },
            {
              criterionId: "AC-OPT",
              description: "The optional behavior is recorded without blocking completion.",
              source: "fixture",
              required: false,
            },
          ],
          openQuestions: [],
          inScope: ["Acceptance gate vertical fixture"],
          outOfScope: [],
        };
      } else if (phase === "technical-design") {
        const currentFingerprint = await computeAreaSourceFingerprint(root, "common");
        const evidenceArtifact = await writeKnowledgeArtifact(
          root,
          `${prepared.task.attemptRoot}/knowledge/checks`,
          "CHK",
          "checkId",
          {
          schemaVersion: "1.0",
          storyId,
          runId: storyId,
          dispatchId: prepared.task.dispatchId,
          preparedRevision: prepared.task.preparedRevision,
          area: "common",
          status: "stale",
          recordedSourceFingerprint: `sha256:${"1".repeat(64)}`,
          currentSourceFingerprint: currentFingerprint.fingerprint,
          baselineStatus: "stale",
          semanticStatus: "pending",
          indexStatus: "partial",
          reason: "common knowledge requires refresh",
          checkedAt: FIXED_NOW,
          },
        );
        const evidence = evidenceArtifact.value;
        const evidencePath = evidenceArtifact.relativePath;
        const evidenceSha256 = evidenceArtifact.sha256;
        const refreshTaskArtifact = await writeKnowledgeArtifact(
          root,
          `${prepared.task.attemptRoot}/knowledge/tasks`,
          "KRT",
          "refreshTaskId",
          {
          schemaVersion: "1.0",
          storyId,
          runId: storyId,
          dispatchId: prepared.task.dispatchId,
          preparedRevision: prepared.task.preparedRevision,
          area: "common",
          parameters: { area: "common", module: null, mode: "baseline" },
          protectedAreas: ["backend", "frontend", "common"],
          reason: "common knowledge requires refresh",
          sourcePaths: [".harness/scripts/lib/story-runtime.mjs"],
          customSnapshots: [
            { area: "backend", files: [] },
            { area: "frontend", files: [] },
            { area: "common", files: [] },
          ],
          createdAt: FIXED_NOW,
          },
        );
        const refreshTaskPath = refreshTaskArtifact.relativePath;
        const refreshTaskSha256 = refreshTaskArtifact.sha256;
        payload = {
          decisions: [],
          affectedAreas: ["common"],
          knowledgeSnapshot: [{
            area: "common",
            relevant: true,
            observedStatus: "stale",
            status: "stale",
            sourceFingerprint: evidence.currentSourceFingerprint,
            loadedFiles: ["llm-knowledge/common/overview.md"],
            missing: [],
            checkedAt: FIXED_NOW,
            freshnessEvidencePath: evidencePath,
            freshnessEvidenceSha256: evidenceSha256,
            refreshTaskPath,
            refreshTaskSha256,
            refreshReceiptPath: null,
            refreshReceiptSha256: null,
            approvalId: null,
          }],
          risks: [],
        };
      } else if (phase === "implementation") {
        await write(root, "backend/src/T1.java", "backend implementation\n");
        await write(root, "frontend/src/T2.ts", "frontend implementation\n");
        payload = {
          taskUpdates: [
            { taskId: "T1", status: "done" },
            { taskId: "T2", status: "done" },
          ],
          actualFiles: ["backend/src/T1.java", "frontend/src/T2.ts"],
          method: "tdd",
          exceptionReason: null,
          notes: [],
        };
      } else if (phase === "unit-test") {
        const testContent = await readFile(path.join(root, outputPath));
        const testSha256 = `sha256:${createHash("sha256").update(testContent).digest("hex")}`;
        payload = {
          cases: [{
            caseId: "TC-001",
            type: "unit",
            required: true,
            criterionIds: ["AC-001", "AC-002"],
            expected: "Both required behaviors pass.",
          }],
          commands: [],
          results: [{
            caseId: "TC-001",
            status: "passed",
            actual: "Both required behaviors passed.",
            evidencePath: outputPath,
            evidenceSha256: testSha256,
            executedAt: FIXED_NOW,
          }],
        };
      } else if (phase === "interface-verification") {
        const blockedResult = dispatchResult(prepared.task, {
          status: "blocked",
          summary: "Verification environment requires recovery.",
          outputs: [],
          records: [{
            type: "note",
            status: "recorded",
            message: "Waiting for the verification environment.",
          }],
          blocker: {
            reason: "Verification environment unavailable.",
            owner: "user",
            suggestedAction: "Restore the fixture environment and resume.",
          },
        });
        await writePreparedResult(root, prepared, blockedResult);
        const blocked = await runE2E("step");
        assert.equal(blocked.action, "blocked");
        assert.equal((await readJson(root, `.harness/states/e2e-${storyId}.json`)).phase, "blocked");
        await runStateCommand({
          root,
          command: "resume",
          stateFile: `.harness/states/e2e-${storyId}.json`,
          now: () => FIXED_NOW,
        });
        const resumedStep = await runE2E("step", {
          randomUUID: () => "00000000-0000-4000-8000-000000000010",
        });
        assert.equal(resumedStep.action, "cognitive-action-required");
        const resumedInspection = await runStoryCommand(storyOptions(root, { command: "inspect" }));
        const resumed = {
          task: await readJson(root, resumedInspection.inspection.taskFile),
          taskFile: resumedInspection.inspection.taskFile,
          resultFile: resumedInspection.inspection.resultFile,
          checkpointFile: resumedInspection.inspection.checkpointFile,
        };
        assert.equal(resumed.task.phase, phase);
        assert.notEqual(resumed.task.dispatchId, prepared.task.dispatchId);
        assert.ok(resumed.task.preparedRevision > prepared.task.preparedRevision);
        await write(root, resumed.task.expectedOutputs[0], "# interface-verification resumed\n");
        const verificationContent = await readFile(path.join(root, outputPath));
        const verificationSha256 = `sha256:${createHash("sha256").update(verificationContent).digest("hex")}`;
        const gapEvidencePath = `${resumed.task.attemptRoot}/evidence/known-gap.md`;
        verificationEvidencePath = gapEvidencePath;
        await write(root, gapEvidencePath, "Known UI verification gap.\n");
        const gapEvidence = await readFile(path.join(root, gapEvidencePath));
        const gapEvidenceSha256 = `sha256:${createHash("sha256").update(gapEvidence).digest("hex")}`;
        payload = {
          cases: [
            {
              caseId: "VC-001",
              type: "api",
              required: true,
              criterionIds: ["AC-001"],
              action: "Verify the primary behavior",
              expected: "The primary behavior is verified.",
            },
            {
              caseId: "VC-002",
              type: "ui-flow",
              required: true,
              criterionIds: ["AC-002"],
              action: "Verify the UI behavior",
              expected: "The UI behavior is visible.",
            },
            {
              caseId: "VC-OPT",
              type: "ui-flow",
              required: false,
              criterionIds: ["AC-OPT"],
              action: "Verify the optional behavior",
              expected: "The optional behavior is visible.",
            },
          ],
          results: [
            {
              caseId: "VC-001",
              status: "verified",
              actual: "The primary behavior is verified.",
              evidencePath: outputPath,
              evidenceSha256: verificationSha256,
              approvalId: null,
              executedAt: FIXED_NOW,
            },
            {
              caseId: "VC-002",
              status: "accepted-with-known-gaps",
              actual: "The UI environment remains unavailable.",
              evidencePath: gapEvidencePath,
              evidenceSha256: gapEvidenceSha256,
              approvalId: null,
              executedAt: FIXED_NOW,
            },
            {
              caseId: "VC-OPT",
              status: "blocked",
              actual: "The optional check was not run.",
              evidencePath: null,
              evidenceSha256: null,
              approvalId: null,
              executedAt: FIXED_NOW,
            },
          ],
          environment: {
            status: "unavailable",
            summary: "API evidence is available; UI checks have known gaps.",
            evidencePath: null,
            evidenceSha256: null,
          },
        };
        await writePreparedResult(root, resumed, dispatchResult(resumed.task, { records, payload }));
        const approval = await runStoryCommand(storyOptions(root, {
          command: "approve-gap",
          caseId: "VC-002",
          reason: "接受纵向 fixture 中明确记录的验证缺口",
        }));
        approvalReceiptPath = approval.receiptFile;
        assert.match(approval.approvalId, /^APR-[a-f0-9]{32}$/);
        const applied = await runE2E("step");
        assert.equal(applied.action, "prepare");
        const appliedState = await readJson(root, `.harness/states/e2e-${storyId}.json`);
        assert.equal(appliedState.phase, "delivery-preparation");
        assert.equal((await readJson(root, resumed.checkpointFile)).status, "completed");
        const blockedRecords = appliedState.runtime.records.filter((record) => (
          record.type === "phase-result"
          && record.phase === "interface-verification"
          && record.status === "blocked"
        ));
        assert.equal(blockedRecords.length, 1);
        continue;
      } else if (phase === "delivery-preparation") {
        const current = await runStateCommand({
          root,
          command: "status",
          stateFile: `.harness/states/e2e-${storyId}.json`,
        });
        const manifest = await prepareOwnedManifest({
          root,
          state: current.state,
          now: () => FIXED_NOW,
        });
        assert.equal(prepared.task.expectedOutputs[1], manifest.manifestFile);
        const summaryContent = await readFile(path.join(root, outputPath));
        payload = {
          status: "ready",
          ownedFiles: manifest.facts.ownedFiles,
          outOfPredictionFiles: manifest.facts.outOfPredictionFiles,
          unrelatedDirtyFiles: manifest.facts.unrelatedDirtyFiles,
          remainingRisks: [],
          summaryFile: outputPath,
          summarySha256: `sha256:${createHash("sha256").update(summaryContent).digest("hex")}`,
          ownedManifestFile: manifest.manifestFile,
          ownedManifestSha256: manifest.manifestSha256,
          gitStatus: "not-requested",
        };
      }
      await writePreparedResult(root, prepared, dispatchResult(prepared.task, { records, payload }));
      if (phase === "technical-design") {
        const approval = await runStoryCommand(storyOptions(root, {
          command: "approve-stale",
          area: "common",
          reason: "接受纵向 fixture 中已通过源码核验的 stale 知识",
        }));
        knowledgeApprovalReceiptPath = approval.receiptFile;
      }
      if (phase === "requirement") historicalResultPath = prepared.resultFile;
      if (phase === "delivery-preparation") {
        const stateFile = `.harness/states/e2e-${storyId}.json`;
        const before = await readFile(path.join(root, stateFile), "utf8");
        for (const [driftPath, label] of [
          [testEvidencePath, "test evidence"],
          [verificationEvidencePath, "verification evidence"],
          [approvalReceiptPath, "approval receipt"],
          [knowledgeApprovalReceiptPath, "knowledge approval receipt"],
          [historicalResultPath, "phase result"],
        ]) {
          const original = await readFile(path.join(root, driftPath));
          await write(root, driftPath, `${original.toString("utf8")}drift\n`);
          await assert.rejects(
            runStoryCommand(storyOptions(root, { command: "apply" })),
            new RegExp(label, "i"),
          );
          assert.equal(await readFile(path.join(root, stateFile), "utf8"), before);
          await writeFile(path.join(root, driftPath), original);
        }
      }
      const applied = await runE2E("step");
      const expected = phases[index + 1] ?? "done";
      assert.equal((await readJson(root, `.harness/states/e2e-${storyId}.json`)).phase, expected);
      assert.equal(applied.action, expected === "done" ? "completed" : "prepare");
      assert.equal((await readJson(root, prepared.checkpointFile)).status, "completed");
      const restarted = await runStoryCommand(storyOptions(root, { command: "status" }));
      assert.equal(restarted.state.phase, expected);
    }

    const finalState = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(finalState.runtime.status, "completed");
    assert.equal(finalState.phase, "done");
    assert.deepEqual(
      finalState.approvals.map((approval) => approval.subjectType).sort(),
      ["knowledge-stale", "verification-gap"],
    );
    assert.equal(
      finalState.runtime.records.filter((record) => record.type === "output").length,
      phases.length + 1,
    );
    assert.equal(
      finalState.runtime.records.filter((record) => (
        record.type === "phase-result"
        && record.phase === "interface-verification"
        && record.status === "blocked"
      )).length,
      1,
    );
    assert.deepEqual(
      finalState.acceptance.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        status: criterion.status,
      })),
      [
        { criterionId: "AC-001", status: "verified" },
        { criterionId: "AC-002", status: "accepted-with-known-gaps" },
        { criterionId: "AC-OPT", status: "blocked" },
      ],
    );
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "prepare" })),
      /completed|done/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testM3RuntimeIsRegisteredInHarnessContracts() {
  const manifest = await readFile(path.join(REPOSITORY_ROOT, ".harness/structure-manifest.yaml"), "utf8");
  for (const expected of [
    ".harness/schemas/dispatch-task.schema.json",
    ".harness/schemas/dispatch-result.schema.json",
    ".harness/schemas/dispatch-task-v2.schema.json",
    ".harness/schemas/dispatch-result-v2.schema.json",
    ".harness/scripts/run-story.ps1",
    ".harness/scripts/lib/story-runtime.mjs",
    ".harness/scripts/lib/phase-data-contract.mjs",
    ".harness/scripts/lib/phase-result-projector.mjs",
    ".harness/scripts/lib/batch-finalization-contract.mjs",
    ".harness/scripts/tests/story-runtime.test.mjs",
    ".harness/scripts/tests/phase-result-projector.test.mjs",
    "docs/harness-m3-agent-dispatcher",
    "docs/harness-m7a2-phase-result",
  ]) {
    assert.match(manifest, new RegExp(expected.replaceAll(".", "\\.")));
  }
  assert.match(manifest, /agent_runtime: single-story-dispatcher-v1/);

  const smoke = await readFile(path.join(REPOSITORY_ROOT, ".harness/scripts/smoke-harness-flow.ps1"), "utf8");
  assert.match(smoke, /run-story\.ps1/);
  assert.match(smoke, /-Command prepare/);
  assert.match(smoke, /-Command status/);
  const batchSourceMatch = smoke.match(/\$batchSource = @"\r?\n([\s\S]*?)\r?\n"@/);
  assert.ok(batchSourceMatch, "Serial batch smoke must embed its Node source.");
  const batchSource = batchSourceMatch[1];
  assert.match(batchSource, /import\s*\{\s*runStoryCommand\s*\}\s*from/);
  assert.match(batchSource, /await runStoryCommand\(\{\s*root,\s*command:\s*'prepare-batch',\s*stateFile,\s*taskDagFile,\s*executeGit,/);
  assert.match(batchSource, /const executeGit = async \(args\) => \{\s*if \(args\[0\] === 'worktree' && \(args\[1\] === 'add' \|\| args\[1\] === 'remove'\)\) \{\s*throw new Error\('Serial batch smoke must not create or remove a Worktree\.'\);\s*\}/);
  assert.match(batchSource, /await runWorktreeCommand\(\{\s*root,\s*command:\s*'batch-plan',\s*stateFile,\s*executeGit,/);
  assert.match(batchSource, /await runWorktreeCommand\(\{\s*root,\s*command:\s*'batch-status',\s*stateFile,\s*executeGit\s*\}\)/);
  assert.doesNotMatch(batchSource, /\bprepareSerialBatch\b/);

  const readme = await readFile(path.join(REPOSITORY_ROOT, ".harness/scripts/README.md"), "utf8");
  assert.match(readme, /run-story\.ps1/);
  assert.match(readme, /run-adapter/);
  assert.match(readme, /apply/);

  const structureValidator = await readFile(path.join(REPOSITORY_ROOT, ".harness/scripts/validate-structure.ps1"), "utf8");
  assert.match(structureValidator, /\.harness\/schemas\/dispatch-task\.schema\.json/);
  assert.match(structureValidator, /\.harness\/schemas\/dispatch-result\.schema\.json/);
  assert.match(structureValidator, /\.harness\/schemas\/dispatch-task-v2\.schema\.json/);
  assert.match(structureValidator, /\.harness\/schemas\/dispatch-result-v2\.schema\.json/);
}

async function testRequirementAcceptanceGateRejectsBeforePersistence() {
  const { root, storyId } = await createFixture("M7-A3-REQ-GATE");
  try {
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      payload: {
        acceptanceCriteria: [{
          criterionId: "AC-OPT",
          description: "Optional only",
          source: "fixture",
          required: false,
        }],
        openQuestions: [],
        inScope: ["Harness"],
        outOfScope: [],
      },
    }));
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const pointerFile = ".harness/states/active-run.json";
    const eventsFile = `.harness/states/e2e-${storyId}.events.jsonl`;
    const before = await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]);

    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /required criterion/i,
    );
    const after = await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]);
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testApproveGapWritesAttemptReceiptWithoutChangingState() {
  const { root, storyId } = await createFixture("M7-A3-APPROVE-GAP");
  try {
    await setFixtureState(root, storyId, (state) => {
      state.phase = "interface-verification";
      state.requirement.acceptanceCriteria = [{
        criterionId: "AC-001",
        description: "The UI result is verified.",
        source: "fixture",
        required: true,
      }];
      state.acceptance.criteria = [{
        criterionId: "AC-001",
        required: true,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      }];
    });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const reportPath = prepared.task.expectedOutputs[0];
    await write(root, reportPath, "# UI environment unavailable\n");
    const evidencePath = `${prepared.task.attemptRoot}/evidence/ui-gap.md`;
    await write(root, evidencePath, "UI environment unavailable.\n");
    const evidence = await readFile(path.join(root, evidencePath));
    const evidenceSha256 = `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      payload: {
        cases: [{
          caseId: "VC-001",
          type: "ui-flow",
          required: true,
          criterionIds: ["AC-001"],
          action: "Open the page",
          expected: "The state is visible",
        }],
        results: [{
          caseId: "VC-001",
          status: "accepted-with-known-gaps",
          actual: "UI environment unavailable",
          evidencePath,
          evidenceSha256,
          approvalId: null,
          executedAt: FIXED_NOW,
        }],
        environment: {
          status: "unavailable",
          summary: "UI environment unavailable",
          evidencePath: null,
          evidenceSha256: null,
        },
      },
    }));
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const pointerFile = ".harness/states/active-run.json";
    const eventsFile = `.harness/states/e2e-${storyId}.events.jsonl`;
    const before = await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]);
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /approval/i,
    );
    assert.deepEqual(await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]), before);

    const approved = await runStoryCommand(storyOptions(root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受当前已知验证缺口",
    }));
    assert.equal(approved.command, "approve-gap");
    assert.match(approved.approvalId, /^APR-[a-f0-9]{32}$/);
    assert.equal(approved.reused, false);
    const result = await readJson(root, prepared.resultFile);
    assert.equal(result.payload.results[0].approvalId, approved.approvalId);
    const receipt = await readJson(root, approved.receiptFile);
    assert.equal(receipt.approvalId, approved.approvalId);
    assert.equal(receipt.actor, "user");
    const after = await Promise.all([
      readFile(path.join(root, stateFile), "utf8"),
      readFile(path.join(root, pointerFile), "utf8"),
      readFile(path.join(root, eventsFile), "utf8"),
    ]);
    assert.deepEqual(after, before);

    const reused = await runStoryCommand(storyOptions(root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受当前已知验证缺口",
    }));
    assert.equal(reused.approvalId, approved.approvalId);
    assert.equal(reused.reused, true);

    await write(root, approved.receiptFile, `${JSON.stringify({
      ...receipt,
      approvalId: `APR-${"f".repeat(32)}`,
    }, null, 2)}\n`);
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "approve-gap",
        caseId: "VC-001",
        reason: "接受更新后的已知验证缺口",
      })),
      /approval receipt.*identity|identity.*approval receipt/i,
    );
    await write(root, approved.receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);

    const reasonChanged = await runStoryCommand(storyOptions(root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受更新后的已知验证缺口",
    }));
    assert.notEqual(reasonChanged.approvalId, approved.approvalId);
    assert.equal((await readJson(root, prepared.resultFile)).payload.results[0].approvalId, reasonChanged.approvalId);

    await write(root, evidencePath, "UI environment remains unavailable.\n");
    const changedEvidence = await readFile(path.join(root, evidencePath));
    const changedEvidenceSha256 = `sha256:${createHash("sha256").update(changedEvidence).digest("hex")}`;
    const changedResult = await readJson(root, prepared.resultFile);
    changedResult.payload.results[0].actual = "UI environment remains unavailable";
    changedResult.payload.results[0].evidenceSha256 = changedEvidenceSha256;
    await write(root, prepared.resultFile, `${JSON.stringify(changedResult, null, 2)}\n`);

    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "approve-gap",
        caseId: "VC-001",
        reason: "接受证据更新后的验证缺口",
        beforeApprovalResultRename: async () => { throw new Error("simulated result write interruption"); },
      })),
      /result write interruption/i,
    );
    assert.equal(
      (await readJson(root, prepared.resultFile)).payload.results[0].approvalId,
      reasonChanged.approvalId,
    );
    const recoveredReceipt = await runStoryCommand(storyOptions(root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受证据更新后的验证缺口",
    }));
    assert.equal(recoveredReceipt.reused, true);
    assert.notEqual(recoveredReceipt.approvalId, reasonChanged.approvalId);

    let interruptedApprovalId = null;
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "approve-gap",
        caseId: "VC-001",
        reason: "接受命令返回前中断的验证缺口",
        afterApprovalResultWrite: async () => {
          interruptedApprovalId = (await readJson(root, prepared.resultFile)).payload.results[0].approvalId;
          throw new Error("simulated post-result interruption");
        },
      })),
      /post-result interruption/i,
    );
    const recoveredResult = await runStoryCommand(storyOptions(root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受命令返回前中断的验证缺口",
    }));
    assert.equal(recoveredResult.reused, true);
    assert.equal(recoveredResult.approvalId, interruptedApprovalId);

    const applied = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(applied.state.phase, "done");
    assert.equal(applied.state.approvals.length, 1);
    assert.equal(applied.state.approvals[0].approvalId, recoveredResult.approvalId);
    assert.equal(applied.state.approvals[0].receiptPath, recoveredResult.receiptFile);
    assert.match(applied.state.approvals[0].receiptSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(applied.state.acceptance.criteria[0].status, "accepted-with-known-gaps");
    assert.deepEqual(applied.state.acceptance.criteria[0].approvalIds, [recoveredResult.approvalId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function prepareGapApprovalFixture(storyId) {
  const fixture = await createFixture(storyId);
  await setFixtureState(fixture.root, fixture.storyId, (state) => {
    state.phase = "interface-verification";
    state.requirement.acceptanceCriteria = [{
      criterionId: "AC-001",
      description: "The UI result is verified.",
      source: "fixture",
      required: true,
    }];
    state.acceptance.criteria = [{
      criterionId: "AC-001",
      required: true,
      taskIds: [],
      testCaseIds: [],
      verificationCaseIds: [],
      status: "pending",
      approvalIds: [],
    }];
  });
  const prepared = await runStoryCommand(storyOptions(fixture.root, { command: "prepare" }));
  await write(fixture.root, prepared.task.expectedOutputs[0], "# UI environment unavailable\n");
  const evidencePath = `${prepared.task.attemptRoot}/evidence/ui-gap.md`;
  await write(fixture.root, evidencePath, "UI environment unavailable.\n");
  const evidence = await readFile(path.join(fixture.root, evidencePath));
  await writePreparedResult(fixture.root, prepared, dispatchResult(prepared.task, {
    payload: {
      cases: [{
        caseId: "VC-001",
        type: "ui-flow",
        required: true,
        criterionIds: ["AC-001"],
        action: "Open the page",
        expected: "The state is visible",
      }],
      results: [{
        caseId: "VC-001",
        status: "accepted-with-known-gaps",
        actual: "UI environment unavailable",
        evidencePath,
        evidenceSha256: `sha256:${createHash("sha256").update(evidence).digest("hex")}`,
        approvalId: null,
        executedAt: FIXED_NOW,
      }],
      environment: {
        status: "unavailable",
        summary: "UI environment unavailable",
        evidencePath: null,
        evidenceSha256: null,
      },
    },
  }));
  return { ...fixture, prepared };
}

async function testApproveGapAndApplyShareStoryWriteLock() {
  const approvalFirst = await prepareGapApprovalFixture("M7-A3-APPROVAL-FIRST");
  let releaseApproval;
  try {
    const approvalEntered = deferred();
    const approvalRelease = new Promise((resolve) => { releaseApproval = resolve; });
    const approving = runStoryCommand(storyOptions(approvalFirst.root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受并发测试中的验证缺口",
      beforeApprovalResultRename: async () => {
        approvalEntered.resolve();
        await approvalRelease;
      },
    }));
    await waitForSignal(approvalEntered.promise, "approve-gap lock");
    let applySettled = false;
    const applying = runStoryCommand(storyOptions(approvalFirst.root, { command: "apply" }))
      .finally(() => { applySettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(applySettled, false);
    releaseApproval();
    const [approval, applied] = await Promise.all([approving, applying]);
    assert.equal(applied.state.phase, "done");
    assert.equal(applied.state.approvals[0].approvalId, approval.approvalId);
  } finally {
    releaseApproval?.();
    await rm(approvalFirst.root, { recursive: true, force: true });
  }

  const applyFirst = await prepareGapApprovalFixture("M7-A3-APPLY-FIRST");
  let releaseApply;
  try {
    await runStoryCommand(storyOptions(applyFirst.root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "接受并发测试中的初始验证缺口",
    }));
    const resultBefore = await readFile(path.join(applyFirst.root, applyFirst.prepared.resultFile), "utf8");
    const applyEntered = deferred();
    const applyRelease = new Promise((resolve) => { releaseApply = resolve; });
    const applying = runStoryCommand(storyOptions(applyFirst.root, {
      command: "apply",
      beforeAdvance: async () => {
        applyEntered.resolve();
        await applyRelease;
      },
    }));
    await waitForSignal(applyEntered.promise, "apply lock");
    let approvalSettled = false;
    const lateApproval = runStoryCommand(storyOptions(applyFirst.root, {
      command: "approve-gap",
      caseId: "VC-001",
      reason: "不得覆盖完成后的批准",
    })).then(
      () => new Error("approve-gap unexpectedly succeeded"),
      (error) => error,
    ).finally(() => { approvalSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(approvalSettled, false);
    releaseApply();
    const applied = await applying;
    const approvalError = await lateApproval;
    assert.equal(applied.state.phase, "done");
    assert.match(approvalError.message, /completed run is immutable|active State v2 interface-verification/i);
    assert.equal(
      await readFile(path.join(applyFirst.root, applyFirst.prepared.resultFile), "utf8"),
      resultBefore,
    );
  } finally {
    releaseApply?.();
    await rm(applyFirst.root, { recursive: true, force: true });
  }
}

async function testVerifiedEvidenceDriftBlocksApplyWithoutStateChange() {
  const { root, storyId } = await createFixture("M7-A3-VERIFY-DRIFT");
  try {
    await setFixtureState(root, storyId, (state) => {
      state.phase = "interface-verification";
      state.requirement.acceptanceCriteria = [{
        criterionId: "AC-001",
        description: "The API is verified.",
        source: "fixture",
        required: true,
      }];
      state.acceptance.criteria = [{
        criterionId: "AC-001",
        required: true,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      }];
    });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await write(root, prepared.task.expectedOutputs[0], "# Verification\n");
    const evidencePath = `${prepared.task.attemptRoot}/evidence/api.md`;
    await write(root, evidencePath, "verified\n");
    const evidence = await readFile(path.join(root, evidencePath));
    const evidenceSha256 = `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      payload: {
        cases: [{
          caseId: "VC-001",
          type: "api",
          required: true,
          criterionIds: ["AC-001"],
          action: "Call API",
          expected: "Success",
        }],
        results: [{
          caseId: "VC-001",
          status: "verified",
          actual: "Success",
          evidencePath,
          evidenceSha256,
          approvalId: null,
          executedAt: FIXED_NOW,
        }],
        environment: {
          status: "available",
          summary: "Available",
          evidencePath: null,
          evidenceSha256: null,
        },
      },
    }));
    await write(root, evidencePath, "drifted\n");
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const before = await readFile(path.join(root, stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(root, { command: "apply" })),
      /verification evidence.*changed|evidence.*hash/i,
    );
    assert.equal(await readFile(path.join(root, stateFile), "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStructuredFailedTestsCannotAdvance() {
  const fixture = await createFixture("M3-GATE-STRUCTURED-TEST");
  try {
    await setFixtureState(fixture.root, fixture.storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(fixture.root, { command: "prepare" }));
    await runStoryCommand(storyOptions(fixture.root, {
      command: "run-adapter",
      adapter: "harness-state-tests",
      execute: async () => ({ exitCode: 0, stdout: "adapter passed", stderr: "" }),
    }));
    await write(fixture.root, prepared.task.expectedOutputs[0], "# Test report\n");
    await writePreparedResult(fixture.root, prepared, dispatchResult(prepared.task, {
      payload: {
        cases: [{
          caseId: "TC-FAILED",
          type: "unit",
          required: true,
          criterionIds: [],
          expected: "The structured test passes.",
        }],
        commands: [{
          commandId: "CMD-FAILED",
          command: "node failing-test.mjs",
          status: "failed",
          exitCode: 1,
          evidencePath: null,
          evidenceSha256: null,
          executedAt: FIXED_NOW,
        }],
        results: [{
          caseId: "TC-FAILED",
          status: "failed",
          actual: "The structured test failed.",
          evidencePath: null,
          evidenceSha256: null,
          executedAt: FIXED_NOW,
        }],
      },
    }));
    const stateFile = `.harness/states/e2e-${fixture.storyId}.json`;
    const stateBefore = await readFile(path.join(fixture.root, stateFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply" })),
      /failed.*test|test.*failed/i,
    );
    assert.equal(await readFile(path.join(fixture.root, stateFile), "utf8"), stateBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBlockedCodeReviewProjectsFindingsBeforeBlockingState() {
  const { root, storyId } = await createFixture("M8-A-BLOCKED-REVIEW");
  try {
    await setFixtureState(root, storyId, (state) => {
      state.phase = "code-review";
      state.runtime.previousPhase = "unit-test";
      state.review = { findings: [], status: "pending" };
    });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    const payload = {
      findings: [{
        findingId: "PF-1234567890ABCDEF",
        severity: "WARNING",
        status: "open",
        summary: "Provider fixture warning.",
        file: ".harness/scripts/lib/provider-runtime.mjs",
        line: 10,
        evidence: `${prepared.task.attemptRoot}/evidence/provider-review-response.json`,
      }],
      status: "blocked",
    };
    await write(
      root,
      payload.findings[0].evidence,
      `${JSON.stringify({ findings: payload.findings }, null, 2)}\n`,
    );
    const evidence = await readFile(path.join(root, payload.findings[0].evidence));
    await writePreparedResult(root, prepared, dispatchResultV2(prepared.task, {
      status: "blocked",
      summary: "Provider review found a warning.",
      outputs: [],
      records: [{
        type: "review",
        status: "BLOCKER",
        path: payload.findings[0].evidence,
        sha256: `sha256:${createHash("sha256").update(evidence).digest("hex")}`,
        bytes: evidence.length,
        message: "Provider review found a warning.",
        actor: "code-reviewer",
      }],
      payload,
      diagnostics: {
        code: "provider-review-findings",
        message: "Provider review found unresolved findings.",
        details: [payload.findings[0].findingId],
      },
      blocker: {
        reason: "Provider review found unresolved findings.",
        owner: "code-fixer",
        suggestedAction: "Fix findings and rerun review.",
      },
    }));

    const applied = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(applied.status, "blocked");
    assert.equal(applied.state.phase, "blocked");
    assert.deepEqual(applied.state.review, payload);
    assert.equal(applied.state.runtime.previousPhase, "code-review");
    assert.equal(applied.state.runtime.activeBlock.reason, "Provider review found unresolved findings.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testDispatchV12RequiresRuntimeDerivedWaveIdentity();
await testDispatchResultV12RequiresWaveScopedEvidence();
await testPrepareWaveCreatesRuntimeDerivedDispatchesWithoutAdvancingState();
await testPrepareWaveRejectsCoordinatedStoredStatusAndReceiptDrift();
await testPrepareWaveRejectsUnsupportedScopeAndCallerIdentity();
await testImplementationOwnerPreventsPreparationModeOverlap();
await testOrdinaryPrepareAcquiresImplementationOwner();
await testOrdinaryApplyRejectsImplementationOwnerIdentityDrift();
await testImplementationOwnerRejectsTaskDagPathDriftWithMatchingContent();
await testBatchPrepareAcquiresImplementationOwner();
await testLegacyWaveLedgerPreventsOrdinaryOwnerInference();
await testPrepareBatchCreatesTaskScopedDispatchesWithoutPhaseRootArtifacts();
await testBatchPreparationOwnsImplementationBeforeResolvingBase();
await testBatchCliArgumentsAndPowerShellEntryPointAreRegistered();
await testPrepareBatchRejectsNonImplementationAndSingleNodeInputsWithoutArtifacts();
await testOrdinaryPrepareCannotBypassAnUnfinalizedBatch();
await testPrepareBatchRejectsExistingOrdinaryImplementationArtifacts();
await testOrdinaryApplyCannotBypassAnUnfinalizedBatch();
await testOrdinaryM3FailsClosedOnAnInvalidBatchDirectory();
await testFinalizeBatchMaterializesPhaseArtifactsAndLeavesStateForApply();
await testFinalizedBatchReceiptDriftBlocksApplyWithoutMutation();
await testFinalizeBatchRejectsLinkedImplementationPhaseBeforeExternalWrites();
await testConcurrentFinalizeBatchRejectsOverlappingCheckpointBinding();
await testCoordinatedResultAndCheckpointHashDriftBlocksBatchApplyWithoutMutation();
await testFinalizedV1BatchCannotMutateReadOnlyState();
await testBatchRecoveryRejectsReceiptDriftAfterStateAdvance();
await testBatchRecoveryRejectsLedgerAndBindingDriftAfterStateAdvance();
await testBatchRecoveryRejectsCoordinatedLedgerStateFileAndBindingDriftAfterStateAdvance();
await testOrdinaryImplementationRecoveryAfterStateAdvance();
await testFinalizedBatchRequiresAMatchingCheckpointBinding();
await testBatchApplyRejectsCoordinatedFormalArtifactAndCheckpointDrift();
await testFinalizeBatchRejectsAnUnfinishedLedgerWithoutStateChange();
await testFinalizeBatchRejectsPreexistingPhaseArtifactsBeforeFinalizingLedger();
await testFinalizeBatchRejectsTaskScopedEvidenceRecordsBeforeFinalizingLedger();
await testFinalizeBatchRejectsTaskResultAndReportHashDriftBeforeFinalization();
await testFinalizeBatchRejectsLedgerRevisionDriftBeforePhaseArtifacts();
await testFinalizeBatchRejectsNonImplementationPhaseWithoutStateChange();
await testFinalizeBatchReusesFinalizedLedgerBeforeApply();
await testPrepareCreatesStructuredTaskAndCheckpoint();
testReworkUsesVersionedPhaseOutputs();
await testCheckKnowledgeUsesPreparedTechnicalDesignWithoutStateMutation();
await testInspectReportsKnowledgeRefreshAndEvidenceDrift();
await testRecheckKnowledgeReplacesDriftedResultArea();
await testApproveStaleProjectsFormalKnowledgeApproval();
console.log("M7D-SCENARIO:accepted-stale:passed");
await testRefreshKnowledgeUpdatesOnlyCurrentResult();
await testPrepareReusesCurrentPhaseTask();
await testStatusIsReadOnly();
await testInspectReportsValidatedCurrentDispatchState();
await testInspectTracksRequiredAdapterRuns();
await testInspectKeepsAdapterActionWhenAnyRunFailed();
await testInspectPrioritizesFailedResultOverAdapterRequirement();
await testInspectPrioritizesBlockedResultOverAdapterRequirement();
await testInspectReportsAdvancedResultRecovery();
await testInspectPrefersCurrentAttemptOverHistoricalRecovery();
await testInspectRequiresApprovalForAnyAcceptedGap();
await testInspectRejectsResultThatCannotPassPhaseGate();
await testPrepareRejectsBlockedAndCompletedRuns();
await testPrepareFailsClosedOnDamagedExistingTask();
await testPrepareRejectsTaskOrCheckpointContractMismatch();
await testPrepareRejectsNormalizedOutputOutsidePhaseDirectory();
await testRunAdapterUsesFixedArgvAndRecordsPassedTest();
await testRunAdapterRejectsUnknownOrWrongPhaseAdapter();
await testRunAdapterPersistsAndRecordsFailure();
await testPlatformCommandAdaptersUseFixedExecutableAndArguments();
await testRunAdapterSupportsNormalLargeCommandOutput();
await testDispatchV2ContractsUseAttemptScopedIdentity();
await testDispatchV2PhasePayloadsAreStrict();
await testApplyCompletedResultAdvancesThroughM2();
await testApplyDeduplicatesManualAndAutomaticOutputRecords();
console.log("M7D-SCENARIO:duplicate-apply:passed");
await testApplyRejectsMissingOutputAndIdentityMismatchWithoutStateChange();
await testApplyFailedAndBlockedResultsKeepDeterministicState();
await testApplyKeepsStateUnchangedBeforeAtomicProjection();
await testFailedAdapterAndBlockerCannotAdvanceUntilResolved();
await testStructuredFailedTestsCannotAdvance();
await testBlockedCodeReviewProjectsFindingsBeforeBlockingState();
await testBuildPhaseRequiresACommandAdapterResult();
await testNoBuildAdapterRejectsBackendOrFrontendChanges();
await testApplyReconcilesAfterAdvanceBeforeCheckpointWrite();
console.log("M7D-SCENARIO:interruption-recovery:passed");
await testApplyRebuildsMissingAttemptPointerFromFormalResultIndex();
console.log("M7D-SCENARIO:result-drift:passed");
await testBlockedApplyRecoversProcessFilesFromFormalResultIndex();
await testBuildPhaseRejectsChangedAdapterEvidence();
await testCodeReviewRequiresPassedReviewEvidence();
await testCompleteSingleStoryVerticalSlice();
console.log("M7D-SCENARIO:no-git-completion:passed");
await testRequirementAcceptanceGateRejectsBeforePersistence();
await testApproveGapWritesAttemptReceiptWithoutChangingState();
console.log("M7D-SCENARIO:accepted-gap:passed");
await testApproveGapAndApplyShareStoryWriteLock();
await testVerifiedEvidenceDriftBlocksApplyWithoutStateChange();
await testM3RuntimeIsRegisteredInHarnessContracts();
console.log("story-runtime tests passed");
