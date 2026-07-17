import { createHash, randomUUID as createRandomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkflowDefinition, runStateCommand } from "./state-runtime.mjs";

const PHASE_ADAPTERS = {
  "unit-test": ["harness-state-tests", "harness-m3-tests", "harness-structure", "backend-tests", "frontend-build"],
  "build-publish": ["harness-structure", "backend-package", "frontend-build", "no-build-required"],
};
const ADAPTER_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function platformCommand(command, args, cwd) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `${command}.cmd`, ...args],
      cwd,
    };
  }
  return { executable: command, args, cwd };
}

function adapterSpecification(root, adapter) {
  const specifications = {
    "harness-state-tests": {
      phases: ["unit-test"],
      executable: process.execPath,
      args: [path.join(root, ".harness/scripts/tests/state-runtime.test.mjs")],
      cwd: root,
    },
    "harness-m3-tests": {
      phases: ["unit-test"],
      executable: process.execPath,
      args: [path.join(root, ".harness/scripts/tests/story-runtime.test.mjs")],
      cwd: root,
    },
    "harness-structure": {
      phases: ["unit-test", "build-publish"],
      executable: "powershell.exe",
      args: [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, ".harness/scripts/validate-structure.ps1"), "-Root", root,
      ],
      cwd: root,
    },
    "backend-tests": {
      phases: ["unit-test"],
      ...platformCommand("mvn", ["test"], path.join(root, "backend")),
    },
    "backend-package": {
      phases: ["build-publish"],
      ...platformCommand("mvn", ["package"], path.join(root, "backend")),
    },
    "frontend-build": {
      phases: ["unit-test", "build-publish"],
      ...platformCommand("npm", ["run", "build"], path.join(root, "frontend")),
    },
    "no-build-required": {
      phases: ["build-publish"],
      executable: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all", "--", "backend", "frontend"],
      cwd: root,
    },
  };
  return specifications[adapter] ?? null;
}

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
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${normalizePath(filePath)}`);
  }
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} contains invalid JSON: ${normalizePath(filePath)}`);
  }
}

async function writeAtomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function fileSha256(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

function executeAdapter(specification) {
  if (!specification.executable) {
    return Promise.resolve({ exitCode: 0, stdout: "No build required for the selected changes.", stderr: "" });
  }
  return new Promise((resolve) => {
    execFile(
      specification.executable,
      specification.args,
      specification.options,
      (error, stdout, stderr) => resolve({
        exitCode: typeof error?.code === "number" ? error.code : (error ? 1 : 0),
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? error?.message ?? ""),
      }),
    );
  });
}

function phaseDirectory(state, phase) {
  return `.harness/runs/${state.runtime.runId}/phases/${String(phase.order).padStart(2, "0")}-${phase.id}`;
}

function phaseOutputs(root, phase, expectedPhaseRoot) {
  return phase.required_outputs.map((output) => {
    const resolved = resolveInsideRoot(root, output, "Required output");
    if (!resolved.relative.startsWith(`${expectedPhaseRoot}/`)) {
      throw new Error(`Required output must stay inside the current phase directory: ${output}`);
    }
    return resolved.relative;
  });
}

function validateTask(root, task, state, phase, expectedPhaseRoot) {
  if (!task || typeof task !== "object") throw new Error("Dispatch task must be an object.");
  if (task.schemaVersion !== "1.0" || !task.dispatchId) throw new Error("Dispatch task identity is invalid.");
  if (task.storyId !== state.storyId || task.phase !== state.phase) {
    throw new Error("Dispatch task does not match the current story phase.");
  }
  const allowedAdapters = PHASE_ADAPTERS[phase.id] ?? [];
  const expectedOutputs = phaseOutputs(root, phase, expectedPhaseRoot);
  if (task.ownerAgent !== phase.owner_agent
      || task.purpose !== phase.purpose
      || task.next !== phase.next[0]
      || !Number.isInteger(task.preparedRevision)
      || !Array.isArray(task.expectedOutputs)
      || !Array.isArray(task.allowedAdapters)
      || JSON.stringify(task.expectedOutputs) !== JSON.stringify(expectedOutputs)
      || JSON.stringify(task.allowedAdapters) !== JSON.stringify(allowedAdapters)) {
    throw new Error("Dispatch task does not match the workflow contract.");
  }
  for (const output of task.expectedOutputs) {
    if (!output.startsWith(`${expectedPhaseRoot}/`)) {
      throw new Error("Dispatch task output is outside the current phase directory.");
    }
  }
}

