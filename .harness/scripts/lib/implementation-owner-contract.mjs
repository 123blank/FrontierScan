import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export const IMPLEMENTATION_OWNER_MODES = new Set([
  "ordinary",
  "serial-batch",
  "worktree-wave",
]);

const OWNER_FIELDS = [
  "schemaVersion",
  "storyId",
  "runId",
  "phase",
  "mode",
  "ownerId",
  "preparedRevision",
  "taskDagFile",
  "taskDagSha256",
  "acquiredAt",
];
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

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
  const info = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

function validateImplementationOwnerStructure(owner) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)
      || Object.keys(owner).length !== OWNER_FIELDS.length
      || OWNER_FIELDS.some((field) => !Object.hasOwn(owner, field))
      || owner.schemaVersion !== "1.0"
      || typeof owner.storyId !== "string" || !owner.storyId
      || typeof owner.runId !== "string" || !owner.runId
      || owner.phase !== "implementation"
      || !IMPLEMENTATION_OWNER_MODES.has(owner.mode)
      || typeof owner.ownerId !== "string" || !owner.ownerId
      || !Number.isInteger(owner.preparedRevision) || owner.preparedRevision < 1
      || typeof owner.taskDagFile !== "string" || !owner.taskDagFile
      || !SHA256_PATTERN.test(owner.taskDagSha256)
      || typeof owner.acquiredAt !== "string" || Number.isNaN(Date.parse(owner.acquiredAt))) {
    throw new Error("Implementation owner has an invalid structure.");
  }
}

export function implementationOwnerPath(state) {
  return `.harness/runs/${state.runtime.runId}/phases/03-implementation/implementation-owner.json`;
}

export async function inspectImplementationOwner({ root, state }) {
  const file = implementationOwnerPath(state);
  const owner = await readJsonOptional(
    resolveInsideRoot(root, file, "Implementation owner").fullPath,
    "Implementation owner",
  );
  if (!owner) return null;
  validateImplementationOwnerStructure(owner);
  if (owner.storyId !== state.storyId
      || owner.runId !== state.runtime.runId
      || owner.preparedRevision !== state.runtime.revision) {
    throw new Error("Implementation owner identity does not match the active state.");
  }
  const expectedTaskDagFile = `.harness/runs/${state.runtime.runId}/phases/02-task-dag/task-dag.json`;
  if (owner.taskDagFile !== expectedTaskDagFile) {
    throw new Error("Implementation owner Task DAG path does not match the active run.");
  }
  const taskDagPath = resolveInsideRoot(root, owner.taskDagFile, "Implementation owner Task DAG").fullPath;
  const taskDagSha256 = `sha256:${createHash("sha256").update(await readFile(taskDagPath)).digest("hex")}`;
  if (taskDagSha256 !== owner.taskDagSha256) {
    throw new Error("Implementation owner Task DAG hash drifted.");
  }
  return { file, owner };
}

async function legacyWaveLedgerExists(root, state) {
  const waves = resolveInsideRoot(
    root,
    `.harness/runs/${state.runtime.runId}/waves`,
    "Wave execution directory",
  );
  const info = await lstat(waves.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Wave execution directory must be a real directory.");
  }
  const entries = await readdir(waves.fullPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error("Wave execution directory contains a symbolic link.");
    }
    if (!entry.isDirectory()) continue;
    const ledgerPath = path.join(waves.fullPath, entry.name, "execution-ledger.json");
    const ledgerInfo = await lstat(ledgerPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!ledgerInfo) continue;
    if (!ledgerInfo.isFile() || ledgerInfo.isSymbolicLink()) {
      throw new Error("Wave execution ledger must be a regular file.");
    }
    return true;
  }
  return false;
}

export async function assertImplementationModeAvailable({ root, state, requestedMode }) {
  if (!IMPLEMENTATION_OWNER_MODES.has(requestedMode)) {
    throw new Error(`Unsupported implementation owner mode: ${requestedMode}`);
  }
  const current = await inspectImplementationOwner({ root, state });
  if (!current && await legacyWaveLedgerExists(root, state)) {
    if (requestedMode !== "worktree-wave") {
      throw new Error(
        `A legacy worktree-wave ledger owns the implementation phase; '${requestedMode}' execution is not allowed.`,
      );
    }
    return { file: null, owner: { mode: "worktree-wave" }, legacy: true };
  }
  if (current && current.owner.mode !== requestedMode) {
    if (current.owner.mode === "serial-batch" && requestedMode === "ordinary") {
      throw new Error(
        "Implementation owner 'serial-batch' requires a matching finalized batch binding; ordinary execution is not allowed.",
      );
    }
    throw new Error(
      `Implementation owner '${current.owner.mode}' owns the implementation phase; '${requestedMode}' execution is not allowed.`,
    );
  }
  return current;
}

export async function assertImplementationOwner({
  root,
  state,
  expectedMode,
  expectedOwnerId,
}) {
  if (typeof expectedOwnerId !== "string" || !expectedOwnerId) {
    throw new Error("Expected implementation owner ID is required.");
  }
  const current = await assertImplementationModeAvailable({
    root,
    state,
    requestedMode: expectedMode,
  });
  if (!current) {
    return {
      file: null,
      owner: { mode: expectedMode, ownerId: expectedOwnerId },
      legacy: true,
    };
  }
  if (current.owner.ownerId !== expectedOwnerId) {
    if (expectedMode === "serial-batch") {
      throw new Error("Implementation owner identity does not match the finalized batch binding.");
    }
    throw new Error("Implementation owner identity does not match the requested execution.");
  }
  return current;
}

export async function acquireImplementationOwner({
  root,
  state,
  mode,
  ownerId,
  taskDagFile,
  now,
}) {
  if (!IMPLEMENTATION_OWNER_MODES.has(mode)) {
    throw new Error(`Unsupported implementation owner mode: ${mode}`);
  }
  if (typeof ownerId !== "string" || !ownerId) {
    throw new Error("Implementation owner ID is required.");
  }
  const taskDag = resolveInsideRoot(root, taskDagFile, "Implementation owner Task DAG");
  const taskDagSha256 = `sha256:${createHash("sha256").update(await readFile(taskDag.fullPath)).digest("hex")}`;
  const file = implementationOwnerPath(state);
  const ownerPath = resolveInsideRoot(root, file, "Implementation owner").fullPath;
  const desired = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    phase: "implementation",
    mode,
    ownerId,
    preparedRevision: state.runtime.revision,
    taskDagFile: taskDag.relative,
    taskDagSha256,
    acquiredAt: (now ?? (() => new Date().toISOString()))(),
  };
  validateImplementationOwnerStructure(desired);
  await mkdir(path.dirname(ownerPath), { recursive: true });

  let handle;
  try {
    handle = await open(ownerPath, "wx");
    await handle.writeFile(`${JSON.stringify(desired, null, 2)}\n`, "utf8");
    await handle.close();
    return { file, owner: desired, reused: false };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code !== "EEXIST") {
      if (handle) await unlink(ownerPath).catch(() => {});
      throw error;
    }
  }

  const current = await inspectImplementationOwner({ root, state });
  if (!current
      || current.owner.mode !== desired.mode
      || current.owner.ownerId !== desired.ownerId
      || current.owner.taskDagFile !== desired.taskDagFile
      || current.owner.taskDagSha256 !== desired.taskDagSha256) {
    throw new Error("Implementation phase is owned by another execution mode or identity.");
  }
  return { ...current, reused: true };
}
