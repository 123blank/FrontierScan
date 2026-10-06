import assert from "node:assert/strict";
import {
  captureDevelopmentBaseline,
  createDevelopmentContextCandidate,
  validateDevelopmentContextInputs,
} from "../lib/development-provider-context.mjs";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const COMMIT = "a".repeat(40);
const DISPATCH_ID = "30000000-0000-4000-8000-000000000003";
const WORKTREE = "D:/ProjectStudy/FrontierScan/.harness/worktrees/STORY-1/T1";
const NOW = "2026-08-22T14:00:00.000Z";

function state() {
  return {
    schemaVersion: "2.0",
    storyId: "STORY-1",
    phase: "implementation",
    runtime: { runId: "STORY-1", status: "active", revision: 4 },
    requirement: {
      acceptanceCriteria: [{
        criterionId: "AC-1",
        description: "目标行为",
        source: "fixture",
        required: true,
      }],
    },
    knowledge: {
      areas: [{
        area: "backend",
        relevant: true,
        status: "fresh",
        loadedFiles: ["llm-knowledge/backend/meta.yaml"],
      }],
    },
    dag: {
      sourceFile: ".harness/runs/STORY-1/phases/02-task-dag/task-dag.json",
      sourceSha256: SHA_A,
      nodes: [{
        taskId: "T1",
        title: "实现服务",
        type: "backend",
        status: "pending",
        ownerAgent: "backend-developer",
        predictedFiles: ["backend/src/main/java/example/Service.java"],
        criterionIds: ["AC-1"],
      }],
    },
  };
}

function task() {
  return {
    schemaVersion: "2.0",
    dispatchId: DISPATCH_ID,
    storyId: "STORY-1",
    runId: "STORY-1",
    phase: "implementation",
    ownerAgent: "backend-developer",
    preparedRevision: 4,
    attemptRoot: `.harness/runs/STORY-1/phases/03-implementation/attempts/${DISPATCH_ID}`,
    resultFile: `.harness/runs/STORY-1/phases/03-implementation/attempts/${DISPATCH_ID}/result.json`,
  };
}

function plan() {
  return {
    schemaVersion: "1.0",
    storyId: "STORY-1",
    runId: "STORY-1",
    taskId: "T1",
    ownerAgent: "backend-developer",
    taskDagFile: ".harness/runs/STORY-1/phases/02-task-dag/task-dag.json",
    taskDagSha256: SHA_A,
    baseCommit: COMMIT,
    branch: "harness/STORY-1/T1",
    worktreePath: ".harness/worktrees/STORY-1/T1",
    predictedFiles: ["backend/src/main/java/example/Service.java"],
  };
}

function status() {
  return {
    schemaVersion: "1.0",
    storyId: "STORY-1",
    runId: "STORY-1",
    taskId: "T1",
    state: "created",
    branch: "harness/STORY-1/T1",
    worktreePath: ".harness/worktrees/STORY-1/T1",
    baseCommit: COMMIT,
    headCommit: COMMIT,
  };
}

function policy() {
  return {
    name: "backend-developer",
    category: "execution",
    readPathPrefixes: ["AGENTS.md", ".harness/", "docs/", "llm-knowledge/", "backend/"],
    writePathPrefixes: [".harness/runs/", "backend/src/"],
    capabilities: ["phase-output", "backend-write"],
  };
}

