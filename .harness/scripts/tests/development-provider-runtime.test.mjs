import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  developmentProviderPaths,
  executeSandboxedTestFile,
  finalizeDevelopmentProvider,
  inspectDevelopmentProvider,
  materializeDevelopmentProvider,
  prepareDevelopmentProvider,
  recoverDevelopmentProvider,
  runDevelopmentProvider,
  testDevelopmentProvider,
} from "../lib/development-provider-runtime.mjs";

const NOW = "2026-08-22T14:00:00.000Z";
const COMMIT = "1".repeat(40);
const DISPATCH_ID = "70000000-0000-4000-8000-000000000007";
const TASK_ID = "T5-RUNTIME-PREPARE-RUN";
const execFileAsync = promisify(execFile);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function json(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function writeJson(root, relativePath, value) {
  return write(root, relativePath, json(value));
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function exists(root, relativePath) {
  return readFile(path.join(root, relativePath)).then(
    () => true,
    (error) => error?.code === "ENOENT" ? false : Promise.reject(error),
  );
}

function baseline({
  predictedFile = ".harness/scripts/lib/development-provider-runtime.mjs",
  baseSha256 = null,
} = {}) {
  return {
    schemaVersion: "1.0",
    branch: "harness/m8-b-001/t5-runtime",
    headCommit: COMMIT,
    baseCommit: COMMIT,
    gitDir: "D:/fixture/.git/worktrees/T5",
    gitCommonDir: "D:/fixture/.git",
    gitFileSha256: sha256("git-file"),
    indexSha256: sha256("index"),
    configSha256: sha256("config"),
    packedRefsSha256: null,
    refsSha256: sha256("refs"),
    gitStatusSha256: sha256(""),
    dirtyPaths: [],
    trackedFilesSha256: sha256("tracked"),
    untrackedFilesSha256: sha256(""),
    ignoredMetadataSha256: sha256("ignored"),
    predictedTargets: [{
      path: predictedFile,
      baseSha256,
    }],
    buildOutputs: [{
      path: "backend/target",
      state: "absent",
      sha256: null,
    }],
    lockFiles: [],
    capturedAt: NOW,
  };
}

function responseFor(request, overrides = {}) {
  return {
    schemaVersion: "1.0",
    providerRequestId: request.providerRequestId,
    dispatchId: request.dispatchId,
    storyId: request.storyId,
    runId: request.runId,
    phase: "implementation",
    role: request.role,
    status: "completed",
    summary: "Development completed.",
    developmentMethod: "tdd",
    tddExceptionReason: null,
    declaredFiles: [{
      path: ".harness/scripts/lib/development-provider-runtime.mjs",
      changeType: "update",
      purpose: "Implement Development Provider Run.",
    }],
    diagnostics: [],
    usage: {
      reportedModel: "fixture-model",
      inputTokens: 100,
      outputTokens: 50,
    },
    ...overrides,
  };
}

function adapterResult(response, overrides = {}) {
  return {
    adapter: "codex-cli",
    adapterVersion: "codex-cli/test",
    executablePath: "D:/fixture/codex.exe",
    requestedModel: null,
    reportedModel: response?.usage?.reportedModel ?? null,
    startedAt: NOW,
    finishedAt: NOW,
    exitCode: 0,
    status: "completed",
    response,
    rawEvents: [],
    stdout: Buffer.from("event\n"),
    stderr: Buffer.from(""),
    diagnostics: [],
    worktreePath: "D:/fixture/worktree",
    ...overrides,
  };
}

async function createFixture({ withWorktree = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-development-provider-"));
  const storyId = `M8-B-RUNTIME-${randomUUID().slice(0, 8)}`;
  const attemptRoot = `.harness/runs/${storyId}/phases/03-implementation/attempts/${DISPATCH_ID}`;
  const stateFile = `.harness/states/e2e-${storyId}.json`;
  const taskFile = `${attemptRoot}/task.json`;
  const dagFile = `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`;
  const planFile = `.harness/runs/${storyId}/worktrees/${TASK_ID}/plan.json`;
  const statusFile = `.harness/runs/${storyId}/worktrees/${TASK_ID}/status.json`;
  const worktreeRelative = `.harness/worktrees/${storyId}/${TASK_ID}`;
  const worktreePath = path.resolve(root, worktreeRelative);
  const predictedFile = ".harness/scripts/lib/development-provider-runtime.mjs";
  const node = {
    taskId: TASK_ID,
    title: "Implement Development Provider Runtime",
    type: "integration",
    status: "pending",
    ownerAgent: "backend-developer",
    predictedFiles: [predictedFile],
    criterionIds: ["AC-M8B-RUNTIME"],
  };
  const dag = {
    schemaVersion: "2.0",
    storyId,
    nodes: [node],
    edges: [],
    waves: [[TASK_ID]],
    globalChanges: [],
    risks: [],
  };
  await writeJson(root, dagFile, dag);
  const dagSha256 = sha256(await readFile(path.join(root, dagFile)));
  const state = {
    schemaVersion: "2.0",
    storyId,
    phase: "implementation",
    runtime: {
      runId: storyId,
      status: "active",
      revision: 4,
    },
    requirement: {
      acceptanceCriteria: [{
        criterionId: "AC-M8B-RUNTIME",
        description: "Development Runtime is deterministic.",
        source: "fixture",
        required: true,
      }],
    },
    knowledge: {
      areas: [{
        area: "common",
        relevant: true,
        status: "fresh",
        loadedFiles: [],
      }],
    },
    dag: {
      schemaVersion: "2.0",
      sourceFile: dagFile,
      sourceSha256: dagSha256,
      nodes: [node],
      edges: [],
      waves: [[TASK_ID]],
      globalChanges: [],
      risks: [],
    },
  };
  const task = {
    schemaVersion: "2.0",
    dispatchId: DISPATCH_ID,
    storyId,
    runId: storyId,
    phase: "implementation",
    ownerAgent: "backend-developer",
    purpose: "Implement task-owned changes only.",
    preparedRevision: 4,
    preparedAt: NOW,
    resultSchemaVersion: "2.0",
    attemptRoot,
    resultFile: `${attemptRoot}/result.json`,
    checkpointFile: `${attemptRoot}/checkpoint.json`,
    expectedOutputs: [
      `.harness/runs/${storyId}/phases/03-implementation/implementation-notes.md`,
    ],
    allowedAdapters: [],
    next: "unit-test",
  };
  await writeJson(root, stateFile, state);
  await writeJson(root, taskFile, task);
  await writeJson(root, `${attemptRoot}/checkpoint.json`, {
    schemaVersion: "1.0",
    dispatchId: DISPATCH_ID,
    storyId,
    phase: "implementation",
    status: "prepared",
    preparedAt: NOW,
    updatedAt: NOW,
  });
  await writeJson(root, `.harness/runs/${storyId}/phases/03-implementation/active-attempt.json`, {
    schemaVersion: "1.0",
    dispatchId: DISPATCH_ID,
    attemptRoot,
    taskFile,
    resultFile: task.resultFile,
    checkpointFile: task.checkpointFile,
    preparedRevision: 4,
    status: "prepared",
    updatedAt: NOW,
  });
  await write(root, `.harness/runs/${storyId}/phases/00-requirement/requirement-breakdown.md`, "# Requirement\n");
  await write(root, `.harness/runs/${storyId}/phases/01-technical-design/technical-design.md`, "# Design\n");
  await write(root, "AGENTS.md", "# Rules\n");
  await write(root, predictedFile, "export const runtime = true;\n");
  await write(root, ".codex/agents/agents.yaml", [
    'schema_version: "1.0"',
    "agents:",
    "  - name: backend-developer",
    "    category: execution",
    "  - name: frontend-developer",
    "    category: execution",
    "",
  ].join("\n"));
  await writeJson(root, ".codex/agents/worker-policies.json", {
    schemaVersion: "1.0",
    roles: [
      {
        name: "backend-developer",
        category: "execution",
        readPathPrefixes: ["AGENTS.md", ".harness/", "llm-knowledge/"],
        writePathPrefixes: [".harness/scripts/"],
        capabilities: ["phase-output", "backend-write"],
      },
      {
        name: "frontend-developer",
        category: "execution",
        readPathPrefixes: ["AGENTS.md", ".harness/", "llm-knowledge/"],
        writePathPrefixes: ["frontend/src/"],
        capabilities: ["phase-output", "frontend-write"],
      },
    ],
  });
  await writeJson(root, ".harness/config/agent-providers.json", {
    schemaVersion: "1.0",
    defaultProfile: "codex-default",
    profiles: {
      "codex-default": {
        adapter: "codex-cli",
        model: null,
        modelProvider: null,
      },
      explicit: {
        adapter: "codex-cli",
        model: "fixture-model",
        modelProvider: null,
      },
    },
    roleBindings: {
      "backend-developer": "codex-default",
      "frontend-developer": "codex-default",
    },
  });
  await write(
    root,
    ".harness/schemas/agent-development-response.schema.json",
    '{"type":"object","additionalProperties":false}\n',
  );
  if (withWorktree) {
    await mkdir(worktreePath, { recursive: true });
    await write(root, `${worktreeRelative}/${predictedFile}`, "export const runtime = 'worktree';\n");
    await writeJson(root, planFile, {
      schemaVersion: "1.0",
      storyId,
      runId: storyId,
      taskId: TASK_ID,
      ownerAgent: "backend-developer",
      taskDagFile: dagFile,
      taskDagSha256: dagSha256,
      predictedFiles: [predictedFile],
      branch: "harness/m8-b-001/t5-runtime",
      worktreePath: worktreeRelative,
      baseCommit: COMMIT,
      plannedAt: NOW,
    });
    await writeJson(root, statusFile, {
      schemaVersion: "1.0",
      storyId,
      runId: storyId,
      taskId: TASK_ID,
      state: "created",
      branch: "harness/m8-b-001/t5-runtime",
      worktreePath: worktreeRelative,
      baseCommit: COMMIT,
      headCommit: COMMIT,
      checkedAt: NOW,
      details: [],
    });
  }
  return {
    root,
    storyId,
    stateFile,
    task,
    planFile,
    statusFile,
    paths: developmentProviderPaths(task, TASK_ID),
    captureBaseline: async () => baseline(),
  };
}

async function createCandidateFixture({
  role = "backend-developer",
  predictedFile = role === "backend-developer"
    ? "backend/src/main/java/example/Service.java"
    : "frontend/src/views/example/Feature.vue",
  existing = true,
} = {}) {
  const fixture = await createFixture();
  const baseContent = existing ? "before\n" : null;
  const state = await readJson(fixture.root, fixture.stateFile);
  state.dag.nodes[0].ownerAgent = role;
  state.dag.nodes[0].type = role === "backend-developer" ? "backend" : "frontend";
  state.dag.nodes[0].predictedFiles = [predictedFile];
  const dagFile = state.dag.sourceFile;
  const dag = await readJson(fixture.root, dagFile);
  dag.nodes[0] = structuredClone(state.dag.nodes[0]);
  await writeJson(fixture.root, dagFile, dag);
  state.dag.sourceSha256 = sha256(await readFile(path.join(fixture.root, dagFile)));
  await writeJson(fixture.root, fixture.stateFile, state);
  const task = await readJson(fixture.root, `${fixture.task.attemptRoot}/task.json`);
  task.ownerAgent = role;
  await writeJson(fixture.root, `${fixture.task.attemptRoot}/task.json`, task);
  fixture.task = task;
  fixture.paths = developmentProviderPaths(task, TASK_ID);
  const plan = await readJson(fixture.root, fixture.planFile);
  plan.ownerAgent = role;
  plan.taskDagSha256 = state.dag.sourceSha256;
  plan.predictedFiles = [predictedFile];
  await writeJson(fixture.root, fixture.planFile, plan);
  const policies = await readJson(fixture.root, ".codex/agents/worker-policies.json");
  const policy = policies.roles.find((item) => item.name === role);
  policy.writePathPrefixes = [
    ".harness/runs/",
    role === "backend-developer" ? "backend/src/" : "frontend/src/",
  ];
  await writeJson(fixture.root, ".codex/agents/worker-policies.json", policies);
  const worktreeRelative = `.harness/worktrees/${fixture.storyId}/${TASK_ID}`;
  if (baseContent !== null) {
    await write(fixture.root, `${worktreeRelative}/${predictedFile}`, baseContent);
  }
  fixture.predictedFile = predictedFile;
  fixture.baseContent = baseContent;
  fixture.baselineValue = baseline({
    predictedFile,
    baseSha256: baseContent === null ? null : sha256(baseContent),
  });
  if (role === "frontend-developer") {
    fixture.baselineValue.buildOutputs = [
      {
        path: "frontend/node_modules",
        state: "baseline",
        sha256: sha256("trusted-node-modules"),
      },
      { path: "frontend/dist", state: "absent", sha256: null },
    ];
  }
  fixture.captureBaseline = async () => structuredClone(fixture.baselineValue);
  return fixture;
}

async function withCandidateFixture(runFixture, options) {
  const fixture = await createCandidateFixture(options);
  try {
    await runFixture(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function withFixture(run, options) {
  const fixture = await createFixture(options);
  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function prepare(fixture, options = {}) {
  return prepareDevelopmentProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    captureBaseline: fixture.captureBaseline,
    now: () => NOW,
    ...options,
  });
}

async function inspect(fixture, options = {}) {
  return inspectDevelopmentProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    captureBaseline: fixture.captureBaseline,
    ...options,
  });
}

async function run(fixture, options = {}) {
  return runDevelopmentProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    captureBaseline: fixture.captureBaseline,
    now: () => NOW,
    ...options,
  });
}

async function materialize(fixture, options = {}) {
  return materializeDevelopmentProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    captureBaseline: fixture.captureBaseline,
    now: () => NOW,
    ...options,
  });
}

