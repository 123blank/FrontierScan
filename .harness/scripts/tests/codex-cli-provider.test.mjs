import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexCliArgs,
  resolveWindowsCodexShim,
  runCodexCli,
  selectCodexExecutablePath,
} from "../lib/provider-adapters/codex-cli.mjs";

const SHA_SCHEMA = `sha256:${createHash("sha256").update('{"type":"object"}\n').digest("hex")}`;

function validResponse(overrides = {}) {
  return {
    schemaVersion: "1.0",
    providerRequestId: "10000000-0000-4000-8000-000000000001",
    dispatchId: "20000000-0000-4000-8000-000000000002",
    storyId: "M8-A-001",
    runId: "M8-A-001",
    phase: "code-review",
    role: "code-reviewer",
    status: "completed",
    summary: "No blocking findings.",
    findings: [],
    diagnostics: [],
    usage: {
      reportedModel: null,
      inputTokens: null,
      outputTokens: null,
    },
    ...overrides,
  };
}

function finalEvent(response = validResponse()) {
  return {
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify(response),
    },
  };
}

function jsonl(...events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function fakeSpawn({
  stdout = jsonl(finalEvent()),
  stdoutChunks,
  stderr = "",
  stderrChunks,
  exitCode = 0,
  mutateIsolatedRoot,
  neverExit = false,
  writeWhileOpen = false,
  spawnError,
} = {}) {
  const calls = [];
  let prompt = "";
  let child;
  const spawnProcess = (executable, args, options) => {
    child = new EventEmitter();
    child.pid = spawnError ? undefined : 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        prompt += chunk.toString("utf8");
        callback();
      },
    });
    child.stdin.on("finish", async () => {
      if (mutateIsolatedRoot) await mutateIsolatedRoot(options.cwd);
      if (neverExit) {
        if (writeWhileOpen) {
          if (stdoutChunks) {
            for (const chunk of stdoutChunks) child.stdout.write(chunk);
          } else if (stdout !== null) child.stdout.write(stdout);
          if (stderrChunks) {
            for (const chunk of stderrChunks) child.stderr.write(chunk);
          } else if (stderr) child.stderr.write(stderr);
        }
        return;
      }
      if (stdoutChunks) {
        for (const chunk of stdoutChunks) child.stdout.write(chunk);
        child.stdout.end();
      } else if (stdout !== null) child.stdout.end(stdout);
      else child.stdout.end();
      if (stderrChunks) {
        for (const chunk of stderrChunks) child.stderr.write(chunk);
        child.stderr.end();
      } else {
        child.stderr.end(stderr);
      }
      queueMicrotask(() => child.emit("close", exitCode, null));
    });
    queueMicrotask(() => {
      if (spawnError) child.emit("error", new Error(spawnError));
      else child.emit("spawn");
    });
    calls.push({ executable, args, options });
    return child;
  };
  return {
    spawnProcess,
    calls,
    prompt: () => prompt,
    child: () => child,
  };
}

function testArgvWhitelistAndModel() {
  const isolatedRoot = path.resolve("C:/temp/frontier-provider");
  const schemaFile = path.join(isolatedRoot, "provider-response.schema.json");
  const args = buildCodexCliArgs({
    isolatedRoot,
    schemaFile,
    model: null,
  });
  assert.deepEqual(args, [
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
  ]);
  for (const forbidden of [
    "--config",
    "--profile",
    "--add-dir",
    "--enable",
    "--dangerously-bypass-approvals-and-sandbox",
    "workspace-write",
    "danger-full-access",
  ]) {
    assert.equal(args.includes(forbidden), false);
  }
  assert.equal(args.includes("--model"), false);

  const explicit = buildCodexCliArgs({
    isolatedRoot,
    schemaFile,
    model: "gpt-5.6-codex",
  });
  assert.equal(explicit.filter((value) => value === "--model").length, 1);
  assert.deepEqual(explicit.slice(-2), ["--model", "gpt-5.6-codex"]);

  const customProvider = buildCodexCliArgs({
    isolatedRoot,
    schemaFile,
    model: "gpt-5.6-sol",
    modelProvider: {
      id: "custom",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    },
  });
  assert.deepEqual(customProvider.slice(-12), [
    "-c",
    'model_provider="custom"',
    "-c",
    'model_providers.custom.name="custom"',
    "-c",
    'model_providers.custom.base_url="https://coding.example.test"',
    "-c",
    'model_providers.custom.wire_api="responses"',
    "-c",
    "model_providers.custom.requires_openai_auth=true",
    "--model",
    "gpt-5.6-sol",
  ]);
  assert.throws(
    () => buildCodexCliArgs({
      isolatedRoot,
      schemaFile,
      model: null,
      modelProvider: {
        id: "custom",
        baseUrl: 'https://coding.example.test"\n-c unsafe=true',
        wireApi: "responses",
        requiresOpenAiAuth: true,
      },
    }),
    /model provider|baseUrl|safe/i,
  );
  assert.throws(
    () => buildCodexCliArgs({
      isolatedRoot,
      schemaFile,
      model: null,
      modelProvider: {
        id: "vendor.custom",
        baseUrl: "https://coding.example.test",
        wireApi: "responses",
        requiresOpenAiAuth: true,
      },
    }),
    /model provider.*id.*safe/i,
  );
  assert.throws(
    () => buildCodexCliArgs({
      isolatedRoot,
      schemaFile,
      model: "gpt-5 --config unsafe",
    }),
    /model.*safe|whitespace/i,
  );
}

