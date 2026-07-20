import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStateCommand } from "../lib/state-runtime.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";

const FIXED_NOW = "2026-07-16T00:00:00.000Z";
const FIXED_DISPATCH_ID = "00000000-0000-4000-8000-000000000001";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

  const readme = await readFile(path.join(REPOSITORY_ROOT, ".harness/scripts/README.md"), "utf8");
  assert.match(readme, /run-story\.ps1/);
  assert.match(readme, /run-adapter/);
  assert.match(readme, /apply/);

  const structureValidator = await readFile(path.join(REPOSITORY_ROOT, ".harness/scripts/validate-structure.ps1"), "utf8");
  assert.match(structureValidator, /\.harness\/schemas\/dispatch-task\.schema\.json/);
  assert.match(structureValidator, /\.harness\/schemas\/dispatch-result\.schema\.json/);
}

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
