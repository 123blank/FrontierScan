import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  validateDispatchResultStructure,
  validateDispatchTaskStructure,
} from "./dispatch-contract.mjs";
import {
  developmentToolchainSha256,
  validateDevelopmentCandidateManifest,
  validateDevelopmentContext,
  validateDevelopmentReceipt,
  validateDevelopmentExecutionReceipt,
  validateDevelopmentRequest,
  validateDevelopmentResponse,
  validateDevelopmentTestReceipt,
  validateDevelopmentTestReceiptBinding,
} from "./development-provider-contract.mjs";
import {
  captureDevelopmentBaseline,
  createDevelopmentContextCandidate,
} from "./development-provider-context.mjs";
import { loadProviderConfig, resolveProviderProfile } from "./provider-config.mjs";
import {
  discoverCodexExecutable,
  isProviderSensitiveKey,
  redactProviderDiagnostic,
  runCodexDevelopmentCli,
} from "./provider-adapters/codex-cli.mjs";
import { parsePorcelainV1Z } from "./state-runtime.mjs";
import { matchesPredictedFile } from "./task-dag-contract.mjs";
import {
  assertPathHasNoSymlink,
  loadWorkerPolicies,
  resolveRepositoryPath,
} from "./worker-runtime.mjs";

const execFileAsync = promisify(execFile);
const ROLES = new Set(["backend-developer", "frontend-developer"]);
const SHA = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class WorktreeRequiredError extends Error {}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function info(root, relativePath) {
  const fullPath = resolveRepositoryPath(root, relativePath, "Development Provider path").fullPath;
  const value = await lstat(fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  return { fullPath, info: value };
}

async function exists(root, relativePath) {
  return (await info(root, relativePath)).info !== null;
}

async function readText(root, relativePath, label) {
  const loaded = await info(root, relativePath);
  if (!loaded.info) throw new Error(`${label} is missing.`);
  if (!loaded.info.isFile() || loaded.info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return readFile(loaded.fullPath, "utf8");
}

async function readJson(root, relativePath, label) {
  try {
    return JSON.parse(await readText(root, relativePath, label));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

async function readOptionalJson(root, relativePath, label) {
  if (!await exists(root, relativePath)) return null;
  return readJson(root, relativePath, label);
}

async function fileSha256(root, relativePath) {
  const loaded = await info(root, relativePath);
  if (!loaded.info?.isFile() || loaded.info.isSymbolicLink()) {
    throw new Error(`Development Provider hash target must be a regular file: ${relativePath}`);
  }
  return sha256(await readFile(loaded.fullPath));
}

async function writeImmutable(root, relativePath, content) {
  const target = await info(root, relativePath);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (target.info) {
    if (!target.info.isFile() || target.info.isSymbolicLink()) {
      throw new Error(`Development Provider immutable target must be a regular file: ${relativePath}`);
    }
    if (!(await readFile(target.fullPath)).equals(buffer)) {
      throw new Error(`Development Provider immutable artifact drifted: ${relativePath}`);
    }
    return false;
  }
  await mkdir(path.dirname(target.fullPath), { recursive: true });
  const temporary = `${target.fullPath}.tmp-${randomUUID()}`;
  await writeFile(temporary, buffer);
  try {
    await rename(temporary, target.fullPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return true;
}

function phaseDirectory(state) {
  return `.harness/runs/${state.runtime.runId}/phases/03-implementation`;
}

export function developmentProviderPaths(task, taskId = null) {
  const providerRoot = `${task.attemptRoot}/development-provider`;
  const preparedRoot = `${providerRoot}/prepared`;
  const evidenceRoot = `${providerRoot}/evidence`;
  return {
    providerRoot,
    preparedRoot,
    evidenceRoot,
    requestFile: `${preparedRoot}/request.json`,
    contextManifestFile: `${preparedRoot}/context-manifest.json`,
    responseSchemaFile: `${preparedRoot}/response.schema.json`,
    bindingFile: `${preparedRoot}/binding.json`,
    baselineFile: `${preparedRoot}/worktree-baseline.json`,
    stateProjectionFile: `${preparedRoot}/state-projection.json`,
    policyFile: `${preparedRoot}/developer-policy.json`,
    lockFile: `${providerRoot}/provider.lock`,
    lockRecoveryFile: `${evidenceRoot}/lock-recoveries.jsonl`,
    executionsRoot: `${providerRoot}/executions`,
    worktreeAfterFile: `${evidenceRoot}/worktree-after.json`,
    candidateManifestFile: `${evidenceRoot}/candidate-manifest.json`,
    diagnosticsFile: `${evidenceRoot}/provider-diagnostics.json`,
    adapterSelectionFile: `${evidenceRoot}/adapter-selection.json`,
    testReceiptFile: `${evidenceRoot}/test-receipt.json`,
    testStdoutFile: `${evidenceRoot}/test-stdout.txt`,
    testStderrFile: `${evidenceRoot}/test-stderr.txt`,
    resultEvidenceFile: `${task.attemptRoot}/evidence/development-provider-result-evidence.json`,
    developmentReceiptFile: taskId
      ? `.harness/runs/${task.runId}/worktrees/${taskId}/development-provider-receipt.json`
      : `${providerRoot}/development-receipt.json`,
  };
}

function executionPaths(paths, providerExecutionId) {
  const executionRoot = `${paths.executionsRoot}/${providerExecutionId}`;
  return {
    executionRoot,
    claimFile: `${executionRoot}/execution-claim.json`,
    responseFile: `${executionRoot}/response.json`,
    receiptFile: `${executionRoot}/execution-receipt.json`,
    stdoutFile: `${executionRoot}/stdout.jsonl`,
    stderrFile: `${executionRoot}/stderr.txt`,
  };
}

async function loadAttempt({ root, stateFile }) {
  const repositoryRoot = path.resolve(root ?? process.cwd());
  const state = await readJson(repositoryRoot, stateFile, "Development Provider State");
  if (state.schemaVersion !== "2.0" || state.phase !== "implementation"
      || state.runtime?.status !== "active") {
    throw new Error("Development Provider requires an active State v2 implementation phase.");
  }
  const activeAttemptFile = `${phaseDirectory(state)}/active-attempt.json`;
  const activeAttempt = await readJson(
    repositoryRoot,
    activeAttemptFile,
    "Development Provider active attempt",
  );
  const task = await readJson(repositoryRoot, activeAttempt.taskFile, "Development Provider task");
  validateDispatchTaskStructure(task);
  if (!ROLES.has(task.ownerAgent) || task.phase !== "implementation") {
    throw new Error("Development Provider task must belong to a supported developer.");
  }
  if (task.storyId !== state.storyId || task.runId !== state.runtime.runId
      || task.dispatchId !== activeAttempt.dispatchId
      || task.preparedRevision !== state.runtime.revision
      || activeAttempt.preparedRevision !== state.runtime.revision
      || activeAttempt.taskFile !== `${task.attemptRoot}/task.json`) {
    throw new Error("Development Provider task identity or revision does not match State.");
  }
  const pending = (state.dag?.nodes ?? []).filter((node) => node.status === "pending");
  if (pending.length !== 1 || pending[0].ownerAgent !== task.ownerAgent) {
    throw new Error("Development Provider requires one matching pending DAG node.");
  }
  const node = pending[0];
  const worktreeDirectory = `.harness/runs/${state.runtime.runId}/worktrees/${node.taskId}`;
  const worktreePlanFile = `${worktreeDirectory}/plan.json`;
  const worktreeStatusFile = `${worktreeDirectory}/status.json`;
  if (!await exists(repositoryRoot, worktreePlanFile)
      || !await exists(repositoryRoot, worktreeStatusFile)) {
    throw new WorktreeRequiredError("Development Provider requires an approved created Worktree.");
  }
  const worktreePlan = await readJson(repositoryRoot, worktreePlanFile, "Development Worktree plan");
  const worktreeStatus = await readJson(repositoryRoot, worktreeStatusFile, "Development Worktree status");
  const worktreePath = resolveRepositoryPath(
    repositoryRoot,
    worktreePlan.worktreePath,
    "Development Worktree path",
  ).fullPath;
  return {
    root: repositoryRoot,
    state,
    stateFile,
    activeAttempt,
    activeAttemptFile,
    task,
    taskFile: activeAttempt.taskFile,
    node,
    worktreePlan,
    worktreePlanFile,
    worktreePlanSha256: await fileSha256(repositoryRoot, worktreePlanFile),
    worktreeStatus,
    worktreeStatusFile,
    worktreeStatusSha256: await fileSha256(repositoryRoot, worktreeStatusFile),
    worktreePath,
    paths: developmentProviderPaths(task, node.taskId),
  };
}

function validateLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)
      || lock.schemaVersion !== "1.0"
      || typeof lock.lockId !== "string"
      || !["prepare", "run", "materialize", "test", "finalize"].includes(lock.command)
      || typeof lock.storyId !== "string"
      || typeof lock.runId !== "string"
      || typeof lock.dispatchId !== "string"
      || typeof lock.taskId !== "string"
      || (lock.providerRequestId !== null && typeof lock.providerRequestId !== "string")
      || (lock.providerExecutionId !== null && typeof lock.providerExecutionId !== "string")
      || typeof lock.worktreePath !== "string" || !path.isAbsolute(lock.worktreePath)
      || !Number.isInteger(lock.parentPid)
      || (lock.childPid !== null && !Number.isInteger(lock.childPid))
      || typeof lock.startedAt !== "string" || Number.isNaN(Date.parse(lock.startedAt))) {
    throw new Error("Development Provider lock has an invalid structure.");
  }
  return lock;
}

function defaultProcessExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLock(attempt) {
  const lock = await readOptionalJson(attempt.root, attempt.paths.lockFile, "Development Provider lock");
  return lock ? validateLock(lock) : null;
}

async function acquireLock(attempt, command, now, {
  providerRequestId = null,
  providerExecutionId = null,
} = {}) {
  const target = (await info(attempt.root, attempt.paths.lockFile)).fullPath;
  await mkdir(path.dirname(target), { recursive: true });
  const lock = {
    schemaVersion: "1.0",
    lockId: randomUUID(),
    command,
    storyId: attempt.state.storyId,
    runId: attempt.state.runtime.runId,
    dispatchId: attempt.task.dispatchId,
    taskId: attempt.node.taskId,
    providerRequestId,
    providerExecutionId,
    worktreePath: attempt.worktreePath,
    parentPid: process.pid,
    childPid: null,
    startedAt: now(),
  };
  let handle;
  try {
    handle = await open(target, "wx");
    await handle.writeFile(canonicalJson(lock), "utf8");
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error("Development Provider lock is active; legacy locks require explicit recovery.");
    }
    throw error;
  }
  await handle.close();
  return lock;
}

async function assertLockOwned(attempt, lock) {
  const current = await readLock(attempt);
  if (!current || current.lockId !== lock.lockId) {
    throw new Error("Development Provider lock fencing rejected an expired holder.");
  }
}

async function replaceAtomic(root, relativePath, content) {
  const target = (await info(root, relativePath)).fullPath;
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, content);
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function updateLock(attempt, lock, changes) {
  await assertLockOwned(attempt, lock);
  const next = { ...lock, ...changes };
  validateLock(next);
  await replaceAtomic(attempt.root, attempt.paths.lockFile, canonicalJson(next));
  Object.assign(lock, next);
}

async function releaseLock(attempt, lock) {
  await assertLockOwned(attempt, lock);
  await unlink((await info(attempt.root, attempt.paths.lockFile)).fullPath);
}

async function withLock(attempt, command, options, action, identity = {}) {
  const lock = await acquireLock(
    attempt,
    command,
    options.now ?? (() => new Date().toISOString()),
    identity,
  );
  let failure;
  try {
    return await action(lock);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await releaseLock(attempt, lock);
    } catch (releaseError) {
      if (!failure) throw releaseError;
      if (!/fencing/i.test(failure.message)) throw releaseError;
    }
  }
}

function bindingFor({ request, context, baseline, responseSchema, createdAt }) {
  return {
    schemaVersion: "1.0",
    providerRequestId: request.providerRequestId,
    requestSha256: sha256(canonicalJson(request)),
    contextManifestSha256: sha256(canonicalJson(context)),
    baselineSha256: sha256(canonicalJson(baseline)),
    responseSchemaSha256: sha256(responseSchema),
    createdAt,
  };
}

function validateBinding(binding) {
  const fields = [
    "schemaVersion",
    "providerRequestId",
    "requestSha256",
    "contextManifestSha256",
    "baselineSha256",
    "responseSchemaSha256",
    "createdAt",
  ];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
      || Object.keys(binding).sort().join("\n") !== fields.sort().join("\n")
      || binding.schemaVersion !== "1.0"
      || typeof binding.providerRequestId !== "string"
      || !SHA.test(binding.requestSha256)
      || !SHA.test(binding.contextManifestSha256)
      || !SHA.test(binding.baselineSha256)
      || !SHA.test(binding.responseSchemaSha256)
      || typeof binding.createdAt !== "string" || Number.isNaN(Date.parse(binding.createdAt))) {
    throw new Error("Development Provider binding has an invalid structure.");
  }
}

