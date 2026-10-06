# Harness M5-B3-A 多任务协议兼容性报告

## 结论

M5-B3-A 已完成只读兼容性验证。当前 M3/M5 运行时不能通过循环调用现有接口安全处理同一 Story 的多个 DAG task：M3 的 dispatch 和 phase 产物没有 task 身份，M5-B1 明确拒绝多节点 DAG，M5-B2/M5-C 的凭据目录均按单 task 建模。

推荐后续 M5-B3-B 先实现 task-scoped dispatch v1.1、batch-scoped Worktree 生命周期与独立串行 batch ledger。该方案保持 M2/M3 的状态推进权，要求每项 task 具有独立 task/result/checkpoint/receipt 证据，并在全批次完成前禁止自动推进 phase；M5-C 只在目标 Story 完成后回收 batch Worktree。

## 覆盖范围

| 项目 | 结论 |
| --- | --- |
| M3 v1.0 | 单 phase、单 dispatch、固定 phase 产物，不能直接承载多任务 |
| M5-A | 当前 task 级 Worktree 不能复用；M5-B3-B 需要 batch-scoped plan 才能串行执行多个 task |
| M5-B1 | 现有多节点 DAG 拒绝是正确的失败关闭行为 |
| M5-B2 | 继续只集成单 task、单 dispatch、单正式 result |
| M5-C | 继续仅在目标 Story 完成后回收；不能在首 task 后提前释放 Worktree |
| M5-B3-B | 采用串行、batch-scoped 单 Worktree、单执行锁；不进入并行或多 Worktree |

## 验证证据

- 知识新鲜度：backend、frontend、common 均为 `fresh`。
- 源码/设计对照：已读取 M3 dispatch contract、M5-B1 Worker、M5-B2 Integration、M5-C 生命周期设计与报告。
- 本 Story 仅新增 Harness 文档和工作流产物，不适用代码级 TDD 或业务构建；M5-B3-B 已在 `DESIGN.md` 固定严格 RED-GREEN-REFACTOR 验收。

## 延期项

不实现 task-scoped dispatch、batch ledger、多任务 Worker、同 wave 并行、多 Worktree、Fork-Join、自动合并、分支清理、真实 Agent、发布、部署或 Git 自动交付。以上能力必须在 M5-B3-B 获得单独设计确认后按 TDD 实现。
