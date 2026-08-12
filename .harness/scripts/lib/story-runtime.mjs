import { createHash, randomUUID as createRandomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDispatchRecordStatusAllowed,
  validateDispatchResultStructure,
  validateDispatchTaskStructure,
} from "./dispatch-contract.mjs";
import {
  BATCH_FINALIZATION_FIELDS,
  finalizationArtifactPathsFor,
  validateBatchFinalizationBinding,
  validateBatchReceiptFinalizationArtifacts,
} from "./batch-finalization-contract.mjs";
import {
  acquireImplementationOwner,
  assertImplementationModeAvailable,
  assertImplementationOwner,
  inspectImplementationOwner,
} from "./implementation-owner-contract.mjs";
import { readWorkflowDefinition, runStateCommand } from "./state-runtime.mjs";

const PHASE_ADAPTERS = {
  "unit-test": ["harness-state-tests", "harness-m3-tests", "harness-structure", "backend-tests", "frontend-build"],
  "build-publish": ["harness-structure", "backend-package", "frontend-build", "no-build-required"],
};
const ADAPTER_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const WAVE_FINALIZATION_FIELDS = [
  "schemaVersion",
  "storyId",
  "runId",
  "stateFile",
  "phase",
  "preparedRevision",
  "waveId",
  "waveLedgerFile",
  "waveLedgerSha256",
  "waveReceiptFile",
  "waveReceiptSha256",
  "integrationManifestFile",
  "integrationManifestSha256",
  "taskFile",
  "taskSha256",
  "resultFile",
  "resultSha256",
  "notesFile",
  "notesSha256",
  "finalizedAt",
];
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function validateWaveFinalizationBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
      || Object.keys(binding).length !== WAVE_FINALIZATION_FIELDS.length
      || WAVE_FINALIZATION_FIELDS.some((field) => !Object.hasOwn(binding, field))
      || binding.schemaVersion !== "1.0"
      || binding.phase !== "implementation"
      || !Number.isInteger(binding.preparedRevision) || binding.preparedRevision < 1
      || typeof binding.finalizedAt !== "string" || Number.isNaN(Date.parse(binding.finalizedAt))) {
    throw new Error("Wave finalization binding has an invalid structure.");
  }
  for (const field of [
    "storyId", "runId", "stateFile", "waveId", "waveLedgerFile", "waveReceiptFile",
    "integrationManifestFile", "taskFile", "resultFile", "notesFile",
  ]) {
    if (typeof binding[field] !== "string" || !binding[field]) {
      throw new Error(`Wave finalization binding ${field} must be a non-empty string.`);
    }
  }
  for (const field of [
    "waveLedgerSha256", "waveReceiptSha256", "integrationManifestSha256",
    "taskSha256", "resultSha256", "notesSha256",
  ]) {
    if (!SHA256_PATTERN.test(binding[field])) {
      throw new Error(`Wave finalization binding ${field} must be a SHA-256 hash.`);
    }
  }
  return binding;
}

function platformCommand(command, args, cwd) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `${command}.cmd`, ...args],
      cwd,
    };
  }
  return { executable: command, args, cwd };
}

function adapterSpecification(root, adapter) {
  const specifications = {
    "harness-state-tests": {
      phases: ["unit-test"],
      executable: process.execPath,
      args: [path.join(root, ".harness/scripts/tests/state-runtime.test.mjs")],
      cwd: root,
    },
    "harness-m3-tests": {
      phases: ["unit-test"],
      executable: process.execPath,
      args: [path.join(root, ".harness/scripts/tests/story-runtime.test.mjs")],
      cwd: root,
    },
    "harness-structure": {
      phases: ["unit-test", "build-publish"],
      executable: "powershell.exe",
      args: [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, ".harness/scripts/validate-structure.ps1"), "-Root", root,
      ],
      cwd: root,
    },
    "backend-tests": {
      phases: ["unit-test"],
      ...platformCommand("mvn", ["test"], path.join(root, "backend")),
    },
    "backend-package": {
      phases: ["build-publish"],
      ...platformCommand("mvn", ["package"], path.join(root, "backend")),
    },
    "frontend-build": {
      phases: ["unit-test", "build-publish"],
      ...platformCommand("npm", ["run", "build"], path.join(root, "frontend")),
    },
    "no-build-required": {
      phases: ["build-publish"],
      executable: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all", "--", "backend", "frontend"],
      cwd: root,
    },
  };
  return specifications[adapter] ?? null;
}

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

async function readJsonOptional(filePath, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${normalizePath(filePath)}`);
  }
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} contains invalid JSON: ${normalizePath(filePath)}`);
  }
}

async function writeAtomicJson(filePath, value, options = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${createRandomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (options.beforeRename) await options.beforeRename({ filePath, temporary });
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeAtomicText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${createRandomUUID()}`;
  try {
    await writeFile(temporary, value, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readRegularFile(filePath, label = "File") {
  const info = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${normalizePath(filePath)}`);
  }
  return readFile(filePath);
}

function sha256Buffer(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function fileSha256(filePath, label) {
  return sha256Buffer(await readRegularFile(filePath, label));
}

async function batchFinalizationArtifacts(root, batch, located, phase) {
  if (batch.ledger.status !== "finalized" || !batch.receiptSha256) {
    throw new Error("Serial batch must be finalized before it can bind the implementation phase.");
  }
  const receiptPath = resolveInsideRoot(root, batch.ledger.batchReceiptFile, "Serial batch receipt").fullPath;
  const receipt = await readJsonOptional(receiptPath, "Serial batch receipt");
  if (!receipt || !receipt.finalizationArtifacts) {
    throw new Error("Finalized serial batch receipt is missing formal implementation artifacts.");
  }
  const artifacts = validateBatchReceiptFinalizationArtifacts(receipt.finalizationArtifacts);
  const expectedPaths = finalizationArtifactPathsFor(located.state.runtime.runId);
  if (phase.id !== "implementation"
      || artifacts.taskFile !== expectedPaths.taskFile
      || artifacts.resultFile !== expectedPaths.resultFile
      || artifacts.notesFile !== expectedPaths.notesFile) {
    throw new Error("Finalized serial batch receipt formal artifact paths do not match the implementation phase.");
  }
  const [taskSha256, resultSha256, notesSha256] = await Promise.all([
    fileSha256(resolveInsideRoot(root, artifacts.taskFile, "Finalized implementation task").fullPath, "Finalized implementation task"),
    fileSha256(resolveInsideRoot(root, artifacts.resultFile, "Finalized implementation result").fullPath, "Finalized implementation result"),
    fileSha256(resolveInsideRoot(root, artifacts.notesFile, "Finalized implementation notes").fullPath, "Finalized implementation notes"),
  ]);
  if (taskSha256 !== artifacts.taskSha256 || resultSha256 !== artifacts.resultSha256 || notesSha256 !== artifacts.notesSha256) {
    throw new Error("Finalized serial batch receipt formal artifacts drifted from the implementation phase.");
  }
  return artifacts;
}

async function inspectCurrentSerialBatchIfPresent(root, located) {
  const directory = resolveInsideRoot(
    root,
    `.harness/runs/${located.state.runtime.runId}/batches`,
    "Serial batch directory",
  ).fullPath;
  const info = await lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Serial batch directory must be a real directory.");
  }
  const { inspectCurrentSerialBatch } = await import("./batch-runtime.mjs");
  const batch = await inspectCurrentSerialBatch({ root, stateFile: located.stateFile });
  if (!batch) throw new Error("Serial batch directory exists without a valid ledger.");
  return batch;
}

function sameFinalizedBatch(left, right) {
  return Boolean(left && right
    && left.batchFile === right.batchFile
    && left.ledger?.batchId === right.ledger?.batchId
    && left.ledgerSha256 === right.ledgerSha256
    && left.receiptSha256 === right.receiptSha256);
}

function implementationPreparationLockPath(root, state) {
  return resolveInsideRoot(
    root,
    `.harness/runs/${state.runtime.runId}/phases/03-implementation/batch-preparation.lock`,
    "Batch preparation lock",
  ).fullPath;
}

function implementationFinalizationLockPath(root, state) {
  return resolveInsideRoot(
    root,
    `.harness/runs/${state.runtime.runId}/phases/03-implementation/batch-finalization.lock`,
    "Batch finalization lock",
  ).fullPath;
}

