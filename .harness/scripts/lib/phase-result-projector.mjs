import { buildAcceptanceSummary } from "./acceptance-gate.mjs";

function clone(value) {
  return structuredClone(value);
}

function assertCompletedInput(state, result) {
  if (state?.schemaVersion !== "2.0" || state.runtime?.status !== "active") {
    throw new Error("Phase result projection requires an active State v2.");
  }
  if (result?.schemaVersion !== "2.0"
      || result.status !== "completed"
      || result.storyId !== state.storyId
      || result.runId !== state.runtime.runId
      || result.phase !== state.phase) {
    throw new Error("Completed phase result does not match the current State.");
  }
}

function projectImplementation(candidate, payload) {
  const updates = new Map(payload.taskUpdates.map((item) => [item.taskId, item.status]));
  for (const taskId of updates.keys()) {
    if (!candidate.dag.nodes.some((node) => node.taskId === taskId)) {
      throw new Error(`Implementation result references unknown task '${taskId}'.`);
    }
  }
  candidate.dag.nodes = candidate.dag.nodes.map((node) => (
    updates.has(node.taskId) ? { ...node, status: updates.get(node.taskId) } : node
  ));
  candidate.implementation = {
    method: payload.method,
    exceptionReason: payload.exceptionReason,
    actualFiles: clone(payload.actualFiles),
    completedTaskIds: payload.taskUpdates
      .filter((item) => item.status === "done")
      .map((item) => item.taskId),
    notes: clone(payload.notes),
  };
}

function projectTaskDag(candidate, payload, taskDag) {
  if (!taskDag || taskDag.storyId !== candidate.storyId) {
    throw new Error("Task DAG result requires a verified matching DAG document.");
  }
  candidate.dag = {
    schemaVersion: taskDag.schemaVersion,
    sourceFile: payload.taskDagFile,
    sourceSha256: payload.taskDagSha256,
    nodes: clone(taskDag.nodes),
    edges: clone(taskDag.edges),
    waves: clone(taskDag.waves),
    globalChanges: clone(taskDag.globalChanges),
    risks: clone(taskDag.risks),
  };
}

export function projectCompletedPhaseResult({ state, result, taskDag = null }) {
  assertCompletedInput(state, result);
  const candidate = clone(state);
  const payload = result.payload;

  if (result.phase === "requirement") {
    candidate.requirement = {
      summary: result.summary,
      openQuestions: clone(payload.openQuestions),
      acceptanceCriteria: clone(payload.acceptanceCriteria),
      inScope: clone(payload.inScope),
      outOfScope: clone(payload.outOfScope),
    };
    candidate.acceptance = buildAcceptanceSummary(candidate);
  } else if (result.phase === "technical-design") {
    candidate.design = {
      decisions: clone(payload.decisions),
      affectedAreas: clone(payload.affectedAreas),
      risks: clone(payload.risks),
    };
    candidate.knowledge.areas = clone(payload.knowledgeSnapshot);
  } else if (result.phase === "task-dag") {
    projectTaskDag(candidate, payload, taskDag);
    candidate.acceptance = buildAcceptanceSummary(candidate);
  } else if (result.phase === "implementation") {
    projectImplementation(candidate, payload);
    candidate.acceptance = buildAcceptanceSummary(candidate);
  } else if (result.phase === "unit-test") {
    candidate.tests = clone(payload);
    candidate.acceptance = buildAcceptanceSummary(candidate);
  } else if (result.phase === "code-review") {
    candidate.review = clone(payload);
  } else if (result.phase === "build-publish") {
    candidate.build = clone(payload);
  } else if (result.phase === "interface-verification") {
    candidate.verification = clone(payload);
    candidate.acceptance = buildAcceptanceSummary(candidate);
  } else if (result.phase === "delivery-preparation") {
    candidate.delivery = clone(payload);
    candidate.acceptance = buildAcceptanceSummary(candidate);
  } else {
    throw new Error(`Unsupported State v2 phase result '${result.phase}'.`);
  }
  return candidate;
}