async function testCandidate(fixture, options = {}) {
  return testDevelopmentProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    captureBaseline: fixture.captureBaseline,
    now: () => NOW,
    ...options,
  });
}

async function finalizeCandidate(fixture, options = {}) {
  const defaultInspectChanges = async () => {
    const manifest = await readJson(fixture.root, fixture.paths.candidateManifestFile);
    const entries = manifest.files.map((file) => changedEntry(file.path, file.changeType));
    const worktreeRoot = path.join(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
    );
    for (const relativePath of [fixture.task.expectedOutputs[0], fixture.task.resultFile]) {
      if (await exists(worktreeRoot, relativePath)) {
        entries.push(changedEntry(relativePath, "create"));
      }
    }
    return entries;
  };
  return finalizeDevelopmentProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    captureBaseline: fixture.captureBaseline,
    inspectChanges: defaultInspectChanges,
    now: () => NOW,
    ...options,
  });
}

async function testStatusProgression() {
  await withFixture(async (fixture) => {
    assert.equal((await inspect(fixture)).status, "development-provider-not-prepared");
    await prepare(fixture);
    assert.equal((await inspect(fixture)).status, "development-provider-ready");

    await writeJson(fixture.root, fixture.paths.lockFile, {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      command: "run",
      storyId: fixture.storyId,
      runId: fixture.storyId,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      providerRequestId: null,
      providerExecutionId: null,
      worktreePath: path.resolve(
        fixture.root,
        `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
      ),
      parentPid: 1234,
      childPid: null,
      startedAt: NOW,
    });
    assert.equal((await inspect(fixture, {
      processExists: (pid) => pid === 1234,
    })).status, "development-provider-run-in-progress");
    await unlink(path.join(fixture.root, fixture.paths.lockFile));

    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const executionId = randomUUID();
    const executionRoot = `${fixture.paths.executionsRoot}/${executionId}`;
    await writeJson(fixture.root, `${executionRoot}/execution-claim.json`, {
      schemaVersion: "1.0",
      providerExecutionId: executionId,
      providerRequestId: request.providerRequestId,
      dispatchId: request.dispatchId,
      storyId: request.storyId,
      runId: request.runId,
      phase: "implementation",
      taskId: request.taskId,
      role: request.role,
      worktreePath: request.worktreePath,
      claimedAt: NOW,
    });
    assert.equal((await inspect(fixture)).status, "development-provider-indeterminate");
    await rm(path.join(fixture.root, fixture.paths.executionsRoot), {
      recursive: true,
      force: true,
    });
    const failed = await run(fixture, {
      adapter: async () => adapterResult(null, {
        status: "failed",
        exitCode: 1,
        diagnostics: ["fixture failed"],
      }),
    });
    assert.equal(failed.status, "development-provider-failed");
    assert.equal((await inspect(fixture)).status, "development-provider-failed");
    await rm(path.join(fixture.root, fixture.paths.executionsRoot), {
      recursive: true,
      force: true,
    });
    const completed = await run(fixture, {
      adapter: async () => adapterResult(responseFor(request), {
        worktreePath: request.worktreePath,
      }),
    });
    assert.equal(completed.status, "development-provider-materialize-required");
    await write(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}/.harness/scripts/lib/development-provider-runtime.mjs`,
      "export const runtime = 'changed-by-agent';\n",
    );
    assert.equal((await inspect(fixture)).status, "development-provider-materialize-required");

    const worktreeAfter = {
      ...baseline(),
      gitStatusSha256: sha256("status"),
      dirtyPaths: [".harness/scripts/lib/development-provider-runtime.mjs"],
    };
    await writeJson(fixture.root, fixture.paths.worktreeAfterFile, worktreeAfter);
    await writeJson(fixture.root, fixture.paths.candidateManifestFile, {
      schemaVersion: "1.0",
      storyId: fixture.storyId,
      runId: fixture.storyId,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      role: "backend-developer",
      baseCommit: COMMIT,
      headCommit: COMMIT,
      worktreePath: request.worktreePath,
      baselineSha256: sha256(json(baseline())),
      afterSha256: sha256(json(worktreeAfter)),
      gitStatusSha256: sha256("status"),
      files: [{
        path: ".harness/scripts/lib/development-provider-runtime.mjs",
        changeType: "update",
        sha256: sha256("export const runtime = 'changed-by-agent';\n"),
        bytes: Buffer.byteLength("export const runtime = 'changed-by-agent';\n"),
        kind: "phase-output",
      }],
      totalBytes: Buffer.byteLength("export const runtime = 'changed-by-agent';\n"),
      createdAt: NOW,
    });
    assert.equal((await inspect(fixture)).status, "development-provider-test-required");
    await writeJson(fixture.root, fixture.paths.adapterSelectionFile, {
      schemaVersion: "1.0",
      status: "required",
    });
    assert.equal((await inspect(fixture)).status, "adapter-selection-required");
    await unlink(path.join(fixture.root, fixture.paths.adapterSelectionFile));
    await write(fixture.root, fixture.paths.testStdoutFile, "tests passed\n");
    await write(fixture.root, fixture.paths.testStderrFile, "");
    const candidateSha256 = sha256(
      json([{
        path: ".harness/scripts/lib/development-provider-runtime.mjs",
        changeType: "update",
        sha256: sha256("export const runtime = 'changed-by-agent';\n"),
        bytes: Buffer.byteLength("export const runtime = 'changed-by-agent';\n"),
      }]),
    );
    await writeJson(fixture.root, fixture.paths.testReceiptFile, {
      schemaVersion: "1.0",
      storyId: fixture.storyId,
      runId: fixture.storyId,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      candidateManifestFile: fixture.paths.candidateManifestFile,
      candidateManifestSha256: sha256(
        await readFile(path.join(fixture.root, fixture.paths.candidateManifestFile)),
      ),
      adapterId: "backend-maven",
      commandId: "maven-test",
      workingDirectory: "backend",
      toolchain: {
        adapterId: "backend-maven",
        mavenPath: "D:/fixture/maven/bin/mvn.cmd",
        mavenVersion: "maven-fixture-1.0",
        mavenSha256: sha256("maven-fixture"),
        javaPath: "D:/fixture/jdk/bin/java.exe",
        javaVersion: "java-fixture-17",
        javaSha256: sha256("java-fixture"),
        repositoryPath: "D:/fixture/home/.m2/repository",
        repositoryIdentity: sha256("fixture-m2"),
      },
      toolchainSha256: sha256(json({
        adapterId: "backend-maven",
        mavenPath: "D:/fixture/maven/bin/mvn.cmd",
        mavenVersion: "maven-fixture-1.0",
        mavenSha256: sha256("maven-fixture"),
        javaPath: "D:/fixture/jdk/bin/java.exe",
        javaVersion: "java-fixture-17",
        javaSha256: sha256("java-fixture"),
        repositoryPath: "D:/fixture/home/.m2/repository",
        repositoryIdentity: sha256("fixture-m2"),
      })),
      status: "passed",
      exitCode: 0,
      stdoutFile: fixture.paths.testStdoutFile,
      stdoutSha256: sha256("tests passed\n"),
      stderrFile: fixture.paths.testStderrFile,
      stderrSha256: sha256(""),
      candidateBeforeSha256: candidateSha256,
      candidateAfterSha256: candidateSha256,
      executedAt: NOW,
    });
    assert.equal((await inspect(fixture)).status, "development-provider-finalize-required");
  });

  await withFixture(async (fixture) => {
    await writeJson(fixture.root, fixture.planFile, {
      invalid: true,
    });
    assert.equal((await inspect(fixture)).status, "development-provider-invalid");
  });

  await withFixture(async (fixture) => {
    assert.equal((await inspect(fixture)).status, "development-worktree-required");
  }, { withWorktree: false });
}

async function testPrepareAtomicityIdempotencyAndDrift() {
  await withFixture(async (fixture) => {
    await assert.rejects(
      prepare(fixture, {
        beforePreparedRename: async () => {
          assert.equal(await exists(fixture.root, fixture.paths.preparedRoot), false);
          throw new Error("fixture prepare interruption");
        },
      }),
      /prepare interruption/i,
    );
    assert.equal(await exists(fixture.root, fixture.paths.requestFile), false);
    assert.equal((await inspect(fixture)).status, "development-provider-not-prepared");

    const prepared = await prepare(fixture, {
      profile: "explicit",
      model: "runtime-model",
    });
    assert.equal(prepared.status, "development-provider-ready");
    assert.equal(prepared.prepared, true);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    assert.equal(request.profile, "explicit");
    assert.equal(request.requestedModel, "runtime-model");
    assert.equal(request.modelSource, "runtime-override");
    assert.equal(request.worktreePath, path.resolve(fixture.root, `.harness/worktrees/${fixture.storyId}/${TASK_ID}`));
    assert.match(request.taskSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(request.contextManifestSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(request.outputSchemaSha256, /^sha256:[a-f0-9]{64}$/);
    const context = await readJson(fixture.root, fixture.paths.contextManifestFile);
    const sourceEntry = context.entries.find((entry) => entry.source === "source");
    assert.equal(sourceEntry.sha256, sha256("export const runtime = 'worktree';\n"));

    const repeated = await prepare(fixture);
    assert.equal(repeated.prepared, false);
    assert.equal(repeated.providerRequestId, request.providerRequestId);
    await assert.rejects(
      prepare(fixture, { profile: "codex-default" }),
      /already prepared|override|cannot change/i,
    );

    const config = await readJson(fixture.root, ".harness/config/agent-providers.json");
    config.profiles.explicit.model = "drifted-model";
    await writeJson(fixture.root, ".harness/config/agent-providers.json", config);
    assert.equal((await inspect(fixture)).status, "development-provider-invalid");
  });

  for (const drift of ["revision", "dag", "worktree"]) {
    await withFixture(async (fixture) => {
      await prepare(fixture);
      if (drift === "revision") {
        const state = await readJson(fixture.root, fixture.stateFile);
        state.runtime.revision += 1;
        await writeJson(fixture.root, fixture.stateFile, state);
      } else if (drift === "dag") {
        await write(fixture.root, stateDagFile(fixture.storyId), `${json({ drift: true })}`);
      } else {
        const status = await readJson(fixture.root, fixture.statusFile);
        status.headCommit = "2".repeat(40);
        await writeJson(fixture.root, fixture.statusFile, status);
      }
      assert.equal((await inspect(fixture)).status, "development-provider-invalid");
    });
  }
}

function stateDagFile(storyId) {
  return `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`;
}

async function testPrepareLockAndFencing() {
  await withFixture(async (fixture) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let firstLockId;
    const first = prepare(fixture, {
      beforePreparedRename: async () => {
        firstLockId = (await readJson(fixture.root, fixture.paths.lockFile)).lockId;
        await gate;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(prepare(fixture), /lock|in progress|active/i);
    release();
    await first;
    assert.match(firstLockId, /^[0-9a-f-]{36}$/i);
    assert.equal(await exists(fixture.root, fixture.paths.lockFile), false);
  });

  await withFixture(async (fixture) => {
    const replacement = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      command: "run",
      storyId: fixture.storyId,
      runId: fixture.storyId,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      providerRequestId: null,
      providerExecutionId: null,
      worktreePath: path.resolve(
        fixture.root,
        `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
      ),
      parentPid: 9999,
      childPid: null,
      startedAt: NOW,
    };
    await assert.rejects(
      prepare(fixture, {
        beforePreparedRename: async () => {
          await writeJson(fixture.root, fixture.paths.lockFile, replacement);
        },
      }),
      /fencing|lock owner|expired holder/i,
    );
    assert.equal((await readJson(fixture.root, fixture.paths.lockFile)).lockId, replacement.lockId);
    assert.equal(await exists(fixture.root, fixture.paths.preparedRoot), false);
  });
}

async function testExplicitStaleLockRecovery() {
  await withFixture(async (fixture) => {
    const lock = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      command: "run",
      storyId: fixture.storyId,
      runId: fixture.storyId,
      dispatchId: DISPATCH_ID,
      taskId: TASK_ID,
      providerRequestId: null,
      providerExecutionId: null,
      worktreePath: path.resolve(
        fixture.root,
        `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
      ),
      parentPid: 9998,
      childPid: 9999,
      startedAt: NOW,
    };
    await writeJson(fixture.root, fixture.paths.lockFile, lock);
    const expectedLockSha256 = sha256(await readFile(
      path.join(fixture.root, fixture.paths.lockFile),
    ));
    assert.equal(
      (await inspect(fixture, { processExists: () => false })).status,
      "development-provider-lock-recovery-required",
    );
    await assert.rejects(
      recoverDevelopmentProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        expectedLockSha256: sha256("wrong-lock"),
        processExists: () => false,
      }),
      /hash|drift/i,
    );
    await assert.rejects(
      recoverDevelopmentProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        expectedLockSha256,
        processExists: () => true,
      }),
      /alive|active|process/i,
    );
    const recovered = await recoverDevelopmentProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      expectedLockSha256,
      processExists: () => false,
      now: () => NOW,
    });
    assert.equal(recovered.status, "development-provider-not-prepared");
    assert.equal(recovered.recoveredLockId, lock.lockId);
    assert.equal(await exists(fixture.root, fixture.paths.lockFile), false);
    const recovery = JSON.parse((await readFile(
      path.join(fixture.root, fixture.paths.lockRecoveryFile),
      "utf8",
    )).trim());
    assert.equal(recovery.recoveredLockId, lock.lockId);
    assert.equal(recovery.lockSha256, expectedLockSha256);
  });
}

