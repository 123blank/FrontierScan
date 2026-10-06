import assert from "node:assert/strict";
import { runE2ECommand } from "../lib/e2e-runtime.mjs";

function storyResult(status, overrides = {}) {
  const phase = overrides.phase ?? "requirement";
  const dagNodes = overrides.dagNodes ?? (phase === "implementation" ? [{
    taskId: "T1",
    type: "backend",
    status: "pending",
    ownerAgent: "backend-developer",
  }] : []);
  return {
    command: "inspect",
    stateFile: ".harness/states/e2e-M7-B.json",
    state: {
      schemaVersion: "2.0",
      storyId: "M7-B",
      phase,
      runtime: { runId: "M7-B", status: "active", revision: 1, activeBlock: null },
      dag: { nodes: dagNodes },
    },
    inspection: { status, ...overrides, phase },
  };
}

async function testStatusMapsInspectionToOneAction() {
  const cases = [
    ["not-prepared", "prepare"],
    ["awaiting-result", "cognitive-action-required"],
    ["adapter-required", "adapter-selection-required"],
    ["result-ready", "apply-result"],
    ["recovery-required", "apply-result"],
    ["knowledge-refresh-required", "knowledge-refresh-required"],
    ["approval-required", "approval-required"],
    ["failed-result", "failed-result"],
    ["result-invalid", "cognitive-action-required"],
    ["blocked", "blocked"],
    ["completed", "completed"],
  ];
  for (const [inspectionStatus, action] of cases) {
    const result = await runE2ECommand({
      command: "status",
      runStory: async () => storyResult(inspectionStatus),
    });
    assert.equal(result.action, action);
  }
}

async function testStepPreparesAtMostOnce() {
  const calls = [];
  const result = await runE2ECommand({
    command: "step",
    runStory: async (options) => {
      calls.push(options.command);
      if (calls.length === 1) return storyResult("not-prepared");
      if (options.command === "prepare") return { command: "prepare" };
      return storyResult("awaiting-result", {
        dispatchId: "00000000-0000-4000-8000-000000000001",
      });
    },
  });
  assert.deepEqual(calls, ["inspect", "prepare", "inspect"]);
  assert.equal(result.action, "cognitive-action-required");
}

async function testStepAppliesAtMostOnce() {
  const calls = [];
  const result = await runE2ECommand({
    command: "step",
    runStory: async (options) => {
      calls.push(options.command);
      if (calls.length === 1) return storyResult("result-ready");
      if (options.command === "apply") return { command: "apply", status: "completed" };
      return storyResult("not-prepared", { phase: "technical-design" });
    },
  });
  assert.deepEqual(calls, ["inspect", "apply", "inspect"]);
  assert.equal(result.action, "prepare");
}

async function testApplyRejectsWhenResultIsNotReady() {
  let applyCalled = false;
  await assert.rejects(
    runE2ECommand({
      command: "apply",
      runStory: async (options) => {
        if (options.command === "apply") applyCalled = true;
        return storyResult("awaiting-result");
      },
    }),
    /not ready|awaiting-result/i,
  );
  assert.equal(applyCalled, false);
}

async function testCodeReviewMapsProviderStatusToOneAction() {
  const cases = [
    ["provider-not-prepared", "provider-prepare-required"],
    ["provider-ready", "provider-run-required"],
    ["provider-run-in-progress", "provider-run-in-progress"],
    ["provider-failed", "provider-retry-decision"],
    ["provider-materialize-required", "provider-materialize-required"],
    ["provider-execution-indeterminate", "provider-indeterminate-materialization-required"],
    ["provider-invalid", "provider-invalid"],
    ["provider-materialized", "apply-result"],
  ];
  for (const [providerStatus, action] of cases) {
    const result = await runE2ECommand({
      command: "status",
      runStory: async () => storyResult("awaiting-result", { phase: "code-review" }),
      inspectProvider: async () => ({
        status: providerStatus,
        storyId: "M7-B",
        dispatchId: "00000000-0000-4000-8000-000000000001",
      }),
    });
    assert.equal(result.action, action);
    assert.equal(result.providerInspection.status, providerStatus);
  }
}

