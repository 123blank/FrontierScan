import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStateCommand } from "../lib/state-runtime.mjs";

const FIXED_NOW = "2026-07-16T00:00:00.000Z";
const RUN_STATE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "run-state.ps1");
const VALIDATE_STATE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "validate-state.ps1");
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-state-runtime-"));
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
  return { root, template };
}

async function writeGateWorkflow(root) {
  await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
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
    const templatePath = path.join(root, ".harness/states/e2e-state.template.json");
    const originalTemplate = await readFile(templatePath, "utf8");
    const result = await runStateCommand({
      root,
      command: "init",
      storyId: "M2-001",
      summary: "验证状态运行时",
      now: () => FIXED_NOW,
    });

    assert.equal(result.state.phase, "requirement");
    assert.equal(result.state.storyId, "M2-001");
    assert.equal(result.state.requirement.summary, "验证状态运行时");
    assert.equal(result.state.runtime.revision, 1);
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

    await write(root, ".harness/outputs/requirement-breakdown.md", "# Requirement\n");
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

async function testNextRejectsMalformedWorkflow() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-011", summary: "workflow", now: () => FIXED_NOW });
    await write(root, ".harness/outputs/requirement-breakdown.md", "# Requirement\n");
    await write(root, ".harness/workflows/e2e-development.yaml", "phases:\n   - id: requirement\n");
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
    assert.equal(recorded.state.tests.results.length, 1);
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
    assert.equal(blocked.state.runtime.blocked.previousPhase, "requirement");
    assert.equal(blocked.pointer.status, "blocked");

    const resumed = await runStateCommand({ root, command: "resume", now: () => "2026-07-16T00:04:00.000Z" });
    assert.equal(resumed.state.phase, "requirement");
    assert.equal(resumed.state.runtime.status, "active");
    assert.equal(resumed.state.runtime.blocked.resumedAt, "2026-07-16T00:04:00.000Z");
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

    await write(root, ".harness/workflows/e2e-development.yaml", `phases:
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
    await write(root, ".harness/workflows/e2e-development.yaml", `phases:
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

async function testCompleteOnlyFromGitDelivery() {
  const { root } = await createFixture();
  try {
    await runStateCommand({ root, command: "init", storyId: "M2-024", summary: "complete", now: () => FIXED_NOW });
    await assert.rejects(runStateCommand({ root, command: "complete", now: () => FIXED_NOW }), /git-delivery/i);
    await write(root, ".harness/workflows/e2e-development.yaml", `phases:
  - id: git-delivery
    order: 0
    required_outputs:
      - .harness/reports/delivery-report.md
    next:
      - done
quality_gates: []
`);
    await setRunPhase(root, "M2-024", "git-delivery");
    await write(root, ".harness/reports/delivery-report.md", "# Delivery\n");
    await assert.rejects(runStateCommand({ root, command: "complete", now: () => FIXED_NOW }), /approval/i);
    await assert.rejects(runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "approved",
      message: "missing evidence path",
      actor: "user",
      now: () => FIXED_NOW,
    }), /evidence path/i);
    await assert.rejects(runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "approved",
      path: ".harness/reports/delivery-report.md",
      message: "wrong actor",
      actor: "codex",
      now: () => FIXED_NOW,
    }), /actor.*user/i);
    const approval = await runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "approved",
      path: ".harness/reports/delivery-report.md",
      message: "approved git delivery completion",
      actor: "user",
      now: () => FIXED_NOW,
    });
    assert.match(approval.state.runtime.records.at(-1).sha256, /^sha256:[a-f0-9]{64}$/);
    await runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "denied",
      path: ".harness/reports/delivery-report.md",
      message: "revoked git delivery approval",
      actor: "user",
      now: () => FIXED_NOW,
    });
    await assert.rejects(runStateCommand({ root, command: "complete", now: () => FIXED_NOW }), /explicit user approval/i);
    await runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "approved",
      path: ".harness/reports/delivery-report.md",
      message: "approved delivery report again",
      actor: "user",
      now: () => FIXED_NOW,
    });
    await write(root, ".harness/reports/delivery-report.md", "# Changed after approval\n");
    await assert.rejects(runStateCommand({ root, command: "complete", now: () => FIXED_NOW }), /approval evidence.*changed/i);
    await runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "approved",
      path: ".harness/reports/delivery-report.md",
      message: "approved changed delivery report",
      actor: "user",
      now: () => FIXED_NOW,
    });
    const completed = await runStateCommand({ root, command: "complete", now: () => FIXED_NOW });
    assert.equal(completed.state.phase, "done");
    assert.equal(completed.state.runtime.status, "completed");
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
    await write(root, ".harness/workflows/e2e-development.yaml", `phases:
  - id: git-delivery
    order: 0
    required_outputs:
      - .harness/reports/delivery-report.md
    next:
      - done
quality_gates: []
`);
    await setRunPhase(root, oldStoryId, "git-delivery");
    await write(root, ".harness/reports/delivery-report.md", "# Delivery\n");
    await runStateCommand({
      root,
      command: "record",
      recordType: "approval",
      status: "approved",
      path: ".harness/reports/delivery-report.md",
      message: "approved concurrent completion",
      actor: "user",
      now: () => FIXED_NOW,
    });

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
      /invalid status 'unknown'/i,
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
      /active pointer.*invalid status 'unknown'/i,
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
    await runStateCommand({ root, command: "init", storyId: "M2-042", summary: "schema", now: () => FIXED_NOW });
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

await testInitCreatesRunAndPointerWithoutEditingTemplate();
await testStatusLocatesRunThroughPointer();
await testExplicitStateFileIsIndependentFromActivePointer();
await testInitRejectsInvalidOrDuplicateRun();
await testInitRejectsRecoverableActivePointer();
await testInitKeepsNewRunDiscoverableAfterCompletedRun();
await testStatusRecoversNewRunPointerFromInterruptedReplacement();
await testInitRejectsExistingCompletedStory();
await testNextRequiresOutputsAndFollowsWorkflow();
await testNextRejectsMalformedWorkflow();
await testRecordAndTestGate();
await testReviewBlockerGate();
await testBlockAndResumeRestorePreviousPhase();
await testPassedTestsAdvanceAndTaskDagValidatorBlocks();
await testBuildOnlyCanAdvanceWithoutApproval();
await testCompleteOnlyFromGitDelivery();
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
await testValidateCommandChecksRuntimeState();
await testStatusRejectsInvalidRuntimeContract();
await testInitRejectsInvalidRecoverablePointerContract();
await testStateValidatorRequiresRuntimeMetadata();
await testRuntimeIsRegisteredInHarnessContracts();
console.log("state-runtime tests passed");
