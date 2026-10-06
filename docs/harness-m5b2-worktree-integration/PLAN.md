# Harness M5-B2 单 Worktree 业务变更受控集成实施计划

> **执行要求：** 实施时必须使用 `superpowers:executing-plans`，严格按本文 checkbox 逐项执行；每个 TDD 任务完成 RED、GREEN、重构、针对性回归和范围审核后，才能开始下一任务。

**目标：** 将 M5-B1 的单 Worktree `ready-for-integration` 结果以内容寻址 bundle 安全集成到主工作树，并在全部业务文件和阶段产物完成后最后生成 M3 正式 `result.json`。

**架构：** 新增独立 `worktree-integration-runtime.mjs`，组合现有 M3、M5-A 和 M5-B1 的持久化契约，不修改它们的公开 Schema 或状态推进职责。Runtime 提供 `plan/status/apply`，通过 SHA-256 前置条件、任务级锁、逐文件原子写入和事实重建支持失败关闭与显式恢复；PowerShell 仅作为参数转发入口。

**技术栈：** Node.js ESM 标准库、`node:test`、PowerShell、Git 固定参数调用、JSON Schema Draft 2020-12。

---

## 1. 范围、成功标准与文件责任

### 1.1 本 Story 固定边界

- Story 固定为 `M5-B2-001`，只处理一个已创建 Worktree、一个 DAG task 和一个 M3 dispatch。
- 只接受 M5-B1 `outcome === "ready-for-integration"` 的执行凭据，且必须至少包含一个 `backend` 或 `frontend` 候选文件。
- `plan/status/apply` 均不得调用 M2/M3 状态命令，不得改变 Harness `phase`、`revision` 或 checkpoint 状态。
- `apply` 只在外部流程已获得用户明确批准且调用参数 `confirmApply === true` 时执行；Runtime 不伪造、持久化或推断用户批准。
- 测试中的真实文件集成只发生在临时 Git 仓库；FrontierScan 正式 `backend/src/**`、`frontend/src/**` 不作为测试写入目标。
- 不实现删除、重命名、自动回滚、多文件全局事务、Worktree merge/remove、真实 Agent、多任务聚合、多 Worktree、Git 交付、发布或部署。

### 1.2 验收成功标准

- 相同证据重复 `Plan` 返回 `reused`；任一绑定证据漂移时拒绝覆盖旧 plan。
- 未确认 `Apply`、主仓库 HEAD 漂移、未解释业务修改、目标哈希冲突、符号链接或 bundle 篡改均在写目标文件前失败。
- 已有文件更新以 Git 相对固定 `baseCommit` 的逻辑差异作为前置条件，新文件创建以 `baseSha256 === null` 且目标不存在作为前置条件。
- 写入顺序固定为业务文件、phase output、正式 `result.json`、integration receipt；正式 result 出现前所有前置候选均已完成。
- 中断后 `Status` 从文件系统和 Git 事实恢复每个文件的 `pending/applied` 状态；重复 `Apply` 不重复产生不同内容。
- M5-B2 完成前后 Harness revision 不变；调用方显式执行 M3 `apply` 后只推进一次。
- M2-M5 回归、结构、Smoke、知识新鲜度和差异门禁通过，最终 Review 无未解决 `BLOCKER/WARNING`。

### 1.3 文件责任表

