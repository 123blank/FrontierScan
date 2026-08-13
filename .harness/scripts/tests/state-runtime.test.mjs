import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm as removePath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  parsePorcelainV1Z,
  readWorkflowDefinition,
  runStateCommand,
} from "../lib/state-runtime.mjs";
import {
  assertStateCommandAllowed,
  detectE2EStateVersion,
  validateStateDocument,
} from "../lib/state-contract.mjs";

const FIXED_NOW = "2026-07-16T00:00:00.000Z";
const RUN_STATE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "run-state.ps1");
const RUN_STORY_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "run-story.ps1");
const STATE_RUNTIME_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "state-runtime.mjs");
const STATE_CONTRACT_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "state-contract.mjs");
const STORY_RUNTIME_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "story-runtime.mjs");
const DISPATCH_CONTRACT_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "dispatch-contract.mjs");
const PHASE_DATA_CONTRACT_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "phase-data-contract.mjs");
const PHASE_RESULT_PROJECTOR_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "phase-result-projector.mjs");
const TASK_DAG_CONTRACT_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "task-dag-contract.mjs");
const BATCH_FINALIZATION_CONTRACT_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "batch-finalization-contract.mjs");
const IMPLEMENTATION_OWNER_CONTRACT_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "implementation-owner-contract.mjs");
const VALIDATE_STATE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "validate-state.ps1");
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const execFileAsync = promisify(execFile);

function rm(filePath, options = {}) {
  return removePath(filePath, {
    maxRetries: 5,
    retryDelay: 100,
    ...options,
  });
}

function execPowerShellScript(script, argumentsList) {
  return new Promise((resolve) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      ...argumentsList,
    ], { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ exitCode: error?.code ?? 0, stdout, stderr });
    });
  });
}

function execPowerShell(argumentsList) {
  return execPowerShellScript(RUN_STATE_SCRIPT, argumentsList);
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

async function createFixture(fixtureParent = os.tmpdir()) {
  const root = await mkdtemp(path.join(fixtureParent, "frontier-state-runtime-"));
  await execFileAsync("git", ["init", "-b", "dev"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "state-runtime@example.test"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "State Runtime Test"], { cwd: root, windowsHide: true });
  await write(root, "seed.txt", "seed");
  await execFileAsync("git", ["add", "seed.txt"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "seed"], { cwd: root, windowsHide: true });
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
  await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
phases:
  - id: requirement
    order: 0
    required_outputs:
      - .harness/outputs/requirement-breakdown.md
    next:
      - technical-design
  - id: technical-design
    order: 1
    required_outputs:
      - .harness/outputs/technical-design.md
    next:
      - done
quality_gates: []
`);
  await write(
    root,
    ".harness/workflows/e2e-development-v2.yaml",
    await readFile(path.join(REPOSITORY_ROOT, ".harness/workflows/e2e-development-v2.yaml"), "utf8"),
  );
  await execFileAsync("git", ["add", ".harness"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "add harness fixtures"], { cwd: root, windowsHide: true });
  return { root, template };
}

async function writeGateWorkflow(root) {
  await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: unit-test
    order: 0
    required_outputs:
      - .harness/reports/test-report.md
    next:
      - code-review
  - id: code-review
    order: 1
    required_outputs:
      - .harness/reports/code-review-report.md
    next:
      - build-publish
  - id: build-publish
    order: 2
    required_outputs:
      - .harness/reports/build-report.md
    next:
      - done
quality_gates:
  - phase: unit-test
    rule: Failed required tests block the workflow.
  - phase: code-review
    rule: BLOCKER findings block build.
`);
}

async function setRunPhase(root, storyId, phase) {
  const relative = `.harness/states/e2e-${storyId}.json`;
  const state = await readJson(root, relative);
  state.phase = phase;
  state.runtime.previousPhase = null;
  await write(root, relative, `${JSON.stringify(state, null, 2)}\n`);
}

