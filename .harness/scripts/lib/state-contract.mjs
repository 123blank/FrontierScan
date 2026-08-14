import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateBuildData,
  validateDeliveryData,
  validateImplementationData,
  validateRequirementData,
  validateReviewData,
  validateTechnicalDesignData,
  validateTestData,
  validateVerificationData,
} from "./phase-data-contract.mjs";
import { validateAcceptance } from "./acceptance-contract.mjs";
import { validateFormalApproval } from "./approval-contract.mjs";

export const E2E_STATE_V1 = "1.0";
export const E2E_STATE_V2 = "2.0";

const STORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_COMMANDS = new Set(["status", "validate"]);
const WRITE_COMMANDS = new Set(["record", "next", "block", "resume", "complete"]);
const V1_PHASES = new Set([
  "requirement", "technical-design", "task-dag", "implementation", "unit-test",
  "code-review", "build-publish", "interface-verification", "git-delivery", "done", "blocked",
]);
const V2_PHASES = new Set([
  "requirement", "technical-design", "task-dag", "implementation", "unit-test",
  "code-review", "build-publish", "interface-verification", "delivery-preparation", "done", "blocked",
]);
const V2_ACTIVE_PHASES = new Set([...V2_PHASES].filter((phase) => !["done", "blocked"].includes(phase)));
const RUNTIME_STATUSES = new Set(["template", "active", "blocked", "completed"]);
const RECORD_TYPES = new Set(["output", "test", "review", "approval", "note", "phase-result"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}

function assertString(value, label, { allowEmpty = false, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || (!allowEmpty && !value)) {
    throw new Error(`${label} must be ${nullable ? "null or " : ""}a${allowEmpty ? "" : " non-empty"} string.`);
  }
}

function assertInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} has invalid value '${value ?? ""}'.`);
}

function assertKeys(value, allowed, required, label) {
  assertObject(value, label);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing required field '${key}'.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unsupported field '${key}'.`);
  }
}

