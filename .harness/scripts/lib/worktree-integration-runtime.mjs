import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateDispatchResultStructure, validateDispatchTaskStructure } from "./dispatch-contract.mjs";
import { loadTaskDag } from "./task-dag-contract.mjs";
import { runWorktreeCommand } from "./worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const BUNDLE_LIMIT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function pathKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

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

function normalizeArtifactPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a normalized repository-relative path.`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must be a normalized repository-relative path.`);
  }
  return normalized;
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

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function readRegularFile(root, relativeFile, label, options = {}) {
  const resolved = resolveInsideRoot(root, relativeFile, label);
  await assertNoSymlink(root, resolved.fullPath, label);
  const info = await lstat(resolved.fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  const limit = options.limit ?? FILE_LIMIT_BYTES;
  if (info.size > limit) throw new Error(`${label} exceeds the ${limit === FILE_LIMIT_BYTES ? "2 MiB" : "configured"} limit.`);
  const buffer = await readFile(resolved.fullPath);
  if (options.utf8 !== false) decodeUtf8(buffer, label);
  return { ...resolved, buffer, bytes: buffer.byteLength, sha256: sha256(buffer) };
}

async function readJson(root, relativeFile, label) {
  const loaded = await readRegularFile(root, relativeFile, label);
  try {
    return { ...loaded, value: JSON.parse(decodeUtf8(loaded.buffer, label)) };
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

async function acquireIntegrationLock(lockPath, options) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Integration lock already exists; inspect it before retrying.");
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      pid: process.pid,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
    })}\n`, "utf8");
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    throw error;
  }
  await handle.close();
}

async function runGit(root, args) {
  return execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    encoding: "buffer",
  });
}

async function gitObject(root, commit, relativeFile) {
  try {
    await runGit(root, ["cat-file", "-e", `${commit}:${relativeFile}`]);
  } catch (error) {
    if (error?.code === 128) return null;
    throw new Error(`Cannot inspect base content for ${relativeFile}.`);
  }
  const result = await runGit(root, ["show", `${commit}:${relativeFile}`]);
  return Buffer.from(result.stdout ?? []);
}

async function gitPathMatchesCommit(root, commit, relativeFile) {
  try {
    await runGit(root, ["diff", "--quiet", "--no-ext-diff", commit, "--", relativeFile]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw new Error(`Cannot compare base content for ${relativeFile}.`);
  }
}

function validateIdentity(state, task, checkpoint) {
  validateDispatchTaskStructure(task);
  if (state?.runtime?.status !== "active") throw new Error("M5-B2 requires an active Harness state.");
  if (state.storyId !== task.storyId || state.runtime.runId !== task.storyId || state.phase !== task.phase) {
    throw new Error("M3 task identity must match the active Story and phase.");
  }
  if (state.runtime.revision !== task.preparedRevision) {
    throw new Error("M3 task prepared revision must match the active Harness revision.");
  }
  if (checkpoint?.schemaVersion !== "1.0"
      || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId
      || checkpoint.phase !== task.phase
      || checkpoint.status !== "prepared") {
    throw new Error("M3 checkpoint must match the prepared dispatch before integration.");
  }
}

function validateReceiptIdentity(receipt, state, task, taskId, worktreePlan) {
  if (receipt?.schemaVersion !== "1.0"
      || receipt.storyId !== state.storyId
      || receipt.runId !== state.runtime.runId
      || receipt.taskId !== taskId
      || receipt.dispatchId !== task.dispatchId
      || receipt.phase !== task.phase
      || receipt.ownerAgent !== task.ownerAgent
      || receipt.baseCommit !== worktreePlan.baseCommit
      || receipt.headCommit !== worktreePlan.baseCommit
      || !Array.isArray(receipt.files)) {
    throw new Error("M5-B1 execution receipt identity does not match the current dispatch.");
  }
  if (receipt.outcome !== "ready-for-integration") {
    throw new Error("M5-B2 requires a ready-for-integration Worker receipt.");
  }
}

function assertUniqueArtifacts(artifacts) {
  const keys = new Set();
  for (const artifact of artifacts) {
    const key = pathKey(artifact.path);
    if (keys.has(key)) throw new Error(`Integration artifacts contain a duplicate path: ${artifact.path}`);
    for (const existing of keys) {
      if (key.startsWith(`${existing}/`) || existing.startsWith(`${key}/`)) {
        throw new Error(`Integration artifacts contain a parent/child path conflict: ${artifact.path}`);
      }
    }
    keys.add(key);
  }
}

function artifactPriority(kind) {
  if (kind === "backend" || kind === "frontend") return 0;
  if (kind === "phase-output") return 1;
  return 2;
}

function integrationPaths(state, taskId) {
  const taskDirectory = `.harness/runs/${state.runtime.runId}/worktrees/${taskId}`;
  const directory = `${taskDirectory}/integration`;
  return {
    taskDirectory,
    directory,
    planFile: `${directory}/plan.json`,
    statusFile: `${directory}/status.json`,
    receiptFile: `${directory}/integration-receipt.json`,
    lockFile: `${directory}/integrate.lock`,
    worktreePlanFile: `${taskDirectory}/plan.json`,
    worktreeStatusFile: `${taskDirectory}/status.json`,
    manifestFile: `${taskDirectory}/input-manifest.json`,
    executionReceiptFile: `${taskDirectory}/execution-receipt.json`,
  };
}

function validateStoredPlan(plan, context) {
  const requiredStrings = [
    "schemaVersion", "storyId", "runId", "taskId", "dispatchId", "phase", "ownerAgent", "stateFile",
    "baseCommit", "worktreePath", "taskDagFile", "taskDagSha256", "taskFile", "taskSha256",
    "checkpointFile", "checkpointSha256", "worktreePlanFile", "worktreePlanSha256", "inputManifestFile",
    "inputManifestSha256", "executionReceiptFile", "executionReceiptSha256", "workerResultEvidenceFile",
    "workerResultSha256", "resultFile", "plannedAt",
  ];
  if (!plan || typeof plan !== "object" || requiredStrings.some((field) => typeof plan[field] !== "string")
      || plan.schemaVersion !== "1.0" || !Number.isInteger(plan.preparedRevision) || !Array.isArray(plan.artifacts)) {
    throw new Error("Existing integration plan has an invalid structure.");
  }
  const expectedPlanFields = [...requiredStrings, "preparedRevision", "artifacts"];
  if (Object.keys(plan).length !== expectedPlanFields.length || expectedPlanFields.some((field) => !(field in plan))) {
    throw new Error("Existing integration plan must contain only the supported fields.");
  }
  const expectedResultFile = `${path.posix.dirname(context.taskFile)}/result.json`;
  if (plan.storyId !== context.state.storyId || plan.runId !== context.state.runtime.runId
      || plan.taskId !== context.taskId || plan.dispatchId !== context.task.dispatchId
      || plan.phase !== context.task.phase || plan.ownerAgent !== context.task.ownerAgent
      || plan.stateFile !== context.stateFile || plan.preparedRevision !== context.task.preparedRevision
      || plan.taskFile !== context.taskFile || plan.checkpointFile !== context.checkpointFile
      || plan.worktreePlanFile !== context.paths.worktreePlanFile
      || plan.inputManifestFile !== context.paths.manifestFile
      || plan.executionReceiptFile !== context.paths.executionReceiptFile) {
    throw new Error("Existing integration plan identity does not match the current dispatch.");
  }
  if (plan.resultFile !== expectedResultFile) {
    throw new Error("Integration result must use the fixed result.json for the current M3 task.");
  }
  const artifactFields = ["baseSha256", "bundlePath", "bytes", "candidateSha256", "kind", "path"];
  for (const artifact of plan.artifacts) {
    if (!artifact || typeof artifact !== "object"
        || JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(artifactFields)
        || typeof artifact.path !== "string" || !["backend", "frontend", "phase-output", "result"].includes(artifact.kind)
        || !(artifact.baseSha256 === null || SHA256_PATTERN.test(artifact.baseSha256))
        || !SHA256_PATTERN.test(artifact.candidateSha256) || !Number.isInteger(artifact.bytes)
        || artifact.bytes < 0 || artifact.bytes > FILE_LIMIT_BYTES || typeof artifact.bundlePath !== "string") {
      throw new Error("Existing integration plan contains an invalid artifact mapping.");
    }
  }
  assertUniqueArtifacts(plan.artifacts);
  if (plan.artifacts.filter((item) => item.kind === "result").length !== 1
      || !plan.artifacts.some((item) => item.kind === "backend" || item.kind === "frontend")) {
    throw new Error("Existing integration plan must contain one result and at least one business artifact.");
  }
}

async function loadContext(root, options) {
  if (typeof options.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.taskId)) {
    throw new Error("taskId must be a valid Harness identifier.");
  }
  const stateFile = resolveInsideRoot(root, options.stateFile, "Harness state file").relative;
  const taskFile = resolveInsideRoot(root, options.taskFile, "M3 task file").relative;
  const checkpointFile = `${path.posix.dirname(taskFile)}/checkpoint.json`;
  const stateLoaded = await readJson(root, stateFile, "Harness state file");
  const taskLoaded = await readJson(root, taskFile, "M3 task file");
  const checkpointLoaded = await readJson(root, checkpointFile, "M3 checkpoint");
  validateIdentity(stateLoaded.value, taskLoaded.value, checkpointLoaded.value);
  return {
    state: stateLoaded.value,
    stateFile,
    task: taskLoaded.value,
    taskFile,
    taskLoaded,
    checkpoint: checkpointLoaded.value,
    checkpointFile,
    checkpointLoaded,
    taskId: options.taskId,
    paths: integrationPaths(stateLoaded.value, options.taskId),
  };
}

async function validatePlanReuse(root, context, existing) {
  validateStoredPlan(existing.value, context);
  const plan = existing.value;
  const evidence = [
    [plan.taskFile, plan.taskSha256, "M3 task evidence"],
    [plan.checkpointFile, plan.checkpointSha256, "M3 checkpoint evidence"],
    [plan.taskDagFile, plan.taskDagSha256, "Task DAG evidence"],
    [plan.worktreePlanFile, plan.worktreePlanSha256, "Worktree plan evidence"],
    [plan.inputManifestFile, plan.inputManifestSha256, "Worker input manifest evidence"],
    [plan.executionReceiptFile, plan.executionReceiptSha256, "Worker execution receipt evidence"],
    [plan.workerResultEvidenceFile, plan.workerResultSha256, "Worker result evidence"],
  ];
  for (const [file, expected, label] of evidence) {
    if ((await readRegularFile(root, file, label)).sha256 !== expected) {
      throw new Error(`${label} hash changed after integration planning.`);
    }
  }
  for (const artifact of plan.artifacts) {
    const bundle = await readRegularFile(root, artifact.bundlePath, "Integration bundle", { utf8: false });
    if (bundle.sha256 !== artifact.candidateSha256 || bundle.bytes !== artifact.bytes) {
      throw new Error(`Integration bundle hash changed: ${artifact.path}`);
    }
  }
  const worktreePlan = (await readJson(root, plan.worktreePlanFile, "Worktree plan evidence")).value;
  const receipt = (await readJson(root, plan.executionReceiptFile, "Worker execution receipt evidence")).value;
  const result = await readRegularFile(root, plan.workerResultEvidenceFile, "Worker result evidence");
  if (plan.baseCommit !== worktreePlan.baseCommit || plan.worktreePath !== worktreePlan.worktreePath
      || plan.taskDagFile !== worktreePlan.taskDagFile || plan.taskDagSha256 !== worktreePlan.taskDagSha256) {
    throw new Error("Existing integration plan does not match the M5-A Worktree plan.");
  }
  if (plan.workerResultEvidenceFile !== receipt.resultEvidenceFile) {
    throw new Error("Existing integration plan Worker result path does not match the M5-B1 receipt.");
  }
  const nonResultArtifacts = plan.artifacts.filter((artifact) => artifact.kind !== "result");
  if (nonResultArtifacts.length !== receipt.files?.length) {
    throw new Error("Existing integration plan artifact mapping does not match the M5-B1 receipt.");
  }
  for (const artifact of nonResultArtifacts) {
    const source = receipt.files.find((file) => pathKey(file.path) === pathKey(artifact.path));
    if (!source || source.path !== artifact.path || source.kind !== artifact.kind
        || source.sha256 !== artifact.candidateSha256 || source.bytes !== artifact.bytes) {
      throw new Error(`Existing integration plan artifact does not match the M5-B1 receipt: ${artifact.path}`);
    }
    const expectedBase = artifact.kind === "phase-output"
      ? null
      : await gitObject(root, plan.baseCommit, artifact.path).then((buffer) => buffer ? sha256(buffer) : null);
    if (artifact.baseSha256 !== expectedBase) {
      throw new Error(`Existing integration plan base mapping changed: ${artifact.path}`);
    }
  }
  const resultArtifact = plan.artifacts.find((artifact) => artifact.kind === "result");
  if (resultArtifact.path !== plan.resultFile || resultArtifact.baseSha256 !== null
      || resultArtifact.candidateSha256 !== plan.workerResultSha256
      || resultArtifact.candidateSha256 !== result.sha256 || resultArtifact.bytes !== result.bytes) {
    throw new Error("Existing integration plan result mapping changed.");
  }
  for (const artifact of plan.artifacts) {
    const expectedBundle = `${context.paths.directory}/bundle/sha256-${artifact.candidateSha256.slice("sha256:".length)}.blob`;
    if (artifact.bundlePath !== expectedBundle) throw new Error(`Existing integration plan bundle mapping changed: ${artifact.path}`);
  }
  return { command: "plan", reused: true, planFile: context.paths.planFile, plan };
}

function parseBusinessChanges(source) {
  const tokens = String(source ?? "").split("\0").filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    const status = record.slice(0, 2);
    const relative = record.slice(3).replaceAll("\\", "/");
    if (status.includes("R") || status.includes("C")) {
      throw new Error(`Integration must not rename or copy business files: ${relative}`);
    }
    if (status.includes("D")) throw new Error(`Integration must not delete business files: ${relative}`);
    changes.push(relative);
  }
  return changes;
}

async function assertNoUnexplainedBusinessChanges(root, plan) {
  const allowedBusiness = new Set(plan.artifacts
    .filter((artifact) => artifact.kind === "backend" || artifact.kind === "frontend")
    .map((artifact) => pathKey(artifact.path)));
  const gitStatus = await runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "backend/src", "frontend/src"]);
  for (const relative of parseBusinessChanges(gitStatus.stdout)) {
    if (!allowedBusiness.has(pathKey(relative))) {
      throw new Error(`Main repository contains an unexplained business change: ${relative}`);
    }
  }
}

async function inspectIntegrationStatus(root, context, existing, options) {
  const reused = await validatePlanReuse(root, context, existing);
  const plan = reused.plan;
  const head = String((await runGit(root, ["rev-parse", "HEAD"])).stdout).trim();
  if (head !== plan.baseCommit) throw new Error("Main repository HEAD drifted from the integration plan.");

  const artifacts = [];
  for (const artifact of plan.artifacts) {
    const target = resolveInsideRoot(root, artifact.path, "Integration target");
    await assertNoSymlink(root, target.fullPath, "Integration target");
    const info = await lstat(target.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    let currentSha256 = null;
    if (info) {
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Integration target must be a regular file: ${artifact.path}`);
      currentSha256 = (await readRegularFile(root, artifact.path, "Integration target")).sha256;
    }
    let state = "inconsistent";
    if (currentSha256 === artifact.candidateSha256) state = "applied";
    else if (artifact.baseSha256 === null
      ? currentSha256 === null
      : await gitPathMatchesCommit(root, plan.baseCommit, artifact.path)) state = "pending";
    artifacts.push({ path: artifact.path, kind: artifact.kind, state, currentSha256 });
  }

  await assertNoUnexplainedBusinessChanges(root, plan);

  const inconsistent = artifacts.filter((artifact) => artifact.state === "inconsistent");
  const allApplied = artifacts.every((artifact) => artifact.state === "applied");
  const receipt = await readJsonOptional(root, context.paths.receiptFile, "Integration receipt");
  if (receipt) await validateIntegrationReceipt(root, context, plan, existing.sha256, receipt.value);
  const state = inconsistent.length ? "inconsistent" : allApplied && receipt ? "ready-for-apply" : allApplied ? "applying" : "planned";
  const status = {
    schemaVersion: "1.0",
    storyId: plan.storyId,
    runId: plan.runId,
    taskId: plan.taskId,
    dispatchId: plan.dispatchId,
    planSha256: existing.sha256,
    state,
    artifacts,
    observedAt: (options.now ?? (() => new Date().toISOString()))(),
    details: inconsistent.map((artifact) => `Target content is neither base nor candidate: ${artifact.path}`),
  };
  await writeAtomicJson(resolveInsideRoot(root, context.paths.statusFile, "Integration status").fullPath, status);
  return { command: "status", planFile: context.paths.planFile, statusFile: context.paths.statusFile, plan, status };
}