| 文件 | 动作 | 单一责任 |
| --- | --- | --- |
| `.harness/scripts/lib/worktree-integration-runtime.mjs` | 新增 | `plan/status/apply` 契约、证据绑定、bundle、哈希状态、锁和原子写入 |
| `.harness/scripts/run-worktree-integration.ps1` | 新增 | PowerShell 参数校验与 Node Runtime 薄转发 |
| `.harness/scripts/tests/worktree-integration-runtime.test.mjs` | 新增 | 临时 Git 仓库中的契约、门禁、恢复和 M3 纵向测试 |
| `.harness/schemas/worktree-integration-plan.schema.json` | 新增 | integration plan `1.0` 结构契约 |
| `.harness/schemas/worktree-integration-status.schema.json` | 新增 | integration status `1.0` 结构契约 |
| `.harness/schemas/worktree-integration-receipt.schema.json` | 新增 | integration receipt `1.0` 结构契约 |
| `.harness/scripts/validate-structure.ps1` | 修改 | 登记三个 Schema、Runtime、入口、测试和 M5-B2 文档 |
| `.harness/structure-manifest.yaml` | 修改 | 登记 M5-B2 目录、Schema、Runtime、入口、测试和三份文档 |
| `.harness/scripts/README.md` | 修改 | 说明 M5-B2 命令、批准边界和 M3 handoff |
| `docs/harness-structure-checklist.md` | 修改 | 登记 M5-B2 已实现资产与延期边界 |
| `docs/harness-architecture-adaptation.md` | 修改 | 更新 M5-B2 职责和 M2/M3/M5 边界 |
| `docs/AI-handover.md` | 修改 | 记录运行方式、恢复方式、限制和下一阶段 |
| `llm-knowledge/overview.md` | 修改 | 仅在实现导致 Common 范围确实变化且 freshness 要求刷新时更新 |
| `docs/harness-m5b2-worktree-integration/REPORT.md` | 新增 | 汇总 TDD 证据、验收、Review 与延期风险 |

不得修改 `dispatch-task.schema.json`、`dispatch-result.schema.json`、`story-runtime.mjs`、`worker-runtime.mjs`、`worktree-runtime.mjs` 或 `worktree-worker-runtime.mjs`，除非 RED 测试证明现有公开契约存在完成 M5-B2 所必需的缺口；发生这种情况时停止当前任务，先更新设计并与用户确认。

## 2. 固定接口与 Schema 契约

### 2.1 Node 与 PowerShell 接口

```js
export async function runWorktreeIntegration({
  root,
  command,       // "plan" | "status" | "apply"
  stateFile,
  taskId,
  taskFile,
  confirmApply = false,
  now,
  testHooks,
})
```

- `now` 和 `testHooks` 只用于确定性测试；PowerShell 不暴露这两个参数。
- `testHooks` 只允许模拟原子 rename 后、status 更新前，以及正式 result 后、receipt 前的中断，不得形成生产 CLI 能力。
- Runtime 自行从 state 的 `runId` 推导 M5-A、M5-B1 和 integration 路径，不接受任意 receipt、bundle、Worktree、目标路径或 Git ref。

```powershell
.\.harness\scripts\run-worktree-integration.ps1 `
  -Command Plan|Status|Apply `
  -StateFile .harness/states/e2e-M5-B2-001.json `
  -TaskId T1 `
  -TaskFile .harness/runs/M5-B2-001/phases/03-implementation/task.json `
  [-ConfirmApply] `
  [-Json]
```

### 2.2 固定产物路径

```text
.harness/runs/<runId>/worktrees/<taskId>/integration/
  plan.json
  status.json
  bundle/sha256-<64 lowercase hex>.blob
  integration-receipt.json
  integrate.lock
```

正式 result 始终为 `dirname(taskFile)/result.json`，不得由调用方覆盖。

### 2.3 `plan.json` 字段

顶层字段固定为：

```json
{
  "schemaVersion": "1.0",
  "storyId": "M5-B2-FIXTURE",
  "runId": "M5-B2-FIXTURE",
  "taskId": "T1",
  "dispatchId": "11111111-1111-4111-8111-111111111111",
  "phase": "implementation",
  "ownerAgent": "backend-developer",
  "stateFile": ".harness/states/e2e-fixture.json",
  "preparedRevision": 4,
  "baseCommit": "0000000000000000000000000000000000000000",
  "worktreePath": ".harness/worktrees/M5-B2-FIXTURE/T1",
  "taskDagFile": ".harness/runs/M5-B2-FIXTURE/phases/02-task-dag/task-dag.json",
  "taskDagSha256": "sha256:8888888888888888888888888888888888888888888888888888888888888888",
  "taskFile": ".harness/runs/M5-B2-FIXTURE/phases/03-implementation/task.json",
  "taskSha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "checkpointFile": ".harness/runs/M5-B2-FIXTURE/phases/03-implementation/checkpoint.json",
  "checkpointSha256": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "worktreePlanFile": ".harness/runs/M5-B2-FIXTURE/worktrees/T1/plan.json",
  "worktreePlanSha256": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "inputManifestFile": ".harness/runs/M5-B2-FIXTURE/worktrees/T1/input-manifest.json",
  "inputManifestSha256": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  "executionReceiptFile": ".harness/runs/M5-B2-FIXTURE/worktrees/T1/execution-receipt.json",
  "executionReceiptSha256": "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  "workerResultEvidenceFile": ".harness/runs/M5-B2-FIXTURE/worktrees/T1/worker-result.json",
  "workerResultSha256": "sha256:5555555555555555555555555555555555555555555555555555555555555555",
  "resultFile": ".harness/runs/M5-B2-FIXTURE/phases/03-implementation/result.json",
  "artifacts": [],
  "plannedAt": "2026-07-21T00:00:00.000Z"
}
```

