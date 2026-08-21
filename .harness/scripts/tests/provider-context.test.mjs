import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertProviderContextAttempt,
  buildProviderInlineData,
  collectTaskOwnedDiff,
  createProviderContextCandidate,
  projectProviderReviewState,
} from "../lib/provider-context.mjs";

const DISPATCH_ID = "40000000-0000-4000-8000-000000000004";
const NOW = "2026-08-19T05:00:00.000Z";

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function policy(overrides = {}) {
  return {
    name: "code-reviewer",
    category: "review",
    readPathPrefixes: [
      "AGENTS.md",
      ".harness/",
      ".codex/skills/",
      "docs/",
      "llm-knowledge/",
      "backend/",
      "frontend/",
    ],
    writePathPrefixes: [],
    capabilities: [
      "phase-output",
    ],
    ...overrides,
  };
}

function task(storyId = "M8-A-CTX") {
  const attemptRoot = `.harness/runs/${storyId}/phases/05-code-review/attempts/${DISPATCH_ID}`;
  return {
    schemaVersion: "2.0",
    dispatchId: DISPATCH_ID,
    storyId,
    runId: storyId,
    phase: "code-review",
    ownerAgent: "code-reviewer",
    purpose: "Review the task-owned implementation diff.",
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

function state(storyId = "M8-A-CTX") {
  return {
    schemaVersion: "2.0",
    storyId,
    phase: "code-review",
    runtime: {
      runId: storyId,
      revision: 6,
      status: "active",
    },
    baseline: {
      head: "a".repeat(40),
      branch: "dev",
      initialDirtyPaths: [
        {
          path: "docs/unrelated.md",
          indexStatus: " ",
          worktreeStatus: "M",
          untracked: false,
        },
      ],
    },
    requirement: {
      acceptanceCriteria: [
        {
          criterionId: "AC-CTX",
          description: "Reviewer receives only bounded task-owned context.",
          source: "fixture",
          required: true,
        },
      ],
    },
    design: {
      decisions: [
        {
          decisionId: "TD-CTX",
          summary: "Freeze context before provider execution.",
          rationale: "Prevent context drift.",
        },
      ],
    },
    dag: {
      sourceFile: `.harness/runs/${storyId}/phases/02-task-dag/task-dag.json`,
      sourceSha256: `sha256:${"b".repeat(64)}`,
      nodes: [
        {
          taskId: "T-CTX",
          title: "Build context",
          type: "integration",
          status: "done",
          ownerAgent: "backend-developer",
          predictedFiles: [
            ".harness/scripts/lib/provider-context.mjs",
          ],
          criterionIds: [
            "AC-CTX",
          ],
        },
      ],
    },
    implementation: {
      actualFiles: [
        ".harness/scripts/lib/provider-context.mjs",
        "backend/src/main/java/example/Changed.java",
        ".harness/states/e2e-M8-A-CTX.json",
        `.harness/runs/${storyId}/phases/04-unit-test/test-report.md`,
        `.harness/runs/${storyId}/phases/04-unit-test/attempts/test/evidence/result.json`,
        "llm-knowledge/common/meta.yaml",
        "docs/unrelated.md",
      ],
    },
    tests: {
      cases: [
        {
          caseId: "TC-CTX",
          type: "harness",
          required: true,
          criterionIds: [
            "AC-CTX",
          ],
          description: "Context is bounded.",
        },
      ],
      results: [
        {
          caseId: "TC-CTX",
          status: "passed",
          actual: "Context fixture passed.",
          evidencePath: `.harness/runs/${storyId}/phases/04-unit-test/attempts/test/evidence/result.json`,
          evidenceSha256: `sha256:${"c".repeat(64)}`,
          executedAt: NOW,
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
          sourceFingerprint: `sha256:${"d".repeat(64)}`,
          loadedFiles: [
            "llm-knowledge/common/meta.yaml",
          ],
          missing: [],
          checkedAt: NOW,
          freshnessEvidencePath: `.harness/runs/${storyId}/knowledge/common.json`,
          freshnessEvidenceSha256: `sha256:${"e".repeat(64)}`,
          refreshTaskPath: null,
          refreshTaskSha256: null,
          refreshReceiptPath: null,
          refreshReceiptSha256: null,
          approvalId: null,
        },
        {
          area: "backend",
          relevant: false,
          observedStatus: "stale",
          status: "not-relevant",
          sourceFingerprint: `sha256:${"f".repeat(64)}`,
          loadedFiles: [
            "llm-knowledge/backend/meta.yaml",
          ],
          missing: [],
          checkedAt: NOW,
          freshnessEvidencePath: `.harness/runs/${storyId}/knowledge/backend.json`,
          freshnessEvidenceSha256: `sha256:${"1".repeat(64)}`,
          refreshTaskPath: null,
          refreshTaskSha256: null,
          refreshReceiptPath: null,
          refreshReceiptSha256: null,
          approvalId: null,
        },
      ],
    },
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-provider-context-"));
  const preparedTask = task();
  const preparedState = state();
  const taskFile = `${preparedTask.attemptRoot}/task.json`;
  await write(root, taskFile, `${JSON.stringify(preparedTask, null, 2)}\n`);
  await write(root, preparedState.dag.sourceFile, `${JSON.stringify({
    schemaVersion: "2.0",
    storyId: preparedState.storyId,
    nodes: preparedState.dag.nodes,
    edges: [],
    waves: [["T-CTX"]],
    globalChanges: [],
    risks: [],
  }, null, 2)}\n`);
  await write(root, "AGENTS.md", "# Project rules\n");
  await write(root, ".codex/skills/frontier-code-review-gate/SKILL.md", "# Review skill\n");
  await write(
    root,
    ".codex/skills/frontier-code-review-gate/references/review-checklist.md",
    "# Review checklist\n",
  );
  await write(root, "llm-knowledge/common/meta.yaml", "status: fresh\n");
  await write(root, "llm-knowledge/backend/meta.yaml", "status: stale\n");
  await write(root, ".harness/scripts/lib/provider-context.mjs", "export const candidate = true;\n");
  await write(root, "backend/src/main/java/example/Changed.java", "class Changed {}\n");
  await write(root, ".harness/states/e2e-M8-A-CTX.json", "{}\n");
  await write(root, `.harness/runs/${preparedState.storyId}/phases/04-unit-test/test-report.md`, "# Tests\n");
  await write(
    root,
    `.harness/runs/${preparedState.storyId}/phases/04-unit-test/attempts/test/evidence/result.json`,
    '{"status":"passed"}\n',
  );
  await write(root, "docs/unrelated.md", "user change\n");
  return {
    root,
    state: preparedState,
    task: preparedTask,
    taskFile,
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

function diffCollector(overrides = {}) {
  return async ({ files, baselineHead }) => {
    assert.equal(baselineHead, "a".repeat(40));
    assert.deepEqual(files, [
      ".harness/scripts/lib/provider-context.mjs",
      "backend/src/main/java/example/Changed.java",
    ]);
    const first = "export const candidate = true;\n";
    const second = "class Changed {}\n";
    return {
      diffText: [
        "diff --git a/.harness/scripts/lib/provider-context.mjs b/.harness/scripts/lib/provider-context.mjs",
        "+export const candidate = true;",
        "diff --git a/backend/src/main/java/example/Changed.java b/backend/src/main/java/example/Changed.java",
        "+class Changed {}",
        "",
      ].join("\n"),
      targets: [
        {
          path: ".harness/scripts/lib/provider-context.mjs",
          sha256: sha256(first),
          changeKind: "added",
        },
        {
          path: "backend/src/main/java/example/Changed.java",
          sha256: sha256(second),
          changeKind: "modified",
        },
      ],
      ...overrides,
    };
  };
}

async function buildCandidate(fixture, overrides = {}) {
  return createProviderContextCandidate({
    root: fixture.root,
    state: fixture.state,
    task: fixture.task,
    taskFile: fixture.taskFile,
    policy: policy(),
    now: () => NOW,
    collectDiff: diffCollector(),
    ...overrides,
  });
}

async function testAttemptIdentity() {
  await withFixture(async (fixture) => {
    await assert.doesNotReject(assertProviderContextAttempt(fixture));

    for (const [mutate, pattern] of [
      [(candidate) => { candidate.state.schemaVersion = "1.0"; }, /State v2/i],
      [(candidate) => { candidate.state.phase = "implementation"; }, /phase.*code-review/i],
      [(candidate) => { candidate.task.ownerAgent = "backend-developer"; }, /owner.*code-reviewer/i],
      [(candidate) => { candidate.task.dispatchId = "50000000-0000-4000-8000-000000000005"; }, /task file.*dispatch|identity/i],
      [(candidate) => { candidate.task.storyId = "OTHER"; }, /story.*identity/i],
      [(candidate) => { candidate.task.runId = "OTHER"; }, /run.*identity/i],
      [(candidate) => { candidate.task.preparedRevision = 5; }, /revision/i],
    ]) {
      const candidate = {
        ...fixture,
        state: structuredClone(fixture.state),
        task: structuredClone(fixture.task),
      };
      mutate(candidate);
      await assert.rejects(assertProviderContextAttempt(candidate), pattern);
    }

    await write(fixture.root, fixture.task.resultFile, "{}\n");
    await assert.rejects(
      assertProviderContextAttempt(fixture),
      /result.*already exists/i,
    );
  });
}

async function testMinimalContextAndStateProjection() {
  await withFixture(async (fixture) => {
    const candidate = await buildCandidate(fixture);
    const sources = new Set(candidate.manifest.entries.map((entry) => entry.source));
    assert.deepEqual(
      sources,
      new Set([
        "task",
        "state",
        "dag",
        "project-rule",
        "policy",
        "knowledge",
        "diff",
        "test-evidence",
      ]),
    );
    assert.equal(candidate.manifest.totalBytes, candidate.manifest.entries.reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    ));
    assert.equal(
      candidate.manifestFile,
      `${fixture.task.attemptRoot}/provider/context-manifest.json`,
    );
    assert.equal(candidate.manifest.reviewTargets.length, 2);

    const projected = projectProviderReviewState(fixture.state);
    assert.deepEqual(Object.keys(projected), [
      "storyId",
      "runId",
      "phase",
      "revision",
      "acceptanceCriteria",
      "designDecisions",
      "dag",
      "implementation",
      "tests",
      "knowledge",
    ]);
    assert.equal(Object.hasOwn(projected, "logs"), false);
    assert.equal(Object.hasOwn(projected, "delivery"), false);

    const inline = await buildProviderInlineData({
      root: fixture.root,
      candidate,
      policy: policy(),
    });
    assert.match(inline, /Project rules/);
    assert.match(inline, /Review checklist/);
    assert.match(inline, /## diff: .*task-owned\.diff/i);
    assert.doesNotMatch(inline, /user change/);
  });
}

async function testKnowledgeGate() {
  await withFixture(async (fixture) => {
    const accepted = structuredClone(fixture.state);
    accepted.knowledge.areas[0].observedStatus = "stale";
    accepted.knowledge.areas[0].status = "accepted-stale";
    accepted.knowledge.areas[0].approvalId = "APR-CTX";
    const candidate = await buildCandidate(fixture, { state: accepted });
    assert.deepEqual(candidate.manifest.knowledgeAreas, [
      {
        area: "common",
        status: "accepted-stale",
        loadedFiles: [
          "llm-knowledge/common/meta.yaml",
        ],
      },
    ]);
    assert.match(await buildProviderInlineData({
      root: fixture.root,
      candidate,
      policy: policy(),
    }), /accepted-stale/);

    for (const status of ["stale", "missing"]) {
      const blocked = structuredClone(fixture.state);
      blocked.knowledge.areas[0].observedStatus = status;
      blocked.knowledge.areas[0].status = status;
      await assert.rejects(
        buildCandidate(fixture, { state: blocked }),
        new RegExp(`knowledge.*common.*${status}`, "i"),
      );
    }

    const notRelevant = await buildCandidate(fixture);
    assert.equal(
      notRelevant.manifest.entries.some((entry) => entry.path === "llm-knowledge/backend/meta.yaml"),
      false,
    );
  });
}

async function testPathAndSizeBoundaries() {
  await withFixture(async (fixture) => {
    await assert.rejects(
      buildCandidate(fixture, {
        policy: policy({
          readPathPrefixes: [
            ".harness/",
            ".codex/skills/",
            "llm-knowledge/",
            "backend/",
          ],
        }),
      }),
      /AGENTS\.md.*read policy/i,
    );
  });

  await withFixture(async (fixture) => {
    await write(fixture.root, "AGENTS.md", "x".repeat((2 * 1024 * 1024) + 1));
    await assert.rejects(buildCandidate(fixture), /AGENTS\.md.*2 MiB/i);
  });

  await withFixture(async (fixture) => {
    const loadedFiles = [];
    for (let index = 0; index < 5; index += 1) {
      const file = `llm-knowledge/common/large-${index}.md`;
      loadedFiles.push(file);
      await write(fixture.root, file, "x".repeat(1_800_000));
    }
    fixture.state.knowledge.areas[0].loadedFiles = loadedFiles;
    await assert.rejects(buildCandidate(fixture), /8 MiB/i);
  });

  await withFixture(async (fixture) => {
    await write(fixture.root, "AGENTS.md", Buffer.from([0xff, 0xfe, 0xfd]));
    await assert.rejects(buildCandidate(fixture), /AGENTS\.md.*UTF-8/i);
  });

  await withFixture(async (fixture) => {
    await rm(path.join(fixture.root, "llm-knowledge/common/meta.yaml"));
    await symlink(
      path.join(fixture.root, "AGENTS.md"),
      path.join(fixture.root, "llm-knowledge/common/meta.yaml"),
      "file",
    );
    await assert.rejects(buildCandidate(fixture), /symbolic link|reparse point/i);
  });

  await withFixture(async (fixture) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "frontier-provider-context-outside-"));
    try {
      await write(outside, "meta.yaml", "outside\n");
      await rm(path.join(fixture.root, "llm-knowledge/common"), { recursive: true, force: true });
      await symlink(outside, path.join(fixture.root, "llm-knowledge/common"), "junction");
      await assert.rejects(buildCandidate(fixture), /symbolic link|reparse point/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  await withFixture(async (fixture) => {
    fixture.state.knowledge.areas[0].loadedFiles = ["llm-knowledge/common"];
    await assert.rejects(buildCandidate(fixture), /regular file/i);
  });

  await withFixture(async (fixture) => {
    fixture.state.knowledge.areas[0].loadedFiles = ["../secret.env"];
    await assert.rejects(buildCandidate(fixture), /repository-relative path|repository root/i);
  });
}

async function testReviewTargetsOnlyUseTaskOwnedDiff() {
  await withFixture(async (fixture) => {
    const candidate = await buildCandidate(fixture);
    assert.deepEqual(candidate.manifest.reviewTargets.map((target) => target.path), [
      ".harness/scripts/lib/provider-context.mjs",
      "backend/src/main/java/example/Changed.java",
    ]);
    for (const excluded of [
      ".harness/states/e2e-M8-A-CTX.json",
      `.harness/runs/${fixture.state.storyId}/phases/04-unit-test/test-report.md`,
      `.harness/runs/${fixture.state.storyId}/phases/04-unit-test/attempts/test/evidence/result.json`,
      "llm-knowledge/common/meta.yaml",
      "docs/unrelated.md",
    ]) {
      assert.equal(
        candidate.manifest.reviewTargets.some((target) => target.path === excluded),
        false,
      );
    }
  });

  await withFixture(async (fixture) => {
    const extraTarget = {
      path: "docs/unrelated.md",
      sha256: sha256("user change\n"),
      changeKind: "modified",
    };
    await assert.rejects(
      buildCandidate(fixture, {
        collectDiff: diffCollector({
          targets: [
            ...(await diffCollector()({
              files: [
                ".harness/scripts/lib/provider-context.mjs",
                "backend/src/main/java/example/Changed.java",
              ],
              baselineHead: "a".repeat(40),
            })).targets,
            extraTarget,
          ],
        }),
      }),
      /diff target.*not task-owned|initial dirty/i,
    );
  });
}

async function testDeletedReviewTargetRequiresUtf8Baseline() {
  const baselineHead = "a".repeat(40);
  const relativePath = "backend/src/main/resources/deleted.bin";
  const runGit = async (_root, args) => {
    if (args[0] === "status") return ` D ${relativePath}\n`;
    if (args[0] === "diff") {
      return [
        `diff --git a/${relativePath} b/${relativePath}`,
        "deleted file mode 100644",
        "--- a/backend/src/main/resources/deleted.bin",
        "+++ /dev/null",
        "",
      ].join("\n");
    }
    if (args[0] === "show") return Buffer.from([0xff, 0xfe, 0xfd]);
    throw new Error(`Unexpected git args: ${args.join(" ")}`);
  };

  await assert.rejects(
    collectTaskOwnedDiff({
      root: ".",
      files: [relativePath],
      baselineHead,
      runGit,
    }),
    /deleted.*UTF-8|baseline.*UTF-8/i,
  );
}

await testAttemptIdentity();
await testMinimalContextAndStateProjection();
await testKnowledgeGate();
await testPathAndSizeBoundaries();
await testReviewTargetsOnlyUseTaskOwnedDiff();
await testDeletedReviewTargetRequiresUtf8Baseline();
console.log("provider-context tests passed");
