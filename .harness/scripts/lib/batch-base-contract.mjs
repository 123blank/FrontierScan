import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const verifiedBatchBases = new WeakMap();

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function pathKey(value) {
  const normalized = normalizePath(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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

export async function resolveBatchBase(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const baseRef = options.baseRef ?? "dev";
  if (typeof baseRef !== "string" || !baseRef.trim() || baseRef !== baseRef.trim() || baseRef.includes("\0")) {
    throw new Error("Base ref must be a non-empty string.");
  }
  await assertRepositoryRoot(root, options);
  const resolved = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], options);
  const baseCommit = resolved.ok ? resolved.stdout.trim() : "";
  if (!/^[a-f0-9]{40,64}$/.test(baseCommit)) throw new Error(`Cannot resolve base ref '${baseRef}'.`);
  const base = Object.freeze({ baseRef, baseCommit });
  verifiedBatchBases.set(base, pathKey(root));
  return base;
}

export function assertVerifiedBatchBase(base, root) {
  const expectedRoot = pathKey(path.resolve(root ?? process.cwd()));
  const verifiedRoot = base && typeof base === "object" ? verifiedBatchBases.get(base) : null;
  if (!verifiedRoot) {
    throw new Error("Serial batch preparation requires a verified batch base from resolveBatchBase.");
  }
  if (verifiedRoot !== expectedRoot) throw new Error("Verified batch base belongs to a different repository root.");
  if (typeof base.baseRef !== "string" || !base.baseRef.trim() || base.baseRef !== base.baseRef.trim() || base.baseRef.includes("\0")
      || typeof base.baseCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(base.baseCommit)) {
    throw new Error("Verified batch base is invalid.");
  }
  return base;
}
