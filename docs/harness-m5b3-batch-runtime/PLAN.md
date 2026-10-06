# M5-B3-B 单 Worktree 串行多任务批次运行时实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在保持 v1.0 单任务路径完全兼容的前提下，实现同一 Story 的 `implementation` phase 中、具有可集成 backend/frontend 候选的多节点 DAG 在一个 Worktree 内严格串行执行、逐任务集成并在全批次完成后只推进一次 phase。

**架构：** 为符合范围的多节点 DAG 引入 v1.1 task-scoped dispatch 和独立 serial batch ledger；`worktree-runtime.mjs` 解析不可变基准并管理 batch Worktree，`batch-runtime.mjs` 管理不执行 Git 的账本与锁，M3 仅负责批次准备、批次收尾和既有显式 `apply`。每项任务固定产出 `task-report.md`，保留自己的 dispatch、Worker 回执和集成回执；继承快照、DAG 路径匹配和 receipt allowlist 共同验证共享 Worktree 的累积改动。

**技术栈：** Node.js 标准库、PowerShell 薄入口、JSON Schema、`node:test`、临时 Git fixture。

---

## 实施规则

- 所有 Runtime 和 Schema 变更先写 RED 测试并确认失败，再写最小 GREEN，最后只做必要重构。
- 每个任务完成后仅运行该任务相关测试并审核 owned diff；未通过不进入下一个任务。
- batch 只接受 `implementation` phase 的 `backend` / `frontend` 节点，并且每项必须产生 `ready-for-integration` 业务候选；其他 phase 或纯 phase-output 节点失败关闭并继续使用既有单任务流程。
- 只在临时 Git fixture 中执行真实 `git worktree add/remove`；正式 FrontierScan 仓库不创建、回收、提交、推送、发布或部署。
- 不执行 `git add`、`git commit` 或 `git push`。最终交付阶段另行请求用户批准。
- `backend/src/**`、`frontend/src/**`、数据库和外部服务不在本计划范围内。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `.harness/scripts/lib/dispatch-contract.mjs` | 严格分派 v1.0/v1.1 dispatch 结构校验 |
| `.harness/schemas/dispatch-task-v1.1.schema.json`、`dispatch-result-v1.1.schema.json` | task-scoped 协议外部 Schema |
| `.harness/scripts/lib/batch-runtime.mjs` | ledger、任务顺序、锁和批次状态转换，不执行 Git |
| `.harness/schemas/serial-batch-ledger.schema.json` | batch 事实和每任务证据索引 |
| `.harness/scripts/lib/story-runtime.mjs` | `prepare-batch`、`finalize-batch`，保持原 `apply` 语义 |
| `.harness/scripts/lib/worktree-runtime.mjs` | batch plan/status/create 与后续 batch retire 事实校验 |
| `.harness/schemas/worktree-batch-plan.schema.json`、`worktree-batch-receipt.schema.json` | batch Worktree 计划和完成证据 |
| `.harness/scripts/lib/worktree-worker-runtime.mjs` | 继承快照、当前任务候选收集和 ledger 更新 |
| `.harness/scripts/lib/worker-runtime.mjs` | v1.1 任务目录、身份和结果的策略受控执行 |
| `.harness/scripts/lib/worktree-integration-runtime.mjs` | 当前主树基线的逐任务集成和 ledger 更新 |
| `.harness/scripts/tests/*batch*.test.mjs` 与既有 M3/M5 测试 | 单元、恢复和两任务临时 Git 纵向闭环 |

### 任务 1：建立 v1.1 dispatch 严格兼容契约

**文件：**

- 新增：`.harness/schemas/dispatch-task-v1.1.schema.json`
- 新增：`.harness/schemas/dispatch-result-v1.1.schema.json`
- 修改：`.harness/scripts/lib/dispatch-contract.mjs`
- 修改：`.harness/scripts/tests/worker-runtime.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

增加下列 `node:test` 用例，先断言现有实现不支持 v1.1：

```js
test("dispatch v1.0 rejects task-scoped fields", () => {
  assert.throws(() => validateDispatchTaskStructure({ ...validV10Task, taskId: "T1" }), /unsupported field/);
});