`artifacts` 每项字段固定为：

```json
{
  "path": "backend/src/main/ExistingService.java",
  "kind": "backend",
  "baseSha256": "sha256:6666666666666666666666666666666666666666666666666666666666666666",
  "candidateSha256": "sha256:7777777777777777777777777777777777777777777777777777777777777777",
  "bytes": 31,
  "bundlePath": ".harness/runs/M5-B2-FIXTURE/worktrees/T1/integration/bundle/sha256-7777777777777777777777777777777777777777777777777777777777777777.blob"
}
```

- `kind` 只能为 `backend`、`frontend`、`phase-output`、`result`。
- `baseSha256` 仅业务文件可为固定 base 内容哈希或 `null`；`phase-output` 和 `result` 必须为 `null`。
- `artifacts` 必须恰好包含一个 `result`，至少一个 `backend|frontend`，并按 `kind` 写入优先级和规范化路径排序。
- 所有 Schema 使用 `additionalProperties: false`；单 artifact 最大 `2097152` bytes，bundle 总计最大 `8388608` bytes。
- `stateFile`、`preparedRevision` 和 task/checkpoint/DAG 哈希共同绑定 Plan 时的 M3 prepared 事实；M5-B2 不修改这些事实。

### 2.4 `status.json` 与 receipt 字段

`status.json` 顶层字段：`schemaVersion`、Story/run/task/dispatch 身份、`planSha256`、`state`、`artifacts`、`observedAt`、`details`。`state` 只能为 `planned`、`applying`、`ready-for-apply`、`inconsistent`；每个 artifact 记录 `path`、`kind`、`state`（`pending|applied|inconsistent`）、`currentSha256`（string 或 `null`）。存在 pending 且未持锁写入时为 `planned`，Apply 持锁并开始写入后为 `applying`，全部 artifact 和 receipt 通过核验后才为 `ready-for-apply`。

`integration-receipt.json` 顶层字段：`schemaVersion`、Story/run/task/dispatch/phase/owner 身份、`baseCommit`、`planSha256`、`resultFile`、`resultSha256`、`appliedFiles`、`completedAt`。`appliedFiles` 只记录业务文件和 phase output 的 `path`、`kind`、`sha256`、`bytes`；正式 result 使用独立字段记录。

## 3. 任务 1：初始化 Story 并保存需求与单任务 DAG

**文件：**

- 新增：`.harness/states/e2e-M5-B2-001.json`
- 新增：`.harness/states/e2e-M5-B2-001.events.jsonl`
- 更新：`.harness/states/active-run.json`
- 新增：`.harness/runs/M5-B2-001/phases/00-requirement/requirement-breakdown.md`
- 新增：`.harness/runs/M5-B2-001/phases/01-technical-design/technical-design.md`
- 新增：`.harness/runs/M5-B2-001/phases/02-task-dag/task-dag.json`

- [x] **步骤 1：初始化 M5-B2 单 Story**

运行：

```powershell
.\.harness\scripts\run-state.ps1 -Command init -StoryId M5-B2-001 -Summary "M5-B1 单 Worktree 业务候选受控集成到主工作树，并显式交接 M3 apply"
```

预期：创建 revision 1 的 active Story，不覆盖已完成的 `M5-B1-001`。

- [x] **步骤 2：保存 requirement 产物并推进到 technical-design**

