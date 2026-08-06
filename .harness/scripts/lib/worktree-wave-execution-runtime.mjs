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
const WAVE_STATUSES = new Set([
  "prepared",
  "executing",
  "partial",
  "ready-for-integration",
  "freezing",
  "integration-frozen",
  "integrating",
  "partial-integration",
  "integrated",
  "finalized",
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
const PREPARATION_LOCK_FIELDS = [
  "schemaVersion",
  "lockId",
  "freezeId",
  "storyId",
  "runId",
  "waveId",
  "ledgerSha256",
  "creationReceiptSha256",
  "pid",
  "createdAt",
];
const INTEGRATION_MANIFEST_FIELDS = [
  "schemaVersion",
  "freezeId",
  "storyId",
  "runId",
  "phase",
  "waveId",
  "waveIndex",
  "preparedRevision",
  "taskDagFile",
  "taskDagSha256",
  "wavePlanFile",
  "wavePlanSha256",
  "creationReceiptFile",
  "creationReceiptSha256",
  "baseCommit",
  "mainHeadCommit",
  "businessStatusSnapshot",
  "tasks",
  "candidateFiles",
  "createdAt",
];
const MANIFEST_TASK_FIELDS = [
  "taskId",
  "dispatchId",
  "taskFile",
  "taskSha256",
  "checkpointFile",
  "checkpointSha256",
  "attemptId",
  "resultFile",
  "resultSha256",
  "executionReceiptFile",
  "executionReceiptSha256",
  "worktreePath",
  "headCommit",
  "predictedFiles",
];
const MANIFEST_CANDIDATE_FIELDS = [
  "taskId",
  "path",
  "type",
  "sha256",
  "bytes",
];
const INTEGRATION_LOCK_FIELDS = [
  "schemaVersion",
  "lockId",
  "freezeId",
  "manifestSha256",
  "storyId",
  "runId",
  "waveId",
  "pid",
  "createdAt",
];
const INTEGRATION_RECOVERY_LOCK_FIELDS = [
  ...INTEGRATION_LOCK_FIELDS,
  "integrationLockSha256",
];
const INTEGRATION_RECEIPT_FIELDS = [
  "schemaVersion",
  "storyId",
  "runId",
  "phase",
  "waveId",
  "waveIndex",
  "taskId",
  "dispatchId",
  "manifestSha256",
  "baseCommit",
  "appliedFiles",
  "completedAt",
];
const WAVE_RECEIPT_FIELDS = [
  "schemaVersion",
  "storyId",
  "runId",
  "phase",
  "waveId",
  "waveIndex",
  "preparedRevision",
  "integrationManifestFile",
  "integrationManifestSha256",
  "tasks",
  "phaseArtifacts",
  "completedAt",
];
const WAVE_RECEIPT_TASK_FIELDS = [
  "taskId",
  "dispatchId",
  "resultFile",
  "resultSha256",
  "executionReceiptFile",
  "executionReceiptSha256",
  "integrationReceiptFile",
  "integrationReceiptSha256",
];
const WAVE_PHASE_ARTIFACT_FIELDS = [
  "taskFile",
  "taskSha256",
  "resultFile",
  "resultSha256",
  "notesFile",
  "notesSha256",
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

async function writeAtomicBuffer(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${createRandomUUID()}`;
  try {
    await writeFile(temporary, value);
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

function integrationPaths(ledger) {
  const root = `.harness/runs/${ledger.runId}/waves/${ledger.waveId}`;
  return {
    manifestFile: `${root}/integration-manifest.json`,
    preparationLockFile: `${root}/manifest-preparation.lock`,
    integrationLockFile: `${root}/integration.lock`,
    integrationRecoveryLockFile: `${root}/integration-recovery.lock`,
    waveReceiptFile: `${root}/wave-receipt.json`,
  };
}

function token(prefix, randomUUID) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function pathKey(filePath) {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

async function gitOutput(root, args) {
  const result = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    shell: false,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(result.stdout ?? "");
}

async function optionalFileSnapshot(root, relativeFile, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  const info = await lstat(location.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return { path: location.relative, exists: false, sha256: null, bytes: null };
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return {
    path: location.relative,
    exists: true,
    sha256: await fileSha256(root, location.relative, label),
    bytes: info.size,
  };
}

function assertUniqueCandidatePaths(candidates) {
  const keys = new Map();
  for (const candidate of candidates) {
    const key = pathKey(candidate.path);
    if (keys.has(key)) {
      throw new Error(`Wave integration candidates contain a duplicate path: ${candidate.path}`);
    }
    for (const [existing, existingPath] of keys) {
      if (key.startsWith(`${existing}/`) || existing.startsWith(`${key}/`)) {
        throw new Error(
          `Wave integration candidates contain a parent/child path conflict: ${existingPath} and ${candidate.path}`,
        );
      }
    }
    keys.set(key, candidate.path);
  }
}

function validatePreparationLock(lock, ledger) {
  assertExactFields(lock, PREPARATION_LOCK_FIELDS, "Wave manifest preparation lock");
  if (lock.schemaVersion !== "1.0"
      || typeof lock.lockId !== "string" || !lock.lockId
      || typeof lock.freezeId !== "string" || !lock.freezeId
      || lock.storyId !== ledger.storyId
      || lock.runId !== ledger.runId
      || lock.waveId !== ledger.waveId
      || !SHA256_PATTERN.test(lock.ledgerSha256)
      || lock.creationReceiptSha256 !== ledger.creationReceiptSha256
      || !Number.isInteger(lock.pid)
      || typeof lock.createdAt !== "string" || Number.isNaN(Date.parse(lock.createdAt))) {
    throw new Error("Wave manifest preparation lock does not match the current ledger.");
  }
  return lock;
}

async function assertPreparationOwner(root, ledger, lock, expectedLockSha256) {
  const paths = integrationPaths(ledger);
  const currentSha256 = await fileSha256(
    root,
    paths.preparationLockFile,
    "Wave manifest preparation lock",
  );
  if (expectedLockSha256 && currentSha256 !== expectedLockSha256) {
    throw new Error("Wave manifest preparation lock hash changed.");
  }
  const current = validatePreparationLock(
    await readJsonFile(
      resolveInsideRoot(root, paths.preparationLockFile, "Wave manifest preparation lock").fullPath,
      "Wave manifest preparation lock",
    ),
    ledger,
  );
  if (current.lockId !== lock.lockId || current.freezeId !== lock.freezeId) {
    throw new Error("Wave manifest preparation owner changed.");
  }
  return { lock: current, lockSha256: currentSha256, paths };
}

function validateIntegrationManifest(manifest, ledger) {
  assertExactFields(manifest, INTEGRATION_MANIFEST_FIELDS, "Wave integration manifest");
  if (manifest.schemaVersion !== "1.0"
      || typeof manifest.freezeId !== "string" || !manifest.freezeId
      || manifest.storyId !== ledger.storyId
      || manifest.runId !== ledger.runId
      || manifest.phase !== ledger.phase
      || manifest.waveId !== ledger.waveId
      || manifest.waveIndex !== ledger.waveIndex
      || manifest.preparedRevision !== ledger.preparedRevision
      || manifest.taskDagFile !== ledger.taskDagFile
      || manifest.taskDagSha256 !== ledger.taskDagSha256
      || manifest.wavePlanFile !== ledger.wavePlanFile
      || manifest.wavePlanSha256 !== ledger.wavePlanSha256
      || manifest.creationReceiptFile !== ledger.creationReceiptFile
      || manifest.creationReceiptSha256 !== ledger.creationReceiptSha256
      || manifest.baseCommit !== ledger.baseCommit
      || typeof manifest.mainHeadCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(manifest.mainHeadCommit)
      || typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))
      || !manifest.businessStatusSnapshot || typeof manifest.businessStatusSnapshot !== "object"
      || Array.isArray(manifest.businessStatusSnapshot)
      || !Array.isArray(manifest.tasks) || manifest.tasks.length !== ledger.tasks.length
      || !Array.isArray(manifest.candidateFiles) || !manifest.candidateFiles.length) {
    throw new Error("Wave integration manifest identity is invalid.");
  }
  for (let index = 0; index < manifest.tasks.length; index += 1) {
    const task = manifest.tasks[index];
    const ledgerTask = ledger.tasks[index];
    assertExactFields(task, MANIFEST_TASK_FIELDS, "Wave integration manifest task");
    if (task.taskId !== ledgerTask.taskId
        || task.dispatchId !== ledgerTask.dispatchId
        || task.taskFile !== ledgerTask.taskFile
        || task.taskSha256 !== ledgerTask.taskSha256
        || task.checkpointFile !== ledgerTask.checkpointFile
        || task.checkpointSha256 !== ledgerTask.checkpointSha256
        || task.attemptId !== ledgerTask.currentAttemptId
        || task.executionReceiptFile !== ledgerTask.executionReceiptFile
        || task.executionReceiptSha256 !== ledgerTask.executionReceiptSha256
        || typeof task.resultFile !== "string" || !task.resultFile
        || !SHA256_PATTERN.test(task.resultSha256)
        || typeof task.worktreePath !== "string" || !task.worktreePath
        || task.headCommit !== ledger.baseCommit
        || !Array.isArray(task.predictedFiles)
        || task.predictedFiles.some((item) => typeof item !== "string" || !item)) {
      throw new Error("Wave integration manifest task does not match the current ledger.");
    }
  }
  for (const candidate of manifest.candidateFiles) {
    assertExactFields(candidate, MANIFEST_CANDIDATE_FIELDS, "Wave integration manifest candidate");
    if (!manifest.tasks.some((task) => task.taskId === candidate.taskId)
        || typeof candidate.path !== "string" || !candidate.path
        || !["backend", "frontend", "phase-output"].includes(candidate.type)
        || !SHA256_PATTERN.test(candidate.sha256)
        || !Number.isInteger(candidate.bytes) || candidate.bytes < 0) {
      throw new Error("Wave integration manifest candidate is invalid.");
    }
  }
  assertUniqueCandidatePaths(manifest.candidateFiles);
  return manifest;
}

async function assertFreezeStateAndOwner(root, options, ledger) {
  if (typeof options.stateFile !== "string" || !options.stateFile) {
    throw new Error("Wave integration freeze requires stateFile.");
  }
  const state = await readJsonFile(
    resolveInsideRoot(root, options.stateFile, "Harness state file").fullPath,
    "Harness state file",
  );
  if (state.storyId !== ledger.storyId
      || state.runtime?.runId !== ledger.runId
      || state.runtime?.status !== "active"
      || state.runtime?.revision !== ledger.preparedRevision
      || state.phase !== ledger.phase) {
    throw new Error("Wave integration freeze requires the active prepared implementation state.");
  }
  const { assertImplementationOwner } = await import("./implementation-owner-contract.mjs");
  await assertImplementationOwner({
    root,
    state,
    expectedMode: "worktree-wave",
    expectedOwnerId: ledger.waveId,
  });
  return state;
}

async function buildIntegrationManifest(root, options, ledger, lock) {
  if (!ledger.tasks.every((task) => task.status === "ready-for-integration")) {
    throw new Error("Wave integration manifest requires every task to be ready-for-integration.");
  }
  await assertFreezeStateAndOwner(root, options, ledger);
  if (await fileSha256(root, ledger.taskDagFile, "Wave Task DAG") !== ledger.taskDagSha256
      || await fileSha256(root, ledger.wavePlanFile, "Wave Worktree plan") !== ledger.wavePlanSha256
      || await fileSha256(root, ledger.creationReceiptFile, "Wave creation receipt")
        !== ledger.creationReceiptSha256) {
    throw new Error("Wave planning evidence changed before integration freeze.");
  }
  const { runWorktreeCommand } = await import("./worktree-runtime.mjs");
  const inspected = await runWorktreeCommand({
    root,
    command: "wave-status",
    stateFile: options.stateFile,
    taskDagFile: ledger.taskDagFile,
    waveIndex: ledger.waveIndex,
  });
  if (inspected.planFile !== ledger.wavePlanFile
      || inspected.status.state !== "ready"
      || inspected.status.wavePlanSha256 !== ledger.wavePlanSha256
      || inspected.plan.baseCommit !== ledger.baseCommit) {
    throw new Error("Wave Worktree facts changed before integration freeze.");
  }
  const mainHeadCommit = (await gitOutput(root, ["rev-parse", "HEAD"])).trim();
  if (mainHeadCommit !== ledger.baseCommit) {
    throw new Error("Main repository HEAD changed before integration freeze.");
  }
  const businessChanges = (await gitOutput(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    "backend/src",
    "frontend/src",
  ])).split("\0").filter(Boolean);
  if (businessChanges.length) {
    throw new Error("Main repository contains a business change before integration freeze.");
  }

  const manifestTasks = [];
  const candidateFiles = [];
  for (let index = 0; index < ledger.tasks.length; index += 1) {
    const task = ledger.tasks[index];
    const planTask = inspected.plan.tasks[index];
    const statusTask = inspected.status.tasks[index];
    if (!planTask
        || !statusTask
        || planTask.taskId !== task.taskId
        || statusTask.taskId !== task.taskId
        || statusTask.state !== "created"
        || statusTask.headCommit !== ledger.baseCommit) {
      throw new Error(`Wave Worktree facts changed for task '${task.taskId}'.`);
    }
    const paths = attemptPaths(ledger, task.taskId, task.currentAttemptId);
    const lockInfo = await lstat(
      resolveInsideRoot(root, paths.lockFile, "Wave task execution lock").fullPath,
    ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (lockInfo) throw new Error(`Wave task '${task.taskId}' still has an execution lock.`);
    if (await fileSha256(root, task.executionReceiptFile, "Wave task execution receipt")
        !== task.executionReceiptSha256) {
      throw new Error(`Wave task '${task.taskId}' execution receipt changed.`);
    }
    const claim = validateClaim(
      await readJsonFile(
        resolveInsideRoot(root, paths.claimFile, "Wave attempt claim").fullPath,
        "Wave attempt claim",
      ),
      ledger,
      task,
      paths,
    );
    const receipt = await validateRecoveredReadyEvidence(
      root,
      options,
      ledger,
      task,
      {
        attemptId: claim.attemptId,
        claimId: claim.claimId,
        lockId: claim.lockId,
      },
      paths,
    );
    const resultSha256 = await fileSha256(root, paths.resultFile, "Wave task result");
    const dispatchTask = validateDispatchTaskStructure(await readJsonFile(
      resolveInsideRoot(root, task.taskFile, "Wave dispatch task").fullPath,
      "Wave dispatch task",
    ));
    manifestTasks.push({
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      taskFile: task.taskFile,
      taskSha256: task.taskSha256,
      checkpointFile: task.checkpointFile,
      checkpointSha256: task.checkpointSha256,
      attemptId: task.currentAttemptId,
      resultFile: paths.resultFile,
      resultSha256,
      executionReceiptFile: task.executionReceiptFile,
      executionReceiptSha256: task.executionReceiptSha256,
      worktreePath: planTask.worktreePath,
      headCommit: receipt.headCommit,
      predictedFiles: [...planTask.predictedFiles],
    });
    const sortedFiles = [...receipt.files].sort((left, right) => {
      const priority = (file) => file.kind === "phase-output" ? 1 : 0;
      return priority(left) - priority(right) || left.path.localeCompare(right.path);
    });
    for (const file of sortedFiles) {
      if (file.kind === "phase-output") {
        if (!dispatchTask.expectedOutputs.includes(file.path)) {
          throw new Error(`Wave task '${task.taskId}' contains an unexpected phase output.`);
        }
      } else if (!planTask.predictedFiles.some((predicted) => matchesPredictedFile(predicted, file.path))) {
        throw new Error(`Wave task '${task.taskId}' contains a candidate outside predicted files.`);
      }
      candidateFiles.push({
        taskId: task.taskId,
        path: file.path,
        type: file.kind,
        sha256: file.sha256,
        bytes: file.bytes,
      });
    }
  }
  assertUniqueCandidatePaths(candidateFiles);
  const phaseRoot = `.harness/runs/${ledger.runId}/phases/03-implementation`;
  const phaseArtifacts = await Promise.all([
    `${phaseRoot}/task.json`,
    `${phaseRoot}/result.json`,
    `${phaseRoot}/checkpoint.json`,
    `${phaseRoot}/implementation-notes.md`,
  ].map((file) => optionalFileSnapshot(root, file, "Formal implementation artifact")));
  const manifest = {
    schemaVersion: "1.0",
    freezeId: lock.freezeId,
    storyId: ledger.storyId,
    runId: ledger.runId,
    phase: ledger.phase,
    waveId: ledger.waveId,
    waveIndex: ledger.waveIndex,
    preparedRevision: ledger.preparedRevision,
    taskDagFile: ledger.taskDagFile,
    taskDagSha256: ledger.taskDagSha256,
    wavePlanFile: ledger.wavePlanFile,
    wavePlanSha256: ledger.wavePlanSha256,
    creationReceiptFile: ledger.creationReceiptFile,
    creationReceiptSha256: ledger.creationReceiptSha256,
    baseCommit: ledger.baseCommit,
    mainHeadCommit,
    businessStatusSnapshot: {
      businessChanges: [],
      phaseArtifacts,
    },
    tasks: manifestTasks,
    candidateFiles,
    createdAt: lock.createdAt,
  };
  return validateIntegrationManifest(manifest, ledger);
}

async function bindFrozenManifest(root, options, ledger, lock, manifest) {
  const owner = await assertPreparationOwner(root, ledger, lock);
  const paths = owner.paths;
  await writeExclusiveJson(root, paths.manifestFile, manifest, "Wave integration manifest");
  if (options.afterManifestWriteBeforeLedgerBinding) {
    await options.afterManifestWriteBeforeLedgerBinding({
      lock,
      manifest,
      manifestFile: paths.manifestFile,
      preparationLockFile: paths.preparationLockFile,
    });
  }
  const manifestSha256 = await fileSha256(root, paths.manifestFile, "Wave integration manifest");
  const currentLedgerSha256 = await fileSha256(root, options.ledgerFile, "Wave execution ledger");
  const frozen = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now: options.now,
    expectedSha256: currentLedgerSha256,
    mutate: async (current) => {
      await assertPreparationOwner(root, current, lock, owner.lockSha256);
      if (current.integrationManifestFile !== paths.manifestFile) {
        throw new Error("Wave integration manifest path changed before binding.");
      }
      if (current.integrationManifestSha256 !== null
          && current.integrationManifestSha256 !== manifestSha256) {
        throw new Error("Wave integration manifest hash changed before binding.");
      }
      current.integrationManifestSha256 = manifestSha256;
    },
  });
  await assertPreparationOwner(root, frozen, lock, owner.lockSha256);
  await unlink(resolveInsideRoot(
    root,
    paths.preparationLockFile,
    "Wave manifest preparation lock",
  ).fullPath);
  return {
    command: "freeze-integration",
    reused: false,
    ledgerFile: options.ledgerFile,
    ledger: frozen,
    manifestFile: paths.manifestFile,
    manifest,
    preparationLockFile: paths.preparationLockFile,
  };
}

export async function freezeWaveIntegration(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const now = options.now ?? (() => new Date().toISOString());
  const randomUUID = options.randomUUID ?? createRandomUUID;
  if (!SHA256_PATTERN.test(options.expectedWaveLedgerSha256 ?? "")
      || !SHA256_PATTERN.test(options.expectedCreationReceiptSha256 ?? "")) {
    throw new Error("Wave integration freeze requires expected ledger and creation receipt hashes.");
  }
  if (await fileSha256(root, options.ledgerFile, "Wave execution ledger")
      !== options.expectedWaveLedgerSha256) {
    throw new Error("Wave execution ledger hash changed before integration freeze.");
  }
  const initial = validateWaveExecutionLedger(await readJsonFile(
    resolveInsideRoot(root, options.ledgerFile, "Wave execution ledger").fullPath,
    "Wave execution ledger",
  ));
  if (initial.status !== "ready-for-integration"
      || initial.creationReceiptSha256 !== options.expectedCreationReceiptSha256
      || await fileSha256(root, initial.creationReceiptFile, "Wave creation receipt")
        !== options.expectedCreationReceiptSha256) {
    throw new Error("Wave must be ready-for-integration with current creation evidence before freeze.");
  }
  await assertFreezeStateAndOwner(root, options, initial);
  const paths = integrationPaths(initial);
  const lock = {
    schemaVersion: "1.0",
    lockId: token("lock", randomUUID),
    freezeId: token("freeze", randomUUID),
    storyId: initial.storyId,
    runId: initial.runId,
    waveId: initial.waveId,
    ledgerSha256: options.expectedWaveLedgerSha256,
    creationReceiptSha256: initial.creationReceiptSha256,
    pid: process.pid,
    createdAt: now(),
  };
  validatePreparationLock(lock, initial);
  const freezing = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now,
    expectedSha256: options.expectedWaveLedgerSha256,
    mutate: async (ledger) => {
      if (ledger.status !== "ready-for-integration"
          || ledger.integrationManifestFile !== null
          || ledger.integrationManifestSha256 !== null) {
        throw new Error("Wave integration manifest preparation has already started.");
      }
      ledger.integrationManifestFile = paths.manifestFile;
      await writeExclusiveJson(
        root,
        paths.preparationLockFile,
        lock,
        "Wave manifest preparation lock",
      );
      if (options.afterPreparationLockWriteBeforeLedgerCommit) {
        await options.afterPreparationLockWriteBeforeLedgerCommit({ lock, ...paths });
      }
    },
  });
  const manifest = await buildIntegrationManifest(root, options, freezing, lock);
  return bindFrozenManifest(root, options, freezing, lock, manifest);
}

export async function recoverWaveFreeze(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.confirmManifestFreezeRecovery !== true) {
    throw new Error("Manifest freeze recovery requires ConfirmManifestFreezeRecovery.");
  }
  if (!SHA256_PATTERN.test(options.expectedPreparationLockSha256 ?? "")
      || !SHA256_PATTERN.test(options.expectedWaveLedgerSha256 ?? "")
      || !SHA256_PATTERN.test(options.expectedCreationReceiptSha256 ?? "")) {
    throw new Error("Manifest freeze recovery requires expected lock, ledger, and creation receipt hashes.");
  }
  if (await fileSha256(root, options.ledgerFile, "Wave execution ledger")
      !== options.expectedWaveLedgerSha256) {
    throw new Error("Wave execution ledger hash changed before manifest freeze recovery.");
  }
  let ledger = validateWaveExecutionLedger(await readJsonFile(
    resolveInsideRoot(root, options.ledgerFile, "Wave execution ledger").fullPath,
    "Wave execution ledger",
  ));
  if (ledger.creationReceiptSha256 !== options.expectedCreationReceiptSha256) {
    throw new Error("Wave creation receipt hash changed before manifest freeze recovery.");
  }
  await assertFreezeStateAndOwner(root, options, ledger);
  const paths = integrationPaths(ledger);
  const lock = validatePreparationLock(
    await readJsonFile(
      resolveInsideRoot(root, paths.preparationLockFile, "Wave manifest preparation lock").fullPath,
      "Wave manifest preparation lock",
    ),
    ledger,
  );
  if (lock.freezeId !== options.freezeId
      || await fileSha256(root, paths.preparationLockFile, "Wave manifest preparation lock")
        !== options.expectedPreparationLockSha256) {
    throw new Error("Wave manifest preparation lock changed before recovery.");
  }
  if (ledger.integrationManifestFile === null) {
    if (ledger.status !== "ready-for-integration") {
      throw new Error("Wave manifest freeze recovery found an incompatible ledger state.");
    }
    ledger = await mutateLedger({
      root,
      ledgerFile: options.ledgerFile,
      now: options.now,
      expectedSha256: options.expectedWaveLedgerSha256,
      mutate: async (current) => {
        await assertPreparationOwner(root, current, lock, options.expectedPreparationLockSha256);
        current.integrationManifestFile = paths.manifestFile;
      },
    });
  } else if (ledger.integrationManifestFile !== paths.manifestFile
      || !["freezing", "integration-frozen"].includes(ledger.status)) {
    throw new Error("Wave manifest freeze recovery found incompatible manifest evidence.");
  }
  const manifest = await buildIntegrationManifest(root, options, ledger, lock);
  const existingInfo = await lstat(
    resolveInsideRoot(root, paths.manifestFile, "Wave integration manifest").fullPath,
  ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existingInfo) {
    const existing = validateIntegrationManifest(await readJsonFile(
      resolveInsideRoot(root, paths.manifestFile, "Wave integration manifest").fullPath,
      "Wave integration manifest",
    ), ledger);
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new Error("Existing Wave integration manifest drifted during recovery.");
    }
  }
  if (ledger.integrationManifestSha256 !== null) {
    if (await fileSha256(root, paths.manifestFile, "Wave integration manifest")
        !== ledger.integrationManifestSha256) {
      throw new Error("Frozen Wave integration manifest changed before recovery.");
    }
    await assertPreparationOwner(root, ledger, lock, options.expectedPreparationLockSha256);
    await unlink(resolveInsideRoot(
      root,
      paths.preparationLockFile,
      "Wave manifest preparation lock",
    ).fullPath);
    return {
      command: "recover-freeze",
      reused: true,
      ledgerFile: options.ledgerFile,
      ledger,
      manifestFile: paths.manifestFile,
      manifest,
      preparationLockFile: paths.preparationLockFile,
    };
  }
  const recovered = await bindFrozenManifest(root, options, ledger, lock, manifest);
  return { ...recovered, command: "recover-freeze" };
}

function validateIntegrationLock(lock, ledger, manifest) {
  assertExactFields(lock, INTEGRATION_LOCK_FIELDS, "Wave integration lock");
  if (lock.schemaVersion !== "1.0"
      || typeof lock.lockId !== "string" || !lock.lockId
      || lock.freezeId !== manifest.freezeId
      || lock.manifestSha256 !== ledger.integrationManifestSha256
      || lock.storyId !== ledger.storyId
      || lock.runId !== ledger.runId
      || lock.waveId !== ledger.waveId
      || !Number.isInteger(lock.pid)
      || typeof lock.createdAt !== "string" || Number.isNaN(Date.parse(lock.createdAt))) {
    throw new Error("Wave integration lock does not match the frozen manifest.");
  }
  return lock;
}

function validateIntegrationRecoveryLock(lock, ledger, manifest, integrationLockSha256) {
  assertExactFields(lock, INTEGRATION_RECOVERY_LOCK_FIELDS, "Wave integration recovery lock");
  validateIntegrationLock(
    Object.fromEntries(INTEGRATION_LOCK_FIELDS.map((field) => [field, lock[field]])),
    ledger,
    manifest,
  );
  if (lock.integrationLockSha256 !== integrationLockSha256) {
    throw new Error("Wave integration recovery lock does not bind the current integration lock.");
  }
  return lock;
}

async function loadFrozenIntegrationContext(root, options) {
  if (!SHA256_PATTERN.test(options.expectedIntegrationManifestSha256 ?? "")) {
    throw new Error("Wave integration requires ExpectedIntegrationManifestSha256.");
  }
  const ledger = validateWaveExecutionLedger(await readJsonFile(
    resolveInsideRoot(root, options.ledgerFile, "Wave execution ledger").fullPath,
    "Wave execution ledger",
  ));
  if (!["integration-frozen", "integrating", "partial-integration", "integrated", "finalized"].includes(ledger.status)
      || ledger.integrationManifestFile === null
      || ledger.integrationManifestSha256 !== options.expectedIntegrationManifestSha256
      || await fileSha256(root, ledger.integrationManifestFile, "Wave integration manifest")
        !== options.expectedIntegrationManifestSha256) {
    throw new Error("Wave integration requires a current frozen integration manifest.");
  }
  await assertFreezeStateAndOwner(root, options, ledger);
  const manifest = validateIntegrationManifest(await readJsonFile(
    resolveInsideRoot(root, ledger.integrationManifestFile, "Wave integration manifest").fullPath,
    "Wave integration manifest",
  ), ledger);
  return { ledger, manifest, paths: integrationPaths(ledger) };
}

async function acquireWaveIntegrationOwner(root, options, context) {
  const { ledger, manifest, paths } = context;
  const lock = {
    schemaVersion: "1.0",
    lockId: token("lock", options.randomUUID ?? createRandomUUID),
    freezeId: manifest.freezeId,
    manifestSha256: ledger.integrationManifestSha256,
    storyId: ledger.storyId,
    runId: ledger.runId,
    waveId: ledger.waveId,
    pid: process.pid,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  validateIntegrationLock(lock, ledger, manifest);
  await writeExclusiveJson(root, paths.integrationLockFile, lock, "Wave integration lock");
  const integrationLockSha256 = await fileSha256(
    root,
    paths.integrationLockFile,
    "Wave integration lock",
  );
  return {
    mode: "integration",
    lock,
    integrationLockSha256,
    recoveryLock: null,
    recoveryLockSha256: null,
    paths,
  };
}

async function acquireWaveIntegrationRecoveryOwner(root, options, context) {
  const { ledger, manifest, paths } = context;
  if (!SHA256_PATTERN.test(options.expectedIntegrationLockSha256 ?? "")) {
    throw new Error("Wave integration recovery requires ExpectedIntegrationLockSha256.");
  }
  const integrationLockSha256 = await fileSha256(
    root,
    paths.integrationLockFile,
    "Wave integration lock",
  );
  if (integrationLockSha256 !== options.expectedIntegrationLockSha256) {
    throw new Error("Wave integration lock changed before recovery.");
  }
  const integrationLock = validateIntegrationLock(await readJsonFile(
    resolveInsideRoot(root, paths.integrationLockFile, "Wave integration lock").fullPath,
    "Wave integration lock",
  ), ledger, manifest);
  const existingInfo = await lstat(
    resolveInsideRoot(root, paths.integrationRecoveryLockFile, "Wave integration recovery lock").fullPath,
  ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  let recoveryLock;
  let recoveryLockSha256;
  if (existingInfo) {
    if (!SHA256_PATTERN.test(options.expectedIntegrationRecoveryLockSha256 ?? "")) {
      throw new Error("Existing Wave integration recovery lock requires its expected SHA-256.");
    }
    recoveryLockSha256 = await fileSha256(
      root,
      paths.integrationRecoveryLockFile,
      "Wave integration recovery lock",
    );
    if (recoveryLockSha256 !== options.expectedIntegrationRecoveryLockSha256) {
      throw new Error("Wave integration recovery lock changed.");
    }
    recoveryLock = validateIntegrationRecoveryLock(await readJsonFile(
      resolveInsideRoot(root, paths.integrationRecoveryLockFile, "Wave integration recovery lock").fullPath,
      "Wave integration recovery lock",
    ), ledger, manifest, integrationLockSha256);
  } else {
    recoveryLock = {
      schemaVersion: "1.0",
      lockId: token("lock", options.randomUUID ?? createRandomUUID),
      freezeId: manifest.freezeId,
      manifestSha256: ledger.integrationManifestSha256,
      storyId: ledger.storyId,
      runId: ledger.runId,
      waveId: ledger.waveId,
      pid: process.pid,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
      integrationLockSha256,
    };
    validateIntegrationRecoveryLock(recoveryLock, ledger, manifest, integrationLockSha256);
    await writeExclusiveJson(
      root,
      paths.integrationRecoveryLockFile,
      recoveryLock,
      "Wave integration recovery lock",
    );
    recoveryLockSha256 = await fileSha256(
      root,
      paths.integrationRecoveryLockFile,
      "Wave integration recovery lock",
    );
  }
  if (await fileSha256(root, paths.integrationLockFile, "Wave integration lock")
      !== integrationLockSha256) {
    throw new Error("Wave integration lock changed while recovery ownership was acquired.");
  }
  return {
    mode: "recovery",
    lock: integrationLock,
    integrationLockSha256,
    recoveryLock,
    recoveryLockSha256,
    paths,
  };
}

async function assertWaveIntegrationOwner(root, options, owner, ledger, manifest) {
  if (await fileSha256(root, ledger.integrationManifestFile, "Wave integration manifest")
      !== ledger.integrationManifestSha256
      || ledger.integrationManifestSha256 !== owner.lock.manifestSha256) {
    throw new Error("Wave integration manifest changed while integration was active.");
  }
  const integrationLockSha256 = await fileSha256(
    root,
    owner.paths.integrationLockFile,
    "Wave integration lock",
  );
  if (integrationLockSha256 !== owner.integrationLockSha256) {
    throw new Error("Wave integration owner lock changed.");
  }
  const integrationLock = validateIntegrationLock(await readJsonFile(
    resolveInsideRoot(root, owner.paths.integrationLockFile, "Wave integration lock").fullPath,
    "Wave integration lock",
  ), ledger, manifest);
  if (integrationLock.lockId !== owner.lock.lockId) {
    throw new Error("Wave integration owner changed.");
  }
  const recoveryInfo = await lstat(
    resolveInsideRoot(root, owner.paths.integrationRecoveryLockFile, "Wave integration recovery lock").fullPath,
  ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (owner.mode === "integration") {
    if (recoveryInfo) throw new Error("Wave integration owner was fenced by a recovery owner.");
    return;
  }
  if (!recoveryInfo
      || await fileSha256(root, owner.paths.integrationRecoveryLockFile, "Wave integration recovery lock")
        !== owner.recoveryLockSha256) {
    throw new Error("Wave integration recovery owner changed.");
  }
  const recoveryLock = validateIntegrationRecoveryLock(await readJsonFile(
    resolveInsideRoot(root, owner.paths.integrationRecoveryLockFile, "Wave integration recovery lock").fullPath,
    "Wave integration recovery lock",
  ), ledger, manifest, integrationLockSha256);
  if (recoveryLock.lockId !== owner.recoveryLock.lockId) {
    throw new Error("Wave integration recovery owner changed.");
  }
}

async function assertNoSymlinkTarget(root, fullPath, label) {
  const parts = path.relative(root, fullPath).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link.`);
  }
}

async function currentFileEvidence(root, relativeFile, label) {
  const location = resolveInsideRoot(root, relativeFile, label);
  await assertNoSymlinkTarget(root, location.fullPath, label);
  const info = await lstat(location.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return { exists: false, sha256: null, bytes: null, location };
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return {
    exists: true,
    sha256: await fileSha256(root, location.relative, label),
    bytes: info.size,
    location,
  };
}

async function gitObjectBuffer(root, commit, relativeFile) {
  try {
    const result = await execFileAsync("git", ["show", `${commit}:${relativeFile}`], {
      cwd: root,
      windowsHide: true,
      shell: false,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "buffer",
    });
    return Buffer.from(result.stdout ?? []);
  } catch (error) {
    if (error?.code === 128) return null;
    throw new Error(`Cannot inspect base content for ${relativeFile}.`);
  }
}

function integrationReceiptFileFor(ledger, taskId) {
  return `.harness/runs/${ledger.runId}/waves/${ledger.waveId}/tasks/${taskId}/integration-receipt.json`;
}

function taskManifestCandidates(manifest, taskId) {
  return manifest.candidateFiles.filter((candidate) => candidate.taskId === taskId);
}

function validateIntegrationReceipt(receipt, ledger, manifest, task, candidates) {
  assertExactFields(receipt, INTEGRATION_RECEIPT_FIELDS, "Wave integration receipt");
  if (receipt.schemaVersion !== "1.0"
      || receipt.storyId !== ledger.storyId
      || receipt.runId !== ledger.runId
      || receipt.phase !== ledger.phase
      || receipt.waveId !== ledger.waveId
      || receipt.waveIndex !== ledger.waveIndex
      || receipt.taskId !== task.taskId
      || receipt.dispatchId !== task.dispatchId
      || receipt.manifestSha256 !== ledger.integrationManifestSha256
      || receipt.baseCommit !== ledger.baseCommit
      || !Array.isArray(receipt.appliedFiles)
      || receipt.appliedFiles.length !== candidates.length
      || typeof receipt.completedAt !== "string" || Number.isNaN(Date.parse(receipt.completedAt))) {
    throw new Error("Wave integration receipt identity is invalid.");
  }
  for (let index = 0; index < candidates.length; index += 1) {
    if (JSON.stringify(receipt.appliedFiles[index]) !== JSON.stringify(candidates[index])) {
      throw new Error("Wave integration receipt files do not match the frozen manifest.");
    }
  }
  return receipt;
}

async function assertFormalArtifactsUnchanged(root, manifest) {
  for (const expected of manifest.businessStatusSnapshot.phaseArtifacts) {
    const actual = await currentFileEvidence(root, expected.path, "Formal implementation artifact");
    if (actual.exists !== expected.exists
        || actual.sha256 !== expected.sha256
        || actual.bytes !== expected.bytes) {
      throw new Error(`Formal implementation artifact changed before Wave finalization: ${expected.path}`);
    }
  }
}

async function assertMainIntegrationState(root, ledger, manifest, currentTaskId, allowFormalArtifacts = false) {
  if ((await gitOutput(root, ["rev-parse", "HEAD"])).trim() !== manifest.mainHeadCommit) {
    throw new Error("Main repository HEAD changed during Wave integration.");
  }
  if (!allowFormalArtifacts) await assertFormalArtifactsUnchanged(root, manifest);
  const integratedIds = new Set(
    ledger.tasks.filter((task) => task.status === "integrated").map((task) => task.taskId),
  );
  const allowedBusinessChanges = new Set();
  for (const candidate of manifest.candidateFiles) {
    const current = await currentFileEvidence(root, candidate.path, "Wave integration target");
    const isIntegrated = integratedIds.has(candidate.taskId);
    const isCurrent = candidate.taskId === currentTaskId;
    const matchesCandidate = current.exists
      && current.sha256 === candidate.sha256
      && current.bytes === candidate.bytes;
    if (isIntegrated) {
      if (!matchesCandidate) {
        throw new Error(`Integrated Wave prefix candidate changed: ${candidate.path}`);
      }
      if (candidate.type !== "phase-output") allowedBusinessChanges.add(pathKey(candidate.path));
      continue;
    }
    if (isCurrent && matchesCandidate) {
      if (candidate.type !== "phase-output") allowedBusinessChanges.add(pathKey(candidate.path));
      continue;
    }
    if (candidate.type === "phase-output") {
      if (current.exists) throw new Error(`Future Wave phase candidate appeared early: ${candidate.path}`);
      continue;
    }
    const base = await gitObjectBuffer(root, ledger.baseCommit, candidate.path);
    if (base === null) {
      if (current.exists) throw new Error(`Future Wave business candidate appeared early: ${candidate.path}`);
    } else if (!current.exists
        || current.sha256 !== `sha256:${createHash("sha256").update(base).digest("hex")}`
        || current.bytes !== base.byteLength) {
      throw new Error(`Wave business target changed outside the integrated prefix: ${candidate.path}`);
    }
  }
  const changes = (await gitOutput(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    "backend/src",
    "frontend/src",
  ])).split("\0").filter(Boolean);
  for (const record of changes) {
    const status = record.slice(0, 2);
    const relative = normalizePath(record.slice(3));
    if (!relative || status.includes("R") || status.includes("C") || status.includes("D")) {
      throw new Error("Wave integration does not support renamed, copied, or deleted business files.");
    }
    if (!allowedBusinessChanges.has(pathKey(relative))) {
      throw new Error(`Main repository contains an unexplained business change: ${relative}`);
    }
  }
}

async function readTaskCandidateBuffers(root, manifest, taskId) {
  const task = manifest.tasks.find((item) => item.taskId === taskId);
  const candidates = taskManifestCandidates(manifest, taskId);
  const loaded = [];
  for (const candidate of candidates) {
    const source = resolveInsideRoot(
      root,
      `${task.worktreePath}/${candidate.path}`,
      "Wave Worktree integration candidate",
    );
    await assertNoSymlinkTarget(root, source.fullPath, "Wave Worktree integration candidate");
    const info = await lstat(source.fullPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Wave Worktree candidate must be a regular file: ${candidate.path}`);
    }
    const buffer = await readFile(source.fullPath);
    if (buffer.byteLength !== candidate.bytes
        || `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== candidate.sha256) {
      throw new Error(`Wave Worktree candidate changed after manifest freeze: ${candidate.path}`);
    }
    loaded.push({ candidate, buffer });
  }
  return loaded;
}

async function integrateWaveTask(root, options, owner, context, task) {
  const { ledger, manifest } = context;
  const candidates = taskManifestCandidates(manifest, task.taskId);
  const receiptFile = integrationReceiptFileFor(ledger, task.taskId);
  if (task.status === "integrated") {
    if (task.integrationReceiptFile !== receiptFile
        || await fileSha256(root, receiptFile, "Wave integration receipt")
          !== task.integrationReceiptSha256) {
      throw new Error(`Integrated Wave task receipt changed: ${task.taskId}`);
    }
    validateIntegrationReceipt(await readJsonFile(
      resolveInsideRoot(root, receiptFile, "Wave integration receipt").fullPath,
      "Wave integration receipt",
    ), ledger, manifest, task, candidates);
    return { reused: true, receiptFile };
  }
  if (task.status !== "ready-for-integration") {
    throw new Error(`Wave task '${task.taskId}' is not ready for integration.`);
  }
  await assertWaveIntegrationOwner(root, options, owner, ledger, manifest);
  await assertMainIntegrationState(root, ledger, manifest, task.taskId);
  const loaded = await readTaskCandidateBuffers(root, manifest, task.taskId);
  for (const { candidate, buffer } of loaded) {
    await assertWaveIntegrationOwner(root, options, owner, ledger, manifest);
    const target = resolveInsideRoot(root, candidate.path, "Wave integration target");
    await assertNoSymlinkTarget(root, target.fullPath, "Wave integration target");
    const current = await currentFileEvidence(root, candidate.path, "Wave integration target");
    if (current.sha256 === candidate.sha256 && current.bytes === candidate.bytes) continue;
    await writeAtomicBuffer(target.fullPath, buffer);
  }
  await assertWaveIntegrationOwner(root, options, owner, ledger, manifest);
  await assertMainIntegrationState(root, ledger, manifest, task.taskId);
  if (options.afterTaskCandidatesWriteBeforeReceipt) {
    await options.afterTaskCandidatesWriteBeforeReceipt({
      taskId: task.taskId,
      integrationLockFile: owner.paths.integrationLockFile,
      integrationRecoveryLockFile: owner.paths.integrationRecoveryLockFile,
      receiptFile,
    });
  }
  const receipt = {
    schemaVersion: "1.0",
    storyId: ledger.storyId,
    runId: ledger.runId,
    phase: ledger.phase,
    waveId: ledger.waveId,
    waveIndex: ledger.waveIndex,
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    manifestSha256: ledger.integrationManifestSha256,
    baseCommit: ledger.baseCommit,
    appliedFiles: candidates.map((candidate) => ({ ...candidate })),
    completedAt: owner.lock.createdAt,
  };
  validateIntegrationReceipt(receipt, ledger, manifest, task, candidates);
  await writeExclusiveJson(root, receiptFile, receipt, "Wave integration receipt");
  const receiptSha256 = await fileSha256(root, receiptFile, "Wave integration receipt");
  if (options.afterTaskIntegrationReceiptBeforeLedger) {
    await options.afterTaskIntegrationReceiptBeforeLedger({ taskId: task.taskId, receiptFile, receipt });
  }
  const currentLedgerSha256 = await fileSha256(root, options.ledgerFile, "Wave execution ledger");
  const updated = await mutateLedger({
    root,
    ledgerFile: options.ledgerFile,
    now: options.now,
    expectedSha256: currentLedgerSha256,
    mutate: async (currentLedger) => {
      await assertWaveIntegrationOwner(root, options, owner, currentLedger, manifest);
      const currentTask = currentLedger.tasks.find((item) => item.taskId === task.taskId);
      if (!currentTask || currentTask.status !== "ready-for-integration") {
        throw new Error(`Wave task '${task.taskId}' changed before integration receipt binding.`);
      }
      currentTask.status = "integrated";
      currentTask.integrationReceiptFile = receiptFile;
      currentTask.integrationReceiptSha256 = receiptSha256;
      currentTask.integratedAt = receipt.completedAt;
      currentLedger.status = "partial-integration";
    },
  });
  return { reused: false, receiptFile, receipt, ledger: updated };
}

async function runOwnedWaveIntegration(root, options, owner) {
  const integratedTaskIds = [];
  try {
    let context = await loadFrozenIntegrationContext(root, options);
    await assertWaveIntegrationOwner(root, options, owner, context.ledger, context.manifest);
    if (context.ledger.status !== "integrated") {
      const currentSha256 = await fileSha256(root, options.ledgerFile, "Wave execution ledger");
      await mutateLedger({
        root,
        ledgerFile: options.ledgerFile,
        now: options.now,
        expectedSha256: currentSha256,
        mutate: async (ledger) => {
          await assertWaveIntegrationOwner(root, options, owner, ledger, context.manifest);
          ledger.status = "integrating";
        },
      });
    }
    for (const manifestTask of context.manifest.tasks) {
      context = await loadFrozenIntegrationContext(root, options);
      const task = context.ledger.tasks.find((item) => item.taskId === manifestTask.taskId);
      const result = await integrateWaveTask(root, options, owner, context, task);
      if (!result.reused) integratedTaskIds.push(task.taskId);
    }
    context = await loadFrozenIntegrationContext(root, options);
    await assertWaveIntegrationOwner(root, options, owner, context.ledger, context.manifest);
    if (context.ledger.status !== "integrated") {
      throw new Error("Wave integration did not converge to integrated.");
    }
    await assertMainIntegrationState(root, context.ledger, context.manifest, null);
    return {
      command: owner.mode === "recovery" ? "recover-integration" : "integrate-wave",
      ledgerFile: options.ledgerFile,
      ledger: context.ledger,
      integratedTaskIds,
      integrationLockFile: owner.paths.integrationLockFile,
      integrationLockSha256: owner.integrationLockSha256,
      integrationRecoveryLockFile: owner.paths.integrationRecoveryLockFile,
      integrationRecoveryLockSha256: owner.recoveryLockSha256,
    };
  } catch (error) {
    try {
      const context = await loadFrozenIntegrationContext(root, options);
      await assertWaveIntegrationOwner(root, options, owner, context.ledger, context.manifest);
      if (context.ledger.status !== "integrated") {
        await mutateLedger({
          root,
          ledgerFile: options.ledgerFile,
          now: options.now,
          expectedSha256: await fileSha256(root, options.ledgerFile, "Wave execution ledger"),
          mutate: async (ledger) => {
            await assertWaveIntegrationOwner(root, options, owner, ledger, context.manifest);
            ledger.status = "partial-integration";
          },
        });
      }
    } catch {
      // Preserve the original integration failure and all owner evidence.
    }
    throw error;
  }
}

export async function integrateWave(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.confirmWaveIntegrate !== true) {
    throw new Error("Wave integration requires ConfirmWaveIntegrate.");
  }
  const context = await loadFrozenIntegrationContext(root, options);
  if (context.ledger.status !== "integration-frozen") {
    throw new Error("Normal Wave integration requires an integration-frozen ledger.");
  }
  const owner = await acquireWaveIntegrationOwner(root, options, context);
  return runOwnedWaveIntegration(root, options, owner);
}

