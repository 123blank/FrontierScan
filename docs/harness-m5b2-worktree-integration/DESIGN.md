# Harness M5-B2 单 Worktree 业务变更受控集成设计

## 1. 背景与目标

M5-B1 已能在 M5-A 创建的单 Worktree 中执行受约束 Worker，并将包含业务代码的结果保存为
`ready-for-integration` receipt。当前缺口是这些业务候选文件不能安全进入主工作树，M3 也不能在业务代码尚未集成时接收正式
`result.json`。

M5-B2 创建单 Story `M5-B2-001`，建立以下闭环：

```text
M5-B1 ready-for-integration receipt
  -> M5-B2 Plan
  -> M5-B2 Status
  -> 用户批准 + ConfirmApply
  -> M5-B2 Apply
  -> ready-for-apply
  -> 调用方显式执行 M3 apply
```

M5-B2 只负责单 Worktree、单任务、单 dispatch 的业务文件集成。它不调用 M3 `apply`，不提交 Git，不合并或删除
Worktree，也不进入多任务或多 Worktree 编排。

## 2. 已确认决策

- 使用内容寻址集成包，不使用 `git apply`、自动 commit 或 cherry-pick。
- 同时提供内部 Node Runtime 和 `Plan/Status/Apply` PowerShell 薄入口。
- `Apply` 同时要求外部用户明确批准和 `-ConfirmApply`。
- 开发与验收期间只在临时 Git 仓库执行真实 Apply，不修改 FrontierScan 正式业务源码。
- 主工作树 HEAD 必须保持为 M5-A 固定的 `baseCommit`。
- 业务文件与 phase output 完成后才写正式 `result.json`，M3 状态仍由调用方显式推进。
- 多文件不提供全局事务或自动回滚；采用逐文件哈希状态和幂等恢复。

## 3. 方案比较

### 3.1 内容寻址集成包（采用）

`Plan` 将候选文件复制为按 SHA-256 命名的 blob，并保存 base/候选哈希。`Apply` 只消费已固化的 bundle，避免
Worktree 在计划后发生变化。该方案可复用 M5-B1 receipt 和现有原子写入模式，修改范围最小，恢复语义明确。

### 3.2 统一 diff 与 `git apply`（不采用）

Git 可提供 patch 检查，但仍需单独处理 phase output、正式 result、批准记录和中断恢复；同时增加 patch 路径和
hunk 语义，超出当前最小需求。

### 3.3 Worktree commit 与 cherry-pick（不采用）

该方案会提前引入自动提交、合并、冲突处理和 Git 历史管理，越过 M5-B2 的批准与职责边界。

## 4. 范围

### 4.1 本次实现

- 消费 M5-B1 `ready-for-integration` receipt、input manifest、Worker result 和 M5-A plan/status。
- 校验 active state、M3 prepared task/checkpoint、单任务 DAG、owner、dispatch 和 base commit。
- 固化业务候选、phase output 和 Worker result 的内容寻址 bundle。
- 检查主工作树 HEAD、业务区、目标文件、符号链接和哈希前置条件。
- 在双重批准后原子写入业务文件和 phase output，最后写正式 `result.json`。
- 保存 plan、status 和 integration receipt，支持重复 Plan/Status/Apply 与逐文件恢复。
- 提供内部 Node 接口和 PowerShell 薄入口。

### 4.2 明确排除

- 多任务聚合、多 Worktree 波次、Fork-Join 和并发 Apply。
- 删除或重命名业务文件；M4-B/M5-B1 当前同样拒绝这两类修改。
- 自动回滚、多文件全局事务和断电级 fsync。
- Worktree merge/remove/cleanup、Git add/commit/push、PR、发布和部署。
- 真实 Codex Agent、Plugin、网络或任意 shell 能力。
- 自动调用 M3 `apply` 或直接修改 M2/M3 state。

## 5. 内部接口与 PowerShell 入口

内部接口：

```js
runWorktreeIntegration({
  root,
  command,       // plan | status | apply
  stateFile,
  taskId,
  taskFile,
  confirmApply = false,
})
```

PowerShell 入口：

```powershell
.\.harness\scripts\run-worktree-integration.ps1 `
  -Command Plan|Status|Apply `
  -StateFile <state-file> `
  -TaskId <task-id> `
  -TaskFile <M3-task.json> `
  [-ConfirmApply] `
  [-Json]
```

入口不接受任意 receipt、Worktree、bundle、目标路径或 Git ref。所有路径必须从当前 state、M5-A plan 和固定目录推导。
`ConfirmApply` 仅对 `Apply` 有效，不能代替对话或外部流程中的真实用户批准。

## 6. 持久化产物

固定目录：

