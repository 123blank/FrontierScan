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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TASK_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const V2_PHASE_DIRECTORIES = new Map([
  ["requirement", "00-requirement"],
  ["technical-design", "01-technical-design"],
  ["task-dag", "02-task-dag"],
  ["implementation", "03-implementation"],
  ["unit-test", "04-unit-test"],
  ["code-review", "05-code-review"],
  ["build-publish", "06-build-publish"],
  ["interface-verification", "07-interface-verification"],
  ["delivery-preparation", "08-delivery-preparation"],
]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactFields(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field '${unexpected}'.`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function assertTaskScope(value, label) {
  assertNonEmptyString(value, label);
  if (!TASK_SCOPE_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function assertTaskRoot(value, { storyId, phase, taskId }, label) {
  assertNonEmptyString(value, label);
  if (value !== value.trim() || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must be a repository-relative directory.`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must be a repository-relative directory.`);
  }
  if (parts.length !== 7
      || parts[0] !== ".harness"
      || parts[1] !== "runs"
      || !TASK_SCOPE_PATTERN.test(parts[2])
      || parts[3] !== "phases"
      || !/^\d{2,}-/.test(parts[4])
      || !parts[4].endsWith(`-${phase}`)
      || parts[5] !== "tasks"
      || parts[6] !== taskId) {
    throw new Error(`${label} must be the derived task directory.`);
  }
}

function assertWaveTaskRoot(value, { runId, waveId, taskId }, label) {
  assertNonEmptyString(value, label);
  if (value !== value.trim() || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must be a repository-relative directory.`);
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must be a repository-relative directory.`);
  }
  if (parts.length !== 7
      || parts[0] !== ".harness"
      || parts[1] !== "runs"
      || parts[2] !== runId
      || parts[3] !== "waves"
      || parts[4] !== waveId
      || parts[5] !== "tasks"
      || parts[6] !== taskId) {
    throw new Error(`${label} must be the derived wave task directory.`);
  }
}

function assertTaskScopedPath(value, taskRoot, label) {
  assertNonEmptyString(value, label);
  if (value !== value.trim() || value.includes("\0") || value.includes("\\") || !value.startsWith(`${taskRoot}/`)) {
    throw new Error(`${label} must stay inside taskRoot.`);
  }
  const relativeParts = value.slice(taskRoot.length + 1).split("/");
  if (relativeParts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must stay inside taskRoot.`);
  }
}

function assertUniqueStrings(value, label, { minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minItems) throw new Error(`${label} must be an array.`);
  for (const item of value) assertNonEmptyString(item, `${label} item`);
  if (new Set(value).size !== value.length) throw new Error(`${label} items must be unique.`);
}

export function isDispatchRecordStatusAllowed(type, status) {
  const allowed = {
    test: ["passed", "failed", "skipped"],
    review: ["passed", "BLOCKER", "resolved"],
    note: ["recorded"],
  };
  return allowed[type]?.includes(status) ?? false;
}

export function validateDispatchTaskStructure(task) {
  if (task?.schemaVersion === "2.0") return validateDispatchTaskV20(task);
  if (task?.schemaVersion === "1.2") return validateDispatchTaskV12(task);
  if (task?.schemaVersion === "1.1") return validateDispatchTaskV11(task);
  return validateDispatchTaskV10(task);
}

