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
  rmdir,
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
import { loadProviderConfig, resolveProviderProfile } from "./provider-config.mjs";
import {
  buildProviderInlineData,
  createProviderContextCandidate,
} from "./provider-context.mjs";
import {
  mapProviderResponseToReview,
  validateProviderContext,
  validateProviderExecutionReceipt,
  validateProviderRequest,
  validateProviderResponse,
} from "./provider-contract.mjs";
import {
  isProviderSensitiveKey,
  redactProviderDiagnostic,
  runCodexCli,
} from "./provider-adapters/codex-cli.mjs";
import { parsePorcelainV1Z } from "./state-runtime.mjs";
import {
  loadWorkerPolicies,
  readBoundedUtf8,
  resolveRepositoryPath,
} from "./worker-runtime.mjs";

const execFileAsync = promisify(execFile);
const PROMPT_TEMPLATE_VERSION = "1.1";
const PROMPT_TEMPLATE = [
  "You are the FrontierScan code-reviewer.",
  "Review only the frozen context included below.",
  "Do not open, search, or cite paths outside that context.",
  "Do not modify files, State, Git, or external systems.",
  "Return exactly one JSON object that matches the provided output Schema.",
  "Copy every field from the frozen response identity exactly into the response.",
  "Findings must be current, reproducible, and limited to reviewTargets.",
].join("\n");
const DEFAULT_EXECUTION_TIMEOUT_MS = 180_000;
const DEFAULT_COMMAND_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_MUTATION_LOCK_TIMEOUT_MS = 30_000;
const STALE_LOCK_GRACE_MS = 5_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