function buildOutputPaths(role) {
  return role === "backend-developer"
    ? ["backend/target"]
    : ["frontend/node_modules", "frontend/dist"];
}

async function captureBaseline(attempt, options, capturedAt) {
  const capture = options.captureBaseline ?? captureDevelopmentBaseline;
  return capture({
    worktreePath: attempt.worktreePath,
    baseCommit: attempt.worktreePlan.baseCommit,
    predictedFiles: attempt.node.predictedFiles,
    buildOutputPaths: buildOutputPaths(attempt.task.ownerAgent),
    lockPaths: [".git/index.lock", ".git/config.lock"],
    now: () => capturedAt,
  });
}

function generatedStateProjection(attempt) {
  return {
    storyId: attempt.state.storyId,
    runId: attempt.state.runtime.runId,
    phase: attempt.state.phase,
    revision: attempt.state.runtime.revision,
    acceptanceCriteria: attempt.state.requirement.acceptanceCriteria,
    node: attempt.node,
  };
}

async function writeTempBundle(attempt, relativeTempRoot, bundle) {
  const target = resolveRepositoryPath(
    attempt.root,
    relativeTempRoot,
    "Development Provider temporary prepared directory",
  ).fullPath;
  await mkdir(target, { recursive: true });
  const files = {
    "state-projection.json": canonicalJson(bundle.stateProjection),
    "developer-policy.json": canonicalJson(bundle.policy),
    "context-manifest.json": canonicalJson(bundle.context),
    "response.schema.json": bundle.responseSchema,
    "worktree-baseline.json": canonicalJson(bundle.baseline),
    "request.json": canonicalJson(bundle.request),
    "binding.json": canonicalJson(bundle.binding),
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(target, name), content, "utf8");
  }
}

function validateExecutionClaim(claim) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)
      || claim.schemaVersion !== "1.0"
      || !UUID.test(claim.providerExecutionId)
      || !UUID.test(claim.providerRequestId)
      || claim.phase !== "implementation"
      || !ROLES.has(claim.role)
      || typeof claim.dispatchId !== "string"
      || typeof claim.storyId !== "string"
      || claim.runId !== claim.storyId
      || typeof claim.taskId !== "string"
      || typeof claim.worktreePath !== "string" || !path.isAbsolute(claim.worktreePath)
      || typeof claim.claimedAt !== "string" || Number.isNaN(Date.parse(claim.claimedAt))) {
    throw new Error("Development execution claim has an invalid structure.");
  }
  return claim;
}

function assertExecutionIdentity(value, request, providerExecutionId, label) {
  if (value.providerExecutionId !== providerExecutionId
      || value.providerRequestId !== request.providerRequestId
      || value.dispatchId !== request.dispatchId
      || value.storyId !== request.storyId
      || value.runId !== request.runId
      || value.phase !== request.phase
      || value.taskId !== request.taskId
      || value.role !== request.role) {
    throw new Error(`${label} identity drifted from the frozen request.`);
  }
}

async function loadExecutions(attempt, request) {
  const root = (await info(attempt.root, attempt.paths.executionsRoot));
  if (!root.info) return [];
  if (!root.info.isDirectory() || root.info.isSymbolicLink()) {
    throw new Error("Development Provider executions path must be a directory.");
  }
  const result = [];
  for (const name of (await readdir(root.fullPath)).sort()) {
    if (!UUID.test(name)) throw new Error("Development Provider execution directory name is invalid.");
    const executionRoot = `${attempt.paths.executionsRoot}/${name}`;
    const claim = await readOptionalJson(
      attempt.root,
      `${executionRoot}/execution-claim.json`,
      "Development execution claim",
    );
    const receipt = await readOptionalJson(
      attempt.root,
      `${executionRoot}/execution-receipt.json`,
      "Development execution receipt",
    );
    if (!claim && receipt) throw new Error("Development execution receipt is missing its claim.");
    if (claim) {
      validateExecutionClaim(claim);
      assertExecutionIdentity(claim, request, name, "Development execution claim");
      if (claim.worktreePath !== request.worktreePath) {
        throw new Error("Development execution claim Worktree drifted from the frozen request.");
      }
    }
    if (receipt) {
      validateDevelopmentExecutionReceipt(receipt);
      assertExecutionIdentity(receipt, request, name, "Development execution receipt");
      const expected = executionPaths(attempt.paths, name);
      if (receipt.requestFile !== attempt.paths.requestFile
          || receipt.requestSha256 !== await fileSha256(attempt.root, attempt.paths.requestFile)
          || receipt.responseFile !== expected.responseFile
          || receipt.responseSha256 !== await fileSha256(attempt.root, expected.responseFile)
          || receipt.stdoutFile !== expected.stdoutFile
          || receipt.stdoutSha256 !== await fileSha256(attempt.root, expected.stdoutFile)
          || receipt.stderrFile !== expected.stderrFile
          || receipt.stderrSha256 !== await fileSha256(attempt.root, expected.stderrFile)
          || receipt.profile !== request.profile
          || receipt.adapter !== request.adapter
          || receipt.requestedModel !== request.requestedModel
          || receipt.modelSource !== request.modelSource
          || receipt.workingRoot !== request.worktreePath) {
        throw new Error("Development execution receipt drifted from frozen execution evidence.");
      }
      if (receipt.status === "completed") {
        const response = await readJson(
          attempt.root,
          expected.responseFile,
          "Development execution response",
        );
        validateDevelopmentResponse(response, { request });
        if (response.status !== "completed"
            || receipt.reportedModel !== response.usage.reportedModel) {
          throw new Error("Development execution response drifted from its completed receipt.");
        }
      }
    }
    result.push({ name, claim, receipt });
  }
  return result;
}

async function verifyContextEntries(attempt, context, { allowSourceDrift = false } = {}) {
  for (const entry of context.entries) {
    if (allowSourceDrift && entry.source === "source") continue;
    const entryRoot = entry.source === "source" ? attempt.worktreePath : attempt.root;
    const currentSha = await fileSha256(entryRoot, entry.path);
    const currentBytes = (await info(entryRoot, entry.path)).info.size;
    if (currentSha !== entry.sha256 || currentBytes !== entry.bytes) {
      throw new Error(`Development Provider context entry drifted: ${entry.path}`);
    }
  }
}

async function verifyPreparedBundle(attempt, options = {}) {
  const [request, context, baseline, binding, responseSchema] = await Promise.all([
    readJson(attempt.root, attempt.paths.requestFile, "Development Provider request"),
    readJson(attempt.root, attempt.paths.contextManifestFile, "Development Provider context"),
    readJson(attempt.root, attempt.paths.baselineFile, "Development Provider baseline"),
    readJson(attempt.root, attempt.paths.bindingFile, "Development Provider binding"),
    readText(attempt.root, attempt.paths.responseSchemaFile, "Development Provider response Schema"),
  ]);
  validateDevelopmentRequest(request);
  validateDevelopmentContext(context);
  validateBinding(binding);
  const expectedBinding = bindingFor({
    request,
    context,
    baseline,
    responseSchema,
    createdAt: binding.createdAt,
  });
  if (canonicalJson(binding) !== canonicalJson(expectedBinding)) {
    throw new Error("Development Provider prepared bundle hash binding drifted.");
  }
  if (request.storyId !== attempt.state.storyId
      || request.runId !== attempt.state.runtime.runId
      || request.dispatchId !== attempt.task.dispatchId
      || request.taskId !== attempt.node.taskId
      || request.role !== attempt.task.ownerAgent
      || request.preparedRevision !== attempt.state.runtime.revision
      || request.taskFile !== attempt.taskFile
      || request.taskSha256 !== await fileSha256(attempt.root, attempt.taskFile)
      || request.taskDagFile !== attempt.state.dag.sourceFile
      || request.taskDagSha256 !== attempt.state.dag.sourceSha256
      || request.taskDagSha256 !== await fileSha256(attempt.root, attempt.state.dag.sourceFile)
      || request.worktreePlanFile !== attempt.worktreePlanFile
      || request.worktreePlanSha256 !== attempt.worktreePlanSha256
      || request.worktreeStatusFile !== attempt.worktreeStatusFile
      || request.worktreeStatusSha256 !== attempt.worktreeStatusSha256
      || request.worktreePath !== attempt.worktreePath
      || request.baseCommit !== attempt.worktreePlan.baseCommit
      || request.contextManifestFile !== attempt.paths.contextManifestFile
      || request.contextManifestSha256 !== binding.contextManifestSha256
      || request.outputSchemaFile !== attempt.paths.responseSchemaFile
      || request.outputSchemaSha256 !== binding.responseSchemaSha256) {
    throw new Error("Development Provider prepared identity or revision drifted.");
  }
  const loadedConfig = await loadProviderConfig({ root: attempt.root });
  if (loadedConfig.configSha256 !== request.configSha256) {
    throw new Error("Development Provider config hash drifted.");
  }
  const executions = await loadExecutions(attempt, request);
  const hasCandidate = await exists(attempt.root, attempt.paths.candidateManifestFile);
  await verifyContextEntries(attempt, context, {
    allowSourceDrift: executions.length > 0 || hasCandidate,
  });
  if (!executions.length && !hasCandidate) {
    const currentBaseline = await captureBaseline(attempt, options, baseline.capturedAt);
    if (canonicalJson(currentBaseline) !== canonicalJson(baseline)) {
      throw new Error("Development Provider Worktree baseline drifted.");
    }
  }
  return { request, context, baseline, binding, responseSchema, executions };
}

function sanitizePersistedValue(value, key = null) {
  if (isProviderSensitiveKey(key) && (value === null || typeof value !== "object")) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return redactProviderDiagnostic(value);
  if (Array.isArray(value)) return value.map((item) => sanitizePersistedValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, item]) => [
        entryKey,
        sanitizePersistedValue(item, entryKey),
      ]),
    );
  }
  return value;
}

function protectedBaseline(value) {
  return canonical({
    schemaVersion: value.schemaVersion,
    branch: value.branch,
    headCommit: value.headCommit,
    baseCommit: value.baseCommit,
    gitDir: value.gitDir,
    gitCommonDir: value.gitCommonDir,
    gitFileSha256: value.gitFileSha256,
    indexSha256: value.indexSha256,
    configSha256: value.configSha256,
    packedRefsSha256: value.packedRefsSha256,
    refsSha256: value.refsSha256,
    ignoredMetadataSha256: value.ignoredMetadataSha256,
    buildOutputs: value.buildOutputs,
    lockFiles: value.lockFiles,
  });
}

