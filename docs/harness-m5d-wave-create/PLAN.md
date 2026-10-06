# Harness M5-D-B 审批门控 WaveCreate 实施计划

> **执行要求：** 实施时使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。所有步骤使用复选框跟踪；生产代码之前必须先观察到对应测试按预期 RED。

**目标：** 在现有 Worktree Runtime 中增加审批绑定、可恢复且具备锁所有权 fencing 的 `WaveCreate`，按确定顺序创建同一 wave 的多个 Worktree，并以 Git 事实和完成回执收敛。

**架构：** 继续复用 `worktree-runtime.mjs` 的 M5-D-A `WavePlan/WaveStatus`、固定 Git argv、路径校验和原子 JSON。新增 wave 专用锁、allowlist、创建回执与 PowerShell/CLI 参数，不修改 M2/M3 状态，不创建第二套 Runtime。

**技术栈：** Node.js ESM、`node:test`、PowerShell、Git worktree、JSON Schema、FrontierScan Harness Runtime。

---

## 0. 执行边界

- 本计划中的正式仓库 Worktree 创建仅指未来 `WaveCreate` 功能的被测行为；测试必须使用临时 Git fixture。
- 在用户再次明确批准前，不在 `D:\ProjectStudy\FrontierScan` 正式仓库执行 `WaveCreate`、`Create`、`BatchCreate` 或任何 Worktree 创建/回收。
- 不执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- 由于 Git 操作需要逐次审批，本计划不包含自动提交步骤；每个任务以测试证据和 owned diff 审核作为 checkpoint。
- 当前未跟踪的 `CODEX-CROSS-SESSION-HANDOFF.md` 不属于本 Story，不修改、不暂存、不删除。
- 实施过程中若文件锁无法关闭设计要求的竞争窗口，停止实施并回到技术设计，不得弱化 `ExpectedPlanSha256`、锁哈希绑定或 fencing。

## 1. 预期文件结构

### 新增

```text
.harness/schemas/worktree-wave-lock.schema.json
.harness/schemas/worktree-wave-creation-receipt.schema.json
docs/harness-m5d-wave-create/REPORT.md
```

### 修改

```text
.harness/scripts/lib/worktree-runtime.mjs
.harness/scripts/run-worktree.ps1
.harness/scripts/tests/worktree-wave-runtime.test.mjs
.harness/schemas/worktree-wave-status.schema.json
.harness/structure-manifest.yaml
.harness/scripts/validate-structure.ps1
.harness/README.md
.harness/scripts/README.md
docs/harness-architecture-adaptation.md
docs/harness-structure-checklist.md
docs/AI-handover.md
llm-knowledge/overview.md
CODEX-CROSS-SESSION-HANDOFF.md
```

`CODEX-CROSS-SESSION-HANDOFF.md` 只有在本 Story 完成并确认其仍是交接入口时才更新；它当前为用户已有未跟踪文件，实施期间不得覆盖或自动纳入 Git 交付。

## 2. 候选 Task DAG

所有任务都会修改 `worktree-runtime.mjs` 或 wave 测试，因此严格串行：