async function testImplementationMapsDevelopmentProviderStatusToOneAction() {
  const cases = [
    ["development-worktree-required", "development-worktree-required"],
    ["development-provider-not-prepared", "development-provider-prepare-required"],
    ["development-provider-ready", "development-provider-run-required"],
    ["development-provider-run-in-progress", "development-provider-run-in-progress"],
    ["development-provider-materialize-required", "development-provider-materialize-required"],
    ["development-provider-test-required", "development-provider-test-required"],
    ["adapter-selection-required", "adapter-selection-required"],
    ["development-provider-finalize-required", "development-provider-finalize-required"],
    ["development-provider-ready-for-integration", "development-provider-ready-for-integration"],
    ["development-provider-failed", "development-provider-retry-decision"],
    ["development-provider-indeterminate", "development-provider-recovery-required"],
    ["development-provider-recovery-required", "development-provider-recovery-required"],
    ["development-provider-invalid", "development-provider-invalid"],
  ];
  for (const [providerStatus, action] of cases) {
    const result = await runE2ECommand({
      command: "status",
      runStory: async () => storyResult("awaiting-result", { phase: "implementation" }),
      inspectDevelopmentProvider: async () => ({
        status: providerStatus,
        storyId: "M7-B",
        dispatchId: "00000000-0000-4000-8000-000000000001",
      }),
    });
    assert.equal(result.action, action);
    assert.equal(result.developmentProviderInspection.status, providerStatus);
  }
}

async function testOtherPhasesDoNotInspectProvider() {
  let providerInspected = false;
  let developmentProviderInspected = false;
  const result = await runE2ECommand({
    command: "status",
    runStory: async () => storyResult("awaiting-result", { phase: "technical-design" }),
    inspectProvider: async () => {
      providerInspected = true;
      return { status: "provider-ready" };
    },
    inspectDevelopmentProvider: async () => {
      developmentProviderInspected = true;
      return { status: "development-provider-ready" };
    },
  });
  assert.equal(result.action, "cognitive-action-required");
  assert.equal(providerInspected, false);
  assert.equal(developmentProviderInspected, false);
}

async function testMultiTaskImplementationDoesNotInspectDevelopmentProvider() {
  let inspected = false;
  const result = await runE2ECommand({
    command: "status",
    runStory: async () => storyResult("awaiting-result", {
      phase: "implementation",
      dagNodes: [
        { taskId: "T1", type: "backend", status: "pending", ownerAgent: "backend-developer" },
        { taskId: "T2", type: "frontend", status: "pending", ownerAgent: "frontend-developer" },
      ],
    }),
    inspectDevelopmentProvider: async () => {
      inspected = true;
      return { status: "development-provider-ready" };
    },
  });
  assert.equal(result.action, "cognitive-action-required");
  assert.equal(inspected, false);
}

async function testProviderUsesNormalizedStoryStateFile() {
  let providerOptions;
  await runE2ECommand({
    command: "status",
    stateFile: "D:\\temporary\\absolute-state.json",
    runStory: async () => storyResult("awaiting-result", { phase: "code-review" }),
    inspectProvider: async (options) => {
      providerOptions = options;
      return { status: "provider-ready" };
    },
  });
  assert.equal(providerOptions.stateFile, ".harness/states/e2e-M7-B.json");
}

async function testStepDoesNotExecuteProviderAction() {
  const storyCalls = [];
  let providerCalls = 0;
  const result = await runE2ECommand({
    command: "step",
    runStory: async (options) => {
      storyCalls.push(options.command);
      return storyResult("awaiting-result", { phase: "code-review" });
    },
    inspectProvider: async () => {
      providerCalls += 1;
      return { status: "provider-ready" };
    },
  });
  assert.deepEqual(storyCalls, ["inspect"]);
  assert.equal(providerCalls, 1);
  assert.equal(result.action, "provider-run-required");
}

async function testStepDoesNotExecuteDevelopmentProviderAction() {
  for (const [providerStatus, expectedAction] of [
    ["development-provider-ready", "development-provider-run-required"],
    ["development-provider-ready-for-integration", "development-provider-ready-for-integration"],
  ]) {
    const storyCalls = [];
    let providerCalls = 0;
    const run = () => runE2ECommand({
      command: "step",
      runStory: async (options) => {
        storyCalls.push(options.command);
        return storyResult("awaiting-result", { phase: "implementation" });
      },
      inspectDevelopmentProvider: async () => {
        providerCalls += 1;
        return { status: providerStatus };
      },
    });
    assert.equal((await run()).action, expectedAction);
    assert.equal((await run()).action, expectedAction);
    assert.deepEqual(storyCalls, ["inspect", "inspect"]);
    assert.equal(providerCalls, 2);
  }
}

await testStatusMapsInspectionToOneAction();
await testStepPreparesAtMostOnce();
await testStepAppliesAtMostOnce();
await testApplyRejectsWhenResultIsNotReady();
await testCodeReviewMapsProviderStatusToOneAction();
await testImplementationMapsDevelopmentProviderStatusToOneAction();
await testOtherPhasesDoNotInspectProvider();
await testMultiTaskImplementationDoesNotInspectDevelopmentProvider();
await testProviderUsesNormalizedStoryStateFile();
await testStepDoesNotExecuteProviderAction();
await testStepDoesNotExecuteDevelopmentProviderAction();
console.log("e2e-runtime tests passed");
