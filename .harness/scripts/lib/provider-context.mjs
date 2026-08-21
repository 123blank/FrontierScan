import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateDispatchTaskStructure } from "./dispatch-contract.mjs";
import { validateProviderContext } from "./provider-contract.mjs";
import {
  pathMatchesPrefix,
  readBoundedUtf8,
  resolveRepositoryPath,
} from "./worker-runtime.mjs";

const execFileAsync = promisify(execFile);
const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const CONTEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const GENERATED_CONTEXT_DIRECTORY = "provider/context";
const EXCLUDED_REVIEW_PREFIXES = [
  ".harness/states/",
  ".harness/runs/",
  "llm-knowledge/",
];

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function assertPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Provider reviewer policy must be an object.");
  }
  if (policy.name !== "code-reviewer" || policy.category !== "review") {
    throw new Error("Provider reviewer policy must belong to code-reviewer.");
  }
  if (!Array.isArray(policy.readPathPrefixes) || !policy.readPathPrefixes.length) {
    throw new Error("Provider reviewer policy requires readPathPrefixes.");
  }
}

function readOnlyPolicy(policy) {
  assertPolicy(policy);
  return {
    name: policy.name,
    category: policy.category,
    readPathPrefixes: [...policy.readPathPrefixes],
    writePathPrefixes: [],
    capabilities: [...(policy.capabilities ?? [])],
  };
}

function normalizeRelativePath(value, label) {
  return resolveRepositoryPath(".", value, label).relative;
}

function initialDirtyPaths(state) {
  return new Set(
    (state.baseline?.initialDirtyPaths ?? []).map((entry) => entry.path.toLowerCase()),
  );
}