export async function recoverWaveIntegration(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.confirmWaveIntegrationRecovery !== true) {
    throw new Error("Wave integration recovery requires ConfirmWaveIntegrationRecovery.");
  }
  const context = await loadFrozenIntegrationContext(root, options);
  if (!["integrating", "partial-integration", "integrated"].includes(context.ledger.status)) {
    throw new Error("Wave integration recovery requires an interrupted or integrated ledger.");
  }
  const owner = await acquireWaveIntegrationRecoveryOwner(root, options, context);
  return runOwnedWaveIntegration(root, options, owner);
}

function validateWaveReceipt(receipt, ledger, phaseArtifacts) {
  assertExactFields(receipt, WAVE_RECEIPT_FIELDS, "Wave receipt");
  if (receipt.schemaVersion !== "1.0"
      || receipt.storyId !== ledger.storyId
      || receipt.runId !== ledger.runId
      || receipt.phase !== ledger.phase
      || receipt.waveId !== ledger.waveId
      || receipt.waveIndex !== ledger.waveIndex
      || receipt.preparedRevision !== ledger.preparedRevision
      || receipt.integrationManifestFile !== ledger.integrationManifestFile
      || receipt.integrationManifestSha256 !== ledger.integrationManifestSha256
      || !Array.isArray(receipt.tasks) || receipt.tasks.length !== ledger.tasks.length
      || typeof receipt.completedAt !== "string" || Number.isNaN(Date.parse(receipt.completedAt))) {
    throw new Error("Wave receipt identity is invalid.");
  }
  assertExactFields(receipt.phaseArtifacts, WAVE_PHASE_ARTIFACT_FIELDS, "Wave receipt phase artifacts");
  if (WAVE_PHASE_ARTIFACT_FIELDS.some((field) => receipt.phaseArtifacts[field] !== phaseArtifacts[field])) {
    throw new Error("Wave receipt phase artifacts do not match the finalized implementation artifacts.");
  }
  for (let index = 0; index < receipt.tasks.length; index += 1) {
    const item = receipt.tasks[index];
    const task = ledger.tasks[index];
    assertExactFields(item, WAVE_RECEIPT_TASK_FIELDS, "Wave receipt task");
    const manifestTask = item.taskId === task.taskId;
    if (!manifestTask
        || item.dispatchId !== task.dispatchId
        || item.executionReceiptFile !== task.executionReceiptFile
        || item.executionReceiptSha256 !== task.executionReceiptSha256
        || item.integrationReceiptFile !== task.integrationReceiptFile
        || item.integrationReceiptSha256 !== task.integrationReceiptSha256
        || typeof item.resultFile !== "string" || !item.resultFile
        || !SHA256_PATTERN.test(item.resultSha256)) {
      throw new Error("Wave receipt task does not match the finalized ledger.");
    }
  }
  return receipt;
}

