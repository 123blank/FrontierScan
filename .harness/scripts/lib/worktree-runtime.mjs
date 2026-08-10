import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadTaskDag } from "./task-dag-contract.mjs";
export { assertVerifiedBatchBase, resolveBatchBase } from "./batch-base-contract.mjs";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const PLAN_FIELDS = [
  "schemaVersion", "storyId", "runId", "taskId", "title", "ownerAgent", "wave",
  "taskDagFile", "taskDagSha256", "baseRef", "baseCommit", "branch", "worktreePath",
  "predictedFiles", "plannedAt",
];
const BATCH_PLAN_FIELDS = [
  "schemaVersion", "storyId", "runId", "batchId", "ledgerFile", "taskDagFile", "taskDagSha256",
  "baseRef", "baseCommit", "branch", "worktreePath", "plannedAt",
];
const BATCH_STATUS_FIELDS = [
  "schemaVersion", "storyId", "runId", "batchId", "batchPlanSha256", "taskDagSha256", "state",
  "branch", "worktreePath", "baseCommit", "headCommit", "observedAt", "details",
];
const WAVE_PLAN_FIELDS = [
  "schemaVersion", "storyId", "runId", "wave", "taskDagFile", "taskDagSha256",
  "baseRef", "baseCommit", "tasks", "plannedAt",
];
const WAVE_PLAN_TASK_FIELDS = [
  "taskId", "title", "type", "ownerAgent", "branch", "worktreePath", "predictedFiles",
];
const WAVE_STATUS_FIELDS = [
  "schemaVersion", "storyId", "runId", "wave", "wavePlanSha256", "taskDagSha256",
  "state", "baseRef", "baseCommit", "tasks", "observedAt", "details",
];
const WAVE_STATUS_TASK_FIELDS = [
  "taskId", "state", "branch", "worktreePath", "headCommit", "details",
];
const WAVE_LOCK_FIELDS = [
  "schemaVersion", "lockId", "mode", "storyId", "runId", "wave",
  "planSha256", "pid", "createdAt",
];
const WAVE_LOCK_SNAPSHOT_FIELDS = ["file", "sha256", ...WAVE_LOCK_FIELDS];
const WAVE_CREATION_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "wave", "planSha256", "taskDagSha256",
  "statusSha256", "baseCommit", "tasks", "lockRecovered", "completedAt",
];
const WAVE_CREATION_RECEIPT_TASK_FIELDS = [
  "taskId", "branch", "worktreePath", "headCommit",
];
const WAVE_RETIREMENT_LOCK_FIELDS = [
  "schemaVersion", "lockId", "retirementId", "mode", "storyId", "runId", "waveId", "waveIndex",
  "wavePlanSha256", "creationReceiptSha256", "waveLedgerSha256", "waveReceiptSha256", "pid", "createdAt",
];
const WAVE_RETIREMENT_RECOVERY_LOCK_FIELDS = [
  ...WAVE_RETIREMENT_LOCK_FIELDS, "retirementLockFile", "retirementLockSha256",
];
const WAVE_TASK_RETIREMENT_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "waveId", "waveIndex", "retirementId", "taskId",
  "branch", "worktreePath", "baseCommit", "resultFile", "resultSha256",
  "executionReceiptFile", "executionReceiptSha256", "integrationReceiptFile",
  "integrationReceiptSha256", "appliedFiles", "retiredAt", "recovered",
];
const WAVE_RETIREMENT_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "waveId", "waveIndex", "retirementId",
  "statePhase", "stateRuntimeStatus", "stateFile", "stateSha256", "stateEventsFile",
  "stateEventsSha256", "stateBackupFile", "stateBackupSha256", "taskDagFile", "taskDagSha256",
  "wavePlanFile", "wavePlanSha256", "creationReceiptFile", "creationReceiptSha256",
  "integrationManifestFile", "integrationManifestSha256", "waveLedgerFile", "waveLedgerSha256",
  "waveReceiptFile", "waveReceiptSha256", "implementationTaskFile", "implementationTaskSha256",
  "implementationResultFile", "implementationResultSha256", "implementationCheckpointFile",
  "implementationCheckpointSha256", "implementationNotesFile", "implementationNotesSha256",
  "tasks", "appliedFiles", "retiredAt", "recovered",
];
const RETIREMENT_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "taskId", "branch", "worktreePath", "baseCommit",
  "planSha256", "statusSha256", "executionReceiptSha256", "integrationPlanSha256",
  "integrationReceiptSha256", "resultFile", "resultSha256", "retiredAt", "recovered",
];
const BATCH_RETIREMENT_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "batchId", "branch", "worktreePath", "baseCommit",
  "stateFile", "stateSha256", "stateEventsFile", "stateEventsSha256", "stateBackupFile", "stateBackupSha256",
  "batchPlanFile", "batchPlanSha256", "worktreeStatusFile", "worktreeStatusSha256",
  "ledgerFile", "ledgerSha256", "batchReceiptFile", "batchReceiptSha256",
  "implementationTaskFile", "implementationTaskSha256", "implementationResultFile", "implementationResultSha256",
  "implementationCheckpointFile", "implementationCheckpointSha256", "tasks", "appliedFiles", "retiredAt", "recovered",
];
const BATCH_FINALIZATION_FIELDS = [
  "schemaVersion", "storyId", "runId", "stateFile", "phase", "preparedRevision", "batchId",
  "ledgerFile", "ledgerSha256", "receiptFile", "receiptSha256", "taskSha256", "resultSha256", "notesSha256",
];
const BATCH_INPUT_MANIFEST_FIELDS = [
  "schemaVersion", "storyId", "runId", "phase", "batchId", "taskId", "dispatchId", "taskRoot", "baseCommit",
  "inheritedSnapshotSha256", "inheritedFiles", "inputs", "createdAt",
];
const BATCH_INPUT_MANIFEST_ENTRY_FIELDS = ["source", "sourcePath", "targetPath", "sha256", "bytes"];
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RFC3339_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function pathKey(value) {
  const normalized = normalizePath(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier.`);
  }
}

function isRfc3339DateTime(value) {
  if (typeof value !== "string") return false;
  const match = RFC3339_DATE_TIME_PATTERN.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function resolveInsideRoot(root, relativeFile, label) {
  if (typeof relativeFile !== "string" || !relativeFile.trim() || path.isAbsolute(relativeFile)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const fullPath = path.resolve(root, relativeFile);
  const relative = normalizePath(path.relative(root, fullPath));
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
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
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
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
    await unlink(temporary).catch((cleanupError) => {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}

async function fileSha256(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

async function executeGit(root, args, options = {}) {
  const execute = options.executeGit ?? (async (gitArgs) => execFileAsync("git", gitArgs, {
    cwd: root,
    windowsHide: true,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  }));
  return execute(args, root);
}

async function tryGit(root, args, options) {
  try {
    const result = await executeGit(root, args, options);
    return { ok: true, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout ?? ""), stderr: String(error?.stderr ?? error?.message ?? "") };
  }
}

async function inspectGitRef(root, branchRef, options) {
  try {
    await executeGit(root, ["show-ref", "--exists", branchRef], options);
  } catch (error) {
    if (Number(error?.code) === 2) return { exists: false, commit: null };
    const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
    throw new Error(`Git ref probe failed for '${branchRef}': ${diagnostic}`);
  }
  try {
    const result = await executeGit(root, ["show-ref", "--verify", "--hash", branchRef], options);
    return { exists: true, commit: String(result.stdout ?? "").trim() };
  } catch (error) {
    const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
    throw new Error(`Git ref probe failed for '${branchRef}': ${diagnostic}`);
  }
}

async function assertRepositoryRoot(root, options) {
  const result = await tryGit(root, ["rev-parse", "--show-toplevel"], options);
  if (!result.ok || pathKey(result.stdout.trim()) !== pathKey(root)) {
    throw new Error(`Root must be the Git repository top level: ${normalizePath(root)}`);
  }
}

function validateState(state) {
  if (!state || state.schemaVersion !== "1.0" || typeof state.storyId !== "string" || !state.storyId) {
    throw new Error("Harness state has an invalid identity.");
  }
  assertIdentifier(state.storyId, "Story ID");
  assertIdentifier(state.runtime?.runId, "Run ID");
  if (state.runtime?.status !== "active") throw new Error("Worktree planning requires an active Story.");
}

function validateWaveState(state) {
  validateState(state);
  if (state.phase !== "implementation") {
    throw new Error("Wave Worktree planning requires the implementation phase.");
  }
}

function validateRetirementState(state) {
  if (!state || state.schemaVersion !== "1.0" || typeof state.storyId !== "string" || !state.storyId) {
    throw new Error("Harness state has an invalid identity.");
  }
  assertIdentifier(state.storyId, "Story ID");
  assertIdentifier(state.runtime?.runId, "Run ID");
  if (state.phase !== "done" || state.runtime?.status !== "completed") {
    throw new Error("Worktree retirement requires a completed Story.");
  }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task";
}

function compareIdentifiers(left, right) {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function outputPaths(root, state, taskId) {
  const directory = `.harness/runs/${state.runtime.runId}/worktrees/${taskId}`;
  return {
    directory,
    planFile: `${directory}/plan.json`,
    statusFile: `${directory}/status.json`,
    lockFile: `${directory}/create.lock`,
    planPath: resolveInsideRoot(root, `${directory}/plan.json`, "Worktree plan file").fullPath,
    statusPath: resolveInsideRoot(root, `${directory}/status.json`, "Worktree status file").fullPath,
    lockPath: resolveInsideRoot(root, `${directory}/create.lock`, "Worktree lock file").fullPath,
  };
}

function waveOutputPaths(root, state, wave) {
  const directory = `.harness/runs/${state.runtime.runId}/waves/wave-${wave}`;
  const lockDirectory = `.harness/runs/${state.runtime.runId}/waves`;
  return {
    directory,
    planFile: `${directory}/plan.json`,
    statusFile: `${directory}/status.json`,
    createLockFile: `${lockDirectory}/create.lock`,
    recoveryLockFile: `${lockDirectory}/create-recovery.lock`,
    receiptFile: `${directory}/creation-receipt.json`,
    planPath: resolveInsideRoot(root, `${directory}/plan.json`, "Wave Worktree plan file").fullPath,
    statusPath: resolveInsideRoot(root, `${directory}/status.json`, "Wave Worktree status file").fullPath,
    createLockPath: resolveInsideRoot(root, `${lockDirectory}/create.lock`, "Wave Worktree create lock").fullPath,
    recoveryLockPath: resolveInsideRoot(root, `${lockDirectory}/create-recovery.lock`, "Wave Worktree recovery lock").fullPath,
    receiptPath: resolveInsideRoot(root, `${directory}/creation-receipt.json`, "Wave Worktree creation receipt").fullPath,
  };
}

function batchOutputPaths(root, planFile) {
  const planLocation = resolveInsideRoot(root, planFile, "Serial batch Worktree plan file");
  const directory = path.posix.dirname(planLocation.relative);
  const statusFile = `${directory}/worktree-status.json`;
  const lockFile = `${directory}/worktree-create.lock`;
  return {
    directory,
    planFile: planLocation.relative,
    statusFile,
    lockFile,
    planPath: planLocation.fullPath,
    statusPath: resolveInsideRoot(root, statusFile, "Serial batch Worktree status file").fullPath,
    lockPath: resolveInsideRoot(root, lockFile, "Serial batch Worktree create lock").fullPath,
  };
}

function batchRetirementPaths(root, planFile) {
  const outputs = batchOutputPaths(root, planFile);
  const receiptFile = `${outputs.directory}/worktree-retirement-receipt.json`;
  const lockFile = `${outputs.directory}/worktree-retire.lock`;
  return {
    ...outputs,
    retirementReceiptFile: receiptFile,
    retirementLockFile: lockFile,
    retirementReceiptPath: resolveInsideRoot(root, receiptFile, "Serial batch Worktree retirement receipt").fullPath,
    retirementLockPath: resolveInsideRoot(root, lockFile, "Serial batch Worktree retirement lock").fullPath,
  };
}

function retirementPaths(root, state, taskId) {
  const directory = `.harness/runs/${state.runtime.runId}/worktrees/${taskId}`;
  const receiptFile = `${directory}/retirement-receipt.json`;
  const lockFile = `${directory}/retire.lock`;
  return {
    receiptFile,
    lockFile,
    receiptPath: resolveInsideRoot(root, receiptFile, "Worktree retirement receipt").fullPath,
    lockPath: resolveInsideRoot(root, lockFile, "Worktree retirement lock").fullPath,
  };
}

function parseWorktreeList(source) {
  return source.trim().split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const record = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(" ");
      const key = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? true : line.slice(separator + 1);
      record[key] = value;
    }
    return record;
  });
}

function invalidRegisteredWorktreeDetail(worktree, pathInfo, label) {
  if (worktree.prunable || !pathInfo) return `${label} is missing or marked prunable by Git.`;
  if (!pathInfo.isDirectory() || pathInfo.isSymbolicLink()) return `${label} must be a real directory inside the repository.`;
  return null;
}

function validatePlanStructure(plan, state, taskId) {
  const fields = plan && typeof plan === "object" && !Array.isArray(plan) ? Object.keys(plan) : [];
  if (!plan || fields.length !== PLAN_FIELDS.length || PLAN_FIELDS.some((field) => !Object.hasOwn(plan, field))) {
    throw new Error("Worktree plan contains unsupported fields or is missing required fields.");
  }
  if (plan.schemaVersion !== "1.0" || plan.storyId !== state.storyId
      || plan.runId !== state.runtime.runId || plan.taskId !== taskId
      || typeof plan.baseRef !== "string" || typeof plan.baseCommit !== "string"
      || !/^[a-f0-9]{40,64}$/.test(plan.baseCommit)
      || typeof plan.title !== "string" || !plan.title
      || typeof plan.ownerAgent !== "string" || typeof plan.plannedAt !== "string" || !plan.plannedAt
      || typeof plan.branch !== "string" || typeof plan.worktreePath !== "string"
      || typeof plan.taskDagFile !== "string" || !/^sha256:[a-f0-9]{64}$/.test(plan.taskDagSha256)
      || !Number.isInteger(plan.wave) || plan.wave < 1 || !Array.isArray(plan.predictedFiles)
      || plan.predictedFiles.some((item) => typeof item !== "string")) {
    throw new Error("Worktree plan does not match the active Story task.");
  }
  return plan;
}

function validateBatchPlanStructure(plan, batch) {
  const fields = plan && typeof plan === "object" && !Array.isArray(plan) ? Object.keys(plan) : [];
  const ledger = batch?.ledger;
  if (!plan || fields.length !== BATCH_PLAN_FIELDS.length || BATCH_PLAN_FIELDS.some((field) => !Object.hasOwn(plan, field))
      || !ledger || plan.schemaVersion !== "1.0" || plan.storyId !== ledger.storyId || plan.runId !== ledger.runId
      || plan.batchId !== ledger.batchId || plan.ledgerFile !== ledger.ledgerFile
      || plan.taskDagFile !== ledger.taskDagFile || plan.taskDagSha256 !== ledger.taskDagSha256
      || plan.baseRef !== ledger.baseRef || plan.baseCommit !== ledger.baseCommit
      || plan.branch !== `harness/${ledger.storyId.toLowerCase()}/batch-${ledger.batchId}`
      || plan.worktreePath !== `.harness/worktrees/${ledger.storyId}/batch-${ledger.batchId}`
      || typeof plan.plannedAt !== "string" || Number.isNaN(Date.parse(plan.plannedAt))) {
    throw new Error("Serial batch Worktree plan does not match the verified batch ledger.");
  }
  return plan;
}

function assertBatchCommandInputs(options) {
  for (const field of ["taskId", "taskDagFile", "baseRef", "branch", "worktreePath"]) {
    if (options[field] !== undefined && options[field] !== null) {
      throw new Error(`Batch Worktree commands derive identity, branch, path, and base from the serial batch ledger; ${field} is not accepted.`);
    }
  }
}

function validateBatchStatusStructure(status, plan, planSha256) {
  const fields = status && typeof status === "object" && !Array.isArray(status) ? Object.keys(status) : [];
  if (!status || fields.length !== BATCH_STATUS_FIELDS.length || BATCH_STATUS_FIELDS.some((field) => !Object.hasOwn(status, field))
      || status.schemaVersion !== "1.0" || status.storyId !== plan.storyId || status.runId !== plan.runId
      || status.batchId !== plan.batchId || status.batchPlanSha256 !== planSha256
      || status.taskDagSha256 !== plan.taskDagSha256 || status.branch !== plan.branch
      || status.worktreePath !== plan.worktreePath || status.baseCommit !== plan.baseCommit
      || !["absent", "created", "inconsistent"].includes(status.state)
      || (status.headCommit !== null && typeof status.headCommit !== "string")
      || typeof status.observedAt !== "string" || Number.isNaN(Date.parse(status.observedAt))
      || !Array.isArray(status.details) || status.details.some((item) => typeof item !== "string")) {
    throw new Error("Serial batch Worktree status has an invalid structure.");
  }
  return status;
}

function validateWavePlanStructure(plan, state, wave) {
  const fields = plan && typeof plan === "object" && !Array.isArray(plan) ? Object.keys(plan) : [];
  if (!plan || fields.length !== WAVE_PLAN_FIELDS.length || WAVE_PLAN_FIELDS.some((field) => !Object.hasOwn(plan, field))
      || plan.schemaVersion !== "1.0" || plan.storyId !== state.storyId || plan.runId !== state.runtime.runId
      || plan.wave !== wave || !Number.isInteger(plan.wave) || plan.wave < 1
      || typeof plan.taskDagFile !== "string" || !/^sha256:[a-f0-9]{64}$/.test(plan.taskDagSha256)
      || typeof plan.baseRef !== "string" || !/^[a-f0-9]{40,64}$/.test(plan.baseCommit)
      || typeof plan.plannedAt !== "string" || Number.isNaN(Date.parse(plan.plannedAt))
      || !Array.isArray(plan.tasks) || plan.tasks.length < 2) {
    throw new Error("Wave Worktree plan has an invalid structure.");
  }
  for (const task of plan.tasks) {
    assertIdentifier(task?.taskId, "Task ID");
    const taskFields = task && typeof task === "object" && !Array.isArray(task) ? Object.keys(task) : [];
    if (!task || taskFields.length !== WAVE_PLAN_TASK_FIELDS.length
        || WAVE_PLAN_TASK_FIELDS.some((field) => !Object.hasOwn(task, field))
        || typeof task.taskId !== "string" || typeof task.title !== "string"
        || !["backend", "frontend"].includes(task.type) || typeof task.ownerAgent !== "string"
        || typeof task.branch !== "string" || typeof task.worktreePath !== "string"
        || !Array.isArray(task.predictedFiles) || task.predictedFiles.some((item) => typeof item !== "string")) {
      throw new Error("Wave Worktree plan task has an invalid structure.");
    }
  }
  return plan;
}

function validateWaveStatusStructure(status, plan, planSha256) {
  const fields = status && typeof status === "object" && !Array.isArray(status) ? Object.keys(status) : [];
  if (!status || fields.length !== WAVE_STATUS_FIELDS.length || WAVE_STATUS_FIELDS.some((field) => !Object.hasOwn(status, field))
      || status.schemaVersion !== "1.0" || status.storyId !== plan.storyId || status.runId !== plan.runId
      || status.wave !== plan.wave || status.wavePlanSha256 !== planSha256
      || status.taskDagSha256 !== plan.taskDagSha256 || !["absent", "partial", "ready"].includes(status.state)
      || status.baseRef !== plan.baseRef || status.baseCommit !== plan.baseCommit
      || !Array.isArray(status.tasks) || status.tasks.length !== plan.tasks.length
      || typeof status.observedAt !== "string" || Number.isNaN(Date.parse(status.observedAt))
      || !Array.isArray(status.details) || status.details.some((item) => typeof item !== "string")) {
    throw new Error("Wave Worktree status has an invalid structure.");
  }
  for (const task of status.tasks) {
    const taskFields = task && typeof task === "object" && !Array.isArray(task) ? Object.keys(task) : [];
    if (!task || taskFields.length !== WAVE_STATUS_TASK_FIELDS.length
        || WAVE_STATUS_TASK_FIELDS.some((field) => !Object.hasOwn(task, field))
        || typeof task.taskId !== "string" || !["absent", "branch-only", "created"].includes(task.state)
        || typeof task.branch !== "string" || typeof task.worktreePath !== "string"
        || (task.headCommit !== null && typeof task.headCommit !== "string") || !Array.isArray(task.details)
        || task.details.some((item) => typeof item !== "string")) {
      throw new Error("Wave Worktree task status has an invalid structure.");
    }
  }
  return status;
}

function validateWaveLockSnapshot(snapshot, expectedMode, plan, planSha256) {
  if (snapshot === null) return null;
  const fields = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? Object.keys(snapshot)
    : [];
  if (!snapshot || fields.length !== WAVE_LOCK_SNAPSHOT_FIELDS.length
      || WAVE_LOCK_SNAPSHOT_FIELDS.some((field) => !Object.hasOwn(snapshot, field))
      || typeof snapshot.file !== "string" || !snapshot.file
      || !/^sha256:[a-f0-9]{64}$/.test(snapshot.sha256)
      || snapshot.schemaVersion !== "1.0"
      || typeof snapshot.lockId !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(snapshot.lockId)
      || snapshot.mode !== expectedMode
      || snapshot.storyId !== plan.storyId || snapshot.runId !== plan.runId
      || snapshot.wave !== plan.wave || snapshot.planSha256 !== planSha256
      || !Number.isInteger(snapshot.pid) || snapshot.pid < 1
      || typeof snapshot.createdAt !== "string" || Number.isNaN(Date.parse(snapshot.createdAt))) {
    throw new Error(`Wave Worktree ${expectedMode} lock has an invalid structure.`);
  }
  return snapshot;
}

function validateWaveCreationReceipt(receipt, plan, planSha256, status, statusSha256) {
  const fields = receipt && typeof receipt === "object" && !Array.isArray(receipt)
    ? Object.keys(receipt)
    : [];
  if (!receipt || fields.length !== WAVE_CREATION_RECEIPT_FIELDS.length
      || WAVE_CREATION_RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))
      || receipt.schemaVersion !== "1.0"
      || receipt.storyId !== plan.storyId || receipt.runId !== plan.runId
      || receipt.wave !== plan.wave || receipt.planSha256 !== planSha256
      || receipt.taskDagSha256 !== plan.taskDagSha256
      || receipt.statusSha256 !== statusSha256 || receipt.baseCommit !== plan.baseCommit
      || typeof receipt.lockRecovered !== "boolean"
      || typeof receipt.completedAt !== "string" || Number.isNaN(Date.parse(receipt.completedAt))
      || !Array.isArray(receipt.tasks) || receipt.tasks.length !== plan.tasks.length) {
    throw new Error("Wave Worktree creation receipt has an invalid structure.");
  }
  for (let index = 0; index < receipt.tasks.length; index += 1) {
    const task = receipt.tasks[index];
    const planned = plan.tasks[index];
    const observed = status.tasks[index];
    const taskFields = task && typeof task === "object" && !Array.isArray(task)
      ? Object.keys(task)
      : [];
    if (!task || taskFields.length !== WAVE_CREATION_RECEIPT_TASK_FIELDS.length
        || WAVE_CREATION_RECEIPT_TASK_FIELDS.some((field) => !Object.hasOwn(task, field))
        || task.taskId !== planned.taskId || task.branch !== planned.branch
        || task.worktreePath !== planned.worktreePath
        || observed.state !== "created" || task.headCommit !== observed.headCommit
        || task.headCommit !== plan.baseCommit) {
      throw new Error("Wave Worktree creation receipt task has an invalid structure.");
    }
  }
  return receipt;
}

function comparableWavePlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    storyId: plan.storyId,
    runId: plan.runId,
    wave: plan.wave,
    taskDagFile: plan.taskDagFile,
    taskDagSha256: plan.taskDagSha256,
    baseRef: plan.baseRef,
    baseCommit: plan.baseCommit,
    tasks: plan.tasks,
  };
}

function comparableWaveStatus(status) {
  return {
    schemaVersion: status.schemaVersion,
    storyId: status.storyId,
    runId: status.runId,
    wave: status.wave,
    wavePlanSha256: status.wavePlanSha256,
    taskDagSha256: status.taskDagSha256,
    state: status.state,
    baseRef: status.baseRef,
    baseCommit: status.baseCommit,
    tasks: status.tasks,
    details: status.details,
  };
}

function comparableBatchStatus(status) {
  return {
    schemaVersion: status.schemaVersion,
    storyId: status.storyId,
    runId: status.runId,
    batchId: status.batchId,
    batchPlanSha256: status.batchPlanSha256,
    taskDagSha256: status.taskDagSha256,
    state: status.state,
    branch: status.branch,
    worktreePath: status.worktreePath,
    baseCommit: status.baseCommit,
    headCommit: status.headCommit,
    details: status.details,
  };
}

function comparablePlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    storyId: plan.storyId,
    runId: plan.runId,
    taskId: plan.taskId,
    title: plan.title,
    ownerAgent: plan.ownerAgent,
    wave: plan.wave,
    taskDagFile: plan.taskDagFile,
    taskDagSha256: plan.taskDagSha256,
    baseRef: plan.baseRef,
    baseCommit: plan.baseCommit,
    branch: plan.branch,
    worktreePath: plan.worktreePath,
    predictedFiles: plan.predictedFiles,
  };
}

async function validateStoredPlan(root, plan, state, taskId) {
  validatePlanStructure(plan, state, taskId);
  const expectedBranch = `harness/${state.storyId.toLowerCase()}/${taskId.toLowerCase()}-${slug(plan.title)}`;
  const expectedPath = `.harness/worktrees/${state.storyId}/${taskId}`;
  if (plan.branch !== expectedBranch || plan.worktreePath !== expectedPath) {
    throw new Error("Worktree plan contains an invalid derived branch or path.");
  }
  const taskDagLocation = resolveInsideRoot(root, plan.taskDagFile, "Bound Task DAG file");
  await assertSafeTargetParents(root, taskDagLocation.fullPath);
  if (await fileSha256(taskDagLocation.fullPath) !== plan.taskDagSha256) {
    throw new Error("The bound Task DAG has changed since Worktree planning.");
  }
  const loaded = await loadTaskDag(taskDagLocation.fullPath);
  const task = loaded.nodes.get(taskId);
  if (loaded.dag.storyId !== state.storyId || !task || task.status !== "pending"
      || task.title !== plan.title || (task.ownerAgent ?? "") !== plan.ownerAgent
      || loaded.waveByTask.get(taskId) + 1 !== plan.wave
      || JSON.stringify(task.predictedFiles) !== JSON.stringify(plan.predictedFiles)) {
    throw new Error("Worktree plan no longer matches its bound Task DAG.");
  }
  return plan;
}

async function inspectStatus(root, plan, planPath, statusPath, options) {
  const list = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const targetPath = resolveInsideRoot(root, plan.worktreePath, "Worktree path").fullPath;
  const worktree = parseWorktreeList(String(list.stdout ?? "")).find((item) => pathKey(item.worktree ?? "") === pathKey(targetPath));
  const branchRef = `refs/heads/${plan.branch}`;
  const branch = await inspectGitRef(root, branchRef, options);
  const branchCommit = branch.commit;
  const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  let state = "absent";
  const details = [];
  if (worktree) {
    let targetIssue = invalidRegisteredWorktreeDetail(worktree, pathInfo, "Target worktree path");
    if (!targetIssue) {
      try {
        await assertSafeTargetParents(root, targetPath);
      } catch (error) {
        targetIssue = error instanceof Error ? error.message : String(error);
      }
    }
    if (targetIssue) {
      state = "inconsistent";
      details.push(targetIssue);
    } else {
      const actualBranch = worktree.branch === branchRef ? plan.branch : String(worktree.branch ?? "");
      if (worktree.HEAD === plan.baseCommit && actualBranch === plan.branch) state = "created";
      else {
        state = "inconsistent";
        details.push("Target worktree branch or HEAD does not match the plan.");
      }
    }
  } else if (pathInfo) {
    state = "inconsistent";
    details.push("Target worktree path is occupied but not registered by Git.");
  } else if (branchCommit && branchCommit !== plan.baseCommit) {
    state = "inconsistent";
    details.push("Target branch does not point to the planned base commit.");
  } else if (branchCommit) {
    details.push("Target branch exists at the planned base commit and can be resumed.");
  }
  const status = {
    schemaVersion: "1.0",
    storyId: plan.storyId,
    runId: plan.runId,
    taskId: plan.taskId,
    planSha256: await fileSha256(planPath),
    state,
    branch: plan.branch,
    worktreePath: plan.worktreePath,
    baseCommit: plan.baseCommit,
    headCommit: worktree?.HEAD ?? null,
    observedAt: (options.now ?? (() => new Date().toISOString()))(),
    details,
  };
  await writeAtomicJson(statusPath, status);
  return status;
}

async function inspectBatchStatus(root, plan, planPath, statusPath, expectedPlanSha256, options) {
  const planSha256 = await fileSha256(planPath);
  if (planSha256 !== expectedPlanSha256) {
    throw new Error("Serial batch Worktree plan changed while inspecting status.");
  }
  const list = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const targetPath = resolveInsideRoot(root, plan.worktreePath, "Serial batch Worktree path").fullPath;
  const worktree = parseWorktreeList(String(list.stdout ?? "")).find((item) => pathKey(item.worktree ?? "") === pathKey(targetPath));
  const branchRef = `refs/heads/${plan.branch}`;
  const branch = await inspectGitRef(root, branchRef, options);
  const branchCommit = branch.commit;
  const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  let state = "absent";
  const details = [];
  if (worktree) {
    let targetIssue = invalidRegisteredWorktreeDetail(worktree, pathInfo, "Target batch Worktree path");
    if (!targetIssue) {
      try {
        await assertSafeTargetParents(root, targetPath);
      } catch (error) {
        targetIssue = error instanceof Error ? error.message : String(error);
      }
    }
    if (targetIssue) {
      state = "inconsistent";
      details.push(targetIssue);
    } else {
      const actualBranch = worktree.branch === branchRef ? plan.branch : String(worktree.branch ?? "");
      if (worktree.HEAD === plan.baseCommit && actualBranch === plan.branch) state = "created";
      else {
        state = "inconsistent";
        details.push("Target batch Worktree branch or HEAD does not match the plan.");
      }
    }
  } else if (pathInfo) {
    state = "inconsistent";
    details.push("Target batch Worktree path is occupied but not registered by Git.");
  } else if (branchCommit && branchCommit !== plan.baseCommit) {
    state = "inconsistent";
    details.push("Target batch Worktree branch does not point to the planned base commit.");
  } else if (branchCommit) {
    details.push("Target batch Worktree branch exists at the planned base commit and can be resumed.");
  }
  const status = {
    schemaVersion: "1.0",
    storyId: plan.storyId,
    runId: plan.runId,
    batchId: plan.batchId,
    batchPlanSha256: planSha256,
    taskDagSha256: plan.taskDagSha256,
    state,
    branch: plan.branch,
    worktreePath: plan.worktreePath,
    baseCommit: plan.baseCommit,
    headCommit: worktree?.HEAD ?? null,
    observedAt: (options.now ?? (() => new Date().toISOString()))(),
    details,
  };
  validateBatchStatusStructure(status, plan, planSha256);
  const stored = await lstat(statusPath).then(
    () => readJsonFile(statusPath, "Serial batch Worktree status"),
    (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
  );
  if (stored) {
    validateBatchStatusStructure(stored, plan, planSha256);
    if (JSON.stringify(comparableBatchStatus(stored)) === JSON.stringify(comparableBatchStatus(status))) {
      return stored;
    }
  }
  await writeAtomicJson(statusPath, status);
  return status;
}

async function loadContext(root, options) {
  await assertRepositoryRoot(root, options);
  const stateLocation = resolveInsideRoot(root, options.stateFile, "State file");
  await assertSafeTargetParents(root, stateLocation.fullPath);
  const state = await readJsonFile(stateLocation.fullPath, "State file");
  validateState(state);
  assertIdentifier(options.taskId, "Task ID");
  const outputs = outputPaths(root, state, options.taskId);
  await assertSafeTargetParents(root, outputs.planPath);
  return { state, stateFile: stateLocation.relative, ...outputs };
}

async function loadWaveContext(root, options) {
  await assertRepositoryRoot(root, options);
  const stateLocation = resolveInsideRoot(root, options.stateFile, "State file");
  await assertSafeTargetParents(root, stateLocation.fullPath);
  const state = await readJsonFile(stateLocation.fullPath, "State file");
  validateWaveState(state);
  if (!Number.isInteger(options.waveIndex) || options.waveIndex < 1) {
    throw new Error("Wave index must be a positive integer.");
  }
  const outputs = waveOutputPaths(root, state, options.waveIndex);
  await assertSafeTargetParents(root, outputs.planPath);
  await assertSafeTargetParents(root, outputs.statusPath);
  await assertSafeTargetParents(root, outputs.createLockPath);
  await assertSafeTargetParents(root, outputs.recoveryLockPath);
  await assertSafeTargetParents(root, outputs.receiptPath);
  return { state, stateFile: stateLocation.relative, ...outputs };
}

async function validateStoredWavePlan(root, plan, state, wave, taskDagFile) {
  validateWavePlanStructure(plan, state, wave);
  const taskDagLocation = resolveInsideRoot(root, taskDagFile, "Task DAG file");
  if (taskDagLocation.relative !== plan.taskDagFile) {
    throw new Error("Wave Worktree plan is bound to a different Task DAG.");
  }
  await assertSafeTargetParents(root, taskDagLocation.fullPath);
  if (await fileSha256(taskDagLocation.fullPath) !== plan.taskDagSha256) {
    throw new Error("The bound Task DAG has changed since Wave Worktree planning.");
  }
  const loaded = await loadTaskDag(taskDagLocation.fullPath);
  const taskIds = loaded.dag.waves[wave - 1];
  if (loaded.dag.storyId !== state.storyId || !taskIds || taskIds.length !== plan.tasks.length) {
    throw new Error("Wave Worktree plan no longer matches its bound Task DAG.");
  }
  const expectedTaskIds = [...taskIds].sort(compareIdentifiers);
  const plannedTaskIds = plan.tasks.map((task) => task.taskId);
  if (new Set(plannedTaskIds).size !== plannedTaskIds.length
      || JSON.stringify(plannedTaskIds) !== JSON.stringify(expectedTaskIds)) {
    throw new Error("Wave Worktree plan task set does not match its bound Task DAG.");
  }
  for (const plannedTask of plan.tasks) {
    const task = loaded.nodes.get(plannedTask.taskId);
    const expectedBranch = `harness/${state.storyId.toLowerCase()}/wave-${wave}-${task?.taskId.toLowerCase()}-${slug(task?.title ?? "")}`;
    const expectedPath = `.harness/worktrees/${state.storyId}/wave-${wave}/${plannedTask.taskId}`;
    if (!task || !taskIds.includes(task.taskId) || task.status !== "pending"
        || task.title !== plannedTask.title || task.type !== plannedTask.type
        || (task.ownerAgent ?? "") !== plannedTask.ownerAgent
        || JSON.stringify(task.predictedFiles) !== JSON.stringify(plannedTask.predictedFiles)
        || plannedTask.branch !== expectedBranch || plannedTask.worktreePath !== expectedPath) {
      throw new Error("Wave Worktree plan no longer matches its bound Task DAG.");
    }
  }
  return plan;
}

async function inspectWaveLock(root, lockFile, expectedMode, plan, planSha256) {
  const location = resolveInsideRoot(root, lockFile, `Wave Worktree ${expectedMode} lock`);
  await assertSafeTargetParents(root, location.fullPath);
  const lock = await readJsonOptional(location.fullPath, `Wave Worktree ${expectedMode} lock`);
  if (!lock) return null;
  const fields = Object.keys(lock);
  if (fields.length !== WAVE_LOCK_FIELDS.length
      || WAVE_LOCK_FIELDS.some((field) => !Object.hasOwn(lock, field))) {
    throw new Error(`Wave Worktree ${expectedMode} lock has an invalid structure.`);
  }
  const snapshot = {
    file: location.relative,
    sha256: await fileSha256(location.fullPath),
    ...lock,
  };
  return validateWaveLockSnapshot(snapshot, expectedMode, plan, planSha256);
}

async function inspectWaveLocks(root, context, plan, planSha256) {
  return {
    create: await inspectWaveLock(root, context.createLockFile, "create", plan, planSha256),
    recovery: await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, planSha256),
  };
}

function assertWaveCreateInputs(options) {
  if (options.confirmWaveCreate !== true) {
    throw new Error("Wave Worktree creation requires explicit approval and ConfirmWaveCreate.");
  }
  if (typeof options.expectedPlanSha256 !== "string"
      || !/^sha256:[a-f0-9]{64}$/.test(options.expectedPlanSha256)) {
    throw new Error("Wave Worktree creation requires ExpectedPlanSha256.");
  }
  for (const field of ["taskId", "baseRef", "branch", "worktreePath"]) {
    if (options[field] !== undefined && options[field] !== null) {
      throw new Error(`Wave Worktree creation derives identity, branch, path, and base from the approved plan; ${field} is not accepted.`);
    }
  }
  for (const field of ["expectedCreateLockSha256", "expectedRecoveryLockSha256"]) {
    const value = options[field];
    if (value !== undefined && value !== null && !/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new Error(`${field} must be a SHA-256 value.`);
    }
  }
  if (options.confirmWaveLockRecovery !== true
      && (options.expectedCreateLockSha256 || options.expectedRecoveryLockSha256)) {
    throw new Error("Wave lock hash inputs require ConfirmWaveLockRecovery.");
  }
}

function assertWaveRetireInputs(options) {
  if (options.confirmRetire !== true) {
    throw new Error("Wave Worktree retirement requires explicit approval and ConfirmRetire.");
  }
  if (typeof options.taskDagFile !== "string" || !options.taskDagFile.trim()) {
    throw new Error("Wave Worktree retirement requires TaskDagFile.");
  }
  for (const [field, label] of [
    ["expectedWaveLedgerSha256", "ExpectedWaveLedgerSha256"],
    ["expectedWaveReceiptSha256", "ExpectedWaveReceiptSha256"],
  ]) {
    if (typeof options[field] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(options[field])) {
      throw new Error(`Wave Worktree retirement requires ${label}.`);
    }
  }
  for (const field of ["taskId", "baseRef", "branch", "worktreePath", "confirmCreate", "confirmWaveCreate", "confirmWaveLockRecovery"]) {
    if (options[field] !== undefined && options[field] !== null) {
      throw new Error(`Wave Worktree retirement derives identity, branch, path, and base from finalized Wave evidence; ${field} is not accepted.`);
    }
  }
  for (const field of ["expectedRetirementLockSha256", "expectedRetirementRecoveryLockSha256"]) {
    const value = options[field];
    if (value !== undefined && value !== null && !/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new Error(`${field} must be a SHA-256 value.`);
    }
  }
  if (options.confirmWaveRetireLockRecovery !== true
      && (options.expectedRetirementLockSha256 || options.expectedRetirementRecoveryLockSha256)) {
    throw new Error("Wave retirement lock hash inputs require ConfirmWaveRetireLockRecovery.");
  }
}

async function loadApprovedWavePlan(root, context, options) {
  const plan = await validateStoredWavePlan(
    root,
    await readJsonFile(context.planPath, "Wave Worktree plan"),
    context.state,
    options.waveIndex,
    options.taskDagFile,
  );
  const planSha256 = await fileSha256(context.planPath);
  if (planSha256 !== options.expectedPlanSha256) {
    throw new Error("Wave Worktree approved plan hash does not match ExpectedPlanSha256.");
  }
  return { plan, planSha256 };
}

async function writeExclusiveJson(filePath, value, existsMessage) {
  await mkdir(path.dirname(filePath), { recursive: true });
  let handle;
  try {
    handle = await open(filePath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(existsMessage);
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(filePath).catch(() => {});
    throw error;
  }
}

async function acquireWaveCreateLock(root, context, plan, planSha256, options) {
  const recovery = await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, planSha256);
  if (recovery) throw new Error("Wave Worktree recovery lock already exists; inspect it before retrying.");
  const lock = {
    schemaVersion: "1.0",
    lockId: randomUUID(),
    mode: "create",
    storyId: plan.storyId,
    runId: plan.runId,
    wave: plan.wave,
    planSha256,
    pid: process.pid,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  await writeExclusiveJson(
    context.createLockPath,
    lock,
    "Wave Worktree create lock already exists; inspect it before retrying.",
  );
  const owner = await inspectWaveLock(root, context.createLockFile, "create", plan, planSha256);
  if (options.afterWaveCreateLockAcquired) await options.afterWaveCreateLockAcquired();
  const racedRecovery = await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, planSha256);
  if (racedRecovery) {
    throw new Error("Wave Worktree recovery started while create ownership was being acquired.");
  }
  return owner;
}

async function assertWaveLockOwned(root, context, plan, owner) {
  const lockFile = owner.mode === "recovery" ? context.recoveryLockFile : context.createLockFile;
  const current = await inspectWaveLock(root, lockFile, owner.mode, plan, owner.planSha256);
  if (!current || current.lockId !== owner.lockId || current.sha256 !== owner.sha256) {
    throw new Error(`Wave Worktree ${owner.mode} lock ownership has changed.`);
  }
  if (owner.mode === "create") {
    const recovery = await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, owner.planSha256);
    if (recovery) throw new Error("Wave Worktree create ownership was fenced by a recovery lock.");
  }
  return current;
}

async function assertWaveMutationAuthorized(root, context, owner, options) {
  const approved = await loadApprovedWavePlan(root, context, options);
  await assertWaveLockOwned(root, context, approved.plan, owner);
  return approved;
}

function assertExpectedWaveLock(snapshot, expectedSha256, label) {
  if (snapshot && !expectedSha256) throw new Error(`${label} requires its expected lock hash.`);
  if (!snapshot && expectedSha256) throw new Error(`${label} does not exist but an expected lock hash was provided.`);
  if (snapshot && snapshot.sha256 !== expectedSha256) throw new Error(`${label} hash does not match the approved lock hash.`);
}

async function acquireWaveRecoveryLock(root, context, plan, planSha256, options) {
  const createLock = await inspectWaveLock(root, context.createLockFile, "create", plan, planSha256);
  const recoveryLock = await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, planSha256);
  if (!createLock && !recoveryLock) {
    throw new Error("Wave lock recovery requires an existing create or recovery lock.");
  }
  assertExpectedWaveLock(createLock, options.expectedCreateLockSha256, "ExpectedCreateLockSha256");
  assertExpectedWaveLock(recoveryLock, options.expectedRecoveryLockSha256, "ExpectedRecoveryLockSha256");
  const lock = {
    schemaVersion: "1.0",
    lockId: randomUUID(),
    mode: "recovery",
    storyId: plan.storyId,
    runId: plan.runId,
    wave: plan.wave,
    planSha256,
    pid: process.pid,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  if (options.beforeWaveRecoveryLockWrite) await options.beforeWaveRecoveryLockWrite();
  const preWriteCreateLock = await inspectWaveLock(
    root,
    context.createLockFile,
    "create",
    plan,
    planSha256,
  );
  const preWriteRecoveryLock = await inspectWaveLock(
    root,
    context.recoveryLockFile,
    "recovery",
    plan,
    planSha256,
  );
  assertExpectedWaveLock(preWriteCreateLock, options.expectedCreateLockSha256, "ExpectedCreateLockSha256");
  assertExpectedWaveLock(preWriteRecoveryLock, options.expectedRecoveryLockSha256, "ExpectedRecoveryLockSha256");
  try {
    await writeAtomicJson(context.recoveryLockPath, lock);
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    const currentOwner = await inspectWaveLock(
      root,
      context.recoveryLockFile,
      "recovery",
      plan,
      planSha256,
    ).catch(() => null);
    if (!currentOwner || currentOwner.lockId === lock.lockId) throw error;
    throw new Error("Wave Worktree recovery lock ownership has changed during acquisition.");
  }
  if (options.afterWaveRecoveryLockWrite) await options.afterWaveRecoveryLockWrite();
  const owner = await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, planSha256);
  if (!owner || owner.lockId !== lock.lockId) {
    throw new Error("Wave Worktree recovery lock ownership has changed during acquisition.");
  }
  if (options.afterWaveRecoveryLockAcquired) await options.afterWaveRecoveryLockAcquired();
  const currentCreateLock = await inspectWaveLock(root, context.createLockFile, "create", plan, planSha256);
  assertExpectedWaveLock(currentCreateLock, options.expectedCreateLockSha256, "ExpectedCreateLockSha256");
  return {
    ...owner,
    expectedCreateLockSha256: options.expectedCreateLockSha256 ?? null,
  };
}

async function releaseWaveLockOwned(root, context, plan, owner, options) {
  if (options.beforeWaveLockRelease) await options.beforeWaveLockRelease(owner.mode);
  if (owner.mode === "create") {
    const recovery = await inspectWaveLock(root, context.recoveryLockFile, "recovery", plan, owner.planSha256);
    if (recovery) return false;
    await assertWaveLockOwned(root, context, plan, owner);
    await unlink(context.createLockPath);
    return true;
  }
  await assertWaveLockOwned(root, context, plan, owner);
  const createLock = await inspectWaveLock(root, context.createLockFile, "create", plan, owner.planSha256);
  assertExpectedWaveLock(createLock, owner.expectedCreateLockSha256, "ExpectedCreateLockSha256");
  if (createLock) await unlink(context.createLockPath);
  await assertWaveLockOwned(root, context, plan, owner);
  await unlink(context.recoveryLockPath);
  return true;
}

async function assertWaveStoryAllowlist(root, plan, options) {
  const listed = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const worktrees = parseWorktreeList(String(listed.stdout ?? ""));
  const storyRoot = pathKey(path.resolve(root, `.harness/worktrees/${plan.storyId}`));
  const allowedPaths = new Set(plan.tasks.map((task) => pathKey(path.resolve(root, task.worktreePath))));
  const unplanned = worktrees.find((item) => {
    const candidate = pathKey(item.worktree ?? "");
    return candidate.startsWith(`${storyRoot}/`) && !allowedPaths.has(candidate);
  });
  if (unplanned) throw new Error("Wave Worktree allowlist rejects an unplanned Worktree for the current Story.");
}

async function createWaveTask(root, plan, taskStatus, options, beforeWrite) {
  const task = plan.tasks.find((item) => item.taskId === taskStatus.taskId);
  if (!task) throw new Error(`Wave Worktree plan is missing task '${taskStatus.taskId}'.`);
  const targetPath = resolveInsideRoot(root, task.worktreePath, "Wave Worktree path").fullPath;
  await assertSafeTargetParents(root, targetPath);
  const branch = await inspectGitRef(root, `refs/heads/${task.branch}`, options);
  if (branch.exists && branch.commit !== plan.baseCommit) {
    throw new Error(`Wave task '${task.taskId}' branch does not point to the planned base commit.`);
  }
  const args = branch.exists
    ? ["worktree", "add", targetPath, task.branch]
    : ["worktree", "add", "-b", task.branch, targetPath, plan.baseCommit];
  if (options.beforeWaveGitWrite) await options.beforeWaveGitWrite(task.taskId);
  if (beforeWrite) await beforeWrite();
  try {
    await executeGit(root, args, options);
  } catch (error) {
    const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
    throw new Error(`git worktree add failed for wave task '${task.taskId}': ${diagnostic}`);
  }
}

async function ensureWaveCreationReceipt(root, context, plan, planSha256, status, owner, options) {
  if (status.state !== "ready" || status.tasks.some((task) => task.state !== "created")) {
    throw new Error("Wave Worktree creation receipt requires a ready status.");
  }
  await assertWaveLockOwned(root, context, plan, owner);
  if (await fileSha256(context.planPath) !== options.expectedPlanSha256) {
    throw new Error("Wave Worktree approved plan hash changed before receipt creation.");
  }
  const statusSha256 = await fileSha256(context.statusPath);
  const existing = await readJsonOptional(context.receiptPath, "Wave Worktree creation receipt");
  if (existing) {
    return {
      reused: true,
      receipt: validateWaveCreationReceipt(existing, plan, planSha256, status, statusSha256),
    };
  }
  const receipt = {
    schemaVersion: "1.0",
    storyId: plan.storyId,
    runId: plan.runId,
    wave: plan.wave,
    planSha256,
    taskDagSha256: plan.taskDagSha256,
    statusSha256,
    baseCommit: plan.baseCommit,
    tasks: status.tasks.map((task) => ({
      taskId: task.taskId,
      branch: task.branch,
      worktreePath: task.worktreePath,
      headCommit: task.headCommit,
    })),
    lockRecovered: owner.mode === "recovery",
    completedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  validateWaveCreationReceipt(receipt, plan, planSha256, status, statusSha256);
  if (options.beforeWaveReceiptWrite) await options.beforeWaveReceiptWrite(receipt);
  await assertWaveLockOwned(root, context, plan, owner);
  if (await fileSha256(context.planPath) !== options.expectedPlanSha256) {
    throw new Error("Wave Worktree approved plan hash changed before receipt write.");
  }
  await writeAtomicJson(context.receiptPath, receipt);
  await assertWaveLockOwned(root, context, plan, owner);
  const stored = await readJsonFile(context.receiptPath, "Wave Worktree creation receipt");
  return {
    reused: false,
    receipt: validateWaveCreationReceipt(stored, plan, planSha256, status, statusSha256),
  };
}

async function inspectWaveStatus(root, plan, planPath, statusPath, options, beforeWrite, persist = true) {
  const currentBase = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${plan.baseRef}^{commit}`], options);
  if (!currentBase.ok || currentBase.stdout.trim() !== plan.baseCommit) {
    throw new Error(`Planned base ref '${plan.baseRef}' has moved or is unavailable.`);
  }
  const listed = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const worktrees = parseWorktreeList(String(listed.stdout ?? ""));
  const waveRoot = pathKey(path.resolve(root, `.harness/worktrees/${plan.storyId}/wave-${plan.wave}`));
  const plannedPaths = new Set(plan.tasks.map((task) => pathKey(path.resolve(root, task.worktreePath))));
  const unplanned = worktrees.find((item) => {
    const candidate = pathKey(item.worktree ?? "");
    return candidate.startsWith(`${waveRoot}/`) && !plannedPaths.has(candidate);
  });
  if (unplanned) throw new Error("Wave contains an unplanned registered Worktree.");
  const tasks = [];
  for (const task of plan.tasks) {
    const targetPath = resolveInsideRoot(root, task.worktreePath, "Wave Worktree path").fullPath;
    await assertSafeTargetParents(root, targetPath);
    const registered = worktrees.find((item) => pathKey(item.worktree ?? "") === pathKey(targetPath));
    const branchRef = `refs/heads/${task.branch}`;
    const branchWorktree = worktrees.find((item) => item.branch === branchRef);
    const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    const branch = await inspectGitRef(root, branchRef, options);
    let state = "absent";
    const details = [];
    let headCommit = null;
    if (registered) {
      const issue = invalidRegisteredWorktreeDetail(registered, pathInfo, `Wave task '${task.taskId}' Worktree`);
      if (issue) throw new Error(issue);
      if (registered.branch !== branchRef || registered.HEAD !== plan.baseCommit
          || !branch.exists || branch.commit !== plan.baseCommit) {
        throw new Error(`Wave task '${task.taskId}' Worktree branch or HEAD does not match the plan.`);
      }
      state = "created";
      headCommit = registered.HEAD;
    } else if (pathInfo) {
      throw new Error(`Wave task '${task.taskId}' Worktree path is occupied but not registered by Git.`);
    } else if (branchWorktree) {
      throw new Error(`Wave task '${task.taskId}' branch is mounted at another Worktree path.`);
    } else if (branch.exists) {
      if (branch.commit !== plan.baseCommit) {
        throw new Error(`Wave task '${task.taskId}' branch does not point to the planned base commit.`);
      }
      state = "branch-only";
      details.push("Target branch exists at the planned base commit and can be resumed.");
    }
    tasks.push({
      taskId: task.taskId,
      state,
      branch: task.branch,
      worktreePath: task.worktreePath,
      headCommit,
      details,
    });
  }
  const state = tasks.every((task) => task.state === "created")
    ? "ready"
    : tasks.every((task) => task.state === "absent") ? "absent" : "partial";
  const planSha256 = await fileSha256(planPath);
  const status = {
    schemaVersion: "1.0",
    storyId: plan.storyId,
    runId: plan.runId,
    wave: plan.wave,
    wavePlanSha256: planSha256,
    taskDagSha256: plan.taskDagSha256,
    state,
    baseRef: plan.baseRef,
    baseCommit: plan.baseCommit,
    tasks,
    observedAt: (options.now ?? (() => new Date().toISOString()))(),
    details: [],
  };
  validateWaveStatusStructure(status, plan, planSha256);
  const stored = await readJsonOptional(statusPath, "Wave Worktree status");
  if (stored) {
    validateWaveStatusStructure(stored, plan, planSha256);
    if (JSON.stringify(comparableWaveStatus(stored)) === JSON.stringify(comparableWaveStatus(status))) {
      return stored;
    }
  }
  if (options.beforeWaveStatusWrite) await options.beforeWaveStatusWrite(status);
  if (!persist) return status;
  if (beforeWrite) await beforeWrite();
  await writeAtomicJson(statusPath, status);
  return status;
}

