const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function object(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const field of fields) {
    if (!(field in value)) throw new Error(`${label} requires '${field}'.`);
  }
  const extra = Object.keys(value).find((field) => !fields.includes(field));
  if (extra) throw new Error(`${label} contains unsupported field '${extra}'.`);
}

function string(value, label, { nullable = false, allowEmpty = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${nullable ? "null or " : ""}a string.`);
  }
}

function id(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} is invalid.`);
}

function date(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  string(value, label);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO-8601 timestamp.`);
}

function pathValue(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  string(value, label);
  if (value !== value.trim() || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)
      || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
}

function uniqueStrings(value, label, { paths = false } = {}) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((item) => (paths ? pathValue(item, `${label} item`) : string(item, `${label} item`)));
  if (new Set(value).size !== value.length) throw new Error(`${label} items must be unique.`);
}

function uniqueObjects(value, key, validator, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((item, index) => validator(item, `${label}[${index}]`));
  const ids = value.map((item) => item[key]);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ${key} values must be unique.`);
}

function evidence(value, label) {
  if ((value.evidencePath === null) !== (value.evidenceSha256 === null)) {
    throw new Error(`${label} evidence path and hash must both be null or both be present.`);
  }
  if (value.evidencePath !== null) {
    pathValue(value.evidencePath, `${label}.evidencePath`);
    if (!SHA256_PATTERN.test(value.evidenceSha256)) throw new Error(`${label}.evidenceSha256 is invalid.`);
  }
}

function criterion(item, label) {
  object(item, ["criterionId", "description", "source", "required"], label);
  id(item.criterionId, `${label}.criterionId`);
  string(item.description, `${label}.description`);
  string(item.source, `${label}.source`);
  if (typeof item.required !== "boolean") throw new Error(`${label}.required must be boolean.`);
}

function question(item, label) {
  object(item, ["questionId", "question", "status", "resolution"], label);
  id(item.questionId, `${label}.questionId`);
  string(item.question, `${label}.question`);
  enumValue(item.status, ["open", "resolved"], `${label}.status`);
  string(item.resolution, `${label}.resolution`, { nullable: true });
  if (item.status === "open" && item.resolution !== null) {
    throw new Error(`${label}.resolution must be null for an open question.`);
  }
  if (item.status === "resolved" && item.resolution === null) {
    throw new Error(`${label}.resolution is required for a resolved question.`);
  }
}

function risk(item, label, remaining = false) {
  const fields = ["riskId", "description", "severity", "mitigation", ...(remaining ? ["status", "approvalId"] : [])];
  object(item, fields, label);
  id(item.riskId, `${label}.riskId`);
  string(item.description, `${label}.description`);
  enumValue(item.severity, ["low", "medium", "high"], `${label}.severity`);
  string(item.mitigation, `${label}.mitigation`);
  if (remaining) {
    enumValue(item.status, ["open", "accepted", "resolved"], `${label}.status`);
    string(item.approvalId, `${label}.approvalId`, { nullable: true });
  }
}

function knowledgeArea(item, label) {
  object(item, ["area", "relevant", "status", "sourceFingerprint", "loadedFiles", "missing", "checkedAt"], label);
  id(item.area, `${label}.area`);
  if (typeof item.relevant !== "boolean") throw new Error(`${label}.relevant must be boolean.`);
  string(item.status, `${label}.status`);
  string(item.sourceFingerprint, `${label}.sourceFingerprint`, { nullable: true });
  uniqueStrings(item.loadedFiles, `${label}.loadedFiles`, { paths: true });
  uniqueStrings(item.missing, `${label}.missing`);
  date(item.checkedAt, `${label}.checkedAt`, { nullable: true });
}

export function validateRequirementData(value, label = "Requirement") {
  uniqueObjects(value.acceptanceCriteria, "criterionId", criterion, `${label}.acceptanceCriteria`);
  uniqueObjects(value.openQuestions, "questionId", question, `${label}.openQuestions`);
  uniqueStrings(value.inScope, `${label}.inScope`);
  uniqueStrings(value.outOfScope, `${label}.outOfScope`);
}

export function validateTechnicalDesignData(value, label = "Technical design") {
  uniqueObjects(value.decisions, "decisionId", (item, itemLabel) => {
    object(item, ["decisionId", "summary", "rationale"], itemLabel);
    id(item.decisionId, `${itemLabel}.decisionId`);
    string(item.summary, `${itemLabel}.summary`);
    string(item.rationale, `${itemLabel}.rationale`);
  }, `${label}.decisions`);
  uniqueStrings(value.affectedAreas, `${label}.affectedAreas`);
  uniqueObjects(value.knowledgeSnapshot, "area", knowledgeArea, `${label}.knowledgeSnapshot`);
  uniqueObjects(value.risks, "riskId", risk, `${label}.risks`);
}

