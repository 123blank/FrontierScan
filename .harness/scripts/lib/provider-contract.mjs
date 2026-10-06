import { createHash } from "node:crypto";
import path from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MODEL_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/;
const SOURCES = new Set([
  "task",
  "state",
  "dag",
  "knowledge",
  "policy",
  "diff",
  "test-evidence",
  "project-rule",
]);
const CHANGE_KINDS = new Set(["added", "modified", "deleted", "renamed"]);
const SEVERITIES = new Set(["BLOCKER", "WARNING", "INFO"]);
const RECEIPT_STATUSES = new Set([
  "completed",
  "failed",
  "timed-out",
  "invalid-response",
  "integrity-violation",
]);
const MODEL_SOURCES = new Set([
  "runtime-override",
  "local-config",
  "project-config",
  "builtin-default",
]);
const MODEL_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactFields(value, fields, label) {
  const unexpected = Object.keys(value).find((field) => !fields.includes(field));
  if (unexpected) throw new Error(`${label} contains unsupported field '${unexpected}'.`);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label} requires '${field}'.`);
  }
}

function assertNonEmptyString(value, label, maxLength = Number.POSITIVE_INFINITY) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertSha256(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be a SHA-256 value.`);
}

function assertDateTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a date-time string.`);
}

function assertModel(value, label) {
  if (value !== null && (typeof value !== "string" || !MODEL_PATTERN.test(value))) {
    throw new Error(`${label} must be null or a non-empty model string.`);
  }
}

function normalizeRepositoryPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\")
      || path.posix.isAbsolute(value) || path.win32.parse(value).root) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")
      || value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  return normalized;
}

function assertUniqueStrings(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) throw new Error(`${label} must be an array.`);
  for (const item of value) assertNonEmptyString(item, `${label} item`);
  if (new Set(value).size !== value.length) throw new Error(`${label} must contain unique values.`);
}

function validatePolicy(policy) {
  assertObject(policy, "Provider request policy");
  assertExactFields(
    policy,
    ["name", "category", "readPathPrefixes", "writePathPrefixes", "capabilities"],
    "Provider request policy",
  );
  if (policy.name !== "code-reviewer") throw new Error("Provider request policy name must be code-reviewer.");
  if (policy.category !== "review") throw new Error("Provider request policy category must be review.");
  assertUniqueStrings(policy.readPathPrefixes, "Provider request policy readPathPrefixes");
  assertUniqueStrings(policy.writePathPrefixes, "Provider request policy writePathPrefixes");
  if (policy.writePathPrefixes.length) throw new Error("Provider request policy writePathPrefixes must be empty.");
  assertUniqueStrings(policy.capabilities, "Provider request policy capabilities");
  return policy;
}

function validateModelProvider(modelProvider, label) {
  if (modelProvider === null) return null;
  assertObject(modelProvider, label);
  assertExactFields(
    modelProvider,
    ["id", "baseUrl", "wireApi", "requiresOpenAiAuth"],
    label,
  );
  if (typeof modelProvider.id !== "string" || !MODEL_PROVIDER_ID_PATTERN.test(modelProvider.id)) {
    throw new Error(`${label} id must use a safe provider identifier without dots.`);
  }
  assertNonEmptyString(modelProvider.baseUrl, `${label} baseUrl`, 2048);
  let parsed;
  try {
    parsed = new URL(modelProvider.baseUrl);
  } catch {
    throw new Error(`${label} baseUrl must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} baseUrl must use HTTPS.`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} baseUrl must not contain credentials, a query, or a fragment.`);
  }
  if (modelProvider.wireApi !== "responses") throw new Error(`${label} wireApi must be responses.`);
  if (typeof modelProvider.requiresOpenAiAuth !== "boolean") {
    throw new Error(`${label} requiresOpenAiAuth must be a boolean.`);
  }
  return modelProvider;
}

