import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { computeAreaSourceFingerprint } from "./source-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const AREAS = new Set(["backend", "frontend", "common"]);
const REFRESH_MODES = new Set(["baseline", "semantic", "all"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contentId(prefix, value) {
  return `${prefix}-${sha256(canonicalJson(value)).slice("sha256:".length, "sha256:".length + 32)}`;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} has invalid or missing fields.`);
  }
}

function assertDateTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a date-time string.`);
  }
}

function assertSha256(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 value.`);
  }
}

function assertCommonIdentity(value, label) {
  if (value.schemaVersion !== "1.0"
      || typeof value.storyId !== "string" || !STORY_ID_PATTERN.test(value.storyId)
      || value.runId !== value.storyId
      || typeof value.dispatchId !== "string" || !UUID_PATTERN.test(value.dispatchId)
      || !Number.isInteger(value.preparedRevision) || value.preparedRevision < 1
      || !AREAS.has(value.area)) {
    throw new Error(`${label} has an invalid common identity.`);
  }
}

function assertContentIdentity(relativePath, value, idField, prefix, bodyKeys, label) {
  const expectedId = contentId(
    prefix,
    Object.fromEntries(bodyKeys.map((key) => [key, value[key]])),
  );
  if (value[idField] !== expectedId || path.basename(relativePath) !== `${expectedId}.json`) {
    throw new Error(`${label} content identity or file name is invalid.`);
  }
}

function assertSnapshot(value, label) {
  assertExactKeys(value, ["files"], label);
  if (!Array.isArray(value.files)) throw new Error(`${label}.files must be an array.`);
  const paths = new Set();
  for (const file of value.files) {
    assertExactKeys(file, ["path", "sha256"], `${label} file`);
    if (typeof file.path !== "string" || !file.path || paths.has(file.path)) {
      throw new Error(`${label} file paths must be unique non-empty strings.`);
    }
    paths.add(file.path);
    assertSha256(file.sha256, `${label} file sha256`);
  }
}

function assertArtifactEvidence(value, label) {
  assertExactKeys(value, ["path", "sha256", "evidencePath", "evidenceSha256"], label);
  if (typeof value.path !== "string" || !value.path
      || typeof value.evidencePath !== "string" || !value.evidencePath) {
    throw new Error(`${label} paths must be non-empty strings.`);
  }
  assertSha256(value.sha256, `${label}.sha256`);
  assertSha256(value.evidenceSha256, `${label}.evidenceSha256`);
  if (value.sha256 !== value.evidenceSha256) {
    throw new Error(`${label} evidence must preserve the recorded bytes.`);
  }
}

function assertParameters(value, area, label) {
  assertExactKeys(value, ["area", "module", "mode"], label);
  if (value.area !== area || !AREAS.has(value.area)) {
    throw new Error(`${label}.area must match the knowledge area.`);
  }
  if (value.module !== null
      && (typeof value.module !== "string" || !MODULE_PATTERN.test(value.module))) {
    throw new Error(`${label}.module is invalid.`);
  }
  if (!REFRESH_MODES.has(value.mode)) throw new Error(`${label}.mode is invalid.`);
}

const EVIDENCE_BODY_KEYS = [
  "schemaVersion",
  "storyId",
  "runId",
  "dispatchId",
  "preparedRevision",
  "area",
  "status",
  "recordedSourceFingerprint",
  "currentSourceFingerprint",
  "baselineStatus",
  "semanticStatus",
  "indexStatus",
  "reason",
  "checkedAt",
];

function assertFreshnessEvidence(relativePath, evidence) {
  const label = "Knowledge freshness evidence";
  assertExactKeys(evidence, [...EVIDENCE_BODY_KEYS, "checkId"], label);
  assertCommonIdentity(evidence, label);
  if (!["fresh", "stale", "missing"].includes(evidence.status)
      || !["string", "object"].includes(typeof evidence.recordedSourceFingerprint)
      || !["string", "object"].includes(typeof evidence.currentSourceFingerprint)
      || typeof evidence.reason !== "string") {
    throw new Error(`${label} has invalid status or fingerprint fields.`);
  }
  assertSha256(evidence.recordedSourceFingerprint, `${label}.recordedSourceFingerprint`, { nullable: true });
  assertSha256(evidence.currentSourceFingerprint, `${label}.currentSourceFingerprint`, { nullable: true });
  for (const field of ["baselineStatus", "semanticStatus", "indexStatus"]) {
    if (evidence[field] !== null && typeof evidence[field] !== "string") {
      throw new Error(`${label}.${field} must be a string or null.`);
    }
  }
  assertDateTime(evidence.checkedAt, `${label}.checkedAt`);
  assertContentIdentity(relativePath, evidence, "checkId", "CHK", EVIDENCE_BODY_KEYS, label);
}

const REFRESH_TASK_BODY_KEYS = [
  "schemaVersion",
  "storyId",
  "runId",
  "dispatchId",
  "preparedRevision",
  "area",
  "parameters",
  "protectedAreas",
  "reason",
  "sourcePaths",
  "customSnapshots",
  "createdAt",
];

function assertRefreshTask(relativePath, refreshTask) {
  const label = "Knowledge refresh task";
  assertExactKeys(refreshTask, [...REFRESH_TASK_BODY_KEYS, "refreshTaskId"], label);
  assertCommonIdentity(refreshTask, label);
  assertParameters(refreshTask.parameters, refreshTask.area, `${label}.parameters`);
  const expectedProtectedAreas = protectedAreasFor(refreshTask.area);
  if (!Array.isArray(refreshTask.protectedAreas)
      || canonicalJson(refreshTask.protectedAreas) !== canonicalJson(expectedProtectedAreas)) {
    throw new Error(`${label}.protectedAreas does not match generator side effects.`);
  }
  if (typeof refreshTask.reason !== "string" || !refreshTask.reason) {
    throw new Error(`${label}.reason must be a non-empty string.`);
  }
  if (!Array.isArray(refreshTask.sourcePaths)
      || refreshTask.sourcePaths.some((item) => typeof item !== "string" || !item)
      || new Set(refreshTask.sourcePaths).size !== refreshTask.sourcePaths.length) {
    throw new Error(`${label}.sourcePaths must contain unique non-empty strings.`);
  }
  assertAreaSnapshots(refreshTask.customSnapshots, refreshTask.protectedAreas, `${label}.customSnapshots`);
  assertDateTime(refreshTask.createdAt, `${label}.createdAt`);
  assertContentIdentity(
    relativePath,
    refreshTask,
    "refreshTaskId",
    "KRT",
    REFRESH_TASK_BODY_KEYS,
    label,
  );
}

const REFRESH_RECEIPT_BODY_KEYS = [
  "schemaVersion",
  "storyId",
  "runId",
  "dispatchId",
  "preparedRevision",
  "area",
  "refreshTaskPath",
  "refreshTaskSha256",
  "parameters",
  "protectedAreas",
  "beforeFreshnessEvidencePath",
  "beforeFreshnessEvidenceSha256",
  "afterFreshnessEvidencePath",
  "afterFreshnessEvidenceSha256",
  "beforeCustomSnapshots",
  "afterCustomSnapshots",
  "generatedFiles",
  "indexManifest",
  "logFiles",
  "status",
  "completedAt",
];

function assertRefreshReceipt(relativePath, receipt) {
  const label = "Knowledge refresh receipt";
  assertExactKeys(receipt, [...REFRESH_RECEIPT_BODY_KEYS, "refreshId"], label);
  assertCommonIdentity(receipt, label);
  assertParameters(receipt.parameters, receipt.area, `${label}.parameters`);
  const expectedProtectedAreas = protectedAreasFor(receipt.area);
  if (!Array.isArray(receipt.protectedAreas)
      || canonicalJson(receipt.protectedAreas) !== canonicalJson(expectedProtectedAreas)) {
    throw new Error(`${label}.protectedAreas does not match generator side effects.`);
  }
  for (const field of [
    "refreshTaskPath",
    "beforeFreshnessEvidencePath",
    "afterFreshnessEvidencePath",
  ]) {
    if (typeof receipt[field] !== "string" || !receipt[field]) {
      throw new Error(`${label}.${field} must be a non-empty string.`);
    }
  }
  for (const field of [
    "refreshTaskSha256",
    "beforeFreshnessEvidenceSha256",
    "afterFreshnessEvidenceSha256",
  ]) {
    assertSha256(receipt[field], `${label}.${field}`);
  }
  assertAreaSnapshots(
    receipt.beforeCustomSnapshots,
    receipt.protectedAreas,
    `${label}.beforeCustomSnapshots`,
  );
  assertAreaSnapshots(
    receipt.afterCustomSnapshots,
    receipt.protectedAreas,
    `${label}.afterCustomSnapshots`,
  );
  if (!Array.isArray(receipt.generatedFiles)) {
    throw new Error(`${label}.generatedFiles must be an array.`);
  }
  receipt.generatedFiles.forEach(
    (item) => assertArtifactEvidence(item, `${label}.generatedFiles item`),
  );
  assertArtifactEvidence(receipt.indexManifest, `${label}.indexManifest`);
  if (receipt.indexManifest.path !== "llm-knowledge/index/manifest.json"
      || !Array.isArray(receipt.logFiles)) {
    throw new Error(`${label} has invalid index or log fields.`);
  }
  receipt.logFiles.forEach((item) => assertArtifactEvidence(item, `${label}.logFiles item`));
  if (receipt.status !== "completed") throw new Error(`${label}.status must be completed.`);
  assertDateTime(receipt.completedAt, `${label}.completedAt`);
  assertContentIdentity(
    relativePath,
    receipt,
    "refreshId",
    "KRR",
    REFRESH_RECEIPT_BODY_KEYS,
    label,
  );
}

function resolveInsideRoot(root, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const fullPath = path.resolve(root, relativePath);
  const relative = normalizePath(path.relative(root, fullPath));
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
}

function assertPathInsideDirectory(root, relativePath, directoryPath, label) {
  const resolved = resolveInsideRoot(root, relativePath, label);
  const directory = resolveInsideRoot(root, directoryPath, `${label} directory`);
  const relative = path.relative(directory.fullPath, resolved.fullPath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${normalizePath(directory.relative)}.`);
  }
  return resolved;
}

