import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateDevelopmentContext } from "./development-provider-contract.mjs";
import { readBoundedUtf8 } from "./worker-runtime.mjs";

const execFileAsync = promisify(execFile);
const SHA = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const ROLES = new Set(["backend-developer", "frontend-developer"]);
const BASELINE_FIELDS = [
  "schemaVersion", "branch", "headCommit", "baseCommit", "gitDir", "gitCommonDir",
  "gitFileSha256", "indexSha256", "configSha256", "packedRefsSha256", "refsSha256",
  "gitStatusSha256", "dirtyPaths", "trackedFilesSha256", "untrackedFilesSha256",
  "ignoredMetadataSha256", "predictedTargets", "buildOutputs", "lockFiles", "capturedAt",
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertShape(value, fields, label) {
  assertObject(value, label);
  const unexpected = Object.keys(value).find((field) => !fields.includes(field));
  if (unexpected) throw new Error(`${label} contains unsupported field '${unexpected}'.`);
  for (const field of fields) if (!Object.hasOwn(value, field)) throw new Error(`${label} requires '${field}'.`);
}

function assertSha(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(`${label} must be a SHA-256 value.`);
}

function assertCommit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error(`${label} must be a Git commit.`);
}

function sameStrings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function json(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function absoluteFrom(base, value) {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(base, value);
}

async function defaultRunGit(worktreePath, args) {
  const result = await execFileAsync("git", args, {
    cwd: worktreePath,
    windowsHide: true,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  return String(result.stdout ?? "");
}

async function defaultReadEvidence(base, value) {
  const fullPath = absoluteFrom(base, value);
  const info = await lstat(fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Development evidence must be a regular file: ${value}`);
  return {sha256: sha256(await readFile(fullPath))};
}

async function hashDirectory(root) {
  const records = [];
  async function visit(current, relative) {
    const children = await readdir(current, {withFileTypes: true});
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const fullPath = path.join(current, child.name);
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) throw new Error(`Development build output contains a symbolic link: ${childRelative}`);
      if (info.isDirectory()) {
        records.push({path: `${childRelative}/`, type: "directory"});
        await visit(fullPath, childRelative);
      } else if (info.isFile()) {
        records.push({
          path: childRelative,
          type: "file",
          bytes: info.size,
          sha256: sha256(await readFile(fullPath)),
        });
      } else {
        throw new Error(`Development build output contains an unsupported entry: ${childRelative}`);
      }
    }
  }
  await visit(root, "");
  return sha256(json(records));
}

async function defaultBuildOutput(worktreePath, relativePath) {
  const fullPath = path.resolve(worktreePath, relativePath);
  const info = await lstat(fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return {path: relativePath, state: "absent", sha256: null};
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Development build output must be a real directory: ${relativePath}`);
  }
  return {path: relativePath, state: "baseline", sha256: await hashDirectory(fullPath)};
}

async function defaultIgnoredMetadata(worktreePath, paths) {
  const records = [];
  for (const relativePath of [...paths].sort()) {
    const fullPath = path.resolve(worktreePath, relativePath.replace(/\/$/, ""));
    const info = await lstat(fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) continue;
    records.push({
      path: relativePath,
      type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      bytes: info.size,
      modifiedMs: Math.trunc(info.mtimeMs),
    });
  }
  return {sha256: sha256(json(records))};
}

function dirtyPaths(status) {
  const result = [];
  const entries = status.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.length < 4 || entry[2] !== " ") throw new Error("Development Git status is invalid.");
    result.push(entry.slice(3).replaceAll("\\", "/"));
    if (["R", "C"].includes(entry[0]) || ["R", "C"].includes(entry[1])) index += 1;
  }
  return result.sort();
}

