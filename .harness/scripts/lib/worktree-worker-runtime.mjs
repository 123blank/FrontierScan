import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateDispatchResultStructure, validateDispatchTaskStructure } from "./dispatch-contract.mjs";
import { loadTaskDag } from "./task-dag-contract.mjs";
import { runWorkerTask } from "./worker-runtime.mjs";
import { runWorktreeCommand } from "./worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const CONTEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

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
  await writeFile(temporary, content);
  await rename(temporary, filePath);
}

async function writeAtomicJson(filePath, value) {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: (options.now ?? (() => new Date().toISOString()))() })}\n`, "utf8");
  await handle.close();
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

async function listWorktreeChanges(worktreeRoot) {
  const result = await runGit(worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
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
  const manifestFile = `.harness/runs/${state.runtime.runId}/worktrees/${options.taskId}/input-manifest.json`;
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
    source: relative.startsWith(mainRunPrefix) ? "main-run" : "worktree-base",
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
  const manifestFile = `${evidenceDirectory}/input-manifest.json`;
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

export async function runWorktreeWorker(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const state = await readJson(root, options.stateFile, "Harness state file");
  const task = await readJson(root, options.taskFile, "Worker task file");
  validateDispatchTaskStructure(task);
  if (state.runtime?.status !== "active") throw new Error("M5-B1 requires an active Harness state.");
  if (state.storyId !== task.storyId || state.runtime?.runId !== task.storyId || state.phase !== task.phase) {
    throw new Error("M3 task identity must match the active Story and phase.");
  }
  if (state.runtime?.revision !== task.preparedRevision) {
    throw new Error("M3 task prepared revision must match the active Harness revision.");
  }
  const taskFile = resolveInsideRoot(root, options.taskFile, "Worker task file").relative;
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