```json
{
  "schemaVersion": "1.0",
  "storyId": "M5-D-B-001",
  "nodes": [
    {
      "taskId": "T1",
      "title": "绑定批准计划并暴露锁事实",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-runtime.test.mjs",
        ".harness/schemas/worktree-wave-lock.schema.json"
      ],
      "acceptanceCriteria": [
        "WaveCreate 缺少确认或计划哈希时在任何 Git 写入前失败",
        "WaveStatus 在命令结果顶层以结构化字段展示当前创建锁和恢复锁哈希"
      ]
    },
    {
      "taskId": "T2",
      "title": "实现普通 WaveCreate 与波次 allowlist",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-runtime.test.mjs"
      ],
      "acceptanceCriteria": [
        "合法 wave 按稳定顺序创建多个 Worktree",
        "同一 Story 其他 wave 或计划外 Worktree 被拒绝"
      ]
    },
    {
      "taskId": "T3",
      "title": "实现恢复锁与所有权 fencing",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-runtime.test.mjs"
      ],
      "acceptanceCriteria": [
        "旧创建所有者在恢复锁出现后不能继续副作用或删除锁",
        "恢复再次中断后可通过新批准和新锁哈希继续"
      ]
    },
    {
      "taskId": "T4",
      "title": "实现部分创建恢复与完成回执",
      "type": "integration",
      "status": "pending",
      "ownerAgent": "backend-developer",
      "predictedFiles": [
        ".harness/scripts/lib/worktree-runtime.mjs",
        ".harness/scripts/tests/worktree-wave-runtime.test.mjs",
        ".harness/schemas/worktree-wave-creation-receipt.schema.json"
      ],
      "acceptanceCriteria": [
        "部分失败保留已创建项并只重试缺失项",
        "只有当前 Git 事实为 ready 时才写入可验证回执"
      ]
    },
    {
      "taskId": "T5",
      "title": "接入 PowerShell、结构登记和项目文档",
      "type": "docs",
      "status": "pending",
      "ownerAgent": "task-planner",
      "predictedFiles": [
        ".harness/scripts/run-worktree.ps1",
        ".harness/structure-manifest.yaml",
        ".harness/scripts/validate-structure.ps1",
        ".harness/README.md",
        ".harness/scripts/README.md",
        "docs/harness-architecture-adaptation.md",
        "docs/harness-structure-checklist.md",
        "docs/AI-handover.md",
        "llm-knowledge/overview.md",
        "docs/harness-m5d-wave-create/REPORT.md"
      ],
      "acceptanceCriteria": [
        "PowerShell 和 Node CLI 只接受设计批准的 WaveCreate 参数",
        "结构、回归、Smoke、知识新鲜度和 owned diff Review 通过"
      ]
    }
  ],
  "edges": [
    { "from": "T1", "to": "T2", "reason": "普通创建依赖不可变计划和锁事实契约" },
    { "from": "T2", "to": "T3", "reason": "恢复 fencing 依赖普通创建所有权模型" },
    { "from": "T3", "to": "T4", "reason": "部分恢复和回执必须建立在稳定锁状态机上" },
    { "from": "T4", "to": "T5", "reason": "入口和文档必须描述最终已验证行为" }
  ],
  "waves": [["T1"], ["T2"], ["T3"], ["T4"], ["T5"]],
  "globalChanges": [],
  "risks": [
    "Windows 文件锁替换和受控中断恢复必须通过真实临时 Git fixture 验证",
    "恢复流程依赖用户确认旧创建和恢复进程均已停止"
  ]
}
```

---

### Task 0：初始化 Harness Story 与阶段产物

**文件：**

- 创建：`.harness/states/e2e-M5-D-B-001.json`，只能通过状态 Runtime。
- 创建：`.harness/runs/M5-D-B-001/phases/00-requirement/requirement-breakdown.md`
- 创建：`.harness/runs/M5-D-B-001/phases/01-technical-design/technical-design.md`
- 创建：`.harness/runs/M5-D-B-001/phases/02-task-dag/task-dag.json`

- [ ] **Step 1：实施前重新核验仓库事实**

运行：

```powershell
git status --short --branch
git rev-parse HEAD
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command status `
  -Json
```

预期：

- 分支仍为 `dev`。
- 原活动状态仍为已完成的 `M5-D-A-001`，或清晰报告比本计划更新的当前事实。
- 不覆盖任何新出现的无关修改。

- [ ] **Step 2：初始化 M5-D-B 单 Story 状态**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command init `
  -StoryId M5-D-B-001 `
  -Summary "为已批准的同 wave 多 Worktree 计划增加审批绑定、创建、锁 fencing、部分恢复和完成回执"
```

预期：新状态处于 `requirement/active`，revision `1`。

- [ ] **Step 3：写入需求阶段产物**

需求产物必须包含以下验收标准：

```markdown
- [ ] WaveCreate 只消费现有 WavePlan，并强制绑定 ExpectedPlanSha256。
- [ ] 一次批准只覆盖一个明确 wave。
- [ ] 部分失败保留已创建 Worktree，只重试缺失项。
- [ ] 遗留锁只在用户确认旧进程停止并绑定全部锁哈希后恢复。
- [ ] 同一 Story 其他 wave 或计划外 Worktree 使创建失败。
- [ ] 不调用 M2/M3，不执行 Worker、merge、remove、提交或发布。
```

