# M5-B3-B-001 需求拆解

## 需求摘要

在已完成的 M5-B3-A 兼容性结论基础上，为同一 Story 的多节点 Task DAG 设计单 Worktree、严格串行的任务级 dispatch 与批次账本闭环。M2/M3 继续独占状态与 phase 推进，M4-B Worker 不获得 Git 或状态能力。

## 已确认假设

- 仅支持单 Worktree、单 batch、严格串行执行；同 wave 不并行。
- 保持 v1.0 单任务 Story 兼容；多节点 DAG 使用新 v1.1 协议。
- 正式 Story phase 只在全部任务集成且批次完成后，由既有 M3 `apply` 推进一次。
- 真实 Git 行为只在临时 fixture 测试仓库执行；正式仓库 Worktree 创建和回收继续逐次要求用户批准。
- 用户已授权采用推荐方案；未授权提交、推送、发布、部署或正式 Worktree 操作。

## 受影响范围

| 区域 | 预期影响 |
| --- | --- |
| `.harness/scripts/lib/dispatch-contract.mjs` | 支持严格区分 v1.0 与 v1.1 dispatch |
| `.harness/scripts/lib/story-runtime.mjs` | 批次准备与收尾，但不改变单任务 `apply` 语义 |
| `.harness/scripts/lib/worktree-runtime.mjs` | batch 派生的 plan/status/create 与恢复校验 |
| `.harness/scripts/lib/worktree-worker-runtime.mjs` | 累积 Worktree 的继承快照和逐任务回执 |
| `.harness/scripts/lib/worktree-integration-runtime.mjs` | 逐任务集成与当前主树哈希基线 |
| `.harness/scripts/lib/batch-runtime.mjs` | 新增 ledger、锁和受控任务状态转换 |
| `.harness/schemas/` 与 `.harness/scripts/tests/` | 新增协议 Schema、临时 Git fixture 和回归覆盖 |
| `docs/`、README、结构清单、交接文档、知识概览 | 记录架构、边界、验证和后续操作 |

`backend/src/**`、`frontend/src/**`、数据库、外部服务、发布和部署不在范围内。

## 验收标准

1. v1.0 单任务 dispatch、Worker、集成与回收测试保持通过，且 v1.0 不接受 v1.1 字段。
2. 两任务临时 Git fixture 使用一个 batch Worktree 串行完成；每项拥有独立 task/result/checkpoint 和 M5-B1/M5-B2 回执。
3. 第一个任务集成后，Story revision 与 phase 不变；第二任务可读取已验证的前序改动，但未知或漂移改动被拒绝。
4. batch 完成前不能生成可应用的正式 phase result；所有任务集成后，显式 M3 `apply` 仅推进一次。
5. provider 超时、非法输出、DAG/基准/哈希漂移、遗留锁、重复调用和提前 Retire 都不能污染后续任务或状态。
6. batch Worktree 仅在目标 Story `done/completed` 且所有累计证据完整时允许 M5-C 回收。

## 风险与处理

- 共享 Worktree 的累积未提交改动可能被误判为越权：以每任务继承快照和任务级候选集合校验。
- 任务间编辑同一文件可能造成错误集成基线：后续任务以主仓库当前已集成内容为基线，保留两次回执。
- 批次协调可能绕过 M3：批次 Runtime 不调用状态 Runtime，最终仍使用既有显式 `apply`。
- 并发或自动清理会破坏恢复语义：本 Story 仅持有单 batch 锁，其他能力延期。
