# M5-B3-A 技术设计

权威设计位于 `docs/harness-m5b3-multi-task-protocol/DESIGN.md`。

本阶段确认：现有 phase 级 M3 dispatch 只能承载一个 task；M5-B3-B 必须采用兼容的 task-scoped dispatch v1.1 与独立串行 batch ledger，不能通过覆盖 phase 产物或自动推进 state 实现多任务。

M5-B3-A 不实现 Runtime，不修改 M3/M5 Schema，不创建或回收 Worktree，也不启动 Worker。
