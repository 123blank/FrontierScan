const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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

export function validateDispatchResultStructure(result) {
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
