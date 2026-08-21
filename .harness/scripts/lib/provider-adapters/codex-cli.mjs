import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MODEL_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CODEX_ENV_KEYS = new Set([
  "APPDATA",
  "CODEX_HOME",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_STDOUT_LIMIT = 4 * 1024 * 1024;
const DEFAULT_STDERR_LIMIT = 1024 * 1024;
const TERMINATION_GRACE_MS = 250;

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must contain valid UTF-8.`);
  }
}

function assertAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
}

function assertModel(model) {
  if (model !== null && (typeof model !== "string" || !MODEL_PATTERN.test(model))) {
    throw new Error("Codex CLI model must be null or a safe non-whitespace model identifier.");
  }
}

function assertModelProvider(modelProvider) {
  if (modelProvider === null) return;
  if (!modelProvider || typeof modelProvider !== "object" || Array.isArray(modelProvider)) {
    throw new Error("Codex model Provider must be null or an object.");
  }
  const fields = ["id", "baseUrl", "wireApi", "requiresOpenAiAuth"];
  const unexpected = Object.keys(modelProvider).find((field) => !fields.includes(field));
  if (unexpected || fields.some((field) => !Object.hasOwn(modelProvider, field))) {
    throw new Error("Codex model Provider contains unsupported or missing fields.");
  }
  if (!PROVIDER_ID_PATTERN.test(modelProvider.id)) {
    throw new Error("Codex model Provider id must use a safe identifier.");
  }
  let parsed;
  try {
    parsed = new URL(modelProvider.baseUrl);
  } catch {
    throw new Error("Codex model Provider baseUrl must be a safe HTTPS URL.");
  }
  if (parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || /[\u0000-\u001f\u007f]/.test(modelProvider.baseUrl)) {
    throw new Error("Codex model Provider baseUrl must be a safe HTTPS URL without credentials, query, or fragment.");
  }
  if (modelProvider.wireApi !== "responses") {
    throw new Error("Codex model Provider wireApi must be responses.");
  }
  if (typeof modelProvider.requiresOpenAiAuth !== "boolean") {
    throw new Error("Codex model Provider requiresOpenAiAuth must be a boolean.");
  }
}

function tomlString(value) {
  return JSON.stringify(value);
}

async function assertRegularExecutable(filePath, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`${label} does not exist.`);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
}

export function selectCodexExecutablePath(stdout, platform = process.platform) {
  const candidates = stdout
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const executablePath = platform === "win32"
    ? candidates.find((candidate) => [".cmd", ".exe"].includes(path.extname(candidate).toLowerCase()))
    : candidates[0];
  if (!executablePath) {
    throw new Error(
      platform === "win32"
        ? "Codex executable could not be resolved to a supported codex.cmd or codex.exe from PATH."
        : "Codex executable could not be resolved from PATH.",
    );
  }
  return executablePath;
}

export async function resolveWindowsCodexShim(shimPath, arch = process.arch) {
  assertAbsolutePath(shimPath, "Codex npm shim");
  await assertRegularExecutable(shimPath, "Codex npm shim");
  const target = {
    x64: ["codex-win32-x64", "x86_64-pc-windows-msvc"],
    arm64: ["codex-win32-arm64", "aarch64-pc-windows-msvc"],
  }[arch];
  if (!target) throw new Error(`Codex npm shim does not support Windows architecture: ${arch}.`);

  const packageRoot = path.join(path.dirname(shimPath), "node_modules", "@openai", "codex");
  const packageJsonPath = path.join(packageRoot, "package.json");
  await assertRegularExecutable(packageJsonPath, "Codex npm package");
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    throw new Error("Codex npm package.json must contain valid JSON.");
  }
  if (packageJson.name !== "@openai/codex") {
    throw new Error("Codex npm shim must resolve to the @openai/codex package.");
  }

  const [platformPackage, targetTriple] = target;
  const platformPackageJsonPath = path.join(
    packageRoot,
    "node_modules",
    "@openai",
    platformPackage,
    "package.json",
  );
  await assertRegularExecutable(platformPackageJsonPath, "Codex npm platform package");
  let platformPackageJson;
  try {
    platformPackageJson = JSON.parse(await readFile(platformPackageJsonPath, "utf8"));
  } catch {
    throw new Error("Codex npm platform package.json must contain valid JSON.");
  }
  const expectedVersion = `${packageJson.version}-win32-${arch}`;
  const expectedDependency = `npm:@openai/codex@${expectedVersion}`;
  if (packageJson.optionalDependencies?.[`@openai/${platformPackage}`] !== expectedDependency
      || platformPackageJson.name !== "@openai/codex"
      || platformPackageJson.version !== expectedVersion
      || !platformPackageJson.os?.includes("win32")
      || !platformPackageJson.cpu?.includes(arch)) {
    throw new Error("Codex npm platform package identity does not match the selected Windows target.");
  }
  const executablePath = path.join(
    packageRoot,
    "node_modules",
    "@openai",
    platformPackage,
    "vendor",
    targetTriple,
    "bin",
    "codex.exe",
  );
  await assertRegularExecutable(executablePath, "Codex npm native executable");
  return executablePath;
}

export async function discoverCodexExecutable({
  fixturePath,
  platform = process.platform,
} = {}) {
  if (fixturePath !== undefined) {
    assertAbsolutePath(fixturePath, "Codex fixture executable");
    await assertRegularExecutable(fixturePath, "Codex fixture executable");
    return fixturePath;
  }
  const command = platform === "win32" ? "where.exe" : "which";
  const { stdout } = await execFileAsync(command, ["codex"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
  const executablePath = selectCodexExecutablePath(stdout, platform);
  if (!path.isAbsolute(executablePath)) {
    throw new Error("Codex executable could not be resolved from PATH.");
  }
  if (platform === "win32" && path.extname(executablePath).toLowerCase() === ".cmd") {
    return resolveWindowsCodexShim(executablePath);
  }
  await assertRegularExecutable(executablePath, "Codex executable");
  return executablePath;
}

export function buildCodexCliArgs({
  isolatedRoot,
  schemaFile,
  model,
  modelProvider = null,
}) {
  assertAbsolutePath(isolatedRoot, "Codex isolated root");
  assertAbsolutePath(schemaFile, "Codex output Schema");
  if (path.dirname(schemaFile) !== isolatedRoot) {
    throw new Error("Codex output Schema must be copied inside the isolated root.");
  }
  assertModel(model);
  assertModelProvider(modelProvider);
  const args = [
    "exec",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--output-schema",
    schemaFile,
    "--json",
    "--skip-git-repo-check",
    "--cd",
    isolatedRoot,
  ];
  if (modelProvider !== null) {
    const prefix = `model_providers.${modelProvider.id}`;
    args.push(
      "-c",
      `model_provider=${tomlString(modelProvider.id)}`,
      "-c",
      `${prefix}.name=${tomlString(modelProvider.id)}`,
      "-c",
      `${prefix}.base_url=${tomlString(modelProvider.baseUrl)}`,
      "-c",
      `${prefix}.wire_api=${tomlString(modelProvider.wireApi)}`,
      "-c",
      `${prefix}.requires_openai_auth=${modelProvider.requiresOpenAiAuth}`,
    );
  }
  if (model !== null) args.push("--model", model);
  return args;
}

async function treeEntries(root, current = root) {
  const entries = [];
  const children = await readdir(current, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const fullPath = path.join(current, child.name);
    const relative = path.relative(root, fullPath).replaceAll("\\", "/");
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) throw new Error(`Codex isolated root contains a symbolic link: ${relative}`);
    if (info.isDirectory()) {
      entries.push({ path: relative, type: "directory" });
      entries.push(...await treeEntries(root, fullPath));
      continue;
    }
    if (!info.isFile()) throw new Error(`Codex isolated root contains an unsupported entry: ${relative}`);
    const content = await readFile(fullPath);
    entries.push({
      path: relative,
      type: "file",
      bytes: content.byteLength,
      sha256: sha256(content),
    });
  }
  return entries;
}

async function treeSnapshot(root) {
  const entries = await treeEntries(root);
  const serialized = JSON.stringify(entries);
  return {
    entries,
    sha256: sha256(serialized),
  };
}

export function isProviderSensitiveKey(key) {
  if (typeof key !== "string") return false;
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized.includes("APIKEY")
    || normalized.includes("SECRET")
    || normalized.includes("PASSWORD")
    || normalized.includes("AUTHORIZATION")
    || normalized.endsWith("TOKEN");
}

export function redactProviderDiagnostic(value) {
  return value
    .replace(
      /\bBearer\s+(["']?)[A-Za-z0-9._~+/=-]{6,}\1/gi,
      "Bearer $1[REDACTED]$1",
    )
    .replace(
      /((?:"?([A-Za-z0-9_-]+)"?)\s*[:=]\s*)(["']?)[A-Za-z0-9._~+/=-]{6,}\3/gi,
      (match, prefix, key, quote) => isProviderSensitiveKey(key)
        ? `${prefix}${quote}[REDACTED]${quote}`
        : match,
    );
}

function boundedDiagnostic(value) {
  return redactProviderDiagnostic(value).trim().slice(0, 2048);
}

function codexEnvironment(parentEnv) {
  const environment = {};
  for (const [key, value] of Object.entries(parentEnv ?? {})) {
    const normalizedKey = key.toUpperCase();
    if (CODEX_ENV_KEYS.has(normalizedKey) && typeof value === "string") {
      environment[normalizedKey] = value;
    }
  }
  if (!environment.CODEX_HOME) {
    const userHome = environment.USERPROFILE ?? environment.HOME;
    if (userHome) environment.CODEX_HOME = path.join(userHome, ".codex");
  }
  return environment;
}

function parseJsonlEvents(stdoutBuffer) {
  const source = decodeUtf8(stdoutBuffer, "Codex stdout");
  const events = [];
  for (const [index, line] of source.replaceAll("\r\n", "\n").split("\n").entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Codex stdout contains invalid JSONL at line ${index + 1}.`);
    }
    events.push(event);
  }
  return events;
}

