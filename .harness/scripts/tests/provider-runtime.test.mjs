import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  inspectProvider,
  materializeProvider,
  prepareProvider,
  providerPaths,
  runProvider,
} from "../lib/provider-runtime.mjs";

const execFileAsync = promisify(execFile);
const NOW = "2026-08-19T06:00:00.000Z";
const LATER = "2026-08-19T06:05:00.000Z";
const DISPATCH_ID = "60000000-0000-4000-8000-000000000006";

async function git(root, ...args) {
  return execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 12 * 1024 * 1024,
  });
}

async function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

async function writeJson(root, relativePath, value) {
  return write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function fileHash(root, relativePath) {
  return `sha256:${createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex")}`;
}

function task(storyId) {
  const attemptRoot = `.harness/runs/${storyId}/phases/05-code-review/attempts/${DISPATCH_ID}`;
  return {
    schemaVersion: "2.0",
    dispatchId: DISPATCH_ID,
    storyId,
    runId: storyId,
    phase: "code-review",
    ownerAgent: "code-reviewer",
    purpose: "Review code changes and emit findings without modifying files.",
    preparedRevision: 6,
    preparedAt: NOW,
    resultSchemaVersion: "2.0",
    attemptRoot,
    resultFile: `${attemptRoot}/result.json`,
    checkpointFile: `${attemptRoot}/checkpoint.json`,
    expectedOutputs: [
      `.harness/runs/${storyId}/phases/05-code-review/code-review-report.md`,
    ],
    allowedAdapters: [],
    next: "build-publish",
  };
}

function state(storyId, baselineHead) {
  return {
    schemaVersion: "2.0",
    storyId,
    phase: "code-review",
    runtime: {
      runId: storyId,
      workflow: ".harness/workflows/e2e-development-v2.yaml",
      workflowVersion: "2.0",
      status: "active",
      revision: 6,
      previousPhase: "unit-test",
      activeBlock: null,
      records: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
    baseline: {
      head: baselineHead,
      branch: "dev",
      initialDirtyPaths: [],
      capturedAt: NOW,
    },
    requirement: {
      summary: "Provider fixture",
      openQuestions: [],
      acceptanceCriteria: [
        {
          criterionId: "AC-PROVIDER",
          description: "Provider review succeeds.",
          source: "fixture",
          required: true,
        },
      ],
      inScope: ["Provider"],
      outOfScope: [],
    },
    acceptance: {
      criteria: [
        {
          criterionId: "AC-PROVIDER",
          required: true,
          taskIds: ["T-PROVIDER"],
          testCaseIds: ["TC-PROVIDER"],
          verificationCaseIds: [],
          status: "pending",
          approvalIds: [],
        },
      ],
    },
    knowledge: {
      areas: [
        {
          area: "common",
          relevant: true,
          observedStatus: "fresh",
          status: "fresh",
          sourceFingerprint: `sha256:${"1".repeat(64)}`,
          loadedFiles: [],
          missing: [],
          checkedAt: NOW,
          freshnessEvidencePath: `.harness/runs/${storyId}/knowledge/common.json`,
          freshnessEvidenceSha256: `sha256:${"2".repeat(64)}`,
          refreshTaskPath: null,
          refreshTaskSha256: null,
          refreshReceiptPath: null,
          refreshReceiptSha256: null,
          approvalId: null,
        },
      ],
    },
    design: {
      decisions: [
        {
          decisionId: "TD-PROVIDER",
          summary: "Use read-only codex-cli.",
          rationale: "Fixture.",
        },
      ],
      affectedAreas: ["common"],
      risks: [],
    },
    dag: {
      schemaVersion: "2.0",
      sourceFile: `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`,
      sourceSha256: null,
      nodes: [
        {
          taskId: "T-PROVIDER",
          title: "Implement provider",
          type: "integration",
          status: "done",
          ownerAgent: "backend-developer",
          predictedFiles: [".harness/scripts/lib/changed.mjs"],
          criterionIds: ["AC-PROVIDER"],
        },
      ],
      edges: [],
      waves: [["T-PROVIDER"]],
      globalChanges: [],
      risks: [],
    },
    implementation: {
      method: "tdd",
      exceptionReason: null,
      actualFiles: [".harness/scripts/lib/changed.mjs"],
      completedTaskIds: ["T-PROVIDER"],
      notes: [],
    },
    tests: {
      cases: [
        {
          caseId: "TC-PROVIDER",
          type: "harness",
          required: true,
          criterionIds: ["AC-PROVIDER"],
          description: "Provider fixture tests.",
        },
      ],
      commands: [],
      results: [
        {
          caseId: "TC-PROVIDER",
          status: "passed",
          actual: "Fixture passed.",
          evidencePath: `.harness/runs/${storyId}/phases/04-unit-test/test-report.md`,
          evidenceSha256: `sha256:${"3".repeat(64)}`,
          executedAt: NOW,
        },
      ],
    },
    review: {
      findings: [],
      status: "pending",
    },
    build: {
      results: [],
      artifacts: [],
      externalActions: [],
    },
    verification: {
      cases: [],
      results: [],
      environment: {
        status: "not-checked",
        summary: "",
        evidencePath: null,
        evidenceSha256: null,
      },
    },
    delivery: {
      status: "pending",
      ownedFiles: [],
      outOfPredictionFiles: [],
      unrelatedDirtyFiles: [],
      remainingRisks: [],
      summaryFile: null,
      summarySha256: null,
      ownedManifestFile: null,
      ownedManifestSha256: null,
      gitStatus: "not-requested",
    },
    approvals: [],
    worktrees: [],
    logs: [],
  };
}

async function createFixture(storyId = `M8-A-PROVIDER-${randomUUID().slice(0, 8)}`) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-provider-runtime-"));
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "provider-runtime@example.test");
  await git(root, "config", "user.name", "Provider Runtime Test");
  await write(root, "AGENTS.md", "# Rules\n");
  await write(root, ".codex/skills/frontier-code-review-gate/SKILL.md", "# Review skill\n");
  await write(
    root,
    ".codex/skills/frontier-code-review-gate/references/review-checklist.md",
    "# Checklist\n",
  );
  await write(
    root,
    ".codex/agents/agents.yaml",
    [
      'schema_version: "1.0"',
      "agents:",
      "  - name: code-reviewer",
      "    category: review",
      "",
    ].join("\n"),
  );
  await writeJson(root, ".codex/agents/worker-policies.json", {
    schemaVersion: "1.0",
    roles: [
      {
        name: "code-reviewer",
        category: "review",
        readPathPrefixes: [
          "AGENTS.md",
          ".harness/",
          ".codex/skills/",
        ],
        writePathPrefixes: [
          ".harness/runs/",
        ],
        capabilities: [
          "phase-output",
        ],
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
      },
      explicit: {
        adapter: "codex-cli",
        model: "fixture-model",
        modelProvider: {
          id: "custom",
          baseUrl: "https://coding.example.test",
          wireApi: "responses",
          requiresOpenAiAuth: true,
        },
      },
    },
    roleBindings: {
      "code-reviewer": "codex-default",
    },
  });
  await write(root, ".harness/schemas/agent-provider-response.schema.json", '{"type":"object"}\n');
  await write(root, ".harness/scripts/lib/changed.mjs", "export const value = 1;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture baseline");
  const baselineHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  await write(root, ".harness/scripts/lib/changed.mjs", "export const value = 2;\n");

  const preparedTask = task(storyId);
  const preparedState = state(storyId, baselineHead);
  const dag = {
    schemaVersion: "2.0",
    storyId,
    nodes: preparedState.dag.nodes.map((node) => ({ ...node, status: "pending" })),
    edges: [],
    waves: [["T-PROVIDER"]],
    globalChanges: [],
    risks: [],
  };
  await writeJson(root, preparedState.dag.sourceFile, dag);
  preparedState.dag.sourceSha256 = await fileHash(root, preparedState.dag.sourceFile);
  const stateFile = `.harness/states/e2e-${storyId}.json`;
  await writeJson(root, stateFile, preparedState);
  await writeJson(root, ".harness/states/active-run.json", {
    schemaVersion: "1.0",
    runId: storyId,
    stateFile,
    status: "active",
    revision: 6,
    updatedAt: NOW,
  });
  await write(root, `.harness/states/e2e-${storyId}.events.jsonl`, "");
  await writeJson(root, preparedTask.attemptRoot + "/task.json", preparedTask);
  await writeJson(root, preparedTask.checkpointFile, {
    schemaVersion: "1.0",
    dispatchId: DISPATCH_ID,
    storyId,
    phase: "code-review",
    status: "prepared",
    preparedAt: NOW,
    updatedAt: NOW,
  });
  await writeJson(
    root,
    `.harness/runs/${storyId}/phases/05-code-review/active-attempt.json`,
    {
      schemaVersion: "1.0",
      dispatchId: DISPATCH_ID,
      attemptRoot: preparedTask.attemptRoot,
      taskFile: `${preparedTask.attemptRoot}/task.json`,
      resultFile: preparedTask.resultFile,
      checkpointFile: preparedTask.checkpointFile,
      preparedRevision: 6,
      status: "prepared",
      updatedAt: NOW,
    },
  );
  await write(root, `.harness/runs/${storyId}/phases/04-unit-test/test-report.md`, "# Tests passed\n");
  return {
    root,
    storyId,
    stateFile,
    state: preparedState,
    task: preparedTask,
    paths: providerPaths(preparedTask),
  };
}