async function loadBatchContext(root, options) {
  assertBatchCommandInputs(options);
  await assertRepositoryRoot(root, options);
  const { inspectBatchWorktreePlan } = await import("./batch-runtime.mjs");
  const batch = await inspectBatchWorktreePlan({
    root,
    stateFile: options.stateFile,
    allowReadyTransitionLock: options.allowReadyTransitionLock === true,
    allowIntegrationTaskId: options.allowIntegrationTaskId,
    allowMissingIntegrationReceipt: options.allowMissingIntegrationReceipt,
  });
  const plan = validateBatchPlanStructure(batch.plan, batch);
  const outputs = batchOutputPaths(root, batch.planFile);
  if (outputs.planFile !== batch.ledger.batchPlanFile) {
    throw new Error("Serial batch Worktree evidence paths are invalid.");
  }
  await assertSafeTargetParents(root, outputs.planPath);
  await assertSafeTargetParents(root, outputs.statusPath);
  await assertSafeTargetParents(root, outputs.lockPath);
  if (await fileSha256(outputs.planPath) !== batch.planSha256) {
    throw new Error("Serial batch Worktree plan changed while loading its evidence.");
  }
  return {
    state: { storyId: plan.storyId, runtime: { runId: plan.runId } },
    stateFile: batch.stateFile,
    batchFile: batch.batchFile,
    ledger: batch.ledger,
    plan,
    planSha256: batch.planSha256,
    ...outputs,
  };
}

