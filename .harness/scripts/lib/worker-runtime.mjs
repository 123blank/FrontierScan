import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDispatchResultStructure, validateDispatchTaskStructure } from "./dispatch-contract.mjs";

const POLICY_FIELDS = ["name", "category", "readPathPrefixes", "writePathPrefixes", "capabilities"];
const CATEGORIES = new Set(["planning", "execution", "verification", "review", "integration"]);
const CAPABILITIES = new Set(["phase-output", "backend-write", "frontend-write", "backend-test-write"]);
const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const CONTEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const CAPABILITY_PREFIXES = {
  "backend-write": "backend/src/",
  "frontend-write": "frontend/src/",
  "backend-test-write": "backend/src/test/",
};
const ROLE_CAPABILITIES = {
  "product-analyst": ["phase-output"],
  "requirement-analyst": ["phase-output"],
  "task-planner": ["phase-output"],
  "backend-developer": ["phase-output", "backend-write"],
  "frontend-developer": ["phase-output", "frontend-write"],
  "code-fixer": ["phase-output", "backend-write", "frontend-write"],
  "unit-tester": ["phase-output", "backend-test-write"],
  "test-case-designer": ["phase-output"],
  "interface-verifier": ["phase-output"],
  "code-reviewer": ["phase-output"],
  "publisher": ["phase-output"],
  "git-committer": ["phase-output"],
};

function yamlScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseAgentRegistry(source) {
  const agents = new Map();
  let current = null;
  for (const [index, line] of source.replaceAll("\r\n", "\n").split("\n").entries()) {
    const nameMatch = line.match(/^  - name:\s*(.+)$/);
    if (nameMatch) {
      if (current && !current.category) throw new Error(`Agent '${current.name}' is missing category.`);
      const name = yamlScalar(nameMatch[1]);
      if (!name || agents.has(name)) throw new Error(`Agent registry contains duplicate or empty role '${name}'.`);
      current = { name, category: null };
      agents.set(name, current);
      continue;
    }
    const categoryMatch = line.match(/^    category:\s*(.+)$/);
    if (categoryMatch && current) {
      if (current.category) throw new Error(`Agent '${current.name}' has duplicate category at line ${index + 1}.`);
      current.category = yamlScalar(categoryMatch[1]);
    }
  }
  if (current && !current.category) throw new Error(`Agent '${current.name}' is missing category.`);
  if (!agents.size) throw new Error("Agent registry does not define any roles.");
  return agents;
}

