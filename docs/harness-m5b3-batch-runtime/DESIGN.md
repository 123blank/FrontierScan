# Harness M5-B3-B 单 Worktree 串行多任务批次运行时设计

> Story: `M5-B3-B-001`
>
> 状态：已进入 `implementation`；已完成 T1 的 v1.1 dispatch 契约，后续任务按本设计串行实施

## 0. 已确认的范围收缩

M5-B3-B 只支持 active Story 的 `implementation` phase，且 batch Task DAG 节点必须为 `backend` 或 `frontend` 类型并产生至少一个可由 M5-B2 集成的业务候选。`docs`、`test`、`integration`、纯 phase-output 节点以及 `requirement`、`unit-test`、`code-review`、`build-publish`、`interface-verification`、`git-delivery` 等 phase 继续使用现有单任务流程。

这是最小可验证边界：现有 M3 在测试和构建阶段要求 adapter evidence，不能由批次凭据替代；纯 phase-output 的 M5-B1 outcome 为 `ready-for-apply`，不能安全进入 M5-B2 的业务集成路径。

## 1. 目标

M5-B3-B 在不改变 M2/M3 状态推进权的前提下，使同一 Story 的 `implementation` phase 中多个可集成 Task DAG 节点能够在一个受控 Git Worktree 中串行执行：

```text
Task DAG
  -> M3 批次准备
  -> 任务级 dispatch v1.1
  -> 单批次 Worktree
  -> M5-B1 Worker / M5-B2 集成（逐任务串行）
  -> 批次回执
  -> M3 批次收尾
  -> 既有 M3 apply（仅一次 phase 推进）
  -> M5-C 回收
```

本 Story 只实现单 Worktree、单 batch、严格串行的多任务闭环。它不实现多 Worktree、同 wave 并行、Fork-Join、自动提交、合并、分支删除、真实 Agent、发布或部署。

## 2. 已核验现状

| 组件 | 当前行为 | M5-B3-B 约束 |
| --- | --- | --- |
| M3 `story-runtime.mjs` | phase 固定使用一个 `task.json`、`result.json`、`checkpoint.json`，`apply` 会推进 phase | v1.0 单任务路径必须保持不变；批次完成前不得调用 `apply` |
| M4-B | Worker 只接受经过 Schema 校验的 dispatch，不能推进状态 | 继续使用 mock provider、策略和原有权限边界 |
| M5-A | plan/status/create 与一个 `taskId` 绑定 | 新增与 batch 绑定的受控分支和 Worktree 派生规则，不放宽现有单任务入口 |
| M5-B1 | 运行前要求 Worktree 干净，执行回执绑定单任务 | 批次路径需识别可信的前序任务累积改动，其他改动仍失败关闭 |
| M5-B2 | 一次集成一个 Worker 回执及正式 `result.json` | 保持逐任务集成；批次结束后再生成 phase 正式结果 |
| M5-C | 只在 Story `done/completed` 后回收单任务 Worktree | 扩展为校验 batch 回执和累计候选文件后回收一个 batch Worktree |

`M5-B3-A` 已证实，循环复用 phase 级 v1.0 dispatch 或将每个 DAG 任务拆为独立 E2E Story 都不能满足可审计、可恢复的单 Story 多任务闭环。

## 3. 方案比较与决策

### 3.1 推荐：兼容的任务级协议与批次账本

新增 v1.1 task-scoped dispatch、batch-scoped Worktree plan 和独立串行 batch ledger。v1.0 继续服务所有既有单任务 Story；只有多节点 DAG 使用 v1.1。每项任务拥有独立产物、回执和恢复锚点，批次收尾后才物化既有 M3 v1.0 phase 产物并由显式 `apply` 推进。

优点是保持既有单任务语义、证据链和状态推进边界，且为未来并行 wave 留下清晰分层。代价是需要对 M3、M5-A/B1/B2/C 的多任务分支做最小扩展。

### 3.2 不采用：每个 DAG 节点创建独立 E2E Story

该方案避免修改 Runtime，却把一个业务 Story 拆成多个状态、审批和交付生命周期，提前引入 Fork-Join 汇总和跨 Story 恢复问题，超出 M5-B3-B 范围。

### 3.3 不采用：覆盖复用 phase 固定文件

该方案会让后续任务覆盖前一任务的 `task.json`、`result.json` 和 `checkpoint.json`，且首个 `apply` 会错误推进 phase，不具备可审计或可恢复性。