async function loadRetirementContext(root, options) {
  await assertRepositoryRoot(root, options);
  const stateLocation = resolveInsideRoot(root, options.stateFile, "State file");
  await assertSafeTargetParents(root, stateLocation.fullPath);
  const state = await readJsonFile(stateLocation.fullPath, "State file");
  validateRetirementState(state);
  assertIdentifier(options.taskId, "Task ID");
  const outputs = outputPaths(root, state, options.taskId);
  const retirement = retirementPaths(root, state, options.taskId);
  await assertSafeTargetParents(root, outputs.planPath);
  await assertSafeTargetParents(root, retirement.receiptPath);
  return { state, stateFile: stateLocation.relative, ...outputs, ...retirement };
}

async function acquireLock(lockPath, options) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Worktree create lock already exists; inspect it before retrying.");
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: (options.now ?? (() => new Date().toISOString()))() })}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    throw error;
  }
}

async function assertLocksAbsent(lockPaths) {
  for (const lockPath of lockPaths) {
    const info = await lstat(lockPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info) throw new Error(`Worktree lifecycle lock already exists: ${normalizePath(lockPath)}`);
  }
}

async function assertRetirementLockAbsent(lockPath) {
  const info = await lstat(lockPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (info) throw new Error(`Worktree retirement lock already exists: ${normalizePath(lockPath)}`);
}

async function readRegularBuffer(filePath, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} not found: ${normalizePath(filePath)}`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  const buffer = await readFile(filePath);
  return { buffer, sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`, bytes: buffer.length };
}

function assertReceiptIdentity(receipt, state, plan, label) {
  if (!receipt || receipt.schemaVersion !== "1.0" || receipt.storyId !== state.storyId
      || receipt.runId !== state.runtime.runId || receipt.taskId !== plan.taskId
      || receipt.baseCommit !== plan.baseCommit || typeof receipt.dispatchId !== "string"
      || typeof receipt.phase !== "string" || typeof receipt.ownerAgent !== "string") {
    throw new Error(`${label} does not match the completed Story and Worktree plan.`);
  }
}

function parsePorcelainPaths(source) {
  const entries = [];
  const tokens = source.split("\0").filter(Boolean);
  for (const token of tokens) {
    if (token.length < 4) throw new Error("Worktree Git status contains an invalid record.");
    const status = token.slice(0, 2);
    const relative = normalizePath(token.slice(3));
    if (!relative || status.includes("R") || status.includes("C") || status.includes("D")) {
      throw new Error("Worktree contains a rename, copy, deletion, or invalid path.");
    }
    entries.push({ status, relative });
  }
  return entries;
}

async function validateRetirementEvidence(root, context, plan, verifyWorktree = true) {
  const historicalStatus = await readJsonFile(context.statusPath, "M5-A Worktree status");
  if (historicalStatus.state !== "created" || historicalStatus.storyId !== context.state.storyId
      || historicalStatus.runId !== context.state.runtime.runId || historicalStatus.taskId !== plan.taskId
      || historicalStatus.planSha256 !== await fileSha256(context.planPath)) {
    throw new Error("M5-A historical Worktree status does not prove a created Worktree.");
  }

  const directory = `.harness/runs/${context.state.runtime.runId}/worktrees/${plan.taskId}`;
  const manifestFile = `${directory}/input-manifest.json`;
  const executionReceiptFile = `${directory}/execution-receipt.json`;
  const integrationPlanFile = `${directory}/integration/plan.json`;
  const integrationReceiptFile = `${directory}/integration/integration-receipt.json`;
  const manifest = await readJsonFile(resolveInsideRoot(root, manifestFile, "M5-B1 input manifest").fullPath, "M5-B1 input manifest");
  const executionReceipt = await readJsonFile(resolveInsideRoot(root, executionReceiptFile, "M5-B1 execution receipt").fullPath, "M5-B1 execution receipt");
  const integrationPlan = await readJsonFile(resolveInsideRoot(root, integrationPlanFile, "M5-B2 integration plan").fullPath, "M5-B2 integration plan");
  const integrationReceipt = await readJsonFile(resolveInsideRoot(root, integrationReceiptFile, "M5-B2 integration receipt").fullPath, "M5-B2 integration receipt");

  assertReceiptIdentity(executionReceipt, context.state, plan, "M5-B1 execution receipt");
  if (executionReceipt.outcome !== "ready-for-integration" || !Array.isArray(executionReceipt.files)
      || executionReceipt.planSha256 !== await fileSha256(context.planPath)
      || executionReceipt.inputManifestSha256 !== await fileSha256(resolveInsideRoot(root, manifestFile, "M5-B1 input manifest").fullPath)) {
    throw new Error("M5-B1 execution receipt evidence does not match the Worktree plan.");
  }
  if (!manifest || manifest.schemaVersion !== "1.0" || manifest.storyId !== context.state.storyId
      || manifest.runId !== context.state.runtime.runId || manifest.taskId !== plan.taskId
      || manifest.baseCommit !== plan.baseCommit || manifest.worktreePath !== plan.worktreePath
      || !Array.isArray(manifest.inputs)) {
    throw new Error("M5-B1 input manifest does not match the Worktree plan.");
  }
  if (typeof executionReceipt.resultEvidenceFile !== "string" || typeof executionReceipt.resultSha256 !== "string") {
    throw new Error("M5-B1 execution receipt is missing Worker result evidence.");
  }
  const workerResult = await readRegularBuffer(
    resolveInsideRoot(root, executionReceipt.resultEvidenceFile, "M5-B1 Worker result evidence").fullPath,
    "M5-B1 Worker result evidence",
  );
  if (workerResult.sha256 !== executionReceipt.resultSha256) {
    throw new Error("Worker result evidence hash drifted from the M5-B1 receipt.");
  }
  assertReceiptIdentity(integrationPlan, context.state, plan, "M5-B2 integration plan");
  assertReceiptIdentity(integrationReceipt, context.state, plan, "M5-B2 integration receipt");
  if (integrationPlan.executionReceiptFile !== executionReceiptFile
      || integrationPlan.executionReceiptSha256 !== await fileSha256(resolveInsideRoot(root, executionReceiptFile, "M5-B1 execution receipt").fullPath)
      || !Array.isArray(integrationReceipt.appliedFiles) || integrationReceipt.resultFile !== `${path.posix.dirname(manifest.inputs[0]?.targetPath ?? "")}/result.json`
      || integrationReceipt.planSha256 !== await fileSha256(resolveInsideRoot(root, integrationPlanFile, "M5-B2 integration plan").fullPath)) {
    throw new Error("M5-B2 integration receipt does not match the collected Worker result.");
  }
  const expectedCandidates = new Map();
  for (const file of executionReceipt.files) {
    if (!file || typeof file.path !== "string" || typeof file.kind !== "string"
        || typeof file.sha256 !== "string" || !Number.isInteger(file.bytes)) {
      throw new Error("M5-B1 execution receipt contains an invalid file entry.");
    }
    const key = pathKey(file.path);
    if (expectedCandidates.has(key)) throw new Error(`M5-B1 execution receipt contains a duplicate candidate: ${file.path}`);
    expectedCandidates.set(key, file);
  }
  if (integrationReceipt.appliedFiles.length !== expectedCandidates.size) {
    throw new Error("M5-B2 integration receipt does not cover every Worker candidate.");
  }
  const integratedCandidates = new Set();
  for (const file of integrationReceipt.appliedFiles) {
    const expected = file && typeof file.path === "string" ? expectedCandidates.get(pathKey(file.path)) : null;
    if (!expected || integratedCandidates.has(pathKey(file.path))
        || file.kind !== expected.kind || file.sha256 !== expected.sha256 || file.bytes !== expected.bytes) {
      throw new Error("M5-B2 integration receipt candidate mapping does not match the Worker receipt.");
    }
    integratedCandidates.add(pathKey(file.path));
  }

  if (verifyWorktree) {
    const worktreeRoot = resolveInsideRoot(root, plan.worktreePath, "Worktree path").fullPath;
    for (const input of manifest.inputs) {
      if (!input || input.source !== "main-run" || typeof input.targetPath !== "string" || typeof input.sha256 !== "string") continue;
      const current = await readRegularBuffer(resolveInsideRoot(worktreeRoot, input.targetPath, "Worktree main-run input").fullPath, "Worktree main-run input");
      if (current.sha256 !== input.sha256 || current.bytes !== input.bytes) {
        throw new Error(`Worktree main-run input hash drifted: ${input.targetPath}`);
      }
    }
    for (const file of executionReceipt.files) {
      if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string") {
        throw new Error("M5-B1 execution receipt contains an invalid file entry.");
      }
      const current = await readRegularBuffer(resolveInsideRoot(worktreeRoot, file.path, "Worktree candidate").fullPath, "Worktree candidate");
      if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
        throw new Error(`Worktree candidate hash drifted: ${file.path}`);
      }
    }
    const worktreeResult = await readRegularBuffer(resolveInsideRoot(worktreeRoot, integrationReceipt.resultFile, "Worktree result").fullPath, "Worktree result");
    if (worktreeResult.sha256 !== executionReceipt.resultSha256) throw new Error("Worktree result hash drifted from the M5-B1 receipt.");
  }

  for (const file of integrationReceipt.appliedFiles) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string") {
      throw new Error("M5-B2 integration receipt contains an invalid file entry.");
    }
    const current = await readRegularBuffer(resolveInsideRoot(root, file.path, "Integrated candidate").fullPath, "Integrated candidate");
    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
      throw new Error(`Integrated candidate hash drifted: ${file.path}`);
    }
  }
  const result = await readRegularBuffer(resolveInsideRoot(root, integrationReceipt.resultFile, "Integrated result").fullPath, "Integrated result");
  if (result.sha256 !== integrationReceipt.resultSha256) throw new Error("Integrated result hash drifted from the M5-B2 receipt.");

  const allowed = new Set([
    ...manifest.inputs.filter((input) => input?.source === "main-run").map((input) => pathKey(input.targetPath)),
    ...executionReceipt.files.map((file) => pathKey(file.path)),
    pathKey(integrationReceipt.resultFile),
  ]);
  if (verifyWorktree) {
    const worktreeRoot = resolveInsideRoot(root, plan.worktreePath, "Worktree path").fullPath;
    const status = await executeGit(worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {});
    for (const entry of parsePorcelainPaths(String(status.stdout ?? ""))) {
      if (!allowed.has(pathKey(entry.relative))) throw new Error(`Worktree contains an unexplained change: ${entry.relative}`);
    }
    const ignored = await executeGit(worktreeRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {});
    for (const relative of String(ignored.stdout ?? "").split("\0").filter(Boolean).map(normalizePath)) {
      if (!allowed.has(pathKey(relative))) throw new Error(`Worktree contains an unexplained ignored file: ${relative}`);
    }
  }
  return {
    executionReceiptFile,
    integrationPlanFile,
    integrationReceiptFile,
    resultFile: integrationReceipt.resultFile,
    resultSha256: result.sha256,
  };
}