requirement 文档必须逐条记录第 1.2 节验收标准、双重批准边界、正式仓库禁止真实 Apply 和延期范围。通过 M3 `prepare` 生成 task 后，由受约束文档 provider 或人工写入 phase output/result，再显式 `apply`；不得手工改 state。

验证：

```powershell
.\.harness\scripts\run-state.ps1 -Command validate -StateFile .harness/states/e2e-M5-B2-001.json
```

预期：状态有效，requirement evidence 已绑定，phase 只推进一次。

- [x] **步骤 3：保存已确认设计并推进到 task-dag**

将 `docs/harness-m5b2-worktree-integration/DESIGN.md` 的已确认结论作为 technical-design 内容来源；phase 产物必须指向该设计且不得扩展已排除范围。

- [x] **步骤 4：创建单节点 DAG 并验证**

DAG 只包含 `T1`：

```json
{
  "taskId": "T1",
  "title": "实现单 Worktree 业务变更受控集成闭环",
  "type": "integration",
  "status": "pending",
  "predictedFiles": [
    ".harness/scripts/lib/worktree-integration-runtime.mjs",
    ".harness/scripts/run-worktree-integration.ps1",
    ".harness/scripts/tests/worktree-integration-runtime.test.mjs",
    ".harness/schemas/worktree-integration-plan.schema.json",
    ".harness/schemas/worktree-integration-status.schema.json",
    ".harness/schemas/worktree-integration-receipt.schema.json",
    ".harness/scripts/validate-structure.ps1",
    ".harness/scripts/README.md",
    "docs/harness-m5b2-worktree-integration/**",
    "docs/harness-structure-checklist.md",
    "docs/harness-architecture-adaptation.md",
    "docs/AI-handover.md",
    "llm-knowledge/overview.md"
  ],
  "acceptanceCriteria": [
    "ready-for-integration 候选可在批准后安全写入并最后生成正式 result",
    "失败和中断可通过哈希事实关闭或恢复且不推进 M2/M3 状态"
  ],
  "ownerAgent": "backend-developer"
}
```

运行：

```powershell
.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .harness/runs/M5-B2-001/phases/02-task-dag/task-dag.json
```

预期：`PASS`，wave 为 `[["T1"]]`，无 global change。

- [x] **步骤 5：推进到 implementation 并做范围审核**

验证状态 phase 为 `implementation`，revision 与新生成的 M3 task 绑定；检查 `git status --short --untracked-files=all`，确认此时没有业务源码修改。

## 4. 任务 2：Plan 契约与内容寻址 bundle

**文件：**

- 新增：`.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 新增：`.harness/scripts/lib/worktree-integration-runtime.mjs`
- 新增：`.harness/schemas/worktree-integration-plan.schema.json`

- [x] **步骤 1：编写 Plan RED 测试**

临时 fixture 复用 M5-B1 测试的真实 Git 初始化模式，串联 `runWorktreeCommand` 和 `runWorktreeWorker` 生成权威 M5-A/M5-B1 证据。`createFixture()` 固定返回 `{ root, stateFile, taskId, taskFile, input, integrationPlanFile }`，其中 `input` 是 `runWorktreeIntegration` 的完整 `plan` 入参。测试名称和关键断言固定为：

```js
test("plan rejects non-integration worker outcomes before writing a bundle", async () => {
  await assert.rejects(runWorktreeIntegration(input), /ready-for-integration/i);
  await assert.rejects(access(integrationPlanFile));
});

test("plan rejects non-completed or identity-drifted worker results", async () => {
  await assert.rejects(runWorktreeIntegration(input), /completed|identity/i);
});

test("plan rejects receipts without backend or frontend candidates", async () => {
  await assert.rejects(runWorktreeIntegration(input), /business candidate/i);
});

test("plan rejects receipt manifest result and candidate hash drift", async () => {
  await assert.rejects(runWorktreeIntegration(input), /hash/i);
});

test("plan rejects an existing formal result or phase output", async () => {
  await assert.rejects(runWorktreeIntegration(input), /already exists/i);
});

