# Harness M5-D-C1 Parallel Wave Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单 Story、单个完整 implementation wave 增加 dispatch v1.2、统一 phase 所有权、不可变 attempt、并行 Mock Worker、部分失败收敛和显式恢复，并在全部任务 ready 前保持主工作树及 M2/M3 状态不变。

**Architecture:** `story-runtime` 负责 `prepare-wave`、implementation owner 和正式 task/checkpoint；新增 `worktree-wave-execution-runtime.mjs` 负责 Wave Execution Ledger、attempt claim、并行执行、status、retry 和 recover。现有 Worker 仅增加 v1.2 result 路径与逐写点 guard，v1.0 单任务和 v1.1 serial batch 路由保持不变。

**Tech Stack:** Node.js ESM、`node:test`、PowerShell、Git 临时 fixture、JSON Schema、FrontierScan M2/M3/M4/M5 Runtime。

---

## 0. 执行边界

- 本计划只实施 `M5-D-C1-001`，不实施 C2 manifest、主树集成、`finalize-wave` 或 M3 `apply`。
- 当前会话串行执行任务，不使用多 Agent 并行修改共享文件。
- 所有真实 Worktree、并行 Worker 和恢复测试只在临时 Git fixture 中执行。
- 正式仓库不执行 `WaveCreate`、Worker、Apply、Retire、merge、reset、clean、分支删除或 `prune`。
- 不执行 `git add`、`git commit`、`git push` 或 PR，除非用户对具体操作另行批准。
- 不修改或纳入未跟踪的 `CODEX-CROSS-SESSION-HANDOFF.md`。
- 每个生产行为先观察直接 RED，再做最小 GREEN。

## 1. 文件结构

### 新增

| 文件 | 职责 |
| --- | --- |
| `.harness/scripts/lib/implementation-owner-contract.mjs` | implementation phase 的 ordinary、serial-batch、worktree-wave 互斥所有权 |
| `.harness/scripts/lib/worktree-wave-execution-runtime.mjs` | C1 ledger、attempt、并行执行、status、retry、recover |
| `.harness/scripts/tests/worktree-wave-execution-runtime.test.mjs` | C1 专项临时 Git fixture 和并发/恢复测试 |
| `.harness/schemas/implementation-owner.schema.json` | phase owner 严格 Schema |
| `.harness/schemas/dispatch-task-v1.2.schema.json` | wave-scoped task |
| `.harness/schemas/dispatch-result-v1.2.schema.json` | wave-scoped result |
| `.harness/schemas/worktree-wave-execution-ledger.schema.json` | C1 稳定 ledger |
| `.harness/schemas/worktree-wave-attempt-claim.schema.json` | 不可变 attempt claim |
| `.harness/schemas/worktree-wave-attempt-lock.schema.json` | attempt 执行 owner |
| `.harness/schemas/worktree-wave-attempt-failure.schema.json` | attempt 失败/abandoned 证据 |
| `docs/harness-m5d-wave-execution/REPORT-C1.md` | 实施、测试、Review 和延期边界 |

### 修改

| 文件 | 修改目的 |
| --- | --- |
| `.harness/scripts/lib/dispatch-contract.mjs` | 增加严格 v1.2 task/result 路由 |
| `.harness/scripts/lib/story-runtime.mjs` | owner 门禁、`prepare-wave`、wave checkpoint 校验入口 |
| `.harness/scripts/run-story.ps1` | 增加 `prepare-wave` 参数契约 |
| `.harness/scripts/lib/worker-runtime.mjs` | 支持派生 result 路径和候选/result rename 前 guard |
| `.harness/scripts/lib/worktree-worker-runtime.mjs` | 增加受约束 v1.2 wave-task 执行分支 |
| `.harness/structure-manifest.yaml` | 登记新 Runtime、测试和 Schema |
| `.harness/scripts/validate-structure.ps1` | 校验新增 JSON Schema |
| `.harness/README.md` | 记录 C1 能力与边界 |
| `.harness/scripts/README.md` | 记录新 Runtime API |
| `docs/harness-architecture-adaptation.md` | 更新 M5-D-C1 架构状态 |
| `docs/harness-structure-checklist.md` | 更新结构清单 |
| `docs/AI-handover.md` | 更新当前阶段、完成能力和下一步 C2 |
| `llm-knowledge/overview.md` | 更新 Harness 能力摘要 |

## 2. 候选 Task DAG

所有任务修改共享 Runtime 或专项测试，严格串行：

