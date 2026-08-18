import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  sha256,
  validateDeliveryFacts,
  validateDeliveryReceipt,
  validateOwnedManifest,
  validateRepositoryPath,
} from "./delivery-contract.mjs";
import { matchesPredictedFile } from "./task-dag-contract.mjs";
import { runStateCommand, withStateWriteLock } from "./state-runtime.mjs";
import { validateStateDocument } from "./state-contract.mjs";

const execFileAsync = promisify(execFile);

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function resolveInsideRoot(root, relativePath, label) {
  validateRepositoryPath(relativePath, label);
  const fullPath = path.resolve(root, relativePath);
  const relative = normalizePath(path.relative(root, fullPath));
  if (relative !== relativePath || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return fullPath;
}

async function executeGit(root, args, options = {}) {
  if (options.executeGit) return options.executeGit(args);
  try {
    return await execFileAsync("git", args, {
      cwd: root,
      windowsHide: true,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : error?.stderr;
    throw new Error((stderr || error?.message || "Git command failed.").trim());
  }
}

async function executeRemoteGit(root, args, options = {}) {
  if (options.executeRemoteGit) return options.executeRemoteGit(args);
  try {
    return await execFileAsync("git", args, {
      cwd: root,
      windowsHide: true,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.remoteTimeoutMs ?? 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (error) {
    if (error?.killed || error?.signal === "SIGTERM") throw new Error("Git remote verification timed out.");
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : error?.stderr;
    throw new Error((stderr || error?.message || "Git remote verification failed.").trim());
  }
}

function stdoutBuffer(result) {
  if (Buffer.isBuffer(result.stdout)) return result.stdout;
  return Buffer.from(result.stdout ?? "", "utf8");
}

function stdoutText(result) {
  return stdoutBuffer(result).toString("utf8").trim();
}

function nulFields(buffer) {
  return buffer.toString("utf8").split("\0").filter((item) => item !== "");
}

export function parseNameStatusZ(source) {
  const fields = nulFields(Buffer.isBuffer(source) ? source : Buffer.from(source));
  const relations = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const kind = status[0];
    if (["R", "C"].includes(kind)) {
      const sourcePath = normalizePath(fields[index++] ?? "");
      const targetPath = normalizePath(fields[index++] ?? "");
      validateRepositoryPath(sourcePath, "Git source path");
      validateRepositoryPath(targetPath, "Git target path");
      relations.push({
        path: targetPath,
        changeKind: kind === "R" ? "renamed" : "copied",
        sourcePath,
      });
      continue;
    }
    const changedPath = normalizePath(fields[index++] ?? "");
    validateRepositoryPath(changedPath, "Git changed path");
    const changeKind = { A: "added", M: "modified", D: "deleted", T: "modified" }[kind];
    if (!changeKind) throw new Error(`Unsupported Git name-status '${status}'.`);
    relations.push({ path: changedPath, changeKind, sourcePath: null });
  }
  return relations;
}

function parseUntrackedZ(source) {
  const relations = [];
  for (const entry of nulFields(Buffer.isBuffer(source) ? source : Buffer.from(source))) {
    if (!entry.startsWith("?? ")) continue;
    const filePath = normalizePath(entry.slice(3));
    validateRepositoryPath(filePath, "Git untracked path");
    relations.push({ path: filePath, changeKind: "added", sourcePath: null });
  }
  return relations;
}

function relationPaths(relation) {
  if (relation.changeKind === "renamed") return [relation.sourcePath, relation.path];
  return [relation.path];
}

function relationSafetyPaths(relation) {
  if (["renamed", "copied"].includes(relation.changeKind)) return [relation.sourcePath, relation.path];
  return [relation.path];
}

function isControlPath(state, candidate) {
  return candidate === `.harness/states/e2e-${state.storyId}.json`
    || candidate === `.harness/states/e2e-${state.storyId}.events.jsonl`
    || candidate === `.harness/states/e2e-${state.storyId}.lock`
    || candidate === ".harness/states/active-run.json"
    || candidate === ".harness/states/active-run.lock"
    || candidate.startsWith(`.harness/runs/${state.runtime.runId}/`);
}

function initialDirtyPathSet(state) {
  const paths = new Set();
  for (const item of state.baseline.initialDirtyPaths ?? []) {
    validateRepositoryPath(item.path, "Baseline initial dirty path");
    paths.add(item.path);
    const renameOrCopy = ["R", "C"].includes(item.indexStatus) || ["R", "C"].includes(item.worktreeStatus);
    if (renameOrCopy && !item.sourcePath) {
      throw new Error(`Baseline initial dirty rename/copy '${item.path}' is missing sourcePath.`);
    }
    if (item.sourcePath) {
      validateRepositoryPath(item.sourcePath, "Baseline initial dirty sourcePath");
      paths.add(item.sourcePath);
    }
  }
  return paths;
}

function sorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function relationSort(left, right) {
  return left.path.localeCompare(right.path, "en")
    || (left.sourcePath ?? "").localeCompare(right.sourcePath ?? "", "en");
}

async function baselineEntries(root, baselineHead, options) {
  const result = await executeGit(root, ["ls-tree", "-r", "-z", baselineHead], options);
  const entries = new Map();
  for (const item of nulFields(stdoutBuffer(result))) {
    const match = item.match(/^([0-9]{6})\s+blob\s+([a-f0-9]{40})\t(.+)$/);
    if (!match) continue;
    const [, mode, blobOid, rawPath] = match;
    const filePath = normalizePath(rawPath);
    validateRepositoryPath(filePath, "Baseline tree path");
    entries.set(filePath, { path: filePath, mode, blobOid });
  }
  return entries;
}

async function currentFileIdentity(root, filePath, options) {
  const fullPath = resolveInsideRoot(root, filePath, "Changed file");
  const info = await lstat(fullPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) return null;
  const oidResult = await executeGit(root, ["hash-object", `--path=${filePath}`, filePath], options);
  const blobOid = stdoutText(oidResult);
  const indexResult = await executeGit(root, ["ls-files", "--stage", "--", filePath], options);
  const indexLine = stdoutText(indexResult).split(/\r?\n/, 1)[0];
  const indexMode = indexLine ? indexLine.split(/\s+/, 1)[0] : null;
  const mode = process.platform === "win32"
    ? (indexMode ?? "100644")
    : ((info.mode & 0o111) ? "100755" : "100644");
  return { path: filePath, blobOid, mode };
}

function sameIdentity(left, right) {
  return left?.blobOid === right?.blobOid && left?.mode === right?.mode;
}

async function foldWorkingTreeRelations(root, baselineHead, relations, options) {
  const baseline = await baselineEntries(root, baselineHead, options);
  const deleted = relations.filter((item) => item.changeKind === "deleted");
  const added = relations.filter((item) => item.changeKind === "added");
  const consumed = new Set();
  const replacements = [];

  for (const addedRelation of added) {
    const current = await currentFileIdentity(root, addedRelation.path, options);
    const samePathDelete = deleted.find((item) => item.path === addedRelation.path && !consumed.has(item));
    if (samePathDelete) {
      consumed.add(samePathDelete);
      consumed.add(addedRelation);
      if (!sameIdentity(baseline.get(addedRelation.path), current)) {
        replacements.push({ path: addedRelation.path, changeKind: "modified", sourcePath: null });
      }
      continue;
    }

    const renameCandidates = deleted.filter(
      (item) => !consumed.has(item) && sameIdentity(baseline.get(item.path), current),
    );
    if (renameCandidates.length === 1) {
      consumed.add(renameCandidates[0]);
      consumed.add(addedRelation);
      replacements.push({
        path: addedRelation.path,
        changeKind: "renamed",
        sourcePath: renameCandidates[0].path,
      });
      continue;
    }

    const copyCandidates = [...baseline.values()].filter(
      (entry) => entry.path !== addedRelation.path
        && !deleted.some((item) => item.path === entry.path)
        && sameIdentity(entry, current),
    );
    if (copyCandidates.length === 1) {
      consumed.add(addedRelation);
      replacements.push({
        path: addedRelation.path,
        changeKind: "copied",
        sourcePath: copyCandidates[0].path,
      });
    }
  }

  return [
    ...relations.filter((item) => !consumed.has(item)),
    ...replacements,
  ].sort(relationSort);
}

async function gitIdentity(root, options) {
  const [headResult, branchResult] = await Promise.all([
    executeGit(root, ["rev-parse", "--verify", "HEAD"], options),
    executeGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], options),
  ]);
  return { head: stdoutText(headResult), branch: stdoutText(branchResult) };
}

async function assertBaseline(root, state, options) {
  const identity = await gitIdentity(root, options);
  if (identity.branch !== state.baseline.branch) {
    throw new Error(`Current Git branch '${identity.branch}' does not match baseline branch '${state.baseline.branch}'.`);
  }
  if (!/^[a-f0-9]{40}$/.test(state.baseline.head ?? "")) throw new Error("Baseline head is invalid.");
  await executeGit(root, ["cat-file", "-e", `${state.baseline.head}^{commit}`], options);
  try {
    await executeGit(root, ["merge-base", "--is-ancestor", state.baseline.head, identity.head], options);
  } catch {
    throw new Error("Baseline head is not an ancestor of current HEAD.");
  }
  return identity;
}

async function currentRelations(root, state, options) {
  const [trackedResult, statusResult] = await Promise.all([
    executeGit(root, [
      "diff", "--name-status", "-z", "--find-renames", "--find-copies", state.baseline.head, "--",
    ], options),
    executeGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], options),
  ]);
  const parsedRelations = [
    ...parseNameStatusZ(stdoutBuffer(trackedResult)),
    ...parseUntrackedZ(stdoutBuffer(statusResult)),
  ];
  const hasDeletedRelation = parsedRelations.some((item) => item.changeKind === "deleted");
  const foldCandidates = hasDeletedRelation
    ? parsedRelations
    : parsedRelations.filter(
      (item) => item.changeKind !== "added" || !isControlPath(state, item.path),
    );
  const relations = await foldWorkingTreeRelations(root, state.baseline.head, foldCandidates, options);
  const unique = new Map();
  for (const relation of relations) {
    if (relation.changeKind === "copied" && isControlPath(state, relation.path)) {
      continue;
    }
    const endpoints = relationSafetyPaths(relation);
    const controlEndpoints = endpoints.filter((item) => isControlPath(state, item));
    if (controlEndpoints.length === endpoints.length) continue;
    if (controlEndpoints.length) {
      throw new Error(`Git rename/copy crosses a delivery control asset boundary: ${endpoints.join(" -> ")}`);
    }
    unique.set(`${relation.changeKind}\0${relation.sourcePath ?? ""}\0${relation.path}`, relation);
  }
  return [...unique.values()].sort(relationSort);
}

export async function deriveDeliveryFacts(options) {
  const root = path.resolve(options.root);
  const { state } = options;
  if (state?.schemaVersion !== "2.0") throw new Error("Delivery facts require State v2.");
  const identity = await assertBaseline(root, state, options);
  const relations = await currentRelations(root, state, options);
  const actual = new Set(state.implementation.actualFiles ?? []);
  for (const filePath of actual) {
    validateRepositoryPath(filePath, "Implementation actual file");
    if (isControlPath(state, filePath)) throw new Error(`Implementation actual file is a delivery control asset: ${filePath}`);
  }
  const initialDirty = initialDirtyPathSet(state);
  const changedPaths = new Set(relations.flatMap(relationPaths));
  for (const filePath of actual) {
    if (initialDirty.has(filePath)) {
      throw new Error(`Implementation actual file collides with baseline initial dirty path: ${filePath}`);
    }
    if (!changedPaths.has(filePath)) throw new Error(`Implementation actual file is not changed: ${filePath}`);
  }

  const owned = [];
  const unrelated = [];
  for (const relation of relations) {
    const paths = relationPaths(relation);
    const safetyPaths = relationSafetyPaths(relation);
    const polluted = safetyPaths.some((item) => initialDirty.has(item));
    const claimed = relation.changeKind === "renamed"
      ? paths.every((item) => actual.has(item))
      : actual.has(relation.path);
    if (polluted && paths.some((item) => actual.has(item))) {
      throw new Error(`Initial dirty rename/copy relation overlaps implementation actual files: ${safetyPaths.join(", ")}`);
    }
    if (claimed && !polluted) owned.push(...paths);
    else unrelated.push(...paths);
  }

  const predicted = (state.dag.nodes ?? []).flatMap((node) => node.predictedFiles ?? []);
  const ownedFiles = sorted(owned);
  const facts = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    baselineHead: state.baseline.head,
    head: identity.head,
    branch: identity.branch,
    relations,
    ownedFiles,
    outOfPredictionFiles: ownedFiles.filter(
      (filePath) => !predicted.some((pattern) => matchesPredictedFile(pattern, filePath)),
    ),
    unrelatedDirtyFiles: sorted(unrelated),
  };
  validateDeliveryFacts(facts);
  return facts;
}