function parseJsonl(stdoutBuffer) {
  const events = parseJsonlEvents(stdoutBuffer);
  if (events.some((event) => event?.type === "error" || event?.type === "turn.failed")) {
    throw new Error("Codex stdout contains a failure event alongside a final response.");
  }
  const finals = [];
  for (const event of events) {
    if (event?.type === "item.completed"
        && event.item?.type === "agent_message"
        && typeof event.item.text === "string") {
      finals.push(event.item.text);
    }
  }
  if (!finals.length) throw new Error("Codex stdout contains no final response.");
  if (finals.length !== 1) throw new Error("Codex stdout contains multiple final responses.");
  let response;
  try {
    response = JSON.parse(finals[0]);
  } catch {
    throw new Error("Codex final response is not valid JSON.");
  }
  return { events, response };
}

function errorEventDiagnostics(events) {
  const diagnostics = [];
  for (const event of events) {
    const candidate = event?.type === "error"
      ? event.message
      : event?.type === "turn.failed"
        ? event.error?.message
        : null;
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const diagnostic = boundedDiagnostic(candidate);
    if (diagnostic && !diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
  }
  return diagnostics;
}

async function defaultKillProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      maxBuffer: 64 * 1024,
    }).catch(() => {});
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, TERMINATION_GRACE_MS));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process already exited.
    }
  }
}