function assertNullableDate(value, label, nullable) {
  if (nullable && value === null) return;
  assertString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO-8601 timestamp.`);
}

function validateRecords(records, label, { strict = false } = {}) {
  assertArray(records, label);
  for (const [index, record] of records.entries()) {
    const recordLabel = `${label}[${index}]`;
    if (strict && record?.type === "phase-result") {
      const required = [
        "id", "type", "phase", "status", "path", "sha256", "bytes", "message", "actor",
        "dispatchId", "preparedRevision", "appliedRevision", "createdAt",
      ];
      assertKeys(record, new Set(required), required, recordLabel);
      for (const field of ["id", "phase", "path", "message", "actor", "dispatchId"]) {
        assertString(record[field], `${recordLabel}.${field}`, { allowEmpty: field === "message" });
      }
      assertEnum(record.status, new Set(["applied", "blocked"]), `${recordLabel}.status`);
      assertEnum(record.phase, V2_ACTIVE_PHASES, `${recordLabel}.phase`);
      if (!UUID_PATTERN.test(record.dispatchId)) throw new Error(`${recordLabel}.dispatchId must be a UUID.`);
      if (record.id !== `result:${record.dispatchId}`) {
        throw new Error(`${recordLabel}.id must match its dispatchId.`);
      }
      if (!SHA256_PATTERN.test(record.sha256)) throw new Error(`${recordLabel}.sha256 must be a SHA-256 hash.`);
      assertInteger(record.bytes, `${recordLabel}.bytes`);
      assertInteger(record.preparedRevision, `${recordLabel}.preparedRevision`, 1);
      assertInteger(record.appliedRevision, `${recordLabel}.appliedRevision`, 1);
      if (record.preparedRevision >= record.appliedRevision) {
        throw new Error(`${recordLabel}.preparedRevision must be less than appliedRevision.`);
      }
      assertNullableDate(record.createdAt, `${recordLabel}.createdAt`, false);
      continue;
    }
    const required = ["id", "type", "phase", "status", "path", "message", "actor", "createdAt"];
    if (strict) assertKeys(record, new Set([...required, "sha256"]), required, recordLabel);
    else {
      assertObject(record, recordLabel);
      for (const field of required) {
        if (!Object.hasOwn(record, field)) throw new Error(`${recordLabel} is missing required field '${field}'.`);
      }
    }
    assertString(record.id, `${label}[${index}].id`);
    assertEnum(record.type, RECORD_TYPES, `${label}[${index}].type`);
    assertString(record.phase, `${label}[${index}].phase`);
    assertString(record.status, `${label}[${index}].status`);
    if (record.path !== null) assertString(record.path, `${label}[${index}].path`);
    assertString(record.message, `${label}[${index}].message`, { allowEmpty: true });
    assertString(record.actor, `${label}[${index}].actor`);
    assertNullableDate(record.createdAt, `${label}[${index}].createdAt`, false);
    if (record.sha256 !== undefined && !SHA256_PATTERN.test(record.sha256)) {
      throw new Error(`${label}[${index}].sha256 must be a SHA-256 hash.`);
    }
  }
}

function validateV1Runtime(state) {
  assertObject(state.runtime, "E2E v1 runtime");
  for (const field of ["runId", "workflow", "status", "revision", "previousPhase", "blocked", "records", "createdAt", "updatedAt"]) {
    if (!Object.hasOwn(state.runtime, field)) throw new Error(`E2E v1 runtime is missing required field '${field}'.`);
  }
  if (state.runtime.runId !== state.storyId) throw new Error("E2E v1 runtime runId must match storyId.");
  assertString(state.runtime.workflow, "E2E v1 runtime workflow");
  assertEnum(state.runtime.status, RUNTIME_STATUSES, "E2E v1 runtime status");
  assertInteger(state.runtime.revision, "E2E v1 runtime revision");
  validateRecords(state.runtime.records, "E2E v1 runtime records");
  if (state.runtime.status === "blocked"
      && (state.phase !== "blocked" || !state.runtime.blocked?.previousPhase)) {
    throw new Error("Blocked E2E v1 state must include its previous phase.");
  }
  if (state.runtime.status === "completed" && state.phase !== "done") {
    throw new Error("Completed E2E v1 state must be in the done phase.");
  }
}

export function validateE2EStateV1(state) {
  assertObject(state, "E2E v1 state");
  const required = [
    "schemaVersion", "storyId", "phase", "runtime", "requirement", "knowledge", "tasks",
    "dag", "worktrees", "tests", "review", "verification", "delivery", "logs",
  ];
  for (const field of required) {
    if (!Object.hasOwn(state, field)) throw new Error(`E2E v1 state is missing required field '${field}'.`);
  }
  if (state.schemaVersion !== E2E_STATE_V1) throw new Error("E2E v1 schemaVersion must be '1.0'.");
  if (!STORY_ID_PATTERN.test(state.storyId ?? "")) throw new Error("E2E v1 storyId is invalid.");
  assertEnum(state.phase, V1_PHASES, "E2E v1 phase");
  validateV1Runtime(state);
  assertArray(state.tasks, "E2E v1 tasks");
  assertArray(state.worktrees, "E2E v1 worktrees");
  assertArray(state.logs, "E2E v1 logs");
  return state;
}

function validateActiveBlock(value, label) {
  assertKeys(
    value,
    new Set(["previousPhase", "reason", "owner", "suggestedAction", "blockedAt"]),
    ["previousPhase", "reason", "owner", "suggestedAction", "blockedAt"],
    label,
  );
  assertEnum(value.previousPhase, V2_ACTIVE_PHASES, `${label}.previousPhase`);
  for (const field of ["reason", "owner", "suggestedAction"]) {
    assertString(value[field], `${label}.${field}`);
  }
  assertNullableDate(value.blockedAt, `${label}.blockedAt`, false);
}

function validateDirtyPaths(items) {
  assertArray(items, "E2E v2 baseline.initialDirtyPaths");
  const paths = new Set();
  for (const [index, item] of items.entries()) {
    const label = `E2E v2 baseline.initialDirtyPaths[${index}]`;
    assertKeys(
      item,
      new Set(["path", "sourcePath", "indexStatus", "worktreeStatus", "untracked"]),
      ["path", "indexStatus", "worktreeStatus", "untracked"],
      label,
    );
    assertString(item.path, `${label}.path`);
    if (path.isAbsolute(item.path) || item.path.replaceAll("\\", "/").startsWith("../")) {
      throw new Error(`${label}.path must be repository-relative.`);
    }
    if (paths.has(item.path)) throw new Error(`${label}.path must be unique.`);
    paths.add(item.path);
    if (Object.hasOwn(item, "sourcePath")) {
      assertString(item.sourcePath, `${label}.sourcePath`);
      if (path.isAbsolute(item.sourcePath) || item.sourcePath.replaceAll("\\", "/").startsWith("../")) {
        throw new Error(`${label}.sourcePath must be repository-relative.`);
      }
    }
    if (typeof item.indexStatus !== "string" || item.indexStatus.length !== 1) {
      throw new Error(`${label}.indexStatus must be one character.`);
    }
    if (typeof item.worktreeStatus !== "string" || item.worktreeStatus.length !== 1) {
      throw new Error(`${label}.worktreeStatus must be one character.`);
    }
    if (typeof item.untracked !== "boolean") throw new Error(`${label}.untracked must be boolean.`);
    const renameOrCopy = ["R", "C"].includes(item.indexStatus) || ["R", "C"].includes(item.worktreeStatus);
    if (renameOrCopy !== Object.hasOwn(item, "sourcePath")) {
      throw new Error(`${label}.sourcePath must be present exactly for rename/copy entries.`);
    }
  }
}

function validateSimpleArrayObject(value, allowedFields, label) {
  assertKeys(value, new Set(allowedFields), allowedFields, label);
  for (const field of allowedFields) assertArray(value[field], `${label}.${field}`);
}

function validateV2Runtime(state) {
  const runtime = state.runtime;
  const fields = [
    "runId", "workflow", "workflowVersion", "status", "revision", "previousPhase",
    "activeBlock", "records", "createdAt", "updatedAt",
  ];
  assertKeys(runtime, new Set(fields), fields, "E2E v2 runtime");
  if (runtime.runId !== state.storyId) throw new Error("E2E v2 runtime runId must match storyId.");
  assertString(runtime.workflow, "E2E v2 runtime.workflow");
  if (runtime.workflowVersion !== E2E_STATE_V2) {
    throw new Error("E2E v2 runtime.workflowVersion must be '2.0'.");
  }
  assertEnum(runtime.status, RUNTIME_STATUSES, "E2E v2 runtime.status");
  assertInteger(runtime.revision, "E2E v2 runtime.revision");
  if (runtime.previousPhase !== null) assertString(runtime.previousPhase, "E2E v2 runtime.previousPhase");
  validateRecords(runtime.records, "E2E v2 runtime.records", { strict: true });

  const template = runtime.status === "template";
  assertNullableDate(runtime.createdAt, "E2E v2 runtime.createdAt", template);
  assertNullableDate(runtime.updatedAt, "E2E v2 runtime.updatedAt", template);
  if (template && runtime.revision !== 0) throw new Error("E2E v2 template revision must be 0.");
  if (!template && runtime.revision < 1) throw new Error("Active E2E v2 revision must be positive.");
  if (template && state.phase !== "requirement") {
    throw new Error("E2E v2 template phase must be 'requirement'.");
  }
  if (runtime.status === "active" && !V2_ACTIVE_PHASES.has(state.phase)) {
    throw new Error(`E2E v2 phase '${state.phase}' is invalid for active status.`);
  }
  if (state.phase === "blocked" && runtime.status !== "blocked") {
    throw new Error("E2E v2 blocked phase requires blocked status.");
  }
  if (state.phase === "done" && runtime.status !== "completed") {
    throw new Error("E2E v2 done phase requires completed status.");
  }

  if (runtime.status === "blocked") {
    if (state.phase !== "blocked" || runtime.activeBlock === null) {
      throw new Error("Blocked E2E v2 state must include activeBlock.");
    }
    validateActiveBlock(runtime.activeBlock, "E2E v2 runtime.activeBlock");
  } else if (runtime.activeBlock !== null) {
    throw new Error("Non-blocked E2E v2 state must have activeBlock=null.");
  }
  if (runtime.status === "completed" && state.phase !== "done") {
    throw new Error("Completed E2E v2 state must be in the done phase.");
  }
}

function validateV2Baseline(state) {
  const baseline = state.baseline;
  const fields = ["head", "branch", "initialDirtyPaths", "capturedAt"];
  assertKeys(baseline, new Set(fields), fields, "E2E v2 baseline");
  const template = state.runtime.status === "template";
  if (template) {
    if (baseline.head !== null) assertString(baseline.head, "E2E v2 baseline.head");
    if (baseline.branch !== null) assertString(baseline.branch, "E2E v2 baseline.branch");
  } else {
    if (!COMMIT_PATTERN.test(baseline.head ?? "")) throw new Error("E2E v2 baseline.head must be a Git commit.");
    assertString(baseline.branch, "E2E v2 baseline.branch");
  }
  validateDirtyPaths(baseline.initialDirtyPaths);
  assertNullableDate(baseline.capturedAt, "E2E v2 baseline.capturedAt", template);
}

export function validateE2EStateV2(state) {
  const fields = [
    "schemaVersion", "storyId", "phase", "runtime", "baseline", "requirement", "knowledge",
    "acceptance", "design", "dag", "implementation", "tests", "review", "build", "verification",
    "delivery", "approvals", "worktrees", "logs",
  ];
  assertKeys(state, new Set(fields), fields, "E2E v2 state");
  if (state.schemaVersion !== E2E_STATE_V2) throw new Error("E2E v2 schemaVersion must be '2.0'.");
  if (!STORY_ID_PATTERN.test(state.storyId ?? "")) throw new Error("E2E v2 storyId is invalid.");
  assertEnum(state.phase, V2_PHASES, "E2E v2 phase");
  validateV2Runtime(state);
  validateV2Baseline(state);

  assertKeys(
    state.requirement,
    new Set(["summary", "openQuestions", "acceptanceCriteria", "inScope", "outOfScope"]),
    ["summary", "openQuestions", "acceptanceCriteria", "inScope", "outOfScope"],
    "E2E v2 requirement",
  );
  assertString(state.requirement.summary, "E2E v2 requirement.summary", { allowEmpty: true });
  for (const field of ["openQuestions", "acceptanceCriteria", "inScope", "outOfScope"]) {
    assertArray(state.requirement[field], `E2E v2 requirement.${field}`);
  }
  for (const [index, criterion] of state.requirement.acceptanceCriteria.entries()) {
    const label = `E2E v2 requirement.acceptanceCriteria[${index}]`;
    const fields = ["criterionId", "description", "source", "required"];
    assertKeys(criterion, new Set(fields), fields, label);
    for (const field of ["criterionId", "description", "source"]) {
      assertString(criterion[field], `${label}.${field}`);
    }
    if (typeof criterion.required !== "boolean") throw new Error(`${label}.required must be boolean.`);
  }
  validateRequirementData(state.requirement, "E2E v2 requirement");
  validateAcceptance(state.acceptance, state.requirement, "E2E v2 acceptance");
  assertKeys(state.knowledge, new Set(["areas"]), ["areas"], "E2E v2 knowledge");
  assertArray(state.knowledge.areas, "E2E v2 knowledge.areas");
  for (const [index, area] of state.knowledge.areas.entries()) {
    const label = `E2E v2 knowledge.areas[${index}]`;
    const fields = [
      "area", "relevant", "observedStatus", "status", "sourceFingerprint", "loadedFiles", "missing", "checkedAt",
      "freshnessEvidencePath", "freshnessEvidenceSha256", "refreshTaskPath", "refreshTaskSha256",
      "refreshReceiptPath", "refreshReceiptSha256", "approvalId",
    ];
    assertKeys(area, new Set(fields), fields, label);
    assertString(area.area, `${label}.area`);
    if (typeof area.relevant !== "boolean") throw new Error(`${label}.relevant must be boolean.`);
    assertString(area.observedStatus, `${label}.observedStatus`);
    assertString(area.status, `${label}.status`);
    if (area.sourceFingerprint !== null) assertString(area.sourceFingerprint, `${label}.sourceFingerprint`);
    assertArray(area.loadedFiles, `${label}.loadedFiles`);
    assertArray(area.missing, `${label}.missing`);
    assertNullableDate(area.checkedAt, `${label}.checkedAt`, true);
    for (const field of [
      "freshnessEvidencePath", "freshnessEvidenceSha256", "refreshTaskPath", "refreshTaskSha256",
      "refreshReceiptPath", "refreshReceiptSha256", "approvalId",
    ]) {
      if (area[field] !== null) assertString(area[field], `${label}.${field}`);
    }
  }
  validateSimpleArrayObject(state.design, ["decisions", "affectedAreas", "risks"], "E2E v2 design");
  validateTechnicalDesignData(
    { ...state.design, knowledgeSnapshot: state.knowledge.areas },
    "E2E v2 technical design",
  );

  const dagFields = ["schemaVersion", "sourceFile", "sourceSha256", "nodes", "edges", "waves", "globalChanges", "risks"];
  assertKeys(state.dag, new Set(dagFields), dagFields, "E2E v2 dag");
  if (state.dag.schemaVersion !== null) {
    assertEnum(state.dag.schemaVersion, new Set(["2.0"]), "E2E v2 dag.schemaVersion");
  }
  if (state.dag.sourceFile !== null) assertString(state.dag.sourceFile, "E2E v2 dag.sourceFile");
  if (state.dag.sourceSha256 !== null && !SHA256_PATTERN.test(state.dag.sourceSha256)) {
    throw new Error("E2E v2 dag.sourceSha256 must be a SHA-256 hash.");
  }
  for (const field of ["nodes", "edges", "waves", "globalChanges", "risks"]) {
    assertArray(state.dag[field], `E2E v2 dag.${field}`);
  }

  const implementationFields = ["method", "exceptionReason", "actualFiles", "completedTaskIds", "notes"];
  assertKeys(state.implementation, new Set(implementationFields), implementationFields, "E2E v2 implementation");
  if (state.implementation.method !== null) assertEnum(state.implementation.method, new Set(["tdd", "exception"]), "E2E v2 implementation.method");
  if (state.implementation.exceptionReason !== null) assertString(state.implementation.exceptionReason, "E2E v2 implementation.exceptionReason");
  for (const field of ["actualFiles", "completedTaskIds", "notes"]) {
    assertArray(state.implementation[field], `E2E v2 implementation.${field}`);
  }
  validateImplementationData(state.implementation, "E2E v2 implementation");
  state.implementation.completedTaskIds.forEach((taskId) => {
    if (!STORY_ID_PATTERN.test(taskId)) throw new Error("E2E v2 implementation.completedTaskIds item is invalid.");
  });

  validateSimpleArrayObject(state.tests, ["cases", "commands", "results"], "E2E v2 tests");
  validateTestData(state.tests, "E2E v2 tests");
  assertKeys(state.review, new Set(["findings", "status"]), ["findings", "status"], "E2E v2 review");
  assertArray(state.review.findings, "E2E v2 review.findings");
  assertString(state.review.status, "E2E v2 review.status");
  validateReviewData(state.review, "E2E v2 review");
  validateSimpleArrayObject(state.build, ["results", "artifacts", "externalActions"], "E2E v2 build");
  validateBuildData(state.build, "E2E v2 build");

  assertKeys(
    state.verification,
    new Set(["cases", "results", "environment"]),
    ["cases", "results", "environment"],
    "E2E v2 verification",
  );
  assertArray(state.verification.cases, "E2E v2 verification.cases");
  assertArray(state.verification.results, "E2E v2 verification.results");
  assertKeys(
    state.verification.environment,
    new Set(["status", "summary", "evidencePath", "evidenceSha256"]),
    ["status", "summary", "evidencePath", "evidenceSha256"],
    "E2E v2 verification.environment",
  );
  assertEnum(
    state.verification.environment.status,
    new Set(["not-checked", "available", "unavailable"]),
    "E2E v2 verification.environment.status",
  );
  assertString(state.verification.environment.summary, "E2E v2 verification.environment.summary", { allowEmpty: true });
  if ((state.verification.environment.evidencePath === null)
      !== (state.verification.environment.evidenceSha256 === null)) {
    throw new Error("E2E v2 verification.environment evidence path and hash must both be null or both be present.");
  }
  if (state.verification.environment.evidencePath !== null) {
    assertString(state.verification.environment.evidencePath, "E2E v2 verification.environment.evidencePath");
    if (!SHA256_PATTERN.test(state.verification.environment.evidenceSha256)) {
      throw new Error("E2E v2 verification.environment.evidenceSha256 must be a SHA-256 hash.");
    }
  }
  validateVerificationData(state.verification, "E2E v2 verification");

  const deliveryFields = [
    "status", "ownedFiles", "outOfPredictionFiles", "unrelatedDirtyFiles", "remainingRisks",
    "summaryFile", "summarySha256", "ownedManifestFile", "ownedManifestSha256", "gitStatus",
  ];
  assertKeys(state.delivery, new Set(deliveryFields), deliveryFields, "E2E v2 delivery");
  assertEnum(state.delivery.status, new Set(["pending", "ready", "blocked"]), "E2E v2 delivery.status");
  for (const field of ["ownedFiles", "outOfPredictionFiles", "unrelatedDirtyFiles", "remainingRisks"]) {
    assertArray(state.delivery[field], `E2E v2 delivery.${field}`);
  }
  if (state.delivery.summaryFile !== null) assertString(state.delivery.summaryFile, "E2E v2 delivery.summaryFile");
  if (state.delivery.summarySha256 !== null && !SHA256_PATTERN.test(state.delivery.summarySha256)) {
    throw new Error("E2E v2 delivery.summarySha256 must be a SHA-256 hash.");
  }
  if (state.delivery.ownedManifestFile !== null) {
    assertString(state.delivery.ownedManifestFile, "E2E v2 delivery.ownedManifestFile");
  }
  if (state.delivery.ownedManifestSha256 !== null && !SHA256_PATTERN.test(state.delivery.ownedManifestSha256)) {
    throw new Error("E2E v2 delivery.ownedManifestSha256 must be a SHA-256 hash.");
  }
  assertEnum(state.delivery.gitStatus, new Set(["not-requested", "requested"]), "E2E v2 delivery.gitStatus");
  validateDeliveryData(state.delivery, "E2E v2 delivery");
  assertArray(state.approvals, "E2E v2 approvals");
  const approvalIds = new Set();
  for (const approval of state.approvals) {
    validateFormalApproval(approval);
    if (approvalIds.has(approval.approvalId)) {
      throw new Error("E2E v2 approvals approvalId values must be unique.");
    }
    approvalIds.add(approval.approvalId);
  }
  assertArray(state.worktrees, "E2E v2 worktrees");
  assertArray(state.logs, "E2E v2 logs");
  return state;
}

export function detectE2EStateVersion(state) {
  assertObject(state, "E2E state");
  if (typeof state.schemaVersion !== "string" || !state.schemaVersion) {
    throw new Error("E2E state schemaVersion must be a non-empty string.");
  }
  if (![E2E_STATE_V1, E2E_STATE_V2].includes(state.schemaVersion)) {
    throw new Error(`Unsupported E2E state schemaVersion '${state.schemaVersion}'.`);
  }
  return state.schemaVersion;
}

export function validateProductState(state) {
  assertObject(state, "Product state");
  for (const field of ["schemaVersion", "requestId", "phase", "sourceRequest", "stories", "join", "decisions", "logs"]) {
    if (!Object.hasOwn(state, field)) throw new Error(`Product state is missing required field '${field}'.`);
  }
  assertString(state.schemaVersion, "Product state schemaVersion");
  assertString(state.requestId, "Product state requestId");
  assertArray(state.stories, "Product state stories");
  assertArray(state.decisions, "Product state decisions");
  assertArray(state.logs, "Product state logs");
  return state;
}

export function validateActivePointer(pointer) {
  const fields = ["schemaVersion", "runId", "stateFile", "status", "revision", "updatedAt"];
  assertKeys(pointer, new Set(fields), fields, "Active pointer");
  if (pointer.schemaVersion !== E2E_STATE_V1) {
    throw new Error("Active pointer schemaVersion must be '1.0'.");
  }
  if (!STORY_ID_PATTERN.test(pointer.runId ?? "")) throw new Error("Active pointer runId is invalid.");
  const expectedStateFile = `.harness/states/e2e-${pointer.runId}.json`;
  if (pointer.stateFile !== expectedStateFile) throw new Error("Active pointer stateFile must match runId.");
  assertEnum(pointer.status, new Set(["active", "blocked", "completed"]), "Active pointer status");
  assertInteger(pointer.revision, "Active pointer revision", 1);
  assertNullableDate(pointer.updatedAt, "Active pointer updatedAt", false);
  return pointer;
}

export function detectStateKind(value) {
  assertObject(value, "State document");
  if (Object.hasOwn(value, "storyId")) return "e2e";
  if (Object.hasOwn(value, "requestId")) return "product";
  if (Object.hasOwn(value, "runId") && Object.hasOwn(value, "stateFile")) return "active-run";
  throw new Error("Unknown state document type.");
}

export function validateStateDocument(value) {
  const kind = detectStateKind(value);
  if (kind === "e2e") {
    const schemaVersion = detectE2EStateVersion(value);
    if (schemaVersion === E2E_STATE_V1) validateE2EStateV1(value);
    else validateE2EStateV2(value);
    return {
      kind,
      schemaVersion,
      capabilities: {
        allowedCommands: schemaVersion === E2E_STATE_V1 || value.runtime.status === "template" || value.runtime.status === "completed"
          ? ["status", "validate"]
          : ["status", "validate", "record", "next", "block", "resume", "complete"],
      },
    };
  }
  if (kind === "product") {
    validateProductState(value);
    return { kind, schemaVersion: value.schemaVersion, capabilities: { allowedCommands: ["validate"] } };
  }
  validateActivePointer(value);
  return { kind, schemaVersion: value.schemaVersion, capabilities: { allowedCommands: ["validate"] } };
}

export function assertStateCommandAllowed(state, command) {
  if (READ_COMMANDS.has(command)) return;
  if (!WRITE_COMMANDS.has(command)) throw new Error(`Unsupported state command: ${command ?? "(missing)"}`);
  const version = detectE2EStateVersion(state);
  if (version === E2E_STATE_V1) {
    throw new Error(`State v1 is read-only; command '${command}' is not allowed.`);
  }
  if (state.runtime?.status === "template") {
    throw new Error(`State template is read-only; command '${command}' is not allowed.`);
  }
  if (state.runtime?.status === "completed") {
    throw new Error("A completed run is immutable.");
  }
}

async function runCli() {
  const [command, ...tokens] = process.argv.slice(2);
  if (command !== "validate-file") throw new Error(`Unsupported state contract command: ${command ?? "(missing)"}`);
  if (tokens[0] !== "--state-file" || !tokens[1] || tokens.length !== 2) {
    throw new Error("validate-file requires --state-file <path>.");
  }
  const stateFile = path.resolve(tokens[1]);
  const value = JSON.parse(await readFile(stateFile, "utf8"));
  const result = validateStateDocument(value);
  console.log("Harness state validation passed.");
  console.log(`State type: ${result.kind}`);
  console.log(`State version: ${result.schemaVersion}`);
  console.log(`State file: ${stateFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