test("dispatch v1.1 requires matching task identity and task root", () => {
  assert.throws(() => validateDispatchTaskStructure({ ...validV11Task, taskId: "" }), /taskId/);
  assert.throws(() => validateDispatchResultStructure({ ...validV11Result, taskRoot: "../escape" }), /taskRoot/);
});
```

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：新增用例因 `schemaVersion: "1.1"` 或 v1.1 字段不受支持而失败；既有 v1.0 用例继续通过。

- [ ] **步骤 3：实现最小版本分派**

新增严格的版本分派，不改变 v1.0 允许字段集合：

```js
const DISPATCH_V11_FIELDS = [
  "schemaVersion", "dispatchId", "storyId", "phase", "batchId", "taskId", "taskRoot",
  "ownerAgent", "purpose", "preparedRevision", "preparedAt", "expectedOutputs", "allowedAdapters", "next",
];

function validateDispatchTaskStructure(task) {
  if (task?.schemaVersion === "1.0") return validateDispatchTaskV10(task);
  if (task?.schemaVersion === "1.1") return validateDispatchTaskV11(task);
  throw new Error("Dispatch task schemaVersion must be '1.0' or '1.1'.");
}
```

v1.1 的 `taskRoot` 必须是无符号链接逃逸风险的仓库相对目录，且 `expectedOutputs`、result outputs 和带路径 record 必须位于该目录内。task/result 的 `batchId`、`taskId`、Story、phase、dispatchId 必须相同。

- [ ] **步骤 4：运行 GREEN 与兼容回归**

运行步骤 2 的两个测试文件。预期：全部通过；v1.0 严格拒绝 v1.1 字段，v1.1 仅接受完整的 task-scoped 身份。

- [ ] **步骤 5：审核本任务差异**

运行：

```powershell
git diff --check
git diff -- .harness/schemas/dispatch-task-v1.1.schema.json .harness/schemas/dispatch-result-v1.1.schema.json .harness/scripts/lib/dispatch-contract.mjs .harness/scripts/tests/worker-runtime.test.mjs .harness/scripts/tests/story-runtime.test.mjs
```

验收：没有放宽 v1.0、没有接受未知字段、没有改变业务源码。

### 任务 2：实现串行 batch ledger 与任务状态机

**文件：**

- 新增：`.harness/schemas/serial-batch-ledger.schema.json`
- 新增：`.harness/scripts/lib/batch-runtime.mjs`
- 修改：`.harness/scripts/lib/task-dag-contract.mjs`
- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 新增：`.harness/scripts/tests/batch-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worktree-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

为以下失败关闭行为新增 fixture 与断言：非 `implementation` phase、`docs`/`test`/`integration` 节点、缺少/重复 taskId、非稳定顺序、固定 `task-report.md` 缺失、未验证 baseCommit、前序未集成即 claim、同一 batch 双锁、DAG SHA 漂移、baseCommit 漂移、已完成 receipt 哈希漂移，以及 provider 超时后的同一 task 重试。