async function inspectRetirementWorktree(root, plan, options) {
  const list = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const targetPath = resolveInsideRoot(root, plan.worktreePath, "Worktree path").fullPath;
  const worktree = parseWorktreeList(String(list.stdout ?? "")).find((item) => pathKey(item.worktree ?? "") === pathKey(targetPath));
  const branch = await inspectGitRef(root, `refs/heads/${plan.branch}`, options);
  const branchCommit = branch.commit;
  const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!branchCommit || branchCommit !== plan.baseCommit) throw new Error("Worktree branch no longer points to the planned base commit.");
  if (!worktree) {
    if (pathInfo) throw new Error("Worktree path is occupied but not registered by Git.");
    return { state: "absent", targetPath };
  }
  const targetIssue = invalidRegisteredWorktreeDetail(worktree, pathInfo, "Worktree path");
  if (targetIssue) throw new Error(targetIssue);
  await assertSafeTargetParents(root, targetPath);
  if (worktree.branch !== `refs/heads/${plan.branch}` || worktree.HEAD !== plan.baseCommit) {
    throw new Error("Worktree branch or HEAD drifted from the retirement plan.");
  }
  return { state: "created", targetPath };
}

function validateRetirementReceipt(receipt, context, plan, evidence) {
  const fields = receipt && typeof receipt === "object" && !Array.isArray(receipt) ? Object.keys(receipt) : [];
  if (!receipt || fields.length !== RETIREMENT_RECEIPT_FIELDS.length || RETIREMENT_RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))
      || receipt.schemaVersion !== "1.0" || receipt.storyId !== context.state.storyId
      || receipt.runId !== context.state.runtime.runId || receipt.taskId !== plan.taskId
      || receipt.branch !== plan.branch || receipt.worktreePath !== plan.worktreePath
      || receipt.baseCommit !== plan.baseCommit || receipt.planSha256 !== evidence.planSha256
      || receipt.statusSha256 !== evidence.statusSha256 || receipt.executionReceiptSha256 !== evidence.executionReceiptSha256
      || receipt.integrationPlanSha256 !== evidence.integrationPlanSha256
      || receipt.integrationReceiptSha256 !== evidence.integrationReceiptSha256
      || receipt.resultFile !== evidence.resultFile || receipt.resultSha256 !== evidence.resultSha256
      || typeof receipt.retiredAt !== "string" || typeof receipt.recovered !== "boolean") {
    throw new Error("Existing retirement receipt does not match the completed Worktree evidence.");
  }
}

async function buildRetirementEvidence(root, evidenceFiles) {
  return {
    planSha256: await fileSha256(evidenceFiles.planPath),
    statusSha256: await fileSha256(evidenceFiles.statusPath),
    executionReceiptSha256: await fileSha256(resolveInsideRoot(root, evidenceFiles.executionReceiptFile, "M5-B1 execution receipt").fullPath),
    integrationPlanSha256: await fileSha256(resolveInsideRoot(root, evidenceFiles.integrationPlanFile, "M5-B2 integration plan").fullPath),
    integrationReceiptSha256: await fileSha256(resolveInsideRoot(root, evidenceFiles.integrationReceiptFile, "M5-B2 integration receipt").fullPath),
    resultFile: evidenceFiles.resultFile,
    resultSha256: evidenceFiles.resultSha256,
  };
}

async function readBatchRetirementBuffer(root, relativeFile, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await assertSafeTargetParents(root, location.fullPath);
  return { ...location, ...await readRegularBuffer(location.fullPath, label) };
}

async function readBatchRetirementJson(root, relativeFile, label) {
  const evidence = await readBatchRetirementBuffer(root, relativeFile, label);
  try {
    return { ...evidence, value: JSON.parse(evidence.buffer.toString("utf8")) };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

function assertBatchFinalizationBinding(binding) {
  const fields = binding && typeof binding === "object" && !Array.isArray(binding) ? Object.keys(binding) : [];
  if (!binding || fields.length !== BATCH_FINALIZATION_FIELDS.length
      || BATCH_FINALIZATION_FIELDS.some((field) => !Object.hasOwn(binding, field))
      || binding.schemaVersion !== "1.0" || binding.phase !== "implementation"
      || typeof binding.storyId !== "string" || typeof binding.runId !== "string" || typeof binding.stateFile !== "string"
      || typeof binding.batchId !== "string" || typeof binding.ledgerFile !== "string" || typeof binding.receiptFile !== "string"
      || !Number.isInteger(binding.preparedRevision) || binding.preparedRevision < 1
      || !/^sha256:[a-f0-9]{64}$/.test(binding.ledgerSha256) || !/^sha256:[a-f0-9]{64}$/.test(binding.receiptSha256)
      || !/^sha256:[a-f0-9]{64}$/.test(binding.taskSha256) || !/^sha256:[a-f0-9]{64}$/.test(binding.resultSha256)
      || !/^sha256:[a-f0-9]{64}$/.test(binding.notesSha256)) {
    throw new Error("Implementation checkpoint batch binding is invalid.");
  }
  return binding;
}

function implementationArtifactPaths(state) {
  const directory = `.harness/runs/${state.runtime.runId}/phases/03-implementation`;
  return {
    taskFile: `${directory}/task.json`,
    resultFile: `${directory}/result.json`,
    checkpointFile: `${directory}/checkpoint.json`,
    notesFile: `${directory}/implementation-notes.md`,
  };
}

function assertBatchImplementationArtifacts(state, stateFile, task, result, checkpoint) {
  if (task.schemaVersion !== "1.0" || task.storyId !== state.storyId || task.phase !== "implementation"
      || typeof task.dispatchId !== "string" || !Number.isInteger(task.preparedRevision) || task.preparedRevision < 1) {
    throw new Error("Implementation task does not match the completed Story.");
  }
  if (result.schemaVersion !== "1.0" || result.dispatchId !== task.dispatchId || result.storyId !== task.storyId
      || result.phase !== task.phase || result.status !== "completed") {
    throw new Error("Implementation result does not match the completed Story task.");
  }
  if (checkpoint.schemaVersion !== "1.0" || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId || checkpoint.phase !== task.phase) {
    throw new Error("Implementation checkpoint does not match the completed Story task.");
  }
  const binding = assertBatchFinalizationBinding(checkpoint.batchFinalization);
  if (binding.storyId !== state.storyId || binding.runId !== state.runtime.runId || binding.stateFile !== stateFile
      || binding.preparedRevision !== task.preparedRevision) {
    throw new Error("Implementation checkpoint batch binding does not match the completed Story.");
  }
  return binding;
}

async function loadBatchRetirementContext(root, options) {
  assertBatchCommandInputs(options);
  await assertRepositoryRoot(root, options);
  const stateLocation = resolveInsideRoot(root, options.stateFile, "State file");
  await assertSafeTargetParents(root, stateLocation.fullPath);
  const stateEvidence = await readBatchRetirementJson(root, stateLocation.relative, "State file");
  const state = stateEvidence.value;
  validateRetirementState(state);
  const stateEventsFile = stateLocation.relative.replace(/\.json$/, ".events.jsonl");
  if (stateEventsFile === stateLocation.relative) throw new Error("Completed Story state file must use the .json suffix.");
  const stateEventsEvidence = await readBatchRetirementBuffer(root, stateEventsFile, "State event log");
  const stateBackupFile = stateLocation.relative.replace(/\.json$/, ".json.bak");
  const stateBackupEvidence = await readBatchRetirementBuffer(root, stateBackupFile, "State recovery backup");

  const implementation = implementationArtifactPaths(state);
  const taskEvidence = await readBatchRetirementJson(root, implementation.taskFile, "Implementation task");
  const resultEvidence = await readBatchRetirementJson(root, implementation.resultFile, "Implementation result");
  const checkpointEvidence = await readBatchRetirementJson(root, implementation.checkpointFile, "Implementation checkpoint");
  const notesEvidence = await readBatchRetirementBuffer(root, implementation.notesFile, "Implementation notes");
  const binding = assertBatchImplementationArtifacts(
    state,
    stateLocation.relative,
    taskEvidence.value,
    resultEvidence.value,
    checkpointEvidence.value,
  );
  if (binding.taskSha256 !== taskEvidence.sha256 || binding.resultSha256 !== resultEvidence.sha256
      || binding.notesSha256 !== notesEvidence.sha256) {
    throw new Error("Implementation artifacts no longer match the finalized batch binding.");
  }

  const { inspectFinalizedSerialBatchForRecovery } = await import("./batch-runtime.mjs");
  const batch = await inspectFinalizedSerialBatchForRecovery({
    root,
    stateFile: stateLocation.relative,
    state,
    preparedRevision: binding.preparedRevision,
    batchFile: binding.ledgerFile,
  });
  if (batch.batchFile !== binding.ledgerFile || batch.ledgerSha256 !== binding.ledgerSha256
      || batch.ledger.batchReceiptFile !== binding.receiptFile || batch.receiptSha256 !== binding.receiptSha256
      || batch.ledger.storyId !== state.storyId || batch.ledger.runId !== state.runtime.runId
      || batch.ledger.status !== "finalized" || batch.ledger.tasks.some((task) => task.status !== "integrated")) {
    throw new Error("Finalized serial batch no longer matches the implementation checkpoint binding.");
  }
  const planEvidence = await readBatchRetirementJson(root, batch.ledger.batchPlanFile, "Serial batch Worktree plan");
  if (planEvidence.sha256 !== batch.ledger.batchPlanSha256) {
    throw new Error("Serial batch Worktree plan hash drifted from the finalized ledger.");
  }
  const plan = validateBatchPlanStructure(planEvidence.value, batch);
  const paths = batchRetirementPaths(root, batch.ledger.batchPlanFile);
  await assertSafeTargetParents(root, paths.statusPath);
  await assertSafeTargetParents(root, paths.retirementReceiptPath);
  await assertSafeTargetParents(root, paths.retirementLockPath);
  const statusEvidence = await readBatchRetirementJson(root, paths.statusFile, "Serial batch historical Worktree status");
  validateBatchStatusStructure(statusEvidence.value, plan, planEvidence.sha256);
  if (statusEvidence.value.state !== "created") {
    throw new Error("Serial batch historical Worktree status does not prove a created Worktree.");
  }

  return {
    state,
    stateFile: stateLocation.relative,
    stateEvidence,
    stateEventsEvidence,
    stateBackupEvidence,
    binding,
    batch,
    plan,
    planEvidence,
    statusEvidence,
    implementation: { task: taskEvidence, result: resultEvidence, checkpoint: checkpointEvidence, notes: notesEvidence },
    ...paths,
  };
}

function assertBatchAppliedFile(file, label) {
  if (!file || typeof file !== "object" || typeof file.path !== "string" || typeof file.kind !== "string"
      || !/^sha256:[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0
      || !["backend", "frontend", "phase-output"].includes(file.kind)) {
    throw new Error(`${label} contains an invalid applied file.`);
  }
  return file;
}

function validateBatchInputManifest(root, manifest, ledger, task) {
  const fields = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? Object.keys(manifest) : [];
  if (!manifest || fields.length !== BATCH_INPUT_MANIFEST_FIELDS.length
      || BATCH_INPUT_MANIFEST_FIELDS.some((field) => !Object.hasOwn(manifest, field))
      || manifest.schemaVersion !== "1.0" || manifest.storyId !== ledger.storyId || manifest.runId !== ledger.runId
      || manifest.phase !== ledger.phase || manifest.batchId !== ledger.batchId || manifest.taskId !== task.taskId
      || manifest.dispatchId !== task.dispatchId || manifest.taskRoot !== task.taskRoot || manifest.baseCommit !== ledger.baseCommit
      || manifest.inheritedSnapshotSha256 !== task.inheritedSnapshotSha256 || !Array.isArray(manifest.inheritedFiles)
      || !Array.isArray(manifest.inputs) || typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error(`Serial batch task '${task.taskId}' input manifest does not match the finalized ledger.`);
  }
  const inputs = [];
  const seen = new Set();
  for (const input of manifest.inputs) {
    const inputFields = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
    if (!input || inputFields.length !== BATCH_INPUT_MANIFEST_ENTRY_FIELDS.length
        || BATCH_INPUT_MANIFEST_ENTRY_FIELDS.some((field) => !Object.hasOwn(input, field))
        || !["main-run", "worktree-base"].includes(input.source)
        || typeof input.sourcePath !== "string" || typeof input.targetPath !== "string"
        || !/^sha256:[a-f0-9]{64}$/.test(input.sha256) || !Number.isInteger(input.bytes) || input.bytes < 0) {
      throw new Error(`Serial batch task '${task.taskId}' input manifest contains an invalid input.`);
    }
    const source = resolveInsideRoot(root, input.sourcePath, "Serial batch Worker input source");
    const target = resolveInsideRoot(root, input.targetPath, "Serial batch Worker input target");
    if (source.relative !== input.sourcePath || target.relative !== input.targetPath || source.relative !== target.relative
        || seen.has(pathKey(target.relative))) {
      throw new Error(`Serial batch task '${task.taskId}' input manifest contains an invalid input.`);
    }
    seen.add(pathKey(target.relative));
    inputs.push(input);
  }
  return inputs;
}

async function collectBatchRetirementEvidence(root, context) {
  const allowed = new Map();
  const worktreeAllowed = new Map();
  const worktreeMainRunInputs = new Map();
  const latestApplied = new Map();
  const addAllowed = (relativeFile, evidence) => {
    const key = pathKey(relativeFile);
    const existing = allowed.get(key);
    if (existing && (existing.sha256 !== evidence.sha256 || existing.bytes !== evidence.bytes)) {
      throw new Error(`Serial batch retirement evidence conflicts for ${relativeFile}.`);
    }
    allowed.set(key, { path: relativeFile, sha256: evidence.sha256, bytes: evidence.bytes });
  };
  const addWorktreeAllowed = (relativeFile, evidence) => {
    const key = pathKey(relativeFile);
    const existing = worktreeAllowed.get(key);
    if (existing && (existing.sha256 !== evidence.sha256 || existing.bytes !== evidence.bytes)) {
      throw new Error(`Serial batch Worktree retirement evidence conflicts for ${relativeFile}.`);
    }
    worktreeAllowed.set(key, { path: relativeFile, sha256: evidence.sha256, bytes: evidence.bytes });
  };
  const addWorktreeMainRunInput = (relativeFile, evidence) => {
    const key = pathKey(relativeFile);
    const existing = worktreeMainRunInputs.get(key);
    if (existing && (existing.sha256 !== evidence.sha256 || existing.bytes !== evidence.bytes)) {
      throw new Error(`Serial batch Worktree main-run input evidence conflicts for ${relativeFile}.`);
    }
    worktreeMainRunInputs.set(key, { path: relativeFile, sha256: evidence.sha256, bytes: evidence.bytes });
  };
  const addLatest = (file) => latestApplied.set(pathKey(file.path), { ...file });

  addAllowed(context.stateFile, context.stateEvidence);
  addAllowed(context.stateEventsEvidence.relative, context.stateEventsEvidence);
  addAllowed(context.stateBackupEvidence.relative, context.stateBackupEvidence);
  addAllowed(context.planEvidence.relative, context.planEvidence);
  addAllowed(context.statusEvidence.relative, context.statusEvidence);
  addAllowed(context.batch.batchFile, { sha256: context.batch.ledgerSha256, bytes: (await readBatchRetirementBuffer(root, context.batch.batchFile, "Serial batch ledger")).bytes });
  addAllowed(context.batch.ledger.batchReceiptFile, { sha256: context.batch.receiptSha256, bytes: (await readBatchRetirementBuffer(root, context.batch.ledger.batchReceiptFile, "Serial batch receipt")).bytes });
  addAllowed(context.implementation.task.relative, context.implementation.task);
  addAllowed(context.implementation.result.relative, context.implementation.result);
  addAllowed(context.implementation.checkpoint.relative, context.implementation.checkpoint);
  addAllowed(context.implementation.notes.relative, context.implementation.notes);

  const tasks = [];
  for (const task of context.batch.ledger.tasks) {
    const taskFile = await readBatchRetirementBuffer(root, task.taskFile, `Serial batch task '${task.taskId}' dispatch`);
    const resultFile = await readBatchRetirementBuffer(root, task.resultFile, `Serial batch task '${task.taskId}' result`);
    const checkpointFile = await readBatchRetirementBuffer(root, task.checkpointFile, `Serial batch task '${task.taskId}' checkpoint`);
    const reportFile = await readBatchRetirementBuffer(root, task.reportFile, `Serial batch task '${task.taskId}' report`);
    const inheritedFile = await readBatchRetirementBuffer(root, task.inheritedSnapshotFile, `Serial batch task '${task.taskId}' inherited snapshot`);
    const execution = await readBatchRetirementJson(root, task.executionReceiptFile, `Serial batch task '${task.taskId}' execution receipt`);
    const integration = await readBatchRetirementJson(root, task.integrationReceiptFile, `Serial batch task '${task.taskId}' integration receipt`);
    const inputManifestFile = `${path.posix.dirname(task.executionReceiptFile)}/task-start-manifest.json`;
    const inputManifest = await readBatchRetirementJson(root, inputManifestFile, `Serial batch task '${task.taskId}' input manifest`);
    const integrationPlanFile = `${path.posix.dirname(task.integrationReceiptFile)}/integration-plan.json`;
    const integrationPlan = await readBatchRetirementBuffer(root, integrationPlanFile, `Serial batch task '${task.taskId}' integration plan`);
    if (execution.sha256 !== task.executionReceiptSha256 || integration.sha256 !== task.integrationReceiptSha256
        || execution.value?.inputManifestSha256 !== inputManifest.sha256
        || integration.value.planSha256 !== integrationPlan.sha256 || integration.value.resultFile !== task.resultFile) {
      throw new Error(`Serial batch task '${task.taskId}' receipt evidence drifted from the finalized ledger.`);
    }
    for (const input of validateBatchInputManifest(root, inputManifest.value, context.batch.ledger, task)) {
      if (input.source !== "main-run") continue;
      const current = await readBatchRetirementBuffer(root, input.sourcePath, `Serial batch task '${task.taskId}' main-run input`);
      if (current.sha256 !== input.sha256 || current.bytes !== input.bytes) {
        throw new Error(`Serial batch task '${task.taskId}' main-run input hash drifted: ${input.sourcePath}`);
      }
      addAllowed(input.sourcePath, current);
      addWorktreeAllowed(input.targetPath, current);
      addWorktreeMainRunInput(input.targetPath, current);
    }
    for (const file of integration.value.appliedFiles ?? []) addLatest(assertBatchAppliedFile(file, `Serial batch task '${task.taskId}' integration receipt`));
    addAllowed(task.taskFile, taskFile);
    addAllowed(task.resultFile, resultFile);
    addAllowed(task.checkpointFile, checkpointFile);
    addAllowed(task.reportFile, reportFile);
    addAllowed(task.inheritedSnapshotFile, inheritedFile);
    addAllowed(task.executionReceiptFile, execution);
    addAllowed(task.integrationReceiptFile, integration);
    addAllowed(integrationPlanFile, integrationPlan);
    addWorktreeAllowed(task.taskFile, taskFile);
    addWorktreeAllowed(task.resultFile, resultFile);
    addWorktreeAllowed(task.checkpointFile, checkpointFile);
    tasks.push({
      taskId: task.taskId,
      executionReceiptFile: task.executionReceiptFile,
      executionReceiptSha256: execution.sha256,
      integrationReceiptFile: task.integrationReceiptFile,
      integrationReceiptSha256: integration.sha256,
    });
  }
  for (const file of latestApplied.values()) {
    const current = await readBatchRetirementBuffer(root, file.path, "Latest integrated batch target");
    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
      throw new Error(`Latest integrated batch target hash drifted: ${file.path}`);
    }
    addAllowed(file.path, current);
    addWorktreeAllowed(file.path, current);
  }
  return {
    stateFile: context.stateFile,
    stateSha256: context.stateEvidence.sha256,
    stateEventsFile: context.stateEventsEvidence.relative,
    stateEventsSha256: context.stateEventsEvidence.sha256,
    stateBackupFile: context.stateBackupEvidence.relative,
    stateBackupSha256: context.stateBackupEvidence.sha256,
    batchPlanFile: context.planEvidence.relative,
    batchPlanSha256: context.planEvidence.sha256,
    worktreeStatusFile: context.statusEvidence.relative,
    worktreeStatusSha256: context.statusEvidence.sha256,
    ledgerFile: context.batch.batchFile,
    ledgerSha256: context.batch.ledgerSha256,
    batchReceiptFile: context.batch.ledger.batchReceiptFile,
    batchReceiptSha256: context.batch.receiptSha256,
    implementationTaskFile: context.implementation.task.relative,
    implementationTaskSha256: context.implementation.task.sha256,
    implementationResultFile: context.implementation.result.relative,
    implementationResultSha256: context.implementation.result.sha256,
    implementationCheckpointFile: context.implementation.checkpoint.relative,
    implementationCheckpointSha256: context.implementation.checkpoint.sha256,
    tasks,
    appliedFiles: [...latestApplied.values()].sort((left, right) => pathKey(left.path).localeCompare(pathKey(right.path))),
    allowed,
    worktreeAllowed,
    worktreeMainRunInputs,
    latestApplied,
  };
}

async function assertBatchMainRepositoryIntegrity(root, context, evidence, options, allowRetirementLock = false) {
  const status = await executeGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], options);
  const worktreePath = pathKey(context.plan.worktreePath);
  const retirementLock = pathKey(context.retirementLockFile);
  for (const entry of parsePorcelainPaths(String(status.stdout ?? ""))) {
    const relative = entry.relative.replace(/\/+$/, "");
    const key = pathKey(relative);
    if (entry.status === "!!" && worktreePath.startsWith(`${key}/`)) continue;
    if (allowRetirementLock && key === retirementLock) continue;
    const expected = evidence.allowed.get(key);
    if (!expected) throw new Error(`Main repository contains an unexplained batch change: ${entry.relative}`);
    const current = await readBatchRetirementBuffer(root, relative, "Batch retirement main repository target");
    if (current.sha256 !== expected.sha256 || current.bytes !== expected.bytes) {
      throw new Error(`Batch retirement main repository evidence hash drifted: ${relative}`);
    }
  }
}

