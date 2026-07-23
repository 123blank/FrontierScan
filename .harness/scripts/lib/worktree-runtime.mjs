import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadTaskDag } from "./task-dag-contract.mjs";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const PLAN_FIELDS = [
  "schemaVersion", "storyId", "runId", "taskId", "title", "ownerAgent", "wave",
  "taskDagFile", "taskDagSha256", "baseRef", "baseCommit", "branch", "worktreePath",
  "predictedFiles", "plannedAt",
];
const RETIREMENT_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "taskId", "branch", "worktreePath", "baseCommit",
  "planSha256", "statusSha256", "executionReceiptSha256", "integrationPlanSha256",
  "integrationReceiptSha256", "resultFile", "resultSha256", "retiredAt", "recovered",
];

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
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
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
  return execute(args);
}

async function tryGit(root, args, options) {
  try {
    const result = await executeGit(root, args, options);
    return { ok: true, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout ?? ""), stderr: String(error?.stderr ?? error?.message ?? "") };
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
  const branchResult = await tryGit(root, ["show-ref", "--verify", "--hash", branchRef], options);
  const branchCommit = branchResult.ok ? branchResult.stdout.trim() : null;
  const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  let state = "absent";
  const details = [];
  if (worktree) {
    const actualBranch = worktree.branch === branchRef ? plan.branch : String(worktree.branch ?? "");
    if (worktree.HEAD === plan.baseCommit && actualBranch === plan.branch) state = "created";
    else {
      state = "inconsistent";
      details.push("Target worktree branch or HEAD does not match the plan.");
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
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: (options.now ?? (() => new Date().toISOString()))() })}\n`, "utf8");
  await handle.close();
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
  const branchResult = await tryGit(root, ["show-ref", "--verify", "--hash", `refs/heads/${plan.branch}`], options);
  const branchCommit = branchResult.ok ? branchResult.stdout.trim() : null;
  const pathInfo = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!branchCommit || branchCommit !== plan.baseCommit) throw new Error("Worktree branch no longer points to the planned base commit.");
  if (!worktree) {
    if (pathInfo) throw new Error("Worktree path is occupied but not registered by Git.");
    return { state: "absent", targetPath };
  }
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
    const branch = await tryGit(root, ["show-ref", "--verify", "--hash", branchRef], options);
    const resumedBranch = branch.ok;
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

export async function runWorktreeCommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.command === "plan") return plan(root, options);
  if (options.command === "status") return status(root, options);
  if (options.command === "create") return create(root, options);
  if (options.command === "retire") return retire(root, options);
  throw new Error(`Unsupported worktree command: ${options.command ?? "(missing)"}`);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = { "--root": "root", "--state-file": "stateFile", "--task-dag-file": "taskDagFile", "--task-id": "taskId", "--base-ref": "baseRef" };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") { options.json = true; continue; }
    if (token === "--confirm-create") { options.confirmCreate = true; continue; }
    if (token === "--confirm-retire") { options.confirmRetire = true; continue; }
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
    const result = await runWorktreeCommand(options);
    const taskId = result.plan?.taskId ?? result.receipt?.taskId;
    console.log(options.json ? JSON.stringify(result) : `Worktree command '${result.command}' completed for ${taskId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(options.json ? JSON.stringify({ error: message }) : `Worktree command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