function pathMatchesPrefix(relativePath, prefix) {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLowerCase();
  const normalizedPrefix = prefix.replaceAll("\\", "/").toLowerCase();
  return normalizedPath === normalizedPrefix.replace(/\/$/, "")
    || normalizedPath.startsWith(normalizedPrefix.endsWith("/") ? normalizedPrefix : `${normalizedPrefix}/`);
}

async function defaultInspectChanges(worktreePath) {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: worktreePath,
      windowsHide: true,
      shell: false,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return {
    entries: parsePorcelainV1Z(stdout),
    sha256: sha256(Buffer.from(stdout, "utf8")),
  };
}

function normalizeChangeInspection(value) {
  if (Array.isArray(value)) return { entries: value, sha256: null };
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)
      || (value.sha256 !== null && value.sha256 !== undefined && !SHA.test(value.sha256))) {
    throw new Error("Development Git changes must be an array or a hashed inspection.");
  }
  return {
    entries: value.entries,
    sha256: value.sha256 ?? null,
  };
}

function candidateKind(attempt, relativePath) {
  if (attempt.task.expectedOutputs.includes(relativePath)) {
    throw new Error(`Development candidate phase output is Runtime-owned: ${relativePath}`);
  }
  if (attempt.task.ownerAgent === "backend-developer" && relativePath.startsWith("backend/")) {
    return "backend";
  }
  if (attempt.task.ownerAgent === "frontend-developer" && relativePath.startsWith("frontend/")) {
    return "frontend";
  }
  throw new Error(`Development candidate path is outside the '${attempt.task.ownerAgent}' role: ${relativePath}`);
}