async function assertBatchWorktreeIntegrity(root, context, evidence, options) {
  const worktreeRoot = resolveInsideRoot(root, context.plan.worktreePath, "Serial batch Worktree path").fullPath;
  await assertSafeTargetParents(root, worktreeRoot);
  for (const expected of evidence.worktreeMainRunInputs.values()) {
    const current = await readBatchRetirementBuffer(worktreeRoot, expected.path, "Serial batch Worktree input");
    if (current.sha256 !== expected.sha256 || current.bytes !== expected.bytes) {
      throw new Error(`Serial batch Worktree input hash drifted: ${expected.path}`);
    }
  }
  const status = await executeGit(worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], options);
  for (const entry of parsePorcelainPaths(String(status.stdout ?? ""))) {
    const expected = evidence.worktreeAllowed.get(pathKey(entry.relative));
    if (!expected) {
      throw new Error(`Serial batch Worktree contains an unexplained change: ${entry.relative}`);
    }
    const current = await readBatchRetirementBuffer(worktreeRoot, entry.relative, "Serial batch Worktree candidate");
    if (current.sha256 !== expected.sha256 || current.bytes !== expected.bytes) {
      throw new Error(`Serial batch Worktree candidate hash drifted: ${entry.relative}`);
    }
  }
}

async function inspectBatchRetirementWorktree(root, context, options) {
  const list = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const targetPath = resolveInsideRoot(root, context.plan.worktreePath, "Serial batch Worktree path").fullPath;
  const worktree = parseWorktreeList(String(list.stdout ?? "")).find((item) => pathKey(item.worktree ?? "") === pathKey(targetPath));
  const branch = await inspectGitRef(root, `refs/heads/${context.plan.branch}`, options);
  const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!branch.exists || branch.commit !== context.plan.baseCommit) {
    throw new Error("Serial batch Worktree branch no longer points to the planned base commit.");
  }
  if (!worktree) {
    if (pathInfo) throw new Error("Serial batch Worktree path is occupied but not registered by Git.");
    return { state: "absent", targetPath };
  }
  const issue = invalidRegisteredWorktreeDetail(worktree, pathInfo, "Serial batch Worktree path");
  if (issue) throw new Error(issue);
  await assertSafeTargetParents(root, targetPath);
  if (worktree.branch !== `refs/heads/${context.plan.branch}` || worktree.HEAD !== context.plan.baseCommit) {
    throw new Error("Serial batch Worktree branch or HEAD drifted from the retirement plan.");
  }
  return { state: "created", targetPath };
}

async function batchRetirementConflictingLocks(root, context) {
  const relativeLocks = [
    context.batch.ledger.lockFile,
    `.harness/runs/${context.state.runtime.runId}/phases/03-implementation/batch-finalization.lock`,
    context.lockFile,
    ...context.batch.ledger.tasks.flatMap((task) => [
      `${path.posix.dirname(task.executionReceiptFile)}/execute.lock`,
      `${path.posix.dirname(task.integrationReceiptFile)}/integrate.lock`,
    ]),
  ];
  const locks = [];
  for (const relative of new Set(relativeLocks)) {
    const location = resolveInsideRoot(root, relative, "Serial batch lifecycle lock");
    await assertSafeTargetParents(root, location.fullPath);
    locks.push(location.fullPath);
  }
  return locks;
}

function validateBatchRetirementReceipt(receipt, context, evidence) {
  const fields = receipt && typeof receipt === "object" && !Array.isArray(receipt) ? Object.keys(receipt) : [];
  if (!receipt || fields.length !== BATCH_RETIREMENT_RECEIPT_FIELDS.length
      || BATCH_RETIREMENT_RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))
      || receipt.schemaVersion !== "1.0" || receipt.storyId !== context.state.storyId
      || receipt.runId !== context.state.runtime.runId || receipt.batchId !== context.batch.ledger.batchId
      || receipt.branch !== context.plan.branch || receipt.worktreePath !== context.plan.worktreePath
      || receipt.baseCommit !== context.plan.baseCommit || typeof receipt.retiredAt !== "string"
      || Number.isNaN(Date.parse(receipt.retiredAt)) || typeof receipt.recovered !== "boolean"
      || JSON.stringify(receipt.tasks) !== JSON.stringify(evidence.tasks)
      || JSON.stringify(receipt.appliedFiles) !== JSON.stringify(evidence.appliedFiles)) {
    throw new Error("Existing serial batch retirement receipt does not match the completed batch evidence.");
  }
  for (const field of BATCH_RETIREMENT_RECEIPT_FIELDS) {
    if (field.endsWith("Sha256") && receipt[field] !== evidence[field]) {
      throw new Error("Existing serial batch retirement receipt hash binding drifted.");
    }
    if (field.endsWith("File") && receipt[field] !== evidence[field]) {
      throw new Error("Existing serial batch retirement receipt path binding drifted.");
    }
  }
}

async function batchRetire(root, options) {
  if (options.confirmRetire !== true) throw new Error("Serial batch Worktree retirement requires explicit approval and ConfirmRetire.");
  let context = await loadBatchRetirementContext(root, options);
  let evidence = await collectBatchRetirementEvidence(root, context);
  const existing = await readJsonOptional(context.retirementReceiptPath, "Serial batch Worktree retirement receipt");
  if (existing) {
    validateBatchRetirementReceipt(existing, context, evidence);
    const receiptEvidence = await readBatchRetirementBuffer(root, context.retirementReceiptFile, "Serial batch Worktree retirement receipt");
    evidence.allowed.set(pathKey(context.retirementReceiptFile), {
      path: context.retirementReceiptFile,
      sha256: receiptEvidence.sha256,
      bytes: receiptEvidence.bytes,
    });
  }
  const conflicts = await batchRetirementConflictingLocks(root, context);
  await assertLocksAbsent([context.retirementLockPath, ...conflicts]);
  await assertBatchMainRepositoryIntegrity(root, context, evidence, options);
  let observed = await inspectBatchRetirementWorktree(root, context, options);
  if (observed.state === "created") await assertBatchWorktreeIntegrity(root, context, evidence, options);
  if (existing) {
    if (observed.state !== "absent") throw new Error("Existing serial batch retirement receipt requires an absent Worktree.");
    return { command: "batch-retire", reused: true, receiptFile: context.retirementReceiptFile, receipt: existing };
  }

  const retirementLockPath = context.retirementLockPath;
  await acquireLock(retirementLockPath, options);
  try {
    if (options.afterBatchRetireLock) await options.afterBatchRetireLock();
    context = await loadBatchRetirementContext(root, options);
    evidence = await collectBatchRetirementEvidence(root, context);
    const currentConflicts = await batchRetirementConflictingLocks(root, context);
    await assertLocksAbsent(currentConflicts);
    await assertBatchMainRepositoryIntegrity(root, context, evidence, options, true);
    observed = await inspectBatchRetirementWorktree(root, context, options);
    if (observed.state === "created") await assertBatchWorktreeIntegrity(root, context, evidence, options);
    let recovered = observed.state === "absent";
    if (observed.state === "created") {
      try {
        await executeGit(root, ["worktree", "remove", "--force", observed.targetPath], options);
      } catch (error) {
        const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
        throw new Error(`git worktree remove failed: ${diagnostic}`);
      }
      if (options.afterBatchRetireRemove) await options.afterBatchRetireRemove();
      recovered = false;
    }
    const receipt = {
      schemaVersion: "1.0",
      storyId: context.state.storyId,
      runId: context.state.runtime.runId,
      batchId: context.batch.ledger.batchId,
      branch: context.plan.branch,
      worktreePath: context.plan.worktreePath,
      baseCommit: context.plan.baseCommit,
      ...Object.fromEntries(BATCH_RETIREMENT_RECEIPT_FIELDS
        .filter((field) => field.endsWith("File") || field.endsWith("Sha256") || field === "tasks" || field === "appliedFiles")
        .map((field) => [field, evidence[field]])),
      retiredAt: (options.now ?? (() => new Date().toISOString()))(),
      recovered,
    };
    await writeAtomicJson(context.retirementReceiptPath, receipt);
    return { command: "batch-retire", reused: false, receiptFile: context.retirementReceiptFile, receipt };
  } finally {
    await unlink(retirementLockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function retire(root, options) {
  if (options.confirmRetire !== true) throw new Error("Worktree retirement requires explicit approval and ConfirmRetire.");
  const context = await loadRetirementContext(root, options);
  const plan = await validateStoredPlan(root, await readJsonFile(context.planPath, "Worktree plan"), context.state, options.taskId);
  await assertSafeTargetParents(root, context.lockPath);
  await assertLocksAbsent([
    context.lockPath,
    context.lockPath.replace(/retire\.lock$/, "create.lock"),
    context.lockPath.replace(/retire\.lock$/, "execute.lock"),
    context.lockPath.replace(/retire\.lock$/, "integration/integrate.lock"),
  ]);
  await assertMainRepositoryClean(root, context, plan, options);
  const observed = await inspectRetirementWorktree(root, plan, options);
  let evidenceFiles = await validateRetirementEvidence(root, context, plan, observed.state === "created");
  let evidence = await buildRetirementEvidence(root, { ...evidenceFiles, planPath: context.planPath, statusPath: context.statusPath });
  const existing = await readJsonOptional(context.receiptPath, "Worktree retirement receipt");
  if (existing) {
    validateRetirementReceipt(existing, context, plan, evidence);
    if (observed.state !== "absent") throw new Error("Existing retirement receipt requires an absent Worktree.");
    return { command: "retire", reused: true, receiptFile: context.receiptFile, receipt: existing };
  }

  await acquireLock(context.lockPath, options);
  try {
    if (options.afterRetireLock) await options.afterRetireLock();
    await assertLocksAbsent([
      context.lockPath.replace(/retire\.lock$/, "create.lock"),
      context.lockPath.replace(/retire\.lock$/, "execute.lock"),
      context.lockPath.replace(/retire\.lock$/, "integration/integrate.lock"),
    ]);
    const current = await inspectRetirementWorktree(root, plan, options);
    await assertMainRepositoryClean(root, context, plan, options);
    evidenceFiles = await validateRetirementEvidence(root, context, plan, current.state === "created");
    evidence = await buildRetirementEvidence(root, { ...evidenceFiles, planPath: context.planPath, statusPath: context.statusPath });
    let recovered = current.state === "absent";
    if (current.state === "created") {
      try {
        await executeGit(root, ["worktree", "remove", "--force", current.targetPath], options);
      } catch (error) {
        const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
        throw new Error(`git worktree remove failed: ${diagnostic}`);
      }
      if (options.afterRetireRemove) await options.afterRetireRemove();
      recovered = false;
    }
    const receipt = {
      schemaVersion: "1.0",
      storyId: context.state.storyId,
      runId: context.state.runtime.runId,
      taskId: plan.taskId,
      branch: plan.branch,
      worktreePath: plan.worktreePath,
      baseCommit: plan.baseCommit,
      ...evidence,
      retiredAt: (options.now ?? (() => new Date().toISOString()))(),
      recovered,
    };
    await writeAtomicJson(context.receiptPath, receipt);
    return { command: "retire", reused: false, receiptFile: context.receiptFile, receipt };
  } finally {
    await unlink(context.lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function assertSafeTargetParents(root, targetPath) {
  let current = path.dirname(targetPath);
  while (pathKey(current) !== pathKey(root)) {
    const info = await lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`Worktree parent must be a real directory inside the repository: ${normalizePath(current)}`);
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Worktree path escapes the repository root.");
    current = parent;
  }
}

async function assertMainRepositoryClean(root, context, plan, options) {
  const excluded = [
    `:(top,literal,exclude)${context.stateFile}`,
    `:(top,literal,exclude)${plan.taskDagFile}`,
    `:(top,glob,exclude).harness/runs/${plan.runId}/**`,
  ];
  const result = await executeGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ...excluded], options);
  if (String(result.stdout ?? "").trim()) throw new Error("The main repository must be clean before creating or retiring a Worktree.");
}

async function assertNoOtherStoryWorktree(root, plan, options) {
  const result = await executeGit(root, ["worktree", "list", "--porcelain"], options);
  const storyRoot = pathKey(path.resolve(root, `.harness/worktrees/${plan.storyId}`));
  const target = pathKey(path.resolve(root, plan.worktreePath));
  const other = parseWorktreeList(String(result.stdout ?? "")).find((item) => {
    const candidate = pathKey(item.worktree ?? "");
    return candidate !== target && candidate.startsWith(`${storyRoot}/`);
  });
  if (other) throw new Error("Only one created Worktree is allowed for the current Story run.");
}

async function plan(root, options) {
  const context = await loadContext(root, options);
  const taskDagLocation = resolveInsideRoot(root, options.taskDagFile, "Task DAG file");
  await assertSafeTargetParents(root, taskDagLocation.fullPath);
  const loaded = await loadTaskDag(taskDagLocation.fullPath);
  if (loaded.dag.storyId !== context.state.storyId) throw new Error("Task DAG does not match the active Story.");
  const task = loaded.nodes.get(options.taskId);
  if (!task) throw new Error(`Task DAG contains unknown task '${options.taskId}'.`);
  if (task.status !== "pending") throw new Error(`Task '${options.taskId}' must be pending before Worktree planning.`);
  const baseRef = options.baseRef ?? "dev";
  if (typeof baseRef !== "string" || !baseRef.trim()) throw new Error("Base ref must be a non-empty string.");
  const base = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], options);
  if (!base.ok) throw new Error(`Cannot resolve base ref '${baseRef}'.`);
  const expected = {
    schemaVersion: "1.0",
    storyId: context.state.storyId,
    runId: context.state.runtime.runId,
    taskId: task.taskId,
    title: task.title,
    ownerAgent: task.ownerAgent ?? "",
    wave: loaded.waveByTask.get(task.taskId) + 1,
    taskDagFile: taskDagLocation.relative,
    taskDagSha256: await fileSha256(taskDagLocation.fullPath),
    baseRef,
    baseCommit: base.stdout.trim(),
    branch: `harness/${context.state.storyId.toLowerCase()}/${task.taskId.toLowerCase()}-${slug(task.title)}`,
    worktreePath: `.harness/worktrees/${context.state.storyId}/${task.taskId}`,
    predictedFiles: [...task.predictedFiles],
  };
  const existing = await readJsonOptional(context.planPath, "Worktree plan");
  if (existing) {
    await validateStoredPlan(root, existing, context.state, options.taskId);
    if (JSON.stringify(comparablePlan(existing)) !== JSON.stringify(expected)) {
      throw new Error("Existing Worktree plan does not match the requested task and base commit.");
    }
    const status = await inspectStatus(root, existing, context.planPath, context.statusPath, options);
    return { command: "plan", reused: true, planFile: context.planFile, statusFile: context.statusFile, plan: existing, status };
  }
  const worktreePlan = { ...expected, plannedAt: (options.now ?? (() => new Date().toISOString()))() };
  await writeAtomicJson(context.planPath, worktreePlan);
  const status = await inspectStatus(root, worktreePlan, context.planPath, context.statusPath, options);
  return { command: "plan", reused: false, planFile: context.planFile, statusFile: context.statusFile, plan: worktreePlan, status };
}

async function status(root, options) {
  const context = await loadContext(root, options);
  const worktreePlan = await validateStoredPlan(root, await readJsonFile(context.planPath, "Worktree plan"), context.state, options.taskId);
  const current = await inspectStatus(root, worktreePlan, context.planPath, context.statusPath, options);
  return { command: "status", planFile: context.planFile, statusFile: context.statusFile, plan: worktreePlan, status: current };
}

async function wavePlan(root, options) {
  const context = await loadWaveContext(root, options);
  const taskDagLocation = resolveInsideRoot(root, options.taskDagFile, "Task DAG file");
  await assertSafeTargetParents(root, taskDagLocation.fullPath);
  const loaded = await loadTaskDag(taskDagLocation.fullPath);
  if (loaded.dag.storyId !== context.state.storyId) throw new Error("Task DAG does not match the active Story.");
  if (loaded.dag.globalChanges.length) throw new Error("Wave Worktree planning does not support globalChanges.");
  const taskIds = loaded.dag.waves[options.waveIndex - 1];
  if (!taskIds) throw new Error(`Task DAG does not contain wave ${options.waveIndex}.`);
  if (taskIds.length < 2) throw new Error("Wave Worktree planning requires at least two tasks.");
  const tasks = taskIds.map((taskId) => loaded.nodes.get(taskId));
  if (tasks.some((task) => task.status !== "pending")) {
    throw new Error("Wave Worktree planning requires every task to be pending.");
  }
  if (tasks.some((task) => !["backend", "frontend"].includes(task.type))) {
    throw new Error("Wave Worktree planning only supports backend and frontend tasks.");
  }
  const baseRef = options.baseRef ?? "dev";
  if (typeof baseRef !== "string" || !baseRef.trim()) throw new Error("Base ref must be a non-empty string.");
  const base = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], options);
  if (!base.ok) throw new Error(`Cannot resolve base ref '${baseRef}'.`);
  const orderedTasks = [...tasks].sort((left, right) => compareIdentifiers(left.taskId, right.taskId));
  const expected = {
    schemaVersion: "1.0",
    storyId: context.state.storyId,
    runId: context.state.runtime.runId,
    wave: options.waveIndex,
    taskDagFile: taskDagLocation.relative,
    taskDagSha256: await fileSha256(taskDagLocation.fullPath),
    baseRef,
    baseCommit: base.stdout.trim(),
    tasks: orderedTasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      type: task.type,
      ownerAgent: task.ownerAgent ?? "",
      branch: `harness/${context.state.storyId.toLowerCase()}/wave-${options.waveIndex}-${task.taskId.toLowerCase()}-${slug(task.title)}`,
      worktreePath: `.harness/worktrees/${context.state.storyId}/wave-${options.waveIndex}/${task.taskId}`,
      predictedFiles: [...task.predictedFiles],
    })),
  };
  const existing = await readJsonOptional(context.planPath, "Wave Worktree plan");
  if (existing) {
    validateWavePlanStructure(existing, context.state, options.waveIndex);
    if (JSON.stringify(comparableWavePlan(existing)) !== JSON.stringify(expected)) {
      throw new Error("Existing Wave Worktree plan does not match the requested wave and base commit.");
    }
    const status = await inspectWaveStatus(
      root,
      existing,
      context.planPath,
      context.statusPath,
      options,
      undefined,
      false,
    );
    return { command: "wave-plan", reused: true, planFile: context.planFile, statusFile: context.statusFile, plan: existing, status };
  }
  const plan = { ...expected, plannedAt: (options.now ?? (() => new Date().toISOString()))() };
  validateWavePlanStructure(plan, context.state, options.waveIndex);
  await writeAtomicJson(context.planPath, plan);
  const status = await inspectWaveStatus(root, plan, context.planPath, context.statusPath, options);
  return { command: "wave-plan", reused: false, planFile: context.planFile, statusFile: context.statusFile, plan, status };
}

async function waveStatus(root, options) {
  const context = await loadWaveContext(root, options);
  const plan = await validateStoredWavePlan(
    root,
    await readJsonFile(context.planPath, "Wave Worktree plan"),
    context.state,
    options.waveIndex,
    options.taskDagFile,
  );
  const planSha256 = await fileSha256(context.planPath);
  const current = await inspectWaveStatus(
    root,
    plan,
    context.planPath,
    context.statusPath,
    options,
    undefined,
    false,
  );
  const locks = await inspectWaveLocks(root, context, plan, planSha256);
  return {
    command: "wave-status",
    planFile: context.planFile,
    statusFile: context.statusFile,
    plan,
    status: current,
    locks,
  };
}

