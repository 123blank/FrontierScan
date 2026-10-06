function criterionMap(state) {
  return new Map(state.requirement.acceptanceCriteria.map((item) => [item.criterionId, item]));
}

function uniqueReferencedIds(items, criterionId, idField) {
  const result = [];
  for (const item of items) {
    if (item.criterionIds?.includes(criterionId) && !result.includes(item[idField])) {
      result.push(item[idField]);
    }
  }
  return result;
}

export function buildAcceptanceSummary(state) {
  const approvalsByCase = new Map(
    (state.approvals ?? [])
      .filter((approval) => approval.subjectType === "verification-gap")
      .map((approval) => [approval.subjectId, approval.approvalId]),
  );
  const approvalsByCriterion = new Map();
  for (const verificationCase of state.verification.cases) {
    const approvalId = approvalsByCase.get(verificationCase.caseId);
    if (!approvalId) continue;
    for (const criterionId of verificationCase.criterionIds) {
      const ids = approvalsByCriterion.get(criterionId) ?? [];
      if (!ids.includes(approvalId)) ids.push(approvalId);
      approvalsByCriterion.set(criterionId, ids);
    }
  }
  return {
    criteria: state.requirement.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      required: criterion.required,
      taskIds: uniqueReferencedIds(state.dag.nodes, criterion.criterionId, "taskId"),
      testCaseIds: uniqueReferencedIds(state.tests.cases, criterion.criterionId, "caseId"),
      verificationCaseIds: uniqueReferencedIds(state.verification.cases, criterion.criterionId, "caseId"),
      status: aggregateVerificationStatus(state, criterion.criterionId),
      approvalIds: approvalsByCriterion.get(criterion.criterionId) ?? [],
    })),
  };
}

function aggregateVerificationStatus(state, criterionId) {
  const cases = state.verification.cases.filter((item) => item.criterionIds.includes(criterionId));
  if (!cases.length) return "pending";
  const results = new Map(state.verification.results.map((item) => [item.caseId, item]));
  const statuses = cases.map((item) => results.get(item.caseId)?.status).filter(Boolean);
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("blocked")) return "blocked";
  const requiredCases = cases.filter((item) => item.required);
  if (requiredCases.some((item) => !results.has(item.caseId))) return "pending";
  if (statuses.includes("accepted-with-known-gaps")) return "accepted-with-known-gaps";
  if (requiredCases.length && requiredCases.every((item) => results.get(item.caseId)?.status === "verified")) {
    return "verified";
  }
  return "pending";
}

export function assertRequirementGate(state) {
  const criteria = state.requirement.acceptanceCriteria;
  if (!criteria.some((item) => item.required)) {
    throw new Error("Requirement must contain at least one required criterion.");
  }
  const ids = criteria.map((item) => item.criterionId);
  if (new Set(ids).size !== ids.length) throw new Error("Requirement criterionId values must be unique.");
  for (const question of state.requirement.openQuestions) {
    if (question.status === "open") {
      if (question.resolution !== null) throw new Error("Open question resolution must be null.");
      throw new Error(`Requirement has open question '${question.questionId}'.`);
    }
    if (question.status === "resolved" && (typeof question.resolution !== "string" || !question.resolution.trim())) {
      throw new Error(`Resolved question '${question.questionId}' requires a resolution.`);
    }
  }
  return state;
}

export function assertKnowledgeGate(state) {
  const supportedAreas = new Set(["backend", "frontend", "common"]);
  const relevantByArea = new Map(
    state.knowledge.areas
      .filter((item) => item.relevant)
      .map((item) => [item.area, item]),
  );
  for (const affectedArea of state.design.affectedAreas.filter((item) => supportedAreas.has(item))) {
    if (!relevantByArea.has(affectedArea)) {
      throw new Error(`Affected knowledge area '${affectedArea}' must be marked relevant.`);
    }
  }
  for (const area of relevantByArea.values()) {
    if (!["fresh", "accepted-stale"].includes(area.status)) {
      throw new Error(`Relevant knowledge area '${area.area}' is ${area.status}.`);
    }
    if (area.status === "accepted-stale") {
      const approval = state.approvals.find((item) => item.approvalId === area.approvalId);
      if (!approval || approval.subjectType !== "knowledge-stale" || approval.subjectId !== area.area) {
        throw new Error(`Knowledge area '${area.area}' requires a valid stale approval.`);
      }
    }
  }
  return state;
}

