import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCompletionGate, assertRequirementGate } from "./acceptance-gate.mjs";
import {
  approvalSemanticKey,
  canonicalJson,
  deterministicApprovalId,
  knowledgeStaleSubjectSha256,
  validateApprovalReceipt,
  verificationGapSubjectSha256,
} from "./approval-contract.mjs";
import { verifyKnowledgeAreaArtifacts } from "./knowledge-runtime.mjs";
import {
  validateDispatchResultStructure,
  validateDispatchTaskStructure,
} from "./dispatch-contract.mjs";
import { projectCompletedPhaseResult } from "./phase-result-projector.mjs";
import { readWorkflowDefinition } from "./state-runtime.mjs";
import { validateStateDocument } from "./state-contract.mjs";
import { validateTaskDag } from "./task-dag-contract.mjs";
import { phaseOutputs } from "./story-runtime.mjs";

const STATE_DIRECTORY = ".harness/states";
const FIXED_V2_SCHEMA = ".harness/schemas/e2e-state-v2.schema.json";
const FIXED_V2_WORKFLOW = ".harness/workflows/e2e-development-v2.yaml";
const EVIDENCE_DIRECTORIES = [
  ".harness/runs",
  ".harness/states",
  "llm-knowledge",
  "docs",
];
const COMPLETED_PHASES = [
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
const PHASE_PROJECTION_FIELDS = {
  requirement: ["requirement", "acceptance"],
  "technical-design": ["design", "knowledge"],
  "task-dag": ["acceptance"],
  implementation: ["dag", "implementation", "acceptance"],
  "unit-test": ["tests", "acceptance"],
  "code-review": ["review"],
  "build-publish": ["build"],
  "interface-verification": ["verification", "acceptance"],
  "delivery-preparation": ["delivery", "acceptance"],
};

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function sha256(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function assertRepositoryRelativePath(relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const normalized = normalizePath(path.normalize(relativePath));
  if (normalized === "."
      || normalized === ".."
      || normalized.startsWith("../")
      || path.isAbsolute(normalized)) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  return normalized;
}

function resolveInsideDirectory(root, relativePath, allowedDirectory, label) {
  const normalized = assertRepositoryRelativePath(relativePath, label);
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, normalized);
  const allowedPath = path.resolve(rootPath, allowedDirectory);
  const withinAllowed = path.relative(allowedPath, fullPath);
  if (!withinAllowed
      || withinAllowed === ".."
      || withinAllowed.startsWith(`..${path.sep}`)
      || path.isAbsolute(withinAllowed)) {
    throw new Error(`${label} must stay inside ${normalizePath(allowedDirectory)}.`);
  }
  return { fullPath, relativePath: normalizePath(path.relative(rootPath, fullPath)) };
}

function resolveEvidencePath(root, relativePath, label) {
  const normalized = assertRepositoryRelativePath(relativePath, label);
  for (const directory of EVIDENCE_DIRECTORIES) {
    try {
      return resolveInsideDirectory(root, normalized, directory, label);
    } catch {
      // Try the next fixed evidence directory.
    }
  }
  throw new Error(`${label} is outside the allowed evidence directories.`);
}

function validateBusinessPath(root, relativePath, label) {
  const normalized = assertRepositoryRelativePath(relativePath, label);
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, normalized);
  const withinRoot = path.relative(rootPath, fullPath);
  if (!withinRoot
      || withinRoot === ".."
      || withinRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(withinRoot)
      || withinRoot === ".git"
      || withinRoot.startsWith(`.git${path.sep}`)) {
    throw new Error(`${label} must stay inside the repository and outside .git.`);
  }
  return normalizePath(withinRoot);
}