export async function captureDevelopmentBaseline({
  worktreePath,
  baseCommit,
  predictedFiles,
  buildOutputPaths,
  lockPaths,
  now = () => new Date().toISOString(),
  runGit,
  readEvidence,
  ignoredMetadata,
  buildOutput,
  ignoredExcludePrefixes = [],
}) {
  if (typeof worktreePath !== "string"
      || !path.win32.isAbsolute(worktreePath) && !path.posix.isAbsolute(worktreePath)) {
    throw new Error("Development baseline worktreePath must be absolute.");
  }
  assertCommit(baseCommit, "Development baseline baseCommit");
  const git = runGit ?? ((args) => defaultRunGit(worktreePath, args));
  const read = readEvidence ?? ((value) => defaultReadEvidence(worktreePath, value));
  const ignored = ignoredMetadata ?? ((paths) => defaultIgnoredMetadata(worktreePath, paths));
  const inspectBuild = buildOutput ?? ((value) => defaultBuildOutput(worktreePath, value));
  const [
    branchRaw, headRaw, gitDirRaw, commonDirRaw, statusRaw, trackedRaw,
    untrackedRaw, ignoredRaw, refsRaw,
  ] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "--git-dir"]),
    git(["rev-parse", "--git-common-dir"]),
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(["ls-files", "-z"]),
    git(["ls-files", "--others", "--exclude-standard", "-z"]),
    git(["ls-files", "--others", "-i", "--exclude-standard", "-z"]),
    git(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)"]),
  ]);
  const branch = branchRaw.trim();
  const headCommit = headRaw.trim();
  const gitDir = absoluteFrom(worktreePath, gitDirRaw.trim()).replaceAll("\\", "/");
  const gitCommonDir = absoluteFrom(worktreePath, commonDirRaw.trim()).replaceAll("\\", "/");
  if (!branch || branch === "HEAD") throw new Error("Development Worktree branch must be attached.");
  assertCommit(headCommit, "Development baseline headCommit");
  if (headCommit !== baseCommit) throw new Error("Development baseline HEAD must match baseCommit.");
  const gitFile = await read(".git");
  const index = await read(`${gitDir}/index`);
  const config = await read(`${gitCommonDir}/config`);
  const packedRefs = await read(`${gitCommonDir}/packed-refs`);
  if (!gitFile || !index || !config) throw new Error("Development baseline .git, index, and config evidence are required.");
  const excludedPrefixes = ignoredExcludePrefixes.map(
    (value) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase(),
  );
  const ignoredPaths = ignoredRaw
    .split("\0")
    .filter(Boolean)
    .map((value) => value.replaceAll("\\", "/"))
    .filter((value) => {
      const normalized = value.toLowerCase();
      return !excludedPrefixes.some(
        (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
      );
    });
  const ignoredEvidence = await ignored(ignoredPaths);
  assertSha(ignoredEvidence.sha256, "Development baseline ignored metadata hash");
  const predictedTargets = [];
  for (const relativePath of predictedFiles) {
    let content = null;
    try {
      content = await git(["show", `${baseCommit}:${relativePath}`]);
    } catch {
      content = null;
    }
    predictedTargets.push({
      path: relativePath,
      baseSha256: content === null ? null : sha256(Buffer.from(content)),
    });
  }
  const buildOutputs = [];
  for (const relativePath of buildOutputPaths) buildOutputs.push(await inspectBuild(relativePath));
  const existingLocks = [];
  const effectiveLockPaths = [
    ...lockPaths,
    `${gitDir}/index.lock`,
    `${gitCommonDir}/config.lock`,
    `${gitCommonDir}/packed-refs.lock`,
  ];
  for (const lockPath of [...new Set(effectiveLockPaths)]) {
    if (await read(lockPath)) existingLocks.push(lockPath);
  }
  return {
    schemaVersion: "1.0",
    branch,
    headCommit,
    baseCommit,
    gitDir,
    gitCommonDir,
    gitFileSha256: gitFile.sha256,
    indexSha256: index.sha256,
    configSha256: config.sha256,
    packedRefsSha256: packedRefs?.sha256 ?? null,
    refsSha256: sha256(Buffer.from(refsRaw)),
    gitStatusSha256: sha256(Buffer.from(statusRaw)),
    dirtyPaths: dirtyPaths(statusRaw),
    trackedFilesSha256: sha256(Buffer.from(trackedRaw)),
    untrackedFilesSha256: sha256(Buffer.from(untrackedRaw)),
    ignoredMetadataSha256: ignoredEvidence.sha256,
    predictedTargets,
    buildOutputs,
    lockFiles: existingLocks,
    capturedAt: now(),
  };
}