```json
{
  "schemaVersion": "1.0",
  "storyId": "M5-D-C1-001",
  "nodes": [
    {
      "taskId": "T1",
      "title": "建立 implementation phase 统一所有权",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/implementation-owner-contract.mjs",
        ".harness/scripts/lib/story-runtime.mjs",
        ".harness/scripts/tests/story-runtime.test.mjs",
        ".harness/schemas/implementation-owner.schema.json"
      ],
      "acceptanceCriteria": [
        "ordinary、serial-batch、worktree-wave 所有权互斥",
        "prepare、prepare-batch、prepare-wave 和 apply 不能绕过当前 owner"
      ]
    },
    {
      "taskId": "T2",
      "title": "增加 dispatch v1.2 与 prepare-wave",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/dispatch-contract.mjs",
        ".harness/scripts/lib/story-runtime.mjs",
        ".harness/scripts/run-story.ps1",
        ".harness/scripts/tests/story-runtime.test.mjs",
        ".harness/schemas/dispatch-task-v1.2.schema.json",
        ".harness/schemas/dispatch-result-v1.2.schema.json"
      ],
      "acceptanceCriteria": [
        "prepare-wave 只接受覆盖全部 implementation 任务的唯一 wave",
        "v1.2 身份和路径全部由 Runtime 派生"
      ]
    },
    {
      "taskId": "T3",
      "title": "实现 Wave Execution Ledger 和确定性状态",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-wave-execution-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-execution-runtime.test.mjs",
        ".harness/schemas/worktree-wave-execution-ledger.schema.json"
      ],
      "acceptanceCriteria": [
        "顶层状态由任务状态确定性派生",
        "状态读取不持久化动态观察"
      ]
    },
    {
      "taskId": "T4",
      "title": "实现不可变 attempt、claim、锁和恢复",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-wave-execution-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-execution-runtime.test.mjs",
        ".harness/schemas/worktree-wave-attempt-claim.schema.json",
        ".harness/schemas/worktree-wave-attempt-lock.schema.json",
        ".harness/schemas/worktree-wave-attempt-failure.schema.json"
      ],
      "acceptanceCriteria": [
        "claiming 与 running 半完成状态可显式恢复",
        "旧 attempt 不能写入或删除新锁",
        "历史 attempt 不覆盖或删除"
      ]
    },
    {
      "taskId": "T5",
      "title": "接入 v1.2 Worker guard 和并行执行",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worker-runtime.mjs",
        ".harness/scripts/lib/worktree-worker-runtime.mjs",
        ".harness/scripts/lib/worktree-wave-execution-runtime.mjs",
        ".harness/scripts/tests/worker-runtime.test.mjs",
        ".harness/scripts/tests/worktree-worker-runtime.test.mjs",
        ".harness/scripts/tests/worktree-wave-execution-runtime.test.mjs"
      ],
      "acceptanceCriteria": [
        "测试 barrier 证明多个 Worker 真实并行",
        "候选、result、receipt、ledger 和 release 前均执行 owner guard",
        "部分失败保留成功回执且不写主工作树"
      ]
    },
    {
      "taskId": "T6",
      "title": "完成 retry、recover、结构登记、文档和回归",
      "type": "docs",
      "status": "pending",
      "ownerAgent": "task-planner",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-wave-execution-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-execution-runtime.test.mjs",
        ".harness/structure-manifest.yaml",
        ".harness/scripts/validate-structure.ps1",
        ".harness/README.md",
        ".harness/scripts/README.md",
        "docs/harness-architecture-adaptation.md",
        "docs/harness-structure-checklist.md",
        "docs/AI-handover.md",
        "llm-knowledge/overview.md",
        "docs/harness-m5d-wave-execution/REPORT-C1.md"
      ],
      "acceptanceCriteria": [
        "retry-task 和 recover-attempt 绑定当前证据并失败关闭",
        "C1 专项、直接回归、结构、Smoke 和知识门禁通过",
        "最终 Review 无未解决 BLOCKER/WARNING"
      ]
    }
  ],
  "edges": [
    { "from": "T1", "to": "T2", "reason": "prepare-wave 必须建立在统一 phase owner 上" },
    { "from": "T2", "to": "T3", "reason": "ledger 必须消费已验证的 v1.2 dispatch" },
    { "from": "T3", "to": "T4", "reason": "attempt 状态必须写入确定性 ledger" },
    { "from": "T4", "to": "T5", "reason": "Worker 并行写入必须先具备 attempt owner fencing" },
    { "from": "T5", "to": "T6", "reason": "恢复、文档和回归必须基于最终执行行为" }
  ],
  "waves": [["T1"], ["T2"], ["T3"], ["T4"], ["T5"], ["T6"]],
  "globalChanges": [],
  "risks": [
    "story-runtime owner 门禁会影响 v1.0/v1.1，必须保持 legacy fixture 兼容",
    "Worker guard 插入所有 rename 点后必须验证旧路径无行为回归",
    "普通 JSON 锁不是 OS 级租约，遗留恢复依赖真实人工确认"
  ]
}
```

---

### Task 0: 初始化 M5-D-C1 Story 和阶段产物

**Files:**
- Create: `.harness/runs/M5-D-C1-001/phases/00-requirement/requirement-breakdown.md`
- Create: `.harness/runs/M5-D-C1-001/phases/01-technical-design/technical-design.md`
- Create: `.harness/runs/M5-D-C1-001/phases/02-task-dag/task-dag.json`

- [ ] **Step 1: 核对仓库和已完成状态**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command status `
  -Json
```

Expected:

- `dev` 与 `origin/dev` 指向 `47ac6bf` 或更晚的用户同步提交。
- 活动状态为 `M5-D-B-001 done/completed`。
- 只有 `CODEX-CROSS-SESSION-HANDOFF.md` 和本任务设计/计划是未跟踪 owned/unrelated 文件。

- [ ] **Step 2: 初始化 Story**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command init `
  -StoryId M5-D-C1-001 `
  -Summary "为单个完整 implementation wave 增加 dispatch v1.2、统一 phase 所有权、不可变 attempt、并行 Mock Worker 和显式恢复"