export function validateProviderRequest(request) {
  assertObject(request, "Provider request");
  const fields = [
    "schemaVersion",
    "providerRequestId",
    "dispatchId",
    "storyId",
    "runId",
    "phase",
    "preparedRevision",
    "role",
    "profile",
    "adapter",
    "requestedModel",
    "modelSource",
    "modelProvider",
    "configSha256",
    "taskFile",
    "taskSha256",
    "policy",
    "contextManifestFile",
    "contextManifestSha256",
    "outputSchemaFile",
    "outputSchemaSha256",
    "promptTemplateVersion",
    "promptTemplateSha256",
    "createdAt",
  ];
  assertExactFields(request, fields, "Provider request");
  if (request.schemaVersion !== "1.0") throw new Error("Provider request schemaVersion must be '1.0'.");
  assertUuid(request.providerRequestId, "Provider request providerRequestId");
  assertUuid(request.dispatchId, "Provider request dispatchId");
  assertId(request.storyId, "Provider request storyId");
  if (request.runId !== request.storyId) throw new Error("Provider request runId must equal storyId.");
  if (request.phase !== "code-review") throw new Error("Provider request phase must be code-review.");
  if (!Number.isInteger(request.preparedRevision) || request.preparedRevision < 1) {
    throw new Error("Provider request preparedRevision must be a positive integer.");
  }
  if (request.role !== "code-reviewer") throw new Error("Provider request role must be code-reviewer.");
  assertId(request.profile, "Provider request profile");
  if (request.adapter !== "codex-cli") throw new Error("Provider request adapter must be codex-cli.");
  assertModel(request.requestedModel, "Provider request requestedModel");
  if (!MODEL_SOURCES.has(request.modelSource)) throw new Error("Provider request modelSource is invalid.");
  validateModelProvider(request.modelProvider, "Provider request modelProvider");
  assertSha256(request.configSha256, "Provider request configSha256");
  normalizeRepositoryPath(request.taskFile, "Provider request taskFile");
  assertSha256(request.taskSha256, "Provider request taskSha256");
  validatePolicy(request.policy);
  normalizeRepositoryPath(request.contextManifestFile, "Provider request contextManifestFile");
  assertSha256(request.contextManifestSha256, "Provider request contextManifestSha256");
  normalizeRepositoryPath(request.outputSchemaFile, "Provider request outputSchemaFile");
  assertSha256(request.outputSchemaSha256, "Provider request outputSchemaSha256");
  assertId(request.promptTemplateVersion, "Provider request promptTemplateVersion");
  assertSha256(request.promptTemplateSha256, "Provider request promptTemplateSha256");
  assertDateTime(request.createdAt, "Provider request createdAt");
  return request;
}

function validateContextEntry(entry, index) {
  assertObject(entry, `Provider context entry ${index}`);
  assertExactFields(entry, ["path", "sha256", "bytes", "purpose", "source"], `Provider context entry ${index}`);
  normalizeRepositoryPath(entry.path, `Provider context entry ${index} path`);
  assertSha256(entry.sha256, `Provider context entry ${index} sha256`);
  if (!Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 2 * 1024 * 1024) {
    throw new Error(`Provider context entry ${index} bytes are invalid.`);
  }
  assertNonEmptyString(entry.purpose, `Provider context entry ${index} purpose`);
  if (!SOURCES.has(entry.source)) throw new Error(`Provider context entry ${index} source is invalid.`);
}

function validateReviewTarget(target, index) {
  assertObject(target, `Provider review target ${index}`);
  assertExactFields(target, ["path", "sha256", "changeKind"], `Provider review target ${index}`);
  normalizeRepositoryPath(target.path, `Provider review target ${index} path`);
  assertSha256(target.sha256, `Provider review target ${index} sha256`);
  if (!CHANGE_KINDS.has(target.changeKind)) throw new Error(`Provider review target ${index} changeKind is invalid.`);
}

function validateKnowledgeArea(area, index) {
  assertObject(area, `Provider knowledge area ${index}`);
  assertExactFields(area, ["area", "status", "loadedFiles"], `Provider knowledge area ${index}`);
  if (!["backend", "frontend", "common"].includes(area.area)) {
    throw new Error(`Provider knowledge area ${index} area is invalid.`);
  }
  if (!["fresh", "accepted-stale"].includes(area.status)) {
    throw new Error(`Provider knowledge area ${index} status is invalid.`);
  }
  assertUniqueStrings(area.loadedFiles, `Provider knowledge area ${index} loadedFiles`);
  for (const file of area.loadedFiles) normalizeRepositoryPath(file, `Provider knowledge area ${index} loaded file`);
}