async function withFixture(run) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

function responseFor(request, findings = []) {
  return {
    schemaVersion: "1.0",
    providerRequestId: request.providerRequestId,
    dispatchId: request.dispatchId,
    storyId: request.storyId,
    runId: request.runId,
    phase: "code-review",
    role: "code-reviewer",
    status: "completed",
    summary: findings.length ? "Review found issues." : "Review passed.",
    findings,
    diagnostics: [],
    usage: {
      reportedModel: null,
      inputTokens: 100,
      outputTokens: 50,
    },
  };
}

function successfulAdapter(response, hooks = {}) {
  let calls = 0;
  const adapter = async (input) => {
    calls += 1;
    await hooks.beforeReturn?.(input);
    return {
      adapter: "codex-cli",
      adapterVersion: "codex-cli/test",
      executablePath: path.resolve("C:/fixture/codex.exe"),
      requestedModel: input.model,
      reportedModel: response.usage.reportedModel,
      startedAt: NOW,
      finishedAt: NOW,
      exitCode: 0,
      status: "completed",
      response,
      rawEvents: [
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify(response),
          },
        },
      ],
      stdout: Buffer.from("event\n"),
      stderr: Buffer.alloc(0),
      diagnostics: [],
      isolatedIntegrity: {
        beforeSha256: `sha256:${"4".repeat(64)}`,
        afterSha256: `sha256:${"4".repeat(64)}`,
        status: "passed",
      },
      isolatedRoot: null,
    };
  };
  adapter.calls = () => calls;
  return adapter;
}

async function prepare(fixture, options = {}) {
  return prepareProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    now: () => NOW,
    ...options,
  });
}

async function testStatusAndPrepare() {
  await withFixture(async (fixture) => {
    assert.equal((await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    })).status, "provider-not-prepared");

    let prepareLockTimeoutMs = null;
    const prepared = await prepare(fixture, {
      profile: "explicit",
      model: "runtime-model",
      afterContextManifestWrite: async () => {
        prepareLockTimeoutMs = (await readJson(fixture.root, fixture.paths.lockFile)).timeoutMs;
      },
    });
    assert.equal(prepared.status, "provider-ready");
    assert.equal(prepared.prepared, true);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    assert.equal(request.profile, "explicit");
    assert.equal(request.requestedModel, "runtime-model");
    assert.equal(request.modelSource, "runtime-override");
    assert.deepEqual(request.modelProvider, {
      id: "custom",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    });
    assert.match(request.configSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(request.outputSchemaFile, ".harness/schemas/agent-provider-response.schema.json");
    assert.match(request.outputSchemaSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(request.promptTemplateSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(prepareLockTimeoutMs, 30_000);

    const repeated = await prepare(fixture);
    assert.equal(repeated.prepared, false);
    assert.equal(repeated.providerRequestId, request.providerRequestId);

    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        profile: "codex-default",
        now: () => NOW,
      }),
      /already prepared.*override|cannot change/i,
    );

    const changedConfig = await readJson(fixture.root, ".harness/config/agent-providers.json");
    changedConfig.profiles.explicit.model = "drifted-model";
    await writeJson(fixture.root, ".harness/config/agent-providers.json", changedConfig);
    assert.equal((await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    })).status, "provider-invalid");
  });
}