async function assertSafePathComponents(root, fullPath, { includeFinal = false } = {}) {
  const rootPath = path.resolve(root);
  const rootRealPath = await realpath(rootPath);
  const relative = path.relative(rootPath, fullPath);
  const parts = relative.split(path.sep).filter(Boolean);
  const limit = includeFinal ? parts.length : Math.max(0, parts.length - 1);
  let current = rootPath;
  for (let index = 0; index < limit; index += 1) {
    current = path.join(current, parts[index]);
    const info = await lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) break;
    if (info.isSymbolicLink()) {
      throw new Error(`Knowledge path contains a symbolic link or junction: ${normalizePath(current)}`);
    }
    const currentRealPath = await realpath(current);
    const realRelative = path.relative(rootRealPath, currentRealPath);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error(`Knowledge path resolves outside repository: ${normalizePath(current)}`);
    }
  }
}

async function writeImmutableJson(root, relativePath, value) {
  const resolved = resolveInsideRoot(root, relativePath, "Knowledge artifact path");
  const source = `${JSON.stringify(value, null, 2)}\n`;
  await assertSafePathComponents(root, resolved.fullPath);
  await mkdir(path.dirname(resolved.fullPath), { recursive: true });
  try {
    await writeFile(resolved.fullPath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const info = await lstat(resolved.fullPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Knowledge artifact must be an immutable regular file: ${relativePath}`);
    }
    const existing = await readFile(resolved.fullPath);
    if (!existing.equals(Buffer.from(source, "utf8"))) {
      throw new Error(`Knowledge artifact immutable byte identity collision: ${relativePath}`);
    }
  }
  return {
    path: resolved.relative,
    sha256: sha256(Buffer.from(source, "utf8")),
  };
}

async function writeImmutableBytes(root, relativePath, source) {
  const resolved = resolveInsideRoot(root, relativePath, "Knowledge artifact evidence path");
  await assertSafePathComponents(root, resolved.fullPath);
  await mkdir(path.dirname(resolved.fullPath), { recursive: true });
  try {
    await writeFile(resolved.fullPath, source, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const info = await lstat(resolved.fullPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Knowledge artifact evidence must be an immutable regular file: ${relativePath}`);
    }
    const existing = await readFile(resolved.fullPath);
    if (!existing.equals(source)) {
      throw new Error(`Knowledge artifact evidence identity collision: ${relativePath}`);
    }
  }
  return {
    path: resolved.relative,
    sha256: sha256(source),
  };
}