async function testRunClaimFirstReceiptAndNoRetry() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    let calls = 0;
    let executionId;
    const adapter = async (input) => {
      calls += 1;
      const executions = await readdir(path.join(fixture.root, fixture.paths.executionsRoot));
      assert.equal(executions.length, 1);
      executionId = executions[0];
      const claim = await readJson(
        fixture.root,
        `${fixture.paths.executionsRoot}/${executionId}/execution-claim.json`,
      );
      assert.equal(claim.providerRequestId, request.providerRequestId);
      assert.equal(claim.worktreePath, request.worktreePath);
      assert.match(input.prompt, new RegExp(request.providerRequestId));
      assert.equal(input.worktreePath, request.worktreePath);
      await input.onSpawn(4242);
      const lock = await readJson(fixture.root, fixture.paths.lockFile);
      assert.equal(lock.providerExecutionId, executionId);
      assert.equal(lock.childPid, 4242);
      return adapterResult(responseFor(request), {
        requestedModel: request.requestedModel,
        worktreePath: request.worktreePath,
      });
    };
    const result = await run(fixture, { adapter });
    assert.equal(result.status, "development-provider-materialize-required");
    assert.equal(result.providerExecutionId, executionId);
    assert.equal(calls, 1);

    const executionRoot = `${fixture.paths.executionsRoot}/${executionId}`;
    const receipt = await readJson(fixture.root, `${executionRoot}/execution-receipt.json`);
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.providerRequestId, request.providerRequestId);
    assert.equal(receipt.sandbox, "workspace-write");
    assert.equal(receipt.writeIsolation, "task-worktree-workspace-write");
    assert.equal(receipt.workingRoot, request.worktreePath);
    assert.equal(receipt.stdoutSha256, sha256(await readFile(path.join(fixture.root, receipt.stdoutFile))));
    assert.equal(receipt.stderrSha256, sha256(await readFile(path.join(fixture.root, receipt.stderrFile))));
    assert.equal(receipt.responseSha256, sha256(await readFile(path.join(fixture.root, receipt.responseFile))));

    await assert.rejects(run(fixture, { adapter }), /not allowed|already.*execution|materialize/i);
    assert.equal(calls, 1);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    let calls = 0;
    await assert.rejects(
      run(fixture, {
        adapter: async () => {
          calls += 1;
          return adapterResult(responseFor(request), { worktreePath: request.worktreePath });
        },
        beforeExecutionReceiptWrite: async () => {
          throw new Error("fixture interruption after response");
        },
      }),
      /interruption after response/i,
    );
    const [executionId] = await readdir(path.join(fixture.root, fixture.paths.executionsRoot));
    const executionRoot = `${fixture.paths.executionsRoot}/${executionId}`;
    assert.equal(await exists(fixture.root, `${executionRoot}/response.json`), true);
    assert.equal(await exists(fixture.root, `${executionRoot}/execution-receipt.json`), false);
    assert.equal((await inspect(fixture)).status, "development-provider-indeterminate");
    await assert.rejects(
      run(fixture, { adapter: async () => { calls += 1; } }),
      /indeterminate|not allowed/i,
    );
    assert.equal(calls, 1);
  });
}

