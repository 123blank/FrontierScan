import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectCompletedPhaseResult } from "../lib/phase-result-projector.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = "2026-08-12T00:00:00.000Z";

async function stateFixture() {
  const state = JSON.parse(await readFile(
    path.join(ROOT, ".harness/states/e2e-state-v2.template.json"),
    "utf8",
  ));
  state.storyId = "M7-A2-PROJECT";
  state.phase = "requirement";
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
  return state;
}

function result(phase, payload) {
  return {
    schemaVersion: "2.0",
    dispatchId: "00000000-0000-4000-8000-000000000001",
    storyId: "M7-A2-PROJECT",
    runId: "M7-A2-PROJECT",
    phase,
    preparedRevision: 1,
    status: "completed",
    summary: `${phase} completed`,
    outputs: [],
    records: [],
    payload,
  };
}

async function testRequirementProjectionReplacesOwnedFieldsOnly() {
  const state = await stateFixture();
  state.requirement.acceptanceCriteria = [{
    criterionId: "OLD",
    description: "old",
    source: "old",
    required: false,
  }];
  const before = structuredClone(state);
  const phaseResult = result("requirement", {
    acceptanceCriteria: [{
      criterionId: "AC-001",
      description: "New criterion",
      source: "user",
      required: true,
    }],
    openQuestions: [],
    inScope: ["State projection"],
    outOfScope: ["Git automation"],
  });
  const resultBefore = structuredClone(phaseResult);

  const projected = projectCompletedPhaseResult({ state, result: phaseResult });

  assert.equal(projected.requirement.summary, "requirement completed");
  assert.deepEqual(projected.requirement.acceptanceCriteria, phaseResult.payload.acceptanceCriteria);
  assert.deepEqual(projected.design, before.design);
  assert.deepEqual(state, before);
  assert.deepEqual(phaseResult, resultBefore);
}

async function testAllPhaseOwnershipAndImplementationTaskUpdates() {
  const cases = [
    ["technical-design", {
      decisions: [{ decisionId: "D1", summary: "Use v2", rationale: "Explicit contract" }],
      affectedAreas: ["common"],
      knowledgeSnapshot: [],
      risks: [],
    }, "design"],
    ["unit-test", { cases: [], commands: [], results: [] }, "tests"],
    ["code-review", { findings: [], status: "passed" }, "review"],
    ["build-publish", { results: [], artifacts: [], externalActions: [] }, "build"],
    ["interface-verification", {
      cases: [],
      results: [],
      environment: {
        status: "unavailable",
        summary: "No environment",
        evidencePath: null,
        evidenceSha256: null,
      },
    }, "verification"],
    ["delivery-preparation", {
      status: "ready",
      ownedFiles: ["docs/example.md"],
      outOfPredictionFiles: [],
      unrelatedDirtyFiles: [],
      remainingRisks: [],
      summaryFile: null,
      summarySha256: null,
      gitStatus: "not-requested",
    }, "delivery"],
  ];
  for (const [phase, payload, field] of cases) {
    const state = await stateFixture();
    state.phase = phase;
    const projected = projectCompletedPhaseResult({ state, result: result(phase, payload) });
    if (phase === "technical-design") {
      assert.deepEqual(projected.design, {
        decisions: payload.decisions,
        affectedAreas: payload.affectedAreas,
        risks: payload.risks,
      });
      assert.deepEqual(projected.knowledge.areas, payload.knowledgeSnapshot);
    } else {
      assert.deepEqual(projected[field], payload);
    }
  }

  const implementationState = await stateFixture();
  implementationState.phase = "implementation";
  implementationState.dag.nodes = [
    { taskId: "T1", title: "One", type: "backend", status: "pending", predictedFiles: [], acceptanceCriteria: [] },
  ];
  const projected = projectCompletedPhaseResult({
    state: implementationState,
    result: result("implementation", {
      taskUpdates: [{ taskId: "T1", status: "done" }],
      actualFiles: ["backend/src/One.java"],
      method: "tdd",
      exceptionReason: null,
      notes: [],
    }),
  });
  assert.equal(projected.dag.nodes[0].status, "done");
  assert.deepEqual(projected.implementation.completedTaskIds, ["T1"]);
  assert.throws(
    () => projectCompletedPhaseResult({
      state: implementationState,
      result: result("implementation", {
        taskUpdates: [{ taskId: "UNKNOWN", status: "done" }],
        actualFiles: [],
        method: "tdd",
        exceptionReason: null,
        notes: [],
      }),
    }),
    /unknown task/i,
  );
}

async function testTaskDagProjectionUsesVerifiedDocument() {
  const state = await stateFixture();
  state.phase = "task-dag";
  const taskDag = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    nodes: [{
      taskId: "T1",
      title: "Implement",
      type: "backend",
      status: "pending",
      predictedFiles: ["backend/src/**"],
      acceptanceCriteria: ["AC-001"],
    }],
    edges: [],
    waves: [["T1"]],
    globalChanges: [],
    risks: [],
  };
  const projected = projectCompletedPhaseResult({
    state,
    result: result("task-dag", {
      taskDagFile: ".harness/runs/M7-A2-PROJECT/phases/02-task-dag/task-dag.json",
      taskDagSha256: `sha256:${"b".repeat(64)}`,
    }),
    taskDag,
  });
  assert.equal(
    projected.dag.sourceFile,
    ".harness/runs/M7-A2-PROJECT/phases/02-task-dag/task-dag.json",
  );
  assert.deepEqual(projected.dag.nodes, taskDag.nodes);
}

await testRequirementProjectionReplacesOwnedFieldsOnly();
await testAllPhaseOwnershipAndImplementationTaskUpdates();
await testTaskDagProjectionUsesVerifiedDocument();
console.log("phase-result projector tests passed");
