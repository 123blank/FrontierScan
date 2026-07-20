# FrontierScan Harness M5-A 单 Worktree 受控编排设计

## 目标

M5-A 在现有 Task DAG 与未来隔离执行之间增加一个最小、确定性、可恢复的单 Worktree 边界。它只负责计划、事实状态和显式批准创建，不启动 Worker，也不收集或合并变更。

## 现状

`plan-worktrees.ps1` 当前只生成建议命令；Task DAG 校验只覆盖结构、引用和无环；M2/M3/M4-B 已分别独占状态推进、Dispatch apply 和受约束 Mock Worker。M5-A 保持这些职责不变。

## 数据流

```text
active Story + valid Task DAG
  -> plan(dev commit SHA, branch, path)
  -> status(git facts)
  -> explicit approval + ConfirmCreate
  -> git worktree add
  -> status(created)
```

## 契约

- Task DAG 的每个任务必须唯一归属 wave，依赖必须跨递增 wave。
- `predictedFiles` 支持精确路径和尾部 `/**` 目录范围；同波次按 Windows 大小写不敏感语义检测重叠。
- 计划绑定 Story、runId、Task DAG 摘要、基准 SHA、生成分支和仓库相对 Worktree 路径。
- 状态来自 `git worktree list --porcelain` 与引用解析，缓存 JSON 仅作为证据。
- `create` 不接受任意 shell、分支或路径，使用固定 Git argv、超时和有限缓冲区。

## 安全和恢复

- 主仓库脏、基准漂移、路径占用、分支漂移、第二个活动 Worktree 或遗留锁均失败关闭。
- 完全匹配的既有 Worktree 返回 `reused`。
- 分支已经创建且仍指向计划 SHA 时允许继续挂载。
- Git 创建完成但状态未落盘时，下次调用从 Git 事实恢复。
- 不自动删除、reset、clean、merge 或清理遗留锁。

## 排除范围

M5-B/M6 承担多 Worktree 波次、Worker 执行、结果收集、合并/删除、Fork-Join、真实 Agent 和外部交付。