```text
.harness/runs/<runId>/worktrees/<taskId>/integration/
  plan.json
  status.json
  bundle/sha256-<hex>.blob
  integration-receipt.json
  integrate.lock
```

新增 Schema：

- `.harness/schemas/worktree-integration-plan.schema.json`
- `.harness/schemas/worktree-integration-status.schema.json`
- `.harness/schemas/worktree-integration-receipt.schema.json`

`plan.json` 至少记录：

- Story/run/task/dispatch/phase/owner 身份。
- `baseCommit`、Worktree 路径、M3 task 和 checkpoint 哈希。
- M5-A plan、M5-B1 receipt、input manifest 和 Worker result 哈希。
- 每个文件的路径、类型、base 哈希或不存在标记、候选哈希、字节数和 bundle 路径。
- 固定的正式 `result.json` 路径和计划时间。

`status.json` 记录整体 `planned/applying/ready-for-apply/inconsistent` 状态，以及每个文件的 `pending/applied` 状态、
当前哈希、观察时间和失败原因。

`integration-receipt.json` 记录 plan 哈希、正式 result 哈希、所有已应用文件哈希和完成时间，是重复 Apply 的幂等依据。

## 7. Plan 行为

`Plan` 在写 bundle 前完成以下校验：

1. state 为 active，Story、run、phase 和 revision 与 M3 task 一致。
2. checkpoint 为同一 dispatch 的 `prepared`。
3. M5-A status 重新核验为 `created`，Worktree branch、HEAD 和 `baseCommit` 与 plan 一致。
4. DAG 恰好一个 pending task，task ID 和 owner 与 M3 task 一致。
5. M5-B1 receipt 为 `ready-for-integration`，且至少包含一个 `backend` 或 `frontend` 文件。
6. Worker result 为 `completed`，身份、outputs 和 records 继续符合 M3/M4-B Schema `1.0`。
7. receipt、manifest、result 和 Worktree 候选文件哈希全部匹配。
8. 正式 `result.json`、phase output 和 integration receipt 尚不存在。
9. 主工作树 HEAD 等于 `baseCommit`，业务目录没有未解释修改。

业务文件的 base 内容通过固定 `baseCommit` 读取。存在时记录 Git blob 的 SHA-256，不存在时记录 `null`；工作树是否仍为
base 通过 Git 差异语义判断，避免 Windows `core.autocrlf` 或其他 checkout filter 造成干净文件的原始字节哈希不同。
phase output 和正式 result 在首次计划时必须不存在。所有候选内容在全量预检后写入 bundle；bundle 总量沿用 M4-B 的
8 MiB 上限，单文件沿用 2 MiB 上限。

相同输入重复 `Plan` 返回 `reused`。已存在 plan 与当前身份、证据或 base 不一致时失败关闭，不覆盖旧 plan。

## 8. Status 与 Apply 行为

`Status` 重新验证 plan、bundle、state、task、checkpoint、已固化的 M5-B1 证据哈希和主工作树 HEAD，并按以下规则分类
目标文件。Plan 完成后不再要求 Worktree 存在或保持可用：

- 业务文件经 Git 判断仍等于固定 base，或 base 不存在且目标不存在：`pending`。
- 当前哈希等于候选哈希：`applied`。
- 其他情况：整体 `inconsistent`。

`Apply` 必须先满足 `confirmApply === true`，再获取 task 级 `integrate.lock` 并重新运行全部 Status 校验。写入顺序按规范化
仓库路径稳定排序：

1. 业务文件。
2. phase output。
3. 正式 `result.json`。
4. `integration-receipt.json`。

每个文件使用同目录临时文件加 rename。文件写入后原子更新 `status.json`。若进程在 rename 与状态更新之间中断，下一次
Status 根据候选哈希恢复 `applied`，不会重复产生副作用。

全部业务文件和 phase output 完成前不得写正式 result。正式 result 直接使用已验证的 Worker result 内容，不扩展 M3
Schema。Runtime 返回 `ready-for-apply` 后，调用方仍需显式执行 M3 `apply`。

## 9. 安全与失败关闭

- Git 命令使用固定可执行文件和参数数组，禁用 shell，30 秒超时和有限输出缓冲区。
- 所有仓库路径必须规范化，拒绝绝对路径、父目录跳转、大小写等价重复、父子冲突和符号链接穿越。
- 只允许 M5-B1 receipt 已记录且类型为 `backend`、`frontend` 或当前 phase output 的文件。
- 主工作树 `backend/src/**`、`frontend/src/**` 出现 plan 无法解释的修改时拒绝 Apply。
- 目标文件既不满足 Git base 语义也不匹配候选哈希时标记 `inconsistent`，不覆盖、不 reset、不选择冲突方。
- receipt、bundle、result、task、checkpoint、plan 或状态证据变化时失败关闭。
- 遗留锁只报告并要求人工检查，不自动强制清除。
- M5-B2 不修改 Worktree，不授予 Worker 新能力，也不执行 Git 写操作。