async function testClaimOnlyIsIndeterminateAndNeverReruns() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const executionId = randomUUID();
    await writeJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${executionId}/execution-claim.json`,
      {
        schemaVersion: "1.0",
        providerExecutionId: executionId,
        providerRequestId: request.providerRequestId,
        dispatchId: request.dispatchId,
        storyId: request.storyId,
        runId: request.runId,
        phase: "implementation",
        taskId: request.taskId,
        role: request.role,
        worktreePath: request.worktreePath,
        claimedAt: NOW,
      },
    );
    let calls = 0;
    const adapter = async () => {
      calls += 1;
      return adapterResult(responseFor(request));
    };
    assert.equal((await inspect(fixture)).status, "development-provider-indeterminate");
    await assert.rejects(run(fixture, { adapter }), /indeterminate|not allowed/i);
    assert.equal(calls, 0);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    let calls = 0;
    await assert.rejects(
      run(fixture, {
        afterClaimWrite: async () => {
          await write(
            fixture.root,
            `.harness/worktrees/${fixture.storyId}/${TASK_ID}/.harness/scripts/lib/development-provider-runtime.mjs`,
            "export const runtime = 'drifted-before-spawn';\n",
          );
        },
        adapter: async () => {
          calls += 1;
          return adapterResult(null, { status: "failed" });
        },
      }),
      /context.*drift|drifted.*context/i,
    );
    assert.equal(calls, 0);
    assert.equal((await inspect(fixture)).status, "development-provider-indeterminate");
  });
}

async function testRunFailureClassificationAndReceiptIdentity() {
  for (const status of ["failed", "timed-out", "output-limit"]) {
    await withFixture(async (fixture) => {
      await prepare(fixture);
      const request = await readJson(fixture.root, fixture.paths.requestFile);
      const result = await run(fixture, {
        adapter: async () => adapterResult(null, {
          status,
          exitCode: status === "failed" ? 1 : null,
          diagnostics: [`fixture ${status}`],
          worktreePath: request.worktreePath,
        }),
      });
      assert.equal(result.status, "development-provider-failed");
      const receipt = await readJson(
        fixture.root,
        `${fixture.paths.executionsRoot}/${result.providerExecutionId}/execution-receipt.json`,
      );
      assert.equal(receipt.status, status);
    });
  }

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const result = await run(fixture, {
      adapter: async () => adapterResult(responseFor(request, {
        providerRequestId: randomUUID(),
      }), {
        worktreePath: request.worktreePath,
      }),
    });
    assert.equal(result.status, "development-provider-failed");
    const receiptFile =
      `${fixture.paths.executionsRoot}/${result.providerExecutionId}/execution-receipt.json`;
    assert.equal((await readJson(fixture.root, receiptFile)).status, "invalid-response");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    let captureCount = 0;
    const result = await run(fixture, {
      captureBaseline: async () => {
        captureCount += 1;
        const value = baseline();
        if (captureCount > 1) value.configSha256 = sha256("drifted-config");
        return value;
      },
      adapter: async () => adapterResult(responseFor(request), {
        worktreePath: request.worktreePath,
      }),
    });
    assert.equal(result.status, "development-provider-failed");
    const receipt = await readJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${result.providerExecutionId}/execution-receipt.json`,
    );
    assert.equal(receipt.status, "integrity-violation");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const result = await run(fixture, {
      adapter: async () => {
        throw new Error("fixture adapter crash");
      },
    });
    assert.equal(result.status, "development-provider-failed");
    const receiptFile =
      `${fixture.paths.executionsRoot}/${result.providerExecutionId}/execution-receipt.json`;
    assert.equal((await readJson(fixture.root, receiptFile)).status, "failed");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const result = await run(fixture, {
      adapter: async () => adapterResult(responseFor(request), {
        worktreePath: request.worktreePath,
      }),
    });
    const receiptFile =
      `${fixture.paths.executionsRoot}/${result.providerExecutionId}/execution-receipt.json`;
    const receipt = await readJson(fixture.root, receiptFile);
    receipt.providerRequestId = randomUUID();
    await writeJson(fixture.root, receiptFile, receipt);
    assert.equal((await inspect(fixture)).status, "development-provider-invalid");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const result = await run(fixture, {
      adapter: async () => adapterResult(responseFor(request), {
        worktreePath: request.worktreePath,
      }),
    });
    const executionRoot = `${fixture.paths.executionsRoot}/${result.providerExecutionId}`;
    const responseFile = `${executionRoot}/response.json`;
    const response = await readJson(fixture.root, responseFile);
    response.providerRequestId = randomUUID();
    await writeJson(fixture.root, responseFile, response);
    const receiptFile = `${executionRoot}/execution-receipt.json`;
    const receipt = await readJson(fixture.root, receiptFile);
    receipt.responseSha256 = sha256(await readFile(path.join(fixture.root, responseFile)));
    await writeJson(fixture.root, receiptFile, receipt);
    assert.equal((await inspect(fixture)).status, "development-provider-invalid");
  });
}

function changedEntry(pathValue, changeType = "update") {
  if (changeType === "create") {
    return {
      path: pathValue,
      indexStatus: "?",
      worktreeStatus: "?",
      untracked: true,
    };
  }
  if (changeType === "delete") {
    return {
      path: pathValue,
      indexStatus: " ",
      worktreeStatus: "D",
      untracked: false,
    };
  }
  return {
    path: pathValue,
    indexStatus: " ",
    worktreeStatus: "M",
    untracked: false,
  };
}

function afterSnapshot(fixture, changes, drift = {}) {
  return {
    ...structuredClone(fixture.baselineValue ?? baseline({
      predictedFile: fixture.predictedFile,
      baseSha256: fixture.baseContent === null ? null : sha256(fixture.baseContent),
    })),
    gitStatusSha256: sha256(json(changes)),
    dirtyPaths: changes.map((entry) => entry.path),
    untrackedFilesSha256: sha256(json(changes.filter((entry) => entry.untracked))),
    ...drift,
  };
}

async function runCandidate(fixture, {
  writes,
  declaredFiles,
}) {
  await prepare(fixture);
  const request = await readJson(fixture.root, fixture.paths.requestFile);
  return run(fixture, {
    adapter: async () => {
      for (const [relativePath, content] of writes) {
        await write(
          fixture.root,
          `.harness/worktrees/${fixture.storyId}/${TASK_ID}/${relativePath}`,
          content,
        );
      }
      return adapterResult(responseFor(request, { declaredFiles }), {
        worktreePath: request.worktreePath,
      });
    },
  });
}

async function materializeCandidate(fixture, content = "candidate\n", options = {}) {
  await runCandidate(fixture, {
    writes: [[fixture.predictedFile, content]],
    declaredFiles: [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Fixture candidate.",
    }],
  });
  const changes = [changedEntry(fixture.predictedFile)];
  await materialize(fixture, {
    inspectChanges: async () => changes,
    captureAfter: options.captureAfter ?? (async () => afterSnapshot(fixture, changes)),
  });
  return changes;
}