```

Expected: `requirement/active`，revision `1`。

- [ ] **Step 3: 写入需求产物**

需求必须逐条记录：

```markdown
- [ ] DAG 恰好一个 wave 且覆盖全部 implementation 任务。
- [ ] ordinary、serial-batch、worktree-wave phase owner 互斥。
- [ ] v1.2 task/result 身份全部由 Runtime 派生。
- [ ] 每任务 attempt 历史不可覆盖，所有写点受 lockId fencing。
- [ ] 多 Worker 真实并行，部分失败保留成功证据。
- [ ] retry/recover 只在显式确认和当前哈希绑定下执行。
- [ ] 全部任务 ready 前不写主工作树、不生成 phase result、不推进 M3。
```

记录并推进：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command record `
  -RecordType output `
  -Status present `
  -Path .harness/runs/M5-D-C1-001/phases/00-requirement/requirement-breakdown.md

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command next
```

- [ ] **Step 4: 绑定技术设计**

技术设计阶段产物引用：

```text
docs/harness-m5d-wave-execution/DESIGN.md
```

并记录其当前 SHA-256。记录后推进到 `task-dag`。

- [ ] **Step 5: 保存并验证 Task DAG**

将第 2 节 JSON 保存为：

```text
.harness/runs/M5-D-C1-001/phases/02-task-dag/task-dag.json
```

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\validate-task-dag.ps1 `
  -TaskDagFile .\.harness\runs\M5-D-C1-001\phases\02-task-dag\task-dag.json
```

Expected: 6 个任务、5 条边、6 个串行 wave，通过校验。

- [ ] **Step 6: 记录 DAG 并推进到 implementation**

使用状态 Runtime 记录 DAG output，执行 `next`，最后运行 `run-state validate`。

---

### Task 1: 建立 Implementation Owner 契约

**Files:**
- Create: `.harness/scripts/lib/implementation-owner-contract.mjs`
- Create: `.harness/schemas/implementation-owner.schema.json`
- Modify: `.harness/scripts/lib/story-runtime.mjs`
- Test: `.harness/scripts/tests/story-runtime.test.mjs`

- [ ] **Step 1: RED - 普通与批次路径可绕过 wave owner**

在 `story-runtime.test.mjs` 增加：

```js
test("implementation owner prevents ordinary, serial batch and wave preparation from overlapping", async () => {
  const fixture = await createImplementationFixture();
  await writeJson(
    path.join(fixture.root, fixture.ownerFile),
    waveImplementationOwnerFixture(fixture),
  );

  await assert.rejects(
    runStoryCommand({
      root: fixture.root,
      command: "prepare",
      stateFile: fixture.stateFile,
    }),
    /implementation owner|worktree-wave/i,
  );
  await assert.rejects(
    runStoryCommand({
      root: fixture.root,
      command: "prepare-batch",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
    }),
    /implementation owner|worktree-wave/i,
  );
});
```

`waveImplementationOwnerFixture` 返回与 fixture state、revision 和 DAG 哈希一致的精确 owner JSON，使失败原因指向未实现门禁，而不是尚未实现的 `prepare-wave`。

- [ ] **Step 2: 运行 RED**

Run:

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
```

Expected: FAIL，普通或批次 prepare 未拒绝 wave owner。

- [ ] **Step 3: GREEN - 新增 Owner 纯契约**

`implementation-owner-contract.mjs` 导出：

```js
export const IMPLEMENTATION_OWNER_MODES = new Set([
  "ordinary",
  "serial-batch",
  "worktree-wave",
]);

export function implementationOwnerPath(state) {
  return `.harness/runs/${state.runtime.runId}/phases/03-implementation/implementation-owner.json`;
}

export async function inspectImplementationOwner({
  root,
  state,
  readJsonOptional,
}) {
  const file = implementationOwnerPath(state);
  const owner = await readJsonOptional(root, file, "Implementation owner");
  if (!owner) return null;
  validateImplementationOwnerStructure(owner);
  if (owner.storyId !== state.storyId
      || owner.runId !== state.runtime.runId
      || owner.phase !== "implementation"
      || owner.preparedRevision !== state.runtime.revision) {
    throw new Error("Implementation owner identity does not match the active state.");
  }
  const taskDagSha256 = await fileSha256(root, owner.taskDagFile, "Implementation owner Task DAG");
  if (taskDagSha256 !== owner.taskDagSha256) {
    throw new Error("Implementation owner Task DAG hash drifted.");
  }
  return { file, owner };
}

export async function acquireImplementationOwner({
  root,
  state,
  mode,
  ownerId,
  taskDagFile,
  now,
}) {
  const desired = await implementationOwnerFor({
    root, state, mode, ownerId, taskDagFile, now,
  });
  const file = implementationOwnerPath(state);
  try {
    await writeExclusiveJson(root, file, desired, "Implementation owner");
    return { file, owner: desired, reused: false };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = await inspectImplementationOwner({ root, state, readJsonOptional });
    if (JSON.stringify(current?.owner) !== JSON.stringify(desired)) {
      throw new Error("Implementation phase is owned by another execution mode.");
    }
    return { ...current, reused: true };
  }
}

export async function assertImplementationOwner({
  root,
  state,
  expectedMode,
  expectedOwnerId,
}) {
  const current = await inspectImplementationOwner({ root, state, readJsonOptional });
  if (!current
      || current.owner.mode !== expectedMode
      || current.owner.ownerId !== expectedOwnerId) {
    throw new Error("Implementation owner does not match the requested execution mode.");
  }
  return current;
}
```

Schema 使用 `additionalProperties: false`，固定：