async function snapshotArtifactEvidence(root, task, relativePath, source) {
  const sourceSha256 = sha256(source);
  const evidence = await writeImmutableBytes(
    root,
    `${task.attemptRoot}/knowledge/artifacts/${sourceSha256.slice("sha256:".length)}/${relativePath}`,
    source,
  );
  return {
    path: normalizePath(relativePath),
    sha256: sourceSha256,
    evidencePath: evidence.path,
    evidenceSha256: evidence.sha256,
  };
}

async function snapshotFileEvidence(root, task, files) {
  return Promise.all(
    [...files]
      .sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)))
      .map(async (file) => snapshotArtifactEvidence(
        root,
        task,
        normalizePath(path.relative(root, file)),
        await readFile(file),
      )),
  );
}

async function readBoundJson(root, relativePath, expectedSha256, label) {
  const resolved = resolveInsideRoot(root, relativePath, label);
  await assertSafePathComponents(root, resolved.fullPath);
  const info = await lstat(resolved.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} is missing or invalid: ${relativePath}`);
  const source = await readFile(resolved.fullPath);
  if (sha256(source) !== expectedSha256) throw new Error(`${label} changed after it was recorded.`);
  try {
    return JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

async function listFiles(directory, root) {
  await assertSafePathComponents(root, directory, { includeFinal: true });
  const info = await lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Knowledge directory must be a real directory: ${normalizePath(directory)}`);
  }
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Knowledge directory contains a symbolic link: ${normalizePath(entryPath)}`);
    if (entry.isDirectory()) result.push(...await listFiles(entryPath, root));
    else if (entry.isFile()) result.push(entryPath);
  }
  return result;
}

async function assertKnowledgeWriteRoots(root, protectedAreas) {
  const directories = [
    "llm-knowledge",
    "llm-knowledge/index",
    ...protectedAreas.map((area) => `llm-knowledge/${area}`),
  ];
  for (const relativePath of directories) {
    const resolved = resolveInsideRoot(root, relativePath, "Knowledge write directory");
    await assertSafePathComponents(root, resolved.fullPath, { includeFinal: true });
    const info = await lstat(resolved.fullPath).catch(
      (error) => error?.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`Knowledge write directory contains a symbolic link or junction: ${relativePath}`);
    }
  }
  await listFiles(path.join(root, "llm-knowledge", "index"), root);
}

async function snapshotFiles(root, files) {
  return Promise.all(
    [...files]
      .sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)))
      .map(async (file) => ({
        path: normalizePath(path.relative(root, file)),
        sha256: sha256(await readFile(file)),
      })),
  );
}

function snapshotsEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function protectedAreasFor(area) {
  return area === "common" ? ["backend", "frontend", "common"] : [area];
}

export async function customSnapshotForArea(root, area) {
  if (!AREAS.has(area)) throw new Error(`Unsupported knowledge area '${area}'.`);
  const areaRoot = path.join(root, "llm-knowledge", area);
  const files = (await listFiles(areaRoot, root))
    .filter((file) => normalizePath(path.relative(areaRoot, file)).split("/").includes("custom"))
    .sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
  return {
    files: await Promise.all(files.map(async (file) => ({
      path: normalizePath(path.relative(root, file)),
      sha256: sha256(await readFile(file)),
    }))),
  };
}

async function customSnapshotsForAreas(root, areas) {
  return Promise.all(areas.map(async (area) => ({
    area,
    ...(await customSnapshotForArea(root, area)),
  })));
}

function assertAreaSnapshots(value, protectedAreas, label) {
  if (!Array.isArray(value) || value.length !== protectedAreas.length) {
    throw new Error(`${label} must contain every protected area.`);
  }
  value.forEach((snapshot, index) => {
    assertExactKeys(snapshot, ["area", "files"], `${label} area snapshot`);
    if (snapshot.area !== protectedAreas[index]) {
      throw new Error(`${label} area order must match protectedAreas.`);
    }
    assertSnapshot({ files: snapshot.files }, `${label}.${snapshot.area}`);
  });
}

export async function runFreshnessCheck({ root }) {
  const script = path.join(root, ".harness/scripts/check-kb-freshness.ps1");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-Root", root,
    "-Json",
  ], {
    cwd: root,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Knowledge freshness command returned invalid JSON.");
  }
}

async function runKnowledgeGenerator({ root, parameters }) {
  const script = path.join(root, ".harness/scripts/generate-kb.ps1");
  const area = parameters.area === "common" ? "all" : parameters.area;
  const args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-Root", root,
    "-Area", area,
    "-Mode", parameters.mode,
  ];
  if (parameters.module !== null) args.push("-Module", parameters.module);
  await execFileAsync("powershell.exe", args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function assertTask(task) {
  if (!task || task.schemaVersion !== "2.0" || task.phase !== "technical-design"
      || typeof task.storyId !== "string" || task.runId !== task.storyId
      || typeof task.dispatchId !== "string" || !task.dispatchId
      || !Number.isInteger(task.preparedRevision) || task.preparedRevision < 1
      || typeof task.attemptRoot !== "string" || !task.attemptRoot) {
    throw new Error("Knowledge check requires a prepared State v2 technical-design task.");
  }
}

function normalizeFinding(finding) {
  const observedStatus = finding.status === "fresh"
    ? "fresh"
    : finding.status === "missing-meta"
      ? "missing"
      : "stale";
  const sourceFingerprint = typeof finding.current_source_fingerprint === "string"
      && SHA256_PATTERN.test(finding.current_source_fingerprint)
    ? finding.current_source_fingerprint
    : null;
  return { observedStatus, sourceFingerprint };
}

export async function checkKnowledgeArea(options) {
  const root = path.resolve(options.root);
  const task = options.task;
  const area = options.area;
  assertTask(task);
  if (!AREAS.has(area)) throw new Error(`Unsupported knowledge area '${area}'.`);
  const runFreshness = options.runFreshness ?? runFreshnessCheck;
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  const raw = await runFreshness({ root });
  const finding = raw.findings?.find((item) => item.area === area);
  if (!finding) throw new Error(`Freshness result does not contain area '${area}'.`);
  const { observedStatus, sourceFingerprint } = normalizeFinding(finding);
  const evidenceBody = {
    schemaVersion: "1.0",
    storyId: task.storyId,
    runId: task.runId,
    dispatchId: task.dispatchId,
    preparedRevision: task.preparedRevision,
    area,
    status: observedStatus,
    recordedSourceFingerprint: finding.recorded_source_fingerprint || null,
    currentSourceFingerprint: sourceFingerprint,
    baselineStatus: finding.baseline_status || null,
    semanticStatus: finding.semantic_status || null,
    indexStatus: finding.index_status || null,
    reason: finding.reason || "",
    checkedAt,
  };
  const checkId = contentId("CHK", evidenceBody);
  const evidence = await writeImmutableJson(
    root,
    `${task.attemptRoot}/knowledge/checks/${checkId}.json`,
    { ...evidenceBody, checkId },
  );

  let refreshTask = null;
  if (observedStatus !== "fresh") {
    const target = raw.refresh_task?.targets?.find((item) => item.area === area);
    if (!target) throw new Error(`Stale knowledge area '${area}' has no refresh target.`);
    const protectedAreas = protectedAreasFor(area);
    const customSnapshots = await customSnapshotsForAreas(root, protectedAreas);
    const taskBody = {
      schemaVersion: "1.0",
      storyId: task.storyId,
      runId: task.runId,
      dispatchId: task.dispatchId,
      preparedRevision: task.preparedRevision,
      area,
      parameters: {
        area,
        module: typeof target.module === "string" && target.module ? target.module : null,
        mode: target.mode,
      },
      protectedAreas,
      reason: target.reason || finding.reason || "",
      sourcePaths: [...(target.source_paths ?? [])].sort(),
      customSnapshots,
      createdAt: checkedAt,
    };
    const refreshTaskId = contentId("KRT", taskBody);
    refreshTask = await writeImmutableJson(
      root,
      `${task.attemptRoot}/knowledge/tasks/${refreshTaskId}.json`,
      { ...taskBody, refreshTaskId },
    );
  }

  return {
    area: {
      area,
      relevant: true,
      observedStatus,
      status: observedStatus,
      sourceFingerprint,
      loadedFiles: [...(options.loadedFiles ?? [])],
      missing: observedStatus === "missing" ? [finding.reason || "Knowledge metadata is missing."] : [],
      checkedAt,
      freshnessEvidencePath: evidence.path,
      freshnessEvidenceSha256: evidence.sha256,
      refreshTaskPath: refreshTask?.path ?? null,
      refreshTaskSha256: refreshTask?.sha256 ?? null,
      refreshReceiptPath: null,
      refreshReceiptSha256: null,
      approvalId: null,
    },
  };
}

export async function verifyKnowledgeAreaArtifacts({
  root: requestedRoot,
  task,
  area,
  verifyCurrentFingerprint = false,
}) {
  const root = path.resolve(requestedRoot);
  assertTask(task);
  if (!area || area.relevant !== true || !AREAS.has(area.area)) {
    throw new Error("Knowledge verification requires a relevant supported area.");
  }
  assertPathInsideDirectory(
    root,
    area.freshnessEvidencePath,
    `${task.attemptRoot}/knowledge/checks`,
    "Knowledge freshness evidence",
  );
  const evidence = await readBoundJson(
    root,
    area.freshnessEvidencePath,
    area.freshnessEvidenceSha256,
    "Knowledge freshness evidence",
  );
  assertFreshnessEvidence(area.freshnessEvidencePath, evidence);
  if (evidence.schemaVersion !== "1.0"
      || evidence.storyId !== task.storyId
      || evidence.runId !== task.runId
      || evidence.dispatchId !== task.dispatchId
      || evidence.preparedRevision !== task.preparedRevision
      || evidence.area !== area.area
      || evidence.status !== area.observedStatus
      || evidence.currentSourceFingerprint !== area.sourceFingerprint
      || evidence.checkedAt !== area.checkedAt) {
    throw new Error("Knowledge freshness evidence does not match the current area.");
  }
  if (verifyCurrentFingerprint) {
    const current = await computeAreaSourceFingerprint(root, area.area);
    if (current.status !== "complete" || current.fingerprint !== area.sourceFingerprint) {
      throw new Error(`Knowledge source fingerprint changed after check: ${area.area}`);
    }
  }

  let refreshTask = null;
  if (area.refreshTaskPath !== null) {
    assertPathInsideDirectory(
      root,
      area.refreshTaskPath,
      `${task.attemptRoot}/knowledge/tasks`,
      "Knowledge refresh task",
    );
    refreshTask = await readBoundJson(
      root,
      area.refreshTaskPath,
      area.refreshTaskSha256,
      "Knowledge refresh task",
    );
    assertRefreshTask(area.refreshTaskPath, refreshTask);
    if (refreshTask.schemaVersion !== "1.0"
        || refreshTask.storyId !== task.storyId
        || refreshTask.runId !== task.runId
        || refreshTask.dispatchId !== task.dispatchId
        || refreshTask.preparedRevision !== task.preparedRevision
        || refreshTask.area !== area.area
        || refreshTask.parameters?.area !== area.area) {
      throw new Error("Knowledge refresh task does not match the current area.");
    }
  }

  if (area.refreshReceiptPath !== null) {
    assertPathInsideDirectory(
      root,
      area.refreshReceiptPath,
      `${task.attemptRoot}/knowledge/refreshes`,
      "Knowledge refresh receipt",
    );
    const receipt = await readBoundJson(
      root,
      area.refreshReceiptPath,
      area.refreshReceiptSha256,
      "Knowledge refresh receipt",
    );
    assertRefreshReceipt(area.refreshReceiptPath, receipt);
    if (receipt.schemaVersion !== "1.0"
        || receipt.storyId !== task.storyId
        || receipt.runId !== task.runId
        || receipt.dispatchId !== task.dispatchId
        || receipt.preparedRevision !== task.preparedRevision
        || receipt.area !== area.area
        || receipt.refreshTaskPath !== area.refreshTaskPath
        || receipt.refreshTaskSha256 !== area.refreshTaskSha256
        || !refreshTask
        || canonicalJson(receipt.parameters) !== canonicalJson(refreshTask.parameters)
        || canonicalJson(receipt.protectedAreas) !== canonicalJson(refreshTask.protectedAreas)
        || receipt.afterFreshnessEvidencePath !== area.freshnessEvidencePath
        || receipt.afterFreshnessEvidenceSha256 !== area.freshnessEvidenceSha256
        || receipt.status !== "completed") {
      throw new Error("Knowledge refresh receipt does not match the current area.");
    }
    assertPathInsideDirectory(
      root,
      receipt.beforeFreshnessEvidencePath,
      `${task.attemptRoot}/knowledge/checks`,
      "Knowledge freshness evidence",
    );
    const beforeEvidence = await readBoundJson(
      root,
      receipt.beforeFreshnessEvidencePath,
      receipt.beforeFreshnessEvidenceSha256,
      "Knowledge freshness evidence",
    );
    assertFreshnessEvidence(receipt.beforeFreshnessEvidencePath, beforeEvidence);
    for (const file of receipt.generatedFiles) {
      assertPathInsideDirectory(
        root,
        file.evidencePath,
        `${task.attemptRoot}/knowledge/artifacts`,
        "Generated knowledge evidence",
      );
      await readBoundJsonOrFile(
        root,
        file.evidencePath,
        file.evidenceSha256,
        "Generated knowledge evidence",
      );
    }
    assertPathInsideDirectory(
      root,
      receipt.indexManifest.evidencePath,
      `${task.attemptRoot}/knowledge/artifacts`,
      "Knowledge index evidence",
    );
    await readBoundJsonOrFile(
      root,
      receipt.indexManifest.evidencePath,
      receipt.indexManifest.evidenceSha256,
      "Knowledge index evidence",
    );
    for (const file of receipt.logFiles) {
      assertPathInsideDirectory(
        root,
        file.evidencePath,
        `${task.attemptRoot}/knowledge/artifacts`,
        "Knowledge log evidence",
      );
      await readBoundJsonOrFile(
        root,
        file.evidencePath,
        file.evidenceSha256,
        "Knowledge log evidence",
      );
    }
    const currentCustom = await customSnapshotsForAreas(root, receipt.protectedAreas);
    if (!snapshotsEqual(currentCustom, receipt.afterCustomSnapshots)
        || !snapshotsEqual(receipt.beforeCustomSnapshots, receipt.afterCustomSnapshots)) {
      throw new Error("Knowledge custom snapshot changed during refresh.");
    }
  }
  return area;
}

async function readBoundJsonOrFile(root, relativePath, expectedSha256, label) {
  const resolved = resolveInsideRoot(root, relativePath, label);
  await assertSafePathComponents(root, resolved.fullPath);
  const info = await lstat(resolved.fullPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} is missing or invalid: ${relativePath}`);
  const source = await readFile(resolved.fullPath);
  if (sha256(source) !== expectedSha256) throw new Error(`${label} changed after it was recorded.`);
  return source;
}