test("plan writes a stable content-addressed bundle and reuses identical evidence", async () => {
  const first = await runWorktreeIntegration(input);
  const second = await runWorktreeIntegration(input);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.deepEqual(second.plan, first.plan);
});
```

- [x] **步骤 2：运行 RED**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
```

预期：因 `worktree-integration-runtime.mjs` 或 `runWorktreeIntegration` 尚不存在而失败；现有 M5-B1 测试保持通过。

- [x] **步骤 3：实现最小 Plan**

Runtime 只使用 Node 标准库，复用现有 `runWorktreeCommand({ command: "status" })`、`loadTaskDag` 和 `validateDispatchResultStructure`。最小执行顺序固定为：

```text
规范化 root/stateFile/taskFile/taskId
  -> 读取 active state、task、checkpoint 和 M5-A plan 绑定的 DAG
  -> 读取 M5-B1 receipt/manifest/worker-result
  -> 在刷新 status 前校验 receipt 内的 M5-A plan/status 历史 SHA-256
  -> 调用 M5-A status 重新核验当前 Git 事实，但不把可变 status 文件哈希作为 plan 不变量
  -> 校验单 pending DAG task 与 owner
  -> 校验身份、outcome、completed result 和其余全部 SHA-256
  -> git rev-parse HEAD 等于 baseCommit
  -> git show baseCommit:path 获取业务 base 或确认不存在
  -> 全量校验路径、UTF-8、2/8 MiB 和正式目标不存在
  -> 原子写缺失 blob
  -> 最后原子写 plan.json
```

内容寻址 blob 路径必须由实际 bytes 的 SHA-256 推导；已存在同名 blob 时先重算哈希，匹配则复用，不匹配则失败，不覆盖。所有 Git 读取使用 `execFile("git", args)` 参数数组、`shell: false`、30 秒超时和 4 MiB stdout/stderr 上限；超时、非预期退出码或输出超限均失败关闭。

- [x] **步骤 4：实现 plan Schema 并在 Runtime 中执行同构校验**

Schema 使用第 2.3 节字段、`required` 全量列举、枚举、长度/哈希/大小限制和 `additionalProperties: false`。Runtime 不引入 Ajv，沿用项目现有“JSON Schema 作为结构资产 + 标准库运行时显式校验”的模式。

- [x] **步骤 5：运行 GREEN 与回归**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
```

预期：全部通过；非法 Plan 场景不留下 `plan.json`，且不会写主工作树业务文件、phase output 或正式 result。

- [x] **步骤 6：重构与范围审核**

只抽取被 `plan/status/apply` 至少两个路径复用的路径、哈希、JSON 和原子写入 helper；不创建插件式 store、provider 或通用事务框架。运行 `git diff --check` 并确认未修改 M3/M4-B/M5-A/M5-B1 核心文件。

## 5. 任务 3：Status、证据前置条件和批准门禁

**文件：**

- 修改：`.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 修改：`.harness/scripts/lib/worktree-integration-runtime.mjs`
- 新增：`.harness/schemas/worktree-integration-status.schema.json`

- [x] **步骤 1：编写 Status/Apply 门禁 RED 测试**

```js
test("apply requires explicit confirmation before acquiring the integration lock", async () => {
  await assert.rejects(runWorktreeIntegration({ ...input, command: "apply" }), /confirm/i);
  assert.equal(await readBusinessFile(), baseContent);
});

test("status rejects main HEAD drift and unexplained business changes", async () => {
  await assert.rejects(runWorktreeIntegration({ ...input, command: "status" }), /HEAD|unexplained/i);
});

test("status marks target content outside base and candidate hashes inconsistent", async () => {
  const value = await runWorktreeIntegration({ ...input, command: "status" });
  assert.equal(value.status.state, "inconsistent");
});

test("apply rejects target symlinks bundle tampering and a legacy lock before writes", async () => {
  await assert.rejects(runWorktreeIntegration({ ...input, command: "apply", confirmApply: true }), /symlink|bundle|lock/i);
});
```

另加断言：task/checkpoint/M5-A plan/status/M5-B1 receipt/manifest/worker result 任一哈希变化均失败；`status` 不要求 Worktree 在 Plan 后继续存在。