function generatedEntry(pathValue, value, purpose, source) {
  const content = json(value);
  return {
    path: pathValue,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
    purpose,
    source,
  };
}

function validateBaseline(value, plan, status) {
  assertShape(value, BASELINE_FIELDS, "Development baseline");
  if (value.schemaVersion !== "1.0") throw new Error("Development baseline schemaVersion is invalid.");
  if (value.branch !== plan.branch || value.branch !== status.branch) {
    throw new Error("Development baseline branch does not match Worktree facts.");
  }
  assertCommit(value.headCommit, "Development baseline headCommit");
  assertCommit(value.baseCommit, "Development baseline baseCommit");
  if (value.headCommit !== plan.baseCommit || value.baseCommit !== plan.baseCommit
      || status.headCommit !== plan.baseCommit) {
    throw new Error("Development Worktree HEAD/headCommit/baseCommit must match.");
  }
  for (const field of [
    "gitFileSha256", "indexSha256", "configSha256", "refsSha256", "gitStatusSha256",
    "trackedFilesSha256", "untrackedFilesSha256", "ignoredMetadataSha256",
  ]) assertSha(
    value[field],
    field === "gitFileSha256" ? "Development baseline .git file hash" : `Development baseline ${field}`,
  );
  assertSha(value.packedRefsSha256, "Development baseline packedRefsSha256", true);
  if (typeof value.gitDir !== "string" || !path.win32.isAbsolute(value.gitDir) && !path.posix.isAbsolute(value.gitDir)) {
    throw new Error("Development baseline gitDir must be absolute.");
  }
  if (typeof value.gitCommonDir !== "string"
      || !path.win32.isAbsolute(value.gitCommonDir) && !path.posix.isAbsolute(value.gitCommonDir)) {
    throw new Error("Development baseline gitCommonDir must be absolute.");
  }
  if (!Array.isArray(value.dirtyPaths) || value.dirtyPaths.length) {
    throw new Error("Development Worktree must be initially clean; dirty paths are not allowed.");
  }
  if (!Array.isArray(value.lockFiles) || value.lockFiles.length) {
    throw new Error("Development Worktree has a conflicting lock.");
  }
  if (!Array.isArray(value.predictedTargets) || !Array.isArray(value.buildOutputs)) {
    throw new Error("Development baseline target or build output evidence is invalid.");
  }
  if (value.buildOutputs.some((entry) => !["absent", "baseline"].includes(entry.state))) {
    throw new Error("Development baseline build output state is invalid.");
  }
  if (typeof value.gitFileSha256 !== "string") throw new Error("Development Worktree .git file hash is required.");
  return value;
}

function acceptedKnowledge(state) {
  const result = [];
  for (const area of state.knowledge?.areas ?? []) {
    if (!area.relevant || area.status === "not-relevant") continue;
    if (!["fresh", "accepted-stale"].includes(area.status)) {
      throw new Error(`Development knowledge area '${area.area}' is ${area.status}.`);
    }
    result.push({
      area: area.area,
      status: area.status,
      loadedFiles: [...(area.loadedFiles ?? [])],
    });
  }
  return result;
}