async function waitForChild({
  child,
  timeoutMs,
  stdoutLimitBytes,
  stderrLimitBytes,
  killProcessTree,
}) {
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let limitError = null;
  let settled = false;
  let timer;
  let termination = null;
  let resolveOutcome;
  const outcomePromise = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveOutcome(value);
  };
  const terminate = (outcome) => {
    if (settled) return;
    termination = Promise.resolve().then(() => killProcessTree(child.pid));
    finish(outcome);
  };

  const capture = (chunks, kind, limit) => (chunk) => {
    if (limitError) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const previous = kind === "stdout" ? stdoutBytes : stderrBytes;
    if (kind === "stdout") stdoutBytes += buffer.byteLength;
    else stderrBytes += buffer.byteLength;
    const total = kind === "stdout" ? stdoutBytes : stderrBytes;
    if (total > limit) {
      const remaining = Math.max(0, limit - previous);
      if (remaining) chunks.push(buffer.subarray(0, remaining));
      limitError = `Codex ${kind} exceeded the ${limit}-byte limit.`;
      terminate({ kind: "limit", exitCode: null, signal: null });
      return;
    }
    chunks.push(buffer);
  };
  child.stdout.on("data", capture(stdoutChunks, "stdout", stdoutLimitBytes));
  child.stderr.on("data", capture(stderrChunks, "stderr", stderrLimitBytes));

  child.once("error", (error) => finish({ kind: "error", error }));
  child.once("close", (exitCode, signal) => finish({
    kind: "close",
    exitCode,
    signal,
  }));
  timer = setTimeout(() => {
    terminate({ kind: "timeout", exitCode: null, signal: null });
  }, timeoutMs);
  const outcome = await outcomePromise;
  await termination;
  return {
    outcome,
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks),
    limitError,
  };
}

function waitForSpawn(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("spawn", () => finish({ kind: "spawned", pid: child.pid }));
    child.once("error", (error) => finish({ kind: "error", error }));
  });
}