## 10. 幂等与恢复

- 重复 `Plan`：证据完全一致时复用，否则失败。
- 重复 `Status`：从文件系统和 Git 事实重建状态，不仅信任缓存。
- 重复 `Apply`：若 integration receipt 和所有目标哈希匹配，返回 `reused`。
- 部分应用：Git 仍判定为 base 的文件继续写入，候选哈希文件跳过，未知内容失败。
- result 写入后 receipt 写入前中断：重试验证正式 result 哈希后补写 receipt。
- receipt 已存在但文件后来变化：失败关闭，不把状态报告为 ready。
- 不自动回滚已经应用且哈希正确的候选文件；调用方修复不一致项后显式重试。

## 11. M2/M3 边界

M5-B2 不调用 `runStateCommand` 或 `runStoryCommand(... apply ...)`。Plan、Status 和 Apply 均不得改变 Harness revision 或
phase。只有正式 result 已生成后，调用方显式执行 M3 apply 才能记录 result records、运行 phase gate 并推进一次状态。

M5-B2 不修改 dispatch task/result Schema `1.0`。集成证据使用独立 Schema，避免把 Worktree 生命周期字段加入 M3。

## 12. 串行 TDD

### 12.1 计划契约

先覆盖错误 outcome、非 completed result、身份漂移、无业务文件、receipt/result/候选哈希失配和已有正式 result 的
RED；再实现内容寻址 bundle、plan Schema 和幂等 Plan。

### 12.2 状态与应用门禁

先覆盖无批准、HEAD 漂移、业务区脏、目标内容漂移、符号链接、bundle 篡改和遗留锁的 RED；再实现 Status、锁和双重
批准。

### 12.3 原子应用与恢复

先覆盖已有文件更新、新文件创建、文件写入后中断、状态写入前中断、result 后中断和重复 Apply；再实现稳定顺序、
原子写入、逐文件状态和最终 receipt。

### 12.4 M3 纵向闭环

在临时 Git 仓库执行：

```text
M3 prepare
  -> M5-A plan/create
  -> M5-B1 mock Worker
  -> M5-B2 Plan/Status/Apply
  -> M3 apply
```

断言 M5-B2 完成前后 revision 不变，正式 result 最后出现，显式 M3 apply 只调用一次并只推进一次；重复 M5-B2 Apply
保持幂等。M3 已有的“状态已推进但 checkpoint 未完成”中断恢复继续由 M3 回归测试覆盖，不把正常完成后的第二次 apply
误写为其支持范围。

### 12.5 回归与审核

运行 M5-B2、M5-B1、M5-A、M4-B、M3、M2、Harness status、Task DAG、结构、Smoke、知识新鲜度和差异门禁。逐项
修复影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`。

## 13. 影响范围

预计新增：

- `.harness/scripts/lib/worktree-integration-runtime.mjs`
- `.harness/scripts/run-worktree-integration.ps1`
- `.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 三个 integration Schema
- `docs/harness-m5b2-worktree-integration/{DESIGN,PLAN,REPORT}.md`
- `M5-B2-001` phase 证据

预计更新 Harness README、脚本说明、结构 manifest/检查清单、架构适配、AI 交接、知识概览和项目级报告。

不修改 `backend/src/**`、`frontend/src/**`、数据库、部署或外部服务。临时测试仓库中的业务候选文件不属于正式项目业务
源码修改。

## 14. 验收标准

- 已验证的单 Worktree `ready-for-integration` receipt 能生成稳定、可复用的内容寻址 plan。
- 未批准 Apply 不写业务文件、phase output、正式 result 或成功 receipt。
- 已有文件更新和新文件创建均满足 Git 逻辑 base/候选哈希前置条件。
- 未解释业务修改、base 漂移、符号链接、bundle 或 receipt 篡改均在写入前拒绝。
- 中断后同一 plan 可恢复，最终每个候选只得到一个确定内容。
- 正式 result 最后写入，M5-B2 不改变 phase/revision。
- 显式 M3 apply 只调用一次并只推进一次；M5-B2 重复 Apply 保持幂等。
- M2-M5 回归、结构、Smoke、知识和差异门禁继续通过。
- 最终 Review 不存在影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`。

## 15. 延期边界

多 Worktree、多任务聚合、删除/重命名、全局事务、自动回滚、merge/remove、真实 Agent、Git 自动交付和断电级持久化
继续延期。跨平台 Git 行为、恶意同进程调用方和未知临时文件自动清扫作为低概率边界记录到完成报告，不阻塞 M5-B2。
