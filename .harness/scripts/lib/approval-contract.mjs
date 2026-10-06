import { createHash } from "node:crypto";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RECEIPT_FIELDS = [
  "schemaVersion",
  "approvalId",
  "storyId",
  "runId",
  "phase",
  "dispatchId",
  "preparedRevision",
  "subjectType",
  "subjectId",
  "subjectSha256",
  "status",
  "actor",
  "reason",
  "evidencePath",
  "evidenceSha256",
  "createdAt",
];

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => [key, ordered(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function verificationGapSubject(caseValue, resultValue, task) {
  const { approvalId: ignored, ...result } = resultValue;
  return {
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    dispatchId: task.dispatchId,
    preparedRevision: task.preparedRevision,
    case: structuredClone(caseValue),
    result: structuredClone(result),
  };
}

export function verificationGapSubjectSha256(caseValue, resultValue, task) {
  return sha256(canonicalJson(verificationGapSubject(caseValue, resultValue, task)));
}

export function knowledgeStaleSubject(area, task) {
  return {
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    dispatchId: task.dispatchId,
    preparedRevision: task.preparedRevision,
    area: area.area,
    observedStatus: area.observedStatus,
    sourceFingerprint: area.sourceFingerprint,
    missing: structuredClone(area.missing),
    freshnessEvidencePath: area.freshnessEvidencePath,
    freshnessEvidenceSha256: area.freshnessEvidenceSha256,
    refreshTaskPath: area.refreshTaskPath,
    refreshTaskSha256: area.refreshTaskSha256,
  };
}

export function knowledgeStaleSubjectSha256(area, task) {
  return sha256(canonicalJson(knowledgeStaleSubject(area, task)));
}

export function approvalSemanticKey(value) {
  return {
    storyId: value.storyId,
    dispatchId: value.dispatchId,
    caseId: value.caseId,
    subjectSha256: value.subjectSha256,
    actor: value.actor,
    reason: value.reason,
  };
}

export function deterministicApprovalId(value) {
  return `APR-${sha256(canonicalJson(value)).slice("sha256:".length, "sha256:".length + 32)}`;
}

function assertObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label} requires '${field}'.`);
  }
  const extra = Object.keys(value).find((field) => !fields.includes(field));
  if (extra) throw new Error(`${label} contains unsupported field '${extra}'.`);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 timestamp.`);
  }
}

function assertReceiptShape(receipt, label) {
  assertObject(receipt, RECEIPT_FIELDS, label);
  if (receipt.schemaVersion !== "1.0") throw new Error(`${label}.schemaVersion is invalid.`);
  for (const field of ["approvalId", "storyId", "runId", "subjectId"]) assertId(receipt[field], `${label}.${field}`);
  if (!UUID_PATTERN.test(receipt.dispatchId)) throw new Error(`${label}.dispatchId is invalid.`);
  if (!Number.isInteger(receipt.preparedRevision) || receipt.preparedRevision < 1) {
    throw new Error(`${label}.preparedRevision is invalid.`);
  }
  if (!["interface-verification", "technical-design"].includes(receipt.phase)) {
    throw new Error(`${label}.phase is invalid.`);
  }
  if (!["verification-gap", "knowledge-stale"].includes(receipt.subjectType)) {
    throw new Error(`${label}.subjectType is invalid.`);
  }
  if ((receipt.subjectType === "verification-gap" && receipt.phase !== "interface-verification")
      || (receipt.subjectType === "knowledge-stale" && receipt.phase !== "technical-design")) {
    throw new Error(`${label}.phase does not match subjectType.`);
  }
  if (!SHA256_PATTERN.test(receipt.subjectSha256)) throw new Error(`${label}.subjectSha256 is invalid.`);
  if (receipt.status !== "approved") throw new Error(`${label}.status is invalid.`);
  if (receipt.actor !== "user") throw new Error(`${label}.actor is invalid.`);
  if (typeof receipt.reason !== "string" || !receipt.reason.trim()) throw new Error(`${label}.reason is required.`);
  if (typeof receipt.evidencePath !== "string" || !receipt.evidencePath.trim()) {
    throw new Error(`${label}.evidencePath is invalid.`);
  }
  if (!SHA256_PATTERN.test(receipt.evidenceSha256)) throw new Error(`${label}.evidenceSha256 is invalid.`);
  assertTimestamp(receipt.createdAt, `${label}.createdAt`);
}

export function validateApprovalReceipt(receipt, context = {}) {
  assertReceiptShape(receipt, "Approval receipt");
  const { task, caseValue, resultValue, knowledgeArea, expectedSubjectSha256 } = context;
  if (task) {
    for (const field of ["storyId", "runId", "phase", "dispatchId", "preparedRevision"]) {
      if (receipt[field] !== task[field]) throw new Error(`Approval receipt.${field} must match task.`);
    }
    if (Date.parse(receipt.createdAt) < Date.parse(task.preparedAt)) {
      throw new Error("Approval receipt.createdAt must not precede task preparation.");
    }
  }
  if (receipt.subjectType === "verification-gap" && caseValue && receipt.subjectId !== caseValue.caseId) {
    throw new Error("Approval receipt.subjectId must match verification case.");
  }
  if (receipt.subjectType === "verification-gap" && resultValue) {
    if (receipt.evidencePath !== resultValue.evidencePath
        || receipt.evidenceSha256 !== resultValue.evidenceSha256) {
      throw new Error("Approval receipt evidence must match verification result.");
    }
    if (Date.parse(receipt.createdAt) < Date.parse(resultValue.executedAt)) {
      throw new Error("Approval receipt.createdAt must not precede verification result.");
    }
  }
  if (receipt.subjectType === "knowledge-stale" && knowledgeArea) {
    if (receipt.subjectId !== knowledgeArea.area) {
      throw new Error("Approval receipt.subjectId must match knowledge area.");
    }
    if (!["stale", "missing"].includes(knowledgeArea.observedStatus)
        || !["stale", "missing", "accepted-stale"].includes(knowledgeArea.status)) {
      throw new Error("Knowledge stale approval requires a stale or missing area.");
    }
    if (receipt.evidencePath !== knowledgeArea.freshnessEvidencePath
        || receipt.evidenceSha256 !== knowledgeArea.freshnessEvidenceSha256) {
      throw new Error("Approval receipt evidence must match knowledge freshness evidence.");
    }
    if (Date.parse(receipt.createdAt) < Date.parse(knowledgeArea.checkedAt)) {
      throw new Error("Approval receipt.createdAt must not precede knowledge freshness check.");
    }
  }
  if (expectedSubjectSha256 && receipt.subjectSha256 !== expectedSubjectSha256) {
    throw new Error("Approval receipt.subjectSha256 must match current approval subject.");
  }
  return receipt;
}

export function validateFormalApproval(value) {
  assertObject(value, [...RECEIPT_FIELDS, "receiptPath", "receiptSha256"], "Formal approval");
  const receipt = Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, value[field]]));
  assertReceiptShape(receipt, "Formal approval");
  if (typeof value.receiptPath !== "string" || !value.receiptPath.trim()) {
    throw new Error("Formal approval.receiptPath is invalid.");
  }
  if (!SHA256_PATTERN.test(value.receiptSha256)) {
    throw new Error("Formal approval.receiptSha256 is invalid.");
  }
  return value;
}
