# FrontierScan Harness M3 单 Story Dispatcher 设计

> 日期：2026-07-17
> 分支：`feat/harness-m3-agent-dispatcher`
> 状态：已按 TDD 实现并完成最终审核

本设计的权威技术内容位于 [`.harness/outputs/technical-design.md`](../../.harness/outputs/technical-design.md)。M3 的定义以 `docs/harness-m0-m1/PLAN.md` 中的 Single-Story Vertical Slice 为准：文件式 Dispatcher 负责结构化派发、结果校验、固定命令适配和 M2 状态协作；真实 Agent Runtime、多 Agent 并发、Worktree、发布和 Git 写入均不在本阶段范围内。

核心数据流：

```text
M2 当前状态
-> prepare 生成 task.json
-> 当前 Codex/人工执行并写 result.json + 阶段产物
-> apply 校验身份、路径、证据和状态
-> M2 record + next/block/complete
-> checkpoint 保留可恢复进度
```

所有新运行的阶段事实存放于 `.harness/runs/<storyId>/phases/<order>-<phase>/`。M2 继续是唯一状态推进者，M3 不直接编辑活动状态文件。

审核修复补充：checkpoint 绑定 adapter evidence SHA-256，`apply` 推进前重新校验普通文件、哈希、派发身份和成功退出状态；`no-build-required` 通过固定 Git 状态命令确认 `backend/`、`frontend/` 不存在 staged、unstaged 或 untracked 变化；M2 已推进但 checkpoint 尚未落盘时，`apply` 通过 `runtime.previousPhase`、workflow next 和旧派发身份对账并返回 `already-applied`。本机活动指针、E2E 活动状态、备份、临时文件、锁和事件日志由 `.gitignore` 排除，状态模板和 `.harness/runs/` 审核证据仍可交付。
