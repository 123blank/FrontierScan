import { createHash } from "node:crypto";
import path from "node:path";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OID_PATTERN = /^[a-f0-9]{40}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHANGE_KINDS = new Set(["added", "modified", "deleted", "renamed", "copied"]);

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function exactKeys(value, fields, label) {
  object(value, label);
  const expected = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label} is missing required field '${field}'.`);
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label} has unsupported field '${field}'.`);
  }
}

function string(value, label, pattern = null) {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid.`);
  }
}

export function validateRepositoryPath(value, label = "Path") {
  string(value, label);
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized !== value
    || path.posix.isAbsolute(value)
    || path.win32.parse(value).root
    || value.includes("\0")
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized repository-relative path.`);
  }
  return value;
}

function sortedUniquePaths(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((item, index) => validateRepositoryPath(item, `${label}[${index}]`));
  const sorted = [...value].sort((left, right) => left.localeCompare(right, "en"));
  if (new Set(value).size !== value.length || sorted.some((item, index) => item !== value[index])) {
    throw new Error(`${label} must contain sorted unique paths.`);
  }
}

function relation(value, label) {
  exactKeys(value, ["path", "changeKind", "sourcePath"], label);
  validateRepositoryPath(value.path, `${label}.path`);
  if (!CHANGE_KINDS.has(value.changeKind)) throw new Error(`${label}.changeKind is invalid.`);
  if (["renamed", "copied"].includes(value.changeKind)) {
    validateRepositoryPath(value.sourcePath, `${label}.sourcePath`);
    if (value.sourcePath === value.path) throw new Error(`${label}.sourcePath must differ from path.`);
  } else if (value.sourcePath !== null) {
    throw new Error(`${label}.sourcePath must be null.`);
  }
}

export function validateDeliveryFacts(value) {
  exactKeys(value, [
    "schemaVersion", "storyId", "runId", "baselineHead", "head", "branch",
    "relations", "ownedFiles", "outOfPredictionFiles", "unrelatedDirtyFiles",
  ], "Delivery facts");
  if (value.schemaVersion !== "1.0") throw new Error("Delivery facts schemaVersion must be '1.0'.");
  string(value.storyId, "Delivery facts storyId", ID_PATTERN);
  string(value.runId, "Delivery facts runId", ID_PATTERN);
  string(value.baselineHead, "Delivery facts baselineHead", COMMIT_PATTERN);
  string(value.head, "Delivery facts head", COMMIT_PATTERN);
  string(value.branch, "Delivery facts branch");
  if (!Array.isArray(value.relations)) throw new Error("Delivery facts relations must be an array.");
  value.relations.forEach((item, index) => relation(item, `Delivery facts relations[${index}]`));
  for (const field of ["ownedFiles", "outOfPredictionFiles", "unrelatedDirtyFiles"]) {
    sortedUniquePaths(value[field], `Delivery facts ${field}`);
  }
  return value;
}

function manifestEntry(value, label) {
  exactKeys(value, [
    "path", "changeKind", "sourcePath", "contentSha256", "blobOid", "mode",
  ], label);
  relation({
    path: value.path,
    changeKind: value.changeKind,
    sourcePath: value.sourcePath,
  }, label);
  if (value.changeKind === "deleted") {
    for (const field of ["contentSha256", "blobOid", "mode"]) {
      if (value[field] !== null) throw new Error(`${label}.${field} must be null for deleted entries.`);
    }
    return;
  }
  string(value.contentSha256, `${label}.contentSha256`, SHA256_PATTERN);
  string(value.blobOid, `${label}.blobOid`, OID_PATTERN);
  if (!["100644", "100755"].includes(value.mode)) throw new Error(`${label}.mode is unsupported.`);
}

