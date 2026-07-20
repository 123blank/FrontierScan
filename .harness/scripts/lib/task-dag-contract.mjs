import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function assertProperties(value, names, label) {
  for (const name of names) {
    if (!Object.hasOwn(value, name)) throw new Error(`${label} is missing required property '${name}'.`);
  }
}

function predictedPath(value, label) {
  assertString(value, label);
  if (value !== value.trim() || value.includes("\0") || path.posix.isAbsolute(value) || path.win32.parse(value).root) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const normalized = value.replaceAll("\\", "/");
  const subtree = normalized.endsWith("/**");
  const base = subtree ? normalized.slice(0, -3) : normalized;
  if (!base || base.includes("*") || base.includes("?") || (!subtree && (normalized.includes("*") || normalized.includes("?")))) {
    throw new Error(`${label} only supports exact paths or a trailing '/**' directory range.`);
  }
  const segments = base.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  return { source: value, key: segments.join("/").toLowerCase() };
}

function pathsOverlap(left, right) {
  return left.key === right.key
    || left.key.startsWith(`${right.key}/`)
    || right.key.startsWith(`${left.key}/`);
}

export function validateTaskDag(dag) {
  assertObject(dag, "Task DAG");
  assertProperties(dag, ["schemaVersion", "storyId", "nodes", "edges", "waves", "globalChanges", "risks"], "Task DAG");
  if (dag.schemaVersion !== "1.0") throw new Error("Task DAG schemaVersion must be '1.0'.");
  assertString(dag.storyId, "Task DAG storyId");
  for (const field of ["nodes", "edges", "waves", "globalChanges", "risks"]) assertArray(dag[field], `Task DAG ${field}`);
  if (!dag.nodes.length) throw new Error("Task DAG must contain at least one task.");
  if (!dag.waves.length) throw new Error("Task DAG must contain at least one wave.");
  dag.globalChanges.forEach((item, index) => assertString(item, `Task DAG globalChanges[${index}] string`));
  dag.risks.forEach((item, index) => assertString(item, `Task DAG risks[${index}] string`));

  const nodes = new Map();
  const adjacency = new Map();
  const allowedTypes = new Set(["backend", "frontend", "database", "docs", "test", "integration", "unknown"]);
  const allowedStatuses = new Set(["pending", "running", "done", "blocked"]);

  for (const node of dag.nodes) {
    assertObject(node, "Task node");
    assertProperties(node, ["taskId", "title", "type", "status", "predictedFiles", "acceptanceCriteria"], "Task node");
    for (const field of ["taskId", "title", "type", "status"]) assertString(node[field], `Task node ${field}`);
    if (Object.hasOwn(node, "ownerAgent")) assertString(node.ownerAgent, "Task node ownerAgent");
    assertArray(node.predictedFiles, "Task node predictedFiles");
    assertArray(node.acceptanceCriteria, "Task node acceptanceCriteria");
    node.acceptanceCriteria.forEach((item, index) => assertString(item, `Task '${node.taskId}' acceptanceCriteria[${index}]`));
    if (nodes.has(node.taskId)) throw new Error(`Duplicate taskId: ${node.taskId}`);
    if (!allowedTypes.has(node.type)) throw new Error(`Task node type has invalid value '${node.type}'.`);
    if (!allowedStatuses.has(node.status)) throw new Error(`Task node status has invalid value '${node.status}'.`);
    if (node.type === "backend" && node.ownerAgent === "frontend-developer") {
      throw new Error(`Backend task '${node.taskId}' should not be owned by frontend-developer.`);
    }
    if (node.type === "frontend" && node.ownerAgent === "backend-developer") {
      throw new Error(`Frontend task '${node.taskId}' should not be owned by backend-developer.`);
    }
    node.predictedFiles.forEach((item, index) => predictedPath(item, `Task '${node.taskId}' predictedFiles[${index}]`));
    nodes.set(node.taskId, node);
    adjacency.set(node.taskId, []);
  }

  for (const edge of dag.edges) {
    assertObject(edge, "Task edge");
    assertProperties(edge, ["from", "to", "reason"], "Task edge");
    for (const field of ["from", "to", "reason"]) assertString(edge[field], `Task edge ${field}`);
    if (!nodes.has(edge.from)) throw new Error(`Task edge references unknown source task: ${edge.from}`);
    if (!nodes.has(edge.to)) throw new Error(`Task edge references unknown target task: ${edge.to}`);
    adjacency.get(edge.from).push(edge.to);
  }

  const waveByTask = new Map();
  dag.waves.forEach((wave, waveIndex) => {
    assertArray(wave, "Task DAG wave");
    if (!wave.length) throw new Error(`Task DAG wave ${waveIndex + 1} must not be empty.`);
    for (const taskId of wave) {
      assertString(taskId, "Task wave taskId");
      if (!nodes.has(taskId)) throw new Error(`Task wave references unknown task: ${taskId}`);
      if (waveByTask.has(taskId)) throw new Error(`Task '${taskId}' must appear in exactly one wave.`);
      waveByTask.set(taskId, waveIndex);
    }
    for (let leftIndex = 0; leftIndex < wave.length; leftIndex += 1) {
      const left = nodes.get(wave[leftIndex]).predictedFiles.map((item, index) => predictedPath(item, `Task '${wave[leftIndex]}' predictedFiles[${index}]`));
      for (let rightIndex = leftIndex + 1; rightIndex < wave.length; rightIndex += 1) {
        const right = nodes.get(wave[rightIndex]).predictedFiles.map((item, index) => predictedPath(item, `Task '${wave[rightIndex]}' predictedFiles[${index}]`));
        if (left.some((leftPath) => right.some((rightPath) => pathsOverlap(leftPath, rightPath)))) {
          throw new Error(`Tasks '${wave[leftIndex]}' and '${wave[rightIndex]}' have overlapping predicted files in wave ${waveIndex + 1}.`);
        }
      }
    }
  });
  for (const taskId of nodes.keys()) {
    if (!waveByTask.has(taskId)) throw new Error(`Task '${taskId}' must appear in exactly one wave.`);
  }
  if (dag.globalChanges.length && dag.waves.some((wave) => wave.length !== 1)) {
    throw new Error("Task DAG with globalChanges must use serial single-task waves.");
  }
  for (const edge of dag.edges) {
    if (waveByTask.get(edge.from) >= waveByTask.get(edge.to)) {
      throw new Error(`Task edge '${edge.from}' -> '${edge.to}' must target a later wave.`);
    }
  }

  const temporary = new Set();
  const permanent = new Set();
  function visit(taskId) {
    if (permanent.has(taskId)) return;
    if (temporary.has(taskId)) throw new Error(`DAG contains a cycle involving task '${taskId}'.`);
    temporary.add(taskId);
    for (const next of adjacency.get(taskId)) visit(next);
    temporary.delete(taskId);
    permanent.add(taskId);
  }
  for (const taskId of nodes.keys()) visit(taskId);

  return { dag, nodes, waveByTask };
}

export async function loadTaskDag(taskDagFile) {
  let source;
  try {
    source = await readFile(taskDagFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Task DAG file not found: ${taskDagFile}`);
    throw error;
  }
  let dag;
  try {
    dag = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in task DAG file '${taskDagFile}': ${error.message}`);
  }
  return validateTaskDag(dag);
}

async function runCli() {
  try {
    const taskDagFile = process.argv[2];
    if (!taskDagFile || process.argv.length !== 3) throw new Error("Usage: task-dag-contract.mjs <task-dag-file>");
    const result = await loadTaskDag(path.resolve(taskDagFile));
    console.log("Harness task DAG validation passed.");
    console.log(`Task DAG file: ${taskDagFile}`);
    console.log(`Tasks checked: ${result.dag.nodes.length}`);
    console.log(`Edges checked: ${result.dag.edges.length}`);
    console.log(`Waves checked: ${result.dag.waves.length}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
