import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAcceptance } from "../lib/acceptance-contract.mjs";
import {
  assertImplementationGate,
  assertCompletionGate,
  assertRequirementGate,
  assertTaskDagGate,
  assertUnitTestGate,
  assertVerificationGate,
  buildAcceptanceSummary,
} from "../lib/acceptance-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = "2026-08-13T00:00:00.000Z";

async function stateFixture() {
  const state = JSON.parse(await readFile(
    path.join(ROOT, ".harness/states/e2e-state-v2.template.json"),
    "utf8",
  ));
  state.storyId = "M7-A3-TEST";
  state.runtime = {
    ...state.runtime,
    runId: state.storyId,
    status: "active",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  state.baseline = {
    head: "a".repeat(40),
    branch: "dev",
    initialDirtyPaths: [],
    capturedAt: NOW,
  };
  state.requirement = {
    summary: "Trace acceptance",
    openQuestions: [],
    acceptanceCriteria: [
      { criterionId: "AC-REQ", description: "Required", source: "user", required: true },
      { criterionId: "AC-OPT", description: "Optional", source: "user", required: false },
    ],
    inScope: ["Harness"],
    outOfScope: ["Git"],
  };
  state.acceptance = { criteria: [] };
  return state;
}

function doneDag(state) {
  state.dag = {
    schemaVersion: "2.0",
    sourceFile: ".harness/runs/M7-A3-TEST/phases/02-task-dag/task-dag.json",
    sourceSha256: `sha256:${"b".repeat(64)}`,
    nodes: [{
      taskId: "T1",
      title: "Implement",
      type: "backend",
      status: "done",
      ownerAgent: "backend-developer",
      predictedFiles: [".harness/scripts/lib/acceptance-gate.mjs"],
      criterionIds: ["AC-REQ"],
    }],
    edges: [],
    waves: [["T1"]],
    globalChanges: [],
    risks: [],
  };
}

async function testAcceptanceContractIsStrict() {
  const state = await stateFixture();
  const valid = {
    criteria: [
      {
        criterionId: "AC-REQ",
        required: true,
        taskIds: ["T1"],
        testCaseIds: ["TC1"],
        verificationCaseIds: ["VC1"],
        status: "pending",
        approvalIds: [],
      },
      {
        criterionId: "AC-OPT",
        required: false,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      },
    ],
  };
  assert.doesNotThrow(() => validateAcceptance(valid, state.requirement));
  assert.throws(() => validateAcceptance({}, state.requirement), /criteria/i);
  assert.throws(
    () => validateAcceptance({
      criteria: [{ ...valid.criteria[0], unexpected: true }, valid.criteria[1]],
    }, state.requirement),
    /unsupported field/i,
  );
  assert.throws(
    () => validateAcceptance({
      criteria: [{ ...valid.criteria[0], status: "completed" }, valid.criteria[1]],
    }, state.requirement),
    /status/i,
  );
  assert.throws(
    () => validateAcceptance({
      criteria: [{ ...valid.criteria[0], taskIds: ["T1", "T1"] }, valid.criteria[1]],
    }, state.requirement),
    /unique/i,
  );
  assert.throws(
    () => validateAcceptance({
      criteria: [{ ...valid.criteria[0], required: false }, valid.criteria[1]],
    }, state.requirement),
    /required/i,
  );
}

async function testRequirementGateAndInitialSummary() {
  const state = await stateFixture();
  const before = structuredClone(state);
  assert.doesNotThrow(() => assertRequirementGate(state));
  assert.deepEqual(buildAcceptanceSummary(state), {
    criteria: [
      {
        criterionId: "AC-REQ",
        required: true,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      },
      {
        criterionId: "AC-OPT",
        required: false,
        taskIds: [],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      },
    ],
  });
  assert.deepEqual(state, before);

  const noRequired = structuredClone(state);
  noRequired.requirement.acceptanceCriteria[0].required = false;
  assert.throws(() => assertRequirementGate(noRequired), /required criterion/i);

  const open = structuredClone(state);
  open.requirement.openQuestions = [{
    questionId: "Q1",
    question: "Choose?",
    status: "open",
    resolution: null,
  }];
  assert.throws(() => assertRequirementGate(open), /open question/i);

  const inconsistent = structuredClone(state);
  inconsistent.requirement.openQuestions = [{
    questionId: "Q1",
    question: "Choose?",
    status: "resolved",
    resolution: null,
  }];
  assert.throws(() => assertRequirementGate(inconsistent), /resolution/i);
}

async function testDagAndImplementationGates() {
  const state = await stateFixture();
  doneDag(state);
  state.dag.nodes[0].status = "pending";
  assert.doesNotThrow(() => assertTaskDagGate(state));
  assert.deepEqual(buildAcceptanceSummary(state).criteria[0].taskIds, ["T1"]);

  const dangling = structuredClone(state);
  dangling.dag.nodes[0].criterionIds = ["UNKNOWN"];
  assert.throws(() => assertTaskDagGate(dangling), /unknown criterion/i);

  const uncovered = structuredClone(state);
  uncovered.dag.nodes[0].criterionIds = ["AC-OPT"];
  assert.throws(() => assertTaskDagGate(uncovered), /AC-REQ.*task/i);

  state.dag.nodes[0].status = "done";
  state.implementation = {
    method: "tdd",
    exceptionReason: null,
    actualFiles: [".harness/scripts/lib/acceptance-gate.mjs"],
    completedTaskIds: ["T1"],
    notes: [],
  };
  assert.doesNotThrow(() => assertImplementationGate(state));

  const incomplete = structuredClone(state);
  incomplete.dag.nodes[0].status = "running";
  assert.throws(() => assertImplementationGate(incomplete), /done/i);

  const emptyActual = structuredClone(state);
  emptyActual.implementation.actualFiles = [];
  assert.throws(() => assertImplementationGate(emptyActual), /notes/i);
}

async function testUnitTestGateRequiresRelevantPassedCoverage() {
  const state = await stateFixture();
  doneDag(state);
  state.implementation = {
    method: "tdd",
    exceptionReason: null,
    actualFiles: [".harness/scripts/lib/acceptance-gate.mjs"],
    completedTaskIds: ["T1"],
    notes: [],
  };
  state.tests = {
    cases: [{
      caseId: "TC1",
      type: "unit",
      required: true,
      criterionIds: ["AC-REQ"],
      expected: "Pass",
    }],
    commands: [{
      commandId: "CMD1",
      command: "node test.mjs",
      status: "passed",
      exitCode: 0,
      evidencePath: ".harness/reports/test.md",
      evidenceSha256: `sha256:${"c".repeat(64)}`,
      executedAt: NOW,
    }],
    results: [{
      caseId: "TC1",
      status: "passed",
      actual: "Passed",
      evidencePath: ".harness/reports/test.md",
      evidenceSha256: `sha256:${"c".repeat(64)}`,
      executedAt: NOW,
    }],
  };
  assert.doesNotThrow(() => assertUnitTestGate(state));
  assert.deepEqual(buildAcceptanceSummary(state).criteria[0].testCaseIds, ["TC1"]);

  const unrelated = structuredClone(state);
  unrelated.tests.cases[0].criterionIds = ["AC-OPT"];
  assert.throws(() => assertUnitTestGate(unrelated), /AC-REQ.*test/i);

  const failedOptional = structuredClone(state);
  failedOptional.tests.cases.push({
    caseId: "TC2",
    type: "unit",
    required: false,
    criterionIds: ["AC-OPT"],
    expected: "Optional",
  });
  failedOptional.tests.results.push({
    caseId: "TC2",
    status: "failed",
    actual: "Failed",
    evidencePath: null,
    evidenceSha256: null,
    executedAt: NOW,
  });
  assert.throws(() => assertUnitTestGate(failedOptional), /failed/i);

  const requiredOptionalOnly = structuredClone(state);
  requiredOptionalOnly.tests.cases.push({
    caseId: "TC-REQUIRED-OPTIONAL",
    type: "unit",
    required: true,
    criterionIds: ["AC-OPT"],
    expected: "A result exists",
  });
  assert.throws(
    () => assertUnitTestGate(requiredOptionalOnly),
    /TC-REQUIRED-OPTIONAL.*must pass/i,
  );
}

async function testVerificationGateAggregatesRequiredAndOptionalCases() {
  const state = await stateFixture();
  state.verification = {
    cases: [{
      caseId: "VC1",
      type: "api",
      required: true,
      criterionIds: ["AC-REQ"],
      action: "Call API",
      expected: "Success",
    }],
    results: [{
      caseId: "VC1",
      status: "verified",
      actual: "Success",
      evidencePath: ".harness/reports/verification.md",
      evidenceSha256: `sha256:${"d".repeat(64)}`,
      approvalId: null,
      executedAt: NOW,
    }],
    environment: {
      status: "available",
      summary: "Available",
      evidencePath: null,
      evidenceSha256: null,
    },
  };
  assert.doesNotThrow(() => assertVerificationGate(state));
  assert.equal(buildAcceptanceSummary(state).criteria[0].status, "verified");

  const missing = structuredClone(state);
  missing.verification.results = [];
  assert.throws(() => assertVerificationGate(missing), /VC1.*result/i);

  const unavailable = structuredClone(state);
  unavailable.verification.environment.status = "unavailable";
  unavailable.verification.results[0].status = "blocked";
  assert.throws(() => assertVerificationGate(unavailable), /blocked/i);

  const optionalOnly = structuredClone(state);
  optionalOnly.verification.cases.push({
    caseId: "VC2",
    type: "manual",
    required: false,
    criterionIds: ["AC-OPT"],
    action: "Optional check",
    expected: "Optional",
  });
  optionalOnly.verification.results.push({
    caseId: "VC2",
    status: "failed",
    actual: "Failed",
    evidencePath: null,
    evidenceSha256: null,
    approvalId: null,
    executedAt: NOW,
  });
  assert.doesNotThrow(() => assertVerificationGate(optionalOnly));

  const optionalRequired = structuredClone(optionalOnly);
  optionalRequired.verification.cases[1].criterionIds = ["AC-REQ"];
  assert.throws(() => assertVerificationGate(optionalRequired), /AC-REQ.*failed/i);

  const requiredOptionalOnly = structuredClone(state);
  requiredOptionalOnly.verification.cases.push({
    caseId: "VC-REQUIRED-OPTIONAL",
    type: "manual",
    required: true,
    criterionIds: ["AC-OPT"],
    action: "Required optional criterion check",
    expected: "A result exists",
  });
  assert.throws(
    () => assertVerificationGate(requiredOptionalOnly),
    /VC-REQUIRED-OPTIONAL.*no result/i,
  );
}

async function testCompletionGateRecomputesSummaryAndAppliedPhaseChain() {
  const state = await stateFixture();
  doneDag(state);
  state.implementation = {
    method: "tdd",
    exceptionReason: null,
    actualFiles: [".harness/scripts/lib/acceptance-gate.mjs"],
    completedTaskIds: ["T1"],
    notes: [],
  };
  state.tests = {
    cases: [{
      caseId: "TC1",
      type: "unit",
      required: true,
      criterionIds: ["AC-REQ"],
      expected: "Pass",
    }],
    commands: [{
      commandId: "CMD1",
      command: "node test.mjs",
      status: "passed",
      exitCode: 0,
      evidencePath: ".harness/reports/test.md",
      evidenceSha256: `sha256:${"c".repeat(64)}`,
      executedAt: NOW,
    }],
    results: [{
      caseId: "TC1",
      status: "passed",
      actual: "Passed",
      evidencePath: ".harness/reports/test.md",
      evidenceSha256: `sha256:${"c".repeat(64)}`,
      executedAt: NOW,
    }],
  };
  state.verification = {
    cases: [{
      caseId: "VC1",
      type: "api",
      required: true,
      criterionIds: ["AC-REQ"],
      action: "Call API",
      expected: "Success",
    }],
    results: [{
      caseId: "VC1",
      status: "verified",
      actual: "Success",
      evidencePath: ".harness/reports/verification.md",
      evidenceSha256: `sha256:${"d".repeat(64)}`,
      approvalId: null,
      executedAt: NOW,
    }],
    environment: {
      status: "available",
      summary: "Available",
      evidencePath: null,
      evidenceSha256: null,
    },
  };
  state.review = { findings: [], status: "passed" };
  state.build = {
    results: [{
      buildId: "BUILD1",
      type: "no-build",
      status: "passed",
      command: "no build",
      evidencePath: null,
      evidenceSha256: null,
      executedAt: NOW,
    }],
    artifacts: [],
    externalActions: [],
  };
  state.delivery.status = "ready";
  state.acceptance = buildAcceptanceSummary(state);

  const phases = [
    "requirement",
    "technical-design",
    "task-dag",
    "implementation",
    "unit-test",
    "code-review",
    "build-publish",
    "interface-verification",
  ];
  state.runtime.records = phases.map((phase, index) => ({
    id: `result:00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    type: "phase-result",
    phase,
    status: "applied",
    path: `.harness/runs/M7-A3-TEST/${phase}/result.json`,
    sha256: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
    bytes: 1,
    message: "",
    actor: "story-runtime",
    dispatchId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    preparedRevision: index + 1,
    appliedRevision: index + 2,
    createdAt: NOW,
  }));
  state.runtime.records.splice(4, 0, {
    ...state.runtime.records[3],
    id: "result:00000000-0000-4000-8000-999999999999",
    dispatchId: "00000000-0000-4000-8000-999999999999",
    status: "blocked",
  });
  assert.doesNotThrow(() => assertCompletionGate(state, {
    currentPhaseResult: {
      phase: "delivery-preparation",
      dispatchId: "00000000-0000-4000-8000-000000000009",
      preparedRevision: 9,
      appliedRevision: 10,
    },
  }));

  const resumed = structuredClone(state);
  const interfaceRecord = resumed.runtime.records.find(
    (item) => item.phase === "interface-verification" && item.status === "applied",
  );
  interfaceRecord.preparedRevision = 10;
  interfaceRecord.appliedRevision = 11;
  resumed.logs.push(
    { type: "blocked", from: "interface-verification", revision: 9, createdAt: NOW },
    { type: "resumed", to: "interface-verification", revision: 10, createdAt: NOW },
  );
  assert.doesNotThrow(() => assertCompletionGate(resumed, {
    currentPhaseResult: {
      phase: "delivery-preparation",
      dispatchId: "00000000-0000-4000-8000-000000000009",
      preparedRevision: 11,
      appliedRevision: 12,
    },
  }));

  const unexplainedGap = structuredClone(resumed);
  unexplainedGap.logs = unexplainedGap.logs.filter((item) => item.revision !== 10);
  assert.throws(
    () => assertCompletionGate(unexplainedGap, {
      currentPhaseResult: {
        phase: "delivery-preparation",
        dispatchId: "00000000-0000-4000-8000-000000000009",
        preparedRevision: 11,
        appliedRevision: 12,
      },
    }),
    /revision gap.*interface-verification/i,
  );

  const duplicateDispatch = structuredClone(state);
  duplicateDispatch.runtime.records.find(
    (item) => item.phase === "technical-design",
  ).dispatchId = duplicateDispatch.runtime.records.find(
    (item) => item.phase === "requirement",
  ).dispatchId;
  assert.throws(
    () => assertCompletionGate(duplicateDispatch, {
      currentPhaseResult: {
        phase: "delivery-preparation",
        dispatchId: "00000000-0000-4000-8000-000000000009",
        preparedRevision: 9,
        appliedRevision: 10,
      },
    }),
    /dispatch identity.*duplicated/i,
  );

  const drifted = structuredClone(state);
  drifted.acceptance.criteria[0].status = "pending";
  assert.throws(
    () => assertCompletionGate(drifted, {
      currentPhaseResult: {
        phase: "delivery-preparation",
        dispatchId: "00000000-0000-4000-8000-000000000009",
        preparedRevision: 9,
        appliedRevision: 10,
      },
    }),
    /acceptance.*drift/i,
  );

  const missing = structuredClone(state);
  missing.runtime.records = missing.runtime.records.filter((item) => item.phase !== "code-review");
  assert.throws(
    () => assertCompletionGate(missing, {
      currentPhaseResult: {
        phase: "delivery-preparation",
        dispatchId: "00000000-0000-4000-8000-000000000009",
        preparedRevision: 9,
        appliedRevision: 10,
      },
    }),
    /applied.*code-review/i,
  );
}

await testAcceptanceContractIsStrict();
await testRequirementGateAndInitialSummary();
await testDagAndImplementationGates();
await testUnitTestGateRequiresRelevantPassedCoverage();
await testVerificationGateAggregatesRequiredAndOptionalCases();
await testCompletionGateRecomputesSummaryAndAppliedPhaseChain();
console.log("acceptance gate tests passed");
