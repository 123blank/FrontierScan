import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDispatchResultStructure, validateDispatchTaskStructure } from "./dispatch-contract.mjs";
import {
  finalizationArtifactPathsFor,
  validateBatchReceiptFinalizationArtifacts,
} from "./batch-finalization-contract.mjs";
import { loadTaskDag, matchesPredictedFile } from "./task-dag-contract.mjs";
import { assertVerifiedBatchBase } from "./batch-base-contract.mjs";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const LEDGER_FIELDS = [
  "schemaVersion", "storyId", "runId", "stateFile", "phase", "preparedRevision", "batchId",
  "taskDagFile", "taskDagSha256", "baseRef", "baseCommit", "ledgerFile", "lockFile",
  "batchPlanFile", "batchPlanSha256", "batchReceiptFile", "batchReceiptSha256", "status",
  "preparedAt", "finalizedAt", "tasks",
];
const TASK_FIELDS = [
  "taskId", "title", "type", "ownerAgent", "wave", "sequence", "dispatchId", "predictedFiles",
  "taskRoot", "taskFile", "resultFile", "checkpointFile", "reportFile", "expectedOutputs",
  "inheritedSnapshotFile", "inheritedSnapshotSha256", "executionReceiptFile", "executionReceiptSha256",
  "integrationReceiptFile", "integrationReceiptSha256", "status", "startedAt", "workerReadyAt", "integratedAt",
];
const BATCH_STATUSES = new Set(["prepared", "active", "blocked", "ready-for-finalization", "finalized"]);
const TASK_STATUSES = new Set(["pending", "running", "ready-for-integration", "integrated", "blocked"]);
const PHASE = "implementation";
const PHASE_DIRECTORY = "03-implementation";
const EXECUTION_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "taskId", "dispatchId", "phase", "ownerAgent",
  "baseCommit", "headCommit", "outcome", "planSha256", "statusSha256", "inputManifestSha256",
  "inheritedSnapshotSha256", "resultEvidenceFile", "resultSha256", "files", "completedAt",
];
const INTEGRATION_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "taskId", "dispatchId", "phase", "ownerAgent",
  "baseCommit", "planSha256", "resultFile", "resultSha256", "appliedFiles", "completedAt",
];
const BATCH_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "phase", "batchId", "taskDagSha256", "baseCommit", "taskCount", "tasks",
  "finalizationArtifacts", "finalizedAt",
];
const INHERITED_SNAPSHOT_FIELDS = [
  "schemaVersion", "storyId", "runId", "phase", "batchId", "taskId", "dispatchId", "taskRoot", "baseCommit",
  "inheritedFiles", "predecessorIntegrationReceipts", "createdAt",
];
const INHERITED_SNAPSHOT_RECEIPT_FIELDS = ["taskId", "integrationReceiptFile", "integrationReceiptSha256"];
const BATCH_RECEIPT_TASK_FIELDS = [
  "taskId", "dispatchId", "executionReceiptFile", "executionReceiptSha256", "integrationReceiptFile", "integrationReceiptSha256",
];
const BATCH_WORKTREE_PLAN_FIELDS = [
  "schemaVersion", "storyId", "runId", "batchId", "ledgerFile", "taskDagFile", "taskDagSha256",
  "baseRef", "baseCommit", "branch", "worktreePath", "plannedAt",
];
const BATCH_WORKTREE_STATUS_FIELDS = [
  "schemaVersion", "storyId", "runId", "batchId", "batchPlanSha256", "taskDagSha256", "state",
  "branch", "worktreePath", "baseCommit", "headCommit", "observedAt", "details",
];
const BATCH_WORKER_MANIFEST_FIELDS = [
  "schemaVersion", "storyId", "runId", "phase", "batchId", "taskId", "dispatchId", "taskRoot", "baseCommit",
  "inheritedSnapshotSha256", "inheritedFiles", "inputs", "createdAt",
];

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) throw new Error(`${label} must be a safe identifier.`);
}

function assertExactFields(value, fields, label) {
  assertObject(value, label);
  const keys = Object.keys(value);
  const unexpected = keys.find((key) => !fields.includes(key));
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (unexpected || missing || keys.length !== fields.length) {
    throw new Error(`${label} contains unsupported fields or is missing required fields.`);
  }
}

function resolveInsideRoot(root, relativeFile, label) {
  if (typeof relativeFile !== "string" || !relativeFile.trim() || relativeFile !== relativeFile.trim()
      || relativeFile.includes("\0") || path.isAbsolute(relativeFile)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const fullPath = path.resolve(root, relativeFile);
  const relative = normalizePath(path.relative(root, fullPath));
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
}

async function assertSafeParents(root, targetPath) {
  const rootPath = path.resolve(root);
  let current = path.dirname(targetPath);
  while (true) {
    const relative = path.relative(rootPath, current);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Batch path must stay inside the repository root.");
    }
    const info = await lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info?.isSymbolicLink()) throw new Error(`Batch path parent must not be a symbolic link: ${normalizePath(current)}`);
    if (current === rootPath) return;
    current = path.dirname(current);
  }
}

async function readJsonFile(filePath, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} not found: ${normalizePath(filePath)}`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

async function readJsonOptional(filePath, label) {
  const info = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

async function writeAtomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function sha256(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be a SHA-256 hash.`);
}

function assertDateTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a date-time string.`);
}

function batchWorktreeBranch(ledger) {
  return `harness/${ledger.storyId.toLowerCase()}/batch-${ledger.batchId}`;
}

function batchWorktreePath(ledger) {
  return `.harness/worktrees/${ledger.storyId}/batch-${ledger.batchId}`;
}

function batchWorktreePlanFor(ledger, plannedAt) {
  return {
    schemaVersion: "1.0",
    storyId: ledger.storyId,
    runId: ledger.runId,
    batchId: ledger.batchId,
    ledgerFile: ledger.ledgerFile,
    taskDagFile: ledger.taskDagFile,
    taskDagSha256: ledger.taskDagSha256,
    baseRef: ledger.baseRef,
    baseCommit: ledger.baseCommit,
    branch: batchWorktreeBranch(ledger),
    worktreePath: batchWorktreePath(ledger),
    plannedAt,
  };
}

function validateBatchWorktreePlan(ledger, plan) {
  assertExactFields(plan, BATCH_WORKTREE_PLAN_FIELDS, "Serial batch Worktree plan");
  if (plan.schemaVersion !== "1.0" || plan.storyId !== ledger.storyId || plan.runId !== ledger.runId
      || plan.batchId !== ledger.batchId || plan.ledgerFile !== ledger.ledgerFile
      || plan.taskDagFile !== ledger.taskDagFile || plan.taskDagSha256 !== ledger.taskDagSha256
      || plan.baseRef !== ledger.baseRef || plan.baseCommit !== ledger.baseCommit
      || plan.branch !== batchWorktreeBranch(ledger) || plan.worktreePath !== batchWorktreePath(ledger)) {
    throw new Error("Serial batch Worktree plan does not match the verified batch ledger.");
  }
  assertDateTime(plan.plannedAt, "Serial batch Worktree plan plannedAt");
  return plan;
}

function pathKey(value) {
  return normalizePath(value).toLowerCase();
}

async function readJsonEvidence(root, relativeFile, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await assertSafeParents(root, location.fullPath);
  const info = await lstat(location.fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} not found: ${location.relative}`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  const buffer = await readFile(location.fullPath);
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
  return { value, sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}` };
}

async function readJsonEvidenceOptional(root, relativeFile, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await assertSafeParents(root, location.fullPath);
  const info = await lstat(location.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  return readJsonEvidence(root, relativeFile, label);
}

async function readFileEvidence(root, relativeFile, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await assertSafeParents(root, location.fullPath);
  const info = await lstat(location.fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} not found: ${location.relative}`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  if (info.size > 2 * 1024 * 1024) throw new Error(`${label} exceeds the 2 MiB file limit.`);
  const buffer = await readFile(location.fullPath);
  return {
    sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
    bytes: buffer.length,
  };
}