function validateDispatchTaskV20(task) {
  assertObject(task, "Dispatch task");
  const fields = [
    "schemaVersion", "dispatchId", "storyId", "runId", "phase", "ownerAgent", "purpose",
    "preparedRevision", "preparedAt", "resultSchemaVersion", "attemptRoot", "resultFile",
    "checkpointFile", "expectedOutputs", "allowedAdapters", "next",
  ];
  assertExactFields(task, fields, "Dispatch task");
  for (const field of fields) {
    if (!(field in task)) throw new Error(`Dispatch task requires '${field}'.`);
  }
  if (task.schemaVersion !== "2.0" || task.resultSchemaVersion !== "2.0") {
    throw new Error("Dispatch task and result schemaVersion must be '2.0'.");
  }
  if (!UUID_PATTERN.test(task.dispatchId)) throw new Error("Dispatch task dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(task.storyId) || task.runId !== task.storyId) {
    throw new Error("Dispatch task Story and run identity are invalid.");
  }
  for (const field of ["phase", "ownerAgent", "purpose", "next"]) {
    assertNonEmptyString(task[field], `Dispatch task ${field}`);
  }
  if (!Number.isInteger(task.preparedRevision) || task.preparedRevision < 1) {
    throw new Error("Dispatch task preparedRevision must be a positive integer.");
  }
  if (typeof task.preparedAt !== "string" || Number.isNaN(Date.parse(task.preparedAt))) {
    throw new Error("Dispatch task preparedAt must be a date-time string.");
  }
  const phaseDirectory = V2_PHASE_DIRECTORIES.get(task.phase);
  const expectedAttemptRoot = phaseDirectory
    ? `.harness/runs/${task.runId}/phases/${phaseDirectory}/attempts/${task.dispatchId}`
    : null;
  if (!expectedAttemptRoot
      || task.attemptRoot !== expectedAttemptRoot
      || task.attemptRoot.includes("\\")
      || task.attemptRoot.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Dispatch task attemptRoot must be the derived attempt directory.");
  }
  if (task.resultFile !== `${task.attemptRoot}/result.json`) {
    throw new Error("Dispatch task resultFile must stay inside attemptRoot.");
  }
  if (task.checkpointFile !== `${task.attemptRoot}/checkpoint.json`) {
    throw new Error("Dispatch task checkpointFile must stay inside attemptRoot.");
  }
  assertUniqueStrings(task.expectedOutputs, "Dispatch task expectedOutputs", { minItems: 1 });
  assertUniqueStrings(task.allowedAdapters, "Dispatch task allowedAdapters");
  return task;
}