export function validateDevelopmentContextInputs({
  state,
  task,
  taskFile,
  worktreePlan,
  worktreePlanSha256,
  worktreeStatus,
  worktreeStatusSha256,
  policy,
  baseline,
}) {
  if (state?.schemaVersion !== "2.0" || state.phase !== "implementation"
      || state.runtime?.status !== "active") {
    throw new Error("Development context State phase must be implementation and active State v2.");
  }
  if (task?.phase !== "implementation" || task.storyId !== state.storyId
      || task.runId !== state.runtime.runId || task.preparedRevision !== state.runtime.revision
      || !ROLES.has(task.ownerAgent)) {
    throw new Error("Development context task identity or owner must be a developer.");
  }
  if (taskFile !== `${task.attemptRoot}/task.json`) throw new Error("Development context taskFile is invalid.");
  const pending = (state.dag?.nodes ?? []).filter((node) => node.status === "pending");
  if (pending.length !== 1) throw new Error("Development context requires exactly one pending DAG node.");
  const node = pending[0];
  if (!ROLES.has(node.ownerAgent) || node.ownerAgent !== task.ownerAgent) {
    throw new Error("Development DAG node owner must match the developer task.");
  }
  if (!Array.isArray(node.predictedFiles) || !node.predictedFiles.length) {
    throw new Error("Development DAG node predictedFiles must be non-empty.");
  }
  const criteria = new Set((state.requirement?.acceptanceCriteria ?? []).map((item) => item.criterionId));
  if (!Array.isArray(node.criterionIds) || !node.criterionIds.length
      || node.criterionIds.some((criterionId) => !criteria.has(criterionId))) {
    throw new Error("Development DAG node criterion references are incomplete.");
  }
  assertSha(worktreePlanSha256, "Development worktree plan hash");
  assertSha(worktreeStatusSha256, "Development worktree status hash");
  if (worktreePlan?.storyId !== state.storyId || worktreePlan.runId !== state.runtime.runId
      || worktreePlan.taskId !== node.taskId || worktreePlan.ownerAgent !== node.ownerAgent
      || worktreePlan.taskDagFile !== state.dag.sourceFile
      || worktreePlan.taskDagSha256 !== state.dag.sourceSha256
      || !sameStrings(worktreePlan.predictedFiles, node.predictedFiles)) {
    throw new Error("Development Worktree plan does not match the active DAG node.");
  }
  if (worktreeStatus?.state !== "created" || worktreeStatus.storyId !== state.storyId
      || worktreeStatus.runId !== state.runtime.runId || worktreeStatus.taskId !== node.taskId
      || worktreeStatus.branch !== worktreePlan.branch
      || worktreeStatus.worktreePath !== worktreePlan.worktreePath
      || worktreeStatus.baseCommit !== worktreePlan.baseCommit) {
    throw new Error("Development Worktree status must prove a created matching Worktree.");
  }
  if (policy?.name !== node.ownerAgent || policy.category !== "execution"
      || !Array.isArray(policy.readPathPrefixes) || !Array.isArray(policy.writePathPrefixes)
      || !policy.writePathPrefixes.length) {
    throw new Error("Development role policy is invalid.");
  }
  validateBaseline(baseline, worktreePlan, worktreeStatus);
  return { node, policy, baseline, knowledgeAreas: acceptedKnowledge(state) };
}

async function defaultLoadEntry(root, relativePath, purpose, source) {
  const loaded = await readBoundedUtf8(root, relativePath, `Development context file '${relativePath}'`);
  return {
    path: relativePath,
    sha256: sha256(Buffer.from(loaded.content, "utf8")),
    bytes: Buffer.byteLength(loaded.content),
    purpose,
    source,
  };
}

async function exists(root, relativePath) {
  return lstat(path.resolve(root, relativePath)).then(
    (info) => info.isFile() && !info.isSymbolicLink(),
    (error) => error?.code === "ENOENT" ? false : Promise.reject(error),
  );
}