先记录需求产物：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command record `
  -RecordType output `
  -Status present `
  -Path .harness/runs/M5-D-B-001/phases/00-requirement/requirement-breakdown.md
```

再推进：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command next
```

预期：进入 `technical-design`。

- [ ] **Step 4：将已确认设计保存为技术设计阶段产物**

技术设计阶段产物必须与 `docs/harness-m5d-wave-create/DESIGN.md` 一致，并明确引用其 SHA-256，不新增未确认范围。

先记录技术设计产物：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command record `
  -RecordType output `
  -Status present `
  -Path .harness/runs/M5-D-B-001/phases/01-technical-design/technical-design.md
```

再推进：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command next
```

预期：进入 `task-dag`。

- [ ] **Step 5：写入并校验候选 Task DAG**

将本计划第 2 节 JSON 保存为：

```text
.harness/runs/M5-D-B-001/phases/02-task-dag/task-dag.json
```

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\validate-task-dag.ps1 `
  -TaskDagFile .\.harness\runs\M5-D-B-001\phases\02-task-dag\task-dag.json
```

预期：DAG 合法、无环、五个任务严格串行。

- [ ] **Step 6：推进至 implementation**

先记录 DAG 产物：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command record `
  -RecordType output `
  -Status present `
  -Path .harness/runs/M5-D-B-001/phases/02-task-dag/task-dag.json
```

再推进：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command next
```

预期：进入 `implementation`，实施前状态文件校验通过。

---

### Task 1：绑定批准计划并暴露锁事实

**文件：**

- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/tests/worktree-wave-runtime.test.mjs`
- 创建：`.harness/schemas/worktree-wave-lock.schema.json`

- [ ] **Step 1：RED - 增加批准绑定测试**

在 wave 测试中增加：

```js
test("wave create requires explicit approval and the exact stored plan hash before Git writes", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-APPROVAL" });
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const calls = [];
  const executeGit = async (args) => {
    calls.push(args);
    return git(fixture.root, ...args);
  };

  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: planned.status.wavePlanSha256,
      executeGit,
    }),
    /ConfirmWaveCreate/,
  );
  await assert.rejects(
    runWorktreeCommand({
      root: fixture.root,
      command: "wave-create",
      stateFile: fixture.stateFile,
      taskDagFile: fixture.taskDagFile,
      waveIndex: 1,
      expectedPlanSha256: `sha256:${"0".repeat(64)}`,
      confirmWaveCreate: true,
      executeGit,
    }),
    /approved plan hash|ExpectedPlanSha256/i,
  );
  assert.equal(calls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
});
```

- [ ] **Step 2：RED - 增加锁事实测试**

测试必须断言 `WaveStatus` 命令结果新增固定顶层 `locks` 字段：

```js
assert.deepEqual(status.locks, {
  create: null,
  recovery: null,
});
```

手工写入合法锁 fixture 后，断言每个非空锁包含：

```text
file
sha256
lockId
mode
storyId
runId
wave
planSha256
pid
createdAt
```

- [ ] **Step 3：运行专项测试并确认 RED**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期失败原因：

- `wave-create` 尚不支持。
- `WaveStatus` 尚无 `locks` 字段。

- [ ] **Step 4：GREEN - 增加最小锁结构和状态读取**

在 `worktree-runtime.mjs` 中：

```js
const WAVE_LOCK_FIELDS = [
  "schemaVersion", "lockId", "mode", "storyId", "runId",
  "wave", "planSha256", "pid", "createdAt",
];

```

扩展 `waveOutputPaths`，计划/状态/回执保持 wave 级，锁上移为 run/Story 共享：

```js
const lockDirectory = `.harness/runs/${state.runtime.runId}/waves`;
createLockFile: `${lockDirectory}/create.lock`,
recoveryLockFile: `${lockDirectory}/create-recovery.lock`,
receiptFile: `${directory}/creation-receipt.json`,
```

新增只读 `inspectWaveLock(root, lockFile, expectedMode, plan)`，按固定顺序执行：