function baseline() {
  return {
    schemaVersion: "1.0",
    branch: "harness/STORY-1/T1",
    headCommit: COMMIT,
    baseCommit: COMMIT,
    gitDir: "D:/repo/.git/worktrees/T1",
    gitCommonDir: "D:/repo/.git",
    gitFileSha256: SHA_A,
    indexSha256: SHA_A,
    configSha256: SHA_A,
    packedRefsSha256: null,
    refsSha256: SHA_A,
    gitStatusSha256: SHA_A,
    dirtyPaths: [],
    trackedFilesSha256: SHA_A,
    untrackedFilesSha256: SHA_A,
    ignoredMetadataSha256: SHA_A,
    predictedTargets: [{
      path: "backend/src/main/java/example/Service.java",
      baseSha256: SHA_B,
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

function inputs() {
  return {
    state: state(),
    task: task(),
    taskFile: `.harness/runs/STORY-1/phases/03-implementation/attempts/${DISPATCH_ID}/task.json`,
    worktreePlan: plan(),
    worktreePlanSha256: SHA_A,
    worktreeStatus: status(),
    worktreeStatusSha256: SHA_B,
    policy: policy(),
    baseline: baseline(),
  };
}

function testRoleAndTaskGate() {
  assert.equal(validateDevelopmentContextInputs(inputs()).node.taskId, "T1");

  const frontend = inputs();
  frontend.task.ownerAgent = "frontend-developer";
  frontend.state.dag.nodes[0].ownerAgent = "frontend-developer";
  frontend.worktreePlan.ownerAgent = "frontend-developer";
  frontend.policy.name = "frontend-developer";
  assert.equal(validateDevelopmentContextInputs(frontend).node.ownerAgent, "frontend-developer");

  const wrongPhase = inputs();
  wrongPhase.state.phase = "unit-test";
  assert.throws(() => validateDevelopmentContextInputs(wrongPhase), /phase.*implementation/i);

  const multiple = inputs();
  multiple.state.dag.nodes.push({...multiple.state.dag.nodes[0], taskId: "T2"});
  assert.throws(() => validateDevelopmentContextInputs(multiple), /exactly one pending/i);

  const wrongOwner = inputs();
  wrongOwner.state.dag.nodes[0].ownerAgent = "code-reviewer";
  assert.throws(() => validateDevelopmentContextInputs(wrongOwner), /owner.*developer/i);

  const missingCriterion = inputs();
  missingCriterion.state.dag.nodes[0].criterionIds = ["AC-MISSING"];
  assert.throws(() => validateDevelopmentContextInputs(missingCriterion), /criterion/i);
}

function testWorktreeGate() {
  for (const [mutate, pattern] of [
    [(value) => { value.worktreeStatus.state = "absent"; }, /created/i],
    [(value) => { value.worktreeStatus.headCommit = "b".repeat(40); }, /HEAD|headCommit/i],
    [(value) => { value.baseline.dirtyPaths = ["backend/tmp.txt"]; }, /initially clean|dirty/i],
    [(value) => { value.baseline.gitFileSha256 = null; }, /\.git.*hash/i],
    [(value) => { value.baseline.lockFiles = ["integrate.lock"]; }, /lock/i],
  ]) {
    const value = inputs();
    mutate(value);
    assert.throws(() => validateDevelopmentContextInputs(value), pattern);
  }
}

async function testContextBoundary() {
  const requested = [];
  const candidate = await createDevelopmentContextCandidate({
    ...inputs(),
    worktreePath: WORKTREE,
    now: () => NOW,
    loadEntry: async (path, purpose, source) => {
      requested.push(path);
      return {
        path,
        sha256: SHA_A,
        bytes: 10,
        purpose,
        source,
      };
    },
  });
  assert.equal(candidate.manifest.role, "backend-developer");
  assert.deepEqual(candidate.manifest.predictedFiles, ["backend/src/main/java/example/Service.java"]);
  assert.equal(candidate.manifest.worktree.path, WORKTREE);
  assert.equal(requested.includes(".harness/config/agent-providers.local.json"), false);
  assert.equal(requested.includes(".env"), false);
  assert.equal(requested.some((path) => path.startsWith("frontend/")), false);

  const overlapping = inputs();
  overlapping.state.knowledge.areas[0].loadedFiles.push(
    "backend/src/main/java/example/Service.java",
  );
  const overlappingCandidate = await createDevelopmentContextCandidate({
    ...overlapping,
    worktreePath: WORKTREE,
    now: () => NOW,
    loadEntry: async (path, purpose, source) => ({
      path,
      sha256: SHA_A,
      bytes: 10,
      purpose,
      source,
    }),
  });
  const serviceEntries = overlappingCandidate.manifest.entries.filter(
    (entry) => entry.path === "backend/src/main/java/example/Service.java",
  );
  assert.equal(serviceEntries.length, 1);
  assert.equal(serviceEntries[0].source, "source");

  const stale = inputs();
  stale.state.knowledge.areas[0].status = "stale";
  await assert.rejects(
    createDevelopmentContextCandidate({...stale, worktreePath: WORKTREE}),
    /knowledge.*stale/i,
  );
}

function testBaselineGate() {
  const value = validateDevelopmentContextInputs(inputs());
  assert.equal(value.baseline.refsSha256, SHA_A);
  assert.equal(value.baseline.gitCommonDir, "D:/repo/.git");
  assert.equal(value.baseline.buildOutputs[0].state, "absent");

  const missingRefEvidence = inputs();
  missingRefEvidence.baseline.refsSha256 = null;
  assert.throws(() => validateDevelopmentContextInputs(missingRefEvidence), /refsSha256/i);
}

async function testBaselineCapture() {
  const commands = new Map([
    ["rev-parse --abbrev-ref HEAD", "harness/STORY-1/T1\n"],
    ["rev-parse HEAD", `${COMMIT}\n`],
    ["rev-parse --git-dir", "D:/repo/.git/worktrees/T1\n"],
    ["rev-parse --git-common-dir", "D:/repo/.git\n"],
    ["status --porcelain=v1 -z --untracked-files=all", ""],
    ["ls-files -z", "backend/src/main/java/example/Service.java\0"],
    ["ls-files --others --exclude-standard -z", ""],
    ["ls-files --others -i --exclude-standard -z", "backend/target/\0"],
    ["for-each-ref --format=%(refname)%00%(objectname)%00%(symref)", `refs/heads/harness/STORY-1/T1\u0000${COMMIT}\u0000\n`],
    [`show ${COMMIT}:backend/src/main/java/example/Service.java`, "class Service {}\n"],
  ]);
  const captured = await captureDevelopmentBaseline({
    worktreePath: WORKTREE,
    baseCommit: COMMIT,
    predictedFiles: ["backend/src/main/java/example/Service.java"],
    buildOutputPaths: ["backend/target"],
    lockPaths: ["create.lock", "integrate.lock"],
    now: () => NOW,
    runGit: async (args) => {
      const key = args.join(" ");
      if (!commands.has(key)) throw new Error(`Unexpected Git command: ${key}`);
      return commands.get(key);
    },
    readEvidence: async (path) => {
      if (path.endsWith("/packed-refs")) return null;
      if (path.endsWith("create.lock") || path.endsWith("integrate.lock")) return null;
      if (path.endsWith("/index.lock")) return {sha256: SHA_B};
      if (path.endsWith("/config.lock") || path.endsWith("/packed-refs.lock")) return null;
      return {sha256: SHA_A};
    },
    ignoredMetadata: async () => ({sha256: SHA_A}),
    buildOutput: async (path) => ({
      path,
      state: "absent",
      sha256: null,
    }),
  });
  assert.equal(captured.branch, "harness/STORY-1/T1");
  assert.equal(captured.gitCommonDir, "D:/repo/.git");
  assert.equal(captured.refsSha256.startsWith("sha256:"), true);
  assert.equal(captured.predictedTargets[0].baseSha256.startsWith("sha256:"), true);
  assert.deepEqual(captured.lockFiles, ["D:/repo/.git/worktrees/T1/index.lock"]);
}

testRoleAndTaskGate();
testWorktreeGate();
await testContextBoundary();
testBaselineGate();
await testBaselineCapture();
console.log("development-provider-context tests passed");