async function testPrepareRejectsModelProviderDrift() {
  await withFixture(async (fixture) => {
    await prepare(fixture, { profile: "explicit" });
    const changedConfig = await readJson(fixture.root, ".harness/config/agent-providers.json");
    changedConfig.profiles.explicit.modelProvider.baseUrl = "https://changed.example.test";
    await writeJson(fixture.root, ".harness/config/agent-providers.json", changedConfig);
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    assert.match(status.diagnostics.join("\n"), /config hash drifted/i);
  });
}

async function testPrepareFreezesEqualValueRuntimeModelSource() {
  await withFixture(async (fixture) => {
    await prepare(fixture, {
      profile: "explicit",
      model: "fixture-model",
    });
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    assert.equal(request.requestedModel, "fixture-model");
    assert.equal(request.modelSource, "runtime-override");
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter: successfulAdapter(responseFor(request)),
      now: () => NOW,
    });
    const receipt = await readJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${ran.providerExecutionId}/execution-receipt.json`,
    );
    assert.equal(receipt.requestedModel, "fixture-model");
    assert.equal(receipt.resolvedModel, "fixture-model");
    assert.equal(receipt.modelSource, "runtime-override");
  });
}

async function testPreparedRequestBindingRejectsRuntimeOverrideDrift() {
  await withFixture(async (fixture) => {
    await prepare(fixture, {
      profile: "explicit",
      model: "runtime-model",
    });
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    request.providerRequestId = randomUUID();
    request.requestedModel = "drifted-runtime-model";
    await writeJson(fixture.root, fixture.paths.requestFile, request);

    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    assert.match(status.diagnostics.join("\n"), /request.*hash|binding.*drift/i);
  });

  for (const mutate of [
    (binding) => { binding.unexpected = true; },
    (binding) => { binding.createdAt = "2026-08-19T05:59:59.000Z"; },
  ]) {
    await withFixture(async (fixture) => {
      await prepare(fixture);
      const binding = await readJson(fixture.root, fixture.paths.requestBindingFile);
      mutate(binding);
      await writeJson(fixture.root, fixture.paths.requestBindingFile, binding);
      const status = await inspectProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
      });
      assert.equal(status.status, "provider-invalid");
      assert.match(status.diagnostics.join("\n"), /request binding|createdAt|unknown field/i);
    });
  }
}

async function testPreparedRequestCommitInterruptionRecovery() {
  await withFixture(async (fixture) => {
    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        beforePreparedRename: async () => {
          throw new Error("fixture prepared request commit interruption");
        },
      }),
      /prepared request commit interruption/i,
    );
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.requestFile), false);

    const recovered = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(recovered.status, "provider-ready");
    assert.equal(recovered.prepared, true);
  });
}

async function testRunPromptIncludesFrozenProviderRequestIdentity() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    let observedPrompt = null;
    const adapter = successfulAdapter(responseFor(request), {
      beforeReturn: async (input) => {
        observedPrompt = input.prompt;
      },
    });
    await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    assert.match(observedPrompt, new RegExp(request.providerRequestId));
  });
}

async function testExecutionReceiptRejectsRoutingDrift() {
  await withFixture(async (fixture) => {
    await runSuccessfulExecution(fixture);
    const executionIds = await (await import("node:fs/promises")).readdir(
      path.join(fixture.root, fixture.paths.executionsRoot),
    );
    assert.equal(executionIds.length, 1);
    const receiptPath = `${fixture.paths.executionsRoot}/${executionIds[0]}/execution-receipt.json`;
    const original = await readJson(fixture.root, receiptPath);
    const mutations = [
      [(receipt) => {
        receipt.modelProvider = {
          id: "custom",
          baseUrl: "https://changed.example.test",
          wireApi: "responses",
          requiresOpenAiAuth: true,
        };
      }, /receipt.*frozen request|routing.*drift/i],
      [(receipt) => { receipt.configSha256 = `sha256:${"b".repeat(64)}`; }, /receipt.*frozen request/i],
      [(receipt) => { receipt.requestedModel = "changed-model"; }, /receipt.*frozen request/i],
      [(receipt) => { receipt.resolvedModel = "changed-model"; }, /receipt.*frozen request/i],
      [(receipt) => { receipt.profile = "changed-profile"; }, /receipt.*frozen request/i],
      [(receipt) => { receipt.adapter = "codex-cli-changed"; }, /adapter.*codex-cli/i],
      [(receipt) => { receipt.modelSource = "runtime-override"; }, /receipt.*frozen request/i],
      [(receipt) => { receipt.promptTemplateVersion = "2.0"; }, /receipt.*frozen request/i],
      [(receipt) => { receipt.promptTemplateSha256 = `sha256:${"b".repeat(64)}`; }, /receipt.*frozen request/i],
    ];
    for (const [mutate, expectedDiagnostic] of mutations) {
      const changed = structuredClone(original);
      mutate(changed);
      await writeJson(fixture.root, receiptPath, changed);
      const status = await inspectProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
      });
      assert.equal(status.status, "provider-invalid");
      assert.match(status.diagnostics.join("\n"), expectedDiagnostic);
    }
  });

  await withFixture(async (fixture) => {
    await runSuccessfulExecution(fixture);
    const executionIds = await (await import("node:fs/promises")).readdir(
      path.join(fixture.root, fixture.paths.executionsRoot),
    );
    const executionRoot = `${fixture.paths.executionsRoot}/${executionIds[0]}`;
    const responsePath = `${executionRoot}/raw-response.json`;
    const receiptPath = `${executionRoot}/execution-receipt.json`;
    const response = await readJson(fixture.root, responsePath);
    response.providerRequestId = randomUUID();
    await writeJson(fixture.root, responsePath, response);
    const receipt = await readJson(fixture.root, receiptPath);
    receipt.responseSha256 = await fileHash(fixture.root, responsePath);
    await writeJson(fixture.root, receiptPath, receipt);

    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    assert.match(status.diagnostics.join("\n"), /response identity.*frozen request|response.*request/i);
  });
}

async function testPrepareRecoversAfterContextManifestInterruption() {
  await withFixture(async (fixture) => {
    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        afterContextManifestWrite: async () => {
          throw new Error("fixture context manifest interruption");
        },
      }),
      /context manifest interruption/i,
    );
    assert.equal((await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    })).status, "provider-not-prepared");

    const recovered = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => "2026-08-19T06:00:00.000Z",
    });
    assert.equal(recovered.status, "provider-ready");
    assert.equal(recovered.prepared, true);
    const manifest = await readJson(fixture.root, fixture.paths.contextManifestFile);
    assert.equal(manifest.createdAt, fixture.task.preparedAt);
  });
}

async function testLockRecoveryAndLiveChildProtection() {
  await withFixture(async (fixture) => {
    const stale = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      dispatchId: DISPATCH_ID,
      providerRequestId: null,
      command: "prepare",
      parentPid: 111,
      childPid: null,
      providerExecutionId: null,
      startedAt: "2026-08-19T00:00:00.000Z",
      timeoutMs: 1_000,
    };
    await writeJson(fixture.root, fixture.paths.lockFile, stale);
    const recovered = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => "2026-08-19T06:00:00.000Z",
      processExists: () => false,
    });
    assert.equal(recovered.status, "provider-ready");
    assert.equal(await readFile(path.join(fixture.root, fixture.paths.lockRecoveryFile), "utf8")
      .then((text) => text.includes(stale.lockId)), true);
  });

  await withFixture(async (fixture) => {
    const lock = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      dispatchId: DISPATCH_ID,
      providerRequestId: null,
      command: "run",
      parentPid: 111,
      childPid: 222,
      providerExecutionId: randomUUID(),
      startedAt: "2026-08-19T00:00:00.000Z",
      timeoutMs: 1_000,
    };
    await writeJson(fixture.root, fixture.paths.lockFile, lock);
    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => "2026-08-19T06:00:00.000Z",
        processExists: (pid) => pid === 222,
      }),
      /still active.*child|child.*alive|run-in-progress/i,
    );
  });
}

async function testLockMutationGuardFencesRecoveryAndRelease() {
  await withFixture(async (fixture) => {
    const stale = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      dispatchId: DISPATCH_ID,
      providerRequestId: null,
      command: "prepare",
      parentPid: 111,
      childPid: null,
      providerExecutionId: null,
      startedAt: "2026-08-19T05:00:00.000Z",
      timeoutMs: 1,
    };
    await writeJson(fixture.root, fixture.paths.lockFile, stale);
    await writeJson(fixture.root, `${fixture.paths.mutationLockFile}/owner.json`, {
      schemaVersion: "1.0",
      mutationId: randomUUID(),
      parentPid: process.pid,
      startedAt: NOW,
      timeoutMs: 30_000,
    });

    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        processExists: () => false,
      }),
      /mutation.*lock|lock.*mutation/i,
    );
    assert.deepEqual(await readJson(fixture.root, fixture.paths.lockFile), stale);
  });

  await withFixture(async (fixture) => {
    const stale = {
      schemaVersion: "1.0",
      lockId: randomUUID(),
      dispatchId: DISPATCH_ID,
      providerRequestId: null,
      command: "prepare",
      parentPid: 111,
      childPid: null,
      providerExecutionId: null,
      startedAt: "2026-08-19T05:00:00.000Z",
      timeoutMs: 1,
    };
    await writeJson(fixture.root, fixture.paths.lockFile, stale);
    await writeJson(fixture.root, `${fixture.paths.mutationLockFile}/owner.json`, {
      schemaVersion: "1.0",
      mutationId: randomUUID(),
      parentPid: 2147483647,
      startedAt: "2026-08-19T05:00:00.000Z",
      timeoutMs: 1,
    });

    const recovered = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
      processExists: () => false,
    });
    assert.equal(recovered.status, "provider-ready");
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.mutationLockFile), false);
  });

  await withFixture(async (fixture) => {
    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        afterContextManifestWrite: async () => {
          await writeJson(fixture.root, `${fixture.paths.mutationLockFile}/owner.json`, {
            schemaVersion: "1.0",
            mutationId: randomUUID(),
            parentPid: process.pid,
            startedAt: NOW,
            timeoutMs: 30_000,
          });
        },
      }),
      /mutation.*lock|lock.*mutation/i,
    );
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.lockFile), true);

    await rm(path.join(fixture.root, fixture.paths.mutationLockFile), {
      recursive: true,
      force: true,
    });
    await rm(path.join(fixture.root, fixture.paths.lockFile));
    const prepared = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(prepared.status, "provider-ready");
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.lockFile), false);
  });

  await withFixture(async (fixture) => {
    const prepared = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
      afterContextManifestWrite: async () => {
        await writeJson(fixture.root, `${fixture.paths.mutationLockFile}/owner.json`, {
          schemaVersion: "1.0",
          mutationId: randomUUID(),
          parentPid: 2147483647,
          startedAt: "2026-08-19T05:00:00.000Z",
          timeoutMs: 1,
        });
      },
    });
    assert.equal(prepared.status, "provider-ready");
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.lockFile), false);
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.mutationLockFile), false);
  });

  await withFixture(async (fixture) => {
    await write(
      fixture.root,
      `${fixture.paths.mutationLockFile}/owner.json`,
      '{"schemaVersion":"1.0","mutationId":',
    );
    await assert.rejects(
      prepareProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        processExists: () => false,
      }),
      /mutation.*guard|invalid json|not stale/i,
    );
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.mutationLockFile), true);
  });

  await withFixture(async (fixture) => {
    await write(
      fixture.root,
      `${fixture.paths.mutationLockFile}/owner.json`,
      '{"schemaVersion":"1.0","mutationId":',
    );
    const guardPath = path.join(fixture.root, fixture.paths.mutationLockFile);
    await utimes(guardPath, new Date("2026-08-19T05:00:00.000Z"), new Date("2026-08-19T05:00:00.000Z"));
    const recovered = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
      processExists: () => false,
    });
    assert.equal(recovered.status, "provider-ready");
    assert.equal(await pathExistsForTest(fixture.root, fixture.paths.mutationLockFile), false);
  });

  await withFixture(async (fixture) => {
    await write(
      fixture.root,
      `${fixture.paths.mutationLockFile}.tmp-orphan/owner.json`,
      '{"schemaVersion":"1.0","mutationId":',
    );
    const prepared = await prepareProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(prepared.status, "provider-ready");
  });
}

async function pathExistsForTest(root, relativePath) {
  return lstat(path.join(root, relativePath)).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function testRunSuccessFailureAndZeroContamination() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    let observedTimeoutMs = null;
    const adapter = successfulAdapter(responseFor(request), {
      beforeReturn: async (input) => {
        observedTimeoutMs = input.timeoutMs;
        await input.onSpawn(4242);
        const executionIds = await (await import("node:fs/promises")).readdir(
          path.join(fixture.root, fixture.paths.executionsRoot),
        );
        assert.equal(executionIds.length, 1);
        assert.equal(
          await pathExistsForTest(
            fixture.root,
            `${fixture.paths.executionsRoot}/${executionIds[0]}/execution-claim.json`,
          ),
          true,
        );
        assert.equal(
          (await readJson(fixture.root, fixture.paths.lockFile)).timeoutMs,
          180_000,
        );
      },
    });
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-materialize-required");
    assert.equal(observedTimeoutMs, 180_000);
    const receipt = await readJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${ran.providerExecutionId}/execution-receipt.json`,
    );
    assert.equal(receipt.readIsolation, "same-os-user-readonly-sandbox");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const adapter = successfulAdapter(responseFor(request));
    const before = {
      state: await readFile(path.join(fixture.root, fixture.stateFile)),
      pointer: await readFile(path.join(fixture.root, ".harness/states/active-run.json")),
      events: await readFile(path.join(fixture.root, `.harness/states/e2e-${fixture.storyId}.events.jsonl`)),
    };
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-materialize-required");
    assert.equal(adapter.calls(), 1);
    assert.equal((await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    })).status, "provider-materialize-required");
    assert.deepEqual(await readFile(path.join(fixture.root, fixture.stateFile)), before.state);
    assert.deepEqual(await readFile(path.join(fixture.root, ".harness/states/active-run.json")), before.pointer);
    assert.deepEqual(
      await readFile(path.join(fixture.root, `.harness/states/e2e-${fixture.storyId}.events.jsonl`)),
      before.events,
    );
    await assert.rejects(
      runProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        adapter,
        now: () => NOW,
      }),
      /materialize|required|successful execution/i,
    );
    assert.equal(adapter.calls(), 1);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const failedAdapter = successfulAdapter(responseFor(request));
    const wrapper = async (input) => ({
      ...(await failedAdapter(input)),
      status: "timed-out",
      response: null,
      exitCode: null,
      diagnostics: ["fixture timeout"],
    });
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter: wrapper,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    assert.equal(await readFile(path.join(fixture.root, fixture.task.resultFile)).then(
      () => true,
      (error) => error.code !== "ENOENT",
    ), false);
    assert.equal(await readFile(path.join(fixture.root, fixture.task.expectedOutputs[0])).then(
      () => true,
      (error) => error.code !== "ENOENT",
    ), false);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const secret = "fixture-response-secret";
    const secondSecret = "fixture-second-secret";
    const jsonSecret = "fixture-json-secret";
    const failedResponse = responseFor(request);
    failedResponse.status = "failed";
    failedResponse.summary = "Reviewer could not complete the review.";
    failedResponse.diagnostics = [
      `OPENAI_API_KEY="${secret}"`,
      `OPENAI_API_KEY="${secondSecret}"`,
      JSON.stringify({ token: jsonSecret }),
    ];
    const adapter = successfulAdapter(failedResponse);
    const adapterWithStructuredSecrets = async (input) => ({
      ...(await adapter(input)),
      rawEvents: [
        { type: "tool.output", token: jsonSecret },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify(failedResponse),
          },
        },
      ],
    });
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter: adapterWithStructuredSecrets,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    assert.equal(ran.latestExecutionStatus, "failed");
    assert.equal(ran.diagnostics.join("\n").includes(secret), false);
    assert.equal(ran.diagnostics.join("\n").includes(secondSecret), false);
    assert.equal(ran.diagnostics.join("\n").includes(jsonSecret), false);
    await assert.rejects(
      materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
      }),
      /not allowed|provider-failed/i,
    );
    assert.equal(await readFile(path.join(fixture.root, fixture.task.resultFile)).then(
      () => true,
      (error) => error.code !== "ENOENT",
    ), false);
    const receipt = await readJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${ran.providerExecutionId}/execution-receipt.json`,
    );
    const rawResponse = await readFile(path.join(fixture.root, receipt.responseFile), "utf8");
    const rawEvents = await readFile(
      path.join(fixture.root, `${fixture.paths.executionsRoot}/${ran.providerExecutionId}/raw-events.jsonl`),
      "utf8",
    );
    assert.equal(rawResponse.includes(secret), false);
    assert.equal(rawResponse.includes(secondSecret), false);
    assert.equal(rawResponse.includes(jsonSecret), false);
    assert.equal(rawEvents.includes(secret), false);
    assert.equal(rawEvents.includes(secondSecret), false);
    assert.equal(rawEvents.includes(jsonSecret), false);
    assert.match(rawResponse, /REDACTED/);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const secret = "fixture-adapter-secret";
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter: async () => {
        throw new Error(`fixture adapter spawn failure TOKEN=${secret}`);
      },
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    assert.equal(ran.latestExecutionStatus, "failed");
    assert.match(ran.diagnostics.join("\n"), /adapter.*spawn failure/i);
    assert.equal(ran.diagnostics.join("\n").includes(secret), false);
    const receipt = await readJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${ran.providerExecutionId}/execution-receipt.json`,
    );
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.responseFile, null);
    assert.equal(receipt.integrityChecks[1].status, "not-applicable");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter: async (input) => {
        await input.onSpawn(undefined);
        throw new Error("fixture adapter published an invalid child PID");
      },
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    assert.equal(ran.latestExecutionStatus, "failed");
    assert.match(ran.diagnostics.join("\n"), /lock.*invalid|childPid|positive integer/i);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const sharedFinding = {
      severity: "WARNING",
      status: "open",
      summary: "Credential exposure.",
      file: ".harness/scripts/lib/changed.mjs",
      line: 1,
      rationale: "Credentials must not be persisted.",
    };
    const response = responseFor(request, [
      {
        ...sharedFinding,
        findingId: "F-001",
        evidenceText: "TOKEN=fixture-first-secret",
      },
      {
        ...sharedFinding,
        findingId: "F-002",
        evidenceText: "TOKEN=fixture-second-secret",
      },
    ]);
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter: successfulAdapter(response),
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    assert.equal(ran.latestExecutionStatus, "invalid-response");
    assert.match(ran.diagnostics.join("\n"), /sanitized.*finding.*identity|duplicate.*finding/i);
  });

  for (const invalidResponse of [
    (request) => ({ ...responseFor(request), unexpected: "not allowed" }),
    () => "primitive response",
    (request) => ({ ...responseFor(request), diagnostics: "not-an-array" }),
  ]) {
    await withFixture(async (fixture) => {
      await prepare(fixture);
      const request = await readJson(fixture.root, fixture.paths.requestFile);
      const response = invalidResponse(request);
      const baseAdapter = successfulAdapter(responseFor(request));
      const adapter = async (input) => ({
        ...(await baseAdapter(input)),
        response,
        reportedModel: null,
        rawEvents: [{
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify(response),
          },
        }],
      });
      const ran = await runProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        adapter,
        now: () => NOW,
      });
      assert.equal(ran.status, "provider-failed");
      assert.equal(ran.latestExecutionStatus, "invalid-response");
      const receipt = await readJson(
        fixture.root,
        `${fixture.paths.executionsRoot}/${ran.providerExecutionId}/execution-receipt.json`,
      );
      assert.equal(receipt.status, "invalid-response");
      assert.equal(receipt.responseFile, null);
      assert.equal(receipt.diagnostics.length > 0, true);
    });
  }
}