async function waveCreate(root, options) {
  assertWaveCreateInputs(options);
  const context = await loadWaveContext(root, options);
  const initial = await loadApprovedWavePlan(root, context, options);
  const owner = options.confirmWaveLockRecovery === true
    ? await acquireWaveRecoveryLock(root, context, initial.plan, initial.planSha256, options)
    : await acquireWaveCreateLock(root, context, initial.plan, initial.planSha256, options);
  let result;
  let completed = false;
  try {
    const approved = await loadApprovedWavePlan(root, context, options);
    await assertWaveLockOwned(root, context, approved.plan, owner);
    await assertMainRepositoryClean(root, context, approved.plan, options);
    await assertWaveStoryAllowlist(root, approved.plan, options);
    const authorizeMutation = () => assertWaveMutationAuthorized(root, context, owner, options);
    let current = await inspectWaveStatus(
      root,
      approved.plan,
      context.planPath,
      context.statusPath,
      options,
      authorizeMutation,
    );
    for (const taskStatus of current.tasks) {
      if (taskStatus.state === "created") continue;
      if (options.beforeWaveTaskCreate) await options.beforeWaveTaskCreate(taskStatus.taskId);
      const reloaded = await loadApprovedWavePlan(root, context, options);
      await assertWaveLockOwned(root, context, reloaded.plan, owner);
      await createWaveTask(root, reloaded.plan, taskStatus, options, authorizeMutation);
      if (options.afterWaveTaskCreate) await options.afterWaveTaskCreate(taskStatus.taskId);
      await loadApprovedWavePlan(root, context, options);
      await assertWaveLockOwned(root, context, reloaded.plan, owner);
      current = await inspectWaveStatus(
        root,
        reloaded.plan,
        context.planPath,
        context.statusPath,
        options,
        authorizeMutation,
      );
    }
    if (current.state !== "ready") throw new Error("Wave Worktree creation did not converge to ready.");
    const receiptResult = await ensureWaveCreationReceipt(
      root,
      context,
      approved.plan,
      approved.planSha256,
      current,
      owner,
      options,
    );
    result = {
      command: "wave-create",
      reused: receiptResult.reused,
      planFile: context.planFile,
      statusFile: context.statusFile,
      receiptFile: context.receiptFile,
      plan: approved.plan,
      status: current,
      receipt: receiptResult.receipt,
    };
    completed = true;
  } finally {
    if (owner.mode === "create" || completed) {
      await releaseWaveLockOwned(root, context, initial.plan, owner, options);
    }
  }
  const refreshed = await waveStatus(root, options);
  return { ...result, status: refreshed.status, locks: refreshed.locks };
}

async function readWaveRetirementEvidence(root, relativeFile, label, json = false) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await assertSafeTargetParents(root, location.fullPath);
  const evidence = await readRegularBuffer(location.fullPath, label);
  if (!json) return { relative: location.relative, ...evidence };
  try {
    return { relative: location.relative, value: JSON.parse(evidence.buffer.toString("utf8")), ...evidence };
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

function addWaveRetirementAllowed(allowed, evidence) {
  const key = pathKey(evidence.relative);
  const existing = allowed.get(key);
  if (existing && (existing.sha256 !== evidence.sha256 || existing.bytes !== evidence.bytes)) {
    throw new Error(`Wave retirement evidence conflicts for ${evidence.relative}.`);
  }
  allowed.set(key, evidence);
}

async function loadWaveRetirementContext(root, options) {
  await assertRepositoryRoot(root, options);
  const stateLocation = resolveInsideRoot(root, options.stateFile, "State file");
  await assertSafeTargetParents(root, stateLocation.fullPath);
  const state = await readJsonFile(stateLocation.fullPath, "State file");
  validateRetirementState(state);
  if (!Number.isInteger(options.waveIndex) || options.waveIndex < 1) {
    throw new Error("Wave index must be a positive integer.");
  }

  const outputs = waveOutputPaths(root, state, options.waveIndex);
  const plan = await validateStoredWavePlan(
    root,
    await readJsonFile(outputs.planPath, "Wave Worktree plan"),
    state,
    options.waveIndex,
    options.taskDagFile,
  );
  const planSha256 = await fileSha256(outputs.planPath);
  const status = validateWaveStatusStructure(
    await readJsonFile(outputs.statusPath, "Wave Worktree status"),
    plan,
    planSha256,
  );
  if (status.state !== "ready") throw new Error("Wave Worktree status must remain ready before retirement.");
  const statusSha256 = await fileSha256(outputs.statusPath);
  const creationReceipt = validateWaveCreationReceipt(
    await readJsonFile(outputs.receiptPath, "Wave creation receipt"),
    plan,
    planSha256,
    status,
    statusSha256,
  );
  const creationReceiptSha256 = await fileSha256(outputs.receiptPath);

  const phaseRoot = `.harness/runs/${state.runtime.runId}/phases/03-implementation`;
  const implementation = {
    taskFile: `${phaseRoot}/task.json`,
    resultFile: `${phaseRoot}/result.json`,
    checkpointFile: `${phaseRoot}/checkpoint.json`,
    notesFile: `${phaseRoot}/implementation-notes.md`,
  };
  const checkpoint = await readJsonFile(
    resolveInsideRoot(root, implementation.checkpointFile, "Implementation checkpoint").fullPath,
    "Implementation checkpoint",
  );
  const binding = checkpoint?.waveFinalization;
  if (checkpoint?.status !== "completed" || !binding || binding.waveId === undefined) {
    throw new Error("Completed Story is missing its applied Wave finalization checkpoint.");
  }
  const { validateWaveExecutionLedger } = await import("./worktree-wave-execution-runtime.mjs");
  const ledgerLocation = resolveInsideRoot(root, binding.waveLedgerFile, "Wave execution ledger");
  const ledger = validateWaveExecutionLedger(await readJsonFile(ledgerLocation.fullPath, "Wave execution ledger"));
  const ledgerSha256 = await fileSha256(ledgerLocation.fullPath);
  if (ledger.status !== "finalized") throw new Error("Wave retirement requires a finalized Wave ledger.");
  if (ledgerSha256 !== options.expectedWaveLedgerSha256) {
    throw new Error("Wave execution ledger hash does not match ExpectedWaveLedgerSha256.");
  }
  if (ledger.storyId !== state.storyId || ledger.runId !== state.runtime.runId
      || ledger.waveIndex !== options.waveIndex || ledger.baseCommit !== plan.baseCommit) {
    throw new Error("Finalized Wave ledger no longer matches its planning evidence.");
  }
  if (ledger.taskDagFile !== plan.taskDagFile || ledger.taskDagSha256 !== plan.taskDagSha256) {
    throw new Error("Bound Task DAG changed from the finalized Wave ledger.");
  }
  if (ledger.wavePlanFile !== outputs.planFile || ledger.wavePlanSha256 !== planSha256) {
    throw new Error("Wave Worktree plan hash changed from the finalized Wave ledger.");
  }
  if (ledger.creationReceiptFile !== outputs.receiptFile
      || ledger.creationReceiptSha256 !== creationReceiptSha256) {
    throw new Error("Wave creation receipt changed from the finalized Wave ledger.");
  }
  if (state.runtime.revision < binding.preparedRevision) {
    throw new Error("Completed State revision predates the finalized Wave checkpoint.");
  }
  if (binding.storyId !== state.storyId || binding.runId !== state.runtime.runId
      || binding.stateFile !== stateLocation.relative || binding.phase !== "implementation"
      || binding.preparedRevision !== ledger.preparedRevision
      || binding.waveId !== ledger.waveId || binding.waveLedgerFile !== ledgerLocation.relative
      || binding.waveLedgerSha256 !== ledgerSha256
      || binding.waveReceiptFile !== ledger.waveReceiptFile
      || binding.waveReceiptSha256 !== ledger.waveReceiptSha256
      || binding.integrationManifestFile !== ledger.integrationManifestFile
      || binding.integrationManifestSha256 !== ledger.integrationManifestSha256
      || binding.taskFile !== implementation.taskFile
      || binding.resultFile !== implementation.resultFile
      || binding.notesFile !== implementation.notesFile
      || binding.finalizedAt !== ledger.finalizedAt) {
    throw new Error("Applied Wave checkpoint no longer matches the finalized ledger.");
  }
  const waveReceiptLocation = resolveInsideRoot(root, ledger.waveReceiptFile, "Wave receipt");
  const waveReceiptSha256 = await fileSha256(waveReceiptLocation.fullPath);
  if (waveReceiptSha256 !== options.expectedWaveReceiptSha256
      || waveReceiptSha256 !== ledger.waveReceiptSha256) {
    throw new Error("Wave receipt changed from ExpectedWaveReceiptSha256.");
  }
  const waveReceipt = await readJsonFile(waveReceiptLocation.fullPath, "Wave receipt");
  if (waveReceipt.storyId !== binding.storyId
      || waveReceipt.runId !== binding.runId
      || waveReceipt.phase !== binding.phase
      || waveReceipt.waveId !== binding.waveId
      || waveReceipt.waveIndex !== ledger.waveIndex
      || waveReceipt.preparedRevision !== binding.preparedRevision
      || waveReceipt.integrationManifestFile !== binding.integrationManifestFile
      || waveReceipt.integrationManifestSha256 !== binding.integrationManifestSha256
      || waveReceipt.phaseArtifacts?.taskFile !== binding.taskFile
      || waveReceipt.phaseArtifacts?.taskSha256 !== binding.taskSha256
      || waveReceipt.phaseArtifacts?.resultFile !== binding.resultFile
      || waveReceipt.phaseArtifacts?.resultSha256 !== binding.resultSha256
      || waveReceipt.phaseArtifacts?.notesFile !== binding.notesFile
      || waveReceipt.phaseArtifacts?.notesSha256 !== binding.notesSha256
      || waveReceipt.completedAt !== binding.finalizedAt
      || !Array.isArray(waveReceipt.tasks)
      || waveReceipt.tasks.length !== ledger.tasks.length
      || ledger.tasks.some((task, index) => {
        const receiptTask = waveReceipt.tasks[index];
        return receiptTask?.taskId !== task.taskId
          || receiptTask.dispatchId !== task.dispatchId
          || receiptTask.executionReceiptFile !== task.executionReceiptFile
          || receiptTask.executionReceiptSha256 !== task.executionReceiptSha256
          || receiptTask.integrationReceiptFile !== task.integrationReceiptFile
          || receiptTask.integrationReceiptSha256 !== task.integrationReceiptSha256;
      })) {
    throw new Error("Wave receipt identity no longer matches the finalized ledger and checkpoint.");
  }
  const manifestLocation = resolveInsideRoot(root, ledger.integrationManifestFile, "Wave integration manifest");
  if (await fileSha256(manifestLocation.fullPath) !== ledger.integrationManifestSha256) {
    throw new Error("Wave integration manifest changed after finalization.");
  }
  const manifest = await readJsonFile(manifestLocation.fullPath, "Wave integration manifest");
  return {
    state,
    stateFile: stateLocation.relative,
    statePath: stateLocation.fullPath,
    outputs,
    plan,
    planSha256,
    status,
    statusSha256,
    creationReceipt,
    creationReceiptSha256,
    implementation,
    checkpoint,
    binding,
    ledger,
    ledgerFile: ledgerLocation.relative,
    ledgerSha256,
    waveReceipt,
    waveReceiptFile: waveReceiptLocation.relative,
    waveReceiptSha256,
    manifest,
    manifestFile: manifestLocation.relative,
  };
}

async function collectWaveRetirementEvidence(root, context) {
  const allowed = new Map();
  const add = (evidence) => addWaveRetirementAllowed(allowed, evidence);
  const load = async (relative, label, json = false) => {
    const evidence = await readWaveRetirementEvidence(root, relative, label, json);
    add(evidence);
    return evidence;
  };

  const state = await load(context.stateFile, "Completed state file", true);
  await load(context.state.runtime.workflow, "Completed Story workflow");
  const stateEventsFile = `.harness/states/e2e-${context.state.storyId}.events.jsonl`;
  const stateEvents = await load(stateEventsFile, "Completed state event log");
  const stateBackup = await load(`${context.stateFile}.bak`, "Completed state backup", true);
  if (state.value.phase !== "done" || state.value.runtime?.status !== "completed"
      || state.value.storyId !== context.state.storyId || state.value.runtime?.runId !== context.state.runtime.runId) {
    throw new Error("Wave retirement requires a completed Story.");
  }

  const taskDag = await load(context.plan.taskDagFile, "Bound Task DAG");
  if (taskDag.sha256 !== context.plan.taskDagSha256) throw new Error("Bound Task DAG changed after Wave planning.");
  const plan = await load(context.outputs.planFile, "Wave Worktree plan");
  if (plan.sha256 !== context.planSha256) throw new Error("Wave Worktree plan hash changed.");
  const status = await load(context.outputs.statusFile, "Wave Worktree status");
  if (status.sha256 !== context.statusSha256) throw new Error("Wave Worktree status hash changed.");
  const creation = await load(context.outputs.receiptFile, "Wave creation receipt");
  if (creation.sha256 !== context.creationReceiptSha256) throw new Error("Wave creation receipt changed.");
  const ledger = await load(context.ledgerFile, "Finalized Wave ledger");
  const manifest = await load(context.manifestFile, "Wave integration manifest");
  const waveReceipt = await load(context.waveReceiptFile, "Wave receipt");
  if (ledger.sha256 !== context.ledgerSha256 || manifest.sha256 !== context.ledger.integrationManifestSha256
      || waveReceipt.sha256 !== context.waveReceiptSha256) {
    throw new Error("Finalized Wave evidence changed during retirement preflight.");
  }

  const implementationTask = await load(context.implementation.taskFile, "Finalized implementation task", true);
  const implementationResult = await load(context.implementation.resultFile, "Finalized implementation result", true);
  const implementationCheckpoint = await load(context.implementation.checkpointFile, "Finalized implementation checkpoint", true);
  const implementationNotes = await load(context.implementation.notesFile, "Finalized implementation notes");
  for (const [evidence, expected, label] of [
    [implementationTask, context.binding.taskSha256, "Finalized implementation task"],
    [implementationResult, context.binding.resultSha256, "Finalized implementation result"],
    [implementationNotes, context.binding.notesSha256, "Finalized implementation notes"],
  ]) {
    if (evidence.sha256 !== expected) throw new Error(`${label} changed after Wave finalization.`);
  }
  if (implementationCheckpoint.value.status !== "completed"
      || JSON.stringify(implementationCheckpoint.value.waveFinalization) !== JSON.stringify(context.binding)
      || implementationTask.value.preparedRevision !== context.binding.preparedRevision
      || context.waveReceipt.phaseArtifacts?.taskSha256 !== implementationTask.sha256
      || context.waveReceipt.phaseArtifacts?.resultSha256 !== implementationResult.sha256
      || context.waveReceipt.phaseArtifacts?.notesSha256 !== implementationNotes.sha256) {
    throw new Error("Applied Wave checkpoint or formal phase artifacts changed.");
  }
  if (context.manifest.storyId !== context.state.storyId
      || context.manifest.runId !== context.state.runtime.runId
      || context.manifest.waveId !== context.ledger.waveId
      || context.manifest.waveIndex !== context.ledger.waveIndex
      || context.manifest.wavePlanSha256 !== context.planSha256
      || context.manifest.creationReceiptSha256 !== context.creationReceiptSha256
      || context.manifest.baseCommit !== context.plan.baseCommit
      || !Array.isArray(context.manifest.tasks)
      || !Array.isArray(context.manifest.candidateFiles)
      || !Array.isArray(context.waveReceipt.tasks)
      || context.waveReceipt.tasks.length !== context.ledger.tasks.length) {
    throw new Error("Wave integration manifest or receipt identity changed.");
  }

  const tasks = [];
  for (let index = 0; index < context.ledger.tasks.length; index += 1) {
    const ledgerTask = context.ledger.tasks[index];
    const manifestTask = context.manifest.tasks[index];
    const receiptTask = context.waveReceipt.tasks[index];
    const planTask = context.plan.tasks[index];
    if (!manifestTask || !receiptTask || !planTask
        || manifestTask.taskId !== ledgerTask.taskId || receiptTask.taskId !== ledgerTask.taskId
        || planTask.taskId !== ledgerTask.taskId || manifestTask.worktreePath !== planTask.worktreePath
        || manifestTask.headCommit !== context.plan.baseCommit) {
      throw new Error(`Finalized Wave task evidence changed: ${ledgerTask.taskId}`);
    }
    const taskFile = await load(ledgerTask.taskFile, `Wave task '${ledgerTask.taskId}' dispatch`);
    const checkpointFile = await load(ledgerTask.checkpointFile, `Wave task '${ledgerTask.taskId}' checkpoint`);
    const resultFile = await load(manifestTask.resultFile, `Wave task '${ledgerTask.taskId}' result`);
    const execution = await load(ledgerTask.executionReceiptFile, `Wave task '${ledgerTask.taskId}' execution receipt`, true);
    const integration = await load(ledgerTask.integrationReceiptFile, `Wave task '${ledgerTask.taskId}' integration receipt`, true);
    if (taskFile.sha256 !== ledgerTask.taskSha256 || checkpointFile.sha256 !== ledgerTask.checkpointSha256
        || resultFile.sha256 !== manifestTask.resultSha256
        || receiptTask.resultFile !== manifestTask.resultFile
        || receiptTask.resultSha256 !== manifestTask.resultSha256
        || receiptTask.executionReceiptSha256 !== ledgerTask.executionReceiptSha256
        || receiptTask.integrationReceiptSha256 !== ledgerTask.integrationReceiptSha256) {
      throw new Error(`Wave task '${ledgerTask.taskId}' receipt evidence changed.`);
    }
    if (execution.sha256 !== ledgerTask.executionReceiptSha256) {
      throw new Error(`Wave task '${ledgerTask.taskId}' execution receipt changed.`);
    }
    if (integration.sha256 !== ledgerTask.integrationReceiptSha256) {
      throw new Error(`Wave task '${ledgerTask.taskId}' integration receipt changed.`);
    }
    const candidates = context.manifest.candidateFiles.filter((file) => file.taskId === ledgerTask.taskId);
    if (JSON.stringify(integration.value.appliedFiles) !== JSON.stringify(candidates)) {
      throw new Error(`Wave task '${ledgerTask.taskId}' integration receipt changed from the manifest.`);
    }
    if (Array.isArray(execution.value.files)) {
      const executionFiles = new Map(execution.value.files.map((file) => [pathKey(file.path), file]));
      if (executionFiles.size !== candidates.length || candidates.some((candidate) => {
        const file = executionFiles.get(pathKey(candidate.path));
        return !file || file.kind !== candidate.type || file.sha256 !== candidate.sha256 || file.bytes !== candidate.bytes;
      })) {
        throw new Error(`Wave task '${ledgerTask.taskId}' execution receipt changed from the manifest.`);
      }
    }
    for (const candidate of candidates) {
      const applied = await load(candidate.path, `Applied Wave candidate '${candidate.path}'`);
      if (applied.sha256 !== candidate.sha256 || applied.bytes !== candidate.bytes) {
        throw new Error(`Applied Wave candidate changed: ${candidate.path}`);
      }
    }
    await load(
      `${path.posix.dirname(manifestTask.resultFile)}/claim.json`,
      `Wave task '${ledgerTask.taskId}' attempt claim`,
    );
    const inputSnapshot = await load(
      `${path.posix.dirname(manifestTask.resultFile)}/input-snapshot.json`,
      `Wave task '${ledgerTask.taskId}' input snapshot`,
      true,
    );
    if (!Array.isArray(inputSnapshot.value.inputs)) {
      throw new Error(`Wave task '${ledgerTask.taskId}' input snapshot changed.`);
    }
    const worktreeFiles = new Map(candidates.map((candidate) => [pathKey(candidate.path), candidate]));
    worktreeFiles.set(pathKey(manifestTask.resultFile), {
      path: manifestTask.resultFile,
      sha256: resultFile.sha256,
      bytes: resultFile.bytes,
    });
    for (const input of inputSnapshot.value.inputs) {
      if (!input || typeof input.targetPath !== "string" || typeof input.sha256 !== "string"
          || !Number.isInteger(input.bytes)) {
        throw new Error(`Wave task '${ledgerTask.taskId}' input snapshot changed.`);
      }
      if (!worktreeFiles.has(pathKey(input.targetPath))) {
        worktreeFiles.set(pathKey(input.targetPath), {
          path: input.targetPath,
          sha256: input.sha256,
          bytes: input.bytes,
        });
      }
    }
    tasks.push({
      taskId: ledgerTask.taskId,
      plan: { ...planTask, baseCommit: context.plan.baseCommit },
      candidates,
      worktreeFiles: [...worktreeFiles.values()],
      resultFile: manifestTask.resultFile,
      resultSha256: resultFile.sha256,
      executionReceiptFile: ledgerTask.executionReceiptFile,
      executionReceiptSha256: execution.sha256,
      integrationReceiptFile: ledgerTask.integrationReceiptFile,
      integrationReceiptSha256: integration.sha256,
    });
  }

  await load(
    `.harness/runs/${context.state.runtime.runId}/phases/03-implementation/implementation-owner.json`,
    "Implementation owner",
  );
  const currentRecords = new Map();
  for (const record of context.state.runtime.records ?? []) {
    if (typeof record.path === "string" && record.path) currentRecords.set(record.path, record);
  }
  for (const record of currentRecords.values()) {
    if (!/^sha256:[a-f0-9]{64}$/.test(record.sha256 ?? "")) {
      throw new Error(`Completed State record is missing a valid SHA-256: ${record.path}`);
    }
    const recordEvidence = await load(record.path, "Completed Story record evidence");
    if (recordEvidence.sha256 !== record.sha256) {
      throw new Error(`Completed State record evidence changed: ${record.path}`);
    }
  }
  for (const relative of [
    `.harness/runs/${context.state.runtime.runId}/phases/04-unit-test/test-report.md`,
    `.harness/runs/${context.state.runtime.runId}/phases/05-code-review/code-review-report.md`,
    `.harness/runs/${context.state.runtime.runId}/phases/06-build-publish/build-report.md`,
    `.harness/runs/${context.state.runtime.runId}/phases/07-interface-verification/interface-verification-report.md`,
    `.harness/runs/${context.state.runtime.runId}/phases/08-git-delivery/delivery-report.md`,
  ]) {
    await load(relative, "Completed Story phase output");
  }
  return {
    allowed,
    tasks,
    state,
    stateEvents,
    stateBackup,
    implementationTask,
    implementationResult,
    implementationCheckpoint,
    implementationNotes,
  };
}

async function assertWaveRetirementMainIntegrity(root, context, evidence, options) {
  const status = await executeGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], options);
  const worktreePaths = context.plan.tasks.map((task) => pathKey(task.worktreePath));
  for (const entry of parsePorcelainPaths(String(status.stdout ?? ""))) {
    const relative = entry.relative.replace(/\/+$/, "");
    const expected = evidence.allowed.get(pathKey(relative));
    if (!expected) throw new Error(`Main repository contains an unexplained Wave retirement change: ${relative}`);
    const current = await readRegularBuffer(resolveInsideRoot(root, relative, "Wave retirement main evidence").fullPath, "Wave retirement main evidence");
    if (current.sha256 !== expected.sha256 || current.bytes !== expected.bytes) {
      throw new Error(`Wave retirement main evidence hash drifted: ${relative}`);
    }
  }
  const ignored = await executeGit(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], options);
  for (const relative of String(ignored.stdout ?? "").split("\0").filter(Boolean).map(normalizePath)) {
    const normalized = relative.replace(/\/+$/, "");
    if (worktreePaths.some((worktreePath) => worktreePath.startsWith(`${pathKey(normalized)}/`) || worktreePath === pathKey(normalized))) {
      continue;
    }
    const expected = evidence.allowed.get(pathKey(normalized));
    if (!expected) throw new Error(`Main repository contains an unexplained ignored Wave retirement change: ${normalized}`);
    const current = await readRegularBuffer(resolveInsideRoot(root, normalized, "Ignored Wave retirement evidence").fullPath, "Ignored Wave retirement evidence");
    if (current.sha256 !== expected.sha256 || current.bytes !== expected.bytes) {
      throw new Error(`Ignored Wave retirement evidence hash drifted: ${normalized}`);
    }
  }
}

