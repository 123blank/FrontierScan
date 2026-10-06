# M5-D-A-001 技术设计

## 当前行为

M5-A 只能按单个 `taskId` 计划和检查 Worktree；M5-B3-B 在一个 Worktree 中串行执行多个任务。共享 Task DAG 契约已能拒绝同 wave 文件冲突，但尚无同 wave 多 Worktree 的聚合计划和事实状态。

## 目标行为

- 在现有 `runWorktreeCommand` 增加 `wave-plan` 与 `wave-status`。
- `wave-plan` 固定 `dev` SHA，稳定派生每项任务的分支、路径和顺序。
- `wave-status` 从 Git 事实识别任务级 `absent/branch-only/created` 与聚合 `absent/partial/ready`。
- 任一漂移失败关闭，不自动修复，不写误导性状态。

## 实现约束

- 目标 Story 必须 active 且处于 `implementation`。
- wave 为 1-based，至少两个 pending 的 backend/frontend 任务，`globalChanges` 为空。
- 复用 `task-dag-contract.mjs`、Git 执行器、ref 探测、路径校验和原子 JSON，不引入第三方依赖或第二套 Runtime。
- 分支为 `harness/<story>/wave-<wave>-<task>-<slug>`；路径为 `.harness/worktrees/<story>/wave-<wave>/<taskId>`。
- 正式仓库只执行 plan/status；真实双 Worktree 只存在于系统临时目录 fixture。

## 测试策略

严格 TDD：

1. 计划输入和确定性契约。
2. absent/partial/ready 与 branch-only 恢复。
3. 基准、DAG、分支、路径、HEAD、符号链接和额外 Worktree 漂移。
4. PowerShell 纵向入口和临时 Git 双 Worktree fixture。
5. M5-A/M5-B3-B/M4-B/M3/M2 与结构、Smoke 回归。

## 安全与回滚

本 Story 不提供创建、合并或删除命令，因此正式仓库无 Worktree 写副作用。代码回滚只需移除 wave 命令、Schema、测试和文档登记，现有单任务与 batch 命令保持兼容。