export async function runCodexCli({
  executablePath,
  adapterVersion = "codex-cli/unknown",
  prompt,
  outputSchemaContent,
  outputSchemaSha256,
  model = null,
  modelProvider = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stdoutLimitBytes = DEFAULT_STDOUT_LIMIT,
  stderrLimitBytes = DEFAULT_STDERR_LIMIT,
  parentEnv = process.env,
  spawnProcess = spawn,
  killProcessTree = defaultKillProcessTree,
  onSpawn = async () => {},
  retainIsolatedRoot = false,
  now = () => new Date().toISOString(),
}) {
  assertModel(model);
  assertModelProvider(modelProvider);
  if (typeof prompt !== "string" || !prompt) throw new Error("Codex prompt is required.");
  if (typeof outputSchemaContent !== "string" || !outputSchemaContent) {
    throw new Error("Codex output Schema content is required.");
  }
  if (!SHA256_PATTERN.test(outputSchemaSha256)
      || sha256(outputSchemaContent) !== outputSchemaSha256) {
    throw new Error("Codex output Schema content does not match the frozen SHA-256.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("Codex timeout must be a positive integer.");
  const resolvedExecutablePath = executablePath
    ?? await discoverCodexExecutable();
  assertAbsolutePath(resolvedExecutablePath, "Codex executable");
  if (spawnProcess === spawn) await assertRegularExecutable(resolvedExecutablePath, "Codex executable");

  const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "frontier-codex-provider-"));
  const schemaFile = path.join(isolatedRoot, "provider-response.schema.json");
  const readmeFile = path.join(isolatedRoot, "README.txt");
  let result;
  try {
    await mkdir(isolatedRoot, { recursive: true });
    await writeFile(schemaFile, outputSchemaContent, "utf8");
    await writeFile(
      readmeFile,
      "This directory is an isolated, read-only Agent Provider working directory.\n",
      "utf8",
    );
    const before = await treeSnapshot(isolatedRoot);
    const args = buildCodexCliArgs({
      isolatedRoot,
      schemaFile,
      model,
      modelProvider,
    });
    const startedAt = now();
    const child = spawnProcess(resolvedExecutablePath, args, {
      cwd: isolatedRoot,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: codexEnvironment(parentEnv),
    });
    const execution = waitForChild({
      child,
      timeoutMs,
      stdoutLimitBytes,
      stderrLimitBytes,
      killProcessTree,
    });
    const spawnOutcome = await waitForSpawn(child);
    if (spawnOutcome.kind === "spawned") {
      if (!Number.isInteger(spawnOutcome.pid) || spawnOutcome.pid <= 0) {
        await killProcessTree(spawnOutcome.pid);
        child.stdin.destroy();
        throw new Error("Codex spawned without a positive child PID.");
      }
      try {
        await onSpawn(spawnOutcome.pid);
      } catch (error) {
        await killProcessTree(spawnOutcome.pid);
        child.stdin.destroy();
        throw error;
      }
      child.stdin.end(prompt);
    } else {
      child.stdin.destroy();
    }
    const captured = await execution;
    const finishedAt = now();
    const after = await treeSnapshot(isolatedRoot);
    const diagnostics = [];
    let status = "completed";
    let response = null;
    let rawEvents = [];
    let exitCode = captured.outcome.exitCode ?? null;

    if (before.sha256 !== after.sha256) {
      status = "integrity-violation";
      diagnostics.push("Codex isolated working tree changed during execution.");
    } else if (captured.outcome.kind === "timeout") {
      status = "timed-out";
      diagnostics.push(`Codex process exceeded the ${timeoutMs} ms timeout.`);
    } else if (captured.outcome.kind === "error") {
      status = "failed";
      diagnostics.push(`Codex process failed to start: ${captured.outcome.error.message}`);
    } else if (captured.limitError) {
      status = "invalid-response";
      diagnostics.push(captured.limitError);
    } else if (exitCode !== 0) {
      status = "failed";
      diagnostics.push(`Codex process exited with code ${exitCode}.`);
      try {
        rawEvents = parseJsonlEvents(captured.stdout);
        diagnostics.push(...errorEventDiagnostics(rawEvents));
      } catch (error) {
        diagnostics.push(error.message);
      }
    } else {
      try {
        const parsed = parseJsonl(captured.stdout);
        response = parsed.response;
        rawEvents = parsed.events;
      } catch (error) {
        if (status === "completed") status = "invalid-response";
        diagnostics.push(error.message);
      }
    }
    if (captured.stderr.length) {
      try {
        const stderr = boundedDiagnostic(decodeUtf8(captured.stderr, "Codex stderr"));
        if (stderr) diagnostics.push(stderr);
      } catch (error) {
        if (status === "completed") status = "invalid-response";
        diagnostics.push(error.message);
      }
    }
    result = {
      adapter: "codex-cli",
      adapterVersion,
      executablePath: resolvedExecutablePath,
      requestedModel: model,
      reportedModel: response?.usage?.reportedModel ?? null,
      startedAt,
      finishedAt,
      exitCode,
      status,
      response: status === "completed" ? response : null,
      rawEvents,
      stdout: captured.stdout,
      stderr: captured.stderr,
      diagnostics: diagnostics.slice(0, 32),
      isolatedIntegrity: {
        beforeSha256: before.sha256,
        afterSha256: after.sha256,
        status: before.sha256 === after.sha256 ? "passed" : "failed",
      },
      isolatedRoot: retainIsolatedRoot ? isolatedRoot : null,
    };
    return result;
  } finally {
    if (!retainIsolatedRoot) {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  }
}