function isReviewArtifactPath(relativePath) {
  const key = relativePath.toLowerCase();
  return EXCLUDED_REVIEW_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function eligibleReviewFiles(state) {
  const dirty = initialDirtyPaths(state);
  const files = [];
  const seen = new Set();
  for (const value of state.implementation?.actualFiles ?? []) {
    const relative = normalizeRelativePath(value, "Implementation actual file");
    const key = relative.toLowerCase();
    if (seen.has(key)) throw new Error(`Implementation actual files contain duplicate path '${relative}'.`);
    seen.add(key);
    if (dirty.has(key) || isReviewArtifactPath(relative)) continue;
    files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function fileExists(root, relativePath) {
  const fullPath = resolveRepositoryPath(root, relativePath, "Provider context file").fullPath;
  return lstat(fullPath).then(() => true, (error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

async function runGitDefault(root, args, { encoding = "utf8" } = {}) {
  const result = await execFileAsync("git", args, {
    cwd: root,
    encoding,
    windowsHide: true,
    maxBuffer: 12 * 1024 * 1024,
  });
  return result.stdout;
}

function deletedBaselineBuffer(value, relativePath) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  if (content.byteLength > FILE_LIMIT_BYTES) {
    throw new Error(`Provider deleted review target exceeds 2 MiB: ${relativePath}`);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error(`Provider deleted review target baseline is not valid UTF-8: ${relativePath}`);
  }
  return content;
}

function parseStatusKind(status) {
  if (status === "??") return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  if (status.includes("A")) return "added";
  return "modified";
}

function addedDiff(relativePath, content) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export async function collectTaskOwnedDiff({
  root,
  files,
  baselineHead,
  runGit = runGitDefault,
}) {
  if (!/^[a-f0-9]{40}$/i.test(baselineHead ?? "")) {
    throw new Error("Provider diff baseline HEAD is invalid.");
  }
  const targets = [];
  const sections = [];
  for (const relativePath of files) {
    const statusOutput = await runGit(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      relativePath,
    ]);
    const statusLine = statusOutput.replaceAll("\r\n", "\n").split("\n").find(Boolean);
    if (!statusLine) throw new Error(`Task-owned file has no diff against the current worktree: ${relativePath}`);
    const status = statusLine.slice(0, 2);
    const changeKind = parseStatusKind(status);
    let content;
    let diffText;
    if (status === "??") {
      const loaded = await readBoundedUtf8(root, relativePath, "Provider untracked review target");
      content = Buffer.from(loaded.content, "utf8");
      diffText = addedDiff(relativePath, loaded.content);
    } else {
      diffText = await runGit(root, [
        "diff",
        "--no-ext-diff",
        "--binary",
        "--unified=80",
        baselineHead,
        "--",
        relativePath,
      ]);
      if (changeKind === "deleted") {
        const baselineContent = await runGit(
          root,
          ["show", `${baselineHead}:${relativePath}`],
          { encoding: null },
        );
        content = deletedBaselineBuffer(baselineContent, relativePath);
      } else {
        const loaded = await readBoundedUtf8(root, relativePath, "Provider review target");
        content = Buffer.from(loaded.content, "utf8");
      }
    }
    if (!diffText.trim()) throw new Error(`Task-owned diff is empty for '${relativePath}'.`);
    sections.push(diffText.endsWith("\n") ? diffText : `${diffText}\n`);
    targets.push({
      path: relativePath,
      sha256: sha256(content),
      changeKind,
    });
  }
  return {
    diffText: sections.join("\n"),
    targets,
  };
}

export async function assertProviderContextAttempt({
  root,
  state,
  task,
  taskFile,
}) {
  if (state?.schemaVersion !== "2.0") throw new Error("Provider context requires State v2.");
  if (state.phase !== "code-review") throw new Error("Provider context State phase must be code-review.");
  if (state.runtime?.status !== "active") throw new Error("Provider context State must be active.");
  if (task?.phase !== "code-review") throw new Error("Provider context task phase must be code-review.");
  if (task.ownerAgent !== "code-reviewer") throw new Error("Provider context task owner must be code-reviewer.");
  if (task.storyId !== state.storyId) throw new Error("Provider context task Story identity does not match State.");
  if (task.runId !== state.runtime.runId) throw new Error("Provider context task run identity does not match State.");
  if (task.preparedRevision !== state.runtime.revision) {
    throw new Error("Provider context task prepared revision does not match State.");
  }
  if (taskFile !== `${task.attemptRoot}/task.json`) {
    throw new Error("Provider context task file does not match dispatch identity.");
  }
  try {
    validateDispatchTaskStructure(task);
  } catch (error) {
    throw new Error(`Provider context task identity is invalid: ${error.message}`);
  }
  const loadedTask = await readBoundedUtf8(root, taskFile, "Provider context task file");
  let parsedTask;
  try {
    parsedTask = JSON.parse(loadedTask.content);
  } catch {
    throw new Error("Provider context task file contains invalid JSON.");
  }
  if (canonicalJson(parsedTask) !== canonicalJson(task)) {
    throw new Error("Provider context task file identity does not match the supplied task.");
  }
  if (await fileExists(root, task.resultFile)) {
    throw new Error("Provider result already exists; apply or inspect it instead of preparing context.");
  }
  return { state, task, taskFile };
}

export function projectProviderReviewState(state) {
  return {
    storyId: state.storyId,
    runId: state.runtime.runId,
    phase: state.phase,
    revision: state.runtime.revision,
    acceptanceCriteria: structuredClone(state.requirement?.acceptanceCriteria ?? []),
    designDecisions: structuredClone(state.design?.decisions ?? []),
    dag: {
      sourceFile: state.dag?.sourceFile ?? null,
      sourceSha256: state.dag?.sourceSha256 ?? null,
      nodes: structuredClone(state.dag?.nodes ?? []),
    },
    implementation: {
      actualFiles: structuredClone(state.implementation?.actualFiles ?? []),
      completedTaskIds: structuredClone(state.implementation?.completedTaskIds ?? []),
    },
    tests: {
      cases: structuredClone(state.tests?.cases ?? []),
      results: structuredClone(state.tests?.results ?? []),
    },
    knowledge: structuredClone(state.knowledge?.areas ?? []),
  };
}

function testEvidenceSummary(state) {
  return {
    cases: structuredClone(state.tests?.cases ?? []),
    results: structuredClone(state.tests?.results ?? []),
  };
}

function ensureAllowedByPolicy(relativePath, policy, label) {
  const normalized = normalizeRelativePath(relativePath, label);
  if (!policy.readPathPrefixes.some((prefix) => pathMatchesPrefix(normalized, prefix))) {
    throw new Error(`${label} is not allowed by the code-reviewer read policy: ${normalized}`);
  }
  return normalized;
}

function generatedPath(task, fileName) {
  return `${task.attemptRoot}/${GENERATED_CONTEXT_DIRECTORY}/${fileName}`;
}

function contentRecord(relativePath, content, purpose, source, generated) {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength > FILE_LIMIT_BYTES) {
    throw new Error(`Provider context file exceeds the 2 MiB file limit: ${relativePath}`);
  }
  return {
    entry: {
      path: relativePath,
      sha256: sha256(buffer),
      bytes: buffer.byteLength,
      purpose,
      source,
    },
    content,
    generated,
  };
}

async function loadContentRecord(root, relativePath, purpose, source, policy) {
  const normalized = ensureAllowedByPolicy(relativePath, policy, `Provider context file '${relativePath}'`);
  const loaded = await readBoundedUtf8(root, normalized, `Provider context file '${normalized}'`);
  return contentRecord(normalized, loaded.content, purpose, source, false);
}

function generatedContentRecord(task, fileName, content, purpose, source, policy) {
  const relativePath = generatedPath(task, fileName);
  const normalized = ensureAllowedByPolicy(
    relativePath,
    policy,
    `Generated provider context file '${relativePath}'`,
  );
  return contentRecord(normalized, content, purpose, source, true);
}

function acceptedKnowledgeAreas(state) {
  const result = [];
  for (const area of state.knowledge?.areas ?? []) {
    if (!area.relevant || area.status === "not-relevant") continue;
    if (!["fresh", "accepted-stale"].includes(area.status)) {
      throw new Error(`Provider knowledge area '${area.area}' is relevant but ${area.status}.`);
    }
    result.push({
      area: area.area,
      status: area.status,
      loadedFiles: [...(area.loadedFiles ?? [])],
    });
  }
  return result;
}

function verifyDiffTargets(eligibleFiles, diff) {
  if (!diff || typeof diff !== "object" || !Array.isArray(diff.targets)
      || typeof diff.diffText !== "string" || !diff.diffText.trim()) {
    throw new Error("Provider task-owned diff collector returned an invalid result.");
  }
  const eligible = new Set(eligibleFiles.map((file) => file.toLowerCase()));
  const targets = new Set();
  for (const target of diff.targets) {
    const relative = normalizeRelativePath(target.path, "Provider diff target");
    const key = relative.toLowerCase();
    if (!eligible.has(key)) {
      throw new Error(`Provider diff target is not task-owned or is initial dirty: ${relative}`);
    }
    if (targets.has(key)) throw new Error(`Provider diff contains duplicate target '${relative}'.`);
    targets.add(key);
  }
  if (targets.size !== eligible.size || [...eligible].some((file) => !targets.has(file))) {
    throw new Error("Provider reviewTargets must match task-owned diff files one-to-one.");
  }
}

export async function createProviderContextCandidate({
  root,
  state,
  task,
  taskFile,
  policy,
  now = () => new Date().toISOString(),
  collectDiff = collectTaskOwnedDiff,
}) {
  await assertProviderContextAttempt({ root, state, task, taskFile });
  const providerPolicy = readOnlyPolicy(policy);
  const knowledgeAreas = acceptedKnowledgeAreas(state);
  const reviewFiles = eligibleReviewFiles(state);
  const diff = await collectDiff({
    root,
    files: reviewFiles,
    baselineHead: state.baseline.head,
  });
  verifyDiffTargets(reviewFiles, diff);

  const records = [];
  records.push(await loadContentRecord(root, taskFile, "当前 code-review dispatch task", "task", providerPolicy));
  records.push(generatedContentRecord(
    task,
    "state-projection.json",
    canonicalJson(projectProviderReviewState(state)),
    "审核所需的最小 State 投影",
    "state",
    providerPolicy,
  ));
  records.push(await loadContentRecord(
    root,
    state.dag.sourceFile,
    "当前任务 DAG",
    "dag",
    providerPolicy,
  ));
  records.push(await loadContentRecord(root, "AGENTS.md", "项目级执行规则", "project-rule", providerPolicy));
  records.push(generatedContentRecord(
    task,
    "reviewer-policy.json",
    canonicalJson(providerPolicy),
    "只读 code-reviewer 策略",
    "policy",
    providerPolicy,
  ));
  records.push(await loadContentRecord(
    root,
    ".codex/skills/frontier-code-review-gate/SKILL.md",
    "代码审核 Skill",
    "project-rule",
    providerPolicy,
  ));
  records.push(await loadContentRecord(
    root,
    ".codex/skills/frontier-code-review-gate/references/review-checklist.md",
    "代码审核检查清单",
    "project-rule",
    providerPolicy,
  ));
  for (const area of knowledgeAreas) {
    for (const file of area.loadedFiles) {
      records.push(await loadContentRecord(
        root,
        file,
        `${area.area} 知识文件，状态为 ${area.status}`,
        "knowledge",
        providerPolicy,
      ));
    }
  }
  records.push(generatedContentRecord(
    task,
    "task-owned.diff",
    diff.diffText,
    "task-owned diff",
    "diff",
    providerPolicy,
  ));
  records.push(generatedContentRecord(
    task,
    "test-evidence-summary.json",
    canonicalJson(testEvidenceSummary(state)),
    "当前有效测试证据摘要",
    "test-evidence",
    providerPolicy,
  ));

  const totalBytes = records.reduce((sum, record) => sum + record.entry.bytes, 0);
  if (totalBytes > CONTEXT_LIMIT_BYTES) {
    throw new Error("Provider context exceeds the 8 MiB total limit.");
  }
  const manifest = {
    schemaVersion: "1.0",
    storyId: state.storyId,
    runId: state.runtime.runId,
    dispatchId: task.dispatchId,
    role: "code-reviewer",
    entries: records.map((record) => record.entry),
    reviewTargets: diff.targets.map((target) => ({
      path: normalizeRelativePath(target.path, "Provider review target"),
      sha256: target.sha256,
      changeKind: target.changeKind,
    })),
    knowledgeAreas,
    totalBytes,
    createdAt: now(),
  };
  validateProviderContext(manifest);
  return {
    manifest,
    manifestFile: `${task.attemptRoot}/provider/context-manifest.json`,
    contents: records.map(({ entry, content, generated }) => ({
      path: entry.path,
      content,
      generated,
    })),
    generatedFiles: records
      .filter((record) => record.generated)
      .map((record) => ({
        path: record.entry.path,
        content: record.content,
      })),
  };
}

export async function buildProviderInlineData({ candidate }) {
  validateProviderContext(candidate.manifest);
  const contentByPath = new Map(candidate.contents.map((entry) => [entry.path, entry.content]));
  const sections = [
    "# FrontierScan code-reviewer frozen context",
    "",
    `Knowledge status: ${candidate.manifest.knowledgeAreas.map((area) => `${area.area}=${area.status}`).join(", ") || "none"}`,
    "",
  ];
  for (const entry of candidate.manifest.entries) {
    const content = contentByPath.get(entry.path);
    if (typeof content !== "string") throw new Error(`Provider inline context content is missing: ${entry.path}`);
    const buffer = Buffer.from(content, "utf8");
    if (buffer.byteLength !== entry.bytes || sha256(buffer) !== entry.sha256) {
      throw new Error(`Provider inline context content drifted: ${entry.path}`);
    }
    sections.push(
      `## ${entry.source}: ${entry.path}`,
      "",
      content,
      "",
    );
  }
  const inline = sections.join("\n");
  if (Buffer.byteLength(inline, "utf8") > CONTEXT_LIMIT_BYTES + (256 * 1024)) {
    throw new Error("Provider inline prompt data exceeds the bounded envelope.");
  }
  return inline;
}