function validateDispatchTaskV10(task) {
  assertObject(task, "Dispatch task");
  const fields = [
    "schemaVersion", "dispatchId", "storyId", "phase", "ownerAgent", "purpose",
    "preparedRevision", "preparedAt", "expectedOutputs", "allowedAdapters", "next",
  ];
  assertExactFields(task, fields, "Dispatch task");
  for (const field of fields) {
    if (!(field in task)) throw new Error(`Dispatch task requires '${field}'.`);
  }
  if (task.schemaVersion !== "1.0") throw new Error("Dispatch task schemaVersion must be '1.0'.");
  if (!UUID_PATTERN.test(task.dispatchId)) throw new Error("Dispatch task dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(task.storyId)) throw new Error("Dispatch task storyId is invalid.");
  for (const field of ["phase", "ownerAgent", "purpose", "next"]) assertNonEmptyString(task[field], `Dispatch task ${field}`);
  if (!Number.isInteger(task.preparedRevision) || task.preparedRevision < 1) {
    throw new Error("Dispatch task preparedRevision must be a positive integer.");
  }
  if (typeof task.preparedAt !== "string" || !task.preparedAt.includes("T") || Number.isNaN(Date.parse(task.preparedAt))) {
    throw new Error("Dispatch task preparedAt must be a date-time string.");
  }
  assertUniqueStrings(task.expectedOutputs, "Dispatch task expectedOutputs", { minItems: 1 });
  assertUniqueStrings(task.allowedAdapters, "Dispatch task allowedAdapters");
  return task;
}

function validateDispatchTaskV11(task) {
  assertObject(task, "Dispatch task");
  const fields = [
    "schemaVersion", "dispatchId", "storyId", "phase", "batchId", "taskId", "taskRoot",
    "ownerAgent", "purpose", "preparedRevision", "preparedAt", "expectedOutputs", "allowedAdapters", "next",
  ];
  assertExactFields(task, fields, "Dispatch task");
  for (const field of fields) {
    if (!(field in task)) throw new Error(`Dispatch task requires '${field}'.`);
  }
  if (task.schemaVersion !== "1.1") throw new Error("Dispatch task schemaVersion must be '1.1'.");
  if (!UUID_PATTERN.test(task.dispatchId)) throw new Error("Dispatch task dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(task.storyId)) throw new Error("Dispatch task storyId is invalid.");
  assertTaskScope(task.batchId, "Dispatch task batchId");
  assertTaskScope(task.taskId, "Dispatch task taskId");
  for (const field of ["phase", "ownerAgent", "purpose", "next"]) assertNonEmptyString(task[field], `Dispatch task ${field}`);
  assertTaskRoot(task.taskRoot, task, "Dispatch task taskRoot");
  if (!Number.isInteger(task.preparedRevision) || task.preparedRevision < 1) {
    throw new Error("Dispatch task preparedRevision must be a positive integer.");
  }
  if (typeof task.preparedAt !== "string" || !task.preparedAt.includes("T") || Number.isNaN(Date.parse(task.preparedAt))) {
    throw new Error("Dispatch task preparedAt must be a date-time string.");
  }
  assertUniqueStrings(task.expectedOutputs, "Dispatch task expectedOutputs", { minItems: 1 });
  task.expectedOutputs.forEach((output) => assertTaskScopedPath(output, task.taskRoot, "Dispatch task expected output"));
  assertUniqueStrings(task.allowedAdapters, "Dispatch task allowedAdapters");
  return task;
}

function validateDispatchTaskV12(task) {
  assertObject(task, "Dispatch task");
  const fields = [
    "schemaVersion", "dispatchId", "storyId", "runId", "phase",
    "waveId", "waveIndex", "taskId", "taskRoot", "ownerAgent",
    "purpose", "preparedRevision", "preparedAt",
    "expectedOutputs", "allowedAdapters", "next",
  ];
  assertExactFields(task, fields, "Dispatch task");
  for (const field of fields) {
    if (!(field in task)) throw new Error(`Dispatch task requires '${field}'.`);
  }
  if (task.schemaVersion !== "1.2") throw new Error("Dispatch task schemaVersion must be '1.2'.");
  if (!UUID_PATTERN.test(task.dispatchId)) throw new Error("Dispatch task dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(task.storyId) || task.runId !== task.storyId) {
    throw new Error("Dispatch task Story and run identity are invalid.");
  }
  if (task.phase !== "implementation") throw new Error("Dispatch task phase must be 'implementation'.");
  assertTaskScope(task.waveId, "Dispatch task waveId");
  assertTaskScope(task.taskId, "Dispatch task taskId");
  assertWaveTaskRoot(task.taskRoot, task, "Dispatch task taskRoot");
  if (!Number.isInteger(task.waveIndex) || task.waveIndex < 1) {
    throw new Error("Dispatch task waveIndex must be a positive integer.");
  }
  for (const field of ["ownerAgent", "purpose", "next"]) {
    assertNonEmptyString(task[field], `Dispatch task ${field}`);
  }
  if (!Number.isInteger(task.preparedRevision) || task.preparedRevision < 1) {
    throw new Error("Dispatch task preparedRevision must be a positive integer.");
  }
  if (typeof task.preparedAt !== "string" || !task.preparedAt.includes("T") || Number.isNaN(Date.parse(task.preparedAt))) {
    throw new Error("Dispatch task preparedAt must be a date-time string.");
  }
  assertUniqueStrings(task.expectedOutputs, "Dispatch task expectedOutputs", { minItems: 1 });
  task.expectedOutputs.forEach((output) => {
    assertTaskScopedPath(output, task.taskRoot, "Dispatch task expected output");
  });
  assertUniqueStrings(task.allowedAdapters, "Dispatch task allowedAdapters");
  return task;
}

export function validateDispatchResultStructure(result) {
  if (result?.schemaVersion === "2.0") return validateDispatchResultV20(result);
  if (result?.schemaVersion === "1.2") return validateDispatchResultV12(result);
  if (result?.schemaVersion === "1.1") return validateDispatchResultV11(result);
  return validateDispatchResultV10(result);
}

function validateDispatchResultV20(result) {
  assertObject(result, "Dispatch result");
  const common = [
    "schemaVersion", "dispatchId", "storyId", "runId", "phase", "preparedRevision",
    "status", "summary", "outputs", "records",
  ];
  const branchFields = result.status === "completed"
    ? ["payload"]
    : result.status === "failed"
      ? ["diagnostics"]
      : result.status === "blocked"
        ? ["diagnostics", "blocker"]
        : [];
  assertExactFields(result, [...common, ...branchFields], "Dispatch result");
  for (const field of [...common, ...branchFields]) {
    if (!(field in result)) throw new Error(`Dispatch result requires '${field}'.`);
  }
  if (result.schemaVersion !== "2.0") throw new Error("Dispatch result schemaVersion must be '2.0'.");
  if (!UUID_PATTERN.test(result.dispatchId)) throw new Error("Dispatch result dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(result.storyId) || result.runId !== result.storyId) {
    throw new Error("Dispatch result Story and run identity are invalid.");
  }
  assertNonEmptyString(result.phase, "Dispatch result phase");
  if (!Number.isInteger(result.preparedRevision) || result.preparedRevision < 1) {
    throw new Error("Dispatch result preparedRevision must be a positive integer.");
  }
  if (!["completed", "failed", "blocked"].includes(result.status)) {
    throw new Error("Dispatch result status is invalid.");
  }
  assertNonEmptyString(result.summary, "Dispatch result summary");
  if (!Array.isArray(result.outputs)) throw new Error("Dispatch result outputs must be an array.");
  if (result.status !== "completed" && result.outputs.length) {
    throw new Error("Failed or blocked dispatch result outputs must be empty.");
  }
  const outputPaths = [];
  for (const output of result.outputs) {
    assertObject(output, "Dispatch result output");
    assertExactFields(output, ["path", "sha256", "bytes"], "Dispatch result output");
    for (const field of ["path", "sha256", "bytes"]) {
      if (!(field in output)) throw new Error(`Dispatch result output requires '${field}'.`);
    }
    assertNonEmptyString(output.path, "Dispatch result output path");
    if (!SHA256_PATTERN.test(output.sha256)) {
      throw new Error("Dispatch result output sha256 must be a SHA-256 hash.");
    }
    if (!Number.isInteger(output.bytes) || output.bytes < 0) {
      throw new Error("Dispatch result output bytes must be a non-negative integer.");
    }
    outputPaths.push(output.path);
  }
  if (new Set(outputPaths).size !== outputPaths.length) {
    throw new Error("Dispatch result output paths must be unique.");
  }
  if (!Array.isArray(result.records)) throw new Error("Dispatch result records must be an array.");
  result.records.forEach(validateDispatchRecordV20);
  if (result.status === "completed") validatePhasePayload(result.phase, result.payload);
  else validateDiagnostics(result.diagnostics);
  if (result.status === "blocked") validateBlocker(result.blocker);
  return result;
}

function validateDispatchRecordV20(record) {
  assertObject(record, "Dispatch result record");
  const fields = ["type", "status", "path", "sha256", "bytes", "message", "actor"];
  assertExactFields(record, fields, "Dispatch result record");
  for (const field of fields) {
    if (!(field in record)) throw new Error(`Dispatch result record requires '${field}'.`);
  }
  const allowed = {
    test: ["passed", "failed", "skipped", "blocked"],
    review: ["passed", "BLOCKER", "WARNING", "resolved"],
    note: ["recorded"],
  };
  if (!allowed[record.type]?.includes(record.status)) {
    throw new Error(`Dispatch result record status '${record.status}' is invalid for type '${record.type}'.`);
  }
  if (typeof record.message !== "string") throw new Error("Dispatch result record message must be a string.");
  assertNonEmptyString(record.actor, "Dispatch result record actor");
  if (record.path === null) {
    if (record.type !== "note" || record.sha256 !== null || record.bytes !== null) {
      throw new Error("Only note records may omit path, hash, and bytes.");
    }
    return;
  }
  assertNonEmptyString(record.path, "Dispatch result record path");
  if (!SHA256_PATTERN.test(record.sha256)) throw new Error("Dispatch result record sha256 must be a SHA-256 hash.");
  if (!Number.isInteger(record.bytes) || record.bytes < 0) {
    throw new Error("Dispatch result record bytes must be a non-negative integer.");
  }
}

function validateDiagnostics(diagnostics) {
  assertObject(diagnostics, "Dispatch result diagnostics");
  const fields = ["code", "message", "details"];
  assertExactFields(diagnostics, fields, "Dispatch result diagnostics");
  for (const field of fields) {
    if (!(field in diagnostics)) throw new Error(`Dispatch result diagnostics requires '${field}'.`);
  }
  assertNonEmptyString(diagnostics.code, "Dispatch result diagnostics code");
  assertNonEmptyString(diagnostics.message, "Dispatch result diagnostics message");
  if (!Array.isArray(diagnostics.details)) throw new Error("Dispatch result diagnostics details must be an array.");
  diagnostics.details.forEach((item) => assertNonEmptyString(item, "Dispatch result diagnostics detail"));
}

function validateBlocker(blocker) {
  assertObject(blocker, "Dispatch result blocker");
  const fields = ["reason", "owner", "suggestedAction"];
  assertExactFields(blocker, fields, "Dispatch result blocker");
  for (const field of fields) assertNonEmptyString(blocker[field], `Dispatch result blocker ${field}`);
}

function validateRequirementPayload(payload) {
  assertObject(payload, "Requirement payload");
  const fields = ["acceptanceCriteria", "openQuestions", "inScope", "outOfScope"];
  assertExactFields(payload, fields, "Requirement payload");
  for (const field of fields) {
    if (!(field in payload)) throw new Error(`Requirement payload requires '${field}'.`);
    if (!Array.isArray(payload[field])) throw new Error(`Requirement payload ${field} must be an array.`);
  }
  validateRequirementData(payload, "Requirement payload");
}

function assertStrictObject(value, fields, label) {
  assertObject(value, label);
  assertExactFields(value, fields, label);
  for (const field of fields) {
    if (!(field in value)) throw new Error(`${label} requires '${field}'.`);
  }
}

function validateTechnicalDesignPayload(payload) {
  const fields = ["decisions", "affectedAreas", "knowledgeSnapshot", "risks"];
  assertStrictObject(payload, fields, "Technical design payload");
  if (!Array.isArray(payload.decisions) || !Array.isArray(payload.knowledgeSnapshot) || !Array.isArray(payload.risks)) {
    throw new Error("Technical design payload arrays are invalid.");
  }
  validateTechnicalDesignData(payload, "Technical design payload");
}

function validateTaskDagPayload(payload) {
  assertStrictObject(payload, ["taskDagFile", "taskDagSha256"], "Task DAG payload");
  assertNonEmptyString(payload.taskDagFile, "Task DAG payload taskDagFile");
  if (!SHA256_PATTERN.test(payload.taskDagSha256)) throw new Error("Task DAG payload taskDagSha256 must be a SHA-256 hash.");
}

function validateImplementationPayload(payload) {
  const fields = ["taskUpdates", "actualFiles", "method", "exceptionReason", "notes"];
  assertStrictObject(payload, fields, "Implementation payload");
  if (!Array.isArray(payload.taskUpdates)) throw new Error("Implementation payload taskUpdates must be an array.");
  payload.taskUpdates.forEach((item) => {
    assertStrictObject(item, ["taskId", "status"], "Implementation task update");
    assertNonEmptyString(item.taskId, "Implementation task update taskId");
    if (!["pending", "running", "done", "blocked"].includes(item.status)) {
      throw new Error("Implementation task update status is invalid.");
    }
  });
  validateImplementationData(payload, "Implementation payload");
  if (!["tdd", "exception"].includes(payload.method)) throw new Error("Implementation method is invalid.");
  if (payload.exceptionReason !== null) assertNonEmptyString(payload.exceptionReason, "Implementation exceptionReason");
  if (!Array.isArray(payload.notes)) throw new Error("Implementation notes must be an array.");
  payload.notes.forEach((item) => {
    if (typeof item !== "string") throw new Error("Implementation note must be a string.");
  });
}

function validateUnitTestPayload(payload) {
  assertStrictObject(payload, ["cases", "commands", "results"], "Unit test payload");
  for (const field of ["cases", "commands", "results"]) {
    if (!Array.isArray(payload[field])) throw new Error(`Unit test payload ${field} must be an array.`);
  }
  validateTestData(payload, "Unit test payload");
}

function validateCodeReviewPayload(payload) {
  assertStrictObject(payload, ["findings", "status"], "Code review payload");
  if (!Array.isArray(payload.findings)) throw new Error("Code review findings must be an array.");
  validateReviewData(payload, "Code review payload");
}

function validateBuildPayload(payload) {
  assertStrictObject(payload, ["results", "artifacts", "externalActions"], "Build payload");
  for (const field of ["results", "artifacts", "externalActions"]) {
    if (!Array.isArray(payload[field])) throw new Error(`Build payload ${field} must be an array.`);
  }
  validateBuildData(payload, "Build payload");
}

function validateInterfaceVerificationPayload(payload) {
  assertStrictObject(payload, ["cases", "results", "environment"], "Interface verification payload");
  if (!Array.isArray(payload.cases) || !Array.isArray(payload.results)) {
    throw new Error("Interface verification cases and results must be arrays.");
  }
  assertStrictObject(
    payload.environment,
    ["status", "summary", "evidencePath", "evidenceSha256"],
    "Interface verification environment",
  );
  validateVerificationData(payload, "Interface verification payload");
}

function validateDeliveryPreparationPayload(payload) {
  const fields = [
    "status", "ownedFiles", "outOfPredictionFiles", "unrelatedDirtyFiles", "remainingRisks",
    "summaryFile", "summarySha256", "gitStatus",
  ];
  assertStrictObject(payload, fields, "Delivery preparation payload");
  validateDeliveryData(payload, "Delivery preparation payload");
}

function validatePhasePayload(phase, payload) {
  const validators = {
    requirement: validateRequirementPayload,
    "technical-design": validateTechnicalDesignPayload,
    "task-dag": validateTaskDagPayload,
    implementation: validateImplementationPayload,
    "unit-test": validateUnitTestPayload,
    "code-review": validateCodeReviewPayload,
    "build-publish": validateBuildPayload,
    "interface-verification": validateInterfaceVerificationPayload,
    "delivery-preparation": validateDeliveryPreparationPayload,
  };
  const validator = validators[phase];
  if (!validator) throw new Error(`Dispatch result phase '${phase}' is invalid for State v2.`);
  validator(payload);
}

function validateDispatchResultV10(result) {
  assertObject(result, "Dispatch result");
  const required = ["schemaVersion", "dispatchId", "storyId", "phase", "status", "summary", "outputs", "records"];
  assertExactFields(result, [...required, "blocker"], "Dispatch result");
  for (const field of required) {
    if (!(field in result)) throw new Error(`Dispatch result requires '${field}'.`);
  }
  if (result.schemaVersion !== "1.0") throw new Error("Dispatch result schemaVersion must be '1.0'.");
  if (!UUID_PATTERN.test(result.dispatchId)) throw new Error("Dispatch result dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(result.storyId)) throw new Error("Dispatch result storyId is invalid.");
  assertNonEmptyString(result.phase, "Dispatch result phase");
  if (!["completed", "failed", "blocked"].includes(result.status)) throw new Error("Dispatch result status is invalid.");
  assertNonEmptyString(result.summary, "Dispatch result summary");

  if (!Array.isArray(result.outputs)) throw new Error("Dispatch result outputs must be an array.");
  const outputPaths = [];
  for (const output of result.outputs) {
    assertObject(output, "Dispatch result output");
    assertExactFields(output, ["path"], "Dispatch result output");
    assertNonEmptyString(output.path, "Dispatch result output path");
    outputPaths.push(output.path);
  }
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("Dispatch result output paths must be unique.");

  if (!Array.isArray(result.records)) throw new Error("Dispatch result records must be an array.");
  for (const record of result.records) {
    assertObject(record, "Dispatch result record");
    assertExactFields(record, ["type", "status", "path", "message", "actor"], "Dispatch result record");
    for (const field of ["type", "status", "message"]) {
      if (!(field in record)) throw new Error(`Dispatch result record requires '${field}'.`);
    }
    if (!["test", "review", "note"].includes(record.type)) throw new Error("Dispatch result record type is invalid.");
    if (typeof record.status !== "string" || typeof record.message !== "string") {
      throw new Error("Dispatch result record status and message must be strings.");
    }
    if (!isDispatchRecordStatusAllowed(record.type, record.status)) {
      throw new Error(`Dispatch result record status '${record.status}' is invalid for type '${record.type}'.`);
    }
    if (record.path !== undefined && record.path !== null && typeof record.path !== "string") {
      throw new Error("Dispatch result record path must be a string or null.");
    }
    if (record.type === "test" && !record.path) {
      throw new Error("Dispatch result test record requires an evidence path.");
    }
    if (record.actor !== undefined && typeof record.actor !== "string") {
      throw new Error("Dispatch result record actor must be a string.");
    }
  }

  if (result.blocker !== undefined) {
    assertObject(result.blocker, "Dispatch result blocker");
    const blockerFields = ["reason", "owner", "suggestedAction"];
    assertExactFields(result.blocker, blockerFields, "Dispatch result blocker");
    for (const field of blockerFields) assertNonEmptyString(result.blocker[field], `Dispatch result blocker ${field}`);
  }
  return result;
}

function validateDispatchResultV11(result) {
  assertObject(result, "Dispatch result");
  const required = [
    "schemaVersion", "dispatchId", "storyId", "phase", "batchId", "taskId", "taskRoot",
    "status", "summary", "outputs", "records",
  ];
  assertExactFields(result, [...required, "blocker"], "Dispatch result");
  for (const field of required) {
    if (!(field in result)) throw new Error(`Dispatch result requires '${field}'.`);
  }
  if (result.schemaVersion !== "1.1") throw new Error("Dispatch result schemaVersion must be '1.1'.");
  if (!UUID_PATTERN.test(result.dispatchId)) throw new Error("Dispatch result dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(result.storyId)) throw new Error("Dispatch result storyId is invalid.");
  assertTaskScope(result.batchId, "Dispatch result batchId");
  assertTaskScope(result.taskId, "Dispatch result taskId");
  assertNonEmptyString(result.phase, "Dispatch result phase");
  assertTaskRoot(result.taskRoot, result, "Dispatch result taskRoot");
  if (!["completed", "failed", "blocked"].includes(result.status)) throw new Error("Dispatch result status is invalid.");
  assertNonEmptyString(result.summary, "Dispatch result summary");

  if (!Array.isArray(result.outputs)) throw new Error("Dispatch result outputs must be an array.");
  const outputPaths = [];
  for (const output of result.outputs) {
    assertObject(output, "Dispatch result output");
    assertExactFields(output, ["path"], "Dispatch result output");
    assertNonEmptyString(output.path, "Dispatch result output path");
    assertTaskScopedPath(output.path, result.taskRoot, "Dispatch result output");
    outputPaths.push(output.path);
  }
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("Dispatch result output paths must be unique.");

  if (!Array.isArray(result.records)) throw new Error("Dispatch result records must be an array.");
  for (const record of result.records) {
    assertObject(record, "Dispatch result record");
    assertExactFields(record, ["type", "status", "path", "message", "actor"], "Dispatch result record");
    for (const field of ["type", "status", "message"]) {
      if (!(field in record)) throw new Error(`Dispatch result record requires '${field}'.`);
    }
    if (!["test", "review", "note"].includes(record.type)) throw new Error("Dispatch result record type is invalid.");
    if (typeof record.status !== "string" || typeof record.message !== "string") {
      throw new Error("Dispatch result record status and message must be strings.");
    }
    if (!isDispatchRecordStatusAllowed(record.type, record.status)) {
      throw new Error(`Dispatch result record status '${record.status}' is invalid for type '${record.type}'.`);
    }
    if (record.path !== undefined && record.path !== null && typeof record.path !== "string") {
      throw new Error("Dispatch result record path must be a string or null.");
    }
    if (record.path) assertTaskScopedPath(record.path, result.taskRoot, "Dispatch result record");
    if (record.type === "test" && !record.path) {
      throw new Error("Dispatch result test record requires an evidence path.");
    }
    if (record.actor !== undefined && typeof record.actor !== "string") {
      throw new Error("Dispatch result record actor must be a string.");
    }
  }

  if (result.blocker !== undefined) {
    assertObject(result.blocker, "Dispatch result blocker");
    const blockerFields = ["reason", "owner", "suggestedAction"];
    assertExactFields(result.blocker, blockerFields, "Dispatch result blocker");
    for (const field of blockerFields) assertNonEmptyString(result.blocker[field], `Dispatch result blocker ${field}`);
  }
  return result;
}

function validateDispatchResultV12(result) {
  assertObject(result, "Dispatch result");
  const required = [
    "schemaVersion", "dispatchId", "storyId", "runId", "phase",
    "waveId", "waveIndex", "taskId", "taskRoot",
    "status", "summary", "outputs", "records",
  ];
  assertExactFields(result, [...required, "blocker"], "Dispatch result");
  for (const field of required) {
    if (!(field in result)) throw new Error(`Dispatch result requires '${field}'.`);
  }
  if (result.schemaVersion !== "1.2") throw new Error("Dispatch result schemaVersion must be '1.2'.");
  if (!UUID_PATTERN.test(result.dispatchId)) throw new Error("Dispatch result dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(result.storyId) || result.runId !== result.storyId) {
    throw new Error("Dispatch result Story and run identity are invalid.");
  }
  if (result.phase !== "implementation") throw new Error("Dispatch result phase must be 'implementation'.");
  assertTaskScope(result.waveId, "Dispatch result waveId");
  assertTaskScope(result.taskId, "Dispatch result taskId");
  assertWaveTaskRoot(result.taskRoot, result, "Dispatch result taskRoot");
  if (!Number.isInteger(result.waveIndex) || result.waveIndex < 1) {
    throw new Error("Dispatch result waveIndex must be a positive integer.");
  }
  if (!["completed", "failed", "blocked"].includes(result.status)) {
    throw new Error("Dispatch result status is invalid.");
  }
  assertNonEmptyString(result.summary, "Dispatch result summary");

  if (!Array.isArray(result.outputs)) throw new Error("Dispatch result outputs must be an array.");
  const outputPaths = [];
  for (const output of result.outputs) {
    assertObject(output, "Dispatch result output");
    assertExactFields(output, ["path"], "Dispatch result output");
    assertNonEmptyString(output.path, "Dispatch result output path");
    assertTaskScopedPath(output.path, result.taskRoot, "Dispatch result output");
    outputPaths.push(output.path);
  }
  if (new Set(outputPaths).size !== outputPaths.length) {
    throw new Error("Dispatch result output paths must be unique.");
  }

  if (!Array.isArray(result.records)) throw new Error("Dispatch result records must be an array.");
  for (const record of result.records) {
    assertObject(record, "Dispatch result record");
    assertExactFields(record, ["type", "status", "path", "message", "actor"], "Dispatch result record");
    for (const field of ["type", "status", "message"]) {
      if (!(field in record)) throw new Error(`Dispatch result record requires '${field}'.`);
    }
    if (!["test", "review", "note"].includes(record.type)) {
      throw new Error("Dispatch result record type is invalid.");
    }
    if (typeof record.status !== "string" || typeof record.message !== "string") {
      throw new Error("Dispatch result record status and message must be strings.");
    }
    if (!isDispatchRecordStatusAllowed(record.type, record.status)) {
      throw new Error(`Dispatch result record status '${record.status}' is invalid for type '${record.type}'.`);
    }
    if (record.path !== undefined && record.path !== null && typeof record.path !== "string") {
      throw new Error("Dispatch result record path must be a string or null.");
    }
    if (record.path) assertTaskScopedPath(record.path, result.taskRoot, "Dispatch result record");
    if (record.type === "test" && !record.path) {
      throw new Error("Dispatch result test record requires an evidence path.");
    }
    if (record.actor !== undefined && typeof record.actor !== "string") {
      throw new Error("Dispatch result record actor must be a string.");
    }
  }

  if (result.blocker !== undefined) {
    assertObject(result.blocker, "Dispatch result blocker");
    const blockerFields = ["reason", "owner", "suggestedAction"];
    assertExactFields(result.blocker, blockerFields, "Dispatch result blocker");
    for (const field of blockerFields) {
      assertNonEmptyString(result.blocker[field], `Dispatch result blocker ${field}`);
    }
  }
  return result;
}
