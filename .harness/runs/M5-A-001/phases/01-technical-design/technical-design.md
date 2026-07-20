# M5-A-001 技术设计

## 设计结论

- 新增标准库 Node 共享 Task DAG 契约，PowerShell 校验入口保持兼容。
- 新增 Node Worktree Runtime 和 PowerShell 薄入口，命令仅为 `plan`、`status`、`create`。
- 计划和状态保存到 `.harness/runs/<runId>/worktrees/<taskId>/`，不扩展 M2 状态 Schema。
- Git 通过无 shell 的参数数组执行，正式仓库创建同时要求用户批准和 `ConfirmCreate`。
- 所有测试中的真实 Worktree 只在临时 Git 仓库创建并清理。

## 安全边界

- 基准固定为计划时 `dev` 的 commit SHA；创建时发现分支漂移立即失败。
- 分支名和路径由 Story、Task 和标题确定性生成，不接受任意目标输入。
- 同一运行只允许一个 created Worktree；路径、分支或 HEAD 不一致时不自动修复。
- Runtime 只写自身 plan/status/lock 产物，不推进 Harness 状态。

## 恢复

如果 Git 已创建 Worktree 但状态文件尚未写入，后续 `status/create` 通过 `git worktree list --porcelain` 对账并恢复。分支已创建但未挂载且仍指向计划 SHA 时，可以继续挂载。
