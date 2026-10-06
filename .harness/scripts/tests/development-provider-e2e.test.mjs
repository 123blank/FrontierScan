import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import {
  developmentProviderPaths,
  finalizeDevelopmentProvider,
  materializeDevelopmentProvider,
  prepareDevelopmentProvider,
  runDevelopmentProvider,
  testDevelopmentProvider,
} from "../lib/development-provider-runtime.mjs";
import { captureDevelopmentBaseline } from "../lib/development-provider-context.mjs";
import { discoverCodexExecutable } from "../lib/provider-adapters/codex-cli.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";
import { runWorktreeIntegration } from "../lib/worktree-integration-runtime.mjs";
import { runWorktreeCommand } from "../lib/worktree-runtime.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryRoots = [];
const NOW = "2026-08-22T00:00:00.000Z";

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

async function writeJson(root, relativePath, value) {
  await write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function responseFor(request, file) {
  return {
    schemaVersion: "1.0",
    providerRequestId: request.providerRequestId,
    dispatchId: request.dispatchId,
    storyId: request.storyId,
    runId: request.runId,
    phase: "implementation",
    role: request.role,
    status: "completed",
    summary: `${request.role} fixture completed.`,
    developmentMethod: "tdd",
    tddExceptionReason: null,
    declaredFiles: [{
      path: file,
      changeType: "update",
      purpose: "Update the backend fixture.",
    }],
    diagnostics: [],
    usage: {
      reportedModel: "fixture-model",
      inputTokens: 10,
      outputTokens: 10,
    },
  };
}

function adapterResult(request, response) {
  return {
    adapter: "codex-cli",
    adapterVersion: "codex-cli/fixture",
    executablePath: "C:/fixture/codex.exe",
    requestedModel: request.requestedModel,
    reportedModel: response.usage.reportedModel,
    startedAt: NOW,
    finishedAt: NOW,
    exitCode: 0,
    status: "completed",
    response,
    rawEvents: [],
    stdout: Buffer.from("fixture\n"),
    stderr: Buffer.alloc(0),
    diagnostics: [],
    worktreePath: request.worktreePath,
  };
}

async function createFixture(role = "backend-developer", { real = false } = {}) {
  const fixtureParent = real
    ? path.join(repositoryRoot, ".harness/tmp")
    : os.tmpdir();
  await mkdir(fixtureParent, { recursive: true });
  const root = await mkdtemp(path.join(fixtureParent, "frontierscan-m8b-e2e-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "m8b-e2e@example.test");
  await git(root, "config", "user.name", "M8-B E2E");
  await copyFile(path.join(repositoryRoot, ".gitignore"), path.join(root, ".gitignore"));
  for (const relativePath of [
    ".codex/agents/agents.yaml",
    ".codex/agents/worker-policies.json",
    ".harness/workflows/e2e-development-v2.yaml",
    ".harness/schemas/agent-development-response.schema.json",
  ]) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, relativePath), target);
  }
  await write(root, "AGENTS.md", "# Fixture rules\n");
  const frontend = role === "frontend-developer";
  await write(root, frontend ? "frontend/package.json" : "backend/pom.xml", frontend
    ? '{"scripts":{"build":"fixture"}}\n'
    : real
      ? [
          "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <groupId>example</groupId>",
          "  <artifactId>m8b-real-fixture</artifactId>",
          "  <version>1.0.0</version>",
          "  <properties>",
          "    <maven.compiler.source>17</maven.compiler.source>",
          "    <maven.compiler.target>17</maven.compiler.target>",
          "    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>",
          "  </properties>",
          "</project>",
          "",
        ].join("\n")
      : "<project />\n");
  const businessFile = frontend
    ? "frontend/src/views/example/Feature.vue"
    : "backend/src/main/java/example/Service.java";
  const original = frontend
    ? "<template>before</template>\n"
    : real
      ? [
          "package example;",
          "",
          "public class Service {",
          "  public String message() {",
          "    return \"before\";",
          "  }",
          "}",
          "",
        ].join("\n")
      : "class Service {}\n";
  const candidate = frontend
    ? "<template>after</template>\n"
    : "class Service { void updated() {} }\n";
  await write(root, businessFile, original);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture base");
  const baselineHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();

  const storyId = `M8-B-E2E-${randomUUID().slice(0, 8)}`;
  const runId = storyId;
  const taskId = "T1";
  const dispatchId = randomUUID();
  const stateFile = `.harness/states/e2e-${storyId}.json`;
  const dagFile = `.harness/runs/${runId}/phases/02-task-dag/task-dag.json`;
  const attemptRoot = `.harness/runs/${runId}/phases/03-implementation/attempts/${dispatchId}`;
  const taskFile = `${attemptRoot}/task.json`;
  const checkpointFile = `${attemptRoot}/checkpoint.json`;
  const resultFile = `${attemptRoot}/result.json`;
  const phaseOutput = `.harness/runs/${runId}/phases/03-implementation/implementation-notes.md`;
  const node = {
    taskId,
    title: real
      ? "Change Service.message() to return the exact string \"after\""
      : `Update ${frontend ? "frontend" : "backend"} fixture`,
    type: frontend ? "frontend" : "backend",
    status: "pending",
    ownerAgent: role,
    predictedFiles: [businessFile],
    criterionIds: ["AC-M8B-E2E"],
  };
  const dag = {
    schemaVersion: "2.0",
    storyId,
    nodes: [node],
    edges: [],
    waves: [[taskId]],
    globalChanges: [],
    risks: [],
  };
  await writeJson(root, dagFile, dag);
  const dagSha256 = sha256(await readFile(path.join(root, dagFile)));
  const state = JSON.parse(await readFile(
    path.join(repositoryRoot, ".harness/states/e2e-state-v2.template.json"),
    "utf8",
  ));
  Object.assign(state, {
    storyId,
    phase: "implementation",
    runtime: {
      runId,
      workflow: ".harness/workflows/e2e-development-v2.yaml",
      workflowVersion: "2.0",
      status: "active",
      revision: 4,
      previousPhase: "task-dag",
      activeBlock: null,
      records: [],
      reworks: [],
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
      summary: `M8-B ${frontend ? "frontend" : "backend"} fixture`,
      openQuestions: [],
      acceptanceCriteria: [{
        criterionId: "AC-M8B-E2E",
        description: "The backend candidate is integrated.",
        source: "fixture",
        required: true,
      }],
      inScope: [`${frontend ? "frontend" : "backend"} fixture`],
      outOfScope: [],
    },
    acceptance: {
      criteria: [{
        criterionId: "AC-M8B-E2E",
        required: true,
        taskIds: [taskId],
        testCaseIds: [],
        verificationCaseIds: [],
        status: "pending",
        approvalIds: [],
      }],
    },
    knowledge: { areas: [] },
    design: { decisions: [], affectedAreas: [frontend ? "frontend" : "backend"], risks: [] },
    dag: {
      schemaVersion: "2.0",
      sourceFile: dagFile,
      sourceSha256: dagSha256,
      nodes: [node],
      edges: [],
      waves: [[taskId]],
      globalChanges: [],
      risks: [],
    },
  });
  const taskValue = {
    schemaVersion: "2.0",
    dispatchId,
    storyId,
    runId,
    phase: "implementation",
    ownerAgent: role,
    purpose: "Implement task-owned changes only.",
    preparedRevision: 4,
    preparedAt: NOW,
    resultSchemaVersion: "2.0",
    attemptRoot,
    resultFile,
    checkpointFile,
    expectedOutputs: [phaseOutput],
    allowedAdapters: [],
    next: "unit-test",
  };
  await writeJson(root, stateFile, state);
  await writeJson(root, taskFile, taskValue);
  await writeJson(root, checkpointFile, {
    schemaVersion: "1.0",
    dispatchId,
    storyId,
    phase: "implementation",
    status: "prepared",
    preparedAt: NOW,
    updatedAt: NOW,
  });
  await writeJson(root, `.harness/runs/${runId}/phases/03-implementation/active-attempt.json`, {
    schemaVersion: "1.0",
    dispatchId,
    attemptRoot,
    taskFile,
    resultFile,
    checkpointFile,
    preparedRevision: 4,
    status: "prepared",
    updatedAt: NOW,
  });
  await write(root, `.harness/runs/${runId}/phases/00-requirement/requirement-breakdown.md`, "# Requirement\n");
  await write(root, `.harness/runs/${runId}/phases/01-technical-design/technical-design.md`, "# Design\n");
  await writeJson(root, ".harness/config/agent-providers.json", {
    schemaVersion: "1.0",
    defaultProfile: "backend-profile",
    profiles: {
      "backend-profile": {
        adapter: "codex-cli",
        model: real ? null : "fixture-backend-model",
        modelProvider: null,
      },
      "frontend-profile": {
        adapter: "codex-cli",
        model: "fixture-frontend-model",
        modelProvider: null,
      },
    },
    roleBindings: {
      "backend-developer": "backend-profile",
      "frontend-developer": "frontend-profile",
      "code-reviewer": "backend-profile",
    },
  });
  let expectedProfile = frontend ? "frontend-profile" : "backend-profile";
  let expectedModel = `fixture-${frontend ? "frontend" : "backend"}-model`;
  if (real) {
    const localConfig = JSON.parse(await readFile(
      path.join(repositoryRoot, ".harness/config/agent-providers.local.json"),
      "utf8",
    ));
    expectedProfile = localConfig.roleBindings?.["code-reviewer"];
    if (!expectedProfile || !localConfig.profiles?.[expectedProfile]) {
      throw new Error("Real M8-B fixture requires the current code-reviewer Provider profile.");
    }
    localConfig.roleBindings = {
      ...localConfig.roleBindings,
      "backend-developer": expectedProfile,
    };
    expectedModel = localConfig.profiles[expectedProfile].model;
    await writeJson(root, ".harness/config/agent-providers.local.json", localConfig);
  }
  await git(root, "add", ".");
  await git(root, "commit", "-m", "add story fixture");

  return {
    root,
    storyId,
    runId,
    taskId,
    stateFile,
    dagFile,
    taskFile,
    baselineHead,
    role,
    businessFile,
    original,
    candidate,
    real,
    expectedProfile,
    expectedModel,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runControlledChain(fixture) {
  const common = {
    root: fixture.root,
    stateFile: fixture.stateFile,
    now: () => NOW,
  };
  await runWorktreeCommand({
    ...common,
    command: "plan",
    taskDagFile: fixture.dagFile,
    taskId: fixture.taskId,
  });
  const created = await runWorktreeCommand({
    ...common,
    command: "create",
    taskId: fixture.taskId,
    confirmCreate: true,
  });
  if (fixture.role === "frontend-developer") {
    await write(
      fixture.root,
      `${created.status.worktreePath}/frontend/node_modules/.fixture`,
      "trusted\n",
    );
  }
  assert.equal(await readFile(path.join(fixture.root, fixture.businessFile), "utf8"), fixture.original);

  await prepareDevelopmentProvider(common);
  const request = await readJson(
    fixture.root,
    `${(await readJson(fixture.root, fixture.taskFile)).attemptRoot}/development-provider/prepared/request.json`,
  );
  assert.equal(request.profile, fixture.expectedProfile);
  assert.equal(
    request.requestedModel,
    fixture.expectedModel,
  );
  assert.equal(request.role, fixture.role);
  assert.equal(
    request.policy.writePathPrefixes.includes(
      fixture.role === "frontend-developer" ? "frontend/src/" : "backend/src/",
    ),
    true,
  );
  const executed = await runDevelopmentProvider(fixture.real
    ? { ...common, timeoutMs: 300_000 }
    : {
        ...common,
        adapter: async ({ request: frozenRequest }) => {
          await write(frozenRequest.worktreePath, fixture.businessFile, fixture.candidate);
          const response = responseFor(frozenRequest, fixture.businessFile);
          return adapterResult(frozenRequest, response);
        },
      });
  let executionFailure = null;
  if (executed.status !== "development-provider-materialize-required"
      && executed.providerExecutionId) {
    const task = await readJson(fixture.root, fixture.taskFile);
    const paths = developmentProviderPaths(task, fixture.taskId);
    const executionRoot = `${paths.executionsRoot}/${executed.providerExecutionId}`;
    executionFailure = {
      receipt: await readJson(
        fixture.root,
        `${executionRoot}/execution-receipt.json`,
      ).catch(() => null),
      stdoutEvents: await readFile(
        path.join(fixture.root, `${executionRoot}/stdout.jsonl`),
        "utf8",
      ).then((source) => source.trim().split("\n").filter(Boolean).map((line) => {
        const event = JSON.parse(line);
        let responseKeys = [];
        try {
          const value = JSON.parse(event.item?.text);
          if (value && typeof value === "object" && !Array.isArray(value)) {
            responseKeys = Object.keys(value).sort();
          }
        } catch {}
        return {type: event.type, itemType: event.item?.type ?? null, responseKeys};
      })).catch(() => []),
      stderr: await readFile(
        path.join(fixture.root, `${executionRoot}/stderr.txt`),
        "utf8",
      ).catch(() => ""),
    };
  }
  assert.equal(
    executed.status,
    "development-provider-materialize-required",
    JSON.stringify({ executed, executionFailure }),
  );
  await materializeDevelopmentProvider(common);
  const preparedBaseline = await readJson(
    fixture.root,
    `${(await readJson(fixture.root, fixture.taskFile)).attemptRoot}/development-provider/prepared/worktree-baseline.json`,
  );
  let selected;
  await testDevelopmentProvider(fixture.real
    ? { ...common, timeoutMs: 300_000 }
    : {
      ...common,
      discoverTestAdapter: async (selection) => {
      selected = selection;
      if (fixture.role === "frontend-developer") {
        return {
          executablePath: "C:/fixture/node/npm.cmd",
          toolchain: {
            adapterId: "frontend-npm",
            npmPath: "C:/fixture/node/npm.cmd",
            npmVersion: "npm-fixture-1.0",
            npmSha256: sha256("npm-fixture"),
            nodePath: "C:/fixture/node/node.exe",
            nodeVersion: "node-fixture-1.0",
            nodeSha256: sha256("node-fixture"),
            dependencySha256: preparedBaseline.buildOutputs.find(
              (item) => item.path === "frontend/node_modules",
            ).sha256,
          },
        };
      }
      return {
        executablePath: "C:/fixture/maven/bin/mvn.cmd",
        toolchain: {
          adapterId: "backend-maven",
          mavenPath: "C:/fixture/maven/bin/mvn.cmd",
          mavenVersion: "maven-fixture-1.0",
          mavenSha256: sha256("maven-fixture"),
          javaPath: "C:/fixture/jdk/bin/java.exe",
          javaVersion: "java-fixture-17",
          javaSha256: sha256("java-fixture"),
          repositoryPath: "C:/fixture/home/.m2/repository",
          repositoryIdentity: sha256("fixture-m2"),
        },
      };
      },
      executeTest: async () => ({
        status: "passed",
        exitCode: 0,
        stdout: Buffer.from("tests passed\n"),
        stderr: Buffer.alloc(0),
        startedAt: NOW,
        finishedAt: NOW,
      }),
    });
  if (!fixture.real) {
    assert.equal(selected.adapterId, fixture.role === "frontend-developer"
      ? "frontend-npm"
      : "backend-maven");
    assert.equal(selected.commandId, fixture.role === "frontend-developer"
      ? "npm-build"
      : "maven-test");
  }
  await finalizeDevelopmentProvider(common);
  assert.equal(await readFile(path.join(fixture.root, fixture.businessFile), "utf8"), fixture.original);
  const receipt = await readJson(
    fixture.root,
    `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}/development-provider-receipt.json`,
  );
  const executionReceipt = await readJson(fixture.root, receipt.executionReceiptFile);
  assert.equal(executionReceipt.sandbox, "workspace-write");
  assert.equal(executionReceipt.workingRoot, request.worktreePath);
  assert.equal(executionReceipt.role, fixture.role);
  assert.equal(executionReceipt.requestedModel, request.requestedModel);
  const candidateManifest = await readJson(fixture.root, receipt.candidateManifestFile);
  assert.deepEqual(
    receipt.files.filter((file) => file.kind !== "phase-output"),
    candidateManifest.files.map(({ path: file, sha256: hash, bytes, kind }) => ({
      path: file,
      sha256: hash,
      bytes,
      kind,
    })),
  );
  assert.deepEqual(
    receipt.files.filter((file) => file.kind === "phase-output").map((file) => file.path),
    [(await readJson(fixture.root, fixture.taskFile)).expectedOutputs[0]],
  );

  const integration = {
    ...common,
    taskId: fixture.taskId,
    taskFile: fixture.taskFile,
  };
  await runWorktreeIntegration({ ...integration, command: "plan" });
  const ready = await runWorktreeIntegration({ ...integration, command: "status" });
  assert.equal(ready.status.state, "planned");
  await runWorktreeIntegration({ ...integration, command: "apply", confirmApply: true });
  const integratedContent = await readFile(path.join(fixture.root, fixture.businessFile), "utf8");
  if (fixture.real) assert.match(integratedContent, /return\s+"after"\s*;/);
  else assert.equal(integratedContent, fixture.candidate);
  assert.equal((await readJson(fixture.root, fixture.stateFile)).phase, "implementation");

  await runStoryCommand({ ...common, command: "apply" });
  const state = await readJson(fixture.root, fixture.stateFile);
  assert.equal(state.phase, "unit-test");
  assert.deepEqual(state.implementation.actualFiles, [fixture.businessFile]);
  assert.deepEqual(state.implementation.completedTaskIds, [fixture.taskId]);
  return {
    storyId: fixture.storyId,
    selected,
    receipt,
    request,
    executionReceipt,
    candidateManifest,
    state,
  };
}

test("backend Development Provider completes the controlled single-task chain", async () => {
  await runControlledChain(await createFixture());
});

test("frontend Development Provider preserves role boundaries and fixed npm build selection", async () => {
  const fixture = await createFixture("frontend-developer");
  const result = await runControlledChain(fixture);
  assert.equal(result.receipt.ownerAgent, "frontend-developer");
});

test("an out-of-prediction write fails the whole attempt without changing the main tree", async () => {
  const fixture = await createFixture();
  const common = {
    root: fixture.root,
    stateFile: fixture.stateFile,
    now: () => NOW,
  };
  await runWorktreeCommand({
    ...common,
    command: "plan",
    taskDagFile: fixture.dagFile,
    taskId: fixture.taskId,
  });
  await runWorktreeCommand({
    ...common,
    command: "create",
    taskId: fixture.taskId,
    confirmCreate: true,
  });
  await prepareDevelopmentProvider(common);
  await runDevelopmentProvider({
    ...common,
    adapter: async ({ request }) => {
      const unauthorized = "backend/src/main/java/example/Unauthorized.java";
      await write(request.worktreePath, fixture.businessFile, fixture.candidate);
      await write(request.worktreePath, unauthorized, "class Unauthorized {}\n");
      const response = responseFor(request, fixture.businessFile);
      response.declaredFiles.push({
        path: unauthorized,
        changeType: "create",
        purpose: "Unauthorized fixture write.",
      });
      return adapterResult(request, response);
    },
  });
  const materialized = await materializeDevelopmentProvider(common);
  assert.equal(materialized.status, "development-provider-recovery-required");
  assert.match(materialized.diagnostics.join("\n"), /predicted|outside|unauthorized/i);
  assert.equal(await readFile(path.join(fixture.root, fixture.businessFile), "utf8"), fixture.original);
  await assert.rejects(
    readFile(path.join(
      fixture.root,
      `.harness/runs/${fixture.runId}/worktrees/${fixture.taskId}/development-provider-receipt.json`,
    )),
    (error) => error?.code === "ENOENT",
  );
});

test("Codex sandbox rejects or exposes linked Worktree Git mutations", {
  skip: process.env.M8B_REAL_CODEX !== "1",
  timeout: 120_000,
}, async () => {
  const fixture = await createFixture("backend-developer", {real: true});
  const common = {root: fixture.root, stateFile: fixture.stateFile, now: () => NOW};
  await runWorktreeCommand({
    ...common,
    command: "plan",
    taskDagFile: fixture.dagFile,
    taskId: fixture.taskId,
  });
  await runWorktreeCommand({...common, command: "create", taskId: fixture.taskId, confirmCreate: true});
  await prepareDevelopmentProvider(common);
  const request = await readJson(
    fixture.root,
    developmentProviderPaths(await readJson(fixture.root, fixture.taskFile), fixture.taskId).requestFile,
  );
  const codex = await discoverCodexExecutable();
  const capture = () => captureDevelopmentBaseline({
    worktreePath: request.worktreePath,
    baseCommit: request.baseCommit,
    predictedFiles: [fixture.businessFile],
    buildOutputPaths: ["backend/target"],
    ignoredExcludePrefixes: ["backend/target"],
    lockPaths: [".git/index.lock", ".git/config.lock"],
    now: () => NOW,
  });
  const probes = [
    {args: ["git", "branch", "m8b-probe"], fields: ["refsSha256"]},
    {args: ["git", "config", "--local", "m8b.probe", "true"], fields: ["configSha256"]},
    {args: ["git", "add", "--all"], fields: ["indexSha256"]},
    {
      args: ["git", "commit", "--allow-empty", "-m", "m8b-probe"],
      fields: ["headCommit", "refsSha256", "indexSha256"],
    },
  ];
  for (const probe of probes) {
    const before = await capture();
    let exitCode = 0;
    try {
      await execFileAsync(codex, [
        "sandbox", "-P", ":workspace", "-C", request.worktreePath,
        "--sandbox-state-disable-network", ...probe.args,
      ], {cwd: request.worktreePath, windowsHide: true});
    } catch (error) {
      exitCode = Number.isInteger(error.code) ? error.code : 1;
    }
    let detected = false;
    try {
      const after = await capture();
      detected = probe.fields.some((field) => before[field] !== after[field]);
    } catch {
      detected = true;
    }
    assert.equal(exitCode !== 0 || detected, true, `Git probe escaped detection: ${probe.args.join(" ")}`);
  }
});

test("real Codex CLI Development Provider completes a backend fixture", {
  skip: process.env.M8B_REAL_CODEX !== "1",
  timeout: 600_000,
}, async () => {
  const summary = await runControlledChain(
    await createFixture("backend-developer", { real: true }),
  );
  console.log(`M8B_REAL_FIXTURE ${JSON.stringify({
    storyId: summary.storyId,
    role: summary.request.role,
    profile: summary.request.profile,
    requestedModel: summary.request.requestedModel,
    sandbox: summary.executionReceipt.sandbox,
    writeIsolation: summary.executionReceipt.writeIsolation,
    candidateFiles: summary.candidateManifest.files.map((file) => file.path),
    outcome: summary.receipt.outcome,
    statePhase: summary.state.phase,
  })}`);
});