async function recoveryReceipt(root, task, area, verifyCurrentFingerprint) {
  const directory = resolveInsideRoot(
    root,
    `${task.attemptRoot}/knowledge/refreshes`,
    "Knowledge refresh directory",
  ).fullPath;
  await assertSafePathComponents(root, directory, { includeFinal: true });
  const info = await lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Knowledge refresh directory must be a real directory.");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) continue;
    const relativePath = normalizePath(path.relative(root, path.join(directory, entry.name)));
    const source = await readFile(path.join(directory, entry.name));
    let receipt;
    try {
      receipt = JSON.parse(source.toString("utf8"));
    } catch {
      continue;
    }
    if (receipt.storyId !== task.storyId
        || receipt.dispatchId !== task.dispatchId
        || receipt.area !== area.area
        || receipt.refreshTaskPath !== area.refreshTaskPath
        || receipt.refreshTaskSha256 !== area.refreshTaskSha256
        || receipt.status !== "completed") {
      continue;
    }
    const afterEvidence = await readBoundJson(
      root,
      receipt.afterFreshnessEvidencePath,
      receipt.afterFreshnessEvidenceSha256,
      "Knowledge freshness evidence",
    ).catch(() => null);
    if (!afterEvidence) continue;
    const recoveredArea = {
      ...area,
      observedStatus: "fresh",
      status: "fresh",
      sourceFingerprint: afterEvidence.currentSourceFingerprint,
      missing: [],
      checkedAt: afterEvidence.checkedAt,
      freshnessEvidencePath: receipt.afterFreshnessEvidencePath,
      freshnessEvidenceSha256: receipt.afterFreshnessEvidenceSha256,
      refreshReceiptPath: relativePath,
      refreshReceiptSha256: sha256(source),
      approvalId: null,
    };
    try {
      await verifyKnowledgeAreaArtifacts({
        root,
        task,
        area: recoveredArea,
        verifyCurrentFingerprint,
      });
      return recoveredArea;
    } catch {
      continue;
    }
  }
  return null;
}

