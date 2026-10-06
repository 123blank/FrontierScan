# Harness M5-B3-A 多任务协议兼容性设计

> Story: `M5-B3-001`
> 阶段：仅设计与兼容性验证，不修改 Runtime。

## 1. 目标

M5-B3-A 为后续单 Worktree、串行多任务执行建立可验证的协议边界。它不启动多个 Worker、不创建额外 Worktree、不自动合并或回收分支，也不修改 `backend/src/**`、`frontend/src/**`。

目标是回答一个前置问题：如何让同一 Story 的多个 DAG task 顺序消费 M3/M4-B/M5 运行时，而不让任一任务直接推进全局 phase 或覆盖另一任务的证据。

## 2. 现状结论

| 组件 | 当前契约 | 对多任务的限制 |
| --- | --- | --- |
| M3 `story-runtime.mjs` | 每个 phase 仅有一个 `task.json`、`result.json`、`checkpoint.json`；`apply` 成功后立即推进 phase | 无 task 身份和隔离产物目录；第二个 task 会覆盖第一个 task 的 dispatch，或在第一个 apply 后失去同一 phase |
| M5-A | Worktree plan、路径和锁绑定一个 pending `taskId` | 不能让多个 task 共享同一 Worktree，也不能在已有 task Worktree 未回收时创建下一项 |
| M5-B1 | 要求 DAG 恰好一个节点 | 不能直接消费多节点 DAG |
| M5-B2 | Plan/receipt 绑定一个 `taskId`、一个 M3 dispatch 和一个正式 `result.json` | 不可安全聚合多个 task 的候选和结果 |
| M5-C | 回收一项已完成 M5-B2 单 Worktree，目标 Story 必须 `done/completed` | 不能在同一 Story 的首个 task 完成后提前回收其 Worktree |

因此，直接循环调用现有 M3 prepare/M5-B1/M5-B2/M3 apply 不可采用：第一次 M3 apply 会推进 Story phase，phase 目录中的固定文件会被后续任务覆盖；即使跳过 apply，M5-A/M5-C 的 task 级生命周期也无法在同一 Story 中安全释放首个 Worktree 后继续下一项。

## 3. 方案比较

### 3.1 任务作用域 Dispatch v1.1 与串行批次账本（采用）

M5-B3-B 新增独立的批次账本和 batch-scoped Worktree 生命周期，按 DAG wave 和稳定 taskId 顺序选择一个 task；M3 增加兼容的 task-scoped dispatch v1.1，使 task、result、checkpoint 和集成凭据均包含 `taskId` 并保存到 task 独立目录。批次运行时只允许一个任务处于执行中，所有 task 完成并通过验证后才由受控入口推进 phase，并只在目标 Story 完成后交给 M5-C 回收该 batch Worktree。

优点是保留 M2 的唯一状态推进权、保留 M5 每 task 的 hash 证据和恢复语义，并将串行批次与未来并行 wave 明确分层。代价是需要有界扩展 M3 契约和测试。

### 3.2 每个 DAG task 创建独立 E2E Story（不采用）

该方案避免改动 M3，但会把同一业务 Story 拆成多个状态文件和交付生命周期，增加需求、审批、汇总和失败恢复的协调成本，实际上提前进入 Fork-Join。

### 3.3 覆盖复用 phase 级产物（不采用）

该方案不增加 Schema，但 task 之间会覆盖 `task.json`、`result.json` 与 checkpoint，且首个 apply 直接推进 phase，不能提供可审计或可恢复的多任务闭环。

## 4. 推荐的 M5-B3-B 边界

### 4.1 新增协议

- `task-scoped dispatch v1.1`：在现有 M3 v1.0 字段基础上增加必填 `taskId`，并采用 task 独立产物目录；v1.0 继续用于既有单任务 Story。
- `batch-scoped Worktree plan v1.1`：计划、路径、锁和 base commit 绑定批次而不是单 task；任务仍各自保存 M5-B1/M5-B2 凭据，但共享一个受控 Worktree。
- `serial batch ledger`：独立 Schema 记录 Story/run、绑定 DAG 哈希、batch Worktree plan 哈希、按 wave/taskId 排序的任务清单，以及每项 `pending/running/ready-for-apply/integrated/completed/failed/blocked` 状态。
- `batch receipt`：只在全部已选 task 完成后写入，记录每项 dispatch、M5-B1/M5-B2 证据哈希和最终聚合结果；M5-C retirement receipt 仅在目标 Story 进入 `done/completed` 后关联。

### 4.2 权限和状态边界

- 一次只允许一个 task 持有批次执行锁；本阶段不允许同 wave 并行。
- M4-B Worker 继续不获得 Git、网络、发布、状态推进或任意 shell 能力。
- M5-B1、M5-B2 继续以单 task receipt 工作，但其 Worktree 路径必须由 batch plan 推导；M5-C 仅回收完成 Story 的 batch Worktree，不接受批次级任意路径或 ref 输入。
- M2/M3 仍是唯一可推进 state/phase 的入口；批次账本不能自行推进 phase。
- task 失败、阻塞、证据漂移或遗留锁均停止批次，不自动跳过、重试、回滚或选择冲突方。

### 4.3 恢复规则

- 重启先重验 ledger、绑定 DAG、当前 task scoped dispatch、Worktree plan/status 与所有 receipt 哈希。
- 已有匹配 receipt 的 task 复用；缺少或漂移证据失败关闭。
- 只有前序 task 已达到 `completed`，后续 task 才可选择；未来 wave 也必须等待前一 wave 完成。

## 5. M5-B3-B 的 TDD 验收

1. 先为 v1.1 缺少 taskId、重复 taskId、v1.0/v1.1 混用和 task 目录逃逸写 RED。
2. 再为 ledger 的逆序选择、同 wave 并发、前序失败后继续、DAG/commit 漂移和双执行锁写 RED。
3. 在临时 Git fixture 跑通两个串行 task：每项 `prepare -> M5-B1 -> M5-B2 -> task completion` 共享同一 batch Worktree，批次完成后才允许一次受控 phase 推进。
4. 覆盖首 task 集成后中断、第二 task 失败、receipt 已写后重启、提前 retire 拒绝与重复批次调用；任何失败不得污染后续 task 或全局 phase。
5. 回归 M2、M3、M4-B、M5-A/B1/B2/C、结构、状态、DAG、Smoke 和差异门禁。

## 6. 延期边界

M5-B3-A 不实现或批准多 Worktree、同 wave 并行、Fork-Join、自动合并、分支删除、`prune`、冲突解决、真实 Agent、发布、部署或 Git 自动交付。跨平台、断电级持久化和恶意同进程调用方仍为低概率延期项。
