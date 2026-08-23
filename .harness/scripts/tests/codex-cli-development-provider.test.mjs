import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import {
  buildCodexDevelopmentArgs,
  runCodexDevelopmentCli,
} from "../lib/provider-adapters/codex-cli.mjs";

const SCHEMA = '{"type":"object"}\n';
const SCHEMA_SHA = `sha256:${createHash("sha256").update(SCHEMA).digest("hex")}`;

function response() {
  return {
    schemaVersion: "1.0",
    providerRequestId: "10000000-0000-4000-8000-000000000001",
    dispatchId: "20000000-0000-4000-8000-000000000002",
    storyId: "STORY-1",
    runId: "STORY-1",
    phase: "implementation",
    role: "backend-developer",
    status: "completed",
    summary: "Implemented.",
    developmentMethod: "tdd",
    tddExceptionReason: null,
    declaredFiles: [],
    diagnostics: [],
    usage: {reportedModel: null, inputTokens: null, outputTokens: null},
  };
}

function fakeSpawn({stdout, stderr = "", exitCode = 0, neverExit = false, spawnError} = {}) {
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.pid = spawnError ? undefined : 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({write(_chunk, _encoding, callback) { callback(); }});
    child.stdin.on("finish", () => {
      if (neverExit) return;
      child.stdout.end(stdout ?? `${JSON.stringify({
        type: "item.completed",
        item: {type: "agent_message", text: JSON.stringify(response())},
      })}\n`);
      child.stderr.end(stderr);
      queueMicrotask(() => child.emit("close", exitCode, null));
    });
    queueMicrotask(() => spawnError ? child.emit("error", new Error(spawnError)) : child.emit("spawn"));
    calls.push({executable, args, options});
    return child;
  };
  return {spawnProcess, calls};
}