export function validateProviderContext(context) {
  assertObject(context, "Provider context");
  const fields = [
    "schemaVersion",
    "storyId",
    "runId",
    "dispatchId",
    "role",
    "entries",
    "reviewTargets",
    "knowledgeAreas",
    "totalBytes",
    "createdAt",
  ];
  assertExactFields(context, fields, "Provider context");
  if (context.schemaVersion !== "1.0") throw new Error("Provider context schemaVersion must be '1.0'.");
  assertId(context.storyId, "Provider context storyId");
  if (context.runId !== context.storyId) throw new Error("Provider context runId must equal storyId.");
  assertUuid(context.dispatchId, "Provider context dispatchId");
  if (context.role !== "code-reviewer") throw new Error("Provider context role must be code-reviewer.");
  if (!Array.isArray(context.entries) || !context.entries.length) {
    throw new Error("Provider context entries must be a non-empty array.");
  }
  if (!Array.isArray(context.reviewTargets)) throw new Error("Provider context reviewTargets must be an array.");
  if (!Array.isArray(context.knowledgeAreas)) throw new Error("Provider context knowledgeAreas must be an array.");

  const entryPaths = new Set();
  let totalBytes = 0;
  context.entries.forEach((entry, index) => {
    validateContextEntry(entry, index);
    const key = entry.path.toLowerCase();
    if (entryPaths.has(key)) throw new Error(`Provider context contains duplicate entry path '${entry.path}'.`);
    entryPaths.add(key);
    totalBytes += entry.bytes;
  });
  if (!Number.isInteger(context.totalBytes) || context.totalBytes !== totalBytes) {
    throw new Error("Provider context totalBytes must equal the sum of entry bytes.");
  }
  if (context.totalBytes > 8 * 1024 * 1024) throw new Error("Provider context exceeds the 8 MiB total limit.");

  const targetPaths = new Set();
  context.reviewTargets.forEach((target, index) => {
    validateReviewTarget(target, index);
    const key = target.path.toLowerCase();
    if (targetPaths.has(key)) throw new Error(`Provider context contains duplicate review target '${target.path}'.`);
    targetPaths.add(key);
  });
  const knowledgeAreas = new Set();
  context.knowledgeAreas.forEach((area, index) => {
    validateKnowledgeArea(area, index);
    if (knowledgeAreas.has(area.area)) throw new Error(`Provider context contains duplicate knowledge area '${area.area}'.`);
    knowledgeAreas.add(area.area);
  });
  assertDateTime(context.createdAt, "Provider context createdAt");
  return context;
}

function validateUsage(usage) {
  assertObject(usage, "Provider response usage");
  assertExactFields(usage, ["reportedModel", "inputTokens", "outputTokens"], "Provider response usage");
  assertModel(usage.reportedModel, "Provider response usage reportedModel");
  for (const field of ["inputTokens", "outputTokens"]) {
    if (usage[field] !== null && (!Number.isInteger(usage[field]) || usage[field] < 0)) {
      throw new Error(`Provider response usage ${field} must be null or a non-negative integer.`);
    }
  }
}

function validateFinding(finding, index, reviewTargets) {
  assertObject(finding, `Provider finding ${index}`);
  const fields = [
    "findingId",
    "severity",
    "status",
    "summary",
    "file",
    "line",
    "evidenceText",
    "rationale",
  ];
  assertExactFields(finding, fields, `Provider finding ${index}`);
  if (typeof finding.findingId !== "string" || !/^F-[0-9]{3}$/.test(finding.findingId)) {
    throw new Error(`Provider finding ${index} findingId is invalid.`);
  }
  if (!SEVERITIES.has(finding.severity)) throw new Error(`Provider finding ${index} severity is invalid.`);
  if (finding.status !== "open") throw new Error(`Provider finding ${index} status must be open.`);
  assertNonEmptyString(finding.summary, `Provider finding ${index} summary`);
  if (finding.file !== null) {
    normalizeRepositoryPath(finding.file, `Provider finding ${index} file`);
    if (!reviewTargets.has(finding.file.toLowerCase())) {
      throw new Error(`Provider finding ${index} file must be listed in context reviewTargets.`);
    }
  }
  if (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1)) {
    throw new Error(`Provider finding ${index} line must be null or a positive integer.`);
  }
  assertNonEmptyString(finding.evidenceText, `Provider finding ${index} evidenceText`);
  assertNonEmptyString(finding.rationale, `Provider finding ${index} rationale`);
}