async function assertWaveRetirementWorktreeIntegrity(root, task, options) {
  const worktreeRoot = resolveInsideRoot(root, task.plan.worktreePath, "Wave Worktree path").fullPath;
  const allowed = new Map(task.worktreeFiles.map((file) => [pathKey(file.path), file]));
  for (const candidate of task.worktreeFiles) {
    const current = await readRegularBuffer(
      resolveInsideRoot(worktreeRoot, candidate.path, "Wave Worktree candidate").fullPath,
      "Wave Worktree candidate",
    );
    if (current.sha256 !== candidate.sha256 || current.bytes !== candidate.bytes) {
      throw new Error(`Wave Worktree candidate changed: ${candidate.path}`);
    }
  }
  const status = await executeGit(worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], options);
  for (const entry of parsePorcelainPaths(String(status.stdout ?? ""))) {
    if (!allowed.has(pathKey(entry.relative))) {
      throw new Error(`Wave Worktree contains an unexplained change: ${entry.relative}`);
    }
  }
  const ignored = await executeGit(worktreeRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], options);
  for (const relative of String(ignored.stdout ?? "").split("\0").filter(Boolean).map(normalizePath)) {
    if (!allowed.has(pathKey(relative))) {
      throw new Error(`Wave Worktree contains an unexplained ignored file: ${relative}`);
    }
  }
}

function waveRetirementPaths(root, context) {
  const waveRoot = path.posix.dirname(context.ledgerFile);
  const lockFile = `${waveRoot}/worktree-retire.lock`;
  const recoveryLockFile = `${waveRoot}/worktree-retire-recovery.lock`;
  return {
    waveRoot,
    lockFile,
    recoveryLockFile,
    lockPath: resolveInsideRoot(root, lockFile, "Wave retirement lock").fullPath,
    recoveryLockPath: resolveInsideRoot(root, recoveryLockFile, "Wave retirement recovery lock").fullPath,
  };
}

function validateWaveRetirementLock(lock, context, mode, paths) {
  const fields = mode === "recovery"
    ? WAVE_RETIREMENT_RECOVERY_LOCK_FIELDS
    : WAVE_RETIREMENT_LOCK_FIELDS;
  if (!lock || typeof lock !== "object" || Array.isArray(lock)
      || Object.keys(lock).length !== fields.length
      || fields.some((field) => !Object.hasOwn(lock, field))
      || lock.schemaVersion !== "1.0"
      || typeof lock.lockId !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(lock.lockId)
      || typeof lock.retirementId !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(lock.retirementId)
      || lock.mode !== mode
      || lock.storyId !== context.state.storyId
      || lock.runId !== context.state.runtime.runId
      || lock.waveId !== context.ledger.waveId
      || lock.waveIndex !== context.ledger.waveIndex
      || lock.wavePlanSha256 !== context.planSha256
      || lock.creationReceiptSha256 !== context.creationReceiptSha256
      || lock.waveLedgerSha256 !== context.ledgerSha256
      || lock.waveReceiptSha256 !== context.waveReceiptSha256
      || !Number.isInteger(lock.pid) || lock.pid < 1
      || !isRfc3339DateTime(lock.createdAt)) {
    throw new Error(`Wave retirement ${mode} lock has an invalid structure.`);
  }
  if (mode === "recovery"
      && (lock.retirementLockFile !== paths.lockFile
        || !/^sha256:[a-f0-9]{64}$/.test(lock.retirementLockSha256))) {
    throw new Error("Wave retirement recovery lock does not bind the normal retirement lock.");
  }
  return lock;
}

async function inspectWaveRetirementLock(root, context, mode, paths = waveRetirementPaths(root, context)) {
  const relative = mode === "recovery" ? paths.recoveryLockFile : paths.lockFile;
  const fullPath = mode === "recovery" ? paths.recoveryLockPath : paths.lockPath;
  const value = await readJsonOptional(fullPath, `Wave retirement ${mode} lock`);
  if (!value) return null;
  const evidence = await readRegularBuffer(fullPath, `Wave retirement ${mode} lock`);
  return {
    file: relative,
    value: validateWaveRetirementLock(value, context, mode, paths),
    sha256: evidence.sha256,
    bytes: evidence.bytes,
  };
}

function assertExpectedWaveRetirementLock(snapshot, expectedSha256, label) {
  if (snapshot && !expectedSha256) throw new Error(`${label} requires its expected lock hash.`);
  if (!snapshot && expectedSha256) throw new Error(`${label} does not exist but an expected lock hash was provided.`);
  if (snapshot && snapshot.sha256 !== expectedSha256) {
    throw new Error(`${label} hash does not match the approved lock hash.`);
  }
}

async function waveRetirementConflictingLocks(root, context) {
  const paths = waveRetirementPaths(root, context);
  const relative = [
    `.harness/runs/${context.state.runtime.runId}/waves/create.lock`,
    `.harness/runs/${context.state.runtime.runId}/waves/create-recovery.lock`,
    `${paths.waveRoot}/ledger-mutation.lock`,
    `${paths.waveRoot}/manifest-preparation.lock`,
    `${paths.waveRoot}/integration.lock`,
    `${paths.waveRoot}/integration-recovery.lock`,
    `.harness/runs/${context.state.runtime.runId}/phases/03-implementation/batch-preparation.lock`,
    `.harness/runs/${context.state.runtime.runId}/phases/03-implementation/batch-finalization.lock`,
    ...context.ledger.tasks.map((task) => `${paths.waveRoot}/tasks/${task.taskId}/execute.lock`),
  ];
  return [...new Set(relative)].map((file) => resolveInsideRoot(root, file, "Wave retirement conflicting lock"));
}

async function assertWaveRetirementConflictsAbsent(root, context) {
  for (const lock of await waveRetirementConflictingLocks(root, context)) {
    const info = await lstat(lock.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info) throw new Error(`Wave retirement lifecycle lock already exists: ${lock.relative}`);
  }
}

async function addWaveRetirementLockEvidence(root, evidence, snapshot) {
  if (!snapshot) return;
  const current = await readRegularBuffer(
    resolveInsideRoot(root, snapshot.file, "Wave retirement owner lock").fullPath,
    "Wave retirement owner lock",
  );
  if (current.sha256 !== snapshot.sha256 || current.bytes !== snapshot.bytes) {
    throw new Error("Wave retirement owner lock changed before allowlist binding.");
  }
  addWaveRetirementAllowed(evidence.allowed, {
    relative: snapshot.file,
    buffer: current.buffer,
    sha256: current.sha256,
    bytes: current.bytes,
  });
}

async function acquireWaveRetirementOwner(root, context, options) {
  const paths = waveRetirementPaths(root, context);
  const normal = await inspectWaveRetirementLock(root, context, "retire", paths);
  const recovery = await inspectWaveRetirementLock(root, context, "recovery", paths);
  if (options.confirmWaveRetireLockRecovery !== true) {
    if (normal || recovery) {
      throw new Error("Wave retirement lock already exists; inspect it before retrying.");
    }
    const value = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      retirementId: randomUUID(),
      mode: "retire",
      storyId: context.state.storyId,
      runId: context.state.runtime.runId,
      waveId: context.ledger.waveId,
      waveIndex: context.ledger.waveIndex,
      wavePlanSha256: context.planSha256,
      creationReceiptSha256: context.creationReceiptSha256,
      waveLedgerSha256: context.ledgerSha256,
      waveReceiptSha256: context.waveReceiptSha256,
      pid: process.pid,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
    };
    await writeExclusiveJson(paths.lockPath, value, "Wave retirement lock already exists; inspect it before retrying.");
    const owner = await inspectWaveRetirementLock(root, context, "retire", paths);
    const racedRecovery = await inspectWaveRetirementLock(root, context, "recovery", paths);
    if (racedRecovery) throw new Error("Wave retirement owner was fenced during acquisition.");
    return { mode: "retire", paths, normal: owner, recovery: null };
  }

  if (!normal) throw new Error("Wave retirement recovery requires the existing normal retirement lock.");
  assertExpectedWaveRetirementLock(normal, options.expectedRetirementLockSha256, "ExpectedRetirementLockSha256");
  assertExpectedWaveRetirementLock(
    recovery,
    options.expectedRetirementRecoveryLockSha256,
    "ExpectedRetirementRecoveryLockSha256",
  );
  const value = {
    schemaVersion: "1.0",
    lockId: randomUUID(),
    retirementId: normal.value.retirementId,
    mode: "recovery",
    storyId: context.state.storyId,
    runId: context.state.runtime.runId,
    waveId: context.ledger.waveId,
    waveIndex: context.ledger.waveIndex,
    wavePlanSha256: context.planSha256,
    creationReceiptSha256: context.creationReceiptSha256,
    waveLedgerSha256: context.ledgerSha256,
    waveReceiptSha256: context.waveReceiptSha256,
    pid: process.pid,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
    retirementLockFile: paths.lockFile,
    retirementLockSha256: normal.sha256,
  };
  if (options.beforeWaveRetirementRecoveryLockWrite) {
    await options.beforeWaveRetirementRecoveryLockWrite();
  }
  const currentNormal = await inspectWaveRetirementLock(root, context, "retire", paths);
  const currentRecovery = await inspectWaveRetirementLock(root, context, "recovery", paths);
  assertExpectedWaveRetirementLock(currentNormal, options.expectedRetirementLockSha256, "ExpectedRetirementLockSha256");
  assertExpectedWaveRetirementLock(
    currentRecovery,
    options.expectedRetirementRecoveryLockSha256,
    "ExpectedRetirementRecoveryLockSha256",
  );
  await writeAtomicJson(paths.recoveryLockPath, value);
  const owner = await inspectWaveRetirementLock(root, context, "recovery", paths);
  if (!owner || owner.value.lockId !== value.lockId) {
    throw new Error("Wave retirement recovery lock ownership changed during acquisition.");
  }
  return {
    mode: "recovery",
    paths,
    normal: currentNormal,
    recovery: owner,
    expectedNormalSha256: currentNormal.sha256,
  };
}

async function assertWaveRetirementOwner(root, context, owner) {
  const normal = await inspectWaveRetirementLock(root, context, "retire", owner.paths);
  if (!normal || normal.sha256 !== owner.normal.sha256
      || normal.value.lockId !== owner.normal.value.lockId) {
    throw new Error("Wave retirement ownership changed.");
  }
  const recovery = await inspectWaveRetirementLock(root, context, "recovery", owner.paths);
  if (owner.mode === "retire") {
    if (recovery) throw new Error("Wave retirement owner was fenced by a recovery lock.");
    return { normal, recovery: null };
  }
  if (!recovery || recovery.sha256 !== owner.recovery.sha256
      || recovery.value.lockId !== owner.recovery.value.lockId
      || recovery.value.retirementLockSha256 !== normal.sha256) {
    throw new Error("Wave retirement recovery ownership changed.");
  }
  return { normal, recovery };
}

function waveRetirementReceiptPaths(context) {
  const waveRoot = path.posix.dirname(context.ledgerFile);
  return {
    finalFile: `${waveRoot}/wave-retirement-receipt.json`,
    taskFile: (taskId) => `${waveRoot}/tasks/${taskId}/retirement-receipt.json`,
  };
}

function validateWaveTaskRetirementReceipt(receipt, context, task, retirementId) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).length !== WAVE_TASK_RETIREMENT_RECEIPT_FIELDS.length
      || WAVE_TASK_RETIREMENT_RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))
      || receipt.schemaVersion !== "1.0"
      || !UUID_PATTERN.test(receipt.retirementId)
      || receipt.storyId !== context.state.storyId
      || receipt.runId !== context.state.runtime.runId
      || receipt.waveId !== context.ledger.waveId
      || receipt.waveIndex !== context.ledger.waveIndex
      || (retirementId && receipt.retirementId !== retirementId)
      || receipt.taskId !== task.taskId
      || receipt.branch !== task.plan.branch
      || receipt.worktreePath !== task.plan.worktreePath
      || receipt.baseCommit !== task.plan.baseCommit
      || receipt.resultFile !== task.resultFile
      || receipt.resultSha256 !== task.resultSha256
      || receipt.executionReceiptFile !== task.executionReceiptFile
      || receipt.executionReceiptSha256 !== task.executionReceiptSha256
      || receipt.integrationReceiptFile !== task.integrationReceiptFile
      || receipt.integrationReceiptSha256 !== task.integrationReceiptSha256
      || JSON.stringify(receipt.appliedFiles) !== JSON.stringify(task.candidates)
      || !isRfc3339DateTime(receipt.retiredAt)
      || typeof receipt.recovered !== "boolean") {
    throw new Error(`Wave task retirement receipt does not match stable evidence: ${task.taskId}`);
  }
  return receipt;
}

async function loadWaveRetirementReceiptPrefix(root, context, evidence, retirementId = null) {
  const paths = waveRetirementReceiptPaths(context);
  const receipts = [];
  let gap = false;
  let stableRetirementId = retirementId;
  for (const task of evidence.tasks) {
    const relative = paths.taskFile(task.taskId);
    const location = resolveInsideRoot(root, relative, "Wave task retirement receipt");
    const receipt = await readJsonOptional(location.fullPath, "Wave task retirement receipt");
    if (!receipt) {
      gap = true;
      continue;
    }
    if (gap) throw new Error("Wave task retirement receipts do not form a stable ordered prefix.");
    stableRetirementId ??= receipt.retirementId;
    validateWaveTaskRetirementReceipt(receipt, context, task, stableRetirementId);
    const snapshot = await readRegularBuffer(location.fullPath, "Wave task retirement receipt");
    const bound = { relative: location.relative, ...snapshot };
    addWaveRetirementAllowed(evidence.allowed, bound);
    receipts.push({ task, receipt, evidence: bound });
  }
  return { receipts, nextIndex: receipts.length, retirementId: stableRetirementId };
}

function expectedWaveRetirementReceipt(context, evidence, prefix, retirementId, retiredAt, recovered) {
  return {
    schemaVersion: "1.0",
    storyId: context.state.storyId,
    runId: context.state.runtime.runId,
    waveId: context.ledger.waveId,
    waveIndex: context.ledger.waveIndex,
    retirementId,
    statePhase: context.state.phase,
    stateRuntimeStatus: context.state.runtime.status,
    stateFile: context.stateFile,
    stateSha256: evidence.state.sha256,
    stateEventsFile: evidence.stateEvents.relative,
    stateEventsSha256: evidence.stateEvents.sha256,
    stateBackupFile: evidence.stateBackup.relative,
    stateBackupSha256: evidence.stateBackup.sha256,
    taskDagFile: context.plan.taskDagFile,
    taskDagSha256: context.plan.taskDagSha256,
    wavePlanFile: context.outputs.planFile,
    wavePlanSha256: context.planSha256,
    creationReceiptFile: context.outputs.receiptFile,
    creationReceiptSha256: context.creationReceiptSha256,
    integrationManifestFile: context.manifestFile,
    integrationManifestSha256: context.ledger.integrationManifestSha256,
    waveLedgerFile: context.ledgerFile,
    waveLedgerSha256: context.ledgerSha256,
    waveReceiptFile: context.waveReceiptFile,
    waveReceiptSha256: context.waveReceiptSha256,
    implementationTaskFile: context.implementation.taskFile,
    implementationTaskSha256: evidence.implementationTask.sha256,
    implementationResultFile: context.implementation.resultFile,
    implementationResultSha256: evidence.implementationResult.sha256,
    implementationCheckpointFile: context.implementation.checkpointFile,
    implementationCheckpointSha256: evidence.implementationCheckpoint.sha256,
    implementationNotesFile: context.implementation.notesFile,
    implementationNotesSha256: evidence.implementationNotes.sha256,
    tasks: prefix.receipts.map(({ task, evidence: receiptEvidence }) => ({
      taskId: task.taskId,
      retirementReceiptFile: receiptEvidence.relative,
      retirementReceiptSha256: receiptEvidence.sha256,
    })),
    appliedFiles: context.manifest.candidateFiles.map((file) => ({ ...file })),
    retiredAt,
    recovered,
  };
}

function validateWaveRetirementReceipt(receipt, expected) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).length !== WAVE_RETIREMENT_RECEIPT_FIELDS.length
      || WAVE_RETIREMENT_RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))
      || receipt.schemaVersion !== "1.0"
      || !UUID_PATTERN.test(receipt.retirementId)
      || !isRfc3339DateTime(receipt.retiredAt)
      || typeof receipt.recovered !== "boolean") {
    throw new Error("Wave retirement receipt has an invalid structure.");
  }
  for (const field of WAVE_RETIREMENT_RECEIPT_FIELDS) {
    if (field === "retiredAt" || field === "recovered") continue;
    if (JSON.stringify(receipt[field]) !== JSON.stringify(expected[field])) {
      throw new Error("Wave retirement receipt no longer matches finalized Wave evidence.");
    }
  }
  return receipt;
}

async function inspectExistingWaveRetirementReceipt(root, context, evidence, prefix) {
  const paths = waveRetirementReceiptPaths(context);
  const location = resolveInsideRoot(root, paths.finalFile, "Wave retirement receipt");
  const receipt = await readJsonOptional(location.fullPath, "Wave retirement receipt");
  if (!receipt) return null;
  if (prefix.receipts.length !== evidence.tasks.length || !prefix.retirementId) {
    throw new Error("Wave retirement receipt requires a complete stable task receipt prefix.");
  }
  const expected = expectedWaveRetirementReceipt(
    context,
    evidence,
    prefix,
    prefix.retirementId,
    receipt.retiredAt,
    receipt.recovered,
  );
  validateWaveRetirementReceipt(receipt, expected);
  const snapshot = await readRegularBuffer(location.fullPath, "Wave retirement receipt");
  addWaveRetirementAllowed(evidence.allowed, { relative: location.relative, ...snapshot });
  return { receipt, file: location.relative, evidence: snapshot };
}