```json
{
  "schemaVersion": "1.0",
  "storyId": "M5-D-C1-FIXTURE",
  "runId": "M5-D-C1-FIXTURE",
  "phase": "implementation",
  "mode": "worktree-wave",
  "ownerId": "wave-0123456789abcdef",
  "preparedRevision": 7,
  "taskDagFile": ".harness/runs/M5-D-C1-FIXTURE/phases/02-task-dag/task-dag.json",
  "taskDagSha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "acquiredAt": "2026-08-06T00:00:00.000Z"
}
```

- [ ] **Step 4: GREEN - 接入 Story Runtime 门禁**

在 `prepareFromContext`、`prepareBatch` 和 `applyResult/reconcileAdvancedResult` 前加入：

```js
await assertImplementationModeAvailable({
  root,
  state: located.state,
  requestedMode: "ordinary",
});
```

批次使用 `serial-batch`。现有旧 fixture 无 owner 文件时：

```text
已有 batch ledger -> 派生 serial-batch
已有普通 phase task/checkpoint -> 派生 ordinary
已有 wave ledger -> 派生 worktree-wave
无产物 -> 可获取新 owner
```

不允许 legacy 推断忽略 wave ledger。

- [ ] **Step 5: GREEN - 增加 Owner 单元测试**

覆盖：

```text
exclusive-create 竞争只有一个成功
相同 owner 精确复用
mode/ownerId/revision/DAG/hash 漂移拒绝
ordinary 与 batch 旧 fixture 兼容
wave ledger 存在时 legacy ordinary 推断拒绝
```

- [ ] **Step 6: 验证 GREEN**

Run:

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
```

Expected: 全部通过。

- [ ] **Step 7: Owned diff Review checkpoint**

检查只包含 owner 契约、Schema、story gate 和测试；不修改 phase/revision 写入逻辑。

---

### Task 2: Dispatch v1.2 与 `prepare-wave`

**Files:**
- Create: `.harness/schemas/dispatch-task-v1.2.schema.json`
- Create: `.harness/schemas/dispatch-result-v1.2.schema.json`
- Modify: `.harness/scripts/lib/dispatch-contract.mjs`
- Modify: `.harness/scripts/lib/story-runtime.mjs`
- Modify: `.harness/scripts/run-story.ps1`
- Test: `.harness/scripts/tests/story-runtime.test.mjs`

- [ ] **Step 1: RED - v1.2 精确契约**

增加测试：

```js
test("dispatch v1.2 requires runtime-derived wave identity", () => {
  const task = waveTaskFixture();
  assert.doesNotThrow(() => validateDispatchTaskStructure(task));

  for (const field of ["runId", "waveId", "waveIndex", "taskId", "taskRoot"]) {
    const invalid = structuredClone(task);
    delete invalid[field];
    assert.throws(() => validateDispatchTaskStructure(invalid), new RegExp(field, "i"));
  }

  assert.throws(
    () => validateDispatchTaskStructure({ ...task, batchId: "batch-forbidden" }),
    /exact fields|batchId/i,
  );
});
```

- [ ] **Step 2: RED - prepare-wave 范围**

测试必须拒绝：

```text
多 wave DAG
wave 未覆盖全部 implementation 任务
globalChanges 非空
相同/大小写等价/父子 predictedFiles 冲突
WavePlan 或 creation receipt 漂移
任一 Worktree 不是 created
ordinary 或 serial-batch owner 已存在
调用方传入 waveId/dispatchId/taskRoot
```

- [ ] **Step 3: 运行 RED**

Run:

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
```

Expected: FAIL，v1.2 和 `prepare-wave` 未识别。

- [ ] **Step 4: GREEN - 扩展 Dispatch Contract**

增加：

```js
function validateDispatchTaskV12(task) {
  const fields = [
    "schemaVersion", "dispatchId", "storyId", "runId", "phase",
    "waveId", "waveIndex", "taskId", "taskRoot", "ownerAgent",
    "purpose", "preparedRevision", "preparedAt",
    "expectedOutputs", "allowedAdapters", "next",
  ];
  assertExactFields(task, fields, "Dispatch task");
  if (task.schemaVersion !== "1.2") throw new Error("Dispatch task schemaVersion must be '1.2'.");
  if (!UUID_PATTERN.test(task.dispatchId)) throw new Error("Dispatch task dispatchId must be a UUID.");
  if (!STORY_PATTERN.test(task.storyId) || task.runId !== task.storyId) {
    throw new Error("Dispatch task Story and run identity are invalid.");
  }
  assertTaskScope(task.waveId, "Dispatch task waveId");
  assertTaskScope(task.taskId, "Dispatch task taskId");
  assertTaskRoot(task.taskRoot, task, "Dispatch task taskRoot");
  if (!Number.isInteger(task.waveIndex) || task.waveIndex < 1) {
    throw new Error("Dispatch task waveIndex must be a positive integer.");
  }
  task.expectedOutputs.forEach((output) => {
    assertTaskScopedPath(output, task.taskRoot, "Dispatch task expected output");
  });
  return task;
}

function validateDispatchResultV12(result) {
  const fields = [
    "schemaVersion", "dispatchId", "storyId", "runId", "phase",
    "waveId", "waveIndex", "taskId", "taskRoot", "status",
    "summary", "outputs", "records", "blocker",
  ];
  assertExactFields(result, fields, "Dispatch result");
  if (result.schemaVersion !== "1.2") throw new Error("Dispatch result schemaVersion must be '1.2'.");
  for (const output of result.outputs) {
    assertTaskScopedPath(output.path, result.taskRoot, "Dispatch result output");
  }
  for (const record of result.records) {
    if (record.path) assertTaskScopedPath(record.path, result.taskRoot, "Dispatch result record");
  }
  return result;
}
```