function validateCheckpoint(checkpoint, task) {
  if (!checkpoint || typeof checkpoint !== "object"
      || checkpoint.schemaVersion !== "1.0"
      || checkpoint.dispatchId !== task.dispatchId
      || checkpoint.storyId !== task.storyId
      || checkpoint.phase !== task.phase
      || !["prepared", "result-received", "failed", "blocked", "completed"].includes(checkpoint.status)) {
    throw new Error("Dispatch checkpoint does not match the current task.");
  }
}

async function currentContext(root, stateFile) {
  const located = await runStateCommand({ root, command: "status", stateFile });
  const workflow = await readWorkflowDefinition(root, located.state);
  const phase = workflow.phases.find((item) => item.id === located.state.phase) ?? null;
  return { located, phase, workflow };
}

async function dispatchStatus(root, located, phase) {
  if (!phase) {
    return { status: located.state.runtime.status, taskFile: null, resultFile: null, checkpointFile: null };
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
  return {
    status: checkpoint?.status ?? "not-prepared",
    taskFile,
    resultFile,
    checkpointFile,
    checkpoint,
  };
}

async function prepare(root, options) {
  const { located, phase } = await currentContext(root, options.stateFile);
  if (located.state.runtime.status !== "active" || ["blocked", "done"].includes(located.state.phase)) {
    throw new Error(`Cannot prepare a ${located.state.runtime.status} run in phase '${located.state.phase}'.`);
  }
  if (!phase) throw new Error(`Workflow does not define current phase '${located.state.phase}'.`);
  if (phase.next.length !== 1) throw new Error(`Workflow phase '${phase.id}' must define exactly one next phase.`);

  const phaseRoot = phaseDirectory(located.state, phase);
  const expectedOutputs = phaseOutputs(root, phase, phaseRoot);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const taskPath = resolveInsideRoot(root, taskFile, "Task file").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const existing = await readJsonOptional(taskPath, "Task file");
  const timestamp = (options.now ?? (() => new Date().toISOString()))();

  if (existing) {
    validateTask(root, existing, located.state, phase, phaseRoot);
    let checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
    if (!checkpoint) {
      checkpoint = {
        schemaVersion: "1.0",
        dispatchId: existing.dispatchId,
        storyId: existing.storyId,
        phase: existing.phase,
        status: "prepared",
        preparedAt: existing.preparedAt,
        updatedAt: timestamp,
      };
      await writeAtomicJson(checkpointPath, checkpoint);
    }
    validateCheckpoint(checkpoint, existing);
    return { command: "prepare", reused: true, taskFile, resultFile, checkpointFile, task: existing, checkpoint };
  }

  const task = {
    schemaVersion: "1.0",
    dispatchId: (options.randomUUID ?? createRandomUUID)(),
    storyId: located.state.storyId,
    phase: phase.id,
    ownerAgent: phase.owner_agent,
    purpose: phase.purpose,
    preparedRevision: located.state.runtime.revision,
    preparedAt: timestamp,
    expectedOutputs,
    allowedAdapters: PHASE_ADAPTERS[phase.id] ?? [],
    next: phase.next[0],
  };
  const checkpoint = {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    status: "prepared",
    preparedAt: timestamp,
    updatedAt: timestamp,
  };
  await writeAtomicJson(taskPath, task);
  await writeAtomicJson(checkpointPath, checkpoint);
  return { command: "prepare", reused: false, taskFile, resultFile, checkpointFile, task, checkpoint };
}

async function runAdapter(root, options) {
  const { located, phase } = await currentContext(root, options.stateFile);
  if (located.state.runtime.status !== "active" || !phase) {
    throw new Error(`Cannot run an adapter for a ${located.state.runtime.status} run.`);
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const taskFile = `${phaseRoot}/task.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const taskPath = resolveInsideRoot(root, taskFile, "Task file").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const task = await readJsonOptional(taskPath, "Task file");
  if (!task) throw new Error("Prepare the current phase before running an adapter.");
  validateTask(root, task, located.state, phase, phaseRoot);
  const specification = adapterSpecification(root, options.adapter);
  if (!specification || !task.allowedAdapters.includes(options.adapter)) {
    throw new Error(`Adapter '${options.adapter ?? ""}' is not allowed in phase '${phase.id}'.`);
  }
  if (!specification.phases.includes(phase.id)) {
    throw new Error(`Adapter '${options.adapter}' is not allowed in phase '${phase.id}'.`);
  }

  const startedAt = (options.now ?? (() => new Date().toISOString()))();
  const startedMs = Date.now();
  const invocation = {
    executable: specification.executable,
    args: [...specification.args],
    options: { cwd: specification.cwd, windowsHide: true, shell: false, maxBuffer: ADAPTER_MAX_BUFFER_BYTES },
  };
  let execution = await (options.execute ?? executeAdapter)(invocation);
  if (options.adapter === "no-build-required" && execution.exitCode === 0 && String(execution.stdout ?? "").trim()) {
    execution = {
      ...execution,
      exitCode: 1,
      stderr: [execution.stderr, "Backend or frontend changes require a build."].filter(Boolean).join("\n"),
    };
  }
  const finishedAt = (options.now ?? (() => new Date().toISOString()))();
  const evidence = {
    schemaVersion: "1.0",
    storyId: located.state.storyId,
    phase: phase.id,
    dispatchId: task.dispatchId,
    adapter: options.adapter,
    executable: specification.executable ?? "none",
    args: [...specification.args],
    cwd: normalizePath(specification.cwd),
    status: execution.exitCode === 0 ? "passed" : "failed",
    exitCode: execution.exitCode,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.now() - startedMs),
    stdout: String(execution.stdout ?? ""),
    stderr: String(execution.stderr ?? ""),
  };
  const evidencePath = `${phaseRoot}/evidence/${options.adapter}.json`;
  const evidenceFullPath = resolveInsideRoot(root, evidencePath, "Adapter evidence").fullPath;
  await writeAtomicJson(evidenceFullPath, evidence);
  const evidenceSha256 = await fileSha256(evidenceFullPath);

  if (phase.id === "unit-test") {
    await runStateCommand({
      root,
      command: "record",
      stateFile: located.stateFile,
      recordType: "test",
      status: evidence.status,
      path: evidencePath,
      message: `${options.adapter} exited with code ${evidence.exitCode}.`,
      actor: "story-runtime",
      now: options.now,
    });
  }

  const checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
  validateCheckpoint(checkpoint, task);
  checkpoint.adapterRuns = [
    ...(checkpoint.adapterRuns ?? []).filter((item) => item.adapter !== options.adapter),
    { adapter: options.adapter, status: evidence.status, evidencePath, sha256: evidenceSha256, finishedAt },
  ];
  checkpoint.updatedAt = finishedAt;
  await writeAtomicJson(checkpointPath, checkpoint);
  if (evidence.exitCode !== 0) {
    if (options.adapter === "no-build-required" && evidence.stderr.includes("Backend or frontend changes require a build.")) {
      throw new Error("Backend or frontend changes require a build.");
    }
    throw new Error(`Adapter '${options.adapter}' failed with exit code ${evidence.exitCode}.`);
  }
  return { command: "run-adapter", status: "passed", evidencePath, evidence };
}

function recordStatusAllowed(type, status) {
  const allowed = {
    test: ["passed", "failed", "skipped"],
    review: ["passed", "BLOCKER", "resolved"],
    note: ["recorded"],
  };
  return allowed[type]?.includes(status);
}

async function validateResult(root, result, task, state, phaseRoot) {
  if (!result || typeof result !== "object"
      || result.schemaVersion !== "1.0"
      || result.dispatchId !== task.dispatchId
      || result.storyId !== state.storyId
      || result.phase !== state.phase) {
    throw new Error("Dispatch result does not match the current task.");
  }
  if (!["completed", "failed", "blocked"].includes(result.status)
      || typeof result.summary !== "string" || !result.summary.trim()
      || !Array.isArray(result.outputs) || !Array.isArray(result.records)) {
    throw new Error("Dispatch result has an invalid status or structure.");
  }
  const outputPaths = result.outputs.map((item) => item?.path);
  if (outputPaths.some((output) => typeof output !== "string")) {
    throw new Error("Dispatch result outputs must contain paths.");
  }
  const normalizedOutputs = outputPaths.map((output) => {
    const resolved = resolveInsideRoot(root, output, "Result output");
    if (!resolved.relative.startsWith(`${phaseRoot}/`)) {
      throw new Error(`Result output must stay inside the current phase directory: ${output}`);
    }
    return resolved.relative;
  });
  if (result.status === "completed"
      && JSON.stringify(normalizedOutputs) !== JSON.stringify(task.expectedOutputs)) {
    throw new Error("Completed result outputs do not match the required output set.");
  }
  if (result.status === "completed") {
    for (const output of normalizedOutputs) {
      const resolved = resolveInsideRoot(root, output, "Required output");
      const info = await lstat(resolved.fullPath).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) {
        throw new Error(`Required output is missing or invalid: ${resolved.relative}`);
      }
    }
  }
  if (result.status === "blocked") {
    for (const field of ["reason", "owner", "suggestedAction"]) {
      if (typeof result.blocker?.[field] !== "string" || !result.blocker[field].trim()) {
        throw new Error(`Blocked result requires blocker.${field}.`);
      }
    }
  }
  for (const record of result.records) {
    if (!record || !recordStatusAllowed(record.type, record.status)
        || typeof record.message !== "string") {
      throw new Error("Dispatch result contains an invalid record.");
    }
    if (record.type === "test" && !record.path) {
      throw new Error("Test result records require an evidence path.");
    }
    if (record.path) {
      const resolved = resolveInsideRoot(root, record.path, "Result record path");
      if (!resolved.relative.startsWith(`${phaseRoot}/`)) {
        throw new Error(`Result record must stay inside the current phase directory: ${record.path}`);
      }
      record.path = resolved.relative;
    }
  }
  result.outputs = normalizedOutputs.map((output) => ({ path: output }));
}

async function recordAlreadyPresent(root, state, record) {
  const actor = record.actor?.trim() || "codex";
  const existing = [...state.runtime.records].reverse().find((item) => (
    item.phase === state.phase
    && item.type === record.type
    && item.status === record.status
    && (item.path ?? null) === (record.path ?? null)
    && item.message === record.message.trim()
    && item.actor === actor
  ));
  if (!existing) return false;
  if (!record.path) return true;
  const evidence = resolveInsideRoot(root, record.path, "Record evidence");
  const info = await lstat(evidence.fullPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) return false;
  const sha256 = `sha256:${createHash("sha256").update(await readFile(evidence.fullPath)).digest("hex")}`;
  return existing.sha256 === sha256;
}

async function recordResultEvidence(root, stateFile, result, options) {
  for (const record of result.records) {
    const current = await runStateCommand({ root, command: "status", stateFile });
    if (await recordAlreadyPresent(root, current.state, record)) continue;
    await runStateCommand({
      root,
      command: "record",
      stateFile,
      recordType: record.type,
      status: record.status,
      path: record.path,
      message: record.message,
      actor: record.actor?.trim() || "codex",
      now: options.now,
    });
  }
}

async function assertPhaseGate(root, checkpoint, task, phaseId, phaseRoot, state) {
  const failed = (checkpoint.adapterRuns ?? []).find((item) => item.status === "failed");
  if (failed) throw new Error(`Cannot complete phase with failed adapter '${failed.adapter}'.`);
  for (const adapterRun of checkpoint.adapterRuns ?? []) {
    const expectedPath = `${phaseRoot}/evidence/${adapterRun.adapter}.json`;
    if (!(PHASE_ADAPTERS[phaseId] ?? []).includes(adapterRun.adapter)
        || adapterRun.status !== "passed"
        || adapterRun.evidencePath !== expectedPath) {
      throw new Error("Adapter evidence does not match the current phase.");
    }
    const evidencePath = resolveInsideRoot(root, adapterRun.evidencePath, "Adapter evidence").fullPath;
    const evidence = await readJsonOptional(evidencePath, "Adapter evidence");
    if (!evidence || adapterRun.sha256 !== await fileSha256(evidencePath)) {
      throw new Error(`Adapter evidence is missing or changed: ${adapterRun.evidencePath}`);
    }
    if (evidence.schemaVersion !== "1.0"
        || evidence.storyId !== state.storyId
        || evidence.phase !== phaseId
        || evidence.dispatchId !== task.dispatchId
        || evidence.adapter !== adapterRun.adapter
        || evidence.status !== "passed"
        || evidence.exitCode !== 0) {
      throw new Error(`Adapter evidence does not match its checkpoint: ${adapterRun.evidencePath}`);
    }
  }
  if (phaseId === "unit-test" && !(checkpoint.adapterRuns ?? []).length) {
    throw new Error("Cannot complete unit-test without at least one test adapter result.");
  }
  if (phaseId === "build-publish") {
    const buildAdapters = new Set(["backend-package", "frontend-build", "no-build-required"]);
    const buildResult = (checkpoint.adapterRuns ?? []).find((item) => buildAdapters.has(item.adapter));
    if (!buildResult) {
      throw new Error("Cannot complete build-publish without a build or no-build adapter result.");
    }
  }
  if (phaseId === "code-review") {
    const blockers = state.review.findings.filter((item) => item.severity === "BLOCKER" && item.status !== "resolved");
    if (blockers.length) throw new Error("Cannot complete code-review with unresolved BLOCKER findings.");
    const passedReview = [...state.runtime.records].reverse().find((item) => (
      item.phase === "code-review" && item.type === "review" && item.status === "passed" && item.path && item.sha256
    ));
    if (!passedReview) {
      throw new Error("Cannot complete code-review without a passed review record.");
    }
    const evidence = resolveInsideRoot(root, passedReview.path, "Review evidence");
    const info = await lstat(evidence.fullPath).catch(() => null);
    const sha256 = info?.isFile() && !info.isSymbolicLink()
      ? `sha256:${createHash("sha256").update(await readFile(evidence.fullPath)).digest("hex")}`
      : null;
    if (sha256 !== passedReview.sha256) {
      throw new Error("Cannot complete code-review: passed review evidence is missing or changed.");
    }
  }
}

async function reconcileAdvancedResult(root, located, workflow, options) {
  const previousPhase = workflow.phases.find((item) => item.id === located.state.runtime.previousPhase);
  if (!previousPhase || previousPhase.next.length !== 1) return null;
  const expectedCurrent = previousPhase.next[0];
  const stateAdvanced = expectedCurrent === located.state.phase
    || (expectedCurrent === "done" && located.state.phase === "done" && located.state.runtime.status === "completed");
  if (!stateAdvanced) return null;

  const phaseRoot = phaseDirectory(located.state, previousPhase);
  const task = await readJsonOptional(
    resolveInsideRoot(root, `${phaseRoot}/task.json`, "Previous task file").fullPath,
    "Previous task file",
  );
  const result = await readJsonOptional(
    resolveInsideRoot(root, `${phaseRoot}/result.json`, "Previous result file").fullPath,
    "Previous result file",
  );
  const checkpointPath = resolveInsideRoot(root, `${phaseRoot}/checkpoint.json`, "Previous checkpoint file").fullPath;
  const checkpoint = await readJsonOptional(checkpointPath, "Previous checkpoint file");
  if (!task || !result || !checkpoint || checkpoint.status !== "result-received") return null;

  const previousState = { ...located.state, phase: previousPhase.id };
  validateTask(root, task, previousState, previousPhase, phaseRoot);
  validateCheckpoint(checkpoint, task);
  await validateResult(root, result, task, previousState, phaseRoot);
  if (result.status !== "completed") return null;

  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  checkpoint.status = "completed";
  checkpoint.completedAt ??= timestamp;
  checkpoint.updatedAt = timestamp;
  await writeAtomicJson(checkpointPath, checkpoint);
  return { command: "apply", status: "already-applied", stateFile: located.stateFile, state: located.state };
}

async function applyResult(root, options) {
  const { located, phase, workflow } = await currentContext(root, options.stateFile);
  const reconciled = await reconcileAdvancedResult(root, located, workflow, options);
  if (reconciled) return reconciled;
  if (located.state.runtime.status !== "active" || !phase) {
    throw new Error(`Cannot apply a result to a ${located.state.runtime.status} run.`);
  }
  const phaseRoot = phaseDirectory(located.state, phase);
  const taskFile = `${phaseRoot}/task.json`;
  const resultFile = `${phaseRoot}/result.json`;
  const checkpointFile = `${phaseRoot}/checkpoint.json`;
  const requestedResult = options.resultFile
    ? resolveInsideRoot(root, options.resultFile, "Result file").relative
    : resultFile;
  if (requestedResult !== resultFile) {
    throw new Error("Result file must be the current phase result.json.");
  }
  const taskPath = resolveInsideRoot(root, taskFile, "Task file").fullPath;
  const resultPath = resolveInsideRoot(root, resultFile, "Result file").fullPath;
  const checkpointPath = resolveInsideRoot(root, checkpointFile, "Checkpoint file").fullPath;
  const task = await readJsonOptional(taskPath, "Task file");
  const result = await readJsonOptional(resultPath, "Result file");
  const checkpoint = await readJsonOptional(checkpointPath, "Checkpoint file");
  if (!task || !result || !checkpoint) throw new Error("Prepare the phase and write result.json before apply.");
  validateTask(root, task, located.state, phase, phaseRoot);
  validateCheckpoint(checkpoint, task);
  await validateResult(root, result, task, located.state, phaseRoot);

  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  checkpoint.status = "result-received";
  checkpoint.resultReceivedAt ??= timestamp;
  checkpoint.updatedAt = timestamp;
  await writeAtomicJson(checkpointPath, checkpoint);
  await recordResultEvidence(root, located.stateFile, result, options);

  if (result.status === "failed") {
    checkpoint.status = "failed";
    checkpoint.failedAt = timestamp;
    checkpoint.updatedAt = timestamp;
    await writeAtomicJson(checkpointPath, checkpoint);
    const current = await runStateCommand({ root, command: "status", stateFile: located.stateFile });
    return { command: "apply", status: "failed", stateFile: located.stateFile, state: current.state };
  }
  if (result.status === "blocked") {
    const blocked = await runStateCommand({
      root,
      command: "block",
      stateFile: located.stateFile,
      ...result.blocker,
      now: options.now,
    });
    checkpoint.status = "blocked";
    checkpoint.blockedAt = timestamp;
    checkpoint.updatedAt = timestamp;
    await writeAtomicJson(checkpointPath, checkpoint);
    return { command: "apply", status: "blocked", stateFile: located.stateFile, state: blocked.state };
  }

  const gateState = await runStateCommand({ root, command: "status", stateFile: located.stateFile });
  await assertPhaseGate(root, checkpoint, task, phase.id, phaseRoot, gateState.state);
  if (options.beforeAdvance) await options.beforeAdvance();
  const advanced = await runStateCommand({
    root,
    command: phase.id === "git-delivery" ? "complete" : "next",
    stateFile: located.stateFile,
    now: options.now,
  });
  if (options.afterAdvance) await options.afterAdvance(advanced);
  checkpoint.status = "completed";
  checkpoint.completedAt = timestamp;
  checkpoint.updatedAt = timestamp;
  await writeAtomicJson(checkpointPath, checkpoint);
  return { command: "apply", status: "completed", stateFile: located.stateFile, state: advanced.state };
}

export async function runStoryCommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.command === "prepare") return prepare(root, options);
  if (options.command === "run-adapter") return runAdapter(root, options);
  if (options.command === "apply") return applyResult(root, options);
  if (options.command === "status") {
    const { located, phase } = await currentContext(root, options.stateFile);
    return { command: "status", stateFile: located.stateFile, state: located.state, dispatch: await dispatchStatus(root, located, phase) };
  }
  throw new Error(`Unsupported story command: ${options.command ?? "(missing)"}`);
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = {
    "--root": "root",
    "--state-file": "stateFile",
    "--adapter": "adapter",
    "--result-file": "resultFile",
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    const key = keyMap[token];
    if (!key || index + 1 >= tokens.length) throw new Error(`Unsupported or incomplete argument: ${token}`);
    options[key] = tokens[index + 1];
    index += 1;
  }
  return options;
}

async function runCli() {
  let options = {};
  try {
    options = parseCliArguments(process.argv.slice(2));
    const result = await runStoryCommand(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Story command '${result.command}' completed for ${result.state?.storyId ?? result.task?.storyId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`Story command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