async function targetMode(root, filePath, options) {
  const result = await executeGit(root, ["ls-files", "--stage", "--", filePath], options);
  const line = stdoutText(result).split(/\r?\n/, 1)[0];
  if (line && process.platform === "win32") {
    const mode = line.split(/\s+/, 1)[0];
    if (!["100644", "100755"].includes(mode)) throw new Error(`Owned file has unsupported Git mode '${mode}': ${filePath}`);
    return mode;
  }
  const info = await lstat(resolveInsideRoot(root, filePath, "Owned file"));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Owned path is not a regular file: ${filePath}`);
  return process.platform === "win32" ? "100644" : ((info.mode & 0o111) ? "100755" : "100644");
}

async function manifestEntry(root, relation, options) {
  if (relation.changeKind === "deleted") {
    return {
      path: relation.path,
      changeKind: "deleted",
      sourcePath: null,
      contentSha256: null,
      blobOid: null,
      mode: null,
    };
  }
  const fullPath = resolveInsideRoot(root, relation.path, "Owned file");
  const info = await lstat(fullPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Owned path is not a regular file: ${relation.path}`);
  const content = await readFile(fullPath);
  const oidResult = await executeGit(root, ["hash-object", `--path=${relation.path}`, relation.path], options);
  const blobOid = stdoutText(oidResult);
  if (!/^[a-f0-9]{40}$/.test(blobOid)) throw new Error(`Git blob identity is invalid for ${relation.path}.`);
  return {
    path: relation.path,
    changeKind: relation.changeKind,
    sourcePath: relation.sourcePath,
    contentSha256: sha256(content),
    blobOid,
    mode: await targetMode(root, relation.path, options),
  };
}