async function assertNoNestedGit(worktreePath, relativePath) {
  const segments = path.dirname(relativePath).split("/").filter((item) => item && item !== ".");
  let current = worktreePath;
  for (const segment of segments) {
    current = path.join(current, segment);
    const nestedGit = await lstat(path.join(current, ".git")).catch(
      (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (nestedGit) throw new Error(`Development candidate traverses a nested Git repository: ${relativePath}`);
  }
}

function classifyChange(entry) {
  if (entry.sourcePath || ["R", "C"].includes(entry.indexStatus)
      || ["R", "C"].includes(entry.worktreeStatus)) {
    throw new Error(`Development candidate rename or copy is not supported: ${entry.path}`);
  }
  if (entry.indexStatus === "?" && entry.worktreeStatus === "?") return "create";
  if (entry.indexStatus === " " && entry.worktreeStatus === "M") return "update";
  if (entry.indexStatus === " " && entry.worktreeStatus === "D") {
    throw new Error(`Development candidate delete is not supported: ${entry.path}`);
  }
  throw new Error(
    `Development candidate has unsupported Git status '${entry.indexStatus}${entry.worktreeStatus}': ${entry.path}`,
  );
}

async function collectCandidateFiles(attempt, bundle, changes) {
  const execution = bundle.executions[0];
  const response = await readJson(
    attempt.root,
    executionPaths(attempt.paths, execution.name).responseFile,
    "Development execution response",
  );
  validateDevelopmentResponse(response, { request: bundle.request });
  const declarations = new Map(
    response.declaredFiles.map((item) => [item.path.toLowerCase(), item]),
  );
  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const entry of changes) {
    const relativePath = resolveRepositoryPath(
      attempt.worktreePath,
      entry.path,
      "Development candidate path",
    ).relative;
    const key = relativePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Development candidate path is duplicated: ${relativePath}`);
    seen.add(key);
    const changeType = classifyChange(entry);
    const declaration = declarations.get(key);
    if (!declaration) throw new Error(`Development candidate is undeclared: ${relativePath}`);
    if (declaration.changeType !== changeType) {
      throw new Error(`Development candidate declaration type does not match Git: ${relativePath}`);
    }
    const kind = candidateKind(attempt, relativePath);
    if (!bundle.request.policy.writePathPrefixes.some(
      (prefix) => pathMatchesPrefix(relativePath, prefix),
    )) {
      throw new Error(`Development candidate is outside the role write policy: ${relativePath}`);
    }
    if (kind !== "phase-output"
        && !attempt.node.predictedFiles.some((predicted) => matchesPredictedFile(predicted, relativePath))) {
      throw new Error(`Development candidate is outside task predicted files: ${relativePath}`);
    }
    await assertNoNestedGit(attempt.worktreePath, relativePath);
    const resolved = resolveRepositoryPath(
      attempt.worktreePath,
      relativePath,
      "Development candidate file",
    );
    await assertPathHasNoSymlink(attempt.worktreePath, resolved.fullPath, "Development candidate file");
    const fileInfo = await lstat(resolved.fullPath).catch(
      (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (!fileInfo) throw new Error(`Development candidate file is missing: ${relativePath}`);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new Error(`Development candidate must be a regular file: ${relativePath}`);
    }
    if (fileInfo.size > 2 * 1024 * 1024) {
      throw new Error(`Development candidate exceeds the 2 MiB file limit: ${relativePath}`);
    }
    const content = await readFile(resolved.fullPath);
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error(`Development candidate must be valid UTF-8, not binary: ${relativePath}`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > 8 * 1024 * 1024) {
      throw new Error("Development candidates exceed the 8 MiB total limit.");
    }
    files.push({
      path: relativePath,
      changeType,
      sha256: sha256(content),
      bytes: content.byteLength,
      kind,
    });
  }
  for (const declaration of response.declaredFiles) {
    if (!seen.has(declaration.path.toLowerCase())) {
      throw new Error(`Development declared file has no actual change: ${declaration.path}`);
    }
  }
  if (!files.length) throw new Error("Development Provider has no actual candidate files.");
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function diagnosticsRecord(attempt, providerExecutionId, status, diagnostics, changedPaths, createdAt) {
  return {
    schemaVersion: "1.0",
    storyId: attempt.state.storyId,
    runId: attempt.state.runtime.runId,
    dispatchId: attempt.task.dispatchId,
    taskId: attempt.node.taskId,
    providerExecutionId,
    status,
    changedPaths: [...changedPaths],
    diagnostics: [...diagnostics],
    createdAt,
  };
}

function fixedTestSelection(attempt) {
  const frontend = attempt.task.ownerAgent === "frontend-developer";
  return {
    role: attempt.task.ownerAgent,
    adapterId: frontend ? "frontend-npm" : "backend-maven",
    commandId: frontend ? "npm-build" : "maven-test",
    workingDirectory: path.join(attempt.worktreePath, frontend ? "frontend" : "backend"),
  };
}

function buildOutput(baseline, relativePath) {
  return baseline.buildOutputs.find((entry) => entry.path === relativePath) ?? null;
}

function testProtectedBaseline(value) {
  const protectedValue = protectedBaseline(value);
  delete protectedValue.buildOutputs;
  return protectedValue;
}

function assertPreparedTestFacts(before, after) {
  const beforeFacts = testProtectedBaseline(before);
  const afterFacts = testProtectedBaseline(after);
  delete beforeFacts.ignoredMetadataSha256;
  delete afterFacts.ignoredMetadataSha256;
  if (canonicalJson(afterFacts) !== canonicalJson(beforeFacts)) {
    throw new Error("Development test changed protected Worktree or Git facts.");
  }
}

function assertTestBaseline(before, after, role) {
  if (canonicalJson(testProtectedBaseline(after))
      !== canonicalJson(testProtectedBaseline(before))) {
    throw new Error("Development test changed protected Worktree or Git facts.");
  }
  if (role === "backend-developer") {
    const beforeTarget = buildOutput(before, "backend/target");
    const afterTarget = buildOutput(after, "backend/target");
    if (beforeTarget?.state !== "absent"
        || !afterTarget
        || !["absent", "baseline"].includes(afterTarget.state)) {
      throw new Error("Development backend/target build output is not trustworthy.");
    }
    return;
  }
  const beforeModules = buildOutput(before, "frontend/node_modules");
  const afterModules = buildOutput(after, "frontend/node_modules");
  const afterDist = buildOutput(after, "frontend/dist");
  if (beforeModules?.state !== "baseline"
      || !beforeModules.sha256
      || canonicalJson(afterModules) !== canonicalJson(beforeModules)
      || !afterDist
      || !["absent", "baseline"].includes(afterDist.state)) {
    throw new Error("Development frontend dependency or dist snapshot is not trustworthy.");
  }
}

function assertAdapterTrust(attempt, baseline, selection, adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)
      || typeof adapter.executablePath !== "string"
      || !path.isAbsolute(adapter.executablePath)
      || !adapter.toolchain || typeof adapter.toolchain !== "object"
      || Array.isArray(adapter.toolchain)) {
    throw new Error("Development test toolchain is invalid.");
  }
  const relative = path.relative(attempt.worktreePath, adapter.executablePath);
  if (!relative || relative === "."
      || !path.isAbsolute(relative)
        && relative !== ".."
        && !relative.startsWith(`..${path.sep}`)) {
    throw new Error("Development test executable must stay outside the task Worktree.");
  }
  if (adapter.toolchain.adapterId !== selection.adapterId) {
    throw new Error("Development test toolchain adapter identity is invalid.");
  }
  if (selection.adapterId === "frontend-npm") {
    const modules = buildOutput(baseline, "frontend/node_modules");
    if (adapter.toolchain.dependencySha256 !== modules?.sha256) {
      throw new Error("Development frontend dependency snapshot drifted.");
    }
  }
}

async function defaultInspectExecutable(executablePath, name) {
  if (!executablePath || !path.isAbsolute(executablePath)) {
    throw new Error(`Development test executable '${name}' could not be resolved.`);
  }
  const executableInfo = await lstat(executablePath).catch(
    (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
  );
  if (!executableInfo?.isFile() || executableInfo.isSymbolicLink()) {
    throw new Error(`Development test executable '${name}' is not a regular file.`);
  }
  const versionArgs = name === "java" ? ["-version"] : ["--version"];
  let versionExecutable = executablePath;
  let versionArguments = versionArgs;
  if (process.platform === "win32"
      && [".cmd", ".bat"].includes(path.extname(executablePath).toLowerCase())) {
    if (/["&|<>^%!\r\n]/.test(executablePath)) {
      throw new Error(`Development test executable '${name}' has an unsafe Windows path.`);
    }
    versionExecutable = process.env.ComSpec
      ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    versionArguments = ["/d", "/s", "/c", `"${executablePath}" ${versionArgs.join(" ")}`];
  }
  let version;
  try {
    const result = await execFileAsync(versionExecutable, versionArguments, {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    });
    version = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 4096);
  } catch (error) {
    version = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().slice(0, 4096);
    if (!version) throw new Error(`Development test executable '${name}' version check failed.`);
  }
  if (!version) throw new Error(`Development test executable '${name}' has no version identity.`);
  return {
    path: executablePath,
    version,
    sha256: sha256(await readFile(executablePath)),
  };
}

async function defaultDiscoverExecutable(name) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const { stdout } = await execFileAsync(locator, [name], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 64 * 1024,
  });
  const candidates = String(stdout)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const executablePath = process.platform === "win32"
    ? candidates.find((item) => [".cmd", ".exe"].includes(path.extname(item).toLowerCase()))
    : candidates[0];
  return defaultInspectExecutable(executablePath, name);
}

async function defaultInspectMavenRepository(parentEnv = process.env) {
  const home = parentEnv.MAVEN_USER_HOME
    ?? parentEnv.USERPROFILE
    ?? parentEnv.HOME;
  if (!home) throw new Error("Development Maven repository home is unavailable.");
  const repositoryPath = path.resolve(
    parentEnv.MAVEN_USER_HOME ? home : path.join(home, ".m2"),
    "repository",
  );
  const repositoryInfo = await lstat(repositoryPath).catch(
    (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
  );
  if (!repositoryInfo?.isDirectory() || repositoryInfo.isSymbolicLink()) {
    throw new Error("Development Maven repository is unavailable or untrusted.");
  }
  return {
    path: repositoryPath,
    identity: sha256(canonicalJson({
      path: repositoryPath.replaceAll("\\", "/"),
      modifiedMs: Math.trunc(repositoryInfo.mtimeMs),
    })),
  };
}

async function defaultDiscoverTestAdapter(attempt, selection, baseline, options) {
  const discover = options.discoverExecutable ?? defaultDiscoverExecutable;
  const parentEnv = options.parentEnv ?? process.env;
  if (selection.adapterId === "backend-maven") {
    const javaHome = parentEnv.JAVA_HOME;
    const inspectJavaHome = options.inspectJavaHomeExecutable
      ?? ((executablePath) => defaultInspectExecutable(executablePath, "java"));
    const [maven, java, repository] = await Promise.all([
      discover("mvn"),
      javaHome
        ? inspectJavaHome(path.resolve(
            javaHome,
            "bin",
            process.platform === "win32" ? "java.exe" : "java",
          ))
        : discover("java"),
      options.inspectMavenRepository
        ? options.inspectMavenRepository()
        : defaultInspectMavenRepository(parentEnv),
    ]);
    return {
      executablePath: maven.path,
      toolchain: {
        adapterId: selection.adapterId,
        mavenPath: maven.path,
        mavenVersion: maven.version,
        mavenSha256: maven.sha256,
        javaPath: java.path,
        javaVersion: java.version,
        javaSha256: java.sha256,
        repositoryPath: repository.path,
        repositoryIdentity: repository.identity,
      },
    };
  }
  const [npm, node] = await Promise.all([discover("npm"), discover("node")]);
  return {
    executablePath: npm.path,
    toolchain: {
      adapterId: selection.adapterId,
      npmPath: npm.path,
      npmVersion: npm.version,
      npmSha256: npm.sha256,
      nodePath: node.path,
      nodeVersion: node.version,
      nodeSha256: node.sha256,
      dependencySha256: buildOutput(baseline, "frontend/node_modules").sha256,
    },
  };
}

function testEnvironment(parentEnv) {
  const allowed = [
    "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC",
    "TEMP", "TMP", "USERPROFILE", "HOME", "JAVA_HOME", "MAVEN_HOME", "M2_HOME",
    "MAVEN_USER_HOME",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => typeof parentEnv[key] === "string" && parentEnv[key])
      .map((key) => [key, parentEnv[key]]),
  );
}

export async function executeSandboxedTestFile({
  executablePath,
  args,
  cwd,
  timeoutMs = 300_000,
  sandboxExecutablePath,
  parentEnv = process.env,
  executeFile = execFileAsync,
  discoverSandboxExecutable = discoverCodexExecutable,
}) {
  const startedAt = new Date().toISOString();
  try {
    const sandbox = sandboxExecutablePath ?? await discoverSandboxExecutable();
    const result = await executeFile(sandbox, [
      "sandbox",
      "-P", ":workspace",
      "-C", cwd,
      "--sandbox-state-disable-network",
      executablePath,
      ...args,
    ], {
      cwd,
      windowsHide: true,
      shell: false,
      encoding: "buffer",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: testEnvironment(parentEnv),
    });
    return {
      status: "passed",
      exitCode: 0,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.stderr ?? Buffer.alloc(0),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const outputLimit = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const timedOut = !outputLimit && Boolean(error?.killed);
    return {
      status: outputLimit
        ? "output-limit"
        : timedOut
          ? "timed-out"
          : Number.isInteger(error?.code)
            ? "failed"
            : "interrupted",
      exitCode: Number.isInteger(error?.code) ? error.code : null,
      stdout: Buffer.isBuffer(error?.stdout)
        ? error.stdout
        : Buffer.from(String(error?.stdout ?? ""), "utf8"),
      stderr: Buffer.isBuffer(error?.stderr)
        ? error.stderr
        : Buffer.from(String(error?.stderr ?? error?.message ?? ""), "utf8"),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

async function verifyCandidate(attempt, bundle, candidate, inspectChanges) {
  validateDevelopmentCandidateManifest(candidate);
  if (candidate.storyId !== attempt.state.storyId
      || candidate.runId !== attempt.state.runtime.runId
      || candidate.dispatchId !== attempt.task.dispatchId
      || candidate.taskId !== attempt.node.taskId
      || candidate.role !== attempt.task.ownerAgent
      || candidate.baseCommit !== bundle.request.baseCommit
      || candidate.worktreePath !== attempt.worktreePath
      || candidate.baselineSha256 !== sha256(canonicalJson(bundle.baseline))) {
    throw new Error("Development candidate identity drifted.");
  }
  const after = await readJson(
    attempt.root,
    attempt.paths.worktreeAfterFile,
    "Development Worktree after evidence",
  );
  if (candidate.afterSha256 !== sha256(canonicalJson(after))
      || candidate.headCommit !== after.headCommit
      || candidate.gitStatusSha256 !== after.gitStatusSha256) {
    throw new Error("Development candidate after snapshot hash drifted.");
  }
  const inspected = normalizeChangeInspection(await inspectChanges({
    worktreePath: attempt.worktreePath,
    request: bundle.request,
    baseline: bundle.baseline,
  }));
  if (inspected.sha256 !== null && inspected.sha256 !== candidate.gitStatusSha256) {
    throw new Error("Development candidate Git status hash drifted.");
  }
  const actual = inspected.entries.map((entry) => ({
    path: resolveRepositoryPath(
      attempt.worktreePath,
      entry.path,
      "Development test candidate path",
    ).relative,
    changeType: classifyChange(entry),
  })).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const expected = candidate.files.map(({ path: file, changeType }) => ({
    path: file,
    changeType,
  })).sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error("Development candidate Git changes drifted.");
  }
  const snapshot = [];
  for (const file of candidate.files) {
    const resolved = resolveRepositoryPath(
      attempt.worktreePath,
      file.path,
      "Development test candidate file",
    );
    await assertPathHasNoSymlink(
      attempt.worktreePath,
      resolved.fullPath,
      "Development test candidate file",
    );
    const content = await readFile(resolved.fullPath);
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`Development candidate file hash drifted: ${file.path}`);
    }
    snapshot.push({
      path: file.path,
      changeType: file.changeType,
      sha256: file.sha256,
      bytes: file.bytes,
    });
  }
  return sha256(canonicalJson(snapshot));
}

async function verifyTestReceipt(attempt, bundle, candidate, receipt) {
  validateDevelopmentTestReceiptBinding(receipt, {
    role: attempt.task.ownerAgent,
    worktreePath: attempt.worktreePath,
  });
  const selection = fixedTestSelection(attempt);
  assertAdapterTrust(attempt, bundle.baseline, selection, {
    executablePath: receipt.adapterId === "frontend-npm"
      ? receipt.toolchain.npmPath
      : receipt.toolchain.mavenPath,
    toolchain: receipt.toolchain,
  });
  if (receipt.storyId !== attempt.state.storyId
      || receipt.runId !== attempt.state.runtime.runId
      || receipt.dispatchId !== attempt.task.dispatchId
      || receipt.taskId !== attempt.node.taskId
      || receipt.candidateManifestFile !== attempt.paths.candidateManifestFile
      || receipt.candidateManifestSha256
        !== await fileSha256(attempt.root, attempt.paths.candidateManifestFile)
      || receipt.stdoutFile !== attempt.paths.testStdoutFile
      || receipt.stdoutSha256 !== await fileSha256(attempt.root, receipt.stdoutFile)
      || receipt.stderrFile !== attempt.paths.testStderrFile
      || receipt.stderrSha256 !== await fileSha256(attempt.root, receipt.stderrFile)) {
    throw new Error("Development test receipt identity or evidence drifted.");
  }
  if (receipt.status === "passed"
      && receipt.candidateBeforeSha256 !== receipt.candidateAfterSha256) {
    throw new Error("Development passed test receipt has candidate drift.");
  }
  return { bundle, candidate, receipt };
}

async function resultEvidenceFor(attempt, bundle, candidate, testReceipt, execution) {
  const receiptPath = executionPaths(attempt.paths, execution.name).receiptFile;
  return {
    schemaVersion: "1.0",
    storyId: attempt.state.storyId,
    runId: attempt.state.runtime.runId,
    dispatchId: attempt.task.dispatchId,
    taskId: attempt.node.taskId,
    providerRequestId: bundle.request.providerRequestId,
    providerExecutionId: execution.name,
    role: bundle.request.role,
    profile: bundle.request.profile,
    requestedModel: bundle.request.requestedModel,
    reportedModel: execution.receipt.reportedModel,
    modelSource: bundle.request.modelSource,
    configSha256: bundle.request.configSha256,
    requestFile: attempt.paths.requestFile,
    requestSha256: await fileSha256(attempt.root, attempt.paths.requestFile),
    executionReceiptFile: receiptPath,
    executionReceiptSha256: await fileSha256(attempt.root, receiptPath),
    candidateManifestFile: attempt.paths.candidateManifestFile,
    candidateManifestSha256: await fileSha256(
      attempt.root,
      attempt.paths.candidateManifestFile,
    ),
    testReceiptFile: attempt.paths.testReceiptFile,
    testReceiptSha256: await fileSha256(attempt.root, attempt.paths.testReceiptFile),
    createdAt: testReceipt.executedAt,
  };
}

function validateResultEvidence(value) {
  const fields = [
    "schemaVersion", "storyId", "runId", "dispatchId", "taskId",
    "providerRequestId", "providerExecutionId", "role", "profile",
    "requestedModel", "reportedModel", "modelSource", "configSha256",
    "requestFile", "requestSha256", "executionReceiptFile",
    "executionReceiptSha256", "candidateManifestFile", "candidateManifestSha256",
    "testReceiptFile", "testReceiptSha256", "createdAt",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n")
      || value.schemaVersion !== "1.0"
      || !SHA.test(value.configSha256)
      || !SHA.test(value.requestSha256)
      || !SHA.test(value.executionReceiptSha256)
      || !SHA.test(value.candidateManifestSha256)
      || !SHA.test(value.testReceiptSha256)) {
    throw new Error("Development Provider result evidence is invalid.");
  }
  return value;
}

async function candidateSnapshot(attempt, candidate) {
  const files = [];
  for (const file of candidate.files) {
    const target = resolveRepositoryPath(
      attempt.worktreePath,
      file.path,
      "Development finalized candidate",
    ).fullPath;
    const content = await readFile(target);
    files.push({
      path: file.path,
      changeType: file.changeType,
      sha256: sha256(content),
      bytes: content.byteLength,
    });
  }
  return sha256(canonicalJson(files));
}

async function verifyFinalizeChanges(attempt, candidate, inspectChanges) {
  const allowedGenerated = new Set(
    [attempt.task.expectedOutputs[0], attempt.task.resultFile]
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  );
  const expectedCandidates = new Set(candidate.files.map((file) => file.path.toLowerCase()));
  const actualCandidates = new Set();
  const inspected = normalizeChangeInspection(await inspectChanges({
    worktreePath: attempt.worktreePath,
  }));
  for (const entry of inspected.entries) {
    const relativePath = resolveRepositoryPath(
      attempt.worktreePath,
      entry.path,
      "Development finalize change",
    ).relative;
    classifyChange(entry);
    const key = relativePath.toLowerCase();
    if (expectedCandidates.has(key)) {
      actualCandidates.add(key);
      continue;
    }
    if (allowedGenerated.has(key) && await exists(attempt.worktreePath, relativePath)) continue;
    throw new Error(`Development finalize found an unknown Worktree change: ${relativePath}`);
  }
  if (actualCandidates.size !== expectedCandidates.size) {
    throw new Error("Development finalize candidate Git changes drifted.");
  }
  return candidateSnapshot(attempt, candidate);
}

async function verifyDevelopmentReceipt(attempt, bundle, candidate, testReceipt, receipt) {
  validateDevelopmentReceipt(receipt);
  const executions = bundle.executions.filter((item) => item.receipt?.status === "completed");
  if (executions.length !== 1) {
    throw new Error("Development Provider final receipt requires one completed execution.");
  }
  const execution = executions[0];
  const result = await readJson(
    attempt.worktreePath,
    attempt.task.resultFile,
    "Development result candidate",
  );
  validateDispatchResultStructure(result);
  const evidence = await readJson(
    attempt.root,
    attempt.paths.resultEvidenceFile,
    "Development Provider result evidence",
  );
  validateResultEvidence(evidence);
  const expectedEvidence = await resultEvidenceFor(
    attempt,
    bundle,
    candidate,
    testReceipt,
    execution,
  );
  const notesFile = attempt.task.expectedOutputs[0];
  if (canonicalJson(evidence) !== canonicalJson(expectedEvidence)
      || receipt.storyId !== attempt.state.storyId
      || receipt.runId !== attempt.state.runtime.runId
      || receipt.dispatchId !== attempt.task.dispatchId
      || receipt.taskId !== attempt.node.taskId
      || receipt.ownerAgent !== attempt.task.ownerAgent
      || receipt.providerRequestId !== bundle.request.providerRequestId
      || receipt.providerExecutionId !== execution.name
      || receipt.baseCommit !== candidate.baseCommit
      || receipt.headCommit !== candidate.headCommit
      || receipt.requestFile !== attempt.paths.requestFile
      || receipt.requestSha256 !== await fileSha256(attempt.root, receipt.requestFile)
      || receipt.executionReceiptFile !== expectedEvidence.executionReceiptFile
      || receipt.executionReceiptSha256 !== expectedEvidence.executionReceiptSha256
      || receipt.candidateManifestFile !== attempt.paths.candidateManifestFile
      || receipt.candidateManifestSha256 !== expectedEvidence.candidateManifestSha256
      || receipt.testReceiptFile !== attempt.paths.testReceiptFile
      || receipt.testReceiptSha256 !== expectedEvidence.testReceiptSha256
      || receipt.resultEvidenceFile !== attempt.task.resultFile
      || receipt.resultSha256 !== await fileSha256(attempt.worktreePath, attempt.task.resultFile)
      || receipt.contextEvidenceFile !== attempt.paths.candidateManifestFile
      || receipt.contextEvidenceSha256 !== expectedEvidence.candidateManifestSha256
      || result.dispatchId !== attempt.task.dispatchId
      || result.storyId !== attempt.state.storyId
      || result.runId !== attempt.state.runtime.runId
      || result.phase !== "implementation"
      || result.preparedRevision !== attempt.task.preparedRevision
      || result.status !== "completed"
      || result.records.length !== 1
      || result.records[0].path !== attempt.paths.resultEvidenceFile
      || result.records[0].sha256 !== await fileSha256(attempt.root, attempt.paths.resultEvidenceFile)
      || result.outputs.length !== 1
      || result.outputs[0].path !== notesFile
      || result.outputs[0].sha256 !== await fileSha256(attempt.worktreePath, notesFile)) {
    throw new Error("Development Provider final receipt or result evidence drifted.");
  }
  const expectedFiles = [
    ...candidate.files.map(({ path: file, sha256: fileSha, bytes, kind }) => ({
      path: file,
      sha256: fileSha,
      bytes,
      kind,
    })),
    {
      path: notesFile,
      sha256: await fileSha256(attempt.worktreePath, notesFile),
      bytes: (await info(attempt.worktreePath, notesFile)).info.size,
      kind: "phase-output",
    },
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (canonicalJson(receipt.files) !== canonicalJson(expectedFiles)
      || await candidateSnapshot(attempt, candidate)
        !== testReceipt.candidateAfterSha256) {
    throw new Error("Development Provider final candidate files drifted.");
  }
  return { receipt, result, evidence };
}

async function buildDevelopmentPrompt(attempt, bundle) {
  const sections = [];
  for (const entry of bundle.context.entries) {
    const entryRoot = entry.source === "source" ? attempt.worktreePath : attempt.root;
    const loaded = await info(entryRoot, entry.path);
    if (!loaded.info?.isFile() || loaded.info.isSymbolicLink()) {
      throw new Error(`Development prompt context is missing: ${entry.path}`);
    }
    const content = await readFile(loaded.fullPath);
    if (content.byteLength !== entry.bytes || sha256(content) !== entry.sha256) {
      throw new Error(`Development prompt context drifted before spawn: ${entry.path}`);
    }
    sections.push([
      `## ${entry.path}`,
      `source: ${entry.source}`,
      "",
      content.toString("utf8"),
    ].join("\n"));
  }
  const identity = {
    providerRequestId: bundle.request.providerRequestId,
    dispatchId: bundle.request.dispatchId,
    storyId: bundle.request.storyId,
    runId: bundle.request.runId,
    phase: bundle.request.phase,
    taskId: bundle.request.taskId,
    role: bundle.request.role,
  };
  return [
    `You are the FrontierScan ${bundle.request.role}.`,
    "Implement only the frozen task in the current task Worktree.",
    "Follow AGENTS.md, the frozen design, acceptance criteria, role policy, and predictedFiles.",
    "Do not modify State, prepared Provider artifacts, Git history, Git configuration, or external systems.",
    "Do not run build or test commands that generate dependency or build output directories.",
    "Return exactly one JSON object matching the frozen output Schema.",
    "Copy the frozen response identity exactly and declare every created or updated file.",
    "",
    "# Frozen response identity",
    canonicalJson(identity),
    "# Frozen context",
    sections.join("\n\n"),
  ].join("\n");
}

