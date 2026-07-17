import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, truncate, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ACTIVE_POINTER = ".harness/states/active-run.json";
const E2E_TEMPLATE = ".harness/states/e2e-state.template.json";
const E2E_WORKFLOW = ".harness/workflows/e2e-development.yaml";

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function resolveInsideRoot(root, relativeFile, label) {
  const fullPath = path.resolve(root, relativeFile);
  const relative = normalizePath(path.relative(root, fullPath));
  if (!relative || relative === "." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return { fullPath, relative };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} not found: ${filePath}`);
    throw new Error(`${label} is invalid JSON: ${filePath}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function stageAtomicJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await unlink(temporaryPath).catch(() => {});
  const handle = await open(temporaryPath, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function promoteAtomicJson(filePath) {
  const temporaryPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;
  const current = await lstat(filePath).catch(() => null);
  if (current) {
    await unlink(backupPath).catch(() => {});
    await rename(filePath, backupPath);
  }
  await rename(temporaryPath, filePath);
}

async function writeAtomicJson(filePath, value) {
  await stageAtomicJson(filePath, value);
  await promoteAtomicJson(filePath);
}

async function appendEvent(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function reconcileEventLog(root, state) {
  const eventPath = resolveInsideRoot(root, eventRelativePath(state.storyId), "Event file").fullPath;
  let source;
  try {
    source = await readFile(eventPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const lines = source.split(/\r?\n/);
  const events = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      const isTruncatedTail = index === lines.length - 1 && !source.endsWith("\n");
      if (!isTruncatedTail) throw new Error(`Event log contains invalid JSON at line ${index + 1}.`);
      const validPrefix = source.slice(0, source.lastIndexOf("\n") + 1);
      await truncate(eventPath, Buffer.byteLength(validPrefix, "utf8"));
    }
  }
  const completedTransactions = new Set(
    events
      .filter((event) => event.event === "committed" || event.event === "aborted")
      .map((event) => event.transactionId),
  );
  const committedRevisionIndexes = new Map();
  events.forEach((event, index) => {
    if (event.event === "committed") committedRevisionIndexes.set(`${event.runId}:${event.revision}`, index);
  });
  const latestOpenIntentIndexes = new Map();
  events.forEach((event, index) => {
    if (event.event === "intent" && event.transactionId && !completedTransactions.has(event.transactionId)) {
      latestOpenIntentIndexes.set(`${event.runId}:${event.revision}`, index);
    }
  });
  for (const [intentIndex, intent] of events.entries()) {
    if (intent.event !== "intent") continue;
    if (!intent.transactionId || completedTransactions.has(intent.transactionId)) continue;
    const revisionKey = `${intent.runId}:${intent.revision}`;
    const laterRevisionCommit = (committedRevisionIndexes.get(revisionKey) ?? -1) > intentIndex;
    const isLatestOpenIntent = latestOpenIntentIndexes.get(revisionKey) === intentIndex;
    await appendEvent(eventPath, {
      ...intent,
      event: !laterRevisionCommit && isLatestOpenIntent && state.runtime.revision >= intent.revision ? "committed" : "aborted",
      createdAt: state.runtime.updatedAt,
    });
    completedTransactions.add(intent.transactionId);
  }
}

async function readRecoverableJson(filePath, label) {
  const candidates = [filePath, `${filePath}.tmp`, `${filePath}.bak`];
  const valid = [];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(await readFile(candidate, "utf8"));
      const revision = Number.isInteger(value?.runtime?.revision)
        ? value.runtime.revision
        : Number.isInteger(value?.revision) ? value.revision : 0;
      valid.push({ value, source: candidate, revision });
    } catch {
      // Invalid interrupted candidates are ignored; failure is reported if none are usable.
    }
  }
  if (!valid.length) throw new Error(`${label} has no valid recoverable JSON: ${filePath}`);
  return valid.sort((left, right) => right.revision - left.revision)[0];
}

async function readRecoverablePointer(root, pointerPath, optional = false, expectedStateFile = null) {
  const candidates = [`${pointerPath}.tmp`, pointerPath, `${pointerPath}.bak`];
  let candidateExists = false;
  let lastCandidateError = null;
  let uncommittedTemporary = false;
  for (const candidate of candidates) {
    let pointer;
    try {
      pointer = JSON.parse(await readFile(candidate, "utf8"));
      candidateExists = true;
      validateActivePointer(pointer);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        candidateExists = true;
        lastCandidateError = error;
      }
      continue;
    }
    if (expectedStateFile && pointer.stateFile !== expectedStateFile) continue;
    const statePath = resolveInsideRoot(root, pointer.stateFile, "State file").fullPath;
    let stateResult;
    try {
      stateResult = await readRecoverableJson(statePath, "State file");
      validateRuntimeState(stateResult.value);
    } catch (error) {
      if (candidate === `${pointerPath}.tmp`) {
        uncommittedTemporary = true;
        continue;
      }
      throw error;
    }
    const state = stateResult.value;
    if (pointer.runId !== state.runtime.runId || state.storyId !== pointer.runId) {
      if (candidate === `${pointerPath}.tmp`) continue;
      throw new Error("Active pointer runId does not match the state file.");
    }
    if (pointer.revision > state.runtime.revision) {
      if (candidate === `${pointerPath}.tmp`) continue;
      assertPointerDoesNotLeadState(pointer, state);
    }
    if (pointer.revision === state.runtime.revision && pointer.status !== state.runtime.status) {
      throw new Error("Active pointer status does not match the state file.");
    }
    const effectivePointer = state.runtime.revision > pointer.revision
      ? { ...pointer, status: state.runtime.status, revision: state.runtime.revision, updatedAt: state.runtime.updatedAt }
      : pointer;
    return {
      pointer: effectivePointer,
      pointerSource: candidate,
      stateFile: normalizePath(path.relative(root, statePath)),
      state,
      stateSource: stateResult.source,
    };
  }
  if (optional && (expectedStateFile || !candidateExists || (uncommittedTemporary && !lastCandidateError))) return null;
  if (lastCandidateError) throw lastCandidateError;
  throw new Error(`Active pointer has no valid recoverable JSON: ${pointerPath}`);
}