async function validateIntegrationReceipt(root, context, plan, planSha256, receipt) {
  const resultArtifact = plan.artifacts.find((artifact) => artifact.kind === "result");
  const expectedFiles = plan.artifacts.filter((artifact) => artifact.kind !== "result");
  const receiptFields = [
    "schemaVersion", "storyId", "runId", "taskId", "dispatchId", "phase", "ownerAgent",
    "baseCommit", "planSha256", "resultFile", "resultSha256", "appliedFiles", "completedAt",
  ];
  if (!receipt || typeof receipt !== "object" || Object.keys(receipt).length !== receiptFields.length
      || receiptFields.some((field) => !(field in receipt))) {
    throw new Error("Integration receipt must contain only the supported receipt fields.");
  }
  if (!receipt || typeof receipt !== "object" || receipt.schemaVersion !== "1.0"
      || receipt.storyId !== plan.storyId || receipt.runId !== plan.runId || receipt.taskId !== plan.taskId
      || receipt.dispatchId !== plan.dispatchId || receipt.phase !== plan.phase || receipt.ownerAgent !== plan.ownerAgent
      || receipt.baseCommit !== plan.baseCommit || receipt.planSha256 !== planSha256
      || receipt.resultFile !== resultArtifact.path || receipt.resultSha256 !== resultArtifact.candidateSha256
      || !Array.isArray(receipt.appliedFiles) || typeof receipt.completedAt !== "string") {
    throw new Error("Integration receipt does not match the current plan.");
  }
  if (receipt.appliedFiles.length !== expectedFiles.length) {
    throw new Error("Integration receipt file list does not match the current plan.");
  }
  for (let index = 0; index < expectedFiles.length; index += 1) {
    const expected = expectedFiles[index];
    const actual = receipt.appliedFiles[index];
    if (!actual || typeof actual !== "object" || Object.keys(actual).length !== 4
        || !["path", "kind", "sha256", "bytes"].every((field) => field in actual)
        || actual.path !== expected.path || actual.kind !== expected.kind
        || actual.sha256 !== expected.candidateSha256 || actual.bytes !== expected.bytes) {
      throw new Error(`Integration receipt file hash does not match: ${expected.path}`);
    }
  }
  for (const artifact of plan.artifacts) {
    const current = await readRegularFile(root, artifact.path, "Integrated target");
    if (current.sha256 !== artifact.candidateSha256 || current.bytes !== artifact.bytes) {
      throw new Error(`Integrated target hash does not match the receipt: ${artifact.path}`);
    }
  }
}