路由：

```js
if (task?.schemaVersion === "1.2") return validateDispatchTaskV12(task);
if (task?.schemaVersion === "1.1") return validateDispatchTaskV11(task);
return validateDispatchTaskV10(task);
```

- [ ] **Step 5: GREEN - 实现 `prepare-wave`**

`story-runtime.mjs` 新增：

```js
async function prepareWave(root, options) {
  const context = await currentContext(root, options.stateFile);
  assertActiveImplementation(context);
  const wave = await loadApprovedCompleteWave(root, context, options);
  const waveId = deriveWaveId({
    runId: context.located.state.runtime.runId,
    revision: context.located.state.runtime.revision,
    waveIndex: wave.waveIndex,
    taskDagSha256: wave.taskDagSha256,
    planSha256: wave.planSha256,
  });
  await acquireImplementationOwner({
    root,
    state: context.located.state,
    mode: "worktree-wave",
    ownerId: waveId,
    taskDagFile: wave.taskDagFile,
  });
  return prepareWaveDispatches(root, context, wave, waveId, options);
}
```

同时实现并直接测试：

```js
function assertActiveImplementation(context) {
  if (context.located.state.runtime.status !== "active"
      || context.phase?.id !== "implementation") {
    throw new Error("Wave preparation requires an active implementation phase.");
  }
}

async function loadApprovedCompleteWave(root, context, options) {
  return loadAndValidateCompleteWave({
    root,
    stateFile: context.located.stateFile,
    taskDagFile: options.taskDagFile,
    waveIndex: options.waveIndex,
    requiredPhase: "implementation",
    requireSingleWave: true,
    requireAllTasks: true,
    requireNoGlobalChanges: true,
    requireCreatedWorktrees: true,
    requireCreationReceipt: true,
  });
}

function deriveWaveId({ runId, revision, waveIndex, taskDagSha256, planSha256 }) {
  const identity = JSON.stringify([
    runId, revision, waveIndex, taskDagSha256, planSha256,
  ]);
  return `wave-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

async function prepareWaveDispatches(root, context, wave, waveId, options) {
  const tasks = [];
  for (const dagTask of wave.tasks) {
    tasks.push(await writeWaveDispatch({
      root,
      state: context.located.state,
      phase: context.phase,
      wave,
      waveId,
      dagTask,
      now: options.now,
      randomUUID: options.randomUUID,
    }));
  }
  return createWaveExecutionLedger({
    root,
    state: context.located.state,
    wave,
    waveId,
    tasks,
    now: options.now,
  });
}
```

每任务路径：

```text
.harness/runs/<runId>/waves/<waveId>/tasks/<taskId>/task.json
.harness/runs/<runId>/waves/<waveId>/tasks/<taskId>/checkpoint.json
```

- [ ] **Step 6: GREEN - PowerShell 参数**

`run-story.ps1`：

```powershell
[ValidateSet(
  "prepare", "status", "run-adapter", "apply",
  "prepare-batch", "finalize-batch",
  "prepare-wave"
)]
[string]$Command,

[int]$WaveIndex = 0
```

`prepare-wave` 要求 `TaskDagFile` 和正整数 `WaveIndex`，拒绝 `BatchFile/Adapter/ResultFile`。

- [ ] **Step 7: 验证 GREEN**

Run:

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-story.ps1 `
  -Command status `
  -Json
```

Expected: story tests 通过，现有 status 行为不变。

---

### Task 3: Wave Execution Ledger 与状态真值表

**Files:**
- Create: `.harness/scripts/lib/worktree-wave-execution-runtime.mjs`
- Create: `.harness/schemas/worktree-wave-execution-ledger.schema.json`
- Create: `.harness/scripts/tests/worktree-wave-execution-runtime.test.mjs`
- Modify: `.harness/scripts/lib/story-runtime.mjs`

- [ ] **Step 1: RED - 初始 Ledger**

新测试：

```js
test("prepare-wave creates a deterministic execution ledger without changing Harness state", async () => {
  const fixture = await createWaveExecutionFixture();
  const before = await readFile(fixture.statePath, "utf8");
  const prepared = await runStoryCommand({
    root: fixture.root,
    command: "prepare-wave",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });

  assert.equal(prepared.ledger.status, "prepared");
  assert.deepEqual(prepared.ledger.tasks.map((task) => task.status), ["pending", "pending"]);
  assert.equal(await readFile(fixture.statePath, "utf8"), before);
});
```

- [ ] **Step 2: RED - 状态真值表**

针对每组任务状态断言：

```js
assert.equal(deriveWaveExecutionStatus(["pending", "pending"]), "prepared");
assert.equal(deriveWaveExecutionStatus(["running", "ready-for-integration"]), "executing");
assert.equal(deriveWaveExecutionStatus(["blocked", "ready-for-integration"]), "partial");
assert.equal(deriveWaveExecutionStatus(["ready-for-integration", "ready-for-integration"]), "ready-for-integration");
```

非法组合必须抛错：