async function testIntegrityViolationAndRunConcurrency() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const adapter = successfulAdapter(responseFor(request), {
      beforeReturn: async () => {
        await write(fixture.root, ".harness/scripts/lib/changed.mjs", "export const value = 3;\n");
      },
    });
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-failed");
    assert.equal(status.latestExecutionStatus, "integrity-violation");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const adapter = successfulAdapter(responseFor(request), {
      beforeReturn: async () => {
        const binding = await readJson(fixture.root, fixture.paths.requestBindingFile);
        binding.createdAt = "2026-08-19T05:59:59.000Z";
        await writeJson(fixture.root, fixture.paths.requestBindingFile, binding);
      },
    });
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-invalid");
    assert.match(ran.diagnostics.join("\n"), /request binding|createdAt/i);
    const executionIds = await (await import("node:fs/promises")).readdir(
      path.join(fixture.root, fixture.paths.executionsRoot),
    );
    const receipt = await readJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${executionIds[0]}/execution-receipt.json`,
    );
    assert.equal(receipt.status, "integrity-violation");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const adapter = successfulAdapter(responseFor(request), {
      beforeReturn: async (input) => {
        await input.onSpawn(4242);
        const lock = await readJson(fixture.root, fixture.paths.lockFile);
        lock.timeoutMs = 1;
        await writeJson(fixture.root, fixture.paths.lockFile, lock);
      },
    });
    const ran = await runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    assert.equal(ran.status, "provider-failed");
    assert.equal(ran.latestExecutionStatus, "integrity-violation");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const adapter = successfulAdapter(responseFor(request), {
      beforeReturn: async () => gate,
    });
    const first = runProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      adapter,
      now: () => NOW,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      processExists: () => true,
    })).status, "provider-run-in-progress");
    await assert.rejects(
      runProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        adapter,
        now: () => NOW,
        processExists: () => true,
      }),
      /lock|run-in-progress|active/i,
    );
    release();
    await first;
  });
}

async function testExecutionClaimMaterializesIndeterminateBlockWithoutRetry() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const providerExecutionId = randomUUID();
    const claimFile = `${fixture.paths.executionsRoot}/${providerExecutionId}/execution-claim.json`;
    await writeJson(
      fixture.root,
      claimFile,
      {
        schemaVersion: "1.0",
        providerExecutionId,
        providerRequestId: request.providerRequestId,
        dispatchId: request.dispatchId,
        storyId: request.storyId,
        runId: request.runId,
        phase: "code-review",
        role: "code-reviewer",
        claimedAt: NOW,
      },
    );
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-execution-indeterminate");
    assert.equal(status.providerExecutionId, providerExecutionId);
    assert.equal(status.claimFile, claimFile);
    assert.match(status.diagnostics.join("\n"), /indeterminate|claim.*receipt/i);

    const adapter = successfulAdapter(responseFor(request));
    await assert.rejects(
      runProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        adapter,
        now: () => NOW,
      }),
      /not allowed|indeterminate/i,
    );
    assert.equal(adapter.calls(), 0);

    const materialized = await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(materialized.status, "provider-materialized");
    assert.equal(adapter.calls(), 0);

    const result = await readJson(fixture.root, fixture.task.resultFile);
    assert.equal(result.status, "blocked");
    assert.equal(result.outputs.length, 0);
    assert.equal(result.payload.status, "blocked");
    assert.equal(result.payload.findings.length, 1);
    assert.equal(result.payload.findings[0].severity, "BLOCKER");
    assert.equal(result.payload.findings[0].file, null);
    assert.match(result.payload.findings[0].summary, /execution outcome is indeterminate/i);
    assert.match(result.blocker.reason, /execution outcome is indeterminate/i);
    assert.equal(result.records[0].status, "BLOCKER");

    const evidenceFile = `${fixture.task.attemptRoot}/evidence/provider-execution-indeterminate.json`;
    assert.equal(result.records[0].path, evidenceFile);
    const evidence = await readJson(fixture.root, evidenceFile);
    assert.equal(evidence.providerExecutionId, providerExecutionId);
    assert.equal(evidence.providerRequestId, request.providerRequestId);
    assert.equal(evidence.claimFile, claimFile);
    assert.equal(evidence.claimSha256, await fileHash(fixture.root, claimFile));
    assert.equal(evidence.receiptFile,
      `${fixture.paths.executionsRoot}/${providerExecutionId}/execution-receipt.json`);
    assert.equal(evidence.receiptStatus, "missing");
    assert.equal(evidence.liveProcessStatus, "not-detected");
    assert.match(evidence.conclusion, /cannot determine whether the model received the request/i);

    assert.equal(await pathExistsForTest(
      fixture.root,
      `${fixture.paths.executionsRoot}/${providerExecutionId}/execution-receipt.json`,
    ), false);
    assert.equal(await pathExistsForTest(
      fixture.root,
      `${fixture.paths.executionsRoot}/${providerExecutionId}/raw-response.json`,
    ), false);
    assert.equal(await pathExistsForTest(
      fixture.root,
      fixture.task.expectedOutputs[0],
    ), false);

    const repeated = await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(repeated.status, "provider-materialized");
    assert.equal(repeated.materialized, false);
    assert.equal(adapter.calls(), 0);
  });
}

async function testIndeterminateMaterializeRecoveryAndClaimDrift() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const providerExecutionId = randomUUID();
    await writeJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${providerExecutionId}/execution-claim.json`,
      {
        schemaVersion: "1.0",
        providerExecutionId,
        providerRequestId: request.providerRequestId,
        dispatchId: request.dispatchId,
        storyId: request.storyId,
        runId: request.runId,
        phase: "code-review",
        role: "code-reviewer",
        claimedAt: NOW,
      },
    );

    await assert.rejects(
      materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        beforeResultRename: async () => {
          throw new Error("fixture indeterminate materialize interruption");
        },
      }),
      /indeterminate materialize interruption/i,
    );
    assert.equal(await pathExistsForTest(fixture.root, fixture.task.resultFile), false);
    assert.equal((await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    })).status, "provider-execution-indeterminate");

    const recovered = await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => LATER,
    });
    assert.equal(recovered.status, "provider-materialized");
    assert.equal((await readJson(fixture.root, fixture.task.resultFile)).status, "blocked");
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const providerExecutionId = randomUUID();
    const claimFile = `${fixture.paths.executionsRoot}/${providerExecutionId}/execution-claim.json`;
    const claim = {
      schemaVersion: "1.0",
      providerExecutionId,
      providerRequestId: request.providerRequestId,
      dispatchId: request.dispatchId,
      storyId: request.storyId,
      runId: request.runId,
      phase: "code-review",
      role: "code-reviewer",
      claimedAt: NOW,
    };
    await writeJson(fixture.root, claimFile, claim);

    await assert.rejects(
      materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
        beforeResultRename: async () => {
          await writeJson(fixture.root, claimFile, {
            ...claim,
            claimedAt: LATER,
          });
        },
      }),
      /claim.*drift|snapshot.*changed|immutable/i,
    );
    assert.equal(await pathExistsForTest(fixture.root, fixture.task.resultFile), false);
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    assert.match(status.diagnostics.join("\n"), /claim drifted/i);
  });

  await withFixture(async (fixture) => {
    await prepare(fixture);
    const request = await readJson(fixture.root, fixture.paths.requestFile);
    const providerExecutionId = randomUUID();
    await writeJson(
      fixture.root,
      `${fixture.paths.executionsRoot}/${providerExecutionId}/execution-claim.json`,
      {
        schemaVersion: "1.0",
        providerExecutionId,
        providerRequestId: randomUUID(),
        dispatchId: request.dispatchId,
        storyId: request.storyId,
        runId: request.runId,
        phase: "code-review",
        role: "code-reviewer",
        claimedAt: NOW,
      },
    );
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    assert.match(status.diagnostics.join("\n"), /claim drifted/i);
    await assert.rejects(
      materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
      }),
      /claim drifted|provider-invalid/i,
    );
    assert.equal(await pathExistsForTest(fixture.root, fixture.task.resultFile), false);
  });
}

