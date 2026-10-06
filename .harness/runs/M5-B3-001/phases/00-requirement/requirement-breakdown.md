# M5-B3-A 需求拆解

## 来源

在 M5-C 完成后，为后续多任务能力先建立协议设计与兼容性验证，不直接实现多 Worktree 或并行执行。

## 假设

- 采用推荐的单 Worktree、单任务串行执行作为 M5-B3-B 的起点。
- M5-B3-A 仅修改 Harness 文档、结构登记和工作流证据，不修改 Runtime 或业务源码。
- M3 v1.0、M4-B、M5-A/B1/B2/C 的既有单任务行为必须保持兼容。

## 受影响知识

| 区域 | 已读取 | 新鲜度 |
| --- | --- | --- |
| Common | `llm-knowledge/overview.md`、执行验证约定、M3/M5 设计与源码 | fresh |
| Backend | 不涉及 | fresh |
| Frontend | 不涉及 | fresh |

## Story

### S1 - 固化串行多任务协议边界

- 用户价值：后续可在不破坏单任务 Harness 的前提下安全演进多任务能力。
- 受影响模块：`.harness/`、`docs/`、`llm-knowledge/`；不涉及业务源码。
- 新增行为：本 Story 输出 M5-B3-B 的 task-scoped dispatch 和 batch ledger 设计结论。
- 验收标准：
  - [ ] 说明为何现有 M3 phase dispatch 与 M5-B1/B2/C 不能直接循环处理多任务。
  - [ ] 明确推荐协议、状态推进权、失败停止和恢复边界。
  - [ ] 给出可执行的 TDD 验收序列与延期范围。
- 风险：M5-B3-B 会触及 M3/M5 共享契约；未经独立设计和 TDD 不得实现。
- 测试提示：M5-B3-A 采用知识/源码对照、结构和状态验证；M5-B3-B 才适用代码级 TDD。