## 4. 协议与目录

### 4.1 v1.0 与 v1.1 兼容边界

现有 `dispatch-task.schema.json`、`dispatch-result.schema.json` 和 `dispatch-contract.mjs` 的 v1.0 严格字段校验不放宽。新增 v1.1 Schema 与相同模块中的版本分派校验，v1.1 必须额外携带：

```text
batchId
taskId
taskRoot
```

v1.1 task 与 result 都必须具有相同的 `batchId`、`taskId`、Story、phase 和 dispatch 身份。每个 v1.1 task 的唯一 `expectedOutputs` 固定为 `<taskRoot>/task-report.md`；业务候选由 Worker 文件集合和后续 M5-B1/M5-B2 receipt 单独证明。未知版本、v1.0 中混入 v1.1 字段、v1.1 缺少字段、任务目录逃逸或跨任务引用均失败关闭。

任务级产物固定保存为：

```text
.harness/runs/<runId>/phases/<phase-order>-<phase>/tasks/<taskId>/
  task.json
  result.json
  checkpoint.json
```

`taskId` 只接受已校验 DAG 中的标识；目录由 Runtime 派生，调用方不能传入任意路径。

### 4.2 批次计划与账本

新增三类独立 Schema，均采用严格字段和原子写入：

```text
worktree-batch-plan.schema.json
serial-batch-ledger.schema.json
worktree-batch-receipt.schema.json
```

batchId 由 Story、phase 和 Task DAG SHA-256 前缀确定；分支与 Worktree 路径均由该 ID 派生：

```text
branch:         harness/<story>/batch-<batchId>
worktreePath:   .harness/worktrees/<story>/batch-<batchId>
evidenceRoot:   .harness/runs/<runId>/batches/<batchId>/
```

ledger 至少绑定 `stateFile`、Story/run/phase、`preparedRevision`、Task DAG 路径与 SHA-256、`baseRef`、不可变 `baseCommit`、batch plan 哈希、固定任务顺序、每项 dispatch 与回执路径、继承文件快照和状态。M3 的公开 batch 入口只接受 `baseRef`，由 `worktree-runtime.mjs` 使用固定 Git argv 解析并验证后，再将内部 `{ baseRef, baseCommit }` 传给不执行 Git 的 `batch-runtime.mjs`。后者校验该值的格式与账本一致性但不执行 Git；同进程直接调用不是恶意调用方的安全边界。

批次状态仅允许：`prepared`、`active`、`blocked`、`ready-for-finalization`、`finalized`。任务状态仅允许：`pending`、`running`、`ready-for-integration`、`integrated`、`blocked`。所有转移由 Runtime 根据当前证据派生，调用方不能直接写账本状态。

任务顺序按 DAG wave 递增、同 wave 按 Windows 大小写不敏感的 `taskId` 稳定排序。即使同 wave 无文件冲突，M5-B3-B 也只执行一个任务。

## 5. 累积 Worktree 与权限边界

一个 batch Worktree 从 `baseCommit` 创建后不会在任务之间重置或提交。第一个任务集成后，主仓库和 Worktree 都保留已验证的候选内容；第二个任务在该可信累积状态上执行。

每个任务开始时，Runtime 写入不可变的继承快照：前序已集成候选文件及其 SHA-256、当前 Worktree 变更集合和当前主仓库对应文件哈希。后续 Worker 只能：

1. 保持继承快照中的文件哈希不变，或在自身 `predictedFiles` 覆盖范围内声明对其修改；
2. 写入自身 task-scoped phase 产物和经策略允许的业务候选文件；
3. 在 Worker result、execution receipt 和 integration receipt 中完整记录本任务产生或改写的文件。

所有业务候选及前序文件改写都必须匹配当前 task 的 `predictedFiles`：沿用 Task DAG 的 Windows 大小写不敏感精确路径或以 `/**` 结尾的子树范围语义。未在继承快照或当前任务候选集合中的任何新增、删除、重命名、复制或哈希漂移均拒绝。前序候选被后续任务改写时，M5-B2 以主仓库的当前哈希作为该任务的集成基线，而不是错误地使用 batch 的初始 `baseCommit` 哈希。

M4-B Worker 仍不获得 shell、Git、网络、发布、部署、状态推进或任意路径能力。所有 Git 调用仍使用固定可执行文件、参数数组、30 秒超时和有限输出缓冲区。

## 6. Runtime 入口与状态推进

