import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  developmentToolchainSha256,
  validateDevelopmentCandidateManifest,
  validateDevelopmentContext,
  validateDevelopmentExecutionReceipt,
  validateDevelopmentReceipt,
  validateDevelopmentRequest,
  validateDevelopmentResponse,
  validateDevelopmentTestReceipt,
} from "../lib/development-provider-contract.mjs";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const EXECUTION_ID = "20000000-0000-4000-8000-000000000002";
const DISPATCH_ID = "30000000-0000-4000-8000-000000000003";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const COMMIT = "a".repeat(40);
const NOW = "2026-08-22T13:30:00.000Z";
const ROOT = "D:/ProjectStudy/FrontierScan/.harness/worktrees/M8-B-001/T1";

function clone(value) {
  return structuredClone(value);
}

function validRequest() {
  return {
    schemaVersion: "1.0",
    providerRequestId: REQUEST_ID,
    dispatchId: DISPATCH_ID,
    storyId: "M8-B-001",
    runId: "M8-B-001",
    phase: "implementation",
    preparedRevision: 4,
    taskId: "T1",
    role: "backend-developer",
    profile: "codex-default",
    adapter: "codex-cli",
    requestedModel: null,
    modelSource: "project-config",
    modelProvider: null,
    configSha256: SHA_A,
    taskFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/task.json",
    taskSha256: SHA_B,
    taskDagFile: ".harness/runs/M8-B-001/phases/02-task-dag/task-dag.json",
    taskDagSha256: SHA_C,
    worktreePlanFile: ".harness/runs/M8-B-001/worktrees/T1/plan.json",
    worktreePlanSha256: SHA_A,
    worktreeStatusFile: ".harness/runs/M8-B-001/worktrees/T1/status.json",
    worktreeStatusSha256: SHA_B,
    worktreePath: ROOT,
    baseCommit: COMMIT,
    policy: {
      name: "backend-developer",
      category: "execution",
      readPathPrefixes: ["backend/", ".harness/"],
      writePathPrefixes: ["backend/"],
      capabilities: ["backend"],
    },
    contextManifestFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/prepared/context-manifest.json",
    contextManifestSha256: SHA_C,
    outputSchemaFile: ".harness/schemas/agent-development-response.schema.json",
    outputSchemaSha256: SHA_A,
    createdAt: NOW,
  };
}

function validContext() {
  return {
    schemaVersion: "1.0",
    storyId: "M8-B-001",
    runId: "M8-B-001",
    dispatchId: DISPATCH_ID,
    taskId: "T1",
    role: "backend-developer",
    entries: [{
      path: "backend/src/main/java/example/Service.java",
      sha256: SHA_A,
      bytes: 100,
      purpose: "目标实现文件",
      source: "source",
    }],
    knowledgeAreas: [{
      area: "backend",
      status: "fresh",
      loadedFiles: ["llm-knowledge/backend/meta.yaml"],
    }],
    predictedFiles: ["backend/src/main/java/example/Service.java"],
    criterionIds: ["AC-M8B-REAL-DEVELOPER"],
    worktree: {
      planFile: ".harness/runs/M8-B-001/worktrees/T1/plan.json",
      planSha256: SHA_A,
      statusFile: ".harness/runs/M8-B-001/worktrees/T1/status.json",
      statusSha256: SHA_B,
      path: ROOT,
      branch: "harness/M8-B-001/T1",
      baseCommit: COMMIT,
      headCommit: COMMIT,
    },
    totalBytes: 100,
    createdAt: NOW,
  };
}

function validResponse() {
  return {
    schemaVersion: "1.0",
    providerRequestId: REQUEST_ID,
    dispatchId: DISPATCH_ID,
    storyId: "M8-B-001",
    runId: "M8-B-001",
    phase: "implementation",
    role: "backend-developer",
    status: "completed",
    summary: "实现目标服务。",
    developmentMethod: "tdd",
    tddExceptionReason: null,
    declaredFiles: [{
      path: "backend/src/main/java/example/Service.java",
      changeType: "update",
      purpose: "实现服务行为",
    }],
    diagnostics: [],
    usage: {
      reportedModel: null,
      inputTokens: null,
      outputTokens: null,
    },
  };
}