```text
解析 lockFile 为仓库内固定路径
-> 文件不存在时返回 null
-> 拒绝目录、符号链接和非法 JSON
-> 验证九个精确锁字段
-> 验证 mode/storyId/runId/wave/planSha256
-> 计算当前文件 SHA-256
-> 返回 file/sha256 与九个锁字段
```

`waveStatus` 在读取稳定 `status.json` 后调用两次 `inspectWaveLock`，形成命令结果顶层字段：

```js
locks: {
  create: await inspectWaveLock(root, outputs.createLockFile, "create", plan),
  recovery: await inspectWaveLock(root, outputs.recoveryLockFile, "recovery", plan),
},
```

不得修改 `validateWaveStatusStructure` 或 `comparableWaveStatus`；动态锁事实不能进入持久化状态哈希。
复用 `WavePlan` 与普通 `WaveStatus` 不持久化新观察结果，只返回动态 Git 事实；稳定状态更新仅由初次规划与持锁 `WaveCreate` 执行。

- [ ] **Step 5：GREEN - 增加严格 Schema**

`worktree-wave-lock.schema.json` 固定上述九个锁字段并设置 `additionalProperties: false`。命令结果中的锁快照由 Runtime 精确字段校验，不修改 `worktree-wave-status.schema.json`。

- [ ] **Step 6：验证 GREEN**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：Task 1 新增测试通过，既有 M5-D-A 测试保持通过。

- [ ] **Step 7：审核 Task 1 owned diff**

检查：

```powershell
git diff -- .harness/scripts/lib/worktree-runtime.mjs `
  .harness/scripts/tests/worktree-wave-runtime.test.mjs `
  .harness/schemas/worktree-wave-lock.schema.json `
  .harness/schemas/worktree-wave-status.schema.json
```

重点确认状态读取保持只读，不写锁、不调用 `git worktree add`。

---

### Task 2：实现普通 WaveCreate 与波次 Allowlist

**文件：**

- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/tests/worktree-wave-runtime.test.mjs`

- [ ] **Step 1：RED - 正常创建和 branch-only**

新增测试：

```js
test("wave create creates absent tasks in plan order and resumes branch-only tasks", async () => {
  const fixture = await createFixture({ storyId: "M5-D-B-CREATE" });
  const statePath = path.join(fixture.root, fixture.stateFile);
  const before = await readFile(statePath, "utf8");
  const planned = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-plan",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
  });
  const [first] = planned.plan.tasks;
  await git(fixture.root, "branch", first.branch, planned.plan.baseCommit);
  const additions = [];
  const created = await runWorktreeCommand({
    root: fixture.root,
    command: "wave-create",
    stateFile: fixture.stateFile,
    taskDagFile: fixture.taskDagFile,
    waveIndex: 1,
    expectedPlanSha256: planned.status.wavePlanSha256,
    confirmWaveCreate: true,
    executeGit: async (args) => {
      if (args[0] === "worktree" && args[1] === "add") additions.push(args);
      return git(fixture.root, ...args);
    },
  });

  assert.equal(created.status.state, "ready");
  assert.deepEqual(created.status.tasks.map((task) => task.state), ["created", "created"]);
  assert.equal(additions.length, 2);
  assert.equal(additions[0].includes("-b"), false);
  assert.equal(additions[1].includes("-b"), true);
  assert.equal(await readFile(statePath, "utf8"), before);
});
```

断言 `branch-only` 使用：

```text
git worktree add <targetPath> <existingBranch>
```

`absent` 使用：

```text
git worktree add -b <branch> <targetPath> <baseCommit>
```

- [ ] **Step 2：RED - 批准计划 TOCTOU**

使用注入钩子在锁获取后和第二个任务前改写 `plan.json`，分别断言：

- 不执行第一个 Git 写入。
- 第一个任务已创建后，不执行第二个 Git 写入。
- 不产生完成回执。

- [ ] **Step 3：RED - 波次 Allowlist**

覆盖：

- 当前 Story 其他 wave 已注册 Worktree。
- 当前 Story 根目录计划外 Worktree。
- 计划分支异地挂载。
- 目标路径占用。
- 主工作树存在无关未跟踪文件。

所有场景必须在目标 `git worktree add` 前失败。

- [ ] **Step 4：运行测试并确认 RED**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：因 `waveCreate`、wave 创建锁和 allowlist 尚未实现而失败。

