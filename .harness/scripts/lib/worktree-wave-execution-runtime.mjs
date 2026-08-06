import { createHash, randomUUID as createRandomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  validateDispatchResultStructure,
  validateDispatchTaskStructure,
} from "./dispatch-contract.mjs";
import { matchesPredictedFile } from "./task-dag-contract.mjs";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MUTATION_LOCK_WAIT_MS = 5_000;
const MUTATION_LOCK_POLL_MS = 5;
const execFileAsync = promisify(execFile);
const TASK_STATUSES = new Set([
  "pending",
  "claiming",
  "running",
  "blocked",
  "ready-for-integration",
  "integrated",
]);
const LEDGER_FIELDS = [
  "schemaVersion",
  "storyId",
  "runId",
  "phase",
  "preparedRevision",
  "waveId",
  "waveIndex",
  "taskDagFile",
  "taskDagSha256",
  "wavePlanFile",
  "wavePlanSha256",
  "creationReceiptFile",
  "creationReceiptSha256",
  "baseCommit",
  "status",
  "tasks",
  "integrationManifestFile",
  "integrationManifestSha256",
  "waveReceiptFile",
  "waveReceiptSha256",
  "preparedAt",
  "finalizedAt",
];
const TASK_FIELDS = [
  "taskId",
  "dispatchId",
  "taskFile",
  "taskSha256",
  "checkpointFile",
  "checkpointSha256",
  "status",
  "currentAttemptId",
  "executionReceiptFile",
  "executionReceiptSha256",
  "integrationReceiptFile",
  "integrationReceiptSha256",
  "startedAt",
  "workerReadyAt",
  "integratedAt",
];

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function resolveInsideRoot(root, relativeFile, label) {
  if (typeof relativeFile !== "string" || !relativeFile.trim() || path.isAbsolute(relativeFile)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, relativeFile);
  const relative = normalizePath(path.relative(rootPath, fullPath));
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
}

function assertExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new Error(`${label} has an invalid structure.`);
  }
}

function assertDateTimeOrNull(value, label) {
  if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
    throw new Error(`${label} must be a date-time or null.`);
  }
}

