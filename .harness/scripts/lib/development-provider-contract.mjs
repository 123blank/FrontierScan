import { createHash } from "node:crypto";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const ROLES = new Set(["backend-developer", "frontend-developer"]);
const MODEL_SOURCES = new Set(["runtime-override", "local-config", "project-config", "builtin-default"]);
const SOURCES = new Set(["task", "state", "dag", "knowledge", "policy", "source", "test-evidence", "project-rule"]);
const TEST_STATUSES = new Set(["passed", "failed", "timed-out", "output-limit", "interrupted"]);
const EXECUTION_STATUSES = new Set([
  "completed", "failed", "timed-out", "invalid-response", "output-limit",
  "integrity-violation", "execution-indeterminate",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function shape(value, fields, label) {
  object(value, label);
  const unexpected = Object.keys(value).find((field) => !fields.includes(field));
  if (unexpected) throw new Error(`${label} contains unsupported field '${unexpected}'.`);
  for (const field of fields) if (!Object.hasOwn(value, field)) throw new Error(`${label} requires '${field}'.`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function developmentToolchainSha256(value) {
  return `sha256:${createHash("sha256")
    .update(`${JSON.stringify(canonical(value), null, 2)}\n`)
    .digest("hex")}`;
}

function string(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} is invalid.`);
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID.`);
}

function sha(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(`${label} must be a SHA-256 value.`);
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error(`${label} must be a Git commit.`);
}

function dateTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a date-time.`);
}

function repositoryPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\")
      || path.posix.isAbsolute(value) || path.win32.parse(value).root) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !(path.win32.isAbsolute(value) || path.posix.isAbsolute(value))) {
    throw new Error(`${label} must be an absolute path.`);
  }
}

function uniqueStrings(value, label, nonEmpty = false) {
  if (!Array.isArray(value) || (nonEmpty && !value.length)) throw new Error(`${label} must be an array.`);
  value.forEach((item) => string(item, `${label} item`));
  if (new Set(value.map((item) => item.toLowerCase())).size !== value.length) {
    throw new Error(`${label} must contain unique values.`);
  }
}

function role(value, label) {
  if (!ROLES.has(value)) throw new Error(`${label} must be a backend-developer or frontend-developer.`);
}

function model(value, label) {
  if (value !== null && (typeof value !== "string" || !value || /\s/.test(value))) {
    throw new Error(`${label} must be null or a model identifier.`);
  }
}

function usage(value) {
  shape(value, ["reportedModel", "inputTokens", "outputTokens"], "Development response usage");
  model(value.reportedModel, "Development response reportedModel");
  for (const field of ["inputTokens", "outputTokens"]) {
    if (value[field] !== null && (!Number.isInteger(value[field]) || value[field] < 0)) {
      throw new Error(`Development response ${field} is invalid.`);
    }
  }
}

function policy(value, expectedRole) {
  shape(value, ["name", "category", "readPathPrefixes", "writePathPrefixes", "capabilities"], "Development policy");
  if (value.name !== expectedRole || value.category !== "execution") throw new Error("Development policy identity is invalid.");
  uniqueStrings(value.readPathPrefixes, "Development policy readPathPrefixes");
  uniqueStrings(value.writePathPrefixes, "Development policy writePathPrefixes", true);
  uniqueStrings(value.capabilities, "Development policy capabilities", true);
}

function identity(value, label) {
  id(value.storyId, `${label} storyId`);
  if (value.runId !== value.storyId) throw new Error(`${label} runId must equal storyId.`);
  uuid(value.dispatchId, `${label} dispatchId`);
  id(value.taskId, `${label} taskId`);
}

export function validateDevelopmentRequest(value) {
  const fields = [
    "schemaVersion", "providerRequestId", "dispatchId", "storyId", "runId", "phase",
    "preparedRevision", "taskId", "role", "profile", "adapter", "requestedModel",
    "modelSource", "modelProvider", "configSha256", "taskFile", "taskSha256",
    "taskDagFile", "taskDagSha256", "worktreePlanFile", "worktreePlanSha256",
    "worktreeStatusFile", "worktreeStatusSha256", "worktreePath", "baseCommit",
    "policy", "contextManifestFile", "contextManifestSha256", "outputSchemaFile",
    "outputSchemaSha256", "createdAt",
  ];
  shape(value, fields, "Development request");
  if (value.schemaVersion !== "1.0") throw new Error("Development request schemaVersion is invalid.");
  uuid(value.providerRequestId, "Development request providerRequestId");
  identity(value, "Development request");
  if (value.phase !== "implementation") throw new Error("Development request phase must be implementation.");
  if (!Number.isInteger(value.preparedRevision) || value.preparedRevision < 1) {
    throw new Error("Development request preparedRevision is invalid.");
  }
  role(value.role, "Development request role");
  id(value.profile, "Development request profile");
  if (value.adapter !== "codex-cli") throw new Error("Development request adapter must be codex-cli.");
  model(value.requestedModel, "Development request requestedModel");
  if (!MODEL_SOURCES.has(value.modelSource)) throw new Error("Development request modelSource is invalid.");
  if (value.modelProvider !== null) object(value.modelProvider, "Development request modelProvider");
  sha(value.configSha256, "Development request configSha256");
  for (const field of ["taskFile", "taskDagFile", "worktreePlanFile", "worktreeStatusFile", "contextManifestFile", "outputSchemaFile"]) {
    repositoryPath(value[field], `Development request ${field}`);
  }
  for (const field of ["taskSha256", "taskDagSha256", "worktreePlanSha256", "worktreeStatusSha256", "contextManifestSha256", "outputSchemaSha256"]) {
    sha(value[field], `Development request ${field}`);
  }
  absolutePath(value.worktreePath, "Development request worktreePath");
  commit(value.baseCommit, "Development request baseCommit");
  policy(value.policy, value.role);
  dateTime(value.createdAt, "Development request createdAt");
  return value;
}

export function validateDevelopmentContext(value) {
  const fields = [
    "schemaVersion", "storyId", "runId", "dispatchId", "taskId", "role", "entries",
    "knowledgeAreas", "predictedFiles", "criterionIds", "worktree", "totalBytes", "createdAt",
  ];
  shape(value, fields, "Development context");
  if (value.schemaVersion !== "1.0") throw new Error("Development context schemaVersion is invalid.");
  identity(value, "Development context");
  role(value.role, "Development context role");
  if (!Array.isArray(value.entries) || !value.entries.length) throw new Error("Development context entries must be non-empty.");
  let bytes = 0;
  const paths = new Set();
  value.entries.forEach((entry, index) => {
    shape(entry, ["path", "sha256", "bytes", "purpose", "source"], `Development context entry ${index}`);
    repositoryPath(entry.path, `Development context entry ${index} path`);
    sha(entry.sha256, `Development context entry ${index} sha256`);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 2 * 1024 * 1024) {
      throw new Error(`Development context entry ${index} bytes are invalid.`);
    }
    string(entry.purpose, `Development context entry ${index} purpose`);
    if (!SOURCES.has(entry.source)) throw new Error(`Development context entry ${index} source is invalid.`);
    const key = entry.path.toLowerCase();
    if (paths.has(key)) throw new Error("Development context entry paths must be unique.");
    paths.add(key);
    bytes += entry.bytes;
  });
  if (value.totalBytes !== bytes || bytes > 8 * 1024 * 1024) throw new Error("Development context totalBytes is invalid.");
  uniqueStrings(value.predictedFiles, "Development context predictedFiles", true);
  value.predictedFiles.forEach((file) => repositoryPath(file, "Development context predicted file"));
  uniqueStrings(value.criterionIds, "Development context criterionIds", true);
  if (!Array.isArray(value.knowledgeAreas)) throw new Error("Development context knowledgeAreas must be an array.");
  object(value.worktree, "Development context worktree");
  shape(value.worktree, ["planFile", "planSha256", "statusFile", "statusSha256", "path", "branch", "baseCommit", "headCommit"], "Development context worktree");
  repositoryPath(value.worktree.planFile, "Development context worktree planFile");
  repositoryPath(value.worktree.statusFile, "Development context worktree statusFile");
  sha(value.worktree.planSha256, "Development context worktree planSha256");
  sha(value.worktree.statusSha256, "Development context worktree statusSha256");
  absolutePath(value.worktree.path, "Development context worktree path");
  string(value.worktree.branch, "Development context worktree branch");
  commit(value.worktree.baseCommit, "Development context worktree baseCommit");
  commit(value.worktree.headCommit, "Development context worktree headCommit");
  dateTime(value.createdAt, "Development context createdAt");
  return value;
}

export function validateDevelopmentResponse(value, { request }) {
  validateDevelopmentRequest(request);
  const fields = [
    "schemaVersion", "providerRequestId", "dispatchId", "storyId", "runId", "phase",
    "role", "status", "summary", "developmentMethod", "tddExceptionReason",
    "declaredFiles", "diagnostics", "usage",
  ];
  shape(value, fields, "Development response");
  if (value.schemaVersion !== "1.0") throw new Error("Development response schemaVersion is invalid.");
  for (const field of ["providerRequestId", "dispatchId", "storyId", "runId", "phase", "role"]) {
    if (value[field] !== request[field]) throw new Error(`Development response ${field} must match request.`);
  }
  if (!["completed", "failed"].includes(value.status)) throw new Error("Development response status is invalid.");
  string(value.summary, "Development response summary");
  if (!["tdd", "exception"].includes(value.developmentMethod)) throw new Error("Development response developmentMethod is invalid.");
  if (value.developmentMethod === "tdd" && value.tddExceptionReason !== null) {
    throw new Error("Development response TDD exception reason must be null.");
  }
  if (value.developmentMethod === "exception") string(value.tddExceptionReason, "Development response exception reason");
  if (!Array.isArray(value.declaredFiles)) throw new Error("Development response declaredFiles must be an array.");
  const files = new Set();
  value.declaredFiles.forEach((file, index) => {
    shape(file, ["path", "changeType", "purpose"], `Development response file ${index}`);
    repositoryPath(file.path, `Development response file ${index} path`);
    if (!["create", "update"].includes(file.changeType)) throw new Error(`Development response file ${index} changeType is invalid.`);
    string(file.purpose, `Development response file ${index} purpose`);
    if (files.has(file.path.toLowerCase())) throw new Error("Development response file paths must be unique.");
    files.add(file.path.toLowerCase());
  });
  uniqueStrings(value.diagnostics, "Development response diagnostics");
  usage(value.usage);
  if (value.status === "failed" && (!value.diagnostics.length || value.declaredFiles.length)) {
    throw new Error("Development failed response requires diagnostics and no declared files.");
  }
  return value;
}

export function validateDevelopmentExecutionReceipt(value) {
  const fields = [
    "schemaVersion", "providerExecutionId", "providerRequestId", "dispatchId", "storyId",
    "runId", "phase", "taskId", "role", "profile", "adapter", "requestedModel",
    "reportedModel", "modelSource", "adapterVersion", "sandbox", "workingRoot",
    "writeIsolation", "requestFile", "requestSha256", "responseFile", "responseSha256",
    "stdoutFile", "stdoutSha256", "stderrFile", "stderrSha256",
    "startedAt", "finishedAt", "exitCode", "status", "diagnostics",
  ];
  shape(value, fields, "Development execution receipt");
  if (value.schemaVersion !== "1.0") throw new Error("Development execution receipt schemaVersion is invalid.");
  uuid(value.providerExecutionId, "Development execution receipt providerExecutionId");
  uuid(value.providerRequestId, "Development execution receipt providerRequestId");
  identity(value, "Development execution receipt");
  if (value.phase !== "implementation") throw new Error("Development execution receipt phase must be implementation.");
  role(value.role, "Development execution receipt role");
  id(value.profile, "Development execution receipt profile");
  if (value.adapter !== "codex-cli" || value.sandbox !== "workspace-write"
      || value.writeIsolation !== "task-worktree-workspace-write") {
    throw new Error("Development execution receipt adapter, sandbox, or writeIsolation is invalid.");
  }
  model(value.requestedModel, "Development execution receipt requestedModel");
  model(value.reportedModel, "Development execution receipt reportedModel");
  if (!MODEL_SOURCES.has(value.modelSource)) throw new Error("Development execution receipt modelSource is invalid.");
  string(value.adapterVersion, "Development execution receipt adapterVersion");
  absolutePath(value.workingRoot, "Development execution receipt workingRoot");
  for (const field of ["requestFile", "responseFile", "stdoutFile", "stderrFile"]) {
    repositoryPath(value[field], `Development execution receipt ${field}`);
  }
  for (const field of ["requestSha256", "responseSha256", "stdoutSha256", "stderrSha256"]) {
    sha(value[field], `Development execution receipt ${field}`);
  }
  dateTime(value.startedAt, "Development execution receipt startedAt");
  dateTime(value.finishedAt, "Development execution receipt finishedAt");
  if (value.exitCode !== null && !Number.isInteger(value.exitCode)) throw new Error("Development execution receipt exitCode is invalid.");
  if (!EXECUTION_STATUSES.has(value.status)) throw new Error("Development execution receipt status is invalid.");
  uniqueStrings(value.diagnostics, "Development execution receipt diagnostics");
  return value;
}

function candidateFile(file, index, withChangeType = true) {
  const fields = withChangeType ? ["path", "changeType", "sha256", "bytes", "kind"] : ["path", "sha256", "bytes", "kind"];
  shape(file, fields, `Development candidate file ${index}`);
  repositoryPath(file.path, `Development candidate file ${index} path`);
  if (withChangeType && !["create", "update"].includes(file.changeType)) {
    throw new Error(`Development candidate file ${index} changeType is invalid.`);
  }
  sha(file.sha256, `Development candidate file ${index} sha256`);
  if (!Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > 2 * 1024 * 1024) {
    throw new Error(`Development candidate file ${index} bytes are invalid.`);
  }
  if (!["backend", "frontend", "phase-output"].includes(file.kind)) throw new Error(`Development candidate file ${index} kind is invalid.`);
}

export function validateDevelopmentCandidateManifest(value) {
  const fields = [
    "schemaVersion", "storyId", "runId", "dispatchId", "taskId", "role", "baseCommit",
    "headCommit", "worktreePath", "baselineSha256", "afterSha256", "gitStatusSha256",
    "files", "totalBytes", "createdAt",
  ];
  shape(value, fields, "Development candidate manifest");
  if (value.schemaVersion !== "1.0") throw new Error("Development candidate manifest schemaVersion is invalid.");
  identity(value, "Development candidate manifest");
  role(value.role, "Development candidate manifest role");
  commit(value.baseCommit, "Development candidate manifest baseCommit");
  commit(value.headCommit, "Development candidate manifest headCommit");
  absolutePath(value.worktreePath, "Development candidate manifest worktreePath");
  for (const field of ["baselineSha256", "afterSha256", "gitStatusSha256"]) sha(value[field], `Development candidate manifest ${field}`);
  if (!Array.isArray(value.files) || !value.files.length) throw new Error("Development candidate manifest files must be non-empty.");
  value.files.forEach((file, index) => candidateFile(file, index));
  const total = value.files.reduce((sum, file) => sum + file.bytes, 0);
  if (value.totalBytes !== total || total > 8 * 1024 * 1024) throw new Error("Development candidate manifest totalBytes is invalid.");
  dateTime(value.createdAt, "Development candidate manifest createdAt");
  return value;
}

export function validateDevelopmentTestReceipt(value) {
  const fields = [
    "schemaVersion", "storyId", "runId", "dispatchId", "taskId",
    "candidateManifestFile", "candidateManifestSha256", "adapterId", "commandId",
    "workingDirectory", "toolchain", "toolchainSha256", "status", "exitCode", "stdoutFile",
    "stdoutSha256", "stderrFile", "stderrSha256", "candidateBeforeSha256",
    "candidateAfterSha256", "executedAt",
  ];
  shape(value, fields, "Development test receipt");
  if (value.schemaVersion !== "1.0") throw new Error("Development test receipt schemaVersion is invalid.");
  identity(value, "Development test receipt");
  for (const field of ["candidateManifestFile", "workingDirectory", "stdoutFile"]) repositoryPath(value[field], `Development test receipt ${field}`);
  if (value.stderrFile !== null) repositoryPath(value.stderrFile, "Development test receipt stderrFile");
  for (const field of ["candidateManifestSha256", "toolchainSha256", "stdoutSha256", "candidateBeforeSha256", "candidateAfterSha256"]) {
    sha(value[field], `Development test receipt ${field}`);
  }
  sha(value.stderrSha256, "Development test receipt stderrSha256", true);
  if ((value.stderrFile === null) !== (value.stderrSha256 === null)) throw new Error("Development test receipt stderr evidence is inconsistent.");
  id(value.adapterId, "Development test receipt adapterId");
  id(value.commandId, "Development test receipt commandId");
  object(value.toolchain, "Development test receipt toolchain");
  if (value.toolchain.adapterId === "backend-maven") {
    shape(value.toolchain, [
      "adapterId", "mavenPath", "mavenVersion", "mavenSha256", "javaPath",
      "javaVersion", "javaSha256", "repositoryPath", "repositoryIdentity",
    ], "Development backend test toolchain");
    for (const field of ["mavenPath", "javaPath", "repositoryPath"]) {
      absolutePath(value.toolchain[field], `Development backend test toolchain ${field}`);
    }
    for (const field of ["mavenVersion", "javaVersion"]) {
      string(value.toolchain[field], `Development backend test toolchain ${field}`);
    }
    for (const field of ["mavenSha256", "javaSha256", "repositoryIdentity"]) {
      sha(value.toolchain[field], `Development backend test toolchain ${field}`);
    }
  } else if (value.toolchain.adapterId === "frontend-npm") {
    shape(value.toolchain, [
      "adapterId", "npmPath", "npmVersion", "npmSha256", "nodePath",
      "nodeVersion", "nodeSha256", "dependencySha256",
    ], "Development frontend test toolchain");
    for (const field of ["npmPath", "nodePath"]) {
      absolutePath(value.toolchain[field], `Development frontend test toolchain ${field}`);
    }
    for (const field of ["npmVersion", "nodeVersion"]) {
      string(value.toolchain[field], `Development frontend test toolchain ${field}`);
    }
    for (const field of ["npmSha256", "nodeSha256", "dependencySha256"]) {
      sha(value.toolchain[field], `Development frontend test toolchain ${field}`);
    }
  } else {
    throw new Error("Development test receipt toolchain adapterId is invalid.");
  }
  if (!TEST_STATUSES.has(value.status)) throw new Error("Development test receipt status is invalid.");
  if (value.exitCode !== null && !Number.isInteger(value.exitCode)) throw new Error("Development test receipt exitCode is invalid.");
  dateTime(value.executedAt, "Development test receipt executedAt");
  return value;
}

export function validateDevelopmentTestReceiptBinding(value, {
  role: expectedRole,
  worktreePath,
}) {
  validateDevelopmentTestReceipt(value);
  role(expectedRole, "Development test receipt expected role");
  absolutePath(worktreePath, "Development test receipt Worktree");
  const frontend = expectedRole === "frontend-developer";
  const expectedAdapterId = frontend ? "frontend-npm" : "backend-maven";
  const expectedCommandId = frontend ? "npm-build" : "maven-test";
  const expectedWorkingDirectory = frontend ? "frontend" : "backend";
  const executablePath = frontend ? value.toolchain.npmPath : value.toolchain.mavenPath;
  const relativeExecutable = path.relative(worktreePath, executablePath);
  if (value.adapterId !== expectedAdapterId
      || value.commandId !== expectedCommandId
      || value.workingDirectory !== expectedWorkingDirectory
      || value.toolchain.adapterId !== expectedAdapterId
      || value.toolchainSha256 !== developmentToolchainSha256(value.toolchain)) {
    throw new Error("Development test receipt adapter, command, directory, or toolchain identity drifted.");
  }
  if (!relativeExecutable || relativeExecutable === "."
      || (!path.isAbsolute(relativeExecutable)
        && relativeExecutable !== ".."
        && !relativeExecutable.startsWith(`..${path.sep}`))) {
    throw new Error("Development test receipt executable must stay outside the task Worktree.");
  }
  return value;
}

export function validateDevelopmentReceipt(value) {
  const fields = [
    "schemaVersion", "executorKind", "storyId", "runId", "dispatchId", "taskId",
    "phase", "ownerAgent", "providerRequestId", "providerExecutionId", "baseCommit",
    "headCommit", "outcome", "requestFile", "requestSha256", "executionReceiptFile",
    "executionReceiptSha256", "candidateManifestFile", "candidateManifestSha256",
    "testReceiptFile", "testReceiptSha256", "resultEvidenceFile", "resultSha256",
    "contextEvidenceFile", "contextEvidenceSha256", "files", "completedAt",
  ];
  shape(value, fields, "Development receipt");
  if (value.schemaVersion !== "1.0" || value.executorKind !== "development-provider"
      || value.phase !== "implementation" || value.outcome !== "ready-for-integration") {
    throw new Error("Development receipt identity or outcome is invalid.");
  }
  identity(value, "Development receipt");
  role(value.ownerAgent, "Development receipt ownerAgent");
  uuid(value.providerRequestId, "Development receipt providerRequestId");
  uuid(value.providerExecutionId, "Development receipt providerExecutionId");
  commit(value.baseCommit, "Development receipt baseCommit");
  commit(value.headCommit, "Development receipt headCommit");
  for (const field of ["requestFile", "executionReceiptFile", "candidateManifestFile", "testReceiptFile", "resultEvidenceFile", "contextEvidenceFile"]) {
    repositoryPath(value[field], `Development receipt ${field}`);
  }
  for (const field of ["requestSha256", "executionReceiptSha256", "candidateManifestSha256", "testReceiptSha256", "resultSha256", "contextEvidenceSha256"]) {
    sha(value[field], `Development receipt ${field}`);
  }
  if (!Array.isArray(value.files) || !value.files.length) throw new Error("Development receipt files must be non-empty.");
  value.files.forEach((file, index) => candidateFile(file, index, false));
  dateTime(value.completedAt, "Development receipt completedAt");
  return value;
}