function responseStatus(adapterResult, request) {
  const allowed = new Set([
    "completed",
    "failed",
    "timed-out",
    "invalid-response",
    "output-limit",
    "integrity-violation",
  ]);
  let status = allowed.has(adapterResult.status) ? adapterResult.status : "invalid-response";
  let response = adapterResult.response === null || adapterResult.response === undefined
    ? null
    : sanitizePersistedValue(adapterResult.response);
  const diagnostics = (adapterResult.diagnostics ?? [])
    .map((item) => redactProviderDiagnostic(String(item)).slice(0, 2048))
    .filter(Boolean)
    .slice(0, 32);
  if (status === "completed") {
    try {
      validateDevelopmentResponse(response, { request });
      if (response.status === "failed") {
        status = "failed";
        diagnostics.push(...response.diagnostics.map((item) => redactProviderDiagnostic(item)));
      }
    } catch (error) {
      status = "invalid-response";
      diagnostics.push(error.message);
      response = null;
    }
  }
  return {
    status,
    response,
    diagnostics: [...new Set(diagnostics)].slice(0, 32),
  };
}

async function persistExecution({
  attempt,
  bundle,
  lock,
  providerExecutionId,
  adapterResult,
  finalStatus,
  response,
  diagnostics,
  beforeReceiptWrite,
}) {
  const paths = executionPaths(attempt.paths, providerExecutionId);
  const responseSource = canonicalJson(response);
  const stdoutSource = (adapterResult.rawEvents ?? [])
    .map((event) => JSON.stringify(sanitizePersistedValue(event)))
    .join("\n");
  const stdout = Buffer.from(stdoutSource ? `${stdoutSource}\n` : "");
  const stderr = Buffer.from(
    redactProviderDiagnostic(String(adapterResult.stderr ?? "")).slice(0, 2048),
    "utf8",
  );
  for (const [file, content] of [
    [paths.responseFile, responseSource],
    [paths.stdoutFile, stdout],
    [paths.stderrFile, stderr],
  ]) {
    await assertLockOwned(attempt, lock);
    await writeImmutable(attempt.root, file, content);
  }
  const receipt = {
    schemaVersion: "1.0",
    providerExecutionId,
    providerRequestId: bundle.request.providerRequestId,
    dispatchId: bundle.request.dispatchId,
    storyId: bundle.request.storyId,
    runId: bundle.request.runId,
    phase: "implementation",
    taskId: bundle.request.taskId,
    role: bundle.request.role,
    profile: bundle.request.profile,
    adapter: bundle.request.adapter,
    requestedModel: bundle.request.requestedModel,
    reportedModel: adapterResult.reportedModel ?? null,
    modelSource: bundle.request.modelSource,
    adapterVersion: adapterResult.adapterVersion ?? "codex-cli/unknown",
    sandbox: "workspace-write",
    workingRoot: bundle.request.worktreePath,
    writeIsolation: "task-worktree-workspace-write",
    requestFile: attempt.paths.requestFile,
    requestSha256: await fileSha256(attempt.root, attempt.paths.requestFile),
    responseFile: paths.responseFile,
    responseSha256: await fileSha256(attempt.root, paths.responseFile),
    stdoutFile: paths.stdoutFile,
    stdoutSha256: await fileSha256(attempt.root, paths.stdoutFile),
    stderrFile: paths.stderrFile,
    stderrSha256: await fileSha256(attempt.root, paths.stderrFile),
    startedAt: adapterResult.startedAt,
    finishedAt: adapterResult.finishedAt,
    exitCode: adapterResult.exitCode ?? null,
    status: finalStatus,
    diagnostics,
  };
  validateDevelopmentExecutionReceipt(receipt);
  await beforeReceiptWrite?.();
  await assertLockOwned(attempt, lock);
  await writeImmutable(attempt.root, paths.receiptFile, canonicalJson(receipt));
  return receipt;
}

async function deriveStatus(attempt, options = {}) {
  const lock = await readLock(attempt);
  if (lock) {
    const processExists = options.processExists ?? defaultProcessExists;
    if (!processExists(lock.parentPid) && !processExists(lock.childPid)) {
      return {
        status: "development-provider-lock-recovery-required",
        lockId: lock.lockId,
        command: lock.command,
        lockSha256: await fileSha256(attempt.root, attempt.paths.lockFile),
      };
    }
    return {
      status: "development-provider-run-in-progress",
      lockId: lock.lockId,
      command: lock.command,
    };
  }
  if (!await exists(attempt.root, attempt.paths.preparedRoot)) {
    return { status: "development-provider-not-prepared" };
  }
  const bundle = await verifyPreparedBundle(attempt, options);
  const receipt = await readOptionalJson(
    attempt.root,
    attempt.paths.developmentReceiptFile,
    "Development Provider final receipt",
  );
  const candidate = await readOptionalJson(
    attempt.root,
    attempt.paths.candidateManifestFile,
    "Development candidate manifest",
  );
  const providerDiagnostics = await readOptionalJson(
    attempt.root,
    attempt.paths.diagnosticsFile,
    "Development Provider diagnostics",
  );
  const testReceipt = await readOptionalJson(
    attempt.root,
    attempt.paths.testReceiptFile,
    "Development test receipt",
  );
  const adapterSelection = await readOptionalJson(
    attempt.root,
    attempt.paths.adapterSelectionFile,
    "Development adapter selection",
  );
  if (receipt) {
    if (!candidate || !testReceipt) {
      throw new Error("Development Provider final receipt requires candidate and test evidence.");
    }
    await verifyTestReceipt(attempt, bundle, candidate, testReceipt);
    if (testReceipt.status !== "passed") {
      throw new Error("Development Provider final receipt requires a passed test.");
    }
    await verifyDevelopmentReceipt(attempt, bundle, candidate, testReceipt, receipt);
    return { status: "development-provider-ready-for-integration" };
  }
  if (testReceipt) {
    if (!candidate) throw new Error("Development test receipt requires a candidate manifest.");
    await verifyTestReceipt(attempt, bundle, candidate, testReceipt);
    return testReceipt.status === "passed"
      ? { status: "development-provider-finalize-required" }
      : { status: "development-provider-failed" };
  }
  if (providerDiagnostics?.status === "recovery-required" && !candidate) {
    return {
      status: "development-provider-recovery-required",
      providerExecutionId: providerDiagnostics.providerExecutionId,
      diagnostics: providerDiagnostics.diagnostics,
    };
  }
  if (adapterSelection?.status === "required") return { status: "adapter-selection-required" };
  if (candidate) {
    validateDevelopmentCandidateManifest(candidate);
    return { status: "development-provider-test-required" };
  }
  if (bundle.executions.length > 1) throw new Error("Development Provider has multiple executions.");
  if (bundle.executions.length === 1) {
    const execution = bundle.executions[0];
    if (execution.claim && !execution.receipt) {
      return { status: "development-provider-indeterminate" };
    }
    if (!execution.receipt) throw new Error("Development Provider execution is incomplete.");
    if (execution.receipt.status === "completed") {
      return {
        status: "development-provider-materialize-required",
        providerExecutionId: execution.name,
        providerRequestId: bundle.request.providerRequestId,
      };
    }
    return {
      status: "development-provider-failed",
      providerExecutionId: execution.name,
      latestExecutionStatus: execution.receipt.status,
      providerRequestId: bundle.request.providerRequestId,
    };
  }
  return {
    status: "development-provider-ready",
    providerRequestId: bundle.request.providerRequestId,
  };
}