function deterministicUuid(seed) {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function compareWindowsIdentifiers(left, right) {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function batchIdFor(state, taskDagSha256) {
  const hash = createHash("sha256")
    .update(`${state.storyId}\0${PHASE}\0${taskDagSha256}`)
    .digest("hex")
    .slice(0, 16);
  return `batch-${hash}`;
}

function now(options) {
  const value = (options.now ?? (() => new Date().toISOString()))();
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("Batch clock must return a date-time string.");
  return value;
}

function validateState(state) {
  assertObject(state, "Harness state");
  if (state.schemaVersion !== "1.0") throw new Error("Harness state has an invalid schema version.");
  assertIdentifier(state.storyId, "Story ID");
  assertIdentifier(state.runtime?.runId, "Run ID");
  if (state.runtime?.status !== "active") throw new Error("Serial batch preparation requires an active Story.");
  if (state.phase !== PHASE) throw new Error("Serial batch preparation only supports the implementation phase.");
  if (!Number.isInteger(state.runtime.revision) || state.runtime.revision < 1) {
    throw new Error("Harness state has an invalid revision.");
  }
}

function validateBaseFields(baseRef, baseCommit) {
  if (typeof baseRef !== "string" || !baseRef.trim() || baseRef !== baseRef.trim() || baseRef.includes("\0")) {
    throw new Error("Batch base ref must be a non-empty string.");
  }
  if (typeof baseCommit !== "string" || !COMMIT_PATTERN.test(baseCommit)) {
    throw new Error("Batch base commit must be a lowercase immutable Git commit.");
  }
}

function taskHasBusinessCandidate(task) {
  return task.predictedFiles.some((item) => isBusinessCandidatePath(task, item));
}

function isBusinessCandidatePath(task, candidatePath) {
  const prefix = task.type === "backend" ? "backend/src/" : "frontend/src/";
  return normalizePath(candidatePath).toLowerCase().startsWith(prefix);
}

function orderedBatchNodes(loaded) {
  if (loaded.dag.nodes.length < 2) throw new Error("Serial batch preparation requires at least two tasks.");
  const nodes = [...loaded.dag.nodes];
  for (const task of nodes) {
    assertIdentifier(task.taskId, "Task ID");
    if (!new Set(["backend", "frontend"]).has(task.type)) {
      throw new Error("Serial batch preparation only supports backend or frontend tasks.");
    }
    if (task.status !== "pending") throw new Error(`Batch task '${task.taskId}' must be pending.`);
    assertString(task.ownerAgent, `Batch task '${task.taskId}' ownerAgent`);
    if (!taskHasBusinessCandidate(task)) {
      throw new Error(`Batch task '${task.taskId}' must declare a business candidate under ${task.type}/src/.`);
    }
  }
  return nodes.sort((left, right) => {
    const waveDifference = loaded.waveByTask.get(left.taskId) - loaded.waveByTask.get(right.taskId);
    return waveDifference || compareWindowsIdentifiers(left.taskId, right.taskId);
  });
}

function preparationLockFor(root, state) {
  const preparationLockFile = `.harness/runs/${state.runtime.runId}/phases/${PHASE_DIRECTORY}/batch-preparation.lock`;
  return {
    preparationLockPath: resolveInsideRoot(root, preparationLockFile, "Serial batch preparation lock").fullPath,
  };
}

function pathsFor(root, state, batchId) {
  const directory = `.harness/runs/${state.runtime.runId}/batches/${batchId}`;
  const ledgerFile = `${directory}/ledger.json`;
  const lockFile = `${directory}/batch.lock`;
  const preparationLock = preparationLockFor(root, state);
  return {
    directory,
    ledgerFile,
    lockFile,
    ledgerPath: resolveInsideRoot(root, ledgerFile, "Serial batch ledger").fullPath,
    lockPath: resolveInsideRoot(root, lockFile, "Serial batch lock").fullPath,
    preparationLockPath: preparationLock.preparationLockPath,
  };
}

function taskEntry(state, batchId, directory, task, wave, sequence) {
  const taskRoot = `.harness/runs/${state.runtime.runId}/phases/${PHASE_DIRECTORY}/tasks/${task.taskId}`;
  const reportFile = `${taskRoot}/task-report.md`;
  return {
    taskId: task.taskId,
    title: task.title,
    type: task.type,
    ownerAgent: task.ownerAgent,
    wave,
    sequence,
    dispatchId: deterministicUuid(`${batchId}\0${task.taskId}`),
    predictedFiles: [...task.predictedFiles],
    taskRoot,
    taskFile: `${taskRoot}/task.json`,
    resultFile: `${taskRoot}/result.json`,
    checkpointFile: `${taskRoot}/checkpoint.json`,
    reportFile,
    expectedOutputs: [reportFile],
    inheritedSnapshotFile: `${directory}/tasks/${task.taskId}/inherited-snapshot.json`,
    inheritedSnapshotSha256: null,
    executionReceiptFile: `${directory}/tasks/${task.taskId}/execution-receipt.json`,
    executionReceiptSha256: null,
    integrationReceiptFile: `${directory}/tasks/${task.taskId}/integration-receipt.json`,
    integrationReceiptSha256: null,
    status: "pending",
    startedAt: null,
    workerReadyAt: null,
    integratedAt: null,
  };
}

function validateDispatchIdentity(entry, state, batchId, preparedAt) {
  const dispatch = {
    schemaVersion: "1.1",
    dispatchId: entry.dispatchId,
    storyId: state.storyId,
    phase: PHASE,
    batchId,
    taskId: entry.taskId,
    taskRoot: entry.taskRoot,
    ownerAgent: entry.ownerAgent,
    purpose: entry.title,
    preparedRevision: state.runtime.revision,
    preparedAt,
    expectedOutputs: entry.expectedOutputs,
    allowedAdapters: [],
    next: "unit-test",
  };
  validateDispatchTaskStructure(dispatch);
  return dispatch;
}

function checkpointForTask(entry, state, preparedAt) {
  return {
    schemaVersion: "1.0",
    dispatchId: entry.dispatchId,
    storyId: state.storyId,
    phase: PHASE,
    status: "prepared",
    preparedAt,
    updatedAt: preparedAt,
  };
}

async function materializeTaskDispatches(root, ledger, state) {
  for (const task of ledger.tasks) {
    const dispatch = validateDispatchIdentity(task, state, ledger.batchId, ledger.preparedAt);
    const location = resolveInsideRoot(root, task.taskFile, "Task dispatch");
    await assertSafeParents(root, location.fullPath);
    const existing = await readJsonOptional(location.fullPath, "Task dispatch");
    if (existing) {
      validateDispatchTaskStructure(existing);
      if (JSON.stringify(existing) !== JSON.stringify(dispatch)) {
        throw new Error(`Existing task dispatch does not match the serial batch ledger: ${task.taskId}`);
      }
    } else {
      await writeAtomicJson(location.fullPath, dispatch);
    }

    const checkpoint = checkpointForTask(task, state, ledger.preparedAt);
    const checkpointLocation = resolveInsideRoot(root, task.checkpointFile, "Task checkpoint");
    await assertSafeParents(root, checkpointLocation.fullPath);
    const existingCheckpoint = await readJsonOptional(checkpointLocation.fullPath, "Task checkpoint");
    if (existingCheckpoint) {
      if (JSON.stringify(existingCheckpoint) !== JSON.stringify(checkpoint)) {
        throw new Error(`Existing task checkpoint does not match the serial batch ledger: ${task.taskId}`);
      }
    } else {
      await writeAtomicJson(checkpointLocation.fullPath, checkpoint);
    }
  }
}

async function assertMaterializedTaskDispatches(root, ledger, state) {
  for (const task of ledger.tasks) {
    const expected = validateDispatchIdentity(task, state, ledger.batchId, ledger.preparedAt);
    const location = resolveInsideRoot(root, task.taskFile, "Task dispatch");
    await assertSafeParents(root, location.fullPath);
    let actual;
    try {
      actual = await readJsonFile(location.fullPath, "Task dispatch");
      validateDispatchTaskStructure(actual);
    } catch (error) {
      throw new Error(`Task dispatch does not match the serial batch ledger: ${task.taskId} (${error.message})`);
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Task dispatch does not match the serial batch ledger: ${task.taskId}`);
    }
    const checkpoint = checkpointForTask(task, state, ledger.preparedAt);
    const checkpointLocation = resolveInsideRoot(root, task.checkpointFile, "Task checkpoint");
    await assertSafeParents(root, checkpointLocation.fullPath);
    let actualCheckpoint;
    try {
      actualCheckpoint = await readJsonFile(checkpointLocation.fullPath, "Task checkpoint");
    } catch (error) {
      throw new Error(`Task checkpoint does not match the serial batch ledger: ${task.taskId} (${error.message})`);
    }
    if (JSON.stringify(actualCheckpoint) !== JSON.stringify(checkpoint)) {
      throw new Error(`Task checkpoint does not match the serial batch ledger: ${task.taskId}`);
    }
  }
}

function createLedger({ state, stateFile, taskDagFile, taskDagSha256, baseRef, baseCommit, paths, nodes, timestamp }) {
  const batchId = batchIdFor(state, taskDagSha256);
  const tasks = nodes.map((task, index) => taskEntry(
    state,
    batchId,
    paths.directory,
    task,
    1 + (nodes.waveByTask?.get?.(task.taskId) ?? 0),
    index + 1,
  ));
  // The array is already wave-sorted; wave values are assigned below from the validated DAG.
  return {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    stateFile,
    phase: PHASE,
    preparedRevision: state.runtime.revision,
    batchId,
    taskDagFile,
    taskDagSha256,
    baseRef,
    baseCommit,
    ledgerFile: paths.ledgerFile,
    lockFile: paths.lockFile,
    batchPlanFile: `${paths.directory}/worktree-plan.json`,
    batchPlanSha256: null,
    batchReceiptFile: `${paths.directory}/batch-receipt.json`,
    batchReceiptSha256: null,
    status: "prepared",
    preparedAt: timestamp,
    finalizedAt: null,
    tasks,
  };
}

function setTaskWaves(ledger, loaded) {
  for (const task of ledger.tasks) task.wave = loaded.waveByTask.get(task.taskId) + 1;
  return ledger;
}

function expectedEntry(state, ledger, dagTask, wave, sequence) {
  return taskEntry(state, ledger.batchId, path.posix.dirname(ledger.ledgerFile), dagTask, wave, sequence);
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateTaskEntry(entry, expected) {
  assertExactFields(entry, TASK_FIELDS, "Serial batch task");
  if (!TASK_STATUSES.has(entry.status)) throw new Error("Serial batch task has an invalid status.");
  for (const field of ["inheritedSnapshotSha256", "executionReceiptSha256", "integrationReceiptSha256"]) {
    if (entry[field] !== null && (typeof entry[field] !== "string" || !SHA256_PATTERN.test(entry[field]))) {
      throw new Error(`Serial batch task ${field} is invalid.`);
    }
  }
  for (const field of ["startedAt", "workerReadyAt", "integratedAt"]) {
    if (entry[field] !== null && (typeof entry[field] !== "string" || Number.isNaN(Date.parse(entry[field])))) {
      throw new Error(`Serial batch task ${field} is invalid.`);
    }
  }
  for (const field of [
    "taskId", "title", "type", "ownerAgent", "wave", "sequence", "dispatchId", "taskRoot", "taskFile",
    "resultFile", "checkpointFile", "reportFile", "inheritedSnapshotFile", "executionReceiptFile", "integrationReceiptFile",
  ]) {
    if (entry[field] !== expected[field]) throw new Error(`Serial batch task ${field} does not match the bound Task DAG.`);
  }
  if (!arraysEqual(entry.predictedFiles, expected.predictedFiles) || !arraysEqual(entry.expectedOutputs, expected.expectedOutputs)) {
    throw new Error("Serial batch task paths do not match the bound Task DAG.");
  }
}

function validateTaskState(entry) {
  const requireNull = (fields, label) => {
    if (fields.some((field) => entry[field] !== null)) throw new Error(`Serial batch ${label} task contains premature evidence.`);
  };
  const requireDate = (field, label) => {
    if (typeof entry[field] !== "string" || Number.isNaN(Date.parse(entry[field]))) {
      throw new Error(`Serial batch ${label} task requires '${field}'.`);
    }
  };
  const requireHash = (field, label) => {
    if (typeof entry[field] !== "string" || !SHA256_PATTERN.test(entry[field])) {
      if (field === "integrationReceiptSha256") throw new Error(`Serial batch ${label} task requires an integration receipt hash.`);
      if (field === "executionReceiptSha256") throw new Error(`Serial batch ${label} task requires an execution receipt hash.`);
      throw new Error(`Serial batch ${label} task requires '${field}'.`);
    }
  };
  if (entry.status === "pending") {
    requireNull(["inheritedSnapshotSha256", "executionReceiptSha256", "integrationReceiptSha256", "startedAt", "workerReadyAt", "integratedAt"], "pending");
  } else if (entry.status === "running") {
    requireDate("startedAt", "running");
    requireNull(["executionReceiptSha256", "integrationReceiptSha256", "workerReadyAt", "integratedAt"], "running");
  } else if (entry.status === "ready-for-integration") {
    requireDate("startedAt", "ready-for-integration");
    requireDate("workerReadyAt", "ready-for-integration");
    requireHash("inheritedSnapshotSha256", "ready-for-integration");
    requireHash("executionReceiptSha256", "ready-for-integration");
    requireNull(["integrationReceiptSha256", "integratedAt"], "ready-for-integration");
  } else if (entry.status === "integrated") {
    requireDate("startedAt", "integrated");
    requireDate("workerReadyAt", "integrated");
    requireDate("integratedAt", "integrated");
    requireHash("inheritedSnapshotSha256", "integrated");
    requireHash("executionReceiptSha256", "integrated");
    requireHash("integrationReceiptSha256", "integrated");
  } else if (entry.status === "blocked") {
    requireDate("startedAt", "blocked");
    requireHash("inheritedSnapshotSha256", "blocked");
    requireNull(["executionReceiptSha256", "integrationReceiptSha256", "workerReadyAt", "integratedAt"], "blocked");
  }
}

function allTasksIntegrated(ledger) {
  return ledger.tasks.every((task) => task.status === "integrated");
}

function assertSerialTaskOrder(ledger) {
  let activeTaskSeen = false;
  let pendingTaskSeen = false;
  for (const task of ledger.tasks) {
    if (task.status === "integrated") {
      if (activeTaskSeen || pendingTaskSeen) {
        throw new Error("Serial task order requires every predecessor to be integrated first.");
      }
      continue;
    }
    if (task.status === "pending") {
      pendingTaskSeen = true;
      continue;
    }
    if (activeTaskSeen || pendingTaskSeen) {
      throw new Error("Serial task order permits only one current non-pending task after integrated predecessors.");
    }
    activeTaskSeen = true;
  }
}

function assertTaskPredecessorsIntegrated(ledger, task) {
  const index = ledger.tasks.indexOf(task);
  if (index < 0 || ledger.tasks.slice(0, index).some((candidate) => candidate.status !== "integrated")) {
    throw new Error("Serial batch predecessors must be integrated before this task can advance.");
  }
}

function validateLedgerShape(ledger) {
  assertExactFields(ledger, LEDGER_FIELDS, "Serial batch ledger");
  if (ledger.schemaVersion !== "1.0" || ledger.phase !== PHASE || !BATCH_STATUSES.has(ledger.status)) {
    throw new Error("Serial batch ledger has an invalid identity or status.");
  }
  assertIdentifier(ledger.storyId, "Serial batch ledger storyId");
  assertIdentifier(ledger.runId, "Serial batch ledger runId");
  if (!Number.isInteger(ledger.preparedRevision) || ledger.preparedRevision < 1) {
    throw new Error("Serial batch ledger has an invalid prepared revision.");
  }
  if (!/^batch-[a-f0-9]{16}$/.test(ledger.batchId) || !SHA256_PATTERN.test(ledger.taskDagSha256)) {
    throw new Error("Serial batch ledger has an invalid batch or Task DAG hash.");
  }
  validateBaseFields(ledger.baseRef, ledger.baseCommit);
  if (ledger.batchPlanSha256 !== null && (typeof ledger.batchPlanSha256 !== "string" || !SHA256_PATTERN.test(ledger.batchPlanSha256))) {
    throw new Error("Serial batch ledger batch plan hash is invalid.");
  }
  if (ledger.batchReceiptSha256 !== null && (typeof ledger.batchReceiptSha256 !== "string" || !SHA256_PATTERN.test(ledger.batchReceiptSha256))) {
    throw new Error("Serial batch ledger batch receipt hash is invalid.");
  }
  if (!Array.isArray(ledger.tasks) || ledger.tasks.length < 2) throw new Error("Serial batch ledger requires at least two tasks.");
  for (const task of ledger.tasks) {
    assertObject(task, "Serial batch task");
    if (!TASK_STATUSES.has(task.status)) throw new Error("Serial batch task has an invalid status.");
    validateTaskState(task);
  }
  assertSerialTaskOrder(ledger);
  const blockedTasks = ledger.tasks.filter((task) => task.status === "blocked");
  if ((ledger.status === "blocked") !== (blockedTasks.length === 1)) {
    throw new Error("Serial batch blocked state must contain exactly one blocked task.");
  }
  if (typeof ledger.preparedAt !== "string" || Number.isNaN(Date.parse(ledger.preparedAt))) {
    throw new Error("Serial batch ledger has an invalid preparation timestamp.");
  }
  const finalizedAtIsValid = typeof ledger.finalizedAt === "string" && !Number.isNaN(Date.parse(ledger.finalizedAt));
  if (ledger.status === "finalized") {
    if (!finalizedAtIsValid || !allTasksIntegrated(ledger) || !ledger.batchReceiptSha256) {
      throw new Error("Serial batch finalized state requires verified execution and integration receipt hashes plus a batch receipt.");
    }
  } else if (ledger.finalizedAt !== null) {
    throw new Error("Serial batch finalized timestamp must be null until the batch is finalized.");
  }
  if (ledger.status === "ready-for-finalization") {
    if (!allTasksIntegrated(ledger) || ledger.batchReceiptSha256 !== null) {
      throw new Error("Serial batch ready-for-finalization state requires every task integration receipt.");
    }
  } else if (ledger.status !== "finalized" && ledger.batchReceiptSha256 !== null) {
    throw new Error("Serial batch receipt hash is only valid after finalization.");
  }
  if (ledger.status === "prepared" && ledger.tasks.some((task) => task.status !== "pending")) {
    throw new Error("Serial batch prepared state requires pending tasks.");
  }
  if (ledger.status === "active") {
    const pendingIndex = ledger.tasks.findIndex((task) => task.status === "pending");
    const activeTasks = ledger.tasks.filter((task) => ["running", "ready-for-integration"].includes(task.status));
    if (activeTasks.length > 1 || (pendingIndex === -1 && allTasksIntegrated(ledger))) {
      throw new Error("Serial batch active state has an invalid task transition.");
    }
  }
}

function assertReceiptIdentity(receipt, fields, ledger, task, label) {
  assertExactFields(receipt, fields, label);
  if (receipt.schemaVersion !== "1.0" || receipt.storyId !== ledger.storyId || receipt.runId !== ledger.runId
      || receipt.taskId !== task.taskId || receipt.dispatchId !== task.dispatchId || receipt.phase !== PHASE
      || receipt.ownerAgent !== task.ownerAgent || receipt.baseCommit !== ledger.baseCommit) {
    throw new Error(`${label} does not match the serial batch task identity.`);
  }
}

function validateReceiptFiles(root, files, label) {
  if (!Array.isArray(files) || !files.length) throw new Error(`${label} must contain at least one file.`);
  const seen = new Set();
  for (const file of files) {
    assertExactFields(file, ["path", "sha256", "bytes", "kind"], `${label} file`);
    resolveInsideRoot(root, file.path, `${label} file path`);
    assertSha256(file.sha256, `${label} file hash`);
    if (!Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > 2 * 1024 * 1024) {
      throw new Error(`${label} file bytes are invalid.`);
    }
    if (!new Set(["phase-output", "backend", "frontend"]).has(file.kind)) {
      throw new Error(`${label} file kind is invalid.`);
    }
    const key = pathKey(file.path);
    if (seen.has(key)) throw new Error(`${label} contains duplicate file paths.`);
    seen.add(key);
  }
  return files;
}

function validateExecutionReceipt(root, receipt, ledger, task) {
  const label = "M5-B1 execution receipt";
  assertReceiptIdentity(receipt, EXECUTION_RECEIPT_FIELDS, ledger, task, label);
  if (receipt.headCommit !== ledger.baseCommit || receipt.outcome !== "ready-for-integration"
      || receipt.resultEvidenceFile !== task.resultFile) {
    throw new Error(`${label} does not match the serial batch task.`);
  }
  resolveInsideRoot(root, receipt.resultEvidenceFile, `${label} result evidence path`);
  for (const field of ["planSha256", "statusSha256", "inputManifestSha256", "inheritedSnapshotSha256", "resultSha256"]) {
    assertSha256(receipt[field], `${label} ${field}`);
  }
  if (task.inheritedSnapshotSha256 === null || receipt.inheritedSnapshotSha256 !== task.inheritedSnapshotSha256) {
    throw new Error(`${label} inherited snapshot does not match the serial batch task.`);
  }
  assertDateTime(receipt.completedAt, `${label} completedAt`);
  const files = validateReceiptFiles(root, receipt.files, label);
  let businessFiles = 0;
  for (const file of files) {
    if (file.kind === "phase-output") {
      if (file.path !== task.reportFile) throw new Error(`${label} phase output must be the fixed task report.`);
      continue;
    }
    if (file.kind !== task.type || !isBusinessCandidatePath(task, file.path)
        || !task.predictedFiles.some((predicted) => matchesPredictedFile(predicted, file.path))) {
      throw new Error(`${label} candidate is outside the task capability and predicted files.`);
    }
    businessFiles += 1;
  }
  if (!businessFiles) throw new Error(`${label} must contain at least one business candidate.`);
  const phaseOutputs = files.filter((file) => file.kind === "phase-output").map((file) => file.path);
  if (phaseOutputs.length !== task.expectedOutputs.length
      || task.expectedOutputs.some((expectedOutput) => !phaseOutputs.includes(expectedOutput))) {
    throw new Error(`${label} phase outputs do not match the task expected outputs.`);
  }
  return receipt;
}

function batchWorktreeStatusFile(ledger) {
  return `${path.posix.dirname(ledger.batchPlanFile)}/worktree-status.json`;
}

function batchWorkerManifestFile(task) {
  return `${path.posix.dirname(task.executionReceiptFile)}/task-start-manifest.json`;
}

function validateBatchWorktreeStatus(status, ledger, plan) {
  assertExactFields(status, BATCH_WORKTREE_STATUS_FIELDS, "Serial batch Worktree status");
  if (status.schemaVersion !== "1.0" || status.storyId !== ledger.storyId || status.runId !== ledger.runId
      || status.batchId !== ledger.batchId || status.batchPlanSha256 !== ledger.batchPlanSha256
      || status.taskDagSha256 !== ledger.taskDagSha256 || status.state !== "created" || status.branch !== plan.branch
      || status.worktreePath !== plan.worktreePath || status.baseCommit !== ledger.baseCommit
      || status.headCommit !== ledger.baseCommit || typeof status.observedAt !== "string" || Number.isNaN(Date.parse(status.observedAt))
      || !Array.isArray(status.details) || status.details.some((detail) => typeof detail !== "string")) {
    throw new Error("Serial batch Worktree status does not match the verified batch plan.");
  }
}

function validateBatchWorkerManifest(root, manifest, ledger, task, snapshot) {
  assertExactFields(manifest, BATCH_WORKER_MANIFEST_FIELDS, "Batch Worker input manifest");
  if (manifest.schemaVersion !== "1.0" || manifest.storyId !== ledger.storyId || manifest.runId !== ledger.runId
      || manifest.phase !== ledger.phase || manifest.batchId !== ledger.batchId || manifest.taskId !== task.taskId
      || manifest.dispatchId !== task.dispatchId || manifest.taskRoot !== task.taskRoot || manifest.baseCommit !== ledger.baseCommit
      || manifest.inheritedSnapshotSha256 !== task.inheritedSnapshotSha256
      || JSON.stringify(manifest.inheritedFiles) !== JSON.stringify(snapshot.inheritedFiles)
      || typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.inputs)) {
    throw new Error("Batch Worker input manifest does not match the serial batch task.");
  }
  for (const input of manifest.inputs) {
    assertExactFields(input, ["source", "sourcePath", "targetPath", "sha256", "bytes"], "Batch Worker input manifest entry");
    if (!new Set(["main-run", "worktree-base"]).has(input.source) || !SHA256_PATTERN.test(input.sha256)
        || !Number.isInteger(input.bytes) || input.bytes < 0) {
      throw new Error("Batch Worker input manifest contains an invalid input entry.");
    }
    resolveInsideRoot(root, input.sourcePath, "Batch Worker input manifest source path");
    resolveInsideRoot(root, input.targetPath, "Batch Worker input manifest target path");
  }
}

async function validateExecutionReceiptEvidence(root, ledger, task, receipt, snapshot) {
  if (ledger.batchPlanSha256 === null) return;
  const plan = await readJsonEvidence(root, ledger.batchPlanFile, "Serial batch Worktree plan");
  if (plan.sha256 !== ledger.batchPlanSha256 || receipt.planSha256 !== plan.sha256) {
    throw new Error("M5-B1 execution receipt plan evidence hash does not match the serial batch ledger.");
  }
  validateBatchWorktreePlan(ledger, plan.value);
  const status = await readJsonEvidence(root, batchWorktreeStatusFile(ledger), "Serial batch Worktree status");
  if (receipt.statusSha256 !== status.sha256) {
    throw new Error("M5-B1 execution receipt Worktree status evidence hash does not match the current file.");
  }
  validateBatchWorktreeStatus(status.value, ledger, plan.value);
  const manifest = await readJsonEvidence(root, batchWorkerManifestFile(task), "Batch Worker input manifest");
  if (receipt.inputManifestSha256 !== manifest.sha256) {
    throw new Error("M5-B1 execution receipt input manifest evidence hash does not match the current file.");
  }
  validateBatchWorkerManifest(root, manifest.value, ledger, task, snapshot);
  const result = await readJsonEvidence(root, receipt.resultEvidenceFile, "M5-B1 Worker result evidence");
  if (receipt.resultSha256 !== result.sha256) {
    throw new Error("M5-B1 execution receipt result evidence hash does not match the current file.");
  }
  const worktreeRoot = resolveInsideRoot(root, plan.value.worktreePath, "Serial batch Worktree path").fullPath;
  for (const file of receipt.files) {
    const sourceRoot = file.kind === "phase-output" ? root : worktreeRoot;
    const current = await readFileEvidence(sourceRoot, file.path, "M5-B1 execution receipt candidate evidence");
    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
      throw new Error(`M5-B1 execution receipt candidate evidence hash does not match the current file: ${file.path}`);
    }
  }
}

function validateReadyWorkerResult(result, ledger, task) {
  validateDispatchResultStructure(result);
  if (result.schemaVersion !== "1.1" || result.storyId !== ledger.storyId || result.phase !== ledger.phase
      || result.batchId !== ledger.batchId || result.taskId !== task.taskId || result.taskRoot !== task.taskRoot
      || result.dispatchId !== task.dispatchId) {
    throw new Error("M5-B1 Worker result does not match the serial batch task identity.");
  }
  if (result.status !== "completed") throw new Error("M5-B1 Worker result must be completed before integration.");
  if (JSON.stringify(result.outputs.map((output) => output.path)) !== JSON.stringify(task.expectedOutputs)) {
    throw new Error("M5-B1 Worker result outputs do not match the serial batch task.");
  }
  return result;
}

function validateBlockedWorkerResult(result, ledger, task) {
  validateDispatchResultStructure(result);
  if (result.schemaVersion !== "1.1" || result.storyId !== ledger.storyId || result.phase !== PHASE
      || result.batchId !== ledger.batchId || result.taskId !== task.taskId || result.taskRoot !== task.taskRoot
      || result.dispatchId !== task.dispatchId || !["failed", "blocked"].includes(result.status)) {
    throw new Error("Blocked Worker result does not match the serial batch task.");
  }
  if (result.status === "blocked" && !result.blocker) {
    throw new Error("Blocked Worker result requires blocker details.");
  }
  for (const output of result.outputs) {
    if (!task.expectedOutputs.includes(output.path)) {
      throw new Error("Blocked Worker result output is outside the serial batch task.");
    }
  }
  return result;
}

async function validateIntegrationReceipt(root, receipt, ledger, task, executionReceipt, options = {}) {
  const label = "M5-B2 integration receipt";
  assertReceiptIdentity(receipt, INTEGRATION_RECEIPT_FIELDS, ledger, task, label);
  if (receipt.resultFile !== task.resultFile) throw new Error(`${label} result file does not match the serial batch task.`);
  resolveInsideRoot(root, receipt.resultFile, `${label} result file path`);
  for (const field of ["planSha256", "resultSha256"]) assertSha256(receipt[field], `${label} ${field}`);
  assertDateTime(receipt.completedAt, `${label} completedAt`);
  const appliedFiles = validateReceiptFiles(root, receipt.appliedFiles, label);
  const executionBusiness = executionReceipt.files.filter((file) => file.kind !== "phase-output");
  const expectedBusiness = new Map(executionBusiness.map((file) => [pathKey(file.path), file]));
  const appliedByPath = new Map(appliedFiles.map((file) => [pathKey(file.path), file]));
  for (const [key, expected] of expectedBusiness) {
    const actual = appliedByPath.get(key);
    if (!actual || actual.kind !== expected.kind || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new Error(`${label} does not cover the Worker business candidate: ${expected.path}`);
    }
  }
  const report = appliedByPath.get(pathKey(task.reportFile));
  if (!report || report.path !== task.reportFile || report.kind !== "phase-output") {
    throw new Error(`${label} must include the fixed task report.`);
  }
  const executionReport = executionReceipt.files.find((file) => file.path === task.reportFile && file.kind === "phase-output");
  if (!executionReport || report.sha256 !== executionReport.sha256 || report.bytes !== executionReport.bytes) {
    throw new Error(`${label} task report does not match the Worker receipt.`);
  }
  if (appliedByPath.size !== expectedBusiness.size + 1) {
    throw new Error(`${label} contains an unsupported applied file.`);
  }
  if (receipt.resultSha256 !== executionReceipt.resultSha256) {
    throw new Error(`${label} result hash does not match the Worker receipt.`);
  }

  const result = await readJsonEvidence(root, task.resultFile, "M5-B1 Worker result evidence");
  if (result.sha256 !== receipt.resultSha256) {
    throw new Error(`${label} result hash does not match the current Worker result.`);
  }
  validateReadyWorkerResult(result.value, ledger, task);

  const planFile = `${path.posix.dirname(task.integrationReceiptFile)}/integration-plan.json`;
  const plan = await readJsonEvidence(root, planFile, "M5-B2 integration plan");
  if (receipt.planSha256 !== plan.sha256) {
    throw new Error(`${label} plan hash does not match the current integration plan.`);
  }
  if (plan.value?.schemaVersion !== "1.0" || plan.value.storyId !== ledger.storyId || plan.value.runId !== ledger.runId
      || plan.value.batchId !== ledger.batchId || plan.value.taskId !== task.taskId || plan.value.taskRoot !== task.taskRoot
      || plan.value.dispatchId !== task.dispatchId || plan.value.phase !== ledger.phase || plan.value.ownerAgent !== task.ownerAgent
      || plan.value.baseCommit !== ledger.baseCommit || plan.value.resultFile !== task.resultFile
      || plan.value.executionReceiptFile !== task.executionReceiptFile || plan.value.executionReceiptSha256 !== task.executionReceiptSha256
      || plan.value.workerResultEvidenceFile !== task.resultFile || plan.value.workerResultSha256 !== executionReceipt.resultSha256) {
    throw new Error(`${label} integration plan does not match the serial batch task.`);
  }
  for (const file of appliedFiles) {
    if (file.kind !== "phase-output" && options.verifyBusinessFiles !== true) continue;
    const current = await readFileEvidence(root, file.path, `${label} applied target`);
    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
      throw new Error(`${label} applied target hash does not match the current file: ${file.path}`);
    }
  }
  return receipt;
}

async function expectedInheritedSnapshot(root, ledger, task) {
  const index = ledger.tasks.indexOf(task);
  if (index < 0) throw new Error("Serial batch task is not part of its ledger.");
  const inherited = new Map();
  const predecessorIntegrationReceipts = [];
  for (const predecessor of ledger.tasks.slice(0, index)) {
    const execution = await readJsonEvidence(root, predecessor.executionReceiptFile, "M5-B1 execution receipt");
    if (execution.sha256 !== predecessor.executionReceiptSha256) {
      throw new Error("M5-B1 execution receipt hash drifted from the serial batch ledger.");
    }
    validateExecutionReceipt(root, execution.value, ledger, predecessor);
    const integration = await readJsonEvidence(root, predecessor.integrationReceiptFile, "M5-B2 integration receipt");
    if (integration.sha256 !== predecessor.integrationReceiptSha256) {
      throw new Error("M5-B2 integration receipt hash drifted from the serial batch ledger.");
    }
    await validateIntegrationReceipt(root, integration.value, ledger, predecessor, execution.value);
    predecessorIntegrationReceipts.push({
      taskId: predecessor.taskId,
      integrationReceiptFile: predecessor.integrationReceiptFile,
      integrationReceiptSha256: predecessor.integrationReceiptSha256,
    });
    for (const file of integration.value.appliedFiles) {
      if (file.kind !== "phase-output") inherited.set(pathKey(file.path), { ...file });
    }
  }
  return {
    inheritedFiles: [...inherited.values()],
    predecessorIntegrationReceipts,
  };
}

function assertInheritedFiles(root, inheritedFiles, expected) {
  if (!Array.isArray(inheritedFiles)) throw new Error("Inherited snapshot files must be an array.");
  const actual = inheritedFiles.length ? validateReceiptFiles(root, inheritedFiles, "Inherited snapshot") : [];
  if (actual.length !== expected.length) throw new Error("Inherited snapshot files do not match integrated predecessors.");
  for (let index = 0; index < expected.length; index += 1) {
    const file = actual[index];
    const expectedFile = expected[index];
    if (file.path !== expectedFile.path || file.sha256 !== expectedFile.sha256
        || file.bytes !== expectedFile.bytes || file.kind !== expectedFile.kind) {
      throw new Error("Inherited snapshot files do not match integrated predecessors.");
    }
  }
  return actual;
}

function assertPredecessorIntegrationReceipts(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error("Inherited snapshot predecessor integration receipts do not match integrated predecessors.");
  }
  for (let index = 0; index < expected.length; index += 1) {
    const receipt = actual[index];
    assertExactFields(receipt, INHERITED_SNAPSHOT_RECEIPT_FIELDS, "Inherited snapshot predecessor integration receipt");
    const expectedReceipt = expected[index];
    if (receipt.taskId !== expectedReceipt.taskId
        || receipt.integrationReceiptFile !== expectedReceipt.integrationReceiptFile
        || receipt.integrationReceiptSha256 !== expectedReceipt.integrationReceiptSha256) {
      throw new Error("Inherited snapshot predecessor integration receipts do not match integrated predecessors.");
    }
  }
}

function validateInheritedSnapshot(root, snapshot, ledger, task, expected) {
  assertExactFields(snapshot, INHERITED_SNAPSHOT_FIELDS, "Inherited snapshot");
  if (snapshot.schemaVersion !== "1.0" || snapshot.storyId !== ledger.storyId || snapshot.runId !== ledger.runId
      || snapshot.phase !== PHASE || snapshot.batchId !== ledger.batchId || snapshot.taskId !== task.taskId
      || snapshot.dispatchId !== task.dispatchId || snapshot.taskRoot !== task.taskRoot || snapshot.baseCommit !== ledger.baseCommit) {
    throw new Error("Inherited snapshot does not match the serial batch task identity.");
  }
  assertDateTime(snapshot.createdAt, "Inherited snapshot createdAt");
  assertInheritedFiles(root, snapshot.inheritedFiles, expected.inheritedFiles);
  assertPredecessorIntegrationReceipts(snapshot.predecessorIntegrationReceipts, expected.predecessorIntegrationReceipts);
  return snapshot;
}

async function validateTaskInheritedSnapshot(root, ledger, task, required) {
  if (task.inheritedSnapshotSha256 === null) {
    if (required) throw new Error("Serial batch task requires an inherited snapshot before it can advance.");
    return null;
  }
  const expected = await expectedInheritedSnapshot(root, ledger, task);
  const snapshot = await readJsonEvidence(root, task.inheritedSnapshotFile, "Inherited snapshot");
  if (snapshot.sha256 !== task.inheritedSnapshotSha256) {
    throw new Error("Inherited snapshot hash drifted from the serial batch ledger.");
  }
  validateInheritedSnapshot(root, snapshot.value, ledger, task, expected);
  return snapshot;
}

async function finalizationArtifactsFor(root, ledger) {
  const expected = finalizationArtifactPathsFor(ledger.runId);
  const [task, result, notes] = await Promise.all([
    readFileEvidence(root, expected.taskFile, "Finalized implementation task"),
    readFileEvidence(root, expected.resultFile, "Finalized implementation result"),
    readFileEvidence(root, expected.notesFile, "Finalized implementation notes"),
  ]);
  return {
    taskFile: expected.taskFile,
    taskSha256: task.sha256,
    resultFile: expected.resultFile,
    resultSha256: result.sha256,
    notesFile: expected.notesFile,
    notesSha256: notes.sha256,
  };
}

async function assertFinalizationArtifactsEvidence(root, ledger, artifacts) {
  validateBatchReceiptFinalizationArtifacts(artifacts);
  const expected = finalizationArtifactPathsFor(ledger.runId);
  if (artifacts.taskFile !== expected.taskFile || artifacts.resultFile !== expected.resultFile || artifacts.notesFile !== expected.notesFile) {
    throw new Error("Serial batch receipt finalization artifact paths do not match the implementation phase.");
  }
  const actual = await finalizationArtifactsFor(root, ledger);
  for (const field of ["taskSha256", "resultSha256", "notesSha256"]) {
    if (artifacts[field] !== actual[field]) {
      throw new Error("Finalized batch formal implementation artifacts drifted from the receipt.");
    }
  }
  return artifacts;
}

async function batchReceiptFor(root, ledger, finalizedAt) {
  return {
    schemaVersion: "1.0",
    storyId: ledger.storyId,
    runId: ledger.runId,
    phase: ledger.phase,
    batchId: ledger.batchId,
    taskDagSha256: ledger.taskDagSha256,
    baseCommit: ledger.baseCommit,
    taskCount: ledger.tasks.length,
    tasks: ledger.tasks.map((task) => ({
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      executionReceiptFile: task.executionReceiptFile,
      executionReceiptSha256: task.executionReceiptSha256,
      integrationReceiptFile: task.integrationReceiptFile,
      integrationReceiptSha256: task.integrationReceiptSha256,
    })),
    finalizationArtifacts: await finalizationArtifactsFor(root, ledger),
    finalizedAt,
  };
}

function validateBatchReceipt(receipt, ledger) {
  assertExactFields(receipt, BATCH_RECEIPT_FIELDS, "Serial batch receipt");
  if (receipt.schemaVersion !== "1.0" || receipt.storyId !== ledger.storyId || receipt.runId !== ledger.runId
      || receipt.phase !== PHASE || receipt.batchId !== ledger.batchId || receipt.taskDagSha256 !== ledger.taskDagSha256
      || receipt.baseCommit !== ledger.baseCommit || receipt.taskCount !== ledger.tasks.length) {
    throw new Error("Serial batch receipt does not match the ledger identity.");
  }
  assertDateTime(receipt.finalizedAt, "Serial batch receipt finalizedAt");
  if (!Array.isArray(receipt.tasks) || receipt.tasks.length !== ledger.tasks.length) {
    throw new Error("Serial batch receipt task list does not match the ledger.");
  }
  for (let index = 0; index < ledger.tasks.length; index += 1) {
    const task = ledger.tasks[index];
    const actual = receipt.tasks[index];
    assertExactFields(actual, BATCH_RECEIPT_TASK_FIELDS, "Serial batch receipt task");
    for (const field of BATCH_RECEIPT_TASK_FIELDS) {
      if (actual[field] !== task[field]) throw new Error("Serial batch receipt task evidence does not match the ledger.");
    }
  }
  validateBatchReceiptFinalizationArtifacts(receipt.finalizationArtifacts);
  const expectedArtifacts = finalizationArtifactPathsFor(ledger.runId);
  if (receipt.finalizationArtifacts.taskFile !== expectedArtifacts.taskFile
      || receipt.finalizationArtifacts.resultFile !== expectedArtifacts.resultFile
      || receipt.finalizationArtifacts.notesFile !== expectedArtifacts.notesFile) {
    throw new Error("Serial batch receipt finalization artifact paths do not match the ledger.");
  }
  if (ledger.finalizedAt !== null && receipt.finalizedAt !== ledger.finalizedAt) {
    throw new Error("Serial batch receipt finalized timestamp does not match the ledger.");
  }
  return receipt;
}

async function validateLedgerEvidence(root, ledger, options = {}) {
  if (ledger.batchPlanSha256) {
    const plan = await readJsonEvidence(root, ledger.batchPlanFile, "Serial batch Worktree plan");
    if (plan.sha256 !== ledger.batchPlanSha256) {
      throw new Error("Serial batch Worktree plan hash drifted from the ledger.");
    }
    validateBatchWorktreePlan(ledger, plan.value);
  }
  const executionByTask = new Map();
  const latestBusinessFiles = new Map();
  const collectBusinessFiles = (receipt) => {
    for (const file of receipt.appliedFiles) {
      if (file.kind === "backend" || file.kind === "frontend") latestBusinessFiles.set(pathKey(file.path), file);
    }
  };
  for (const task of ledger.tasks) {
    await validateTaskInheritedSnapshot(root, ledger, task, ["ready-for-integration", "integrated", "blocked"].includes(task.status));
    if (["ready-for-integration", "integrated"].includes(task.status)) {
      if (!task.executionReceiptSha256) throw new Error("Serial batch task is missing its execution receipt hash.");
      const execution = await readJsonEvidence(root, task.executionReceiptFile, "M5-B1 execution receipt");
      if (execution.sha256 !== task.executionReceiptSha256) {
        throw new Error("M5-B1 execution receipt hash drifted from the serial batch ledger.");
      }
      executionByTask.set(task.taskId, validateExecutionReceipt(root, execution.value, ledger, task));
    }
    if (task.status === "integrated") {
      if (!task.integrationReceiptSha256) throw new Error("Serial batch task is missing its integration receipt hash.");
      const integration = await readJsonEvidence(root, task.integrationReceiptFile, "M5-B2 integration receipt");
      if (integration.sha256 !== task.integrationReceiptSha256) {
        throw new Error("M5-B2 integration receipt hash drifted from the serial batch ledger.");
      }
      await validateIntegrationReceipt(root, integration.value, ledger, task, executionByTask.get(task.taskId));
      collectBusinessFiles(integration.value);
    }
    if (task.status === "blocked") {
      const result = await readJsonEvidence(root, task.resultFile, "Blocked Worker result");
      validateBlockedWorkerResult(result.value, ledger, task);
    }
  }
  if (options.allowIntegrationTaskId !== undefined) {
    assertIdentifier(options.allowIntegrationTaskId, "Allowed integration task ID");
    const task = ledger.tasks.find((candidate) => candidate.taskId === options.allowIntegrationTaskId);
    if (!task) throw new Error(`Serial batch task '${options.allowIntegrationTaskId}' was not found.`);
    if (task.status === "ready-for-integration") {
      assertTaskPredecessorsIntegrated(ledger, task);
      const integration = options.allowMissingIntegrationReceipt === true
        ? await readJsonEvidenceOptional(root, task.integrationReceiptFile, "M5-B2 integration receipt")
        : await readJsonEvidence(root, task.integrationReceiptFile, "M5-B2 integration receipt");
      if (integration) {
        await validateIntegrationReceipt(root, integration.value, ledger, task, executionByTask.get(task.taskId));
        collectBusinessFiles(integration.value);
      }
    } else if (task.status !== "integrated") {
      throw new Error(`Only a Worker-ready or integrated task may record integration; '${task.taskId}' is '${task.status}'.`);
    }
  }
  for (const file of latestBusinessFiles.values()) {
    const current = await readFileEvidence(root, file.path, "Latest integrated business target");
    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
      throw new Error(`Latest M5-B2 integration target inherited main file hash drifted: ${file.path}`);
    }
  }
  if (ledger.batchReceiptSha256) {
    const receipt = await readJsonEvidence(root, ledger.batchReceiptFile, "Serial batch receipt");
    if (receipt.sha256 !== ledger.batchReceiptSha256) throw new Error("Serial batch receipt hash drifted from the ledger.");
    validateBatchReceipt(receipt.value, ledger);
    await assertFinalizationArtifactsEvidence(root, ledger, receipt.value.finalizationArtifacts);
  }
}

function validateLedgerAgainstContext(ledger, context) {
  validateLedgerShape(ledger);
  const { state, stateFile, taskDagFile, taskDagSha256, loaded, paths } = context;
  if (ledger.storyId !== state.storyId || ledger.runId !== state.runtime.runId || ledger.stateFile !== stateFile
      || ledger.preparedRevision !== state.runtime.revision || ledger.taskDagFile !== taskDagFile
      || ledger.taskDagSha256 !== taskDagSha256) {
    throw new Error("Serial batch ledger no longer matches the active Story state or Task DAG.");
  }
  if (ledger.batchId !== batchIdFor(state, taskDagSha256) || ledger.ledgerFile !== paths.ledgerFile || ledger.lockFile !== paths.lockFile) {
    throw new Error("Serial batch ledger contains invalid derived paths or identity.");
  }
  if (ledger.batchPlanFile !== `${paths.directory}/worktree-plan.json`
      || ledger.batchReceiptFile !== `${paths.directory}/batch-receipt.json`) {
    throw new Error("Serial batch ledger contains invalid derived batch evidence paths.");
  }
  const ordered = orderedBatchNodes(loaded);
  if (ledger.tasks.length !== ordered.length) throw new Error("Serial batch ledger tasks no longer match the bound Task DAG.");
  for (let index = 0; index < ordered.length; index += 1) {
    const dagTask = ordered[index];
    const expected = expectedEntry(state, ledger, dagTask, loaded.waveByTask.get(dagTask.taskId) + 1, index + 1);
    validateTaskEntry(ledger.tasks[index], expected);
    validateDispatchIdentity(ledger.tasks[index], state, ledger.batchId, ledger.preparedAt);
  }
  return ledger;
}

async function acquireLock(lockPath, options, label = "Batch lock") {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${label} already exists; inspect it before retrying.`);
    throw error;
  }
  let failed = false;
  let failure;
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: now(options) })}\n`, "utf8");
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    if (!failed) {
      failed = true;
      failure = error;
    }
  }
  if (failed) {
    await releaseLock(lockPath);
    throw failure;
  }
}

async function assertLockAbsent(lockPath, label = "Batch lock") {
  const info = await lstat(lockPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (info) throw new Error(`${label} already exists; inspect it before retrying.`);
}

async function assertOperationLocksAbsent(paths) {
  await assertLockAbsent(paths.preparationLockPath, "Batch preparation lock");
  await assertLockAbsent(paths.lockPath);
}

async function releaseLock(lockPath) {
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function loadStateContext(root, stateFile) {
  const stateLocation = resolveInsideRoot(root, stateFile, "State file");
  await assertSafeParents(root, stateLocation.fullPath);
  const state = await readJsonFile(stateLocation.fullPath, "State file");
  validateState(state);
  return { state, stateFile: stateLocation.relative };
}

async function findPhaseLedger(root, state) {
  const batches = resolveInsideRoot(root, `.harness/runs/${state.runtime.runId}/batches`, "Serial batch directory");
  await assertSafeParents(root, batches.fullPath);
  const directory = await lstat(batches.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!directory) return null;
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Serial batch directory must be a real directory.");
  const entries = await readdir(batches.fullPath, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("Serial batch directory contains a symbolic link.");
    if (!entry.isDirectory()) continue;
    const ledgerFile = `${batches.relative}/${entry.name}/ledger.json`;
    const ledgerLocation = resolveInsideRoot(root, ledgerFile, "Serial batch ledger");
    const info = await lstat(ledgerLocation.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) continue;
    const ledger = await readJsonFile(ledgerLocation.fullPath, "Serial batch ledger");
    validateLedgerShape(ledger);
    if (ledger.storyId !== state.storyId || ledger.runId !== state.runtime.runId || ledger.phase !== PHASE) {
      throw new Error("Serial batch directory contains a ledger outside the active Story, run, or phase.");
    }
    matches.push({ ledgerFile, ledger });
  }
  if (matches.length > 1) throw new Error("More than one serial batch ledger exists for this active run and phase.");
  return matches[0] ?? null;
}

async function assertNoCompetingPhaseLedger(root, context) {
  const existing = await findPhaseLedger(root, context.state);
  if (!existing) return;
  if (existing.ledgerFile !== context.paths.ledgerFile || existing.ledger.taskDagSha256 !== context.taskDagSha256
      || existing.ledger.taskDagFile !== context.taskDagFile || existing.ledger.batchId !== batchIdFor(context.state, context.taskDagSha256)
      || existing.ledger.stateFile !== context.stateFile || existing.ledger.preparedRevision !== context.state.runtime.revision) {
    throw new Error("Existing serial batch ledger does not match the current Task DAG for this active run and phase.");
  }
}

async function assertNoOrdinaryImplementationArtifacts(root, state) {
  const phaseRoot = `.harness/runs/${state.runtime.runId}/phases/${PHASE_DIRECTORY}`;
  for (const name of ["task.json", "result.json", "checkpoint.json", "implementation-notes.md"]) {
    const artifact = resolveInsideRoot(root, `${phaseRoot}/${name}`, "Ordinary implementation phase artifact");
    await assertSafeParents(root, artifact.fullPath);
    const info = await lstat(artifact.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info) {
      throw new Error(`Existing ordinary implementation phase artifact prevents serial batch preparation: ${name}`);
    }
  }
}

async function prepareContext(root, options) {
  const { state, stateFile } = await loadStateContext(root, options.stateFile);
  const taskDagLocation = resolveInsideRoot(root, options.taskDagFile, "Task DAG file");
  await assertSafeParents(root, taskDagLocation.fullPath);
  const loaded = await loadTaskDag(taskDagLocation.fullPath);
  if (loaded.dag.storyId !== state.storyId) throw new Error("Task DAG does not match the active Story.");
  const taskDagSha256 = await sha256(taskDagLocation.fullPath);
  const base = assertVerifiedBatchBase(options.base, root);
  validateBaseFields(base.baseRef, base.baseCommit);
  const batchId = batchIdFor(state, taskDagSha256);
  const paths = pathsFor(root, state, batchId);
  await assertSafeParents(root, paths.ledgerPath);
  orderedBatchNodes(loaded);
  return {
    state,
    stateFile,
    taskDagFile: taskDagLocation.relative,
    taskDagSha256,
    loaded,
    paths,
    baseRef: base.baseRef,
    baseCommit: base.baseCommit,
  };
}

async function inspectContextForState(root, stateContext, options) {
  const { state, stateFile } = stateContext;
  const ledgerLocation = resolveInsideRoot(root, options.batchFile, "Serial batch ledger");
  await assertSafeParents(root, ledgerLocation.fullPath);
  const ledger = await readJsonFile(ledgerLocation.fullPath, "Serial batch ledger");
  validateLedgerShape(ledger);
  if (ledger.ledgerFile !== ledgerLocation.relative) throw new Error("Serial batch ledger is not stored at its derived path.");
  const taskDagLocation = resolveInsideRoot(root, ledger.taskDagFile, "Bound Task DAG file");
  await assertSafeParents(root, taskDagLocation.fullPath);
  const loaded = await loadTaskDag(taskDagLocation.fullPath);
  if (loaded.dag.storyId !== state.storyId) throw new Error("Task DAG does not match the active Story.");
  const taskDagSha256 = await sha256(taskDagLocation.fullPath);
  if (taskDagSha256 !== ledger.taskDagSha256) throw new Error("Task DAG has changed since batch preparation.");
  const paths = pathsFor(root, state, ledger.batchId);
  const context = { state, stateFile, taskDagFile: taskDagLocation.relative, taskDagSha256, loaded, paths };
  validateLedgerAgainstContext(ledger, context);
  await assertMaterializedTaskDispatches(root, ledger, state);
  await validateLedgerEvidence(root, ledger, {
    allowIntegrationTaskId: options.allowIntegrationTaskId,
    allowMissingIntegrationReceipt: options.allowMissingIntegrationReceipt,
  });
  return { ...context, ledger };
}

async function inspectContext(root, options) {
  return inspectContextForState(root, await loadStateContext(root, options.stateFile), options);
}

export async function prepareSerialBatch(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const lockState = await loadStateContext(root, options.stateFile);
  const preparationLock = preparationLockFor(root, lockState.state);
  await assertSafeParents(root, preparationLock.preparationLockPath);
  await acquireLock(preparationLock.preparationLockPath, options, "Batch preparation lock");
  try {
    const base = options.base ?? await options.resolveBase?.();
    if (!base) {
      throw new Error("Serial batch preparation requires a verified batch base.");
    }
    const context = await prepareContext(root, { ...options, base });
    if (context.state.storyId !== lockState.state.storyId || context.state.runtime.runId !== lockState.state.runtime.runId
        || context.state.runtime.revision !== lockState.state.runtime.revision || context.stateFile !== lockState.stateFile) {
      throw new Error("Harness state changed while acquiring the batch preparation lock.");
    }
    await assertNoCompetingPhaseLedger(root, context);
    await assertNoOrdinaryImplementationArtifacts(root, context.state);
    await acquireLock(context.paths.lockPath, options);
    try {
    const existing = await readJsonOptional(context.paths.ledgerPath, "Serial batch ledger");
    if (existing) {
      validateLedgerAgainstContext(existing, context);
      await validateLedgerEvidence(root, existing);
      if (existing.baseRef !== context.baseRef || existing.baseCommit !== context.baseCommit) {
        throw new Error("Existing serial batch ledger has a different base commit or base ref.");
      }
      await materializeTaskDispatches(root, existing, context.state);
      return { command: "prepare", reused: true, batchFile: context.paths.ledgerFile, ledger: existing };
    }
    const ledger = setTaskWaves(createLedger({
      ...context,
      timestamp: now(options),
      nodes: orderedBatchNodes(context.loaded),
    }), context.loaded);
    validateLedgerAgainstContext(ledger, context);
    await materializeTaskDispatches(root, ledger, context.state);
    await writeAtomicJson(context.paths.ledgerPath, ledger);
    return { command: "prepare", reused: false, batchFile: context.paths.ledgerFile, ledger };
    } finally {
      await releaseLock(context.paths.lockPath);
    }
  } finally {
    await releaseLock(preparationLock.preparationLockPath);
  }
}

export async function inspectSerialBatch(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const context = await inspectContext(root, options);
  await assertOperationLocksAbsent(context.paths);
  return { command: "status", batchFile: context.paths.ledgerFile, ledger: context.ledger };
}

export async function inspectCurrentSerialBatch(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const { state, stateFile } = await loadStateContext(root, options.stateFile);
  const existing = await findPhaseLedger(root, state);
  if (!existing) return null;
  const inspected = await inspectSerialBatch({
    root,
    stateFile,
    batchFile: existing.ledgerFile,
  });
  const ledger = await readJsonEvidence(root, inspected.batchFile, "Serial batch ledger");
  const receipt = inspected.ledger.status === "finalized"
    ? await readJsonEvidence(root, inspected.ledger.batchReceiptFile, "Serial batch receipt")
    : null;
  return {
    ...inspected,
    ledgerSha256: ledger.sha256,
    receiptSha256: receipt?.sha256 ?? null,
  };
}

async function inspectCurrentBatchContext(root, stateFile, options = {}) {
  const stateContext = await loadStateContext(root, stateFile);
  const existing = await findPhaseLedger(root, stateContext.state);
  if (!existing) throw new Error("No verified serial batch ledger exists for the active implementation Story.");
  return inspectContext(root, {
    allowIntegrationTaskId: options.allowIntegrationTaskId,
    allowMissingIntegrationReceipt: options.allowMissingIntegrationReceipt,
    stateFile: stateContext.stateFile,
    batchFile: existing.ledgerFile,
  });
}

export async function registerBatchWorktreePlan(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await inspectCurrentBatchContext(root, options.stateFile);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectCurrentBatchContext(root, options.stateFile);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    const planLocation = resolveInsideRoot(root, context.ledger.batchPlanFile, "Serial batch Worktree plan");
    await assertSafeParents(root, planLocation.fullPath);
    const existing = await readJsonOptional(planLocation.fullPath, "Serial batch Worktree plan");
    if (existing) {
      validateBatchWorktreePlan(context.ledger, existing);
      const evidence = await readJsonEvidence(root, context.ledger.batchPlanFile, "Serial batch Worktree plan");
      if (context.ledger.batchPlanSha256 !== null && context.ledger.batchPlanSha256 !== evidence.sha256) {
        throw new Error("Serial batch Worktree plan hash drifted from the ledger.");
      }
      if (context.ledger.batchPlanSha256 === null) {
        context.ledger.batchPlanSha256 = evidence.sha256;
        await validateLedgerEvidence(root, context.ledger);
        await writeAtomicJson(context.paths.ledgerPath, context.ledger);
        return {
          command: "register-worktree-plan",
          reused: false,
          recovered: true,
          batchFile: context.paths.ledgerFile,
          planFile: context.ledger.batchPlanFile,
          planSha256: evidence.sha256,
          plan: evidence.value,
          ledger: context.ledger,
        };
      }
      return {
        command: "register-worktree-plan",
        reused: true,
        recovered: false,
        batchFile: context.paths.ledgerFile,
        planFile: context.ledger.batchPlanFile,
        planSha256: evidence.sha256,
        plan: evidence.value,
        ledger: context.ledger,
      };
    }
    if (context.ledger.batchPlanSha256 !== null) {
      throw new Error("Serial batch ledger references a missing Worktree plan.");
    }
    const plan = batchWorktreePlanFor(context.ledger, now(options));
    validateBatchWorktreePlan(context.ledger, plan);
    await writeAtomicJson(planLocation.fullPath, plan);
    const evidence = await readJsonEvidence(root, context.ledger.batchPlanFile, "Serial batch Worktree plan");
    context.ledger.batchPlanSha256 = evidence.sha256;
    await validateLedgerEvidence(root, context.ledger);
    await writeAtomicJson(context.paths.ledgerPath, context.ledger);
    return {
      command: "register-worktree-plan",
      reused: false,
      recovered: false,
      batchFile: context.paths.ledgerFile,
      planFile: context.ledger.batchPlanFile,
      planSha256: evidence.sha256,
      plan: evidence.value,
      ledger: context.ledger,
    };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}

export async function inspectBatchWorktreePlan(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const context = await inspectCurrentBatchContext(root, options.stateFile, options);
  if (options.allowReadyTransitionLock === true) {
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
  } else {
    await assertOperationLocksAbsent(context.paths);
  }
  if (!context.ledger.batchPlanSha256) {
    throw new Error("Serial batch Worktree plan has not been registered.");
  }
  const evidence = await readJsonEvidence(root, context.ledger.batchPlanFile, "Serial batch Worktree plan");
  if (evidence.sha256 !== context.ledger.batchPlanSha256) {
    throw new Error("Serial batch Worktree plan hash drifted from the ledger.");
  }
  validateBatchWorktreePlan(context.ledger, evidence.value);
  return {
    command: "worktree-plan-status",
    batchFile: context.paths.ledgerFile,
    planFile: context.ledger.batchPlanFile,
    planSha256: evidence.sha256,
    plan: evidence.value,
    ledger: context.ledger,
    stateFile: context.stateFile,
  };
}

export async function inspectFinalizedSerialBatchForRecovery(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const stateLocation = resolveInsideRoot(root, options.stateFile, "State file");
  await assertSafeParents(root, stateLocation.fullPath);
  assertObject(options.state, "Recovery Harness state");
  assertIdentifier(options.state.storyId, "Recovery Story ID");
  assertIdentifier(options.state.runtime?.runId, "Recovery run ID");
  if (!Number.isInteger(options.preparedRevision) || options.preparedRevision < 1) {
    throw new Error("Recovery prepared revision must be a positive integer.");
  }
  const historicalState = {
    ...options.state,
    phase: PHASE,
    runtime: {
      ...options.state.runtime,
      status: "active",
      revision: options.preparedRevision,
    },
  };
  const context = await inspectContextForState(root, {
    state: historicalState,
    stateFile: stateLocation.relative,
  }, options);
  await assertOperationLocksAbsent(context.paths);
  if (context.ledger.status !== "finalized") {
    throw new Error("Serial batch must be finalized before recovery can reconcile it.");
  }
  const ledger = await readJsonEvidence(root, context.paths.ledgerFile, "Serial batch ledger");
  const receipt = await readJsonEvidence(root, context.ledger.batchReceiptFile, "Serial batch receipt");
  return {
    command: "recovery-status",
    batchFile: context.paths.ledgerFile,
    ledger: context.ledger,
    ledgerSha256: ledger.sha256,
    receiptSha256: receipt.sha256,
  };
}

export async function claimBatchTask(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await inspectContext(root, options);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectContext(root, options);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    const ledger = context.ledger;
    if (!new Set(["prepared", "active"]).has(ledger.status)) {
      throw new Error(`Cannot claim a task while the serial batch is '${ledger.status}'.`);
    }
    assertIdentifier(options.taskId, "Task ID");
    const running = ledger.tasks.find((task) => task.status === "running");
    if (running) {
      if (running.taskId !== options.taskId) {
        throw new Error(`Only the running task '${running.taskId}' may be retried before the next pending task.`);
      }
      return { command: "claim", reused: true, batchFile: context.paths.ledgerFile, ledger, task: running };
    }
    const nextIndex = ledger.tasks.findIndex((task) => task.status === "pending");
    const next = nextIndex === -1 ? null : ledger.tasks[nextIndex];
    if (!next) throw new Error("Serial batch has no next pending task to claim.");
    if (ledger.tasks.slice(0, nextIndex).some((task) => task.status !== "integrated")) {
      throw new Error("Serial batch predecessors must be integrated before the next pending task can be claimed.");
    }
    if (next.taskId !== options.taskId) {
      throw new Error(`Only next pending task '${next.taskId}' may be claimed.`);
    }
    next.status = "running";
    next.startedAt = now(options);
    ledger.status = "active";
    await writeAtomicJson(context.paths.ledgerPath, ledger);
    return { command: "claim", reused: false, batchFile: context.paths.ledgerFile, ledger, task: next };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}

function assertReceiptFileArgument(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must match the task-derived receipt path.`);
}

