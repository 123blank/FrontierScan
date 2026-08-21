import assert from "node:assert/strict";
import { runE2ECommand } from "../lib/e2e-runtime.mjs";

function storyResult(status, overrides = {}) {
  const phase = overrides.phase ?? "requirement";
  return {
    command: "inspect",
    stateFile: ".harness/states/e2e-M7-B.json",
    state: {
      schemaVersion: "2.0",
      storyId: "M7-B",
      phase,
      runtime: { runId: "M7-B", status: "active", revision: 1, activeBlock: null },
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

async function testOtherPhasesDoNotInspectProvider() {
  let providerInspected = false;
  const result = await runE2ECommand({
    command: "status",
    runStory: async () => storyResult("awaiting-result", { phase: "implementation" }),
    inspectProvider: async () => {
      providerInspected = true;
      return { status: "provider-ready" };
    },
  });
  assert.equal(result.action, "cognitive-action-required");
  assert.equal(providerInspected, false);
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

await testStatusMapsInspectionToOneAction();
await testStepPreparesAtMostOnce();
await testStepAppliesAtMostOnce();
await testApplyRejectsWhenResultIsNotReady();
await testCodeReviewMapsProviderStatusToOneAction();
await testOtherPhasesDoNotInspectProvider();
await testProviderUsesNormalizedStoryStateFile();
await testStepDoesNotExecuteProviderAction();
console.log("e2e-runtime tests passed");