为避免创建第二套 Worktree Runtime，`worktree-runtime.mjs` 扩展 batch `plan/status/create` 分支；既有 task 单 Worktree 命令保持原语义。新增轻量 `batch-runtime.mjs` 只负责 Schema 校验、ledger 锁和任务状态转换，不直接执行 Git。

建议的内部入口如下：

```js
runStoryCommand({ command: "prepare-batch", stateFile, taskDagFile })
runBatchCommand({ command: "status" | "claim" | "finalize", stateFile, batchFile, taskId? })
runWorktreeCommand({ command: "batch-plan" | "batch-status" | "batch-create", stateFile, batchFile, confirmCreate? })
runWorktreeWorker({ stateFile, batchFile, taskId, provider, contextFiles? })
runWorktreeIntegration({ command: "plan" | "status" | "apply", stateFile, batchFile, taskId, confirmApply? })
runStoryCommand({ command: "finalize-batch", stateFile, batchFile })
runStoryCommand({ command: "apply", stateFile })
```

`prepare-batch` 仅在 active Story 的多节点 DAG 上生成 ledger 与所有 v1.1 dispatch；它不写 phase 根目录的 v1.0 `task.json`。`claim` 只允许选择确定性的下一个 pending task，并持有 batch 执行锁。

M5-B1 验证成功后只接受 `ready-for-integration` outcome，并将当前任务推进为 `ready-for-integration`；M5-B2 仅在验证当前任务、继承快照和由前序 integration receipt 派生的主树 allowlist 后推进为 `integrated`。任意失败、阻塞、证据漂移或遗留锁都会停止 ledger，不会选择后续任务。

仅当全部任务为 `integrated` 时，`finalize-batch` 才能写入 batch receipt，并由 task-report、execution receipt、integration receipt 和去重后的 task records 生成唯一的 `implementation-notes.md`、标准 v1.0 phase `task.json/result.json/checkpoint.json`。它不修改 Harness revision 或 phase。随后仍由调用方显式执行既有 M3 `apply`，因此一次且仅一次推进 phase。

## 7. 恢复与回收

Provider 超时或异常不会自动重试、不会推进状态，也不会选择下一个任务；ledger 保持当前 `running` task，允许使用相同 dispatch 的显式重试。已存在的匹配 task receipt、integration receipt 或 batch receipt 可复用；任一哈希、身份、DAG、基准提交、分支、路径或继承快照漂移均失败关闭。

M5-C 只在目标 Story `done/completed` 后回收 batch Worktree。它必须验证 batch plan、batch ledger、batch receipt、每项 M5-B1/M5-B2 回执、累计已集成文件和标准 M3 phase result 均匹配。batch 专用主树 preflight 仅允许 ledger 由全部 integration receipt 派生的累计 `appliedFiles`，并逐项验证当前 SHA-256；任何其他未提交变更仍拒绝。保留 batch 分支，不执行 prune、reset、clean 或分支删除。

## 8. TDD 与验收

实现严格按 RED-GREEN-REFACTOR 串行进行，每项通过针对性测试和 owned diff 审核后才开始下一项：

1. v1.0/v1.1 dispatch 版本分派、任务路径、身份和严格字段校验；
2. ledger 对 `implementation`、backend/frontend 节点、固定 task-report、已验证 baseCommit 的约束，以及顺序、锁、DAG/基准漂移、失败关闭和可恢复重试；
3. batch Worktree 派生、批准门禁、累计变更快照与符号链接/路径逃逸拒绝；
4. 两任务临时 Git fixture 的 Worker、逐任务集成、前序 allowlist、不同文件和二次修改同一文件；
5. batch finalize 仅生成正式 phase 结果，显式 M3 `apply` 后恰好推进一次；
6. M5-C batch 回收、未提交累计业务文件 allowlist、重复调用与 receipt 写入中断恢复；
7. M2/M3/M4-B/M5-A/B1/B2/C 回归、结构校验、Smoke、知识新鲜度和 `git diff --check`。

正式 FrontierScan 仓库不创建或回收 Worktree；所有真实 Git fixture 均在临时仓库内运行。

## 9. 延期边界

延期到后续 Story：多 Worktree、同 wave 并行、Fork-Join、自动合并、自动提交或推送、分支清理、真实 Agent、真实模型、发布、部署、冲突解决、自动清理遗留锁和断电级持久化。Windows 以外的差异与恶意同进程调用方的操作系统隔离也只记录为后续风险，不作为当前阻塞项。
