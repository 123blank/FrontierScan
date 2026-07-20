import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDispatchResultStructure,
  validateDispatchTaskStructure,
} from "../lib/dispatch-contract.mjs";
import { runStateCommand } from "../lib/state-runtime.mjs";
import { runStoryCommand } from "../lib/story-runtime.mjs";
import { loadWorkerPolicies, runWorkerTask } from "../lib/worker-runtime.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DISPATCH_ID = "00000000-0000-4000-8000-000000000001";
const FIXED_NOW = "2026-07-17T00:00:00.000Z";

async function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function dispatchTask(overrides = {}) {
  return {
    schemaVersion: "1.0",
    dispatchId: DISPATCH_ID,
    storyId: "M4-B-TEST",
    phase: "requirement",
    ownerAgent: "requirement-analyst",
    purpose: "Clarify the story.",
    preparedRevision: 1,
    preparedAt: "2026-07-17T00:00:00.000Z",
    expectedOutputs: [".harness/runs/M4-B-TEST/phases/00-requirement/requirement-breakdown.md"],
    allowedAdapters: [],
    next: "technical-design",
    ...overrides,
  };
}

function dispatchResult(task, overrides = {}) {
  return {
    schemaVersion: "1.0",
    dispatchId: task.dispatchId,
    storyId: task.storyId,
    phase: task.phase,
    status: "completed",
    summary: "Mock worker completed the phase.",
    outputs: task.expectedOutputs.map((output) => ({ path: output })),
    records: [],
    ...overrides,
  };
}

const AGENTS = `schema_version: "1.0"
agents:
  - name: requirement-analyst
    category: planning
    responsibilities:
      - Clarify a story.
    may_modify_files: true
  - name: code-reviewer
    category: review
    responsibilities:
      - Review changes.
    may_modify_files: false
`;

function policies(overrides = {}) {
  return {
    schemaVersion: "1.0",
    roles: [
      {
        name: "requirement-analyst",
        category: "planning",
        readPathPrefixes: [".harness/", "docs/"],
        writePathPrefixes: [".harness/runs/"],
        capabilities: ["phase-output"],
      },
      {
        name: "code-reviewer",
        category: "review",
        readPathPrefixes: [".harness/", "backend/", "frontend/"],
        writePathPrefixes: [".harness/runs/"],
        capabilities: ["phase-output"],
      },
    ],
    ...overrides,
  };
}

async function createPolicyFixture(value = policies(), agents = AGENTS) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-worker-policy-"));
  await write(root, ".codex/agents/agents.yaml", agents);
  await write(root, ".codex/agents/worker-policies.json", `${JSON.stringify(value, null, 2)}\n`);
  return root;
}

async function createWorkerFixture() {
  const root = await createPolicyFixture();
  const task = dispatchTask();
  const taskFile = `.harness/runs/${task.storyId}/phases/00-requirement/task.json`;
  await write(root, taskFile, `${JSON.stringify(task, null, 2)}\n`);
  return { root, task, taskFile };
}

async function createVerticalFixture(storyId = "M4-B-VERTICAL") {
  const root = await createPolicyFixture();
  const template = {
    schemaVersion: "1.0",
    storyId: "S1",
    phase: "requirement",
    requirement: { summary: "", openQuestions: [], acceptanceCriteria: [] },
    knowledge: { loadedFiles: [], staleFiles: [], missingAreas: [] },
    tasks: [],
    dag: { nodes: [], edges: [], waves: [] },
    worktrees: [],
    tests: { commands: [], results: [] },
    review: { findings: [], status: "pending" },
    verification: { cases: [], results: [] },
    delivery: { ownedFiles: [], commit: null, pr: null },
    logs: [],
  };
  await write(root, ".harness/states/e2e-state.template.json", `${JSON.stringify(template, null, 2)}\n`);
  await write(root, ".harness/workflows/e2e-development.yaml", `schema_version: "1.0"
name: frontier-e2e-development
phases:
  - id: requirement
    order: 0
    owner_agent: requirement-analyst
    purpose: Clarify the story.
    required_outputs:
      - .harness/runs/{runId}/phases/00-requirement/requirement-breakdown.md
    next:
      - technical-design
  - id: technical-design
    order: 1
    owner_agent: requirement-analyst
    purpose: Design the change.
    required_outputs:
      - .harness/runs/{runId}/phases/01-technical-design/technical-design.md
    next:
      - done
quality_gates: []
`);
  await runStateCommand({ root, command: "init", storyId, summary: "M4-B fixture", now: () => FIXED_NOW });
  const prepared = await runStoryCommand({
    root,
    command: "prepare",
    now: () => FIXED_NOW,
    randomUUID: () => DISPATCH_ID,
  });
  return { root, storyId, prepared };
}