async function readJsonFile(filePath, label) {
  const info = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

async function fileSha256(root, relativeFile, label) {
  const filePath = resolveInsideRoot(root, relativeFile, label).fullPath;
  const info = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

async function writeAtomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${createRandomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeExclusiveJson(root, relativeFile, value, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await mkdir(path.dirname(location.fullPath), { recursive: true });
  let handle;
  try {
    handle = await open(location.fullPath, "wx");
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.close();
    return location;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      const existing = await readJsonFile(location.fullPath, label);
      if (JSON.stringify(existing) === JSON.stringify(value)) return location;
    }
    if (handle) await unlink(location.fullPath).catch(() => {});
    throw error;
  }
}

function ledgerFileFor(state, waveId) {
  return `.harness/runs/${state.runtime.runId}/waves/${waveId}/execution-ledger.json`;
}

function attemptPaths(ledger, taskId, attemptId) {
  const root = `.harness/runs/${ledger.runId}/waves/${ledger.waveId}/tasks/${taskId}/attempts/${attemptId}`;
  return {
    root,
    claimFile: `${root}/claim.json`,
    inputSnapshotFile: `${root}/input-snapshot.json`,
    resultFile: `${root}/result.json`,
    receiptFile: `${root}/execution-receipt.json`,
    failureFile: `${root}/failure.json`,
    lockFile: `.harness/runs/${ledger.runId}/waves/${ledger.waveId}/tasks/${taskId}/execute.lock`,
  };
}

function token(prefix, randomUUID) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function acquireMutationLock(root, ledgerFile, now, afterOpenBeforeWrite) {
  const lockFile = `${path.posix.dirname(ledgerFile)}/ledger-mutation.lock`;
  const location = resolveInsideRoot(root, lockFile, "Wave ledger mutation lock");
  await mkdir(path.dirname(location.fullPath), { recursive: true });
  const deadline = Date.now() + MUTATION_LOCK_WAIT_MS;
  while (true) {
    let handle;
    try {
      handle = await open(location.fullPath, "wx");
      if (afterOpenBeforeWrite) await afterOpenBeforeWrite();
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        createdAt: now(),
      })}\n`, "utf8");
      await handle.close();
      return location;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") {
        if (handle) await unlink(location.fullPath).catch(() => {});
        throw error;
      }
      const source = await readFile(location.fullPath, "utf8").catch(() => "");
      let lock;
      try {
        lock = JSON.parse(source);
      } catch {
        lock = null;
      }
      if ((lock && lock.pid !== process.pid) || Date.now() >= deadline) {
        throw new Error("Wave ledger mutation lock already exists; inspect it before retrying.");
      }
      await new Promise((resolve) => setTimeout(resolve, MUTATION_LOCK_POLL_MS));
    }
  }
}

async function mutateLedger({
  root,
  ledgerFile,
  now,
  expectedSha256,
  afterLockOpenBeforeWrite,
  mutate,
}) {
  const timestamp = now ?? (() => new Date().toISOString());
  const lock = await acquireMutationLock(root, ledgerFile, timestamp, afterLockOpenBeforeWrite);
  try {
    if (expectedSha256) {
      const currentSha256 = await fileSha256(root, ledgerFile, "Wave execution ledger");
      if (currentSha256 !== expectedSha256) {
        throw new Error("Wave execution ledger hash changed before mutation.");
      }
    }
    const ledgerPath = resolveInsideRoot(root, ledgerFile, "Wave execution ledger").fullPath;
    const ledger = validateWaveExecutionLedger(await readJsonFile(ledgerPath, "Wave execution ledger"));
    await mutate(ledger);
    ledger.status = deriveWaveExecutionStatus(ledger.tasks.map((task) => task.status));
    validateWaveExecutionLedger(ledger);
    await writeAtomicJson(ledgerPath, ledger);
    return ledger;
  } finally {
    await unlink(lock.fullPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function validateClaim(claim, ledger, task, paths) {
  assertExactFields(claim, [
    "schemaVersion", "storyId", "runId", "phase", "waveId", "waveIndex",
    "taskId", "dispatchId", "attemptId", "claimId", "lockId",
    "wavePlanSha256", "creationReceiptSha256", "taskSha256", "checkpointSha256",
    "claimFile", "lockFile", "claimedAt",
  ], "Wave attempt claim");
  if (claim.schemaVersion !== "1.0"
      || claim.storyId !== ledger.storyId
      || claim.runId !== ledger.runId
      || claim.phase !== ledger.phase
      || claim.waveId !== ledger.waveId
      || claim.waveIndex !== ledger.waveIndex
      || claim.taskId !== task.taskId
      || claim.dispatchId !== task.dispatchId
      || claim.attemptId !== task.currentAttemptId
      || claim.wavePlanSha256 !== ledger.wavePlanSha256
      || claim.creationReceiptSha256 !== ledger.creationReceiptSha256
      || claim.taskSha256 !== task.taskSha256
      || claim.checkpointSha256 !== task.checkpointSha256
      || claim.claimFile !== paths.claimFile
      || claim.lockFile !== paths.lockFile
      || typeof claim.claimId !== "string" || !claim.claimId
      || typeof claim.lockId !== "string" || !claim.lockId
      || typeof claim.claimedAt !== "string" || Number.isNaN(Date.parse(claim.claimedAt))) {
    throw new Error("Wave attempt claim does not match the current ledger task.");
  }
  return claim;
}

function validateExecutionLock(lock, claim) {
  assertExactFields(lock, [
    "schemaVersion", "storyId", "runId", "waveId", "taskId",
    "attemptId", "claimId", "lockId", "pid", "createdAt",
  ], "Wave task execution lock");
  if (lock.schemaVersion !== "1.0"
      || lock.storyId !== claim.storyId
      || lock.runId !== claim.runId
      || lock.waveId !== claim.waveId
      || lock.taskId !== claim.taskId
      || lock.attemptId !== claim.attemptId
      || lock.claimId !== claim.claimId
      || lock.lockId !== claim.lockId
      || !Number.isInteger(lock.pid)
      || typeof lock.createdAt !== "string" || Number.isNaN(Date.parse(lock.createdAt))) {
    throw new Error("Wave task execution lock does not match its claim.");
  }
  return lock;
}

export function deriveWaveExecutionStatus(statuses) {
  if (!Array.isArray(statuses) || !statuses.length || statuses.some((status) => !TASK_STATUSES.has(status))) {
    throw new Error("Wave task statuses are invalid.");
  }
  if (statuses.every((status) => status === "pending")) return "prepared";
  if (statuses.some((status) => status === "claiming" || status === "running")) return "executing";
  if (statuses.every((status) => status === "ready-for-integration")) return "ready-for-integration";
  if (statuses.every((status) => status === "integrated")) return "integrated";
  if (statuses.some((status) => status === "integrated")) return "partial-integration";
  return "partial";
}

function validateTaskEvidence(task) {
  assertExactFields(task, TASK_FIELDS, "Wave execution task");
  if (typeof task.taskId !== "string" || !task.taskId
      || typeof task.dispatchId !== "string" || !task.dispatchId
      || typeof task.taskFile !== "string" || !task.taskFile
      || !SHA256_PATTERN.test(task.taskSha256)
      || typeof task.checkpointFile !== "string" || !task.checkpointFile
      || !SHA256_PATTERN.test(task.checkpointSha256)
      || !TASK_STATUSES.has(task.status)) {
    throw new Error("Wave execution task identity or status is invalid.");
  }
  for (const field of [
    "executionReceiptSha256",
    "integrationReceiptSha256",
  ]) {
    if (task[field] !== null && !SHA256_PATTERN.test(task[field])) {
      throw new Error(`Wave execution task ${field} is invalid.`);
    }
  }
  for (const field of ["startedAt", "workerReadyAt", "integratedAt"]) {
    assertDateTimeOrNull(task[field], `Wave execution task ${field}`);
  }

  if (task.status === "pending") {
    if (task.currentAttemptId !== null
        || task.executionReceiptFile !== null
        || task.executionReceiptSha256 !== null
        || task.startedAt !== null
        || task.workerReadyAt !== null
        || task.integratedAt !== null) {
      throw new Error("A pending task cannot contain an active attempt or execution evidence.");
    }
    return;
  }
  if (typeof task.currentAttemptId !== "string" || !task.currentAttemptId) {
    throw new Error(`A ${task.status} task requires a current attempt.`);
  }
  if (task.status === "claiming") return;
  if (!task.startedAt) throw new Error(`A ${task.status} task requires its running attempt timestamp.`);
  if (task.status === "ready-for-integration" || task.status === "integrated") {
    if (typeof task.executionReceiptFile !== "string" || !task.executionReceiptFile
        || !SHA256_PATTERN.test(task.executionReceiptSha256)
        || !task.workerReadyAt) {
      throw new Error("A ready task requires an execution receipt hash and worker-ready timestamp.");
    }
  }
  if (task.status === "integrated") {
    if (typeof task.integrationReceiptFile !== "string" || !task.integrationReceiptFile
        || !SHA256_PATTERN.test(task.integrationReceiptSha256)
        || !task.integratedAt) {
      throw new Error("An integrated task requires integration receipt evidence.");
    }
  }
}

export function validateWaveExecutionLedger(ledger) {
  assertExactFields(ledger, LEDGER_FIELDS, "Wave execution ledger");
  if (ledger.schemaVersion !== "1.0"
      || typeof ledger.storyId !== "string" || !ledger.storyId
      || ledger.runId !== ledger.storyId
      || ledger.phase !== "implementation"
      || !Number.isInteger(ledger.preparedRevision) || ledger.preparedRevision < 1
      || typeof ledger.waveId !== "string" || !/^wave-[a-f0-9]{16}$/.test(ledger.waveId)
      || !Number.isInteger(ledger.waveIndex) || ledger.waveIndex < 1
      || typeof ledger.taskDagFile !== "string" || !SHA256_PATTERN.test(ledger.taskDagSha256)
      || typeof ledger.wavePlanFile !== "string" || !SHA256_PATTERN.test(ledger.wavePlanSha256)
      || typeof ledger.creationReceiptFile !== "string" || !SHA256_PATTERN.test(ledger.creationReceiptSha256)
      || typeof ledger.baseCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(ledger.baseCommit)
      || !Array.isArray(ledger.tasks) || ledger.tasks.length < 2
      || typeof ledger.preparedAt !== "string" || Number.isNaN(Date.parse(ledger.preparedAt))) {
    throw new Error("Wave execution ledger identity is invalid.");
  }
  for (const field of ["integrationManifestSha256", "waveReceiptSha256"]) {
    if (ledger[field] !== null && !SHA256_PATTERN.test(ledger[field])) {
      throw new Error(`Wave execution ledger ${field} is invalid.`);
    }
  }
  assertDateTimeOrNull(ledger.finalizedAt, "Wave execution ledger finalizedAt");
  const taskIds = new Set();
  const dispatchIds = new Set();
  for (const task of ledger.tasks) {
    validateTaskEvidence(task);
    if (taskIds.has(task.taskId) || dispatchIds.has(task.dispatchId)) {
      throw new Error("Wave execution ledger task and dispatch identities must be unique.");
    }
    taskIds.add(task.taskId);
    dispatchIds.add(task.dispatchId);
  }
  const derived = deriveWaveExecutionStatus(ledger.tasks.map((task) => task.status));
  if (ledger.status !== derived) {
    throw new Error("Wave execution ledger top-level status does not match its derived task status.");
  }
  return ledger;
}

function checkpointMatchesTask(checkpoint, task) {
  return checkpoint?.schemaVersion === "1.2"
    && checkpoint.dispatchId === task.dispatchId
    && checkpoint.storyId === task.storyId
    && checkpoint.runId === task.runId
    && checkpoint.phase === task.phase
    && checkpoint.waveId === task.waveId
    && checkpoint.waveIndex === task.waveIndex
    && checkpoint.taskId === task.taskId
    && checkpoint.taskRoot === task.taskRoot
    && checkpoint.status === "prepared"
    && checkpoint.preparedAt === task.preparedAt;
}

async function expectedLedger({ root, state, wave, waveId, tasks, timestamp }) {
  const entries = [];
  for (const item of tasks) {
    validateDispatchTaskStructure(item.task);
    if (!checkpointMatchesTask(item.checkpoint, item.task)) {
      throw new Error(`Wave task checkpoint does not match dispatch '${item.task.taskId}'.`);
    }
    entries.push({
      taskId: item.task.taskId,
      dispatchId: item.task.dispatchId,
      taskFile: item.taskFile,
      taskSha256: await fileSha256(root, item.taskFile, "Wave dispatch task"),
      checkpointFile: item.checkpointFile,
      checkpointSha256: await fileSha256(root, item.checkpointFile, "Wave dispatch checkpoint"),
      status: "pending",
      currentAttemptId: null,
      executionReceiptFile: null,
      executionReceiptSha256: null,
      integrationReceiptFile: null,
      integrationReceiptSha256: null,
      startedAt: null,
      workerReadyAt: null,
      integratedAt: null,
    });
  }
  return {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    phase: "implementation",
    preparedRevision: state.runtime.revision,
    waveId,
    waveIndex: wave.waveIndex,
    taskDagFile: wave.taskDagFile,
    taskDagSha256: wave.taskDagSha256,
    wavePlanFile: wave.planFile,
    wavePlanSha256: wave.planSha256,
    creationReceiptFile: wave.creationReceiptFile,
    creationReceiptSha256: wave.creationReceiptSha256,
    baseCommit: wave.plan.baseCommit,
    status: "prepared",
    tasks: entries,
    integrationManifestFile: null,
    integrationManifestSha256: null,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    preparedAt: timestamp,
    finalizedAt: null,
  };
}

export async function createWaveExecutionLedger(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const ledgerFile = ledgerFileFor(options.state, options.waveId);
  const ledgerPath = resolveInsideRoot(root, ledgerFile, "Wave execution ledger").fullPath;
  const existingInfo = await lstat(ledgerPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existingInfo) {
    const existing = validateWaveExecutionLedger(await readJsonFile(ledgerPath, "Wave execution ledger"));
    const expected = await expectedLedger({
      ...options,
      root,
      timestamp: existing.preparedAt,
    });
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new Error("Existing Wave execution ledger drifted from current dispatch or wave evidence.");
    }
    return { command: "prepare", reused: true, ledgerFile, ledger: existing };
  }
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const ledger = await expectedLedger({ ...options, root, timestamp });
  validateWaveExecutionLedger(ledger);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  let handle;
  try {
    handle = await open(ledgerPath, "wx");
    await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      const existing = validateWaveExecutionLedger(await readJsonFile(ledgerPath, "Wave execution ledger"));
      const expected = await expectedLedger({
        ...options,
        root,
        timestamp: existing.preparedAt,
      });
      if (JSON.stringify(existing) !== JSON.stringify(expected)) {
        throw new Error("Existing Wave execution ledger drifted from current dispatch or wave evidence.");
      }
      return { command: "prepare", reused: true, ledgerFile, ledger: existing };
    }
    if (handle) await unlink(ledgerPath).catch(() => {});
    throw error;
  }
  return { command: "prepare", reused: false, ledgerFile, ledger };
}

export async function inspectWaveExecution(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const ledgerLocation = resolveInsideRoot(root, options.ledgerFile, "Wave execution ledger");
  const ledger = validateWaveExecutionLedger(
    await readJsonFile(ledgerLocation.fullPath, "Wave execution ledger"),
  );
  const diagnostics = await Promise.all(ledger.tasks.map(async (task) => {
    let executionLockPresent = false;
    if (task.currentAttemptId) {
      const paths = attemptPaths(ledger, task.taskId, task.currentAttemptId);
      executionLockPresent = Boolean(await lstat(
        resolveInsideRoot(root, paths.lockFile, "Wave task execution lock").fullPath,
      ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)));
    }
    return {
      taskId: task.taskId,
      recoveryRequired: task.status === "claiming"
        || task.status === "running"
        || (executionLockPresent
          && (task.status === "blocked" || task.status === "ready-for-integration")),
    };
  }));
  return {
    command: "status",
    ledgerFile: ledgerLocation.relative,
    ledger,
    diagnostics,
  };
}

export async function claimWaveTask(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const now = options.now ?? (() => new Date().toISOString());
  const randomUUID = options.randomUUID ?? createRandomUUID;
  if (typeof options.expectedWaveLedgerSha256 !== "string"
      || !SHA256_PATTERN.test(options.expectedWaveLedgerSha256)
      || typeof options.expectedCreationReceiptSha256 !== "string"
      || !SHA256_PATTERN.test(options.expectedCreationReceiptSha256)) {
    throw new Error("Wave task claim requires expected ledger and creation receipt hashes.");
  }
  const attemptId = token("attempt", randomUUID);
  const claimId = token("claim", randomUUID);
  const lockId = token("lock", randomUUID);
  const timestamp = now();
  let claimedTask;
  let previousAttemptId = null;
  let claim;
  let paths;
  let claimedLedger = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now,
    expectedSha256: options.expectedWaveLedgerSha256,
    mutate: async (ledger) => {
      if (ledger.creationReceiptSha256 !== options.expectedCreationReceiptSha256) {
        throw new Error("Wave creation receipt hash changed before task claim.");
      }
      const task = ledger.tasks.find((item) => item.taskId === options.taskId);
      if (!task) throw new Error(`Unknown Wave execution task '${options.taskId}'.`);
      if (options.retryFromBlocked === true) {
        if (options.confirmWaveTaskRetry !== true) {
          throw new Error("Wave task retry requires ConfirmWaveTaskRetry.");
        }
        if (task.status !== "blocked" || typeof task.currentAttemptId !== "string") {
          throw new Error(`Wave task '${options.taskId}' is not blocked.`);
        }
        if (typeof options.expectedPreviousFailureSha256 !== "string"
            || !SHA256_PATTERN.test(options.expectedPreviousFailureSha256)) {
          throw new Error("Wave task retry requires the previous failure hash.");
        }
        previousAttemptId = task.currentAttemptId;
        const previousPaths = attemptPaths(ledger, task.taskId, previousAttemptId);
        if (await fileSha256(root, previousPaths.failureFile, "Previous Wave attempt failure")
            !== options.expectedPreviousFailureSha256) {
          throw new Error("Previous Wave attempt failure hash changed before retry.");
        }
        const previousFailure = await readJsonFile(
          resolveInsideRoot(root, previousPaths.failureFile, "Previous Wave attempt failure").fullPath,
          "Previous Wave attempt failure",
        );
        if (previousFailure.status !== "blocked"
            || previousFailure.taskId !== task.taskId
            || previousFailure.attemptId !== previousAttemptId) {
          throw new Error("Previous Wave attempt failure does not match the blocked task.");
        }
        const lockInfo = await lstat(
          resolveInsideRoot(root, previousPaths.lockFile, "Previous Wave task execution lock").fullPath,
        ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
        if (lockInfo) throw new Error("Blocked Wave task execution lock must be released before retry.");
        task.executionReceiptFile = null;
        task.executionReceiptSha256 = null;
        task.startedAt = null;
        task.workerReadyAt = null;
      } else if (task.status !== "pending") {
        throw new Error(`Wave task '${options.taskId}' is not pending.`);
      }
      if (ledger.integrationManifestFile !== null || ledger.integrationManifestSha256 !== null) {
        throw new Error("Wave task claim is closed after integration manifest preparation begins.");
      }
      task.status = "claiming";
      task.currentAttemptId = attemptId;
      claimedTask = structuredClone(task);
      paths = attemptPaths(ledger, task.taskId, attemptId);
      claim = {
        schemaVersion: "1.0",
        storyId: ledger.storyId,
        runId: ledger.runId,
        phase: ledger.phase,
        waveId: ledger.waveId,
        waveIndex: ledger.waveIndex,
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        attemptId,
        claimId,
        lockId,
        wavePlanSha256: ledger.wavePlanSha256,
        creationReceiptSha256: ledger.creationReceiptSha256,
        taskSha256: task.taskSha256,
        checkpointSha256: task.checkpointSha256,
        claimFile: paths.claimFile,
        lockFile: paths.lockFile,
        claimedAt: timestamp,
      };
      validateClaim(claim, ledger, task, paths);
      await writeExclusiveJson(root, paths.claimFile, claim, "Wave attempt claim");
      if (options.afterClaimEvidenceWriteBeforeLedgerCommit) {
        await options.afterClaimEvidenceWriteBeforeLedgerCommit({ claim, paths });
      }
    },
  });
  const task = claimedLedger.tasks.find((item) => item.taskId === options.taskId);
  validateClaim(claim, claimedLedger, task, paths);
  if (options.afterClaimWrite) await options.afterClaimWrite({ claim, paths });
  const lock = {
    schemaVersion: "1.0",
    storyId: claim.storyId,
    runId: claim.runId,
    waveId: claim.waveId,
    taskId: claim.taskId,
    attemptId,
    claimId,
    lockId,
    pid: process.pid,
    createdAt: timestamp,
  };
  validateExecutionLock(lock, claim);
  await writeExclusiveJson(root, paths.lockFile, lock, "Wave task execution lock");
  if (options.afterExecutionLockWrite) await options.afterExecutionLockWrite({ claim, lock, paths });
  claimedLedger = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now,
    mutate: async (ledger) => {
      if (ledger.creationReceiptSha256 !== options.expectedCreationReceiptSha256) {
        throw new Error("Wave creation receipt hash changed before task execution.");
      }
      const current = ledger.tasks.find((item) => item.taskId === options.taskId);
      if (current?.status !== "claiming" || current.currentAttemptId !== attemptId) {
        throw new Error("Wave task claim owner changed before running.");
      }
      const currentClaim = validateClaim(
        await readJsonFile(
          resolveInsideRoot(root, paths.claimFile, "Wave attempt claim").fullPath,
          "Wave attempt claim",
        ),
        ledger,
        current,
        paths,
      );
      validateExecutionLock(
        await readJsonFile(
          resolveInsideRoot(root, paths.lockFile, "Wave task execution lock").fullPath,
          "Wave task execution lock",
        ),
        currentClaim,
      );
      current.status = "running";
      current.startedAt = timestamp;
      claimedTask = structuredClone(current);
    },
  });
  return {
    command: "claim-task",
    ledgerFile: options.ledgerFile,
    ledger: claimedLedger,
    task: claimedTask,
    claim,
    lock,
    paths,
    previousAttemptId,
  };
}

export async function assertAttemptOwned({
  root,
  ledgerFile,
  taskId,
  attemptId,
  claimId,
  lockId,
  lockFile,
  expectedExecutionLockSha256,
  expectedCreationReceiptSha256,
  allowedStatuses,
}) {
  const resolvedRoot = path.resolve(root ?? process.cwd());
  const ledger = validateWaveExecutionLedger(await readJsonFile(
    resolveInsideRoot(resolvedRoot, ledgerFile, "Wave execution ledger").fullPath,
    "Wave execution ledger",
  ));
  const task = ledger.tasks.find((item) => item.taskId === taskId);
  const allowedStatusSet = optionsAllowedStatuses(allowedStatuses);
  if (!task
      || !allowedStatusSet.has(task.status)
      || task.currentAttemptId !== attemptId
      || ledger.integrationManifestFile !== null
      || ledger.integrationManifestSha256 !== null) {
    throw new Error("Wave task attempt owner changed.");
  }
  const paths = attemptPaths(ledger, taskId, attemptId);
  if (lockFile !== paths.lockFile) throw new Error("Wave task attempt lock path changed.");
  const claim = validateClaim(
    await readJsonFile(
      resolveInsideRoot(resolvedRoot, paths.claimFile, "Wave attempt claim").fullPath,
      "Wave attempt claim",
    ),
    ledger,
    task,
    paths,
  );
  const currentLockSha256 = await fileSha256(resolvedRoot, lockFile, "Wave task execution lock");
  if (expectedExecutionLockSha256 && currentLockSha256 !== expectedExecutionLockSha256) {
    throw new Error("Wave task execution lock hash changed.");
  }
  const lock = validateExecutionLock(
    await readJsonFile(
      resolveInsideRoot(resolvedRoot, lockFile, "Wave task execution lock").fullPath,
      "Wave task execution lock",
    ),
    claim,
  );
  if (claim.claimId !== claimId
      || claim.lockId !== lockId
      || lock.attemptId !== attemptId
      || lock.claimId !== claimId
      || lock.lockId !== lockId) {
    throw new Error("Wave task attempt owner changed.");
  }
  if (await fileSha256(resolvedRoot, task.taskFile, "Wave dispatch task") !== task.taskSha256
      || await fileSha256(resolvedRoot, task.checkpointFile, "Wave dispatch checkpoint") !== task.checkpointSha256
      || await fileSha256(resolvedRoot, ledger.taskDagFile, "Wave Task DAG") !== ledger.taskDagSha256
      || await fileSha256(resolvedRoot, ledger.wavePlanFile, "Wave Worktree plan") !== ledger.wavePlanSha256
      || await fileSha256(resolvedRoot, ledger.creationReceiptFile, "Wave creation receipt") !== ledger.creationReceiptSha256
      || (expectedCreationReceiptSha256
        && ledger.creationReceiptSha256 !== expectedCreationReceiptSha256)) {
    throw new Error("Wave task dispatch evidence changed.");
  }
  return { ledger, task, claim, lock, lockSha256: currentLockSha256, paths };
}

function optionsAllowedStatuses(value) {
  const statuses = value ?? ["running"];
  if (!Array.isArray(statuses) || !statuses.length
      || statuses.some((status) => !TASK_STATUSES.has(status))) {
    throw new Error("Wave task attempt owner status scope is invalid.");
  }
  return new Set(statuses);
}

function validateExecutionReceipt(receipt, ledger, task, owner, paths) {
  assertExactFields(receipt, [
    "schemaVersion", "storyId", "runId", "phase", "waveId", "waveIndex",
    "taskId", "dispatchId", "attemptId", "claimId", "lockId",
    "baseCommit", "worktreePath", "headCommit",
    "inputSnapshotFile", "inputSnapshotSha256",
    "resultFile", "resultSha256", "outcome", "files", "completedAt",
  ], "Wave task execution receipt");
  if (receipt.schemaVersion !== "1.0"
      || receipt.storyId !== ledger.storyId
      || receipt.runId !== ledger.runId
      || receipt.phase !== ledger.phase
      || receipt.waveId !== ledger.waveId
      || receipt.waveIndex !== ledger.waveIndex
      || receipt.taskId !== task.taskId
      || receipt.dispatchId !== task.dispatchId
      || receipt.attemptId !== owner.attemptId
      || receipt.claimId !== owner.claimId
      || receipt.lockId !== owner.lockId
      || receipt.baseCommit !== ledger.baseCommit
      || typeof receipt.worktreePath !== "string" || !receipt.worktreePath
      || receipt.headCommit !== ledger.baseCommit
      || receipt.inputSnapshotFile !== paths.inputSnapshotFile
      || !SHA256_PATTERN.test(receipt.inputSnapshotSha256)
      || receipt.resultFile !== paths.resultFile
      || !SHA256_PATTERN.test(receipt.resultSha256)
      || receipt.outcome !== "ready-for-integration"
      || !Array.isArray(receipt.files)
      || typeof receipt.completedAt !== "string" || Number.isNaN(Date.parse(receipt.completedAt))) {
    throw new Error("Wave task execution receipt does not match the current attempt.");
  }
  const fileKeys = new Set();
  for (const file of receipt.files) {
    assertExactFields(file, ["path", "sha256", "bytes", "kind"], "Wave task execution receipt file");
    const key = process.platform === "win32" ? file.path.toLowerCase() : file.path;
    if (typeof file.path !== "string" || !file.path
        || !SHA256_PATTERN.test(file.sha256)
        || !Number.isInteger(file.bytes) || file.bytes < 0
        || !["phase-output", "backend", "frontend"].includes(file.kind)
        || fileKeys.has(key)) {
      throw new Error("Wave task execution receipt contains invalid candidate evidence.");
    }
    fileKeys.add(key);
  }
  return receipt;
}

export async function recordWaveTaskReady(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const owner = await assertAttemptOwned(options);
  const receiptSha256 = await fileSha256(root, owner.paths.receiptFile, "Wave task execution receipt");
  if (receiptSha256 !== options.expectedExecutionReceiptSha256) {
    throw new Error("Wave task execution receipt hash changed before readiness.");
  }
  const receipt = validateExecutionReceipt(
    await readJsonFile(
      resolveInsideRoot(root, owner.paths.receiptFile, "Wave task execution receipt").fullPath,
      "Wave task execution receipt",
    ),
    owner.ledger,
    owner.task,
    options,
    owner.paths,
  );
  if (await fileSha256(root, receipt.inputSnapshotFile, "Wave task input snapshot") !== receipt.inputSnapshotSha256
      || await fileSha256(root, receipt.resultFile, "Wave task result") !== receipt.resultSha256) {
    throw new Error("Wave task execution receipt evidence changed before readiness.");
  }
  const ledger = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now: options.now,
    mutate: async (currentLedger) => {
      await assertAttemptOwned(options);
      const current = currentLedger.tasks.find((item) => item.taskId === options.taskId);
      if (!current
          || current.status !== "running"
          || current.currentAttemptId !== options.attemptId) {
        throw new Error("Wave task attempt owner changed before readiness.");
      }
      current.status = "ready-for-integration";
      current.executionReceiptFile = owner.paths.receiptFile;
      current.executionReceiptSha256 = receiptSha256;
      current.workerReadyAt = receipt.completedAt;
    },
  });
  return {
    command: "record-ready",
    ledgerFile: options.ledgerFile,
    ledger,
    task: ledger.tasks.find((item) => item.taskId === options.taskId),
    receiptFile: owner.paths.receiptFile,
    receipt,
  };
}

function validateAttemptFailure(
  failure,
  ledger,
  task,
  owner,
  paths,
  allowedStatuses = ["blocked"],
) {
  assertExactFields(failure, [
    "schemaVersion", "storyId", "runId", "waveId", "taskId",
    "attemptId", "claimId", "lockId", "status", "reason",
    "claimSha256", "executionLockSha256", "recoveredAt",
  ], "Wave attempt failure");
  if (failure.schemaVersion !== "1.0"
      || failure.storyId !== ledger.storyId
      || failure.runId !== ledger.runId
      || failure.waveId !== ledger.waveId
      || failure.taskId !== task.taskId
      || failure.attemptId !== owner.attemptId
      || failure.claimId !== owner.claimId
      || failure.lockId !== owner.lockId
      || !allowedStatuses.includes(failure.status)
      || typeof failure.reason !== "string" || !failure.reason
      || !SHA256_PATTERN.test(failure.claimSha256)
      || failure.executionLockSha256 !== owner.expectedExecutionLockSha256
      || typeof failure.recoveredAt !== "string" || Number.isNaN(Date.parse(failure.recoveredAt))) {
    throw new Error("Wave attempt failure does not match the current attempt.");
  }
  return failure;
}

async function recoveredWorktreeChanges(worktreeRoot) {
  const result = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"],
    {
      cwd: worktreeRoot,
      windowsHide: true,
      shell: false,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const tokens = String(result.stdout ?? "").split("\0").filter(Boolean);
  return tokens.map((record) => {
    const status = record.slice(0, 2);
    const relative = normalizePath(record.slice(3));
    if (!relative || status.includes("R") || status.includes("C") || status.includes("D")) {
      throw new Error("Recovered Wave Worktree contains a rename, copy, deletion, or invalid path.");
    }
    return relative;
  });
}

async function validateRecoveredReadyEvidence(root, options, ledger, task, owner, paths) {
  const dispatchTask = validateDispatchTaskStructure(await readJsonFile(
    resolveInsideRoot(root, task.taskFile, "Wave dispatch task").fullPath,
    "Wave dispatch task",
  ));
  const receipt = validateExecutionReceipt(
    await readJsonFile(
      resolveInsideRoot(root, paths.receiptFile, "Wave task execution receipt").fullPath,
      "Wave task execution receipt",
    ),
    ledger,
    task,
    owner,
    paths,
  );
  if (await fileSha256(root, receipt.inputSnapshotFile, "Wave task input snapshot")
        !== receipt.inputSnapshotSha256
      || await fileSha256(root, receipt.resultFile, "Wave task result") !== receipt.resultSha256) {
    throw new Error("Recovered Wave task receipt evidence hash changed.");
  }
  const result = validateDispatchResultStructure(await readJsonFile(
    resolveInsideRoot(root, paths.resultFile, "Wave task result").fullPath,
    "Wave task result",
  ));
  if (result.schemaVersion !== "1.2"
      || result.status !== "completed"
      || result.dispatchId !== task.dispatchId
      || result.storyId !== ledger.storyId
      || result.runId !== ledger.runId
      || result.phase !== ledger.phase
      || result.waveId !== ledger.waveId
      || result.waveIndex !== ledger.waveIndex
      || result.taskId !== task.taskId) {
    throw new Error("Recovered Wave task result does not match the current attempt.");
  }
  const snapshot = await readJsonFile(
    resolveInsideRoot(root, paths.inputSnapshotFile, "Wave task input snapshot").fullPath,
    "Wave task input snapshot",
  );
  if (!Array.isArray(snapshot.inputs)) {
    throw new Error("Recovered Wave task input snapshot is invalid.");
  }
  const { runWorktreeCommand } = await import("./worktree-runtime.mjs");
  const inspected = await runWorktreeCommand({
    root,
    command: "wave-status",
    stateFile: options.stateFile,
    taskDagFile: ledger.taskDagFile,
    waveIndex: ledger.waveIndex,
  });
  const planTask = inspected.plan.tasks.find((item) => item.taskId === task.taskId);
  const statusTask = inspected.status.tasks.find((item) => item.taskId === task.taskId);
  if (inspected.planFile !== ledger.wavePlanFile
      || inspected.status.state !== "ready"
      || inspected.status.wavePlanSha256 !== ledger.wavePlanSha256
      || !planTask
      || !statusTask
      || statusTask.state !== "created"
      || statusTask.headCommit !== ledger.baseCommit
      || receipt.worktreePath !== planTask.worktreePath) {
    throw new Error("Recovered Wave task Worktree status does not match the ledger.");
  }
  const worktreeRoot = resolveInsideRoot(root, planTask.worktreePath, "Wave task Worktree path").fullPath;
  const head = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: worktreeRoot,
    windowsHide: true,
    shell: false,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (String(head.stdout ?? "").trim() !== ledger.baseCommit) {
    throw new Error("Recovered Wave task Worktree HEAD changed.");
  }
  const allowed = new Set([
    ...snapshot.inputs.map((input) => input.targetPath),
    ...receipt.files.map((file) => file.path),
    paths.resultFile,
  ].map((file) => process.platform === "win32" ? file.toLowerCase() : file));
  for (const relative of await recoveredWorktreeChanges(worktreeRoot)) {
    const key = process.platform === "win32" ? relative.toLowerCase() : relative;
    if (!allowed.has(key)) throw new Error(`Recovered Wave Worktree contains an orphan candidate: ${relative}`);
  }
  for (const input of snapshot.inputs) {
    if (!input || typeof input.targetPath !== "string" || !SHA256_PATTERN.test(input.sha256)) {
      throw new Error("Recovered Wave task input snapshot contains invalid evidence.");
    }
    const isCandidate = receipt.files.some((file) => {
      const left = process.platform === "win32" ? file.path.toLowerCase() : file.path;
      const right = process.platform === "win32" ? input.targetPath.toLowerCase() : input.targetPath;
      return left === right;
    });
    if (!isCandidate
        && await fileSha256(worktreeRoot, input.targetPath, "Recovered Wave task input") !== input.sha256) {
      throw new Error(`Recovered Wave task input changed: ${input.targetPath}`);
    }
  }
  for (const file of receipt.files) {
    const location = resolveInsideRoot(worktreeRoot, file.path, "Recovered Wave task candidate");
    const info = await lstat(location.fullPath);
    if (!info.isFile() || info.isSymbolicLink()
        || info.size !== file.bytes
        || await fileSha256(worktreeRoot, file.path, "Recovered Wave task candidate") !== file.sha256) {
      throw new Error(`Recovered Wave task candidate changed: ${file.path}`);
    }
    if (file.kind === "phase-output" && !dispatchTask.expectedOutputs.includes(file.path)) {
      throw new Error(`Recovered Wave task phase output is not expected: ${file.path}`);
    }
    if (file.kind !== "phase-output"
        && !planTask.predictedFiles.some((predicted) => matchesPredictedFile(predicted, file.path))) {
      throw new Error(`Recovered Wave task candidate is outside predicted files: ${file.path}`);
    }
  }
  if (await fileSha256(worktreeRoot, paths.resultFile, "Recovered Worktree result") !== receipt.resultSha256) {
    throw new Error("Recovered Wave Worktree result changed.");
  }
  return receipt;
}

async function orphanWorktreeChanges(root, options, ledger, task, paths) {
  if (typeof options.stateFile !== "string" || !options.stateFile) {
    throw new Error("Running Wave attempt recovery requires stateFile for Worktree verification.");
  }
  const { runWorktreeCommand } = await import("./worktree-runtime.mjs");
  const inspected = await runWorktreeCommand({
    root,
    command: "wave-status",
    stateFile: options.stateFile,
    taskDagFile: ledger.taskDagFile,
    waveIndex: ledger.waveIndex,
  });
  const planTask = inspected.plan.tasks.find((item) => item.taskId === task.taskId);
  const statusTask = inspected.status.tasks.find((item) => item.taskId === task.taskId);
  if (!planTask
      || !statusTask
      || statusTask.state !== "created"
      || statusTask.headCommit !== ledger.baseCommit) {
    throw new Error("Running Wave attempt Worktree does not match the ledger.");
  }
  const worktreeRoot = resolveInsideRoot(root, planTask.worktreePath, "Wave task Worktree path").fullPath;
  const allowed = new Set();
  const snapshotInfo = await lstat(
    resolveInsideRoot(root, paths.inputSnapshotFile, "Wave task input snapshot").fullPath,
  ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (snapshotInfo) {
    const snapshot = await readJsonFile(
      resolveInsideRoot(root, paths.inputSnapshotFile, "Wave task input snapshot").fullPath,
      "Wave task input snapshot",
    );
    if (!Array.isArray(snapshot.inputs)) throw new Error("Wave task input snapshot is invalid.");
    for (const input of snapshot.inputs) {
      if (!input || typeof input.targetPath !== "string" || !SHA256_PATTERN.test(input.sha256)
          || await fileSha256(worktreeRoot, input.targetPath, "Recovered Wave task input") !== input.sha256) {
        throw new Error("Recovered Wave task input snapshot drifted.");
      }
      allowed.add(process.platform === "win32" ? input.targetPath.toLowerCase() : input.targetPath);
    }
  }
  return (await recoveredWorktreeChanges(worktreeRoot)).filter((relative) => {
    const key = process.platform === "win32" ? relative.toLowerCase() : relative;
    return !allowed.has(key);
  });
}

export async function recordWaveTaskBlocked(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const owner = await assertAttemptOwned(options);
  const failureSha256 = await fileSha256(root, owner.paths.failureFile, "Wave attempt failure");
  if (failureSha256 !== options.expectedFailureSha256) {
    throw new Error("Wave attempt failure hash changed before blocking.");
  }
  const failure = validateAttemptFailure(
    await readJsonFile(
      resolveInsideRoot(root, owner.paths.failureFile, "Wave attempt failure").fullPath,
      "Wave attempt failure",
    ),
    owner.ledger,
    owner.task,
    options,
    owner.paths,
  );
  if (await fileSha256(root, owner.paths.claimFile, "Wave attempt claim") !== failure.claimSha256) {
    throw new Error("Wave attempt claim changed before blocking.");
  }
  const ledger = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now: options.now,
    mutate: async (currentLedger) => {
      await assertAttemptOwned(options);
      const current = currentLedger.tasks.find((item) => item.taskId === options.taskId);
      if (!current
          || current.status !== "running"
          || current.currentAttemptId !== options.attemptId) {
        throw new Error("Wave task attempt owner changed before blocking.");
      }
      current.status = "blocked";
    },
  });
  return {
    command: "record-blocked",
    ledgerFile: options.ledgerFile,
    ledger,
    task: ledger.tasks.find((item) => item.taskId === options.taskId),
    failureFile: owner.paths.failureFile,
    failure,
  };
}

function settlementSummary(settlement, taskId) {
  if (settlement.status === "fulfilled") {
    return {
      taskId,
      status: "fulfilled",
      outcome: settlement.value?.outcome ?? null,
      reason: null,
    };
  }
  return {
    taskId,
    status: "rejected",
    outcome: null,
    reason: settlement.reason instanceof Error
      ? settlement.reason.message
      : String(settlement.reason),
  };
}

async function executeWave(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.confirmWaveExecute !== true) {
    throw new Error("Wave execution requires ConfirmWaveExecute.");
  }
  if (typeof options.expectedWaveLedgerSha256 !== "string"
      || !SHA256_PATTERN.test(options.expectedWaveLedgerSha256)
      || typeof options.expectedCreationReceiptSha256 !== "string"
      || !SHA256_PATTERN.test(options.expectedCreationReceiptSha256)) {
    throw new Error("Wave execution requires expected ledger and creation receipt hashes.");
  }
  if (await fileSha256(root, options.ledgerFile, "Wave execution ledger")
      !== options.expectedWaveLedgerSha256) {
    throw new Error("Wave execution ledger hash changed before execution.");
  }
  const initial = validateWaveExecutionLedger(await readJsonFile(
    resolveInsideRoot(root, options.ledgerFile, "Wave execution ledger").fullPath,
    "Wave execution ledger",
  ));
  if (initial.creationReceiptSha256 !== options.expectedCreationReceiptSha256
      || await fileSha256(root, initial.creationReceiptFile, "Wave creation receipt")
        !== options.expectedCreationReceiptSha256) {
    throw new Error("Wave creation receipt hash changed before execution.");
  }
  if (initial.integrationManifestFile !== null || initial.integrationManifestSha256 !== null) {
    throw new Error("Wave execution is closed after integration manifest preparation begins.");
  }

  const claimed = [];
  for (const task of initial.tasks.filter((item) => item.status === "pending")) {
    const claim = await claimWaveTask({
      root,
      ledgerFile: options.ledgerFile,
      taskId: task.taskId,
      expectedWaveLedgerSha256: await fileSha256(root, options.ledgerFile, "Wave execution ledger"),
      expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
      now: options.now,
      randomUUID: options.randomUUID,
    });
    claimed.push({
      ...claim,
      executionLockSha256: await fileSha256(root, claim.paths.lockFile, "Wave task execution lock"),
    });
  }

  const { runWorktreeWorker } = await import("./worktree-worker-runtime.mjs");
  const workerRunner = options.workerRunner ?? runWorktreeWorker;
  const settlements = await Promise.allSettled(claimed.map((claim) => workerRunner({
    root,
    stateFile: options.stateFile,
    taskId: claim.task.taskId,
    taskFile: claim.task.taskFile,
    ledgerFile: options.ledgerFile,
    attemptId: claim.claim.attemptId,
    claimId: claim.claim.claimId,
    lockId: claim.claim.lockId,
    expectedExecutionLockSha256: claim.executionLockSha256,
    expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
    provider: options.provider,
    timeoutMs: options.timeoutMs,
    contextFiles: options.contextFilesByTask?.[claim.task.taskId] ?? [],
    now: options.now,
  })));
  const inspected = await inspectWaveExecution({
    root,
    ledgerFile: options.ledgerFile,
  });
  return {
    command: "execute-wave",
    ledgerFile: options.ledgerFile,
    claimedTaskIds: claimed.map((item) => item.task.taskId),
    settled: settlements.map((settlement, index) => settlementSummary(
      settlement,
      claimed[index].task.taskId,
    )),
    ledger: inspected.ledger,
    diagnostics: inspected.diagnostics,
  };
}

async function retryWaveTask(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.confirmWaveTaskRetry !== true) {
    throw new Error("Wave task retry requires ConfirmWaveTaskRetry.");
  }
  if (await fileSha256(root, options.ledgerFile, "Wave execution ledger")
      !== options.expectedWaveLedgerSha256) {
    throw new Error("Wave execution ledger hash changed before retry.");
  }
  const claim = await claimWaveTask({
    ...options,
    root,
    retryFromBlocked: true,
  });
  const executionLockSha256 = await fileSha256(
    root,
    claim.paths.lockFile,
    "Wave task execution lock",
  );
  const { runWorktreeWorker } = await import("./worktree-worker-runtime.mjs");
  const workerRunner = options.workerRunner ?? runWorktreeWorker;
  const settlement = await Promise.allSettled([workerRunner({
    root,
    stateFile: options.stateFile,
    taskId: claim.task.taskId,
    taskFile: claim.task.taskFile,
    ledgerFile: options.ledgerFile,
    attemptId: claim.claim.attemptId,
    claimId: claim.claim.claimId,
    lockId: claim.claim.lockId,
    expectedExecutionLockSha256: executionLockSha256,
    expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
    provider: options.provider,
    timeoutMs: options.timeoutMs,
    contextFiles: options.contextFiles ?? [],
    now: options.now,
  })]);
  const inspected = await inspectWaveExecution({
    root,
    ledgerFile: options.ledgerFile,
  });
  return {
    command: "retry-task",
    ledgerFile: options.ledgerFile,
    previousAttemptId: claim.previousAttemptId,
    attemptId: claim.claim.attemptId,
    settled: settlementSummary(settlement[0], claim.task.taskId),
    ledger: inspected.ledger,
    task: inspected.ledger.tasks.find((item) => item.taskId === claim.task.taskId),
  };
}

export async function runWaveExecutionCommand(options = {}) {
  if (options.command === "status") return inspectWaveExecution(options);
  if (options.command === "execute-wave") return executeWave(options);
  if (options.command === "retry-task") return retryWaveTask(options);
  if (options.command === "recover-attempt") return recoverAttempt(options);
  throw new Error(`Unsupported Wave execution command: ${options.command ?? "(missing)"}`);
}

export async function recoverAttempt(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const now = options.now ?? (() => new Date().toISOString());
  if (options.confirmAttemptRecovery !== true) {
    throw new Error("Attempt recovery requires ConfirmAttemptRecovery.");
  }
  const ledgerPath = resolveInsideRoot(root, options.ledgerFile, "Wave execution ledger").fullPath;
  const ledger = validateWaveExecutionLedger(await readJsonFile(ledgerPath, "Wave execution ledger"));
  if (ledger.creationReceiptSha256 !== options.expectedCreationReceiptSha256) {
    throw new Error("Wave creation receipt hash changed before attempt recovery.");
  }
  const task = ledger.tasks.find((item) => item.taskId === options.taskId);
  if (!task || !["claiming", "running", "blocked", "ready-for-integration"].includes(task.status)
      || task.currentAttemptId !== options.expectedAttemptId) {
    throw new Error("Expected attempt is not the current recoverable task attempt.");
  }
  const paths = attemptPaths(ledger, task.taskId, task.currentAttemptId);
  const claimPath = resolveInsideRoot(root, paths.claimFile, "Wave attempt claim").fullPath;
  if (await fileSha256(root, paths.claimFile, "Wave attempt claim") !== options.expectedClaimSha256) {
    throw new Error("Wave attempt claim hash changed before recovery.");
  }
  const claim = validateClaim(await readJsonFile(claimPath, "Wave attempt claim"), ledger, task, paths);
  const lockPath = resolveInsideRoot(root, paths.lockFile, "Wave task execution lock").fullPath;
  const lockInfo = await lstat(lockPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  let lock = null;
  let lockSha256 = null;
  if (lockInfo) {
    lockSha256 = await fileSha256(root, paths.lockFile, "Wave task execution lock");
    if (lockSha256 !== options.expectedExecutionLockSha256) {
      throw new Error("Wave task execution lock hash changed before recovery.");
    }
    lock = validateExecutionLock(await readJsonFile(lockPath, "Wave task execution lock"), claim);
  } else if (options.expectedExecutionLockSha256) {
    throw new Error("Expected Wave task execution lock is missing.");
  }
  const resultInfo = await lstat(resolveInsideRoot(root, paths.resultFile, "Wave task result").fullPath)
    .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  const receiptInfo = await lstat(resolveInsideRoot(root, paths.receiptFile, "Wave task execution receipt").fullPath)
    .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  const failureInfo = await lstat(resolveInsideRoot(root, paths.failureFile, "Wave attempt failure").fullPath)
    .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  let abandonedFailure = null;
  if (failureInfo && ["claiming", "running"].includes(task.status)) {
    const existingFailure = await readJsonFile(
      resolveInsideRoot(root, paths.failureFile, "Wave attempt failure").fullPath,
      "Wave attempt failure",
    );
    if (existingFailure.status === "abandoned") {
      if (resultInfo || receiptInfo) {
        throw new Error("Abandoned Wave attempt recovery evidence is contradictory.");
      }
      abandonedFailure = validateAttemptFailure(
        existingFailure,
        ledger,
        task,
        {
          attemptId: claim.attemptId,
          claimId: claim.claimId,
          lockId: claim.lockId,
          expectedExecutionLockSha256: lockSha256,
        },
        paths,
        ["abandoned"],
      );
      if (await fileSha256(root, paths.claimFile, "Wave attempt claim")
          !== abandonedFailure.claimSha256) {
        throw new Error("Abandoned Wave attempt failure evidence changed.");
      }
    }
  }
  if (task.status === "ready-for-integration") {
    if (!lock || !lockSha256 || !resultInfo || !receiptInfo || failureInfo) {
      throw new Error("Ready Wave attempt recovery evidence is incomplete or contradictory.");
    }
    const ownerOptions = {
      root,
      ledgerFile: options.ledgerFile,
      taskId: task.taskId,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      lockId: claim.lockId,
      lockFile: paths.lockFile,
      expectedExecutionLockSha256: lockSha256,
      expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
      allowedStatuses: ["ready-for-integration"],
    };
    await assertAttemptOwned(ownerOptions);
    const receipt = await validateRecoveredReadyEvidence(
      root,
      options,
      ledger,
      task,
      ownerOptions,
      paths,
    );
    const receiptSha256 = await fileSha256(root, paths.receiptFile, "Wave task execution receipt");
    if (task.executionReceiptFile !== paths.receiptFile
        || task.executionReceiptSha256 !== receiptSha256
        || task.workerReadyAt !== receipt.completedAt) {
      throw new Error("Ready Wave attempt ledger binding changed.");
    }
    if (await fileSha256(root, paths.lockFile, "Wave task execution lock") !== lockSha256) {
      throw new Error("Wave task execution lock changed before ready recovery release.");
    }
    await unlink(lockPath);
    return {
      command: "recover-attempt",
      ledgerFile: options.ledgerFile,
      ledger,
      task,
      receiptFile: paths.receiptFile,
      receipt,
    };
  }
  if (task.status === "running" && failureInfo && !abandonedFailure) {
    if (!lock || !lockSha256 || resultInfo || receiptInfo) {
      throw new Error("Running Wave attempt failure evidence is incomplete or contradictory.");
    }
    const ownerOptions = {
      root,
      ledgerFile: options.ledgerFile,
      taskId: task.taskId,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      lockId: claim.lockId,
      lockFile: paths.lockFile,
      expectedExecutionLockSha256: lockSha256,
      expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
    };
    await assertAttemptOwned(ownerOptions);
    const failure = validateAttemptFailure(
      await readJsonFile(
        resolveInsideRoot(root, paths.failureFile, "Wave attempt failure").fullPath,
        "Wave attempt failure",
      ),
      ledger,
      task,
      ownerOptions,
      paths,
    );
    if (await fileSha256(root, paths.claimFile, "Wave attempt claim") !== failure.claimSha256
        || await fileSha256(root, paths.lockFile, "Wave task execution lock")
          !== failure.executionLockSha256) {
      throw new Error("Running Wave attempt failure evidence changed.");
    }
    const blocked = await recordWaveTaskBlocked({
      ...ownerOptions,
      expectedFailureSha256: await fileSha256(root, paths.failureFile, "Wave attempt failure"),
      now,
    });
    await assertAttemptOwned({
      ...ownerOptions,
      allowedStatuses: ["blocked"],
    });
    if (await fileSha256(root, paths.lockFile, "Wave task execution lock") !== lockSha256) {
      throw new Error("Wave task execution lock changed before blocked recovery release.");
    }
    await unlink(lockPath);
    return {
      command: "recover-attempt",
      ledgerFile: options.ledgerFile,
      ledger: blocked.ledger,
      task: blocked.task,
      failureFile: paths.failureFile,
      failure,
    };
  }
  if (task.status === "blocked") {
    if (!lock || !lockSha256 || !failureInfo || resultInfo || receiptInfo) {
      throw new Error("Blocked Wave attempt recovery evidence is incomplete or contradictory.");
    }
    const ownerOptions = {
      root,
      ledgerFile: options.ledgerFile,
      taskId: task.taskId,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      lockId: claim.lockId,
      lockFile: paths.lockFile,
      expectedExecutionLockSha256: lockSha256,
      expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
      allowedStatuses: ["blocked"],
    };
    await assertAttemptOwned(ownerOptions);
    const failure = validateAttemptFailure(
      await readJsonFile(
        resolveInsideRoot(root, paths.failureFile, "Wave attempt failure").fullPath,
        "Wave attempt failure",
      ),
      ledger,
      task,
      ownerOptions,
      paths,
    );
    if (await fileSha256(root, paths.claimFile, "Wave attempt claim") !== failure.claimSha256
        || await fileSha256(root, paths.lockFile, "Wave task execution lock")
          !== failure.executionLockSha256) {
      throw new Error("Blocked Wave attempt recovery evidence changed.");
    }
    await unlink(lockPath);
    return {
      command: "recover-attempt",
      ledgerFile: options.ledgerFile,
      ledger,
      task,
      failureFile: paths.failureFile,
      failure,
    };
  }
  if (resultInfo && receiptInfo) {
    if (!lock || !lockSha256) {
      throw new Error("Recovered Wave task result and receipt require the original execution lock.");
    }
    const ownerOptions = {
      root,
      ledgerFile: options.ledgerFile,
      taskId: task.taskId,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      lockId: claim.lockId,
      lockFile: paths.lockFile,
      expectedExecutionLockSha256: lockSha256,
      expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
    };
    await assertAttemptOwned(ownerOptions);
    const receipt = await validateRecoveredReadyEvidence(
      root,
      options,
      ledger,
      task,
      ownerOptions,
      paths,
    );
    const ready = await recordWaveTaskReady({
      ...ownerOptions,
      expectedExecutionReceiptSha256: await fileSha256(
        root,
        paths.receiptFile,
        "Wave task execution receipt",
      ),
      now,
    });
    await assertAttemptOwned({
      ...ownerOptions,
      allowedStatuses: ["ready-for-integration"],
    });
    if (await fileSha256(root, paths.lockFile, "Wave task execution lock") !== lockSha256) {
      throw new Error("Wave task execution lock changed before recovery release.");
    }
    await unlink(lockPath);
    return {
      command: "recover-attempt",
      ledgerFile: options.ledgerFile,
      ledger: ready.ledger,
      task: ready.task,
      receiptFile: paths.receiptFile,
      receipt,
    };
  }
  if (resultInfo || receiptInfo) {
    throw new Error("Attempt recovery found incomplete result evidence and remains blocked.");
  }
  if (task.status === "running" && !abandonedFailure) {
    const orphanChanges = await orphanWorktreeChanges(root, options, ledger, task, paths);
    if (orphanChanges.length) {
      if (!lock || !lockSha256) {
        throw new Error("Orphan Wave Worktree candidates require the original execution lock.");
      }
      const ownerOptions = {
        root,
        ledgerFile: options.ledgerFile,
        taskId: task.taskId,
        attemptId: claim.attemptId,
        claimId: claim.claimId,
        lockId: claim.lockId,
        lockFile: paths.lockFile,
        expectedExecutionLockSha256: lockSha256,
        expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
      };
      await assertAttemptOwned(ownerOptions);
      const failure = {
        schemaVersion: "1.0",
        storyId: ledger.storyId,
        runId: ledger.runId,
        waveId: ledger.waveId,
        taskId: task.taskId,
        attemptId: claim.attemptId,
        claimId: claim.claimId,
        lockId: claim.lockId,
        status: "blocked",
        reason: `Attempt left orphan Worktree candidates without complete result evidence: ${orphanChanges.join(", ")}`,
        claimSha256: options.expectedClaimSha256,
        executionLockSha256: lockSha256,
        recoveredAt: now(),
      };
      await writeExclusiveJson(root, paths.failureFile, failure, "Wave attempt failure");
      const blocked = await recordWaveTaskBlocked({
        ...ownerOptions,
        expectedFailureSha256: await fileSha256(root, paths.failureFile, "Wave attempt failure"),
        now,
      });
      await assertAttemptOwned({
        ...ownerOptions,
        allowedStatuses: ["blocked"],
      });
      if (await fileSha256(root, paths.lockFile, "Wave task execution lock") !== lockSha256) {
        throw new Error("Wave task execution lock changed before orphan recovery release.");
      }
      await unlink(lockPath);
      return {
        command: "recover-attempt",
        ledgerFile: options.ledgerFile,
        ledger: blocked.ledger,
        task: blocked.task,
        failureFile: paths.failureFile,
        failure,
      };
    }
  }
  const failure = abandonedFailure ?? {
    schemaVersion: "1.0",
    storyId: ledger.storyId,
    runId: ledger.runId,
    waveId: ledger.waveId,
    taskId: task.taskId,
    attemptId: claim.attemptId,
    claimId: claim.claimId,
    lockId: claim.lockId,
    status: "abandoned",
    reason: "Attempt ended before result evidence was completed.",
    claimSha256: options.expectedClaimSha256,
    executionLockSha256: lockSha256,
    recoveredAt: now(),
  };
  if (!abandonedFailure) {
    await writeExclusiveJson(root, paths.failureFile, failure, "Wave attempt failure");
  }
  const recoveredLedger = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now,
    afterLockOpenBeforeWrite: options.afterMutationLockOpenBeforeWrite,
    mutate: async (currentLedger) => {
      const current = currentLedger.tasks.find((item) => item.taskId === options.taskId);
      if (!current
          || !["claiming", "running"].includes(current.status)
          || current.currentAttemptId !== claim.attemptId) {
        throw new Error("Wave task attempt owner changed before recovery.");
      }
      current.status = "pending";
      current.currentAttemptId = null;
      current.startedAt = null;
      current.executionReceiptFile = null;
      current.executionReceiptSha256 = null;
      current.workerReadyAt = null;
    },
  });
  if (lock) {
    if (await fileSha256(root, paths.lockFile, "Wave task execution lock") !== lockSha256) {
      throw new Error("Wave task execution lock changed before recovery release.");
    }
    await unlink(lockPath);
  }
  const recoveredTask = recoveredLedger.tasks.find((item) => item.taskId === options.taskId);
  return {
    command: "recover-attempt",
    ledgerFile: options.ledgerFile,
    ledger: recoveredLedger,
    task: recoveredTask,
    failureFile: paths.failureFile,
    failure,
  };
}