function validExecutionReceipt() {
  return {
    schemaVersion: "1.0",
    providerExecutionId: EXECUTION_ID,
    providerRequestId: REQUEST_ID,
    dispatchId: DISPATCH_ID,
    storyId: "M8-B-001",
    runId: "M8-B-001",
    phase: "implementation",
    taskId: "T1",
    role: "backend-developer",
    profile: "codex-default",
    adapter: "codex-cli",
    requestedModel: null,
    reportedModel: null,
    modelSource: "project-config",
    adapterVersion: "codex-cli/0.148.0",
    sandbox: "workspace-write",
    workingRoot: ROOT,
    writeIsolation: "task-worktree-workspace-write",
    requestFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/prepared/request.json",
    requestSha256: SHA_A,
    responseFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/executions/y/response.json",
    responseSha256: SHA_B,
    stdoutFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/executions/y/stdout.jsonl",
    stdoutSha256: SHA_C,
    stderrFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/executions/y/stderr.txt",
    stderrSha256: SHA_A,
    startedAt: NOW,
    finishedAt: NOW,
    exitCode: 0,
    status: "completed",
    diagnostics: [],
  };
}

function validCandidateManifest() {
  return {
    schemaVersion: "1.0",
    storyId: "M8-B-001",
    runId: "M8-B-001",
    dispatchId: DISPATCH_ID,
    taskId: "T1",
    role: "backend-developer",
    baseCommit: COMMIT,
    headCommit: COMMIT,
    worktreePath: ROOT,
    baselineSha256: SHA_A,
    afterSha256: SHA_B,
    gitStatusSha256: SHA_C,
    files: [{
      path: "backend/src/main/java/example/Service.java",
      changeType: "update",
      sha256: SHA_A,
      bytes: 100,
      kind: "backend",
    }],
    totalBytes: 100,
    createdAt: NOW,
  };
}

function validTestReceipt() {
  const toolchain = {
    adapterId: "backend-maven",
    mavenPath: "D:/fixture/maven/bin/mvn.cmd",
    mavenVersion: "maven-fixture-1.0",
    mavenSha256: SHA_A,
    javaPath: "D:/fixture/jdk/bin/java.exe",
    javaVersion: "java-fixture-17",
    javaSha256: SHA_B,
    repositoryPath: "D:/fixture/home/.m2/repository",
    repositoryIdentity: SHA_C,
  };
  return {
    schemaVersion: "1.0",
    storyId: "M8-B-001",
    runId: "M8-B-001",
    dispatchId: DISPATCH_ID,
    taskId: "T1",
    candidateManifestFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/evidence/candidate-manifest.json",
    candidateManifestSha256: SHA_A,
    adapterId: "backend-maven",
    commandId: "maven-test",
    workingDirectory: "backend",
    toolchain,
    toolchainSha256: developmentToolchainSha256(toolchain),
    status: "passed",
    exitCode: 0,
    stdoutFile: ".harness/runs/M8-B-001/phases/03-implementation/attempts/x/development-provider/evidence/test.stdout.txt",
    stdoutSha256: SHA_C,
    stderrFile: null,
    stderrSha256: null,
    candidateBeforeSha256: SHA_A,
    candidateAfterSha256: SHA_A,
    executedAt: NOW,
  };
}

function validDevelopmentReceipt() {
  return {
    schemaVersion: "1.0",
    executorKind: "development-provider",
    storyId: "M8-B-001",
    runId: "M8-B-001",
    dispatchId: DISPATCH_ID,
    taskId: "T1",
    phase: "implementation",
    ownerAgent: "backend-developer",
    providerRequestId: REQUEST_ID,
    providerExecutionId: EXECUTION_ID,
    baseCommit: COMMIT,
    headCommit: COMMIT,
    outcome: "ready-for-integration",
    requestFile: "request.json",
    requestSha256: SHA_A,
    executionReceiptFile: "execution-receipt.json",
    executionReceiptSha256: SHA_B,
    candidateManifestFile: "candidate-manifest.json",
    candidateManifestSha256: SHA_C,
    testReceiptFile: "test-receipt.json",
    testReceiptSha256: SHA_A,
    resultEvidenceFile: "result.json",
    resultSha256: SHA_B,
    contextEvidenceFile: "candidate-manifest.json",
    contextEvidenceSha256: SHA_C,
    files: validCandidateManifest().files.map(({ path, sha256, bytes, kind }) => ({
      path, sha256, bytes, kind,
    })),
    completedAt: NOW,
  };
}