- [x] **步骤 2：运行 RED**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
```

预期：新增门禁测试失败，但任务 2 的 Plan 测试继续通过。

- [x] **步骤 3：实现事实型 Status**

Status 每次重新读取并校验 plan、bundle、state、task、checkpoint、M5-A/M5-B1 固化证据和主仓库 HEAD。每个 artifact 分类规则固定为：

```text
current == candidate                                      -> applied
baseSha256 != null && git diff baseCommit path is clean   -> pending
baseSha256 == null && target does not exist               -> pending
otherwise                                                 -> inconsistent
```

业务区 Git 差异通过固定参数 `git status --porcelain=v1 -z --untracked-files=all -- backend/src frontend/src` 获取。只允许 plan 中业务 artifact 路径出现；已有文件再通过 `git diff --quiet --no-ext-diff <baseCommit> -- <path>` 判断是否仍为逻辑 base，从而兼容 Git checkout filter，candidate 仍使用 SHA-256 精确匹配。任何额外路径、删除/重命名、解析失败或输出超限均失败关闭。

- [x] **步骤 4：实现路径和锁门禁**

复用 M5-A/M5-B1 的 Windows 大小写不敏感路径规则：拒绝绝对路径、`..`、反斜杠混用、大小写等价重复、父子冲突和从 root 到目标任一级符号链接。`apply` 先验证 `confirmApply === true`，再以 `open(..., "wx")` 获取 `integrate.lock`；已存在锁直接报错且不自动清理。

- [x] **步骤 5：实现 status Schema 与原子状态写入**

`status.json` 仅缓存最近观察结果，决策前必须重建。写入使用同目录随机临时文件加 rename；失败时尽力删除本次临时文件，不删除历史锁或用户文件。

- [x] **步骤 6：运行 GREEN 与范围审核**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
```

预期：全部通过；所有门禁失败场景的主工作树目标 bytes、正式 result 和 Harness revision 保持不变。

## 6. 任务 4：Apply 原子写入、逐文件恢复与最终 receipt

**文件：**

- 修改：`.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 修改：`.harness/scripts/lib/worktree-integration-runtime.mjs`
- 新增：`.harness/schemas/worktree-integration-receipt.schema.json`

- [x] **步骤 1：编写 Apply/恢复 RED 测试**

```js
test("apply updates an existing business file creates a new file and writes result last", async () => {
  const value = await runWorktreeIntegration({ ...input, command: "apply", confirmApply: true });
  assert.equal(value.status.state, "ready-for-apply");
  assert.deepEqual(observedWriteKinds, ["backend", "frontend", "phase-output", "result", "receipt"]);
});

test("apply resumes after an artifact rename before status persistence", async () => {
  await assert.rejects(firstApply, /injected interruption/i);
  const recovered = await secondApply();
  assert.equal(recovered.status.state, "ready-for-apply");
});

test("apply resumes after result write before receipt write", async () => {
  await assert.rejects(firstApply, /injected interruption/i);
  const recovered = await secondApply();
  assert.equal(recovered.reused, false);
  assert.equal(await receiptExists(), true);
});

test("repeated apply reuses a matching receipt and rejects later drift", async () => {
  assert.equal((await secondApply()).reused, true);
  await mutateAppliedTarget();
  await assert.rejects(secondApply(), /hash|inconsistent/i);
});
```

测试同时断言：业务文件全部完成前无 phase output；业务文件和 phase output 全部完成前无正式 result；receipt 永远最后出现。

- [x] **步骤 2：运行 RED**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
```

预期：Apply 成功和恢复测试失败；Plan 与 Status 测试保持通过。

- [x] **步骤 3：实现确定性 Apply**

持锁后重新执行完整 Status 和未解释 Git 差异检查，按以下组顺序写入，每组内按规范化路径排序：

```text
backend/frontend -> phase-output -> result -> integration-receipt
```

每个 artifact 只允许两种动作：`pending` 时从已验证 bundle 原子写入；`applied` 时跳过。写入前后均计算 SHA-256，rename 后立即原子刷新 `status.json`。任何 `inconsistent` artifact 都停止，不覆盖、不 reset、不回滚已正确应用文件。