async function acquireImplementationLock(lockPath, label) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${label} already exists; inspect it before retrying.`);
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    throw error;
  }
}

async function withImplementationLock(lockPath, label, operation) {
  await acquireImplementationLock(lockPath, label);
  try {
    return await operation();
  } finally {
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function withImplementationPreparationLock(root, state, operation) {
  return withImplementationLock(
    implementationPreparationLockPath(root, state),
    "Batch preparation lock",
    operation,
  );
}

async function withImplementationFinalizationLock(root, state, operation) {
  return withImplementationLock(
    implementationFinalizationLockPath(root, state),
    "Batch finalization lock",
    operation,
  );
}

async function assertFinalizedBatchStillOwnsImplementation(root, located, verifiedBatch) {
  if (!verifiedBatch || verifiedBatch.ledger?.status !== "finalized" || !verifiedBatch.receiptSha256) {
    throw new Error("A finalized serial batch is required to prepare its implementation artifacts.");
  }
  const ledgerPath = resolveInsideRoot(root, verifiedBatch.batchFile, "Serial batch ledger").fullPath;
  const ledger = await readJsonOptional(ledgerPath, "Serial batch ledger");
  if (!ledger || ledger.status !== "finalized"
      || ledger.storyId !== located.state.storyId
      || ledger.stateFile !== located.stateFile
      || ledger.phase !== "implementation"
      || ledger.preparedRevision !== located.state.runtime.revision
      || ledger.batchId !== verifiedBatch.ledger.batchId
      || ledger.batchReceiptFile !== verifiedBatch.ledger.batchReceiptFile
      || await fileSha256(ledgerPath, "Serial batch ledger") !== verifiedBatch.ledgerSha256) {
    throw new Error("Finalized serial batch changed before implementation artifacts were prepared.");
  }
  const receiptPath = resolveInsideRoot(root, ledger.batchReceiptFile, "Serial batch receipt").fullPath;
  if (await fileSha256(receiptPath, "Serial batch receipt") !== verifiedBatch.receiptSha256) {
    throw new Error("Finalized serial batch receipt changed before implementation artifacts were prepared.");
  }
}

async function assertReadyBatchStillOwnsImplementation(root, located, verifiedBatch) {
  if (!verifiedBatch || verifiedBatch.ledger?.status !== "ready-for-finalization") {
    throw new Error("A ready serial batch is required to stage its implementation artifacts.");
  }
  const ledgerPath = resolveInsideRoot(root, verifiedBatch.batchFile, "Serial batch ledger").fullPath;
  const ledger = await readJsonOptional(ledgerPath, "Serial batch ledger");
  if (!ledger || ledger.status !== "ready-for-finalization"
      || ledger.storyId !== located.state.storyId
      || ledger.stateFile !== located.stateFile
      || ledger.phase !== "implementation"
      || ledger.preparedRevision !== located.state.runtime.revision
      || ledger.batchId !== verifiedBatch.ledger.batchId
      || await fileSha256(ledgerPath, "Serial batch ledger") !== verifiedBatch.ledgerSha256) {
    throw new Error("Ready serial batch changed before implementation artifacts were staged.");
  }
}

async function assertBatchDoesNotBlockPrepare(root, located, phase, verifiedBatch, preparationLockHeld = false, allowReadyBatchStaging = false) {
  if (phase.id !== "implementation") return;
  if (preparationLockHeld) {
    const directory = resolveInsideRoot(
      root,
      `.harness/runs/${located.state.runtime.runId}/batches`,
      "Serial batch directory",
    ).fullPath;
    const info = await lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Serial batch directory must be a real directory.");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink())) {
      throw new Error("Serial batch directory contains a symbolic link.");
    }
    if (!verifiedBatch) {
      throw new Error("A serial batch already owns the implementation phase; ordinary prepare is not allowed.");
    }
    if (verifiedBatch.ledger.status === "finalized") {
      await assertFinalizedBatchStillOwnsImplementation(root, located, verifiedBatch);
      return;
    }
    if (allowReadyBatchStaging && verifiedBatch.ledger.status === "ready-for-finalization") {
      await assertReadyBatchStillOwnsImplementation(root, located, verifiedBatch);
      return;
    }
    throw new Error("A serial batch already owns the implementation phase; ordinary prepare is not allowed.");
  }
  const batch = await inspectCurrentSerialBatchIfPresent(root, located);
  if (!batch) return;
  if (batch.ledger.status !== "finalized" || !sameFinalizedBatch(batch, verifiedBatch)) {
    throw new Error("A serial batch already owns the implementation phase; ordinary prepare is not allowed.");
  }
}

async function batchFinalizationBinding(root, batch, located, phase) {
  const artifacts = await batchFinalizationArtifacts(root, batch, located, phase);
  return {
    schemaVersion: "1.0",
    storyId: located.state.storyId,
    runId: located.state.runtime.runId,
    stateFile: located.stateFile,
    phase: phase.id,
    preparedRevision: located.state.runtime.revision,
    batchId: batch.ledger.batchId,
    ledgerFile: batch.batchFile,
    ledgerSha256: batch.ledgerSha256,
    receiptFile: batch.ledger.batchReceiptFile,
    receiptSha256: batch.receiptSha256,
    taskSha256: artifacts.taskSha256,
    resultSha256: artifacts.resultSha256,
    notesSha256: artifacts.notesSha256,
  };
}

async function assertBatchFinalizationBeforeApply(root, located, phase, task, checkpoint) {
  if (phase.id !== "implementation") return;
  if (!checkpoint.batchFinalization) {
    const batch = await inspectCurrentSerialBatchIfPresent(root, located);
    if (!batch) return;
    if (batch.ledger.status !== "finalized") {
      throw new Error("A serial batch must be finalized before apply can advance the implementation phase.");
    }
    throw new Error("Finalized serial batch requires a matching checkpoint batch binding before apply.");
  }
  validateBatchFinalizationBinding(checkpoint.batchFinalization);
  if (checkpoint.batchFinalization.preparedRevision !== task.preparedRevision) {
    throw new Error("Checkpoint batch binding does not match the finalized serial batch.");
  }
  if (located.state.runtime.revision > task.preparedRevision) {
    if (!new Set(["result-received", "failed"]).has(checkpoint.status)) {
      throw new Error("Checkpoint batch binding does not match the finalized serial batch.");
    }
    await assertBatchFinalizationBeforeRecovery(root, located, phase, task, checkpoint);
    return;
  }
  if (located.state.runtime.revision < task.preparedRevision) {
    throw new Error("Checkpoint batch binding does not match the finalized serial batch.");
  }
  const batch = await inspectCurrentSerialBatchIfPresent(root, located);
  if (!batch) throw new Error("Checkpoint batch binding exists but no serial batch ledger is present.");
  if (batch.ledger.status !== "finalized") {
    throw new Error("A serial batch must be finalized before apply can advance the implementation phase.");
  }
  const expected = await batchFinalizationBinding(root, batch, located, phase);
  if (BATCH_FINALIZATION_FIELDS.some((field) => checkpoint.batchFinalization[field] !== expected[field])
      || task.preparedRevision !== expected.preparedRevision) {
    throw new Error("Checkpoint batch binding does not match the finalized serial batch.");
  }
}

async function serialBatchDirectoryExists(root, state) {
  const directory = resolveInsideRoot(
    root,
    `.harness/runs/${state.runtime.runId}/batches`,
    "Serial batch directory",
  ).fullPath;
  const info = await lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Serial batch directory must be a real directory.");
  }
  return true;
}

async function assertBatchFinalizationBeforeRecovery(root, located, previousPhase, task, checkpoint) {
  if (previousPhase.id !== "implementation") return;
  if (!checkpoint.batchFinalization) {
    if (await serialBatchDirectoryExists(root, located.state)) {
      throw new Error("Finalized serial batch requires a checkpoint batch binding before recovery.");
    }
    return;
  }
  validateBatchFinalizationBinding(checkpoint.batchFinalization);
  const binding = checkpoint.batchFinalization;
  if (binding.storyId !== located.state.storyId
      || binding.runId !== located.state.runtime.runId
      || binding.stateFile !== located.stateFile
      || binding.phase !== previousPhase.id
      || binding.preparedRevision !== task.preparedRevision) {
    throw new Error("Checkpoint batch binding does not match the recovered implementation phase.");
  }
  const { inspectFinalizedSerialBatchForRecovery } = await import("./batch-runtime.mjs");
  const batch = await inspectFinalizedSerialBatchForRecovery({
    root,
    stateFile: located.stateFile,
    state: located.state,
    preparedRevision: task.preparedRevision,
    batchFile: binding.ledgerFile,
  });
  const historicalLocated = {
    ...located,
    state: {
      ...located.state,
      phase: previousPhase.id,
      runtime: {
        ...located.state.runtime,
        revision: task.preparedRevision,
      },
    },
  };
  const expected = await batchFinalizationBinding(root, batch, historicalLocated, previousPhase);
  if (BATCH_FINALIZATION_FIELDS.some((field) => binding[field] !== expected[field])) {
    throw new Error("Finalized serial batch no longer matches the checkpoint binding before recovery.");
  }
}

async function assertWaveFinalizationEvidence(root, located, phase, task, checkpoint) {
  if (phase.id !== "implementation" || !checkpoint.waveFinalization) return;
  const binding = validateWaveFinalizationBinding(checkpoint.waveFinalization);
  if (binding.storyId !== located.state.storyId
      || binding.runId !== located.state.runtime.runId
      || binding.stateFile !== located.stateFile
      || binding.phase !== phase.id
      || binding.preparedRevision !== task.preparedRevision
      || located.state.runtime.revision < task.preparedRevision) {
    throw new Error("Checkpoint Wave binding does not match the implementation phase.");
  }
  if (located.state.runtime.revision > task.preparedRevision
      && !new Set(["result-received", "failed", "completed"]).has(checkpoint.status)) {
    throw new Error("Checkpoint Wave binding does not match the recovered implementation phase.");
  }
  const { validateWaveExecutionLedger } = await import("./worktree-wave-execution-runtime.mjs");
  const ledgerPath = resolveInsideRoot(root, binding.waveLedgerFile, "Wave execution ledger").fullPath;
  const ledger = validateWaveExecutionLedger(await readJsonOptional(ledgerPath, "Wave execution ledger"));
  if (!ledger
      || ledger.status !== "finalized"
      || ledger.storyId !== binding.storyId
      || ledger.runId !== binding.runId
      || ledger.waveId !== binding.waveId
      || ledger.preparedRevision !== binding.preparedRevision
      || ledger.waveReceiptFile !== binding.waveReceiptFile
      || ledger.waveReceiptSha256 !== binding.waveReceiptSha256
      || ledger.integrationManifestFile !== binding.integrationManifestFile
      || ledger.integrationManifestSha256 !== binding.integrationManifestSha256
      || await fileSha256(ledgerPath, "Wave execution ledger") !== binding.waveLedgerSha256) {
    throw new Error("Finalized Wave ledger no longer matches the checkpoint binding.");
  }
  const receiptPath = resolveInsideRoot(root, binding.waveReceiptFile, "Wave receipt").fullPath;
  const receipt = await readJsonOptional(receiptPath, "Wave receipt");
  if (!receipt
      || await fileSha256(receiptPath, "Wave receipt") !== binding.waveReceiptSha256
      || receipt.storyId !== binding.storyId
      || receipt.runId !== binding.runId
      || receipt.phase !== binding.phase
      || receipt.waveId !== binding.waveId
      || receipt.preparedRevision !== binding.preparedRevision
      || receipt.integrationManifestFile !== binding.integrationManifestFile
      || receipt.integrationManifestSha256 !== binding.integrationManifestSha256
      || !Array.isArray(receipt.tasks)
      || receipt.tasks.length !== ledger.tasks.length
      || receipt.phaseArtifacts?.taskFile !== binding.taskFile
      || receipt.phaseArtifacts?.taskSha256 !== binding.taskSha256
      || receipt.phaseArtifacts?.resultFile !== binding.resultFile
      || receipt.phaseArtifacts?.resultSha256 !== binding.resultSha256
      || receipt.phaseArtifacts?.notesFile !== binding.notesFile
      || receipt.phaseArtifacts?.notesSha256 !== binding.notesSha256
      || receipt.completedAt !== binding.finalizedAt) {
    throw new Error("Finalized Wave receipt no longer matches the checkpoint binding.");
  }
  for (let index = 0; index < ledger.tasks.length; index += 1) {
    const ledgerTask = ledger.tasks[index];
    const receiptTask = receipt.tasks[index];
    if (receiptTask?.taskId !== ledgerTask.taskId
        || receiptTask.dispatchId !== ledgerTask.dispatchId
        || receiptTask.executionReceiptFile !== ledgerTask.executionReceiptFile
        || receiptTask.executionReceiptSha256 !== ledgerTask.executionReceiptSha256
        || receiptTask.integrationReceiptFile !== ledgerTask.integrationReceiptFile
        || receiptTask.integrationReceiptSha256 !== ledgerTask.integrationReceiptSha256
        || await fileSha256(
          resolveInsideRoot(root, ledgerTask.executionReceiptFile, "Wave execution receipt").fullPath,
          "Wave execution receipt",
        ) !== ledgerTask.executionReceiptSha256
        || await fileSha256(
          resolveInsideRoot(root, ledgerTask.integrationReceiptFile, "Wave integration receipt").fullPath,
          "Wave integration receipt",
        ) !== ledgerTask.integrationReceiptSha256
        || await fileSha256(
          resolveInsideRoot(root, receiptTask.resultFile, "Wave task result").fullPath,
          "Wave task result",
        ) !== receiptTask.resultSha256) {
      throw new Error(`Finalized Wave task evidence changed: ${ledgerTask.taskId}`);
    }
  }
  for (const [fileField, hashField, label] of [
    ["taskFile", "taskSha256", "Finalized implementation task"],
    ["resultFile", "resultSha256", "Finalized implementation result"],
    ["notesFile", "notesSha256", "Finalized implementation notes"],
    ["integrationManifestFile", "integrationManifestSha256", "Wave integration manifest"],
  ]) {
    if (await fileSha256(
      resolveInsideRoot(root, binding[fileField], label).fullPath,
      label,
    ) !== binding[hashField]) {
      throw new Error(`${label} changed after Wave finalization.`);
    }
  }
}

async function assertWaveFinalizationBeforeApply(root, located, phase, task, checkpoint) {
  if (phase.id !== "implementation") return;
  const owner = await inspectImplementationOwner({
    root,
    state: {
      ...located.state,
      runtime: { ...located.state.runtime, revision: task.preparedRevision },
    },
  });
  if (!checkpoint.waveFinalization) {
    if (owner?.owner.mode === "worktree-wave") {
      throw new Error("A worktree Wave must be finalized before apply can advance implementation.");
    }
    return;
  }
  if (checkpoint.waveFinalization.preparedRevision !== task.preparedRevision) {
    throw new Error("Checkpoint Wave binding does not match the finalized Wave.");
  }
  await assertWaveFinalizationEvidence(root, located, phase, task, checkpoint);
}

function executeAdapter(specification) {
  if (!specification.executable) {
    return Promise.resolve({ exitCode: 0, stdout: "No build required for the selected changes.", stderr: "" });
  }
  return new Promise((resolve) => {
    execFile(
      specification.executable,
      specification.args,
      specification.options,
      (error, stdout, stderr) => resolve({
        exitCode: typeof error?.code === "number" ? error.code : (error ? 1 : 0),
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? error?.message ?? ""),
      }),
    );
  });
}

function phaseDirectory(state, phase) {
  return `.harness/runs/${state.runtime.runId}/phases/${String(phase.order).padStart(2, "0")}-${phase.id}`;
}

function implementationTaskDagFile(state) {
  return `.harness/runs/${state.runtime.runId}/phases/02-task-dag/task-dag.json`;
}

function compareIdentifiers(left, right) {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function normalizePredictedPath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\\") || path.isAbsolute(value)) {
    throw new Error("Wave task predictedFiles must contain repository-relative paths.");
  }
  const normalized = value.replace(/\/\*\*$/, "").replace(/\/+$/, "");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Wave task predictedFiles must contain repository-relative paths.");
  }
  return normalized.toLowerCase();
}

function assertWavePredictedFilesDoNotConflict(tasks) {
  const paths = [];
  for (const task of tasks) {
    if (!Array.isArray(task.predictedFiles) || !task.predictedFiles.length) {
      throw new Error(`Wave task '${task.taskId}' must declare predictedFiles.`);
    }
    for (const value of task.predictedFiles) {
      const normalized = normalizePredictedPath(value);
      const conflict = paths.find((item) => (
        item.path === normalized
        || item.path.startsWith(`${normalized}/`)
        || normalized.startsWith(`${item.path}/`)
      ));
      if (conflict) {
        throw new Error(
          `Wave task predictedFiles conflict between '${conflict.taskId}' and '${task.taskId}'.`,
        );
      }
      paths.push({ taskId: task.taskId, path: normalized });
    }
  }
}

function validateCompleteWaveDag(dag, state, waveIndex) {
  if (!dag || typeof dag !== "object" || Array.isArray(dag)
      || dag.schemaVersion !== "1.0"
      || dag.storyId !== state.storyId
      || !Array.isArray(dag.nodes) || dag.nodes.length < 2
      || !Array.isArray(dag.edges) || dag.edges.length
      || !Array.isArray(dag.waves) || dag.waves.length !== 1
      || waveIndex !== 1
      || !Array.isArray(dag.globalChanges) || dag.globalChanges.length) {
    throw new Error(
      "Wave preparation requires one complete dependency-free wave with no globalChanges.",
    );
  }
  const ids = dag.nodes.map((task) => task?.taskId);
  if (ids.some((taskId) => typeof taskId !== "string" || !taskId)
      || new Set(ids).size !== ids.length
      || dag.waves[0].length !== ids.length
      || new Set(dag.waves[0]).size !== ids.length
      || ids.some((taskId) => !dag.waves[0].includes(taskId))) {
    throw new Error("Wave preparation requires its only wave to cover every implementation task.");
  }
  for (const task of dag.nodes) {
    if (task.status !== "pending"
        || !["backend", "frontend"].includes(task.type)
        || typeof task.title !== "string" || !task.title
        || typeof task.ownerAgent !== "string" || !task.ownerAgent) {
      throw new Error("Wave preparation only supports pending backend/frontend implementation tasks.");
    }
  }
  assertWavePredictedFilesDoNotConflict(dag.nodes);
  return [...dag.nodes].sort((left, right) => compareIdentifiers(left.taskId, right.taskId));
}

function assertExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new Error(`${label} has an invalid structure.`);
  }
}

async function executeStoryGit(root, args, options) {
  if (options.executeGit) return options.executeGit(args);
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: root, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message)));
      else resolve({ stdout, stderr });
    });
  });
}

async function assertMainRepositoryReadyForWave(root, located, taskDagFile, options) {
  const excluded = [
    `:(top,literal,exclude)${located.stateFile}`,
    `:(top,literal,exclude)${taskDagFile}`,
    `:(top,glob,exclude).harness/runs/${located.state.runtime.runId}/**`,
    `:(top,glob,exclude).harness/worktrees/${located.state.storyId}/**`,
  ];
  const result = await executeStoryGit(
    root,
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ...excluded],
    options,
  );
  if (String(result.stdout ?? "").trim()) {
    throw new Error("The main repository contains unapproved changes before wave preparation.");
  }
}

async function loadApprovedCompleteWave(root, context, options) {
  if (!Number.isInteger(options.waveIndex) || options.waveIndex < 1) {
    throw new Error("Wave preparation requires a positive waveIndex.");
  }
  const taskDagFile = resolveInsideRoot(root, options.taskDagFile, "Task DAG file").relative;
  if (taskDagFile !== implementationTaskDagFile(context.located.state)) {
    throw new Error("Wave preparation requires the active run Task DAG.");
  }
  const dagPath = resolveInsideRoot(root, taskDagFile, "Task DAG file").fullPath;
  const dag = await readJsonOptional(dagPath, "Task DAG file");
  const tasks = validateCompleteWaveDag(dag, context.located.state, options.waveIndex);
  const { runWorktreeCommand } = await import("./worktree-runtime.mjs");
  const inspected = await runWorktreeCommand({
    root,
    command: "wave-status",
    stateFile: context.located.stateFile,
    taskDagFile,
    waveIndex: options.waveIndex,
    executeGit: options.executeGit,
    now: options.now,
  });
  if (inspected.status.state !== "ready"
      || inspected.status.tasks.some((task) => (
        task.state !== "created" || task.headCommit !== inspected.plan.baseCommit
      ))
      || inspected.locks.create || inspected.locks.recovery) {
    throw new Error("Wave preparation requires every Worktree to be created at the common base with no active create lock.");
  }
  if (inspected.plan.tasks.length !== tasks.length) {
    throw new Error("Wave Worktree plan does not cover every implementation task.");
  }
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const planned = inspected.plan.tasks[index];
    if (planned.taskId !== task.taskId
        || planned.title !== task.title
        || planned.type !== task.type
        || planned.ownerAgent !== task.ownerAgent
        || JSON.stringify(planned.predictedFiles) !== JSON.stringify(task.predictedFiles)) {
      throw new Error("Wave Worktree plan drifted from the active Task DAG.");
    }
  }

  const planSha256 = await fileSha256(
    resolveInsideRoot(root, inspected.planFile, "Wave Worktree plan").fullPath,
    "Wave Worktree plan",
  );
  const statusSha256 = await fileSha256(
    resolveInsideRoot(root, inspected.statusFile, "Wave Worktree status").fullPath,
    "Wave Worktree status",
  );
  const storedStatus = await readJsonOptional(
    resolveInsideRoot(root, inspected.statusFile, "Wave Worktree status").fullPath,
    "Wave Worktree status",
  );
  assertExactFields(storedStatus, [
    "schemaVersion", "storyId", "runId", "wave", "wavePlanSha256", "taskDagSha256",
    "state", "baseRef", "baseCommit", "tasks", "observedAt", "details",
  ], "Stored Wave Worktree status");
  if (storedStatus.schemaVersion !== "1.0"
      || storedStatus.storyId !== context.located.state.storyId
      || storedStatus.runId !== context.located.state.runtime.runId
      || storedStatus.wave !== options.waveIndex
      || storedStatus.wavePlanSha256 !== planSha256
      || storedStatus.taskDagSha256 !== inspected.plan.taskDagSha256
      || storedStatus.state !== "ready"
      || storedStatus.baseRef !== inspected.plan.baseRef
      || storedStatus.baseCommit !== inspected.plan.baseCommit
      || !Array.isArray(storedStatus.tasks)
      || storedStatus.tasks.length !== inspected.plan.tasks.length) {
    throw new Error("Stored Wave Worktree status must be ready and match the current plan.");
  }
  for (let index = 0; index < storedStatus.tasks.length; index += 1) {
    const item = storedStatus.tasks[index];
    const planned = inspected.plan.tasks[index];
    const current = inspected.status.tasks[index];
    assertExactFields(
      item,
      ["taskId", "state", "branch", "worktreePath", "headCommit", "details"],
      "Stored Wave Worktree status task",
    );
    if (item.taskId !== planned.taskId
        || item.state !== "created"
        || item.branch !== planned.branch
        || item.worktreePath !== planned.worktreePath
        || item.headCommit !== inspected.plan.baseCommit
        || JSON.stringify(item) !== JSON.stringify(current)) {
      throw new Error("Stored Wave Worktree status task drifted from current Git facts.");
    }
  }
  const taskDagSha256 = await fileSha256(dagPath, "Task DAG file");
  const receiptFile = `${path.posix.dirname(inspected.planFile)}/creation-receipt.json`;
  const receiptPath = resolveInsideRoot(root, receiptFile, "Wave Worktree creation receipt").fullPath;
  const receipt = await readJsonOptional(receiptPath, "Wave Worktree creation receipt");
  assertExactFields(receipt, [
    "schemaVersion", "storyId", "runId", "wave", "planSha256", "taskDagSha256",
    "statusSha256", "baseCommit", "tasks", "lockRecovered", "completedAt",
  ], "Wave Worktree creation receipt");
  if (receipt.schemaVersion !== "1.0"
      || receipt.storyId !== context.located.state.storyId
      || receipt.runId !== context.located.state.runtime.runId
      || receipt.wave !== options.waveIndex
      || receipt.planSha256 !== planSha256
      || receipt.taskDagSha256 !== taskDagSha256
      || receipt.statusSha256 !== statusSha256
      || receipt.baseCommit !== inspected.plan.baseCommit
      || !Array.isArray(receipt.tasks)
      || receipt.tasks.length !== inspected.plan.tasks.length) {
    throw new Error("Wave Worktree creation receipt drifted from the current plan, status, or Task DAG.");
  }
  for (let index = 0; index < receipt.tasks.length; index += 1) {
    const item = receipt.tasks[index];
    const planned = inspected.plan.tasks[index];
    const status = storedStatus.tasks[index];
    assertExactFields(item, ["taskId", "branch", "worktreePath", "headCommit"], "Wave Worktree receipt task");
    if (item.taskId !== planned.taskId
        || item.branch !== planned.branch
        || item.worktreePath !== planned.worktreePath
        || item.headCommit !== status.headCommit) {
      throw new Error("Wave Worktree creation receipt task drifted from current Git facts.");
    }
  }
  await assertMainRepositoryReadyForWave(root, context.located, taskDagFile, options);
  return {
    waveIndex: options.waveIndex,
    taskDagFile,
    taskDagSha256,
    planFile: inspected.planFile,
    planSha256,
    statusFile: inspected.statusFile,
    statusSha256,
    creationReceiptFile: receiptFile,
    creationReceiptSha256: await fileSha256(receiptPath, "Wave Worktree creation receipt"),
    plan: inspected.plan,
    status: inspected.status,
    tasks,
  };
}

function deriveWaveId({ runId, revision, waveIndex, taskDagSha256, planSha256 }) {
  const identity = JSON.stringify([runId, revision, waveIndex, taskDagSha256, planSha256]);
  return `wave-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function waveTaskRoot(state, waveId, taskId) {
  return `.harness/runs/${state.runtime.runId}/waves/${waveId}/tasks/${taskId}`;
}

function waveCheckpointFor(task) {
  return {
    schemaVersion: "1.2",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    waveId: task.waveId,
    waveIndex: task.waveIndex,
    taskId: task.taskId,
    taskRoot: task.taskRoot,
    status: "prepared",
    preparedAt: task.preparedAt,
    updatedAt: task.preparedAt,
  };
}

async function writeWaveDispatch({ root, state, phase, wave, waveId, dagTask, options, timestamp }) {
  const taskRoot = waveTaskRoot(state, waveId, dagTask.taskId);
  const taskFile = `${taskRoot}/task.json`;
  const checkpointFile = `${taskRoot}/checkpoint.json`;
  const taskPath = resolveInsideRoot(root, taskFile, "Wave dispatch task").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Wave dispatch checkpoint").fullPath;
  const existing = await readJsonOptional(taskPath, "Wave dispatch task");
  const task = existing ?? {
    schemaVersion: "1.2",
    dispatchId: (options.randomUUID ?? createRandomUUID)(),
    storyId: state.storyId,
    runId: state.runtime.runId,
    phase: "implementation",
    waveId,
    waveIndex: wave.waveIndex,
    taskId: dagTask.taskId,
    taskRoot,
    ownerAgent: dagTask.ownerAgent,
    purpose: dagTask.title,
    preparedRevision: state.runtime.revision,
    preparedAt: timestamp,
    expectedOutputs: [`${taskRoot}/report.md`],
    allowedAdapters: [],
    next: phase.next[0],
  };
  validateDispatchTaskStructure(task);
  if (existing) {
    const expected = {
      ...existing,
      storyId: state.storyId,
      runId: state.runtime.runId,
      phase: "implementation",
      waveId,
      waveIndex: wave.waveIndex,
      taskId: dagTask.taskId,
      taskRoot,
      ownerAgent: dagTask.ownerAgent,
      purpose: dagTask.title,
      preparedRevision: state.runtime.revision,
      expectedOutputs: [`${taskRoot}/report.md`],
      allowedAdapters: [],
      next: phase.next[0],
    };
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new Error(`Existing wave dispatch drifted for task '${dagTask.taskId}'.`);
    }
  } else {
    await writeAtomicJson(taskPath, task);
  }
  const checkpoint = waveCheckpointFor(task);
  const currentCheckpoint = await readJsonOptional(checkpointPath, "Wave dispatch checkpoint");
  if (currentCheckpoint) {
    if (JSON.stringify(currentCheckpoint) !== JSON.stringify(checkpoint)) {
      throw new Error(`Existing wave checkpoint drifted for task '${dagTask.taskId}'.`);
    }
  } else {
    await writeAtomicJson(checkpointPath, checkpoint);
  }
  return {
    reused: Boolean(existing && currentCheckpoint),
    taskFile,
    checkpointFile,
    task,
    checkpoint,
  };
}

async function prepareWave(root, options) {
  for (const field of ["waveId", "dispatchId", "taskRoot"]) {
    if (options[field] !== undefined) {
      throw new Error(`Wave preparation does not accept caller-provided ${field}.`);
    }
  }
  const context = await currentContext(root, options.stateFile);
  if (context.located.state.runtime.status !== "active" || context.phase?.id !== "implementation") {
    throw new Error("Wave preparation requires an active implementation phase.");
  }
  if (context.phase.next.length !== 1) {
    throw new Error("Implementation phase must define exactly one next phase.");
  }
  await assertImplementationModeAvailable({
    root,
    state: context.located.state,
    requestedMode: "worktree-wave",
  });
  const wave = await loadApprovedCompleteWave(root, context, options);
  const waveId = deriveWaveId({
    runId: context.located.state.runtime.runId,
    revision: context.located.state.runtime.revision,
    waveIndex: wave.waveIndex,
    taskDagSha256: wave.taskDagSha256,
    planSha256: wave.planSha256,
  });
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  await acquireImplementationOwner({
    root,
    state: context.located.state,
    mode: "worktree-wave",
    ownerId: waveId,
    taskDagFile: wave.taskDagFile,
    now: () => timestamp,
  });
  const tasks = [];
  for (const dagTask of wave.tasks) {
    tasks.push(await writeWaveDispatch({
      root,
      state: context.located.state,
      phase: context.phase,
      wave,
      waveId,
      dagTask,
      options,
      timestamp,
    }));
  }
  const { createWaveExecutionLedger } = await import("./worktree-wave-execution-runtime.mjs");
  const execution = await createWaveExecutionLedger({
    root,
    state: context.located.state,
    wave,
    waveId,
    tasks,
    now: () => timestamp,
  });
  return {
    command: "prepare-wave",
    reused: execution.reused && tasks.every((item) => item.reused),
    waveId,
    ...wave,
    tasks,
    ledgerFile: execution.ledgerFile,
    ledger: execution.ledger,
  };
}

function phaseOutputs(root, phase, expectedPhaseRoot) {
  return phase.required_outputs.map((output) => {
    const resolved = resolveInsideRoot(root, output, "Required output");
    if (!resolved.relative.startsWith(`${expectedPhaseRoot}/`)) {
      throw new Error(`Required output must stay inside the current phase directory: ${output}`);
    }
    return resolved.relative;
  });
}

function validateTask(root, task, state, phase, expectedPhaseRoot) {
  validateDispatchTaskStructure(task);
  if (task.storyId !== state.storyId || task.phase !== state.phase) {
    throw new Error("Dispatch task does not match the current story phase.");
  }
  const allowedAdapters = PHASE_ADAPTERS[phase.id] ?? [];
  const expectedOutputs = phaseOutputs(root, phase, expectedPhaseRoot);
  if (task.ownerAgent !== phase.owner_agent
      || task.purpose !== phase.purpose
      || task.next !== phase.next[0]
      || !Number.isInteger(task.preparedRevision)
      || !Array.isArray(task.expectedOutputs)
      || !Array.isArray(task.allowedAdapters)
      || JSON.stringify(task.expectedOutputs) !== JSON.stringify(expectedOutputs)
      || JSON.stringify(task.allowedAdapters) !== JSON.stringify(allowedAdapters)) {
    throw new Error("Dispatch task does not match the workflow contract.");
  }
  for (const output of task.expectedOutputs) {
    if (!output.startsWith(`${expectedPhaseRoot}/`)) {
      throw new Error("Dispatch task output is outside the current phase directory.");
    }
  }
}

function validateCheckpoint(checkpoint, task) {
  if (!checkpoint || typeof checkpoint !== "object"
      || checkpoint.schemaVersion !== "1.0"
      || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId
      || checkpoint.phase !== task.phase
      || !["prepared", "result-received", "failed", "blocked", "completed"].includes(checkpoint.status)) {
    throw new Error("Dispatch checkpoint does not match the current task.");
  }
  if (Object.hasOwn(checkpoint, "batchFinalization")) {
    validateBatchFinalizationBinding(checkpoint.batchFinalization);
  }
  if (Object.hasOwn(checkpoint, "waveFinalization")) {
    validateWaveFinalizationBinding(checkpoint.waveFinalization);
  }
  if (checkpoint.batchFinalization && checkpoint.waveFinalization) {
    throw new Error("A dispatch checkpoint cannot bind both batch and Wave finalization.");
  }
}

async function currentContext(root, stateFile) {
  const located = await runStateCommand({ root, command: "status", stateFile });
  const workflow = await readWorkflowDefinition(root, located.state);
  const phase = workflow.phases.find((item) => item.id === located.state.phase) ?? null;
  return { located, phase, workflow };
}

async function dispatchStatus(root, located, phase) {
  if (!phase) {
    return { status: located.state.runtime.status, taskFile: null, resultFile: null, checkpointFile: null };
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
  return {
    status: checkpoint?.status ?? "not-prepared",
    taskFile,
    resultFile,
    checkpointFile,
    checkpoint,
  };
}

async function prepareFromContext(root, options, verifiedBatch, context, preparationLockHeld = false, allowReadyBatchStaging = false) {
  const { located, phase } = context;
  if (located.state.runtime.status !== "active" || ["blocked", "done"].includes(located.state.phase)) {
    throw new Error(`Cannot prepare a ${located.state.runtime.status} run in phase '${located.state.phase}'.`);
  }
  if (!phase) throw new Error(`Workflow does not define current phase '${located.state.phase}'.`);
  if (phase.next.length !== 1) throw new Error(`Workflow phase '${phase.id}' must define exactly one next phase.`);
  if (phase.id === "implementation") {
    await assertImplementationModeAvailable({
      root,
      state: located.state,
      requestedMode: verifiedBatch ? "serial-batch" : "ordinary",
    });
  }
  await assertBatchDoesNotBlockPrepare(root, located, phase, verifiedBatch, preparationLockHeld, allowReadyBatchStaging);

  const phaseRoot = phaseDirectory(located.state, phase);
  const expectedOutputs = phaseOutputs(root, phase, phaseRoot);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const taskPath = resolveInsideRoot(root, taskFile, "Task file").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const existing = await readJsonOptional(taskPath, "Task file");
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const task = existing ?? {
    schemaVersion: "1.0",
    dispatchId: (options.randomUUID ?? createRandomUUID)(),
    storyId: located.state.storyId,
    phase: phase.id,
    ownerAgent: phase.owner_agent,
    purpose: phase.purpose,
    preparedRevision: located.state.runtime.revision,
    preparedAt: timestamp,
    expectedOutputs,
    allowedAdapters: PHASE_ADAPTERS[phase.id] ?? [],
    next: phase.next[0],
  };

  if (existing) validateTask(root, existing, located.state, phase, phaseRoot);
  if (phase.id === "implementation") {
    await acquireImplementationOwner({
      root,
      state: located.state,
      mode: verifiedBatch ? "serial-batch" : "ordinary",
      ownerId: verifiedBatch?.ledger?.batchId ?? task.dispatchId,
      taskDagFile: implementationTaskDagFile(located.state),
      now: () => timestamp,
    });
  }

  if (existing) {
    let checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
    if (!checkpoint) {
      checkpoint = {
        schemaVersion: "1.0",
        dispatchId: existing.dispatchId,
        storyId: existing.storyId,
        phase: existing.phase,
        status: "prepared",
        preparedAt: existing.preparedAt,
        updatedAt: timestamp,
      };
      await writeAtomicJson(checkpointPath, checkpoint);
    }
    validateCheckpoint(checkpoint, existing);
    return { command: "prepare", reused: true, taskFile, resultFile, checkpointFile, task: existing, checkpoint };
  }

  const checkpoint = {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    status: "prepared",
    preparedAt: timestamp,
    updatedAt: timestamp,
  };
  await writeAtomicJson(taskPath, task);
  await writeAtomicJson(checkpointPath, checkpoint);
  return { command: "prepare", reused: false, taskFile, resultFile, checkpointFile, task, checkpoint };
}

async function prepare(root, options, verifiedBatch = null) {
  const initial = await currentContext(root, options.stateFile);
  if (initial.phase?.id !== "implementation") {
    return prepareFromContext(root, options, verifiedBatch, initial);
  }
  return withImplementationPreparationLock(root, initial.located.state, async () => {
    const locked = await currentContext(root, options.stateFile);
    return prepareFromContext(root, options, verifiedBatch, locked, true);
  });
}

async function prepareBatch(root, options) {
  if (options.baseRef !== undefined && options.baseRef !== "dev") {
    throw new Error("Batch preparation only supports base ref 'dev'.");
  }
  const { located, phase } = await currentContext(root, options.stateFile);
  if (located.state.runtime.status !== "active" || phase?.id !== "implementation") {
    throw new Error("Batch preparation requires an active implementation phase.");
  }
  await assertImplementationModeAvailable({
    root,
    state: located.state,
    requestedMode: "serial-batch",
  });
  const { resolveBatchBase } = await import("./worktree-runtime.mjs");
  const { prepareSerialBatch } = await import("./batch-runtime.mjs");
  const prepared = await prepareSerialBatch({
    root,
    stateFile: located.stateFile,
    taskDagFile: options.taskDagFile,
    resolveBase: () => resolveBatchBase({
      root,
      baseRef: "dev",
      executeGit: options.executeGit,
    }),
    onContextPrepared: ({ state, taskDagFile, batchId }) => acquireImplementationOwner({
      root,
      state,
      mode: "serial-batch",
      ownerId: batchId,
      taskDagFile,
      now: options.now,
    }),
    now: options.now,
    randomUUID: options.randomUUID,
  });
  return { ...prepared, command: "prepare-batch" };
}

function batchRecordKey(record) {
  return JSON.stringify({
    type: record.type,
    status: record.status,
    message: record.message,
    actor: record.actor ?? null,
  });
}

async function collectBatchArtifacts(root, ledger) {
  const records = [];
  const recordKeys = new Set();
  const reports = [];

  for (const batchTask of ledger.tasks) {
    const resultPath = resolveInsideRoot(root, batchTask.resultFile, "Batch task result").fullPath;
    const executionReceiptPath = resolveInsideRoot(root, batchTask.executionReceiptFile, "M5-B1 execution receipt").fullPath;
    const integrationReceiptPath = resolveInsideRoot(root, batchTask.integrationReceiptFile, "M5-B2 integration receipt").fullPath;
    const executionReceipt = await readJsonOptional(executionReceiptPath, "M5-B1 execution receipt");
    const integrationReceipt = await readJsonOptional(integrationReceiptPath, "M5-B2 integration receipt");
    if (!executionReceipt || !integrationReceipt) {
      throw new Error(`Batch task '${batchTask.taskId}' is missing receipt evidence.`);
    }
    const resultSha256 = await fileSha256(resultPath, "Batch task result");
    if (executionReceipt.resultSha256 !== resultSha256 || integrationReceipt.resultSha256 !== resultSha256) {
      throw new Error(`Batch task '${batchTask.taskId}' result hash drifted from its receipts.`);
    }
    const result = await readJsonOptional(resultPath, "Batch task result");
    if (!result) throw new Error(`Batch task '${batchTask.taskId}' result is missing.`);
    validateDispatchResultStructure(result);
    if (result.schemaVersion !== "1.1"
        || result.dispatchId !== batchTask.dispatchId
        || result.storyId !== ledger.storyId
        || result.phase !== ledger.phase
        || result.batchId !== ledger.batchId
        || result.taskId !== batchTask.taskId
        || result.taskRoot !== batchTask.taskRoot
        || result.status !== "completed"
        || JSON.stringify(result.outputs.map((output) => output.path)) !== JSON.stringify(batchTask.expectedOutputs)) {
      throw new Error(`Batch task '${batchTask.taskId}' result does not match the finalized ledger.`);
    }
    for (const record of result.records) {
      if (record.path) {
        throw new Error("Batch task records with an evidence path cannot be materialized into the phase result.");
      }
      const key = batchRecordKey(record);
      if (recordKeys.has(key)) continue;
      recordKeys.add(key);
      records.push({ ...record });
    }

    const reportPath = resolveInsideRoot(root, batchTask.reportFile, "Batch task report").fullPath;
    const reportBytes = await readRegularFile(reportPath, "Batch task report");
    const reportSha256 = sha256Buffer(reportBytes);
    const executionReport = executionReceipt.files?.find((file) => file?.path === batchTask.reportFile);
    const integrationReport = integrationReceipt.appliedFiles?.find((file) => file?.path === batchTask.reportFile);
    if (executionReport?.sha256 !== reportSha256 || integrationReport?.sha256 !== reportSha256) {
      throw new Error(`Batch task '${batchTask.taskId}' report hash drifted from its receipts.`);
    }
    reports.push({ task: batchTask, report: reportBytes.toString("utf8") });
  }

  return { records, reports };
}

function implementationNotesForBatch(ledger, reports) {
  const lines = [
    "# 实施批次汇总",
    "",
    `- 批次：${ledger.batchId}`,
    `- 基准提交：${ledger.baseCommit}`,
    `- 批次回执：${ledger.batchReceiptFile}`,
    "",
  ];
  for (const { task, report } of reports) {
    lines.push(`## ${task.taskId} ${task.title}`, "", report.trimEnd(), "");
  }
  return `${lines.join("\n")}\n`;
}

async function materializeBatchFinalizationPhaseArtifacts(root, options, context, batch, artifacts) {
  const { located, phase } = context;
  let prepared;
  try {
    prepared = await prepareFromContext(root, options, batch, context, true, true);
  } catch (error) {
    if (batch.ledger.status === "ready-for-finalization") {
      throw new Error(`Existing phase artifact prevents batch finalization: ${error.message}`);
    }
    throw error;
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const notesFile = `${phaseRoot}/implementation-notes.md`;
  const notesPath = resolveInsideRoot(root, notesFile, "Implementation notes").fullPath;
  const notes = implementationNotesForBatch(batch.ledger, artifacts.reports);
  const existingNotes = await lstat(notesPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existingNotes) {
    if (!existingNotes.isFile() || existingNotes.isSymbolicLink() || await readFile(notesPath, "utf8") !== notes) {
      throw new Error("Existing implementation notes do not match the finalized batch.");
    }
  } else {
    await writeAtomicText(notesPath, notes);
  }

  const result = {
    schemaVersion: "1.0",
    dispatchId: prepared.task.dispatchId,
    storyId: prepared.task.storyId,
    phase: prepared.task.phase,
    status: "completed",
    summary: `Serial batch '${batch.ledger.batchId}' completed ${batch.ledger.tasks.length} task(s).`,
    outputs: [{ path: notesFile }],
    records: artifacts.records,
  };
  const resultPath = resolveInsideRoot(root, prepared.resultFile, "Phase result").fullPath;
  const existingResult = await readJsonOptional(resultPath, "Phase result");
  if (existingResult) {
    if (JSON.stringify(existingResult) !== JSON.stringify(result)) {
      throw new Error("Existing phase result does not match the finalized batch.");
    }
  } else {
    await writeAtomicJson(resultPath, result);
  }
  return prepared;
}

async function finalizeBatch(root, options) {
  const { located, phase } = await currentContext(root, options.stateFile);
  if (located.state.runtime.status !== "active" || phase?.id !== "implementation") {
    throw new Error("Batch finalization requires an active implementation phase.");
  }
  if (typeof options.batchFile !== "string" || !options.batchFile.trim()) {
    throw new Error("Batch finalization requires a serial batch ledger path.");
  }

  const {
    finalizeSerialBatch,
    inspectCurrentSerialBatch,
  } = await import("./batch-runtime.mjs");
  const initialBatch = await inspectCurrentSerialBatch({ root, stateFile: located.stateFile });
  if (!initialBatch || initialBatch.batchFile !== options.batchFile) {
    throw new Error("Serial batch ledger does not match the current implementation phase.");
  }
  if (!new Set(["ready-for-finalization", "finalized"]).has(initialBatch.ledger.status)) {
    throw new Error("Serial batch finalization requires every task integration receipt.");
  }
  const staged = await withImplementationPreparationLock(root, located.state, async () => {
    const locked = await currentContext(root, options.stateFile);
    if (locked.located.state.runtime.status !== "active" || locked.phase?.id !== "implementation") {
      throw new Error("Batch finalization requires an active implementation phase.");
    }
    const batch = initialBatch;
    const artifacts = await collectBatchArtifacts(root, batch.ledger);
    const prepared = await materializeBatchFinalizationPhaseArtifacts(root, options, locked, batch, artifacts);
    return { locked, batch, prepared };
  });
  return withImplementationFinalizationLock(root, located.state, async () => {
    const shouldFinalizeLedger = staged.batch.ledger.status === "ready-for-finalization";
    const finalized = shouldFinalizeLedger
      ? await finalizeSerialBatch({
        root,
        stateFile: staged.locked.located.stateFile,
        batchFile: options.batchFile,
        now: options.now,
      })
      : { batchFile: staged.batch.batchFile, receiptFile: staged.batch.ledger.batchReceiptFile };
    if (shouldFinalizeLedger && options.testHooks?.afterLedgerFinalizedBeforeCheckpointBinding) {
      await options.testHooks.afterLedgerFinalizedBeforeCheckpointBinding();
    }
    const current = await currentContext(root, options.stateFile);
    if (current.located.state.runtime.status !== "active" || current.phase?.id !== "implementation") {
      throw new Error("Batch finalization cannot bind artifacts after the implementation phase changes.");
    }
    const verifiedBatch = await inspectCurrentSerialBatch({ root, stateFile: current.located.stateFile });
    if (!verifiedBatch || verifiedBatch.batchFile !== finalized.batchFile) {
      throw new Error("Finalized serial batch cannot be reloaded from the active implementation phase.");
    }
    const checkpointPath = resolveInsideRoot(root, staged.prepared.checkpointFile, "Phase checkpoint").fullPath;
    const checkpoint = await readJsonOptional(checkpointPath, "Phase checkpoint");
    if (!checkpoint) throw new Error("Batch finalization did not create a phase checkpoint.");
    validateCheckpoint(checkpoint, staged.prepared.task);
    const binding = await batchFinalizationBinding(root, verifiedBatch, current.located, current.phase);
    if (checkpoint.batchFinalization
      && BATCH_FINALIZATION_FIELDS.some((field) => checkpoint.batchFinalization[field] !== binding[field])) {
      throw new Error("Existing checkpoint batch binding does not match the finalized serial batch.");
    }
    if (!checkpoint.batchFinalization) {
      checkpoint.batchFinalization = binding;
      await writeAtomicJson(checkpointPath, checkpoint, {
        beforeRename: options.testHooks?.beforeCheckpointBindingRename,
      });
    }
    return {
      command: "finalize-batch",
      status: "ready-for-apply",
      stateFile: current.located.stateFile,
      batchFile: finalized.batchFile,
      receiptFile: finalized.receiptFile,
      taskFile: staged.prepared.taskFile,
      resultFile: staged.prepared.resultFile,
      checkpointFile: staged.prepared.checkpointFile,
      task: staged.prepared.task,
    };
  });
}

function waveFinalizationDispatchId(ledger) {
  const hex = createHash("sha256")
    .update(`${ledger.storyId}\0${ledger.waveId}\0${ledger.integrationManifestSha256}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function collectWaveFinalizationArtifacts(root, ledger, manifest) {
  const records = [];
  const recordKeys = new Set();
  const reports = [];
  for (const ledgerTask of ledger.tasks) {
    const manifestTask = manifest.tasks.find((item) => item.taskId === ledgerTask.taskId);
    if (!manifestTask
        || await fileSha256(
          resolveInsideRoot(root, manifestTask.resultFile, "Wave task result").fullPath,
          "Wave task result",
        ) !== manifestTask.resultSha256
        || await fileSha256(
          resolveInsideRoot(root, ledgerTask.executionReceiptFile, "Wave execution receipt").fullPath,
          "Wave execution receipt",
        ) !== ledgerTask.executionReceiptSha256
        || await fileSha256(
          resolveInsideRoot(root, ledgerTask.integrationReceiptFile, "Wave integration receipt").fullPath,
          "Wave integration receipt",
        ) !== ledgerTask.integrationReceiptSha256) {
      throw new Error(`Wave task '${ledgerTask.taskId}' finalization evidence changed.`);
    }
    const result = await readJsonOptional(
      resolveInsideRoot(root, manifestTask.resultFile, "Wave task result").fullPath,
      "Wave task result",
    );
    validateDispatchResultStructure(result);
    if (result.schemaVersion !== "1.2"
        || result.status !== "completed"
        || result.storyId !== ledger.storyId
        || result.runId !== ledger.runId
        || result.phase !== ledger.phase
        || result.waveId !== ledger.waveId
        || result.waveIndex !== ledger.waveIndex
        || result.taskId !== ledgerTask.taskId
        || result.dispatchId !== ledgerTask.dispatchId) {
      throw new Error(`Wave task '${ledgerTask.taskId}' result does not match the finalized ledger.`);
    }
    for (const record of result.records) {
      if (record.path) {
        throw new Error("Wave task records with an evidence path cannot be materialized into the phase result.");
      }
      const key = batchRecordKey(record);
      if (recordKeys.has(key)) continue;
      recordKeys.add(key);
      records.push({ ...record });
    }
    const reportCandidates = manifest.candidateFiles.filter((candidate) => (
      candidate.taskId === ledgerTask.taskId && candidate.type === "phase-output"
    ));
    if (reportCandidates.length !== 1) {
      throw new Error(`Wave task '${ledgerTask.taskId}' must contain exactly one integrated task report.`);
    }
    const reportCandidate = reportCandidates[0];
    const reportPath = resolveInsideRoot(root, reportCandidate.path, "Wave task report").fullPath;
    const reportBytes = await readRegularFile(reportPath, "Wave task report");
    if (sha256Buffer(reportBytes) !== reportCandidate.sha256
        || reportBytes.byteLength !== reportCandidate.bytes) {
      throw new Error(`Wave task '${ledgerTask.taskId}' report changed after integration.`);
    }
    const dispatch = validateDispatchTaskStructure(await readJsonOptional(
      resolveInsideRoot(root, ledgerTask.taskFile, "Wave dispatch task").fullPath,
      "Wave dispatch task",
    ));
    reports.push({
      taskId: ledgerTask.taskId,
      title: dispatch.purpose,
      report: reportBytes.toString("utf8"),
    });
  }
  return { records, reports };
}

function implementationNotesForWave(ledger, manifest, reports) {
  const lines = [
    "# 实施 Wave 汇总",
    "",
    `- Wave：${ledger.waveId}`,
    `- 基准提交：${ledger.baseCommit}`,
    `- Integration Manifest：${ledger.integrationManifestFile}`,
    `- Execution Ledger：${`.harness/runs/${ledger.runId}/waves/${ledger.waveId}/execution-ledger.json`}`,
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.taskId} ${report.title}`, "", report.report.trimEnd(), "");
  }
  return `${lines.join("\n")}\n`;
}

async function ensureExactJson(filePath, value, label) {
  const existing = await readJsonOptional(filePath, label);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`Existing ${label} does not match the finalized Wave.`);
    }
    return;
  }
  await writeAtomicJson(filePath, value);
}

async function ensureExactText(filePath, value, label) {
  const info = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (info) {
    if (!info.isFile() || info.isSymbolicLink() || await readFile(filePath, "utf8") !== value) {
      throw new Error(`Existing ${label} does not match the finalized Wave.`);
    }
    return;
  }
  await writeAtomicText(filePath, value);
}

async function materializeWaveFinalizationPhaseArtifacts(root, options, context, ledger, manifest, artifacts) {
  const { located, phase } = context;
  const phaseRoot = phaseDirectory(located.state, phase);
  const expectedOutputs = phaseOutputs(root, phase, phaseRoot);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const notesFile = `${phaseRoot}/implementation-notes.md`;
  const task = {
    schemaVersion: "1.0",
    dispatchId: waveFinalizationDispatchId(ledger),
    storyId: ledger.storyId,
    phase: ledger.phase,
    ownerAgent: phase.owner_agent,
    purpose: phase.purpose,
    preparedRevision: ledger.preparedRevision,
    preparedAt: ledger.preparedAt,
    expectedOutputs,
    allowedAdapters: PHASE_ADAPTERS[phase.id] ?? [],
    next: phase.next[0],
  };
  validateTask(root, task, located.state, phase, phaseRoot);
  const checkpoint = {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    status: "prepared",
    preparedAt: task.preparedAt,
    updatedAt: task.preparedAt,
  };
  const notes = implementationNotesForWave(ledger, manifest, artifacts.reports);
  const result = {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    status: "completed",
    summary: `Worktree Wave '${ledger.waveId}' completed ${ledger.tasks.length} task(s).`,
    outputs: [{ path: notesFile }],
    records: artifacts.records,
  };
  validateDispatchResultStructure(result);
  await ensureExactJson(resolveInsideRoot(root, taskFile, "Finalized implementation task").fullPath, task, "implementation task");
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Finalized implementation checkpoint").fullPath;
  const existingCheckpoint = await readJsonOptional(checkpointPath, "Finalized implementation checkpoint");
  if (existingCheckpoint) {
    validateCheckpoint(existingCheckpoint, task);
    if (existingCheckpoint.waveFinalization === undefined
        && JSON.stringify(existingCheckpoint) !== JSON.stringify(checkpoint)) {
      throw new Error("Existing implementation checkpoint does not match the finalized Wave.");
    }
  } else {
    await writeAtomicJson(checkpointPath, checkpoint);
  }
  await ensureExactText(
    resolveInsideRoot(root, notesFile, "Finalized implementation notes").fullPath,
    notes,
    "implementation notes",
  );
  await ensureExactJson(
    resolveInsideRoot(root, resultFile, "Finalized implementation result").fullPath,
    result,
    "implementation result",
  );
  return {
    task,
    taskFile,
    resultFile,
    checkpointFile,
    notesFile,
    taskSha256: await fileSha256(
      resolveInsideRoot(root, taskFile, "Finalized implementation task").fullPath,
      "Finalized implementation task",
    ),
    resultSha256: await fileSha256(
      resolveInsideRoot(root, resultFile, "Finalized implementation result").fullPath,
      "Finalized implementation result",
    ),
    notesSha256: await fileSha256(
      resolveInsideRoot(root, notesFile, "Finalized implementation notes").fullPath,
      "Finalized implementation notes",
    ),
  };
}

async function finalizeWave(root, options) {
  const context = await currentContext(root, options.stateFile);
  const { located, phase } = context;
  if (located.state.runtime.status !== "active" || phase?.id !== "implementation") {
    throw new Error("Wave finalization requires an active implementation phase.");
  }
  if (typeof options.taskDagFile !== "string" || !options.taskDagFile
      || !Number.isInteger(options.waveIndex) || options.waveIndex < 1) {
    throw new Error("Wave finalization requires TaskDagFile and a positive WaveIndex.");
  }
  const owner = await inspectImplementationOwner({ root, state: located.state });
  if (!owner || owner.owner.mode !== "worktree-wave") {
    throw new Error("Wave finalization requires the current worktree-wave implementation owner.");
  }
  const taskDagFile = resolveInsideRoot(root, options.taskDagFile, "Wave Task DAG").relative;
  if (owner.owner.taskDagFile !== taskDagFile) {
    throw new Error("Wave finalization Task DAG does not match the implementation owner.");
  }
  const ledgerFile = `.harness/runs/${located.state.runtime.runId}/waves/${owner.owner.ownerId}/execution-ledger.json`;
  const phaseRoot = phaseDirectory(located.state, phase);
  const existingTask = await readJsonOptional(
    resolveInsideRoot(root, `${phaseRoot}/task.json`, "Finalized implementation task").fullPath,
    "Finalized implementation task",
  );
  const existingCheckpoint = await readJsonOptional(
    resolveInsideRoot(root, `${phaseRoot}/checkpoint.json`, "Finalized implementation checkpoint").fullPath,
    "Finalized implementation checkpoint",
  );
  if (existingTask && existingCheckpoint?.waveFinalization) {
    validateTask(root, existingTask, located.state, phase, phaseRoot);
    validateCheckpoint(existingCheckpoint, existingTask);
    await assertWaveFinalizationEvidence(root, located, phase, existingTask, existingCheckpoint);
    return {
      command: "finalize-wave",
      status: "ready-for-apply",
      stateFile: located.stateFile,
      ledgerFile,
      receiptFile: existingCheckpoint.waveFinalization.waveReceiptFile,
      taskFile: existingCheckpoint.waveFinalization.taskFile,
      resultFile: existingCheckpoint.waveFinalization.resultFile,
      checkpointFile: `${phaseRoot}/checkpoint.json`,
      notesFile: existingCheckpoint.waveFinalization.notesFile,
      task: existingTask,
    };
  }
  if (!SHA256_PATTERN.test(options.expectedIntegrationManifestSha256 ?? "")
      || !SHA256_PATTERN.test(options.expectedIntegrationLockSha256 ?? "")) {
    throw new Error("Wave finalization requires expected manifest and integration lock hashes.");
  }
  const { validateWaveExecutionLedger, finalizeWaveExecution } = await import(
    "./worktree-wave-execution-runtime.mjs"
  );
  const ledger = validateWaveExecutionLedger(await readJsonOptional(
    resolveInsideRoot(root, ledgerFile, "Wave execution ledger").fullPath,
    "Wave execution ledger",
  ));
  if (!ledger
      || !["integrated", "finalized"].includes(ledger.status)
      || ledger.waveIndex !== options.waveIndex
      || ledger.taskDagFile !== taskDagFile
      || ledger.integrationManifestSha256 !== options.expectedIntegrationManifestSha256) {
    throw new Error("Wave execution ledger is not ready for finalization.");
  }
  const manifest = await readJsonOptional(
    resolveInsideRoot(root, ledger.integrationManifestFile, "Wave integration manifest").fullPath,
    "Wave integration manifest",
  );
  const artifacts = await collectWaveFinalizationArtifacts(root, ledger, manifest);
  const materialized = await materializeWaveFinalizationPhaseArtifacts(
    root,
    options,
    context,
    ledger,
    manifest,
    artifacts,
  );
  const finalized = await finalizeWaveExecution({
    root,
    stateFile: located.stateFile,
    ledgerFile,
    expectedIntegrationManifestSha256: options.expectedIntegrationManifestSha256,
    expectedIntegrationLockSha256: options.expectedIntegrationLockSha256,
    phaseArtifacts: {
      taskFile: materialized.taskFile,
      taskSha256: materialized.taskSha256,
      resultFile: materialized.resultFile,
      resultSha256: materialized.resultSha256,
      notesFile: materialized.notesFile,
      notesSha256: materialized.notesSha256,
    },
    now: options.now,
    bindCheckpoint: async (binding) => {
      validateWaveFinalizationBinding(binding);
      const checkpointPath = resolveInsideRoot(
        root,
        materialized.checkpointFile,
        "Finalized implementation checkpoint",
      ).fullPath;
      const checkpoint = await readJsonOptional(checkpointPath, "Finalized implementation checkpoint");
      validateCheckpoint(checkpoint, materialized.task);
      if (checkpoint.waveFinalization
          && WAVE_FINALIZATION_FIELDS.some((field) => checkpoint.waveFinalization[field] !== binding[field])) {
        throw new Error("Existing checkpoint Wave binding does not match the finalized Wave.");
      }
      if (!checkpoint.waveFinalization) {
        checkpoint.waveFinalization = binding;
        checkpoint.updatedAt = binding.finalizedAt;
        await writeAtomicJson(checkpointPath, checkpoint);
      }
    },
  });
  return {
    command: "finalize-wave",
    status: "ready-for-apply",
    stateFile: located.stateFile,
    ledgerFile,
    receiptFile: finalized.receiptFile,
    taskFile: materialized.taskFile,
    resultFile: materialized.resultFile,
    checkpointFile: materialized.checkpointFile,
    notesFile: materialized.notesFile,
    task: materialized.task,
  };
}

async function runAdapter(root, options) {
  const { located, phase } = await currentContext(root, options.stateFile);
  if (located.state.runtime.status !== "active" || !phase) {
    throw new Error(`Cannot run an adapter for a ${located.state.runtime.status} run.`);
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const taskFile = `${phaseRoot}/task.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const taskPath = resolveInsideRoot(root, taskFile, "Task file").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const task = await readJsonOptional(taskPath, "Task file");
  if (!task) throw new Error("Prepare the current phase before running an adapter.");
  validateTask(root, task, located.state, phase, phaseRoot);
  const specification = adapterSpecification(root, options.adapter);
  if (!specification || !task.allowedAdapters.includes(options.adapter)) {
    throw new Error(`Adapter '${options.adapter ?? ""}' is not allowed in phase '${phase.id}'.`);
  }
  if (!specification.phases.includes(phase.id)) {
    throw new Error(`Adapter '${options.adapter}' is not allowed in phase '${phase.id}'.`);
  }

  const startedAt = (options.now ?? (() => new Date().toISOString()))();
  const startedMs = Date.now();
  const invocation = {
    executable: specification.executable,
    args: [...specification.args],
    options: { cwd: specification.cwd, windowsHide: true, shell: false, maxBuffer: ADAPTER_MAX_BUFFER_BYTES },
  };
  let execution = await (options.execute ?? executeAdapter)(invocation);
  if (options.adapter === "no-build-required" && execution.exitCode === 0 && String(execution.stdout ?? "").trim()) {
    execution = {
      ...execution,
      exitCode: 1,
      stderr: [execution.stderr, "Backend or frontend changes require a build."].filter(Boolean).join("\n"),
    };
  }
  const finishedAt = (options.now ?? (() => new Date().toISOString()))();
  const evidence = {
    schemaVersion: "1.0",
    storyId: located.state.storyId,
    phase: phase.id,
    dispatchId: task.dispatchId,
    adapter: options.adapter,
    executable: specification.executable ?? "none",
    args: [...specification.args],
    cwd: normalizePath(specification.cwd),
    status: execution.exitCode === 0 ? "passed" : "failed",
    exitCode: execution.exitCode,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.now() - startedMs),
    stdout: String(execution.stdout ?? ""),
    stderr: String(execution.stderr ?? ""),
  };
  const evidencePath = `${phaseRoot}/evidence/${options.adapter}.json`;
  const evidenceFullPath = resolveInsideRoot(root, evidencePath, "Adapter evidence").fullPath;
  await writeAtomicJson(evidenceFullPath, evidence);
  const evidenceSha256 = await fileSha256(evidenceFullPath);

  if (phase.id === "unit-test") {
    await runStateCommand({
      root,
      command: "record",
      stateFile: located.stateFile,
      recordType: "test",
      status: evidence.status,
      path: evidencePath,
      message: `${options.adapter} exited with code ${evidence.exitCode}.`,
      actor: "story-runtime",
      now: options.now,
    });
  }

  const checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
  validateCheckpoint(checkpoint, task);
  checkpoint.adapterRuns = [
    ...(checkpoint.adapterRuns ?? []).filter((item) => item.adapter !== options.adapter),
    { adapter: options.adapter, status: evidence.status, evidencePath, sha256: evidenceSha256, finishedAt },
  ];
  checkpoint.updatedAt = finishedAt;
  await writeAtomicJson(checkpointPath, checkpoint);
  if (evidence.exitCode !== 0) {
    if (options.adapter === "no-build-required" && evidence.stderr.includes("Backend or frontend changes require a build.")) {
      throw new Error("Backend or frontend changes require a build.");
    }
    throw new Error(`Adapter '${options.adapter}' failed with exit code ${evidence.exitCode}.`);
  }
  return { command: "run-adapter", status: "passed", evidencePath, evidence };
}

async function validateResult(root, result, task, state, phaseRoot) {
  validateDispatchResultStructure(result);
  if (!result || typeof result !== "object"
      || result.schemaVersion !== "1.0"
      || result.dispatchId !== task.dispatchId
      || result.storyId !== state.storyId
      || result.phase !== state.phase) {
    throw new Error("Dispatch result does not match the current task.");
  }
  if (!["completed", "failed", "blocked"].includes(result.status)
      || typeof result.summary !== "string" || !result.summary.trim()
      || !Array.isArray(result.outputs) || !Array.isArray(result.records)) {
    throw new Error("Dispatch result has an invalid status or structure.");
  }
  const outputPaths = result.outputs.map((item) => item?.path);
  if (outputPaths.some((output) => typeof output !== "string")) {
    throw new Error("Dispatch result outputs must contain paths.");
  }
  const normalizedOutputs = outputPaths.map((output) => {
    const resolved = resolveInsideRoot(root, output, "Result output");
    if (!resolved.relative.startsWith(`${phaseRoot}/`)) {
      throw new Error(`Result output must stay inside the current phase directory: ${output}`);
    }
    return resolved.relative;
  });
  if (result.status === "completed"
      && JSON.stringify(normalizedOutputs) !== JSON.stringify(task.expectedOutputs)) {
    throw new Error("Completed result outputs do not match the required output set.");
  }
  if (result.status === "completed") {
    for (const output of normalizedOutputs) {
      const resolved = resolveInsideRoot(root, output, "Required output");
      const info = await lstat(resolved.fullPath).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) {
        throw new Error(`Required output is missing or invalid: ${resolved.relative}`);
      }
    }
  }
  if (result.status === "blocked") {
    for (const field of ["reason", "owner", "suggestedAction"]) {
      if (typeof result.blocker?.[field] !== "string" || !result.blocker[field].trim()) {
        throw new Error(`Blocked result requires blocker.${field}.`);
      }
    }
  }
  for (const record of result.records) {
    if (!record || !isDispatchRecordStatusAllowed(record.type, record.status)
        || typeof record.message !== "string") {
      throw new Error("Dispatch result contains an invalid record.");
    }
    if (record.type === "test" && !record.path) {
      throw new Error("Test result records require an evidence path.");
    }
    if (record.path) {
      const resolved = resolveInsideRoot(root, record.path, "Result record path");
      if (!resolved.relative.startsWith(`${phaseRoot}/`)) {
        throw new Error(`Result record must stay inside the current phase directory: ${record.path}`);
      }
      record.path = resolved.relative;
    }
  }
  result.outputs = normalizedOutputs.map((output) => ({ path: output }));
}

async function recordAlreadyPresent(root, state, record) {
  const actor = record.actor?.trim() || "codex";
  const existing = [...state.runtime.records].reverse().find((item) => (
    item.phase === state.phase
    && item.type === record.type
    && item.status === record.status
    && (item.path ?? null) === (record.path ?? null)
    && item.message === record.message.trim()
    && item.actor === actor
  ));
  if (!existing) return false;
  if (!record.path) return true;
  const evidence = resolveInsideRoot(root, record.path, "Record evidence");
  const info = await lstat(evidence.fullPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) return false;
  const sha256 = `sha256:${createHash("sha256").update(await readFile(evidence.fullPath)).digest("hex")}`;
  return existing.sha256 === sha256;
}

async function recordResultEvidence(root, stateFile, result, options) {
  for (const record of result.records) {
    const current = await runStateCommand({ root, command: "status", stateFile });
    if (await recordAlreadyPresent(root, current.state, record)) continue;
    await runStateCommand({
      root,
      command: "record",
      stateFile,
      recordType: record.type,
      status: record.status,
      path: record.path,
      message: record.message,
      actor: record.actor?.trim() || "codex",
      now: options.now,
    });
  }
}

async function assertPhaseGate(root, checkpoint, task, phaseId, phaseRoot, state) {
  const failed = (checkpoint.adapterRuns ?? []).find((item) => item.status === "failed");
  if (failed) throw new Error(`Cannot complete phase with failed adapter '${failed.adapter}'.`);
  for (const adapterRun of checkpoint.adapterRuns ?? []) {
    const expectedPath = `${phaseRoot}/evidence/${adapterRun.adapter}.json`;
    if (!(PHASE_ADAPTERS[phaseId] ?? []).includes(adapterRun.adapter)
        || adapterRun.status !== "passed"
        || adapterRun.evidencePath !== expectedPath) {
      throw new Error("Adapter evidence does not match the current phase.");
    }
    const evidencePath = resolveInsideRoot(root, adapterRun.evidencePath, "Adapter evidence").fullPath;
    const evidence = await readJsonOptional(evidencePath, "Adapter evidence");
    if (!evidence || adapterRun.sha256 !== await fileSha256(evidencePath)) {
      throw new Error(`Adapter evidence is missing or changed: ${adapterRun.evidencePath}`);
    }
    if (evidence.schemaVersion !== "1.0"
        || evidence.storyId !== state.storyId
        || evidence.phase !== phaseId
        || evidence.dispatchId !== task.dispatchId
        || evidence.adapter !== adapterRun.adapter
        || evidence.status !== "passed"
        || evidence.exitCode !== 0) {
      throw new Error(`Adapter evidence does not match its checkpoint: ${adapterRun.evidencePath}`);
    }
  }
  if (phaseId === "unit-test" && !(checkpoint.adapterRuns ?? []).length) {
    throw new Error("Cannot complete unit-test without at least one test adapter result.");
  }
  if (phaseId === "build-publish") {
    const buildAdapters = new Set(["backend-package", "frontend-build", "no-build-required"]);
    const buildResult = (checkpoint.adapterRuns ?? []).find((item) => buildAdapters.has(item.adapter));
    if (!buildResult) {
      throw new Error("Cannot complete build-publish without a build or no-build adapter result.");
    }
  }
  if (phaseId === "code-review") {
    const blockers = state.review.findings.filter((item) => item.severity === "BLOCKER" && item.status !== "resolved");
    if (blockers.length) throw new Error("Cannot complete code-review with unresolved BLOCKER findings.");
    const passedReview = [...state.runtime.records].reverse().find((item) => (
      item.phase === "code-review" && item.type === "review" && item.status === "passed" && item.path && item.sha256
    ));
    if (!passedReview) {
      throw new Error("Cannot complete code-review without a passed review record.");
    }
    const evidence = resolveInsideRoot(root, passedReview.path, "Review evidence");
    const info = await lstat(evidence.fullPath).catch(() => null);
    const sha256 = info?.isFile() && !info.isSymbolicLink()
      ? `sha256:${createHash("sha256").update(await readFile(evidence.fullPath)).digest("hex")}`
      : null;
    if (sha256 !== passedReview.sha256) {
      throw new Error("Cannot complete code-review: passed review evidence is missing or changed.");
    }
  }
}

async function reconcileAdvancedResult(root, located, workflow, options) {
  const previousPhase = workflow.phases.find((item) => item.id === located.state.runtime.previousPhase);
  if (!previousPhase || previousPhase.next.length !== 1) return null;
  const expectedCurrent = previousPhase.next[0];
  const stateAdvanced = expectedCurrent === located.state.phase
    || (expectedCurrent === "done" && located.state.phase === "done" && located.state.runtime.status === "completed");
  if (!stateAdvanced) return null;

  const phaseRoot = phaseDirectory(located.state, previousPhase);
  const task = await readJsonOptional(
    resolveInsideRoot(root, `${phaseRoot}/task.json`, "Previous task file").fullPath,
    "Previous task file",
  );
  const result = await readJsonOptional(
    resolveInsideRoot(root, `${phaseRoot}/result.json`, "Previous result file").fullPath,
    "Previous result file",
  );
  const checkpointPath = resolveInsideRoot(root, `${phaseRoot}/checkpoint.json`, "Previous checkpoint file").fullPath;
  const checkpoint = await readJsonOptional(checkpointPath, "Previous checkpoint file");
  const completedWave = checkpoint?.status === "completed" && checkpoint.waveFinalization;
  if (!task || !result || !checkpoint
      || (checkpoint.status !== "result-received" && !completedWave)) return null;

  const previousState = { ...located.state, phase: previousPhase.id };
  validateTask(root, task, previousState, previousPhase, phaseRoot);
  validateCheckpoint(checkpoint, task);
  await validateResult(root, result, task, previousState, phaseRoot);
  if (previousPhase.id === "implementation") {
    const expectedMode = checkpoint.waveFinalization
      ? "worktree-wave"
      : checkpoint.batchFinalization
        ? "serial-batch"
        : "ordinary";
    await assertImplementationOwner({
      root,
      state: {
        ...located.state,
        phase: previousPhase.id,
        runtime: {
          ...located.state.runtime,
          revision: task.preparedRevision,
        },
      },
      expectedMode,
      expectedOwnerId: checkpoint.waveFinalization?.waveId
        ?? checkpoint.batchFinalization?.batchId
        ?? task.dispatchId,
    });
  }
  await assertWaveFinalizationEvidence(root, located, previousPhase, task, checkpoint);
  await assertBatchFinalizationBeforeRecovery(root, located, previousPhase, task, checkpoint);
  if (result.status !== "completed") return null;
  if (completedWave) {
    return { command: "apply", status: "already-applied", stateFile: located.stateFile, state: located.state };
  }

  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  checkpoint.status = "completed";
  checkpoint.completedAt ??= timestamp;
  checkpoint.updatedAt = timestamp;
  await writeAtomicJson(checkpointPath, checkpoint);
  return { command: "apply", status: "already-applied", stateFile: located.stateFile, state: located.state };
}

async function applyResult(root, options) {
  const { located, phase, workflow } = await currentContext(root, options.stateFile);
  const reconciled = await reconcileAdvancedResult(root, located, workflow, options);
  if (reconciled) return reconciled;
  if (located.state.runtime.status !== "active" || !phase) {
    throw new Error(`Cannot apply a result to a ${located.state.runtime.status} run.`);
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const requestedResult = options.resultFile
    ? resolveInsideRoot(root, options.resultFile, "Result file").relative
    : resultFile;
  if (requestedResult !== resultFile) {
    throw new Error("Result file must be the current phase result.json.");
  }
  const taskPath = resolveInsideRoot(root, taskFile, "Task file").fullPath;
  const resultPath = resolveInsideRoot(root, resultFile, "Result file").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const task = await readJsonOptional(taskPath, "Task file");
  const result = await readJsonOptional(resultPath, "Result file");
  const checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
  if (!task || !result || !checkpoint) throw new Error("Prepare the phase and write result.json before apply.");
  validateTask(root, task, located.state, phase, phaseRoot);
  validateCheckpoint(checkpoint, task);
  await validateResult(root, result, task, located.state, phaseRoot);
  if (phase.id === "implementation") {
    const expectedMode = checkpoint.waveFinalization
      ? "worktree-wave"
      : checkpoint.batchFinalization
        ? "serial-batch"
        : "ordinary";
    await assertImplementationOwner({
      root,
      state: {
        ...located.state,
        runtime: {
          ...located.state.runtime,
          revision: task.preparedRevision,
        },
      },
      expectedMode,
      expectedOwnerId: checkpoint.waveFinalization?.waveId
        ?? checkpoint.batchFinalization?.batchId
        ?? task.dispatchId,
    });
  }
  await assertWaveFinalizationBeforeApply(root, located, phase, task, checkpoint);
  await assertBatchFinalizationBeforeApply(root, located, phase, task, checkpoint);

  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  checkpoint.status = "result-received";
  checkpoint.resultReceivedAt ??= timestamp;
  checkpoint.updatedAt = timestamp;
  await writeAtomicJson(checkpointPath, checkpoint);
  await recordResultEvidence(root, located.stateFile, result, options);

  if (result.status === "failed") {
    checkpoint.status = "failed";
    checkpoint.failedAt = timestamp;
    checkpoint.updatedAt = timestamp;
    await writeAtomicJson(checkpointPath, checkpoint);
    const current = await runStateCommand({ root, command: "status", stateFile: located.stateFile });
    return { command: "apply", status: "failed", stateFile: located.stateFile, state: current.state };
  }
  if (result.status === "blocked") {
    const blocked = await runStateCommand({
      root,
      command: "block",
      stateFile: located.stateFile,
      ...result.blocker,
      now: options.now,
    });
    checkpoint.status = "blocked";
    checkpoint.blockedAt = timestamp;
    checkpoint.updatedAt = timestamp;
    await writeAtomicJson(checkpointPath, checkpoint);
    return { command: "apply", status: "blocked", stateFile: located.stateFile, state: blocked.state };
  }

  const gateState = await runStateCommand({ root, command: "status", stateFile: located.stateFile });
  await assertPhaseGate(root, checkpoint, task, phase.id, phaseRoot, gateState.state);
  if (options.beforeAdvance) await options.beforeAdvance();
  const advanced = await runStateCommand({
    root,
    command: phase.next.includes("done") ? "complete" : "next",
    stateFile: located.stateFile,
    now: options.now,
  });
  if (options.afterAdvance) await options.afterAdvance(advanced);
  checkpoint.status = "completed";
  checkpoint.completedAt = timestamp;
  checkpoint.updatedAt = timestamp;
  await writeAtomicJson(checkpointPath, checkpoint);
  return { command: "apply", status: "completed", stateFile: located.stateFile, state: advanced.state };
}

export async function runStoryCommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.command === "prepare") return prepare(root, options);
  if (options.command === "prepare-batch") return prepareBatch(root, options);
  if (options.command === "prepare-wave") return prepareWave(root, options);
  if (options.command === "finalize-batch") return finalizeBatch(root, options);
  if (options.command === "finalize-wave") return finalizeWave(root, options);
  if (options.command === "run-adapter") return runAdapter(root, options);
  if (options.command === "apply") return applyResult(root, options);
  if (options.command === "status") {
    const { located, phase } = await currentContext(root, options.stateFile);
    return { command: "status", stateFile: located.stateFile, state: located.state, dispatch: await dispatchStatus(root, located, phase) };
  }
  throw new Error(`Unsupported story command: ${options.command ?? "(missing)"}`);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = {
    "--root": "root",
    "--state-file": "stateFile",
    "--adapter": "adapter",
    "--result-file": "resultFile",
    "--task-dag-file": "taskDagFile",
    "--batch-file": "batchFile",
    "--wave-index": "waveIndex",
    "--expected-integration-manifest-sha256": "expectedIntegrationManifestSha256",
    "--expected-integration-lock-sha256": "expectedIntegrationLockSha256",
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    const key = keyMap[token];
    if (!key || index + 1 >= tokens.length) throw new Error(`Unsupported or incomplete argument: ${token}`);
    options[key] = key === "waveIndex" ? Number(tokens[index + 1]) : tokens[index + 1];
    index += 1;
  }
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const result = await runStoryCommand(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Story command '${result.command}' completed for ${result.state?.storyId ?? result.task?.storyId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`Story command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
