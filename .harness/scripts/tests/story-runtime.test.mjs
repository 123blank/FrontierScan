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
import { runStoryCommand } from "../lib/story-runtime.mjs";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";

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

async function createFixture(storyId = "M3-PREP", fixtureParent = os.tmpdir()) {
  const root = await mkdtemp(path.join(fixtureParent, "frontier-story-runtime-"));
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
  await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
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
  const fixture = await createFixture(storyId);
  await git(fixture.root, "init", "-b", "dev");
  await git(fixture.root, "config", "user.email", "m3-batch@example.test");
  await git(fixture.root, "config", "user.name", "M3 Batch Test");
  await write(fixture.root, "seed.txt", "seed\n");
  await git(fixture.root, "add", "seed.txt");
  await git(fixture.root, "commit", "-m", "fixture");

  await write(fixture.root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
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
  await setFixtureState(fixture.root, fixture.storyId, (state) => {
    state.phase = "implementation";
  });
  const taskDagFile = `.harness/runs/${fixture.storyId}/phases/02-task-dag/task-dag.json`;
  await write(fixture.root, taskDagFile, `${JSON.stringify({
    schemaVersion: "1.0",
    storyId: fixture.storyId,
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
    ...fixture,
    stateFile: `.harness/states/e2e-${fixture.storyId}.json`,
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

    const applied = await runStoryCommand(storyOptions(fixture.root, {
      command: "apply",
      stateFile: fixture.stateFile,
    }));
    assert.equal(applied.state.phase, "unit-test");
    const stateAfterApply = await readFile(path.join(fixture.root, fixture.stateFile), "utf8");
    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /prepare|result/i,
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

async function testBatchApplyResumesAfterRecordBeforeAdvance() {
  const fixture = await createBatchPrepareFixture("M3-BATCH-APPLY-RESUME");
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

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
        beforeAdvance: async () => { throw new Error("simulated pre-advance interruption"); },
      })),
      /pre-advance interruption/i,
    );
    const interrupted = await readJson(fixture.root, fixture.stateFile);
    assert.equal(interrupted.phase, "implementation");
    assert.ok(interrupted.runtime.revision > finalized.task.preparedRevision);
    assert.equal(interrupted.runtime.records.length, 3);
    assert.equal((await readJson(fixture.root, finalized.checkpointFile)).status, "result-received");

    const resumed = await runStoryCommand(storyOptions(fixture.root, {
      command: "apply",
      stateFile: fixture.stateFile,
    }));
    assert.equal(resumed.state.phase, "unit-test");
    const completed = await readJson(fixture.root, fixture.stateFile);
    assert.equal(completed.runtime.records.filter((record) => record.type === "note").length, 3);
    assert.equal(completed.runtime.revision, interrupted.runtime.revision + 1);
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

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
        afterAdvance: async () => { throw new Error("simulated post-advance interruption"); },
      })),
      /post-advance interruption/i,
    );
    assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "unit-test");
    assert.equal((await readJson(fixture.root, finalized.checkpointFile)).status, "result-received");

    const receipt = await readFile(path.join(fixture.root, finalized.receiptFile), "utf8");
    await write(fixture.root, finalized.receiptFile, `${receipt}\n`);
    const checkpointBeforeRetry = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
      /receipt.*drift|batch.*binding|finalized.*batch/i,
    );
    assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBeforeRetry);
    assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "unit-test");
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
      await assert.rejects(
        runStoryCommand(storyOptions(fixture.root, {
          command: "apply",
          stateFile: fixture.stateFile,
          afterAdvance: async () => { throw new Error("simulated post-advance interruption"); },
        })),
        /post-advance interruption/i,
      );

      await scenario.mutate(fixture, prepared, finalized);
      const checkpointBeforeRetry = await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8");
      await assert.rejects(
        runStoryCommand(storyOptions(fixture.root, { command: "apply", stateFile: fixture.stateFile })),
        scenario.expected,
      );
      assert.equal(await readFile(path.join(fixture.root, finalized.checkpointFile), "utf8"), checkpointBeforeRetry);
      assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "unit-test");
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

    await assert.rejects(
      runStoryCommand(storyOptions(fixture.root, {
        command: "apply",
        stateFile: fixture.stateFile,
        afterAdvance: async () => { throw new Error("simulated post-advance interruption"); },
      })),
      /post-advance interruption/i,
    );

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
  const fixture = await createBatchPrepareFixture("M3-ORDINARY-IMPLEMENTATION-RECOVERY");
  try {
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
    assert.equal((await readJson(fixture.root, prepared.checkpointFile)).status, "result-received");
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
    assert.equal(result.command, "prepare");
    assert.equal(result.taskFile, `${phaseRoot}/task.json`);
    assert.equal(result.checkpointFile, `${phaseRoot}/checkpoint.json`);

    const task = await readJson(root, result.taskFile);
    assert.deepEqual(task, {
      schemaVersion: "1.0",
      dispatchId: FIXED_DISPATCH_ID,
      storyId,
      phase: "requirement",
      ownerAgent: "requirement-analyst",
      purpose: "Clarify the story.",
      preparedRevision: 1,
      preparedAt: FIXED_NOW,
      expectedOutputs: [`${phaseRoot}/requirement-breakdown.md`],
      allowedAdapters: [],
      next: "technical-design",
    });
    const checkpoint = await readJson(root, result.checkpointFile);
    assert.equal(checkpoint.status, "prepared");
    assert.equal(checkpoint.dispatchId, FIXED_DISPATCH_ID);
    assert.equal(checkpoint.preparedAt, FIXED_NOW);
    assert.equal(checkpoint.updatedAt, FIXED_NOW);
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
    await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
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
    await runStoryCommand(storyOptions(root, { command: "prepare" }));
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

    const state = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(state.tests.results.at(-1).status, "passed");
    assert.equal(state.tests.results.at(-1).path, result.evidencePath);
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
    await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "run-adapter",
        adapter: "harness-state-tests",
        execute: async () => ({ exitCode: 7, stdout: "", stderr: "test failed" }),
      })),
      /exit code 7/i,
    );

    const evidencePath = `.harness/runs/${storyId}/phases/04-unit-test/evidence/harness-state-tests.json`;
    const evidence = await readJson(root, evidencePath);
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.exitCode, 7);
    const state = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(state.tests.results.at(-1).status, "failed");
    assert.equal(state.tests.results.at(-1).path, evidencePath);
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

async function writePreparedResult(root, prepared, result) {
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
    assert.equal(state.runtime.records.at(-1).path, prepared.task.expectedOutputs[0]);
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
      /required output.*missing|missing.*required output/i,
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
  } finally {
    await rm(failed.root, { recursive: true, force: true });
  }

  const blocked = await createFixture("M3-APPLY-BLOCKED");
  try {
    const prepared = await runStoryCommand(storyOptions(blocked.root, { command: "prepare" }));
    await writePreparedResult(blocked.root, prepared, dispatchResult(prepared.task, {
      status: "blocked",
      summary: "decision required",
      outputs: [],
      blocker: { reason: "decision required", owner: "user", suggestedAction: "choose an option" },
    }));
    const applied = await runStoryCommand(storyOptions(blocked.root, { command: "apply" }));
    assert.equal(applied.status, "blocked");
    assert.equal(applied.state.phase, "blocked");
    assert.equal(applied.state.runtime.blocked.previousPhase, "requirement");
    assert.equal((await readJson(blocked.root, prepared.checkpointFile)).status, "blocked");
  } finally {
    await rm(blocked.root, { recursive: true, force: true });
  }
}

async function testApplyResumesAfterRecordBeforeAdvance() {
  const { root, storyId } = await createFixture("M3-APPLY-RESUME");
  try {
    await setFixtureState(root, storyId, (state) => { state.phase = "unit-test"; });
    const prepared = await runStoryCommand(storyOptions(root, { command: "prepare" }));
    await runStoryCommand(storyOptions(root, {
      command: "run-adapter",
      adapter: "harness-structure",
      execute: async () => ({ exitCode: 0, stdout: "passed", stderr: "" }),
    }));
    const reportPath = prepared.task.expectedOutputs[0];
    await write(root, reportPath, "# Tests passed\n");
    await writePreparedResult(root, prepared, dispatchResult(prepared.task, {
      records: [{ type: "test", status: "passed", path: reportPath, message: "targeted tests passed" }],
    }));

    await assert.rejects(
      runStoryCommand(storyOptions(root, {
        command: "apply",
        beforeAdvance: async () => { throw new Error("simulated interruption"); },
      })),
      /simulated interruption/,
    );
    const interrupted = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(interrupted.phase, "unit-test");
    assert.equal(interrupted.tests.results.length, 2);

    const resumed = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(resumed.state.phase, "code-review");
    const completed = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(completed.tests.results.length, 2);
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
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "result-received");

    const resumed = await runStoryCommand(storyOptions(root, { command: "apply" }));
    assert.equal(resumed.status, "already-applied");
    assert.equal(resumed.state.phase, "technical-design");
    assert.equal((await readJson(root, prepared.checkpointFile)).status, "completed");
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
    await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
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
      - git-delivery
  - id: git-delivery
    order: 8
    owner_agent: git-committer
    purpose: Prepare delivery summary.
    required_outputs:
      - .harness/runs/{runId}/phases/08-git-delivery/delivery-report.md
    next:
      - done
quality_gates:
  - phase: task-dag
    rule: DAG must be valid.
  - phase: unit-test
    rule: Failed tests block.
  - phase: code-review
    rule: BLOCKER findings block.
  - phase: git-delivery
    rule: User approval is required.
`);
    await write(root, ".harness/scripts/validate-task-dag.ps1", "param([string]$TaskDagFile)\nexit 0\n");
    const phases = [
      "requirement", "technical-design", "task-dag", "implementation", "unit-test",
      "code-review", "build-publish", "interface-verification", "git-delivery",
    ];

    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      const prepared = await runStoryCommand(storyOptions(root, {
        command: "prepare",
        randomUUID: () => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      }));
      assert.equal(prepared.task.phase, phase);
      assert.equal(prepared.task.preparedAt, FIXED_NOW);
      assert.match(prepared.taskFile, new RegExp(`/phases/${String(index).padStart(2, "0")}-${phase}/task\\.json$`));
      const outputPath = prepared.task.expectedOutputs[0];
      await write(root, outputPath, phase === "task-dag" ? "{}\n" : `# ${phase}\n`);

      if (phase === "unit-test") {
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
      await writePreparedResult(root, prepared, dispatchResult(prepared.task, { records }));
      if (phase === "git-delivery") {
        await runStateCommand({
          root,
          command: "record",
          recordType: "approval",
          status: "approved",
          actor: "user",
          message: "fixture approval for state completion only",
          path: outputPath,
          now: () => FIXED_NOW,
        });
      }
      const applied = await runStoryCommand(storyOptions(root, { command: "apply" }));
      const expected = phases[index + 1] ?? "done";
      assert.equal(applied.state.phase, expected);
      assert.equal((await readJson(root, prepared.checkpointFile)).status, "completed");
      const restarted = await runStoryCommand(storyOptions(root, { command: "status" }));
      assert.equal(restarted.state.phase, expected);
    }

    const finalState = await readJson(root, `.harness/states/e2e-${storyId}.json`);
    assert.equal(finalState.runtime.status, "completed");
    assert.equal(finalState.phase, "done");
    assert.equal(finalState.runtime.records.filter((record) => record.type === "output").length, phases.length);
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
    ".harness/scripts/run-story.ps1",
    ".harness/scripts/lib/story-runtime.mjs",
    ".harness/scripts/lib/batch-finalization-contract.mjs",
    ".harness/scripts/tests/story-runtime.test.mjs",
    "docs/harness-m3-agent-dispatcher",
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
await testBatchApplyResumesAfterRecordBeforeAdvance();
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
await testPrepareReusesCurrentPhaseTask();
await testStatusIsReadOnly();
await testPrepareRejectsBlockedAndCompletedRuns();
await testPrepareFailsClosedOnDamagedExistingTask();
await testPrepareRejectsTaskOrCheckpointContractMismatch();
await testPrepareRejectsNormalizedOutputOutsidePhaseDirectory();
await testRunAdapterUsesFixedArgvAndRecordsPassedTest();
await testRunAdapterRejectsUnknownOrWrongPhaseAdapter();
await testRunAdapterPersistsAndRecordsFailure();
await testPlatformCommandAdaptersUseFixedExecutableAndArguments();
await testRunAdapterSupportsNormalLargeCommandOutput();
await testApplyCompletedResultAdvancesThroughM2();
await testApplyRejectsMissingOutputAndIdentityMismatchWithoutStateChange();
await testApplyFailedAndBlockedResultsKeepDeterministicState();
await testApplyResumesAfterRecordBeforeAdvance();
await testFailedAdapterAndBlockerCannotAdvanceUntilResolved();
await testBuildPhaseRequiresACommandAdapterResult();
await testNoBuildAdapterRejectsBackendOrFrontendChanges();
await testApplyReconcilesAfterAdvanceBeforeCheckpointWrite();
await testBuildPhaseRejectsChangedAdapterEvidence();
await testCodeReviewRequiresPassedReviewEvidence();
await testCompleteSingleStoryVerticalSlice();
await testM3RuntimeIsRegisteredInHarnessContracts();
console.log("story-runtime tests passed");