export function validateImplementationData(value, label = "Implementation") {
  uniqueStrings(value.actualFiles, `${label}.actualFiles`, { paths: true });
  uniqueStrings(value.notes, `${label}.notes`);
  if (value.method === "tdd" && value.exceptionReason !== null) {
    throw new Error(`${label}.exceptionReason must be null for tdd.`);
  }
  if (value.method === "exception") string(value.exceptionReason, `${label}.exceptionReason`);
  if (value.method !== null && !value.actualFiles.length && !value.notes.length) {
    throw new Error(`${label}.notes are required when actualFiles is empty.`);
  }
}

function testCase(item, label) {
  object(item, ["caseId", "type", "required", "criterionIds", "expected"], label);
  id(item.caseId, `${label}.caseId`);
  enumValue(item.type, ["unit", "integration", "contract", "ui"], `${label}.type`);
  if (typeof item.required !== "boolean") throw new Error(`${label}.required must be boolean.`);
  uniqueStrings(item.criterionIds, `${label}.criterionIds`);
  item.criterionIds.forEach((criterionId) => id(criterionId, `${label}.criterionIds item`));
  string(item.expected, `${label}.expected`);
}

function testCommand(item, label) {
  object(item, ["commandId", "command", "status", "exitCode", "evidencePath", "evidenceSha256", "executedAt"], label);
  id(item.commandId, `${label}.commandId`);
  string(item.command, `${label}.command`);
  enumValue(item.status, ["passed", "failed", "skipped", "blocked"], `${label}.status`);
  if (item.exitCode !== null && !Number.isInteger(item.exitCode)) throw new Error(`${label}.exitCode is invalid.`);
  evidence(item, label);
  date(item.executedAt, `${label}.executedAt`);
}

function testResult(item, label) {
  object(item, ["caseId", "status", "actual", "evidencePath", "evidenceSha256", "executedAt"], label);
  id(item.caseId, `${label}.caseId`);
  enumValue(item.status, ["passed", "failed", "skipped", "blocked"], `${label}.status`);
  string(item.actual, `${label}.actual`);
  evidence(item, label);
  date(item.executedAt, `${label}.executedAt`);
}

export function validateTestData(value, label = "Tests") {
  uniqueObjects(value.cases, "caseId", testCase, `${label}.cases`);
  uniqueObjects(value.commands, "commandId", testCommand, `${label}.commands`);
  uniqueObjects(value.results, "caseId", testResult, `${label}.results`);
}

function finding(item, label) {
  object(item, ["findingId", "severity", "status", "summary", "file", "line", "evidence"], label);
  id(item.findingId, `${label}.findingId`);
  enumValue(item.severity, ["BLOCKER", "WARNING", "INFO"], `${label}.severity`);
  enumValue(item.status, ["open", "resolved"], `${label}.status`);
  string(item.summary, `${label}.summary`);
  pathValue(item.file, `${label}.file`, { nullable: true });
  if (item.line !== null && (!Number.isInteger(item.line) || item.line < 1)) throw new Error(`${label}.line is invalid.`);
  pathValue(item.evidence, `${label}.evidence`, { nullable: true });
}

export function validateReviewData(value, label = "Review") {
  uniqueObjects(value.findings, "findingId", finding, `${label}.findings`);
  enumValue(value.status, ["pending", "passed", "blocked"], `${label}.status`);
}

function buildResult(item, label) {
  object(item, ["buildId", "type", "status", "command", "evidencePath", "evidenceSha256", "executedAt"], label);
  id(item.buildId, `${label}.buildId`);
  enumValue(item.type, ["backend", "frontend", "docker", "no-build"], `${label}.type`);
  enumValue(item.status, ["passed", "failed", "skipped", "blocked"], `${label}.status`);
  string(item.command, `${label}.command`);
  evidence(item, label);
  date(item.executedAt, `${label}.executedAt`);
}

function artifact(item, label) {
  object(item, ["artifactId", "type", "path", "sha256", "bytes"], label);
  id(item.artifactId, `${label}.artifactId`);
  string(item.type, `${label}.type`);
  pathValue(item.path, `${label}.path`);
  if (!SHA256_PATTERN.test(item.sha256)) throw new Error(`${label}.sha256 is invalid.`);
  if (!Number.isInteger(item.bytes) || item.bytes < 0) throw new Error(`${label}.bytes is invalid.`);
}