```text
ready task 缺 execution receipt hash
running task 缺 attempt/lock hash
pending task 带 active attempt
顶层状态与派生值不一致
```

- [ ] **Step 3: 运行 RED**

Run:

```powershell
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

Expected: FAIL，新 Runtime/ledger 尚不存在。

- [ ] **Step 4: GREEN - 定义 Ledger**

核心结构：

```js
const ledger = {
  schemaVersion: "1.0",
  storyId,
  runId,
  phase: "implementation",
  preparedRevision,
  waveId,
  waveIndex,
  taskDagFile,
  taskDagSha256,
  wavePlanFile,
  wavePlanSha256,
  creationReceiptFile,
  creationReceiptSha256,
  baseCommit,
  status: "prepared",
  tasks: orderedTasks.map((task) => ({
    taskId: task.taskId,
    dispatchId: task.dispatchId,
    taskFile: task.taskFile,
    taskSha256: task.taskSha256,
    checkpointFile: task.checkpointFile,
    checkpointSha256: task.checkpointSha256,
    status: "pending",
    currentAttemptId: null,
    executionReceiptFile: null,
    executionReceiptSha256: null,
    integrationReceiptFile: null,
    integrationReceiptSha256: null,
    startedAt: null,
    workerReadyAt: null,
    integratedAt: null,
  })),
  integrationManifestFile: null,
  integrationManifestSha256: null,
  waveReceiptFile: null,
  waveReceiptSha256: null,
  preparedAt,
  finalizedAt: null,
};
```

- [ ] **Step 5: GREEN - 只读 Status**

导出：

```js
export async function inspectWaveExecution(options = {}) {
  const context = await loadWaveExecutionContext(options);
  const diagnostics = await inspectWaveTaskFacts(context);
  return {
    command: "status",
    ledgerFile: context.ledgerFile,
    ledger: context.ledger,
    diagnostics,
  };
}
```

- [ ] **Step 6: 验证 GREEN**

Run:

```powershell
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

Expected: 通过。

---

### Task 4: 不可变 Attempt、Claim、锁与显式恢复

**Files:**
- Modify: `.harness/scripts/lib/worktree-wave-execution-runtime.mjs`
- Create: `.harness/schemas/worktree-wave-attempt-claim.schema.json`
- Create: `.harness/schemas/worktree-wave-attempt-lock.schema.json`
- Create: `.harness/schemas/worktree-wave-attempt-failure.schema.json`
- Test: `.harness/scripts/tests/worktree-wave-execution-runtime.test.mjs`

- [ ] **Step 1: RED - Claim 两阶段中断**

增加两个测试：

```js
test("recover-attempt closes a claim written before the task lock exists", async () => {
  const interrupted = await createInterruptedAttempt({
    fixture,
    taskId: "T1",
    interruptAt: "after-claim",
  });
  await assert.rejects(
    recoverAttempt({ ...interrupted.options, confirmAttemptRecovery: false }),
    /ConfirmAttemptRecovery/,
  );
  const recovered = await recoverAttempt({
    ...interrupted.options,
    confirmAttemptRecovery: true,
  });
  assert.equal(recovered.task.status, "pending");
});

test("recover-attempt closes a task lock written before running is recorded", async () => {
  const interrupted = await createInterruptedAttempt({
    fixture,
    taskId: "T1",
    interruptAt: "after-lock",
  });
  await assert.rejects(
    recoverAttempt({
      ...interrupted.options,
      expectedExecutionLockSha256: `sha256:${"0".repeat(64)}`,
      confirmAttemptRecovery: true,
    }),
    /lock hash/i,
  );
});
```

- [ ] **Step 2: RED - 旧 Owner**

在以下钩子替换 task lock：

```text
beforeCandidateRename
beforeResultRename
beforeExecutionReceiptWrite
beforeLedgerReadyWrite
beforeExecutionLockRelease
```

断言旧调用不写后续副作用且不删除替换锁。

- [ ] **Step 3: 运行 RED**

Run:

```powershell
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

Expected: FAIL，claim、lock 和 recovery 尚未实现。

- [ ] **Step 4: GREEN - Attempt 路径和 Claim**

增加：

```js
function attemptPaths(ledger, taskId, attemptId) {
  const root = `.harness/runs/${ledger.runId}/waves/${ledger.waveId}/tasks/${taskId}/attempts/${attemptId}`;
  return {
    root,
    claimFile: `${root}/claim.json`,
    inputSnapshotFile: `${root}/input-snapshot.json`,
    resultFile: `${root}/result.json`,
    receiptFile: `${root}/execution-receipt.json`,
    failureFile: `${root}/failure.json`,
    lockFile: `.harness/runs/${ledger.runId}/waves/${ledger.waveId}/tasks/${taskId}/execute.lock`,
  };
}
```

Claim 固定顺序：

```js
await mutateLedger(... pendingToClaiming);
await writeExclusiveJson(claimPath, claim);
await writeExclusiveJson(lockPath, lock);
await mutateLedger(... claimingToRunning);
```

每步前后都重新读取并验证 owner。

- [ ] **Step 5: GREEN - Owner Guard**

```js
async function assertAttemptOwned(root, context, owner) {
  const currentLock = await readAttemptLock(root, owner.lockFile);
  const currentLedger = await readLedger(root, context.ledgerFile);
  const currentTask = currentLedger.tasks.find((task) => task.taskId === owner.taskId);
  if (currentLock.lockId !== owner.lockId
      || currentLock.attemptId !== owner.attemptId
      || currentTask?.currentAttemptId !== owner.attemptId) {
    throw new Error("Wave task attempt owner changed.");
  }
  assertWaveInputsUnchanged(context, currentLedger);
}
```

- [ ] **Step 6: GREEN - `recover-attempt`**

API：

```js
await runWaveExecutionCommand({
  command: "recover-attempt",
  stateFile,
  waveFile,
  taskId,
  expectedAttemptId,
  expectedClaimSha256,
  expectedExecutionLockSha256,
  confirmAttemptRecovery: true,
});
```

只允许：

```text
无候选/result -> abandoned + pending
完整 result/receipt -> ready-for-integration
完整 blocked evidence -> blocked
孤儿候选 -> blocked，失败关闭
```

- [ ] **Step 7: 验证 GREEN**

Run专项测试，随后运行：

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
```