function discoveredAdapter(selection) {
  if (selection.adapterId === "backend-maven") {
    return {
      executablePath: "D:/fixture/maven/bin/mvn.cmd",
      toolchain: {
        adapterId: "backend-maven",
        mavenPath: "D:/fixture/maven/bin/mvn.cmd",
        mavenVersion: "maven-fixture-1.0",
        mavenSha256: sha256("maven-fixture"),
        javaPath: "D:/fixture/jdk/bin/java.exe",
        javaVersion: "java-fixture-17",
        javaSha256: sha256("java-fixture"),
        repositoryPath: "D:/fixture/home/.m2/repository",
        repositoryIdentity: sha256("fixture-m2"),
      },
    };
  }
  return {
    executablePath: "D:/fixture/node/npm.cmd",
    toolchain: {
      adapterId: "frontend-npm",
      npmPath: "D:/fixture/node/npm.cmd",
      npmVersion: "npm-fixture-1.0",
      npmSha256: sha256("npm-fixture"),
      nodePath: "D:/fixture/node/node.exe",
      nodeVersion: "node-fixture-1.0",
      nodeSha256: sha256("node-fixture"),
      dependencySha256: sha256("trusted-node-modules"),
    },
  };
}

function passedTestResult(overrides = {}) {
  return {
    status: "passed",
    exitCode: 0,
    stdout: Buffer.from("tests passed\n"),
    stderr: Buffer.alloc(0),
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  };
}

async function testSandboxedTestExecutor() {
  let invocation;
  const result = await executeSandboxedTestFile({
    executablePath: "C:/fixture/maven/bin/mvn.cmd",
    args: ["test"],
    cwd: "D:/fixture/worktree/backend",
    sandboxExecutablePath: "C:/fixture/codex.exe",
    parentEnv: {
      PATH: "fixture-path",
      SYSTEMROOT: "C:/Windows",
      USERPROFILE: "C:/Users/fixture",
      SECRET_TOKEN: "must-not-leak",
    },
    executeFile: async (executablePath, args, options) => {
      invocation = { executablePath, args, options };
      return { stdout: Buffer.from("passed\n"), stderr: Buffer.alloc(0) };
    },
  });
  assert.equal(result.status, "passed");
  assert.equal(invocation.executablePath, "C:/fixture/codex.exe");
  assert.deepEqual(invocation.args, [
    "sandbox",
    "-P", ":workspace",
    "-C", "D:/fixture/worktree/backend",
    "--sandbox-state-disable-network",
    "C:/fixture/maven/bin/mvn.cmd",
    "test",
  ]);
  assert.equal(invocation.options.cwd, "D:/fixture/worktree/backend");
  assert.equal(invocation.options.env.PATH, "fixture-path");
  assert.equal(invocation.options.env.SYSTEMROOT, "C:/Windows");
  assert.equal(invocation.options.env.USERPROFILE, "C:/Users/fixture");
  assert.equal(Object.hasOwn(invocation.options.env, "SECRET_TOKEN"), false);
}

async function testSandboxedTestRejectsOutsideWrite() {
  const root = await mkdtemp(path.join(process.cwd(), ".harness", "development-test-sandbox-"));
  try {
    const worktree = path.join(root, "worktree");
    const outside = path.join(root, "outside.txt");
    await mkdir(worktree, { recursive: true });
    await execFileAsync("git", ["init", "-b", "dev"], { cwd: worktree, windowsHide: true });
    await execFileAsync("git", ["config", "user.email", "sandbox@example.test"], {
      cwd: worktree,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Sandbox Fixture"], {
      cwd: worktree,
      windowsHide: true,
    });
    await writeFile(path.join(worktree, "seed.txt"), "seed\n", "utf8");
    await execFileAsync("git", ["add", "seed.txt"], { cwd: worktree, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "seed"], { cwd: worktree, windowsHide: true });
    const result = await executeSandboxedTestFile({
      executablePath: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'outside')",
        outside,
      ],
      cwd: worktree,
      timeoutMs: 30_000,
    });
    assert.notEqual(result.status, "passed");
    assert.equal(await exists(root, "outside.txt"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testMaterializeAcceptsUpdateCreateAndFrontend() {
  for (const fixtureOptions of [
    { role: "backend-developer", existing: true, changeType: "update" },
    { role: "backend-developer", existing: false, changeType: "create" },
    { role: "frontend-developer", existing: true, changeType: "update" },
  ]) {
    await withCandidateFixture(async (fixture) => {
      const content = `${fixtureOptions.role}-${fixtureOptions.changeType}\n`;
      await runCandidate(fixture, {
        writes: [[fixture.predictedFile, content]],
        declaredFiles: [{
          path: fixture.predictedFile,
          changeType: fixtureOptions.changeType,
          purpose: "Fixture candidate.",
        }],
      });
      const changes = [changedEntry(fixture.predictedFile, fixtureOptions.changeType)];
      const result = await materialize(fixture, {
        inspectChanges: async () => changes,
        captureAfter: async () => afterSnapshot(fixture, changes),
        beforeCandidateWrite: async () => {
          const request = await readJson(fixture.root, fixture.paths.requestFile);
          const lock = await readJson(fixture.root, fixture.paths.lockFile);
          assert.equal(lock.providerRequestId, request.providerRequestId);
          assert.equal(lock.command, "materialize");
        },
      });
      assert.equal(result.status, "development-provider-test-required");
      assert.equal(result.materialized, true);
      const manifest = await readJson(fixture.root, fixture.paths.candidateManifestFile);
      assert.equal(manifest.files.length, 1);
      assert.equal(manifest.files[0].path, fixture.predictedFile);
      assert.equal(manifest.files[0].changeType, fixtureOptions.changeType);
      assert.equal(
        manifest.files[0].kind,
        fixtureOptions.role === "backend-developer" ? "backend" : "frontend",
      );
      assert.equal(manifest.files[0].sha256, sha256(content));
      assert.equal(manifest.totalBytes, Buffer.byteLength(content));
      assert.equal(await exists(fixture.root, fixture.paths.worktreeAfterFile), true);
      assert.equal(await exists(fixture.root, fixture.paths.diagnosticsFile), true);

      const repeated = await materialize(fixture, {
        inspectChanges: async () => changes,
        captureAfter: async () => afterSnapshot(fixture, changes),
      });
      assert.equal(repeated.materialized, false);
    }, fixtureOptions);
  }
}

async function expectRecovery({
  fixtureOptions = {},
  writes,
  declaredFiles,
  changes,
  drift = {},
  pattern,
}) {
  await withCandidateFixture(async (fixture) => {
    const plannedWrites = writes(fixture);
    await runCandidate(fixture, { writes: plannedWrites, declaredFiles: declaredFiles(fixture) });
    const observedChanges = changes(fixture);
    const entries = Array.isArray(observedChanges)
      ? observedChanges
      : observedChanges.entries;
    const result = await materialize(fixture, {
      inspectChanges: async () => observedChanges,
      captureAfter: async () => afterSnapshot(fixture, entries, drift),
    });
    assert.equal(result.status, "development-provider-recovery-required");
    assert.match(result.diagnostics.join("\n"), pattern);
    assert.equal(await exists(fixture.root, fixture.paths.candidateManifestFile), false);
    assert.equal(await exists(fixture.root, fixture.paths.worktreeAfterFile), true);
    assert.equal(await exists(fixture.root, fixture.paths.diagnosticsFile), true);
    for (const [relativePath] of plannedWrites) {
      assert.equal(await exists(
        path.join(fixture.root, `.harness/worktrees/${fixture.storyId}/${TASK_ID}`),
        relativePath,
      ), true);
    }
    const repeated = await materialize(fixture, {
      inspectChanges: async () => observedChanges,
      captureAfter: async () => afterSnapshot(fixture, entries, drift),
    });
    assert.equal(repeated.materialized, false);
  }, fixtureOptions);
}

async function testMaterializeRejectsUnauthorizedAndMismatchedDeclarations() {
  await expectRecovery({
    writes: () => [["backend/src/main/java/example/Other.java", "other\n"]],
    declaredFiles: () => [{
      path: "backend/src/main/java/example/Other.java",
      changeType: "create",
      purpose: "Outside prediction.",
    }],
    changes: () => [changedEntry("backend/src/main/java/example/Other.java", "create")],
    pattern: /predicted|outside/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.predictedFile, "changed\n"]],
    declaredFiles: () => [],
    changes: (fixture) => [changedEntry(fixture.predictedFile)],
    pattern: /undeclared|declaration/i,
  });
  await expectRecovery({
    writes: () => [],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "False declaration.",
    }],
    changes: () => [],
    pattern: /declared.*missing|no actual/i,
  });
  await expectRecovery({
    writes: () => [["frontend/src/views/example/Other.vue", "<template />\n"]],
    declaredFiles: () => [{
      path: "frontend/src/views/example/Other.vue",
      changeType: "create",
      purpose: "Cross-role change.",
    }],
    changes: () => [changedEntry("frontend/src/views/example/Other.vue", "create")],
    pattern: /role|write policy|frontend/i,
  });
  await expectRecovery({
    fixtureOptions: {
      predictedFile: "backend/pom.xml",
      existing: true,
    },
    writes: () => [["backend/pom.xml", "<project />\n"]],
    declaredFiles: () => [{
      path: "backend/pom.xml",
      changeType: "update",
      purpose: "Non-src backend file.",
    }],
    changes: () => [changedEntry("backend/pom.xml")],
    pattern: /write policy|outside.*role/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.task.expectedOutputs[0], "agent-owned notes\n"]],
    declaredFiles: (fixture) => [{
      path: fixture.task.expectedOutputs[0],
      changeType: "create",
      purpose: "Attempt to write a Runtime-owned phase output.",
    }],
    changes: (fixture) => [changedEntry(fixture.task.expectedOutputs[0], "create")],
    pattern: /phase output|runtime-owned|reserved/i,
  });
}