- [ ] **Step 5：GREEN - 实现普通创建所有权**

新增 wave 专用 helper，不修改现有单任务 `acquireLock` 和 `assertNoOtherStoryWorktree`：

```text
acquireWaveCreateLock(context, planSha256, options)
  -> recovery lock 必须不存在
  -> 使用 open(path, "wx") 写入新 create lockId
  -> 重新读取 create lock并保存其 SHA-256
  -> 再次检查 recovery lock

assertWaveLockOwned(context, owner, options)
  -> 重新读取对应活动锁
  -> 比较 lockId/mode/storyId/runId/wave/planSha256/SHA-256
  -> create owner 额外要求 recovery lock 不存在

releaseWaveLockOwned(context, owner, options)
  -> 重新执行所有权校验
  -> 仅删除当前 owner 对应且内容未变化的锁

assertWaveStoryAllowlist(root, plan, options)
  -> 读取一次 git worktree list --porcelain
  -> 允许主工作树和 plan.tasks 的精确绝对路径
  -> 拒绝 Story 根目录下的其他注册路径和计划分支异地挂载
```

普通所有权必须满足：

```js
owner.mode === "create"
&& currentCreateLock.lockId === owner.lockId
&& currentCreateLock.sha256 === owner.sha256
&& currentRecoveryLock === null
```

- [ ] **Step 6：GREEN - 实现最小 waveCreate**

```js
async function waveCreate(root, options) {
  assertWaveCreateInputs(options);
  const initial = await loadApprovedWaveContext(root, options);
  const owner = await acquireWaveCreateLock(initial, options.expectedPlanSha256, options);
  try {
    const context = await reloadApprovedWaveContext(root, options, owner);
    await assertMainRepositoryClean(root, context, context.plan, options);
    await assertWaveStoryAllowlist(root, context.plan, options);
    let current = await inspectWaveStatus(root, context.plan, context.planPath, context.statusPath, options);
    for (const taskStatus of current.tasks) {
      if (taskStatus.state === "created") continue;
      await assertApprovedPlanAndLock(root, context, owner, options);
      await createWaveTask(root, context.plan, taskStatus, options);
      current = await inspectWaveStatus(root, context.plan, context.planPath, context.statusPath, options);
    }
    return { command: "wave-create", reused: false, plan: context.plan, status: current };
  } finally {
    await releaseWaveLockOwned(initial, owner, options);
  }
}
```

`releaseWaveLockOwned` 发现恢复锁后不得删除 `create.lock`。

- [ ] **Step 7：接入 runWorktreeCommand**

```js
if (options.command === "wave-create") return waveCreate(root, options);
```

- [ ] **Step 8：验证 GREEN**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：普通创建、branch-only、计划漂移和 allowlist 测试通过。

- [ ] **Step 9：审核 Task 2 owned diff**

确认：

- 未削弱 M5-A/M5-B3-B helper。
- 每次 Git 写入前重新读取计划和锁。
- 正式仓库未创建 Worktree。

---

### Task 3：实现恢复锁与所有权 Fencing

**文件：**

- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/tests/worktree-wave-runtime.test.mjs`

- [ ] **Step 1：RED - 创建与恢复竞争**

增加测试注入点：

```text
afterWaveCreateLockAcquired
beforeWaveTaskCreate
afterWaveRecoveryLockAcquired
beforeWaveStatusWrite
beforeWaveReceiptWrite
```

测试必须证明：

- 普通创建持有 `create.lock` 后出现恢复锁，旧所有者不调用 Git。
- 旧所有者不写状态、不写回执、不删除原 `create.lock`。
- 两个普通创建只有一个获得所有权。
- 同一 Story 不同 wave 也只能有一个获得共享创建锁。
- 恢复锁在分支探测后、Git 写入前或状态写入点出现时，旧所有者失败且不写对应副作用。

- [ ] **Step 2：RED - 首次恢复与锁哈希绑定**

准备合法遗留 `create.lock`，调用：

```js
await runWorktreeCommand({
  root: fixture.root,
  command: "wave-create",
  stateFile: fixture.stateFile,
  taskDagFile: fixture.taskDagFile,
  waveIndex: 1,
  expectedPlanSha256,
  confirmWaveCreate: true,
  confirmWaveLockRecovery: true,
  expectedCreateLockSha256,
});
```

断言：

- 缺少或错误锁哈希时锁和 Git 事实字节不变。
- 正确哈希时创建 `create-recovery.lock` 并从当前 Git 状态继续。

- [ ] **Step 3：RED - 恢复再次中断**

覆盖三个中断点：

1. 恢复锁写入后、Git 之前。
2. 首项 Git 成功后、状态写入前。
3. `ready` 后、完成回执前。

再次调用必须绑定当前 `create.lock` 和 `create-recovery.lock` 的新哈希，原批准不能复用。

- [ ] **Step 4：运行测试并确认 RED**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：恢复参数和 recovery ownership 尚未实现。

- [ ] **Step 5：GREEN - 实现恢复所有权**

新增 `acquireWaveRecoveryLock(context, options)`，按以下确定顺序执行：

```text
读取 create.lock 和 create-recovery.lock 当前快照
-> 要求至少存在一个阻塞锁
-> 对每个存在锁要求对应 Expected*LockSha256
-> 拒绝缺少、额外或不匹配的预期哈希
-> 验证所有锁与当前 Story/wave/planSha256 一致
-> 在测试钩子后、实际替换前重新读取并比较完整锁集合
-> 原子写入带新 lockId、mode=recovery 的 create-recovery.lock
-> 重新读取 recovery lock，确认 lockId 等于本次生成值并保存新 SHA-256 作为 owner token
-> 再次确认 create.lock 仍等于用户批准哈希
```

恢复所有权：

```js
owner.mode === "recovery"
&& currentRecoveryLock.lockId === owner.lockId
&& currentRecoveryLock.sha256 === owner.sha256
```

恢复期间旧 `create.lock` 保留。`create` 所有者只要看到非空恢复锁就失去 fencing。

- [ ] **Step 6：GREEN - 明确恢复清理顺序**

正常恢复结束：

```text
assert recovery lock owned
-> 若 create.lock 存在，比较用户批准的 create lock hash
-> 删除仍未变化的 create.lock
-> 再次 assert recovery lock owned
-> 删除自身 create-recovery.lock
```

恢复失败或中断时保留恢复锁。后续恢复通过新的预期锁哈希原子替换恢复锁，不按 PID 或时间清理。
两个恢复调用同时基于同一旧快照时，测试必须强制它们在替换前会合，并证明只有最终磁盘 `lockId` 的所有者可以继续。

- [ ] **Step 7：验证 GREEN**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：并发、fencing、首次恢复和恢复再次中断测试通过。

- [ ] **Step 8：审核 Task 3 owned diff**

重点检查：

- 没有无条件 `unlink(create.lock)`。
- 所有 Git、状态、回执和释放动作前都有 ownership check。
- `writeAtomicJson` 替换恢复锁后立即重新读取并匹配本次生成的 `lockId`，不采用其他调用写入的 owner。
- 实际替换前再次绑定全部现存锁，新增、缺失或哈希变化都不得覆盖。
- 恢复异常保留两把锁；只有完成回执成功后才清理恢复锁。

---

### Task 4：实现部分创建恢复与完成回执

**文件：**

- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/tests/worktree-wave-runtime.test.mjs`
- 创建：`.harness/schemas/worktree-wave-creation-receipt.schema.json`

- [ ] **Step 1：RED - 第二项失败与缺失项重试**

注入第二次 `git worktree add` 失败：

```js
if (args[0] === "worktree" && args[1] === "add" && ++adds === 2) {
  throw new Error("simulated second wave create failure");
}
```

断言：

- 第一项仍为 `created`。
- wave 状态为 `partial`。
- 无完成回执。
- 下一次调用只产生一次 `git worktree add`。

- [ ] **Step 2：RED - 状态和回执中断**

覆盖：

- Git 成功、状态写入前中断。
- 全部 Git 成功、回执写入前中断。
- 回执存在后计划、状态或 Git HEAD 漂移。

断言重试从 Git 事实恢复；漂移时拒绝回执复用。

- [ ] **Step 3：运行测试并确认 RED**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：`creation-receipt.json` 尚不存在或字段不足。