function assertCriterionReferences(state, items, label) {
  const criteria = criterionMap(state);
  for (const item of items) {
    if (!item.criterionIds?.length) throw new Error(`${label} '${item.taskId ?? item.caseId}' requires criterionIds.`);
    for (const criterionId of item.criterionIds) {
      if (!criteria.has(criterionId)) {
        throw new Error(`${label} '${item.taskId ?? item.caseId}' references unknown criterion '${criterionId}'.`);
      }
    }
  }
}

export function assertTaskDagGate(state) {
  if (state.dag.schemaVersion !== "2.0") throw new Error("State v2 requires Task DAG 2.0.");
  assertCriterionReferences(state, state.dag.nodes, "Task");
  for (const criterion of state.requirement.acceptanceCriteria.filter((item) => item.required)) {
    if (!state.dag.nodes.some((item) => item.criterionIds.includes(criterion.criterionId))) {
      throw new Error(`Required criterion '${criterion.criterionId}' has no task coverage.`);
    }
  }
  return state;
}

export function assertImplementationGate(state) {
  if (state.implementation.method === "tdd" && state.implementation.exceptionReason !== null) {
    throw new Error("TDD implementation must have exceptionReason=null.");
  }
  if (state.implementation.method === "exception"
      && (typeof state.implementation.exceptionReason !== "string"
        || !state.implementation.exceptionReason.trim())) {
    throw new Error("Exception implementation requires a non-empty exceptionReason.");
  }
  if (!state.implementation.actualFiles.length && !state.implementation.notes.length) {
    throw new Error("Implementation with no actual files requires notes.");
  }
  if (state.dag.nodes.some((item) => item.status !== "done")) {
    throw new Error("All DAG tasks must be done before leaving implementation.");
  }
  const taskIds = state.dag.nodes.map((item) => item.taskId);
  if (state.implementation.completedTaskIds.length !== taskIds.length
      || taskIds.some((taskId) => !state.implementation.completedTaskIds.includes(taskId))) {
    throw new Error("Implementation completedTaskIds must cover all DAG tasks.");
  }
  return state;
}

export function assertUnitTestGate(state, { hasPassedAdapter = false } = {}) {
  assertCriterionReferences(state, state.tests.cases, "Test case");
  const results = new Map();
  for (const result of state.tests.results) {
    if (results.has(result.caseId)) throw new Error(`Test case '${result.caseId}' has duplicate results.`);
    if (!state.tests.cases.some((item) => item.caseId === result.caseId)) {
      throw new Error(`Test result references unknown case '${result.caseId}'.`);
    }
    if (result.status === "failed") throw new Error(`Test case '${result.caseId}' failed.`);
    results.set(result.caseId, result);
  }
  for (const testCase of state.tests.cases.filter((item) => item.required)) {
    if (results.get(testCase.caseId)?.status !== "passed") {
      throw new Error(`Required test case '${testCase.caseId}' must pass.`);
    }
  }
  for (const criterion of state.requirement.acceptanceCriteria.filter((item) => item.required)) {
    const cases = state.tests.cases.filter(
      (item) => item.required && item.criterionIds.includes(criterion.criterionId),
    );
    if (!cases.length) throw new Error(`Required criterion '${criterion.criterionId}' has no required test coverage.`);
  }
  if (!hasPassedAdapter && !state.tests.commands.some((item) => item.status === "passed")) {
    throw new Error("Unit-test gate requires at least one passed command or adapter.");
  }
  return state;
}

export function assertVerificationGate(state) {
  assertCriterionReferences(state, state.verification.cases, "Verification case");
  const cases = new Map(state.verification.cases.map((item) => [item.caseId, item]));
  const results = new Map();
  for (const result of state.verification.results) {
    if (!cases.has(result.caseId)) {
      throw new Error(`Verification result references unknown case '${result.caseId}'.`);
    }
    if (results.has(result.caseId)) {
      throw new Error(`Verification case '${result.caseId}' has duplicate results.`);
    }
    if (result.status === "accepted-with-known-gaps") {
      const approval = state.approvals.find((item) => item.approvalId === result.approvalId);
      if (!approval || approval.subjectType !== "verification-gap" || approval.subjectId !== result.caseId) {
        throw new Error(`Verification case '${result.caseId}' requires a valid approval.`);
      }
    } else if (result.approvalId !== null) {
      throw new Error(`Verification case '${result.caseId}' must not reference an approval.`);
    }
    results.set(result.caseId, result);
  }
  for (const verificationCase of state.verification.cases.filter((item) => item.required)) {
    const result = results.get(verificationCase.caseId);
    if (!result) throw new Error(`Required verification case '${verificationCase.caseId}' has no result.`);
    if (!["verified", "accepted-with-known-gaps"].includes(result.status)) {
      throw new Error(`Required verification case '${verificationCase.caseId}' is ${result.status}.`);
    }
  }

  for (const criterion of state.requirement.acceptanceCriteria.filter((item) => item.required)) {
    const requiredCases = state.verification.cases.filter(
      (item) => item.required && item.criterionIds.includes(criterion.criterionId),
    );
    if (!requiredCases.length) {
      throw new Error(`Required criterion '${criterion.criterionId}' has no required verification coverage.`);
    }
    const participating = state.verification.cases.filter(
      (item) => item.criterionIds.includes(criterion.criterionId),
    );
    const failed = participating.find((item) => results.get(item.caseId)?.status === "failed");
    if (failed) throw new Error(`Required criterion '${criterion.criterionId}' has failed verification.`);
    const blocked = participating.find((item) => results.get(item.caseId)?.status === "blocked");
    if (blocked) throw new Error(`Required criterion '${criterion.criterionId}' has blocked verification.`);
  }
  return state;
}