function lockRelativePath(stateFile) {
  return stateFile.replace(/\.json$/, ".lock");
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

async function acquireRunLock(lockPath, options) {
  const staleMs = options.lockStaleMs ?? 300_000;
  const attempt = async () => {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
    })}\n`, "utf8");
    await handle.sync();
    return handle;
  };
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    return await attempt();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let lock = null;
    try {
      lock = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      throw new Error(`Run is locked by an unreadable lock file: ${lockPath}`);
    }
    const age = Date.now() - Date.parse(lock.createdAt);
    const sameLiveProcess = lock.hostname === os.hostname() && processExists(lock.pid);
    if (!(Number.isFinite(age) && age > staleMs && !sameLiveProcess)) {
      throw new Error(`Run is locked by process ${lock.pid ?? "unknown"}.`);
    }
    await unlink(lockPath);
    return attempt();
  }
}

async function withRunLock(lockPath, options, action) {
  const handle = await acquireRunLock(lockPath, options);
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
  }
}

function stateRelativePath(storyId) {
  return `.harness/states/e2e-${storyId}.json`;
}

function eventRelativePath(storyId) {
  return `.harness/states/e2e-${storyId}.events.jsonl`;
}

function assertPointerDoesNotLeadState(pointer, state) {
  if (pointer && pointer.revision > state.runtime.revision) {
    throw new Error(`Active pointer revision ${pointer.revision} is ahead of state revision ${state.runtime.revision}.`);
  }
}

function validateActivePointer(pointer) {
  if (!pointer || typeof pointer !== "object") throw new Error("Active pointer must be an object.");
  if (typeof pointer.schemaVersion !== "string" || !pointer.schemaVersion) {
    throw new Error("Active pointer schemaVersion is required.");
  }
  if (!STORY_ID_PATTERN.test(pointer.runId ?? "")) throw new Error("Active pointer runId is invalid.");
  if (pointer.stateFile !== stateRelativePath(pointer.runId)) throw new Error("Active pointer stateFile is invalid.");
  if (!["active", "blocked", "completed"].includes(pointer.status)) {
    throw new Error(`Active pointer has invalid status '${pointer.status ?? ""}'.`);
  }
  if (!Number.isInteger(pointer.revision) || pointer.revision < 1) {
    throw new Error("Active pointer revision must be a positive integer.");
  }
  if (typeof pointer.updatedAt !== "string" || !pointer.updatedAt) {
    throw new Error("Active pointer updatedAt is required.");
  }
}

function nowValue(options) {
  return (options.now ?? (() => new Date().toISOString()))();
}

function yamlScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function expandWorkflowPath(template, state) {
  const placeholders = [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const unsupported = placeholders.filter((name) => name !== "runId");
  if (unsupported.length) {
    throw new Error(`Workflow path contains unsupported placeholder '{${unsupported[0]}}'.`);
  }
  return template.replaceAll("{runId}", state.runtime.runId);
}

function parseWorkflow(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const phases = [];
  const qualityGates = [];
  let section = "top";
  let current = null;
  let listField = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line === "phases:") {
      section = "phases";
      current = null;
      listField = null;
      continue;
    }
    if (line === "quality_gates:" || line === "quality_gates: []") {
      section = "quality_gates";
      current = null;
      listField = null;
      continue;
    }
    if (section === "top" && /^[a-z_]+:\s*.+$/.test(line)) continue;

    const itemMatch = line.match(/^  - (id|phase):\s*(.+)$/);
    if (itemMatch) {
      current = { [itemMatch[1]]: yamlScalar(itemMatch[2]) };
      listField = null;
      (section === "phases" ? phases : qualityGates).push(current);
      continue;
    }
    const fieldMatch = line.match(/^    ([a-z_]+):(?:\s*(.*))?$/);
    if (fieldMatch && current) {
      const [, key, raw = ""] = fieldMatch;
      const allowed = section === "phases"
        ? ["order", "owner_agent", "purpose", "required_outputs", "next"]
        : ["rule"];
      if (!allowed.includes(key)) throw new Error(`Workflow has unsupported field '${key}' at line ${index + 1}.`);
      if (!raw) {
        if (!(["required_outputs", "next"].includes(key))) {
          throw new Error(`Workflow field '${key}' requires a value at line ${index + 1}.`);
        }
        current[key] = [];
        listField = key;
      } else {
        current[key] = yamlScalar(raw);
        listField = null;
      }
      continue;
    }
    const listMatch = line.match(/^      -\s+(.+)$/);
    if (listMatch && current && listField) {
      current[listField].push(yamlScalar(listMatch[1]));
      continue;
    }
    throw new Error(`Workflow contains unsupported structure at line ${index + 1}.`);
  }

  if (!phases.length) throw new Error("Workflow must define at least one phase.");
  const ids = new Set();
  const orders = new Set();
  for (const phase of phases) {
    if (!phase.id || !Number.isInteger(phase.order)) throw new Error("Workflow phase requires id and integer order.");
    if (ids.has(phase.id) || orders.has(phase.order)) throw new Error("Workflow phase ids and orders must be unique.");
    ids.add(phase.id);
    orders.add(phase.order);
    phase.required_outputs ??= [];
    phase.next ??= [];
  }
  for (const phase of phases) {
    for (const next of phase.next) {
      if (next !== "done" && !ids.has(next)) throw new Error(`Workflow phase '${phase.id}' has unknown next phase '${next}'.`);
    }
  }
  return { phases };
}

async function readWorkflow(root, state) {
  const resolved = resolveInsideRoot(root, state.runtime.workflow, "Workflow file");
  return parseWorkflow(await readFile(resolved.fullPath, "utf8"));
}

export async function readWorkflowDefinition(root, state) {
  const workflow = await readWorkflow(path.resolve(root), state);
  return {
    phases: workflow.phases.map((phase) => ({
      ...phase,
      required_outputs: phase.required_outputs.map((output) => expandWorkflowPath(output, state)),
    })),
  };
}

async function outputEvidence(root, phaseId, relativeOutput, timestamp) {
  const resolved = resolveInsideRoot(root, relativeOutput, "Required output");
  const info = await lstat(resolved.fullPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error(`Required output is missing or invalid: ${resolved.relative}`);
  }
  const content = await readFile(resolved.fullPath);
  return {
    id: `${phaseId}-output-${createHash("sha256").update(resolved.relative).digest("hex").slice(0, 12)}`,
    type: "output",
    phase: phaseId,
    status: "present",
    path: resolved.relative,
    sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    message: "",
    actor: "state-runtime",
    createdAt: timestamp,
  };
}

async function runTaskDagValidator(root, relativeDagPath, options) {
  const dagPath = resolveInsideRoot(root, relativeDagPath, "Task DAG").fullPath;
  if (options.taskDagValidator) {
    await options.taskDagValidator(dagPath);
    return;
  }
  const script = resolveInsideRoot(root, ".harness/scripts/validate-task-dag.ps1", "Task DAG validator").fullPath;
  await new Promise((resolve, reject) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-TaskDagFile", dagPath,
    ], { cwd: root, windowsHide: true }, (error) => {
      if (error) reject(new Error("Task DAG validation failed."));
      else resolve();
    });
  });
}

async function evidenceMatches(root, record, label) {
  const evidence = resolveInsideRoot(root, record.path, label);
  const info = await lstat(evidence.fullPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) return false;
  const sha256 = `sha256:${createHash("sha256").update(await readFile(evidence.fullPath)).digest("hex")}`;
  return sha256 === record.sha256;
}

async function assertQualityGate(root, state, phaseId, requiredOutputs, options) {
  if (phaseId === "task-dag") {
    const dagOutput = requiredOutputs.find((output) => output.endsWith("/task-dag.json"));
    if (!dagOutput) throw new Error("Task DAG phase must require a task-dag.json output.");
    await runTaskDagValidator(root, dagOutput, options);
  }
  if (phaseId === "unit-test") {
    const results = state.tests.results.filter((item) => item.phase === phaseId);
    const latestResults = [...new Map(results.map((item) => [item.path ?? item.id, item])).values()];
    for (const result of latestResults) {
      if (!await evidenceMatches(root, result, "Test evidence")) {
        throw new Error(`Cannot advance: test evidence is missing or changed: ${result.path ?? result.id}`);
      }
    }
    if (latestResults.some((item) => item.status === "failed")) {
      throw new Error("Cannot advance: failed required tests must be fixed.");
    }
    if (!latestResults.some((item) => item.status === "passed")) {
      throw new Error("Cannot advance: at least one required test must pass.");
    }
  }
  if (phaseId === "code-review") {
    const blockers = state.review.findings.filter((item) => (
      item.severity === "BLOCKER" && item.status !== "resolved"
    ));
    if (blockers.length) throw new Error("Cannot advance with unresolved BLOCKER findings.");
  }
  if (phaseId === "git-delivery") {
    const approvalRecords = state.runtime.records.filter((item) => (
      item.type === "approval"
      && item.phase === phaseId
      && item.actor === "user"
      && item.path
      && item.message?.trim()
      && item.sha256
    ));
    const approvals = [...new Map(approvalRecords.map((item) => [item.path, item])).values()]
      .filter((item) => item.status === "approved");
    if (!approvals.length) throw new Error(`Cannot advance ${phaseId} without explicit user approval.`);
    let approved = false;
    for (const approval of approvals) {
      if (await evidenceMatches(root, approval, "Approval evidence")) {
        approved = true;
        break;
      }
    }
    if (!approved) throw new Error(`Cannot advance ${phaseId}: approval evidence is missing or changed.`);
  }
}

async function persistLocated(root, located, state, pointer, command, options) {
  const statePath = resolveInsideRoot(root, located.stateFile, "State file").fullPath;
  const pointerPath = resolveInsideRoot(root, ACTIVE_POINTER, "Active pointer").fullPath;
  const eventPath = resolveInsideRoot(root, eventRelativePath(state.storyId), "Event file").fullPath;
  const transactionId = randomUUID();
  const shouldPersistPointer = pointer?.runId === state.runtime.runId
    && pointer?.stateFile === located.stateFile;
  if (shouldPersistPointer) pointer.revision = state.runtime.revision;
  await appendEvent(eventPath, {
    event: "intent",
    action: command,
    transactionId,
    runId: state.runtime.runId,
    revision: state.runtime.revision,
    createdAt: state.runtime.updatedAt,
  });
  if (options.beforeCommit) await options.beforeCommit();
  if (shouldPersistPointer) await stageAtomicJson(pointerPath, pointer);
  if (options.afterPointerStage) await options.afterPointerStage();
  await writeAtomicJson(statePath, state);
  if (options.afterStateCommit) await options.afterStateCommit();
  if (shouldPersistPointer) await promoteAtomicJson(pointerPath);
  await appendEvent(eventPath, {
    event: "committed",
    action: command,
    transactionId,
    runId: state.runtime.runId,
    revision: state.runtime.revision,
    createdAt: state.runtime.updatedAt,
  });
  return { command, stateFile: located.stateFile, state, pointer: shouldPersistPointer ? pointer : null };
}

async function advanceState(root, located, options) {
  if (located.state.phase === "blocked" || located.state.runtime.status !== "active") {
    throw new Error(`Run cannot advance while status is '${located.state.runtime.status}'.`);
  }
  const workflow = await readWorkflow(root, located.state);
  const current = workflow.phases.find((phase) => phase.id === located.state.phase);
  if (!current) throw new Error(`Workflow does not define current phase '${located.state.phase}'.`);
  if (current.next.length !== 1) throw new Error(`Workflow phase '${current.id}' must define exactly one next phase.`);
  const timestamp = nowValue(options);
  const evidence = [];
  const requiredOutputs = current.required_outputs.map((output) => expandWorkflowPath(output, located.state));
  for (const output of requiredOutputs) {
    evidence.push(await outputEvidence(root, current.id, output, timestamp));
  }
  await assertQualityGate(root, located.state, current.id, requiredOutputs, options);
  const nextPhase = current.next[0];
  if (nextPhase === "done") throw new Error("Use the complete command to enter done.");
  const state = structuredClone(located.state);
  state.runtime.records.push(...evidence);
  state.runtime.previousPhase = state.phase;
  state.phase = nextPhase;
  state.runtime.revision += 1;
  state.runtime.updatedAt = timestamp;
  state.logs.push({
    type: "transition",
    from: current.id,
    to: nextPhase,
    revision: state.runtime.revision,
    createdAt: timestamp,
  });
  const pointer = {
    ...located.pointer,
    status: nextPhase === "done" ? "completed" : "active",
    updatedAt: timestamp,
  };
  return persistLocated(root, located, state, pointer, "next", options);
}

async function completeRun(root, located, options) {
  if (located.state.phase !== "git-delivery" || located.state.runtime.status !== "active") {
    throw new Error("A run can only complete from the git-delivery phase.");
  }
  const workflow = await readWorkflow(root, located.state);
  const current = workflow.phases.find((phase) => phase.id === "git-delivery");
  if (!current || current.next.length !== 1 || current.next[0] !== "done") {
    throw new Error("Workflow git-delivery phase must transition to done.");
  }
  const timestamp = nowValue(options);
  const evidence = [];
  const requiredOutputs = current.required_outputs.map((output) => expandWorkflowPath(output, located.state));
  for (const output of requiredOutputs) {
    evidence.push(await outputEvidence(root, current.id, output, timestamp));
  }
  await assertQualityGate(root, located.state, current.id, requiredOutputs, options);
  const state = structuredClone(located.state);
  state.runtime.records.push(...evidence);
  state.runtime.previousPhase = "git-delivery";
  state.phase = "done";
  state.runtime.status = "completed";
  state.runtime.revision += 1;
  state.runtime.updatedAt = timestamp;
  state.logs.push({ type: "completed", from: "git-delivery", revision: state.runtime.revision, createdAt: timestamp });
  const pointer = { ...located.pointer, status: "completed", updatedAt: timestamp };
  return persistLocated(root, located, state, pointer, "complete", options);
}

function recordStatusAllowed(type, status) {
  const allowed = {
    output: ["present", "missing"],
    test: ["passed", "failed", "skipped"],
    review: ["passed", "BLOCKER", "resolved"],
    approval: ["approved", "denied"],
    note: ["recorded"],
  };
  return allowed[type]?.includes(status);
}

async function recordEvidence(root, located, options) {
  if (!recordStatusAllowed(options.recordType, options.status)) {
    throw new Error(`Invalid status '${options.status ?? ""}' for record type '${options.recordType ?? ""}'.`);
  }
  if (options.recordType === "test" && !options.path) {
    throw new Error("Test evidence path is required.");
  }
  if (options.recordType === "approval") {
    if (options.actor?.trim() !== "user") throw new Error("Approval actor must be 'user'.");
    if (!options.message?.trim()) throw new Error("Approval message is required.");
    if (!options.path) throw new Error("Approval evidence path is required.");
  }
  let relativePath = null;
  let sha256 = null;
  if (options.path) {
    const resolved = resolveInsideRoot(root, options.path, "Record path");
    const info = await lstat(resolved.fullPath).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Record path is missing or invalid: ${resolved.relative}`);
    relativePath = resolved.relative;
    sha256 = `sha256:${createHash("sha256").update(await readFile(resolved.fullPath)).digest("hex")}`;
  }
  const timestamp = nowValue(options);
  const state = structuredClone(located.state);
  const record = {
    id: `${state.runtime.runId}-${state.runtime.revision + 1}-${state.runtime.records.length + 1}`,
    type: options.recordType,
    phase: state.phase,
    status: options.status,
    path: relativePath,
    message: options.message?.trim() || "",
    actor: options.actor?.trim() || "codex",
    createdAt: timestamp,
    ...(sha256 ? { sha256 } : {}),
  };
  state.runtime.records.push(record);
  if (record.type === "test") {
    state.tests.results.push({ ...record });
  }
  if (record.type === "review") {
    if (record.status === "BLOCKER") {
      state.review.findings.push({
        id: record.id,
        severity: "BLOCKER",
        status: "open",
        message: record.message,
      });
      state.review.status = "blocked";
    } else if (record.status === "resolved") {
      const finding = [...state.review.findings].reverse().find((item) => (
        item.severity === "BLOCKER" && item.status !== "resolved" && item.message === record.message
      ));
      if (!finding) throw new Error("No matching unresolved BLOCKER finding was found.");
      finding.status = "resolved";
      finding.resolvedAt = timestamp;
      state.review.status = state.review.findings.some((item) => item.severity === "BLOCKER" && item.status !== "resolved")
        ? "blocked"
        : "passed";
    } else {
      state.review.status = "passed";
    }
  }
  state.runtime.revision += 1;
  state.runtime.updatedAt = timestamp;
  state.logs.push({ type: "recorded", recordId: record.id, revision: state.runtime.revision, createdAt: timestamp });
  const pointer = { ...located.pointer, updatedAt: timestamp };
  return persistLocated(root, located, state, pointer, "record", options);
}