function testRequestAndContext() {
  assert.equal(validateDevelopmentRequest(validRequest()).phase, "implementation");
  assert.equal(validateDevelopmentContext(validContext()).taskId, "T1");
  for (const [field, value, pattern] of [
    ["phase", "code-review", /phase.*implementation/i],
    ["role", "code-reviewer", /role.*developer/i],
    ["worktreePath", "relative/path", /worktreePath.*absolute/i],
  ]) {
    const request = validRequest();
    request[field] = value;
    assert.throws(() => validateDevelopmentRequest(request), pattern);
  }
  const extra = validRequest();
  extra.argv = ["--dangerously-bypass-approvals-and-sandbox"];
  assert.throws(() => validateDevelopmentRequest(extra), /unsupported field.*argv/i);
  const duplicate = validContext();
  duplicate.predictedFiles.push(duplicate.predictedFiles[0]);
  assert.throws(() => validateDevelopmentContext(duplicate), /predictedFiles.*unique/i);
}

function testResponse() {
  assert.equal(validateDevelopmentResponse(validResponse(), { request: validRequest() }).status, "completed");
  for (const [mutate, pattern] of [
    [(value) => { value.role = "frontend-developer"; }, /role.*request/i],
    [(value) => { value.developmentMethod = "exception"; }, /exception.*reason/i],
    [(value) => { value.declaredFiles[0].changeType = "delete"; }, /changeType/i],
    [(value) => { value.patch = "diff"; }, /unsupported field.*patch/i],
    [(value) => { value.shell = "mvn test"; }, /unsupported field.*shell/i],
  ]) {
    const response = validResponse();
    mutate(response);
    assert.throws(() => validateDevelopmentResponse(response, { request: validRequest() }), pattern);
  }
}

function testReceiptsAndManifest() {
  assert.equal(validateDevelopmentExecutionReceipt(validExecutionReceipt()).sandbox, "workspace-write");
  assert.equal(validateDevelopmentCandidateManifest(validCandidateManifest()).totalBytes, 100);
  assert.equal(validateDevelopmentTestReceipt(validTestReceipt()).status, "passed");
  assert.equal(validateDevelopmentReceipt(validDevelopmentReceipt()).outcome, "ready-for-integration");

  const deleted = validCandidateManifest();
  deleted.files[0].changeType = "delete";
  assert.throws(() => validateDevelopmentCandidateManifest(deleted), /changeType/i);
  const failedTest = validTestReceipt();
  failedTest.status = "failed";
  failedTest.exitCode = 1;
  assert.equal(validateDevelopmentTestReceipt(failedTest).status, "failed");
  const weakIsolation = validExecutionReceipt();
  weakIsolation.writeIsolation = "predicted-files-acl";
  assert.throws(() => validateDevelopmentExecutionReceipt(weakIsolation), /writeIsolation/i);
  const missingStdout = validExecutionReceipt();
  delete missingStdout.stdoutSha256;
  assert.throws(() => validateDevelopmentExecutionReceipt(missingStdout), /stdoutSha256|required/i);
  const missingToolchain = validTestReceipt();
  delete missingToolchain.toolchain;
  assert.throws(() => validateDevelopmentTestReceipt(missingToolchain), /toolchain|required/i);
}

async function testSchemasAreStrict() {
  for (const file of [
    "agent-development-request.schema.json",
    "agent-development-context.schema.json",
    "agent-development-response.schema.json",
    "agent-development-execution-receipt.schema.json",
    "agent-development-candidate-manifest.schema.json",
    "agent-development-test-receipt.schema.json",
    "agent-development-receipt.schema.json",
  ]) {
    const schema = JSON.parse(await readFile(`.harness/schemas/${file}`, "utf8"));
    assert.equal(schema.additionalProperties, false, file);
    if (file === "agent-development-response.schema.json") {
      const pending = [schema];
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== "object") continue;
        if (Object.hasOwn(value, "const") || Array.isArray(value.enum)) {
          assert.equal(value.type, "string", `${file} const/enum nodes require string type`);
        }
        pending.push(...Object.values(value));
      }
    }
  }
}

testRequestAndContext();
testResponse();
testReceiptsAndManifest();
await testSchemasAreStrict();
console.log("development-provider-contract tests passed");
