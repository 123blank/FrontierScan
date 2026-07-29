const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const BATCH_FINALIZATION_FIELDS = [
  "schemaVersion", "storyId", "runId", "stateFile", "phase", "preparedRevision", "batchId",
  "ledgerFile", "ledgerSha256", "receiptFile", "receiptSha256", "taskSha256", "resultSha256", "notesSha256",
];

export const BATCH_RECEIPT_FINALIZATION_ARTIFACT_FIELDS = [
  "taskFile", "taskSha256", "resultFile", "resultSha256", "notesFile", "notesSha256",
];

function assertExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length
      || fields.some((field) => !Object.hasOwn(value, field))
      || keys.some((field) => !fields.includes(field))) {
    throw new Error(`${label} contains unsupported fields or is incomplete.`);
  }
}

function assertNonEmptyStrings(value, fields, label) {
  for (const field of fields) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`${label} ${field} must be a non-empty string.`);
    }
  }
}

function assertHashes(value, fields, label) {
  for (const field of fields) {
    if (!SHA256_PATTERN.test(value[field])) {
      throw new Error(`${label} ${field} must be a SHA-256 hash.`);
    }
  }
}

export function finalizationArtifactPathsFor(runId) {
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("Serial batch run ID must be a non-empty string.");
  }
  const phaseRoot = `.harness/runs/${runId}/phases/03-implementation`;
  return {
    taskFile: `${phaseRoot}/task.json`,
    resultFile: `${phaseRoot}/result.json`,
    notesFile: `${phaseRoot}/implementation-notes.md`,
  };
}

export function validateBatchFinalizationBinding(binding) {
  assertExactFields(binding, BATCH_FINALIZATION_FIELDS, "Batch finalization binding");
  if (binding.schemaVersion !== "1.0" || binding.phase !== "implementation"
      || !Number.isInteger(binding.preparedRevision) || binding.preparedRevision < 1) {
    throw new Error("Batch finalization binding has an invalid schema version, phase, or revision.");
  }
  assertNonEmptyStrings(binding, [
    "storyId", "runId", "stateFile", "batchId", "ledgerFile", "receiptFile",
  ], "Batch finalization binding");
  assertHashes(binding, [
    "ledgerSha256", "receiptSha256", "taskSha256", "resultSha256", "notesSha256",
  ], "Batch finalization binding");
  return binding;
}

export function validateBatchReceiptFinalizationArtifacts(artifacts) {
  assertExactFields(artifacts, BATCH_RECEIPT_FINALIZATION_ARTIFACT_FIELDS, "Serial batch finalization artifacts");
  assertNonEmptyStrings(artifacts, ["taskFile", "resultFile", "notesFile"], "Serial batch finalization artifacts");
  assertHashes(artifacts, ["taskSha256", "resultSha256", "notesSha256"], "Serial batch finalization artifacts");
  return artifacts;
}