async function blockRun(root, located, options) {
  if (located.state.phase === "blocked" || located.state.runtime.status !== "active") {
    throw new Error("Only an active run can be blocked.");
  }
  for (const field of ["reason", "owner", "suggestedAction"]) {
    if (!options[field]?.trim()) throw new Error(`${field} is required when blocking a run.`);
  }
  const timestamp = nowValue(options);
  const state = structuredClone(located.state);
  const previousPhase = state.phase;
  state.phase = "blocked";
  state.runtime.status = "blocked";
  state.runtime.previousPhase = previousPhase;
  state.runtime.blocked = {
    previousPhase,
    reason: options.reason.trim(),
    owner: options.owner.trim(),
    suggestedAction: options.suggestedAction.trim(),
    blockedAt: timestamp,
    resumedAt: null,
  };
  state.runtime.revision += 1;
  state.runtime.updatedAt = timestamp;
  state.logs.push({ type: "blocked", from: previousPhase, revision: state.runtime.revision, createdAt: timestamp });
  const pointer = { ...located.pointer, status: "blocked", updatedAt: timestamp };
  return persistLocated(root, located, state, pointer, "block", options);
}

async function resumeRun(root, located, options) {
  if (located.state.phase !== "blocked" || located.state.runtime.status !== "blocked") {
    throw new Error("Only a blocked run can be resumed.");
  }
  const previousPhase = located.state.runtime.blocked?.previousPhase;
  if (!previousPhase) throw new Error("Blocked state does not record previousPhase.");
  const timestamp = nowValue(options);
  const state = structuredClone(located.state);
  state.phase = previousPhase;
  state.runtime.status = "active";
  state.runtime.previousPhase = "blocked";
  state.runtime.blocked.resumedAt = timestamp;
  state.runtime.revision += 1;
  state.runtime.updatedAt = timestamp;
  state.logs.push({ type: "resumed", to: previousPhase, revision: state.runtime.revision, createdAt: timestamp });
  const pointer = { ...located.pointer, status: "active", updatedAt: timestamp };
  return persistLocated(root, located, state, pointer, "resume", options);
}