```js
test("claim only selects the deterministic next pending task", async () => {
  const ledger = await prepareSerialBatch(fixture);
  await assert.rejects(claimBatchTask({ ...fixture, taskId: "T2" }), /next pending task/);
  assert.equal((await claimBatchTask({ ...fixture, taskId: "T1" })).task.status, "running");
});

test("ledger refuses a changed DAG before changing task state", async () => {
  await prepareSerialBatch(fixture);
  await writeFile(fixture.taskDagPath, changedDag);
  await assert.rejects(inspectBatch(fixture), /Task DAG.*changed/);
});
```

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\batch-runtime.test.mjs
```

预期：测试因模块、ledger Schema 和导出函数尚不存在而失败。

- [ ] **步骤 3：实现最小 ledger Runtime**

实现以下明确接口，所有写入使用临时文件加 rename：

```js
resolveBatchBase({ root, baseRef = "dev" })
prepareSerialBatch({ root, stateFile, taskDagFile, baseRef, baseCommit })
inspectSerialBatch({ root, stateFile, batchFile })
claimBatchTask({ root, stateFile, batchFile, taskId })
recordBatchWorkerReady({ root, stateFile, batchFile, taskId, executionReceiptFile })
recordBatchIntegration({ root, stateFile, batchFile, taskId, integrationReceiptFile })
finalizeSerialBatch({ root, stateFile, batchFile })
```

`resolveBatchBase` 位于 `worktree-runtime.mjs`，以既有固定 Git argv 解析 `dev` 并返回已验证的 `{ baseRef, baseCommit }`；M3 的公开入口只接受 `baseRef`，再将这个内部值交给不执行 Git 的 `batch-runtime.mjs`。后者只校验格式和账本一致性，同进程直接调用不构成恶意调用方安全边界。`prepareSerialBatch` 只接受 active Story、`implementation` phase、多节点且全部 `pending` 的 backend/frontend DAG、固定 `task-report.md` 输出和已验证 `dev` commit；按 wave/taskId 生成一次性顺序与 v1.1 dispatch。Task DAG 共享模块导出 Windows 大小写不敏感的精确路径/`/**` 匹配函数，后续 Worker 和集成都必须复用，并拒绝大小写等价的 taskId。`claimBatchTask` 仅允许前序均为 `integrated` 后将下一个 `pending` 转为 `running`。超时不写 terminal 状态，显式重试仅复用同一 `running` task；有效 `failed/blocked` result 将 batch 置为 `blocked`。

- [ ] **步骤 4：运行 GREEN**

运行任务 2 的测试。预期：所有状态转移、锁、哈希漂移与恢复断言通过，且 state file 的 revision/phase 不变。

- [ ] **步骤 5：审核本任务差异**

运行：

```powershell
git diff --check
git diff -- .harness/schemas/serial-batch-ledger.schema.json .harness/scripts/lib/batch-runtime.mjs .harness/scripts/tests/batch-runtime.test.mjs
```

验收：ledger 不直接调用 `run-state`，没有自动重试或并发 claim。

### 任务 3：为 M3 增加批次准备与受控收尾

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/run-story.ps1`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

覆盖符合范围的多节点 DAG 的 `prepare-batch`、非 `implementation` phase 拒绝、单节点拒绝、phase/ledger 身份漂移、batch 未完成拒绝 `finalize-batch`、task record 去重汇总，以及 finalize 后只有普通 M3 `apply` 才改变 revision。

```js
test("finalize-batch materializes v1.0 phase artifacts without advancing state", async () => {
  const before = await readFile(fixture.statePath, "utf8");
  const result = await runStoryCommand({ ...fixture, command: "finalize-batch", batchFile: fixture.batchFile });
  assert.equal(result.status, "ready-for-apply");
  assert.equal(await readFile(fixture.statePath, "utf8"), before);
});
```

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：`prepare-batch` 和 `finalize-batch` 还不是支持的命令。

- [ ] **步骤 3：实现 M3 批次入口**

扩展 `runStoryCommand` 与 PowerShell `ValidateSet`，仅新增：

```text
prepare-batch
finalize-batch
```

`prepare-batch` 先通过 `resolveBatchBase` 固定 `dev`，再调用 `prepareSerialBatch`，不写 phase 根目录 v1.0 dispatch。`finalize-batch` 仅在 batch receipt 已完整、所有 task 已 `integrated`、phase 仍为 `implementation` 时，根据固定 `task-report.md`、execution/integration receipt 和去重 task records 生成标准 v1.0 `task.json`、`result.json`、`checkpoint.json` 与唯一 `implementation-notes.md`；随后仍必须调用原有 `apply`。原 `prepare/status/run-adapter/apply` 的参数与行为不改。

- [ ] **步骤 4：运行 GREEN 与单任务兼容回归**

运行：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：批次收尾不修改 state，`apply` 后恰好推进一次；所有 v1.0 测试通过。

- [ ] **步骤 5：审核本任务差异**

验收：M3 仍是唯一 phase 推进入口；PowerShell 只转发固定参数；没有新增发布、Git 或 Worker 自动启动能力。

### 任务 4：扩展 M5-A 为 batch Worktree 生命周期

**文件：**

- 新增：`.harness/schemas/worktree-batch-plan.schema.json`
- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/run-worktree.ps1`
- 修改：`.harness/scripts/tests/worktree-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

使用两节点临时 Git fixture 覆盖 batch plan 的确定路径/分支、未批准 create、脏主树、baseRef 漂移、路径/分支冲突、第二个 batch Worktree、符号链接逃逸、Git 创建后 status 写入中断恢复。

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\worktree-runtime.test.mjs
```

预期：新增 `batch-plan`、`batch-status`、`batch-create` 分支不存在。

- [ ] **步骤 3：实现受控 batch 分支**

在现有 `runWorktreeCommand` 内增加 batch command，而不修改 `plan/status/create` 单任务路径。batch plan 必须从已校验 ledger 派生 `branch`、`worktreePath`、DAG/base 哈希与证据目录；`batch-create` 同时要求显式用户批准记录和 `confirmCreate === true`。Git 仍使用 `execFile`、固定 argv、`shell: false`、30 秒超时。

- [ ] **步骤 4：运行 GREEN**

运行任务 4 测试。预期：创建与恢复只作用于临时仓库，一个 batch 只有一个 Worktree，任何不一致状态均不覆盖或删除资源。

- [ ] **步骤 5：审核本任务差异**

验收：单任务 M5-A 命令保持原路径、分支和回执语义；batch 路径没有接受调用方自定义 branch/path。

### 任务 5：实现累积 Worktree 的逐任务 Worker 执行

**文件：**

- 修改：`.harness/scripts/lib/worktree-worker-runtime.mjs`
- 修改：`.harness/scripts/lib/worker-runtime.mjs`
- 修改：`.harness/scripts/tests/worktree-worker-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worker-runtime.test.mjs`
- 修改：`.harness/scripts/tests/batch-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

覆盖：第一个任务完成后第二任务能读取继承文件；业务候选或 inherited rewrite 不匹配当前 `predictedFiles`、未声明的历史改动、前序哈希漂移、越权改写、重命名/删除、重复 Worker、provider 超时和 taskId 与 ledger 当前 claim 不一致均拒绝。

```js
test("second task accepts only the verified inherited snapshot", async () => {
  await executeAndIntegrateTask(fixture, "T1");
  const result = await runWorktreeWorker({ ...fixture, taskId: "T2", provider: editInheritedFile });
  assert.equal(result.outcome, "ready-for-integration");
  await writeFile(fixture.worktreeInheritedFile, "tampered\n");
  await assert.rejects(runWorktreeWorker({ ...fixture, taskId: "T2", provider: noOp }), /inherited.*hash/i);
});
```

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
```

预期：旧实现要求 Worktree 完全干净或拒绝多节点 DAG。

- [ ] **步骤 3：实现 batch Worker 分支**

只在 v1.1 task + batch ledger 存在时启用 batch 分支。`worker-runtime.mjs` 必须先按 v1.1 `taskRoot` 加载 task/result，验证 batch/task 身份与任务级输出，再复用既有策略、上下文、超时和原子写入边界；v1.0 仍要求 phase 根目录固定文件。开始时写入 `task-start-manifest.json`，其中包含 `inheritedFiles`、当前 Worktree 状态和主树基线哈希；所有业务候选和 inherited rewrite 必须复用 Task DAG 的 Windows 路径匹配函数。完成时仅收集本 task 声明或改写的候选并写入 task 专属 execution receipt。更新 ledger 只通过 `recordBatchWorkerReady`，Provider 异常和超时不产生结果或 ledger 转移。

- [ ] **步骤 4：运行 GREEN**

运行任务 5 测试。预期：第二任务可在可信累积状态上工作，非法改动不落盘为回执且无法选择后续 task。

- [ ] **步骤 5：审核本任务差异**

验收：Worker 无 Git、shell、网络和状态推进能力；只扩展 v1.1 分支，不移除 v1.0 “Worktree 干净”检查。

### 任务 6：实现逐任务集成与批次证据聚合

**文件：**

- 修改：`.harness/scripts/lib/worktree-integration-runtime.mjs`
- 修改：`.harness/scripts/run-worktree-integration.ps1`
- 修改：`.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 修改：`.harness/scripts/tests/batch-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

覆盖两个任务分别改写不同业务文件、两个任务依次改写同一业务文件、由前序 integration receipt 派生的主树 allowlist、当前主树基线检查、重复 apply 回执复用、第二任务未 claim/未 ready、第一任务集成后 phase 仍不变、主树或 Worktree 哈希漂移拒绝。

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
```

预期：旧实现因单节点 DAG、固定 phase `result.json` 或初始 base 哈希约束拒绝 fixture。

- [ ] **步骤 3：实现 batch 集成分支**

v1.1 路径使用 task-scoped `result.json` 与 execution receipt；主树 preflight 从前序 integration receipt 构造 immutable inherited allowlist，逐项验证哈希并拒绝其他业务改动。对每个当前任务候选文件读取主仓库当前 SHA-256 作为集成基线，原子写入主树后写 task 专属 integration receipt。成功后调用 `recordBatchIntegration`；不写 phase 根目录正式 `result.json`，不调用 M3 `apply`。

- [ ] **步骤 4：运行 GREEN**

运行任务 6 测试及任务 5 测试。预期：同一文件可被后续任务基于当前主树重新修改，任何漂移不会写部分集成回执或推进 ledger。

- [ ] **步骤 5：审核本任务差异**

验收：保留 M5-B2 单任务收集/集成路径，批次分支不允许任意 result 路径或跳过 receipt 校验。

### 任务 7：扩展 M5-C 的 batch 回收校验

**文件：**

- 新增：`.harness/schemas/worktree-batch-retirement-receipt.schema.json`
- 修改：`.harness/scripts/lib/worktree-runtime.mjs`
- 修改：`.harness/scripts/run-worktree.ps1`
- 修改：`.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`

- [ ] **步骤 1：编写失败测试**

为完整两任务 batch fixture 覆盖：目标 Story 非 `done/completed`、batch receipt 缺失/篡改、任一 task 回执或集成文件漂移、主树存在已验证但未提交的累计业务候选、主树存在未知业务改动、未知 Worktree 改动、锁存在、确认缺失、重复回收复用、Git remove 成功后 receipt 写入中断恢复。

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
```

预期：旧单任务 retirement 路径不能验证 batch plan/ledger/全部回执。

- [ ] **步骤 3：实现 batch retire 分支**

新增 `batch-retire` 命令，固定从 ledger 与 batch plan 派生路径。只有外部用户批准和 `confirmRetire === true` 同时满足时，才允许 `git worktree remove --force <derived-path>`；保留 branch，不执行 prune、reset、clean 或分支删除。batch 专用主树 preflight 仅允许并逐项验证全部 integration receipt 派生的累计 `appliedFiles`，任何其他未提交业务或 Harness 改动均拒绝。回收前验证所有任务和累计候选的哈希，回收后原子写 receipt，允许唯一的“Git 已成功、receipt 未写入”受约束恢复。

- [ ] **步骤 4：运行 GREEN**

运行任务 7 测试。预期：仅完整 batch 能被回收，正式 state/revision 和业务文件不被 retirement 改写。

- [ ] **步骤 5：审核本任务差异**

验收：旧 `retire` 仍只处理单任务 Worktree；`batch-retire` 没有接受任意路径或分支输入。

### 任务 8：完成两任务纵向 fixture 与全量 Harness 回归

**文件：**

- 新增：`.harness/scripts/tests/serial-batch-runtime.test.mjs`
- 修改：`.harness/scripts/smoke-harness-flow.ps1`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worktree-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worktree-worker-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`

- [ ] **步骤 1：编写失败纵向用例**

在临时 Git fixture 固定以下顺序：

```text
prepare-batch
-> batch-plan/status/create
-> claim T1 -> Worker T1 -> Integration T1
-> claim T2 -> Worker T2 -> Integration T2
-> finalize-batch -> M3 apply
-> Story done/completed -> batch-retire
```

断言 T1 集成后 revision/phase 不变，T2 失败不会 materialize phase result，finalize 后 `apply` 恰好一次推进，recovery 不重复集成或回收。

- [ ] **步骤 2：运行 RED**

运行：

```powershell
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
```

预期：新 fixture 和命令尚不存在。

- [ ] **步骤 3：实现最小 fixture 共用工具与 Smoke 分支**

共用工具只在测试文件内创建临时 Git 仓库、两个节点 DAG、mock provider 和固定时钟；不向生产 Runtime 注入测试开关。Smoke 只增加非破坏性的 batch 协议构造/校验路径，不创建正式仓库 Worktree。

- [ ] **步骤 4：运行 GREEN 与回归门禁**

运行：

```powershell
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
git diff --check
```

预期：所有适用 Harness 测试和结构/Smoke/差异门禁通过；无 backend/frontend 变更，因此不执行无关业务构建。

- [ ] **步骤 5：审核本任务差异**

验收：测试只操作临时目录，Smoke 不引入正式仓库 Git 写操作，失败证据能定位到 task、receipt 或 ledger。

### 任务 9：文档、结构登记与最终审核

**文件：**

- 新增：`docs/harness-m5b3-batch-runtime/REPORT.md`
- 修改：`.harness/README.md`
- 修改：`.harness/scripts/README.md`
- 修改：`.harness/structure-manifest.yaml`
- 修改：`docs/AI-handover.md`
- 修改：`docs/harness-architecture-adaptation.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`llm-knowledge/common/overview.md`
- 修改：`.harness/runs/M5-B3-B-001/phases/03-implementation/implementation-notes.md`
- 修改：`.harness/runs/M5-B3-B-001/phases/04-unit-test/test-report.md`
- 修改：`.harness/runs/M5-B3-B-001/phases/05-code-review/code-review-report.md`

- [ ] **步骤 1：编写失败结构测试或检查清单断言**

先登记新增 Runtime、Schema、测试与文档，运行结构校验确认它在未登记时失败；若结构校验对新增路径不形成强约束，则在 `harness-structure-checklist.md` 中增加可机械核对的条目，并将该限制记录进报告。

- [ ] **步骤 2：运行 RED**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
```

预期：新增受清单保护的路径未登记时失败，或明确记录现有结构校验覆盖边界。

- [ ] **步骤 3：更新中文文档和报告**

`REPORT.md` 必须记录需求覆盖、每项 RED/GREEN 证据、两任务真实 Git fixture、一次 phase 推进证据、继承快照、恢复与回收结果、全部命令、审核结论和延期边界。交接与架构文档必须说明 v1.0/v1.1 选择规则、不得并行的原因及正式 Worktree 操作仍需用户批准。

- [ ] **步骤 4：运行最终 GREEN 与任务级审核**

运行任务 8 的完整门禁，加上：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\select-tests.ps1
git status --short
git diff --check
```

预期：不存在影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`；低概率延期项只出现在 `REPORT.md`。

- [ ] **步骤 5：进入交付准备，不执行 Git 写操作**

汇总 M5-B3-B owned files、测试证据与 review 结论，推进 Harness 到 `git-delivery`。只在用户明确批准后，才执行 `git add`、`git commit`、`git push` 或任何正式 Worktree 操作。

## 需求覆盖自检

| 设计要求 | 对应任务 |
| --- | --- |
| v1.0/v1.1 兼容与任务独立产物 | 任务 1、3 |
| 串行 ledger、锁与失败关闭 | 任务 2 |
| batch Worktree 派生与批准门禁 | 任务 4 |
| 继承快照、Worker 权限和恢复 | 任务 5 |
| 当前主树基线、逐任务集成 | 任务 6 |
| Story 完成后的 batch 回收 | 任务 7 |
| 两任务临时 Git 闭环与一次 phase 推进 | 任务 8 |
| 文档、结构、最终审核与延期项 | 任务 9 |

完整性扫描范围为本文件和 `DESIGN.md`；没有未决架构选择。实施期间如发现当前契约无法满足上述不变量，停止在当前任务并请求用户确认，不以兼容性猜测替代证据。