async function readExistingManifest(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Owned manifest is invalid JSON: ${filePath}`);
  }
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await unlink(temporaryPath).catch(() => {});
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, filePath);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function withReceiptLock(lockPath, options, action) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lockId = randomUUID();
  const owner = {
    lockId,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date().toISOString(),
  };
  const waitMs = options.lockWaitMs ?? 30_000;
  const staleMs = options.lockStaleMs ?? 300_000;
  const retryMs = options.lockRetryMs ?? 100;
  const deadline = Date.now() + waitMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
      let existing;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        if (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, retryMs));
          continue;
        }
        throw new Error(`Delivery receipt is locked by an unreadable lock file: ${lockPath}`);
      }
      const age = Date.now() - Date.parse(existing.createdAt);
      const live = existing.hostname === os.hostname() && processExists(existing.pid);
      if (Number.isFinite(age) && age > staleMs && !live) {
        await unlink(lockPath);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Delivery receipt is locked by process ${existing.pid ?? "unknown"}.`);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  try {
    return await action();
  } finally {
    await handle.close();
    const current = await readFile(lockPath, "utf8").then(JSON.parse).catch(() => null);
    if (current?.lockId === lockId) await unlink(lockPath).catch(() => {});
  }
}

function sameFacts(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function manifestSubject(options, facts) {
  const entries = [];
  const owned = new Set(facts.ownedFiles);
  for (const relation of facts.relations) {
    const claimed = relation.changeKind === "renamed"
      ? owned.has(relation.sourcePath) && owned.has(relation.path)
      : owned.has(relation.path);
    if (claimed) entries.push(await manifestEntry(path.resolve(options.root), relation, options));
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    schemaVersion: "1.0",
    storyId: options.state.storyId,
    runId: options.state.runtime.runId,
    baselineHead: options.state.baseline.head,
    entries,
  };
}

export async function prepareOwnedManifest(options) {
  const root = path.resolve(options.root);
  const facts = await deriveDeliveryFacts(options);
  const manifestFile = `.harness/runs/${options.state.runtime.runId}/delivery/owned-manifest.json`;
  const fullPath = resolveInsideRoot(root, manifestFile, "Owned manifest file");
  const existing = await readExistingManifest(fullPath);
  const subject = await manifestSubject(options, facts);
  if (existing) {
    validateOwnedManifest(existing);
    const existingSubject = {
      schemaVersion: existing.schemaVersion,
      storyId: existing.storyId,
      runId: existing.runId,
      baselineHead: existing.baselineHead,
      entries: existing.entries,
    };
    if (canonicalJson(existingSubject) === canonicalJson(subject)) {
      const content = `${JSON.stringify(existing, null, 2)}\n`;
      return {
        status: "already-prepared",
        facts,
        manifest: existing,
        manifestFile,
        manifestSha256: sha256(content),
      };
    }
  }
  const manifest = {
    ...subject,
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  validateOwnedManifest(manifest);
  const confirmedFacts = await deriveDeliveryFacts(options);
  if (!sameFacts(facts, confirmedFacts)) {
    throw new Error("Git delivery facts changed while preparing the owned manifest.");
  }
  const confirmedSubject = await manifestSubject(options, confirmedFacts);
  if (canonicalJson(subject) !== canonicalJson(confirmedSubject)) {
    throw new Error("Owned manifest entries changed while preparing the manifest.");
  }
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await atomicWrite(fullPath, content);
  return {
    status: "prepared",
    facts,
    manifest,
    manifestFile,
    manifestSha256: sha256(content),
  };
}

export async function verifyOwnedManifest(options) {
  const root = path.resolve(options.root);
  const expectedFile = `.harness/runs/${options.state.runtime.runId}/delivery/owned-manifest.json`;
  if (options.manifestFile !== expectedFile) {
    throw new Error(`Owned manifest path must be '${expectedFile}'.`);
  }
  const fullPath = resolveInsideRoot(root, expectedFile, "Owned manifest file");
  const content = await readFile(fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`Owned manifest is missing: ${expectedFile}`);
    throw error;
  });
  if (sha256(content) !== options.manifestSha256) throw new Error("Owned manifest hash changed.");
  let manifest;
  try {
    manifest = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("Owned manifest is invalid JSON.");
  }
  validateOwnedManifest(manifest);
  const facts = await deriveDeliveryFacts(options);
  const expectedSubject = await manifestSubject(options, facts);
  const actualSubject = {
    schemaVersion: manifest.schemaVersion,
    storyId: manifest.storyId,
    runId: manifest.runId,
    baselineHead: manifest.baselineHead,
    entries: manifest.entries,
  };
  if (canonicalJson(actualSubject) !== canonicalJson(expectedSubject)) {
    throw new Error("Owned manifest does not match current delivery facts.");
  }
  return { facts, manifest, manifestFile: expectedFile, manifestSha256: options.manifestSha256 };
}