- [ ] **Step 4：GREEN - 增加回执结构**

Runtime 固定字段：

```js
const WAVE_CREATION_RECEIPT_FIELDS = [
  "schemaVersion", "storyId", "runId", "wave", "planSha256",
  "taskDagSha256", "statusSha256", "baseCommit", "tasks",
  "lockRecovered", "completedAt",
];
```

任务字段：

```js
["taskId", "branch", "worktreePath", "headCommit"]
```

Schema 设置 `additionalProperties: false`，SHA-256 和 commit 使用现有格式约束。

- [ ] **Step 5：GREEN - 固定写入顺序**

```text
完整 inspectWaveStatus
-> state 必须为 ready
-> assert plan hash
-> assert active lock owned
-> 计算 statusSha256
-> 原子写 creation-receipt.json
-> 再次 assert active lock owned
-> 返回结果
```

幂等调用先重新验证计划、状态、Git 和回执，再返回 `reused: true`。

- [ ] **Step 6：GREEN - Git 失败后的事实收敛**

捕获 `git worktree add` 错误后，按以下顺序处理：

```text
保存原始 Git 错误和失败 taskId
-> 在当前锁所有权下调用完整 inspectWaveStatus
-> 成功时原子写入真实状态并作为 lastTrustedStatus
-> 失败时保留进入该任务前的 lastTrustedStatus
-> 抛出同时包含原始 Git 诊断、失败 taskId 和 lastTrustedStatus.state 的错误
```

不得因状态重算失败覆盖原始 Git 失败诊断。

- [ ] **Step 7：验证 GREEN**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：部分失败、状态中断、回执中断和漂移测试通过。

- [ ] **Step 8：审核 Task 4 owned diff**

确认：

- `ready` 前没有回执。
- 回执从不替代 Git 事实。
- Harness state 文件字节不变。

---

### Task 5：接入 PowerShell、结构登记、文档和回归

**文件：**

- 修改：`.harness/scripts/run-worktree.ps1`
- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/tests/worktree-wave-runtime.test.mjs`
- 修改：`.harness/structure-manifest.yaml`
- 修改：`.harness/scripts/validate-structure.ps1`
- 修改：`.harness/README.md`
- 修改：`.harness/scripts/README.md`
- 修改：`docs/harness-architecture-adaptation.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`docs/AI-handover.md`
- 修改：`llm-knowledge/overview.md`
- 创建：`docs/harness-m5d-wave-create/REPORT.md`

- [ ] **Step 1：RED - PowerShell 参数契约**

临时 fixture 中运行：

```powershell
.\.harness\scripts\run-worktree.ps1 `
  -Command WaveCreate `
  -Root <fixture-root> `
  -StateFile <state-file> `
  -TaskDagFile <task-dag-file> `
  -WaveIndex 1 `
  -ExpectedPlanSha256 <plan-sha256> `
  -ConfirmWaveCreate `
  -Json
```

增加失败断言：

- `WaveCreate -BaseRef dev` 被拒绝。
- `WaveCreate -TaskId T1` 被拒绝。
- 锁恢复确认与预期锁哈希正确转发。