async function loadExistingIntegrationOwner(root, options, context) {
  const { ledger, manifest, paths } = context;
  if (!SHA256_PATTERN.test(options.expectedIntegrationLockSha256 ?? "")) {
    throw new Error("Wave finalization requires ExpectedIntegrationLockSha256.");
  }
  const integrationLockSha256 = await fileSha256(
    root,
    paths.integrationLockFile,
    "Wave integration lock",
  );
  if (integrationLockSha256 !== options.expectedIntegrationLockSha256) {
    throw new Error("Wave integration lock changed before finalization.");
  }
  const lock = validateIntegrationLock(await readJsonFile(
    resolveInsideRoot(root, paths.integrationLockFile, "Wave integration lock").fullPath,
    "Wave integration lock",
  ), ledger, manifest);
  const recoveryInfo = await lstat(
    resolveInsideRoot(root, paths.integrationRecoveryLockFile, "Wave integration recovery lock").fullPath,
  ).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!recoveryInfo) {
    return {
      mode: "integration",
      lock,
      integrationLockSha256,
      recoveryLock: null,
      recoveryLockSha256: null,
      paths,
    };
  }
  const recoveryLockSha256 = await fileSha256(
    root,
    paths.integrationRecoveryLockFile,
    "Wave integration recovery lock",
  );
  const recoveryLock = validateIntegrationRecoveryLock(await readJsonFile(
    resolveInsideRoot(root, paths.integrationRecoveryLockFile, "Wave integration recovery lock").fullPath,
    "Wave integration recovery lock",
  ), ledger, manifest, integrationLockSha256);
  return {
    mode: "recovery",
    lock,
    integrationLockSha256,
    recoveryLock,
    recoveryLockSha256,
    paths,
  };
}