async function readRequired(root, relativePath, label) {
  const fullPath = resolveInsideRoot(root, relativePath, label);
  const content = await readFile(fullPath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing: ${relativePath}`);
    throw error;
  });
  return { fullPath, content };
}

async function commitTreeEntry(root, commit, filePath, options) {
  const result = await executeGit(root, ["ls-tree", commit, "--", filePath], options);
  const line = stdoutText(result);
  if (!line) return null;
  const match = line.match(/^([0-9]{6})\s+blob\s+([a-f0-9]{40})\t(.+)$/);
  if (!match) throw new Error(`Commit tree has an unsupported entry for ${filePath}.`);
  return { mode: match[1], blobOid: match[2], path: normalizePath(match[3]) };
}

async function commitFacts(root, state, manifest, commit, options) {
  if (!commit) {
    return {
      status: "not-requested",
      sha: null,
      parents: [],
      filesSinceBaseline: [],
      extraFiles: [],
    };
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Commit must be a full 40-character SHA.");
  const type = stdoutText(await executeGit(root, ["cat-file", "-t", commit], options));
  if (type !== "commit") throw new Error(`Git object is not a commit: ${commit}`);
  try {
    await executeGit(root, ["merge-base", "--is-ancestor", state.baseline.head, commit], options);
  } catch {
    throw new Error("Baseline head is not an ancestor of the delivery commit.");
  }
  const parentsLine = stdoutText(await executeGit(root, ["rev-list", "--parents", "-n", "1", commit], options));
  const [, ...parents] = parentsLine.split(/\s+/);
  const diffResult = await executeGit(root, [
    "diff", "--name-status", "-z", "--find-renames", "--find-copies",
    `${state.baseline.head}..${commit}`,
  ], options);
  const relations = parseNameStatusZ(stdoutBuffer(diffResult));
  const filesSinceBaseline = sorted(relations.flatMap(relationPaths));
  const owned = new Set(state.delivery.ownedFiles);
  const extraFiles = filesSinceBaseline.filter((filePath) => !owned.has(filePath));

  for (const entry of manifest.entries) {
    const target = await commitTreeEntry(root, commit, entry.path, options);
    if (entry.changeKind === "deleted") {
      if (target) throw new Error(`Commit tree does not match deleted manifest entry: ${entry.path}`);
      continue;
    }
    if (!target || target.blobOid !== entry.blobOid || target.mode !== entry.mode) {
      throw new Error(`Commit tree blob or mode does not match owned manifest: ${entry.path}`);
    }
    if (entry.changeKind === "renamed" && await commitTreeEntry(root, commit, entry.sourcePath, options)) {
      throw new Error(`Commit tree still contains renamed manifest source: ${entry.sourcePath}`);
    }
  }
  return { status: "recorded", sha: commit, parents, filesSinceBaseline, extraFiles };
}

async function pushFacts(root, commit, options) {
  if (!options.remote && !options.ref) {
    return { status: "not-requested", remote: null, ref: null, commit: null };
  }
  if (!commit || !options.remote || !options.ref) {
    throw new Error("Push receipt requires Commit, Remote, and Ref together.");
  }
  if (!options.ref.startsWith("refs/")) throw new Error("Push ref must be a full ref.");
  const result = await executeRemoteGit(root, ["ls-remote", "--refs", options.remote, options.ref], options);
  const lines = stdoutText(result).split(/\r?\n/).filter(Boolean);
  const matching = lines.find((line) => line.endsWith(`\t${options.ref}`));
  if (!matching || matching.split(/\s+/, 1)[0] !== commit) {
    throw new Error(`Remote ref '${options.ref}' does not point to commit '${commit}'.`);
  }
  return { status: "recorded", remote: options.remote, ref: options.ref, commit };
}

function receiptSubject(receipt) {
  const { receiptId, recordedAt, ...subject } = receipt;
  return subject;
}

function receiptIdFor(subject) {
  return `DR-${sha256(canonicalJson(subject)).slice("sha256:".length, "sha256:".length + 32)}`;
}

export async function recordDeliveryReceipt(options) {
  const root = path.resolve(options.root ?? process.cwd());
  if (!options.stateFile) throw new Error("StateFile is required to record a delivery receipt.");
  const lockPath = resolveInsideRoot(root, `${options.stateFile}.delivery-receipt.lock`, "Delivery receipt lock");
  return withReceiptLock(lockPath, options, async () => {
    const stateRecord = await readRequired(root, options.stateFile, "Completed State");
    let state;
    try {
      state = JSON.parse(stateRecord.content.toString("utf8"));
    } catch {
      throw new Error("Completed State is invalid JSON.");
    }
    validateStateDocument(state);
    if (state.schemaVersion !== "2.0" || state.phase !== "done" || state.runtime?.status !== "completed") {
      throw new Error("Delivery receipt requires a completed State v2.");
    }
    if (state.delivery?.status !== "ready") throw new Error("Completed State delivery must be ready.");
    const eventsFile = `.harness/states/e2e-${state.storyId}.events.jsonl`;
    const eventsRecord = await readRequired(root, eventsFile, "State events");
    const summaryRecord = await readRequired(root, state.delivery.summaryFile, "Delivery summary");
    const manifestRecord = await readRequired(root, state.delivery.ownedManifestFile, "Owned manifest");
    if (sha256(summaryRecord.content) !== state.delivery.summarySha256) throw new Error("Delivery summary changed after completion.");
    if (sha256(manifestRecord.content) !== state.delivery.ownedManifestSha256) throw new Error("Owned manifest changed after completion.");
    let manifest;
    try {
      manifest = JSON.parse(manifestRecord.content.toString("utf8"));
    } catch {
      throw new Error("Owned manifest is invalid JSON.");
    }
    validateOwnedManifest(manifest);
    const commit = await commitFacts(root, state, manifest, options.commit, options);
    const push = await pushFacts(root, options.commit, options);
    const base = {
      schemaVersion: "1.0",
      storyId: state.storyId,
      runId: state.runtime.runId,
      stateFile: options.stateFile,
      stateSha256: sha256(stateRecord.content),
      eventsFile,
      eventsSha256: sha256(eventsRecord.content),
      baselineHead: state.baseline.head,
      deliverySummaryFile: state.delivery.summaryFile,
      deliverySummarySha256: state.delivery.summarySha256,
      ownedManifestFile: state.delivery.ownedManifestFile,
      ownedManifestSha256: state.delivery.ownedManifestSha256,
      commit,
      push,
    };
    const receiptId = receiptIdFor(base);
    const receiptFile = `.harness/runs/${state.runtime.runId}/delivery/receipts/${receiptId}.json`;
    const fullPath = resolveInsideRoot(root, receiptFile, "Delivery receipt file");
    const existing = await readExistingManifest(fullPath);
    if (existing) {
      validateDeliveryReceipt(existing);
      if (
        existing.receiptId !== receiptId
        || existing.recordedAt !== state.runtime.updatedAt
        || canonicalJson(receiptSubject(existing)) !== canonicalJson(base)
      ) {
        throw new Error(`Existing delivery receipt content drifted: ${receiptFile}`);
      }
      return { status: "already-recorded", receiptId, receiptFile, receipt: existing };
    }
    const receipt = {
      ...base,
      receiptId,
      recordedAt: state.runtime.updatedAt,
    };
    validateDeliveryReceipt(receipt);
    await atomicWrite(fullPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { status: "recorded", receiptId, receiptFile, receipt };
  });
}

export async function runDeliveryCommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.command === "summarize") {
    const fresh = await runStateCommand({ root, command: "status", stateFile: options.stateFile });
    return {
      command: "summarize",
      stateFile: fresh.stateFile,
      state: fresh.state,
      facts: await deriveDeliveryFacts({ ...options, root, state: fresh.state }),
    };
  }
  if (options.command === "prepare-manifest") {
    return withStateWriteLock({ ...options, root }, async (fresh) => {
      if (fresh.state.schemaVersion !== "2.0"
          || fresh.state.runtime.status !== "active"
          || fresh.state.phase !== "delivery-preparation") {
        throw new Error("PrepareManifest requires an active State v2 in delivery-preparation.");
      }
      const prepared = await prepareOwnedManifest({ ...options, root, state: fresh.state });
      return {
        command: "prepare-manifest",
        stateFile: fresh.stateFile,
        ...prepared,
      };
    });
  }
  if (options.command === "record") {
    return { command: "record", ...await recordDeliveryReceipt({ ...options, root }) };
  }
  throw new Error(`Unsupported delivery command: ${options.command ?? "(missing)"}`);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = {
    "--root": "root",
    "--state-file": "stateFile",
    "--commit": "commit",
    "--remote": "remote",
    "--ref": "ref",
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
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
    const result = await runDeliveryCommand(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Delivery command '${result.command}' completed.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`Delivery command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
