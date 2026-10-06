# M5-D-A-001 需求拆解

## 目标

验证同一 Task DAG wave 中多个 Worktree 的确定性计划、Git 事实状态、冲突拒绝和恢复兼容性，为后续受审批的多 Worktree 编排提供可信输入。

## 验收标准

- active Story 的 `implementation` phase 可对至少两个 pending 的 backend/frontend 任务生成一个 wave 计划。
- 全部任务共享计划时的不可变 `baseCommit`，分支、路径和顺序均可重复派生。
- 状态按 Git 事实聚合为 `absent`、`partial` 或 `ready`，并识别 `branch-only` 恢复状态。
- 基准、DAG、分支、路径、HEAD 或计划外 Worktree 漂移时失败关闭。
- Runtime 不创建 Worktree、不启动 Worker、不 merge/remove，也不修改 Harness revision 或 phase。
- 临时 Git fixture 可真实创建两个 Worktree；正式 FrontierScan 仓库无 Worktree 副作用。

## 影响范围

- `.harness/scripts/lib/worktree-runtime.mjs`
- `.harness/scripts/run-worktree.ps1`
- 新增 wave plan/status Schema 与专项测试
- Harness 结构清单、说明、交接、架构和知识概览

不修改 `backend/src/**`、`frontend/src/**`、数据库、部署或外部服务。

## 排除范围

不实现 `wave-create`、并行 Worker、结果聚合、自动 merge、冲突解决、Worktree/分支删除、`prune`、Fork-Join、真实 Agent、发布、部署或 Git 自动交付。

## 待确认事项

无。用户已要求继续完成 M5-D-A；按已确认的最小兼容性 Spike 执行。