export async function createDevelopmentContextCandidate(options) {
  const validated = validateDevelopmentContextInputs(options);
  const {
    state,
    task,
    taskFile,
    worktreePlan,
    worktreePlanSha256,
    worktreeStatusSha256,
    worktreePath,
    root = process.cwd(),
    now = () => new Date().toISOString(),
  } = options;
  const sourceRoot = options.sourceRoot ?? root;
  if (typeof worktreePath !== "string"
      || !path.win32.isAbsolute(worktreePath) && !path.posix.isAbsolute(worktreePath)) {
    throw new Error("Development context worktreePath must be absolute.");
  }
  const loadEntry = options.loadEntry
    ?? ((relativePath, purpose, source) => defaultLoadEntry(root, relativePath, purpose, source));
  const loadSourceEntry = options.loadEntry
    ?? ((relativePath, purpose, source) => defaultLoadEntry(sourceRoot, relativePath, purpose, source));
  const entries = [];
  const fixed = [
    [taskFile, "当前 implementation dispatch task", "task"],
    [".harness/runs/" + state.runtime.runId + "/phases/00-requirement/requirement-breakdown.md", "需求与验收标准", "state"],
    [".harness/runs/" + state.runtime.runId + "/phases/01-technical-design/technical-design.md", "技术设计", "state"],
    [state.dag.sourceFile, "当前任务 DAG", "dag"],
    ["AGENTS.md", "项目执行规则", "project-rule"],
  ];
  for (const [file, purpose, source] of fixed) entries.push(await loadEntry(file, purpose, source));
  const predictedPaths = new Set(
    validated.node.predictedFiles.map((file) => file.toLowerCase()),
  );
  for (const area of validated.knowledgeAreas) {
    for (const file of area.loadedFiles) {
      if (!predictedPaths.has(file.toLowerCase())) {
        entries.push(await loadEntry(file, `${area.area} 知识`, "knowledge"));
      }
    }
  }
  for (const file of validated.node.predictedFiles) {
    if (options.loadEntry || await exists(sourceRoot, file)) {
      entries.push(await loadSourceEntry(file, "任务预测目标文件", "source"));
    }
  }
  entries.push(generatedEntry(
    `${task.attemptRoot}/development-provider/prepared/state-projection.json`,
    {
      storyId: state.storyId,
      runId: state.runtime.runId,
      phase: state.phase,
      revision: state.runtime.revision,
      acceptanceCriteria: state.requirement.acceptanceCriteria,
      node: validated.node,
    },
    "最小 State 与 DAG node 投影",
    "state",
  ));
  entries.push(generatedEntry(
    `${task.attemptRoot}/development-provider/prepared/developer-policy.json`,
    validated.policy,
    "冻结开发角色策略",
    "policy",
  ));
  const paths = new Set();
  let totalBytes = 0;
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (paths.has(key)) throw new Error(`Development context contains duplicate path '${entry.path}'.`);
    paths.add(key);
    totalBytes += entry.bytes;
  }
  const manifest = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    dispatchId: task.dispatchId,
    taskId: validated.node.taskId,
    role: validated.node.ownerAgent,
    entries,
    knowledgeAreas: validated.knowledgeAreas,
    predictedFiles: [...validated.node.predictedFiles],
    criterionIds: [...validated.node.criterionIds],
    worktree: {
      planFile: `.harness/runs/${state.runtime.runId}/worktrees/${validated.node.taskId}/plan.json`,
      planSha256: worktreePlanSha256,
      statusFile: `.harness/runs/${state.runtime.runId}/worktrees/${validated.node.taskId}/status.json`,
      statusSha256: worktreeStatusSha256,
      path: worktreePath,
      branch: worktreePlan.branch,
      baseCommit: worktreePlan.baseCommit,
      headCommit: options.worktreeStatus.headCommit,
    },
    totalBytes,
    createdAt: now(),
  };
  validateDevelopmentContext(manifest);
  return {
    manifest,
    baseline: structuredClone(validated.baseline),
    node: structuredClone(validated.node),
    policy: structuredClone(validated.policy),
  };
}