- [x] **步骤 4：实现 result-last 与 receipt 幂等**

正式 result 直接复制已验证的 result blob，不修改 M3 Schema `1.0`。只有全部业务和 phase output 为 `applied` 后才能写 result；只有 result 哈希正确后才能写 receipt。匹配 receipt 存在时重新核验 plan 和所有目标哈希后返回 `{ reused: true, outcome: "ready-for-apply" }`；receipt 不匹配时失败关闭。

- [x] **步骤 5：实现测试中断钩子且保持生产接口封闭**

`testHooks` 只在内部函数参数存在时调用：

```js
await testHooks?.afterArtifactRename?.({ path: artifact.path, kind: artifact.kind });
await testHooks?.beforeReceiptWrite?.();
```

PowerShell 入口不得解析或暴露 test hook。Runtime 的 `finally` 只释放本进程成功获取的锁并清理本次临时文件；预先存在的遗留锁不删除。

- [x] **步骤 6：运行 GREEN、恢复回归和范围审核**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：全部通过；每个恢复测试只产生最终候选内容，无重复 receipt，state 文件 bytes 在 M3 apply 前不变。

## 7. 任务 5：PowerShell 入口与 M3 纵向闭环

**文件：**

- 新增：`.harness/scripts/run-worktree-integration.ps1`
- 修改：`.harness/scripts/tests/worktree-integration-runtime.test.mjs`

- [x] **步骤 1：编写 CLI 和纵向 RED 测试**

覆盖：`Plan/Status/Apply` 大小写映射、缺失必填参数、`ConfirmApply` 只对 Apply 生效、`-Json` 输出可解析；入口不得接受自定义 Worktree、receipt、bundle、result 或目标路径。

纵向 fixture 必须真实执行：

```text
M3 prepare
  -> M5-A plan/create
  -> M5-B1 mock Worker 写入业务候选
  -> M5-B2 plan/status/apply
  -> M3 apply
```

关键断言：

```js
assert.equal(stateBeforeIntegration.runtime.revision, stateAfterIntegration.runtime.revision);
assert.equal(integration.status.state, "ready-for-apply");
assert.equal((await runStoryCommand({ command: "apply", ...args })).status, "completed");
assert.equal((await readCheckpoint()).status, "completed");
```

M3 `already-applied` 只用于“状态已推进但 checkpoint 尚未完成”的中断窗口；正常完成后的第二次 apply 不属于该契约，因此本闭环只显式调用一次 M3 apply，并保留 M3 原有中断恢复回归。

- [x] **步骤 2：运行 RED**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
```

预期：CLI 和纵向测试因入口尚未实现或链路未完成而失败。

- [x] **步骤 3：实现 PowerShell 薄入口**

入口沿用 `run-worktree.ps1` 风格：`ValidateSet("Plan", "Status", "Apply")`，固定构造 Node 参数数组，`ConfirmApply` 映射为 `--confirm-apply`，`Json` 映射为 `--json`，不使用 `Invoke-Expression` 或拼接 shell 命令。

- [x] **步骤 4：完成纵向 GREEN**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
```

预期：全部通过；临时 fixture 清理自身 Worktree 和临时根目录，正式 FrontierScan 仓库没有新增 Worktree 或业务源码修改。

- [x] **步骤 5：完成任务级实现记录并推进到 unit-test**

生成 implementation notes，列出 owned files、未修改核心契约、恢复策略和明确排除项。通过 M3 result/apply 推进，禁止手工修改 state。

## 8. 任务 6：文档、完整回归、Review 与报告

**文件：**

- 修改：`.harness/scripts/validate-structure.ps1`
- 修改：`.harness/scripts/README.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`docs/harness-architecture-adaptation.md`
- 修改：`docs/AI-handover.md`
- 按 freshness 结果决定是否修改：`llm-knowledge/overview.md`
- 新增：`docs/harness-m5b2-worktree-integration/REPORT.md`
- 新增：`.harness/runs/M5-B2-001/phases/04-unit-test/test-report.md`
- 新增：`.harness/runs/M5-B2-001/phases/05-code-review/code-review-report.md`
- 新增：后续 phase 的构建、接口验证和交付说明产物

- [x] **步骤 1：先登记结构资产并运行针对性结构 RED**

先在结构测试/清单中声明三个 Schema、Runtime、PowerShell 入口、测试和 M5-B2 三份文档，再运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
```