async function assertWaveRetirementTaskAbsent(root, task, options) {
  const observed = await inspectRetirementWorktree(root, task.plan, options);
  if (observed.state !== "absent") throw new Error(`Retired Wave task is still registered: ${task.taskId}`);
  const info = await lstat(observed.targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (info) throw new Error(`Retired Wave task directory still exists: ${task.taskId}`);
}

async function releaseWaveRetirementOwner(root, context, owner, options = {}) {
  await assertWaveRetirementOwner(root, context, owner);
  if (owner.mode === "recovery") {
    if (options.beforeWaveRetirementLockRelease) {
      await options.beforeWaveRetirementLockRelease({ ownerMode: owner.mode, lockMode: "recovery" });
    }
    await assertWaveRetirementOwner(root, context, owner);
    await unlink(owner.paths.recoveryLockPath);
    const normal = await inspectWaveRetirementLock(root, context, "retire", owner.paths);
    if (!normal || normal.sha256 !== owner.normal.sha256
        || normal.value.lockId !== owner.normal.value.lockId) {
      throw new Error("Wave retirement ownership changed before normal lock release.");
    }
  }
  if (options.beforeWaveRetirementLockRelease) {
    await options.beforeWaveRetirementLockRelease({ ownerMode: owner.mode, lockMode: "retire" });
  }
  const recovery = await inspectWaveRetirementLock(root, context, "recovery", owner.paths);
  if (recovery) throw new Error("Wave retirement recovery lock was replaced before release.");
  const normal = await inspectWaveRetirementLock(root, context, "retire", owner.paths);
  if (!normal || normal.sha256 !== owner.normal.sha256
      || normal.value.lockId !== owner.normal.value.lockId) {
    throw new Error("Wave retirement ownership changed before release.");
  }
  await unlink(owner.paths.lockPath);
}

async function waveRetire(root, options) {
  assertWaveRetireInputs(options);
  let context = await loadWaveRetirementContext(root, options);
  let evidence = await collectWaveRetirementEvidence(root, context);
  await assertWaveRetirementConflictsAbsent(root, context);
  let prefix = await loadWaveRetirementReceiptPrefix(root, context, evidence);
  const existingFinal = await inspectExistingWaveRetirementReceipt(root, context, evidence, prefix);
  const existingPaths = waveRetirementPaths(root, context);
  const existingNormal = await inspectWaveRetirementLock(root, context, "retire", existingPaths);
  const existingRecovery = await inspectWaveRetirementLock(root, context, "recovery", existingPaths);
  if (existingFinal) {
    if (existingNormal || existingRecovery) {
      if (options.confirmWaveRetireLockRecovery !== true) {
        throw new Error("Completed Wave retirement still has owner locks; explicit recovery is required.");
      }
      assertExpectedWaveRetirementLock(
        existingNormal,
        options.expectedRetirementLockSha256,
        "ExpectedRetirementLockSha256",
      );
      assertExpectedWaveRetirementLock(
        existingRecovery,
        options.expectedRetirementRecoveryLockSha256,
        "ExpectedRetirementRecoveryLockSha256",
      );
      await addWaveRetirementLockEvidence(root, evidence, existingNormal);
      await addWaveRetirementLockEvidence(root, evidence, existingRecovery);
      await assertWaveRetirementMainIntegrity(root, context, evidence, options);
      for (const task of evidence.tasks) await assertWaveRetirementTaskAbsent(root, task, options);
      const owner = await acquireWaveRetirementOwner(root, context, options);
      if (options.afterWaveRetirementOwnerAcquired) {
        await options.afterWaveRetirementOwnerAcquired({ context, evidence, owner });
      }
      await assertWaveRetirementOwner(root, context, owner);
      await releaseWaveRetirementOwner(root, context, owner, options);
    } else {
      await assertWaveRetirementMainIntegrity(root, context, evidence, options);
      for (const task of evidence.tasks) await assertWaveRetirementTaskAbsent(root, task, options);
    }
    return {
      command: "wave-retire",
      reused: true,
      receiptFile: existingFinal.file,
      receipt: existingFinal.receipt,
    };
  }
  if (options.confirmWaveRetireLockRecovery === true) {
    assertExpectedWaveRetirementLock(
      existingNormal,
      options.expectedRetirementLockSha256,
      "ExpectedRetirementLockSha256",
    );
    assertExpectedWaveRetirementLock(
      existingRecovery,
      options.expectedRetirementRecoveryLockSha256,
      "ExpectedRetirementRecoveryLockSha256",
    );
    await addWaveRetirementLockEvidence(root, evidence, existingNormal);
    await addWaveRetirementLockEvidence(root, evidence, existingRecovery);
  } else if (existingNormal || existingRecovery) {
    throw new Error("Wave retirement lock already exists; inspect it before retrying.");
  }
  await assertWaveRetirementMainIntegrity(root, context, evidence, options);
  for (let index = 0; index < evidence.tasks.length; index += 1) {
    const task = evidence.tasks[index];
    const observed = await inspectRetirementWorktree(root, task.plan, options);
    if (index < prefix.nextIndex) {
      if (observed.state !== "absent") {
        throw new Error(`Stable Wave retirement receipt requires an absent Worktree: ${task.taskId}`);
      }
      continue;
    }
    if (observed.state === "absent") {
      if (index !== prefix.nextIndex || !existingNormal) {
        throw new Error(`Wave task '${task.taskId}' is absent without recoverable retirement ownership.`);
      }
      continue;
    }
    await assertWaveRetirementWorktreeIntegrity(root, task, options);
  }
  if (options.afterWaveRetirePreflight) await options.afterWaveRetirePreflight({ context, evidence });
  const owner = await acquireWaveRetirementOwner(root, context, options);
  if (prefix.retirementId && prefix.retirementId !== owner.normal.value.retirementId) {
    throw new Error("Stable Wave retirement receipt prefix belongs to a different retirement owner.");
  }
  if (options.afterWaveRetirementOwnerAcquired) {
    await options.afterWaveRetirementOwnerAcquired({ context, evidence, owner });
  }
  await assertWaveRetirementOwner(root, context, owner);
  context = await loadWaveRetirementContext(root, options);
  evidence = await collectWaveRetirementEvidence(root, context);
  const owned = await assertWaveRetirementOwner(root, context, owner);
  await addWaveRetirementLockEvidence(root, evidence, owned.normal);
  await addWaveRetirementLockEvidence(root, evidence, owned.recovery);
  prefix = await loadWaveRetirementReceiptPrefix(
    root,
    context,
    evidence,
    owner.normal.value.retirementId,
  );
  await assertWaveRetirementConflictsAbsent(root, context);
  await assertWaveRetirementMainIntegrity(root, context, evidence, options);
  for (let index = 0; index < evidence.tasks.length; index += 1) {
    const task = evidence.tasks[index];
    const observed = await inspectRetirementWorktree(root, task.plan, options);
    if (index < prefix.nextIndex) {
      if (observed.state !== "absent") {
        throw new Error(`Stable Wave retirement receipt requires an absent Worktree: ${task.taskId}`);
      }
      continue;
    }
    if (observed.state === "created") await assertWaveRetirementWorktreeIntegrity(root, task, options);
    else if (index !== prefix.nextIndex) {
      throw new Error(`Wave retirement suffix contains an out-of-order absent Worktree: ${task.taskId}`);
    }
  }
  await assertWaveRetirementOwner(root, context, owner);

  const receiptPaths = waveRetirementReceiptPaths(context);
  for (let index = prefix.nextIndex; index < evidence.tasks.length; index += 1) {
    await assertWaveRetirementOwner(root, context, owner);
    await assertWaveRetirementConflictsAbsent(root, context);
    context = await loadWaveRetirementContext(root, options);
    evidence = await collectWaveRetirementEvidence(root, context);
    const currentOwner = await assertWaveRetirementOwner(root, context, owner);
    await addWaveRetirementLockEvidence(root, evidence, currentOwner.normal);
    await addWaveRetirementLockEvidence(root, evidence, currentOwner.recovery);
    prefix = await loadWaveRetirementReceiptPrefix(
      root,
      context,
      evidence,
      owner.normal.value.retirementId,
    );
    if (prefix.nextIndex !== index) {
      throw new Error("Wave task retirement receipt prefix changed during ordered retirement.");
    }
    await assertWaveRetirementMainIntegrity(root, context, evidence, options);
    for (let suffixIndex = index; suffixIndex < evidence.tasks.length; suffixIndex += 1) {
      const suffixTask = evidence.tasks[suffixIndex];
      const suffixObserved = await inspectRetirementWorktree(root, suffixTask.plan, options);
      if (suffixIndex === index && suffixObserved.state === "absent") continue;
      if (suffixObserved.state !== "created") {
        throw new Error(`Wave retirement suffix is not stable: ${suffixTask.taskId}`);
      }
      await assertWaveRetirementWorktreeIntegrity(root, suffixTask, options);
    }

    const task = evidence.tasks[index];
    const observed = await inspectRetirementWorktree(root, task.plan, options);
    const recovered = observed.state === "absent";
    if (!recovered) {
      await assertWaveRetirementOwner(root, context, owner);
      try {
        await executeGit(root, ["worktree", "remove", "--force", observed.targetPath], options);
      } catch (error) {
        const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
        throw new Error(`git worktree remove failed for Wave task '${task.taskId}': ${diagnostic}`);
      }
      if (options.afterWaveRetireRemove) {
        await options.afterWaveRetireRemove({ taskId: task.taskId, targetPath: observed.targetPath });
      }
    }
    await assertWaveRetirementOwner(root, context, owner);
    await assertWaveRetirementTaskAbsent(root, task, options);
    const receipt = {
      schemaVersion: "1.0",
      storyId: context.state.storyId,
      runId: context.state.runtime.runId,
      waveId: context.ledger.waveId,
      waveIndex: context.ledger.waveIndex,
      retirementId: owner.normal.value.retirementId,
      taskId: task.taskId,
      branch: task.plan.branch,
      worktreePath: task.plan.worktreePath,
      baseCommit: task.plan.baseCommit,
      resultFile: task.resultFile,
      resultSha256: task.resultSha256,
      executionReceiptFile: task.executionReceiptFile,
      executionReceiptSha256: task.executionReceiptSha256,
      integrationReceiptFile: task.integrationReceiptFile,
      integrationReceiptSha256: task.integrationReceiptSha256,
      appliedFiles: task.candidates.map((file) => ({ ...file })),
      retiredAt: (options.now ?? (() => new Date().toISOString()))(),
      recovered,
    };
    validateWaveTaskRetirementReceipt(receipt, context, task, owner.normal.value.retirementId);
    const receiptFile = receiptPaths.taskFile(task.taskId);
    if (options.beforeWaveTaskRetirementReceiptWrite) {
      await options.beforeWaveTaskRetirementReceiptWrite({ taskId: task.taskId, receiptFile, receipt });
    }
    await assertWaveRetirementOwner(root, context, owner);
    await writeAtomicJson(
      resolveInsideRoot(root, receiptFile, "Wave task retirement receipt").fullPath,
      receipt,
    );
    if (options.afterWaveTaskRetirementReceipt) {
      await options.afterWaveTaskRetirementReceipt({ taskId: task.taskId, receiptFile, receipt });
    }
  }

  await assertWaveRetirementOwner(root, context, owner);
  context = await loadWaveRetirementContext(root, options);
  evidence = await collectWaveRetirementEvidence(root, context);
  const finalOwner = await assertWaveRetirementOwner(root, context, owner);
  await addWaveRetirementLockEvidence(root, evidence, finalOwner.normal);
  await addWaveRetirementLockEvidence(root, evidence, finalOwner.recovery);
  prefix = await loadWaveRetirementReceiptPrefix(
    root,
    context,
    evidence,
    owner.normal.value.retirementId,
  );
  if (prefix.nextIndex !== evidence.tasks.length) {
    throw new Error("Wave retirement cannot finalize an incomplete task receipt prefix.");
  }
  await assertWaveRetirementMainIntegrity(root, context, evidence, options);
  for (const task of evidence.tasks) await assertWaveRetirementTaskAbsent(root, task, options);
  const retiredAt = (options.now ?? (() => new Date().toISOString()))();
  const finalReceipt = expectedWaveRetirementReceipt(
    context,
    evidence,
    prefix,
    owner.normal.value.retirementId,
    retiredAt,
    owner.mode === "recovery" || prefix.receipts.some(({ receipt }) => receipt.recovered),
  );
  validateWaveRetirementReceipt(finalReceipt, finalReceipt);
  if (options.beforeWaveRetirementReceiptWrite) {
    await options.beforeWaveRetirementReceiptWrite({ receiptFile: receiptPaths.finalFile, receipt: finalReceipt });
  }
  await assertWaveRetirementOwner(root, context, owner);
  await writeAtomicJson(
    resolveInsideRoot(root, receiptPaths.finalFile, "Wave retirement receipt").fullPath,
    finalReceipt,
  );
  if (options.afterWaveRetirementReceipt) {
    await options.afterWaveRetirementReceipt({ receiptFile: receiptPaths.finalFile, receipt: finalReceipt });
  }
  await releaseWaveRetirementOwner(root, context, owner, options);
  return {
    command: "wave-retire",
    reused: false,
    receiptFile: receiptPaths.finalFile,
    receipt: finalReceipt,
  };
}

async function create(root, options) {
  if (options.confirmCreate !== true) throw new Error("Worktree creation requires explicit approval and ConfirmCreate.");
  const context = await loadContext(root, options);
  const worktreePlan = await validateStoredPlan(root, await readJsonFile(context.planPath, "Worktree plan"), context.state, options.taskId);
  await acquireLock(context.lockPath, options);
  try {
    await assertRetirementLockAbsent(context.lockPath.replace(/create\.lock$/, "retire.lock"));
    const current = await inspectStatus(root, worktreePlan, context.planPath, context.statusPath, options);
    if (current.state === "created") {
      return { command: "create", reused: true, planFile: context.planFile, statusFile: context.statusFile, plan: worktreePlan, status: current };
    }
    if (current.state === "inconsistent") throw new Error(`Worktree status is inconsistent: ${current.details.join(" ")}`);

    const targetPath = resolveInsideRoot(root, worktreePlan.worktreePath, "Worktree path").fullPath;
    await assertSafeTargetParents(root, targetPath);
    await assertNoOtherStoryWorktree(root, worktreePlan, options);
    await assertMainRepositoryClean(root, context, worktreePlan, options);
    const base = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${worktreePlan.baseRef}^{commit}`], options);
    if (!base.ok || base.stdout.trim() !== worktreePlan.baseCommit) {
      throw new Error(`Planned base ref '${worktreePlan.baseRef}' has moved or is unavailable.`);
    }
    const branchRef = `refs/heads/${worktreePlan.branch}`;
    const branch = await inspectGitRef(root, branchRef, options);
    const resumedBranch = branch.exists;
    if (resumedBranch && branch.commit !== worktreePlan.baseCommit) {
      throw new Error("Target Worktree branch no longer points to the planned base commit.");
    }
    const args = resumedBranch
      ? ["worktree", "add", targetPath, worktreePlan.branch]
      : ["worktree", "add", "-b", worktreePlan.branch, targetPath, worktreePlan.baseCommit];
    try {
      await executeGit(root, args, options);
    } catch (error) {
      const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
      throw new Error(`git worktree add failed: ${diagnostic}`);
    }
    if (options.afterCreate) await options.afterCreate();
    const createdStatus = await inspectStatus(root, worktreePlan, context.planPath, context.statusPath, options);
    if (createdStatus.state !== "created") throw new Error("Git created a Worktree that does not match the plan.");
    if (resumedBranch) {
      createdStatus.details.push("Created Worktree from an existing matching branch.");
      await writeAtomicJson(context.statusPath, createdStatus);
    }
    return { command: "create", reused: false, planFile: context.planFile, statusFile: context.statusFile, plan: worktreePlan, status: createdStatus };
  } finally {
    await unlink(context.lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function batchPlan(root, options) {
  assertBatchCommandInputs(options);
  await assertRepositoryRoot(root, options);
  const { registerBatchWorktreePlan } = await import("./batch-runtime.mjs");
  const registered = await registerBatchWorktreePlan({ root, stateFile: options.stateFile, now: options.now });
  const context = await loadBatchContext(root, options);
  if (context.batchFile !== registered.batchFile || context.planSha256 !== registered.planSha256) {
    throw new Error("Serial batch Worktree plan changed after registration.");
  }
  const current = await inspectBatchStatus(root, context.plan, context.planPath, context.statusPath, context.planSha256, options);
  return {
    command: "batch-plan",
    reused: registered.reused,
    recovered: registered.recovered,
    batchFile: context.batchFile,
    planFile: context.planFile,
    statusFile: context.statusFile,
    plan: context.plan,
    status: current,
  };
}

async function batchStatus(root, options) {
  const context = await loadBatchContext(root, options);
  const current = await inspectBatchStatus(root, context.plan, context.planPath, context.statusPath, context.planSha256, options);
  return {
    command: "batch-status",
    batchFile: context.batchFile,
    planFile: context.planFile,
    statusFile: context.statusFile,
    plan: context.plan,
    status: current,
  };
}

async function batchCreate(root, options) {
  assertBatchCommandInputs(options);
  if (options.confirmCreate !== true) throw new Error("Batch Worktree creation requires explicit approval and ConfirmCreate.");
  const initial = await loadBatchContext(root, options);
  await acquireLock(initial.lockPath, options);
  try {
    const context = await loadBatchContext(root, options);
    const current = await inspectBatchStatus(root, context.plan, context.planPath, context.statusPath, context.planSha256, options);
    if (current.state === "created") {
      await assertNoOtherStoryWorktree(root, context.plan, options);
      return {
        command: "batch-create",
        reused: true,
        batchFile: context.batchFile,
        planFile: context.planFile,
        statusFile: context.statusFile,
        plan: context.plan,
        status: current,
      };
    }
    if (current.state === "inconsistent") throw new Error(`Batch Worktree status is inconsistent: ${current.details.join(" ")}`);

    const targetPath = resolveInsideRoot(root, context.plan.worktreePath, "Serial batch Worktree path").fullPath;
    await assertSafeTargetParents(root, targetPath);
    await assertNoOtherStoryWorktree(root, context.plan, options);
    await assertMainRepositoryClean(root, context, context.plan, options);
    const base = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${context.plan.baseRef}^{commit}`], options);
    if (!base.ok || base.stdout.trim() !== context.plan.baseCommit) {
      throw new Error(`Planned base ref '${context.plan.baseRef}' has moved or is unavailable.`);
    }
    const branchRef = `refs/heads/${context.plan.branch}`;
    const branch = await inspectGitRef(root, branchRef, options);
    if (branch.exists && branch.commit !== context.plan.baseCommit) {
      throw new Error("Target batch Worktree branch no longer points to the planned base commit.");
    }
    const args = branch.exists
      ? ["worktree", "add", targetPath, context.plan.branch]
      : ["worktree", "add", "-b", context.plan.branch, targetPath, context.plan.baseCommit];
    try {
      await executeGit(root, args, options);
    } catch (error) {
      const diagnostic = String(error?.stderr ?? error?.message ?? "unknown Git error").trim();
      throw new Error(`git worktree add failed: ${diagnostic}`);
    }
    if (options.afterCreate) await options.afterCreate();
    const createdStatus = await inspectBatchStatus(root, context.plan, context.planPath, context.statusPath, context.planSha256, options);
    if (createdStatus.state !== "created") throw new Error("Git created a batch Worktree that does not match the plan.");
    return {
      command: "batch-create",
      reused: false,
      batchFile: context.batchFile,
      planFile: context.planFile,
      statusFile: context.statusFile,
      plan: context.plan,
      status: createdStatus,
    };
  } finally {
    await unlink(initial.lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function runWorktreeCommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.command === "wave-plan") return wavePlan(root, options);
  if (options.command === "wave-status") return waveStatus(root, options);
  if (options.command === "wave-create") return waveCreate(root, options);
  if (options.command === "wave-retire") return waveRetire(root, options);
  if (options.command === "plan") return plan(root, options);
  if (options.command === "status") return status(root, options);
  if (options.command === "create") return create(root, options);
  if (options.command === "retire") return retire(root, options);
  if (options.command === "batch-plan") return batchPlan(root, options);
  if (options.command === "batch-status") return batchStatus(root, options);
  if (options.command === "batch-create") return batchCreate(root, options);
  if (options.command === "batch-retire") return batchRetire(root, options);
  throw new Error(`Unsupported worktree command: ${options.command ?? "(missing)"}`);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = {
    "--root": "root",
    "--state-file": "stateFile",
    "--task-dag-file": "taskDagFile",
    "--task-id": "taskId",
    "--wave-index": "waveIndex",
    "--base-ref": "baseRef",
    "--expected-plan-sha256": "expectedPlanSha256",
    "--expected-create-lock-sha256": "expectedCreateLockSha256",
    "--expected-recovery-lock-sha256": "expectedRecoveryLockSha256",
    "--expected-wave-ledger-sha256": "expectedWaveLedgerSha256",
    "--expected-wave-receipt-sha256": "expectedWaveReceiptSha256",
    "--expected-retirement-lock-sha256": "expectedRetirementLockSha256",
    "--expected-retirement-recovery-lock-sha256": "expectedRetirementRecoveryLockSha256",
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    if (token === "--confirm-create") { options.confirmCreate = true; continue; }
    if (token === "--confirm-retire") { options.confirmRetire = true; continue; }
    if (token === "--confirm-wave-create") { options.confirmWaveCreate = true; continue; }
    if (token === "--confirm-wave-lock-recovery") {
      options.confirmWaveLockRecovery = true;
      continue;
    }
    if (token === "--confirm-wave-retire-lock-recovery") {
      options.confirmWaveRetireLockRecovery = true;
      continue;
    }
    const key = keyMap[token];
    if (!key || index + 1 >= tokens.length) throw new Error(`Unsupported or incomplete argument: ${token}`);
    options[key] = tokens[++index];
  }
  if (options.waveIndex !== undefined) options.waveIndex = Number(options.waveIndex);
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const result = await runWorktreeCommand(options);
    const scopeId = result.plan?.taskId ?? result.plan?.batchId ?? result.plan?.wave
      ?? result.receipt?.taskId ?? result.receipt?.batchId ?? result.receipt?.waveId;
    console.log(options.json ? JSON.stringify(result) : `Worktree command '${result.command}' completed for ${scopeId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(options.json ? JSON.stringify({ error: message }) : `Worktree command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