export async function finalizeWaveExecution(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (!options.phaseArtifacts || typeof options.phaseArtifacts !== "object") {
    throw new Error("Wave finalization requires formal phase artifact bindings.");
  }
  const context = await loadFrozenIntegrationContext(root, options);
  if (!["integrated", "finalized"].includes(context.ledger.status)) {
    throw new Error("Wave finalization requires every task to be integrated.");
  }
  const owner = await loadExistingIntegrationOwner(root, options, context);
  await assertWaveIntegrationOwner(root, options, owner, context.ledger, context.manifest);
  await assertMainIntegrationState(root, context.ledger, context.manifest, null, true);
  const receiptFile = context.paths.waveReceiptFile;
  const completedAt = context.ledger.finalizedAt
    ?? (options.now ?? (() => new Date().toISOString()))();
  const receipt = {
    schemaVersion: "1.0",
    storyId: context.ledger.storyId,
    runId: context.ledger.runId,
    phase: context.ledger.phase,
    waveId: context.ledger.waveId,
    waveIndex: context.ledger.waveIndex,
    preparedRevision: context.ledger.preparedRevision,
    integrationManifestFile: context.ledger.integrationManifestFile,
    integrationManifestSha256: context.ledger.integrationManifestSha256,
    tasks: context.ledger.tasks.map((task) => {
      const manifestTask = context.manifest.tasks.find((item) => item.taskId === task.taskId);
      return {
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        resultFile: manifestTask.resultFile,
        resultSha256: manifestTask.resultSha256,
        executionReceiptFile: task.executionReceiptFile,
        executionReceiptSha256: task.executionReceiptSha256,
        integrationReceiptFile: task.integrationReceiptFile,
        integrationReceiptSha256: task.integrationReceiptSha256,
      };
    }),
    phaseArtifacts: { ...options.phaseArtifacts },
    completedAt,
  };
  validateWaveReceipt(receipt, context.ledger, options.phaseArtifacts);
  await writeExclusiveJson(root, receiptFile, receipt, "Wave receipt");
  const receiptSha256 = await fileSha256(root, receiptFile, "Wave receipt");
  let finalized = context.ledger;
  if (context.ledger.status === "integrated") {
    finalized = await mutateLedger({
      root,
      ledgerFile: options.ledgerFile,
      now: options.now,
      expectedSha256: await fileSha256(root, options.ledgerFile, "Wave execution ledger"),
      mutate: async (ledger) => {
        await assertWaveIntegrationOwner(root, options, owner, ledger, context.manifest);
        ledger.waveReceiptFile = receiptFile;
        ledger.waveReceiptSha256 = receiptSha256;
        ledger.finalizedAt = completedAt;
      },
    });
  } else if (context.ledger.waveReceiptFile !== receiptFile
      || context.ledger.waveReceiptSha256 !== receiptSha256
      || context.ledger.finalizedAt !== completedAt) {
    throw new Error("Finalized Wave ledger does not match its receipt.");
  }
  const binding = {
    schemaVersion: "1.0",
    storyId: finalized.storyId,
    runId: finalized.runId,
    stateFile: options.stateFile,
    phase: finalized.phase,
    preparedRevision: finalized.preparedRevision,
    waveId: finalized.waveId,
    waveLedgerFile: options.ledgerFile,
    waveLedgerSha256: await fileSha256(root, options.ledgerFile, "Wave execution ledger"),
    waveReceiptFile: receiptFile,
    waveReceiptSha256: receiptSha256,
    integrationManifestFile: finalized.integrationManifestFile,
    integrationManifestSha256: finalized.integrationManifestSha256,
    taskFile: options.phaseArtifacts.taskFile,
    taskSha256: options.phaseArtifacts.taskSha256,
    resultFile: options.phaseArtifacts.resultFile,
    resultSha256: options.phaseArtifacts.resultSha256,
    notesFile: options.phaseArtifacts.notesFile,
    notesSha256: options.phaseArtifacts.notesSha256,
    finalizedAt: completedAt,
  };
  if (typeof options.bindCheckpoint !== "function") {
    throw new Error("Wave finalization requires a checkpoint binding callback.");
  }
  await options.bindCheckpoint(binding);
  const verified = await loadFrozenIntegrationContext(root, options);
  await assertWaveIntegrationOwner(root, options, owner, verified.ledger, verified.manifest);
  if (owner.recoveryLock) {
    await unlink(resolveInsideRoot(
      root,
      owner.paths.integrationRecoveryLockFile,
      "Wave integration recovery lock",
    ).fullPath);
    if (options.afterIntegrationRecoveryLockReleaseBeforeIntegrationLockRelease) {
      await options.afterIntegrationRecoveryLockReleaseBeforeIntegrationLockRelease();
    }
  }
  await assertWaveIntegrationOwner(
    root,
    options,
    { ...owner, mode: "integration", recoveryLock: null, recoveryLockSha256: null },
    verified.ledger,
    verified.manifest,
  );
  await unlink(resolveInsideRoot(
    root,
    owner.paths.integrationLockFile,
    "Wave integration lock",
  ).fullPath);
  return {
    command: "finalize-wave",
    ledgerFile: options.ledgerFile,
    ledger: verified.ledger,
    receiptFile,
    receipt,
    binding,
  };
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
    ledger.status = deriveWaveExecutionStatus(ledger.tasks.map((task) => task.status), ledger);
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

export function deriveWaveExecutionStatus(statuses, evidence) {
  if (!Array.isArray(statuses) || !statuses.length || statuses.some((status) => !TASK_STATUSES.has(status))) {
    throw new Error("Wave task statuses are invalid.");
  }
  if (evidence !== undefined) {
    const manifestFile = evidence.integrationManifestFile ?? null;
    const manifestSha256 = evidence.integrationManifestSha256 ?? null;
    const waveReceiptFile = evidence.waveReceiptFile ?? null;
    const waveReceiptSha256 = evidence.waveReceiptSha256 ?? null;
    const finalizedAt = evidence.finalizedAt ?? null;
    const hasManifestFile = typeof manifestFile === "string" && Boolean(manifestFile);
    const hasManifestSha256 = typeof manifestSha256 === "string" && SHA256_PATTERN.test(manifestSha256);
    const hasWaveReceiptFile = typeof waveReceiptFile === "string" && Boolean(waveReceiptFile);
    const hasWaveReceiptSha256 = typeof waveReceiptSha256 === "string" && SHA256_PATTERN.test(waveReceiptSha256);
    const hasFinalizedAt = typeof finalizedAt === "string" && !Number.isNaN(Date.parse(finalizedAt));
    if ((manifestFile !== null && !hasManifestFile)
        || (manifestSha256 !== null && !hasManifestSha256)
        || hasManifestSha256 && !hasManifestFile) {
      throw new Error("Wave integration manifest evidence is invalid.");
    }
    const finalizationParts = [hasWaveReceiptFile, hasWaveReceiptSha256, hasFinalizedAt];
    if (finalizationParts.some(Boolean) && !finalizationParts.every(Boolean)) {
      throw new Error("Finalized Wave receipt evidence must be fully bound.");
    }
    if (finalizationParts.every(Boolean)) {
      if (!hasManifestSha256 || !statuses.every((status) => status === "integrated")) {
        throw new Error("A finalized Wave requires a frozen manifest and integrated tasks.");
      }
      return "finalized";
    }
    if (hasManifestFile && !hasManifestSha256) {
      if (!statuses.every((status) => status === "ready-for-integration")) {
        throw new Error("A freezing Wave requires all tasks to remain ready for integration.");
      }
      return "freezing";
    }
    if (hasManifestSha256) {
      if (statuses.every((status) => status === "integrated")) return "integrated";
      if (statuses.every((status) => status === "ready-for-integration")) {
        if (evidence.status === "partial-integration") return "partial-integration";
        return evidence.status === "integrating" ? "integrating" : "integration-frozen";
      }
      if (statuses.every((status) => status === "integrated" || status === "ready-for-integration")
          && statuses.some((status) => status === "integrated")) {
        return evidence.status === "integrating" ? "integrating" : "partial-integration";
      }
      throw new Error("A frozen Wave manifest is incompatible with the current task states.");
    }
    if (statuses.some((status) => status === "integrated")) {
      throw new Error("Integrated Wave tasks require a frozen integration manifest.");
    }
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
      || !WAVE_STATUSES.has(ledger.status)
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
  const derived = deriveWaveExecutionStatus(ledger.tasks.map((task) => task.status), ledger);
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
  if (options.command === "freeze-integration") return freezeWaveIntegration(options);
  if (options.command === "recover-freeze") return recoverWaveFreeze(options);
  if (options.command === "integrate-wave") return integrateWave(options);
  if (options.command === "recover-integration") return recoverWaveIntegration(options);
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