若 `REPORT.md` 尚未生成，预期结构检查失败并明确指出缺失文件；随后生成报告骨架和当前已取得证据，使检查转绿。报告不得预先声称未运行的门禁通过。

- [x] **步骤 2：更新项目文档**

所有文档统一说明：M5-B2 只做批准后的内容寻址文件集成；M3 apply 仍由调用方显式执行；不实现 Git merge/remove、自动交付、多任务或多 Worktree。交接文档给出 Plan/Status/Apply 命令、故障恢复路径和遗留锁人工检查要求。

- [x] **步骤 3：运行完整回归**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .harness/states/e2e-M5-B2-001.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .harness/runs/M5-B2-001/phases/02-task-dag/task-dag.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\select-tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
git diff --check
```

预期：全部通过；`select-tests.ps1` 明确 Harness-only，backend/frontend owned diff 为空，因此不运行无关业务构建。

- [x] **步骤 4：检查正式仓库 Git/Worktree 边界**

```powershell
git status --short --untracked-files=all
git diff -- backend/src frontend/src
git worktree list --porcelain
```

预期：没有 M5-B2 引入的业务源码差异；没有测试遗留的正式仓库 Worktree；只报告本 Story owned diff 和已有无关修改。

- [x] **步骤 5：执行 M5-B2 owned diff Review**

Review 只检查本 Story 差异，重点审查：路径穿越/大小写/符号链接、base 与 candidate 哈希前置条件、未解释 Git 差异、批准门禁、result-last、receipt 幂等、锁释放、测试是否真正使用临时 Git 仓库，以及文档是否越过 M5-B2 范围。

发现影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING` 时回到对应 TDD 任务：先补复现测试，再最小修复，重跑受影响测试和完整 Review。极低概率断电 fsync、恶意同进程调用方、跨平台 Git 差异和未知临时文件自动清扫只记录到报告，不阻塞。

- [x] **步骤 6：完成 REPORT 并推进剩余 Harness phase**

`REPORT.md` 必须记录：需求覆盖、RED/GREEN 命令和结果、Schema/权限/路径矩阵、真实临时 Git fixture、恢复测试、最终门禁、最终 Review、延期边界和未执行的外部操作。后续 build-publish 使用 `no-build-required` 证据，interface-verification 记录 Harness 临时 fixture 验收；到达 `git-delivery` 后停止。

- [x] **步骤 7：完成独立 Git 交付**

用户随后明确批准 Git 提交和推送：业务 Runtime 以 `d557e540d78033a317601de8edc516f859fdcd83` 提交，运行资产忽略规则以 `9e380e9eb2a6bbb7124258c426ea2678c28d68e6` 提交，均已推送至 `origin/dev`；Story 已在 revision 29 标记为 `done/completed`。未执行 PR、分支合并/删除、Worktree 删除、发布或部署。

## 9. 实施停机条件

出现以下任一情况立即停止当前 TDD 任务，保留失败证据并与用户确认，不自行扩大设计：

- 完成 M5-B2 必须修改 M3 dispatch Schema `1.0` 或 M2/E2E state Schema。
- M5-B1 receipt 无法稳定还原候选文件集合，必须引入新的 Worker capability 或重新执行 Provider。
- 内容寻址 bundle 无法在不执行 Git 写操作的前提下建立可信 base/candidate 前置条件。
- 单任务约束不足以完成已确认验收，必须引入 task-level dispatch、多任务聚合或多 Worktree。
- 正式 FrontierScan 仓库必须执行真实 Apply、创建/删除 Worktree 或修改业务源码才能让测试通过。

## 10. 计划完成后的执行方式

本计划确认后采用当前会话内串行执行：使用 `superpowers:executing-plans`，从任务 1 开始逐项更新 checkbox 和 Harness 状态。由于任务共享同一 Runtime、测试 fixture 和状态资产，不并行实现，也不派发子 Agent。