async function testPreparedDirectoryCorruptionIsInvalid() {
  await withFixture(async (fixture) => {
    await prepare(fixture);
    await rm(path.join(fixture.root, fixture.paths.requestFile));
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    assert.match(status.diagnostics.join("\n"), /prepared request.*incomplete|request.*missing/i);
  });

  await withFixture(async (fixture) => {
    await runSuccessfulExecution(fixture);
    const binding = await readJson(fixture.root, fixture.paths.requestBindingFile);
    binding.unexpected = true;
    await writeJson(fixture.root, fixture.paths.requestBindingFile, binding);
    const status = await inspectProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(status.status, "provider-invalid");
    await assert.rejects(
      materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
      }),
      /request binding|provider-invalid|not allowed/i,
    );
  });
}

async function runSuccessfulExecution(fixture, findings = []) {
  await prepare(fixture);
  const request = await readJson(fixture.root, fixture.paths.requestFile);
  const adapter = successfulAdapter(responseFor(request, findings));
  await runProvider({
    root: fixture.root,
    stateFile: fixture.stateFile,
    adapter,
    now: () => NOW,
  });
  return { request, adapter };
}

async function testBlockedMaterializeDoesNotWriteFormalReport() {
  await withFixture(async (fixture) => {
    await runSuccessfulExecution(fixture, [
      {
        findingId: "F-001",
        severity: "WARNING",
        status: "open",
        summary: "Fixture warning.",
        file: ".harness/scripts/lib/changed.mjs",
        line: 1,
        evidenceText: "value changed without a guard",
        rationale: "Fixture warning must block review.",
      },
    ]);
    await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(await readFile(
      path.join(fixture.root, fixture.task.expectedOutputs[0]),
      "utf8",
    ).then(
      () => true,
      (error) => error.code !== "ENOENT",
    ), false);
  });
}