function testWindowsExecutableSelection() {
  const output = [
    "D:\\Node\\codex",
    "D:\\Node\\codex.cmd",
    "C:\\Tools\\codex.exe",
    "",
  ].join("\r\n");

  assert.equal(selectCodexExecutablePath(output, "win32"), "D:\\Node\\codex.cmd");
  assert.equal(
    selectCodexExecutablePath("C:\\Tools\\codex.exe\r\n", "win32"),
    "C:\\Tools\\codex.exe",
  );
  assert.throws(
    () => selectCodexExecutablePath("D:\\Node\\codex\r\n", "win32"),
    /supported.*codex/i,
  );
  assert.equal(selectCodexExecutablePath("/usr/local/bin/codex\n", "linux"), "/usr/local/bin/codex");
}

async function testWindowsNpmShimResolution() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-codex-discovery-"));
  try {
    const shimPath = path.join(root, "codex.cmd");
    const packageRoot = path.join(root, "node_modules", "@openai", "codex");
    await writeFile(shimPath, "@echo off\r\n", "utf8");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@openai/codex",
        version: "0.148.0",
        optionalDependencies: {
          "@openai/codex-win32-x64": "npm:@openai/codex@0.148.0-win32-x64",
          "@openai/codex-win32-arm64": "npm:@openai/codex@0.148.0-win32-arm64",
        },
      }),
      "utf8",
    );

    for (const fixture of [
      {
        arch: "x64",
        packageName: "codex-win32-x64",
        targetTriple: "x86_64-pc-windows-msvc",
      },
      {
        arch: "arm64",
        packageName: "codex-win32-arm64",
        targetTriple: "aarch64-pc-windows-msvc",
      },
    ]) {
      const nativeRoot = path.join(
        packageRoot,
        "node_modules",
        "@openai",
        fixture.packageName,
      );
      const nativeExecutable = path.join(
        nativeRoot,
        "vendor",
        fixture.targetTriple,
        "bin",
        "codex.exe",
      );
      await mkdir(path.dirname(nativeExecutable), { recursive: true });
      await writeFile(
        path.join(nativeRoot, "package.json"),
        JSON.stringify({
          name: "@openai/codex",
          version: `0.148.0-win32-${fixture.arch}`,
          os: ["win32"],
          cpu: [fixture.arch],
        }),
        "utf8",
      );
      await writeFile(nativeExecutable, "fixture", "utf8");
      assert.equal(
        await resolveWindowsCodexShim(shimPath, fixture.arch),
        nativeExecutable,
      );
    }

    await assert.rejects(
      () => resolveWindowsCodexShim(shimPath, "ia32"),
      /architecture.*ia32/i,
    );

    const x64PackageJson = path.join(
      packageRoot,
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "package.json",
    );
    await writeFile(
      x64PackageJson,
      JSON.stringify({
        name: "@openai/codex",
        version: "0.148.0-win32-x64",
        os: ["linux"],
        cpu: ["x64"],
      }),
      "utf8",
    );
    await assert.rejects(
      () => resolveWindowsCodexShim(shimPath, "x64"),
      /platform package.*identity/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runFixture(options = {}) {
  const fixture = fakeSpawn(options.fixture);
  const spawnedPids = [];
  const killProcessTree = options.killProcessTreeFactory
    ? options.killProcessTreeFactory(fixture)
    : options.killProcessTree;
  const result = await runCodexCli({
    executablePath: path.resolve("C:/fixture/codex.exe"),
    adapterVersion: "codex-cli/test",
    prompt: "Review only the frozen context.",
    outputSchemaContent: '{"type":"object"}\n',
    outputSchemaSha256: SHA_SCHEMA,
    model: options.model ?? null,
    modelProvider: options.modelProvider ?? null,
    timeoutMs: options.timeoutMs ?? 1_000,
    spawnProcess: fixture.spawnProcess,
    killProcessTree,
    stdoutLimitBytes: options.stdoutLimitBytes,
    stderrLimitBytes: options.stderrLimitBytes,
    parentEnv: options.parentEnv,
    retainIsolatedRoot: options.retainIsolatedRoot ?? false,
    onSpawn: options.onSpawn ?? (async (pid) => {
      spawnedPids.push(pid);
    }),
  });
  return { result, fixture, spawnedPids };
}

async function testEnvironmentWhitelistAndDiagnosticRedaction() {
  const secret = "fixture-openai-secret";
  const bearer = "fixture-bearer-secret";
  const jsonSecret = "fixture-json-secret";
  const password = "fixture-password-secret";
  const { result, fixture } = await runFixture({
    parentEnv: {
      PATH: "C:\\fixture\\bin",
      USERPROFILE: "C:\\Users\\fixture",
      CODEX_HOME: "C:\\Users\\fixture\\.codex",
      OPENAI_API_KEY: secret,
      AWS_SECRET_ACCESS_KEY: "fixture-aws-secret",
      CUSTOM_TOKEN: "fixture-custom-secret",
    },
    fixture: {
      stderr: [
        `OPENAI_API_KEY="${secret}"`,
        `{"token":"${jsonSecret}"}`,
        `password: '${password}'`,
        `Authorization: Bearer ${bearer}`,
      ].join("\n"),
    },
  });
  assert.deepEqual(fixture.calls[0].options.env, {
    PATH: "C:\\fixture\\bin",
    USERPROFILE: "C:\\Users\\fixture",
    CODEX_HOME: "C:\\Users\\fixture\\.codex",
  });
  const diagnostics = result.diagnostics.join("\n");
  assert.equal(diagnostics.includes(secret), false);
  assert.equal(diagnostics.includes(bearer), false);
  assert.equal(diagnostics.includes(jsonSecret), false);
  assert.equal(diagnostics.includes(password), false);
  assert.match(diagnostics, /REDACTED/);

  const derived = await runFixture({
    parentEnv: {
      PATH: "C:\\fixture\\bin",
      USERPROFILE: "C:\\Users\\fixture",
    },
  });
  assert.equal(
    derived.fixture.calls[0].options.env.CODEX_HOME,
    "C:\\Users\\fixture\\.codex",
  );

  const normalized = await runFixture({
    parentEnv: {
      Path: "C:\\fixture\\bin",
      UserProfile: "C:\\Users\\fixture",
      Codex_Home: "C:\\fixture\\first",
      codex_home: "C:\\fixture\\second",
    },
  });
  assert.deepEqual(normalized.fixture.calls[0].options.env, {
    PATH: "C:\\fixture\\bin",
    USERPROFILE: "C:\\Users\\fixture",
    CODEX_HOME: "C:\\fixture\\second",
  });
}

async function testStdinSchemaAndIsolation() {
  const { result, fixture, spawnedPids } = await runFixture({ retainIsolatedRoot: true });
  try {
    assert.equal(result.status, "completed");
    assert.deepEqual(result.response, validResponse());
    assert.equal(fixture.prompt(), "Review only the frozen context.");
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(spawnedPids, [4242]);
    const call = fixture.calls[0];
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
    assert.equal(path.isAbsolute(call.executable), true);
    const cdIndex = call.args.indexOf("--cd");
    const schemaIndex = call.args.indexOf("--output-schema");
    assert.notEqual(cdIndex, -1);
    assert.notEqual(schemaIndex, -1);
    assert.equal(call.args[cdIndex + 1], call.options.cwd);
    assert.notEqual(call.options.cwd, process.cwd());
    assert.equal(path.dirname(call.options.cwd), path.resolve(path.dirname(call.options.cwd)));
    assert.equal(call.args[schemaIndex + 1].startsWith(call.options.cwd), true);
    assert.equal(
      createHash("sha256")
        .update(await readFile(call.args[schemaIndex + 1]))
        .digest("hex"),
      SHA_SCHEMA.slice("sha256:".length),
    );
  } finally {
    await rm(result.isolatedRoot, { recursive: true, force: true });
  }
}

async function testCustomProviderArgsReachSpawn() {
  const modelProvider = {
    id: "custom",
    baseUrl: "https://coding.example.test",
    wireApi: "responses",
    requiresOpenAiAuth: true,
  };
  const { fixture } = await runFixture({
    model: "gpt-5.6-sol",
    modelProvider,
  });
  assert.equal(
    fixture.calls[0].args.includes('model_providers.custom.base_url="https://coding.example.test"'),
    true,
  );
}

async function testJsonlBoundaries() {
  assert.equal((await runFixture()).result.status, "completed");

  const noFinal = await runFixture({
    fixture: {
      stdout: jsonl({ type: "turn.started" }),
    },
  });
  assert.equal(noFinal.result.status, "invalid-response");
  assert.match(noFinal.result.diagnostics.join("\n"), /no final response/i);

  const multiple = await runFixture({
    fixture: {
      stdout: jsonl(finalEvent(), finalEvent()),
    },
  });
  assert.equal(multiple.result.status, "invalid-response");
  assert.match(multiple.result.diagnostics.join("\n"), /multiple final responses/i);

  const invalidJson = await runFixture({
    fixture: {
      stdout: "{not-json}\n",
    },
  });
  assert.equal(invalidJson.result.status, "invalid-response");
  assert.match(invalidJson.result.diagnostics.join("\n"), /invalid JSONL/i);

  const invalidResponseJson = await runFixture({
    fixture: {
      stdout: jsonl({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "{not-json}",
        },
      }),
    },
  });
  assert.equal(invalidResponseJson.result.status, "invalid-response");
  assert.match(invalidResponseJson.result.diagnostics.join("\n"), /final response.*JSON/i);

  const invalidUtf8 = await runFixture({
    fixture: {
      stdout: Buffer.from([0xff, 0xfe, 0xfd]),
    },
  });
  assert.equal(invalidUtf8.result.status, "invalid-response");
  assert.match(invalidUtf8.result.diagnostics.join("\n"), /UTF-8/i);

  const stdoutOverflow = await runFixture({
    stdoutLimitBytes: 32,
    fixture: {
      stdout: "x".repeat(64),
    },
  });
  assert.equal(stdoutOverflow.result.status, "invalid-response");
  assert.match(stdoutOverflow.result.diagnostics.join("\n"), /stdout.*limit/i);

  const stderrOverflow = await runFixture({
    stderrLimitBytes: 32,
    fixture: {
      stderr: "x".repeat(64),
    },
  });
  assert.equal(stderrOverflow.result.status, "invalid-response");
  assert.match(stderrOverflow.result.diagnostics.join("\n"), /stderr.*limit/i);

  const multiChunkOverflow = await runFixture({
    stdoutLimitBytes: 16,
    fixture: {
      stdoutChunks: [
        Buffer.from("12345678"),
        Buffer.from("abcdefgh"),
        Buffer.from("OVERFLOW"),
        Buffer.from("MUST-DROP"),
      ],
    },
  });
  assert.equal(multiChunkOverflow.result.status, "invalid-response");
  assert.equal(multiChunkOverflow.result.stdout.byteLength <= 16, true);

  const failed = await runFixture({
    fixture: {
      exitCode: 7,
      stderr: "fixture failure",
    },
  });
  assert.equal(failed.result.status, "failed");
  assert.equal(failed.result.exitCode, 7);
  assert.match(failed.result.diagnostics.join("\n"), /fixture failure/);
}