async function testMaterializeRejectsUnsupportedChangesAndPollution() {
  await expectRecovery({
    writes: () => [],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Deletion disguised as update.",
    }],
    changes: (fixture) => [changedEntry(fixture.predictedFile, "delete")],
    pattern: /delete|unsupported.*status/i,
  });
  await expectRecovery({
    writes: () => [["backend/src/main/java/example/Renamed.java", "renamed\n"]],
    declaredFiles: () => [{
      path: "backend/src/main/java/example/Renamed.java",
      changeType: "create",
      purpose: "Rename.",
    }],
    changes: (fixture) => [{
      ...changedEntry("backend/src/main/java/example/Renamed.java"),
      indexStatus: "R",
      sourcePath: fixture.predictedFile,
    }],
    pattern: /rename|copy/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.predictedFile, Buffer.from([0xff, 0xfe, 0xfd])]],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Binary content.",
    }],
    changes: (fixture) => [changedEntry(fixture.predictedFile)],
    pattern: /utf-8|binary/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.predictedFile, Buffer.alloc(2 * 1024 * 1024 + 1, 97)]],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Oversized content.",
    }],
    changes: (fixture) => [changedEntry(fixture.predictedFile)],
    pattern: /2 MiB|file limit|too large/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.predictedFile, "changed\n"]],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Ignored pollution.",
    }],
    changes: (fixture) => [changedEntry(fixture.predictedFile)],
    drift: { ignoredMetadataSha256: sha256("ignored-drift") },
    pattern: /ignored|protected.*baseline|integrity/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.predictedFile, "changed\n"]],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Git metadata pollution.",
    }],
    changes: (fixture) => [changedEntry(fixture.predictedFile)],
    drift: { configSha256: sha256("config-drift") },
    pattern: /git|protected.*baseline|integrity/i,
  });
  await expectRecovery({
    writes: (fixture) => [[fixture.predictedFile, "changed\n"]],
    declaredFiles: (fixture) => [{
      path: fixture.predictedFile,
      changeType: "update",
      purpose: "Mismatched Git status evidence.",
    }],
    changes: (fixture) => ({
      entries: [changedEntry(fixture.predictedFile)],
      sha256: sha256("different-status"),
    }),
    pattern: /git status.*hash|status.*snapshot/i,
  });
}

async function testMaterializeRejectsNestedGitLinksAndTotalLimit() {
  await withCandidateFixture(async (fixture) => {
    await runCandidate(fixture, {
      writes: [[fixture.predictedFile, "changed\n"]],
      declaredFiles: [{
        path: fixture.predictedFile,
        changeType: "update",
        purpose: "Junction candidate.",
      }],
    });
    const worktree = path.join(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
    );
    const candidate = path.join(worktree, fixture.predictedFile);
    const target = path.join(fixture.root, "junction-target");
    await rm(candidate, { force: true });
    await mkdir(target, { recursive: true });
    await symlink(target, candidate, "junction");
    const changes = [changedEntry(fixture.predictedFile)];
    const result = await materialize(fixture, {
      inspectChanges: async () => changes,
      captureAfter: async () => afterSnapshot(fixture, changes),
    });
    assert.equal(result.status, "development-provider-recovery-required");
    assert.match(result.diagnostics.join("\n"), /symbolic|regular file|junction/i);
    assert.equal((await (await import("node:fs/promises")).lstat(candidate)).isSymbolicLink(), true);
  });

  await withCandidateFixture(async (fixture) => {
    const nestedFile = "backend/src/main/java/example/nested/Service.java";
    await runCandidate(fixture, {
      writes: [[nestedFile, "changed\n"]],
      declaredFiles: [{
        path: nestedFile,
        changeType: "create",
        purpose: "Nested repository candidate.",
      }],
    });
    const worktreeRelative = `.harness/worktrees/${fixture.storyId}/${TASK_ID}`;
    await mkdir(
      path.join(fixture.root, worktreeRelative, "backend/src/main/java/example/nested/.git"),
      { recursive: true },
    );
    const changes = [changedEntry(nestedFile, "create")];
    const result = await materialize(fixture, {
      inspectChanges: async () => changes,
      captureAfter: async () => afterSnapshot(fixture, changes),
    });
    assert.equal(result.status, "development-provider-recovery-required");
    assert.match(result.diagnostics.join("\n"), /nested Git/i);
  }, {
    predictedFile: "backend/src/main/java/example/**",
    existing: false,
  });

  await withCandidateFixture(async (fixture) => {
    const files = Array.from({ length: 5 }, (_, index) =>
      `backend/src/main/java/example/File${index}.java`);
    const content = Buffer.alloc(1_700_000, 97);
    await runCandidate(fixture, {
      writes: files.map((file) => [file, content]),
      declaredFiles: files.map((file) => ({
        path: file,
        changeType: "create",
        purpose: "Total limit fixture.",
      })),
    });
    const changes = files.map((file) => changedEntry(file, "create"));
    const result = await materialize(fixture, {
      inspectChanges: async () => changes,
      captureAfter: async () => afterSnapshot(fixture, changes),
    });
    assert.equal(result.status, "development-provider-recovery-required");
    assert.match(result.diagnostics.join("\n"), /8 MiB.*total/i);
    assert.equal(await exists(fixture.root, fixture.paths.candidateManifestFile), false);
  }, {
    predictedFile: "backend/src/main/java/example/**",
    existing: false,
  });
}

async function testFixedTestAdapterSelection() {
  for (const fixtureOptions of [
    {
      role: "backend-developer",
      adapterId: "backend-maven",
      commandId: "maven-test",
      workingDirectory: "backend",
    },
    {
      role: "frontend-developer",
      adapterId: "frontend-npm",
      commandId: "npm-build",
      workingDirectory: "frontend",
    },
  ]) {
    await withCandidateFixture(async (fixture) => {
      const content = `${fixtureOptions.role}-candidate\n`;
      await runCandidate(fixture, {
        writes: [[fixture.predictedFile, content]],
        declaredFiles: [{
          path: fixture.predictedFile,
          changeType: "update",
          purpose: "Fixture candidate.",
        }],
      });
      const changes = [changedEntry(fixture.predictedFile)];
      await materialize(fixture, {
        inspectChanges: async () => changes,
        captureAfter: async () => afterSnapshot(fixture, changes),
      });
      let selected;
      const result = await testCandidate(fixture, {
        discoverTestAdapter: async (selection) => {
          selected = selection;
          return null;
        },
        inspectChanges: async () => changes,
        command: "echo forbidden",
        shell: true,
        cwd: fixture.root,
      });
      assert.equal(result.status, "adapter-selection-required");
      assert.deepEqual(selected, {
        role: fixtureOptions.role,
        adapterId: fixtureOptions.adapterId,
        commandId: fixtureOptions.commandId,
        workingDirectory: path.join(
          fixture.root,
          `.harness/worktrees/${fixture.storyId}/${TASK_ID}/${fixtureOptions.workingDirectory}`,
        ),
      });
      assert.equal(await exists(fixture.root, fixture.paths.testReceiptFile), false);
      const selection = await readJson(fixture.root, fixture.paths.adapterSelectionFile);
      assert.equal(selection.status, "required");
      assert.equal(selection.adapterId, fixtureOptions.adapterId);
      assert.equal(selection.commandId, fixtureOptions.commandId);
    }, fixtureOptions);
  }
}