export function validateProviderResponse(response, { context }) {
  validateProviderContext(context);
  assertObject(response, "Provider response");
  const fields = [
    "schemaVersion",
    "providerRequestId",
    "dispatchId",
    "storyId",
    "runId",
    "phase",
    "role",
    "status",
    "summary",
    "findings",
    "diagnostics",
    "usage",
  ];
  assertExactFields(response, fields, "Provider response");
  if (response.schemaVersion !== "1.0") throw new Error("Provider response schemaVersion must be '1.0'.");
  assertUuid(response.providerRequestId, "Provider response providerRequestId");
  assertUuid(response.dispatchId, "Provider response dispatchId");
  assertId(response.storyId, "Provider response storyId");
  if (response.runId !== response.storyId) throw new Error("Provider response runId must equal storyId.");
  if (response.phase !== "code-review") throw new Error("Provider response phase must be code-review.");
  if (response.role !== "code-reviewer") throw new Error("Provider response role must be code-reviewer.");
  if (!["completed", "failed"].includes(response.status)) throw new Error("Provider response status is invalid.");
  assertNonEmptyString(response.summary, "Provider response summary");
  if (!Array.isArray(response.findings)) throw new Error("Provider response findings must be an array.");
  assertUniqueStrings(response.diagnostics, "Provider response diagnostics");
  if (response.diagnostics.length > 32 || response.diagnostics.some((item) => item.length > 2048)) {
    throw new Error("Provider response diagnostics exceed the bounded limit.");
  }
  validateUsage(response.usage);
  const reviewTargets = new Set(context.reviewTargets.map((target) => target.path.toLowerCase()));
  response.findings.forEach((finding, index) => validateFinding(finding, index, reviewTargets));
  if (response.status === "failed") {
    if (response.findings.length) throw new Error("Provider failed response findings must be empty.");
    if (!response.diagnostics.length) throw new Error("Provider failed response requires diagnostics.");
  }
  return response;
}

function validateIntegrityCheck(check, index) {
  assertObject(check, `Provider integrity check ${index}`);
  assertExactFields(
    check,
    ["checkId", "status", "beforeSha256", "afterSha256", "details"],
    `Provider integrity check ${index}`,
  );
  assertId(check.checkId, `Provider integrity check ${index} checkId`);
  if (!["passed", "failed", "not-applicable"].includes(check.status)) {
    throw new Error(`Provider integrity check ${index} status is invalid.`);
  }
  assertSha256(check.beforeSha256, `Provider integrity check ${index} beforeSha256`, true);
  assertSha256(check.afterSha256, `Provider integrity check ${index} afterSha256`, true);
  assertNonEmptyString(check.details, `Provider integrity check ${index} details`, 2048);
}