function externalAction(item, label) {
  object(item, ["actionId", "type", "status", "approvalId", "evidencePath", "evidenceSha256"], label);
  id(item.actionId, `${label}.actionId`);
  enumValue(item.type, ["publish", "deploy", "docker-build", "docker-up", "docker-down"], `${label}.type`);
  enumValue(item.status, ["not-requested", "approved", "executed", "blocked"], `${label}.status`);
  string(item.approvalId, `${label}.approvalId`, { nullable: true });
  evidence(item, label);
  if (["approved", "executed"].includes(item.status) && item.approvalId === null) {
    throw new Error(`${label}.approvalId is required for ${item.status} status.`);
  }
}

export function validateBuildData(value, label = "Build") {
  uniqueObjects(value.results, "buildId", buildResult, `${label}.results`);
  uniqueObjects(value.artifacts, "artifactId", artifact, `${label}.artifacts`);
  uniqueObjects(value.externalActions, "actionId", externalAction, `${label}.externalActions`);
}

function verificationCase(item, label) {
  object(item, ["caseId", "type", "required", "criterionIds", "action", "expected"], label);
  id(item.caseId, `${label}.caseId`);
  enumValue(item.type, ["api", "ui-flow", "manual"], `${label}.type`);
  if (typeof item.required !== "boolean") throw new Error(`${label}.required must be boolean.`);
  uniqueStrings(item.criterionIds, `${label}.criterionIds`);
  item.criterionIds.forEach((criterionId) => id(criterionId, `${label}.criterionIds item`));
  string(item.action, `${label}.action`);
  string(item.expected, `${label}.expected`);
}

function verificationResult(item, label) {
  object(item, ["caseId", "status", "actual", "evidencePath", "evidenceSha256", "approvalId", "executedAt"], label);
  id(item.caseId, `${label}.caseId`);
  enumValue(item.status, ["verified", "failed", "blocked", "accepted-with-known-gaps"], `${label}.status`);
  string(item.actual, `${label}.actual`);
  evidence(item, label);
  string(item.approvalId, `${label}.approvalId`, { nullable: true });
  if (item.status === "accepted-with-known-gaps" && item.evidencePath === null) {
    throw new Error(`${label} accepted gap requires evidence.`);
  }
  if (item.status !== "accepted-with-known-gaps" && item.approvalId !== null) {
    throw new Error(`${label} approvalId is only allowed for accepted gaps.`);
  }
  date(item.executedAt, `${label}.executedAt`);
}

export function validateVerificationData(value, label = "Verification") {
  uniqueObjects(value.cases, "caseId", verificationCase, `${label}.cases`);
  uniqueObjects(value.results, "caseId", verificationResult, `${label}.results`);
  object(value.environment, ["status", "summary", "evidencePath", "evidenceSha256"], `${label}.environment`);
  enumValue(value.environment.status, ["not-checked", "available", "unavailable"], `${label}.environment.status`);
  string(value.environment.summary, `${label}.environment.summary`, { allowEmpty: true });
  evidence(value.environment, `${label}.environment`);
}

export function validateDeliveryData(value, label = "Delivery") {
  enumValue(value.status, ["pending", "ready", "blocked"], `${label}.status`);
  uniqueStrings(value.ownedFiles, `${label}.ownedFiles`, { paths: true });
  uniqueStrings(value.outOfPredictionFiles, `${label}.outOfPredictionFiles`, { paths: true });
  uniqueStrings(value.unrelatedDirtyFiles, `${label}.unrelatedDirtyFiles`, { paths: true });
  uniqueObjects(value.remainingRisks, "riskId", (item, itemLabel) => risk(item, itemLabel, true), `${label}.remainingRisks`);
  if ((value.summaryFile === null) !== (value.summarySha256 === null)) {
    throw new Error(`${label} summary file and hash must both be null or both be present.`);
  }
  if (value.summaryFile !== null) {
    pathValue(value.summaryFile, `${label}.summaryFile`);
    if (!SHA256_PATTERN.test(value.summarySha256)) throw new Error(`${label}.summarySha256 is invalid.`);
  }
  if ((value.ownedManifestFile === null) !== (value.ownedManifestSha256 === null)) {
    throw new Error(`${label} owned manifest file and hash must both be null or both be present.`);
  }
  if (value.ownedManifestFile !== null) {
    pathValue(value.ownedManifestFile, `${label}.ownedManifestFile`);
    if (!SHA256_PATTERN.test(value.ownedManifestSha256)) throw new Error(`${label}.ownedManifestSha256 is invalid.`);
  }
  if (value.status === "ready" && value.summaryFile === null) {
    throw new Error(`${label} ready status requires a summary file and hash.`);
  }
  if (value.status === "ready" && value.ownedManifestFile === null) {
    throw new Error(`${label} ready status requires an owned manifest file and hash.`);
  }
  enumValue(value.gitStatus, ["not-requested", "requested"], `${label}.gitStatus`);
}