async function initializeRun(root, options) {
  if (!STORY_ID_PATTERN.test(options.storyId ?? "")) {
    throw new Error("storyId must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}.");
  }
  if (!options.summary?.trim()) {
    throw new Error("summary is required when initializing a run.");
  }

  const pointerPath = resolveInsideRoot(root, ACTIVE_POINTER, "Active pointer").fullPath;
  const existingLocated = await readRecoverablePointer(root, pointerPath, true);
  const existingPointer = existingLocated?.pointer ?? null;
  if (["active", "blocked"].includes(existingPointer?.status)) {
    throw new Error(`An active run already exists: ${existingPointer.runId}`);
  }

  const templatePath = resolveInsideRoot(root, E2E_TEMPLATE, "E2E template").fullPath;
  const template = await readJson(templatePath, "E2E template");
  const timestamp = nowValue(options);
  const stateFile = stateRelativePath(options.storyId);
  const statePath = resolveInsideRoot(root, stateFile, "State file").fullPath;
  const eventPath = resolveInsideRoot(root, eventRelativePath(options.storyId), "Event file").fullPath;
  const state = structuredClone(template);
  state.storyId = options.storyId;
  state.phase = "requirement";
  state.requirement.summary = options.summary.trim();
  state.runtime = {
    runId: options.storyId,
    workflow: E2E_WORKFLOW,
    status: "active",
    revision: 1,
    previousPhase: null,
    blocked: null,
    records: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.logs.push({
    type: "initialized",
    phase: "requirement",
    revision: 1,
    createdAt: timestamp,
  });
  const pointer = {
    schemaVersion: "1.0",
    runId: options.storyId,
    stateFile,
    status: "active",
    revision: 1,
    updatedAt: timestamp,
  };
  const transactionId = randomUUID();
  const lockPath = resolveInsideRoot(root, ".harness/states/active-run.lock", "Initialization lock").fullPath;
  return withRunLock(lockPath, options, async () => {
    const latestLocated = await readRecoverablePointer(root, pointerPath, true);
    const latestPointer = latestLocated?.pointer ?? null;
    if (latestPointer?.status === "completed") {
      const completedRunLock = resolveInsideRoot(root, lockRelativePath(latestLocated.stateFile), "Completed run lock").fullPath;
      await withRunLock(completedRunLock, options, async () => {
        const freshCompleted = await readRecoverablePointer(root, pointerPath, true);
        const freshPointer = freshCompleted?.pointer ?? null;
        if (["active", "blocked"].includes(freshPointer?.status)) {
          throw new Error(`An active run already exists: ${freshPointer.runId}`);
        }
        if (freshPointer?.status === "completed") {
          await reconcileEventLog(root, freshCompleted.state);
        }
      });
    }
    if (["active", "blocked"].includes(latestPointer?.status)) {
      throw new Error(`An active run already exists: ${latestPointer.runId}`);
    }
    const existingState = await Promise.all(
      [statePath, `${statePath}.tmp`, `${statePath}.bak`].map((candidate) => lstat(candidate).catch(() => null)),
    );
    if (existingState.some(Boolean)) {
      throw new Error(`State file already exists for storyId '${options.storyId}'.`);
    }
    await appendEvent(eventPath, { event: "intent", action: "init", transactionId, runId: options.storyId, revision: 1, createdAt: timestamp });
    if (options.beforeCommit) await options.beforeCommit();
    await stageAtomicJson(pointerPath, pointer);
    if (options.afterPointerStage) await options.afterPointerStage();
    await writeAtomicJson(statePath, state);
    if (options.afterStateCommit) await options.afterStateCommit();
    await promoteAtomicJson(pointerPath);
    await appendEvent(eventPath, { event: "committed", action: "init", transactionId, runId: options.storyId, revision: 1, createdAt: timestamp });
    return { command: "init", stateFile, state, pointer };
  });
}

async function locateState(root, explicitStateFile) {
  const pointerPath = resolveInsideRoot(root, ACTIVE_POINTER, "Active pointer").fullPath;
  if (explicitStateFile) {
    const resolved = resolveInsideRoot(root, explicitStateFile, "State file");
    const stateResult = await readRecoverableJson(resolved.fullPath, "State file");
    const state = stateResult.value;
    if (!state.runtime || state.runtime.runId !== state.storyId) {
      throw new Error("State runtime identity does not match storyId.");
    }
    let pointer = null;
    try {
      const pointerResult = await readRecoverablePointer(root, pointerPath, true, resolved.relative);
      if (pointerResult?.pointer.runId === state.runtime.runId
          && pointerResult.pointer.stateFile === resolved.relative) {
        pointer = pointerResult.pointer;
      }
    } catch (error) {
      if (/Active pointer revision .* ahead of state revision/i.test(error.message)) throw error;
      // An explicit state remains usable when the optional active pointer is missing or damaged.
    }
    assertPointerDoesNotLeadState(pointer, state);
    return {
      stateFile: resolved.relative,
      state,
      pointer,
      recoveredFrom: stateResult.source === resolved.fullPath ? null : normalizePath(stateResult.source),
    };
  }
  const pointerResult = await readRecoverablePointer(root, pointerPath);
  return {
    stateFile: pointerResult.stateFile,
    state: pointerResult.state,
    pointer: pointerResult.pointer,
    recoveredFrom: pointerResult.stateSource === resolveInsideRoot(root, pointerResult.stateFile, "State file").fullPath
      ? null
      : normalizePath(pointerResult.stateSource),
  };
}

function validateRuntimeState(state) {
  const runtime = state.runtime;
  if (!runtime || typeof runtime !== "object") throw new Error("State is missing runtime metadata.");
  if (runtime.runId !== state.storyId) throw new Error("State runtime identity does not match storyId.");
  if (typeof runtime.workflow !== "string" || !runtime.workflow) throw new Error("State runtime workflow is required.");
  if (!["active", "blocked", "completed"].includes(runtime.status)) {
    throw new Error(`State runtime has invalid status '${runtime.status ?? ""}'.`);
  }
  if (!Number.isInteger(runtime.revision) || runtime.revision < 1) {
    throw new Error("State runtime revision must be a positive integer.");
  }
  if (!Array.isArray(runtime.records)) throw new Error("State runtime records must be an array.");
  for (const record of runtime.records) {
    if (!recordStatusAllowed(record.type, record.status)) {
      throw new Error(`State runtime contains an invalid ${record.type ?? "unknown"} record.`);
    }
  }
  if (runtime.status === "blocked" && (state.phase !== "blocked" || !runtime.blocked?.previousPhase)) {
    throw new Error("Blocked runtime state must include its previous phase.");
  }
  if (runtime.status === "completed" && state.phase !== "done") {
    throw new Error("Completed runtime state must be in the done phase.");
  }
}

async function validateLocated(root, located) {
  validateRuntimeState(located.state);
  const workflow = await readWorkflow(root, located.state);
  if (!["blocked", "done"].includes(located.state.phase)
      && !workflow.phases.some((phase) => phase.id === located.state.phase)) {
    throw new Error(`Workflow does not define current phase '${located.state.phase}'.`);
  }
  return { command: "validate", valid: true, ...located };
}

export async function runStateCommand(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.command === "init") return initializeRun(root, options);
  const located = await locateState(root, options.stateFile);
  validateRuntimeState(located.state);
  if (options.command === "status") {
    return { command: "status", ...located };
  }
  if (options.command === "validate") return validateLocated(root, located);
  const mutatingCommands = new Set(["next", "record", "block", "resume", "complete"]);
  if (!mutatingCommands.has(options.command)) {
    throw new Error(`Unsupported state command: ${options.command ?? "(missing)"}`);
  }
  const lockPath = resolveInsideRoot(root, lockRelativePath(located.stateFile), "Run lock").fullPath;
  return withRunLock(lockPath, options, async () => {
    const fresh = await locateState(root, located.stateFile);
    await reconcileEventLog(root, fresh.state);
    if (fresh.state.runtime.status === "completed") {
      throw new Error("A completed run is immutable.");
    }
    if (options.command === "next") return advanceState(root, fresh, options);
    if (options.command === "record") return recordEvidence(root, fresh, options);
    if (options.command === "block") return blockRun(root, fresh, options);
    if (options.command === "resume") return resumeRun(root, fresh, options);
    return completeRun(root, fresh, options);
  });
}

function parseCliArguments(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  const keyMap = {
    "--root": "root",
    "--story-id": "storyId",
    "--summary": "summary",
    "--state-file": "stateFile",
    "--record-type": "recordType",
    "--status": "status",
    "--path": "path",
    "--message": "message",
    "--actor": "actor",
    "--reason": "reason",
    "--owner": "owner",
    "--suggested-action": "suggestedAction",
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
    const result = await runStateCommand(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`State command '${result.command}' completed for ${result.state?.storyId ?? result.pointer?.runId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.error(JSON.stringify({ error: message }));
    else console.error(`State command failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