async function assertSafeRegularFile(root, fullPath, label) {
  const rootPath = path.resolve(root);
  const rootRealPath = await realpath(rootPath);
  const relative = path.relative(rootPath, fullPath);
  let current = rootPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
      throw error;
    });
    if (info.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link or junction.`);
    }
    const currentRealPath = await realpath(current);
    const realRelative = path.relative(rootRealPath, currentRealPath);
    if (realRelative === ".."
        || realRelative.startsWith(`..${path.sep}`)
        || path.isAbsolute(realRelative)) {
      throw new Error(`${label} resolves outside the repository.`);
    }
  }
  const finalInfo = await lstat(fullPath);
  if (!finalInfo.isFile() || finalInfo.isSymbolicLink()) {
    throw new Error(`${label} must be a safe regular file.`);
  }
}

async function readSafeFile(root, location, label) {
  await assertSafeRegularFile(root, location.fullPath, label);
  return readFile(location.fullPath);
}

async function verifyEvidencePair(root, relativePath, expectedSha256, label, expectedBytes = null) {
  if (relativePath === null && expectedSha256 === null) return;
  if (typeof relativePath !== "string" || typeof expectedSha256 !== "string") {
    throw new Error(`${label} path and SHA-256 must both be present.`);
  }
  const location = resolveEvidencePath(root, relativePath, label);
  const source = await readSafeFile(root, location, label);
  if (sha256(source) !== expectedSha256) {
    throw new Error(`${label} hash changed after it was recorded.`);
  }
  if (expectedBytes !== null && source.byteLength !== expectedBytes) {
    throw new Error(`${label} byte count changed after it was recorded.`);
  }
  return source;
}

async function verifyEvidenceInsideDirectory(
  root,
  relativePath,
  expectedSha256,
  expectedBytes,
  allowedDirectory,
  label,
) {
  const location = resolveInsideDirectory(root, relativePath, allowedDirectory, label);
  const source = await readSafeFile(root, location, label);
  if (sha256(source) !== expectedSha256) {
    throw new Error(`${label} hash changed after it was recorded.`);
  }
  if (source.byteLength !== expectedBytes) {
    throw new Error(`${label} byte count changed after it was recorded.`);
  }
}

async function verifyBuildArtifact(root, artifact) {
  const label = `Build artifact ${artifact.artifactId}`;
  const relativePath = validateBusinessPath(root, artifact.path, label);
  const location = {
    fullPath: path.resolve(root, relativePath),
    relativePath,
  };
  const source = await readSafeFile(root, location, label);
  if (sha256(source) !== artifact.sha256) {
    throw new Error(`${label} hash changed after it was recorded.`);
  }
}

async function verifyPathOnlyEvidence(root, relativePath, label) {
  if (relativePath === null) return;
  const location = resolveEvidencePath(root, relativePath, label);
  await assertSafeRegularFile(root, location.fullPath, label);
}

async function verifyApprovalSemantics(root, state) {
  const verificationCases = new Map(state.verification.cases.map((item) => [item.caseId, item]));
  const verificationResults = new Map(
    state.verification.results
      .filter((item) => item.approvalId !== null)
      .map((item) => [item.approvalId, item]),
  );
  for (const approval of state.approvals) {
    const receiptLocation = resolveEvidencePath(root, approval.receiptPath, "Approval receipt");
    const receiptSource = await readSafeFile(root, receiptLocation, "Approval receipt");
    if (sha256(receiptSource) !== approval.receiptSha256) {
      throw new Error(`Approval receipt changed before closure verification: ${approval.approvalId}`);
    }
    let receipt;
    try {
      receipt = JSON.parse(receiptSource.toString("utf8"));
    } catch {
      throw new Error(`Approval receipt is invalid JSON: ${approval.receiptPath}`);
    }

    if (approval.subjectType === "verification-gap") {
      const resultValue = verificationResults.get(approval.approvalId);
      const caseValue = resultValue ? verificationCases.get(resultValue.caseId) : null;
      if (!resultValue || !caseValue) {
        throw new Error(`Approval '${approval.approvalId}' is not referenced by verification.`);
      }
      const subjectSha256 = verificationGapSubjectSha256(caseValue, resultValue, approval);
      validateApprovalReceipt(receipt, {
        task: approval,
        caseValue,
        resultValue,
        expectedSubjectSha256: subjectSha256,
      });
    } else {
      const area = state.knowledge.areas.find((item) => item.approvalId === approval.approvalId);
      if (!area) {
        throw new Error(`Approval '${approval.approvalId}' is not referenced by knowledge.`);
      }
      const attemptRoot = path.posix.dirname(path.posix.dirname(approval.receiptPath));
      const knowledgeTask = {
        schemaVersion: "2.0",
        storyId: approval.storyId,
        runId: approval.runId,
        phase: approval.phase,
        dispatchId: approval.dispatchId,
        preparedRevision: approval.preparedRevision,
        attemptRoot,
      };
      const subjectSha256 = knowledgeStaleSubjectSha256(area, knowledgeTask);
      validateApprovalReceipt(receipt, {
        task: knowledgeTask,
        knowledgeArea: area,
        expectedSubjectSha256: subjectSha256,
      });
      await verifyKnowledgeAreaArtifacts({
        root,
        task: knowledgeTask,
        area,
        verifyCurrentFingerprint: false,
      });
    }

    const expectedApprovalId = deterministicApprovalId(approvalSemanticKey({
      storyId: receipt.storyId,
      dispatchId: receipt.dispatchId,
      caseId: receipt.subjectId,
      subjectSha256: receipt.subjectSha256,
      actor: receipt.actor,
      reason: receipt.reason,
    }));
    const formalReceipt = Object.fromEntries(
      Object.keys(receipt).map((field) => [field, approval[field]]),
    );
    if (receipt.approvalId !== approval.approvalId
        || receipt.approvalId !== expectedApprovalId
        || canonicalJson(receipt) !== canonicalJson(formalReceipt)) {
      throw new Error(`Approval receipt identity is invalid: ${approval.approvalId}`);
    }
  }
}

function phaseRootFor(state, phase) {
  return `.harness/runs/${state.runtime.runId}/phases/${String(phase.order).padStart(2, "0")}-${phase.id}`;
}

function isAllowedPhaseOutput(relativePath, phaseRoot, phase, state) {
  return relativePath.startsWith(`${phaseRoot}/`)
    || (
      phase.id === "delivery-preparation"
      && relativePath === `.harness/runs/${state.runtime.runId}/delivery/owned-manifest.json`
    );
}

function assertProjectedFieldsMatch(state, projected, phase) {
  if (phase === "task-dag") {
    const planView = (dag) => ({
      ...dag,
      nodes: dag.nodes.map(({ status, ...node }) => node),
    });
    if (canonicalJson(planView(projected.dag)) !== canonicalJson(planView(state.dag))) {
      throw new Error("Active task-dag result projection does not match completed State DAG plan.");
    }
  }
  for (const field of PHASE_PROJECTION_FIELDS[phase]) {
    if (canonicalJson(projected[field]) !== canonicalJson(state[field])) {
      throw new Error(`Active ${phase} result projection does not match completed State field '${field}'.`);
    }
  }
}

async function verifyPhaseResultChain(root, state, workflow) {
  const phaseResults = new Map();
  const resultRecords = state.runtime.records.filter((record) => record.type === "phase-result");
  const supersededDispatchIds = new Set(
    (state.runtime.reworks ?? []).flatMap((rework) => rework.supersededDispatchIds),
  );
  const activeDispatchIds = new Set(
    resultRecords
      .filter((record) => record.status === "applied"
        && !supersededDispatchIds.has(record.dispatchId))
      .map((record) => record.dispatchId),
  );
  const workflowPhases = new Map(workflow.phases.map((phase) => [phase.id, phase]));
  for (const record of resultRecords) {
    const label = `Phase result ${record.phase} ${record.dispatchId}`;
    const phase = workflowPhases.get(record.phase);
    if (!phase) throw new Error(`${label} references an unknown workflow phase.`);
    const phaseRoot = phaseRootFor(state, phase);
    const attemptRoot = `${phaseRoot}/attempts/${record.dispatchId}`;
    const expectedResultFile = `${attemptRoot}/result.json`;
    if (record.path !== expectedResultFile) {
      throw new Error(`${label} path does not match its formal attempt result path.`);
    }
    const taskFile = `${attemptRoot}/task.json`;
    const taskLocation = resolveEvidencePath(root, taskFile, `${label} task`);
    const taskSource = await readSafeFile(root, taskLocation, `${label} task`);
    let task;
    try {
      task = JSON.parse(taskSource.toString("utf8"));
    } catch {
      throw new Error(`${label} task contains invalid JSON.`);
    }
    validateDispatchTaskStructure(task);
    if (task.dispatchId !== record.dispatchId
        || task.storyId !== state.storyId
        || task.runId !== state.runtime.runId
        || task.phase !== record.phase
        || task.preparedRevision !== record.preparedRevision
        || task.attemptRoot !== attemptRoot
        || task.resultFile !== expectedResultFile
        || task.checkpointFile !== `${attemptRoot}/checkpoint.json`) {
      throw new Error(`${label} task identity does not match its formal attempt.`);
    }
    if (activeDispatchIds.has(record.dispatchId)) {
      const expectedOutputs = phaseOutputs(root, phase, phaseRoot, state);
      if (task.ownerAgent !== phase.owner_agent
          || task.purpose !== phase.purpose
          || task.next !== phase.next[0]
          || canonicalJson(task.expectedOutputs) !== canonicalJson(expectedOutputs)) {
        throw new Error(`${label} task does not match the active workflow contract.`);
      }
    }
    const source = await verifyEvidencePair(
      root,
      record.path,
      record.sha256,
      label,
      record.bytes,
    );
    let result;
    try {
      result = JSON.parse(source.toString("utf8"));
    } catch {
      throw new Error(`${label} contains invalid JSON.`);
    }
    validateDispatchResultStructure(result);
    if (result.dispatchId !== record.dispatchId
        || result.storyId !== state.storyId
        || result.runId !== state.runtime.runId
        || result.phase !== record.phase
        || result.preparedRevision !== record.preparedRevision) {
      throw new Error(`${label} identity does not match its State record.`);
    }
    const expectedStatus = record.status === "applied" ? "completed" : record.status;
    if (result.status !== expectedStatus) {
      throw new Error(`${label} status does not match its State record.`);
    }
    if (result.status === "completed"
        && canonicalJson(result.outputs.map((output) => output.path))
          !== canonicalJson(task.expectedOutputs)) {
      throw new Error(`${label} outputs do not match its task required output set.`);
    }
    for (const [index, output] of result.outputs.entries()) {
      if (!isAllowedPhaseOutput(output.path, phaseRoot, phase, state)) {
        throw new Error(`${label} output ${index} is outside its workflow phase boundary.`);
      }
      await verifyEvidencePair(
        root,
        output.path,
        output.sha256,
        `${label} output ${index}`,
        output.bytes,
      );
    }
    for (const [index, evidence] of result.records.entries()) {
      if (evidence.path !== null) {
        await verifyEvidenceInsideDirectory(
          root,
          evidence.path,
          evidence.sha256,
          evidence.bytes,
          `${attemptRoot}/evidence`,
          `${label} record ${index}`,
        );
      }
    }
    phaseResults.set(record.dispatchId, result);
  }

  for (const phase of COMPLETED_PHASES) {
    const activeRecords = resultRecords.filter(
      (record) => record.phase === phase
        && record.status === "applied"
        && !supersededDispatchIds.has(record.dispatchId),
    );
    if (activeRecords.length !== 1) {
      throw new Error(`Story closure requires exactly one active completed result for '${phase}'.`);
    }
    const result = phaseResults.get(activeRecords[0].dispatchId);
    let taskDag = null;
    if (phase === "task-dag") {
      const source = await verifyEvidencePair(
        root,
        result.payload.taskDagFile,
        result.payload.taskDagSha256,
        "Active task-dag result document",
      );
      try {
        taskDag = JSON.parse(source.toString("utf8"));
      } catch {
        throw new Error("Active task-dag result document contains invalid JSON.");
      }
      validateTaskDag(taskDag);
    }
    const projectionInput = structuredClone(state);
    projectionInput.phase = phase;
    projectionInput.runtime.status = "active";
    const projected = projectCompletedPhaseResult({
      state: projectionInput,
      result,
      taskDag,
    });
    assertProjectedFieldsMatch(state, projected, phase);
  }
}

async function verifyStateReferences(root, state) {
  for (const [index, record] of state.runtime.records.entries()) {
    const label = `Runtime record ${index}`;
    if (record.type === "phase-result") continue;
    if (record.path !== null && typeof record.sha256 === "string") {
      await verifyEvidencePair(root, record.path, record.sha256, label);
    } else if (record.path !== null) {
      validateBusinessPath(root, record.path, `${label} path`);
    }
  }

  await verifyEvidencePair(root, state.dag.sourceFile, state.dag.sourceSha256, "Task DAG");

  for (const area of state.knowledge.areas) {
    await verifyEvidencePair(
      root,
      area.freshnessEvidencePath,
      area.freshnessEvidenceSha256,
      `Knowledge freshness evidence for ${area.area}`,
    );
    await verifyEvidencePair(
      root,
      area.refreshTaskPath,
      area.refreshTaskSha256,
      `Knowledge refresh task for ${area.area}`,
    );
    await verifyEvidencePair(
      root,
      area.refreshReceiptPath,
      area.refreshReceiptSha256,
      `Knowledge refresh receipt for ${area.area}`,
    );
  }

  for (const command of state.tests.commands) {
    await verifyEvidencePair(
      root,
      command.evidencePath,
      command.evidenceSha256,
      `Test command ${command.commandId}`,
    );
  }
  for (const result of state.tests.results) {
    await verifyEvidencePair(
      root,
      result.evidencePath,
      result.evidenceSha256,
      `Test result ${result.caseId}`,
    );
  }
  for (const [index, finding] of state.review.findings.entries()) {
    if (finding.file !== null) validateBusinessPath(root, finding.file, `Review finding ${index} file`);
    await verifyPathOnlyEvidence(root, finding.evidence, `Review finding ${index} evidence`);
  }
  for (const result of state.build.results) {
    await verifyEvidencePair(
      root,
      result.evidencePath,
      result.evidenceSha256,
      `Build result ${result.buildId}`,
    );
  }
  for (const artifact of state.build.artifacts) {
    await verifyBuildArtifact(root, artifact);
  }
  for (const action of state.build.externalActions) {
    await verifyEvidencePair(
      root,
      action.evidencePath,
      action.evidenceSha256,
      `External action ${action.actionId}`,
    );
  }
  await verifyEvidencePair(
    root,
    state.verification.environment.evidencePath,
    state.verification.environment.evidenceSha256,
    "Verification environment evidence",
  );
  for (const result of state.verification.results) {
    await verifyEvidencePair(
      root,
      result.evidencePath,
      result.evidenceSha256,
      `Verification result ${result.caseId}`,
    );
  }
  for (const approval of state.approvals) {
    await verifyEvidencePair(
      root,
      approval.evidencePath,
      approval.evidenceSha256,
      `Approval ${approval.approvalId} evidence`,
    );
    await verifyEvidencePair(
      root,
      approval.receiptPath,
      approval.receiptSha256,
      `Approval ${approval.approvalId} receipt`,
    );
  }
  await verifyEvidencePair(root, state.delivery.summaryFile, state.delivery.summarySha256, "Delivery summary");
  await verifyEvidencePair(
    root,
    state.delivery.ownedManifestFile,
    state.delivery.ownedManifestSha256,
    "Owned manifest",
  );

  for (const [index, relativePath] of state.implementation.actualFiles.entries()) {
    validateBusinessPath(root, relativePath, `Implementation file ${index}`);
  }
  for (const field of ["ownedFiles", "outOfPredictionFiles", "unrelatedDirtyFiles"]) {
    for (const [index, relativePath] of state.delivery[field].entries()) {
      validateBusinessPath(root, relativePath, `Delivery ${field}[${index}]`);
    }
  }
}

export async function verifyStoryClosure({
  root = process.cwd(),
  stateFile,
}) {
  const rootPath = path.resolve(root);
  const stateLocation = resolveInsideDirectory(rootPath, stateFile, STATE_DIRECTORY, "State file");
  const stateSource = await readSafeFile(rootPath, stateLocation, "State file");
  let state;
  try {
    state = JSON.parse(stateSource.toString("utf8"));
  } catch {
    throw new Error("State file contains invalid JSON.");
  }
  validateStateDocument(state);
  if (state.schemaVersion !== "2.0"
      || state.phase !== "done"
      || state.runtime.status !== "completed") {
    throw new Error("Story closure verification requires a completed State v2.");
  }

  for (const [relativePath, label] of [
    [FIXED_V2_SCHEMA, "State v2 Schema"],
    [FIXED_V2_WORKFLOW, "State v2 workflow"],
  ]) {
    const location = resolveInsideDirectory(rootPath, relativePath, path.dirname(relativePath), label);
    await assertSafeRegularFile(rootPath, location.fullPath, label);
  }
  const workflow = await readWorkflowDefinition(rootPath, state);

  assertRequirementGate(state);
  assertCompletionGate(state);
  const unresolvedReviewFinding = state.review.findings.find(
    (finding) => ["BLOCKER", "WARNING"].includes(finding.severity)
      && finding.status === "open",
  );
  if (unresolvedReviewFinding) {
    throw new Error(`Story closure has an unresolved ${unresolvedReviewFinding.severity} finding.`);
  }
  await verifyPhaseResultChain(rootPath, state, workflow);
  await verifyStateReferences(rootPath, state);
  await verifyApprovalSemantics(rootPath, state);

  return {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    status: "passed",
    stateFile: stateLocation.relativePath,
    stateSha256: sha256(stateSource),
    requirement: {
      summary: state.requirement.summary,
      acceptanceCriteria: state.requirement.acceptanceCriteria,
    },
    decisions: state.design.decisions,
    knowledge: state.knowledge,
    dag: state.dag,
    implementation: state.implementation,
    tests: state.tests,
    review: state.review,
    build: state.build,
    verification: state.verification,
    acceptedGaps: state.approvals.filter(
      (approval) => approval.subjectType === "verification-gap",
    ),
    delivery: state.delivery,
    diagnostics: [],
  };
}

function parseCliArguments(argumentsList) {
  const options = { root: process.cwd(), stateFile: null, json: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--root" || argument === "--state-file") {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--root") options.root = value;
      else options.stateFile = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.stateFile) throw new Error("--state-file is required.");
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const result = await verifyStoryClosure(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Story closure verified: ${result.storyId}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