async function testMaterializeResultLastAndIdempotency() {
  await withFixture(async (fixture) => {
    const { adapter } = await runSuccessfulExecution(fixture);
    await write(fixture.root, fixture.task.expectedOutputs[0], "# Historical blocked report\n");
    let materializeLockTimeoutMs = null;
    const materialized = await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
      afterEvidenceWrite: async () => {
        materializeLockTimeoutMs = (await readJson(fixture.root, fixture.paths.lockFile)).timeoutMs;
      },
    });
    assert.equal(materialized.status, "provider-materialized");
    const result = await readJson(fixture.root, fixture.task.resultFile);
    assert.equal(result.status, "completed");
    assert.equal(result.payload.status, "passed");
    assert.equal(result.outputs[0].path, fixture.task.expectedOutputs[0]);
    assert.equal(result.outputs[0].sha256, await fileHash(fixture.root, fixture.task.expectedOutputs[0]));
    assert.equal(
      (await readFile(path.join(fixture.root, fixture.task.expectedOutputs[0]), "utf8"))
        .includes("Historical blocked report"),
      false,
    );
    assert.equal(
      result.records[0].path,
      `${fixture.task.attemptRoot}/evidence/provider-review-response.json`,
    );
    assert.equal(materializeLockTimeoutMs, 30_000);
    assert.equal(adapter.calls(), 1);
    const repeated = await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    assert.equal(repeated.materialized, false);
    assert.equal(adapter.calls(), 1);
  });

  await withFixture(async (fixture) => {
    await runSuccessfulExecution(fixture, [
      {
        findingId: "F-001",
        severity: "WARNING",
        status: "open",
        summary: "Fixture warning.",
        file: ".harness/scripts/lib/changed.mjs",
        line: 1,
        evidenceText: "value changed without a guard",
        rationale: "Fixture warning must block review.",
      },
    ]);
    await materializeProvider({
      root: fixture.root,
      stateFile: fixture.stateFile,
      now: () => NOW,
    });
    const result = await readJson(fixture.root, fixture.task.resultFile);
    assert.equal(result.status, "blocked");
    assert.equal(result.outputs.length, 0);
    assert.equal(result.payload.status, "blocked");
    assert.equal(result.payload.findings[0].severity, "WARNING");
    assert.equal(result.records[0].status, "WARNING");
    assert.equal(result.payload.findings[0].evidence,
      `${fixture.task.attemptRoot}/evidence/provider-review-response.json`);
    assert.equal(await readFile(
      path.join(fixture.root, fixture.task.expectedOutputs[0]),
      "utf8",
    ).then(
      () => true,
      (error) => error.code !== "ENOENT",
    ), false);
  });
}

