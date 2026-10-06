import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvalSemanticKey,
  deterministicApprovalId,
  knowledgeStaleSubjectSha256,
  verificationGapSubjectSha256,
} from "../lib/approval-contract.mjs";
import { verifyStoryClosure } from "../lib/story-closure-verifier.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PHASES = [
  "requirement",
  "technical-design",
  "task-dag",
  "implementation",
  "unit-test",
  "code-review",
  "build-publish",
  "interface-verification",
  "delivery-preparation",
];
const PHASE_TASKS = {
  requirement: {
    ownerAgent: "requirement-analyst",
    purpose: "Clarify the story, acceptance criteria, affected modules, and blocking questions.",
    output: "requirement-breakdown.md",
  },
  "technical-design": {
    ownerAgent: "requirement-analyst",
    purpose: "Produce a technical design using only relevant knowledge files.",
    output: "technical-design.md",
  },
  "task-dag": {
    ownerAgent: "task-planner",
    purpose: "Split work into tasks, dependencies, waves, predicted file touches, and global changes.",
    output: "task-dag.json",
  },
  implementation: {
    ownerAgent: "backend-developer",
    purpose: "Implement task-owned changes only.",
    output: "implementation-notes.md",
  },
  "unit-test": {
    ownerAgent: "unit-tester",
    purpose: "Run selected backend/frontend tests and record results.",
    output: "test-report.md",
  },
  "code-review": {
    ownerAgent: "code-reviewer",
    purpose: "Review code changes and emit findings without modifying files.",
    output: "code-review-report.md",
  },
  "build-publish": {
    ownerAgent: "publisher",
    purpose: "Build and optionally publish after explicit confirmation.",
    output: "build-report.md",
  },
  "interface-verification": {
    ownerAgent: "interface-verifier",
    purpose: "Verify API/UI behavior against acceptance criteria where an environment is available.",
    output: "interface-verification-report.md",
  },
  "delivery-preparation": {
    ownerAgent: "git-committer",
    purpose: "Summarize owned changes, remaining risks, and delivery readiness without executing Git.",
    output: "delivery-report.md",
  },
};