export async function recordBatchInheritedSnapshot(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await inspectContext(root, options);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectContext(root, options);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    assertIdentifier(options.taskId, "Task ID");
    const task = context.ledger.tasks.find((candidate) => candidate.taskId === options.taskId);
    if (!task) throw new Error(`Serial batch task '${options.taskId}' was not found.`);
    if (task.status !== "running") throw new Error("Only the running task can record an inherited snapshot.");
    assertTaskPredecessorsIntegrated(context.ledger, task);
    const expected = await expectedInheritedSnapshot(root, context.ledger, task);
    const inheritedFiles = assertInheritedFiles(root, options.inheritedFiles ?? expected.inheritedFiles, expected.inheritedFiles);
    const snapshotLocation = resolveInsideRoot(root, task.inheritedSnapshotFile, "Inherited snapshot");
    await assertSafeParents(root, snapshotLocation.fullPath);
    const existing = await lstat(snapshotLocation.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    let evidence;
    let recovered = false;
    if (existing) {
      evidence = await readJsonEvidence(root, task.inheritedSnapshotFile, "Inherited snapshot");
      validateInheritedSnapshot(root, evidence.value, context.ledger, task, expected);
      if (task.inheritedSnapshotSha256 !== null && task.inheritedSnapshotSha256 !== evidence.sha256) {
        throw new Error("Inherited snapshot hash drifted from the serial batch ledger.");
      }
      recovered = task.inheritedSnapshotSha256 === null;
    } else {
      if (task.inheritedSnapshotSha256 !== null) {
        throw new Error("Serial batch ledger references a missing inherited snapshot.");
      }
      await writeAtomicJson(snapshotLocation.fullPath, {
        schemaVersion: "1.0",
        storyId: context.ledger.storyId,
        runId: context.ledger.runId,
        phase: PHASE,
        batchId: context.ledger.batchId,
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        taskRoot: task.taskRoot,
        baseCommit: context.ledger.baseCommit,
        inheritedFiles,
        predecessorIntegrationReceipts: expected.predecessorIntegrationReceipts,
        createdAt: now(options),
      });
      evidence = await readJsonEvidence(root, task.inheritedSnapshotFile, "Inherited snapshot");
      validateInheritedSnapshot(root, evidence.value, context.ledger, task, expected);
    }
    if (task.inheritedSnapshotSha256 === null) {
      task.inheritedSnapshotSha256 = evidence.sha256;
      await writeAtomicJson(context.paths.ledgerPath, context.ledger);
    }
    return {
      command: "record-inherited-snapshot",
      reused: !recovered && task.inheritedSnapshotSha256 === evidence.sha256 && Boolean(existing),
      recovered,
      batchFile: context.paths.ledgerFile,
      snapshotFile: task.inheritedSnapshotFile,
      ledger: context.ledger,
      task,
    };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}

export async function recordBatchWorkerBlocked(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await inspectContext(root, options);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectContext(root, options);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    assertIdentifier(options.taskId, "Task ID");
    const task = context.ledger.tasks.find((candidate) => candidate.taskId === options.taskId);
    if (!task) throw new Error(`Serial batch task '${options.taskId}' was not found.`);
    assertTaskPredecessorsIntegrated(context.ledger, task);
    assertReceiptFileArgument(options.resultFile, task.resultFile, "Blocked Worker result path");
    await validateTaskInheritedSnapshot(root, context.ledger, task, true);
    const result = await readJsonEvidence(root, task.resultFile, "Blocked Worker result");
    validateBlockedWorkerResult(result.value, context.ledger, task);
    if (task.status === "blocked") {
      if (context.ledger.status !== "blocked") {
        throw new Error("Serial batch blocked task does not match the batch status.");
      }
      return {
        command: "record-worker-blocked",
        reused: true,
        batchFile: context.paths.ledgerFile,
        resultFile: task.resultFile,
        ledger: context.ledger,
        task,
      };
    }
    if (task.status !== "running") {
      throw new Error(`Only the running task may record a blocked Worker result; '${task.taskId}' is '${task.status}'.`);
    }
    task.status = "blocked";
    context.ledger.status = "blocked";
    validateLedgerShape(context.ledger);
    await writeAtomicJson(context.paths.ledgerPath, context.ledger);
    return {
      command: "record-worker-blocked",
      reused: false,
      batchFile: context.paths.ledgerFile,
      resultFile: task.resultFile,
      ledger: context.ledger,
      task,
    };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}

export async function recordBatchWorkerReady(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await inspectContext(root, options);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectContext(root, options);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    assertIdentifier(options.taskId, "Task ID");
    const task = context.ledger.tasks.find((candidate) => candidate.taskId === options.taskId);
    if (!task) throw new Error(`Serial batch task '${options.taskId}' was not found.`);
    assertTaskPredecessorsIntegrated(context.ledger, task);
    assertReceiptFileArgument(options.executionReceiptFile, task.executionReceiptFile, "M5-B1 execution receipt path");
    const snapshot = await validateTaskInheritedSnapshot(root, context.ledger, task, true);
    const evidence = await readJsonEvidence(root, task.executionReceiptFile, "M5-B1 execution receipt");
    validateExecutionReceipt(root, evidence.value, context.ledger, task);
    const result = await readJsonEvidence(root, task.resultFile, "M5-B1 Worker result evidence");
    if (result.sha256 !== evidence.value.resultSha256) {
      throw new Error("M5-B1 Worker result evidence hash does not match the execution receipt.");
    }
    validateReadyWorkerResult(result.value, context.ledger, task);
    if (evidence.value.inheritedSnapshotSha256 !== snapshot.sha256) {
      throw new Error("M5-B1 execution receipt inherited snapshot does not match the recorded snapshot.");
    }
    if (options.beforeReadyTransition !== undefined && typeof options.beforeReadyTransition !== "function") {
      throw new Error("M5-B1 beforeReadyTransition must be a function when supplied.");
    }
    if (options.verifyWorktreeReadiness !== undefined && typeof options.verifyWorktreeReadiness !== "function") {
      throw new Error("M5-B1 verifyWorktreeReadiness must be a function when supplied.");
    }
    if (options.beforeReadyTransition) await options.beforeReadyTransition();
    if (options.verifyWorktreeReadiness) await options.verifyWorktreeReadiness();
    await validateExecutionReceiptEvidence(root, context.ledger, task, evidence.value, snapshot.value);
    if (task.status === "ready-for-integration") {
      if (task.executionReceiptSha256 !== evidence.sha256) {
        throw new Error("M5-B1 execution receipt hash drifted from the serial batch ledger.");
      }
      return {
        command: "record-worker-ready",
        reused: true,
        batchFile: context.paths.ledgerFile,
        receiptFile: task.executionReceiptFile,
        ledger: context.ledger,
        task,
      };
    }
    if (task.status !== "running") {
      throw new Error(`Only the running task may record a Worker receipt; '${task.taskId}' is '${task.status}'.`);
    }
    task.executionReceiptSha256 = evidence.sha256;
    task.workerReadyAt = now(options);
    task.status = "ready-for-integration";
    await writeAtomicJson(context.paths.ledgerPath, context.ledger);
    return {
      command: "record-worker-ready",
      reused: false,
      batchFile: context.paths.ledgerFile,
      receiptFile: task.executionReceiptFile,
      ledger: context.ledger,
      task,
    };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}

export async function recordBatchIntegration(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  assertIdentifier(options.taskId, "Task ID");
  const contextOptions = { ...options, allowIntegrationTaskId: options.taskId };
  const initial = await inspectContext(root, contextOptions);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectContext(root, contextOptions);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    const task = context.ledger.tasks.find((candidate) => candidate.taskId === options.taskId);
    if (!task) throw new Error(`Serial batch task '${options.taskId}' was not found.`);
    assertTaskPredecessorsIntegrated(context.ledger, task);
    assertReceiptFileArgument(options.integrationReceiptFile, task.integrationReceiptFile, "M5-B2 integration receipt path");
    const execution = await readJsonEvidence(root, task.executionReceiptFile, "M5-B1 execution receipt");
    if (execution.sha256 !== task.executionReceiptSha256) {
      throw new Error("M5-B1 execution receipt hash drifted from the serial batch ledger.");
    }
    validateExecutionReceipt(root, execution.value, context.ledger, task);
    const integration = await readJsonEvidence(root, task.integrationReceiptFile, "M5-B2 integration receipt");
    await validateIntegrationReceipt(
      root,
      integration.value,
      context.ledger,
      task,
      execution.value,
      { verifyBusinessFiles: task.status === "ready-for-integration" },
    );
    if (task.status === "integrated") {
      if (task.integrationReceiptSha256 !== integration.sha256) {
        throw new Error("M5-B2 integration receipt hash drifted from the serial batch ledger.");
      }
      return {
        command: "record-integration",
        reused: true,
        batchFile: context.paths.ledgerFile,
        receiptFile: task.integrationReceiptFile,
        ledger: context.ledger,
        task,
      };
    }
    if (task.status !== "ready-for-integration") {
      throw new Error(`Only a Worker-ready task may record integration; '${task.taskId}' is '${task.status}'.`);
    }
    task.integrationReceiptSha256 = integration.sha256;
    task.integratedAt = now(options);
    task.status = "integrated";
    context.ledger.status = allTasksIntegrated(context.ledger) ? "ready-for-finalization" : "active";
    await writeAtomicJson(context.paths.ledgerPath, context.ledger);
    return {
      command: "record-integration",
      reused: false,
      batchFile: context.paths.ledgerFile,
      receiptFile: task.integrationReceiptFile,
      ledger: context.ledger,
      task,
    };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}

export async function finalizeSerialBatch(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const initial = await inspectContext(root, options);
  await assertOperationLocksAbsent(initial.paths);
  await acquireLock(initial.paths.lockPath, options);
  try {
    const context = await inspectContext(root, options);
    await assertLockAbsent(context.paths.preparationLockPath, "Batch preparation lock");
    const ledger = context.ledger;
    if (ledger.status === "finalized") {
      return {
        command: "finalize",
        reused: true,
        batchFile: context.paths.ledgerFile,
        receiptFile: ledger.batchReceiptFile,
        ledger,
      };
    }
    if (ledger.status !== "ready-for-finalization" || !allTasksIntegrated(ledger)) {
      throw new Error("Serial batch finalization requires every task integration receipt.");
    }
    const receiptLocation = resolveInsideRoot(root, ledger.batchReceiptFile, "Serial batch receipt");
    await assertSafeParents(root, receiptLocation.fullPath);
    const info = await lstat(receiptLocation.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    let evidence;
    if (info) {
      evidence = await readJsonEvidence(root, ledger.batchReceiptFile, "Serial batch receipt");
      validateBatchReceipt(evidence.value, ledger);
    } else {
      const receipt = await batchReceiptFor(root, ledger, now(options));
      await writeAtomicJson(receiptLocation.fullPath, receipt);
      evidence = await readJsonEvidence(root, ledger.batchReceiptFile, "Serial batch receipt");
      validateBatchReceipt(evidence.value, ledger);
    }
    if (options.testHooks?.afterReceiptPersistedBeforeLedgerFinalize) {
      await options.testHooks.afterReceiptPersistedBeforeLedgerFinalize();
    }
    ledger.batchReceiptSha256 = evidence.sha256;
    ledger.finalizedAt = evidence.value.finalizedAt;
    ledger.status = "finalized";
    validateLedgerShape(ledger);
    await writeAtomicJson(context.paths.ledgerPath, ledger);
    return {
      command: "finalize",
      reused: false,
      batchFile: context.paths.ledgerFile,
      receiptFile: ledger.batchReceiptFile,
      ledger,
    };
  } finally {
    await releaseLock(initial.paths.lockPath);
  }
}