async function testCandidateIntegrityBeforeAndAfterTest() {
  await withCandidateFixture(async (fixture) => {
    await materializeCandidate(fixture, "candidate\n", {
      captureAfter: async () => ({
        ...await fixture.captureBaseline(),
        gitStatusSha256: sha256(json([changedEntry(fixture.predictedFile)])),
        dirtyPaths: [fixture.predictedFile],
      }),
    });
    const manifest = await readJson(fixture.root, fixture.paths.candidateManifestFile);
    manifest.files[0].sha256 = sha256("tampered");
    await writeJson(fixture.root, fixture.paths.candidateManifestFile, manifest);
    let calls = 0;
    await assert.rejects(
      () => testCandidate(fixture, {
        discoverTestAdapter: async (selection) => {
          calls += 1;
          return discoveredAdapter(selection);
        },
        inspectChanges: async () => [changedEntry(fixture.predictedFile)],
      }),
      /candidate.*drift|hash/i,
    );
    assert.equal(calls, 0);
  });

  await withCandidateFixture(async (fixture) => {
    await materializeCandidate(fixture);
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => discoveredAdapter(selection),
      executeTest: async () => {
        await write(
          fixture.root,
          `.harness/worktrees/${fixture.storyId}/${TASK_ID}/${fixture.predictedFile}`,
          "changed-by-test\n",
        );
        return passedTestResult();
      },
      inspectChanges: async () => [changedEntry(fixture.predictedFile)],
      captureAfter: async () => afterSnapshot(fixture, [changedEntry(fixture.predictedFile)]),
    });
    assert.equal(result.status, "development-provider-failed");
    const receipt = await readJson(fixture.root, fixture.paths.testReceiptFile);
    assert.equal(receipt.status, "failed");
    assert.notEqual(receipt.candidateBeforeSha256, receipt.candidateAfterSha256);
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture, "candidate\n", {
      captureAfter: async () => ({
        ...await fixture.captureBaseline(),
        gitStatusSha256: sha256(json([changedEntry(fixture.predictedFile)])),
        dirtyPaths: [fixture.predictedFile],
      }),
    });
    let inspection = 0;
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => discoveredAdapter(selection),
      executeTest: async () => passedTestResult(),
      inspectChanges: async () => {
        inspection += 1;
        return inspection === 1
          ? changes
          : [...changes, changedEntry("backend/generated.tmp", "create")];
      },
      captureAfter: async () => afterSnapshot(fixture, changes),
    });
    assert.equal(result.status, "development-provider-failed");
    const receipt = await readJson(fixture.root, fixture.paths.testReceiptFile);
    assert.equal(receipt.status, "failed");
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => discoveredAdapter(selection),
      executeTest: async () => passedTestResult(),
      inspectChanges: async () => changes,
      captureAfter: async () => afterSnapshot(fixture, changes),
    });
    assert.equal(result.status, "development-provider-finalize-required");
    const receipt = await readJson(fixture.root, fixture.paths.testReceiptFile);
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.candidateBeforeSha256, receipt.candidateAfterSha256);
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    let captures = 0;
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => discoveredAdapter(selection),
      executeTest: async () => passedTestResult(),
      inspectChanges: async () => changes,
      captureTestBaseline: async () => {
        captures += 1;
        return {
          ...afterSnapshot(fixture, changes),
          ignoredMetadataSha256: captures === 1
            ? sha256("ignored")
            : sha256("ignored-test-drift"),
        };
      },
    });
    assert.equal(result.status, "development-provider-failed");
    assert.equal((await readJson(
      fixture.root,
      fixture.paths.testReceiptFile,
    )).status, "failed");
  });
}

async function testTrustedToolchainAndDependencySnapshot() {
  await withCandidateFixture(async (fixture) => {
    fixture.captureBaseline = async () => ({
      ...baseline({
        predictedFile: fixture.predictedFile,
        baseSha256: sha256(fixture.baseContent),
      }),
      buildOutputs: [{
        path: "backend/target",
        state: "baseline",
        sha256: sha256("existing-target"),
      }],
    });
    await materializeCandidate(fixture, "candidate\n", {
      captureAfter: async () => ({
        ...await fixture.captureBaseline(),
        gitStatusSha256: sha256(json([changedEntry(fixture.predictedFile)])),
        dirtyPaths: [fixture.predictedFile],
      }),
    });
    let discoveryCalls = 0;
    await assert.rejects(
      () => testCandidate(fixture, {
        discoverTestAdapter: async (selection) => {
          discoveryCalls += 1;
          return discoveredAdapter(selection);
        },
        inspectChanges: async () => [changedEntry(fixture.predictedFile)],
      }),
      /backend\/target|build output/i,
    );
    assert.equal(discoveryCalls, 0);
  });

  await withCandidateFixture(async (fixture) => {
    fixture.captureBaseline = async () => ({
      ...baseline({
        predictedFile: fixture.predictedFile,
        baseSha256: sha256(fixture.baseContent),
      }),
      buildOutputs: [
        { path: "frontend/node_modules", state: "absent", sha256: null },
        { path: "frontend/dist", state: "absent", sha256: null },
      ],
    });
    const changes = await materializeCandidate(fixture, "candidate\n", {
      captureAfter: async () => ({
        ...await fixture.captureBaseline(),
        gitStatusSha256: sha256(json([changedEntry(fixture.predictedFile)])),
        dirtyPaths: [fixture.predictedFile],
      }),
    });
    let discoveryCalls = 0;
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async () => {
        discoveryCalls += 1;
        return null;
      },
      inspectChanges: async () => changes,
    });
    assert.equal(result.status, "adapter-selection-required");
    assert.equal(discoveryCalls, 0);
  }, { role: "frontend-developer" });

  await withCandidateFixture(async (fixture) => {
    const frontendBaseline = {
      ...baseline({
        predictedFile: fixture.predictedFile,
        baseSha256: sha256(fixture.baseContent),
      }),
      buildOutputs: [
        {
          path: "frontend/node_modules",
          state: "baseline",
          sha256: sha256("trusted-node-modules"),
        },
        { path: "frontend/dist", state: "absent", sha256: null },
      ],
    };
    fixture.captureBaseline = async () => frontendBaseline;
    const changes = await materializeCandidate(fixture, "candidate\n", {
      captureAfter: async () => ({
        ...frontendBaseline,
        gitStatusSha256: sha256(json([changedEntry(fixture.predictedFile)])),
        dirtyPaths: [fixture.predictedFile],
      }),
    });
    let executed;
    let baselineCapture = 0;
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => ({
        ...discoveredAdapter(selection),
        toolchain: {
          adapterId: "frontend-npm",
          npmPath: "D:/fixture/node/npm.cmd",
          npmVersion: "11.0.0",
          npmSha256: sha256("npm-fixture"),
          nodePath: "D:/fixture/node/node.exe",
          nodeVersion: "v22.0.0",
          nodeSha256: sha256("node-fixture"),
          dependencySha256: sha256("trusted-node-modules"),
        },
      }),
      executeTest: async (command) => {
        executed = command;
        return passedTestResult();
      },
      inspectChanges: async () => changes,
      captureTestBaseline: async () => {
        baselineCapture += 1;
        return baselineCapture === 1
          ? frontendBaseline
          : {
            ...frontendBaseline,
            buildOutputs: [
              frontendBaseline.buildOutputs[0],
              { path: "frontend/dist", state: "baseline", sha256: sha256("dist") },
            ],
          };
      },
    });
    assert.equal(result.status, "development-provider-finalize-required");
    assert.deepEqual(executed.args, ["run", "build"]);
    assert.equal(executed.cwd, path.join(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}/frontend`,
    ));
  }, { role: "frontend-developer" });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    await assert.rejects(
      () => testCandidate(fixture, {
        discoverTestAdapter: async (selection) => ({
          ...discoveredAdapter(selection),
          executablePath: path.join(selection.workingDirectory, "mvn.cmd"),
        }),
        inspectChanges: async () => changes,
      }),
      /toolchain|executable|worktree/i,
    );
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    let discoveries = 0;
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => {
        discoveries += 1;
        return {
          ...discoveredAdapter(selection),
          toolchain: {
            adapterId: "backend-maven",
            mavenPath: "D:/fixture/maven/bin/mvn.cmd",
            mavenVersion: "maven-fixture-1.0",
            mavenSha256: discoveries === 1
              ? sha256("maven-before")
              : sha256("maven-after"),
            javaPath: "D:/fixture/jdk/bin/java.exe",
            javaVersion: "java-fixture-17",
            javaSha256: sha256("java-fixture"),
            repositoryPath: "D:/fixture/home/.m2/repository",
            repositoryIdentity: sha256("fixture-m2"),
          },
        };
      },
      executeTest: async () => passedTestResult(),
      inspectChanges: async () => changes,
    });
    assert.equal(discoveries, 2);
    assert.equal(result.status, "development-provider-failed");
    assert.equal(
      (await readJson(fixture.root, fixture.paths.testReceiptFile)).status,
      "failed",
    );
  });
}

async function testFixedTestResultsAndReceiptReplay() {
  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    const discovered = [];
    let executed;
    const result = await testCandidate(fixture, {
      parentEnv: {},
      discoverExecutable: async (name) => {
        discovered.push(name);
        return {
          path: name === "mvn"
            ? "D:/fixture/maven/bin/mvn.cmd"
            : "D:/fixture/jdk/bin/java.exe",
          version: `${name}-fixture-1.0`,
          sha256: sha256(`${name}-fixture`),
        };
      },
      inspectMavenRepository: async () => ({
        path: "D:/fixture/home/.m2/repository",
        identity: sha256("fixture-m2"),
      }),
      executeTestFile: async (command) => {
        executed = command;
        return passedTestResult();
      },
      inspectChanges: async () => changes,
    });
    assert.equal(result.status, "development-provider-finalize-required");
    assert.deepEqual(discovered, ["mvn", "java", "mvn", "java"]);
    assert.deepEqual(executed.args, ["test"]);
    assert.equal(executed.cwd, path.join(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}/backend`,
    ));
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    const discovered = [];
    let inspectedJavaHome;
    const result = await testCandidate(fixture, {
      parentEnv: {
        JAVA_HOME: "D:/fixture/jdk17",
        PATH: "D:/fixture/oracle-java;D:/fixture/maven/bin",
      },
      discoverExecutable: async (name) => {
        discovered.push(name);
        return {
          path: "D:/fixture/maven/bin/mvn.cmd",
          version: "maven-fixture-1.0",
          sha256: sha256("maven-fixture"),
        };
      },
      inspectJavaHomeExecutable: async (executablePath) => {
        inspectedJavaHome = executablePath;
        return {
          path: executablePath,
          version: "java-home-fixture-17",
          sha256: sha256("java-home-fixture"),
        };
      },
      inspectMavenRepository: async () => ({
        path: "D:/fixture/home/.m2/repository",
        identity: sha256("fixture-m2"),
      }),
      executeTestFile: async () => passedTestResult(),
      inspectChanges: async () => changes,
    });
    assert.equal(result.status, "development-provider-finalize-required");
    assert.deepEqual(discovered, ["mvn", "mvn"]);
    assert.equal(inspectedJavaHome, path.resolve("D:/fixture/jdk17/bin/java.exe"));
    const receipt = await readJson(fixture.root, fixture.paths.testReceiptFile);
    assert.equal(receipt.toolchainSha256, sha256(json({
      adapterId: "backend-maven",
      mavenPath: "D:/fixture/maven/bin/mvn.cmd",
      mavenVersion: "maven-fixture-1.0",
      mavenSha256: sha256("maven-fixture"),
      javaPath: inspectedJavaHome,
      javaVersion: "java-home-fixture-17",
      javaSha256: sha256("java-home-fixture"),
      repositoryPath: "D:/fixture/home/.m2/repository",
      repositoryIdentity: sha256("fixture-m2"),
    })));
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    const result = await testCandidate(fixture, {
      discoverExecutable: async () => {
        throw new Error("fixture tool unavailable");
      },
      inspectChanges: async () => changes,
    });
    assert.equal(result.status, "adapter-selection-required");
    assert.equal(await exists(fixture.root, fixture.paths.testReceiptFile), false);
  });

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    const result = await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => discoveredAdapter(selection),
      executeTest: async () => passedTestResult({
        stdout: Buffer.alloc(4 * 1024 * 1024 + 1, 97),
      }),
      inspectChanges: async () => changes,
    });
    assert.equal(result.status, "development-provider-failed");
    assert.equal(
      (await readJson(fixture.root, fixture.paths.testReceiptFile)).status,
      "output-limit",
    );
  });

  for (const status of ["failed", "timed-out", "output-limit", "interrupted"]) {
    await withCandidateFixture(async (fixture) => {
      const changes = await materializeCandidate(fixture);
      const result = await testCandidate(fixture, {
        discoverTestAdapter: async (selection) => discoveredAdapter(selection),
        executeTest: async () => passedTestResult({
          status,
          exitCode: status === "failed" ? 1 : null,
        }),
        inspectChanges: async () => changes,
      });
      assert.equal(result.status, "development-provider-failed");
      assert.equal(
        (await readJson(fixture.root, fixture.paths.testReceiptFile)).status,
        status,
      );
    });
  }

  await withCandidateFixture(async (fixture) => {
    const changes = await materializeCandidate(fixture);
    await testCandidate(fixture, {
      discoverTestAdapter: async (selection) => discoveredAdapter(selection),
      executeTest: async () => passedTestResult(),
      inspectChanges: async () => changes,
    });
    await write(fixture.root, fixture.paths.testStdoutFile, "tampered\n");
    assert.equal((await inspect(fixture)).status, "development-provider-invalid");
  });

  for (const mutate of [
    (receipt) => { receipt.adapterId = "frontend-npm"; },
    (receipt) => { receipt.commandId = "npm-build"; },
    (receipt) => { receipt.workingDirectory = "frontend"; },
    (receipt) => { receipt.toolchainSha256 = sha256("forged-toolchain"); },
  ]) {
    await withCandidateFixture(async (fixture) => {
      await preparePassedCandidate(fixture);
      const receipt = await readJson(fixture.root, fixture.paths.testReceiptFile);
      mutate(receipt);
      await writeJson(fixture.root, fixture.paths.testReceiptFile, receipt);
      assert.equal((await inspect(fixture)).status, "development-provider-invalid");
    });
  }
}