Expected: 新增测试和旧锁/Worker测试通过。

---

### Task 5: v1.2 Worker Guard 与真实并行

**Files:**
- Modify: `.harness/scripts/lib/worker-runtime.mjs`
- Modify: `.harness/scripts/lib/worktree-worker-runtime.mjs`
- Modify: `.harness/scripts/lib/worktree-wave-execution-runtime.mjs`
- Test: `.harness/scripts/tests/worker-runtime.test.mjs`
- Test: `.harness/scripts/tests/worktree-worker-runtime.test.mjs`
- Test: `.harness/scripts/tests/worktree-wave-execution-runtime.test.mjs`

- [ ] **Step 1: RED - Worker 可指定 Attempt Result 且逐 Rename Guard**

增加：

```js
test("v1.2 worker calls the write guard before every candidate and result rename", async () => {
  const guards = [];
  const result = await runWorkerTask({
    root: fixture.root,
    taskFile: fixture.waveTaskFile,
    resultFile: fixture.attemptResultFile,
    beforeCommit: async ({ kind, path }) => guards.push({ kind, path }),
    provider: fixture.provider,
    predictedFiles: fixture.predictedFiles,
  });

  assert.deepEqual(guards.map((guard) => guard.kind), [
    "candidate",
    "candidate",
    "result",
  ]);
  assert.equal(result.resultFile, fixture.attemptResultFile);
});
```

- [ ] **Step 2: RED - 真实并行 Barrier**

```js
test("execute-wave runs all claimed workers concurrently and trusts receipts after settlement", async () => {
  const entered = new Set();
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const provider = async ({ task }) => {
    entered.add(task.taskId);
    if (entered.size === 2) release();
    await barrier;
    return completedResponse(task);
  };

  const execution = await runWaveExecutionCommand({
    command: "execute-wave",
    confirmWaveExecute: true,
    expectedWaveLedgerSha256,
    expectedCreationReceiptSha256,
    provider,
  });

  assert.equal(entered.size, 2);
  assert.equal(execution.ledger.status, "ready-for-integration");
});
```

- [ ] **Step 3: RED - 部分失败**

一个 Provider 成功、一个抛错，断言：

```text
成功任务 ready-for-integration
失败任务 blocked
wave partial
主工作树字节不变
再次普通 execute 不自动重试 blocked 项
```

- [ ] **Step 4: 运行 RED**

Run:

