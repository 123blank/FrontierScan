import assert from "node:assert/strict";
import { runE2ECommand } from "../lib/e2e-runtime.mjs";

function storyResult(status, overrides = {}) {
  return {
    command: "inspect",
    stateFile: ".harness/states/e2e-M7-B.json",
    state: {
      schemaVersion: "2.0",
      storyId: "M7-B",
      phase: "requirement",
      runtime: { runId: "M7-B", status: "active", revision: 1, activeBlock: null },
    },
    inspection: { status, phase: "requirement", ...overrides },
  };
}

async function testStatusMapsInspectionToOneAction() {
  const cases = [
    ["not-prepared", "prepare"],
    ["awaiting-result", "cognitive-action-required"],
    ["adapter-required", "adapter-selection-required"],
    ["result-ready", "apply-result"],
    ["recovery-required", "apply-result"],
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

await testStatusMapsInspectionToOneAction();
await testStepPreparesAtMostOnce();
await testStepAppliesAtMostOnce();
await testApplyRejectsWhenResultIsNotReady();
console.log("e2e-runtime tests passed");