export async function refreshKnowledgeArea(options) {
  const root = path.resolve(options.root);
  const task = options.task;
  const area = options.area;
  const verifyCurrentFingerprint = options.verifyCurrentFingerprint ?? true;
  assertTask(task);
  if (!area || !area.relevant || !["stale", "missing"].includes(area.status)) {
    throw new Error("Knowledge refresh requires a relevant stale or missing area.");
  }
  await verifyKnowledgeAreaArtifacts({ root, task, area, verifyCurrentFingerprint });
  const recovered = await recoveryReceipt(root, task, area, verifyCurrentFingerprint);
  if (recovered) return { area: recovered, reused: true };

  const refreshTask = await readBoundJson(
    root,
    area.refreshTaskPath,
    area.refreshTaskSha256,
    "Knowledge refresh task",
  );
  assertRefreshTask(area.refreshTaskPath, refreshTask);
  const beforeCustomSnapshots = await customSnapshotsForAreas(root, refreshTask.protectedAreas);
  if (!snapshotsEqual(beforeCustomSnapshots, refreshTask.customSnapshots)) {
    throw new Error("Knowledge custom snapshot changed before refresh.");
  }
  const areaRoots = refreshTask.protectedAreas.map(
    (protectedArea) => path.join(root, "llm-knowledge", protectedArea),
  );
  await assertKnowledgeWriteRoots(root, refreshTask.protectedAreas);
  const beforeLogs = await snapshotFiles(
    root,
    (await Promise.all(areaRoots.map((areaRoot) => listFiles(areaRoot, root))))
      .flat()
      .filter((file) => path.basename(file) === "log.md"),
  );
  const runGenerate = options.runGenerate
    ? async ({ parameters }) => options.runGenerate(parameters)
    : runKnowledgeGenerator;
  await runGenerate({ root, parameters: refreshTask.parameters });

  const afterCustomSnapshots = await customSnapshotsForAreas(root, refreshTask.protectedAreas);
  if (!snapshotsEqual(beforeCustomSnapshots, afterCustomSnapshots)) {
    throw new Error("Knowledge custom snapshot changed during refresh.");
  }
  const checked = await checkKnowledgeArea({
    root,
    task,
    area: area.area,
    loadedFiles: area.loadedFiles,
    now: options.now,
    runFreshness: options.runFreshness,
  });
  if (checked.area.status !== "fresh") {
    throw new Error(`Knowledge area '${area.area}' is still ${checked.area.status} after refresh.`);
  }
  const indexManifestPath = "llm-knowledge/index/manifest.json";
  const indexSource = await readFile(
    resolveInsideRoot(root, indexManifestPath, "Knowledge index manifest").fullPath,
  );
  const indexManifest = await snapshotArtifactEvidence(
    root,
    task,
    indexManifestPath,
    indexSource,
  );
  const afterLogFiles = (await Promise.all(areaRoots.map((areaRoot) => listFiles(areaRoot, root))))
    .flat()
    .filter((file) => path.basename(file) === "log.md");
  const afterLogs = await snapshotFiles(root, afterLogFiles);
  if (!afterLogs.length || snapshotsEqual(beforeLogs, afterLogs)) {
    throw new Error("Knowledge refresh did not update a knowledge log.");
  }
  const generatedSourceFiles = (await Promise.all(areaRoots.map(async (areaRoot) => (
      (await listFiles(areaRoot, root)).filter(
        (file) => !normalizePath(path.relative(areaRoot, file)).split("/").includes("custom"),
      )
    )))).flat();
  const generatedFiles = await snapshotFileEvidence(root, task, generatedSourceFiles);
  const logPaths = new Set(afterLogFiles.map((file) => normalizePath(path.relative(root, file))));
  const logFiles = generatedFiles.filter((file) => logPaths.has(file.path));
  const receiptBody = {
    schemaVersion: "1.0",
    storyId: task.storyId,
    runId: task.runId,
    dispatchId: task.dispatchId,
    preparedRevision: task.preparedRevision,
    area: area.area,
    refreshTaskPath: area.refreshTaskPath,
    refreshTaskSha256: area.refreshTaskSha256,
    parameters: refreshTask.parameters,
    protectedAreas: refreshTask.protectedAreas,
    beforeFreshnessEvidencePath: area.freshnessEvidencePath,
    beforeFreshnessEvidenceSha256: area.freshnessEvidenceSha256,
    afterFreshnessEvidencePath: checked.area.freshnessEvidencePath,
    afterFreshnessEvidenceSha256: checked.area.freshnessEvidenceSha256,
    beforeCustomSnapshots,
    afterCustomSnapshots,
    generatedFiles,
    indexManifest,
    logFiles,
    status: "completed",
    completedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  const refreshId = contentId("KRR", receiptBody);
  const receipt = await writeImmutableJson(
    root,
    `${task.attemptRoot}/knowledge/refreshes/${refreshId}.json`,
    { ...receiptBody, refreshId },
  );
  if (options.afterReceiptWrite) await options.afterReceiptWrite();
  const refreshedArea = {
    ...checked.area,
    refreshTaskPath: area.refreshTaskPath,
    refreshTaskSha256: area.refreshTaskSha256,
    refreshReceiptPath: receipt.path,
    refreshReceiptSha256: receipt.sha256,
  };
  await verifyKnowledgeAreaArtifacts({
    root,
    task,
    area: refreshedArea,
    verifyCurrentFingerprint,
  });
  return { area: refreshedArea, reused: false };
}
