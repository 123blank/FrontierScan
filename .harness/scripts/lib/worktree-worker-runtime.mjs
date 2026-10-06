import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  inspectBatchWorktreePlan,
  recordBatchInheritedSnapshot,
  recordBatchWorkerBlocked,
  recordBatchWorkerReady,
} from "./batch-runtime.mjs";
import { validateDispatchResultStructure, validateDispatchTaskStructure } from "./dispatch-contract.mjs";
import { loadTaskDag, matchesPredictedFile } from "./task-dag-contract.mjs";
import { loadWorkerPolicies, runWorkerTask } from "./worker-runtime.mjs";
import { runWorktreeCommand } from "./worktree-runtime.mjs";
import {
  assertAttemptOwned,
  recordWaveTaskBlocked,
  recordWaveTaskReady,
} from "./worktree-wave-execution-runtime.mjs";

const execFileAsync = promisify(execFile);
const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const CONTEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BATCH_MANIFEST_FIELDS = [
  "schemaVersion", "storyId", "runId", "phase", "batchId", "taskId", "dispatchId", "taskRoot", "baseCommit",
  "inheritedSnapshotSha256", "inheritedFiles", "inputs", "createdAt",
];

function resolveInsideRoot(root, relativeFile, label) {
  if (typeof relativeFile !== "string" || !relativeFile.trim() || path.isAbsolute(relativeFile)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const fullPath = path.resolve(root, relativeFile);
  const relative = path.relative(root, fullPath).replaceAll("\\", "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
}

async function readJson(root, relativeFile, label) {
  const resolved = resolveInsideRoot(root, relativeFile, label);
  const info = await lstat(resolved.fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  try {
    return JSON.parse(await readFile(resolved.fullPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

async function readJsonOptional(root, relativeFile, label) {
  const resolved = resolveInsideRoot(root, relativeFile, label);
  const info = await lstat(resolved.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  return readJson(root, relativeFile, label);
}

async function assertNoSymlink(root, fullPath, label) {
  const parts = path.relative(root, fullPath).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link.`);
  }
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must contain valid UTF-8.`);
  }
}

async function readInput(root, relativeFile, label) {
  const resolved = resolveInsideRoot(root, relativeFile, label);
  await assertNoSymlink(root, resolved.fullPath, label);
  const info = await lstat(resolved.fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  if (info.size > FILE_LIMIT_BYTES) throw new Error(`${label} exceeds the 2 MiB file limit.`);
  const buffer = await readFile(resolved.fullPath);
  return {
    ...resolved,
    buffer,
    bytes: buffer.byteLength,
    content: decodeUtf8(buffer, label),
    sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  };
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeAtomicJson(filePath, value) {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeImmutable(root, relativeFile, content, label) {
  const target = resolveInsideRoot(root, relativeFile, label);
  await mkdir(path.dirname(target.fullPath), { recursive: true });
  let handle;
  try {
    handle = await open(target.fullPath, "wx");
    await handle.writeFile(content);
    await handle.close();
    return false;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      const existing = await readFile(target.fullPath);
      if (Buffer.compare(existing, Buffer.from(content)) === 0) return true;
    }
    if (handle) await unlink(target.fullPath).catch(() => {});
    throw error;
  }
}

async function acquireExecutionLock(lockPath, options) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Worker execution lock already exists; inspect it before retrying.");
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

async function assertRetirementLockAbsent(lockPath) {
  const info = await lstat(lockPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (info) throw new Error(`Worktree retirement lock already exists: ${lockPath}`);
}

async function runGit(root, args) {
  return execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  });
}

function pathKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function pathMatchesPrefix(relativeFile, prefix) {
  const normalizedFile = pathKey(normalizePath(relativeFile));
  const normalizedPrefix = pathKey(normalizePath(prefix));
  return normalizedPrefix.endsWith("/") ? normalizedFile.startsWith(normalizedPrefix) : normalizedFile === normalizedPrefix;
}

function assertExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))
      || keys.some((field) => !fields.includes(field))) {
    throw new Error(`${label} contains unsupported fields or is missing required fields.`);
  }
}

async function listWorktreeChanges(worktreeRoot) {
  const result = await runGit(worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
  const tokens = String(result.stdout ?? "").split("\0").filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    const status = record.slice(0, 2);
    const relative = normalizePath(record.slice(3));
    if (status.includes("R") || status.includes("C")) {
      throw new Error(`Worker must not rename or copy Worktree files: ${relative}`);
    }
    if (status.includes("D")) throw new Error(`Worker must not delete Worktree files: ${relative}`);
    changes.push(relative);
  }
  return changes;
}

async function validateWorkerChanges(worktreeRoot, prepared, workerResult) {
  const candidatePaths = new Set(workerResult.files.map(pathKey));
  const allowed = new Set([
    ...prepared.manifest.inputs.filter((input) => input.source === "main-run").map((input) => pathKey(input.targetPath)),
    ...candidatePaths,
    pathKey(workerResult.resultFile),
  ]);
  for (const relative of await listWorktreeChanges(worktreeRoot)) {
    if (!allowed.has(pathKey(relative))) throw new Error(`Unexpected Worktree change: ${relative}`);
  }
  for (const input of prepared.manifest.inputs) {
    const current = await readInput(worktreeRoot, input.targetPath, "Worker input after execution");
    const declaredBaseCandidate = input.source === "worktree-base" && candidatePaths.has(pathKey(input.targetPath));
    if (current.sha256 !== input.sha256 && !declaredBaseCandidate) {
      throw new Error(`Worker modified an input file: ${input.targetPath}`);
    }
  }
}

async function sha256File(root, relativeFile, label) {
  return (await readInput(root, relativeFile, label)).sha256;
}

function workerFileKind(task, relativeFile) {
  if (task.expectedOutputs.includes(relativeFile)) return "phase-output";
  if (relativeFile.startsWith("backend/src/")) return "backend";
  if (relativeFile.startsWith("frontend/src/")) return "frontend";
  throw new Error(`Worker produced an unsupported collected path: ${relativeFile}`);
}

async function collectWorkerResult(root, worktreeRoot, inspected, state, task, prepared, workerResult, options) {
  const files = [];
  for (const relative of workerResult.files) {
    const loaded = await readInput(worktreeRoot, relative, "Worker collected file");
    files.push({ path: relative, sha256: loaded.sha256, bytes: loaded.bytes, kind: workerFileKind(task, relative) });
  }
  const hasBusinessFiles = files.some((file) => file.kind !== "phase-output");
  const outcome = hasBusinessFiles ? "ready-for-integration" : "ready-for-apply";
  if (!hasBusinessFiles) {
    for (const file of files) {
      const source = await readInput(worktreeRoot, file.path, "Worker phase output");
      await writeAtomic(resolveInsideRoot(root, file.path, "Main phase output").fullPath, source.buffer);
    }
  }
  const result = await readInput(worktreeRoot, workerResult.resultFile, "Worker result evidence");
  const evidenceDirectory = `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}`;
  const resultEvidenceFile = hasBusinessFiles ? `${evidenceDirectory}/worker-result.json` : workerResult.resultFile;
  await writeAtomic(resolveInsideRoot(root, resultEvidenceFile, "Collected Worker result").fullPath, result.buffer);

  const receiptFile = `${evidenceDirectory}/execution-receipt.json`;
  const receipt = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    taskId: options.taskId,
    dispatchId: task.dispatchId,
    phase: task.phase,
    ownerAgent: task.ownerAgent,
    baseCommit: inspected.plan.baseCommit,
    headCommit: inspected.status.headCommit,
    outcome,
    planSha256: await sha256File(root, inspected.planFile, "Worktree plan evidence"),
    statusSha256: await sha256File(root, inspected.statusFile, "Worktree status evidence"),
    inputManifestSha256: await sha256File(root, prepared.manifestFile, "Worker input manifest evidence"),
    resultEvidenceFile,
    resultSha256: result.sha256,
    files,
    completedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  await writeAtomicJson(resolveInsideRoot(root, receiptFile, "Worker execution receipt").fullPath, receipt);
  return { outcome: receipt.outcome, reused: false, manifestFile: prepared.manifestFile, receiptFile, resultFile: resultEvidenceFile, receipt };
}

async function reuseReceipt(root, worktreeRoot, inspected, state, task, receiptFile) {
  const receipt = await readJsonOptional(root, receiptFile, "Worker execution receipt");
  if (!receipt) return null;
  if (receipt.schemaVersion !== "1.0"
      || receipt.storyId !== state.storyId
      || receipt.runId !== state.runtime.runId
      || receipt.taskId !== inspected.plan.taskId
      || receipt.dispatchId !== task.dispatchId
      || receipt.phase !== task.phase
      || receipt.ownerAgent !== task.ownerAgent
      || receipt.baseCommit !== inspected.plan.baseCommit
      || receipt.headCommit !== inspected.status.headCommit
      || !["ready-for-apply", "ready-for-integration"].includes(receipt.outcome)
      || !Array.isArray(receipt.files)) {
    throw new Error("Existing Worker execution receipt does not match the current dispatch.");
  }
  const manifestFile = `.harness/runs/${state.runtime.runId}/worktrees/${inspected.plan.taskId}/input-manifest.json`;
  const manifest = await readJson(root, manifestFile, "Worker input manifest evidence");
  if (receipt.planSha256 !== await sha256File(root, inspected.planFile, "Worktree plan evidence")
      || receipt.inputManifestSha256 !== await sha256File(root, manifestFile, "Worker input manifest evidence")
      || receipt.resultSha256 !== await sha256File(root, receipt.resultEvidenceFile, "Collected Worker result")) {
    throw new Error("Existing Worker execution receipt evidence hash does not match current files.");
  }
  const fileKeys = new Set();
  for (const file of receipt.files) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" || fileKeys.has(pathKey(file.path))) {
      throw new Error("Existing Worker execution receipt contains an invalid file entry.");
    }
    fileKeys.add(pathKey(file.path));
    const current = await readInput(worktreeRoot, file.path, "Worktree receipt file");
    if (file.sha256 !== current.sha256 || file.bytes !== current.bytes || file.kind !== workerFileKind(task, file.path)) {
      throw new Error(`Existing Worker execution receipt file hash does not match: ${file.path}`);
    }
    if (receipt.outcome === "ready-for-apply"
        && file.sha256 !== await sha256File(root, file.path, "Collected phase output")) {
      throw new Error(`Collected phase output hash does not match the receipt: ${file.path}`);
    }
  }
  const expectedOutcome = receipt.files.some((file) => file.kind !== "phase-output") ? "ready-for-integration" : "ready-for-apply";
  const worktreeResultFile = `${path.posix.dirname(task.expectedOutputs[0])}/result.json`;
  const expectedResultEvidence = expectedOutcome === "ready-for-integration"
    ? `${path.posix.dirname(receiptFile)}/worker-result.json`
    : worktreeResultFile;
  if (receipt.outcome !== expectedOutcome || receipt.resultEvidenceFile !== expectedResultEvidence
      || receipt.resultSha256 !== await sha256File(worktreeRoot, worktreeResultFile, "Worktree Worker result")) {
    throw new Error("Existing Worker execution receipt outcome does not match its collected files.");
  }
  await validateWorkerChanges(worktreeRoot, { manifest }, {
    files: receipt.files.map((file) => file.path),
    resultFile: worktreeResultFile,
  });
  return {
    outcome: receipt.outcome,
    reused: true,
    manifestFile,
    receiptFile,
    resultFile: receipt.resultEvidenceFile,
    receipt,
  };
}

async function recoverWorkerResult(root, worktreeRoot, inspected, state, task, options) {
  const manifestFile = `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}/input-manifest.json`;
  const manifest = await readJsonOptional(root, manifestFile, "Worker input manifest");
  const resultFile = `${path.posix.dirname(resolveInsideRoot(root, options.taskFile, "Worker task file").relative)}/result.json`;
  const result = await readJsonOptional(worktreeRoot, resultFile, "Worktree Worker result");
  if (!result) return null;
  if (!manifest
      || manifest.schemaVersion !== "1.0"
      || manifest.storyId !== state.storyId
      || manifest.runId !== state.runtime.runId
      || manifest.taskId !== options.taskId
      || manifest.dispatchId !== task.dispatchId
      || manifest.baseCommit !== inspected.plan.baseCommit
      || manifest.worktreePath !== inspected.plan.worktreePath
      || !Array.isArray(manifest.inputs)) {
    throw new Error("Existing Worktree Worker result has no matching input manifest.");
  }
  validateDispatchResultStructure(result);
  if (result.dispatchId !== task.dispatchId || result.storyId !== task.storyId || result.phase !== task.phase) {
    throw new Error("Existing Worktree Worker result does not match the current dispatch.");
  }
  for (const input of manifest.inputs) {
    const current = await readInput(worktreeRoot, input.targetPath, "Recovered Worker input");
    if (current.sha256 !== input.sha256) throw new Error(`Recovered Worker input hash does not match: ${input.targetPath}`);
  }

  const inputPaths = new Set(manifest.inputs.map((input) => pathKey(input.targetPath)));
  const changes = await listWorktreeChanges(worktreeRoot);
  const files = changes.filter((relative) => pathKey(relative) !== pathKey(resultFile) && !inputPaths.has(pathKey(relative)));
  const resultOutputs = new Set(result.outputs.map((output) => pathKey(output.path)));
  const unrecorded = files.find((relative) => !resultOutputs.has(pathKey(relative)));
  if (unrecorded) {
    throw new Error(`M5-B1 cannot safely recover business writes without a durable candidate list: ${unrecorded}`);
  }
  for (const output of result.outputs) {
    if (!task.expectedOutputs.some((relative) => pathKey(relative) === pathKey(output.path))
        || !files.some((relative) => pathKey(relative) === pathKey(output.path))) {
      throw new Error(`Recovered Worker result output is missing from Worktree changes: ${output.path}`);
    }
  }
  return {
    prepared: { manifest, manifestFile },
    workerResult: { status: result.status, taskFile: options.taskFile, resultFile, files, result },
  };
}

async function reusePreparedInputs(root, worktreeRoot, inspected, state, task, options) {
  const manifestFile = options.inputManifestFile
    ?? `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}/input-manifest.json`;
  const manifest = await readJsonOptional(root, manifestFile, "Worker input manifest");
  if (!manifest) return null;
  if (manifest.schemaVersion !== "1.0"
      || manifest.storyId !== state.storyId
      || manifest.runId !== state.runtime.runId
      || manifest.taskId !== options.taskId
      || manifest.dispatchId !== task.dispatchId
      || manifest.baseCommit !== inspected.plan.baseCommit
      || manifest.worktreePath !== inspected.plan.worktreePath
      || !Array.isArray(manifest.inputs)
      || manifest.inputs[0]?.source !== "main-run"
      || manifest.inputs[0]?.targetPath !== resolveInsideRoot(root, options.taskFile, "Worker task file").relative) {
    throw new Error("Existing Worker input manifest does not match the current dispatch.");
  }
  const requestedContext = (options.contextFiles ?? []).map((item) => resolveInsideRoot(root, item, "Worker context file").relative);
  if (JSON.stringify(manifest.inputs.slice(1).map((input) => input.targetPath)) !== JSON.stringify(requestedContext)) {
    throw new Error("Existing Worker input manifest does not match the requested context files.");
  }
  for (const input of manifest.inputs) {
    const current = await readInput(worktreeRoot, input.targetPath, "Existing Worker input");
    if (current.sha256 !== input.sha256) throw new Error(`Existing Worker input hash does not match: ${input.targetPath}`);
  }
  const allowedChanges = new Set(manifest.inputs.filter((input) => input.source === "main-run").map((input) => pathKey(input.targetPath)));
  for (const relative of await listWorktreeChanges(worktreeRoot)) {
    if (!allowedChanges.has(pathKey(relative))) throw new Error(`Unexpected Worktree change before Provider retry: ${relative}`);
  }
  return { manifest, manifestFile, contextFiles: requestedContext };
}

async function prepareInputs(root, worktreeRoot, inspected, state, task, options) {
  const contextFiles = options.contextFiles ?? [];
  if (!Array.isArray(contextFiles)) throw new Error("Worker contextFiles must be an array.");
  const normalized = contextFiles.map((item) => resolveInsideRoot(root, item, "Worker context file").relative);
  if (new Set(normalized.map(pathKey)).size !== normalized.length) throw new Error("Worker contextFiles must be unique.");

  const clean = await runGit(worktreeRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (String(clean.stdout ?? "").trim()) throw new Error("The Worktree must be clean before its first Worker execution.");

  const preparedEntries = [];
  let totalBytes = 0;
  const mainRunPrefix = `.harness/runs/${state.runtime.runId}/`;
  const entries = [{ path: options.taskFile, source: "main-run" }, ...normalized.map((relative) => ({
    path: relative,
    source: pathMatchesPrefix(relative, mainRunPrefix) ? "main-run" : "worktree-base",
  }))];
  for (const entry of entries) {
    const sourceRoot = entry.source === "main-run" ? root : worktreeRoot;
    if (entry.source === "worktree-base") {
      await runGit(root, ["cat-file", "-e", `${inspected.plan.baseCommit}:${entry.path}`]).catch(() => {
        throw new Error(`Worker base context is not tracked at the planned commit: ${entry.path}`);
      });
    }
    const loaded = await readInput(sourceRoot, entry.path, "Worker input file");
    totalBytes += loaded.bytes;
    if (totalBytes > CONTEXT_LIMIT_BYTES) throw new Error("Worker inputs exceed the 8 MiB total limit.");
    const target = resolveInsideRoot(worktreeRoot, entry.path, "Worker input target");
    await assertNoSymlink(worktreeRoot, target.fullPath, "Worker input target");
    const targetInfo = await lstat(target.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (targetInfo && (!targetInfo.isFile() || targetInfo.isSymbolicLink())) {
      throw new Error(`Worker input target must be a regular file: ${target.relative}`);
    }
    preparedEntries.push({ entry, loaded, target });
  }

  for (const item of preparedEntries.filter((candidate) => candidate.entry.source === "main-run")) {
    await writeAtomic(item.target.fullPath, item.loaded.buffer);
  }
  const inputs = preparedEntries.map(({ entry, loaded, target }) => ({
      source: entry.source,
      sourcePath: entry.path,
      targetPath: target.relative,
      sha256: loaded.sha256,
      bytes: loaded.bytes,
  }));

  const evidenceDirectory = `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}`;
  const manifestFile = options.inputManifestFile ?? `${evidenceDirectory}/input-manifest.json`;
  const manifest = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    taskId: options.taskId,
    dispatchId: task.dispatchId,
    baseCommit: inspected.plan.baseCommit,
    worktreePath: inspected.plan.worktreePath,
    inputs,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  await writeAtomicJson(resolveInsideRoot(root, manifestFile, "Worker input manifest").fullPath, manifest);
  return { contextFiles: normalized, manifest, manifestFile };
}

function assertBatchTaskIdentity(root, state, task, taskFile, ledger) {
  const batchTask = ledger.tasks.find((candidate) => candidate.taskId === task.taskId);
  if (!batchTask) throw new Error(`Serial batch ledger does not contain task '${task.taskId}'.`);
  const resultFile = `${task.taskRoot}/result.json`;
  if (task.schemaVersion !== "1.1" || task.batchId !== ledger.batchId || task.storyId !== state.storyId
      || task.phase !== ledger.phase || task.ownerAgent !== batchTask.ownerAgent || task.taskRoot !== batchTask.taskRoot
      || taskFile !== batchTask.taskFile || resultFile !== batchTask.resultFile
      || JSON.stringify(task.expectedOutputs) !== JSON.stringify(batchTask.expectedOutputs)
      || task.dispatchId !== batchTask.dispatchId) {
    throw new Error("Task dispatch identity does not match the serial batch ledger.");
  }
  return batchTask;
}

function assertBatchCheckpoint(checkpoint, task, batchTask) {
  if (checkpoint.schemaVersion !== "1.0" || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId || checkpoint.phase !== task.phase
      || checkpoint.status !== "prepared" || checkpoint.preparedAt !== task.preparedAt
      || checkpoint.updatedAt !== task.preparedAt || batchTask.checkpointFile !== `${task.taskRoot}/checkpoint.json`) {
    throw new Error("Task checkpoint identity does not match the serial batch dispatch.");
  }
}

async function loadBatchWorkerContext(root, state, task, taskFile, options, allowReadyTransitionLock = false) {
  if (options.taskId !== task.taskId) {
    throw new Error("Batch Worker taskId must match the Worker task file identity.");
  }
  if (state.runtime?.status !== "active" || state.storyId !== task.storyId
      || state.phase !== task.phase
      || state.runtime?.revision !== task.preparedRevision) {
    throw new Error("M3 task identity must match the active Story and phase.");
  }
  const batch = await inspectBatchWorktreePlan({
    root,
    stateFile: options.stateFile,
    allowReadyTransitionLock,
  });
  if (state.runtime?.runId !== batch.ledger.runId) {
    throw new Error("M3 task runtime runId must match the serial batch ledger.");
  }
  const batchTask = assertBatchTaskIdentity(root, state, task, taskFile, batch.ledger);
  const checkpoint = await readJson(root, batchTask.checkpointFile, "Task checkpoint");
  assertBatchCheckpoint(checkpoint, task, batchTask);
  if (batchTask.status !== "running") throw new Error("Only a claimed running task may execute the batch Worker.");
  const inspected = await runWorktreeCommand({
    root,
    command: "batch-status",
    stateFile: options.stateFile,
    allowReadyTransitionLock,
  });
  if (inspected.status.state !== "created") throw new Error("The planned batch Worktree must be created before Worker execution.");
  if (inspected.plan.batchId !== batch.ledger.batchId || inspected.plan.baseCommit !== batch.ledger.baseCommit
      || inspected.plan.branch !== batch.plan.branch || inspected.plan.worktreePath !== batch.plan.worktreePath
      || inspected.status.branch !== batch.plan.branch || inspected.status.worktreePath !== batch.plan.worktreePath
      || inspected.status.baseCommit !== batch.ledger.baseCommit || inspected.status.headCommit !== batch.ledger.baseCommit) {
    throw new Error("Batch Worktree status does not match the verified serial batch plan.");
  }
  return { batch, batchTask, checkpoint, inspected };
}

function batchExecutionLockFile(task) {
  return `${path.posix.dirname(task.executionReceiptFile)}/execute.lock`;
}

function batchInputManifestFile(task) {
  return `${path.posix.dirname(task.executionReceiptFile)}/task-start-manifest.json`;
}

function batchPreviousArtifacts(ledger, task) {
  const index = ledger.tasks.indexOf(task);
  if (index < 0) throw new Error("Serial batch task is not part of its ledger.");
  return ledger.tasks.slice(0, index).flatMap((previous) => [
    previous.taskFile,
    previous.checkpointFile,
    previous.reportFile,
    previous.resultFile,
  ]);
}

function uniqueRepositoryPaths(root, values, label) {
  const paths = [];
  const keys = new Set();
  for (const value of values) {
    const resolved = resolveInsideRoot(root, value, label);
    const key = pathKey(resolved.relative);
    if (keys.has(key)) continue;
    keys.add(key);
    paths.push(resolved.relative);
  }
  return paths;
}

async function assertRegularWritableTarget(root, relativeFile, label) {
  const target = resolveInsideRoot(root, relativeFile, label);
  await assertNoSymlink(root, target.fullPath, label);
  const info = await lstat(target.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`${label} must be a regular file target.`);
  return target;
}

async function readBatchSnapshot(root, batchTask) {
  const source = await readInput(root, batchTask.inheritedSnapshotFile, "Batch inherited snapshot");
  let snapshot;
  try {
    snapshot = JSON.parse(source.content);
  } catch {
    throw new Error("Batch inherited snapshot contains invalid JSON.");
  }
  if (source.sha256 !== batchTask.inheritedSnapshotSha256
      || snapshot.taskId !== batchTask.taskId
      || snapshot.dispatchId !== batchTask.dispatchId
      || snapshot.taskRoot !== batchTask.taskRoot
      || !Array.isArray(snapshot.inheritedFiles)) {
    throw new Error("Batch inherited snapshot does not match the claimed task.");
  }
  return { source, snapshot };
}

async function readRootArtifactHashes(root, relativeFiles) {
  const hashes = new Map();
  for (const relativeFile of relativeFiles) {
    const source = await readInput(root, relativeFile, "Prior task artifact");
    hashes.set(pathKey(relativeFile), { path: relativeFile, sha256: source.sha256 });
  }
  return hashes;
}

async function validateBatchWorktreeChanges({
  root,
  worktreeRoot,
  ledger,
  batchTask,
  snapshot,
  immutableInputs = [],
  candidatePaths = [],
  allowResult = false,
  allowMissingImmutableInputs = false,
}) {
  const inherited = new Map(snapshot.inheritedFiles.map((file) => [pathKey(file.path), file]));
  const priorArtifacts = await readRootArtifactHashes(root, batchPreviousArtifacts(ledger, batchTask));
  const immutable = new Map(immutableInputs.map((file) => [pathKey(file.path), file]));
  const allowed = new Set([
    ...inherited.keys(),
    ...priorArtifacts.keys(),
    ...immutable.keys(),
    ...candidatePaths.map(pathKey),
  ]);
  if (allowResult) allowed.add(pathKey(batchTask.resultFile));

  for (const relativeFile of await listWorktreeChanges(worktreeRoot)) {
    if (!allowed.has(pathKey(relativeFile))) {
      throw new Error(`Unexpected batch Worktree change: ${relativeFile}`);
    }
  }
  for (const artifact of priorArtifacts.values()) {
    const current = await readInput(worktreeRoot, artifact.path, "Prior task artifact in batch Worktree");
    if (current.sha256 !== artifact.sha256) {
      throw new Error(`Batch Worktree changed a prior task artifact: ${artifact.path}`);
    }
  }
  for (const input of immutable.values()) {
    const location = resolveInsideRoot(worktreeRoot, input.path, "Batch Worker input");
    const info = await lstat(location.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info && allowMissingImmutableInputs) continue;
    const current = await readInput(worktreeRoot, input.path, "Batch Worker input");
    if (current.sha256 !== input.sha256) {
      throw new Error(`Batch Worktree changed an immutable Worker input: ${input.path}`);
    }
  }
  const candidates = new Set(candidatePaths.map(pathKey));
  for (const inheritedFile of inherited.values()) {
    const mainCurrent = await readInput(root, inheritedFile.path, "Inherited main repository file");
    if (mainCurrent.sha256 !== inheritedFile.sha256 || mainCurrent.bytes !== inheritedFile.bytes) {
      throw new Error(`Inherited main repository file hash drifted: ${inheritedFile.path}`);
    }
    const current = await readInput(worktreeRoot, inheritedFile.path, "Inherited batch Worktree file");
    if ((current.sha256 !== inheritedFile.sha256 || current.bytes !== inheritedFile.bytes)
        && !candidates.has(pathKey(inheritedFile.path))) {
      throw new Error(`Inherited batch Worktree file hash drifted: ${inheritedFile.path}`);
    }
  }
}

async function prepareBatchWorkerInputs(root, worktreeRoot, state, ledger, batchTask, snapshot, options) {
  const context = await batchContextFiles(root, worktreeRoot, state, batchTask, snapshot, options);
  const { contextFiles, inheritedPaths, inputPaths, mainRunPrefix } = context;
  const inheritedKeys = new Set(inheritedPaths.map(pathKey));
  const inputs = [];
  const immutableInputs = [];

  for (const relativeFile of inputPaths) {
    const sourceRoot = relativeFile === batchTask.taskFile || relativeFile === batchTask.checkpointFile || pathMatchesPrefix(relativeFile, mainRunPrefix)
      ? root
      : worktreeRoot;
    const source = await readInput(sourceRoot, relativeFile, "Batch Worker input");
    const target = await assertRegularWritableTarget(worktreeRoot, relativeFile, "Batch Worker input target");
    if (sourceRoot === root) await writeAtomic(target.fullPath, source.buffer);
    const input = {
      source: sourceRoot === root ? "main-run" : "worktree-base",
      sourcePath: relativeFile,
      targetPath: target.relative,
      sha256: source.sha256,
      bytes: source.bytes,
    };
    inputs.push(input);
    if (!inheritedKeys.has(pathKey(target.relative))) immutableInputs.push({ path: target.relative, sha256: source.sha256 });
  }

  const manifestFile = batchInputManifestFile(batchTask);
  const manifest = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    phase: ledger.phase,
    batchId: ledger.batchId,
    taskId: batchTask.taskId,
    dispatchId: batchTask.dispatchId,
    taskRoot: batchTask.taskRoot,
    baseCommit: ledger.baseCommit,
    inheritedSnapshotSha256: batchTask.inheritedSnapshotSha256,
    inheritedFiles: snapshot.inheritedFiles,
    inputs,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  await writeAtomicJson(resolveInsideRoot(root, manifestFile, "Batch Worker input manifest").fullPath, manifest);
  return { contextFiles, immutableInputs, manifest, manifestFile };
}

async function batchContextFiles(root, worktreeRoot, state, batchTask, snapshot, options) {
  const requestedContext = options.contextFiles ?? [];
  if (!Array.isArray(requestedContext)) throw new Error("Worker contextFiles must be an array.");
  const normalizedContext = uniqueRepositoryPaths(root, requestedContext, "Worker context file");
  const inheritedPaths = uniqueRepositoryPaths(root, snapshot.inheritedFiles.map((file) => file.path), "Inherited snapshot file");
  const policy = (await loadWorkerPolicies({ root: worktreeRoot })).get(batchTask.ownerAgent);
  if (!policy) throw new Error(`Batch Worker owner '${batchTask.ownerAgent}' has no policy.`);
  for (const relativeFile of normalizedContext) {
    if (!policy.readPathPrefixes.some((prefix) => pathMatchesPrefix(relativeFile, prefix))) {
      throw new Error(`Worker context file is not allowed by the '${policy.name}' read policy: ${relativeFile}`);
    }
  }
  const readableInheritedPaths = inheritedPaths.filter((relativeFile) => (
    policy.readPathPrefixes.some((prefix) => pathMatchesPrefix(relativeFile, prefix))
  ));
  const contextFiles = uniqueRepositoryPaths(root, [...readableInheritedPaths, ...normalizedContext], "Worker context file");
  const mainRunPrefix = `.harness/runs/${state.runtime.runId}/`;
  const explicitContext = new Set(normalizedContext.map(pathKey));
  let contextBytes = (await readInput(root, batchTask.taskFile, "Batch Worker task file")).bytes
    + Buffer.byteLength(JSON.stringify(policy), "utf8");
  for (const relativeFile of contextFiles) {
    const sourceRoot = explicitContext.has(pathKey(relativeFile)) && pathMatchesPrefix(relativeFile, mainRunPrefix)
      ? root
      : worktreeRoot;
    contextBytes += (await readInput(sourceRoot, relativeFile, "Batch Worker context file")).bytes;
    if (contextBytes > CONTEXT_LIMIT_BYTES) throw new Error("Worker context exceeds the 8 MiB total limit.");
  }
  return {
    normalizedContext,
    inheritedPaths,
    contextFiles,
    inputPaths: uniqueRepositoryPaths(root, [batchTask.taskFile, batchTask.checkpointFile, ...normalizedContext], "Batch Worker input"),
    mainRunPrefix,
  };
}

async function declaredBatchImmutableInputs(root, worktreeRoot, state, batchTask, snapshot, options) {
  const { inheritedPaths, inputPaths, mainRunPrefix } = await batchContextFiles(
    root,
    worktreeRoot,
    state,
    batchTask,
    snapshot,
    options,
  );
  const inheritedKeys = new Set(inheritedPaths.map(pathKey));
  const immutableInputs = [];
  for (const relativeFile of inputPaths) {
    const sourceRoot = relativeFile === batchTask.taskFile || relativeFile === batchTask.checkpointFile
        || pathMatchesPrefix(relativeFile, mainRunPrefix)
      ? root
      : worktreeRoot;
    const source = await readInput(sourceRoot, relativeFile, "Declared batch Worker input");
    if (!inheritedKeys.has(pathKey(relativeFile))) {
      immutableInputs.push({ path: relativeFile, sha256: source.sha256 });
    }
  }
  return immutableInputs;
}

async function reuseBatchWorkerInputs(root, worktreeRoot, state, ledger, batchTask, snapshot, options) {
  const manifestFile = batchInputManifestFile(batchTask);
  const manifest = await readJsonOptional(root, manifestFile, "Batch Worker input manifest");
  if (!manifest) return null;
  assertExactFields(manifest, BATCH_MANIFEST_FIELDS, "Batch Worker input manifest");
  if (manifest.schemaVersion !== "1.0" || manifest.storyId !== state.storyId || manifest.runId !== state.runtime.runId
      || manifest.phase !== ledger.phase || manifest.batchId !== ledger.batchId || manifest.taskId !== batchTask.taskId
      || manifest.dispatchId !== batchTask.dispatchId || manifest.taskRoot !== batchTask.taskRoot
      || manifest.baseCommit !== ledger.baseCommit || manifest.inheritedSnapshotSha256 !== batchTask.inheritedSnapshotSha256
      || JSON.stringify(manifest.inheritedFiles) !== JSON.stringify(snapshot.inheritedFiles)
      || typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.inputs)) {
    throw new Error("Existing batch Worker input manifest does not match the claimed task.");
  }
  const expected = await batchContextFiles(root, worktreeRoot, state, batchTask, snapshot, options);
  if (manifest.inputs.length !== expected.inputPaths.length) {
    throw new Error("Existing batch Worker input manifest does not match the requested context files.");
  }
  const inheritedKeys = new Set(snapshot.inheritedFiles.map((file) => pathKey(file.path)));
  const immutableInputs = [];
  for (let index = 0; index < manifest.inputs.length; index += 1) {
    const input = manifest.inputs[index];
    assertExactFields(input, ["source", "sourcePath", "targetPath", "sha256", "bytes"], "Batch Worker input manifest entry");
    const expectedPath = expected.inputPaths[index];
    const expectedSource = expectedPath === batchTask.taskFile || expectedPath === batchTask.checkpointFile
        || pathMatchesPrefix(expectedPath, expected.mainRunPrefix) ? "main-run" : "worktree-base";
    if (input.source !== expectedSource || input.sourcePath !== expectedPath || input.targetPath !== expectedPath
        || !SHA256_PATTERN.test(input.sha256) || !Number.isInteger(input.bytes) || input.bytes < 0) {
      throw new Error("Existing batch Worker input manifest does not match the requested context files.");
    }
    const current = await readInput(worktreeRoot, input.targetPath, "Existing batch Worker input");
    if (current.sha256 !== input.sha256 || current.bytes !== input.bytes) {
      throw new Error(`Existing batch Worker input hash does not match: ${input.targetPath}`);
    }
    if (input.source === "main-run") {
      const source = await readInput(root, input.sourcePath, "Main batch Worker input");
      if (source.sha256 !== input.sha256 || source.bytes !== input.bytes) {
        throw new Error(`Main batch Worker input hash does not match: ${input.sourcePath}`);
      }
    }
    if (!inheritedKeys.has(pathKey(input.targetPath))) {
      immutableInputs.push({ path: input.targetPath, sha256: input.sha256 });
    }
  }
  return { contextFiles: expected.contextFiles, immutableInputs, manifest, manifestFile };
}

function validateBatchWorkerResult(ledger, batchTask, result) {
  validateDispatchResultStructure(result);
  if (result.schemaVersion !== "1.1" || result.storyId !== ledger.storyId || result.phase !== ledger.phase
      || result.batchId !== ledger.batchId || result.taskId !== batchTask.taskId || result.taskRoot !== batchTask.taskRoot
      || result.dispatchId !== batchTask.dispatchId) {
    throw new Error("Batch Worker result does not match the claimed task.");
  }
  if (result.status === "completed" && JSON.stringify(result.outputs.map((output) => output.path)) !== JSON.stringify(batchTask.expectedOutputs)) {
    throw new Error("Completed batch Worker result outputs do not match the task output set.");
  }
  if (result.status === "blocked" && !result.blocker) throw new Error("Blocked batch Worker result requires blocker details.");
  for (const output of result.outputs) {
    if (!batchTask.expectedOutputs.includes(output.path)) {
      throw new Error(`Batch Worker result output is outside the task: ${output.path}`);
    }
  }
  return result;
}

function assertRecoveredCandidatePath(batchTask, relativeFile) {
  const kind = workerFileKind(batchTask, relativeFile);
  if (kind !== "phase-output" && !batchTask.predictedFiles.some((predicted) => matchesPredictedFile(predicted, relativeFile))) {
    throw new Error(`Recovered batch Worker candidate is outside the task predicted files: ${relativeFile}`);
  }
  return kind;
}

async function recoveredBatchCandidatePaths(root, worktreeRoot, ledger, batchTask, snapshot, immutableInputs) {
  const inherited = new Map(snapshot.inheritedFiles.map((file) => [pathKey(file.path), file]));
  const priorArtifacts = new Set(batchPreviousArtifacts(ledger, batchTask).map(pathKey));
  const immutable = new Set(immutableInputs.map((file) => pathKey(file.path)));
  const candidates = [];
  for (const relativeFile of await listWorktreeChanges(worktreeRoot)) {
    const key = pathKey(relativeFile);
    if (key === pathKey(batchTask.resultFile) || priorArtifacts.has(key) || immutable.has(key)) continue;
    const inheritedFile = inherited.get(key);
    if (inheritedFile) {
      const current = await readInput(worktreeRoot, relativeFile, "Recovered inherited batch Worktree file");
      if (current.sha256 === inheritedFile.sha256 && current.bytes === inheritedFile.bytes) continue;
    }
    assertRecoveredCandidatePath(batchTask, relativeFile);
    candidates.push(relativeFile);
  }
  return candidates;
}

async function recoverBatchWorkerResult(root, worktreeRoot, ledger, batchTask, snapshot, prepared) {
  const result = await readJsonOptional(worktreeRoot, batchTask.resultFile, "Batch Worker result");
  if (!result) return null;
  validateBatchWorkerResult(ledger, batchTask, result);
  const files = await recoveredBatchCandidatePaths(root, worktreeRoot, ledger, batchTask, snapshot, prepared.immutableInputs);
  await validateBatchWorktreeChanges({
    root,
    worktreeRoot,
    ledger,
    batchTask,
    snapshot,
    immutableInputs: prepared.immutableInputs,
    candidatePaths: files,
    allowResult: true,
  });
  return { status: result.status, taskFile: batchTask.taskFile, resultFile: batchTask.resultFile, files, result };
}

async function reuseBatchWorkerReceipt(root, worktreeRoot, state, batch, batchTask, snapshot, prepared) {
  const receipt = await readJsonOptional(root, batchTask.executionReceiptFile, "Serial batch Worker execution receipt");
  if (!receipt) return null;
  if (receipt.schemaVersion !== "1.0" || receipt.storyId !== state.storyId || receipt.runId !== state.runtime.runId
      || receipt.taskId !== batchTask.taskId || receipt.dispatchId !== batchTask.dispatchId || receipt.phase !== batch.ledger.phase
      || receipt.ownerAgent !== batchTask.ownerAgent || receipt.baseCommit !== batch.ledger.baseCommit
      || receipt.outcome !== "ready-for-integration" || receipt.inheritedSnapshotSha256 !== batchTask.inheritedSnapshotSha256
      || receipt.resultEvidenceFile !== batchTask.resultFile || !SHA256_PATTERN.test(receipt.resultSha256)
      || !Array.isArray(receipt.files)) {
    throw new Error("Existing serial batch Worker execution receipt does not match the claimed task.");
  }
  if (receipt.inputManifestSha256 !== await sha256File(root, prepared.manifestFile, "Batch Worker input manifest evidence")) {
    throw new Error("Existing serial batch Worker execution receipt input manifest hash does not match.");
  }
  const seen = new Set();
  const files = [];
  for (const file of receipt.files) {
    assertExactFields(file, ["path", "sha256", "bytes", "kind"], "Serial batch Worker execution receipt file");
    const resolved = resolveInsideRoot(root, file.path, "Serial batch Worker execution receipt file");
    if (seen.has(pathKey(resolved.relative)) || !SHA256_PATTERN.test(file.sha256)
        || !Number.isInteger(file.bytes) || file.bytes < 0 || workerFileKind(batchTask, resolved.relative) !== file.kind) {
      throw new Error("Existing serial batch Worker execution receipt contains an invalid file entry.");
    }
    assertRecoveredCandidatePath(batchTask, resolved.relative);
    const current = await readInput(worktreeRoot, resolved.relative, "Existing serial batch Worker receipt file");
    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) {
      throw new Error(`Existing serial batch Worker receipt file hash does not match: ${resolved.relative}`);
    }
    seen.add(pathKey(resolved.relative));
    files.push(resolved.relative);
  }
  const result = await readInput(worktreeRoot, batchTask.resultFile, "Existing serial batch Worker result");
  if (result.sha256 !== receipt.resultSha256) throw new Error("Existing serial batch Worker result hash does not match the receipt.");
  const collected = await readInput(root, batchTask.resultFile, "Collected serial batch Worker result");
  if (collected.sha256 !== receipt.resultSha256) throw new Error("Collected serial batch Worker result hash does not match the receipt.");
  const parsedResult = JSON.parse(result.content);
  validateBatchWorkerResult(batch.ledger, batchTask, parsedResult);
  if (parsedResult.status !== "completed") throw new Error("Existing serial batch Worker receipt requires a completed result.");
  await validateBatchWorktreeChanges({
    root,
    worktreeRoot,
    ledger: batch.ledger,
    batchTask,
    snapshot,
    immutableInputs: prepared.immutableInputs,
    candidatePaths: files,
    allowResult: true,
  });
  return { receipt, resultFile: batchTask.resultFile, files };
}

async function collectBatchWorkerResult(root, worktreeRoot, state, batch, batchTask, snapshot, inspected, prepared, workerResult, options) {
  const candidateKeys = new Set(workerResult.files.map(pathKey));
  const missingOutput = batchTask.expectedOutputs.find((output) => !candidateKeys.has(pathKey(output)));
  if (missingOutput) {
    throw new Error(`Completed batch Worker result is missing an expected output file: ${missingOutput}`);
  }
  const files = [];
  for (const relativeFile of workerResult.files) {
    const source = await readInput(worktreeRoot, relativeFile, "Batch Worker collected file");
    files.push({ path: relativeFile, sha256: source.sha256, bytes: source.bytes, kind: workerFileKind(batchTask, relativeFile) });
  }
  if (!files.some((file) => file.kind !== "phase-output")) {
    throw new Error("Serial batch Worker requires at least one business candidate before integration.");
  }
  const result = await readInput(worktreeRoot, workerResult.resultFile, "Batch Worker result evidence");
  for (const file of files.filter((item) => item.kind === "phase-output")) {
    const source = await readInput(worktreeRoot, file.path, "Batch Worker phase output");
    await writeAtomic(resolveInsideRoot(root, file.path, "Collected batch phase output").fullPath, source.buffer);
  }
  await writeAtomic(resolveInsideRoot(root, batchTask.resultFile, "Collected batch Worker result").fullPath, result.buffer);

  const receipt = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    taskId: batchTask.taskId,
    dispatchId: batchTask.dispatchId,
    phase: batch.ledger.phase,
    ownerAgent: batchTask.ownerAgent,
    baseCommit: batch.ledger.baseCommit,
    headCommit: inspected.status.headCommit,
    outcome: "ready-for-integration",
    planSha256: await sha256File(root, batch.planFile, "Serial batch Worktree plan evidence"),
    statusSha256: await sha256File(root, inspected.statusFile, "Serial batch Worktree status evidence"),
    inputManifestSha256: await sha256File(root, prepared.manifestFile, "Batch Worker input manifest evidence"),
    inheritedSnapshotSha256: batchTask.inheritedSnapshotSha256,
    resultEvidenceFile: batchTask.resultFile,
    resultSha256: result.sha256,
    files,
    completedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  await writeAtomicJson(resolveInsideRoot(root, batchTask.executionReceiptFile, "Serial batch Worker execution receipt").fullPath, receipt);
  return {
    outcome: receipt.outcome,
    reused: false,
    manifestFile: prepared.manifestFile,
    receiptFile: batchTask.executionReceiptFile,
    resultFile: batchTask.resultFile,
    receipt,
  };
}

async function collectBatchWorkerBlockedResult(root, worktreeRoot, batchTask, workerResult) {
  const result = await readInput(worktreeRoot, workerResult.resultFile, "Blocked batch Worker result evidence");
  await writeAtomic(resolveInsideRoot(root, batchTask.resultFile, "Collected blocked batch Worker result").fullPath, result.buffer);
  return { resultFile: batchTask.resultFile, result };
}

async function recheckBatchWorkerReadiness(root, state, task, taskFile, current, prepared, snapshot, candidatePaths, options) {
  const refreshed = await loadBatchWorkerContext(root, state, task, taskFile, options, true);
  if (refreshed.batch.batchFile !== current.batch.batchFile
      || refreshed.batchTask.taskId !== current.batchTask.taskId
      || refreshed.batchTask.inheritedSnapshotSha256 !== current.batchTask.inheritedSnapshotSha256) {
    throw new Error("Serial batch Worker context changed before readiness could be recorded.");
  }
  const worktreeRoot = resolveInsideRoot(root, refreshed.inspected.plan.worktreePath, "Batch Worktree path").fullPath;
  await assertNoSymlink(root, worktreeRoot, "Batch Worktree path");
  await validateBatchWorktreeChanges({
    root,
    worktreeRoot,
    ledger: refreshed.batch.ledger,
    batchTask: refreshed.batchTask,
    snapshot,
    immutableInputs: prepared.immutableInputs,
    candidatePaths,
    allowResult: true,
  });
  return refreshed;
}

async function recordCheckedBatchWorkerReady(root, state, task, taskFile, current, prepared, snapshot, candidatePaths, options) {
  return recordBatchWorkerReady({
    root,
    stateFile: options.stateFile,
    batchFile: current.batch.batchFile,
    taskId: task.taskId,
    executionReceiptFile: current.batchTask.executionReceiptFile,
    now: options.now,
    beforeReadyTransition: options.beforeReadyTransition,
    verifyWorktreeReadiness: () => recheckBatchWorkerReadiness(
      root,
      state,
      task,
      taskFile,
      current,
      prepared,
      snapshot,
      candidatePaths,
      options,
    ),
  });
}

async function runBatchWorktreeWorker(root, state, task, taskFile, options) {
  const initial = await loadBatchWorkerContext(root, state, task, taskFile, options);
  const lockPath = resolveInsideRoot(root, batchExecutionLockFile(initial.batchTask), "Batch Worker execution lock").fullPath;
  await acquireExecutionLock(lockPath, options);
  try {
    const snapshotRecorded = await recordBatchInheritedSnapshot({
      root,
      stateFile: options.stateFile,
      batchFile: initial.batch.batchFile,
      taskId: task.taskId,
      now: options.now,
    });
    const current = await loadBatchWorkerContext(root, state, task, taskFile, options);
    const batchTask = current.batchTask;
    if (batchTask.inheritedSnapshotSha256 !== snapshotRecorded.task.inheritedSnapshotSha256) {
      throw new Error("Recorded inherited snapshot does not match the claimed serial batch task.");
    }
    const worktreeRoot = resolveInsideRoot(root, current.inspected.plan.worktreePath, "Batch Worktree path").fullPath;
    await assertNoSymlink(root, worktreeRoot, "Batch Worktree path");
    const snapshot = await readBatchSnapshot(root, batchTask);
    let prepared = await reuseBatchWorkerInputs(
      root,
      worktreeRoot,
      state,
      current.batch.ledger,
      batchTask,
      snapshot.snapshot,
      options,
    );
    const reusedPrepared = Boolean(prepared);
    if (!prepared) {
      await listWorktreeChanges(worktreeRoot);
      const immutableInputs = await declaredBatchImmutableInputs(
        root,
        worktreeRoot,
        state,
        batchTask,
        snapshot.snapshot,
        options,
      );
      await validateBatchWorktreeChanges({
        root,
        worktreeRoot,
        ledger: current.batch.ledger,
        batchTask,
        snapshot: snapshot.snapshot,
        immutableInputs,
        allowMissingImmutableInputs: true,
      });
      prepared = await prepareBatchWorkerInputs(root, worktreeRoot, state, current.batch.ledger, batchTask, snapshot.snapshot, options);
      await validateBatchWorktreeChanges({
        root,
        worktreeRoot,
        ledger: current.batch.ledger,
        batchTask,
        snapshot: snapshot.snapshot,
        immutableInputs: prepared.immutableInputs,
      });
    }

    const existingReceipt = await reuseBatchWorkerReceipt(
      root,
      worktreeRoot,
      state,
      current.batch,
      batchTask,
      snapshot.snapshot,
      prepared,
    );
    if (existingReceipt) {
      const ready = await recordCheckedBatchWorkerReady(
        root,
        state,
        task,
        taskFile,
        current,
        prepared,
        snapshot.snapshot,
        existingReceipt.files,
        options,
      );
      return {
        outcome: existingReceipt.receipt.outcome,
        reused: true,
        manifestFile: prepared.manifestFile,
        receiptFile: batchTask.executionReceiptFile,
        resultFile: existingReceipt.resultFile,
        receipt: existingReceipt.receipt,
        ledger: ready.ledger,
        task: ready.task,
      };
    }
    const recovered = await recoverBatchWorkerResult(
      root,
      worktreeRoot,
      current.batch.ledger,
      batchTask,
      snapshot.snapshot,
      prepared,
    );
    if (recovered) {
      if (recovered.status !== "completed") {
        const blocked = await collectBatchWorkerBlockedResult(root, worktreeRoot, batchTask, recovered);
        const recorded = await recordBatchWorkerBlocked({
          root,
          stateFile: options.stateFile,
          batchFile: current.batch.batchFile,
          taskId: task.taskId,
          resultFile: blocked.resultFile,
          now: options.now,
        });
        return {
          outcome: "blocked",
          reused: recorded.reused,
          resultFile: blocked.resultFile,
          ledger: recorded.ledger,
          task: recorded.task,
        };
      }
      const collected = await collectBatchWorkerResult(
        root,
        worktreeRoot,
        state,
        current.batch,
        batchTask,
        snapshot.snapshot,
        current.inspected,
        prepared,
        recovered,
        options,
      );
      const ready = await recordCheckedBatchWorkerReady(
        root,
        state,
        task,
        taskFile,
        current,
        prepared,
        snapshot.snapshot,
        collected.receipt.files.map((file) => file.path),
        options,
      );
      return { ...collected, ledger: ready.ledger, task: ready.task };
    }
    if (reusedPrepared) {
      await validateBatchWorktreeChanges({
        root,
        worktreeRoot,
        ledger: current.batch.ledger,
        batchTask,
        snapshot: snapshot.snapshot,
        immutableInputs: prepared.immutableInputs,
      });
    }

    const workerResult = await runWorkerTask({
      root: worktreeRoot,
      taskFile: batchTask.taskFile,
      provider: options.provider,
      timeoutMs: options.timeoutMs,
      contextFiles: prepared.contextFiles,
      predictedFiles: batchTask.predictedFiles,
    });
    await validateBatchWorktreeChanges({
      root,
      worktreeRoot,
      ledger: current.batch.ledger,
      batchTask,
      snapshot: snapshot.snapshot,
      immutableInputs: prepared.immutableInputs,
      candidatePaths: workerResult.files,
      allowResult: true,
    });
    if (workerResult.status !== "completed") {
      const blocked = await collectBatchWorkerBlockedResult(root, worktreeRoot, batchTask, workerResult);
      const recorded = await recordBatchWorkerBlocked({
        root,
        stateFile: options.stateFile,
        batchFile: current.batch.batchFile,
        taskId: task.taskId,
        resultFile: blocked.resultFile,
        now: options.now,
      });
      return {
        outcome: "blocked",
        reused: recorded.reused,
        resultFile: blocked.resultFile,
        ledger: recorded.ledger,
        task: recorded.task,
      };
    }
    if (options.afterWorker) await options.afterWorker();
    const collected = await collectBatchWorkerResult(
      root,
      worktreeRoot,
      state,
      current.batch,
      batchTask,
      snapshot.snapshot,
      current.inspected,
      prepared,
      workerResult,
      options,
    );
    if (options.beforeRecordWorkerReady) await options.beforeRecordWorkerReady();
    const ready = await recordCheckedBatchWorkerReady(
      root,
      state,
      task,
      taskFile,
      current,
      prepared,
      snapshot.snapshot,
      collected.receipt.files.map((file) => file.path),
      options,
    );
    return { ...collected, ledger: ready.ledger, task: ready.task };
  } finally {
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function waveOwnerOptions(root, task, options) {
  const lockFile = `${task.taskRoot}/execute.lock`;
  if (typeof options.ledgerFile !== "string"
      || typeof options.attemptId !== "string"
      || typeof options.claimId !== "string"
      || typeof options.lockId !== "string"
      || typeof options.expectedExecutionLockSha256 !== "string"
      || !SHA256_PATTERN.test(options.expectedExecutionLockSha256)
      || typeof options.expectedCreationReceiptSha256 !== "string"
      || !SHA256_PATTERN.test(options.expectedCreationReceiptSha256)) {
    throw new Error("Wave Worker requires the current ledger, attempt owner, lock hash, and creation receipt hash.");
  }
  return {
    root,
    ledgerFile: options.ledgerFile,
    taskId: task.taskId,
    attemptId: options.attemptId,
    claimId: options.claimId,
    lockId: options.lockId,
    lockFile,
    expectedExecutionLockSha256: options.expectedExecutionLockSha256,
    expectedCreationReceiptSha256: options.expectedCreationReceiptSha256,
  };
}

async function loadWaveWorkerContext(root, state, task, taskFile, options) {
  if (options.taskId !== task.taskId) throw new Error("Wave Worker taskId must match the dispatch identity.");
  if (state.runtime?.status !== "active"
      || state.storyId !== task.storyId
      || state.runtime?.runId !== task.runId
      || state.phase !== task.phase
      || state.runtime?.revision !== task.preparedRevision) {
    throw new Error("Wave Worker dispatch must match the active implementation Story revision.");
  }
  const ownerOptions = waveOwnerOptions(root, task, options);
  const owner = await assertAttemptOwned(ownerOptions);
  if (owner.task.taskFile !== taskFile || owner.task.dispatchId !== task.dispatchId) {
    throw new Error("Wave Worker dispatch does not match the current ledger task.");
  }
  const checkpoint = await readJson(root, owner.task.checkpointFile, "Wave task checkpoint");
  if (checkpoint.schemaVersion !== "1.2"
      || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId
      || checkpoint.runId !== task.runId
      || checkpoint.phase !== task.phase
      || checkpoint.waveId !== task.waveId
      || checkpoint.waveIndex !== task.waveIndex
      || checkpoint.taskId !== task.taskId
      || checkpoint.taskRoot !== task.taskRoot
      || checkpoint.status !== "prepared"
      || checkpoint.preparedAt !== task.preparedAt) {
    throw new Error("Wave task checkpoint does not match the current dispatch.");
  }
  const inspected = await runWorktreeCommand({
    root,
    command: "wave-status",
    stateFile: options.stateFile,
    taskDagFile: owner.ledger.taskDagFile,
    waveIndex: owner.ledger.waveIndex,
  });
  if (inspected.planFile !== owner.ledger.wavePlanFile
      || inspected.status.state !== "ready"
      || inspected.status.wavePlanSha256 !== owner.ledger.wavePlanSha256
      || inspected.plan.baseCommit !== owner.ledger.baseCommit) {
    throw new Error("Wave Worker Worktree status does not match the execution ledger.");
  }
  const planTask = inspected.plan.tasks.find((item) => item.taskId === task.taskId);
  const statusTask = inspected.status.tasks.find((item) => item.taskId === task.taskId);
  if (!planTask
      || !statusTask
      || statusTask.state !== "created"
      || statusTask.headCommit !== owner.ledger.baseCommit
      || planTask.ownerAgent !== task.ownerAgent) {
    throw new Error("Wave Worker task Worktree does not match the current dispatch.");
  }
  const creationReceipt = await readJson(root, owner.ledger.creationReceiptFile, "Wave creation receipt");
  const receiptTask = creationReceipt.tasks?.find((item) => item.taskId === task.taskId);
  if (creationReceipt.schemaVersion !== "1.0"
      || creationReceipt.storyId !== task.storyId
      || creationReceipt.runId !== task.runId
      || creationReceipt.wave !== task.waveIndex
      || creationReceipt.planSha256 !== owner.ledger.wavePlanSha256
      || creationReceipt.taskDagSha256 !== owner.ledger.taskDagSha256
      || creationReceipt.baseCommit !== owner.ledger.baseCommit
      || receiptTask?.branch !== planTask.branch
      || receiptTask?.worktreePath !== planTask.worktreePath
      || receiptTask?.headCommit !== owner.ledger.baseCommit) {
    throw new Error("Wave creation receipt does not match the current task Worktree.");
  }
  return {
    owner,
    ownerOptions,
    checkpoint,
    inspected,
    planTask,
    worktreeRoot: resolveInsideRoot(root, planTask.worktreePath, "Wave task Worktree path").fullPath,
  };
}

async function executeWaveWorktreeWorker(root, state, task, taskFile, options, current) {
  const guard = (allowedStatuses) => assertAttemptOwned({
    ...current.ownerOptions,
    allowedStatuses,
  });
  const inputOptions = {
    ...options,
    inputManifestFile: current.owner.paths.inputSnapshotFile,
  };
  const prepared = await reusePreparedInputs(
    root,
    current.worktreeRoot,
    { plan: current.planTask },
    state,
    task,
    inputOptions,
  ) ?? await prepareInputs(
    root,
    current.worktreeRoot,
    { plan: current.planTask },
    state,
    task,
    inputOptions,
  );
  const workerResult = await runWorkerTask({
    root: current.worktreeRoot,
    taskFile,
    provider: options.provider,
    timeoutMs: options.timeoutMs,
    contextFiles: prepared.contextFiles,
    predictedFiles: current.planTask.predictedFiles,
    resultFile: current.owner.paths.resultFile,
    beforeCommit: async (entry) => {
      if (options.beforeWaveCommit) await options.beforeWaveCommit(entry);
      await guard(["running"]);
    },
    afterFilesWritten: options.afterFilesWritten,
  });
  await validateWorkerChanges(current.worktreeRoot, prepared, workerResult);
  const head = await runGit(current.worktreeRoot, ["rev-parse", "HEAD"]);
  if (String(head.stdout ?? "").trim() !== current.owner.ledger.baseCommit) {
    throw new Error("Wave task Worktree HEAD changed during Worker execution.");
  }
  if (workerResult.status !== "completed") {
    throw new Error(`Wave Worker returned '${workerResult.status}' and requires blocked-attempt handling.`);
  }
  if (options.afterWorker) await options.afterWorker();

  const files = [];
  for (const relative of workerResult.files) {
    const loaded = await readInput(current.worktreeRoot, relative, "Wave Worker candidate");
    files.push({
      path: relative,
      sha256: loaded.sha256,
      bytes: loaded.bytes,
      kind: workerFileKind(task, relative),
    });
  }
  const result = await readInput(
    current.worktreeRoot,
    current.owner.paths.resultFile,
    "Wave Worker result",
  );
  await guard(["running"]);
  await writeImmutable(root, current.owner.paths.resultFile, result.buffer, "Wave attempt result");
  const inputSnapshotSha256 = await sha256File(
    root,
    current.owner.paths.inputSnapshotFile,
    "Wave task input snapshot",
  );
  const receipt = {
    schemaVersion: "1.0",
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    waveId: task.waveId,
    waveIndex: task.waveIndex,
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    attemptId: options.attemptId,
    claimId: options.claimId,
    lockId: options.lockId,
    baseCommit: current.owner.ledger.baseCommit,
    worktreePath: current.planTask.worktreePath,
    headCommit: current.owner.ledger.baseCommit,
    inputSnapshotFile: current.owner.paths.inputSnapshotFile,
    inputSnapshotSha256,
    resultFile: current.owner.paths.resultFile,
    resultSha256: result.sha256,
    outcome: "ready-for-integration",
    files,
    completedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  if (options.beforeExecutionReceiptWrite) await options.beforeExecutionReceiptWrite();
  await guard(["running"]);
  await writeImmutable(
    root,
    current.owner.paths.receiptFile,
    `${JSON.stringify(receipt, null, 2)}\n`,
    "Wave task execution receipt",
  );
  const receiptSha256 = await sha256File(
    root,
    current.owner.paths.receiptFile,
    "Wave task execution receipt",
  );
  if (options.beforeLedgerReadyWrite) await options.beforeLedgerReadyWrite();
  const ready = await recordWaveTaskReady({
    ...current.ownerOptions,
    expectedExecutionReceiptSha256: receiptSha256,
    now: options.now,
  });
  if (options.beforeExecutionLockRelease) await options.beforeExecutionLockRelease();
  await guard(["ready-for-integration"]);
  if (await sha256File(root, current.owner.paths.lockFile, "Wave task execution lock")
      !== options.expectedExecutionLockSha256) {
    throw new Error("Wave task execution lock changed before release.");
  }
  await unlink(resolveInsideRoot(root, current.owner.paths.lockFile, "Wave task execution lock").fullPath);
  return {
    outcome: "ready-for-integration",
    reused: false,
    inputSnapshotFile: current.owner.paths.inputSnapshotFile,
    resultFile: current.owner.paths.resultFile,
    receiptFile: current.owner.paths.receiptFile,
    receipt,
    ledger: ready.ledger,
    task: ready.task,
  };
}

async function blockWaveWorktreeWorker(root, task, options, current, error) {
  for (const relativeFile of [current.owner.paths.resultFile, current.owner.paths.receiptFile]) {
    const info = await lstat(resolveInsideRoot(root, relativeFile, "Wave attempt evidence").fullPath)
      .catch((readError) => readError?.code === "ENOENT" ? null : Promise.reject(readError));
    if (info) throw error;
  }
  try {
    await assertAttemptOwned(current.ownerOptions);
  } catch {
    throw error;
  }
  const failure = {
    schemaVersion: "1.0",
    storyId: task.storyId,
    runId: task.runId,
    waveId: task.waveId,
    taskId: task.taskId,
    attemptId: options.attemptId,
    claimId: options.claimId,
    lockId: options.lockId,
    status: "blocked",
    reason: error instanceof Error ? error.message : String(error),
    claimSha256: await sha256File(root, current.owner.paths.claimFile, "Wave attempt claim"),
    executionLockSha256: options.expectedExecutionLockSha256,
    recoveredAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  if (options.beforeFailureWrite) await options.beforeFailureWrite();
  await assertAttemptOwned(current.ownerOptions);
  await writeImmutable(
    root,
    current.owner.paths.failureFile,
    `${JSON.stringify(failure, null, 2)}\n`,
    "Wave attempt failure",
  );
  if (options.afterFailureWriteBeforeLedgerBlock) {
    await options.afterFailureWriteBeforeLedgerBlock();
  }
  const blocked = await recordWaveTaskBlocked({
    ...current.ownerOptions,
    expectedFailureSha256: await sha256File(root, current.owner.paths.failureFile, "Wave attempt failure"),
    now: options.now,
  });
  if (options.beforeExecutionLockRelease) await options.beforeExecutionLockRelease();
  await assertAttemptOwned({
    ...current.ownerOptions,
    allowedStatuses: ["blocked"],
  });
  if (await sha256File(root, current.owner.paths.lockFile, "Wave task execution lock")
      !== options.expectedExecutionLockSha256) {
    throw new Error("Wave task execution lock changed before blocked release.");
  }
  await unlink(resolveInsideRoot(root, current.owner.paths.lockFile, "Wave task execution lock").fullPath);
  return {
    outcome: "blocked",
    reused: false,
    failureFile: current.owner.paths.failureFile,
    failure,
    ledger: blocked.ledger,
    task: blocked.task,
  };
}

async function runWaveWorktreeWorker(root, state, task, taskFile, options) {
  const current = await loadWaveWorkerContext(root, state, task, taskFile, options);
  try {
    return await executeWaveWorktreeWorker(root, state, task, taskFile, options, current);
  } catch (error) {
    return blockWaveWorktreeWorker(root, task, options, current, error);
  }
}

export async function runWorktreeWorker(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const state = await readJson(root, options.stateFile, "Harness state file");
  const task = await readJson(root, options.taskFile, "Worker task file");
  validateDispatchTaskStructure(task);
  const taskFile = resolveInsideRoot(root, options.taskFile, "Worker task file").relative;
  if (task.schemaVersion === "1.2") {
    return runWaveWorktreeWorker(root, state, task, taskFile, options);
  }
  if (task.schemaVersion === "1.1") {
    if (options.allowReadyTransitionLock !== undefined) {
      throw new Error("allowReadyTransitionLock is reserved for internal readiness-transition checks.");
    }
    return runBatchWorktreeWorker(root, state, task, taskFile, options);
  }
  if (state.runtime?.status !== "active") throw new Error("M5-B1 requires an active Harness state.");
  if (state.storyId !== task.storyId || state.runtime?.runId !== task.storyId || state.phase !== task.phase) {
    throw new Error("M3 task identity must match the active Story and phase.");
  }
  if (state.runtime?.revision !== task.preparedRevision) {
    throw new Error("M3 task prepared revision must match the active Harness revision.");
  }
  const checkpointFile = `${path.posix.dirname(taskFile)}/checkpoint.json`;
  const checkpoint = await readJson(root, checkpointFile, "M3 checkpoint");
  if (checkpoint.schemaVersion !== "1.0"
      || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId
      || checkpoint.phase !== task.phase
      || checkpoint.status !== "prepared") {
    throw new Error("M3 checkpoint must match the prepared dispatch before Worker execution.");
  }
  const inspected = await runWorktreeCommand({
    root,
    command: "status",
    stateFile: options.stateFile,
    taskId: options.taskId,
  });
  if (inspected.status.state !== "created") throw new Error("The planned Worktree must be created before Worker execution.");
  const loaded = await loadTaskDag(resolveInsideRoot(root, inspected.plan.taskDagFile, "Task DAG file").fullPath);
  if (loaded.nodes.size !== 1) throw new Error("M5-B1 requires exactly one task in the Task DAG.");
  const dagTask = loaded.nodes.get(options.taskId);
  if (dagTask?.ownerAgent !== task.ownerAgent) {
    throw new Error("Task DAG owner must match the M3 task owner.");
  }
  const worktreeRoot = resolveInsideRoot(root, inspected.plan.worktreePath, "Worktree path").fullPath;
  const receiptFile = `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}/execution-receipt.json`;
  const reused = await reuseReceipt(root, worktreeRoot, inspected, state, task, receiptFile);
  if (reused) return reused;
  const lockFile = `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}/execute.lock`;
  const lockPath = resolveInsideRoot(root, lockFile, "Worker execution lock").fullPath;
  await acquireExecutionLock(lockPath, options);
  try {
    await assertRetirementLockAbsent(path.join(path.dirname(lockPath), "retire.lock"));
    const recovered = await recoverWorkerResult(root, worktreeRoot, inspected, state, task, options);
    if (recovered) {
      await validateWorkerChanges(worktreeRoot, recovered.prepared, recovered.workerResult);
      return collectWorkerResult(root, worktreeRoot, inspected, state, task, recovered.prepared, recovered.workerResult, options);
    }
    const prepared = await reusePreparedInputs(root, worktreeRoot, inspected, state, task, options)
      ?? await prepareInputs(root, worktreeRoot, inspected, state, task, options);
    const workerResult = await runWorkerTask({
      root: worktreeRoot,
      taskFile: resolveInsideRoot(root, options.taskFile, "Worker task file").relative,
      provider: options.provider,
      timeoutMs: options.timeoutMs,
      contextFiles: prepared.contextFiles,
    });
    await validateWorkerChanges(worktreeRoot, prepared, workerResult);
    if (options.afterWorker) await options.afterWorker();
    return collectWorkerResult(root, worktreeRoot, inspected, state, task, prepared, workerResult, options);
  } finally {
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