```powershell
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

Expected: v1.2 result/guard/execute 未实现而失败。

- [ ] **Step 5: GREEN - 扩展 Worker Runtime**

修改签名：

```js
export async function runWorkerTask({
  root = process.cwd(),
  taskFile,
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  contextFiles = [],
  predictedFiles,
  resultFile,
  beforeCommit,
  afterFilesWritten,
} = {}) {
  const effectiveResultFile = resultFile ?? `${phaseRoot}/result.json`;
  return writeValidatedResponse(
    root,
    task,
    taskSource.relative,
    validated,
    effectiveResultFile,
    beforeCommit,
    afterFilesWritten,
  );
}
```

写入循环：

```js
for (const candidate of stableCandidates) {
  if (beforeCommit) await beforeCommit({ kind: "candidate", path: candidate.path });
  await rename(candidate.temporary, candidate.target);
}
if (afterFilesWritten) await afterFilesWritten();
if (beforeCommit) await beforeCommit({ kind: "result", path: resultFile });
await rename(resultTemporary, resultTarget.fullPath);
```

- [ ] **Step 6: GREEN - v1.2 Worktree Worker 分支**

```js
if (task.schemaVersion === "1.2") {
  return runWaveWorktreeWorker({
    root,
    state,
    task,
    taskFile,
    options,
  });
}
```

该分支：

- 绑定 WaveStatus/creation receipt/ledger/attempt。
- 使用 attempt result 路径。
- 复用现有 context、policy、candidate 和 Git 变更校验原语。
- 把 `assertAttemptOwned` 作为 `beforeCommit`。
- result 完成后再次校验 Git 事实，再写 attempt execution receipt。

- [ ] **Step 7: GREEN - `execute-wave`**

```js
const settled = await Promise.allSettled(
  claimed.map((claim) => executeClaimedTask(root, context, claim, options)),
);
const inspected = await inspectWaveExecution({ root, waveFile: context.ledgerFile });
return {
  command: "execute-wave",
  settled: settled.map(summarizeSettlement),
  ledger: inspected.ledger,
  diagnostics: inspected.diagnostics,
};
```

不能直接按 `settled.status` 更新成功状态；execution receipt 和 Git 事实是唯一成功依据。

- [ ] **Step 8: 验证 GREEN**

Run Task 5 三组测试。Expected: 全部通过。

---

### Task 6: Retry、最终门禁、文档与 Review

**Files:**
- Modify: `.harness/scripts/lib/worktree-wave-execution-runtime.mjs`
- Modify: `.harness/scripts/tests/worktree-wave-execution-runtime.test.mjs`
- Modify: `.harness/structure-manifest.yaml`
- Modify: `.harness/scripts/validate-structure.ps1`
- Modify: `.harness/README.md`
- Modify: `.harness/scripts/README.md`
- Modify: `docs/harness-architecture-adaptation.md`
- Modify: `docs/harness-structure-checklist.md`
- Modify: `docs/AI-handover.md`
- Modify: `llm-knowledge/overview.md`
- Create: `docs/harness-m5d-wave-execution/REPORT-C1.md`
- Create: `.harness/runs/M5-D-C1-001/phases/03-implementation/implementation-notes.md`
- Create: `.harness/runs/M5-D-C1-001/phases/04-unit-test/test-report.md`
- Create: `.harness/runs/M5-D-C1-001/phases/05-code-review/code-review-report.md`

- [ ] **Step 1: RED - `retry-task`**

测试：

```js
test("retry-task requires a new approval and binds the previous attempt evidence", async () => {
  await assert.rejects(
    runWaveExecutionCommand({
      command: "retry-task",
      taskId: "T2",
      expectedWaveLedgerSha256,
      expectedPreviousFailureSha256,
    }),
    /ConfirmWaveTaskRetry/,
  );

  const retried = await runWaveExecutionCommand({
    command: "retry-task",
    taskId: "T2",
    expectedWaveLedgerSha256,
    expectedPreviousFailureSha256,
    confirmWaveTaskRetry: true,
  });
  assert.notEqual(retried.task.currentAttemptId, previousAttemptId);
});
```

旧 Provider 在新 attempt 建立后返回时，必须因 owner guard 失败且不能覆盖新 result。

- [ ] **Step 2: GREEN - 实现 Retry**

`retry-task`：

```text
验证 blocked 状态
-> 绑定 failure 或完整 blocked receipt
-> 确认无 manifest freeze
-> 生成新 attempt
-> 执行与普通 claim 相同的两阶段所有权流程
```

不删除旧 attempt。

- [ ] **Step 3: 更新结构登记**

登记新 Runtime、测试和 7 个 Schema。`validate-structure.ps1` 的 JSON 校验列表同步增加。

- [ ] **Step 4: 运行专项和直接回归**

```powershell
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
```

Expected: 全部退出 0。

- [ ] **Step 5: 运行 Harness 门禁**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\tests\task-dag.test.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\validate-structure.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\smoke-harness-flow.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\check-kb-freshness.ps1

git diff --check
```

Expected:

- 结构、Smoke 和 DAG 通过。
- backend/frontend/common baseline/index 为 fresh，semantic 可为 pending。
- `git diff --check` 无空白错误。

- [ ] **Step 6: 生成 C1 报告**

`REPORT-C1.md` 必须记录：

- 每项 RED 的真实失败原因。
- 最终 GREEN 命令和计数。
- phase owner、v1.2、attempt、并行、partial、retry、recover 的行为证据。
- 两轮设计 Review 如何转化为实现门禁。
- 正式仓库未执行 Worktree、Worker 或 Apply。
- C2 manifest、集成、finalize 和 M3 apply 仍未实现。

- [ ] **Step 7: 推进 Harness 阶段**

通过状态 Runtime 依次记录：

```text
implementation output
-> unit-test test/passed
-> code-review review/passed
-> build-publish no-build-required
-> interface-verification Harness-only
-> git-delivery
```

未获新的 Git 批准时停在 `git-delivery`，不执行 `complete`。

- [ ] **Step 8: 最终只读 Review**

使用 `frontier-code-review-gate`，重点检查：

- wave owner 是否能被普通/batch 路径绕过。
- attempt 所有副作用是否均有 owner guard。
- claim/task lock 半完成状态是否可收敛。
- status 是否保持只读。
- Worker partial 是否可能误写主树或 phase result。
- v1.0/v1.1 是否回归。

存在 `BLOCKER/WARNING` 时回到对应任务补 RED、修复并重跑受影响门禁。

---

## 3. M5-D-C1 完成定义

- Task DAG 只有一个完整 implementation wave。
- ordinary、serial-batch、worktree-wave owner 互斥。
- v1.2 task/result 精确且身份不可注入。
- attempt 历史不可覆盖；旧 owner 在所有写点失权。
- 两阶段 claim 中断可通过显式恢复收敛。
- 多个 Mock Worker 在临时 fixture 中真实并行。
- 部分失败保留成功 execution receipt，只显式重试失败任务。
- 全部任务 ready 前主工作树、phase result 和 M2/M3 状态字节不变。
- 所有专项、直接回归、结构、Smoke、知识和 diff 门禁通过。
- 最终 Review 无未解决 `BLOCKER/WARNING`。
- C2 仍是下一独立 Story，不在 C1 中提前实现。

## 4. Git 边界

本计划不包含自动提交步骤。到达 `git-delivery` 后只生成 owned changes、验证摘要和建议提交信息。只有用户对具体 Git 操作再次明确批准后，才允许精确暂存本 Story 文件并提交。