export function validateProviderExecutionReceipt(receipt) {
  assertObject(receipt, "Provider execution receipt");
  const fields = [
    "schemaVersion",
    "providerExecutionId",
    "providerRequestId",
    "dispatchId",
    "storyId",
    "runId",
    "phase",
    "role",
    "profile",
    "adapter",
    "modelProvider",
    "configSha256",
    "requestFile",
    "requestSha256",
    "contextManifestFile",
    "contextManifestSha256",
    "promptTemplateVersion",
    "promptTemplateSha256",
    "requestedModel",
    "resolvedModel",
    "reportedModel",
    "modelSource",
    "adapterVersion",
    "readIsolation",
    "startedAt",
    "finishedAt",
    "exitCode",
    "status",
    "responseFile",
    "responseSha256",
    "integrityChecks",
    "diagnostics",
  ];
  assertExactFields(receipt, fields, "Provider execution receipt");
  if (receipt.schemaVersion !== "1.0") throw new Error("Provider execution receipt schemaVersion must be '1.0'.");
  assertUuid(receipt.providerExecutionId, "Provider execution receipt providerExecutionId");
  assertUuid(receipt.providerRequestId, "Provider execution receipt providerRequestId");
  assertUuid(receipt.dispatchId, "Provider execution receipt dispatchId");
  assertId(receipt.storyId, "Provider execution receipt storyId");
  if (receipt.runId !== receipt.storyId) throw new Error("Provider execution receipt runId must equal storyId.");
  if (receipt.phase !== "code-review") throw new Error("Provider execution receipt phase must be code-review.");
  if (receipt.role !== "code-reviewer") throw new Error("Provider execution receipt role must be code-reviewer.");
  assertId(receipt.profile, "Provider execution receipt profile");
  if (receipt.adapter !== "codex-cli") throw new Error("Provider execution receipt adapter must be codex-cli.");
  validateModelProvider(receipt.modelProvider, "Provider execution receipt modelProvider");
  assertSha256(receipt.configSha256, "Provider execution receipt configSha256");
  normalizeRepositoryPath(receipt.requestFile, "Provider execution receipt requestFile");
  assertSha256(receipt.requestSha256, "Provider execution receipt requestSha256");
  normalizeRepositoryPath(receipt.contextManifestFile, "Provider execution receipt contextManifestFile");
  assertSha256(receipt.contextManifestSha256, "Provider execution receipt contextManifestSha256");
  assertId(receipt.promptTemplateVersion, "Provider execution receipt promptTemplateVersion");
  assertSha256(receipt.promptTemplateSha256, "Provider execution receipt promptTemplateSha256");
  assertModel(receipt.requestedModel, "Provider execution receipt requestedModel");
  assertModel(receipt.resolvedModel, "Provider execution receipt resolvedModel");
  assertModel(receipt.reportedModel, "Provider execution receipt reportedModel");
  if (!MODEL_SOURCES.has(receipt.modelSource)) throw new Error("Provider execution receipt modelSource is invalid.");
  assertNonEmptyString(receipt.adapterVersion, "Provider execution receipt adapterVersion");
  if (receipt.readIsolation !== "same-os-user-readonly-sandbox") {
    throw new Error("Provider execution receipt readIsolation must be same-os-user-readonly-sandbox.");
  }
  assertDateTime(receipt.startedAt, "Provider execution receipt startedAt");
  assertDateTime(receipt.finishedAt, "Provider execution receipt finishedAt");
  if (receipt.exitCode !== null && !Number.isInteger(receipt.exitCode)) {
    throw new Error("Provider execution receipt exitCode must be null or an integer.");
  }
  if (!RECEIPT_STATUSES.has(receipt.status)) throw new Error("Provider execution receipt status is invalid.");
  if (receipt.responseFile !== null) normalizeRepositoryPath(receipt.responseFile, "Provider execution receipt responseFile");
  assertSha256(receipt.responseSha256, "Provider execution receipt responseSha256", true);
  if ((receipt.responseFile === null) !== (receipt.responseSha256 === null)) {
    throw new Error("Provider execution receipt response file and hash must both be present or absent.");
  }
  if (receipt.status === "completed" && receipt.responseFile === null) {
    throw new Error("Provider completed receipt requires a response file and hash.");
  }
  if (!Array.isArray(receipt.integrityChecks) || !receipt.integrityChecks.length) {
    throw new Error("Provider execution receipt integrityChecks must be a non-empty array.");
  }
  const checkIds = new Set();
  receipt.integrityChecks.forEach((check, index) => {
    validateIntegrityCheck(check, index);
    if (checkIds.has(check.checkId)) throw new Error(`Provider execution receipt has duplicate integrity check '${check.checkId}'.`);
    checkIds.add(check.checkId);
  });
  assertUniqueStrings(receipt.diagnostics, "Provider execution receipt diagnostics");
  if (receipt.diagnostics.length > 32 || receipt.diagnostics.some((item) => item.length > 2048)) {
    throw new Error("Provider execution receipt diagnostics exceed the bounded limit.");
  }
  return receipt;
}

function normalizeFindingText(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function mapProviderResponseToReview(response, { evidencePath }) {
  assertNonEmptyString(evidencePath, "Provider response evidence path");
  if (response.status !== "completed") {
    throw new Error("Only a completed Provider response can be mapped to a formal review.");
  }
  const findings = response.findings.map((finding) => {
    const identity = [
      finding.severity,
      finding.file ?? "",
      finding.line ?? "",
      normalizeFindingText(finding.summary),
      normalizeFindingText(finding.evidenceText),
    ].join("\n");
    const findingId = `PF-${createHash("sha256").update(identity).digest("hex").slice(0, 16).toUpperCase()}`;
    return {
      findingId,
      severity: finding.severity,
      status: "open",
      summary: finding.summary,
      file: finding.file,
      line: finding.line,
      evidence: evidencePath,
    };
  });
  return {
    findings,
    status: findings.some((finding) => ["BLOCKER", "WARNING"].includes(finding.severity))
      ? "blocked"
      : "passed",
  };
}