async function testMaterializeInterruptionRecoveryAndUniqueExecution() {
  for (const hook of ["afterEvidenceWrite", "afterReportWrite", "beforeResultRename"]) {
    await withFixture(async (fixture) => {
      const { adapter } = await runSuccessfulExecution(fixture);
      await assert.rejects(
        materializeProvider({
          root: fixture.root,
          stateFile: fixture.stateFile,
          now: () => NOW,
          [hook]: async () => {
            throw new Error(`fixture ${hook} interruption`);
          },
        }),
        new RegExp(hook, "i"),
      );
      assert.equal((await inspectProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
      })).status, "provider-materialize-required");
      await materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
      });
      assert.equal(adapter.calls(), 1);
    });
  }

  await withFixture(async (fixture) => {
    await runSuccessfulExecution(fixture);
    const executionsRoot = path.join(fixture.root, fixture.paths.executionsRoot);
    const originalId = (await (await import("node:fs/promises")).readdir(executionsRoot))[0];
    const duplicateId = randomUUID();
    const original = path.join(executionsRoot, originalId);
    const duplicate = path.join(executionsRoot, duplicateId);
    await mkdir(duplicate, { recursive: true });
    for (const file of ["raw-events.jsonl", "raw-response.json", "diagnostics.json", "execution-receipt.json"]) {
      const content = await readFile(path.join(original, file));
      if (file === "execution-receipt.json") {
        const receipt = JSON.parse(content.toString("utf8"));
        receipt.providerExecutionId = duplicateId;
        receipt.responseFile = `${fixture.paths.executionsRoot}/${duplicateId}/raw-response.json`;
        await writeFile(path.join(duplicate, file), `${JSON.stringify(receipt, null, 2)}\n`);
      } else {
        await writeFile(path.join(duplicate, file), content);
      }
    }
    await assert.rejects(
      materializeProvider({
        root: fixture.root,
        stateFile: fixture.stateFile,
        now: () => NOW,
      }),
      /unique successful execution|multiple successful/i,
    );
  });
}

await testStatusAndPrepare();
await testPrepareRejectsModelProviderDrift();
await testRunPromptIncludesFrozenProviderRequestIdentity();
await testPrepareFreezesEqualValueRuntimeModelSource();
await testPreparedRequestBindingRejectsRuntimeOverrideDrift();
await testPreparedRequestCommitInterruptionRecovery();
await testExecutionReceiptRejectsRoutingDrift();
await testPrepareRecoversAfterContextManifestInterruption();
await testLockRecoveryAndLiveChildProtection();
await testLockMutationGuardFencesRecoveryAndRelease();
await testRunSuccessFailureAndZeroContamination();
await testExecutionClaimMaterializesIndeterminateBlockWithoutRetry();
await testIndeterminateMaterializeRecoveryAndClaimDrift();
await testIntegrityViolationAndRunConcurrency();
await testPreparedDirectoryCorruptionIsInvalid();
await testBlockedMaterializeDoesNotWriteFormalReport();
await testMaterializeResultLastAndIdempotency();
await testMaterializeInterruptionRecoveryAndUniqueExecution();
console.log("provider-runtime tests passed");