export function validateOwnedManifest(value) {
  exactKeys(value, [
    "schemaVersion", "storyId", "runId", "baselineHead", "entries", "generatedAt",
  ], "Owned manifest");
  if (value.schemaVersion !== "1.0") throw new Error("Owned manifest schemaVersion must be '1.0'.");
  string(value.storyId, "Owned manifest storyId", ID_PATTERN);
  string(value.runId, "Owned manifest runId", ID_PATTERN);
  string(value.baselineHead, "Owned manifest baselineHead", COMMIT_PATTERN);
  if (!Array.isArray(value.entries)) throw new Error("Owned manifest entries must be an array.");
  value.entries.forEach((item, index) => manifestEntry(item, `Owned manifest entries[${index}]`));
  const paths = value.entries.map((item) => item.path);
  sortedUniquePaths(paths, "Owned manifest entry paths");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error("Owned manifest generatedAt must be a date-time.");
  }
  return value;
}

function commitReceipt(value, label) {
  exactKeys(value, ["status", "sha", "parents", "filesSinceBaseline", "extraFiles"], label);
  if (!["not-requested", "recorded"].includes(value.status)) throw new Error(`${label}.status is invalid.`);
  if (!Array.isArray(value.parents)) throw new Error(`${label}.parents must be an array.`);
  value.parents.forEach((item, index) => string(item, `${label}.parents[${index}]`, COMMIT_PATTERN));
  if (new Set(value.parents).size !== value.parents.length) throw new Error(`${label}.parents must be unique.`);
  sortedUniquePaths(value.filesSinceBaseline, `${label}.filesSinceBaseline`);
  sortedUniquePaths(value.extraFiles, `${label}.extraFiles`);
  if (value.status === "not-requested") {
    if (value.sha !== null || value.parents.length || value.filesSinceBaseline.length || value.extraFiles.length) {
      throw new Error(`${label} not-requested facts must be empty.`);
    }
  } else {
    string(value.sha, `${label}.sha`, COMMIT_PATTERN);
  }
}

function pushReceipt(value, label) {
  exactKeys(value, ["status", "remote", "ref", "commit"], label);
  if (!["not-requested", "recorded"].includes(value.status)) throw new Error(`${label}.status is invalid.`);
  if (value.status === "not-requested") {
    if (value.remote !== null || value.ref !== null || value.commit !== null) {
      throw new Error(`${label} not-requested facts must be null.`);
    }
    return;
  }
  string(value.remote, `${label}.remote`);
  string(value.ref, `${label}.ref`);
  if (!value.ref.startsWith("refs/")) throw new Error(`${label}.ref must be a full ref.`);
  string(value.commit, `${label}.commit`, COMMIT_PATTERN);
}

export function validateDeliveryReceipt(value) {
  exactKeys(value, [
    "schemaVersion", "receiptId", "storyId", "runId", "stateFile", "stateSha256",
    "eventsFile", "eventsSha256", "baselineHead", "deliverySummaryFile",
    "deliverySummarySha256", "ownedManifestFile", "ownedManifestSha256",
    "commit", "push", "recordedAt",
  ], "Delivery receipt");
  if (value.schemaVersion !== "1.0") throw new Error("Delivery receipt schemaVersion must be '1.0'.");
  if (!/^DR-[a-f0-9]{32}$/.test(value.receiptId ?? "")) throw new Error("Delivery receipt receiptId is invalid.");
  string(value.storyId, "Delivery receipt storyId", ID_PATTERN);
  string(value.runId, "Delivery receipt runId", ID_PATTERN);
  for (const field of ["stateFile", "eventsFile", "deliverySummaryFile", "ownedManifestFile"]) {
    validateRepositoryPath(value[field], `Delivery receipt ${field}`);
  }
  for (const field of ["stateSha256", "eventsSha256", "deliverySummarySha256", "ownedManifestSha256"]) {
    string(value[field], `Delivery receipt ${field}`, SHA256_PATTERN);
  }
  string(value.baselineHead, "Delivery receipt baselineHead", COMMIT_PATTERN);
  commitReceipt(value.commit, "Delivery receipt commit");
  pushReceipt(value.push, "Delivery receipt push");
  if (typeof value.recordedAt !== "string" || Number.isNaN(Date.parse(value.recordedAt))) {
    throw new Error("Delivery receipt recordedAt must be a date-time.");
  }
  return value;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