async function testNonzeroJsonlErrorDiagnostics() {
  const errorMessage = JSON.stringify({
    error: {
      code: "invalid_json_schema",
      message: "allOf is not permitted",
    },
  });
  const { result } = await runFixture({
    fixture: {
      exitCode: 1,
      stdout: jsonl(
        { type: "thread.started", thread_id: "fixture" },
        { type: "error", message: errorMessage },
        { type: "turn.failed", error: { message: errorMessage } },
      ),
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.diagnostics.join("\n"), /invalid_json_schema/);
  assert.match(result.diagnostics.join("\n"), /allOf is not permitted/);
  assert.equal(result.rawEvents.length, 3);
}

async function testContradictoryTerminalEventsFailClosed() {
  for (const failureEvent of [
    { type: "turn.failed", error: { message: "fixture turn failed" } },
    { type: "error", message: "fixture error" },
  ]) {
    const { result } = await runFixture({
      fixture: {
        stdout: jsonl(failureEvent, finalEvent()),
      },
    });
    assert.equal(result.status, "invalid-response");
    assert.match(result.diagnostics.join("\n"), /failure event|turn.failed|error event/i);
  }
}

async function testNonzeroExitKeepsFailedStatusOnInvalidStderr() {
  const { result } = await runFixture({
    fixture: {
      exitCode: 1,
      stdout: jsonl({
        type: "turn.failed",
        error: { message: "fixture failed" },
      }),
      stderr: Buffer.from([0xff, 0xfe, 0xfd]),
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.diagnostics.join("\n"), /stderr.*UTF-8/i);
}

async function testTimeoutTerminatesProcessTree() {
  const killed = [];
  const { result } = await runFixture({
    timeoutMs: 20,
    fixture: {
      neverExit: true,
    },
    killProcessTree: async (pid) => {
      killed.push(pid);
    },
  });
  assert.equal(result.status, "timed-out");
  assert.deepEqual(killed, [4242]);
  assert.equal(result.response, null);
  assert.match(result.diagnostics.join("\n"), /timeout/i);
}

async function testTimeoutWinsCloseRace() {
  const { result } = await runFixture({
    timeoutMs: 20,
    fixture: {
      neverExit: true,
    },
    killProcessTreeFactory: (fixture) => async () => {
      fixture.child().emit("close", 1, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  });
  assert.equal(result.status, "timed-out");
  assert.equal(result.exitCode, null);
  assert.match(result.diagnostics.join("\n"), /timeout/i);
}

async function testOutputLimitSettlesWithoutClose() {
  const killed = [];
  let terminationFinished = false;
  const execution = runFixture({
    timeoutMs: 500,
    stdoutLimitBytes: 16,
    fixture: {
      neverExit: true,
      writeWhileOpen: true,
      stdout: "x".repeat(64),
    },
    killProcessTree: async (pid) => {
      killed.push(pid);
      await new Promise((resolve) => setTimeout(resolve, 5));
      terminationFinished = true;
    },
  });
  const completed = await Promise.race([
    execution,
    new Promise((resolve) => setTimeout(() => resolve(null), 100)),
  ]);
  assert.notEqual(completed, null, "output overflow must settle before the full timeout");
  assert.equal(completed.result.status, "invalid-response");
  assert.match(completed.result.diagnostics.join("\n"), /stdout.*limit/i);
  assert.deepEqual(killed, [4242]);
  assert.equal(terminationFinished, true);
}

async function testOnSpawnFailureTerminatesProcessTree() {
  const killed = [];
  await assert.rejects(
    runFixture({
      fixture: {
        neverExit: true,
      },
      killProcessTree: async (pid) => {
        killed.push(pid);
      },
      onSpawn: async () => {
        throw new Error("fixture lock update failure");
      },
    }),
    /lock update failure/i,
  );
  assert.deepEqual(killed, [4242]);
}

async function testSpawnErrorDoesNotPublishChildPid() {
  const spawnedPids = [];
  const { result } = await runFixture({
    fixture: {
      spawnError: "fixture EACCES",
    },
    onSpawn: async (pid) => {
      spawnedPids.push(pid);
    },
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(spawnedPids, []);
  assert.match(result.diagnostics.join("\n"), /EACCES/i);
}

async function testIsolatedTreeMutationFails() {
  const added = await runFixture({
    fixture: {
      mutateIsolatedRoot: async (root) => {
        await writeFile(path.join(root, "unexpected.txt"), "changed\n", "utf8");
      },
    },
  });
  assert.equal(added.result.status, "integrity-violation");
  assert.match(added.result.diagnostics.join("\n"), /isolated.*tree/i);

  const changed = await runFixture({
    fixture: {
      mutateIsolatedRoot: async (root) => {
        await writeFile(path.join(root, "README.txt"), "changed\n", "utf8");
      },
    },
  });
  assert.equal(changed.result.status, "integrity-violation");

  const deleted = await runFixture({
    fixture: {
      mutateIsolatedRoot: async (root) => {
        await rm(path.join(root, "README.txt"));
      },
    },
  });
  assert.equal(deleted.result.status, "integrity-violation");
}

testArgvWhitelistAndModel();
testWindowsExecutableSelection();
await testWindowsNpmShimResolution();
await testStdinSchemaAndIsolation();
await testCustomProviderArgsReachSpawn();
await testEnvironmentWhitelistAndDiagnosticRedaction();
await testJsonlBoundaries();
await testNonzeroJsonlErrorDiagnostics();
await testContradictoryTerminalEventsFailClosed();
await testNonzeroExitKeepsFailedStatusOnInvalidStderr();
await testTimeoutTerminatesProcessTree();
await testTimeoutWinsCloseRace();
await testOutputLimitSettlesWithoutClose();
await testOnSpawnFailureTerminatesProcessTree();
await testSpawnErrorDoesNotPublishChildPid();
await testIsolatedTreeMutationFails();
console.log("codex-cli-provider tests passed");