function testArgs() {
  const worktreePath = path.resolve("C:/repo/worktree");
  const preparedRoot = path.resolve("C:/repo/prepared");
  const schemaFile = path.join(preparedRoot, "response.schema.json");
  assert.deepEqual(buildCodexDevelopmentArgs({
    worktreePath,
    preparedRoot,
    schemaFile,
    model: null,
  }), [
    "exec",
    "--approve-for-me",
    "--ephemeral",
    "--ignore-user-config",
    "--output-schema", schemaFile,
    "--json",
    "--cd", worktreePath,
  ]);
  for (const forbidden of ["--sandbox", "--add-dir", "danger-full-access", "--dangerously-bypass-approvals-and-sandbox"]) {
    assert.equal(buildCodexDevelopmentArgs({worktreePath, preparedRoot, schemaFile, model: null}).includes(forbidden), false);
  }
  assert.throws(
    () => buildCodexDevelopmentArgs({worktreePath: "relative", preparedRoot, schemaFile, model: null}),
    /worktree.*absolute/i,
  );
  assert.throws(
    () => buildCodexDevelopmentArgs({
      worktreePath,
      preparedRoot,
      schemaFile: path.resolve("C:/outside/schema.json"),
      model: null,
    }),
    /Schema.*prepared/i,
  );
}

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-development-adapter-"));
  const worktreePath = path.join(root, "worktree");
  const preparedRoot = path.join(root, "prepared");
  const schemaFile = path.join(preparedRoot, "response.schema.json");
  await mkdir(worktreePath);
  await mkdir(preparedRoot);
  await writeFile(schemaFile, SCHEMA);
  try {
    await run({root, worktreePath, preparedRoot, schemaFile});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

async function runFixture(fixture, options = {}) {
  const spawned = fakeSpawn(fixture);
  const result = await runCodexDevelopmentCli({
    executablePath: path.resolve("C:/fixture/codex.exe"),
    adapterVersion: "codex-cli/test",
    prompt: "Implement the frozen task.",
    outputSchemaFile: options.schemaFile,
    outputSchemaSha256: SCHEMA_SHA,
    preparedRoot: options.preparedRoot,
    worktreePath: options.worktreePath,
    request: {worktreePath: options.worktreePath},
    timeoutMs: options.timeoutMs ?? 1000,
    stdoutLimitBytes: options.stdoutLimitBytes,
    spawnProcess: spawned.spawnProcess,
    killProcessTree: options.killProcessTree ?? (async () => {}),
    onSpawn: options.onSpawn ?? (async () => {}),
  });
  return {result, calls: spawned.calls};
}

async function testRunAndFailures() {
  await withFixture(async (fixture) => {
    const completed = await runFixture({}, fixture);
    assert.equal(completed.result.status, "completed");
    assert.deepEqual(completed.result.response, response());
    assert.equal(completed.calls[0].options.cwd, fixture.worktreePath);
    assert.equal(completed.calls[0].args.includes("--approve-for-me"), true);
    assert.equal(completed.calls[0].args.includes("--sandbox"), false);

    const progressThenFinal = await runFixture({
      stdout: [
        {
          type: "item.completed",
          item: {type: "agent_message", text: "I will inspect the task first."},
        },
        {
          type: "item.completed",
          item: {type: "agent_message", text: JSON.stringify(response())},
        },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    }, fixture);
    assert.equal(progressThenFinal.result.status, "completed");
    assert.deepEqual(progressThenFinal.result.response, response());

    const completedTurn = await runFixture({
      stdout: [
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({...response(), summary: "Planning."}),
          },
        },
        {type: "item.completed", item: {type: "command_execution"}},
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({...response(), summary: "Implemented."}),
          },
        },
        {type: "turn.completed"},
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    }, fixture);
    assert.equal(completedTurn.result.status, "completed");
    assert.equal(completedTurn.result.response.summary, "Implemented.");

    const multipleFinals = await runFixture({
      stdout: [
        {type: "item.completed", item: {type: "agent_message", text: JSON.stringify(response())}},
        {type: "item.completed", item: {type: "agent_message", text: JSON.stringify(response())}},
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    }, fixture);
    assert.equal(multipleFinals.result.status, "invalid-response");
    assert.equal(multipleFinals.result.rawEvents.length, 2);

    await assert.rejects(
      runCodexDevelopmentCli({
        executablePath: path.resolve("C:/fixture/codex.exe"),
        prompt: "x",
        outputSchemaFile: fixture.schemaFile,
        outputSchemaSha256: SCHEMA_SHA,
        preparedRoot: fixture.preparedRoot,
        worktreePath: fixture.worktreePath,
        request: {worktreePath: path.join(fixture.root, "other")},
        spawnProcess: fakeSpawn().spawnProcess,
      }),
      /worktree.*request/i,
    );

    const invalid = await runFixture({stdout: "{bad}\n"}, fixture);
    assert.equal(invalid.result.status, "invalid-response");

    const failed = await runFixture({exitCode: 7, stderr: "fixture failure"}, fixture);
    assert.equal(failed.result.status, "failed");
    assert.equal(failed.result.exitCode, 7);
    assert.match(failed.result.diagnostics.join("\n"), /fixture failure/i);

    const spawnFailed = await runFixture({spawnError: "fixture EACCES"}, fixture);
    assert.equal(spawnFailed.result.status, "failed");
    assert.match(spawnFailed.result.diagnostics.join("\n"), /EACCES/i);

    const timedOut = await runFixture({neverExit: true}, {
      ...fixture,
      timeoutMs: 10,
      killProcessTree: async () => {},
    });
    assert.equal(timedOut.result.status, "timed-out");

    const limited = await runFixture({stdout: "x".repeat(64)}, {
      ...fixture,
      stdoutLimitBytes: 16,
    });
    assert.equal(limited.result.status, "output-limit");

    await assert.rejects(
      runFixture({neverExit: true}, {
        ...fixture,
        timeoutMs: 10,
        onSpawn: async () => { throw new Error("claim failed"); },
      }),
      /claim failed/i,
    );
  });
}

testArgs();
await testRunAndFailures();
console.log("codex-cli-development-provider tests passed");