export async function inspectDevelopmentProvider(options) {
  try {
    const attempt = await loadAttempt(options);
    return {
      storyId: attempt.state.storyId,
      runId: attempt.state.runtime.runId,
      dispatchId: attempt.task.dispatchId,
      taskId: attempt.node.taskId,
      role: attempt.task.ownerAgent,
      ...(await deriveStatus(attempt, options)),
    };
  } catch (error) {
    if (error instanceof WorktreeRequiredError) {
      return { status: "development-worktree-required", diagnostics: [error.message] };
    }
    return {
      status: "development-provider-invalid",
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function assertSameOverride(request, resolved, options) {
  if (options.profile === undefined && options.model === undefined) return;
  if (request.profile !== resolved.profile
      || request.requestedModel !== resolved.requestedModel
      || request.modelSource !== resolved.modelSource
      || canonicalJson(request.modelProvider) !== canonicalJson(resolved.modelProvider)) {
    throw new Error("Development Provider is already prepared; runtime overrides cannot change.");
  }
}

export async function runDevelopmentProvider(options) {
  const attempt = await loadAttempt(options);
  if (await readLock(attempt)) {
    throw new Error("Development Provider lock is active; Run cannot start.");
  }
  if (!await exists(attempt.root, attempt.paths.preparedRoot)) {
    throw new Error("Development Provider Run requires a complete prepared bundle.");
  }
  const frozenRequest = await readJson(
    attempt.root,
    attempt.paths.requestFile,
    "Development Provider request",
  );
  validateDevelopmentRequest(frozenRequest);
  const providerExecutionId = randomUUID();
  await withLock(
    attempt,
    "run",
    options,
    async (lock) => {
      const bundle = await verifyPreparedBundle(attempt, options);
      if (bundle.executions.length) {
        const indeterminate = bundle.executions.some((item) => item.claim && !item.receipt);
        throw new Error(indeterminate
          ? "Development Provider execution is indeterminate and cannot be rerun."
          : "Development Provider request already has an execution and cannot be rerun.");
      }
      const paths = executionPaths(attempt.paths, providerExecutionId);
      const claim = {
        schemaVersion: "1.0",
        providerExecutionId,
        providerRequestId: bundle.request.providerRequestId,
        dispatchId: bundle.request.dispatchId,
        storyId: bundle.request.storyId,
        runId: bundle.request.runId,
        phase: "implementation",
        taskId: bundle.request.taskId,
        role: bundle.request.role,
        worktreePath: bundle.request.worktreePath,
        claimedAt: (options.now ?? (() => new Date().toISOString()))(),
      };
      validateExecutionClaim(claim);
      await assertLockOwned(attempt, lock);
      await writeImmutable(attempt.root, paths.claimFile, canonicalJson(claim));
      await options.afterClaimWrite?.();
      const prompt = await buildDevelopmentPrompt(attempt, bundle);
      const adapter = options.adapter ?? runCodexDevelopmentCli;
      let adapterResult;
      try {
        adapterResult = await adapter({
          prompt,
          outputSchemaFile: resolveRepositoryPath(
            attempt.root,
            attempt.paths.responseSchemaFile,
            "Development response Schema",
          ).fullPath,
          outputSchemaSha256: bundle.request.outputSchemaSha256,
          preparedRoot: resolveRepositoryPath(
            attempt.root,
            attempt.paths.preparedRoot,
            "Development prepared root",
          ).fullPath,
          worktreePath: attempt.worktreePath,
          request: bundle.request,
          model: bundle.request.requestedModel,
          modelProvider: bundle.request.modelProvider,
          timeoutMs: options.timeoutMs,
          executablePath: options.executablePath,
          onSpawn: async (childPid) => updateLock(attempt, lock, { childPid }),
          now: options.now,
        });
      } catch (error) {
        const failedAt = (options.now ?? (() => new Date().toISOString()))();
        adapterResult = {
          adapter: "codex-cli",
          adapterVersion: "codex-cli/unknown",
          requestedModel: bundle.request.requestedModel,
          reportedModel: null,
          startedAt: failedAt,
          finishedAt: failedAt,
          exitCode: null,
          status: "failed",
          response: null,
          rawEvents: [],
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          diagnostics: [`Development Provider adapter failed: ${error.message}`],
          worktreePath: bundle.request.worktreePath,
        };
      }
      const classified = responseStatus(adapterResult, bundle.request);
      let finalStatus = classified.status;
      const diagnostics = [...classified.diagnostics];
      try {
        const after = await captureBaseline(attempt, options, bundle.baseline.capturedAt);
        if (canonicalJson(protectedBaseline(after))
            !== canonicalJson(protectedBaseline(bundle.baseline))) {
          finalStatus = "integrity-violation";
          diagnostics.push("Protected Worktree or Git baseline changed during Provider execution.");
        }
      } catch (error) {
        finalStatus = "integrity-violation";
        diagnostics.push(`Development post-execution baseline failed: ${error.message}`);
      }
      if (path.resolve(adapterResult.worktreePath ?? "") !== path.resolve(bundle.request.worktreePath)) {
        finalStatus = "integrity-violation";
        diagnostics.push("Development Adapter reported a different Worktree.");
      }
      await persistExecution({
        attempt,
        bundle,
        lock,
        providerExecutionId,
        adapterResult,
        finalStatus,
        response: classified.response,
        diagnostics: [...new Set(diagnostics)].slice(0, 32),
        beforeReceiptWrite: options.beforeExecutionReceiptWrite,
      });
    },
    {
      providerRequestId: frozenRequest.providerRequestId,
      providerExecutionId,
    },
  );
  return {
    ...(await inspectDevelopmentProvider(options)),
    providerExecutionId,
  };
}

export async function materializeDevelopmentProvider(options) {
  const attempt = await loadAttempt(options);
  const current = await deriveStatus(attempt, options);
  if (current.status === "development-provider-test-required") {
    return { ...current, materialized: false };
  }
  if (current.status === "development-provider-recovery-required") {
    return { ...current, materialized: false };
  }
  if (current.status !== "development-provider-materialize-required") {
    throw new Error(`Development Provider Materialize is not allowed from status '${current.status}'.`);
  }
  const providerExecutionId = current.providerExecutionId;
  const materialized = await withLock(
    attempt,
    "materialize",
    options,
    async (lock) => {
      const bundle = await verifyPreparedBundle(attempt, options);
      const completed = bundle.executions.filter(
        (item) => item.receipt?.status === "completed",
      );
      if (completed.length !== 1 || completed[0].name !== providerExecutionId) {
        throw new Error("Development Provider Materialize requires one completed execution.");
      }
      const existingAfter = await readOptionalJson(
        attempt.root,
        attempt.paths.worktreeAfterFile,
        "Development Worktree after evidence",
      );
      const createdAt = existingAfter?.capturedAt
        ?? (options.now ?? (() => new Date().toISOString()))();
      const captureAfter = options.captureAfter
        ?? options.captureBaseline
        ?? captureDevelopmentBaseline;
      const after = await captureAfter({
        worktreePath: attempt.worktreePath,
        baseCommit: attempt.worktreePlan.baseCommit,
        predictedFiles: attempt.node.predictedFiles,
        buildOutputPaths: buildOutputPaths(attempt.task.ownerAgent),
        lockPaths: [".git/index.lock", ".git/config.lock"],
        now: () => createdAt,
      });
      const inspectChanges = options.inspectChanges
        ?? (() => defaultInspectChanges(attempt.worktreePath));
      const inspected = normalizeChangeInspection(await inspectChanges({
        worktreePath: attempt.worktreePath,
        request: bundle.request,
        baseline: bundle.baseline,
      }));
      const changes = inspected.entries;
      const changedPaths = changes.map((entry) => entry.path);
      let candidate = null;
      let failure = null;
      try {
        if (canonicalJson(protectedBaseline(after))
            !== canonicalJson(protectedBaseline(bundle.baseline))) {
          throw new Error("Development protected Git or ignored baseline changed after execution.");
        }
        if (inspected.sha256 !== null && inspected.sha256 !== after.gitStatusSha256) {
          throw new Error("Development Git status hash does not match the after snapshot.");
        }
        const files = await collectCandidateFiles(attempt, bundle, changes);
        candidate = {
          schemaVersion: "1.0",
          storyId: attempt.state.storyId,
          runId: attempt.state.runtime.runId,
          dispatchId: attempt.task.dispatchId,
          taskId: attempt.node.taskId,
          role: attempt.task.ownerAgent,
          baseCommit: bundle.request.baseCommit,
          headCommit: after.headCommit,
          worktreePath: attempt.worktreePath,
          baselineSha256: sha256(canonicalJson(bundle.baseline)),
          afterSha256: sha256(canonicalJson(after)),
          gitStatusSha256: after.gitStatusSha256,
          files,
          totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
          createdAt,
        };
        validateDevelopmentCandidateManifest(candidate);
        await options.beforeCandidateWrite?.();
        const confirmedInspection = normalizeChangeInspection(await inspectChanges({
          worktreePath: attempt.worktreePath,
          request: bundle.request,
          baseline: bundle.baseline,
        }));
        if (canonicalJson(confirmedInspection) !== canonicalJson(inspected)) {
          throw new Error("Development Git changes drifted before candidate commit.");
        }
        for (const file of files) {
          const fullPath = resolveRepositoryPath(
            attempt.worktreePath,
            file.path,
            "Development candidate recheck",
          ).fullPath;
          const content = await readFile(fullPath);
          if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) {
            throw new Error(`Development candidate drifted before commit: ${file.path}`);
          }
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
      await assertLockOwned(attempt, lock);
      await writeImmutable(
        attempt.root,
        attempt.paths.worktreeAfterFile,
        canonicalJson(after),
      );
      const diagnostics = diagnosticsRecord(
        attempt,
        providerExecutionId,
        failure ? "recovery-required" : "passed",
        failure ? [failure.message] : [],
        changedPaths,
        createdAt,
      );
      await assertLockOwned(attempt, lock);
      await writeImmutable(
        attempt.root,
        attempt.paths.diagnosticsFile,
        canonicalJson(diagnostics),
      );
      if (failure) {
        return {
          status: "development-provider-recovery-required",
          providerExecutionId,
          diagnostics: diagnostics.diagnostics,
          materialized: false,
        };
      }
      await assertLockOwned(attempt, lock);
      await writeImmutable(
        attempt.root,
        attempt.paths.candidateManifestFile,
        canonicalJson(candidate),
      );
      return {
        status: "development-provider-test-required",
        providerExecutionId,
        materialized: true,
      };
    },
    {
      providerRequestId: current.providerRequestId ?? null,
      providerExecutionId,
    },
  );
  if (materialized.status === "development-provider-recovery-required") return materialized;
  return {
    ...(await inspectDevelopmentProvider(options)),
    providerExecutionId,
    materialized: materialized.materialized,
  };
}

export async function testDevelopmentProvider(options) {
  const attempt = await loadAttempt(options);
  const current = await deriveStatus(attempt, options);
  if (current.status === "development-provider-finalize-required"
      || current.status === "development-provider-failed") {
    return { ...current, tested: false };
  }
  if (!["development-provider-test-required", "adapter-selection-required"].includes(current.status)) {
    throw new Error(`Development Provider Test is not allowed from status '${current.status}'.`);
  }
  return withLock(
    attempt,
    "test",
    options,
    async (lock) => {
      const bundle = await verifyPreparedBundle(attempt, options);
      const candidate = await readJson(
        attempt.root,
        attempt.paths.candidateManifestFile,
        "Development candidate manifest",
      );
      const inspectChanges = options.inspectChanges
        ?? (() => defaultInspectChanges(attempt.worktreePath));
      const candidateBeforeSha256 = await verifyCandidate(
        attempt,
        bundle,
        candidate,
        inspectChanges,
      );
      const selection = fixedTestSelection(attempt);
      const captureTestBaseline = options.captureTestBaseline
        ?? options.captureBaseline
        ?? captureDevelopmentBaseline;
      const beforeTest = await captureTestBaseline({
        worktreePath: attempt.worktreePath,
        baseCommit: attempt.worktreePlan.baseCommit,
        predictedFiles: attempt.node.predictedFiles,
        buildOutputPaths: buildOutputPaths(attempt.task.ownerAgent),
        ignoredExcludePrefixes: buildOutputPaths(attempt.task.ownerAgent),
        lockPaths: [".git/index.lock", ".git/config.lock"],
        now: options.now,
      });
      const missingFrontendDependencies = attempt.task.ownerAgent === "frontend-developer"
        && buildOutput(beforeTest, "frontend/node_modules")?.state !== "baseline";
      if (missingFrontendDependencies) {
        assertPreparedTestFacts(bundle.baseline, beforeTest);
      } else {
        assertPreparedTestFacts(bundle.baseline, beforeTest);
        assertTestBaseline(
          {
            ...bundle.baseline,
            ignoredMetadataSha256: beforeTest.ignoredMetadataSha256,
          },
          beforeTest,
          attempt.task.ownerAgent,
        );
      }
      let adapter = null;
      const discoverAdapter = async () => {
        if (options.discoverTestAdapter) {
          return options.discoverTestAdapter(structuredClone(selection));
        }
        return defaultDiscoverTestAdapter(
          attempt,
          selection,
          beforeTest,
          options,
        ).catch(() => null);
      };
      if (!missingFrontendDependencies) {
        adapter = await discoverAdapter();
      }
      if (!adapter) {
        const evidence = {
          schemaVersion: "1.0",
          storyId: attempt.state.storyId,
          runId: attempt.state.runtime.runId,
          dispatchId: attempt.task.dispatchId,
          taskId: attempt.node.taskId,
          ...selection,
          status: "required",
          createdAt: (options.now ?? (() => new Date().toISOString()))(),
        };
        await assertLockOwned(attempt, lock);
        await writeImmutable(
          attempt.root,
          attempt.paths.adapterSelectionFile,
          canonicalJson(evidence),
        );
        return { status: "adapter-selection-required", tested: false };
      }
      assertAdapterTrust(attempt, beforeTest, selection, adapter);
      adapter = structuredClone(adapter);
      const result = await (options.executeTest
        ?? options.executeTestFile
        ?? executeSandboxedTestFile)({
        executablePath: adapter.executablePath,
        args: selection.adapterId === "backend-maven" ? ["test"] : ["run", "build"],
        cwd: selection.workingDirectory,
        timeoutMs: options.timeoutMs,
        sandboxExecutablePath: options.sandboxExecutablePath,
        parentEnv: options.parentEnv,
        executeFile: options.executeTestProcess,
        discoverSandboxExecutable: options.discoverSandboxExecutable,
      });
      let status = ["passed", "failed", "timed-out", "output-limit", "interrupted"]
        .includes(result.status)
        ? result.status
        : "failed";
      let candidateAfterSha256 = candidateBeforeSha256;
      try {
        candidateAfterSha256 = await verifyCandidate(
          attempt,
          bundle,
          candidate,
          inspectChanges,
        );
        const after = await captureTestBaseline({
          worktreePath: attempt.worktreePath,
          baseCommit: attempt.worktreePlan.baseCommit,
          predictedFiles: attempt.node.predictedFiles,
          buildOutputPaths: buildOutputPaths(attempt.task.ownerAgent),
          ignoredExcludePrefixes: buildOutputPaths(attempt.task.ownerAgent),
          lockPaths: [".git/index.lock", ".git/config.lock"],
          now: options.now,
        });
        assertTestBaseline(beforeTest, after, attempt.task.ownerAgent);
        const afterAdapter = await discoverAdapter();
        assertAdapterTrust(attempt, after, selection, afterAdapter);
        if (canonicalJson(afterAdapter) !== canonicalJson(adapter)) {
          throw new Error("Development test toolchain drifted during execution.");
        }
      } catch {
        status = "failed";
        candidateAfterSha256 = await Promise.all(candidate.files.map(async (file) => {
          const target = resolveRepositoryPath(
            attempt.worktreePath,
            file.path,
            "Development changed test candidate",
          ).fullPath;
          const content = await readFile(target).catch(() => Buffer.alloc(0));
          return { path: file.path, sha256: sha256(content), bytes: content.byteLength };
        })).then((files) => sha256(canonicalJson(files)));
      }
      let stdout = Buffer.isBuffer(result.stdout)
        ? result.stdout
        : Buffer.from(String(result.stdout ?? ""), "utf8");
      let stderr = Buffer.isBuffer(result.stderr)
        ? result.stderr
        : Buffer.from(String(result.stderr ?? ""), "utf8");
      if (stdout.byteLength > 4 * 1024 * 1024 || stderr.byteLength > 1024 * 1024) {
        status = "output-limit";
        stdout = stdout.subarray(0, 4 * 1024 * 1024);
        stderr = stderr.subarray(0, 1024 * 1024);
      }
      await assertLockOwned(attempt, lock);
      await writeImmutable(attempt.root, attempt.paths.testStdoutFile, stdout);
      await assertLockOwned(attempt, lock);
      await writeImmutable(attempt.root, attempt.paths.testStderrFile, stderr);
      const receipt = {
        schemaVersion: "1.0",
        storyId: attempt.state.storyId,
        runId: attempt.state.runtime.runId,
        dispatchId: attempt.task.dispatchId,
        taskId: attempt.node.taskId,
        candidateManifestFile: attempt.paths.candidateManifestFile,
        candidateManifestSha256: await fileSha256(
          attempt.root,
          attempt.paths.candidateManifestFile,
        ),
        adapterId: selection.adapterId,
        commandId: selection.commandId,
        workingDirectory: attempt.task.ownerAgent === "frontend-developer"
          ? "frontend"
          : "backend",
        toolchain: adapter.toolchain,
        toolchainSha256: developmentToolchainSha256(adapter.toolchain),
        status,
        exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
        stdoutFile: attempt.paths.testStdoutFile,
        stdoutSha256: sha256(stdout),
        stderrFile: attempt.paths.testStderrFile,
        stderrSha256: sha256(stderr),
        candidateBeforeSha256,
        candidateAfterSha256,
        executedAt: result.finishedAt
          ?? (options.now ?? (() => new Date().toISOString()))(),
      };
      validateDevelopmentTestReceipt(receipt);
      await assertLockOwned(attempt, lock);
      await writeImmutable(
        attempt.root,
        attempt.paths.testReceiptFile,
        canonicalJson(receipt),
      );
      return {
        status: status === "passed"
          ? "development-provider-finalize-required"
          : "development-provider-failed",
        tested: true,
      };
    },
    { providerRequestId: current.providerRequestId ?? null },
  );
}

export async function finalizeDevelopmentProvider(options) {
  const attempt = await loadAttempt(options);
  const current = await deriveStatus(attempt, options);
  if (current.status === "development-provider-ready-for-integration") {
    return { ...current, finalized: false };
  }
  if (current.status !== "development-provider-finalize-required") {
    throw new Error(`Development Provider Finalize is not allowed from status '${current.status}'.`);
  }
  return withLock(
    attempt,
    "finalize",
    options,
    async (lock) => {
      const bundle = await verifyPreparedBundle(attempt, options);
      const candidate = await readJson(
        attempt.root,
        attempt.paths.candidateManifestFile,
        "Development candidate manifest",
      );
      const testReceipt = await readJson(
        attempt.root,
        attempt.paths.testReceiptFile,
        "Development test receipt",
      );
      await verifyTestReceipt(attempt, bundle, candidate, testReceipt);
      if (testReceipt.status !== "passed") {
        throw new Error("Development Provider Finalize requires a passed test receipt.");
      }
      const completed = bundle.executions.filter(
        (item) => item.receipt?.status === "completed",
      );
      if (completed.length !== 1) {
        throw new Error("Development Provider Finalize requires one completed execution.");
      }
      const execution = completed[0];
      const response = await readJson(
        attempt.root,
        executionPaths(attempt.paths, execution.name).responseFile,
        "Development execution response",
      );
      validateDevelopmentResponse(response, { request: bundle.request });
      const inspectChanges = options.inspectChanges
        ?? (() => defaultInspectChanges(attempt.worktreePath));
      if (await verifyFinalizeChanges(attempt, candidate, inspectChanges)
          !== testReceipt.candidateAfterSha256) {
        throw new Error("Development candidate drifted after its passed test.");
      }
      const evidence = await resultEvidenceFor(
        attempt,
        bundle,
        candidate,
        testReceipt,
        execution,
      );
      validateResultEvidence(evidence);
      await assertLockOwned(attempt, lock);
      await writeImmutable(
        attempt.root,
        attempt.paths.resultEvidenceFile,
        canonicalJson(evidence),
      );
      const notesFile = attempt.task.expectedOutputs[0];
      const notes = [
        "# 实施记录",
        "",
        `- 任务：${attempt.node.taskId} ${attempt.node.title}`,
        `- 角色：${attempt.task.ownerAgent}`,
        `- 开发方法：${response.developmentMethod}`,
        `- 结果：${response.summary}`,
        `- 候选文件：${candidate.files.map((file) => file.path).join("、")}`,
        `- 固定测试：${testReceipt.adapterId}/${testReceipt.commandId} 已通过`,
        "",
      ].join("\n");
      await assertLockOwned(attempt, lock);
      await writeImmutable(attempt.worktreePath, notesFile, notes);
      await options.beforeResultWrite?.();
      const notesBuffer = Buffer.from(notes, "utf8");
      const evidenceBuffer = await readFile(
        resolveRepositoryPath(
          attempt.root,
          attempt.paths.resultEvidenceFile,
          "Development result evidence",
        ).fullPath,
      );
      const result = {
        schemaVersion: "2.0",
        dispatchId: attempt.task.dispatchId,
        storyId: attempt.state.storyId,
        runId: attempt.state.runtime.runId,
        phase: "implementation",
        preparedRevision: attempt.task.preparedRevision,
        status: "completed",
        summary: response.summary,
        outputs: [{
          path: notesFile,
          sha256: sha256(notesBuffer),
          bytes: notesBuffer.byteLength,
        }],
        records: [{
          type: "note",
          status: "recorded",
          path: attempt.paths.resultEvidenceFile,
          sha256: sha256(evidenceBuffer),
          bytes: evidenceBuffer.byteLength,
          message: "Development Provider request、execution、candidate 与 passed test 证据投影。",
          actor: "development-provider-runtime",
        }],
        payload: {
          taskUpdates: [{ taskId: attempt.node.taskId, status: "done" }],
          actualFiles: candidate.files
            .filter((file) => file.kind !== "phase-output")
            .map((file) => file.path),
          method: response.developmentMethod,
          exceptionReason: response.tddExceptionReason,
          notes: [response.summary],
        },
      };
      validateDispatchResultStructure(result);
      await assertLockOwned(attempt, lock);
      await writeImmutable(attempt.worktreePath, attempt.task.resultFile, canonicalJson(result));
      await options.beforeReceiptWrite?.();
      const receiptFiles = [
        ...candidate.files.map(({ path: file, sha256: fileSha, bytes, kind }) => ({
          path: file,
          sha256: fileSha,
          bytes,
          kind,
        })),
        {
          path: notesFile,
          sha256: sha256(notesBuffer),
          bytes: notesBuffer.byteLength,
          kind: "phase-output",
        },
      ].sort((left, right) => left.path.localeCompare(right.path, "en"));
      const receipt = {
        schemaVersion: "1.0",
        executorKind: "development-provider",
        storyId: attempt.state.storyId,
        runId: attempt.state.runtime.runId,
        dispatchId: attempt.task.dispatchId,
        taskId: attempt.node.taskId,
        phase: "implementation",
        ownerAgent: attempt.task.ownerAgent,
        providerRequestId: bundle.request.providerRequestId,
        providerExecutionId: execution.name,
        baseCommit: candidate.baseCommit,
        headCommit: candidate.headCommit,
        outcome: "ready-for-integration",
        requestFile: attempt.paths.requestFile,
        requestSha256: await fileSha256(attempt.root, attempt.paths.requestFile),
        executionReceiptFile: evidence.executionReceiptFile,
        executionReceiptSha256: evidence.executionReceiptSha256,
        candidateManifestFile: attempt.paths.candidateManifestFile,
        candidateManifestSha256: evidence.candidateManifestSha256,
        testReceiptFile: attempt.paths.testReceiptFile,
        testReceiptSha256: evidence.testReceiptSha256,
        resultEvidenceFile: attempt.task.resultFile,
        resultSha256: await fileSha256(attempt.worktreePath, attempt.task.resultFile),
        contextEvidenceFile: attempt.paths.candidateManifestFile,
        contextEvidenceSha256: evidence.candidateManifestSha256,
        files: receiptFiles,
        completedAt: (options.now ?? (() => new Date().toISOString()))(),
      };
      validateDevelopmentReceipt(receipt);
      await assertLockOwned(attempt, lock);
      await writeImmutable(
        attempt.root,
        attempt.paths.developmentReceiptFile,
        canonicalJson(receipt),
      );
      return {
        status: "development-provider-ready-for-integration",
        finalized: true,
      };
    },
    { providerRequestId: current.providerRequestId ?? null },
  );
}

export async function recoverDevelopmentProvider(options) {
  const attempt = await loadAttempt(options);
  if (!SHA.test(options.expectedLockSha256 ?? "")) {
    throw new Error("Development Provider Recover requires ExpectedLockSha256.");
  }
  const lock = await readLock(attempt);
  if (!lock) throw new Error("Development Provider lock does not exist.");
  const currentSha256 = await fileSha256(attempt.root, attempt.paths.lockFile);
  if (currentSha256 !== options.expectedLockSha256) {
    throw new Error("Development Provider lock hash drifted.");
  }
  const processExists = options.processExists ?? defaultProcessExists;
  if (processExists(lock.parentPid) || processExists(lock.childPid)) {
    throw new Error("Development Provider lock owner process is still alive.");
  }
  const confirmed = await readLock(attempt);
  if (!confirmed || confirmed.lockId !== lock.lockId
      || await fileSha256(attempt.root, attempt.paths.lockFile) !== currentSha256) {
    throw new Error("Development Provider lock fencing rejected recovery.");
  }
  await unlink((await info(attempt.root, attempt.paths.lockFile)).fullPath);
  const recoveredAt = (options.now ?? (() => new Date().toISOString()))();
  const recovery = {
    schemaVersion: "1.0",
    storyId: attempt.state.storyId,
    runId: attempt.state.runtime.runId,
    dispatchId: attempt.task.dispatchId,
    taskId: attempt.node.taskId,
    recoveredLockId: lock.lockId,
    lockSha256: currentSha256,
    command: lock.command,
    recoveredAt,
    reason: "caller confirmed the prior owner stopped and supplied the current lock hash",
  };
  const recoveryPath = (await info(attempt.root, attempt.paths.lockRecoveryFile)).fullPath;
  await mkdir(path.dirname(recoveryPath), { recursive: true });
  await appendFile(recoveryPath, `${JSON.stringify(recovery)}\n`, "utf8");
  return {
    ...(await inspectDevelopmentProvider(options)),
    recoveredLockId: lock.lockId,
    recoveryFile: attempt.paths.lockRecoveryFile,
  };
}

export async function prepareDevelopmentProvider(options) {
  const attempt = await loadAttempt(options);
  const current = await deriveStatus(attempt, options);
  if (current.status === "development-provider-ready") {
    const bundle = await verifyPreparedBundle(attempt, options);
    const loaded = await loadProviderConfig({ root: attempt.root });
    const resolved = resolveProviderProfile({
      loaded,
      role: attempt.task.ownerAgent,
      profile: options.profile,
      model: options.model,
    });
    assertSameOverride(bundle.request, resolved, options);
    return {
      ...current,
      providerRequestId: bundle.request.providerRequestId,
      prepared: false,
    };
  }
  if (current.status !== "development-provider-not-prepared") {
    if (current.status === "development-provider-run-in-progress") {
      throw new Error("Development Provider lock is active; Prepare cannot run concurrently.");
    }
    throw new Error(`Development Provider Prepare is not allowed from status '${current.status}'.`);
  }
  return withLock(attempt, "prepare", options, async (lock) => {
    const loaded = await loadProviderConfig({ root: attempt.root });
    const resolved = resolveProviderProfile({
      loaded,
      role: attempt.task.ownerAgent,
      profile: options.profile,
      model: options.model,
    });
    if (resolved.adapter !== "codex-cli") {
      throw new Error("Development Provider only supports codex-cli.");
    }
    const policy = (await loadWorkerPolicies({ root: attempt.root })).get(attempt.task.ownerAgent);
    if (!policy) throw new Error(`Development Provider policy is missing for '${attempt.task.ownerAgent}'.`);
    const createdAt = (options.now ?? (() => new Date().toISOString()))();
    const baseline = await captureBaseline(attempt, options, createdAt);
    const candidate = await createDevelopmentContextCandidate({
      root: attempt.root,
      state: attempt.state,
      task: attempt.task,
      taskFile: attempt.taskFile,
      worktreePlan: attempt.worktreePlan,
      worktreePlanSha256: attempt.worktreePlanSha256,
      worktreeStatus: attempt.worktreeStatus,
      worktreeStatusSha256: attempt.worktreeStatusSha256,
      worktreePath: attempt.worktreePath,
      sourceRoot: attempt.worktreePath,
      policy,
      baseline,
      now: () => createdAt,
    });
    const stateProjection = generatedStateProjection(attempt);
    const responseSchema = await readText(
      attempt.root,
      ".harness/schemas/agent-development-response.schema.json",
      "Development response Schema",
    );
    const request = {
      schemaVersion: "1.0",
      providerRequestId: randomUUID(),
      dispatchId: attempt.task.dispatchId,
      storyId: attempt.state.storyId,
      runId: attempt.state.runtime.runId,
      phase: "implementation",
      preparedRevision: attempt.state.runtime.revision,
      taskId: attempt.node.taskId,
      role: attempt.task.ownerAgent,
      profile: resolved.profile,
      adapter: resolved.adapter,
      requestedModel: resolved.requestedModel,
      modelSource: resolved.modelSource,
      modelProvider: resolved.modelProvider,
      configSha256: resolved.configSha256,
      taskFile: attempt.taskFile,
      taskSha256: await fileSha256(attempt.root, attempt.taskFile),
      taskDagFile: attempt.state.dag.sourceFile,
      taskDagSha256: attempt.state.dag.sourceSha256,
      worktreePlanFile: attempt.worktreePlanFile,
      worktreePlanSha256: attempt.worktreePlanSha256,
      worktreeStatusFile: attempt.worktreeStatusFile,
      worktreeStatusSha256: attempt.worktreeStatusSha256,
      worktreePath: attempt.worktreePath,
      baseCommit: attempt.worktreePlan.baseCommit,
      policy,
      contextManifestFile: attempt.paths.contextManifestFile,
      contextManifestSha256: sha256(canonicalJson(candidate.manifest)),
      outputSchemaFile: attempt.paths.responseSchemaFile,
      outputSchemaSha256: sha256(responseSchema),
      createdAt,
    };
    validateDevelopmentRequest(request);
    const binding = bindingFor({
      request,
      context: candidate.manifest,
      baseline,
      responseSchema,
      createdAt,
    });
    const temporaryRoot = `${attempt.paths.preparedRoot}.tmp-${randomUUID()}`;
    try {
      await writeTempBundle(attempt, temporaryRoot, {
        stateProjection,
        policy,
        context: candidate.manifest,
        responseSchema,
        baseline,
        request,
        binding,
      });
      await options.beforePreparedRename?.();
      await assertLockOwned(attempt, lock);
      await rename(
        resolveRepositoryPath(attempt.root, temporaryRoot, "Development temporary bundle").fullPath,
        resolveRepositoryPath(attempt.root, attempt.paths.preparedRoot, "Development prepared bundle").fullPath,
      );
    } finally {
      await rm(
        resolveRepositoryPath(attempt.root, temporaryRoot, "Development temporary bundle").fullPath,
        { recursive: true, force: true },
      );
    }
    await verifyPreparedBundle(attempt, options);
    return {
      status: "development-provider-ready",
      providerRequestId: request.providerRequestId,
      prepared: true,
    };
  });
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  if (!["status", "prepare", "run", "materialize", "test", "finalize", "recover"].includes(command)) {
    throw new Error(`Unsupported Development Provider command: ${command ?? "(missing)"}`);
  }
  const options = { command };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    const key = token === "--root"
      ? "root"
      : token === "--state-file"
        ? "stateFile"
        : token === "--profile"
          ? "profile"
        : token === "--model"
            ? "model"
            : token === "--expected-lock-sha256"
              ? "expectedLockSha256"
            : null;
    if (!key || index + 1 >= tokens.length) {
      throw new Error(`Unsupported or incomplete argument: ${token}`);
    }
    options[key] = tokens[index + 1];
    index += 1;
  }
  if (command !== "prepare" && (options.profile !== undefined || options.model !== undefined)) {
    throw new Error("Profile and Model are only supported by Prepare.");
  }
  if ((command === "recover") !== (options.expectedLockSha256 !== undefined)) {
    throw new Error("ExpectedLockSha256 is required by Recover and unsupported by other commands.");
  }
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const handlers = {
      status: inspectDevelopmentProvider,
      prepare: prepareDevelopmentProvider,
      run: runDevelopmentProvider,
      materialize: materializeDevelopmentProvider,
      test: testDevelopmentProvider,
      finalize: finalizeDevelopmentProvider,
      recover: recoverDevelopmentProvider,
    };
    const result = await handlers[options.command](options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Development Provider status '${result.status}' for ${result.storyId ?? "(unknown)"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`Development Provider command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