- [ ] **Step 2：运行测试并确认 RED**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
```

预期：PowerShell `ValidateSet` 或 Node CLI 尚不识别新命令/参数。

- [ ] **Step 3：GREEN - 扩展 PowerShell**

修改：

```powershell
[ValidateSet(
  "Plan", "Status", "Create", "Retire",
  "BatchPlan", "BatchStatus", "BatchCreate", "BatchRetire",
  "WavePlan", "WaveStatus", "WaveCreate"
)]
```

新增参数：

```powershell
[string]$ExpectedPlanSha256,
[string]$ExpectedCreateLockSha256,
[string]$ExpectedRecoveryLockSha256,
[switch]$ConfirmWaveCreate,
[switch]$ConfirmWaveLockRecovery,
```

`WaveCreate` 必须拒绝 `TaskId/BaseRef`，并要求 `TaskDagFile/WaveIndex/ExpectedPlanSha256/ConfirmWaveCreate`。

- [ ] **Step 4：GREEN - 扩展 Node CLI**

`parseCliArguments` 增加：

```js
"--expected-plan-sha256": "expectedPlanSha256",
"--expected-create-lock-sha256": "expectedCreateLockSha256",
"--expected-recovery-lock-sha256": "expectedRecoveryLockSha256",
```

布尔参数：

```js
if (token === "--confirm-wave-create") { options.confirmWaveCreate = true; continue; }
if (token === "--confirm-wave-lock-recovery") {
  options.confirmWaveLockRecovery = true;
  continue;
}
```

- [ ] **Step 5：登记结构和 JSON Schema**

在 `.harness/structure-manifest.yaml` 登记新增 Schema。

在 `validate-structure.ps1` 的 JSON 校验列表加入：

```text
.harness/schemas/worktree-wave-plan.schema.json
.harness/schemas/worktree-wave-status.schema.json
.harness/schemas/worktree-wave-lock.schema.json
.harness/schemas/worktree-wave-creation-receipt.schema.json
```

- [ ] **Step 6：运行专项和直接相关回归**

```powershell
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
```

预期：全部通过，正式仓库无 Worktree 副作用。

- [ ] **Step 7：运行 Harness 门禁**

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
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

预期：全部通过；知识 semantic 仍可为 `pending`，baseline/index 必须为 `fresh`。

- [ ] **Step 8：更新中文文档**

文档只描述已实际通过测试的能力：

- `WaveCreate` 的计划哈希绑定。
- 普通创建和恢复锁。
- `lockId` fencing。
- 部分创建恢复。
- 完成回执。
- 同一 Story 单 wave 限制。
- 仍延期 Worker、merge/remove、Fork-Join 和真实发布。

- [ ] **Step 9：生成测试与实施报告**

创建：

```text
.harness/runs/M5-D-B-001/phases/03-implementation/implementation-notes.md
.harness/runs/M5-D-B-001/phases/04-unit-test/test-report.md
docs/harness-m5d-wave-create/REPORT.md
```

报告必须列出：

- 每项 RED 的真实失败原因。
- 最终 GREEN 命令与结果。
- 受控中断点。
- 独立评审发现及修订。
- 正式仓库未执行 Worktree 创建的证据。
- 剩余边界和未执行操作。

- [ ] **Step 10：只读 Review**

使用 `frontier-code-review-gate` 审核 task-owned diff，重点检查：

- 批准是否始终绑定 `ExpectedPlanSha256`。
- 旧锁所有者是否可能继续副作用或删除新锁。
- 任一异常是否可能写出误导性 `ready` 或回执。
- 单任务和批次 Worktree 语义是否回归。

存在 `BLOCKER/WARNING` 时回到对应 RED-GREEN 任务修复并重跑受影响门禁。

- [ ] **Step 11：推进剩余 Harness 阶段**

按状态 Runtime 依次记录：

```text
implementation
-> unit-test
-> code-review
-> build-publish
-> interface-verification
-> git-delivery
```

本 Story 不涉及 backend/frontend、Docker 或真实环境发布时，在报告中明确记录不适用原因。

- [ ] **Step 12：Git 交付审批门禁**

到达 `git-delivery` 后，只生成 owned changes 摘要。只有用户再次明确批准具体操作后，才能逐个暂存本 Story 实际修改且应版本化的文件，随后执行 `git commit`、`git push` 或创建 PR/MR。

不得使用 `git add .`，不得纳入无关未跟踪文件。

---

## 3. 完成定义

只有同时满足以下条件，M5-D-B 才可标记完成：

- 所有新增行为都经历可解释的 RED-GREEN-REFACTOR。
- `WaveCreate` 只能执行用户批准哈希对应的计划。
- 普通创建、恢复、再次恢复和旧所有者 fencing 均通过临时 Git fixture。
- 部分失败不会自动回滚，重试只处理缺失项。
- `ready` 和完成回执只能从当前 Git 事实产生。
- 同一 Story 其他 wave 和计划外 Worktree 被拒绝。
- M5-D-A、M5-A、M5-B3-B、M3、M2 相关回归无行为退化。
- Harness state 只能由状态 Runtime 推进。
- 最终 Review 无未解决 `BLOCKER/WARNING`。
- 正式仓库未执行未批准的 Worktree、Git、发布或部署操作。