async function applyPlan(root, context, existing, options) {
  const lockPath = resolveInsideRoot(root, context.paths.lockFile, "Integration lock").fullPath;
  await acquireIntegrationLock(lockPath, options);
  try {
    const inspected = await inspectIntegrationStatus(root, context, existing, options);
    if (inspected.status.state === "inconsistent") {
      throw new Error("Integration targets are inconsistent; no additional files were written.");
    }
    if (inspected.status.state === "ready-for-apply") {
      return { ...inspected, command: "apply", outcome: "ready-for-apply", reused: true, receiptFile: context.paths.receiptFile };
    }
    const status = {
      ...inspected.status,
      state: "applying",
      observedAt: (options.now ?? (() => new Date().toISOString()))(),
      details: [],
    };
    await writeAtomicJson(resolveInsideRoot(root, context.paths.statusFile, "Integration status").fullPath, status);

    for (const artifact of inspected.plan.artifacts) {
      const item = status.artifacts.find((candidate) => candidate.path === artifact.path);
      if (item.state === "applied") continue;
      const bundle = await readRegularFile(root, artifact.bundlePath, "Integration bundle", { utf8: false });
      if (bundle.sha256 !== artifact.candidateSha256 || bundle.bytes !== artifact.bytes) {
        throw new Error(`Integration bundle hash changed: ${artifact.path}`);
      }
      const target = resolveInsideRoot(root, artifact.path, "Integration target");
      await assertNoSymlink(root, target.fullPath, "Integration target");
      const targetInfo = await lstat(target.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      const currentSha256 = targetInfo ? (await readRegularFile(root, artifact.path, "Integration target")).sha256 : null;
      if (currentSha256 === artifact.candidateSha256) {
        item.state = "applied";
        item.currentSha256 = currentSha256;
        status.observedAt = (options.now ?? (() => new Date().toISOString()))();
        await writeAtomicJson(resolveInsideRoot(root, context.paths.statusFile, "Integration status").fullPath, status);
        continue;
      }
      const preconditionMatches = artifact.baseSha256 === null
        ? currentSha256 === null
        : await gitPathMatchesCommit(root, inspected.plan.baseCommit, artifact.path);
      if (!preconditionMatches) {
        throw new Error(`Integration target changed after preflight; write precondition failed: ${artifact.path}`);
      }
      await writeAtomic(target.fullPath, bundle.buffer);
      await options.testHooks?.afterArtifactRename?.({ path: artifact.path, kind: artifact.kind });
      const written = await readRegularFile(root, artifact.path, "Integrated target");
      if (written.sha256 !== artifact.candidateSha256 || written.bytes !== artifact.bytes) {
        throw new Error(`Integrated target hash does not match the candidate: ${artifact.path}`);
      }
      item.state = "applied";
      item.currentSha256 = written.sha256;
      status.observedAt = (options.now ?? (() => new Date().toISOString()))();
      await writeAtomicJson(resolveInsideRoot(root, context.paths.statusFile, "Integration status").fullPath, status);
    }

    const resultArtifact = inspected.plan.artifacts.find((artifact) => artifact.kind === "result");
    if (!status.artifacts.every((artifact) => artifact.state === "applied")) {
      throw new Error("Integration cannot write a receipt before every artifact is applied.");
    }
    await options.testHooks?.beforeReceiptWrite?.();
    for (const artifact of inspected.plan.artifacts) {
      const current = await readRegularFile(root, artifact.path, "Integrated target before receipt");
      if (current.sha256 !== artifact.candidateSha256 || current.bytes !== artifact.bytes) {
        throw new Error(`Integrated target changed before receipt; candidate hash does not match: ${artifact.path}`);
      }
    }
    const receipt = {
      schemaVersion: "1.0",
      storyId: inspected.plan.storyId,
      runId: inspected.plan.runId,
      taskId: inspected.plan.taskId,
      dispatchId: inspected.plan.dispatchId,
      phase: inspected.plan.phase,
      ownerAgent: inspected.plan.ownerAgent,
      baseCommit: inspected.plan.baseCommit,
      planSha256: existing.sha256,
      resultFile: resultArtifact.path,
      resultSha256: resultArtifact.candidateSha256,
      appliedFiles: inspected.plan.artifacts
        .filter((artifact) => artifact.kind !== "result")
        .map((artifact) => ({ path: artifact.path, kind: artifact.kind, sha256: artifact.candidateSha256, bytes: artifact.bytes })),
      completedAt: (options.now ?? (() => new Date().toISOString()))(),
    };
    await writeAtomicJson(resolveInsideRoot(root, context.paths.receiptFile, "Integration receipt").fullPath, receipt);
    const completed = await inspectIntegrationStatus(root, context, existing, options);
    if (completed.status.state !== "ready-for-apply") throw new Error("Integration receipt was written but final status is not ready-for-apply.");
    return {
      ...completed,
      command: "apply",
      outcome: "ready-for-apply",
      reused: false,
      receiptFile: context.paths.receiptFile,
      receipt,
    };
  } finally {
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function createPlan(root, context, options) {
  const { state, task, taskId, paths } = context;
  const worktreePlanLoaded = await readJson(root, paths.worktreePlanFile, "M5-A Worktree plan");
  const historicalStatus = await readRegularFile(root, paths.worktreeStatusFile, "M5-A Worktree status");
  const manifestLoaded = await readJson(root, paths.manifestFile, "M5-B1 input manifest");
  const receiptLoaded = await readJson(root, paths.executionReceiptFile, "M5-B1 execution receipt");
  const receipt = receiptLoaded.value;
  validateReceiptIdentity(receipt, state, task, taskId, worktreePlanLoaded.value);
  if (receipt.planSha256 !== worktreePlanLoaded.sha256
      || receipt.statusSha256 !== historicalStatus.sha256
      || receipt.inputManifestSha256 !== manifestLoaded.sha256) {
    throw new Error("M5-B1 execution receipt evidence hash does not match current files.");
  }
  const workerResultLoaded = await readJson(root, receipt.resultEvidenceFile, "M5-B1 Worker result evidence");
  if (receipt.resultSha256 !== workerResultLoaded.sha256) throw new Error("M5-B1 Worker result hash does not match its receipt.");
  validateDispatchResultStructure(workerResultLoaded.value);
  if (workerResultLoaded.value.status !== "completed") throw new Error("M5-B2 requires a completed Worker result.");
  if (workerResultLoaded.value.dispatchId !== task.dispatchId
      || workerResultLoaded.value.storyId !== task.storyId
      || workerResultLoaded.value.phase !== task.phase) {
    throw new Error("M5-B1 Worker result identity does not match the current dispatch.");
  }
  if (JSON.stringify(workerResultLoaded.value.outputs.map((item) => item.path)) !== JSON.stringify(task.expectedOutputs)) {
    throw new Error("M5-B1 Worker result outputs do not match the M3 task.");
  }

  const inspected = await runWorktreeCommand({
    root,
    command: "status",
    stateFile: context.stateFile,
    taskId,
    now: options.now,
  });
  if (inspected.status.state !== "created") throw new Error("M5-A Worktree must be created while integration is planned.");
  const dagLoaded = await readRegularFile(root, inspected.plan.taskDagFile, "Task DAG file");
  const dag = await loadTaskDag(dagLoaded.fullPath);
  if (dag.nodes.size !== 1) throw new Error("M5-B2 requires exactly one task in the Task DAG.");
  const dagTask = dag.nodes.get(taskId);
  if (!dagTask || dagTask.status !== "pending" || dagTask.ownerAgent !== task.ownerAgent) {
    throw new Error("Task DAG identity, pending status, and owner must match the M3 task.");
  }
  const head = String((await runGit(root, ["rev-parse", "HEAD"])).stdout).trim();
  if (head !== inspected.plan.baseCommit) throw new Error("Main repository HEAD must match the planned base commit.");

  if (await readJsonOptional(root, paths.receiptFile, "Integration receipt")) {
    throw new Error("Integration receipt already exists without a reusable plan.");
  }
  const officialResultFile = `${path.posix.dirname(context.taskFile)}/result.json`;
  if (await readJsonOptional(root, officialResultFile, "Official M3 result")) {
    throw new Error("Official M3 result already exists before integration planning.");
  }

  const worktreeRoot = resolveInsideRoot(root, inspected.plan.worktreePath, "Worktree path").fullPath;
  const artifacts = [];
  let totalBytes = 0;
  for (const file of receipt.files) {
    if (!file || typeof file !== "object" || !["backend", "frontend", "phase-output"].includes(file.kind)
        || !SHA256_PATTERN.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > FILE_LIMIT_BYTES) {
      throw new Error("M5-B1 execution receipt contains an invalid file entry.");
    }
    const artifactPath = normalizeArtifactPath(file.path, "Integration artifact path");
    const expectedKind = task.expectedOutputs.includes(artifactPath)
      ? "phase-output"
      : artifactPath.startsWith("backend/src/") ? "backend"
        : artifactPath.startsWith("frontend/src/") ? "frontend" : null;
    if (expectedKind !== file.kind) throw new Error(`Integration artifact kind does not match its path: ${artifactPath}`);
    const candidate = await readRegularFile(worktreeRoot, artifactPath, "Worktree candidate");
    if (candidate.sha256 !== file.sha256 || candidate.bytes !== file.bytes) {
      throw new Error(`Worktree candidate hash does not match the M5-B1 receipt: ${artifactPath}`);
    }
    const target = resolveInsideRoot(root, artifactPath, "Integration target");
    await assertNoSymlink(root, target.fullPath, "Integration target");
    let baseSha256 = null;
    if (file.kind === "phase-output") {
      const targetInfo = await lstat(target.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (targetInfo) throw new Error(`Phase output already exists before integration planning: ${artifactPath}`);
    } else {
      const base = await gitObject(root, inspected.plan.baseCommit, artifactPath);
      baseSha256 = base ? sha256(base) : null;
      const targetInfo = await lstat(target.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (baseSha256 === null && targetInfo) throw new Error(`New business target already exists before integration planning: ${artifactPath}`);
      if (baseSha256 !== null) {
        await readRegularFile(root, artifactPath, "Business target");
        if (!await gitPathMatchesCommit(root, inspected.plan.baseCommit, artifactPath)) {
          throw new Error(`Business target does not match the planned base: ${artifactPath}`);
        }
      }
    }
    totalBytes += candidate.bytes;
    artifacts.push({ path: artifactPath, kind: file.kind, baseSha256, candidateSha256: candidate.sha256, bytes: candidate.bytes, buffer: candidate.buffer });
  }
  if (!artifacts.some((item) => item.kind === "backend" || item.kind === "frontend")) {
    throw new Error("M5-B2 requires at least one business candidate.");
  }
  totalBytes += workerResultLoaded.bytes;
  if (totalBytes > BUNDLE_LIMIT_BYTES) throw new Error("Integration bundle exceeds the 8 MiB total limit.");
  artifacts.push({
    path: officialResultFile,
    kind: "result",
    baseSha256: null,
    candidateSha256: workerResultLoaded.sha256,
    bytes: workerResultLoaded.bytes,
    buffer: workerResultLoaded.buffer,
  });
  assertUniqueArtifacts(artifacts);
  artifacts.sort((left, right) => artifactPriority(left.kind) - artifactPriority(right.kind) || pathKey(left.path).localeCompare(pathKey(right.path)));
  await assertNoUnexplainedBusinessChanges(root, { artifacts });

  for (const artifact of artifacts) {
    const blobName = artifact.candidateSha256.slice("sha256:".length);
    artifact.bundlePath = `${paths.directory}/bundle/sha256-${blobName}.blob`;
    const existing = await lstat(resolveInsideRoot(root, artifact.bundlePath, "Integration bundle").fullPath)
      .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing) {
      const loaded = await readRegularFile(root, artifact.bundlePath, "Integration bundle", { utf8: false });
      if (loaded.sha256 !== artifact.candidateSha256) throw new Error(`Existing integration bundle is corrupt: ${artifact.path}`);
    } else {
      await writeAtomic(resolveInsideRoot(root, artifact.bundlePath, "Integration bundle").fullPath, artifact.buffer);
    }
  }

  const plan = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    taskId,
    dispatchId: task.dispatchId,
    phase: task.phase,
    ownerAgent: task.ownerAgent,
    stateFile: context.stateFile,
    preparedRevision: task.preparedRevision,
    baseCommit: inspected.plan.baseCommit,
    worktreePath: inspected.plan.worktreePath,
    taskDagFile: inspected.plan.taskDagFile,
    taskDagSha256: dagLoaded.sha256,
    taskFile: context.taskFile,
    taskSha256: context.taskLoaded.sha256,
    checkpointFile: context.checkpointFile,
    checkpointSha256: context.checkpointLoaded.sha256,
    worktreePlanFile: paths.worktreePlanFile,
    worktreePlanSha256: worktreePlanLoaded.sha256,
    inputManifestFile: paths.manifestFile,
    inputManifestSha256: manifestLoaded.sha256,
    executionReceiptFile: paths.executionReceiptFile,
    executionReceiptSha256: receiptLoaded.sha256,
    workerResultEvidenceFile: receipt.resultEvidenceFile,
    workerResultSha256: workerResultLoaded.sha256,
    resultFile: officialResultFile,
    artifacts: artifacts.map(({ buffer, ...artifact }) => artifact),
    plannedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  validateStoredPlan(plan, context);
  await writeAtomicJson(resolveInsideRoot(root, paths.planFile, "Integration plan").fullPath, plan);
  return { command: "plan", reused: false, planFile: paths.planFile, plan };
}

export async function runWorktreeIntegration(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const command = String(options.command ?? "").toLowerCase();
  if (!new Set(["plan", "status", "apply"]).has(command)) {
    throw new Error(`Unsupported Worktree integration command: ${options.command ?? ""}`);
  }
  if (command === "apply" && options.confirmApply !== true) {
    throw new Error("Apply requires explicit confirmation through confirmApply.");
  }
  const context = await loadContext(root, options);
  const existing = await readJsonOptional(root, context.paths.planFile, "Integration plan");
  if (command === "plan") {
    if (existing) return validatePlanReuse(root, context, existing);
    return createPlan(root, context, options);
  }
  if (!existing) throw new Error("Create an integration plan before checking status or applying it.");
  if (command === "status") return inspectIntegrationStatus(root, context, existing, options);
  return applyPlan(root, context, existing, options);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = { "--root": "root", "--state-file": "stateFile", "--task-id": "taskId", "--task-file": "taskFile" };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    if (token === "--confirm-apply") { options.confirmApply = true; continue; }
    const key = keyMap[token];
    if (!key || index + 1 >= tokens.length) throw new Error(`Unsupported or incomplete argument: ${token}`);
    options[key] = tokens[++index];
  }
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const result = await runWorktreeIntegration(options);
    console.log(options.json ? JSON.stringify(result) : `Worktree integration '${result.command}' completed for ${result.plan.taskId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(options.json ? JSON.stringify({ error: message }) : `Worktree integration failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
