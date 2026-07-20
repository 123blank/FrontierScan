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
  if (String(result.stdout ?? "").trim()) throw new Error("The main repository must be clean before creating a Worktree.");
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
    console.log(options.json ? JSON.stringify(result) : `Worktree command '${result.command}' completed for ${result.plan.taskId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(options.json ? JSON.stringify({ error: message }) : `Worktree command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