function assertExactFields(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field '${unexpected}'.`);
}

function validatePathPrefix(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
}

function validateStringList(value, label, predicate = (item) => typeof item === "string" && item.length > 0) {
  if (!Array.isArray(value) || new Set(value).size !== value.length) throw new Error(`${label} must be a unique array.`);
  for (const item of value) {
    if (!predicate(item)) throw new Error(`${label} contains unsafe or unsupported value '${item}'.`);
  }
}

async function readRegularFile(filePath, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return readFile(filePath, "utf8");
}

function resolveRepositoryPath(root, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const repositoryRoot = path.resolve(root);
  const fullPath = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, fullPath).replaceAll("\\", "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
}

async function assertPathHasNoSymlink(root, fullPath, label) {
  const repositoryRoot = path.resolve(root);
  const parts = path.relative(repositoryRoot, fullPath).split(path.sep).filter(Boolean);
  let current = repositoryRoot;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
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

async function readBoundedUtf8(root, relativePath, label) {
  const resolved = resolveRepositoryPath(root, relativePath, label);
  await assertPathHasNoSymlink(root, resolved.fullPath, label);
  const info = await lstat(resolved.fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  if (info.size > FILE_LIMIT_BYTES) throw new Error(`${label} exceeds the 2 MiB file limit.`);
  const buffer = await readFile(resolved.fullPath);
  return { ...resolved, bytes: buffer.byteLength, content: decodeUtf8(buffer, label) };
}

function pathMatchesPrefix(relativePath, prefix) {
  return prefix.endsWith("/") ? relativePath.startsWith(prefix) : relativePath === prefix;
}

function filesystemPathKey(relativePath) {
  return process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
}

function phaseRootForTask(taskFile, task) {
  const phaseRoot = path.posix.dirname(taskFile);
  const expectedRunRoot = `.harness/runs/${task.storyId}/phases/`;
  const directoryName = path.posix.basename(phaseRoot);
  if (!phaseRoot.startsWith(expectedRunRoot)
      || path.posix.basename(taskFile) !== "task.json"
      || !/^\d{2}-/.test(directoryName)
      || directoryName.slice(3) !== task.phase) {
    throw new Error("Worker task file path does not match its story and phase identity.");
  }
  for (const output of task.expectedOutputs) {
    if (!output.startsWith(`${phaseRoot}/`)) {
      throw new Error("Worker task expected output is outside its current phase directory.");
    }
  }
  return phaseRoot;
}

async function assertWritableTarget(root, fullPath, label) {
  await assertPathHasNoSymlink(root, fullPath, label);
  const info = await lstat(fullPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`${label} must be a regular file target.`);
}

function validateProviderResponse(response, task, policy, phaseRoot) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Worker provider response must be an object.");
  }
  assertExactFields(response, ["files", "result"], "Worker provider response");
  if (!Array.isArray(response.files) || !("result" in response)) {
    throw new Error("Worker provider response requires files and result.");
  }

  const files = [];
  const pathKeys = new Set();
  let totalBytes = 0;
  for (const candidate of response.files) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Worker candidate file must be an object.");
    }
    assertExactFields(candidate, ["path", "content", "capability"], "Worker candidate file");
    if (typeof candidate.content !== "string" || typeof candidate.capability !== "string") {
      throw new Error("Worker candidate content and capability must be strings.");
    }
    const resolved = resolveRepositoryPath(".", candidate.path, "Worker candidate path");
    const relative = resolved.relative;
    const pathKey = filesystemPathKey(relative);
    if (pathKeys.has(pathKey)) throw new Error(`Worker candidate paths collide at '${relative}'.`);
    pathKeys.add(pathKey);
    if (!policy.capabilities.includes(candidate.capability)) {
      throw new Error(`Worker capability '${candidate.capability}' is not allowed for role '${policy.name}'.`);
    }
    if (!policy.writePathPrefixes.some((prefix) => pathMatchesPrefix(relative, prefix))) {
      throw new Error(`Worker candidate path is outside the '${policy.name}' write policy: ${relative}`);
    }
    if (candidate.capability === "phase-output") {
      if (!task.expectedOutputs.includes(relative)) throw new Error(`Worker phase-output candidate is not expected: ${relative}`);
    } else if (!relative.startsWith(CAPABILITY_PREFIXES[candidate.capability])) {
      throw new Error(`Worker candidate path does not match capability '${candidate.capability}': ${relative}`);
    }
    const bytes = Buffer.byteLength(candidate.content, "utf8");
    if (bytes > FILE_LIMIT_BYTES) throw new Error(`Worker candidate exceeds the 2 MiB file limit: ${relative}`);
    totalBytes += bytes;
    files.push({ path: relative, content: candidate.content, capability: candidate.capability, bytes });
  }
  const orderedPathKeys = [...pathKeys].sort();
  for (let index = 1; index < orderedPathKeys.length; index += 1) {
    if (orderedPathKeys[index].startsWith(`${orderedPathKeys[index - 1]}/`)) {
      throw new Error("Worker candidate paths overlap because one path is the parent of another.");
    }
  }

  const result = structuredClone(response.result);
  validateDispatchResultStructure(result);
  if (result.dispatchId !== task.dispatchId || result.storyId !== task.storyId || result.phase !== task.phase) {
    throw new Error("Worker result identity does not match the current task.");
  }
  if (result.status === "blocked" && !result.blocker) throw new Error("Blocked worker result requires blocker details.");
  const outputPaths = result.outputs.map((output) => resolveRepositoryPath(".", output.path, "Worker result output").relative);
  for (const output of outputPaths) {
    if (!output.startsWith(`${phaseRoot}/`)) throw new Error(`Worker result output must stay inside the current phase directory: ${output}`);
  }
  if (result.status === "completed" && JSON.stringify(outputPaths) !== JSON.stringify(task.expectedOutputs)) {
    throw new Error("Completed worker result outputs do not match the task output set.");
  }
  for (const output of outputPaths) {
    if (!pathKeys.has(filesystemPathKey(output))) throw new Error(`Worker result output does not reference a candidate file: ${output}`);
  }
  for (const record of result.records) {
    if (!record.path) continue;
    const recordPath = resolveRepositoryPath(".", record.path, "Worker result record").relative;
    if (!recordPath.startsWith(`${phaseRoot}/`)) {
      throw new Error(`Worker result record must stay inside the current phase directory: ${recordPath}`);
    }
    if (!pathKeys.has(filesystemPathKey(recordPath))) throw new Error(`Worker result record does not reference a candidate file: ${recordPath}`);
  }

  const resultContent = `${JSON.stringify(result, null, 2)}\n`;
  const resultBytes = Buffer.byteLength(resultContent, "utf8");
  if (resultBytes > FILE_LIMIT_BYTES) throw new Error("Worker result exceeds the 2 MiB file limit.");
  totalBytes += resultBytes;
  if (totalBytes > CONTEXT_LIMIT_BYTES) throw new Error("Worker candidates exceed the 8 MiB total limit.");
  return { files, result, resultContent, phaseRoot };
}

async function writeValidatedResponse(root, task, taskFile, validated, afterFilesWritten) {
  const resultFile = `${validated.phaseRoot}/result.json`;
  const resultTarget = resolveRepositoryPath(root, resultFile, "Worker result file");
  const prepared = [];
  const candidates = [];
  try {
    for (const file of validated.files) {
      const target = resolveRepositoryPath(root, file.path, "Worker candidate file");
      await assertWritableTarget(root, target.fullPath, "Worker candidate file");
      const temporary = `${target.fullPath}.${task.dispatchId}.worker.tmp`;
      await assertWritableTarget(root, temporary, "Worker candidate temporary file");
      candidates.push({ ...file, target: target.fullPath, temporary });
    }
    await assertWritableTarget(root, resultTarget.fullPath, "Worker result file");
    const resultTemporary = `${resultTarget.fullPath}.${task.dispatchId}.worker.tmp`;
    await assertWritableTarget(root, resultTemporary, "Worker result temporary file");

    for (const candidate of candidates) {
      await mkdir(path.dirname(candidate.target), { recursive: true });
      await writeFile(candidate.temporary, candidate.content, "utf8");
      prepared.push(candidate.temporary);
    }
    await mkdir(path.dirname(resultTarget.fullPath), { recursive: true });
    await writeFile(resultTemporary, validated.resultContent, "utf8");
    prepared.push(resultTemporary);

    for (const candidate of [...candidates].sort((left, right) => left.path.localeCompare(right.path))) {
      await rename(candidate.temporary, candidate.target);
      prepared.splice(prepared.indexOf(candidate.temporary), 1);
    }
    if (afterFilesWritten) await afterFilesWritten();
    await rename(resultTemporary, resultTarget.fullPath);
    prepared.splice(prepared.indexOf(resultTemporary), 1);
    return {
      status: validated.result.status,
      taskFile,
      resultFile,
      files: candidates.map((candidate) => candidate.path),
      result: validated.result,
    };
  } finally {
    await Promise.all(prepared.map((temporary) => unlink(temporary).catch(() => {})));
  }
}

export async function loadWorkerPolicies({ root = process.cwd() } = {}) {
  const repositoryRoot = path.resolve(root);
  const [agentSource, policySource] = await Promise.all([
    readRegularFile(path.join(repositoryRoot, ".codex/agents/agents.yaml"), "Agent registry"),
    readRegularFile(path.join(repositoryRoot, ".codex/agents/worker-policies.json"), "Worker policy registry"),
  ]);
  const agents = parseAgentRegistry(agentSource);
  let registry;
  try {
    registry = JSON.parse(policySource);
  } catch {
    throw new Error("Worker policy registry contains invalid JSON.");
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("Worker policy registry must be an object.");
  assertExactFields(registry, ["schemaVersion", "roles"], "Worker policy registry");
  if (registry.schemaVersion !== "1.0" || !Array.isArray(registry.roles)) {
    throw new Error("Worker policy registry requires schemaVersion '1.0' and roles.");
  }

  const policies = new Map();
  for (const role of registry.roles) {
    if (!role || typeof role !== "object" || Array.isArray(role)) throw new Error("Worker role policy must be an object.");
    assertExactFields(role, POLICY_FIELDS, "Worker role policy");
    for (const field of POLICY_FIELDS) {
      if (!(field in role)) throw new Error(`Worker role policy requires '${field}'.`);
    }
    if (typeof role.name !== "string" || !role.name) throw new Error("Worker role policy name is required.");
    if (policies.has(role.name)) throw new Error(`Worker policy registry contains duplicate role '${role.name}'.`);
    if (!CATEGORIES.has(role.category)) throw new Error(`Worker role '${role.name}' has unsupported category '${role.category}'.`);
    validateStringList(role.readPathPrefixes, `Worker role '${role.name}' read path`, validatePathPrefix);
    validateStringList(role.writePathPrefixes, `Worker role '${role.name}' write path`, validatePathPrefix);
    validateStringList(role.capabilities, `Worker role '${role.name}' capability`, (item) => CAPABILITIES.has(item));
    const expectedCapabilities = ROLE_CAPABILITIES[role.name];
    if (expectedCapabilities
        && (role.capabilities.length !== expectedCapabilities.length
          || expectedCapabilities.some((capability) => !role.capabilities.includes(capability)))) {
      throw new Error(`Worker role '${role.name}' capability set does not match its fixed role boundary.`);
    }
    policies.set(role.name, role);
  }

  for (const [name, agent] of agents) {
    const policy = policies.get(name);
    if (!policy) throw new Error(`Worker policy registry is missing agent role '${name}'.`);
    if (policy.category !== agent.category) throw new Error(`Worker policy category does not match agent '${name}'.`);
  }
  for (const name of policies.keys()) {
    if (!agents.has(name)) throw new Error(`Worker policy registry contains unknown role '${name}'.`);
  }
  return policies;
}

export async function runWorkerTask({
  root = process.cwd(),
  taskFile,
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  contextFiles = [],
  afterFilesWritten,
} = {}) {
  if (typeof provider !== "function") throw new Error("Worker provider must be a function.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new Error("Worker timeout must be an integer between 1 and 30000 milliseconds.");
  }
  if (!Array.isArray(contextFiles) || new Set(contextFiles).size !== contextFiles.length) {
    throw new Error("Worker contextFiles must be a unique array.");
  }

  const taskSource = await readBoundedUtf8(root, taskFile, "Worker task file");
  let task;
  try {
    task = JSON.parse(taskSource.content);
  } catch {
    throw new Error("Worker task file contains invalid JSON.");
  }
  validateDispatchTaskStructure(task);
  const phaseRoot = phaseRootForTask(taskSource.relative, task);
  const resultPath = resolveRepositoryPath(root, `${phaseRoot}/result.json`, "Worker result file").fullPath;
  const existingResult = await lstat(resultPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existingResult) {
    throw new Error("Worker result already exists; apply or inspect it instead of rerunning the provider.");
  }
  const policies = await loadWorkerPolicies({ root });
  const policy = policies.get(task.ownerAgent);
  if (!policy) throw new Error(`Worker task owner '${task.ownerAgent}' has no policy.`);

  let contextBytes = taskSource.bytes + Buffer.byteLength(JSON.stringify(policy), "utf8");
  const context = [];
  for (const contextFile of contextFiles) {
    const resolved = resolveRepositoryPath(root, contextFile, "Worker context file");
    if (!policy.readPathPrefixes.some((prefix) => pathMatchesPrefix(resolved.relative, prefix))) {
      throw new Error(`Worker context file is not allowed by the '${policy.name}' read policy: ${resolved.relative}`);
    }
    const loaded = await readBoundedUtf8(root, resolved.relative, "Worker context file");
    contextBytes += loaded.bytes;
    if (contextBytes > CONTEXT_LIMIT_BYTES) throw new Error("Worker context exceeds the 8 MiB total limit.");
    context.push({ path: loaded.relative, content: loaded.content });
  }
  if (contextBytes > CONTEXT_LIMIT_BYTES) throw new Error("Worker context exceeds the 8 MiB total limit.");

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Worker provider timed out after ${timeoutMs} milliseconds.`));
    }, timeoutMs);
  });
  let response;
  try {
    response = await Promise.race([
      Promise.resolve().then(() => provider({
        task: structuredClone(task),
        policy: structuredClone(policy),
        context,
        signal: controller.signal,
      })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  const validated = validateProviderResponse(response, task, policy, phaseRoot);
  return writeValidatedResponse(root, task, taskSource.relative, validated, afterFilesWritten);
}