async function exists(root, relativePath) {
  return access(path.join(root, relativePath)).then(() => true, () => false);
}

async function testDispatchContractsValidateSchemaShape() {
  const task = dispatchTask();
  const result = dispatchResult(task);
  assert.equal(validateDispatchTaskStructure(task), task);
  assert.equal(validateDispatchResultStructure(result), result);

  assert.throws(
    () => validateDispatchTaskStructure({ ...task, unexpected: true }),
    /unsupported field|additional/i,
  );
  assert.throws(
    () => validateDispatchResultStructure({ ...result, status: "unknown" }),
    /status/i,
  );
  assert.throws(
    () => validateDispatchResultStructure({ ...result, outputs: [...result.outputs, result.outputs[0]] }),
    /unique|duplicate/i,
  );
}

async function testRepositoryWorkerPoliciesMatchAgentRegistry() {
  const loaded = await loadWorkerPolicies({ root: REPOSITORY_ROOT });
  assert.equal(loaded.size, 12);
  assert.deepEqual(
    loaded.get("code-reviewer").capabilities,
    ["phase-output"],
  );
  assert.deepEqual(
    loaded.get("code-fixer").capabilities,
    ["phase-output", "backend-write", "frontend-write"],
  );
}

async function testWorkerPolicyLoaderRejectsRegistryDrift() {
  const cases = [
    {
      label: "missing role",
      value: policies({ roles: policies().roles.slice(0, 1) }),
      pattern: /missing.*code-reviewer|registry.*match/i,
    },
    {
      label: "duplicate role",
      value: policies({ roles: [...policies().roles, policies().roles[0]] }),
      pattern: /duplicate.*requirement-analyst/i,
    },
    {
      label: "unknown role",
      value: policies({ roles: [...policies().roles, { ...policies().roles[0], name: "unknown-role" }] }),
      pattern: /unknown.*unknown-role|registry.*match/i,
    },
    {
      label: "category drift",
      value: policies({ roles: [{ ...policies().roles[0], category: "execution" }, policies().roles[1]] }),
      pattern: /category.*requirement-analyst/i,
    },
    {
      label: "unsupported capability",
      value: policies({ roles: [{ ...policies().roles[0], capabilities: ["git-write"] }, policies().roles[1]] }),
      pattern: /capability.*git-write/i,
    },
    {
      label: "planning role capability escalation",
      value: policies({
        roles: [{
          ...policies().roles[0],
          writePathPrefixes: [".harness/runs/", "backend/src/"],
          capabilities: ["phase-output", "backend-write"],
        }, policies().roles[1]],
      }),
      pattern: /capability.*requirement-analyst|requirement-analyst.*capability/i,
    },
    {
      label: "unsafe path",
      value: policies({ roles: [{ ...policies().roles[0], readPathPrefixes: ["../outside"] }, policies().roles[1]] }),
      pattern: /path.*repository-relative|path.*unsafe|unsafe.*path/i,
    },
  ];

  for (const testCase of cases) {
    const root = await createPolicyFixture(testCase.value);
    try {
      await assert.rejects(
        loadWorkerPolicies({ root }),
        testCase.pattern,
        testCase.label,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testWorkerLoadsOnlyAllowedExplicitContext() {
  const { root, taskFile } = await createWorkerFixture();
  try {
    await write(root, "docs/input.md", "允许的上下文\n");
    await assert.rejects(
      runWorkerTask({
        root,
        taskFile,
        contextFiles: ["docs/input.md"],
        provider: ({ task, policy, context, signal }) => {
          assert.equal(task.ownerAgent, "requirement-analyst");
          assert.equal(policy.name, "requirement-analyst");
          assert.deepEqual(context, [{ path: "docs/input.md", content: "允许的上下文\n" }]);
          assert.equal(signal.aborted, false);
          throw new Error("provider-observed-context");
        },
      }),
      /provider-observed-context/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testWorkerRejectsInvalidContextBeforeProvider() {
  const cases = [
    {
      label: "read path outside role policy",
      prepare: async (root) => write(root, "backend/secret.txt", "secret"),
      contextFiles: ["backend/secret.txt"],
      pattern: /not allowed.*read|read.*policy/i,
    },
    {
      label: "single context file over limit",
      prepare: async (root) => write(root, "docs/large.txt", "x".repeat(2 * 1024 * 1024 + 1)),
      contextFiles: ["docs/large.txt"],
      pattern: /2 MiB|file.*limit/i,
    },
    {
      label: "invalid UTF-8 context",
      prepare: async (root) => {
        const target = path.join(root, "docs/invalid.txt");
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from([0xc3, 0x28]));
      },
      contextFiles: ["docs/invalid.txt"],
      pattern: /UTF-8/i,
    },
  ];

  for (const testCase of cases) {
    const { root, taskFile } = await createWorkerFixture();
    let providerCalled = false;
    try {
      await testCase.prepare(root);
      await assert.rejects(
        runWorkerTask({
          root,
          taskFile,
          contextFiles: testCase.contextFiles,
          provider: () => { providerCalled = true; },
        }),
        testCase.pattern,
        testCase.label,
      );
      assert.equal(providerCalled, false, testCase.label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const linked = await createWorkerFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "frontier-worker-outside-"));
  let providerCalled = false;
  try {
    const externalFile = await write(outside, "outside.txt", "outside");
    await mkdir(path.join(linked.root, "docs"), { recursive: true });
    await symlink(externalFile, path.join(linked.root, "docs/linked.txt"), "file");
    await assert.rejects(
      runWorkerTask({
        root: linked.root,
        taskFile: linked.taskFile,
        contextFiles: ["docs/linked.txt"],
        provider: () => { providerCalled = true; },
      }),
      /symbolic link|symlink/i,
    );
    assert.equal(providerCalled, false);
  } finally {
    await rm(linked.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

async function testWorkerRejectsContextTotalOverLimit() {
  const { root, taskFile } = await createWorkerFixture();
  let providerCalled = false;
  try {
    const contextFiles = [];
    for (let index = 0; index < 5; index += 1) {
      const relative = `docs/context-${index}.txt`;
      await write(root, relative, "x".repeat(1_700_000));
      contextFiles.push(relative);
    }
    await assert.rejects(
      runWorkerTask({
        root,
        taskFile,
        contextFiles,
        provider: () => { providerCalled = true; },
      }),
      /context.*8 MiB|8 MiB.*context/i,
    );
    assert.equal(providerCalled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testWorkerProviderFailureAndTimeoutLeaveNoResult() {
  const failure = await createWorkerFixture();
  const resultFile = `.harness/runs/${failure.task.storyId}/phases/00-requirement/result.json`;
  try {
    await assert.rejects(
      runWorkerTask({
        root: failure.root,
        taskFile: failure.taskFile,
        provider: () => { throw new Error("provider failed"); },
      }),
      /provider failed/,
    );
    assert.equal(await exists(failure.root, resultFile), false);
  } finally {
    await rm(failure.root, { recursive: true, force: true });
  }

  const timeout = await createWorkerFixture();
  let aborted = false;
  try {
    await assert.rejects(
      runWorkerTask({
        root: timeout.root,
        taskFile: timeout.taskFile,
        timeoutMs: 20,
        provider: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })),
      }),
      /timed out.*20|20.*timed out/i,
    );
    assert.equal(aborted, true);
    assert.equal(await exists(timeout.root, resultFile), false);
  } finally {
    await rm(timeout.root, { recursive: true, force: true });
  }
}

async function testWorkerRejectsInvalidTimeoutBeforeProvider() {
  for (const timeoutMs of [0, -1, 30_001, 1.5]) {
    const { root, taskFile } = await createWorkerFixture();
    let providerCalled = false;
    try {
      await assert.rejects(
        runWorkerTask({ root, taskFile, timeoutMs, provider: () => { providerCalled = true; } }),
        /timeout.*1.*30000|timeout.*30/i,
      );
      assert.equal(providerCalled, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function workerResponse(task, overrides = {}) {
  const output = task.expectedOutputs[0];
  return {
    files: [{ path: output, content: "# Requirement\n", capability: "phase-output" }],
    result: dispatchResult(task),
    ...overrides,
  };
}

async function testWorkerWritesValidatedFilesAndResultLast() {
  const { root, task, taskFile } = await createWorkerFixture();
  const resultFile = `.harness/runs/${task.storyId}/phases/00-requirement/result.json`;
  try {
    const completed = await runWorkerTask({
      root,
      taskFile,
      provider: ({ task: providerTask }) => workerResponse(providerTask),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.resultFile, resultFile);
    assert.equal(await readFile(path.join(root, task.expectedOutputs[0]), "utf8"), "# Requirement\n");
    assert.deepEqual(JSON.parse(await readFile(path.join(root, resultFile), "utf8")), dispatchResult(task));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testWorkerRejectsInvalidCandidatesBeforeAnyWrite() {
  const cases = [
    {
      label: "provider response has extra field",
      response: (task) => ({ ...workerResponse(task), extra: true }),
      pattern: /provider response.*unsupported field|unsupported field.*extra/i,
    },
    {
      label: "result identity mismatch",
      response: (task) => workerResponse(task, {
        result: dispatchResult(task, { dispatchId: "00000000-0000-4000-8000-000000000009" }),
      }),
      pattern: /result.*current task|identity/i,
    },
    {
      label: "completed output is missing from candidates",
      response: (task) => workerResponse(task, { files: [] }),
      pattern: /output.*candidate|candidate.*output/i,
    },
    {
      label: "duplicate candidate path",
      response: (task) => {
        const response = workerResponse(task);
        return { ...response, files: [...response.files, response.files[0]] };
      },
      pattern: /candidate.*(?:duplicate|collide)|unique.*candidate/i,
    },
    {
      label: "unsupported capability",
      response: (task) => {
        const response = workerResponse(task);
        return { ...response, files: [...response.files, { path: "backend/src/main/Bad.java", content: "bad", capability: "git-write" }] };
      },
      pattern: /capability.*git-write/i,
    },
    {
      label: "role does not own backend capability",
      response: (task) => {
        const response = workerResponse(task);
        return { ...response, files: [...response.files, { path: "backend/src/main/Bad.java", content: "bad", capability: "backend-write" }] };
      },
      pattern: /not allowed.*capability|capability.*not allowed/i,
    },
    {
      label: "candidate escapes repository",
      response: (task) => {
        const response = workerResponse(task);
        return { ...response, files: [...response.files, { path: "../outside.txt", content: "bad", capability: "phase-output" }] };
      },
      pattern: /repository-relative|repository root/i,
    },
    {
      label: "record references stale evidence",
      response: (task) => workerResponse(task, {
        result: dispatchResult(task, {
          records: [{ type: "note", status: "recorded", path: ".harness/runs/M4-B-TEST/phases/00-requirement/stale.md", message: "stale" }],
        }),
      }),
      pattern: /record.*candidate|candidate.*record/i,
    },
    {
      label: "test record lacks evidence path",
      response: (task) => workerResponse(task, {
        result: dispatchResult(task, {
          records: [{ type: "test", status: "passed", message: "missing evidence" }],
        }),
      }),
      pattern: /test.*evidence path|test.*path/i,
    },
    {
      label: "candidate file exceeds limit",
      response: (task) => {
        const response = workerResponse(task);
        response.files[0] = { ...response.files[0], content: "x".repeat(2 * 1024 * 1024 + 1) };
        return response;
      },
      pattern: /candidate.*2 MiB|2 MiB.*candidate/i,
    },
  ];

  for (const testCase of cases) {
    const { root, task, taskFile } = await createWorkerFixture();
    const output = task.expectedOutputs[0];
    const resultFile = `.harness/runs/${task.storyId}/phases/00-requirement/result.json`;
    try {
      await write(root, output, "original\n");
      await assert.rejects(
        runWorkerTask({ root, taskFile, provider: ({ task: providerTask }) => testCase.response(providerTask) }),
        testCase.pattern,
        testCase.label,
      );
      assert.equal(await readFile(path.join(root, output), "utf8"), "original\n", testCase.label);
      assert.equal(await exists(root, resultFile), false, testCase.label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testWorkerRejectsCandidateTotalOverLimit() {
  const root = await createPolicyFixture(policies({
    roles: [
      {
        ...policies().roles[0],
        name: "backend-developer",
        category: "execution",
        readPathPrefixes: [".harness/", "backend/"],
        writePathPrefixes: [".harness/runs/", "backend/src/"],
        capabilities: ["phase-output", "backend-write"],
      },
      policies().roles[1],
    ],
  }), AGENTS.replace("requirement-analyst", "backend-developer").replace("category: planning", "category: execution"));
  const task = dispatchTask({ ownerAgent: "backend-developer" });
  const taskFile = `.harness/runs/${task.storyId}/phases/00-requirement/task.json`;
  await write(root, taskFile, `${JSON.stringify(task, null, 2)}\n`);
  try {
    await assert.rejects(
      runWorkerTask({
        root,
        taskFile,
        provider: ({ task: providerTask }) => {
          const response = workerResponse(providerTask);
          for (let index = 0; index < 5; index += 1) {
            response.files.push({
              path: `backend/src/generated/File${index}.java`,
              content: "x".repeat(1_700_000),
              capability: "backend-write",
            });
          }
          return response;
        },
      }),
      /candidate.*8 MiB|8 MiB.*candidate/i,
    );
    assert.equal(await exists(root, task.expectedOutputs[0]), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createBackendWorkerFixture() {
  const backendAgents = AGENTS.replace("requirement-analyst", "backend-developer").replace("category: planning", "category: execution");
  const backendPolicy = {
    ...policies().roles[0],
    name: "backend-developer",
    category: "execution",
    readPathPrefixes: [".harness/", "backend/"],
    writePathPrefixes: [".harness/runs/", "backend/src/"],
    capabilities: ["phase-output", "backend-write"],
  };
  const root = await createPolicyFixture(policies({ roles: [backendPolicy, policies().roles[1]] }), backendAgents);
  const task = dispatchTask({ ownerAgent: "backend-developer" });
  const taskFile = `.harness/runs/${task.storyId}/phases/00-requirement/task.json`;
  await write(root, taskFile, `${JSON.stringify(task, null, 2)}\n`);
  return { root, task, taskFile };
}

async function testWorkerRejectsResultsThatM3CannotApply() {
  const invalidStatus = await createWorkerFixture();
  try {
    await assert.rejects(
      runWorkerTask({
        root: invalidStatus.root,
        taskFile: invalidStatus.taskFile,
        provider: ({ task }) => workerResponse(task, {
          result: dispatchResult(task, {
            records: [{ type: "note", status: "unknown", path: task.expectedOutputs[0], message: "invalid" }],
          }),
        }),
      }),
      /record.*status/i,
    );
  } finally {
    await rm(invalidStatus.root, { recursive: true, force: true });
  }

  for (const field of ["outputs", "records"]) {
    const fixture = await createBackendWorkerFixture();
    const businessPath = "backend/src/main/WorkerGenerated.java";
    try {
      await assert.rejects(
        runWorkerTask({
          root: fixture.root,
          taskFile: fixture.taskFile,
          provider: ({ task }) => ({
            files: [{ path: businessPath, content: "class WorkerGenerated {}\n", capability: "backend-write" }],
            result: dispatchResult(task, {
              status: "failed",
              outputs: field === "outputs" ? [{ path: businessPath }] : [],
              records: field === "records"
                ? [{ type: "note", status: "recorded", path: businessPath, message: "invalid path" }]
                : [],
            }),
          }),
        }),
        /phase directory/i,
      );
      assert.equal(await exists(fixture.root, businessPath), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}

async function testWorkerRejectsCollidingCandidatePathsBeforeWrite() {
  const cases = [
    ["backend/src/main/generated", "backend/src/main/generated/File.java"],
  ];
  if (process.platform === "win32") {
    cases.push(["backend/src/main/WorkerCase.java", "backend/src/main/workercase.java"]);
  }

  for (const paths of cases) {
    const fixture = await createBackendWorkerFixture();
    try {
      await assert.rejects(
        runWorkerTask({
          root: fixture.root,
          taskFile: fixture.taskFile,
          provider: ({ task }) => {
            const response = workerResponse(task);
            response.files.push(
              ...paths.map((candidatePath) => ({
                path: candidatePath,
                content: "candidate\n",
                capability: "backend-write",
              })),
            );
            return response;
          },
        }),
        /candidate.*(?:collide|overlap)|(?:collide|overlap).*candidate/i,
      );
      assert.equal(await exists(fixture.root, fixture.task.expectedOutputs[0]), false);
      for (const candidatePath of paths) assert.equal(await exists(fixture.root, candidatePath), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}

async function testWorkerRecoversAfterFilesWrittenInterruption() {
  const { root, prepared } = await createVerticalFixture("M4-B-INTERRUPT");
  try {
    await assert.rejects(
      runWorkerTask({
        root,
        taskFile: prepared.taskFile,
        provider: ({ task }) => workerResponse(task),
        afterFilesWritten: () => { throw new Error("simulated worker interruption"); },
      }),
      /simulated worker interruption/,
    );
    assert.equal(await exists(root, prepared.task.expectedOutputs[0]), true);
    assert.equal(await exists(root, prepared.resultFile), false);
    const interruptedState = await runStateCommand({ root, command: "status" });
    assert.equal(interruptedState.state.runtime.revision, 1);

    await runWorkerTask({
      root,
      taskFile: prepared.taskFile,
      provider: ({ task }) => {
        const response = workerResponse(task);
        response.files[0].content = "# Retried requirement\n";
        return response;
      },
    });
    assert.equal(await readFile(path.join(root, prepared.task.expectedOutputs[0]), "utf8"), "# Retried requirement\n");
    const applied = await runStoryCommand({ root, command: "apply", now: () => FIXED_NOW });
    assert.equal(applied.state.phase, "technical-design");
    assert.equal(applied.state.runtime.revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testWorkerRetriesSameDispatchAfterTimeout() {
  const { root, prepared } = await createVerticalFixture("M4-B-TIMEOUT");
  try {
    await assert.rejects(
      runWorkerTask({
        root,
        taskFile: prepared.taskFile,
        timeoutMs: 20,
        provider: () => new Promise(() => {}),
      }),
      /timed out/i,
    );
    assert.equal((await runStateCommand({ root, command: "status" })).state.runtime.revision, 1);
    const completed = await runWorkerTask({
      root,
      taskFile: prepared.taskFile,
      provider: ({ task }) => workerResponse(task),
    });
    assert.equal(completed.result.dispatchId, prepared.task.dispatchId);
    const applied = await runStoryCommand({ root, command: "apply", now: () => FIXED_NOW });
    assert.equal(applied.state.runtime.revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testWorkerRejectsRepeatedDispatchAfterResultExists() {
  const { root, prepared } = await createVerticalFixture("M4-B-REPEATED");
  try {
    await runWorkerTask({
      root,
      taskFile: prepared.taskFile,
      provider: ({ task }) => workerResponse(task),
    });
    const originalContent = await readFile(path.join(root, prepared.task.expectedOutputs[0]), "utf8");
    let repeatedProviderCalls = 0;
    const repeat = () => runWorkerTask({
      root,
      taskFile: prepared.taskFile,
      provider: ({ task }) => {
        repeatedProviderCalls += 1;
        const response = workerResponse(task);
        response.files[0].content = "# Duplicate execution\n";
        return response;
      },
    });

    await assert.rejects(repeat(), /result.*already exists|already.*result/i);
    assert.equal(repeatedProviderCalls, 0);
    assert.equal(await readFile(path.join(root, prepared.task.expectedOutputs[0]), "utf8"), originalContent);

    await runStoryCommand({ root, command: "apply", now: () => FIXED_NOW });
    await assert.rejects(repeat(), /result.*already exists|already.*result/i);
    assert.equal(repeatedProviderCalls, 0);
    assert.equal(await readFile(path.join(root, prepared.task.expectedOutputs[0]), "utf8"), originalContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testWorkerVerticalSliceLeavesStateToM3Apply() {
  const { root, prepared } = await createVerticalFixture();
  try {
    const before = await runStateCommand({ root, command: "status" });
    assert.equal(before.state.runtime.revision, 1);
    await runWorkerTask({
      root,
      taskFile: prepared.taskFile,
      provider: ({ task }) => workerResponse(task),
    });
    const afterWorker = await runStateCommand({ root, command: "status" });
    assert.equal(afterWorker.state.runtime.revision, 1);
    assert.equal(afterWorker.state.phase, "requirement");

    const applied = await runStoryCommand({ root, command: "apply", now: () => FIXED_NOW });
    assert.equal(applied.state.phase, "technical-design");
    assert.equal(applied.state.runtime.revision, 2);
    const current = await runStateCommand({ root, command: "status" });
    assert.equal(current.state.runtime.revision, 2);
    assert.equal(current.state.logs.filter((entry) => entry.type === "transition").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testDispatchContractsValidateSchemaShape();
await testRepositoryWorkerPoliciesMatchAgentRegistry();
await testWorkerPolicyLoaderRejectsRegistryDrift();
await testWorkerLoadsOnlyAllowedExplicitContext();
await testWorkerRejectsInvalidContextBeforeProvider();
await testWorkerRejectsContextTotalOverLimit();
await testWorkerProviderFailureAndTimeoutLeaveNoResult();
await testWorkerRejectsInvalidTimeoutBeforeProvider();
await testWorkerWritesValidatedFilesAndResultLast();
await testWorkerRejectsInvalidCandidatesBeforeAnyWrite();
await testWorkerRejectsCandidateTotalOverLimit();
await testWorkerRejectsResultsThatM3CannotApply();
await testWorkerRejectsCollidingCandidatePathsBeforeWrite();
await testWorkerRecoversAfterFilesWrittenInterruption();
await testWorkerRetriesSameDispatchAfterTimeout();
await testWorkerRejectsRepeatedDispatchAfterResultExists();
await testWorkerVerticalSliceLeavesStateToM3Apply();
console.log("worker-runtime tests passed");