class IndeterminateProviderExecutionError extends Error {
  constructor({ claim, claimFile, claimSha256, receiptFile }) {
    super("Provider execution is indeterminate because its claim has no receipt.");
    this.claim = claim;
    this.claimFile = claimFile;
    this.claimSha256 = claimSha256;
    this.receiptFile = receiptFile;
  }
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function normalizePath(value, label) {
  return resolveRepositoryPath(".", value, label).relative;
}

async function pathInfo(root, relativePath) {
  const fullPath = resolveRepositoryPath(root, relativePath, "Provider path").fullPath;
  const info = await lstat(fullPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  return { fullPath, info };
}

async function pathExists(root, relativePath) {
  return (await pathInfo(root, relativePath)).info !== null;
}

async function readText(root, relativePath, label) {
  const loaded = await readBoundedUtf8(root, relativePath, label);
  return loaded.content;
}

async function readJson(root, relativePath, label) {
  const source = await readText(root, relativePath, label);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

async function readJsonSnapshot(root, relativePath, label) {
  const loaded = await readBoundedUtf8(root, relativePath, label);
  try {
    return {
      value: JSON.parse(loaded.content),
      source: loaded.content,
      sha256: loaded.sha256,
    };
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

async function readOptionalJson(root, relativePath, label) {
  if (!await pathExists(root, relativePath)) return null;
  return readJson(root, relativePath, label);
}

async function fileSha256(root, relativePath) {
  const fullPath = resolveRepositoryPath(root, relativePath, "Provider hash path").fullPath;
  return sha256(await readFile(fullPath));
}

async function writeAtomic(root, relativePath, content) {
  const fullPath = resolveRepositoryPath(root, relativePath, "Provider write path").fullPath;
  await mkdir(path.dirname(fullPath), { recursive: true });
  const temporary = `${fullPath}.tmp-${randomUUID()}`;
  await writeFile(temporary, content);
  try {
    await rename(temporary, fullPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeImmutable(root, relativePath, content) {
  const existing = await pathInfo(root, relativePath);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (existing.info) {
    if (!existing.info.isFile() || existing.info.isSymbolicLink()) {
      throw new Error(`Provider immutable target must be a regular file: ${relativePath}`);
    }
    const current = await readFile(existing.fullPath);
    if (!current.equals(buffer)) throw new Error(`Provider immutable artifact drifted: ${relativePath}`);
    return false;
  }
  await writeAtomic(root, relativePath, buffer);
  return true;
}

async function replaceAtomic(root, relativePath, content, beforeRename) {
  const fullPath = resolveRepositoryPath(root, relativePath, "Provider result path").fullPath;
  await mkdir(path.dirname(fullPath), { recursive: true });
  const temporary = `${fullPath}.tmp-${randomUUID()}`;
  await writeFile(temporary, content);
  try {
    await beforeRename?.();
    await rename(temporary, fullPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function promptTemplateSha256() {
  return sha256(PROMPT_TEMPLATE);
}

function pointerFileForState(stateFile) {
  return ".harness/states/active-run.json";
}

function eventsFileForState(state) {
  return `.harness/states/e2e-${state.storyId}.events.jsonl`;
}

export function providerPaths(task) {
  const providerRoot = `${task.attemptRoot}/provider`;
  const preparedRoot = `${providerRoot}/prepared`;
  return {
    providerRoot,
    preparedRoot,
    requestFile: `${preparedRoot}/request.json`,
    requestBindingFile: `${preparedRoot}/request-binding.json`,
    contextManifestFile: `${providerRoot}/context-manifest.json`,
    lockFile: `${providerRoot}/provider.lock`,
    mutationLockFile: `${providerRoot}/provider-mutation.lock`,
    lockRecoveryFile: `${providerRoot}/lock-recoveries.jsonl`,
    executionsRoot: `${providerRoot}/executions`,
    evidenceFile: `${task.attemptRoot}/evidence/provider-review-response.json`,
    indeterminateEvidenceFile:
      `${task.attemptRoot}/evidence/provider-execution-indeterminate.json`,
  };
}

async function loadActiveAttempt({ root, stateFile }) {
  const repositoryRoot = path.resolve(root);
  const state = await readJson(repositoryRoot, stateFile, "Provider State");
  if (state.schemaVersion !== "2.0" || state.phase !== "code-review"
      || state.runtime?.status !== "active") {
    throw new Error("Provider requires an active State v2 code-review phase.");
  }
  const activeAttemptFile = `.harness/runs/${state.runtime.runId}/phases/05-code-review/active-attempt.json`;
  const activeAttempt = await readJson(repositoryRoot, activeAttemptFile, "Provider active attempt");
  const task = await readJson(repositoryRoot, activeAttempt.taskFile, "Provider task");
  validateDispatchTaskStructure(task);
  if (task.ownerAgent !== "code-reviewer" || task.phase !== "code-review") {
    throw new Error("Provider task must belong to code-reviewer/code-review.");
  }
  if (task.storyId !== state.storyId || task.runId !== state.runtime.runId
      || task.dispatchId !== activeAttempt.dispatchId
      || task.preparedRevision !== state.runtime.revision
      || activeAttempt.preparedRevision !== state.runtime.revision) {
    throw new Error("Provider task identity or revision does not match State.");
  }
  if (activeAttempt.taskFile !== `${task.attemptRoot}/task.json`
      || activeAttempt.resultFile !== task.resultFile
      || activeAttempt.checkpointFile !== task.checkpointFile) {
    throw new Error("Provider active attempt paths do not match task identity.");
  }
  return {
    root: repositoryRoot,
    state,
    stateFile: normalizePath(stateFile, "Provider State file"),
    activeAttempt,
    activeAttemptFile,
    task,
    taskFile: activeAttempt.taskFile,
    paths: providerPaths(task),
  };
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

function validateLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)
      || lock.schemaVersion !== "1.0"
      || typeof lock.lockId !== "string"
      || typeof lock.dispatchId !== "string"
      || !["prepare", "run", "materialize"].includes(lock.command)
      || !Number.isInteger(lock.parentPid)
      || (lock.childPid !== null && !Number.isInteger(lock.childPid))
      || (lock.providerExecutionId !== null && typeof lock.providerExecutionId !== "string")
      || typeof lock.startedAt !== "string" || Number.isNaN(Date.parse(lock.startedAt))
      || !Number.isInteger(lock.timeoutMs) || lock.timeoutMs < 1) {
    throw new Error("Provider lock has an invalid structure.");
  }
}

async function readLock(root, paths) {
  const lock = await readOptionalJson(root, paths.lockFile, "Provider lock");
  if (lock) validateLock(lock);
  return lock;
}

async function appendLockRecovery(root, paths, value) {
  const fullPath = resolveRepositoryPath(root, paths.lockRecoveryFile, "Provider lock recovery").fullPath;
  await mkdir(path.dirname(fullPath), { recursive: true });
  await appendFile(fullPath, `${JSON.stringify(value)}\n`, "utf8");
}

function validateMutationLock(owner) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)
      || owner.schemaVersion !== "1.0"
      || typeof owner.mutationId !== "string"
      || !Number.isInteger(owner.parentPid) || owner.parentPid <= 0
      || typeof owner.startedAt !== "string" || Number.isNaN(Date.parse(owner.startedAt))
      || !Number.isInteger(owner.timeoutMs) || owner.timeoutMs < 1) {
    throw new Error("Provider lock mutation guard has an invalid structure.");
  }
}

async function readMutationLock(root, paths) {
  const owner = await readOptionalJson(
    root,
    `${paths.mutationLockFile}/owner.json`,
    "Provider lock mutation guard",
  );
  if (owner) validateMutationLock(owner);
  return owner;
}

async function recoverMutationLock({
  root,
  paths,
  fullPath,
  now,
  processExists,
}) {
  let owner;
  try {
    owner = await readMutationLock(root, paths);
  } catch (error) {
    const info = await lstat(fullPath);
    const age = Date.parse(now()) - info.mtimeMs;
    if (age <= DEFAULT_MUTATION_LOCK_TIMEOUT_MS + STALE_LOCK_GRACE_MS) {
      throw new Error(`Provider lock mutation guard is invalid and not stale: ${error.message}`);
    }
    await unlink(resolveRepositoryPath(
      root,
      `${paths.mutationLockFile}/owner.json`,
      "Provider lock mutation guard owner",
    ).fullPath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    });
    await rmdir(fullPath);
    await appendLockRecovery(root, paths, {
      schemaVersion: "1.0",
      recoveredMutationId: null,
      recoveredAt: now(),
      reason: "mutation guard owner was invalid after the stale window",
    });
    return;
  }
  if (!owner) {
    const info = await lstat(fullPath);
    const age = Date.parse(now()) - info.mtimeMs;
    if (age <= DEFAULT_MUTATION_LOCK_TIMEOUT_MS + STALE_LOCK_GRACE_MS) {
      throw new Error("Provider lock mutation guard is active and not stale.");
    }
    await rmdir(fullPath);
    await appendLockRecovery(root, paths, {
      schemaVersion: "1.0",
      recoveredMutationId: null,
      recoveredAt: now(),
      reason: "mutation guard owner was absent after the stale window",
    });
    return;
  }
  if (processExists(owner.parentPid)) {
    throw new Error("Provider lock mutation guard is still active because its parent process is alive.");
  }
  const age = Date.parse(now()) - Date.parse(owner.startedAt);
  if (age <= owner.timeoutMs + STALE_LOCK_GRACE_MS) {
    throw new Error("Provider lock mutation guard is active and not stale.");
  }
  const confirmed = await readMutationLock(root, paths);
  if (!confirmed || confirmed.mutationId !== owner.mutationId) {
    throw new Error("Provider lock mutation guard fencing rejected stale recovery.");
  }
  await unlink(resolveRepositoryPath(
    root,
    `${paths.mutationLockFile}/owner.json`,
    "Provider lock mutation guard owner",
  ).fullPath);
  await rmdir(fullPath);
  await appendLockRecovery(root, paths, {
    schemaVersion: "1.0",
    recoveredMutationId: owner.mutationId,
    recoveredAt: now(),
    reason: "mutation guard parent process was absent after the stale window",
  });
}

async function releaseMutationLock(root, paths, owner) {
  const current = await readMutationLock(root, paths);
  if (!current || current.mutationId !== owner.mutationId) {
    throw new Error("Provider lock mutation guard fencing rejected release.");
  }
  await unlink(resolveRepositoryPath(
    root,
    `${paths.mutationLockFile}/owner.json`,
    "Provider lock mutation guard owner",
  ).fullPath);
  await rmdir(resolveRepositoryPath(
    root,
    paths.mutationLockFile,
    "Provider lock mutation guard",
  ).fullPath);
}

async function withLockMutationGuard(root, paths, options, action) {
  const fullPath = resolveRepositoryPath(
    root,
    paths.mutationLockFile,
    "Provider lock mutation guard",
  ).fullPath;
  await mkdir(path.dirname(fullPath), { recursive: true });
  const now = options.now ?? (() => new Date().toISOString());
  const processExists = options.processExists ?? defaultProcessExists;
  const owner = {
    schemaVersion: "1.0",
    mutationId: randomUUID(),
    parentPid: process.pid,
    startedAt: now(),
    timeoutMs: DEFAULT_MUTATION_LOCK_TIMEOUT_MS,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temporaryPath = `${fullPath}.tmp-${randomUUID()}`;
    try {
      await mkdir(temporaryPath);
      await writeFile(path.join(temporaryPath, "owner.json"), canonicalJson(owner), {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, fullPath);
      try {
        return await action();
      } finally {
        await releaseMutationLock(root, paths, owner);
      }
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      if (!await pathExists(root, paths.mutationLockFile)) throw error;
      await recoverMutationLock({
        root,
        paths,
        fullPath,
        now,
        processExists,
      });
    }
  }
  throw new Error("Provider lock mutation guard could not be acquired.");
}

async function createLockFile(fullPath, lock) {
  let handle;
  try {
    handle = await open(fullPath, "wx");
    await handle.writeFile(canonicalJson(lock), "utf8");
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
  await handle.close();
}

async function acquireLock({
  root,
  task,
  paths,
  command,
  providerRequestId,
  providerExecutionId = null,
  timeoutMs,
  now,
  processExists,
}) {
  const fullPath = resolveRepositoryPath(root, paths.lockFile, "Provider lock").fullPath;
  await mkdir(path.dirname(fullPath), { recursive: true });
  return withLockMutationGuard(root, paths, { now, processExists }, async () => {
    const lock = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      dispatchId: task.dispatchId,
      providerRequestId,
      command,
      parentPid: process.pid,
      childPid: null,
      providerExecutionId,
      startedAt: now(),
      timeoutMs,
    };
    const existing = await readLock(root, paths);
    if (!existing) {
      await createLockFile(fullPath, lock);
      return lock;
    }
    const parentAlive = processExists(existing.parentPid);
    const childAlive = processExists(existing.childPid);
    if (parentAlive || childAlive) {
      const actor = childAlive ? "child process" : "parent process";
      throw new Error(`Provider ${existing.command} lock is still active because its ${actor} is alive.`);
    }
    const age = Date.parse(now()) - Date.parse(existing.startedAt);
    if (age <= existing.timeoutMs + STALE_LOCK_GRACE_MS) {
      throw new Error(`Provider ${existing.command} lock is active and not stale.`);
    }
    await unlink(fullPath);
    await appendLockRecovery(root, paths, {
      schemaVersion: "1.0",
      recoveredLockId: existing.lockId,
      recoveredAt: now(),
      reason: "parent and child processes were absent after the stale window",
    });
    await createLockFile(fullPath, lock);
    return lock;
  });
}

async function assertLockOwned(root, paths, lock) {
  const current = await readLock(root, paths);
  if (!current || current.lockId !== lock.lockId) {
    throw new Error("Provider lock fencing rejected an expired holder.");
  }
}

async function updateLock(root, paths, lock, changes, options = {}) {
  await withLockMutationGuard(root, paths, options, async () => {
    await assertLockOwned(root, paths, lock);
    const next = { ...lock, ...changes };
    validateLock(next);
    await replaceAtomic(root, paths.lockFile, canonicalJson(next));
    Object.assign(lock, next);
  });
}

async function releaseLock(root, paths, lock, options = {}) {
  await withLockMutationGuard(root, paths, options, async () => {
    const current = await readLock(root, paths);
    if (!current) return;
    if (current.lockId !== lock.lockId) throw new Error("Provider lock fencing rejected release.");
    await unlink(resolveRepositoryPath(root, paths.lockFile, "Provider lock").fullPath);
  });
}

async function withProviderLock(options, command, action) {
  const attempt = await loadActiveAttempt(options);
  const lock = await acquireLock({
    root: options.root,
    task: attempt.task,
    paths: attempt.paths,
    command,
    providerRequestId: options.providerRequestId ?? null,
    providerExecutionId: options.providerExecutionId ?? null,
    timeoutMs: options.timeoutMs ?? (
      command === "run" ? DEFAULT_EXECUTION_TIMEOUT_MS : DEFAULT_COMMAND_LOCK_TIMEOUT_MS
    ),
    now: options.now ?? (() => new Date().toISOString()),
    processExists: options.processExists ?? defaultProcessExists,
  });
  try {
    return await action({ ...attempt, lock });
  } finally {
    await releaseLock(options.root, attempt.paths, lock, options);
  }
}

async function verifyContextEntries(root, context) {
  for (const entry of context.entries) {
    const content = await readFile(resolveRepositoryPath(root, entry.path, "Provider context entry").fullPath);
    if (content.byteLength !== entry.bytes || sha256(content) !== entry.sha256) {
      throw new Error(`Provider context entry drifted: ${entry.path}`);
    }
  }
}

function validateRequestBinding(binding) {
  const allowedKeys = [
    "createdAt",
    "providerRequestId",
    "requestSha256",
    "schemaVersion",
  ];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
      || Object.keys(binding).sort().join("\n") !== allowedKeys.sort().join("\n")
      || binding.schemaVersion !== "1.0"
      || typeof binding.providerRequestId !== "string"
      || !SHA256_PATTERN.test(binding.requestSha256)
      || typeof binding.createdAt !== "string" || Number.isNaN(Date.parse(binding.createdAt))) {
    throw new Error("Provider request binding has an invalid structure.");
  }
}

function validateExecutionClaim(claim) {
  const allowedKeys = [
    "claimedAt",
    "dispatchId",
    "phase",
    "providerExecutionId",
    "providerRequestId",
    "role",
    "runId",
    "schemaVersion",
    "storyId",
  ];
  if (!claim || typeof claim !== "object" || Array.isArray(claim)
      || Object.keys(claim).sort().join("\n") !== allowedKeys.sort().join("\n")
      || claim.schemaVersion !== "1.0"
      || typeof claim.providerExecutionId !== "string"
      || typeof claim.providerRequestId !== "string"
      || typeof claim.dispatchId !== "string"
      || typeof claim.storyId !== "string"
      || typeof claim.runId !== "string"
      || claim.phase !== "code-review"
      || claim.role !== "code-reviewer"
      || typeof claim.claimedAt !== "string" || Number.isNaN(Date.parse(claim.claimedAt))) {
    throw new Error("Provider execution claim has an invalid structure.");
  }
}

async function writePreparedRequestBundle(root, paths, request, beforeRename) {
  const requestSource = canonicalJson(request);
  const binding = {
    schemaVersion: "1.0",
    providerRequestId: request.providerRequestId,
    requestSha256: sha256(requestSource),
    createdAt: request.createdAt,
  };
  validateRequestBinding(binding);
  const temporaryRoot = `${paths.providerRoot}/prepared.tmp-${randomUUID()}`;
  const resolvedTemporary = resolveRepositoryPath(
    root,
    temporaryRoot,
    "Provider prepared request staging",
  ).fullPath;
  const resolvedPrepared = resolveRepositoryPath(
    root,
    paths.preparedRoot,
    "Provider prepared request",
  ).fullPath;
  await mkdir(resolvedTemporary, { recursive: true });
  try {
    await writeFile(path.join(resolvedTemporary, "request.json"), requestSource, "utf8");
    await writeFile(
      path.join(resolvedTemporary, "request-binding.json"),
      canonicalJson(binding),
      "utf8",
    );
    await beforeRename?.();
    await rename(resolvedTemporary, resolvedPrepared);
  } catch (error) {
    await rm(resolvedTemporary, { recursive: true, force: true });
    throw error;
  }
}

async function currentConfigResolution(root, request) {
  const loaded = await loadProviderConfig({ root });
  if (loaded.configSha256 !== request.configSha256) {
    throw new Error("Provider config hash drifted after Prepare.");
  }
  const selected = loaded.config.profiles[request.profile];
  if (!selected || selected.adapter !== request.adapter) {
    throw new Error("Provider profile or adapter drifted after Prepare.");
  }
  const configuredModelSource = loaded.sources.profiles[request.profile];
  if (request.modelSource !== "runtime-override"
      && (request.modelSource !== configuredModelSource
        || request.requestedModel !== selected.model)) {
    throw new Error("Provider model resolution drifted after Prepare.");
  }
  return {
    resolvedModel: request.requestedModel,
    modelProvider: request.modelProvider,
    modelSource: request.modelSource,
  };
}

async function verifyPreparedBundle(attempt) {
  const { root, paths, task, taskFile } = attempt;
  const request = await readJson(root, paths.requestFile, "Provider request");
  validateProviderRequest(request);
  const binding = await readJson(root, paths.requestBindingFile, "Provider request binding");
  validateRequestBinding(binding);
  if (binding.providerRequestId !== request.providerRequestId
      || binding.createdAt !== request.createdAt
      || binding.requestSha256 !== await fileSha256(root, paths.requestFile)) {
    throw new Error("Provider request binding or hash drifted after Prepare.");
  }
  if (request.dispatchId !== task.dispatchId || request.storyId !== task.storyId
      || request.runId !== task.runId || request.preparedRevision !== task.preparedRevision
      || request.taskFile !== taskFile) {
    throw new Error("Provider request identity does not match the active task.");
  }
  if (request.taskSha256 !== await fileSha256(root, taskFile)) {
    throw new Error("Provider task hash drifted after Prepare.");
  }
  const context = await readJson(root, paths.contextManifestFile, "Provider context manifest");
  validateProviderContext(context);
  if (request.contextManifestFile !== paths.contextManifestFile
      || request.contextManifestSha256 !== await fileSha256(root, paths.contextManifestFile)) {
    throw new Error("Provider context manifest hash drifted after Prepare.");
  }
  if (request.outputSchemaSha256 !== await fileSha256(root, request.outputSchemaFile)) {
    throw new Error("Provider output Schema hash drifted after Prepare.");
  }
  if (request.promptTemplateVersion !== PROMPT_TEMPLATE_VERSION
      || request.promptTemplateSha256 !== promptTemplateSha256()) {
    throw new Error("Provider prompt template drifted after Prepare.");
  }
  await verifyContextEntries(root, context);
  const model = await currentConfigResolution(root, request);
  return { request, context, model };
}

async function executionDirectories(root, paths) {
  const fullPath = resolveRepositoryPath(root, paths.executionsRoot, "Provider executions").fullPath;
  const info = await lstat(fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Provider executions root must be a real directory.");
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

async function loadExecutionReceipts(attempt, bundle) {
  const receipts = [];
  const indeterminate = [];
  for (const providerExecutionId of await executionDirectories(attempt.root, attempt.paths)) {
    const executionRoot = `${attempt.paths.executionsRoot}/${providerExecutionId}`;
    const receiptFile = `${executionRoot}/execution-receipt.json`;
    const claimFile = `${executionRoot}/execution-claim.json`;
    const claimExists = await pathExists(attempt.root, claimFile);
    const receiptExists = await pathExists(attempt.root, receiptFile);
    let claim = null;
    let claimSha256 = null;
    if (claimExists) {
      const snapshot = await readJsonSnapshot(
        attempt.root,
        claimFile,
        "Provider execution claim",
      );
      claim = snapshot.value;
      claimSha256 = snapshot.sha256;
      validateExecutionClaim(claim);
      if (claim.providerExecutionId !== providerExecutionId
          || claim.providerRequestId !== bundle.request.providerRequestId
          || claim.dispatchId !== bundle.request.dispatchId
          || claim.storyId !== bundle.request.storyId
          || claim.runId !== bundle.request.runId) {
        throw new Error("Provider execution claim drifted from its frozen request.");
      }
    }
    if (!receiptExists) {
      if (claim) {
        indeterminate.push({ claim, claimFile, claimSha256, receiptFile });
      }
      continue;
    }
    const receipt = await readJson(attempt.root, receiptFile, "Provider execution receipt");
    validateProviderExecutionReceipt(receipt);
    if (receipt.providerExecutionId !== providerExecutionId
        || receipt.providerRequestId !== bundle.request.providerRequestId
        || receipt.requestSha256 !== await fileSha256(attempt.root, attempt.paths.requestFile)
        || receipt.contextManifestSha256 !== await fileSha256(attempt.root, attempt.paths.contextManifestFile)
        || receipt.profile !== bundle.request.profile
        || receipt.adapter !== bundle.request.adapter
        || receipt.configSha256 !== bundle.request.configSha256
        || canonicalJson(receipt.modelProvider) !== canonicalJson(bundle.request.modelProvider)
        || receipt.requestedModel !== bundle.request.requestedModel
        || receipt.resolvedModel !== bundle.model.resolvedModel
        || receipt.modelSource !== bundle.model.modelSource
        || receipt.promptTemplateVersion !== bundle.request.promptTemplateVersion
        || receipt.promptTemplateSha256 !== bundle.request.promptTemplateSha256) {
      throw new Error("Provider execution receipt drifted from its frozen request.");
    }
    let response = null;
    if (receipt.responseFile !== null) {
      if (!receipt.responseFile.startsWith(`${executionRoot}/`)) {
        throw new Error("Provider execution response is outside its execution directory.");
      }
      if (receipt.responseSha256 !== await fileSha256(attempt.root, receipt.responseFile)) {
        throw new Error("Provider execution response hash drifted.");
      }
      response = await readJson(attempt.root, receipt.responseFile, "Provider execution response");
      validateProviderResponse(response, { context: bundle.context });
      if (response.providerRequestId !== bundle.request.providerRequestId
          || response.dispatchId !== bundle.request.dispatchId
          || response.storyId !== bundle.request.storyId
          || response.runId !== bundle.request.runId
          || response.phase !== bundle.request.phase
          || response.role !== bundle.request.role) {
        throw new Error("Provider execution response identity drifted from its frozen request.");
      }
    }
    receipts.push({ receipt, response, executionRoot, receiptFile });
  }
  if (indeterminate.length > 1) {
    throw new Error("Provider request has multiple indeterminate execution claims.");
  }
  if (indeterminate.length === 1) {
    throw new IndeterminateProviderExecutionError(indeterminate[0]);
  }
  return receipts.sort((left, right) => left.receipt.finishedAt.localeCompare(right.receipt.finishedAt));
}

function indeterminateEvidenceIdentity(bundle, error) {
  return {
    schemaVersion: "1.0",
    providerExecutionId: error.claim.providerExecutionId,
    providerRequestId: bundle.request.providerRequestId,
    dispatchId: bundle.request.dispatchId,
    storyId: bundle.request.storyId,
    runId: bundle.request.runId,
    phase: "code-review",
    role: "code-reviewer",
    claimFile: error.claimFile,
    claimSha256: error.claimSha256,
    receiptFile: error.receiptFile,
    receiptStatus: "missing",
    liveProcessStatus: "not-detected",
    conclusion:
      "The Runtime cannot determine whether the model received the request; this frozen request must not be retried.",
  };
}

function validateIndeterminateEvidence(evidence, identity) {
  const expectedFields = [...Object.keys(identity), "detectedAt"].sort();
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)
      || Object.keys(evidence).sort().join("\n") !== expectedFields.join("\n")
      || !evidence.detectedAt || Number.isNaN(Date.parse(evidence.detectedAt))) {
    throw new Error("Provider indeterminate execution evidence is invalid.");
  }
  for (const [key, value] of Object.entries(identity)) {
    if (evidence[key] !== value) {
      if (key === "claimSha256" || key === "claimFile") {
        throw new Error("Provider execution claim drifted from indeterminate evidence.");
      }
      throw new Error("Provider indeterminate execution evidence drifted.");
    }
  }
}

async function readIndeterminateEvidence(attempt, bundle, error) {
  if (!await pathExists(attempt.root, attempt.paths.indeterminateEvidenceFile)) return null;
  const snapshot = await readJsonSnapshot(
    attempt.root,
    attempt.paths.indeterminateEvidenceFile,
    "Provider indeterminate execution evidence",
  );
  validateIndeterminateEvidence(
    snapshot.value,
    indeterminateEvidenceIdentity(bundle, error),
  );
  return snapshot;
}

async function deriveProviderStatus(attempt, { processExists = defaultProcessExists } = {}) {
  const requestExists = await pathExists(attempt.root, attempt.paths.requestFile);
  if (!requestExists) {
    if (await pathExists(attempt.root, attempt.paths.preparedRoot)) {
      return {
        status: "provider-invalid",
        storyId: attempt.state.storyId,
        dispatchId: attempt.task.dispatchId,
        diagnostics: ["Provider prepared request directory is incomplete or invalid."],
      };
    }
    return {
      status: "provider-not-prepared",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
    };
  }
  let bundle;
  try {
    bundle = await verifyPreparedBundle(attempt);
  } catch (error) {
    return {
      status: "provider-invalid",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
      diagnostics: [error.message],
    };
  }
  const lock = await readLock(attempt.root, attempt.paths);
  if (lock && lock.command === "run"
      && (processExists(lock.parentPid) || processExists(lock.childPid))) {
    return {
      status: "provider-run-in-progress",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
      providerRequestId: bundle.request.providerRequestId,
      providerExecutionId: lock.providerExecutionId,
    };
  }
  if (await pathExists(attempt.root, attempt.task.resultFile)) {
    try {
      const result = await readJson(attempt.root, attempt.task.resultFile, "Provider materialized result");
      validateDispatchResultStructure(result);
      if (result.dispatchId !== attempt.task.dispatchId
          || result.storyId !== attempt.task.storyId
          || result.runId !== attempt.task.runId
          || result.phase !== "code-review") {
        throw new Error("Provider materialized result identity drifted.");
      }
      return {
        status: "provider-materialized",
        storyId: attempt.state.storyId,
        dispatchId: attempt.task.dispatchId,
        providerRequestId: bundle.request.providerRequestId,
      };
    } catch (error) {
      return {
        status: "provider-invalid",
        storyId: attempt.state.storyId,
        dispatchId: attempt.task.dispatchId,
        diagnostics: [error.message],
      };
    }
  }
  let executions;
  try {
    executions = await loadExecutionReceipts(attempt, bundle);
  } catch (error) {
    if (error instanceof IndeterminateProviderExecutionError) {
      try {
        await readIndeterminateEvidence(attempt, bundle, error);
      } catch (evidenceError) {
        return {
          status: "provider-invalid",
          storyId: attempt.state.storyId,
          dispatchId: attempt.task.dispatchId,
          diagnostics: [evidenceError.message],
        };
      }
      return {
        status: "provider-execution-indeterminate",
        storyId: attempt.state.storyId,
        dispatchId: attempt.task.dispatchId,
        providerRequestId: bundle.request.providerRequestId,
        providerExecutionId: error.claim.providerExecutionId,
        claimFile: error.claimFile,
        diagnostics: [error.message],
      };
    }
    return {
      status: "provider-invalid",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
      diagnostics: [error.message],
    };
  }
  const successful = executions.filter((item) => item.receipt.status === "completed");
  if (successful.length > 1) {
    return {
      status: "provider-invalid",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
      diagnostics: ["Provider request has multiple successful executions."],
    };
  }
  if (successful.length === 1) {
    return {
      status: "provider-materialize-required",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
      providerRequestId: bundle.request.providerRequestId,
      providerExecutionId: successful[0].receipt.providerExecutionId,
    };
  }
  if (executions.length) {
    const latest = executions.at(-1).receipt;
    return {
      status: "provider-failed",
      storyId: attempt.state.storyId,
      dispatchId: attempt.task.dispatchId,
      providerRequestId: bundle.request.providerRequestId,
      providerExecutionId: latest.providerExecutionId,
      latestExecutionStatus: latest.status,
      diagnostics: latest.diagnostics,
    };
  }
  return {
    status: "provider-ready",
    storyId: attempt.state.storyId,
    dispatchId: attempt.task.dispatchId,
    providerRequestId: bundle.request.providerRequestId,
  };
}

export async function inspectProvider(options) {
  const attempt = await loadActiveAttempt(options);
  return deriveProviderStatus(attempt, options);
}

export async function prepareProvider(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await loadActiveAttempt({ root, stateFile: options.stateFile });
  if (await pathExists(root, initial.paths.requestFile)) {
    if (options.profile !== undefined || options.model !== undefined) {
      throw new Error("Provider is already prepared; Profile or Model cannot change after Prepare.");
    }
    const status = await deriveProviderStatus(initial, options);
    if (status.status === "provider-invalid") throw new Error(status.diagnostics.join("; "));
    return { ...status, prepared: false };
  }
  return withProviderLock(
    { ...options, root, providerRequestId: null },
    "prepare",
    async (attempt) => {
      if (await pathExists(root, attempt.paths.requestFile)) {
        return {
          ...(await deriveProviderStatus(attempt, options)),
          prepared: false,
        };
      }
      if (await pathExists(root, attempt.paths.preparedRoot)) {
        throw new Error("Provider prepared request directory is incomplete or invalid.");
      }
      const loadedConfig = await loadProviderConfig({ root });
      const selected = resolveProviderProfile({
        loaded: loadedConfig,
        role: "code-reviewer",
        profile: options.profile,
        model: options.model,
      });
      const policies = await loadWorkerPolicies({ root });
      const policy = policies.get("code-reviewer");
      if (!policy) throw new Error("code-reviewer Worker policy is missing.");
      const candidate = await createProviderContextCandidate({
        root,
        state: attempt.state,
        task: attempt.task,
        taskFile: attempt.taskFile,
        policy,
        now: () => attempt.task.preparedAt,
      });
      const current = await loadActiveAttempt({ root, stateFile: options.stateFile });
      if (current.state.runtime.revision !== attempt.state.runtime.revision
          || current.task.dispatchId !== attempt.task.dispatchId) {
        throw new Error("Provider State or task drifted during Prepare.");
      }
      await assertLockOwned(root, attempt.paths, attempt.lock);
      for (const generated of candidate.generatedFiles) {
        await writeImmutable(root, generated.path, generated.content);
      }
      const contextSource = canonicalJson(candidate.manifest);
      await writeImmutable(root, attempt.paths.contextManifestFile, contextSource);
      await options.afterContextManifestWrite?.();
      const outputSchemaFile = ".harness/schemas/agent-provider-response.schema.json";
      const outputSchemaSha256 = await fileSha256(root, outputSchemaFile);
      const request = {
        schemaVersion: "1.0",
        providerRequestId: randomUUID(),
        dispatchId: attempt.task.dispatchId,
        storyId: attempt.task.storyId,
        runId: attempt.task.runId,
        phase: "code-review",
        preparedRevision: attempt.task.preparedRevision,
        role: "code-reviewer",
        profile: selected.profile,
        adapter: selected.adapter,
        requestedModel: selected.requestedModel,
        modelSource: selected.modelSource,
        modelProvider: selected.modelProvider,
        configSha256: selected.configSha256,
        taskFile: attempt.taskFile,
        taskSha256: await fileSha256(root, attempt.taskFile),
        policy: {
          name: policy.name,
          category: policy.category,
          readPathPrefixes: [...policy.readPathPrefixes],
          writePathPrefixes: [],
          capabilities: [...policy.capabilities],
        },
        contextManifestFile: attempt.paths.contextManifestFile,
        contextManifestSha256: sha256(contextSource),
        outputSchemaFile,
        outputSchemaSha256,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        promptTemplateSha256: promptTemplateSha256(),
        createdAt: (options.now ?? (() => new Date().toISOString()))(),
      };
      validateProviderRequest(request);
      await assertLockOwned(root, attempt.paths, attempt.lock);
      await writePreparedRequestBundle(
        root,
        attempt.paths,
        request,
        options.beforePreparedRename,
      );
      return {
        ...(await deriveProviderStatus(attempt, options)),
        prepared: true,
        providerRequestId: request.providerRequestId,
      };
    },
  );
}

async function gitCommand(root, args, encoding = "utf8") {
  const result = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

async function hashPathOrMarker(root, relativePath) {
  const resolved = resolveRepositoryPath(root, relativePath, "Provider integrity path");
  const info = await lstat(resolved.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return { path: relativePath, state: "missing", sha256: null };
  if (!info.isFile() || info.isSymbolicLink()) {
    return { path: relativePath, state: "unsupported", sha256: null };
  }
  return {
    path: relativePath,
    state: "file",
    sha256: sha256(await readFile(resolved.fullPath)),
  };
}

async function hashProviderLockForIntegrity(root, relativePath) {
  const marker = await hashPathOrMarker(root, relativePath);
  if (marker.state !== "file") return marker;
  const lock = await readJson(root, relativePath, "Provider integrity lock");
  validateLock(lock);
  return {
    ...marker,
    sha256: sha256(canonicalJson({ ...lock, childPid: null })),
  };
}

async function integritySnapshot(attempt, bundle) {
  const boundPaths = [
    attempt.stateFile,
    pointerFileForState(attempt.stateFile),
    eventsFileForState(attempt.state),
    attempt.taskFile,
    attempt.task.checkpointFile,
    attempt.paths.requestFile,
    attempt.paths.requestBindingFile,
    attempt.paths.contextManifestFile,
    bundle.request.outputSchemaFile,
    ...bundle.context.entries.map((entry) => entry.path),
  ];
  const uniqueBound = [...new Set(boundPaths)].sort();
  const bound = [];
  for (const file of uniqueBound) bound.push(await hashPathOrMarker(attempt.root, file));
  const head = (await gitCommand(attempt.root, ["rev-parse", "--verify", "HEAD"])).trim();
  const statusSource = await gitCommand(
    attempt.root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
  );
  const dirtyEntries = parsePorcelainV1Z(statusSource);
  const dirty = [];
  for (const entry of dirtyEntries) {
    dirty.push({
      ...entry,
      content: entry.path === attempt.paths.lockFile
        ? await hashProviderLockForIntegrity(attempt.root, entry.path)
        : await hashPathOrMarker(attempt.root, entry.path),
      sourceContent: entry.sourcePath
        ? entry.sourcePath === attempt.paths.lockFile
          ? await hashProviderLockForIntegrity(attempt.root, entry.sourcePath)
          : await hashPathOrMarker(attempt.root, entry.sourcePath)
        : null,
    });
  }
  const value = {
    head,
    statusSha256: sha256(statusSource),
    bound,
    dirty,
  };
  return {
    value,
    sha256: sha256(JSON.stringify(canonical(value))),
  };
}

function executionPaths(paths, providerExecutionId) {
  const root = `${paths.executionsRoot}/${providerExecutionId}`;
  return {
    root,
    claimFile: `${root}/execution-claim.json`,
    rawEventsFile: `${root}/raw-events.jsonl`,
    responseFile: `${root}/raw-response.json`,
    diagnosticsFile: `${root}/diagnostics.json`,
    receiptFile: `${root}/execution-receipt.json`,
  };
}

function rawEventsSource(events) {
  return events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "");
}

function sanitizePersistedValue(value, key = null) {
  if (isProviderSensitiveKey(key) && (value === null || typeof value !== "object")) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}"))
        || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return JSON.stringify(sanitizePersistedValue(JSON.parse(value)));
      } catch {
        // Preserve non-JSON text and apply the bounded credential patterns below.
      }
    }
    return redactProviderDiagnostic(value);
  }
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

function sanitizeProviderResponse(response) {
  if (!response) return null;
  const sanitized = sanitizePersistedValue(response);
  if (sanitized && typeof sanitized === "object"
      && !Array.isArray(sanitized)
      && Array.isArray(sanitized.diagnostics)) {
    sanitized.diagnostics = [...new Set(sanitized.diagnostics)];
  }
  return sanitized;
}

async function persistExecution({
  attempt,
  bundle,
  lock,
  providerExecutionId,
  adapterResult,
  finalStatus,
  diagnostics,
  integrityBefore,
  integrityAfter,
  model,
}) {
  const paths = executionPaths(attempt.paths, providerExecutionId);
  const persistedEvents = sanitizePersistedValue(adapterResult.rawEvents ?? []);
  const persistedResponse = finalStatus === "invalid-response"
    ? null
    : sanitizeProviderResponse(adapterResult.response);
  const persistedDiagnostics = [...new Set(diagnostics
    .map((diagnostic) => redactProviderDiagnostic(diagnostic).slice(0, 2048))
    .filter(Boolean))]
    .slice(0, 32);
  if (persistedResponse) validateProviderResponse(persistedResponse, { context: bundle.context });
  await writeImmutable(attempt.root, paths.rawEventsFile, rawEventsSource(persistedEvents));
  let responseFile = null;
  let responseSha256 = null;
  if (persistedResponse) {
    const responseSource = canonicalJson(persistedResponse);
    await writeImmutable(attempt.root, paths.responseFile, responseSource);
    responseFile = paths.responseFile;
    responseSha256 = sha256(responseSource);
  }
  await writeImmutable(attempt.root, paths.diagnosticsFile, canonicalJson({
    diagnostics: persistedDiagnostics,
  }));
  const receipt = {
    schemaVersion: "1.0",
    providerExecutionId,
    providerRequestId: bundle.request.providerRequestId,
    dispatchId: bundle.request.dispatchId,
    storyId: bundle.request.storyId,
    runId: bundle.request.runId,
    phase: "code-review",
    role: "code-reviewer",
    profile: bundle.request.profile,
    adapter: "codex-cli",
    configSha256: bundle.request.configSha256,
    requestFile: attempt.paths.requestFile,
    requestSha256: await fileSha256(attempt.root, attempt.paths.requestFile),
    contextManifestFile: attempt.paths.contextManifestFile,
    contextManifestSha256: await fileSha256(attempt.root, attempt.paths.contextManifestFile),
    promptTemplateVersion: bundle.request.promptTemplateVersion,
    promptTemplateSha256: bundle.request.promptTemplateSha256,
    requestedModel: bundle.request.requestedModel,
    modelProvider: bundle.request.modelProvider,
    resolvedModel: model.resolvedModel,
    reportedModel: adapterResult.reportedModel ?? null,
    modelSource: model.modelSource,
    adapterVersion: adapterResult.adapterVersion ?? "codex-cli/unknown",
    readIsolation: "same-os-user-readonly-sandbox",
    startedAt: adapterResult.startedAt,
    finishedAt: adapterResult.finishedAt,
    exitCode: adapterResult.exitCode ?? null,
    status: finalStatus,
    responseFile,
    responseSha256,
    integrityChecks: [
      {
        checkId: "repository-snapshot",
        status: integrityBefore.sha256 === integrityAfter.sha256 ? "passed" : "failed",
        beforeSha256: integrityBefore.sha256,
        afterSha256: integrityAfter.sha256,
        details: integrityBefore.sha256 === integrityAfter.sha256
          ? "Repository, State, task, context and dirty content remained unchanged."
          : "Repository, State, task, context or dirty content changed during Provider execution.",
      },
      {
        checkId: "isolated-root",
        status: adapterResult.isolatedIntegrity?.status ?? "not-applicable",
        beforeSha256: adapterResult.isolatedIntegrity?.beforeSha256 ?? null,
        afterSha256: adapterResult.isolatedIntegrity?.afterSha256 ?? null,
        details: adapterResult.isolatedIntegrity?.status === "passed"
          ? "Adapter isolated working tree remained unchanged."
          : adapterResult.isolatedIntegrity?.status === "failed"
            ? "Adapter isolated working tree changed during execution."
            : "Adapter did not produce an isolated working tree snapshot.",
      },
    ],
    diagnostics: persistedDiagnostics,
  };
  validateProviderExecutionReceipt(receipt);
  await assertLockOwned(attempt.root, attempt.paths, lock);
  await writeImmutable(attempt.root, paths.receiptFile, canonicalJson(receipt));
  return receipt;
}

export async function runProvider(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await loadActiveAttempt({ root, stateFile: options.stateFile });
  const initialStatus = await deriveProviderStatus(initial, options);
  if (initialStatus.status === "provider-materialize-required"
      || initialStatus.status === "provider-materialized") {
    throw new Error("Provider already has a successful execution; materialize or apply it instead of rerunning.");
  }
  if (!["provider-ready", "provider-failed"].includes(initialStatus.status)) {
    throw new Error(`Provider Run is not allowed from status '${initialStatus.status}'.`);
  }
  const providerExecutionId = randomUUID();
  await withProviderLock(
    {
      ...options,
      root,
      providerRequestId: initialStatus.providerRequestId,
      providerExecutionId,
    },
    "run",
    async (attempt) => {
      const bundle = await verifyPreparedBundle(attempt);
      const status = await deriveProviderStatus(attempt, options);
      if (status.status === "provider-materialize-required"
          || status.status === "provider-materialized") {
        throw new Error("Provider already has a successful execution; materialize it.");
      }
      const claim = {
        schemaVersion: "1.0",
        providerExecutionId,
        providerRequestId: bundle.request.providerRequestId,
        dispatchId: bundle.request.dispatchId,
        storyId: bundle.request.storyId,
        runId: bundle.request.runId,
        phase: "code-review",
        role: "code-reviewer",
        claimedAt: (options.now ?? (() => new Date().toISOString()))(),
      };
      validateExecutionClaim(claim);
      await writeImmutable(
        root,
        executionPaths(attempt.paths, providerExecutionId).claimFile,
        canonicalJson(claim),
      );
      const contents = [];
      for (const entry of bundle.context.entries) {
        contents.push({
          path: entry.path,
          content: await readText(root, entry.path, "Provider frozen context entry"),
          generated: entry.path.startsWith(`${attempt.task.attemptRoot}/provider/context/`),
        });
      }
      const inlineData = await buildProviderInlineData({
        candidate: {
          manifest: bundle.context,
          contents,
        },
      });
      const responseIdentity = canonicalJson({
        providerRequestId: bundle.request.providerRequestId,
        dispatchId: bundle.request.dispatchId,
        storyId: bundle.request.storyId,
        runId: bundle.request.runId,
        phase: bundle.request.phase,
        role: bundle.request.role,
      });
      const prompt = `${PROMPT_TEMPLATE}\n\n# Frozen response identity\n\n${responseIdentity}\n${inlineData}`;
      const outputSchemaContent = await readText(
        root,
        bundle.request.outputSchemaFile,
        "Provider output Schema",
      );
      const before = await integritySnapshot(attempt, bundle);
      const adapter = options.adapter ?? runCodexCli;
      let adapterResult;
      try {
        adapterResult = await adapter({
          prompt,
          outputSchemaContent,
          outputSchemaSha256: bundle.request.outputSchemaSha256,
          model: bundle.model.resolvedModel,
          modelProvider: bundle.model.modelProvider,
          timeoutMs: options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
          executablePath: options.executablePath,
          onSpawn: async (childPid) => {
            await updateLock(root, attempt.paths, attempt.lock, {
              childPid,
              providerExecutionId,
            }, options);
          },
        });
      } catch (error) {
        const failedAt = (options.now ?? (() => new Date().toISOString()))();
        adapterResult = {
          adapter: "codex-cli",
          adapterVersion: "codex-cli/unknown",
          requestedModel: bundle.model.resolvedModel,
          reportedModel: null,
          startedAt: failedAt,
          finishedAt: failedAt,
          exitCode: null,
          status: "failed",
          response: null,
          rawEvents: [],
          diagnostics: [`Provider adapter failed: ${error.message}`.slice(0, 2048)],
          isolatedIntegrity: {
            beforeSha256: null,
            afterSha256: null,
            status: "not-applicable",
          },
        };
      }
      const after = await integritySnapshot(attempt, bundle);
      const diagnostics = [...(adapterResult.diagnostics ?? [])];
      let finalStatus = adapterResult.status;
      if (before.sha256 !== after.sha256) {
        finalStatus = "integrity-violation";
        diagnostics.push("Repository integrity snapshot changed during Provider execution.");
      } else if (adapterResult.status === "completed") {
        try {
          const sanitizedResponse = sanitizeProviderResponse(adapterResult.response);
          validateProviderResponse(sanitizedResponse, { context: bundle.context });
          if (sanitizedResponse.providerRequestId !== bundle.request.providerRequestId
              || sanitizedResponse.dispatchId !== bundle.request.dispatchId
              || sanitizedResponse.storyId !== bundle.request.storyId
              || sanitizedResponse.runId !== bundle.request.runId) {
            throw new Error("Provider response identity does not match request.");
          }
          if (sanitizedResponse.status === "failed") {
            finalStatus = "failed";
            diagnostics.push(`Provider response reported failure: ${sanitizedResponse.summary}`);
            diagnostics.push(...sanitizedResponse.diagnostics);
          } else {
            const mapped = mapProviderResponseToReview(sanitizedResponse, {
              evidencePath: attempt.paths.evidenceFile,
            });
            const findingIds = mapped.findings.map((finding) => finding.findingId);
            if (new Set(findingIds).size !== findingIds.length) {
              throw new Error("Provider sanitized findings contain a duplicate finding identity.");
            }
          }
          adapterResult = { ...adapterResult, response: sanitizedResponse };
        } catch (error) {
          finalStatus = "invalid-response";
          diagnostics.push(error.message);
        }
      }
      return persistExecution({
        attempt,
        bundle,
        lock: attempt.lock,
        providerExecutionId,
        adapterResult,
        finalStatus,
        diagnostics,
        integrityBefore: before,
        integrityAfter: after,
        model: bundle.model,
      });
    },
  );
  return inspectProvider({ ...options, root });
}

function renderReviewReport(response, mapped) {
  const lines = [
    "# Code Review Report",
    "",
    `结论：${mapped.status === "passed" ? "通过" : "阻塞"}`,
    "",
    response.summary,
    "",
    "## Findings",
    "",
  ];
  if (!response.findings.length) {
    lines.push("无 BLOCKER、WARNING 或 INFO finding。", "");
  } else {
    for (const finding of response.findings) {
      lines.push(
        `### ${finding.findingId} ${finding.severity}`,
        "",
        `- 状态：${finding.status}`,
        `- 文件：${finding.file ?? "(全局)"}`,
        `- 行号：${finding.line ?? "(无)"}`,
        `- 摘要：${finding.summary}`,
        `- 证据：${finding.evidenceText}`,
        `- 影响：${finding.rationale}`,
        "",
      );
    }
  }
  lines.push(
    "## Provider 边界",
    "",
    "- 本报告由 Harness Runtime 根据结构化 Provider response 生成。",
    "- Agent 未直接写入本报告、阶段 result 或 State。",
    "",
  );
  return lines.join("\n");
}

function dispatchResult({
  task,
  response,
  mapped,
  report,
  reportSha256,
  reportBytes,
  evidenceFile,
  evidenceSha256,
  evidenceBytes,
}) {
  const blocked = mapped.status === "blocked";
  const reviewRecordStatus = mapped.findings.some((finding) => finding.severity === "BLOCKER")
    ? "BLOCKER"
    : mapped.findings.some((finding) => finding.severity === "WARNING")
      ? "WARNING"
      : "passed";
  const records = [
    {
      type: "review",
      status: reviewRecordStatus,
      path: evidenceFile,
      sha256: evidenceSha256,
      bytes: evidenceBytes,
      message: response.summary,
      actor: "code-reviewer",
    },
  ];
  const result = {
    schemaVersion: "2.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    runId: task.runId,
    phase: "code-review",
    preparedRevision: task.preparedRevision,
    status: blocked ? "blocked" : "completed",
    summary: response.summary,
    outputs: blocked ? [] : [{
      path: report,
      sha256: reportSha256,
      bytes: reportBytes,
    }],
    records,
    payload: mapped,
  };
  if (blocked) {
    result.diagnostics = {
      code: "provider-review-findings",
      message: "Provider review found unresolved BLOCKER or WARNING findings.",
      details: mapped.findings.map((finding) => finding.findingId),
    };
    result.blocker = {
      reason: "Provider review found unresolved BLOCKER or WARNING findings.",
      owner: "code-fixer",
      suggestedAction: "Fix the findings, rerun tests, and prepare a new code-review attempt.",
    };
  }
  return result;
}

function indeterminateDispatchResult({
  task,
  evidenceFile,
  evidenceSha256,
  evidenceBytes,
}) {
  const summary = "Provider execution outcome is indeterminate.";
  const findingIdentity = [
    "BLOCKER",
    "",
    "",
    summary.toLowerCase(),
    "execution claim exists without a terminal receipt",
  ].join("\n");
  const finding = {
    findingId: `PF-${sha256(findingIdentity).slice("sha256:".length, "sha256:".length + 16).toUpperCase()}`,
    severity: "BLOCKER",
    status: "open",
    summary,
    file: null,
    line: null,
    evidence: evidenceFile,
  };
  return {
    schemaVersion: "2.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    runId: task.runId,
    phase: "code-review",
    preparedRevision: task.preparedRevision,
    status: "blocked",
    summary,
    outputs: [],
    records: [{
      type: "review",
      status: "BLOCKER",
      path: evidenceFile,
      sha256: evidenceSha256,
      bytes: evidenceBytes,
      message: summary,
      actor: "provider-runtime",
    }],
    payload: {
      findings: [finding],
      status: "blocked",
    },
    diagnostics: {
      code: "provider-execution-indeterminate",
      message: summary,
      details: [finding.findingId],
    },
    blocker: {
      reason: summary,
      owner: "provider-operator",
      suggestedAction:
        "Apply this blocked result, then resume to create a new attempt; do not rerun this request.",
    },
  };
}

async function materializeIndeterminateExecution({
  root,
  attempt,
  bundle,
  error,
  options,
}) {
  const evidenceIdentity = indeterminateEvidenceIdentity(bundle, error);
  let evidenceSource;
  let evidenceSha256;
  let evidenceBytes;
  const existingEvidence = await readIndeterminateEvidence(attempt, bundle, error);
  if (existingEvidence) {
    const snapshot = existingEvidence;
    evidenceSource = snapshot.source;
    evidenceSha256 = snapshot.sha256;
    evidenceBytes = Buffer.byteLength(evidenceSource, "utf8");
  } else {
    const evidence = {
      ...evidenceIdentity,
      detectedAt: (options.now ?? (() => new Date().toISOString()))(),
    };
    evidenceSource = canonicalJson(evidence);
    evidenceSha256 = sha256(evidenceSource);
    evidenceBytes = Buffer.byteLength(evidenceSource, "utf8");
    await writeImmutable(root, attempt.paths.indeterminateEvidenceFile, evidenceSource);
  }
  await options.afterEvidenceWrite?.();
  const result = indeterminateDispatchResult({
    task: attempt.task,
    evidenceFile: attempt.paths.indeterminateEvidenceFile,
    evidenceSha256,
    evidenceBytes,
  });
  validateDispatchResultStructure(result);
  await assertLockOwned(root, attempt.paths, attempt.lock);
  await replaceAtomic(
    root,
    attempt.task.resultFile,
    canonicalJson(result),
    async () => {
      await options.beforeResultRename?.();
      if (await fileSha256(root, error.claimFile) !== error.claimSha256) {
        throw new Error("Provider execution claim snapshot changed before result commit.");
      }
      await assertLockOwned(root, attempt.paths, attempt.lock);
    },
  );
}

export async function materializeProvider(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await loadActiveAttempt({ root, stateFile: options.stateFile });
  if (await pathExists(root, initial.task.resultFile)) {
    const status = await deriveProviderStatus(initial, options);
    if (status.status !== "provider-materialized") {
      throw new Error(status.diagnostics?.join("; ") ?? "Provider result is invalid.");
    }
    return { ...status, materialized: false };
  }
  const status = await deriveProviderStatus(initial, options);
  if (!["provider-materialize-required", "provider-execution-indeterminate"].includes(status.status)) {
    if (status.status === "provider-invalid" && status.diagnostics?.length) {
      throw new Error(status.diagnostics.join("; "));
    }
    throw new Error(`Provider Materialize is not allowed from status '${status.status}'.`);
  }
  return withProviderLock(
    {
      ...options,
      root,
      providerRequestId: status.providerRequestId,
      providerExecutionId: status.providerExecutionId,
    },
    "materialize",
    async (attempt) => {
      const bundle = await verifyPreparedBundle(attempt);
      let executions;
      try {
        executions = await loadExecutionReceipts(attempt, bundle);
      } catch (error) {
        if (!(error instanceof IndeterminateProviderExecutionError)) throw error;
        await materializeIndeterminateExecution({
          root,
          attempt,
          bundle,
          error,
          options,
        });
        return {
          ...(await deriveProviderStatus(attempt, options)),
          materialized: true,
        };
      }
      const successful = executions.filter((item) => item.receipt.status === "completed");
      if (successful.length !== 1) {
        throw new Error("Provider Materialize requires a unique successful execution.");
      }
      const selected = successful[0];
      const response = selected.response;
      const evidenceSource = canonicalJson(response);
      const evidenceSha256 = sha256(evidenceSource);
      const evidenceBytes = Buffer.byteLength(evidenceSource, "utf8");
      await writeImmutable(root, attempt.paths.evidenceFile, evidenceSource);
      await options.afterEvidenceWrite?.();
      const mapped = mapProviderResponseToReview(response, {
        evidencePath: attempt.paths.evidenceFile,
      });
      const reportFile = attempt.task.expectedOutputs[0];
      const reportSource = renderReviewReport(response, mapped);
      const reportSha256 = sha256(reportSource);
      const reportBytes = Buffer.byteLength(reportSource, "utf8");
      if (mapped.status !== "blocked") {
        await assertLockOwned(root, attempt.paths, attempt.lock);
        await replaceAtomic(
          root,
          reportFile,
          reportSource,
          async () => assertLockOwned(root, attempt.paths, attempt.lock),
        );
        await options.afterReportWrite?.();
      }
      const result = dispatchResult({
        task: attempt.task,
        response,
        mapped,
        report: reportFile,
        reportSha256,
        reportBytes,
        evidenceFile: attempt.paths.evidenceFile,
        evidenceSha256,
        evidenceBytes,
      });
      validateDispatchResultStructure(result);
      await assertLockOwned(root, attempt.paths, attempt.lock);
      await replaceAtomic(
        root,
        attempt.task.resultFile,
        canonicalJson(result),
        async () => {
          await options.beforeResultRename?.();
          await assertLockOwned(root, attempt.paths, attempt.lock);
        },
      );
      return {
        ...(await deriveProviderStatus(attempt, options)),
        materialized: true,
      };
    },
  );
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  if (!["status", "prepare", "run", "materialize"].includes(command)) {
    throw new Error(`Unsupported Provider command: ${command ?? "(missing)"}`);
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
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const command = options.command;
    const handler = command === "status"
      ? inspectProvider
      : command === "prepare"
        ? prepareProvider
        : command === "run"
          ? runProvider
          : materializeProvider;
    const result = await handler(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Provider status '${result.status}' for ${result.storyId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`Provider command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