async function preparePassedCandidate(fixture) {
  const changes = await materializeCandidate(fixture);
  await testCandidate(fixture, {
    discoverTestAdapter: async (selection) => discoveredAdapter(selection),
    executeTest: async () => passedTestResult(),
    inspectChanges: async () => changes,
  });
  return changes;
}

async function testFinalizePrerequisitesTimingResultReceiptAndReplay() {
  await withCandidateFixture(async (fixture) => {
    await materializeCandidate(fixture);
    await assert.rejects(
      () => finalizeCandidate(fixture),
      /test|finalize|required|status/i,
    );
  });

  await withCandidateFixture(async (fixture) => {
    await preparePassedCandidate(fixture);
    const worktreeRoot = path.join(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
    );
    assert.equal(await exists(worktreeRoot, fixture.task.resultFile), false);
    assert.equal(await exists(worktreeRoot, fixture.task.expectedOutputs[0]), false);
    assert.equal(await exists(fixture.root, fixture.paths.resultEvidenceFile), false);
    assert.equal(await exists(fixture.root, fixture.paths.developmentReceiptFile), false);

    let notesObserved = false;
    await assert.rejects(
      () => finalizeCandidate(fixture, {
        beforeResultWrite: async () => {
          notesObserved = await exists(worktreeRoot, fixture.task.expectedOutputs[0]);
          throw new Error("fixture interruption after notes");
        },
      }),
      /fixture interruption/i,
    );
    assert.equal(notesObserved, true);
    assert.equal(await exists(worktreeRoot, fixture.task.resultFile), false);
    assert.equal(await exists(fixture.root, fixture.paths.developmentReceiptFile), false);

    const finalized = await finalizeCandidate(fixture);
    assert.equal(finalized.status, "development-provider-ready-for-integration");
    assert.equal(finalized.finalized, true);
    const result = await readJson(worktreeRoot, fixture.task.resultFile);
    assert.equal(result.schemaVersion, "2.0");
    assert.equal(result.phase, "implementation");
    assert.equal(result.status, "completed");
    assert.deepEqual(result.payload.taskUpdates, [{ taskId: TASK_ID, status: "done" }]);
    assert.deepEqual(result.payload.actualFiles, [fixture.predictedFile]);
    assert.equal(result.payload.method, "tdd");
    assert.equal(result.payload.exceptionReason, null);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].path, fixture.paths.resultEvidenceFile);
    assert.equal(
      result.outputs[0].path,
      fixture.task.expectedOutputs[0],
    );
    const evidence = await readJson(fixture.root, fixture.paths.resultEvidenceFile);
    assert.equal(evidence.providerRequestId, (
      await readJson(fixture.root, fixture.paths.requestFile)
    ).providerRequestId);
    assert.equal(evidence.candidateManifestFile, fixture.paths.candidateManifestFile);
    assert.equal(evidence.testReceiptFile, fixture.paths.testReceiptFile);
    assert.equal(Object.hasOwn(evidence, "stdout"), false);
    const receipt = await readJson(fixture.root, fixture.paths.developmentReceiptFile);
    assert.equal(receipt.executorKind, "development-provider");
    assert.equal(receipt.outcome, "ready-for-integration");
    assert.equal(receipt.resultEvidenceFile, fixture.task.resultFile);
    assert.equal(receipt.contextEvidenceFile, fixture.paths.candidateManifestFile);
    assert.equal(receipt.files.some((file) => file.path === fixture.predictedFile), true);
    assert.equal(
      receipt.files.some((file) => file.path === fixture.task.expectedOutputs[0]),
      true,
    );

    const repeated = await finalizeCandidate(fixture);
    assert.equal(repeated.finalized, false);
    await write(fixture.root, fixture.paths.testStdoutFile, "tampered after finalize\n");
    assert.equal((await inspect(fixture)).status, "development-provider-invalid");
  });

  await withCandidateFixture(async (fixture) => {
    await preparePassedCandidate(fixture);
    const worktreeRoot = path.join(
      fixture.root,
      `.harness/worktrees/${fixture.storyId}/${TASK_ID}`,
    );
    await assert.rejects(
      () => finalizeCandidate(fixture, {
        beforeReceiptWrite: async () => {
          throw new Error("fixture interruption after result");
        },
      }),
      /interruption after result/i,
    );
    assert.equal(await exists(worktreeRoot, fixture.task.resultFile), true);
    assert.equal(await exists(fixture.root, fixture.paths.developmentReceiptFile), false);
    assert.equal((await finalizeCandidate(fixture)).status, "development-provider-ready-for-integration");
  });
}

await testStatusProgression();
await testPrepareAtomicityIdempotencyAndDrift();
await testPrepareLockAndFencing();
await testExplicitStaleLockRecovery();
await testRunClaimFirstReceiptAndNoRetry();
await testClaimOnlyIsIndeterminateAndNeverReruns();
await testRunFailureClassificationAndReceiptIdentity();
await testMaterializeAcceptsUpdateCreateAndFrontend();
await testMaterializeRejectsUnauthorizedAndMismatchedDeclarations();
await testMaterializeRejectsUnsupportedChangesAndPollution();
await testMaterializeRejectsNestedGitLinksAndTotalLimit();
await testSandboxedTestExecutor();
await testSandboxedTestRejectsOutsideWrite();
await testFixedTestAdapterSelection();
await testCandidateIntegrityBeforeAndAfterTest();
await testTrustedToolchainAndDependencySnapshot();
await testFixedTestResultsAndReceiptReplay();
await testFinalizePrerequisitesTimingResultReceiptAndReplay();
console.log("development-provider-runtime tests passed");