function sha256(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

async function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  const source = await readFile(filePath);
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: sha256(source),
    bytes: source.byteLength,
  };
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function writeJson(root, relativePath, value) {
  return write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function phaseRecord(phase, index, artifact) {
  const dispatchId = phaseDispatchId(index);
  return {
    id: `result:${dispatchId}`,
    type: "phase-result",
    phase,
    status: "applied",
    path: artifact.path,
    message: `${phase} applied`,
    actor: "runtime",
    createdAt: NOW,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    dispatchId,
    preparedRevision: index * 2 + 1,
    appliedRevision: index * 2 + 2,
  };
}

function phaseDispatchId(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function phasePayload(state, phase) {
  if (phase === "requirement") {
    return {
      acceptanceCriteria: structuredClone(state.requirement.acceptanceCriteria),
      openQuestions: structuredClone(state.requirement.openQuestions),
      inScope: structuredClone(state.requirement.inScope),
      outOfScope: structuredClone(state.requirement.outOfScope),
    };
  }
  if (phase === "technical-design") {
    return {
      decisions: structuredClone(state.design.decisions),
      affectedAreas: structuredClone(state.design.affectedAreas),
      knowledgeSnapshot: structuredClone(state.knowledge.areas),
      risks: structuredClone(state.design.risks),
    };
  }
  if (phase === "task-dag") {
    return {
      taskDagFile: state.dag.sourceFile,
      taskDagSha256: state.dag.sourceSha256,
    };
  }
  if (phase === "implementation") {
    return {
      taskUpdates: state.dag.nodes.map((node) => ({
        taskId: node.taskId,
        status: node.status,
      })),
      actualFiles: structuredClone(state.implementation.actualFiles),
      method: state.implementation.method,
      exceptionReason: state.implementation.exceptionReason,
      notes: structuredClone(state.implementation.notes),
    };
  }
  if (phase === "unit-test") return structuredClone(state.tests);
  if (phase === "code-review") return structuredClone(state.review);
  if (phase === "build-publish") return structuredClone(state.build);
  if (phase === "interface-verification") return structuredClone(state.verification);
  if (phase === "delivery-preparation") return structuredClone(state.delivery);
  throw new Error(`Unsupported fixture phase '${phase}'.`);
}

export async function createCompletedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-story-closure-"));
  const storyId = "M7-D-CLOSURE";
  const stateFile = `.harness/states/e2e-${storyId}.json`;

  await write(
    root,
    ".harness/schemas/e2e-state-v2.schema.json",
    await readFile(path.join(REPOSITORY_ROOT, ".harness/schemas/e2e-state-v2.schema.json")),
  );
  await write(
    root,
    ".harness/workflows/e2e-development-v2.yaml",
    await readFile(path.join(REPOSITORY_ROOT, ".harness/workflows/e2e-development-v2.yaml")),
  );

  const phaseArtifacts = [];
  for (const [index, phase] of PHASES.entries()) {
    const dispatchId = phaseDispatchId(index);
    phaseArtifacts.push({
      path:
        `.harness/runs/${storyId}/phases/${String(index).padStart(2, "0")}-${phase}`
        + `/attempts/${dispatchId}/result.json`,
    });
  }

  const dagArtifact = await writeJson(
    root,
    `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`,
    {
      schemaVersion: "2.0",
      storyId,
      nodes: [{
        taskId: "T1",
        title: "Implement the verified behavior",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/Test.java"],
        criterionIds: ["AC-001"],
      }],
      edges: [],
      waves: [["T1"]],
      globalChanges: [],
      risks: [],
    },
  );
  const sourceArtifact = await write(root, "backend/src/Test.java", "class Test {}\n");
  const testArtifact = await write(root, `.harness/runs/${storyId}/evidence/test.txt`, "tests passed\n");
  const buildArtifact = await write(root, `.harness/runs/${storyId}/evidence/build.txt`, "build passed\n");
  const verificationArtifact = await write(
    root,
    `.harness/runs/${storyId}/evidence/verification.txt`,
    "verification passed\n",
  );
  const deliverySummary = await write(
    root,
    `.harness/runs/${storyId}/phases/08-delivery-preparation/delivery-report.md`,
    "# Delivery ready\n",
  );
  const ownedManifest = await writeJson(
    root,
    `.harness/runs/${storyId}/delivery/owned-manifest.json`,
    { schemaVersion: "1.0", storyId, ownedFiles: [sourceArtifact.path] },
  );

  const state = {
    schemaVersion: "2.0",
    storyId,
    phase: "done",
    runtime: {
      runId: storyId,
      workflow: ".harness/workflows/e2e-development-v2.yaml",
      workflowVersion: "2.0",
      status: "completed",
      revision: 18,
      previousPhase: "delivery-preparation",
      activeBlock: null,
      records: PHASES.map((phase, index) => phaseRecord(phase, index, phaseArtifacts[index])),
      createdAt: NOW,
      updatedAt: NOW,
    },
    baseline: {
      head: "a".repeat(40),
      branch: "dev",
      initialDirtyPaths: [],
      capturedAt: NOW,
    },
    requirement: {
      summary: "Verify a complete Story.",
      openQuestions: [],
      acceptanceCriteria: [{
        criterionId: "AC-001",
        description: "The required behavior is verified.",
        source: "fixture",
        required: true,
      }],
      inScope: ["Closure verification"],
      outOfScope: [],
    },
    acceptance: {
      criteria: [{
        criterionId: "AC-001",
        required: true,
        taskIds: ["T1"],
        testCaseIds: ["TC-001"],
        verificationCaseIds: ["VC-001"],
        status: "verified",
        approvalIds: [],
      }],
    },
    knowledge: { areas: [] },
    design: {
      decisions: [{
        decisionId: "D1",
        summary: "Reuse the existing Runtime.",
        rationale: "M7-D is an acceptance milestone.",
      }],
      affectedAreas: [],
      risks: [],
    },
    dag: {
      schemaVersion: "2.0",
      sourceFile: dagArtifact.path,
      sourceSha256: dagArtifact.sha256,
      nodes: [{
        taskId: "T1",
        title: "Implement the verified behavior",
        type: "backend",
        status: "done",
        ownerAgent: "backend-developer",
        predictedFiles: [sourceArtifact.path],
        criterionIds: ["AC-001"],
      }],
      edges: [],
      waves: [["T1"]],
      globalChanges: [],
      risks: [],
    },
    implementation: {
      method: "tdd",
      exceptionReason: null,
      actualFiles: [sourceArtifact.path],
      completedTaskIds: ["T1"],
      notes: [],
    },
    tests: {
      cases: [{
        caseId: "TC-001",
        type: "integration",
        required: true,
        criterionIds: ["AC-001"],
        expected: "The required behavior passes.",
      }],
      commands: [{
        commandId: "CMD-001",
        command: "fixture test",
        status: "passed",
        exitCode: 0,
        evidencePath: testArtifact.path,
        evidenceSha256: testArtifact.sha256,
        executedAt: NOW,
      }],
      results: [{
        caseId: "TC-001",
        status: "passed",
        actual: "The required behavior passed.",
        evidencePath: testArtifact.path,
        evidenceSha256: testArtifact.sha256,
        executedAt: NOW,
      }],
    },
    review: { findings: [], status: "passed" },
    build: {
      results: [{
        buildId: "BUILD-001",
        type: "backend",
        status: "passed",
        command: "fixture build",
        evidencePath: buildArtifact.path,
        evidenceSha256: buildArtifact.sha256,
        executedAt: NOW,
      }],
      artifacts: [],
      externalActions: [],
    },
    verification: {
      cases: [{
        caseId: "VC-001",
        type: "api",
        required: true,
        criterionIds: ["AC-001"],
        action: "Verify the required behavior.",
        expected: "The behavior is visible.",
      }],
      results: [{
        caseId: "VC-001",
        status: "verified",
        actual: "The behavior is visible.",
        evidencePath: verificationArtifact.path,
        evidenceSha256: verificationArtifact.sha256,
        approvalId: null,
        executedAt: NOW,
      }],
      environment: {
        status: "available",
        summary: "Fixture environment available.",
        evidencePath: verificationArtifact.path,
        evidenceSha256: verificationArtifact.sha256,
      },
    },
    delivery: {
      status: "ready",
      ownedFiles: [sourceArtifact.path],
      outOfPredictionFiles: [],
      unrelatedDirtyFiles: [],
      remainingRisks: [],
      summaryFile: deliverySummary.path,
      summarySha256: deliverySummary.sha256,
      ownedManifestFile: ownedManifest.path,
      ownedManifestSha256: ownedManifest.sha256,
      gitStatus: "not-requested",
    },
    approvals: [],
    worktrees: [],
    logs: Array.from({ length: 18 }, (_, index) => ({
      type: "fixture",
      revision: index + 1,
      createdAt: NOW,
    })),
  };
  for (const [index, phase] of PHASES.entries()) {
    const record = phaseRecord(phase, index, phaseArtifacts[index]);
    const phaseRoot =
      `.harness/runs/${storyId}/phases/${String(index).padStart(2, "0")}-${phase}`;
    const output = phase === "task-dag"
      ? dagArtifact
      : phase === "delivery-preparation"
        ? deliverySummary
        : await write(root, `${phaseRoot}/${PHASE_TASKS[phase].output}`, `# ${phase}\n`);
    const expectedOutputs = phase === "delivery-preparation"
      ? [output.path, ownedManifest.path]
      : [output.path];
    const attemptRoot = path.posix.dirname(phaseArtifacts[index].path);
    await writeJson(root, `${attemptRoot}/task.json`, {
      schemaVersion: "2.0",
      dispatchId: record.dispatchId,
      storyId,
      runId: storyId,
      phase,
      ownerAgent: PHASE_TASKS[phase].ownerAgent,
      purpose: PHASE_TASKS[phase].purpose,
      preparedRevision: record.preparedRevision,
      preparedAt: NOW,
      resultSchemaVersion: "2.0",
      attemptRoot,
      resultFile: phaseArtifacts[index].path,
      checkpointFile: `${attemptRoot}/checkpoint.json`,
      expectedOutputs,
      allowedAdapters: [],
      next: PHASES[index + 1] ?? "done",
    });
    const resultArtifact = await writeJson(root, phaseArtifacts[index].path, {
      schemaVersion: "2.0",
      dispatchId: record.dispatchId,
      storyId,
      runId: storyId,
      phase,
      preparedRevision: record.preparedRevision,
      status: "completed",
      summary: phase === "requirement" ? state.requirement.summary : `${phase} completed`,
      outputs: phase === "delivery-preparation" ? [output, ownedManifest] : [output],
      records: [],
      payload: phasePayload(state, phase),
    });
    state.runtime.records[index] = phaseRecord(phase, index, resultArtifact);
  }
  await writeJson(root, stateFile, state);
  return { root, stateFile, storyId, state };
}

async function writeMutatedState(fixture, mutate) {
  const state = structuredClone(fixture.state);
  mutate(state);
  await writeJson(fixture.root, fixture.stateFile, state);
}

async function rewritePhaseResultPayload(fixture, state, phase) {
  const record = state.runtime.records.find(
    (item) => item.type === "phase-result"
      && item.phase === phase
      && item.status === "applied",
  );
  const result = await readJson(fixture.root, record.path);
  result.payload = phasePayload(state, phase);
  if (phase === "requirement") result.summary = state.requirement.summary;
  const artifact = await writeJson(fixture.root, record.path, result);
  record.sha256 = artifact.sha256;
  record.bytes = artifact.bytes;
}

async function testCompletedStateProducesClosureSummary() {
  const fixture = await createCompletedFixture();
  try {
    const result = await verifyStoryClosure({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(result.status, "passed");
    assert.equal(result.storyId, fixture.storyId);
    assert.equal(result.delivery.status, "ready");
    assert.equal(result.delivery.gitStatus, "not-requested");
    assert.deepEqual(result.acceptedGaps, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testBuildArtifactMayLiveOutsideEvidenceDirectories() {
  const fixture = await createCompletedFixture();
  try {
    const artifact = await write(
      fixture.root,
      "backend/target/frontierscan-backend.jar",
      "fixture jar\n",
    );
    const state = await readJson(fixture.root, fixture.stateFile);
    state.build.artifacts = [{
      artifactId: "ARTIFACT-BACKEND-JAR",
      type: "spring-boot-jar",
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    }];
    await rewritePhaseResultPayload(fixture, state, "build-publish");
    await writeJson(fixture.root, fixture.stateFile, state);

    const result = await verifyStoryClosure({
      root: fixture.root,
      stateFile: fixture.stateFile,
    });
    assert.equal(result.build.artifacts[0].path, artifact.path);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testMissingClosureFactsFail() {
  const mutations = [
    (state) => { state.runtime.status = "active"; },
    (state) => { state.requirement.acceptanceCriteria = []; },
    (state) => { state.dag.nodes = []; },
    (state) => { state.tests.results = []; },
    (state) => { state.review.status = "blocked"; },
    (state) => {
      state.review.findings = [{
        findingId: "REV-WARN-1",
        severity: "WARNING",
        status: "open",
        summary: "Open warning",
        file: null,
        line: null,
        evidence: null,
      }];
    },
    (state) => { state.verification.results = []; },
    (state) => { state.delivery.status = "pending"; },
  ];
  for (const mutate of mutations) {
    const fixture = await createCompletedFixture();
    try {
      await writeMutatedState(fixture, mutate);
      await assert.rejects(
        verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}

async function testEvidenceDriftFails() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    await writeFile(path.join(fixture.root, state.delivery.summaryFile), "drifted\n", "utf8");
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /hash|changed|drift/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testStateProjectionDriftFails() {
  const fixture = await createCompletedFixture();
  try {
    await writeMutatedState(fixture, (state) => {
      state.design.decisions[0].summary = "Drifted after the phase result was applied.";
    });
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /technical-design|projection|result/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testNestedResultOutputDriftFails() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const resultRecord = state.runtime.records.find(
      (record) => record.phase === "technical-design",
    );
    const result = await readJson(fixture.root, resultRecord.path);
    await writeFile(
      path.join(fixture.root, result.outputs[0].path),
      "drifted phase output\n",
      "utf8",
    );
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /output|hash|changed/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testCrossPhaseOutputSubstitutionFails() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const requirementRecord = state.runtime.records.find(
      (record) => record.phase === "requirement",
    );
    const designRecord = state.runtime.records.find(
      (record) => record.phase === "technical-design",
    );
    const requirementResult = await readJson(fixture.root, requirementRecord.path);
    const designResult = await readJson(fixture.root, designRecord.path);
    designResult.outputs = structuredClone(requirementResult.outputs);
    const artifact = await writeJson(fixture.root, designRecord.path, designResult);
    designRecord.sha256 = artifact.sha256;
    designRecord.bytes = artifact.bytes;
    await writeJson(fixture.root, fixture.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /output|required|phase|task/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testRelocatedResultFails() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const record = state.runtime.records.find(
      (item) => item.phase === "technical-design",
    );
    const relocated = await write(
      fixture.root,
      "docs/copied-technical-design-result.json",
      await readFile(path.join(fixture.root, record.path)),
    );
    record.path = relocated.path;
    record.sha256 = relocated.sha256;
    record.bytes = relocated.bytes;
    await writeJson(fixture.root, fixture.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /result|attempt|path|identity/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testCrossAttemptRecordSubstitutionFails() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const designRecord = state.runtime.records.find(
      (item) => item.phase === "technical-design",
    );
    const requirementRecord = state.runtime.records.find(
      (item) => item.phase === "requirement",
    );
    const requirementAttempt = path.posix.dirname(requirementRecord.path);
    const evidence = await write(
      fixture.root,
      `${requirementAttempt}/evidence/borrowed.json`,
      "{\"status\":\"recorded\"}\n",
    );
    const designResult = await readJson(fixture.root, designRecord.path);
    designResult.records = [{
      type: "note",
      status: "recorded",
      path: evidence.path,
      sha256: evidence.sha256,
      bytes: evidence.bytes,
      message: "Borrowed from another attempt.",
      actor: "fixture-agent",
    }];
    const artifact = await writeJson(fixture.root, designRecord.path, designResult);
    designRecord.sha256 = artifact.sha256;
    designRecord.bytes = artifact.bytes;
    await writeJson(fixture.root, fixture.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /record|attempt|evidence/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testNormalizedCrossAttemptRecordSubstitutionFails() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const designRecord = state.runtime.records.find(
      (item) => item.phase === "technical-design",
    );
    const designAttempt = path.posix.dirname(designRecord.path);
    const otherDispatchId = "00000000-0000-4000-8000-999999999999";
    const evidence = await write(
      fixture.root,
      `${path.posix.dirname(designAttempt)}/${otherDispatchId}/evidence/borrowed.json`,
      "{\"status\":\"recorded\"}\n",
    );
    const designResult = await readJson(fixture.root, designRecord.path);
    designResult.records = [{
      type: "note",
      status: "recorded",
      path: `${designAttempt}/evidence/../../${otherDispatchId}/evidence/borrowed.json`,
      sha256: evidence.sha256,
      bytes: evidence.bytes,
      message: "Borrowed through a normalized path.",
      actor: "fixture-agent",
    }];
    const artifact = await writeJson(fixture.root, designRecord.path, designResult);
    designRecord.sha256 = artifact.sha256;
    designRecord.bytes = artifact.bytes;
    await writeJson(fixture.root, fixture.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /record|attempt|evidence|inside/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

function approvalReceipt({
  approvalId,
  task,
  subjectType,
  subjectId,
  subjectSha256,
  reason,
  evidencePath,
  evidenceSha256,
}) {
  return {
    schemaVersion: "1.0",
    approvalId,
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    dispatchId: task.dispatchId,
    preparedRevision: task.preparedRevision,
    subjectType,
    subjectId,
    subjectSha256,
    status: "approved",
    actor: "user",
    reason,
    evidencePath,
    evidenceSha256,
    createdAt: NOW,
  };
}

function deterministicId(task, subjectId, subjectSha256, reason) {
  return deterministicApprovalId(approvalSemanticKey({
    storyId: task.storyId,
    dispatchId: task.dispatchId,
    caseId: subjectId,
    subjectSha256,
    actor: "user",
    reason,
  }));
}

async function addVerificationGapApproval(fixture, { forged = false } = {}) {
  const state = await readJson(fixture.root, fixture.stateFile);
  const record = state.runtime.records.find((item) => item.phase === "interface-verification");
  const task = {
    storyId: state.storyId,
    runId: state.runtime.runId,
    phase: "interface-verification",
    dispatchId: record.dispatchId,
    preparedRevision: record.preparedRevision,
    preparedAt: NOW,
  };
  const caseValue = state.verification.cases[0];
  const resultValue = {
    ...state.verification.results[0],
    status: "accepted-with-known-gaps",
    approvalId: null,
  };
  const actualSubjectSha256 = verificationGapSubjectSha256(caseValue, resultValue, task);
  const subjectSha256 = forged ? `sha256:${"f".repeat(64)}` : actualSubjectSha256;
  const reason = "接受 fixture 中明确记录的验证缺口";
  const approvalId = deterministicId(task, caseValue.caseId, subjectSha256, reason);
  resultValue.approvalId = approvalId;
  const receipt = approvalReceipt({
    approvalId,
    task,
    subjectType: "verification-gap",
    subjectId: caseValue.caseId,
    subjectSha256,
    reason,
    evidencePath: resultValue.evidencePath,
    evidenceSha256: resultValue.evidenceSha256,
  });
  const receiptArtifact = await writeJson(
    fixture.root,
    `.harness/runs/${state.storyId}/phases/07-interface-verification/attempts/${task.dispatchId}/approvals/${approvalId}.json`,
    receipt,
  );
  state.verification.results[0] = resultValue;
  state.acceptance.criteria[0].status = "accepted-with-known-gaps";
  state.acceptance.criteria[0].approvalIds = [approvalId];
  state.approvals = [{
    ...receipt,
    receiptPath: receiptArtifact.path,
    receiptSha256: receiptArtifact.sha256,
  }];
  await rewritePhaseResultPayload(fixture, state, "interface-verification");
  await writeJson(fixture.root, fixture.stateFile, state);
}

async function testApprovalSemanticsRejectForgery() {
  const valid = await createCompletedFixture();
  try {
    await addVerificationGapApproval(valid);
    const result = await verifyStoryClosure({ root: valid.root, stateFile: valid.stateFile });
    assert.equal(result.acceptedGaps.length, 1);
  } finally {
    await rm(valid.root, { recursive: true, force: true });
  }

  const forgedGap = await createCompletedFixture();
  try {
    await addVerificationGapApproval(forgedGap, { forged: true });
    await assert.rejects(
      verifyStoryClosure({ root: forgedGap.root, stateFile: forgedGap.stateFile }),
      /subject|approval.*identity/i,
    );
  } finally {
    await rm(forgedGap.root, { recursive: true, force: true });
  }

  const forgedKnowledge = await createCompletedFixture();
  try {
    const state = await readJson(forgedKnowledge.root, forgedKnowledge.stateFile);
    const record = state.runtime.records.find((item) => item.phase === "technical-design");
    const task = {
      storyId: state.storyId,
      runId: state.runtime.runId,
      phase: "technical-design",
      dispatchId: record.dispatchId,
      preparedRevision: record.preparedRevision,
      preparedAt: NOW,
    };
    const attemptRoot =
      `.harness/runs/${state.storyId}/phases/01-technical-design/attempts/${task.dispatchId}`;
    const evidence = await writeJson(
      forgedKnowledge.root,
      `${attemptRoot}/knowledge/checks/forged.json`,
      { status: "stale" },
    );
    const refreshTask = await writeJson(
      forgedKnowledge.root,
      `${attemptRoot}/knowledge/tasks/forged.json`,
      { area: "common" },
    );
    const area = {
      area: "common",
      relevant: true,
      observedStatus: "stale",
      status: "accepted-stale",
      sourceFingerprint: `sha256:${"1".repeat(64)}`,
      loadedFiles: [],
      missing: [],
      checkedAt: NOW,
      freshnessEvidencePath: evidence.path,
      freshnessEvidenceSha256: evidence.sha256,
      refreshTaskPath: refreshTask.path,
      refreshTaskSha256: refreshTask.sha256,
      refreshReceiptPath: null,
      refreshReceiptSha256: null,
      approvalId: null,
    };
    const actualSubjectSha256 = knowledgeStaleSubjectSha256(area, {
      ...task,
      attemptRoot,
    });
    assert.notEqual(actualSubjectSha256, `sha256:${"e".repeat(64)}`);
    const subjectSha256 = `sha256:${"e".repeat(64)}`;
    const reason = "接受伪造的 stale 事实";
    const approvalId = deterministicId(task, area.area, subjectSha256, reason);
    area.approvalId = approvalId;
    const receipt = approvalReceipt({
      approvalId,
      task,
      subjectType: "knowledge-stale",
      subjectId: area.area,
      subjectSha256,
      reason,
      evidencePath: evidence.path,
      evidenceSha256: evidence.sha256,
    });
    const receiptArtifact = await writeJson(
      forgedKnowledge.root,
      `${attemptRoot}/approvals/${approvalId}.json`,
      receipt,
    );
    state.design.affectedAreas = ["common"];
    state.knowledge.areas = [area];
    state.approvals = [{
      ...receipt,
      receiptPath: receiptArtifact.path,
      receiptSha256: receiptArtifact.sha256,
    }];
    await rewritePhaseResultPayload(forgedKnowledge, state, "technical-design");
    await writeJson(forgedKnowledge.root, forgedKnowledge.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: forgedKnowledge.root, stateFile: forgedKnowledge.stateFile }),
      /subject|approval.*identity/i,
    );
  } finally {
    await rm(forgedKnowledge.root, { recursive: true, force: true });
  }
}

async function testUnsafePathsFail() {
  const fixture = await createCompletedFixture();
  try {
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: path.join(fixture.root, fixture.stateFile) }),
      /relative|state/i,
    );
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: ".harness/states/../../outside.json" }),
      /inside|states|relative/i,
    );

    const state = await readJson(fixture.root, fixture.stateFile);
    state.delivery.summaryFile = "../outside.md";
    await rewritePhaseResultPayload(fixture, state, "delivery-preparation");
    await writeJson(fixture.root, fixture.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /inside|relative|path/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testSymlinkEvidenceFailsWhenSupported() {
  const fixture = await createCompletedFixture();
  try {
    const target = path.join(fixture.root, "outside-evidence.md");
    await writeFile(target, "outside\n", "utf8");
    const linkPath = path.join(fixture.root, `.harness/runs/${fixture.storyId}/evidence/link.md`);
    await mkdir(path.dirname(linkPath), { recursive: true });
    try {
      await symlink(target, linkPath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) {
        console.log("M7D-PATH-SKIP:file-symlink-not-supported");
        return;
      }
      throw error;
    }
    const linkInfo = await lstat(linkPath);
    assert.equal(linkInfo.isSymbolicLink(), true);
    const linkSource = await readFile(linkPath);
    const state = await readJson(fixture.root, fixture.stateFile);
    state.verification.environment.evidencePath =
      `.harness/runs/${fixture.storyId}/evidence/link.md`;
    state.verification.environment.evidenceSha256 = sha256(linkSource);
    await rewritePhaseResultPayload(fixture, state, "interface-verification");
    await writeJson(fixture.root, fixture.stateFile, state);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /symbolic|junction|reparse|safe/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testStateSymlinkAndExternalJunctionFailWhenSupported() {
  const stateLinkFixture = await createCompletedFixture();
  try {
    const originalPath = path.join(stateLinkFixture.root, stateLinkFixture.stateFile);
    const targetPath = path.join(
      stateLinkFixture.root,
      ".harness/states/e2e-M7-D-CLOSURE-target.json",
    );
    await writeFile(targetPath, await readFile(originalPath));
    await rm(originalPath);
    try {
      await symlink(targetPath, originalPath, "file");
      await assert.rejects(
        verifyStoryClosure({ root: stateLinkFixture.root, stateFile: stateLinkFixture.stateFile }),
        /symbolic|junction|reparse|safe/i,
      );
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) {
        console.log("M7D-PATH-SKIP:state-symlink-not-supported");
      } else {
        throw error;
      }
    }
  } finally {
    await rm(stateLinkFixture.root, { recursive: true, force: true });
  }

  const junctionFixture = await createCompletedFixture();
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "frontier-story-closure-outside-"));
  try {
    const externalEvidence = path.join(externalRoot, "evidence.txt");
    await writeFile(externalEvidence, "external evidence\n", "utf8");
    const junctionPath = path.join(
      junctionFixture.root,
      `.harness/runs/${junctionFixture.storyId}/evidence/external`,
    );
    await mkdir(path.dirname(junctionPath), { recursive: true });
    try {
      await symlink(externalRoot, junctionPath, "junction");
      const source = await readFile(externalEvidence);
      const state = await readJson(junctionFixture.root, junctionFixture.stateFile);
      state.verification.environment.evidencePath =
        `.harness/runs/${junctionFixture.storyId}/evidence/external/evidence.txt`;
      state.verification.environment.evidenceSha256 = sha256(source);
      await rewritePhaseResultPayload(junctionFixture, state, "interface-verification");
      await writeJson(junctionFixture.root, junctionFixture.stateFile, state);
      await assert.rejects(
        verifyStoryClosure({ root: junctionFixture.root, stateFile: junctionFixture.stateFile }),
        /symbolic|junction|outside|reparse|safe/i,
      );
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) {
        console.log("M7D-PATH-SKIP:junction-not-supported");
      } else {
        throw error;
      }
    }
  } finally {
    await rm(junctionFixture.root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
}

async function testDirectoryCannotMasqueradeAsEvidence() {
  const fixture = await createCompletedFixture();
  try {
    const state = await readJson(fixture.root, fixture.stateFile);
    const summaryPath = path.join(fixture.root, state.delivery.summaryFile);
    await rm(summaryPath);
    await mkdir(summaryPath);
    await assert.rejects(
      verifyStoryClosure({ root: fixture.root, stateFile: fixture.stateFile }),
      /regular file|safe regular file/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await testCompletedStateProducesClosureSummary();
  await testBuildArtifactMayLiveOutsideEvidenceDirectories();
  await testMissingClosureFactsFail();
  await testEvidenceDriftFails();
  await testNormalizedCrossAttemptRecordSubstitutionFails();
  await testCrossAttemptRecordSubstitutionFails();
  await testRelocatedResultFails();
  await testCrossPhaseOutputSubstitutionFails();
  await testNestedResultOutputDriftFails();
  await testStateProjectionDriftFails();
  await testApprovalSemanticsRejectForgery();
  await testUnsafePathsFail();
  await testSymlinkEvidenceFailsWhenSupported();
  await testStateSymlinkAndExternalJunctionFailWhenSupported();
  await testDirectoryCannotMasqueradeAsEvidence();
  console.log("story closure verifier tests passed");
}