const COMPLETION_PHASES = [
  "requirement",
  "technical-design",
  "task-dag",
  "implementation",
  "unit-test",
  "code-review",
  "build-publish",
  "interface-verification",
  "delivery-preparation",
];

export function assertCompletionGate(state, { currentPhaseResult } = {}) {
  assertReworkSupersessions(state);
  if (state.delivery.status !== "ready") throw new Error("Delivery must be ready before completion.");
  assertKnowledgeGate(state);
  assertTaskDagGate(state);
  assertImplementationGate(state);
  assertUnitTestGate(state, { hasPassedAdapter: true });
  assertVerificationGate(state);
  if (state.review.status !== "passed"
      || state.review.findings.some((item) => item.severity === "BLOCKER" && item.status === "open")) {
    throw new Error("Code review must pass without open BLOCKER findings.");
  }
  if (state.build.results.some((item) => item.status === "failed")) {
    throw new Error("Build results must not contain failures.");
  }

  const rebuilt = buildAcceptanceSummary(state);
  if (JSON.stringify(rebuilt) !== JSON.stringify(state.acceptance)) {
    throw new Error("Acceptance summary drifted from its source facts.");
  }
  for (const criterion of state.acceptance.criteria.filter((item) => item.required)) {
    if (!["verified", "accepted-with-known-gaps"].includes(criterion.status)) {
      throw new Error(`Required criterion '${criterion.criterionId}' is not accepted.`);
    }
  }

  const supersededDispatchIds = new Set(
    (state.runtime.reworks ?? []).flatMap((item) => item.supersededDispatchIds),
  );
  const applied = state.runtime.records.filter(
    (item) => item.type === "phase-result"
      && item.status === "applied"
      && !supersededDispatchIds.has(item.dispatchId),
  );
  if (currentPhaseResult) applied.push({ ...currentPhaseResult, status: "applied" });
  let previousAppliedRevision = null;
  const appliedDispatchIds = new Set();
  const loggedRevisions = new Set(
    state.logs
      .map((item) => item.revision)
      .filter((revision) => Number.isInteger(revision)),
  );
  for (const phase of COMPLETION_PHASES) {
    const matches = applied.filter((item) => item.phase === phase);
    if (matches.length !== 1) {
      throw new Error(`Completion requires exactly one applied phase-result for '${phase}'.`);
    }
    const record = matches[0];
    if (typeof record.dispatchId !== "string" || !record.dispatchId) {
      throw new Error(`Applied phase-result dispatch identity is invalid at '${phase}'.`);
    }
    if (appliedDispatchIds.has(record.dispatchId)) {
      throw new Error(`Applied phase-result dispatch identity is duplicated at '${phase}'.`);
    }
    appliedDispatchIds.add(record.dispatchId);
    if (previousAppliedRevision !== null && record.preparedRevision < previousAppliedRevision) {
      throw new Error(`Applied phase-result revision chain is invalid at '${phase}'.`);
    }
    if (record.preparedRevision >= record.appliedRevision) {
      throw new Error(`Applied phase-result revision is invalid at '${phase}'.`);
    }
    if (previousAppliedRevision !== null) {
      for (let revision = previousAppliedRevision + 1; revision <= record.preparedRevision; revision += 1) {
        if (!loggedRevisions.has(revision)) {
          throw new Error(`Applied phase-result revision gap is unexplained at '${phase}'.`);
        }
      }
    }
    previousAppliedRevision = record.appliedRevision;
  }
  return state;
}
import { assertReworkSupersessions } from "./state-contract.mjs";