async function testInitCreatesRunAndPointerWithoutEditingTemplate() {
  const { root } = await createFixture();
  try {
    const templatePath = path.join(root, ".harness/states/e2e-state-v2.template.json");
    const originalTemplate = await readFile(templatePath, "utf8");
    const result = await runStateCommand({
      root,
      command: "init",
      storyId: "M2-001",
      summary: "验证状态运行时",
      now: () => FIXED_NOW,
    });

    assert.equal(result.state.phase, "requirement");
    assert.equal(result.state.schemaVersion, "2.0");
    assert.equal(result.state.storyId, "M2-001");
    assert.equal(result.state.requirement.summary, "验证状态运行时");
    assert.equal(result.state.runtime.revision, 1);
    assert.equal(result.state.runtime.workflow, ".harness/workflows/e2e-development-v2.yaml");
    assert.equal(result.state.runtime.workflowVersion, "2.0");
    assert.match(result.state.baseline.head, /^[a-f0-9]{40}$/);
    assert.equal(result.state.baseline.branch, "dev");
    assert.deepEqual(result.state.baseline.initialDirtyPaths, []);
    assert.equal(result.pointer.stateFile, ".harness/states/e2e-M2-001.json");
    assert.equal(await readFile(templatePath, "utf8"), originalTemplate);

    const persisted = await readJson(root, ".harness/states/e2e-M2-001.json");
    const pointer = await readJson(root, ".harness/states/active-run.json");
    assert.equal(persisted.runtime.runId, "M2-001");
    assert.equal(pointer.runId, "M2-001");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStatusLocatesRunThroughPointer() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-002", summary: "resume", now: () => FIXED_NOW });
    const result = await runStateCommand({ root, command: "status", now: () => FIXED_NOW });
    assert.equal(result.state.storyId, "M2-002");
    assert.equal(result.state.runtime.status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testExplicitStateFileIsIndependentFromActivePointer() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-003", summary: "explicit state", now: () => FIXED_NOW });
    const stateFile = ".harness/states/e2e-M2-003.json";
    const pointerFile = path.join(root, ".harness/states/active-run.json");
    await rm(pointerFile);

    const status = await runStateCommand({ root, command: "status", stateFile });
    assert.equal(status.state.storyId, "M2-003");
    assert.equal(status.pointer, null);

    const otherPointer = {
      schemaVersion: "1.0",
      runId: "M2-OTHER",
      stateFile: ".harness/states/e2e-M2-OTHER.json",
      status: "active",
      revision: 7,
      updatedAt: FIXED_NOW,
    };
    await writeFile(pointerFile, `${JSON.stringify(otherPointer, null, 2)}\n`, "utf8");
    const recorded = await runStateCommand({
      root,
      command: "record",
      stateFile,
      recordType: "note",
      status: "recorded",
      message: "explicit update",
      now: () => FIXED_NOW,
    });
    assert.equal(recorded.pointer, null);
    assert.deepEqual(JSON.parse(await readFile(pointerFile, "utf8")), otherPointer);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitRejectsInvalidOrDuplicateRun() {
  const { root } = await createFixture();
  try {
    await assert.rejects(
      runStateCommand({ root, command: "init", storyId: "../escape", summary: "bad", now: () => FIXED_NOW }),
      /storyId/i,
    );
    await runStateCommand({ root, command: "init", storyId: "M2-003", summary: "first", now: () => FIXED_NOW });
    await assert.rejects(
      runStateCommand({ root, command: "init", storyId: "M2-004", summary: "second", now: () => FIXED_NOW }),
      /active run already exists/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitRejectsRecoverableActivePointer() {
  for (const suffix of ["tmp", "bak"]) {
    const { root } = await createFixture();
    try {
      const existingStoryId = `M2-RECOVER-${suffix}`;
      await runStateCommand({ root, command: "init", storyId: existingStoryId, summary: "recoverable pointer", now: () => FIXED_NOW });
      const pointerPath = path.join(root, ".harness/states/active-run.json");
      const candidatePath = `${pointerPath}.${suffix}`;
      const pointerSource = await readFile(pointerPath, "utf8");
      await writeFile(candidatePath, pointerSource, "utf8");
      await rm(pointerPath);

      const newStoryId = `M2-NEW-${suffix}`;
      await assert.rejects(
        runStateCommand({ root, command: "init", storyId: newStoryId, summary: "must not replace active run", now: () => FIXED_NOW }),
        /active run already exists/i,
      );
      assert.equal(await readFile(candidatePath, "utf8"), pointerSource);
      await assert.rejects(
        readFile(path.join(root, `.harness/states/e2e-${newStoryId}.json`), "utf8"),
        (error) => error?.code === "ENOENT",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testInitKeepsNewRunDiscoverableAfterCompletedRun() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-COMPLETED", summary: "completed run", now: () => FIXED_NOW });
    const oldStateFile = ".harness/states/e2e-M2-COMPLETED.json";
    const oldState = await readJson(root, oldStateFile);
    oldState.phase = "done";
    oldState.runtime.status = "completed";
    oldState.runtime.revision = 9;
    await write(root, oldStateFile, `${JSON.stringify(oldState, null, 2)}\n`);
    const oldPointer = await readJson(root, ".harness/states/active-run.json");
    oldPointer.status = "completed";
    oldPointer.revision = 9;
    await write(root, ".harness/states/active-run.json", `${JSON.stringify(oldPointer, null, 2)}\n`);

    await runStateCommand({ root, command: "init", storyId: "M2-CURRENT", summary: "current run", now: () => FIXED_NOW });
    const status = await runStateCommand({ root, command: "status" });
    assert.equal(status.state.storyId, "M2-CURRENT");
    assert.equal(status.state.runtime.status, "active");
    assert.equal(status.pointer.runId, "M2-CURRENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStatusRecoversNewRunPointerFromInterruptedReplacement() {
  for (const keepPrimary of [true, false]) {
    const { root } = await createFixture();
    try {
      await runStateCommand({ root, command: "init", storyId: "M2-OLD", summary: "old run", now: () => FIXED_NOW });
      const pointerPath = path.join(root, ".harness/states/active-run.json");
      const oldPointer = await readJson(root, ".harness/states/active-run.json");
      oldPointer.status = "completed";
      oldPointer.revision = 9;
      await writeFile(pointerPath, `${JSON.stringify(oldPointer, null, 2)}\n`, "utf8");
      await writeFile(`${pointerPath}.bak`, `${JSON.stringify(oldPointer, null, 2)}\n`, "utf8");

      const newState = await readJson(root, ".harness/states/e2e-M2-OLD.json");
      newState.storyId = "M2-NEW";
      newState.requirement.summary = "new run";
      newState.runtime.runId = "M2-NEW";
      newState.runtime.revision = 1;
      newState.runtime.updatedAt = "2026-07-16T00:01:00.000Z";
      await write(root, ".harness/states/e2e-M2-NEW.json", `${JSON.stringify(newState, null, 2)}\n`);
      const newPointer = {
        ...oldPointer,
        runId: "M2-NEW",
        stateFile: ".harness/states/e2e-M2-NEW.json",
        status: "active",
        revision: 1,
        updatedAt: "2026-07-16T00:01:00.000Z",
      };
      await writeFile(`${pointerPath}.tmp`, `${JSON.stringify(newPointer, null, 2)}\n`, "utf8");
      if (!keepPrimary) await rm(pointerPath);

      const status = await runStateCommand({ root, command: "status" });
      assert.equal(status.state.storyId, "M2-NEW");
      assert.equal(status.pointer.runId, "M2-NEW");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testInitRejectsExistingCompletedStory() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-005", summary: "completed run", now: () => FIXED_NOW });
    const stateFile = ".harness/states/e2e-M2-005.json";
    const state = await readJson(root, stateFile);
    state.phase = "done";
    state.runtime.status = "completed";
    await write(root, stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const pointer = await readJson(root, ".harness/states/active-run.json");
    pointer.status = "completed";
    await write(root, ".harness/states/active-run.json", `${JSON.stringify(pointer, null, 2)}\n`);

    await assert.rejects(
      runStateCommand({ root, command: "init", storyId: "M2-005", summary: "replacement", now: () => FIXED_NOW }),
      /state file already exists/i,
    );
    const unchanged = await readJson(root, stateFile);
    assert.equal(unchanged.requirement.summary, "completed run");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNextRequiresOutputsAndFollowsWorkflow() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-010", summary: "advance", now: () => FIXED_NOW });
    const before = await readJson(root, ".harness/states/e2e-M2-010.json");
    await assert.rejects(
      runStateCommand({ root, command: "next", now: () => FIXED_NOW }),
      /required output.*requirement-breakdown\.md/i,
    );
    const unchanged = await readJson(root, ".harness/states/e2e-M2-010.json");
    assert.equal(unchanged.phase, before.phase);
    assert.equal(unchanged.runtime.revision, before.runtime.revision);

    await write(
      root,
      ".harness/runs/M2-010/phases/00-requirement/requirement-breakdown.md",
      "# Requirement\n",
    );
    const advanced = await runStateCommand({ root, command: "next", now: () => "2026-07-16T00:01:00.000Z" });
    assert.equal(advanced.state.phase, "technical-design");
    assert.equal(advanced.state.runtime.previousPhase, "requirement");
    assert.equal(advanced.state.runtime.revision, 2);
    assert.equal(advanced.state.runtime.records[0].type, "output");
    assert.match(advanced.state.runtime.records[0].sha256, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNextExpandsRunScopedRequiredOutput() {
  const { root } = await createFixture();
  try {
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: requirement
    order: 0
    required_outputs:
      - .harness/runs/{runId}/phases/00-requirement/requirement-breakdown.md
    next:
      - technical-design
  - id: technical-design
    order: 1
    required_outputs: []
    next:
      - done
quality_gates: []
`);
    await runStateCommand({ root, command: "init", storyId: "M3-RUN", summary: "run scoped", now: () => FIXED_NOW });
    await write(root, ".harness/outputs/requirement-breakdown.md", "legacy output");

    await assert.rejects(
      runStateCommand({ root, command: "next", now: () => FIXED_NOW }),
      /\.harness\/runs\/M3-RUN\/phases\/00-requirement\/requirement-breakdown\.md/,
    );

    const expected = ".harness/runs/M3-RUN/phases/00-requirement/requirement-breakdown.md";
    await write(root, expected, "run output");
    const advanced = await runStateCommand({ root, command: "next", now: () => FIXED_NOW });
    assert.equal(advanced.state.phase, "technical-design");
    assert.equal(advanced.state.runtime.records.at(-1).path, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testTaskDagGateUsesExpandedRequiredOutput() {
  const { root } = await createFixture();
  try {
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: task-dag
    order: 0
    required_outputs:
      - .harness/runs/{runId}/phases/02-task-dag/task-dag.json
    next:
      - implementation
  - id: implementation
    order: 1
    required_outputs: []
    next:
      - done
quality_gates:
  - phase: task-dag
    rule: DAG must be valid.
`);
    await runStateCommand({ root, command: "init", storyId: "M3-DAG", summary: "run dag", now: () => FIXED_NOW });
    await setRunPhase(root, "M3-DAG", "task-dag");
    const expected = ".harness/runs/M3-DAG/phases/02-task-dag/task-dag.json";
    await write(root, expected, "{}");
    let validatedPath = null;

    const advanced = await runStateCommand({
      root,
      command: "next",
      now: () => FIXED_NOW,
      taskDagValidator: async (dagPath) => {
        validatedPath = path.relative(root, dagPath).replaceAll("\\", "/");
      },
    });

    assert.equal(advanced.state.phase, "implementation");
    assert.equal(validatedPath, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNextRejectsMalformedWorkflow() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-011", summary: "workflow", now: () => FIXED_NOW });
    await write(root, ".harness/outputs/requirement-breakdown.md", "# Requirement\n");
    await write(root, ".harness/workflows/e2e-development-v2.yaml", "phases:\n   - id: requirement\n");
    await assert.rejects(
      runStateCommand({ root, command: "next", now: () => FIXED_NOW }),
      /workflow/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRecordAndTestGate() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-020", summary: "test gate", now: () => FIXED_NOW });
    await writeGateWorkflow(root);
    await setRunPhase(root, "M2-020", "unit-test");
    await write(root, ".harness/reports/test-report.md", "# Tests\n");
    await assert.rejects(runStateCommand({
      root,
      command: "record",
      recordType: "test",
      status: "failed",
      message: "missing evidence",
      now: () => FIXED_NOW,
    }), /test evidence path/i);
    const recorded = await runStateCommand({
      root,
      command: "record",
      recordType: "test",
      status: "failed",
      path: ".harness/reports/test-report.md",
      message: "unit test failed",
      now: () => "2026-07-16T00:02:00.000Z",
    });
    assert.equal(recorded.state.tests.results.length, 0);
    assert.equal(recorded.state.runtime.records.filter((item) => item.type === "test").length, 1);
    const revision = recorded.state.runtime.revision;
    await assert.rejects(runStateCommand({ root, command: "next", now: () => FIXED_NOW }), /failed required tests/i);
    const unchanged = await readJson(root, ".harness/states/e2e-M2-020.json");
    assert.equal(unchanged.runtime.revision, revision);
    assert.equal(unchanged.phase, "unit-test");

    await runStateCommand({
      root,
      command: "record",
      recordType: "test",
      status: "passed",
      path: ".harness/reports/test-report.md",
      message: "unit test rerun passed",
      now: () => "2026-07-16T00:03:00.000Z",
    });
    await write(root, ".harness/reports/test-report.md", "# Changed after pass\n");
    await assert.rejects(
      runStateCommand({ root, command: "next", now: () => FIXED_NOW }),
      /test evidence.*changed/i,
    );
    await runStateCommand({
      root,
      command: "record",
      recordType: "test",
      status: "passed",
      path: ".harness/reports/test-report.md",
      message: "changed test report passed",
      now: () => "2026-07-16T00:04:00.000Z",
    });
    const advanced = await runStateCommand({ root, command: "next", now: () => FIXED_NOW });
    assert.equal(advanced.state.phase, "code-review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testReviewBlockerGate() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-021", summary: "review gate", now: () => FIXED_NOW });
    await writeGateWorkflow(root);
    await setRunPhase(root, "M2-021", "code-review");
    await write(root, ".harness/reports/code-review-report.md", "# Review\n");
    await runStateCommand({
      root,
      command: "record",
      recordType: "review",
      status: "BLOCKER",
      message: "data corruption",
      now: () => FIXED_NOW,
    });
    await assert.rejects(runStateCommand({ root, command: "next", now: () => FIXED_NOW }), /unresolved BLOCKER/i);
    await runStateCommand({
      root,
      command: "record",
      recordType: "review",
      status: "resolved",
      message: "data corruption",
      now: () => "2026-07-16T00:01:00.000Z",
    });
    const advanced = await runStateCommand({ root, command: "next", now: () => FIXED_NOW });
    assert.equal(advanced.state.phase, "build-publish");
    assert.deepEqual(advanced.state.review, { findings: [], status: "pending" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBlockAndResumeRestorePreviousPhase() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-022", summary: "blocking", now: () => FIXED_NOW });
    const blocked = await runStateCommand({
      root,
      command: "block",
      reason: "need decision",
      owner: "user",
      suggestedAction: "approve scope",
      now: () => "2026-07-16T00:03:00.000Z",
    });
    assert.equal(blocked.state.phase, "blocked");
    assert.equal(blocked.state.runtime.status, "blocked");
    assert.equal(blocked.state.runtime.activeBlock.previousPhase, "requirement");
    assert.equal(blocked.state.logs.at(-1).type, "blocked");
    assert.equal(blocked.pointer.status, "blocked");

    const resumed = await runStateCommand({ root, command: "resume", now: () => "2026-07-16T00:04:00.000Z" });
    assert.equal(resumed.state.phase, "requirement");
    assert.equal(resumed.state.runtime.status, "active");
    assert.equal(resumed.state.runtime.previousPhase, "blocked");
    assert.equal(resumed.state.runtime.activeBlock, null);
    assert.deepEqual(resumed.state.logs.slice(-2).map((item) => item.type), ["blocked", "resumed"]);
    const events = (await readFile(
      path.join(root, ".harness/states/e2e-M2-022.events.jsonl"),
      "utf8",
    )).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      events.filter((event) => ["block", "resume"].includes(event.action)).map((event) => event.event),
      ["intent", "committed", "intent", "committed"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPassedTestsAdvanceAndTaskDagValidatorBlocks() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-023", summary: "passing gate", now: () => FIXED_NOW });
    await writeGateWorkflow(root);
    await setRunPhase(root, "M2-023", "unit-test");
    await write(root, ".harness/reports/test-report.md", "# Tests\n");
    await runStateCommand({
      root,
      command: "record",
      recordType: "test",
      status: "passed",
      path: ".harness/reports/test-report.md",
      message: "unit test passed",
      now: () => FIXED_NOW,
    });
    const advanced = await runStateCommand({ root, command: "next", now: () => FIXED_NOW });
    assert.equal(advanced.state.phase, "code-review");

    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: task-dag
    order: 0
    required_outputs:
      - .harness/outputs/task-dag.json
    next:
      - implementation
  - id: implementation
    order: 1
    required_outputs:
      - .harness/outputs/implementation-notes.md
    next:
      - done
quality_gates: []
`);
    await setRunPhase(root, "M2-023", "task-dag");
    await write(root, ".harness/outputs/task-dag.json", "{}\n");
    await assert.rejects(
      runStateCommand({
        root,
        command: "next",
        now: () => FIXED_NOW,
        taskDagValidator: async () => { throw new Error("DAG validation failed"); },
      }),
      /DAG validation failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBuildOnlyCanAdvanceWithoutApproval() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-023A", summary: "build only", now: () => FIXED_NOW });
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: build-publish
    order: 0
    required_outputs:
      - .harness/reports/build-report.md
    next:
      - interface-verification
  - id: interface-verification
    order: 1
    required_outputs: []
    next:
      - done
quality_gates: []
`);
    await setRunPhase(root, "M2-023A", "build-publish");
    await write(root, ".harness/reports/build-report.md", "# Build\n");
    const advanced = await runStateCommand({ root, command: "next", now: () => FIXED_NOW });
    assert.equal(advanced.state.phase, "interface-verification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCompleteFromDeliveryPreparationWithoutGitApproval() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-024", summary: "complete", now: () => FIXED_NOW });
    await assert.rejects(runStateCommand({ root, command: "complete", now: () => FIXED_NOW }), /transition to done/i);
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: delivery-preparation
    order: 0
    required_outputs:
      - .harness/reports/delivery-report.md
    next:
      - done
quality_gates: []
`);
    await setRunPhase(root, "M2-024", "delivery-preparation");
    const before = await readJson(root, ".harness/states/e2e-M2-024.json");
    await assert.rejects(
      runStateCommand({ root, command: "complete", now: () => FIXED_NOW }),
      /required output.*delivery-report/i,
    );
    assert.equal((await readJson(root, ".harness/states/e2e-M2-024.json")).runtime.revision, before.runtime.revision);

    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: delivery-preparation
    order: 0
    required_outputs:
      - .harness/reports/delivery-report.md
    next:
      - requirement
  - id: requirement
    order: 1
    required_outputs: []
    next:
      - done
quality_gates: []
`);
    await write(root, ".harness/reports/delivery-report.md", "# Delivery\n");
    await assert.rejects(runStateCommand({ root, command: "complete", now: () => FIXED_NOW }), /transition to done/i);

    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: delivery-preparation
    order: 0
    required_outputs:
      - .harness/reports/delivery-report.md
    next:
      - done
quality_gates: []
`);
    const completed = await runStateCommand({ root, command: "complete", now: () => FIXED_NOW });
    assert.equal(completed.state.phase, "done");
    assert.equal(completed.state.runtime.status, "completed");
    assert.equal(completed.state.runtime.previousPhase, "delivery-preparation");
    assert.equal(completed.pointer.status, "completed");
    const completedRevision = completed.state.runtime.revision;
    const eventFile = path.join(root, ".harness/states/e2e-M2-024.events.jsonl");
    const orphanTransactionId = "orphan-complete-transaction";
    await writeFile(eventFile, `${await readFile(eventFile, "utf8")}${JSON.stringify({
      event: "intent",
      action: "complete",
      transactionId: orphanTransactionId,
      runId: "M2-024",
      revision: completedRevision,
      createdAt: FIXED_NOW,
    })}\n`, "utf8");
    await assert.rejects(runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "must not mutate completed run",
      now: () => FIXED_NOW,
    }), /completed/i);
    const events = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(events.some((event) => (
      event.transactionId === orphanTransactionId && event.event === "committed"
    )));
    const unchanged = await readJson(root, ".harness/states/e2e-M2-024.json");
    assert.equal(unchanged.runtime.revision, completedRevision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRunLockRejectsConcurrentUpdate() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-030", summary: "locking", now: () => FIXED_NOW });
    await write(root, ".harness/states/e2e-M2-030.lock", `${JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: FIXED_NOW,
    })}\n`);
    await assert.rejects(
      runStateCommand({
        root,
        command: "record",
        recordType: "note",
        status: "recorded",
        message: "concurrent",
        now: () => FIXED_NOW,
      }),
      /locked/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStatusReadsHighestValidInterruptedState() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-031", summary: "recovery", now: () => FIXED_NOW });
    const relative = ".harness/states/e2e-M2-031.json";
    const state = await readJson(root, relative);
    state.runtime.revision = 4;
    state.runtime.updatedAt = "2026-07-16T00:05:00.000Z";
    await write(root, `${relative}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
    await write(root, relative, "{broken\n");

    const recovered = await runStateCommand({ root, command: "status", now: () => FIXED_NOW });
    assert.equal(recovered.state.runtime.revision, 4);
    assert.match(recovered.recoveredFrom, /\.tmp$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStatusRejectsPointerAheadOfRecoverableState() {
  for (const explicit of [false, true]) {
    const { root } = await createFixture();
    try {
      const storyId = explicit ? "M2-REV-EXPLICIT" : "M2-REV-ACTIVE";
      const stateFile = `.harness/states/e2e-${storyId}.json`;
      await runStateCommand({ root, command: "init", storyId, summary: "revision consistency", now: () => FIXED_NOW });
      await runStateCommand({
        root,
        command: "record",
        recordType: "note",
        status: "recorded",
        message: "revision two",
        now: () => "2026-07-16T00:01:00.000Z",
      });
      await write(root, stateFile, "{broken\n");

      await assert.rejects(
        runStateCommand({ root, command: "status", ...(explicit ? { stateFile } : {}) }),
        /pointer revision.*ahead of state revision/i,
      );
      const backup = await readJson(root, `${stateFile}.bak`);
      assert.equal(backup.runtime.revision, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testMutationRecoversPointerAfterStateCommitInterruption() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-POINTER-RECOVER", summary: "pointer recovery", now: () => FIXED_NOW });
    await assert.rejects(
      runStateCommand({
        root,
        command: "record",
        recordType: "note",
        status: "recorded",
        message: "state commits first",
        now: () => "2026-07-16T00:01:00.000Z",
        afterStateCommit: async () => { throw new Error("simulated pointer interruption"); },
      }),
      /simulated pointer interruption/i,
    );

    const status = await runStateCommand({ root, command: "status" });
    assert.equal(status.state.runtime.revision, 2);
    assert.equal(status.pointer.revision, 2);
    assert.equal(status.pointer.runId, "M2-POINTER-RECOVER");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPointerStageWithoutStateFallsBackToCommittedPointer() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-STAGED-POINTER", summary: "staged pointer", now: () => FIXED_NOW });
    await assert.rejects(
      runStateCommand({
        root,
        command: "record",
        recordType: "note",
        status: "recorded",
        message: "pointer stages first",
        now: () => "2026-07-16T00:01:00.000Z",
        afterPointerStage: async () => { throw new Error("simulated state interruption"); },
      }),
      /simulated state interruption/i,
    );

    const status = await runStateCommand({ root, command: "status" });
    assert.equal(status.state.runtime.revision, 1);
    assert.equal(status.pointer.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitRetriesAfterPointerStageWithoutState() {
  const { root } = await createFixture();
  try {
    const options = {
      root,
      command: "init",
      storyId: "M2-FIRST-STAGED",
      summary: "first staged init",
      now: () => FIXED_NOW,
    };
    await assert.rejects(
      runStateCommand({
        ...options,
        afterPointerStage: async () => { throw new Error("simulated first state interruption"); },
      }),
      /simulated first state interruption/i,
    );

    const recovered = await runStateCommand(options);
    assert.equal(recovered.state.storyId, "M2-FIRST-STAGED");
    const status = await runStateCommand({ root, command: "status" });
    assert.equal(status.state.storyId, "M2-FIRST-STAGED");
    assert.equal(status.pointer.status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitRecoversCrossStoryPointerAfterStateCommitInterruption() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-OLD-COMPLETE", summary: "old completed run", now: () => FIXED_NOW });
    const oldStateFile = ".harness/states/e2e-M2-OLD-COMPLETE.json";
    const oldState = await readJson(root, oldStateFile);
    oldState.phase = "done";
    oldState.runtime.status = "completed";
    oldState.runtime.revision = 9;
    await write(root, oldStateFile, `${JSON.stringify(oldState, null, 2)}\n`);
    const oldPointer = await readJson(root, ".harness/states/active-run.json");
    oldPointer.status = "completed";
    oldPointer.revision = 9;
    await write(root, ".harness/states/active-run.json", `${JSON.stringify(oldPointer, null, 2)}\n`);

    await assert.rejects(
      runStateCommand({
        root,
        command: "init",
        storyId: "M2-NEW-ACTIVE",
        summary: "new active run",
        now: () => "2026-07-16T00:01:00.000Z",
        afterStateCommit: async () => { throw new Error("simulated init pointer interruption"); },
      }),
      /simulated init pointer interruption/i,
    );
    const status = await runStateCommand({ root, command: "status" });
    assert.equal(status.state.storyId, "M2-NEW-ACTIVE");
    assert.equal(status.pointer.runId, "M2-NEW-ACTIVE");
    assert.equal(status.pointer.status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitReconcilesCompletedRunBeforeReplacingPointer() {
  const { root } = await createFixture();
  try {
    const oldStoryId = "M2-OLD-ORPHAN-COMPLETE";
    const oldStateFile = `.harness/states/e2e-${oldStoryId}.json`;
    const eventFile = path.join(root, `.harness/states/e2e-${oldStoryId}.events.jsonl`);
    const orphanTransactionId = "orphan-complete-before-next-init";
    await runStateCommand({ root, command: "init", storyId: oldStoryId, summary: "old orphan complete", now: () => FIXED_NOW });

    const oldState = await readJson(root, oldStateFile);
    oldState.phase = "done";
    oldState.runtime.status = "completed";
    oldState.runtime.revision = 2;
    oldState.runtime.updatedAt = "2026-07-16T00:01:00.000Z";
    await write(root, oldStateFile, `${JSON.stringify(oldState, null, 2)}\n`);

    const stagedPointer = await readJson(root, ".harness/states/active-run.json");
    stagedPointer.status = "completed";
    stagedPointer.revision = 2;
    stagedPointer.updatedAt = oldState.runtime.updatedAt;
    await write(root, ".harness/states/active-run.json.tmp", `${JSON.stringify(stagedPointer, null, 2)}\n`);
    await writeFile(eventFile, `${await readFile(eventFile, "utf8")}${JSON.stringify({
      event: "intent",
      action: "complete",
      transactionId: orphanTransactionId,
      runId: oldStoryId,
      revision: 2,
      createdAt: oldState.runtime.updatedAt,
    })}\n`, "utf8");

    const initialized = await runStateCommand({
      root,
      command: "init",
      storyId: "M2-NEW-AFTER-ORPHAN",
      summary: "new run after orphan complete",
      now: () => "2026-07-16T00:02:00.000Z",
    });
    assert.equal(initialized.state.storyId, "M2-NEW-AFTER-ORPHAN");
    const events = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(events.some((event) => (
      event.transactionId === orphanTransactionId && event.event === "committed"
    )));
    const unchanged = await readJson(root, oldStateFile);
    assert.equal(unchanged.runtime.revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitCannotRaceCompletingRun() {
  const { root } = await createFixture();
  let releaseComplete;
  let completing;
  try {
    const oldStoryId = "M2-CONCURRENT-COMPLETE";
    await runStateCommand({ root, command: "init", storyId: oldStoryId, summary: "concurrent complete", now: () => FIXED_NOW });
    await write(root, ".harness/workflows/e2e-development-v2.yaml", `schema_version: "2.0"
name: frontier-e2e-development-v2
state_file: .harness/states/e2e-state-v2.template.json
phases:
  - id: delivery-preparation
    order: 0
    required_outputs:
      - .harness/reports/delivery-report.md
    next:
      - done
quality_gates: []
`);
    await setRunPhase(root, oldStoryId, "delivery-preparation");
    await write(root, ".harness/reports/delivery-report.md", "# Delivery\n");

    let completeEntered;
    const entered = new Promise((resolve) => { completeEntered = resolve; });
    const release = new Promise((resolve) => { releaseComplete = resolve; });
    completing = runStateCommand({
      root,
      command: "complete",
      now: () => "2026-07-16T00:01:00.000Z",
      afterStateCommit: async () => {
        completeEntered();
        await release;
      },
    });
    await entered;

    let initError = null;
    try {
      await runStateCommand({
        root,
        command: "init",
        storyId: "M2-CONCURRENT-NEW",
        summary: "must wait for old complete",
        now: () => "2026-07-16T00:02:00.000Z",
      });
    } catch (error) {
      initError = error;
    }
    releaseComplete();
    releaseComplete = null;
    let completeError = null;
    try {
      await completing;
    } catch (error) {
      completeError = error;
    }
    completing = null;

    assert.match(initError?.message ?? "", /locked/i);
    assert.equal(completeError, null);
    const initialized = await runStateCommand({
      root,
      command: "init",
      storyId: "M2-CONCURRENT-NEW",
      summary: "starts after old complete",
      now: () => "2026-07-16T00:03:00.000Z",
    });
    assert.equal(initialized.state.storyId, "M2-CONCURRENT-NEW");
    const eventFile = path.join(root, `.harness/states/e2e-${oldStoryId}.events.jsonl`);
    const completeEvents = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse)
      .filter((event) => event.action === "complete");
    assert.deepEqual(completeEvents.map((event) => event.event), ["intent", "committed"]);
    assert.equal(completeEvents[0].transactionId, completeEvents[1].transactionId);
  } finally {
    if (releaseComplete) releaseComplete();
    if (completing) await completing.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

async function testMutationWritesIntentAndCommittedEvents() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-032", summary: "events", now: () => FIXED_NOW });
    const result = await runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "audit",
      now: () => "2026-07-16T00:06:00.000Z",
    });
    const events = (await readFile(path.join(root, ".harness/states/e2e-M2-032.events.jsonl"), "utf8"))
      .trim().split("\n").map(JSON.parse);
    const transactionEvents = events.filter((event) => event.revision === result.state.runtime.revision);
    assert.deepEqual(transactionEvents.map((event) => event.event), ["intent", "committed"]);
    assert.equal(transactionEvents[0].transactionId, transactionEvents[1].transactionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testConcurrentMutationsCannotBothHoldLock() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-033", summary: "concurrency", now: () => FIXED_NOW });
    let enteredResolve;
    let releaseResolve;
    const entered = new Promise((resolve) => { enteredResolve = resolve; });
    const release = new Promise((resolve) => { releaseResolve = resolve; });
    const first = runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "first",
      now: () => FIXED_NOW,
      beforeCommit: async () => {
        enteredResolve();
        await release;
      },
    });
    await entered;
    await assert.rejects(
      runStateCommand({
        root,
        command: "record",
        recordType: "note",
        status: "recorded",
        message: "second",
        now: () => FIXED_NOW,
      }),
      /locked/i,
    );
    releaseResolve();
    await first;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNextMutationReconcilesOrphanIntent() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-034", summary: "journal recovery", now: () => FIXED_NOW });
    const eventFile = path.join(root, ".harness/states/e2e-M2-034.events.jsonl");
    await writeFile(eventFile, `${await readFile(eventFile, "utf8")}${JSON.stringify({
      event: "intent",
      action: "record",
      transactionId: "orphan-transaction",
      runId: "M2-034",
      revision: 99,
      createdAt: FIXED_NOW,
    })}\n`, "utf8");
    await runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "recover journal",
      now: () => FIXED_NOW,
    });
    const events = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    const orphanEnd = events.find((event) => event.transactionId === "orphan-transaction" && event.event === "aborted");
    assert.ok(orphanEnd);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRestartedInitAbortsEarlierSameRevisionIntent() {
  const { root } = await createFixture();
  try {
    const storyId = "M2-INIT-RETRY";
    const eventFile = path.join(root, `.harness/states/e2e-${storyId}.events.jsonl`);
    await assert.rejects(
      runStateCommand({
        root,
        command: "init",
        storyId,
        summary: "interrupted init",
        now: () => FIXED_NOW,
        beforeCommit: async () => { throw new Error("simulated init interruption"); },
      }),
      /simulated init interruption/i,
    );
    const firstIntent = JSON.parse((await readFile(eventFile, "utf8")).trim());

    await runStateCommand({ root, command: "init", storyId, summary: "successful retry", now: () => FIXED_NOW });
    await runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "trigger reconciliation",
      now: () => "2026-07-16T00:01:00.000Z",
    });

    const events = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    const firstOutcomes = events.filter((event) => (
      event.transactionId === firstIntent.transactionId && ["committed", "aborted"].includes(event.event)
    ));
    assert.deepEqual(firstOutcomes.map((event) => event.event), ["aborted"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRestartedInitCommitsOnlyLatestSameRevisionOrphan() {
  const { root } = await createFixture();
  try {
    const storyId = "M2-INIT-DOUBLE-ORPHAN";
    const eventFile = path.join(root, `.harness/states/e2e-${storyId}.events.jsonl`);
    await assert.rejects(
      runStateCommand({
        root,
        command: "init",
        storyId,
        summary: "first interrupted init",
        now: () => FIXED_NOW,
        beforeCommit: async () => { throw new Error("first init interruption"); },
      }),
      /first init interruption/i,
    );
    await runStateCommand({ root, command: "init", storyId, summary: "second init", now: () => FIXED_NOW });

    const initialEvents = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    const intents = initialEvents.filter((event) => event.event === "intent");
    assert.equal(intents.length, 2);
    await writeFile(eventFile, `${initialEvents
      .filter((event) => !(event.event === "committed" && event.transactionId === intents[1].transactionId))
      .map(JSON.stringify).join("\n")}\n`, "utf8");

    await runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "reconcile both init intents",
      now: () => "2026-07-16T00:01:00.000Z",
    });
    const events = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    const outcomes = intents.map((intent) => events.find((event) => (
      event.transactionId === intent.transactionId && ["committed", "aborted"].includes(event.event)
    ))?.event);
    assert.deepEqual(outcomes, ["aborted", "committed"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNextMutationRepairsTruncatedEventTail() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-035", summary: "truncated journal", now: () => FIXED_NOW });
    const eventFile = path.join(root, ".harness/states/e2e-M2-035.events.jsonl");
    await writeFile(eventFile, `${await readFile(eventFile, "utf8")}{"event":"intent"`, "utf8");

    const result = await runStateCommand({
      root,
      command: "record",
      recordType: "note",
      status: "recorded",
      message: "repair truncated event",
      now: () => FIXED_NOW,
    });
    assert.equal(result.state.runtime.revision, 2);
    const events = (await readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.slice(-2).map((event) => event.event), ["intent", "committed"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testMutationRejectsTerminatedInvalidEvent() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-036", summary: "invalid journal", now: () => FIXED_NOW });
    const eventFile = path.join(root, ".harness/states/e2e-M2-036.events.jsonl");
    await writeFile(eventFile, `${await readFile(eventFile, "utf8")}{"event":\n`, "utf8");
    await assert.rejects(
      runStateCommand({
        root,
        command: "record",
        recordType: "note",
        status: "recorded",
        message: "must not ignore corruption",
        now: () => FIXED_NOW,
      }),
      /invalid JSON/i,
    );
    const state = await readJson(root, ".harness/states/e2e-M2-036.json");
    assert.equal(state.runtime.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPowerShellEntryPointPreservesExitCodes() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-040", summary: "PowerShell", now: () => FIXED_NOW });
    const success = await execPowerShell(["-Command", "status", "-Root", root, "-Json"]);
    assert.equal(success.exitCode, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).state.storyId, "M2-040");

    const failure = await execPowerShell(["-Command", "next", "-Root", root, "-Json"]);
    assert.notEqual(failure.exitCode, 0);
    assert.match(`${failure.stdout}${failure.stderr}`, /required output/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testValidateCommandChecksRuntimeState() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-041", summary: "validate", now: () => FIXED_NOW });
    const result = await runStateCommand({ root, command: "validate" });
    assert.equal(result.valid, true);
    assert.equal(result.state.storyId, "M2-041");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStatusRejectsInvalidRuntimeContract() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-INVALID-STATE", summary: "invalid state", now: () => FIXED_NOW });
    const stateFile = ".harness/states/e2e-M2-INVALID-STATE.json";
    const state = await readJson(root, stateFile);
    state.runtime.status = "unknown";
    await write(root, stateFile, `${JSON.stringify(state, null, 2)}\n`);

    await assert.rejects(
      runStateCommand({ root, command: "status" }),
      /runtime\.status.*invalid value 'unknown'/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitRejectsInvalidRecoverablePointerContract() {
  const { root } = await createFixture();
  try {
    const pointer = {
      schemaVersion: "1.0",
      runId: "M2-INVALID-POINTER",
      stateFile: ".harness/states/e2e-M2-INVALID-POINTER.json",
      status: "unknown",
      revision: 1,
      updatedAt: FIXED_NOW,
    };
    await write(root, ".harness/states/active-run.json", `${JSON.stringify(pointer, null, 2)}\n`);

    await assert.rejects(
      runStateCommand({ root, command: "init", storyId: "M2-MUST-NOT-START", summary: "invalid pointer", now: () => FIXED_NOW }),
      /active pointer status.*invalid value 'unknown'/i,
    );
    await assert.rejects(
      readFile(path.join(root, ".harness/states/e2e-M2-MUST-NOT-START.json"), "utf8"),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStateValidatorRequiresRuntimeMetadata() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-042", summary: "中文状态摘要", now: () => FIXED_NOW });
    const stateFile = path.join(root, ".harness/states/e2e-M2-042.json");
    const valid = await execPowerShellScript(VALIDATE_STATE_SCRIPT, ["-StateFile", stateFile]);
    assert.equal(valid.exitCode, 0, valid.stderr);

    const state = JSON.parse(await readFile(stateFile, "utf8"));
    delete state.runtime;
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    const invalid = await execPowerShellScript(VALIDATE_STATE_SCRIPT, ["-StateFile", stateFile]);
    assert.notEqual(invalid.exitCode, 0);
    assert.match(`${invalid.stdout}${invalid.stderr}`, /runtime/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPowerShellEntryPointsResolveDefaultRootFromScriptLocation() {
  const { root } = await createFixture(REPOSITORY_ROOT);
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
      - done
quality_gates: []
`);
    await runStateCommand({ root, command: "init", storyId: "M3-DEFAULT-ROOT", summary: "default root", now: () => FIXED_NOW });
    for (const [source, target] of [
      [RUN_STATE_SCRIPT, ".harness/scripts/run-state.ps1"],
      [RUN_STORY_SCRIPT, ".harness/scripts/run-story.ps1"],
      [STATE_RUNTIME_MODULE, ".harness/scripts/lib/state-runtime.mjs"],
      [STATE_CONTRACT_MODULE, ".harness/scripts/lib/state-contract.mjs"],
      [STORY_RUNTIME_MODULE, ".harness/scripts/lib/story-runtime.mjs"],
      [DISPATCH_CONTRACT_MODULE, ".harness/scripts/lib/dispatch-contract.mjs"],
      [PHASE_DATA_CONTRACT_MODULE, ".harness/scripts/lib/phase-data-contract.mjs"],
      [PHASE_RESULT_PROJECTOR_MODULE, ".harness/scripts/lib/phase-result-projector.mjs"],
      [TASK_DAG_CONTRACT_MODULE, ".harness/scripts/lib/task-dag-contract.mjs"],
      [BATCH_FINALIZATION_CONTRACT_MODULE, ".harness/scripts/lib/batch-finalization-contract.mjs"],
      [IMPLEMENTATION_OWNER_CONTRACT_MODULE, ".harness/scripts/lib/implementation-owner-contract.mjs"],
    ]) {
      await write(root, target, await readFile(source, "utf8"));
    }

    const stateStatus = await execPowerShellScript(
      path.join(root, ".harness/scripts/run-state.ps1"),
      ["-Command", "status", "-Json"],
    );
    assert.equal(stateStatus.exitCode, 0, stateStatus.stderr);
    assert.equal(JSON.parse(stateStatus.stdout).state.storyId, "M3-DEFAULT-ROOT");

    const storyStatus = await execPowerShellScript(
      path.join(root, ".harness/scripts/run-story.ps1"),
      ["-Command", "status", "-Json"],
    );
    assert.equal(storyStatus.exitCode, 0, storyStatus.stderr);
    assert.equal(JSON.parse(storyStatus.stdout).state.storyId, "M3-DEFAULT-ROOT");

    const storyPrepare = await execPowerShellScript(
      path.join(root, ".harness/scripts/run-story.ps1"),
      ["-Command", "prepare", "-Json"],
    );
    assert.equal(storyPrepare.exitCode, 0, storyPrepare.stderr);
    const prepared = JSON.parse(storyPrepare.stdout);
    await write(root, prepared.task.expectedOutputs[0], "# Requirement\n");
    await write(root, prepared.resultFile, `${JSON.stringify({
      schemaVersion: "1.0",
      dispatchId: prepared.task.dispatchId,
      storyId: prepared.task.storyId,
      phase: prepared.task.phase,
      status: "completed",
      summary: "fixture requirement completed",
      outputs: prepared.task.expectedOutputs.map((outputPath) => ({ path: outputPath })),
      records: [],
    }, null, 2)}\n`);
    const storyApply = await execPowerShellScript(
      path.join(root, ".harness/scripts/run-story.ps1"),
      ["-Command", "apply", "-Json"],
    );
    assert.equal(storyApply.exitCode, 0, storyApply.stderr);
    assert.equal(JSON.parse(storyApply.stdout).state.phase, "technical-design");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStateValidatorAcceptsAndRejectsActivePointer() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-POINTER", summary: "pointer schema", now: () => FIXED_NOW });
    const pointerFile = path.join(root, ".harness/states/active-run.json");

    const valid = await execPowerShellScript(VALIDATE_STATE_SCRIPT, ["-StateFile", pointerFile]);
    assert.equal(valid.exitCode, 0, valid.stderr);
    assert.match(valid.stdout, /State type: active-run/);

    const pointer = await readJson(root, ".harness/states/active-run.json");
    pointer.stateFile = ".harness/states/e2e-OTHER.json";
    await write(root, ".harness/states/active-run.json", `${JSON.stringify(pointer, null, 2)}\n`);
    const invalid = await execPowerShellScript(VALIDATE_STATE_SCRIPT, ["-StateFile", pointerFile]);
    assert.notEqual(invalid.exitCode, 0);
    assert.match(invalid.stderr, /stateFile.*runId|runId.*stateFile/i);

    pointer.stateFile = `.harness/states/e2e-${pointer.runId}.json`;
    pointer.schemaVersion = 1;
    await write(root, ".harness/states/active-run.json", `${JSON.stringify(pointer, null, 2)}\n`);
    const wrongType = await execPowerShellScript(VALIDATE_STATE_SCRIPT, ["-StateFile", pointerFile]);
    assert.notEqual(wrongType.exitCode, 0);
    assert.match(wrongType.stderr, /schemaVersion.*1\.0/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRuntimeIsRegisteredInHarnessContracts() {
  const manifest = await readFile(path.join(REPOSITORY_ROOT, ".harness/structure-manifest.yaml"), "utf8");
  for (const expected of [
    ".harness/schemas/active-run.schema.json",
    ".harness/scripts/run-state.ps1",
    ".harness/scripts/lib/state-runtime.mjs",
    ".harness/scripts/tests/state-runtime.test.mjs",
  ]) {
    assert.match(manifest, new RegExp(expected.replaceAll(".", "\\.")));
  }

  const registry = await readFile(path.join(REPOSITORY_ROOT, ".codex/skills/skill-registry.yaml"), "utf8");
  assert.match(registry, /name: frontier-state-runner[\s\S]*?status: implemented-v1/);

  const skill = await readFile(path.join(REPOSITORY_ROOT, ".codex/skills/frontier-state-runner/SKILL.md"), "utf8");
  assert.match(skill, /run-state\.ps1/);

  const smoke = await readFile(path.join(REPOSITORY_ROOT, ".harness/scripts/smoke-harness-flow.ps1"), "utf8");
  assert.match(smoke, /run-state\.ps1/);
  assert.match(smoke, /-Command init/);
  assert.match(smoke, /-Command validate/);
}

async function testStateContractDispatchesVersionsAndReadOnlyCommands() {
  const v1 = {
    schemaVersion: "1.0",
    storyId: "V1",
    phase: "requirement",
    runtime: {
      runId: "V1",
      workflow: ".harness/workflows/e2e-development.yaml",
      status: "active",
      revision: 1,
      previousPhase: null,
      blocked: null,
      records: [],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    },
    requirement: { summary: "v1", openQuestions: [], acceptanceCriteria: [] },
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
  const v2Template = {
    schemaVersion: "2.0",
    storyId: "S1",
    phase: "requirement",
    runtime: {
      runId: "S1",
      workflow: ".harness/workflows/e2e-development-v2.yaml",
      workflowVersion: "2.0",
      status: "template",
      revision: 0,
      previousPhase: null,
      activeBlock: null,
      records: [],
      createdAt: null,
      updatedAt: null,
    },
    baseline: { head: null, branch: null, initialDirtyPaths: [], capturedAt: null },
    requirement: { summary: "", openQuestions: [], acceptanceCriteria: [], inScope: [], outOfScope: [] },
    knowledge: { areas: [] },
    design: { decisions: [], affectedAreas: [], risks: [] },
    dag: { sourceFile: null, sourceSha256: null, nodes: [], edges: [], waves: [], globalChanges: [], risks: [] },
    implementation: { method: null, exceptionReason: null, actualFiles: [], completedTaskIds: [], notes: [] },
    tests: { cases: [], commands: [], results: [] },
    review: { findings: [], status: "pending" },
    build: { results: [], artifacts: [], externalActions: [] },
    verification: {
      cases: [],
      results: [],
      environment: {
        status: "not-checked",
        summary: "",
        evidencePath: null,
        evidenceSha256: null,
      },
    },
    delivery: {
      status: "pending",
      ownedFiles: [],
      outOfPredictionFiles: [],
      unrelatedDirtyFiles: [],
      remainingRisks: [],
      summaryFile: null,
      summarySha256: null,
      gitStatus: "not-requested",
    },
    approvals: [],
    worktrees: [],
    logs: [],
  };

  assert.equal(detectE2EStateVersion(v1), "1.0");
  assert.equal(detectE2EStateVersion(v2Template), "2.0");
  assert.equal(validateStateDocument(v1).schemaVersion, "1.0");
  assert.equal(validateStateDocument(v2Template).schemaVersion, "2.0");
  assert.doesNotThrow(() => assertStateCommandAllowed(v1, "status"));
  assert.doesNotThrow(() => assertStateCommandAllowed(v2Template, "validate"));
  assert.throws(() => assertStateCommandAllowed(v1, "record"), /State v1 is read-only/i);
  assert.throws(() => assertStateCommandAllowed(v2Template, "record"), /template is read-only/i);
  assert.throws(() => detectE2EStateVersion({ ...v1, schemaVersion: "3.0" }), /unsupported.*3\.0/i);
  assert.throws(() => validateStateDocument({ ...v2Template, tasks: [] }), /unsupported field.*tasks/i);
  assert.throws(
    () => validateStateDocument({
      ...v2Template,
      runtime: { ...v2Template.runtime, blocked: null },
    }),
    /unsupported field.*blocked/i,
  );
  assert.throws(
    () => validateStateDocument({
      ...v2Template,
      runtime: {
        ...v2Template.runtime,
        records: [{
          id: "result:not-a-uuid",
          type: "phase-result",
          phase: "requirement",
          status: "applied",
          path: ".harness/runs/S1/phases/00-requirement/attempts/not-a-uuid/result.json",
          sha256: `sha256:${"a".repeat(64)}`,
          bytes: 1,
          message: "invalid formal result",
          actor: "story-runtime",
          dispatchId: "not-a-uuid",
          preparedRevision: 5,
          appliedRevision: 2,
          createdAt: FIXED_NOW,
        }],
      },
    }),
    /dispatchId|revision|phase-result/i,
  );

  const activeV2 = structuredClone(v2Template);
  activeV2.storyId = "ACTIVE";
  activeV2.runtime = {
    ...activeV2.runtime,
    runId: "ACTIVE",
    status: "active",
    revision: 1,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
  activeV2.baseline = {
    head: "a".repeat(40),
    branch: "dev",
    initialDirtyPaths: [],
    capturedAt: FIXED_NOW,
  };
  for (const invalid of [
    { ...structuredClone(activeV2), phase: "done" },
    { ...structuredClone(activeV2), phase: "blocked" },
  ]) {
    assert.throws(() => validateStateDocument(invalid), /phase.*status|status.*phase/i);
  }
  assert.throws(
    () => validateStateDocument({
      ...structuredClone(v2Template),
      phase: "done",
    }),
    /template.*requirement|phase.*template/i,
  );
  assert.throws(
    () => validateStateDocument({
      ...structuredClone(activeV2),
      requirement: {
        ...activeV2.requirement,
        acceptanceCriteria: [{
          criterionId: "AC-001",
          description: "Expected behavior",
          source: "user",
          required: true,
          unexpected: true,
        }],
      },
    }),
    /acceptanceCriteria.*unsupported field.*unexpected/i,
  );
  assert.throws(
    () => validateStateDocument({
      ...structuredClone(activeV2),
      knowledge: {
        areas: [{
          area: "common",
          relevant: true,
          status: "fresh",
          sourceFingerprint: null,
          loadedFiles: [],
          missing: [],
          checkedAt: FIXED_NOW,
          unexpected: true,
        }],
      },
    }),
    /knowledge\.areas.*unsupported field.*unexpected/i,
  );
  const structuredV2 = structuredClone(activeV2);
  structuredV2.requirement.openQuestions = [{
    questionId: "Q1", question: "Choose?", status: "open", resolution: null,
  }];
  structuredV2.design = {
    decisions: [{ decisionId: "D1", summary: "Use v2", rationale: "Strict projection" }],
    affectedAreas: ["common"],
    risks: [{ riskId: "R1", description: "Drift", severity: "medium", mitigation: "Shared contract" }],
  };
  structuredV2.tests = {
    cases: [{ caseId: "TC1", type: "unit", required: true, criterionIds: [], expected: "Pass" }],
    commands: [{
      commandId: "CMD1", command: "node test.mjs", status: "passed", exitCode: 0,
      evidencePath: null, evidenceSha256: null, executedAt: FIXED_NOW,
    }],
    results: [{
      caseId: "TC1", status: "passed", actual: "Passed",
      evidencePath: null, evidenceSha256: null, executedAt: FIXED_NOW,
    }],
  };
  structuredV2.review = {
    findings: [{
      findingId: "F1", severity: "INFO", status: "resolved", summary: "OK",
      file: null, line: null, evidence: null,
    }],
    status: "passed",
  };
  structuredV2.build = {
    results: [],
    artifacts: [],
    externalActions: [{
      actionId: "EA1", type: "publish", status: "not-requested", approvalId: null,
      evidencePath: null, evidenceSha256: null,
    }],
  };
  structuredV2.delivery.remainingRisks = [{
    riskId: "R2", description: "Gap", severity: "low", mitigation: "Verify later",
    status: "open", approvalId: null,
  }];
  assert.doesNotThrow(() => validateStateDocument(structuredV2));
  for (const mutate of [
    (state) => { state.requirement.openQuestions[0].status = "invalid"; },
    (state) => { state.tests.commands[0].evidenceSha256 = `sha256:${"a".repeat(64)}`; },
    (state) => { state.review.findings[0].line = 0; },
    (state) => { state.build.externalActions[0] = { ...state.build.externalActions[0], status: "executed" }; },
    (state) => { state.delivery.remainingRisks[0].status = "invalid"; },
  ]) {
    const invalid = structuredClone(structuredV2);
    mutate(invalid);
    assert.throws(() => validateStateDocument(invalid), /invalid|evidence|line|approval|status/i);
  }
  assert.throws(
    () => validateStateDocument({
      ...structuredClone(activeV2),
      runtime: {
        ...activeV2.runtime,
        records: [{
          id: "record-1",
          type: "note",
          phase: "requirement",
          status: "recorded",
          path: null,
          message: "",
          actor: "codex",
          createdAt: FIXED_NOW,
          unexpected: true,
        }],
      },
    }),
    /runtime\.records.*unsupported field.*unexpected/i,
  );
  for (const previousPhase of ["nonsense", "done", "blocked"]) {
    const blockedV2 = structuredClone(activeV2);
    blockedV2.phase = "blocked";
    blockedV2.runtime.status = "blocked";
    blockedV2.runtime.activeBlock = {
      previousPhase,
      reason: "decision required",
      owner: "user",
      suggestedAction: "choose an option",
      blockedAt: FIXED_NOW,
    };
    assert.throws(
      () => validateStateDocument(blockedV2),
      /activeBlock\.previousPhase.*invalid/i,
    );
  }
  assert.throws(
    () => validateStateDocument({
      schemaVersion: "9.9",
      runId: "ACTIVE",
      stateFile: ".harness/states/e2e-ACTIVE.json",
      status: "active",
      revision: 1,
      updatedAt: FIXED_NOW,
    }),
    /Active pointer schemaVersion.*1\.0/i,
  );
}

async function testResumeRejectsInvalidPreviousPhaseWithoutPersistence() {
  const { root } = await createFixture();
  try {
    const storyId = "M7-A1-INVALID-RESUME";
    await runStateCommand({ root, command: "init", storyId, summary: "invalid resume", now: () => FIXED_NOW });
    await runStateCommand({
      root,
      command: "block",
      reason: "decision required",
      owner: "user",
      suggestedAction: "choose an option",
      now: () => FIXED_NOW,
    });
    const stateFile = `.harness/states/e2e-${storyId}.json`;
    const state = await readJson(root, stateFile);
    state.runtime.activeBlock.previousPhase = "done";
    await write(root, stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const beforeState = await readFile(path.join(root, stateFile), "utf8");
    const beforeEvents = await readFile(
      path.join(root, `.harness/states/e2e-${storyId}.events.jsonl`),
      "utf8",
    );

    await assert.rejects(
      runStateCommand({ root, command: "resume", now: () => FIXED_NOW }),
      /activeBlock\.previousPhase.*invalid/i,
    );
    assert.equal(await readFile(path.join(root, stateFile), "utf8"), beforeState);
    assert.equal(
      await readFile(path.join(root, `.harness/states/e2e-${storyId}.events.jsonl`), "utf8"),
      beforeEvents,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testGitBaselineCapturesDirtyPathsAndRenameOrdering() {
  const { root } = await createFixture();
  try {
    await write(root, "unstaged.txt", "base\n");
    await execFileAsync("git", ["add", "unstaged.txt"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "add unstaged base"], { cwd: root, windowsHide: true });
    await write(root, "unstaged.txt", "changed\n");
    await write(root, "untracked.txt", "untracked\n");
    await write(root, "source.txt", "rename\n");
    await execFileAsync("git", ["add", "source.txt"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "add rename source"], { cwd: root, windowsHide: true });
    await write(root, "staged.txt", "staged\n");
    await execFileAsync("git", ["add", "staged.txt"], { cwd: root, windowsHide: true });
    await execFileAsync("git", ["mv", "source.txt", "target.txt"], { cwd: root, windowsHide: true });

    const initialized = await runStateCommand({
      root,
      command: "init",
      storyId: "M7-A1-DIRTY",
      summary: "dirty baseline",
      now: () => FIXED_NOW,
    });
    const dirty = initialized.state.baseline.initialDirtyPaths;
    assert.deepEqual(dirty.map((item) => item.path), [
      "staged.txt",
      "target.txt",
      "unstaged.txt",
      "untracked.txt",
    ]);
    assert.deepEqual(dirty.find((item) => item.path === "staged.txt"), {
      path: "staged.txt",
      indexStatus: "A",
      worktreeStatus: " ",
      untracked: false,
    });
    assert.deepEqual(dirty.find((item) => item.path === "unstaged.txt"), {
      path: "unstaged.txt",
      indexStatus: " ",
      worktreeStatus: "M",
      untracked: false,
    });
    assert.deepEqual(dirty.find((item) => item.path === "untracked.txt"), {
      path: "untracked.txt",
      indexStatus: "?",
      worktreeStatus: "?",
      untracked: true,
    });
    assert.equal(dirty.some((item) => item.path === "source.txt"), false);

    assert.deepEqual(
      parsePorcelainV1Z("C  copy-target.txt\0copy-source.txt\0"),
      [{
        path: "copy-target.txt",
        indexStatus: "C",
        worktreeStatus: " ",
        untracked: false,
      }],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testGitBaselineRejectsInvalidRepositoryStatesWithoutPersistence() {
  const cases = [
    {
      storyId: "M7-A1-DETACHED",
      prepare: async (root) => {
        await execFileAsync("git", ["checkout", "--detach"], { cwd: root, windowsHide: true });
      },
    },
    {
      storyId: "M7-A1-UNBORN",
      prepare: async (root) => {
        await execFileAsync("git", ["checkout", "--orphan", "unborn"], { cwd: root, windowsHide: true });
        await execFileAsync("git", ["rm", "-rf", "--cached", "."], { cwd: root, windowsHide: true });
      },
    },
  ];
  for (const scenario of cases) {
    const { root } = await createFixture();
    try {
      await scenario.prepare(root);
      await assert.rejects(
        runStateCommand({
          root,
          command: "init",
          storyId: scenario.storyId,
          summary: "invalid git state",
          now: () => FIXED_NOW,
        }),
        /attached branch and committed HEAD/i,
      );
      for (const relative of [
        `.harness/states/e2e-${scenario.storyId}.json`,
        `.harness/states/e2e-${scenario.storyId}.events.jsonl`,
        ".harness/states/active-run.json",
      ]) {
        await assert.rejects(
          readFile(path.join(root, relative)),
          (error) => error?.code === "ENOENT",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testGitBaselineRejectsIdentityDriftAndGitFailureWithoutPersistence() {
  for (const scenario of ["head-drift", "branch-drift", "status-failure"]) {
    const { root } = await createFixture();
    try {
      let headReads = 0;
      let branchReads = 0;
      const executeGit = async (args) => {
        if (args[0] === "rev-parse") {
          headReads += 1;
          return {
            stdout: `${headReads === 2 && scenario === "head-drift" ? "b".repeat(40) : "a".repeat(40)}\n`,
            stderr: "",
          };
        }
        if (args[0] === "symbolic-ref") {
          branchReads += 1;
          return {
            stdout: `${branchReads === 2 && scenario === "branch-drift" ? "other" : "dev"}\n`,
            stderr: "",
          };
        }
        if (scenario === "status-failure") throw new Error("injected status failure");
        return { stdout: "", stderr: "" };
      };
      const storyId = `M7-A1-${scenario.toUpperCase()}`;
      await assert.rejects(
        runStateCommand({
          root,
          command: "init",
          storyId,
          summary: "baseline failure",
          now: () => FIXED_NOW,
          executeGit,
        }),
        scenario === "status-failure" ? /injected status failure/i : /HEAD or branch changed/i,
      );
      for (const relative of [
        `.harness/states/e2e-${storyId}.json`,
        `.harness/states/e2e-${storyId}.events.jsonl`,
        ".harness/states/active-run.json",
      ]) {
        await assert.rejects(
          readFile(path.join(root, relative)),
          (error) => error?.code === "ENOENT",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testV2TemplateAndWorkflowAssetsMatchContract() {
  const templatePath = path.join(REPOSITORY_ROOT, ".harness/states/e2e-state-v2.template.json");
  const workflowPath = path.join(REPOSITORY_ROOT, ".harness/workflows/e2e-development-v2.yaml");
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  const workflow = await readFile(workflowPath, "utf8");

  const metadata = validateStateDocument(template);
  assert.equal(metadata.schemaVersion, "2.0");
  assert.equal(Object.hasOwn(template, "tasks"), false);
  assert.deepEqual(template.dag.nodes, []);
  assert.equal(template.runtime.activeBlock, null);
  assert.equal(template.runtime.status, "template");
  assert.equal(template.baseline.head, null);

  assert.match(workflow, /^schema_version: "2\.0"$/m);
  assert.match(workflow, /^state_file: \.harness\/states\/e2e-state-v2\.template\.json$/m);
  assert.match(workflow, /^  - id: delivery-preparation$/m);
  assert.doesNotMatch(workflow, /^  - id: git-delivery$/m);
}

async function testWorkflowMetadataIsReturnedAndBoundToStateVersion() {
  const { root } = await createFixture();
  try {
    const initialized = await runStateCommand({
      root,
      command: "init",
      storyId: "M7-A1-WORKFLOW",
      summary: "workflow metadata",
      now: () => FIXED_NOW,
    });
    const workflow = await readWorkflowDefinition(root, initialized.state);
    assert.equal(workflow.schemaVersion, "2.0");
    assert.equal(workflow.stateFile, ".harness/states/e2e-state-v2.template.json");

    const workflowPath = ".harness/workflows/e2e-development-v2.yaml";
    const validSource = await readFile(path.join(root, workflowPath), "utf8");
    await write(root, workflowPath, validSource.replace('schema_version: "2.0"', 'schema_version: "1.0"'));
    await assert.rejects(
      readWorkflowDefinition(root, initialized.state),
      /workflow schema_version.*runtime\.workflowVersion/i,
    );

    await write(
      root,
      workflowPath,
      validSource.replace(
        "state_file: .harness/states/e2e-state-v2.template.json",
        "state_file: .harness/states/e2e-state.template.json",
      ),
    );
    await assert.rejects(
      readWorkflowDefinition(root, initialized.state),
      /workflow state_file.*e2e-state-v2\.template\.json/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testInitCreatesRunAndPointerWithoutEditingTemplate();
await testStatusLocatesRunThroughPointer();
await testExplicitStateFileIsIndependentFromActivePointer();
await testInitRejectsInvalidOrDuplicateRun();
await testInitRejectsRecoverableActivePointer();
await testInitKeepsNewRunDiscoverableAfterCompletedRun();
await testStatusRecoversNewRunPointerFromInterruptedReplacement();
await testInitRejectsExistingCompletedStory();
await testNextRequiresOutputsAndFollowsWorkflow();
await testNextExpandsRunScopedRequiredOutput();
await testTaskDagGateUsesExpandedRequiredOutput();
await testNextRejectsMalformedWorkflow();
await testRecordAndTestGate();
await testReviewBlockerGate();
await testBlockAndResumeRestorePreviousPhase();
await testPassedTestsAdvanceAndTaskDagValidatorBlocks();
await testBuildOnlyCanAdvanceWithoutApproval();
await testCompleteFromDeliveryPreparationWithoutGitApproval();
await testRunLockRejectsConcurrentUpdate();
await testStatusReadsHighestValidInterruptedState();
await testStatusRejectsPointerAheadOfRecoverableState();
await testMutationRecoversPointerAfterStateCommitInterruption();
await testPointerStageWithoutStateFallsBackToCommittedPointer();
await testInitRetriesAfterPointerStageWithoutState();
await testInitRecoversCrossStoryPointerAfterStateCommitInterruption();
await testInitReconcilesCompletedRunBeforeReplacingPointer();
await testInitCannotRaceCompletingRun();
await testMutationWritesIntentAndCommittedEvents();
await testConcurrentMutationsCannotBothHoldLock();
await testNextMutationReconcilesOrphanIntent();
await testRestartedInitAbortsEarlierSameRevisionIntent();
await testRestartedInitCommitsOnlyLatestSameRevisionOrphan();
await testNextMutationRepairsTruncatedEventTail();
await testMutationRejectsTerminatedInvalidEvent();
await testPowerShellEntryPointPreservesExitCodes();
await testPowerShellEntryPointsResolveDefaultRootFromScriptLocation();
await testValidateCommandChecksRuntimeState();
await testStatusRejectsInvalidRuntimeContract();
await testInitRejectsInvalidRecoverablePointerContract();
await testStateValidatorRequiresRuntimeMetadata();
await testStateValidatorAcceptsAndRejectsActivePointer();
await testRuntimeIsRegisteredInHarnessContracts();
await testStateContractDispatchesVersionsAndReadOnlyCommands();
await testV2TemplateAndWorkflowAssetsMatchContract();
await testWorkflowMetadataIsReturnedAndBoundToStateVersion();
await testResumeRejectsInvalidPreviousPhaseWithoutPersistence();
await testGitBaselineCapturesDirtyPathsAndRenameOrdering();
await testGitBaselineRejectsInvalidRepositoryStatesWithoutPersistence();
await testGitBaselineRejectsIdentityDriftAndGitFailureWithoutPersistence();
console.log("state-runtime tests passed");
