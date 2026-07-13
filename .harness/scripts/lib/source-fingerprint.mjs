import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AREA_ORDER = ["backend", "frontend", "common"];
const AREA_SOURCES = {
  backend: ["backend/src"],
  frontend: ["frontend/src"],
  common: ["AGENTS.md", "llm-knowledge/common", ".harness/workflows", ".codex/skills"],
};

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function sanitizedFailure(file, stage, error) {
  const rawCode = typeof error?.code === "string" ? error.code : "UNKNOWN";
  const code = /^[A-Za-z0-9_-]+$/.test(rawCode) ? rawCode : "UNKNOWN";
  return { file, stage, error: `Read failed (${code}).` };
}

function resolveRepositoryFile(root, relativeFile) {
  const normalized = normalizePath(relativeFile);
  const fullPath = path.resolve(root, normalized);
  const relative = normalizePath(path.relative(root, fullPath));
  if (!relative || relative === "." || relative.startsWith("../") || path.isAbsolute(relative)) {
    const error = new Error("Path is outside repository root.");
    error.code = "OUTSIDE_ROOT";
    throw error;
  }
  return { fullPath, relative };
}

async function collectFiles(root, relativeEntry) {
  let resolved;
  try {
    resolved = resolveRepositoryFile(root, relativeEntry);
  } catch {
    return [];
  }
  if (!existsSync(resolved.fullPath)) return [];

  const entries = await readdir(resolved.fullPath, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    return [resolved.relative];
  }

  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === ".gitkeep") continue;
    const child = normalizePath(path.posix.join(resolved.relative, entry.name));
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

export async function computeFileSetFingerprint(root, relativeFiles, options = {}) {
  const repoRoot = path.resolve(root);
  const readFileImpl = options.readFileImpl ?? readFile;
  const files = [...new Set(relativeFiles.map(normalizePath))].sort();
  const hash = createHash("sha256");
  const failedFiles = [];

  for (const requestedFile of files) {
    let resolved;
    try {
      resolved = resolveRepositoryFile(repoRoot, requestedFile);
    } catch (error) {
      failedFiles.push(sanitizedFailure(requestedFile, "source-fingerprint-path-validation", error));
      continue;
    }

    try {
      const content = await readFileImpl(resolved.fullPath);
      const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
      hash.update(resolved.relative, "utf8");
      hash.update("\0", "utf8");
      hash.update(String(bytes.length), "utf8");
      hash.update("\0", "utf8");
      hash.update(bytes);
      hash.update("\0", "utf8");
    } catch (error) {
      failedFiles.push(sanitizedFailure(resolved.relative, "source-fingerprint-read", error));
    }
  }

  return {
    algorithm: "sha256",
    fingerprint: `sha256:${hash.digest("hex")}`,
    file_count: files.length,
    status: failedFiles.length ? "incomplete" : "complete",
    failed_files: failedFiles,
  };
}

export async function computeAreaSourceFingerprint(root, area, options = {}) {
  if (!AREA_SOURCES[area]) {
    throw new Error(`Unsupported source fingerprint area: ${area}`);
  }
  const files = [];
  for (const source of AREA_SOURCES[area]) {
    files.push(...await collectFiles(path.resolve(root), source));
  }
  const result = await computeFileSetFingerprint(root, files, options);
  return { area, ...result };
}

export async function computeSourceFingerprints(root, areas = AREA_ORDER, options = {}) {
  const requested = new Set(areas);
  const selected = AREA_ORDER.filter((area) => requested.has(area));
  const results = {};
  for (const area of selected) {
    results[area] = await computeAreaSourceFingerprint(root, area, options);
  }
  return results;
}

function parseCliArgs(argv) {
  const options = { area: "all", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--root":
        options.root = argv[++index];
        break;
      case "--area":
        options.area = argv[++index];
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (!options.root) throw new Error("--root is required");
  if (options.area !== "all" && !AREA_SOURCES[options.area]) {
    throw new Error(`Unsupported source fingerprint area: ${options.area}`);
  }
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const areas = options.area === "all" ? AREA_ORDER : [options.area];
  const results = await computeSourceFingerprints(options.root, areas);
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const area of areas) {
    console.log(`${area}: ${results[area].fingerprint} (${results[area].status}, files=${results[area].file_count})`);
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
